// V1a contract tests use actual Three.js resources, without a browser or RNG.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import * as THREE from 'three';
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'ai-dnd-visual-'));
global.document={createElement:()=>({width:64,height:64,getContext:()=>({fillRect(){},strokeRect(){},clearRect(){},fillText(){},measureText:()=>({width:20})})})};
let passed=0,failed=0;
function check(value,message){if(!value)throw new Error(message);passed++;}
function test(name,run){try{run();console.log('  PASS: '+name);}catch(error){failed++;console.error('  FAIL: '+name+' '+error.stack);}}
try {
  for(const name of ['models3d','visual-instance','visual-sample']) {
    const source=fs.readFileSync('public/js/'+name+'.js','utf8').replace(/from\s+['"]\/vendor\/three\.module\.js['"]/g,'from '+JSON.stringify(import.meta.resolve('three'))).replace(/from '\.\/(models3d|visual-instance)\.js'/g,"from './$1.mjs'");
    fs.writeFileSync(path.join(directory,name+'.mjs'),source);
  }
  const {createVisualInstance,visualResources}=await import(pathToFileURL(path.join(directory,'visual-instance.mjs')).href);
  const {createSampleVisual}=await import(pathToFileURL(path.join(directory,'visual-sample.mjs')).href);
  const hero={id:'player',kind:'player',name:'V1 Hero',className:'fighter',hp:13,hpMax:13,x:4,y:4};
  const zero=()=>Object.values(visualResources()).every(n=>n===0);
  test('default model owns and releases meshes, badge/HP textures exactly once',()=>{
    const entity={...hero,kind:'monster',monsterId:'skeleton',isElite:true};
    const input=JSON.stringify(entity),visual=createVisualInstance(entity),scene=new THREE.Group();scene.add(visual.root);
    try {
    const owned=new Set(),disposed=new Map();
    visual.root.traverse(node=>{if(node.geometry)owned.add(node.geometry);for(const m of Array.isArray(node.material)?node.material:[node.material])if(m){owned.add(m);for(const v of Object.values(m))if(v?.isTexture)owned.add(v);}});
    for(const value of owned)value.addEventListener('dispose',()=>disposed.set(value,(disposed.get(value)||0)+1));
    check(visual.state().kind==='procedural','default kind');check(visualResources().textures>=1,'procedural sprite textures counted');
    visual.sync({...entity,hp:5},true,true);visual.update(100,1/60);
    visual.dispose();visual.dispose();visual.update(200,1/60);visual.move([{x:9,z:9}]);
    check(scene.children.length===0&&!visual.state().alive,'scene detached and remains dead');
    check([...owned].every(value=>disposed.get(value)===1),'all owned resources disposed once');check(zero(),'all default counters zero');check(JSON.stringify(entity)===input,'authoritative input untouched');
    } finally{visual.dispose();}
  });
  test('disposing a procedural sprite cannot dispose another instance shared quad',()=>{
    const entity={kind:'monster',monsterId:'skeleton',hp:20,hpMax:20},a=createVisualInstance(entity),b=createVisualInstance(entity);
    try {
      const one=a.root.children.find(n=>n.isSprite),two=b.root.children.find(n=>n.isSprite);let disposed=0;
      two.geometry.addEventListener('dispose',()=>disposed++);
      check(one.geometry!==two.geometry,'sprite geometry privately owned');a.dispose();
      check(disposed===0&&b.state().alive,'sibling sprite survives');b.dispose();check(disposed===1&&zero(),'sibling quad released exactly once');
    } finally{a.dispose();b.dispose();}
  });
  test('same monster sample instances have private actions and resources, no rig dependency',()=>{
    const entity={id:'skeleton-1',kind:'monster',monsterId:'skeleton',hp:20,hpMax:20};
    const a=createSampleVisual(entity),b=createSampleVisual({...entity,id:'skeleton-2'});
    try {
      check(!a.root.userData.rig&&!b.root.userData.rig,'jointless sample');check(a.root!==b.root,'independent roots');
      check(a.root.children[0].children[0].material!==b.root.children[0].children[0].material,'private materials');
      check(a.play('attack','event-1',100),'confirmed action accepted');check(!a.play('attack','event-1',200),'duplicate not replayed');
      check(b.play('attack','event-1',150),'same event on another instance independent');
      a.update(250,1/60);b.update(250,1/60);
      check(a.root.children[0].rotation.x!==b.root.children[0].rotation.x,'independent action clocks');
      check(!a.play('death','event-2',250)&&a.state().plays===1,'missing clip falls back without starting action');
      a.update(900,1/60);check(a.root.children[0].rotation.x===0,'missing action leaves idle usable');
      a.dispose();check(b.state().alive&&visualResources().instances===1,'one disposal leaves sibling alive');
      b.update(950,1/60);check(b.play('hit','event-2',950),'sibling still plays');
    } finally {a.dispose();b.dispose();}
    check(zero(),'all sample counters zero');
  });
  test('generic movement converges through turns and interruptions for either implementation',()=>{
    for(const factory of [createVisualInstance,createSampleVisual]) {
      const v=factory(hero);try {
        const waypoints=[{x:1,z:0},{x:1,z:2}];v.move(waypoints,2);waypoints[0].x=99;
        for(let n=0;n<240;n++)v.update(n*16,1/60);
        check(v.root.position.x===1&&v.root.position.z===2&&!v.motion().animating,'final convergence independent of FPS');
        v.move([{x:3,z:2}],2);v.update(4000,.1);v.move([{x:1,z:3}],2);
        check(!v.play('cast','missing',4000),'unknown clip safe during move');
        for(let n=0;n<180;n++)v.update(4000+n*16,1/60);
        check(v.root.position.x===1&&v.root.position.z===3&&!v.motion().animating,'interrupted move reaches new final target');
        v.move([{x:9,z:9}]);v.move([]);check(!v.motion().animating,'snap/stop clears motion');
      } finally{v.dispose();}
    }
    check(zero(),'all motion counters zero');
  });
  test('construction and disposal faults still release every private resource',()=>{
    let count=0;
    const resource=()=>{const g=new THREE.BoxGeometry();g.addEventListener('dispose',()=>count++);return g;};
    let threw=false;try{createVisualInstance(hero,(_,track)=>{track(resource());track(resource());throw new Error('bad specimen');});}catch{threw=true;}
    check(threw&&count===2&&zero(),'failed builder releases allocations');
    const v=createVisualInstance(hero,(_,track)=>{track(resource());track(resource());return {root:new THREE.Group(),actions:['idle'],update(){},dispose(){throw new Error('adapter cleanup fault');}};});
    threw=false;try{v.dispose();}catch{threw=true;}v.dispose();
    check(threw&&count===4&&zero(),'cleanup continues after adapter fault and remains idempotent');
    check(!v.play('idle','late')&&!v.state().alive,'late action cannot resurrect disposed instance');
  });
  test('default HP canvas failure releases already allocated texture/materials',()=>{
    const create=global.document.createElement,dispose=THREE.Texture.prototype.dispose;let textures=0,threw=false;
    global.document.createElement=()=>({getContext:()=>null});
    THREE.Texture.prototype.dispose=function(){textures++;return dispose.call(this);};
    try{createVisualInstance({kind:'monster',monsterId:'skeleton'});}catch{threw=true;}
    finally{global.document.createElement=create;THREE.Texture.prototype.dispose=dispose;}
    check(threw&&textures===1,'default builder releases texture after draw throws');check(zero(),'default construction failure leaves zero resources');
  });
  test('sample keeps companions, NPCs and other monster species on default visuals',()=>{
    for(const entity of [{kind:'ally',name:'Bram'},{kind:'npc',name:'Marla'},{kind:'monster',monsterId:'goblin',hp:7,hpMax:7}]){
      const visual=createSampleVisual(entity);try{check(visual.state().kind==='procedural','unsupported sample entity uses default');}finally{visual.dispose();}
    }
    check(zero(),'limited specimen releases all fallback resources');
  });
  check(zero(),'suite leaves no visual resources');
} catch(error){failed++;console.error('Visual suite setup/teardown: '+error.stack);}
finally {fs.rmSync(directory,{recursive:true,force:true});console.log('V1a visual unit: '+passed+' passed, '+failed+' failed.');}
if(failed)process.exitCode=1;
