// tests/e2e/quick-start-cdp.test.mjs — T5 quick start & first-delve tutorial, headless CDP:
//   - home quick-start card: two server presets, selection, default name, custom name
//   - "创建并准备出发" lands on the SAME mainline prepare entrance (?node=crypt), Embark
//     button visible — the player still reviews and embarks themselves (no auto-start)
//   - first-delve coach appears once, advances on a real client move (WASD → server),
//     resumes at its step after a reload (no restart), and never returns after Skip
//   - the seven-step custom creator stays reachable from the quick-start card
// The delve for the tutorial leg is created over the API on purpose: the embark button can
// roll a road encounter (T7 territory) and this suite must not depend on its UI.
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { browserBinary, softwareWebGLFlags, requireWebGL, captureBrowserArtifacts } from './_browser-runtime.mjs';

const BASE_URL = process.env.BASE_URL || (process.env.PORT ? `http://localhost:${process.env.PORT}` : 'http://localhost:3000');
const CDP_PORT = 9227;

const findBrowserBinary = browserBinary;

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (!condition) {
    console.error(`  ❌ FAILED: ${message}`);
    failed++;
    throw new Error(message);
  }
  console.log(`  ✔ PASS: ${message}`);
  passed++;
}

async function apiReq(method, p, body) {
  const res = await fetch(`${BASE_URL}${p}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method} ${p} -> HTTP ${res.status}: ${JSON.stringify(data)}`);
  return data;
}

console.log('\n--- Running E2E Test: Quick Start & First-Delve Tutorial (T5) ---');

const browserBin = findBrowserBinary();

const PROFILE_MARKER = path.join(os.tmpdir(), 'ai-dnd-e2e-9227');
function killStaleBrowser() {
  try {
    if (process.platform === 'win32') {
      spawnSync('powershell', ['-NoProfile', '-Command',
        `Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*${PROFILE_MARKER}*${path.sep}' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`],
        { stdio: 'ignore' });
    }
  } catch {}
}
killStaleBrowser();

const browserProc = spawn(browserBin, [
  '--headless=new',
  `--remote-debugging-port=${CDP_PORT}`,
  `--user-data-dir=${PROFILE_MARKER}`,
  ...softwareWebGLFlags(),
  '--no-sandbox',
  '--disable-dev-shm-usage',
  '--no-first-run',
  '--no-default-browser-check',
  '--window-size=1280,800',
  `${BASE_URL}/#/`
]);

async function waitForCDP() {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json`);
      const tabs = await res.json();
      const tab = tabs.find(t => t.type === 'page' && t.url && t.url.includes(BASE_URL));
      if (tab && tab.webSocketDebuggerUrl) return tab;
    } catch {}
    await new Promise(r => setTimeout(r, 200));
  }
  killStaleBrowser();
  throw new Error('CDP target timed out after 60 attempts (CDP port 9227, profile ai-dnd-e2e-9227). ' +
      'Stale processes holding the profile were force-cleaned — re-run once; if it fails again, check Task Manager for orphaned browser processes.');
}

const pageTarget = await waitForCDP();
const ws = new WebSocket(pageTarget.webSocketDebuggerUrl);
await new Promise(r => { ws.onopen = r; });

let msgId = 1;
const pending = new Map();
ws.onmessage = (evt) => {
  const msg = JSON.parse(evt.data);
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.error) reject(msg.error);
    else resolve(msg.result);
  }
};

function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = msgId++;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
}

function cleanup() {
  try { ws.close(); } catch {}
  if (process.platform === 'win32') {
    const marker = PROFILE_MARKER;
    try {
      spawnSync('powershell', ['-NoProfile', '-Command',
        `Get-CimInstance Win32_Process -Filter "Name='msedge.exe'" | Where-Object { $_.CommandLine -like '*${marker}*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`],
        { stdio: 'ignore' });
    } catch {}
  }
  try { browserProc.kill('SIGKILL'); } catch {}
}

