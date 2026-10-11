import * as THREE from '/vendor/three.module.js';
import { GLTFLoader } from '/vendor/addons/loaders/GLTFLoader.js';
import { clone } from '/vendor/addons/utils/SkeletonUtils.js';
import { createVisualInstance } from './visual-instance.js';
import { makeHpBar } from './models3d.js';

const cache=new Map();
const counts={entries:0,pending:0,refs:0,mixers:0,skeletons:0,geometries:0,materials:0,textures:0};
export const packVisualResources=()=>({...counts});
const kind=r=>r?.isBufferGeometry?'geometries':r?.isMaterial?'materials':r?.isTexture?'textures':null;
function collect(scene){const owned=new Set();scene.traverse(node=>{if(node.geometry)owned.add(node.geometry);for(const m of Array.isArray(node.material)?node.material:[node.material])if(m){owned.add(m);for(const value of Object.values(m))if(value?.isTexture)owned.add(value);}});return owned;}
function discard(entry){
  if(!entry.discarded){entry.discarded=true;
    for(const resource of entry.owned){resource.dispose();counts[kind(resource)]--;if(resource.isTexture)resource.source?.data?.close?.();}
  }
  for(const scene of entry.gltf?.scenes||[]){scene.traverse(n=>n.isSkinnedMesh&&n.skeleton.dispose());scene.clear();}
  entry.gltf=null;
}
// Every waiter has a release token, including fetch/parse still in flight.
function acquire(model){
  const key=model.packId+':'+model.file+':'+model.digest;let entry=cache.get(key);
  if(!entry){
    entry={refs:0,controller:new AbortController(),owned:new Set(),gltf:null,discarded:false};cache.set(key,entry);counts.entries++;counts.pending++;
    entry.promise=(async()=>{
      const response=await fetch(model.url,{signal:entry.controller.signal});if(!response.ok)throw new Error('Visual asset HTTP '+response.status);
      const bytes=await response.arrayBuffer();if(bytes.byteLength>2*1024*1024)throw new Error('Visual asset budget exceeded');
      const digest=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(v=>v.toString(16).padStart(2,'0')).join('');if(digest!==model.digest)throw new Error('Visual asset digest mismatch');
      // Server permits embedded resources only. Enforce this again on loader requests.
      const manager=new THREE.LoadingManager();manager.setURLModifier(url=>{if(!url.startsWith('blob:'))throw new Error('External visual resource blocked');return url;});
      const track=resource=>{if(!kind(resource)||entry.owned.has(resource))return;entry.owned.add(resource);if(entry.discarded){resource.dispose();if(resource.isTexture)resource.source?.data?.close?.();}else counts[kind(resource)]++;};
      const trackValue=value=>{if(Array.isArray(value))value.forEach(trackValue);else if(value?.isObject3D)collect(value).forEach(track);else track(value);};
      const loader=new GLTFLoader(manager);
      // Track resources as dependencies resolve, including partially failed parses.
      loader.register(parser=>{const original=parser.getDependency.bind(parser),geometries=parser.loadGeometries.bind(parser);parser.getDependency=(type,id)=>{const result=original(type,id);result.then(trackValue).catch(()=>{});return result;};parser.loadGeometries=primitives=>{const result=geometries(primitives);result.then(trackValue).catch(()=>{});return result;};return {name:'AI_DND_RESOURCE_OWNERSHIP'};});
      const gltf=await loader.parseAsync(bytes,'');entry.gltf=gltf;for(const scene of gltf.scenes)trackValue(scene);
      if(entry.refs===0){discard(entry);throw new Error('Visual load cancelled');}return gltf;
    })().finally(()=>{counts.pending--;});
  }
  entry.refs++;counts.refs++;let released=false;
  return {promise:entry.promise,release(){if(released)return;released=true;entry.refs--;counts.refs--;if(entry.refs===0){if(cache.get(key)===entry){cache.delete(key);counts.entries--;}entry.controller.abort();discard(entry);}}};
}
function buildGLB(entity,model,gltf,release,track){
  const scene=clone(gltf.scene),root=new THREE.Group();root.add(scene);scene.scale.setScalar(model.scale);scene.rotation.y=model.yaw*Math.PI/180;
  // GLB extras remain in authored exports, but only renderer anchors own hit metadata.
  scene.traverse(node=>{node.userData={};});
  scene.updateMatrixWorld(true);scene.traverse(node=>{if(node.isSkinnedMesh)node.skeleton.update();});
  const box=new THREE.Box3().setFromObject(scene),extent=box.getSize(new THREE.Vector3());
  if(box.isEmpty()||![extent.x,extent.y,extent.z].every(Number.isFinite)||Math.max(extent.x,extent.y,extent.z)>12)throw new Error('Visual scene is empty or exceeds display bounds');
  const mixer=new THREE.AnimationMixer(scene),actions={},skeletons=new Set();
  let bar=null;
  if(entity.kind==='monster'){bar=makeHpBar(track);bar.sprite.geometry=track(bar.sprite.geometry.clone());bar.sprite.position.y=1.48;root.add(bar.sprite);}
  scene.traverse(node=>{if(node.isSkinnedMesh){skeletons.add(node.skeleton);node.frustumCulled=false;}node.castShadow=true;});
  counts.mixers++;counts.skeletons+=skeletons.size;
  for(const [action,name] of Object.entries(model.clips)){const clip=gltf.animations.find(c=>c.name===name);if(clip)actions[action]=mixer.clipAction(clip);}
  let current=null,oneShot=false,dead=false;
  function play(action){const selected=actions[action]||actions.idle;if(!selected)return;current?.stop();current=selected;current.reset();oneShot=!['idle','walk'].includes(action)&&!!actions[action];dead=action==='death'&&!!actions.death;current.setLoop(oneShot?THREE.LoopOnce:THREE.LoopRepeat,oneShot?1:Infinity);current.clampWhenFinished=oneShot;current.play();}
  play('idle');
  const onFinished=()=>{if(!dead){oneShot=false;play('idle');}};mixer.addEventListener('finished',onFinished);
  let released=false;
  return {
    root,kind:'glb',externalOwnership:true,actions:['idle','walk','attack','hit','death','cast'],
    sync(ent,selected){bar?.draw(ent.hp/ent.hpMax);root.userData.selected=selected;},
    update(now,delta,walking){if(!oneShot&&!dead){const action=walking?(actions.walk||actions.idle):actions.idle;if(action&&current!==action)play(walking?'walk':'idle');}mixer.update(Math.min(delta,.1));},
    play,
    state:()=>({modelId:model.id,clip:current?.getClip().name||null,time:current?.time||0,bones:[...skeletons].flatMap(s=>s.bones.map(b=>({name:b.name,x:b.quaternion.x,z:b.quaternion.z}))) }),
    dispose(){if(released)return;released=true;mixer.removeEventListener('finished',onFinished);mixer.stopAllAction();mixer.uncacheRoot(scene);for(const s of skeletons)s.dispose();counts.mixers--;counts.skeletons-=skeletons.size;root.clear();release();}
  };
}

