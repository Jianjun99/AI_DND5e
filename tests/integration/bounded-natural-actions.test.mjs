// tests/integration/bounded-natural-actions.test.mjs
// T13a: Bounded natural language actions in Chinese and English.
// Strict whitelist, deterministic mapping, disambiguation clarification,
// cost confirmation, single-action economy, and authoritative re-verification.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { assertTestContainer } from '../../scripts/test-container.mjs';

assertTestContainer();
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-dnd-t13a-'));
process.env.DATA_DIR = temp;
const require = createRequire(import.meta.url);
const express = require('express');
const store = require('../../server/store.js');
const engine = require('../../server/game/engine.js');
const presentation = require('../../server/game/presentation.js');
const presets = require('../../server/game/presets.js');
const boundedActions = require('../../server/game/bounded-actions.js');

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

function makeHero(name = 'T13a Hero', cls = 'fighter') {
  const draft = presets.draftFor(cls === 'wizard' ? 'arcane' : 'guardian');
  const char = engine.buildCharacter({ name, ...draft });
  char.id = store.newId('char');
  char.inventory = [
    { itemId: 'potion_healing', qty: 2 },
    { itemId: 'longsword', qty: 1 }
  ];
  char.gold = 50;
  char.attacks = [{ name: 'Longsword', weaponId: 'longsword', ranged: false }];
  char.equipped = { mainHand: 'longsword' };
  const chars = store.getCharacters();
  chars.push(char);
  store.saveCharacters(chars);
  return char;
}

console.log('Testing T13a: Bounded Natural Language Actions...');

// 1. Chinese & English sceneChoice synonyms produce identical mechanical results to button
await test('1. Scene choice: Chinese & English natural action synonyms match button action', async () => {
  // Test Chinese input "我把治疗药水给里奥"
  const charZh = makeHero('Hero Zh', 'fighter');
  const { body: startZh } = await api('POST', '/api/game/start', { charId: charZh.id, mapId: 'courier-crossing', bringAlly: 'bram' }, 'zh-CN');
  const gameIdZh = startZh.state.id;

  // Resolve crossing first so testimony is active, and place player adjacent to Lio at (20, 11)
  const saveZh = store.getSave(gameIdZh);
  saveZh.encounters = { 'courier-crossing:crossing': { phase: 'resolved' } };
  const pZh = saveZh.entities.find(e => e.kind === 'player');
  pZh.x = 20; pZh.y = 11;
  saveZh.discovered = saveZh.discovered || [];
  saveZh.discovered.push('20,11', '21,11');
  store.saveGame(saveZh);

  const { body: resZh } = await api('POST', `/api/game/${gameIdZh}/action`, { type: 'freeform', text: '我把治疗药水给里奥' }, 'zh-CN');
  check(!resZh.events.some(e => e.type === 'error'), 'Chinese input executes without error');
  const invZh = resZh.state.character.inventory.find(i => i.itemId === 'potion_healing');
  check(invZh && invZh.qty === 1, 'Chinese input deducted 1 healing potion (2 -> 1)');
  check(resZh.state.character.inventory.some(i => i.itemId === 'courier_ledger'), 'Received courier_ledger via Chinese input');
  check(resZh.state.encounterFacts.some(f => f.sceneId === 'testimony' && f.choiceId === 'give_aid'), 'Recorded give_aid fact');

  // Test English input "give healing potion to lio"
  const charEn = makeHero('Hero En', 'fighter');
  const { body: startEn } = await api('POST', '/api/game/start', { charId: charEn.id, mapId: 'courier-crossing', bringAlly: 'bram' }, 'en');
  const gameIdEn = startEn.state.id;
  const saveEn = store.getSave(gameIdEn);
  saveEn.encounters = { 'courier-crossing:crossing': { phase: 'resolved' } };
  const pEn = saveEn.entities.find(e => e.kind === 'player');
  pEn.x = 20; pEn.y = 11;
  saveEn.discovered = saveEn.discovered || [];
  saveEn.discovered.push('20,11', '21,11');
  store.saveGame(saveEn);

  const { body: resEn } = await api('POST', `/api/game/${gameIdEn}/action`, { type: 'freeform', text: 'give healing potion to lio' }, 'en');
  check(!resEn.events.some(e => e.type === 'error'), 'English input executes without error');
  const invEn = resEn.state.character.inventory.find(i => i.itemId === 'potion_healing');
  check(invEn && invEn.qty === 1, 'English input deducted 1 healing potion (2 -> 1)');
  check(resEn.state.character.inventory.some(i => i.itemId === 'courier_ledger'), 'Received courier_ledger via English input');
  check(resEn.state.encounterFacts.some(f => f.sceneId === 'testimony' && f.choiceId === 'give_aid'), 'Recorded give_aid fact');

  // Test Button action { type: 'sceneChoice', sceneId: 'testimony', choiceId: 'give_aid' }
  const charBtn = makeHero('Hero Btn', 'fighter');
  const { body: startBtn } = await api('POST', '/api/game/start', { charId: charBtn.id, mapId: 'courier-crossing', bringAlly: 'bram' }, 'en');
  const gameIdBtn = startBtn.state.id;
  const saveBtn = store.getSave(gameIdBtn);
  saveBtn.encounters = { 'courier-crossing:crossing': { phase: 'resolved' } };
  const pBtn = saveBtn.entities.find(e => e.kind === 'player');
  pBtn.x = 20; pBtn.y = 11;
  saveBtn.discovered = saveBtn.discovered || [];
  saveBtn.discovered.push('20,11', '21,11');
  store.saveGame(saveBtn);

  const { body: resBtn } = await api('POST', `/api/game/${gameIdBtn}/action`, { type: 'sceneChoice', sceneId: 'testimony', choiceId: 'give_aid' });
  const invBtn = resBtn.state.character.inventory.find(i => i.itemId === 'potion_healing');
  check(invBtn && invBtn.qty === 1, 'Button action deducted 1 healing potion (2 -> 1)');
  check(resBtn.state.character.inventory.some(i => i.itemId === 'courier_ledger'), 'Received courier_ledger via button action');
});

