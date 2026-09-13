const express = require('express');
const store = require('../store');
const engine = require('../game/engine');
const content = require('../game/content');
const dm = require('../game/dm');

const router = express.Router();

function getChar(id) {
  return store.getCharacters().find(c => c.id === id);
}

function saveChar(char) {
  const chars = store.getCharacters();
  const idx = chars.findIndex(c => c.id === char.id);
  if (idx >= 0) chars[idx] = char;
  else chars.push(char);
  store.saveCharacters(chars);
}

const TAVERN_RUMORS = [
  "Old Barnaby swears he saw eerie emerald lights dancing above the Sunless Crypt at midnight.",
  "Delvers say the sunken halls of the Drowned Vault hold relics from the First Age, but the floodwaters never recede.",
  "Brother Aldous claims a drop of consecrated water from a sacred font can ward off tomb rot.",
  "Master Torvin at the smithy says silvered steel cuts straight through wraiths and bone knights.",
  "A wounded scout in the corner mutters: 'Beware the red explosive barrels in the crypts... one spark will ignite the whole gallery.'",
  "Tavern keeper Marla warns that resting in damp dungeons invites goblin ambush; safe beds are found only behind Oakhaven's gates.",
  "Whispers spread that ancient stone levers in the deep vaults open secret treasure vaults, but can also spring deadly acid vents."
];

const DEFAULT_BOUNTIES = [
  {
    id: 'bounty_sunless_relic',
    title: 'Relic of the Sunless Crypt',
    target: 'Sunless Crypt',
    desc: 'Infiltrate the Sunless Crypt, defeat the guardian ogre, and recover the sacred Relic.',
    rewardGold: 75,
    rewardXp: 150,
    icon: '💎'
  },
  {
    id: 'bounty_drowned_guardian',
    title: 'Terror of the Drowned Vault',
    target: 'The Drowned Vault',
    desc: 'Plunge into the flooded halls and eliminate the aquatic monstrosity holding the lower sluice.',
    rewardGold: 150,
    rewardXp: 300,
    icon: '🔱'
  },
  {
    id: 'bounty_crypt_cleanser',
    title: 'Purge the Undead Vanguard',
    target: 'Any Delve',
    desc: 'Destroy at least 5 undead minions to secure the trade roads entering Oakhaven.',
    rewardGold: 40,
    rewardXp: 80,
    icon: '💀'
  }
];

const DISTRICTS = [
  {
    id: 'tavern',
    name: 'The Boar & Lantern Tavern',
    icon: '🍺',
    tagline: 'Warm hearth, spiced mead, and companion recruitment',
    desc: 'Run by Marla Stoutheart. Delvers gather here to share rumors, rest their weary bones, and hire stalwart companions.'
  },
  {
    id: 'armory',
    name: 'Ironforge Armory & Smithy',
    icon: '⚔️',
    tagline: 'Forged steel, heavy armor, and weapon sales',
    desc: 'Master Torvin hammers glowing ingots over a dwarven anvil. Buy martial arms, mail, shields, or sell your dungeon spoils.'
  },
  {
    id: 'apothecary',
    name: 'Willow & Wick Apothecary',
    icon: '🧪',
    tagline: 'Alchemical salves, healing draughts, and spell scrolls',
    desc: 'Herbalist Kaelin brews glowing vials and binds mystic incantations into scrolls for perilous dungeon delving.'
  },
  {
    id: 'guildhall',
    name: "Delvers' Guildhall",
    icon: '📜',
    tagline: 'Adventurer bounties and high-risk contracts',
    desc: 'Guildmaster Vance posts official bounties from the High Regency. Complete delves to claim gold and reputation.'
  },
  {
    id: 'hall_of_heroes',
    name: 'Hall of Heroes & Trophy Room',
    icon: '🏛️',
    tagline: 'Monster Bestiary, legendary delve trophies, and hero records',
    desc: 'The marble hall where the grand exploits of Oakhaven’s greatest champions are etched in bronze, and relics of conquered foes are displayed.'
  }
];

