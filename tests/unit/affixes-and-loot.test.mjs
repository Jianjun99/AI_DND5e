// tests/unit/affixes-and-loot.test.mjs — Elite Champion Affixes & Magic Loot Rarity Unit Tests
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const engine = require('../../server/game/engine.js');
const content = require('../../server/game/content.js');
const affixes = require('../../server/game/affixes.js');

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

function makeChar(className = 'fighter', level = 1) {
  const char = engine.buildCharacter({
    name: 'Testers', species: 'human', className, background: 'soldier',
    baseScores: { str: 16, dex: 12, con: 14, int: 10, wis: 10, cha: 10 }, choices: {}, feat: ''
  });
  char.id = 'unit_' + Math.random().toString(36).slice(2, 7);
  if (level > 1) { char.level = level; engine.applyClassAndSpecies(char, engine.CLASSES.find(c => c.id === className), null, level, true); }
  return char;
}

function freshState(char = makeChar()) {
  const state = engine.startGame(char, { mapId: 'crypt' });
  const p = engine.playerEntity(state);
  const mon = state.entities.find(e => e.kind === 'monster');
  state.mode = 'combat';
  state.combat = { order: [{ id: p.id, init: 20 }, { id: mon.id, init: 5 }], turnIdx: 0, round: 1 };
  p.x = mon.x - 1; p.y = mon.y;
  return { state, p, mon };
}

// map generation rolls elites at random — clear any roll before forcing a specific affix in a test
function forceAffix(mon, key) {
  mon.isElite = false;
  delete mon.affix;
  mon.resistances = [];      // drop whatever the base statblock resists so the test measures the affix alone
  mon.vulnerabilities = [];
  return affixes.applyMonsterAffix(mon, key);
}

// average damage of one attack over N swings against an AC-less dummy
function avgDamage(state, p, target, weaponId, n = 150) {
  target.ac = -20; target.hp = 99999; target.hpMax = 99999; target.alive = true;
  const rolls = [];
  for (let i = 0; i < n; i++) {
    target.hp = 99999;
    const ev = [];
    engine.playerAttack(state, target.id, weaponId, ev);
    ev.filter(e => e.type === 'attack').forEach(e => rolls.push(e.data.dmg));
  }
  return rolls.reduce((a, b) => a + b, 0) / Math.max(1, rolls.length);
}

console.log('\n--- Running Unit Tests: Elite Affixes & Loot Rarity ---');

