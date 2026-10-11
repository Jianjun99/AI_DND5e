// tests/integration/story-authoring.test.mjs
// T15a Integration Tests: Template cloning, namespace remapping, draft tolerance, playtest isolation, and export/install.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { assertTestContainer } from '../../scripts/test-container.mjs';

assertTestContainer();
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-dnd-t15a-'));
process.env.DATA_DIR = temp;

const require = createRequire(import.meta.url);
const express = require('express');
const store = require('../../server/store.js');
const engine = require('../../server/game/engine.js');
const presentation = require('../../server/game/presentation.js');
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

function makeHero(name = 'T15a Hero') {
  const draft = presets.draftFor('guardian');
  const char = engine.buildCharacter({ name, ...draft });
  char.id = store.newId('char');
  char.gold = 50;
  char.xp = 100;
  char.encounterFacts = [];
  char.settlements = [];
  const chars = store.getCharacters();
  chars.push(char);
  store.saveCharacters(chars);
  return char;
}

console.log('--- T15a Story Authoring Integration Tests ---');

let createdDraftId = '';

await test('cloneStarterTemplate creates independent namespace and avoids collisions', async () => {
  const r1 = await api('POST', '/api/content/drafts/clone', { slug: 'vales_test', name: 'Valley Quest', author: 'Author A' });
  check(r1.status === 200 && r1.body.ok, 'clone 1 succeeded');
  createdDraftId = r1.body.draftId;
  check(createdDraftId === 'custom_vales_test', 'target slug is custom_vales_test');

  // Second clone with same slug must avoid collision
  const r2 = await api('POST', '/api/content/drafts/clone', { slug: 'vales_test', name: 'Valley Quest 2', author: 'Author B' });
  check(r2.status === 200 && r2.body.ok, 'clone 2 succeeded');
  check(r2.body.draftId === 'custom_vales_test-2', 'second clone collided and got -2 suffix: ' + r2.body.draftId);

  // Clean up second clone
  await api('DELETE', `/api/content/drafts/${r2.body.draftId}`);
});

await test('cloned draft has completely remapped internal IDs and preserved global semantics', async () => {
  const res = await api('GET', `/api/content/drafts/${createdDraftId}`);
  check(res.status === 200 && res.body.draft, 'draft retrieved');
  const d = res.body.draft;

  // Pack ID
  check(d.pack.id === createdDraftId, 'pack ID matches draft ID');

  // Maps
  check(d.maps.length === 2, 'two chapters present');
  const ch1 = d.maps[0];
  const ch2 = d.maps[1];

  check(ch1.id === `${createdDraftId}_ch1`, 'chapter 1 map ID remapped');
  check(ch1.story.id === `${createdDraftId}_story_ch1`, 'chapter 1 story ID remapped');
  check(ch2.id === `${createdDraftId}_ch2`, 'chapter 2 map ID remapped');
  check(ch2.story.id === `${createdDraftId}_story_ch2`, 'chapter 2 story ID remapped');

  // Cross-chapter history dependency strictly points to cloned chapter 1
  check(ch2.story.requiresHistory.storyId === `${createdDraftId}_story_ch1`, 'chapter 2 requiresHistory points to cloned ch1: ' + ch2.story.requiresHistory.storyId);
  check(ch2.story.requiresHistory.fallback === 'no_history', 'chapter 2 fallback is no_history');

  // Local gear remapped
  check(d.gear.some(g => g.id === `${createdDraftId}_courier_ledger`), 'pack gear courier_ledger remapped with prefix');
  check(!d.gear.some(g => g.id === 'courier_ledger'), 'original courier_ledger ID not in pack gear');

  // Global items/monsters/semantics are NOT prefixed
  const campfire = ch1.entities.find(e => e.id === 'campfire');
  check(campfire && campfire.id === 'campfire', 'campfire semantic ID preserved without prefix');
  const guard = ch1.entities.find(e => e.kind === 'bandit');
  check(guard && guard.kind === 'bandit', 'bandit monster kind preserved without prefix');

  // Roads in ch2
  const road = ch2.adventure?.waypoint?.roads?.[0];
  check(road && road.to === `${createdDraftId}_ch1`, 'road to ch1 remapped: ' + road?.to);
});

await test('draft tolerance: draft is saved and preserved despite validation errors', async () => {
  const getRes = await api('GET', `/api/content/drafts/${createdDraftId}`);
  const badDraft = JSON.parse(JSON.stringify(getRes.body.draft));

  // Introduce an intentional validation error: invalid DC (negative)
  const scene = badDraft.maps[0].scenes.find(s => s.id === `${createdDraftId}_crossing`);
  const checkChoice = scene.choices.find(c => c.effect?.type === 'check');
  checkChoice.effect.dc = -99;

  // Also add unknown custom property to verify preservation
  badDraft.unknownAuthorMeta = { customField: 'secret_value_123', revision: 999 };

  // Save draft with error
  const saveRes = await api('PUT', `/api/content/drafts/${createdDraftId}`, { draft: badDraft });
  check(saveRes.status === 200, 'saving draft with errors succeeds');
  check(saveRes.body.validation.ok === false, 'validation reports ok: false');
  check(saveRes.body.validation.diagnostics.some(d => d.field?.includes('dc')), 'dc diagnostic reported');

  // Verify file was saved on disk with the unknown property preserved
  const loadedRes = await api('GET', `/api/content/drafts/${createdDraftId}`);
  check(loadedRes.body.draft.unknownAuthorMeta?.customField === 'secret_value_123', 'unknown field preserved non-destructively');

  // Attempting to install or export or playtest an invalid draft must fail
  const installRes = await api('POST', `/api/content/drafts/${createdDraftId}/install`);
  check(installRes.status === 400, 'installing invalid draft refused (400)');

  const exportRes = await api('GET', `/api/content/drafts/${createdDraftId}/export`);
  check(exportRes.status === 400, 'exporting invalid draft refused (400)');

  const playtestRes = await api('POST', `/api/content/drafts/${createdDraftId}/playtest`);
  check(playtestRes.status === 400, 'playtesting invalid draft refused (400)');

  // Fix the draft
  checkChoice.effect.dc = 12;
  const fixRes = await api('PUT', `/api/content/drafts/${createdDraftId}`, { draft: badDraft });
  check(fixRes.status === 200 && fixRes.body.validation.ok === true, 'fixed draft validates cleanly');
});

