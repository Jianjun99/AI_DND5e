// H1: the delve HUD keeps still-valid buttons, focus and in-progress pointer presses
// across auxiliary describe/portrait responses and polling. Deterministic barriers on
// the real fetch path prove one press → one server-accepted click — no rebuild can
// swallow it, no stale click is replayed, and nothing is masked by waiting out flavor.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import presets from '../../server/game/presets.js';
import { assertTestContainer } from '../../scripts/test-container.mjs';
import { browserBinary, softwareWebGLFlags, requireWebGL, captureBrowserArtifacts, closeBrowser } from './_browser-runtime.mjs';
assertTestContainer();
const BASE=process.env.BASE_URL || 'http://localhost:'+(process.env.PORT || 3000),PORT=9241;
const profile=fs.mkdtempSync(path.join(os.tmpdir(),'ai-dnd-h1-cdp-')),pending=new Map(),saves=[],chars=[],errors=[];
let ws,browser,sequence=0,passed=0,failed=0;
function check(value,message){if(!value)throw new Error(message);passed++;console.log('  PASS: '+message);}
function send(method,params={}){return new Promise((resolve,reject)=>{const id=++sequence,timer=setTimeout(()=>{pending.delete(id);reject(new Error('CDP timeout: '+method));},20000);pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params}));});}
async function evaluate(expression){const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw new Error(JSON.stringify(r.exceptionDetails));return r.result.value;}
async function wait(expression,label){const until=Date.now()+15000;while(Date.now()<until){if(await evaluate('!!('+expression+')'))return;await new Promise(r=>setTimeout(r,150));}throw new Error('Timed out: '+label);}
async function api(method,url,body){const r=await fetch(BASE+url,{method,headers:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)}),data=await r.json();if(!r.ok)throw new Error(url+': '+JSON.stringify(data));return data;}
async function pointer(p){const down=send('Input.dispatchMouseEvent',{type:'mousePressed',...p,button:'left',clickCount:1}),up=send('Input.dispatchMouseEvent',{type:'mouseReleased',...p,button:'left',clickCount:1});await Promise.all([down,up]);}
async function press(p){await send('Input.dispatchMouseEvent',{type:'mousePressed',...p,button:'left',clickCount:1});}
async function release(p){await send('Input.dispatchMouseEvent',{type:'mouseReleased',...p,button:'left',clickCount:1});}
async function locale(value){await evaluate(`import('/js/i18n.js').then(m=>m.setLocale('${value}'))`);}
async function shot(name){await captureBrowserArtifacts('h1-'+name,[PORT]);for(const ext of ['png','json'])check(fs.existsSync(path.join(process.env.VERIFY_ARTIFACT_DIR,'screenshots','h1-'+name+'-'+PORT+'-0.'+ext)),'saved '+name+' '+ext);}
async function state(id){return (await api('GET','/api/game/'+id)).state;}
// The 2D canvas is drawn exactly map.width × map.height tiles.
async function tile(s,x,y){const p=await evaluate(`(()=>{const c=document.getElementById('mapCanvas'),r=c.getBoundingClientRect();return {x:r.left+(${x}+.5)*r.width/${s.map.width},y:r.top+(${y}+.5)*r.height/${s.map.height}};})()`);await pointer(p);}
function blockedTiles(s){const blocked=new Set();for(const o of (s.objects||[])){if((o.type==='door'&&!o.open)||(o.type==='barrel'&&!o.exploded))blocked.add(o.x+','+o.y);}return blocked;}
function walkable(s,x,y,blocked){const row=s.map.rows[y];if(!row||row[x]==='#'||row[x]===' ')return false;return !blocked.has(x+','+y);}
function freeNeighbor(s,center,avoid,blocked){for(const[dx,dy]of [[1,0],[-1,0],[0,1],[0,-1],[1,1],[-1,-1],[1,-1],[-1,1]]){const x=center.x+dx,y=center.y+dy;if(!walkable(s,x,y,blocked))continue;if(avoid.some(o=>o&&o.x===x&&o.y===y))continue;return {x,y};}return null;}
// Deterministic fetch barrier: holds one describe response until released, records
// every game action, and marks describe/portrait JSON consumption + two UI frames.
const CAPTURE=`(()=>{window.__h1ActionRequests=[];window.__h1ActionReplies=[];if(window.__h1Capture)return;window.__h1Capture=true;if(!window.__h1ClickBound){window.__h1ClickBound=true;document.addEventListener('click',function(e){var b=e.target&&e.target.closest?e.target.closest('[data-act]'):null;(window.__h1Clicks=window.__h1Clicks||[]).push({act:b?b.dataset.act:null,tag:e.target.tagName,cls:String(e.target.className||'').slice(0,40),x:e.clientX,y:e.clientY});},true);}const original=window.fetch;window.fetch=async(...args)=>{const action=typeof args[0]==='string'&&args[0].startsWith('/api/game/')&&args[0].endsWith('/action')?JSON.parse(args[1]?.body||'{}'):null,entry=action?{type:action.type,targetId:action.targetId,completed:false}:null;if(entry)window.__h1ActionRequests.push(entry);try{const response=await original(...args);if(entry){entry.status=response.status;if(action.type==='describe'&&action.targetId===window.__h1HoldDescription){window.__h1HoldDescription=null;window.__h1HeldDescription=true;await new Promise(resolve=>window.__h1ReleaseDescription=resolve);}if(['describe','portrait'].includes(action.type)){const json=response.json.bind(response);response.json=async()=>{try{const data=await json();entry.flavorErrors=data.events?.filter(e=>e.type==='error');return data;}finally{requestAnimationFrame(()=>requestAnimationFrame(()=>entry.uiSettled=true));}};}if(['attack','endTurn'].includes(action.type))window.__h1ActionReplies.push({type:action.type,status:response.status,...await response.clone().json()});}return response;}finally{if(entry)entry.completed=true;}};})()`;
async function flavorSettled(){
 await wait("!window.__dndDebug.loadingAppearance()&&window.__h1ActionRequests.filter(r=>['describe','portrait'].includes(r.type)).every(r=>r.completed&&r.uiSettled)",'flavor responses consumed and UI settled');
}
// Fixture: hero tanks, two monsters staged adjacent to the hero so one real step
// starts combat with both; AC 1 monsters always fall, the 200 HP hero never does.
// The RAW save file is edited (like the T11 fixture) — a sanitized GET state must
// never be written back, it is a lossy view of the authoritative save.
function saveFile(id){return path.join(process.env.DATA_DIR,'saves',id+'.json');}
function stageTwins(id){
 const s=JSON.parse(fs.readFileSync(saveFile(id),'utf8'));
 const mons=s.entities.filter(e=>e.kind==='monster'&&e.alive!==false);
 if(mons.length<2)throw new Error('crypt fixture needs two alive monsters, found '+mons.length);
 const [a,b]=mons,p=s.entities.find(e=>e.kind==='player'),blocked=blockedTiles(s);
 const heroSpot=freeNeighbor(s,p,[a,b],blocked)||{x:p.x,y:p.y};
 const aSpot=freeNeighbor(s,heroSpot,[heroSpot],blocked)||heroSpot;
 const bSpot=freeNeighbor(s,aSpot,[heroSpot,aSpot],blocked)||heroSpot;
 p.x=heroSpot.x;p.y=heroSpot.y;
 a.x=aSpot.x;a.y=aSpot.y;b.x=bSpot.x;b.y=bSpot.y;
 for(const m of [a,b]){m.hp=1;m.hpMax=1;m.ac=1;}
 p.hp=p.hpMax=200;
 (s.character.attacks=s.character.attacks||[]).push({weaponId:'longbow',name:'Fixture Bow',bonus:30,dmgDice:'1d8',dmgMod:5,damageType:'piercing',ranged:true,range:150});
 s.rev++;
 fs.writeFileSync(saveFile(id),JSON.stringify(s));
 return {a,b};
}
async function fixture(tag){
 const char=await api('POST','/api/characters',{...presets.draftFor('guardian'),species:'human',name:'H1 '+tag});chars.push(char.id);
 const id=(await api('POST','/api/game/start',{characterId:char.id,mapId:'crypt',difficulty:'easy',bringAlly:false})).state.id;saves.push(id);
 return {id,charId:char.id};
}
async function open(id){
 await evaluate(`location.hash='#/play/${id}'`);
 await wait("document.getElementById('mapCanvas')&&window.__dndDebug",'delve open');
 await evaluate(CAPTURE);
}
async function enterCombat(id){
 let s=await state(id);
 const p=s.entities.find(e=>e.kind==='player'),blocked=blockedTiles(s);
 const step=freeNeighbor(s,{x:p.x,y:p.y},s.entities,blocked);
 check(step&&walkable(s,step.x,step.y,blocked),'free step toward the staged monsters exists');
 await tile(s,step.x,step.y);
 const until=Date.now()+15000;while(Date.now()<until){s=await state(id);if(s.mode==='combat')break;await new Promise(r=>setTimeout(r,150));}
 check(s.mode==='combat','combat started with the staged twins');
 await wait("document.querySelector('[data-act=attack]')&&!document.querySelector('[data-act=attack]').disabled",'player turn with attack ready');
 await wait("!document.querySelector('.dice-overlay')",'combat flourish finished');
 return s;
}
async function proveHeldClickSurvives(monsterId,labelLang){
 // Press the real attack button while the monster's describe response is held back,
 // release the flavor, let the HUD update, then finish the press on the SAME node.
 // Every press records where it started; the release completes on the node's current
 // center (a held button that shifts is followed, never re-clicked).
 await wait('window.__h1HeldDescription','held describe response ('+labelLang+')');
 const mark=await evaluate(`(window.__h1Clicks=window.__h1Clicks||[],window.__h1ActionReplies.length)`);
 const probe=await evaluate(`(()=>{const b=document.querySelector('#coreHud [data-act=attack]');window.__h1PressedAttack=b;const r=b.getBoundingClientRect(),point={x:r.x+r.width/2,y:r.y+r.height/2};return {point,hittable:!b.disabled&&b.contains(document.elementFromPoint(point.x,point.y))};})()`);
 check(probe.hittable,'attack button enabled and unoccluded ('+labelLang+')');
 await press(probe.point);
 await evaluate('window.__h1ReleaseDescription()');
 await flavorSettled();
 const mid=await evaluate(`(()=>{const b=window.__h1PressedAttack,r=b.getBoundingClientRect();return {connected:b.isConnected,stillInHud:document.querySelector('#coreHud [data-act=attack]')===b,point:{x:r.x+r.width/2,y:r.y+r.height/2},hitAtStart:(()=>{const el=document.elementFromPoint(${probe.point.x},${probe.point.y});return el?el.tagName+'.'+(el.dataset&&el.dataset.act||el.className||''):'none';})()};})()`);
 check(mid.connected,'describe completion keeps the pressed attack node ('+labelLang+')');
 check(mid.stillInHud,'HUD update reuses the same attack node ('+labelLang+')');
 await release(mid.point);
 await wait(`window.__h1ActionReplies.slice(${mark}).some(r=>r.type==='attack')`,'held release fires the real attack request ('+labelLang+')');
 check(await evaluate(`window.__h1ActionReplies.slice(${mark}).filter(r=>r.type==='attack').length===1`),'exactly one attack, no duplicates ('+labelLang+')');
 check(await evaluate(`(window.__h1Clicks||[]).filter(c=>c.act==='attack').length===1`),'the release produced exactly one attack click ('+labelLang+')');
 const reply=await evaluate(`window.__h1ActionReplies.slice(${mark}).find(r=>r.type==='attack')`);
 check(reply.status===200&&!reply.events.some(e=>e.type==='error'),'server accepted the released attack ('+labelLang+')');
 await wait('window.__dndDebug.rev()>='+reply.state.rev,'released attack adopted ('+labelLang+')');
 const spent=await evaluate("(()=>{const b=document.querySelector('#coreHud [data-act=attack]');return !b||b.disabled;})()");
 check(spent,'attack no longer pressable after the released click ('+labelLang+')');
 return reply;
}
 try {
 browser=spawn(browserBinary(),['--headless=new',...softwareWebGLFlags(),'--no-sandbox','--disable-dev-shm-usage','--no-first-run','--no-default-browser-check','--remote-debugging-port='+PORT,'--user-data-dir='+profile,'--window-size=1440,900',BASE+'/#/'],{detached:true,stdio:'ignore'});
 let tab;for(let n=0;n<70&&!tab;n++){tab=(await fetch('http://127.0.0.1:'+PORT+'/json').then(r=>r.json()).catch(()=>[])).find(t=>t.type==='page');if(!tab)await new Promise(r=>setTimeout(r,150));}if(!tab)throw new Error('Required Chromium did not start');
 ws=new WebSocket(tab.webSocketDebuggerUrl);await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject;});ws.onmessage=event=>{const r=JSON.parse(event.data);if(r.method==='Runtime.exceptionThrown')errors.push(r.params.exceptionDetails);const call=pending.get(r.id);if(!call)return;pending.delete(r.id);clearTimeout(call.timer);if(r.error)call.reject(new Error(r.error.message));else call.resolve(r.result);};
 await send('Page.enable');await send('Runtime.enable');await requireWebGL(send);await wait("document.getElementById('quickName')",'home');
 await evaluate("localStorage.setItem('dnd_default_view','2d');localStorage.setItem('dnd_3d','off');localStorage.setItem('aiDnd.tutorial.v1',JSON.stringify({status:'skipped'}))");
 await locale('en');
 await send('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});

 // --- Section A: held describe under a real press, in both languages -----------
 {
  const {id}=await fixture('combat');
  const twins=stageTwins(id);
  await open(id);
  await wait(`window.__dndDebug.rev()>=${(await state(id)).rev}`,'staged save loaded by the delve view');
  let s=await enterCombat(id);
  const {a,b}=twins;
  await shot('combat-staged');
  // Round 1 (en): hold A's describe, press attack, release flavor, finish the press.
  // processUntilPlayer already ran the enemies' first turn — re-read positions.
  s=await state(id);
  await evaluate(`window.__h1HeldDescription=false;window.__h1HoldDescription=${JSON.stringify(a.id)}`);
  await evaluate(`window.__dndDebug.target(${JSON.stringify(a.id)})`); // target A like a map click — describe held
  await proveHeldClickSurvives(a.id,'en');
  await shot('press-survival-en');
  s=await state(id);
  // A hit or a natural-1 miss both spend the action; combat continues either way.
  check(s.mode==='combat','combat continues after the released attack');
  // The released attack's dice flourish must be gone before further map clicks.
  await wait("!document.querySelector('.dice-overlay')",'combat flourish finished');
  // Invalid action is blocked: a real press on the spent attack sends nothing.
  const attacksBefore=await evaluate('window.__h1ActionReplies.filter(r=>r.type==="attack").length');
  const spentProbe=await evaluate("(()=>{const b=document.querySelector('#coreHud [data-act=attack]');const r=b.getBoundingClientRect();return {point:{x:r.x+r.width/2,y:r.y+r.height/2},disabled:b.disabled};})()");
  check(spentProbe.disabled,'attack disabled after spending the action');
  await pointer(spentProbe.point);
  check(await evaluate(`window.__h1ActionReplies.filter(r=>r.type==="attack").length===${attacksBefore}`),'press on the spent attack sends nothing');
  // Keyboard focus survives the same auxiliary rebuild path. The focus round runs in
  // zh-CN: A and B share one per-species describe cache key, so B's *zh* describe is
  // the guaranteed-uncached auxiliary response here (A's en describe just cached it).
  await locale('zh-CN');
  await evaluate("(()=>{const b=document.querySelector('#coreHud [data-act=endturn]');b.focus();window.__h1FocusedEndTurn=b;})()");
  check(await evaluate('document.activeElement===window.__h1FocusedEndTurn'),'end-turn focused before the held describe');
  await evaluate('window.__h1HeldDescription=false');
  await evaluate(`window.__h1HoldDescription=${JSON.stringify(b.id)}`);
  await evaluate(`window.__dndDebug.target(${JSON.stringify(b.id)})`); // re-target B — its first zh describe is held
  await wait('window.__h1HeldDescription','held describe for the focus round');
  await evaluate('window.__h1ReleaseDescription()');
  await flavorSettled();
  check(await evaluate('document.activeElement===window.__h1FocusedEndTurn&&window.__h1FocusedEndTurn.isConnected'),'focus survives the describe rebuild on the same node');
  await shot('focus-survival-zh');
  await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13,text:'\r'});
  await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
  await wait('window.__h1ActionReplies.some(r=>r.type==="endTurn")','focused end-turn accepted keyboard activation');
  const endTurn=await evaluate('window.__h1ActionReplies.find(r=>r.type==="endTurn")');
  check(endTurn.status===200,'server accepted the keyboard end-turn');
  await wait('window.__dndDebug.rev()>='+endTurn.state.rev,'enemy turn resolved');
  await wait("document.querySelector('#coreHud [data-act=attack]')&&!document.querySelector('#coreHud [data-act=attack]').disabled",'player turn two');
  // The describe cache is keyed per monster SPECIES (locale+monsterId), so the two
  // staged skeletons only ever yield two uncached describes — the zh focus round above
  // is the bilingual barrier proof; a second press round would just re-read the cache.
  check(errors.length===0,'section A: no uncaught browser exceptions');
  await evaluate("location.hash='#/'");await wait("!document.getElementById('mapCanvas')",'clean leave A');
 }

 // --- Section B: a late held describe after leaving the page is dropped --------
 {
  const {id}=await fixture('offpage');
  const s=JSON.parse(fs.readFileSync(saveFile(id),'utf8'));
  const mon=s.entities.find(e=>e.kind==='monster'&&e.alive!==false);
  const p=s.entities.find(e=>e.kind==='player');
  const near=freeNeighbor(s,{x:p.x,y:p.y},[p],blockedTiles(s));
  check(near,'walkable tile next to the hero exists');
  mon.x=near.x;mon.y=near.y;s.rev++;
  fs.writeFileSync(saveFile(id),JSON.stringify(s));
  await open(id);
  await wait(`window.__dndDebug.rev()>=${s.rev}`,'re-staged state adopted');
  await evaluate(`window.__h1HoldDescription=${JSON.stringify(mon.id)}`);
  await evaluate(`window.__dndDebug.target(${JSON.stringify(mon.id)})`);
  await wait('window.__h1HeldDescription','held describe before leaving');
  await evaluate("location.hash='#/'");await wait("!document.getElementById('mapCanvas')&&document.getElementById('quickName')",'left the delve for home');
  await evaluate('window.__h1ReleaseDescription()');
  await new Promise(r=>setTimeout(r,400));
  check(await evaluate('window.__h1ActionRequests.find(r=>r.type==="describe").completed===true'),'late describe completed off-page');
  check(errors.length===0,'off-page late response raises no browser exceptions');
 }

 // --- Section C: settlement lock survives HUD reconciliation -------------------
 {
  const {id,charId}=await fixture('settle');
  await open(id);
  const before=await evaluate('window.__dndDebug.rev()');
  await evaluate("document.querySelector('[data-act=retreat]').click()");
  await wait("document.getElementById('summaryModal')",'retreat summary opened');
  await wait(`window.__dndDebug.rev()>${before}`,'settlement write adopted by the live view');
  check(await evaluate('document.getElementById("summaryModal").isConnected'),'summary survives the reconciled HUD update');
  const requestsBefore=await evaluate('window.__h1ActionRequests.length');
  await evaluate("document.querySelector('[data-act=retreat]').click()");
  check(await evaluate(`window.__h1ActionRequests.length===${requestsBefore}`),'locked settlement dispatches no game action');
  await shot('settlement-lock');
  await wait("document.querySelector('#summaryModal .sumNavBtn[aria-disabled=false]')",'settlement succeeded and unlocked');
  await evaluate("document.querySelector('#summaryModal .sumNavBtn').click()");
  await wait("location.hash.includes('/overworld')",'town return after unlock');
  const roster=await api('GET','/api/characters/'+charId);
  check(roster&&roster.id===charId&&typeof roster.gold==='number','roster intact after retreat settlement');
  check(errors.length===0,'section C: no uncaught browser exceptions');
 }
 check(errors.length===0,'no uncaught browser exceptions at all');
} catch(error){failed++;console.error('  FAIL: '+error.stack);await captureBrowserArtifacts('h1-failure',[PORT]).catch(e=>console.error(e.message));try{fs.writeFileSync(path.join(process.env.VERIFY_ARTIFACT_DIR,'h1-failure-audit.json'),JSON.stringify(await evaluate('({requests:window.__h1ActionRequests,replies:window.__h1ActionReplies,appearanceLoading:window.__dndDebug?.loadingAppearance()})'),null,2));}catch(e){console.error('Failure audit '+e.message);}}
finally {
 try{await closeBrowser(browser,ws,send,profile);}catch(error){failed++;console.error('Browser cleanup failed: '+error.stack);}
 for(const id of saves)await api('DELETE','/api/game/'+id).catch(e=>{failed++;console.error(e.message);});
 for(const id of chars)await api('DELETE','/api/characters/'+id).catch(e=>{failed++;console.error(e.message);});
}
console.log('H1 HUD stability CDP: '+passed+' passed, '+failed+' failed.');process.exitCode=failed?1:0;
