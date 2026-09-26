// AI D&D — game engine: dice, character building, movement, fog of war, combat, XP, rests.
// The engine is deterministic: the LLM (if any) only narrates what the engine resolves.
const path = require('path');
const fs = require('fs');
const content = require('./content');
const affixes = require('./affixes');
const forgeMod = require('./forge');

const SHARED = path.join(__dirname, '..', '..', 'shared');
const load = (f) => JSON.parse(fs.readFileSync(path.join(SHARED, f), 'utf8'));
const SPECIES = load('species.json').species;
const CLASSES = load('classes.json').classes;
const BG_DATA = load('backgrounds.json');
const BACKGROUNDS = BG_DATA.backgrounds;
const FEATS = BG_DATA.feats;
const WEAPONS = load('equipment.json').weapons;
const ARMORS = load('equipment.json').armor;
const GEAR = load('equipment.json').gear;
const SPELLS = load('spells.json').spells;
const MONSTER_DATA = load('monsters.json');
const MONSTERS = MONSTER_DATA.monsters;
const ALLY_DEF = MONSTER_DATA.ally;
const ALLIES = MONSTER_DATA.allies || [ALLY_DEF];
const MAPS = { crypt: load('maps/crypt.json') };

const ABILITIES = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
const SKILL_ABILITY = {
  acrobatics: 'dex', animal_handling: 'wis', arcana: 'int', athletics: 'str', deception: 'cha',
  history: 'int', insight: 'wis', intimidation: 'cha', investigation: 'int', medicine: 'wis',
  nature: 'int', perception: 'wis', performance: 'cha', persuasion: 'cha', religion: 'int',
  sleight_of_hand: 'dex', stealth: 'dex', survival: 'wis'
};
const ALL_SKILLS = Object.keys(SKILL_ABILITY);
const XP_THRESHOLDS = { 2: 300, 3: 900, 4: 2700, 5: 6500, 6: 8500, 7: 13000, 8: 19000, 9: 26000, 10: 34000, 11: 50000, 12: 75000 };
const SLOTS = {
  full: { 1: { 1: 2 }, 2: { 1: 3 }, 3: { 1: 4, 2: 2 }, 4: { 1: 4, 2: 3 }, 5: { 1: 4, 2: 3, 3: 2 }, 6: { 1: 4, 2: 3, 3: 3 }, 7: { 1: 4, 2: 3, 3: 3, 4: 1 }, 8: { 1: 4, 2: 3, 3: 3, 4: 2 }, 9: { 1: 4, 2: 3, 3: 3, 4: 3, 5: 1 }, 10: { 1: 4, 2: 3, 3: 3, 4: 3, 5: 2 }, 11: { 1: 4, 2: 3, 3: 3, 4: 3, 5: 3, 6: 1 }, 12: { 1: 4, 2: 3, 3: 3, 4: 3, 5: 3, 6: 1 } },
  half: { 1: { 1: 2 }, 2: { 1: 2 }, 3: { 1: 3 }, 4: { 1: 3 }, 5: { 1: 4, 2: 2 }, 6: { 1: 4, 2: 2 }, 7: { 1: 4, 2: 3 }, 8: { 1: 4, 2: 3 }, 9: { 1: 4, 2: 3, 3: 2 }, 10: { 1: 4, 2: 3, 3: 2 }, 11: { 1: 4, 2: 3, 3: 2 }, 12: { 1: 4, 2: 3, 3: 2 } },
  pact: { 1: { 1: 2 }, 2: { 1: 2 }, 3: { 1: 2 }, 4: { 1: 2 }, 5: { 1: 2, 2: 2 }, 6: { 1: 2, 2: 2 }, 7: { 1: 2, 2: 3 }, 8: { 1: 2, 2: 3 }, 9: { 1: 2, 2: 3, 3: 1 }, 10: { 1: 2, 2: 3, 3: 1 }, 11: { 1: 2, 2: 3, 3: 1 }, 12: { 1: 2, 2: 3, 3: 2 } }
};

const byId = (arr, id) => arr.find(x => x.id === id);
const mod = (score) => Math.floor((score - 10) / 2);
const cap = (s) => s ? s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, ' ') : '';

// ---------------------------------------------------------------- difficulty ----
const DIFFICULTY = {
  easy: { label: 'Easy', hpMult: 0.75, dmgMult: 0.75, bonusPotions: 2, blurb: 'Monsters are frail (−25% HP and damage) and you carry 4 potions.' },
  normal: { label: 'Normal', hpMult: 1, dmgMult: 1, bonusPotions: 0, blurb: 'The crypt as intended. You carry 2 potions.' },
  hard: { label: 'Hard', hpMult: 1.25, dmgMult: 1.25, bonusPotions: -1, blurb: 'Monsters are mighty (+25% HP and damage). You carry 1 potion.' }
};

// Marla's stock — validated server-side, rendered client-side from /api/rules
const SHOP_ITEMS = [
  { id: 'potion_healing', name: 'Potion of Healing', price: 25, desc: 'Bonus action: regain 2d4+2 HP.' },
  { id: 'potion_greater', name: 'Greater Healing Potion', price: 50, desc: 'Bonus action: regain 4d4+4 HP.' },
  { id: 'healers_kit', name: "Healer's Kit", price: 15, desc: 'Needed for the Healer feat; patches wounds.' },
  { id: 'thieves_tools', name: "Thieves' Tools", price: 25, desc: 'Pick locks and disarm traps.' },
  { id: 'silver_sword', name: 'Silver Shortsword', price: 200, desc: 'Magic shortsword: +1 to attack and damage.' },
  { id: 'scroll_magic_missile', name: 'Scroll of Magic Missile', price: 75, desc: 'One-shot: 3d4+3 force damage.' },
  { id: 'scroll_shield', name: 'Scroll of Shield', price: 75, desc: 'One-shot: +5 AC until your next turn.' },
  { id: 'scroll_cure', name: 'Scroll of Cure Wounds', price: 60, desc: 'One-shot: heal 1d8+3 HP.' },
  { id: 'scroll_sleep', name: 'Scroll of Sleep', price: 80, desc: 'One-shot: put a creature to sleep.' }
];

// Find an inventory entry by unique rolled id first, then by base item id (plain items win over rolled twins)
function invEntry(char, ref) {
  if (!char || !char.inventory || !ref || ref === 'none') return null;
  const byUnique = char.inventory.find(i => i.uniqueId === ref);
  if (byUnique) return byUnique;
  return char.inventory.find(i => i.itemId === ref && !i.uniqueId) || char.inventory.find(i => i.itemId === ref) || null;
}

// Sum one affix bonus (acBonus / hpBonus / speedBonus) across every currently equipped item
function equippedBonus(char, key) {
  if (!char || !char.equipped || !char.inventory) return 0;
  let total = 0;
  Object.keys(char.equipped).forEach(slot => {
    const it = invEntry(char, char.equipped[slot]);
    if (it && it[key]) total += it[key];
  });
  return total;
}

// Weapons resolve either from the weapon table, magic gear, or custom rolled affix items in inventory
function resolveWeapon(id, char) {
  const inv = invEntry(char, id);
  if (inv && (inv.magic || inv.bonusDamage || inv.vampiricHeal || (inv.uniqueId && inv.rarity))) {
    const base = byId(WEAPONS, inv.itemId) || byId(WEAPONS, id);
    if (base) {
      return Object.assign({}, base, {
        id: inv.uniqueId || inv.itemId,
        name: inv.name || base.name,
        magic: inv.magic || 0,
        bonusDamage: inv.bonusDamage || null,
        vampiricHeal: inv.vampiricHeal || null
      });
    }
  }
  const w = byId(WEAPONS, id);
  if (w) return w;
  const g = content.getGear(id);
  if (g && g.type === 'magic_weapon') {
    const base = byId(WEAPONS, g.base) || { name: g.name, damage: '1d4', damageType: 'bludgeoning', props: [], type: 'simple_melee', range: 5 };
    return Object.assign({}, base, { id, name: g.name, magic: g.magic || 0, bonusDamage: g.bonusDamage || null });
  }
  return null;
}

function itemName(id) {
  const w = byId(WEAPONS, id), a = byId(ARMORS, id), g = content.getGear(id);
  return (w || a || g || { name: id }).name;
}

function addItemToInventory(char, itemOrId, qty = 1) {
  if (typeof itemOrId === 'string') {
    const existing = char.inventory.find(i => i.itemId === itemOrId && !i.rarity);
    if (existing) existing.qty += qty;
    else char.inventory.push({ itemId: itemOrId, qty });
  } else if (itemOrId && typeof itemOrId === 'object') {
    char.inventory.push({ ...itemOrId, qty: itemOrId.qty || qty });
  }
}

// ---------------------------------------------------------------- dice ----
function die(n) { return 1 + Math.floor(Math.random() * n); }
function rollExpr(expr) {
  const m = /^(\d+)d(\d+)([+-]\d+)?$/.exec(String(expr).replace(/\s/g, ''));
  if (!m) return { total: 0, rolls: [], flat: 0 };
  const count = +m[1], sides = +m[2], flat = m[3] ? +m[3] : 0;
  const rolls = [];
  for (let i = 0; i < count; i++) rolls.push(die(sides));
  const total = rolls.reduce((a, b) => a + b, 0) + flat;
  return { total, rolls, flat };
}
// d20 with advantage/disadvantage and halfling luck (reroll natural 1s)
function d20(opts = {}) {
  const rollOne = () => {
    let r = die(20);
    if (r === 1 && opts.reroll1) r = die(20);
    return r;
  };
  const rolls = opts.adv || opts.dis ? [rollOne(), rollOne()] : [rollOne()];
  const natural = opts.adv ? Math.max(...rolls) : opts.dis ? Math.min(...rolls) : rolls[0];
  return { natural, rolls, adv: !!opts.adv, dis: !!opts.dis };
}
// damage roll: dice expr may include flat mod ("1d6+2"); crit doubles only the dice part
function damageRoll(diceExpr, opts = {}) {
  const m = /^(\d+)d(\d+)([+-]\d+)?$/.exec(String(diceExpr).replace(/\s/g, ''));
  const count = m ? +m[1] : 0, sides = m ? +m[2] : 6, flat = m && m[3] ? +m[3] : 0;
  const rollSet = () => { const r = []; for (let i = 0; i < count; i++) r.push(die(sides)); return r; };
  let rolls = rollSet();
  if (opts.gwf) rolls = rolls.map(x => (x <= 2 ? x + die(sides) - 1 : x)); // Great Weapon Fighting: reroll 1s & 2s
  let total = rolls.reduce((a, b) => a + b, 0);
  if (opts.rerollAll) { // Savage Attacker: reroll and take the higher total
    const r2 = rollSet().reduce((a, b) => a + b, 0);
    if (r2 > total) total = r2;
  }
  if (opts.crit) total += rollSet().reduce((a, b) => a + b, 0);
  return { total: total + flat, dice: total };
}

// ------------------------------------------------------- character build ----
function finalizeSpells(cls, sc, draft, abilities, profBonus, level) {
  const ability = sc.ability;
  const spellMod = mod(abilities[ability]);
  const cantrips = [...(draft.cantrips || [])];
  const spells = [...(draft.spells || [])];
  const sp = byId(SPECIES, draft.species);
  const spEff = sp ? sp.effect || {} : {};
  const legacy = (draft.speciesChoices || {}).legacy;
  if (spEff.cantrip) cantrips.push(spEff.cantrip);
  if (sp.id === 'tiefling') {
    if (legacy === 'abyssal') cantrips.push('poison_spray');
    if (legacy === 'infernal') cantrips.push('fire_bolt');
  }
  if (cls.id === 'druid') cantrips.push('guidance'); // Primal Order (Magical) extra cantrip
  const freeSpell = { id: null, max: 0 };
  if (draft.feat === 'magic_initiate_cleric') { cantrips.push('guidance', 'sacred_flame'); freeSpell.id = 'bless'; freeSpell.max = 1; }
  if (draft.feat === 'magic_initiate_druid') { cantrips.push('guidance', 'shillelagh'); freeSpell.id = 'longstrider'; freeSpell.max = 1; }
  if (draft.feat === 'magic_initiate_wizard') { cantrips.push('fire_bolt', 'light'); freeSpell.id = 'mage_armor'; freeSpell.max = 1; }
  return {
    ability, spellMod,
    saveDc: 8 + profBonus + spellMod,
    spellAttack: profBonus + spellMod,
    cantrips: [...new Set(cantrips)],
    spells: [...new Set(spells)],
    freeSpell
  };
}

function buildCharacter(draft) {
  const cls = byId(CLASSES, draft.className);
  const sp = byId(SPECIES, draft.species);
  const bg = byId(BACKGROUNDS, draft.background);
  if (!cls || !sp || !bg) throw new Error('Invalid species/class/background');

  const abilities = {};
  ABILITIES.forEach(a => { abilities[a] = (draft.baseScores || {})[a] || 8; });
  if (draft.bgPlus2) abilities[draft.bgPlus2] += 2;
  if (draft.bgPlus1 === 'all3') ABILITIES.filter(a => bg.abilities.includes(a)).forEach(a => abilities[a] += 1);
  else if (draft.bgPlus1 && draft.bgPlus1 !== draft.bgPlus2) abilities[draft.bgPlus1] += 1;
  else if (draft.bgPlus1 === draft.bgPlus2) abilities[draft.bgPlus1] += 1;

  const profBonus = 2;
  const sc = cls.spellcasting ? finalizeSpells(cls, cls.spellcasting, draft, abilities, profBonus, 1) : null;

  const skills = [...new Set([...(bg.skills || []), ...(draft.skills || [])])];
  const featDef = FEATS[bg.feat] || {};
  if (featDef.extraSkillPicks) (draft.extraSkills || []).forEach(s => skills.push(s));
  const expertise = [];
  if (cls.id === 'rogue') { skills.push('stealth'); expertise.push('stealth', (draft.skills || [])[0] || 'perception'); }
  if (cls.id === 'bard') expertise.push(...(draft.skills || []).slice(0, 2));
  if (cls.id === 'ranger' || cls.id === 'wizard') expertise.push('perception', 'arcana', 'history', 'nature', 'religion', 'investigation');
  const validExp = [...new Set(expertise)].filter(s => skills.includes(s));
  const finalSkills = [...new Set(skills)].filter(s => ALL_SKILLS.includes(s));

  const armorOpt = (cls.armorOptions || []).find(o => o.id === draft.armorOption) || (cls.armorOptions || [])[0];
  const weaponOpt = (cls.weaponOptions || []).find(o => o.id === draft.weaponOption) || (cls.weaponOptions || [])[0];
  const inventory = [];
  const addItems = (items) => (items || []).forEach(it => {
    const existing = inventory.find(i => i.itemId === it.id);
    if (existing) existing.qty += it.qty; else inventory.push({ itemId: it.id, qty: it.qty });
  });
  addItems(armorOpt && armorOpt.items);
  addItems(weaponOpt && weaponOpt.items);
  addItems([{ id: 'potion_healing', qty: 2 }]);
  if (bg.feat === 'crafter') addItems([{ id: 'potion_healing', qty: 2 }]);
  if (bg.feat === 'healer') addItems([{ id: 'healers_kit', qty: 3 }]);
  if (bg.tools === "Thieves' Tools" || cls.id === 'rogue') addItems([{ id: 'thieves_tools', qty: 1 }]);

  const startingArmor = armorOpt && armorOpt.items ? armorOpt.items.find(it => byId(ARMORS, it.id)) : null;
  const startingWeapon = weaponOpt && weaponOpt.items ? weaponOpt.items.find(it => resolveWeapon(it.id)) : null;
  const startingShield = (armorOpt && armorOpt.items && armorOpt.items.some(it => it.id === 'shield')) ||
                         (weaponOpt && weaponOpt.items && weaponOpt.items.some(it => it.id === 'shield'));
  const equipped = {
    armor: startingArmor ? startingArmor.id : null,
    mainHand: startingWeapon ? startingWeapon.id : null,
    offHand: startingShield ? 'shield' : null,
    cloak: null,
    amulet: null,
    ring1: null
  };

  const char = {
    id: draft.id || null, name: draft.name, species: sp.id, className: cls.id, background: bg.id,
    level: 1, xp: 0, abilities, profBonus, skills: finalSkills, expertise: validExp,
    feat: bg.feat, featNote: bg.featNote, fightingStyle: draft.fightingStyle || null,
    invocations: draft.invocations || [],
    choices: { species: draft.speciesChoices || {}, bgPlus2: draft.bgPlus2, bgPlus1: draft.bgPlus1 },
    inventory, gold: 50, spellcasting: sc, equipped,
    hpMax: 0, /** @type {Record<string, number>} */ uses: {}, /** @type {Record<string, number>} */ pools: {}, freeSpellUses: 0, hdUsed: 0
  };
  applyClassAndSpecies(char, cls, sp, 1);
  return char;
}

