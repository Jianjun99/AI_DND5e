// AI D&D — game engine: dice, character building, movement, fog of war, combat, XP, rests.
// The engine is deterministic: the LLM (if any) only narrates what the engine resolves.
const path = require('path');
const fs = require('fs');

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
const MONSTERS = load('monsters.json').monsters;
const ALLY_DEF = load('monsters.json').ally;
const MAPS = { crypt: load('maps/crypt.json') };

const ABILITIES = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
const SKILL_ABILITY = {
  acrobatics: 'dex', animal_handling: 'wis', arcana: 'int', athletics: 'str', deception: 'cha',
  history: 'int', insight: 'wis', intimidation: 'cha', investigation: 'int', medicine: 'wis',
  nature: 'int', perception: 'wis', performance: 'cha', persuasion: 'cha', religion: 'int',
  sleight_of_hand: 'dex', stealth: 'dex', survival: 'wis'
};
const ALL_SKILLS = Object.keys(SKILL_ABILITY);
const XP_THRESHOLDS = { 2: 300, 3: 900 };
const SLOTS = {
  full: { 1: { 1: 2 }, 2: { 1: 3 }, 3: { 1: 4, 2: 2 } },
  half: { 1: { 1: 2 }, 2: { 1: 2 }, 3: { 1: 3 } },
  pact: { 1: { 1: 2 }, 2: { 1: 2 }, 3: { 1: 2 } }
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
  { id: 'silver_sword', name: 'Silver Shortsword', price: 200, desc: 'Magic shortsword: +1 to attack and damage.' }
];

// Weapons resolve either from the weapon table or from magic gear (built on a base weapon)
function resolveWeapon(id) {
  const w = byId(WEAPONS, id);
  if (w) return w;
  const g = byId(GEAR, id);
  if (g && g.type === 'magic_weapon') {
    const base = byId(WEAPONS, g.base) || { name: g.name, damage: '1d4', damageType: 'bludgeoning', props: [], type: 'simple_melee', range: 5 };
    return Object.assign({}, base, { id, name: g.name, magic: g.magic || 0, bonusDamage: g.bonusDamage || null });
  }
  return null;
}

function itemName(id) {
  const w = byId(WEAPONS, id), a = byId(ARMORS, id), g = byId(GEAR, id);
  return (w || a || g || { name: id }).name;
}

function addItemToInventory(char, id, qty = 1) {
  const existing = char.inventory.find(i => i.itemId === id);
  if (existing) existing.qty += qty;
  else char.inventory.push({ itemId: id, qty });
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

  const char = {
    id: draft.id || null, name: draft.name, species: sp.id, className: cls.id, background: bg.id,
    level: 1, xp: 0, abilities, profBonus, skills: finalSkills, expertise: validExp,
    feat: bg.feat, featNote: bg.featNote, fightingStyle: draft.fightingStyle || null,
    invocations: draft.invocations || [],
    choices: { species: draft.speciesChoices || {}, bgPlus2: draft.bgPlus2, bgPlus1: draft.bgPlus1 },
    inventory, gold: 50, spellcasting: sc,
    hpMax: 0, uses: {}, pools: {}, freeSpellUses: 0, hdUsed: 0
  };
  applyClassAndSpecies(char, cls, sp, 1);
  return char;
}

