// AI D&D — game engine: dice, character building, movement, fog of war, combat, XP, rests.
// The engine is deterministic: the LLM (if any) only narrates what the engine resolves.
const path = require('path');
const fs = require('fs');
const content = require('./content');
const contentContext = require('./content-context');
const affixes = require('./affixes');
const companions = require('./companions');
const forgeMod = require('./forge');
const presentation = require('./presentation');

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
  easy: { label: 'Easy', hpMult: 0.75, dmgMult: 0.75, bonusPotions: 2, blurb: 'Monsters are frail (−25% HP and damage) and you carry 4 potions.' , localized:{"en":{"blurb":"Monsters are frail (−25% HP and damage) and you carry 4 potions."},"zh-CN":{"blurb":"怪物更脆弱（HP 和伤害 −25%），你携带 4 瓶药水。"}}},
  normal: { label: 'Normal', hpMult: 1, dmgMult: 1, bonusPotions: 0, blurb: 'The crypt as intended. You carry 2 potions.' , localized:{"en":{"blurb":"The crypt as intended. You carry 2 potions."},"zh-CN":{"blurb":"标准地牢，你携带 2 瓶药水。"}}},
  hard: { label: 'Hard', hpMult: 1.25, dmgMult: 1.25, bonusPotions: -1, blurb: 'Monsters are mighty (+25% HP and damage). You carry 1 potion.' , localized:{"en":{"blurb":"Monsters are mighty (+25% HP and damage). You carry 1 potion."},"zh-CN":{"blurb":"怪物更强大（HP 和伤害 +25%），你携带 1 瓶药水。"}}}
};