// compute hp/ac/speed/attacks/uses; used at creation AND on level-up
function applyClassAndSpecies(char, clsArg, spArg, newLevel, recomputeOnly = false) {
  const cls = clsArg || byId(CLASSES, char.className);
  char.profBonus = 2 + Math.floor((Math.max(1, newLevel) - 1) / 4);
  const sp = spArg || byId(SPECIES, char.species);
  const level = char.level = newLevel || char.level;
  const eff = sp.effect || {};
  const abilities = char.abilities;
  const dexM = mod(abilities.dex), conM = mod(abilities.con);

  const hpPerLevelExtra = (eff.hpPerLevel || 0) + ((FEATS[char.feat] || {}).hpPerLevel || 0);
  let gained;
  if (char.hpMax === 0) gained = cls.hitDie + conM;
  else gained = recomputeOnly ? 0 : Math.max(1, die(cls.hitDie) + conM);
  // Vigor-style affix gear adds max HP only while equipped — swap out the previous value before re-adding.
  // char.tempHpMod is the delve-scoped counterpart (brews and curses); it lives on the delve
  // snapshot, so it never leaks back into the roster character.
  const itemHpBonus = equippedBonus(char, 'hpBonus');
  const prevItemHp = char.itemHpBonus || 0;
  const tempHpMod = char.tempHpMod || 0;
  const prevTempMod = char.appliedTempHpMod || 0;
  char.hpMax = Math.max(1, (char.hpMax || 0) - prevItemHp - prevTempMod + itemHpBonus + tempHpMod + gained + hpPerLevelExtra);
  char.itemHpBonus = itemHpBonus;
  char.appliedTempHpMod = tempHpMod;

  const equippedArmorId = char.equipped && char.equipped.armor;
  const equippedArmor = byId(ARMORS, (invEntry(char, equippedArmorId) || {}).itemId);
  const armorItem = equippedArmor || char.inventory.map(i => byId(ARMORS, i.itemId)).find(Boolean);
  let ac;
  if (armorItem) {
    const f = armorItem.ac;
    const dm = /(\d+)\+dex\((\d+)\)/.exec(f);
    if (dm) ac = +dm[1] + Math.min(dexM, +dm[2]);
    else if (f.endsWith('+dex')) ac = +f.split('+')[0] + dexM;
    else ac = +f;
  } else if (cls.id === 'barbarian') ac = 10 + dexM + conM;
  else if (cls.id === 'monk') ac = 10 + dexM + mod(abilities.wis);
  else if (char.invocations.includes('armor_of_shadows')) ac = 13 + dexM;
  else ac = 10 + dexM;
  if (!armorItem && cls.id === 'sorcerer' && char.subclass === 'draconic') ac += 1; // Draconic Resilience
  // a shield counts whether it is the plain shield, a gear shield, or a rolled affix shield
  const offEntry = invEntry(char, char.equipped && char.equipped.offHand);
  const offIsShield = !!offEntry && (offEntry.type === 'shield'
    || (content.getGear(offEntry.itemId) || {}).type === 'shield'
    || (content.getGear(char.equipped && char.equipped.offHand) || {}).type === 'shield');
  const hasShieldEquipped = char.equipped
    ? (char.equipped.offHand === 'shield' || offIsShield)
    : char.inventory.some(i => i.itemId === 'shield');
  if (hasShieldEquipped) ac += 2;
  // cloak and special items contribute if equipped (or in legacy unequipped inventories)
  char.inventory.forEach(i => {
    const g = content.getGear(i.itemId);
    if (g && g.id === 'cloak_protection' && (!char.equipped || char.equipped.cloak === 'cloak_protection')) ac += (g.acBonus || 0);
  });
  if (char.fightingStyle === 'defense') ac += 1;
  char.acBase = ac;

  char.speedFt = eff.speed || sp.speed || 30;
  if (cls.id === 'monk' && level >= 2) char.speedFt += 10;
  if (cls.id === 'ranger' && level >= 6) char.speedFt += 10; // Roving
  char.darkvision = eff.darkvision || 0;
  char.resistances = [...(eff.resistances || [])];
  if (sp.id === 'dragonborn') char.resistances.push(char.choices.species.ancestry || 'fire');
  if (sp.id === 'tiefling') {
    const legacy = char.choices.species.legacy;
    if (legacy === 'abyssal') char.resistances.push('poison');
    if (legacy === 'chthonic') char.resistances.push('necrotic');
    if (legacy === 'infernal') char.resistances.push('fire');
  }
  char.saveAdvConditions = eff.saveAdvConditions || [];
  char.saveAdvAbilities = eff.saveAdvAbilities || [];
  char.poisonAdv = !!eff.poisonAdv;
  char.initBonus = dexM + ((FEATS[char.feat] || {}).initBonus || 0)
    + (cls.id === 'barbarian' && level >= 7 ? 2 : 0); // Feral Instinct

  char.attacks = char.inventory.map(inv => {
    // rolled affix gear resolves by its unique id so each piece keeps its own name and bonuses
    const w = resolveWeapon(inv.uniqueId || inv.itemId, char);
    if (!w) return null;
    const finesse = w.props.includes('finesse');
    const ranged = w.type.endsWith('ranged');
    const thrown = w.props.includes('thrown');
    let ab = abilities.str;
    if ((ranged && !thrown) || (finesse && abilities.dex > abilities.str)) ab = abilities.dex;
    let bonus = char.profBonus + mod(ab);
    let dmgMod = mod(ab);
    if (char.fightingStyle === 'archery' && ranged) bonus += 2;
    if (char.fightingStyle === 'dueling' && !w.props.includes('two_handed') && !w.props.includes('light')) dmgMod += 2;
    if (w.magic) { bonus += w.magic; dmgMod += w.magic; }
    return {
      weaponId: w.id, name: w.name, bonus, dmgDice: w.damage, dmgMod, dmgType: w.damageType,
      ranged, range: w.range || 5, props: w.props,
      heavy: w.props.includes('heavy'), light: w.props.includes('light'),
      twoHanded: w.props.includes('two_handed'), finesse, versatile: w.versatile || null,
      magic: w.magic || 0, bonusDamage: w.bonusDamage || null, vampiricHeal: w.vampiricHeal || null
    };
  }).filter(Boolean);
  const unarmedAb = abilities.str >= abilities.dex ? abilities.str : abilities.dex;
  char.attacks.push({
    weaponId: 'unarmed', name: 'Unarmed Strike', bonus: char.profBonus + mod(unarmedAb),
    dmgDice: cls.id === 'monk' ? (level >= 10 ? '1d10' : level >= 5 ? '1d8' : '1d6') : '1', dmgMod: mod(unarmedAb), dmgType: 'bludgeoning',
    ranged: false, range: 5, props: [], heavy: false, light: false, twoHanded: false, finesse: false
  });
  // the wielded weapon leads the list — the client offers attacks[0] / the first melee entry by default
  const mainRef = char.equipped && char.equipped.mainHand;
  if (mainRef) {
    const mi = char.attacks.findIndex(a => a.weaponId === mainRef);
    if (mi > 0) { const [mainAtk] = char.attacks.splice(mi, 1); char.attacks.unshift(mainAtk); }
  }

  if (cls.spellcasting) {
    const table = SLOTS[cls.spellcasting.slots];
    const slotsDef = table[Math.min(level, 12)] || {};
    char.slotsMax = { ...slotsDef };
    char.slots = char.slots && Object.keys(char.slots).length ? char.slots : { ...slotsDef };
    char.slotsRefresh = cls.spellcasting.slots === 'pact' ? 'short' : 'long';
  } else { char.slotsMax = {}; char.slots = {}; }

  /** @type {Record<string, number>} */
  const uses = (char.uses = char.uses || {});
  (cls.features || []).filter(f => f.level <= level).forEach(f => {
    if (f.uses === '2/short') uses[f.id] = uses[f.id] !== undefined ? uses[f.id] : 2;
    if (f.uses === '1/short') uses[f.id] = uses[f.id] !== undefined ? uses[f.id] : 1;
    if (f.uses === '1/long') uses[f.id] = uses[f.id] !== undefined ? uses[f.id] : 1;
    if (f.uses === 'cha/short') uses[f.id] = uses[f.id] !== undefined ? uses[f.id] : 2 + mod(char.abilities.cha);
  });
  if (eff.breathWeapon) uses.breath_weapon = uses.breath_weapon !== undefined ? uses.breath_weapon : 2;
  if (char.className === 'ranger') uses.hunters_mark_free = uses.hunters_mark_free !== undefined ? uses.hunters_mark_free : 2;
  if (cls.id === 'monk') uses.focus = level;
  char.pools = char.pools || {};
  if ((cls.features || []).some(f => f.id === 'lay_on_hands') && char.pools.lay_on_hands === undefined) char.pools.lay_on_hands = 5 * level;

  char.rerollNat1 = !!eff.rerollNat1;
  char.dropTo1 = !!eff.dropTo1;
  char.dashTempHp = !!eff.dashTempHp;
  char.stonesEndurance = !!eff.reactionStonesEndurance;
  char.breathWeapon = !!eff.breathWeapon;
  char.healingHands = !!eff.healingHands;
  char.tavernBrawler = !!(FEATS[char.feat] || {}).tavernBrawler;
  char.savageAttacker = !!(FEATS[char.feat] || {}).rerollDamage;
  char.luckyFeat = (FEATS[char.feat] || {}).rerollsPerRest || 0;
  char.derivedAt = Date.now();
  return char;
}

function skillMod(char, skill) {
  const abil = SKILL_ABILITY[skill];
  let m = mod(char.abilities[abil]);
  if (char.skills.includes(skill)) { m += char.profBonus; if (char.expertise.includes(skill)) m += char.profBonus; }
  return m;
}
function passivePerception(char) { return 10 + skillMod(char, 'perception'); }

// ------------------------------------------------------------- map utils ----
function getMap(mapId) { return content.getMap(mapId); }
// victory campfire, tolerant of old saves that predate the victory object
function tileChar(map, x, y) {
  if (y < 0 || y >= map.height || x < 0 || x >= map.width) return '#';
  return map.rows[y][x];
}
function doorAt(state, x, y) { return state.objects.find(o => o.type === 'door' && o.x === x && o.y === y); }
function isWall(state, x, y) {
  if (tileChar(state.map, x, y) === '#') return true;
  const d = doorAt(state, x, y);
  return !!(d && !d.open);
}
function isBlocked(state, x, y) {
  if (isWall(state, x, y)) return true;
  if (state.objects && state.objects.some(o => o.type === 'barrel' && !o.exploded && o.x === x && o.y === y)) return true;
  return false;
}
function isDifficult(state, x, y) {
  if (tileChar(state.map, x, y) === ',') return true;
  if (state.objects && state.objects.some(o => o.type === 'hazard' && o.x === x && o.y === y)) return true;
  return false;
}
function entityAt(state, x, y, includeDead = false) {
  return state.entities.find(e => e.x === x && e.y === y && (includeDead || e.alive !== false));
}
function roomAt(state, x, y) {
  return (state.map.rooms || []).find(r => x >= r.rect[0] && x <= r.rect[2] && y >= r.rect[1] && y <= r.rect[3]) || null;
}
function los(state, x0, y0, x1, y1) {
  const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx - dy, x = x0, y = y0;
  while (!(x === x1 && y === y1)) {
    const e2 = 2 * err;
    if (e2 > -dy) { err -= dy; x += sx; }
    if (e2 < dx) { err += dx; y += sy; }
    if (x === x1 && y === y1) break;
    if (isWall(state, x, y)) return false;
  }
  return true;
}
function manhattan(a, b) { return Math.abs(a.x - b.x) + Math.abs(a.y - b.y); }

function bfsPath(state, from, goals, opts = {}) {
  const W = state.map.width, H = state.map.height;
  const goalSet = new Set(goals.map(g => g.x + ',' + g.y));
  const key = (x, y) => x + ',' + y;
  const occupied = new Set(state.entities.filter(e => e.alive !== false && e.id !== opts.self).map(e => key(e.x, e.y)));
  const prev = new Map(); const q = [from]; const seen = new Set([key(from.x, from.y)]);
  while (q.length) {
    const cur = q.shift();
    if (goalSet.has(key(cur.x, cur.y)) && !(cur.x === from.x && cur.y === from.y)) {
      const path = []; let node = cur;
      while (!(node.x === from.x && node.y === from.y)) { path.unshift({ x: node.x, y: node.y }); node = prev.get(key(node.x, node.y)); }
      return path;
    }
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = cur.x + dx, ny = cur.y + dy, k = key(nx, ny);
      if (nx < 0 || ny < 0 || nx >= W || ny >= H || seen.has(k)) continue;
      if (isBlocked(state, nx, ny)) continue;
      if (occupied.has(k) && !goalSet.has(k)) continue;
      seen.add(k); prev.set(k, cur); q.push({ x: nx, y: ny });
    }
  }
  return null;
}

function computeVision(state) {
  const px = playerEntity(state);
  if (!px) return [];
  const radius = 7;
  const visible = [];
  for (let y = Math.max(0, px.y - radius); y <= Math.min(state.map.height - 1, px.y + radius); y++) {
    for (let x = Math.max(0, px.x - radius); x <= Math.min(state.map.width - 1, px.x + radius); x++) {
      if (los(state, px.x, px.y, x, y)) visible.push(x + ',' + y);
    }
  }
  return visible;
}
function markDiscovered(state, visible) {
  const set = new Set(state.discovered);
  visible.forEach(v => set.add(v));
  state.discovered = [...set];
}

// ------------------------------------------------------------- game setup ----
// Generate the per-map part of a world: monsters, NPCs and objects (no hero).
function generateMapState(mapDef, difficulty) {
  const ents = [], objects = [], discovered = [];
  mapDef.entities.forEach(e => {
    if (e.type === 'monster') {
      const def = content.getMonster(e.kind);
      if (!def) return; // unknown kinds are warned about at startGame
      const hp = Math.max(1, Math.round(rollExpr(def.hp).total * DIFFICULTY[difficulty].hpMult));
      const mon = {
        id: e.id, kind: 'monster', monsterId: e.kind, name: e.name || def.name,
        x: e.x, y: e.y, hp, hpMax: hp, ac: def.ac, speedFt: def.speed, abilities: def.abilities,
        attacks: def.attacks, darkvision: def.darkvision || 0, xp: def.xp, boss: !!def.boss,
        vulnerabilities: def.vulnerabilities || [], traits: def.traits || [],
        chief: !!e.chief, conditions: [], buffs: [], alive: true, aware: false, fled: false,
        sx: e.x, sy: e.y
      };
      if (!def.boss && (e.isElite || Math.random() < 0.18)) {
        affixes.applyMonsterAffix(mon);
      }
      ents.push(mon);
    } else if (e.type === 'npc') {
      ents.push({ id: 'npc_' + e.id, kind: 'npc', npcId: e.id, name: e.name, x: e.x, y: e.y, icon: e.icon || '🗣️', alive: true });
      objects.push({ ...e, type: 'npcMarker' });
    } else if (e.type === 'trap') {
      objects.push({ ...e, revealed: false, disarmed: false, triggered: false });
    } else if (e.type === 'barrel') {
      objects.push({ ...e, exploded: false, hp: 1 });
    } else if (e.type === 'spores') {
      objects.push({ ...e, burst: false, hp: 1 });
    } else if (e.type === 'font') {
      objects.push({ ...e, used: false });
    } else if (e.type === 'lever') {
      objects.push({ ...e, pulled: false });
    } else if (e.type === 'hazard') {
      objects.push({ ...e });
    } else {
      objects.push({ ...e, open: e.type === 'door' ? false : undefined, looted: false, unlocked: !e.locked });
    }
  });
  return { ents, objects, discovered };
}

// world flags (room discovery) are per map; everything else is global to the delve
function mapFlagKeys(flags) { return Object.keys(flags).filter(k => k.startsWith('room_')); }

function snapshotWorldMap(state) {
  return {
    name: state.mapName,
    ents: state.entities.filter(e => e.kind === 'monster' || e.kind === 'npc'),
    objects: JSON.parse(JSON.stringify(state.objects)),
    discovered: [...state.discovered],
    flags: Object.fromEntries(mapFlagKeys(state.flags).map(k => [k, true]))
  };
}

function loadWorldMap(state, mapId) {
  const mapDef = content.getMap(mapId);
  const saved = state.world[mapId];
  const gen = saved || generateMapState(mapDef, state.difficulty);
  state.world[mapId] = saved || gen;
  state.mapId = mapDef.id; state.mapName = mapDef.name; state.map = mapDef;
  // swap the cast: hero (+ally) travels, everything else belongs to the map
  const travelers = state.entities.filter(e => e.kind === 'player' || e.kind === 'ally');
  state.entities = [...travelers, ...gen.ents];
  state.objects = gen.objects;
  state.discovered = gen.discovered || [];
  mapFlagKeys(state.flags).forEach(k => delete state.flags[k]);
  Object.entries(gen.flags || {}).forEach(([k, v]) => { state.flags[k] = v; });
  const visible = computeVision(state);
  markDiscovered(state, visible);
  state.world[mapId] = snapshotWorldMap(state);
}

function startGame(character, options = {}) {
  const mapDef = content.getMap(options.mapId);
  const difficulty = DIFFICULTY[options.difficulty] ? options.difficulty : 'normal';
  const state = {
    id: 'save_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
    characterId: character.id, character: JSON.parse(JSON.stringify(character)),
    mapId: mapDef.id, mapName: mapDef.name, map: mapDef, mode: 'explore', difficulty,
    world: {},
    quests: { active: null, completed: [] },
    stats: { dmgDealt: 0, dmgTaken: 0, kills: 0, goldFound: 0, rounds: 0 },
    entities: [], objects: [], discovered: [], flags: { hasRelic: false, altarBlessed: false, victory: false, failed: false, restsBlocked: 0 },
    npcChat: {}, stealth: null, log: [], journal: [], appearances: {}, createdAt: Date.now(), updatedAt: Date.now()
  };

  const p = state.character;
  // Delve-only gear never survives a delve, and this snapshot is the dive's own inventory
  p.inventory = (p.inventory || []).filter(i => !i.delveOnly);
  // Town-bought / gambled prizes that were waiting to be carried in (they expire at the end of this delve)
  (options.carryItems || []).forEach(item => {
    p.inventory.push({ ...(item.uniqueId ? item : { itemId: item.itemId || item }), delveOnly: true, qty: item.qty || 1 });
  });
  // delve-scoped max-HP modifiers start fresh; the swap-out bookkeeping must match
  p.tempHpMod = 0;
  p.appliedTempHpMod = 0;
  // difficulty adjusts starting supplies on this delve's snapshot
  const potionPack = p.inventory.find(i => i.itemId === 'potion_healing');
  if (potionPack) potionPack.qty = Math.max(0, potionPack.qty + DIFFICULTY[difficulty].bonusPotions);
  state.entities.push({
    id: 'player', kind: 'player', name: p.name, x: mapDef.playerStart.x, y: mapDef.playerStart.y,
    hp: p.hpMax, hpMax: p.hpMax, tempHp: 0, ac: p.acBase, speedFt: p.speedFt,
    conditions: [], buffs: [], alive: true
  });

  if (options.bringAlly) {
    let allyId = typeof options.bringAlly === 'string' ? options.bringAlly : 'bram';
    if (allyId === 'true') allyId = 'bram';
    const a = ALLIES.find(x => x.id === allyId) || ALLY_DEF;
    const heroLvl = p.level || 1;
    const lvlBonusHp = (heroLvl - 1) * 3;
    const lvlBonusAtk = Math.floor((heroLvl - 1) / 2);
    const scaledAttacks = (a.attacks || []).map(atk => ({ ...atk, bonus: (atk.bonus || 3) + lvlBonusAtk }));
    state.entities.push({
      id: 'ally', kind: 'ally', allyId: a.id, role: a.role || 'Companion',
      icon: a.icon || '🏹', name: a.name, x: mapDef.playerStart.x + 1, y: mapDef.playerStart.y,
      hp: a.hp + lvlBonusHp, hpMax: a.hp + lvlBonusHp, ac: a.ac, speedFt: a.speed, abilities: a.abilities,
      attacks: scaledAttacks, spells: a.spells || [],
      spellSlots: (a.spells && a.spells.length) ? 1 + Math.floor(heroLvl / 3) : 0,
      darkvision: a.darkvision, conditions: [], buffs: [], alive: true
    });
    state.flags.ally = true;
    state.flags.allyId = a.id;
  }

  // hydrate this map (and warn about unknown monster kinds once)
  mapDef.entities.forEach(e => {
    if (e.type === 'monster' && !content.getMonster(e.kind)) {
      addLog(state, 'system', `Warning: unknown monster kind "${e.kind}" on this map — skipped.`);
    }
  });
  loadWorldMap(state, mapDef.id);

  addLog(state, 'system', `${p.name} the ${cap(p.className)} enters ${mapDef.name}. The delve begins.`);
  return state;
}