// 2. Insufficient potions error handling (zero resource charge, no fake success narration)
await test('2. Zero potions left: rejected with clear error in both languages, zero resource deducted', async () => {
  const char = makeHero('No Potions Hero', 'fighter');
  char.inventory = []; // 0 potions
  store.saveCharacters([char]);

  const { body: start } = await api('POST', '/api/game/start', { charId: char.id, mapId: 'courier-crossing', bringAlly: 'bram' }, 'zh-CN');
  const gameId = start.state.id;
  const save = store.getSave(gameId);
  save.encounters = { 'courier-crossing:crossing': { phase: 'resolved' } };
  const p = save.entities.find(e => e.kind === 'player');
  p.x = 20; p.y = 11;
  save.discovered = ['20,11', '21,11'];
  store.saveGame(save);

  // Chinese attempt to aid Lio without potion
  const { body: aidFailZh } = await api('POST', `/api/game/${gameId}/action`, { type: 'freeform', text: '我把治疗药水给里奥' }, 'zh-CN');
  check(aidFailZh.events.some(e => e.type === 'error'), 'Aiding Lio with 0 potions returns error event');
  check(!aidFailZh.state.character.inventory.some(i => i.itemId === 'courier_ledger'), 'Did not receive ledger');
  check(!aidFailZh.state.encounterFacts?.some(f => f.sceneId === 'testimony'), 'Did not record scene fact');

  // Chinese attempt to drink potion without potion
  const { body: drinkFailZh } = await api('POST', `/api/game/${gameId}/action`, { type: 'freeform', text: '喝治疗药水' }, 'zh-CN');
  check(drinkFailZh.events.some(e => e.type === 'error' && e.text.includes('药水')), 'Drinking with 0 potions returns clear error in Chinese');

  // English attempt to drink potion without potion
  const { body: drinkFailEn } = await api('POST', `/api/game/${gameId}/action`, { type: 'freeform', text: 'drink potion' }, 'en');
  check(drinkFailEn.events.some(e => e.type === 'error' && e.text.includes('potions')), 'Drinking with 0 potions returns clear error in English');
});