// Marla's stock — validated server-side, rendered client-side from /api/rules
const SHOP_ITEMS = [
  { id: 'potion_healing', name: 'Potion of Healing', price: 25, desc: 'Bonus action: regain 2d4+2 HP.' , localized:{"en":{"name":"Potion of Healing","desc":"Bonus action: regain 2d4+2 HP."},"zh-CN":{"name":"治疗药水","desc":"附赠动作：恢复 2d4+2 HP。"}}},
  { id: 'potion_greater', name: 'Greater Healing Potion', price: 50, desc: 'Bonus action: regain 4d4+4 HP.' , localized:{"en":{"name":"Greater Healing Potion","desc":"Bonus action: regain 4d4+4 HP."},"zh-CN":{"name":"强效治疗药水","desc":"附赠动作：恢复 4d4+4 HP。"}}},
  { id: 'healers_kit', name: "Healer's Kit", price: 15, desc: 'Needed for the Healer feat; patches wounds.' , localized:{"en":{"name":"Healer's Kit","desc":"Needed for the Healer feat; patches wounds."},"zh-CN":{"name":"医药包","desc":"治疗者专长所需，用于包扎伤口。"}}},
  { id: 'thieves_tools', name: "Thieves' Tools", price: 25, desc: 'Pick locks and disarm traps.' , localized:{"en":{"name":"Thieves' Tools","desc":"Pick locks and disarm traps."},"zh-CN":{"name":"盗贼工具","desc":"撬锁与拆除陷阱。"}}},
  { id: 'silver_sword', name: 'Silver Shortsword', price: 200, desc: 'Magic shortsword: +1 to attack and damage.' , localized:{"en":{"name":"Silver Shortsword","desc":"Magic shortsword: +1 to attack and damage."},"zh-CN":{"name":"银制短剑","desc":"魔法短剑：攻击与伤害 +1。"}}},
  { id: 'scroll_magic_missile', name: 'Scroll of Magic Missile', price: 75, desc: 'One-shot: 3d4+3 force damage.' , localized:{"en":{"name":"Scroll of Magic Missile","desc":"One-shot: 3d4+3 force damage."},"zh-CN":{"name":"魔法飞弹卷轴","desc":"一次性：3d4+3 力场伤害。"}}},
  { id: 'scroll_shield', name: 'Scroll of Shield', price: 75, desc: 'One-shot: +5 AC until your next turn.' , localized:{"en":{"name":"Scroll of Shield","desc":"One-shot: +5 AC until your next turn."},"zh-CN":{"name":"护盾术卷轴","desc":"一次性：下回合前 AC +5。"}}},
  { id: 'scroll_cure', name: 'Scroll of Cure Wounds', price: 60, desc: 'One-shot: heal 1d8+3 HP.' , localized:{"en":{"name":"Scroll of Cure Wounds","desc":"One-shot: heal 1d8+3 HP."},"zh-CN":{"name":"疗伤术卷轴","desc":"一次性：恢复 1d8+3 HP。"}}},
  { id: 'scroll_sleep', name: 'Scroll of Sleep', price: 80, desc: 'One-shot: put a creature to sleep.' , localized:{"en":{"name":"Scroll of Sleep","desc":"One-shot: put a creature to sleep."},"zh-CN":{"name":"睡眠术卷轴","desc":"一次性：使一个生物沉睡。"}}}
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

// ---- item sets (affixes.ARMOR_SETS): tiered bonuses counted across equipped slots ----
function equippedSets(char) {
  const counts = {};
  if (!char || !char.equipped || !char.inventory) return counts;
  Object.keys(char.equipped).forEach(slot => {
    const it = invEntry(char, char.equipped[slot]);
    if (it && it.set) counts[it.set] = (counts[it.set] || 0) + 1;
  });
  return counts;
}
function setAcBonus(char) {
  const counts = equippedSets(char);
  let bonus = 0;
  affixes.ARMOR_SETS.forEach(s => {
    const n = counts[s.id] || 0;
    if (n >= 3) bonus += s.set3.acBonus;
    else if (n >= 2) bonus += s.set2.acBonus;
  });
  return bonus;
}
function setInitBonus(char) {
  const counts = equippedSets(char);
  let bonus = 0;
  affixes.ARMOR_SETS.forEach(s => {
    if ((counts[s.id] || 0) >= 3) bonus += (s.set3.initBonus || 0);
  });
  return bonus;
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
function die(n) { return 1 + Math.floor(rand() * n); }

// --- delve RNG stream --------------------------------------------------------
// A delve can carry a deterministic RNG stream (state.seed + state.rngState —
// the weekly challenge uses this): the stream is restored at the start of every
// action dispatch (beginRng) and persisted back onto the save (persistRng), so
// identical seeds play identically and interleaved delves keep independent
// streams. Unseeded delves fall through to Math.random exactly as before.
let rngState = null;
function rand() {
  if (rngState == null) return Math.random();
  rngState = (rngState + 0x6D2B79F5) | 0;
  let t = rngState;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
function beginSeed(seed) { rngState = (seed != null) ? (seed >>> 0) : null; }
function beginRng(state) {
  rngState = (state && state.seed != null) ? (state.rngState != null ? state.rngState : state.seed) : null;
}
function persistRng(state) {
  if (state && state.seed != null) state.rngState = rngState;
  rngState = null;
}

// The weekly challenge: one seed per ISO week, shared by every hero on this
// install. Boss floors only (depth 5 / 10 alternating) so a win is always possible.
function weeklyInfo(date = new Date()) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((+d - +yearStart) / 86400000) + 1) / 7);
  const label = `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
  let seed = 2166136261;
  for (const ch of label) { seed ^= ch.charCodeAt(0); seed = Math.imul(seed, 16777619); }
  seed = seed >>> 0;
  return { label, seed, depth: 5 + 5 * (week % 2) };
}
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
  if (opts.piercer) { // Piercer: reroll the lowest die once, keep the higher
    let minIdx = 0;
    rolls.forEach((r, i) => { if (r < rolls[minIdx]) minIdx = i; });
    rolls[minIdx] = Math.max(rolls[minIdx], die(sides));
    total = rolls.reduce((a, b) => a + b, 0);
  }
  if (opts.crit) total += rollSet().reduce((a, b) => a + b, 0);
  return { total: total + flat, dice: total, piercerRerolled: !!opts.piercer };
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
  // the origin feat comes from the background, never from the draft (no creator path sets
  // draft.feat) — without this the three magic-initiate feats silently lost their bonus
  // cantrips and free spell at build time (found by the T5 preset checks)
  const sc = cls.spellcasting ? finalizeSpells(cls, cls.spellcasting, { ...draft, feat: bg.feat }, abilities, profBonus, 1) : null;

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

// The origin and unlocked Tough feat represent the same bonus, never two copies.
function hpPerLevelBonus(char, spArg) {
  const sp = spArg || byId(SPECIES, char.species);
  const featIds = new Set([char.feat, ...(char.unlockedFeats || [])]);
  return (((sp && sp.effect) || {}).hpPerLevel || 0)
    + [...featIds].reduce((sum, id) => sum + ((FEATS[id] || {}).hpPerLevel || 0), 0);
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

  const hpPerLevelExtra = hpPerLevelBonus(char, sp);
  let gained;
  if (char.hpMax === 0) gained = cls.hitDie + conM + hpPerLevelExtra;
  else gained = recomputeOnly ? 0 : Math.max(1, die(cls.hitDie) + conM) + hpPerLevelExtra;
  // Vigor-style affix gear adds max HP only while equipped — swap out the previous value before re-adding.
  // char.tempHpMod is the delve-scoped counterpart (brews and curses); it lives on the delve
  // snapshot, so it never leaks back into the roster character.
  const itemHpBonus = equippedBonus(char, 'hpBonus');
  const prevItemHp = char.itemHpBonus || 0;
  const tempHpMod = char.tempHpMod || 0;
  const prevTempMod = char.appliedTempHpMod || 0;
  char.hpMax = Math.max(1, (char.hpMax || 0) - prevItemHp - prevTempMod + itemHpBonus + tempHpMod + gained);
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

  char.speedFt = (eff.speed || sp.speed || 30) + (((char.unlockedFeats || []).includes('speedy')) ? 10 : 0);
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
    + (cls.id === 'barbarian' && level >= 7 ? 2 : 0) // Feral Instinct
    + setInitBonus(char); // item sets (3-piece tiers)

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
      weaponId: w.id, name: w.name, bonus, dmgDice: w.damage, dmgMod, damageType: w.damageType,
      ranged, range: w.range || 5, props: w.props,
      heavy: w.props.includes('heavy'), light: w.props.includes('light'),
      twoHanded: w.props.includes('two_handed'), finesse, versatile: w.versatile || null,
      magic: w.magic || 0, bonusDamage: w.bonusDamage || null, vampiricHeal: w.vampiricHeal || null
    };
  }).filter(Boolean);
  const unarmedAb = abilities.str >= abilities.dex ? abilities.str : abilities.dex;
  char.attacks.push({
    weaponId: 'unarmed', name: 'Unarmed Strike', bonus: char.profBonus + mod(unarmedAb),
    dmgDice: cls.id === 'monk' ? (level >= 10 ? '1d10' : level >= 5 ? '1d8' : '1d6') : '1', dmgMod: mod(unarmedAb), damageType: 'bludgeoning',
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

// T7a: deterministic, read-only preview for the client's check modal. Mirrors the exact
// modifier math unlockChest/disarmTrap will roll with (skillMod incl. expertise, plus the
// tools proficiency when the skill itself isn't proficient) and reports state-dependent
// extras as NOTES, never as fake constants. No RNG, no buff consumption, no mutation —
// the actual natural/modifier/total/dc/outcome still come from the resolve event.
function previewSkillCheckObject(state, obj) {
  const char = state.character;
  const p = playerEntity(state);
  const hasTools = (char.inventory || []).some(i => i.itemId === 'thieves_tools' || i.itemId === 'tool_thieves');
  const toolsMod = (skill) => (hasTools && !char.skills.includes(skill) ? (char.profBonus || 2) : 0);
  const notes = [], notesDisplay = [];
  if (getBuff(p, 'guidance')) { notes.push('指引 +1d4（掷骰时消耗）'); notesDisplay.push({ key: "check.note.guidance" }); }
  const insp = getBuff(p, 'inspiration');
  if (insp) { notes.push(`灵感 +1d${insp.dice || 6}（掷骰时消耗）`); notesDisplay.push({ key: 'check.note.inspiration', params: { dice: insp.dice || 6 } }); }
  if ((char.uses && char.uses.lucky_reroll || 0) > 0) { notes.push('幸运重掷可用（仅失败时自动触发）'); notesDisplay.push({ key: 'check.note.lucky' }); }
  if (char.className === 'rogue') { notes.push('盗贼：失败后可再试一次（预览为基础加值）'); notesDisplay.push({ key: 'check.note.rogue' }); }
  const method = (id, label, skill, dc, toolProf, requiresTools) => ({
    id, label, skill, dc, labelDisplay: { key: "check.method." + id },
    modifier: skillMod(char, skill) + (toolProf ? toolsMod(skill) : 0),
    requiresTools: !!requiresTools,
    hasTools,
    rogueRetry: char.className === 'rogue'
  });

  if (obj.type === 'trap') {
    return {
      kind: 'trap', objectId: obj.id,
      methods: [method('disarm', 'Disarm Mechanism', 'sleight_of_hand', obj.dc || 12, true, true)],
      notes, notesDisplay
    };
  }
  return {
    kind: 'chest', objectId: obj.id,
    methods: [
      method('pick', 'Pick Tumbler Lock', 'sleight_of_hand', obj.pickDc || 12, true, true),
      method('force', 'Pry / Shatter Lock', 'athletics', obj.forceDc || 14, false, false)
    ],
    notes, notesDisplay
  };
}

function passivePerception(char) {
  const observant = ((char.unlockedFeats || []).includes('observant') || char.feat === 'observant') ? 5 : 0;
  return 10 + skillMod(char, 'perception') + observant;
}

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
  return state.entities.find(e => e.x === x && e.y === y && (includeDead || (e.alive !== false && !e.fled)));
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

// One player-visibility rule, used by the board payload and by every model candidate list:
// an unspotted trap is unknown, and "this tile was explored" is not "this object was found".
function isTrapHidden(object) { return !!object && object.type === 'trap' && !object.revealed && !object.triggered; }
function isTileDiscovered(state, x, y) { return (state.discovered || []).includes(x + ',' + y); }
function isObjectVisibleToPlayer(state, object) {
  return !!object && !isTrapHidden(object) && isTileDiscovered(state, object.x, object.y);
}

// ------------------------------------------------------------- game setup ----
// Generate the per-map part of a world: monsters, NPCs and objects (no hero).
function generateMapState(mapDef, difficulty, state = null) {
  const ents = [], objects = [], discovered = [];
  mapDef.entities.forEach(e => {
    if (e.type === 'monster') {
      const def = contentContext.monster(state, e.kind);
      if (!def) return; // unknown kinds are warned about at startGame
      const hp = Math.max(1, Math.round(rollExpr(def.hp).total * DIFFICULTY[difficulty].hpMult));
      const mon = {
        id: e.id, kind: 'monster', monsterId: e.kind, name: e.name || def.name,
        x: e.x, y: e.y, hp, hpMax: hp, ac: def.ac, speedFt: def.speed, abilities: def.abilities,
        attacks: def.attacks, darkvision: def.darkvision || 0, xp: def.xp, boss: !!def.boss,
        vulnerabilities: def.vulnerabilities || [], traits: def.traits || [],
        gimmick: def.gimmick || null,
        chief: !!e.chief, conditions: [], buffs: [], alive: true, aware: false, fled: false,
        sx: e.x, sy: e.y
      };
      mon.boss = e.boss === undefined ? !!def.boss : e.boss;
      if (!mon.boss && (e.isElite || rand() < (mapDef.eliteChance || 0.18))) {
        affixes.applyMonsterAffix(mon);
      }
      ents.push(mon);
    } else if (e.type === 'npc') {
      ents.push({ id: 'npc_' + e.id, kind: 'npc', npcId: e.id, name: e.name, x: e.x, y: e.y, icon: e.icon || '🗣️', alive: true });
      objects.push({ ...e, type: 'npcMarker', npcId: e.id });
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
  const mapDef = contentContext.map(state, mapId);
  const saved = state.world[mapId];
  const gen = saved || generateMapState(mapDef, state.difficulty, state);
  state.world[mapId] = saved || gen;
  // state.map is this run's own copy: the registry definition (and any other save sharing
  // it) must never change because this delve flipped a door or retargeted a stair.
  state.mapId = mapDef.id; state.mapName = mapDef.name; state.map = structuredClone(mapDef);
  // swap the cast: hero (+ally) travels, everything else belongs to the map
  const travelers = state.entities.filter(e => e.kind === 'player' || e.kind === 'ally');
  state.entities = [...travelers, ...gen.ents];
  state.objects = gen.objects;
  restoreScenePassages(state);
  state.discovered = gen.discovered || [];
  mapFlagKeys(state.flags).forEach(k => delete state.flags[k]);
  Object.entries(gen.flags || {}).forEach(([k, v]) => { state.flags[k] = v; });
  const visible = computeVision(state);
  markDiscovered(state, visible);
  state.world[mapId] = snapshotWorldMap(state);
}

function startGame(character, options = {}) {
  const mapDef = contentContext.mapFor(options.content, options.mapId);
  if (!mapDef) throw new Error('Unknown or invalid map: ' + (options.mapId ?? '(default)'));
  beginSeed(options.seed != null ? (options.seed >>> 0) : null); // weekly challenge: deterministic stream
  // T12a: a companion story is gated on the real ally — never auto-recruited, never
  // loyalty-gated; a mismatched party fails loudly instead of entering the hollow.
  const needCompanion = mapDef.story?.companion;
  if (needCompanion) {
    let wantAlly = typeof options.bringAlly === 'string' ? options.bringAlly : (options.bringAlly ? 'bram' : null);
    if (wantAlly === 'true') wantAlly = 'bram';
    if (wantAlly !== needCompanion) throw new Error('This story requires the companion "' + needCompanion + '" in the party.');
  }
  const difficulty = DIFFICULTY[options.difficulty] ? options.difficulty : 'normal';
  const state = {
    id: 'save_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
    characterId: character.id, character: JSON.parse(JSON.stringify(character)),
    mapId: mapDef.id, mapName: mapDef.name, map: structuredClone(mapDef), mode: 'explore', difficulty,
    // Playtest runs resolve their own draft content from this snapshot; ordinary saves have null.
    contentSnapshot: options.content || null,
    world: {},
    quests: { active: null, completed: [] },
    seed: options.seed != null ? (options.seed >>> 0) : undefined,
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
      darkvision: a.darkvision, conditions: [], buffs: [], alive: true,
      loyalty: (p.companionLoyalty && p.companionLoyalty[a.id] != null) ? p.companionLoyalty[a.id] : 50
    });
    state.flags.ally = true;
    state.flags.allyId = a.id;
  }

  // T12a: re-entering a companion story with the same companion opens on the real
  // past ending — the confirmed reaction text is the greeting. Memory never unlocks
  // scenes; it only colors the reunion.
  if (state.flags.allyId && mapDef.story?.id && state.flags.allyId === mapDef.story.companion) {
    const past = (p.encounterFacts || []).filter(f => f.storyId === mapDef.story.id && f.ending && f.reactions?.[state.flags.allyId]).sort((a, b) => b.ts - a.ts)[0];
    if (past) {
      const reaction = past.reactions[state.flags.allyId];
      const allyDef = ALLIES.find(x => x.id === state.flags.allyId);
      const whoLoc = loc => presentation.textFor(allyDef, 'name', loc) || (allyDef?.name || state.flags.allyId);
      const zhLine = reaction.localized?.['zh-CN']?.text || reaction.text;
      const enLine = reaction.localized?.en?.text || reaction.text;
      const ev = {
        type: 'companion', narrate: true,
        text: whoLoc('zh-CN') + '重提这段往事："' + zhLine + '"',
        textDisplay: { localized: {
          en: whoLoc('en') + ' picks up the old thread of this story: "' + enLine + '"',
          'zh-CN': whoLoc('zh-CN') + '重提这段往事："' + zhLine + '"'
        }, fallback: whoLoc('zh-CN') + '重提这段往事："' + zhLine + '"' },
        data: { storyId: mapDef.story.id, ending: past.ending, companionId: state.flags.allyId }
      };
      addLog(state, 'dm_canned', ev);
    }
  }

  // hydrate this map (and warn about unknown monster kinds once)
  mapDef.entities.forEach(e => {
    if (e.type === 'monster' && !contentContext.monster(state, e.kind)) {
      addLog(state, 'system', presentation.eventMessage("event.engine.startGame.46",[e.kind],["Warning: unknown monster kind \"","\" on this map — skipped."]));
    }
  });
  loadWorldMap(state, mapDef.id);

  addLog(state, 'system', presentation.eventMessage("event.engine.startGame.47",[presentation.name(p,state),{...presentation.ref('classes',p.className),fallback:cap(p.className)},presentation.name(mapDef,state)],[""," the "," enters ",". The delve begins."]));
  if (state.seed != null) state.rngState = rngState;
  rngState = null;
  return state;
}

// Travel between connected maps via stairs. Per-map progress (chests, doors,
// slain monsters, explored fog) is snapshotted and restored.
function travelTo(state, targetMapId, x, y, events) {
  const destination = typeof targetMapId === 'string' ? contentContext.map(state, targetMapId) : null;
  if (!destination || !Number.isSafeInteger(x) || !Number.isSafeInteger(y) || x < 0 || y < 0 || x >= destination.width || y >= destination.height || destination.rows[y][x] === '#') {
    events.push({ type: 'error', ...presentation.eventMessage("event.engine.travelTo.48",[],["Those stairs lead nowhere or have an invalid arrival tile."]) }); return;
  }
  if (!state.world) state.world = {}; // saves from before multi-map get it lazily
  state.world[state.mapId] = snapshotWorldMap(state);
  const fromName = state.mapName;
  const fromDisplay = {...presentation.descriptor(state.map),fallback:fromName};
  loadWorldMap(state, targetMapId);
  const p = playerEntity(state);
  p.x = x; p.y = y;
  const ally = state.entities.find(e => e.kind === 'ally');
  if (ally) { ally.x = Math.max(1, x - 1); ally.y = y; }
  // break off any fight — travel is a full disengage
  state.mode = 'explore';
  state.flags.reckless = false;
  const ev = { type: 'travel', narrate: true, ...presentation.eventMessage("event.engine.travelTo.49",[presentation.name(p,state),fromDisplay,presentation.field(state.map,'name')],[""," takes the ancient stairs. The dark of "," gives way to ","."]), data: { mapId: targetMapId } };
  events.push(ev); addLog(state, 'system', ev);
  const visible = computeVision(state);
  markDiscovered(state, visible);
  checkRoomEntry(state, events);
}

function addLog(state, kind, text, metadata = {}) {
  const entry = text && typeof text === 'object' ? { text:text.text, messageKey:text.messageKey, params:text.params, textDisplay:text.textDisplay } : { text };
  state.log.push({ kind, ...entry, ...metadata, ts: Date.now() });
  if (state.log.length > 300) state.log.splice(0, state.log.length - 300);
}

// ------------------------------------------------------ in-character hints ----
// The NPCs teach the rules by mouth: one-time hints tied to real firsts.
function hint(state, key, npcName, text, events) {
  state.flags.hints = state.flags.hints || {};
  if (state.flags.hints[key]) return;
  state.flags.hints[key] = true;
  const ev = { type: 'hint', narrate: false, ...presentation.eventMessage("event.engine.hint.50",[npcName,text],["",": \"","\""]) };
  events.push(ev); addLog(state, 'npc', ev);
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
    // the player's initiative bonus (Alert, Feral Instinct, item sets) finally applies here
    const initBonus = e.kind === 'player' ? (state.character.initBonus || 0) : 0;
    return { id: e.id, name: e.name, total: d20({}).natural + dexM + initBonus };
  }).sort((a, b) => b.total - a.total);
  state.combat = { order, turnIdx: 0, round: 1, actionUsed: false, bonusUsed: false, movementLeft: playerEntity(state).speedFt };
  participants.filter(e => e.kind === 'monster').forEach(m => { m.aware = true; });
  const names = order.map(o => `${o.name} (${o.total})`).join(', ');
  hint(state, 'combat', presentation.eventMessage("event.engine.startCombat.51",[],["Bram the Scout"]), presentation.eventMessage("event.engine.startCombat.52",[],["Steel first, questions later! Click a beast to mark your target, then strike. Watch the initiative line — you only act on your turn."]), events);
  const ev = { type: 'combat_start', narrate: true, ...presentation.eventMessage("event.engine.startCombat.53",[{parts:order.map(o=>({parts:[presentation.name(state.entities.find(e=>e.id===o.id),state),' ('+o.total+')']})),separator:', ',fallback:names}],["Combat begins! Initiative: ","."]), data: { order } };
  events.push(ev); addLog(state, 'mech', ev);
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
      addLog(state, 'mech', presentation.eventMessage("event.engine.tickBuffs.54",[presentation.name(e,state)],["","'s concentration is broken."]));
    }
  });
}

function checkPlayerDeath(state, events) {
  if (state.mode === 'over') return true;
  const p = playerEntity(state);
  if (p && p.hp <= 0 && !p.conditions.includes('unconscious')) {
    if (state.character.dropTo1 && !state.flags.dropUsed) {
      p.hp = 1; state.flags.dropUsed = true;
      const ev = { type: 'relentless', narrate: true, ...presentation.eventMessage("event.engine.checkPlayerDeath.55",[presentation.name(p,state)],[""," refuses to fall — Relentless Endurance keeps them at 1 HP!"]) };
      events.push(ev); addLog(state, 'mech', ev);
      return false;
    }
    // 5e dying: death saving throws each turn; 3 successes stabilize, 3 failures kill
    p.hp = 0;
    p.deathSaves = { succ: 0, fail: 0, stable: false };
    if (!p.conditions.includes('unconscious')) p.conditions.push('unconscious');
    p.buffs = [];
    const allyAlive = state.entities.some(e => e.kind === 'ally' && e.alive);
    const ev = { type: 'dying', narrate: true, ...presentation.eventMessage("event.engine.checkPlayerDeath.56",[presentation.name(p,state),(allyAlive ? presentation.eventMessage("event.engine.checkPlayerDeath.57",[],[" Bram fights on over your body!"]) : presentation.eventMessage("event.engine.checkPlayerDeath.58",[],[" No one is left to stand over you…"]))],[""," falls, dying! Death saving throws begin each turn — 3 successes stabilize, 3 failures mean the end.",""]) };
    events.push(ev); addLog(state, 'system', ev);
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
    const ev = { type: 'death_save', narrate: true, ...presentation.eventMessage("event.engine.rollDeathSave.59",[presentation.name(p,state)],["NATURAL 20! "," gasps awake with 1 HP, adrenaline flooding back!"]) };
    events.push(ev); addLog(state, 'mech', ev);
    return;
  }
  if (roll.natural === 1) {
    p.deathSaves.fail += 2; outcome = 'a catastrophic failure — TWO marks of death';
  } else if (roll.natural >= 10) {
    p.deathSaves.succ++; outcome = 'a success';
  } else {
    p.deathSaves.fail++; outcome = 'a failure';
  }
  addLog(state, 'mech', presentation.eventMessage("event.engine.rollDeathSave.60",[roll.natural,outcome,p.deathSaves.succ,p.deathSaves.fail],["Death save: d20 "," — "," ("," success / "," failure)."]));
  if (p.deathSaves.fail >= 3) {
    state.mode = 'over'; state.flags.failed = true; p.alive = false;
    // each death of this save is its own settleable end (T3): sync-delve dedupes on it
    state.endSeq = (state.endSeq || 0) + 1;
    const ev = { type: 'player_down', narrate: true, ...presentation.eventMessage("event.engine.rollDeathSave.61",[presentation.name(p,state)],["The third failure. "," slips beyond the reach of any blade or prayer…"]) };
    events.push(ev); addLog(state, 'system', ev);
    return;
  }
  if (p.deathSaves.succ >= 3) {
    p.deathSaves.stable = true;
    const ev = { type: 'death_save', narrate: true, ...presentation.eventMessage("event.engine.rollDeathSave.62",[presentation.name(p,state)],[""," stabilizes! The dying slows — but the crypt is still no place to wake up."]) };
    events.push(ev); addLog(state, 'mech', ev);
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
  state.flags.used_crusher = false;
  state.flags.used_slasher = false;
  state.flags.used_piercer = false;
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
    addLog(state, 'mech', presentation.eventMessage("event.engine.beginPlayerTurn.63",[presentation.name(p,state)],[""," stands up (half movement)."]));
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
  ac += setAcBonus(char);
  return ac;
}
function charHasArmor(char) { return char.inventory.some(i => byId(ARMORS, i.itemId)); }

// ---------------------------------------------------------------- damage ----
function applyDamage(state, target, amount, damageType, events, opts = {}) {
  if (target.kind === 'monster' && target.fled) return 0; // departed guards cannot be farmed through stale targets
  if (!target || target.alive === false || amount <= 0) return 0;
  let dmg = amount;
  if (!state.stats) state.stats = { dmgDealt: 0, dmgTaken: 0, kills: 0, goldFound: 0, rounds: 0 };
  if (target.kind === 'player') state.stats.dmgTaken += amount;
  const resList = target.kind === 'player' ? (state.character.resistances || []) : (target.resistances || []);
  if (target.kind === 'player' && hasBuff(target, 'rage') && ['bludgeoning', 'piercing', 'slashing'].includes(damageType)) dmg = Math.floor(dmg / 2);
  // Stone-skinned champions resist weapons — but magic weapons and spells cut straight through
  const resistsPhysicalOnly = !!(target.affix && target.affix.nonmagicalPhysical);
  if (resList.includes(damageType) && !(resistsPhysicalOnly && opts.magical && ['bludgeoning', 'piercing', 'slashing'].includes(damageType))) {
    const before = dmg;
    dmg = Math.floor(dmg / 2);
    if (before > 1) addLog(state, 'mech', presentation.eventMessage("event.engine.applyDamage.64",[presentation.name(target,state),damageType,before,dmg],[""," resists the "," damage ("," → ",")."]));
  }
  if ((target.vulnerabilities || []).includes(damageType)) dmg *= 2;
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
      addLog(state, 'mech', presentation.eventMessage("event.engine.applyDamage.65",[presentation.name(target,state)],[""," is shaken awake by the pain!"]));
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
      addLog(state, 'mech', presentation.eventMessage("event.engine.applyDamage.66",[presentation.name(target,state),spellName,save,dc],["","'s concentration on "," is broken! ("," vs DC ",")"]));
    }
  }
  if (target.hp <= 0) {
    if (target.kind === 'monster' && (target.traits || []).some(t => t.startsWith('Undead Fortitude'))) {
      const save = d20({});
      const dc = 5 + amount;
      if (save.natural !== 1 && save.natural + mod((target.abilities || {}).con || 10) >= dc) {
        target.hp = 1;
        const ev = { type: 'undead_fort', narrate: true, ...presentation.eventMessage("event.engine.applyDamage.67",[presentation.name(target,state),save.natural,dc],[""," refuses to fall — Undead Fortitude holds its corpse together! (CON "," vs DC ",")"]) };
        events.push(ev); addLog(state, 'mech', ev);
        return dmg;
      }
    }
    target.hp = 0; target.alive = false;
    if (!state.stats) state.stats = { dmgDealt: 0, dmgTaken: 0, kills: 0, goldFound: 0, rounds: 0 };
    if (target.kind === 'ally') {
      const ev = { type: 'companion', narrate: true, ...presentation.eventMessage("event.engine.applyDamage.68",[presentation.name(target,state)],[""," crashes to the ground! \"This… wasn't the plan…\""]) };
      events.push(ev); addLog(state, 'mech', ev);
      adjustLoyalty(state, -10, events, target);
    }
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
          const bEv = { type: 'bestiary_entry', narrate: true, ...presentation.eventMessage("event.engine.applyDamage.69",[presentation.name(target,state),bonus],["📖 图鉴收录："," — 首次击杀，+"," XP。"]) };
          events.push(bEv); addLog(state, 'mech', bEv);
          state.flags = state.flags || {};
          state.flags.pendingBestiaryBonus = (state.flags.pendingBestiaryBonus || 0) + bonus;
        }
      }
      const ev = { type: 'kill', narrate: true, ...presentation.eventMessage("event.engine.applyDamage.70",[presentation.name(target,state),target.xp],[""," is destroyed! (+"," XP)"]), data: { xp: target.xp, targetId: target.id, targetX: target.x, targetY: target.y } };
      events.push(ev); addLog(state, 'mech', ev);
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
      progressPersonalQuest(state, target, events);
    } else if (target.kind === 'ally') {
      const ev = { type: 'ally_down', narrate: true, ...presentation.eventMessage("event.engine.applyDamage.71",[presentation.name(target,state)],[""," collapses!"]), data: { targetId: target.id, targetX: target.x, targetY: target.y } };
      events.push(ev); addLog(state, 'mech', ev);
    }
  }
  return dmg;
}

function healEntity(state, ent, amt, events, source) {
  const healed = Math.max(0, Math.min(amt, ent.hpMax - ent.hp));
  ent.hp += healed;
  const ev = { type: 'heal', narrate: healed > 0, ...(healed > 0 ? presentation.eventMessage("event.engine.healEntity.72",[source,presentation.name(ent,state),healed,ent.hp,ent.hpMax],["",": "," regains "," HP (","/",")."]) : presentation.eventMessage("event.engine.healEntity.73",[presentation.name(ent,state)],[""," is already at full health."])), data: { heal: healed, targetId: ent.id, targetX: ent.x, targetY: ent.y } };
  events.push(ev); addLog(state, 'mech', ev);
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
  if (hexed && !atk.spell) out.dmgDice.push({ dice: hexed.extraDamage, type: hexed.damageType === 'weapon' ? atk.damageType : hexed.damageType });
  if (hasBuff(p, 'rage') && !atk.ranged && ['slashing', 'piercing', 'bludgeoning'].includes(atk.damageType)) out.bonusFlat += 2;
  if (hasBuff(p, 'divine_favor') && !atk.spell) out.dmgDice.push({ dice: '1d4', type: 'radiant' });
  if (hasBuff(p, 'smite_charge') && !atk.spell) {
    removeBuff(p, 'smite_charge');
    out.dmgDice.push({ dice: '2d8', type: 'radiant' });
    events.push({ type: 'smite', narrate: false, ...presentation.eventMessage("event.engine.attackMods.74",[],["Divine Smite erupts — radiant power floods your weapon!"]) });
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
      events.push({ type: 'note', narrate: false, ...presentation.eventMessage("event.engine.monsterAttack.75",[],["Commander’s Strike! +1d8 damage."]) });
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
  const extraDisplay = [];
  let extraAffixTxt = '';
  const damageExtras = [];
  if (isPlayer) {
    const bless = getBuff(target, 'blessed');
    if (bless) { const b = die(4); atkExtra += b; extraTxt += ` +${b} bless`; extraDisplay.push({key:'content.modifier',params:{value:b,kind:presentation.term('damage','bless')}}); }
    const altar = getBuff(target, 'altar_blessed');
    if (altar) atkExtra += 1;
  }
  const enrageBonus = attacker.enraged ? 2 : 0;
  const total = roll.natural + atk.bonus + enrageBonus + atkExtra;
  const hit = roll.natural === 20 || (roll.natural !== 1 && total >= targetAc);
  const atkStr = `${attacker.name}'s ${atk.name}`;
  if (!hit) {
    const message_text_1 = presentation.eventMessage("event.engine.monsterAttack.1",[presentation.eventMessage("event.engine.monsterAttack.2",[presentation.name(attacker,state),presentation.name(atk,state)],["","'s ",""]),presentation.name(target,state),roll.natural,atk.bonus >= 0 ? '+' + atk.bonus : atk.bonus,{parts:extraDisplay,separator:' ',fallback:extraTxt},total,targetAc],[""," misses "," (d20 ","",""," = "," vs AC ",")."]), text = message_text_1.text;
    events.push({ type: 'miss', narrate: false, text, messageKey:message_text_1.messageKey, params:message_text_1.params, data: { attackerId: attacker.id, targetId: target.id, targetX: target.x, targetY: target.y } }); addLog(state, 'mech', message_text_1);
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
      damageExtras.push({key:'content.modifier',params:{value:r.total,kind:presentation.term('damage',b.type)}});
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
    damageExtras.length=0;
    damageExtras.push({key:'content.modifier',params:{value:extra,kind:presentation.term('damage',attacker.affix.bonusDamage.type)}});
  }
  const dmg = { total: Math.max(1, Math.round((rolled.total + enrageFlat) * dmgMult)), dice: rolled.dice };
  const text = `${atkStr} hits ${target.name}${crit ? ' — CRITICAL HIT!' : ''} for ${dmg.total} ${atk.damageType} damage${extraAffixTxt}.`;
  const message = {text,messageKey:'content.monsterHit',params:{attacker:presentation.name(attacker,state),attack:presentation.name(atk,state),target:presentation.name(target,state),critical:crit?{key:'content.critical'}:'',damage:dmg.total,type:presentation.term('damage',atk.damageType),bonus:{parts:damageExtras.length?[' (',{parts:damageExtras,separator:' '},')']:[],fallback:extraAffixTxt}}};
  events.push({ type: 'attack_in', narrate: true, ...message, data: { attackerId: attacker.id, dmg: dmg.total, crit, targetId: target.id, targetX: target.x, targetY: target.y } });
  addLog(state, 'mech', message);
  // Stone's Endurance (Goliath reaction, auto-used on heavy hits)
  if (isPlayer && state.character.stonesEndurance && (state.character.uses.stones_endurance === undefined || state.character.uses.stones_endurance > 0) && dmg.total >= 6) {
    state.character.uses.stones_endurance = 0;
    const reduce = rollExpr('1d12').total + mod(state.character.abilities.con);
    const ev = { type: 'stones', narrate: true, ...presentation.eventMessage("event.engine.monsterAttack.76",[presentation.name(target,state),reduce],["Stone's Endurance! "," braces and shrugs off "," damage."]) };
    events.push(ev); addLog(state, 'mech', ev);
    const dealt = applyDamage(state, target, Math.max(0, dmg.total - reduce), atk.damageType, events);
    addLog(state, 'mech', presentation.eventMessage("event.engine.monsterAttack.77",[presentation.name(target,state),dealt,Math.max(0, target.hp),target.hpMax],[""," takes "," damage (","/"," HP)."]));
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
      const ev = { type: 'condition', narrate: true, ...presentation.eventMessage("event.engine.monsterAttack.78",[presentation.name(target,state),presentation.name(attacker,state)],[""," is poisoned by ","'s venomous strike — disadvantage on attacks until the end of its next turn!"]) };
      events.push(ev); addLog(state, 'mech', ev);
    }
  }
  if (isPlayer) {
    addLog(state, 'mech', presentation.eventMessage("event.engine.monsterAttack.79",[presentation.name(target,state),dealt,Math.max(0, target.hp),target.hpMax],[""," takes "," damage (","/"," HP)."]));
    if (target.hp > 0 && target.hp < target.hpMax * 0.4) hint(state, 'lowhp', presentation.eventMessage("event.engine.monsterAttack.80",[],["Marla the Peddler"]), presentation.eventMessage("event.engine.monsterAttack.81",[],["You are bleeding, dear! Potions are a bonus action — drink one before you faint on me."]), events);
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
  const target = state.entities.find(e => e.id === targetId && e.alive !== false && !e.fled);
  const objTarget = (!target) ? state.objects.find(o => o.id === targetId && (o.type === 'barrel' || o.type === 'spores')) : null;
  if (!target && !objTarget) { events.push({ type: 'error', ...presentation.eventMessage("event.engine.playerAttack.82",[],["No such target."]) }); return false; }
  const char = state.character;
  let atk = char.attacks.find(a => a.weaponId === weaponId) || char.attacks[0];
  if (!atk) { events.push({ type: 'error', ...presentation.eventMessage("event.engine.playerAttack.83",[],["You have no weapon."]) }); return false; }
  if (hasBuff(p, 'shillelagh') && ['club', 'quarterstaff'].includes(atk.weaponId)) {
    atk = { ...atk, bonus: char.profBonus + char.spellcasting.spellMod, dmgDice: '1d8', dmgMod: char.spellcasting.spellMod };
  }

  if (objTarget) {
    if ((objTarget.type === 'barrel' && objTarget.exploded) || (objTarget.type === 'spores' && objTarget.burst)) {
      events.push({ type: 'error', ...presentation.eventMessage("event.engine.playerAttack.84",[presentation.name(objTarget,state)],[""," is already destroyed."]) }); return false;
    }
    const dist = manhattan(p, objTarget);
    if (atk.ranged ? dist > Math.floor((atk.range || 30) / 5) : dist > 1) {
      events.push({ type: 'error', ...(atk.ranged ? presentation.eventMessage("event.engine.playerAttack.85",[presentation.name(objTarget,state),atk.range],[""," is out of range ("," ft)."]) : presentation.eventMessage("event.engine.playerAttack.86",[presentation.name(objTarget,state)],[""," is not adjacent — move closer first."])) });
      return false;
    }
    if (atk.ranged && !los(state, p.x, p.y, objTarget.x, objTarget.y)) {
      events.push({ type: 'error', ...presentation.eventMessage("event.engine.playerAttack.87",[],["You have no clear shot — something blocks the way."]) }); return false;
    }
    const roll = d20({ reroll1: char.rerollNat1 });
    const total = roll.natural + atk.bonus;
    const hit = roll.natural === 20 || (roll.natural !== 1 && total >= 10);
    if (!hit) {
      const message_text_2 = presentation.eventMessage("event.engine.playerAttack.4",[presentation.name(p,state),presentation.name(atk,state),presentation.name(objTarget,state),roll.natural,atk.bonus,total],["","'s "," misses the "," (d20 ","+"," = "," vs AC 10)."]), text = message_text_2.text;
      events.push({ type: 'miss', narrate: true, text, messageKey:message_text_2.messageKey, params:message_text_2.params, data: { targetId: objTarget.id, targetX: objTarget.x, targetY: objTarget.y } });
      addLog(state, 'mech', message_text_2);
      return true;
    }
    const message_text_3 = presentation.eventMessage("event.engine.playerAttack.5",[presentation.name(p,state),presentation.name(objTarget,state),presentation.name(atk,state)],[""," strikes the "," with ","!"]), text = message_text_3.text;
    events.push({ type: 'attack', narrate: true, text, messageKey:message_text_3.messageKey, params:message_text_3.params, data: { dmg: 1, crit: roll.natural === 20, target: objTarget.name, targetId: objTarget.id, targetX: objTarget.x, targetY: objTarget.y } });
    addLog(state, 'mech', message_text_3);
    if (objTarget.type === 'barrel') detonateBarrel(state, objTarget, events, `${p.name}'s ${atk.name}`);
    else if (objTarget.type === 'spores') triggerSpores(state, objTarget, events);
    return true;
  }

  const dist = manhattan(p, target);
  if (atk.ranged ? dist > Math.floor((atk.range || 30) / 5) : dist > 1) {
    events.push({ type: 'error', ...(atk.ranged ? presentation.eventMessage("event.engine.playerAttack.88",[presentation.name(target,state),atk.range],[""," is out of range ("," ft)."]) : presentation.eventMessage("event.engine.playerAttack.89",[presentation.name(target,state)],[""," is not adjacent — move closer first."])) });
    return false;
  }
  if (atk.ranged && !los(state, p.x, p.y, target.x, target.y)) {
    events.push({ type: 'error', ...presentation.eventMessage("event.engine.playerAttack.90",[],["You have no clear shot — something blocks the way."]) }); return false;
  }

  const mods = attackMods(state, p, target, atk, events);
  const rollOpts = { adv: mods.adv && !mods.dis, dis: mods.dis && !mods.adv, reroll1: char.rerollNat1 };
  const roll = d20(rollOpts);
  let atkBonus = atk.bonus + mods.bonusFlat;
  let atkExtra = 0, extraTxt = '';
  const extraDisplay=[];
  mods.atkRolls.forEach(b => { const r = rollExpr(b.dice); atkExtra += r.total; extraTxt += ` +${r.total} ${b.type}`; extraDisplay.push({key:'content.modifier',params:{value:r.total,kind:presentation.term('damage',b.type)}}); });
  const total = roll.natural + atkBonus + atkExtra;
  const critThreshold = (char.subclass === 'champion') ? 19 : 20;
  const crit = roll.natural >= critThreshold;
  const hit = crit || (roll.natural !== 1 && total >= currentAc(state, target));
  if (hasBuff(p, 'adv_next_attack')) removeBuff(p, 'adv_next_attack');

  if (!hit) {
    const message_text_4 = presentation.eventMessage("event.engine.playerAttack.6",[presentation.name(p,state),presentation.name(atk,state),presentation.name(target,state),roll.natural,atkBonus >= 0 ? '+' + atkBonus : atkBonus,{parts:extraDisplay,separator:' ',fallback:extraTxt},total,target.ac],["","'s "," misses "," (d20 ","",""," = "," vs AC ",")."]), text = message_text_4.text;
    events.push({ type: 'miss', narrate: true, text, messageKey:message_text_4.messageKey, params:message_text_4.params, data: { targetId: target.id, targetX: target.x, targetY: target.y } }); addLog(state, 'mech', message_text_4);
    return true;
  }
  let dmg = damageRoll(atk.dmgDice, { crit, gwf: char.fightingStyle === 'great_weapon', rerollAll: char.savageAttacker && !state.flags.savage_used, piercer: (char.unlockedFeats || []).includes('piercer') && atk.damageType === 'piercing' && !state.flags.used_piercer });
  if (char.savageAttacker) state.flags.savage_used = true;
  if (dmg.piercerRerolled) state.flags.used_piercer = true;
  let dmgTotal = dmg.total + (atk.dmgMod || 0) + mods.bonusFlat;
  const bonusTxts = [], bonusDisplay = [];
  if (atk.dmgMod) {bonusTxts.push(`+${atk.dmgMod} mod`);bonusDisplay.push({key:'content.modifier',params:{value:atk.dmgMod,kind:presentation.term('damage','mod')}});}
  mods.dmgDice.forEach(b => {
    if (b.oncePerTurn && state.flags['used_' + b.oncePerTurn]) return;
    if (b.flat) { dmgTotal += b.flat; bonusTxts.push(`+${b.flat} ${b.type}`); bonusDisplay.push({key:'content.modifier',params:{value:b.flat,kind:presentation.term('damage',b.type)}}); return; }
    const r = rollExpr(b.dice);
    dmgTotal += r.total;
    bonusTxts.push(`+${r.total} ${b.type}`); bonusDisplay.push({key:'content.modifier',params:{value:r.total,kind:presentation.term('damage',b.type)}});
    if (b.oncePerTurn) state.flags['used_' + b.oncePerTurn] = true;
  });
  if (char.inventory.some(i => i.itemId === 'amulet_might') && !atk.spell) { dmgTotal += 2; bonusTxts.push('+2 might');bonusDisplay.push({key:'content.modifier',params:{value:2,kind:presentation.term('damage','might')}}); }
  if (atk.bonusDamage) {
    const r = rollExpr(atk.bonusDamage.dice);
    dmgTotal += r.total;
    bonusTxts.push(`+${r.total} ${atk.bonusDamage.type}`);bonusDisplay.push({key:'content.modifier',params:{value:r.total,kind:presentation.term('damage',atk.bonusDamage.type)}});
  }
  const message_text_5 = presentation.eventMessage("event.engine.playerAttack.8",[presentation.name(p,state),presentation.name(target,state),presentation.name(atk,state),(crit ? presentation.eventMessage("event.engine.playerAttack.9",[],[" — CRITICAL HIT!"]) : presentation.eventMessage("event.engine.playerAttack.10",[],[""])),dmg.total,(bonusTxts.length ? presentation.eventMessage("event.engine.playerAttack.11",[{parts:bonusDisplay,separator:' ',fallback:bonusTxts.join(' ')}],[" ",""]) : presentation.eventMessage("event.engine.playerAttack.12",[],[""])),dmgTotal,presentation.term("damage",atk.damageType)],[""," strikes "," with ","",": ",""," = "," "," damage."]), text = message_text_5.text;
  events.push({ type: 'attack', narrate: true, text, messageKey:message_text_5.messageKey, params:message_text_5.params, data: { dmg: dmgTotal, crit, target: target.name, targetId: target.id, targetX: target.x, targetY: target.y } });
  addLog(state, 'mech', message_text_5);
  const dealt = applyDamage(state, target, dmgTotal, atk.damageType, events, { magical: !!atk.magic || !!atk.spell });
  addLog(state, 'mech', presentation.eventMessage("event.engine.playerAttack.91",[presentation.name(target,state),dealt,target.hp,target.hpMax,(target.alive === false ? presentation.eventMessage("event.engine.playerAttack.92",[],[", slain"]) : presentation.eventMessage("event.engine.playerAttack.93",[],[""]))],[""," takes "," damage (","/"," HP",")."]));
  if (atk.vampiricHeal && dealt > 0) {
    healEntity(state, p, atk.vampiricHeal, events, `${atk.name} (vampiric)`);
  }
  // Weapon-style feats: once-per-turn riders on a confirmed hit
  if (target.alive !== false && dealt > 0 && (char.unlockedFeats || []).length) {
    const feats = char.unlockedFeats;
    if (feats.includes('crusher') && atk.damageType === 'bludgeoning' && !state.flags.used_crusher) {
      const dx = Math.sign(target.x - p.x), dy = Math.sign(target.y - p.y);
      const nx = target.x + dx, ny = target.y + dy;
      if ((dx || dy) && !isBlocked(state, nx, ny) && !entityAt(state, nx, ny)) {
        state.flags.used_crusher = true;
        target.x = nx; target.y = ny;
        const ev = { type: 'shove', narrate: true, ...presentation.eventMessage("event.engine.playerAttack.94",[presentation.name(target,state)],[""," is smashed 5 ft away by the crushing blow!"]) };
        events.push(ev); addLog(state, 'mech', ev);
      }
    }
    if (feats.includes('slasher') && atk.damageType === 'slashing' && !state.flags.used_slasher && !hasBuff(target, 'slowed')) {
      state.flags.used_slasher = true;
      addBuff(target, { id: 'slowed', rounds: 2 });
      const ev = { type: 'info', narrate: true, ...presentation.eventMessage("event.engine.playerAttack.95",[presentation.name(target,state)],["","'s stride falters — the slash slows it by 10 ft."]) };
      events.push(ev); addLog(state, 'mech', ev);
    }
  }
  // Extra Attack (level 5 martials): the Attack action strikes twice
  if (opts.allowExtra && state.mode === 'combat' && !state.flags.used_extra && hasExtraAttack(char)
      && target.alive !== false && manhattan(p, target) <= 1 && atk.weaponId !== 'unarmed') {
    state.flags.used_extra = true;
    addLog(state, 'mech', presentation.eventMessage("event.engine.playerAttack.96",[presentation.name(p,state)],[""," presses the attack — Extra Attack!"]));
    playerAttack(state, targetId, atk.weaponId, events, {});
  }
  if (char.subclass === 'fiend' && target.alive === false) fiendBlessing(state, char, events);
  if (atk.weaponId === 'unarmed' && char.tavernBrawler && target.alive !== false) {
    const dx = Math.sign(target.x - p.x), dy = Math.sign(target.y - p.y);
    const nx = target.x + dx, ny = target.y + dy;
    if (!isBlocked(state, nx, ny) && !entityAt(state, nx, ny)) { target.x = nx; target.y = ny; addLog(state, 'mech', presentation.eventMessage("event.engine.playerAttack.97",[presentation.name(target,state)],[""," is shoved 5 ft!"])); }
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
  const ev = { type: 'fiend', narrate: true, ...presentation.eventMessage("event.engine.fiendBlessing.98",[gain],["Dark One's Blessing: your patron rewards the kill with "," Temporary HP."]) };
  events.push(ev); addLog(state, 'mech', ev);
}

function castSpell(state, spellId, targetId, events, opts = {}) {
  const p = playerEntity(state);
  const char = state.character;
  const sp = findSpell(spellId);
  if (!sp) { events.push({ type: 'error', ...presentation.eventMessage("event.engine.castSpell.99",[],["Unknown spell."]) }); return false; }
  removeBuff(p, 'invisible'); // casting breaks Invisibility

  if (sp.target === 'flavor') {
    const ev = { type: 'cast_flavor', narrate: true, ...presentation.eventMessage("event.engine.castSpell.100",[presentation.name(p,state),presentation.name(sp,state),presentation.field(sp,"desc")],[""," casts ",". ",""]) };
    events.push(ev); addLog(state, 'mech', presentation.eventMessage("event.engine.castSpell.101",[presentation.name(p,state),presentation.name(sp,state)],[""," casts ","."]));
    return true;
  }

  const isCantrip = sp.level === 0;
  if (!isCantrip && !opts.free) {
    if (!char.slots[sp.level] || char.slots[sp.level] <= 0) { events.push({ type: 'error', ...presentation.eventMessage("event.engine.castSpell.102",[sp.level],["No level "," spell slots left — take a rest."]) }); return false; }
  }
  if (state.mode === 'combat' && !opts.free) {
    if (sp.bonusAction) {
      if (state.combat.bonusUsed) { events.push({ type: 'error', ...presentation.eventMessage("event.engine.castSpell.103",[],["Bonus action already used this turn."]) }); return false; }
      state.combat.bonusUsed = true;
    } else {
      if (state.combat.actionUsed) { events.push({ type: 'error', ...presentation.eventMessage("event.engine.castSpell.104",[],["Action already used this turn."]) }); return false; }
      state.combat.actionUsed = true;
    }
  }
  if (!isCantrip && !opts.free) {
    char.slots[sp.level]--;
    addLog(state, 'mech', presentation.eventMessage("event.engine.castSpell.105",[presentation.name(p,state),presentation.name(sp,state),sp.level],[""," casts "," (level "," slot)."]));
  } else {
    addLog(state, 'mech', presentation.eventMessage("event.engine.castSpell.106",[presentation.name(p,state),presentation.name(sp,state),(isCantrip ? presentation.eventMessage("event.engine.castSpell.107",[],[" (cantrip)"]) : presentation.eventMessage("event.engine.castSpell.108",[],[""]))],[""," casts ","","."]));
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
      const ev = { type: 'buff', narrate: true, ...presentation.eventMessage("event.engine.castSpell.109",[presentation.name(p,state),r.total],["Deathly vigor settles over ",": "," temporary HP."]) };
      events.push(ev); addLog(state, 'mech', presentation.eventMessage("event.engine.castSpell.110",[presentation.name(p,state),r.total],[""," gains "," temp HP."])); return true;
    }
    if (sp.buff) {
      addBuff(p, { id: sp.buff.id, rounds: sp.buff.rounds, ...sp.buff });
      const ev = { type: 'buff', narrate: true, ...presentation.eventMessage("event.engine.castSpell.111",[presentation.name(p,state),presentation.name(sp,state),presentation.field(sp,"desc")],[""," casts ",". ",""]) };
      events.push(ev); return true;
    }
  }

  if (sp.target === 'ally') {
    const dest = (targetId === 'player' || !targetId) ? p : (resolveTarget() || p);
    if (dest.kind === 'monster') { events.push({ type: 'error', ...presentation.eventMessage("event.engine.castSpell.112",[],["You cannot target an enemy with that spell."]) }); return true; }
    if (sp.heal) { const r = rollExpr(sp.heal.dice); healEntity(state, dest, r.total + spMod + lifeBonus(char), events, sp.name); return true; }
    if (sp.buff) {
      addBuff(dest, { id: sp.buff.id, rounds: sp.buff.rounds, srcEntity: p.id, conc: !!sp.conc, ...sp.buff });
      const ev = { type: 'buff', narrate: true, ...presentation.eventMessage("event.engine.castSpell.113",[presentation.name(sp,state),presentation.name(dest,state),presentation.field(sp,"desc")],[""," settles over ",". ",""]) };
      events.push(ev); return true;
    }
  }

  const target = resolveTarget();
  const objTarget = (!target) ? state.objects.find(o => o.id === targetId && (o.type === 'barrel' || o.type === 'spores')) : null;
  if (objTarget) {
    if ((objTarget.type === 'barrel' && objTarget.exploded) || (objTarget.type === 'spores' && objTarget.burst)) {
      events.push({ type: 'error', ...presentation.eventMessage("event.engine.castSpell.114",[presentation.name(objTarget,state)],[""," is already destroyed."]) }); return true;
    }
    const dist = manhattan(p, objTarget);
    const rangeTiles = Math.max(1, Math.floor((sp.range || 30) / 5));
    if (dist > rangeTiles) { events.push({ type: 'error', ...presentation.eventMessage("event.engine.castSpell.115",[presentation.name(objTarget,state),sp.range],[""," is out of range ("," ft)."]) }); return true; }
    if (!los(state, p.x, p.y, objTarget.x, objTarget.y)) { events.push({ type: 'error', ...presentation.eventMessage("event.engine.castSpell.116",[],["You have no clear shot — something blocks the way."]) }); return true; }
    const ev = { type: 'spell_hit', narrate: true, ...presentation.eventMessage("event.engine.castSpell.117",[presentation.name(p,state),presentation.name(sp,state),presentation.name(objTarget,state)],["","'s "," strikes the ","!"]), data: { targetId: objTarget.id, targetX: objTarget.x, targetY: objTarget.y } };
    events.push(ev); addLog(state, 'mech', ev);
    if (objTarget.type === 'barrel') detonateBarrel(state, objTarget, events, `${p.name}'s ${sp.name}`);
    else if (objTarget.type === 'spores') triggerSpores(state, objTarget, events);
    return true;
  }
  if (!target || target.kind !== 'monster') { events.push({ type: 'error', ...presentation.eventMessage("event.engine.castSpell.118",[],["Choose an enemy target."]) }); return true; }
  const dist = manhattan(p, target);
  const rangeTiles = Math.max(1, Math.floor((sp.range || 30) / 5));
  if (dist > rangeTiles) { events.push({ type: 'error', ...presentation.eventMessage("event.engine.castSpell.119",[presentation.name(target,state),sp.range],[""," is out of range ("," ft)."]) }); return true; }

  if (sp.sleepPool) {
    const pool = rollExpr(sp.sleepPool).total;
    if (target.hp <= pool) {
      target.conditions.push('asleep');
      addBuff(target, { id: 'asleep', rounds: 10 });
      const ev = { type: 'sleep', narrate: true, ...presentation.eventMessage("event.engine.castSpell.120",[presentation.name(p,state),presentation.name(sp,state),presentation.name(target,state),pool],["","'s "," washes over "," — it slumps into magical sleep ("," HP pool)."]) };
      events.push(ev); addLog(state, 'mech', ev);
    } else {
      const ev = { type: 'sleep_fail', narrate: true, ...presentation.eventMessage("event.engine.castSpell.121",[presentation.name(target,state),pool],["The slumber washes over "," ("," HP pool) — but it fights off the sleep!"]) };
      events.push(ev); addLog(state, 'mech', ev);
    }
    return true;
  }
  if (sp.buffTarget) {
    addBuff(target, { id: sp.buffTarget.id, rounds: sp.buffTarget.rounds, ...sp.buffTarget });
    const ev = { type: 'hex', narrate: true, ...presentation.eventMessage("event.engine.castSpell.122",[presentation.name(sp,state),presentation.name(target,state),presentation.field(sp,"desc")],[""," takes hold of ",". ",""]) };
    events.push(ev); return true;
  }
  if (sp.attack) {
    const fakeAtk = { name: sp.name, ranged: sp.attack === 'ranged', spell: true, damageType: sp.damage.type, dmgDice: sp.damage.dice, range: sp.range, bonus: spAtk };
    const mods = attackMods(state, p, target, fakeAtk, events);
    const roll = d20({ adv: mods.adv && !mods.dis, dis: mods.dis && !mods.adv, reroll1: char.rerollNat1 });
    let atkExtra = 0;
    mods.atkRolls.forEach(b => { atkExtra += rollExpr(b.dice).total; });
    const total = roll.natural + spAtk + atkExtra + mods.bonusFlat;
    if (roll.natural !== 20 && (roll.natural === 1 || total < target.ac)) {
      const ev = { type: 'miss', narrate: true, ...presentation.eventMessage("event.engine.castSpell.123",[presentation.name(p,state),presentation.name(sp,state),presentation.name(target,state),roll.natural,spAtk,total,target.ac],["","'s "," misses "," (d20 ","+"," = "," vs AC ",")."]), data: { targetId: target.id, targetX: target.x, targetY: target.y } };
      events.push(ev); addLog(state, 'mech', ev); return true;
    }
    const crit = roll.natural === 20;
    const dmg = damageRoll(sp.damage.dice, { crit });
    if (char.subclass === 'evoker') dmg.total += spMod;
    const ev = { type: 'spell_hit', narrate: true, ...presentation.eventMessage("event.engine.castSpell.124",[presentation.name(p,state),presentation.name(sp,state),presentation.name(target,state),(crit ? presentation.eventMessage("event.engine.castSpell.125",[],[" — CRITICAL!"]) : presentation.eventMessage("event.engine.castSpell.126",[],[""])),dmg.total,sp.damage.type],["","'s "," strikes ","",": "," "," damage."]), data: { dmg: dmg.total, crit, targetId: target.id, targetX: target.x, targetY: target.y } };
    events.push(ev); addLog(state, 'mech', ev);
    applyDamage(state, target, dmg.total, sp.damage.type, events, { magical: true });
    if (char.subclass === 'fiend' && target.alive === false) fiendBlessing(state, char, events);
    if (sp.condition && target.alive !== false) applyCondition(sp.condition, target);
    if (sp.id === 'eldritch_blast' && char.invocations.includes('repelling_blast') && target.alive !== false) {
      const dx = Math.sign(target.x - p.x), dy = Math.sign(target.y - p.y);
      if (!isBlocked(state, target.x + dx, target.y + dy) && !entityAt(state, target.x + dx, target.y + dy)) {
        target.x += dx; target.y += dy;
        addLog(state, 'mech', presentation.eventMessage("event.engine.castSpell.127",[presentation.name(target,state)],[""," is hurled back 10 ft!"]));
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
      if (sp.save.onSave === 'prone') { if (!target.conditions.includes('prone')) target.conditions.push('prone'); addLog(state, 'mech', presentation.eventMessage("event.engine.castSpell.128",[presentation.name(target,state)],[""," slips and falls prone!"])); }
      if (sp.condition) applyCondition(sp.condition, target);
      if (sp.push) {
        const dx = Math.sign(target.x - p.x), dy = Math.sign(target.y - p.y);
        for (let i = 0; i < sp.push; i++) {
          const nx = target.x + dx, ny = target.y + dy;
          if (isBlocked(state, nx, ny) || entityAt(state, nx, ny)) break;
          target.x = nx; target.y = ny;
        }
        addLog(state, 'mech', presentation.eventMessage("event.engine.castSpell.129",[presentation.name(target,state)],[""," is hurled backward by the thunder!"]));
      }
    }
    return true;
  }
  if (sp.auto && sp.damage) {
    const dmg = rollExpr(sp.damage.dice);
    const ev = { type: 'spell_hit', narrate: true, ...presentation.eventMessage("event.engine.castSpell.130",[presentation.name(sp,state),presentation.name(target,state),dmg.total,sp.damage.type],[""," slams into "," unerringly: "," "," damage."]), data: { dmg: dmg.total, targetId: target.id, targetX: target.x, targetY: target.y } };
    events.push(ev); addLog(state, 'mech', ev);
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
    const message_text_6 = presentation.eventMessage("event.engine.maybeOpportunityAttack.13",[presentation.name(h,state),presentation.name(mover,state)],["⚠ "," strikes at "," as they slip away! (Opportunity Attack)"]), text = message_text_6.text;
    events.push({ type: 'opportunity', narrate: true, text, messageKey:message_text_6.messageKey, params:message_text_6.params, data: { attacker: h.name } });
    addLog(state, 'mech', message_text_6);
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
  if (!target) { events.push({ type: 'error', ...presentation.eventMessage("event.engine.shoveTarget.131",[],["No such target."]) }); return false; }
  if (manhattan(p, target) > 1) { events.push({ type: 'error', ...presentation.eventMessage("event.engine.shoveTarget.132",[presentation.name(target,state)],[""," is not adjacent."]) }); return false; }
  const athleteProf = char.skills.includes('athletics');
  const myCheck = mod(char.abilities.str) + (athleteProf ? char.profBonus : 0) + die(20);
  const tAthl = mod((target.abilities || {}).str || 10);
  const tAcro = mod((target.abilities || {}).dex || 10);
  const theirCheck = Math.max(tAthl, tAcro) + die(20);
  if (myCheck >= theirCheck) {
    const dx = Math.sign(target.x - p.x), dy = Math.sign(target.y - p.y);
    const nx = target.x + dx, ny = target.y + dy;
    if (isBlocked(state, nx, ny) || entityAt(state, nx, ny)) {
      events.push({ type: 'info', ...presentation.eventMessage("event.engine.shoveTarget.133",[presentation.name(target,state)],[""," braces against the wall — nowhere to shove."]) });
      return false;
    }
    target.x = nx; target.y = ny;
    if (target.conditions.includes('prone') === false && die(20) >= 18) {
      target.conditions.push('prone');
      addLog(state, 'mech', presentation.eventMessage("event.engine.shoveTarget.134",[presentation.name(target,state)],[""," also falls prone!"]));
    }
    const ev = { type: 'shove', narrate: true, ...presentation.eventMessage("event.engine.shoveTarget.135",[presentation.name(p,state),presentation.name(target,state),myCheck,theirCheck],[""," shoves "," back 5 ft! (Contest "," vs ",")"]) };
    events.push(ev); addLog(state, 'mech', ev);
  } else {
    const ev = { type: 'shove_fail', narrate: true, ...presentation.eventMessage("event.engine.shoveTarget.136",[presentation.name(p,state),presentation.name(target,state),myCheck,theirCheck],[""," fails to shove "," (Contest "," vs ",")."]) };
    events.push(ev); addLog(state, 'mech', ev);
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
    addLog(state, 'mech', presentation.eventMessage("event.engine.triggerTrap.137",[presentation.name(p,state),reroll.natural,saveMod],["Indomitable! "," rerolls the save: d20 ","+","."]));
  }
  const message_text_7 = presentation.eventMessage("event.engine.triggerTrap.14",[presentation.name(trap,state),presentation.name(p,state),String(trap.save || 'dex').toUpperCase(),saveRoll.natural,saveMod,trap.dc,(success ? presentation.eventMessage("event.engine.triggerTrap.15",[],["they dodge aside!"]) : presentation.eventMessage("event.engine.triggerTrap.16",[],["they are hit!"])),(evasion ? presentation.eventMessage("event.engine.triggerTrap.17",[],[" (Evasion)"]) : presentation.eventMessage("event.engine.triggerTrap.18",[],[""]))],["A ","! "," "," save: ","+"," vs DC "," — ","",""]), text = message_text_7.text;
  events.push({ type: 'trap', narrate: true, text, messageKey:message_text_7.messageKey, params:message_text_7.params }); addLog(state, 'mech', message_text_7);
  if (!success) {
    let dmg = rollExpr(trap.damage).total;
    if (evasion) dmg = Math.floor(dmg / 2);
    const dealt = applyDamage(state, p, dmg, trap.damageType || 'piercing', events);
    addLog(state, 'mech', presentation.eventMessage("event.engine.triggerTrap.138",[presentation.name(p,state),dealt],[""," takes "," damage."]));
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
        const ev = { type: 'trap_spotted', narrate: true, ...presentation.eventMessage("event.engine.noticeTrapsNearby.139",[presentation.name(p,state),presentation.name(trap,state),roll.natural,pm],["Sharp eyes! "," spots a "," hidden on the floor ahead (Perception ","+",")."]) };
        events.push(ev); addLog(state, 'mech', ev);
      }
    }
  });
}