// Travel between connected maps via stairs. Per-map progress (chests, doors,
// slain monsters, explored fog) is snapshotted and restored.
function travelTo(state, targetMapId, x, y, events) {
  if (!content.getMap(targetMapId)) { events.push({ type: 'error', text: 'Those stairs lead nowhere.' }); return; }
  if (!state.world) state.world = {}; // saves from before multi-map get it lazily
  state.world[state.mapId] = snapshotWorldMap(state);
  const fromName = state.mapName;
  loadWorldMap(state, targetMapId);
  const p = playerEntity(state);
  p.x = x; p.y = y;
  const ally = state.entities.find(e => e.kind === 'ally');
  if (ally) { ally.x = Math.max(1, x - 1); ally.y = y; }
  // break off any fight — travel is a full disengage
  state.mode = 'explore';
  state.flags.reckless = false;
  const ev = { type: 'travel', narrate: true, text: `${p.name} takes the ancient stairs. The dark of ${fromName} gives way to ${state.mapName}.`, data: { mapId: targetMapId } };
  events.push(ev); addLog(state, 'system', ev.text);
  const visible = computeVision(state);
  markDiscovered(state, visible);
  checkRoomEntry(state, events);
}

function addLog(state, kind, text) {
  state.log.push({ kind, text, ts: Date.now() });
  if (state.log.length > 300) state.log.splice(0, state.log.length - 300);
}

// ------------------------------------------------------ in-character hints ----
// The NPCs teach the rules by mouth: one-time hints tied to real firsts.
function hint(state, key, npcName, text, events) {
  state.flags.hints = state.flags.hints || {};
  if (state.flags.hints[key]) return;
  state.flags.hints[key] = true;
  const ev = { type: 'hint', narrate: false, text: npcName + ': "' + text + '"' };
  events.push(ev); addLog(state, 'npc', ev.text);
}

// ---------------------------------------------------------------- combat ----
function aliveMonsters(state) { return state.entities.filter(e => e.kind === 'monster' && e.alive && !e.fled); }
function playerEntity(state) { return state.entities.find(e => e.kind === 'player'); }
function currentActor(state) {
  if (state.mode !== 'combat') return null;
  const c = state.combat;
  return state.entities.find(e => e.id === c.order[c.turnIdx].id);
}

function alertCheck(state, events) {
  if (state.mode !== 'explore') return;
  const player = playerEntity(state);
  const noticed = [];
  for (const m of aliveMonsters(state)) {
    const d = manhattan(m, player);
    let radius = 8;
    if (state.stealth) {
      const passive = 10 + mod((m.abilities || {}).wis || 10);
      radius = state.stealth.total >= passive ? 1 : 6;
    }
    if (d <= radius && los(state, m.x, m.y, player.x, player.y)) noticed.push(m);
  }
  if (noticed.length) startCombat(state, noticed.map(m => m.id), events);
}

function startCombat(state, monsterIds, events = []) {
  if (state.mode !== 'explore') return;
  state.mode = 'combat';
  state.stealth = null;
  const participants = state.entities.filter(e =>
    (e.kind === 'player' || e.kind === 'ally') || (e.kind === 'monster' && monsterIds.includes(e.id) && e.alive));
  const order = participants.map(e => {
    const dexM = mod((e.abilities || state.character.abilities).dex);
    return { id: e.id, name: e.name, total: d20({}).natural + dexM };
  }).sort((a, b) => b.total - a.total);
  state.combat = { order, turnIdx: 0, round: 1, actionUsed: false, bonusUsed: false, movementLeft: playerEntity(state).speedFt };
  participants.filter(e => e.kind === 'monster').forEach(m => { m.aware = true; });
  const names = order.map(o => `${o.name} (${o.total})`).join(', ');
  hint(state, 'combat', 'Bram the Scout', 'Steel first, questions later! Click a beast to mark your target, then strike. Watch the initiative line — you only act on your turn.', events);
  const ev = { type: 'combat_start', narrate: true, text: `Combat begins! Initiative: ${names}.`, data: { order } };
  events.push(ev); addLog(state, 'mech', ev.text);
  processUntilPlayer(state, events);
}

function endTurn(state, events = []) {
  if (state.mode !== 'combat') return;
  const c = state.combat;
  c.turnIdx++;
  if (c.turnIdx >= c.order.length) {
    c.turnIdx = 0; c.round++;
    tickBuffs(state);
    if (checkPlayerDeath(state, events)) return;
  }
  processUntilPlayer(state, events);
}

function tickBuffs(state) {
  state.entities.forEach(e => {
    if (!e.buffs || !e.buffs.length) return;
    e.buffs.forEach(b => b.rounds--);
    const expiredConds = e.buffs.filter(b => b.rounds <= 0 && b.condition).map(b => b.condId);
    e.buffs = e.buffs.filter(b => b.rounds > 0);
    (expiredConds || []).forEach(cid => { e.conditions = (e.conditions || []).filter(c => c !== cid); });
    const concExpired = e.buffs.some(b => b.id === 'concentrating') && e.buffs.find(b => b.id === 'concentrating').rounds <= 1;
    if (concExpired) { // lost concentration -> end concentration buffs granted to others
      state.entities.forEach(t => { t.buffs = (t.buffs || []).filter(tb => !(tb.srcEntity === e.id && tb.conc)); });
      addLog(state, 'mech', `${e.name}'s concentration is broken.`);
    }
  });
}

function checkPlayerDeath(state, events) {
  if (state.mode === 'over') return true;
  const p = playerEntity(state);
  if (p && p.hp <= 0 && !p.conditions.includes('unconscious')) {
    if (state.character.dropTo1 && !state.flags.dropUsed) {
      p.hp = 1; state.flags.dropUsed = true;
      const ev = { type: 'relentless', narrate: true, text: `${p.name} refuses to fall — Relentless Endurance keeps them at 1 HP!` };
      events.push(ev); addLog(state, 'mech', ev.text);
      return false;
    }
    // 5e dying: death saving throws each turn; 3 successes stabilize, 3 failures kill
    p.hp = 0;
    p.deathSaves = { succ: 0, fail: 0, stable: false };
    if (!p.conditions.includes('unconscious')) p.conditions.push('unconscious');
    p.buffs = [];
    const allyAlive = state.entities.some(e => e.kind === 'ally' && e.alive);
    const ev = { type: 'dying', narrate: true, text: `${p.name} falls, dying! Death saving throws begin each turn — 3 successes stabilize, 3 failures mean the end.${allyAlive ? ' Bram fights on over your body!' : ' No one is left to stand over you…'}` };
    events.push(ev); addLog(state, 'system', ev.text);
    return false;
  }
  return false;
}

function rollDeathSave(state, events) {
  const p = playerEntity(state);
  if (!p.conditions.includes('unconscious') || p.deathSaves.stable) return;
  const roll = d20({});
  let outcome;
  if (roll.natural === 20) {
    p.hp = 1; p.conditions = p.conditions.filter(c => c !== 'unconscious');
    p.deathSaves = { succ: 0, fail: 0, stable: false };
    const ev = { type: 'death_save', narrate: true, text: `NATURAL 20! ${p.name} gasps awake with 1 HP, adrenaline flooding back!` };
    events.push(ev); addLog(state, 'mech', ev.text);
    return;
  }
  if (roll.natural === 1) {
    p.deathSaves.fail += 2; outcome = 'a catastrophic failure — TWO marks of death';
  } else if (roll.natural >= 10) {
    p.deathSaves.succ++; outcome = 'a success';
  } else {
    p.deathSaves.fail++; outcome = 'a failure';
  }
  addLog(state, 'mech', `Death save: d20 ${roll.natural} — ${outcome} (${p.deathSaves.succ} success / ${p.deathSaves.fail} failure).`);
  if (p.deathSaves.fail >= 3) {
    state.mode = 'over'; state.flags.failed = true; p.alive = false;
    const ev = { type: 'player_down', narrate: true, text: `The third failure. ${p.name} slips beyond the reach of any blade or prayer…` };
    events.push(ev); addLog(state, 'system', ev.text);
    return;
  }
  if (p.deathSaves.succ >= 3) {
    p.deathSaves.stable = true;
    const ev = { type: 'death_save', narrate: true, text: `${p.name} stabilizes! The dying slows — but the crypt is still no place to wake up.` };
    events.push(ev); addLog(state, 'mech', ev.text);
  }
}

function processUntilPlayer(state, events) {
  let guard = 0;
  while (state.mode === 'combat' && guard++ < 60) {
    if (checkCombatEnd(state, events)) return;
    const actor = currentActor(state);
    if (!actor) return;
    if (actor.kind !== 'player' && (actor.alive === false || actor.fled)) {
      const c = state.combat;
      c.turnIdx++;
      if (c.turnIdx >= c.order.length) {
        c.turnIdx = 0; c.round++;
        tickBuffs(state);
        if (checkPlayerDeath(state, events)) return;
      }
      continue;
    }
    if (actor.kind === 'player') { beginPlayerTurn(state, events); return; }
    if (actor.kind === 'ally') processAllyTurn(state, actor, events);
    else if (actor.kind === 'monster') processMonsterTurn(state, actor, events);
    if (state.mode !== 'combat') return;
    const c = state.combat;
    c.turnIdx++;
    if (c.turnIdx >= c.order.length) {
      c.turnIdx = 0; c.round++;
      tickBuffs(state);
      if (checkPlayerDeath(state, events)) return;
    }
  }
}

function beginPlayerTurn(state, events = []) {
  const c = state.combat, p = playerEntity(state);
  c.actionUsed = false; c.bonusUsed = false;
  state.flags.used_sneak = false;
  state.flags.used_divine_smite = false;   // Improved Divine Smite is once per turn
  state.flags.savage_used = false;
  c.movementLeft = currentSpeed(state, p);
  removeBuff(p, 'shield'); // Shield lasts until the start of your next turn
  state.flags.used_extra = false;
  if (p.conditions.includes('unconscious')) {
    rollDeathSave(state, events);
    return;
  }
  if (p.conditions.includes('prone')) {
    p.conditions = p.conditions.filter(x => x !== 'prone');
    c.movementLeft = Math.max(0, c.movementLeft - Math.floor(currentSpeed(state, p) / 2));
    addLog(state, 'mech', `${p.name} stands up (half movement).`);
  }
}

function currentSpeed(state, ent) {
  let s = ent.speedFt || 30;
  if (ent.enraged) s += 10;
  (ent.buffs || []).forEach(b => {
    if (b.id === 'longstrider') s += 10;
    if (b.id === 'slowed') s -= 10;
    if (b.id === 'cond_slowed' && b.speedPenalty) s -= b.speedPenalty;
  });
  if (hasBuff(ent, 'wolfform')) s = Math.max(s, 40);
  if (ent.kind === 'player' && state.character) s += equippedBonus(state.character, 'speedBonus');
  return Math.max(0, s);
}

function hasBuff(ent, id) { return !!(ent.buffs || []).some(b => b.id === id); }
function getBuff(ent, id) { return (ent.buffs || []).find(b => b.id === id); }
function addBuff(ent, buff) {
  ent.buffs = ent.buffs || [];
  const existing = ent.buffs.find(b => b.id === buff.id);
  if (existing) Object.assign(existing, buff);
  else ent.buffs.push(buff);
}
function removeBuff(ent, id) { ent.buffs = (ent.buffs || []).filter(b => b.id !== id); }

function currentAc(state, ent) {
  if (ent.kind !== 'player') return ent.ac;
  const char = state.character;
  let ac = char.acBase;
  if (hasBuff(ent, 'mage_armor') && !charHasArmor(char)) ac = 13 + mod(char.abilities.dex);
  if (hasBuff(ent, 'shield')) ac += 5;
  if (char && char.equipped && char.inventory) ac += equippedBonus(char, 'acBonus');
  return ac;
}
function charHasArmor(char) { return char.inventory.some(i => byId(ARMORS, i.itemId)); }

// ---------------------------------------------------------------- damage ----
function applyDamage(state, target, amount, dmgType, events, opts = {}) {
  if (!target || target.alive === false || amount <= 0) return 0;
  let dmg = amount;
  if (!state.stats) state.stats = { dmgDealt: 0, dmgTaken: 0, kills: 0, goldFound: 0, rounds: 0 };
  if (target.kind === 'player') state.stats.dmgTaken += amount;
  const resList = target.kind === 'player' ? (state.character.resistances || []) : (target.resistances || []);
  if (target.kind === 'player' && hasBuff(target, 'rage') && ['bludgeoning', 'piercing', 'slashing'].includes(dmgType)) dmg = Math.floor(dmg / 2);
  // Stone-skinned champions resist weapons — but magic weapons and spells cut straight through
  const resistsPhysicalOnly = !!(target.affix && target.affix.nonmagicalPhysical);
  if (resList.includes(dmgType) && !(resistsPhysicalOnly && opts.magical && ['bludgeoning', 'piercing', 'slashing'].includes(dmgType))) {
    const before = dmg;
    dmg = Math.floor(dmg / 2);
    if (before > 1) addLog(state, 'mech', `${target.name} resists the ${dmgType} damage (${before} → ${dmg}).`);
  }
  if ((target.vulnerabilities || []).includes(dmgType)) dmg *= 2;
  if (target.tempHp) {
    const absorbed = Math.min(target.tempHp, dmg);
    target.tempHp -= absorbed; dmg -= absorbed;
  }
  target.hp -= dmg;
  // wake sleeping / paralyzed creatures
  ['asleep', 'paralyzed'].forEach(cTag => {
    if (target.conditions.includes(cTag)) {
      target.conditions = target.conditions.filter(c => c !== cTag);
      removeBuff(target, cTag);
      addLog(state, 'mech', `${target.name} is shaken awake by the pain!`);
    }
  });
  // concentration check
  const conc = getBuff(target, 'concentrating');
  if (conc && dmg > 0) {
    const dc = Math.max(10, Math.floor(dmg / 2));
    const conAb = target.kind === 'player' ? state.character.abilities : (target.abilities || { con: 10 });
    const save = d20({}).natural + mod(conAb.con || 10);
    if (save < dc) {
      const spellName = conc.spell || 'a spell';
      removeBuff(target, 'concentrating');
      state.entities.forEach(t => { t.buffs = (t.buffs || []).filter(tb => !(tb.srcEntity === target.id && tb.conc)); });
      addLog(state, 'mech', `${target.name}'s concentration on ${spellName} is broken! (${save} vs DC ${dc})`);
    }
  }
  if (target.hp <= 0) {
    if (target.kind === 'monster' && (target.traits || []).some(t => t.startsWith('Undead Fortitude'))) {
      const save = d20({});
      const dc = 5 + amount;
      if (save.natural !== 1 && save.natural + mod((target.abilities || {}).con || 10) >= dc) {
        target.hp = 1;
        const ev = { type: 'undead_fort', narrate: true, text: `${target.name} refuses to fall — Undead Fortitude holds its corpse together! (CON ${save.natural} vs DC ${dc})` };
        events.push(ev); addLog(state, 'mech', ev.text);
        return dmg;
      }
    }
    target.hp = 0; target.alive = false;
    if (!state.stats) state.stats = { dmgDealt: 0, dmgTaken: 0, kills: 0, goldFound: 0, rounds: 0 };
    if (target.kind === 'monster') {
      state.stats.kills++;
      if (state.character) {
        state.character.bestiary = state.character.bestiary || {};
        const mKey = target.monsterId || target.id.replace(/_\d+$/, '');
        state.character.bestiary[mKey] = (state.character.bestiary[mKey] || 0) + 1;
        // elite champions are catalogued per affix so the bestiary can show which variants you met
        if (target.affix && target.affix.id) {
          state.character.bestiaryElite = state.character.bestiaryElite || {};
          const seen = state.character.bestiaryElite[mKey] = state.character.bestiaryElite[mKey] || {};
          seen[target.affix.id] = (seen[target.affix.id] || 0) + 1;
        }
        // first kill of a species fills in its bestiary page (XP once, no permanent combat bonus)
        state.character.bestiaryRewarded = state.character.bestiaryRewarded || {};
        if (!state.character.bestiaryRewarded[mKey]) {
          state.character.bestiaryRewarded[mKey] = true;
          const bonus = 15 + Math.round((target.xp || 50) * 0.15);
          const bEv = { type: 'bestiary_entry', narrate: true, text: `📖 图鉴收录：${target.name} — 首次击杀，+${bonus} XP。` };
          events.push(bEv); addLog(state, 'mech', bEv.text);
          state.flags = state.flags || {};
          state.flags.pendingBestiaryBonus = (state.flags.pendingBestiaryBonus || 0) + bonus;
        }
      }
      const ev = { type: 'kill', narrate: true, text: `${target.name} is destroyed! (+${target.xp} XP)`, data: { xp: target.xp, targetId: target.id, targetX: target.x, targetY: target.y } };
      events.push(ev); addLog(state, 'mech', ev.text);
      awardXp(state, target.xp, events);
      // the bestiary first-kill bonus rides on the same XP award (queued in applyDamage so it
      // is paid once, after the normal kill XP)
      if (state.flags && state.flags.pendingBestiaryBonus) {
        const bonus = state.flags.pendingBestiaryBonus;
        state.flags.pendingBestiaryBonus = 0;
        awardXp(state, bonus, events);
      }
      rollLoot(state, target, events);
      checkQuest(state, 'slay', target.monsterId, events);
    } else if (target.kind === 'ally') {
      const ev = { type: 'ally_down', narrate: true, text: `${target.name} collapses!`, data: { targetId: target.id, targetX: target.x, targetY: target.y } };
      events.push(ev); addLog(state, 'mech', ev.text);
    }
  }
  return dmg;
}

