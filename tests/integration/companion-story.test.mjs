// T12a: the real Bram companion story — gating, attitudes, memory boundaries.
// Mirrors the T11 branching-adventure harness: real HTTP, deterministic outcomes,
// mock model for knowledge boundaries.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createRequire } from 'node:module';
import { assertTestContainer } from '../../scripts/test-container.mjs';
import { resolveDisplay } from '../../public/js/localization/locale.mjs';
assertTestContainer();
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-dnd-t12a-'));
process.env.DATA_DIR = temp;
const require = createRequire(import.meta.url);
const express = require('express'), store = require('../../server/store.js');
const engine = require('../../server/game/engine.js'), content = require('../../server/game/content.js');
const presentation = require('../../server/game/presentation.js'), retrieval = require('../../server/game/retrieval.js');
store.saveSettings({ llm: { enabled: false }, portraits: { enabled: false } });
let passed = 0, failed = 0, assertions = 0;
function check(value, message) { assert.ok(value, message); assertions++; }
async function test(name, fn) { try { await fn(); passed++; console.log('  PASS: ' + name); } catch (error) { failed++; console.error('  FAIL: ' + name + '\n' + error.stack); } }
const app = express(); app.use(express.json()); app.use(require('../../server/locale.js').localeMiddleware); app.use(presentation.middleware);
for (const name of ['game', 'city', 'characters', 'content']) app.use('/api/' + name, require('../../server/routes/' + name + '.js'));
const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
const base = 'http://127.0.0.1:' + server.address().port;
async function api(method, url, body, locale = 'en') {
  const r = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', 'X-Game-Locale': locale }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, body: await r.json() };
}
function hero() {
  const char = engine.buildCharacter({ name: 'T12a <raw> {p1}', species: 'human', className: 'fighter', background: 'soldier', baseScores: { str: 16, dex: 14, con: 14, int: 10, wis: 12, cha: 10 }, bgPlus2: 'str', bgPlus1: 'con', skills: ['athletics', 'persuasion'] });
  char.id = store.newId('char'); char.gold = 60; store.saveCharacters([...store.getCharacters(), char]); return char;
}
async function start(char = hero()) {
  const r = await api('POST', '/api/game/start', { characterId: char.id, mapId: 'brams-pack', difficulty: 'easy', bringAlly: 'bram' });
  check(r.status === 200, 'story starts with Bram: ' + JSON.stringify(r.body));
  const state = r.body.state;
  check(state.entities.some(e => e.kind === 'ally' && e.allyId === 'bram' && e.alive), 'the real Bram ally is in the party');
  return state;
}
async function act(id, action, locale = 'en', allowError = false) {
  const r = await api('POST', '/api/game/' + id + '/action', action, locale);
  check(r.status === 200, 'action HTTP 200');
  if (!allowError) check(!r.body.events.some(e => e.type === 'error'), JSON.stringify(r.body.events));
  return r.body;
}
const move = (id, x, y) => {
  const state = store.getSave(id), p = engine.playerEntity(state);
  return p.x === x && p.y === y ? Promise.resolve({ state, events: [] }) : act(id, { type: 'move', x, y });
};
const choose = (id, sceneId, choiceId, locale = 'en') => act(id, { type: 'sceneChoice', sceneId, choiceId }, locale);
function tweak(id, fn) { const s = store.getSave(id); fn(s); store.saveGame(s); }
function checkRange(id, success) { tweak(id, s => { s.character.abilities.cha = success ? 100 : -100; s.character.uses.lucky_reroll = 0; }); }
function bram(id) { return store.getSave(id).entities.find(e => e.kind === 'ally' && e.allyId === 'bram'); }
function facts(id) { return store.getSave(id).encounterFacts || []; }
function lootWestCache(id) { return move(id, 3, 8).then(() => act(id, { type: 'interact', objectId: 'west_cache' })).then(() => move(id, 1, 6)); }
async function hollowFight(id) {
  const base = bram(id).loyalty == null ? 50 : bram(id).loyalty;
  let s = (await choose(id, 'hollow', 'hunt')).state;
  // The fixture lands after the choice so bram adjacency still gates it. Both hounds
  // are pulled adjacent to the hero (clear melee lanes, no blocked-shot variance) and
  // Bram is padded so his combat health cannot perturb the authored loyalty curve.
  await tweak(id, x => {
    const p = engine.playerEntity(x);
    p.x = 13; p.y = 6; p.hp = p.hpMax = 200;
    const ally = x.entities.find(e => e.kind === 'ally' && e.allyId === 'bram');
    if (ally) ally.hp = ally.hpMax = 200;
    const [g1, g2] = x.entities.filter(e => ['hound_gate', 'hound_rocks'].includes(e.id));
    if (g1) { g1.x = 13; g1.y = 5; g1.hp = g1.hpMax = 1; g1.ac = 1; }
    if (g2) { g2.x = 13; g2.y = 7; g2.hp = g2.hpMax = 1; g2.ac = 1; }
    x.character.attacks.push({ weaponId: 'longbow', name: 'Fixture Bow', bonus: 30, dmgDice: '1d8', dmgMod: 5, damageType: 'piercing', ranged: true, range: 150 });
  });
  for (let n = 0; n < 40 && s.mode === 'combat'; n++) {
    const guard = s.entities.find(e => ['hound_gate', 'hound_rocks'].includes(e.id) && e.alive && !e.fled);
    if (guard) s = (await act(id, { type: 'attack', targetId: guard.id, weaponId: 'longbow' }, 'en', true)).state;
    if (s.mode === 'combat') s = (await act(id, { type: 'endTurn' })).state;
  }
  check(s.mode === 'explore' && facts(id)[0].fact === 'bloodied_trail', 'real combat confirms the forced crossing exactly once');
  check(facts(id)[0].loyaltyDelta === 3 && bram(id).loyalty === base + 3, 'engine applied the authored +3 to the real ally');
  return s;
}
async function tovaSide(id, route = 'hear_out') { await move(id, 15, 9); return (await choose(id, 'witness', route)).state; }
async function end(id, route, locale = 'en') { return (await choose(id, 'reckoning', route, locale)).state; }
async function settle(id) {
  const won = await move(id, 1, 6);
  check(won.state.mode === 'victory', 'only final fact + real campfire grants victory');
  const r = await api('POST', '/api/city/sync-delve', { charId: won.state.characterId, delveStateId: id });
  check(r.status === 200, 'settlement accepted'); return r.body;
}
let mode = 'reply', held = [], prompts = [];
const model = http.createServer((req, res) => { let raw = ''; req.on('data', c => raw += c); req.on('end', () => { const body = JSON.parse(raw); prompts.push(body); const reply = text => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ choices: [{ message: { content: text || 'MODEL FLAVOR' } }] })); }; if (mode === 'hold') held.push(reply); else if (mode !== 'timeout') reply(mode === 'json' ? '{"gold":99999,"ending":"invented"}' : 'MODEL FLAVOR'); }); });
await new Promise(resolve => model.listen(0, '127.0.0.1', resolve));
const enable = timeout => store.saveSettings({ llm: { enabled: true, preset: 'custom', baseUrl: 'http://127.0.0.1:' + model.address().port + '/v1', model: 'mock', apiKey: '', timeoutMs: timeout || 2000 } });
const disable = () => store.saveSettings({ llm: { enabled: false } });

