// tests/e2e/map-authoring-cdp.test.mjs
// T15b CDP E2E Test: Grid Map Editor (25x15), Wall/Floor/Door/Entity tools, Undo/Redo, Connectivity check, and Custom Map Playtest.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { assertTestContainer } from '../../scripts/test-container.mjs';
import { browserBinary, softwareWebGLFlags, requireWebGL, captureBrowserArtifacts, closeBrowser } from './_browser-runtime.mjs';

assertTestContainer();

const BASE = process.env.BASE_URL || 'http://localhost:' + (process.env.PORT || 3000);
const PORT = 9246;
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-dnd-t15b-cdp-'));
const pending = new Map();
const createdPacks = [];
const createdDrafts = [];

let ws, browser, sequence = 0, passed = 0;

function check(value, message) {
  if (!value) throw new Error(message);
  passed++;
  console.log('  PASS: ' + message);
}

function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error('CDP timeout: ' + method));
    }, 25000);
    pending.set(id, { resolve, reject, timer });
    ws.send(JSON.stringify({ id, method, params }));
  });
}

async function evaluate(expression) {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails));
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

async function pointer(point) {
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 });
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
    return el.contains(hit) ? { point } : { error: 'occluded', hit: hit?.outerHTML.slice(0, 200), point };
  })()`);
  check(!r.error && !!r.point, 'actual pointer click ' + selector + ' ' + (r.error ? JSON.stringify(r) : ''));
  await pointer(r.point);
}

async function shot(name) {
  await captureBrowserArtifacts('t15b-' + name, [PORT]);
  for (const ext of ['png', 'json']) {
    check(
      fs.existsSync(path.join(process.env.VERIFY_ARTIFACT_DIR, 'screenshots', 't15b-' + name + '-' + PORT + '-0.' + ext)),
      'saved screenshot artifact ' + name + '.' + ext
    );
  }
}

console.log('\n--- T15b CDP E2E Tests ---');

try {
  const binary = browserBinary();
  const args = [
    '--headless=new',
    ...softwareWebGLFlags(),
    '--no-sandbox',
    '--disable-dev-shm-usage',
    '--no-first-run',
    '--no-default-browser-check',
    '--remote-debugging-port=' + PORT,
    '--user-data-dir=' + profile,
    '--window-size=1280,800',
    BASE + '/#/'
  ];
  browser = spawn(binary, args, { detached: true, stdio: 'ignore' });
  let tab;
  for (let n = 0; n < 70 && !tab; n++) {
    tab = (await fetch('http://127.0.0.1:' + PORT + '/json').then(r => r.json()).catch(() => [])).find(t => t.type === 'page');
    if (!tab) await new Promise(r => setTimeout(r, 150));
  }
  if (!tab) throw new Error('Required Chromium did not start on port ' + PORT);

  ws = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });

  ws.onmessage = event => {
    const message = JSON.parse(event.data);
    if (!message.id) return;
    const item = pending.get(message.id);
    if (!item) return;
    pending.delete(message.id);
    clearTimeout(item.timer);
    if (message.error) item.reject(new Error(message.error.message));
    else item.resolve(message.result);
  };

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Page.navigate', { url: BASE + '/#' });
  await wait("document.getElementById('view')", 'app root ready');

  // Enforce 2D view and skip tutorial
  await evaluate(`(() => {
    localStorage.setItem('dnd_default_view', '2d');
    localStorage.setItem('dnd_3d', 'off');
    localStorage.setItem('aiDnd.tutorial.v1', JSON.stringify({ state: 'skipped', done: [] }));
  })()`);

  await requireWebGL(send);

  // Step 1: Open Author Studio
  await go('#/author');
  await wait("document.getElementById('cloneBtn')", 'author drafts index view loaded');

  // Step 2: Clone Starter Template
  const slug = 'cdp_map_author_test';
  const expectedPackId = 'custom_' + slug;
  createdDrafts.push(expectedPackId);

  await evaluate(`(() => {
    document.getElementById('cloneSlug').value = ${JSON.stringify(slug)};
    document.getElementById('cloneName').value = '定制地图冒险';
    document.getElementById('cloneAuthor').value = '测试制图师';
  })()`);

  await click('#cloneBtn');
  await wait(`location.hash.includes('#/author?draft=${expectedPackId}')`, 'navigated to cloned draft editor');
  await wait("document.querySelector('#statusBadge')", 'editor header rendered');

  // Step 3: Switch to Chapter 1 Tab to view Grid Map Editor
  await click('[data-tab="ch1"]');
  await wait("document.getElementById('mapGridContainer_1')", 'chapter 1 grid map container rendered');
  const cellCount = await evaluate("document.querySelectorAll('#mapGridContainer_1 .map-grid-cell').length");
  check(cellCount === 375, 'grid editor contains exactly 375 cells (25 x 15 matrix)');
  await shot('editor-grid');

  // Step 4: Test Wall Tool Protection on Campfire
  await click('[data-tool="wall"][data-chapter="1"]');
  // Attempt to click campfire at (1, 7)
  await click('#mapGridContainer_1 [data-x="1"][data-y="7"]');
  const campfireTileText = await evaluate("document.querySelector('#mapGridContainer_1 [data-x=\"1\"][data-y=\"7\"]').textContent");
  check(campfireTileText.includes('🔥'), 'campfire tile protected against wall overwriting');

  // Step 5: Test Floor Tool to create a shortcut
  await click('[data-tool="floor"][data-chapter="1"]');
  // Click on wall at (8, 6)
  await click('#mapGridContainer_1 [data-x="8"][data-y="6"]');
  const floorTileText = await evaluate("document.querySelector('#mapGridContainer_1 [data-x=\"8\"][data-y=\"6\"]').textContent");
  check(floorTileText.includes('·'), 'wall cell converted to floor shortcut');

  // Step 6: Test Move Entity Tool
  await click('[data-tool="select"][data-chapter="1"]');
  // Click Iris entity chip to select
  await click('[data-entity-chip="iris"][data-chapter="1"]');
  // Click target floor cell at (5, 5)
  await click('#mapGridContainer_1 [data-x="5"][data-y="5"]');
  const movedEntityCell = await evaluate("document.querySelector('#mapGridContainer_1 [data-x=\"5\"][data-y=\"5\"]').textContent");
  check(movedEntityCell.includes('🧭') || movedEntityCell.includes('👤'), 'iris entity moved to target floor cell (5, 5)');
  await shot('grid-edited');

  // Step 7: Test Undo and Redo
  await click('[data-map-action="undo"][data-chapter="1"]');
  const undoCell = await evaluate("document.querySelector('#mapGridContainer_1 [data-x=\"5\"][data-y=\"5\"]').textContent");
  check(!undoCell.includes('🧭') && !undoCell.includes('👤'), 'undo restores target cell');

  await click('[data-map-action="redo"][data-chapter="1"]');
  const redoCell = await evaluate("document.querySelector('#mapGridContainer_1 [data-x=\"5\"][data-y=\"5\"]').textContent");
  check(redoCell.includes('🧭') || redoCell.includes('👤'), 'redo re-applies entity movement to (5, 5)');

  // Step 8: Save Draft with modified map
  await click('#saveDraftBtn');
  await wait("document.querySelector('#statusBadge').textContent.includes('校验通过') || document.querySelector('#statusBadge').textContent.includes('Valid')", 'draft with modified map validates clean');

  // Step 9: Launch Playtest from Map Editor
  await click('[data-map-action="playtest"][data-chapter="1"]');
  await wait("location.hash.includes('#/play/')", 'playtest launched and navigated to /play');
  await wait("document.querySelector('.playtest-banner')", 'playtest banner displayed');
  check(await evaluate("document.querySelector('.playtest-banner').textContent.includes('试玩模式') || document.querySelector('.playtest-banner').textContent.includes('Playtest')"), 'banner confirms isolated playtest');
  await shot('playtest-custom-map');

  // Step 10: Smooth Return to Author Editor
  await click('.playtest-banner a');
  await wait(`location.hash.includes('#/author?draft=${expectedPackId}')`, 'returned smoothly to author editor');
  await wait("document.getElementById('saveDraftBtn')", 'author editor reloaded');

  console.log(`\nT15b CDP test finished successfully: ${passed} checks passed.\n`);
} catch (err) {
  const pageState = await evaluate(`({
    hash: location.hash,
    view: document.getElementById('view')?.innerHTML?.slice(0, 500),
    banner: !!document.querySelector('.playtest-banner'),
    error: document.querySelector('[data-route-error]')?.textContent
  })`).catch(() => ({}));
  console.error('CDP test failure:', err, 'PAGE STATE:', pageState);
  process.exitCode = 1;
} finally {
  try {
    for (const draftId of createdDrafts) {
      await fetch(BASE + `/api/content/drafts/${draftId}`, { method: 'DELETE' });
    }
    for (const packId of createdPacks) {
      await fetch(BASE + `/api/content/pack/${packId}`, { method: 'DELETE' });
    }
  } catch {}
  await closeBrowser(browser, ws, send, profile);
}
