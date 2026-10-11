// Real Chromium inside the verification container. No player data or real AI.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { browserBinary, softwareWebGLFlags, requireWebGL, captureBrowserArtifacts } from './_browser-runtime.mjs';

const BASE = process.env.BASE_URL || `http://localhost:${process.env.PORT || 3000}`;
const PORT = 9232;
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

const characters = [], saves = [], diagnostics = [];
async function click(selector) {
  await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
}
async function localeCheck(context) {
  const missing = await evaluate(`(async () => {
    const { catalogs } = await import('/js/localization/locale.mjs');
    const attributes = ['data-i18n', 'data-i18n-title', 'data-i18n-placeholder', 'data-i18n-aria-label', 'data-i18n-alt'];
    return [...document.querySelectorAll(attributes.map(a => '[' + a + ']').join(','))].flatMap(el =>
      attributes.filter(a => el.hasAttribute(a) && !Object.hasOwn(catalogs.en, el.getAttribute(a)))
        .map(a => ({ tag: el.tagName, key: el.getAttribute(a) })));
  })()`);
  assert(missing.length === 0, context + ': all visible display keys resolve: ' + JSON.stringify(missing));
}
async function installHolds() {
  await evaluate(`(() => {
    const original = window.fetch;
    window.__writes = []; window.__holdPath = null; window.__settlementAttempt = 0;
    window.fetch = (input, init) => {
      const url = String(input), method = init?.method || 'GET';
      if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) window.__writes.push(url);
      if (url.includes('/city/sync-delve') && window.__failSettlement && ++window.__settlementAttempt === 1)
        return Promise.resolve(new Response(JSON.stringify({ error: 'Injected failure', errorDisplay: { key: 'api.delveNotFound' } }), { status: 503, headers: { 'Content-Type': 'application/json' } }));
      if (window.__holdPath && url.includes(window.__holdPath)) {
        window.__held = true;
        return new Promise(resolve => { window.__release = () => {
          window.__holdPath = null; window.__held = false; resolve(original(input, init));
        }; });
      }
      return original(input, init);
    };
  })()`);
}

