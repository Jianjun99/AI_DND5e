// scripts/dev-check.mjs — the quick PARTIAL development check (container-side).
//
// eslint → tsc → every unit and integration suite, stopping at the first red
// step. Browser (CDP) suites never run unless explicitly selected with
// `npm run check -- --browsers=<id,...>`; `npm run check -- --list` prints the
// available ids. This is NOT acceptance: no smoke test, no full screenshot
// rounds, no red census — `npm run verify` remains the only full gate.
//
// Exit code contract (Q1a): EVERY failure path — eslint, tsc, server boot,
// any suite, or the evidence/timings save — exits non-zero and never prints
// the PASSED banner. Only a fully green run with preserved evidence exits 0.
//
// Shares verify's in-container rules: the same lock file (one runner per
// container), the dedicated test container's isolation (assertTestContainer),
// an isolated DATA_DIR written by the entrypoint, and the artifact directory.
// Suites come from the shared scripts/test-suites.mjs table, so the two
// entrances cannot drift.
//
// Fault-injection seam (Q1a, container-only): the regression suite
// tests/integration/dev-check-faults.test.mjs drives every failure path through
// the real code by setting AI_DND_CHECK_FAULT=<eslint|tsc|server|suite|artifact-save|skip-suites>.
// `skip-suites` is the trivially-green scenario (no suites, evidence saved) that lets
// the regression assert the exit-0/PASSED path in seconds. The seam exists solely
// inside the test container and is inert otherwise.

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertTestContainer } from './test-container.mjs';
import { testSuites, browserSuites } from './test-suites.mjs';

assertTestContainer();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const WIN = process.platform === 'win32';
const artifactDir = process.env.VERIFY_ARTIFACT_DIR || '/test-artifacts';
fs.mkdirSync(artifactDir, { recursive: true });

// Test-only fault injection: accepted only inside the dedicated test container.
const fault = process.env.AI_DND_CHECK_FAULT || '';
const inject = kind => fault === kind;

const args = process.argv.slice(2);
if (args.includes('--list')) {
  console.log('Browser suite ids for `npm run check -- --browsers=<id,...>`:');
  for (const suite of browserSuites) console.log('  ' + suite.id.padEnd(26) + suite.file);
  process.exit(0);
}
const browserArg = args.find(arg => arg.startsWith('--browsers='));
const wanted = browserArg ? browserArg.slice('--browsers='.length).split(',').map(id => id.trim()).filter(Boolean) : [];
const unknown = wanted.filter(id => !browserSuites.some(suite => suite.id === id));
if (unknown.length) {
  console.error('Unknown browser suite id(s): ' + unknown.join(', '));
  console.error('Run `npm run check -- --list` for the available ids.');
  process.exit(2);
}
const selectedBrowsers = browserSuites.filter(suite => wanted.includes(suite.id));

// One runner per container, same lock file as the full verification: a quick
// check and a full verify can never interleave inside the same container.
// AI_DND_CHECK_LOCK belongs to the container-only fault seam (the regression
// suite spawns nested dev-checks, each with its own lock); official runs never
// set it and always take the shared lock.
const lockFile = process.env.AI_DND_CHECK_LOCK || '/tmp/ai-dnd-verify.lock';
let lockFd;
try { lockFd = fs.openSync(lockFile, 'wx'); }
catch (error) {
  if (error.code !== 'EEXIST') throw error;
  console.error('Another verification (full or quick) is already running in this test container.');
  process.exit(73);
}
process.on('exit', () => {
  fs.closeSync(lockFd);
  fs.unlinkSync(lockFile);
});

const runStart = Date.now();
// Marker for suites spawned by this run: lets the fault-injection regression
// detect that it is nested inside a quick check and skip itself (no recursion).
process.env.AI_DND_QUICK_RUN = '1';
const timings = { kind: 'quick-check', partial: true, startedAt: new Date().toISOString(), buildSeconds: null, steps: [], suites: [], screenshots: null, cleanupSeconds: null, totalSeconds: null };
const banner = () => console.log('\n⚠️  QUICK DEV CHECK — PARTIAL VERIFICATION: fail-fast subset, NO smoke test and NOT an acceptance run. `npm run verify` is the only full gate.\n');
banner();
console.log('Selected browser suites: ' + (selectedBrowsers.length ? selectedBrowsers.map(s => s.id).join(', ') : '(none — default quick check)') + '\n');