// compute hp/ac/speed/attacks/uses; used at creation AND on level-up
function applyClassAndSpecies(char, clsArg, spArg, newLevel) {
  const cls = clsArg || byId(CLASSES, char.className);
  const sp = spArg || byId(SPECIES, char.species);
  const level = char.level = newLevel || char.level;
  const eff = sp.effect || {};
  const abilities = char.abilities;
  const dexM = mod(abilities.dex), conM = mod(abilities.con);

  const hpPerLevelExtra = (eff.hpPerLevel || 0) + ((FEATS[char.feat] || {}).hpPerLevel || 0);
  let gained;
  if (char.hpMax === 0) gained = cls.hitDie + conM;
  else gained = Math.max(1, die(cls.hitDie) + conM);
  char.hpMax = Math.max(1, (char.hpMax || 0) + gained + hpPerLevelExtra);

  const armorItem = char.inventory.map(i => byId(ARMORS, i.itemId)).find(Boolean);
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
  if (char.inventory.some(i => i.itemId === 'shield')) ac += 2;
  if (char.inventory.some(i => i.itemId === 'cloak_protection')) ac += (byId(GEAR, 'cloak_protection').acBonus || 0);
  char.acBase = ac;

  char.speedFt = eff.speed || sp.speed || 30;
  if (cls.id === 'monk' && level >= 2) char.speedFt += 10;
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
  char.initBonus = dexM + ((FEATS[char.feat] || {}).initBonus || 0);

  char.attacks = char.inventory.map(inv => {
    const w = resolveWeapon(inv.itemId);
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
      magic: w.magic || 0, bonusDamage: w.bonusDamage || null
    };
  }).filter(Boolean);
  const unarmedAb = abilities.str >= abilities.dex ? abilities.str : abilities.dex;
  char.attacks.push({
    weaponId: 'unarmed', name: 'Unarmed Strike', bonus: char.profBonus + mod(unarmedAb),
    dmgDice: cls.id === 'monk' ? '1d6' : '1', dmgMod: mod(unarmedAb), dmgType: 'bludgeoning',
    ranged: false, range: 5, props: [], heavy: false, light: false, twoHanded: false, finesse: false
  });

  if (cls.spellcasting) {
    const table = SLOTS[cls.spellcasting.slots];
    const slotsDef = table[Math.min(level, 3)] || {};
    char.slotsMax = { ...slotsDef };
    char.slots = char.slots && Object.keys(char.slots).length ? char.slots : { ...slotsDef };
    char.slotsRefresh = cls.spellcasting.slots === 'pact' ? 'short' : 'long';
  } else { char.slotsMax = {}; char.slots = {}; }

  const uses = char.uses = char.uses || {};
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
function getMap(mapId) { return MAPS[mapId] || MAPS.crypt; }
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
function isDifficult(state, x, y) { return tileChar(state.map, x, y) === ','; }
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
      if (isWall(state, nx, ny)) continue;
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
function startGame(character, options = {}) {
  const mapDef = getMap('crypt');
  const map = JSON.parse(JSON.stringify(mapDef));
  const difficulty = DIFFICULTY[options.difficulty] ? options.difficulty : 'normal';
  const state = {
    id: 'save_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
    characterId: character.id, character: JSON.parse(JSON.stringify(character)),
    mapName: map.name, map, mode: 'explore', difficulty,
    entities: [], objects: [], discovered: [], flags: { hasRelic: false, altarBlessed: false, victory: false, failed: false },
    npcChat: {}, stealth: null, log: [], journal: [], appearances: {}, createdAt: Date.now(), updatedAt: Date.now()
  };

  const p = state.character;
  // difficulty adjusts starting supplies on this delve's snapshot
  const potionPack = p.inventory.find(i => i.itemId === 'potion_healing');
  if (potionPack) potionPack.qty = Math.max(0, potionPack.qty + DIFFICULTY[difficulty].bonusPotions);
  state.entities.push({
    id: 'player', kind: 'player', name: p.name, x: map.playerStart.x, y: map.playerStart.y,
    hp: p.hpMax, hpMax: p.hpMax, tempHp: 0, ac: p.acBase, speedFt: p.speedFt,
    conditions: [], buffs: [], alive: true
  });

  if (options.bringAlly) {
    const a = ALLY_DEF;
    state.entities.push({
      id: 'ally', kind: 'ally', name: a.name, x: map.playerStart.x + 1, y: map.playerStart.y,
      hp: a.hp, hpMax: a.hp, ac: a.ac, speedFt: a.speed, abilities: a.abilities,
      attacks: a.attacks, darkvision: a.darkvision, conditions: [], buffs: [], alive: true
    });
    state.flags.ally = true;
  }

  map.entities.forEach(e => {
    if (e.type === 'monster') {
      const def = byId(MONSTERS, e.kind);
      const hp = Math.max(1, Math.round(rollExpr(def.hp).total * DIFFICULTY[difficulty].hpMult));
      state.entities.push({
        id: e.id, kind: 'monster', monsterId: e.kind, name: e.name || def.name,
        x: e.x, y: e.y, hp, hpMax: hp, ac: def.ac, speedFt: def.speed, abilities: def.abilities,
        attacks: def.attacks, darkvision: def.darkvision || 0, xp: def.xp, boss: !!def.boss,
        vulnerabilities: def.vulnerabilities || [], traits: def.traits || [],
        chief: !!e.chief, conditions: [], buffs: [], alive: true, aware: false, fled: false
      });
    } else if (e.type === 'npc') {
      state.entities.push({ id: 'npc_' + e.id, kind: 'npc', npcId: e.id, name: e.name, x: e.x, y: e.y, icon: e.icon || '🗣️', alive: true });
      state.objects.push({ ...e, type: 'npcMarker' });
    } else if (e.type === 'trap') {
      state.objects.push({ ...e, revealed: false, disarmed: false, triggered: false });
    } else {
      state.objects.push({ ...e, open: e.type === 'door' ? false : undefined, looted: false, unlocked: !e.locked });
    }
  });

  addLog(state, 'system', `${p.name} the ${cap(p.className)} enters ${map.name}. The delve begins.`);
  const visible = computeVision(state);
  markDiscovered(state, visible);
  return state;
}

