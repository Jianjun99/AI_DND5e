const express = require('express');
const store = require('../store');
const engine = require('../game/engine');
const content = require('../game/content');
const dm = require('../game/dm');
const potions = require('../game/potions');
const gambling = require('../game/gambling');
const forge = require('../game/forge');
const campaignMod = require('../game/campaign');
const affixesMod = require('../game/affixes');

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
  },
  {
    // the road table below already referenced this node; the map itself ships in the
    // howling-hills content pack, so it belongs on the region map too
    id: 'howling-hills',
    name: 'The Howling Hills',
    region: 'The Northern Moors',
    type: 'dungeon',
    mapId: 'howling-hills',
    safe: false,
    x: 46,
    y: 24,
    icon: '🐺',
    levelRange: 'Level 5-10',
    blurb: 'Wind-scoured moors where a bandit warband answers to something with too many teeth.'
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
  { id: 'scroll_shield', name: 'Scroll of Shield', cost: 75, desc: 'One-shot: +5 AC until your next turn' },
  // Experimental brews: the effect is rolled when you buy the bottle and stays hidden until
  // you identify it (INT/Arcana) or drink it blind. See server/game/potions.js.
  { type: 'mystery', id: 'potion_mystery_thin', name: '浑浊的小瓶', cost: 15, tier: 'thin', desc: '55% 有益 / 25% 复杂 / 20% 有害 · 可鉴定' },
  { type: 'mystery', id: 'potion_mystery_standard', name: '冒泡的药剂', cost: 40, tier: 'standard', desc: '65% 有益 / 22% 复杂 / 13% 有害 · 可鉴定' },
  { type: 'mystery', id: 'potion_mystery_fine', name: '虹彩的精华', cost: 90, tier: 'fine', desc: '75% 有益 / 20% 复杂 / 5% 有害 · 可鉴定' }
];

// Items bought in town must reach the delve the player is already in: sync-delve treats the
// delve inventory as authoritative, so a purchase made after a delve started would otherwise
// be wiped out at settlement. Mirrors the equip write-through in routes/game.js.
function addItemForCharacter(char, item) {
  char.inventory = char.inventory || [];
  const key = item.uniqueId || item.itemId;
  const existing = char.inventory.find(i => (i.uniqueId || i.itemId) === key);
  if (existing && !item.uniqueId) existing.qty += (item.qty || 1);
  else char.inventory.push({ ...item, qty: item.qty || 1 });
  try {
    store.listSaves().forEach(s => {
      if (s.characterId !== char.id) return;
      const save = store.getSave(s.id);
      if (!save || !save.character) return;
      save.character.inventory = save.character.inventory || [];
      const have = save.character.inventory.find(i => (i.uniqueId || i.itemId) === key);
      if (have && !item.uniqueId) have.qty += (item.qty || 1);
      else save.character.inventory.push({ ...item, qty: item.qty || 1 });
      store.saveGame(save);
    });
  } catch {}
  return char;
}

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

// Mirror a roster character's gear changes into every delve save they have running, so a
// forged/salvaged item shows up (and stats match) when they continue an older delve.
function syncCharToDelves(char) {
  try {
    store.listSaves().forEach(s => {
      if (s.characterId !== char.id) return;
      const save = store.getSave(s.id);
      if (!save || !save.character) return;
      save.character.inventory = char.inventory;
      save.character.equipped = char.equipped;
      save.character.attacks = char.attacks;
      save.character.acBase = char.acBase;
      save.character.hpMax = char.hpMax;
      save.character.itemHpBonus = char.itemHpBonus;
      save.character.appliedTempHpMod = char.appliedTempHpMod;
      if (typeof char.essence === 'number') save.character.essence = char.essence;
      const pe = (save.entities || []).find(e => e.kind === 'player');
      if (pe) {
        pe.ac = engine.currentAc(save, pe);
        pe.hpMax = save.character.hpMax;
        pe.hp = Math.min(pe.hp, pe.hpMax);
      }
      store.saveGame(save);
    });
  } catch {}
}

