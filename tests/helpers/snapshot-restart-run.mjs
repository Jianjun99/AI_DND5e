// tests/helpers/snapshot-restart-run.mjs
// Child process for the review R3 regression: a brand new Node process (no in-process module
// state, nothing injected into any registry) reloads a playtest save from disk and resolves the
// draft-owned definitions from the snapshot that travels with the save.
//
// Usage: node tests/helpers/snapshot-restart-run.mjs <saveId> <verdict.json> <mapId> <gearId> <monsterKind>

import fs from 'node:fs';

const require = (await import('node:module')).createRequire(import.meta.url);
const [saveId, verdictPath, mapId, gearId, monsterKind] = process.argv.slice(2);
const failures = [];
const evidence = { dataDir: process.env.DATA_DIR, steps: [] };
const step = text => evidence.steps.push(text);
const expect = (value, message) => { if (!value) { failures.push(message); throw new Error(message); } };

try {
  const store = require('../../server/store.js');
  const content = require('../../server/game/content.js');
  const contentContext = require('../../server/game/content-context.js');

  store.saveSettings({ llm: { enabled: false }, portraits: { enabled: false } });
  const save = store.getSave(saveId);
  expect(!!save, 'the playtest save is readable from disk');
  const snapshot = contentContext.ofState(save);
  expect(!!snapshot, 'the save carries its own content snapshot');
  expect(snapshot.draftId === save.ownerDraftId, 'the snapshot names the draft that owns this run');

  evidence.registryHasMap = !!content.getMap(mapId);
  evidence.registryHasGear = !!content.getGear(gearId);
  evidence.registryHasMonster = !!content.getMonster(monsterKind);
  step('shared registry: map=' + evidence.registryHasMap + ' gear=' + evidence.registryHasGear + ' monster=' + evidence.registryHasMonster);

  const map = contentContext.mapFor(snapshot, mapId);
  expect(!!map, 'the draft map resolves from the snapshot after a restart');
  evidence.mapName = map.name;
  const gear = contentContext.gearFor(snapshot, gearId);
  expect(!!gear && gear.id === gearId, 'the draft-only item resolves from the snapshot');
  evidence.gearName = gear.name;
  const monster = contentContext.monsterFor(snapshot, monsterKind);
  expect(!!monster && monster.id === monsterKind, 'the draft-only monster resolves from the snapshot');
  evidence.monsterAc = monster.ac;

  expect(evidence.registryHasGear === false, 'the draft-only item never entered the shared registry: ' + evidence.registryHasGear);
  expect(evidence.registryHasMonster === false, 'the draft-only monster never entered the shared registry: ' + evidence.registryHasMonster);
  const runtimeMonster = (save.entities || []).find(e => e.monsterId === monsterKind);
  expect(!!runtimeMonster, 'the running board still carries the draft monster entity: ' + (save.entities || []).map(e => e.monsterId).join(','));
  evidence.runtimeMonsterHp = runtimeMonster.hp;
  step('restart recovered ' + mapId + ', ' + gearId + ' and ' + monsterKind + ' from ' + saveId);
} catch (error) {
  failures.push('child crashed: ' + error.message);
  evidence.error = error.stack;
}
fs.writeFileSync(verdictPath, JSON.stringify({ ok: failures.length === 0, failures, evidence }, null, 2));
process.exitCode = failures.length ? 1 : 0;