function disarmTrap(state, trap, arg3, arg4) {
  const events = Array.isArray(arg3) ? arg3 : (Array.isArray(arg4) ? arg4 : []);
  const p = playerEntity(state);
  const char = state.character;
  if (trap.triggered || trap.disarmed) {
    const message_text_8 = presentation.eventMessage("event.engine.disarmTrap.19",[],["This trap is already disarmed."]), text = message_text_8.text;
    events.push({ type: 'info', text, messageKey:message_text_8.messageKey, params:message_text_8.params });
    addLog(state, 'mech', message_text_8);
    return;
  }
  const hasTools = (char.inventory || []).some(i => i.itemId === 'thieves_tools' || i.itemId === 'tool_thieves');
  if (!hasTools) {
    const message_text_9 = presentation.eventMessage("event.engine.disarmTrap.20",[],["You need thieves' tools to disarm a trap."]), text = message_text_9.text;
    events.push({ type: 'error', text, messageKey:message_text_9.messageKey, params:message_text_9.params });
    addLog(state, 'mech', message_text_9);
    return;
  }
  const dc = trap.dc || 12;
  let check = skillCheck(state, 'sleight_of_hand', dc, { toolProf: true });
  if (char.className === 'rogue' && !check.success) {
    check = skillCheck(state, 'sleight_of_hand', dc, { toolProf: true });
  }
  const natural = check.natural;
  const total = check.total;
  const modifier = total - natural;
  if (check.success) {
    trap.disarmed = true;
    trap.triggered = true;
    awardXp(state, 25, events);
    const message_text_10 = presentation.eventMessage("event.engine.disarmTrap.21",[presentation.name(p,state),presentation.name(trap,state),check.detail],["Success! "," disarms the "," (","). (+25 XP)"]), text = message_text_10.text;
    events.push({
      type: 'trap_disarmed',
      narrate: true,
      text, messageKey:message_text_10.messageKey, params:message_text_10.params,
      data: {
        trapId: trap.id,
        natural,
        modifier,
        total,
        dc,
        outcome: 'success',
        success: true
      }
    });
    addLog(state, 'mech', message_text_10);
  } else {
    const message_text_11 = presentation.eventMessage("event.engine.disarmTrap.22",[check.detail],["Failed check (",")! The mechanism snaps!"]), text = message_text_11.text;
    events.push({
      type: 'trap_disarm_failed',
      narrate: true,
      text, messageKey:message_text_11.messageKey, params:message_text_11.params,
      data: {
        trapId: trap.id,
        natural,
        modifier,
        total,
        dc,
        outcome: 'failure',
        success: false
      }
    });
    addLog(state, 'mech', message_text_11);
    triggerTrap(state, trap, events);
  }
}

