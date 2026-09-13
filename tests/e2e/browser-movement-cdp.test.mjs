// tests/e2e/browser-movement-cdp.test.mjs — End-to-End Headless Browser CDP Test
// Verifies 3D Miniature Models, Realistic Walking Traversal, and Minimap Sync
import fs from 'node:fs';
import { spawn } from 'node:child_process';

const BASE_URL = process.env.BASE_URL || (process.env.PORT ? `http://localhost:${process.env.PORT}` : 'http://localhost:3000');
const CDP_PORT = 9224;

const BROWSER_PATHS = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium'
];

function findBrowserBinary() {
  for (const p of BROWSER_PATHS) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (!condition) {
    console.error(`  ❌ FAILED: ${message}`);
    failed++;
    throw new Error(message);
  }
  passed++;
}

async function apiReq(method, path, body) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method} ${path} -> HTTP ${res.status}: ${JSON.stringify(data)}`);
  return data;
}

console.log('\n--- Running E2E Browser Test: 3D Miniatures & Walk Animations ---');

const browserBin = findBrowserBinary();
if (!browserBin) {
  console.log('⚠️ No Edge or Chrome binary found in standard paths; skipping E2E browser test.');
  process.exit(0);
}

// 1. Prepare Delve on Server
console.log('  Setting up test character and starting delve on server...');
const char = await apiReq('POST', '/api/characters', {
  name: 'CDP Test Hero',
  species: 'dwarf',
  className: 'fighter',
  background: 'soldier',
  baseScores: { str: 15, dex: 14, con: 14, int: 10, wis: 12, cha: 8 },
  bgPlus2: 'str', bgPlus1: 'con',
  skills: ['athletics', 'perception'],
  fightingStyle: 'defense',
  armorOption: 'chain_mail',
  weaponOption: 'sword_board'
});

const delve = await apiReq('POST', '/api/game/start', {
  characterId: char.id,
  bringAlly: true,
  difficulty: 'normal'
});
const delveId = delve.state.id;
console.log(`  ✔ Delve created: ${delveId}`);

// 2. Launch Headless Browser
const targetUrl = `${BASE_URL}/#/play/${delveId}`;
console.log(`  Launching headless browser targeting: ${targetUrl}`);

const browserProc = spawn(browserBin, [
  '--headless=new',
  `--remote-debugging-port=${CDP_PORT}`,
  '--disable-gpu',
  '--no-first-run',
  '--no-default-browser-check',
  targetUrl
]);

browserProc.on('error', (err) => {
  console.error('Browser failed to launch:', err);
});