console.log('\n--- T9b Fixed Interface, Forms, Busy States & Settlement Retry ---');
try {
  browser = spawn(browserBinary(), ['--headless=new', ...softwareWebGLFlags(), '--no-sandbox',
    '--disable-dev-shm-usage', '--no-first-run', '--no-default-browser-check', '--lang=en-US',
    '--window-size=1280,900', '--remote-debugging-port=' + PORT,
    '--user-data-dir=' + fs.mkdtempSync(path.join(os.tmpdir(), 'ai-dnd-interface-')), BASE + '/#/']);
  let target;
  for (let attempt = 0; attempt < 60; attempt++) {
    target = (await fetch('http://127.0.0.1:' + PORT + '/json').then(r => r.json()).catch(() => []))
      .find(tab => tab.type === 'page' && tab.url.startsWith(BASE));
    if (target) break;
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  if (!target) throw new Error('Required Chromium CDP target did not start');
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  ws.onmessage = event => {
    const result = JSON.parse(event.data);
    if (result.method === 'Runtime.exceptionThrown') diagnostics.push(result.params.exceptionDetails);
    if (result.method === 'Runtime.consoleAPICalled' && result.params.args.some(arg => String(arg.value).includes('Missing localization key:')))
      diagnostics.push(result.params.args.map(arg => arg.value));
    const call = pending.get(result.id);
    if (!call) return;
    pending.delete(result.id); clearTimeout(call.timer);
    if (result.error) call.reject(new Error(result.error.message)); else call.resolve(result.result);
  };
  await send('Page.enable'); await send('Runtime.enable'); await requireWebGL(send);
  assert(await waitFor("document.getElementById('quickName')"), 'home ready');
  await installHolds();

  // A: a custom creator draft survives a language switch without replacing inputs.
  await evaluate("location.hash = '#/create'");
  assert(await waitFor("document.getElementById('nameInput')"), 'custom creator opens');
  await evaluate(`(() => { const input = document.getElementById('nameInput');
    input.value = '未保存的旅人 <A>'; input.dispatchEvent(new Event('input', { bubbles: true }));
    input.focus(); input.setSelectionRange(2, 5); window.__draftInput = input; })()`);
  await choose('#topLocaleSelect', 'zh-CN');
  assert(await evaluate("document.activeElement === window.__draftInput && document.getElementById('nameInput') === window.__draftInput && window.__draftInput.value === '未保存的旅人 <A>' && window.__draftInput.selectionStart === 2"), 'creator retains draft, focus, selection and input identity');
  await localeCheck('creator'); await screenshot('t9b-zh-creator');
  // Traverse every creator page using legal default selections, without submitting.
  const selections = [null, '[data-species=dwarf]', '[data-class=fighter]', '[data-bg=soldier]', null, '[data-armor]'];
  for (let step = 0; step < 6; step++) {
    if (selections[step]) await click(selections[step]);
    if (step === 5) await click('[data-weapon]');
    await choose('#topLocaleSelect', step % 2 ? 'en' : 'zh-CN');
    await localeCheck('creator step ' + (step + 1));
    await click('#nextBtn');
  }
  assert(await evaluate("!!document.getElementById('saveBtn') && document.getElementById('view').textContent.includes('未保存的旅人 <A>')"), 'all seven creator pages preserve the named draft');
  await localeCheck('creator review');
  await evaluate("location.hash = '#/'");
  assert(await waitFor("document.getElementById('quickName')"), 'back to home');

  for (const locale of ['zh-CN', 'en']) {
    await choose('#topLocaleSelect', locale);
    const other = locale === 'en' ? 'zh-CN' : 'en';
    const heroName = locale + ' 旅人 <A> "B"';
    await evaluate(`(() => { const input = document.getElementById('quickName');
      input.value = ${JSON.stringify(heroName)}; input.focus(); input.setSelectionRange(1, 4);
      window.__nameInput = input; window.__holdPath = '/api/characters'; })()`);
    await click('#quickStartBtn');
    assert(await waitFor('window.__held'), locale + ': creation request is pending');
    await choose('#topLocaleSelect', other);
    assert(await evaluate("document.getElementById('quickStartBtn').disabled && document.getElementById('quickName') === window.__nameInput && document.activeElement === window.__nameInput && window.__nameInput.selectionStart === 1"), 'creation stays busy while name and focus survive');
    assert(await evaluate(`document.getElementById('quickStartBtn').textContent.includes(${JSON.stringify(other === 'en' ? 'Forging' : '铸造')})`), 'busy button uses current language');
    await choose('#topLocaleSelect', locale); await screenshot('t9b-' + locale + '-home-busy');
    await evaluate('window.__release()');
    assert(await waitFor("location.hash.startsWith('#/overworld?char=') && document.getElementById('embarkBtn')"), 'created hero reaches prepare entrance');
    characterId = await evaluate("new URLSearchParams(location.hash.split('?')[1]).get('char')"); characters.push(characterId);
    await choose('#dispatchDifficulty', 'easy'); await choose('#dispatchCompanion', 'none');
    await evaluate("window.__prepare = document.getElementById('dispatchDifficulty'); window.__prepare.focus()");
    await choose('#topLocaleSelect', other);
    assert(await evaluate("document.getElementById('dispatchDifficulty') === window.__prepare && window.__prepare.value === 'easy' && document.getElementById('dispatchCompanion').value === 'none' && document.activeElement === window.__prepare"), 'prepare retains difficulty, companion, focus and select identity');
    await localeCheck('prepare'); await choose('#topLocaleSelect', locale);
    await screenshot('t9b-' + locale + '-prepare');
    await evaluate("localStorage.removeItem('aiDnd.tutorial.v1'); window.__holdPath = '/api/game/start'");
    await click('#embarkBtn');
    assert(await waitFor("window.__held || document.getElementById('roadEncounterModal')"), 'embark opens encounter or reaches pending start');
    if (await evaluate("!!document.getElementById('roadEncounterModal')")) {
      await localeCheck('road encounter');
      await choose('#topLocaleSelect', other); await screenshot('t9b-' + other + '-road');
      await evaluate("(document.getElementById('optProceed') || document.getElementById('optBribe') || document.getElementById('continueDelveBtn')).click()");
      assert(await waitFor("window.__held || (document.getElementById('continueDelveBtn') && !document.getElementById('continueDelveBtn').disabled)"), 'server encounter resolves');
      if (!await evaluate('window.__held')) await click('#continueDelveBtn');
    }
    assert(await waitFor('window.__held'), 'start request is pending');
    await choose('#topLocaleSelect', locale);
    assert(await evaluate("document.getElementById('embarkBtn').disabled || document.getElementById('continueDelveBtn')?.disabled"), 'pending embark cannot be clicked again after switch');
    await evaluate('window.__release()');
    assert(await waitFor("document.querySelector('#map3d canvas') && document.querySelector('.delve-tutorial-card')"), 'real 3D delve and first-delve guide mounted');
    saveId = await evaluate("location.hash.split('/')[2].split('?')[0]"); saves.push(saveId);
    await localeCheck('delve + tutorial');
    await screenshot('t9b-' + locale + '-play-tutorial');

    // B: inventory, chat and renderer survive switching. Engine state is identical.
    // Preserve T9b's simultaneous sidebar chat/form-focus contract in the retained
    // tactical layout; T10 tests the default drawer's visible chat separately.
    await evaluate("if (document.body.classList.contains('map-first')) document.getElementById('immersiveBtn').click()");
    await click('#btnOpenDelveInventory');
    assert(await waitFor("document.getElementById('delveInventoryModal')"), 'backpack modal opens');
    const before = await api('GET', '/api/game/' + saveId);
    await evaluate(`(() => {
      window.__canvas = document.querySelector('#map3d canvas'); window.__inventory = document.getElementById('delveInventoryModal');
      window.__inventory.querySelector('.modal').scrollTop = 120; window.__scroll = window.__inventory.querySelector('.modal').scrollTop;
      const input = document.getElementById('chatInput'); input.value = '未发送 Search <room>';
      input.focus(); input.setSelectionRange(2, 4); window.__chat = input; window.__writeCount = window.__writes.length;
    })()`);
    await choose('#topLocaleSelect', other);
    assert(await evaluate("window.__canvas === document.querySelector('#map3d canvas') && window.__inventory === document.getElementById('delveInventoryModal') && document.activeElement === window.__chat && window.__chat.value === '未发送 Search <room>' && window.__chat.selectionStart === 2 && window.__inventory.querySelector('.modal').scrollTop === window.__scroll"), 'switch keeps map, modal, scroll, chat draft, selection and focus');
    assert(JSON.stringify((await api('GET', '/api/game/' + saveId)).state) === JSON.stringify(before.state), 'switch leaves rev, position, HP, items and engine state untouched');
    assert(await evaluate('window.__writeCount === window.__writes.length'), 'switch sends no mutation');
    await localeCheck('backpack'); await screenshot('t9b-' + other + '-inventory');
    await click('#closeDelveInvX');
    await choose('#topLocaleSelect', locale);

    // C: all settings tabs retain the same unsaved controls; mobile layout is real Chromium.
    await click('#topSettingsBtn');
    assert(await waitFor("document.getElementById('model')"), 'settings open');
    await click('[data-tab=dm]');
    await evaluate("document.getElementById('model').value = 'unsaved-model'; document.getElementById('temperature').value = '1.3'; window.__settings = document.getElementById('unifiedSettingsModal'); document.getElementById('model').focus()");
    await choose('#topLocaleSelect', other);
    assert(await evaluate("window.__settings === document.getElementById('unifiedSettingsModal') && document.getElementById('model').value === 'unsaved-model' && document.getElementById('temperature').value === '1.3' && document.activeElement.id === 'model' && document.querySelector('[data-panel=dm]').classList.contains('active')"), 'settings preserve unsaved model, slider, active tab and focus');
    for (const tab of ['audio', 'dm', 'voice', 'gameplay', 'art', 'data']) {
      await click('[data-tab=' + tab + ']'); await localeCheck('settings ' + tab);
    }
    await choose('#topLocaleSelect', locale); await click('[data-tab=gameplay]');
    await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    assert(await evaluate("(() => { const r = document.querySelector('.settings-modal-card').getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight; })()"), 'phone settings fits viewport');
    await screenshot('t9b-' + locale + '-mobile-settings'); await click('#closeSettingsModalBtn');
    await screenshot('t9b-' + locale + '-mobile-play');
    await send('Emulation.clearDeviceMetricsOverride');

    // B: a failed settlement stays locked, retry stays busy, and saves exactly once.
    await evaluate('window.__failSettlement = true; window.__settlementAttempt = 0');
    await click('[data-act=retreat]');
    assert(await waitFor("document.getElementById('summaryRetryBtn')"), 'settlement failure offers retry');
    await choose('#topLocaleSelect', other);
    assert(await evaluate("[...document.querySelectorAll('.sumNavBtn')].every(a => a.getAttribute('aria-disabled') === 'true') && document.getElementById('summaryRetryBtn')"), 'failed save remains locked and retry remains available');
    await screenshot('t9b-' + other + '-summary-failed');
    await evaluate("window.__holdPath = '/city/sync-delve'"); await click('#summaryRetryBtn');
    assert(await waitFor('window.__held'), 'retry in flight');
    await choose('#topLocaleSelect', locale);
    assert(await evaluate("!document.getElementById('summaryRetryBtn') && [...document.querySelectorAll('.sumNavBtn')].every(a => a.getAttribute('aria-disabled') === 'true')"), 'saving state cannot be retried twice or navigated away after switch');
    await screenshot('t9b-' + locale + '-summary-saving'); await evaluate('window.__release()');
    assert(await waitFor("document.querySelector('.sumNavBtn[aria-disabled=false]')"), 'retry confirms settlement and unlocks return');
    await localeCheck('settled summary'); await screenshot('t9b-' + locale + '-summary-saved');
    const settled = await api('GET', '/api/game/' + saveId);
    assert(!!settled.state.settled?.id, 'server holds one settlement receipt');
    await click('.sumNavBtn');
    assert(await waitFor("document.getElementById('tabCityBtn')"), 'return to town');
    assert(await waitFor("(() => { if (!document.querySelector('[data-district=tavern]')) document.getElementById('tabCityBtn')?.click(); return document.querySelector('[data-district=tavern]'); })()"), 'town districts appear');
    await click('[data-district=tavern]');
    await evaluate("document.getElementById('rouletteNumber').value = '31'; document.getElementById('rouletteNumber').focus(); window.__bet = document.getElementById('rouletteNumber')");
    await choose('#topLocaleSelect', other);
    assert(await evaluate("document.getElementById('rouletteNumber') === window.__bet && window.__bet.value === '31' && document.activeElement === window.__bet"), 'town keeps edited bet and focus without re-rendering');
    for (const district of ['tavern', 'armory', 'apothecary', 'guildhall', 'hall_of_heroes']) {
      await click('[data-district=' + district + ']'); await localeCheck('town ' + district);
    }
    await choose('#topLocaleSelect', locale);
    assert(await waitFor("document.querySelector('.bestiary-kill-footer')"), 'town bestiary finishes loading before checking its language');
    assert(await evaluate(`document.querySelector('.bestiary-kill-footer').textContent.includes(${JSON.stringify(locale === 'zh-CN' ? '击杀' : 'Slain')})`), locale + ': town fixed kill count uses selected language');
    await screenshot('t9b-' + locale + '-town');
    await evaluate(`location.hash = '#/character/${characterId}'`);
    assert(await waitFor("document.querySelector('.equipment-slot') || document.querySelector('[data-slot]')"), 'character sheet ready');
    await localeCheck('character sheet'); await screenshot('t9b-' + locale + '-sheet');
    await click('[data-slot=mainHand]');
    await evaluate("window.__equipment = document.getElementById('equipModal'); document.getElementById('closeEquipModal').focus()");
    await choose('#topLocaleSelect', other);
    assert(await evaluate("window.__equipment === document.getElementById('equipModal') && document.activeElement.id === 'closeEquipModal'"), 'sheet equipment modal and focused control survive switching');
    await localeCheck('equipment modal'); await screenshot('t9b-' + other + '-equipment'); await click('#closeEquipModal');
    await choose('#topLocaleSelect', locale);
    await evaluate(`location.hash = '#/campaign/${characterId}'`);
    assert(await waitFor("document.querySelector('.campaign-hero') && document.querySelector('.campaign-acts')"), 'campaign ready');
    await localeCheck('campaign'); await screenshot('t9b-' + locale + '-campaign');
    await evaluate("location.hash = '#/'"); assert(await waitFor("document.getElementById('quickName')"), 'home restored');
  }
  assert(diagnostics.length === 0, 'no runtime errors or missing-key warnings: ' + JSON.stringify(diagnostics));
} catch (error) {
  failed++;
  console.error('  ❌ T9b ERROR:', error.stack);
  console.error('Browser diagnostics:', JSON.stringify(diagnostics));
  await captureBrowserArtifacts('t9b-failure', [PORT]);
} finally {
  for (const call of pending.values()) { clearTimeout(call.timer); call.reject(new Error('Browser cleanup')); }
  pending.clear();
  try { ws?.close(); } catch {}
  try { browser?.kill('SIGKILL'); } catch {}
  try {
    for (const id of saves) await api('DELETE', '/api/game/' + id);
    for (const id of characters) await api('DELETE', '/api/characters/' + id);
  } catch (error) { failed++; console.error('Cleanup failed:', error.message); }
}
console.log(`T9b CDP: ${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;

