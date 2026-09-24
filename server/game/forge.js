// forge.js — the armory forge: salvage unwanted magic gear into essence, then reroll an
// affix or upgrade an item's rarity. Every transformation goes back through
// affixes.buildAffixItem, so forged items obey exactly the same rules as dropped ones.
//
// Currencies: gold (the usual) + 余烬精华 (essence), earned by salvaging magic items and by
// killing elite champions / bosses.

const affixes = require('./affixes');

const RARITY_ORDER = ['magic', 'rare', 'legendary'];

// essence yielded by melting an item down
const SALVAGE_ESSENCE = { magic: 1, rare: 2, legendary: 4 };
// gold returned on top (a fraction of the item's own value)
const SALVAGE_GOLD_RATE = 0.2;

// essence granted straight to the killer
const KILL_ESSENCE = { elite: 1, boss: 2 };

const FORGE_COSTS = {
  reroll: {
    magic: { gold: 60, essence: 1 },
    rare: { gold: 150, essence: 2 },
    legendary: { gold: 400, essence: 3 }
  },
  upgrade: {
    magic: { gold: 200, essence: 2 },   // -> rare
    rare: { gold: 600, essence: 4 },    // -> legendary
    legendary: null                     // already at the top
  }
};

// Only rolled instances (dropped loot) can be forged — plain shop gear and quest items cannot.
function isForgeable(item) {
  return !!(item && item.rarity && item.affix && ['weapon', 'armor', 'shield'].includes(item.type));
}

function salvageValue(item) {
  if (!isForgeable(item)) return { essence: 0, gold: 0, ok: false, error: '这件东西不值得回炉。' };
  return {
    ok: true,
    essence: SALVAGE_ESSENCE[item.rarity] || 1,
    gold: Math.max(1, Math.round((item.cost || 10) * SALVAGE_GOLD_RATE))
  };
}

function forgeCost(action, rarity) {
  const table = FORGE_COSTS[action];
  if (!table) return null;
  return table[rarity] || null;
}

// Swap the affix, keep the rarity and the identity (uniqueId stays put so equipped slots,
// favourite macros and tooltips all keep pointing at the same item).
function rerollAffix(item, rng = Math.random) {
  if (!isForgeable(item)) return { ok: false, error: '这件装备没有可重铸的词缀。' };
  const base = affixes.baseById(item.itemId);
  if (!base) return { ok: false, error: '找不到这件装备的基础类型。' };
  const pool = affixes.affixPoolFor(item.type).filter(a => a.id !== item.affix);
  if (!pool.length) return { ok: false, error: '没有别的词缀可换。' };
  const next = pool[Math.floor(rng() * pool.length)] || pool[0];
  const rebuilt = affixes.buildAffixItem(base, next, item.rarity, item.uniqueId);
  return {
    ok: true,
    item: rebuilt,
    from: item.affix,
    to: next.id,
    text: `${rebuilt.name}（${next.desc}）`
  };
}

// Raise rarity one step: magic -> rare -> legendary, same affix, same identity.
function upgradeRarity(item) {
  if (!isForgeable(item)) return { ok: false, error: '这件装备无法升阶。' };
  const idx = RARITY_ORDER.indexOf(item.rarity);
  if (idx < 0 || idx >= RARITY_ORDER.length - 1) return { ok: false, error: '已经是传奇品质，无法再升。' };
  const nextRarity = RARITY_ORDER[idx + 1];
  const base = affixes.baseById(item.itemId);
  const affix = affixes.affixById(item.affix, item.type);
  if (!base || !affix) return { ok: false, error: '找不到这件装备的原始配方。' };
  const rebuilt = affixes.buildAffixItem(base, affix, nextRarity, item.uniqueId);
  return {
    ok: true,
    item: rebuilt,
    from: item.rarity,
    to: nextRarity,
    text: `${rebuilt.name}（${rebuilt.desc}）`
  };
}

// Apply the transformed item back into the character's inventory in place.
function replaceItem(char, item) {
  const idx = (char.inventory || []).findIndex(i => i.uniqueId === item.uniqueId);
  if (idx < 0) return false;
  char.inventory[idx] = { ...char.inventory[idx], ...item, qty: char.inventory[idx].qty || 1 };
  return true;
}

function rarityLabel(rarity) {
  return rarity === 'legendary' ? '传奇 🟠' : rarity === 'rare' ? '稀有 🟣' : '魔法 🔵';
}

module.exports = {
  RARITY_ORDER,
  SALVAGE_ESSENCE,
  KILL_ESSENCE,
  FORGE_COSTS,
  isForgeable,
  salvageValue,
  forgeCost,
  rerollAffix,
  upgradeRarity,
  replaceItem,
  rarityLabel
};
