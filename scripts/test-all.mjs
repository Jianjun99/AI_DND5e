// scripts/test-all.mjs — Master Test Suite Runner for AI D&D 2024
// Full acceptance: every suite in the shared list, fail-slow so the summary
// keeps the complete red census. The quick partial check is scripts/dev-check.mjs.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertTestContainer } from './test-container.mjs';
import { captureBrowserArtifacts } from './cdp-artifacts.mjs';
import { testSuites } from './test-suites.mjs';

assertTestContainer();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.join(__dirname, '..');

async function runTest(suite) {
  return new Promise((resolve) => {
    const startTime = Date.now();
    const proc = spawn(process.execPath, [suite.file], {
      cwd: ROOT,
      stdio: 'inherit',
      detached: true,
      env: { ...process.env, ...(suite.env || {}) }
    });

    let timedOut = false;
    let killTimer;
    const timer = setTimeout(async () => {
      timedOut = true;
      console.error('❌ Suite timeout: ' + suite.name);
      try { await captureBrowserArtifacts('suite-timeout-' + path.basename(suite.file)); } catch (error) { console.error(error); }
      try { process.kill(-proc.pid, 'SIGTERM'); } catch {}
      killTimer = setTimeout(() => { try { process.kill(-proc.pid, 'SIGKILL'); } catch {} }, 3000);
    }, suite.timeoutMs || 180000);
    proc.on('error', error => {
      console.error('❌ Suite failed to launch: ' + suite.name, error);
    });
    proc.on('close', (code) => {
      clearTimeout(timer);
      clearTimeout(killTimer);
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
      resolve({ suite, code: timedOut ? 124 : code ?? 1, elapsed });
    });
  });
}

console.log('===============================================================');
console.log('   ⚔️  AI D&D 2024 — AUTOMATED TEST SUITE RUNNER  ⚔️');
console.log('===============================================================');

const results = [];
let overallPass = true;

for (const suite of testSuites) {
  const res = await runTest(suite);
  results.push(res);
  if (res.code !== 0) {
    overallPass = false;
  }
}

console.log('\n===============================================================');
console.log('   📊 TEST SUITE SUMMARY RESULTS');
console.log('===============================================================');

for (const r of results) {
  const icon = r.code === 0 ? '✔ PASS' : '❌ FAIL';
  console.log(`  [${icon}]  ${r.suite.name} (${r.elapsed}s)`);
}

console.log('===============================================================');

// Structured per-suite timing for the verification report (Q1): one JSON line
// of truth next to last-verify.log, consumed by verify's timings.json.
try {
  fs.writeFileSync(path.join(process.env.VERIFY_ARTIFACT_DIR || path.join(ROOT, 'artifacts'), 'suite-timings.json'), JSON.stringify({
    startedAt: new Date(Date.now() - results.reduce((sum, r) => sum + Number(r.elapsed) * 1000, 0)).toISOString(),
    totalSeconds: Number(results.reduce((sum, r) => sum + Number(r.elapsed), 0).toFixed(2)),
    suites: results.map(r => ({ id: r.suite.id, kind: r.suite.kind, name: r.suite.name, seconds: Number(r.elapsed), exit: r.code }))
  }, null, 2));
} catch (error) {
  console.error('Failed to preserve suite timings:', error.message);
  overallPass = false;
}

if (overallPass) {
  console.log('🎉 ALL TEST SUITES PASSED SUCCESSFULLY!\n');
  process.exit(0);
} else {
  console.error('💥 ONE OR MORE TEST SUITES FAILED!\n');
  process.exit(1);
}