const MAP_NODES = [
  {
    id: 'oakhaven',
    name: 'Oakhaven Town',
    region: 'The Sunlit Vale',
    type: 'city',
    safe: true,
    x: 22,
    y: 52,
    icon: '🏰',
    levelRange: 'Town Hub',
    blurb: 'Fortified hub city with thriving tavern, armory, apothecary, and guildhall.'
  },
  {
    id: 'crypt',
    name: 'The Sunless Crypt',
    region: 'Barren Ridges',
    type: 'dungeon',
    mapId: 'crypt',
    safe: false,
    x: 58,
    y: 26,
    icon: '💀',
    levelRange: 'Level 1–3',
    blurb: 'Deep catacombs holding undead horrors and an ancient relic guarded by a ferocious ogre.'
  },
  {
    id: 'drowned-vault',
    name: 'The Drowned Vault',
    region: 'Weeping Marsh',
    type: 'dungeon',
    mapId: 'drowned-vault',
    safe: false,
    x: 78,
    y: 74,
    icon: '🌊',
    levelRange: 'Level 3–5',
    blurb: 'Flooded stone crypts filled with waterborne terrors and submerged treasures.'
  },
  {
    id: 'endless',
    name: 'The Endless Depths',
    region: '???',
    type: 'endless',
    mapId: 'endless_1',
    safe: false,
    x: 40,
    y: 80,
    icon: '🌀',
    levelRange: 'Any Level',
  },
  {
    id: 'sewers',
    name: 'Oakhaven Sewers',
    region: 'Beneath Oakhaven',
    type: 'dungeon',
    mapId: 'sewers',
    safe: false,
    x: 28,
    y: 60,
    icon: '🕷️',
    levelRange: 'Level 3-6',
    blurb: 'Something has been breeding in the dark beneath the city. Clear the sewers.'
  },
  {
    id: 'mill',
    name: 'The Abandoned Mill',
    region: 'The Outskirts',
    type: 'dungeon',
    mapId: 'mill',
    safe: false,
    x: 15,
    y: 65,
    icon: '🌾',
    levelRange: 'Level 4-7',
    blurb: 'An old mill overrun by bandits, cultists and things that should not walk.'
  },
  {
    id: 'roost',
    name: "The Sun Dragon\'s Roost",
    region: 'The Volcanic Peaks',
    type: 'dungeon',
    mapId: 'roost',
    safe: false,
    x: 80,
    y: 15,
    icon: '🐉',
    levelRange: 'Level 9-12',
    blurb: 'The Ember Queen sleeps on a hoard of molten gold. The final challenge.'
  }
];

const MAP_ROADS = [
  { from: 'oakhaven', to: 'crypt', label: "Old King's Highway", danger: 'Low' },
  { from: 'oakhaven', to: 'drowned-vault', label: 'Weeping Marsh Causeway', danger: 'Medium' },
  { from: 'crypt', to: 'drowned-vault', label: 'Sunken Barrow Path', danger: 'High' },
  { from: 'oakhaven', to: 'sewers', label: 'Beneath the Cobbles', danger: 'Low' },
  { from: 'oakhaven', to: 'mill', label: 'The Outskirts Path', danger: 'Low' },
  { from: 'oakhaven', to: 'roost', label: 'The Ashen Pass', danger: 'Extreme' },
  { from: 'howling-hills', to: 'roost', label: 'The Volcanic Trail', danger: 'High' }
];

const ARMORY_CATALOG = [
  { id: 'dagger', name: 'Dagger', type: 'weapon', cost: 2, desc: '1d4 piercing · Finesse, Light, Thrown' },
  { id: 'shortsword', name: 'Shortsword', type: 'weapon', cost: 10, desc: '1d6 piercing · Finesse, Light' },
  { id: 'longsword', name: 'Longsword', type: 'weapon', cost: 15, desc: '1d8/1d10 slashing · Versatile' },
  { id: 'greatsword', name: 'Greatsword', type: 'weapon', cost: 50, desc: '2d6 slashing · Heavy, Two-Handed' },
  { id: 'shortbow', name: 'Shortbow', type: 'weapon', cost: 25, desc: '1d6 piercing · Range 80/320' },
  { id: 'longbow', name: 'Longbow', type: 'weapon', cost: 50, desc: '1d8 piercing · Range 150/600, Heavy' },
  { id: 'shield', name: 'Steel Shield', type: 'shield', cost: 10, desc: '+2 AC while wielded' },
  { id: 'leather', name: 'Leather Armor', type: 'armor', cost: 10, desc: '11 + Dex modifier' },
  { id: 'studded_leather', name: 'Studded Leather', type: 'armor', cost: 45, desc: '12 + Dex modifier' },
  { id: 'chain_shirt', name: 'Chain Shirt', type: 'armor', cost: 50, desc: '13 + Dex mod (max 2)' },
  { id: 'chain_mail', name: 'Chain Mail', type: 'armor', cost: 75, desc: '16 AC (requires Str 13)' },
  { id: 'plate', name: 'Plate Armor', type: 'armor', cost: 1500, desc: '18 AC (requires Str 15)' },
  { id: 'silver_sword', name: 'Silver Shortsword', type: 'weapon', cost: 200, desc: 'Magic shortsword: +1 to hit and damage' }
];