// Delve-only prizes wait on the hero until the next delve, then vanish with it.
function tokensIntoPending(char, token) {
  char.pendingDelveItems = char.pendingDelveItems || [];
  const existing = char.pendingDelveItems.find(i => i.uniqueId === token.uniqueId);
  if (existing) existing.qty += 1;
  else char.pendingDelveItems.push(token);
  return char;
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
    tables: {
      roulette: { bets: gambling.ROULETTE_BETS, limits: gambling.GAMBLE_LIMITS.roulette, rtp: gambling.rouletteRtp() },
      sicbo: { bets: gambling.SICBO_BETS, limits: gambling.GAMBLE_LIMITS.sicbo },
      slots: {
        symbols: gambling.SLOT_SYMBOLS,
        tiers: Object.values(gambling.SLOT_TIERS).map(t => ({
          id: t.id, name: t.name, stake: t.stake, blurb: t.blurb,
          pay: t.pay, curseOnSkull: t.curseOnSkull
        }))
      },
      tokens: Object.values(potions.DELVE_TOKENS).map(t => ({ id: t.id, name: t.name, icon: t.icon, desc: t.desc, value: t.value }))
    },
    forge: {
      costs: forge.FORGE_COSTS,
      salvage: forge.SALVAGE_ESSENCE,
      killEssence: forge.KILL_ESSENCE
    },
    campaign: char ? {
      objective: campaignMod.objective(char.campaign),
      progress: campaignMod.progress(char.campaign),
      currentActId: (campaignMod.currentAct(char.campaign) || {}).id || null,
      currentActName: (campaignMod.currentAct(char.campaign) || {}).name || null,
      actByMap: Object.fromEntries(campaignMod.ACTS.flatMap(a => a.mapIds.map(m => [m, a.id]))),
      actNames: Object.fromEntries(campaignMod.ACTS.map(a => [a.id, a.name]))
    } : null,
    character: char ? {
      ...char,
      levelUp: engine.levelUpInfo(char),
      pendingDelveItems: char.pendingDelveItems || [],
      pendingCurses: char.pendingCurses || [],
      essence: char.essence || 0,
      campaign: campaignMod.ensure(char.campaign)
    } : null
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

  // Experimental brews are rolled per bottle: each purchase is its own hidden outcome.
  const catalogEntry = [...ARMORY_CATALOG, ...APOTHECARY_CATALOG].find(i => i.id === itemId);
  if (catalogEntry && catalogEntry.type === 'mystery') {
    const opened = [];
    for (let i = 0; i < qty; i++) {
      const bottle = potions.rollMysteryPotion(catalogEntry.tier || 'standard');
      addItemForCharacter(char, bottle);
      opened.push(bottle);
    }
    saveChar(char);
    return res.json({
      ok: true, char, opened,
      message: `你买下 ${qty} 瓶${catalogEntry.name}——瓶里的东西还没人说得清。`
    });
  }

  const existing = char.inventory.find(i => i.itemId === itemId && !i.uniqueId);
  if (existing) existing.qty += qty;
  else addItemForCharacter(char, { itemId, qty });

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
    // delve-only prizes (gambling tokens) expire with the delve they were carried into
    if (Array.isArray(dc.inventory)) char.inventory = dc.inventory.filter(i => !i.delveOnly);
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
  // elite variants seen (per affix) and the one-off first-kill rewards
  if (delve && delve.character && delve.character.bestiaryElite) {
    char.bestiaryElite = char.bestiaryElite || {};
    Object.entries(delve.character.bestiaryElite).forEach(([mId, variants]) => {
      char.bestiaryElite[mId] = char.bestiaryElite[mId] || {};
      Object.entries(variants || {}).forEach(([affixId, count]) => {
        char.bestiaryElite[mId][affixId] = Math.max(char.bestiaryElite[mId][affixId] || 0, count);
      });
    });
  }
  if (delve && delve.character && delve.character.bestiaryRewarded) {
    char.bestiaryRewarded = { ...(delve.character.bestiaryRewarded || {}), ...(char.bestiaryRewarded || {}) };
  }
  // forge currency earned in the delve
  if (delve && delve.character && typeof delve.character.essence === 'number') {
    char.essence = delve.character.essence;
  }

  // Main campaign: a victorious delve advances the story (order-checked and idempotent)
  if (delve && delve.mode === 'victory') {
    const before = campaignMod.ensure(char.campaign).stage;
    const adv = campaignMod.advance(char.campaign || campaignMod.newCampaign(), delve.mapId);
    char.campaign = adv.campaign;
    if (adv.advanced) {
      if (adv.reward) {
        char.gold = (char.gold || 0) + (adv.reward.gold || 0);
        char.xp = (char.xp || 0) + (adv.reward.xp || 0);
      }
      char.campaignLog = char.campaignLog || [];
      char.campaignLog.push({ act: adv.act, text: adv.text, ts: Date.now() });
      if (adv.completed) char.campaign.epilogue = null;   // written on first view
    }
    if (before !== char.campaign.stage) {
      // keep the roster level in step with any campaign XP
      for (const [lvl, threshold] of Object.entries(engine.XP_THRESHOLDS)) {
        if (char.level < +lvl && char.xp >= threshold) {
          char.level = +lvl;
          const cls = (engine.CLASSES || []).find(c => c.id === char.className);
          if (cls) engine.applyClassAndSpecies(char, cls, null, +lvl);
        }
      }
    }
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

  const eliteSeen = (currentChar && currentChar.bestiaryElite) ? currentChar.bestiaryElite : {};
  const rewarded = (currentChar && currentChar.bestiaryRewarded) ? currentChar.bestiaryRewarded : {};
  const bestiaryList = allMonsters.map(m => {
    const kills = charBestiary[m.id] || 0;
    const globalKills = globalBestiary[m.id] || 0;
    const variants = eliteSeen[m.id] || {};
    return {
      id: m.id,
      name: m.name,
      cr: m.cr || (m.xp >= 400 ? '2' : (m.xp >= 200 ? '1' : (m.xp >= 100 ? '1/2' : '1/4'))),
      hp: m.hp,
      ac: m.ac,
      xp: m.xp,
      lore: m.lore || m.desc || `A creature lurking in the dark corridors of the subterranean vaults. Worth ${m.xp} XP.`,
      weakness: m.weakness || (m.vulnerabilities ? m.vulnerabilities.join(', ') : 'None documented'),
      // full statblock detail, revealed once the entry is unlocked
      traits: m.traits || [],
      attacks: (m.attacks || []).map(a => `${a.name} +${a.bonus} (${a.damage} ${a.damageType || ''})`.trim()),
      resistances: m.resistances || [],
      vulnerabilities: m.vulnerabilities || [],
      immunities: m.immunities || [],
      boss: !!m.boss,
      loot: m.loot ? { gold: m.loot.gold || null, items: (m.loot.items || []).length } : null,
      // elite affix variants you have personally put down (the rest stay "???")
      eliteVariants: Object.keys(variants).map(affixId => {
        const def = affixesMod.MONSTER_AFFIXES[affixId] || {};
        return { id: affixId, name: def.name || affixId, color: def.color || '#f59e0b', desc: def.desc || '', kills: variants[affixId] };
      }),
      kills,
      globalKills,
      firstKillRewarded: !!rewarded[m.id],
      unlocked: kills > 0 || globalKills > 0
    };
  });
  const bestiaryProgress = {
    seen: bestiaryList.filter(b => b.unlocked).length,
    total: bestiaryList.length,
    variantsSeen: bestiaryList.reduce((n, b) => n + b.eliteVariants.length, 0),
    variantsTotal: bestiaryList.length * Object.keys(affixesMod.MONSTER_AFFIXES).length
  };

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
    },
    {
      id: 'dragon_slayer',
      name: 'Dragonslayer of the Ember Queen',
      desc: 'Conquer Yzmerith the young red dragon at the Sun Dragon’s Roost.',
      icon: '🐉',
      unlocked: (charBestiary['young_fire_dragon'] || globalBestiary['young_fire_dragon'] || 0) >= 1
    },
    {
      id: 'endless_delver',
      name: 'Into the Abyss',
      desc: 'Reach Floor 5 or deeper within the Endless Depths.',
      icon: '🌀',
      unlocked: ((currentChar?.endlessDepth || 0) >= 5) || !!(currentChar?.visitedMaps && currentChar.visitedMaps.some(m => /^endless_([5-9]|\d{2,})/.test(m)))
    },
    {
      id: 'paragon_hero',
      name: 'Paragon of the Realm',
      desc: 'Reach Level 10 or higher and master tier-3 class features.',
      icon: '👑',
      unlocked: currentLevel >= 10
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
    bestiaryProgress,
    trophies,
    champions,
    campaign: currentChar ? {
      campaign: campaignMod.ensure(currentChar.campaign),
      objective: campaignMod.objective(currentChar.campaign),
      progress: campaignMod.progress(currentChar.campaign),
      acts: campaignMod.ACTS.map(a => ({
        id: a.id, act: a.act, name: a.name, icon: a.icon, mapName: a.mapName, blurb: a.blurb,
        done: campaignMod.actDone(currentChar.campaign, a.id)
      }))
    } : null,
    stats: {
      totalKills,
      totalDelves,
      currentGold,
      currentLevel
    }
  });
});

