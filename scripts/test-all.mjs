// scripts/test-all.mjs — Master Test Suite Runner for AI D&D 2024
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertTestContainer } from './test-container.mjs';
import { captureBrowserArtifacts } from './cdp-artifacts.mjs';

assertTestContainer();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.join(__dirname, '..');

const testSuites = [
  { name: 'Verification Environment: isolation, missing browser & WebGL failure evidence', file: 'tests/integration/verification-environment.test.mjs' },
  { name: 'Unit Tests: D&D 2024 Rules Engine', file: 'tests/unit/rules.test.mjs' },
  { name: 'Unit Tests: 3D Procedural Miniatures & Walk Animations', file: 'tests/unit/models3d.test.mjs' },
  { name: 'Unit Tests: Elite Affixes & Loot Rarity', file: 'tests/unit/affixes-and-loot.test.mjs' },
  { name: 'Unit Tests: Map Board Visibility & Camera', file: 'tests/unit/map-entities.test.mjs' },
  { name: 'Unit Tests: Tavern Gambling & Experimental Brews', file: 'tests/unit/gambling-and-potions.test.mjs' },
  { name: 'Unit Tests: Forge, Bestiary & Campaign', file: 'tests/unit/forge-and-campaign.test.mjs' },
  { name: 'Unit Tests: MCP Server (stdio protocol)', file: 'tests/unit/mcp-server.test.mjs' },
  { name: 'Unit Tests: Store Schema Versioning', file: 'tests/unit/store-versioning.test.mjs' },
  { name: 'Unit Tests: Event Contract (emitted vs client vocabulary)', file: 'tests/unit/event-contract.test.mjs' },
  { name: 'Integration Tests: Content Validation & Pack Roundtrip (T8)', file: 'tests/integration/content-validation.test.mjs' },
  { name: 'Integration Tests: Remembered Encounter & Two Real Routes (T6)', file: 'tests/integration/remembered-encounter.test.mjs' },
  { name: 'Integration Tests: Delve Replay Bot (API invariants)', file: 'scripts/replay-bot.mjs', env: { REPLAY_QUICK: '1' } },
  { name: 'Integration Tests: Movement, Pathfinding & Vision', file: 'tests/integration/movement.test.mjs' },
  { name: 'Integration Tests: Combat, Actions & Health', file: 'tests/integration/combat.test.mjs' },
  { name: 'Integration Tests: Tactics (OA, Flanking, Shove)', file: 'tests/integration/tactics.test.mjs' },
  { name: 'Integration Tests: Character Progression & Delve Systems', file: 'tests/integration/progression-systems.test.mjs' },
  { name: 'Integration Tests: State Updates & AI Persistence (T2)', file: 'tests/integration/state-and-ai.test.mjs' },
  { name: 'Integration Tests: One Settlement & Return to Town (T3)', file: 'tests/integration/settlement.test.mjs' },
  { name: 'Integration Tests: Unified Server Checks & Road Encounters (T7)', file: 'tests/integration/server-checks.test.mjs' },
  { name: 'Integration Tests: Quick Start Presets & Creation (T5)', file: 'tests/integration/quick-start.test.mjs' },
  { name: 'End-to-End Tests: Browser 3D Rendering & Movement (CDP)', file: 'tests/e2e/browser-movement-cdp.test.mjs' },
  { name: 'End-to-End Tests: Turn Economy, Minimap & Cleared Beacon (CDP)', file: 'tests/e2e/gameplay-refinements-cdp.test.mjs' },
  { name: 'End-to-End Tests: Device Adaptation, phone & tablet (CDP)', file: 'tests/e2e/responsive-cdp.test.mjs' },
  { name: 'End-to-End Tests: Quick Start & First-Delve Tutorial (CDP)', file: 'tests/e2e/quick-start-cdp.test.mjs' },
  { name: 'End-to-End Tests: Road Lifecycle & Check Previews (CDP)', file: 'tests/e2e/t7a-road-lifecycle-cdp.test.mjs' },
  { name: 'End-to-End Tests: Remembered Encounter Both Routes (CDP)', file: 'tests/e2e/remembered-encounter-cdp.test.mjs' }
];

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
    }, 180000);
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

if (overallPass) {
  console.log('🎉 ALL TEST SUITES PASSED SUCCESSFULLY!\n');
  process.exit(0);
} else {
  console.error('💥 ONE OR MORE TEST SUITES FAILED!\n');
  process.exit(1);
}
