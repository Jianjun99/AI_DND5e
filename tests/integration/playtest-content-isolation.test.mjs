// tests/integration/playtest-content-isolation.test.mjs
// Review R3: playtesting a draft must never change what an ordinary player installs and plays.
// The original failure injected the draft into the shared content registry (reg.maps/gear/monsters)
// and reloaded it, so a formal new game opened on unpublished draft data - and two requests in
// flight at once could still bleed content across the boundary. A playtest run now carries its own
// snapshot, which is also the recovery source after a refresh or a server restart.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { assertTestContainer } from '../../scripts/test-container.mjs';

assertTestContainer();
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-dnd-r3-'));
process.env.DATA_DIR = temp;

const require = createRequire(import.meta.url);
const express = require('express');
const store = require('../../server/store.js');
const engine = require('../../server/game/engine.js');
const content = require('../../server/game/content.js');
const presets = require('../../server/game/presets.js');
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

function makeHero(name) {
  const char = engine.buildCharacter({ name, ...presets.draftFor('guardian') });
  char.id = store.newId('char');
  char.gold = 50;
  char.settlements = [];
  char.encounterFacts = [];
  store.saveCharacters([...store.getCharacters(), char]);
  return char;
}

async function runInChild(saveId, extras) {
  const verdictFile = path.join(temp, 'child-verdict-' + Date.now() + '-' + extras.length + '.json');
  const child = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'helpers', 'snapshot-restart-run.mjs');
  const outcome = await new Promise(resolve => {
    const proc = spawn(process.execPath, [child, saveId, verdictFile, ...extras], {
      cwd: path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..'),
      env: { ...process.env, DATA_DIR: temp },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let output = '';
    proc.stdout.on('data', d => { output += d; });
    proc.stderr.on('data', d => { output += d; });
    proc.on('close', code => resolve({ code, output }));
  });
  if (!fs.existsSync(verdictFile)) throw new Error('child produced no verdict (exit ' + outcome.code + '): ' + outcome.output.slice(-1200));
  const verdict = JSON.parse(fs.readFileSync(verdictFile, 'utf8'));
  verdict.childOutput = outcome.output.slice(-600);
  return verdict;
}

const DRAFT_REVISION = 'UNPUBLISHED DRAFT REVISION';
const installedClone = author.cloneStarterTemplate({ slug: 'review_installed', name: 'Installed Clone' });
const installedId = installedClone.draftId;
const installedMapId = installedId + '_ch1';
const draftOnly = author.cloneStarterTemplate({ slug: 'review_draft_only', name: 'Draft Only' });
const draftOnlyId = draftOnly.draftId;
const snapshotDraft = author.cloneStarterTemplate({ slug: 'review_snapshot', name: 'Snapshot Draft' });
const snapshotId = snapshotDraft.draftId;

console.log('--- Review R3 Playtest Content Isolation Tests ---');

await test('installing a clone publishes it, and the draft can then diverge from it', async () => {
  const install = await api('POST', '/api/content/drafts/' + installedId + '/install');
  check(install.status === 200 && install.body.ok, 'the clone installed: ' + install.status + ' ' + JSON.stringify(install.body).slice(0, 240));
  const published = content.getMap(installedMapId);
  check(!!published && published.name !== DRAFT_REVISION, 'the installed chapter 1 is readable by name: ' + (published && published.name));

  const draft = structuredClone(installedClone.draft);
  draft.maps[0].name = DRAFT_REVISION;
  const saved = await api('PUT', '/api/content/drafts/' + installedId, { draft });
  check(saved.status === 200 && saved.body.validation.ok === true, 'the diverged draft saves cleanly: ' + JSON.stringify(saved.body.validation && saved.body.validation.warnings));
  check(content.getMap(installedMapId).name !== DRAFT_REVISION, 'saving a draft revision did not republish the installed pack');
});

await test('playtesting a draft leaves the shared registry exactly as the player installed it', async () => {
  const before = content.getMap(installedMapId);
  const beforeName = before.name;
  const beforeRef = before;
  const preview = await api('POST', '/api/content/drafts/' + installedId + '/playtest', { difficulty: 'normal' });
  check(preview.status === 200 && preview.body.saveId, 'playtest started: ' + preview.status);
  const after = content.getMap(installedMapId);
  check(after.name === beforeName, 'the registry still serves the installed name, got ' + after.name);
  check(after === beforeRef || JSON.stringify(after) === JSON.stringify(beforeRef), 'the registry entry is the same published object after playtesting');
  const listed = await api('GET', '/api/content');
  check(listed.status === 200 && Array.isArray(listed.body.maps), 'the published content list is readable: ' + listed.status);
  check(content.reload().maps[installedMapId].name === beforeName, 'even a fresh registry scan publishes the installed name, not the draft revision');
  await api('POST', '/api/content/drafts/' + installedId + '/playtest/exit', { saveId: preview.body.saveId });
});

await test('a playtest run reads its own draft revision from the snapshot it carries', async () => {
  const preview = await api('POST', '/api/content/drafts/' + installedId + '/playtest', { difficulty: 'normal' });
  check(preview.status === 200, 'playtest started: ' + preview.status);
  const state = store.getSave(preview.body.saveId);
  check(!!state.contentSnapshot, 'the save carries a content snapshot');
  check(state.contentSnapshot.draftId === installedId, 'the snapshot belongs to this draft');
  check(state.map.name === DRAFT_REVISION, 'the run plays the unpublished revision: ' + state.map.name);
  const formal = makeHero('R3 Formal Hero');
  const start = await api('POST', '/api/game/start', { characterId: formal.id, mapId: installedMapId, difficulty: 'normal', bringAlly: 'none' });
  check(start.status === 200, 'the formal hero can start the installed chapter: ' + start.status + ' ' + JSON.stringify(start.body).slice(0, 200));
  check(start.body.state.map.name !== DRAFT_REVISION, 'the formal run plays the installed pack, got ' + start.body.state.map.name);
  check(start.body.state.isPlaytest !== true, 'the formal run is not a playtest');
  await api('DELETE', '/api/game/' + start.body.state.id);
  await api('POST', '/api/content/drafts/' + installedId + '/playtest/exit', { saveId: preview.body.saveId });
});

await test('draft content that was never installed cannot be opened by an ordinary game', async () => {
  const uninstalledMap = draftOnlyId + '_ch1';
  check(content.getMap(uninstalledMap) === null, 'the never-installed draft map is absent from the registry');
  const hero = makeHero('R3 Locked Out Hero');
  const denied = await api('POST', '/api/game/start', { characterId: hero.id, mapId: uninstalledMap, difficulty: 'normal', bringAlly: 'none' });
  check(denied.status >= 400, 'a formal start on draft-only content is refused: ' + denied.status + ' ' + JSON.stringify(denied.body).slice(0, 200));
  const preview = await api('POST', '/api/content/drafts/' + draftOnlyId + '/playtest', { difficulty: 'normal' });
  check(preview.status === 200 && preview.body.saveId, 'the same draft is still playable as a playtest: ' + preview.status);
  const run = store.getSave(preview.body.saveId);
  check(run.mapId === uninstalledMap, 'the playtest opens the draft-only map');
  check(!!run.contentSnapshot, 'and resolves it from the snapshot carried by the save');
  await api('POST', '/api/content/drafts/' + draftOnlyId + '/playtest/exit', { saveId: preview.body.saveId });
});

await test('a concurrent ordinary start never sees the draft that is playing right now', async () => {
  const hero = makeHero('R3 Concurrent Hero');
  const installedName = content.getMap(installedMapId).name;
  const [preview, start] = await Promise.all([
    api('POST', '/api/content/drafts/' + installedId + '/playtest', { difficulty: 'normal' }),
    api('POST', '/api/game/start', { characterId: hero.id, mapId: installedMapId, difficulty: 'normal', bringAlly: 'none' })
  ]);
  check(preview.status === 200, 'playtest ran concurrently: ' + preview.status);
  check(start.status === 200, 'formal start ran concurrently: ' + start.status);
  check(start.body.state.map.name === installedName, 'the concurrent formal run kept the installed content: ' + start.body.state.map.name);
  const formal = store.getSave(start.body.state.id);
  check(!formal.contentSnapshot, 'a formal run resolves through the registry, not a snapshot');
  const playtest = store.getSave(preview.body.saveId);
  check(playtest.map.name === DRAFT_REVISION, 'the concurrent playtest kept its own revision: ' + playtest.map.name);
  await api('DELETE', '/api/game/' + formal.id);
  await api('POST', '/api/content/drafts/' + installedId + '/playtest/exit', { saveId: preview.body.saveId });
});

await test('draft-only items and monsters recover from the save after a restart', async () => {
  const gearSeed = content.getGear('potion_healing');
  const monsterSeed = content.getMonster('bandit');
  check(!!gearSeed && !!monsterSeed, 'the core catalogue offers definitions to copy');
  const tonicId = snapshotId + '_draft_tonic';
  const sentryKind = snapshotId + '_draft_sentry';
  const draft = structuredClone(snapshotDraft.draft);
  draft.gear.push({ ...gearSeed, id: tonicId, name: 'Draft Tonic' });
  draft.monsters.push({ ...monsterSeed, id: sentryKind, name: 'Draft Sentry' });
  draft.maps[0].name = DRAFT_REVISION;
  draft.maps[0].entities.push({ id: 'draft_sentry', type: 'monster', kind: sentryKind, name: 'Draft Sentry', x: 2, y: 1 });
  const saved = await api('PUT', '/api/content/drafts/' + snapshotId, { draft });
  check(saved.status === 200 && saved.body.validation.ok === true, 'the draft-only definitions validate: ' + JSON.stringify(saved.body.validation && saved.body.validation.warnings));

  const preview = await api('POST', '/api/content/drafts/' + snapshotId + '/playtest', { difficulty: 'normal' });
  check(preview.status === 200, 'the snapshot draft playtests: ' + preview.status + ' ' + JSON.stringify(preview.body).slice(0, 240));
  const run = store.getSave(preview.body.saveId);
  check(!!run.entities.find(e => e.monsterId === sentryKind), 'the board hydrated the draft-only monster');
  check(content.getMap(run.mapId) === null, 'the draft map never entered the registry');

  const verdict = await runInChild(preview.body.saveId, [run.mapId, tonicId, sentryKind]);
  check(verdict.ok === true, 'a fresh process restored the run from its snapshot: ' + JSON.stringify(verdict.failures) + ' ' + verdict.childOutput);
  check(verdict.evidence.mapName === DRAFT_REVISION, 'the restored map is the draft revision: ' + verdict.evidence.mapName);
  check(verdict.evidence.gearName === 'Draft Tonic', 'the restored item is the draft definition: ' + verdict.evidence.gearName);
  check(verdict.evidence.registryHasGear === false && verdict.evidence.registryHasMonster === false, 'neither draft definition reached the shared registry');
  check(typeof verdict.evidence.runtimeMonsterHp === 'number' && verdict.evidence.runtimeMonsterHp > 0, 'the restored run still knows its draft monster: ' + verdict.evidence.runtimeMonsterHp);
  await api('POST', '/api/content/drafts/' + snapshotId + '/playtest/exit', { saveId: preview.body.saveId });
});

server.close();
try { fs.rmSync(temp, { recursive: true, force: true }); } catch {}

console.log(`\nSummary: ${passed} passed, ${failed} failed, ${assertions} assertions.\n`);
if (failed > 0) process.exit(1);
