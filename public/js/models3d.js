// models3d.js — Articulated Procedural 3D Miniature Rigs (Three.js)
// Generates distinct 3D miniature models for heroes, companions, and monsters
// with anatomical limbs, armor, weapons, and walk-cycle skeletal animation.

import * as THREE from '/vendor/three.module.js';

function createMat(color, opts = {}) {
  return new THREE.MeshLambertMaterial({ color, ...opts });
}

export function createCharacterModel(ent, track = (o) => o) {
  const root = new THREE.Group();
  const bodyGroup = new THREE.Group();
  root.add(bodyGroup);

  const kind = ent.kind || 'monster';
  const role = ent.role || '';
  const monsterId = ent.monsterId || '';
  const isBoss = !!(ent.boss || ent.isBoss || ent.role === 'boss');

  const rig = {
    bodyGroup,
    torso: null,
    head: null,
    leftLeg: null,
    rightLeg: null,
    leftArm: null,
    rightArm: null,
    weapon: null,
    shield: null,
    isWalking: false,
    walkTime: 0,
    hasShield: false,
    isQuadruped: false
  };

  if (kind === 'player') {
    buildPlayerMiniature(bodyGroup, ent, rig, track);
  } else if (kind === 'ally') {
    buildAllyMiniature(bodyGroup, ent, rig, track);
  } else if (kind === 'npc') {
    buildNpcMiniature(bodyGroup, ent, rig, track);
  } else {
    // Monster species
    if (monsterId === 'young_fire_dragon' || (isBoss && ent.name && ent.name.toLowerCase().includes('dragon'))) {
      buildDragonMiniature(bodyGroup, ent, rig, track);
    } else if (monsterId === 'giant_spider') {
      buildSpiderMiniature(bodyGroup, ent, rig, track);
    } else if (monsterId === 'green_slime') {
      buildSlimeMiniature(bodyGroup, ent, rig, track);
    } else if (monsterId === 'fire_elemental') {
      buildFireElementalMiniature(bodyGroup, ent, rig, track);
    } else if (monsterId === 'animated_armor') {
      buildAnimatedArmorMiniature(bodyGroup, ent, rig, track);
    } else if (isBoss) {
      buildBossMiniature(bodyGroup, ent, rig, track);
    } else if (monsterId === 'skeleton') {
      buildSkeletonMiniature(bodyGroup, ent, rig, track);
    } else if (monsterId === 'zombie') {
      buildZombieMiniature(bodyGroup, ent, rig, track);
    } else if (monsterId === 'goblin') {
      buildGoblinMiniature(bodyGroup, ent, rig, track);
    } else if (monsterId === 'giant_rat') {
      buildGiantRatMiniature(bodyGroup, ent, rig, track);
    } else if (monsterId === 'crypt_hound') {
      buildCryptHoundMiniature(bodyGroup, ent, rig, track);
    } else {
      buildDefaultMonsterMiniature(bodyGroup, ent, rig, track);
    }
  }

  // Floating HP bar for monsters
  const isDragon = monsterId === 'young_fire_dragon' || (isBoss && ent.name && ent.name.toLowerCase().includes('dragon'));
  const isElite = !!(ent.isElite) && !isBoss;
  if (kind === 'monster') {
    const bar = makeHpBar();
    bar.sprite.position.y = isDragon ? 2.4 : (isBoss ? 1.9 : (isElite ? 1.6 : 1.35));
    root.add(bar.sprite);
    root.userData.bar = bar;
  }

  if (isBoss) {
    const bossTag = makeBossBadge(ent.name);
    bossTag.position.y = isDragon ? 2.65 : 2.1;
    root.add(bossTag);
    root.userData.bossBadge = bossTag;
  }

  // Elite monster: scale up + add colored badge + aura light
  if (isElite) {
    root.scale.set(1.15, 1.15, 1.15);
    const affixColor = (ent.affix && ent.affix.color) || '#f59e0b';
    const eliteBadge = makeEliteBadge(ent.name, affixColor);
    eliteBadge.position.y = 1.75;
    root.add(eliteBadge);
    root.userData.eliteBadge = eliteBadge;
    // Glowing aura point light in affix color
    const lightColor = (ent.affix && ent.affix.lightColor) || 0xf59e0b;
    const auraLight = new THREE.PointLight(lightColor, 1.2, 3.5, 2);
    auraLight.position.set(0, 0.5, 0);
    root.add(auraLight);
    root.userData.auraLight = auraLight;
  }

  root.userData.rig = rig;
  return root;
}

// ==========================================================================
// 1. HERO MINIATURE (Warrior / Paladin / Mage / Rogue)
// ==========================================================================
function buildPlayerMiniature(g, ent, rig, track) {
  const cls = ent.className || 'fighter';
  const isCaster = ['wizard', 'sorcerer', 'warlock', 'cleric'].includes(cls);
  const isAgile = ['rogue', 'ranger', 'monk'].includes(cls);

  const armorColor = isCaster ? 0x3b2d54 : isAgile ? 0x423122 : 0x717c88;
  const clothColor = isCaster ? 0x63428f : isAgile ? 0x243c22 : 0xa62626;
  const skinColor = 0xc9a078;

  // Legs with boots
  rig.leftLeg = createLegGroup(armorColor, 0x1f1915, track);
  rig.leftLeg.position.set(-0.11, 0.32, 0);
  g.add(rig.leftLeg);

  rig.rightLeg = createLegGroup(armorColor, 0x1f1915, track);
  rig.rightLeg.position.set(0.11, 0.32, 0);
  g.add(rig.rightLeg);

  // Torso / Chest Cuirass
  const torso = track(new THREE.Mesh(
    track(new THREE.BoxGeometry(0.28, 0.32, 0.18)),
    track(createMat(armorColor))
  ));
  torso.position.y = 0.48;
  g.add(torso);
  rig.torso = torso;

  // Cloth Tabard / Surcoat
  const tabard = track(new THREE.Mesh(
    track(new THREE.BoxGeometry(0.18, 0.34, 0.19)),
    track(createMat(clothColor))
  ));
  tabard.position.y = 0.48;
  g.add(tabard);

  // Shoulder Pauldrons
  const leftPauldron = track(new THREE.Mesh(track(new THREE.SphereGeometry(0.09, 8, 8)), track(createMat(0x8fa0b0))));
  leftPauldron.position.set(-0.18, 0.62, 0);
  g.add(leftPauldron);

  const rightPauldron = track(new THREE.Mesh(track(new THREE.SphereGeometry(0.09, 8, 8)), track(createMat(0x8fa0b0))));
  rightPauldron.position.set(0.18, 0.62, 0);
  g.add(rightPauldron);

  // Head & Helmet / Cowl
  const headGroup = new THREE.Group();
  headGroup.position.y = 0.74;
  g.add(headGroup);
  rig.head = headGroup;

  const face = track(new THREE.Mesh(track(new THREE.SphereGeometry(0.13, 10, 10)), track(createMat(skinColor))));
  headGroup.add(face);

  if (isCaster) {
    // Pointed Wizard Hat
    const brim = track(new THREE.Mesh(track(new THREE.CylinderGeometry(0.22, 0.22, 0.02, 12)), track(createMat(0x271e3d))));
    brim.position.y = 0.1;
    headGroup.add(brim);
    const cone = track(new THREE.Mesh(track(new THREE.ConeGeometry(0.15, 0.32, 8)), track(createMat(0x271e3d))));
    cone.position.set(0, 0.24, -0.02);
    cone.rotation.x = -0.15;
    headGroup.add(cone);
  } else if (isAgile) {
    // Leather Hood
    const hood = track(new THREE.Mesh(track(new THREE.SphereGeometry(0.145, 10, 10, 0, Math.PI * 2, 0, Math.PI * 0.7)), track(createMat(clothColor))));
    hood.position.set(0, 0.02, -0.02);
    headGroup.add(hood);
  } else {
    // Steel Greathelm with eye slit and crest
    const helm = track(new THREE.Mesh(track(new THREE.BoxGeometry(0.24, 0.24, 0.24)), track(createMat(0x94a3b8))));
    helm.position.y = 0.03;
    headGroup.add(helm);
    const visor = track(new THREE.Mesh(track(new THREE.BoxGeometry(0.25, 0.04, 0.12)), track(createMat(0x0f172a))));
    visor.position.set(0, 0.02, 0.08);
    headGroup.add(visor);
    const plume = track(new THREE.Mesh(track(new THREE.BoxGeometry(0.04, 0.14, 0.22)), track(createMat(clothColor))));
    plume.position.set(0, 0.18, 0);
    headGroup.add(plume);
  }

  // Left Arm + Shield / Bow
  rig.leftArm = createArmGroup(armorColor, skinColor, track);
  rig.leftArm.position.set(-0.19, 0.60, 0);
  g.add(rig.leftArm);

  if (!isCaster && !isAgile) {
    // Knight Heater Shield
    const shield = createHeaterShield(track);
    shield.position.set(0, -0.22, 0.08);
    rig.leftArm.add(shield);
    rig.shield = shield;
    rig.hasShield = true;
  }

  // Right Arm + Weapon
  rig.rightArm = createArmGroup(armorColor, skinColor, track);
  rig.rightArm.position.set(0.19, 0.60, 0);
  g.add(rig.rightArm);

  if (isCaster) {
    // Arcane Crystal Staff
    const staff = createMagicStaff(track);
    staff.position.set(0, -0.15, 0.15);
    staff.rotation.x = 0.2;
    rig.rightArm.add(staff);
    rig.weapon = staff;
  } else if (isAgile) {
    // Curved Recurve Bow / Dagger
    const bow = createHuntingBow(track);
    bow.position.set(0, -0.2, 0.1);
    rig.rightArm.add(bow);
    rig.weapon = bow;
  } else {
    // Steel Broadsword
    const sword = createBroadsword(track);
    sword.position.set(0, -0.18, 0.14);
    sword.rotation.x = 0.3;
    rig.rightArm.add(sword);
    rig.weapon = sword;
  }
}

