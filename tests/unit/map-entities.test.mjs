// tests/unit/map-entities.test.mjs — Board Visibility & Camera Math Unit Tests
// Covers the two rules the tactical view keeps getting wrong: slain/fled creatures must
// leave the board, and the camera must glide towards the hero instead of snapping.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (!condition) {
    console.error(`  ❌ FAILED: ${message}`);
    failed++;
    throw new Error(message);
  }
  passed++;
}

function test(name, fn) {
  try {
    fn();
    console.log(`  ✔ PASS: ${name}`);
  } catch (err) {
    // Handled in assert
  }
}

console.log('\n--- Running Unit Tests: Map Board Visibility & Camera ---');

// The helpers are dependency-free; copy to a .mjs so Node treats them as ES modules.
const src = fs.readFileSync(path.join(__dirname, '../../public/js/entity-visibility.js'), 'utf8');
const tmpFile = path.join(__dirname, '.entity-visibility.node.tmp.mjs');
fs.writeFileSync(tmpFile, src);
let mod;
try {
  mod = await import(pathToFileURL(tmpFile).href);
} finally {
  try { fs.unlinkSync(tmpFile); } catch {}
}
const { isEntityOnBoard, boardEntities, stepCameraTowards, clampToMap } = mod;

test('A living creature stands on the board', () => {
  assert(isEntityOnBoard({ id: 'm1', kind: 'monster', alive: true }) === true, 'Living monster is on the board');
  assert(isEntityOnBoard({ id: 'a1', kind: 'ally', alive: true }) === true, 'Living ally is on the board');
});

test('Slain creatures leave the board (regression: corpses stayed in the 3D scene)', () => {
  assert(isEntityOnBoard({ id: 'm1', kind: 'monster', alive: false }) === false, 'Dead monster is off the board');
  assert(isEntityOnBoard({ id: 'a1', kind: 'ally', alive: false }) === false, 'Dead ally is off the board');
});

test('Creatures that fled leave the board', () => {
  assert(isEntityOnBoard({ id: 'm1', kind: 'monster', alive: true, fled: true }) === false, 'Fled monster is off the board');
});

test('The hero never leaves the board — not even unconscious or dying', () => {
  assert(isEntityOnBoard({ id: 'player', kind: 'player', alive: true }) === true, 'Conscious hero is on the board');
  assert(isEntityOnBoard({ id: 'player', kind: 'player', alive: false }) === true, 'Downed hero stays on the board');
  assert(isEntityOnBoard({ id: 'player', kind: 'player', alive: false, fled: true }) === true, 'The hero is never hidden by the fled flag');
});

test('Missing entities are simply not drawn', () => {
  assert(isEntityOnBoard(null) === false, 'null is off the board');
  assert(isEntityOnBoard(undefined) === false, 'undefined is off the board');
});

test('boardEntities filters a mixed roster', () => {
  const game = {
    entities: [
      { id: 'player', kind: 'player', alive: true },
      { id: 'g1', kind: 'monster', alive: true },
      { id: 'g2', kind: 'monster', alive: false },
      { id: 'g3', kind: 'monster', alive: true, fled: true },
      { id: 'bram', kind: 'ally', alive: true },
      { id: 'marla', kind: 'npc', alive: true }
    ]
  };
  const ids = boardEntities(game).map(e => e.id);
  assert(ids.length === 4, `Expected 4 board entities, got ${ids.length} (${ids.join(',')})`);
  assert(!ids.includes('g2') && !ids.includes('g3'), 'The slain and the fled are filtered out');
  assert(ids.includes('player') && ids.includes('g1') && ids.includes('bram') && ids.includes('marla'), 'Everyone alive stays');
  assert(boardEntities({}).length === 0, 'A game without entities yields an empty board');
});

