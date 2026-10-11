// tests/integration/map-authoring.test.mjs
// T15b Integration Tests: Grid map editing, coordinates bounds, wall safety, campfire sync, scene preservation, and safe playtest.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { assertTestContainer } from '../../scripts/test-container.mjs';

assertTestContainer();
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-dnd-t15b-'));
process.env.DATA_DIR = temp;

const require = createRequire(import.meta.url);
const express = require('express');
const store = require('../../server/store.js');
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
for (const name of ['game', 'city', 'characters', 'content']) {
  app.use('/api/' + name, require('../../server/routes/' + name + '.js'));
}

const server = await new Promise(resolve => {
  const s = app.listen(0, '127.0.0.1', () => resolve(s));
});
const base = 'http://127.0.0.1:' + server.address().port;

async function api(method, url, body, locale = 'en') {
  const r = await fetch(base + url, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-Game-Locale': locale },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch { json = text; }
  return { status: r.status, body: json };
}

console.log('\n--- T15b Map Authoring Integration Tests ---');

try {
  // 1. Starter template cloning provides standard 25x15 dimensions
  let draftId = '';
  await test('starter template has canonical 25x15 map dimensions', async () => {
    const res = await api('POST', '/api/content/drafts/clone', {
      slug: 't15b_map_pack',
      name: 'T15b Map Adventure',
      author: 'Map Cartographer'
    });
    check(res.status === 200 && res.body.ok, 'clone succeeds');
    draftId = res.body.draftId;

    const draftRes = await api('GET', `/api/content/drafts/${draftId}`);
    check(draftRes.status === 200, 'get draft returns 200');
    const ch1 = draftRes.body.draft.maps[0];
    const ch2 = draftRes.body.draft.maps[1];
    check(ch1.width === 25 && ch1.height === 15, 'CH1 map is exactly 25x15');
    check(ch2.width === 25 && ch2.height === 15, 'CH2 map is exactly 25x15');
    check(ch1.rows.length === 15 && ch1.rows.every(r => r.length === 25), 'CH1 rows are 15 strings of length 25');
    check(ch2.rows.length === 15 && ch2.rows.every(r => r.length === 25), 'CH2 rows are 15 strings of length 25');
  });

  // 2. Modifying tiles retains 25x15 grid format and door synchronization
  await test('grid tile modifications retain exact 25x15 grid format and door entity sync', async () => {
    const draftRes = await api('GET', `/api/content/drafts/${draftId}`);
    const draft = draftRes.body.draft;
    const m = draft.maps[0];

    // Modify a wall cell to floor and add a door
    // At row 6, index 8 was a wall '#'. Change to '.'
    const row6 = m.rows[6];
    m.rows[6] = row6.substring(0, 8) + '.' + row6.substring(9);
    // Add a door at (8, 5)
    const row5 = m.rows[5];
    m.rows[5] = row5.substring(0, 8) + 'D' + row5.substring(9);
    m.entities.push({
      id: `${m.id}_door_8_5`,
      type: 'door',
      x: 8,
      y: 5,
      name: 'Extra Wooden Door',
      open: false,
      locked: false
    });

    const saveRes = await api('PUT', `/api/content/drafts/${draftId}`, { draft });
    check(saveRes.status === 200 && saveRes.body.ok, 'save modified grid succeeds');
    check(saveRes.body.validation.ok, 'modified map passes T8 validation');

    const updated = await api('GET', `/api/content/drafts/${draftId}`);
    const updatedM = updated.body.draft.maps[0];
    check(updatedM.rows.length === 15 && updatedM.rows.every(r => r.length === 25), 'updated map retains 25x15 matrix');
    check(updatedM.rows[6][8] === '.', 'wall replaced with floor');
    check(updatedM.rows[5][8] === 'D', 'door tile placed');
  });

  // 3. Placing playerStart on a wall generates wall-position error but preserves draft
  await test('playerStart placed on wall generates wall-position error and blocks playtest', async () => {
    const draftRes = await api('GET', `/api/content/drafts/${draftId}`);
    const draft = draftRes.body.draft;
    const m = draft.maps[0];

    // (0, 0) is a boundary wall '#'
    m.playerStart = { x: 0, y: 0 };
    const saveRes = await api('PUT', `/api/content/drafts/${draftId}`, { draft });
    check(saveRes.status === 200 && saveRes.body.ok, 'draft saved despite validation error (draft tolerance)');
    check(!saveRes.body.validation.ok, 'validation reports ok: false');
    check(saveRes.body.validation.diagnostics.some(d => d.code === 'wall-position' && d.field.includes('playerStart')), 'diagnostics include wall-position error on playerStart');

    // Attempting to playtest should be blocked with 400
    const ptRes = await api('POST', `/api/content/drafts/${draftId}/playtest`);
    check(ptRes.status === 400, 'playtest blocked when playerStart is on wall');
    check(!ptRes.body.ok, 'playtest returns ok: false');

    // Restore playerStart to valid floor (1, 7)
    m.playerStart = { x: 1, y: 7 };
    await api('PUT', `/api/content/drafts/${draftId}`, { draft });
  });

  // 4. Placing victory campfire on a wall generates wall-position error and blocks install
  await test('campfire placed on wall generates wall-position error and blocks install', async () => {
    const draftRes = await api('GET', `/api/content/drafts/${draftId}`);
    const draft = draftRes.body.draft;
    const m = draft.maps[0];

    // (0, 0) is a wall '#'
    m.victory.campfire = { x: 0, y: 0 };
    const campEnt = m.entities.find(e => e.id === 'campfire');
    if (campEnt) { campEnt.x = 0; campEnt.y = 0; }

    const saveRes = await api('PUT', `/api/content/drafts/${draftId}`, { draft });
    check(!saveRes.body.validation.ok, 'validation reports ok: false');
    check(saveRes.body.validation.diagnostics.some(d => d.code === 'wall-position' && d.field.includes('campfire')), 'diagnostics include wall-position error on campfire');

    // Attempting to install should be rejected with 400
    const installRes = await api('POST', `/api/content/drafts/${draftId}/install`);
    check(installRes.status === 400, 'install blocked when campfire is on wall');

    // Restore campfire to (1, 7)
    m.victory.campfire = { x: 1, y: 7 };
    if (campEnt) { campEnt.x = 1; campEnt.y = 7; }
    await api('PUT', `/api/content/drafts/${draftId}`, { draft });
  });

  // 5. Misaligned victory.campfire and entities campfire object produces victory-target error
  await test('campfire entity coordinate mismatch against victory.campfire is caught', async () => {
    const draftRes = await api('GET', `/api/content/drafts/${draftId}`);
    const draft = draftRes.body.draft;
    const m = draft.maps[0];

    // victory.campfire is at (1, 7), but entity is moved to (2, 7) without syncing
    m.victory.campfire = { x: 1, y: 7 };
    const campEnt = m.entities.find(e => e.id === 'campfire');
    campEnt.x = 2; campEnt.y = 7;

    const saveRes = await api('PUT', `/api/content/drafts/${draftId}`, { draft });
    check(!saveRes.body.validation.ok, 'mismatched campfire coordinates fail validation');
    check(saveRes.body.validation.diagnostics.some(d => d.code === 'victory-target'), 'victory-target diagnostic generated');

    // Resynchronize them properly
    campEnt.x = 1; campEnt.y = 7;
    const restoreRes = await api('PUT', `/api/content/drafts/${draftId}`, { draft });
    check(restoreRes.body.validation.ok, 'synchronized campfire coordinates validate clean');
  });

  // 6. Moving an NPC preserves scene.npcId binding
  await test('moving an NPC entity preserves scene binding and passes T8 validation', async () => {
    const draftRes = await api('GET', `/api/content/drafts/${draftId}`);
    const draft = draftRes.body.draft;
    const m = draft.maps[0];

    // Find the NPC entity bound to scene
    const scene = m.scenes[0];
    const npcId = scene.npcId;
    const npcEnt = m.entities.find(e => e.id === npcId);
    check(!!npcEnt, 'found NPC entity referenced by scene');

    // Move NPC to a different valid floor cell (e.g. 5, 5)
    npcEnt.x = 5;
    npcEnt.y = 5;

    const saveRes = await api('PUT', `/api/content/drafts/${draftId}`, { draft });
    check(saveRes.body.validation.ok, 'moved NPC preserves scene binding cleanly');
    check(saveRes.body.draft.maps[0].scenes[0].npcId === npcId, 'scene.npcId remains bound to entity');
  });

  // 7. Conservative reachability: fully walled-off target warns unreachable
  await test('completely walled-off target generates unreachable warning under optimistic assumptions', async () => {
    const draftRes = await api('GET', `/api/content/drafts/${draftId}`);
    const draft = draftRes.body.draft;
    const m = draft.maps[0];

    // Wall off the guard monster at (10, 7) completely with walls '#' on all four cardinal tiles: (9, 7), (11, 7), (10, 6), (10, 8)
    const setW = (x, y) => { m.rows[y] = m.rows[y].substring(0, x) + '#' + m.rows[y].substring(x + 1); };
    setW(9, 7); setW(11, 7); setW(10, 6); setW(10, 8);

    const saveRes = await api('PUT', `/api/content/drafts/${draftId}`, { draft });
    // T8 reachability reports unreachable as a warning, preserving ok: true per contract
    check(saveRes.body.validation.diagnostics.some(d => d.code === 'unreachable'), 'unreachable warning generated for sealed target');

    // Reopen access by clearing (11, 7), (10, 6), (10, 8) back to '.'
    m.rows[7] = m.rows[7].substring(0, 11) + '.' + m.rows[7].substring(12);
    m.rows[6] = m.rows[6].substring(0, 10) + '.' + m.rows[6].substring(11);
    m.rows[8] = m.rows[8].substring(0, 10) + '.' + m.rows[8].substring(11);
    await api('PUT', `/api/content/drafts/${draftId}`, { draft });
  });

  // 8. Safe playtest lifecycle on modified custom map
  await test('isolated playtest session boots on modified map and isolates saves', async () => {
    const playtestRes = await api('POST', `/api/content/drafts/${draftId}/playtest`, { mapId: `${draftId}_ch1` });
    check(playtestRes.status === 200 && playtestRes.body.ok, 'playtest launches on modified map');
    check(playtestRes.body.mapId === `${draftId}_ch1`, 'playtest map is custom draft map');
    const saveId = playtestRes.body.saveId;
    const charId = playtestRes.body.characterId;

    // Verify game state reflects playtest isolation
    const gameRes = await api('GET', `/api/game/${saveId}`);
    check(gameRes.status === 200, 'game state retrievable');
    check(gameRes.body.state.isPlaytest === true, 'state isPlaytest is true');
    check(gameRes.body.state.ownerDraftId === draftId, 'state ownerDraftId matches draft');

    const moveRes = await api('POST', `/api/game/${saveId}/action`, { type: 'move', x: 2, y: 7 });
    check(moveRes.status === 200 && !moveRes.body.events?.some(e => e.type === 'error'), 'movement succeeds on modified map');

    // Settlement contract (T3/R4): a delve that has not ended never settles, playtest or not.
    const rosterBefore = JSON.stringify(store.getCharacters());
    const earlySettle = await api('POST', '/api/city/sync-delve', { delveStateId: saveId, charId });
    check(earlySettle.status === 400 && earlySettle.body.errorDisplay.key === 'api.delveNotEnded', 'an unfinished playtest is refused settlement');
    check(JSON.stringify(store.getCharacters()) === rosterBefore, 'the refused settle wrote no hero record');

    // Retreating at the campfire is a real end, so the run becomes settleable - and the receipt
    // lands on this draft's own playtest hero, never on a roster hero.
    const retreatRes = await api('POST', `/api/game/${saveId}/action`, { type: 'retreat' });
    check(retreatRes.status === 200 && retreatRes.body.state?.mode === 'retreat', 'retreating at the campfire ends the playtest run');
    const settleRes = await api('POST', '/api/city/sync-delve', {
      delveStateId: saveId,
      charId
    });
    check(settleRes.status === 200 && settleRes.body.ok, 'an ended playtest settles');
    check(settleRes.body.isPlaytest === true, 'settlement marked isPlaytest');
    check(settleRes.body.char?.id === charId && settleRes.body.char?.isPlaytest === true, 'the receipt lands on the draft playtest hero');
    const formalHeroes = store.getCharacters().filter(c => c.isPlaytest !== true);
    check(formalHeroes.every(c => !(c.settlements || []).some(r => r && r.id === settleRes.body.receipt.id)), 'no roster hero received the playtest receipt');

    // Delete playtest game
    await api('DELETE', `/api/game/${saveId}`);
  });

  console.log(`\nSummary: ${passed} passed, ${failed} failed, ${assertions} assertions.\n`);
  if (failed > 0) process.exitCode = 1;
} finally {
  server.close();
  try { fs.rmSync(temp, { recursive: true, force: true }); } catch {}
}