// ==========================================================================
// 2. COMPANION ALLY MINIATURE (Bram the Scout)
// ==========================================================================
function buildAllyMiniature(g, ent, rig, track) {
  const armorColor = 0x3d4a2b; // forest ranger green
  const skinColor = 0xd2a679;

  rig.leftLeg = createLegGroup(0x2d3a22, 0x1f1915, track);
  rig.leftLeg.position.set(-0.1, 0.32, 0);
  g.add(rig.leftLeg);

  rig.rightLeg = createLegGroup(0x2d3a22, 0x1f1915, track);
  rig.rightLeg.position.set(0.1, 0.32, 0);
  g.add(rig.rightLeg);

  // Leather Jerkin
  const torso = track(new THREE.Mesh(track(new THREE.BoxGeometry(0.26, 0.30, 0.18)), track(createMat(armorColor))));
  torso.position.y = 0.47;
  g.add(torso);
  rig.torso = torso;

  // Quiver on Back
  const quiver = track(new THREE.Mesh(track(new THREE.CylinderGeometry(0.06, 0.05, 0.38, 8)), track(createMat(0x4a3219))));
  quiver.position.set(0.08, 0.52, -0.12);
  quiver.rotation.z = -0.3;
  g.add(quiver);

  // Head & Archer Hood
  const headGroup = new THREE.Group();
  headGroup.position.y = 0.72;
  g.add(headGroup);
  rig.head = headGroup;

  const face = track(new THREE.Mesh(track(new THREE.SphereGeometry(0.12, 10, 10)), track(createMat(skinColor))));
  headGroup.add(face);
  const hood = track(new THREE.Mesh(track(new THREE.SphereGeometry(0.14, 10, 10)), track(createMat(0x24331e))));
  hood.position.set(0, 0.02, -0.02);
  headGroup.add(hood);

  // Left Arm (holding bow)
  rig.leftArm = createArmGroup(armorColor, skinColor, track);
  rig.leftArm.position.set(-0.17, 0.58, 0);
  g.add(rig.leftArm);

  const bow = createHuntingBow(track);
  bow.position.set(0, -0.22, 0.08);
  rig.leftArm.add(bow);
  rig.weapon = bow;

  // Right Arm (drawing string)
  rig.rightArm = createArmGroup(armorColor, skinColor, track);
  rig.rightArm.position.set(0.17, 0.58, 0);
  g.add(rig.rightArm);
}

// ==========================================================================
// 3. NPC MINIATURE (Trader / Questgiver)
// ==========================================================================
function buildNpcMiniature(g, ent, rig, track) {
  const robeColor = 0x5c3d2e;
  const skinColor = 0xcca380;

  rig.leftLeg = createLegGroup(0x2b1e16, 0x1a120d, track);
  rig.leftLeg.position.set(-0.1, 0.32, 0);
  g.add(rig.leftLeg);

  rig.rightLeg = createLegGroup(0x2b1e16, 0x1a120d, track);
  rig.rightLeg.position.set(0.1, 0.32, 0);
  g.add(rig.rightLeg);

  const torso = track(new THREE.Mesh(track(new THREE.BoxGeometry(0.28, 0.34, 0.22)), track(createMat(robeColor))));
  torso.position.y = 0.48;
  g.add(torso);
  rig.torso = torso;

  // Merchant merchant pack
  const pack = track(new THREE.Mesh(track(new THREE.BoxGeometry(0.28, 0.32, 0.16)), track(createMat(0x3e2918))));
  pack.position.set(0, 0.50, -0.16);
  g.add(pack);

  const headGroup = new THREE.Group();
  headGroup.position.y = 0.74;
  g.add(headGroup);
  rig.head = headGroup;

  const face = track(new THREE.Mesh(track(new THREE.SphereGeometry(0.13, 10, 10)), track(createMat(skinColor))));
  headGroup.add(face);
  const cap = track(new THREE.Mesh(track(new THREE.CylinderGeometry(0.15, 0.15, 0.06, 10)), track(createMat(0x734822))));
  cap.position.y = 0.12;
  headGroup.add(cap);

  rig.leftArm = createArmGroup(robeColor, skinColor, track);
  rig.leftArm.position.set(-0.18, 0.60, 0);
  g.add(rig.leftArm);

  rig.rightArm = createArmGroup(robeColor, skinColor, track);
  rig.rightArm.position.set(0.18, 0.60, 0);
  g.add(rig.rightArm);
}

