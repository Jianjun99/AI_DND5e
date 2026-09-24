// server/game/affixes.js — Elite Champion Affixes and Loot Rarity System
// Provides rules-grounded procedural affixes for monsters and equipment drops.

const MONSTER_AFFIXES = {
  blazing: {
    id: 'blazing',
    name: '炽炎的',
    english: 'Blazing',
    color: '#f97316',
    lightColor: 0xf97316,
    hpMult: 1.25,
    bonusDamage: { dice: '1d4', type: 'fire' },
    resistance: ['fire'],
    desc: '+25% HP, +1d4 fire damage on attacks, resistant to fire'
  },
  stone_skinned: {
    id: 'stone_skinned',
    name: '石肤',
    english: 'Stone-skinned',
    color: '#a8a29e',
    lightColor: 0xd97706,
    hpMult: 1.40,
    acBonus: 2,
    resistance: ['slashing', 'bludgeoning', 'piercing'],
    nonmagicalPhysical: true,
    desc: '+40% HP, +2 AC, resistant to non-magical weapons'
  },
  vampiric: {
    id: 'vampiric',
    name: '嗜血',
    english: 'Vampiric',
    color: '#dc2626',
    lightColor: 0xef4444,
    hpMult: 1.20,
    vampiricLeech: 0.5,
    desc: '+20% HP, heals 50% of damage dealt to player or ally'
  },
  venomous: {
    id: 'venomous',
    name: '剧毒',
    english: 'Venomous',
    color: '#22c55e',
    lightColor: 0x22c55e,
    hpMult: 1.20,
    bonusDamage: { dice: '1d4', type: 'poison' },
    inflictsCondition: 'poisoned',
    desc: '+20% HP, +1d4 poison damage, attacks inflict poisoned condition'
  },
  storm_charged: {
    id: 'storm_charged',
    name: '狂雷',
    english: 'Storm-charged',
    color: '#06b6d4',
    lightColor: 0x38bdf8,
    hpMult: 1.15,
    speedBonus: 10,
    attackBonus: 2,
    bonusDamage: { dice: '1d4', type: 'lightning' },
    desc: '+10 ft speed, +2 attack bonus, +1d4 lightning damage'
  }
};

const MONSTER_AFFIX_KEYS = Object.keys(MONSTER_AFFIXES);

function rollMonsterAffix() {
  const k = MONSTER_AFFIX_KEYS[Math.floor(Math.random() * MONSTER_AFFIX_KEYS.length)];
  return MONSTER_AFFIXES[k];
}

function applyMonsterAffix(monster, affixKey) {
  if (monster.isElite) return monster; // never stack affixes on the same champion
  const affix = MONSTER_AFFIXES[affixKey] || rollMonsterAffix();
  monster.isElite = true;
  monster.affix = {
    id: affix.id,
    name: affix.name,
    english: affix.english,
    color: affix.color,
    lightColor: affix.lightColor,
    bonusDamage: affix.bonusDamage,
    vampiricLeech: affix.vampiricLeech,
    inflictsCondition: affix.inflictsCondition,
    nonmagicalPhysical: !!affix.nonmagicalPhysical,
    desc: affix.desc
  };
  monster.name = `${affix.name}${monster.name}`;
  monster.hp = Math.round(monster.hp * (affix.hpMult || 1.2));
  monster.hpMax = monster.hp;
  monster.xp = Math.round((monster.xp || 50) * 1.5);
  if (affix.acBonus) monster.ac += affix.acBonus;
  if (affix.speedBonus) monster.speedFt = (monster.speedFt || 30) + affix.speedBonus;
  // attack bonuses must be applied to a copy — the content registry shares one attacks array
  if (affix.attackBonus) monster.attacks = (monster.attacks || []).map(a => ({ ...a, bonus: (a.bonus || 0) + affix.attackBonus }));
  if (affix.resistance) {
    monster.resistances = (monster.resistances || []).slice();
    affix.resistance.forEach(r => { if (!monster.resistances.includes(r)) monster.resistances.push(r); });
  }
  return monster;
}

// ------------------------------------------------------------- Item Affixes ----
const WEAPON_AFFIXES = [
  { id: 'blazing', prefix: '炽火之', english: 'Blazing', bonusDamage: { dice: '1d4', type: 'fire' }, desc: '+1d4 fire damage' },
  { id: 'venomous', prefix: '剧毒之', english: 'Venomous', bonusDamage: { dice: '1d4', type: 'poison' }, desc: '+1d4 poison damage' },
  { id: 'shocking', prefix: '狂雷之', english: 'Shocking', bonusDamage: { dice: '1d4', type: 'lightning' }, desc: '+1d4 lightning damage' },
  { id: 'vampiric', prefix: '嗜血之', english: 'Vampiric', vampiricHeal: 2, desc: 'Restores 2 HP on hit' },
  { id: 'keen', prefix: '锋锐之', english: 'Keen', magic: 1, desc: '+1 to attack rolls' }
];

const ARMOR_AFFIXES = [
  { id: 'stalwart', prefix: '坚毅之', english: 'Stalwart', acBonus: 1, desc: '+1 AC' },
  { id: 'vigor', prefix: '活力之', english: 'Vigor', hpBonus: 5, desc: '+5 Max HP while equipped' },
  { id: 'fleet', prefix: '轻捷之', english: 'Fleet', speedBonus: 5, desc: '+5 ft movement speed' }
];

