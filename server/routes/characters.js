const express = require('express');
const store = require('../store');
const engine = require('../game/engine');
const portraits = require('../portraits');

const router = express.Router();

router.get('/', (req, res) => {
  const chars = store.getCharacters().map(c => ({
    id: c.id, name: c.name, species: c.species, className: c.className, background: c.background,
    level: c.level, xp: c.xp, hpMax: c.hpMax, acBase: c.acBase, gold: c.gold,
    createdAt: c.createdAt,
    portraitUrl: portraits.characterPortraitUrl(c.id),
    levelUp: engine.levelUpInfo(c)
  }));
  res.json(chars);
});

router.post('/', async (req, res) => {
  const draft = req.body || {};
  if (!draft.name || !String(draft.name).trim()) return res.status(400).json({ error: 'Name is required' });
  try {
    const char = engine.buildCharacter({ ...draft, name: String(draft.name).trim().slice(0, 40) });
    char.id = store.newId('char');
    char.createdAt = Date.now();
    try {
      const port = await portraits.ensureCharacterPortrait(char);
      if (port && port.url) char.portraitUrl = port.url;
    } catch {}
    const chars = store.getCharacters();
    chars.push(char);
    store.saveCharacters(chars);
    res.json(char);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.get('/:id', (req, res) => {
  const char = store.getCharacters().find(c => c.id === req.params.id);
  if (!char) return res.status(404).json({ error: 'Character not found' });
  const view = { ...char, portraitUrl: portraits.characterPortraitUrl(char.id), levelUp: engine.levelUpInfo(char) };
  res.json(view);
});

router.post('/:id/portrait', async (req, res) => {
  const char = store.getCharacters().find(c => c.id === req.params.id);
  if (!char) return res.status(404).json({ error: 'Character not found' });
  try {
    const port = await portraits.ensureCharacterPortrait(char, !!(req.body && req.body.force));
    res.json(port);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.put('/:id', (req, res) => {
  const chars = store.getCharacters();
  const char = chars.find(c => c.id === req.params.id);
  if (!char) return res.status(404).json({ error: 'Character not found' });
  if (req.body && req.body.name) char.name = String(req.body.name).trim().slice(0, 40);
  store.saveCharacters(chars);
  res.json(char);
});

router.post('/:id/equip', (req, res) => {
  const chars = store.getCharacters();
  const char = chars.find(c => c.id === req.params.id);
  if (!char) return res.status(404).json({ error: 'Character not found' });
  const { slot, itemId } = req.body || {};
  char.equipped = char.equipped || {};

  if (!itemId || itemId === 'none') {
    char.equipped[slot] = null;
  } else {
    // rolled affix gear is equipped by its unique id; plain items by their catalogue id
    const inInv = (char.inventory || []).some(i => (i.itemId === itemId || i.uniqueId === itemId) && i.qty > 0);
    if (!inInv) return res.status(400).json({ error: 'Item not in inventory' });
    char.equipped[slot] = itemId;
  }

  const dexMod = Math.floor(((char.abilities?.dex || 10) - 10) / 2);
  const armorId = char.equipped.armor;
  const offHandId = char.equipped.offHand;
  let baseAc = 10 + dexMod;

  if (armorId) {
    const arm = (engine.ARMORS || []).find(a => a.id === armorId);
    if (arm) {
      if (arm.type === 'light') baseAc = 11 + dexMod;
      else if (arm.type === 'medium') baseAc = 13 + Math.min(2, dexMod);
      else if (arm.type === 'heavy') baseAc = arm.ac ? parseInt(arm.ac) : 16;
    }
  }
  if (offHandId === 'shield') baseAc += 2;
  if (char.equipped.cloak === 'cloak_protection') baseAc += 1;
  if (char.equipped.ring1 === 'ring_protection') baseAc += 1;
  // keep the equipped armor/shield first in inventory so the engine AC calc
  // (first-armor-find) agrees with the paperdoll, then recompute via the engine
  char.inventory = char.inventory || [];
  const reorder = (itemId) => {
    const idx = char.inventory.findIndex(i => i.itemId === itemId);
    if (idx > 0) { const [it] = char.inventory.splice(idx, 1); char.inventory.unshift(it); }
  };
  if (armorId) reorder(armorId);
  if (offHandId) reorder(offHandId);

  const cls = (engine.CLASSES || []).find(c => c.id === char.className);
  if (cls) engine.applyClassAndSpecies(char, cls, null, char.level || 1, true);

  store.saveCharacters(chars);
  res.json({ ok: true, char });
});

const SUBCLASSES_BY_CLASS = {
  fighter: [
    { id: 'champion', name: 'Champion', desc: 'Improved Critical: your weapon attacks score a critical hit on a d20 roll of 19 or 20.', icon: '🏆' },
    { id: 'battlemaster', name: 'Battle Master', desc: 'Superiority Strike: maneuver dice add +1d8 damage to your martial strikes.', icon: '⚔️' }
  ],
  wizard: [
    { id: 'evoker', name: 'School of Evocation', desc: 'Sculpt Spells & Potent Cantrip: adds INT modifier damage to evocation spells.', icon: '🔥' },
    { id: 'abjurer', name: 'School of Abjuration', desc: 'Arcane Ward: creates a mystic protective barrier absorbing incoming damage.', icon: '🛡️' }
  ],
  rogue: [
    { id: 'thief', name: 'Thief', desc: 'Fast Hands & Supreme Sneak: gain permanent advantage on Stealth rolls and agile interactions.', icon: '🗡️' },
    { id: 'assassin', name: 'Assassin', desc: 'Assassinate: advantage and lethal strikes against surprised and unprepared targets.', icon: '🎯' }
  ],
  barbarian: [
    { id: 'berserker', name: 'Path of the Berserker', desc: 'Frenzy: unleash furious bonus melee attacks while raging.', icon: '🪓' },
    { id: 'wildheart', name: 'Path of the Wild Heart', desc: 'Totemic Resilience: resistance to all damage types except psychic while raging.', icon: '🐻' }
  ],
  cleric: [
    { id: 'life', name: 'Life Domain', desc: 'Disciple of Life: all healing spells and abilities heal an additional +3 hit points.', icon: '✨' },
    { id: 'light', name: 'Light Domain', desc: 'Radiance of the Dawn: harness searing sunlight to blind foes and burn undead.', icon: '☀️' }
  ],
  ranger: [
    { id: 'hunter', name: 'Hunter', desc: 'Colossus Slayer: your attacks deal an additional +1d8 damage to wounded foes.', icon: '🏹' },
    { id: 'gloomstalker', name: 'Gloom Stalker', desc: 'Dread Ambusher: bonus initiative and extra devastating ambush strikes.', icon: '🌑' }
  ],
  paladin: [
    { id: 'devotion', name: 'Oath of Devotion', desc: 'Sacred Weapon: channel divinity to imbue your blade with holy light and accuracy.', icon: '⚜️' },
    { id: 'vengeance', name: 'Oath of Vengeance', desc: 'Vow of Enmity: relentless pursuit granting advantage on attack rolls against your quarry.', icon: '⚖️' }
  ],
  warlock: [
    { id: 'fiend', name: 'The Fiend', desc: "Dark One's Blessing: whenever you reduce a foe to 0 HP, gain temporary hit points.", icon: '😈' },
    { id: 'hexblade', name: 'The Hexblade', desc: 'Hex Warrior: channel your charisma into martial strikes and armor defenses.', icon: '🔮' }
  ],
  sorcerer: [
    { id: 'draconic', name: 'Draconic Bloodline', desc: 'Draconic Resilience: dragon scales grant +1 Armor Class and extra hit points.', icon: '🐉' },
    { id: 'wildmagic', name: 'Wild Magic', desc: 'Tides of Chaos: manipulate fate for advantage on checks, courting wild arcane surges.', icon: '🌀' }
  ],
  druid: [
    { id: 'land', name: 'Circle of the Land', desc: 'Natural Recovery: regain expended spell slots during short rests.', icon: '🌿' },
    { id: 'moon', name: 'Circle of the Moon', desc: 'Combat Wild Shape: morph into ferocious beasts with enhanced vitality.', icon: '🐺' }
  ],
  bard: [
    { id: 'lore', name: 'College of Lore', desc: 'Cutting Words: use your wit and musical flourish to deflect enemy attacks.', icon: '📜' },
    { id: 'valor', name: 'College of Valor', desc: 'Combat Inspiration: bolster your allies with martial prowess and defensive armor.', icon: '🎺' }
  ],
  monk: [
    { id: 'openhand', name: 'Way of the Open Hand', desc: 'Open Hand Technique: martial arts knock opponents prone and break their footing.', icon: '🥋' },
    { id: 'shadow', name: 'Way of Shadow', desc: 'Shadow Step: slip seamlessly through darkness and silence your steps.', icon: '👤' }
  ]
};

const FEAT_CHOICES = [
  { id: 'tough', name: 'Tough', desc: 'Hit point maximum increases by +2 for every level (retroactive).', icon: '❤️' },
  { id: 'alert', name: 'Alert', desc: '+3 bonus to Initiative rolls; you can never be surprised in combat.', icon: '⚡' },
  { id: 'lucky', name: 'Lucky', desc: '2 Luck points per rest to reroll any attack roll, ability check, or saving throw.', icon: '🍀' },
  { id: 'healer', name: 'Healer', desc: "Use a Healer's Kit as an action to restore 1d4 + 2 + level HP to an ally or yourself.", icon: '🩹' },
  { id: 'savage_attacker', name: 'Savage Attacker', desc: 'Once per turn, reroll weapon damage dice and use either total.', icon: '⚔️' },
  { id: 'tavern_brawler', name: 'Tavern Brawler', desc: 'Unarmed strikes deal 1d4 damage; shove opponents as a bonus action.', icon: '🍺' },
  { id: 'skilled', name: 'Skilled', desc: 'Gain proficiency in 2 additional skills of your choice.', icon: '📖' }
];

router.get('/:id/level-up-options', (req, res) => {
  const char = store.getCharacters().find(c => c.id === req.params.id);
  if (!char) return res.status(404).json({ error: 'Character not found' });
  const currentLvl = char.level || 1;
  const nextLvl = currentLvl + 1;
  const xpNeeded = engine.XP_THRESHOLDS[nextLvl] || null;
  const canLevelUp = xpNeeded !== null && (char.xp || 0) >= xpNeeded;

  const cls = (engine.CLASSES || []).find(c => c.id === char.className) || { hitDie: 8 };
  const conMod = Math.floor(((char.abilities?.con || 10) - 10) / 2);
  const avgHpGain = Math.max(1, Math.floor(cls.hitDie / 2) + 1 + conMod);

  const subclasses = (nextLvl >= 3 && !char.subclass) ? (SUBCLASSES_BY_CLASS[char.className] || []) : [];
  const needsAsiOrFeat = nextLvl === 4 || nextLvl === 8;

  let availableSpells = [];
  if (cls.spellcasting) {
    const maxSlot = Math.min(3, Math.ceil(nextLvl / 2));
    const known = char.spellcasting?.spells || [];
    availableSpells = (engine.SPELLS || []).filter(s =>
      s.level >= 1 && s.level <= maxSlot &&
      (s.classes || []).includes(char.className) &&
      !known.includes(s.id)
    ).map(s => ({ id: s.id, name: s.name, level: s.level, desc: s.desc, school: s.school }));
  }

  res.json({
    currentLevel: currentLvl,
    nextLevel: nextLvl,
    currentXp: char.xp || 0,
    xpNeeded,
    canLevelUp,
    hitDie: cls.hitDie,
    conMod,
    avgHpGain,
    subclasses,
    currentSubclass: char.subclass || null,
    needsSubclass: nextLvl >= 3 && !char.subclass,
    needsAsiOrFeat,
    featChoices: FEAT_CHOICES,
    availableSpells
  });
});

router.post('/:id/level-up', (req, res) => {
  const chars = store.getCharacters();
  const char = chars.find(c => c.id === req.params.id);
  if (!char) return res.status(404).json({ error: 'Character not found' });

  const currentLvl = char.level || 1;
  const nextLvl = currentLvl + 1;
  const xpNeeded = engine.XP_THRESHOLDS[nextLvl];
  if (!xpNeeded || (char.xp || 0) < xpNeeded) {
    return res.status(400).json({ error: `Not enough XP for Level ${nextLvl}. Need ${xpNeeded}, have ${char.xp || 0}.` });
  }

  const { hpChoice, hpRoll, subclass, featOrAsi, chosenAbilities, chosenFeat, chosenSpells } = req.body || {};
  const cls = (engine.CLASSES || []).find(c => c.id === char.className) || { hitDie: 8 };
  const conMod = Math.floor(((char.abilities?.con || 10) - 10) / 2);

  // 1. Calculate HP gain
  let gainedHp = 0;
  if (hpChoice === 'roll') {
    const roll = (typeof hpRoll === 'number' && hpRoll >= 1 && hpRoll <= cls.hitDie)
      ? hpRoll
      : (Math.floor(Math.random() * cls.hitDie) + 1);
    gainedHp = Math.max(1, roll + conMod);
  } else {
    // Default: average
    gainedHp = Math.max(1, Math.floor(cls.hitDie / 2) + 1 + conMod);
  }

  // Check extra HP per level (Tough feat or Hill Dwarf)
  const isTough = char.feat === 'tough' || (char.unlockedFeats && char.unlockedFeats.includes('tough')) || (featOrAsi === 'feat' && chosenFeat === 'tough');
  if (isTough) gainedHp += 2;
  if (char.species === 'hill_dwarf') gainedHp += 1;

  // 2. Subclass
  if (nextLvl >= 3) {
    if (subclass) {
      char.subclass = subclass;
    } else if (!char.subclass && cls.subclass) {
      char.subclass = cls.subclass.id;
    }
  }

  // 3. ASI or Feat (Level 4, 8)
  if (nextLvl === 4 || nextLvl === 8) {
    char.asiCount = (char.asiCount || 0) + 1;
    if (featOrAsi === 'asi' && chosenAbilities && typeof chosenAbilities === 'object') {
      for (const [stat, boost] of Object.entries(chosenAbilities)) {
        if (char.abilities && char.abilities[stat] !== undefined && typeof boost === 'number') {
          char.abilities[stat] = Math.min(20, char.abilities[stat] + boost);
        }
      }
    } else if (featOrAsi === 'feat' && chosenFeat) {
      char.unlockedFeats = char.unlockedFeats || [];
      if (!char.unlockedFeats.includes(chosenFeat)) {
        char.unlockedFeats.push(chosenFeat);
      }
      if (chosenFeat === 'tough') {
        // Tough gives +2 HP per level retroactively
        char.hpMax = (char.hpMax || 10) + (2 * nextLvl);
      }
      if (chosenFeat === 'alert') {
        char.alertFeat = true;
      }
    } else {
      // Default: boost primary class stat by 2
      const primary = cls.primary || 'str';
      if (char.abilities && char.abilities[primary] !== undefined) {
        char.abilities[primary] = Math.min(20, char.abilities[primary] + 2);
      }
    }
  }

  // 4. Spells (Casters)
  if (Array.isArray(chosenSpells) && chosenSpells.length) {
    char.spellcasting = char.spellcasting || { spells: [] };
    char.spellcasting.spells = char.spellcasting.spells || [];
    chosenSpells.forEach(sId => {
      if (!char.spellcasting.spells.includes(sId)) char.spellcasting.spells.push(sId);
    });
  }

  // 5. Apply level & recalculate
  char.level = nextLvl;
  char.hpMax = (char.hpMax || 10) + gainedHp;
  char.hp = char.hpMax; // Restored to max on level up
  delete char.pendingLevelUp;

  engine.applyClassAndSpecies(char, cls, null, char.level, true);

  // Synchronize any active delves/saves
  try {
    store.listSaves().forEach(s => {
      if (s.characterId === char.id) {
        const saveState = store.getSave(s.id);
        if (saveState) {
          saveState.character = JSON.parse(JSON.stringify(char));
          const pe = engine.playerEntity(saveState);
          if (pe) { pe.hpMax = char.hpMax; pe.hp = char.hp; pe.ac = char.acBase; }
          store.saveGame(saveState);
        }
      }
    });
  } catch {}

  store.saveCharacters(chars);
  res.json({ ok: true, char, gainedHp, newLevel: nextLvl });
});

router.delete('/:id', (req, res) => {
  let chars = store.getCharacters();
  const before = chars.length;
  chars = chars.filter(c => c.id !== req.params.id);
  if (chars.length === before) return res.status(404).json({ error: 'Character not found' });
  store.saveCharacters(chars);
  store.listSaves().forEach(s => { if (s.characterId === req.params.id) store.deleteSave(s.id); });
  res.json({ ok: true });
});

module.exports = router;