// POST /api/city/forge — melt magic gear into essence, reroll an affix, or upgrade rarity
router.post('/forge', (req, res) => {
  const { charId, action, uniqueId } = req.body || {};
  const char = getChar(charId);
  if (!char) return res.status(404).json({ error: 'Character not found' });
  char.essence = char.essence || 0;

  const item = (char.inventory || []).find(i => i.uniqueId === uniqueId);
  if (!item) return res.status(400).json({ error: '找不到这件装备。' });

  if (action === 'salvage') {
    if (Object.values(char.equipped || {}).includes(uniqueId)) {
      return res.status(400).json({ error: '先把它脱下来，再熔解。' });
    }
    const v = forge.salvageValue(item);
    if (!v.ok) return res.status(400).json({ error: v.error });
    char.essence += v.essence;
    char.gold = (char.gold || 0) + v.gold;
    char.inventory = char.inventory.filter(i => i.uniqueId !== uniqueId);
    saveChar(char);
    syncCharToDelves(char);
    return res.json({
      ok: true, char, essence: v.essence, gold: v.gold,
      message: `熔解 ${item.name} → +${v.essence} 余烬精华、+${v.gold} gp。`
    });
  }

  if (action !== 'reroll' && action !== 'upgrade') {
    return res.status(400).json({ error: '锻造台只会熔解、重铸和升阶。' });
  }

  const cost = forge.forgeCost(action, item.rarity);
  if (!cost) return res.status(400).json({ error: action === 'upgrade' ? '已经是传奇品质，无法再升。' : '这件装备无法改造。' });
  if ((char.gold || 0) < cost.gold || char.essence < cost.essence) {
    return res.status(400).json({ error: `材料不足：需要 ${cost.gold} gp + ${cost.essence} 余烬精华（你有 ${char.gold || 0} gp、${char.essence} 精华）。` });
  }

  const result = action === 'reroll' ? forge.rerollAffix(item) : forge.upgradeRarity(item);
  if (!result.ok) return res.status(400).json({ error: result.error });

  char.gold -= cost.gold;
  char.essence -= cost.essence;
  forge.replaceItem(char, result.item);
  // an affix can change AC, max HP or the weapon profile — recompute exactly like an equip does
  const cls = (engine.CLASSES || []).find(c => c.id === char.className);
  if (cls) engine.applyClassAndSpecies(char, cls, null, char.level || 1, true);
  saveChar(char);
  syncCharToDelves(char);

  res.json({
    ok: true, char, item: result.item, cost,
    message: `${action === 'reroll' ? '重铸' : '升阶'}完成：${result.text}（-${cost.gold} gp、-${cost.essence} 精华）`
  });
});