function addLog(state, kind, text) {
  state.log.push({ kind, text, ts: Date.now() });
  if (state.log.length > 300) state.log.splice(0, state.log.length - 300);
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
    const concExpired = e.buffs.some(b => b.id === 'concentrating') && e.buffs.find(b => b.id === 'concentrating').rounds <= 1;
    e.buffs = e.buffs.filter(b => b.rounds > 0);
    if (concExpired) { // lost concentration -> end concentration buffs granted to others
      state.entities.forEach(t => { t.buffs = (t.buffs || []).filter(tb => !(tb.srcEntity === e.id && tb.conc)); });
      addLog(state, 'mech', `${e.name}'s concentration is broken.`);
    }
  });
}

function checkPlayerDeath(state, events) {
  if (state.mode === 'over') return true;
  const p = playerEntity(state);
  if (p && p.hp <= 0) {
    if (state.character.dropTo1 && !state.flags.dropUsed) {
      p.hp = 1; state.flags.dropUsed = true;
      const ev = { type: 'relentless', narrate: true, text: `${p.name} refuses to fall — Relentless Endurance keeps them at 1 HP!` };
      events.push(ev); addLog(state, 'mech', ev.text);
      return false;
    }
    state.mode = 'over'; state.flags.failed = true; p.alive = false;
    const ev = { type: 'player_down', narrate: true, text: `${p.name} falls unconscious. Darkness closes in...` };
    events.push(ev); addLog(state, 'system', ev.text);
    return true;
  }
  return false;
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
    if (actor.kind === 'player') { beginPlayerTurn(state); return; }
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

function beginPlayerTurn(state) {
  const c = state.combat, p = playerEntity(state);
  c.actionUsed = false; c.bonusUsed = false;
  state.flags.used_sneak = false;
  state.flags.savage_used = false;
  c.movementLeft = currentSpeed(state, p);
  removeBuff(p, 'shield'); // Shield lasts until the start of your next turn
  if (p.conditions.includes('prone')) {
    p.conditions = p.conditions.filter(x => x !== 'prone');
    c.movementLeft = Math.max(0, c.movementLeft - Math.floor(currentSpeed(state, p) / 2));
    addLog(state, 'mech', `${p.name} stands up (half movement).`);
  }
}

function currentSpeed(state, ent) {
  let s = ent.speedFt || 30;
  (ent.buffs || []).forEach(b => {
    if (b.id === 'longstrider') s += 10;
    if (b.id === 'slowed') s -= 10;
    if (b.id === 'cond_slowed' && b.speedPenalty) s -= b.speedPenalty;
  });
  if (hasBuff(ent, 'wolfform')) s = Math.max(s, 40);
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
  return ac;
}
function charHasArmor(char) { return char.inventory.some(i => byId(ARMORS, i.itemId)); }

// ---------------------------------------------------------------- damage ----
function applyDamage(state, target, amount, dmgType, events) {
  if (!target || target.alive === false || amount <= 0) return 0;
  let dmg = amount;
  const resList = target.kind === 'player' ? (state.character.resistances || []) : [];
  if (target.kind === 'player' && hasBuff(target, 'rage') && ['bludgeoning', 'piercing', 'slashing'].includes(dmgType)) dmg = Math.floor(dmg / 2);
  if (resList.includes(dmgType)) dmg = Math.floor(dmg / 2);
  if ((target.vulnerabilities || []).includes(dmgType)) dmg *= 2;
  if (target.tempHp) {
    const absorbed = Math.min(target.tempHp, dmg);
    target.tempHp -= absorbed; dmg -= absorbed;
  }
  target.hp -= dmg;
  // wake sleeping creatures
  if (target.conditions.includes('asleep')) {
    target.conditions = target.conditions.filter(c => c !== 'asleep');
    removeBuff(target, 'asleep');
    addLog(state, 'mech', `${target.name} wakes with a jolt!`);
  }
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
    if (target.kind === 'monster') {
      const ev = { type: 'kill', narrate: true, text: `${target.name} is destroyed! (+${target.xp} XP)`, data: { xp: target.xp } };
      events.push(ev); addLog(state, 'mech', ev.text);
      awardXp(state, target.xp, events);
      rollLoot(state, target, events);
    } else if (target.kind === 'ally') {
      const ev = { type: 'ally_down', narrate: true, text: `${target.name} collapses!` };
      events.push(ev); addLog(state, 'mech', ev.text);
    }
  }
  return dmg;
}

function healEntity(state, ent, amt, events, source) {
  const healed = Math.max(0, Math.min(amt, ent.hpMax - ent.hp));
  ent.hp += healed;
  const ev = { type: 'heal', narrate: healed > 0, text: healed > 0 ? `${source}: ${ent.name} regains ${healed} HP (${ent.hp}/${ent.hpMax}).` : `${ent.name} is already at full health.` };
  events.push(ev); addLog(state, 'mech', ev.text);
  return healed;
}