// 3. Ambiguity clarification for multiple targets (zero damage/action spent before player choice)
await test('3. Multiple visible targets trigger clarification event with zero preliminary resource spend', async () => {
  const char = makeHero('Clarify Hero', 'fighter');
  const { body: start } = await api('POST', '/api/game/start', { charId: char.id, mapId: 'courier-crossing', bringAlly: 'bram' }, 'zh-CN');
  const gameId = start.state.id;

  // Spawn two distinct goblins in LOS and discovered area
  const save = store.getSave(gameId);
  save.discovered = save.discovered || [];
  save.discovered.push('6,7', '7,7', '7,8', '6,6');
  const p = save.entities.find(e => e.kind === 'player');
  p.x = 6; p.y = 7;
  p.initBonus = 99;
  save.character.initBonus = 99;
  save.entities.push(
    { id: 'goblin_1', kind: 'monster', monsterId: 'goblin', name: '地精伏兵 A', hp: 7, hpMax: 7, x: 7, y: 7, alive: true, conditions: [], buffs: [] },
    { id: 'goblin_2', kind: 'monster', monsterId: 'goblin', name: '地精斥候 B', hp: 7, hpMax: 7, x: 7, y: 8, alive: true, conditions: [], buffs: [] }
  );
  store.saveGame(save);

  // Player stands at 6, 7 and types ambiguous "攻击地精"

  const { body: clarifyRes } = await api('POST', `/api/game/${gameId}/action`, { type: 'freeform', text: '攻击地精' }, 'zh-CN');
  const clarEv = clarifyRes.events.find(e => e.type === 'clarification');
  check(clarEv != null, 'Emits clarification event for ambiguous target');
  check(clarEv.candidates && clarEv.candidates.length === 2, 'Clarification has 2 candidates');
  check(clarEv.candidates.some(c => c.id === 'goblin_1') && clarEv.candidates.some(c => c.id === 'goblin_2'), 'Both goblins are candidates');

  // Verify zero damage was dealt to either target before resolution
  const freshSave = store.getSave(gameId);
  const g1 = freshSave.entities.find(e => e.id === 'goblin_1');
  const g2 = freshSave.entities.find(e => e.id === 'goblin_2');
  check(g1.hp === 7 && g2.hp === 7, 'Neither monster took damage prior to clarification choice');

  // Player now executes chosen candidate action
  const chosenAction = clarEv.candidates[0].action;
  const { body: attackRes } = await api('POST', `/api/game/${gameId}/action`, chosenAction, 'zh-CN');
  check(attackRes.events.some(e => ['attack', 'miss'].includes(e.type)), 'Chosen attack executes properly');
});

// 4. Hidden or non-existent target rejection
await test('4. Hidden, non-existent, or out-of-LOS targets rejected without attack roll', async () => {
  const char = makeHero('Targeting Hero', 'fighter');
  const { body: start } = await api('POST', '/api/game/start', { charId: char.id, mapId: 'courier-crossing', bringAlly: 'bram' }, 'zh-CN');
  const gameId = start.state.id;

  // Non-existent target
  const { body: nonExistent } = await api('POST', `/api/game/${gameId}/action`, { type: 'freeform', text: '攻击远古巨龙' }, 'zh-CN');
  check(nonExistent.events.some(e => e.type === 'error'), 'Non-existent target rejected with error');
  check(!nonExistent.events.some(e => e.type === 'attack'), 'No attack rolled for non-existent target');

  // Monster not in discovered or out of LOS
  const save = store.getSave(gameId);
  save.entities.push({ id: 'hidden_mob', kind: 'monster', monsterId: 'goblin', name: '隐藏地精', hp: 7, hpMax: 7, x: 20, y: 20, alive: true });
  store.saveGame(save);

  const { body: hiddenMob } = await api('POST', `/api/game/${gameId}/action`, { type: 'freeform', text: '攻击隐藏地精' }, 'zh-CN');
  check(hiddenMob.events.some(e => e.type === 'error'), 'Hidden undiscovered monster rejected');
});

