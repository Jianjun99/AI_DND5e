// Real Chromium inside the verification container. No player data or real AI.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { browserBinary, softwareWebGLFlags, requireWebGL, captureBrowserArtifacts } from './_browser-runtime.mjs';

const BASE = process.env.BASE_URL || `http://localhost:${process.env.PORT || 3000}`;
const PORT = 9231;
let passed = 0, failed = 0, characterId, saveId, browser, ws;
const pending = new Map();
let sequence = 0;
function assert(condition, label) {
  if (!condition) throw new Error(label);
  passed++;
  console.log('  ✔ PASS: ' + label);
}
function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error('CDP timed out: ' + method)); }, 15000);
    pending.set(id, { resolve, reject, timer });
    ws.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) {
  const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
  return result.result?.value;
}
async function waitFor(expression) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (await evaluate('!!(' + expression + ')').catch(() => false)) return true;
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  return false;
}
async function api(method, pathname, body) {
  const response = await fetch(BASE + pathname, {
    method, headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined
  });
  const result = await response.json();
  if (!response.ok) throw new Error(pathname + ': ' + JSON.stringify(result));
  return result;
}
async function screenshot(label) {
  await captureBrowserArtifacts(label, [PORT]);
  const png = path.join(process.env.VERIFY_ARTIFACT_DIR, 'screenshots', label + '-' + PORT + '-0.png');
  assert(fs.existsSync(png) && fs.statSync(png).size > 1000, label + ': real screenshot and DOM captured');
}
async function choose(selector, locale) {
  await evaluate(`(() => { const control = document.querySelector(${JSON.stringify(selector)});
    control.value = ${JSON.stringify(locale)}; control.dispatchEvent(new Event('change', { bubbles: true })); })()`);
}

