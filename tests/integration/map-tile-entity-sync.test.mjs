// tests/integration/map-tile-entity-sync.test.mjs
// Review R8: a door is its tile. The editor used to move the entity and leave the grid alone, so
// an export carried a door standing on plain floor next to a stranded 'D' glyph, and the shipped
// validator called that map fine. Here the validator, the draft pipeline and the real engine walk
// are asserted together: consistent edits play, contradictory edits are refused.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { assertTestContainer } from '../../scripts/test-container.mjs';
import { walkTo } from '../helpers/dual-chapter-run.mjs';

assertTestContainer();
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-dnd-r8-'));
process.env.DATA_DIR = temp;

const require = createRequire(import.meta.url);
const express = require('express');
const store = require('../../server/store.js');
const engine = require('../../server/game/engine.js');
const content = require('../../server/game/content.js');
const author = require('../../server/game/content-authoring.js');
const presentation = require('../../server/game/presentation.js');

store.saveSettings({ llm: { enabled: false }, portraits: { enabled: false } });

let passed = 0, failed = 0, assertions = 0;
function check(value, message) { assert.ok(value, message); assertions++; }
async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log('  PASS: ' + name);
  } catch (error) {
    failed++;
    console.error('  FAIL: ' + name + '\n' + error.stack);
  }
}

const app = express();
app.use(express.json({ limit: '12mb' }));
app.use(require('../../server/locale.js').localeMiddleware);
app.use(presentation.middleware);
for (const name of ['game', 'city', 'characters', 'content']) app.use('/api/' + name, require('../../server/routes/' + name + '.js'));
const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
const base = 'http://127.0.0.1:' + server.address().port;