// ==========================================================================
// 4. SKELETON MINIATURE
// ==========================================================================
function buildSkeletonMiniature(g, ent, rig, track) {
  const boneColor = 0xe4dec8;

  // Thin Bony Legs
  rig.leftLeg = createBonyLimb(boneColor, track);
  rig.leftLeg.position.set(-0.1, 0.32, 0);
  g.add(rig.leftLeg);

  rig.rightLeg = createBonyLimb(boneColor, track);
  rig.rightLeg.position.set(0.1, 0.32, 0);
  g.add(rig.rightLeg);

  // Spine & Ribcage
  const spine = track(new THREE.Mesh(track(new THREE.CylinderGeometry(0.03, 0.03, 0.32)), track(createMat(boneColor))));
  spine.position.y = 0.48;
  g.add(spine);
  rig.torso = spine;

  for (let i = 0; i < 4; i++) {
    const rib = track(new THREE.Mesh(track(new THREE.TorusGeometry(0.11 - i * 0.015, 0.018, 4, 10, Math.PI)), track(createMat(boneColor))));
    rib.rotation.x = Math.PI / 2;
    rib.position.set(0, 0.42 + i * 0.07, 0);
    g.add(rib);
  }

  // Skull with Eye Sockets
  const skullGroup = new THREE.Group();
  skullGroup.position.y = 0.75;
  g.add(skullGroup);
  rig.head = skullGroup;

  const cranium = track(new THREE.Mesh(track(new THREE.BoxGeometry(0.20, 0.20, 0.20)), track(createMat(boneColor))));
  skullGroup.add(cranium);

  const socketL = track(new THREE.Mesh(track(new THREE.BoxGeometry(0.04, 0.04, 0.05)), track(createMat(0x18120d))));
  socketL.position.set(-0.05, 0.02, 0.1);
  skullGroup.add(socketL);

  const socketR = track(new THREE.Mesh(track(new THREE.BoxGeometry(0.04, 0.04, 0.05)), track(createMat(0x18120d))));
  socketR.position.set(0.05, 0.02, 0.1);
  skullGroup.add(socketR);

  // Bony Arms + Scimitar + Buckler
  rig.leftArm = createBonyLimb(boneColor, track);
  rig.leftArm.position.set(-0.17, 0.60, 0);
  g.add(rig.leftArm);

  const buckler = track(new THREE.Mesh(track(new THREE.CylinderGeometry(0.16, 0.16, 0.03, 10)), track(createMat(0x3a3227))));
  buckler.rotation.x = Math.PI / 2;
  buckler.position.set(0, -0.22, 0.06);
  rig.leftArm.add(buckler);
  rig.shield = buckler;
  rig.hasShield = true;

  rig.rightArm = createBonyLimb(boneColor, track);
  rig.rightArm.position.set(0.17, 0.60, 0);
  g.add(rig.rightArm);

  const scimitar = createScimitar(track);
  scimitar.position.set(0, -0.18, 0.12);
  scimitar.rotation.x = 0.4;
  rig.rightArm.add(scimitar);
  rig.weapon = scimitar;
}

// ==========================================================================
// 5. ZOMBIE MINIATURE
// ==========================================================================
function buildZombieMiniature(g, ent, rig, track) {
  const rotSkin = 0x536b47;
  const ragsColor = 0x362c24;

  rig.leftLeg = createLegGroup(ragsColor, rotSkin, track);
  rig.leftLeg.position.set(-0.11, 0.32, 0);
  g.add(rig.leftLeg);

  rig.rightLeg = createLegGroup(ragsColor, rotSkin, track);
  rig.rightLeg.position.set(0.11, 0.32, 0);
  g.add(rig.rightLeg);

  // Hunched Torso
  const torso = track(new THREE.Mesh(track(new THREE.BoxGeometry(0.30, 0.34, 0.22)), track(createMat(ragsColor))));
  torso.position.set(0, 0.47, 0.04);
  torso.rotation.x = 0.2; // slouch
  g.add(torso);
  rig.torso = torso;

  // Slumped Head
  const headGroup = new THREE.Group();
  headGroup.position.set(0, 0.72, 0.1);
  headGroup.rotation.x = 0.15;
  headGroup.rotation.z = -0.1;
  g.add(headGroup);
  rig.head = headGroup;

  const face = track(new THREE.Mesh(track(new THREE.SphereGeometry(0.14, 10, 10)), track(createMat(rotSkin))));
  headGroup.add(face);

  // Outstretched Lunging Arms
  rig.leftArm = createArmGroup(rotSkin, rotSkin, track);
  rig.leftArm.position.set(-0.19, 0.58, 0.05);
  rig.leftArm.rotation.x = -0.7; // reaching forward
  g.add(rig.leftArm);

  rig.rightArm = createArmGroup(rotSkin, rotSkin, track);
  rig.rightArm.position.set(0.19, 0.58, 0.05);
  rig.rightArm.rotation.x = -0.85; // lunging forward
  g.add(rig.rightArm);
}

// ==========================================================================
// 6. GOBLIN MINIATURE
// ==========================================================================
function buildGoblinMiniature(g, ent, rig, track) {
  g.scale.set(0.78, 0.78, 0.78);
  const gobSkin = 0x5e8238;
  const hideColor = 0x4a3420;

  rig.leftLeg = createLegGroup(hideColor, gobSkin, track);
  rig.leftLeg.position.set(-0.1, 0.28, 0);
  g.add(rig.leftLeg);

  rig.rightLeg = createLegGroup(hideColor, gobSkin, track);
  rig.rightLeg.position.set(0.1, 0.28, 0);
  g.add(rig.rightLeg);

  // Hunched Body
  const torso = track(new THREE.Mesh(track(new THREE.BoxGeometry(0.24, 0.26, 0.18)), track(createMat(hideColor))));
  torso.position.set(0, 0.42, 0.04);
  torso.rotation.x = 0.22;
  g.add(torso);
  rig.torso = torso;

  // Large Head with Pointed Ears & Snout
  const headGroup = new THREE.Group();
  headGroup.position.set(0, 0.64, 0.08);
  g.add(headGroup);
  rig.head = headGroup;

  const face = track(new THREE.Mesh(track(new THREE.SphereGeometry(0.14, 10, 10)), track(createMat(gobSkin))));
  headGroup.add(face);

  // Pointed Ears
  const earL = track(new THREE.Mesh(track(new THREE.ConeGeometry(0.06, 0.18, 5)), track(createMat(gobSkin))));
  earL.rotation.z = Math.PI / 2.8;
  earL.position.set(-0.16, 0.02, 0);
  headGroup.add(earL);

  const earR = track(new THREE.Mesh(track(new THREE.ConeGeometry(0.06, 0.18, 5)), track(createMat(gobSkin))));
  earR.rotation.z = -Math.PI / 2.8;
  earR.position.set(0.16, 0.02, 0);
  headGroup.add(earR);

  // Jagged Bone Dagger
  rig.leftArm = createArmGroup(gobSkin, gobSkin, track);
  rig.leftArm.position.set(-0.15, 0.52, 0);
  g.add(rig.leftArm);

  rig.rightArm = createArmGroup(gobSkin, gobSkin, track);
  rig.rightArm.position.set(0.15, 0.52, 0);
  g.add(rig.rightArm);

  const dagger = createBoneDagger(track);
  dagger.position.set(0, -0.16, 0.12);
  dagger.rotation.x = 0.5;
  rig.rightArm.add(dagger);
  rig.weapon = dagger;
}