function healEntity(state, ent, amt, events, source) {
  const healed = Math.max(0, Math.min(amt, ent.hpMax - ent.hp));
  ent.hp += healed;
  const ev = { type: 'heal', narrate: healed > 0, text: healed > 0 ? `${source}: ${ent.name} regains ${healed} HP (${ent.hp}/${ent.hpMax}).` : `${ent.name} is already at full health.`, data: { heal: healed, targetId: ent.id, targetX: ent.x, targetY: ent.y } };
  events.push(ev); addLog(state, 'mech', ev.text);
  return healed;
}

// attack mods: adv/dis on the d20; atkRolls add to the attack total; dmgDice add to damage
function attackMods(state, attacker, target, atk, events) {
  const out = { adv: false, dis: false, atkRolls: [], dmgDice: [], bonusFlat: 0 };
  if (attacker.conditions && attacker.conditions.includes('poisoned')) out.dis = true;
  if (attacker.kind !== 'player') {
    if (hasBuff(attacker, 'disadv_next')) out.dis = true;
    if (!atk.ranged && hasFlank(state, attacker, target) && !hasBuff(target, 'dodge')) out.adv = true;
    if (target.kind === 'player') {
      if (hasBuff(target, 'dodge') || target.conditions.includes('prone')) out.dis = true;
      if (state.flags.reckless && !atk.ranged) out.adv = true;
    }
    return out;
  }
  const char = state.character;
  const p = attacker;
  if (hasBuff(p, 'adv_next_attack')) { out.adv = true; }
  if (hasBuff(p, 'brew_fortune')) out.adv = true;   // hunter's-eye brew / token
  if (state.flags.reckless && !atk.ranged) out.adv = true;
  if (!atk.ranged && !atk.spell && hasFlank(state, p, target)) out.adv = true;
  if (hasBuff(target, 'dodge')) out.dis = true;
  if (target.conditions.includes('prone')) { if (!atk.ranged) out.adv = true; else out.dis = true; }
  if (hasBuff(p, 'innate_sorcery') && atk.spell) out.adv = true;
  const bless = getBuff(p, 'blessed');
  if (bless) out.atkRolls.push({ dice: '1d4', type: 'bless' });
  const altarBless = getBuff(p, 'altar_blessed');
  if (altarBless) out.bonusFlat += 1;
  if (char.className === 'rogue' && !atk.spell) {
    const allyNear = state.entities.some(e => e.kind === 'ally' && e.alive && manhattan(e, target) <= 1);
    const inRange = atk.ranged ? manhattan(p, target) <= Math.floor((atk.range || 30) / 5) : manhattan(p, target) <= 1;
    if (inRange && (out.adv || allyNear)) out.dmgDice.push({ dice: Math.ceil(char.level / 2) + 'd6', type: 'sneak', oncePerTurn: 'sneak' });
  }
  const hexed = getBuff(target, 'hexed') || getBuff(target, 'marked');
  if (hexed && !atk.spell) out.dmgDice.push({ dice: hexed.extraDamage, type: hexed.damageType === 'weapon' ? atk.dmgType : hexed.damageType });
  if (hasBuff(p, 'rage') && !atk.ranged && ['slashing', 'piercing', 'bludgeoning'].includes(atk.dmgType)) out.bonusFlat += 2;
  if (hasBuff(p, 'divine_favor') && !atk.spell) out.dmgDice.push({ dice: '1d4', type: 'radiant' });
  if (hasBuff(p, 'smite_charge') && !atk.spell) {
    removeBuff(p, 'smite_charge');
    out.dmgDice.push({ dice: '2d8', type: 'radiant' });
    events.push({ type: 'smite', narrate: false, text: 'Divine Smite erupts — radiant power floods your weapon!' });
  }
  // Improved Divine Smite (paladin L11+): once per turn, melee weapon strikes deal +1d8 radiant
  if (char.className === 'paladin' && char.level >= 11 && !atk.spell && !atk.ranged && !state.flags.used_divine_smite) {
    out.dmgDice.push({ dice: '1d8', type: 'radiant', oncePerTurn: 'divine_smite' });
  }
  return out;
}

function monsterAttack(state, attacker, target, atk, events) {
  const isPlayer = target.kind === 'player';
  const targetAc = currentAc(state, target);
  const mods = attackMods(state, attacker, target, atk, events);
  if (attacker.kind === 'player') {
    const ch = state.character;
    // Battle Master's Commander's Strike charge
    if (hasBuff(attacker, 'superiority') && !atk.spell) {
      removeBuff(attacker, 'superiority');
      mods.dmgDice.push({ dice: '1d8', type: 'superiority' });
      events.push({ type: 'note', narrate: false, text: 'Commander\u2019s Strike! +1d8 damage.' });
    }
    // Oath of Devotion's Sacred Weapon
    if (hasBuff(attacker, 'sacred_weapon') && !atk.spell) {
      mods.bonusFlat += 1;
      const chaM = Math.max(1, mod(ch.abilities.cha));
      mods.dmgDice.push({ flat: chaM, type: 'radiant' });
    }
    // Hunter's Colossus Slayer
    if (ch.subclass === 'hunter' && !atk.spell && target.alive !== false && target.hp < target.hpMax && !state.flags.used_colossus) {
      mods.dmgDice.push({ dice: '1d8', type: 'colossus', oncePerTurn: 'colossus' });
    }
  }
  const opts = { adv: mods.adv && !mods.dis, dis: mods.dis && !mods.adv };
  const roll = d20(opts);
  let atkExtra = 0, extraTxt = '';
  let extraAffixTxt = '';
  if (isPlayer) {
    const bless = getBuff(target, 'blessed');
    if (bless) { const b = die(4); atkExtra += b; extraTxt += ` +${b} bless`; }
    const altar = getBuff(target, 'altar_blessed');
    if (altar) atkExtra += 1;
  }
  const enrageBonus = attacker.enraged ? 2 : 0;
  const total = roll.natural + atk.bonus + enrageBonus + atkExtra;
  const hit = roll.natural === 20 || (roll.natural !== 1 && total >= targetAc);
  const atkStr = `${attacker.name}'s ${atk.name}`;
  if (!hit) {
    const text = `${atkStr} misses ${target.name} (d20 ${roll.natural}${atk.bonus >= 0 ? '+' + atk.bonus : atk.bonus}${extraTxt} = ${total} vs AC ${targetAc}).`;
    events.push({ type: 'miss', narrate: false, text, data: { targetId: target.id, targetX: target.x, targetY: target.y } }); addLog(state, 'mech', text);
    return;
  }
  const crit = roll.natural === 20;
  const rolled = damageRoll(atk.damage, { crit });
  // player attackers route through attackMods too — consume the damage riders it computed
  // (they used to be pushed but silently dropped, so Commander's Strike et al did nothing)
  if (isPlayer) {
    mods.dmgDice.forEach(b => {
      if (b.oncePerTurn && state.flags['used_' + b.oncePerTurn]) return;
      const r = rollExpr(b.dice);
      rolled.total += r.total;
      extraAffixTxt += ` +${r.total} ${b.type}`;
      if (b.oncePerTurn) state.flags['used_' + b.oncePerTurn] = true;
    });
    rolled.total += mods.bonusFlat;
  }
  // difficulty scales only monster damage, never the ally's
  const dmgMult = attacker.kind === 'monster' ? DIFFICULTY[state.difficulty || 'normal'].dmgMult : 1;
  const enrageFlat = attacker.enraged ? 2 : 0;
  if (attacker.affix && attacker.affix.bonusDamage) {
    const extra = rollExpr(attacker.affix.bonusDamage.dice).total;
    rolled.total += extra;
    extraAffixTxt = ` (+${extra} ${attacker.affix.bonusDamage.type})`;
  }
  const dmg = { total: Math.max(1, Math.round((rolled.total + enrageFlat) * dmgMult)), dice: rolled.dice };
  let text = `${atkStr} hits ${target.name}${crit ? ' — CRITICAL HIT!' : ''} for ${dmg.total} ${atk.damageType} damage${extraAffixTxt}.`;
  events.push({ type: 'attack_in', narrate: true, text, data: { dmg: dmg.total, crit, targetId: target.id, targetX: target.x, targetY: target.y } });
  addLog(state, 'mech', text);
  // Stone's Endurance (Goliath reaction, auto-used on heavy hits)
  if (isPlayer && state.character.stonesEndurance && (state.character.uses.stones_endurance === undefined || state.character.uses.stones_endurance > 0) && dmg.total >= 6) {
    state.character.uses.stones_endurance = 0;
    const reduce = rollExpr('1d12').total + mod(state.character.abilities.con);
    const ev = { type: 'stones', narrate: true, text: `Stone's Endurance! ${target.name} braces and shrugs off ${reduce} damage.` };
    events.push(ev); addLog(state, 'mech', ev.text);
    const dealt = applyDamage(state, target, Math.max(0, dmg.total - reduce), atk.damageType, events);
    addLog(state, 'mech', `${target.name} takes ${dealt} damage (${Math.max(0, target.hp)}/${target.hpMax} HP).`);
    checkPlayerDeath(state, events);
    return;
  }
  const dealt = applyDamage(state, target, dmg.total, atk.damageType, events);
  if (attacker.affix && dealt > 0) {
    if (attacker.affix.vampiricLeech) {
      const healAmt = Math.max(1, Math.floor(dealt * attacker.affix.vampiricLeech));
      healEntity(state, attacker, healAmt, events, `${attacker.name}'s Vampiric Leech`);
    }
    if (attacker.affix.inflictsCondition) {
      applyCondition({ id: attacker.affix.inflictsCondition, rounds: 1 }, target);
      const ev = { type: 'condition', narrate: true, text: `${target.name} is poisoned by ${attacker.name}'s venomous strike — disadvantage on attacks until the end of its next turn!` };
      events.push(ev); addLog(state, 'mech', ev.text);
    }
  }
  if (isPlayer) {
    addLog(state, 'mech', `${target.name} takes ${dealt} damage (${Math.max(0, target.hp)}/${target.hpMax} HP).`);
    if (target.hp > 0 && target.hp < target.hpMax * 0.4) hint(state, 'lowhp', 'Marla the Peddler', 'You are bleeding, dear! Potions are a bonus action — drink one before you faint on me.', events);
  }
  checkPlayerDeath(state, events);
}

function p_name(state) { const p = playerEntity(state); return p ? p.name : 'You'; }

function hasExtraAttack(char) {
  const cls = byId(CLASSES, char.className);
  return (cls.features || []).some(f => f.id === 'extra_attack' && f.level <= char.level);
}

function playerAttack(state, targetId, weaponId, events, opts = {}) {
  const p = playerEntity(state);
  removeBuff(p, 'invisible'); // attacking breaks Invisibility
  const target = state.entities.find(e => e.id === targetId && e.alive !== false);
  const objTarget = (!target) ? state.objects.find(o => o.id === targetId && (o.type === 'barrel' || o.type === 'spores')) : null;
  if (!target && !objTarget) { events.push({ type: 'error', text: 'No such target.' }); return false; }
  const char = state.character;
  let atk = char.attacks.find(a => a.weaponId === weaponId) || char.attacks[0];
  if (!atk) { events.push({ type: 'error', text: 'You have no weapon.' }); return false; }
  if (hasBuff(p, 'shillelagh') && ['club', 'quarterstaff'].includes(atk.weaponId)) {
    atk = { ...atk, bonus: char.profBonus + char.spellcasting.spellMod, dmgDice: '1d8', dmgMod: char.spellcasting.spellMod };
  }

  if (objTarget) {
    if ((objTarget.type === 'barrel' && objTarget.exploded) || (objTarget.type === 'spores' && objTarget.burst)) {
      events.push({ type: 'error', text: `${objTarget.name} is already destroyed.` }); return false;
    }
    const dist = manhattan(p, objTarget);
    if (atk.ranged ? dist > Math.floor((atk.range || 30) / 5) : dist > 1) {
      events.push({ type: 'error', text: atk.ranged ? `${objTarget.name} is out of range (${atk.range} ft).` : `${objTarget.name} is not adjacent — move closer first.` });
      return false;
    }
    if (atk.ranged && !los(state, p.x, p.y, objTarget.x, objTarget.y)) {
      events.push({ type: 'error', text: 'You have no clear shot — something blocks the way.' }); return false;
    }
    const roll = d20({ reroll1: char.rerollNat1 });
    const total = roll.natural + atk.bonus;
    const hit = roll.natural === 20 || (roll.natural !== 1 && total >= 10);
    if (!hit) {
      const text = `${p.name}'s ${atk.name} misses the ${objTarget.name} (d20 ${roll.natural}+${atk.bonus} = ${total} vs AC 10).`;
      events.push({ type: 'miss', narrate: true, text, data: { targetId: objTarget.id, targetX: objTarget.x, targetY: objTarget.y } });
      addLog(state, 'mech', text);
      return true;
    }
    const text = `${p.name} strikes the ${objTarget.name} with ${atk.name}!`;
    events.push({ type: 'attack', narrate: true, text, data: { dmg: 1, crit: roll.natural === 20, target: objTarget.name, targetId: objTarget.id, targetX: objTarget.x, targetY: objTarget.y } });
    addLog(state, 'mech', text);
    if (objTarget.type === 'barrel') detonateBarrel(state, objTarget, events, `${p.name}'s ${atk.name}`);
    else if (objTarget.type === 'spores') triggerSpores(state, objTarget, events);
    return true;
  }

  const dist = manhattan(p, target);
  if (atk.ranged ? dist > Math.floor((atk.range || 30) / 5) : dist > 1) {
    events.push({ type: 'error', text: atk.ranged ? `${target.name} is out of range (${atk.range} ft).` : `${target.name} is not adjacent — move closer first.` });
    return false;
  }
  if (atk.ranged && !los(state, p.x, p.y, target.x, target.y)) {
    events.push({ type: 'error', text: 'You have no clear shot — something blocks the way.' }); return false;
  }

  const mods = attackMods(state, p, target, atk, events);
  const rollOpts = { adv: mods.adv && !mods.dis, dis: mods.dis && !mods.adv, reroll1: char.rerollNat1 };
  const roll = d20(rollOpts);
  let atkBonus = atk.bonus + mods.bonusFlat;
  let atkExtra = 0, extraTxt = '';
  mods.atkRolls.forEach(b => { const r = rollExpr(b.dice); atkExtra += r.total; extraTxt += ` +${r.total} ${b.type}`; });
  const total = roll.natural + atkBonus + atkExtra;
  const critThreshold = (char.subclass === 'champion') ? 19 : 20;
  const crit = roll.natural >= critThreshold;
  const hit = crit || (roll.natural !== 1 && total >= currentAc(state, target));
  if (hasBuff(p, 'adv_next_attack')) removeBuff(p, 'adv_next_attack');

  if (!hit) {
    const text = `${p.name}'s ${atk.name} misses ${target.name} (d20 ${roll.natural}${atkBonus >= 0 ? '+' + atkBonus : atkBonus}${extraTxt} = ${total} vs AC ${target.ac}).`;
    events.push({ type: 'miss', narrate: true, text, data: { targetId: target.id, targetX: target.x, targetY: target.y } }); addLog(state, 'mech', text);
    return true;
  }
  let dmg = damageRoll(atk.dmgDice, { crit, gwf: char.fightingStyle === 'great_weapon', rerollAll: char.savageAttacker && !state.flags.savage_used });
  if (char.savageAttacker) state.flags.savage_used = true;
  let dmgTotal = dmg.total + (atk.dmgMod || 0) + mods.bonusFlat;
  const bonusTxts = [];
  if (atk.dmgMod) bonusTxts.push(`+${atk.dmgMod} mod`);
  mods.dmgDice.forEach(b => {
    if (b.oncePerTurn && state.flags['used_' + b.oncePerTurn]) return;
    if (b.flat) { dmgTotal += b.flat; bonusTxts.push(`+${b.flat} ${b.type}`); return; }
    const r = rollExpr(b.dice);
    dmgTotal += r.total;
    bonusTxts.push(`+${r.total} ${b.type}`);
    if (b.oncePerTurn) state.flags['used_' + b.oncePerTurn] = true;
  });
  if (char.inventory.some(i => i.itemId === 'amulet_might') && !atk.spell) { dmgTotal += 2; bonusTxts.push('+2 might'); }
  if (atk.bonusDamage) {
    const r = rollExpr(atk.bonusDamage.dice);
    dmgTotal += r.total;
    bonusTxts.push(`+${r.total} ${atk.bonusDamage.type}`);
  }
  const text = `${p.name} strikes ${target.name} with ${atk.name}${crit ? ' — CRITICAL HIT!' : ''}: ${dmg.total}${bonusTxts.length ? ' ' + bonusTxts.join(' ') : ''} = ${dmgTotal} ${atk.dmgType} damage.`;
  events.push({ type: 'attack', narrate: true, text, data: { dmg: dmgTotal, crit, target: target.name, targetId: target.id, targetX: target.x, targetY: target.y } });
  addLog(state, 'mech', text);
  const dealt = applyDamage(state, target, dmgTotal, atk.dmgType, events, { magical: !!atk.magic || !!atk.spell });
  addLog(state, 'mech', `${target.name} takes ${dealt} damage (${target.hp}/${target.hpMax} HP${target.alive === false ? ', slain' : ''}).`);
  if (atk.vampiricHeal && dealt > 0) {
    healEntity(state, p, atk.vampiricHeal, events, `${atk.name} (vampiric)`);
  }
  // Extra Attack (level 5 martials): the Attack action strikes twice
  if (opts.allowExtra && state.mode === 'combat' && !state.flags.used_extra && hasExtraAttack(char)
      && target.alive !== false && manhattan(p, target) <= 1 && atk.weaponId !== 'unarmed') {
    state.flags.used_extra = true;
    addLog(state, 'mech', `${p.name} presses the attack — Extra Attack!`);
    playerAttack(state, targetId, atk.weaponId, events, {});
  }
  if (char.subclass === 'fiend' && target.alive === false) fiendBlessing(state, char, events);
  if (atk.weaponId === 'unarmed' && char.tavernBrawler && target.alive !== false) {
    const dx = Math.sign(target.x - p.x), dy = Math.sign(target.y - p.y);
    const nx = target.x + dx, ny = target.y + dy;
    if (!isBlocked(state, nx, ny) && !entityAt(state, nx, ny)) { target.x = nx; target.y = ny; addLog(state, 'mech', `${target.name} is shoved 5 ft!`); }
  }
  return true;
}

