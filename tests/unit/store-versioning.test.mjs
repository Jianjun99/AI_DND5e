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

  test('Legacy end-mode delves without endSeq gain the #1 baseline on read (T3a)', () => {
    const ended = { id: 'save_old_dead', mode: 'over', characterId: 'c1' };
    const out = store.migrateSave(ended, 'delve');
    assert(out.endSeq === 1, `a legacy ended delve baselines endSeq=1 (got ${out.endSeq})`);
    for (const mode of ['victory', 'retreat']) {
      const other = store.migrateSave({ id: 'save_old_' + mode, mode, characterId: 'c1' }, 'delve');
      assert(other.endSeq === 1, `a legacy ${mode} delve baselines endSeq=1`);
    }
    const running = store.migrateSave({ id: 'save_running', mode: 'explore', characterId: 'c1' }, 'delve');
    assert(running.endSeq === undefined, 'a running delve is not stamped — its first end must be #1');
    const counted = store.migrateSave({ id: 'save_counted', mode: 'retreat', endSeq: 3, characterId: 'c1' }, 'delve');
    assert(counted.endSeq === 3, 'an existing counter is never touched');
    const character = store.migrateSave({ id: 'char_x', mode: 'over' }, 'character');
    assert(character.endSeq === undefined, 'the baseline only applies to delve saves');
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

// ---- fixture corpus: representative pre-versioning shapes, kept on disk so every
// future migration step can be asserted against real old data (add yours here) ----
import { fileURLToPath } from 'node:url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.join(__dirname, '..', 'fixtures', 'saves');
for (const fixtureFile of fs.readdirSync(FIXTURES_DIR).filter((f) => f.endsWith('.json')).sort()) {
  const kind = fixtureFile.includes('character') ? 'character' : 'delve';
  const original = JSON.parse(fs.readFileSync(path.join(FIXTURES_DIR, fixtureFile), 'utf8'));

  test(`fixture ${fixtureFile}: migration preserves every original field and stamps the version`, () => {
    const out = store.migrateSave(JSON.parse(JSON.stringify(original)), kind);
    assert(out.saveVersion === store.SAVE_VERSION, `stamped to SAVE_VERSION ${store.SAVE_VERSION}`);
    for (const [key, value] of Object.entries(original)) {
      assert(JSON.stringify(out[key]) === JSON.stringify(value), `field '${key}' survives migration untouched`);
    }
  });

  test(`fixture ${fixtureFile}: the real store round-trips it end to end`, () => {
    const tmpData2 = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-dnd-store-fixture-'));
    try {
      // a fresh store instance rooted at the throwaway dir (cache-busted so
      // DATA_DIR is re-read), with the fixture written RAW — the migration
      // under test happens on the READ path, exactly like a real old save
      const prevData = process.env.DATA_DIR;
      process.env.DATA_DIR = tmpData2;
      const req = createRequire(import.meta.url);
      const storePath = req.resolve('../../server/store.js');
      delete req.cache[storePath];
      const localStore = req('../../server/store.js');
      if (kind === 'character') {
        fs.writeFileSync(path.join(tmpData2, 'characters.json'), JSON.stringify([original]), 'utf8');
        const loaded = localStore.getCharacters();
        assert(loaded.length === 1 && loaded[0].saveVersion === store.SAVE_VERSION, 'roster read migrates');
        assert(loaded[0].name === original.name, 'character data intact');
      } else {
        fs.mkdirSync(path.join(tmpData2, 'saves'), { recursive: true });
        fs.writeFileSync(path.join(tmpData2, 'saves', original.id + '.json'), JSON.stringify(original), 'utf8');
        const loaded = localStore.getSave(original.id);
        assert(loaded.saveVersion === store.SAVE_VERSION, 'delve read migrates');
        assert(loaded.mode === original.mode && loaded.mapId === original.mapId, 'delve data intact');
      }
      delete req.cache[storePath]; // don't leave the throwaway-dir store cached
      if (prevData === undefined) delete process.env.DATA_DIR; else process.env.DATA_DIR = prevData;
    } finally {
      fs.rmSync(tmpData2, { recursive: true, force: true });
    }
  });
}

console.log('\n--- Running Unit Tests: Store Schema Versioning ---');
console.log(`\nStore Versioning Unit Tests Summary: ${passed} passed, ${failed} failed.`);
if (failed > 0) process.exit(1);
