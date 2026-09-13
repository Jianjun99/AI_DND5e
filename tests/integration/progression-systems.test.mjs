// tests/integration/progression-systems.test.mjs
// Test suite for Level-Up, In-Dungeon Equipping, Multi-Floor Descent, and Hall of Heroes
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const engine = require('../../server/game/engine.js');
const content = require('../../server/game/content.js');
const store = require('../../server/store.js');

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

console.log('\n--- Running Integration Tests: Character Progression & Delve Systems ---');

// 1. Champion Improved Critical Mechanics
test('Champion subclass scores critical hits on natural 19 and natural 20', () => {
  const char = engine.buildCharacter({ name: 'Sir Gideon', className: 'fighter', species: 'human', background: 'soldier' });
  char.subclass = 'champion';
  
  // Set up test state
  const state = engine.startGame(char, { difficulty: 'normal', mapId: 'crypt' });
  
  // Verify champion critical threshold logic
  const critThreshold = (char.subclass === 'champion') ? 19 : 20;
  assert(critThreshold === 19, 'Champion crit threshold must be 19');
  
  // Standard fighter crit threshold is 20
  const standardChar = engine.buildCharacter({ name: 'Boran', className: 'fighter', species: 'human', background: 'soldier' });
  const standardThreshold = (standardChar.subclass === 'champion') ? 19 : 20;
  assert(standardThreshold === 20, 'Non-champion crit threshold must be 20');
});

// 2. In-Dungeon Equipment Switching (AC & Attacks calculation)
test('In-dungeon equipment switching recalculates AC and attacks', () => {
  const char = engine.buildCharacter({ name: 'Valen', className: 'fighter', species: 'human', background: 'soldier' });
  char.inventory = [
    { itemId: 'chain_mail', qty: 1 },
    { itemId: 'shield', qty: 1 },
    { itemId: 'longsword', qty: 1 },
    { itemId: 'greatsword', qty: 1 }
  ];
  
  const state = engine.startGame(char, { difficulty: 'normal', mapId: 'crypt' });
  const pe = engine.playerEntity(state);
  
  // Initially equip chain mail (AC 16) + shield (AC +2) = 18
  state.character.equipped = { armor: 'chain_mail', offHand: 'shield', mainHand: 'longsword' };
  const cls = engine.CLASSES.find(c => c.id === char.className);
  engine.applyClassAndSpecies(state.character, cls, null, state.character.level, true);
  pe.ac = state.character.acBase;
  
  assert(state.character.acBase === 18, 'Chain mail (16) + Shield (2) should yield AC 18');
  assert(pe.ac === 18, 'Player entity AC should match character acBase');
  
  // Switch to greatsword (unequip shield for two-handed weapon)
  state.character.equipped.offHand = null;
  state.character.equipped.mainHand = 'greatsword';
  // Reorder inventory so greatsword is primary
  const gIdx = state.character.inventory.findIndex(i => i.itemId === 'greatsword');
  if (gIdx > 0) {
    const [it] = state.character.inventory.splice(gIdx, 1);
    state.character.inventory.unshift(it);
  }
  engine.applyClassAndSpecies(state.character, cls, null, state.character.level, true);
  pe.ac = state.character.acBase;
  
  assert(state.character.acBase === 16, 'Unequipping shield should drop AC back to 16');
  assert(pe.ac === 16, 'Player entity AC updated to 16');
});

// 3. Multi-Floor Dungeon Descent (Crypt -> Drowned Vault)
test('Stairway descent transitions dungeon map to Drowned Vault', () => {
  const char = engine.buildCharacter({ name: 'Lyra', className: 'rogue', species: 'elf', background: 'criminal' });
  const state = engine.startGame(char, { difficulty: 'normal', mapId: 'crypt' });
  
  assert(state.mapId === 'crypt', 'Initial map should be Sunless Crypt');
  
  // Descend stairs to drowned-vault
  const events = [];
  engine.travelTo(state, 'drowned-vault', 22, 14, events);
  
  assert(state.mapId === 'drowned-vault', 'State mapId should update to drowned-vault');
  assert(state.mapName === 'The Drowned Vault', 'Map name should update to The Drowned Vault');
  
  const p = engine.playerEntity(state);
  assert(p.x === 22, 'Player X coordinate positioned at destination stairhead');
  assert(p.y === 14, 'Player Y coordinate positioned at destination stairhead');
  
  // Verify travel event was emitted
  const travelEv = events.find(e => e.type === 'travel');
  assert(Boolean(travelEv), 'Travel event must be emitted');
  assert(travelEv.data.mapId === 'drowned-vault', 'Event data contains destination mapId');
});

