import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import checks from '../../server/game/visual-content.js';
import visualEvents from '../../server/game/visual-events.js';
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'ai-dnd-v1b-unit-'));
global.document={createElement:()=>({width:64,height:64,getContext:()=>({fillRect(){},strokeRect(){},clearRect(){},fillText(){},measureText:()=>({width:20})})})};
const bytes=fs.readFileSync('content/visual-starter/assets/hero.glb'),fixture=JSON.parse(fs.readFileSync('tests/fixtures/content/visual-pack.json','utf8'));
let passed=0,failed=0;
function check(value,message){if(!value)throw new Error(message);passed++;}
async function test(name,fn){try{await fn();console.log('  PASS: '+name);}catch(e){failed++;console.error('  FAIL: '+name+' '+e.stack);}}
async function until(fn){for(let i=0;i<100;i++){if(fn())return;await new Promise(r=>setTimeout(r,5));}throw new Error('Async visual state failed to converge');}
function mutateGLB(edit){const size=bytes.readUInt32LE(12),doc=JSON.parse(bytes.subarray(20,20+size));edit(doc);let json=Buffer.from(JSON.stringify(doc));if(json.length%4)json=Buffer.concat([json,Buffer.alloc(4-json.length%4,32)]);const header=Buffer.from(bytes.subarray(0,20)),bin=bytes.subarray(20+size);header.writeUInt32LE(20+json.length+bin.length,8);header.writeUInt32LE(json.length,12);return Buffer.concat([header,json,bin]);}
try{
  for(const name of ['models3d','visual-instance','visual-packs']){let source=fs.readFileSync('public/js/'+name+'.js','utf8').replace(/from ['"]\/vendor\/three.module.js['"]/g,'from '+JSON.stringify(import.meta.resolve('three'))).replace(/from '\/vendor\/addons\/loaders\/GLTFLoader.js'/g,'from '+JSON.stringify(import.meta.resolve('three/examples/jsm/loaders/GLTFLoader.js'))).replace(/from '\/vendor\/addons\/utils\/SkeletonUtils.js'/g,'from '+JSON.stringify(import.meta.resolve('three/examples/jsm/utils/SkeletonUtils.js'))).replace(/from '\.\/(models3d|visual-instance).js'/g,"from './$1.mjs'");fs.writeFileSync(path.join(directory,name+'.mjs'),source);}
  const {createPackVisual,packVisualResources,selectVisualModel}=await import(pathToFileURL(path.join(directory,'visual-packs.mjs')).href),{visualResources}=await import(pathToFileURL(path.join(directory,'visual-instance.mjs')).href);
  const zero=()=>[...Object.values(packVisualResources()),...Object.values(visualResources())].every(n=>n===0),hero={id:'player',kind:'player',hp:20,hpMax:20},monster={id:'m1',kind:'monster',monsterId:'skeleton',hp:20,hpMax:20};
  const model={...fixture.visuals.models[0],packId:'test',digest:checks.inspectGLB(bytes).digest,url:'http://local/hero.glb'};
  let requests=0;global.fetch=async()=>{requests++;return new Response(bytes);};
  await test('finite GLB validates genuine bones/clips and rejects URI, cycles, bounds and budgets',()=>{
    const info=checks.inspectGLB(bytes);check(info.clips.length===6&&info.vertices>0,'six real clips');
    const textured=fs.readFileSync('content/visual-starter/assets/skeleton.glb');check(checks.inspectGLB(textured).pixels===4,'real embedded PNG dimensions/decompression accepted');const bad=Buffer.from(textured),jsonSize=bad.readUInt32LE(12),doc=JSON.parse(bad.subarray(20,20+jsonSize)),view=doc.bufferViews[doc.images[0].bufferView];bad[28+jsonSize+view.byteOffset+33]^=1;let pngRejected=false;try{checks.inspectGLB(bad);}catch{pngRejected=true;}check(pngRejected,'corrupt embedded PNG CRC rejected');
    for(const edit of [d=>d.buffers[0].uri='https://outside',d=>d.nodes[2].children.push(0),d=>d.accessors[0].count=900000,d=>d.bufferViews[0].byteLength=900000,d=>d.extensionsUsed=['KHR_draco_mesh_compression'],d=>d.animations[0].samplers[0].interpolation='CUBICSPLINE']){let rejected=false;try{checks.inspectGLB(mutateGLB(edit));}catch{rejected=true;}check(rejected,'invalid binary definition rejected');}
    check(!checks.assetPath('../hero.glb')&&!checks.assetPath('assets/Hero.glb'),'declared finite paths');
  });
  await test('shared cache has private bones/mixers and releases last reference only',async()=>{
    const a=createPackVisual(monster,model),b=createPackVisual({...monster,id:'m2'},model);try{await until(()=>a.state().status==='ready'&&b.state().status==='ready');check(requests===1&&packVisualResources().entries===1&&packVisualResources().refs===2,'one fetch two leases');check(packVisualResources().mixers===2&&packVisualResources().skeletons===2,'two mixers and skeletons');
      a.play('attack','one',100);a.update(300,.1);b.update(300,.1);const arm=v=>v.state().inner.bones.find(bone=>bone.name==='Arm');check(arm(a).x!==arm(b).x,'private attack bone state');check(!a.play('attack','one',120),'duplicate ID rejected');
      const before=packVisualResources().geometries;a.dispose();check(packVisualResources().refs===1&&packVisualResources().geometries===before&&b.state().alive,'shared geometry survives sibling disposal');b.play('hit','two',300);b.update(400,.1);check(b.state().inner.clip==='Hit','surviving mixer plays');
    }finally{a.dispose();b.dispose();}check(zero(),'all cache/private/bone/mixer ownership zero');
  });
  await test('missing optional clip returns idle, confirmed movement converges and death is finite',async()=>{
    const limited={...model,clips:{idle:'Idle',walk:'Walk'}},v=createPackVisual(hero,limited);try{await until(()=>v.state().status==='ready');v.play('cast','missing');v.update(100,.05);check(v.state().inner.clip==='Idle','missing cast returns idle');v.move([{x:2,z:3}]);for(let n=0;n<180;n++)v.update(n*16,1/60);check(v.root.position.x===2&&v.root.position.z===3&&!v.motion().animating,'motion final convergence');}finally{v.dispose();}check(zero(),'limited model released');
    const death=createPackVisual(hero,model);try{await until(()=>death.state().status==='ready');death.play('death','death');for(let n=0;n<100;n++)death.update(n*16,1/60);check(death.state().inner.clip==='Death'&&death.state().inner.time<=.901,'one death clip holds final pose');}finally{death.dispose();}check(zero(),'death mixer released');
  });
  await test('late response after dispose never attaches; failed digest safely uses default',async()=>{
    let complete;global.fetch=()=>new Promise(r=>complete=r);const late=createPackVisual(hero,model);late.dispose();complete(new Response(bytes));await until(()=>packVisualResources().pending===0);check(zero()&&!late.state().alive,'late parse/resources discarded');
    global.fetch=async()=>new Response(bytes);const bad=createPackVisual(hero,{...model,digest:'bad'});try{await until(()=>bad.state().status==='fallback');check(bad.state().inner.kind==='procedural'&&packVisualResources().refs===0,'digest fallback');}finally{bad.dispose();}check(zero(),'fallback resources released');
  });
  await test('selection uses stable IDs and opt-in preferences, NPC/companions remain default',()=>{
    const catalog={models:[{...model,role:'hero'},{...model,id:'monster',role:'monster'}],bindings:{skeleton:'monster'},prefs:{heroes:{hero:model.id},monsters:{}}};check(selectVisualModel(hero,catalog,'hero')?.id===model.id,'hero selection');check(selectVisualModel(monster,catalog,'hero')?.id==='monster','stable species binding');catalog.prefs.monsters.skeleton=null;check(selectVisualModel(monster,catalog,'hero')===null,'explicit default overrides authored binding');check(selectVisualModel({kind:'ally'},catalog,'hero')===null&&selectVisualModel({kind:'npc'},catalog,'hero')===null,'NPC/ally default');catalog.models[0].disabled=true;check(selectVisualModel(hero,catalog,'hero')===null,'disabled model fallback');
  });
  await test('partial loader failure disposes geometry/material dependencies already allocated',async()=>{
    const badBytes=mutateGLB(d=>d.skins[0].joints=[999]);global.fetch=async()=>new Response(badBytes);const badModel={...model,digest:(await import('node:crypto')).createHash('sha256').update(badBytes).digest('hex')},visual=createPackVisual(hero,badModel);try{await until(()=>visual.state().status==='fallback');check(visual.state().inner.kind==='procedural','loader failure uses default');}finally{visual.dispose();}await until(zero);check(zero(),'partially loaded resources eventually zero');global.fetch=async()=>new Response(bytes);
  });
  await test('empty display scene falls back without retaining the parsed cache',async()=>{
    const emptyBytes=mutateGLB(d=>d.scenes[0].nodes=[]);global.fetch=async()=>new Response(emptyBytes);const emptyModel={...model,digest:(await import('node:crypto')).createHash('sha256').update(emptyBytes).digest('hex')},v=createPackVisual(hero,emptyModel);try{await until(()=>v.state().status==='fallback');check(v.state().inner.kind==='procedural','empty scene uses default');}finally{v.dispose();}await until(zero);check(zero(),'empty scene resources zero');global.fetch=async()=>new Response(bytes);
  });
  await test('authored GLB extras cannot override renderer tile or stable entity metadata',async()=>{
    const extraBytes=mutateGLB(d=>d.nodes[1].extras={tile:{x:99,y:99},entityId:'forged'});check(checks.inspectGLB(extraBytes).vertices>0,'cosmetic extras can remain in complete authored asset');global.fetch=async()=>new Response(extraBytes);const extraModel={...model,digest:(await import('node:crypto')).createHash('sha256').update(extraBytes).digest('hex')},v=createPackVisual(hero,extraModel);try{await until(()=>v.state().status==='ready');const hits=[];v.root.traverse(node=>{if(node.userData.tile||node.userData.entityId)hits.push(node);});check(hits.length===0,'loaded nodes leave all hit metadata to the outer renderer anchor');}finally{v.dispose();}check(zero(),'sanitized model releases ownership');global.fetch=async()=>new Response(bytes);
  });
  await test('parser rejection after resource allocation releases unfinished cache ownership',async()=>{
    const {GLTFLoader}=await import('three/examples/jsm/loaders/GLTFLoader.js'),original=GLTFLoader.prototype.parseAsync;
    GLTFLoader.prototype.parseAsync=async function(...args){await original.apply(this,args);check(packVisualResources().geometries>0&&packVisualResources().materials>0,'actual parser dependencies allocated before injected rejection');throw new Error('Injected parser rejection after allocation');};
    global.fetch=async()=>new Response(bytes);const v=createPackVisual(hero,model);
    try{await until(()=>v.state().status==='fallback');check(v.state().inner.kind==='procedural','unfinished parse keeps playable default');}finally{v.dispose();GLTFLoader.prototype.parseAsync=original;}
    await until(zero);check(zero(),'unfinished parse resources and counters released');
  });
  await test('confirmed projection uses typed events/HP/alive and unique IDs without writes',()=>{
    const before=[{id:'player',hp:20,alive:true},{id:'m1',hp:10,alive:true}],after=[{id:'player',hp:18,alive:true},{id:'m1',hp:0,alive:false}],events=[{type:'attack',data:{targetId:'m1'}},{type:'attack_in',data:{attackerId:'m2',targetId:'player'}}],snapshot=JSON.stringify([before,after,events]);const result=visualEvents.project(before,after,events,{type:'attack',targetId:'m1'},'confirmed');check(result.filter(e=>e.animation==='attack').length===2&&result.some(e=>e.entityId==='m1'&&e.animation==='death'),'actors/hit/death typed');check(result.filter(e=>e.animation==='hit').length===2&&new Set(result.map(e=>e.eventId)).size===result.length,'unique event IDs');check(JSON.stringify([before,after,events])===snapshot,'projection read only');check(visualEvents.project(after,after,[],{type:'describe'},'read').length===0,'read snapshot does not replay');
  });
}catch(e){failed++;console.error('V1b unit setup '+e.stack);}finally{fs.rmSync(directory,{recursive:true,force:true});console.log('V1b visual unit: '+passed+' passed, '+failed+' failed.');}
if(failed)process.exitCode=1;
