// T11: real pointer input, two full routes in both languages, phone and persisted history.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import presets from '../../server/game/presets.js';
import { assertTestContainer } from '../../scripts/test-container.mjs';
import { browserBinary,softwareWebGLFlags,requireWebGL,captureBrowserArtifacts,closeBrowser } from './_browser-runtime.mjs';
assertTestContainer();
const BASE=process.env.BASE_URL || 'http://localhost:'+(process.env.PORT || 3000),PORT=9235;
const profile=fs.mkdtempSync(path.join(os.tmpdir(),'ai-dnd-t11-cdp-')),pending=new Map(),saves=[],chars=[],errors=[],timings=[];
let ws,browser,sequence=0,passed=0,failed=0;
function check(value,message){if(!value)throw new Error(message);passed++;console.log('  PASS: '+message);}
function send(method,params={}){return new Promise((resolve,reject)=>{const id=++sequence,timer=setTimeout(()=>{pending.delete(id);reject(new Error('CDP timeout: '+method));},20000);pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params}));});}
async function evaluate(expression){const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw new Error(JSON.stringify(r.exceptionDetails));return r.result.value;}
async function wait(expression,label){const until=Date.now()+15000;while(Date.now()<until){if(await evaluate('!!('+expression+')'))return;await new Promise(r=>setTimeout(r,150));}throw new Error('Timed out: '+label);}
async function api(method,url,body){const r=await fetch(BASE+url,{method,headers:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)}),data=await r.json();if(!r.ok)throw new Error(url+': '+JSON.stringify(data));return data;}
async function pointer(p){const down=send('Input.dispatchMouseEvent',{type:'mousePressed',...p,button:'left',clickCount:1}),up=send('Input.dispatchMouseEvent',{type:'mouseReleased',...p,button:'left',clickCount:1});await Promise.all([down,up]);}
async function click(selector){const r=await evaluate(`(async()=>{let el=document.querySelector(${JSON.stringify(selector)});if(!el||el.disabled)return {reason:'missing or disabled'};el.scrollIntoView({block:'center'});await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));el=document.querySelector(${JSON.stringify(selector)});if(!el||el.disabled)return {reason:'changed after layout'};const r=(el.matches('[data-node-id]')?el.querySelector('.waypoint-hit'):el).getBoundingClientRect(),point={x:r.x+r.width/2,y:r.y+r.height/2},hit=document.elementFromPoint(point.x,point.y);return el.contains(hit)?{point}:{reason:'occluded',point,hit:hit?.outerHTML.slice(0,200),connected:el.isConnected,viewport:[innerWidth,innerHeight]};})()`);check(r.point&&!r.reason,'pointer '+selector+' '+(r.reason?JSON.stringify(r):''));await pointer(r.point);}
async function tile(x,y){const p=await evaluate(`(()=>{const c=document.getElementById('mapCanvas'),r=c.getBoundingClientRect();return {x:r.left+(${x}+.5)*r.width/25,y:r.top+(${y}+.5)*r.height/15};})()`);await pointer(p);}
async function canvasAction(id,x,y,predicate){await tile(x,y);const until=Date.now()+15000;while(Date.now()<until){const s=(await api('GET','/api/game/'+id)).state;if(predicate(s)){await wait('window.__dndDebug.rev()>='+s.rev,'state adopted');return s;}await new Promise(r=>setTimeout(r,150));}throw new Error('Canvas did not converge: '+x+','+y);}
async function locale(value){await evaluate(`import('/js/i18n.js').then(m=>m.setLocale('${value}'))`);}
async function shot(name){await captureBrowserArtifacts('t11-'+name,[PORT]);for(const ext of ['png','json'])check(fs.existsSync(path.join(process.env.VERIFY_ARTIFACT_DIR,'screenshots','t11-'+name+'-'+PORT+'-0.'+ext)),'saved '+name+' '+ext);}
async function open(id){await evaluate(`location.hash='#/play/${id}'`);await wait("document.getElementById('mapCanvas')&&window.__dndDebug",'delve open');
 await evaluate(`(()=>{window.__t11ActionReplies=[];window.__t11ActionRequests=[];if(window.__t11ActionCapture)return;window.__t11ActionCapture=true;if(!window.__t11ClickBound){window.__t11ClickBound=true;document.addEventListener('click',function(e){var b=e.target&&e.target.closest?e.target.closest('[data-act]'):null;(window.__t11Clicks=window.__t11Clicks||[]).push({act:b?b.dataset.act:null,tag:e.target.tagName,cls:String(e.target.className||'').slice(0,40),x:e.clientX,y:e.clientY});},true);}const original=window.fetch;window.fetch=async(...args)=>{const action=typeof args[0]==='string'&&args[0].startsWith('/api/game/')&&args[0].endsWith('/action')?JSON.parse(args[1]?.body||'{}'):null,entry=action?{type:action.type,targetId:action.targetId,completed:false}:null;if(entry)window.__t11ActionRequests.push(entry);try{const response=await original(...args);if(entry){entry.status=response.status;if(action.type==='describe'&&action.targetId===window.__t11HoldDescription){window.__t11HoldDescription=null;window.__t11HeldDescription=true;await new Promise(resolve=>window.__t11ReleaseDescription=resolve);}if(['describe','portrait'].includes(action.type)){const json=response.json.bind(response);response.json=async()=>{try{const data=await json();entry.flavorErrors=data.events?.filter(e=>e.type==='error');return data;}finally{requestAnimationFrame(()=>requestAnimationFrame(()=>entry.uiSettled=true));}};}if(['attack','endTurn'].includes(action.type))window.__t11ActionReplies.push({type:action.type,status:response.status,...await response.clone().json()});}return response;}finally{if(entry)entry.completed=true;}};})()`);
}
async function targetReady(){
 // Flavor may return null. Wait for JSON consumption and the ensuing UI frames,
 // including the portrait request started by the description continuation.
 await wait("!window.__dndDebug.loadingAppearance()&&window.__t11ActionRequests.filter(r=>['describe','portrait'].includes(r.type)).every(r=>r.completed&&r.uiSettled)",'target flavor responses consumed and UI settled');
}
async function proveDescriptionClickSurvival(){
 // H1: the reconciled HUD keeps the pressed attack node across the held description,
 // so releasing the pointer completes exactly one real, server-accepted attack.
 // The release follows the held node's current center; a click recorder on the real
 // DOM path proves the browser synthesized the click on that node.
 await wait('window.__t11HeldDescription','held real description response');
 await wait("!document.querySelector('.dice-overlay')",'combat flourish finished');
 const mark=await evaluate(`(window.__t11Clicks=window.__t11Clicks||[],window.__t11ActionReplies.filter(r=>r.type==='attack').length)`),probe=await evaluate("(()=>{const b=document.querySelector('#coreHud [data-act=attack]');window.__t11PressedAttack=b;const r=b.getBoundingClientRect(),point={x:r.x+r.width/2,y:r.y+r.height/2};return {point,hittable:!b.disabled&&b.contains(document.elementFromPoint(point.x,point.y))};})()");
 check(probe.hittable,'pressed HUD attack is enabled and unoccluded');const point=probe.point;
 await send('Input.dispatchMouseEvent',{type:'mousePressed',...point,button:'left',clickCount:1});
 await evaluate('window.__t11ReleaseDescription()');await targetReady();
 const mid=await evaluate(`(()=>{const b=window.__t11PressedAttack,r=b.getBoundingClientRect();return {connected:b.isConnected,stillInHud:document.querySelector('#coreHud [data-act=attack]')===b,point:{x:r.x+r.width/2,y:r.y+r.height/2},hitAtStart:(()=>{const el=document.elementFromPoint(${point.x},${point.y});return el?el.tagName+'.'+(el.dataset&&el.dataset.act||el.className||''):'none';})()};})()`);
 check(mid.connected,'description completion keeps the pressed HUD button');
 check(mid.stillInHud,'HUD update reuses the same attack node');
 await send('Input.dispatchMouseEvent',{type:'mouseReleased',...mid.point,button:'left',clickCount:1});
 await wait(`window.__t11ActionReplies.slice(${mark}).some(r=>r.type==='attack')`,'release fires the real attack request');
 check(await evaluate(`window.__t11ActionReplies.slice(${mark}).filter(r=>r.type==='attack').length===1`),'release issues exactly one attack, no duplicates');
 check(await evaluate(`(window.__t11Clicks||[]).filter(c=>c.act==='attack').length===1`),'the release produced exactly one attack click');
 const reply=await evaluate(`window.__t11ActionReplies.slice(${mark}).find(r=>r.type==='attack')`);
 check(reply.status===200&&!reply.events.some(e=>e.type==='error'),'server accepted the released attack');
 await wait('window.__dndDebug.rev()>='+reply.state.rev,'released attack adopted');
 check(await evaluate("(()=>{const b=document.querySelector('#coreHud [data-act=attack]');return !b||b.disabled;})()"),'attack correctly spent after the released click');
 // pressedConnectedThroughDescribe is sampled right after the flavor response settled
 // (the moment the old bug detached the button); pressedConnectedAfterResolution is
 // sampled when this evidence is written — the released attack may have ended combat,
 // which legitimately removes the attack button from the HUD.
 const evidence=await evaluate(`({pressedConnectedThroughDescribe:${mid.connected},pressedNodeReusedByHud:${mid.stillInHud},pressedConnectedAfterResolution:!!window.__t11PressedAttack.isConnected,pressStart:${JSON.stringify(point)},releaseAt:${JSON.stringify(mid.point)},clicks:window.__t11Clicks||[],newReplies:window.__t11ActionReplies.slice(${mark}),appearanceLoading:window.__dndDebug.loadingAppearance()})`);
 fs.writeFileSync(path.join(process.env.VERIFY_ARTIFACT_DIR,'t11-description-click-race.json'),JSON.stringify(evidence,null,2));
}
async function combatAction(selector,type){
 // A target-description response can increase rev before the actual attack finishes.
 const mark=await evaluate('window.__t11ActionReplies.length');await click(selector);
 await wait(`window.__t11ActionReplies.slice(${mark}).some(r=>r.type===${JSON.stringify(type)})`,'actual '+type+' response');
 const reply=await evaluate(`window.__t11ActionReplies.slice(${mark}).find(r=>r.type===${JSON.stringify(type)})`);
 check(reply.status===200&&!reply.events.some(e=>e.type==='error'),'server accepted actual '+type);
 await wait('window.__dndDebug.rev()>='+reply.state.rev,type+' response adopted');return reply.state;
}
async function fixture(route){const char=await api('POST','/api/characters',{...presets.draftFor('guardian'),species:'human',name:'T11 旅人 <raw> {p1}'});chars.push(char.id);
 const rosterFile=path.join(process.env.DATA_DIR,'characters.json'),roster=JSON.parse(fs.readFileSync(rosterFile,'utf8'));roster.find(c=>c.id===char.id).gold=50;fs.writeFileSync(rosterFile,JSON.stringify(roster));
 const id=(await api('POST','/api/game/start',{characterId:char.id,mapId:'courier-crossing',difficulty:'easy',bringAlly:false})).state.id;saves.push(id);
 if(route==='protect'){const file=path.join(process.env.DATA_DIR,'saves',id+'.json'),s=JSON.parse(fs.readFileSync(file,'utf8')),p=s.entities.find(e=>e.kind==='player'),guard=s.entities.find(e=>e.id==='courier_guard');p.hp=p.hpMax=200;guard.hp=guard.hpMax=1;guard.ac=1;s.character.attacks.push({weaponId:'longbow',name:'Fixture Bow',bonus:30,dmgDice:'1d8',dmgMod:5,damageType:'piercing',ranged:true,range:150});s.rev++;fs.writeFileSync(file,JSON.stringify(s));}
 return {id,charId:char.id};
}
try {
 browser=spawn(browserBinary(),['--headless=new',...softwareWebGLFlags(),'--no-sandbox','--disable-dev-shm-usage','--no-first-run','--no-default-browser-check','--remote-debugging-port='+PORT,'--user-data-dir='+profile,'--window-size=1440,900',BASE+'/#/'],{detached:true,stdio:'ignore'});
 let tab;for(let n=0;n<70&&!tab;n++){tab=(await fetch('http://127.0.0.1:'+PORT+'/json').then(r=>r.json()).catch(()=>[])).find(t=>t.type==='page');if(!tab)await new Promise(r=>setTimeout(r,150));}if(!tab)throw new Error('Required Chromium did not start');
 ws=new WebSocket(tab.webSocketDebuggerUrl);await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject;});ws.onmessage=event=>{const r=JSON.parse(event.data);if(r.method==='Runtime.exceptionThrown')errors.push(r.params.exceptionDetails);const call=pending.get(r.id);if(!call)return;pending.delete(r.id);clearTimeout(call.timer);if(r.error)call.reject(new Error(r.error.message));else call.resolve(r.result);};
 await send('Page.enable');await send('Runtime.enable');await requireWebGL(send);await wait("document.getElementById('quickName')",'home');
 await evaluate("localStorage.setItem('dnd_default_view','2d');localStorage.setItem('dnd_3d','off');localStorage.setItem('aiDnd.tutorial.v1',JSON.stringify({status:'skipped'}))");
 for(const lang of ['en','zh-CN'])for(const route of ['report','protect']){
  const started=Date.now(),{id,charId}=await fixture(route);await locale(lang);await send('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});await open(id);
  const initial=(await api('GET','/api/game/'+id)).state;check(!JSON.stringify(initial).includes('quiet_departure'),'future ending hidden');
  await canvasAction(id,6,7,s=>s.entities.find(e=>e.kind==='player').x===6&&s.entities.find(e=>e.kind==='player').y===7);await tile(6,6);await wait("document.getElementById('sceneModal')",'Iris choices');
  check(await evaluate("document.querySelectorAll('[data-scene-risk]').length===3"),'all crossing costs and risks visible');
  await shot(lang+'-'+route+'-crossing-desktop');
  const before=JSON.stringify((await api('GET','/api/game/'+id)).state);await evaluate("window.__choice=document.querySelector('[data-scene-choice=pay_toll]');window.__choice.focus();window.__canvas=document.getElementById('mapCanvas')");
  if(lang==='en'&&route==='report'){await new Promise(resolve=>setTimeout(resolve,4500));check(await evaluate("document.activeElement===window.__choice&&window.__choice===document.querySelector('[data-scene-choice=pay_toll]')"),'unchanged server polling preserves focused choice');}
  await locale(lang==='en'?'zh-CN':'en');
  check(await evaluate("document.activeElement===window.__choice&&window.__choice===document.querySelector('[data-scene-choice=pay_toll]')&&window.__canvas===document.getElementById('mapCanvas')"),'locale preserves focused choice and map');check(JSON.stringify((await api('GET','/api/game/'+id)).state)===before,'locale causes no server state mutation');await locale(lang);
  await click('[data-scene-choice='+ (route==='report'?'pay_toll':'fight')+']');
  if(route==='report'){await wait("document.querySelector('[data-scene-outcome]')",'paid crossing');await click('[data-scene-close]');}
  else {
   await wait("!document.getElementById('sceneModal')&&document.querySelector('[data-act=attack]')",'real combat');let s=(await api('GET','/api/game/'+id)).state;
   for(let n=0;n<20&&s.mode==='combat';n++){await wait("!document.querySelector('[data-act=attack]')?.disabled",'attack usable');const guard=s.entities.find(e=>e.id==='courier_guard'),race=lang==='en'&&n===0;
    if(race)await evaluate("window.__t11HeldDescription=false;window.__t11HoldDescription='courier_guard'");await tile(guard.x,guard.y);
    if(race){await proveDescriptionClickSurvival();s=(await api('GET','/api/game/'+id)).state;}
    else{
    // The real HUD chooses a ranged attack at distance and melee after the guard approaches.
    s=await combatAction('[data-act=attack]','attack');}
    if(s.mode==='combat'){await wait("document.querySelector('[data-act=endturn]')&&!document.querySelector('[data-act=endturn]').disabled",'turn control ready');s=await combatAction('[data-act=endturn]','endTurn');}}
   check(s.mode==='explore'&&s.encounterFacts[0].fact==='forced_crossing','real UI combat confirms crossing');
  }
  await canvasAction(id,20,11,s=>s.entities.find(e=>e.kind==='player').x===20&&s.entities.find(e=>e.kind==='player').y===11);await tile(21,11);await wait("document.querySelector('[data-scene-choice=listen]')",'courier testimony');
  await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  check(await evaluate("document.documentElement.scrollWidth<=innerWidth&&document.querySelector('#sceneModal .modal').getBoundingClientRect().height<=innerHeight"),'long testimony fits phone with internal scrolling');await shot(lang+'-'+route+'-testimony-phone');
  await click('[data-scene-choice='+ (route==='report'?'listen':'give_aid')+']');await wait("document.querySelector('[data-scene-outcome]')",'real ledger received');await click('[data-scene-close]');
  await send('Page.reload');await wait("document.getElementById('mapCanvas')",'refresh mid-story');const refreshed=(await api('GET','/api/game/'+id)).state;check(refreshed.encounterFacts.length===2&&refreshed.character.inventory.find(i=>i.itemId==='courier_ledger').qty===1,'refresh keeps exact choices and one ledger');
  await send('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});await canvasAction(id,6,7,s=>s.entities.find(e=>e.kind==='player').x===6&&s.entities.find(e=>e.kind==='player').y===7);await tile(6,6);await wait("document.querySelector('[data-scene-choice=report]')",'same NPC now exposes final scene');
  await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});check(await evaluate("document.querySelectorAll('[data-scene-risk]').length===3"),'final resource costs and fallback risk visible');await shot(lang+'-'+route+'-ending-options-phone');
  await click('[data-scene-choice='+route+']');await wait("document.querySelector('[data-scene-outcome]')",'confirmed ending');
  check(await evaluate(`document.querySelector('[data-scene-outcome]').textContent.includes('${lang==='en'?(route==='report'?'Public Record':'Ferry in the Mist'):(route==='report'?'公开的账册':'雾中的渡船')}')`),'correct handwritten ending '+lang+' '+route);await shot(lang+'-'+route+'-ending-phone');await click('[data-scene-close]');
  await send('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});await canvasAction(id,1,7,s=>s.mode==='victory');await wait("document.querySelector('#summaryModal .sumNavBtn[aria-disabled=false]')",'settlement succeeded');check(await evaluate("document.querySelectorAll('#summaryAdventure [data-story-choice]').length===3"),'receipt summary shows all three real choices and costs');await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});await shot(lang+'-'+route+'-summary-phone');
  await click('#summaryModal .sumNavBtn');await wait("location.hash.includes('/overworld')",'town return');const roster=await api('GET','/api/characters/'+charId);check(roster.encounterFacts.length===3,'all three facts reached roster');
  await evaluate(`location.hash='#/character/${charId}'`);await wait("document.querySelector('[data-story-history]')",'town story history');check(await evaluate(`document.querySelector('[data-story-history]').textContent.includes('${lang==='en'?(route==='report'?'Public Record':'Ferry in the Mist'):(route==='report'?'公开的账册':'雾中的渡船')}')`),'town remembers confirmed ending');await evaluate("document.querySelector('[data-story-history]').scrollIntoView({block:'start'})");await shot(lang+'-'+route+'-town-phone');
  await evaluate(`location.hash='#/overworld?char=${charId}'`);await wait("document.querySelector('[data-node-id=courier-crossing]')",'story node in actual town map');await click('[data-node-id=courier-crossing]');await wait("document.getElementById('embarkBtn')?.getAttribute('data-map-id')==='courier-crossing'",'real departure button');check(true,'story is selectable through the normal town UI');
  const seconds=(Date.now()-started)/1000;timings.push({language:lang,route,seconds,style:'Accelerated Chromium pointer play; no reading pauses; combat durability fixture on protect only'});console.log('  TIMED ROUTE '+lang+' '+route+': '+seconds.toFixed(2)+'s (accelerated, not human reading time)');
  await evaluate("location.hash='#/'");await wait("!document.getElementById('mapCanvas')",'clean leave');
 }
 check(errors.length===0,'no uncaught browser exceptions');fs.writeFileSync(path.join(process.env.VERIFY_ARTIFACT_DIR,'t11-route-timings.json'),JSON.stringify(timings,null,2));
} catch(error){failed++;console.error('  FAIL: '+error.stack);await captureBrowserArtifacts('t11-failure',[PORT]).catch(e=>console.error(e.message));try{fs.writeFileSync(path.join(process.env.VERIFY_ARTIFACT_DIR,'t11-failure-actions.json'),JSON.stringify(await evaluate('({requests:window.__t11ActionRequests,replies:window.__t11ActionReplies,clicks:window.__t11Clicks,pressed:(function(){var b=window.__t11PressedAttack;if(!b)return null;var r=b.getBoundingClientRect();return {connected:b.isConnected,rect:{x:r.x,y:r.y,w:r.width,h:r.height},inHud:document.querySelector("#coreHud [data-act=attack]")===b};})(),appearanceLoading:window.__dndDebug?.loadingAppearance(),portraits:window.__dndDebug?.portraits()})'),null,2));}catch(e){failed++;console.error('Failure audit '+e.stack);}}
finally {
 try{await closeBrowser(browser,ws,send,profile);}catch(error){failed++;console.error('Browser cleanup failed: '+error.stack);}
 for(const id of saves)await api('DELETE','/api/game/'+id).catch(e=>{failed++;console.error(e.message);});
 for(const id of chars)await api('DELETE','/api/characters/'+id).catch(e=>{failed++;console.error(e.message);});
}
console.log('T11 CDP: '+passed+' passed, '+failed+' failed.');process.exitCode=failed?1:0;