const APOTHECARY_CATALOG = [
  { id: 'potion_healing', name: 'Potion of Healing', cost: 25, desc: 'Bonus action: Regain 2d4+2 HP' },
  { id: 'potion_greater', name: 'Greater Healing Potion', cost: 75, desc: 'Bonus action: Regain 4d4+4 HP' },
  { id: 'healers_kit', name: "Healer's Kit", cost: 10, desc: 'Stabilize dying allies or heal with Healer feat' },
  { id: 'thieves_tools', name: "Thieves' Tools", cost: 25, desc: 'Pick locked chests and disarm dungeon traps' },
  { id: 'rations', name: 'Trail Rations (x5)', cost: 5, desc: 'Nourishing provisions for wilderness journeys' },
  { id: 'torch', name: 'Delver Torch (x3)', cost: 2, desc: 'Illuminates 20 ft radius in pitch-black chambers' },
  { id: 'scroll_magic_missile', name: 'Scroll of Magic Missile', cost: 75, desc: 'One-shot: 3d4+3 force damage, never misses' },
  { id: 'scroll_cure', name: 'Scroll of Cure Wounds', cost: 60, desc: 'One-shot: Regain 1d8+3 HP' },
  { id: 'scroll_shield', name: 'Scroll of Shield', cost: 75, desc: 'One-shot: +5 AC until your next turn' }
];

function lookupItemPrice(itemId) {
  const all = [...ARMORY_CATALOG, ...APOTHECARY_CATALOG];
  const found = all.find(i => i.id === itemId);
  if (found) return found.cost;
  const w = (engine.WEAPONS || []).find(x => x.id === itemId);
  if (w && w.cost) return w.cost;
  const a = (engine.ARMORS || []).find(x => x.id === itemId);
  if (a && a.cost) return a.cost;
  const g = (engine.GEAR || []).find(x => x.id === itemId);
  if (g && g.cost) return g.cost;
  return 10;
}

// GET /api/city/info
router.get('/info', (req, res) => {
  const charId = req.query.charId;
  const char = charId ? getChar(charId) : null;
  const companions = (engine.ALLIES || []).map(a => ({
    id: a.id,
    name: a.name,
    role: a.role || 'Companion',
    icon: a.icon || '🏹',
    ac: a.ac,
    hp: a.hp,
    speed: a.speed,
    blurb: a.blurb || '',
    spells: a.spells || [],
    attacks: (a.attacks || []).map(x => x.name)
  }));

  res.json({
    cityName: 'Oakhaven',
    districts: DISTRICTS,
    mapNodes: MAP_NODES,
    mapRoads: MAP_ROADS,
    companions,
    rumors: TAVERN_RUMORS,
    bounties: DEFAULT_BOUNTIES,
    shops: {
      armory: ARMORY_CATALOG,
      apothecary: APOTHECARY_CATALOG
    },
    character: char || null
  });
});

// POST /api/city/rest
router.post('/rest', (req, res) => {
  const { charId, type } = req.body || {};
  const char = getChar(charId);
  if (!char) return res.status(404).json({ error: 'Character not found' });

  const isLong = type === 'long';
  const cost = isLong ? 20 : 5;

  if ((char.gold || 0) < cost) {
    return res.status(400).json({ error: `Not enough gold! ${isLong ? 'Long' : 'Short'} rest costs ${cost} GP.` });
  }

  char.gold -= cost;
  if (isLong) {
    char.hp = char.hpMax;
    char.hdUsed = 0;
    char.freeSpellUses = 0;
    char.uses = {};
    char.pools = {};
    if (char.slots) {
      char.slots = { ...char.slotsMax };
    }
  } else {
    const conMod = Math.floor(((char.abilities?.con || 10) - 10) / 2);
    const heal = Math.max(1, (char.level || 1) * 4 + conMod);
    char.hp = Math.min(char.hpMax, (char.hp || char.hpMax) + heal);
  }

  saveChar(char);
  res.json({
    ok: true,
    char,
    message: isLong
      ? 'You take a full night of rest at The Boar & Lantern. Hit points, spell slots, and hit dice are fully restored!'
      : 'You catch your breath and tend to your gear by the tavern hearth.'
  });
});