// ---------------------------------------------------------------- affix rolls ----
test('All five monster affixes exist with HP multipliers and colours', () => {
  const keys = Object.keys(affixes.MONSTER_AFFIXES);
  assert(keys.length === 5, `Expected 5 monster affixes, got ${keys.length}`);
  for (const k of ['blazing', 'stone_skinned', 'vampiric', 'venomous', 'storm_charged']) {
    const a = affixes.MONSTER_AFFIXES[k];
    assert(a && a.hpMult >= 1.1, `${k} must raise HP`);
    assert(/^#[0-9a-f]{6}$/i.test(a.color), `${k} must define a hex colour`);
  }
});

test('applyMonsterAffix scales HP, AC, XP and never stacks twice', () => {
  const mon = { name: 'Goblin', hp: 10, hpMax: 10, ac: 13, xp: 50, attacks: [{ name: 'Scimitar', bonus: 4, damage: '1d6+2', damageType: 'slashing' }], resistances: [] };
  forceAffix(mon, 'stone_skinned');
  assert(mon.isElite === true, 'Elite flag must be set');
  assert(mon.hp === 14 && mon.hpMax === 14, `+40% HP on 10 HP => 14, got ${mon.hp}`);
  assert(mon.ac === 15, `+2 AC => 15, got ${mon.ac}`);
  assert(mon.xp === 75, `+50% XP => 75, got ${mon.xp}`);
  assert(mon.name === '石肤Goblin', `Affix title prefixes the name, got ${mon.name}`);
  const hpAfter = mon.hp;
  affixes.applyMonsterAffix(mon, 'blazing');
  assert(mon.hp === hpAfter && mon.affix.id === 'stone_skinned', 'A second affix must not stack');
});

test('Storm-charged raises attack bonus without mutating the shared monster template', () => {
  const def = content.getMonster('goblin');
  const baseBonus = def.attacks[0].bonus;
  const mon = { name: def.name, hp: 10, ac: def.ac, xp: def.xp, speedFt: def.speed, attacks: def.attacks, resistances: [] };
  affixes.applyMonsterAffix(mon, 'storm_charged');
  assert(mon.attacks[0].bonus === baseBonus + 2, `Attack bonus +2 => ${baseBonus + 2}, got ${mon.attacks[0].bonus}`);
  assert(mon.speedFt === (def.speed || 30) + 10, 'Storm-charged gains 10 ft of speed');
  assert(content.getMonster('goblin').attacks[0].bonus === baseBonus, 'Registry template must stay untouched');
});

test('Elite champions spawn from the map generator at roughly the designed rate', () => {
  let total = 0, elites = 0;
  const kinds = new Set();
  for (let i = 0; i < 60; i++) {
    const st = engine.startGame(makeChar(), { mapId: 'crypt' });
    st.entities.filter(e => e.kind === 'monster').forEach(e => {
      total++;
      if (e.isElite) { elites++; kinds.add(e.affix.id); }
    });
  }
  const rate = elites / total;
  assert(total > 300, `Expected a large monster sample, got ${total}`);
  assert(rate > 0.10 && rate < 0.28, `Elite rate should hover near 18%, got ${(rate * 100).toFixed(1)}%`);
  assert(kinds.size >= 3, `Affix variety expected, saw ${[...kinds].join(',')}`);
});

test('Bosses never spawn as elite champions', () => {
  const state = engine.startGame(makeChar(), { mapId: 'crypt' });
  const boss = state.entities.find(e => e.boss);
  if (boss) assert(!boss.isElite, 'Boss must not also be an elite champion');
});

// ---------------------------------------------------------------- combat effects ----
test('Blazing champion adds fire damage and resists fire', () => {
  const { state, mon } = freshState();
  mon.hp = 100; mon.hpMax = 100;
  forceAffix(mon, 'blazing');
  mon.hp = 100;
  engine.applyDamage(state, mon, 20, 'fire', []);
  assert(mon.hp === 90, `Fire resistance halves 20 => 10 damage, got ${100 - mon.hp}`);
  mon.hp = 100;
  engine.applyDamage(state, mon, 20, 'slashing', []);
  assert(mon.hp === 80, `Non-fire damage is not resisted, got ${100 - mon.hp}`);
});

test('Stone-skinned champion resists mundane weapons but not magic ones', () => {
  const { state, mon } = freshState();
  forceAffix(mon, 'stone_skinned');
  mon.hp = 100;
  engine.applyDamage(state, mon, 20, 'slashing', []);
  assert(mon.hp === 90, `Mundane slashing is halved, got ${100 - mon.hp}`);
  mon.hp = 100;
  engine.applyDamage(state, mon, 20, 'slashing', [], { magical: true });
  assert(mon.hp === 80, `A magic weapon cuts through the resistance, got ${100 - mon.hp}`);
});

test('Vampiric champion heals for half the damage it deals', () => {
  const { state, p, mon } = freshState();
  forceAffix(mon, 'vampiric');
  mon.hp = 20; mon.hpMax = 100;
  mon.aware = true;
  p.hp = p.hpMax;
  const ev = [];
  engine.monsterAttack(state, mon, p, mon.attacks[0], ev);
  const hurt = p.hpMax - p.hp;
  if (hurt > 0) assert(mon.hp > 20, `Vampiric leech must heal the champion (hp ${mon.hp} after ${hurt} damage dealt)`);
  else assert(mon.hp === 20, 'No damage dealt means no leech');
});

test('Venomous champion poisons its victim with disadvantage on attacks', () => {
  const { state, p, mon } = freshState();
  forceAffix(mon, 'venomous');
  mon.aware = true;
  // an always-hitting champion: only a natural 1 can miss, so the assertion does not depend on
  // the dice (a +4 skeleton against AC 18 missed ~70% of the time and made this test flaky)
  const alwaysHits = { ...mon.attacks[0], bonus: 99 };
  mon.attacks = [alwaysHits];
  let poisoned = false;
  let timedBuff = false;
  for (let i = 0; i < 12 && !poisoned; i++) {
    p.hp = p.hpMax;   // death wipes buffs, so the victim must survive the loop
    const ev = [];
    engine.monsterAttack(state, mon, p, alwaysHits, ev);
    if (p.conditions.includes('poisoned')) {
      poisoned = true;
      timedBuff = (p.buffs || []).some(b => b.condId === 'poisoned');
    }
  }
  assert(poisoned, 'A venomous hit must inflict the poisoned condition');
  assert(timedBuff, 'Poisoned must carry a timed buff so it expires');
  const mods = engine.attackMods(state, p, mon, { name: 'test', ranged: false, dmgType: 'slashing' }, []);
  assert(mods.dis === true, 'A poisoned attacker rolls with disadvantage');
});

// ---------------------------------------------------------------- item affixes ----
test('rollMagicItem produces rarity tiers with working modifiers', () => {
  const magic = affixes.rollMagicItem('magic', { category: 'weapon' });
  assert(magic.rarity === 'magic' && magic.uniqueId, 'Magic weapons carry a rarity and unique id');
  assert(magic.bonusDamage || magic.magic || magic.vampiricHeal, 'Magic weapons must carry at least one modifier');

  const legendary = affixes.rollMagicItem('legendary', { category: 'weapon' });
  assert(legendary.magic === 2, `Legendary weapons are +2, got +${legendary.magic}`);
  assert(legendary.name.startsWith('传奇·'), `Legendary naming, got ${legendary.name}`);

  const armor = affixes.rollMagicItem('rare', { category: 'armor' });
  assert(['armor', 'shield'].includes(armor.type), `Armour rolls must be wearable, got ${armor.type}`);
  assert(armor.acBonus || armor.hpBonus || armor.speedBonus, 'Armour affixes must do something');

  const ids = new Set();
  for (let i = 0; i < 40; i++) ids.add(affixes.rollMagicItem('magic').uniqueId);
  assert(ids.size === 40, `Rolled items must always get distinct ids, got ${ids.size}/40`);
});

test('Equipped affix armour grants AC and Vigor HP, and gives them back on unequip', () => {
  const char = makeChar('fighter');
  const state = engine.startGame(char, { mapId: 'crypt' });
  const c = state.character;
  const p = engine.playerEntity(state);
  const baseAc = engine.currentAc(state, p);
  const baseHp = c.hpMax;

  const stalwart = { itemId: 'chain_mail', uniqueId: 'test_stalwart', name: '坚毅之锁子甲', rarity: 'rare', type: 'armor', acBonus: 2, qty: 1 };
  const vigor = { itemId: 'leather', uniqueId: 'test_vigor', name: '活力之皮甲', rarity: 'magic', type: 'armor', hpBonus: 5, qty: 1 };
  c.inventory.push(stalwart, vigor);
  c.equipped.armor = 'test_stalwart';
  engine.applyClassAndSpecies(c, engine.CLASSES.find(x => x.id === 'fighter'), null, 1, true);
  const withArmor = engine.currentAc(state, p);
  assert(withArmor >= baseAc + 2, `坚毅 armour adds +2 AC on top of the base armour (${baseAc} => ${withArmor})`);

  c.equipped.armor = 'test_vigor';
  engine.applyClassAndSpecies(c, engine.CLASSES.find(x => x.id === 'fighter'), null, 1, true);
  assert(c.hpMax === baseHp + 5, `Vigor adds +5 max HP (${baseHp} => ${c.hpMax})`);

  c.equipped.armor = null;
  engine.applyClassAndSpecies(c, engine.CLASSES.find(x => x.id === 'fighter'), null, 1, true);
  assert(c.hpMax === baseHp, `Unequipping Vigor removes the bonus HP, got ${c.hpMax}`);
});

test('A rolled affix weapon is wielded with its own name, enhancement and damage dice', () => {
  const { state, p, mon } = freshState();
  const c = state.character;

  const plainAvg = avgDamage(state, p, mon, 'longsword');

  const flaming = {
    itemId: 'longsword', uniqueId: 'test_flaming', name: '精铸·炽火之长剑', rarity: 'rare',
    affix: 'blazing', type: 'weapon', magic: 1, bonusDamage: { dice: '1d4', type: 'fire' }, cost: 75, qty: 1
  };
  engine.addItemToInventory(c, flaming);
  c.equipped.mainHand = 'test_flaming';
  engine.applyClassAndSpecies(c, engine.CLASSES.find(x => x.id === 'fighter'), null, 1, true);

  const entry = c.attacks.find(a => a.weaponId === 'test_flaming');
  assert(entry, 'The rolled weapon must appear in the attack list');
  assert(entry.name === '精铸·炽火之长剑', `Attack uses the rolled name, got ${entry.name}`);
  assert(entry.magic === 1 && entry.dmgMod >= 4, `+1 enhancement folded into hit and damage (bonus ${entry.bonus}, dmgMod ${entry.dmgMod})`);
  assert(entry.bonusDamage && entry.bonusDamage.type === 'fire', '+1d4 fire riding on the attack');
  assert(c.attacks[0].weaponId === 'test_flaming', 'The wielded weapon leads the attack list');

  const magicAvg = avgDamage(state, p, mon, 'test_flaming');
  const expectedGain = 1 + 2.5; // +1 enhancement (always) + 1d4 fire (average 2.5)
  assert(magicAvg >= plainAvg + expectedGain - 1.0, `Magic weapon should hit ~${expectedGain.toFixed(1)} harder than the plain sword (${plainAvg.toFixed(1)} => ${magicAvg.toFixed(1)})`);
  assert(magicAvg <= plainAvg + expectedGain + 1.0, `Enhancement must not be applied twice (${plainAvg.toFixed(1)} => ${magicAvg.toFixed(1)})`);
});

test('Weapon damage includes the ability modifier', () => {
  const { state, p, mon } = freshState();
  const strMod = Math.floor((state.character.abilities.str - 10) / 2);
  const avg = avgDamage(state, p, mon, 'longsword');
  const plainDice = 4.5; // 1d8
  assert(avg >= plainDice + strMod - 0.5, `STR ${state.character.abilities.str} (${strMod >= 0 ? '+' : ''}${strMod}) must ride on damage (avg ${avg.toFixed(1)} with 1d8)`);
});

test('Vampiric weapons restore HP to the wielder on a hit', () => {
  const char = makeChar('fighter', 3);
  const state = engine.startGame(char, { mapId: 'crypt' });
  const c = state.character;
  const p = engine.playerEntity(state);
  const mon = state.entities.find(e => e.kind === 'monster');
  state.mode = 'combat';
  state.combat = { order: [{ id: p.id, init: 20 }, { id: mon.id, init: 5 }], turnIdx: 0, round: 1 };
  p.x = mon.x - 1; p.y = mon.y;
  const leech = { itemId: 'rapier', uniqueId: 'test_leech', name: '嗜血之刺剑', rarity: 'rare', type: 'weapon', affix: 'vampiric', vampiricHeal: 2, qty: 1 };
  engine.addItemToInventory(c, leech);
  c.equipped.mainHand = 'test_leech';
  engine.applyClassAndSpecies(c, engine.CLASSES.find(x => x.id === 'fighter'), null, 3, true);

  p.hp = p.hpMax - 10;
  mon.ac = -20; mon.hp = 500; mon.hpMax = 500;
  const before = p.hp;
  // a natural 1 always misses, so swing until one lands
  for (let i = 0; i < 12 && p.hp === before; i++) {
    const ev = [];
    engine.playerAttack(state, mon.id, 'test_leech', ev);
  }
  assert(p.hp === before + 2, `Vampiric weapon heals 2 HP on a hit (${before} => ${p.hp})`);
});

// ---------------------------------------------------------------- loot rolls ----
test('Standard monsters drop table loot, elites and bosses guarantee magic gear', () => {
  const runKill = (setup) => {
    const char = makeChar('fighter', 4);
    const state = engine.startGame(char, { mapId: 'crypt' });
    const c = state.character;
    const invBefore = c.inventory.length;
    const goldBefore = c.gold;
    const mon = state.entities.find(e => e.kind === 'monster');
    mon.xp = 50;
    setup(mon);
    const ev = [];
    engine.rollLoot(state, mon, ev);
    return {
      newItems: c.inventory.slice(invBefore),
      gold: c.gold - goldBefore,
      events: ev.map(e => e.text).join(' | ')
    };
  };

  // 1. Elite: always a magic/rare item + 15-30 bonus gold
  for (let i = 0; i < 12; i++) {
    const r = runKill(m => affixes.applyMonsterAffix(m, 'blazing'));
    const rolled = r.newItems.filter(i => i.rarity);
    assert(rolled.length >= 1, `Elite must always drop rolled gear (run ${i}, got ${r.newItems.length} items)`);
    assert(['magic', 'rare'].includes(rolled[0].rarity), `Elite drop rarity must be magic or rare, got ${rolled[0].rarity}`);
    assert(r.gold >= 15, `Elite bonus gold is at least 15 gp, got ${r.gold}`);
    assert(/ELITE SLAIN/.test(r.events), 'Elite slaying announces the trophy drop');
  }

  // 2. Boss: always rare/legendary (bosses are not elite champions, so clear any random elite roll)
  for (let i = 0; i < 12; i++) {
    const r = runKill(m => { m.boss = true; m.isElite = false; delete m.affix; });
    const rolled = r.newItems.filter(i => i.rarity);
    assert(rolled.length >= 1, 'Boss must always drop rolled gear');
    assert(['rare', 'legendary'].includes(rolled[0].rarity), `Boss drop rarity must be rare or legendary, got ${rolled[0].rarity}`);
    assert(r.gold >= 50, `Boss bonus gold is at least 50 gp, got ${r.gold}`);
  }

  // 3. Standard (non-elite) monsters: mostly plain loot, ~5% magic
  let magicCount = 0;
  const N = 300;
  for (let i = 0; i < N; i++) {
    const r = runKill(m => { m.isElite = false; delete m.affix; });
    magicCount += r.newItems.filter(it => it.rarity).length;
  }
  const rate = magicCount / N;
  assert(rate > 0.01 && rate < 0.12, `Standard magic item rate should be near 5%, got ${(rate * 100).toFixed(1)}%`);

  // 4. A champion's dropped gear is immediately usable by the engine
  const r = runKill(m => affixes.applyMonsterAffix(m, 'stone_skinned'));
  const rolled = r.newItems.find(i => i.rarity);
  const state2 = engine.startGame(makeChar('fighter'), { mapId: 'crypt' });
  const c2 = state2.character;
  engine.addItemToInventory(c2, rolled);
  if (rolled.type === 'weapon') {
    c2.equipped.mainHand = rolled.uniqueId;
    engine.applyClassAndSpecies(c2, engine.CLASSES.find(x => x.id === 'fighter'), null, 1, true);
    assert(c2.attacks.some(a => a.weaponId === rolled.uniqueId), 'Dropped weapon is wieldable by its unique id');
  } else {
    c2.equipped.armor = rolled.uniqueId;
    engine.applyClassAndSpecies(c2, engine.CLASSES.find(x => x.id === 'fighter'), null, 1, true);
    assert(engine.invEntry(c2, rolled.uniqueId) != null, 'Dropped armour resolves by its unique id');
  }
});

test('Every rolled item base is a real catalogue item', () => {
  const weaponIds = new Set(engine.WEAPONS.map(w => w.id));
  const armorIds = new Set(engine.ARMORS.map(a => a.id));
  for (let i = 0; i < 60; i++) {
    const it = affixes.rollMagicItem(['magic', 'rare', 'legendary'][i % 3]);
    if (it.type === 'weapon') assert(weaponIds.has(it.itemId), `Weapon base ${it.itemId} must exist in the weapon table`);
    else assert(armorIds.has(it.itemId) || it.itemId === 'shield', `Armour base ${it.itemId} must be wearable`);
    assert(it.cost > 0, 'Rolled gear keeps a sale value');
    assert(engine.itemName(it.itemId) !== it.itemId, `Base item ${it.itemId} resolves to a display name`);
  }
});

console.log(`\nAffix & Loot Unit Tests Summary: ${passed} passed, ${failed} failed.`);
if (failed > 0) process.exit(1);
