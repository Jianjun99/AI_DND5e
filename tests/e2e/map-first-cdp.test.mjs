// T10: real pointer/keyboard input, drawer lifecycle, resize and settlement lock.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import engine from '../../server/game/engine.js';
import { browserBinary, softwareWebGLFlags, requireWebGL, captureBrowserArtifacts, closeBrowser } from './_browser-runtime.mjs';

const BASE = process.env.BASE_URL || `http://localhost:${process.env.PORT || 3000}`;
const PORT = 9233, profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-dnd-t10-'));
let ws, browser, sequence = 0, passed = 0, failed = 0, characterId, saveId;
const pending = new Map(), errors = [];
function check(condition, message) { if (!condition) throw new Error(message); passed++; console.log('  PASS: ' + message); }
function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error('CDP timeout: ' + method)); }, 20000);
    pending.set(id, { resolve, reject, timer }); ws.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) {
  const r = await send('Runtime.evaluate', { expression, awaitPromise:true, returnByValue:true });
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails)); return r.result.value;
}
async function wait(expression, label) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (await evaluate('!!(' + expression + ')')) return;
    await new Promise(r => setTimeout(r, 180));
  }
  throw new Error('Timed out: ' + label);
}
async function api(method, url, body) {
  const r = await fetch(BASE + url, { method, headers:{'Content-Type':'application/json'}, body:body === undefined ? undefined : JSON.stringify(body) });
  const data = await r.json(); if (!r.ok) throw new Error(url + ': ' + JSON.stringify(data)); return data;
}
async function pointer(x, y) {
  await send('Input.dispatchMouseEvent', { type:'mousePressed', x, y, button:'left', clickCount:1 });
  await send('Input.dispatchMouseEvent', { type:'mouseReleased', x, y, button:'left', clickCount:1 });
}
async function click(selector) {
  const p = await evaluate(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)}); if (!el || el.disabled) return null;
    const r = el.getBoundingClientRect(), x = r.x+r.width/2, y = r.y+r.height/2;
    window.__t10ExpectedPointer = el; window.__t10PointerClicked = false;
    return r.width && r.height && el.contains(document.elementFromPoint(x,y)) ? {x,y} : null;
  })()`);
  check(!!p, 'real pointer reaches ' + selector); await pointer(p.x, p.y);
}
async function key(key, code = key) {
  await send('Input.dispatchKeyEvent', { type:'keyDown', key, code });
  await send('Input.dispatchKeyEvent', { type:'keyUp', key, code });
}
async function shot(name) {
  await captureBrowserArtifacts('t10-' + name, [PORT]);
  const file = path.join(process.env.VERIFY_ARTIFACT_DIR, 'screenshots', 't10-' + name + '-' + PORT + '-0.png');
  check(fs.existsSync(file) && fs.statSync(file).size > 1000, name + ': PNG and DOM retained');
}
async function mount() {
  await evaluate(`location.hash = '#/play/${saveId}'`);
  await wait("document.querySelector('#map3d canvas') && window.__dndDebug.resources().renderers === 1", 'delve renderer');
}
console.log('\n--- T10 Map First & Floating Panels ---');
try {
  const char = await api('POST', '/api/characters', { presetId:'guardian', name:'T10 旅人 <draft>' }); characterId = char.id;
  saveId = (await api('POST', '/api/game/start', { characterId, mapId:'crypt', difficulty:'easy', bringAlly:false })).state.id;
  browser = spawn(browserBinary(), ['--headless=new', ...softwareWebGLFlags(), '--no-sandbox', '--disable-dev-shm-usage',
    '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=' + PORT, '--user-data-dir=' + profile, BASE + '/#/'], { detached:true });
  let tab;
  for (let i = 0; i < 60; i++) {
    tab = (await fetch('http://127.0.0.1:' + PORT + '/json').then(r => r.json()).catch(() => [])).find(t => t.type === 'page' && t.url.startsWith(BASE));
    if (tab) break; await new Promise(r => setTimeout(r, 200));
  }
  if (!tab) throw new Error('Required Chromium target unavailable');
  ws = new WebSocket(tab.webSocketDebuggerUrl); await new Promise((resolve, reject) => { ws.onopen=resolve; ws.onerror=reject; });
  ws.onmessage = event => {
    const r = JSON.parse(event.data);
    if (r.method === 'Runtime.exceptionThrown') errors.push(r.params.exceptionDetails);
    const call = pending.get(r.id); if (!call) return;
    pending.delete(r.id); clearTimeout(call.timer);
    if (r.error) call.reject(new Error(r.error.message)); else call.resolve(r.result);
  };
  await send('Page.enable'); await send('Runtime.enable'); await requireWebGL(send);
  await wait("document.getElementById('quickName')", 'home');
  await evaluate("localStorage.setItem('aiDnd.tutorial.v1', JSON.stringify({status:'skipped'})); localStorage.removeItem('dnd_delve_layout')");
  await mount();
  await evaluate(`(() => {
    window.__t10InputAudit = [];
    for (const type of ['pointerdown','pointerup','click']) document.addEventListener(type, event => {
      const button = event.target instanceof Element ? event.target.closest('button,a') : null;
      const matched = !!window.__t10ExpectedPointer?.contains(event.target);
      window.__t10InputAudit.push({type, trusted:event.isTrusted, matched, panel:button?.dataset.panel,
        id:button?.id, x:event.clientX, y:event.clientY, viewport:[innerWidth,innerHeight]});
      if (type === 'click' && matched) window.__t10PointerClicked = true;
    }, true);
  })()`);
  await evaluate(`(() => {
    window.__canvas = document.querySelector('#map3d canvas'); window.__writes = [];
    const original = window.fetch;
    window.fetch = (url, init) => {
      if (init?.method && !['GET','HEAD','OPTIONS'].includes(init.method)) window.__writes.push(String(url));
      if (window.__holdSettle && String(url).includes('/city/sync-delve')) {
        window.__heldSettle = true; return new Promise(resolve => { window.__releaseSettle = () => {
          window.__holdSettle = false; resolve(original(url, init));
        }; });
      }
      return original(url, init);
    };
  })()`);
  const before = (await api('GET', '/api/game/' + saveId)).state;
  for (const [width,height] of [[1440,900],[1280,800],[390,844],[844,390]]) {
    await send('Emulation.setDeviceMetricsOverride', { width,height,deviceScaleFactor:1,mobile:width<900 });
    for (const locale of ['en','zh-CN']) {
      await evaluate(`import('/js/i18n.js').then(m => m.setLocale('${locale}'))`);
      await wait("document.querySelector('#map3d canvas').width === Math.round(document.getElementById('map3d').clientWidth)", 'observer resizes WebGL buffer');
      const metrics = await evaluate(`(() => {
        const r = document.getElementById('mapWrap').getBoundingClientRect();
        const controls = [...document.querySelectorAll('.delve-tools button, #coreHud button')];
        return {w:r.width/innerWidth,h:r.height/innerHeight,overflow:document.documentElement.scrollWidth>innerWidth,
          reachable:controls.every(el => {const b=el.getBoundingClientRect(); return b.width>0 && b.top>=0 && b.bottom<=innerHeight && el.contains(document.elementFromPoint(b.x+b.width/2,b.y+b.height/2));})};
      })()`);
      check(metrics.w >= .8 && metrics.h >= .7 && !metrics.overflow && metrics.reachable, `${width}x${height} ${locale}: map ratios, HUD actions and tools reachable`);
      await shot(`A-${width}x${height}-${locale}`);
      await click('.delve-tools [data-panel="chat"]');
      await send('Input.insertText', { text:'未发送 WASD <room>' });
      await evaluate("window.__input=document.getElementById('chatInput'); window.__input.setSelectionRange(2,4)");
      await key('w', 'KeyW');
      await evaluate(`import('/js/i18n.js').then(m => m.setLocale('${locale === 'en' ? 'zh-CN' : 'en'}'))`);
      check(await evaluate("document.activeElement === window.__input && window.__input.value === '未发送 WASD <room>' && window.__input.selectionStart === 2 && window.__canvas === document.querySelector('#map3d canvas')"), 'visible chat retains draft, selection, focus and canvas through locale switch');
      await shot(`C-chat-${width}x${height}-${locale === 'en' ? 'zh-CN' : 'en'}`);
      await key('Escape');
      check(await evaluate("document.getElementById('delvePanel').hidden && document.activeElement.matches('.delve-tools [data-panel=chat]')"), 'Escape closes one drawer and returns focus');
      await evaluate("document.getElementById('chatInput').value=''");
    }
  }
  check(JSON.stringify((await api('GET','/api/game/'+saveId)).state) === JSON.stringify(before) && await evaluate('window.__writes.length===0'), 'all layout, locale, typing and resize probes leave authoritative state and RNG unchanged');
  await click('.delve-tools [data-panel="log"]');
  check(await evaluate('document.querySelectorAll("#logEntries .log-entry").length') === before.log.length, 'expanded log retains the complete authoritative history');
  await key('Escape');
  await send('Emulation.setDeviceMetricsOverride', { width:1280,height:800,deviceScaleFactor:1,mobile:false });
  // Device metrics acknowledgment precedes the resized compositor frame. Finish
  // the ResizeObserver/render turn before using DOM coordinates for native input.
  await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  for (let i=0;i<3;i++) {
    await click('.delve-tools [data-panel="character"]'); await click('.delve-tools [data-panel="quests"]');
    check(await evaluate("window.__dndDebug.panel()==='quests' && getComputedStyle(document.getElementById('sidePanel')).display==='none' && document.querySelectorAll('.quest-objective-card').length===1"), 'opening quests replaces character pane without duplicate quest nodes');
    await click('.delve-tools [data-panel="inventory"]');
    await wait('window.__t10PointerClicked', 'native backpack click delivered');
    check(await evaluate('window.__t10InputAudit.at(-1).trusted && window.__t10InputAudit.at(-1).matched'), 'backpack receives the expected trusted native click');
    check(await evaluate("document.getElementById('delvePanel').hidden && document.querySelectorAll('.modal-back').length===1"), 'backpack factory owns the single main layer');
    check(await evaluate("!!document.activeElement.closest('#delveInventoryModal')"), 'blocking backpack moves keyboard focus inside its dialog');
    const writes = await evaluate('window.__writes.length');
    const p = await evaluate("(() => {const r=document.querySelector('#delveInventoryModal .modal').getBoundingClientRect(); return {x:r.x+8,y:r.y+80};})()");
    await pointer(p.x,p.y); await key('w','KeyW'); await key(' ','Space');
    check(await evaluate('window.__writes.length') === writes, 'backpack pointer and game hotkeys cannot penetrate to map');
    await key('Escape');
    check(await evaluate("document.activeElement.matches('.delve-tools [data-panel=inventory]') && window.__canvas===document.querySelector('#map3d canvas') && window.__dndDebug.resources().observers===1"), 'modal Escape restores trigger and retains one renderer/observer');
  }
  // Preserve this document's native input evidence before later Page.reload
  // replaces its window. A successful reload must not erase the audit record.
  fs.writeFileSync(path.join(process.env.VERIFY_ARTIFACT_DIR,'t10-input-audit.json'),JSON.stringify(await evaluate('window.__t10InputAudit'),null,2));
  await click('.delve-tools [data-panel="character"]');
  await click('#btnOpenDelveInventory');
  // The modal is created synchronously by the click; naming the precondition keeps a
  // swallowed click from masquerading as a broken pane/trigger restore below.
  await wait("!!document.getElementById('delveInventoryModal')", 'inventory modal opened from the character pane');
  await key('Escape');
  // The restore itself is synchronous, but the close runs inside the same event turn as
  // the panel manager and any in-flight HUD render: settle on the condition instead of
  // reading once (same final condition, no weaker assertion).
  await wait("window.__dndDebug.panel()==='character' && document.activeElement.id==='btnOpenDelveInventory'", 'closing a factory opened inside character restores that pane and its trigger');
  check(await evaluate("window.__dndDebug.panel()==='character' && document.activeElement.id==='btnOpenDelveInventory'"), 'closing a factory opened inside character restores that pane and its trigger');
  await key('Escape');
  check(await evaluate("document.activeElement.matches('.delve-tools [data-panel=character]')"), 'closing the restored character pane returns to its original dock trigger');
  await click('#immersiveBtn');
  check(await evaluate("!document.body.classList.contains('map-first') && localStorage.getItem('dnd_delve_layout')==='tactical'"), 'tactical layout preference is persisted');
  await click('#immersiveBtn');
  await click('#viewToggleMinimap');
  await send('Emulation.setDeviceMetricsOverride', { width:844,height:390,deviceScaleFactor:1,mobile:true });
  // Pick a real free neighbouring tile near the spawn, using current canvas rect.
  const state = (await api('GET', '/api/game/'+saveId)).state, hero = state.entities.find(e=>e.kind==='player');
  const target = [[hero.x+1,hero.y],[hero.x,hero.y+1],[hero.x-1,hero.y]].find(([x,y]) => state.map.rows[y]?.[x] !== '#' && !state.entities.some(e=>e.x===x && e.y===y) && !state.objects.some(o=>o.x===x && o.y===y));
  check(!!target, 'free tile fixture exists');
  const tile = await evaluate(`(() => {const c=document.getElementById('mapCanvas'),r=c.getBoundingClientRect(); return {x:r.x+(${target[0]}+.5)*34*r.width/c.width, y:r.y+(${target[1]}+.5)*34*r.height/c.height};})()`);
  await pointer(tile.x,tile.y);
  await wait(`window.__dndDebug.playerTile().x===${target[0]+.5} && window.__dndDebug.playerTile().z===${target[1]+.5}`, '2D click final tile');
  check((await api('GET','/api/game/'+saveId)).state.entities.some(e=>e.kind==='player' && e.x===target[0] && e.y===target[1]), 'real 2D click converges after viewport resize');
  await click('#viewToggle2D');
  await send('Emulation.setDeviceMetricsOverride', { width:1280,height:800,deviceScaleFactor:1,mobile:false });
  await wait("!window.__dndDebug.modelState().animating && Math.hypot(window.__dndDebug.camera().camTarget.x-window.__dndDebug.playerTile().x,window.__dndDebug.camera().camTarget.z-window.__dndDebug.playerTile().z)<.1", 'model and camera converge');
  const tile3 = await evaluate(`(() => {const p=window.__dndDebug.tileToScreen(${hero.x},${hero.y}),r=document.querySelector('#map3d canvas').getBoundingClientRect(); return {x:r.x+p.x,y:r.y+p.y};})()`);
  await pointer(tile3.x,tile3.y);
  await wait(`window.__dndDebug.playerTile().x===${hero.x+.5} && window.__dndDebug.playerTile().z===${hero.y+.5}`, '3D raycast final tile');
  check(await evaluate('window.__canvas===document.querySelector("#map3d canvas")'), 'real 3D raycast works after 2D/3D and resize without rebuilding renderer');

  // Isolated disk fixture uses the real engine to enter combat. UI tests never
  // depend on rolled damage/initiative values or rewrite production saves.
  check(!!process.env.DATA_DIR && process.env.AI_DND_TEST_CONTAINER === '1', 'combat fixture is restricted to dedicated container');
  const savePath=path.join(process.env.DATA_DIR,'saves',saveId+'.json');
  const combat=JSON.parse(fs.readFileSync(savePath,'utf8'));
  const monster=combat.entities.find(e=>e.kind==='monster' && e.alive!==false);
  monster.x=hero.x+1; monster.y=hero.y;
  engine.startCombat(combat,[monster.id]); combat.combat.turnIdx=combat.combat.order.findIndex(o=>o.id==='player');
  combat.rev++; fs.writeFileSync(savePath,JSON.stringify(combat));
  await send('Page.reload'); await wait("document.querySelector('#coreHud [data-act=attack]')", 'combat HUD');
  check(await evaluate("document.querySelector('#coreHud [data-act=endturn]') && document.querySelector('#coreHud .turn-economy-bar') && document.getElementById('heroHud').textContent.includes('HP')"), 'combat preserves HP, round, economy, attack and end turn');
  await shot('B-combat-desktop');
  await send('Emulation.setDeviceMetricsOverride', { width:390,height:844,deviceScaleFactor:1,mobile:true }); await shot('C-combat-portrait');
  await send('Emulation.setDeviceMetricsOverride', { width:844,height:390,deviceScaleFactor:1,mobile:true }); await shot('C-combat-landscape');
  await click('.delve-tools [data-panel="inventory"]'); await shot('B-backpack-landscape'); await key('Escape');
  for (let i=0;i<2;i++) {
    await evaluate("window.__oldCanvas=document.querySelector('#map3d canvas'); location.hash='#/'");
    await wait("document.getElementById('quickName') && window.__dndDebug.resources().renderers===0", 'renderer disposed after leaving');
    check(await evaluate("window.__dndDebug.resources().observers===0 && !window.__oldCanvas.isConnected"), 'leaving disconnects observer, canvas and renderer');
    await mount(); check(await evaluate('window.__dndDebug.resources().renderers===1 && window.__dndDebug.resources().observers===1'), 'returning mounts exactly one renderer and observer');
  }
  const endedCombat=JSON.parse(fs.readFileSync(savePath,'utf8'));
  endedCombat.entities.find(e=>e.id===monster.id).fled=true;
  engine.checkCombatEnd(endedCombat,[]); endedCombat.rev++;
  fs.writeFileSync(savePath,JSON.stringify(endedCombat));
  await send('Page.reload'); await wait("document.querySelector('#coreHud [data-act=retreat]')", 'post-combat exploration controls');
  await evaluate(`(() => {
    const original=window.fetch; window.__heldSettle=false;
    window.fetch=(url,init)=>String(url).includes('/city/sync-delve') ? new Promise(resolve=>{
      window.__heldSettle=true; window.__releaseSettle=()=>resolve(original(url,init));
    }) : original(url,init);
  })()`);
  await click('#coreHud [data-act="retreat"]'); await wait('window.__heldSettle', 'settlement pending');
  const hash=await evaluate('location.hash');
  await key('Escape'); await key('b','KeyB'); await key('v','KeyV');
  await evaluate("document.getElementById('closeSummaryX').click(); document.querySelector('#pauseMenu a').click(); document.querySelector('.sumNavBtn').click(); document.querySelector('.delve-tools [data-panel=character]').click()");
  check(await evaluate('location.hash')===hash && await evaluate("document.getElementById('summaryModal') && document.querySelectorAll('.modal-back').length===1 && document.getElementById('delvePanel').hidden"), 'pending settlement resists Escape, shortcuts, close, tools and every return entry');
  await evaluate("location.hash='#/'");
  await wait(`location.hash === '${hash}' && document.getElementById('summaryModal')`, 'route guard retains pending settlement');
  check(await evaluate('location.hash')===hash, 'browser-style route change cannot bypass settlement lock');
  await evaluate('window.__releaseSettle()'); await wait("document.querySelector('.sumNavBtn').getAttribute('aria-disabled')==='false'", 'settlement confirmed');
  await click('#closeSummaryX'); await shot('B-settled-review');
  check(errors.length===0, 'no Chromium runtime errors: '+JSON.stringify(errors));
} catch(error) {
  failed++; console.error('  FAIL: '+error.stack);
  if(ws) {
    await captureBrowserArtifacts('t10-failure',[PORT]);
    try { fs.writeFileSync(path.join(process.env.VERIFY_ARTIFACT_DIR,'t10-failure-input.json'),JSON.stringify(await evaluate('({inputs:window.__t10InputAudit,panel:window.__dndDebug?.panel(),viewport:[innerWidth,innerHeight]})'),null,2)); }
    catch(auditError) { failed++; console.error('Input audit failed: '+auditError.stack); }
  }
} finally {
  try {
    await closeBrowser(browser, ws, send, profile);
  } catch(error) { failed++; console.error('Browser cleanup failed: '+error.stack); }
  for(const call of pending.values()) clearTimeout(call.timer);
  if(saveId) await api('DELETE','/api/game/'+saveId).catch(e=>{ failed++; console.error('cleanup: '+e.message); });
  if(characterId) await api('DELETE','/api/characters/'+characterId).catch(e=>{ failed++; console.error('cleanup: '+e.message); });
}
console.log(`T10 CDP: ${passed} passed, ${failed} failed`);
if(failed) process.exitCode=1;
