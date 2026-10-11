// tests/integration/playtest-lifecycle.test.mjs
// Review R4: the playtest identity is minted by the server, its hero owns its own history, and
// every lifecycle edge (settle, exit, repeat exit, delete draft, restart) has one defined outcome
// that touches only resources this draft really owns. Temporary playtest data never appears in
// the roster, the continue entry point or any formal statistic, and cleanup is never a prefix
// match over the player's files.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { assertTestContainer } from '../../scripts/test-container.mjs';
import { playCourierChapter } from '../helpers/dual-chapter-run.mjs';

assertTestContainer();
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-dnd-r4-'));
process.env.DATA_DIR = temp;

const require = createRequire(import.meta.url);
const express = require('express');
const store = require('../../server/store.js');
const engine = require('../../server/game/engine.js');
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
const ctx = { api, store, engine, assert: check, log: () => {} };

function makeHero(name, id) {
  const char = engine.buildCharacter({ name, ...presets.draftFor('guardian') });
  char.id = id || store.newId('char');
  char.gold = 80;
  char.xp = 300;
  char.settlements = [];
  char.encounterFacts = [];
  store.saveCharacters([...store.getCharacters().filter(c => c.id !== char.id), char]);
  return char;
}
const snapshotHero = id => structuredClone(store.getCharacters().find(c => c.id === id));

const draftA = author.cloneStarterTemplate({ slug: 'review_life_a', name: 'Lifecycle A' });
const draftB = author.cloneStarterTemplate({ slug: 'review_life_b', name: 'Lifecycle B' });
const draftC = author.cloneStarterTemplate({ slug: 'review_life_c', name: 'Lifecycle C' });
const draftD = author.cloneStarterTemplate({ slug: 'review_life_d', name: 'Lifecycle D' });

console.log('--- Review R4 Playtest Lifecycle Tests ---');

await test('an ordinary hero cannot be marked playtest by the client', async () => {
  const hero = makeHero('R4 Formal Hero');
  const before = snapshotHero(hero.id);
  const r = await api('POST', '/api/game/start', {
    characterId: hero.id, mapId: 'crypt', difficulty: 'normal', bringAlly: 'none',
    isPlaytest: true, ownerDraftId: draftA.draftId
  });
  check(r.status === 200 && r.body.state, 'the ordinary start itself succeeded: ' + r.status + ' ' + JSON.stringify(r.body).slice(0, 180));
  check(r.body.state.isPlaytest !== true, 'the client flag did not brand a formal run as playtest');
  check(r.body.state.ownerDraftId === undefined, 'no draft ownership was attached to a formal run');
  const onDisk = store.getSave(r.body.state.id);
  check(onDisk.isPlaytest !== true && onDisk.ownerDraftId === undefined, 'the saved run is formal too: ' + JSON.stringify({ isPlaytest: onDisk.isPlaytest, ownerDraftId: onDisk.ownerDraftId }));
  await api('DELETE', '/api/game/' + onDisk.id);
  check(JSON.stringify(snapshotHero(hero.id)) === JSON.stringify(before), 'the roster hero is byte-identical after the attempted branding');
});

await test('the playtest hero and run stay out of the roster, the continue list and formal counts', async () => {
  const preview = await api('POST', '/api/content/drafts/' + draftA.draftId + '/playtest', { difficulty: 'normal' });
  check(preview.status === 200 && preview.body.saveId, 'playtest started: ' + preview.status);
  check(preview.body.characterId === 'playtest_' + draftA.draftId, 'the hero id is minted by the server: ' + preview.body.characterId);
  const run = store.getSave(preview.body.saveId);
  check(run.isPlaytest === true && run.ownerDraftId === draftA.draftId, 'the run carries server-written playtest ownership');

  const roster = await api('GET', '/api/characters');
  check(roster.status === 200 && roster.body.every(c => c.id !== preview.body.characterId), 'no playtest hero is offered to the player: ' + roster.body.map(c => c.id).join(','));
  check(roster.body.some(c => c.id !== preview.body.characterId), 'the formal roster is still served');
  const saves = await api('GET', '/api/game');
  check(saves.body.every(s => s.id !== preview.body.saveId), 'the continue entry never lists the playtest run: ' + saves.body.map(s => s.id).join(','));
  const direct = await api('GET', '/api/game/' + preview.body.saveId);
  check(direct.status === 200 && direct.body.state.isPlaytest === true, 'the author can still open the run it owns');
  await api('POST', '/api/content/drafts/' + draftA.draftId + '/playtest/exit', { saveId: preview.body.saveId });
});