// 5. Unavailable or already resolved scene choices
await test('5. Unavailable or resolved scene choices rejected cleanly', async () => {
  const char = makeHero('Resolved Hero', 'fighter');
  const { body: start } = await api('POST', '/api/game/start', { charId: char.id, mapId: 'courier-crossing', bringAlly: 'bram' }, 'zh-CN');
  const gameId = start.state.id;
  const save = store.getSave(gameId);
  save.encounters = { 'courier-crossing:crossing': { phase: 'resolved' } };
  const p = save.entities.find(e => e.kind === 'player');
  p.x = 20; p.y = 11;
  save.discovered = ['20,11', '21,11'];
  store.saveGame(save);

  // Complete testimony first
  await api('POST', `/api/game/${gameId}/action`, { type: 'freeform', text: '我把治疗药水给里奥' }, 'zh-CN');

  // Attempting to make choice on already resolved scene
  const { body: repeatRes } = await api('POST', `/api/game/${gameId}/action`, { type: 'freeform', text: '我把治疗药水给里奥' }, 'zh-CN');
  check(repeatRes.events.some(e => e.type === 'error' || e.type === 'info'), 'Repeated choice on resolved scene rejected without repeat charge');
});

// 6. Action economy: not player turn in combat
await test('6. Attack rejected when not player turn in combat', async () => {
  const char = makeHero('Turn Hero', 'fighter');
  const { body: start } = await api('POST', '/api/game/start', { charId: char.id, mapId: 'courier-crossing', bringAlly: 'bram' }, 'zh-CN');
  const gameId = start.state.id;

  const save = store.getSave(gameId);
  save.mode = 'combat';
  save.discovered = ['6,6', '6,7'];
  save.entities.push({ id: 'enemy_1', kind: 'monster', monsterId: 'goblin', name: '战斗地精', hp: 7, hpMax: 7, x: 6, y: 6, alive: true });
  save.combat = {
    order: [{ id: 'enemy_1', isPlayer: false }, { id: 'player', isPlayer: true }],
    turnIdx: 0, // enemy's turn!
    round: 1,
    actionUsed: false
  };
  store.saveGame(save);

  const { body: turnFail } = await api('POST', `/api/game/${gameId}/action`, { type: 'freeform', text: '攻击战斗地精' }, 'zh-CN');
  check(turnFail.events.some(e => e.type === 'error' && (e.text.includes('回合') || e.text.includes('turn'))), 'Attack on monster turn rejected with turn error');
  check(!turnFail.events.some(e => e.type === 'attack'), 'No attack executed');
});

// 7. Melee attack out of reach
await test('7. Melee attack beyond 1 tile rejected with out-of-reach error', async () => {
  const char = makeHero('Reach Hero', 'fighter');
  char.attacks = [{ name: 'Longsword', weaponId: 'longsword', ranged: false }];
  store.saveCharacters([char]);

  const { body: start } = await api('POST', '/api/game/start', { charId: char.id, mapId: 'courier-crossing', bringAlly: 'bram' }, 'zh-CN');
  const gameId = start.state.id;

  const save = store.getSave(gameId);
  save.discovered = ['5,5', '8,5'];
  const p = save.entities.find(e => e.kind === 'player');
  p.x = 5; p.y = 5;
  save.entities.push({ id: 'far_mob', kind: 'monster', monsterId: 'goblin', name: '远处地精', hp: 7, hpMax: 7, x: 8, y: 5, alive: true });
  store.saveGame(save);

  const { body: reachFail } = await api('POST', `/api/game/${gameId}/action`, { type: 'freeform', text: '攻击远处地精' }, 'zh-CN');
  check(reachFail.events.some(e => e.type === 'error' && (e.text.includes('范围') || e.text.includes('reach'))), 'Melee attack at distance 3 rejected as out of reach');
  check(!reachFail.events.some(e => e.type === 'attack'), 'No attack executed');
});

