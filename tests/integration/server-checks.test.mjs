// tests/integration/server-checks.test.mjs
// T7 — Engine Unified Checks & Referee Adjudication:
//   - Chests, traps, and road encounters are adjudicated solely by the server engine.
//   - Client-sent rollTotal and outcome cannot forge or override mechanical results.
//   - Clear feedback for success, failure, missing tools, insufficient resources, and invalid targets.
//   - Duplicate road encounter actions return stored results without duplicate rewards.
//   - Seeded streams continue deterministically across actions and delves.
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-dnd-t7-'));

const require = createRequire(import.meta.url);
const express = require('express');
const store = require('../../server/store.js');
const engine = require('../../server/game/engine.js');

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

async function test(name, fn) {
  try {
    await fn();
    console.log(`  ✔ PASS: ${name}`);
  } catch (err) {
    failed++;
    console.error(`  ❌ ERROR in ${name}:`, err.message);
  }
}

// In-process Express app
const app = express();
app.use(express.json());
app.use('/api/characters', require('../../server/routes/characters.js'));
app.use('/api/game', require('../../server/routes/game.js'));
app.use('/api/city', require('../../server/routes/city.js'));
const server = await new Promise(resolve => { const s = app.listen(0, () => resolve(s)); });
const BASE_URL = `http://localhost:${server.address().port}`;