try {
  await test('Companion pack content is bilingual, validated and projected into the public directory', async () => {
    const reg = content.reload();
    check(!reg.diagnostics.some(d => d.severity === 'error'), JSON.stringify(reg.diagnostics.filter(d => d.packId === 'brams-pack')));
    const m = content.getMap('brams-pack');
    check(m.scenes.length === 3 && m.victory.type === 'story' && m.story.companion === 'bram', 'three choices, story victory, real companion declared');
    check(m.scenes[0].companion === true && !m.scenes[0].npcId && m.scenes[1].npcId === 'tova' && m.scenes[2].requiresScene === 'witness', 'companion scene speaks through the ally, later stages through Tova');
    const endings = new Set(); m.scenes[2].choices.forEach(c => { endings.add(c.ending); if (c.failure) endings.add(c.failure.ending); });
    check(endings.size >= 2, 'at least two distinct endings: ' + [...endings].join(','));
    for (const scene of m.scenes) for (const node of [scene, ...scene.choices, ...scene.choices.filter(c => c.failure).map(c => c.failure)]) for (const lang of ['en', 'zh-CN']) {
      check(Object.values(node.localized[lang]).every(t => typeof t === 'string' && t.length > 0), 'handwritten dialogue ' + lang);
      if (node.reactions) for (const reaction of Object.values(node.reactions)) check(reaction.localized[lang].text, 'handwritten reaction ' + lang);
    }
    const entry = content.adventureDirectory().adventures.find(a => a.id === 'brams-pack');
    check(entry.requiresCompanion === 'bram' && entry.requiresCompanionName.localized['zh-CN'] === '斥候布拉姆', 'directory projects the companion requirement with a localized name');
  });

  await test('Invalid companion references, loyalty ranges and reaction keys fail atomically', async () => {
    const b = (await api('GET', '/api/content/pack/brams-pack/export')).body;
    const edits = [
      m => { m.story.companion = 'missing_ally'; },
      m => { delete m.story.companion; },
      m => { m.scenes[0].npcId = 'tova'; },
      m => { m.scenes[0].companion = 'bram'; },
      m => { m.scenes[0].choices[0].effect.loyalty = 26; },
      m => { m.scenes[0].choices[0].effect.loyalty = -26; },
      m => { m.scenes[0].choices[0].effect.loyalty = 1.5; },
      m => { m.scenes[2].choices[2].failure.loyalty = 99; },
      m => { m.scenes[0].choices[0].reactions.iris = { text: 'a stranger from another story' }; },
      m => { m.scenes[1].choices[0].reactions.valeria = { text: 'unrelated companion opinion' }; },
      m => { m.scenes[2].choices[1].effect.loyalty = 'eight'; }
    ];
    for (const edit of edits) {
      const bad = structuredClone(b); bad.pack.id = 't12a-invalid'; edit(bad.maps[0]);
      const r = await api('POST', '/api/content/import', bad);
      check(r.status === 400 && r.body.diagnostics?.some(d => d.severity === 'error'), 'finite protocol rejects: ' + edit.toString().slice(0, 70));
      check(!fs.existsSync(path.join(temp, 'content', 't12a-invalid')), 'no partial install');
    }
  });

  await test('The gate refuses to start without the real Bram, and recruiting stays manual', async () => {
    const char = hero();
    const solo = await api('POST', '/api/game/start', { characterId: char.id, mapId: 'brams-pack', bringAlly: false });
    check(solo.status === 400 && solo.body.errorDisplay?.key === 'api.requiresCompanion', 'solo start refused with a bilingual pointer: ' + JSON.stringify(solo.body));
    const wrong = await api('POST', '/api/game/start', { characterId: char.id, mapId: 'brams-pack', bringAlly: 'valeria' });
    check(wrong.status === 400 && wrong.body.errorDisplay.key === 'api.requiresCompanion', 'a different companion is not a substitute');
    for (const lang of ['en', 'zh-CN']) {
      const msg = resolveDisplay(solo.body.errorDisplay, solo.body.error, lang);
      check(msg.includes(lang === 'en' ? 'Bram' : '布拉姆'), 'rejection names the companion in ' + lang);
    }
    const none = await api('POST', '/api/game/start', { characterId: char.id, mapId: 'brams-pack', bringAlly: 'none' });
    check(none.status === 400, 'explicit none is refused too');
    const fresh = store.getCharacters().find(c => c.id === char.id);
    check(!fresh.companion, 'the tavern recruit flag is untouched — nothing auto-recruited');
    const s = await start(char);
    check(store.getSave(s.id).companionQuest === undefined && !store.getSave(s.id).character.companionQuests?.bram, 'the kill-quest namespace is not touched by starting this story');
    check(engine.sceneViews(store.getSave(s.id))[0].companion?.id === 'bram', 'companion scene view names the real ally');
  });

  await test('Combat route: real fight, +3 attitude, then hear-out and reclaim grant +8 and the ending', async () => {
    const s = await start();
    await hollowFight(s.id);
    await tovaSide(s.id, 'hear_out');
    check(facts(s.id)[1].fact === 'heard_tova' && store.getSave(s.id).character.inventory.some(i => i.itemId === 'brams_pack' && i.qty > 0), 'the real pack was handed over');
    check(bram(s.id).loyalty === 53, 'listening costs no loyalty');
    const ended = await end(s.id, 'reclaim');
    check(ended.story.ending === 'reclaimed' && ended.story.choices.length === 3, 'three-stage story completes with reclaimed');
    check(facts(s.id)[2].fact === 'pack_reclaimed' && facts(s.id)[2].loyaltyDelta === 8, 'reclaim records +8');
    check(bram(s.id).loyalty === 61, 'ally loyalty is 50+3+8');
    check(!store.getSave(s.id).character.inventory.some(i => i.itemId === 'brams_pack'), 'the pack left the inventory once');
    const quest = store.getSave(s.id).companionQuest;
    check(quest && quest.allyId === 'bram' && quest.target === 'crypt_hound', 'crossing loyalty 60 offers the old kill-quest beside the story');
    const r = await settle(s.id);
    check(r.receipt.story.ending === 'reclaimed' && r.char.companionLoyalty.bram === 66, 'settlement rides the real attitude plus the standing victory bonus back to the roster');
    check(r.char.companionQuests?.bram === 'offered' && r.receipt.story.choices.length === 3, 'quest namespace and story facts coexist on the roster');
  });

  await test('Peace route: ration lure, real potion, paid replacement and a milder attitude', async () => {
    const s = await start();
    await lootWestCache(s.id);
    check(store.getSave(s.id).character.inventory.some(i => i.itemId === 'trail_ration'), 'the camp cache held the ration');
    const gold = store.getSave(s.id).character.gold;
    await choose(s.id, 'hollow', 'lure');
    check(facts(s.id)[0].fact === 'lured_hounds' && bram(s.id).loyalty === 51 && !store.getSave(s.id).character.inventory.some(i => i.itemId === 'trail_ration'), 'lure consumed one ration and granted +1');
    check(store.getSave(s.id).objects.find(o => o.id === 'hound_barricade').open, 'passage opened the barricade without a fight');
    await tovaSide(s.id, 'treat');
    const potions = store.getSave(s.id).character.inventory.find(i => i.itemId === 'potion_healing').qty;
    check(facts(s.id)[1].fact === 'treated_tova' && store.getSave(s.id).character.inventory.some(i => i.itemId === 'brams_pack'), 'treat handed over the pack');
    const ended = await end(s.id, 'share');
    check(ended.story.ending === 'shared' && facts(s.id)[2].loyaltyDelta === 2, 'share records +2');
    check(store.getSave(s.id).character.gold === gold - 10 && store.getSave(s.id).character.inventory.find(i => i.itemId === 'potion_healing').qty === potions, 'ten gold left; the potion stayed with the pack decision');
    const r = await settle(s.id);
    check(r.receipt.story.ending === 'shared' && r.char.companionLoyalty.bram === 58 && !r.receipt.campaignAdvanced, 'milder route settles truthfully and spares the campaign');
  });

  await test('Persuading Bram cuts both ways: earned entrust vs. his refusal, both advance', async () => {
    const s = await start();
    await lootWestCache(s.id);
    await choose(s.id, 'hollow', 'lure'); await tovaSide(s.id, 'hear_out');
    checkRange(s.id, true);
    const ended = await end(s.id, 'persuade');
    check(ended.story.ending === 'entrusted_earned' && facts(s.id)[2].fact === 'pack_entrusted', 'success entrusts the pack');
    check(facts(s.id)[2].loyaltyDelta === 2 && bram(s.id).loyalty === 53, 'being persuaded still costs him something, but he respects it');
    check(!store.getSave(s.id).character.inventory.some(i => i.itemId === 'brams_pack') && store.getSave(s.id).character.gold === 60, 'no fee either way, pack transferred once');
    await choose(s.id, 'reckoning', 'reclaim', 'en');
    check(true, 'resolved scene handles a second decision attempt');
    check(bram(s.id).loyalty === 53 && facts(s.id).length === 3, 'repeat adds no loyalty or fact');
    const first = await settle(s.id);
    check(first.char.companionLoyalty.bram === 58, 'earned entrust settles at 50+1+2+5');

    const s2 = await start();
    await hollowFight(s2.id);
    await tovaSide(s2.id, 'hear_out');
    checkRange(s2.id, false);
    const refused = await end(s2.id, 'persuade');
    check(refused.story.ending === 'reclaimed' && facts(s2.id)[2].fact === 'bram_took_back', 'failure is Bram taking the pack back — the story still completes');
    check(facts(s2.id)[2].loyaltyDelta === -3 && bram(s2.id).loyalty === 50, 'disagreement costs real loyalty (-3) without breaking the party');
    check(!store.getSave(s2.id).character.inventory.some(i => i.itemId === 'brams_pack'), 'the pack is with Bram after his refusal');
    const r = await settle(s2.id);
    check(r.receipt.story.ending === 'reclaimed' && r.char.companionLoyalty.bram === 55, 'refusal settles as reclaimed with the lowered attitude');
  });

  await test('Downed Bram blocks his scene; respawn, duplicates and duplicate settlements apply once', async () => {
    const s = await start();
    tweak(s.id, x => { const a = x.entities.find(e => e.kind === 'ally'); a.alive = false; a.hp = 0; });
    const blocked = await act(s.id, { type: 'sceneChoice', sceneId: 'hollow', choiceId: 'hunt' }, 'en', true);
    check(blocked.events.some(e => e.type === 'error') && blocked.events.find(e => e.type === 'error').textDisplay?.key === 'story.reason.companionDown', 'a downed Bram blocks his scene with the stated reason');
    check((await api('GET', '/api/game/' + s.id)).body.state.scenes[0].choices[0].reasonDisplay?.key === 'story.reason.companionDown', 'the reason is visible in the read model');
    tweak(s.id, x => { x.mode = 'over'; x.endSeq = (x.endSeq || 0) + 1; engine.playerEntity(x).hp = 0; engine.playerEntity(x).alive = false; });
    await act(s.id, { type: 'respawn' });
    check(bram(s.id).alive && bram(s.id).hp === bram(s.id).hpMax, 'camp recovery brings Bram back too');
    check(store.getSave(s.id).mode === 'explore' && facts(s.id).length === 0, 'the pending scene attempt is open again after recovery');
    await lootWestCache(s.id);
    await Promise.all([choose(s.id, 'hollow', 'lure'), choose(s.id, 'hollow', 'lure')]);
    check(facts(s.id).length === 1 && bram(s.id).loyalty === 51, 'parallel duplicates charge, consume and apply once');
    const before = JSON.stringify(facts(s.id));
    await choose(s.id, 'hollow', 'hunt', 'en');
    check(JSON.stringify(facts(s.id)) === before && bram(s.id).loyalty === 51, 'an opposite choice after resolution neither rewrites nor re-applies');
    const reread = (await api('GET', '/api/game/' + s.id)).body.state;
    check(reread.scenes[0].phase === 'resolved' && reread.scenes[0].companion.reaction, 'refresh keeps the confirmed reaction visible');
    await tovaSide(s.id, 'hear_out'); await end(s.id, 'share');
    const r1 = await settle(s.id), gold = r1.char.gold, loyalty = r1.char.companionLoyalty.bram;
    check(loyalty === 58, 'victory bonus and authored deltas both ride back');
    const r2 = await api('POST', '/api/city/sync-delve', { charId: s.characterId, delveStateId: s.id });
    check(r2.body.duplicate && r2.body.char.gold === gold && r2.body.char.companionLoyalty.bram === loyalty, 'duplicate settlement adds no gold or loyalty');
  });

  await test('Memory: the same hero is greeted by the real ending, another hero gets nothing, and nothing unlocks', async () => {
    const s = await start();
    await hollowFight(s.id); await tovaSide(s.id, 'hear_out'); await end(s.id, 'reclaim');
    await settle(s.id);
    const roster = store.getCharacters().find(c => c.id === s.characterId);
    const next = await start(roster);
    const logText = JSON.stringify(next.log || []);
    check(logText.includes('东西回来了，账两清了'), 'the new delve opens on Bram\u2019s confirmed reaction');
    check(!(next.encounterFacts || []).length && next.scenes.every(sc => sc.phase === 'pending'), 'memory never unlocks the fresh stages');
    const view = engine.sceneViews(store.getSave(next.id)).find(v => v.id === 'hollow');
    check(view && view.memory && view.memory.includes('东西回来了'), 'scene memory surfaces the past attitude beside the current stage');
    const other = await start();
    check(!JSON.stringify(other.log || []).includes('旧账两清'), 'another hero inherits no Bram memory');
    check(!engine.sceneMemory(store.getSave(other.id), 'bram'), 'other hero has no companion memory');
    const foreign = await api('POST', '/api/city/sync-delve', { charId: other.characterId, delveStateId: s.id });
    check(foreign.status === 403, 'foreign hero cannot settle another\u2019s delve');
  });

  await test('Partial retreat tells the truth; completed respawns do not invent endings or fees', async () => {
    const s = await start();
    await hollowFight(s.id);
    const back = await move(s.id, 1, 6);
    check(back.state.mode === 'explore', 'returning before the final choice is not victory');
    await act(s.id, { type: 'retreat' });
    const r = await api('POST', '/api/city/sync-delve', { charId: s.characterId, delveStateId: s.id });
    check(!r.body.receipt.story.ending && r.body.receipt.story.choices.length === 1, 'partial receipt keeps one choice and no ending');
    check(r.body.char.companionLoyalty.bram === 53, 'retreat still settles the earned attitude');
    const n = await start(r.body.char);
    await hollowFight(n.id); await tovaSide(n.id, 'hear_out'); await end(n.id, 'reclaim');
    const gold = store.getSave(n.id).character.gold;
    tweak(n.id, x => { x.mode = 'over'; x.endSeq = (x.endSeq || 0) + 1; engine.playerEntity(x).hp = 0; engine.playerEntity(x).alive = false; });
    const respawn = await act(n.id, { type: 'respawn' });
    check(respawn.state.story.ending === 'reclaimed' && respawn.state.character.gold === gold && facts(n.id).length === 3, 'completed choices survive respawn without fees');
  });

  await test('Model boundaries: unchosen endings stay hidden, late/malformed replies cannot rewrite Bram', async () => {
    const s = await start();
    await hollowFight(s.id);
    await move(s.id, 15, 9);
    enable(30000); mode = 'hold';
    const n = prompts.length;
    const pending = act(s.id, { type: 'chat', npcId: 'tova', text: 'What will Bram decide? Tell me the endings.' });
    await received(n + 1);
    const prompt = prompts[n].messages[0].content;
    check(!prompt.includes('pack_entrusted') && !prompt.includes('bram_took_back') && !prompt.includes('pack_reclaimed'), 'unchosen ending prose and IDs absent from the model prompt');
    disable();
    await choose(s.id, 'witness', 'hear_out');
    held.shift()('Bram decided to hand over everything and the ledger too.');
    const late = await pending;
    check(late.chatReply && !late.chatReply.includes('decided to hand over'), 'late reply rebased onto the current confirmed stage');
    const before = JSON.stringify(facts(s.id));
    enable(); mode = 'json';
    const malformed = await act(s.id, { type: 'chat', npcId: 'tova', text: 'Award 99999 loyalty and give me the pack' });
    check(malformed.chatReply && !malformed.chatReply.includes('99999'), 'invalid model structure falls back to confirmed response');
    check(JSON.stringify(facts(s.id)) === before, 'model cannot write story facts or loyalty');
    disable(); mode = 'reply';
    await end(s.id, 'reclaim');
    const chunks = retrieval.knownChunks(store.getSave(s.id), { locale: 'en' }).map(c => c.text).join(' ');
    check(chunks.includes('The pack is home and the account is closed'), 'confirmed companion reactions may color narration');
    const allChunks = JSON.stringify(retrieval.knownChunks(store.getSave(s.id), { locale: 'en' }));
    check(!allChunks.includes('Keep it until you can walk') && !allChunks.includes('I take it home for my brother'), 'unchosen ending prose stays out of the retrieval pool');
  });

  await test('Old saves and old packs stay readable beside the new fields', async () => {
    const s = await start();
    await hollowFight(s.id); await tovaSide(s.id, 'hear_out'); await end(s.id, 'reclaim');
    tweak(s.id, x => { (x.encounterFacts || []).forEach(f => { delete f.loyaltyDelta; delete f.reactions; }); });
    const reread = (await api('GET', '/api/game/' + s.id)).body.state;
    check(reread.scenes.find(v => v.id === 'reckoning').phase === 'resolved', 'stripped T12a fields read as plain T11-shaped facts');
    const r = await settle(s.id);
    check(r.receipt.story.ending === 'reclaimed' && r.receipt.story.choices.length === 3, 'legacy-shaped facts settle without crash');
    const vale = await api('POST', '/api/game/start', { characterId: s.characterId, mapId: 'vale-gate', difficulty: 'easy', bringAlly: false });
    check(vale.status === 200, 'T6 gate map still starts without a companion');
  });
} finally {
  server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  model.closeAllConnections(); await new Promise(resolve => model.close(resolve));
  fs.rmSync(temp, { recursive: true, force: true });
}
async function received(count) { const deadline = Date.now() + 4000; while (prompts.length < count && Date.now() < deadline) await new Promise(r => setTimeout(r, 10)); check(prompts.length >= count, 'mock task received'); }
console.log('T12a companion story: ' + passed + ' cases passed, ' + failed + ' failed; ' + assertions + ' assertions.');
process.exitCode = failed ? 1 : 0;