function run(cmd, args, { env = {}, shell = false } = {}) {
  return new Promise((resolve) => {
    const started = Date.now();
    const proc = spawn(cmd, args, { cwd: ROOT, stdio: ['inherit', 'pipe', 'pipe'], shell, env: { ...process.env, ...env } });
    let captured = '';
    const tee = (d) => { captured += d; process.stdout.write(d); };
    proc.stdout.on('data', tee);
    proc.stderr.on('data', tee);
    proc.on('close', (code) => resolve({ code: code ?? 1, output: captured, elapsed: (Date.now() - started) / 1000 }));
    proc.on('error', () => resolve({ code: 1, output: captured, elapsed: (Date.now() - started) / 1000 }));
  });
}

// A command that always exits non-zero — the injected stand-in for a red step.
const failingCommand = ['node', ['-e', 'process.exit(3)']];

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => { const port = srv.address().port; srv.close(() => resolve(port)); });
    srv.on('error', reject);
  });
}

async function waitHealthy(base, attempts = 40) {
  for (let i = 0; i < attempts; i++) {
    try { const res = await fetch(base + '/api/health'); if (res.ok) return true; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

function killTree(proc) {
  if (!proc || proc.exitCode != null) return;
  if (WIN) spawn('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { stdio: 'ignore' });
  else proc.kill('SIGTERM');
}

function runSuite(suite) {
  return new Promise((resolve) => {
    const started = Date.now();
    const proc = spawn(process.execPath, [suite.file], {
      cwd: ROOT, stdio: 'inherit', detached: true,
      env: { ...process.env, ...(suite.env || {}) }
    });
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; console.error('❌ Suite timeout: ' + suite.name); try { process.kill(-proc.pid, 'SIGTERM'); } catch {} }, suite.timeoutMs || 180000);
    proc.on('error', () => {});
    proc.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code: timedOut ? 124 : code ?? 1, elapsed: (Date.now() - started) / 1000, timedOut });
    });
  });
}

// Count PNG screenshot files created by this run so far (browser suites only).
const screenshotsAt = () => {
  const dir = path.join(artifactDir, 'screenshots');
  try {
    return fs.readdirSync(dir).filter(f => f.endsWith('.png') && fs.statSync(path.join(dir, f)).mtimeMs >= runStart).length;
  } catch { return 0; }
};

let server = null;
let failure = null; // every failure path lands here: the run exits non-zero
const note = (name, result) => timings.steps.push({ name, seconds: Number(result.elapsed.toFixed(2)), exit: result.code });
const fail = (message) => { if (!failure) failure = message; console.error('\n❌ QUICK CHECK FAILED: ' + message); };

