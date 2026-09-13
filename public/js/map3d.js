// map3d.js — 2.5D diorama renderer (Three.js): continuous flagstone floors,
// adjacent cavern bedrock expansion, architectural wall trim, dynamic torchlight flicker,
// tactical movement highlights, and animated 3D target reticle.
// Interface: createMap3D(container, { onTileClick, onTileHover, isSelected, getSelected }) → { render(game), dispose(), tileToScreen(x, y) }

import * as THREE from '/vendor/three.module.js';
import { createCharacterModel, updateModelAnimation } from './models3d.js';

const TILE = 1;
const WALL_H = 0.72;

function hash(x, y) {
  let h = (x * 374761393 + y * 668265263) ^ 0x5bf03635;
  h = (h ^ (h >> 13)) * 1274126177;
  return ((h ^ (h >> 16)) >>> 0) / 4294967295;
}

function emojiTexture(emoji) {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  g.font = '44px serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(emoji, 32, 34);
  return new THREE.CanvasTexture(c);
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

function makeFlagstoneTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#b39c82';
  g.fillRect(0, 0, 128, 128);

  // Interlocking flagstone pavers & mortar lines
  g.strokeStyle = '#423325';
  g.lineWidth = 2.5;
  g.strokeRect(1, 1, 62, 62);
  g.strokeRect(65, 1, 62, 62);
  g.strokeRect(1, 65, 62, 62);
  g.strokeRect(65, 65, 62, 62);

  // Diagonal paver divisions
  g.beginPath();
  g.moveTo(32, 1); g.lineTo(32, 63);
  g.moveTo(96, 65); g.lineTo(96, 127);
  g.stroke();

  // Fine chisel texture & stone grains
  for (let i = 0; i < 280; i++) {
    const px = Math.random() * 128;
    const py = Math.random() * 128;
    g.fillStyle = Math.random() > 0.5 ? 'rgba(0,0,0,0.12)' : 'rgba(255,255,255,0.09)';
    g.fillRect(px, py, 1.6, 1.6);
  }

  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(1, 1);
  return tex;
}