// attack mods: adv/dis on the d20; atkRolls add to the attack total; dmgDice add to damage
function attackMods(state, attacker, target, atk, events) {
  const out = { adv: false, dis: false, atkRolls: [], dmgDice: [], bonusFlat: 0 };
  if (attacker.kind !== 'player') {
    if (hasBuff(attacker, 'disadv_next')) out.dis = true;
    if (target.kind === 'player') {
      if (hasBuff(target, 'dodge') || target.conditions.includes('prone')) out.dis = true;
      if (state.flags.reckless && !atk.ranged) out.adv = true;
    }
    return out;
  }
  const char = state.character;
  const p = attacker;
  if (hasBuff(p, 'adv_next_attack')) { out.adv = true; }
  if (state.flags.reckless && !atk.ranged) out.adv = true;
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
  return out;
}

function monsterAttack(state, attacker, target, atk, events) {
  const isPlayer = target.kind === 'player';
  const targetAc = currentAc(state, target);
  const mods = attackMods(state, attacker, target, atk, events);
  const opts = { adv: mods.adv && !mods.dis, dis: mods.dis && !mods.adv };
  const roll = d20(opts);
  let atkExtra = 0, extraTxt = '';
  if (isPlayer) {
    const bless = getBuff(target, 'blessed');
    if (bless) { const b = die(4); atkExtra += b; extraTxt += ` +${b} bless`; }
    const altar = getBuff(target, 'altar_blessed');
    if (altar) atkExtra += 1;
  }
  const total = roll.natural + atk.bonus + atkExtra;
  const hit = roll.natural === 20 || (roll.natural !== 1 && total >= targetAc);
  const atkStr = `${attacker.name}'s ${atk.name}`;
  if (!hit) {
    const text = `${atkStr} misses ${target.name} (d20 ${roll.natural}${atk.bonus >= 0 ? '+' + atk.bonus : atk.bonus}${extraTxt} = ${total} vs AC ${targetAc}).`;
    events.push({ type: 'miss', narrate: false, text }); addLog(state, 'mech', text);
    return;
  }
  const crit = roll.natural === 20;
  const rolled = damageRoll(atk.damage, { crit });
  // difficulty scales only monster damage, never the ally's
  const dmgMult = attacker.kind === 'monster' ? DIFFICULTY[state.difficulty || 'normal'].dmgMult : 1;
  const dmg = { total: Math.max(1, Math.round(rolled.total * dmgMult)), dice: rolled.dice };
  let text = `${atkStr} hits ${target.name}${crit ? ' — CRITICAL HIT!' : ''} for ${dmg.total} ${atk.damageType} damage.`;
  events.push({ type: 'attack_in', narrate: true, text, data: { dmg: dmg.total, crit } });
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
  if (isPlayer) addLog(state, 'mech', `${target.name} takes ${dealt} damage (${Math.max(0, target.hp)}/${target.hpMax} HP).`);
  checkPlayerDeath(state, events);
}

function p_name(state) { const p = playerEntity(state); return p ? p.name : 'You'; }