// ==========================================================================
// 7. GIANT RAT MINIATURE (Quadruped)
// ==========================================================================
function buildGiantRatMiniature(g, ent, rig, track) {
  rig.isQuadruped = true;
  const furColor = 0x3d2d22;
  const pinkColor = 0xd99b9b;

  // Body
  const body = track(new THREE.Mesh(track(new THREE.BoxGeometry(0.24, 0.18, 0.44)), track(createMat(furColor))));
  body.position.y = 0.20;
  g.add(body);
  rig.torso = body;

  // Snout / Head
  const headGroup = new THREE.Group();
  headGroup.position.set(0, 0.24, 0.26);
  g.add(headGroup);
  rig.head = headGroup;

  const snout = track(new THREE.Mesh(track(new THREE.ConeGeometry(0.10, 0.22, 6)), track(createMat(furColor))));
  snout.rotation.x = Math.PI / 2;
  headGroup.add(snout);

  const nose = track(new THREE.Mesh(track(new THREE.SphereGeometry(0.03, 6, 6)), track(createMat(pinkColor))));
  nose.position.set(0, 0, 0.12);
  headGroup.add(nose);

  const earL = track(new THREE.Mesh(track(new THREE.SphereGeometry(0.04, 6, 6)), track(createMat(pinkColor))));
  earL.position.set(-0.07, 0.08, -0.04);
  headGroup.add(earL);

  const earR = track(new THREE.Mesh(track(new THREE.SphereGeometry(0.04, 6, 6)), track(createMat(pinkColor))));
  earR.position.set(0.07, 0.08, -0.04);
  headGroup.add(earR);

  // 4 Legs
  rig.leftLeg = track(new THREE.Mesh(track(new THREE.BoxGeometry(0.05, 0.14, 0.05)), track(createMat(furColor))));
  rig.leftLeg.position.set(-0.11, 0.07, 0.14);
  g.add(rig.leftLeg);

  rig.rightLeg = track(new THREE.Mesh(track(new THREE.BoxGeometry(0.05, 0.14, 0.05)), track(createMat(furColor))));
  rig.rightLeg.position.set(0.11, 0.07, 0.14);
  g.add(rig.rightLeg);

  const backLegL = track(new THREE.Mesh(track(new THREE.BoxGeometry(0.06, 0.14, 0.06)), track(createMat(furColor))));
  backLegL.position.set(-0.11, 0.07, -0.14);
  g.add(backLegL);
  rig.leftArm = backLegL;

  const backLegR = track(new THREE.Mesh(track(new THREE.BoxGeometry(0.06, 0.14, 0.06)), track(createMat(furColor))));
  backLegR.position.set(0.11, 0.07, -0.14);
  g.add(backLegR);
  rig.rightArm = backLegR;

  // Tail
  const tail = track(new THREE.Mesh(track(new THREE.CylinderGeometry(0.02, 0.01, 0.36, 6)), track(createMat(pinkColor))));
  tail.position.set(0, 0.18, -0.36);
  tail.rotation.x = -Math.PI / 4;
  g.add(tail);
}

// ==========================================================================
// 8. CRYPT HOUND MINIATURE
// ==========================================================================
function buildCryptHoundMiniature(g, ent, rig, track) {
  rig.isQuadruped = true;
  const skin = 0x2e1f1d;

  const body = track(new THREE.Mesh(track(new THREE.BoxGeometry(0.28, 0.24, 0.52)), track(createMat(skin))));
  body.position.y = 0.26;
  g.add(body);
  rig.torso = body;

  const headGroup = new THREE.Group();
  headGroup.position.set(0, 0.36, 0.32);
  g.add(headGroup);
  rig.head = headGroup;

  const head = track(new THREE.Mesh(track(new THREE.BoxGeometry(0.18, 0.18, 0.24)), track(createMat(0x1a1210))));
  headGroup.add(head);

  // Glowing red eyes
  const eyeL = track(new THREE.Mesh(track(new THREE.SphereGeometry(0.03, 6, 6)), track(new THREE.MeshBasicMaterial({ color: 0xff3322 }))));
  eyeL.position.set(-0.06, 0.04, 0.12);
  headGroup.add(eyeL);

  const eyeR = track(new THREE.Mesh(track(new THREE.SphereGeometry(0.03, 6, 6)), track(new THREE.MeshBasicMaterial({ color: 0xff3322 }))));
  eyeR.position.set(0.06, 0.04, 0.12);
  headGroup.add(eyeR);

  rig.leftLeg = track(new THREE.Mesh(track(new THREE.BoxGeometry(0.08, 0.22, 0.08)), track(createMat(skin))));
  rig.leftLeg.position.set(-0.12, 0.11, 0.18);
  g.add(rig.leftLeg);

  rig.rightLeg = track(new THREE.Mesh(track(new THREE.BoxGeometry(0.08, 0.22, 0.08)), track(createMat(skin))));
  rig.rightLeg.position.set(0.12, 0.11, 0.18);
  g.add(rig.rightLeg);

  const bL = track(new THREE.Mesh(track(new THREE.BoxGeometry(0.08, 0.22, 0.08)), track(createMat(skin))));
  bL.position.set(-0.12, 0.11, -0.18);
  g.add(bL);
  rig.leftArm = bL;

  const bR = track(new THREE.Mesh(track(new THREE.BoxGeometry(0.08, 0.22, 0.08)), track(createMat(skin))));
  bR.position.set(0.12, 0.11, -0.18);
  g.add(bR);
  rig.rightArm = bR;
}

// ==========================================================================
// 9. BOSS MINIATURE (Crypt Warden / Tomb Lord)
// ==========================================================================
function buildBossMiniature(g, ent, rig, track) {
  g.scale.set(1.35, 1.35, 1.35);
  const plateColor = 0x18181b; // blackened iron
  const glowColor = 0xd92626;

  rig.leftLeg = createLegGroup(plateColor, 0x09090b, track);
  rig.leftLeg.position.set(-0.14, 0.34, 0);
  g.add(rig.leftLeg);

  rig.rightLeg = createLegGroup(plateColor, 0x09090b, track);
  rig.rightLeg.position.set(0.14, 0.34, 0);
  g.add(rig.rightLeg);

  // Massive Spiked Cuirass
  const torso = track(new THREE.Mesh(track(new THREE.BoxGeometry(0.38, 0.42, 0.26)), track(createMat(plateColor))));
  torso.position.y = 0.56;
  g.add(torso);
  rig.torso = torso;

  // Spiked Pauldrons
  for (const side of [-1, 1]) {
    const pauldron = track(new THREE.Mesh(track(new THREE.BoxGeometry(0.18, 0.18, 0.22)), track(createMat(0x27272a))));
    pauldron.position.set(side * 0.28, 0.72, 0);
    g.add(pauldron);
    const spike = track(new THREE.Mesh(track(new THREE.ConeGeometry(0.05, 0.2, 5)), track(createMat(0x3f3f46))));
    spike.position.set(side * 0.30, 0.88, 0);
    g.add(spike);
  }

  // Horned Skull Helm with Glowing Eyes
  const headGroup = new THREE.Group();
  headGroup.position.y = 0.90;
  g.add(headGroup);
  rig.head = headGroup;

  const helm = track(new THREE.Mesh(track(new THREE.BoxGeometry(0.26, 0.28, 0.28)), track(createMat(plateColor))));
  headGroup.add(helm);

  // Glowing Crimson Eye Slits
  const eyeL = track(new THREE.Mesh(track(new THREE.BoxGeometry(0.05, 0.03, 0.05)), track(new THREE.MeshBasicMaterial({ color: glowColor }))));
  eyeL.position.set(-0.06, 0.02, 0.14);
  headGroup.add(eyeL);

  const eyeR = track(new THREE.Mesh(track(new THREE.BoxGeometry(0.05, 0.03, 0.05)), track(new THREE.MeshBasicMaterial({ color: glowColor }))));
  eyeR.position.set(0.06, 0.02, 0.14);
  headGroup.add(eyeR);

  // Demon Horns
  const hornL = track(new THREE.Mesh(track(new THREE.ConeGeometry(0.06, 0.32, 6)), track(createMat(0x27272a))));
  hornL.position.set(-0.18, 0.22, 0);
  hornL.rotation.z = Math.PI / 4;
  headGroup.add(hornL);

  const hornR = track(new THREE.Mesh(track(new THREE.ConeGeometry(0.06, 0.32, 6)), track(createMat(0x27272a))));
  hornR.position.set(0.18, 0.22, 0);
  hornR.rotation.z = -Math.PI / 4;
  headGroup.add(hornR);

  // Arms & Colossal Executioner Greatsword
  rig.leftArm = createArmGroup(plateColor, 0x09090b, track);
  rig.leftArm.position.set(-0.25, 0.70, 0);
  g.add(rig.leftArm);

  rig.rightArm = createArmGroup(plateColor, 0x09090b, track);
  rig.rightArm.position.set(0.25, 0.70, 0);
  g.add(rig.rightArm);

  const blade = createExecutionerBlade(track);
  blade.position.set(0, -0.22, 0.20);
  blade.rotation.x = 0.35;
  rig.rightArm.add(blade);
  rig.weapon = blade;
}

