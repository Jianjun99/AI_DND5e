// Deterministic response barriers: release only after the replacement navigation commits.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { assertTestContainer } from '../../scripts/test-container.mjs';
import { captureBrowserArtifacts } from '../../scripts/cdp-artifacts.mjs';
import { browserBinary, softwareWebGLFlags, requireWebGL, closeBrowser } from './_browser-runtime.mjs';
assertTestContainer();
const require=createRequire(import.meta.url), presets=require('../../server/game/presets.js'), engine=require('../../server/game/engine.js');
const BASE=process.env.BASE_URL||'http://localhost:'+(process.env.PORT||3000), PORT=9236;
const profile=fs.mkdtempSync(path.join(os.tmpdir(),'ai-dnd-review-cdp-')), pending=new Map(), chars=[], saves=[], errors=[];
let ws,browser,sequence=0,passed=0,failed=0,held=null,activeScenario='startup',fetchOpen=false,barrierTarget='';
const continuingRequests=new Set();
function recordError(details){
 const error={scenario:activeScenario,details};errors.push(error);
 console.error('  Browser exception: '+JSON.stringify(error));
 fs.writeFileSync(path.join(process.env.VERIFY_ARTIFACT_DIR,'review-browser-errors.json'),JSON.stringify(errors,null,2));
}
function check(value,message){if(!value)throw new Error(message);passed++;console.log('  PASS: '+message);}
function send(method,params={}){return new Promise((resolve,reject)=>{const id=++sequence,timer=setTimeout(()=>{pending.delete(id);reject(new Error('CDP timeout: '+method));},20000);pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params}));});}
async function evaluate(expression){const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw new Error(JSON.stringify(r.exceptionDetails));return r.result.value;}
async function wait(expression,label){const until=Date.now()+15000;while(Date.now()<until){if(await evaluate('!!('+expression+')'))return;await new Promise(r=>setTimeout(r,80));}throw new Error('Timed out: '+label);}
async function api(method,url,body){const r=await fetch(BASE+url,{method,headers:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)}),d=await r.json();if(!r.ok)throw new Error(url+': '+JSON.stringify(d));return d;}
async function go(hash){await evaluate(`(async()=>{const m=await import('/js/app.js');history.replaceState(null,'',${JSON.stringify(hash)});await m.navigate();})()`);}
async function begin(hash){await evaluate(`(async()=>{const m=await import('/js/app.js');history.replaceState(null,'',${JSON.stringify(hash)});window.__oldNavigation=m.navigate();})()`);}
async function barrier(url){held=null;barrierTarget=url;fetchOpen=true;await send('Fetch.enable',{patterns:[{urlPattern:'*'+url+'*',requestStage:'Response'}]});}
async function disableBarrier(){
 // Stop issuing new continuations before disabling Fetch. The disable command
 // releases any remaining paused requests; continuations already sent must finish.
 fetchOpen=false;await Promise.all([...continuingRequests]);await send('Fetch.disable');
}
function pausedResponse(response){
 if(!fetchOpen)return;
 if(!held&&new URL(response.request.url).pathname.endsWith(barrierTarget)){held=response;return;}
 const continuation=send('Fetch.continueRequest',{requestId:response.requestId}).catch(recordError).finally(()=>continuingRequests.delete(continuation));
 continuingRequests.add(continuation);
}
async function reached(){const until=Date.now()+15000;while(!held&&Date.now()<until)await new Promise(r=>setTimeout(r,40));check(!!held,'old HTTP response held at explicit barrier');}
async function release(fail=false){
 const h=held;check(!!h,'barrier has response');
 if(fail)await send('Fetch.fulfillRequest',{requestId:h.requestId,responseCode:500,responseHeaders:[{name:'Content-Type',value:'application/json'}],body:Buffer.from(JSON.stringify({error:'review delayed failure'})).toString('base64')});
 else await send('Fetch.continueRequest',{requestId:h.requestId});
 await disableBarrier();
}
async function shot(name){await captureBrowserArtifacts('review-'+name,[PORT]);for(const ext of ['png','json'])check(fs.existsSync(path.join(process.env.VERIFY_ARTIFACT_DIR,'screenshots','review-'+name+'-'+PORT+'-0.'+ext)),'saved '+name+' '+ext);}
async function scenario(name,fn){activeScenario=name;try{await fn();}catch(error){failed++;console.error('  FAIL '+name+': '+error.stack);await shot('failure-'+name);}finally{await disableBarrier();await go('#/');}}
async function locale(value){await evaluate(`import('/js/i18n.js').then(m=>m.setLocale('${value}'))`);}
function saveFixture(id,fn){const file=path.join(process.env.DATA_DIR,'saves',id+'.json'),state=JSON.parse(fs.readFileSync(file,'utf8'));fn(state);state.rev++;fs.writeFileSync(file,JSON.stringify(state));}
try{
 browser=spawn(browserBinary(),['--headless=new',...softwareWebGLFlags(),'--no-sandbox','--disable-dev-shm-usage','--no-first-run','--no-default-browser-check','--remote-debugging-port='+PORT,'--user-data-dir='+profile,'--window-size=1440,900',BASE+'/#/'],{detached:true,stdio:'ignore'});
 let tab;for(let n=0;n<70&&!tab;n++){tab=(await fetch('http://127.0.0.1:'+PORT+'/json').then(r=>r.json()).catch(()=>[])).find(t=>t.type==='page');if(!tab)await new Promise(r=>setTimeout(r,100));}if(!tab)throw new Error('Required Chromium unavailable');
 ws=new WebSocket(tab.webSocketDebuggerUrl);await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject;});ws.onmessage=event=>{const r=JSON.parse(event.data);if(r.method==='Runtime.exceptionThrown')recordError(r.params.exceptionDetails);if(r.method==='Fetch.requestPaused')pausedResponse(r.params);const call=pending.get(r.id);if(!call)return;pending.delete(r.id);clearTimeout(call.timer);if(r.error)call.reject(new Error(r.error.message));else call.resolve(r.result);};
 await send('Page.enable');await send('Runtime.enable');await requireWebGL(send);await wait("document.getElementById('quickName')",'home');
 await evaluate(`(async()=>{localStorage.setItem('dnd_default_view','2d');localStorage.setItem('dnd_3d','off');localStorage.setItem('aiDnd.tutorial.v1',JSON.stringify({status:'skipped'}));window.__review={starts:0,stops:0,listeners:new Set(),writes:[]};const s=(await import('/js/sfx.js')).sfx;for(const [key,count] of [['startAmbient','starts'],['stopAmbient','stops']]){const f=s[key].bind(s);s[key]=(...args)=>{window.__review[count]++;return f(...args);};}const add=window.addEventListener.bind(window),remove=window.removeEventListener.bind(window);window.addEventListener=(type,fn,...args)=>{if(type==='game:localechange')window.__review.listeners.add(fn);return add(type,fn,...args);};window.removeEventListener=(type,fn,...args)=>{if(type==='game:localechange')window.__review.listeners.delete(fn);return remove(type,fn,...args);};const original=window.fetch;window.fetch=(url,init)=>{if(init?.method&&!['GET','HEAD','OPTIONS'].includes(init.method))window.__review.writes.push(String(url));return original(url,init);};})()`);
 const char=await api('POST','/api/characters',{...presets.draftFor('guardian'),name:'Review dwarf'});chars.push(char.id);
 const town='#/overworld?char='+char.id, sheet='#/character/'+char.id;
 for(const destination of [sheet,'#/settings'])for(const failure of [false,true])await scenario('town-'+(destination===sheet?'sheet':'settings')+'-'+failure,async()=>{
  await barrier('/api/city/info');await begin(town);await reached();await go(destination);
  check(await evaluate(destination===sheet?"!!document.querySelector('.paperdoll-slot')":"!!document.querySelector('.settings-hub')"),'replacement route committed');
  await evaluate("window.__target=document.getElementById('view').firstElementChild;window.__mark={starts:window.__review.starts,stops:window.__review.stops,listeners:window.__review.listeners.size}");
  await release(failure);await evaluate('window.__oldNavigation');
  check(await evaluate(`location.hash===${JSON.stringify(destination)}&&window.__target===document.getElementById('view').firstElementChild`),'released old town cannot replace destination DOM');
  check(await evaluate("window.__review.starts===window.__mark.starts&&window.__review.stops===window.__mark.stops&&window.__review.listeners.size===window.__mark.listeners"),'old town adds no ambient sound or locale listener');
  check(await evaluate("!document.querySelector('[data-route-error]')&&!document.getElementById('roadEncounterModal')"),'stale success/failure cannot paint error or modal');
  await shot('town-'+(destination===sheet?'sheet':'settings')+'-'+failure);
  await go('#/create');check(await evaluate('window.__review.listeners.size===window.__mark.listeners'),'current cleanup survived old return');
 });
 for(const failure of [false,true])await scenario('sheet-town-'+failure,async()=>{
  await barrier('/api/characters/'+char.id);await begin(sheet);await reached();await go(town);
  await evaluate("window.__target=document.getElementById('view').firstElementChild;window.__mark={stops:window.__review.stops,listeners:window.__review.listeners.size}");
  await release(failure);await evaluate('window.__oldNavigation');
  check(await evaluate("!!document.querySelector('.overworld-view')&&window.__target===document.getElementById('view').firstElementChild&&!document.querySelector('[data-route-error]')"),'late sheet success/error preserves current town');
  await go('#/create');check(await evaluate('window.__review.stops===window.__mark.stops+1&&window.__review.listeners.size===window.__mark.listeners'),'current town cleanup still owns ambient and subscription');
 });
 await scenario('same-hash-new-mount',async()=>{
  await barrier('/api/city/info');await begin(town);await reached();await go('#/settings');await go(town);
  await evaluate("window.__target=document.getElementById('view').firstElementChild;window.__mark={starts:window.__review.starts,listeners:window.__review.listeners.size}");
  await release();await evaluate('window.__oldNavigation');
  check(await evaluate("window.__target===document.getElementById('view').firstElementChild&&window.__review.starts===window.__mark.starts&&window.__review.listeners.size===window.__mark.listeners"),'same hash has distinct navigation identity');
 });
 for(const [name,source,url] of [['home','#/','/api/characters'],['campaign','#/campaign/'+char.id,'/api/city/campaign'],['settings','#/settings','/api/settings'],['prepare','#/play/new?char='+char.id,'/api/content']])await scenario('all-initializers-'+name,async()=>{
  await go('#/create');await barrier(url);await begin(source);await reached();await go(sheet);
  await evaluate("window.__target=document.getElementById('view').firstElementChild;window.__listenerMark=window.__review.listeners.size");
  await release(true);await evaluate('window.__oldNavigation');
  check(await evaluate("!!document.querySelector('.paperdoll-slot')&&window.__target===document.getElementById('view').firstElementChild&&window.__review.listeners.size===window.__listenerMark&&!document.querySelector('[data-route-error]')"),name+' late initialization failure cannot publish DOM or subscribe');
 });
 await scenario('settings-same-hash-new-mount',async()=>{
  await barrier('/api/settings');await begin('#/settings');await reached();await go(sheet);await go('#/settings');
  await evaluate("window.__target=document.getElementById('view').firstElementChild;window.__listenerMark=window.__review.listeners.size");
  await release();await evaluate('window.__oldNavigation');
  check(await evaluate("window.__target===document.getElementById('view').firstElementChild&&window.__review.listeners.size===window.__listenerMark"),'old settings cannot replace same-hash remount or its cleanup');
  await go('#/create');check(await evaluate('window.__review.listeners.size===window.__listenerMark'),'late undefined cleanup cannot erase current settings cleanup');
 });
 const id=(await api('POST','/api/game/start',{characterId:char.id,mapId:'crypt',bringAlly:false})).state.id;saves.push(id);
 await scenario('play-settings',async()=>{
  await barrier('/api/game/'+id);await begin('#/play/'+id);await reached();await go('#/settings');await release();await evaluate('window.__oldNavigation');
  check(await evaluate("(async()=>!!document.querySelector('.settings-hub')&&!document.getElementById('mapCanvas')&&!(await import('/js/map3d.js')).map3DResources().renderers)()"),'pending play cannot create renderer after leaving');
 });
 // Production modal factory, real authorized API payload + previews, including loading state.
 for(const objectId of ['chest1','trap1'])await scenario('descriptor-'+objectId,async()=>{
  saveFixture(id,s=>{const obj=s.objects.find(o=>o.id===objectId),p=engine.playerEntity(s);p.x=obj.x-1;p.y=obj.y;s.discovered=[...new Set([...(s.discovered||[]),obj.x+','+obj.y])];obj.hidden=false;obj.revealed=true;engine.computeVision(s);});
  await go('#/play/'+id);await locale('zh-CN');
  await evaluate(`(async()=>{window.__payload=(await (await import('/js/api.js')).api.getGame('${id}')).state;window.__panels=(await import('/js/views/play/panels.js')).createPanels({getGame:()=>window.__payload,act:async action=>{const r=await (await import('/js/api.js')).api.gameAction('${id}',action);window.__payload=r.state;return r;},onSummaryLock:()=>{},onShopTalk:()=>{},onSummaryRespawn:()=>{}});})()`);
  await barrier('/preview');await evaluate(`window.__panels.openSkillCheckModal(window.__payload.objects.find(o=>o.id==='${objectId}'))`);await reached();
  const zh=objectId==='chest1'?'铁箍木箱':'飞镖陷阱',en=objectId==='chest1'?'Iron-Banded Chest':'Dart Trap';
  check(await evaluate(`document.querySelector('#skillCheckModal h2').textContent.includes('${zh}')`),'loading title uses Chinese descriptor');await shot('loading-'+objectId+'-zh');
  await locale('en');check(await evaluate(`document.querySelector('#skillCheckModal h2').textContent.includes('${en}')`),'loading title switches to English');
  await release();await wait(objectId==='chest1'?"document.getElementById('btnPick')":"document.getElementById('btnDisarm')",'preview ready');
  await evaluate(`window.__button=document.getElementById('${objectId==='chest1'?'btnPick':'btnDisarm'}');window.__button.disabled=true;window.__focus=document.getElementById('closeSkillModal');window.__focus.focus();window.__writeMark=window.__review.writes.length;window.__previewNumbers=document.querySelector('#skillCheckModal .modal').textContent.match(/DC \\d+|d20 [+-]\\d+/g).join('|')`);
  check(await evaluate('document.activeElement===window.__focus&&window.__button.disabled'),'fixture has focused enabled control alongside busy disabled action');
  await locale('zh-CN');check(await evaluate(`document.querySelector('#skillCheckModal h2').textContent.includes('${zh}')&&window.__focus===document.activeElement&&window.__button===document.getElementById('${objectId==='chest1'?'btnPick':'btnDisarm'}')&&window.__button.disabled&&window.__review.writes.length===window.__writeMark&&document.querySelector('#skillCheckModal .modal').textContent.match(/DC \\d+|d20 [+-]\\d+/g).join('|')===window.__previewNumbers`),'loaded title switches without losing focus/busy/numbers or dispatching action');
  await shot('loaded-'+objectId+'-zh');await locale('en');await shot('loaded-'+objectId+'-en');
  await evaluate(`document.getElementById('closeSkillModal').click();window.__panels.openSkillCheckModal({id:'legacy',type:'chest',name:'OLD 原文 <raw>'})`);
  check(await evaluate("document.querySelector('#skillCheckModal h2').textContent.includes('OLD 原文 <raw>')"),'legacy title preserves exact original text');await locale('zh-CN');check(await evaluate("document.querySelector('#skillCheckModal h2').textContent.includes('OLD 原文 <raw>')"),'legacy title remains verbatim after switch');
 });
 await scenario('campaign-summary',async()=>{
  // Place at the authored altar with doors open/guardians defeated. The engine must
  // acquire the real relic and adjudicate victory at camp; settlement is the real POST.
  saveFixture(id,s=>{const relic=s.objects.find(o=>o.id==='relic'),p=engine.playerEntity(s);p.x=relic.x-1;p.y=relic.y;s.entities.filter(e=>e.kind==='monster').forEach(e=>e.alive=false);s.objects.filter(o=>o.type==='door').forEach(o=>o.open=true);});
  await api('POST','/api/game/'+id+'/action',{type:'interact',objectId:'relic'});
  const camp=engine.campfireOf((await api('GET','/api/game/'+id)).state);
  const victory=(await api('POST','/api/game/'+id+'/action',{type:'move',x:camp.x,y:camp.y})).state;
  check(victory.mode==='victory','real engine relic return completes campaign map');
  await locale('en');await barrier('/sync-delve');await go('#/play/'+id);await reached();
  await evaluate("window.__writeMark=window.__review.writes.length;window.__saving=document.querySelector('#summaryModal .sumNavBtn')");
  await locale('zh-CN');await go('#/settings');
  check(await evaluate(`location.hash==='#/play/${id}'&&window.__saving===document.querySelector('#summaryModal .sumNavBtn')&&window.__saving.getAttribute('aria-disabled')==='true'&&window.__review.writes.length===window.__writeMark`),'language and navigation preserve real pending settlement lock');
  await locale('en');await release();await wait("document.querySelector('#summaryModal .sumNavBtn[aria-disabled=false]')",'settlement complete');
  const log=(await api('GET','/api/characters/'+char.id)).campaignLog.at(-1);check(!!log?.textDisplay,'real campaign settlement includes descriptor');
  const expected=await evaluate(`import('/js/i18n.js').then(m=>m.displayText(${JSON.stringify(log.textDisplay)},${JSON.stringify(log.text)}))`);
  check(await evaluate(`document.getElementById('summaryStory').textContent.includes(${JSON.stringify(expected)})`),'English campaign result resolves descriptor');await shot('campaign-summary-en');
  await evaluate("window.__nav=document.querySelector('#summaryModal .sumNavBtn');window.__nav.focus();window.__writeMark=window.__review.writes.length");
  await locale('zh-CN');const expectedZh=await evaluate(`import('/js/i18n.js').then(m=>m.displayText(${JSON.stringify(log.textDisplay)},${JSON.stringify(log.text)}))`);
  check(await evaluate(`document.getElementById('summaryStory').textContent.includes(${JSON.stringify(expectedZh)})&&window.__nav===document.activeElement&&window.__nav.getAttribute('aria-disabled')==='false'&&window.__review.writes.length===window.__writeMark`),'settled campaign switches language with same focus, lock and no new writes');await shot('campaign-summary-zh');
  // Reuse the real response, remove only its optional descriptor in the browser
  // fixture, and exercise the legacy rendering branch without rewriting a save.
  await evaluate(`(async()=>{document.getElementById('closeSummaryX').click();const a=(await import('/js/api.js')).api,original=a.citySyncDelve;const response=await original({charId:'${char.id}',delveStateId:'${id}'});delete response.char.campaignLog.at(-1).textDisplay;response.duplicate=false;a.citySyncDelve=async()=>response;try{window.__panels.openSummary();await new Promise(resolve=>requestAnimationFrame(resolve));}finally{a.citySyncDelve=original;}})()`);
  await locale('en');check(await evaluate(`document.getElementById('summaryStory').textContent.includes(${JSON.stringify(log.text)})`),'legacy campaign text stays verbatim without descriptor');
 });
 await scenario('region-map-svg-waypoints',async()=>{
  const info=await api('GET','/api/city/info?charId='+char.id);
  const before=JSON.stringify(await api('GET','/api/characters/'+char.id));
  const expectedIds=info.mapNodes.map(node=>node.id).sort();
  for(const [width,height] of [[1280,720],[1440,900],[1920,1080]]){
   await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
   await go(town+'&node=crypt');
   await evaluate('window.__regionSvg=document.querySelector(".region-svg");window.__regionWrites=window.__review.writes.length');
   for(const lang of ['en','zh-CN']){
    await locale(lang);
    const board=await evaluate(`(()=>{const svg=document.querySelector('.region-svg');return{ids:[...svg.querySelectorAll('[data-node-id]')].map(n=>n.dataset.nodeId).sort(),valid:[...document.querySelectorAll('[data-node-id]')].every(n=>n.namespaceURI==='http://www.w3.org/2000/svg'&&n.ownerSVGElement===svg),labels:[...svg.querySelectorAll('[data-node-id] text[data-i18n-display]')].map(n=>({id:n.closest('[data-node-id]').dataset.nodeId,text:n.textContent.trim(),width:n.getBBox().width,valid:n.children.length===0})),same:svg===window.__regionSvg};})()`);
    check(JSON.stringify(board.ids)===JSON.stringify(expectedIds)&&board.valid,'every waypoint remains inside the SVG at '+width+' '+lang);
    check(board.labels.length===expectedIds.length&&board.labels.every(n=>n.width>0&&n.valid),'all waypoint names are painted SVG text leaves at '+width+' '+lang);
    for(const node of info.mapNodes){
     const expected=await evaluate(`import('/js/i18n.js').then(m=>m.displayText(${JSON.stringify(node.nameDisplay)},${JSON.stringify(node.name)}))`);
     check(board.labels.find(label=>label.id===node.id)?.text===expected,'visible waypoint label matches selected language: '+node.id+' '+lang);
    }
    check(board.same&&await evaluate('window.__review.writes.length===window.__regionWrites'),'language switch preserves map identity and sends no actions');
    await shot('region-map-'+width+'-'+lang);
   }
  }
  for(const mapId of ['crypt','courier-crossing']){
   const selector='[data-node-id="'+mapId+'"]';
   const point=await evaluate(`(async()=>{const node=document.querySelector(${JSON.stringify(selector)});node.scrollIntoView({block:'center'});await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));const r=node.querySelector('circle').getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;return{x,y,hit:document.elementFromPoint(x,y)?.closest('[data-node-id]')?.getAttribute('data-node-id')};})()`);
   check(point.hit===mapId,'actual pointer reaches the drawn waypoint '+mapId);
   await send('Input.dispatchMouseEvent',{type:'mousePressed',x:point.x,y:point.y,button:'left',clickCount:1});
   await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:point.x,y:point.y,button:'left',clickCount:1});
   await wait(`document.getElementById('embarkBtn')?.getAttribute('data-map-id')===${JSON.stringify(mapId)}`,'waypoint opens its actual dispatch controls');
   check(await evaluate(`document.getElementById('embarkBtn').getAttribute('data-map-id')===${JSON.stringify(mapId)}&&!document.getElementById('embarkBtn').disabled`),'drawn '+mapId+' offers usable departure controls');
  }
  check(JSON.stringify(await api('GET','/api/characters/'+char.id))===before,'map viewing, language and selection leave authoritative character unchanged');
 });
 check(errors.length===0,'no uncaught browser exceptions');
}catch(error){failed++;console.error('  FAIL: '+error.stack);await captureBrowserArtifacts('review-fatal',[PORT]).catch(e=>console.error(e.message));}
finally{
 try{await closeBrowser(browser,ws,send,profile);}catch(error){failed++;console.error('Browser cleanup failed: '+error.stack);}
 for(const id of saves)await api('DELETE','/api/game/'+id).catch(e=>{failed++;console.error(e.message);});
 for(const id of chars)await api('DELETE','/api/characters/'+id).catch(e=>{failed++;console.error(e.message);});
}
console.log('Review CDP: '+passed+' passed, '+failed+' failed.');process.exitCode=failed?1:0;
