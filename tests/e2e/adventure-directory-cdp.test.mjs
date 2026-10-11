// M1: native file import/export and actual pointer input through the normal catalog.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { assertTestContainer } from '../../scripts/test-container.mjs';
import { browserBinary, softwareWebGLFlags, requireWebGL, captureBrowserArtifacts, closeBrowser } from './_browser-runtime.mjs';
assertTestContainer();
const BASE = process.env.BASE_URL || 'http://localhost:' + (process.env.PORT || 3000), PORT = 9237;
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-dnd-m1-cdp-')), pending = new Map(), chars = [], saves = [], errors = [];
const bundle = JSON.parse(fs.readFileSync('tests/fixtures/content/adventure-directory-pack.json', 'utf8'));
const downloads = path.join(process.env.VERIFY_ARTIFACT_DIR, 'm1-downloads');
fs.mkdirSync(downloads, { recursive: true });
let ws, browserSocket, browser, sequence = 0, passed = 0, failed = 0;
const nativeDownloads = new Map();
function check(value, message) { if (!value) throw new Error(message); passed++; console.log('  PASS: ' + message); }
function send(method, params = {}, session = ws) { return new Promise((resolve, reject) => { const id = ++sequence, timer = setTimeout(() => { pending.delete(id); reject(new Error('CDP timeout: ' + method)); }, 20000); pending.set(id, { resolve, reject, timer }); session.send(JSON.stringify({ id, method, params })); }); }
async function evaluate(expression) { const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails)); return r.result.value; }
async function wait(expression, label) { const until = Date.now() + 15000; while (Date.now() < until) { if (await evaluate('!!(' + expression + ')')) return; await new Promise(r => setTimeout(r, 100)); } throw new Error('Timed out: ' + label); }
async function api(method, url, body) { const r = await fetch(BASE + url, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }), data = await r.json(); if (!r.ok) throw new Error(url + ': ' + JSON.stringify(data)); return data; }
async function go(hash) { await evaluate(`(async()=>{const m=await import('/js/app.js');history.replaceState(null,'',${JSON.stringify(hash)});await m.navigate();})()`); }
async function locale(value) { await evaluate(`import('/js/i18n.js').then(m=>m.setLocale(${JSON.stringify(value)}))`); }
async function pointer(point) { await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 }); await send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 }); }
async function click(selector) {
  const r = await evaluate(`(async()=>{let el=document.querySelector(${JSON.stringify(selector)});if(!el||el.disabled)return {error:'missing or disabled'};el.scrollIntoView({block:'center'});await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));el=document.querySelector(${JSON.stringify(selector)});const b=(el.matches('[data-node-id]')?el.querySelector('.waypoint-hit'):el).getBoundingClientRect(),point={x:b.x+b.width/2,y:b.y+b.height/2},hit=document.elementFromPoint(point.x,point.y);return el.contains(hit)?{point}:{error:'occluded',hit:hit?.outerHTML.slice(0,200),point};})()`);
  check(!r.error && !!r.point, 'actual pointer ' + selector + ' ' + (r.error ? JSON.stringify(r) : '')); await pointer(r.point);
}
async function search(text) {
  await click('[data-adventure-search]');
  await evaluate("document.querySelector('[data-adventure-search]').select()");
  await send('Input.insertText', { text });
  check(await evaluate(`document.querySelector('[data-adventure-search]').value===${JSON.stringify(text)}`), 'native search input replaces previous query');
}
async function source(value) {
  const index = await evaluate(`Array.from(document.querySelector('[data-adventure-source]').options).findIndex(o=>o.value===${JSON.stringify(value)})`);
  check(index >= 0, 'source is available: ' + value);
  await click('[data-adventure-source]');
  const keys = { Home: 36, ArrowDown: 40, Enter: 13 };
  for (const key of ['Home', ...Array(index).fill('ArrowDown'), 'Enter']) {
    const params = { key, code: key, windowsVirtualKeyCode: keys[key], nativeVirtualKeyCode: keys[key] };
    await send('Input.dispatchKeyEvent', { type: 'keyDown', ...params });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', ...params });
  }
  check(await evaluate(`document.querySelector('[data-adventure-source]').value===${JSON.stringify(value)}`), 'native source selection applied');
}
async function shot(name) { await captureBrowserArtifacts('m1-' + name, [PORT]); for (const ext of ['png', 'json']) check(fs.existsSync(path.join(process.env.VERIFY_ARTIFACT_DIR, 'screenshots', 'm1-' + name + '-' + PORT + '-0.' + ext)), 'saved ' + name + ' ' + ext); }
async function nativeImport(file) {
  await go('#/'); await wait("document.querySelector('#packList [data-packexport]')", 'normal import UI and loaded pack list'); await click('#packImportBtn');
  const doc = await send('DOM.getDocument'), input = await send('DOM.querySelector', { nodeId: doc.root.nodeId, selector: '#packFile' });
  await send('DOM.setFileInputFiles', { nodeId: input.nodeId, files: [file] });
  await wait("document.querySelector('[data-packexport=m1-lanterns]')", 'pack appears after real file import');
}
async function tile(x, y) {
  const point = await evaluate(`(()=>{const c=document.getElementById('mapCanvas'),r=c.getBoundingClientRect();const point={x:r.left+(${x}+.5)*r.width/9,y:r.top+(${y}+.5)*r.height/5};return document.elementFromPoint(point.x,point.y)===c?point:null;})()`);
  check(!!point, 'real canvas tile is clickable: ' + x + ',' + y); await pointer(point);
}
async function canvasAction(id, x, y, predicate) {
  await tile(x, y);
  const until = Date.now() + 15000;
  while (Date.now() < until) { const s = (await api('GET', '/api/game/' + id)).state; if (predicate(s)) { await wait('window.__dndDebug.rev()>=' + s.rev, 'final state adopted'); return s; } await new Promise(r => setTimeout(r, 100)); }
  throw new Error('Canvas did not converge: ' + x + ',' + y);
}
function roadFixture(charId) {
  // A known engine instance avoids choosing a random road template. All subsequent
  // status/trigger/proceed/start requests use production routes and no mocked rewards.
  const file = path.join(process.env.DATA_DIR, 'characters.json'), roster = JSON.parse(fs.readFileSync(file, 'utf8'));
  roster.find(c => c.id === charId).currentRoadEncounter = { id: 'shrine', instanceId: 'm1_' + charId, options: ['pray', 'offer', 'proceed'], resolved: false, resolvedChoice: null, result: null };
  fs.writeFileSync(file, JSON.stringify(roster));
}
async function finish(id, charId, lang) {
  await wait("document.getElementById('mapCanvas')&&window.__dndDebug", 'new adventure mounted');
  check((await api('GET', '/api/game/' + id)).state.mapId === 'm1-lantern-room', 'directory starts the selected new stable ID');
  await canvasAction(id, 5, 2, s => s.entities.find(e => e.kind === 'player').x === 5 && s.entities.find(e => e.kind === 'player').y === 2);
  await canvasAction(id, 6, 2, s => s.flags.hasRelic);
  await canvasAction(id, 1, 2, s => s.mode === 'victory');
  await wait("document.querySelector('#summaryModal .sumNavBtn[aria-disabled=false]')", 'real settlement completed');
  await shot(lang + '-victory');
  const before = await api('GET', '/api/characters/' + charId);
  const duplicate = await api('POST', '/api/city/sync-delve', { charId, delveStateId: id });
  check(duplicate.duplicate && duplicate.receipt.mapId === 'm1-lantern-room' && JSON.stringify(await api('GET', '/api/characters/' + charId)) === JSON.stringify(before), 'one settlement; duplicate cannot change hero');
  await click('#summaryModal .sumNavBtn'); await wait("document.querySelector('[data-town-adventures]')", 'return to normal town'); await shot(lang + '-returned-town');
}
try {
  browser = spawn(browserBinary(), ['--headless=new', ...softwareWebGLFlags(), '--no-sandbox', '--disable-dev-shm-usage', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=' + PORT, '--user-data-dir=' + profile, '--window-size=1440,900', BASE + '/#/'], { detached: true, stdio: 'ignore' });
  let tab; for (let n = 0; n < 70 && !tab; n++) { tab = (await fetch('http://127.0.0.1:' + PORT + '/json').then(r => r.json()).catch(() => [])).find(t => t.type === 'page'); if (!tab) await new Promise(r => setTimeout(r, 100)); } if (!tab) throw new Error('Required Chromium did not start');
  ws = new WebSocket(tab.webSocketDebuggerUrl); await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  const onMessage = event => { const r = JSON.parse(event.data); if (r.method === 'Runtime.exceptionThrown') { errors.push(r.params.exceptionDetails); console.error('Browser exception: ' + JSON.stringify(r.params.exceptionDetails)); } if (r.method === 'Browser.downloadWillBegin' || r.method === 'Browser.downloadProgress') nativeDownloads.set(r.params.guid, { ...nativeDownloads.get(r.params.guid), ...r.params }); const call = pending.get(r.id); if (!call) return; pending.delete(r.id); clearTimeout(call.timer); if (r.error) call.reject(new Error(r.error.message)); else call.resolve(r.result); };
  ws.onmessage = onMessage;
  await send('Page.enable'); await send('Runtime.enable'); await requireWebGL(send); await send('Page.setInterceptFileChooserDialog', { enabled: true });
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  const version = await fetch('http://127.0.0.1:' + PORT + '/json/version').then(r => r.json());
  browserSocket = new WebSocket(version.webSocketDebuggerUrl); await new Promise((resolve,reject)=>{browserSocket.onopen=resolve;browserSocket.onerror=reject;}); browserSocket.onmessage=onMessage;
  await send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloads, eventsEnabled: true }, browserSocket);
  await wait("document.getElementById('quickName')", 'home ready');
  await evaluate("localStorage.setItem('dnd_default_view','2d');localStorage.setItem('dnd_3d','off');localStorage.setItem('aiDnd.tutorial.v1',JSON.stringify({status:'skipped'}));window.__m1Writes=[];const original=window.fetch;window.fetch=(url,init)=>{if(init?.method&&!['GET','HEAD','OPTIONS'].includes(init.method))window.__m1Writes.push(String(url));return original(url,init)};");
  await nativeImport(path.resolve('tests/fixtures/content/adventure-directory-pack.json'));
  for (const lang of ['en', 'zh-CN']) {
    const char = await api('POST', '/api/characters', { presetId: 'guardian', name: 'M1 Lantern Explorer ' + lang }); chars.push(char.id);
    const town = '#/overworld?char=' + char.id;
    for (const [width, height] of [[1280, 720], [1440, 900]]) {
      await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false }); await locale(lang); await go(town);
      check(await evaluate("document.querySelectorAll('[data-adventure-id]').length===14&&document.documentElement.scrollWidth<=innerWidth"), 'all maps and system entries fit desktop width ' + width + ' ' + lang);
      const before = JSON.stringify(await api('GET', '/api/characters/' + char.id));
      await search(''); await source('m1-lanterns');
      check(await evaluate("[...document.querySelectorAll('[data-adventure-id]')].filter(e=>!e.hidden).length===2"), 'source filter discovers both imported maps');
      await source('');
      await search('m1-lantern-room');
      check(await evaluate("[...document.querySelectorAll('[data-adventure-id]')].filter(e=>!e.hidden).length===1"), 'search finds metadata-free new map');
      await evaluate('window.__m1Search=document.querySelector("[data-adventure-search]");window.__m1WriteMark=window.__m1Writes.length');
      await locale(lang === 'en' ? 'zh-CN' : 'en');
      check(await evaluate("window.__m1Search===document.activeElement&&window.__m1Search.value==='m1-lantern-room'&&window.__m1Writes.length===window.__m1WriteMark"), 'language preserves search/focus with no writes'); await locale(lang);
      check(await evaluate("!document.querySelector('[data-adventure-id=m1-lantern-room] [data-adventure-original]').hidden"), 'original-only content clearly marked in ' + lang);
      await click('[data-adventure-id=m1-lantern-room]');
      check(await evaluate("document.getElementById('embarkBtn').dataset.mapId==='m1-lantern-room'&&document.querySelector('[data-adventure-search]').value==='m1-lantern-room'"), 'list-only adventure owns real departure controls');
      check(JSON.stringify(await api('GET', '/api/characters/' + char.id)) === before, 'search, selection and language consume no resources');
      await evaluate("document.querySelector('[data-town-adventures]').scrollIntoView({block:'center'})"); await shot(lang + '-directory-' + width);
      await search('m1-eastern-room'); await click('[data-adventure-id=m1-eastern-room]');
      await click('[data-node-id=m1-eastern-room]');
      check(await evaluate("document.getElementById('embarkBtn').dataset.mapId==='m1-eastern-room'&&document.querySelector('[data-road-from=m1-eastern-room][data-road-to=oakhaven]')&&document.querySelector('[data-node-id=m1-eastern-room]').ownerSVGElement===document.querySelector('.region-svg')"), 'imported public waypoint/road paints and accepts real click');
      await evaluate("document.querySelector('.region-map-container').scrollIntoView({block:'center'})"); await shot(lang + '-waypoint-' + width);
    }
    await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await search('m1-lantern-room'); await click('[data-adventure-id=m1-lantern-room]');
    await evaluate("document.getElementById('dispatchCompanion').value='none'"); roadFixture(char.id);
    await click('#embarkBtn'); await wait("document.getElementById('optProceed')", 'real road instance'); await click('#optProceed'); await wait("document.getElementById('continueDelveBtn')", 'confirmed road choice'); await click('#continueDelveBtn');
    await wait("location.hash.startsWith('#/play/save_')", 'normal departure navigated'); const id = (await evaluate('location.hash')).split('/')[2]; saves.push(id);
    await finish(id, char.id, lang);
    await go('#/play/new?char=' + char.id); await search('m1-lantern-room'); await click('[data-adventure-id=m1-lantern-room]');
    await evaluate("document.querySelector('input[name=companionPick][value=none]').checked=true"); await shot(lang + '-prepare');
    await click('#beginBtn'); await wait("location.hash.startsWith('#/play/save_')", 'prepare departure navigated'); const prepId = (await evaluate('location.hash')).split('/')[2]; saves.push(prepId);
    check((await api('GET', '/api/game/' + prepId)).state.mapId === 'm1-lantern-room', 'same directory works through preparation');
    // Delete the selected entry while a prepare page is open, then exercise its real refresh button.
    await go('#/play/new?char=' + char.id); await search('m1-lantern-room'); await click('[data-adventure-id=m1-lantern-room]');
    await api('DELETE', '/api/content/pack/' + bundle.pack.id); await click('[data-adventure-refresh]');
    await wait("!document.querySelector('[data-adventure-id=m1-lantern-room]')&&!document.getElementById('beginBtn').disabled", 'deleted selection replaced');
    check(await evaluate("document.querySelector('input[name=mapPick]:checked').value==='crypt'"), 'prepare falls back to valid server entry');
    await nativeImport(path.resolve('tests/fixtures/content/adventure-directory-pack.json'));
    await go(town + '&node=m1-lantern-room'); check(await evaluate("document.getElementById('embarkBtn').dataset.mapId==='m1-lantern-room'"), 'direct map-id link resolves list-only entry');
    await api('DELETE', '/api/content/pack/' + bundle.pack.id); await click('[data-adventure-refresh]'); await wait("!document.querySelector('[data-adventure-id=m1-lantern-room]')", 'town directory updated after delete');
    check(await evaluate("document.getElementById('enterCityFromMapBtn')&&!document.getElementById('embarkBtn')"), 'town returns selected deleted entry to valid town hub');
    await nativeImport(path.resolve('tests/fixtures/content/adventure-directory-pack.json'));
    check((await api('GET', '/api/game/' + prepId)).state.mapId === 'm1-lantern-room', 'old activity remains readable through delete and reimport');
  }
  // A stale start after external deletion must recover without requiring a reload.
  await go('#/play/new?char=' + chars[0]); await search('m1-lantern-room'); await click('[data-adventure-id=m1-lantern-room]');
  const staleBefore = JSON.stringify(await api('GET', '/api/characters/' + chars[0]));
  await api('DELETE', '/api/content/pack/' + bundle.pack.id); await click('#beginBtn');
  await wait("!document.querySelector('[data-adventure-id=m1-lantern-room]')&&!document.getElementById('beginBtn').disabled", 'unknown-map error refreshes stale selection');
  check(await evaluate("document.querySelector('input[name=mapPick]:checked').value==='crypt'") && JSON.stringify(await api('GET', '/api/characters/' + chars[0])) === staleBefore, 'stale prepare failure selects valid entry and consumes nothing');
  await nativeImport(path.resolve('tests/fixtures/content/adventure-directory-pack.json'));
  await go('#/'); await wait("document.querySelector('[data-packexport=m1-lanterns]')", 'normal export UI'); await click('[data-packexport=m1-lanterns]');
  const exported = path.join(downloads, bundle.pack.id + '.json'), until = Date.now() + 15000;
  // A final filename can exist while Chromium is still writing it. Wait for the
  // actual browser completion event before reading/parsing, never retry JSON parse.
  while (![...nativeDownloads.values()].some(d=>d.suggestedFilename===bundle.pack.id+'.json'&&d.state==='completed') && Date.now() < until) await new Promise(r => setTimeout(r, 100));
  fs.writeFileSync(path.join(process.env.VERIFY_ARTIFACT_DIR,'m1-download-events.json'),JSON.stringify([...nativeDownloads.values()],null,2));
  check([...nativeDownloads.values()].some(d=>d.suggestedFilename===bundle.pack.id+'.json'&&d.state==='completed')&&fs.existsSync(exported)&&JSON.parse(fs.readFileSync(exported,'utf8')).maps.length===2, 'native download completion retains the complete two-map bundle');
  await api('DELETE', '/api/content/pack/' + bundle.pack.id); await nativeImport(exported);
  const charId = chars[0]; await go('#/play/new?char=' + charId); await search('m1-lantern-room'); await click('[data-adventure-id=m1-lantern-room]');
  await evaluate("document.querySelector('input[name=companionPick][value=none]').checked=true"); await locale('en'); await click('#beginBtn'); await wait("location.hash.startsWith('#/play/save_')", 'exported pack playable');
  const id = (await evaluate('location.hash')).split('/')[2]; saves.push(id); await finish(id, charId, 'reimport');
  await go('#/create');
  check(await evaluate("(async()=>!(await import('/js/map3d.js')).map3DResources().renderers)()"), 'directory/prepare leaving views leaves no renderer');
  check(errors.length === 0, 'no browser runtime exceptions');
} catch (error) { failed++; console.error('FAIL M1 CDP: ' + error.stack); await shot('failure').catch(e => { failed++; console.error('Failed evidence: ' + e.stack); }); }
finally {
  browserSocket?.close();
  try { await closeBrowser(browser, ws, send, profile); } catch (error) { failed++; console.error('Browser cleanup failed: ' + error.stack); }
  for (const id of saves) try { await api('DELETE', '/api/game/' + id); } catch (error) { failed++; console.error('Save cleanup failed: ' + error.stack); }
  for (const id of chars) try { await api('DELETE', '/api/characters/' + id); } catch (error) { failed++; console.error('Hero cleanup failed: ' + error.stack); }
  try { const c = await api('GET', '/api/content'); if (c.packs.some(p => p.id === bundle.pack.id)) await api('DELETE', '/api/content/pack/' + bundle.pack.id); } catch (error) { failed++; console.error('Pack cleanup failed: ' + error.stack); }
  console.log('M1 CDP: ' + passed + ' passed, ' + failed + ' failed.');
}
if (failed) process.exitCode = 1;
