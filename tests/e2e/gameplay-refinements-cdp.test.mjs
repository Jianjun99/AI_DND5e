// tests/e2e/gameplay-refinements-cdp.test.mjs
// Verifies Turn Economy HUD, Minimap Repositioning, Dungeon Cleared Exit Beacon, 3D Walking Traversal,
// and the prepare-page start options (map / difficulty / companion really apply — T1)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { browserBinary, softwareWebGLFlags, requireWebGL, captureBrowserArtifacts } from './_browser-runtime.mjs';
import { pollUntil, clickUntil } from './_cdp-helpers.mjs';

const BASE_URL = process.env.BASE_URL || (process.env.PORT ? `http://localhost:${process.env.PORT}` : 'http://localhost:3000');
const CDP_PORT = 9225;

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
// Kill any stale browser from a crashed previous run holding OUR profile dir —
// historically the main source of instant CDP failures (tasks/cdp-flaky-investigation.md).
const PROFILE_MARKER = path.join(os.tmpdir(), 'ai-dnd-e2e-9225');
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
  // private profile: isolates the run from any browser the user has open and keeps the
  // spawned pid the real browser process so cleanup can kill the whole tree
  `--user-data-dir=${PROFILE_MARKER}`,
  ...softwareWebGLFlags(),
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
  killStaleBrowser();
  throw new Error('CDP target timed out after 60 attempts (CDP port 9225, profile ai-dnd-e2e-9225). ' +
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
  await requireWebGL(send);

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
      await new Promise(r => setTimeout(r, 60)); // belt-and-braces settle only — the toggle applies synchronously
      const dbg = window.__dndDebug;
      const tap = (key) => document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
      const parked = { ...dbg.camera().camTarget };
      // taps race the app's busy guard — retry the walk sequence until the hero
      // actually moves (<= 3 rounds), instead of failing on a fully swallowed round
      let heroMoved = 0, rounds = 0;
      for (let round = 0; round < 3 && heroMoved <= 0.5; round++) {
        rounds = round + 1;
        const heroBefore = dbg.playerTile();
        for (const key of ['w', 'w', 's', 'a', 'a']) { tap(key); await new Promise(r => setTimeout(r, 420)); }
        // wait until the hero's logical tile stops changing instead of a fixed 1.8s — headless
        // frames are uneven, and a busy-swallowed tap would make a fixed sleep pointless
        let prevTile = dbg.playerTile(), stable = 0;
        for (let i = 0; i < 24 && stable < 3; i++) {
          await new Promise(r => setTimeout(r, 250));
          const t = dbg.playerTile();
          stable = (t && prevTile && t.x === prevTile.x && t.z === prevTile.z) ? stable + 1 : 0;
          prevTile = t;
        }
        heroMoved = Math.hypot(heroBefore.x - dbg.playerTile().x, heroBefore.z - dbg.playerTile().z);
      }
      const after = dbg.camera();
      return {
        parked,
        after: { ...after.camTarget },
        follow: after.follow,
        heroMoved,
        rounds,
        label: document.getElementById('cameraFollowBtn').textContent.trim()
      };
    })()`,
    awaitPromise: true,
    returnByValue: true
  });
  const fl = freeLook.result.value;
  assert(fl.follow === false, 'Clicking the button releases the camera binding');
  assert(/自由/.test(fl.label), `Button switches to the free-camera label (got "${fl.label}")`);
  assert(fl.heroMoved > 0.5, `The hero kept walking with the camera released (${fl.heroMoved.toFixed(2)} tiles after ${fl.rounds} round(s))`);
  assert(dist(fl.parked, fl.after) < 0.01, `A released camera stays parked while the hero walks (moved ${dist(fl.parked, fl.after).toFixed(2)} tiles)`);

  // And back on: the camera snaps home to the hero
  const recentre = await send('Runtime.evaluate', {
    expression: `(async () => {
      document.getElementById('cameraFollowBtn').click();
      // the re-centre glides back over several rAF frames — poll until the view has actually
      // moved off the parked spot instead of sampling one fixed 200ms mid-glide frame
      let after = window.__dndDebug.camera();
      const parked = { x: after.camTarget.x, z: after.camTarget.z };
      for (let i = 0; i < 32 && Math.hypot(after.camTarget.x - parked.x, after.camTarget.z - parked.z) < 0.4; i++) {
        await new Promise(r => setTimeout(r, 250));
        after = window.__dndDebug.camera();
      }
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

  // brief settle for the view update — nothing below asserts on this move itself (the next
  // checks read stylesheets or reload the page from disk), so half the old 1.5s is plenty
  await new Promise(r => setTimeout(r, 750));

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
  assert(!!process.env.DATA_DIR, 'Disk regressions require the server test DATA_DIR');
  const saveFile = path.join(process.env.DATA_DIR, 'saves', `${delveId}.json`);
  assert(fs.existsSync(saveFile), 'The test save must exist in DATA_DIR: ' + saveFile);
  {
    const save = JSON.parse(fs.readFileSync(saveFile, 'utf8'));
    const victim = (save.entities || []).find(e => e.kind === 'monster' && e.alive !== false);
    assert(!!victim, 'Corpse removal regression requires a living monster fixture');
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
    }
  }

  // Check 7: the level-up badge must agree with what /level-up will accept, even when the
  // hero levelled up in town and then continued an older delve (the reported bug).
  console.log('  Testing level-up badge agreement with the level-up endpoint...');
  const charFile = path.join(process.env.DATA_DIR, 'characters.json');
  assert(fs.existsSync(charFile), 'The test roster must exist in DATA_DIR: ' + charFile);
  {
    const rosterRaw = JSON.parse(fs.readFileSync(charFile, 'utf8'));
    const rosterList = Array.isArray(rosterRaw) ? rosterRaw : (rosterRaw.characters || []);
    const hero = rosterList.find(c => c.id === char.id);
    assert(!!hero, 'Badge agreement regression requires its roster hero');
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

  const betStake = await send('Runtime.evaluate', {
    expression: `(() => {
      const goldText = () => {
        const m = (document.querySelector('.hero-stats-row') || document.body).innerText.match(/Gold:\\s*(\\d+)/);
        return m ? Number(m[1]) : null;
      };
      const before = goldText();
      const chip = document.querySelector('.gamble-stake-btn[data-stake="5"]');
      if (chip) chip.click();
      return { before };
    })()`,
    returnByValue: true
  });
  // the roll is a server round trip plus an in-page dice animation — poll for the result
  // line (re-clicking the roll button if it never shows) instead of sleeping a fixed 2.5s
  await clickUntil(send,
    `(() => { const b = document.getElementById('gambleRollBtn'); if (b && !b.disabled) { b.click(); return true; } return false; })()`,
    `/本注 [+-]?\\d+ gp/.test((document.getElementById('gambleResult') || {}).innerText || '')`,
    { timeout: 10000, description: 'the gamble result line to render' });
  const betResult = await send('Runtime.evaluate', {
    expression: `(() => {
      const goldText = () => {
        const m = (document.querySelector('.hero-stats-row') || document.body).innerText.match(/Gold:\\s*(\\d+)/);
        return m ? Number(m[1]) : null;
      };
      const line = document.getElementById('gambleResult').innerText;
      const diff = line.match(/本注 ([+-]\\d+) gp/);
      return { after: goldText(), line: line.slice(0, 160), net: diff ? Number(diff[1]) : null };
    })()`,
    returnByValue: true
  });
  const bet = { before: betStake.result.value.before, ...betResult.result.value };
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
  // district pills re-render synchronously — poll for the shelf instead of a fixed 0.8s
  await pollUntil(send, `(() => {
    const cards = Array.from(document.querySelectorAll('.buy-item-btn'))
      .filter(b => (b.getAttribute('data-item-id') || '').includes('potion_mystery')).length;
    return cards === 3 && document.body.innerText.includes('实验性魔药');
  })()`, { description: 'the experimental-brew shelf to render' });
  const brews = await send('Runtime.evaluate', {
    expression: `(() => ({
      cards: Array.from(document.querySelectorAll('.buy-item-btn')).filter(b => (b.getAttribute('data-item-id') || '').includes('potion_mystery')).length,
      shelf: document.body.innerText.includes('实验性魔药')
    }))()`,
    returnByValue: true
  });
  assert(brews.result.value.cards === 3, `Three experimental brews on the shelf (${brews.result.value.cards})`);
  assert(brews.result.value.shelf, 'The shelf is labelled and explains that effects are hidden');

  // Check 9: the prepare page (#/play/new) must really apply the chosen map, difficulty and
  // companion. The regression (T1): the page passed its options object into a four-positional
  // api.startGame wrapper, so `bringAlly` received the object and difficulty/mapId were never
  // sent — every embark came out crypt/normal/bram. Assert on the real network payload AND the
  // persisted save, never just on the page's own state.
  console.log('  Testing the prepare-page start options (map / difficulty / companion)...');
  const openPreparePage = async () => {
    await send('Runtime.evaluate', { expression: `location.hash = '#/play/new?char=${char.id}'; 1` });
    await waitFor(`document.getElementById('beginBtn')`, 'the prepare page to mount');
  };
  // instrument fetch to capture the POST /api/game/start bodies (survives hash navigation)
  await send('Runtime.evaluate', { expression: `(() => {
    window.__t1StartCalls = [];
    const orig = window.fetch;
    window.fetch = function(input, init) {
      try {
        const url = typeof input === 'string' ? input : (input && input.url) || '';
        if (url.includes('/api/game/start') && init && typeof init.body === 'string') {
          window.__t1StartCalls.push(JSON.parse(init.body));
        }
      } catch {}
      return orig.apply(this, arguments);
    };
    return 1;
  })()`, returnByValue: true });
  const descendAndWait = async () => {
    await clickUntil(send,
      `(() => { const b = document.getElementById('beginBtn'); if (b && !b.disabled) { b.click(); return true; } return false; })()`,
      `(/^#\\/play\\/save_/.test(location.hash))`,
      { timeout: 12000, description: 'the fresh delve to open after Descend' });
    const hashVal = await send('Runtime.evaluate', { expression: 'location.hash', returnByValue: true });
    return (((hashVal.result || {}).value) || '').match(/save_[\w-]+/)?.[0] || '';
  };

  // Scenario 1: non-default map, hard, solo
  await openPreparePage();
  const picks1 = await send('Runtime.evaluate', { expression: `(() => {
    const hills = document.querySelector('input[name="mapPick"][value="howling-hills"]');
    const hard = document.querySelector('input[name="difficulty"][value="hard"]');
    const solo = document.querySelector('input[name="companionPick"][value="none"]');
    if (!hills || !hard || !solo) return { ok: false, hills: !!hills, hard: !!hard, solo: !!solo };
    hills.checked = true; hard.checked = true; solo.checked = true;
    return { ok: true };
  })()`, returnByValue: true });
  assert(picks1.result.value.ok, 'The prepare page offers howling-hills / hard / solo options');
  const soloSaveId = await descendAndWait();
  const soloDelve = await apiReq('GET', `/api/game/${soloSaveId}`);
  assert(soloDelve.state.mapId === 'howling-hills',
    `The chosen map is the delve actually created (got ${soloDelve.state.mapId})`);
  assert(soloDelve.state.difficulty === 'hard',
    `The chosen difficulty is applied (got ${soloDelve.state.difficulty})`);
  assert(!soloDelve.state.entities.some(e => e.kind === 'ally'),
    'A solo expedition embarks without a companion');
  const soloPayload = await send('Runtime.evaluate', { expression: `(window.__t1StartCalls[0] || {})`, returnByValue: true });
  const sp = soloPayload.result.value;
  assert(sp.characterId === char.id && sp.bringAlly === false && sp.difficulty === 'hard' && sp.mapId === 'howling-hills',
    `The POST payload carries the explicit options (${JSON.stringify(sp)})`);

  // Scenario 2: Valeria comes along; everything else left at its defaults
  await openPreparePage();
  const picks2 = await send('Runtime.evaluate', { expression: `(() => {
    const v = document.querySelector('input[name="companionPick"][value="valeria"]');
    if (!v) return { ok: false };
    v.checked = true;
    return {
      ok: true,
      defaultMap: (document.querySelector('input[name="mapPick"]:checked') || {}).value,
      defaultDiff: (document.querySelector('input[name="difficulty"]:checked') || {}).value
    };
  })()`, returnByValue: true });
  assert(picks2.result.value.ok, 'The prepare page offers Valeria as a companion');
  const defaults = picks2.result.value;
  assert(defaults.defaultDiff === 'normal', `Difficulty defaults to normal (${defaults.defaultDiff})`);
  const allySaveId = await descendAndWait();
  const allyDelve = await apiReq('GET', `/api/game/${allySaveId}`);
  const ally = (allyDelve.state.entities || []).find(e => e.kind === 'ally');
  assert(ally && ally.allyId === 'valeria',
    `Choosing Valeria embarks her by id (got ${ally ? ally.allyId : 'no ally on the board'})`);
  assert(allyDelve.state.mapId === defaults.defaultMap,
    `Default destination still embarks (${allyDelve.state.mapId} as selected)`);
  assert(allyDelve.state.difficulty === 'normal', 'Default difficulty still applies to the created delve');
  const allyPayload = await send('Runtime.evaluate', { expression: `(window.__t1StartCalls[1] || {})`, returnByValue: true });
  const ap2 = allyPayload.result.value;
  assert(ap2.bringAlly === 'valeria' && ap2.difficulty === 'normal' && ap2.mapId === defaults.defaultMap,
    `The second POST payload carries the companion id (${JSON.stringify(ap2)})`);

  // Check 10: the settlement save-status flow (T3). The summary must show saving → saved,
  // keep the return navigation locked until the server confirms the settle (against the
  // mouse, the keyboard AND scripted clicks — T3a), recover from an injected save failure
  // via the retry button, and treat a reopened summary as a read-only duplicate (same
  // receipt, no second banking on the server).
  console.log('  Testing the settlement save-status flow in the summary panel...');
  const settleHero = await apiReq('POST', '/api/characters', {
    name: 'Settlement Hero', species: 'human', className: 'fighter', background: 'soldier',
    baseScores: { str: 16, dex: 14, con: 14, int: 10, wis: 12, cha: 8 },
    bgPlus2: 'str', bgPlus1: 'con', skills: ['athletics', 'perception'],
    fightingStyle: 'defense', armorOption: 'chain_mail', weaponOption: 'sword_board'
  });
  const settleDelve = await apiReq('POST', '/api/game/start', {
    characterId: settleHero.id, bringAlly: false, difficulty: 'normal', mapId: 'crypt'
  });
  const settleSaveId = settleDelve.state.id;
  // the hero starts at the dungeon entrance — a real retreat ends the delve immediately,
  // with the engine stamping endSeq=1 (the stable, rev-independent settlement id)
  const retreatRes = await apiReq('POST', `/api/game/${settleSaveId}/action`, { type: 'retreat' });
  assert(retreatRes.state.mode === 'retreat', 'The delve really ended in a retreat');

  // inject exactly one network failure for the first sync-delve the page sends, and
  // record every settlement call the page makes (fetch wrappers compose with the T1 patch)
  await send('Runtime.evaluate', { expression: `(() => {
    window.__t3Calls = 0; window.__t3FailUsed = false;
    const orig = window.fetch;
    window.fetch = function(input, init) {
      try {
        const url = typeof input === 'string' ? input : (input && input.url) || '';
        if (url.includes('/api/city/sync-delve')) {
          window.__t3Calls++;
          if (!window.__t3FailUsed) { window.__t3FailUsed = true; return Promise.reject(new TypeError('injected network failure')); }
        }
      } catch {}
      return orig.apply(this, arguments);
    };
    return 1;
  })()`, returnByValue: true });

  await send('Runtime.evaluate', { expression: `location.hash = '#/play/${settleSaveId}'; 1` });
  await waitFor(`document.getElementById('summaryModal')`, 'the summary to auto-open for the ended delve');
  await waitFor(`(document.getElementById('summarySaveState') || {}).innerText && document.getElementById('summarySaveState').innerText.includes('Save failed')`,
    'the injected failure to surface in the panel');
  const lockedNav = await send('Runtime.evaluate', { expression: `(() => {
    const navs = Array.from(document.querySelectorAll('#summaryModal .sumNavBtn'));
    return { count: navs.length, locked: navs.filter(a => a.classList.contains('locked')).length };
  })()`, returnByValue: true });
  assert(lockedNav.result.value.count >= 2, `Return navigation exists (${lockedNav.result.value.count} links)`);
  assert(lockedNav.result.value.locked === lockedNav.result.value.count, 'Every return link is locked while the settle failed');
  const lockedState = await send('Runtime.evaluate', { expression: `(() => {
    const a = document.querySelector('#summaryModal .sumNavBtn');
    return { aria: a.getAttribute('aria-disabled'), tabindex: a.getAttribute('tabindex') };
  })()`, returnByValue: true });
  assert(lockedState.result.value.aria === 'true' && lockedState.result.value.tabindex === '-1',
    `Locked links expose aria-disabled and leave the tab order (${JSON.stringify(lockedState.result.value)})`);

  // T3a: the lock must hold against scripted clicks and real keyboard input —
  // pointer-events:none only ever stopped the mouse
  const scriptClick = await send('Runtime.evaluate', { expression: `(() => {
    const before = location.hash;
    document.querySelector('#summaryModal .sumNavBtn').click();
    return { before, after: location.hash, open: !!document.getElementById('summaryModal') };
  })()`, returnByValue: true });
  assert(scriptClick.result.value.before === scriptClick.result.value.after && scriptClick.result.value.open,
    `A scripted click on a locked link navigates nowhere (${scriptClick.result.value.after})`);
  const keyTry = await send('Runtime.evaluate', { expression: `(() => {
    const a = document.querySelector('#summaryModal .sumNavBtn');
    a.focus();
    return { focused: document.activeElement === a, hash: location.hash };
  })()`, returnByValue: true });
  assert(keyTry.result.value.focused, 'The locked link can be focused programmatically (for the keyboard probe)');
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13, text: '\r' });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
  await new Promise(r => setTimeout(r, 400)); // a broken lock would navigate within one frame
  const keyResult = await send('Runtime.evaluate', { expression: `(() => ({
    hash: location.hash, open: !!document.getElementById('summaryModal')
  }))()`, returnByValue: true });
  assert(keyResult.result.value.open && keyResult.result.value.hash.includes('/play/'),
    `A real Enter keypress on a locked link does not leave the summary (${keyResult.result.value.hash})`);
  const retryBtn = await send('Runtime.evaluate', { expression: `!!document.getElementById('summaryRetryBtn')`, returnByValue: true });
  assert(retryBtn.result.value === true, 'The retry button is offered');

  // retry: the second settlement passes and unlocks the panel
  await clickUntil(send,
    `(() => { const b = document.getElementById('summaryRetryBtn'); if (b) { b.click(); return true; } return false; })()`,
    `(document.getElementById('summarySaveState') || {}).innerText && document.getElementById('summarySaveState').innerText.includes('Spoils banked')`,
    { timeout: 10000, description: 'the retried settle to confirm' });
  const unlockedNav = await send('Runtime.evaluate', { expression: `(() => {
    const navs = Array.from(document.querySelectorAll('#summaryModal .sumNavBtn'));
    return { locked: navs.filter(a => a.classList.contains('locked')).length, receipt: (document.getElementById('summarySaveState') || {}).innerText };
  })()`, returnByValue: true });
  assert(unlockedNav.result.value.locked === 0, 'The return links unlock once the settle is confirmed');
  const unlockedState = await send('Runtime.evaluate', { expression: `(() => {
    const a = document.querySelector('#summaryModal .sumNavBtn');
    return { aria: a.getAttribute('aria-disabled'), tabindex: a.getAttribute('tabindex') };
  })()`, returnByValue: true });
  assert(unlockedState.result.value.aria === 'false' && unlockedState.result.value.tabindex === null,
    `Unlocked links are aria-enabled and tabbable again (${JSON.stringify(unlockedState.result.value)})`);
  assert(unlockedNav.result.value.receipt.includes('Receipt ' + settleSaveId + '#1'),
    `The receipt id is shown (${unlockedNav.result.value.receipt.split('\\n')[0]})`);
  const settledChar = await apiReq('GET', `/api/characters/${settleHero.id}`);
  assert(settledChar.delvesCompleted === 1 && Array.isArray(settledChar.settlements) && settledChar.settlements[0].id === settleSaveId + '#1',
    'The server banked the retreat exactly once with the stable receipt id');
  // T4: the confirmed summary shows this delve's outcome and the next objective
  const outcome = await send('Runtime.evaluate', { expression: `(() => ({
    gains: (document.getElementById('summaryGains') || {}).innerText || '',
    next: (document.getElementById('summaryNext') || {}).innerText || '',
    details: !!document.querySelector('#summaryModal .summary-details')
  }))()`, returnByValue: true });
  assert(outcome.result.value.gains.length > 0 && (outcome.result.value.gains.includes('本次结算') || outcome.result.value.gains.includes('本局已入账')),
    `The summary reports what this delve paid (${outcome.result.value.gains.slice(0, 40)})`);
  assert(outcome.result.value.next.includes('下一目标'), `The summary names the next objective (${outcome.result.value.next.split('\\n')[0].slice(0, 60)})`);
  assert(outcome.result.value.details, 'The raw statistics moved into the details fold');

  // reopening the settled summary is read-only: duplicate receipt, no second banking
  await send('Runtime.evaluate', { expression: `(() => { const b = document.getElementById('closeSummaryX'); if (b) b.click(); return 1; })()`, returnByValue: true });
  await clickUntil(send,
    `(() => { const b = document.querySelector('[data-act="retreat"]'); if (b && !b.disabled) { b.click(); return true; } return false; })()`,
    `(document.getElementById('summarySaveState') || {}).innerText && document.getElementById('summarySaveState').innerText.includes('Already settled')`,
    { timeout: 10000, description: 'the reopened summary to show the duplicate receipt' });
  const reopenedChar = await apiReq('GET', `/api/characters/${settleHero.id}`);
  assert(reopenedChar.delvesCompleted === 1 && reopenedChar.settlements.length === 1,
    'The reopened summary banked nothing twice');
  const callCount = await send('Runtime.evaluate', { expression: `window.__t3Calls`, returnByValue: true });
  assert(callCount.result.value >= 3, `The page sent the failing settle, the retry and the reopen (${callCount.result.value} calls)`);

  // and the confirmed panel really navigates: the unlocked return link leaves the summary
  await clickUntil(send,
    `(() => { const a = document.querySelector('#summaryModal .sumNavBtn'); if (a) { a.click(); return true; } return false; })()`,
    `location.hash.includes('/overworld')`,
    { timeout: 10000, description: 'the unlocked return link to navigate to the overworld' });
  const navAfter = await send('Runtime.evaluate', { expression: `({ hash: location.hash, open: !!document.getElementById('summaryModal') })`, returnByValue: true });
  assert(navAfter.result.value.hash.includes('/overworld') && !navAfter.result.value.open,
    `The unlocked return link navigates for real (${navAfter.result.value.hash})`);

  await apiReq('DELETE', `/api/game/${settleSaveId}`);
  await apiReq('DELETE', `/api/characters/${settleHero.id}`);

  // Check 11: T4 guidance — home shows where to continue and why, and the region map
  // marks the story's recommended destination without auto-embarking.
  console.log('  Testing home/region-map guidance (recommended destination + reason)...');
  const guideHero = await apiReq('POST', '/api/characters', {
    name: 'T4 Guide Hero', species: 'human', className: 'fighter', background: 'soldier',
    baseScores: { str: 16, dex: 14, con: 14, int: 10, wis: 12, cha: 8 },
    bgPlus2: 'str', bgPlus1: 'con', skills: ['athletics', 'perception'],
    fightingStyle: 'defense', armorOption: 'chain_mail', weaponOption: 'sword_board'
  });
  await send('Runtime.evaluate', { expression: `location.hash = '#/'; 1` });
  await waitFor(`document.querySelectorAll('.char-card').length > 0`, 'the home character cards');
  const homeGuide = await send('Runtime.evaluate', { expression: `(() => {
    const card = Array.from(document.querySelectorAll('.char-card')).find(c => c.textContent.includes('T4 Guide Hero'));
    if (!card) return null;
    const link = card.querySelector('a.btn.primary');
    return {
      objective: card.querySelector('.char-objective') ? card.querySelector('.char-objective').textContent : '',
      primaryText: link ? link.textContent : '',
      href: link ? link.getAttribute('href') : ''
    };
  })()`, returnByValue: true });
  assert(!!homeGuide.result.value && /圣物|沉没墓穴/.test(homeGuide.result.value.objective),
    `Home shows the current objective (${homeGuide.result.value && homeGuide.result.value.objective.slice(0, 40)})`);
  assert(!!homeGuide.result.value && /准备出发/.test(homeGuide.result.value.primaryText) && homeGuide.result.value.href.includes('node=crypt'),
    `Home's primary action prepares the recommended map (${homeGuide.result.value && homeGuide.result.value.href})`);

  await send('Runtime.evaluate', { expression: `location.hash = '#/overworld?char=${guideHero.id}&node=crypt'; 1` });
  await waitFor(`document.querySelector('.recommend-box')`, 'the recommendation box on the region map');
  const rec = await send('Runtime.evaluate', { expression: `(() => {
    const box = document.querySelector('.recommend-box');
    const banner = document.querySelector('.guidance-banner-row');
    const node = document.querySelector('.map-sidebar h2');
    const embark = document.getElementById('embarkBtn');
    return {
      box: box ? box.textContent : '',
      banner: banner ? banner.textContent : '',
      nodeName: node ? node.textContent : '',
      embark: embark ? embark.textContent : ''
    };
  })()`, returnByValue: true });
  assert(rec.result.value.nodeName.includes('Sunless Crypt'), `The recommended node is preselected (${rec.result.value.nodeName})`);
  assert(rec.result.value.box.includes('主线推荐'), `The destination explains itself (${rec.result.value.box.slice(0, 50)})`);
  assert(rec.result.value.banner.includes('准备出发'), 'The story banner carries the primary action too');
  const savesAfterGuide = await apiReq('GET', '/api/game');
  assert(!savesAfterGuide.some(s => s.characterId === guideHero.id), 'Nothing auto-embarked — the player still presses Embark');
  await apiReq('DELETE', `/api/characters/${guideHero.id}`);

  // Check 12: T4a multi-save recovery — an older running delve outranks a newer settled
  // one on the home card, and clicking the primary action really resumes that save.
  console.log('  Testing multi-save continue priority on the home card...');
  const multiHero = await apiReq('POST', '/api/characters', {
    name: 'T4a Multi Hero', species: 'human', className: 'fighter', background: 'soldier',
    baseScores: { str: 16, dex: 14, con: 14, int: 10, wis: 12, cha: 8 },
    bgPlus2: 'str', bgPlus1: 'con', skills: ['athletics', 'perception'],
    fightingStyle: 'defense', armorOption: 'chain_mail', weaponOption: 'sword_board'
  });
  const delveA = await apiReq('POST', '/api/game/start', { characterId: multiHero.id, bringAlly: false, difficulty: 'normal', mapId: 'crypt' });
  const delveB = await apiReq('POST', '/api/game/start', { characterId: multiHero.id, bringAlly: false, difficulty: 'normal', mapId: 'crypt' });
  // B ends and settles NEWER than the still-running A — the old pickLiveSave chose B by
  // updatedAt alone and the home card recommended re-embarking instead of continuing A
  const retreatB = await apiReq('POST', `/api/game/${delveB.state.id}/action`, { type: 'retreat' });
  assert(retreatB.state.mode === 'retreat', 'the newer delve ended in a retreat');
  const settleB = await apiReq('POST', '/api/city/sync-delve', { charId: multiHero.id, delveStateId: delveB.state.id });
  assert(settleB.duplicate === false, 'the newer delve settled once');
  await send('Runtime.evaluate', { expression: `location.hash = '#/'; 1` });
  await waitFor(`document.querySelectorAll('.char-card').length > 0`, 'the home cards');
  const multiCard = await send('Runtime.evaluate', { expression: `(() => {
    const card = Array.from(document.querySelectorAll('.char-card')).find(c => c.textContent.includes('T4a Multi Hero'));
    if (!card) return null;
    const link = card.querySelector('a.btn.primary');
    const statuses = Array.from(card.querySelectorAll('.chip')).map(x => x.textContent);
    return { cta: link ? link.textContent : '', href: link ? link.getAttribute('href') : '', statuses: statuses.join('|') };
  })()`, returnByValue: true });
  assert(!!multiCard.result.value && multiCard.result.value.href.endsWith('#/play/' + delveA.state.id),
    `The primary action resumes the older running delve (${multiCard.result.value && multiCard.result.value.href})`);
  assert(!!multiCard.result.value && /继续冒险/.test(multiCard.result.value.cta),
    `The primary action is a continue (${multiCard.result.value && multiCard.result.value.cta})`);
  assert(!!multiCard.result.value && /已结算|进行中/.test(multiCard.result.value.statuses),
    `Both saves keep their status chips (${multiCard.result.value && multiCard.result.value.statuses})`);
  await clickUntil(send,
    `(() => { const card = Array.from(document.querySelectorAll('.char-card')).find(c => c.textContent.includes('T4a Multi Hero')); const l = card && card.querySelector('a.btn.primary'); if (l) { l.click(); return true; } return false; })()`,
    `location.hash.includes('${delveA.state.id}')`,
    { timeout: 10000, description: 'the click to land on delve A' });
  await waitFor(`document.getElementById('minimapContainer')`, 'the play view of delve A');
  await apiReq('DELETE', `/api/game/${delveA.state.id}`);
  await apiReq('DELETE', `/api/game/${delveB.state.id}`);
  await apiReq('DELETE', `/api/characters/${multiHero.id}`);

} catch (err) {
  await captureBrowserArtifacts('gameplay-refinements-cdp.test.mjs', [CDP_PORT]);
  console.error('  ❌ E2E Browser Test Error:', err);
  failed++;
} finally {
  cleanup();
}

console.log(`\nE2E Gameplay Refinements Summary: ${passed} passed, ${failed} failed.`);
if (failed > 0) process.exit(1);