await test('settlement verifies a real ending and the owning hero before writing anything', async () => {
  const hero = makeHero('R4 Untouched Hero');
  const before = snapshotHero(hero.id);
  const preview = await api('POST', '/api/content/drafts/' + draftB.draftId + '/playtest', { difficulty: 'normal' });
  const saveId = preview.body.saveId;

  const tooEarly = await api('POST', '/api/city/sync-delve', { charId: preview.body.characterId, delveStateId: saveId });
  check(tooEarly.status === 400, 'an unfinished playtest cannot be settled: ' + tooEarly.status);
  check(JSON.stringify(tooEarly.body).includes('not ended'), 'the refusal explains itself: ' + JSON.stringify(tooEarly.body).slice(0, 200));

  // Play the chapter out for real; only then is there anything to settle.
  const played = await playCourierChapter(ctx, saveId, {
    doorId: draftB.draftId + '_bridge', ledgerItemId: draftB.draftId + '_courier_ledger', endingChoice: 'report'
  });
  check(played.state.mode === 'victory', 'the playtest reached a real victory');

  const foreignHero = await api('POST', '/api/city/sync-delve', { charId: hero.id, delveStateId: saveId });
  check(foreignHero.status === 200 && foreignHero.body.isPlaytest === true, 'a formal charId cannot pull a playtest run into formal settlement: ' + JSON.stringify(foreignHero.body).slice(0, 200));
  check(foreignHero.body.char.id === preview.body.characterId, 'the receipt is written to the draft own hero');
  check(JSON.stringify(snapshotHero(hero.id)) === JSON.stringify(before), 'the formal hero kept every attribute, fact and receipt');

  const playtestHero = store.getCharacters().find(c => c.id === preview.body.characterId);
  check(playtestHero.settlements.some(r => r.mode === 'victory'), 'the playtest hero earned a victory receipt');
  check(playtestHero.encounterFacts.some(f => f.ending === 'reported'), 'the playtest hero remembers its own ending');
  const again = await api('POST', '/api/city/sync-delve', { charId: preview.body.characterId, delveStateId: saveId });
  check(again.status === 200 && again.body.duplicate === true, 'settling the same run twice is a duplicate, not a second receipt');
  check((playtestHero.settlements || []).length === 1, 'exactly one receipt exists for one run');
  check(JSON.stringify(snapshotHero(hero.id)) === JSON.stringify(before), 'the formal hero is still byte-identical');
  await api('POST', '/api/content/drafts/' + draftB.draftId + '/playtest/exit', { saveId });
});

await test('the next chapter opens on the ending this playtest hero earned', async () => {
  const preview = await api('POST', '/api/content/drafts/' + draftB.draftId + '/playtest', { mapId: draftB.draftId + '_ch2' });
  check(preview.status === 200, 'chapter 2 started: ' + preview.status);
  const binding = store.getSave(preview.body.saveId).historyBinding;
  check(!!binding && binding.storyId === draftB.draftId + '_story_ch1', 'chapter 2 inherits this draft story: ' + JSON.stringify(binding));
  check(binding.ending === 'reported', 'the inherited ending is the one earned: ' + JSON.stringify(binding));
  await api('POST', '/api/content/drafts/' + draftB.draftId + '/playtest/exit', { saveId: preview.body.saveId });

  const otherDraft = await api('POST', '/api/content/drafts/' + draftC.draftId + '/playtest', { mapId: draftC.draftId + '_ch2' });
  check(otherDraft.status === 200, 'a different draft chapter 2 started: ' + otherDraft.status);
  check(store.getSave(otherDraft.body.saveId).historyBinding === null, 'another draft playtester starts on no_history, not borrowed progress');
  await api('POST', '/api/content/drafts/' + draftC.draftId + '/playtest/exit', { saveId: otherDraft.body.saveId });
});

