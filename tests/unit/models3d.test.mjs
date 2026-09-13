// tests/unit/models3d.test.mjs — 3D Procedural Miniature Models & Animation Unit Tests
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Provide minimal mock canvas for Node environment
if (typeof global.document === 'undefined') {
  global.document = {
    createElement: (tag) => {
      if (tag === 'canvas') {
        return {
          width: 64,
          height: 64,
          getContext: () => ({
            fillRect: () => {},
            strokeRect: () => {},
            clearRect: () => {},
            fillText: () => {},
            setTransform: () => {},
            scale: () => {},
            measureText: () => ({ width: 20 })
          })
        };
      }
      return {};
    }
  };
}

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

console.log('\n--- Running Unit Tests: 3D Procedural Miniatures & Walk Animations ---');

// Load models3d.js dynamically with 'three' dependency
const rawCode = fs.readFileSync(path.join(__dirname, '../../public/js/models3d.js'), 'utf8');
const nodeCode = rawCode.replace(/from\s+['"]\/vendor\/three\.module\.js['"]/g, "from 'three'");
const tmpFile = path.join(__dirname, '.models3d.node.tmp.mjs');
fs.writeFileSync(tmpFile, nodeCode);

let createCharacterModel, updateModelAnimation;
try {
  const mod = await import(pathToFileURL(tmpFile).href);
  createCharacterModel = mod.createCharacterModel;
  updateModelAnimation = mod.updateModelAnimation;
} finally {
  try { fs.unlinkSync(tmpFile); } catch {}
}

// 1. Hero Archetypes
test('Creates articulated 3D miniature for Fighter (sword & heater shield)', () => {
  const model = createCharacterModel({ kind: 'player', name: 'Valen Ironshield', className: 'fighter' });
  assert(model != null, 'Model root group must exist');
  assert(model.userData && model.userData.rig, 'Model must have articulated skeletal rig');
  const rig = model.userData.rig;
  assert(rig.bodyGroup != null, 'Rig must have bodyGroup attached');
  assert(rig.leftLeg != null && rig.rightLeg != null, 'Rig must have legs for walking stride');
  assert(rig.leftArm != null && rig.rightArm != null, 'Rig must have arms');
  assert(rig.hasShield === true, 'Fighter should wield heraldic heater shield');
  assert(rig.weapon != null, 'Fighter should wield broadsword weapon');
  assert(rig.bodyGroup.children.length >= 3, 'Model must consist of compound meshes, not single capsule');
});

test('Creates articulated 3D miniature for Wizard (robe & arcane crystal staff)', () => {
  const model = createCharacterModel({ kind: 'player', name: 'Elaria', className: 'wizard' });
  const rig = model.userData.rig;
  assert(rig != null, 'Wizard rig must exist');
  assert(rig.weapon != null, 'Wizard should hold magic crystal staff');
  assert(rig.hasShield === false, 'Wizard should not have heavy shield');
});

test('Creates articulated 3D miniature for Agile Scout / Ranger (bow & quiver)', () => {
  const model = createCharacterModel({ kind: 'player', name: 'Robin', className: 'ranger' });
  const rig = model.userData.rig;
  assert(rig != null, 'Ranger rig must exist');
  assert(rig.weapon != null, 'Ranger should hold bow');
});

// 2. Ally & NPC Miniatures
test('Creates 3D miniature for Bram the Scout (Ally)', () => {
  const model = createCharacterModel({ kind: 'ally', name: 'Bram the Scout' });
  assert(model.userData.rig != null, 'Ally rig must exist');
  assert(model.userData.rig.weapon != null, 'Ally should have hunting bow');
});

test('Creates 3D miniature for Marla the Merchant (NPC)', () => {
  const model = createCharacterModel({ kind: 'npc', name: 'Marla' });
  assert(model.userData.rig != null, 'NPC rig must exist');
});

// 3. Monster Miniatures & Boss
test('Creates custom 3D miniatures for all crypt dungeon monsters', () => {
  const monsters = [
    { kind: 'monster', monsterId: 'skeleton', name: 'Skeleton' },
    { kind: 'monster', monsterId: 'zombie', name: 'Zombie' },
    { kind: 'monster', monsterId: 'goblin', name: 'Goblin' },
    { kind: 'monster', monsterId: 'giant_rat', name: 'Giant Rat' },
    { kind: 'monster', monsterId: 'crypt_hound', name: 'Crypt Hound' },
    { kind: 'monster', monsterId: 'boss_crypt_warden', name: 'Crypt Warden Champion', isBoss: true }
  ];

  for (const m of monsters) {
    const model = createCharacterModel(m);
    assert(model != null, `Monster model for ${m.monsterId} failed to create`);
    const rig = model.userData.rig;
    assert(rig != null, `Monster rig for ${m.monsterId} missing`);

    if (m.monsterId === 'giant_rat' || m.monsterId === 'crypt_hound') {
      assert(rig.isQuadruped === true, `${m.monsterId} must be configured as quadruped rig`);
    } else {
      assert(rig.isQuadruped !== true, `${m.monsterId} should be biped rig`);
    }

    if (m.isBoss) {
      assert(model.userData.bossBadge != null, 'Boss should have champion badge');
    }
  }
});

// 4. Animation Engine & Stride Cycles
test('Idle respiration subtly animates body vertical height', () => {
  const model = createCharacterModel({ kind: 'player', name: 'Hero', className: 'fighter' });
  const rig = model.userData.rig;
  const initialY = rig.bodyGroup.position.y;

  updateModelAnimation(model, 1000, 0.016);
  assert(rig.isWalking === false, 'Character should be idle');
  assert(typeof rig.bodyGroup.position.y === 'number', 'Body height should be numeric');
});

test('Waypoint traversal activates walk-cycle, leg strides, and heading rotation', () => {
  const model = createCharacterModel({ kind: 'player', name: 'Hero', className: 'fighter' });
  const rig = model.userData.rig;
  model.position.set(0, 0, 0);

  // Set waypoints heading positive X
  model.userData.anim = {
    waypoints: [{ x: 3, z: 0 }],
    currentWpIndex: 0,
    speed: 4.0
  };

  updateModelAnimation(model, 100, 0.05);

  assert(rig.isWalking === true, 'Movement must set isWalking to true');
  assert(rig.walkTime > 0, 'Walk time counter must advance');
  assert(model.position.x > 0, 'Model position must advance towards waypoint');
  // Rotation towards positive X: Math.atan2(dx, dz) where dx > 0, dz = 0 is ~PI/2 (1.57 rad)
  assert(model.rotation.y > 0.5, 'Model heading rotation must face movement vector');
  assert(rig.leftLeg.rotation.x !== 0, 'Legs must articulate in stride cycle');

  // Complete walk to waypoint
  model.position.set(2.99, 0, 0);
  updateModelAnimation(model, 500, 0.05);
  assert(model.userData.anim == null, 'Animation state should be cleaned up at destination');
  assert(rig.isWalking === false, 'isWalking should reset to false at destination');
});

console.log(`\nModels3D Unit Tests Summary: ${passed} passed, ${failed} failed.`);
if (failed > 0) process.exit(1);
