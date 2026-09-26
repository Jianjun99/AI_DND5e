// tests/e2e/responsive-cdp.test.mjs — Device adaptation gate.
// Renders every view at phone (390x844) and tablet (820x1180) viewports and asserts there is
// no horizontal overflow anywhere, plus that the map, the action buttons and the backpack stay
// reachable on a phone.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

const BASE_URL = process.env.BASE_URL || (process.env.PORT ? `http://localhost:${process.env.PORT}` : 'http://localhost:3000');
const CDP_PORT = 9226;

const BROWSER_PATHS = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium'
];

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

async function apiReq(method, url, body) {
  const res = await fetch(`${BASE_URL}${url}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method} ${url} -> HTTP ${res.status}: ${JSON.stringify(data)}`);
  return data;
}

const DEVICES = [
  { name: 'phone', width: 390, height: 844, mobile: true },
  { name: 'tablet', width: 820, height: 1180, mobile: true }
];

console.log('\n--- Running E2E Test: Device Adaptation (phone & tablet) ---');

const browserBin = BROWSER_PATHS.find(p => fs.existsSync(p));
if (!browserBin) {
  console.log('⚠️ No Edge or Chrome binary found; skipping the responsive E2E test.');
  process.exit(0);
}

const char = await apiReq('POST', '/api/characters', {
  name: 'Responsive Hero', species: 'human', className: 'fighter', background: 'soldier',
  baseScores: { str: 16, dex: 14, con: 14, int: 10, wis: 12, cha: 8 }
});
const hero = char.character || char;
const delve = await apiReq('POST', '/api/game/start', { characterId: hero.id, bringAlly: false });
const delveId = delve.state.id;

const browserProc = spawn(browserBin, [
  '--headless=new',
  `--remote-debugging-port=${CDP_PORT}`,
  `--user-data-dir=${path.join(os.tmpdir(), 'ai-dnd-e2e-9226')}`,
  '--disable-gpu',
  '--no-sandbox',
  '--disable-dev-shm-usage',
  '--no-first-run',
  '--no-default-browser-check',
  `${BASE_URL}/#/`
], { stdio: 'ignore' });

function cleanup() {
  try { ws && ws.close(); } catch {}
  if (process.platform === 'win32') {
    const marker = path.join(os.tmpdir(), 'ai-dnd-e2e-9226');
    try {
      spawnSync('powershell', ['-NoProfile', '-Command',
        `Get-CimInstance Win32_Process -Filter "Name='msedge.exe'" | Where-Object { $_.CommandLine -like '*${marker}*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`],
        { stdio: 'ignore' });
    } catch {}
  }
  try { browserProc.kill(); } catch {}
}

let ws = null;
const wait = (ms) => new Promise(r => setTimeout(r, ms));

