// M1: real validation, import transactions, public DTOs and snapshot/settlement compatibility.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { assertTestContainer } from '../../scripts/test-container.mjs';
import { resolveDisplay } from '../../public/js/localization/locale.mjs';
assertTestContainer();
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-dnd-m1-'));
process.env.DATA_DIR = temp;
const require = createRequire(import.meta.url), express = require('express');
const content = require('../../server/game/content.js'), store = require('../../server/store.js');
store.saveSettings({ llm: { enabled: false }, portraits: { enabled: false } });
const fixture = JSON.parse(fs.readFileSync(new URL('../fixtures/content/adventure-directory-pack.json', import.meta.url), 'utf8'));
const copy = () => structuredClone(fixture);
let passed = 0, failed = 0, assertions = 0;
const check = (value, message) => { assert.ok(value, message); assertions++; };
async function test(name, run) { try { await run(); passed++; console.log('  PASS: ' + name); } catch (error) { failed++; console.error('  FAIL: ' + name + '\n' + error.stack); } }
const app = express(); app.use(express.json()); app.use(require('../../server/locale.js').localeMiddleware); app.use(require('../../server/game/presentation.js').middleware);
for (const name of ['content', 'city', 'game', 'characters']) app.use('/api/' + name, require('../../server/routes/' + name + '.js'));
const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
const base = 'http://127.0.0.1:' + server.address().port;
async function api(method, url, body) { const r = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }); return { status: r.status, body: await r.json() }; }
async function start(mapId) {
  const char = (await api('POST', '/api/characters', { presetId: 'guardian', name: 'M1 explorer' })).body;
  const r = await api('POST', '/api/game/start', { characterId: char.id, mapId, bringAlly: false });
  check(r.status === 200, 'map starts: ' + mapId + ' ' + JSON.stringify(r.body.error)); return r.body.state;
}
async function act(id, action) { const r = await api('POST', '/api/game/' + id + '/action', action); check(r.status === 200 && !r.body.events.some(e => e.type === 'error'), 'real action: ' + JSON.stringify(action)); return r.body.state; }
async function complete(state) {
  await act(state.id, { type: 'move', x: 5, y: 2 });
  check((await act(state.id, { type: 'interact', objectId: 'relic' })).flags.hasRelic, 'engine acquired relic');
  check((await act(state.id, { type: 'move', x: 1, y: 2 })).mode === 'victory', 'engine declared campfire victory');
  const r = await api('POST', '/api/city/sync-delve', { charId: state.characterId, delveStateId: state.id });
  check(r.status === 200 && !r.body.duplicate && !r.body.receipt.campaignAdvanced, 'custom map settled once outside main campaign');
  const before = JSON.stringify(store.getCharacters());
  const again = await api('POST', '/api/city/sync-delve', { charId: state.characterId, delveStateId: state.id });
  check(again.body.duplicate && again.body.receipt.id === r.body.receipt.id && before === JSON.stringify(store.getCharacters()), 'repeat settle keeps one receipt and identical roster');
}
try {
  await test('Shipped maps, town, main story, endless and weekly all use the public directory', async () => {
    const c = (await api('GET', '/api/content')).body, town = (await api('GET', '/api/city/info')).body;
    assert.deepEqual(c.adventures, town.adventures); assertions++;
    check(c.maps.length === 10 && c.adventures.length === 12 && town.mapNodes.length === 11, 'ten authored maps (the companion pack ships without a town waypoint), two generated modes and town');
    check(['crypt', 'drowned-vault', 'howling-hills', 'sewers', 'mill', 'roost', 'vale-gate', 'courier-crossing', 'river-post', 'brams-pack', 'endless_1', 'weekly'].every(id => c.adventures.some(e => e.mapId === id)), 'existing IDs available');
    for (const id of ['crypt', 'endless_1', 'weekly']) { const s = await start(id); check(id === 'weekly' ? !!s.weeklyLabel : s.mapId === id, 'original game routing preserved: ' + id); }
    check((await api('GET', '/api/content')).body.adventures.length === 12, 'generated floors never leak into authored directory');
  });
  await test('Two new IDs import; no metadata stays list-only, public waypoint compiles without hidden lore', async () => {
    const b = copy();
    b.maps[0].knowledge = 'M1_SECRET_KNOWLEDGE'; b.maps[0].localized = { en: { name: b.maps[0].name, knowledge: 'M1_SECRET_TRANSLATED' } };
    check((await api('POST', '/api/content/import', b)).status === 200, 'two-map import accepted');
    const c = (await api('GET', '/api/content')).body, town = (await api('GET', '/api/city/info')).body;
    assert.deepEqual(c.adventures, town.adventures); assertions++;
    check(c.adventures.some(e => e.id === b.maps[0].id) && !town.mapNodes.some(e => e.id === b.maps[0].id), 'legacy metadata-free map is playable from directory');
    const node = town.mapNodes.find(e => e.id === b.maps[1].id);
    check(node.x === 72 && node.y === 45 && node.packId === b.pack.id && node.installed && node.icon === '◆', 'validated region coordinates, icon and source');
    check(town.mapRoads.some(r => r.from === node.id && r.to === 'oakhaven'), 'road endpoints compiled');
    check(resolveDisplay(node.recommendedDisplay, '', 'zh-CN') === '等级 1–3', 'recommended levels are a server descriptor');
    check(node.availableLocales.length === 0 && resolveDisplay(node.nameDisplay, '', 'zh-CN') === node.name, 'original-only pack explicitly reports fallback');
    const payload = JSON.stringify([c.adventures, c.maps, town.mapNodes, town.mapRoads]);
    check(!payload.includes('M1_SECRET') && !payload.includes('playerStart') && !payload.includes('entities') && !payload.includes('npcs'), 'catalog projection contains no rooms, NPCs, translated knowledge or outcomes');
    for (const id of b.maps.map(m => m.id)) await complete(await start(id));
  });
  const invalid = [
    ['region NaN', b => { b.maps[1].adventure.waypoint.regionX = NaN; }, 'adventure.waypoint.regionX'],
    ['region bounds', b => { b.maps[1].adventure.waypoint.regionY = 101; }, 'adventure.waypoint.regionY'],
    ['grid-style coordinates', b => { b.maps[1].adventure.waypoint.x = 2; }, 'adventure.waypoint.x'],
    ['unsafe icon', b => { b.maps[1].adventure.waypoint.icon = '<svg onload=alert(1)>'; }, 'adventure.waypoint.icon'],
    ['arbitrary effects', b => { b.maps[1].adventure.effect = { gold: 999 }; }, 'adventure.effect'],
    ['invalid level', b => { b.maps[1].adventure.levels.min = 0; }, 'adventure.levels.min'],
    ['inverted levels', b => { b.maps[1].adventure.levels.min = 4; }, 'adventure.levels'],
    ['unknown road', b => { b.maps[1].adventure.waypoint.roads[0].to = 'no-waypoint'; }, 'adventure.waypoint.roads[0].to'],
    ['list-only endpoint', b => { b.maps[1].adventure.waypoint.roads[0].to = b.maps[0].id; }, 'adventure.waypoint.roads[0].to'],
    ['self road', b => { b.maps[1].adventure.waypoint.roads[0].to = b.maps[1].id; }, 'adventure.waypoint.roads[0].to'],
    ['duplicate road', b => { b.maps[1].adventure.waypoint.roads.push({ to: 'oakhaven' }); }, 'adventure.waypoint.roads[1].to'],
    ['null road', b => { b.maps[1].adventure.waypoint.roads = [null]; }, 'adventure.waypoint.roads[0]'],
    ['null metadata', b => { b.maps[1].adventure = null; }, 'adventure'],
    ['reserved town ID', b => { b.maps[1].id = 'oakhaven'; }, 'id'],
    ['reserved mode ID', b => { b.maps[1].id = 'weekly'; }, 'id'],
    ['reserved generated ID', b => { b.maps[1].id = 'endless_7'; }, 'id'],
    ['reciprocal duplicate road', b => { b.maps[0].adventure = { waypoint: { regionX: 20, regionY: 30, roads: [{ to: b.maps[1].id }] } }; b.maps[1].adventure.waypoint.roads = [{ to: b.maps[0].id }]; }, 'adventure.waypoint.roads[0].to']
  ];
  for (const [name, mutate, field] of invalid) await test('T8 rejects ' + name + ' and preserves the installed pack', async () => {
    const b = copy(); mutate(b);
    const before = fs.readFileSync(path.join(temp, 'content', b.pack.id, 'maps', fixture.maps[1].id + '.json'), 'utf8');
    const r = content.validateBundle(b);
    check(!r.ok && r.diagnostics.some(d => d.packId === b.pack.id && d.file.startsWith('maps/') && d.field === field), 'locatable metadata diagnostic: ' + JSON.stringify(r.diagnostics));
    check((await api('POST', '/api/content/import', b)).status === 400, 'real import rejects invalid metadata');
    check(before === fs.readFileSync(path.join(temp, 'content', b.pack.id, 'maps', fixture.maps[1].id + '.json'), 'utf8'), 'transaction writes nothing');
  });
  await test('Cross-pack roads use validated endpoints; replacement cannot break dependents', async () => {
    const b = copy(); b.pack.id = 'm1-road-dependent'; b.maps = [b.maps[1]]; b.maps[0].id = 'm1-road-room'; b.maps[0].adventure.waypoint.roads = [{ to: fixture.maps[1].id }];
    check((await api('POST', '/api/content/import', b)).status === 200, 'cross-pack road accepted');
    const replacement = copy(); delete replacement.maps[1].adventure.waypoint;
    const r = await api('POST', '/api/content/import', replacement);
    check(r.status === 400 && r.body.diagnostics.some(d => d.packId === b.pack.id), 'endpoint removal rejects complete replacement');
    await api('DELETE', '/api/content/pack/' + b.pack.id);
  });
  await test('Replacement/deletion refresh both catalogs, while active map snapshots still complete and settle', async () => {
    const active = await start(fixture.maps[0].id), original = JSON.stringify(store.getSave(active.id).map);
    const b = copy(); b.maps = [b.maps[1]]; b.maps[0].name = 'Replacement Eastern Room'; b.maps[0].adventure.waypoint.regionX = 60;
    check((await api('POST', '/api/content/import', b)).status === 200, 'complete replacement accepted');
    const c = (await api('GET', '/api/content')).body, town = (await api('GET', '/api/city/info')).body;
    check(!c.adventures.some(e => e.id === fixture.maps[0].id) && town.mapNodes.find(e => e.id === b.maps[0].id).x === 60, 'both catalogs reflect installed replacement');
    check(JSON.stringify(store.getSave(active.id).map) === original, 'active snapshot not rewritten');
    check((await api('DELETE', '/api/content/pack/' + b.pack.id)).status === 200, 'pack deleted');
    check(!(await api('GET', '/api/city/info')).body.adventures.some(e => e.packId === b.pack.id), 'deleted entries absent on normal load');
    const loaded = (await api('GET', '/api/game/' + active.id)).body.state;
    check(loaded.mapId === fixture.maps[0].id && JSON.stringify(store.getSave(active.id).map) === original, 'old save can still be read');
    await complete(active);
    const before = JSON.stringify(store.getCharacters());
    const r = await api('POST', '/api/game/start', { characterId: active.characterId, mapId: fixture.maps[0].id });
    check(r.status === 400 && before === JSON.stringify(store.getCharacters()), 'unavailable new start consumes no resources');
  });
  await test('Author metadata exports intact, reimports, and both maps can win again', async () => {
    check((await api('POST', '/api/content/import', copy())).status === 200, 'example reinstalled');
    const out = (await api('GET', '/api/content/pack/' + fixture.pack.id + '/export')).body;
    assert.deepEqual(out.maps.find(m => m.id === fixture.maps[1].id).adventure, fixture.maps[1].adventure); assertions++;
    check(!JSON.stringify(out).includes('nameDisplay'), 'export preserves authored data');
    await api('DELETE', '/api/content/pack/' + fixture.pack.id);
    check((await api('POST', '/api/content/import', out)).status === 200, 'export reimports unchanged');
    for (const m of fixture.maps) await complete(await start(m.id));
    check(fs.readdirSync(path.join(temp, '.content-imports')).length === 0, 'T8 staging cleaned');
  });
} finally {
  await new Promise(resolve => server.close(resolve)); fs.rmSync(temp, { recursive: true, force: true });
  console.log('M1 directory: ' + passed + ' cases passed, ' + failed + ' failed; ' + assertions + ' assertions passed.');
}
if (failed) process.exitCode = 1;
