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
  const _p = engine.playerEntity(state);

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

// Companion loyalty: seeded from the roster, dropped when the ally goes down,
// raised by a shared campfire night. Threshold crossings surface canned quips.
function makeLoyaltyState(seedLoyalty) {
  const char = engine.buildCharacter({
    name: 'Loyalty Tester', species: 'human', className: 'fighter', background: 'soldier',
    baseScores: { str: 16, dex: 14, con: 14, int: 10, wis: 12, cha: 8 },
    bgPlus2: 'str', bgPlus1: 'con', skills: ['athletics', 'perception'],
    fightingStyle: 'defense', armorOption: 'chain_mail', weaponOption: 'sword_board'
  });
  char.companionLoyalty = { bram: seedLoyalty };
  return engine.startGame(char, { difficulty: 'normal', bringAlly: 'bram' });
}

test('Ally spawns with the roster-seeded loyalty', () => {
  const state = makeLoyaltyState(35);
  const ally = state.entities.find(e => e.kind === 'ally');
  assert(ally != null, 'Bring-ally delve includes the companion entity');
  assert(ally.loyalty === 35, `Alloy should spawn at the seeded 35, got ${ally.loyalty}`);
});

test('Ally going down costs 10 loyalty and surfaces a downed quip plus threshold quip', () => {
  const state = makeLoyaltyState(35);
  const ally = state.entities.find(e => e.kind === 'ally');
  const events = [];
  engine.applyDamage(state, ally, 999, 'slashing', events);
  assert(ally.alive === false, 'A 999-damage blow downs the ally');
  assert(ally.loyalty === 25, `Downed ally drops from 35 to 25, got ${ally.loyalty}`);
  assert(events.filter(e => e.type === 'companion').length >= 2,
    'Downing fires the crash line and the crossing-the-low-threshold quip');
});

test('A campfire long rest raises living-ally loyalty and mentions the shared watch', () => {
  const state = makeLoyaltyState(90);
  const ally = state.entities.find(e => e.kind === 'ally');
  const camp = state.objects.find(o => o.id === 'campfire');
  const p = engine.playerEntity(state);
  p.x = camp.x; p.y = camp.y;
  const events = [];
  engine.longRest(state, events);
  assert(ally.loyalty === 93, `Rest raises loyalty 90 -> 93, got ${ally.loyalty}`);
  assert(events.some(e => e.type === 'rest' && e.text.includes('takes the second watch')),
    'Rest event text mentions the companion sharing the watch');
});

test('Chef cooks temp HP on short rest; Musician blesses the party on long rest', () => {
  const state = makeLoyaltyState(50);
  const char = state.character;
  char.unlockedFeats = ['chef', 'musician'];
  const p = engine.playerEntity(state);
  const ally = state.entities.find((e) => e.kind === 'ally');
  const prof = char.profBonus || 2;

  engine.shortRest(state, []);
  assert(p.tempHp === prof, `Chef grants prof-bonus temp HP to the hero (got ${p.tempHp})`);
  assert((ally.tempHp || 0) >= prof, 'Chef feeds the living ally too');

  const camp = state.objects.find((o) => o.id === 'campfire');
  p.x = camp.x; p.y = camp.y;
  engine.longRest(state, []);
  assert((p.buffs || []).some((b) => b.id === 'blessed'), 'Musician blessing lands on the hero');
  assert((ally.buffs || []).some((b) => b.id === 'blessed'), 'Musician blessing lands on the ally');
});

test('Companion personal quest: offered at the threshold, progresses on kills, completes once', () => {
  const state = makeLoyaltyState(60); // Bram's line offers at 60
  const c = state.character;
  const p = engine.playerEntity(state);
  const ally = state.entities.find(e => e.kind === 'ally');

  // crossing the threshold through a real loyalty change makes the offer
  const camp = state.objects.find(o => o.id === 'campfire');
  p.x = camp.x; p.y = camp.y;
  const restEvents = [];
  engine.longRest(state, restEvents);
  assert(state.companionQuest && state.companionQuest.allyId === 'bram', 'Bram\u2019s personal quest thread opened at the threshold');
  assert(restEvents.some(e => e.type === 'quest_offer' && e.text.includes('Bram')), 'quest_offer event carries Bram\u2019s story');
  assert(c.companionQuests.bram === 'offered', 'roster marks the quest offered');

  // four crypt hound kills complete the line (spawn them so the count is deterministic)
  const events = [];
  for (let i = 0; i < 4; i++) {
    state.entities.push({ id: 'hound_' + i, kind: 'monster', monsterId: 'crypt_hound', name: 'Test Hound ' + i, x: 2, y: 2 + i, hp: 5, hpMax: 5, ac: 10, speedFt: 30, alive: true, conditions: [], buffs: [] });
    const hound = state.entities.find(e => e.id === 'hound_' + i);
    const beforeGold = c.gold;
    engine.applyDamage(state, hound, 999, 'slashing', events);
    assert(hound.alive === false, `hound ${i + 1} slain`);
    if (i < 3) assert(state.companionQuest && state.companionQuest.count === i + 1, `progress ${i + 1}/4`);
    if (i === 3) {
      assert(state.companionQuest === null, 'thread closed on completion');
      assert(c.companionQuests.bram === 'done', 'roster marks the quest done');
      assert(c.gold - beforeGold >= 60, `reward gold +60 on top of any loot (got ${c.gold - beforeGold})`);
      const gift = c.inventory[c.inventory.length - 1];
      assert(gift.rarity === 'rare' && gift.type === 'weapon', 'rolled rare weapon gift added');
      assert(events.some(e => e.type === 'quest_done' && e.text.includes('Bram')), 'quest_done event carries the story');
    }
  }
  assert(ally.loyalty >= 75, `completion loyalty surge landed (${ally.loyalty})`);

  // never offered again
  const again = [];
  engine.longRest(state, again);
  assert(!again.some(e => e.type === 'quest_offer'), 'a done line is never offered again');
});

test('Below the loyalty threshold no personal quest is offered', () => {
  const state = makeLoyaltyState(50);
  const camp = state.objects.find(o => o.id === 'campfire');
  const p = engine.playerEntity(state);
  p.x = camp.x; p.y = camp.y;
  const events = [];
  engine.longRest(state, events); // 50 -> 53, below Bram's 60
  assert(state.companionQuest == null, 'no thread below the threshold');
  assert(!events.some(e => e.type === 'quest_offer'), 'no offer event below the threshold');
});

console.log(`\nCombat Integration Tests Summary: ${passed} passed, ${failed} failed.`);
if (failed > 0) process.exit(1);