// ==========================================================================
// 10. YOUNG FIRE DRAGON MINIATURE (Boss Yzmerith)
// ==========================================================================
function buildDragonMiniature(g, ent, rig, track) {
  rig.isQuadruped = true;
  const scales = 0x991b1b;
  const belly = 0xd97706;
  const horn = 0x1c1917;
  const claw = 0x44403c;

  // Massive Muscular Torso & Underbelly
  const torso = track(new THREE.Mesh(track(new THREE.BoxGeometry(0.55, 0.44, 0.85)), track(createMat(scales))));
  torso.position.set(0, 0.46, 0);
  g.add(torso);
  rig.torso = torso;

  const underbelly = track(new THREE.Mesh(track(new THREE.BoxGeometry(0.42, 0.12, 0.75)), track(createMat(belly))));
  underbelly.position.set(0, 0.28, 0);
  g.add(underbelly);

  // Dorsal Spines along back
  for (let i = -0.3; i <= 0.35; i += 0.18) {
    const spine = track(new THREE.Mesh(track(new THREE.ConeGeometry(0.04, 0.16, 4)), track(createMat(horn))));
    spine.position.set(0, 0.72, i);
    spine.rotation.x = -0.2;
    g.add(spine);
  }

  // Muscular Quadruped Dragon Legs with Claws
  rig.leftLeg = createDragonLeg(scales, claw, track);
  rig.leftLeg.position.set(-0.28, 0.24, 0.28);
  g.add(rig.leftLeg);

  rig.rightLeg = createDragonLeg(scales, claw, track);
  rig.rightLeg.position.set(0.28, 0.24, 0.28);
  g.add(rig.rightLeg);

  rig.leftArm = createDragonLeg(scales, claw, track);
  rig.leftArm.position.set(-0.28, 0.24, -0.28);
  g.add(rig.leftArm);

  rig.rightArm = createDragonLeg(scales, claw, track);
  rig.rightArm.position.set(0.28, 0.24, -0.28);
  g.add(rig.rightArm);

  // Dragon Neck and Horned Head
  const headGroup = new THREE.Group();
  headGroup.position.set(0, 0.68, 0.52);
  g.add(headGroup);
  rig.head = headGroup;

  const neck = track(new THREE.Mesh(track(new THREE.BoxGeometry(0.22, 0.34, 0.28)), track(createMat(scales))));
  neck.position.set(0, 0.12, 0.08);
  neck.rotation.x = -0.35;
  headGroup.add(neck);

  const head = track(new THREE.Mesh(track(new THREE.BoxGeometry(0.28, 0.22, 0.40)), track(createMat(scales))));
  head.position.set(0, 0.26, 0.28);
  headGroup.add(head);

  // Dragon Snout
  const snout = track(new THREE.Mesh(track(new THREE.BoxGeometry(0.22, 0.14, 0.26)), track(createMat(scales))));
  snout.position.set(0, 0.21, 0.52);
  headGroup.add(snout);

  // Glowing Fiery Eyes & Horns
  for (const s of [-1, 1]) {
    const eye = track(new THREE.Mesh(track(new THREE.BoxGeometry(0.04, 0.03, 0.05)), track(new THREE.MeshBasicMaterial({ color: 0xfacc15 }))));
    eye.position.set(s * 0.14, 0.30, 0.34);
    headGroup.add(eye);

    const dragonHorn = track(new THREE.Mesh(track(new THREE.ConeGeometry(0.055, 0.38, 5)), track(createMat(horn))));
    dragonHorn.position.set(s * 0.15, 0.42, 0.16);
    dragonHorn.rotation.x = -0.55;
    dragonHorn.rotation.z = s * 0.35;
    headGroup.add(dragonHorn);
  }

  // Sweeping Draconic Wings
  for (const s of [-1, 1]) {
    const wingGroup = new THREE.Group();
    wingGroup.position.set(s * 0.26, 0.65, -0.05);
    wingGroup.rotation.y = s * 0.3;
    wingGroup.rotation.z = s * 0.25;

    const wingBone = track(new THREE.Mesh(track(new THREE.BoxGeometry(0.05, 0.70, 0.05)), track(createMat(horn))));
    wingBone.position.set(s * 0.30, 0.28, 0);
    wingBone.rotation.z = s * 0.6;
    wingGroup.add(wingBone);

    const membrane = track(new THREE.Mesh(track(new THREE.BoxGeometry(0.55, 0.45, 0.01)), track(createMat(0x7f1d1d))));
    membrane.position.set(s * 0.28, 0.15, -0.04);
    wingGroup.add(membrane);

    g.add(wingGroup);
  }

  // Spiked Serpentine Tail
  const tail = track(new THREE.Mesh(track(new THREE.CylinderGeometry(0.06, 0.14, 0.75, 5)), track(createMat(scales))));
  tail.position.set(0, 0.34, -0.72);
  tail.rotation.x = 1.2;
  g.add(tail);

  const tailSpike = track(new THREE.Mesh(track(new THREE.ConeGeometry(0.08, 0.24, 4)), track(createMat(horn))));
  tailSpike.position.set(0, 0.22, -1.1);
  tailSpike.rotation.x = 1.4;
  g.add(tailSpike);
}

function createDragonLeg(color, clawColor, track) {
  const g = new THREE.Group();
  const thigh = track(new THREE.Mesh(track(new THREE.BoxGeometry(0.14, 0.26, 0.16)), track(createMat(color))));
  thigh.position.y = -0.08;
  g.add(thigh);

  const paw = track(new THREE.Mesh(track(new THREE.BoxGeometry(0.16, 0.10, 0.20)), track(createMat(clawColor))));
  paw.position.set(0, -0.22, 0.04);
  g.add(paw);
  return g;
}

