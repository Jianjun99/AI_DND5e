// A small code-only V1a specimen: no procedural rig, joint names, package or binding.
import * as THREE from '/vendor/three.module.js';
import { createVisualInstance } from './visual-instance.js';

export function createSampleVisual(entity) {
  // First-stage specimen covers the hero and one monster species only.
  if(entity.kind!=='player' && !(entity.kind==='monster'&&entity.monsterId==='skeleton')) return createVisualInstance(entity);
  return createVisualInstance(entity,(ent,track)=>{
    const root=new THREE.Group(), body=new THREE.Group(); root.add(body);
    const hero=ent.kind==='player', color=hero?0xfbbf24:0x67e8f9;
    const material=track(new THREE.MeshLambertMaterial({color}));
    const base=new THREE.Mesh(track(new THREE.CylinderGeometry(.28,.34,.1,12)),material); base.position.y=.05; body.add(base);
    const torso=new THREE.Mesh(track(new THREE.ConeGeometry(.22,.55,hero?5:8)),material); torso.position.y=.4; body.add(torso);
    const head=new THREE.Mesh(track(new THREE.OctahedronGeometry(.16)),material); head.position.y=.83; body.add(head);
    let pulse=null;
    return {
      root,kind:'sample',actions:['idle','walk','attack','hit'],
      sync() {},
      play(action,now) { if (action==='attack'||action==='hit') pulse={action,now}; },
      update(now,delta,walking) {
        body.position.y=Math.sin(now*(walking?.012:.0035))*(walking?.05:.015);
        const progress=pulse?Math.min(1,(now-pulse.now)/400):1;
        body.rotation.x=pulse&&progress<1?Math.sin(progress*Math.PI)*(pulse.action==='hit'?.35:-.45):0;
        if(progress===1)pulse=null;
      }
    };
  });
}