function unlockChest(state, chest, method = 'pick', arg4, arg5) {
  const events = Array.isArray(arg4) ? arg4 : (Array.isArray(arg5) ? arg5 : []);
  const p = playerEntity(state);
  const char = state.character;
  if (chest.looted) {
    const message_text_12 = presentation.eventMessage("event.engine.unlockChest.23",[],["The chest is already empty."]), text = message_text_12.text;
    events.push({ type: 'info', text, messageKey:message_text_12.messageKey, params:message_text_12.params });
    addLog(state, 'mech', message_text_12);
    return;
  }
  if (!chest.locked || chest.unlocked) {
    const message_text_13 = presentation.eventMessage("event.engine.unlockChest.24",[],["The chest is already unlocked."]), text = message_text_13.text;
    events.push({ type: 'info', text, messageKey:message_text_13.messageKey, params:message_text_13.params });
    addLog(state, 'mech', message_text_13);
    return;
  }
  const isForce = method === 'force';
  const hasTools = (char.inventory || []).some(i => i.itemId === 'thieves_tools' || i.itemId === 'tool_thieves');
  if (!isForce && !hasTools) {
    const message_text_14 = presentation.eventMessage("event.engine.unlockChest.25",[],["You need thieves' tools to pick locks."]), text = message_text_14.text;
    events.push({ type: 'error', text, messageKey:message_text_14.messageKey, params:message_text_14.params });
    addLog(state, 'mech', message_text_14);
    return;
  }
  const dc = isForce ? (chest.forceDc || 14) : (chest.pickDc || 12);
  let check = isForce
    ? skillCheck(state, 'athletics', dc)
    : skillCheck(state, 'sleight_of_hand', dc, { toolProf: true });
  if (!isForce && char.className === 'rogue' && !check.success) {
    check = skillCheck(state, 'sleight_of_hand', dc, { toolProf: true });
  }
  const natural = check.natural;
  const total = check.total;
  const modifier = total - natural;
  if (check.success) {
    chest.locked = false;
    chest.unlocked = true;
    const message_text_15 = (isForce ? presentation.eventMessage("event.engine.unlockChest.26",[presentation.name(p,state),check.detail],[""," shatters the lock with raw force (",")!"]) : presentation.eventMessage("event.engine.unlockChest.27",[presentation.name(p,state),check.detail],["Click! "," picks the tumbler lock (",")!"])), text = message_text_15.text;
    events.push({
      type: 'chest_unlocked',
      narrate: true,
      text, messageKey:message_text_15.messageKey, params:message_text_15.params,
      data: {
        chestId: chest.id,
        method: isForce ? 'force' : 'pick',
        natural,
        modifier,
        total,
        dc,
        outcome: 'success',
        success: true
      }
    });
    addLog(state, 'mech', message_text_15);
    lootChest(state, chest, events);
  } else {
    const message_text_16 = (isForce ? presentation.eventMessage("event.engine.unlockChest.28",[presentation.name(p,state),check.detail],["The iron bands withstand ","'s blow (",")."]) : presentation.eventMessage("event.engine.unlockChest.29",[presentation.name(p,state),check.detail],["The lock tumblers jam and resist ","'s lockpick (",")."])), text = message_text_16.text;
    events.push({
      type: 'chest_locked',
      narrate: true,
      text, messageKey:message_text_16.messageKey, params:message_text_16.params,
      data: {
        chestId: chest.id,
        method: isForce ? 'force' : 'pick',
        natural,
        modifier,
        total,
        dc,
        outcome: 'failure',
        success: false
      }
    });
    addLog(state, 'mech', message_text_16);
  }
}

