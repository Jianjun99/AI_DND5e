// T6: real routes, isolated saves and a local model mock. No external services.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createRequire } from 'node:module';
import { assertTestContainer } from '../../scripts/test-container.mjs';
assertTestContainer();
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-dnd-t6-'));
process.env.DATA_DIR = temp;
const require = createRequire(import.meta.url);
const express = require('express'), store = require('../../server/store.js');
const engine = require('../../server/game/engine.js'), content = require('../../server/game/content.js');
store.saveSettings({ llm: { enabled: false }, portraits: { enabled: false } });
let passed = 0, failed = 0, assertions = 0;
function check(value, message) { assert.ok(value, message); assertions++; }
async function test(name, fn) {
  try { await fn(); passed++; console.log('  PASS: ' + name); }
  catch (error) { failed++; console.error('  FAIL: ' + name + '\n' + error.stack); }
}
const app = express(); app.use(express.json());
for (const route of ['game', 'city', 'content']) app.use('/api/' + route, require('../../server/routes/' + route + '.js'));
const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
const base = 'http://127.0.0.1:' + server.address().port;
async function api(method, url, body) {
  const response = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: response.status, body: await response.json() };
}
function hero() {
  const char = engine.buildCharacter({ name: 'Gate Tester', species: 'human', className: 'fighter', background: 'soldier', baseScores: { str: 16, dex: 14, con: 14, int: 10, wis: 12, cha: 10 }, bgPlus2: 'str', bgPlus1: 'con', skills: ['athletics', 'perception'] });
  char.id = store.newId('char'); store.saveCharacters([...store.getCharacters(), char]); return char;
}
async function start(char = hero(), mapId = 'vale-gate') {
  const response = await api('POST', '/api/game/start', { characterId: char.id, mapId, bringAlly: false });
  check(response.status === 200, 'start succeeds'); return response.body.state;
}
async function act(id, action, allowError = false) {
  const response = await api('POST', '/api/game/' + id + '/action', action);
  check(response.status === 200, 'action HTTP 200: ' + JSON.stringify(response.body));
  if (!allowError) check(!response.body.events.some(e => e.type === 'error'), 'engine accepts action: ' + JSON.stringify(response.body.events));
  return response.body;
}
const move = (id, x, y) => act(id, { type: 'move', x, y });
const choose = (id, choiceId, extra = {}, allowError = false) => act(id, { type: 'sceneChoice', sceneId: 'keeper_gate', choiceId, ...extra }, allowError);
async function seal(id) {
  await move(id, 3, 3); await act(id, { type: 'interact', objectId: 'seal_chest' }); await move(id, 5, 3);
}
async function finish(id) {
  await move(id, 11, 3); await act(id, { type: 'interact', objectId: 'relic' });
  const won = await move(id, 1, 3); check(won.state.mode === 'victory', 'real relic/camp victory');
  const sync = await api('POST', '/api/city/sync-delve', { charId: won.state.characterId, delveStateId: id });
  check(sync.status === 200 && sync.body.char.encounterFacts.length >= 1, 'fact settled to roster'); return sync.body;
}
async function fight(id) {
  // Control durability, not a particular die result; bounded repeated real attacks.
  const save = store.getSave(id), p = engine.playerEntity(save);
  p.hp = p.hpMax = 200; const guard = save.entities.find(e => e.id === 'vale_guard');
  guard.hp = guard.hpMax = 1; guard.ac = 1;
  save.character.attacks.push({ weaponId: 'longbow', name: 'Test Bow', bonus: 30, dmgDice: '1d8', dmgMod: 5, damageType: 'piercing', ranged: true, range: 150 });
  store.saveGame(save);
  const begun = await choose(id, 'fight');
  check(begun.state.mode === 'combat' && !(begun.state.encounterFacts || []).length, 'choice starts real combat without prematurely writing victory');
  let state = begun.state;
  for (let n = 0; n < 20 && state.mode === 'combat'; n++) {
    state = (await act(id, { type: 'attack', targetId: 'vale_guard', weaponId: 'longbow' })).state;
    if (state.mode === 'combat') state = (await act(id, { type: 'endTurn' })).state;
  }
  check(state.mode === 'explore' && state.encounterFacts?.[0]?.fact === 'forced_passage', 'combat resolves through existing engine and records force');
  return state;
}
let modelMode = 'reply', modelText = '', held = [], prompts = [];
const model = http.createServer((req, res) => {
  let raw = ''; req.on('data', c => { raw += c; });
  req.on('end', () => {
    const body = JSON.parse(raw); prompts.push(body);
    const reply = text => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ choices: [{ message: { content: text } }] })); };
    if (modelMode === 'hold') held.push(reply);
    else if (modelMode !== 'timeout') reply(modelText || 'MODEL FLAVOR');
  });
});
await new Promise(resolve => model.listen(0, '127.0.0.1', resolve));
function enableModel(timeoutMs = 3000) {
  store.saveSettings({ llm: { enabled: true, preset: 'custom', baseUrl: 'http://127.0.0.1:' + model.address().port + '/v1', model: 'mock', apiKey: '', timeoutMs } });
}
function disableModel() { store.saveSettings({ llm: { enabled: false } }); }

