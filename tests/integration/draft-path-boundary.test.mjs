// tests/integration/draft-path-boundary.test.mjs
// Review R1: every draft read/write/delete must resolve inside the drafts root, and a draft's
// path identity must agree with its own pack.id. Content errors stay tolerated inside a legal
// draft file - that tolerance is not a licence for an arbitrary path.
// Original failure: an encoded "../review-sentinel" draft id returned 200 and rewrote a file
// outside the drafts directory.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { assertTestContainer } from '../../scripts/test-container.mjs';

assertTestContainer();
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-dnd-r1-'));
process.env.DATA_DIR = temp;

const require = createRequire(import.meta.url);
const express = require('express');
const store = require('../../server/store.js');
const checks = require('../../server/game/content-validation.js');
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
app.use('/api/content', require('../../server/routes/content.js'));

const server = await new Promise(resolve => {
  const s = app.listen(0, '127.0.0.1', () => resolve(s));
});
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

const draftsRoot = path.join(temp, 'drafts');
fs.mkdirSync(draftsRoot, { recursive: true });

// The starter clone is a draft the schema already accepts, so a legal path is never refused for
// the wrong reason. Hostile PUTs only need a payload that carries a pack object.
const starter = author.cloneStarterTemplate({ slug: 'r1_legal', name: 'Legal Draft' });
const legalDraftId = starter.draftId;
check(starter.validation.ok === true, 'the starter clone used as the legal fixture validates: ' + starter.validation.warnings.join(' | '));
function draftFor(id, name = 'Path Boundary Draft') {
  const clone = structuredClone(starter.draft);
  clone.pack.id = id;
  clone.pack.name = name;
  return clone;
}
// Files that must never change, whatever a draft id claims.
function sentinel(relativePath, content) {
  const file = path.join(temp, relativePath);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, 'utf8');
  return { file, relativePath, content };
}
const outside = [
  sentinel('r1-sentinel.json', '{"marker":"keep-outside-drafts"}'),
  sentinel('settings.json', '{"llm":{"enabled":false},"portraits":{"enabled":false},"marker":"settings-must-not-be-touched"}'),
  sentinel('characters.json', '[]'),
  sentinel(path.join('saves', 'r1-save.json'), '{"marker":"save-must-not-be-touched"}'),
  sentinel(path.join('content', 'r1-pack', 'pack.json'), '{"id":"r1-pack","name":"Sentinel Pack","marker":"pack-must-not-be-touched"}')
];
const untouched = () => outside.filter(row => fs.readFileSync(row.file, 'utf8') !== row.content).map(row => row.relativePath);

// Ids that survive URL normalisation and still reach the route param (Express decodes %2F).
const urlHostile = [
  '..%2Fr1-sentinel', '%2e%2e%2Fr1-sentinel', '..%2F..%2Fr1-sentinel', '%252e%252e%252fr1-sentinel',
  '..%5Cr1-sentinel', 'a%2Fb', 'drafts%2Fr1-sentinel', '%2Ftmp%2Fabsolute',
  '..%2Fsettings', '..%2Fcharacters', '..%2Fsaves%2Fr1-save', '..%2Fcontent%2Fr1-pack%2Fpack',
  'r1-sentinel.json', 'r1%20space', 'R1-UPPER', 'r1.dots'
];
// A single encoded dot segment collapses out of the path before it can name a file: the request
// lands on the draft collection route, which lists drafts and reads no path outside the root.
const urlCollapsing = ['%2e', '%2e%2e'];
// Ids a URL can never carry (raw dot segments collapse, NUL is refused by the fetch parser),
// so they are driven straight into the handler.
const handlerHostile = ['../r1-sentinel', '../../settings', '..', '.', '', 'a/b', 'r1\u0000sentinel',
  'drafts/../r1-sentinel', '..\\r1-sentinel', '/absolute/path'];

console.log('--- Review R1 Draft Path Boundary Tests ---');

await test('the shared ID grammar admits only [a-z0-9_-]+', () => {
  for (const candidate of [...urlHostile, ...handlerHostile]) {
    const decoded = decodeURIComponent(candidate);
    if (checks.validId(decoded)) {
      check(/^[a-z0-9_-]+$/.test(decoded), 'validId admitted a non-grammar id: ' + JSON.stringify(decoded));
    }
  }
  check(checks.validId('custom_r1-ok_1') === true, 'a legal draft id still validates');
  check(checks.validId('..') === false && checks.validId('a/b') === false && checks.validId('r1\\x') === false, 'dot segments, slashes and backslashes are refused');
});

