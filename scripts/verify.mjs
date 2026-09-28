// scripts/verify.mjs — one-command full verification for humans and AI agents.
//
// Boots the game server on a free port, then runs eslint → tsc → all 13 test
// suites → the smoke test against that server, and tears the server down in a
// finally block. Exit code 0 means everything passed.
//
// Why this exists: the suites attach to a running server (PORT env), and a cold
// session that forgets to boot one gets ECONNREFUSED failures that look like
// code bugs but are not. `npm run verify` removes that trap entirely.
//
// Usage:  npm run verify          (or: node scripts/verify.mjs)
//         PORT=3200 npm run verify   (force a specific port)

import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const WIN = process.platform === 'win32';

const step = (name) => console.log(`\n=== verify: ${name} ===`);

/** Run a command, tee its output to our console while capturing it for
 *  data/last-verify.log. shell is required for npm/npx on Windows (they are
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

  step('test-all (17 suites, incl. 3 headless-browser e2e)');
  results.push(['test-all', await run(process.execPath, ['scripts/test-all.mjs'], { env: { PORT: String(port) } })]);

  step('smoke test');
  results.push(['smoke', await run(process.execPath, ['scripts/smoke-test.mjs'], { env: { PORT: String(port) } })]);
} catch (err) {
  console.error(`\nverify aborted: ${err.message}`);
  results.push(['boot', { code: 1, output: String(err.message) }]);
} finally {
  killTree(server);
  // persist the full transcript for the MCP recent_failures tool (data/ is gitignored)
  try {
    const log = results.map(([name, r]) => `=== ${name} (exit ${r.code}) ===\n${r.output}`).join('\n\n');
    fs.writeFileSync(path.join(ROOT, 'data', 'last-verify.log'), `verify run ${new Date().toISOString()} — port ${port}\n\n${log}\n`);
  } catch { /* data/ missing in fresh checkouts — non-fatal */ }
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