// POST /api/city/companion
router.post('/companion', (req, res) => {
  const { charId, companionId } = req.body || {};
  const char = getChar(charId);
  if (!char) return res.status(404).json({ error: 'Character not found' });

  if (companionId === 'none' || !companionId) {
    char.companion = null;
  } else {
    char.companion = companionId;
  }
  saveChar(char);
  res.json({ ok: true, char, companion: char.companion });
});

// POST /api/city/buy
router.post('/buy', (req, res) => {
  const { charId, itemId, qty = 1 } = req.body || {};
  const char = getChar(charId);
  if (!char) return res.status(404).json({ error: 'Character not found' });

  const price = lookupItemPrice(itemId);
  const totalCost = price * qty;
  if ((char.gold || 0) < totalCost) {
    return res.status(400).json({ error: `Not enough gold! Total cost is ${totalCost} GP (you have ${char.gold || 0} GP).` });
  }

  char.gold -= totalCost;
  char.inventory = char.inventory || [];
  const existing = char.inventory.find(i => i.itemId === itemId);
  if (existing) existing.qty += qty;
  else char.inventory.push({ itemId, qty });

  // Recalculate AC if bought armor
  const arm = (engine.ARMORS || []).find(a => a.id === itemId);
  if (arm && arm.type !== 'shield') {
    const dexMod = Math.floor(((char.abilities?.dex || 10) - 10) / 2);
    if (arm.type === 'light') char.acBase = 11 + dexMod;
    else if (arm.type === 'medium') char.acBase = 13 + Math.min(2, dexMod);
    else if (arm.type === 'heavy') char.acBase = arm.ac ? parseInt(arm.ac) : 16;
  }

  saveChar(char);
  res.json({ ok: true, char, message: `Purchased ${qty}x ${itemId} for ${totalCost} GP.` });
});

// POST /api/city/sell
router.post('/sell', (req, res) => {
  const { charId, itemId, qty = 1 } = req.body || {};
  const char = getChar(charId);
  if (!char) return res.status(404).json({ error: 'Character not found' });

  char.inventory = char.inventory || [];
  const existing = char.inventory.find(i => i.itemId === itemId);
  if (!existing || existing.qty < qty) {
    return res.status(400).json({ error: 'You do not have enough of this item to sell.' });
  }

  const basePrice = lookupItemPrice(itemId);
  const sellPricePer = Math.max(1, Math.floor(basePrice * 0.5));
  const totalGold = sellPricePer * qty;

  existing.qty -= qty;
  if (existing.qty <= 0) {
    char.inventory = char.inventory.filter(i => i.itemId !== itemId);
  }
  char.gold = (char.gold || 0) + totalGold;

  saveChar(char);
  res.json({ ok: true, char, message: `Sold ${qty}x ${itemId} for ${totalGold} GP.` });
});

// POST /api/city/claim-bounty
router.post('/claim-bounty', (req, res) => {
  const { charId, bountyId } = req.body || {};
  const char = getChar(charId);
  if (!char) return res.status(404).json({ error: 'Character not found' });

  char.claimedBounties = char.claimedBounties || [];
  if (char.claimedBounties.includes(bountyId)) {
    return res.status(400).json({ error: 'Bounty already claimed!' });
  }
  // a completed delve pays for one bounty claim — no free XP farming
  const delvesDone = char.delvesCompleted || 0;
  if (delvesDone < char.claimedBounties.length + 1) {
    return res.status(400).json({ error: 'Complete and retreat from a delve first! (Completed delves: ' + delvesDone + ', bounties claimed: ' + char.claimedBounties.length + ')' });
  }

  const bounty = DEFAULT_BOUNTIES.find(b => b.id === bountyId);
  if (!bounty) return res.status(404).json({ error: 'Bounty not found' });

  char.claimedBounties.push(bountyId);
  char.gold = (char.gold || 0) + bounty.rewardGold;
  char.xp = (char.xp || 0) + bounty.rewardXp;

  // Check level up
  for (const [lvl, threshold] of Object.entries(engine.XP_THRESHOLDS)) {
    if (char.level < +lvl && char.xp >= threshold) {
      char.level = +lvl;
      const cls = (engine.CLASSES || []).find(c => c.id === char.className);
      if (cls && engine.applyClassAndSpecies) {
        engine.applyClassAndSpecies(char, cls, null, +lvl);
      }
    }
  }

  saveChar(char);
  res.json({ ok: true, char, bounty, message: `Bounty claimed! Earned +${bounty.rewardGold} GP and +${bounty.rewardXp} XP.` });
});