// ---------------------------------------------------------------- spells ----
function findSpell(id) { return byId(SPELLS, id); }

// Life Domain: healing spells restore +2 + spell level
function lifeBonus(char) { return char.subclass === 'life' ? 3 : 0; }

// The Fiend: when the hero drops an enemy, their patron rewards them with Temporary HP
function fiendBlessing(state, char, events) {
  if (char.subclass !== 'fiend') return;
  const p = playerEntity(state);
  const gain = Math.max(1, mod(char.abilities.cha)) + char.level;
  p.tempHp = (p.tempHp || 0) + gain;
  const ev = { type: 'fiend', narrate: true, text: `Dark One's Blessing: your patron rewards the kill with ${gain} Temporary HP.` };
  events.push(ev); addLog(state, 'mech', ev.text);
}

function castSpell(state, spellId, targetId, events, opts = {}) {
  const p = playerEntity(state);
  const char = state.character;
  const sp = findSpell(spellId);
  if (!sp) { events.push({ type: 'error', text: 'Unknown spell.' }); return false; }
  removeBuff(p, 'invisible'); // casting breaks Invisibility

  if (sp.target === 'flavor') {
    const ev = { type: 'cast_flavor', narrate: true, text: `${p.name} casts ${sp.name}. ${sp.desc}` };
    events.push(ev); addLog(state, 'mech', `${p.name} casts ${sp.name}.`);
    return true;
  }

  const isCantrip = sp.level === 0;
  if (!isCantrip && !opts.free) {
    if (!char.slots[sp.level] || char.slots[sp.level] <= 0) { events.push({ type: 'error', text: `No level ${sp.level} spell slots left — take a rest.` }); return false; }
  }
  if (state.mode === 'combat' && !opts.free) {
    if (sp.bonusAction) {
      if (state.combat.bonusUsed) { events.push({ type: 'error', text: 'Bonus action already used this turn.' }); return false; }
      state.combat.bonusUsed = true;
    } else {
      if (state.combat.actionUsed) { events.push({ type: 'error', text: 'Action already used this turn.' }); return false; }
      state.combat.actionUsed = true;
    }
  }
  if (!isCantrip && !opts.free) {
    char.slots[sp.level]--;
    addLog(state, 'mech', `${p.name} casts ${sp.name} (level ${sp.level} slot).`);
  } else {
    addLog(state, 'mech', `${p.name} casts ${sp.name}${isCantrip ? ' (cantrip)' : ''}.`);
  }

  const sc = char.spellcasting;
  const spMod = sc.spellMod, dc = sc.saveDc + (hasBuff(p, 'innate_sorcery') ? 1 : 0), spAtk = sc.spellAttack;

  // concentration: ends previous
  if (sp.conc) {
    p.buffs = (p.buffs || []).filter(b => b.conc !== true);
    addBuff(p, { id: 'concentrating', conc: true, rounds: 99, spell: sp.name });
    state.entities.forEach(t => { t.buffs = (t.buffs || []).filter(tb => !(tb.srcEntity === p.id && tb.conc && tb.id !== 'concentrating')); });
  }

  const resolveTarget = () => state.entities.find(e => e.id === targetId && e.alive !== false);

  if (sp.target === 'self') {
    if (sp.heal) { const r = rollExpr(sp.heal.dice); healEntity(state, p, r.total + spMod + lifeBonus(char), events, sp.name); return true; }
    if (sp.tempHp) {
      const r = rollExpr(sp.tempHp); p.tempHp = (p.tempHp || 0) + r.total;
      const ev = { type: 'buff', narrate: true, text: `Deathly vigor settles over ${p.name}: ${r.total} temporary HP.` };
      events.push(ev); addLog(state, 'mech', `${p.name} gains ${r.total} temp HP.`); return true;
    }
    if (sp.buff) {
      addBuff(p, { id: sp.buff.id, rounds: sp.buff.rounds, ...sp.buff });
      const ev = { type: 'buff', narrate: true, text: `${p.name} casts ${sp.name}. ${sp.desc}` };
      events.push(ev); return true;
    }
  }

  if (sp.target === 'ally') {
    const dest = (targetId === 'player' || !targetId) ? p : (resolveTarget() || p);
    if (dest.kind === 'monster') { events.push({ type: 'error', text: 'You cannot target an enemy with that spell.' }); return true; }
    if (sp.heal) { const r = rollExpr(sp.heal.dice); healEntity(state, dest, r.total + spMod + lifeBonus(char), events, sp.name); return true; }
    if (sp.buff) {
      addBuff(dest, { id: sp.buff.id, rounds: sp.buff.rounds, srcEntity: p.id, conc: !!sp.conc, ...sp.buff });
      const ev = { type: 'buff', narrate: true, text: `${sp.name} settles over ${dest.name}. ${sp.desc}` };
      events.push(ev); return true;
    }
  }

  const target = resolveTarget();
  const objTarget = (!target) ? state.objects.find(o => o.id === targetId && (o.type === 'barrel' || o.type === 'spores')) : null;
  if (objTarget) {
    if ((objTarget.type === 'barrel' && objTarget.exploded) || (objTarget.type === 'spores' && objTarget.burst)) {
      events.push({ type: 'error', text: `${objTarget.name} is already destroyed.` }); return true;
    }
    const dist = manhattan(p, objTarget);
    const rangeTiles = Math.max(1, Math.floor((sp.range || 30) / 5));
    if (dist > rangeTiles) { events.push({ type: 'error', text: `${objTarget.name} is out of range (${sp.range} ft).` }); return true; }
    if (!los(state, p.x, p.y, objTarget.x, objTarget.y)) { events.push({ type: 'error', text: 'You have no clear shot — something blocks the way.' }); return true; }
    const ev = { type: 'spell_hit', narrate: true, text: `${p.name}'s ${sp.name} strikes the ${objTarget.name}!`, data: { targetId: objTarget.id, targetX: objTarget.x, targetY: objTarget.y } };
    events.push(ev); addLog(state, 'mech', ev.text);
    if (objTarget.type === 'barrel') detonateBarrel(state, objTarget, events, `${p.name}'s ${sp.name}`);
    else if (objTarget.type === 'spores') triggerSpores(state, objTarget, events);
    return true;
  }
  if (!target || target.kind !== 'monster') { events.push({ type: 'error', text: 'Choose an enemy target.' }); return true; }
  const dist = manhattan(p, target);
  const rangeTiles = Math.max(1, Math.floor((sp.range || 30) / 5));
  if (dist > rangeTiles) { events.push({ type: 'error', text: `${target.name} is out of range (${sp.range} ft).` }); return true; }

  if (sp.sleepPool) {
    const pool = rollExpr(sp.sleepPool).total;
    if (target.hp <= pool) {
      target.conditions.push('asleep');
      addBuff(target, { id: 'asleep', rounds: 10 });
      const ev = { type: 'sleep', narrate: true, text: `${p.name}'s ${sp.name} washes over ${target.name} — it slumps into magical sleep (${pool} HP pool).` };
      events.push(ev); addLog(state, 'mech', ev.text);
    } else {
      const ev = { type: 'sleep_fail', narrate: true, text: `The slumber washes over ${target.name} (${pool} HP pool) — but it fights off the sleep!` };
      events.push(ev); addLog(state, 'mech', ev.text);
    }
    return true;
  }
  if (sp.buffTarget) {
    addBuff(target, { id: sp.buffTarget.id, rounds: sp.buffTarget.rounds, ...sp.buffTarget });
    const ev = { type: 'hex', narrate: true, text: `${sp.name} takes hold of ${target.name}. ${sp.desc}` };
    events.push(ev); return true;
  }
  if (sp.attack) {
    const fakeAtk = { name: sp.name, ranged: sp.attack === 'ranged', spell: true, dmgType: sp.damage.type, dmgDice: sp.damage.dice, range: sp.range, bonus: spAtk };
    const mods = attackMods(state, p, target, fakeAtk, events);
    const roll = d20({ adv: mods.adv && !mods.dis, dis: mods.dis && !mods.adv, reroll1: char.rerollNat1 });
    let atkExtra = 0;
    mods.atkRolls.forEach(b => { atkExtra += rollExpr(b.dice).total; });
    const total = roll.natural + spAtk + atkExtra + mods.bonusFlat;
    if (roll.natural !== 20 && (roll.natural === 1 || total < target.ac)) {
      const ev = { type: 'miss', narrate: true, text: `${p.name}'s ${sp.name} misses ${target.name} (d20 ${roll.natural}+${spAtk} = ${total} vs AC ${target.ac}).`, data: { targetId: target.id, targetX: target.x, targetY: target.y } };
      events.push(ev); addLog(state, 'mech', ev.text); return true;
    }
    const crit = roll.natural === 20;
    const dmg = damageRoll(sp.damage.dice, { crit });
    if (char.subclass === 'evoker') dmg.total += spMod;
    const ev = { type: 'spell_hit', narrate: true, text: `${p.name}'s ${sp.name} strikes ${target.name}${crit ? ' — CRITICAL!' : ''}: ${dmg.total} ${sp.damage.type} damage.`, data: { dmg: dmg.total, crit, targetId: target.id, targetX: target.x, targetY: target.y } };
    events.push(ev); addLog(state, 'mech', ev.text);
    applyDamage(state, target, dmg.total, sp.damage.type, events, { magical: true });
    if (char.subclass === 'fiend' && target.alive === false) fiendBlessing(state, char, events);
    if (sp.condition && target.alive !== false) applyCondition(sp.condition, target);
    if (sp.id === 'eldritch_blast' && char.invocations.includes('repelling_blast') && target.alive !== false) {
      const dx = Math.sign(target.x - p.x), dy = Math.sign(target.y - p.y);
      if (!isBlocked(state, target.x + dx, target.y + dy) && !entityAt(state, target.x + dx, target.y + dy)) {
        target.x += dx; target.y += dy;
        addLog(state, 'mech', `${target.name} is hurled back 10 ft!`);
      }
    }
    return true;
  }
  if (sp.save) {
    const saveRoll = d20({});
    const saveMod = mod((target.abilities || {})[sp.save.ability] || 10);
    const total = saveRoll.natural + saveMod;
    const success = total >= dc;
    let dmgTotal = 0;
    if (sp.damage) {
      const dmg = rollExpr(sp.damage.dice);
      if (char.subclass === 'evoker') dmg.total += spMod;
      dmgTotal = success && sp.save.onSave === 'half' ? Math.floor(dmg.total / 2) : success ? 0 : dmg.total;
    }
    let text = `${target.name} ${sp.save.ability.toUpperCase()} save: d20 ${saveRoll.natural}+${saveMod} = ${total} vs DC ${dc} — ${success ? 'success' : 'failure'}.`;
    if (sp.damage) text += ` ${dmgTotal} ${sp.damage.type} damage.`;
    events.push({ type: 'save', narrate: true, text, data: { success, dmg: dmgTotal, targetId: target.id, targetX: target.x, targetY: target.y } }); addLog(state, 'mech', text);
    if (sp.damage && dmgTotal) { applyDamage(state, target, dmgTotal, sp.damage.type, events); if (char.subclass === 'fiend' && target.alive === false) fiendBlessing(state, char, events); }
    if (!success && target.alive !== false) {
      if (sp.save.onSave === 'prone') { if (!target.conditions.includes('prone')) target.conditions.push('prone'); addLog(state, 'mech', `${target.name} slips and falls prone!`); }
      if (sp.condition) applyCondition(sp.condition, target);
      if (sp.push) {
        const dx = Math.sign(target.x - p.x), dy = Math.sign(target.y - p.y);
        for (let i = 0; i < sp.push; i++) {
          const nx = target.x + dx, ny = target.y + dy;
          if (isBlocked(state, nx, ny) || entityAt(state, nx, ny)) break;
          target.x = nx; target.y = ny;
        }
        addLog(state, 'mech', `${target.name} is hurled backward by the thunder!`);
      }
    }
    return true;
  }
  if (sp.auto && sp.damage) {
    const dmg = rollExpr(sp.damage.dice);
    const ev = { type: 'spell_hit', narrate: true, text: `${sp.name} slams into ${target.name} unerringly: ${dmg.total} ${sp.damage.type} damage.`, data: { dmg: dmg.total, targetId: target.id, targetX: target.x, targetY: target.y } };
    events.push(ev); addLog(state, 'mech', ev.text);
    applyDamage(state, target, dmg.total, sp.damage.type, events, { magical: true });
    if (char.subclass === 'fiend' && target.alive === false) fiendBlessing(state, char, events);
    return true;
  }
  return true;
}

function applyCondition(cond, target) {
  const c = typeof cond === 'string' ? { id: cond, rounds: 3 } : cond;
  if (!target.conditions.includes(c.id)) target.conditions.push(c.id);
  if (c.rounds) addBuff(target, { id: 'cond_' + c.id, rounds: c.rounds, condId: c.id, speedPenalty: c.speedPenalty || 0, condition: true });
  if (c.id === 'slowed') addBuff(target, { id: 'slowed', rounds: c.rounds || 1 });
  if (c.id === 'disadv_next') addBuff(target, { id: 'disadv_next', rounds: 1 });
}

// ---------------------------------------------------------------- tactics ----
// Opportunity Attacks: leaving a hostile's melee reach provokes one melee
// attack from it (once per creature per round). Disengage/invisibility and
// unaware hosts suppress it.
function hostileAdjacentsWithMelee(state, mover, x, y) {
  const moverside = mover.kind === 'monster' ? 'monster' : 'party';
  return state.entities.filter(e => {
    if (e.alive === false || e.fled) return false;
    const isHostile = (moverside === 'monster') ? (e.kind === 'player' || e.kind === 'ally')
                                               : (e.kind === 'monster');
    if (!isHostile) return false;
    if (e.kind === 'monster' && (!e.aware && state.mode === 'combat')) return false;
    if (manhattan(e, { x, y }) !== 1) return false;
    return (e.attacks || []).some(a => !a.ranged);
  });
}

function canTakeReaction(ent, round) { return ent.oaRound !== round; }

function maybeOpportunityAttack(state, mover, fromX, fromY, toX, toY, events) {
  if (state.mode !== 'combat') return;
  if ((state.flags || {}).noOaFor === mover.id) return; // Disengage active
  if (hasBuff(mover, 'disengaged')) return;
  if (hasBuff(mover, 'invisible')) return; // unseen mover never provokes
  const leaving = hostileAdjacentsWithMelee(state, mover, fromX, fromY)
    .filter(h => manhattan(h, { x: toX, y: toY }) !== 1 || (h.x === toX && h.y === toY));
  for (const h of leaving) {
    if (!canTakeReaction(h, state.combat.round)) continue;
    h.oaRound = state.combat.round;
    const melee = (h.attacks || []).find(a => !a.ranged);
    if (!melee) continue;
    const text = '⚠ ' + h.name + ' strikes at ' + mover.name + ' as they slip away! (Opportunity Attack)';
    events.push({ type: 'opportunity', narrate: true, text, data: { attacker: h.name } });
    addLog(state, 'mech', text);
    monsterAttack(state, h, mover, melee, events);
    if (state.mode !== 'combat' || mover.alive === false) return;
  }
}

// Flanking (optional DM rule): melee attacker gains advantage when an ally
// occupies the tile directly opposite the target.
function hasFlank(state, attacker, target) {
  const sx = Math.sign(target.x - attacker.x), sy = Math.sign(target.y - attacker.y);
  if (!sx && !sy) return false;
  const flankingSpot = { x: target.x + sx, y: target.y + sy };
  const attackerSide = attacker.kind === 'monster' ? 'monster' : 'party';
  return state.entities.some(e => {
    if (e === attacker || e.alive === false) return false;
    const eSide = e.kind === 'monster' ? 'monster' : 'party';
    if (eSide !== attackerSide) return false;
    return e.x === flankingSpot.x && e.y === flankingSpot.y;
  });
}

// Universal Shove: contested STR check, pushes the target 1 tile away.
function shoveTarget(state, targetId, events) {
  const p = playerEntity(state);
  const char = state.character;
  const target = state.entities.find(e => e.id === targetId && e.alive !== false && e.kind === 'monster');
  if (!target) { events.push({ type: 'error', text: 'No such target.' }); return false; }
  if (manhattan(p, target) > 1) { events.push({ type: 'error', text: target.name + ' is not adjacent.' }); return false; }
  const athleteProf = char.skills.includes('athletics');
  const myCheck = mod(char.abilities.str) + (athleteProf ? char.profBonus : 0) + die(20);
  const tAthl = mod((target.abilities || {}).str || 10);
  const tAcro = mod((target.abilities || {}).dex || 10);
  const theirCheck = Math.max(tAthl, tAcro) + die(20);
  if (myCheck >= theirCheck) {
    const dx = Math.sign(target.x - p.x), dy = Math.sign(target.y - p.y);
    const nx = target.x + dx, ny = target.y + dy;
    if (isBlocked(state, nx, ny) || entityAt(state, nx, ny)) {
      events.push({ type: 'info', text: target.name + ' braces against the wall — nowhere to shove.' });
      return false;
    }
    target.x = nx; target.y = ny;
    if (target.conditions.includes('prone') === false && die(20) >= 18) {
      target.conditions.push('prone');
      addLog(state, 'mech', target.name + ' also falls prone!');
    }
    const ev = { type: 'shove', narrate: true, text: p.name + ' shoves ' + target.name + ' back 5 ft! (Contest ' + myCheck + ' vs ' + theirCheck + ')' };
    events.push(ev); addLog(state, 'mech', ev.text);
  } else {
    const ev = { type: 'shove_fail', narrate: true, text: p.name + ' fails to shove ' + target.name + ' (Contest ' + myCheck + ' vs ' + theirCheck + ').' };
    events.push(ev); addLog(state, 'mech', ev.text);
  }
  return true;
}

// ---------------------------------------------------------------- movement ----
function stepCost(state, x, y) { return isDifficult(state, x, y) ? 2 : 1; }

function playerSaveBonus(state, ability) {
  const char = state.character;
  let bonus = 0;
  if (char.className === 'paladin' && char.level >= 6) bonus += Math.max(1, mod(char.abilities.cha)); // Aura of Protection
  return bonus;
}