// GET /api/city/campaign — main story state, current objective and the epilogue once finished
router.get('/campaign', async (req, res) => {
  const char = getChar(req.query.charId);
  if (!char) return res.status(404).json({ error: 'Character not found' });
  const c = campaignMod.ensure(char.campaign);

  // the epilogue is written once (AI DM when configured) and then cached on the character
  if (c.completedAt && !c.epilogue) {
    const stats = {
      kills: Object.values(char.bestiary || {}).reduce((a, b) => a + b, 0),
      delves: char.delvesCompleted || 0
    };
    let text = null;
    try {
      if (await dm.available()) {
        text = await dm.callLlm([
          { role: 'system', content: 'You are the Dungeon Master closing a long D&D campaign. Write a 3-4 sentence epilogue in Chinese for the hero named in the message. Warm, a little wistful, specific to the deeds listed. No headings, no lists.' },
          { role: 'user', content: `英雄：${char.name}（${char.className}，等级 ${char.level}）。事迹：取回沉没圣物、打开淹没地窟、集齐三条线索、击杀烬后 Yzmerith。累计击杀 ${stats.kills}，完成地牢 ${stats.delves} 次。请写收场词。` }
        ]);
      }
    } catch {}
    c.epilogue = text || campaignMod.fallbackEpilogue(char, stats);
    char.campaign = c;
    saveChar(char);
  }

  res.json({
    ok: true,
    characterName: char.name,
    campaign: c,
    objective: campaignMod.objective(c),
    progress: campaignMod.progress(c),
    log: char.campaignLog || [],
    acts: campaignMod.ACTS.map(a => ({
      id: a.id, act: a.act, name: a.name, icon: a.icon, mapName: a.mapName,
      objective: a.objective, blurb: a.blurb, reward: a.reward,
      done: campaignMod.actDone(c, a.id),
      clues: a.id === 'clues' ? Object.keys(campaignMod.CLUE_LABELS).map(k => ({
        id: k, name: campaignMod.CLUE_LABELS[k], done: !!c.acts.clues[k]
      })) : null
    })),
    epilogue: c.completedAt ? c.epilogue : null,
    stats: {
      level: char.level,
      kills: Object.values(char.bestiary || {}).reduce((a, b) => a + b, 0),
      delves: char.delvesCompleted || 0,
      gold: char.gold || 0,
      trophies: (char.bestiary ? Object.keys(char.bestiary).length : 0)
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

// POST /api/city/gamble — the Boar & Lantern's gambling tables
// { charId, game: 'roulette'|'sicbo'|'slots', stake, bet: {id, number?}, tier: 'standard'|'devil' }
router.post('/gamble', (req, res) => {
  const { charId, game, bet, tier } = req.body || {};
  const char = getChar(charId);
  if (!char) return res.status(404).json({ error: 'Character not found' });

  const kind = String(game || 'roulette');
  const limits = gambling.GAMBLE_LIMITS[kind] || gambling.GAMBLE_LIMITS.roulette;
  const fixedStake = kind === 'slots' ? (gambling.SLOT_TIERS[tier] || gambling.SLOT_TIERS.standard).stake : null;
  const stake = fixedStake !== null ? fixedStake : Math.floor(Number(req.body.stake) || 0);

  if (!stake || stake <= 0) return res.status(400).json({ error: '请先下注。' });
  if (limits.min !== null && (stake < limits.min || stake > limits.max)) {
    return res.status(400).json({ error: `赌注需在 ${limits.min}–${limits.max} gp 之间。` });
  }
  if ((char.gold || 0) < stake) {
    return res.status(400).json({ error: `金币不足：需要 ${stake} gp，你有 ${char.gold || 0} gp。` });
  }

  let result;
  if (kind === 'roulette') {
    const num = Number(bet && bet.number);
    const chosen = (bet && bet.id) || 'red';
    if (chosen === 'straight' && (!Number.isInteger(num) || num < 0 || num > 36)) {
      return res.status(400).json({ error: '押单号需要选 0–36 之间的号码。' });
    }
    result = gambling.spinRoulette({ id: chosen, number: num }, stake);
  } else if (kind === 'sicbo') {
    result = gambling.spinSicBo({ id: (bet && bet.id) || 'small' }, stake);
  } else if (kind === 'slots') {
    result = gambling.spinSlots(tier || 'standard');
  } else {
    return res.status(400).json({ error: '没有这种赌桌。' });
  }

  // every table reports a NET gold delta (stake already accounted for): -stake on a loss,
  // +stake*odds on a win
  char.gold += result.delta;
  const messages = [];
  if (result.payout) messages.push(`赢得 ${result.payout} gp`);
  else if (result.delta > 0) messages.push(`赢得 ${result.delta} gp`);

  // prizes: delve-only tokens (carried into the next delve, discarded when it ends) and potions
  const prizes = [];
  (result.prizeTokens || []).forEach(id => {
    const token = potions.makeToken(id);
    tokensIntoPending(char, token);
    prizes.push({ ...token, pending: true });
  });
  for (let i = 0; i < ((result.potionDrop && result.potionDrop.count) || 0); i++) {
    const bottle = potions.rollMysteryPotion((result.potionDrop && result.potionDrop.tier) || 'standard');
    addItemForCharacter(char, bottle);
    prizes.push(bottle);
  }

  // the devil's bargain: three skulls call up a delve curse, applied when the next delve starts
  let curse = null;
  if (result.curse === 'rolled') {
    curse = gambling.rollCurse();
    char.pendingCurses = char.pendingCurses || [];
    char.pendingCurses.push(curse.id);
    messages.push(`诅咒：${curse.name}（下一场地牢生效）`);
  }

  saveChar(char);
  res.json({
    ok: true, char, stake, result, prizes, curse,
    netGold: result.delta,
    message: `${result.text}${messages.length ? ' ' + messages.join('，') + '。' : ''}`
  });
});

// POST /api/city/identify — one INT (Arcana) check per bottle reveals its hidden effect
router.post('/identify', (req, res) => {
  const { charId, uniqueId } = req.body || {};
  const char = getChar(charId);
  if (!char) return res.status(404).json({ error: 'Character not found' });
  if (!uniqueId) return res.status(400).json({ error: 'Missing uniqueId' });

  const check = engine.d20({});
  const total = check.natural + engine.skillMod(char, 'arcana');
  const outcome = potions.identifyPotion(char, uniqueId, total);
  if (!outcome.ok) return res.status(400).json({ error: outcome.error });
  saveChar(char);
  res.json({ ok: true, char, roll: check.natural, total, dc: outcome.dc, success: outcome.success, effect: outcome.effect, message: outcome.text });
});

module.exports = router;