function detonateBarrel(state, barrel, events, source = 'impact') {
  if (!barrel || barrel.exploded) return;
  barrel.exploded = true;
  const dmgRoll = rollExpr('2d8');
  const message_text_17 = presentation.eventMessage("event.engine.detonateBarrel.30",[presentation.name(barrel,state),presentation.eventMessage("event.engine.detonateBarrel.31",[],["impact"]),dmgRoll.total],["💥 BOOM! The "," detonates (",")! Fire erupts across the area for "," fire damage!"]), text = message_text_17.text;
  events.push({ type: 'barrel_detonate', narrate: true, text, messageKey:message_text_17.messageKey, params:message_text_17.params, data: { barrelId: barrel.id, x: barrel.x, y: barrel.y, dmg: dmgRoll.total } });
  addLog(state, 'mech', message_text_17);

  // Affect all entities within 1 tile (3x3 grid)
  const victims = state.entities.filter(e => e.alive !== false && Math.abs(e.x - barrel.x) <= 1 && Math.abs(e.y - barrel.y) <= 1);
  for (const victim of victims) {
    const isPlayer = victim.kind === 'player';
    const saveMod = isPlayer ? (mod(state.character.abilities.dex) + playerSaveBonus(state, 'dex')) : mod((victim.abilities || {}).dex || 10);
    const roll = d20(isPlayer ? { reroll1: state.character.rerollNat1 } : {});
    const success = (roll.natural + saveMod) >= 12;
    const evasion = isPlayer && state.character.className === 'rogue' && state.character.level >= 7;
    let dealtDmg = success ? (evasion ? 0 : Math.floor(dmgRoll.total / 2)) : dmgRoll.total;
    const message_saveTxt_18 = presentation.eventMessage("event.engine.detonateBarrel.32",[presentation.name(victim,state),roll.natural,saveMod,(success ? presentation.eventMessage("event.engine.detonateBarrel.33",[],["half damage"]) : presentation.eventMessage("event.engine.detonateBarrel.34",[],["direct hit!"])),(evasion && success ? presentation.eventMessage("event.engine.detonateBarrel.35",[],[" (Evasion: 0)"]) : presentation.eventMessage("event.engine.detonateBarrel.36",[],[""]))],[""," DEX save vs Explosion: ","+"," vs DC 12 — ","",""]), saveTxt = message_saveTxt_18.text;
    events.push({ type: 'save', narrate: true, text: saveTxt, messageKey:message_saveTxt_18.messageKey, params:message_saveTxt_18.params, data: { success, targetId: victim.id, targetX: victim.x, targetY: victim.y } });
    addLog(state, 'mech', message_saveTxt_18);
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
  const message_text_19 = presentation.eventMessage("event.engine.triggerSpores.37",[presentation.name(spores,state)],["🍄 Toxic rupture! The "," burst, venting a choking cloud of virulent spores!"]), text = message_text_19.text;
  events.push({ type: 'spore_burst', narrate: true, text, messageKey:message_text_19.messageKey, params:message_text_19.params, data: { sporesId: spores.id, x: spores.x, y: spores.y, dmg: dmgRoll.total } });
  addLog(state, 'mech', message_text_19);

  const victims = state.entities.filter(e => e.alive !== false && Math.abs(e.x - spores.x) <= 1 && Math.abs(e.y - spores.y) <= 1);
  for (const victim of victims) {
    const isPlayer = victim.kind === 'player';
    const saveMod = isPlayer ? (mod(state.character.abilities.con) + playerSaveBonus(state, 'con')) : mod((victim.abilities || {}).con || 10);
    const roll = d20(isPlayer ? { reroll1: state.character.rerollNat1 } : {});
    const success = (roll.natural + saveMod) >= 12;
    let dealtDmg = success ? Math.floor(dmgRoll.total / 2) : dmgRoll.total;
    const message_saveTxt_20 = presentation.eventMessage("event.engine.triggerSpores.38",[presentation.name(victim,state),roll.natural,saveMod,(success ? presentation.eventMessage("event.engine.triggerSpores.39",[],["resists the poison!"]) : presentation.eventMessage("event.engine.triggerSpores.40",[],["poisoned!"]))],[""," CON save vs Spores: ","+"," vs DC 12 — ",""]), saveTxt = message_saveTxt_20.text;
    events.push({ type: 'save', narrate: true, text: saveTxt, messageKey:message_saveTxt_20.messageKey, params:message_saveTxt_20.params, data: { success, targetId: victim.id, targetX: victim.x, targetY: victim.y } });
    addLog(state, 'mech', message_saveTxt_20);
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
    events.push({ type: 'info', ...presentation.eventMessage("event.engine.useFont.140",[],["The font's basin is dry and silent. Its miraculous waters have been depleted."]) });
    return;
  }
  font.used = true;
  const healAmount = rollExpr('2d4+2').total;
  if (p.conditions && p.conditions.includes('poisoned')) {
    p.conditions = p.conditions.filter(c => c !== 'poisoned');
    p.buffs = (p.buffs || []).filter(b => b.condId !== 'poisoned');
  }
  healEntity(state, p, healAmount, events, 'Sacred Healing Font');
  const message_text_21 = presentation.eventMessage("event.engine.useFont.41",[presentation.name(p,state),presentation.name(font,state),healAmount],["✨ "," drinks from the ",". Azure light surges through their veins, cleansing poison and restoring "," HP!"]), text = message_text_21.text;
  events.push({ type: 'font_heal', narrate: true, text, messageKey:message_text_21.messageKey, params:message_text_21.params, data: { fontId: font.id, heal: healAmount } });
  addLog(state, 'mech', message_text_21);
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
  const message_text_22 = presentation.eventMessage("event.engine.pullLever.42",[p_name(state),presentation.name(lever,state),(lever.pulled ? presentation.eventMessage("event.engine.pullLever.43",[],["disarming connected mechanisms"]) : presentation.eventMessage("event.engine.pullLever.44",[],["re-arming connected mechanisms"]))],["⚙️ "," throws the "," with a resonant CLANK. Heavy counterweights shift behind the stone walls, ","!"]), text = message_text_22.text;
  events.push({ type: 'lever_pull', narrate: true, text, messageKey:message_text_22.messageKey, params:message_text_22.params, data: { leverId: lever.id, pulled: lever.pulled } });
  addLog(state, 'mech', message_text_22);
}

function triggerHazard(state, hazard, creature, events) {
  if (!creature || creature.alive === false) return;
  const dmg = rollExpr('1d4').total;
  const type = hazard.hazardType || 'acid';
  const message_text_23 = presentation.eventMessage("event.engine.triggerHazard.45",[presentation.name(creature,state),presentation.name(hazard,state),dmg,type],["🧪 Sizzle! "," steps into the "," and suffers "," "," damage!"]), text = message_text_23.text;
  events.push({ type: 'hazard_burn', narrate: true, text, messageKey:message_text_23.messageKey, params:message_text_23.params, data: { hazardId: hazard.id, targetId: creature.id, dmg } });
  addLog(state, 'mech', message_text_23);
  applyDamage(state, creature, dmg, type, events);
  if (creature.kind === 'player') checkPlayerDeath(state, events);
}

function movePlayer(state, targetX, targetY, events) {
  const p = playerEntity(state);
  if (state.mode === 'over' || state.mode === 'victory') return;
  const inCombat = state.mode === 'combat';
  const path = bfsPath(state, { x: p.x, y: p.y }, [{ x: targetX, y: targetY }], { self: p.id });
  if (!path) { events.push({ type: 'error', ...presentation.eventMessage("event.engine.movePlayer.141",[],["You cannot reach that tile — a wall or closed door blocks the way."]) }); return; }
  let budget = inCombat ? state.combat.movementLeft : Infinity;
  let steps = 0;
  let px_prev = p.x, py_prev = p.y;
  for (const step of path) {
    const cost = stepCost(state, step.x, step.y);
    if (inCombat && budget < cost) { addLog(state, 'mech', presentation.eventMessage("event.engine.movePlayer.142",[],["Out of movement — your turn ends here."])); break; }
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
  if (rand() > 0.22) return;
  if (hasBuff(p, 'invisible')) return;
  if (state.stealth && state.stealth.success) return;
  const kind = list[die(list.length) - 1];
  const def = contentContext.monster(state, kind);
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
  if (rand() < 0.18) {
    affixes.applyMonsterAffix(mon);
  }
  state.entities.push(mon);
  state.flags.wanders++;
  const ev = { type: 'wandering', narrate: true, ...presentation.eventMessage("event.engine.rollWanderingMonster.143",[presentation.name(def,state)],["A wandering "," comes snuffling around the corner - it has found you!"]) };
  events.push(ev); addLog(state, 'system', ev);
  startCombat(state, [mon.id], events);
}

function checkRoomEntry(state, events) {
  const p = playerEntity(state);
  const room = roomAt(state, p.x, p.y);
  if (room && !state.flags['room_' + room.id]) {
    state.flags['room_' + room.id] = true;
    const ev = { type: 'scene', narrate: true, ...presentation.eventMessage("event.engine.checkRoomEntry.144",[presentation.name(room,state),presentation.field(room,"desc")],["",": ",""]), data: { room: room.id, roomName: room.name } };
    events.push(ev); addLog(state, 'dm_canned', ev);
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
  const targetNode = c.type==='slay' ? state.entities.find(e=>e.monsterId===c.target) : c.type==='recover' ? state.objects.find(o=>o.id===c.target) : state.map.rooms.find(r=>r.id===c.target);
  const targetDisplay = presentation.name(targetNode,state) || c.targetName;
  quest.shortTextDisplay={key:'content.quest.'+c.type,params:{target:targetDisplay},fallback:quest.shortText};
  quest.textDisplay={key:'content.quest.hook.'+c.type,params:{target:targetDisplay},fallback:quest.text};
  state.quests = state.quests || { active: null, completed: [] };
  state.quests.active = quest;
  return quest;
}

function checkQuest(state, type, target, events) {
  const q = state.quests && state.quests.active;
  if (!q || q.type !== type || q.target !== target) return;
  state.quests.active = null;
  state.quests.completed.push({ shortText: q.shortText, text: q.text, shortTextDisplay:q.shortTextDisplay,textDisplay:q.textDisplay,language:q.language,reward: q.reward, ts: Date.now() });
  if (q.reward.gold) state.character.gold += q.reward.gold;
  const ev = { type: 'quest_done', narrate: true, ...presentation.eventMessage("event.engine.checkQuest.145",[presentation.field(q,"shortText"),q.reward.gold,q.reward.xp],["SIDE QUEST COMPLETE — ","! You collect "," gp and "," XP."]) };
  events.push(ev); addLog(state, 'system', ev);
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
  if (v.type === 'story') {
    const scene = (state.map.scenes || []).find(s => s.id === v.sceneId);
    won = !!scene && sceneEntry(state, scene).phase === 'resolved' && !!(state.encounterFacts || []).find(f => f.mapId === state.mapId && f.sceneId === scene.id && f.ending);
  } else if (v.type === 'slay_boss') {
    const bossAlive = state.entities.some(e => e.kind === 'monster' && e.boss && e.alive && !e.fled);
    if (!bossAlive) won = true;
  } else if (state.flags.hasRelic) won = true;
  if (!won) return;
  state.mode = 'victory'; state.flags.victory = true;
  state.endSeq = (state.endSeq || 0) + 1; // settleable end marker (T3)
  awardXp(state, 100, events);
  state.entities.filter(e => e.kind === 'ally' && e.alive).forEach(a => adjustLoyalty(state, 5, events, a));
  // the weekly trial pays its champion: a forced set piece the first time each delve wins
  if (state.weeklyLabel && !state.flags.weeklyGift) {
    state.flags.weeklyGift = true;
    const gift = affixes.rollMagicItem('rare', { category: 'armor', set: true });
    state.character.inventory = state.character.inventory || [];
    state.character.inventory.push(gift);
    const ev = { type: 'magic_item', narrate: true, ...presentation.eventMessage("event.engine.checkVictory.146",[presentation.name(gift,state)],["本周试炼完成 — 冠军战利品加持：","!"]) };
    events.push(ev); addLog(state, 'mech', ev);
  }
  const ev = { type: 'victory', narrate: true, ...presentation.eventMessage("event.engine.checkVictory.147",[presentation.name(p,state),presentation.field(state.map,"name"),(v.type === 'slay_boss' ? presentation.eventMessage("event.engine.checkVictory.148",[],[", leaving a broken guardian behind"]) : presentation.eventMessage("event.engine.checkVictory.149",[],[", the prize in hand"])),(state.weeklyLabel ? presentation.eventMessage("event.engine.checkVictory.150",[],[" 本周试炼完成！"]) : presentation.eventMessage("event.engine.checkVictory.151",[],[""]))],["VICTORY! "," escapes "," into daylight","."," The delve is complete! (+100 XP)"]) };
  events.push(ev); addLog(state, 'system', ev);
}

// ---------------------------------------------------------------- monster AI ----
function processMonsterTurn(state, mon, events) {
  if (!mon.alive || mon.fled || state.mode !== 'combat') return;
  if (mon.boss && !mon.enraged && mon.hp <= mon.hpMax / 2) {
    mon.enraged = true;
    const ev = { type: 'enrage', narrate: true, ...presentation.eventMessage("event.engine.processMonsterTurn.152",[presentation.name(mon,state)],[""," ENRAGES — its wounds only make it faster and crueler! (+2 to hit and damage, +10 ft speed)"]) };
    events.push(ev); addLog(state, 'mech', ev);
  }
  if (mon.boss && !mon.desperate && mon.hp > 0 && mon.hp <= mon.hpMax / 4) {
    mon.desperate = true;
    const ev = { type: 'desperate', narrate: true, ...presentation.eventMessage("event.engine.processMonsterTurn.153",[presentation.name(mon,state)],[""," is CORNERED — a final furious flurry! (two attacks per turn)"]) };
    events.push(ev); addLog(state, 'mech', ev);
  }
  mon.turnCount = (mon.turnCount || 0) + 1;
  if (mon.conditions.includes('asleep')) { addLog(state, 'mech', presentation.eventMessage("event.engine.processMonsterTurn.154",[presentation.name(mon,state)],[""," sleeps soundly."])); return; }
  if (mon.conditions.includes('paralyzed')) { addLog(state, 'mech', presentation.eventMessage("event.engine.processMonsterTurn.155",[presentation.name(mon,state)],[""," stands frozen, muscles locked."])); return; }
  if ((mon.traits || []).some(t => t.startsWith('Nimble Escape'))) addBuff(mon, { id: 'disengaged', rounds: 1 });
  if (hasBuff(mon, 'charmed')) { addLog(state, 'mech', presentation.eventMessage("event.engine.processMonsterTurn.156",[presentation.name(mon,state),p_name(state)],[""," gazes at "," with vacant affection and does nothing."])); return; }
  // boss gimmicks fire after status checks, before the attack routine
  if (mon.gimmick === 'summon_undead' && mon.enraged && !mon.hasSummoned) {
    mon.hasSummoned = true;
    const spot = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dy]) => ({ x: mon.x + dx, y: mon.y + dy }))
      .find(t => !isBlocked(state, t.x, t.y) && !entityAt(state, t.x, t.y));
    if (spot) {
      const skelDef = byId(MONSTERS, 'skeleton');
      const hp = skelDef ? Math.max(1, Math.round(rollExpr(skelDef.hp).total * DIFFICULTY[state.difficulty || 'normal'].hpMult)) : 9;
      const summonId = 'summon_' + mon.id + '_' + Date.now().toString(36);
      state.entities.push({
        id: summonId, kind: 'monster', monsterId: 'skeleton', name: 'Risen Vault Guard',
        x: spot.x, y: spot.y, hp, hpMax: hp, ac: skelDef ? skelDef.ac : 13, speedFt: 30,
        abilities: skelDef ? skelDef.abilities : undefined,
        attacks: skelDef ? skelDef.attacks : [{ name: 'Claw', bonus: 3, range: 5, damage: '1d6+1', damageType: 'slashing' }],
        darkvision: 60, xp: 50, alive: true, aware: true, conditions: [], buffs: [], summoned: true
      });
      state.combat.order.push({ id: summonId, name: 'Risen Vault Guard', total: 0 });
      const ev = { type: 'summon', narrate: true, ...presentation.eventMessage("event.engine.processMonsterTurn.157",[presentation.name(mon,state)],[""," gestures — the bones strewn across its lair clatter together and rise as a Risen Vault Guard!"]) };
      events.push(ev); addLog(state, 'mech', ev);
    }
  }
  if (mon.gimmick === 'ground_slam' && (mon.turnCount % 3) === 0) {
    const victims = state.entities.filter(e => (e.kind === 'player' || e.kind === 'ally') && e.alive !== false && manhattan(mon, e) <= 2);
    if (victims.length) {
      const ev = { type: 'ground_slam', narrate: true, ...presentation.eventMessage("event.engine.processMonsterTurn.158",[presentation.name(mon,state)],[""," SLAMS the ground — the hall shudders and stone rains down!"]) };
      events.push(ev); addLog(state, 'mech', ev);
      victims.forEach(v => {
        const saved = die(20) + mod((v.abilities || state.character.abilities).dex || 10) >= 13;
        let dmg = rollExpr('1d8').total + 2;
        if (saved) { dmg = Math.floor(dmg / 2); events.push({ type: 'save', narrate: false, ...presentation.eventMessage("event.engine.processMonsterTurn.159",[presentation.name(v,state)],[""," dives clear — half damage."]) }); }
        applyDamage(state, v, dmg, 'bludgeoning', events);
      });
      if (state.mode !== 'combat') return; // the slam may finish a dying hero
    }
  }
  if (mon.gimmick === 'fire_breath' && (mon.turnCount % 3) === 0) {
    const victims = state.entities.filter(e => (e.kind === 'player' || e.kind === 'ally') && e.alive !== false && manhattan(mon, e) <= 3);
    if (victims.length) {
      const ev = { type: 'fire_breath', narrate: true, ...presentation.eventMessage("event.engine.processMonsterTurn.160",[presentation.name(mon,state)],[""," inhales — a cone of ember-fire washes over the hall!"]) };
      events.push(ev); addLog(state, 'mech', ev);
      victims.forEach(v => {
        const saved = die(20) + mod((v.abilities || state.character.abilities).dex || 10) >= 13;
        let dmg = rollExpr('2d6').total;
        if (saved) { dmg = Math.floor(dmg / 2); events.push({ type: 'save', narrate: false, ...presentation.eventMessage("event.engine.processMonsterTurn.161",[presentation.name(v,state)],[""," rolls with the flames — half damage."]) }); }
        applyDamage(state, v, dmg, 'fire', events);
      });
      if (state.mode !== 'combat') return;
    }
  }
  const targets = state.entities.filter(e => (e.kind === 'player' || e.kind === 'ally') && e.alive !== false
    && !(e.kind === 'player' && e.conditions.includes('unconscious'))
    && !(e.kind === 'player' && hasBuff(e, 'invisible')));
  if (!targets.length) { addLog(state, 'mech', presentation.eventMessage("event.engine.processMonsterTurn.162",[presentation.name(mon,state)],[""," sniffs the air, bewildered — its prey has vanished."])); return; }
  if (!targets.length) return;
  const target = targets.sort((a, b) => manhattan(mon, a) - manhattan(mon, b))[0];
  if (mon.conditions.includes('prone')) mon.conditions = mon.conditions.filter(c => c !== 'prone');
  // bosses are bound to their post: they only engage intruders inside their court
  if (mon.boss && mon.sx !== undefined) {
    const spawn = { x: mon.sx, y: mon.sy };
    const intruderNear = manhattan(spawn, target) <= 7;
    const atEdge = manhattan(spawn, mon) >= 6;
    if (!intruderNear || (atEdge && manhattan(mon, target) > 1)) {
      addLog(state, 'mech', presentation.eventMessage("event.engine.processMonsterTurn.163",[presentation.name(mon,state)],[""," holds its post, bound to the relic it guards."]));
      return;
    }
  }
  const rangedAtk = (mon.attacks || []).find(a => a.ranged);
  const meleeAtk = (mon.attacks || []).find(a => !a.ranged) || (mon.attacks || [])[0];

  // strike now if in reach; otherwise close the distance and strike at the tail
  if (swingAt(state, mon, target, meleeAtk, rangedAtk, events, mon.desperate ? 2 : 1)) return;
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
  swingAt(state, mon, target, meleeAtk, rangedAtk, events, mon.desperate ? 2 : 1);
}

// One monster turn's attacks: melee when adjacent, ranged when in range and
// line-of-sight; desperate (cornered) bosses swing twice. Each swing re-checks
// liveness — the first can kill the victim or trigger the boss's own death.
function swingAt(state, mon, target, meleeAtk, rangedAtk, events, swings) {
  for (let i = 0; i < swings; i++) {
    if (!mon.alive || state.mode !== 'combat' || target.alive === false) return true;
    let swung = false;
    if (manhattan(mon, target) <= 1 && meleeAtk) { monsterAttack(state, mon, target, meleeAtk, events); swung = true; }
    else if (rangedAtk && manhattan(mon, target) <= rangedAtk.range / 5 && los(state, mon.x, mon.y, target.x, target.y)) {
      monsterAttack(state, mon, target, rangedAtk, events); swung = true;
    }
    if (!swung) return false;
  }
  return true;
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
      const wake = { type: 'death_save', narrate: true, ...presentation.eventMessage("event.engine.checkCombatEnd.164",[presentation.name(p,state)],[""," claws back to consciousness with 1 HP. The crypt grants no mercy twice."]) };
      events.push(wake); addLog(state, 'system', wake);
    }
    const ev = { type: 'combat_end', narrate: true, ...(foes.length === 0 ? presentation.eventMessage("event.engine.checkCombatEnd.165",[],["The last enemy falls. The crypt falls silent again."]) : presentation.eventMessage("event.engine.checkCombatEnd.166",[],["The creatures lose interest in your body and prowl back into the dark."])) };
    events.push(ev); addLog(state, 'mech', ev);
    unblockSceneDoors(state);
    const visible = computeVision(state); markDiscovered(state, visible);
    checkRoomEntry(state, events);
    progressScenes(state, events);
    return true;
  }
  return false;
}

// A companion that ends a fight inside a one-tile scene doorway can seal the hero
// in or out of a hollow — the choke is the door tile plus its open neighbours.
// Step the ally to the nearest free tile outside that choke so the story gate
// stays passable in both directions.
function unblockSceneDoors(state) {
  const choke = new Set();
  const doors = [];
  for (const scene of state.map.scenes || []) {
    const door = scene.doorId && state.objects.find(o => o.id === scene.doorId);
    if (!door) continue;
    doors.push(door);
    choke.add(door.x + ',' + door.y);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const x = door.x + dx, y = door.y + dy;
      if (x >= 0 && y >= 0 && x < state.map.width && y < state.map.height && !isBlocked(state, x, y)) choke.add(x + ',' + y);
    }
  }
  if (!doors.length) return;
  for (const ally of state.entities.filter(e => e.kind === 'ally' && e.alive !== false)) {
    if (!choke.has(ally.x + ',' + ally.y)) continue;
    const seen = new Set([ally.x + ',' + ally.y]);
    let frontier = [{ x: ally.x, y: ally.y }];
    for (let radius = 0; radius < 3 && frontier.length; radius++) {
      const next = [];
      for (const pos of frontier) {
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const x = pos.x + dx, y = pos.y + dy, k = x + ',' + y;
          if (x < 0 || y < 0 || x >= state.map.width || y >= state.map.height || seen.has(k)) continue;
          seen.add(k);
          if (isBlocked(state, x, y) || entityAt(state, x, y)) continue;
          if (!choke.has(k)) { ally.x = x; ally.y = y; return; }
          next.push({ x, y });
        }
      }
      frontier = next;
    }
  }
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
  addLog(state, 'mech', presentation.eventMessage("event.engine.awardXp.167",[amount,char.xp],["XP: +"," (total ",")."]));
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
      const asi = { type: 'asi', narrate: true, ...presentation.eventMessage("event.engine.levelUp.168",[primary.toUpperCase(),char.abilities[primary]],["Ability Score Improvement: "," rises to ","!"]) };
      events.push(asi); addLog(state, 'system', asi);
    }
  });
  const ev = { type: 'levelup', narrate: true, ...presentation.eventMessage("event.engine.levelUp.169",[presentation.name(char,state),newLevel,char.hpMax],["LEVEL UP! "," reaches level ","! Hit points rise to "," and new powers awaken."]), data: { level: newLevel } };
  events.push(ev); addLog(state, 'system', ev);
  // subclass arrives at level 3
  if (newLevel >= 3 && !char.subclass && cls.subclass) {
    char.subclass = cls.subclass.id;
    if (cls.subclass.hpBonus) {
      char.hpMax += cls.subclass.hpBonus;
      char.hp = char.hpMax;
      if (pe) { pe.hpMax = char.hpMax; pe.hp = char.hpMax; }
    }
    hint(state, 'subclass', presentation.eventMessage("event.engine.levelUp.170",[],["Bram the Scout"]), presentation.eventMessage("event.engine.levelUp.171",[],["Level three awakens your specialty — it is on your sheet now, and it has a button. Use it."]), events);
    const sub = { type: 'subclass', narrate: true, ...presentation.eventMessage("event.engine.levelUp.172",[presentation.name(char,state),presentation.name(cls.subclass,state),presentation.field(cls.subclass,"desc")],[""," embraces the ","! ",""]), data: { subclass: cls.subclass.id } };
    events.push(sub); addLog(state, 'system', sub);
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
    addLog(state, 'mech', presentation.eventMessage("event.engine.adjustTempHp.173",[(source ? presentation.eventMessage("event.engine.adjustTempHp.174",[source],["",": "]) : presentation.eventMessage("event.engine.adjustTempHp.175",[],[""])),(applied > 0 ? presentation.eventMessage("event.engine.adjustTempHp.176",[],["+"]) : presentation.eventMessage("event.engine.adjustTempHp.177",[],[""])),applied,char.hpMax],["","max HP ",""," this delve ("," max)."]));
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
  if (state.mode === 'combat') { events.push({ type: 'error', ...presentation.eventMessage("event.engine.shortRest.178",[],["You cannot rest while enemies are near!"]) }); return; }
  if ((state.flags && state.flags.restsBlocked) > 0) {
    blockRest(state, -1);
    const blocked = { type: 'rest_blocked', narrate: true, ...presentation.eventMessage("event.engine.shortRest.179",[],["You sit down, but your body refuses to settle — the brew still churns in your gut. This rest is lost."]) };
    events.push(blocked); addLog(state, 'system', blocked);
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
    addLog(state, 'mech', presentation.eventMessage("event.engine.shortRest.180",[r.total,mod(char.abilities.con),p.hp,p.hpMax],["Hit Die spent: ","+"," → ","/"," HP."]));
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
    addLog(state, 'mech', presentation.eventMessage("event.engine.shortRest.181",[],["Natural Recovery: one spell slot restored."]));
  }
  if (cls.id === 'wizard' && !char.uses.arcane_recovery_used) {
    const back = Math.ceil(char.level / 2);
    char.slots[1] = Math.min((char.slotsMax[1] || 0), (char.slots[1] || 0) + back);
    char.uses.arcane_recovery_used = true;
    addLog(state, 'mech', presentation.eventMessage("event.engine.shortRest.182",[back],["Arcane Recovery: "," level-1 spell slot(s) restored."]));
  }
  p.tempHp = 0;
  // Chef: a short break comes with a hot meal — proficiency-bonus temp HP for the party
  if ((char.unlockedFeats || []).includes('chef')) {
    const meal = char.profBonus || 2;
    p.tempHp = meal;
    const dinnerAlly = state.entities.find(e => e.kind === 'ally' && e.alive);
    if (dinnerAlly) dinnerAlly.tempHp = Math.max(dinnerAlly.tempHp || 0, meal);
  }
  const ev = { type: 'rest', narrate: true, ...presentation.eventMessage("event.engine.shortRest.183",[(spent ? presentation.eventMessage("event.engine.shortRest.184",[spent,(spent > 1 ? presentation.eventMessage("event.engine.shortRest.185",[],["s"]) : presentation.eventMessage("event.engine.shortRest.186",[],[""]))],[", spending "," Hit Die",""]) : presentation.eventMessage("event.engine.shortRest.187",[],[" (you were already unhurt)"])),p.hp,p.hpMax],["You take a short rest",". You are at ","/"," HP, and your short-rest abilities recover."]) };
  events.push(ev); addLog(state, 'system', ev);
}