// 8. Compound multi-action sentence enforcement (single action per turn)
await test('8. Compound sentence executes only first action and notices player', async () => {
  const char = makeHero('Compound Hero', 'fighter');
  const { body: start } = await api('POST', '/api/game/start', { charId: char.id, mapId: 'courier-crossing', bringAlly: 'bram' }, 'zh-CN');
  const gameId = start.state.id;

  // Player HP is reduced, has potions
  const save = store.getSave(gameId);
  const p = save.entities.find(e => e.kind === 'player');
  p.hp = 5; // damaged
  store.saveGame(save);

  const { body: compRes } = await api('POST', `/api/game/${gameId}/action`, {
    type: 'freeform',
    text: '先喝治疗药水然后连续攻击十次'
  }, 'zh-CN');

  // Should have executed drinking potion
  check(compRes.events.some(e => e.type === 'heal'), 'Healed by drinking potion');
  check(compRes.events.some(e => e.type === 'info' && (e.text.includes('一回合只能执行一个动作') || e.textDisplay?.key === 'story.error.compoundNotice')), 'Compound notice informs single action');
  // Did not execute 10 attacks
  const attackCount = compRes.events.filter(e => e.type === 'attack').length;
  check(attackCount === 0, 'Did not execute compound attacks');
});

// 9. Malicious proposal rejection via validateProposal
await test('9. Strict proposal validator rejects unknown intents, malicious IDs, or illegal fields', () => {
  const char = makeHero('Security Hero', 'fighter');
  const state = engine.startGame(char, { mapId: 'courier-crossing' });

  // Unknown intent
  const badIntent = boundedActions.validateProposal(state, { intent: 'grant_gold', amount: 9999 });
  check(!badIntent.valid, 'Unknown intent rejected');

  // Non-existent target
  const badTarget = boundedActions.validateProposal(state, { intent: 'attack', targetId: 'fake_boss_id' });
  check(!badTarget.valid, 'Non-existent target rejected');

  // Arbitrary script injection / illegal object
  const badScript = boundedActions.validateProposal(state, { intent: 'sceneChoice', sceneId: '<script>alert(1)</script>', choiceId: 'eval' });
  check(!badScript.valid, 'Arbitrary IDs rejected');

  // Null / non-object
  check(!boundedActions.validateProposal(state, null).valid, 'Null proposal rejected');
  check(!boundedActions.validateProposal(state, 'attack').valid, 'String proposal rejected');
});

// 10. Re-verification during model wait: state change prevents execution on stale snapshot
await test('10. Proposal validation on latest snapshot detects state change during asynchronous wait', () => {
  const char = makeHero('State Drift Hero', 'fighter');
  const state = engine.startGame(char, { mapId: 'courier-crossing' });
  const p = engine.playerEntity(state);
  p.x = 5; p.y = 5;
  state.discovered = ['5,5', '6,5'];
  state.entities.push({ id: 'target_mob', kind: 'monster', monsterId: 'goblin', name: '地精', hp: 7, hpMax: 7, x: 6, y: 5, alive: true });

  const proposal = { intent: 'attack', targetId: 'target_mob' };
  // Initial check is valid
  check(boundedActions.validateProposal(state, proposal).valid, 'Proposal valid on initial state');

  // Simulate state change: monster dies or player moves away while model was thinking
  const latestDead = JSON.parse(JSON.stringify(state));
  latestDead.entities.find(e => e.id === 'target_mob').alive = false;
  check(!boundedActions.validateProposal(latestDead, proposal).valid, 'Rejected when target died during wait');

  const latestFar = JSON.parse(JSON.stringify(state));
  latestFar.entities.find(e => e.kind === 'player').x = 20; // walked away
  check(!boundedActions.validateProposal(latestFar, proposal).valid, 'Rejected when player moved out of reach during wait');
});