console.log('\n--- T9a Language Preference & Live Delve Preservation ---');
try {
  browser = spawn(browserBinary(), ['--headless=new', ...softwareWebGLFlags(), '--no-sandbox',
    '--disable-dev-shm-usage', '--no-first-run', '--no-default-browser-check', '--lang=en-US',
    '--window-size=1280,800', '--remote-debugging-port=' + PORT,
    '--user-data-dir=' + fs.mkdtempSync(path.join(os.tmpdir(), 'ai-dnd-locale-')), BASE + '/#/']);
  let target;
  for (let attempt = 0; attempt < 60; attempt++) {
    const tabs = await fetch('http://127.0.0.1:' + PORT + '/json').then(res => res.json()).catch(() => []);
    target = tabs.find(tab => tab.type === 'page' && tab.url.startsWith(BASE));
    if (target) break;
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  if (!target) throw new Error('Required Chromium CDP target did not start');
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = () => reject(new Error('CDP WebSocket failed'));
  });
  ws.onmessage = event => {
    const result = JSON.parse(event.data);
    const call = pending.get(result.id);
    if (!call) return;
    pending.delete(result.id); clearTimeout(call.timer);
    if (result.error) call.reject(new Error(result.error.message)); else call.resolve(result.result);
  };
  await send('Page.enable');
  await requireWebGL(send);
  assert(await waitFor("document.querySelector('#quickStartCard')"), 'home is ready');
  assert(await evaluate("document.documentElement.lang === 'en'"), 'English browser starts in English');
  await choose('#topLocaleSelect', 'zh-CN');
  assert(await evaluate("document.querySelector('[data-nav=home]').textContent === '英雄' && document.documentElement.lang === 'zh-CN'"), 'topbar changes to Chinese');
  assert(await evaluate("document.title === 'AI 地下城 — D&D 2024'"), 'document title and accessibility language agree');
  const blockedStore = await evaluate(`(async () => {
    const descriptor = Object.getOwnPropertyDescriptor(window, 'localStorage');
    Object.defineProperty(window, 'localStorage', { configurable: true, get() { throw new Error('Storage blocked'); } });
    try {
      const fresh = await import('/js/i18n.js?blocked-storage');
      const initial = fresh.getLocale(); fresh.setLocale('zh-CN');
      return { initial, selected: fresh.getLocale() };
    } finally { Object.defineProperty(window, 'localStorage', descriptor); }
  })()`);
  assert(blockedStore.initial === 'en' && blockedStore.selected === 'zh-CN', 'language subsystem tolerates blocked preference storage');
  const disposed = await evaluate(`(async () => {
    const locale = await import('/js/i18n.js'); let calls = 0;
    const off = locale.onLocaleChange(() => calls++);
    locale.setLocale('en'); locale.setLocale('en'); off(); locale.setLocale('zh-CN');
    return calls;
  })()`);
  assert(disposed === 1, 'same-language selection emits no redundant event and cleanup removes the listener');

  await evaluate("document.getElementById('topSettingsBtn').click()");
  assert(await waitFor("document.getElementById('gameLocale')"), 'settings modal opens');
  assert(await evaluate("(() => { const r = document.getElementById('closeSettingsModalBtn').getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; })()"), 'long settings modal keeps its close control in the desktop viewport');
  await evaluate("document.querySelector('[data-tab=gameplay]').click(); document.getElementById('model').value = 'unsaved-model'; window.__localeModal = document.getElementById('unifiedSettingsModal')");
  assert(await evaluate("document.querySelector('[data-i18n=\"settings.title\"]').textContent === '游戏与主持人设置'"), 'newly opened settings uses the chosen locale');
  await choose('#gameLocale', 'en');
  assert(await evaluate("document.getElementById('topLocaleSelect').value === 'en' && document.getElementById('model').value === 'unsaved-model' && window.__localeModal === document.getElementById('unifiedSettingsModal')"), 'switch synchronizes selectors and preserves unsaved form and modal identity');
  await choose('#topLocaleSelect', 'zh-CN');
  assert(await evaluate("document.getElementById('gameLocale').value === 'zh-CN' && document.querySelector('[data-panel=gameplay]').classList.contains('active')"), 'topbar switch preserves the active settings tab');
  await screenshot('t9a-zh-settings');
  await evaluate("document.getElementById('closeSettingsModalBtn').click()");

  const character = await api('POST', '/api/characters', { presetId: 'guardian', name: 'Locale Adventurer' });
  characterId = character.id;
  const game = await api('POST', '/api/game/start', { characterId, bringAlly: false, difficulty: 'easy', mapId: 'crypt' });
  saveId = game.state.id;
  await evaluate(`localStorage.setItem('aiDnd.tutorial.v1', JSON.stringify({ status: 'skipped' })); location.hash = '#/play/${saveId}'`);
  assert(await waitFor("document.querySelector('#map3d canvas')"), 'live 3D delve is rendered');
  const before = await api('GET', '/api/game/' + saveId);
  await evaluate(`(() => {
    window.__localeCanvas = document.querySelector('#map3d canvas');
    window.__localeWrites = [];
    const original = window.fetch;
    window.fetch = (input, init) => {
      const method = init?.method || (input instanceof Request ? input.method : 'GET');
      if (!['GET', 'HEAD', 'OPTIONS'].includes(method.toUpperCase())) window.__localeWrites.push(String(input));
      return original(input, init);
    };
  })()`);
  // The language selector is now in the pause/settings flow. Use a visible select
  // in the existing tactical layout to retain this select-keyboard regression.
  await evaluate("document.getElementById('immersiveBtn').click(); document.getElementById('topLocaleSelect').focus()");
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40 });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40 });
  assert(await evaluate('window.__localeWrites.length === 0'), 'keyboard navigation in a select cannot move the hero');
  await choose('#topLocaleSelect', 'en');
  assert(await evaluate("window.__localeCanvas === document.querySelector('#map3d canvas')"), 'language change keeps the renderer canvas');
  assert(await evaluate(`location.hash === '#/play/${saveId}'`), 'language change keeps the current delve route');
  const header = await evaluate("(async () => (await import('/js/api.js')).api.locale())()");
  assert(header.locale === 'en', 'thin API wrapper sends the selected locale');
  await choose('#topLocaleSelect', 'zh-CN');
  const chineseHeader = await evaluate("(async () => (await import('/js/api.js')).api.locale())()");
  assert(chineseHeader.locale === 'zh-CN', 'next request uses Chinese without stale request settings');
  const after = await api('GET', '/api/game/' + saveId);
  assert(JSON.stringify(before.state) === JSON.stringify(after.state), 'switching keeps save, rev, position, HP, inventory and engine state identical');
  assert(await evaluate('window.__localeWrites.length === 0'), 'switching issues no action, start, settlement or settings write');
  await choose('#topLocaleSelect', 'en');
  await screenshot('t9a-en-play');
  await choose('#topLocaleSelect', 'zh-CN');
  await send('Page.reload');
  assert(await waitFor("document.querySelector('#map3d canvas') && document.documentElement.lang === 'zh-CN'"), 'reload restores the language and active delve');
  assert(await evaluate("document.getElementById('topLocaleSelect').value === 'zh-CN'"), 'selector restores the persisted preference');

  // Phone: expanded Chinese navigation must keep the language control reachable.
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await evaluate("document.getElementById('topSettingsBtn').click()");
  assert(await waitFor("document.getElementById('gameLocale')"), 'settings remains reachable on a phone');
  assert(await evaluate("(() => { const r = document.querySelector('.settings-modal-card').getBoundingClientRect(); return r.top >= 0 && r.left >= 0 && r.right <= innerWidth && r.bottom <= innerHeight; })()"), 'phone settings modal fits the viewport and scrolls internally');
  await evaluate("document.querySelector('[data-tab=gameplay]').click()");
  assert(await evaluate("(() => { const r = document.getElementById('topLocaleSelect').getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && r.height > 0; })()"), 'phone language control fits the viewport');
  await screenshot('t9a-zh-mobile');
} catch (error) {
  failed++;
  console.error('  ❌ T9a ERROR:', error.stack);
  await captureBrowserArtifacts('t9a-failure', [PORT]);
} finally {
  for (const call of pending.values()) { clearTimeout(call.timer); call.reject(new Error('Browser cleanup')); }
  pending.clear();
  try { ws?.close(); } catch {}
  try { browser?.kill('SIGKILL'); } catch {}
  try {
    if (saveId) await api('DELETE', '/api/game/' + saveId);
    if (characterId) await api('DELETE', '/api/characters/' + characterId);
  } catch (error) { failed++; console.error('Cleanup failed:', error.message); }
}
console.log(`T9a CDP: ${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