function playerAttack(state, targetId, weaponId, events) {
  const p = playerEntity(state);
  const target = state.entities.find(e => e.id === targetId && e.alive !== false);
  if (!target || target.kind !== 'monster') { events.push({ type: 'error', text: 'No such target.' }); return false; }
  const char = state.character;
  let atk = char.attacks.find(a => a.weaponId === weaponId) || char.attacks[0];
  if (!atk) { events.push({ type: 'error', text: 'You have no weapon.' }); return false; }
  if (hasBuff(p, 'shillelagh') && ['club', 'quarterstaff'].includes(atk.weaponId)) {
    atk = { ...atk, bonus: char.profBonus + char.spellcasting.spellMod, dmgDice: '1d8', dmgMod: char.spellcasting.spellMod };
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
  const opts = { adv: mods.adv && !mods.dis, dis: mods.dis && !mods.adv, reroll1: char.rerollNat1 };
  const roll = d20(opts);
  let atkBonus = atk.bonus + mods.bonusFlat;
  let atkExtra = 0, extraTxt = '';
  mods.atkRolls.forEach(b => { const r = rollExpr(b.dice); atkExtra += r.total; extraTxt += ` +${r.total} ${b.type}`; });
  const total = roll.natural + atkBonus + atkExtra;
  const hit = roll.natural === 20 || (roll.natural !== 1 && total >= currentAc(state, target));
  if (hasBuff(p, 'adv_next_attack')) removeBuff(p, 'adv_next_attack');

  if (!hit) {
    const text = `${p.name}'s ${atk.name} misses ${target.name} (d20 ${roll.natural}${atkBonus >= 0 ? '+' + atkBonus : atkBonus}${extraTxt} = ${total} vs AC ${target.ac}).`;
    events.push({ type: 'miss', narrate: true, text }); addLog(state, 'mech', text);
    return true;
  }
  const crit = roll.natural === 20;
  let dmg = damageRoll(atk.dmgDice, { crit, gwf: char.fightingStyle === 'great_weapon', rerollAll: char.savageAttacker && !state.flags.savage_used });
  if (char.savageAttacker) state.flags.savage_used = true;
  let dmgTotal = dmg.total + mods.bonusFlat;
  const bonusTxts = [];
  mods.dmgDice.forEach(b => {
    if (b.oncePerTurn && state.flags['used_' + b.oncePerTurn]) return;
    const r = rollExpr(b.dice);
    dmgTotal += r.total;
    bonusTxts.push(`+${r.total} ${b.type}`);
    if (b.oncePerTurn) state.flags['used_' + b.oncePerTurn] = true;
  });
  if (atk.bonusDamage) {
    const r = rollExpr(atk.bonusDamage.dice);
    dmgTotal += r.total;
    bonusTxts.push(`+${r.total} ${atk.bonusDamage.type}`);
  }
  const text = `${p.name} strikes ${target.name} with ${atk.name}${crit ? ' — CRITICAL HIT!' : ''}: ${dmg.total}${bonusTxts.length ? ' ' + bonusTxts.join(' ') : ''} = ${dmgTotal} ${atk.dmgType} damage.`;
  events.push({ type: 'attack', narrate: true, text, data: { dmg: dmgTotal, crit, target: target.name } });
  addLog(state, 'mech', text);
  const dealt = applyDamage(state, target, dmgTotal, atk.dmgType, events);
  addLog(state, 'mech', `${target.name} takes ${dealt} damage (${target.hp}/${target.hpMax} HP${target.alive === false ? ', slain' : ''}).`);
  if (atk.weaponId === 'unarmed' && char.tavernBrawler && target.alive !== false) {
    const dx = Math.sign(target.x - p.x), dy = Math.sign(target.y - p.y);
    const nx = target.x + dx, ny = target.y + dy;
    if (!isWall(state, nx, ny) && !entityAt(state, nx, ny)) { target.x = nx; target.y = ny; addLog(state, 'mech', `${target.name} is shoved 5 ft!`); }
  }
  return true;
}

// ---------------------------------------------------------------- spells ----
function findSpell(id) { return byId(SPELLS, id); }

function castSpell(state, spellId, targetId, events, opts = {}) {
  const p = playerEntity(state);
  const char = state.character;
  const sp = findSpell(spellId);
  if (!sp) { events.push({ type: 'error', text: 'Unknown spell.' }); return false; }

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
    if (sp.heal) { const r = rollExpr(sp.heal.dice); healEntity(state, p, r.total + spMod, events, sp.name); return true; }
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
    if (sp.heal) { const r = rollExpr(sp.heal.dice); healEntity(state, dest, r.total + spMod, events, sp.name); return true; }
    if (sp.buff) {
      addBuff(dest, { id: sp.buff.id, rounds: sp.buff.rounds, srcEntity: p.id, conc: !!sp.conc, ...sp.buff });
      const ev = { type: 'buff', narrate: true, text: `${sp.name} settles over ${dest.name}. ${sp.desc}` };
      events.push(ev); return true;
    }
  }

  const target = resolveTarget();
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
      const ev = { type: 'miss', narrate: true, text: `${p.name}'s ${sp.name} misses ${target.name} (d20 ${roll.natural}+${spAtk} = ${total} vs AC ${target.ac}).` };
      events.push(ev); addLog(state, 'mech', ev.text); return true;
    }
    const crit = roll.natural === 20;
    const dmg = damageRoll(sp.damage.dice, { crit });
    const ev = { type: 'spell_hit', narrate: true, text: `${p.name}'s ${sp.name} strikes ${target.name}${crit ? ' — CRITICAL!' : ''}: ${dmg.total} ${sp.damage.type} damage.` };
    events.push(ev); addLog(state, 'mech', ev.text);
    applyDamage(state, target, dmg.total, sp.damage.type, events);
    if (sp.condition && target.alive !== false) applyCondition(sp.condition, target);
    if (sp.id === 'eldritch_blast' && char.invocations.includes('repelling_blast') && target.alive !== false) {
      const dx = Math.sign(target.x - p.x), dy = Math.sign(target.y - p.y);
      if (!isWall(state, target.x + dx, target.y + dy) && !entityAt(state, target.x + dx, target.y + dy)) {
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
      dmgTotal = success && sp.save.onSave === 'half' ? Math.floor(dmg.total / 2) : success ? 0 : dmg.total;
    }
    let text = `${target.name} ${sp.save.ability.toUpperCase()} save: d20 ${saveRoll.natural}+${saveMod} = ${total} vs DC ${dc} — ${success ? 'success' : 'failure'}.`;
    if (sp.damage) text += ` ${dmgTotal} ${sp.damage.type} damage.`;
    events.push({ type: 'save', narrate: true, text }); addLog(state, 'mech', text);
    if (sp.damage && dmgTotal) applyDamage(state, target, dmgTotal, sp.damage.type, events);
    if (!success && target.alive !== false) {
      if (sp.save.onSave === 'prone') { if (!target.conditions.includes('prone')) target.conditions.push('prone'); addLog(state, 'mech', `${target.name} slips and falls prone!`); }
      if (sp.condition) applyCondition(sp.condition, target);
      if (sp.push) {
        const dx = Math.sign(target.x - p.x), dy = Math.sign(target.y - p.y);
        for (let i = 0; i < sp.push; i++) {
          const nx = target.x + dx, ny = target.y + dy;
          if (isWall(state, nx, ny) || entityAt(state, nx, ny)) break;
          target.x = nx; target.y = ny;
        }
        addLog(state, 'mech', `${target.name} is hurled backward by the thunder!`);
      }
    }
    return true;
  }
  if (sp.auto && sp.damage) {
    const dmg = rollExpr(sp.damage.dice);
    const ev = { type: 'spell_hit', narrate: true, text: `${sp.name} slams into ${target.name} unerringly: ${dmg.total} ${sp.damage.type} damage.` };
    events.push(ev); addLog(state, 'mech', ev.text);
    applyDamage(state, target, dmg.total, sp.damage.type, events);
    return true;
  }
  return true;
}