try {
  // eslint and tsc run for real; the seam only swaps the command when injecting.
  const lintResult = inject('eslint')
    ? await run(...failingCommand)
    : await run('npm', ['run', 'lint'], { shell: WIN });
  note('eslint', lintResult);
  if (lintResult.code !== 0) throw new Error('eslint failed — quick check stops here (fail-fast)');
  const typeResult = inject('tsc')
    ? await run(...failingCommand)
    : await run('npm', ['run', 'typecheck'], { shell: WIN });
  note('typecheck', typeResult);
  if (typeResult.code !== 0) throw new Error('tsc failed — quick check stops here (fail-fast)');

  // Seam children must NOT inherit the caller's PORT (a nested quick check would
  // otherwise attach to the outer run's server); they always pick a fresh port.
  const port = (process.env.AI_DND_CHECK_LOCK ? 0 : Number(process.env.PORT)) || (await freePort());
  const BASE = `http://localhost:${port}`;
  const bootStart = Date.now();
  if (inject('server')) {
    // A stand-in that dies immediately: the health wait must fail, quickly.
    server = spawn('node', ['-e', 'process.exit(5)'], { cwd: ROOT, stdio: 'ignore', env: { ...process.env, PORT: String(port) } });
  } else {
    server = spawn(process.execPath, ['server/index.js'], { cwd: ROOT, stdio: 'inherit', env: { ...process.env, PORT: String(port) } });
  }
  process.env.PORT = String(port); // suites read the booted server exactly like test-all does
  const healthy = await waitHealthy(BASE, inject('server') ? 4 : 40);
  timings.steps.push({ name: 'server-boot', seconds: Number(((Date.now() - bootStart) / 1000).toFixed(2)), exit: healthy ? 0 : 1 });
  if (!healthy) throw new Error(`server never became healthy on ${BASE}`);
  console.log(`server healthy at ${BASE}`);

  let quickSuites = [...testSuites.filter(s => s.kind === 'unit'), ...testSuites.filter(s => s.kind === 'integration'), ...selectedBrowsers];
  if (inject('suite')) {
    // A stand-in suite file that exits 7: drives the real spawn/fail-fast path.
    const fake = path.join(artifactDir, 'injected-failing-suite.mjs');
    fs.writeFileSync(fake, "process.exit(7);\n");
    quickSuites = [{ id: 'injected-failure', kind: 'integration', name: 'Injected failing suite (fault seam)', file: fake }];
  }
  if (inject('artifact-save')) {
    // Skip the suites and pre-create the save target as a DIRECTORY: writing to it
    // fails with EISDIR — a real, deterministic evidence-save failure.
    quickSuites = [];
    fs.mkdirSync(path.join(artifactDir, 'screenshots'), { recursive: true });
  }
  if (inject('skip-suites')) {
    // Trivially-green scenario: no suites, evidence still written and PASSED shown.
    quickSuites = [];
  }

  for (const suite of quickSuites) {
    const result = await runSuite(suite);
    const entry = { id: suite.id, kind: suite.kind, name: suite.name, seconds: Number(result.elapsed.toFixed(2)), exit: result.code };
    timings.suites.push(entry);
    if (selectedBrowsers.includes(suite)) timings.screenshots = screenshotsAt();
    if (result.code !== 0) {
      fail(`suite failed (fail-fast): ${suite.name} — fix it, then re-run 'npm run check'`);
      break;
    }
    console.log(`  ✔ ${suite.id} (${entry.seconds}s)`);
  }
} catch (error) {
  fail(error.message);
} finally {
  const cleanupStarted = Date.now();
  killTree(server);
  timings.cleanupSeconds = Number(((Date.now() - cleanupStarted) / 1000).toFixed(2));
  timings.totalSeconds = Number(((Date.now() - runStart) / 1000).toFixed(2));
  banner();
  if (timings.screenshots != null) console.log(`screenshots this run: ${timings.screenshots}`);
  console.log('timings (structured):');
  for (const step of timings.steps) console.log(`  ${step.name}: ${step.seconds}s (exit ${step.exit})`);
  for (const suite of timings.suites) console.log(`  suite ${suite.id} [${suite.kind}]: ${suite.seconds}s (exit ${suite.exit})`);
  console.log(`cleanup: ${timings.cleanupSeconds}s; total: ${timings.totalSeconds}s`);
  // Evidence save: a directory target from the artifact-save injection fails for real.
  try {
    // The artifact-save injection points this at a directory: a real save failure.
    const timingsFile = inject('artifact-save') ? path.join(artifactDir, 'screenshots') : path.join(artifactDir, 'timings.json');
    fs.writeFileSync(timingsFile, JSON.stringify(timings, null, 2));
    if (!inject('artifact-save')) fs.appendFileSync(path.join(artifactDir, 'dev-check.log'), JSON.stringify(timings) + '\n');
  } catch (error) {
    fail('failed to preserve quick-check evidence: ' + error.message);
  }
  if (!failure) {
    console.log('⚠️  PARTIAL CHECK PASSED — development signal only, NOT acceptance. Run `npm run verify` for the full gate.');
  } else {
    console.log('⚠️  PARTIAL CHECK INCOMPLETE — this is NOT a verification result. Run `npm run verify` for acceptance.');
  }
  // Any failure — steps, suites, or the evidence save — leaves a non-zero exit.
  if (failure) process.exitCode = 1;
}