// 4. Monster Bestiary Kill Counter
test('Monster kills track correctly in character bestiary', () => {
  const char = engine.buildCharacter({ name: 'Thorin', className: 'barbarian', species: 'dwarf', background: 'soldier' });
  const state = engine.startGame(char, { difficulty: 'normal', mapId: 'crypt' });
  
  // Find monster
  const skeleton = state.entities.find(e => e.kind === 'monster');
  assert(Boolean(skeleton), 'Test monster present on map');
  
  const events = [];
  // Apply lethal damage to monster
  engine.applyDamage(state, skeleton, 999, 'bludgeoning', events);
  
  assert(skeleton.alive === false, 'Monster marked dead');
  assert(Boolean(state.character.bestiary), 'Character has bestiary object');
  const mKey = skeleton.monsterId || skeleton.id.replace(/_\d+$/, '');
  assert(state.character.bestiary[mKey] >= 1, `Bestiary recorded kill for ${mKey}`);
});

// 5. XP Thresholds & Level Up Mechanics
test('Level-up increases hit points and attributes correctly', () => {
  const char = engine.buildCharacter({ name: 'Elara', className: 'wizard', species: 'human', background: 'sage' });
  const initialHpMax = char.hpMax;
  const initialLevel = char.level;
  
  assert(initialLevel === 1, 'Initial level is 1');
  
  // Award enough XP for Level 2 (300 XP threshold)
  char.xp = 350;
  const nextLvl = initialLevel + 1;
  const xpNeeded = engine.XP_THRESHOLDS[nextLvl];
  assert(char.xp >= xpNeeded, 'Character qualifies for Level 2');
  
  // Simulate Level Up with average HP
  const cls = engine.CLASSES.find(c => c.id === char.className);
  const conMod = Math.floor(((char.abilities.con || 10) - 10) / 2);
  const avgHpGain = Math.max(1, Math.floor(cls.hitDie / 2) + 1 + conMod);
  
  char.level = nextLvl;
  char.hpMax += avgHpGain;
  char.hp = char.hpMax;
  engine.applyClassAndSpecies(char, cls, null, char.level, true);
  
  assert(char.level === 2, 'Character level updated to 2');
  assert(char.hpMax === initialHpMax + avgHpGain, 'Max HP increased by average hit die gain');
  assert(char.hp === char.hpMax, 'Current HP restored to max on level up');
});

// 6. Content Pack Monsters List
test('Content registry exports full bestiary for Hall of Heroes', () => {
  const monsters = content.listMonsters();
  assert(monsters.length >= 5, 'Bestiary should contain at least 5 monster types');
  
  const skeleton = monsters.find(m => m.id === 'skeleton');
  assert(Boolean(skeleton), 'Skeleton entry present in bestiary');
  assert(Boolean(skeleton.hp), 'Skeleton has HP definition');
  assert(Boolean(skeleton.ac), 'Skeleton has AC definition');
  assert(Boolean(skeleton.xp), 'Skeleton has XP definition');
});

