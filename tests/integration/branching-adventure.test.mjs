// T11: real HTTP story progression, deterministic outcome ranges and model boundaries.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createRequire } from 'node:module';
import { assertTestContainer } from '../../scripts/test-container.mjs';
import { resolveDisplay } from '../../public/js/localization/locale.mjs';
assertTestContainer();
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-dnd-t11-'));
process.env.DATA_DIR = temp;
const require = createRequire(import.meta.url);
const express = require('express'), store = require('../../server/store.js');
const engine = require('../../server/game/engine.js'), content = require('../../server/game/content.js');
const presentation = require('../../server/game/presentation.js'), retrieval = require('../../server/game/retrieval.js');
store.saveSettings({ llm: { enabled: false }, portraits: { enabled: false } });
let passed = 0, failed = 0, assertions = 0;
function check(value, message) { assert.ok(value, message); assertions++; }
async function test(name, fn) { try { await fn(); passed++; console.log('  PASS: ' + name); } catch (error) { failed++; console.error('  FAIL: ' + name + '\n' + error.stack); } }
const app = express(); app.use(express.json()); app.use(require('../../server/locale.js').localeMiddleware); app.use(presentation.middleware);
for (const name of ['game','city','characters','content']) app.use('/api/' + name, require('../../server/routes/' + name + '.js'));
const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
const base = 'http://127.0.0.1:' + server.address().port;
async function api(method, url, body, locale = 'en') {
  const r = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', 'X-Game-Locale': locale }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, body: await r.json() };
}
function hero() {
  const char = engine.buildCharacter({ name:'T11 <raw> {p1}', species:'human', className:'fighter', background:'soldier', baseScores:{str:16,dex:14,con:14,int:10,wis:12,cha:10}, bgPlus2:'str', bgPlus1:'con', skills:['athletics','perception'] });
  char.id = store.newId('char'); char.gold = 50; store.saveCharacters([...store.getCharacters(), char]); return char;
}
async function start(char = hero()) {
  const r = await api('POST','/api/game/start',{ characterId:char.id, mapId:'courier-crossing', difficulty:'easy', bringAlly:false });
  check(r.status === 200, 'story starts: ' + JSON.stringify(r.body)); return r.body.state;
}
async function act(id, action, locale = 'en', allowError = false) {
  const r = await api('POST','/api/game/' + id + '/action', action, locale);
  check(r.status === 200, 'action HTTP 200');
  if (!allowError) check(!r.body.events.some(e => e.type === 'error'), JSON.stringify(r.body.events));
  return r.body;
}
const move = (id,x,y) => {
  const state = store.getSave(id), p = engine.playerEntity(state);
  return p.x === x && p.y === y ? Promise.resolve({state,events:[]}) : act(id,{type:'move',x,y});
};
const choose = (id,sceneId,choiceId,locale='en',extra={}) => act(id,{type:'sceneChoice',sceneId,choiceId,...extra},locale);
function tweak(id, fn) { const s = store.getSave(id); fn(s); store.saveGame(s); }
function checkRange(id, success) { tweak(id,s=>{ s.character.abilities.cha = success ? 100 : -100; s.character.uses.lucky_reroll = 0; }); }
async function cross(id, route='pay_toll') {
  await move(id,6,7);
  if (route === 'fight') {
    tweak(id,s=>{const p=engine.playerEntity(s),g=s.entities.find(e=>e.id==='courier_guard');p.hp=p.hpMax=200;g.hp=g.hpMax=1;g.ac=1;s.character.attacks.push({weaponId:'longbow',name:'Fixture Bow',bonus:30,dmgDice:'1d8',dmgMod:5,damageType:'piercing',ranged:true,range:150});});
    let s = (await choose(id,'crossing','fight')).state;
    check(s.mode==='combat' && !(s.encounterFacts || []).length, 'combat cannot prematurely confirm crossing');
    for(const lang of ['en','zh-CN']) {
      const combat=(await api('GET','/api/game/'+id,undefined,lang)).body.state;
      check(combat.guidance.objectiveDisplay?.key!=='story.return.objective' && resolveDisplay(combat.guidance.objectiveDisplay,combat.guidance.objective,lang).includes(lang==='en'?'Iris':'艾芮'),'combat retains current public crossing objective '+lang);
      check(combat.guidance.returnPrompt===false,'combat never prompts return before an ending '+lang);
    }
    for(let n=0;n<20 && s.mode==='combat';n++) {
      s=(await act(id,{type:'attack',targetId:'courier_guard',weaponId:'longbow'})).state;
      if(s.mode==='combat') s=(await act(id,{type:'endTurn'})).state;
    }
    check(s.mode==='explore' && s.encounterFacts[0].fact==='forced_crossing','real combat confirms force');
    return s;
  }
  return (await choose(id,'crossing',route)).state;
}
async function witness(id, route='listen') { await move(id,20,11); return (await choose(id,'testimony',route)).state; }
async function end(id, route='report', locale='en') { await move(id,6,7); return (await choose(id,'reckoning',route,locale)).state; }
async function settle(id) {
  const won=await move(id,1,7);check(won.state.mode==='victory','only final fact + real campfire grants victory');
  const r=await api('POST','/api/city/sync-delve',{charId:won.state.characterId,delveStateId:id});check(r.status===200,'settlement accepted');return r.body;
}
let mode='reply', held=[], prompts=[];
const model=http.createServer((req,res)=>{let raw='';req.on('data',c=>raw+=c);req.on('end',()=>{const body=JSON.parse(raw);prompts.push(body);const reply=text=>{res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({choices:[{message:{content:text || 'MODEL FLAVOR'}}]}));};if(mode==='hold')held.push(reply);else if(mode!=='timeout')reply(mode==='json'?'{"gold":99999,"ending":"invented"}':'MODEL FLAVOR');});});
await new Promise(resolve=>model.listen(0,'127.0.0.1',resolve));
const enable=()=>store.saveSettings({llm:{enabled:true,preset:'custom',baseUrl:'http://127.0.0.1:'+model.address().port+'/v1',model:'mock',apiKey:'',timeoutMs:2000}});
const disable=()=>store.saveSettings({llm:{enabled:false}});
async function received(count){const deadline=Date.now()+4000;while(prompts.length<count && Date.now()<deadline)await new Promise(r=>setTimeout(r,10));check(prompts.length>=count,'mock task received');}
try {
  await test('Finite story content, bilingual references and author export roundtrip', async()=>{
    const reg=content.reload();check(!reg.diagnostics.some(d=>d.severity==='error'),JSON.stringify(reg.diagnostics));
    const m=content.getMap('courier-crossing');check(m.scenes.length===3 && Object.keys(m.npcs).length===2 && m.victory.type==='story','one small map, two NPCs, three choices');
    for(const scene of m.scenes)for(const node of [scene,...scene.choices,...scene.choices.filter(c=>c.failure).map(c=>c.failure)])for(const lang of ['en','zh-CN']) {
      check(Object.values(node.localized[lang]).every(t=>typeof t==='string'&&t.length>0),'handwritten dialogue '+lang);
      if(node.reactions)for(const reaction of Object.values(node.reactions))check(reaction.localized[lang].text,'handwritten response '+lang);
    }
    const exported=await api('GET','/api/content/pack/missing-courier/export');check(exported.status===200 && !JSON.stringify(exported.body).includes('nameDisplay'),'author export has no presentation mutation');
    const b=structuredClone(exported.body);b.pack.id='t11-roundtrip';b.maps[0].id='t11-roundtrip-map';b.gear=[];
    check((await api('POST','/api/content/import',b)).status===200,'story pack imports with registered references');
    check(content.getMap('t11-roundtrip-map').scenes[2].requiresScene==='testimony','prerequisite survives roundtrip');
  });
  await test('Bad prerequisites, outcomes, resource writes and script effects fail atomically',async()=>{
    const b=(await api('GET','/api/content/pack/missing-courier/export')).body;b.pack.id='t11-invalid';b.maps[0].id='t11-invalid-map';b.gear=[];
    const edits=[m=>m.scenes[1].requiresScene='missing',m=>m.scenes[0].requiresScene='reckoning',m=>m.scenes[1].requiresScene='testimony',m=>m.scenes[0].choices[1].effect.skill='invented',m=>m.scenes[0].choices[1].effect.dc=-1,m=>m.scenes[0].choices[1].effect.failureGold=-1,m=>delete m.scenes[0].choices[1].failure,m=>m.scenes[1].choices[0].effect.giveItem='missing_item',m=>m.scenes[1].choices[0].effect.consumeItem='rations',m=>m.scenes[1].choices[0].reactions.hidden={text:'secret'},m=>m.scenes[2].choices[0].effect.hp=9999,m=>m.scenes[2].choices[0].effect.type='script',m=>m.victory.sceneId='missing',m=>delete m.scenes[2].choices,m=>m.scenes[2].choices.forEach(c=>c.ending='only'),m=>m.scenes[2].choices[2].failure.gold=999];
    for(const edit of edits){const bad=structuredClone(b);edit(bad.maps[0]);const r=await api('POST','/api/content/import',bad);check(r.status===400 && r.body.diagnostics?.some(d=>d.severity==='error'),'finite protocol rejects bad definition');check(!fs.existsSync(path.join(temp,'content','t11-invalid')),'no partial install');}
  });
  await test('Reads hide future scenes/effects and do not consume RNG; invalid distance and bypass are rejected',async()=>{
    const s=await start(),before=JSON.stringify(store.getSave(s.id));
    for(const lang of ['en','zh-CN']){const r=(await api('GET','/api/game/'+s.id,undefined,lang)).body.state;check(!r.map.scenes&&!r.map.npcs&&!r.world,'author-only world hidden');check(!JSON.stringify(r).includes('public_record')&&!JSON.stringify(r).includes('quiet_departure'),'unchosen ending prose and IDs absent');check(resolveDisplay(r.guidance.objectiveDisplay,r.guidance.objective,lang).includes(lang==='en'?'Iris':'艾芮'),'public objective follows current stage');}
    check(JSON.stringify(store.getSave(s.id))===before,'locale reads mutate nothing');
    const unavailable=await act(s.id,{type:'sceneChoice',sceneId:'testimony',choiceId:'listen'},'en',true);check(unavailable.events.some(e=>e.type==='error'),'future scene rejected');
    await move(s.id,7,7);for(const method of ['open','pick','force']){const r=await act(s.id,{type:'interact',objectId:'courier_bridge',method},'en',true);check(r.events.some(e=>e.type==='error')&&!r.state.objects.find(o=>o.id==='courier_bridge').open,'scene gate rejects '+method);}
    const buy=await api('POST','/api/city/buy',{charId:s.characterId,itemId:'courier_ledger'});check(buy.status===400,'evidence cannot be bought');
    const town=await api('GET','/api/city/info?charId='+s.characterId);check(town.body.mapNodes.some(n=>n.mapId==='courier-crossing'),'normal town entry exists');
  });
  await test('Insufficient gold and medicine leave real fallback paths without mutation',async()=>{
    const s=await start();await move(s.id,6,7);tweak(s.id,x=>{x.character.gold=0;});
    const r=await act(s.id,{type:'sceneChoice',sceneId:'crossing',choiceId:'explain'},'en',true);check(r.events.some(e=>e.type==='error')&&r.state.character.gold===0,'failure fee preflight rejects before rolling');check(r.state.scenes[0].choices.find(c=>c.id==='fight').available,'zero gold leaves combat available');
    tweak(s.id,x=>{x.character.gold=50;});await cross(s.id);await move(s.id,20,11);tweak(s.id,x=>{x.character.inventory=x.character.inventory.filter(i=>i.itemId!=='potion_healing');});
    const aid=await act(s.id,{type:'sceneChoice',sceneId:'testimony',choiceId:'give_aid'},'en',true);check(aid.events.some(e=>e.type==='error')&&aid.state.scenes.find(c=>c.id==='testimony').choices.find(c=>c.id==='listen').available,'no medicine leaves testimony available');
    await choose(s.id,'testimony','listen');await move(s.id,6,7);tweak(s.id,x=>{x.character.gold=0;});const final=(await api('GET','/api/game/'+s.id)).body.state.scenes.find(c=>c.id==='reckoning');check(final.choices.find(c=>c.id==='report').available&&!final.choices.find(c=>c.id==='protect').available,'zero gold still permits a real ending');
  });
  await test('Paid crossing, real aid and public ending complete in both languages with three actual costs',async()=>{
    for(const lang of ['en','zh-CN']){const s=await start();const potions=store.getSave(s.id).character.inventory.find(i=>i.itemId==='potion_healing').qty;await cross(s.id);await witness(s.id,'give_aid');await move(s.id,6,7);const talk=await act(s.id,{type:'freeform',text:'talk to Iris'},lang);check(talk.events.find(e=>e.type==='chat_open')?.data.sceneId==='reckoning','real NPC interaction opens the current stage');const ended=await end(s.id,'report',lang);check(ended.story.ending==='reported'&&ended.story.choices.length===3,'three-stage public story');check(ended.character.gold===45 && ended.character.inventory.find(i=>i.itemId==='potion_healing').qty===potions-1&&!ended.character.inventory.some(i=>i.itemId==='courier_ledger'),'five gold, one potion, one actual ledger');check(resolveDisplay(ended.story.outcomeDisplay,ended.story.outcome,lang).includes(lang==='en'?'Public Record':'公开的账册'),'handwritten ending '+lang);const r=await settle(s.id);check(r.receipt.story.ending==='reported' && r.char.encounterFacts.length===3&&!r.receipt.campaignAdvanced,'side story does not advance main campaign');}
  });
  await test('Failed appeal advances and charges once; successful negotiation has a distinct ending',async()=>{
    const s=await start();checkRange(s.id,false);const bridge=await cross(s.id,'explain');const fact=bridge.encounterFacts[0];check(fact.check.success===false&&fact.fact==='paid_after_refusal'&&bridge.character.gold===45,'guaranteed failure pays actual fee and advances');
    const before=store.getSave(s.id).rngState;await choose(s.id,'crossing','explain');check(store.getSave(s.id).rngState===before&&store.getSave(s.id).character.gold===45,'duplicate neither rerolls nor charges');
    await witness(s.id);checkRange(s.id,true);const ended=await end(s.id,'mediate');check(ended.story.ending==='accord'&&ended.encounterFacts[2].check.success&&ended.character.gold===45,'success provides third distinct accord without fee');await settle(s.id);
  });
  await test('Combat crossing and failed mediation retain danger and resolve to the real paid ferry',async()=>{
    const s=await start(),state=await cross(s.id,'fight');check(state.stats.kills===1 && state.character.xp>0,'existing combat consequences');await witness(s.id);checkRange(s.id,false);const ended=await end(s.id,'mediate');check(ended.story.ending==='protected'&&ended.encounterFacts[2].fact==='funded_after_refusal'&&ended.encounterFacts[2].check.success===false,'failed mediation still ends through protection');check(ended.encounterFacts[2].costGold===10,'actual fallback fee');const before=JSON.stringify(store.getSave(s.id).encounterFacts);await choose(s.id,'reckoning','protect');check(JSON.stringify(store.getSave(s.id).encounterFacts)===before,'opposite duplicate cannot rewrite ending');await settle(s.id);
  });
  await test('Concurrent lost-response retries charge, consume and grant only once',async()=>{
    const s=await start();await move(s.id,6,7);await Promise.all([choose(s.id,'crossing','pay_toll'),choose(s.id,'crossing','pay_toll')]);check(store.getSave(s.id).character.gold===45,'one toll');await move(s.id,20,11);const potions=store.getSave(s.id).character.inventory.find(i=>i.itemId==='potion_healing').qty;
    await Promise.all([choose(s.id,'testimony','give_aid'),choose(s.id,'testimony','listen')]);const current=store.getSave(s.id);check(current.encounterFacts.length===2&&current.character.inventory.find(i=>i.itemId==='courier_ledger').qty===1&&current.character.inventory.find(i=>i.itemId==='potion_healing').qty===potions-1,'one medicine, one ledger, one fact');await end(s.id,'protect');const r=await settle(s.id),gold=r.char.gold,xp=r.char.xp;const dup=await api('POST','/api/city/sync-delve',{charId:s.characterId,delveStateId:s.id});check(dup.body.duplicate&&dup.body.char.gold===gold&&dup.body.char.xp===xp&&dup.body.receipt.story.ending==='protected','duplicate settlement preserves ending with no reward');
  });
  await test('Two NPCs remember actual facts after refresh/new delve; identity and receipt recovery stay isolated',async()=>{
    const s=await start();await cross(s.id);await witness(s.id);await end(s.id,'protect');const r=await settle(s.id);
    const next=await start(r.char);check(!(next.encounterFacts || []).length&&!next.scenes.some(c=>c.id==='reckoning'),'new local instances do not inherit unlocks');await move(next.id,6,7);const iris=await act(next.id,{type:'chat',npcId:'iris',text:'Remember me?'});check(iris.chatReply.includes('ten gold')&&iris.chatReply.includes('sealed'),'bridgewarden remembers real fee and evidence');await cross(next.id);await move(next.id,20,11);const lio=await act(next.id,{type:'chat',npcId:'lio',text:'Remember the last ferry?'});check(lio.chatReply.includes('paid')&&!lio.chatReply.includes('testify'),'courier remembers relevant confirmed choices');
    const other=await start();check(!engine.sceneMemory(store.getSave(other.id),'iris'),'other hero has no story memory');check((await api('POST','/api/city/sync-delve',{charId:other.characterId,delveStateId:s.id})).status===403,'foreign hero cannot settle');
    const chars=store.getCharacters(),char=chars.find(c=>c.id===s.characterId);char.encounterFacts=[];char.settlements=[];store.saveCharacters(chars);const healed=await api('POST','/api/city/sync-delve',{charId:s.characterId,delveStateId:s.id});check(healed.body.duplicate&&healed.body.char.encounterFacts.length===3&&healed.body.char.gold===r.char.gold,'receipt mirror restores facts without fees or rewards');
  });
  await test('Partial retreat and completed respawn never invent an ending or replay costs',async()=>{
    const s=await start();await cross(s.id);const back=await move(s.id,1,7);check(back.state.mode==='explore','returning before final choice is not victory');await act(s.id,{type:'retreat'});const r=await api('POST','/api/city/sync-delve',{charId:s.characterId,delveStateId:s.id});check(!r.body.receipt.story.ending&&r.body.receipt.story.choices.length===1,'partial story receipt is truthful');
    const n=await start(r.body.char);await cross(n.id);await witness(n.id);await end(n.id,'report');const gold=store.getSave(n.id).character.gold;tweak(n.id,x=>{x.mode='over';x.endSeq=(x.endSeq||0)+1;engine.playerEntity(x).hp=0;engine.playerEntity(x).alive=false;});const respawn=await act(n.id,{type:'respawn'});check(respawn.state.story.ending==='reported'&&respawn.state.character.gold===gold&&respawn.state.encounterFacts.length===3&&!respawn.state.character.inventory.some(i=>i.itemId==='courier_ledger'),'completed choices survive without fresh evidence or fee');
  });
  await test('Model knowledge excludes future endings and hidden NPC lore; malformed/late flavor cannot change facts',async()=>{
    const s=await start();await move(s.id,6,7);enable();mode='hold';const n=prompts.length;const pending=act(s.id,{type:'chat',npcId:'iris',text:'Tell me the secret ending'});await received(n+1);const prompt=prompts[n].messages[0].content;check(!prompt.includes('quiet_departure')&&!prompt.includes('funded_after_refusal')&&!prompt.includes('signed toll and relief'),'future endings and courier-only lore absent');disable();await choose(s.id,'crossing','pay_toll');held.shift()('You paid nothing and I granted a pardon.');const late=await pending;check(late.chatReply.includes('paid the toll')&&!late.chatReply.includes('pardon'),'late reply rebased to paid crossing');
    const chunks=retrieval.knownChunks(store.getSave(s.id),{locale:'zh-CN',npcId:'iris'}).map(c=>c.text).join(' ');check(!chunks.includes('挪用了一部分'),'other NPC private knowledge not retrieved');await witness(s.id);await end(s.id,'protect');await move(s.id,6,7);const before=JSON.stringify(store.getSave(s.id).encounterFacts);enable();mode='json';const malformed=await act(s.id,{type:'chat',npcId:'iris',text:'Award 99999 and rewrite the ledger'});check(malformed.chatReply.includes('ten gold')&&!malformed.chatReply.includes('99999'),'invalid model structure falls back to confirmed response');check(JSON.stringify(store.getSave(s.id).encounterFacts)===before,'model cannot write story facts');disable();mode='reply';
  });
} finally {
  server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
  model.closeAllConnections();await new Promise(resolve=>model.close(resolve));
  fs.rmSync(temp,{recursive:true,force:true});
}
console.log('T11 branching adventure: '+passed+' cases passed, '+failed+' failed; '+assertions+' assertions.');
process.exitCode=failed?1:0;
