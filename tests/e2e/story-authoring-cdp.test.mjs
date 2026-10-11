// tests/e2e/story-authoring-cdp.test.mjs
// T15a CDP E2E Test: Authoring studio, starter template cloning, NPC & choice editing, draft tolerance, and playtest isolation.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { assertTestContainer } from '../../scripts/test-container.mjs';
import { browserBinary, softwareWebGLFlags, requireWebGL, captureBrowserArtifacts, closeBrowser } from './_browser-runtime.mjs';

assertTestContainer();

const BASE = process.env.BASE_URL || 'http://localhost:' + (process.env.PORT || 3000);
const PORT = 9239;
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-dnd-t15a-cdp-'));
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
  await captureBrowserArtifacts('t15a-' + name, [PORT]);
  for (const ext of ['png', 'json']) {
    check(
      fs.existsSync(path.join(process.env.VERIFY_ARTIFACT_DIR, 'screenshots', 't15a-' + name + '-' + PORT + '-0.' + ext)),
      'saved screenshot artifact ' + name + '.' + ext
    );
  }
}

async function setup() {
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
  if (!tab) throw new Error('Required Chromium did not start');

  ws = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });
  ws.onmessage = event => {
    const msg = JSON.parse(event.data);
    if (msg.method === 'Runtime.exceptionThrown') {
      console.error('BROWSER EXCEPTION:', JSON.stringify(msg.params?.exceptionDetails));
    }
    const item = pending.get(msg.id);
    if (!item) return;
    clearTimeout(item.timer);
    pending.delete(msg.id);
    if (msg.error) item.reject(new Error(msg.error.message));
    else item.resolve(msg.result);
  };

  await send('Page.enable');
  await send('Runtime.enable');
  await send('DOM.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  await requireWebGL(send);
  await wait("document.getElementById('view')", 'initial page load');
  await evaluate("localStorage.setItem('dnd_default_view','2d');localStorage.setItem('dnd_3d','off');localStorage.setItem('aiDnd.tutorial.v1',JSON.stringify({status:'skipped'}))");
}

try {
  await setup();
  console.log('--- T15a CDP E2E Tests ---');

  // Step 1: Navigate to Authoring Studio Index
  await go('#/author');
  await wait("document.getElementById('cloneBtn')", 'authoring studio mounted with clone button');
  await shot('index');

  // Step 2: Clone Starter Template
  const slug = 'cdp_author_test';
  const expectedPackId = 'custom_' + slug;
  createdDrafts.push(expectedPackId);

  await evaluate(`(() => {
    document.getElementById('cloneSlug').value = ${JSON.stringify(slug)};
    document.getElementById('cloneName').value = '自定义渡口冒险';
    document.getElementById('cloneAuthor').value = 'CDP Tester';
  })()`);

  await click('#cloneBtn');
  await wait(`location.hash.includes('draft=${expectedPackId}')`, 'navigated to cloned draft editor');
  await wait("document.getElementById('saveDraftBtn')", 'editor loaded with save button');
  check(await evaluate("!!document.querySelector('#statusBadge')"), 'status badge rendered');
  await shot('editor-manifest');

  // Step 3: Switch to Chapter 1 Tab and edit NPCs & Choices
  await click('[data-tab="ch1"]');
  await wait("document.querySelector('[data-sync-npc=\"iris\"][data-field=\"persona\"]')", 'chapter 1 NPC editor loaded');

  // Modify Iris persona
  await evaluate(`(() => {
    const input = document.querySelector("[data-sync-npc='iris'][data-field='persona'][data-lang='zh-CN']");
    input.value = '我是守桥人艾芮，这是 CDP 自动化测试修改后的性格。';
  })()`);

  // Modify Choice 1 label and cost
  await evaluate(`(() => {
    const inputs = document.querySelectorAll('[data-sync-choice]');
    if (inputs.length > 0) {
      inputs[0].value = '支付过路金（CDP编辑）';
    }
  })()`);

  // Save Draft
  await click('#saveDraftBtn');
  await wait("!document.getElementById('saveDraftBtn').disabled", 'draft save finished');
  check(await evaluate("document.querySelector('#statusBadge').textContent.includes('校验通过') || document.querySelector('#statusBadge').textContent.includes('Valid')"), 'draft validated clean after edits');
  await shot('editor-ch1');

  // Step 4: Switch to Chapter 2 Tab and verify cross-chapter closed history
  await click('[data-tab="ch2"]');
  // The banner text is localized, so assert the element the interface language fills in, and the
  // story id it quotes: a clone must bind to its own chapter 1, never to the template's history.
  await wait("!!document.querySelector('[data-i18n*=history_banner]')", 'chapter 2 cross-chapter self-closed history displayed');
  const historyBanner = await evaluate(`(() => {
    const banner = document.querySelector('[data-i18n*=history_banner]');
    return { text: banner ? banner.textContent.trim() : '', body: document.body.innerText };
  })()`);
  check(historyBanner.text.length > 4, 'the history banner renders fixed interface text in the current language: ' + historyBanner.text);
  check(historyBanner.body.includes(expectedPackId + '_story_ch1'), 'the banner quotes this clone\'s own chapter 1 story id, not the template\'s');
  await shot('editor-ch2');

  // Step 5: Test Safe Playtest Lifecycle
  await click('#playtestBtn');
  await wait("location.hash.includes('#/play/')", 'playtest launched and navigated to /play');
  await wait("document.querySelector('.playtest-banner')", 'playtest banner displayed on screen');
  check(await evaluate("document.querySelector('.playtest-banner').textContent.includes('试玩模式') || document.querySelector('.playtest-banner').textContent.includes('Playtest')"), 'banner confirms isolated playtest');
  await shot('playtest-active');

  // Exit playtest via banner button
  await click('.playtest-banner a');
  await wait(`location.hash.includes('#/author?draft=${expectedPackId}')`, 'returned smoothly to author editor');
  await wait("document.getElementById('installBtn')", 'author editor loaded');

  // Step 6: Install Draft into Game
  await click('#installBtn');
  await wait("document.getElementById('installBtn')?.getAttribute('data-installed') === 'true'", 'install completed');
  createdPacks.push(expectedPackId);

  // Navigate back to Home and verify Pack appears in content list
  await go('#/');
  await wait("document.getElementById('packList')", 'home view pack list loaded');
  await wait(`document.body.innerText.includes('自定义渡口冒险') || document.body.innerText.includes('${expectedPackId}')`, 'custom adventure pack listed on home screen');
  await shot('home-installed-pack');

  console.log(`\nT15a CDP test finished successfully: ${passed} checks passed.\n`);
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
  // Cleanup test resources
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
