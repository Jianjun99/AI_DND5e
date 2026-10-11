import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { catalogs, normalizeLocale, requestLocale, message } from '../../public/js/localization/locale.mjs';

const BASE = process.env.BASE_URL || `http://localhost:${process.env.PORT || 3000}`;
const placeholders = text => [...text.matchAll(/\{([a-zA-Z][a-zA-Z0-9_]*)\}/g)].map(match => match[1]).sort();

await test('both catalogs have matching, nonempty keys and interpolation parameters', () => {
  assert.deepEqual(Object.keys(catalogs.en).sort(), Object.keys(catalogs['zh-CN']).sort());
  for (const key of Object.keys(catalogs.en)) {
    assert.equal(typeof catalogs.en[key], 'string', key);
    // Creation-site event fragments include optional empty suffixes/plural endings.
    if (!key.startsWith('event.')) assert.ok(catalogs.en[key].trim() && catalogs['zh-CN'][key].trim(), key);
    assert.deepEqual(placeholders(catalogs.en[key]), placeholders(catalogs['zh-CN'][key]), key);
    assert.ok(!/<\/?[a-z][^>]*>/i.test(catalogs.en[key] + catalogs['zh-CN'][key]), 'catalogs contain plain text');
  }
});

await test('the English catalog carries no Chinese characters or CJK punctuation', () => {
  // R9: fixed interface text must come from the catalog in the current language. An English
  // string that still holds Han glyphs or fullwidth CJK punctuation is untranslated UI,
  // whatever the language switch says.
  const cjk = new RegExp('[\u3000-\u303f\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff00-\uffef]', 'u');
  const offenders = Object.entries(catalogs.en).filter(([, text]) => cjk.test(text)).map(([key]) => key);
  assert.deepEqual(offenders, []);
  assert.ok(Object.keys(catalogs['zh-CN']).length > 400, 'the Chinese catalog is the full interface');
});

const staticKeys = (() => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const files = [];
  const walk = dir => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { if (entry.name !== 'vendor') walk(full); }
      else if (entry.name.endsWith('.js') || entry.name.endsWith('.mjs')) files.push(full);
    }
  };
  walk(path.join(root, 'public', 'js'));
  const found = new Map();
  for (const file of files) {
    for (const match of fs.readFileSync(file, 'utf8').matchAll(/\b(?:t|label)\(\s*'([a-z][a-z0-9_]*(?:\.[a-z0-9_]+)+)'/gi)) {
      if (!found.has(match[1])) found.set(match[1], path.relative(root, file));
    }
  }
  // The server ships display descriptors too (`textDisplay: { key: 'story.…' }`, `messageKey`),
  // and a missing entry there degrades to the raw key in the player's log. Only namespaced,
  // complete literals count - concatenated prefixes like 'content.skill.' are built at runtime.
  const serverFiles = [];
  const walkServer = dir => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walkServer(full);
      else if (entry.name.endsWith('.js')) serverFiles.push(full);
    }
  };
  walkServer(path.join(root, 'server'));
  const serverFound = new Map();
  for (const file of serverFiles) {
    for (const match of fs.readFileSync(file, 'utf8').matchAll(/\b(?:key|messageKey):\s*'((?:story|api|content|ui|guidance|event)\.[a-z0-9_]*(?:\.[a-z0-9_]+)*[a-z0-9])'/gi)) {
      if (!serverFound.has(match[1])) serverFound.set(match[1], path.relative(root, file));
    }
  }
  return { client: found, server: serverFound };
})();

await test('every interface key the client asks for resolves in both languages', () => {
  // A new button or error with no catalog entry silently degrades to the raw key on screen,
  // and only in one of the two languages. The whole client is scanned, so the next added
  // label is covered without touching this test.
  assert.ok(staticKeys.client.size > 200, 'the client references real interface keys');
  const gaps = [...staticKeys.client].filter(([key]) => !Object.hasOwn(catalogs.en, key) || !Object.hasOwn(catalogs['zh-CN'], key));
  assert.deepEqual(gaps, []);
});

await test('every server display key resolves in both languages', () => {
  assert.ok(staticKeys.server.size > 40, 'the server ships real display descriptors');
  const gaps = [...staticKeys.server].filter(([key]) => !Object.hasOwn(catalogs.en, key) || !Object.hasOwn(catalogs['zh-CN'], key));
  assert.deepEqual(gaps, []);
});

await test('locale aliases, malformed values and unsupported languages normalize predictably', () => {
  assert.equal(normalizeLocale('zh_CN'), 'zh-CN');
  assert.equal(normalizeLocale(' zh-Hans-CN '), 'zh-CN');
  assert.equal(normalizeLocale('en-US'), 'en');
  for (const input of [null, undefined, {}, ['zh'], 'fr', '<script>', 'zh<script>']) {
    assert.equal(normalizeLocale(input), 'en');
  }
});