function triggerTrap(state, trap, events) {
  const p = playerEntity(state);
  trap.triggered = true; trap.revealed = true;
  const char = state.character;
  const isDex = String(trap.save || 'dex') === 'dex';
  const evasion = char.className === 'rogue' && char.level >= 7 && isDex; // Evasion
  let saveMod = mod(state.character.abilities[trap.save || 'dex']) + playerSaveBonus(state, trap.save || 'dex');
  const altar = getBuff(p, 'altar_blessed');
  if (altar) saveMod += 1;
  const saveRoll = d20({ reroll1: state.character.rerollNat1 });
  let success = saveRoll.natural + saveMod >= (trap.dc || 13);
  // Fighter Indomitable (level 9+): reroll a failed save once per long rest
  if (!success && char.className === 'fighter' && char.level >= 9 && !char.uses.indomitable_used) {
    char.uses = char.uses || {};
    char.uses.indomitable_used = true;
    const reroll = d20({ reroll1: state.character.rerollNat1 });
    success = reroll.natural + saveMod >= (trap.dc || 13);
    addLog(state, 'mech', 'Indomitable! ' + p.name + ' rerolls the save: d20 ' + reroll.natural + '+' + saveMod + '.');
  }
  const text = `A ${trap.name}! ${p.name} ${String(trap.save || 'dex').toUpperCase()} save: ${saveRoll.natural}+${saveMod} vs DC ${trap.dc} — ${success ? 'they dodge aside!' : 'they are hit!'}${evasion ? ' (Evasion)' : ''}`;
  events.push({ type: 'trap', narrate: true, text }); addLog(state, 'mech', text);
  if (!success) {
    let dmg = rollExpr(trap.damage).total;
    if (evasion) dmg = Math.floor(dmg / 2);
    const dealt = applyDamage(state, p, dmg, trap.damageType || 'piercing', events);
    addLog(state, 'mech', `${p.name} takes ${dealt} damage.`);
    checkPlayerDeath(state, events);
  }
}

function noticeTrapsNearby(state, events) {
  const p = playerEntity(state);
  state.objects.filter(o => o.type === 'trap' && !o.revealed && !o.triggered).forEach(trap => {
    if (manhattan(trap, p) <= 1) {
      const roll = d20({ reroll1: state.character.rerollNat1 });
      const pm = skillMod(state.character, 'perception');
      if (roll.natural + pm >= 12) {
        trap.revealed = true;
        const ev = { type: 'trap_spotted', narrate: true, text: `Sharp eyes! ${p.name} spots a ${trap.name} hidden on the floor ahead (Perception ${roll.natural}+${pm}).` };
        events.push(ev); addLog(state, 'mech', ev.text);
      }
    }
  });
}

function disarmTrap(state, trap, rollTotal, events) {
  const p = playerEntity(state);
  if (trap.triggered || trap.disarmed) {
    events.push({ type: 'info', text: 'This trap is already disarmed.' });
    return;
  }
  const dc = trap.dc || 12;
  const success = rollTotal >= dc;
  if (success) {
    trap.disarmed = true;
    trap.triggered = true;
    awardXp(state, 25, events);
    const text = `Success! ${p.name} disarms the ${trap.name} (roll ${rollTotal} vs DC ${dc}). (+25 XP)`;
    events.push({ type: 'trap_disarmed', narrate: true, text, data: { trapId: trap.id, dc, rollTotal, success: true } });
    addLog(state, 'mech', text);
  } else {
    const text = `Failed check (roll ${rollTotal} vs DC ${dc})! The mechanism snaps!`;
    events.push({ type: 'trap_disarm_failed', narrate: true, text, data: { trapId: trap.id, dc, rollTotal, success: false } });
    addLog(state, 'mech', text);
    triggerTrap(state, trap, events);
  }
}

function unlockChest(state, chest, method, rollTotal, events) {
  const p = playerEntity(state);
  if (chest.looted) {
    events.push({ type: 'info', text: 'The chest is already empty.' });
    return;
  }
  const dc = method === 'force' ? (chest.forceDc || 14) : (chest.pickDc || 12);
  const success = rollTotal >= dc;
  if (success) {
    chest.locked = false;
    chest.unlocked = true;
    const text = method === 'force'
      ? `${p.name} shatters the lock with raw force (roll ${rollTotal} vs DC ${dc})!`
      : `Click! ${p.name} picks the tumbler lock (roll ${rollTotal} vs DC ${dc})!`;
    events.push({ type: 'chest_unlocked', narrate: true, text, data: { chestId: chest.id, success: true } });
    addLog(state, 'mech', text);
    lootChest(state, chest, events);
  } else {
    const text = method === 'force'
      ? `The iron bands withstand ${p.name}'s blow (roll ${rollTotal} vs DC ${dc}).`
      : `The lock tumblers jam and resist ${p.name}'s lockpick (roll ${rollTotal} vs DC ${dc}).`;
    events.push({ type: 'chest_locked', narrate: true, text, data: { chestId: chest.id, success: false } });
    addLog(state, 'mech', text);
  }
}

function detonateBarrel(state, barrel, events, source = 'impact') {
  if (!barrel || barrel.exploded) return;
  barrel.exploded = true;
  const dmgRoll = rollExpr('2d8');
  const text = `💥 BOOM! The ${barrel.name} detonates (${source})! Fire erupts across the area for ${dmgRoll.total} fire damage!`;
  events.push({ type: 'barrel_detonate', narrate: true, text, data: { barrelId: barrel.id, x: barrel.x, y: barrel.y, dmg: dmgRoll.total } });
  addLog(state, 'mech', text);

  // Affect all entities within 1 tile (3x3 grid)
  const victims = state.entities.filter(e => e.alive !== false && Math.abs(e.x - barrel.x) <= 1 && Math.abs(e.y - barrel.y) <= 1);
  for (const victim of victims) {
    const isPlayer = victim.kind === 'player';
    const saveMod = isPlayer ? (mod(state.character.abilities.dex) + playerSaveBonus(state, 'dex')) : mod((victim.abilities || {}).dex || 10);
    const roll = d20(isPlayer ? { reroll1: state.character.rerollNat1 } : {});
    const success = (roll.natural + saveMod) >= 12;
    const evasion = isPlayer && state.character.className === 'rogue' && state.character.level >= 7;
    let dealtDmg = success ? (evasion ? 0 : Math.floor(dmgRoll.total / 2)) : dmgRoll.total;
    const saveTxt = `${victim.name} DEX save vs Explosion: ${roll.natural}+${saveMod} vs DC 12 — ${success ? 'half damage' : 'direct hit!'}${evasion && success ? ' (Evasion: 0)' : ''}`;
    events.push({ type: 'save', narrate: true, text: saveTxt, data: { success, targetId: victim.id, targetX: victim.x, targetY: victim.y } });
    addLog(state, 'mech', saveTxt);
    if (dealtDmg > 0) {
      applyDamage(state, victim, dealtDmg, 'fire', events);
      if (isPlayer) checkPlayerDeath(state, events);
    }
  }

  // Chain reaction with any unexploded barrels within 1 tile
  const nearbyBarrels = (state.objects || []).filter(o => o.type === 'barrel' && !o.exploded && Math.abs(o.x - barrel.x) <= 1 && Math.abs(o.y - barrel.y) <= 1);
  for (const nb of nearbyBarrels) {
    detonateBarrel(state, nb, events, 'Chain Reaction');
  }

  // Chain reaction with any unburst spore pods within 1 tile
  const nearbySpores = (state.objects || []).filter(o => o.type === 'spores' && !o.burst && Math.abs(o.x - barrel.x) <= 1 && Math.abs(o.y - barrel.y) <= 1);
  for (const ns of nearbySpores) {
    triggerSpores(state, ns, events);
  }
}

function triggerSpores(state, spores, events) {
  if (!spores || spores.burst) return;
  spores.burst = true;
  const dmgRoll = rollExpr('1d6');
  const text = `🍄 Toxic rupture! The ${spores.name} burst, venting a choking cloud of virulent spores!`;
  events.push({ type: 'spore_burst', narrate: true, text, data: { sporesId: spores.id, x: spores.x, y: spores.y, dmg: dmgRoll.total } });
  addLog(state, 'mech', text);

  const victims = state.entities.filter(e => e.alive !== false && Math.abs(e.x - spores.x) <= 1 && Math.abs(e.y - spores.y) <= 1);
  for (const victim of victims) {
    const isPlayer = victim.kind === 'player';
    const saveMod = isPlayer ? (mod(state.character.abilities.con) + playerSaveBonus(state, 'con')) : mod((victim.abilities || {}).con || 10);
    const roll = d20(isPlayer ? { reroll1: state.character.rerollNat1 } : {});
    const success = (roll.natural + saveMod) >= 12;
    let dealtDmg = success ? Math.floor(dmgRoll.total / 2) : dmgRoll.total;
    const saveTxt = `${victim.name} CON save vs Spores: ${roll.natural}+${saveMod} vs DC 12 — ${success ? 'resists the poison!' : 'poisoned!'}`;
    events.push({ type: 'save', narrate: true, text: saveTxt, data: { success, targetId: victim.id, targetX: victim.x, targetY: victim.y } });
    addLog(state, 'mech', saveTxt);
    if (!success) {
      applyCondition({ id: 'poisoned', rounds: 3 }, victim);
    }
    if (dealtDmg > 0) {
      applyDamage(state, victim, dealtDmg, 'poison', events);
      if (isPlayer) checkPlayerDeath(state, events);
    }
  }
}

function useFont(state, font, events) {
  const p = playerEntity(state);
  if (font.used) {
    events.push({ type: 'info', text: "The font's basin is dry and silent. Its miraculous waters have been depleted." });
    return;
  }
  font.used = true;
  const healAmount = rollExpr('2d4+2').total;
  if (p.conditions && p.conditions.includes('poisoned')) {
    p.conditions = p.conditions.filter(c => c !== 'poisoned');
    p.buffs = (p.buffs || []).filter(b => b.condId !== 'poisoned');
  }
  healEntity(state, p, healAmount, events, 'Sacred Healing Font');
  const text = `✨ ${p.name} drinks from the ${font.name}. Azure light surges through their veins, cleansing poison and restoring ${healAmount} HP!`;
  events.push({ type: 'font_heal', narrate: true, text, data: { fontId: font.id, heal: healAmount } });
  addLog(state, 'mech', text);
}

function pullLever(state, lever, events) {
  lever.pulled = !lever.pulled;
  const targets = lever.targetTrapIds || [];
  targets.forEach(trapId => {
    const trap = (state.objects || []).find(o => o.id === trapId);
    if (trap) {
      trap.disarmed = lever.pulled;
      trap.revealed = true;
    }
  });
  const stateStr = lever.pulled ? 'disarming connected mechanisms' : 're-arming connected mechanisms';
  const text = `⚙️ ${p_name(state)} throws the ${lever.name} with a resonant CLANK. Heavy counterweights shift behind the stone walls, ${stateStr}!`;
  events.push({ type: 'lever_pull', narrate: true, text, data: { leverId: lever.id, pulled: lever.pulled } });
  addLog(state, 'mech', text);
}

function triggerHazard(state, hazard, creature, events) {
  if (!creature || creature.alive === false) return;
  const dmg = rollExpr('1d4').total;
  const type = hazard.hazardType || 'acid';
  const text = `🧪 Sizzle! ${creature.name} steps into the ${hazard.name} and suffers ${dmg} ${type} damage!`;
  events.push({ type: 'hazard_burn', narrate: true, text, data: { hazardId: hazard.id, targetId: creature.id, dmg } });
  addLog(state, 'mech', text);
  applyDamage(state, creature, dmg, type, events);
  if (creature.kind === 'player') checkPlayerDeath(state, events);
}

function movePlayer(state, targetX, targetY, events) {
  const p = playerEntity(state);
  if (state.mode === 'over' || state.mode === 'victory') return;
  const inCombat = state.mode === 'combat';
  const path = bfsPath(state, { x: p.x, y: p.y }, [{ x: targetX, y: targetY }], { self: p.id });
  if (!path) { events.push({ type: 'error', text: 'You cannot reach that tile — a wall or closed door blocks the way.' }); return; }
  let budget = inCombat ? state.combat.movementLeft : Infinity;
  let steps = 0;
  let px_prev = p.x, py_prev = p.y;
  for (const step of path) {
    const cost = stepCost(state, step.x, step.y);
    if (inCombat && budget < cost) { addLog(state, 'mech', 'Out of movement — your turn ends here.'); break; }
    if (entityAt(state, step.x, step.y)) break;
    budget -= cost; steps++;
    p.x = step.x; p.y = step.y;
    if (inCombat) {
      state.combat.movementLeft = budget;
      maybeOpportunityAttack(state, p, px_prev, py_prev, p.x, p.y, events);
      if (state.mode !== 'combat' || p.alive === false || p.hp <= 0) return;
    }
    px_prev = p.x; py_prev = p.y;
    const trap = state.objects.find(o => o.type === 'trap' && o.x === p.x && o.y === p.y && !o.disarmed && !o.triggered);
    if (trap) { triggerTrap(state, trap, events); if (state.mode === 'over') return; }
    const hazard = state.objects.find(o => o.type === 'hazard' && o.x === p.x && o.y === p.y);
    if (hazard) { triggerHazard(state, hazard, p, events); if (state.mode === 'over') return; }
    const spore = state.objects.find(o => o.type === 'spores' && o.x === p.x && o.y === p.y && !o.burst);
    if (spore) { triggerSpores(state, spore, events); if (state.mode === 'over') return; }
    if (!inCombat) {
      alertCheck(state, events);
      if (state.mode === 'combat') return;
    }
  }
  noticeTrapsNearby(state, events);
  if (!inCombat) rollWanderingMonster(state, events);
  const visible = computeVision(state);
  markDiscovered(state, visible);
  if (steps > 0) { checkRoomEntry(state, events); checkVictory(state, events); }
}

// A random encounter: after enough wandering, something finds you first.
function rollWanderingMonster(state, events) {
  const list = state.map.wandering || [];
  if (!list.length || state.mode !== 'explore') return;
  state.flags.wanders = state.flags.wanders || 0;
  if (state.flags.wanders >= 2) return;
  const p = playerEntity(state);
  if ((state.flags.steps || 0) < 6) { state.flags.steps = (state.flags.steps || 0) + 1; return; }
  state.flags.steps = 0;
  if (Math.random() > 0.22) return;
  if (hasBuff(p, 'invisible')) return;
  if (state.stealth && state.stealth.success) return;
  const kind = list[die(list.length) - 1];
  const def = content.getMonster(kind);
  if (!def) return;
  const spots = [];
  for (let y = p.y - 4; y <= p.y + 4; y++) for (let x = p.x - 4; x <= p.x + 4; x++) {
    const d = manhattan({ x, y }, p);
    if (d < 2 || d > 4) continue;
    if (isBlocked(state, x, y) || entityAt(state, x, y)) continue;
    if (!los(state, p.x, p.y, x, y)) continue;
    spots.push({ x, y });
  }
  if (!spots.length) return;
  const spot = spots[die(spots.length) - 1];
  const hp = Math.max(1, Math.round(rollExpr(def.hp).total * DIFFICULTY[state.difficulty || 'normal'].hpMult));
  const mon = {
    id: 'wander_' + Date.now().toString(36), kind: 'monster', monsterId: kind, name: def.name,
    x: spot.x, y: spot.y, hp, hpMax: hp, ac: def.ac, speedFt: def.speed, abilities: def.abilities,
    attacks: def.attacks, darkvision: def.darkvision || 0, xp: Math.round(def.xp * 0.8), boss: false,
    vulnerabilities: def.vulnerabilities || [], traits: def.traits || [],
    conditions: [], buffs: [], alive: true, aware: true, fled: false, wanderer: true, sx: spot.x, sy: spot.y
  };
  if (Math.random() < 0.18) {
    affixes.applyMonsterAffix(mon);
  }
  state.entities.push(mon);
  state.flags.wanders++;
  const ev = { type: 'wandering', narrate: true, text: 'A wandering ' + def.name + ' comes snuffling around the corner - it has found you!' };
  events.push(ev); addLog(state, 'system', ev.text);
  startCombat(state, [mon.id], events);
}

function checkRoomEntry(state, events) {
  const p = playerEntity(state);
  const room = roomAt(state, p.x, p.y);
  if (room && !state.flags['room_' + room.id]) {
    state.flags['room_' + room.id] = true;
    const ev = { type: 'scene', narrate: true, text: `${room.name}: ${room.desc}`, data: { room: room.id, roomName: room.name } };
    events.push(ev); addLog(state, 'dm_canned', ev.text);
    checkQuest(state, 'explore', room.id, events);
  }
}

// ------------------------------------------------------------- side quests ----
// One active side quest at a time. The server picks a REAL target (a living
// monster, an unlooted chest, an unvisited room); the LLM only writes the hook.
function fallbackQuestText(c) {
  if (c.type === 'slay') return `A scarred sellsword slides a heavy pouch across the campfire. "Every ${c.targetName.toLowerCase()} that stops breathing down there makes the road home safer. Handle it, and this is yours."`;
  if (c.type === 'recover') return `"I stashed something in the ${c.targetName.toLowerCase()} before the horrors moved in," mutters a one-eyed prospector. "Bring back what's inside and the pouch is yours. Don't go opening my other caches."`;
  return `"Nobody who walked into the ${c.targetName.toLowerCase()} came back with a sound mind," an old delver says, not looking up. "Walk it end to end, put your eyes on every corner, and we'll call your debts settled."`;
}

function rollSideQuest(state) {
  if (state.quests && state.quests.active) return null;
  const cands = [];
  state.entities.filter(e => e.kind === 'monster' && e.alive && !e.fled).forEach(m => cands.push({ type: 'slay', target: m.monsterId, targetName: m.name }));
  state.objects.filter(o => o.type === 'chest' && !o.looted).forEach(c => cands.push({ type: 'recover', target: c.id, targetName: c.name }));
  (state.map.rooms || []).forEach(r => { if (!state.flags['room_' + r.id]) cands.push({ type: 'explore', target: r.id, targetName: r.name }); });
  if (!cands.length) return null;
  const c = cands[die(cands.length) - 1];
  const quest = {
    id: 'q_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
    type: c.type, target: c.target, targetName: c.targetName,
    shortText: c.type === 'slay' ? `Cull the ${c.targetName}s` : c.type === 'recover' ? `Recover the ${c.targetName}` : `Explore the ${c.targetName}`,
    text: fallbackQuestText(c),
    reward: { gold: 25 + die(5) * 10, xp: 25 + die(6) * 5 },
    created: Date.now()
  };
  state.quests = state.quests || { active: null, completed: [] };
  state.quests.active = quest;
  return quest;
}

