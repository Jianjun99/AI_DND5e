// tests/integration/clone-playthrough.test.mjs
// Review R2: a cloned starter adventure must own every resource its story actually touches, and
// it must be beatable - in the playtest snapshot and again after export -> import into a fresh,
// isolated data environment. The original failure granted `courier_ledger` while the endings
// demanded `custom_*_courier_ledger`, so all three endings were unreachable; bundle validation
// could not see it because the shipped pack resolved the dangling reference.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { assertTestContainer } from '../../scripts/test-container.mjs';
import { playCourierChapter } from '../helpers/dual-chapter-run.mjs';

assertTestContainer();
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-dnd-r2-'));
process.env.DATA_DIR = temp;

const require = createRequire(import.meta.url);
const express = require('express');
const store = require('../../server/store.js');
const engine = require('../../server/game/engine.js');
const content = require('../../server/game/content.js');
const presets = require('../../server/game/presets.js');
const author = require('../../server/game/content-authoring.js');
const gameRouter = require('../../server/routes/game.js');
const presentation = require('../../server/game/presentation.js');

store.saveSettings({ llm: { enabled: false }, portraits: { enabled: false } });

let passed = 0, failed = 0, assertions = 0;
const log = [];
function check(value, message) { assert.ok(value, message); assertions++; }
async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log('  PASS: ' + name);
  } catch (error) {
    failed++;
    console.error('  FAIL: ' + name + '\n' + error.stack);
    for (const line of log.splice(0)) console.error('    evidence: ' + line);
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
const ctx = { api, store, engine, assert: check, log: line => log.push(String(line).trim()) };

// Every place the authored schema can store a real resource reference.
function itemRefsOf(bundle) {
  const refs = [];
  for (const map of bundle.maps || []) {
    for (const scene of map.scenes || []) {
      for (const choice of scene.choices || []) {
        if (choice.condition && choice.condition.itemId) refs.push({ at: map.id + '/' + scene.id + '/' + choice.id + '.condition.itemId', id: choice.condition.itemId });
        if (choice.effect && choice.effect.giveItem) refs.push({ at: map.id + '/' + scene.id + '/' + choice.id + '.effect.giveItem', id: choice.effect.giveItem });
        if (choice.effect && choice.effect.consumeItem) refs.push({ at: map.id + '/' + scene.id + '/' + choice.id + '.effect.consumeItem', id: choice.effect.consumeItem });
      }
    }
    for (const entity of map.entities || []) {
      for (const item of (entity.loot && entity.loot.items) || []) {
        if (item && item.id) refs.push({ at: map.id + '/entity.' + entity.id + '.loot', id: item.id });
      }
    }
  }
  return refs;
}

// Items the core catalogue owns; a clone must not rename these.
const GLOBAL_ITEMS = new Set(['potion_healing', 'potion_greater_healing', 'antitoxin', 'oil_flask', 'tinderbox', 'rations', 'waterskin', 'torch', 'manacles']);
const starterPackRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'content', 'missing-courier');

console.log('--- Review R2 Clone Remapping & Two-Chapter Playthrough Tests ---');

const cloned = author.cloneStarterTemplate({ slug: 'review_clone', name: 'Review Clone', author: 'R2' });
const draftId = cloned.draftId;
const bundle = cloned.draft;

