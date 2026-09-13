// tests/integration/combat.test.mjs — Turn-Based Combat & Action Economy Integration Tests
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
    failed++;
    console.error(`  ❌ ERROR in ${name}:`, err.message);
  }
}

console.log('\n--- Running Integration Tests: Combat, Actions & Health ---');

function createCombatState() {
  const char = engine.buildCharacter({
    name: 'Gareth the Bold',
    species: 'human',
    className: 'fighter',
    background: 'soldier',
    baseScores: { str: 16, dex: 14, con: 14, int: 10, wis: 12, cha: 8 },
    bgPlus2: 'str', bgPlus1: 'con',
    skills: ['athletics', 'perception'],
    fightingStyle: 'defense',
    armorOption: 'chain_mail',
    weaponOption: 'sword_board'
  });
  const state = engine.startGame(char, { difficulty: 'normal' });

  // Place a test goblin adjacent to player at (5,4)
  const goblin = {
    id: 'test_goblin_1',
    kind: 'monster',
    monsterId: 'goblin',
    name: 'Goblin Scout',
    x: 5, y: 4,
    hp: 7, hpMax: 7, ac: 15,
    cr: '1/4', xp: 50,
    speedFt: 30, alive: true,
    conditions: [], buffs: [],
    attacks: [{ name: 'Scimitar', bonus: 4, dmgDice: '1d6', dmgMod: 2, damageType: 'slashing' }]
  };
  state.entities.push(goblin);

  return { state, goblin };
}

// 1. Melee Reach & Distance Validation
test('Melee attacks require adjacent target (1 tile reach)', () => {
  const { state } = createCombatState();
  const p = engine.playerEntity(state);

  // Distant monster 3 tiles away at (7,4)
  const distant = {
    id: 'distant_enemy',
    kind: 'monster',
    monsterId: 'skeleton',
    name: 'Distant Skeleton',
    x: 7, y: 4,
    hp: 13, hpMax: 13, ac: 13,
    alive: true
  };
  state.entities.push(distant);

  const events = [];
  const success = engine.playerAttack(state, 'distant_enemy', undefined, events);

  assert(success === false, 'Melee attack on non-adjacent target must return false');
  assert(events.some(e => e.type === 'error' && e.text.includes('not adjacent')), 'Error event must specify target is not adjacent');
});

// 2. Attack Resolution & Monster Damage
test('Player attack resolves hit or miss against monster Armor Class', () => {
  const { state, goblin } = createCombatState();
  const events = [];

  const initialHp = goblin.hp;
  const success = engine.playerAttack(state, goblin.id, undefined, events);

  assert(success === true, 'Player attack on adjacent target must execute');
  const atkEvent = events.find(e => e.type === 'attack' || e.type === 'miss');
  assert(atkEvent != null, 'Must emit attack or miss event');

  if (atkEvent.type === 'attack') {
    assert(goblin.hp < initialHp, `Goblin HP must decrease on hit (was ${initialHp}, now ${goblin.hp})`);
  }
});

// 3. Monster Slaying & XP Distribution
test('Reducing monster HP to 0 slays it and marks alive = false', () => {
  const { state, goblin } = createCombatState();
  const events = [];

  // Directly apply lethal damage to goblin
  engine.applyDamage(state, goblin, 15, 'slashing', events);

  assert(goblin.alive === false, 'Monster must be marked dead when HP reaches 0');
  assert(goblin.hp === 0, `Monster HP must be clamped to 0, got ${goblin.hp}`);
  assert(events.some(e => e.type === 'slain' || e.type === 'kill' || e.type === 'death'), 'Lethal damage must trigger slaying event');
});

// 4. Player Damage & Healing Consumables
test('Damage reduces player HP and healing restores HP up to hpMax', () => {
  const { state } = createCombatState();
  const p = engine.playerEntity(state);
  const events = [];
  const maxHp = p.hpMax;

  // Apply 6 slashing damage
  engine.applyDamage(state, p, 6, 'slashing', events);
  assert(p.hp === maxHp - 6, `Expected player HP ${maxHp - 6}, got ${p.hp}`);

  // Heal 4 HP
  engine.healEntity(state, p, 4, events);
  assert(p.hp === maxHp - 2, `Expected player HP ${maxHp - 2}, got ${p.hp}`);

  // Over-heal by 10 HP — must clamp to hpMax
  engine.healEntity(state, p, 10, events);
  assert(p.hp === maxHp, `Overhealing must clamp to max HP (${maxHp}), got ${p.hp}`);
});

// 5. Downed State & Death Saving Throws
test('Dropping to 0 HP knocks player unconscious with death saves', () => {
  const { state } = createCombatState();
  const p = engine.playerEntity(state);
  const events = [];

  // Apply lethal damage equal to current HP
  engine.applyDamage(state, p, p.hp, 'bludgeoning', events);
  engine.checkPlayerDeath(state, events);

  assert(p.hp === 0, 'HP must be 0');
  assert(p.conditions.includes('unconscious'), 'Player should be marked unconscious');
  assert(p.deathSaves != null, 'Death saves counter must be initialized');
  assert(p.deathSaves.succ === 0 && p.deathSaves.fail === 0, 'Death saves start at 0/0');
});

console.log(`\nCombat Integration Tests Summary: ${passed} passed, ${failed} failed.`);
if (failed > 0) process.exit(1);