await test('safe playtest lifecycle: isolated session zero contamination', async () => {
  const hero = makeHero('Formal Adventurer');
  const initialGold = hero.gold;
  const initialXp = hero.xp;

  // Start playtest
  const ptRes = await api('POST', `/api/content/drafts/${createdDraftId}/playtest`, { difficulty: 'normal' });
  check(ptRes.status === 200 && ptRes.body.saveId, 'playtest started');
  const saveId = ptRes.body.saveId;

  // Check state has isPlaytest and ownerDraftId
  const gameRes = await api('GET', `/api/game/${saveId}`);
  check(gameRes.status === 200, 'game state loaded');
  check(gameRes.body.state.isPlaytest === true, 'state is stamped isPlaytest: true');
  check(gameRes.body.state.ownerDraftId === createdDraftId, 'state ownerDraftId matches draft ID');

  // Force victory in the playtest delve
  await store.withSaveLock(saveId, () => {
    const s = store.getSave(saveId);
    s.mode = 'victory';
    s.character.gold = 9999;
    s.character.xp = 50000;
    s.encounterFacts = [{
      id: `${saveId}:${s.mapId}:test_fact`,
      saveId,
      mapId: s.mapId,
      sceneId: 'test_scene',
      storyId: createdDraftId + '_story_ch1',
      choiceId: 'choice_1',
      fact: 'test_playtest_fact',
      ending: 'reported',
      ts: Date.now()
    }];
    store.saveGame(s);
  });

  // Call sync-delve on the formal hero using this playtest delve
  const syncRes = await api('POST', '/api/city/sync-delve', { charId: hero.id, delveStateId: saveId });
  check(syncRes.status === 200 && syncRes.body.ok, 'sync-delve succeeded');
  check(syncRes.body.isPlaytest === true, 'sync-delve acknowledged isPlaytest: true');

  // Verify the formal hero was NOT contaminated!
  const chars = store.getCharacters();
  const refreshedHero = chars.find(c => c.id === hero.id);
  check(refreshedHero.gold === initialGold, 'formal hero gold unchanged: ' + refreshedHero.gold);
  check(refreshedHero.xp === initialXp, 'formal hero xp unchanged: ' + refreshedHero.xp);
  check(refreshedHero.encounterFacts.length === 0, 'formal hero encounterFacts completely empty (no facts merged)');
  check(refreshedHero.settlements.length === 0, 'formal hero settlements empty');

  // Clean up playtest save
  await api('DELETE', `/api/game/${saveId}`);
});

await test('bundle export and import roundtrip into live content registry', async () => {
  // Export bundle
  const expRes = await api('GET', `/api/content/drafts/${createdDraftId}/export`);
  check(expRes.status === 200, 'export bundle status 200');
  check(expRes.body.format === 'ai-dnd-pack', 'bundle format is ai-dnd-pack');
  check(expRes.body.pack?.id === createdDraftId, 'bundle pack ID matches');

  // Install draft
  const instRes = await api('POST', `/api/content/drafts/${createdDraftId}/install`);
  check(instRes.status === 200 && instRes.body.ok, 'install draft status 200');

  // Check content registry lists installed pack
  const contentRes = await api('GET', '/api/content');
  check(contentRes.body.packs.some(p => p.id === createdDraftId), 'pack registered in content registry');
  check(contentRes.body.maps.some(m => m.id === `${createdDraftId}_ch1`), 'map ch1 registered in content registry');

  // Start a formal game on the installed pack's chapter 1
  const formalHero = makeHero('Explorer Hero');
  const startRes = await api('POST', '/api/game/start', {
    charId: formalHero.id,
    mapId: `${createdDraftId}_ch1`,
    difficulty: 'normal'
  });
  check(startRes.status === 200 && startRes.body.state, 'game started on installed custom map');
  check(startRes.body.state.mapId === `${createdDraftId}_ch1`, 'delve running on custom map');

  // Clean up game and installed pack
  await api('DELETE', `/api/game/${startRes.body.state.id}`);
  await api('DELETE', `/api/content/pack/${createdDraftId}`);
  await api('DELETE', `/api/content/drafts/${createdDraftId}`);
});

server.close();
try { fs.rmSync(temp, { recursive: true, force: true }); } catch {}

console.log(`\nSummary: ${passed} passed, ${failed} failed, ${assertions} assertions.\n`);
if (failed > 0) process.exit(1);