function applyCondition(cond, target) {
  if (!target.conditions.includes(cond.id)) target.conditions.push(cond.id);
  if (cond.rounds) addBuff(target, { id: 'cond_' + cond.id, rounds: cond.rounds, condId: cond.id, speedPenalty: cond.speedPenalty || 0, condition: true });
  if (cond.id === 'slowed') addBuff(target, { id: 'slowed', rounds: cond.rounds || 1 });
  if (cond.id === 'disadv_next') addBuff(target, { id: 'disadv_next', rounds: 1 });
}

// ---------------------------------------------------------------- movement ----
function stepCost(state, x, y) { return isDifficult(state, x, y) ? 2 : 1; }

function triggerTrap(state, trap, events) {
  const p = playerEntity(state);
  trap.triggered = true; trap.revealed = true;
  const saveRoll = d20({ reroll1: state.character.rerollNat1 });
  const saveMod = mod(state.character.abilities[trap.save || 'dex']);
  const altar = getBuff(p, 'altar_blessed');
  const success = saveRoll.natural + saveMod + (altar ? 1 : 0) >= (trap.dc || 13);
  const text = `A ${trap.name}! ${p.name} ${String(trap.save || 'dex').toUpperCase()} save: ${saveRoll.natural}+${saveMod} vs DC ${trap.dc} — ${success ? 'they dodge aside!' : 'they are hit!'}`;
  events.push({ type: 'trap', narrate: true, text }); addLog(state, 'mech', text);
  if (!success) {
    const dmg = rollExpr(trap.damage).total;
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

function movePlayer(state, targetX, targetY, events) {
  const p = playerEntity(state);
  if (state.mode === 'over' || state.mode === 'victory') return;
  const inCombat = state.mode === 'combat';
  const path = bfsPath(state, { x: p.x, y: p.y }, [{ x: targetX, y: targetY }], { self: p.id });
  if (!path) { events.push({ type: 'error', text: 'You cannot reach that tile — a wall or closed door blocks the way.' }); return; }
  let budget = inCombat ? state.combat.movementLeft : Infinity;
  let steps = 0;
  for (const step of path) {
    const cost = stepCost(state, step.x, step.y);
    if (inCombat && budget < cost) { addLog(state, 'mech', 'Out of movement — your turn ends here.'); break; }
    if (entityAt(state, step.x, step.y)) break;
    budget -= cost; steps++;
    p.x = step.x; p.y = step.y;
    if (inCombat) state.combat.movementLeft = budget;
    const trap = state.objects.find(o => o.type === 'trap' && o.x === p.x && o.y === p.y && !o.disarmed && !o.triggered);
    if (trap) { triggerTrap(state, trap, events); if (state.mode === 'over') return; }
    if (!inCombat) {
      alertCheck(state, events);
      if (state.mode === 'combat') return;
    }
  }
  noticeTrapsNearby(state, events);
  const visible = computeVision(state);
  markDiscovered(state, visible);
  if (steps > 0) { checkRoomEntry(state, events); checkVictory(state, events); }
}

function checkRoomEntry(state, events) {
  const p = playerEntity(state);
  const room = roomAt(state, p.x, p.y);
  if (room && !state.flags['room_' + room.id]) {
    state.flags['room_' + room.id] = true;
    const ev = { type: 'scene', narrate: true, text: `${room.name}: ${room.desc}`, data: { room: room.id, roomName: room.name } };
    events.push(ev); addLog(state, 'dm_canned', ev.text);
  }
}

function checkVictory(state, events) {
  const p = playerEntity(state);
  const v = state.map.victoryTile;
  if (state.flags.hasRelic && p.x === v.x && p.y === v.y && state.mode === 'explore') {
    state.mode = 'victory'; state.flags.victory = true;
    awardXp(state, 100, events);
    const ev = { type: 'victory', narrate: true, text: `VICTORY! ${p.name} slips out of the crypt into daylight, the Relic of the Sunless Crypt in hand. The delve is complete! (+100 XP)` };
    events.push(ev); addLog(state, 'system', ev.text);
  }
}

// ---------------------------------------------------------------- monster AI ----
function processMonsterTurn(state, mon, events) {
  if (!mon.alive || mon.fled || state.mode !== 'combat') return;
  if (mon.conditions.includes('asleep')) { addLog(state, 'mech', `${mon.name} sleeps soundly.`); return; }
  if (hasBuff(mon, 'charmed')) { addLog(state, 'mech', `${mon.name} gazes at ${p_name(state)} with vacant affection and does nothing.`); return; }
  const targets = state.entities.filter(e => (e.kind === 'player' || e.kind === 'ally') && e.alive !== false);
  if (!targets.length) return;
  const target = targets.sort((a, b) => manhattan(mon, a) - manhattan(mon, b))[0];
  if (mon.conditions.includes('prone')) mon.conditions = mon.conditions.filter(c => c !== 'prone');
  const rangedAtk = (mon.attacks || []).find(a => a.ranged);
  const meleeAtk = (mon.attacks || []).find(a => !a.ranged) || (mon.attacks || [])[0];

  if (manhattan(mon, target) <= 1 && meleeAtk) { monsterAttack(state, mon, target, meleeAtk, events); return; }
  if (rangedAtk && manhattan(mon, target) <= rangedAtk.range / 5 && los(state, mon.x, mon.y, target.x, target.y)) {
    monsterAttack(state, mon, target, rangedAtk, events); return;
  }
  const goals = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dy]) => ({ x: target.x + dx, y: target.y + dy }))
    .filter(t => !isWall(state, t.x, t.y) && !entityAt(state, t.x, t.y));
  const path = bfsPath(state, { x: mon.x, y: mon.y }, goals, { self: mon.id });
  if (path) {
    let budget = currentSpeed(state, mon);
    for (const step of path) {
      const cost = stepCost(state, step.x, step.y);
      if (budget < cost) break;
      if (entityAt(state, step.x, step.y)) break;
      budget -= cost; mon.x = step.x; mon.y = step.y;
      if (manhattan(mon, target) <= 1) break;
    }
  }
  if (manhattan(mon, target) <= 1 && meleeAtk) monsterAttack(state, mon, target, meleeAtk, events);
  else if (rangedAtk && manhattan(mon, target) <= rangedAtk.range / 5 && los(state, mon.x, mon.y, target.x, target.y)) {
    monsterAttack(state, mon, target, rangedAtk, events);
  }
}