try {
  let wsUrl = null;
  for (let i = 0; i < 60 && !wsUrl; i++) {
    try {
      const tabs = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json`)).json();
      const page = tabs.find(t => t.type === 'page' && t.url.startsWith('http'));
      if (page) wsUrl = page.webSocketDebuggerUrl;
    } catch {}
    if (!wsUrl) await wait(300);
  }
  if (!wsUrl) throw new Error('CDP target timed out');

  ws = new WebSocket(wsUrl);
  let msgId = 1;
  const pending = new Map();
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = msgId++;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.id && pending.has(d.id)) {
      const p = pending.get(d.id);
      pending.delete(d.id);
      if (d.error) p.reject(d.error); else p.resolve(d.result);
    }
  };
  await new Promise(r => ws.onopen = r);
  await send('Runtime.enable');
  await send('Page.enable');

  // poll instead of sleeping: a cold browser renders the overworld noticeably later than a warm one
  const waitForExpr = async (expr, label, timeoutMs = 15000) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const ok = await send('Runtime.evaluate', { expression: `!!(${expr})`, returnByValue: true })
        .then(r => r.result.value).catch(() => false);
      if (ok) return true;
      await wait(300);
    }
    console.log(`  (timed out waiting for ${label})`);
    return false;
  };

  for (const device of DEVICES) {
    await send('Emulation.setDeviceMetricsOverride', {
      width: device.width, height: device.height,
      deviceScaleFactor: 1, mobile: device.mobile
    });

    // --- every top-level view must fit the viewport width ---
    const views = [
      { hash: '#/', label: 'home' },
      { hash: '#/create', label: 'character creator' },
      { hash: `#/character/${hero.id}`, label: 'character sheet' },
      { hash: `#/overworld?char=${hero.id}`, label: 'overworld' },
      { hash: `#/play/${delveId}`, label: 'delve' },
      { hash: `#/campaign/${hero.id}`, label: 'campaign' }
    ];

    for (const v of views) {
      await send('Runtime.evaluate', { expression: `location.hash = '${v.hash}'; 1` });
      await wait(2600);
      const metrics = await send('Runtime.evaluate', {
        expression: `(() => {
          const de = document.documentElement;
          const body = document.body;
          const overflowing = Array.from(document.querySelectorAll('body *'))
            .filter(el => {
              const r = el.getBoundingClientRect();
              return r.width > 0 && r.right > window.innerWidth + 2;
            })
            .slice(0, 3)
            .map(el => (el.tagName + '.' + (el.className || '')).slice(0, 48));
          return {
            scrollWidth: de.scrollWidth,
            clientWidth: de.clientWidth,
            innerWidth: window.innerWidth,
            bodyScroll: body ? body.scrollWidth : 0,
            overflowing
          };
        })()`,
        returnByValue: true
      }).then(r => r.result.value);

      const overflow = Math.max(metrics.scrollWidth, metrics.innerWidth) - device.width;
      assert(overflow <= 1,
        `${device.name}: ${v.label} fits ${device.width}px (scrollWidth ${metrics.scrollWidth}, layout viewport ${metrics.innerWidth}${metrics.overflowing.length ? ' — widest: ' + metrics.overflowing.join(', ') : ''})`);
    }

    // --- on a phone the delve must still be playable ---
    if (device.name === 'phone') {
      await send('Runtime.evaluate', { expression: `location.hash = '#/play/${delveId}'; 1` });
      await wait(3000);

      const playable = await send('Runtime.evaluate', {
        expression: `(() => {
          const map = document.getElementById('map3d');
          const mapRect = map ? map.getBoundingClientRect() : null;
          const actions = Array.from(document.querySelectorAll('[data-act]'));
          const visibleActions = actions.filter(b => {
            const r = b.getBoundingClientRect();
            return r.width > 0 && r.height > 0;
          });
          const minimap = document.querySelector('.minimap-container');
          const mmRect = minimap ? minimap.getBoundingClientRect() : null;
          return {
            mapHeight: mapRect ? Math.round(mapRect.height) : 0,
            mapWidth: mapRect ? Math.round(mapRect.width) : 0,
            actions: visibleActions.length,
            tapTargets: visibleActions.filter(b => b.getBoundingClientRect().height >= 32).length,
            minimapShare: mmRect ? +(mmRect.width / window.innerWidth).toFixed(2) : 1
          };
        })()`,
        returnByValue: true
      }).then(r => r.result.value);

      assert(playable.mapHeight >= 200 && playable.mapHeight <= 480,
        `Phone: the 3D board shrank for the screen (${playable.mapWidth}x${playable.mapHeight}, desktop is 560)`);
      assert(playable.minimapShare <= 0.45,
        `Phone: the minimap no longer covers the board (${Math.round(playable.minimapShare * 100)}% of the width)`);
      assert(playable.actions >= 4, `Phone: the action buttons are present (${playable.actions})`);
      assert(playable.tapTargets >= 4, `Phone: action buttons are tall enough to tap (${playable.tapTargets})`);

      // the backpack modal must open and fit
      await send('Runtime.evaluate', { expression: `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'b', bubbles: true })); 1` });
      await wait(1200);
      const modal = await send('Runtime.evaluate', {
        expression: `(() => {
          const m = document.getElementById('delveInventoryModal');
          if (!m) return { open: false };
          const r = m.firstElementChild.getBoundingClientRect();
          return { open: true, width: Math.round(r.width), left: Math.round(r.left), fits: r.left >= -1 && r.right <= window.innerWidth + 1 };
        })()`,
        returnByValue: true
      }).then(r => r.result.value);
      assert(modal.open && modal.fits, `Phone: the backpack opens inside the viewport (${modal.width}px wide, left ${modal.left})`);
      await send('Runtime.evaluate', { expression: `document.querySelectorAll('.modal-back').forEach(m => m.remove()); 1` });

      // and the touch gestures exist: two-finger pan on the 3D board
      const touchReady = await send('Runtime.evaluate', {
        expression: `(() => {
          const c = document.querySelector('#map3d canvas');
          if (!c) return { canvas: false };
          return { canvas: true, touchAction: getComputedStyle(c).touchAction };
        })()`,
        returnByValue: true
      }).then(r => r.result.value);
      assert(touchReady.canvas && touchReady.touchAction === 'none',
        `Phone: the board claims its own gestures (touch-action: ${touchReady.touchAction})`);
    }
  }

  // --- the new town/forge UI exists (a smoke check on the released build) ---
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Runtime.evaluate', { expression: `location.hash = '#/overworld?char=${hero.id}'; 1` });
  await waitForExpr("document.querySelector('.campaign-banner')", 'the campaign banner');
  // the region map is the default tab, and that is where the campaign banner lives
  const banner = await send('Runtime.evaluate', {
    expression: `(() => ({
      banner: !!document.querySelector('.campaign-banner'),
      text: (document.querySelector('.campaign-banner') || {}).innerText || '',
      ring: !!document.querySelector('.campaign-ring')
    }))()`,
    returnByValue: true
  }).then(r => r.result.value);
  assert(banner.banner && /主线/.test(banner.text), 'The main story banner is on the region map');
  assert(banner.ring, 'The next story step is marked on the map');

  const town = await send('Runtime.evaluate', {
    expression: `(() => {
      const t = document.getElementById('tabCityBtn');
      if (t) t.click();
      return !!t;
    })()`,
    returnByValue: true
  });
  await waitForExpr("document.getElementById('armoryForgeTabBtn') || document.querySelector('[data-district=\"armory\"]')", 'the town districts');
  const forgeTab = await send('Runtime.evaluate', {
    expression: `(() => {
      const pills = Array.from(document.querySelectorAll('[data-district]'));
      const armory = pills.find(p => p.getAttribute('data-district') === 'armory');
      if (armory) armory.click();
      return !!armory;
    })()`,
    returnByValue: true
  });
  await wait(1000);
  const forgeUi = await send('Runtime.evaluate', {
    expression: `(() => ({ tab: !!document.getElementById('armoryForgeTabBtn') }))()`,
    returnByValue: true
  }).then(r => r.result.value);
  assert(town.result.value && forgeTab.result.value, 'The town hub and armory are reachable');
  assert(forgeUi.tab, 'The armory offers the forge tab');

} catch (err) {
  console.error('  ❌ E2E Responsive Test Error:', err);
  failed++;
} finally {
  cleanup();
}

console.log(`\nE2E Responsive Summary: ${passed} passed, ${failed} failed.`);
if (failed > 0) process.exit(1);