function checkQuest(state, type, target, events) {
  const q = state.quests && state.quests.active;
  if (!q || q.type !== type || q.target !== target) return;
  state.quests.active = null;
  state.quests.completed.push({ shortText: q.shortText, text: q.text, reward: q.reward, ts: Date.now() });
  if (q.reward.gold) state.character.gold += q.reward.gold;
  const ev = { type: 'quest_done', narrate: true, text: `SIDE QUEST COMPLETE — ${q.shortText}! You collect ${q.reward.gold} gp and ${q.reward.xp} XP.` };
  events.push(ev); addLog(state, 'system', ev.text);
  awardXp(state, q.reward.xp, events);
}

function campfireOf(state) { return (state.objects || []).find(o => o.id === 'campfire'); }

function checkVictory(state, events) {
  const p = playerEntity(state);
  const v = state.map.victory || { type: 'fetch_relic', campfire: state.map.victoryTile };
  const camp = campfireOf(state);
  if (!camp) return;
  if (!(p.x === camp.x && p.y === camp.y) || state.mode !== 'explore') return;
  let won = false;
  if (v.type === 'slay_boss') {
    const bossAlive = state.entities.some(e => e.kind === 'monster' && e.boss && e.alive && !e.fled);
    if (!bossAlive) won = true;
  } else if (state.flags.hasRelic) won = true;
  if (!won) return;
  state.mode = 'victory'; state.flags.victory = true;
  awardXp(state, 100, events);
  const ev = { type: 'victory', narrate: true, text: `VICTORY! ${p.name} escapes ${state.mapName} into daylight${v.type === 'slay_boss' ? ', leaving a broken guardian behind' : ', the prize in hand'}. The delve is complete! (+100 XP)` };
  events.push(ev); addLog(state, 'system', ev.text);
}

// ---------------------------------------------------------------- monster AI ----
function processMonsterTurn(state, mon, events) {
  if (!mon.alive || mon.fled || state.mode !== 'combat') return;
  if (mon.boss && !mon.enraged && mon.hp <= mon.hpMax / 2) {
    mon.enraged = true;
    const ev = { type: 'enrage', narrate: true, text: `${mon.name} ENRAGES — its wounds only make it faster and crueler! (+2 to hit and damage, +10 ft speed)` };
    events.push(ev); addLog(state, 'mech', ev.text);
  }
  if (mon.conditions.includes('asleep')) { addLog(state, 'mech', `${mon.name} sleeps soundly.`); return; }
  if (mon.conditions.includes('paralyzed')) { addLog(state, 'mech', `${mon.name} stands frozen, muscles locked.`); return; }
  if ((mon.traits || []).some(t => t.startsWith('Nimble Escape'))) addBuff(mon, { id: 'disengaged', rounds: 1 });
  if (hasBuff(mon, 'charmed')) { addLog(state, 'mech', `${mon.name} gazes at ${p_name(state)} with vacant affection and does nothing.`); return; }
  const targets = state.entities.filter(e => (e.kind === 'player' || e.kind === 'ally') && e.alive !== false
    && !(e.kind === 'player' && e.conditions.includes('unconscious'))
    && !(e.kind === 'player' && hasBuff(e, 'invisible')));
  if (!targets.length) { addLog(state, 'mech', `${mon.name} sniffs the air, bewildered — its prey has vanished.`); return; }
  if (!targets.length) return;
  const target = targets.sort((a, b) => manhattan(mon, a) - manhattan(mon, b))[0];
  if (mon.conditions.includes('prone')) mon.conditions = mon.conditions.filter(c => c !== 'prone');
  // bosses are bound to their post: they only engage intruders inside their court
  if (mon.boss && mon.sx !== undefined) {
    const spawn = { x: mon.sx, y: mon.sy };
    const intruderNear = manhattan(spawn, target) <= 7;
    const atEdge = manhattan(spawn, mon) >= 6;
    if (!intruderNear || (atEdge && manhattan(mon, target) > 1)) {
      addLog(state, 'mech', `${mon.name} holds its post, bound to the relic it guards.`);
      return;
    }
  }
  const rangedAtk = (mon.attacks || []).find(a => a.ranged);
  const meleeAtk = (mon.attacks || []).find(a => !a.ranged) || (mon.attacks || [])[0];

  if (manhattan(mon, target) <= 1 && meleeAtk) { monsterAttack(state, mon, target, meleeAtk, events); return; }
  if (rangedAtk && manhattan(mon, target) <= rangedAtk.range / 5 && los(state, mon.x, mon.y, target.x, target.y)) {
    monsterAttack(state, mon, target, rangedAtk, events); return;
  }
  const goals = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dy]) => ({ x: target.x + dx, y: target.y + dy }))
    .filter(t => !isBlocked(state, t.x, t.y) && !entityAt(state, t.x, t.y));
  const path = bfsPath(state, { x: mon.x, y: mon.y }, goals, { self: mon.id });
  if (path) {
    let budget = currentSpeed(state, mon);
    for (const step of path) {
      const cost = stepCost(state, step.x, step.y);
      if (budget < cost) break;
      if (entityAt(state, step.x, step.y)) break;
      maybeOpportunityAttack(state, mon, mon.x, mon.y, step.x, step.y, events);
      if (mon.alive === false || state.mode !== 'combat') return;
      budget -= cost; mon.x = step.x; mon.y = step.y;
      const haz = (state.objects || []).find(o => o.type === 'hazard' && o.x === mon.x && o.y === mon.y);
      if (haz) triggerHazard(state, haz, mon, events);
      const sp = (state.objects || []).find(o => o.type === 'spores' && o.x === mon.x && o.y === mon.y && !o.burst);
      if (sp) triggerSpores(state, sp, events);
      if (!mon.alive) break;
      // leashed bosses never stray more than 6 tiles from their post
      if (mon.boss && mon.sx !== undefined && manhattan(mon, { x: mon.sx, y: mon.sy }) > 6) { mon.x = step.x; mon.y = step.y; break; }
      if (manhattan(mon, target) <= 1) break;
    }
  }
  if (!mon.alive) return;
  if (manhattan(mon, target) <= 1 && meleeAtk) monsterAttack(state, mon, target, meleeAtk, events);
  else if (rangedAtk && manhattan(mon, target) <= rangedAtk.range / 5 && los(state, mon.x, mon.y, target.x, target.y)) {
    monsterAttack(state, mon, target, rangedAtk, events);
  }
}

function processAllyTurn(state, ally, events) {
  if (!ally.alive || state.mode !== 'combat') return;
  const p = playerEntity(state);

  // If ally has healing spells (e.g. Brother Aldous) and player is injured (<= 50% HP), cast Cure Wounds
  if (ally.spells && ally.spells.includes('cure_wounds') && (ally.spellSlots || 0) > 0 && p && p.alive && p.hp <= Math.floor(p.hpMax * 0.5)) {
    if (manhattan(ally, p) <= 4 && los(state, ally.x, ally.y, p.x, p.y)) {
      ally.spellSlots--;
      const healRoll = rollExpr('1d8+3');
      healEntity(state, p, healRoll.total, events, `${ally.name} casts Cure Wounds`);
      return;
    }
  }

  const foes = aliveMonsters(state).filter(m => manhattan(ally, m) <= 25);
  if (!foes.length) return;
  const target = foes.sort((a, b) => manhattan(ally, a) - manhattan(ally, b))[0];
  const rangedAtk = (ally.attacks || []).find(a => a.ranged);
  const meleeAtk = (ally.attacks || []).find(a => !a.ranged) || (ally.attacks || [])[0];
  if (manhattan(ally, target) <= 1) { monsterAttack(state, ally, target, meleeAtk, events); return; }
  if (rangedAtk && manhattan(ally, target) <= rangedAtk.range / 5 && los(state, ally.x, ally.y, target.x, target.y)) {
    monsterAttack(state, ally, target, rangedAtk, events); return;
  }
  const goals = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dy]) => ({ x: target.x + dx, y: target.y + dy }))
    .filter(t => !isBlocked(state, t.x, t.y) && !entityAt(state, t.x, t.y));
  const path = bfsPath(state, { x: ally.x, y: ally.y }, goals, { self: ally.id });
  if (path) {
    let budget = ally.speedFt;
    for (const step of path) {
      const cost = stepCost(state, step.x, step.y);
      if (budget < cost) break;
      if (entityAt(state, step.x, step.y)) break;
      maybeOpportunityAttack(state, ally, ally.x, ally.y, step.x, step.y, events);
      if (ally.alive === false || state.mode !== 'combat') return;
      budget -= cost; ally.x = step.x; ally.y = step.y;
      const haz = (state.objects || []).find(o => o.type === 'hazard' && o.x === ally.x && o.y === ally.y);
      if (haz) triggerHazard(state, haz, ally, events);
      const sp = (state.objects || []).find(o => o.type === 'spores' && o.x === ally.x && o.y === ally.y && !o.burst);
      if (sp) triggerSpores(state, sp, events);
      if (!ally.alive) break;
      if (manhattan(ally, target) <= 1) break;
    }
  }
  if (!ally.alive) return;
  if (manhattan(ally, target) <= 1) monsterAttack(state, ally, target, meleeAtk, events);
}

function checkCombatEnd(state, events) {
  if (state.mode !== 'combat') return false;
  // combat ends when every monster that joined this fight is dead or fled
  const foes = (state.combat.order || [])
    .map(o => state.entities.find(e => e.id === o.id))
    .filter(e => e && e.kind === 'monster' && e.alive && !e.fled);
  const p = playerEntity(state);
  const downed = p && p.conditions.includes('unconscious');
  if (foes.length === 0 || (downed && p.deathSaves && p.deathSaves.stable)) {
    if (!state.stats) state.stats = { dmgDealt: 0, dmgTaken: 0, kills: 0, goldFound: 0, rounds: 0 };
    state.stats.rounds = (state.stats.rounds || 0) + (state.combat.round || 0);
    state.mode = 'explore';
    state.flags.reckless = false;
    if (downed) {
      // stabilized (or the fight simply ended): wake at 1 HP
      p.hp = 1; p.conditions = p.conditions.filter(c => c !== 'unconscious');
      p.deathSaves = { succ: 0, fail: 0, stable: false };
      const wake = { type: 'death_save', narrate: true, text: `${p.name} claws back to consciousness with 1 HP. The crypt grants no mercy twice.` };
      events.push(wake); addLog(state, 'system', wake.text);
    }
    const ev = { type: 'combat_end', narrate: true, text: foes.length === 0 ? 'The last enemy falls. The crypt falls silent again.' : 'The creatures lose interest in your body and prowl back into the dark.' };
    events.push(ev); addLog(state, 'mech', ev.text);
    const visible = computeVision(state); markDiscovered(state, visible);
    checkRoomEntry(state, events);
    return true;
  }
  return false;
}

// ---------------------------------------------------------------- XP / rest ----
// Single source of truth for the level-up affordance: the client renders its badge
// from this, so a badge can never disagree with what /level-up will accept.
function levelUpInfo(char) {
  const currentLevel = (char && char.level) || 1;
  const nextLevel = currentLevel + 1;
  const xpNeeded = XP_THRESHOLDS[nextLevel] || null;
  const currentXp = (char && char.xp) || 0;
  return {
    currentLevel,
    nextLevel,
    currentXp,
    xpNeeded,
    canLevelUp: xpNeeded !== null && currentXp >= xpNeeded
  };
}

function awardXp(state, amount, events) {
  const char = state.character;
  char.xp += amount;
  addLog(state, 'mech', `XP: +${amount} (total ${char.xp}).`);
  for (const [lvl, threshold] of Object.entries(XP_THRESHOLDS)) {
    if (char.level < +lvl && char.xp >= threshold) {
      char.pendingLevelUp = +lvl;
      levelUp(state, +lvl, events);
    }
  }
}

function levelUp(state, newLevel, events) {
  const char = state.character;
  char.level = newLevel;
  const cls = byId(CLASSES, char.className);
  applyClassAndSpecies(char, cls, null, newLevel);
  char.hp = char.hpMax;
  // keep the player entity in step with the raised hit points
  const pe = playerEntity(state);
  if (pe) { pe.hpMax = char.hpMax; pe.hp = char.hpMax; pe.ac = char.acBase; }
  if (cls.spellcasting && cls.spellcasting.type === 'known') {
    const maxSlot = Math.max(0, ...Object.keys(char.slotsMax || {}).map(Number));
    const want = SPELLS.filter(x => x.level >= 1 && x.level <= maxSlot && x.classes.includes(char.className) && !char.spellcasting.spells.includes(x.id));
    want.sort((a, b) => b.level - a.level);
    if (want.length) char.spellcasting.spells.push(want[0].id);
  }
  // Ability Score Improvements at level 4 and 8 (auto-assigned to the class primary)
  char.asiCount = char.asiCount || 0;
  const asiLevels = [4, 8, 12];
  asiLevels.forEach(asiLevel => {
    if (newLevel >= asiLevel && char.asiCount < asiLevels.indexOf(asiLevel) + 1) {
      char.asiCount++;
      const primary = cls.primary || 'str';
      char.abilities[primary] += 2;
      applyClassAndSpecies(char, cls, null, newLevel, true);
      char.hp = char.hpMax;
      const pe2 = playerEntity(state);
      if (pe2) { pe2.hpMax = char.hpMax; pe2.hp = char.hpMax; pe2.ac = char.acBase; }
      const asi = { type: 'asi', narrate: true, text: `Ability Score Improvement: ${primary.toUpperCase()} rises to ${char.abilities[primary]}!` };
      events.push(asi); addLog(state, 'system', asi.text);
    }
  });
  const ev = { type: 'levelup', narrate: true, text: `LEVEL UP! ${char.name} reaches level ${newLevel}! Hit points rise to ${char.hpMax} and new powers awaken.`, data: { level: newLevel } };
  events.push(ev); addLog(state, 'system', ev.text);
  // subclass arrives at level 3
  if (newLevel >= 3 && !char.subclass && cls.subclass) {
    char.subclass = cls.subclass.id;
    if (cls.subclass.hpBonus) {
      char.hpMax += cls.subclass.hpBonus;
      char.hp = char.hpMax;
      if (pe) { pe.hpMax = char.hpMax; pe.hp = char.hpMax; }
    }
    hint(state, 'subclass', 'Bram the Scout', 'Level three awakens your specialty — it is on your sheet now, and it has a button. Use it.', events);
    const sub = { type: 'subclass', narrate: true, text: `${char.name} embraces the ${cls.subclass.name}! ${cls.subclass.desc}`, data: { subclass: cls.subclass.id } };
    events.push(sub); addLog(state, 'system', sub.text);
  }
}

// Temporary (delve-scoped) max-HP adjustments from brews, tokens and curses.
// `delta` is applied to the running total; pass { clear: true } to wipe it (purge token).
function adjustTempHp(state, delta, events, source, opts = {}) {
  const char = state.character;
  const p = playerEntity(state);
  if (!char) return 0;
  const before = char.tempHpMod || 0;
  char.tempHpMod = opts.clear ? 0 : before + delta;
  char.hpMax = Math.max(1, (char.hpMax || 0) + (char.tempHpMod - before));
  char.appliedTempHpMod = char.tempHpMod;
  if (p) {
    p.hpMax = char.hpMax;
    p.hp = Math.min(p.hp, p.hpMax);
  }
  const applied = char.tempHpMod - before;
  if (applied !== 0 && events) {
    addLog(state, 'mech', `${source ? source + ': ' : ''}max HP ${applied > 0 ? '+' : ''}${applied} this delve (${char.hpMax} max).`);
  }
  return char.tempHpMod;
}

// A brew or a curse can rob the hero of a rest. Consumed by the next short rest attempt.
function blockRest(state, count = 1) {
  state.flags = state.flags || {};
  state.flags.restsBlocked = Math.max(0, (state.flags.restsBlocked || 0) + count);
  return state.flags.restsBlocked;
}

function shortRest(state, events) {
  const char = state.character;
  const p = playerEntity(state);
  if (state.mode === 'combat') { events.push({ type: 'error', text: 'You cannot rest while enemies are near!' }); return; }
  if ((state.flags && state.flags.restsBlocked) > 0) {
    blockRest(state, -1);
    const blocked = { type: 'rest_blocked', narrate: true, text: 'You sit down, but your body refuses to settle — the brew still churns in your gut. This rest is lost.' };
    events.push(blocked); addLog(state, 'system', blocked.text);
    return;
  }
  const hdMax = char.level;
  char.hdUsed = char.hdUsed || 0;
  let spent = 0;
  while (p.hp < p.hpMax && (hdMax - char.hdUsed) > 0) {
    const cls = byId(CLASSES, char.className);
    const r = rollExpr('1d' + cls.hitDie);
    const heal = Math.max(1, r.total + mod(char.abilities.con));
    p.hp = Math.min(p.hpMax, p.hp + heal);
    char.hdUsed++; spent++;
    addLog(state, 'mech', `Hit Die spent: ${r.total}+${mod(char.abilities.con)} → ${p.hp}/${p.hpMax} HP.`);
  }
  const cls = byId(CLASSES, char.className);
  (cls.features || []).forEach(f => {
    if (f.uses === '2/short') char.uses[f.id] = 2;
    if (f.uses === '1/short') char.uses[f.id] = 1;
    if (f.uses === 'cha/short') char.uses[f.id] = 2 + mod(char.abilities.cha);
  });
  if (char.breathWeapon) char.uses.breath_weapon = 2;
  if (cls.id === 'monk') char.uses.focus = char.level;
  if (char.feat === 'lucky') char.uses.lucky_reroll = 2;
  if (char.feat === 'musician') char.uses.lucky_reroll = Math.max(char.uses.lucky_reroll || 0, 1);
  if (char.slotsRefresh === 'short') char.slots = { ...char.slotsMax };
  if (cls.id === 'druid' && char.subclass === 'land' && !char.uses.land_recovery_used && (char.slotsMax[1] || 0) > (char.slots[1] || 0)) {
    char.slots[1] = (char.slots[1] || 0) + 1;
    char.uses.land_recovery_used = true;
    addLog(state, 'mech', 'Natural Recovery: one spell slot restored.');
  }
  if (cls.id === 'wizard' && !char.uses.arcane_recovery_used) {
    const back = Math.ceil(char.level / 2);
    char.slots[1] = Math.min((char.slotsMax[1] || 0), (char.slots[1] || 0) + back);
    char.uses.arcane_recovery_used = true;
    addLog(state, 'mech', `Arcane Recovery: ${back} level-1 spell slot(s) restored.`);
  }
  p.tempHp = 0;
  const ev = { type: 'rest', narrate: true, text: `You take a short rest${spent ? `, spending ${spent} Hit Die${spent > 1 ? 's' : ''}` : ' (you were already unhurt)'}. You are at ${p.hp}/${p.hpMax} HP, and your short-rest abilities recover.` };
  events.push(ev); addLog(state, 'system', ev.text);
}

