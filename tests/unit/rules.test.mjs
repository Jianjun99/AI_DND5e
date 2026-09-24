// tests/unit/rules.test.mjs — Comprehensive D&D 2024 Rules Unit Tests
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const engine = require('../../server/game/engine.js');

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

console.log('\n--- Running Unit Tests: D&D 2024 Rules Engine ---');

// 1. Classes Verification
test('All 12 core classes present with valid hit dice & primary abilities', () => {
  const expectedClasses = [
    'barbarian', 'bard', 'cleric', 'druid', 'fighter',
    'monk', 'paladin', 'ranger', 'rogue', 'sorcerer', 'warlock', 'wizard'
  ];
  assert(engine.CLASSES.length === 12, `Expected 12 classes, got ${engine.CLASSES.length}`);
  for (const cId of expectedClasses) {
    const cls = engine.byId(engine.CLASSES, cId);
    assert(cls != null, `Class ${cId} missing`);
    assert([6, 8, 10, 12].includes(cls.hitDie), `Class ${cId} has invalid hit die ${cls.hitDie}`);
    assert(Array.isArray(cls.saves) && cls.saves.length === 2, `Class ${cId} must have exactly 2 saving throw proficiencies`);
  }
});

// 2. Species Verification
test('All 10 species present with speeds, traits, and darkvision', () => {
  const expectedSpecies = [
    'human', 'dwarf', 'elf', 'halfling', 'dragonborn',
    'gnome', 'orc', 'tiefling', 'goliath', 'aasimar'
  ];
  assert(engine.SPECIES.length === 10, `Expected 10 species, got ${engine.SPECIES.length}`);
  for (const sId of expectedSpecies) {
    const sp = engine.byId(engine.SPECIES, sId);
    assert(sp != null, `Species ${sId} missing`);
    assert(sp.speed >= 25 && sp.speed <= 35, `Species ${sId} speed out of bounds: ${sp.speed}`);
    assert(sp.traits && sp.traits.length > 0, `Species ${sId} missing traits`);
  }
});

// 3. Weapon Masteries & Equipment Verification
test('Weapons have masteries and valid damage formulas', () => {
  assert(engine.WEAPONS.length >= 10, 'Weapons catalog too small');
  for (const w of engine.WEAPONS) {
    assert(w.id && w.name, `Weapon missing id or name: ${JSON.stringify(w)}`);
    assert(w.damage && w.damageType, `Weapon ${w.id} missing damage or damageType`);
  }
});

// 4. Armor & Armor Class Calculations
test('Armor categories and AC calculation logic', () => {
  const chainMail = engine.byId(engine.ARMORS, 'chain_mail');
  assert(chainMail && Number(chainMail.ac) === 16, 'Chain mail AC should be 16');
  assert(chainMail.type === 'heavy', 'Chain mail should be heavy armor');

  const shield = engine.byId(engine.GEAR, 'shield');
  assert(shield && Number(shield.acBonus) === 2, 'Shield bonus should be +2');

  const leather = engine.byId(engine.ARMORS, 'leather');
  assert(leather && leather.type === 'light', 'Leather should be light armor');
});

// 5. Spell Slots Progression
test('Spell slot tables for full, half, and pact casters', () => {
  assert(engine.SLOTS.full[1][1] === 2, 'Full caster lvl 1 should have 2 level-1 slots');
  assert(engine.SLOTS.full[3][2] === 2, 'Full caster lvl 3 should have 2 level-2 slots');
  assert(engine.SLOTS.half[2][1] === 2, 'Half caster lvl 2 should have 2 level-1 slots');
  assert(engine.SLOTS.pact[1][1] === 2, 'Warlock pact magic lvl 1 should have 2 slots');
});