export function createMap3D(container, opts = {}) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0a0806);
  scene.fog = new THREE.FogExp2(0x0a0806, 0.034);

  const camera = new THREE.PerspectiveCamera(46, 1, 0.1, 100);
  let zoom = 1;
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  container.appendChild(renderer.domElement);
  renderer.domElement.style.width = '100%';
  renderer.domElement.style.height = '100%';
  renderer.domElement.style.display = 'block';
  renderer.domElement.style.cursor = 'crosshair';

  const ambient = new THREE.AmbientLight(0x554433, 0.95);
  scene.add(ambient);
  const hemi = new THREE.HemisphereLight(0x886644, 0x0c0a08, 0.55);
  scene.add(hemi);
  const torch = new THREE.PointLight(0xffb066, 18, 10, 1.7);
  scene.add(torch);

  const world = new THREE.Group();
  scene.add(world);

  const disposables = [];
  function track(obj) { disposables.push(obj); return obj; }

  const flagstoneTex = track(makeFlagstoneTexture());

  let hoverTile = null;
  let currentGame = null;
  let reachableTilesSet = new Set();

  const THEMES = {
    crypt: {
      bg: 0x0a0806,
      ambient: 0x554433,
      hemi: [0x886644, 0x0c0a08],
      floor: [0.22, 0.18, 0.15],
      wall: [0.28, 0.23, 0.19],
      cap: [0.34, 0.28, 0.23],
      cavern: [0.11, 0.09, 0.08]
    },
    hills: {
      bg: 0x222818,
      ambient: 0x88806a,
      hemi: [0x9aa878, 0x1a1c12],
      floor: [0.18, 0.23, 0.13],
      wall: [0.30, 0.24, 0.16],
      cap: [0.36, 0.29, 0.20],
      cavern: [0.12, 0.14, 0.09]
    }
  };

  let entityNodes = new Map(); // entId -> { group, target: Vector3 }
  let camTarget = new THREE.Vector3();
  let hoverMesh = null;
  let reticleGroup = null;
  let breadcrumbGroup = null;

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
    return new THREE.Color(base[0] + r * 0.035, base[1] + r * 0.035, base[2] + r * 0.025);
  }

  function capColor(x, y, lit) {
    const r = hash(x * 5 + 2, y * 3 + 4);
    const th = THEMES[(currentGame && currentGame.map && currentGame.map.theme) || 'crypt'] || THEMES.crypt;
    const base = dim(th.cap, lit);
    return new THREE.Color(base[0] + r * 0.03, base[1] + r * 0.03, base[2] + r * 0.02);
  }

  function cavernColor(x, y) {
    const r = hash(x * 11 + 3, y * 17 + 5);
    const th = THEMES[(currentGame && currentGame.map && currentGame.map.theme) || 'crypt'] || THEMES.crypt;
    return new THREE.Color(th.cavern[0] + r * 0.02, th.cavern[1] + r * 0.02, th.cavern[2] + r * 0.015);
  }

  function dim(rgb, lit) {
    const k = lit ? 1 : 0.35;
    return [rgb[0] * k, rgb[1] * k, rgb[2] * k];
  }

  function buildTiles(game) {
    const map = game.map;
    const vis = new Set(game.visible || []);
    const disc = new Set(game.discovered || []);

    // Continuous floor geometry (TILE * 1.002 eliminates void gaps between blocks)
    const floorGeo = track(new THREE.BoxGeometry(TILE * 1.002, 0.12, TILE * 1.002));
    const wallGeo = track(new THREE.BoxGeometry(TILE * 1.002, WALL_H, TILE * 1.002));
    const capGeo = track(new THREE.BoxGeometry(TILE * 1.04, 0.08, TILE * 1.04));

    const matCache = new Map();
    const getMat = (color, textured = false) => {
      const k = color.getHexString() + (textured ? '_tex' : '');
      if (!matCache.has(k)) {
        matCache.set(k, track(new THREE.MeshLambertMaterial({
          color,
          map: textured ? flagstoneTex : null
        })));
      }
      return matCache.get(k);
    };

    // 1. Build Discovered Floor & Walls with Architectural Trim
    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        const key = x + ',' + y;
        if (!disc.has(key)) continue;
        const lit = vis.has(key);
        const c = map.rows[y][x];
        const isWall = c === '#';

        if (isWall) {
          const wallMesh = new THREE.Mesh(wallGeo, getMat(floorColor(x, y, lit, true)));
          wallMesh.position.set(x + 0.5, WALL_H / 2, y + 0.5);
          wallMesh.userData.tile = { x, y };
          world.add(wallMesh);

          // Overhanging architectural capstone trim
          const capMesh = new THREE.Mesh(capGeo, getMat(capColor(x, y, lit)));
          capMesh.position.set(x + 0.5, WALL_H + 0.04, y + 0.5);
          capMesh.userData.tile = { x, y };
          world.add(capMesh);
        } else {
          const floorMesh = new THREE.Mesh(floorGeo, getMat(floorColor(x, y, lit, false), true));
          floorMesh.position.set(x + 0.5, -0.06, y + 0.5);
          floorMesh.userData.tile = { x, y };
          world.add(floorMesh);
        }
      }
    }

    // 2. Adjacent Cavern / Bedrock Expansion:
    // Generate organic perimeter bedrock crags around discovered rooms to eliminate the harsh floating cliff drop-off
    const perimeter = new Set();
    for (const key of disc) {
      const [dx, dy] = key.split(',').map(Number);
      for (let ox = -2; ox <= 2; ox++) {
        for (let oy = -2; oy <= 2; oy++) {
          if (Math.abs(ox) + Math.abs(oy) > 3) continue;
          const nx = dx + ox;
          const ny = dy + oy;
          const nkey = nx + ',' + ny;
          if (!disc.has(nkey) && nx >= -2 && ny >= -2 && nx <= map.width + 1 && ny <= map.height + 1) {
            perimeter.add(nkey);
          }
        }
      }
    }

    for (const pkey of perimeter) {
      const [px, py] = pkey.split(',').map(Number);
      const r = hash(px * 11 + 3, py * 17 + 5);
      const rockH = WALL_H * (0.8 + r * 0.5);
      const rockGeo = track(new THREE.BoxGeometry(TILE * 1.02, rockH, TILE * 1.02));
      const rockMesh = new THREE.Mesh(rockGeo, getMat(cavernColor(px, py)));
      rockMesh.position.set(px + 0.5, rockH / 2 - 0.06, py + 0.5);
      world.add(rockMesh);
    }

    // Subterranean foundation base plinth
    const minX = -3, maxX = map.width + 3;
    const minY = -3, maxY = map.height + 3;
    const baseGeo = track(new THREE.BoxGeometry((maxX - minX) * TILE, 0.45, (maxY - minY) * TILE));
    const baseMesh = new THREE.Mesh(baseGeo, track(new THREE.MeshLambertMaterial({ color: 0x0c0a08 })));
    baseMesh.position.set((minX + maxX) / 2, -0.28, (minY + maxY) / 2);
    world.add(baseMesh);

    // 3. Reachable Movement Overlays
    const reachGeo = track(new THREE.BoxGeometry(TILE * 0.94, 0.015, TILE * 0.94));
    const reachMat = track(new THREE.MeshBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.32 }));
    for (const rkey of reachableTilesSet) {
      if (!disc.has(rkey)) continue;
      const [rx, ry] = rkey.split(',').map(Number);
      if (map.rows[ry] && map.rows[ry][rx] === '#') continue;
      const rMesh = new THREE.Mesh(reachGeo, reachMat);
      rMesh.position.set(rx + 0.5, 0.008, ry + 0.5);
      rMesh.userData.tile = { x: rx, y: ry };
      world.add(rMesh);
    }

    // Hover Highlight mesh
    const hover = new THREE.Mesh(
      track(new THREE.BoxGeometry(TILE * 0.98, 0.035, TILE * 0.98)),
      track(new THREE.MeshBasicMaterial({ color: 0xffd700, transparent: true, opacity: 0.42 }))
    );
    hover.visible = false;
    hover.position.y = 0.02;
    world.add(hover);

    // 3D Target Reticle
    reticleGroup = createTargetReticle();
    world.add(reticleGroup);

    // Breadcrumb path group
    breadcrumbGroup = new THREE.Group();
    world.add(breadcrumbGroup);

    return hover;
  }

  function createTargetReticle() {
    const g = new THREE.Group();
    const ringGeo = track(new THREE.RingGeometry(0.36, 0.44, 24));
    ringGeo.rotateX(-Math.PI / 2);
    const reticleMat = track(new THREE.MeshBasicMaterial({ color: 0xef4444, side: THREE.DoubleSide, transparent: true, opacity: 0.88 }));
    const ring = new THREE.Mesh(ringGeo, reticleMat);
    g.add(ring);

    for (let i = 0; i < 4; i++) {
      const angle = (i * Math.PI) / 2;
      const bracket = new THREE.Mesh(track(new THREE.BoxGeometry(0.06, 0.02, 0.16)), reticleMat);
      bracket.position.set(Math.cos(angle) * 0.45, 0.01, Math.sin(angle) * 0.45);
      bracket.rotation.y = -angle;
      g.add(bracket);
    }
    g.position.y = 1.15;
    g.visible = false;
    return g;
  }

  function updateBreadcrumbTrail(destTile) {
    if (!breadcrumbGroup) return;
    while (breadcrumbGroup.children.length) {
      breadcrumbGroup.remove(breadcrumbGroup.children.pop());
    }
    if (!destTile || !currentGame) return;
    const p = currentGame.entities.find(e => e.kind === 'player');
    if (!p) return;
    const destKey = destTile.x + ',' + destTile.y;
    if (!reachableTilesSet.has(destKey)) return;

    // Simple interpolated path dots
    const steps = Math.max(1, Math.abs(destTile.x - p.x) + Math.abs(destTile.y - p.y));
    const dotGeo = track(new THREE.CylinderGeometry(0.1, 0.1, 0.02, 8));
    const dotMat = track(new THREE.MeshBasicMaterial({ color: 0x67e8f9, transparent: true, opacity: 0.7 }));

    for (let i = 1; i <= steps; i++) {
      const k = i / steps;
      const dotX = p.x + 0.5 + (destTile.x - p.x) * k;
      const dotZ = p.y + 0.5 + (destTile.y - p.y) * k;
      const dot = new THREE.Mesh(dotGeo, dotMat);
      dot.position.set(dotX, 0.015, dotZ);
      breadcrumbGroup.add(dot);
    }
  }

  function addObjectMesh(o, lit) {
    const g = new THREE.Group();
    g.userData.tile = { x: o.x, y: o.y };
    const mat = (color) => track(new THREE.MeshLambertMaterial({ color, transparent: !lit, opacity: lit ? 1 : 0.45 }));
    if (o.type === 'door') {
      const m = new THREE.Mesh(track(new THREE.BoxGeometry(0.92, o.open ? 0.12 : 0.75, 0.16)), mat(o.open ? 0x4a3520 : 0x6b4a2a));
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
    } else if (o.type === 'stairs') {
      for (let i = 0; i < 4; i++) {
        const step = new THREE.Mesh(track(new THREE.BoxGeometry(0.8, 0.06, 0.2)), mat(0x5a544d));
        step.position.set(o.x + 0.5, 0.03 + i * 0.06, o.y + 0.2 + i * 0.2);
        g.add(step);
      }
    } else if (o.type === 'barrel') {
      if (!o.exploded) {
        const b = new THREE.Mesh(track(new THREE.CylinderGeometry(0.28, 0.28, 0.65, 10)), mat(0x7c4f28));
        b.position.set(o.x + 0.5, 0.33, o.y + 0.5);
        g.add(b);
        const ring1 = new THREE.Mesh(track(new THREE.CylinderGeometry(0.29, 0.29, 0.04, 10)), mat(0x2f2f2f));
        ring1.position.set(o.x + 0.5, 0.48, o.y + 0.5);
        g.add(ring1);
        const ring2 = new THREE.Mesh(track(new THREE.CylinderGeometry(0.29, 0.29, 0.04, 10)), mat(0x2f2f2f));
        ring2.position.set(o.x + 0.5, 0.18, o.y + 0.5);
        g.add(ring2);
      } else {
        const rubble = new THREE.Mesh(track(new THREE.BoxGeometry(0.5, 0.06, 0.5)), mat(0x3a2512));
        rubble.position.set(o.x + 0.5, 0.03, o.y + 0.5);
        g.add(rubble);
      }
    } else if (o.type === 'trap') {
      if (o.revealed && !o.disarmed && !o.triggered) {
        const rune = new THREE.Mesh(track(new THREE.RingGeometry(0.2, 0.38, 8)), track(new THREE.MeshBasicMaterial({ color: 0xff4433, side: THREE.DoubleSide })));
        rune.rotation.x = -Math.PI / 2;
        rune.position.set(o.x + 0.5, 0.03, o.y + 0.5);
        g.add(rune);
      }
    } else if (o.type === 'font') {
      const basin = new THREE.Mesh(track(new THREE.CylinderGeometry(0.36, 0.26, 0.35, 10)), mat(0x606a75));
      basin.position.set(o.x + 0.5, 0.18, o.y + 0.5);
      g.add(basin);
      const waterColor = o.used ? 0x2d3748 : (o.fontKind === 'radiant' ? 0xfef08a : (o.fontKind === 'stamina' ? 0x4ade80 : 0x38bdf8));
      const pool = new THREE.Mesh(track(new THREE.CylinderGeometry(0.3, 0.3, 0.02, 10)), track(new THREE.MeshBasicMaterial({ color: waterColor })));
      pool.position.set(o.x + 0.5, 0.36, o.y + 0.5);
      g.add(pool);
      if (!o.used && lit) {
        const fontLight = new THREE.PointLight(0x38bdf8, 2, 3, 2);
        fontLight.position.set(o.x + 0.5, 0.45, o.y + 0.5);
        g.add(fontLight);
      }
    } else if (o.type === 'lever') {
      const base = new THREE.Mesh(track(new THREE.BoxGeometry(0.35, 0.08, 0.35)), mat(0x3d3a37));
      base.position.set(o.x + 0.5, 0.04, o.y + 0.5);
      g.add(base);
      const stick = new THREE.Mesh(track(new THREE.CylinderGeometry(0.03, 0.03, 0.4, 6)), mat(0x8c7853));
      stick.rotation.z = o.pulled ? 0.4 : -0.4;
      stick.position.set(o.x + 0.5 + (o.pulled ? 0.08 : -0.08), 0.22, o.y + 0.5);
      g.add(stick);
      const knob = new THREE.Mesh(track(new THREE.SphereGeometry(0.06, 8, 8)), new THREE.MeshBasicMaterial({ color: o.pulled ? 0x44bb55 : 0xcc4433 }));
      knob.position.set(o.x + 0.5 + (o.pulled ? 0.15 : -0.15), 0.38, o.y + 0.5);
      g.add(knob);
    } else if (o.type === 'spores') {
      if (!o.burst) {
        const pod1 = new THREE.Mesh(track(new THREE.SphereGeometry(0.2, 8, 8)), mat(0x5c8a32));
        pod1.position.set(o.x + 0.5, 0.18, o.y + 0.5);
        g.add(pod1);
        const pod2 = new THREE.Mesh(track(new THREE.SphereGeometry(0.14, 8, 8)), mat(0x7a3e8d));
        pod2.position.set(o.x + 0.62, 0.14, o.y + 0.58);
        g.add(pod2);
        const pod3 = new THREE.Mesh(track(new THREE.SphereGeometry(0.12, 8, 8)), mat(0x4a7a2d));
        pod3.position.set(o.x + 0.4, 0.12, o.y + 0.42);
        g.add(pod3);
      } else {
        const husk = new THREE.Mesh(track(new THREE.CylinderGeometry(0.25, 0.3, 0.04, 8)), mat(0x2d331e));
        husk.position.set(o.x + 0.5, 0.02, o.y + 0.5);
        g.add(husk);
      }
    } else if (o.type === 'hazard') {
      const slime = new THREE.Mesh(track(new THREE.CylinderGeometry(0.42, 0.45, 0.03, 12)), track(new THREE.MeshLambertMaterial({ color: 0x22c55e, transparent: true, opacity: 0.75 })));
      slime.position.set(o.x + 0.5, 0.02, o.y + 0.5);
      g.add(slime);
      const b1 = new THREE.Mesh(track(new THREE.SphereGeometry(0.06, 6, 6)), new THREE.MeshBasicMaterial({ color: 0x86efac }));
      b1.position.set(o.x + 0.4, 0.05, o.y + 0.46);
      g.add(b1);
      const b2 = new THREE.Mesh(track(new THREE.SphereGeometry(0.04, 6, 6)), new THREE.MeshBasicMaterial({ color: 0x86efac }));
      b2.position.set(o.x + 0.58, 0.04, o.y + 0.56);
      g.add(b2);
    }
    world.add(g);
  }

  function layoutEntities(game) {
    const vis = new Set(game.visible || []);
    const disc = new Set(game.discovered || []);
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
        node = { group: createCharacterModel(e, track) };
        node.group.position.set(e.x + 0.5, 0, e.y + 0.5);
        node.target = new THREE.Vector3(e.x + 0.5, 0, e.y + 0.5);
        world.add(node.group);
        entityNodes.set(e.id, node);
      }
      node.target.set(e.x + 0.5, 0, e.y + 0.5);
      node.group.userData.tile = { x: e.x, y: e.y };
      node.group.userData.entityId = e.id;
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
    scene.fog.color = new THREE.Color(th.bg);
    ambient.color = new THREE.Color(th.ambient);
    hemi.color = new THREE.Color(th.hemi[0]);
    hemi.groundColor = new THREE.Color(th.hemi[1]);
    clearWorld();
    currentGame = game;
    reachableTilesSet = new Set(game.reachableTiles || []);

    const hover = buildTiles(game);
    (game.objects || []).forEach(o => {
      const key = o.x + ',' + o.y;
      const disc = new Set(game.discovered || []);
      if (!disc.has(key)) return;
      const lit = (game.visible || []).includes(key);
      addObjectMesh(o, lit);
    });

    world.add(hover);
    hoverMesh = hover;
    layoutEntities(game);

    const p = (game.entities || []).find(e => e.kind === 'player');
    if (p) {
      torch.position.set(p.x + 0.5, 1.4, p.y + 0.5);
      camTarget.set(p.x + 0.5, 0, p.y + 0.5);
    }

    // Update target reticle
    const selected = (opts.getSelected && opts.getSelected()) || (game.selectedTarget);
    if (selected && reticleGroup) {
      reticleGroup.position.set(selected.x + 0.5, 1.15, selected.y + 0.5);
      reticleGroup.visible = true;
    } else if (reticleGroup) {
      reticleGroup.visible = false;
    }

    resize();
    animateFrom(game);
  }

  function findTilePath(sx, sy, tx, ty, map) {
    if (sx === tx && sy === ty) return [{ x: tx + 0.5, z: ty + 0.5 }];
    if (!map || !map.rows) return [{ x: tx + 0.5, z: ty + 0.5 }];

    const queue = [{ x: sx, y: sy, path: [] }];
    const visited = new Set([`${sx},${sy}`]);
    let stepCount = 0;

    while (queue.length > 0 && stepCount++ < 350) {
      const cur = queue.shift();
      if (cur.x === tx && cur.y === ty) {
        const fullPath = [...cur.path, { x: tx, y: ty }];
        return fullPath.map(pt => ({ x: pt.x + 0.5, z: pt.y + 0.5 }));
      }
      // Orthogonal first, then diagonals
      const dirs = [[0, 1], [1, 0], [0, -1], [-1, 0], [1, 1], [-1, 1], [1, -1], [-1, -1]];
      for (const [dx, dy] of dirs) {
        const nx = cur.x + dx, ny = cur.y + dy;
        const key = `${nx},${ny}`;
        if (visited.has(key)) continue;
        if (nx < 0 || ny < 0 || nx >= map.width || ny >= map.height) continue;
        if (map.rows[ny] && map.rows[ny][nx] === '#') continue;
        visited.add(key);
        queue.push({ x: nx, y: ny, path: [...cur.path, { x: nx, y: ny }] });
      }
    }
    return [{ x: tx + 0.5, z: ty + 0.5 }];
  }

  function animateFrom(game) {
    entityNodes.forEach((node, id) => {
      const ent = game.entities.find(e => e.id === id);
      if (!ent) return;
      const tx = ent.x + 0.5, tz = ent.y + 0.5;
      const curX = node.group.position.x;
      const curZ = node.group.position.z;
      const dist = Math.hypot(tx - curX, tz - curZ);

      if (dist > 0.08) {
        const sx = Math.floor(curX);
        const sy = Math.floor(curZ);
        const waypoints = findTilePath(sx, sy, ent.x, ent.y, game.map);
        node.group.userData.anim = {
          waypoints,
          currentWpIndex: 0,
          speed: 4.6
        };
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
  let lastTime = performance.now();
  function loop(now) {
    raf = requestAnimationFrame(loop);
    const delta = Math.min(0.08, Math.max(0.001, (now - lastTime) / 1000));
    lastTime = now;

    // Reticle animation
    if (reticleGroup && reticleGroup.visible) {
      reticleGroup.rotation.y = now * 0.0028;
      reticleGroup.position.y = 1.15 + Math.sin(now * 0.006) * 0.05;
    }

    // Animate character models & walk cycles
    entityNodes.forEach(node => {
      updateModelAnimation(node, now, delta);
    });

    // Dynamic torchlight flicker & smooth camera tracking on player
    const p = currentGame && currentGame.entities && currentGame.entities.find(e => e.kind === 'player');
    const playerNode = p ? entityNodes.get(p.id) : null;
    if (playerNode) {
      const px = playerNode.group.position.x;
      const pz = playerNode.group.position.z;
      camTarget.x += (px - camTarget.x) * Math.min(1, delta * 6.5);
      camTarget.z += (pz - camTarget.z) * Math.min(1, delta * 6.5);

      const flicker = Math.sin(now * 0.007) * 1.8 + Math.cos(now * 0.015) * 1.1;
      torch.intensity = Math.max(14, Math.min(23, 18.5 + flicker));
      torch.position.set(
        px + Math.sin(now * 0.009) * 0.03,
        1.4 + Math.cos(now * 0.011) * 0.02,
        pz + Math.cos(now * 0.008) * 0.03
      );
    }

    if (hoverMesh && hoverTile) {
      hoverMesh.position.set(hoverTile.x + 0.5, 0.02, hoverTile.y + 0.5);
      hoverMesh.visible = true;
    } else if (hoverMesh) {
      hoverMesh.visible = false;
    }

    camera.position.set(camTarget.x, camTarget.y + (8.5 / zoom) * 0.86, camTarget.z + (8.5 / zoom) * 0.62);
    camera.lookAt(camTarget);
    renderer.render(scene, camera);
  }
  raf = requestAnimationFrame(loop);

  const ray = new THREE.Raycaster();
  function tileFromEvent(ev) {
    const rect = renderer.domElement.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    const mouse = new THREE.Vector2(
      ((ev.clientX - rect.left) / rect.width) * 2 - 1,
      -((ev.clientY - rect.top) / rect.height) * 2 + 1
    );
    ray.setFromCamera(mouse, camera);
    const hits = ray.intersectObjects(world.children, true);
    for (const h of hits) {
      let cur = h.object;
      while (cur && cur !== world) {
        if (cur.userData && cur.userData.tile) return cur.userData.tile;
        cur = cur.parent;
      }
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
    const t = tileFromEvent(ev);
    hoverTile = t;
    updateBreadcrumbTrail(t);
    if (opts.onTileHover) opts.onTileHover(t);
  });

  renderer.domElement.addEventListener('mouseleave', () => {
    hoverTile = null;
    updateBreadcrumbTrail(null);
    if (opts.onTileHover) opts.onTileHover(null);
  });

  renderer.domElement.addEventListener('wheel', ev => {
    ev.preventDefault();
    zoom = Math.max(0.55, Math.min(2.2, zoom * (ev.deltaY > 0 ? 0.9 : 1.1)));
  }, { passive: false });

  window.addEventListener('resize', resize);

  function tileToScreen(x, y) {
    const v = new THREE.Vector3(x + 0.5, 0.6, y + 0.5);
    v.project(camera);
    const rect = renderer.domElement.getBoundingClientRect();
    return {
      x: (v.x * 0.5 + 0.5) * rect.width,
      y: (-(v.y * 0.5) + 0.5) * rect.height
    };
  }

  function dispose() {
    if (raf) cancelAnimationFrame(raf);
    window.removeEventListener('resize', resize);
    if (renderer.domElement && renderer.domElement.parentNode) {
      renderer.domElement.parentNode.removeChild(renderer.domElement);
    }
    renderer.dispose();
    for (const d of disposables) {
      if (d && typeof d.dispose === 'function') d.dispose();
    }
  }

  return { render, dispose, kind: '3d', tileToScreen };
}
