// tests/helpers/isolated-import-run.mjs
// Child process for the review R2 regression: it boots in a *different* DATA_DIR, imports an
// exported clone bundle exactly like a fresh player would, then plays both chapters for real with
// an ordinary hero and settles each one. It writes a JSON verdict for the parent suite; a crash
// also produces a verdict, because a silent child is how a test suite starts lying.
//
// Usage: node tests/helpers/isolated-import-run.mjs <bundle.json> <verdict.json>

import fs from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const bundlePath = process.argv[2];
const verdictPath = process.argv[3];
const evidence = { dataDir: process.env.DATA_DIR, steps: [] };
const failures = [];
const note = step => evidence.steps.push(step);
const assertStep = (value, message) => { if (!value) { failures.push(message); throw new Error(message); } };

try {
  const express = require('express');
  const store = require('../../server/store.js');
  const engine = require('../../server/game/engine.js');
  const presets = require('../../server/game/presets.js');
  const content = require('../../server/game/content.js');
  const author = require('../../server/game/content-authoring.js');
  const presentation = require('../../server/game/presentation.js');
  const { playCourierChapter, playRiverPostChapter } = await import('../helpers/dual-chapter-run.mjs');

  const bundle = JSON.parse(fs.readFileSync(bundlePath, 'utf8'));
  evidence.packId = bundle.pack.id;
  evidence.mapIds = bundle.maps.map(m => m.id);

  store.saveSettings({ llm: { enabled: false }, portraits: { enabled: false } });
  const installed = author.installBundle(bundle);
  assertStep(!!installed.ok, 'the exported bundle installed');
  const reg = content.scan({ cache: false });
  assertStep(reg.packs.some(p => p.id === bundle.pack.id && p.installed), 'the pack reads back as installed from this data directory');
  assertStep(reg.maps[bundle.maps[0].id] && reg.maps[bundle.maps[1].id], 'both chapter maps resolve from the installed files');
  note('installed ' + bundle.pack.id + ' with ' + reg.maps[bundle.maps[0].id].entities.length + ' ch1 entities');

  const app = express();
  app.use(express.json({ limit: '12mb' }));
  app.use(require('../../server/locale.js').localeMiddleware);
  app.use(presentation.middleware);
  for (const name of ['game', 'city', 'characters', 'content']) app.use('/api/' + name, require('../../server/routes/' + name + '.js'));
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = 'http://127.0.0.1:' + server.address().port;
  const api = async (method, url, body) => {
    const r = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', 'X-Game-Locale': 'en' }, body: body === undefined ? undefined : JSON.stringify(body) });
    let json = null;
    try { json = await r.json(); } catch { json = null; }
    return { status: r.status, body: json };
  };

  const draft = presets.draftFor('guardian');
  const hero = engine.buildCharacter({ name: 'Fresh Environment Hero', ...draft });
  hero.id = store.newId('char');
  hero.gold = 50;
  hero.settlements = [];
  hero.encounterFacts = [];
  store.saveCharacters([...store.getCharacters(), hero]);

  const ctx = {
    api, store, engine, presets,
    assert: assertStep,
    log: text => note(text.trim())
  };

  const chapterOne = await api('POST', '/api/game/start', { characterId: hero.id, mapId: bundle.maps[0].id, difficulty: 'normal', bringAlly: 'none' });
  assertStep(chapterOne.status === 200 && chapterOne.body.state, 'chapter 1 started for an ordinary hero: ' + chapterOne.status + ' ' + JSON.stringify(chapterOne.body).slice(0, 200));
  const ch1Id = chapterOne.body.state.id;
  assertStep(chapterOne.body.state.isPlaytest !== true, 'an installed pack chapter is a formal run, not a playtest');
  const ch1 = await playCourierChapter(ctx, ch1Id, { doorId: bundle.pack.id + '_bridge', ledgerItemId: bundle.pack.id + '_courier_ledger', endingChoice: 'report' });
  evidence.chapterOne = { ending: ch1.ending, mode: ch1.state.mode, availability: ch1.availability };

  const settleOne = await api('POST', '/api/city/sync-delve', { charId: hero.id, delveStateId: ch1Id });
  assertStep(settleOne.status === 200 && settleOne.body.ok !== false, 'chapter 1 settled: ' + settleOne.status + ' ' + JSON.stringify(settleOne.body).slice(0, 200));
  const afterOne = store.getCharacters().find(c => c.id === hero.id);
  assertStep((afterOne.settlements || []).some(r => r.mode === 'victory'), 'the hero holds a victory receipt for chapter 1');
  evidence.chapterOneReceipts = (afterOne.settlements || []).length;

  const chapterTwo = await api('POST', '/api/game/start', { characterId: hero.id, mapId: bundle.maps[1].id, difficulty: 'normal', bringAlly: 'none' });
  assertStep(chapterTwo.status === 200 && chapterTwo.body.state, 'chapter 2 started: ' + chapterTwo.status);
  const ch2Id = chapterTwo.body.state.id;
  const binding = store.getSave(ch2Id).historyBinding;
  assertStep(!!binding, 'chapter 2 inherits this clone history instead of falling back to no_history');
  assertStep(binding.storyId === bundle.pack.id + '_story_ch1', 'the binding names this clone story: ' + JSON.stringify(binding));
  assertStep(binding.ending === 'reported', 'the binding carries the ending the hero actually earned: ' + JSON.stringify(binding));
  evidence.historyBinding = binding;

  const ch2 = await playRiverPostChapter(ctx, ch2Id);
  assertStep(ch2.state.mode === 'victory', 'chapter 2 ends in a campfire victory');
  const settleTwo = await api('POST', '/api/city/sync-delve', { charId: hero.id, delveStateId: ch2Id });
  assertStep(settleTwo.status === 200, 'chapter 2 settled: ' + settleTwo.status);
  evidence.chapterTwo = { ending: ch2.ending, mode: ch2.state.mode };
  evidence.roster = store.getCharacters().map(c => ({ id: c.id, isPlaytest: c.isPlaytest === true, receipts: (c.settlements || []).length }));
  note('two chapters completed inside ' + process.env.DATA_DIR);
  server.close();
} catch (error) {
  failures.push('child crashed: ' + error.message);
  evidence.error = error.stack;
}
fs.writeFileSync(verdictPath, JSON.stringify({ ok: failures.length === 0, failures, evidence }, null, 2));
process.exitCode = failures.length ? 1 : 0;
