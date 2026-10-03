// scripts/verify.mjs — one-command full verification for humans and AI agents.
//
// On the host, dispatches to the dedicated Docker image. In that image, boots
// the game server on a free port, then runs eslint → tsc → every test
// suites → the smoke test against that server, and tears the server down in a
// finally block. Exit code 0 means everything passed.
//
// Why this exists: the suites attach to a running server (PORT env), and a cold
// session that forgets to boot one gets ECONNREFUSED failures that look like
// code bugs but are not. `npm run verify` removes that trap entirely.
//
// Usage:  npm run verify          (or: node scripts/verify.mjs)

import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertTestContainer } from './test-container.mjs';

if (process.env.AI_DND_TEST_CONTAINER !== '1') {
  await import('./docker-verify.mjs');
  process.exit(process.exitCode ?? 1);
}
assertTestContainer();

// Also reject a second npm run verify launched via docker exec in this same
// container. The outer Docker name lock covers separate agents/worktrees.
const lockFile = '/tmp/ai-dnd-verify.lock';
let lockFd;
try { lockFd = fs.openSync(lockFile, 'wx'); }
catch (error) {
  if (error.code !== 'EEXIST') throw error;
  console.error('Full verification is already running in this test container.');
  process.exit(73);
}
process.on('exit', () => {
  fs.closeSync(lockFd);
  fs.unlinkSync(lockFile);
});

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const WIN = process.platform === 'win32';

const step = (name) => console.log(`\n=== verify: ${name} ===`);

/** Run a command, tee its output to our console while capturing it for
 *  VERIFY_ARTIFACT_DIR/last-verify.log. shell is required for npm/npx on Windows (they are
 *  .cmd shims), but MUST stay off for direct node spawns — shell splits
 *  `C:\Program Files\...node.exe` on the space. */
function run(cmd, args, { env = {}, shell = false } = {}) {
  return new Promise((resolve) => {
    const proc = spawn(cmd, args, {
      cwd: ROOT,
      stdio: ['inherit', 'pipe', 'pipe'],
      shell,
      env: { ...process.env, ...env }
    });
    let captured = '';
    const tee = (d) => { captured += d; process.stdout.write(d); };
    proc.stdout.on('data', tee);
    proc.stderr.on('data', tee);
    proc.on('close', (code) => resolve({ code: code ?? 1, output: captured }));
    proc.on('error', () => resolve({ code: 1, output: captured }));
  });
}

/** Ask the OS for a free TCP port. */
function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const port = srv.address().port;
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

/** Poll /api/health until the server answers or the budget runs out. */
async function waitHealthy(base) {
  for (let i = 0; i < 40; i++) {
    try {
      const res = await fetch(base + '/api/health');
      if (res.ok) return true;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

/** Kill the server and its whole child tree (Windows detaches children). */
function killTree(proc) {
  if (!proc || proc.exitCode != null) return;
  if (WIN) spawnSync('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { stdio: 'ignore' });
  else proc.kill('SIGTERM');
}

const port = Number(process.env.PORT) || (await freePort());
const BASE = `http://localhost:${port}`;
const results = [];
let server = null;

try {
  step('eslint');
  results.push(['eslint', await run('npm', ['run', 'lint'], { shell: WIN })]);

  step('tsc --noEmit');
  results.push(['typecheck', await run('npm', ['run', 'typecheck'], { shell: WIN })]);

  step(`boot server on ${port}`);
  server = spawn(process.execPath, ['server/index.js'], {
    cwd: ROOT,
    stdio: 'inherit',
    env: { ...process.env, PORT: String(port) }
  });
  const healthy = await waitHealthy(BASE);
  if (!healthy) throw new Error(`server never became healthy on ${BASE}`);
  console.log(`server healthy at ${BASE}`);

  step('test-all (all suites, required Chromium + WebGL2 e2e)');
  results.push(['test-all', await run(process.execPath, ['scripts/test-all.mjs'], { env: { PORT: String(port) } })]);

  step('smoke test');
  results.push(['smoke', await run(process.execPath, ['scripts/smoke-test.mjs'], { env: { PORT: String(port) } })]);
  if (Number(process.env.VERIFY_REPLAY_RUNS) > 0) {
    step('additional delve replay');
    results.push(['replay', await run(process.execPath,
      ['scripts/replay-bot.mjs', '--runs', process.env.VERIFY_REPLAY_RUNS], { env: { PORT: String(port) } })]);
  }
  if (Number(process.env.VERIFY_BALANCE_RUNS) > 0) {
    step('balance simulation');
    results.push(['balance', await run(process.execPath, ['scripts/balance-sim.mjs', process.env.VERIFY_BALANCE_RUNS])]);
  }
} catch (err) {
  console.error(`\nverify aborted: ${err.message}`);
  results.push(['boot', { code: 1, output: String(err.message) }]);
} finally {
  killTree(server);
  // Logs are separate from the temporary test data and the player's data/.
  try {
    const log = results.map(([name, r]) => `=== ${name} (exit ${r.code}) ===\n${r.output}`).join('\n\n');
    fs.writeFileSync(path.join(process.env.VERIFY_ARTIFACT_DIR, 'last-verify.log'), `verify run ${new Date().toISOString()} — port ${port}\n\n${log}\n`);
  } catch (error) {
    console.error('Failed to preserve verification log:', error.message);
    results.push(['artifacts', { code: 1, output: error.message }]);
  }
}

console.log('\n=== verify summary ===');
let failed = 0;
for (const [name, r] of results) {
  const ok = r.code === 0;
  if (!ok) failed++;
  console.log(`  ${ok ? '✔' : '✘'} ${name}${ok ? '' : ` (exit ${r.code})`}`);
}
if (results.length < 4) {
  console.log('  ✘ (not all four steps ran — see the abort message above)');
  failed++;
}
console.log(failed === 0 ? '\n🎉 VERIFY PASSED — everything is green.\n' : `\n❌ VERIFY FAILED — ${failed} step(s) red.\n`);
process.exit(failed === 0 ? 0 : 1);