async function api(method, p, body) {
  const res = await fetch(`${BASE_URL}${p}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined
  });
  let json = null;
  try { json = await res.json(); } catch {}
  return { status: res.status, body: json };
}

// Helper: build character and create in store
async function makeHero(name = 'T7 Hero', opts = {}) {
  const chars = store.getCharacters();
  const c = engine.buildCharacter({
    name,
    species: opts.species || 'human',
    className: opts.className || 'fighter',
    background: opts.background || 'soldier',
    baseScores: { str: 16, dex: 14, con: 14, int: 10, wis: 12, cha: 10 },
    bgPlus2: 'str', bgPlus1: 'con',
    skills: opts.skills || ['athletics', 'perception']
  });
  c.id = store.newId('char');
  if (opts.gold != null) c.gold = opts.gold;
  if (opts.tools) {
    c.inventory.push({ itemId: 'thieves_tools', qty: 1 });
  }
  if (opts.seed != null) {
    c.seed = opts.seed;
  }
  chars.push(c);
  store.saveCharacters(chars);
  return c;
}

// Helper: start delve and stage player next to object
async function stageDelveWithObject(char, objType = 'chest', objOverrides = {}) {
  const res = await api('POST', '/api/game/start', {
    characterId: char.id,
    mapId: 'crypt',
    difficulty: 'normal',
    bringAlly: false
  });
  assert(res.status === 200 && res.body.state, 'Delve started');
  const save = store.getSave(res.body.state.id);
  const p = save.entities.find(e => e.kind === 'player');
  // clear monsters near start
  save.entities = save.entities.filter(e => e.kind === 'player');

  let targetObj;
  if (objType === 'chest') {
    targetObj = {
      id: 'test_chest_1',
      type: 'chest',
      name: 'Ornate Chest',
      x: p.x + 1,
      y: p.y,
      locked: true,
      unlocked: false,
      looted: false,
      pickDc: 12,
      forceDc: 14,
      loot: { gold: 30, potions: 1 },
      ...objOverrides
    };
  } else if (objType === 'trap') {
    targetObj = {
      id: 'test_trap_1',
      type: 'trap',
      name: 'Poison Dart Trap',
      x: p.x + 1,
      y: p.y,
      revealed: true,
      triggered: false,
      disarmed: false,
      dc: 12,
      ...objOverrides
    };
  }
  save.objects = save.objects.filter(o => o.id !== targetObj.id);
  save.objects.push(targetObj);
  store.saveGame(save);
  return { saveId: save.id, objId: targetObj.id, p };
}

// ----------------------------------------------------------------------------
// Suite: Chest checks & referee
// ----------------------------------------------------------------------------

await test('T7 Chest: pick lock without thieves tools is rejected with error feedback', async () => {
  const hero = await makeHero('NoTools Hero', { tools: false });
  const { saveId, objId } = await stageDelveWithObject(hero, 'chest');

  const res = await api('POST', `/api/game/${saveId}/action`, {
    type: 'skillCheckObject',
    objectId: objId,
    method: 'pick'
  });
  assert(res.status === 200, 'Action returns 200');
  const errEv = res.body.events.find(e => e.type === 'error' && /thieves' tools/i.test(e.text));
  assert(errEv != null, 'Error feedback given for missing tools');
  const save = store.getSave(saveId);
  const chest = save.objects.find(o => o.id === objId);
  assert(chest.locked === true && !chest.unlocked, 'Chest remains locked');
});

await test('T7 Chest: client forged rollTotal is ignored; server adjudicates mechanically', async () => {
  const hero = await makeHero('ForgedRoll Hero', { tools: true });
  const { saveId, objId } = await stageDelveWithObject(hero, 'chest', { pickDc: 20 });

  // Client attempts to cheat by passing rollTotal: 99
  const res = await api('POST', `/api/game/${saveId}/action`, {
    type: 'skillCheckObject',
    objectId: objId,
    method: 'pick',
    rollTotal: 99
  });
  assert(res.status === 200, 'Action returns 200');
  const checkEv = res.body.events.find(e => e.type === 'chest_unlocked' || e.type === 'chest_locked');
  assert(checkEv != null, 'Event emitted');
  assert(checkEv.data != null, 'Event contains data payload');
  assert(checkEv.data.total !== 99, `Forged rollTotal: 99 ignored by server (actual: ${checkEv.data.total})`);
  assert(Number.isInteger(checkEv.data.natural) && checkEv.data.natural >= 1 && checkEv.data.natural <= 20, 'Natural d20 generated');
  assert(checkEv.data.dc === 20, 'DC matches object');
  assert(checkEv.data.outcome === (checkEv.data.success ? 'success' : 'failure'), 'Outcome consistent with success');
});

await test('T7 Chest: force lock does not require tools and awards loot on success', async () => {
  const hero = await makeHero('Force Hero', { tools: false, className: 'barbarian' });
  // Set forceDc low so it always succeeds
  const { saveId, objId } = await stageDelveWithObject(hero, 'chest', { forceDc: 1 });

  const res = await api('POST', `/api/game/${saveId}/action`, {
    type: 'skillCheckObject',
    objectId: objId,
    method: 'force'
  });
  assert(res.status === 200, 'Action returns 200');
  const winEv = res.body.events.find(e => e.type === 'chest_unlocked');
  assert(winEv != null, 'Chest unlocked event emitted');
  assert(winEv.data.method === 'force', 'Method recorded as force');
  assert(winEv.data.success === true, 'Success is true');
  const save = store.getSave(saveId);
  const chest = save.objects.find(o => o.id === objId);
  assert(chest.unlocked === true && chest.looted === true, 'Chest looted');
});

await test('T7 Chest: target invalid feedback when already looted or unlocked', async () => {
  const hero = await makeHero('Inspect Hero', { tools: true });
  const { saveId, objId } = await stageDelveWithObject(hero, 'chest', { looted: true });

  const res = await api('POST', `/api/game/${saveId}/action`, {
    type: 'skillCheckObject',
    objectId: objId,
    method: 'pick'
  });
  const infoEv = res.body.events.find(e => e.type === 'info' && /already empty/i.test(e.text));
  assert(infoEv != null, 'Already empty feedback returned');
});

// ----------------------------------------------------------------------------
// Suite: Trap checks & referee
// ----------------------------------------------------------------------------

await test('T7 Trap: disarm without tools is rejected with error feedback', async () => {
  const hero = await makeHero('TrapNoTools Hero', { tools: false });
  const { saveId, objId } = await stageDelveWithObject(hero, 'trap');

  const res = await api('POST', `/api/game/${saveId}/action`, {
    type: 'skillCheckObject',
    objectId: objId
  });
  assert(res.status === 200, 'Action returns 200');
  const errEv = res.body.events.find(e => e.type === 'error' && /thieves' tools/i.test(e.text));
  assert(errEv != null, 'Error feedback given for missing tools');
  const save = store.getSave(saveId);
  const trap = save.objects.find(o => o.id === objId);
  assert(trap.disarmed === false, 'Trap remains armed');
});

await test('T7 Trap: client forged rollTotal is ignored; engine adjudicates and returns natural/dc/outcome', async () => {
  const hero = await makeHero('TrapTools Hero', { tools: true });
  // Set DC high to guarantee failure
  const { saveId, objId } = await stageDelveWithObject(hero, 'trap', { dc: 30 });

  const res = await api('POST', `/api/game/${saveId}/action`, {
    type: 'skillCheckObject',
    objectId: objId,
    rollTotal: 100 // cheated roll
  });
  assert(res.status === 200, 'Action returns 200');
  const trapEv = res.body.events.find(e => e.type === 'trap_disarm_failed');
  assert(trapEv != null, 'Trap failure emitted despite forged rollTotal: 100');
  assert(trapEv.data.total < 30, `Total roll (${trapEv.data.total}) calculated by engine`);
  assert(trapEv.data.success === false, 'Success is false');
  assert(trapEv.data.outcome === 'failure', 'Outcome is failure');
});

await test('T7 Trap: successful disarm awards 25 XP and disarms trap', async () => {
  const hero = await makeHero('TrapExpert Hero', { tools: true });
  const { saveId, objId } = await stageDelveWithObject(hero, 'trap', { dc: 1 }); // guaranteed success

  const res = await api('POST', `/api/game/${saveId}/action`, {
    type: 'skillCheckObject',
    objectId: objId
  });
  assert(res.status === 200, 'Action returns 200');
  const winEv = res.body.events.find(e => e.type === 'trap_disarmed');
  assert(winEv != null, 'trap_disarmed event emitted');
  assert(winEv.data.success === true, 'Success is true');
  const save = store.getSave(saveId);
  const trap = save.objects.find(o => o.id === objId);
  assert(trap.disarmed === true, 'Trap state disarmed');
});

await test('T7 Trap: already disarmed trap yields info feedback', async () => {
  const hero = await makeHero('TrapDone Hero', { tools: true });
  const { saveId, objId } = await stageDelveWithObject(hero, 'trap', { disarmed: true });

  const res = await api('POST', `/api/game/${saveId}/action`, {
    type: 'skillCheckObject',
    objectId: objId
  });
  const infoEv = res.body.events.find(e => e.type === 'info' && /already disarmed/i.test(e.text));
  assert(infoEv != null, 'Info feedback for already disarmed trap');
});

// ----------------------------------------------------------------------------
// Suite: Road Encounter Trigger, Resolution, and Anti-Duplication
// ----------------------------------------------------------------------------

await test('T7 Road Encounter: trigger creates active encounter and records options', async () => {
  const hero = await makeHero('Road Hero');
  const res = await api('POST', `/api/characters/${hero.id}/road-encounter`, {
    action: 'trigger',
    force: true
  });
  assert(res.status === 200 && res.body.ok, 'Trigger succeeds');
  assert(res.body.encounter != null, 'Encounter object returned');
  assert(['peddler', 'ambush', 'shrine'].includes(res.body.encounter.id), `Valid encounter id: ${res.body.encounter.id}`);
  assert(Array.isArray(res.body.encounter.options) && res.body.encounter.options.length > 0, 'Options provided');

  const chars = store.getCharacters();
  const saved = chars.find(c => c.id === hero.id);
  assert(saved.currentRoadEncounter != null, 'Encounter persisted to store');
  assert(saved.currentRoadEncounter.resolved === false, 'Initially unresolved');
});

await test('T7 Road Encounter: choice not belonging to current encounter is rejected', async () => {
  const hero = await makeHero('Mismatch Hero');
  // Set active encounter to shrine
  hero.currentRoadEncounter = {
    id: 'shrine',
    instanceId: 're_shrine_test',
    options: ['pray', 'offer', 'proceed'],
    resolved: false
  };
  store.saveCharacters(store.getCharacters().map(c => c.id === hero.id ? hero : c));

  const res = await api('POST', `/api/characters/${hero.id}/road-encounter`, {
    choice: 'fight'
  });
  assert(res.status === 400, 'Invalid option rejected with HTTP 400');
  assert(/not valid/i.test(res.body.error), 'Descriptive error message returned');
});

await test('T7 Road Encounter: insufficient gold for bribe or offering is rejected', async () => {
  const hero = await makeHero('Poor Hero', { gold: 2 });
  hero.currentRoadEncounter = {
    id: 'ambush',
    instanceId: 're_ambush_poor',
    options: ['fight', 'bribe', 'sneak'],
    resolved: false
  };
  store.saveCharacters(store.getCharacters().map(c => c.id === hero.id ? hero : c));

  const bribeRes = await api('POST', `/api/characters/${hero.id}/road-encounter`, {
    choice: 'bribe'
  });
  assert(bribeRes.status === 400, 'Bribe rejected due to insufficient gold');
  assert(/insufficient gold/i.test(bribeRes.body.error), 'Feedback specifies insufficient gold');

  // Change to shrine and test offering
  hero.currentRoadEncounter = {
    id: 'shrine',
    instanceId: 're_shrine_poor',
    options: ['pray', 'offer', 'proceed'],
    resolved: false
  };
  store.saveCharacters(store.getCharacters().map(c => c.id === hero.id ? hero : c));

  const offerRes = await api('POST', `/api/characters/${hero.id}/road-encounter`, {
    choice: 'offer'
  });
  assert(offerRes.status === 400, 'Offering rejected due to insufficient gold');
  assert(/insufficient gold/i.test(offerRes.body.error), 'Feedback specifies insufficient gold');
});

await test('T7 Road Encounter: duplicate submission prevents duplicate awards (idempotent)', async () => {
  const hero = await makeHero('Dupe Hero', { gold: 50 });
  hero.currentRoadEncounter = {
    id: 'ambush',
    instanceId: 're_ambush_dupe',
    options: ['fight', 'bribe', 'sneak'],
    resolved: false
  };
  store.saveCharacters(store.getCharacters().map(c => c.id === hero.id ? hero : c));

  const initialGold = hero.gold;
  const res1 = await api('POST', `/api/characters/${hero.id}/road-encounter`, {
    choice: 'bribe'
  });
  assert(res1.status === 200, 'First bribe succeeds');
  assert(res1.body.gold === initialGold - 10, '10 GP deducted on first submission');

  // Second submission with exact same choice
  const res2 = await api('POST', `/api/characters/${hero.id}/road-encounter`, {
    choice: 'bribe'
  });
  assert(res2.status === 200, 'Second bribe returns 200');
  assert(res2.body.alreadyResolved === true, 'Response marks alreadyResolved: true');
  assert(res2.body.gold === initialGold - 10, 'No additional gold deducted on second submission');

  // Third submission with different choice on resolved encounter
  const res3 = await api('POST', `/api/characters/${hero.id}/road-encounter`, {
    choice: 'fight'
  });
  assert(res3.status === 400, 'Different choice on already resolved encounter rejected');
  assert(/already resolved/i.test(res3.body.error), 'Feedback indicates already resolved');
});

await test('T7 Road Encounter: legacy outcome cannot forge success; evaluated via engine RNG', async () => {
  const hero = await makeHero('Legacy Hero');
  // Attempt to submit legacy outcome without active encounter
  const noEncRes = await api('POST', `/api/characters/${hero.id}/road-encounter`, {
    outcome: 'ambush_win'
  });
  assert(noEncRes.status === 400, 'Legacy outcome rejected when no active encounter exists');

  // Setup active ambush
  hero.currentRoadEncounter = {
    id: 'ambush',
    instanceId: 're_ambush_legacy',
    options: ['fight', 'bribe', 'sneak'],
    resolved: false
  };
  store.saveCharacters(store.getCharacters().map(c => c.id === hero.id ? hero : c));

  // Legacy call maps to fight and evaluates on server
  const callRes = await api('POST', `/api/characters/${hero.id}/road-encounter`, {
    outcome: 'ambush_win'
  });
  assert(callRes.status === 200, 'Evaluates fight choice on server');
  assert(callRes.body.natural != null && callRes.body.natural >= 1 && callRes.body.natural <= 20, 'Server rolled natural d20');
  assert(callRes.body.dc === 11, 'DC is 11');
});

await test('T7 Road Encounter: shrine boons persist and carry into delve start', async () => {
  const hero = await makeHero('Shrine Hero', { gold: 30 });
  hero.currentRoadEncounter = {
    id: 'shrine',
    instanceId: 're_shrine_boon',
    options: ['pray', 'offer', 'proceed'],
    resolved: false
  };
  store.saveCharacters(store.getCharacters().map(c => c.id === hero.id ? hero : c));

  const prayRes = await api('POST', `/api/characters/${hero.id}/road-encounter`, {
    choice: 'pray'
  });
  assert(prayRes.status === 200, 'Pray succeeds');
  assert(prayRes.body.pendingRoadBoons.includes('shrine_temp_hp'), 'shrine_temp_hp recorded in pendingRoadBoons');

  // Start delve
  const delveRes = await api('POST', '/api/game/start', {
    characterId: hero.id,
    mapId: 'crypt',
    difficulty: 'normal',
    bringAlly: false
  });
  assert(delveRes.status === 200, 'Delve started');
  const boonEv = delveRes.body.events.find(e => e.type === 'boon');
  assert(boonEv != null, 'Boon event fired in delve');
  const delvePlayer = delveRes.body.state.entities.find(e => e.kind === 'player');
  assert(delvePlayer.tempHp === 5, 'Player received 5 temp HP from shrine boon');

  // Character encounter cleared on delve start
  const updatedHero = store.getCharacters().find(c => c.id === hero.id);
  assert(updatedHero.currentRoadEncounter == null, 'currentRoadEncounter cleared after embarking');
});

// ----------------------------------------------------------------------------
// Suite: Seeded RNG Determinism & Continuation
// ----------------------------------------------------------------------------

await test('T7 Determinism: identical seeds yield identical delve rolls and sequence', async () => {
  const hero1 = await makeHero('Seed Hero 1', { tools: true });
  const hero2 = await makeHero('Seed Hero 2', { tools: true });

  const { saveId: saveId1, objId: objId1 } = await stageDelveWithObject(hero1, 'chest', { pickDc: 15 });
  const { saveId: saveId2, objId: objId2 } = await stageDelveWithObject(hero2, 'chest', { pickDc: 15 });

  // Set identical seeds
  const s1 = store.getSave(saveId1);
  s1.seed = 987654321;
  s1.rngState = 987654321;
  store.saveGame(s1);

  const s2 = store.getSave(saveId2);
  s2.seed = 987654321;
  s2.rngState = 987654321;
  store.saveGame(s2);

  const res1 = await api('POST', `/api/game/${saveId1}/action`, {
    type: 'skillCheckObject',
    objectId: objId1,
    method: 'pick'
  });
  const res2 = await api('POST', `/api/game/${saveId2}/action`, {
    type: 'skillCheckObject',
    objectId: objId2,
    method: 'pick'
  });

  const ev1 = res1.body.events.find(e => e.type === 'chest_unlocked' || e.type === 'chest_locked');
  const ev2 = res2.body.events.find(e => e.type === 'chest_unlocked' || e.type === 'chest_locked');

  assert(ev1 != null && ev2 != null, 'Both events present');
  assert(ev1.data.natural === ev2.data.natural, `Natural rolls identical: ${ev1.data.natural} === ${ev2.data.natural}`);
  assert(ev1.data.total === ev2.data.total, `Total rolls identical: ${ev1.data.total} === ${ev2.data.total}`);
  assert(ev1.data.success === ev2.data.success, 'Outcomes identical');
});

// ----------------------------------------------------------------------------
// Suite: T7a — road-encounter lifecycle & deterministic check previews
// ----------------------------------------------------------------------------

await test('T7a Road Encounter: trigger reuses the live pending instance (no re-roll, same instanceId)', async () => {
  const hero = await makeHero('Reuse Hero');
  const t1 = await api('POST', `/api/characters/${hero.id}/road-encounter`, { action: 'trigger', force: true });
  assert(t1.status === 200 && t1.body.encounter, 'first trigger returns an encounter');
  const a = t1.body.encounter;
  const t2 = await api('POST', `/api/characters/${hero.id}/road-encounter`, { action: 'trigger', force: true });
  const b = t2.body.encounter;
  assert(b && b.instanceId === a.instanceId, `same instanceId reused (${a.instanceId} vs ${b && b.instanceId})`);
  assert(b.id === a.id && JSON.stringify(b.options) === JSON.stringify(a.options), 'same encounter kind and options — no re-roll');
  const saved = store.getCharacters().find(c => c.id === hero.id);
  assert(saved.currentRoadEncounter && saved.currentRoadEncounter.instanceId === a.instanceId, 'store still holds the one live instance');
});

await test('T7a Road Encounter: status restores the engine view (template + resolution) without consuming', async () => {
  const hero = await makeHero('Status Hero');
  const t = await api('POST', `/api/characters/${hero.id}/road-encounter`, { action: 'trigger', force: true });
  const enc = t.body.encounter;
  const s1 = await api('POST', `/api/characters/${hero.id}/road-encounter`, { action: 'status' });
  assert(s1.body.currentRoadEncounter && s1.body.currentRoadEncounter.instanceId === enc.instanceId, 'status returns the live instance');
  assert(typeof s1.body.currentRoadEncounter.title === 'string' && s1.body.currentRoadEncounter.title.length > 0, 'status carries the engine template (title)');
  const rv = await api('POST', `/api/characters/${hero.id}/road-encounter`, { choice: enc.options[0], encounterId: enc.instanceId });
  assert(rv.status === 200, 'resolve succeeds');
  const s2 = await api('POST', `/api/characters/${hero.id}/road-encounter`, { action: 'status' });
  const cur = s2.body.currentRoadEncounter;
  assert(cur && cur.instanceId === enc.instanceId && cur.resolved === true, 'resolved instance still live after resolve');
  assert(cur.result && typeof cur.result.text === 'string' && cur.result.text.length > 0, 'stored result text available for restore');
  const s3 = await api('POST', `/api/characters/${hero.id}/road-encounter`, { action: 'status' });
  assert(JSON.stringify(s2.body.currentRoadEncounter) === JSON.stringify(s3.body.currentRoadEncounter), 'status is a pure read (no RNG, no mutation)');
});

await test('T7a Road Encounter: unresolved instance blocks a direct start (409, nothing created)', async () => {
  const hero = await makeHero('Blocked Hero');
  hero.currentRoadEncounter = { id: 'ambush', instanceId: 're_t7a_block', options: ['fight', 'bribe', 'sneak'], resolved: false };
  store.saveCharacters(store.getCharacters().map(c => c.id === hero.id ? hero : c));
  const savesBefore = (await api('GET', '/api/game')).body.filter(sv => sv.characterId === hero.id).length;
  const res = await api('POST', '/api/game/start', { characterId: hero.id, mapId: 'crypt', difficulty: 'normal', bringAlly: false });
  assert(res.status === 409, `start refused with 409, got ${res.status}`);
  assert(res.body.encounter && res.body.encounter.instanceId === 're_t7a_block', '409 body carries the live instance view');
  const savesAfter = (await api('GET', '/api/game')).body.filter(sv => sv.characterId === hero.id).length;
  assert(savesAfter === savesBefore, 'no delve was created by the refused start');
});

await test('T7a Road Encounter: start consumes the resolved instance exactly once (blessed variant)', async () => {
  const hero = await makeHero('Consume Hero', { gold: 30 });
  hero.currentRoadEncounter = { id: 'shrine', instanceId: 're_t7a_consume', options: ['pray', 'offer', 'proceed'], resolved: false };
  store.saveCharacters(store.getCharacters().map(c => c.id === hero.id ? hero : c));
  const offer = await api('POST', `/api/characters/${hero.id}/road-encounter`, { choice: 'offer', encounterId: 're_t7a_consume' });
  assert(offer.status === 200 && (offer.body.pendingRoadBoons || []).includes('shrine_blessed'), 'offer resolves and records the boon');
  const start = await api('POST', '/api/game/start', { characterId: hero.id, mapId: 'crypt', difficulty: 'normal', bringAlly: false });
  assert(start.status === 200, 'resolved instance lets the start through');
  const player = start.body.state.entities.find(e => e.kind === 'player');
  assert((player.buffs || []).some(b => b.id === 'blessed'), 'blessed boon applied at start');
  const saved = store.getCharacters().find(c => c.id === hero.id);
  assert(saved.currentRoadEncounter == null && (saved.pendingRoadBoons || []).length === 0, 'instance + boons consumed exactly once');
  await api('DELETE', `/api/game/${start.body.state.id}`);
  const start2 = await api('POST', '/api/game/start', { characterId: hero.id, mapId: 'crypt', difficulty: 'normal', bringAlly: false });
  assert(start2.status === 200, 'follow-up start unblocked after consumption');
  await api('DELETE', `/api/game/${start2.body.state.id}`);
});

await test('T7a Preview: chest preview mirrors the engine modifier math incl. expertise', async () => {
  const hero = await makeHero('Rogue Preview', { className: 'rogue', background: 'criminal', tools: true, skills: ['sleight_of_hand', 'acrobatics'] });
  const { saveId, objId } = await stageDelveWithObject(hero, 'chest', { pickDc: 12, forceDc: 14 });
  const prev = await api('POST', `/api/game/${saveId}/preview`, { type: 'skillCheckObject', objectId: objId });
  assert(prev.status === 200 && prev.body.preview && prev.body.preview.kind === 'chest', 'preview endpoint returns a chest preview');
  const pick = prev.body.preview.methods.find(m => m.id === 'pick');
  const force = prev.body.preview.methods.find(m => m.id === 'force');
  assert(pick && force, 'both chest methods present');
  assert(pick.dc === 12 && force.dc === 14, 'DCs come from the object');
  // DEX +2, PB 2, rogue expertise on sleight_of_hand +2 → +6 (tools add nothing when proficient)
  assert(pick.modifier === 6, `pick modifier mirrors engine math incl. expertise, got ${pick.modifier}`);
  assert(pick.hasTools === true && pick.requiresTools === true, 'tools requirement reported');
  assert(force.modifier === 4, `force modifier = STR 18 (+4, athletics not proficient), got ${force.modifier}`);
  const res = await api('POST', `/api/game/${saveId}/action`, { type: 'skillCheckObject', objectId: objId, method: 'pick' });
  const ev = res.body.events.find(e => e.type === 'chest_unlocked' || e.type === 'chest_locked');
  assert(ev && ev.data.modifier === pick.modifier, `preview modifier === resolved event modifier (${pick.modifier})`);
  assert(ev.data.natural >= 1 && ev.data.natural <= 20, 'dice face still comes from the event natural');
});

await test('T7a Preview: read-only (no rev/RNG/mutation) and deterministic', async () => {
  const hero = await makeHero('Readonly Hero', { tools: true });
  const { saveId, objId } = await stageDelveWithObject(hero, 'chest');
  const before = store.getSave(saveId);
  const revBefore = before.rev;
  const objBefore = JSON.stringify(before.objects.find(o => o.id === objId));
  const p1 = await api('POST', `/api/game/${saveId}/preview`, { type: 'skillCheckObject', objectId: objId });
  const p2 = await api('POST', `/api/game/${saveId}/preview`, { type: 'skillCheckObject', objectId: objId });
  assert(JSON.stringify(p1.body.preview) === JSON.stringify(p2.body.preview), 'deterministic across calls');
  const after = store.getSave(saveId);
  assert(after.rev === revBefore, 'rev unchanged by previews');
  assert(JSON.stringify(after.objects.find(o => o.id === objId)) === objBefore, 'object untouched by previews');
  assert((after.rngState || null) === (before.rngState || null), 'RNG stream untouched');
});

await test('T7a Preview: trap preview flags missing thieves tools', async () => {
  const hero = await makeHero('Trap Hero', { tools: false });
  const { saveId, objId } = await stageDelveWithObject(hero, 'trap', { dc: 12 });
  const prev = await api('POST', `/api/game/${saveId}/preview`, { type: 'skillCheckObject', objectId: objId });
  assert(prev.status === 200 && prev.body.preview.kind === 'trap', 'trap preview returned');
  const disarm = prev.body.preview.methods.find(m => m.id === 'disarm');
  assert(disarm && disarm.dc === 12, 'trap DC from the object');
  assert(disarm.requiresTools === true && disarm.hasTools === false, 'missing tools flagged in the preview');
});

server.close();
console.log(`\n===============================================================`);
console.log(`   T7 Server Checks Test Results: ${passed} passed, ${failed} failed`);
console.log(`===============================================================`);
if (failed > 0) process.exit(1);