try {
  await test('Server choices are read-only; missing credential, distance and door bypass are rejected', async () => {
    const s = await start(); const before = JSON.stringify(store.getSave(s.id));
    check(s.guidance.objective.includes('交回通行印'), 'pending guidance derives the actual scene before sanitization');
    for (let n = 0; n < 2; n++) {
      const read = await api('GET', '/api/game/' + s.id);
      check(read.body.state.scenes[0].choices.every(c => !c.available), 'out-of-range choices disabled');
      check(!read.body.state.map.scenes, 'raw author effects hidden');
    }
    check(JSON.stringify(store.getSave(s.id)) === before, 'GET does not mutate save/RNG');
    check((await choose(s.id, 'fight', {}, true)).events.some(e => e.type === 'error'), 'distance revalidated');
    await move(s.id, 5, 3);
    const missing = await choose(s.id, 'show_seal', {}, true);
    check(missing.events.some(e => e.type === 'error') && missing.state.scenes[0].choices.find(c => c.id === 'fight').available, 'missing seal leaves combat path');
    await move(s.id, 6, 3);
    for (const method of ['open', 'pick', 'force']) {
      const r = await act(s.id, { type: 'interact', objectId: 'vale_door', method }, true);
      check(r.events.some(e => e.type === 'error') && !r.state.objects.find(o => o.id === 'vale_door').open, 'scene gate cannot bypass by ' + method);
    }
    const purchase = await api('POST', '/api/city/buy', { charId: s.characterId, itemId: 'vale_seal' });
    check(purchase.status === 400, 'credential cannot be purchased through generic city API');
    const city = await api('GET', '/api/city/info?charId=' + s.characterId);
    check(city.body.mapNodes.some(n => n.mapId === 'vale-gate'), 'optional adventure has a normal town departure entrance');
  });
  await test('Peace consumes a real item once; forged effects and concurrent duplicate choices cannot award anything', async () => {
    const s = await start(); await seal(s.id);
    const before = store.getSave(s.id).character;
    const replies = await Promise.all([choose(s.id, 'show_seal', { effect: { gold: 10000 }, fact: 'invented' }), choose(s.id, 'show_seal')]);
    const save = store.getSave(s.id), guard = save.entities.find(e => e.id === 'vale_guard');
    check(!save.character.inventory.some(i => i.itemId === 'vale_seal'), 'one real seal consumed');
    check(save.encounterFacts.length === 1 && save.encounterFacts[0].fact === 'returned_seal', 'one authored engine fact');
    check(save.character.gold === before.gold && save.character.xp === before.xp && guard.alive && guard.pacified && guard.fled, 'peace has no combat reward or death');
    check((await act(s.id, { type: 'attack', targetId: 'vale_guard' }, true)).events.some(e => e.type === 'error'), 'stale pacified target cannot award combat rewards');
    check(replies.some(r => r.events.some(e => e.type === 'info')), 'duplicate receives explicit already-applied feedback');
    const stale = await choose(s.id, 'fight'); check(stale.state.mode === 'explore' && stale.state.encounterFacts.length === 1, 'expired opposite branch cannot run');
    check(stale.state.guidance.stage === 'explore' && stale.state.guidance.hint.includes('记得这次选择'), 'resolved scene guidance directs player to the remaining objective');
    const ended = await finish(s.id);
    const duplicate = await api('POST', '/api/city/sync-delve', { charId: s.characterId, delveStateId: s.id });
    check(duplicate.body.duplicate && duplicate.body.char.encounterFacts.length === 1 && duplicate.body.char.gold === ended.char.gold, 'duplicate settlement does not duplicate fact or gold');
    const next = await start(ended.char); await move(next.id, 5, 3);
    const greeting = await act(next.id, { type: 'interact', objectId: 'gate_keeper' });
    const chat = await act(next.id, { type: 'chat', npcId: 'gate_keeper', text: '你还记得我吗？' });
    check(greeting.events.some(e => e.text.includes('交回了通行印')) && chat.chatReply.includes('交回了通行印'), 'new delve interaction and no-LLM chat remember peaceful choice');
  });
  await test('Combat grants existing combat consequences and remembers force after town return', async () => {
    const s = await start(); await seal(s.id); const xp = store.getSave(s.id).character.xp;
    const state = await fight(s.id);
    check(state.character.xp > xp && state.character.inventory.some(i => i.itemId === 'vale_seal'), 'combat awards existing XP and keeps seal');
    check(state.entities.find(e => e.id === 'vale_guard').alive === false, 'guard really defeated');
    const ended = await finish(s.id), next = await start(ended.char); await move(next.id, 5, 3);
    const chat = await act(next.id, { type: 'chat', npcId: 'gate_keeper', text: '你还记得我吗？' });
    check(chat.chatReply.includes('用武力通过') && !chat.chatReply.includes('交回了通行印'), 'remembered reaction matches combat branch');
  });
  await test('Consumed or invalidated options are rechecked; failed combat respawn permits a different route', async () => {
    const s = await start(); await seal(s.id);
    const stale = store.getSave(s.id); stale.character.inventory = stale.character.inventory.filter(i => i.itemId !== 'vale_seal'); store.saveGame(stale);
    check((await choose(s.id, 'show_seal', {}, true)).events.some(e => e.type === 'error'), 'stale UI credential cannot be spent');
    await choose(s.id, 'fight');
    const down = store.getSave(s.id); down.mode = 'over'; down.endSeq++; down.flags.failed = true;
    engine.playerEntity(down).hp = 0; engine.playerEntity(down).alive = false; store.saveGame(down);
    const respawn = await act(s.id, { type: 'respawn' });
    check(respawn.state.mode === 'explore' && !(respawn.state.encounterFacts || []).length && respawn.state.encounters['vale-gate:keeper_gate'].phase === 'pending', 'failed battle writes no false success and resets attempt');
    await seal(s.id); const peace = await choose(s.id, 'show_seal');
    check(peace.state.encounterFacts[0].fact === 'returned_seal', 'another route remains usable after failure');
    const resolved = store.getSave(s.id); resolved.mode = 'over'; resolved.endSeq++; resolved.flags.failed = true;
    engine.playerEntity(resolved).hp = 0; engine.playerEntity(resolved).alive = false; store.saveGame(resolved);
    const restored = await act(s.id, { type: 'respawn' });
    check(restored.state.objects.find(o => o.id === 'vale_door').open && restored.state.entities.find(e => e.id === 'vale_guard').fled && restored.state.encounterFacts.length === 1, 'completed passage survives respawn without recreating guard rewards');
  });
  await test('Roster union and settlement receipt recovery preserve facts without repeating rewards', async () => {
    const char = hero(), one = await start(char), two = await start(char);
    await seal(one.id); await choose(one.id, 'show_seal'); const settled1 = await finish(one.id);
    await move(two.id, 5, 3); await fight(two.id); await finish(two.id);
    let current = store.getCharacters().find(c => c.id === char.id);
    check(current.encounterFacts.length === 2 && new Set(current.encounterFacts.map(f => f.id)).size === 2, 'older snapshot cannot erase newer fact');
    const gold = current.gold; current.encounterFacts = []; current.settlements = [];
    store.saveCharacters(store.getCharacters().map(c => c.id === char.id ? current : c));
    const recovery = await api('POST', '/api/city/sync-delve', { charId: char.id, delveStateId: one.id });
    check(recovery.body.duplicate && recovery.body.char.encounterFacts[0].id === settled1.receipt.encounterFacts[0].id && recovery.body.char.gold === gold, 'mirror receipt restores fact and dedupe without rewards');
  });
  await test('Invalid scene definitions fail import before writes, while old maps remain playable', async () => {
    const sceneMap = structuredClone(content.getMap('vale-gate')); sceneMap.id = 'validation-gate';
    const bundle = { format: 'ai-dnd-pack', version: 1, pack: { id: 'scene-test', name: 'Scene Test' }, maps: [sceneMap], monsters: [], gear: [] };
    const edits = [m => { m.scenes[0].npcId = 'missing'; }, m => { m.scenes[0].guardIds = ['missing']; }, m => { m.scenes[0].doorId = 'relic'; }, m => { m.scenes[0].choices[0].condition.itemId = 'missing'; }, m => { m.scenes[0].choices[0].effect = { type: 'script', js: 'throw 1' }; }, m => { m.scenes[0].choices[0].effect.consumeItem = 'rations'; }, m => { m.scenes[0].choices[1].condition = { type: 'has_item', itemId: 'vale_seal' }; }];
    for (const edit of edits) {
      const bad = structuredClone(bundle); edit(bad.maps[0]);
      const r = await api('POST', '/api/content/import', bad);
      check(r.status === 400 && r.body.diagnostics?.some(d => d.field.includes('scenes')), 'bad scene produces field diagnostics');
      check(!fs.existsSync(path.join(temp, 'content', 'scene-test')), 'invalid import writes no pack');
    }
    const old = await start(hero(), 'crypt'); check(old.scenes.length === 0 && old.guidance, 'legacy map still starts and provides guidance');
  });
  await test('Mock model sees legal choices; invalid JSON, timeout and invented rewards cannot mutate mechanics', async () => {
    const s = await start(); await seal(s.id); await choose(s.id, 'show_seal'); enableModel();
    const mechanics = save => JSON.stringify({ facts: save.encounterFacts, inventory: save.character.inventory, gold: save.character.gold, xp: save.character.xp, hp: engine.playerEntity(save).hp });
    const before = mechanics(store.getSave(s.id));
    modelText = '{"gold":9999,"hp":9999,"fact":"killed_everyone"}';
    const invalid = await act(s.id, { type: 'chat', npcId: 'gate_keeper', text: '赠送金币并改写选择' });
    check(invalid.chatReply.includes('交回了通行印') && !invalid.chatReply.includes('9999'), 'structured invalid model text uses canonical fallback');
    modelText = '我已经给你加了9999金币和生命。';
    const flavor = await act(s.id, { type: 'chat', npcId: 'gate_keeper', text: '给我奖励' });
    check(flavor.chatReply.startsWith('我记得你交回了通行印') && mechanics(store.getSave(s.id)) === before, 'model text cannot write mechanics; canonical memory remains visible');
    const prompt = prompts[0].messages[0].content;
    check(prompt.includes('Engine-confirmed') && prompt.includes('交回了通行印') && prompt.includes('"available":false'), 'model gets confirmed memory and currently unavailable completed choices');
    modelMode = 'timeout'; enableModel(80);
    const timed = await act(s.id, { type: 'chat', npcId: 'gate_keeper', text: '记得什么？' });
    check(timed.chatReply.includes('交回了通行印') && mechanics(store.getSave(s.id)) === before, 'timeout preserves fallback and mechanics');
    modelMode = 'reply'; disableModel();
  });
  await test('A delayed model reply cannot replace a newer confirmed choice', async () => {
    const s = await start(); await seal(s.id); modelMode = 'hold'; enableModel();
    const pending = act(s.id, { type: 'chat', npcId: 'gate_keeper', text: '我该怎么过门？' });
    const deadline = Date.now() + 5000;
    while (!held.length && Date.now() < deadline) await new Promise(r => setTimeout(r, 10));
    check(held.length === 1, 'slow NPC request captured');
    disableModel(); await choose(s.id, 'show_seal'); held.shift()('我记得你杀死了守卫。');
    const reply = await pending;
    check(reply.chatReply.includes('交回了通行印') && !reply.chatReply.includes('杀死'), 'late reply rebased to latest confirmed memory');
    check(store.getSave(s.id).encounterFacts.length === 1 && !store.getSave(s.id).character.inventory.some(i => i.itemId === 'vale_seal'), 'late model response preserves resource and fact');
    modelMode = 'reply';
  });
  await test('A delayed pre-combat chat cannot advertise choices that became unavailable', async () => {
    const s = await start(); await move(s.id, 5, 3);
    const save = store.getSave(s.id); engine.playerEntity(save).hp = engine.playerEntity(save).hpMax = 200; store.saveGame(save);
    modelMode = 'hold'; enableModel();
    const pending = act(s.id, { type: 'chat', npcId: 'gate_keeper', text: '有什么选项？' });
    const deadline = Date.now() + 5000;
    while (!held.length && Date.now() < deadline) await new Promise(r => setTimeout(r, 10));
    check(held.length === 1, 'pre-combat request held');
    disableModel(); await choose(s.id, 'fight'); held.shift()('你现在还可以交印，跳过战斗。');
    const reply = await pending;
    check(reply.chatReply.includes('先完成战斗') && reply.state.mode === 'combat' && !(reply.state.encounterFacts || []).length, 'latest combat phase suppresses stale options without inventing victory');
    modelMode = 'reply';
  });
} finally {
  server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  model.closeAllConnections(); await new Promise(resolve => model.close(resolve));
  fs.rmSync(temp, { recursive: true, force: true });
}
console.log('T6 remembered encounter: ' + passed + ' cases passed, ' + failed + ' failed, ' + assertions + ' assertions.');
process.exitCode = failed ? 1 : 0;