async function api(method, url, body) {
  const r = await fetch(base + url, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-Game-Locale': 'en' },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch { json = text; }
  return { status: r.status, body: json };
}
const ctx = { api, store, engine, assert: check, log: () => {} };

const setTile = (map, x, y, glyph) => { map.rows[y] = map.rows[y].substring(0, x) + glyph + map.rows[y].substring(x + 1); };
const errorCodes = validation => validation.diagnostics.filter(d => d.severity === 'error').map(d => d.code + '@' + d.field);

// A cloned starter chapter, so the fixture is a real authored pack rather than a hand wave.
const clone = author.cloneStarterTemplate({ slug: 'review_map_sync', name: 'Map Sync Draft' });
const draftId = clone.draftId;
const doorEntityId = draftId + '_bridge';
const draft = () => structuredClone(author.getDraft(draftId).draft);
const ch1 = bundle => bundle.maps[0];

console.log('--- Review R8 Map Tile & Entity Consistency Tests ---');

await test('the validator refuses a door entity that is not standing on a door tile', () => {
  const bundle = draft();
  check(content.validateBundle(bundle).ok === true, 'the untouched clone validates: ' + errorCodes(content.validateBundle(bundle)).join(', '));
  const map = ch1(bundle);
  const door = map.entities.find(e => e.id === doorEntityId);
  check(door.x === 8 && door.y === 7 && map.rows[7][8] === 'D', 'the starter bridge really is a door on a door tile');

  // The exact broken edit the review reproduced: the marker moves, the grid does not.
  door.x = 7; door.y = 5;
  const broken = content.validateBundle(bundle);
  check(broken.ok === false, 'an entity-only move is not accepted as valid content');
  check(errorCodes(broken).some(code => code.startsWith('door-tile-mismatch')), 'the diagnostic names the tile mismatch: ' + errorCodes(broken).join(', '));

  // The correct editor behaviour: old glyph cleared, new glyph written, entity moved.
  const fixed = draft();
  const fmap = ch1(fixed);
  const fdoor = fmap.entities.find(e => e.id === doorEntityId);
  setTile(fmap, 8, 7, '.');
  setTile(fmap, 7, 5, 'D');
  fdoor.x = 7; fdoor.y = 5;
  const fixedResult = content.validateBundle(fixed);
  check(fixedResult.ok === true, 'a synced move validates clean: ' + errorCodes(fixedResult).join(', '));
  check(fmap.rows[5][7] === 'D' && fmap.rows[7][8] !== 'D', 'the grid now agrees with the entity');
});

await test('a doorframe glyph without an entity stays legal, a missing referenced door does not', () => {
  const bundle = draft();
  const map = ch1(bundle);
  setTile(map, 4, 1, 'D');
  const decorated = content.validateBundle(bundle);
  check(decorated.ok === true, 'a decorative D glyph needs no entity: ' + errorCodes(decorated).join(', '));

  const removed = draft();
  const rmap = ch1(removed);
  rmap.entities = rmap.entities.filter(e => e.id !== doorEntityId);
  const missing = content.validateBundle(removed);
  check(missing.ok === false, 'deleting a scene-referenced door is an error, not a repaint');
  check(JSON.stringify(missing.diagnostics).includes('doorId'), 'and the diagnostic points at the scene reference: ' + errorCodes(missing).join(', '));
});

await test('an inconsistent map cannot be exported, installed or played', async () => {
  const broken = draft();
  ch1(broken).entities.find(e => e.id === doorEntityId).x = 7;
  const saved = await api('PUT', '/api/content/drafts/' + draftId, { draft: broken });
  check(saved.status === 200, 'the half-broken draft still saves so the author can fix it');
  check(saved.body.validation.ok === false, 'and is reported as broken');
  const exported = await api('GET', '/api/content/drafts/' + draftId + '/export');
  check(exported.status === 400, 'export refuses contradictory map data: ' + exported.status);
  const installed = await api('POST', '/api/content/drafts/' + draftId + '/install');
  check(installed.status === 400, 'install refuses it too');
  const preview = await api('POST', '/api/content/drafts/' + draftId + '/playtest');
  check(preview.status === 400, 'playtest refuses it too');
  check(!content.getMap(draftId + '_ch1'), 'nothing about it entered the shared registry');

  const repaired = draft();
  const map = ch1(repaired);
  const door = map.entities.find(e => e.id === doorEntityId);
  setTile(map, door.x, door.y, 'D');
  setTile(map, 8, 7, '.');
  const fixedSave = await api('PUT', '/api/content/drafts/' + draftId, { draft: repaired });
  check(fixedSave.body.validation.ok === true, 'the repaired draft validates: ' + errorCodes(fixedSave.body.validation).join(', '));
  const nowPlayable = await api('POST', '/api/content/drafts/' + draftId + '/playtest');
  check(nowPlayable.status === 200 && nowPlayable.body.saveId, 'and only then is it playable: ' + nowPlayable.status);
  await api('POST', '/api/content/drafts/' + draftId + '/playtest/exit', { saveId: nowPlayable.body.saveId });
});

/** Relocate the bridge door up the wall, the way the editor does: glyph and entity together. The
 *  old crossing is sealed behind, so the relocated door is the only way past the wall. */
async function relocatedDoorDraft() {
  const moved = draft();
  const map = ch1(moved);
  const door = map.entities.find(e => e.id === doorEntityId);
  setTile(map, 8, 7, '#');
  setTile(map, 8, 5, 'D');
  door.x = 8; door.y = 5;
  const saved = await api('PUT', '/api/content/drafts/' + draftId, { draft: moved });
  check(saved.body.validation.ok === true, 'the relocated door validates: ' + errorCodes(saved.body.validation).join(', '));
  return moved;
}

async function armedPlaytest() {
  const preview = await api('POST', '/api/content/drafts/' + draftId + '/playtest', { difficulty: 'normal' });
  check(preview.status === 200, 'the moved-door chapter is playable: ' + preview.status + ' ' + JSON.stringify(preview.body).slice(0, 200));
  // Survivability only: the bridge guard may wake up while the hero walks, and this regression is
  // about the doorway, not about attack rolls.
  const armed = store.getSave(preview.body.saveId);
  const self = engine.playerEntity(armed);
  self.hp = self.hpMax = 9999;
  store.saveGame(armed);
  return preview.body.saveId;
}

await test('a relocated door seals its new tile while it is still closed', async () => {
  await relocatedDoorDraft();
  const saveId = await armedPlaytest();
  const beforeToll = store.getSave(saveId);
  check(beforeToll.map.rows[7][8] === '#', 'the old crossing is sealed behind the move: ' + beforeToll.map.rows[7][8]);
  check(beforeToll.map.rows[5][8] === 'D', 'the new tile is the door: ' + beforeToll.map.rows[5][8]);
  check(!beforeToll.entities.some(e => e.type === 'door' && e.x === 8 && e.y === 7), 'no door entity is stranded at the old crossing');
  check(beforeToll.objects.some(o => o.id === doorEntityId && o.x === 8 && o.y === 5), 'the runtime door stands at its new coordinates');

  await walkTo(ctx, saveId, 7, 5);
  const blocked = await api('POST', '/api/game/' + saveId + '/action', { type: 'move', x: 8, y: 5 });
  check(blocked.status === 200, 'the move answered');
  const stuckAt = engine.playerEntity(store.getSave(saveId));
  check(!(stuckAt.x === 8 && stuckAt.y === 5), 'the closed door at its new place still blocks the way: hero at ' + stuckAt.x + ',' + stuckAt.y);
  await api('POST', '/api/content/drafts/' + draftId + '/playtest/exit', { saveId });
});

await test('the scene toll opens the relocated door and the hero crosses it', async () => {
  await relocatedDoorDraft();
  const saveId = await armedPlaytest();

  const iris = store.getSave(saveId).entities.find(e => e.npcId === 'iris' || e.id === 'iris');
  await walkTo(ctx, saveId, iris.x, iris.y - 1);
  const crossing = store.getSave(saveId).map.scenes.find(s => s.id === draftId + '_crossing');
  const toll = await api('POST', '/api/game/' + saveId + '/action', { type: 'sceneChoice', sceneId: crossing.id, choiceId: 'pay_toll' });
  check(toll.status === 200, 'the toll request answered: ' + toll.status);
  const opened = (store.getSave(saveId).objects || []).find(o => o.id === doorEntityId);
  check(!!opened && opened.open === true, 'the relocated door is the one that opened: ' + JSON.stringify(opened).slice(0, 180) + ' events ' + JSON.stringify(toll.body.events).slice(0, 400));
  check(opened.x === 8 && opened.y === 5, 'and it is at its new coordinates');

  await walkTo(ctx, saveId, 9, 5);
  const beyond = engine.playerEntity(store.getSave(saveId));
  check(beyond.x >= 9 && beyond.y === 5, 'the hero walks through the doorway at its new place: ' + beyond.x + ',' + beyond.y);
  await api('POST', '/api/content/drafts/' + draftId + '/playtest/exit', { saveId });
});

await test('installing the moved-door pack keeps the grid and the entity in step', async () => {
  const moved = await relocatedDoorDraft();
  check(ch1(moved).entities.find(e => e.id === doorEntityId).y === 5, 'the draft really carries the relocated door');
  const installed = await api('POST', '/api/content/drafts/' + draftId + '/install');
  check(installed.status === 200 && installed.body.ok, 'the pack installed: ' + JSON.stringify(installed.body).slice(0, 200));
  const published = content.getMap(draftId + '_ch1');
  const publishedDoor = published.entities.find(e => e.id === doorEntityId);
  check(published.rows[publishedDoor.y][publishedDoor.x] === 'D', 'the installed map keeps the door on its tile');
  check(published.rows[7][8] !== 'D', 'and no stranded glyph at the old crossing');

  const exported = await api('GET', '/api/content/pack/' + draftId + '/export');
  check(exported.status === 200, 'the installed pack exports: ' + exported.status);
  const roundtrip = content.validateBundle(exported.body);
  check(roundtrip.ok === true, 'the export validates as a bundle: ' + errorCodes(roundtrip).join(', '));
  const exportedDoor = exported.body.maps[0].entities.find(e => e.id === doorEntityId);
  check(exported.body.maps[0].rows[exportedDoor.y][exportedDoor.x] === 'D', 'the exported grid matches the exported entity');
  await api('DELETE', '/api/content/pack/' + draftId);
  check(!content.reload().maps[draftId + '_ch1'], 'and the pack can be removed again');
});

await test('scene references survive a move because the entity keeps its id', () => {
  const moved = draft();
  const map = ch1(moved);
  const door = map.entities.find(e => e.id === doorEntityId);
  const scene = map.scenes.find(s => s.doorId === doorEntityId);
  check(!!scene, 'a scene references the bridge door');
  const guardIds = scene.guardIds || [];
  check(guardIds.length > 0, 'and names the guards standing with it: ' + guardIds.join(', '));
  setTile(map, door.x, door.y, '.');
  setTile(map, 3, 3, 'D');
  door.x = 3; door.y = 3;
  const result = content.validateBundle(moved);
  check(result.ok === true, 'moving the door keeps every reference valid: ' + errorCodes(result).join(', '));
  check(map.scenes.some(s => s.doorId === door.id), 'the scene still points at the same stable entity id');
  check(map.entities.some(e => guardIds.includes(e.id)), 'the guards are still on the board');
});

server.close();
try { fs.rmSync(temp, { recursive: true, force: true }); } catch {}

console.log(`\nSummary: ${passed} passed, ${failed} failed, ${assertions} assertions.\n`);
if (failed > 0) process.exit(1);