function longRest(state, events) {
  const char = state.character;
  const p = playerEntity(state);
  if (state.mode === 'combat') { events.push({ type: 'error', ...presentation.eventMessage("event.engine.longRest.188",[],["You cannot rest while enemies are near!"]) }); return; }
  const camp = campfireOf(state);
  if (!camp || !(p.x === camp.x && p.y === camp.y)) { events.push({ type: 'error', ...presentation.eventMessage("event.engine.longRest.189",[],["You can only take a long rest at your campfire in the Entrance Hall."]) }); return; }
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
  const ally = state.entities.find(e => e.kind === 'ally' && e.alive);
  adjustLoyalty(state, 3, events, ally);
  // Musician: campfire tunes grant the party a blessing for the delve ahead
  const musician = (char.unlockedFeats || []).includes('musician');
  if (musician) {
    [p, ally].forEach((t) => {
      if (t) { t.buffs = t.buffs || []; t.buffs.push({ id: 'blessed', rounds: 480 }); }
    });
  }
  const ev = { type: 'rest', narrate: true, ...presentation.eventMessage("event.engine.longRest.190",[p.hpMax,(ally ? presentation.eventMessage("event.engine.longRest.191",[presentation.name(ally,state)],[" "," takes the second watch — companion morale rises."]) : presentation.eventMessage("event.engine.longRest.192",[],[""])),(musician ? presentation.eventMessage("event.engine.longRest.193",[],[" A campfire tune lends everyone a blessing (+1d4 on attacks)."]) : presentation.eventMessage("event.engine.longRest.194",[],[""]))],["You sleep by the campfire in watches. Dawn light finally bleeds through the crypt door — fully restored ("," HP), spells and abilities replenished.","",""]) };
  events.push(ev); addLog(state, 'system', ev);
}

// ------------------------------------------------------------- companions ----
// Companion morale, persisted per ally on the roster (char.companionLoyalty),
// 0-100 with a spawn default of 50. Drops when the ally goes down (-10), rises on
// a victorious delve (+5) and a shared campfire night (+3). Crossing a mood
// threshold surfaces a canned quip the DM may voice.
const LOYALTY_QUIPS = {
  high: [
    (name) => `${name} grins and loosens a blade: "Wherever you're going, I've got your back."`,
    (name) => `${name} hums an old marching tune — visibly in good spirits today.`
  ],
  low: [
    (name) => `${name} mutters: "I've bled more for you than this job pays… just saying."`,
    (name) => `${name} keeps glancing at the way out. Morale is slipping.`
  ]
};

function adjustLoyalty(state, delta, events, entity) {
  const ally = entity || state.entities.find(e => e.kind === 'ally' && e.alive);
  if (!ally) return null;
  const before = ally.loyalty == null ? 50 : ally.loyalty;
  const after = Math.max(0, Math.min(100, before + delta));
  ally.loyalty = after;
  if (events && ((before < 80 && after >= 80) || (before > 30 && after <= 30))) {
    const bank = after >= 80 ? LOYALTY_QUIPS.high : LOYALTY_QUIPS.low;
    const index=Math.floor(rand() * bank.length);
    const line = bank[index](ally.name);
    const ev = { type: 'companion', narrate: true, text: line,messageKey:'content.loyalty.'+(after>=80?'high':'low')+index,params:{name:presentation.name(ally,state)} };
    events.push(ev); addLog(state, 'dm_canned', ev);
  }
  offerPersonalQuest(state, ally, events);
  return after;
}

// ---- companion personal quests (loyalty-gated story beats, one thread at a time) ----
function offerPersonalQuest(state, ally, events) {
  const def = companions.PERSONAL_QUESTS[ally.allyId];
  if (!def || !events) return;
  const char = state.character;
  char.companionQuests = char.companionQuests || {};
  if (char.companionQuests[ally.allyId]) return;                       // already offered or done
  if (state.companionQuest) return;                                    // one personal thread at a time
  if ((ally.loyalty == null ? 50 : ally.loyalty) < def.offerAt) return;
  state.companionQuest = { allyId: ally.allyId, name: def.name, target: def.target, targetName: def.targetName, need: def.need, count: 0 };
  char.companionQuests[ally.allyId] = 'offered';
  const ev = { type: 'quest_offer', narrate: true, ...presentation.eventMessage("event.engine.offerPersonalQuest.195",[presentation.name(def,state),presentation.field(def,"offer")],["PERSONAL QUEST — ",": ",""]) };
  events.push(ev); addLog(state, 'system', ev);
}

function progressPersonalQuest(state, mon, events) {
  const q = state.companionQuest;
  if (!q || q.target !== mon.monsterId) return;
  q.count++;
  const def = companions.PERSONAL_QUESTS[q.allyId];
  if (q.count < def.need) {
    events.push({ type: 'info', narrate: false, ...presentation.eventMessage("event.engine.progressPersonalQuest.196",[presentation.name(def,state),q.count,def.need,presentation.field(def,"targetName")],["",": ","/"," ","s"]) });
    return;
  }
  state.companionQuest = null;
  const char = state.character;
  char.companionQuests[q.allyId] = 'done';
  char.gold += def.reward.gold;
  const gift = affixes.rollMagicItem(def.reward.itemRarity, { category: def.reward.itemCategory });
  char.inventory = char.inventory || [];
  char.inventory.push(gift);
  const ally = state.entities.find(e => e.kind === 'ally' && e.allyId === q.allyId);
  if (ally) adjustLoyalty(state, def.reward.loyalty, events, ally);
  const ev = { type: 'quest_done', narrate: true, ...presentation.eventMessage("event.engine.progressPersonalQuest.197",[presentation.name(def,state),presentation.field(def,"done"),def.reward.gold,def.reward.loyalty,presentation.name(gift,state)],["PERSONAL QUEST COMPLETE — ","! "," (+"," gp, +"," loyalty, ",")"]) };
  events.push(ev); addLog(state, 'system', ev);
}

// ---------------------------------------------------------------- checks & interaction ----
function skillCheck(state, skill, dc, opts = {}) {
  const char = state.character;
  const p = playerEntity(state);
  let bonus = opts.bonus || 0, bonusTxt = opts.bonusTxt || '';
  const guidance = getBuff(p, 'guidance');
  if (guidance) { bonus += die(4); bonusTxt += ' +1d4 guidance'; removeBuff(p, 'guidance'); }
  const insp = getBuff(p, 'inspiration');
  if (insp) { bonus += die(insp.dice || 6); bonusTxt += ` +1d${insp.dice || 6} inspiration`; removeBuff(p, 'inspiration'); }
  let roll = d20({ adv: (skill === 'stealth' && char.subclass === 'thief') || !!opts.adv, reroll1: char.rerollNat1 });
  let baseMod = skillMod(char, skill);
  if (opts.toolProf && !char.skills.includes(skill)) {
    baseMod += char.profBonus;
    bonusTxt += ` +${char.profBonus} tools`;
  }
  let total = roll.natural + baseMod + bonus;
  if (char.subclass === 'thief' && char.className === 'rogue' && char.level >= 11 && char.skills.includes(skill) && total < 10 + baseMod + bonus) { total = 10 + baseMod + bonus; }
  let rerolled = false;
  if (total < dc && (char.uses.lucky_reroll || 0) > 0) {
    char.uses.lucky_reroll--;
    roll = d20({ reroll1: char.rerollNat1 });
    total = roll.natural + baseMod + bonus;
    rerolled = true;
  }
  return {
    success: total >= dc, total, natural: roll.natural,
    modifier: baseMod + bonus,
    detail: `d20 ${roll.natural}+${baseMod}${bonusTxt} = ${total} vs DC ${dc}${rerolled ? ' (Heroic reroll)' : ''}`
  };
}

function lootChest(state, chest, events) {
  if (chest.looted) { events.push({ type: 'info', ...presentation.eventMessage("event.engine.lootChest.198",[],["The chest is already empty."]) }); return; }
  if (chest.locked && !chest.unlocked) {
    events.push({ type: 'info', ...presentation.eventMessage("event.engine.lootChest.199",[presentation.name(chest,state)],[""," is locked shut. Pick the lock with thieves' tools or force it open."]) });
    return;
  }
  chest.looted = true;
  const char = state.character;
  const goldRoll = typeof chest.loot.gold === 'string' ? rollExpr(chest.loot.gold).total : (chest.loot.gold || 0);
  char.gold += goldRoll;
  if (!state.stats) state.stats = { dmgDealt: 0, dmgTaken: 0, kills: 0, goldFound: 0, rounds: 0 };
  state.stats.goldFound += goldRoll;
  const parts = [], displayParts = [];
  for (let i = 0; i < (chest.loot.potions || 0); i++) addItemToInventory(char, 'potion_healing');
  (chest.loot.items || []).forEach(it => {
    if (it.chance !== undefined && rand() >= it.chance) return;
    addItemToInventory(char, it.id, it.qty || 1); parts.push(itemName(it.id));
    displayParts.push(presentation.name({itemId:it.id,name:itemName(it.id)},state));
  });
  applyPickupEffects(state, chest.loot.items || [], events);
  checkQuest(state, 'recover', chest.id, events);
  if (chest.loot.gold >= 20) hint(state, 'shop', presentation.eventMessage("event.engine.lootChest.200",[],["Bram the Scout"]), presentation.eventMessage("event.engine.lootChest.201",[],["Coin is no good to a corpse. Marla topside and Perra down in the vault both trade — potions, kits, even silver blades."]), events);
  const ev = {
    type: 'loot', narrate: true,
    ...presentation.eventMessage("event.engine.lootChest.202",[presentation.eventMessage("event.engine.lootChest.203",[p_name(state),presentation.name(chest,state),goldRoll],[""," pries open the ",": "," gold pieces"]),presentation.eventMessage("event.engine.lootChest.204",[(chest.loot.potions ? presentation.eventMessage("event.engine.lootChest.205",[chest.loot.potions,(chest.loot.potions > 1 ? presentation.eventMessage("event.engine.lootChest.206",[],["s"]) : presentation.eventMessage("event.engine.lootChest.207",[],[""]))],[", "," Potion"," of Healing"]) : presentation.eventMessage("event.engine.lootChest.208",[],[""]))],["",""]),presentation.eventMessage("event.engine.lootChest.209",[(parts.length ? presentation.eventMessage("event.engine.lootChest.210",[{parts:displayParts,separator:', ',fallback:parts.join(', ')}],[" — and ","!"]) : presentation.eventMessage("event.engine.lootChest.211",[],["!"]))],["",""]),presentation.eventMessage("event.engine.lootChest.212",[(parts.length ? presentation.eventMessage("event.engine.lootChest.213",[],[" A treasure of real power."]) : presentation.eventMessage("event.engine.lootChest.214",[],[""]))],["",""])],["","","","",""])
  };
  events.push(ev); addLog(state, 'mech', ev);
}

// Roll a slain monster's loot table: gold dice + chance-based items + guaranteed rarity drops for Elites & Bosses
function rollLoot(state, mon, events) {
  const def = contentContext.monster(state, mon.monsterId);
  const char = state.character;
  const parts = [], displayParts = [];
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
    displayParts.push({key:'content.loot.gold',params:{count:g}});
  }

  const gained = [];
  if (def && def.loot && def.loot.items) {
    def.loot.items.forEach(it => {
      if (rand() < (it.chance === undefined ? 1 : it.chance)) {
        const qty = it.qty || 1;
        addItemToInventory(char, it.id, qty);
        parts.push(itemName(it.id));
        displayParts.push(presentation.name({itemId:it.id,name:itemName(it.id)},state));
        gained.push(it);
      }
    });
  }

  // Rarity & Affix loot rolls:
  if (mon.isElite) {
    // Elite Champion: 100% guaranteed Magic (75%) or Rare (25%) item drop!
    const rarity = rand() < 0.25 ? 'rare' : 'magic';
    const magicItem = affixes.rollMagicItem(rarity);
    addItemToInventory(char, magicItem);
    parts.push(`[${rarity === 'rare' ? '稀有 🟣' : '魔法 🔵'}] ${magicItem.name}`);
    displayParts.push({key:'content.loot.item',params:{quality:presentation.term('quality',rarity),name:presentation.name(magicItem,state)}});
    gained.push(magicItem);
    char.essence = (char.essence || 0) + forgeMod.KILL_ESSENCE.elite;
    parts.push(`${forgeMod.KILL_ESSENCE.elite} 余烬精华`);
    displayParts.push({key:'content.loot.essence',params:{count:forgeMod.KILL_ESSENCE.elite}});
    events.push({
      type: 'elite_loot',
      narrate: true,
      ...presentation.eventMessage("event.engine.rollLoot.215",[presentation.name(mon,state),presentation.name(magicItem,state),presentation.field(magicItem,"desc")],["🏆 ELITE SLAIN: "," falls! Discovered "," (",")!"])
    });
  } else if (mon.boss) {
    // Boss Monster: 100% guaranteed Rare (75%) or Legendary (25%) item drop!
    const rarity = rand() < 0.25 ? 'legendary' : 'rare';
    const magicItem = affixes.rollMagicItem(rarity);
    addItemToInventory(char, magicItem);
    parts.push(`[${rarity === 'legendary' ? '传奇 🟠' : '稀有 🟣'}] ${magicItem.name}`);
    displayParts.push({key:'content.loot.item',params:{quality:presentation.term('quality',rarity),name:presentation.name(magicItem,state)}});
    gained.push(magicItem);
    char.essence = (char.essence || 0) + forgeMod.KILL_ESSENCE.boss;
    parts.push(`${forgeMod.KILL_ESSENCE.boss} 余烬精华`);
    displayParts.push({key:'content.loot.essence',params:{count:forgeMod.KILL_ESSENCE.boss}});
    events.push({
      type: 'boss_loot',
      narrate: true,
      ...presentation.eventMessage("event.engine.rollLoot.216",[presentation.name(mon,state),presentation.name(magicItem,state),presentation.field(magicItem,"desc")],["👑 BOSS VANQUISHED: "," slain! Bestowed "," (",")!"])
    });
  } else if (rand() < 0.05) {
    // Normal monster: 5% chance of rolling a Magic item
    const magicItem = affixes.rollMagicItem('magic');
    addItemToInventory(char, magicItem);
    parts.push(`[魔法 🔵] ${magicItem.name}`);
    displayParts.push({key:'content.loot.item',params:{quality:presentation.term('quality','magic'),name:presentation.name(magicItem,state)}});
    gained.push(magicItem);
  }

  applyPickupEffects(state, gained, events);
  if (parts.length) {
    const ev = { type: 'loot', narrate: true, ...presentation.eventMessage("event.engine.rollLoot.217",[presentation.name(mon,state),{parts:displayParts,separator:', ',fallback:parts.join(', ')}],[""," drops ","!"]) };
    events.push(ev); addLog(state, 'mech', ev);
  }
}

// One-time effects when magic trinkets enter the pack (e.g. Amulet of Vigor: +5 max HP)
function applyPickupEffects(state, items, events) {
  if (!items || !items.length) return;
  const char = state.character;
  const pe = playerEntity(state);
  items.forEach(it => {
    const def = contentContext.gear(state, it.id);
    if (def && def.hpBonus) {
      char.hpMax += def.hpBonus * (it.qty || 1);
      if (pe) { pe.hpMax = char.hpMax; pe.hp = Math.min(pe.hpMax, pe.hp + def.hpBonus * (it.qty || 1)); }
      const ev = { type: 'magic_item', narrate: true, ...presentation.eventMessage("event.engine.applyPickupEffects.218",[presentation.name(def,state),def.hpBonus * (it.qty || 1)],["The "," settles against your chest and thrums — you feel hardier! (+"," max HP)"]) };
      events.push(ev); addLog(state, 'mech', ev);
    }
  });
}

function alertForcedNoise(state, events) {
  const p = playerEntity(state);
  let woke = 0;
  aliveMonsters(state).forEach(m => { if (manhattan(m, p) <= 10) { m.aware = true; woke++; } });
  if (woke) addLog(state, 'mech', presentation.eventMessage("event.engine.alertForcedNoise.219",[],["Something stirs in the dark..."]));
}

function interactDoor(state, door, events) {
  const p = playerEntity(state);
  if (manhattan(p, door) > 1) { events.push({ type: 'error', ...presentation.eventMessage("event.engine.interactDoor.220",[],["You are not close enough to the door."]) }); return; }
  if (sceneDoorBlocked(state, door.id)) { events.push({ type: 'error', ...presentation.eventMessage("event.engine.interactDoor.221",[],["先和守门人交谈，选择如何通过这道哨门。"]) }); return; }
  if (door.open) { events.push({ type: 'info', ...presentation.eventMessage("event.engine.interactDoor.222",[],["The door is already open."]) }); return; }
  if (door.locked && !door.unlocked) {
    const char = state.character;
    const hasTools = char.inventory.some(i => i.itemId === 'thieves_tools');
    let check = skillCheck(state, 'sleight_of_hand', door.lockDc || 13);
    if (char.className === 'rogue' && hasTools && !check.success) check = skillCheck(state, 'sleight_of_hand', door.lockDc || 13);
    if (check.success && hasTools) {
      door.unlocked = true; door.open = true;
      const ev = { type: 'door', narrate: true, ...presentation.eventMessage("event.engine.interactDoor.223",[presentation.name(p,state),check.detail,presentation.name(door,state)],[""," works the lock with thieves' tools (",") — the "," swings open."]) };
      events.push(ev); addLog(state, 'mech', ev);
    } else {
      const force = skillCheck(state, 'athletics', door.forceDc || 15);
      if (force.success) {
        door.unlocked = true; door.open = true; door.forced = true;
        const ev = { type: 'door', narrate: true, ...presentation.eventMessage("event.engine.interactDoor.224",[presentation.name(p,state),presentation.name(door,state),force.detail],["The lock defeats your picks, so "," slams into the "," until it bursts open! (Athletics ",") The crash echoes down the corridors..."]) };
        events.push(ev); addLog(state, 'mech', ev);
        alertForcedNoise(state, events);
      } else {
        const ev = { type: 'door_fail', narrate: true, ...presentation.eventMessage("event.engine.interactDoor.225",[presentation.name(door,state),check.detail,force.detail],["The "," holds fast — picks slip (SoH ","), shoulders ache (Ath ","). You can try again."]) };
        events.push(ev); addLog(state, 'mech', ev);
      }
    }
    return;
  }
  door.open = true;
  const ev = { type: 'door', narrate: true, ...presentation.eventMessage("event.engine.interactDoor.226",[p_name(state),presentation.name(door,state)],[""," pushes the "," open. It groans on rusted hinges."]) };
  events.push(ev); addLog(state, 'mech', ev);
}