test('map3d actually removes nodes for entities that left the board', () => {
  const source = fs.readFileSync(path.join(__dirname, '../../public/js/map3d.js'), 'utf8');
  assert(/import\s*\{[^}]*isEntityOnBoard[^}]*\}\s*from\s*'\.\/entity-visibility\.js'/.test(source),
    'map3d.js imports the shared board rule');
  const cleanup = source.slice(source.indexOf('function layoutEntities'), source.indexOf('function buildExitBeacon'));
  assert(/!ent\s*\|\|\s*!isEntityOnBoard\(ent\)/.test(cleanup),
    'layoutEntities drops nodes for entities that are gone or slain');
  assert(/entitiesGroup\.remove\(node\.group\)/.test(cleanup), 'The dropped node is removed from the scene graph');
});

test('map3d only snaps the camera when the board changes under the hero', () => {
  const source = fs.readFileSync(path.join(__dirname, '../../public/js/map3d.js'), 'utf8');
  const render = source.slice(source.indexOf('function render(game)'), source.indexOf('function findTilePath'));
  assert(/camTarget\.set\(p\.x \+ 0\.5/.test(render), 'render() still knows how to snap the camera');
  assert(/if \(!cameraReady \|\| mapKey !== lastMapKey \|\| jumped\)/.test(render),
    'the snap is guarded — a normal frame must not teleport the view onto the hero tile');
  const loop = source.slice(source.indexOf('function loop(now)'), source.indexOf('const ray = new THREE.Raycaster()'));
  assert(/stepCameraTowards\(camTarget/.test(loop) && /if \(following\)/.test(loop),
    'the frame loop glides the camera towards the hero only while the binding is on');
});

test('The camera walks towards its target instead of teleporting', () => {
  const from = { x: 0, z: 0 };
  const to = { x: 10, z: 0 };
  const frame = stepCameraTowards(from, to, 1 / 60, 5.5);
  const travelled = frame.x - from.x;
  assert(travelled > 0, 'The camera moves towards the hero');
  assert(travelled < 2.5, `One 60fps frame must not cover a quarter of the distance (moved ${travelled.toFixed(2)})`);
  assert(frame.x === 0 + travelled, 'The z axis is untouched when the hero does not move in z');
});

test('Camera smoothing is frame-rate independent and never overshoots', () => {
  const to = { x: 4, z: 0 };
  const slow = stepCameraTowards({ x: 0, z: 0 }, to, 1 / 120, 5.5);
  const fast = stepCameraTowards({ x: 0, z: 0 }, to, 1 / 30, 5.5);
  assert(fast.x > slow.x, 'A longer frame moves further');
  const huge = stepCameraTowards({ x: 0, z: 0 }, to, 5, 5.5);
  assert(Math.abs(huge.x - 4) < 1e-9, `A huge delta clamps to the target, got ${huge.x}`);
  const stalled = stepCameraTowards({ x: 1, z: 1 }, to, 1 / 60, 0);
  assert(stalled.x === 1 && stalled.z === 1, 'Rate 0 freezes the camera (free-look mode)');
  assert(stepCameraTowards({ x: 0, z: 0 }, to, 0, 5.5).x === 0, 'No time passes, no movement');
});

test('A released camera is never panned off the map', () => {
  const map = { width: 34, height: 24 };
  const inside = clampToMap(10, 8, map);
  assert(inside.x === 10 && inside.z === 8, 'An in-bounds centre is untouched');
  const out = clampToMap(-50, 500, map);
  // with the default 1.5 margin the centre may rest one tile outside the border, so
  // edge tiles stay on screen instead of hugging the viewport edge
  assert(out.x === -1, `x stops one tile past the left edge, got ${out.x}`);
  assert(out.z === map.height + 1, `z stops one tile past the bottom edge, got ${out.z}`);
  const tight = clampToMap(-50, 500, map, 0);
  assert(tight.x === 0.5 && tight.z === 23.5, `Without margin the centre stops on the border tile, got ${tight.x},${tight.z}`);
  const noMap = clampToMap(7, 7, null);
  assert(noMap.x === 7 && noMap.z === 7, 'Without a map the centre passes through');
});

console.log(`\nMap & Camera Unit Tests Summary: ${passed} passed, ${failed} failed.`);
if (failed > 0) process.exit(1);
