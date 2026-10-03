// T6: real canvas movement, choice/attack buttons, refresh and town return.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { browserBinary, softwareWebGLFlags, requireWebGL, captureBrowserArtifacts } from './_browser-runtime.mjs';
const BASE = process.env.BASE_URL || 'http://localhost:' + (process.env.PORT || 3000);
const PORT = 9229;
let passed = 0, failed = 0, ws, browser;
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-dnd-t6-cdp-'));
function check(condition, message) { if (!condition) throw new Error(message); passed++; console.log('  PASS: ' + message); }
async function api(method, url, body) {
  const response = await fetch(BASE + url, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await response.json(); if (!response.ok) throw new Error(url + ': ' + JSON.stringify(data)); return data;
}
let sequence = 0;
const pending = new Map();
function send(method, params = {}) {
  const id = ++sequence;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error('CDP timeout: ' + method)); }, 10000);
    pending.set(id, { resolve, reject, timer }); ws.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) {
  const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails)); return result.result.value;
}
async function wait(expression, label) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (await evaluate('!!(' + expression + ')')) return;
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  throw new Error('Timed out: ' + label);
}
async function click(selector) {
  const ok = await evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el || el.disabled) return false; el.click(); return true; })()`);
  check(ok, 'click ' + selector);
}
async function tile(x, y) {
  await evaluate(`(() => { const c = document.getElementById('mapCanvas'), rect = c.getBoundingClientRect(); c.dispatchEvent(new MouseEvent('click', { clientX: rect.left + (${x} * 34 + 17) * rect.width / c.width, clientY: rect.top + (${y} * 34 + 17) * rect.height / c.height, bubbles: true })); })()`);
}
async function canvasAction(id, x, y, predicate) {
  await tile(x, y);
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const s = (await api('GET', '/api/game/' + id)).state;
    if (predicate(s)) { await wait('window.__dndDebug?.rev() >= ' + s.rev, 'canvas action adopted by UI'); return s; }
    await new Promise(r => setTimeout(r, 150));
  }
  throw new Error('Canvas action did not converge: ' + x + ',' + y);
}
async function open(id) {
  await evaluate(`location.hash = '#/play/${id}'; true`);
  await wait("document.querySelector('[data-scene-open]') && document.getElementById('mapCanvas')", 'scene page');
}
async function screenshot(name) { await captureBrowserArtifacts(name, [PORT]); }
const saves = [], chars = [];
try {
  browser = spawn(browserBinary(), ['--headless=new', '--no-sandbox', '--disable-dev-shm-usage', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=' + PORT, '--user-data-dir=' + profile, '--window-size=1280,900', ...softwareWebGLFlags(), BASE + '/#/'], { stdio: 'ignore' });
  let target;
  for (let n = 0; n < 70 && !target; n++) {
    try { target = (await (await fetch('http://127.0.0.1:' + PORT + '/json')).json()).find(t => t.type === 'page'); } catch {}
    if (!target) await new Promise(r => setTimeout(r, 150));
  }
  if (!target) throw new Error('Required Chromium CDP target did not start');
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  ws.onmessage = event => {
    const message = JSON.parse(event.data), entry = pending.get(message.id); if (!entry) return;
    pending.delete(message.id); clearTimeout(entry.timer);
    if (message.error) entry.reject(new Error(message.error.message)); else entry.resolve(message.result);
  };
  await send('Page.enable'); await send('Runtime.enable'); await requireWebGL(send);
  await wait("document.getElementById('quickStartCard') || document.querySelector('.char-card')", 'initial home');
  await evaluate("localStorage.setItem('dnd_default_view','2d'); localStorage.setItem('dnd_3d','off'); true");

  for (const branch of ['show_seal', 'fight']) {
    const char = await api('POST', '/api/characters', { name: 'T6 Browser ' + branch, species: 'human', className: 'fighter', background: 'soldier', baseScores: { str: 16, dex: 14, con: 14, int: 10, wis: 12, cha: 10 }, bgPlus2: 'str', bgPlus1: 'con', skills: ['athletics', 'perception'], fightingStyle: 'defense', armorOption: 'chain_mail', weaponOption: 'sword_board' });
    chars.push(char.id);
    const start = await api('POST', '/api/game/start', { characterId: char.id, mapId: 'vale-gate', bringAlly: false });
    const id = start.state.id; saves.push(id);
    if (branch === 'fight') {
      // Small controlled durability fixture; attacks/turns/XP still use the real engine.
      const file = path.join(process.env.DATA_DIR, 'saves', id + '.json');
      const save = JSON.parse(fs.readFileSync(file, 'utf8'));
      const p = save.entities.find(e => e.kind === 'player'), guard = save.entities.find(e => e.id === 'vale_guard');
      p.hp = p.hpMax = 200; guard.hp = guard.hpMax = 1; guard.ac = 1;
      save.character.attacks.forEach(a => { a.bonus = 30; });
      save.character.attacks.push({ weaponId: 'longbow', name: 'Test Bow', bonus: 30, dmgDice: '1d8', dmgMod: 5, damageType: 'piercing', ranged: true, range: 150 });
      save.rev++; fs.writeFileSync(file, JSON.stringify(save));
    }
    await open(id);
    await canvasAction(id, 5, 3, s => s.entities.find(e => e.kind === 'player').x === 5);
    await tile(5, 2); await wait("document.getElementById('sceneModal')", 'map NPC click opens current server choices');
    check(true, 'clicking the real NPC opens the encounter panel');
    check(await evaluate("document.querySelector('[data-scene-choice=show_seal]').disabled && !document.querySelector('[data-scene-choice=fight]').disabled"), 'missing seal disables peace but leaves combat');
    await click('[data-scene-close]');
    if (branch === 'show_seal') {
      await canvasAction(id, 3, 3, s => s.entities.find(e => e.kind === 'player').x === 3);
      await canvasAction(id, 3, 4, s => s.character.inventory.some(i => i.itemId === 'vale_seal'));
      await canvasAction(id, 5, 3, s => s.entities.find(e => e.kind === 'player').x === 5);
    }
    await click('[data-scene-open]');
    if (branch === 'show_seal') {
      // Network failure must leave an explicit retry, then a double click sends once.
      await evaluate(`(() => { const original = window.fetch; window.__sceneCalls = 0; let fail = true;
        window.fetch = function(input, init) { if (init?.body?.includes('"type":"sceneChoice"')) { if (fail) { fail = false; return Promise.reject(new Error('test network failure')); } window.__sceneCalls++; return original.apply(this, arguments).then(response => new Promise(resolve => { window.__releaseChoice = () => resolve(response); })); } return original.apply(this, arguments); }; })()`);
      await click('[data-scene-choice=show_seal]');
      await wait("document.querySelector('#sceneModal [role=alert]') && !document.querySelector('[data-scene-choice=show_seal]').disabled", 'network error retry');
      await evaluate("document.querySelector('[data-scene-choice=show_seal]').click(); document.querySelector('[data-scene-choice=show_seal]')?.click(); true");
      await wait('window.__releaseChoice', 'held choice response');
      check(await evaluate('window.__sceneCalls === 1'), 'double click sends one successful choice');
      await evaluate("location.hash = '#/'; true"); await wait("!document.getElementById('mapCanvas')", 'leave with choice response pending');
      await evaluate('window.__releaseChoice(); true');
      await new Promise(r => setTimeout(r, 200));
      check(await evaluate("!document.getElementById('sceneModal') && !document.getElementById('sidePanel')"), 'late choice cannot render into the home view');
      await open(id); await click('[data-scene-open]');
      await wait("document.querySelector('[data-scene-memory]')", 'peace result recovered after leaving');
      await screenshot('t6-peace-desktop');
      await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
      check(await evaluate("document.querySelector('#sceneModal .modal').getBoundingClientRect().width <= innerWidth && document.querySelector('#sceneModal .modal').getBoundingClientRect().height <= innerHeight"), 'choice result fits phone viewport');
      await screenshot('t6-peace-phone');
      await send('Emulation.clearDeviceMetricsOverride');
      await click('[data-scene-close]');
    } else {
      await screenshot('t6-combat-options');
      await click('[data-scene-choice=fight]');
      await wait("!document.getElementById('sceneModal') && document.querySelector('[data-act=attack]')", 'combat HUD');
      let state = (await api('GET', '/api/game/' + id)).state;
      check(state.mode === 'combat' && !(state.encounterFacts || []).length, 'combat choice alone grants no completion');
      await wait('window.__dndDebug?.rev() >= ' + state.rev, 'combat start adopted by UI');
      for (let n = 0; n < 20 && state.mode === 'combat'; n++) {
        const guard = state.entities.find(e => e.id === 'vale_guard'); await tile(guard.x, guard.y);
        await wait("document.querySelector('[data-act=attack]') && !document.querySelector('[data-act=attack]').disabled", 'attack available');
        await click('[data-act=attack]');
        await wait("document.querySelector('[data-act=attack]')?.disabled || document.querySelector('[data-scene-open]')?.textContent.includes('记得什么')", 'attack result adopted by UI');
        state = (await api('GET', '/api/game/' + id)).state;
        if (state.mode === 'combat') {
          const rev = state.rev; await click('[data-act=endturn]');
          await wait('window.__dndDebug?.rev() > ' + rev, 'turn result adopted by UI');
          await wait("!document.querySelector('[data-act=attack]')?.disabled", 'next action available');
          state = (await api('GET', '/api/game/' + id)).state;
        }
      }
      check(state.mode === 'explore' && state.encounterFacts[0].fact === 'forced_passage', 'real UI attack resolves combat with force fact');
      await wait("document.querySelector('[data-scene-open]')?.textContent.includes('记得什么')", 'combat result adopted by UI');
      await click('[data-scene-open]'); await wait("document.querySelector('[data-scene-memory]')", 'combat memory');
      check(await evaluate("document.querySelector('[data-scene-memory]').textContent.includes('用武力通过')"), 'combat NPC memory visible');
      await screenshot('t6-combat-result'); await click('[data-scene-close]');
    }
    await send('Page.reload'); await wait("document.querySelector('[data-scene-open]')", 'refresh restore');
    await click('[data-scene-open]');
    check(await evaluate("!document.querySelector('[data-scene-choice]') && !!document.querySelector('[data-scene-memory]')"), 'refresh restores resolved choice without replaying buttons');
    await click('[data-scene-close]');
    await canvasAction(id, 11, 3, s => s.entities.find(e => e.kind === 'player').x === 11);
    await canvasAction(id, 12, 3, s => s.flags.hasRelic);
    await canvasAction(id, 1, 3, s => s.mode === 'victory');
    await wait("document.querySelector('#summaryModal .sumNavBtn[aria-disabled=false]')", 'settlement complete');
    await click('#summaryModal .sumNavBtn'); await wait("location.hash.includes('/overworld') && !document.getElementById('summaryModal')", 'town return');
    const roster = await api('GET', '/api/characters/' + char.id);
    check(roster.encounterFacts?.length === 1, 'town roster retains one confirmed choice');
    await wait("document.querySelector('[data-node-id=vale-gate]')", 'optional adventure visible on region map');
    await evaluate("document.querySelector('[data-node-id=vale-gate]').dispatchEvent(new MouseEvent('click', { bubbles: true })); true");
    await wait("document.getElementById('embarkBtn')?.getAttribute('data-map-id') === 'vale-gate'", 'optional adventure dispatch');
    check(true, 'town map exposes a real departure button for the remembered encounter');
    const again = await api('POST', '/api/game/start', { characterId: char.id, mapId: 'vale-gate', bringAlly: false }); saves.push(again.state.id);
    await open(again.state.id); await click('[data-scene-open]');
    check(await evaluate("document.querySelector('[data-scene-memory]').textContent.includes(" + JSON.stringify(branch === 'show_seal' ? '交回了通行印' : '用武力通过') + ')'), 'next adventure recalls the same branch');
    await click('[data-scene-close]'); await evaluate("location.hash = '#/'; true"); await wait("!document.getElementById('mapCanvas')", 'leave adventure');
  }
} catch (error) {
  failed++; console.error('  FAIL: ' + error.stack);
  await screenshot('t6-failure').catch(e => console.error(e.message));
} finally {
  if (ws?.readyState === 1) await send('Browser.close').catch(() => {});
  ws?.close(); browser?.kill('SIGKILL');
  for (const id of saves) await api('DELETE', '/api/game/' + id).catch(e => console.error(e.message));
  for (const id of chars) await api('DELETE', '/api/characters/' + id).catch(e => console.error(e.message));
  fs.rmSync(profile, { recursive: true, force: true });
}
console.log('T6 CDP: ' + passed + ' assertions passed, ' + failed + ' failed.');
process.exitCode = failed ? 1 : 0;