await test('the clone owns every resource its story references', () => {
  check(cloned.validation.ok === true, 'the clone validates: ' + cloned.validation.warnings.join(' | '));
  const refs = itemRefsOf(bundle);
  check(refs.length >= 5, 'the walker found the real references (' + refs.map(r => r.at).join(', ') + ')');
  const offenders = refs.filter(r => !r.id.startsWith(draftId + '_') && !GLOBAL_ITEMS.has(r.id));
  check(offenders.length === 0, 'no reference still points at a starter-owned resource: ' + JSON.stringify(offenders));
  check(!refs.some(r => r.id === 'courier_ledger'), 'courier_ledger is nowhere in the clone: ' + JSON.stringify(refs));
  const granted = refs.filter(r => r.at.endsWith('.effect.giveItem')).map(r => r.id);
  check(granted.every(id => id === draftId + '_courier_ledger'), 'the ledger a clone grants is namespaced to the clone: ' + granted.join(', '));
  const demanded = refs.filter(r => r.at.endsWith('.condition.itemId')).map(r => r.id);
  check(demanded.every(id => id === draftId + '_courier_ledger' || GLOBAL_ITEMS.has(id)), 'each condition names the clone ledger or a core catalogue item: ' + demanded.join(', '));
  check(demanded.includes(draftId + '_courier_ledger'), 'an ending still gates on the ledger, now the clone copy of it');
  check(bundle.gear.every(g => g.id.startsWith(draftId + '_')), 'every gear definition is namespaced');
  const known = new Set([...GLOBAL_ITEMS, ...bundle.gear.map(g => g.id), 'chain_mail', 'longsword', 'shield']);
  check(refs.every(r => known.has(r.id)), 'every reference resolves inside the clone or the core catalogue: ' + JSON.stringify(refs.filter(r => !known.has(r.id))));
});

await test('the clone keeps global rules and semantic IDs untouched', () => {
  const ch1 = bundle.maps[0];
  check(ch1.entities.some(e => e.id === 'campfire'), 'campfire keeps its semantic id');
  check(ch1.entities.some(e => e.kind === 'bandit'), 'monster kind bandit stays a core reference');
  const door = ch1.entities.find(e => e.type === 'door');
  check(!!door && door.id === draftId + '_bridge', 'the bridge door is namespaced: ' + (door && door.id));
  const scene = ch1.scenes.find(s => s.kind === 'story' && s.doorId);
  check(scene.doorId === door.id, 'the scene references the namespaced door, not the starter id');
  check(ch1.scenes.every(s => s.id.startsWith(draftId + '_')), 'chapter 1 scenes are namespaced');
  const ch2 = bundle.maps[1];
  check(ch2.story.requiresHistory.storyId === draftId + '_story_ch1', 'chapter 2 inherits this clone story');
  check(ch2.story.requiresHistory.fallback === 'no_history', 'chapter 2 still falls back honestly without history');
  check(content.getMap('courier-crossing') && content.getMap('courier-crossing').scenes.some(s => s.id === 'reckoning'), 'the shipped starter pack itself is untouched');
  const shipped = JSON.parse(fs.readFileSync(path.join(starterPackRoot, 'maps/courier-crossing.json'), 'utf8'));
  check(shipped.scenes.some(s => (s.choices || []).some(c => c.condition && c.condition.itemId === 'courier_ledger')), 'the starter pack still uses its own bare ledger id');
});

let playtestSaveId = '';
await test('a cloned chapter 1 plays to its ending with the ledger it actually grants', async () => {
  const preview = await api('POST', '/api/content/drafts/' + draftId + '/playtest', { difficulty: 'normal' });
  check(preview.status === 200 && preview.body.saveId, 'playtest started: ' + preview.status + ' ' + JSON.stringify(preview.body).slice(0, 200));
  playtestSaveId = preview.body.saveId;
  const result = await playCourierChapter(ctx, playtestSaveId, {
    doorId: draftId + '_bridge',
    ledgerItemId: draftId + '_courier_ledger',
    endingChoice: 'report'
  });
  check(result.ending === 'reported', 'the clone ending reached is reported, got ' + result.ending);
  const settled = store.getSave(playtestSaveId);
  check(!(settled.character.inventory || []).some(i => i.itemId === draftId + '_courier_ledger' && i.qty > 0), 'reporting consumed the clone ledger');
  check(settled.encounterFacts.some(f => f.storyId === draftId + '_story_ch1'), 'the fact is filed under the clone story');
});

