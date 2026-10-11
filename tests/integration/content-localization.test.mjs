// T9c: definitions, presentation privacy and request-local AI through real routes.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';
import {assertTestContainer} from '../../scripts/test-container.mjs';
import {resolveDisplay,catalogs} from '../../public/js/localization/locale.mjs';
assertTestContainer();
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'ai-dnd-t9c-'));process.env.DATA_DIR=temp;
const require=createRequire(import.meta.url),express=require('express'),store=require('../../server/store.js');
const engine=require('../../server/game/engine.js'),content=require('../../server/game/content.js'),presentation=require('../../server/game/presentation.js');
const retrieval=require('../../server/game/retrieval.js'),dm=require('../../server/game/dm.js');
store.saveSettings({llm:{enabled:false},portraits:{enabled:false}});
let passed=0,failed=0,assertions=0;
const check=(value,message)=>{assert.ok(value,message);assertions++;};
async function test(name,run){try{await run();passed++;console.log('  PASS: '+name);}catch(error){failed++;console.error('  FAIL: '+name+'\n'+error.stack);}}
const app=express();app.use(express.json());app.use(require('../../server/locale.js').localeMiddleware);app.use(presentation.middleware);
for(const name of ['game','city','characters','content'])app.use('/api/'+name,require('../../server/routes/'+name+'.js'));
const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
const base='http://127.0.0.1:'+server.address().port;
async function api(method,url,body,locale='en'){const r=await fetch(base+url,{method,headers:{'Content-Type':'application/json','X-Game-Locale':locale},body:body===undefined?undefined:JSON.stringify(body)});return{status:r.status,body:await r.json()};}
async function start(mapId='vale-gate',locale='en'){const char=(await api('POST','/api/characters',{presetId:'guardian',name:'旅人 <raw> {p1}'})).body;const r=await api('POST','/api/game/start',{characterId:char.id,mapId,bringAlly:false},locale);check(r.status===200,'start accepted');return r.body.state;}
async function act(id,body,locale='en'){const r=await api('POST','/api/game/'+id+'/action',body,locale);check(r.status===200&&!r.body.events.some(e=>e.type==='error'),'action accepted: '+JSON.stringify(r.body.events));return r.body;}
const strip=value=>Array.isArray(value)?value.map(strip):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).filter(([key])=>key!=='localized'&&!key.endsWith('Display')).map(([key,v])=>[key,strip(v)])):value;
const legacy=JSON.parse(fs.readFileSync(new URL('../fixtures/content/minimal-pack.json',import.meta.url),'utf8'));
const held=[],prompts=[];
let mode='hold';
const model=http.createServer((req,res)=>{let raw='';req.on('data',c=>raw+=c);req.on('end',()=>{const body=JSON.parse(raw);prompts.push(body);const reply=()=>{res.writeHead(mode==='error'?400:200,{'Content-Type':'application/json'});res.end(JSON.stringify({choices:[{message:{content:body.messages[0].content.includes('zh-CN')?'模型中文回复。':'Model English reply.'}}]}));};if(mode==='hold')held.push(reply);else if(mode!=='timeout')reply();});});
await new Promise(resolve=>model.listen(0,'127.0.0.1',resolve));
const enable=()=>store.saveSettings({llm:{enabled:true,preset:'custom',baseUrl:'http://127.0.0.1:'+model.address().port+'/v1',model:'mock',apiKey:'',timeoutMs:800}});
const disable=()=>store.saveSettings({llm:{enabled:false}});
async function received(count){const deadline=Date.now()+4000;while(prompts.length<count&&Date.now()<deadline)await new Promise(r=>setTimeout(r,10));check(prompts.length>=count,'mock request received');}
try {
 await test('All 23 definition documents retain exact canonical hashes apart from M1 public map metadata',()=>{
  const hashes=JSON.parse(fs.readFileSync(new URL('../fixtures/localization/canonical-hashes.json',import.meta.url),'utf8'));
  for(const[file,hash]of Object.entries(hashes)){const data=JSON.parse(fs.readFileSync(file,'utf8'));if(Array.isArray(data.rows))delete data.adventure;check(crypto.createHash('sha256').update(JSON.stringify(strip(data))).digest('hex')===hash,file+': canonical text, IDs and every rule number unchanged');}
 });
 await test('Ten shipped maps and effective rules have usable bilingual descriptive fields',()=>{
  const maps=content.listMaps();check(maps.length===10&&maps.some(m=>m.id==='courier-crossing')&&maps.some(m=>m.id==='river-post')&&maps.some(m=>m.id==='brams-pack'),'seven original maps plus the T11, T12a and T14 stories');
  for(const map of maps)for(const locale of ['en','zh-CN'])check(typeof map.localized?.[locale]?.name==='string'&&map.localized[locale].objectiveText,map.id+' '+locale);
  for(const list of [engine.SPECIES,engine.CLASSES,engine.BACKGROUNDS,engine.WEAPONS,engine.ARMORS,engine.GEAR,engine.SPELLS,content.listMonsters()])for(const node of list)check(node.localized?.en?.name&&node.localized?.['zh-CN']?.name,node.id+' name translations');
 });
 await test('T8 accepts localized packs, preserves exports and diagnoses invalid text atomically',async()=>{
  const pack=structuredClone(legacy);pack.pack.localized={en:{name:'First Relic'},'zh-CN':{name:pack.pack.name}};pack.maps[0].localized={en:{name:'Practice Room'},'zh-CN':{name:pack.maps[0].name}};
  check((await api('POST','/api/content/validate',pack)).status===200,'minimal bilingual example validates');
  for(const [change,code]of [[p=>p.pack.localized.fr={name:'Bonjour'},'invalid-locale'],[p=>p.maps[0].localized.en.hp=10,'missing-text-reference'],[p=>p.maps[0].localized.en.name='{missing}','localization-parameters'],[p=>p.maps[0].localized.en.unknown='No node','missing-text-reference']]){const bad=structuredClone(pack);change(bad);const r=await api('POST','/api/content/import',bad);check(r.status===400&&r.body.diagnostics.some(d=>d.code===code),code+' is a 400 diagnostic');check(!fs.existsSync(path.join(temp,'content',pack.pack.id)),'invalid import installs nothing');}
  check((await api('POST','/api/content/import',pack)).status===200,'bilingual pack installs');
  const out=(await api('GET','/api/content/pack/'+pack.pack.id+'/export')).body;assert.deepEqual(out.pack.localized,pack.pack.localized);assert.deepEqual(out.maps[0].localized,pack.maps[0].localized);check(!out.maps[0].nameDisplay,'author export has no synthesized display leaves');
  check((await api('POST','/api/content/import',out)).status===200,'export reimports');
  await api('DELETE','/api/content/pack/'+pack.pack.id);
  check((await api('POST','/api/content/import',legacy)).status===200,'old single-language pack installs');const info=(await api('GET','/api/content')).body;check(info.packs.find(p=>p.id===legacy.pack.id).availableLocales.length===0,'old pack reports original-only fallback');
 });
 await test('Structured combat, rewards and affix names resolve from one actual result without state writes',()=>{
  const hero=engine.buildCharacter({name:'玩家 {p1}',species:'human',className:'fighter',background:'soldier',baseScores:{str:16,dex:14,con:14,int:10,wis:12,cha:10},bgPlus2:'str',bgPlus1:'con',skills:['athletics','perception']});
  const state=engine.startGame(hero,{mapId:'crypt',bringAlly:false}),monster=state.entities.find(e=>e.kind==='monster'),events=[];
  engine.beginRng(state);engine.applyDamage(state,monster,monster.hp+100,'force',events);engine.persistRng(state);
  const before=JSON.stringify(state);for(const e of events.filter(e=>e.text)){check(e.messageKey||e.textDisplay,'emission has explicit descriptor: '+e.type);for(const locale of ['en','zh-CN'])check(resolveDisplay(e.textDisplay||e,e.text,locale)!==e.messageKey,'resolves '+e.type);}
  const item=engine.affixes.buildAffixItem(engine.affixes.baseById('longsword'),engine.affixes.affixById('blazing','weapon'),'legendary','unchanged-unique');const copy=presentation.attach(structuredClone(item));check(resolveDisplay(copy.nameDisplay,'','en').includes('Legendary')&&resolveDisplay(copy.nameDisplay,'','zh-CN').includes('传奇'),'base + affix + quality both languages');check(copy.uniqueId===item.uniqueId&&JSON.stringify(strip(copy))===JSON.stringify(item),'rolled rules and uniqueId preserved');
  check(before===JSON.stringify(state),'presenting both languages consumes no RNG or state');
 });
 await test('Locale reads are identical, hide author knowledge and preserve old plain logs verbatim',async()=>{
  const state=await start();const stored=store.getSave(state.id);engine.addLog(stored,'mech','OLD original 中文 <raw>');store.saveGame(stored);const before=JSON.stringify(store.getSave(state.id));
  const en=(await api('GET','/api/game/'+state.id,undefined,'en')).body.state,zh=(await api('GET','/api/game/'+state.id,undefined,'zh-CN')).body.state;assert.deepEqual(en,zh);check(JSON.stringify(store.getSave(state.id))===before,'GET language requests write nothing');
  const intro=en.log.find(l=>l.messageKey==='event.game.handler.7'),entry=en.log.find(l=>l.messageKey==='event.engine.startGame.47');
  check(resolveDisplay(intro,intro.text,'en').includes('Vale Gate')&&resolveDisplay(intro,intro.text,'en').includes('Negotiate passage'),'opening log resolves actual authored map and objective parameters');
  check(resolveDisplay(entry,entry.text,'zh-CN').includes('战士')&&entry.text.includes('Fighter'),'opening class name translates while canonical log text stays intact');
  check(!en.map.npcs&&!en.map.entities&&!en.map.scenes&&!en.world,'private author data removed');for(const room of en.map.rooms)check(stored.flags['room_'+room.id]||stored.discovered.some(tile=>{const[x,y]=tile.split(',').map(Number);return x>=room.rect[0]&&x<=room.rect[2]&&y>=room.rect[1]&&y<=room.rect[3];}),'only discovered room text');
  check(en.scenes.every(s=>s.choices.every(c=>!c.response&&!c.memory&&!c.effect)),'future branch text absent');const log=en.log.find(l=>l.text.startsWith('OLD'));check(!log.messageKey&&!log.textDisplay&&resolveDisplay(log,log.text,'zh-CN')===log.text,'historical original not guessed');
 });
 await test('English and Chinese can complete peaceful passage with identical costs and confirmed facts',async()=>{
  for(const locale of ['en','zh-CN']){const s=await start('vale-gate',locale);await act(s.id,{type:'move',x:3,y:3},locale);await act(s.id,{type:'interact',objectId:'seal_chest'},locale);await act(s.id,{type:'move',x:5,y:3},locale);const result=await act(s.id,{type:'sceneChoice',sceneId:'keeper_gate',choiceId:'show_seal'},locale);check(result.state.encounterFacts.length===1&&result.state.encounterFacts[0].fact==='returned_seal','same canonical engine fact');check(!result.state.character.inventory.some(i=>i.itemId==='vale_seal'),'one credential consumed');const scene=result.state.scenes[0];check(resolveDisplay(scene.memoryDisplay,'',locale).includes(locale==='en'?'peaceful':'平安'),'confirmed memory follows locale');const chat=await act(s.id,{type:'chat',npcId:scene.npcId,text:'玩家 raw'},locale);check(chat.chatReply===dm.memoryText(store.getSave(s.id),scene.npcId,locale),'offline NPC uses selected confirmed memory');check(chat.chatLanguage===locale,'offline reply has source language');}
 });
 await test('Han retrieval excludes unseen rooms, other NPC knowledge, other maps and future branches',()=>{
  const state={mapId:'private',map:{name:'Known map',rooms:[{id:'seen',name:'大厅',desc:'大厅的烛火映出石门',rect:[1,1,2,2]},{id:'hidden',name:'SECRET_ROOM',desc:'隐藏答案 SECRET',rect:[20,20,22,22]}],npcs:{ivan:{knowledge:'守门人的印章知识'},other:{knowledge:'OTHER_NPC_SECRET'}}},flags:{},discovered:['1,1'],entities:[],character:{inventory:[]},journal:[]};
  check(retrieval.tokenize('烛火石门').includes('石门'),'Han bigrams');check(retrieval.retrieve(state,'烛火石门',3,{locale:'zh-CN'}).some(s=>s.includes('烛火')),'Chinese query finds known content');const chunks=retrieval.knownChunks(state,{locale:'zh-CN',npcId:'ivan'}).map(c=>c.text).join(' ');check(chunks.includes('印章')&&!/SECRET|Sunless/.test(chunks),'known room and speaking NPC only');
 });
 await test('Unknown targets cannot trigger model descriptions',async()=>{
  const s=await start('crypt');const unseen=s.entities.find(e=>e.kind==='monster'&&!s.discovered.includes(e.x+','+e.y));check(unseen,'has undiscovered target');enable();const count=prompts.length;const r=await api('POST','/api/game/'+s.id+'/action',{type:'describe',targetId:unseen.id});check(r.body.events.some(e=>e.type==='error')&&!r.body.appearance,'unknown description rejected');check(prompts.length===count,'model never receives unseen entity');disable();
 });
 await test('Concurrent slow en/zh descriptions keep qualified caches and never undo a later move',async()=>{
  const s=await start(),stored=store.getSave(s.id),npc=stored.entities.find(e=>e.kind==='npc');stored.discovered.push(npc.x+','+npc.y);store.saveGame(stored);enable();mode='hold';const n=prompts.length;
  const en=api('POST','/api/game/'+s.id+'/action',{type:'describe',targetId:npc.id},'en'),zh=api('POST','/api/game/'+s.id+'/action',{type:'describe',targetId:npc.id},'zh-CN');await received(n+2);disable();const move=await act(s.id,{type:'move',x:3,y:3});held.splice(0).forEach(reply=>reply());const replies=await Promise.all([en,zh]);check(replies[0].body.appearanceLanguage==='en'&&replies[1].body.appearanceLanguage==='zh-CN','original request languages retained');const latest=store.getSave(s.id);check(latest.appearances['en:'+npc.npcId]==='Model English reply.'&&latest.appearances['zh-CN:'+npc.npcId]==='模型中文回复。','separate language caches');check(latest.appearanceOrigins['en:'+npc.npcId].language==='en'&&latest.appearanceOrigins['zh-CN:'+npc.npcId].language==='zh-CN'&&latest.appearanceOrigins['en:'+npc.npcId].aid!==latest.appearanceOrigins['zh-CN:'+npc.npcId].aid,'description origin retains distinct action IDs');assert.deepEqual(engine.playerEntity(latest),engine.playerEntity(move.state));check(prompts.slice(n).every(p=>p.messages[0].content.includes('ONLY')&&!p.messages.some(m=>m.content.includes('Sunless Crypt'))),'selected map and language, no hardcoded crypt');
 });
 await test('Concurrent en/zh NPC exchanges retain action IDs, raw input and later mechanics',async()=>{
  const s=await start();await act(s.id,{type:'move',x:5,y:3});enable();mode='hold';const n=prompts.length;
  const en=api('POST','/api/game/'+s.id+'/action',{type:'chat',npcId:'gate_keeper',text:'English input <raw> {p1}'},'en');
  const zh=api('POST','/api/game/'+s.id+'/action',{type:'chat',npcId:'gate_keeper',text:'中文输入 <raw> {p1}'},'zh-CN');
  await received(n+2);disable();const moved=await act(s.id,{type:'move',x:3,y:3});held.splice(0).reverse().forEach(reply=>reply());const replies=await Promise.all([en,zh]);
  check(replies[0].body.chatLanguage==='en'&&replies[1].body.chatLanguage==='zh-CN','reverse completion keeps request languages');
  const latest=store.getSave(s.id),history=latest.npcChat.gate_keeper;check(history.length===4&&new Set(history.map(h=>h.aid)).size===2,'two distinct action exchanges retained');
  for(const lang of ['en','zh-CN']){const pair=history.filter(h=>h.language===lang);check(pair.length===2&&pair[0].aid===pair[1].aid,'same action + source language '+lang);check(pair.find(h=>h.role==='user').content===(lang==='en'?'English input <raw> {p1}':'中文输入 <raw> {p1}'),'raw input retained '+lang);check(latest.log.some(l=>l.kind==='npc'&&l.language===lang&&l.aid===pair[0].aid),'durable NPC log owns the action '+lang);}
  assert.deepEqual(engine.playerEntity(latest),engine.playerEntity(moved.state));
 });
 await test('Unseen NPCs and portraits cannot put private targets into model prompts',async()=>{
  const s=await start(),stored=store.getSave(s.id),npc=stored.entities.find(e=>e.kind==='npc');stored.discovered=stored.discovered.filter(tile=>tile!==npc.x+','+npc.y);store.saveGame(stored);enable();const count=prompts.length;
  for(const type of ['chat','portrait']){const r=await api('POST','/api/game/'+s.id+'/action',{type,npcId:npc.npcId,targetId:npc.id,text:'hidden answer'});check(r.body.events.some(e=>e.type==='error'),'unseen '+type+' rejected');}check(prompts.length===count,'private entity never reaches model');disable();
 });
 await test('Model error, timeout and disabled use same-language canned descriptions and recaps',async()=>{
  const s=await start(),stored=store.getSave(s.id),npc=stored.entities.find(e=>e.kind==='npc');stored.discovered.push(npc.x+','+npc.y);store.saveGame(stored);
  for(const local of ['en','zh-CN'])for(const state of ['error','timeout','off']){mode=state;if(state==='off')disable();else enable();const description=await dm.describeEntity(stored,npc,local);check(description&&(/[\u3400-\u9fff]/.test(description)===(local==='zh-CN')),'fallback language '+local+' '+state);const recap=await dm.writeRecap(stored,local);check(recap.includes(local==='en'?'Vale Gate':'山谷哨门'),'recap uses actual map '+local+' '+state);}
  disable();
 });
 await test('Every explicit event template has the same parameter names in both languages',()=>{
  for(const[key,en]of Object.entries(catalogs.en).filter(([key])=>key.startsWith('event.')||key.startsWith('content.'))){const names=text=>[...text.matchAll(/\{([\w]+)\}/g)].map(m=>m[1]).sort();assert.deepEqual(names(en),names(catalogs['zh-CN'][key]),key);assertions++;}
 });
 await test('The real three-skull city response safely serializes callback-backed curse definitions',async()=>{
  disable();const state=await start(),gambling=require('../../server/game/gambling.js'),original=gambling.spinSlots;
  const before=store.getCharacters().find(c=>c.id===state.characterId);
  gambling.spinSlots=tier=>gambling.evalSlots(tier,['skull','skull','skull']);
  try{const r=await api('POST','/api/city/gamble',{charId:state.characterId,game:'slots',tier:'devil'});check(r.status===200&&r.body.curse,'curse branch returns valid JSON: '+JSON.stringify(r.body));check(!r.body.curse.apply&&r.body.curse.nameDisplay,'callback excluded; authorized name descriptor present');check(resolveDisplay(r.body.curse.nameDisplay,'','en').startsWith('Curse')&&/[\u3400-\u9fff]/.test(resolveDisplay(r.body.curse.nameDisplay,'','zh-CN')),'curse is bilingual');check(r.body.char.gold===before.gold+r.body.result.delta&&r.body.char.pendingCurses.includes(r.body.curse.id),'original stake and canonical curse ID preserved');}finally{gambling.spinSlots=original;}
 });
} finally {held.splice(0).forEach(reply=>reply());await new Promise(r=>server.close(r));model.closeAllConnections();await new Promise(r=>model.close(r));fs.rmSync(temp,{recursive:true,force:true});}
console.log(`T9c content localization: ${passed} cases passed, ${failed} failed; ${assertions} assertions.`);process.exit(failed?1:0);