// POST /api/city/sync-delve
router.post('/sync-delve', (req, res) => {
  const { charId, delveStateId, goldGained, xpGained, newItems } = req.body || {};
  const char = getChar(charId);
  if (!char) return res.status(404).json({ error: 'Character not found' });

  let delve = null;
  if (delveStateId) {
    delve = store.getSave(delveStateId);
  }

  if (delve && delve.character) {
    const dc = delve.character;
    if (typeof dc.gold === 'number') char.gold = dc.gold;
    if (typeof dc.xp === 'number') char.xp = dc.xp;
    if (Array.isArray(dc.inventory)) char.inventory = dc.inventory;
    if (typeof dc.level === 'number' && dc.level > char.level) char.level = dc.level;
    // use the hero's ACTUAL remaining HP from the delve (the entity, not the
    // untouched snapshot — otherwise retreating is a free full heal)
    const delveHero = (delve.entities || []).find(e => e.kind === 'player');
    const delveHp = delveHero ? delveHero.hp : undefined;
    char.hp = (typeof delveHp === 'number') ? Math.min(char.hpMax, Math.max(1, delveHp)) : char.hp;
  } else {
    if (typeof goldGained === 'number') char.gold = (char.gold || 0) + goldGained;
    if (typeof xpGained === 'number') char.xp = (char.xp || 0) + xpGained;
    if (Array.isArray(newItems)) {
      char.inventory = char.inventory || [];
      newItems.forEach(item => {
        const id = typeof item === 'string' ? item : item.itemId;
        const qty = item.qty || 1;
        const ex = char.inventory.find(i => i.itemId === id);
        if (ex) ex.qty += qty;
        else char.inventory.push({ itemId: id, qty });
      });
    }
  }

  for (const [lvl, threshold] of Object.entries(engine.XP_THRESHOLDS)) {
    if (char.level < +lvl && char.xp >= threshold) {
      char.level = +lvl;
      const cls = (engine.CLASSES || []).find(c => c.id === char.className);
      if (cls && engine.applyClassAndSpecies) {
        engine.applyClassAndSpecies(char, cls, null, +lvl);
      }
    }
  }

  // Sync maps visited and bestiary
  if (delve && delve.mapId) {
    char.visitedMaps = char.visitedMaps || [];
    if (!char.visitedMaps.includes(delve.mapId)) char.visitedMaps.push(delve.mapId);
    if (delve.mapId === 'drowned-vault') char.deepestFloor = 'drowned-vault';
  }
  if (delve && delve.character && delve.character.bestiary) {
    char.bestiary = char.bestiary || {};
    Object.entries(delve.character.bestiary).forEach(([mId, count]) => {
      char.bestiary[mId] = Math.max(char.bestiary[mId] || 0, count);
    });
  }

  char.delvesCompleted = (char.delvesCompleted || 0) + 1;
  saveChar(char);
  res.json({ ok: true, char });
});