function processAllyTurn(state, ally, events) {
  if (!ally.alive || state.mode !== 'combat') return;
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
    .filter(t => !isWall(state, t.x, t.y) && !entityAt(state, t.x, t.y));
  const path = bfsPath(state, { x: ally.x, y: ally.y }, goals, { self: ally.id });
  if (path) {
    let budget = ally.speedFt;
    for (const step of path) {
      const cost = stepCost(state, step.x, step.y);
      if (budget < cost) break;
      if (entityAt(state, step.x, step.y)) break;
      budget -= cost; ally.x = step.x; ally.y = step.y;
      if (manhattan(ally, target) <= 1) break;
    }
  }
  if (manhattan(ally, target) <= 1) monsterAttack(state, ally, target, meleeAtk, events);
}

function checkCombatEnd(state, events) {
  if (state.mode !== 'combat') return false;
  // combat ends when every monster that joined this fight is dead or fled
  const foes = (state.combat.order || [])
    .map(o => state.entities.find(e => e.id === o.id))
    .filter(e => e && e.kind === 'monster' && e.alive && !e.fled);
  if (foes.length === 0) {
    state.mode = 'explore';
    state.flags.reckless = false;
    const ev = { type: 'combat_end', narrate: true, text: 'The last enemy falls. The crypt falls silent again.' };
    events.push(ev); addLog(state, 'mech', ev.text);
    const visible = computeVision(state); markDiscovered(state, visible);
    checkRoomEntry(state, events);
    return true;
  }
  return false;
}

