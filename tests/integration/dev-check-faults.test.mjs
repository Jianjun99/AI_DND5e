// Q1a fault-injection regression: every quick-check failure path must exit
// non-zero and never print the PASSED banner. Each case drives the REAL
// scripts/dev-check.mjs code through its container-only AI_DND_CHECK_FAULT
// seam (eslint/tsc/server/suite/artifact-save) and asserts the actual exit
// code and output — the happy path alone is not acceptance for a gate.
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertTestContainer } from '../../scripts/test-container.mjs';
assertTestContainer();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..', '..');
let passed = 0, failed = 0, assertions = 0;
function check(value, message) { assert.ok(value, message); assertions++; }
async function test(name, fn) { try { await fn(); passed++; console.log('  PASS: ' + name); } catch (error) { failed++; console.error('  FAIL: ' + name + '\n' + error.stack); } }

// Recursion guard: under `npm run check` this suite would spawn a nested full
// quick check that runs this suite again, forever. The fault regression is an
// acceptance-level suite — it runs in full under `npm run verify` (no
// AI_DND_QUICK_RUN marker) and self-skips inside any quick check.
if (process.env.AI_DND_QUICK_RUN === '1') {
  console.log('  SKIP: nested inside a quick check — the fault-injection regression runs in full verification only.');
  process.exit(0);
}

// The injected child runs while THIS suite's own outer dev-check (npm run check)
// holds the shared /tmp lock; the seam's lock override gives every child its own
// lock file. Normal `npm run check` runs never set these env vars.
function runDevCheck(fault) {
  return new Promise((resolve) => {
    const artifactDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-dnd-check-fault-'));
    const dataDir = path.join(artifactDir, 'data');
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(path.join(dataDir, 'settings.json'), JSON.stringify({ llm: { enabled: false, baseUrl: '', apiKey: '', model: '' }, portraits: { enabled: false, sdUrl: '' } }));
    const proc = spawn(process.execPath, ['scripts/dev-check.mjs'], {
      cwd: ROOT,
      env: {
        ...process.env,
        AI_DND_CHECK_FAULT: fault,
        AI_DND_TEST_CONTAINER: '1',
        AI_DND_CHECK_LOCK: path.join(artifactDir, 'check.lock'),
        DATA_DIR: dataDir,
        VERIFY_ARTIFACT_DIR: artifactDir
      },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let output = '';
    proc.stdout.on('data', d => { output += d; });
    proc.stderr.on('data', d => { output += d; });
    proc.on('error', () => resolve({ code: 1, output, artifactDir }));
    proc.on('close', code => resolve({ code: code ?? 1, output, artifactDir }));
  });
}

// On unexpected results the child's own tail is the fastest diagnosis: it carries
// the failing step/suite and the printed banner.
function childTail(r) { return '\n  child exit: ' + r.code + '\n  child tail: ' + JSON.stringify(r.output.slice(-700)); }

try {
  await test('Injected eslint failure exits non-zero and never claims PASSED', async () => {
    const r = await runDevCheck('eslint');
    check(r.code !== 0, 'non-zero exit (got ' + r.code + ')' + childTail(r));
    check(r.output.includes('QUICK CHECK FAILED') && r.output.includes('eslint'), 'fail-fast names eslint');
    check(!r.output.includes('CHECK PASSED'), 'no PASSED banner on failure');
    check(r.output.includes('fail-fast subset'), 'partial-verification banner still present');
  });

  await test('Injected tsc failure exits non-zero after eslint passed', async () => {
    const r = await runDevCheck('tsc');
    check(r.code !== 0, 'non-zero exit (got ' + r.code + ')' + childTail(r));
    check(r.output.includes('tsc failed'), 'fail-fast names tsc');
    check(!r.output.includes('CHECK PASSED'), 'no PASSED banner on failure');
  });

  await test('Injected server-boot failure exits non-zero with the fast health wait', async () => {
    const started = Date.now();
    const r = await runDevCheck('server');
    check(r.code !== 0, 'non-zero exit (got ' + r.code + ')' + childTail(r));
    check(r.output.includes('server never became healthy'), 'health failure is named');
    check(!r.output.includes('CHECK PASSED'), 'no PASSED banner on failure');
    check(Date.now() - started < 30000, 'the injected dead server fails fast, not after the full 20s wait');
  });

  await test('Injected suite failure exits non-zero and stops before later suites', async () => {
    const r = await runDevCheck('suite');
    check(r.code !== 0, 'non-zero exit (got ' + r.code + ')' + childTail(r));
    check(r.output.includes('suite injected-failure') && r.output.includes('exit 7'), 'the failing suite is reported with its exit');
    check(!r.output.includes('CHECK PASSED'), 'no PASSED banner on failure');
    check((r.output.match(/✔ /g) || []).length < 3, 'fail-fast stopped the run early');
  });

  await test('Injected evidence-save failure exits non-zero even when every test passed', async () => {
    const r = await runDevCheck('artifact-save');
    check(r.code !== 0, 'non-zero exit (got ' + r.code + ')' + childTail(r));
    check(r.output.includes('failed to preserve quick-check evidence'), 'the save failure is named');
    check(!r.output.includes('CHECK PASSED'), 'no PASSED banner when evidence was lost');
    check(r.output.includes('PARTIAL CHECK INCOMPLETE'), 'the incomplete banner is shown instead');
  });

  await test('No injection: the seam is inert and a light green run prints PASSED with partial timings', async () => {
    const r = await runDevCheck('skip-suites');
    if (r.code !== 0) console.error(childTail(r));
    check(r.code === 0, 'the unmodified quick check still passes (got ' + r.code + ')' + childTail(r));
    check(r.output.includes('PARTIAL CHECK PASSED'), 'green run prints the PASSED banner');
    const timings = JSON.parse(fs.readFileSync(path.join(r.artifactDir, 'timings.json'), 'utf8'));
    check(timings.partial === true && Array.isArray(timings.suites) && timings.suites.length === 0 && timings.steps.some(s => s.name === 'eslint' && s.exit === 0),
      'timings.json is written, marked partial, with the green eslint step recorded');
  });
} finally {
  console.log('Dev-check fault injection: ' + passed + ' cases passed, ' + failed + ' failed; ' + assertions + ' assertions.');
  process.exitCode = failed ? 1 : 0;
}
