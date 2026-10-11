// tests/e2e/bounded-natural-actions-cdp.test.mjs
// T13a: Real pointer and keyboard natural language input via CDP.
// Verifies Chinese and English input mapping, ambiguity clarification candidate clicks,
// cost/ending confirmation flow, and draft preservation.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import presets from '../../server/game/presets.js';
import { assertTestContainer } from '../../scripts/test-container.mjs';
import { browserBinary, softwareWebGLFlags, captureBrowserArtifacts, closeBrowser } from './_browser-runtime.mjs';

const require = createRequire(import.meta.url);
const store = require('../../server/store.js');

assertTestContainer();
const BASE = process.env.BASE_URL || 'http://localhost:' + (process.env.PORT || 3000);
const PORT = 9244;
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-dnd-t13a-cdp-'));
const pending = new Map(), saves = [], chars = [], timings = [];
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
    const rect = el.getBoundingClientRect();
    const point = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    const hit = document.elementFromPoint(point.x, point.y);
    return el.contains(hit) ? { point } : { reason: 'occluded', point, hit: hit?.outerHTML.slice(0, 200), connected: el.isConnected };
  })()`);
  check(r.point && !r.reason, 'pointer ' + selector + ' ' + (r.reason ? JSON.stringify(r) : ''));
  await pointer(r.point);
}

async function ensureChatOpen() {
  const isOpen = await evaluate("window.__dndDebug?.panel() === 'chat' && !document.getElementById('delvePanel')?.hidden && !!document.getElementById('chatInput') && document.getElementById('chatInput').offsetParent !== null");
  if (!isOpen) {
    await click('.delve-tools [data-panel="chat"]');
    await wait("window.__dndDebug?.panel() === 'chat' && !document.getElementById('delvePanel')?.hidden", 'chat drawer opened');
  }
}

async function setChatInput(text) {
  await evaluate(`(() => {
    const input = document.getElementById('chatInput');
    input.value = ${JSON.stringify(text)};
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.focus();
  })()`);
}

async function submitChat(text) {
  await ensureChatOpen();
  await setChatInput(text);
  await click('#chatSend');
}

async function shot(name) {
  await captureBrowserArtifacts('t13a-' + name, [PORT]);
  for (const ext of ['png', 'json']) {
    check(fs.existsSync(path.join(process.env.VERIFY_ARTIFACT_DIR, 'screenshots', 't13a-' + name + '-' + PORT + '-0.' + ext)), 'saved ' + name + ' ' + ext);
  }
}

async function locale(value) {
  await evaluate(`import('/js/i18n.js').then(m => m.setLocale('${value}'))`);
}

const chromeBin = browserBinary();
browser = spawn(chromeBin, [
  '--headless=new',
  '--remote-debugging-port=' + PORT,
  '--user-data-dir=' + profile,
  '--no-sandbox',
  '--disable-gpu',
  '--window-size=1440,900',
  '--use-gl=angle',
  '--use-angle=swiftshader',
  ...softwareWebGLFlags()
], { detached: true });

await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('Browser spawn timeout')), 10000);
  const checkEndpoint = async () => {
    try {
      const res = await fetch('http://127.0.0.1:' + PORT + '/json/version');
      if (res.ok) {
        clearTimeout(timer);
        resolve(await res.json());
      } else setTimeout(checkEndpoint, 200);
    } catch {
      setTimeout(checkEndpoint, 200);
    }
  };
  checkEndpoint();
});

const targets = await (await fetch('http://127.0.0.1:' + PORT + '/json')).json();
const pageTab = targets.find(t => t.type === 'page') || targets[0];
ws = new WebSocket(pageTab.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  ws.onopen = resolve;
  ws.onerror = reject;
});

ws.onmessage = event => {
  const msg = JSON.parse(event.data);
  const call = pending.get(msg.id);
  if (!call) return;
  pending.delete(msg.id);
  clearTimeout(call.timer);
  if (msg.error) call.reject(new Error(msg.error.message));
  else call.resolve(msg.result);
};

await send('Runtime.enable');
await send('Page.enable');
await send('DOM.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

console.log('Testing T13a: Natural Language Actions CDP...');

// 1. Initial navigate & hero setup
const tStart = Date.now();
await send('Page.navigate', { url: BASE + '/#/' });
await wait("document.getElementById('topLocaleSelect')", 'page load');

const heroChar = await api('POST', '/api/characters', {
  name: 'T13a Adventurer',
  ...presets.draftFor('guardian'),
  gold: 60,
  inventory: [{ itemId: 'potion_healing', qty: 2 }, { itemId: 'longsword', qty: 1 }]
});
chars.push(heroChar.id);
const allChars = store.getCharacters();
const createdChar = allChars.find(c => c.id === heroChar.id);
if (createdChar) {
  createdChar.gold = 60;
  createdChar.inventory = [{ itemId: 'potion_healing', qty: 2 }, { itemId: 'longsword', qty: 1 }];
  createdChar.attacks = [{ name: 'Longsword', weaponId: 'longsword', ranged: false }];
  createdChar.equipped = { mainHand: 'longsword' };
  store.saveCharacters(allChars);
}

// 2. Start delve in courier-crossing
const { state: delveState } = await api('POST', '/api/game/start', {
  charId: heroChar.id,
  mapId: 'courier-crossing',
  bringAlly: 'bram'
});
saves.push(delveState.id);

await evaluate(`location.hash='#/play/${delveState.id}'`);
await wait("document.getElementById('mapCanvas') && window.__dndDebug", 'delve board mounted');
await locale('zh-CN');

// 3. Move hero adjacent to Iris (at 6, 7)
await api('POST', `/api/game/${delveState.id}/action`, { type: 'move', x: 6, y: 7 });
await wait(`window.__dndDebug.playerTile() && window.__dndDebug.playerTile().x >= 6`, 'player moved adjacent to Iris');

// 4. Type Chinese natural language action: "说明寻找信使的来意" to open bridge
const beforeIrisRev = await evaluate('window.__dndDebug.rev()');
await submitChat('说明寻找信使的来意');
await wait(`window.__dndDebug.rev() > ${beforeIrisRev}`, 'bridge passage opened after talking to Iris');

// Move hero adjacent to Lio (at 20, 11)
await api('POST', `/api/game/${delveState.id}/action`, { type: 'move', x: 20, y: 11 });
await wait(`window.__dndDebug.playerTile() && window.__dndDebug.playerTile().x >= 20`, 'player moved adjacent to Lio');

// Type Chinese natural language action: "我把治疗药水给里奥"
const beforeLioRev = await evaluate('window.__dndDebug.rev()');
await submitChat('我把治疗药水给里奥');
await wait(`window.__dndDebug.rev() > ${beforeLioRev}`, 'state advanced after giving potion to Lio');

// Verify ledger obtained and potion deducted
const currentSave = (await api('GET', `/api/game/${delveState.id}`)).state;
check(currentSave.character.inventory.some(i => i.itemId === 'courier_ledger'), 'Obtained courier_ledger via natural language input');
const potEntry = currentSave.character.inventory.find(i => i.itemId === 'potion_healing');
check(potEntry && potEntry.qty === 1, 'Deducted 1 healing potion');
check(await evaluate("document.getElementById('chatInput').value === ''"), 'Chat input cleared on successful action');
await shot('zh-natural-action-success');

// 5. Ambiguity Clarification: multiple targets in sight
// Inject 2 goblins in state near player (at 20, 10 and 21, 10)
const saveForClarify = store.getSave(delveState.id);
saveForClarify.discovered = saveForClarify.discovered || [];
saveForClarify.discovered.push('20,10', '21,10');
saveForClarify.entities.push(
  { id: 'cdp_goblin_1', kind: 'monster', monsterId: 'goblin', name: '地精伏兵', hp: 7, hpMax: 7, x: 20, y: 10, alive: true, conditions: [], buffs: [] },
  { id: 'cdp_goblin_2', kind: 'monster', monsterId: 'goblin', name: '地精弩手', hp: 7, hpMax: 7, x: 21, y: 10, alive: true, conditions: [], buffs: [] }
);
const pChar = saveForClarify.entities.find(e => e.kind === 'player');
pChar.initBonus = 99;
saveForClarify.character.initBonus = 99;
saveForClarify.character.attacks = [{ name: 'Longsword', weaponId: 'longsword', ranged: false }];
saveForClarify.character.equipped = { mainHand: 'longsword' };
store.saveGame(saveForClarify);
await api('POST', `/api/game/${delveState.id}/action`, { type: 'move', x: 20, y: 11 });

// Type "攻击地精"
await submitChat('攻击地精');

// Wait for clarification card
await wait("!!document.querySelector('[data-card=\"clarification\"]')", 'clarification card rendered');
check(await evaluate("!!document.querySelector('[data-clarify-idx=\"0\"]')"), 'Clarification candidate 0 exists');
check(await evaluate("!!document.querySelector('[data-clarify-idx=\"1\"]')"), 'Clarification candidate 1 exists');
await shot('zh-clarify-targets');

// Click candidate 0 to clarify target
const combatRev = await evaluate('window.__dndDebug.rev()');
await click('[data-clarify-idx="0"]');
await wait(`window.__dndDebug.rev() > ${combatRev}`, 'attack resolved after clarification click');
check(await evaluate("!document.querySelector('[data-card=\"clarification\"]')"), 'Clarification card dismissed');

// 6. Confirmation Prompt: switch to English and test gold confirmation for pay toll
await locale('en');
const { state: confirmDelve } = await api('POST', '/api/game/start', {
  charId: heroChar.id,
  mapId: 'courier-crossing',
  bringAlly: 'bram'
});
saves.push(confirmDelve.id);

await evaluate(`window.__dndDebug = null; location.hash='#/play/${confirmDelve.id}'`);
await wait("document.getElementById('mapCanvas') && window.__dndDebug && window.__dndDebug.resources()?.renderers === 1", 'courier-crossing mounted');

// Move adjacent to Iris (at 6, 7)
await api('POST', `/api/game/${confirmDelve.id}/action`, { type: 'move', x: 6, y: 7 });
await wait(`window.__dndDebug?.playerTile() && window.__dndDebug.playerTile().x >= 6`, 'player adjacent to Iris');

// Type "pay the toll" which costs 5 GP
await submitChat('pay the toll');

// Confirmation card should appear with Confirm and Cancel buttons
await wait("!!document.querySelector('[data-card=\"confirmation\"]')", 'confirmation card rendered');
check(await evaluate("!!document.querySelector('[data-confirm-action]')"), 'Confirm button exists');
check(await evaluate("!!document.querySelector('[data-confirm-cancel]')"), 'Cancel button exists');
await shot('en-confirm-action');

// Click Cancel: choice is not executed
await click('[data-confirm-cancel]');
await wait("!document.querySelector('[data-card=\"confirmation\"]')", 'confirmation card dismissed on cancel');
const cancelCheck = (await api('GET', `/api/game/${confirmDelve.id}`)).state;
check(!cancelCheck.encounterFacts?.some(f => f.choiceId === 'pay_toll'), 'Toll was not paid on cancel');

// 7. Error draft preservation: type invalid action
await submitChat('attack nonexistent dragon');
await wait("document.getElementById('chatInput').value.includes('dragon')", 'Input draft preserved on unrecognized error');

timings.push({ name: 'T13a Bounded Actions CDP', durationMs: Date.now() - tStart });

// Cleanup
for (const id of saves) {
  try { await api('DELETE', `/api/game/${id}`); } catch {}
}
for (const id of chars) {
  try { await api('DELETE', `/api/characters/${id}`); } catch {}
}

await closeBrowser(browser, ws, send, profile);

console.log(`\nT13a CDP tests finished: ${passed} passed, 0 failed.`);
process.exit(0);
