// T14: Real pointer input, Chapter 1 to Chapter 2 walkthrough, zero-resource fail forward,
// persistent history and bilingual verification via CDP.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import presets from '../../server/game/presets.js';
import { assertTestContainer } from '../../scripts/test-container.mjs';
import { browserBinary, softwareWebGLFlags, requireWebGL, captureBrowserArtifacts, closeBrowser } from './_browser-runtime.mjs';

assertTestContainer();
const BASE = process.env.BASE_URL || 'http://localhost:' + (process.env.PORT || 3000);
const PORT = 9242;
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-dnd-t14-cdp-'));
const pending = new Map(), saves = [], chars = [], errors = [], timings = [];
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
    }, 20000);
    pending.set(id, { resolve, reject, timer });
    ws.send(JSON.stringify({ id, method, params }));
  });
}

async function evaluate(expression) {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails));
  return r.result.value;
}

async function wait(expression, label) {
  const until = Date.now() + 15000;
  while (Date.now() < until) {
    if (await evaluate('!!(' + expression + ')')) return;
    await new Promise(r => setTimeout(r, 150));
  }
  throw new Error('Timed out: ' + label);
}

async function api(method, url, body) {
  const r = await fetch(BASE + url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const data = await r.json();
  if (!r.ok) throw new Error(url + ': ' + JSON.stringify(data));
  return data;
}

async function pointer(p) {
  const down = send('Input.dispatchMouseEvent', { type: 'mousePressed', ...p, button: 'left', clickCount: 1 });
  const up = send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...p, button: 'left', clickCount: 1 });
  await Promise.all([down, up]);
}

async function click(selector) {
  const r = await evaluate(`(async () => {
    let el = document.querySelector(${JSON.stringify(selector)});
    if (!el || el.disabled) return { reason: 'missing or disabled' };
    el.scrollIntoView({ block: 'center' });
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    el = document.querySelector(${JSON.stringify(selector)});
    if (!el || el.disabled) return { reason: 'changed after layout' };
    const rect = (el.matches('[data-node-id]') ? el.querySelector('.waypoint-hit') : el).getBoundingClientRect();
    const point = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    const hit = document.elementFromPoint(point.x, point.y);
    return el.contains(hit) ? { point } : { reason: 'occluded', point, hit: hit?.outerHTML.slice(0, 200), connected: el.isConnected };
  })()`);
  check(r.point && !r.reason, 'pointer ' + selector + ' ' + (r.reason ? JSON.stringify(r) : ''));
  await pointer(r.point);
}

async function tile(x, y) {
  const p = await evaluate(`(() => {
    const c = document.getElementById('mapCanvas');
    const r = c.getBoundingClientRect();
    return { x: r.left + (${x} + 0.5) * r.width / 25, y: r.top + (${y} + 0.5) * r.height / 15 };
  })()`);
  await pointer(p);
}

async function canvasAction(id, x, y, predicate) {
  await tile(x, y);
  const until = Date.now() + 15000;
  while (Date.now() < until) {
    const s = (await api('GET', '/api/game/' + id)).state;
    if (predicate(s)) {
      await wait('window.__dndDebug.rev()>=' + s.rev, 'state adopted');
      return s;
    }
    await new Promise(r => setTimeout(r, 150));
  }
  throw new Error('Canvas did not converge: ' + x + ',' + y);
}

async function locale(value) {
  await evaluate(`import('/js/i18n.js').then(m => m.setLocale('${value}'))`);
}

async function shot(name) {
  await captureBrowserArtifacts('t14-' + name, [PORT]);
  for (const ext of ['png', 'json']) {
    check(fs.existsSync(path.join(process.env.VERIFY_ARTIFACT_DIR, 'screenshots', 't14-' + name + '-' + PORT + '-0.' + ext)), 'saved ' + name + ' ' + ext);
  }
}