// GET /api/city/hall-of-heroes
router.get('/hall-of-heroes', (req, res) => {
  const { charId } = req.query;
  const chars = store.getCharacters();
  const currentChar = chars.find(c => c.id === charId) || chars[0] || null;

  // 1. Full Bestiary from content
  const allMonsters = content.listMonsters ? content.listMonsters() : [];
  const charBestiary = (currentChar && currentChar.bestiary) ? currentChar.bestiary : {};
  const globalBestiary = {};
  chars.forEach(c => {
    if (c.bestiary) {
      Object.entries(c.bestiary).forEach(([mId, count]) => {
        globalBestiary[mId] = (globalBestiary[mId] || 0) + count;
      });
    }
  });

  const bestiaryList = allMonsters.map(m => {
    const kills = charBestiary[m.id] || 0;
    const globalKills = globalBestiary[m.id] || 0;
    return {
      id: m.id,
      name: m.name,
      cr: m.cr || (m.xp >= 400 ? '2' : (m.xp >= 200 ? '1' : (m.xp >= 100 ? '1/2' : '1/4'))),
      hp: m.hp,
      ac: m.ac,
      xp: m.xp,
      lore: m.lore || m.desc || `A creature lurking in the dark corridors of the subterranean vaults. Worth ${m.xp} XP.`,
      weakness: m.weakness || (m.vulnerabilities ? m.vulnerabilities.join(', ') : 'None documented'),
      kills,
      globalKills,
      unlocked: kills > 0 || globalKills > 0
    };
  });

  // 2. Trophies & Achievements
  const totalKills = Object.values(charBestiary).reduce((a, b) => a + b, 0);
  const totalDelves = currentChar?.delvesCompleted || 0;
  const currentGold = currentChar?.gold || 0;
  const currentLevel = currentChar?.level || 1;

  const trophies = [
    {
      id: 'first_blood',
      name: 'First Blood',
      desc: 'Slay your first monster in the Sunless Crypt.',
      icon: '⚔️',
      unlocked: totalKills >= 1
    },
    {
      id: 'crypt_cleanser',
      name: 'Crypt Cleanser',
      desc: 'Slay at least 10 monsters across your adventures.',
      icon: '💀',
      unlocked: totalKills >= 10
    },
    {
      id: 'veteran_delver',
      name: 'Veteran Delver',
      desc: 'Survive and complete at least 3 dungeon delves.',
      icon: '🛡️',
      unlocked: totalDelves >= 3
    },
    {
      id: 'treasure_hoarder',
      name: 'Treasure Hoarder',
      desc: 'Amass 150 gold in your treasury.',
      icon: '💰',
      unlocked: currentGold >= 150
    },
    {
      id: 'heroic_ascension',
      name: 'Heroic Ascension',
      desc: 'Reach Level 3 and specialize in a character Subclass.',
      icon: '⭐',
      unlocked: currentLevel >= 3
    },
    {
      id: 'ogre_slayer',
      name: 'Slayer of the Sunless Ogre',
      desc: 'Conquer the fearsome ogre brute guarding the Sunless Relic.',
      icon: '👹',
      unlocked: (charBestiary['ogre'] || globalBestiary['ogre'] || 0) >= 1
    },
    {
      id: 'deep_diver',
      name: 'Dungeon Depth II Explorer',
      desc: 'Descend through the ancient stairs into The Drowned Vault.',
      icon: '🔱',
      unlocked: !!(currentChar?.deepestFloor === 'drowned-vault' || (currentChar?.visitedMaps && currentChar.visitedMaps.includes('drowned-vault')))
    }
  ];

  // 3. Hall of Champions
  const champions = chars.map(c => ({
    id: c.id,
    name: c.name,
    species: c.species,
    className: c.className,
    subclass: c.subclass,
    level: c.level || 1,
    xp: c.xp || 0,
    gold: c.gold || 0,
    delvesCompleted: c.delvesCompleted || 0,
    kills: Object.values(c.bestiary || {}).reduce((a, b) => a + b, 0),
    portraitUrl: `/api/characters/${c.id}/portrait`
  })).sort((a, b) => (b.level * 1000 + b.xp) - (a.level * 1000 + a.xp));

  res.json({
    ok: true,
    characterName: currentChar ? currentChar.name : 'Unknown Hero',
    bestiary: bestiaryList,
    trophies,
    champions,
    stats: {
      totalKills,
      totalDelves,
      currentGold,
      currentLevel
    }
  });
});

// POST /api/city/rumor
router.post('/rumor', async (req, res) => {
  const { topic } = req.body || {};
  try {
    const settings = store.getSettings ? store.getSettings() : {};
    if (settings.llm && settings.llm.enabled) {
      const prompt = `You are Marla Stoutheart, tavern keeper of The Boar & Lantern in Oakhaven. Tell a short (2-3 sentences) colorful tavern rumor or piece of lore about the surrounding dungeons (The Sunless Crypt or The Drowned Vault). Topic hint: ${topic || 'ancient treasure'}.`;
      const reply = await dm.callLlm([{ role: 'system', content: prompt }]);
      if (reply) return res.json({ rumor: reply });
    }
  } catch {}

  const randomRumor = TAVERN_RUMORS[Math.floor(Math.random() * TAVERN_RUMORS.length)];
  res.json({ rumor: randomRumor });
});

module.exports = router;