function interactObject(state, objId, events) {
  const obj = state.objects.find(o => o.id === objId);
  if (!obj) { events.push({ type: 'error', ...presentation.eventMessage("event.engine.interactObject.227",[],["Nothing there."]) }); return; }
  const p = playerEntity(state);
  if (manhattan(p, obj) > 1) { events.push({ type: 'error', ...presentation.eventMessage("event.engine.interactObject.228",[],["Move closer first."]) }); return; }
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
    if (obj.exploded) { events.push({ type: 'info', ...presentation.eventMessage("event.engine.interactObject.229",[],["Nothing remains of the barrel but charred wood and soot."]) }); return; }
    addLog(state, 'mech', presentation.eventMessage("event.engine.interactObject.230",[presentation.name(p,state)],[""," strikes the explosive oil barrel at point-blank range!"]));
    detonateBarrel(state, obj, events, `${p.name}'s strike`);
    return;
  }
  if (obj.type === 'spores') {
    if (obj.burst) { events.push({ type: 'info', ...presentation.eventMessage("event.engine.interactObject.231",[],["The spore pods have withered into lifeless fungal husks."]) }); return; }
    addLog(state, 'mech', presentation.eventMessage("event.engine.interactObject.232",[presentation.name(p,state)],[""," disturbs the toxic spore pods!"]));
    triggerSpores(state, obj, events);
    return;
  }
  if (obj.type === 'hazard') {
    events.push({ type: 'info', ...presentation.eventMessage("event.engine.interactObject.233",[presentation.name(obj,state),obj.desc || 'A caustic hazard that burns anything stepping into it.'],["",": ",""]) });
    return;
  }
  if (obj.type === 'npcMarker') {
    const visibleScenes = sceneViews(state).filter(s => s.npcId === obj.npcId);
    const scene = visibleScenes.find(s => s.phase !== 'resolved') || visibleScenes.at(-1);
    const line = sceneMemory(state, obj.npcId) || (state.map.npcs[obj.npcId].canned || ['...'])[0];
    const memoryDisplay=sceneMemoryDisplay(state, obj.npcId);
    const npc=state.map.npcs[obj.npcId];
    const lineDisplay=memoryDisplay || {localized:{en:presentation.textFor(npc,'canned','en')?.[0] || line,'zh-CN':presentation.textFor(npc,'canned','zh-CN')?.[0] || line},fallback:line};
    const ev = { type: 'chat_open', narrate: false, ...presentation.eventMessage("event.engine.interactObject.234",[presentation.name(obj,state),lineDisplay],["",": \"","\""]), data: { npcId: obj.npcId, name: obj.name, sceneId: scene?.id } };
    addLog(state, 'npc', ev);
    events.push(ev);
    return;
  }
  if (obj.id === 'campfire') {
    const ev = { type: 'info', narrate: true, ...presentation.eventMessage("event.engine.interactObject.235",[],["The campfire crackles warmly. Take a Long Rest here to recover fully."]) };
    events.push(ev); return;
  }
  if (obj.id === 'altar') {
    const char = state.character;
    const skill = char.skills.includes('religion') ? 'religion' : (char.skills.includes('arcana') ? 'arcana' : (mod(char.abilities.wis) >= mod(char.abilities.int) ? 'religion' : 'arcana'));
    const check = skillCheck(state, skill, 13);
    if (state.flags.altarBlessed) { events.push({ type: 'info', ...presentation.eventMessage("event.engine.interactObject.236",[],["The blessing already rests upon you."]) }); return; }
    if (check.success) {
      state.flags.altarBlessed = true;
      addBuff(p, { id: 'altar_blessed', rounds: 9999 });
      const ev = { type: 'blessing', narrate: true, ...presentation.eventMessage("event.engine.interactObject.237",[presentation.name(p,state),{key:'content.skill.'+skill,fallback:cap(skill)},check.detail],[""," offers the old god a proper prayer ("," ","). The altar's cold flame warms — a blessing settles on you: +1 to attack rolls and saves until your next Long Rest."]) };
      events.push(ev); addLog(state, 'mech', ev);
    } else {
      const dmg = rollExpr('1d6').total;
      const ev = { type: 'altar_fail', narrate: true, ...presentation.eventMessage("event.engine.interactObject.238",[presentation.name(p,state),{key:'content.skill.'+skill,fallback:cap(skill)},check.detail,dmg],[""," fumbles the rite ("," ",") — the altar's cold flame bites for "," necrotic damage!"]) };
      events.push(ev); addLog(state, 'mech', ev);
      applyDamage(state, p, dmg, 'necrotic', events);
      checkPlayerDeath(state, events);
    }
    return;
  }
  if (obj.id === 'relic') {
    if (state.flags.hasRelic) { events.push({ type: 'info', ...presentation.eventMessage("event.engine.interactObject.239",[],["You already carry the Relic."]) }); return; }
    const ogre = state.entities.find(e => e.monsterId === 'ogre' && e.alive);
    if (ogre && state.mode !== 'combat') {
      const check = skillCheck(state, 'sleight_of_hand', 15);
      if (check.success) {
        state.flags.hasRelic = true; obj.taken = true;
        const ev = { type: 'relic', narrate: true, ...presentation.eventMessage("event.engine.interactObject.240",[presentation.name(p,state),check.detail],["As the ogre snores, "," lifts the Relic of the Sunless Crypt with a thief's grace (SoH ","). Now — run!"]) };
        events.push(ev); addLog(state, 'mech', ev);
      } else {
        const ev = { type: 'relic_fail', narrate: true, ...presentation.eventMessage("event.engine.interactObject.241",[presentation.name(p,state),check.detail],[""," grabs for the Relic — and fumbles (SoH ",")! Grubnik's eyes snap open with a roar!"]) };
        events.push(ev); addLog(state, 'mech', ev);
        ogre.aware = true;
        const nearby = aliveMonsters(state).filter(m => manhattan(m, p) <= 6).map(m => m.id);
        startCombat(state, [ogre.id, ...nearby], events);
      }
      return;
    }
    state.flags.hasRelic = true; obj.taken = true;
    const ev = { type: 'relic', narrate: true, ...presentation.eventMessage("event.engine.interactObject.242",[p_name(state)],[""," seizes the Relic of the Sunless Crypt! Its cold light pulses like a heartbeat. Return to the campfire to escape with your prize!"]) };
    events.push(ev); addLog(state, 'mech', ev);
    return;
  }
  events.push({ type: 'info', ...presentation.eventMessage("event.engine.interactObject.243",[presentation.name(obj,state),obj.desc || 'Nothing unusual.'],["",": ",""]) });
}

// ---------------------------------------------------------------- road encounters ----
const ROAD_ENCOUNTERS = {
  peddler: {
    id: 'peddler',
    icon: '🧳',
    title: 'Garrick the Wandering Peddler',
    blurb: '"Ho there, brave traveler! Before you delve into the damp tombs, consider a draught or charm from my pack. Genuine goods, modest coin!"',
    desc: 'A jovial halfling merchant with an overloaded pack mule stands by the sun-dappled roadside.',
    wares: [
      { id: 'potion_healing', name: 'Potion of Healing', price: 20, desc: 'Heals 2d4+2 hit points' , localized:{"en":{"name":"Potion of Healing","desc":"Heals 2d4+2 hit points"},"zh-CN":{"name":"治疗药水","desc":"恢复 2d4+2 HP"}}},
      { id: 'potion_greater', name: 'Potion of Greater Healing', price: 45, desc: 'Heals 4d4+4 hit points' , localized:{"en":{"name":"Potion of Greater Healing","desc":"Heals 4d4+4 hit points"},"zh-CN":{"name":"强效治疗药水","desc":"恢复 4d4+4 HP"}}},
      { id: 'cloak_protection', name: 'Cloak of Protection', price: 65, desc: '+1 bonus to Armor Class' , localized:{"en":{"name":"Cloak of Protection","desc":"+1 bonus to Armor Class"},"zh-CN":{"name":"防护披风","desc":"AC +1"}}}
    ],
    options: ['leave']
  , localized:{"en":{"title":"Garrick the Wandering Peddler","blurb":"\"Ho there, brave traveler! Before you delve into the damp tombs, consider a draught or charm from my pack. Genuine goods, modest coin!\"","desc":"A jovial halfling merchant with an overloaded pack mule stands by the sun-dappled roadside."},"zh-CN":{"title":"流浪行商加里克","blurb":"“勇敢的旅人！进入潮湿墓穴前，看看我的药剂和护符。真货，便宜！”","desc":"愉快的半身人商人牵着满载的骡子站在斑驳阳光下。"}}},
  ambush: {
    id: 'ambush',
    icon: '🏹',
    title: 'Roadside Goblin Ambush',
    blurb: '"Drop the coin purse, tall-legs, or we skewer your knees!"',
    desc: 'Three snarling goblin brigands leap from the roadside brush, notched shortbows aimed right at your chest.',
    options: ['fight', 'bribe', 'sneak']
  , localized:{"en":{"title":"Roadside Goblin Ambush","blurb":"\"Drop the coin purse, tall-legs, or we skewer your knees!\"","desc":"Three snarling goblin brigands leap from the roadside brush, notched shortbows aimed right at your chest."},"zh-CN":{"title":"路边地精伏击","blurb":"“交出钱袋，长腿的，不然射穿你的膝盖！”","desc":"三个凶狠的地精从灌木跳出，搭好的短弓直指你的胸口。"}}},
  shrine: {
    id: 'shrine',
    icon: '⛩️',
    title: 'Shrine of the Dawnmother',
    blurb: '"May the golden rays illuminate your descent into the shadowed depths."',
    desc: 'An ancient carved marble waypoint at the crossroads bathed in radiant dawnlight. Soft hymns seem to whisper in the gentle breeze.',
    options: ['pray', 'offer', 'proceed']
  , localized:{"en":{"title":"Shrine of the Dawnmother","blurb":"\"May the golden rays illuminate your descent into the shadowed depths.\"","desc":"An ancient carved marble waypoint at the crossroads bathed in radiant dawnlight. Soft hymns seem to whisper in the gentle breeze."},"zh-CN":{"title":"黎明母亲神殿","blurb":"“愿金色光芒照亮你通往幽暗深处的路。”","desc":"路口的古老大理石神龛沐浴晨光，微风仿佛低吟圣歌。"}}}
};

const LEGACY_ROAD_OUTCOME_TO_CHOICE = {
  ambush_win: 'fight',
  ambush_wound: 'fight',
  bribe: 'bribe',
  sneak_wound: 'sneak',
  sneak_win: 'sneak',
  shrine_pray: 'pray',
  shrine_offer: 'offer',
  shrine_proceed: 'proceed',
  peddler_leave: 'leave'
};

// Client-facing view of a stored road-encounter instance. The template (title, blurb,
// options, wares) always comes from the engine's own tables so clients never keep a
// second copy; instanceId + resolution state let a client restore an in-flight choice
// (refresh / failed start) without re-rolling anything. For ambushes the view also
// carries the engine-computed check modifiers (the same figures resolveRoadEncounter
// rolls with) so the modal never previews a number the server won't use.
function roadEncounterView(enc, char) {
  if (!enc) return null;
  const tpl = ROAD_ENCOUNTERS[enc.id];
  if (!tpl) return null;
  let checks = null;
  if (enc.id === 'ambush' && char) {
    const profBonus = char.profBonus || 2;
    const strMod = mod((char.abilities || {}).str), dexMod = mod((char.abilities || {}).dex);
    checks = {
      fight: { dc: 11, modifier: Math.max(strMod, dexMod) + profBonus },
      sneak: { dc: 12, modifier: dexMod + ((char.skills || []).includes('stealth') ? profBonus : 0) }
    };
  }
  return {
    ...tpl,
    instanceId: enc.instanceId,
    resolved: !!enc.resolved,
    resolvedChoice: enc.resolvedChoice || null,
    result: enc.result || null,
    checks
  };
}

function triggerRoadEncounter(char, options = {}) {
  // A live instance is authoritative: unresolved (choice still owed) or resolved but not
  // yet consumed by a delve start. Return it untouched — no re-roll, no instanceId
  // overwrite, no RNG consumption at all (T7a).
  if (char.currentRoadEncounter) return roadEncounterView(char.currentRoadEncounter, char);
  beginRng(char);
  try {
    const force = !!options.force;
    if (!force && rand() >= 0.35) {
      return null;
    }
    const encKeys = ['peddler', 'ambush', 'shrine'];
    const chosenKey = encKeys[Math.floor(rand() * encKeys.length)];
    const encTemplate = ROAD_ENCOUNTERS[chosenKey];
    const instanceId = 're_' + Date.now().toString(36) + '_' + Math.floor(rand() * 1000000).toString(36);
    char.currentRoadEncounter = {
      id: encTemplate.id,
      instanceId,
      options: encTemplate.options.slice(),
      resolved: false,
      resolvedChoice: null,
      result: null
    };
    return roadEncounterView(char.currentRoadEncounter, char);
  } finally {
    persistRng(char);
  }
}

function resolveRoadEncounter(char, rawChoice, options = {}) {
  const enc = char.currentRoadEncounter;
  if (!enc) {
    throw new Error('No active road encounter.');
  }
  if (options.encounterId && enc.instanceId && options.encounterId !== enc.instanceId) {
    throw new Error('Encounter instance mismatch.');
  }

  let choice = rawChoice;
  if (!enc.options.includes(choice) && LEGACY_ROAD_OUTCOME_TO_CHOICE[choice]) {
    choice = LEGACY_ROAD_OUTCOME_TO_CHOICE[choice];
  }

  // Idempotent duplicate choice handling: prevents duplicate awards
  if (enc.resolved) {
    if (enc.resolvedChoice === choice && enc.result) {
      return { ...enc.result, alreadyResolved: true };
    }
    throw new Error('Encounter already resolved.');
  }

  // Check if choice is valid for current encounter
  if (!enc.options.includes(choice)) {
    throw new Error(`Option '${choice}' is not valid for ${enc.id} encounter.`);
  }

  beginRng(char);
  try {
    let result = null;
    const strMod = mod(char.abilities?.str);
    const dexMod = mod(char.abilities?.dex);
    const profBonus = char.profBonus || 2;

    if (enc.id === 'ambush') {
      if (choice === 'fight') {
        const fightMod = Math.max(strMod, dexMod) + profBonus;
        const natural = die(20);
        const total = natural + fightMod;
        const dc = 11;
        const success = total >= dc;
        if (success) {
          char.gold = (char.gold || 0) + 25;
          char.xp = (char.xp || 0) + 50;
          result = {
            natural, modifier: fightMod, total, dc, success: true, outcome: 'ambush_win',
            ...presentation.eventMessage("event.engine.resolveRoadEncounter.244",[natural,fightMod,total,dc],["Victory! (Roll ","+"," = "," vs DC ",")\nYou strike down their leader and send the survivors running into the dark trees. You loot +25 GP from their pouches and earn +50 XP!"])
          };
        } else {
          char.hp = Math.max(1, (char.hp || char.hpMax || 10) - 3);
          result = {
            natural, modifier: fightMod, total, dc, success: false, outcome: 'ambush_wound',
            ...presentation.eventMessage("event.engine.resolveRoadEncounter.245",[natural,fightMod,total,dc,char.hp,char.hpMax || 10],["Staggered! (Roll ","+"," = "," vs DC ",")\nThe goblins shoot a volley as they scatter! You take a stinging arrow graze (-3 HP, current HP: ","/",") before driving them off."])
          };
        }
      } else if (choice === 'bribe') {
        if ((char.gold || 0) < 10) {
          throw new Error('Insufficient gold for bribe (need 10 GP).');
        }
        char.gold = Math.max(0, (char.gold || 0) - 10);
        result = {
          natural: null, modifier: null, total: null, dc: null, success: true, outcome: 'bribe',
          ...presentation.eventMessage("event.engine.resolveRoadEncounter.246",[],["Coins Scattered! (-10 GP)\nThe goblins eagerly scramble in the mud for the glittering coins, squabbling amongst themselves as you slip safely past."])
        };
      } else if (choice === 'sneak') {
        const stealthProf = (char.skills || []).includes('stealth');
        const stealthMod = dexMod + (stealthProf ? profBonus : 0);
        const natural = die(20);
        const total = natural + stealthMod;
        const dc = 12;
        const success = total >= dc;
        if (success) {
          result = {
            natural, modifier: stealthMod, total, dc, success: true, outcome: 'sneak_win',
            ...presentation.eventMessage("event.engine.resolveRoadEncounter.247",[natural,stealthMod,total,dc],["Unseen! (Roll ","+"," = "," vs DC ",")\nYou slide through the tall ferns like a phantom. The goblins stare down an empty road while you slip quietly into the dungeon entrance!"])
          };
        } else {
          char.hp = Math.max(1, (char.hp || char.hpMax || 10) - 2);
          result = {
            natural, modifier: stealthMod, total, dc, success: false, outcome: 'sneak_wound',
            ...presentation.eventMessage("event.engine.resolveRoadEncounter.248",[natural,stealthMod,total,dc,char.hp,char.hpMax || 10],["Spotted! (Roll ","+"," = "," vs DC ",")\nA twig snaps loudly! A goblin shouts and looses an arrow that clips your shoulder (-2 HP, current HP: ","/",") as you dash for cover."])
          };
        }
      }
    } else if (enc.id === 'shrine') {
      if (choice === 'pray') {
        char.tempHp = (char.tempHp || 0) + 5;
        char.pendingRoadBoons = char.pendingRoadBoons || [];
        char.pendingRoadBoons.push('shrine_temp_hp');
        result = {
          natural: null, modifier: null, total: null, dc: null, success: true, outcome: 'shrine_pray',
          ...presentation.eventMessage("event.engine.resolveRoadEncounter.249",[],["Dawnmother's Vitality!\nA soothing solar warmth fills your chest. You feel invigorated and ready for battle. (+5 Temp HP added!)"])
        };
      } else if (choice === 'offer') {
        if ((char.gold || 0) < 5) {
          throw new Error('Insufficient gold for offering (need 5 GP).');
        }
        char.gold = Math.max(0, (char.gold || 0) - 5);
        char.blessed = true;
        char.pendingRoadBoons = char.pendingRoadBoons || [];
        char.pendingRoadBoons.push('shrine_blessed');
        result = {
          natural: null, modifier: null, total: null, dc: null, success: true, outcome: 'shrine_offer',
          ...presentation.eventMessage("event.engine.resolveRoadEncounter.250",[],["Divine Blessing Bestowed! (-5 GP)\nThe silver and gold coins gleam in the sacred bowl. A radiant aura settles upon your brow (Heroic Inspiration granted for the delve ahead!)."])
        };
      } else if (choice === 'proceed') {
        result = {
          natural: null, modifier: null, total: null, dc: null, success: true, outcome: 'shrine_proceed',
          ...presentation.eventMessage("event.engine.resolveRoadEncounter.251",[],["Steady March.\nYou salute the sun crest and march purposefully toward the waiting dungeon."])
        };
      }
    } else if (enc.id === 'peddler') {
      if (choice === 'leave') {
        result = {
          natural: null, modifier: null, total: null, dc: null, success: true, outcome: 'peddler_leave',
          ...presentation.eventMessage("event.engine.resolveRoadEncounter.252",[],["Safe travels, adventurer!\nYou bid Garrick farewell and head toward the dungeon."])
        };
      }
    }

    if (!result) {
      throw new Error(`Unhandled road encounter choice '${choice}'.`);
    }

    enc.resolved = true;
    enc.resolvedChoice = choice;
    enc.result = result;
    return result;
  } finally {
    persistRng(char);
  }
}