await test('PUT with a traversal id cannot write outside the drafts root', async () => {
  for (const candidate of urlHostile) {
    const res = await api('PUT', '/api/content/drafts/' + candidate, { draft: draftFor('anything') });
    check(res.status >= 400, 'PUT ' + JSON.stringify(candidate) + ' refused, got ' + res.status + ' ' + JSON.stringify(res.body).slice(0, 160));
    if (res.status === 400) check(JSON.stringify(res.body).includes('draft') || res.body.error !== undefined, 'refusal explains itself: ' + JSON.stringify(res.body).slice(0, 160));
  }
  check(untouched().length === 0, 'no file outside the drafts root was modified: ' + untouched().join(', '));
  check(fs.readdirSync(draftsRoot).join() === legalDraftId + '.json', 'a refused write leaves no draft file behind: ' + fs.readdirSync(draftsRoot).join(', '));
});

await test('GET, validate, export, install, playtest, exit and DELETE all refuse the hostile ids', async () => {
  const saved = await api('PUT', '/api/content/drafts/' + legalDraftId, { draft: draftFor(legalDraftId, 'Legal Draft') });
  check(saved.status === 200 && saved.body.validation.ok === true, 'a legal draft still saves and validates: ' + JSON.stringify(saved.body.validation && saved.body.validation.warnings));

  for (const candidate of urlHostile) {
    const at = '/api/content/drafts/' + candidate;
    const calls = [
      ['GET', at, undefined], ['POST', at + '/validate', undefined], ['GET', at + '/export', undefined],
      ['POST', at + '/install', undefined], ['POST', at + '/playtest', {}], ['POST', at + '/playtest/exit', { saveId: 'r1-any' }], ['DELETE', at, undefined]
    ];
    for (const [method, url, body] of calls) {
      const res = await api(method, url, body);
      check(res.status >= 400, method + ' ' + url + ' refused for ' + JSON.stringify(candidate) + ', got ' + res.status);
    }
  }
  check(untouched().length === 0, 'reads and deletes left every outside file alone: ' + untouched().join(', '));
  check(fs.existsSync(path.join(draftsRoot, legalDraftId + '.json')), 'the legal draft survived the sweep');

  for (const candidate of urlCollapsing) {
    const at = '/api/content/drafts/' + candidate;
    for (const [method, url, body] of [
      ['PUT', at, { draft: draftFor('anything') }], ['DELETE', at, undefined], ['POST', at + '/install', undefined],
      ['POST', at + '/playtest', {}], ['GET', at + '/export', undefined]
    ]) {
      const res = await api(method, url, body);
      const leakable = res.body && (res.body.draft !== undefined || res.body.saveId !== undefined || res.body.ok !== undefined);
      check(res.status >= 400 || !leakable, method + ' ' + url + ' either refused or answered without a draft payload: ' + res.status);
    }
    const collection = await api('GET', at);
    const payload = JSON.stringify(collection.body).slice(0, 120);
    check(collection.status >= 400 || (collection.body.draft === undefined && collection.body.saveId === undefined && (collection.body.drafts === undefined || Array.isArray(collection.body.drafts))),
      'GET ' + candidate + ' never answers with a single draft file payload: ' + collection.status + ' ' + payload);
  }
  check(untouched().length === 0, 'collapsed dot segments read and wrote nothing outside the root: ' + untouched().join(', '));
  check(fs.readdirSync(draftsRoot).includes(legalDraftId + '.json'), 'the collapsed sweep left the drafts root intact');
});

await test('ids that URLs cannot carry are refused by the handler itself', () => {
  for (const candidate of handlerHostile) {
    for (const [name, call] of [
      ['getDraft', () => author.getDraft(candidate)],
      ['saveDraft', () => author.saveDraft(candidate, draftFor(candidate, 'Illegal'))],
      ['deleteDraft', () => author.deleteDraft(candidate)],
      ['playtestDraft', () => author.playtestDraft(candidate, {})],
      ['exitPlaytest', () => author.exitPlaytest(candidate, 'r1-any')]
    ]) {
      let error = null;
      try { call(); } catch (caught) { error = caught; }
      check(!!error, name + ' refused ' + JSON.stringify(candidate));
      check(!error || error.code === 'invalid-draft-id' || error.status === 400, name + ' reports a path refusal, not a crash: ' + (error && error.message));
    }
  }
  check(untouched().length === 0, 'handler-level sweep touched nothing outside: ' + untouched().join(', '));
});

await test('an encoded delimiter cannot address a sibling of the drafts root', async () => {
  const nested = await api('PUT', '/api/content/drafts/..%2Fsaves%2Fr1-save', { draft: draftFor('whatever') });
  check(nested.status >= 400, 'nested save path refused: ' + nested.status);
  check(fs.readFileSync(path.join(temp, 'saves', 'r1-save.json'), 'utf8').includes('save-must-not-be-touched'), 'save sentinel intact');
  const installed = await api('PUT', '/api/content/drafts/..%2Fcontent%2Fr1-pack%2Fpack', { draft: draftFor('whatever') });
  check(installed.status >= 400, 'installed pack path refused: ' + installed.status);
  check(fs.readFileSync(path.join(temp, 'content', 'r1-pack', 'pack.json'), 'utf8').includes('pack-must-not-be-touched'), 'pack sentinel intact');
});