// ==========================================================================
// 11. GIANT SPIDER MINIATURE
// ==========================================================================
function buildSpiderMiniature(g, ent, rig, track) {
  rig.isQuadruped = true;
  const chitin = 0x18181b;
  const accent = 0xdc2626;

  const headGroup = new THREE.Group();
  headGroup.position.set(0, 0.24, 0.14);
  g.add(headGroup);
  rig.head = headGroup;

  const thorax = track(new THREE.Mesh(track(new THREE.SphereGeometry(0.18, 8, 8)), track(createMat(chitin))));
  thorax.scale.set(1.0, 0.65, 1.2);
  headGroup.add(thorax);

  for (const s of [-0.07, -0.02, 0.02, 0.07]) {
    const eye = track(new THREE.Mesh(track(new THREE.SphereGeometry(0.024, 5, 5)), track(new THREE.MeshBasicMaterial({ color: 0xef4444 }))));
    eye.position.set(s, 0.06, 0.18);
    headGroup.add(eye);
  }

  for (const s of [-1, 1]) {
    const fang = track(new THREE.Mesh(track(new THREE.ConeGeometry(0.028, 0.12, 4)), track(createMat(0x450a0a))));
    fang.position.set(s * 0.06, -0.06, 0.22);
    fang.rotation.x = 0.5;
    headGroup.add(fang);
  }

  const abdomen = track(new THREE.Mesh(track(new THREE.SphereGeometry(0.32, 10, 10)), track(createMat(chitin))));
  abdomen.scale.set(1.1, 0.85, 1.4);
  abdomen.position.set(0, 0.32, -0.28);
  g.add(abdomen);
  rig.torso = abdomen;

  const mark = track(new THREE.Mesh(track(new THREE.BoxGeometry(0.10, 0.02, 0.14)), track(createMat(accent))));
  mark.position.set(0, 0.55, -0.28);
  g.add(mark);

  rig.leftLeg = createSpiderLeg(-1, track);
  rig.leftLeg.position.set(-0.16, 0.20, 0.12);
  g.add(rig.leftLeg);

  rig.rightLeg = createSpiderLeg(1, track);
  rig.rightLeg.position.set(0.16, 0.20, 0.12);
  g.add(rig.rightLeg);

  rig.leftArm = createSpiderLeg(-1, track);
  rig.leftArm.position.set(-0.16, 0.20, -0.12);
  g.add(rig.leftArm);

  rig.rightArm = createSpiderLeg(1, track);
  rig.rightArm.position.set(0.16, 0.20, -0.12);
  g.add(rig.rightArm);

  for (const s of [-1, 1]) {
    const leg2 = createSpiderLeg(s, track);
    leg2.position.set(s * 0.17, 0.20, 0.02);
    g.add(leg2);

    const leg3 = createSpiderLeg(s, track);
    leg3.position.set(s * 0.15, 0.20, -0.22);
    g.add(leg3);
  }
}

function createSpiderLeg(side, track) {
  const g = new THREE.Group();
  const upper = track(new THREE.Mesh(track(new THREE.CylinderGeometry(0.02, 0.025, 0.30, 4)), track(createMat(0x1c1917))));
  upper.position.set(side * 0.12, 0.08, 0);
  upper.rotation.z = side * 0.9;
  g.add(upper);

  const lower = track(new THREE.Mesh(track(new THREE.ConeGeometry(0.02, 0.26, 4)), track(createMat(0x09090b))));
  lower.position.set(side * 0.24, -0.06, 0);
  lower.rotation.z = side * -0.3;
  g.add(lower);
  return g;
}

// ==========================================================================
// 12. GREEN SLIME MINIATURE
// ==========================================================================
function buildSlimeMiniature(g, ent, rig, track) {
  const slimeColor = 0x10b981;
  const coreColor = 0x059669;

  const domeMat = new THREE.MeshLambertMaterial({ color: slimeColor, transparent: true, opacity: 0.80 });
  track(domeMat);
  const dome = track(new THREE.Mesh(track(new THREE.SphereGeometry(0.38, 12, 10, 0, Math.PI * 2, 0, Math.PI / 2)), domeMat));
  dome.position.y = 0;
  dome.scale.set(1.15, 0.95, 1.15);
  g.add(dome);
  rig.torso = dome;

  const core = track(new THREE.Mesh(track(new THREE.SphereGeometry(0.20, 8, 8)), track(createMat(coreColor))));
  core.position.set(0, 0.14, 0);
  g.add(core);

  const skull = track(new THREE.Mesh(track(new THREE.BoxGeometry(0.09, 0.09, 0.09)), track(createMat(0xfafaf9))));
  skull.position.set(0.08, 0.16, 0.06);
  skull.rotation.set(0.4, 0.2, 0.5);
  g.add(skull);

  const dagger = track(new THREE.Mesh(track(new THREE.BoxGeometry(0.04, 0.18, 0.02)), track(createMat(0x94a3b8))));
  dagger.position.set(-0.09, 0.12, -0.07);
  dagger.rotation.set(-0.6, 0.3, 0.8);
  g.add(dagger);

  rig.leftLeg = track(new THREE.Mesh(track(new THREE.SphereGeometry(0.12, 6, 6)), domeMat));
  rig.leftLeg.position.set(-0.16, 0.04, 0.14);
  g.add(rig.leftLeg);

  rig.rightLeg = track(new THREE.Mesh(track(new THREE.SphereGeometry(0.12, 6, 6)), domeMat));
  rig.rightLeg.position.set(0.16, 0.04, 0.14);
  g.add(rig.rightLeg);
}

// ==========================================================================
// 13. FIRE ELEMENTAL MINIATURE
// ==========================================================================
function buildFireElementalMiniature(g, ent, rig, track) {
  const flameYellow = 0xfef08a;
  const flameOrange = 0xf97316;
  const flameRed = 0xdc2626;

  const core = track(new THREE.Mesh(track(new THREE.CylinderGeometry(0.14, 0.08, 0.65, 7)), track(createMat(flameYellow))));
  core.position.y = 0.52;
  g.add(core);
  rig.torso = core;

  for (let i = 0; i < 4; i++) {
    const angle = (i / 4) * Math.PI * 2;
    const tongue = track(new THREE.Mesh(track(new THREE.ConeGeometry(0.11, 0.55, 5)), track(createMat(i % 2 === 0 ? flameOrange : flameRed))));
    tongue.position.set(Math.cos(angle) * 0.14, 0.50 + (i % 2) * 0.12, Math.sin(angle) * 0.14);
    tongue.rotation.y = angle;
    tongue.rotation.z = Math.cos(angle) * 0.25;
    g.add(tongue);
  }

  const headGroup = new THREE.Group();
  headGroup.position.set(0, 0.92, 0);
  g.add(headGroup);
  rig.head = headGroup;

  const crown = track(new THREE.Mesh(track(new THREE.ConeGeometry(0.18, 0.35, 5)), track(createMat(flameYellow))));
  headGroup.add(crown);

  for (const s of [-1, 1]) {
    const eye = track(new THREE.Mesh(track(new THREE.BoxGeometry(0.04, 0.04, 0.04)), track(new THREE.MeshBasicMaterial({ color: 0xffffff }))));
    eye.position.set(s * 0.07, 0.06, 0.11);
    headGroup.add(eye);
  }

  rig.leftArm = createFlameArm(flameOrange, flameYellow, track);
  rig.leftArm.position.set(-0.26, 0.62, 0);
  g.add(rig.leftArm);

  rig.rightArm = createFlameArm(flameOrange, flameYellow, track);
  rig.rightArm.position.set(0.26, 0.62, 0);
  g.add(rig.rightArm);

  rig.leftLeg = track(new THREE.Mesh(track(new THREE.ConeGeometry(0.18, 0.38, 6)), track(createMat(flameRed))));
  rig.leftLeg.position.set(-0.08, 0.18, 0);
  g.add(rig.leftLeg);

  rig.rightLeg = track(new THREE.Mesh(track(new THREE.ConeGeometry(0.18, 0.38, 6)), track(createMat(flameOrange))));
  rig.rightLeg.position.set(0.08, 0.18, 0);
  g.add(rig.rightLeg);
}

