// tests/unit/store-versioning.test.mjs — save schema versioning.
// Runs the store against a throwaway DATA_DIR (set before require) so real
// player data is never touched: legacy saves migrate, writes stamp the version,
// future-versioned objects pass through untouched.
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (!condition) {
    console.error(`  ❌ FAILED: ${message}`);
    failed++;
    throw new Error(message);
  }
  passed++;
}

function test(name, fn) {
  const before = failed;
  try {
    fn();
    console.log(`  ✔ PASS: ${name}`);
  } catch (err) {
    if (failed === before) failed++;
    console.error(`  ❌ FAILED: ${name} — ${err && (err.stack || err.message)}`);
  }
}

const tmpData = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-dnd-store-test-'));
process.env.DATA_DIR = tmpData;
const store = createRequire(import.meta.url)('../../server/store.js');

try {
  test('Legacy (unversioned) objects migrate and gain saveVersion', () => {
    const legacy = { id: 'char_1', name: 'Old Hero', gold: 50 };
    const out = store.migrateSave(legacy, 'character');
    assert(out.saveVersion === store.SAVE_VERSION, `stamped to SAVE_VERSION ${store.SAVE_VERSION}`);
    assert(out.name === 'Old Hero' && out.gold === 50, 'fields intact after migration');
  });

  test('Current-version objects pass through unchanged', () => {
    const current = { id: 'save_x', saveVersion: store.SAVE_VERSION, hp: 10 };
    const out = store.migrateSave(current, 'delve');
    assert(out === current, 'same object returned, no re-stamping surprises');
  });

  test('Newer-version objects are left untouched (forward compatibility)', () => {
    const future = { id: 'save_y', saveVersion: store.SAVE_VERSION + 5, custom: true };
    const out = store.migrateSave(future, 'delve');
    assert(out.saveVersion === store.SAVE_VERSION + 5, 'future version preserved');
    assert(out.custom === true, 'fields preserved');
  });

  test('saveGame stamps saveVersion and getSave migrates a hand-written legacy file', () => {
    const state = { id: 'save_test_1', characterId: 'c1', mapId: 'crypt', hp: 5 };
    store.saveGame(state);
    const onDisk = JSON.parse(fs.readFileSync(path.join(tmpData, 'saves', 'save_test_1.json'), 'utf8'));
    assert(onDisk.saveVersion === store.SAVE_VERSION, 'written save carries saveVersion');

    // simulate a legacy save file written before versioning existed
    const legacyState = { id: 'save_test_2', characterId: 'c1', mapId: 'crypt' };
    fs.writeFileSync(path.join(tmpData, 'saves', 'save_test_2.json'), JSON.stringify(legacyState), 'utf8');
    const loaded = store.getSave('save_test_2');
    assert(loaded.saveVersion === store.SAVE_VERSION, 'legacy save migrates on read');
    assert(loaded.mapId === 'crypt', 'legacy save fields intact');
  });

  test('saveCharacters stamps every roster entry', () => {
    store.saveCharacters([{ id: 'char_a', name: 'A' }, { id: 'char_b', name: 'B' }]);
    const list = store.getCharacters();
    assert(list.every((c) => c.saveVersion === store.SAVE_VERSION), 'every roster entry versioned');
  });
} finally {
  fs.rmSync(tmpData, { recursive: true, force: true });
}

console.log('\n--- Running Unit Tests: Store Schema Versioning ---');
console.log(`\nStore Versioning Unit Tests Summary: ${passed} passed, ${failed} failed.`);
if (failed > 0) process.exit(1);