export function selectVisualModel(entity,catalog,characterId){
  if(!catalog)return null;let id;
  if(entity.kind==='player')id=catalog.prefs.heroes[characterId];
  else if(entity.kind==='monster')id=Object.hasOwn(catalog.prefs.monsters,entity.monsterId)?catalog.prefs.monsters[entity.monsterId]:catalog.bindings[entity.monsterId];
  else return null;
  return catalog.models.find(m=>m.id===id&&!m.disabled&&m.role===(entity.kind==='player'?'hero':'monster'))||null;
}
export function createPackVisual(entity,model){
  if(!model)return createVisualInstance(entity);
  const root=new THREE.Group();let inner=createVisualInstance(entity),alive=true,status='loading',latest=entity,selected=false;
  root.add(inner.root);const lease=acquire(model);
  const ready=lease.promise.then(gltf=>{
    if(!alive)return;
    const next=createVisualInstance(latest,(_,track)=>buildGLB(latest,model,gltf,lease.release,track));
    inner.dispose();inner=next;root.add(inner.root);inner.sync(latest,true,selected);status='ready';
  }).catch(error=>{lease.release();if(alive){status='fallback';console.warn('Visual asset fallback',model.id,error.message);}});
  return createVisualInstance(entity,()=>({root,kind:'pack',externalOwnership:true,actions:['idle','walk','attack','hit','death','cast'],
    sync(ent,isSelected){latest=ent;selected=isSelected;inner.sync(ent,true,isSelected);},
    update(now,delta,walking){inner.update(now,delta,walking);},
    // A result received while loading is deliberately not replayed on late attachment.
    play(action,now){inner.play(action,model.id+':'+now,now);},
    state:()=>({status,modelId:model.id,inner:inner.state()}),
    dispose(){alive=false;inner.dispose();lease.release();},ready
  }));
}
export const packVisualFactory=(catalog,characterId)=>entity=>createPackVisual(entity,selectVisualModel(entity,catalog,characterId));