await test('chapter 2 inherits the clone history, and a starter history does not qualify', async () => {
  const settle = await api('POST', '/api/city/sync-delve', { charId: store.getSave(playtestSaveId).characterId, delveStateId: playtestSaveId });
  check(settle.status === 200, 'the playtest chapter settled: ' + settle.status + ' ' + JSON.stringify(settle.body).slice(0, 200));

  const next = await api('POST', '/api/content/drafts/' + draftId + '/playtest', { mapId: draftId + '_ch2' });
  check(next.status === 200 && next.body.saveId, 'chapter 2 playtest started: ' + next.status);
  const binding = store.getSave(next.body.saveId).historyBinding;
  check(!!binding, 'chapter 2 opens on inherited history rather than no_history');
  check(binding.storyId === draftId + '_story_ch1', 'the binding names the clone story: ' + JSON.stringify(binding));
  check(binding.ending === 'reported', 'the binding carries the ending this hero earned: ' + JSON.stringify(binding));
  await api('POST', '/api/content/drafts/' + draftId + '/playtest/exit', { saveId: next.body.saveId });

  // A hero whose only history is the shipped starter story must not light up this clone.
  const starterHero = engine.buildCharacter({ name: 'Starter Historian', ...presets.draftFor('guardian') });
  starterHero.id = store.newId('char');
  starterHero.settlements = [{ id: 's1#1', mode: 'victory', ts: 1000 }];
  starterHero.encounterFacts = [{ id: 'f1', saveId: 's1', mapId: 'courier-crossing', sceneId: 'reckoning', storyId: 'missing-courier', choiceId: 'report', fact: 'public_record', ending: 'reported', ts: 900 }];
  check(gameRouter.resolveHistoryBinding(starterHero, { storyId: draftId + '_story_ch1', fallback: 'no_history' }) === null, 'starter history does not satisfy the clone requirement');
  check(!!gameRouter.resolveHistoryBinding(starterHero, { storyId: 'missing-courier', fallback: 'no_history' }), 'starter history still satisfies the starter requirement');
});

await test('export -> import in a fresh data environment plays both chapters to victory', async () => {
  const exported = await api('GET', '/api/content/drafts/' + draftId + '/export');
  check(exported.status === 200 && exported.body.pack.id === draftId, 'the current draft exports: ' + exported.status);
  const bundleFile = path.join(temp, 'exported-bundle.json');
  const verdictFile = path.join(temp, 'isolated-verdict.json');
  fs.writeFileSync(bundleFile, JSON.stringify(exported.body), 'utf8');

  const secondDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-dnd-r2-env-'));
  const child = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'helpers', 'isolated-import-run.mjs');
  const outcome = await new Promise(resolve => {
    const proc = spawn(process.execPath, [child, bundleFile, verdictFile], {
      cwd: path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..'),
      env: { ...process.env, DATA_DIR: secondDataDir },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let output = '';
    proc.stdout.on('data', d => { output += d; });
    proc.stderr.on('data', d => { output += d; });
    proc.on('close', code => resolve({ code, output }));
  });
  check(fs.existsSync(verdictFile), 'the isolated environment reported a verdict (exit ' + outcome.code + '):\n' + outcome.output.slice(-1500));
  const verdict = fs.existsSync(verdictFile) ? JSON.parse(fs.readFileSync(verdictFile, 'utf8')) : { ok: false, failures: ['no verdict'], evidence: {} };
  check(verdict.ok === true, 'a fresh data directory installed the export and beat both chapters: ' + JSON.stringify(verdict.failures).slice(0, 600) + '\n' + outcome.output.slice(-1200));
  check(verdict.evidence.historyBinding && verdict.evidence.historyBinding.ending === 'reported', 'chapter 2 in the fresh environment inherited the reported ending: ' + JSON.stringify(verdict.evidence.historyBinding));
  check(verdict.evidence.chapterTwo && verdict.evidence.chapterTwo.mode === 'victory', 'chapter 2 reached victory: ' + JSON.stringify(verdict.evidence.chapterTwo));
  check((verdict.evidence.roster || []).every(c => c.isPlaytest !== true || c.receipts === undefined), 'the isolated roster is described: ' + JSON.stringify(verdict.evidence.roster));
  for (const step of (verdict.evidence.steps || []).slice(-8)) console.log('    isolated: ' + step);
  try { fs.rmSync(secondDataDir, { recursive: true, force: true }); } catch {}
});

server.close();
try { fs.rmSync(temp, { recursive: true, force: true }); } catch {}

console.log(`\nSummary: ${passed} passed, ${failed} failed, ${assertions} assertions.\n`);
if (failed > 0) process.exit(1);