await test('exit releases exactly the run it names, and repeats honestly', async () => {
  const preview = await api('POST', '/api/content/drafts/' + draftC.draftId + '/playtest', { difficulty: 'normal' });
  const saveId = preview.body.saveId;
  const formalSave = makeHero('R4 Exit Bystander');
  const bystander = await api('POST', '/api/game/start', { characterId: formalSave.id, mapId: 'crypt', difficulty: 'normal', bringAlly: 'none' });
  check(bystander.status === 200, 'a bystander formal run is running: ' + bystander.status);

  const wrongDraft = await api('POST', '/api/content/drafts/' + draftA.draftId + '/playtest/exit', { saveId });
  check(wrongDraft.status === 403, 'another draft cannot exit this run: ' + wrongDraft.status);
  const formalClaim = await api('POST', '/api/content/drafts/' + draftC.draftId + '/playtest/exit', { saveId: bystander.body.state.id });
  check(formalClaim.status === 403, 'a formal save cannot be exited as a playtest: ' + formalClaim.status);
  check(!!store.getSave(bystander.body.state.id), 'the bystander run survived the attempt');

  const abandoned = await api('POST', '/api/content/drafts/' + draftC.draftId + '/playtest/exit', { saveId });
  check(abandoned.status === 200 && abandoned.body.ok, 'exit released the run it owns');
  check(abandoned.body.settled === null && abandoned.body.abandoned === false, 'a mid-run exit settles nothing and claims nothing: ' + JSON.stringify(abandoned.body));
  check(!store.getSave(saveId), 'the playtest save is gone');
  check(!!store.getCharacters().find(c => c.id === preview.body.characterId), 'the draft hero survives while the draft exists');
  check(!!store.getSave(bystander.body.state.id), 'neighbouring formal saves survive');

  const again = await api('POST', '/api/content/drafts/' + draftC.draftId + '/playtest/exit', { saveId });
  check(again.status === 200 && again.body.alreadyExited === true, 'a repeat exit is idempotent: ' + JSON.stringify(again.body));

  // A finished run that was never settled is settled by the exit, then released.
  const second = await api('POST', '/api/content/drafts/' + draftC.draftId + '/playtest', { difficulty: 'normal' });
  await playCourierChapter(ctx, second.body.saveId, {
    doorId: draftC.draftId + '_bridge', ledgerItemId: draftC.draftId + '_courier_ledger', endingChoice: 'protect'
  });
  const exited = await api('POST', '/api/content/drafts/' + draftC.draftId + '/playtest/exit', { saveId: second.body.saveId });
  check(exited.status === 200 && exited.body.settled, 'exiting a finished run settles it first: ' + JSON.stringify(exited.body).slice(0, 200));
  const heroAfter = store.getCharacters().find(c => c.id === second.body.characterId);
  check((heroAfter.settlements || []).length === 1, 'one receipt for one finished run: the abandoned exits before it earned anything');
  check(heroAfter.encounterFacts.some(f => f.ending === 'protected'), 'the second ending is remembered by the playtest hero');
  await api('DELETE', '/api/game/' + bystander.body.state.id);
});

