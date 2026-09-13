// scripts/test-all.mjs — Master Test Suite Runner for AI D&D 2024
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.join(__dirname, '..');

const testSuites = [
  { name: 'Unit Tests: D&D 2024 Rules Engine', file: 'tests/unit/rules.test.mjs' },
  { name: 'Unit Tests: 3D Procedural Miniatures & Walk Animations', file: 'tests/unit/models3d.test.mjs' },
  { name: 'Integration Tests: Movement, Pathfinding & Vision', file: 'tests/integration/movement.test.mjs' },
  { name: 'Integration Tests: Combat, Actions & Health', file: 'tests/integration/combat.test.mjs' },
  { name: 'Integration Tests: Character Progression & Delve Systems', file: 'tests/integration/progression-systems.test.mjs' },
  { name: 'End-to-End Tests: Browser 3D Rendering & Movement (CDP)', file: 'tests/e2e/browser-movement-cdp.test.mjs' }
];

async function runTest(suite) {
  return new Promise((resolve) => {
    const startTime = Date.now();
    const proc = spawn('node', [suite.file], {
      cwd: ROOT,
      stdio: 'inherit',
      env: { ...process.env }
    });

    proc.on('close', (code) => {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
      resolve({ suite, code, elapsed });
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

if (overallPass) {
  console.log('🎉 ALL TEST SUITES PASSED SUCCESSFULLY!\n');
  process.exit(0);
} else {
  console.error('💥 ONE OR MORE TEST SUITES FAILED!\n');
  process.exit(1);
}
