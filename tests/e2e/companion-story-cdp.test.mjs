// T12a: the Bram companion story from the real prepare-screen entrance —
// two full routes in both languages, real pointer input, persisted memory.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import presets from '../../server/game/presets.js';
import { assertTestContainer } from '../../scripts/test-container.mjs';
import { browserBinary, softwareWebGLFlags, requireWebGL, captureBrowserArtifacts, closeBrowser } from './_browser-runtime.mjs';
assertTestContainer();
const BASE = process.env.BASE_URL || 'http://localhost:' + (process.env.PORT || 3000), PORT = 9236;
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-dnd-t12a-cdp-')), pending = new Map(), saves = [], chars = [], errors = [], timings = [];
let ws, browser, sequence = 0, passed = 0, failed = 0;
function check(value, message) { if (!value) throw new Error(message); passed++; console.log('  PASS: ' + message); }
function send(method, params = {}) { return new Promise((resolve, reject) => { const id = ++sequence, timer = setTimeout(() => { pending.delete(id); reject(new Error('CDP timeout: ' + method)); }, 20000); pending.set(id, { resolve, reject, timer }); ws.send(JSON.stringify({ id, method, params })); }); }
async function evaluate(expression) { const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails)); return r.result.value; }
async function wait(expression, label) { const until = Date.now() + 20000; while (Date.now() < until) { if (await evaluate('!!(' + expression + ')')) return; await new Promise(r => setTimeout(r, 150)); } throw new Error('Timed out: ' + label); }
async function api(method, url, body) { const r = await fetch(BASE + url, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }), data = await r.json(); if (!r.ok) throw new Error(url + ': ' + JSON.stringify(data)); return data; }
async function pointer(p) { const down = send('Input.dispatchMouseEvent', { type: 'mousePressed', ...p, button: 'left', clickCount: 1 }), up = send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...p, button: 'left', clickCount: 1 }); await Promise.all([down, up]); }
async function click(selector) { const r = await evaluate(`(async()=>{let el=document.querySelector(${JSON.stringify(selector)});if(!el||el.disabled)return {reason:'missing or disabled'};el.scrollIntoView({block:'center'});await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));el=document.querySelector(${JSON.stringify(selector)});if(!el||el.disabled)return {reason:'changed after layout'};const r=el.getBoundingClientRect(),point={x:r.x+r.width/2,y:r.y+r.height/2},hit=document.elementFromPoint(point.x,point.y);return el.contains(hit)?{point}:{reason:'occluded',point,hit:hit?.outerHTML.slice(0,200),connected:el.isConnected,viewport:[innerWidth,innerHeight]};})()`); check(r.point && !r.reason, 'pointer ' + selector + ' ' + (r.reason ? JSON.stringify(r) : '')); await pointer(r.point); }
// The companion map is 20×13 — tile centers derive from the real canvas box.
async function tile(x, y) { const p = await evaluate(`(()=>{const c=document.getElementById('mapCanvas'),r=c.getBoundingClientRect();return {x:r.left+(${x}+.5)*r.width/20,y:r.top+(${y}+.5)*r.height/13};})()`); await pointer(p); }
async function locale(value) { await evaluate(`import('/js/i18n.js').then(m=>m.setLocale('${value}'))`); }
async function shot(name) { await captureBrowserArtifacts('t12a-' + name, [PORT]); for (const ext of ['png', 'json']) check(fs.existsSync(path.join(process.env.VERIFY_ARTIFACT_DIR, 'screenshots', 't12a-' + name + '-' + PORT + '-0.' + ext)), 'saved ' + name + ' ' + ext); }
async function revAdopted(id, before, label) { const until = Date.now() + 10000; while (Date.now() < until) { if (await evaluate('window.__dndDebug.rev()>' + before)) return true; await new Promise(r => setTimeout(r, 150)); } return false; }
// The client's busy guard can swallow a tap during a pending render (H1 evidence);
// re-issue the tile click on a cadence instead of assuming one pointer event lands.
async function canvasAction(id, x, y, predicate) {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    await tile(x, y);
    const until = Date.now() + 2500;
    while (Date.now() < until) {
      const s = (await api('GET', '/api/game/' + id)).state;
      if (predicate(s)) { await wait('window.__dndDebug.rev()>=' + s.rev, 'state adopted'); return s; }
      await new Promise(r => setTimeout(r, 150));
    }
  }
  throw new Error('Canvas did not converge: ' + x + ',' + y);
}
const ENDINGS = {
  reclaimed: { en: 'Homecoming', 'zh-CN': '物归原主', react: { en: 'What you did today, I remember', 'zh-CN': '今天你做的，我记下了' }, memory: { en: 'The pack is home', 'zh-CN': '东西回来了' }, loyalty: [66, 51], delta: '+8' },
  shared: { en: 'The Settled Account', 'zh-CN': '算清的账', react: { en: 'That makes us even', 'zh-CN': '这算两清' }, memory: { en: 'That makes us even', 'zh-CN': '你付的是你自己的钱' }, loyalty: [58, 58], delta: '+2' }
};
async function descendFromPrep(charId, lang, tag) {
  await evaluate(`location.hash='#/play/new?char=${charId}'`);
  await wait("document.querySelector('[data-prepare-adventures] .adventure-option')", 'prepare directory open');
  await click('[data-adventure-id=brams-pack]');
  await wait("document.querySelector('[data-adventure-id=brams-pack] input').checked", 'companion story selected');
  check(await evaluate("!!document.querySelector('[data-adventure-id=brams-pack] [data-requires-companion]')") && (await evaluate("document.querySelector('[data-adventure-id=brams-pack] [data-requires-companion]').textContent")).includes(lang === 'en' ? 'Bram' : '布拉姆'), 'requires-companion chip visible ' + lang);
  if (tag === 'gated') {
    await click('input[name="companionPick"][value="none"]');
    check(await evaluate("document.getElementById('beginBtn').disabled"), 'solo pick disables the descent');
    check(await evaluate("!document.querySelector('[data-companion-note]').hidden") && (await evaluate("document.querySelector('[data-companion-note]').textContent")).includes(lang === 'en' ? 'Bram' : '布拉姆'), 'visible reason names the companion ' + lang);
    await shot(lang + '-' + tag + '-prep-gate');
    await click('input[name="companionPick"][value="bram"]');
    check(await evaluate("!document.getElementById('beginBtn').disabled"), 'bringing Bram re-enables the descent');
  }
  await click('#beginBtn');
  await wait("document.getElementById('mapCanvas')&&window.__dndDebug", 'delve open from the normal entrance');
  return evaluate('location.hash.split("/").pop()');
}
async function fightHollow(id) {
  // The guardian preset is melee-only. Play like a real player: each turn, step
  // toward the nearest standing hound (clicking an open tile beside it), strike when
  // adjacent, and end the turn. Bounded by 60 turns with strict final assertions.
  const adjacent = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y) <= 1;
  for (let n = 0; n < 60; n++) {
    let s = (await api('GET', '/api/game/' + id)).state;
    if (s.mode !== 'combat') break;
    const p = s.entities.find(e => e.kind === 'player');
    const guard = s.entities.filter(e => ['hound_gate', 'hound_rocks'].includes(e.id) && e.alive && !e.fled)
      .sort((a, b) => (Math.abs(a.x - p.x) + Math.abs(a.y - p.y)) - (Math.abs(b.x - p.x) + Math.abs(b.y - p.y)))[0];
    if (!guard) break;
    const before = await evaluate('window.__dndDebug.rev()');
    if (adjacent(p, guard)) {
      check(await evaluate(`window.__dndDebug.target('${guard.id}')`), 'guard selected through the H1 seam');
      await wait("document.querySelector('[data-act=attack]')&&!document.querySelector('[data-act=attack]').disabled", 'attack usable');
      await click('[data-act=attack]');
      await revAdopted(id, before, 'attack ' + n);
      s = (await api('GET', '/api/game/' + id)).state;
      if (s.mode !== 'combat') break;
    } else {
      const rows = s.map.rows, occupied = new Set(s.entities.filter(e => e.alive !== false).map(e => e.x + ',' + e.y));
      const step = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]
        .map(([dx, dy]) => ({ x: guard.x + dx, y: guard.y + dy }))
        .find(t => t.x >= 0 && t.y >= 0 && t.x < s.map.width && t.y < s.map.height && (rows[t.y] || '')[t.x] === '.' && !occupied.has(t.x + ',' + t.y));
      if (step) {
        await tile(step.x, step.y);
        await revAdopted(id, before, 'step ' + n);
        s = (await api('GET', '/api/game/' + id)).state;
        if (s.mode !== 'combat') break;
      }
    }
    const mark = await evaluate('window.__dndDebug.rev()');
    await wait("document.querySelector('[data-act=endturn]')&&!document.querySelector('[data-act=endturn]').disabled", 'turn control ready');
    await click('[data-act=endturn]');
    await revAdopted(id, mark, 'endTurn ' + n);
  }
  const s = (await api('GET', '/api/game/' + id)).state;
  check(s.mode === 'explore' && (s.encounterFacts || [])[0]?.fact === 'bloodied_trail', 'real UI combat confirms the hollow crossing');
}
try {
  browser = spawn(browserBinary(), ['--headless=new', ...softwareWebGLFlags(), '--no-sandbox', '--disable-dev-shm-usage', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=' + PORT, '--user-data-dir=' + profile, '--window-size=1440,900', BASE + '/#/'], { detached: true, stdio: 'ignore' });
  let tab; for (let n = 0; n < 70 && !tab; n++) { tab = (await fetch('http://127.0.0.1:' + PORT + '/json').then(r => r.json()).catch(() => [])).find(t => t.type === 'page'); if (!tab) await new Promise(r => setTimeout(r, 150)); } if (!tab) throw new Error('Required Chromium did not start');
  ws = new WebSocket(tab.webSocketDebuggerUrl); await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; }); ws.onmessage = event => { const r = JSON.parse(event.data); if (r.method === 'Runtime.exceptionThrown') errors.push(r.params.exceptionDetails); const call = pending.get(r.id); if (!call) return; pending.delete(r.id); clearTimeout(call.timer); if (r.error) call.reject(new Error(r.error.message)); else call.resolve(r.result); };
  await send('Page.enable'); await send('Runtime.enable'); await requireWebGL(send); await wait("document.getElementById('quickName')", 'home');
  await evaluate("localStorage.setItem('dnd_default_view','2d');localStorage.setItem('dnd_3d','off');localStorage.setItem('aiDnd.tutorial.v1',JSON.stringify({status:'skipped'}))");
  for (const lang of ['en', 'zh-CN']) for (const route of ['shared', 'reclaimed']) {
    const started = Date.now();
    const char = await api('POST', '/api/characters', { ...presets.draftFor('guardian'), species: 'human', name: 'T12a 同行者 <raw> {p1}' }); chars.push(char.id);
    await locale(lang); await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    let id;
    if (route === 'shared') {
      // The prepare-screen entrance and its companion gate are exercised here.
      id = await descendFromPrep(char.id, lang, 'gated');
    } else {
      // T11 precedent: the combat route runs against a durability fixture so the
      // real combat engine and the story hand-off are verified without a level-1
      // death roll. Production numbers are untouched; the prepare-screen entrance
      // (chip, gate, descend) is covered by the shared route above.
      id = (await api('POST', '/api/game/start', { characterId: char.id, mapId: 'brams-pack', difficulty: 'easy', bringAlly: 'bram' })).state.id;
      const file = path.join(process.env.DATA_DIR, 'saves', id + '.json');
      const save = JSON.parse(fs.readFileSync(file, 'utf8'));
      const p = save.entities.find(e => e.kind === 'player');
      p.hp = p.hpMax = 200;
      for (const g of save.entities.filter(e => ['hound_gate', 'hound_rocks'].includes(e.id))) { g.hp = g.hpMax = 1; g.ac = 1; }
      save.character.attacks.push({ weaponId: 'longbow', name: 'Fixture Bow', bonus: 30, dmgDice: '1d8', dmgMod: 5, damageType: 'piercing', ranged: true, range: 150 });
      save.rev++; fs.writeFileSync(file, JSON.stringify(save));
      await evaluate(`location.hash='#/play/${id}'`);
      await wait("document.getElementById('mapCanvas')&&window.__dndDebug", 'fixture delve open');
    }
    saves.push(id);
    check((await api('GET', '/api/game/' + id)).state.entities.some(e => e.kind === 'ally' && e.allyId === 'bram' && e.alive), 'Bram is on the board ' + lang + ' ' + route);
    // The ration comes from the camp cache before the barricade decision (shared route)
    if (route === 'shared') {
      await canvasAction(id, 3, 8, st => st.entities.find(e => e.kind === 'player').x === 3 && st.entities.find(e => e.kind === 'player').y === 8);
      await tile(3, 9);
      await wait("(async()=>{const j=await (await fetch('/api/game/" + id + "')).json();return j.state.character.inventory.some(i=>i.itemId==='trail_ration');})()", 'cache looted through the real chest');
      await canvasAction(id, 1, 6, st => st.entities.find(e => e.kind === 'player').x === 1 && st.entities.find(e => e.kind === 'player').y === 6);
    }
    // Choice I at the barricade, spoken by the real Bram
    await click('[data-scene-open=hollow]');
    await wait("document.getElementById('sceneModal')", 'hollow choices');
    check(await evaluate("document.querySelectorAll('#sceneModal [data-scene-choice]').length===2"), 'both barricade choices visible');
    await shot(lang + '-' + route + '-hollow');
    await click('#sceneModal [data-scene-choice=' + (route === 'reclaimed' ? 'hunt' : 'lure') + ']');
    if (route === 'shared') {
      await wait("document.querySelector('[data-scene-outcome]')", 'lured passage'); await click('[data-scene-close]');
    } else {
      await wait("!document.getElementById('sceneModal')", 'combat begins from the real choice');
      check((await api('GET', '/api/game/' + id)).state.mode === 'combat', 'hunt starts the real combat engine');
      await fightHollow(id);
    }
    check(((await api('GET', '/api/game/' + id)).state.encounterFacts || [])[0]?.loyaltyDelta === (route === 'reclaimed' ? 3 : 1), 'attitude shift recorded after stage one');
    // Choice II at the rock shelter
    await canvasAction(id, 15, 9, st => st.entities.find(e => e.kind === 'player').x === 15 && st.entities.find(e => e.kind === 'player').y === 9);
    await click('[data-scene-open=witness]');
    await wait("document.getElementById('sceneModal')", 'witness choices');
    check(await evaluate("document.querySelectorAll('#sceneModal [data-scene-choice]').length===2"), 'both testimony choices visible');
    await shot(lang + '-' + route + '-witness');
    await click('#sceneModal [data-scene-choice=' + (route === 'reclaimed' ? 'hear_out' : 'treat') + ']');
    await wait("document.querySelector('[data-scene-outcome]')", 'pack received');
    await click('[data-scene-close]');
    // Choice III — the fate of the pack
    await click('[data-scene-open=reckoning]');
    await wait("document.querySelector('#sceneModal [data-scene-choice]')", 'reckoning choices');
    check(await evaluate("document.querySelectorAll('#sceneModal [data-scene-choice]').length===3"), 'three fates visible');
    await shot(lang + '-' + route + '-ending-options');
    await click('#sceneModal [data-scene-choice=' + (route === 'reclaimed' ? 'reclaim' : 'share') + ']');
    await wait("document.querySelector('[data-scene-outcome]')", 'confirmed ending');
    check((await evaluate("document.querySelector('[data-scene-outcome]').textContent")).includes(ENDINGS[route][lang]), 'correct handwritten ending ' + lang + ' ' + route);
    check(await evaluate("!!document.querySelector('[data-scene-companion]')") && (await evaluate("document.querySelector('[data-scene-companion]').textContent")).includes(ENDINGS[route].react[lang]), 'Bram\u2019s confirmed reaction is on the panel ' + lang);
    await shot(lang + '-' + route + '-ending');
    await click('[data-scene-close]');
    // Victory and settlement
    await canvasAction(id, 1, 6, st => st.mode === 'victory');
    await wait("document.querySelector('#summaryModal .sumNavBtn[aria-disabled=false]')", 'settlement succeeded');
    check(await evaluate("document.querySelectorAll('#summaryAdventure [data-story-choice]').length===3"), 'receipt summary shows all three real choices');
    await shot(lang + '-' + route + '-summary');
    await click('#summaryModal .sumNavBtn'); await wait("location.hash.includes('/overworld')", 'town return');
    const roster = await api('GET', '/api/characters/' + char.id);
    // The standing victory bonus (+5) applies to allies still standing at the
    // campfire; a real hound fight may down Bram once (-10, and then the bonus is
    // skipped by the existing alive filter), so the combat route accepts 66 or 51.
    check(roster.encounterFacts.length === 3 && ENDINGS[route].loyalty.includes(roster.companionLoyalty.bram),
      'roster keeps the facts and the real attitude ' + route + ' (got ' + roster.companionLoyalty.bram + ')');
    // Town-visible story history with Bram's reaction
    await evaluate(`location.hash='#/character/${char.id}'`);
    await wait("document.querySelector('[data-story-history]')", 'town story history');
    const history = await evaluate("document.querySelector('[data-story-history]').textContent");
    check(history.includes(ENDINGS[route][lang]) && history.includes(ENDINGS[route].react[lang]) && history.includes(ENDINGS[route].delta), 'sheet shows ending, Bram reaction and loyalty ' + lang + ' ' + route);
    await evaluate("document.querySelector('[data-story-history]').scrollIntoView({block:'start'})");
    await shot(lang + '-' + route + '-town');
    // A fresh delve with the same companion opens on the remembered ending
    const nextId = await descendFromPrep(char.id, lang, 'memory');
    saves.push(nextId);
    const nextLog = JSON.stringify((await api('GET', '/api/game/' + nextId)).state.log || []);
    check(nextLog.includes(ENDINGS[route].memory[lang]) && !nextLog.includes('pack_entrusted'), 'greeting carries the confirmed reaction only ' + lang);
    await click('[data-scene-open=hollow]');
    await wait("document.querySelector('[data-scene-memory]')", 'memory card visible on the fresh stage');
    check((await evaluate("document.querySelector('[data-scene-memory]').textContent")).includes(ENDINGS[route].memory[lang]), 'scene memory recalls the past ending ' + lang + ' ' + route);
    await shot(lang + '-' + route + '-memory');
    await click('[data-scene-close]');
    const seconds = (Date.now() - started) / 1000;
    timings.push({ language: lang, route, seconds, style: 'Accelerated Chromium pointer play from the prepare screen; no reading pauses; combat durability fixture on the reclaimed route (T11 precedent)' });
    console.log('  TIMED ROUTE ' + lang + ' ' + route + ': ' + seconds.toFixed(2) + 's (accelerated, not human reading time)');
    await evaluate("location.hash='#/'"); await wait("!document.getElementById('mapCanvas')", 'clean leave');
  }
  check(errors.length === 0, 'no uncaught browser exceptions');
  fs.writeFileSync(path.join(process.env.VERIFY_ARTIFACT_DIR, 't12a-route-timings.json'), JSON.stringify(timings, null, 2));
} catch (error) {
  failed++; console.error('  FAIL: ' + error.stack);
  await captureBrowserArtifacts('t12a-failure', [PORT]).catch(e => console.error(e.message));
} finally {
  try { await closeBrowser(browser, ws, send, profile); } catch (error) { failed++; console.error('Browser cleanup failed: ' + error.stack); }
  for (const id of saves) await api('DELETE', '/api/game/' + id).catch(e => { failed++; console.error(e.message); });
  for (const id of chars) await api('DELETE', '/api/characters/' + id).catch(e => { failed++; console.error(e.message); });
}
console.log('T12a companion story CDP: ' + passed + ' passed, ' + failed + ' failed.');
process.exitCode = failed ? 1 : 0;