// 6. Character Creation & Attribute Calculation
test('Fighter character generation with Dwarf Toughness and Defense fighting style', () => {
  const char = engine.buildCharacter({
    name: 'Bromir Ironbreaker',
    species: 'dwarf',
    className: 'fighter',
    background: 'soldier',
    baseScores: { str: 15, dex: 14, con: 14, int: 10, wis: 12, cha: 8 },
    bgPlus2: 'str',
    bgPlus1: 'con',
    skills: ['athletics', 'perception'],
    fightingStyle: 'defense',
    armorOption: 'chain_mail',
    weaponOption: 'sword_board'
  });

  assert(char.scores.str === 17, `Expected STR 17, got ${char.scores.str}`);
  assert(char.scores.con === 15, `Expected CON 15 (mod +2), got ${char.scores.con}`);
  // d10 (10) + CON mod (2) + Dwarf Toughness (1) = 13 HP
  assert(char.hpMax === 13, `Expected HP 13, got ${char.hpMax}`);
  // Chain mail (16) + Shield (2) + Defense Fighting Style (1) = 19 AC
  assert(char.acBase === 19, `Expected AC 19, got ${char.acBase}`);
  // Passive perception = 10 + WIS mod (1) + Prof (2) = 13
  assert(char.passivePerception === 13, `Expected Passive Perception 13, got ${char.passivePerception}`);
  assert(char.speedFt === 30, `Expected Dwarf Speed 30, got ${char.speedFt}`);
});

// 7. Wizard Character Generation
test('Wizard character generation with INT spellcasting and spellbook', () => {
  const char = engine.buildCharacter({
    name: 'Alden the Sage',
    species: 'elf',
    className: 'wizard',
    background: 'sage',
    baseScores: { str: 8, dex: 14, con: 12, int: 15, wis: 13, cha: 10 },
    bgPlus2: 'int',
    bgPlus1: 'dex',
    skills: ['arcana', 'history'],
    armorOption: 'none',
    weaponOption: 'staff'
  });

  assert(char.scores.int === 17, `Expected INT 17, got ${char.scores.int}`);
  assert(char.hpMax === 7, `Expected HP 7 (d6 + 1 CON), got ${char.hpMax}`);
  assert(char.acBase === 12, `Expected unarmored AC 12 (10 + 2 DEX), got ${char.acBase}`);
  assert(char.spellSlots && char.spellSlots[1] === 2, 'Wizard should have 2 lvl 1 spell slots');
});

// Level-up readiness — the one rule the HUD badge and the level-up endpoint must share
test('levelUpInfo gates on the engine XP table at every boundary', () => {
  const at = (level, xp) => engine.levelUpInfo({ level, xp });

  const below = at(2, 899);
  assert(below.nextLevel === 3 && below.xpNeeded === 900 && below.canLevelUp === false,
    `899 XP at level 2 is not enough for level 3 (got ${JSON.stringify(below)})`);
  assert(at(2, 900).canLevelUp === true, 'Exactly 900 XP at level 2 unlocks level 3');
  assert(at(2, 950).canLevelUp === true, '950 XP at level 2 unlocks level 3');
  // the reported bug: a hero who levelled up in town then entered an older delve was told
  // "level 3 available" while the endpoint demanded level 4's XP
  const stale = at(3, 1000);
  assert(stale.nextLevel === 4 && stale.xpNeeded === 2700 && stale.canLevelUp === false,
    `A level 3 hero with 1000 XP must not be offered another level (got ${JSON.stringify(stale)})`);
  const l3 = at(3, 2700);
  assert(l3.canLevelUp === true && l3.nextLevel === 4, 'Level 4 unlocks at 2700 XP');
});

test('levelUpInfo covers the extended level cap and stops cleanly at 12', () => {
  assert(engine.levelUpInfo({ level: 10, xp: 50000 }).canLevelUp === true, 'Level 11 unlocks at 50,000 XP');
  const l11 = engine.levelUpInfo({ level: 11, xp: 74999 });
  assert(l11.nextLevel === 12 && l11.xpNeeded === 75000 && l11.canLevelUp === false, 'Level 12 needs 75,000 XP');
  assert(engine.levelUpInfo({ level: 11, xp: 75000 }).canLevelUp === true, '75,000 XP unlocks level 12');
  const capped = engine.levelUpInfo({ level: 12, xp: 999999 });
  assert(capped.xpNeeded === null && capped.canLevelUp === false, 'At the cap there is no further level to claim');
  const fresh = engine.levelUpInfo(undefined);
  assert(fresh.currentLevel === 1 && fresh.nextLevel === 2 && fresh.xpNeeded === 300 && fresh.canLevelUp === false,
    'A brand-new hero needs 300 XP for level 2');
});

console.log(`\nUnit Tests Summary: ${passed} passed, ${failed} failed.`);
if (failed > 0) process.exit(1);