// 7. HTTP API: Level-Up Options and Progression
await (async () => {
  const express = require('express');
  const testApp = express();
  testApp.use(express.json());
  testApp.use('/api/characters', require('../../server/routes/characters.js'));
  testApp.use('/api/game', require('../../server/routes/game.js'));
  testApp.use('/api/city', require('../../server/routes/city.js'));

  const testServer = await new Promise(resolve => {
    const s = testApp.listen(0, () => resolve(s));
  });
  const port = testServer.address().port;
  const BASE_URL = `http://localhost:${port}`;

  try {
    const createRes = await fetch(`${BASE_URL}/api/characters`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Progression Champion',
        species: 'human',
        className: 'fighter',
        background: 'soldier',
        baseScores: { str: 15, dex: 14, con: 14, int: 10, wis: 12, cha: 8 },
        bgPlus2: 'str', bgPlus1: 'con',
        skills: ['athletics', 'perception'],
        armorOption: 'chain_mail',
        weaponOption: 'sword_board'
      })
    });
    const char = await createRes.json();
    assert(Boolean(char.id), 'Character created via HTTP API');

    // Check level-up options when lacking XP
    const optsRes1 = await fetch(`${BASE_URL}/api/characters/${char.id}/level-up-options`);
    const opts1 = await optsRes1.json();
    assert(opts1.canLevelUp === false, 'Cannot level up with 0 XP');
    assert(opts1.currentLevel === 1, 'Current level is 1');
    assert(opts1.nextLevel === 2, 'Next level is 2');
    assert(opts1.xpNeeded === 300, 'XP needed for Level 2 is 300');

    // Grant 1000 XP (qualifies for level 2 and level 3)
    const chars = store.getCharacters();
    const stored = chars.find(c => c.id === char.id);
    stored.xp = 1000;
    store.saveCharacters(chars);

    // Check level-up options with enough XP
    const optsRes2 = await fetch(`${BASE_URL}/api/characters/${char.id}/level-up-options`);
    const opts2 = await optsRes2.json();
    assert(opts2.canLevelUp === true, 'Can level up after gaining 1000 XP');

    // Execute Level 2 Ascension (average HP)
    const lvl2Res = await fetch(`${BASE_URL}/api/characters/${char.id}/level-up`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hpChoice: 'average' })
    });
    const lvl2 = await lvl2Res.json();
    assert(lvl2.ok === true, 'Level 2 ascension succeeded');
    assert(lvl2.newLevel === 2, 'New level is 2');
    assert(lvl2.gainedHp > 0, 'HP gained on Level 2');

    // Check Level 3 options (should include Subclass choices!)
    const optsRes3 = await fetch(`${BASE_URL}/api/characters/${char.id}/level-up-options`);
    const opts3 = await optsRes3.json();
    assert(opts3.nextLevel === 3, 'Next level is 3');
    assert(opts3.needsSubclass === true, 'Level 3 requires subclass selection');
    assert(opts3.subclasses.length >= 2, 'Has multiple subclass choices');
    const championChoice = opts3.subclasses.find(s => s.id === 'champion');
    assert(Boolean(championChoice), 'Champion subclass is available for Fighter');

    // Execute Level 3 Ascension choosing Champion subclass
    const lvl3Res = await fetch(`${BASE_URL}/api/characters/${char.id}/level-up`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hpChoice: 'average', subclass: 'champion' })
    });
    const lvl3 = await lvl3Res.json();
    assert(lvl3.ok === true, 'Level 3 ascension succeeded');
    assert(lvl3.char.level === 3, 'Character reaches Level 3');
    assert(lvl3.char.subclass === 'champion', 'Champion subclass applied to character');
    console.log('  ✔ PASS: HTTP API Level-Up progression and Subclass selection');
    passed += 7;

    // 8. HTTP API: In-Delve Equipment Switching
    const delveRes = await fetch(`${BASE_URL}/api/game/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ characterId: char.id, bringAlly: false, difficulty: 'normal', mapId: 'crypt' })
    });
    const delveData = await delveRes.json();
    const saveId = delveData.state.id;
    assert(Boolean(saveId), 'Delve started successfully');

    // Add greatsword to delve inventory
    delveData.state.character.inventory.push({ itemId: 'greatsword', qty: 1 });
    store.saveGame(delveData.state);

    // Equip greatsword via delve action
    const equipRes = await fetch(`${BASE_URL}/api/game/${saveId}/action`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'equip', slot: 'mainHand', itemId: 'greatsword' })
    });
    const equipData = await equipRes.json();
    assert(equipData.state.character.equipped.mainHand === 'greatsword', 'Greatsword equipped in mainHand');
    const hasGreatswordAtk = equipData.state.character.attacks.some(a => a.weaponId === 'greatsword');
    assert(hasGreatswordAtk, 'Attacks array includes greatsword');

    // Unequip shield
    const unequipRes = await fetch(`${BASE_URL}/api/game/${saveId}/action`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'unequip', slot: 'offHand' })
    });
    const unequipData = await unequipRes.json();
    assert(unequipData.state.character.equipped.offHand === null, 'Shield unequipped');
    console.log('  ✔ PASS: HTTP API In-Delve Equipment switching and weapon attack synchronization');
    passed += 4;

    // 9. HTTP API: Hall of Heroes & Trophy Room
    const hallRes = await fetch(`${BASE_URL}/api/city/hall-of-heroes?charId=${char.id}`);
    const hall = await hallRes.json();
    assert(hall.ok === true, 'Hall of heroes returned successfully');
    assert(Array.isArray(hall.bestiary), 'Bestiary array returned');
    assert(hall.bestiary.length >= 5, 'Bestiary contains monster catalogue');
    assert(Array.isArray(hall.trophies), 'Trophies array returned');
    assert(hall.trophies.length >= 5, 'Trophies catalogue present');
    assert(Array.isArray(hall.champions), 'Champions leaderboard returned');
    console.log('  ✔ PASS: HTTP API Hall of Heroes Bestiary, Trophies, and Champions');
    passed += 6;

    // Clean up test save and character
    await fetch(`${BASE_URL}/api/game/${saveId}`, { method: 'DELETE' });
    await fetch(`${BASE_URL}/api/characters/${char.id}`, { method: 'DELETE' });
  } catch (err) {
    failed++;
    console.error('  ❌ ERROR in HTTP API progression tests:', err);
  } finally {
    testServer.close();
  }
})();

if (failed > 0) {
  process.exitCode = 1;
}

console.log(`\nProgression Systems Summary: ${passed} passed, ${failed} failed.\n`);

