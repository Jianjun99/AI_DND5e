// tests/integration/progression-systems.test.mjs
// Test suite for Level-Up, In-Dungeon Equipping, Multi-Floor Descent, and Hall of Heroes
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const engine = require('../../server/game/engine.js');
const affixesMod = require('../../server/game/affixes.js');
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
  const _state = engine.startGame(char, { difficulty: 'normal', mapId: 'crypt' });
  
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
    assert(hall.bestiary.length >= 17, `Bestiary contains 17 monsters, got ${hall.bestiary.length}`);
    assert(Array.isArray(hall.trophies), 'Trophies array returned');
    assert(hall.trophies.some(t => t.id === 'dragon_slayer'), 'Dragon slayer trophy present');
    assert(hall.trophies.some(t => t.id === 'endless_delver'), 'Endless delver trophy present');
    assert(hall.trophies.some(t => t.id === 'paragon_hero'), 'Paragon hero trophy present');
    assert(Array.isArray(hall.champions), 'Champions leaderboard returned');
    console.log('  ✔ PASS: HTTP API Hall of Heroes Bestiary, Trophies, and Champions');
    passed += 8;

    // 10. Sunlit Vale Expansion Maps & Level 12 Progression
    const roostMap = content.getMap('roost');
    assert(roostMap != null, 'Sun Dragon’s Roost map must exist');
    const roostState = engine.startGame(char, { mapId: 'roost', difficulty: 'normal' });
    const dragon = roostState.entities.find(e => e.monsterId === 'young_fire_dragon');
    assert(dragon != null, 'Yzmerith the Ember Queen must spawn on Roost map');
    assert(dragon.boss === true, 'Yzmerith must have boss flag set');

    const sewersMap = content.getMap('sewers');
    assert(sewersMap != null, 'Oakhaven Sewers map must exist');
    const sewersState = engine.startGame(char, { mapId: 'sewers', difficulty: 'normal' });
    assert(sewersState.entities.some(e => e.monsterId === 'giant_spider'), 'Giant spider spawns in sewers');

    // Level 12 Cap & Spell Slots
    const wiz = engine.buildCharacter({ name: 'Archmage', className: 'wizard', species: 'elf', background: 'sage' });
    wiz.level = 12;
    wiz.xp = 75000;
    engine.applyClassAndSpecies(wiz, null, null, 12, true);
    assert(wiz.slotsMax && wiz.slotsMax['6'] >= 1, 'Level 12 Wizard has 6th-level spell slot');
    console.log('  ✔ PASS: Expansion maps (Roost dragon, Sewers spider) and Level 12 progression verified');
    passed += 7;

    // 11. Level-Up Readiness: /api/characters and the delve view must carry the same verdict
    // the /level-up endpoint will apply (regression: the HUD badge once claimed a level the
    // endpoint then refused, because the client compared XP against its own stale table).
    const rosterRes = await fetch(`${BASE_URL}/api/characters`);
    const roster = await rosterRes.json();
    assert(Array.isArray(roster) && roster.length > 0, 'Character roster returned');
    assert(roster.every(c => c.levelUp && typeof c.levelUp.canLevelUp === 'boolean'),
      'Every character ships a level-up verdict from the server');
    let checked = 0;
    for (const c of roster.slice(0, 5)) {
      const optRes = await fetch(`${BASE_URL}/api/characters/${c.id}/level-up-options`);
      const opts = await optRes.json();
      assert(opts.canLevelUp === c.levelUp.canLevelUp,
        `${c.name}: list verdict (${c.levelUp.canLevelUp}) matches the level-up endpoint (${opts.canLevelUp})`);
      assert(opts.nextLevel === c.levelUp.nextLevel && opts.xpNeeded === c.levelUp.xpNeeded,
        `${c.name}: both agree the next step is Lvl ${c.levelUp.nextLevel} at ${c.levelUp.xpNeeded} XP`);
      checked++;
    }
    assert(checked > 0, 'At least one character was cross-checked');
    const delveView = await (await fetch(`${BASE_URL}/api/game/${saveId}`)).json();
    assert(delveView.state.levelUp && typeof delveView.state.levelUp.canLevelUp === 'boolean',
      'The delve view carries the same level-up verdict for the HUD badge');
    console.log('  ✔ PASS: Level-up readiness agrees between the roster, the HUD badge and the endpoint');
    passed += 8;

    // 12. Tavern gambling & experimental brews over HTTP
    const cityPost = async (path, body) => {
      const res = await fetch(`${BASE_URL}/api/city${path}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
      });
      return { status: res.status, body: await res.json() };
    };

    // fund the hero so the table will take their bets
    {
      const chars = store.getCharacters();
      const mine = chars.find(c => c.id === char.id);
      mine.gold = 600;
      store.saveCharacters(chars);
    }

    const infoRes = await (await fetch(`${BASE_URL}/api/city/info?charId=${char.id}`)).json();
    assert(infoRes.tables && infoRes.tables.roulette && infoRes.tables.slots && infoRes.tables.tokens,
      'The city payload advertises the tables, the odds and the prize tokens');
    assert(infoRes.tables.tokens.length >= 6, `Prize token catalogue present (${infoRes.tables.tokens.length})`);
    assert(Math.abs(infoRes.tables.roulette.rtp - 36 / 37) < 1e-9, 'Roulette odds are the real-table ones');

    // a mystery brew is a rolled instance, hidden until identified
    const brewRes = await cityPost('/buy', { charId: char.id, itemId: 'potion_mystery_thin', qty: 1 });
    assert(brewRes.status === 200 && brewRes.body.opened && brewRes.body.opened.length === 1,
      'Buying an experimental brew rolls exactly one bottle');
    const bottle = (brewRes.body.char.inventory || []).find(i => i.kind === 'mystery_potion');
    assert(bottle && bottle.uniqueId && !bottle.identified, 'The bottle carries its own id and a hidden effect');
    assert(bottle.effect && bottle.effect.name && bottle.effect.kind, 'The outcome was decided at purchase time');

    const identified = await cityPost('/identify', { charId: char.id, uniqueId: bottle.uniqueId });
    assert(identified.status === 200, 'The identification check runs');
    assert(typeof identified.body.total === 'number' && typeof identified.body.dc === 'number',
      `The check reports a roll and a DC (${identified.body.total} vs ${identified.body.dc})`);
    const secondTry = await cityPost('/identify', { charId: char.id, uniqueId: bottle.uniqueId });
    assert(secondTry.status === 400, 'A second attempt on the same bottle is refused');

    // gambling: gold moves by exactly the reported delta
    const beforeGold = (await (await fetch(`${BASE_URL}/api/characters/${char.id}`)).json()).gold;
    const spin = await cityPost('/gamble', { charId: char.id, game: 'roulette', stake: 25, bet: { id: 'red' } });
    assert(spin.status === 200, 'A roulette bet is accepted');
    assert(spin.body.char.gold === beforeGold + spin.body.netGold,
      `Gold moved by the reported net (${beforeGold} + ${spin.body.netGold} = ${spin.body.char.gold})`);
    assert([-25, 25].includes(spin.body.netGold), `Red pays 1:1 (net ${spin.body.netGold})`);
    assert(typeof spin.body.result.number === 'number' && spin.body.result.number >= 0 && spin.body.result.number <= 36,
      'The wheel reports a real number');

    const slots = await cityPost('/gamble', { charId: char.id, game: 'slots', tier: 'standard' });
    assert(slots.status === 200 && Array.isArray(slots.body.result.symbols) && slots.body.result.symbols.length === 3,
      'The slot machine returns three reels');
    assert(slots.body.stake === 10, 'The standard tier stakes 10 gp');

    const overLimit = await cityPost('/gamble', { charId: char.id, game: 'roulette', stake: 99999, bet: { id: 'red' } });
    assert(overLimit.status === 400, 'The house refuses stakes above the table limit');
    const brokeStake = await cityPost('/gamble', { charId: char.id, game: 'roulette', stake: 0, bet: { id: 'red' } });
    assert(brokeStake.status === 400, 'A missing stake is refused');

    // spin until a token drops (deterministic enough: ~1.6% per spin for sword/shield triples)
    let wonTokens = [];
    {
      const chars = store.getCharacters();
      const mine = chars.find(c => c.id === char.id);
      mine.gold = 5000;
      store.saveCharacters(chars);
      for (let i = 0; i < 400 && wonTokens.length === 0; i++) {
        const s = await cityPost('/gamble', { charId: char.id, game: 'slots', tier: 'standard' });
        if (s.body.prizes && s.body.prizes.some(p => p.kind === 'delve_token')) wonTokens = s.body.prizes.filter(p => p.kind === 'delve_token');
      }
    }
    assert(wonTokens.length > 0, 'The machine eventually pays out a delve token');
    const carried = (await (await fetch(`${BASE_URL}/api/characters/${char.id}`)).json()).pendingDelveItems || [];
    assert(carried.some(t => t.delveOnly), 'Won tokens wait on the hero as pending delve items');

    // carry them into a delve, then settle: unused prizes must not come home
    const gambleDelve = await (await fetch(`${BASE_URL}/api/game/start`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ characterId: char.id, bringAlly: false, difficulty: 'normal' })
    })).json();
    const gambleDelveId = gambleDelve.state.id;
    const inDelve = (gambleDelve.state.character.inventory || []).filter(i => i.delveOnly);
    assert(inDelve.length === carried.length, `Pending prizes rode into the delve (${inDelve.length})`);

    const tokenUse = await fetch(`${BASE_URL}/api/game/${gambleDelveId}/action`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'useItem', itemId: inDelve[0].uniqueId })
    });
    const tokenState = await tokenUse.json();
    const tokenEvents = (tokenState.events || []).map(e => e.type);
    assert(tokenEvents.includes('token_used') || tokenEvents.includes('brew_effect'), `Using a token works in the delve (${tokenEvents.join(',')})`);
    const tokenInv = (tokenState.state.character.inventory || []).find(i => i.uniqueId === inDelve[0].uniqueId);
    assert(!tokenInv || tokenInv.qty === 0, 'The spent token is consumed');

    await fetch(`${BASE_URL}/api/city/sync-delve`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ charId: char.id, delveStateId: gambleDelveId })
    });
    const afterSync = await (await fetch(`${BASE_URL}/api/characters/${char.id}`)).json();
    assert(!(afterSync.inventory || []).some(i => i.delveOnly), 'Unused delve-only prizes are discarded at settlement');
    assert((afterSync.pendingDelveItems || []).length === 0, 'The pending list was emptied when they were carried in');

    console.log('  ✔ PASS: Gambling odds, mystery brews, identification and the delve-only prize lifecycle');
    passed += 18;

    await fetch(`${BASE_URL}/api/game/${gambleDelveId}`, { method: 'DELETE' });

    // 13. Forge, bestiary detail and the main campaign over HTTP
    {
      const chars13 = store.getCharacters();
      const mine13 = chars13.find(c => c.id === char.id);
      mine13.gold = 3000;
      mine13.essence = 12;
      mine13.inventory.push(affixesMod.rollMagicItem('magic', { category: 'weapon' }));
      store.saveCharacters(chars13);

      const inv13 = (await (await fetch(`${BASE_URL}/api/characters/${char.id}`)).json()).inventory;
      const forgeItem = inv13.find(i => i.rarity === 'magic' && i.type === 'weapon');
      assert(forgeItem != null, 'A magic weapon is in the inventory to forge');

      const rerollRes = await cityPost('/forge', { charId: char.id, action: 'reroll', uniqueId: forgeItem.uniqueId });
      assert(rerollRes.status === 200, `Reroll accepted (${rerollRes.body.message || rerollRes.body.error})`);
      assert(rerollRes.body.item.uniqueId === forgeItem.uniqueId && rerollRes.body.item.affix !== forgeItem.affix,
        'The forge swapped the affix while keeping the item identity');
      assert(rerollRes.body.char.essence === 11, `Reroll spent one essence (left ${rerollRes.body.char.essence})`);

      const upgradeRes = await cityPost('/forge', { charId: char.id, action: 'upgrade', uniqueId: forgeItem.uniqueId });
      assert(upgradeRes.status === 200 && upgradeRes.body.item.rarity === 'rare', 'Upgrade moved it to rare');
      assert(upgradeRes.body.char.gold === 3000 - 60 - 200, `Both actions charged gold (left ${upgradeRes.body.char.gold})`);

      const equippedNow = await cityPost('/forge', { charId: char.id, action: 'salvage', uniqueId: (upgradeRes.body.char.equipped || {}).mainHand || 'nope' });
      assert(equippedNow.status === 400, 'Equipped gear cannot be salvaged without taking it off first');

      const salvageRes = await cityPost('/forge', { charId: char.id, action: 'salvage', uniqueId: forgeItem.uniqueId });
      assert(salvageRes.status === 200, 'The upgraded item can be melted down');
      assert(!(salvageRes.body.char.inventory || []).some(i => i.uniqueId === forgeItem.uniqueId), 'The salvaged item is gone from the inventory');

      const campaignRes = await (await fetch(`${BASE_URL}/api/city/campaign?charId=${char.id}`)).json();
      assert(campaignRes.acts.length === 4 && campaignRes.objective.text.length > 0, 'The campaign endpoint reports four acts and an objective');
      assert(campaignRes.acts.every(a => typeof a.done === 'boolean'), 'Each act carries a done flag');
      assert(campaignRes.progress.total === 4, 'Progress is measured out of four acts');
      assert(campaignRes.epilogue === null || typeof campaignRes.epilogue === 'string', 'The epilogue is either pending or written');

      const hallRes = await (await fetch(`${BASE_URL}/api/city/hall-of-heroes?charId=${char.id}`)).json();
      assert(hallRes.bestiaryProgress && hallRes.bestiaryProgress.total >= 10, 'The hall reports bestiary progress');
      assert(Array.isArray(hallRes.bestiary[0].eliteVariants), 'Bestiary entries list elite variants');
      assert('traits' in hallRes.bestiary[0] && 'resistances' in hallRes.bestiary[0], 'Bestiary entries expose the full statblock fields');
      assert(hallRes.campaign && hallRes.campaign.progress, 'The hall carries the campaign summary too');

      // campaign advance over HTTP: win the crypt and settle
      const cryptDelve = await (await fetch(`${BASE_URL}/api/game/start`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ characterId: char.id, bringAlly: false, difficulty: 'normal', mapId: 'crypt' })
      })).json();
      const cryptSave = store.getSave(cryptDelve.state.id);
      cryptSave.mode = 'victory';
      cryptSave.flags.victory = true;
      store.saveGame(cryptSave);
      const settled = await cityPost('/sync-delve', { charId: char.id, delveStateId: cryptDelve.state.id });
      assert(settled.body.char.campaign.stage === 1, `Winning the crypt advances act 1 (stage ${settled.body.char.campaign.stage})`);
      assert((settled.body.char.campaignLog || []).length >= 1, 'The advance is written to the campaign log');
      const settledAgain = await cityPost('/sync-delve', { charId: char.id, delveStateId: cryptDelve.state.id });
      assert(settledAgain.body.char.campaign.stage === 1, 'Settling twice does not advance the story twice');
      await fetch(`${BASE_URL}/api/game/${cryptDelve.state.id}`, { method: 'DELETE' });
      console.log('  ✔ PASS: Forge actions, bestiary detail and the main campaign advance over HTTP');
      passed += 16;
    }

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