const BASE_WEAPONS = [
  { id: 'longsword', name: '长剑', english: 'Longsword', type: 'weapon', cost: 15 },
  { id: 'shortsword', name: '短剑', english: 'Shortsword', type: 'weapon', cost: 10 },
  { id: 'greatsword', name: '巨剑', english: 'Greatsword', type: 'weapon', cost: 50 },
  { id: 'battleaxe', name: '战斧', english: 'Battleaxe', type: 'weapon', cost: 10 },
  { id: 'rapier', name: '刺剑', english: 'Rapier', type: 'weapon', cost: 25 },
  { id: 'dagger', name: '匕首', english: 'Dagger', type: 'weapon', cost: 2 },
  { id: 'mace', name: '硬头锤', english: 'Mace', type: 'weapon', cost: 5 },
  { id: 'longbow', name: '长弓', english: 'Longbow', type: 'weapon', cost: 50 }
];

const BASE_ARMORS = [
  { id: 'leather', name: '皮甲', english: 'Leather Armor', type: 'armor', cost: 10 },
  { id: 'chain_shirt', name: '锁子衫', english: 'Chain Shirt', type: 'armor', cost: 50 },
  { id: 'chain_mail', name: '锁子甲', english: 'Chain Mail', type: 'armor', cost: 75 },
  { id: 'breastplate', name: '胸甲', english: 'Breastplate', type: 'armor', cost: 400 },
  { id: 'shield', name: '盾牌', english: 'Shield', type: 'shield', cost: 10 }
];

const uidCounter = { n: 0 };

// Base catalogue row for a rolled item (weapons and armour/shields live in separate pools).
function baseById(id) {
  return BASE_WEAPONS.find(b => b.id === id) || BASE_ARMORS.find(b => b.id === id) || null;
}

function affixPoolFor(type) {
  return type === 'weapon' ? WEAPON_AFFIXES : ARMOR_AFFIXES;
}

function affixById(id, type) {
  return affixPoolFor(type).find(a => a.id === id) || null;
}

// Assemble a rolled item from a base + affix + rarity. This is the single source of truth for
// what "+1 flaming longsword" means — loot drops and the forge both go through it.
function buildAffixItem(base, affix, rarity = 'magic', uniqueId = null) {
  const isWeapon = base.type === 'weapon';
  const isRare = rarity === 'rare';
  const isLegendary = rarity === 'legendary';

  const magicBonus = isLegendary ? 2 : (isRare ? 1 : (affix.magic || 0));

  let namePrefix = affix.prefix;
  if (isRare) namePrefix = `精铸·${namePrefix}`;
  if (isLegendary) namePrefix = `传奇·${namePrefix}`;

  const descParts = [];
  if (magicBonus > 0 && isWeapon) descParts.push(`+${magicBonus} 攻击检定`);
  if (affix.bonusDamage) {
    const dice = isLegendary ? '1d6' : affix.bonusDamage.dice;
    descParts.push(`+${dice} ${affix.bonusDamage.type} 伤害`);
  }
  if (affix.vampiricHeal) descParts.push(`命中恢复 ${affix.vampiricHeal} 点生命`);
  if (affix.acBonus) descParts.push(`+${affix.acBonus + (isRare ? 1 : 0)} 护甲等级 (AC)`);
  if (affix.hpBonus) descParts.push(`+${affix.hpBonus * (isRare ? 2 : 1)} 最大生命值`);
  if (affix.speedBonus) descParts.push(`+${affix.speedBonus} 移动速度`);

  return {
    itemId: base.id, // keeps clean base compatibility with weapon/armor lookup
    uniqueId: uniqueId || `affix_${affix.id}_${base.id}_${nextUidSuffix()}`,
    name: `${namePrefix}${base.name}`,
    englishName: `${affix.english} ${base.english}`,
    rarity,               // 'magic' | 'rare' | 'legendary'
    affix: affix.id,
    type: base.type,
    magic: magicBonus,
    bonusDamage: affix.bonusDamage ? {
      dice: isLegendary ? '1d6' : affix.bonusDamage.dice,
      type: affix.bonusDamage.type
    } : null,
    vampiricHeal: affix.vampiricHeal || null,
    acBonus: affix.acBonus ? (affix.acBonus + (isRare ? 1 : 0)) : null,
    hpBonus: affix.hpBonus ? (affix.hpBonus * (isRare ? 2 : 1)) : null,
    speedBonus: affix.speedBonus || null,
    cost: Math.round(base.cost * (isLegendary ? 10 : (isRare ? 5 : 2.5))),
    desc: descParts.join('，') || affix.desc,
    qty: 1
  };
}

function nextUidSuffix() {
  uidCounter.n = (uidCounter.n + 1) % 46656;
  return `${Date.now().toString(36).slice(-4)}${uidCounter.n.toString(36)}`;
}

function rollMagicItem(rarity = 'magic', opts = {}) {
  const isWeapon = opts.category ? opts.category === 'weapon' : Math.random() < 0.65;
  const basePool = isWeapon ? BASE_WEAPONS : BASE_ARMORS;
  const base = basePool[Math.floor(Math.random() * basePool.length)];
  const affixPool = isWeapon ? WEAPON_AFFIXES : ARMOR_AFFIXES;
  const affix = affixPool[Math.floor(Math.random() * affixPool.length)];
  return buildAffixItem(base, affix, rarity);
}

module.exports = {
  MONSTER_AFFIXES,
  MONSTER_AFFIX_KEYS,
  rollMonsterAffix,
  applyMonsterAffix,
  WEAPON_AFFIXES,
  ARMOR_AFFIXES,
  BASE_WEAPONS,
  BASE_ARMORS,
  rollMagicItem,
  buildAffixItem,
  baseById,
  affixById,
  affixPoolFor
};

