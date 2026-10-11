// T9c uses the required container Chromium; engine fixtures stay in isolated DATA_DIR.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import engine from '../../server/game/engine.js';
import presets from '../../server/game/presets.js';
import {assertTestContainer} from '../../scripts/test-container.mjs';
import {browserBinary,softwareWebGLFlags,requireWebGL,captureBrowserArtifacts,closeBrowser} from './_browser-runtime.mjs';
assertTestContainer();
const BASE=process.env.BASE_URL || 'http://localhost:'+(process.env.PORT || 3000),PORT=9234;
const profile=fs.mkdtempSync(path.join(os.tmpdir(),'ai-dnd-t9c-cdp-')),pending=new Map(),saves=[],chars=[],errors=[];
let ws,browser,sequence=0,passed=0,failed=0;
function check(value,message){if(!value)throw new Error(message);passed++;console.log('  PASS: '+message);}
function send(method,params={}){return new Promise((resolve,reject)=>{const id=++sequence,timer=setTimeout(()=>{pending.delete(id);reject(new Error('CDP timeout: '+method));},20000);pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params}));});}
async function evaluate(expression){const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw new Error(JSON.stringify(r.exceptionDetails));return r.result.value;}
async function wait(expression,label){const until=Date.now()+15000;while(Date.now()<until){if(await evaluate('!!('+expression+')'))return;await new Promise(r=>setTimeout(r,150));}throw new Error('Timed out: '+label);}
async function api(method,url,body,locale='en'){const r=await fetch(BASE+url,{method,headers:{'Content-Type':'application/json','X-Game-Locale':locale},body:body===undefined?undefined:JSON.stringify(body)}),data=await r.json();if(!r.ok)throw new Error(url+': '+JSON.stringify(data));return data;}
async function click(selector){const r=await evaluate(`(async()=>{let el=document.querySelector(${JSON.stringify(selector)});if(!el||el.disabled)return {reason:'missing or disabled'};el.scrollIntoView({block:'center'});await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));el=document.querySelector(${JSON.stringify(selector)});if(!el||el.disabled)return {reason:'changed after layout'};const r=el.getBoundingClientRect(),point={x:r.x+r.width/2,y:r.y+r.height/2},hit=document.elementFromPoint(point.x,point.y);return el.contains(hit)?{point}:{reason:'occluded',point,hit:hit?.outerHTML.slice(0,200),connected:el.isConnected,viewport:[innerWidth,innerHeight]};})()`);check(r.point&&!r.reason,'pointer target '+selector+' '+(r.reason?JSON.stringify(r):''));
 // Queue this single pointer gesture in wire order. Awaiting a protocol round-trip
 // between down/up lets a polling render replace the pressed DOM node.
 const down=send('Input.dispatchMouseEvent',{type:'mousePressed',...r.point,button:'left',clickCount:1});
 const up=send('Input.dispatchMouseEvent',{type:'mouseReleased',...r.point,button:'left',clickCount:1});
 await Promise.all([down,up]);
}
async function action(selector,type){
 const mark=await evaluate('window.__t9cActions.length');await click(selector);
 await wait(`window.__t9cActions.slice(${mark}).some(r=>r.request.type===${JSON.stringify(type)}&&r.response)`,'actual '+type+' response');
 const reply=await evaluate(`window.__t9cActions.slice(${mark}).find(r=>r.request.type===${JSON.stringify(type)}&&r.response)`);
 // The existing melee fixture starts four tiles away. Its first attack spends
 // the action with a range rejection; endTurn lets the guard approach normally.
 const state=reply.response.state,target=state.entities.find(e=>e.id===reply.request.targetId);
 const rangeRejection=type==='attack'&&target&&engine.manhattan(engine.playerEntity(state),target)>1&&state.combat?.actionUsed;
 check(reply.status===200&&reply.response.events.filter(e=>e.type==='error').every(e=>rangeRejection&&e.messageKey==='event.engine.playerAttack.89'),'actual '+type+' response matches existing melee/turn contract');
 await wait('window.__dndDebug.rev()>='+reply.response.state.rev,type+' response adopted');return reply.response.state;
}
async function shot(name){await captureBrowserArtifacts('t9c-'+name,[PORT]);check(fs.existsSync(path.join(process.env.VERIFY_ARTIFACT_DIR,'screenshots','t9c-'+name+'-'+PORT+'-0.png')),'PNG + DOM saved: '+name);}
async function locale(value){await evaluate(`import('/js/i18n.js').then(m=>m.setLocale('${value}'))`);}
async function open(id){await evaluate(`location.hash='#/play/${id}'`);await wait("document.querySelector('#map3d canvas') && window.__dndDebug?.resources().renderers===1",'real delve');}
async function fixture(branch){const char=await api('POST','/api/characters',{...presets.draftFor('guardian'),species:'human',name:'旅人 <raw> {p1}'});chars.push(char.id);const id=(await api('POST','/api/game/start',{characterId:char.id,mapId:'vale-gate',bringAlly:false})).state.id;saves.push(id);
 await api('POST','/api/game/'+id+'/action',{type:'move',x:3,y:3});
 if(branch==='show_seal')await api('POST','/api/game/'+id+'/action',{type:'interact',objectId:'seal_chest'});
 await api('POST','/api/game/'+id+'/action',{type:'move',x:5,y:3});
 const file=path.join(process.env.DATA_DIR,'saves',id+'.json'),state=JSON.parse(fs.readFileSync(file,'utf8'));
 const item=engine.affixes.buildAffixItem(engine.affixes.baseById('longsword'),engine.affixes.affixById('blazing','weapon'),'legendary','t9c-unique-'+id);
 state.character.inventory.push(item);engine.addLog(state,'mech','OLD 原文 <history> {p1}');
 const rosterFile=path.join(process.env.DATA_DIR,'characters.json'),roster=JSON.parse(fs.readFileSync(rosterFile,'utf8')),owner=roster.find(c=>c.id===char.id);
 owner.inventory.push(JSON.parse(JSON.stringify(item)));owner.equipped.mainHand=item.uniqueId;fs.writeFileSync(rosterFile,JSON.stringify(roster));
 state.quests={active:{id:'long-quest',type:'explore',target:'outside',targetName:'The outer road',shortText:'Explore the outer road and return to the keeper',shortTextDisplay:{localized:{en:'Explore the outer road and return to the keeper with the evidence of the hidden passage','zh-CN':'探索外围道路，把通道的线索带回守门人，确认哨门的安全，并完成这段漫长的调查任务'},fallback:'Explore the outer road and return to the keeper'},text:'A long quest',textDisplay:{localized:{en:'A long quest','zh-CN':'一项漫长的调查任务'},fallback:'A long quest'},reward:{gold:25,xp:25}},completed:[]};
 if(branch==='fight'){const hero=state.entities.find(e=>e.kind==='player'),guard=state.entities.find(e=>e.id==='vale_guard');hero.hp=hero.hpMax=200;guard.hp=guard.hpMax=1;guard.ac=1;state.character.attacks.forEach(a=>a.bonus=30);}
 state.rev++;fs.writeFileSync(file,JSON.stringify(state));return id;
}
console.log('\n--- T9c Content, Logs, Routes and TTS (Chromium) ---');
try{
 browser=spawn(browserBinary(),['--headless=new',...softwareWebGLFlags(),'--no-sandbox','--disable-dev-shm-usage','--no-first-run','--no-default-browser-check','--remote-debugging-port='+PORT,'--user-data-dir='+profile,'--window-size=1440,900',BASE+'/#/'],{detached:true,stdio:'ignore'});
 let tab;for(let n=0;n<60&&!tab;n++){tab=(await fetch('http://127.0.0.1:'+PORT+'/json').then(r=>r.json()).catch(()=>[])).find(t=>t.type==='page');if(!tab)await new Promise(r=>setTimeout(r,150));}if(!tab)throw new Error('Required Chromium unavailable');
 ws=new WebSocket(tab.webSocketDebuggerUrl);await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject;});ws.onmessage=event=>{const r=JSON.parse(event.data);if(r.method==='Runtime.exceptionThrown')errors.push(r.params.exceptionDetails);const call=pending.get(r.id);if(!call)return;pending.delete(r.id);clearTimeout(call.timer);if(r.error)call.reject(new Error(r.error.message));else call.resolve(r.result);};
 await send('Page.enable');await send('Runtime.enable');await requireWebGL(send);await wait("document.getElementById('quickName')",'home');await evaluate("localStorage.setItem('aiDnd.tutorial.v1',JSON.stringify({status:'skipped'}))");
 await evaluate(`(()=>{window.__t9cActions=[];window.__t9cPointer=[];let pressed;for(const type of ['mousedown','mouseup','click'])document.addEventListener(type,event=>{if(type==='mousedown')pressed=event.target;window.__t9cPointer.push({type,target:event.target?.closest('[data-act],[data-scene-choice],[data-target-id]')?.outerHTML.slice(0,250),pressedConnected:pressed?.isConnected});},true);const original=window.fetch;window.fetch=async(...args)=>{let record;if(typeof args[0]==='string'&&args[0].startsWith('/api/game/')&&args[0].endsWith('/action')){record={url:args[0],request:JSON.parse(args[1]?.body||'{}')};window.__t9cActions.push(record);}try{const response=await original(...args);if(record){record.status=response.status;record.response=await response.clone().json();}return response;}catch(error){if(record)record.error=error.message;throw error;}};})()`);
 for(const lang of ['en','zh-CN'])for(const branch of ['show_seal','fight']){
  await locale(lang);const id=await fixture(branch);await open(id);
  // The preceding roster equip toast survives navigation and can cover the
  // bottom dock. Wait for its real lifecycle before the next native click.
  await wait("document.getElementById('toast').classList.contains('hidden')",'previous equipment toast closed');
  const before=await api('GET','/api/game/'+id);
  await evaluate(`(()=>{window.__canvas=document.querySelector('#map3d canvas');window.__writes=[];const original=window.fetch;window.fetch=(url,init)=>{if(init?.method&&!['GET','HEAD','OPTIONS'].includes(init.method))window.__writes.push(String(url));return original(url,init);};})()`);
  await click('.delve-tools [data-panel="inventory"]');await wait("document.getElementById('delveInventoryModal')",'inventory');
  check(await evaluate(`document.getElementById('delveInventoryModal').textContent.includes('${lang==='en'?'Legendary':'传奇'}')`),lang+': rolled affix name is localized');
  check(await evaluate(`!!document.querySelector('[data-delve-inv-equip="mainHand"][data-item="t9c-unique-${id}"]')`),'rolled item with the same base ID retains its separate equipment identity');
  await shot(lang+'-affix-desktop');
  await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  // Scroll and measure inside one synchronous script: a state poll that lands between
  // two evaluates used to re-render the list and race the stale measurement.
  check(await evaluate(`(()=>{const list=document.querySelector('.delve-inv-scroll-list');list.scrollTop=list.scrollHeight;const r=document.querySelector('[data-delve-inv-equip="mainHand"][data-item="t9c-unique-${id}"]').getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight;})()`),'phone screenshot visibly includes the rolled item action');
  await shot(lang+'-affix-phone');
  check(await evaluate("document.querySelector('#delveInventoryModal .modal').getBoundingClientRect().width<=innerWidth && document.documentElement.scrollWidth<=innerWidth"),'long affix inventory fits phone');
  await click('#closeDelveInvX');
  await click('.delve-tools [data-panel="quests"]');
  check(await evaluate(`document.getElementById('delvePanel').textContent.includes('${lang==='en'?'hidden passage':'漫长的调查'}')`),lang+': long quest resolves display descriptor');
  await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});await shot(lang+'-quests-phone');
  check(await evaluate('document.documentElement.scrollWidth<=innerWidth'),'phone has no page overflow');
  await click('.delve-tools [data-panel="log"]');
  check(await evaluate(`document.getElementById('logEntries').textContent.includes('${lang==='en'?'Negotiate passage':'和守门人商量通过'}') && document.getElementById('logEntries').textContent.includes('${lang==='en'?'Fighter':'战士'}')`),lang+': opening log localizes objective and class parameters');
  check(await evaluate(`document.getElementById('logEntries').textContent.includes('OLD 原文 <history> {p1}') && document.getElementById('logEntries').textContent.includes('${lang==='en'?'Original historical text':'历史原文'}')`),'legacy log preserves literal player-like text and marks historical origin');
  await shot(lang+'-log-phone');await click('.delve-tools [data-panel="chat"]');
  await click('#chatInput');await send('Input.insertText',{text:'草稿 <player> {p1}'});await evaluate("window.__draft=document.getElementById('chatInput');window.__draft.setSelectionRange(2,4)");
  await locale(lang==='en'?'zh-CN':'en');check(await evaluate("document.activeElement===window.__draft && window.__draft.value==='草稿 <player> {p1}' && window.__draft.selectionStart===2 && window.__canvas===document.querySelector('#map3d canvas')"),'switch preserves draft, selection, focus and renderer');await locale(lang);
  check(await evaluate('window.__writes.length===0')&&JSON.stringify(before.state)===JSON.stringify((await api('GET','/api/game/'+id)).state),'all bilingual presentation probes leave authoritative save and RNG unchanged');
  await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape'});await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape'});
  await send('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});await click('[data-scene-open]');await shot(lang+'-'+branch+'-options');await action('[data-scene-choice="'+branch+'"]','sceneChoice');
  if(branch==='fight'){
   await wait("!document.getElementById('sceneModal') && document.querySelector('[data-act=attack]')",'combat');
   for(let n=0;n<20;n++){const state=(await api('GET','/api/game/'+id)).state;if(state.mode!=='combat')break;
    // Match the actual action response, then assert final adoption. Never re-click.
    await click('[data-target-id="vale_guard"]');
    await wait("!document.querySelector('[data-act=attack]')?.disabled",'attack enabled');
    const now=await action('[data-act=attack]','attack');if(now.mode==='combat')await action('[data-act=endturn]','endTurn');
   }
   check((await api('GET','/api/game/'+id)).state.encounterFacts[0]?.fact==='forced_passage','real '+lang+' combat resolves engine force fact');
   await click('[data-scene-open]');
  }
  await wait("document.querySelector('[data-scene-memory]')",'confirmed memory');
  check(await evaluate(`document.querySelector('[data-scene-memory]').textContent.includes(${JSON.stringify(lang==='en'?(branch==='fight'?'fight your way through':'peaceful'):(branch==='fight'?'用武力通过':'平安'))})`),lang+' '+branch+': confirmed branch memory readable');
  await shot(lang+'-'+branch+'-result');await click('[data-scene-close]');await evaluate("location.hash='#/'");await wait("!document.querySelector('#map3d canvas') && document.querySelector('.char-objective')",'leave');
  check(await evaluate(`document.querySelector('.char-objective').textContent.includes('${lang==='en'?'Enter the Sunless Crypt':'潜入无光墓穴'}')`),lang+': home main-story objective uses the authored translation');
  const charId=before.state.characterId,owned=await api('GET','/api/characters/'+charId);
  await evaluate(`location.hash='#/character/${charId}'`);await wait("document.querySelector('.paperdoll-slot[data-slot=mainHand] .slot-name')",'character equipment');
  check(await evaluate(`document.querySelector('.paperdoll-slot[data-slot=mainHand] .slot-name').textContent.includes('${lang==='en'?'Legendary':'传奇'}')`),lang+': roster equipment resolves the rolled unique ID');
  await click('.paperdoll-slot[data-slot="mainHand"]');await wait("document.getElementById('equipModal')",'equipment chooser');
  check(await evaluate(`!!document.querySelector('[data-equip-id="t9c-unique-${id}"]') && document.getElementById('equipModal').textContent.includes('${lang==='en'?'Legendary':'传奇'}')`),'roster choice keeps affix description and unique equipment reference');
  await click('[data-equip-id="t9c-unique-'+id+'"]');await wait("!document.getElementById('equipModal')",'equipped');
  const equipped=await api('GET','/api/characters/'+charId);check(equipped.equipped.mainHand==='t9c-unique-'+id && equipped.gold===owned.gold && equipped.hpMax===owned.hpMax && equipped.inventory.length===owned.inventory.length,'real roster equip preserves unique ID, gold, HP and inventory');
  check(equipped.attacks.filter(a=>a.weaponId==='t9c-unique-'+id || a.weaponId==='unarmed').every(a=>a.nameDisplay),'rolled and unarmed attacks retain explicit name descriptors');
  await shot(lang+'-affix-sheet');await evaluate("location.hash='#/'");await wait("document.getElementById('quickName')",'home restored');
 }
 // Mock browser voices and delayed audio inside real Chromium; no external service.
 // Pair the utterance with the fake voices: native utterances require branded
 // SpeechSynthesisVoice instances, which plain deterministic fixtures cannot be.
 await evaluate("window.SpeechSynthesisUtterance=class{constructor(text){this.text=text;}}");
 await evaluate(`(async()=>{window.__tts=(await import('/js/tts.js')).tts;window.__say=[];window.__cancel=0;window.__voices=[{name:'English',lang:'en-US'},{name:'Chinese',lang:'zh-CN'}];Object.defineProperty(window,'speechSynthesis',{configurable:true,value:{getVoices:()=>window.__voices,cancel:()=>window.__cancel++,speak:u=>{window.__say.push({text:u.text,lang:u.lang,voice:u.voice.name});queueMicrotask(()=>u.onend());}}});if(!window.__tts.isEnabled())window.__tts.toggle();window.__tts.setPiper('');window.__tts.setVoice('English');await window.__tts.speak('中文正文。','zh-CN');await window.__tts.speak('English prose.','en');})()`);
 check(await evaluate("window.__say.length===2 && window.__say[0].lang==='zh-CN' && window.__say[1].lang==='en-US'"),'TTS picks body language despite a stored voice in another language');
 await evaluate("window.__voices=[{name:'English',lang:'en-US'}];window.__tts.speak('无中文 voice，正文仍可读。','zh-CN')");check(await evaluate('window.__say.length===2'),'missing language voice stays silent');
 await evaluate(`(()=>{window.__audioStarted=0;window.__audioClosed=0;window.__originalFetch=window.fetch;window.AudioContext=class{constructor(){this.destination={};this.currentTime=0;}decodeAudioData(){return Promise.resolve({});}close(){window.__audioClosed++;}createBufferSource(){return{connect(){},start(){window.__audioStarted++;},set onended(v){}};}createGain(){return{gain:{setValueAtTime(){}},connect(){}};}};window.fetch=(url,init)=>url==='http://mock-piper'?new Promise(resolve=>{window.__piperBody=JSON.parse(init.body);window.__releasePiper=()=>resolve({ok:true,arrayBuffer:()=>Promise.resolve(new ArrayBuffer(0))});}):window.__originalFetch(url,init);window.__tts.setPiper('http://mock-piper');window.__tts.setPiperLanguage('en');window.__pendingVoice=window.__tts.speak('Slow English prose.','en');})()`);
 await wait('window.__releasePiper','Piper pending');await locale('en');await locale('zh-CN');await evaluate('window.__releasePiper();window.__pendingVoice');check(await evaluate("window.__audioStarted===0 && window.__audioClosed>0 && window.__piperBody.language==='en'"),'locale switch stops delayed Piper audio with captured request language');await evaluate("window.fetch=window.__originalFetch;window.__tts.setPiper('');window.__tts.toggle()");
 check(errors.length===0,'no Chromium runtime exceptions: '+JSON.stringify(errors));
}catch(error){failed++;console.error('  FAIL: '+error.stack);if(ws){await captureBrowserArtifacts('t9c-failure',[PORT]);try{fs.writeFileSync(path.join(process.env.VERIFY_ARTIFACT_DIR,'t9c-failure-audit.json'),JSON.stringify(await evaluate('({actions:window.__t9cActions,pointer:window.__t9cPointer,rev:window.__dndDebug?.rev()})'),null,2));}catch(auditError){console.error('Failure audit: '+auditError.message);}}}
finally{try{await closeBrowser(browser,ws,send,profile);}catch(error){failed++;console.error(error.stack);}for(const call of pending.values())clearTimeout(call.timer);for(const id of saves)await api('DELETE','/api/game/'+id).catch(e=>{failed++;console.error(e.message);});for(const id of chars)await api('DELETE','/api/characters/'+id).catch(e=>{failed++;console.error(e.message);});}
console.log(`T9c CDP: ${passed} passed, ${failed} failed.`);process.exitCode=failed?1:0;
