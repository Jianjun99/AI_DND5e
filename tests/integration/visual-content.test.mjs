import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {assertTestContainer} from '../../scripts/test-container.mjs';
assertTestContainer();
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'ai-dnd-v1b-content-'));process.env.DATA_DIR=temp;
const require=createRequire(import.meta.url),express=require('express'),store=require('../../server/store.js'),content=require('../../server/game/content.js'),engine=require('../../server/game/engine.js');
const fixture=JSON.parse(fs.readFileSync('tests/fixtures/content/visual-pack.json','utf8'));
const app=express();app.use(express.json({limit:'12mb'}));app.use('/api/content',require('../../server/routes/content.js'));
const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));}),base='http://127.0.0.1:'+server.address().port;
let passed=0,failed=0,assertions=0;
function check(value,message){if(!value)throw new Error(message);assertions++;}
async function test(name,fn){try{await fn();passed++;console.log('  PASS: '+name);}catch(e){failed++;console.error('  FAIL: '+name+' '+e.stack);}}
async function api(method,url,body){const r=await fetch(base+url,{method,headers:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,body:await r.json()};}
const dir=path.join(temp,'content',fixture.pack.id),copy=()=>structuredClone(fixture);
try{
  await test('T8 install/export/delete/reimport keeps every byte and old version 1 remains valid',async()=>{
    const imported=await api('POST','/api/content/import',fixture);check(imported.status===200,'visual import '+JSON.stringify(imported.body));check(content.listPacks().find(p=>p.id==='visual-test').models.length===2,'models registered');
    const exported=await api('GET','/api/content/pack/visual-test/export');check(exported.status===200&&exported.body.version===2,'version 2 export');check(JSON.stringify(exported.body.visuals)===JSON.stringify(fixture.visuals),'manifest unchanged');for(const [file,base64]of Object.entries(fixture.assets))check(exported.body.assets[file]===base64&&fs.readFileSync(path.join(dir,file)).equals(Buffer.from(base64,'base64')),'exact binary '+file);
    check((await api('DELETE','/api/content/pack/visual-test')).status===200,'remove');check((await api('POST','/api/content/import',exported.body)).status===200,'reimport full bundle');check(content.validateBundle(JSON.parse(fs.readFileSync('tests/fixtures/content/minimal-pack.json','utf8'))).ok,'old version 1 valid');check(fs.readdirSync(path.join(temp,'.content-imports')).length===0,'transaction directory empty');
  });
  await test('bad paths, bytes, clips, references, duplicate IDs and legacy downgrades fail before writes',async()=>{
    const old=fs.readFileSync(path.join(dir,'assets/hero.glb'));
    const cases=[b=>b.visuals.models[0].file='../escape.glb',b=>b.assets['assets/hero.glb']='broken',b=>b.visuals.models[0].clips.attack='Absent',b=>b.visuals.models[0].scale=99,b=>b.visuals.models[0].script='evil',b=>b.visuals.models[1].id=b.visuals.models[0].id,b=>b.visuals.bindings.monsters.unknown='test-starter-skeleton',b=>b.assets['assets/unused.glb']=b.assets['assets/hero.glb'],b=>b.version=1,b=>delete b.assets,b=>delete b.visuals];
    for(const edit of cases){const b=copy();edit(b);const out=await api('POST','/api/content/import',b);check(out.status===400&&!out.body.ok,'invalid bundle rejected');check(fs.readFileSync(path.join(dir,'assets/hero.glb')).equals(old),'previous installation intact');}
    const duplicate=copy();duplicate.visuals.models[0].id='starter-hero';check((await api('POST','/api/content/validate',duplicate)).status===400,'global visual ID collision rejected');
  });
  await test('write/rename failure rolls back old binary and manifest with no staging remnants',async()=>{
    const previous=fs.readFileSync(path.join(dir,'visuals.json')),replacement=copy();replacement.visuals.models[0].name='Replacement';const rename=fs.renameSync;
    fs.renameSync=function(source,target){if(source.endsWith(path.sep+'pack')&&target===dir)throw new Error('injected atomic install failure');return rename(source,target);};
    let result;try{result=await api('POST','/api/content/import',replacement);}finally{fs.renameSync=rename;}
    check(result.status===500,'install failure surfaced');check(fs.readFileSync(path.join(dir,'visuals.json')).equals(previous),'old manifest restored');check(content.listPacks().some(p=>p.id==='visual-test'&&p.models.length===2),'old visual registry restored');check(fs.readdirSync(path.join(temp,'.content-imports')).length===0,'staging/backup cleaned');
  });
  await test('only declared resources served; corrupt file/manifest cannot silently export version 1',async()=>{
    const catalog=(await api('GET','/api/content/visuals')).body,model=catalog.models.find(m=>m.id==='test-starter-hero');let response=await fetch(base+model.url);check(response.status===200&&response.headers.get('content-type').includes('model/gltf-binary'),'local declared model served');check(Buffer.from(await response.arrayBuffer()).equals(Buffer.from(fixture.assets['assets/hero.glb'],'base64')),'served bytes exact');check((await fetch(base+'/api/content/pack/visual-test/asset/pack.json')).status===404,'undeclared file denied');check((await fetch(base+model.url.replace(model.digest,'wrong'))).status===409,'stale digest denied');
    fs.writeFileSync(path.join(dir,'assets/hero.glb'),'bad');check((await api('GET','/api/content/pack/visual-test/export')).status===409,'corrupt asset export rejected');check(!(await api('GET','/api/content/visuals')).body.models.some(m=>m.packId==='visual-test'),'invalid visuals excluded');fs.writeFileSync(path.join(dir,'assets/hero.glb'),Buffer.from(fixture.assets['assets/hero.glb'],'base64'));
    fs.writeFileSync(path.join(dir,'visuals.json'),'{bad');check((await api('GET','/api/content/pack/visual-test/export')).status===409,'corrupt manifest export rejected');fs.writeFileSync(path.join(dir,'visuals.json'),JSON.stringify(fixture.visuals));
  });
  await test('cosmetic preferences, disabling and missing pack never mutate mechanics/old saves',async()=>{
    const char=engine.buildCharacter({name:'Appearance owner',presetId:'guardian',species:'human',className:'fighter',background:'soldier',baseScores:{str:16,dex:14,con:14,int:10,wis:12,cha:10},bgPlus2:'str',bgPlus1:'con',skills:['athletics','perception']});char.id='v1b-owner';store.saveCharacters([char]);const state=engine.startGame(char,{bringAlly:false,mapId:'crypt'});store.saveGame(state);const canonical=JSON.stringify([store.getCharacters(),store.getSave(state.id)]);
    check((await api('PUT','/api/content/visuals',{type:'hero',targetId:char.id,modelId:'test-starter-hero'})).status===200,'select hero');check((await api('PUT','/api/content/visuals',{type:'monster',targetId:'skeleton',modelId:'test-starter-skeleton'})).status===200,'bind stable monster');check((await api('PUT','/api/content/visuals',{type:'hero',targetId:char.id,modelId:'test-starter-skeleton'})).status===400,'wrong model role rejected');check((await api('PUT','/api/content/visuals',{type:'monster',targetId:'missing',modelId:null})).status===400,'unknown stable ID rejected');check((await api('PUT','/api/content/visuals',{type:'pack',packId:'visual-test',enabled:false})).body.models.filter(m=>m.packId==='visual-test').every(m=>m.disabled),'disable pack');check(JSON.stringify([store.getCharacters(),store.getSave(state.id)])===canonical,'appearance leaves character/save/RNG bytewise equal');
    await api('DELETE','/api/content/pack/visual-test');check(store.getSave(state.id).map&&content.getMap('crypt'),'old save still playable after deletion');check((await api('GET','/api/content/visuals')).body.prefs.heroes[char.id]==='test-starter-hero','missing preference retained for later reimport');
  });
}catch(e){failed++;console.error('V1b content setup '+e.stack);}finally{await new Promise((resolve,reject)=>server.close(e=>e?reject(e):resolve())).catch(e=>{failed++;console.error('Server cleanup '+e.stack);});fs.rmSync(temp,{recursive:true,force:true});console.log('V1b content: '+passed+' cases / '+assertions+' assertions passed, '+failed+' failed.');}
if(failed)process.exitCode=1;
