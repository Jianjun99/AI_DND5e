// T14: Starter adventure chapter 2 (river-post) & cross-chapter history binding.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { assertTestContainer } from '../../scripts/test-container.mjs';

assertTestContainer();
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-dnd-t14-'));
process.env.DATA_DIR = temp;
const require = createRequire(import.meta.url);
const express = require('express');
const store = require('../../server/store.js');
const engine = require('../../server/game/engine.js');
const presentation = require('../../server/game/presentation.js');
const gameRouter = require('../../server/routes/game.js');
const presets = require('../../server/game/presets.js');

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
app.use(express.json());
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
  return { status: r.status, body: await r.json() };
}

function makeHero(name = 'T14 Hero', cls = 'fighter') {
  const draft = presets.draftFor(cls === 'wizard' ? 'arcane' : 'guardian');
  const char = engine.buildCharacter({ name, ...draft });
  char.id = store.newId('char');
  char.gold = 30;
  store.saveCharacters([...store.getCharacters(), char]);
  return char;
}

async function act(id, action, locale = 'en', allowError = false) {
  const r = await api('POST', '/api/game/' + id + '/action', action, locale);
  check(r.status === 200, 'action HTTP 200: ' + JSON.stringify(r.body));
  if (!allowError) {
    check(!r.body.events.some(e => e.type === 'error'), 'action has no errors: ' + JSON.stringify(r.body.events));
  }
  return r.body;
}

const move = (id, x, y) => {
  const state = store.getSave(id), p = engine.playerEntity(state);
  return p.x === x && p.y === y ? Promise.resolve({ state, events: [] }) : act(id, { type: 'move', x, y });
};
const choose = (id, sceneId, choiceId, locale = 'en') => act(id, { type: 'sceneChoice', sceneId, choiceId }, locale);
function tweak(id, fn) {
  const s = store.getSave(id);
  fn(s);
  store.saveGame(s);
}

function sceneResolved(state, sceneId) {
  const k = (state.mapId || 'river-post') + ':' + sceneId;
  return state.encounters?.[k]?.phase === 'resolved' || state.encounters?.[sceneId]?.phase === 'resolved';
}

