// map3d.js — 2.5D diorama renderer (Three.js): extruded walls, capsule heroes,
// torchlight on the player, fog of war by tile. Same interface as map.js:
//   createMap3D(container, { onTileClick, isSelected }) → { render(game), dispose() }
// Kept deliberately simple: fixed angle camera with wheel zoom, no textures (canvas-generated only).
import * as THREE from '/vendor/three.module.js';

const TILE = 1;
const WALL_H = 0.7;

function hash(x, y) { let h = (x * 374761393 + y * 668265263) ^ 0x5bf03635; h = (h ^ (h >> 13)) * 1274126177; return ((h ^ (h >> 16)) >>> 0) / 4294967295; }

function emojiTexture(emoji) {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  g.font = '44px serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(emoji, 32, 34);
  const t = new THREE.CanvasTexture(c);
  return t;
}

function labelTexture(text, color = '#e8dcc0') {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 16;
  const g = c.getContext('2d');
  g.font = '12px sans-serif';
  g.textAlign = 'center';
  g.fillStyle = color;
  g.fillText(String(text).slice(0, 18), 64, 12);
  return new THREE.CanvasTexture(c);
}

export function createMap3D(container, opts = {}) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0a0806);
  const camera = new THREE.PerspectiveCamera(46, 1, 0.1, 100);
  let zoom = 1;
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  container.appendChild(renderer.domElement);
  renderer.domElement.style.width = '100%';
  renderer.domElement.style.display = 'block';
  renderer.domElement.style.cursor = 'crosshair';

  const ambient = new THREE.AmbientLight(0x554433, 0.9);
  scene.add(ambient);
  const hemi = new THREE.HemisphereLight(0x886644, 0x0c0a08, 0.5);
  scene.add(hemi);
  const torch = new THREE.PointLight(0xffb066, 18, 9, 1.8);
  scene.add(torch);

  const world = new THREE.Group();
  scene.add(world);

  const disposables = [];
  function track(obj) { disposables.push(obj); return obj; }

  let hoverTile = null;
  let currentGame = null;
  const THEMES = {
    crypt: { bg: 0x0a0806, ambient: 0x554433, hemi: [0x886644, 0x0c0a08], floor: [0.18, 0.155, 0.13], wall: [0.24, 0.21, 0.18] },
    hills: { bg: 0x2a2f20, ambient: 0x88806a, hemi: [0x9aa878, 0x1a1c12], floor: [0.15, 0.2, 0.11], wall: [0.26, 0.2, 0.13] }
  };
  let entityNodes = new Map(); // entId -> { group, target: Vector3 }
  let camTarget = new THREE.Vector3();

  function clearWorld() {
    while (world.children.length) {
      const o = world.children.pop();
      world.remove(o);
    }
    entityNodes = new Map();
  }

  function floorColor(x, y, lit, isWall) {
    const r = hash(x * 3 + 1, y * 7 + 2);
    const th = THEMES[(currentGame && currentGame.map && currentGame.map.theme) || 'crypt'] || THEMES.crypt;
    const base = dim(isWall ? th.wall : th.floor, lit);
    return new THREE.Color(base[0] + r * 0.03, base[1] + r * 0.03, base[2] + r * 0.02);
  }
  function dim(rgb, lit) { const k = lit ? 1 : 0.32; return [rgb[0] * k, rgb[1] * k, rgb[2] * k]; }

  function buildTiles(game) {
    const map = game.map;
    const vis = new Set(game.visible || []);
    const disc = new Set(game.discovered || []);
    const floorGeo = track(new THREE.BoxGeometry(TILE * 0.98, 0.12, TILE * 0.98));
    const wallGeo = track(new THREE.BoxGeometry(TILE, WALL_H, TILE));
    const matCache = new Map();
    const getMat = (color) => {
      const k = color.getHexString();
      if (!matCache.has(k)) matCache.set(k, track(new THREE.MeshLambertMaterial({ color })));
      return matCache.get(k);
    };
    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        const key = x + ',' + y;
        if (!disc.has(key)) continue;
        const lit = vis.has(key);
        const c = map.rows[y][x];
        const isWall = c === '#';
        const mesh = new THREE.Mesh(isWall ? wallGeo : floorGeo, getMat(floorColor(x, y, lit, isWall)));
        if (isWall) mesh.position.set(x + 0.5, WALL_H / 2, y + 0.5);
        else mesh.position.set(x + 0.5, -0.06, y + 0.5);
        mesh.userData.tile = { x, y };
        world.add(mesh);
      }
    }
    // hover highlight
    const hover = new THREE.Mesh(new THREE.BoxGeometry(TILE * 0.98, 0.04, TILE * 0.98),
      track(new THREE.MeshBasicMaterial({ color: 0xd8cfc0, transparent: true, opacity: 0.35 })));
    hover.visible = false;
    hover.position.y = 0.02;
    world.add(hover);
    return hover;
  }

  function addObjectMesh(o, lit) {
    const g = new THREE.Group();
    const mat = (color) => track(new THREE.MeshLambertMaterial({ color, transparent: !lit, opacity: lit ? 1 : 0.45 }));
    if (o.type === 'door') {
      const m = new THREE.Mesh(track(new THREE.BoxGeometry(0.9, o.open ? 0.12 : 0.75, 0.16)), mat(o.open ? 0x4a3520 : 0x6b4a2a));
      m.position.set(o.x + 0.5, (o.open ? 0.08 : 0.38), o.y + 0.5);
      g.add(m);
      if (o.locked && !o.open) {
        const lock = new THREE.Mesh(track(new THREE.SphereGeometry(0.07, 8, 8)), mat(0xc9a959));
        lock.position.set(o.x + 0.5, 0.45, o.y + 0.72);
        g.add(lock);
      }
    } else if (o.type === 'chest' && !o.looted) {
      const m = new THREE.Mesh(track(new THREE.BoxGeometry(0.55, 0.35, 0.4)), mat(0x7a5a2f));
      m.position.set(o.x + 0.5, 0.2, o.y + 0.5);
      g.add(m);
      const lid = new THREE.Mesh(track(new THREE.BoxGeometry(0.58, 0.1, 0.43)), mat(0x8a6a3a));
      lid.position.set(o.x + 0.5, 0.42, o.y + 0.5);
      g.add(lid);
    } else if (o.id === 'campfire') {
      const m = new THREE.Mesh(track(new THREE.ConeGeometry(0.28, 0.4, 6)), new THREE.MeshBasicMaterial({ color: 0xff9040 }));
      m.position.set(o.x + 0.5, 0.25, o.y + 0.5);
      g.add(m);
      const flame = new THREE.PointLight(0xff9040, 4, 3.5, 2);
      flame.position.set(o.x + 0.5, 0.5, o.y + 0.5);
      g.add(flame);
    } else if (o.id === 'altar') {
      const m = new THREE.Mesh(track(new THREE.BoxGeometry(0.8, 0.5, 0.5)), mat(0x3a2f4a));
      m.position.set(o.x + 0.5, 0.28, o.y + 0.5);
      g.add(m);
    } else if (o.id === 'relic' && !o.taken) {
      const gem = new THREE.Mesh(track(new THREE.OctahedronGeometry(0.18)), new THREE.MeshBasicMaterial({ color: 0x9b8aff }));
      gem.position.set(o.x + 0.5, 0.75, o.y + 0.5);
      g.add(gem);
    } else if (o.type === 'stairs') {
      for (let i = 0; i < 3; i++) {
        const step = new THREE.Mesh(track(new THREE.BoxGeometry(0.9, 0.1, 0.3)), mat(0x555049));
        step.position.set(o.x + 0.5, 0.05 + i * 0.12, o.y + 0.25 + i * 0.25);
        g.add(step);
      }
    } else if (o.type === 'trap') {
      const m = new THREE.Mesh(track(new THREE.BoxGeometry(0.7, 0.03, 0.7)), new THREE.MeshBasicMaterial({ color: 0xb8433a }));
      m.position.set(o.x + 0.5, 0.015, o.y + 0.5);
      g.add(m);
    }
    world.add(g);
  }

  function makeCharacter(ent) {
    const g = new THREE.Group();
    let bodyColor = 0x6b6b6b, headColor = 0xc8a888, emoji = '';
    if (ent.kind === 'player') { bodyColor = 0x8a6d2f; emoji = '🗡️'; }
    else if (ent.kind === 'ally') { bodyColor = 0x3f5c74; emoji = '🏹'; }
    else if (ent.kind === 'npc') { bodyColor = 0x5f3f74; emoji = ent.icon || '🗣️'; }
    else {
      bodyColor = ent.boss ? 0x7a2020 : 0x6b2f2a;
      emoji = ent.boss ? '👹' : { giant_rat: '🐀', skeleton: '💀', zombie: '🧟', goblin: '👺', crypt_hound: '🐕', tomb_warden: '🗿' }[ent.monsterId] || '👺';
    }
    const body = new THREE.Mesh(track(new THREE.CapsuleGeometry(0.22, 0.34, 4, 10)), track(new THREE.MeshLambertMaterial({ color: bodyColor })));
    body.position.y = 0.42;
    g.add(body);
    const head = new THREE.Mesh(track(new THREE.SphereGeometry(0.16, 12, 10)), track(new THREE.MeshLambertMaterial({ color: headColor })));
    head.position.y = 0.82;
    g.add(head);
    const spr = new THREE.Sprite(track(new THREE.SpriteMaterial({ map: emojiTexture(emoji), transparent: true })));
    spr.scale.set(0.5, 0.5, 1);
    spr.position.y = 1.12;
    g.add(spr);
    // hp bar sprite for monsters
    if (ent.kind === 'monster') {
      const bar = makeBar();
      bar.sprite.position.y = 1.0;
      g.add(bar.sprite);
      g.userData.bar = bar;
    }
    if (ent.boss) {
      const tag = new THREE.Sprite(track(new THREE.SpriteMaterial({ map: labelTexture(ent.name + '  ☠ BOSS', '#ff9c8f'), transparent: true })));
      tag.scale.set(2.2, 0.28, 1);
      tag.position.y = 1.55;
      g.add(tag);
    }
    return g;
  }

  function makeBar() {
    const c = document.createElement('canvas');
    c.width = 64; c.height = 6;
    const tex = new THREE.CanvasTexture(c);
    const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
    spr.scale.set(0.8, 0.08, 1);
    const draw = (frac) => {
      const g = c.getContext('2d');
      g.clearRect(0, 0, 64, 6);
      g.fillStyle = 'rgba(0,0,0,0.7)'; g.fillRect(0, 0, 64, 6);
      g.fillStyle = frac > 0.5 ? '#6fa356' : frac > 0.25 ? '#c9a959' : '#b8433a';
      g.fillRect(1, 1, 62 * Math.max(0, frac), 4);
      tex.needsUpdate = true;
    };
    draw(1);
    return { sprite: spr, draw };
  }

  function layoutEntities(game) {
    const vis = new Set(game.visible || []);
    const disc = new Set(game.discovered || []);
    // remove stale
    for (const [id, node] of entityNodes) {
      if (!game.entities.find(e => e.id === id)) {
        world.remove(node.group);
        entityNodes.delete(id);
      }
    }
    game.entities.forEach(e => {
      const key = e.x + ',' + e.y;
      if (!disc.has(key) || (e.alive === false && e.kind !== 'player')) return;
      let node = entityNodes.get(e.id);
      if (!node) {
        node = { group: makeCharacter(e) };
        node.group.position.set(e.x + 0.5, 0, e.y + 0.5);
        node.target = new THREE.Vector3(e.x + 0.5, 0, e.y + 0.5);
        world.add(node.group);
        entityNodes.set(e.id, node);
      }
      node.target.set(e.x + 0.5, 0, e.y + 0.5);
      const dimmed = !vis.has(key) && e.kind !== 'player';
      node.group.visible = !dimmed;
      if (e.kind === 'monster' && node.group.userData.bar && !dimmed) {
        node.group.userData.bar.draw(e.hp / e.hpMax);
      }
      if (opts.isSelected && opts.isSelected(e)) {
        node.group.children.forEach(ch => { if (ch.material && ch.material.color) ch.material.emissive = new THREE.Color(0x443300); });
      }
    });
  }

  function render(game) {
    if (!game) return;
    const th = THEMES[(game.map && game.map.theme) || 'crypt'] || THEMES.crypt;
    scene.background = new THREE.Color(th.bg);
    ambient.color = new THREE.Color(th.ambient);
    hemi.color = new THREE.Color(th.hemi[0]);
    hemi.groundColor = new THREE.Color(th.hemi[1]);
    clearWorld();
    currentGame = game;
    const hover = buildTiles(game);
    // objects
    (game.objects || []).forEach(o => {
      const key = o.x + ',' + o.y;
      if (!(game.discovered || []).includes(key) && !(game.discovered || []).some(d => d === key)) { if (!(game.discovered || new Set()).has?.(key)) { /* arrays */ } }
    });
    (game.objects || []).forEach(o => {
      const key = o.x + ',' + o.y;
      const disc = new Set(game.discovered || []);
      if (!disc.has(key)) return;
      const lit = (game.visible || []).includes(key);
      addObjectMesh(o, lit);
    });
    // keep hover functional
    world.add(hover);
    hoverMesh = hover;
    layoutEntities(game);
    const p = (game.entities || []).find(e => e.kind === 'player');
    if (p) { torch.position.set(p.x + 0.5, 1.6, p.y + 0.5); camTarget.set(p.x + 0.5, 0, p.y + 0.5); }
    resize();
    animateFrom(game);
  }

  let hoverMesh = null;

  function animateFrom(game) {
    // glide entities from their previous rendered tile to the new one
    entityNodes.forEach((node, id) => {
      const ent = game.entities.find(e => e.id === id);
      if (!ent) return;
      const tx = ent.x + 0.5, tz = ent.y + 0.5;
      const dx = tx - node.group.position.x, dz = tz - node.group.position.z;
      if (Math.abs(dx) > 0.02 || Math.abs(dz) > 0.02) {
        node.group.userData.anim = { from: node.group.position.clone(), to: new THREE.Vector3(tx, 0, tz), t0: performance.now(), dur: 260 };
        node.target.set(tx, 0, tz);
      } else {
        node.group.position.set(tx, 0, tz);
      }
    });
  }

  function resize() {
    const w = container.clientWidth || 800, h = container.clientHeight || 560;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    const dist = 8.5 / zoom;
    camera.position.set(camTarget.x, camTarget.y + dist * 0.86, camTarget.z + dist * 0.62);
    camera.lookAt(camTarget);
    camera.updateProjectionMatrix();
  }

  let raf = null;
  function loop(now) {
    raf = requestAnimationFrame(loop);
    entityNodes.forEach(node => {
      const a = node.group.userData.anim;
      if (a) {
        const k = Math.min(1, (performance.now() - a.t0) / a.dur);
        node.group.position.lerpVectors(a.from, a.to, k);
        node.group.position.y = Math.sin(k * Math.PI) * 0.12; // small hop
        if (k >= 1) { node.group.position.copy(a.to); delete node.group.userData.anim; }
      }
    });
    if (hoverMesh && hoverTile) hoverMesh.position.set(hoverTile.x + 0.5, 0.02, hoverTile.y + 0.5);
    camera.position.set(camTarget.x, camTarget.y + (8.5 / zoom) * 0.86, camTarget.z + (8.5 / zoom) * 0.62);
    camera.lookAt(camTarget);
    renderer.render(scene, camera);
  }
  raf = requestAnimationFrame(loop);

  // interaction: raycast floor tiles
  const ray = new THREE.Raycaster();
  function tileFromEvent(ev) {
    const rect = renderer.domElement.getBoundingClientRect();
    const mouse = new THREE.Vector2(
      ((ev.clientX - rect.left) / rect.width) * 2 - 1,
      -((ev.clientY - rect.top) / rect.height) * 2 + 1
    );
    ray.setFromCamera(mouse, camera);
    const hits = ray.intersectObjects(world.children, false);
    for (const h of hits) {
      if (h.object.userData.tile) return h.object.userData.tile;
      // floor-level planes: derive from point
      const x = Math.floor(h.point.x), y = Math.floor(h.point.z);
      if (currentGame && x >= 0 && y >= 0 && x < currentGame.map.width && y < currentGame.map.height) return { x, y };
    }
    return null;
  }
  renderer.domElement.addEventListener('click', ev => {
    const t = tileFromEvent(ev);
    if (t && opts.onTileClick) opts.onTileClick(t.x, t.y);
  });
  renderer.domElement.addEventListener('mousemove', ev => {
    hoverTile = tileFromEvent(ev);
  });
  renderer.domElement.addEventListener('wheel', ev => {
    ev.preventDefault();
    zoom = Math.max(0.55, Math.min(2.2, zoom * (ev.deltaY > 0 ? 0.9 : 1.1)));
  }, { passive: false });

  window.addEventListener('resize', resize);

  function dispose() {
    cancelAnimationFrame(raf);
    window.removeEventListener('resize', resize);
    disposables.forEach(d => { try { d.dispose && d.dispose(); } catch {} });
    renderer.dispose();
    if (renderer.domElement.parentNode) renderer.domElement.parentNode.removeChild(renderer.domElement);
  }

  return { render, dispose, kind: '3d' };
}