await test('deleting a draft releases only that draft playtest resources', async () => {
  const lookalike = makeHero('R4 Lookalike', 'playtest_lookalike');
  const survivor = await api('POST', '/api/game/start', { characterId: lookalike.id, mapId: 'crypt', difficulty: 'normal', bringAlly: 'none' });
  check(survivor.status === 200, 'a similarly named hero can still play formally');
  const survivorSaveId = survivor.body.state.id;
  check(survivor.body.state.isPlaytest !== true, 'the lookalike id did not make it a playtest run');

  const doomed = await api('POST', '/api/content/drafts/' + draftD.draftId + '/playtest', { difficulty: 'normal' });
  check(doomed.status === 200, 'draft D is being playtested');
  check(!!store.getCharacters().find(c => c.id === 'playtest_' + draftD.draftId), 'draft D owns a playtest hero');

  const removed = await api('DELETE', '/api/content/drafts/' + draftD.draftId);
  check(removed.status === 200 && removed.body.ok, 'the draft deleted');
  check(!store.getSave(doomed.body.saveId), 'its run went with it');
  check(!store.getCharacters().some(c => c.id === 'playtest_' + draftD.draftId), 'its playtest hero went with it');
  check(!!store.getCharacters().find(c => c.id === lookalike.id), 'a formal hero with a playtest-like id survives: no prefix matching');
  check(!!store.getSave(survivorSaveId), 'that hero run survives too');
  check(store.getCharacters().some(c => c.id === 'playtest_' + draftB.draftId), 'another drafts hero is untouched');
  await api('DELETE', '/api/game/' + survivorSaveId);
});

await test('a restart sweeps leftovers whose draft is really gone', () => {
  const ghostDraft = 'custom_review_ghost';
  const ghostHero = engine.buildCharacter({ name: 'Ghost Playtester', ...presets.draftFor('guardian') });
  ghostHero.id = 'playtest_' + ghostDraft;
  ghostHero.isPlaytest = true;
  ghostHero.ownerDraftId = ghostDraft;
  const keptHero = engine.buildCharacter({ name: 'Kept Playtester', ...presets.draftFor('guardian') });
  keptHero.id = 'playtest_' + draftB.draftId;
  keptHero.isPlaytest = true;
  keptHero.ownerDraftId = draftB.draftId;
  store.saveCharacters([...store.getCharacters().filter(c => c.id !== ghostHero.id && c.id !== keptHero.id), ghostHero, keptHero]);

  const formal = makeHero('R4 Keep Me');
  const formalRun = engine.startGame(store.getCharacters().find(c => c.id === formal.id), { difficulty: 'normal', mapId: 'crypt' });
  store.saveGame(formalRun);
  const ghostRun = engine.startGame(ghostHero, { difficulty: 'normal', mapId: 'crypt' });
  ghostRun.isPlaytest = true;
  ghostRun.ownerDraftId = ghostDraft;
  store.saveGame(ghostRun);
  // A forged prefix that names no missing draft must survive: cleanup is by owned identity only.
  const impostor = makeHero('R4 Impostor', 'playtest_' + ghostDraft + '_extra');
  const impostorRun = engine.startGame(store.getCharacters().find(c => c.id === impostor.id), { difficulty: 'normal', mapId: 'crypt' });
  store.saveGame(impostorRun);

  const swept = author.sweepOrphanPlaytests();
  check(swept.saves.includes(ghostRun.id), 'the orphan run of a deleted draft is released: ' + JSON.stringify(swept.saves));
  check(swept.heroes.includes(ghostHero.id), 'its hero is released too: ' + JSON.stringify(swept.heroes));
  check(!store.getSave(ghostRun.id), 'the orphan save is gone from the store');
  check(!!store.getSave(formalRun.id), 'formal runs are never swept');
  check(!!store.getSave(impostorRun.id), 'a lookalike id keeps its run');
  check(store.getCharacters().some(c => c.id === impostor.id), 'a lookalike hero is not deleted by prefix');
  check(store.getCharacters().some(c => c.id === keptHero.id), 'a hero whose draft still exists is kept');
  check(!store.getCharacters().some(c => c.id === ghostHero.id), 'the ghost hero is gone');
  check(store.getCharacters().some(c => !c.isPlaytest), 'the formal roster is still there');
});

server.close();
try { fs.rmSync(temp, { recursive: true, force: true }); } catch {}

console.log(`\nSummary: ${passed} passed, ${failed} failed, ${assertions} assertions.\n`);
if (failed > 0) process.exit(1);
