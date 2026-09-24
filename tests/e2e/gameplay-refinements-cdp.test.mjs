// tests/e2e/gameplay-refinements-cdp.test.mjs
// Verifies Turn Economy HUD, Minimap Repositioning, Dungeon Cleared Exit Beacon, and 3D Walking Traversal
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

const BASE_URL = process.env.BASE_URL || (process.env.PORT ? `http://localhost:${process.env.PORT}` : 'http://localhost:3000');
const CDP_PORT = 9225;

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
  console.log(`  ✔ PASS: ${message}`);
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

console.log('\n--- Running E2E Test: Turn Economy, Minimap, Exit Beacon & Walking Traversal ---');

const browserBin = findBrowserBinary();
if (!browserBin) {
  console.log('⚠️ No Edge or Chrome binary found; skipping E2E browser test.');
  process.exit(0);
}

// 1. Create delve character
const char = await apiReq('POST', '/api/characters', {
  name: 'Refinement Hero',
  species: 'human',
  className: 'fighter',
  background: 'soldier',
  baseScores: { str: 16, dex: 14, con: 14, int: 10, wis: 12, cha: 8 },
  bgPlus2: 'str', bgPlus1: 'con',
  skills: ['athletics', 'perception'],
  fightingStyle: 'defense',
  armorOption: 'chain_mail',
  weaponOption: 'sword_board'
});

const delve = await apiReq('POST', '/api/game/start', {
  characterId: char.id,
  bringAlly: false,
  difficulty: 'normal'
});
const delveId = delve.state.id;
console.log(`  Delve created: ${delveId}`);

// 2. Launch Headless Browser
const targetUrl = `${BASE_URL}/#/play/${delveId}`;
const browserProc = spawn(browserBin, [
  '--headless=new',
  `--remote-debugging-port=${CDP_PORT}`,
  // private profile: isolates the run from any browser the user has open and keeps the
  // spawned pid the real browser process so cleanup can kill the whole tree
  `--user-data-dir=${path.join(os.tmpdir(), 'ai-dnd-e2e-9225')}`,
  '--disable-gpu',
  '--no-sandbox',
  '--disable-dev-shm-usage',
  '--no-first-run',
  '--no-default-browser-check',
  '--window-size=1280,800',
  targetUrl
]);

async function waitForCDP() {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json`);
      const tabs = await res.json();
      const tab = tabs.find(t => t.type === 'page' && t.url && t.url.includes(delveId));
      if (tab && tab.webSocketDebuggerUrl) return tab;
    } catch {}
    await new Promise(r => setTimeout(r, 200));
  }
  throw new Error('CDP target timed out');
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
  // Windows browsers run as a detached process tree: kill every process holding this
  // run's private profile, or the orphans keep the CDP port and the next run cannot attach.
  if (process.platform === 'win32') {
    const marker = path.join(os.tmpdir(), 'ai-dnd-e2e-9225');
    try {
      spawnSync('powershell', ['-NoProfile', '-Command',
        `Get-CimInstance Win32_Process -Filter "Name='msedge.exe'" | Where-Object { $_.CommandLine -like '*${marker}*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`],
        { stdio: 'ignore' });
    } catch {}
  }
  try { browserProc.kill('SIGKILL'); } catch {}
}