function longRest(state, events) {
  const char = state.character;
  const p = playerEntity(state);
  if (state.mode === 'combat') { events.push({ type: 'error', text: 'You cannot rest while enemies are near!' }); return; }
  const camp = campfireOf(state);
  if (!camp || !(p.x === camp.x && p.y === camp.y)) { events.push({ type: 'error', text: 'You can only take a long rest at your campfire in the Entrance Hall.' }); return; }
  p.hp = p.hpMax; p.tempHp = 0; p.conditions = [];
  char.hdUsed = 0;
  char.slots = { ...char.slotsMax };
  char.uses = {}; char.pools = {};
  const cls = byId(CLASSES, char.className);
  applyClassAndSpecies(char, cls, null, char.level, true); // re-init uses/pools without rolling new HP
  char.freeSpellUses = 0;
  char.uses.arcane_recovery_used = false;
  char.uses.land_recovery_used = false;
  state.flags.dropUsed = false;
  state.flags.savage_used = false;
  state.flags.reckless = false;
  state.flags.restsBlocked = 0;   // a night at camp settles any brew in your gut
  state.entities.forEach(e => { e.buffs = []; });
  state.flags.altarBlessed = false;
  removeBuff(p, 'altar_blessed');
  const ev = { type: 'rest', narrate: true, text: `You sleep by the campfire in watches. Dawn light finally bleeds through the crypt door — fully restored (${p.hpMax} HP), spells and abilities replenished.` };
  events.push(ev); addLog(state, 'system', ev.text);
}

// ---------------------------------------------------------------- checks & interaction ----
function skillCheck(state, skill, dc) {
  const char = state.character;
  const p = playerEntity(state);
  let bonus = 0, bonusTxt = '';
  const guidance = getBuff(p, 'guidance');
  if (guidance) { bonus += die(4); bonusTxt += ' +1d4 guidance'; removeBuff(p, 'guidance'); }
  const insp = getBuff(p, 'inspiration');
  if (insp) { bonus += die(insp.dice || 6); bonusTxt += ` +1d${insp.dice || 6} inspiration`; removeBuff(p, 'inspiration'); }
  let roll = d20({ adv: skill === 'stealth' && char.subclass === 'thief', reroll1: char.rerollNat1 });
  let total = roll.natural + skillMod(char, skill) + bonus;
  if (char.subclass === 'thief' && char.className === 'rogue' && char.level >= 11 && char.skills.includes(skill) && total < 10 + skillMod(char, skill) + bonus) { total = 10 + skillMod(char, skill) + bonus; }
  let rerolled = false;
  if (total < dc && (char.uses.lucky_reroll || 0) > 0) {
    char.uses.lucky_reroll--;
    roll = d20({ reroll1: char.rerollNat1 });
    total = roll.natural + skillMod(char, skill) + bonus;
    rerolled = true;
  }
  return {
    success: total >= dc, total, natural: roll.natural,
    detail: `d20 ${roll.natural}+${skillMod(char, skill)}${bonusTxt} = ${total} vs DC ${dc}${rerolled ? ' (Heroic reroll)' : ''}`
  };
}

function lootChest(state, chest, events) {
  if (chest.looted) { events.push({ type: 'info', text: 'The chest is already empty.' }); return; }
  if (chest.locked && !chest.unlocked) {
    events.push({ type: 'info', text: `${chest.name} is locked shut. Pick the lock with thieves' tools or force it open.` });
    return;
  }
  chest.looted = true;
  const char = state.character;
  const goldRoll = typeof chest.loot.gold === 'string' ? rollExpr(chest.loot.gold).total : (chest.loot.gold || 0);
  char.gold += goldRoll;
  if (!state.stats) state.stats = { dmgDealt: 0, dmgTaken: 0, kills: 0, goldFound: 0, rounds: 0 };
  state.stats.goldFound += goldRoll;
  const parts = [];
  for (let i = 0; i < (chest.loot.potions || 0); i++) addItemToInventory(char, 'potion_healing');
  (chest.loot.items || []).forEach(it => {
    if (it.chance !== undefined && Math.random() >= it.chance) return;
    addItemToInventory(char, it.id, it.qty || 1); parts.push(itemName(it.id));
  });
  applyPickupEffects(state, chest.loot.items || [], events);
  checkQuest(state, 'recover', chest.id, events);
  if (chest.loot.gold >= 20) hint(state, 'shop', 'Bram the Scout', 'Coin is no good to a corpse. Marla topside and Perra down in the vault both trade — potions, kits, even silver blades.', events);
  const ev = {
    type: 'loot', narrate: true,
    text: `${p_name(state)} pries open the ${chest.name}: ${goldRoll} gold pieces` +
      `${chest.loot.potions ? `, ${chest.loot.potions} Potion${chest.loot.potions > 1 ? 's' : ''} of Healing` : ''}` +
      `${parts.length ? ` — and ${parts.join(', ')}!` : '!'}` +
      `${parts.length ? ' A treasure of real power.' : ''}`
  };
  events.push(ev); addLog(state, 'mech', ev.text);
}

// Roll a slain monster's loot table: gold dice + chance-based items + guaranteed rarity drops for Elites & Bosses
function rollLoot(state, mon, events) {
  const def = content.getMonster(mon.monsterId);
  const char = state.character;
  const parts = [];
  let g = 0;
  if (def && def.loot && def.loot.gold) {
    g = rollExpr(def.loot.gold).total;
  }
  // Elite bonus gold: 15-30 gp
  if (mon.isElite) g += die(16) + 14;
  // Boss bonus gold: 50-100 gp
  if (mon.boss) g += die(51) + 49;
  if (g > 0) {
    char.gold += g;
    if (!state.stats) state.stats = { dmgDealt: 0, dmgTaken: 0, kills: 0, goldFound: 0, rounds: 0 };
    state.stats.goldFound += g;
    parts.push(`${g} gp`);
  }

  const gained = [];
  if (def && def.loot && def.loot.items) {
    def.loot.items.forEach(it => {
      if (Math.random() < (it.chance === undefined ? 1 : it.chance)) {
        const qty = it.qty || 1;
        addItemToInventory(char, it.id, qty);
        parts.push(itemName(it.id));
        gained.push(it);
      }
    });
  }

  // Rarity & Affix loot rolls:
  if (mon.isElite) {
    // Elite Champion: 100% guaranteed Magic (75%) or Rare (25%) item drop!
    const rarity = Math.random() < 0.25 ? 'rare' : 'magic';
    const magicItem = affixes.rollMagicItem(rarity);
    addItemToInventory(char, magicItem);
    parts.push(`[${rarity === 'rare' ? '稀有 🟣' : '魔法 🔵'}] ${magicItem.name}`);
    gained.push(magicItem);
    char.essence = (char.essence || 0) + forgeMod.KILL_ESSENCE.elite;
    parts.push(`${forgeMod.KILL_ESSENCE.elite} 余烬精华`);
    events.push({
      type: 'elite_loot',
      narrate: true,
      text: `🏆 ELITE SLAIN: ${mon.name} falls! Discovered ${magicItem.name} (${magicItem.desc})!`
    });
  } else if (mon.boss) {
    // Boss Monster: 100% guaranteed Rare (75%) or Legendary (25%) item drop!
    const rarity = Math.random() < 0.25 ? 'legendary' : 'rare';
    const magicItem = affixes.rollMagicItem(rarity);
    addItemToInventory(char, magicItem);
    parts.push(`[${rarity === 'legendary' ? '传奇 🟠' : '稀有 🟣'}] ${magicItem.name}`);
    gained.push(magicItem);
    char.essence = (char.essence || 0) + forgeMod.KILL_ESSENCE.boss;
    parts.push(`${forgeMod.KILL_ESSENCE.boss} 余烬精华`);
    events.push({
      type: 'boss_loot',
      narrate: true,
      text: `👑 BOSS VANQUISHED: ${mon.name} slain! Bestowed ${magicItem.name} (${magicItem.desc})!`
    });
  } else if (Math.random() < 0.05) {
    // Normal monster: 5% chance of rolling a Magic item
    const magicItem = affixes.rollMagicItem('magic');
    addItemToInventory(char, magicItem);
    parts.push(`[魔法 🔵] ${magicItem.name}`);
    gained.push(magicItem);
  }

  applyPickupEffects(state, gained, events);
  if (parts.length) {
    const ev = { type: 'loot', narrate: true, text: `${mon.name} drops ${parts.join(', ')}!` };
    events.push(ev); addLog(state, 'mech', ev.text);
  }
}

// One-time effects when magic trinkets enter the pack (e.g. Amulet of Vigor: +5 max HP)
function applyPickupEffects(state, items, events) {
  if (!items || !items.length) return;
  const char = state.character;
  const pe = playerEntity(state);
  items.forEach(it => {
    const def = content.getGear(it.id);
    if (def && def.hpBonus) {
      char.hpMax += def.hpBonus * (it.qty || 1);
      if (pe) { pe.hpMax = char.hpMax; pe.hp = Math.min(pe.hpMax, pe.hp + def.hpBonus * (it.qty || 1)); }
      const ev = { type: 'magic_item', narrate: true, text: `The ${def.name} settles against your chest and thrums — you feel hardier! (+${def.hpBonus * (it.qty || 1)} max HP)` };
      events.push(ev); addLog(state, 'mech', ev.text);
    }
  });
}

function alertForcedNoise(state, events) {
  const p = playerEntity(state);
  let woke = 0;
  aliveMonsters(state).forEach(m => { if (manhattan(m, p) <= 10) { m.aware = true; woke++; } });
  if (woke) addLog(state, 'mech', 'Something stirs in the dark...');
}

function interactDoor(state, door, events) {
  const p = playerEntity(state);
  if (manhattan(p, door) > 1) { events.push({ type: 'error', text: 'You are not close enough to the door.' }); return; }
  if (door.open) { events.push({ type: 'info', text: 'The door is already open.' }); return; }
  if (door.locked && !door.unlocked) {
    const char = state.character;
    const hasTools = char.inventory.some(i => i.itemId === 'thieves_tools');
    let check = skillCheck(state, 'sleight_of_hand', door.lockDc || 13);
    if (char.className === 'rogue' && hasTools && !check.success) check = skillCheck(state, 'sleight_of_hand', door.lockDc || 13);
    if (check.success && hasTools) {
      door.unlocked = true; door.open = true;
      const ev = { type: 'door', narrate: true, text: `${p.name} works the lock with thieves' tools (${check.detail}) — the ${door.name} swings open.` };
      events.push(ev); addLog(state, 'mech', ev.text);
    } else {
      const force = skillCheck(state, 'athletics', door.forceDc || 15);
      if (force.success) {
        door.unlocked = true; door.open = true; door.forced = true;
        const ev = { type: 'door', narrate: true, text: `The lock defeats your picks, so ${p.name} slams into the ${door.name} until it bursts open! (Athletics ${force.detail}) The crash echoes down the corridors...` };
        events.push(ev); addLog(state, 'mech', ev.text);
        alertForcedNoise(state, events);
      } else {
        const ev = { type: 'door_fail', narrate: true, text: `The ${door.name} holds fast — picks slip (SoH ${check.detail}), shoulders ache (Ath ${force.detail}). You can try again.` };
        events.push(ev); addLog(state, 'mech', ev.text);
      }
    }
    return;
  }
  door.open = true;
  const ev = { type: 'door', narrate: true, text: `${p_name(state)} pushes the ${door.name} open. It groans on rusted hinges.` };
  events.push(ev); addLog(state, 'mech', ev.text);
}

function interactObject(state, objId, events) {
  const obj = state.objects.find(o => o.id === objId);
  if (!obj) { events.push({ type: 'error', text: 'Nothing there.' }); return; }
  const p = playerEntity(state);
  if (manhattan(p, obj) > 1) { events.push({ type: 'error', text: 'Move closer first.' }); return; }
  if (obj.type === 'door') return interactDoor(state, obj, events);
  if (obj.type === 'stairs') {
    const to = obj.to || {};
    travelTo(state, to.mapId, to.x, to.y, events);
    return;
  }
  if (obj.type === 'chest') return lootChest(state, obj, events);
  if (obj.type === 'font') return useFont(state, obj, events);
  if (obj.type === 'lever') return pullLever(state, obj, events);
  if (obj.type === 'barrel') {
    if (obj.exploded) { events.push({ type: 'info', text: 'Nothing remains of the barrel but charred wood and soot.' }); return; }
    addLog(state, 'mech', `${p.name} strikes the explosive oil barrel at point-blank range!`);
    detonateBarrel(state, obj, events, `${p.name}'s strike`);
    return;
  }
  if (obj.type === 'spores') {
    if (obj.burst) { events.push({ type: 'info', text: 'The spore pods have withered into lifeless fungal husks.' }); return; }
    addLog(state, 'mech', `${p.name} disturbs the toxic spore pods!`);
    triggerSpores(state, obj, events);
    return;
  }
  if (obj.type === 'hazard') {
    events.push({ type: 'info', text: `${obj.name}: ${obj.desc || 'A caustic hazard that burns anything stepping into it.'}` });
    return;
  }
  if (obj.type === 'npcMarker') {
    const ev = { type: 'chat_open', narrate: false, text: `${obj.name}: "${(state.map.npcs[obj.npcId].canned || ['...'])[0]}"`, data: { npcId: obj.npcId, name: obj.name } };
    events.push(ev);
    return;
  }
  if (obj.id === 'campfire') {
    const ev = { type: 'info', narrate: true, text: 'The campfire crackles warmly. Take a Long Rest here to recover fully.' };
    events.push(ev); return;
  }
  if (obj.id === 'altar') {
    const char = state.character;
    const skill = char.skills.includes('religion') ? 'religion' : (char.skills.includes('arcana') ? 'arcana' : (mod(char.abilities.wis) >= mod(char.abilities.int) ? 'religion' : 'arcana'));
    const check = skillCheck(state, skill, 13);
    if (state.flags.altarBlessed) { events.push({ type: 'info', text: 'The blessing already rests upon you.' }); return; }
    if (check.success) {
      state.flags.altarBlessed = true;
      addBuff(p, { id: 'altar_blessed', rounds: 9999 });
      const ev = { type: 'blessing', narrate: true, text: `${p.name} offers the old god a proper prayer (${cap(skill)} ${check.detail}). The altar's cold flame warms — a blessing settles on you: +1 to attack rolls and saves until your next Long Rest.` };
      events.push(ev); addLog(state, 'mech', ev.text);
    } else {
      const dmg = rollExpr('1d6').total;
      const ev = { type: 'altar_fail', narrate: true, text: `${p.name} fumbles the rite (${cap(skill)} ${check.detail}) — the altar's cold flame bites for ${dmg} necrotic damage!` };
      events.push(ev); addLog(state, 'mech', ev.text);
      applyDamage(state, p, dmg, 'necrotic', events);
      checkPlayerDeath(state, events);
    }
    return;
  }
  if (obj.id === 'relic') {
    if (state.flags.hasRelic) { events.push({ type: 'info', text: 'You already carry the Relic.' }); return; }
    const ogre = state.entities.find(e => e.monsterId === 'ogre' && e.alive);
    if (ogre && state.mode !== 'combat') {
      const check = skillCheck(state, 'sleight_of_hand', 15);
      if (check.success) {
        state.flags.hasRelic = true; obj.taken = true;
        const ev = { type: 'relic', narrate: true, text: `As the ogre snores, ${p.name} lifts the Relic of the Sunless Crypt with a thief's grace (SoH ${check.detail}). Now — run!` };
        events.push(ev); addLog(state, 'mech', ev.text);
      } else {
        const ev = { type: 'relic_fail', narrate: true, text: `${p.name} grabs for the Relic — and fumbles (SoH ${check.detail})! Grubnik's eyes snap open with a roar!` };
        events.push(ev); addLog(state, 'mech', ev.text);
        ogre.aware = true;
        const nearby = aliveMonsters(state).filter(m => manhattan(m, p) <= 6).map(m => m.id);
        startCombat(state, [ogre.id, ...nearby], events);
      }
      return;
    }
    state.flags.hasRelic = true; obj.taken = true;
    const ev = { type: 'relic', narrate: true, text: `${p_name(state)} seizes the Relic of the Sunless Crypt! Its cold light pulses like a heartbeat. Return to the campfire to escape with your prize!` };
    events.push(ev); addLog(state, 'mech', ev.text);
    return;
  }
  events.push({ type: 'info', text: `${obj.name}: ${obj.desc || 'Nothing unusual.'}` });
}

module.exports = {
  SPECIES, CLASSES, BACKGROUNDS, FEATS, WEAPONS, ARMORS, GEAR, SPELLS, MONSTERS, ALLY_DEF, ALLIES, MAPS,
  ABILITIES, SKILL_ABILITY, ALL_SKILLS, XP_THRESHOLDS, SLOTS, DIFFICULTY, SHOP_ITEMS,
  die, rollExpr, d20, mod, cap, byId, invEntry, equippedBonus,
  buildCharacter, applyClassAndSpecies, skillMod, passivePerception, levelUpInfo,
  getMap, tileChar, isWall, isBlocked, isDifficult, entityAt, roomAt, los, manhattan, bfsPath, computeVision, markDiscovered,
  startGame, addLog, playerEntity, currentActor, endTurn, beginPlayerTurn, currentSpeed,
  hasBuff, getBuff, addBuff, removeBuff, currentAc, charHasArmor, applyCondition,
  alertCheck, startCombat, checkCombatEnd, processUntilPlayer,
  movePlayer, playerAttack, castSpell, findSpell, interactObject, interactDoor,
  shortRest, longRest, skillCheck, damageRoll, applyDamage, healEntity, awardXp, checkPlayerDeath,
  adjustTempHp, blockRest,
  triggerTrap, noticeTrapsNearby, alertForcedNoise, attackMods, monsterAttack, processMonsterTurn, processAllyTurn,
  detonateBarrel, triggerSpores, useFont, pullLever, triggerHazard,
  rollLoot, lootChest, applyPickupEffects, itemName, addItemToInventory, resolveWeapon,
  rollSideQuest, checkQuest, campfireOf, loadWorldMap, shoveTarget, maybeOpportunityAttack, hasFlank,
  disarmTrap, unlockChest, travelTo, affixes
};
