// T8: real registry/HTTP/filesystem/engine roundtrips, entirely inside verify's container.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { assertTestContainer } from '../../scripts/test-container.mjs';

assertTestContainer();
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-dnd-t8-'));
process.env.DATA_DIR = temp;
const require = createRequire(import.meta.url);
const content = require('../../server/game/content.js');
const engine = require('../../server/game/engine.js');
const store = require('../../server/store.js');
const express = require('express');
store.saveSettings({ llm: { enabled: false }, portraits: { enabled: false } });
const example = JSON.parse(fs.readFileSync(new URL('../fixtures/content/minimal-pack.json', import.meta.url), 'utf8'));
const copy = () => structuredClone(example);
let passed = 0, failed = 0, assertions = 0;
const check = (condition, message) => { assert.ok(condition, message); assertions++; };
async function test(name, run) {
  try { await run(); passed++; console.log('  PASS: ' + name); }
  catch (error) { failed++; console.error('  FAIL: ' + name + '\n' + error.stack); }
}
const app = express();
app.use(express.json());
app.use('/api/content', require('../../server/routes/content.js'));
app.use('/api/game', require('../../server/routes/game.js'));
const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
const base = 'http://127.0.0.1:' + server.address().port;
async function api(method, url, body) {
  const response = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: response.status, body: await response.json() };
}
function hero() {
  const char = engine.buildCharacter({ name: 'Content Author', species: 'human', className: 'fighter', background: 'soldier', baseScores: { str: 16, dex: 14, con: 14, int: 10, wis: 12, cha: 10 }, bgPlus2: 'str', bgPlus1: 'con', skills: ['athletics', 'perception'] });
  char.id = store.newId('char');
  store.saveCharacters([...store.getCharacters(), char]);
  return char;
}
async function start(mapId) {
  const response = await api('POST', '/api/game/start', { characterId: hero().id, mapId, bringAlly: false });
  check(response.status === 200, 'start succeeded: ' + JSON.stringify(response.body.error));
  return response.body.state;
}
async function act(id, action) {
  const response = await api('POST', '/api/game/' + id + '/action', action);
  check(response.status === 200 && !response.body.events.some(e => e.type === 'error'), 'action succeeded: ' + JSON.stringify(response.body.events));
  return response.body;
}
function folder(bundle, root = path.join(temp, 'content')) {
  const dir = path.join(root, bundle.pack.id);
  fs.mkdirSync(path.join(dir, 'maps'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'pack.json'), JSON.stringify(bundle.pack));
  bundle.maps.forEach(map => fs.writeFileSync(path.join(dir, 'maps', map.id + '.json'), JSON.stringify(map)));
  fs.writeFileSync(path.join(dir, 'monsters.json'), JSON.stringify({ monsters: bundle.monsters }));
  fs.writeFileSync(path.join(dir, 'gear.json'), JSON.stringify({ gear: bundle.gear }));
  return dir;
}
async function completeExample() {
  const state = await start('first-relic-room');
  await act(state.id, { type: 'move', x: 3, y: 2 });
  const chest = await act(state.id, { type: 'interact', objectId: 'sample_chest' });
  check(chest.state.character.inventory.some(item => item.itemId === 'sample_token'), 'custom gear awarded by engine');
  await act(state.id, { type: 'move', x: 5, y: 2 });
  const relic = await act(state.id, { type: 'interact', objectId: 'relic' });
  check(relic.state.flags.hasRelic, 'relic actually acquired');
  const won = await act(state.id, { type: 'move', x: 1, y: 2 });
  check(won.state.mode === 'victory' && won.state.flags.victory && won.state.endSeq === 1, 'return to campfire actually completes adventure');
}