function createFlameArm(color1, color2, track) {
  const g = new THREE.Group();
  const upper = track(new THREE.Mesh(track(new THREE.BoxGeometry(0.08, 0.22, 0.08)), track(createMat(color1))));
  upper.position.y = -0.10;
  g.add(upper);

  const fist = track(new THREE.Mesh(track(new THREE.SphereGeometry(0.07, 6, 6)), track(createMat(color2))));
  fist.position.set(0, -0.22, 0.02);
  g.add(fist);
  return g;
}

// ==========================================================================
// 14. ANIMATED ARMOR MINIATURE
// ==========================================================================
function buildAnimatedArmorMiniature(g, ent, rig, track) {
  const armorSteel = 0x94a3b8;
  const brassTrim = 0xd97706;

  rig.leftLeg = createLegGroup(armorSteel, 0x475569, track);
  rig.leftLeg.position.set(-0.12, 0.32, 0);
  g.add(rig.leftLeg);

  rig.rightLeg = createLegGroup(armorSteel, 0x475569, track);
  rig.rightLeg.position.set(0.12, 0.32, 0);
  g.add(rig.rightLeg);

  const torso = track(new THREE.Mesh(track(new THREE.BoxGeometry(0.32, 0.36, 0.22)), track(createMat(armorSteel))));
  torso.position.y = 0.52;
  g.add(torso);
  rig.torso = torso;

  const trim = track(new THREE.Mesh(track(new THREE.BoxGeometry(0.34, 0.06, 0.24)), track(createMat(brassTrim))));
  trim.position.y = 0.65;
  g.add(trim);

  const headGroup = new THREE.Group();
  headGroup.position.set(0, 0.84, 0);
  g.add(headGroup);
  rig.head = headGroup;

  const helm = track(new THREE.Mesh(track(new THREE.BoxGeometry(0.22, 0.24, 0.22)), track(createMat(armorSteel))));
  headGroup.add(helm);

  const visor = track(new THREE.Mesh(track(new THREE.BoxGeometry(0.15, 0.04, 0.05)), track(new THREE.MeshBasicMaterial({ color: 0x38bdf8 }))));
  visor.position.set(0, 0.02, 0.11);
  headGroup.add(visor);

  rig.leftArm = createArmGroup(armorSteel, 0x475569, track);
  rig.leftArm.position.set(-0.21, 0.65, 0);
  g.add(rig.leftArm);

  const shield = createHeaterShield(0x1e3a8a, 0xd97706, track);
  shield.position.set(-0.06, -0.16, 0.10);
  shield.rotation.y = -0.4;
  rig.leftArm.add(shield);
  rig.shield = shield;
  rig.hasShield = true;

  rig.rightArm = createArmGroup(armorSteel, 0x475569, track);
  rig.rightArm.position.set(0.21, 0.65, 0);
  g.add(rig.rightArm);

  const sword = createBroadsword(track);
  sword.position.set(0, -0.18, 0.14);
  sword.rotation.x = 0.3;
  rig.rightArm.add(sword);
  rig.weapon = sword;
}

function buildDefaultMonsterMiniature(g, ent, rig, track) {
  buildZombieMiniature(g, ent, rig, track);
}

// ==========================================================================
// Limb & Weapon Helpers
// ==========================================================================
function createLegGroup(thighColor, bootColor, track) {
  const g = new THREE.Group();
  const thigh = track(new THREE.Mesh(track(new THREE.BoxGeometry(0.11, 0.18, 0.11)), track(createMat(thighColor))));
  thigh.position.y = -0.09;
  g.add(thigh);

  const boot = track(new THREE.Mesh(track(new THREE.BoxGeometry(0.12, 0.16, 0.16)), track(createMat(bootColor))));
  boot.position.set(0, -0.24, 0.02);
  g.add(boot);
  return g;
}

function createArmGroup(shoulderColor, handColor, track) {
  const g = new THREE.Group();
  const upperArm = track(new THREE.Mesh(track(new THREE.BoxGeometry(0.09, 0.18, 0.09)), track(createMat(shoulderColor))));
  upperArm.position.y = -0.09;
  g.add(upperArm);

  const hand = track(new THREE.Mesh(track(new THREE.SphereGeometry(0.055, 6, 6)), track(createMat(handColor))));
  hand.position.set(0, -0.20, 0.02);
  g.add(hand);
  return g;
}

function createBonyLimb(boneColor, track) {
  const g = new THREE.Group();
  const bone = track(new THREE.Mesh(track(new THREE.BoxGeometry(0.06, 0.30, 0.06)), track(createMat(boneColor))));
  bone.position.y = -0.15;
  g.add(bone);
  return g;
}

function createBroadsword(track) {
  const g = new THREE.Group();
  const blade = track(new THREE.Mesh(track(new THREE.BoxGeometry(0.05, 0.55, 0.02)), track(createMat(0xd1d5db))));
  blade.position.y = 0.28;
  g.add(blade);

  const guard = track(new THREE.Mesh(track(new THREE.BoxGeometry(0.20, 0.03, 0.04)), track(createMat(0xb45309))));
  guard.position.y = 0.02;
  g.add(guard);

  const grip = track(new THREE.Mesh(track(new THREE.CylinderGeometry(0.02, 0.02, 0.12)), track(createMat(0x451a03))));
  grip.position.y = -0.05;
  g.add(grip);

  const pommel = track(new THREE.Mesh(track(new THREE.SphereGeometry(0.03, 6, 6)), track(createMat(0xb45309))));
  pommel.position.y = -0.12;
  g.add(pommel);
  return g;
}

function createScimitar(track) {
  const g = new THREE.Group();
  const blade = track(new THREE.Mesh(track(new THREE.BoxGeometry(0.045, 0.48, 0.02)), track(createMat(0x9ca3af))));
  blade.rotation.z = -0.2;
  blade.position.set(-0.04, 0.22, 0);
  g.add(blade);
  return g;
}

function createHeaterShield(track) {
  const g = new THREE.Group();
  const face = track(new THREE.Mesh(track(new THREE.BoxGeometry(0.26, 0.38, 0.03)), track(createMat(0x1e3a8a))));
  g.add(face);
  const trim = track(new THREE.Mesh(track(new THREE.BoxGeometry(0.28, 0.40, 0.02)), track(createMat(0xd97706))));
  trim.position.z = -0.01;
  g.add(trim);
  const boss = track(new THREE.Mesh(track(new THREE.SphereGeometry(0.05, 8, 8)), track(createMat(0xf59e0b))));
  boss.position.z = 0.02;
  g.add(boss);
  return g;
}

function createHuntingBow(track) {
  const g = new THREE.Group();
  const wood = track(new THREE.Mesh(track(new THREE.TorusGeometry(0.26, 0.02, 6, 12, Math.PI * 0.8)), track(createMat(0x78350f))));
  wood.rotation.z = -Math.PI / 2.5;
  g.add(wood);
  return g;
}