await test('a draft whose pack.id disagrees with its path is reported, never silently used', async () => {
  const id = 'custom_r1_identity';
  const conflict = await api('PUT', '/api/content/drafts/' + id, { draft: draftFor('some_other_pack', 'Impostor') });
  check(conflict.status === 409, 'saving under a mismatched pack.id returns 409, got ' + conflict.status);
  check(JSON.stringify(conflict.body).includes('pack.id'), 'conflict message names pack.id: ' + JSON.stringify(conflict.body).slice(0, 220));
  check(!fs.existsSync(path.join(draftsRoot, id + '.json')), 'the conflicting draft file was not created');

  // A file that already disagrees on disk (hand-planted) is surfaced by every consumer.
  const planted = 'custom_r1_planted';
  fs.writeFileSync(path.join(draftsRoot, planted + '.json'), JSON.stringify(draftFor('custom_r1_other_owner', 'Planted')), 'utf8');
  const got = await api('GET', '/api/content/drafts/' + planted);
  check(got.status === 200, 'the planted draft stays readable so the author can fix it');
  check(got.body.validation.ok === false, 'validation fails on the identity mismatch');
  check(got.body.validation.diagnostics.some(d => d.code === 'draft-id-mismatch' && d.field === 'pack.id'), 'diagnostic is draft-id-mismatch on pack.id');
  const listed = await api('GET', '/api/content/drafts');
  const row = listed.body.drafts.find(d => d.id === planted);
  check(!!row && row.isValid === false && row.errorCount >= 1, 'draft list marks it invalid with an error count');
  check(listed.body.drafts.some(d => d.id === legalDraftId && d.isValid), 'the healthy draft still lists as valid');
  const exported = await api('GET', '/api/content/drafts/' + planted + '/export');
  check(exported.status === 400, 'export refuses the identity-conflicted draft: ' + exported.status);
  const install = await api('POST', '/api/content/drafts/' + planted + '/install');
  check(install.status === 400, 'install refuses the identity-conflicted draft: ' + install.status);
  const playtest = await api('POST', '/api/content/drafts/' + planted + '/playtest');
  check(playtest.status === 400, 'playtest refuses the identity-conflicted draft: ' + playtest.status);
  check(fs.readdirSync(path.join(temp, 'content')).join() === 'r1-pack', 'refused install created no new pack folder');
});

await test('content errors inside a legal draft path stay tolerated', async () => {
  const id = 'custom_r1_halfwritten';
  const broken = draftFor(id, 'Half Written');
  const checkChoice = broken.maps.flatMap(m => m.scenes || []).flatMap(s => s.choices || []).find(c => c.effect && c.effect.type === 'check');
  check(!!checkChoice, 'the starter clone contains a skill check choice to break');
  checkChoice.effect.dc = -99;
  const saved = await api('PUT', '/api/content/drafts/' + id, { draft: broken });
  check(saved.status === 200, 'a legal path with bad content still saves: ' + saved.status);
  check(saved.body.validation.ok === false, 'validation reports the content error');
  check(saved.body.validation.diagnostics.some(d => String(d.field).includes('dc')), 'the dc diagnostic is present: ' + saved.body.validation.warnings.join(' | '));
  const read = await api('GET', '/api/content/drafts/' + id);
  check(read.status === 200 && read.body.draft.pack.name === 'Half Written', 'the half-written draft round-trips');
  check(fs.existsSync(path.join(draftsRoot, id + '.json')), 'the file sits inside the drafts root');
  check(untouched().length === 0, 'tolerating content errors never widened the path: ' + untouched().join(', '));
});

await test('deleting a legal draft only removes that draft', async () => {
  const doomed = 'custom_r1_doomed';
  await api('PUT', '/api/content/drafts/' + doomed, { draft: draftFor(doomed, 'Doomed') });
  check(fs.existsSync(path.join(draftsRoot, doomed + '.json')), 'doomed draft exists before delete');
  const res = await api('DELETE', '/api/content/drafts/' + doomed);
  check(res.status === 200 && res.body.ok, 'delete succeeded');
  check(!fs.existsSync(path.join(draftsRoot, doomed + '.json')), 'doomed draft file is gone');
  check(fs.existsSync(path.join(draftsRoot, legalDraftId + '.json')), 'neighbouring draft untouched');
  check(fs.existsSync(path.join(draftsRoot, 'custom_r1_halfwritten.json')), 'half-written draft untouched');
  check(untouched().length === 0, 'delete never reached outside: ' + untouched().join(', '));
});

server.close();
try { fs.rmSync(temp, { recursive: true, force: true }); } catch {}

console.log(`\nSummary: ${passed} passed, ${failed} failed, ${assertions} assertions.\n`);
if (failed > 0) process.exit(1);
