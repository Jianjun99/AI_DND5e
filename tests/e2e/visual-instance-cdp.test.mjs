// V1a: actual WebGL, trusted clicks, authoritative results and owned resources.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import engine from '../../server/game/engine.js';
import { assertTestContainer } from '../../scripts/test-container.mjs';
import { browserBinary, softwareWebGLFlags, requireWebGL, captureBrowserArtifacts, closeBrowser } from './_browser-runtime.mjs';
assertTestContainer();
const BASE=process.env.BASE_URL||'http://localhost:'+(process.env.PORT||3000),PORT=9239;
const profile=fs.mkdtempSync(path.join(os.tmpdir(),'ai-dnd-v1a-')),pending=new Map(),errors=[];
let ws,browser,sequence=0,passed=0,failed=0,characterId,saveId;
function check(value,message){if(!value)throw new Error(message);passed++;console.log('  PASS: '+message);}
function send(method,params={}){return new Promise((resolve,reject)=>{const id=++sequence,timer=setTimeout(()=>{pending.delete(id);reject(new Error('CDP timeout: '+method));},20000);pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params}));});}
async function evaluate(expression){const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw new Error(JSON.stringify(r.exceptionDetails));return r.result.value;}
async function wait(expression,label){const until=Date.now()+20000;while(Date.now()<until){if(await evaluate('!!('+expression+')'))return;await new Promise(r=>setTimeout(r,100));}throw new Error('Timed out: '+label);}
async function api(method,url,body){const r=await fetch(BASE+url,{method,headers:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)}),data=await r.json();if(!r.ok)throw new Error(url+': '+JSON.stringify(data));return data;}
async function go(hash){await evaluate(`(async()=>{const m=await import('/js/app.js');history.replaceState(null,'',${JSON.stringify(hash)});await m.navigate();})()`);}
async function pointer(point){
  // One gesture in wire order, without a software-rendering protocol round-trip
  // between pressing and releasing a DOM control that polling can replace.
  const down=send('Input.dispatchMouseEvent',{type:'mousePressed',...point,button:'left',clickCount:1});
  const up=send('Input.dispatchMouseEvent',{type:'mouseReleased',...point,button:'left',clickCount:1});
  await Promise.all([down,up]);
}
async function click(selector){const result=await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e||e.disabled)return null;const b=e.getBoundingClientRect(),p={x:b.x+b.width/2,y:b.y+b.height/2};return e.contains(document.elementFromPoint(p.x,p.y))?p:null;})()`);check(!!result,'actual reachable pointer '+selector);await pointer(result);}
async function key(key,code=key){for(const type of ['keyDown','keyUp'])await send('Input.dispatchKeyEvent',{type,key,code,...(key==='Escape'?{windowsVirtualKeyCode:27,nativeVirtualKeyCode:27}:{})});}
async function shot(name){
  const directory=path.join(process.env.VERIFY_ARTIFACT_DIR,'screenshots');fs.mkdirSync(directory,{recursive:true});const file=path.join(directory,'v1a-'+name+'-'+PORT+'-0');
  // Native fullscreen changes the backing surface size. Explicit viewport clipping
  // retains the complete emulated desktop, rather than a silently cropped PNG.
  const viewport=await evaluate('({width:innerWidth,height:innerHeight})');
  const png=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true,clip:{x:0,y:0,...viewport,scale:1}});fs.writeFileSync(file+'.png',Buffer.from(png.data,'base64'));
  const dom=await send('Runtime.evaluate',{expression:'({url:location.href,html:document.documentElement.outerHTML})',returnByValue:true});fs.writeFileSync(file+'.json',JSON.stringify(dom,null,2));
  for(const ext of ['png','json'])check(fs.existsSync(file+'.'+ext),'saved '+name+' '+ext);
  const visuals=await evaluate('({visuals:window.__dndDebug.visuals(),resources:window.__v1Resources(),camera:window.__dndDebug.camera()})');fs.writeFileSync(path.join(process.env.VERIFY_ARTIFACT_DIR,'v1a-'+name+'-visuals.json'),JSON.stringify({...visuals,viewport},null,2));
}
function readSave(){return JSON.parse(fs.readFileSync(path.join(process.env.DATA_DIR,'saves',saveId+'.json'),'utf8'));}
function editSave(edit){const file=path.join(process.env.DATA_DIR,'saves',saveId+'.json'),temp=file+'.v1a.tmp',s=readSave();edit(s);s.rev++;try{fs.writeFileSync(temp,JSON.stringify(s));fs.renameSync(temp,file);}finally{fs.rmSync(temp,{force:true});}return s.rev;}
async function open(){await go('#/play/'+saveId);await wait("document.querySelector('#map3d canvas')&&window.__dndDebug.resources().renderers===1",'mounted 3D renderer');await wait('!window.__dndDebug.modelState().animating','initial final pose');}
try {
  characterId=(await api('POST','/api/characters',{presetId:'guardian',name:'V1 Visual Explorer'})).id;
  saveId=(await api('POST','/api/game/start',{characterId,mapId:'crypt',difficulty:'easy',bringAlly:false})).state.id;
  editSave(s=>{const p=s.entities.find(e=>e.kind==='player');p.hp=p.hpMax=200;for(const [id,x]of [['skel1',5],['skel2',6]]){const m=s.entities.find(e=>e.id===id);m.x=x;m.y=4;m.hp=m.hpMax=200;if(!s.discovered.includes(x+',4'))s.discovered.push(x+',4');}engine.startCombat(s,['skel1','skel2']);s.combat.turnIdx=s.combat.order.findIndex(o=>o.id==='player');s.combat.actionUsed=false;s.seed=123456;s.rngState=123456;});
  browser=spawn(browserBinary(),['--headless=new',...softwareWebGLFlags(),'--no-sandbox','--disable-dev-shm-usage','--no-first-run','--no-default-browser-check','--remote-debugging-port='+PORT,'--user-data-dir='+profile,'--window-size=1280,720',BASE+'/#/'],{detached:true,stdio:'ignore'});
  let tab;for(let n=0;n<70&&!tab;n++){tab=(await fetch('http://127.0.0.1:'+PORT+'/json').then(r=>r.json()).catch(()=>[])).find(t=>t.type==='page');if(!tab)await new Promise(r=>setTimeout(r,100));}if(!tab)throw new Error('Required Chromium unavailable');
  ws=new WebSocket(tab.webSocketDebuggerUrl);await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject;});ws.onmessage=event=>{const r=JSON.parse(event.data);if(r.method==='Runtime.exceptionThrown')errors.push(r.params.exceptionDetails);const call=pending.get(r.id);if(!call)return;pending.delete(r.id);clearTimeout(call.timer);if(r.error)call.reject(new Error(r.error.message));else call.resolve(r.result);};
  await send('Page.enable');await send('Runtime.enable');await requireWebGL(send);await wait("document.getElementById('quickName')",'home');
  await send('Emulation.setDeviceMetricsOverride',{width:1280,height:720,deviceScaleFactor:1,mobile:false});
  await evaluate(`(async()=>{localStorage.setItem('aiDnd.tutorial.v1',JSON.stringify({status:'skipped'}));localStorage.removeItem('dnd_delve_layout');localStorage.setItem('dnd_cam_follow','on');localStorage.setItem('dnd_default_view','3d');const visual=await import('/js/visual-instance.js');window.__v1Resources=visual.visualResources;window.__v1Sample=(await import('/js/visual-sample.js')).createSampleVisual;window.__v1Actions=[];window.__v1Pointer=[];let pressed;for(const type of ['mousedown','mouseup','click'])document.addEventListener(type,event=>{if(type==='mousedown')pressed=event.target;window.__v1Pointer.push({type,target:event.target?.closest('[data-act],button,canvas')?.outerHTML.slice(0,250),pressedConnected:pressed?.isConnected});},true);const original=window.fetch;window.fetch=async(url,init)=>{let record;if(init?.method==='POST'&&String(url).endsWith('/action')){record={request:JSON.parse(init.body)};window.__v1Actions.push(record);}const result=await original(url,init);if(record){record.status=result.status;record.response=await result.clone().json();}return result;};})()`);
  await open();await wait('Math.hypot(window.__dndDebug.camera().camTarget.x-4.5,window.__dndDebug.camera().camTarget.z-4.5)<.1','follow camera converged');
  const authoritative=JSON.stringify(readSave());
  check(await evaluate("window.__dndDebug.visuals().every(v=>v.kind==='procedural')"),'default procedural model preserved');
  await evaluate(`(()=>{window.__v1Canvas=document.querySelector('#map3d canvas');const host=document.createElement('div');host.id='v1-fixture-controls';host.style='position:fixed;right:12px;top:68px;z-index:1000;background:#17212c;padding:5px';const label=document.createElement('small');label.textContent='V1 test fixture';host.appendChild(label);for(const [id,text,fn]of [['sample','Sample',()=>window.__dndDebug.setVisualFactory(window.__v1Sample)],['default','Default',()=>window.__dndDebug.setVisualFactory()],['pulse','Monster attack',()=>window.__dndDebug.playVisual('skel1','attack','fixture-attack')],['hit','Monster hit',()=>window.__dndDebug.playVisual('skel2','hit','fixture-hit')]]){const button=document.createElement('button');button.id='v1-'+id;button.textContent=text;button.onclick=fn;host.appendChild(button);}document.body.appendChild(host);})()`);
  await shot('default-en-1280');await click('#v1-sample');
  check(await evaluate("window.__dndDebug.visuals().filter(v=>['player','skel1','skel2'].includes(v.id)).every(v=>v.kind==='sample')&&window.__dndDebug.visuals().length===window.__v1Resources().instances"),'hero and two same-monster samples replace through interface');
  check(await evaluate("window.__v1Canvas===document.querySelector('#map3d canvas')&&window.__dndDebug.resources().renderers===1&&window.__dndDebug.resources().observers===1"),'replacement retains canvas/renderer/resize observer');
  await click('#v1-pulse');await click('#v1-hit');
  check(await evaluate("window.__dndDebug.visuals().find(v=>v.id==='skel1').lastAction==='attack'&&window.__dndDebug.visuals().find(v=>v.id==='skel2').lastAction==='hit'&&window.__dndDebug.visuals().find(v=>v.id==='player').plays===0"),'same monster instances animate independently');
  check(await evaluate("!window.__dndDebug.playVisual('skel1','attack','fixture-attack')&&!window.__dndDebug.playVisual('player','cast','missing-clip')"),'duplicate event and missing clip safely retain idle/walk');
  await evaluate("import('/js/i18n.js').then(m=>m.setLocale('zh-CN'))");
  await send('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
  await click('.delve-tools [data-panel=character]');await key('Escape');await click('#viewToggleMinimap');await click('#viewToggle2D');await key('v','KeyV');await key('v','KeyV');
  await click('#fullscreenBtn');await wait('document.fullscreenElement===document.documentElement','native fullscreen');await click('#fullscreenBtn');await wait('!document.fullscreenElement','native fullscreen exit');
  check(await evaluate("window.__v1Canvas===document.querySelector('#map3d canvas')&&window.__dndDebug.visuals().find(v=>v.id==='player').kind==='sample'"),'locale, panel, 2D/3D, layout, resize and fullscreen retain sample');
  check(JSON.stringify(readSave())===authoritative,'visual replacement/preview and all UI probes preserve complete engine state/RNG');
  await shot('sample-zh-1440');
  const tile=await evaluate("(()=>{const p=window.__dndDebug.tileToScreen(5,4),b=document.querySelector('#map3d canvas').getBoundingClientRect();return {x:b.x+p.x,y:b.y+p.y};})()");await pointer(tile);
  check(await evaluate("document.querySelector('.target-line')?.textContent.includes('200/200')"),'real sample raycast selects existing monster');
  // Selecting on the board starts describe, then portrait; both replace the HUD.
  // Wait for that real auxiliary chain, rather than racing its newly drawn button.
  await wait("window.__v1Actions.some(a=>a.request.type==='portrait'&&a.response)&&window.__dndDebug.portraits().skeleton&&!window.__dndDebug.loadingAppearance()",'selected target description and portrait adopted');
  const expected=readSave(),events=[];
  await click('#coreHud [data-act=attack]');await wait('window.__v1Actions.some(a=>a.request.type===\'attack\')&&window.__dndDebug.visuals().find(v=>v.id===\'player\').plays===1','confirmed real player attack');
  const response=await evaluate("window.__v1Actions.find(a=>a.request.type==='attack')"),after=readSave();
  engine.beginRng(expected);engine.playerAttack(expected,response.request.targetId,response.request.weaponId,events);engine.persistRng(expected);
  check(response.request.targetId==='skel1'&&response.response.events.some(e=>['attack','miss'].includes(e.type)&&e.data?.targetId==='skel1'),'real click retains stable entity ID and confirmed event');
  check(after.entities.find(e=>e.id==='skel1').hp===expected.entities.find(e=>e.id==='skel1').hp&&after.rngState===expected.rngState,'sample attack matches engine-only control HP/RNG without visual consumption');
  check(await evaluate(`document.querySelector('.target-line').textContent.includes(${JSON.stringify(after.entities.find(e=>e.id==='skel1').hp+'/200')})`),'selected target HUD follows confirmed entity snapshot by stable ID');
  const attackEvent=response.response.visualEvents.find(e=>e.entityId==='player'&&e.animation==='attack');
  check(!!attackEvent,'structured visual result carries confirmed player attack ID');
  check(await evaluate(`!window.__dndDebug.playVisual('player','attack',${JSON.stringify(attackEvent.eventId)})`),'repeated confirmed attack result does not replay');
  const revised=editSave(s=>{s.visualProbe=true;});await wait('window.__dndDebug.rev()>='+revised,'real polling snapshot');
  check(await evaluate("window.__dndDebug.visuals().find(v=>v.id==='player').plays===1"),'polling does not replay attack');
  await shot('confirmed-attack');
  // Real movement to a free floor tile; inspect final convergence only, never rAF intermediates.
  const moveBefore=readSave(),movePlayer=engine.playerEntity(moveBefore);
  const move=[['ArrowDown',0,1],['ArrowUp',0,-1],['ArrowLeft',-1,0],['ArrowRight',1,0]].map(([key,dx,dy])=>({key,x:movePlayer.x+dx,y:movePlayer.y+dy})).find(p=>!engine.isBlocked(moveBefore,p.x,p.y)&&!engine.entityAt(moveBefore,p.x,p.y)&&!moveBefore.objects.some(o=>['trap','hazard','spores'].includes(o.type)&&o.x===p.x&&o.y===p.y));
  check(!!move,'engine confirms a currently free adjacent movement fixture');
  await evaluate('window.__v1MoveHeld=false;window.__v1ReleaseMove=null');
  await evaluate(`(()=>{const original=window.fetch;window.fetch=async(url,init)=>{const response=await original(url,init);if(init?.method==='POST'&&String(url).endsWith('/action')&&JSON.parse(init.body).type==='move'){window.__v1HeldMove=await response.clone().json();window.__v1MoveHeld=true;await new Promise(resolve=>window.__v1ReleaseMove=resolve);}return response;};})()`);
  await key(move.key);await wait('window.__v1MoveHeld','confirmed move response held');
  const moved=await evaluate('window.__v1HeldMove'),destination=engine.playerEntity(moved.state);
  check(destination.x===move.x&&destination.y===move.y&&!moved.events.some(e=>e.type==='error'),'real movement response confirms selected free tile');
  await click('#v1-default');await evaluate('window.__v1ReleaseMove()');
  await wait(`window.__dndDebug.playerTile().x===${destination.x+.5}&&window.__dndDebug.playerTile().z===${destination.y+.5}&&!window.__dndDebug.modelState().animating&&window.__dndDebug.modelState().x===${destination.x+.5}&&window.__dndDebug.modelState().z===${destination.y+.5}`,'default replacement converges to engine movement');
  check(await evaluate("window.__dndDebug.visuals().every(v=>v.kind==='procedural')"),'disable sample continues same save with default models');
  await click('#v1-sample');const count=await evaluate('window.__v1Resources().instances');
  const removed=editSave(s=>{s.entities.find(e=>e.id==='skel2').fled=true;});await wait('window.__dndDebug.rev()>='+removed,'fled snapshot');
  check(await evaluate("!window.__dndDebug.visuals().some(v=>v.id==='skel2')&&window.__v1Resources().instances==="+(count-1)),'fled entity releases visual immediately');
  await shot('move-and-remove');
  await evaluate("window.__dndDebug.setVisualFactory(()=>{throw new Error('intentional invalid V1 specimen');})");check(await evaluate("window.__dndDebug.visuals().every(v=>v.kind==='procedural')"),'bad factory falls back and save stays playable');
  await evaluate("window.__v1Late=[];window.__dndDebug.setVisualFactory(entity=>new Promise(resolve=>window.__v1Late.push(()=>resolve(window.__v1Sample(entity)))))");
  await go('#/create');await evaluate("document.getElementById('v1-fixture-controls').remove();window.__v1Late.forEach(resolve=>resolve());Promise.resolve().then(()=>Promise.resolve())");
  check(await evaluate("Object.values(window.__v1Resources()).every(n=>n===0)&&window.__dndDebug.resources().renderers===0&&window.__dndDebug.resources().observers===0"),'late results never attach and leave releases all visual/WebGL resources');
  for(let n=0;n<2;n++){await open();check(await evaluate("window.__dndDebug.visuals().find(v=>v.id==='player').plays===0"),'read/reentry does not replay historical attack');await go('#/create');check(await evaluate("Object.values(window.__v1Resources()).every(n=>n===0)"),'repeat navigation releases owned instances/textures/geometries/materials');}
  // Render-only board transition with reused stable entity IDs, without mutating a save.
  const board=(await api('GET','/api/game/'+saveId)).state;
  await evaluate(`(async()=>{const host=document.createElement('div');host.style='width:800px;height:500px';document.getElementById('view').appendChild(host);const old=[];window.__v1Renderer=(await import('/js/map3d.js')).createMap3D(host,{visualFactory:entity=>{const v=window.__v1Sample(entity);old.push(v);return v;}});const board=${JSON.stringify(board)};window.__v1Renderer.render(board);const first=[...old];window.__v1Renderer.render({...board,mapId:'v1-fixture-next-floor'});window.__v1OldReleased=first.every(v=>!v.state().alive);window.__v1Renderer.dispose();host.remove();})()`);
  check(await evaluate("window.__v1OldReleased&&Object.values(window.__v1Resources()).every(n=>n===0)&&!window.__v1Renderer.setVisualFactory(window.__v1Sample)"),'board transition disposes reused-ID instances; disposed renderer cannot resurrect');
  check(errors.length===0,'no Chromium runtime exceptions');
  fs.writeFileSync(path.join(process.env.VERIFY_ARTIFACT_DIR,'v1a-input-audit.json'),JSON.stringify(await evaluate('({actions:window.__v1Actions.map(a=>({request:a.request,status:a.status,rev:a.response?.state.rev,events:a.response?.events})),pointer:window.__v1Pointer})'),null,2));
  fs.writeFileSync(path.join(process.env.VERIFY_ARTIFACT_DIR,'v1a-engine-control.json'),JSON.stringify({before:JSON.parse(authoritative),response,expectedHp:expected.entities.find(e=>e.id==='skel1').hp,actualHp:after.entities.find(e=>e.id==='skel1').hp,expectedRng:expected.rngState,actualRng:after.rngState},null,2));
} catch(error){failed++;console.error('FAIL V1a CDP: '+error.stack);if(ws){await captureBrowserArtifacts('v1a-failure',[PORT]).catch(e=>{failed++;console.error('Evidence failed: '+e.stack);});try{const audit=await evaluate('({actions:window.__v1Actions,pointer:window.__v1Pointer,visuals:window.__dndDebug?.visuals?.(),resources:window.__v1Resources?.()})');fs.writeFileSync(path.join(process.env.VERIFY_ARTIFACT_DIR,'v1a-failure-audit.json'),JSON.stringify(audit,null,2));}catch(e){failed++;console.error('Failure audit: '+e.stack);}}}
finally {
  try{await closeBrowser(browser,ws,send,profile);}catch(error){failed++;console.error('Browser cleanup: '+error.stack);}for(const call of pending.values())clearTimeout(call.timer);
  if(saveId)try{await api('DELETE','/api/game/'+saveId);}catch(error){failed++;console.error('Save cleanup: '+error.stack);}
  if(characterId)try{await api('DELETE','/api/characters/'+characterId);}catch(error){failed++;console.error('Hero cleanup: '+error.stack);}
  console.log('V1a CDP: '+passed+' passed, '+failed+' failed.');
}
if(failed)process.exitCode=1;