function createMagicStaff(track) {
  const g = new THREE.Group();
  const wood = track(new THREE.Mesh(track(new THREE.CylinderGeometry(0.02, 0.025, 0.88, 6)), track(createMat(0x5c3d2e))));
  wood.position.y = 0.15;
  g.add(wood);

  const crystal = track(new THREE.Mesh(track(new THREE.OctahedronGeometry(0.08)), track(new THREE.MeshBasicMaterial({ color: 0x38bdf8 }))));
  crystal.position.y = 0.62;
  g.add(crystal);
  return g;
}

function createBoneDagger(track) {
  const g = new THREE.Group();
  const b = track(new THREE.Mesh(track(new THREE.ConeGeometry(0.04, 0.26, 4)), track(createMat(0xe5e5e5))));
  b.rotation.x = Math.PI;
  g.add(b);
  return g;
}

function createExecutionerBlade(track) {
  const g = new THREE.Group();
  const blade = track(new THREE.Mesh(track(new THREE.BoxGeometry(0.12, 0.90, 0.03)), track(createMat(0x27272a))));
  blade.position.y = 0.45;
  g.add(blade);
  const edge = track(new THREE.Mesh(track(new THREE.BoxGeometry(0.03, 0.88, 0.035)), track(createMat(0xd4d4d8))));
  edge.position.set(0.06, 0.45, 0);
  g.add(edge);
  return g;
}

function makeHpBar() {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 7;
  const tex = new THREE.CanvasTexture(c);
  const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
  spr.scale.set(0.85, 0.09, 1);
  const draw = (frac) => {
    const g = c.getContext('2d');
    g.clearRect(0, 0, 64, 7);
    g.fillStyle = 'rgba(0,0,0,0.8)'; g.fillRect(0, 0, 64, 7);
    g.fillStyle = frac > 0.5 ? '#22c55e' : frac > 0.25 ? '#eab308' : '#ef4444';
    g.fillRect(1, 1, Math.max(0, 62 * frac), 5);
    tex.needsUpdate = true;
  };
  draw(1);
  return { sprite: spr, draw };
}

function makeBossBadge(name) {
  const c = document.createElement('canvas');
  c.width = 160; c.height = 24;
  const g = c.getContext('2d');
  g.font = 'bold 13px sans-serif';
  g.textAlign = 'center';
  g.fillStyle = '#ef4444';
  g.fillText(`☠ ${name || 'CHAMPION'} ☠`, 80, 18);
  const tex = new THREE.CanvasTexture(c);
  const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
  spr.scale.set(1.8, 0.28, 1);
  return spr;
}

function makeEliteBadge(name, color = '#f59e0b') {
  const c = document.createElement('canvas');
  c.width = 180; c.height = 24;
  const g = c.getContext('2d');
  g.font = 'bold 12px sans-serif';
  g.textAlign = 'center';
  g.fillStyle = color;
  g.shadowColor = 'rgba(0,0,0,0.8)';
  g.shadowBlur = 4;
  g.fillText(`★ ${name || 'ELITE'} ★`, 90, 17);
  const tex = new THREE.CanvasTexture(c);
  const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
  spr.scale.set(1.9, 0.28, 1);
  return spr;
}

// ==========================================================================
// Walk-Cycle Animation & Heading Interpolation Engine
// ==========================================================================
export function updateModelAnimation(node, now, delta) {
  const grp = (node && node.group) ? node.group : node;
  if (!grp || !grp.userData) return;
  const rig = grp.userData.rig;
  if (!rig) return;

  const anim = grp.userData.anim;

  // Waypoint Path Traversal
  if (anim && anim.waypoints && anim.waypoints.length > 0) {
    rig.isWalking = true;
    const wp = anim.waypoints[anim.currentWpIndex || 0];

    if (wp) {
      const curPos = grp.position;
      const dx = wp.x - curPos.x;
      const dz = wp.z - curPos.z;
      const dist = Math.hypot(dx, dz);

      // Smooth directional rotation towards waypoint
      if (dist > 0.02) {
        const targetHeading = Math.atan2(dx, dz);
        let diff = targetHeading - grp.rotation.y;
        while (diff < -Math.PI) diff += Math.PI * 2;
        while (diff > Math.PI) diff -= Math.PI * 2;
        grp.rotation.y += diff * Math.min(1, delta * 12);
      }

      // Step towards waypoint
      const speed = anim.speed || 4.2; // tiles per second
      const step = speed * delta;
      if (dist <= step) {
        curPos.x = wp.x;
        curPos.z = wp.z;
        anim.currentWpIndex = (anim.currentWpIndex || 0) + 1;
        if (anim.currentWpIndex >= anim.waypoints.length) {
          delete grp.userData.anim;
          rig.isWalking = false;
        }
      } else {
        curPos.x += (dx / dist) * step;
        curPos.z += (dz / dist) * step;
      }
    }
  } else {
    rig.isWalking = false;
  }

  // Articulated Walk Cycle / Idle Respiration
  if (rig.isWalking) {
    rig.walkTime = (rig.walkTime || 0) + delta * 12;
    const stride = Math.sin(rig.walkTime);

    if (rig.isQuadruped) {
      // Quadruped trotting cycle (diagonal pairs)
      if (rig.leftLeg) rig.leftLeg.rotation.x = stride * 0.6;
      if (rig.rightLeg) rig.rightLeg.rotation.x = -stride * 0.6;
      if (rig.leftArm) rig.leftArm.rotation.x = -stride * 0.6;
      if (rig.rightArm) rig.rightArm.rotation.x = stride * 0.6;
      if (rig.bodyGroup) rig.bodyGroup.position.y = Math.abs(stride) * 0.03;
    } else {
      // Biped walking stride
      if (rig.leftLeg) rig.leftLeg.rotation.x = stride * 0.65;
      if (rig.rightLeg) rig.rightLeg.rotation.x = -stride * 0.65;
      if (rig.leftArm && !rig.hasShield) rig.leftArm.rotation.x = -stride * 0.45;
      if (rig.rightArm && !rig.attacking) rig.rightArm.rotation.x = stride * 0.40;

      // Realistic footstep bounce & slight hip roll
      if (rig.bodyGroup) {
        rig.bodyGroup.position.y = Math.abs(stride) * 0.055;
        rig.bodyGroup.rotation.z = Math.sin(rig.walkTime) * 0.035;
      }
    }
  } else {
    // Idle breathing & natural stance recovery
    const breath = Math.sin(now * 0.0035);
    if (rig.leftLeg) rig.leftLeg.rotation.x *= 0.85;
    if (rig.rightLeg) rig.rightLeg.rotation.x *= 0.85;
    if (rig.leftArm && !rig.hasShield) rig.leftArm.rotation.x *= 0.85;
    if (rig.rightArm && !rig.attacking) rig.rightArm.rotation.x *= 0.85;

    if (rig.bodyGroup) {
      rig.bodyGroup.position.y = breath * 0.015;
      rig.bodyGroup.rotation.z *= 0.85;
    }
  }

  // Attack Animation (Swing & Recoil)
  if (rig.attackAnim) {
    const elapsed = now - rig.attackAnim.t0;
    const p = Math.min(1, elapsed / rig.attackAnim.dur);
    const swing = Math.sin(p * Math.PI);

    if (rig.rightArm) {
      rig.rightArm.rotation.x = -swing * 1.1;
    }
    if (rig.bodyGroup) {
      rig.bodyGroup.position.z = Math.sin(p * Math.PI) * 0.12;
    }

    if (p >= 1) {
      delete rig.attackAnim;
      rig.attacking = false;
      if (rig.bodyGroup) rig.bodyGroup.position.z = 0;
    }
  }
}