try {
  browser = spawn(browserBinary(), [
    '--headless=new', ...softwareWebGLFlags(), '--no-sandbox', '--disable-dev-shm-usage',
    '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=' + PORT,
    '--user-data-dir=' + profile, '--window-size=1440,900', BASE + '/#/'
  ], { detached: true, stdio: 'ignore' });

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
    const r = JSON.parse(event.data);
    if (r.method === 'Runtime.exceptionThrown') errors.push(r.params.exceptionDetails);
    const call = pending.get(r.id);
    if (!call) return;
    pending.delete(r.id);
    clearTimeout(call.timer);
    if (r.error) call.reject(new Error(r.error.message));
    else call.resolve(r.result);
  };

  await send('Page.enable');
  await send('Runtime.enable');
  await requireWebGL(send);
  await wait("document.getElementById('quickName')", 'home');
  await evaluate("localStorage.setItem('dnd_default_view','2d');localStorage.setItem('dnd_3d','off');localStorage.setItem('aiDnd.tutorial.v1',JSON.stringify({status:'skipped'}))");

  for (const lang of ['zh-CN', 'en']) {
    const started = Date.now();
    await locale(lang);
    await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

    // Step 1: Create a fresh hero
    const char = await api('POST', '/api/characters', {
      ...presets.draftFor('guardian'),
      species: 'human',
      name: 'T14 历程者 <raw>'
    });
    chars.push(char.id);
    const rosterFile = path.join(process.env.DATA_DIR, 'characters.json');
    const roster = JSON.parse(fs.readFileSync(rosterFile, 'utf8'));
    roster.find(c => c.id === char.id).gold = 50;
    fs.writeFileSync(rosterFile, JSON.stringify(roster));

    // Step 2: Open prepare view and select river-post (clean hero without Chapter 1 history)
    await evaluate(`location.hash='#/play/new?char=${char.id}'`);
    await wait("document.querySelector('[data-prepare-adventures]')", 'prepare view open');

    // Pick river-post
    await click(`[data-adventure-id="river-post"]`);
    await wait("!document.querySelector('[data-history-note]').hidden", 'no-history notice visible');
    const noticeText = await evaluate("document.querySelector('[data-history-note]').textContent");
    check(
      noticeText.includes(lang === 'zh-CN' ? '尚未完成第一章探索' : 'No completed Chapter 1 record'),
      'history notice displayed correctly in ' + lang
    );
    await shot(lang + '-prepare-no-history');

    // Step 3: Complete Chapter 1 with victory ending "reported"
    const ch1Res = await api('POST', '/api/game/start', { characterId: char.id, mapId: 'courier-crossing', difficulty: 'easy', bringAlly: false });
    const ch1Id = ch1Res.state.id;
    saves.push(ch1Id);

    // Solve crossing via pay_toll (5 GP)
    await api('POST', '/api/game/' + ch1Id + '/action', { type: 'move', x: 6, y: 7 });
    await api('POST', '/api/game/' + ch1Id + '/action', { type: 'sceneChoice', sceneId: 'crossing', choiceId: 'pay_toll' });

    // Testimony at waystation (20, 11) -> listen
    await api('POST', '/api/game/' + ch1Id + '/action', { type: 'move', x: 20, y: 11 });
    await api('POST', '/api/game/' + ch1Id + '/action', { type: 'sceneChoice', sceneId: 'testimony', choiceId: 'listen' });

    // Reckoning at bridge -> report (gives 'reported' ending)
    await api('POST', '/api/game/' + ch1Id + '/action', { type: 'move', x: 6, y: 7 });
    await api('POST', '/api/game/' + ch1Id + '/action', { type: 'sceneChoice', sceneId: 'reckoning', choiceId: 'report' });

    // Campfire victory
    await api('POST', '/api/game/' + ch1Id + '/action', { type: 'move', x: 1, y: 7 });
    const ch1Final = await api('GET', '/api/game/' + ch1Id);
    check(ch1Final.state.mode === 'victory', 'chapter 1 reached victory');

    // Sync delve to town
    const settleCh1 = await api('POST', '/api/city/sync-delve', { charId: char.id, delveStateId: ch1Id });
    check(settleCh1 && !settleCh1.error, 'chapter 1 settled to town');

    // Step 4: Re-open prepare view for river-post: history notice must now be HIDDEN!
    await evaluate("location.hash='#/'");
    await wait("!document.querySelector('[data-prepare-adventures]')", 'prepare view closed');
    await evaluate(`location.hash='#/play/new?char=${char.id}'`);
    await wait("document.querySelector('[data-prepare-adventures]')", 'prepare view re-opened');
    await click(`[data-adventure-id="river-post"]`);
    await wait("document.querySelector('[data-history-note]').hidden", 'history notice now hidden because hero has completed history');
    await shot(lang + '-prepare-with-history');

    // Descend into river-post
    await click('#beginBtn');
    await wait("document.getElementById('mapCanvas')&&window.__dndDebug", 'river-post delve opened');
    const ch2Id = await evaluate("location.hash.split('/')[2]");
    saves.push(ch2Id);

    const ch2State = (await api('GET', '/api/game/' + ch2Id)).state;
    check(ch2State.historyBinding?.ending === 'reported', 'river-post delve has historyBinding.ending === reported');

    // Step 5: Scene 1 at post_gate
    await canvasAction(ch2Id, 6, 7, st => st.entities.find(e => e.kind === 'player').x === 6 && st.entities.find(e => e.kind === 'player').y === 7);
    await wait("document.querySelector('[data-scene-open=post_gate]')", 'gate button visible');
    await click('[data-scene-open=post_gate]');
    await wait("document.getElementById('sceneModal')", 'post_gate modal open');
    check(await evaluate("!document.querySelector('#sceneModal [data-scene-choice=show_pass]').disabled"), 'show_pass choice enabled');
    await shot(lang + '-gate-options');

    await click('#sceneModal [data-scene-choice=show_pass]');
    await wait("document.querySelector('[data-scene-outcome]')", 'show_pass outcome displayed');
    await click('[data-scene-close]');
    await wait("!document.getElementById('sceneModal')", 'post_gate modal closed');

    // Step 6: Move through gate to Scene 2 at storehouse_dispute
    await canvasAction(ch2Id, 13, 7, st => st.entities.find(e => e.kind === 'player').x === 13 && st.entities.find(e => e.kind === 'player').y === 7);
    await wait("document.querySelector('[data-scene-open=storehouse_dispute]')", 'storehouse button visible');
    await click('[data-scene-open=storehouse_dispute]');
    await wait("document.getElementById('sceneModal')", 'storehouse_dispute modal open');
    check(await evaluate("!document.querySelector('#sceneModal [data-scene-choice=cite_records]').disabled"), 'cite_records choice enabled');
    await shot(lang + '-storehouse-options');

    // Tweak to ensure persuasion check success
    const ch2File = path.join(process.env.DATA_DIR, 'saves', ch2Id + '.json');
    const ch2Save = JSON.parse(fs.readFileSync(ch2File, 'utf8'));
    ch2Save.character.abilities.cha = 50;
    fs.writeFileSync(ch2File, JSON.stringify(ch2Save));

    await click('#sceneModal [data-scene-choice=cite_records]');
    await wait("document.querySelector('[data-scene-outcome]')", 'cite_records outcome displayed');
    await click('[data-scene-close]');
    await wait("!document.getElementById('sceneModal')", 'storehouse_dispute modal closed');

    // Step 7: Move to Scene 3 at final_verdict
    await canvasAction(ch2Id, 20, 7, st => st.entities.find(e => e.kind === 'player').x === 20 && st.entities.find(e => e.kind === 'player').y === 7);
    await wait("document.querySelector('[data-scene-open=final_verdict]')", 'verdict button visible');
    await click('[data-scene-open=final_verdict]');
    await wait("document.getElementById('sceneModal')", 'final_verdict modal open');
    check(await evaluate("document.querySelectorAll('#sceneModal [data-scene-choice]').length===3"), 'all 3 final endings visible');
    await shot(lang + '-final-verdict-options');

    await click('#sceneModal [data-scene-choice=choice_lawful_order]');
    await wait("document.querySelector('[data-scene-outcome]')", 'lawful_order outcome displayed');
    await shot(lang + '-lawful-order-outcome');
    await click('[data-scene-close]');
    await wait("!document.getElementById('sceneModal')", 'final_verdict modal closed');

    // Step 8: Return to campfire at (1, 7)
    await canvasAction(ch2Id, 1, 7, st => st.mode === 'victory');
    await wait("document.querySelector('#summaryModal')", 'summaryModal open');
    await wait("document.querySelectorAll('#summaryAdventure [data-story-choice]').length === 3", 'summary choices rendered');
    await wait("!document.querySelector('.sumNavBtn.locked')", 'summary nav unlocked');
    await shot(lang + '-victory-summary');

    check(await evaluate("document.querySelectorAll('#summaryAdventure [data-story-choice]').length===3"), 'summary shows all 3 chapter 2 choices');
    await click('.sumNavBtn'); // Return to town

    timings.push({ lang, durationMs: Date.now() - started });
  }

  console.log('Starter Adventure CDP completed successfully in ' + passed + ' assertions.');
} finally {
  await closeBrowser(browser, ws, send, profile);
}