// T6's small authored encounter protocol. This stays inside the referee engine;
// authored JSON selects two fixed effects, never JavaScript or arbitrary state writes.
function sceneKey(state, scene) { return state.mapId + ':' + scene.id; }
function storyCompanionId(state) { return state.map.story?.companion || null; }
// A story scene speaks either through a map NPC or (companion: true) through the
// real ally entity named by map.story.companion — never a lookalike NPC.
function sceneSpeakerId(state, scene) { return scene.companion ? storyCompanionId(state) : scene.npcId; }
function sceneSpeaker(state, scene) {
  if (scene.companion) {
    const id = storyCompanionId(state);
    return id ? state.entities.find(e => e.kind === 'ally' && e.allyId === id) : null;
  }
  return state.entities.find(e => e.kind === 'npc' && e.npcId === scene.npcId);
}
function sceneEntry(state, scene) { return state.encounters?.[sceneKey(state, scene)] || { phase: 'pending' }; }
function sceneReady(state, scene) {
  return !scene.requiresScene || state.encounters?.[state.mapId + ':' + scene.requiresScene]?.phase === 'resolved';
}
function sceneMemoryFact(state, npcId) {
  return [...(state.character.encounterFacts || []), ...(state.encounterFacts || [])]
    .filter(f => f.storyId ? f.storyId === state.map.story?.id && f.reactions?.[npcId] : f.mapId === state.mapId && f.npcId === npcId)
    .reverse().sort((a, b) => b.ts - a.ts)[0];
}
function sceneMemory(state, npcId) {
  const fact = sceneMemoryFact(state, npcId);
  const current = fact?.reactions?.[npcId]?.text || fact?.memory || '';
  const past = pastStoryMemory(state, npcId, fact);
  return past ? past.text + '\n' + current : current;
}
function pastStoryMemory(state, npcId, current) {
  if (!state.map.story || current?.ending) return null;
  return (state.character.encounterFacts || []).filter(f => f.storyId === state.map.story.id && f.ending && f.reactions?.[npcId]).reverse().sort((a,b) => b.ts-a.ts)[0]?.reactions[npcId] || null;
}
function sceneMemoryDisplay(state, npcId) {
  const fact = sceneMemoryFact(state, npcId);
  if (fact?.reactions?.[npcId]) {
    const current = fact.reactions[npcId], past = pastStoryMemory(state, npcId, fact);
    return past ? { localized: Object.fromEntries(['en','zh-CN'].map(locale => [locale, presentation.textFor(past,'text',locale) + '\n' + presentation.textFor(current,'text',locale)])), fallback: past.text + '\n' + current.text } : presentation.descriptor(current, 'text');
  }
  if (fact?.memoryDisplay) return fact.memoryDisplay;
  const choice = state.map.scenes?.find(s => s.id === fact?.sceneId)?.choices.find(c => c.id === fact?.choiceId);
  return choice ? presentation.descriptor(choice, 'memory') : null;
}
function storySummary(state) {
  if (!state.map.story) return null;
  const facts = (state.encounterFacts || []).filter(f => f.storyId === state.map.story.id && f.saveId === state.id);
  const ending = facts.find(f => f.ending);
  return {
    id: state.map.story.id, name: state.map.story.name, nameDisplay: presentation.descriptor(state.map.story),
    requiresHistory: state.map.story.requiresHistory || null,
    historyBinding: state.historyBinding || null,
    ending: ending?.ending || null, outcome: ending?.text || '', outcomeDisplay: ending?.textDisplay || null,
    choices: facts.map(f => ({ sceneId: f.sceneId, name: f.sceneName, nameDisplay: f.sceneNameDisplay,
      label: f.choiceLabel, labelDisplay: f.choiceLabelDisplay, outcome: f.text, outcomeDisplay: f.textDisplay,
      costGold: f.costGold || 0, consumedItem: f.consumedItem || null, consumedItemDisplay: f.consumedItem ? presentation.name({itemId:f.consumedItem}) : null, grantedItem: f.grantedItem || null, check: f.check || null }))
  };
}
function sceneDoorBlocked(state, doorId) {
  const scene = (state.map.scenes || []).find(s => s.doorId === doorId);
  return !!scene && sceneEntry(state, scene).phase === 'pending';
}
function sceneChoiceStatus(state, scene, choice) {
  const reason=(id,text,params={})=>({text,display:{key:'content.reason.'+id,params,fallback:text}});
  const entry = sceneEntry(state, scene), p = playerEntity(state);
  if (entry.phase === 'resolved') return reason('resolved','本次遭遇已经完成。');
  if (entry.phase === 'fighting') return reason('fighting','先完成这场战斗。');
  if (!sceneReady(state, scene)) return { text: '先完成之前的选择。', display: { key: 'story.reason.stage' } };
  if (state.mode !== 'explore' || !p.alive || p.hp <= 0 || p.conditions.includes('unconscious')) return reason('unavailable','现在不能作出这个选择。');
  const npc = sceneSpeaker(state, scene);
  if (scene.companion) {
    if (!npc) return { text: '布拉姆不在队伍中。', display: { key: 'story.reason.companionAbsent' } };
    if (!npc.alive || npc.hp <= 0 || npc.conditions.includes('unconscious')) return { text: '布拉姆必须亲自面对这件事——先在营火让他站起来，或撤退。', display: { key: 'story.reason.companionDown' } };
    if (manhattan(p, npc) > 1) return { text: '先走到布拉姆身旁。', display: { key: 'story.reason.companionAdjacent' } };
  } else if (!npc || manhattan(p, npc) > 1) return scene.kind === 'story' ? { text: '先走到这位 NPC 身旁。', display: {key:'story.reason.adjacent'} } : reason('adjacent','先走到守门人身边。');
  if ((scene.doorId && !state.objects.some(o => o.id === scene.doorId && o.type === 'door')) || (scene.guardIds || []).some(id => !state.entities.some(e => e.id === id && e.kind === 'monster'))) return reason('invalid','遭遇目标已经失效。');
  if (scene.kind === 'story') {
    const gold = (choice.effect.costGold || 0) + (choice.effect.failureGold || 0);
    if ((state.character.gold || 0) < gold) return { text: '需要 ' + gold + ' GP。', display: { key: 'story.reason.gold', params: { gold } } };
    if (choice.condition.type === 'has_item' && !(state.character.inventory || []).some(i => i.itemId === choice.condition.itemId && i.qty > 0)) return { text: '需要' + itemName(choice.condition.itemId) + '。', display: { key: 'story.reason.item', params: { item: presentation.name({ itemId: choice.condition.itemId }) } } };
    if (choice.condition.type === 'history_ending') {
      const currentEnding = state.historyBinding?.ending || 'no_history';
      if (currentEnding !== choice.condition.ending) {
        return { text: '前章历程不符。', display: { key: 'story.reason.historyMismatch' } };
      }
    }
  }
  if (choice.condition.type === 'has_item' && !(state.character.inventory || []).some(i => i.itemId === choice.condition.itemId && i.qty > 0)) return reason('item','需要' + itemName(choice.condition.itemId) + '；也可以选择交战。',{item:presentation.name({itemId:choice.condition.itemId,name:itemName(choice.condition.itemId)})});
  return {text:'',display:null};
}
function sceneChoiceReason(state,scene,choice) {return sceneChoiceStatus(state,scene,choice).text;}
function sceneViews(state) {
  const p = playerEntity(state);
  return (state.map.scenes || []).filter(scene => {
    if (!sceneReady(state, scene)) return false;
    const speaker = sceneSpeaker(state, scene);
    return !!speaker && (state.discovered || []).includes(speaker.x + ',' + speaker.y) && manhattan(p, speaker) <= 5;
  }).map(scene => {
    const entry = sceneEntry(state, scene);
    const fact = (state.encounterFacts || []).find(f => f.mapId === state.mapId && f.sceneId === scene.id);
    const memKey = sceneSpeakerId(state, scene);
    // Every scene of a companion story carries the real companion's confirmed
    // reaction, wherever the scene's speaker sits; `speaks` marks the scenes the
    // companion himself voices.
    const companionId = storyCompanionId(state);
    const companionEntity = companionId ? state.entities.find(e => e.kind === 'ally' && e.allyId === companionId) : null;
    const companionReaction = entry.phase === 'resolved' && companionId ? fact?.reactions?.[companionId] : null;
    return {
      id: scene.id, npcId: scene.npcId || null, name: scene.name, prompt: scene.prompt,
      nameDisplay:presentation.descriptor(scene), promptDisplay:presentation.descriptor(scene,'prompt'),
      phase: entry.phase, choiceId: entry.choiceId || null, memory: sceneMemory(state, memKey),
      outcome: entry.phase === 'resolved' ? fact?.text || scene.choices.find(c => c.id === entry.choiceId)?.response || '' : '',
      outcomeDisplay: entry.phase === 'resolved' ? fact?.textDisplay || presentation.descriptor(scene.choices.find(c=>c.id===entry.choiceId),'response') : null,
      memoryDisplay: sceneMemoryDisplay(state, memKey),
      companion: companionId && companionEntity ? {
        id: companionId, name: companionEntity.name,
        nameDisplay: presentation.name(companionEntity, state),
        icon: companionEntity.icon || null, speaks: !!scene.companion,
        ...(companionReaction ? { reaction: companionReaction.text, reactionDisplay: presentation.descriptor(companionReaction, 'text') } : {})
      } : null,
      result: entry.phase === 'resolved' && scene.kind === 'story' ? { costGold: fact?.costGold || 0, check: fact?.check || null, loyaltyDelta: fact?.loyaltyDelta ?? null } : null,
      choices: scene.choices.map(choice => ({ id: choice.id, label: choice.label, labelDisplay:presentation.descriptor(choice,'label'), available: !sceneChoiceReason(state, scene, choice), reason: sceneChoiceReason(state, scene, choice),reasonDisplay:sceneChoiceStatus(state,scene,choice).display,
        riskDisplay: scene.kind === 'story' ? { parts: [
          ...(choice.effect.type === 'check' ? [{ key: 'story.risk.check', params: { skill: { key: 'content.skill.' + choice.effect.skill, fallback: choice.effect.skill }, dc: choice.effect.dc, modifier: skillMod(state.character, choice.effect.skill) } }, { key: 'story.risk.failure', params: { gold: choice.effect.failureGold || 0 } }] : []),
          ...(choice.effect.costGold ? [{ key: 'story.risk.cost', params: { gold: choice.effect.costGold } }] : []),
          ...(choice.effect.consumeItem ? [{ key: 'story.risk.consume', params: { item: presentation.name({ itemId: choice.effect.consumeItem }) } }] : []),
          ...(choice.effect.type === 'combat' ? [{ key: 'story.risk.combat' }] : []),
          ...(!choice.effect.costGold && !choice.effect.consumeItem && choice.effect.type === 'decision' ? [{ key: 'story.risk.free' }] : [])
        ], separator: ' · ' } : null }))
    };
  });
}
function activeSceneView(state, npcId) {
  const scenes = sceneViews(state).filter(s => s.npcId === npcId);
  return scenes.find(s => s.phase !== 'resolved') || scenes.at(-1);
}
function openScenePassage(state, scene) {
  const door = state.objects.find(o => o.id === scene.doorId);
  if (door) { door.open = true; door.unlocked = true; }
}
function completeScene(state, scene, choice, events, result = null) {
  if (sceneEntry(state, scene).phase === 'resolved') return;
  state.encounters ??= {};
  state.encounters[sceneKey(state, scene)] = { phase: 'resolved', choiceId: choice.id };
  openScenePassage(state, scene);
  if (choice.effect.type !== 'combat') state.entities.filter(e => (scene.guardIds || []).includes(e.id)).forEach(e => { e.fled = true; e.pacified = true; e.aware = false; });
  state.encounterFacts ??= [];
  /** @type {any} */
  const fact = { id: state.id + ':' + sceneKey(state, scene), saveId: state.id, mapId: state.mapId, sceneId: scene.id, npcId: scene.companion ? (storyCompanionId(state) || undefined) : scene.npcId, choiceId: choice.id, fact: choice.fact, text: choice.response, memory: choice.memory, ts: Date.now() };
  if (scene.kind === 'story') {
    const costGold = (choice.effect.costGold || 0) + (result && !result.success ? choice.effect.failureGold || 0 : 0);
    state.character.gold = (state.character.gold || 0) - costGold;
    if (choice.effect.consumeItem) {
      const item = state.character.inventory.find(i => i.itemId === choice.effect.consumeItem && i.qty > 0);
      item.qty--; state.character.inventory = state.character.inventory.filter(i => i.qty > 0);
    }
    if (choice.effect.giveItem) addItemToInventory(state.character, choice.effect.giveItem);
    Object.assign(fact, { storyId: state.map.story.id, sceneName: scene.name, sceneNameDisplay: presentation.descriptor(scene),
      choiceLabel: choice.label, choiceLabelDisplay: presentation.descriptor(choice, 'label'),
      textDisplay: presentation.descriptor(choice, 'response'), memoryDisplay: presentation.descriptor(choice, 'memory'),
      reactions: choice.reactions, ending: choice.ending || null, costGold,
      consumedItem: choice.effect.consumeItem || null, grantedItem: choice.effect.giveItem || null, check: result });
    // T12a: authored companion attitude. The engine applies the bounded loyalty
    // delta to the real ally entity once; repeats never re-apply it.
    const loyaltyDelta = choice.loyalty != null ? choice.loyalty : (choice.effect.loyalty || 0);
    if (loyaltyDelta) {
      const companionId = storyCompanionId(state);
      const companionEnt = companionId ? state.entities.find(e => e.kind === 'ally' && e.allyId === companionId) : null;
      if (companionEnt) adjustLoyalty(state, loyaltyDelta, events, companionEnt);
      fact.loyaltyDelta = loyaltyDelta;
    }
  }
  if (!state.encounterFacts.some(f => f.id === fact.id)) state.encounterFacts.push(fact);
  const ev = { type: 'scene', narrate: true, text: choice.response, textDisplay:presentation.descriptor(choice,'response'), data: { sceneId: scene.id, choiceId: choice.id, fact: choice.fact } };
  events.push(ev); addLog(state, 'system', ev);
  if (scene.kind === 'story') {
    const detail = { type: 'scene', narrate: false, text: '实际代价：' + fact.costGold + ' GP。', textDisplay: { key: 'story.result.cost', params: { gold: fact.costGold } }, data: { sceneId: scene.id, costGold: fact.costGold, consumedItem: fact.consumedItem, grantedItem: fact.grantedItem, check: result, ending: fact.ending, loyaltyDelta: fact.loyaltyDelta ?? null } };
    events.push(detail); addLog(state, 'mech', detail);
    const companionReaction = choice.reactions?.[storyCompanionId(state)];
    if (companionReaction) {
      const rev = { type: 'companion', narrate: true, text: companionReaction.text, textDisplay: presentation.descriptor(companionReaction, 'text'), data: { sceneId: scene.id, companionId: storyCompanionId(state), loyaltyDelta: fact.loyaltyDelta ?? 0 } };
      events.push(rev); addLog(state, 'dm_canned', rev);
    }
    if (result) {
      const roll = { type: 'scene', narrate: false, text: result.detail, textDisplay: { key: 'story.result.check', params: { natural: result.natural, modifier: result.modifier, total: result.total, dc: result.dc, outcome: { key: result.success ? 'story.success' : 'story.failure' } } } };
      events.push(roll); addLog(state, 'mech', roll);
    }
  }
}
function resetSceneAttempt(state, scene) {
  state.encounters[sceneKey(state, scene)] = { phase: 'pending' };
  const door = state.objects.find(o => o.id === scene.doorId);
  if (door) { door.open = false; door.unlocked = false; }
  state.entities.filter(e => (scene.guardIds || []).includes(e.id)).forEach(e => {
    const original = state.map.entities.find(o => o.id === e.id);
    if (original) { e.x = original.x; e.y = original.y; e.aware = false; }
  });
}
function progressScenes(state, events) {
  if (state.mode !== 'explore') return;
  for (const scene of state.map.scenes || []) {
    const entry = sceneEntry(state, scene);
    if (entry.phase !== 'fighting') continue;
    const guards = state.entities.filter(e => scene.guardIds.includes(e.id));
    if (guards.length === scene.guardIds.length && guards.every(e => !e.alive || e.fled)) {
      const choice = scene.choices.find(c => c.id === entry.choiceId);
      if (choice) completeScene(state, scene, choice, events);
    } else resetSceneAttempt(state, scene); // stabilized/escaped fight: another route remains possible
  }
}
function restoreScenePassages(state) {
  for (const scene of state.map.scenes || []) {
    if (sceneEntry(state, scene).phase !== 'resolved') continue;
    openScenePassage(state, scene);
    state.entities.filter(e => (scene.guardIds || []).includes(e.id)).forEach(e => { e.fled = true; e.aware = false; });
  }
}
function resetSceneAttempts(state) {
  for (const scene of state.map.scenes || []) if (sceneEntry(state, scene).phase === 'fighting') resetSceneAttempt(state, scene);
  restoreScenePassages(state);
}
function chooseScene(state, sceneId, choiceId, events) {
  const scene = (state.map.scenes || []).find(s => s.id === sceneId);
  const choice = scene?.choices.find(c => c.id === choiceId);
  if (!scene || !choice) { events.push({ type: 'error', ...presentation.eventMessage("event.engine.chooseScene.253",[],["这个遭遇选项不存在。"]) }); return; }
  if (sceneEntry(state, scene).phase === 'resolved') { events.push({ type: 'info', ...presentation.eventMessage("event.engine.chooseScene.254",[],["本次选择已生效，不会重复消耗或结算。"]) }); return; }
  const reason = sceneChoiceReason(state, scene, choice);
  if (reason) { events.push({ type: 'error', text: reason,textDisplay:sceneChoiceStatus(state,scene,choice).display }); return; }
  if (choice.effect.type !== 'combat') {
    if (choice.effect.consumeItem && scene.kind !== 'story') {
      const item = state.character.inventory.find(i => i.itemId === choice.effect.consumeItem && i.qty > 0);
      item.qty--; state.character.inventory = state.character.inventory.filter(i => i.qty > 0);
    }
    if (choice.effect.type === 'check') {
      const result = { ...skillCheck(state, choice.effect.skill, choice.effect.dc), dc: choice.effect.dc, skill: choice.effect.skill };
      const outcome = result.success ? choice : { ...choice, ...choice.failure, localized: { en: { ...choice.localized?.en, ...choice.failure.localized?.en }, 'zh-CN': { ...choice.localized?.['zh-CN'], ...choice.failure.localized?.['zh-CN'] } } };
      completeScene(state, scene, outcome, events, result);
    } else completeScene(state, scene, choice, events);
  } else {
    state.encounters ??= {};
    state.encounters[sceneKey(state, scene)] = { phase: 'fighting', choiceId: choice.id };
    openScenePassage(state, scene);
    const guards = state.entities.filter(e => scene.guardIds.includes(e.id) && e.alive && !e.fled);
    if (!guards.length) completeScene(state, scene, choice, events);
    else startCombat(state, guards.map(e => e.id), events);
  }
}

module.exports = {
  sceneViews, activeSceneView, sceneMemory, sceneMemoryDisplay, storySummary, chooseScene, progressScenes, sceneDoorBlocked, resetSceneAttempts,
  sceneReady, sceneSpeaker, sceneChoiceReason, sceneChoiceStatus,
  SPECIES, CLASSES, BACKGROUNDS, FEATS, WEAPONS, ARMORS, GEAR, SPELLS, MONSTERS, ALLY_DEF, ALLIES, MAPS,
  ABILITIES, SKILL_ABILITY, ALL_SKILLS, XP_THRESHOLDS, SLOTS, DIFFICULTY, SHOP_ITEMS,
  die, rollExpr, d20, mod, cap, byId, invEntry, equippedBonus,
  buildCharacter, applyClassAndSpecies, hpPerLevelBonus, skillMod, passivePerception, levelUpInfo, previewSkillCheckObject,
  getMap, tileChar, isWall, isBlocked, isDifficult, entityAt, roomAt, los, manhattan, bfsPath, computeVision, markDiscovered,
  isTrapHidden, isTileDiscovered, isObjectVisibleToPlayer,
  rand, beginSeed, beginRng, persistRng, weeklyInfo,
  startGame, addLog, playerEntity, currentActor, endTurn, beginPlayerTurn, currentSpeed,
  hasBuff, getBuff, addBuff, removeBuff, currentAc, charHasArmor, applyCondition,
  equippedSets, setAcBonus, setInitBonus,
  alertCheck, startCombat, checkCombatEnd, processUntilPlayer,
  movePlayer, playerAttack, castSpell, findSpell, interactObject, interactDoor,
  shortRest, longRest, skillCheck, damageRoll, applyDamage, healEntity, awardXp, checkPlayerDeath,
  adjustTempHp, blockRest,
  triggerTrap, noticeTrapsNearby, alertForcedNoise, attackMods, monsterAttack, processMonsterTurn, processAllyTurn,
  detonateBarrel, triggerSpores, useFont, pullLever, triggerHazard,
  rollLoot, lootChest, applyPickupEffects, itemName, addItemToInventory, resolveWeapon,
  rollSideQuest, checkQuest, campfireOf, loadWorldMap, shoveTarget, maybeOpportunityAttack, hasFlank,
  disarmTrap, unlockChest, travelTo, affixes,
  ROAD_ENCOUNTERS, triggerRoadEncounter, resolveRoadEncounter, roadEncounterView
};
