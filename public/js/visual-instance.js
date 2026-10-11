// V1a: one owned visual per entity; renderer never knows its rig or materials.
import { createCharacterModel, updateModelMotion, updateModelPose } from './models3d.js';

const resources = { instances:0, geometries:0, materials:0, textures:0 };
export function visualResources() { return { ...resources }; }
const category = value => value?.isBufferGeometry ? 'geometries' : value?.isMaterial ? 'materials' : value?.isTexture ? 'textures' : null;

export function proceduralAdapter(entity, track) {
  const root = createCharacterModel(entity, track);
  return {
    root, kind:'procedural', actions:['idle','walk','attack'],
    sync(ent, selected) {
      if (root.userData.bar) root.userData.bar.draw(ent.hp / ent.hpMax);
      if (selected) root.children.forEach(ch => { ch.material?.emissive?.set(0x443300); });
    },
    update(now, delta, walking) { updateModelPose(root, now, delta, walking); },
    play(action, now) {
      const rig = root.userData.rig;
      if (action==='attack') { rig.attacking=true; rig.attackAnim={t0:now,dur:400}; }
    }
  };
}

/** Adapters allocate private resources through track, including before throwing.
 * No cache, package loader or saved binding is introduced in V1's first stage. */
export function createVisualInstance(entity, build = proceduralAdapter) {
  const owned = new Set();
  const track = value => { if (category(value)) owned.add(value); return value; };
  let adapter;
  try {
    adapter = build(entity, track);
    if (!adapter?.root?.isObject3D || typeof adapter.update!=='function' || !Array.isArray(adapter.actions)) throw new TypeError('Invalid visual adapter');
    // Include procedural canvas badges/HP sprites which legacy builders did not track.
    if(!adapter.externalOwnership) adapter.root.traverse(node => {
      // Three.Sprite's default quad is shared globally; make this visual its owner.
      if (node.isSprite) node.geometry=node.geometry.clone();
      track(node.geometry);
      for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
        if (!material) continue;
        track(material); Object.values(material).forEach(track);
      }
    });
  } catch (error) {
    const errors=[error];
    try { adapter?.dispose?.(); } catch(cleanupError) { errors.push(cleanupError); }
    for (const value of owned) try { value.dispose(); } catch(cleanupError) { errors.push(cleanupError); }
    if(errors.length>1)throw new AggregateError(errors,'Visual construction failed');
    throw error;
  }
  const root = adapter.root;
  const seen = new Set();
  let alive = true, plays = 0, lastAction = null;
  resources.instances++;
  for (const value of owned) resources[category(value)]++;
  function motion() {
    const anim = root.userData.anim;
    return { animating:!!anim, waypoint:anim?.currentWpIndex ?? null, waypoints:anim?.waypoints.length || 0 };
  }
  return {
    root,
    sync(ent, visible = true, selected = false) { if (alive) { root.visible=visible; adapter.sync?.(ent,selected); } },
    move(waypoints, speed = 4.6) {
      if (!alive) return;
      if (waypoints.length) root.userData.anim={waypoints:waypoints.map(p=>({x:p.x,z:p.z})),currentWpIndex:0,speed};
      else delete root.userData.anim;
    },
    update(now, delta, walking = false) { if (alive) adapter.update(now,delta,updateModelMotion(root,delta)||walking); },
    play(action, eventId, now = performance.now()) {
      if (!alive || !adapter.actions.includes(action) || !eventId || seen.has(eventId)) return false;
      seen.add(eventId); if (seen.size>256) seen.delete(seen.values().next().value);
      plays++; lastAction=action; adapter.play?.(action,now); return true;
    },
    motion,
    state: () => ({kind:adapter.kind,alive,plays,lastAction,...motion(),...adapter.state?.()}),
    dispose() {
      if (!alive) return;
      alive=false; resources.instances--; delete root.userData.anim;
      root.removeFromParent();
      const errors=[];
      try { adapter.dispose?.(); } catch(error) { errors.push(error); }
      for (const value of owned) { try { value.dispose(); } catch(error) { errors.push(error); } finally { resources[category(value)]--; } }
      owned.clear(); seen.clear(); root.clear(); root.userData={};
      if(errors.length)throw new AggregateError(errors,'Visual cleanup failed');
    }
  };
}
