// L1: real desktop pointer/keyboard/fullscreen, with authoritative-state invariants.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import engine from '../../server/game/engine.js';
import { assertTestContainer } from '../../scripts/test-container.mjs';
import { browserBinary, softwareWebGLFlags, requireWebGL, captureBrowserArtifacts, closeBrowser } from './_browser-runtime.mjs';
assertTestContainer();
const BASE = process.env.BASE_URL || 'http://localhost:' + (process.env.PORT || 3000), PORT = 9238;
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-dnd-l1-')), pending = new Map(), chars = [], saves = [], errors = [];
const sizes = [[1280,720],[1440,900],[1920,1080],[2560,1080]];
const bundle = JSON.parse(fs.readFileSync('tests/fixtures/content/adventure-directory-pack.json', 'utf8'));
bundle.pack.id = 'l1-label-demo';
bundle.maps[0].id = 'l1-list-room'; bundle.maps[1].id = 'l1-long-room';
bundle.maps[1].name = 'The Lantern Keep Beyond the Eastern Mountain Pass';
bundle.maps[1].localized = { 'zh-CN': { name: '东方群山隘口之外的古老灯笼城堡与守望者庭院' } };
let ws, browser, sequence = 0, passed = 0, failed = 0, characterId, saveId;
function check(value, message) { if (!value) throw new Error(message); passed++; console.log('  PASS: ' + message); }
// Independent state audits retain a red suite while allowing later lifecycle evidence.
function audit(value, message) { if(value){passed++;console.log('  PASS: '+message);}else{failed++;console.error('  FAIL: '+message);} }
function send(method, params = {}) { return new Promise((resolve,reject) => { const id=++sequence,timer=setTimeout(()=>{pending.delete(id);reject(new Error('CDP timeout: '+method));},20000);pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params})); }); }
async function evaluate(expression) { const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw new Error(JSON.stringify(r.exceptionDetails));return r.result.value; }
async function wait(expression,label) { const until=Date.now()+15000;while(Date.now()<until){if(await evaluate('!!('+expression+')'))return;await new Promise(r=>setTimeout(r,100));}throw new Error('Timed out: '+label); }
async function api(method,url,body) { const r=await fetch(BASE+url,{method,headers:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)}),data=await r.json();if(!r.ok)throw new Error(url+': '+JSON.stringify(data));return data; }
async function go(hash) { await evaluate(`(async()=>{const m=await import('/js/app.js');history.replaceState(null,'',${JSON.stringify(hash)});await m.navigate();})()`); }
async function locale(value) { await evaluate(`import('/js/i18n.js').then(m=>m.setLocale(${JSON.stringify(value)}))`); }
async function size(width,height) { await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});await evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))'); }
async function key(key,code=key) { const vk={Escape:27,Enter:13,' ':32}[key];for(const type of ['keyDown','keyUp'])await send('Input.dispatchKeyEvent',{type,key,code,...(vk?{windowsVirtualKeyCode:vk,nativeVirtualKeyCode:vk}:{})}); }
async function click(selector) {
  const r=await evaluate(`(async()=>{let el=document.querySelector(${JSON.stringify(selector)});if(!el||el.disabled)return {error:'missing/disabled'};el.scrollIntoView({block:'nearest'});await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));el=document.querySelector(${JSON.stringify(selector)});const b=(el.matches('[data-node-id]')?el.querySelector('.waypoint-hit'):el).getBoundingClientRect(),point={x:b.x+b.width/2,y:b.y+b.height/2},hit=document.elementFromPoint(point.x,point.y);return el.contains(hit)?{point}:{error:'occluded',hit:hit?.outerHTML.slice(0,180),point};})()`);
  check(!!r.point&&!r.error,'real pointer '+selector+' '+(r.error?JSON.stringify(r):''));
  for(const type of ['mousePressed','mouseReleased'])await send('Input.dispatchMouseEvent',{type,...r.point,button:'left',clickCount:1});
}
async function shot(name) { await captureBrowserArtifacts('l1-'+name,[PORT]);for(const ext of ['png','json'])check(fs.existsSync(path.join(process.env.VERIFY_ARTIFACT_DIR,'screenshots','l1-'+name+'-'+PORT+'-0.'+ext)),'saved '+name+' '+ext); }
async function full(on,selector='[data-app-fullscreen]') {
  const before=await evaluate('window.__l1NativeFull');await click(selector);
  await wait(on?'document.fullscreenElement===document.documentElement':'!document.fullscreenElement','native fullscreen '+on);
  await wait('window.__l1NativeFull>'+before,'trusted fullscreenchange');
  await wait("[...document.querySelectorAll('[data-app-fullscreen]')].every(b=>!b.disabled)",'fullscreen request completed and controls ready');
  check(await evaluate(`[...document.querySelectorAll('[data-app-fullscreen]')].every(b=>b.getAttribute('aria-pressed')==='${on}')`),'all fullscreen controls follow native state');
}
function editSave(id,edit) { const file=path.join(process.env.DATA_DIR,'saves',id+'.json'),stage=file+'.l1.tmp',state=JSON.parse(fs.readFileSync(file,'utf8'));edit(state);state.rev++;try{fs.writeFileSync(stage,JSON.stringify(state));fs.renameSync(stage,file);}finally{fs.rmSync(stage,{force:true});} }
async function open(id) { await go('#/play/'+id);await wait("document.querySelector('#map3d canvas')&&window.__dndDebug.resources().renderers===1",'real 3D view'); }
try {
  characterId=(await api('POST','/api/characters',{presetId:'guardian',name:'L1 Desktop Explorer'})).id;chars.push(characterId);
  await api('POST','/api/content/import',bundle);
  saveId=(await api('POST','/api/game/start',{characterId,mapId:'crypt',difficulty:'easy',bringAlly:false})).state.id;saves.push(saveId);
  browser=spawn(browserBinary(),['--headless=new',...softwareWebGLFlags(),'--no-sandbox','--disable-dev-shm-usage','--no-first-run','--no-default-browser-check','--remote-debugging-port='+PORT,'--user-data-dir='+profile,'--window-size=1440,900',BASE+'/#/'],{detached:true,stdio:'ignore'});
  let tab;for(let n=0;n<70&&!tab;n++){tab=(await fetch('http://127.0.0.1:'+PORT+'/json').then(r=>r.json()).catch(()=>[])).find(t=>t.type==='page');if(!tab)await new Promise(r=>setTimeout(r,100));}if(!tab)throw new Error('Required Chromium unavailable');
  ws=new WebSocket(tab.webSocketDebuggerUrl);await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject;});ws.onmessage=event=>{const r=JSON.parse(event.data);if(r.method==='Runtime.exceptionThrown'){errors.push(r.params.exceptionDetails);console.error(JSON.stringify(r.params.exceptionDetails));}const call=pending.get(r.id);if(!call)return;pending.delete(r.id);clearTimeout(call.timer);if(r.error)call.reject(new Error(r.error.message));else call.resolve(r.result);};
  await send('Page.enable');await send('Runtime.enable');await requireWebGL(send);await wait("document.getElementById('quickName')",'home');
  await evaluate(`(()=>{
    localStorage.setItem('aiDnd.tutorial.v1',JSON.stringify({status:'skipped'}));localStorage.removeItem('dnd_delve_layout');
    window.__l1NativeFull=0;document.addEventListener('fullscreenchange',e=>{if(e.isTrusted)window.__l1NativeFull++;});
    window.__l1FullListeners=new Set();const add=document.addEventListener.bind(document),remove=document.removeEventListener.bind(document);
    document.addEventListener=(type,fn,...args)=>{if(type==='fullscreenchange'||type==='fullscreenerror')window.__l1FullListeners.add(fn);return add(type,fn,...args);};
    document.removeEventListener=(type,fn,...args)=>{if(type==='fullscreenchange'||type==='fullscreenerror')window.__l1FullListeners.delete(fn);return remove(type,fn,...args);};
    window.__l1Observers=new Set();const NativeObserver=ResizeObserver;window.ResizeObserver=class extends NativeObserver{observe(...args){window.__l1Observers.add(this);return super.observe(...args);}disconnect(){window.__l1Observers.delete(this);return super.disconnect();}};
    window.__l1Writes=[];const original=window.fetch;window.fetch=(url,init)=>{const readStatus=init?.method==='POST'&&String(url).endsWith('/road-encounter')&&init.body==='{"action":"status"}';if(init?.method&&!['GET','HEAD','OPTIONS'].includes(init.method)&&!readStatus)window.__l1Writes.push({url:String(url),method:init.method,body:init.body});return original(url,init);};
  })()`);
  const heroBefore=JSON.stringify(await api('GET','/api/characters/'+characterId));
  for(const [width,height] of sizes)for(const lang of ['en','zh-CN']) {
    await size(width,height);await locale(lang);await go('#/overworld?char='+characterId+'&node=crypt');
    await wait("document.querySelector('.waypoint-label-box').getBoundingClientRect().width>10",'SVG layout');
    const metrics=await evaluate(`(()=>{
      const svg=document.querySelector('.region-svg'),groups=[...svg.querySelectorAll('[data-node-id]')],rects=groups.map(g=>({id:g.dataset.nodeId,label:g.querySelector('.waypoint-label-box').getBoundingClientRect().toJSON(),marker:g.querySelector('.waypoint-hit').getBoundingClientRect().toJSON()}));
      const overlap=(a,b)=>a.x<b.right-1&&a.right>b.x+1&&a.y<b.bottom-1&&a.bottom>b.y+1;
      const bad=[];for(let i=0;i<rects.length;i++){for(let j=i+1;j<rects.length;j++){const a=rects[i].marker,b=rects[j].marker;if(overlap(rects[i].label,rects[j].label)||Math.hypot(a.x+a.width/2-b.x-b.width/2,a.y+a.height/2-b.y-b.height/2)<(a.width+b.width)/2+3)bad.push([rects[i].id,rects[j].id]);}for(const r of rects)if(overlap(rects[i].label,r.marker))bad.push([rects[i].id,'marker',r.id]);}
      const fit=['[data-town-adventures]','.map-viewport','.map-sidebar'].every(s=>{const b=document.querySelector(s).getBoundingClientRect();return b.x>=0&&b.right<=innerWidth+1&&b.y>=0&&b.bottom<=innerHeight+1;});
      return {bad,fit,overflow:document.documentElement.scrollWidth>innerWidth,rects,html:svg.outerHTML};
    })()`);
    fs.writeFileSync(path.join(process.env.VERIFY_ARTIFACT_DIR,'l1-map-'+width+'-'+lang+'.json'),JSON.stringify(metrics,null,2));
    check(metrics.fit&&!metrics.overflow&&!metrics.bad.length,width+'x'+height+' '+lang+': catalog/map/sidebar and labels/targets fit '+JSON.stringify(metrics.bad));
    check(metrics.rects.every(r=>r.marker.width>=39&&r.marker.width<=42),'constant screen-sized native vector targets');
    check(await evaluate(`document.querySelector('[data-hero-class]').textContent.includes('${lang==='en'?'Fighter':'战士'}')&&document.querySelector('[data-hero-species]').textContent.includes('${lang==='en'?'Dwarf':'矮人'}')`),'hero class/species use registry descriptors');
    await click('[data-node-id=courier-crossing]');check(await evaluate("document.getElementById('embarkBtn').dataset.mapId==='courier-crossing'"),'crowded courier waypoint actual selection');
    await click('[data-node-id=sewers]');check(await evaluate("document.getElementById('embarkBtn').dataset.mapId==='sewers'"),'adjacent sewers waypoint actual selection');
    await click('[data-node-id=l1-long-room]');
    check(await evaluate(`document.querySelector('.sidebar-header h2').textContent.includes(${JSON.stringify(lang==='en'?bundle.maps[1].name:bundle.maps[1].localized['zh-CN'].name)})&&document.querySelector('[data-node-id=l1-long-room] title').textContent.includes(${JSON.stringify(lang==='en'?bundle.maps[1].name:bundle.maps[1].localized['zh-CN'].name)})`),'long translated name retains complete sidebar/title');
    await evaluate("document.querySelector('[data-node-id=crypt]').focus()");await key('Enter');
    check(await evaluate("document.activeElement.dataset.nodeId==='crypt'&&document.getElementById('embarkBtn').dataset.mapId==='crypt'"),'keyboard Enter selects and restores SVG focus');
    await evaluate("document.querySelector('[data-node-id=sewers]').focus()");await key(' ','Space');check(await evaluate("document.getElementById('embarkBtn').dataset.mapId==='sewers'"),'keyboard Space selects waypoint');
    await click('[data-adventure-id=l1-list-room]');check(await evaluate("document.getElementById('embarkBtn').dataset.mapId==='l1-list-room'"),'list-only entry remains reachable in scrolling catalog');
    await click('[data-node-id=l1-long-room]');
    await evaluate("window.__l1SVG=document.querySelector('.region-svg')");await locale(lang==='en'?'zh-CN':'en');await locale(lang);
    check(await evaluate("window.__l1SVG===document.querySelector('.region-svg')&&document.querySelector('[data-adventure-id=l1-long-room] input').checked&&window.__l1Observers.size===2"),'locale preserves SVG identity/selection and owns only SVG/header observers');
    const finalLabels=await evaluate(`(()=>{const labels=[...document.querySelectorAll('.waypoint-label-box')].map(e=>({id:e.parentElement.dataset.nodeId,...e.getBoundingClientRect().toJSON()})),bad=[];for(let i=0;i<labels.length;i++)for(let j=i+1;j<labels.length;j++){const a=labels[i],b=labels[j];if(a.x<b.right-1&&a.right>b.x+1&&a.y<b.bottom-1&&a.bottom>b.y+1)bad.push([a.id,b.id]);}return {labels,bad};})()`);
    fs.writeFileSync(path.join(process.env.VERIFY_ARTIFACT_DIR,'l1-selected-labels-'+width+'-'+lang+'.json'),JSON.stringify(finalLabels,null,2));
    check(!finalLabels.bad.length,'selected long name/locale return keeps all label boxes separate: '+JSON.stringify(finalLabels.bad));
    await shot('town-'+width+'x'+height+'-'+lang);
  }
  const heroAfter=JSON.stringify(await api('GET','/api/characters/'+characterId)),townWrites=await evaluate('window.__l1Writes');
  fs.writeFileSync(path.join(process.env.VERIFY_ARTIFACT_DIR,'l1-town-state.json'),JSON.stringify({before:JSON.parse(heroBefore),after:JSON.parse(heroAfter),writes:townWrites},null,2));
  audit(heroBefore===heroAfter,'all town layout/locale/selection probes preserve complete authoritative hero');
  audit(townWrites.length===0,'town probes send no mutation (existing POST status is a read): '+JSON.stringify(townWrites));
  await size(1280,720);await full(true);await shot('town-native-fullscreen');await full(false);
  await open(saveId);await evaluate("window.__l1Canvas=document.querySelector('#map3d canvas')");
  await wait("!window.__dndDebug.modelState().animating&&Math.hypot(window.__dndDebug.camera().camTarget.x-window.__dndDebug.playerTile().x,window.__dndDebug.camera().camTarget.z-window.__dndDebug.playerTile().z)<.1",'initial camera converged');
  const camera=await evaluate("(()=>{const c=window.__dndDebug.camera();return {follow:c.follow,zoom:c.zoom,camTarget:c.camTarget};})()");
  const before=JSON.stringify((await api('GET','/api/game/'+saveId)).state);
  for(const [width,height] of sizes)for(const lang of ['en','zh-CN']) {
    await size(width,height);await locale(lang);await wait("document.querySelector('#map3d canvas').width===document.getElementById('map3d').clientWidth",'WebGL resize');
    check(await evaluate(`(()=>{const controls=[...document.querySelectorAll('.delve-tools button,#coreHud button,#fullscreenBtn,#immersiveBtn')];return document.documentElement.scrollWidth<=innerWidth&&controls.every(e=>{const b=e.getBoundingClientRect();return b.width>0&&b.top>=0&&b.bottom<=innerHeight&&e.contains(document.elementFromPoint(b.x+b.width/2,b.y+b.height/2));});})()`),width+'x'+height+' '+lang+': HUD/tools/layout/fullscreen reachable');
    await shot('play-'+width+'x'+height+'-'+lang);
    for(const panel of ['character','quests','log']) {
      await click('.delve-tools [data-panel='+panel+']');
      check(await evaluate(`window.__dndDebug.panel()==='${panel}'&&document.querySelector('#delvePanel').getBoundingClientRect().bottom<=innerHeight&&document.querySelectorAll('.modal-back').length===0`),'single reachable '+panel+' pane');
      await key('Escape');check(await evaluate(`document.activeElement.matches('.delve-tools [data-panel=${panel}]')`),'Escape returns '+panel+' trigger focus');
    }
    await click('.delve-tools [data-panel=inventory]');
    check(await evaluate("(()=>{const b=document.querySelector('#delveInventoryModal .modal').getBoundingClientRect();return document.querySelectorAll('.modal-back').length===1&&document.activeElement.closest('#delveInventoryModal')&&document.getElementById('delvePanel').hidden&&b.top>=0&&b.bottom<=innerHeight&&b.width<=innerWidth;})()"),'backpack fits viewport and uses one blocking layer/focus trap');
    // Capture the most constrained inventory height; all eight states retain real
    // open/geometry/focus/close assertions and the primary town/play PNG matrices.
    if(width===1280)await shot('backpack-'+width+'x'+height+'-'+lang);await key('Escape');
    await click('#pauseMenuBtn');check(await evaluate("!document.getElementById('pauseMenu').classList.contains('hidden')&&document.activeElement.closest('#pauseMenu')&&document.querySelector('.pause-menu-card').getBoundingClientRect().bottom<=innerHeight"),'short-height pause menu remains reachable and owns focus');await key('Escape');
    check(await evaluate("document.activeElement.id==='pauseMenuBtn'"),'pause Escape restores trigger');
  }
  await size(1280,720);await locale('en');
  await click('.delve-tools [data-panel=chat]');await send('Input.insertText',{text:'L1 unsent draft 草稿'});await evaluate("window.__l1Input=document.getElementById('chatInput');window.__l1Input.setSelectionRange(2,5)");
  await locale('zh-CN');check(await evaluate("document.activeElement===window.__l1Input&&window.__l1Input.selectionStart===2&&window.__l1Input.value==='L1 unsent draft 草稿'"),'short-height language switch preserves draft/focus/selection');
  await key('Escape');
  const layoutPreference=await evaluate("localStorage.getItem('dnd_delve_layout')");await full(true,'#fullscreenBtn');
  check(await evaluate("document.body.classList.contains('map-first')&&localStorage.getItem('dnd_delve_layout')")===layoutPreference,'native fullscreen keeps layout preference independent');
  const resizeCount=await evaluate('window.__dndDebug.camera().resizeCount');await size(1440,900);await wait('window.__dndDebug.camera().resizeCount>'+resizeCount,'observer resize in native fullscreen');await size(1280,720);
  check(await evaluate("window.__l1Canvas===document.querySelector('#map3d canvas')&&document.fullscreenElement===document.documentElement"),'native fullscreen viewport resize retains canvas and fullscreen');
  await key('v','KeyV');check(await evaluate("!document.body.classList.contains('map-first')&&document.fullscreenElement===document.documentElement"),'V changes only tactical layout during fullscreen');
  await key('v','KeyV');await click('.delve-tools [data-panel=inventory]');
  check(await evaluate("document.fullscreenElement.contains(document.getElementById('delveInventoryModal'))"),'native fullscreen includes body-mounted dialogs');
  const escChanges=await evaluate('window.__l1NativeFull');await key('Escape');await wait('!document.fullscreenElement&&window.__l1NativeFull>'+escChanges,'native browser Escape exit');
  check(await evaluate("document.getElementById('delveInventoryModal')&&document.getElementById('fullscreenBtn').getAttribute('aria-pressed')==='false'"),'browser Escape exits fullscreen before the existing modal layer');await click('#closeDelveInvX');
  await full(true,'#fullscreenBtn');await shot('play-native-fullscreen');await full(false,'#fullscreenBtn');
  // Actual external exit exercises fullscreenchange independently of our exit button.
  await full(true,'#fullscreenBtn');const changes=await evaluate('window.__l1NativeFull');await evaluate('document.exitFullscreen()');await wait('window.__l1NativeFull>'+changes,'external fullscreen exit');
  check(await evaluate("document.getElementById('fullscreenBtn').getAttribute('aria-pressed')==='false'"),'external browser exit updates control');
  // Only the rejection path is fault-injected; successful fullscreen always uses native Chromium.
  await evaluate("window.__l1Request=document.documentElement.requestFullscreen;document.documentElement.requestFullscreen=()=>Promise.reject(new DOMException('L1 denied','NotAllowedError'))");await click('#fullscreenBtn');
  await wait("!document.getElementById('fullscreenBtn').disabled&&!document.getElementById('toast').classList.contains('hidden')",'fullscreen failure displayed');
  check(await evaluate('!document.fullscreenElement'),'rejected fullscreen leaves playable page');await evaluate('document.documentElement.requestFullscreen=window.__l1Request');
  audit(before===JSON.stringify((await api('GET','/api/game/'+saveId)).state)&&await evaluate('window.__l1Writes.length===0'),'resize/panels/locale/fullscreen/V/failure preserve authoritative state and RNG');
  check(await evaluate("window.__l1Canvas===document.querySelector('#map3d canvas')&&window.__dndDebug.resources().renderers===1&&window.__dndDebug.resources().observers===1"),'all presentation probes preserve one WebGL renderer and observer');
  const afterCamera=await evaluate("(()=>{const c=window.__dndDebug.camera();return {follow:c.follow,zoom:c.zoom,camTarget:c.camTarget};})()");
  audit(camera.follow===afterCamera.follow&&camera.zoom===afterCamera.zoom&&Math.hypot(camera.camTarget.x-afterCamera.camTarget.x,camera.camTarget.z-afterCamera.camTarget.z)<.1,'layout/fullscreen/panel/resize retain camera follow, zoom and target');
  const moving=(await api('GET','/api/game/'+saveId)).state,player=moving.entities.find(e=>e.kind==='player');
  const target=[[player.x+1,player.y],[player.x,player.y+1],[player.x-1,player.y]].find(([x,y])=>moving.map.rows[y]?.[x]!== '#'&&!moving.entities.some(e=>e.x===x&&e.y===y)&&!moving.objects.some(o=>o.x===x&&o.y===y));check(!!target,'free adjacent input fixture exists');
  const point=await evaluate(`(()=>{const p=window.__dndDebug.tileToScreen(${target[0]},${target[1]}),c=document.querySelector('#map3d canvas'),r=c.getBoundingClientRect(),point={x:r.x+p.x,y:r.y+p.y};return document.elementFromPoint(point.x,point.y)===c?point:null;})()`);check(!!point,'post-fullscreen raycast reaches real WebGL canvas');
  for(const type of ['mousePressed','mouseReleased'])await send('Input.dispatchMouseEvent',{type,...point,button:'left',clickCount:1});
  await wait(`window.__dndDebug.playerTile().x===${target[0]+.5}&&window.__dndDebug.playerTile().z===${target[1]+.5}`,'post-fullscreen input final convergence');
  check((await api('GET','/api/game/'+saveId)).state.entities.some(e=>e.kind==='player'&&e.x===target[0]&&e.y===target[1]),'real 3D click after fullscreen adopts engine destination');
  // Delay a real fullscreen request result across navigation; never synthesize fullscreen state.
  await evaluate("document.documentElement.requestFullscreen=function(){const result=window.__l1Request.call(this);return result.then(()=>new Promise(resolve=>{window.__l1ReleaseFull=resolve;}));}");
  await click('#fullscreenBtn');await wait('document.fullscreenElement&&window.__l1ReleaseFull','real fullscreen request held');await go('#/create');await wait('!document.fullscreenElement','leaving exits native fullscreen');await evaluate('document.documentElement.requestFullscreen=window.__l1Request');
  check(await evaluate("!document.fullscreenElement&&window.__l1FullListeners.size===0&&window.__l1Observers.size===0&&window.__dndDebug.resources().renderers===0&&window.__dndDebug.resources().observers===0&&!window.__l1Canvas.isConnected"),'late request/leaving clears fullscreen listeners, renderer and every observer');
  await open(saveId);await full(true,'#fullscreenBtn');await evaluate('window.__l1ReleaseFull();new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
  check(await evaluate('document.fullscreenElement===document.documentElement'),'old delayed request cannot exit a newer view fullscreen');await go('#/create');await wait('!document.fullscreenElement','new fullscreen owner cleanup');
  for(let n=0;n<2;n++){await open(saveId);check(await evaluate('window.__l1FullListeners.size===1&&window.__dndDebug.resources().renderers===1'),'remount owns exactly one fullscreen controller/renderer');await go('#/create');check(await evaluate('window.__l1FullListeners.size===0&&window.__dndDebug.resources().renderers===0'),'repeat leaving releases controller/renderer');}
  // Known isolated engine combat avoids assertions about any particular roll.
  const state=(await api('GET','/api/game/'+saveId)).state,hero=state.entities.find(e=>e.kind==='player'),enemy=state.entities.find(e=>e.kind==='monster'&&e.alive!==false);
  editSave(saveId,s=>{const m=s.entities.find(e=>e.id===enemy.id),p=s.entities.find(e=>e.kind==='player');m.x=hero.x+1;m.y=hero.y;m.hp=m.hpMax=200;p.hp=p.hpMax=200;engine.startCombat(s,[m.id]);s.combat.turnIdx=s.combat.order.findIndex(o=>o.id==='player');});
  await open(saveId);await wait("document.querySelector('[data-act=attack]')",'engine combat');await click('[data-target-id='+enemy.id+']');await wait("!document.querySelector('[data-act=attack]').disabled",'attack enabled');
  const rev=(await api('GET','/api/game/'+saveId)).state.rev;await click('#coreHud [data-act=attack]');await wait('window.__dndDebug.rev()>'+rev,'real attack adopted');
  check((await api('GET','/api/game/'+saveId)).state.mode==='combat','combat fixture preserves a turn for every possible damage roll');
  const endRev=await evaluate('window.__dndDebug.rev()');await click('#coreHud [data-act=endturn]');await wait('window.__dndDebug.rev()>'+endRev,'real end turn adopted');
  await shot('combat-short-desktop');editSave(saveId,s=>{s.entities.find(e=>e.id===enemy.id).fled=true;engine.checkCombatEnd(s,[]);});await go('#/create');await open(saveId);
  await evaluate(`(()=>{const original=window.fetch;let attempt=0;window.fetch=(url,init)=>{if(!String(url).includes('/city/sync-delve'))return original(url,init);if(++attempt===1)return Promise.resolve(new Response(JSON.stringify({error:'L1 isolated save failure'}),{status:503,headers:{'Content-Type':'application/json'}}));return new Promise(resolve=>{window.__l1SettleHeld=true;window.__l1ReleaseSettle=()=>resolve(original(url,init));});};})()`);
  await click('#coreHud [data-act=retreat]');await wait("document.getElementById('summaryRetryBtn')",'settlement failure');await shot('settlement-failed-short');await click('#summaryRetryBtn');await wait('window.__l1SettleHeld','settlement retry held');
  const hash=await evaluate('location.hash');await key('Escape');await key('v','KeyV');await evaluate("location.hash='#/'");await wait('location.hash==='+JSON.stringify(hash),'settlement route guard');
  check(await evaluate("document.getElementById('summaryModal')&&document.querySelectorAll('.modal-back').length===1&&document.getElementById('delvePanel').hidden"),'failure/retry retains single layer and navigation/keyboard lock');
  await evaluate('window.__l1ReleaseSettle()');await wait("document.querySelector('.sumNavBtn[aria-disabled=false]')",'real settlement confirmed');await shot('settlement-confirmed-short');await click('.sumNavBtn');await wait("document.querySelector('[data-town-adventures]')",'real return town');
  check((await api('POST','/api/city/sync-delve',{charId:characterId,delveStateId:saveId})).duplicate,'settlement retry leaves one engine receipt');
  // Long authored story remains usable through the existing T10 modal scroll owner.
  const storyChar=(await api('POST','/api/characters',{presetId:'guardian',name:'L1 Story Reader'})).id;chars.push(storyChar);
  const story=(await api('POST','/api/game/start',{characterId:storyChar,mapId:'vale-gate',bringAlly:false})).state.id;saves.push(story);
  await api('POST','/api/game/'+story+'/action',{type:'move',x:3,y:3});await api('POST','/api/game/'+story+'/action',{type:'interact',objectId:'seal_chest'});await api('POST','/api/game/'+story+'/action',{type:'move',x:5,y:3});
  editSave(story,s=>{for(const scene of s.map.scenes){scene.prompt='A long story before choosing the next road. '.repeat(90);scene.localized={...(scene.localized||{}),en:{...(scene.localized?.en||{}),prompt:scene.prompt},'zh-CN':{...(scene.localized?.['zh-CN']||{}),prompt:'选择道路之前，守门人讲述这段漫长的往事。'.repeat(90)}};const choice=scene.choices.find(c=>c.id==='show_seal');choice.label='Return the passage seal, explain what happened on the long eastern road, and ask the keeper to let everyone continue peacefully through the gate.';choice.localized={...choice.localized,en:{...choice.localized?.en,label:choice.label},'zh-CN':{...choice.localized?.['zh-CN'],label:'交回通行印，说明东方道路上发生的事情，请守门人让所有旅人平安通过哨门，并继续调查通道里的旧线索，不必让任何人受伤。'}};}});
  await open(story);await locale('zh-CN');
  check(await evaluate("document.getElementById('guidanceObjectivePill').getBoundingClientRect().height<=49"),'long story HUD stays compact before opening full prose');await shot('long-story-entry-short');
  await click('[data-scene-open]');await shot('long-story-short');await click('[data-scene-choice=show_seal]');await wait("document.querySelector('[data-scene-memory]')",'confirmed long story choice');
  check((await api('GET','/api/game/'+story)).state.encounterFacts.some(f=>f.fact==='returned_seal'),'scrolled long story choice reaches real engine branch');await key('Escape');
  await go('#/create');check(await evaluate('window.__l1FullListeners.size===0&&window.__l1Observers.size===0&&window.__dndDebug.resources().renderers===0&&window.__dndDebug.resources().observers===0'),'final leave releases all owned fullscreen/WebGL resources');
  check(errors.length===0,'no Chromium runtime exceptions');
} catch(error) { failed++;console.error('FAIL L1 CDP: '+error.stack);if(ws)await shot('failure').catch(e=>{failed++;console.error('Failed evidence: '+e.stack);}); }
finally {
  try{await closeBrowser(browser,ws,send,profile);}catch(error){failed++;console.error('Browser cleanup: '+error.stack);}for(const call of pending.values())clearTimeout(call.timer);
  for(const id of saves)try{await api('DELETE','/api/game/'+id);}catch(error){failed++;console.error('Save cleanup: '+error.stack);}
  for(const id of chars)try{await api('DELETE','/api/characters/'+id);}catch(error){failed++;console.error('Hero cleanup: '+error.stack);}
  try{const c=await api('GET','/api/content');if(c.packs.some(p=>p.id===bundle.pack.id))await api('DELETE','/api/content/pack/'+bundle.pack.id);}catch(error){failed++;console.error('Pack cleanup: '+error.stack);}
  console.log('L1 CDP: '+passed+' passed, '+failed+' failed.');
}
if(failed)process.exitCode=1;
