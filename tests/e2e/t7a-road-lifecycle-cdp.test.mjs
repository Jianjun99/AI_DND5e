// tests/e2e/t7a-road-lifecycle-cdp.test.mjs — T7a road-encounter lifecycle & check
// previews, driven through the REAL UI (real clicks, real fetch, private browser):
//   1. expertise preview: the chest modal shows the server's preview number (incl.
//      expertise) and the resolved event carries exactly that modifier
//   2. embark → encounter modal: a double click fires ONE trigger and shows ONE live
//      instance; the instanceId matches the server's
//   3. refresh recovery: an unresolved AND a resolved-but-unstarted instance both restore
//      on the prepare page (status, never a re-roll), and resolving once applies boons once
//   4. resolve failure: an injected failure surfaces as an error with the options live
//      again for an explicit retry; the retry then resolves exactly once (no double award)
//   5. late response: a hero switch while the trigger is in flight starts nothing for the
//      old hero and opens no modal
// Network conditions are simulated in-page by wrapping window.fetch (delay / one-shot
// failure) — the server and the app code are untouched.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { browserBinary, softwareWebGLFlags, requireWebGL, captureBrowserArtifacts } from './_browser-runtime.mjs';

const BASE_URL = process.env.BASE_URL || (process.env.PORT ? `http://localhost:${process.env.PORT}` : 'http://localhost:3000');
const CDP_PORT = 9228;

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

console.log('\n--- Running E2E Test: T7a Road Lifecycle & Check Previews ---');
const browserBin = findBrowserBinary();

const PROFILE_MARKER = path.join(os.tmpdir(), 'ai-dnd-e2e-9228');
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
  ...softwareWebGLFlags(), '--no-sandbox', '--disable-dev-shm-usage',
  '--no-first-run', '--no-default-browser-check',
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
  throw new Error('CDP target timed out (port 9228, profile ai-dnd-e2e-9228).');
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
    if (msg.error) reject(msg.error); else resolve(msg.result);
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
    try {
      spawnSync('powershell', ['-NoProfile', '-Command',
        `Get-CimInstance Win32_Process -Filter "Name='msedge.exe'" | Where-Object { $_.CommandLine -like '*${PROFILE_MARKER}*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`],
        { stdio: 'ignore' });
    } catch {}
  }
  try { browserProc.kill('SIGKILL'); } catch {}
}

const createdChars = [];
const createdSaves = [];
let failedFast = false;