try {
  await test('All six original maps and the T6 scene map load; core dire_wolf wins with source evidence', () => {
    const reg = content.reload();
    check(!reg.diagnostics.some(d => d.severity === 'error'), JSON.stringify(reg.diagnostics));
    check(['crypt', 'drowned-vault', 'howling-hills', 'sewers', 'mill', 'roost', 'vale-gate'].every(id => reg.maps[id]), 'all original maps and scene map');
    check(Object.keys(reg.monsters).length === 19, 'existing bestiary remains intact');
    check(reg.maps.crypt.victory.type === 'fetch_relic', 'legacy victoryTile normalized');
    const duplicate = reg.diagnostics.find(d => d.packId === 'howling-hills' && d.code === 'duplicate-definition' && d.message.includes('dire_wolf'));
    check(duplicate?.severity === 'warning' && duplicate.winner.packId === 'core' && duplicate.winner.file === 'shared/monsters.json', 'explicit winning provenance');
    check(content.getMap('does-not-exist') === null && content.getMap().id === 'crypt', 'unknown map never falls back; omitted map still defaults');
  });
  await test('Every shipped boss map can win at its real campfire after defeating its boss', async () => {
    for (const mapId of ['drowned-vault', 'howling-hills', 'sewers', 'mill', 'roost']) {
      const state = await start(mapId);
      check(state.entities.some(e => e.kind === 'monster' && e.boss), mapId + ' hydrates a real boss');
      const save = store.getSave(state.id);
      // Controlled already-cleared encounter; movement and victory remain real engine actions.
      save.entities.filter(e => e.kind === 'monster').forEach(e => { e.alive = false; e.hp = 0; });
      save.objects.forEach(o => { if (o.type === 'door') o.open = true; if (o.type === 'trap') o.disarmed = true; });
      save.flags.wanders = 2;
      store.saveGame(save);
      const camp = save.objects.find(o => o.id === 'campfire');
      const p = engine.playerEntity(save);
      if (p.x === camp.x && p.y === camp.y) {
        const neighbor = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dy]) => ({ x: p.x + dx, y: p.y + dy })).find(pos => !engine.isBlocked(save, pos.x, pos.y) && !engine.entityAt(save, pos.x, pos.y));
        check(!!neighbor, mapId + ' has a usable exit from spawn');
        await act(state.id, { type: 'move', ...neighbor });
      }
      const won = await act(state.id, { type: 'move', x: camp.x, y: camp.y });
      check(won.state.mode === 'victory', mapId + ' really wins at campfire');
    }
  });
  const badCases = [
    ['size', b => { b.maps[0].width = 10; }, 'rows[0]'],
    ['height', b => { b.maps[0].height = 6; }, 'height'],
    ['row shape', b => { b.maps[0].rows[1] = null; }, 'rows'],
    ['non-finite spawn', b => { b.maps[0].playerStart.x = Infinity; }, 'playerStart.x'],
    ['fractional position', b => { b.maps[0].entities[1].x = 2.5; }, 'entities[1].x'],
    ['out of bounds', b => { b.maps[0].entities[1].y = 8; }, 'entities[1]'],
    ['wall spawn', b => { b.maps[0].playerStart.x = 0; }, 'playerStart'],
    ['null entity', b => { b.maps[0].entities.push(null); }, 'entities[3]'],
    ['duplicate entity', b => { b.maps[0].entities.push({ ...b.maps[0].entities[1] }); }, 'entities[3].id'],
    ['reserved entity', b => { b.maps[0].entities[1].id = 'player'; }, 'entities[1].id'],
    ['unknown monster', b => { b.maps[0].entities.push({ type: 'monster', id: 'bad_mon', kind: 'missing_monster', x: 7, y: 3 }); }, 'entities[3].kind'],
    ['unknown wandering monster', b => { b.maps[0].wandering = ['missing_monster']; }, 'wandering[0]'],
    ['missing npc', b => { b.maps[0].entities.push({ type: 'npc', id: 'hermit', x: 7, y: 3 }); }, 'entities[3].id'],
    ['unknown stairs', b => { b.maps[0].entities.push({ type: 'stairs', id: 'stairs', x: 2, y: 3, to: { mapId: 'missing_map', x: 1, y: 2 } }); }, 'entities[3].to.mapId'],
    ['bad stairs coordinate', b => { b.maps[0].entities.push({ type: 'stairs', id: 'stairs', x: 2, y: 3, to: { mapId: b.maps[0].id, x: 200, y: 2 } }); }, 'entities[3].to'],
    ['stairs into wall', b => { b.maps[0].entities.push({ type: 'stairs', id: 'stairs', x: 2, y: 3, to: { mapId: b.maps[0].id, x: 0, y: 2 } }); }, 'entities[3].to'],
    ['unknown item', b => { b.maps[0].entities[2].loot.items[0].id = 'missing_item'; }, 'entities[2].loot.items[0].id'],
    ['unknown trap', b => { b.maps[0].entities.push({ type: 'lever', id: 'lever', x: 2, y: 3, targetTrapIds: ['no_trap'] }); }, 'entities[3].targetTrapIds[0]'],
    ['unknown victory', b => { b.maps[0].victory.type = 'kill_everything'; }, 'victory.type'],
    ['missing relic', b => { b.maps[0].entities[1].id = 'something_else'; }, 'victory.type'],
    ['missing boss', b => { b.maps[0].victory.type = 'slay_boss'; b.maps[0].entities.push({ type: 'monster', kind: 'goblin', id: 'ordinary_goblin', x: 7, y: 3 }); }, 'victory.type'],
    ['invalid boss flag', b => { b.maps[0].entities[1].boss = 'true'; }, 'entities[1].boss'],
    ['misplaced campfire', b => { b.maps[0].victory.campfire.x = 2; }, 'victory.campfire'],
    ['bad room', b => { b.maps[0].rooms[0].rect[2] = 50; }, 'rooms[0].rect'],
    ['bad dice', b => { b.gear[0].heal = '2d0'; }, 'gear[0].heal'],
    ['non-finite bonus', b => { b.gear[0].acBonus = NaN; }, 'gear[0].acBonus'],
    ['bad drop chance', b => { b.maps[0].entities[2].loot.items[0].chance = 2; }, 'entities[2].loot.items[0].chance'],
    ['bad quantity', b => { b.maps[0].entities[2].loot.items[0].qty = 0; }, 'entities[2].loot.items[0].qty'],
    ['unknown spell', b => { b.gear[0].spell = 'missing_spell'; }, 'gear[0].spell'],
    ['unknown weapon base', b => { b.gear[0].type = 'magic_weapon'; b.gear[0].base = 'missing_weapon'; }, 'gear[0].base'],
    ['unsafe map filename', b => { b.maps[0].id = '../../escape'; }, 'id'],
    ['unsafe pack folder', b => { b.pack.id = '../../escape'; }, 'pack.id'],
    ['malformed maps collection', b => { b.maps = {}; }, 'maps'],
    ['duplicate bundle map', b => { b.maps.push(structuredClone(b.maps[0])); }, 'maps[1].id'],
    ['unsupported version', b => { b.version = 2; }, 'version']
  ];
  for (const [name, mutate, field] of badCases) await test('Reject ' + name + ' with pack/file/field', () => {
    const b = copy(); mutate(b);
    const result = content.validateBundle(b);
    check(!result.ok, 'invalid content rejected');
    check(result.diagnostics.some(d => d.severity === 'error' && d.field === field && d.packId && d.file && d.message), 'locatable error: ' + JSON.stringify(result));
  });
  await test('Monster attack dice, ability scores and loot references are validated', () => {
    const b = copy();
    b.monsters = [{ id: 'test_beast', name: 'Test Beast', ac: 12, xp: 10, hp: '2d6', abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 }, attacks: [{ name: 'Bite', bonus: 2, damage: '1d4' }] }];
    check(content.validateBundle(b).ok, 'valid monster accepted');
    for (const mutate of [m => { m.attacks[0].damage = 'roll()'; }, m => { m.abilities.dex = Infinity; }, m => { m.loot = { items: [{ id: 'missing_loot' }] }; }]) {
      const bad = structuredClone(b); mutate(bad.monsters[0]);
      check(!content.validateBundle(bad).ok, 'invalid monster rejected');
    }
  });
  await test('Defaults and author metadata survive; no mutation during dry-run', async () => {
    const b = copy(); delete b.maps[0].width; delete b.maps[0].height;
    b.maps[0].victoryTile = b.maps[0].victory.campfire; delete b.maps[0].victory;
    b.maps[0].extraLore = { location: 'author-defined' };
    delete b.maps[0].entities[2].loot;
    const before = JSON.stringify(b);
    check(content.validateBundle(b).ok && JSON.stringify(b) === before, 'old defaults accepted without mutating source');
    const response = await api('POST', '/api/content/validate', b);
    check(response.status === 200 && !fs.existsSync(path.join(temp, 'content', b.pack.id)), 'dry-run writes no pack');
    const installed = await api('POST', '/api/content/import', b);
    check(installed.status === 200, 'legacy bundle imported');
    const loaded = content.getMap(b.maps[0].id);
    check(loaded.width === 9 && loaded.height === 5 && loaded.victory.type === 'fetch_relic' && loaded.extraLore.location === 'author-defined', 'defaults and extras preserved');
    const state = await start(loaded.id);
    await act(state.id, { type: 'move', x: 3, y: 2 });
    await act(state.id, { type: 'interact', objectId: 'sample_chest' });
    check((await api('DELETE', '/api/content/pack/' + b.pack.id)).status === 200, 'legacy fixture removed');
  });
  await test('Locked doors are optimistic; genuinely disconnected geometry is only a warning', () => {
    const locked = copy(); locked.maps[0].entities.push({ type: 'door', id: 'locked', x: 4, y: 2, locked: true, forceDc: 15 });
    check(content.validateBundle(locked).ok, 'lock is not fatal');
    const isolated = copy(); isolated.maps[0].rows = ['#########', '#..#....#', '#..#....#', '#..#....#', '#########']; isolated.maps[0].entities[2].x = 2;
    const report = content.validateBundle(isolated);
    check(report.ok && report.diagnostics.some(d => d.code === 'unreachable' && d.severity === 'warning'), 'disconnected target warns with stated assumptions');
  });
  await test('Imports fail before writing; failed replacement preserves original files', async () => {
    check((await api('POST', '/api/content/import', copy())).status === 200, 'valid import');
    const file = path.join(temp, 'content', example.pack.id, 'maps', example.maps[0].id + '.json');
    const before = fs.readFileSync(file, 'utf8');
    const b = copy(); b.maps[0].width = 99;
    const rejected = await api('POST', '/api/content/import', b);
    check(rejected.status === 400 && !rejected.body.ok && rejected.body.diagnostics.some(d => d.code === 'map-size'), 'structured fatal errors');
    check(fs.readFileSync(file, 'utf8') === before && content.getMap(example.maps[0].id).width === 9, 'original file and registry untouched');
    b.pack.id = 'never-installed';
    check((await api('POST', '/api/content/import', b)).status === 400 && !fs.existsSync(path.join(temp, 'content', b.pack.id)), 'bad new pack creates no folder');
    check(!content.validateBundle({ ...copy(), pack: { id: 'drowned-vault' } }).ok, 'shipped pack cannot be replaced');
  });
  await test('Minimal bundle imports, wins through real actions, exports and wins again after reimport', async () => {
    await completeExample();
    const exported = await api('GET', '/api/content/pack/' + example.pack.id + '/export');
    check(exported.status === 200 && exported.body.maps.length === 1 && exported.body.gear[0].id === 'sample_token', 'complete export');
    check((await api('DELETE', '/api/content/pack/' + example.pack.id)).status === 200, 'deleted before reimport');
    check((await api('POST', '/api/content/import', exported.body)).status === 200, 'export accepted unchanged');
    await completeExample();
    check(fs.readdirSync(path.join(temp, '.content-imports')).length === 0, 'transaction staging cleaned');
  });
  await test('Filesystem install failure restores the original pack and cleans staging', async () => {
    const b = copy(); b.pack.name = 'Replacement which must fail';
    const dir = path.join(temp, 'content', b.pack.id);
    const before = fs.readFileSync(path.join(dir, 'pack.json'), 'utf8');
    const originalRename = fs.renameSync;
    fs.renameSync = (from, to) => {
      if (path.basename(from) === 'pack' && to === dir) throw new Error('Injected installation failure');
      return originalRename(from, to);
    };
    let response;
    try { response = await api('POST', '/api/content/import', b); } finally { fs.renameSync = originalRename; }
    check(response.status === 500 && response.body.error.includes('Injected installation failure'), 'real install failure reported');
    check(fs.readFileSync(path.join(dir, 'pack.json'), 'utf8') === before && content.getMap(b.maps[0].id), 'old files and registry restored');
    check(fs.readdirSync(path.join(temp, '.content-imports')).length === 0, 'failed transaction removed');
  });
  await test('Registry reload failure after installation rolls back the complete replacement', async () => {
    const b = copy(); b.pack.name = 'Reload must fail';
    const file = path.join(temp, 'content', b.pack.id, 'pack.json');
    const before = fs.readFileSync(file, 'utf8');
    const originalReload = content.reload;
    let calls = 0;
    content.reload = () => { if (++calls === 1) throw new Error('Injected reload failure'); return originalReload(); };
    let response;
    try { response = await api('POST', '/api/content/import', b); } finally { content.reload = originalReload; }
    check(response.status === 500 && response.body.error.includes('Injected reload failure'), 'post-install failure reported');
    check(fs.readFileSync(file, 'utf8') === before && content.listPacks().find(p => p.id === b.pack.id).name === example.pack.name, 'complete old pack restored');
  });
  await test('Invalid map start is explicit and consumes no pending items/boons or save', async () => {
    const char = hero(); char.pendingRoadBoons = ['shrine_temp_hp']; store.saveCharacters([...store.getCharacters().filter(c => c.id !== char.id), char]);
    const before = JSON.stringify(store.getCharacters()), count = store.listSaves().length;
    const response = await api('POST', '/api/game/start', { characterId: char.id, mapId: 'not-a-map' });
    check(response.status === 400 && /Unknown or invalid map/.test(response.body.error), 'explicit HTTP error');
    check(JSON.stringify(store.getCharacters()) === before && store.listSaves().length === count, 'no resources consumed or save created');
    assert.throws(() => engine.startGame(char, { mapId: 'not-a-map' }), /Unknown or invalid map/); assertions++;
    check((await start(undefined)).mapId === 'crypt', 'omitted selection still starts crypt');
  });
  await test('All packs register before references: later definitions and cyclic stairs travel correctly', async () => {
    const a = copy(), b = copy();
    a.pack.id = 'a-cross'; a.maps[0].id = 'cross_a'; a.gear = [];
    b.pack.id = 'z-cross'; b.maps[0].id = 'cross_b';
    a.maps[0].entities.push({ type: 'stairs', id: 'down', x: 2, y: 2, to: { mapId: 'cross_b', x: 1, y: 2 } });
    b.maps[0].entities.push({ type: 'stairs', id: 'up', x: 2, y: 2, to: { mapId: 'cross_a', x: 1, y: 2 } });
    a.maps[0].entities[2].loot.items[0].id = 'cross_token';
    b.gear[0].id = 'cross_token'; b.maps[0].entities[2].loot.items[0].id = 'cross_token';
    folder(a); folder(b);
    const reg = content.reload();
    check(reg.maps.cross_a && reg.maps.cross_b && !reg.diagnostics.some(d => d.packId.endsWith('-cross') && d.severity === 'error'), 'late pack gear/map references and cycles valid');
    const state = await start('cross_a');
    check((await act(state.id, { type: 'interact', objectId: 'down' })).state.mapId === 'cross_b', 'forward stairs');
    check((await act(state.id, { type: 'interact', objectId: 'up' })).state.mapId === 'cross_a', 'return stairs');
    const snapshot = JSON.stringify(store.getSave(state.id)), events = [];
    const travel = store.getSave(state.id);
    engine.travelTo(travel, 'missing_destination', 1, 2, events);
    engine.travelTo(travel, undefined, 1, 2, events);
    engine.travelTo(travel, 'cross_b', -1, 200, events);
    check(events.length === 3 && events.every(e => e.type === 'error') && JSON.stringify(travel) === snapshot, 'invalid destinations cannot change state or switch to crypt');
    const replacement = structuredClone(b); replacement.gear = []; replacement.maps[0].entities[2].loot = {};
    const badUpdate = await api('POST', '/api/content/import', replacement);
    check(badUpdate.status === 400 && badUpdate.body.diagnostics.some(d => d.packId === 'a-cross'), 'replacement cannot break dependent pack');
    check(content.getGear('cross_token') !== null, 'dependency survives rejected replacement');
  });
  await test('Dry-run order matches installed order for duplicate gear definitions', async () => {
    const later = copy(); later.pack.id = 'z-winner'; later.maps = []; later.gear = [{ id: 'order_token', name: 'Later Token', type: 'gear' }];
    check((await api('POST', '/api/content/import', later)).status === 200, 'later folder installed first');
    const earlier = copy(); earlier.pack.id = 'a-winner'; earlier.maps = []; earlier.gear = [{ id: 'order_token', name: 'Earlier Token', type: 'gear' }];
    check(content.validateBundle(earlier).pack.gear.includes('order_token'), 'prospective earlier folder wins');
    check((await api('POST', '/api/content/import', earlier)).status === 200 && content.getGear('order_token').name === 'Earlier Token', 'actual registration matches dry-run');
    check(content.validateBundle(later).diagnostics.some(d => d.code === 'duplicate-definition' && d.winner.packId === 'a-winner'), 'ignored duplicate winner explained');
  });
  await test('Valid NPC reference also works after map hydration', async () => {
    const b = copy(); b.pack.id = 'npc-example'; b.maps[0].id = 'npc_example'; b.gear = [];
    b.maps[0].entities.push({ type: 'npc', id: 'hermit', name: 'Hermit', x: 2, y: 2 });
    b.maps[0].npcs.hermit = { canned: ['Hello, author.'], persona: 'Helpful hermit' };
    check((await api('POST', '/api/content/import', b)).status === 200, 'valid NPC bundle imported');
    const state = await start(b.maps[0].id);
    const reply = await act(state.id, { type: 'interact', objectId: 'hermit' });
    check(reply.events.some(e => e.type === 'chat_open' && e.data.npcId === 'hermit' && e.text.includes('Hello, author.')), 'canned dialogue opens without missing npcId crash');
  });
  await test('Registry rejects malformed disk JSON and removes cascading invalid dependencies', () => {
    const root = fs.mkdtempSync(path.join(temp, 'broken-'));
    const b = copy(); b.pack.id = 'broken-map'; b.maps[0].id = 'broken_map'; b.gear[0].heal = '0d6';
    const dir = folder(b, root);
    fs.writeFileSync(path.join(dir, 'maps', 'syntax.json'), '{');
    fs.writeFileSync(path.join(dir, 'maps', 'null.json'), 'null');
    const reg = content.scan({ cache: false, userRoot: root });
    check(!reg.gear.sample_token && !reg.maps.broken_map, 'bad item removes map depending on it');
    check(reg.diagnostics.some(d => d.file === 'maps/syntax.json' && d.code === 'invalid-json'), 'syntax error diagnosed');
    check(reg.diagnostics.some(d => d.file === 'maps/null.json' && d.severity === 'error'), 'literal null diagnosed');
    check(reg.maps.crypt && reg.maps['drowned-vault'], 'unrelated valid content survives');
  });
  await test('Replacing a pack removes obsolete map files instead of merging leftovers', async () => {
    const b = copy(); b.pack.id = 'replace-example'; b.maps[0].id = 'replace_old'; b.gear = [];
    check((await api('POST', '/api/content/import', b)).status === 200, 'initial pack');
    b.maps[0].id = 'replace_new';
    check((await api('POST', '/api/content/import', b)).status === 200, 'replacement pack');
    check(!content.getMap('replace_old') && content.getMap('replace_new'), 'obsolete map unavailable');
    check(!fs.existsSync(path.join(temp, 'content', b.pack.id, 'maps', 'replace_old.json')), 'obsolete file actually removed');
  });
  await test('Author CLI checks real content and returns nonzero on errors', () => {
    const file = path.join(temp, 'author-bundle.json');
    fs.writeFileSync(file, JSON.stringify(copy()));
    const good = spawnSync(process.execPath, ['scripts/check-content.mjs', file], { encoding: 'utf8', timeout: 15000 });
    check(good.status === 0 && JSON.parse(good.stdout).ok, 'valid bundle CLI succeeds with ignored duplicate warnings');
    const b = copy(); b.maps[0].height = 50; fs.writeFileSync(file, JSON.stringify(b));
    const bad = spawnSync(process.execPath, ['scripts/check-content.mjs', file], { encoding: 'utf8', timeout: 15000 });
    check(bad.status === 1 && !JSON.parse(bad.stdout).ok, 'invalid bundle CLI fails');
    const all = spawnSync(process.execPath, ['scripts/check-content.mjs'], { encoding: 'utf8', timeout: 15000 });
    check(all.status === 0 && JSON.parse(all.stdout).ok, 'installed registry CLI succeeds: ' + all.stderr + all.stdout);
    const duplicate = copy(); duplicate.pack.id = 'zz-duplicate-example';
    const report = content.validateBundle(duplicate);
    check(report.ok && report.diagnostics.some(d => d.code === 'duplicate-definition'), 'another pack can contain ignored duplicates without fatal errors');
  });
} finally {
  await new Promise(resolve => server.close(resolve));
  fs.rmSync(temp, { recursive: true, force: true });
  console.log('T8 content validation: ' + passed + ' cases passed, ' + failed + ' failed; ' + assertions + ' assertions passed.');
}
if (failed) process.exitCode = 1;