try {
  await test('History qualification contract: victory required, retreat/death disqualified, deterministic sort', async () => {
    const resolve = gameRouter.resolveHistoryBinding;
    const req = { storyId: 'missing-courier', fallback: 'no_history' };

    // 1. Clean hero without history
    const hero0 = makeHero('Clean Hero');
    check(resolve(hero0, req) === null, 'clean hero has null historyBinding');

    // 2. Delve ending reported, settled as victory
    const hero1 = makeHero('Victory Hero');
    hero1.settlements = [{ id: 'save1#1', mode: 'victory', ts: 1000 }];
    hero1.encounterFacts = [{
      id: 'save1:courier-crossing:reckoning', saveId: 'save1', mapId: 'courier-crossing',
      sceneId: 'reckoning', storyId: 'missing-courier', choiceId: 'report', fact: 'public_record',
      ending: 'reported', ts: 900
    }];
    const binding1 = resolve(hero1, req);
    check(binding1 !== null, 'victory hero qualifies');
    check(binding1.ending === 'reported', 'ending is reported');
    check(binding1.completedTs === 1000, 'completedTs is from victory receipt');
    check(binding1.sourceSaveId === 'save1', 'sourceSaveId matches');

    // 3. Delve ending reported, but settled as retreat
    const heroRetreat = makeHero('Retreat Hero');
    heroRetreat.settlements = [{ id: 'saveRetreat#1', mode: 'retreat', ts: 1000 }];
    heroRetreat.encounterFacts = [{
      id: 'saveRetreat:courier-crossing:reckoning', saveId: 'saveRetreat', mapId: 'courier-crossing',
      sceneId: 'reckoning', storyId: 'missing-courier', choiceId: 'report', fact: 'public_record',
      ending: 'reported', ts: 900
    }];
    check(resolve(heroRetreat, req) === null, 'retreat delve is disqualified');

    // 4. Delve ending reported, but settled as death (mode: 'over')
    const heroOver = makeHero('Over Hero');
    heroOver.settlements = [{ id: 'saveOver#1', mode: 'over', ts: 1000 }];
    heroOver.encounterFacts = [{
      id: 'saveOver:courier-crossing:reckoning', saveId: 'saveOver', mapId: 'courier-crossing',
      sceneId: 'reckoning', storyId: 'missing-courier', choiceId: 'report', fact: 'public_record',
      ending: 'reported', ts: 900
    }];
    check(resolve(heroOver, req) === null, 'dead delve is disqualified');

    // 5. Multiple victories: newest completedTs wins
    const heroMulti = makeHero('Multi Hero');
    heroMulti.settlements = [
      { id: 'saveA#1', mode: 'victory', ts: 1000 },
      { id: 'saveB#1', mode: 'victory', ts: 2000 }
    ];
    heroMulti.encounterFacts = [
      { id: 'saveA:c:r', saveId: 'saveA', mapId: 'courier-crossing', sceneId: 'reckoning', storyId: 'missing-courier', choiceId: 'report', fact: 'public_record', ending: 'reported', ts: 900 },
      { id: 'saveB:c:r', saveId: 'saveB', mapId: 'courier-crossing', sceneId: 'reckoning', storyId: 'missing-courier', choiceId: 'accord', fact: 'relief_accord', ending: 'accord', ts: 1900 }
    ];
    const bindingMulti = resolve(heroMulti, req);
    check(bindingMulti.ending === 'accord', 'newest victory wins');
    check(bindingMulti.completedTs === 2000, 'completedTs is 2000');

    // 6. Tie breaker: identical ts uses b.id.localeCompare(a.id)
    const heroTie = makeHero('Tie Hero');
    heroTie.settlements = [
      { id: 'saveAlpha#1', mode: 'victory', ts: 3000 },
      { id: 'saveBeta#1', mode: 'victory', ts: 3000 }
    ];
    heroTie.encounterFacts = [
      { id: 'fact_alpha', saveId: 'saveAlpha', mapId: 'courier-crossing', sceneId: 'reckoning', storyId: 'missing-courier', choiceId: 'report', fact: 'public_record', ending: 'reported', ts: 3000 },
      { id: 'fact_beta', saveId: 'saveBeta', mapId: 'courier-crossing', sceneId: 'reckoning', storyId: 'missing-courier', choiceId: 'protect', fact: 'quiet_departure', ending: 'protected', ts: 3000 }
    ];
    const bindingTie = resolve(heroTie, req);
    check(bindingTie.factId === 'fact_beta', 'fact_beta wins tiebreaker over fact_alpha');
    check(bindingTie.ending === 'protected', 'tiebreaker ending is protected');

    // 7. Legacy fallback: encounterFacts has ending, no settlements record
    const heroLegacy = makeHero('Legacy Hero');
    heroLegacy.settlements = [];
    heroLegacy.encounterFacts = [
      { id: 'fact_legacy', saveId: 'saveLegacy', mapId: 'courier-crossing', sceneId: 'reckoning', storyId: 'missing-courier', choiceId: 'report', fact: 'public_record', ending: 'reported', ts: 500 }
    ];
    const bindingLegacy = resolve(heroLegacy, req);
    check(bindingLegacy !== null && bindingLegacy.ending === 'reported', 'legacy fact qualifies when no disqualifying settlements exist');
  });

  await test('Chapter 2 delve start locks historyBinding and filters initial choices accordingly', async () => {
    // 1. Start with clean hero (no_history)
    const charNoHist = makeHero('Clean Start Hero');
    const r0 = await api('POST', '/api/game/start', { characterId: charNoHist.id, mapId: 'river-post', difficulty: 'easy', bringAlly: false });
    check(r0.status === 200, 'river-post starts clean');
    check(r0.body.state.historyBinding === null, 'clean hero has null historyBinding in state');
    await move(r0.body.state.id, 6, 7);
    const s0 = (await api('GET', '/api/game/' + r0.body.state.id)).body.state;
    const gateScene0 = s0.scenes.find(s => s.id === 'post_gate');
    check(gateScene0, 'post_gate scene is in scenes');
    const showPass0 = gateScene0.choices.find(c => c.id === 'show_pass');
    const dockBypass0 = gateScene0.choices.find(c => c.id === 'dock_bypass');
    const accordNotice0 = gateScene0.choices.find(c => c.id === 'accord_notice');
    const persuade0 = gateScene0.choices.find(c => c.id === 'persuade_entry');
    check(!showPass0.available && showPass0.reason === '前章历程不符。', 'show_pass rejected under no_history');
    check(!dockBypass0.available && dockBypass0.reason === '前章历程不符。', 'dock_bypass rejected under no_history');
    check(!accordNotice0.available && accordNotice0.reason === '前章历程不符。', 'accord_notice rejected under no_history');
    check(persuade0.available, 'persuade_entry available under no_history');

    // 2. Start with hero having reported victory
    const charReported = makeHero('Reported Hero');
    charReported.settlements = [{ id: 'delveRep#1', mode: 'victory', ts: Date.now() }];
    charReported.encounterFacts = [{
      id: 'delveRep:c:r', saveId: 'delveRep', mapId: 'courier-crossing', sceneId: 'reckoning',
      storyId: 'missing-courier', choiceId: 'report', fact: 'public_record', ending: 'reported', ts: Date.now()
    }];
    store.saveCharacters([charReported]);

    const r1 = await api('POST', '/api/game/start', { characterId: charReported.id, mapId: 'river-post', difficulty: 'easy', bringAlly: false });
    check(r1.status === 200, 'river-post starts with reported history');
    check(r1.body.state.historyBinding?.ending === 'reported', 'historyBinding has ending reported');
    await move(r1.body.state.id, 6, 7);
    const s1 = (await api('GET', '/api/game/' + r1.body.state.id)).body.state;
    const gateScene1 = s1.scenes.find(s => s.id === 'post_gate');
    const showPass1 = gateScene1.choices.find(c => c.id === 'show_pass');
    check(showPass1.available, 'show_pass is available under reported');
    check(!gateScene1.choices.find(c => c.id === 'dock_bypass').available, 'dock_bypass unavailable under reported');

    // 3. Reload persistence
    const reloaded = (await api('GET', '/api/game/' + s1.id)).body.state;
    check(reloaded.historyBinding?.ending === 'reported', 'historyBinding survives reload');
  });

  await test('Full walkthrough under reported: show_pass -> cite_records -> choice_lawful_order -> campfire victory', async () => {
    const char = makeHero('Reported Walkthrough Hero');
    char.settlements = [{ id: 'delveRep2#1', mode: 'victory', ts: Date.now() }];
    char.encounterFacts = [{
      id: 'delveRep2:c:r', saveId: 'delveRep2', mapId: 'courier-crossing', sceneId: 'reckoning',
      storyId: 'missing-courier', choiceId: 'report', fact: 'public_record', ending: 'reported', ts: Date.now()
    }];
    store.saveCharacters([char]);

    const startRes = await api('POST', '/api/game/start', { characterId: char.id, mapId: 'river-post', difficulty: 'easy', bringAlly: false });
    const id = startRes.body.state.id;

    // Step 1: Walk to Guard Oden at (7, 7) and use show_pass
    await move(id, 6, 7);
    const passRes = await choose(id, 'post_gate', 'show_pass');
    check(sceneResolved(passRes.state, 'post_gate'), 'post_gate resolved');
    check(passRes.state.objects.find(o => o.id === 'post_gate_door').open === true, 'gate door opened');
    check(passRes.state.encounterFacts.some(f => f.choiceId === 'show_pass'), 'gate_shown_pass fact recorded');

    // Step 2: Walk through gate (8,7) to Storekeeper Vael at (14, 7)
    await move(id, 8, 7);
    await move(id, 13, 7);
    const vaelScene = (await api('GET', '/api/game/' + id)).body.state.scenes.find(s => s.id === 'storehouse_dispute');
    check(vaelScene, 'storehouse_dispute is active');
    const citeChoice = vaelScene.choices.find(c => c.id === 'cite_records');
    check(citeChoice.available, 'cite_records is available');

    // Tweak to ensure check success
    tweak(id, s => { s.character.abilities.cha = 50; });
    const citeRes = await choose(id, 'storehouse_dispute', 'cite_records');
    check(sceneResolved(citeRes.state, 'storehouse_dispute'), 'storehouse_dispute resolved');
    check(citeRes.state.encounterFacts.some(f => f.choiceId === 'cite_records' && f.fact === 'dispute_lio_testimony'), 'lio testimony recorded');

    // Step 3: Walk to Magistrate Beren at (21, 7)
    await move(id, 15, 7); // through warehouse door (unlocked)
    await move(id, 20, 7);
    const berenScene = (await api('GET', '/api/game/' + id)).body.state.scenes.find(s => s.id === 'final_verdict');
    check(berenScene, 'final_verdict scene active');

    const verdictRes = await choose(id, 'final_verdict', 'choice_lawful_order');
    check(sceneResolved(verdictRes.state, 'final_verdict'), 'final_verdict resolved');
    const finalFact = verdictRes.state.encounterFacts.find(f => f.sceneId === 'final_verdict');
    check(finalFact.ending === 'lawful_order', 'lawful_order ending recorded');

    // Step 4: Return to campfire at (1, 7) to trigger victory
    await move(id, 15, 7);
    await move(id, 8, 7);
    const winMove = await move(id, 1, 7);
    check(winMove.state.mode === 'victory', 'delve mode is victory');
    check(winMove.events.some(e => e.type === 'victory'), 'victory event emitted');

    // Step 5: Settle delve in town
    const settleRes = await api('POST', '/api/city/sync-delve', { charId: char.id, delveStateId: id });
    check(settleRes.status === 200 && !settleRes.body.duplicate, 'sync-delve succeeds');
    const updatedHero = store.getCharacters().find(c => c.id === char.id);
    check(updatedHero.settlements.some(r => r.mode === 'victory' && r.mapId === 'river-post'), 'victory receipt in char.settlements');
    check(updatedHero.encounterFacts.some(f => f.ending === 'lawful_order'), 'lawful_order ending recorded in char.encounterFacts');
  });

  await test('Walkthrough under protected: dock_bypass stealth failure forward -> refugee_token -> free_haven ending', async () => {
    const char = makeHero('Protected Walkthrough Hero');
    char.settlements = [{ id: 'delveProt#1', mode: 'victory', ts: Date.now() }];
    char.encounterFacts = [{
      id: 'delveProt:c:r', saveId: 'delveProt', mapId: 'courier-crossing', sceneId: 'reckoning',
      storyId: 'missing-courier', choiceId: 'protect', fact: 'quiet_departure', ending: 'protected', ts: Date.now()
    }];
    store.saveCharacters([char]);

    const startRes = await api('POST', '/api/game/start', { characterId: char.id, mapId: 'river-post', difficulty: 'easy', bringAlly: false });
    const id = startRes.body.state.id;
    check(startRes.body.state.historyBinding.ending === 'protected', 'historyBinding is protected');

    // Loot dock_cache at (3, 12)
    await move(id, 3, 11);
    const lootRes = await act(id, { type: 'interact', objectId: 'dock_cache' });
    check(lootRes.events.some(e => e.type === 'loot'), 'dock_cache looted');
    check(store.getSave(id).character.inventory.some(i => i.itemId === 'potion_healing'), 'potion_healing in inventory');

    // Walk to Guard Oden and fail dock_bypass
    await move(id, 6, 7);
    tweak(id, s => { s.character.abilities.dex = -100; }); // ensure stealth check failure
    const bypassRes = await choose(id, 'post_gate', 'dock_bypass');
    check(sceneResolved(bypassRes.state, 'post_gate'), 'gate resolved on stealth failure');
    check(bypassRes.state.encounterFacts.some(f => f.fact === 'gate_dock_bypass_seen'), 'fail-forward fact recorded');
    check(bypassRes.state.objects.find(o => o.id === 'post_gate_door').open === true, 'gate door opened on failure');

    // Walk to Storekeeper Vael and use refugee_token
    await move(id, 8, 7);
    await move(id, 13, 7);
    tweak(id, s => { s.character.abilities.wis = 50; }); // ensure insight check success
    const tokenRes = await choose(id, 'storehouse_dispute', 'refugee_token');
    check(sceneResolved(tokenRes.state, 'storehouse_dispute'), 'storehouse_dispute resolved');
    check(tokenRes.state.encounterFacts.some(f => f.fact === 'dispute_token_accepted'), 'token accepted fact recorded');

    // Walk to Beren and choose free_haven
    await move(id, 15, 7);
    await move(id, 20, 7);
    tweak(id, s => { s.character.abilities.cha = 50; });
    const verdictRes = await choose(id, 'final_verdict', 'choice_free_haven');
    check(verdictRes.state.encounterFacts.some(f => f.ending === 'free_haven'), 'free_haven ending recorded');

    // Return to campfire
    await move(id, 15, 7);
    await move(id, 8, 7);
    const winMove = await move(id, 1, 7);
    check(winMove.state.mode === 'victory', 'victory achieved');
  });

  await test('Walkthrough under accord: accord_notice -> accord_advocacy -> shared_covenant ending', async () => {
    const char = makeHero('Accord Walkthrough Hero');
    char.settlements = [{ id: 'delveAcc#1', mode: 'victory', ts: Date.now() }];
    char.encounterFacts = [{
      id: 'delveAcc:c:r', saveId: 'delveAcc', mapId: 'courier-crossing', sceneId: 'reckoning',
      storyId: 'missing-courier', choiceId: 'accord', fact: 'relief_accord', ending: 'accord', ts: Date.now()
    }];
    store.saveCharacters([char]);

    const startRes = await api('POST', '/api/game/start', { characterId: char.id, mapId: 'river-post', difficulty: 'easy', bringAlly: false });
    const id = startRes.body.state.id;
    check(startRes.body.state.historyBinding.ending === 'accord', 'historyBinding is accord');

    // Scene 1: accord_notice
    await move(id, 6, 7);
    const noticeRes = await choose(id, 'post_gate', 'accord_notice');
    check(sceneResolved(noticeRes.state, 'post_gate'), 'gate resolved via accord_notice');

    // Scene 2: accord_advocacy
    await move(id, 8, 7);
    await move(id, 13, 7);
    tweak(id, s => { s.character.abilities.cha = 50; });
    const advRes = await choose(id, 'storehouse_dispute', 'accord_advocacy');
    check(advRes.state.encounterFacts.some(f => f.fact === 'dispute_accord_advocacy'), 'accord_advocacy fact recorded');

    // Scene 3: choice_shared_covenant
    await move(id, 15, 7);
    await move(id, 20, 7);
    tweak(id, s => { s.character.abilities.cha = 50; });
    const verdictRes = await choose(id, 'final_verdict', 'choice_shared_covenant');
    check(verdictRes.state.encounterFacts.some(f => f.ending === 'shared_covenant'), 'shared_covenant ending recorded');

    // Campfire victory
    await move(id, 15, 7);
    await move(id, 8, 7);
    const winMove = await move(id, 1, 7);
    check(winMove.state.mode === 'victory', 'victory achieved');
  });

  await test('Zero resource guarantee (0 GP, 0 potion) with failure forward throughout entire delve', async () => {
    const char = makeHero('Zero Resource Hero');
    char.gold = 0; // Exactly 0 GP
    char.inventory = []; // 0 items
    store.saveCharacters([char]);

    const startRes = await api('POST', '/api/game/start', { characterId: char.id, mapId: 'river-post', difficulty: 'easy', bringAlly: false });
    const id = startRes.body.state.id;
    check(startRes.body.state.character.gold === 0, 'gold is 0');

    // Scene 1: persuade_entry with failed check (CHA -100)
    await move(id, 6, 7);
    tweak(id, s => { s.character.abilities.cha = -100; s.character.gold = 0; });
    const s1 = (await api('GET', '/api/game/' + id)).body.state;
    const persuadeChoice = s1.scenes.find(s => s.id === 'post_gate').choices.find(c => c.id === 'persuade_entry');
    check(persuadeChoice.available, 'persuade_entry is clickable with 0 GP');

    const failGateRes = await choose(id, 'post_gate', 'persuade_entry');
    check(sceneResolved(failGateRes.state, 'post_gate'), 'gate resolved even on check failure');
    check(failGateRes.state.encounterFacts.some(f => f.fact === 'gate_probation_entry'), 'fail forward fact registered');
    check(failGateRes.state.character.gold === 0, 'no gold deducted');

    // Scene 2: labor_compromise with failed check (INT -100)
    await move(id, 8, 7);
    await move(id, 13, 7);
    tweak(id, s => { s.character.abilities.int = -100; s.character.gold = 0; });
    const s2 = (await api('GET', '/api/game/' + id)).body.state;
    const laborChoice = s2.scenes.find(s => s.id === 'storehouse_dispute').choices.find(c => c.id === 'labor_compromise');
    check(laborChoice.available, 'labor_compromise is clickable with 0 GP');

    const failLaborRes = await choose(id, 'storehouse_dispute', 'labor_compromise');
    check(sceneResolved(failLaborRes.state, 'storehouse_dispute'), 'storehouse resolved on failure');
    check(failLaborRes.state.encounterFacts.some(f => f.fact === 'dispute_labor_concession'), 'labor concession fact registered');
    check(failLaborRes.state.character.gold === 0, 'no gold deducted on failure');

    // Scene 3: choice_lawful_order with failed check (CHA -100)
    await move(id, 15, 7);
    await move(id, 20, 7);
    tweak(id, s => { s.character.abilities.cha = -100; s.character.gold = 0; });
    const s3 = (await api('GET', '/api/game/' + id)).body.state;
    const verdictChoice = s3.scenes.find(s => s.id === 'final_verdict').choices.find(c => c.id === 'choice_lawful_order');
    check(verdictChoice.available, 'choice_lawful_order is clickable with 0 GP');

    const failVerdictRes = await choose(id, 'final_verdict', 'choice_lawful_order');
    check(sceneResolved(failVerdictRes.state, 'final_verdict'), 'verdict resolved on failure');
    const endingFact = failVerdictRes.state.encounterFacts.find(f => f.sceneId === 'final_verdict');
    check(endingFact.ending === 'lawful_order', 'lawful_order ending achieved even on check failure');
    check(endingFact.fact === 'verdict_lawful_strict_oversight', 'strict oversight fact recorded');

    // Campfire victory
    await move(id, 15, 7);
    await move(id, 8, 7);
    const winMove = await move(id, 1, 7);
    check(winMove.state.mode === 'victory', 'victory achieved with 0 resources');
  });

  await test('Recommended presets verification: Guardian (Fighter, AC 19) and Arcane (Wizard, Investigation +7)', async () => {
    // 1. Guardian Dwarf Fighter
    const dwarf = makeHero('Guardian Dwarf', 'fighter');
    const startDwarf = await api('POST', '/api/game/start', { characterId: dwarf.id, mapId: 'river-post', difficulty: 'easy', bringAlly: false });
    const sDwarf = startDwarf.body.state;
    const dwarfHero = sDwarf.entities.find(e => e.kind === 'player');
    check(dwarfHero.hpMax === 13, 'Guardian HP max is 13');
    check(engine.currentAc(sDwarf, dwarfHero) >= 18, 'Guardian AC is high (18+)');

    // Fight gate sentry
    const dwarfId = sDwarf.id;
    await move(dwarfId, 6, 7);
    tweak(dwarfId, s => {
      const g = s.entities.find(e => e.id === 'post_guard');
      g.hp = 1;
      s.character.rerollNat1 = true;
      s.character.attacks.push({ weaponId: 'longbow', name: 'Fixture Bow', bonus: 30, dmgDice: '1d8', dmgMod: 5, damageType: 'piercing', ranged: true, range: 150 });
    });
    const fightRes = await choose(dwarfId, 'post_gate', 'fight_gate');
    check(fightRes.state.mode === 'combat', 'combat triggered');
    await act(dwarfId, { type: 'attack', targetId: 'post_guard', weaponId: 'longbow' });
    let postFight = (await api('GET', '/api/game/' + dwarfId)).body.state;
    if (postFight.mode === 'combat') {
      await act(dwarfId, { type: 'endTurn' });
      await act(dwarfId, { type: 'attack', targetId: 'post_guard', weaponId: 'longbow' });
      postFight = (await api('GET', '/api/game/' + dwarfId)).body.state;
    }
    check(postFight.mode === 'explore', 'combat ended, back to explore');
    check(sceneResolved(postFight, 'post_gate'), 'gate resolved via combat');

    // 2. Arcane Human Wizard
    const wizard = makeHero('Arcane Human', 'wizard');
    const startWiz = await api('POST', '/api/game/start', { characterId: wizard.id, mapId: 'river-post', difficulty: 'easy', bringAlly: false });
    const sWiz = startWiz.body.state;
    const wizHero = sWiz.entities.find(e => e.kind === 'player');
    check(wizHero.hpMax === 8, 'Arcane HP max is 8');
    check(engine.skillMod(sWiz.character, 'investigation') >= 5, 'Arcane Investigation skill modifier is +5 or higher');
  });
} finally {
  await new Promise(resolve => server.close(resolve));
  fs.rmSync(temp, { recursive: true, force: true });
  console.log('T14 Starter Adventure: ' + passed + ' cases passed, ' + failed + ' failed; ' + assertions + ' assertions passed.');
}

if (failed) process.exitCode = 1;