try {
  await send('Page.enable');
  await send('Runtime.enable');
  await requireWebGL(send);
  // collect uncaught page errors for the diagnostics below
  await evalValue(`(function(){ window.__errs = []; window.addEventListener('error', function(e){ window.__errs.push(String(e.message)); }); return 1; })()`);
  // cold-profile first visit: the service worker claims the page shortly after load, and
  // navigating before that settle races the router (pre-existing first-visit quirk — the
  // other e2e suites avoid it by waiting for the initial view). Wait for the home view.
  assert(await waitFor(`document.getElementById('quickStartCard') || document.querySelector('.char-card')`, 'the home view to boot'), 'home view booted before any navigation');

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
  async function clickTile(x, y) {
    await evalValue(`(function(){ var c = document.getElementById('mapCanvas'); if (!c) return 0; var rect = c.getBoundingClientRect(); var sx = rect.width / c.width, sy = rect.height / c.height; c.dispatchEvent(new MouseEvent('click', { clientX: rect.left + (${x} * 34 + 17) * sx, clientY: rect.top + (${y} * 34 + 17) * sy, bubbles: true })); return 1; })()`);
  }
  // in-page fetch patch helpers (test-only conditions; app code untouched)
  async function patchFetch(mode) {
    // mode: { failNextTrigger, failNextResolve, failNextStart }
    // T7a review fix: the wrapper calls the original fetch EXACTLY ONCE per invocation
    // (the old version sent the request twice when rewriting the trigger body), so the
    // in-page triggerCalls counter now equals the real HTTP request count.
    await evalValue(`(function(){
      window.__t7aPatch = window.__t7aPatch || (() => {
        const orig = window.fetch;
        window.__t7aState = { triggerCalls: 0, resolveCalls: 0, startCalls: 0 };
        window.fetch = function(input, init) {
          const st = window.__t7aState;
          const url = typeof input === 'string' ? input : (input && input.url) || '';
          const isTrigger = url.includes('/road-encounter') && init && typeof init.body === 'string' && init.body.indexOf('"action":"trigger"') >= 0;
          const isResolve = url.includes('/road-encounter') && init && typeof init.body === 'string' && init.body.indexOf('"choice"') >= 0;
          const isStart = url.includes('/api/game/start');
          let args = arguments;
          if (isTrigger) {
            st.triggerCalls++;
            if (init && typeof init.body === 'string' && init.body.indexOf('"force"') < 0) {
              // deterministic test hook: force the 35% gate inside the request body
              const rewritten = Object.assign({}, init, { body: init.body.replace(/}$/, ',"force":true}') });
              args = [input, rewritten];
            }
            if (st.failNextTrigger) { st.failNextTrigger = false; return Promise.reject(new TypeError('injected trigger failure')); }
            if (st.holdTrigger) {
              // hold the request until the test releases it (late-response scenarios)
              return new Promise(resolve => { window.__t7aReleaseTrigger = () => { window.__t7aReleaseTrigger = null; resolve(orig.apply(this, args)); }; });
            }
          }
          if (isStart) {
            st.startCalls++;
            if (st.failNextStart) { st.failNextStart = false; return Promise.reject(new TypeError('injected start failure')); }
          }
          if (isResolve && st.failNextResolve) { st.failNextResolve = false; return Promise.reject(new TypeError('injected resolve failure')); }
          if (isResolve) st.resolveCalls++;
          return orig.apply(this, args);
        };
        return 1;
      })();
      window.__t7aState.failNextTrigger = !!(${!!(mode && mode.failNextTrigger)});
      window.__t7aState.failNextResolve = !!(${!!(mode && mode.failNextResolve)});
      window.__t7aState.failNextStart = !!(${!!(mode && mode.failNextStart)});
      window.__t7aState.holdTrigger = !!(${!!(mode && mode.holdTrigger)});
      return 1;
    })()`);
  }

  // ---------------- Check 1: expertise preview + resolve modifier parity ----------------
  console.log('  Check 1: expertise preview shows the server number and matches the resolve event');
  const rogue = await apiReq('POST', '/api/characters', {
    name: 'Preview Rogue', species: 'human', className: 'rogue', background: 'criminal',
    baseScores: { str: 12, dex: 18, con: 13, int: 10, wis: 12, cha: 10 },
    bgPlus2: 'dex', bgPlus1: 'con', skills: ['sleight_of_hand', 'acrobatics'],
    armorOption: 'leather', weaponOption: 'short_dagger'
  });
  createdChars.push(rogue.id);
  const rogueDelve = await apiReq('POST', '/api/game/start', { characterId: rogue.id, bringAlly: false, difficulty: 'easy', mapId: 'crypt' });
  createdSaves.push(rogueDelve.state.id);
  // fixture: stand next to the crypt's locked chest (30,2) — placement only, no flags touched.
  // The suite needs the server's DATA_DIR (npm run verify always provides it).
  const check1Done = !!process.env.DATA_DIR;
  if (!check1Done) {
    console.log('⚠️ DATA_DIR not set — cannot stage the chest placement; skipping Check 1.');
  }
  if (check1Done) {
    const f = path.join(process.env.DATA_DIR, 'saves', rogueDelve.state.id + '.json');
    const s = JSON.parse(fs.readFileSync(f, 'utf8'));
    const pl = s.entities.find(e => e.kind === 'player');
    pl.x = 29; pl.y = 2;
    s.rev = (s.rev || 0) + 1;
    fs.writeFileSync(f, JSON.stringify(s, null, 1));
  }
  if (check1Done) {
    await evalValue(`location.hash = '#/play/${rogueDelve.state.id}'; 1`);
    const mounted = await waitFor(`document.getElementById('minimapContainer')`, 'the delve view');
    if (!mounted) {
      // diagnostics: what is actually on the page when the mount times out?
      const diag = await evalValue(`(function(){
        window.__errs = window.__errs || [];
        return JSON.stringify({ hash: location.hash, minimap: !!document.getElementById('minimapContainer'), body: document.body.textContent.slice(0, 220).replace(/\\s+/g, ' '), errs: window.__errs.slice(0, 4) });
      })()`, { awaitPromise: true });
      console.log('  (mount diagnostics: ' + diag + ')');
    }
    assert(mounted, 'delve view mounts for the rogue');
    await new Promise(r => setTimeout(r, 800));
    await clickTile(30, 2);
    assert(await waitFor(`document.getElementById('skillCheckModal')`, 'the skill-check modal'), 'chest modal opens');
    assert(await waitFor(`(document.getElementById('btnPick') || {}).textContent && document.getElementById('btnPick').textContent.indexOf('+9') >= 0`, 'the preview to load'), 'Pick Lock button shows the SERVER preview +9 (DEX 20 +5, PB 2, expertise +2)');
    const dcBadge = await evalValue(`(function(){ var m = document.getElementById('skillCheckModal'); return m ? (m.textContent.match(/DC 12/) ? 'DC 12' : 'no-dc') : 'no-modal'; })()`);
    assert(dcBadge === 'DC 12', 'preview DC comes from the object (DC 12)');
    await evalValue(`(function(){ var b = document.getElementById('btnPick'); if (b) b.click(); return 1; })()`);
    assert(await waitFor(`(function(){ var el = document.getElementById('logEntries'); return el && el.textContent.indexOf('picks the tumbler lock') >= 0; })()`, 'the pick to resolve'), 'Pick Lock resolves through the server');
    const pickLog = await evalValue(`(function(){ return fetch('/api/game/${rogueDelve.state.id}').then(function(r){ return r.json(); }).then(function(d){ var lines = d.state.log.filter(function(l){ return l.text.indexOf('picks the tumbler lock') >= 0; }); return lines[lines.length - 1].text; }); })()`, { awaitPromise: true });
    assert(pickLog.indexOf('+9') >= 0, `the resolved log carries the same +9 modifier (${pickLog.slice(0, 80)})`);
  }
  await evalValue(`fetch('/api/game/${rogueDelve.state.id}', { method: 'DELETE' }); 1`);

  // T7a deterministic setup: the live instance is authoritative, so an unwanted type must
  // be cheap-resolved and consumed (throwaway start) before the next trigger can roll.
  async function ensureEncounterType(heroId, wanted) {
    for (let i = 0; i < 12; i++) {
      const t = await apiReq('POST', `/api/characters/${heroId}/road-encounter`, { action: 'trigger', force: true });
      const enc = t.encounter;
      if (enc && enc.id === wanted && !enc.resolved) return enc;
      if (enc && !enc.resolved) {
        const cheap = enc.id === 'peddler' ? 'leave' : enc.id === 'shrine' ? 'proceed' : 'fight';
        await apiReq('POST', `/api/characters/${heroId}/road-encounter`, { choice: cheap, encounterId: enc.instanceId });
      }
      const d = await apiReq('POST', '/api/game/start', { characterId: heroId, bringAlly: false, mapId: 'crypt', difficulty: 'normal' });
      await apiReq('DELETE', `/api/game/${d.state.id}`);
    }
    throw new Error('never rolled a ' + wanted + ' encounter');
  }

  // ---------------- Check 2: embark → ONE trigger, ONE live instance, refresh restore ----------------
  console.log('  Check 2: embark shows one live instance; refresh restores unresolved then resolved');
  const heroA = await apiReq('POST', '/api/characters', { presetId: 'guardian' });
  createdChars.push(heroA.id);
  await patchFetch({});
  await ensureEncounterType(heroA.id, 'shrine');
  await evalValue(`location.hash = '#/overworld?char=${heroA.id}&node=crypt'; 1`);
  assert(await waitFor(`document.getElementById('embarkBtn')`, 'the prepare page'), 'prepare page mounts for hero A');
  // double click: the guard must hold the second click → exactly one trigger request
  await evalValue(`(function(){ var b = document.getElementById('embarkBtn'); b.click(); b.click(); return 1; })()`);
  assert(await waitFor(`document.getElementById('roadEncounterModal')`, 'the encounter modal'), 'encounter modal opens on embark');
  await new Promise(r => setTimeout(r, 900)); // let any second request land if the guard leaked
  const triggerCount = await evalValue(`window.__t7aState.triggerCalls`);
  assert(triggerCount === 1, `double click fired exactly ONE trigger (got ${triggerCount})`);
  const serverInst = await evalValue(`(function(){ return fetch('/api/characters/${heroA.id}/road-encounter', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'status' }) }).then(function(r){ return r.json(); }).then(function(d){ return d.currentRoadEncounter ? d.currentRoadEncounter.instanceId : 'none'; }); })()`, { awaitPromise: true });
  assert(serverInst !== 'none', 'server holds a live instance');

  // resolve through the UI (whatever kind rolled: pick the first option button)
  const optBtn = await evalValue(`(function(){ var m = document.getElementById('roadEncounterModal'); var bs = m ? m.querySelectorAll('.encounter-option-btn') : []; return bs.length ? bs[0].id : 'none'; })()`);
  assert(optBtn !== 'none', 'encounter offers options');
  await evalValue(`document.getElementById('${optBtn}').click(); 1`);
  assert(await waitFor(`document.getElementById('continueDelveBtn')`, 'the resolved continue button'), 'resolve lands and the continue entry appears');
  // refresh BEFORE starting: the resolved instance must restore (no re-roll, no award)
  await send('Page.reload', {});
  await patchFetch({});
  assert(await waitFor(`document.getElementById('roadEncounterModal')`, 'the restored modal after refresh'), 'refresh restores the encounter modal (resolved result)');
  const restoredResolved = await evalValue(`(function(){ var m = document.getElementById('roadEncounterModal'); if (!m) return 'no'; var t = m.textContent; return (t.indexOf('Enter Delve') >= 0 || t.indexOf('Proceed to Delve') >= 0 || t.indexOf('Bid Farewell') >= 0) ? 'yes' : 'no'; })()`);
  assert(restoredResolved === 'yes', 'restored modal offers the continue entry for the resolved instance');
  const goldBefore = await evalValue(`(function(){ return fetch('/api/characters/${heroA.id}').then(function(r){ return r.json(); }).then(function(c){ return c.gold; }); })()`, { awaitPromise: true });
  // continue → the delve starts, the instance is consumed once
  await evalValue(`(function(){ var b = document.getElementById('continueDelveBtn'); if (b) b.click(); return 1; })()`);
  assert(await waitFor(`document.getElementById('minimapContainer')`, 'the delve to start'), 'continue starts the delve after refresh');
  const afterState = await evalValue(`(function(){ return fetch('/api/characters/${heroA.id}/road-encounter', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'status' }) }).then(function(r){ return r.json(); }).then(function(d){ return d.currentRoadEncounter ? 'still-pending' : 'consumed'; }); })()`, { awaitPromise: true });
  assert(afterState === 'consumed', 'instance consumed by the real start');
  const goldAfter = await evalValue(`(function(){ return fetch('/api/characters/${heroA.id}').then(function(r){ return r.json(); }).then(function(c){ return c.gold; }); })()`, { awaitPromise: true });
  assert(goldAfter === goldBefore || goldAfter === goldBefore - 10 || goldAfter === goldBefore - 5, `gold changed only by the chosen option (before ${goldBefore}, after ${goldAfter})`);
  const heroADelve = (await apiReq('GET', '/api/game')).filter(s => s.characterId === heroA.id && s.mode === 'explore');
  assert(heroADelve.length === 1, 'exactly one delve was created for hero A');
  createdSaves.push(heroADelve[0].id);
  await apiReq('DELETE', `/api/game/${heroADelve[0].id}`);

  // ---------------- Check 3: resolve failure → explicit retry, single award ----------------
  console.log('  Check 3: resolve failure surfaces and retries without double awards');
  await ensureEncounterType(heroA.id, 'ambush');
  await evalValue(`location.hash = '#/overworld?char=${heroA.id}&node=crypt'; 1`);
  assert(await waitFor(`document.getElementById('embarkBtn')`, 'the prepare page again'), 'prepare page mounts again');
  await patchFetch({});
  await evalValue(`(function(){ document.getElementById('embarkBtn').click(); return 1; })()`);
  assert(await waitFor(`document.getElementById('roadEncounterModal')`, 'the encounter modal again'), 'encounter modal opens');
  // fail the first resolve attempt, then let the retry through.
  // The staged encounter is an ambush: option[1] = Bribe (deterministic −10 GP) so the
  // award assertions are exact regardless of dice.
  await patchFetch({ failNextResolve: true });
  const optId2 = await evalValue(`(function(){ var m = document.getElementById('roadEncounterModal'); var bs = m.querySelectorAll('.encounter-option-btn'); return bs.length > 1 ? bs[1].id : 'none'; })()`);
  assert(optId2 !== 'none', 'ambush offers the bribe option');
  const goldB3 = await evalValue(`(function(){ return fetch('/api/characters/${heroA.id}').then(function(r){ return r.json(); }).then(function(c){ return c.gold; }); })()`, { awaitPromise: true });
  await evalValue(`document.getElementById('${optId2}').click(); 1`);
  await new Promise(r => setTimeout(r, 1200));
  const failedShown = await evalValue(`(function(){ var m = document.getElementById('roadEncounterModal'); return m && m.textContent.indexOf('injected resolve failure') >= 0 ? 'yes' : 'no'; })()`);
  assert(failedShown === 'yes', 'the resolve failure is surfaced in the modal');
  const optionsLive = await evalValue(`(function(){ var m = document.getElementById('roadEncounterModal'); var bs = m.querySelectorAll('.encounter-option-btn'); return bs.length && Array.prototype.every.call(bs, function(b){ return !b.disabled; }) ? 'live' : 'stuck'; })()`);
  assert(optionsLive === 'live', 'options are live again for an explicit retry');
  const goldMid = await evalValue(`(function(){ return fetch('/api/characters/${heroA.id}').then(function(r){ return r.json(); }).then(function(c){ return c.gold; }); })()`, { awaitPromise: true });
  // the injected failure is a LOST RESPONSE: the server may or may not have processed the
  // bribe already. Either way the retry (same choice → alreadyResolved) must not charge again.
  assert(goldMid === goldB3 || goldMid === goldB3 - 10, `lost-response resolve charged at most once (before ${goldB3}, after ${goldMid})`);
  // retry (no failure injected) — the same choice resolves idempotently, one award total
  await evalValue(`(function(){ var m = document.getElementById('roadEncounterModal'); var bs = m.querySelectorAll('.encounter-option-btn'); bs[1].click(); return 1; })()`);
  assert(await waitFor(`document.getElementById('continueDelveBtn')`, 'the retry to resolve'), 'the retry resolves');
  const goldA3 = await evalValue(`(function(){ return fetch('/api/characters/${heroA.id}').then(function(r){ return r.json(); }).then(function(c){ return c.gold; }); })()`, { awaitPromise: true });
  assert(goldA3 === goldB3 - 10, `exactly one bribe applied across the lost response + retry (before ${goldB3}, after ${goldA3})`);
  await evalValue(`(function(){ var b = document.getElementById('continueDelveBtn'); if (b) b.click(); return 1; })()`);
  assert(await waitFor(`document.getElementById('minimapContainer')`, 'the delve to start after retry'), 'delve starts after the retried resolve');
  const delve2 = (await apiReq('GET', '/api/game')).filter(s => s.characterId === heroA.id && s.mode === 'explore');
  createdSaves.push(delve2[0].id);
  await apiReq('DELETE', `/api/game/${delve2[0].id}`);

  // ---------------- Check 4: late trigger response after a hero switch starts nothing ----------------
  console.log('  Check 4: late trigger response after a hero switch starts nothing');
  const heroB = await apiReq('POST', '/api/characters', { presetId: 'arcane' });
  createdChars.push(heroB.id);
  await evalValue(`location.hash = '#/overworld?char=${heroA.id}&node=crypt'; 1`);
  assert(await waitFor(`document.getElementById('embarkBtn')`, 'the prepare page for the late-response check'), 'prepare page mounts');
  await patchFetch({ holdTrigger: true });
  const savesBeforeLate = (await apiReq('GET', '/api/game')).filter(s => s.characterId === heroA.id).length;
  await evalValue(`(function(){ document.getElementById('embarkBtn').click(); return 1; })()`);
  await new Promise(r => setTimeout(r, 600)); // the trigger is now held mid-flight
  // switch the active hero while the trigger is held (re-render; activeChar changes)
  await evalValue(`(function(){ var sel = document.getElementById('charSwitcher'); if (!sel) return 0; sel.value = '${heroB.id}'; sel.dispatchEvent(new Event('change', { bubbles: true })); return 1; })()`);
  await new Promise(r => setTimeout(r, 600));
  // release the held response — it arrives AFTER the hero switched and must be dropped
  await evalValue(`(function(){ if (window.__t7aReleaseTrigger) { window.__t7aReleaseTrigger(); return 'released'; } return 'nothing-held'; })()`);
  await new Promise(r => setTimeout(r, 1500));
  const noModal = await evalValue(`String(!document.getElementById('roadEncounterModal'))`);
  assert(noModal === 'true', 'no stale encounter modal opens for the old hero');
  const savesAfterLate = (await apiReq('GET', '/api/game')).filter(s => s.characterId === heroA.id).length;
  assert(savesAfterLate === savesBeforeLate, 'the late trigger response started no delve for the old hero');
  const heroBPending = await evalValue(`(function(){ return fetch('/api/characters/${heroB.id}/road-encounter', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'status' }) }).then(function(r){ return r.json(); }).then(function(d){ return d.currentRoadEncounter ? 'pending' : 'none'; }); })()`, { awaitPromise: true });
  assert(heroBPending === 'none', 'the new hero gained no encounter from the stale flow');

  // ---------------- Check 5: leaving to HOME while the trigger is held invalidates the view ----------------
  console.log('  Check 5: leaving to home invalidates the view; the encounter stays recoverable');
  await evalValue(`location.hash = '#/overworld?char=${heroB.id}&node=crypt'; 1`);
  assert(await waitFor(`document.getElementById('embarkBtn')`, 'the prepare page for hero B'), 'prepare page mounts for hero B');
  await patchFetch({ holdTrigger: true });
  const bSavesBefore = (await apiReq('GET', '/api/game')).filter(s => s.characterId === heroB.id).length;
  await evalValue(`(function(){ document.getElementById('embarkBtn').click(); return 1; })()`);
  await new Promise(r => setTimeout(r, 600)); // trigger held mid-flight
  // leave to the HOME view (same-mount cleanup must invalidate the view identity)
  await evalValue(`location.hash = '#/'; 1`);
  assert(await waitFor(`document.getElementById('quickStartCard') || document.querySelector('.char-card')`, 'the home view to mount'), 'home view mounted');
  // release the held trigger response — the OLD view is dead and must act on nothing
  await evalValue(`(function(){ if (window.__t7aReleaseTrigger) { window.__t7aReleaseTrigger(); return 'released'; } return 'nothing-held'; })()`);
  await new Promise(r => setTimeout(r, 1500));
  const noModalOnHome = await evalValue(`String(!document.getElementById('roadEncounterModal'))`);
  assert(noModalOnHome === 'true', 'no stale encounter modal appears over the home view');
  const bSavesAfter = (await apiReq('GET', '/api/game')).filter(s => s.characterId === heroB.id).length;
  assert(bSavesAfter === bSavesBefore, 'the released trigger started no delve after leaving');
  // the server kept the live instance — the next overworld mount restores it
  const bInst = await evalValue(`(function(){ return fetch('/api/characters/${heroB.id}/road-encounter', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'status' }) }).then(function(r){ return r.json(); }).then(function(d){ return d.currentRoadEncounter && !d.currentRoadEncounter.resolved ? d.currentRoadEncounter.instanceId : 'none'; }); })()`, { awaitPromise: true });
  assert(bInst !== 'none', 'the pending instance survived the navigation for later recovery');
  await evalValue(`location.hash = '#/overworld?char=${heroB.id}&node=crypt'; 1`);
  assert(await waitFor(`document.getElementById('roadEncounterModal')`, 'the restored encounter modal'), 're-entering the overworld restores the pending encounter');
  // resolve it away (free option) and consume, leaving hero B clean for check 6
  const freeOpt = await evalValue(`(function(){ var m = document.getElementById('roadEncounterModal'); var bs = m.querySelectorAll('.encounter-option-btn'); if (!bs.length) return 'none'; bs[0].click(); return bs[0].id; })()`);
  if (freeOpt !== 'none') {
    assert(await waitFor(`document.getElementById('continueDelveBtn')`, 'the resolve after restore'), 'restored instance resolved');
  }
  await evalValue(`(function(){ var b = document.getElementById('continueDelveBtn'); if (b) b.click(); return 1; })()`);
  assert(await waitFor(`document.getElementById('minimapContainer')`, 'the delve to start'), 'delve starts after the restore');
  const delveB = (await apiReq('GET', '/api/game')).filter(s => s.characterId === heroB.id && s.mode === 'explore');
  createdSaves.push(delveB[0].id);
  await apiReq('DELETE', `/api/game/${delveB[0].id}`);

  // ---------------- Check 6: refresh-restored start failure keeps the in-place retry ----------------
  console.log('  Check 6: restored start failure keeps the modal; the retry re-starts without re-resolving');
  await ensureEncounterType(heroB.id, 'shrine');
  await evalValue(`location.hash = '#/overworld?char=${heroB.id}&node=crypt'; 1`);
  assert(await waitFor(`document.getElementById('roadEncounterModal')`, 'the restored unresolved shrine'), 'restore modal shows the pending shrine');
  await evalValue(`(function(){ var b = document.getElementById('optPray'); if (b) b.click(); return 1; })()`);
  assert(await waitFor(`document.getElementById('continueDelveBtn')`, 'the resolved continue entry'), 'pray resolves through the restored modal');
  await send('Page.reload', {});
  await patchFetch({});
  assert(await waitFor(`document.getElementById('roadEncounterModal') && document.getElementById('continueDelveBtn')`, 'the restored resolved modal'), 'refresh restores the resolved result with Enter Delve');
  const resolvesBeforeStart = await evalValue(`(window.__t7aState || {}).resolveCalls || 0`);
  // fail the next start request once (client-visible failure — the app must keep the modal)
  await patchFetch({ failNextStart: true });
  const bSavesBeforeStart = (await apiReq('GET', '/api/game')).filter(s => s.characterId === heroB.id).length;
  await evalValue(`(function(){ var b = document.getElementById('continueDelveBtn'); if (b) b.click(); return 1; })()`);
  await new Promise(r => setTimeout(r, 1500));
  const modalKept = await evalValue(`(function(){ var m = document.getElementById('roadEncounterModal'); var b = document.getElementById('continueDelveBtn'); return m && b && !b.disabled ? 'kept-with-retry' : 'lost'; })()`);
  assert(modalKept === 'kept-with-retry', 'start failure keeps the modal and re-enables the continue button in place');
  const bSavesAfterStart = (await apiReq('GET', '/api/game')).filter(s => s.characterId === heroB.id).length;
  assert(bSavesAfterStart === bSavesBeforeStart, 'the failed start created no delve');
  // un-fail and retry: the delve starts, the boon applies once, and NO new resolve happened
  await patchFetch({});
  await evalValue(`(function(){ var b = document.getElementById('continueDelveBtn'); if (b) b.click(); return 1; })()`);
  assert(await waitFor(`document.getElementById('minimapContainer')`, 'the delve to start after the retry'), 'retry starts the delve');
  const resolvesAfterStart = await evalValue(`(window.__t7aState || {}).resolveCalls || 0`);
  assert(resolvesAfterStart === resolvesBeforeStart, `the retry did not re-resolve (${resolvesBeforeStart} → ${resolvesAfterStart})`);
  const bConsumed = await evalValue(`(function(){ return fetch('/api/characters/${heroB.id}/road-encounter', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'status' }) }).then(function(r){ return r.json(); }).then(function(d){ return d.currentRoadEncounter ? 'pending' : 'consumed'; }); })()`, { awaitPromise: true });
  assert(bConsumed === 'consumed', 'the instance was consumed by the successful start');
  const delveB2 = (await apiReq('GET', '/api/game')).filter(s => s.characterId === heroB.id && s.mode === 'explore');
  assert(delveB2.length === 1, 'exactly one delve exists for hero B');
  // the pray boon lands on the delve player entity — asserted via the state below
  const bState = await evalValue(`(function(){ return fetch('/api/game/${delveB2[0].id}').then(function(r){ return r.json(); }).then(function(d){ var p = d.state.entities.find(function(e){ return e.kind === 'player'; }); return String(p.tempHp); }); })()`, { awaitPromise: true });
  assert(bState === '5', `the pray boon applied exactly once at start (tempHp ${bState})`);
  createdSaves.push(delveB2[0].id);
  await apiReq('DELETE', `/api/game/${delveB2[0].id}`);

  console.log(`\n  T7a lifecycle e2e: ${passed} passed, ${failed} failed`);
} catch (err) {
  await captureBrowserArtifacts('t7a-road-lifecycle-cdp.test.mjs', [CDP_PORT]);
  console.error('  ❌ E2E ERROR:', err.message);
  failed++;
  failedFast = true;
} finally {
  try {
    for (const id of createdSaves) { try { await apiReq('DELETE', `/api/game/${id}`); } catch {} }
    for (const id of createdChars) { try { await apiReq('DELETE', `/api/characters/${id}`); } catch {} }
  } catch {}
  cleanup();
  if (failedFast) process.exit(1);
}
if (failed > 0) process.exit(1);
process.exit(0);