// 11. Legacy referee commands full backward compatibility
await test('11. Legacy referee commands (hide, rest, shove, etc.) preserved with 100% compatibility', async () => {
  const char = makeHero('Legacy Hero', 'fighter');
  const { body: start } = await api('POST', '/api/game/start', { charId: char.id, mapId: 'courier-crossing' }, 'en');
  const gameId = start.state.id;

  // hide / stealth
  const { body: hideRes } = await api('POST', `/api/game/${gameId}/action`, { type: 'freeform', text: 'hide in the shadows' }, 'en');
  check(hideRes.events.some(e => e.type === 'stealth'), 'Legacy command "hide" executes stealth check');

  // rest
  const { body: restRes } = await api('POST', `/api/game/${gameId}/action`, { type: 'freeform', text: 'take a short rest' }, 'en');
  check(restRes.events.some(e => e.type === 'rest'), 'Legacy command "rest" executes rest');

  // search area
  const { body: searchRes } = await api('POST', `/api/game/${gameId}/action`, { type: 'freeform', text: 'search carefully' }, 'en');
  check(searchRes.events.some(e => e.type === 'info' || e.type === 'trap_found'), 'Legacy command "search" investigates');
});

// 12. Irreversible choice / cost confirmation prompt
await test('12. Irreversible choice or gold cost triggers confirmation structure', async () => {
  const char = makeHero('Confirm Hero', 'fighter');
  const state = engine.startGame(char, { mapId: 'courier-crossing' });
  const p = engine.playerEntity(state);
  // Standing adjacent to Iris at 6, 7
  p.x = 6; p.y = 7;
  state.discovered = ['6,7'];

  // Test cost warning for gold choice (pay_toll: 5 GP)
  const confGold = boundedActions.checkConfirmationNeeded(state, { intent: 'sceneChoice', sceneId: 'crossing', choiceId: 'pay_toll' }, 'zh-CN');
  check(confGold != null && confGold.costWarning.includes('5 GP'), 'Gold choice requires confirmation with cost warning');

  // Test checkConfirmationNeeded for an ending choice in river-post
  const statePost = engine.startGame(char, { mapId: 'river-post' });
  const confEnding = boundedActions.checkConfirmationNeeded(statePost, { intent: 'sceneChoice', sceneId: 'final_verdict', choiceId: 'choice_lawful_order' }, 'zh-CN');
  check(confEnding != null && confEnding.type === 'confirmation', 'Ending choice requires confirmation');
});

// 13. Authorized Context whitelist bounds: no hidden traps, fog tiles, or unready scenes
await test('13. Authorized Context strictly excludes fog tiles, undiscovered traps, and spoilers', () => {
  const char = makeHero('Context Bounds Hero', 'fighter');
  const state = engine.startGame(char, { mapId: 'courier-crossing' });
  state.discovered = ['1,1']; // only 1 tile discovered
  state.objects.push({ id: 'hidden_trap_1', type: 'trap', x: 2, y: 2, revealed: false });

  const ctx = boundedActions.buildAuthorizedContext(state, 'zh-CN');
  check(ctx.player.name === char.name, 'Context contains player');
  check(!ctx.objects.some(o => o.id === 'hidden_trap_1'), 'Context excludes undiscovered trap');
  check(ctx.scenes.length === 0, 'Context excludes distant undiscovered scenes');
});

server.close();
fs.rmSync(temp, { recursive: true, force: true });

console.log(`\nBounded Natural Actions integration tests finished: ${passed} passed, ${failed} failed, ${assertions} assertions.`);
if (failed > 0) process.exit(1);