// ---------------------------------------------------------------- XP / rest ----
function awardXp(state, amount, events) {
  const char = state.character;
  char.xp += amount;
  addLog(state, 'mech', `XP: +${amount} (total ${char.xp}).`);
  for (const [lvl, threshold] of Object.entries(XP_THRESHOLDS)) {
    if (char.level < +lvl && char.xp >= threshold) levelUp(state, +lvl, events);
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
    const list = SPELLS.filter(s => s.level === 1 && s.classes.includes(char.className) && !char.spellcasting.spells.includes(s.id));
    if (list.length) char.spellcasting.spells.push(list[0].id);
  }
  const ev = { type: 'levelup', narrate: true, text: `LEVEL UP! ${char.name} reaches level ${newLevel}! Hit points rise to ${char.hpMax} and new powers awaken.`, data: { level: newLevel } };
  events.push(ev); addLog(state, 'system', ev.text);
}

function shortRest(state, events) {
  const char = state.character;
  const p = playerEntity(state);
  if (state.mode === 'combat') { events.push({ type: 'error', text: 'You cannot rest while enemies are near!' }); return; }
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
  const camp = state.map.victoryTile;
  if (!(p.x === camp.x && p.y === camp.y)) { events.push({ type: 'error', text: 'You can only take a long rest at your campfire in the Entrance Hall.' }); return; }
  p.hp = p.hpMax; p.tempHp = 0; p.conditions = [];
  char.hdUsed = 0;
  char.slots = { ...char.slotsMax };
  char.uses = {}; char.pools = {};
  const cls = byId(CLASSES, char.className);
  applyClassAndSpecies(char, cls, null, char.level); // re-init uses/pools
  char.freeSpellUses = 0;
  char.uses.arcane_recovery_used = false;
  state.flags.dropUsed = false;
  state.flags.savage_used = false;
  state.flags.reckless = false;
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
  let roll = d20({ reroll1: char.rerollNat1 });
  let total = roll.natural + skillMod(char, skill) + bonus;
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
  chest.looted = true;
  const char = state.character;
  char.gold += chest.loot.gold || 0;
  const parts = [];
  for (let i = 0; i < (chest.loot.potions || 0); i++) addItemToInventory(char, 'potion_healing');
  (chest.loot.items || []).forEach(it => { addItemToInventory(char, it.id, it.qty || 1); parts.push(itemName(it.id)); });
  applyPickupEffects(state, chest.loot.items || [], events);
  const ev = {
    type: 'loot', narrate: true,
    text: `${p_name(state)} pries open the ${chest.name}: ${chest.loot.gold || 0} gold pieces` +
      `${chest.loot.potions ? `, ${chest.loot.potions} Potion${chest.loot.potions > 1 ? 's' : ''} of Healing` : ''}` +
      `${parts.length ? ` — and ${parts.join(', ')}!` : '!'}` +
      `${parts.length ? ' A treasure of real power.' : ''}`
  };
  events.push(ev); addLog(state, 'mech', ev.text);
}

// Roll a slain monster's loot table: gold dice + chance-based items
function rollLoot(state, mon, events) {
  const def = byId(MONSTERS, mon.monsterId);
  if (!def || !def.loot) return;
  const char = state.character;
  const parts = [];
  if (def.loot.gold) {
    const g = rollExpr(def.loot.gold).total;
    if (g > 0) { char.gold += g; parts.push(`${g} gp`); }
  }
  const gained = [];
  (def.loot.items || []).forEach(it => {
    if (Math.random() < (it.chance === undefined ? 1 : it.chance)) {
      const qty = it.qty || 1;
      addItemToInventory(char, it.id, qty);
      parts.push(itemName(it.id));
      gained.push(it);
    }
  });
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
    const def = byId(GEAR, it.id);
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
  if (obj.type === 'chest') return lootChest(state, obj, events);
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
  SPECIES, CLASSES, BACKGROUNDS, FEATS, WEAPONS, ARMORS, GEAR, SPELLS, MONSTERS, ALLY_DEF, MAPS,
  ABILITIES, SKILL_ABILITY, ALL_SKILLS, XP_THRESHOLDS, SLOTS, DIFFICULTY, SHOP_ITEMS,
  die, rollExpr, d20, mod, cap, byId,
  buildCharacter, applyClassAndSpecies, skillMod, passivePerception,
  getMap, tileChar, isWall, isDifficult, entityAt, roomAt, los, manhattan, bfsPath, computeVision, markDiscovered,
  startGame, addLog, playerEntity, currentActor, endTurn, beginPlayerTurn, currentSpeed,
  hasBuff, getBuff, addBuff, removeBuff, currentAc, charHasArmor,
  alertCheck, startCombat, checkCombatEnd, processUntilPlayer,
  movePlayer, playerAttack, castSpell, findSpell, interactObject, interactDoor,
  shortRest, longRest, skillCheck, damageRoll, applyDamage, healEntity, awardXp, checkPlayerDeath,
  triggerTrap, noticeTrapsNearby, alertForcedNoise, attackMods, monsterAttack, processMonsterTurn, processAllyTurn,
  rollLoot, lootChest, applyPickupEffects, itemName, addItemToInventory, resolveWeapon
};
