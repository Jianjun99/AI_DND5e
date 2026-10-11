// tests/e2e/authoring-review-cdp.test.mjs
// Review R5 / R8 / R9 and the R4 exit path, in the real browser: unsaved-edit protection, an
// export that carries what the author can actually see, a door that moves its tile as well as its
// marker, playtest release on exit, and a fixed interface that follows the chosen language.
// Every step is counted; a red step never stops the census and never exits zero.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { assertTestContainer } from '../../scripts/test-container.mjs';
import { browserBinary, softwareWebGLFlags, requireWebGL, captureBrowserArtifacts, closeBrowser } from './_browser-runtime.mjs';

assertTestContainer();

const BASE = process.env.BASE_URL || 'http://localhost:' + (process.env.PORT || 3000);
const PORT = 9241;
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-dnd-review-cdp-'));
const pending = new Map();
const cleanup = { drafts: [], packs: [] };

let ws, browser, sequence = 0, passed = 0, failed = 0;
function check(value, message) {
  if (!value) throw new Error('assertion failed: ' + message);
  passed++;
}
async function test(name, fn) {
  try {
    await fn();
    console.log('  PASS: ' + name);
  } catch (error) {
    failed++;
    console.error('  FAIL: ' + name + '\n    ' + (error.message || error));
  }
}
function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error('CDP timeout: ' + method)); }, 25000);
    pending.set(id, { resolve, reject, timer });
    ws.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 600));
  return r.result.value;
}
async function wait(expression, label, timeoutMs = 20000) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    if (await evaluate('!!(' + expression + ')')) return;
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error('Timed out waiting for: ' + label);
}
async function go(hash) {
  await evaluate(`(async () => {
    const m = await import('/js/app.js');
    history.replaceState(null, '', ${JSON.stringify(hash)});
    await m.navigate();
  })()`);
}
async function click(selector) {
  const r = await evaluate(`(async () => {
    let el = document.querySelector(${JSON.stringify(selector)});
    if (!el || el.disabled) return { error: 'missing or disabled' };
    el.scrollIntoView({ block: 'center' });
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    el = document.querySelector(${JSON.stringify(selector)});
    const b = el.getBoundingClientRect();
    const point = { x: b.x + b.width / 2, y: b.y + b.height / 2 };
    const hit = document.elementFromPoint(point.x, point.y);
    return el.contains(hit) || hit === el ? { point } : { error: 'occluded', hit: (hit && hit.outerHTML || '').slice(0, 160) };
  })()`);
  if (r.error || !r.point) throw new Error('cannot click ' + selector + ': ' + JSON.stringify(r));
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...r.point, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...r.point, button: 'left', clickCount: 1 });
}
async function typeInto(selector, value) {
  await evaluate(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    el.focus();
    el.value = ${JSON.stringify(value)};
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);
}
async function shot(name) {
  await captureBrowserArtifacts('review-' + name, [PORT]);
  for (const ext of ['png', 'json']) {
    check(fs.existsSync(path.join(process.env.VERIFY_ARTIFACT_DIR, 'screenshots', 'review-' + name + '-' + PORT + '-0.' + ext)), 'screenshot evidence ' + name + '.' + ext);
  }
}
async function setLocale(locale) {
  await evaluate(`(() => {
    const select = document.getElementById('topLocaleSelect');
    select.value = ${JSON.stringify(locale)};
    select.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);
  await new Promise(r => setTimeout(r, 700));
}
async function api(method, url, body) {
  const r = await fetch(BASE + url, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  let json = null;
  try { json = await r.json(); } catch { json = null; }
  return { status: r.status, body: json };
}

async function setup() {
  const args = ['--headless=new', ...softwareWebGLFlags(), '--no-sandbox', '--disable-dev-shm-usage', '--no-first-run',
    '--no-default-browser-check', '--remote-debugging-port=' + PORT, '--user-data-dir=' + profile, '--window-size=1280,800', BASE + '/#/'];
  browser = spawn(browserBinary(), args, { detached: true, stdio: 'ignore' });
  let tab;
  for (let n = 0; n < 70 && !tab; n++) {
    tab = (await fetch('http://127.0.0.1:' + PORT + '/json').then(r => r.json()).catch(() => [])).find(t => t.type === 'page');
    if (!tab) await new Promise(r => setTimeout(r, 150));
  }
  if (!tab) throw new Error('Required Chromium did not start');
  ws = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  ws.onmessage = event => {
    const msg = JSON.parse(event.data);
    if (msg.method === 'Runtime.exceptionThrown') console.error('BROWSER EXCEPTION:', JSON.stringify(msg.params?.exceptionDetails).slice(0, 400));
    const item = pending.get(msg.id);
    if (!item) return;
    clearTimeout(item.timer);
    pending.delete(msg.id);
    if (msg.error) item.reject(new Error(msg.error.message)); else item.resolve(msg.result);
  };
  await send('Page.enable');
  await send('Runtime.enable');
  await send('DOM.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  await requireWebGL(send);
  await wait("document.getElementById('view')", 'initial page load');
  await evaluate("localStorage.setItem('dnd_default_view','2d');localStorage.setItem('dnd_3d','off');localStorage.setItem('aiDnd.tutorial.v1',JSON.stringify({status:'skipped'}))");
}

const CJK = /[㐀-䶿一-鿿぀-ヿ]/;
let draftId = '';
let editedName = '';

console.log('--- Review Authoring Browser Regression (CDP) ---');
try {
  await setup();
  const cloned = await api('POST', '/api/content/drafts/clone', { slug: 'cdp_review', name: 'Review Bridge Story', author: 'CDP' });
  check(cloned.status === 200 && cloned.body.draftId, 'the review draft was cloned: ' + JSON.stringify(cloned.body).slice(0, 160));
  draftId = cloned.body.draftId;
  cleanup.drafts.push(draftId);

  await test('an unsaved edit is marked, and walking away is answered with save / discard / stay', async () => {
    await go('#/author?draft=' + draftId);
    await wait("document.getElementById('m_nameZh')", 'the manifest tab rendered');
    check(await evaluate("!document.getElementById('dirtyBadge') || document.getElementById('dirtyBadge').hidden"), 'a freshly opened draft is not dirty');
    editedName = '未保存的渡口编辑 ' + Date.now();
    await click('#m_nameZh');
    await typeInto('#m_nameZh', editedName);
    await wait("!document.getElementById('dirtyBadge').hidden", 'the unsaved badge appeared', 5000);
    check(await evaluate("document.getElementById('m_nameZh').value") === editedName, 'the editor still shows what was typed');

    await click('#view a[href="#/author"]');
    await wait("document.getElementById('draftUnsavedModal')", 'the leave guard opened instead of silently navigating away');
    const buttons = await evaluate("['draftLeaveStay','draftLeaveDiscard','draftLeaveSave'].map(id => !!document.getElementById(id))");
    check(buttons.every(Boolean), 'the guard offers stay, discard and save: ' + JSON.stringify(buttons));
    check(await evaluate("location.hash.includes('draft=')"), 'the author is still in the editor while the guard is open');

    await click('#draftLeaveStay');
    await wait("!document.getElementById('draftUnsavedModal')", 'staying closed the guard', 5000);
    check(await evaluate("location.hash.includes('draft=" + draftId + "')"), 'stay keeps the editor open');
    check(await evaluate("document.getElementById('m_nameZh').value") === editedName, 'stay keeps the typed text');
    check(await evaluate("!document.getElementById('dirtyBadge').hidden"), 'and the edit is still marked unsaved');

    const before = await api('GET', '/api/content/drafts/' + draftId);
    check(before.body.draft.pack.name !== editedName, 'the server still holds the old name (the edit is genuinely unsaved)');
    await click('#view a[href="#/author"]');
    await wait("document.getElementById('draftUnsavedModal')", 'the guard opened again', 5000);
    await click('#draftLeaveSave');
    await wait("!document.getElementById('draftUnsavedModal')", 'saving closed the guard', 15000);
    await wait("location.hash === '#/author'", 'the author left for the draft list', 15000);
    const after = await api('GET', '/api/content/drafts/' + draftId);
    check(after.body.draft.pack.name === editedName, 'save-on-leaving wrote exactly what was on screen');
    await shot('leave-guard-saved');
  });

  await test('export sends the visible edit, not the last saved copy', async () => {
    await go('#/author?draft=' + draftId);
    await wait("document.getElementById('exportBtn')", 'the editor toolbar rendered');
    const exportName = editedName + ' · EXPORTED';
    await click('#m_nameZh');
    await typeInto('#m_nameZh', exportName);
    await wait("!document.getElementById('dirtyBadge').hidden", 'the new edit is marked', 5000);
    const stale = await api('GET', '/api/content/drafts/' + draftId + '/export');
    check(stale.body.pack.name !== exportName, 'the server copy is still the older one before exporting');
    await click('#exportBtn');
    await wait("document.getElementById('exportBtn') && !document.getElementById('exportBtn').disabled", 'the export finished', 20000);
    const fresh = await api('GET', '/api/content/drafts/' + draftId + '/export');
    check(fresh.status === 200, 'the export endpoint answered: ' + fresh.status);
    check(fresh.body.pack.name === exportName, 'the exported bundle carries the visible edit, got ' + JSON.stringify(fresh.body.pack && fresh.body.pack.name));
    editedName = exportName;
    await shot('export-current-edit');
  });

  await test('a draft with content errors stays on screen and blocks export, install and playtest', async () => {
    await click('[data-tab="raw"]');
    await wait("document.getElementById('rawJsonText')", 'the raw tab opened');
    const brokenApplied = await evaluate(`(() => {
      const draft = JSON.parse(document.getElementById('rawJsonText').value);
      const choice = draft.maps[0].scenes.flatMap(s => s.choices || []).find(c => c.effect && c.effect.type === 'check');
      choice.effect.dc = -99;
      const el = document.getElementById('rawJsonText');
      el.value = JSON.stringify(draft, null, 2);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      document.getElementById('rawApplyBtn').click();
      return true;
    })()`);
    check(brokenApplied === true, 'the invalid JSON applied into the buffer');
    await click('#saveDraftBtn');
    await wait("!document.getElementById('saveDraftBtn').disabled", 'the save attempt finished', 20000);
    check(await evaluate("location.hash.includes('draft=" + draftId + "')"), 'the author stays in the editor with the broken draft');
    const bufferKept = await evaluate("document.getElementById('rawJsonText').value.includes('-99')");
    check(bufferKept, 'the rejected value is still on screen, not silently rewritten');
    const blocked = await evaluate(`(() => {
      const state = id => { const el = document.getElementById(id); return el ? { disabled: el.disabled, title: el.getAttribute('title') || '' } : null; };
      return { export: state('exportBtn'), install: state('installBtn'), playtest: state('playtestBtn'), badge: (document.getElementById('statusBadge') || {}).innerText };
    })()`);
    check(!!blocked.export && blocked.export.disabled === true, 'export is disabled while the draft has errors: ' + JSON.stringify(blocked.export));
    check(!!blocked.install && blocked.install.disabled === true, 'install is disabled too: ' + JSON.stringify(blocked.install));
    check(!!blocked.playtest && blocked.playtest.disabled === true, 'and so is playtest: ' + JSON.stringify(blocked.playtest));
    check(/error|错误|✗|⚠️/i.test(String(blocked.badge)), 'the status badge says the draft has errors: ' + JSON.stringify(blocked.badge));
    await shot('save-rejected-keeps-buffer');

    const repaired = await evaluate(`(() => {
      const draft = JSON.parse(document.getElementById('rawJsonText').value);
      const choice = draft.maps[0].scenes.flatMap(s => s.choices || []).find(c => c.effect && c.effect.type === 'check');
      choice.effect.dc = 12;
      const el = document.getElementById('rawJsonText');
      el.value = JSON.stringify(draft, null, 2);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      document.getElementById('rawApplyBtn').click();
      return true;
    })()`);
    check(repaired === true, 'the repaired JSON applied');
    await click('#saveDraftBtn');
    await wait("!document.getElementById('saveDraftBtn').disabled", 'the clean save finished', 20000);
    const validation = await api('GET', '/api/content/drafts/' + draftId);
    check(validation.body.validation.ok === true, 'the draft validates again after the fix: ' + JSON.stringify(validation.body.validation.diagnostics).slice(0, 200));
    const enabled = await evaluate("!!document.getElementById('playtestBtn') && !document.getElementById('playtestBtn').disabled");
    check(enabled, 'and the blocked actions unlock once the errors are gone');
  });

  await test('moving a door in the editor moves its tile too, and undo gives both back', async () => {
    await click('[data-tab="ch1"]');
    await wait("document.getElementById('mapGridContainer_1')", 'the map tab rendered');
    const bridgeId = draftId + '_bridge';
    const chipPresent = await evaluate("!!document.querySelector('[data-entity-chip=\"' + " + JSON.stringify(bridgeId) + " + '\"]')");
    check(chipPresent, 'the bridge door appears as a movable entity chip');
    await click('[data-tool="select"]');
    await click('[data-entity-chip="' + bridgeId + '"][data-chapter="1"]');
    await click('#mapGridContainer_1 [data-x="7"][data-y="5"]');
    await wait("!document.getElementById('dirtyBadge').hidden", 'the move marked the draft unsaved', 5000);
    const cells = await evaluate(`(() => {
      const grid = document.getElementById('mapGridContainer_1');
      const read = (x, y) => {
        const cell = grid.querySelector('[data-x="' + x + '"][data-y="' + y + '"]');
        return cell ? cell.className + '|' + (cell.textContent || '') : null;
      };
      return { oldCell: read(8, 7), newCell: read(7, 5) };
    })()`);
    check(/door|D/.test(String(cells.newCell)), 'the grid paints the doorway where the author dropped it: ' + cells.newCell);
    check(!/door/.test(String(cells.oldCell)), 'and clears the doorway it left behind: ' + cells.oldCell);
    await click('[data-tab="raw"]');
    await wait("document.getElementById('rawJsonText')", 'the raw tab reopened');
    const map = await evaluate("JSON.parse(document.getElementById('rawJsonText').value).maps[0]");
    const door = map.entities.find(e => e.id === bridgeId);
    check(!!door && door.x === 7 && door.y === 5, 'the entity moved to the clicked tile: ' + JSON.stringify(door));
    check(map.rows[5][7] === 'D', 'the new tile became a door: ' + map.rows[5][7]);
    check(map.rows[7][8] !== 'D', 'the old tile stopped being a door: ' + map.rows[7][8]);
    check(map.scenes.some(s => s.doorId === bridgeId), 'the scene reference survived the move');
    const scene = map.scenes.find(s => s.doorId === bridgeId);
    check((scene.guardIds || []).length > 0 && map.entities.some(e => scene.guardIds.includes(e.id)), 'the guards named by the scene are still on the board');
    const gridCheck = await evaluate(`(() => {
      const draft = JSON.parse(document.getElementById('rawJsonText').value);
      return JSON.stringify(draft.maps[0].rows);
    })()`);
    check(JSON.parse(gridCheck)[5][7] === 'D', 'the grid the author sees matches the grid that will export');

    await click('[data-tab="ch1"]');
    await wait("document.getElementById('mapGridContainer_1')", 'back on the map tab');
    await click('[data-map-action="undo"][data-chapter="1"]');
    await new Promise(r => setTimeout(r, 400));
    await click('[data-tab="raw"]');
    const restored = await evaluate("JSON.parse(document.getElementById('rawJsonText').value).maps[0]");
    const backDoor = restored.entities.find(e => e.id === bridgeId);
    check(backDoor.x === 8 && backDoor.y === 7, 'undo returned the door entity to its crossing: ' + backDoor.x + ',' + backDoor.y);
    check(restored.rows[7][8] === 'D', 'undo returned the door glyph as well: ' + restored.rows[7][8]);
    check(restored.rows[5][7] !== 'D', 'and cleared the tile the author had painted');
    await click('[data-tab="ch1"]');
    await click('[data-map-action="redo"][data-chapter="1"]');
    await new Promise(r => setTimeout(r, 400));
    await click('[data-tab="raw"]');
    const redone = await evaluate("JSON.parse(document.getElementById('rawJsonText').value).maps[0]");
    const redoDoor = redone.entities.find(e => e.id === bridgeId);
    check(redoDoor.x === 7 && redoDoor.y === 5, 'redo re-applied the move to the entity');
    check(redoDoor.y === 5 && redone.rows[5][7] === 'D' && redone.rows[7][8] !== 'D', 'redo re-applied it to the tiles as well');
    await shot('door-move-synced');
    // Put the crossing back for the remaining steps.
    await click('[data-tab="ch1"]');
    await click('[data-map-action="undo"][data-chapter="1"]');
    await new Promise(r => setTimeout(r, 300));
    await click('[data-tab="raw"]');
    const settled = await evaluate("JSON.parse(document.getElementById('rawJsonText').value)");
    await evaluate(`(() => {
      const el = document.getElementById('rawJsonText');
      el.value = JSON.stringify(${JSON.stringify(settled)}, null, 2);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      document.getElementById('rawApplyBtn').click();
      return true;
    })()`);
    await click('#saveDraftBtn');
    await wait("!document.getElementById('saveDraftBtn').disabled", 'the restored map saved', 20000);
  });

  await test('painting a wall over a scene-referenced door is refused with a message', async () => {
    await click('[data-tab="ch1"]');
    await wait("document.getElementById('mapGridContainer_1')", 'the map tab rendered');
    const bridgeId = draftId + '_bridge';
    const chips = await evaluate("Array.from(document.querySelectorAll('[data-entity-chip]')).map(c => c.getAttribute('data-entity-chip'))");
    check(chips.includes(bridgeId), 'the bridge is listed as an entity: ' + chips.join(', '));
    await click('[data-tool="wall"]');
    await click('#mapGridContainer_1 [data-x="8"][data-y="7"]');
    await new Promise(r => setTimeout(r, 300));
    const toastText = await evaluate("document.getElementById('toast') ? document.getElementById('toast').textContent : ''");
    check(toastText.trim().length > 0, 'the editor said why nothing happened: ' + JSON.stringify(toastText));
    await click('[data-tab="raw"]');
    const map = await evaluate("JSON.parse(document.getElementById('rawJsonText').value).maps[0]");
    const door = map.entities.find(e => e.id === bridgeId);
    check(!!door, 'the scene-referenced door is still there');
    check(map.rows[7][8] === 'D', 'and its tile is still a door rather than a wall: ' + map.rows[7][8]);
    await click('[data-tab="ch1"]');
    await click('[data-tool="erase"]');
    await click('#mapGridContainer_1 [data-x="8"][data-y="7"]');
    await new Promise(r => setTimeout(r, 300));
    await click('[data-tab="raw"]');
    const stillAn = await evaluate("JSON.parse(document.getElementById('rawJsonText').value).maps[0].entities.some(e => e.id === " + JSON.stringify(bridgeId) + ")");
    check(stillAn === true, 'the eraser respects the same scene reference');
    await shot('brush-protects-story-door');
  });

  await test('leaving a playtest releases the run on the server', async () => {
    await go('#/author?draft=' + draftId);
    await wait("document.getElementById('playtestBtn')", 'the editor toolbar rendered');
    const ready = await evaluate(`(() => {
      const btn = document.getElementById('playtestBtn');
      const badge = document.getElementById('statusBadge');
      return { disabled: btn.disabled, title: btn.getAttribute('title') || '', badge: badge ? badge.innerText : '', dirty: !document.getElementById('dirtyBadge').hidden };
    })()`);
    const stored = await api('GET', '/api/content/drafts/' + draftId);
    const problems = (stored.body.validation.diagnostics || []).filter(d => d.severity === 'error').map(d => d.field + ' ' + d.code);
    check(ready.disabled === false, 'a clean draft unlocks playtest: ' + JSON.stringify(ready) + ' errors ' + JSON.stringify(problems) + ' effects ' + JSON.stringify(stored.body.draft.maps[0].scenes[0].choices.map(c => ({ id: c.id, effect: c.effect }))));
    await click('#playtestBtn');
    await wait("document.querySelector('.playtest-banner')", 'the playtest banner is up');
    const saveId = await evaluate("location.hash.split('/').pop()");
    check(typeof saveId === 'string' && saveId.length > 4, 'the run has an id: ' + saveId);
    const openBefore = await api('GET', '/api/game/' + saveId);
    check(openBefore.status === 200 && openBefore.body.state.isPlaytest === true, 'the run exists and is a playtest');
    await setLocale('en');
    await shot('playtest-banner-en');
    const bannerText = await evaluate("document.querySelector('.playtest-banner').innerText");
    check(!CJK.test(bannerText), 'the playtest banner is English when the interface is English: ' + JSON.stringify(bannerText));
    await click('.playtest-banner a[data-exit-playtest]');
    await wait("location.hash.includes('draft=" + draftId + "')", 'the editor came back');
    const gone = await api('GET', '/api/game/' + saveId);
    check(gone.status === 404, 'the server released the run: ' + gone.status);
    const roster = await api('GET', '/api/characters');
    check(roster.body.every(c => c.id !== 'playtest_' + draftId), 'no playtest hero leaked into the roster');
    const second = await api('POST', '/api/content/drafts/' + draftId + '/playtest/exit', { saveId });
    check(second.status === 200 && second.body.alreadyExited === true, 'a repeat exit is honest about having nothing to do: ' + JSON.stringify(second.body));
  });

  await test('visiting the tabs and saving cannot quietly rewrite the story gates', async () => {
    await go('#/author?draft=' + draftId);
    await wait("document.getElementById('saveDraftBtn')", 'the editor reopened');
    for (const tab of ['manifest', 'ch1', 'ch2', 'raw', 'ch1', 'manifest']) {
      await click(`[data-tab="${tab}"]`);
      await new Promise(r => setTimeout(r, 200));
    }
    await click('#saveDraftBtn');
    await wait("!document.getElementById('saveDraftBtn').disabled", 'the save finished', 20000);
    const stored = await api('GET', '/api/content/drafts/' + draftId);
    const problems = (stored.body.validation.diagnostics || []).filter(d => d.severity === 'error').map(d => d.file + ' ' + d.field + ' ' + d.code);
    check(stored.body.validation.ok === true, 'round-tripping the forms left the draft valid: ' + JSON.stringify(problems).slice(0, 500));
    const gates = stored.body.draft.maps.flatMap(m => (m.scenes || []).flatMap(s => (s.choices || []).map(c => c.condition || {})));
    const history = gates.filter(c => c.type === 'history_ending');
    const items = gates.filter(c => c.type === 'has_item');
    const always = gates.filter(c => !c.type || c.type === 'always');
    check(history.length > 0 && history.every(c => typeof c.ending === 'string' && c.ending.length > 0), 'history gates still name their ending: ' + JSON.stringify(history).slice(0, 240));
    check(items.every(c => typeof c.itemId === 'string' && c.itemId.length > 0), 'item gates still name their item: ' + JSON.stringify(items).slice(0, 240));
    check(always.every(c => !c.itemId && !c.ending), 'unconditional choices stayed unconditional: ' + JSON.stringify(always).slice(0, 240));
    await shot('form-roundtrip-still-valid');
  });

  await test('the fixed interface follows the chosen language in both directions', async () => {
    await setLocale('en');
    await click('[data-tab="ch1"]');
    await wait("document.getElementById('mapGridContainer_1')", 'the map tab rendered in English');
    const english = await evaluate(`(() => {
      const text = (id) => { const el = document.getElementById(id) || document.querySelector(id); return el ? el.innerText : ''; };
      return {
        view: document.getElementById('view').innerText,
        save: text('#saveDraftBtn'), export: text('#exportBtn'), playtest: text('#playtestBtn'),
        undo: text('[data-map-action="undo"]'), tool: text('[data-tool="wall"]'),
        conn: text('#mapConnectivityBadge_1'),
        mapHeading: (document.querySelector('.map-grid-container') ? document.querySelector('.map-grid-container').closest('.card').querySelector('h3').innerText : ''),
        chips: Array.from(document.querySelectorAll('[data-entity-chip]')).map(c => c.innerText)
      };
    })()`);
    check(!CJK.test(english.save + english.export + english.playtest + english.undo + english.tool + english.conn), 'the author toolbar has no Chinese while the interface is English: ' + JSON.stringify([english.save, english.export, english.conn]));
    check(!/ui\.[a-z]+\.[a-z_]+|content\.skill\.|api\.[a-zA-Z]/.test(english.view), 'no raw i18n key leaked into the English screen');
    // An interpolated value that never arrived prints as "undefined" on screen, which is neither
    // Chinese nor an i18n key, so the two checks above cannot see it.
    check(!/undefined|NaN|\[object /i.test(english.view), 'the English screen prints no unresolved value');
    check(english.conn.replace(/[^\p{L}\p{N} ]/gu, '').trim().length > 6, 'the connectivity badge is a real sentence in English: ' + JSON.stringify(english.conn));
    const namedCh = english.chips.filter(label => CJK.test(label));
    check(namedCh.length === 0, 'entity names follow the English locale: ' + JSON.stringify(english.chips));
    const mapNames = await evaluate(`(async () => {
      const res = await (await fetch(${JSON.stringify('/api/content/drafts/' + draftId)})).json();
      const map = res.draft.maps[0];
      return { canonical: map.name || map.id, en: map.localized?.en?.name || map.name || map.id };
    })()`);
    // CSS uppercases headings, so compare case-insensitively: what matters is which language the
    // heading fell back to, not its letter case.
    const viewText = english.view.toLowerCase();
    check(viewText.includes(mapNames.en.toLowerCase()), 'the map heading uses the English map name: ' + JSON.stringify(mapNames) + ' heading=' + JSON.stringify(english.mapHeading));
    check(mapNames.en === mapNames.canonical || !viewText.includes(mapNames.canonical.toLowerCase()), 'the map heading does not fall back to the canonical Chinese name in English: ' + JSON.stringify(mapNames));
    await shot('author-en');

    await setLocale('zh-CN');
    await click('[data-tab="ch1"]');
    await wait("document.getElementById('mapGridContainer_1')", 'the map tab rendered in Chinese');
    const chinese = await evaluate(`(() => {
      const text = (id) => { const el = document.getElementById(id) || document.querySelector(id); return el ? el.innerText : ''; };
      return {
        save: text('#saveDraftBtn'), conn: text('#mapConnectivityBadge_1'), tool: text('[data-tool="wall"]'),
        chips: Array.from(document.querySelectorAll('[data-entity-chip]')).map(c => c.innerText),
        view: document.getElementById('view').innerText
      };
    })()`);
    check(CJK.test(chinese.save + chinese.conn + chinese.tool), 'the same controls are Chinese when the interface is Chinese: ' + JSON.stringify([chinese.save, chinese.conn]));
    check(!/ui\.[a-z]+\.[a-z_]+|content\.skill\.|api\.[a-zA-Z]/.test(chinese.view), 'no raw i18n key leaked into the Chinese screen');
    check(!/undefined|NaN|\[object /i.test(chinese.view), 'the Chinese screen prints no unresolved value');
    check(chinese.chips.some(label => CJK.test(label)), 'entity names follow the Chinese locale: ' + JSON.stringify(chinese.chips));
    await shot('author-zh');
    await setLocale('en');
  });

  await test('bilingual failure response and memory sync does not cross-delete (F1)', async () => {
    await setLocale('zh-CN');
    await go('#/author?draft=' + draftId);
    await wait("document.querySelector('[data-tab=\"ch1\"]')", 'editor ch1 tab available');
    await click('[data-tab="ch1"]');
    await wait("document.getElementById('mapGridContainer_1')", 'chapter 1 loaded');

    // Open choice mechanics details so inputs are visible in DOM
    await evaluate(`(() => {
      document.querySelectorAll('details').forEach(d => { d.open = true; });
    })()`);

    const choiceKey = await evaluate(`(() => {
      for (const el of document.querySelectorAll('[data-field="failure_response"][data-lang="zh-CN"]')) {
        const key = el.getAttribute('data-sync-choice');
        const sel = document.querySelector('[data-sync-choice="' + key + '"][data-field="effect_type"]');
        if (sel && sel.value === 'check') return key;
      }
      return '';
    })()`);
    check(choiceKey.length > 0, 'found check choice failure fields: ' + choiceKey);

    const selZhResp = `[data-sync-choice="${choiceKey}"][data-field="failure_response"][data-lang="zh-CN"]`;
    const selEnResp = `[data-sync-choice="${choiceKey}"][data-field="failure_response"][data-lang="en"]`;
    const selZhMem = `[data-sync-choice="${choiceKey}"][data-field="failure_memory"][data-lang="zh-CN"]`;
    const selEnMem = `[data-sync-choice="${choiceKey}"][data-field="failure_memory"][data-lang="en"]`;
    const selFailEnding = `[data-sync-choice="${choiceKey}"][data-field="failure_ending"]`;

    const [sceneId, choiceId] = choiceKey.split(':');
    const getChoice = res => (res.body.draft.maps[0].scenes.find(s => s.id === sceneId) || {}).choices?.find(c => c.id === choiceId);

    // 1. Single language entry: enter Chinese failure response & memory
    const zhText = '守卫冷笑着把你推搡回去 ' + Date.now();
    const zhMemText = '被渡口守卫粗暴拒绝 ' + Date.now();
    await typeInto(selZhResp, zhText);
    await typeInto(selZhMem, zhMemText);
    await typeInto(selEnResp, '');
    await typeInto(selEnMem, '');

    // Switch tab to manifest and switch back to ch1
    await click('[data-tab="manifest"]');
    await wait("document.getElementById('m_nameZh')", 'manifest tab opened');
    await click('[data-tab="ch1"]');
    await wait("document.getElementById('mapGridContainer_1')", 'back to ch1 tab');
    await evaluate(`(() => { document.querySelectorAll('details').forEach(d => { d.open = true; }); })()`);

    // Verify Chinese still present, English still empty
    check(await evaluate(`document.querySelector(${JSON.stringify(selZhResp)}).value`) === zhText, 'zh failure response kept after tab switch');
    check(await evaluate(`document.querySelector(${JSON.stringify(selZhMem)}).value`) === zhMemText, 'zh failure memory kept after tab switch');
    check(await evaluate(`document.querySelector(${JSON.stringify(selEnResp)}).value`) === '', 'en failure response remains empty');

    // Save and check API
    await click('#saveDraftBtn');
    await wait("!document.getElementById('saveDraftBtn').disabled", 'save finished after zh-only entry', 20000);
    let draftRes = await api('GET', '/api/content/drafts/' + draftId);
    let choiceObj = getChoice(draftRes);
    check(choiceObj && choiceObj.failure, 'failure block exists');
    check(choiceObj.failure.localized?.['zh-CN']?.response === zhText, 'failure zh-CN response persisted in draft');
    check(choiceObj.failure.response === zhText, 'canonical failure response falls back to zh-CN');
    check(!choiceObj.failure.localized?.en?.response, 'en localized response is not set');

    // 2. Both languages populated: add English
    const enText = 'The guard laughs coldly and shoves you back ' + Date.now();
    const enMemText = 'Roughly rejected by the ferry guard ' + Date.now();
    await typeInto(selEnResp, enText);
    await typeInto(selEnMem, enMemText);
    await click('#saveDraftBtn');
    await wait("!document.getElementById('saveDraftBtn').disabled", 'save finished after both populated', 20000);

    draftRes = await api('GET', '/api/content/drafts/' + draftId);
    choiceObj = getChoice(draftRes);
    check(choiceObj.failure.localized?.['zh-CN']?.response === zhText, 'both: zh-CN preserved');
    check(choiceObj.failure.localized?.en?.response === enText, 'both: en preserved');

    // 3. Clear English side only -> must NOT delete Chinese side!
    await typeInto(selEnResp, '');
    await typeInto(selEnMem, '');

    // Tab switch to raw and back
    await click('[data-tab="raw"]');
    await wait("document.getElementById('rawJsonText')", 'raw tab opened');
    await click('[data-tab="ch1"]');
    await wait("document.getElementById('mapGridContainer_1')", 'back to ch1 tab');
    await evaluate(`(() => { document.querySelectorAll('details').forEach(d => { d.open = true; }); })()`);

    // Verify on screen
    check(await evaluate(`document.querySelector(${JSON.stringify(selZhResp)}).value`) === zhText, 'clearing en did NOT clear zh failure response on screen');
    check(await evaluate(`document.querySelector(${JSON.stringify(selZhMem)}).value`) === zhMemText, 'clearing en did NOT clear zh failure memory on screen');
    check(await evaluate(`document.querySelector(${JSON.stringify(selEnResp)}).value`) === '', 'en failure response is empty on screen');

    // Save and check API
    await click('#saveDraftBtn');
    await wait("!document.getElementById('saveDraftBtn').disabled", 'save finished after clearing en', 20000);
    draftRes = await api('GET', '/api/content/drafts/' + draftId);
    choiceObj = getChoice(draftRes);
    check(choiceObj.failure.localized?.['zh-CN']?.response === zhText, 'api: zh-CN response survived clearing en');
    check(choiceObj.failure.response === zhText, 'api: canonical fallback to zh-CN survived clearing en');
    check(!choiceObj.failure.localized?.en?.response, 'api: en response is cleared');

    // 4. Reverse: populate English, clear Chinese
    await typeInto(selEnResp, enText);
    await typeInto(selEnMem, enMemText);
    await typeInto(selZhResp, '');
    await typeInto(selZhMem, '');

    await click('[data-tab="manifest"]');
    await wait("document.getElementById('m_nameZh')", 'manifest tab opened');
    await click('[data-tab="ch1"]');
    await wait("document.getElementById('mapGridContainer_1')", 'back to ch1 tab');
    await evaluate(`(() => { document.querySelectorAll('details').forEach(d => { d.open = true; }); })()`);

    check(await evaluate(`document.querySelector(${JSON.stringify(selEnResp)}).value`) === enText, 'clearing zh did NOT clear en failure response on screen');
    check(await evaluate(`document.querySelector(${JSON.stringify(selZhResp)}).value`) === '', 'zh failure response is empty on screen');

    await click('#saveDraftBtn');
    await wait("!document.getElementById('saveDraftBtn').disabled", 'save finished after clearing zh', 20000);
    draftRes = await api('GET', '/api/content/drafts/' + draftId);
    choiceObj = getChoice(draftRes);
    check(choiceObj.failure.localized?.en?.response === enText, 'api: en response survived clearing zh');
    check(choiceObj.failure.response === enText, 'api: canonical fallback to en survived clearing zh');
    check(!choiceObj.failure.localized?.['zh-CN']?.response, 'api: zh response is cleared');

    // 5. Ending and fact preservation when responses are cleared
    await typeInto(selFailEnding, 'guard_failure_ending');
    await typeInto(selEnResp, '');
    await typeInto(selEnMem, '');
    await click('#saveDraftBtn');
    await wait("!document.getElementById('saveDraftBtn').disabled", 'save finished with ending set', 20000);
    draftRes = await api('GET', '/api/content/drafts/' + draftId);
    choiceObj = getChoice(draftRes);
    check(choiceObj.failure && choiceObj.failure.ending === 'guard_failure_ending', 'failure block preserved because ending is set');
    check(choiceObj.failure.fact, 'failure fact preserved');

    // Clear ending as well -> responses and ending are empty; reactions and fact preserved
    await typeInto(selFailEnding, '');
    await click('#saveDraftBtn');
    await wait("!document.getElementById('saveDraftBtn').disabled", 'save finished after clearing ending', 20000);
    draftRes = await api('GET', '/api/content/drafts/' + draftId);
    choiceObj = getChoice(draftRes);
    check(!choiceObj.failure?.ending && !choiceObj.failure?.response && !choiceObj.failure?.memory && !choiceObj.failure?.localized, 'failure text and ending are cleared while reactions survive: ' + JSON.stringify(choiceObj.failure));
    check(choiceObj.failure?.reactions, 'failure reactions survive');
    check(choiceObj.failure?.fact, 'failure fact survives');
    await shot('bilingual-failure-sync');
  });

  await test('raw JSON typed edits save screen text and invalid JSON blocks leaving without text loss (F2)', async () => {
    await go('#/author?draft=' + draftId);
    await wait("document.querySelector('[data-tab=\"raw\"]')", 'raw tab available');
    await click('[data-tab="raw"]');
    await wait("document.getElementById('rawJsonText')", 'raw editor open');

    // 1. Direct typing in rawJsonText with valid JSON, saved via toolbar #saveDraftBtn without clicking #rawApplyBtn
    const validRaw = await evaluate(`(() => {
      const draft = JSON.parse(document.getElementById('rawJsonText').value);
      draft.pack.name = 'Direct Raw Toolbar Save ' + Date.now();
      draft.pack.author = 'RawAuthorToolbar';
      draft.customField = 'retained_unknown_field';
      const el = document.getElementById('rawJsonText');
      el.value = JSON.stringify(draft, null, 2);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      return { name: draft.pack.name, author: draft.pack.author, customField: draft.customField };
    })()`);

    check(await evaluate("!document.getElementById('dirtyBadge').hidden"), 'typing in raw marked draft dirty');
    await click('#saveDraftBtn');
    await wait("!document.getElementById('saveDraftBtn').disabled", 'toolbar save finished', 20000);

    let draftRes = await api('GET', '/api/content/drafts/' + draftId);
    check(draftRes.body.draft.pack.name === validRaw.name, 'toolbar save persisted directly typed raw JSON name: ' + draftRes.body.draft.pack.name);
    check(draftRes.body.draft.pack.author === validRaw.author, 'toolbar save persisted directly typed raw JSON author: ' + draftRes.body.draft.pack.author);
    check(draftRes.body.draft.customField === 'retained_unknown_field', 'unknown legal field retained: ' + draftRes.body.draft.customField);

    // 2. Direct typing in rawJsonText, saved via leave modal #draftLeaveSave without clicking #rawApplyBtn
    const leaveRaw = await evaluate(`(() => {
      const draft = JSON.parse(document.getElementById('rawJsonText').value);
      draft.pack.name = 'Direct Raw LeaveModal Save ' + Date.now();
      const el = document.getElementById('rawJsonText');
      el.value = JSON.stringify(draft, null, 2);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      return draft.pack.name;
    })()`);

    await click('#view a[href="#/author"]');
    await wait("document.getElementById('draftUnsavedModal')", 'leave modal opened');
    await click('#draftLeaveSave');
    await wait("!document.getElementById('draftUnsavedModal')", 'leave modal closed', 15000);
    await wait("location.hash === '#/author'", 'navigated to author list', 15000);

    draftRes = await api('GET', '/api/content/drafts/' + draftId);
    check(draftRes.body.draft.pack.name === leaveRaw, 'leave modal save persisted directly typed raw JSON name: ' + draftRes.body.draft.pack.name);

    // 3. Invalid raw JSON blocks tab switching and blocks save-and-leave, preserving raw input
    await go('#/author?draft=' + draftId);
    await wait("document.querySelector('[data-tab=\"raw\"]')", 'raw tab available');
    await click('[data-tab="raw"]');
    await wait("document.getElementById('rawJsonText')", 'raw editor open');

    const brokenText = '{\n  "corrupted": true,\n  "unclosed": [\n';
    await evaluate(`(() => {
      const el = document.getElementById('rawJsonText');
      el.value = ${JSON.stringify(brokenText)};
      el.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);

    // Try tab switch to manifest
    await click('[data-tab="manifest"]');
    await new Promise(r => setTimeout(r, 400));
    const activeTab = await evaluate("document.querySelector('[data-tab].primary')?.dataset.tab || ''");
    check(activeTab === 'raw', 'tab switch blocked on invalid raw JSON; stayed on raw tab: ' + activeTab);
    const toastMsg = await evaluate("document.getElementById('toast')?.textContent || ''");
    check(toastMsg.length > 0, 'toast explained the syntax error on blocked tab switch: ' + toastMsg);
    check(await evaluate("document.getElementById('rawJsonText').value") === brokenText, 'broken text in rawJsonText was NOT lost or wiped');

    // Try to leave via nav link -> modal appears
    await click('#view a[href="#/author"]');
    await wait("document.getElementById('draftUnsavedModal')", 'leave modal opened for broken raw');
    // Try to save and leave
    await click('#draftLeaveSave');
    await new Promise(r => setTimeout(r, 400));
    check(await evaluate("location.hash.includes('draft=" + draftId + "')"), 'save-and-leave blocked on broken raw JSON; did not navigate away');
    check(await evaluate("document.getElementById('rawJsonText')?.value") === brokenText, 'broken text in rawJsonText preserved after blocked save-and-leave');

    // Click stay
    if (await evaluate("!!document.getElementById('draftLeaveStay')")) {
      await click('#draftLeaveStay');
      await wait("!document.getElementById('draftUnsavedModal')", 'stay closed modal', 5000);
    }
    check(await evaluate("document.getElementById('rawJsonText')?.value") === brokenText, 'broken text preserved after stay');

    // Restore valid JSON and save
    await evaluate(`(() => {
      const draft = ${JSON.stringify(draftRes.body.draft)};
      const el = document.getElementById('rawJsonText');
      el.value = JSON.stringify(draft, null, 2);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
    await click('#saveDraftBtn');
    await wait("!document.getElementById('saveDraftBtn').disabled", 'saved clean draft', 20000);
    await shot('raw-json-typed-edits');
  });

  await test('route leave modal recovers original target hash instead of defaulting to #/author (F3)', async () => {
    await go('#/author?draft=' + draftId);
    await wait("document.getElementById('m_nameZh')", 'manifest editor open');

    // 1. Make dirty edit and navigate to #/ (home)
    await click('#m_nameZh');
    await typeInto('#m_nameZh', 'F3 Target Hash Test ' + Date.now());
    await wait("!document.getElementById('dirtyBadge').hidden", 'draft marked dirty');

    // Trigger navigation to #/
    await evaluate("location.hash = '#/'");
    await wait("document.getElementById('draftUnsavedModal')", 'leave modal opened for #/');

    // Click stay -> remains on editor
    await click('#draftLeaveStay');
    await wait("!document.getElementById('draftUnsavedModal')", 'stay closed modal');
    check(await evaluate("location.hash.includes('draft=" + draftId + "')"), 'stay preserved editor route: ' + await evaluate("location.hash"));

    // Navigate to #/ again and click discard -> goes to #/, NOT #/author!
    await evaluate("location.hash = '#/'");
    await wait("document.getElementById('draftUnsavedModal')", 'leave modal opened again for #/');
    await click('#draftLeaveDiscard');
    await wait("!document.getElementById('draftUnsavedModal')", 'discard closed modal');
    await wait("location.hash === '#/'", 'discard arrived at intended destination #/', 10000);
    check(await evaluate("location.hash") === '#/', 'destination was exactly #/, not #/author');

    // 2. Return to draft, make dirty edit, navigate to #/settings, save and leave -> goes to #/settings!
    await go('#/author?draft=' + draftId);
    await wait("document.getElementById('m_nameZh')", 'manifest editor reopened');
    const targetSaveName = 'Saved for Settings ' + Date.now();
    await click('#m_nameZh');
    await typeInto('#m_nameZh', targetSaveName);
    await wait("!document.getElementById('dirtyBadge').hidden", 'draft marked dirty again');

    await evaluate("location.hash = '#/settings'");
    await wait("document.getElementById('draftUnsavedModal')", 'leave modal opened for #/settings');
    await click('#draftLeaveSave');
    await wait("!document.getElementById('draftUnsavedModal')", 'save closed modal');
    await wait("location.hash === '#/settings'", 'save-and-leave arrived at intended destination #/settings', 15000);
    check(await evaluate("location.hash") === '#/settings', 'destination was exactly #/settings, not #/author');

    const checkSaved = await api('GET', '/api/content/drafts/' + draftId);
    check(checkSaved.body.draft.pack.name === targetSaveName, 'save-and-leave saved the edited name');

    // 3. Test browser back: navigate to draft editor, make dirty edit, history.back()
    await evaluate("location.hash = '#/author?draft=' + " + JSON.stringify(draftId));
    await wait("document.getElementById('m_nameZh')", 'manifest editor reopened after hash navigation');
    await click('#m_nameZh');
    await typeInto('#m_nameZh', 'Back Protection Edit ' + Date.now());
    await wait("!document.getElementById('dirtyBadge').hidden", 'draft marked dirty before back');

    await evaluate("history.back()");
    await wait("document.getElementById('draftUnsavedModal')", 'browser back triggered leave guard');
    await click('#draftLeaveStay');
    await wait("!document.getElementById('draftUnsavedModal')", 'stay closed modal after browser back');
    check(await evaluate("location.hash.includes('draft=')"), 'stay preserved editor route after browser back');

    // Clean up edit by saving
    await click('#saveDraftBtn');
    await wait("!document.getElementById('saveDraftBtn').disabled", 'clean save after back test', 20000);
    await shot('target-hash-recovered');
  });
} catch (error) {
  failed++;
  console.error('  FAIL: browser harness\n    ' + (error.stack || error.message));
} finally {
  try {
    for (const packId of cleanup.packs) await fetch(BASE + '/api/content/pack/' + packId, { method: 'DELETE' });
    for (const id of cleanup.drafts) await fetch(BASE + '/api/content/drafts/' + id, { method: 'DELETE' });
  } catch {}
  if (browser) await closeBrowser(browser, ws, send, profile);
  for (const item of pending.values()) clearTimeout(item.timer);
  console.log(`\nSummary: ${passed} passed, ${failed} failed assertions/steps.\n`);
  if (failed > 0) process.exitCode = 1;
}