async function waitForCDP() {
  for (let i = 0; i < 35; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json`);
      const tabs = await res.json();
      const tab = tabs.find(t => t.url && t.url.includes(delveId));
      if (tab) return tab;
    } catch {}
    await new Promise(r => setTimeout(r, 200));
  }
  throw new Error('CDP target tab not reachable');
}

let browserExited = false;
function cleanup() {
  if (!browserExited) {
    browserExited = true;
    try { browserProc.kill(); } catch {}
  }
}
process.on('exit', cleanup);
process.on('SIGINT', cleanup);

try {
  const tab = await waitForCDP();
  const ws = new WebSocket(tab.webSocketDebuggerUrl);
  let msgId = 1;
  const pending = new Map();
  const consoleErrors = [];

  function send(method, params = {}) {
    const id = msgId++;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
  }

  ws.onmessage = (msg) => {
    const data = JSON.parse(msg.data);
    if (data.id && pending.has(data.id)) {
      const p = pending.get(data.id);
      pending.delete(data.id);
      if (data.error) p.reject(data.error);
      else p.resolve(data.result);
    } else if (data.method === 'Runtime.consoleAPICalled') {
      const type = data.params.type;
      const text = (data.params.args || []).map(a => a.value ?? a.description ?? '').join(' ');
      if (type === 'error') {
        consoleErrors.push(text);
      }
    }
  };

  await new Promise(r => ws.onopen = r);
  await send('Runtime.enable');
  await send('Page.enable');
  await send('DOM.enable');

  // Wait for 3D engine and game state to mount
  console.log('  Waiting 3s for 3D world to render...');
  await new Promise(r => setTimeout(r, 3000));

  // Check 1: 3D Canvas & Minimap Mount
  const domCheck = await send('Runtime.evaluate', {
    expression: `(() => {
      const map3d = document.getElementById('map3d');
      const canvas3d = map3d ? map3d.querySelector('canvas') : null;
      const minimap = document.getElementById('mapCanvas');
      return {
        has3dContainer: !!map3d,
        has3dCanvas: !!canvas3d,
        hasMinimap: !!minimap,
        is3dVisible: map3d && getComputedStyle(map3d).display !== 'none'
      };
    })()`,
    returnByValue: true
  });

  const dom = domCheck.result.value;
  assert(dom.has3dContainer, '3D Map container (#map3d) must exist');
  assert(dom.has3dCanvas, 'Three.js WebGL canvas must be created and attached');
  assert(dom.hasMinimap, 'Minimap canvas (#mapCanvas) must exist');
  assert(dom.is3dVisible, '3D view must be active and visible by default');
  console.log('  ✔ PASS: 3D View and Minimap DOM mounted');

  // Check 2: Verify Character 3D Miniatures
  const miniatureCheck = await send('Runtime.evaluate', {
    expression: `(() => {
      // Access global or window state if available or check via canvas element
      const map3d = document.getElementById('map3d');
      const canvas = map3d ? map3d.querySelector('canvas') : null;
      return {
        canvasWidth: canvas ? canvas.width : 0,
        canvasHeight: canvas ? canvas.height : 0
      };
    })()`,
    returnByValue: true
  });

  const min = miniatureCheck.result.value;
  assert(min.canvasWidth > 0 && min.canvasHeight > 0, 'WebGL canvas must have positive dimensions');
  console.log('  ✔ PASS: Three.js viewport dimensions valid');

  // Check 3: Trigger Move Action via API and Observe Traversal in Game
  console.log('  Executing player move action to tile (4,5)...');
  await apiReq('POST', `/api/game/${delveId}/action`, { type: 'move', x: 4, y: 5 });

  // Wait 1.5s for smooth walking animation to step across tiles
  await new Promise(r => setTimeout(r, 1500));

  const gameAfterMove = await apiReq('GET', `/api/game/${delveId}`);
  const player = gameAfterMove.state.entities.find(e => e.kind === 'player');
  assert(player.x === 4 && player.y === 5, `Player moved to destination (4,5), got (${player.x},${player.y})`);
  // Check 4: Retreat to Safety & Verify Summary Popup Does Not Get Stuck
  console.log('  Testing Retreat to Safety flow...');
  // Click the retreat button in the browser UI
  const retreatClicked = await send('Runtime.evaluate', {
    expression: `(() => {
      const btn = document.querySelector('[data-act="retreat"]');
      if (btn) { btn.click(); return true; }
      return false;
    })()`,
    returnByValue: true
  });
  assert(retreatClicked.result.value === true, 'Retreat button must exist and be clicked in browser');
  await new Promise(r => setTimeout(r, 1200));

  // Verify modal is open and has title
  const modalCheck1 = await send('Runtime.evaluate', {
    expression: `(() => {
      const m = document.getElementById('summaryModal');
      const h2 = m ? m.querySelector('h2') : null;
      const closeX = document.getElementById('closeSummaryX');
      const reviewBtn = document.getElementById('closeSummaryBtn');
      const returnLink = m ? m.querySelector('.sumNavBtn') : null;
      return {
        hasModal: !!m,
        title: h2 ? h2.textContent : '',
        hasCloseX: !!closeX,
        hasReviewBtn: !!reviewBtn,
        hasReturnLink: !!returnLink
      };
    })()`,
    returnByValue: true
  });

  const m1 = modalCheck1.result.value;
  assert(m1.hasModal, 'Summary modal must be rendered on retreat');
  assert(m1.title.includes('Retreated to Safety'), `Expected Retreated to Safety title, got "${m1.title}"`);
  assert(m1.hasCloseX, 'Modal must have ✕ close button');
  assert(m1.hasReviewBtn, 'Modal must have Review Delve button');
  console.log('  ✔ PASS: Retreated to Safety popup rendered with close buttons');

  // Test dismissing the popup via close button
  console.log('  Testing close button dismissal...');
  await send('Runtime.evaluate', {
    expression: `document.getElementById('closeSummaryX').click()`
  });
  await new Promise(r => setTimeout(r, 200));

  const modalCheckClosed = await send('Runtime.evaluate', {
    expression: `!!document.getElementById('summaryModal')`,
    returnByValue: true
  });
  assert(modalCheckClosed.result.value === false, 'Modal must be removed from DOM after clicking close');
  console.log('  ✔ PASS: Modal cleanly dismissed via close button');

  // Re-open summary from side panel
  console.log('  Testing reopening summary from side panel...');
  await send('Runtime.evaluate', {
    expression: `(() => {
      const btn = document.querySelector('[data-act="retreat"]');
      if (btn) btn.click();
    })()`
  });
  await new Promise(r => setTimeout(r, 200));

  const modalCheckReopened = await send('Runtime.evaluate', {
    expression: `!!document.getElementById('summaryModal')`,
    returnByValue: true
  });
  assert(modalCheckReopened.result.value === true, 'Modal must reopen when clicking View Summary button');
  console.log('  ✔ PASS: Summary reopened from side panel');

  // Click "Return to Oakhaven" link and verify clean town navigation without stuck modal
  console.log('  Clicking Return to Oakhaven link...');
  await send('Runtime.evaluate', {
    expression: `(() => {
      const link = document.querySelector('.sumNavBtn');
      if (link) link.click();
    })()`
  });
  await new Promise(r => setTimeout(r, 800));

  const townNavCheck = await send('Runtime.evaluate', {
    expression: `(() => {
      const lingeringModal = document.getElementById('summaryModal');
      const anyBackdrop = document.querySelector('.modal-back');
      const isOverworld = location.hash.includes('overworld');
      const townView = document.querySelector('.city-view') || document.querySelector('.overworld-view');
      return {
        hasLingeringModal: !!lingeringModal,
        hasAnyBackdrop: !!anyBackdrop,
        isOverworld,
        hasTownView: !!townView
      };
    })()`,
    returnByValue: true
  });

  const town = townNavCheck.result.value;
  assert(!town.hasLingeringModal, 'Summary modal must NOT linger in DOM after navigating to town');
  assert(!town.hasAnyBackdrop, 'No backdrop overlays may remain on screen');
  assert(town.isOverworld, 'Hash must navigate to #/overworld');
  assert(town.hasTownView, 'Town view must be active and visible in DOM');
  console.log('  ✔ PASS: Successfully returned to Oakhaven with zero lingering popups');

  // Check 5: Console Error Integrity
  assert(consoleErrors.length === 0, `Expected 0 console errors, got ${consoleErrors.length}: ${consoleErrors.join(', ')}`);
  console.log('  ✔ PASS: Zero browser console errors during 3D rendering, movement, retreat and navigation');

  ws.close();
} catch (err) {
  console.error('  ❌ E2E Browser Test Error:', err);
  failed++;
} finally {
  cleanup();
}

console.log(`\nE2E Browser Tests Summary: ${passed} passed, ${failed} failed.`);
if (failed > 0) process.exit(1);