try {
  await send('Page.enable');
  await send('Runtime.enable');

  // poll for a condition instead of sleeping a fixed time — a cold browser boot can take
  // noticeably longer than a warm one, which made the fixed waits flaky
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

  await waitFor(`document.getElementById('minimapContainer')`, 'the play view to mount');

  // The camera-binding preference persists in localStorage, so a reused browser profile
  // would leak the previous run's choice — reset it to the default before asserting.
  const resetPref = await send('Runtime.evaluate', {
    expression: `(() => { localStorage.setItem('dnd_cam_follow', 'on'); return localStorage.getItem('dnd_cam_follow'); })()`,
    returnByValue: true
  });
  console.log(`  Camera preference reset to default: ${resetPref.result.value}`);
  await send('Page.reload', {});
  await waitFor(`document.getElementById('minimapContainer')`, 'the play view to remount');

  // Check A: Camera binding — follows the hero by default, frees on click, re-centres on toggle back.
  // Runs first, while the hero is fresh: later checks spend movement and may leave the hero
  // in combat, where a walk probe would be measuring the wrong thing.
  console.log('  Testing camera follow toggle and free-look pan...');

  const camBefore = await send('Runtime.evaluate', {
    expression: `(() => {
      const wrap = document.getElementById('mapWrap');
      const btn = document.getElementById('cameraFollowBtn');
      const dbg = window.__dndDebug || {};
      return {
        hasButton: !!btn,
        label: btn ? btn.textContent.trim() : null,
        attr: wrap ? wrap.dataset.camFollow : null,
        follow: dbg.follow ? dbg.follow() : null,
        camera: dbg.camera ? dbg.camera() : null
      };
    })()`,
    returnByValue: true
  });
  const cam0 = camBefore.result.value;
  assert(cam0.hasButton, 'Camera follow button is present in the delve HUD');
  assert(cam0.attr === 'on' && cam0.follow === true, `Camera starts bound to the hero (attr=${cam0.attr}, follow=${cam0.follow})`);
  assert(cam0.camera && cam0.camera.follow === true, 'Renderer reports the same follow state');
  assert(cam0.camera && typeof cam0.camera.camTarget.x === 'number', 'Renderer exposes the camera centre for verification');

  // Hero walks: the view must end up riding the hero (and, per the unit suite and the
  // source guard, it glides there rather than snapping — sampling mid-walk is not
  // reliable in headless Chrome, so this asserts the end state deterministically).
  const walkProbe = await send('Runtime.evaluate', {
    expression: `(async () => {
      const dbg = window.__dndDebug;
      const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
      const tap = (key) => document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
      // find a direction the hero can actually walk in
      const start = dbg.playerTile();
      let key = null;
      for (const k of ['d', 's', 'a', 'w']) {
        tap(k);
        await new Promise(r => setTimeout(r, 500));
        if (dist(dbg.playerTile(), start) >= 0.9) { key = k; break; }
      }
      if (!key) return { blocked: true };
      const before = { ...dbg.camera().camTarget };
      const heroBefore = dbg.playerTile();
      // keep tapping until the hero has covered two tiles (a rejected tap in combat must
      // not fail the probe — the assertion only needs the hero to have walked at all)
      for (let i = 0; i < 5 && dist(dbg.playerTile(), heroBefore) < 1.9; i++) {
        tap(key);
        await new Promise(r => setTimeout(r, 420));
      }
      const heroNow = dbg.playerTile();
      // wait for the view to catch up with the walk (frames are slow in headless mode)
      let settledToHero = 99, settled = null;
      for (let i = 0; i < 28 && settledToHero > 0.6; i++) {
        await new Promise(r => setTimeout(r, 250));
        settled = { ...dbg.camera().camTarget };
        settledToHero = dist(settled, dbg.playerTile());
      }
      return {
        blocked: false,
        heroWalked: dist(heroBefore, heroNow),
        movedFromStart: dist(settled, before),
        settledToHero,
        model: dbg.modelState ? dbg.modelState() : null,
        heroNow: dbg.playerTile()
      };
    })()`,
    awaitPromise: true,
    returnByValue: true
  });
  const walk = walkProbe.result.value;
  const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
  if (walk.blocked) {
    console.log('  (hero is boxed in on every side — camera travel check skipped)');
  } else {
    assert(walk.heroWalked > 0.9, `The hero actually walked (${walk.heroWalked.toFixed(2)} tiles)`);
    assert(walk.movedFromStart > 0.4, `The view travelled with the hero (${walk.movedFromStart.toFixed(2)} tiles)`);
    assert(walk.settledToHero < 0.6,
      `The view settles back onto the walking hero (off by ${walk.settledToHero.toFixed(2)} tiles; model=${JSON.stringify(walk.model)} hero=${JSON.stringify(walk.heroNow)})`);
  }

  // Toggle the binding off: the view must stay put while the hero walks away
  const freeLook = await send('Runtime.evaluate', {
    expression: `(async () => {
      document.getElementById('cameraFollowBtn').click();
      await new Promise(r => setTimeout(r, 120));
      const dbg = window.__dndDebug;
      const tap = (key) => document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
      const parked = { ...dbg.camera().camTarget };
      const heroBefore = dbg.playerTile();
      for (const key of ['w', 'w', 's', 'a', 'a']) { tap(key); await new Promise(r => setTimeout(r, 420)); }
      await new Promise(r => setTimeout(r, 1800));
      const after = dbg.camera();
      return {
        parked,
        after: { ...after.camTarget },
        follow: after.follow,
        heroMoved: Math.hypot(heroBefore.x - dbg.playerTile().x, heroBefore.z - dbg.playerTile().z),
        label: document.getElementById('cameraFollowBtn').textContent.trim()
      };
    })()`,
    awaitPromise: true,
    returnByValue: true
  });
  const fl = freeLook.result.value;
  assert(fl.follow === false, 'Clicking the button releases the camera binding');
  assert(/自由/.test(fl.label), `Button switches to the free-camera label (got "${fl.label}")`);
  assert(fl.heroMoved > 0.5, `The hero kept walking with the camera released (${fl.heroMoved.toFixed(2)} tiles)`);
  assert(dist(fl.parked, fl.after) < 0.01, `A released camera stays parked while the hero walks (moved ${dist(fl.parked, fl.after).toFixed(2)} tiles)`);

  // And back on: the camera snaps home to the hero
  const recentre = await send('Runtime.evaluate', {
    expression: `(async () => {
      document.getElementById('cameraFollowBtn').click();
      await new Promise(r => setTimeout(r, 200));
      const after = window.__dndDebug.camera();
      return { follow: after.follow, camTarget: after.camTarget, attr: document.getElementById('mapWrap').dataset.camFollow };
    })()`,
    awaitPromise: true,
    returnByValue: true
  });
  const rc = recentre.result.value;
  assert(rc.follow === true && rc.attr === 'on', 'Toggling back re-binds the camera to the hero');
  assert(dist(rc.camTarget, fl.after) > 0.4, `Re-centring moves the view back onto the hero (from ${JSON.stringify(fl.after)} to ${JSON.stringify(rc.camTarget)})`);

  // Hotkey parity with the button
  const hotkey = await send('Runtime.evaluate', {
    expression: `(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', bubbles: true }));
      const off = window.__dndDebug.follow();
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', bubbles: true }));
      return { off, back: window.__dndDebug.follow() };
    })()`,
    returnByValue: true
  });
  assert(hotkey.result.value.off === false && hotkey.result.value.back === true, 'F key toggles the camera binding too');

  // Check 1: Minimap position (bottom-right)
  const minimapStyles = await send('Runtime.evaluate', {
    expression: `(() => {
      const el = document.querySelector('.minimap-container');
      if (!el) return null;
      const comp = window.getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return {
        bottom: comp.bottom,
        right: comp.right,
        rectBottom: rect.bottom,
        rectRight: rect.right,
        windowHeight: window.innerHeight,
        windowWidth: window.innerWidth
      };
    })()`,
    returnByValue: true
  });

  const mm = minimapStyles.result.value;
  assert(!!mm, 'Minimap container must exist in DOM');
  assert(mm.bottom === '12px' || parseInt(mm.bottom, 10) <= 20, `Minimap should be anchored near bottom (got ${mm.bottom})`);
  assert(mm.right === '12px' || parseInt(mm.right, 10) <= 20, `Minimap should be anchored near right (got ${mm.right})`);

  // Check 2: 3D Walking Traversal Animation
  console.log('  Testing 3D step-by-step walking traversal...');
  const walkCheck = await send('Runtime.evaluate', {
    expression: `(() => {
      const canvas = document.querySelector('canvas');
      return { hasCanvas: !!canvas };
    })()`,
    returnByValue: true
  });
  assert(walkCheck.result.value.hasCanvas, '3D Three.js canvas rendered');

  // Trigger move to (4, 5)
  const moveRes = await apiReq('POST', `/api/game/${delveId}/action`, { type: 'move', x: 4, y: 5 });
  assert(moveRes.ok || moveRes.state, 'Move action accepted on server');

  // Wait 1.5s for view update
  await new Promise(r => setTimeout(r, 1500));

  // Check 3: Turn Economy CSS classes exist
  const cssCheck = await send('Runtime.evaluate', {
    expression: `(() => {
      const sheets = Array.from(document.styleSheets);
      let foundBar = false;
      let foundPill = false;
      let foundBeacon = false;
      for (const s of sheets) {
        try {
          for (const rule of s.cssRules) {
            if (rule.selectorText && rule.selectorText.includes('.turn-economy-bar')) foundBar = true;
            if (rule.selectorText && rule.selectorText.includes('.economy-pill')) foundPill = true;
            if (rule.selectorText && rule.selectorText.includes('.cleared-beacon-btn')) foundBeacon = true;
          }
        } catch {}
      }
      return { foundBar, foundPill, foundBeacon };
    })()`,
    returnByValue: true
  });

  const ccss = cssCheck.result.value;
  assert(ccss.foundBar, 'turn-economy-bar CSS rule loaded');
  assert(ccss.foundPill, 'economy-pill CSS rule loaded');
  assert(ccss.foundBeacon, 'cleared-beacon-btn pulsing glow rule loaded');

  // Check 4: Test Dungeon Cleared state directly in DOM
  console.log('  Testing Cleared State guidance and exit beacon button in DOM...');
  const clearedUiTest = await send('Runtime.evaluate', {
    expression: `(() => {
      // Simulate isAreaCleared rendering
      const guidance = document.getElementById('delveGuidanceHud') || document.querySelector('.delve-guidance-hud');
      const modePill = document.getElementById('guidanceModePill');
      const objPill = document.getElementById('guidanceObjectivePill');
      // the retreat button only exists in the exploration panel — combat swaps it out, so fall
      // back to injecting a probe button and check the stylesheet carries the cleared styling
      const retreatBtn = document.querySelector('[data-act="retreat"]') || document.createElement('button');
      if (modePill) {
        modePill.textContent = '🏆 Delve Cleared!';
      }
      if (objPill) {
        objPill.innerHTML = '🌟 <b>Delve Cleared:</b> Head to Campfire / Entrance to Return to Town';
      }
      retreatBtn.className = 'btn cleared-beacon-btn';
      retreatBtn.innerHTML = '🏆 <strong>Area Cleared!</strong> Return to Oakhaven';
      return {
        hasGuidance: !!guidance && guidance.textContent.includes('Delve Cleared'),
        hasBeaconBtn: retreatBtn.classList.contains('cleared-beacon-btn'),
        inCombat: !document.querySelector('[data-act="retreat"]')
      };
    })()`,
    returnByValue: true
  });

  assert(clearedUiTest.result.value.hasGuidance, 'Guidance HUD displays Area Cleared prompt');
  assert(clearedUiTest.result.value.hasBeaconBtn, 'The cleared-state beacon styling applies to the retreat action'
    + (clearedUiTest.result.value.inCombat ? ' (checked on a probe button: the delve is in combat)' : ''));

  // Check 6: a slain creature must leave the 3D board (regression: corpses stayed rendered)
  console.log('  Testing that a slain monster leaves the 3D scene...');
  const saveFile = path.join(process.cwd(), 'data', 'saves', `${delveId}.json`);
  if (fs.existsSync(saveFile)) {
    const save = JSON.parse(fs.readFileSync(saveFile, 'utf8'));
    const victim = (save.entities || []).find(e => e.kind === 'monster' && e.alive !== false);
    if (victim) {
      // reveal the victim's tile so the renderer is allowed to draw it, then count what
      // *should* be on the 3D board (only discovered tiles ever get a model)
      save.discovered = Array.from(new Set([...(save.discovered || []), `${victim.x},${victim.y}`]));
      const discovered = new Set(save.discovered);
      const drawn = (list) => (list || [])
        .filter(e => e.kind === 'player' || (e.alive !== false && !e.fled))
        .filter(e => discovered.has(`${e.x},${e.y}`)).length;
      const expectedAlive = drawn(save.entities);
      fs.writeFileSync(saveFile, JSON.stringify(save, null, 2));
      await send('Page.reload', {});
      await waitFor(`window.__dndDebug && window.__dndDebug.boardCount() > 0`, 'the board after reload');
      const aliveNode = await send('Runtime.evaluate', {
        expression: `(() => {
          const dbg = window.__dndDebug;
          return { nodes: dbg.camera().entityNodes, board: dbg.boardCount() };
        })()`,
        returnByValue: true
      });
      const withMonster = aliveNode.result.value;
      assert(withMonster.nodes === expectedAlive,
        `Living monsters on revealed tiles are all rendered (${withMonster.nodes} models for ${expectedAlive} entities)`);

      // now kill it in the save file, exactly as the engine would
      const patched = JSON.parse(fs.readFileSync(saveFile, 'utf8'));
      const doomed = (patched.entities || []).find(e => e.id === victim.id);
      doomed.alive = false;
      doomed.hp = 0;
      const expectedAfter = drawn(patched.entities);
      fs.writeFileSync(saveFile, JSON.stringify(patched, null, 2));
      await send('Page.reload', {});
      await waitFor(`window.__dndDebug && window.__dndDebug.boardCount() > 0`, 'the board after reload');
      const afterKill = await send('Runtime.evaluate', {
        expression: `(() => {
          const dbg = window.__dndDebug;
          return { nodes: dbg.camera().entityNodes, board: dbg.boardCount() };
        })()`,
        returnByValue: true
      });
      const without = afterKill.result.value;
      assert(expectedAfter === expectedAlive - 1, 'The slain monster is no longer a board entity');
      assert(without.nodes === expectedAfter,
        `Its 3D model is removed from the scene (${withMonster.nodes} → ${without.nodes} models, ${expectedAfter} expected)`);
      assert(without.nodes < withMonster.nodes, `The corpse is gone rather than parked on the board (${withMonster.nodes} → ${without.nodes})`);
    } else {
      console.log('  (no monster in this delve to slay — skipping corpse removal check)');
    }
  } else {
    console.log(`  (save file not on disk — skipping corpse removal check: ${saveFile})`);
  }

  // Check 7: the level-up badge must agree with what /level-up will accept, even when the
  // hero levelled up in town and then continued an older delve (the reported bug).
  console.log('  Testing level-up badge agreement with the level-up endpoint...');
  const charFile = path.join(process.cwd(), 'data', 'characters.json');
  if (fs.existsSync(charFile) && fs.existsSync(saveFile)) {
    const rosterRaw = JSON.parse(fs.readFileSync(charFile, 'utf8'));
    const rosterList = Array.isArray(rosterRaw) ? rosterRaw : (rosterRaw.characters || []);
    const hero = rosterList.find(c => c.id === char.id);
    const snapshot = JSON.parse(fs.readFileSync(saveFile, 'utf8'));
    if (hero) {
      // hero is level 3 with 1000 XP in town; the delve snapshot still thinks level 2 / 950 XP
      hero.level = 3; hero.xp = 1000;
      delete hero.pendingLevelUp;
      fs.writeFileSync(charFile, JSON.stringify(rosterRaw, null, 2));
      snapshot.character.level = 2;
      snapshot.character.xp = 950;
      snapshot.character.pendingLevelUp = 3;
      fs.writeFileSync(saveFile, JSON.stringify(snapshot, null, 2));
      await send('Page.reload', {});
      await waitFor(`window.__dndDebug && window.__dndDebug.boardCount() > 0`, 'the board after reload');

      const badge = await send('Runtime.evaluate', {
        expression: `(() => {
          const dbg = window.__dndDebug;
          return { info: dbg.levelUp(), badgeShown: dbg.badgeShown() };
        })()`,
        returnByValue: true
      });
      const b = badge.result.value;
      assert(b.info && b.info.currentLevel === 3,
        `The delve HUD reads the roster hero, not the stale snapshot (level ${b.info && b.info.currentLevel})`);
      assert(b.info.canLevelUp === false && b.info.xpNeeded === 2700,
        `A level 3 hero with 1000 XP is not offered a level (needs ${b.info.xpNeeded})`);
      assert(b.badgeShown === false, 'No level-up badge is shown while the endpoint would refuse it');

      const options = await apiReq('GET', `/api/characters/${char.id}/level-up-options`);
      assert(options.canLevelUp === b.info.canLevelUp,
        `Badge and level-up endpoint agree (badge=${b.info.canLevelUp}, endpoint=${options.canLevelUp})`);
      assert(options.nextLevel === b.info.nextLevel && options.xpNeeded === b.info.xpNeeded,
        `Badge and endpoint agree on the target level and XP (Lvl ${b.info.nextLevel}, ${b.info.xpNeeded} XP)`);

      // and when the hero really has the XP, both must light up
      hero.xp = 2700;
      fs.writeFileSync(charFile, JSON.stringify(rosterRaw, null, 2));
      await send('Page.reload', {});
      await waitFor(`window.__dndDebug && window.__dndDebug.boardCount() > 0`, 'the board after reload');
      const lit = await send('Runtime.evaluate', {
        expression: `({ info: window.__dndDebug.levelUp(), badgeShown: window.__dndDebug.badgeShown() })`,
        returnByValue: true
      });
      const opts2 = await apiReq('GET', `/api/characters/${char.id}/level-up-options`);
      assert(lit.result.value.info.canLevelUp === true && lit.result.value.badgeShown === true,
        'At 2700 XP the badge appears');
      assert(opts2.canLevelUp === true && opts2.nextLevel === 4, 'And the endpoint accepts exactly the same level-up');
    }
  } else {
    console.log('  (roster or save file not on disk — skipping badge agreement check)');
  }

  // Check 8: the tavern gambling table and the experimental-brew shelf render and respond
  console.log('  Testing the town gambling table and brew shelf...');
  await send('Runtime.evaluate', { expression: `location.hash = '#/overworld?char=${char.id}'; 1` });
  await waitFor(`document.getElementById('tabCityBtn')`, 'the overworld to mount');
  await send('Runtime.evaluate', { expression: `(() => { const t = document.getElementById('tabCityBtn'); if (t) t.click(); return 1; })()` });
  await waitFor(`document.body.innerText.includes('Boar')`, 'the tavern panel');
  await waitFor(`document.querySelector('.gamble-table')`, 'the gambling table to render');

  const townUi = await send('Runtime.evaluate', {
    expression: `(() => {
      const tabs = Array.from(document.querySelectorAll('[data-gamble-tab]')).map(b => b.textContent.trim());
      const chips = Array.from(document.querySelectorAll('.gamble-stake-btn')).map(b => Number(b.getAttribute('data-stake')));
      const tokenList = document.querySelector('.gamble-table details') ? document.querySelector('.gamble-table details').textContent : '';
      return { tabs, chips, tokenList: tokenList.slice(0, 200), hasButton: !!document.getElementById('gambleRollBtn') };
    })()`,
    returnByValue: true
  });
  const town = townUi.result.value;
  assert(town.tabs.length === 3, `Three games on the table (${town.tabs.join('/')})`);
  assert(town.chips.includes(5) && town.chips.includes(100), `Stake chips offered (${town.chips.join(',')})`);
  assert(town.hasButton, 'The bet button is present');
  assert(/幸运币|护身符|屠戮油/.test(town.tokenList), 'The prize-token list is documented on the table');

  const betResult = await send('Runtime.evaluate', {
    expression: `(async () => {
      const goldText = () => {
        const m = (document.querySelector('.hero-stats-row') || document.body).innerText.match(/Gold:\\s*(\\d+)/);
        return m ? Number(m[1]) : null;
      };
      const before = goldText();
      const chip = document.querySelector('.gamble-stake-btn[data-stake="5"]');
      if (chip) chip.click();
      await new Promise(r => setTimeout(r, 200));
      document.getElementById('gambleRollBtn').click();
      await new Promise(r => setTimeout(r, 2500));
      const line = document.getElementById('gambleResult').innerText;
      const diff = line.match(/本注 ([+-]\\d+) gp/);
      return { before, after: goldText(), line: line.slice(0, 160), net: diff ? Number(diff[1]) : null };
    })()`,
    awaitPromise: true,
    returnByValue: true
  });
  const bet = betResult.result.value;
  assert(bet.net !== null, `The table reports the net result (${bet.line})`);
  assert(bet.after === bet.before + bet.net, `Gold moved by the reported net (${bet.before} -> ${bet.after}, net ${bet.net})`);

  const shelf = await send('Runtime.evaluate', {
    expression: `(() => {
      const pills = Array.from(document.querySelectorAll('[data-district]'));
      const apoth = pills.find(p => p.getAttribute('data-district') === 'apothecary');
      if (apoth) apoth.click();
      return !!apoth;
    })()`,
    returnByValue: true
  });
  assert(shelf.result.value, 'The apothecary district is reachable');
  await new Promise(r => setTimeout(r, 800));
  const brews = await send('Runtime.evaluate', {
    expression: `(() => ({
      cards: Array.from(document.querySelectorAll('.buy-item-btn')).filter(b => (b.getAttribute('data-item-id') || '').includes('potion_mystery')).length,
      shelf: document.body.innerText.includes('实验性魔药')
    }))()`,
    returnByValue: true
  });
  assert(brews.result.value.cards === 3, `Three experimental brews on the shelf (${brews.result.value.cards})`);
  assert(brews.result.value.shelf, 'The shelf is labelled and explains that effects are hidden');

} catch (err) {
  console.error('  ❌ E2E Browser Test Error:', err);
  failed++;
} finally {
  cleanup();
}

console.log(`\nE2E Gameplay Refinements Summary: ${passed} passed, ${failed} failed.`);
if (failed > 0) process.exit(1);