let createdCharId = null;
let delveId = null;

try {
  await send('Page.enable');
  await send('Runtime.enable');
  await requireWebGL(send);

  async function waitFor(expr, label, timeoutMs = 15000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const r = await send('Runtime.evaluate', { expression: `!!(${expr})`, returnByValue: true }).catch(() => null);
      if (r && r.result && r.result.value === true) return true;
      await new Promise(x => setTimeout(x, 300));
    }
    console.log(`  (timed out after ${timeoutMs}ms waiting for ${label})`);
    return false;
  }

  async function evalValue(expression, { awaitPromise = false } = {}) {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise });
    return r && r.result ? r.result.value : undefined;
  }

  // Reset tutorial state in case the profile directory is reused across test runs
  await send('Runtime.evaluate', { expression: `localStorage.removeItem('aiDnd.tutorial.v1')` });

  // ---- A. home quick-start card ----
  assert(await waitFor(`document.getElementById('quickStartCard')`, 'the home quick-start card'), 'home renders the quick-start card');
  const tiles = await evalValue(`document.querySelectorAll('#quickStartCard .preset-tile').length`);
  assert(tiles === 2, `two preset tiles rendered from server rules, got ${tiles}`);
  const firstSelected = await evalValue(`document.querySelector('#quickStartCard .preset-tile').classList.contains('selected')`);
  assert(firstSelected === true, 'first preset preselected');
  const presetIds = await evalValue(`[...document.querySelectorAll('#quickStartCard .preset-tile')].map(t => t.dataset.preset).join(',')`);
  assert(presetIds === 'guardian,arcane', `server preset ids present (melee + caster), got ${presetIds}`);
  const prefilled = await evalValue(`document.getElementById('quickName').value`);
  assert(!!prefilled && prefilled.length > 0, 'name input pre-filled with the preset default name');
  const creatorLink = await evalValue(`!!document.querySelector('#quickStartCard a[href="#/create"]')`);
  assert(creatorLink === true, 'seven-step custom creator still linked from the quick-start card');

  // ---- B. switch preset, name the hero, create & land on the prepare entrance ----
  await send('Runtime.evaluate', { expression: `document.querySelector('#quickStartCard .preset-tile[data-preset="arcane"]').click()` });
  const arcaneSelected = await evalValue(`document.querySelector('#quickStartCard .preset-tile[data-preset="arcane"]').classList.contains('selected')`);
  assert(arcaneSelected === true, 'clicking the caster tile selects it');
  const nameSwapped = await evalValue(`document.getElementById('quickName').value`);
  assert(nameSwapped === '艾拉·星语', `name follows the preset default, got ${nameSwapped}`);
  await send('Runtime.evaluate', { expression: `(() => { const i = document.getElementById('quickName'); i.value = '星尘试玩'; i.dispatchEvent(new Event('input', { bubbles: true })); })()` });
  await send('Runtime.evaluate', { expression: `document.getElementById('quickStartBtn').click()` });
  assert(await waitFor(`location.hash.startsWith('#/overworld?char=') && location.hash.includes('node=crypt')`, 'the prepare-entrance navigation'), 'creation navigates to the mainline prepare entrance (?node=crypt)');
  const hash = await evalValue(`location.hash`);
  createdCharId = (hash.match(/char=([^&]+)/) || [])[1];
  assert(!!createdCharId, 'created character id present in the route');
  assert(await waitFor(`document.getElementById('embarkBtn')`, 'the embark button'), 'prepare page shows the Embark button (no auto-embark)');
  const heroNamed = await evalValue(`document.body.textContent.includes('星尘试玩')`);
  assert(heroNamed === true, 'prepare page shows the named hero');

  // ---- C. delve for the tutorial leg (API on purpose: road-encounter is T7 territory) ----
  const delve = await apiReq('POST', '/api/game/start', { characterId: createdCharId, bringAlly: false, difficulty: 'easy', mapId: 'crypt' });
  delveId = delve.state.id;
  await send('Runtime.evaluate', { expression: `localStorage.removeItem('aiDnd.tutorial.v1'); location.hash = '#/play/${delveId}'` });
  assert(await waitFor(`document.getElementById('minimapContainer')`, 'the play view'), 'delve view mounts');

  // ---- D. first-delve coach: appears at step 1, advances on a real move ----
  assert(await waitFor(`document.querySelector('.delve-tutorial-card') && !document.querySelector('.delve-tutorial-card').hidden`, 'the tutorial card'), 'first-delve tutorial card appears');
  const step1 = await evalValue(`document.querySelector('.delve-tutorial-card .tutorial-text').textContent`);
  assert(step1.includes('移动'), `tutorial starts at the move step, got: ${step1}`);
  const dots = await evalValue(`document.querySelectorAll('.delve-tutorial-card .tutorial-dot').length`);
  assert(dots === 4, `four step dots, got ${dots}`);

  console.log('  Driving a real WASD move (busy guard may swallow taps — retrying)...');
  const moved = await evalValue(`(async () => {
    const tap = (key) => document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
    const card = () => document.querySelector('.delve-tutorial-card .tutorial-text');
    for (let i = 0; i < 24; i++) {
      for (const k of ['w', 'a', 's', 'd']) tap(k);
      await new Promise(r => setTimeout(r, 450));
      if (card() && card().textContent.includes('互动')) return true;
    }
    return false;
  })()`, { awaitPromise: true });
  assert(moved === true, 'tutorial advances to the interact step after a real client move (server-observed)');

  // ---- E. one-time behavior: resume at the current step, then skip forever ----
  await send('Page.reload', {});
  assert(await waitFor(`document.getElementById('minimapContainer')`, 'the play view to remount'), 'play view remounts after reload');
  assert(await waitFor(`document.querySelector('.delve-tutorial-card') && !document.querySelector('.delve-tutorial-card').hidden`, 'the tutorial card to reappear'), 'tutorial card reappears after reload');
  const stepAfterReload = await evalValue(`document.querySelector('.delve-tutorial-card .tutorial-text').textContent`);
  assert(stepAfterReload.includes('互动'), `tutorial resumes at the interact step (no restart), got: ${stepAfterReload}`);

  await send('Runtime.evaluate', { expression: `document.getElementById('tutorialSkipBtn').click()` });
  const cardGone = await evalValue(`!document.querySelector('.delve-tutorial-card')`);
  assert(cardGone === true, 'skip removes the card immediately');
  const flag = await evalValue(`JSON.parse(localStorage.getItem('aiDnd.tutorial.v1')).status`);
  assert(flag === 'skipped', `skip is persisted (${flag})`);

  await send('Page.reload', {});
  assert(await waitFor(`document.getElementById('minimapContainer')`, 'the play view to remount again'), 'play view remounts after the second reload');
  await new Promise(r => setTimeout(r, 1200));
  const cardAfterSkip = await evalValue(`!!document.querySelector('.delve-tutorial-card')`);
  assert(cardAfterSkip === false, 'no tutorial card on the next visit after skip (never nags again)');

  console.log(`\n  T5 quick-start e2e: ${passed} passed, ${failed} failed`);
} catch (err) {
  await captureBrowserArtifacts('quick-start-cdp.test.mjs', [CDP_PORT]);
  console.error('  ❌ E2E ERROR:', err.message);
  failed++;
} finally {
  try {
    await send('Runtime.evaluate', { expression: `localStorage.removeItem('aiDnd.tutorial.v1')` });
  } catch {}
  try {
    if (delveId) await apiReq('DELETE', `/api/game/${delveId}`);
    if (createdCharId) await apiReq('DELETE', `/api/characters/${createdCharId}`);
  } catch {}
  cleanup();
}

if (failed > 0) process.exit(1);
process.exit(0);