await test('Accept-Language negotiates quality, zero weights and explicit preference precedence', () => {
  assert.equal(requestLocale(undefined, 'fr,zh-CN;q=0.8,en;q=0.6'), 'zh-CN');
  assert.equal(requestLocale(undefined, 'zh;q=0,en;q=0.5'), 'en');
  assert.equal(requestLocale(undefined, 'en;q=0.4,zh;q=0.9'), 'zh-CN');
  assert.equal(requestLocale(undefined, 'zh;q=oops,en'), 'en');
  assert.equal(requestLocale('en', 'zh-CN'), 'en');
  assert.equal(requestLocale('invalid', 'zh-CN'), 'en');
});

await test('interpolation preserves player strings as text and missing keys remain diagnosable', () => {
  const name = '<img src=x onerror=alert(1)> $& {map}';
  const text = message('zh-CN', 'nav.continueSave', { character: name, map: 'crypt' });
  assert.ok(text.includes(name), 'interpolation neither executes nor recursively interprets player text');
  assert.ok(text.includes('（crypt）'));
  assert.equal(message('en', 'unknown.key'), 'unknown.key');
  assert.ok(message('en', 'nav.continueSave').includes('{character}'));
  assert.equal(message('zh-CN', 'toString'), 'toString', 'inherited object keys are never messages');
});

await test('real API negotiates language and honors the UI header', async () => {
  for (const [headers, expected] of [
    [{ 'X-Game-Locale': 'zh_CN' }, 'zh-CN'],
    [{ 'Accept-Language': 'zh-CN,en;q=0.5' }, 'zh-CN'],
    [{ 'X-Game-Locale': 'en', 'Accept-Language': 'zh-CN' }, 'en'],
    [{ 'X-Game-Locale': 'invalid', 'Accept-Language': 'zh-CN' }, 'en']
  ]) {
    const response = await fetch(BASE + '/api/locale', { headers });
    assert.equal(response.status, 200);
    const info = await response.json();
    assert.equal(info.locale, expected);
    assert.deepEqual(info.supportedLocales, ['zh-CN', 'en']);
    assert.equal(info.defaultLocale, 'en');
  }
});

await test('concurrent language requests remain request-local and write no settings or saves', async () => {
  const read = async path => (await fetch(BASE + path)).json();
  const before = await Promise.all(['/api/settings', '/api/characters', '/api/game'].map(read));
  await Promise.all(Array.from({ length: 12 }, async (_, index) => {
    const locale = index % 2 ? 'en' : 'zh-CN';
    const result = await (await fetch(BASE + '/api/locale', { headers: { 'X-Game-Locale': locale } })).json();
    assert.equal(result.locale, locale);
  }));
  assert.deepEqual(await Promise.all(['/api/settings', '/api/characters', '/api/game'].map(read)), before);
});

await test('CORS permits the locale header without changing preflight behavior', async () => {
  const response = await fetch(BASE + '/api/game', { method: 'OPTIONS', headers: {
    Origin: 'http://localhost:9999', 'Access-Control-Request-Headers': 'X-Game-Locale'
  } });
  assert.equal(response.status, 204);
  assert.ok(response.headers.get('access-control-allow-headers').includes('X-Game-Locale'));
});

await test('T9b server display descriptors keep canonical fields and cover both catalogs', async () => {
  const read = async path => (await fetch(BASE + path)).json();
  const [rules, settings, city] = await Promise.all(['/api/rules', '/api/settings', '/api/city/info'].map(read));
  const descriptors = [];
  const collect = value => {
    if (!value || typeof value !== 'object') return;
    if (typeof value.key === 'string' && (value.key.startsWith('guidance.') || Object.hasOwn(catalogs.en, value.key))) descriptors.push(value);
    else for (const entry of Object.values(value)) collect(entry);
  };
  [rules, settings, city].forEach(collect);
  assert.ok(descriptors.length > 40, 'actual rules, presets, town and settings have display metadata');
  for (const descriptor of descriptors) {
    for (const locale of ['en', 'zh-CN']) {
      assert.ok(Object.hasOwn(catalogs[locale], descriptor.key), descriptor.key);
      const text = message(locale, descriptor.key, descriptor.params || {});
      assert.ok(!/\{[a-zA-Z][a-zA-Z0-9_]*\}/.test(text), descriptor.key + ': interpolation resolved');
    }
  }
  for (const preset of rules.presets) {
    assert.ok(preset.id && preset.label && preset.defaultName && preset.display.label.key);
  }
  for (const level of ['easy', 'normal', 'hard']) {
    assert.ok(rules.difficulty[level].label && rules.difficulty[level].blurb);
    assert.equal(rules.difficulty[level].labelDisplay.key, 'difficulty.' + level + '.label');
  }
});

await test('T9b failed requests retain legacy errors and supply bilingual display metadata', async () => {
  for (const locale of ['en', 'zh-CN']) {
    const response = await fetch(BASE + '/api/characters', { method: 'POST', headers: {
      'Content-Type': 'application/json', 'X-Game-Locale': locale
    }, body: JSON.stringify({ name: '' }) });
    assert.equal(response.status, 400);
    const result = await response.json();
    assert.equal(result.error, 'Name is required');
    assert.equal(result.errorDisplay.key, 'api.nameRequired');
    assert.equal(message(locale, result.errorDisplay.key), locale === 'en' ? 'Name is required' : '请填写名字');
  }
});
