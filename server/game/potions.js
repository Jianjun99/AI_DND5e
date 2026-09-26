// potions.js — Experimental potions (random good/mixed/bad brews) and delve-only tokens.
//
// Design: a brew's outcome is rolled ONCE when it is bought and stored on that bottle
// instance (same uniqueId convention as the affix gear). The player can identify the
// bottle with an Intelligence (Arcana) check to learn what it will do — or drink it blind.
// Every beneficial/harmful effect is expressed through buff ids and state the engine
// already reads, so nothing here needs new combat math.

// ---------------------------------------------------------------- tiers ----
const POTION_TIERS = {
  thin: {
    id: 'thin', name: '浑浊的小瓶', english: 'Cloudy Vial', cost: 15, dc: 12,
    odds: { good: 55, mixed: 25, bad: 20 },
    blurb: 'A muddy suspension that smells faintly of pond water. Cheap for a reason.',
    clues: ['气味：潮湿的泥土', '颜色：灰绿浑浊', '挂壁：缓慢、油亮']
  },
  standard: {
    id: 'standard', name: '冒泡的药剂', english: 'Bubbling Draught', cost: 40, dc: 14,
    odds: { good: 65, mixed: 22, bad: 13 },
    blurb: 'It fizzes against the cork as if impatient to be drunk.',
    clues: ['气味：柑橘混着铁锈', '颜色：琥珀色、持续冒泡', '挂壁：清亮']
  },
  fine: {
    id: 'fine', name: '虹彩的精华', english: 'Iridescent Essence', cost: 90, dc: 16,
    odds: { good: 75, mixed: 20, bad: 5 },
    blurb: 'Light bends strangely inside the glass. The alchemist charges accordingly.',
    clues: ['气味：雨后石楠花', '颜色：流动的虹彩', '挂壁：像活物一样缓慢爬行']
  }
};

const POTION_TIER_KEYS = Object.keys(POTION_TIERS);

// ---------------------------------------------------------------- effects ----
// ctx = { state, char, p, events, log, engine, roll }
// `apply` mutates the delve state through the engine's public helpers.
const POTION_EFFECTS = [
  // ---------------- good ----------------
  {
    id: 'body', kind: 'good', weight: 3, name: '强化体魄',
    desc: '肉块膨胀，护住要害（获得 2d6 临时生命）',
    apply: ({ engine, p, events, roll }) => {
      const r = roll('2d6');
      p.tempHp = (p.tempHp || 0) + r.total;
      events.push({ type: 'brew_effect', narrate: true, text: `Your flesh swells with borrowed vigour: ${r.total} temporary HP.` });
    }
  },
  {
    id: 'speed', kind: 'good', weight: 2, name: '迅捷如风',
    desc: '双腿轻快如风（本场地牢速度 +10 尺）',
    apply: ({ engine, p, events }) => {
      engine.addBuff(p, { id: 'longstrider', rounds: 9999 });
      events.push({ type: 'brew_effect', narrate: true, text: 'The world slows down around you: +10 ft speed for the rest of the delve.' });
    }
  },
  {
    id: 'ward', kind: 'good', weight: 2, name: '护体符记',
    desc: '皮肤浮现淡金符纹（本场地牢攻击与伤害 +1）',
    apply: ({ engine, p, events }) => {
      engine.addBuff(p, { id: 'altar_blessed', rounds: 9999 });
      events.push({ type: 'brew_effect', narrate: true, text: 'Faint golden sigils crawl across your skin: +1 to hit and damage this delve.' });
    }
  },
  {
    id: 'fortune', kind: 'good', weight: 2, name: '猎人之眼',
    desc: '瞳孔竖起，看穿破绽（本场地牢攻击检定享有优势）',
    apply: ({ engine, p, events }) => {
      engine.addBuff(p, { id: 'brew_fortune', rounds: 9999 });
      events.push({ type: 'brew_effect', narrate: true, text: 'Your pupils split like a cat\u2019s — advantage on attack rolls this delve.' });
    }
  },
  {
    id: 'bless', kind: 'good', weight: 2, name: '灵光祝福',
    desc: '周身环绕微光（10 轮内攻击检定 +1d4）',
    apply: ({ engine, p, events }) => {
      engine.addBuff(p, { id: 'blessed', rounds: 10 });
      events.push({ type: 'brew_effect', narrate: true, text: 'A warm halo settles over you: +1d4 to attack rolls for 10 rounds.' });
    }
  },
  {
    id: 'vigor', kind: 'good', weight: 2, name: '强健',
    desc: '筋骨被撑紧（本场地牢最大生命 +5）',
    apply: ({ engine, state, events }) => {
      engine.adjustTempHp(state, 5, events, 'the brew');
      events.push({ type: 'brew_effect', narrate: true, text: 'Your bones feel denser: +5 max HP for the rest of the delve.' });
    }
  },
  {
    id: 'slot', kind: 'good', weight: 1, name: '回气',
    desc: '喉咙里泛起冷冽的甜（回满最低环法术位）',
    apply: ({ char, events }) => {
      const levels = Object.keys(char.slotsMax || {}).map(Number).sort((a, b) => a - b);
      const lowest = levels.find(l => (char.slotsMax[l] || 0) > 0);
      if (lowest) {
        char.slots = char.slots || {};
        char.slots[lowest] = char.slotsMax[lowest];
        events.push({ type: 'brew_effect', narrate: true, text: `Your lowest spell slots refill (level ${lowest}).` });
      } else {
        events.push({ type: 'brew_effect', narrate: true, text: 'A cold sweetness floods your throat — but you had no spent magic left to restore.' });
      }
    }
  },

  // ---------------- mixed ----------------
  {
    id: 'stimulant', kind: 'mixed', weight: 3, name: '烈性兴奋',
    desc: '心跳如鼓：速度 +10 尺（10 轮），但随后中毒（5 轮）',
    apply: ({ engine, p, events }) => {
      engine.addBuff(p, { id: 'longstrider', rounds: 10 });
      engine.applyCondition({ id: 'poisoned', rounds: 5 }, p);
      events.push({ type: 'brew_effect', narrate: true, text: 'Your heart hammers — swift for a moment, then the shakes set in (poisoned 5 rounds).' });
    }
  },
  {
    id: 'bitter_after', kind: 'mixed', weight: 3, name: '苦味回甘',
    desc: '伤口收紧愈合（回复 2d4+2），但胃里翻江倒海（本场少一段休息）',
    apply: ({ engine, state, p, events, roll }) => {
      const r = roll('2d4+2');
      engine.healEntity(state, p, r.total, events, 'bitter draught');
      engine.blockRest(state, 1);
      events.push({ type: 'brew_effect', narrate: true, text: 'The wound knits shut, but your stomach will not settle: one rest lost this delve.' });
    }
  },
  {
    id: 'volatile', kind: 'mixed', weight: 2, name: '躁动之气',
    desc: '护体之气涌动（2d6 临时生命），但内里灼烧（自身 1d6 火焰伤害）',
    apply: ({ engine, state, p, events, roll }) => {
      const shield = roll('2d6');
      const burn = roll('1d6');
      p.tempHp = (p.tempHp || 0) + shield.total;
      engine.applyDamage(state, p, burn.total, 'fire', events);
      events.push({ type: 'brew_effect', narrate: true, text: `Steam hisses from your pores: ${shield.total} temporary HP, but ${burn.total} fire damage.` });
    }
  },
  {
    id: 'sensory', kind: 'mixed', weight: 2, name: '感官过载',
    desc: '五感锐利（10 轮攻击 +1d4），但眼花（中毒 5 轮）',
    apply: ({ engine, p, events }) => {
      engine.addBuff(p, { id: 'blessed', rounds: 10 });
      engine.applyCondition({ id: 'poisoned', rounds: 5 }, p);
      events.push({ type: 'brew_effect', narrate: true, text: 'Colours sharpen past bearing: +1d4 to attacks for 10 rounds, poisoned for 5.' });
    }
  },

  // ---------------- bad ----------------
  {
    id: 'poison', kind: 'bad', weight: 3, name: '中毒',
    desc: '剧毒（中毒 10 轮：攻击检定劣势）',
    apply: ({ engine, p, events }) => {
      engine.applyCondition({ id: 'poisoned', rounds: 10 }, p);
      events.push({ type: 'brew_effect', narrate: true, text: 'Your veins burn — poisoned for 10 rounds.' });
    }
  },
  {
    id: 'burning', kind: 'bad', weight: 2, name: '烈火攻心',
    desc: '内火外泄（自身 1d6 火焰伤害，中毒 3 轮）',
    apply: ({ engine, state, p, events, roll }) => {
      const r = roll('1d6');
      engine.applyDamage(state, p, r.total, 'fire', events);
      engine.applyCondition({ id: 'poisoned', rounds: 3 }, p);
      events.push({ type: 'brew_effect', narrate: true, text: `Fire crawls up your throat: ${r.total} damage and poisoned for 3 rounds.` });
    }
  },
  {
    id: 'heavy', kind: 'bad', weight: 3, name: '四肢沉重',
    desc: '四肢灌铅（本场地牢最大生命 -5，减速 10 轮）',
    apply: ({ engine, state, p, events }) => {
      engine.adjustTempHp(state, -5, events, 'the brew');
      engine.applyCondition({ id: 'slowed', rounds: 10, speedPenalty: 10 }, p);
      events.push({ type: 'brew_effect', narrate: true, text: 'Your limbs turn to lead: -5 max HP this delve and slowed for 10 rounds.' });
    }
  },
  {
    id: 'queasy', kind: 'bad', weight: 3, name: '反胃',
    desc: '胃里翻搅（本场少一段休息，中毒 3 轮）',
    apply: ({ engine, state, p, events }) => {
      engine.blockRest(state, 1);
      engine.applyCondition({ id: 'poisoned', rounds: 3 }, p);
      events.push({ type: 'brew_effect', narrate: true, text: 'You double over: one rest lost this delve, poisoned for 3 rounds.' });
    }
  },
  {
    id: 'drain', kind: 'bad', weight: 2, name: '抽取生机',
    desc: '气力被抽走（消耗 1 个生命骰）',
    apply: ({ char, events }) => {
      char.hdUsed = (char.hdUsed || 0) + 1;
      events.push({ type: 'brew_effect', narrate: true, text: 'Something drinks a measure of your stamina: one hit die spent.' });
    }
  },
  {
    id: 'comic', kind: 'bad', weight: 2, name: '无害滑稽',
    desc: '皮肤泛起怪色、说话冒泡——没别的（无属性影响）',
    apply: ({ events }) => {
      events.push({ type: 'brew_effect', narrate: true, text: 'Your skin turns a startling shade of indigo and your voice bubbles for a moment. Nothing else happens — probably.' });
    }
  }
];

/** @type {Record<string, typeof POTION_EFFECTS[number][]>} */
const EFFECTS_BY_KIND = POTION_EFFECTS.reduce((acc, e) => {
  (acc[e.kind] = acc[e.kind] || []).push(e);
  return acc;
}, {});

// ---------------------------------------------------------------- rolling ----
let brewCounter = 0;

function rollEffect(kind, rng = Math.random) {
  const pool = EFFECTS_BY_KIND[kind] || EFFECTS_BY_KIND.good;
  const total = pool.reduce((s, e) => s + (e.weight || 1), 0);
  let roll = rng() * total;
  for (const e of pool) {
    roll -= (e.weight || 1);
    if (roll < 0) return e;
  }
  return pool[pool.length - 1];
}

function rollKind(tier, rng = Math.random) {
  const odds = (POTION_TIERS[tier] || POTION_TIERS.standard).odds;
  const total = odds.good + odds.mixed + odds.bad;
  const r = rng() * total;
  if (r < odds.good) return 'good';
  if (r < odds.good + odds.mixed) return 'mixed';
  return 'bad';
}

// A bottle instance: the outcome is decided here, once, and hidden until identified.
function rollMysteryPotion(tier = 'standard', rng = Math.random, forcedKind = null) {
  const t = POTION_TIERS[tier] ? POTION_TIERS[tier] : POTION_TIERS.standard;
  const kind = forcedKind || rollKind(t.id, rng);
  const effect = rollEffect(kind, rng);
  brewCounter = (brewCounter + 1) % 46656;
  const uid = `brew_${t.id}_${Date.now().toString(36).slice(-4)}${brewCounter.toString(36)}`;
  return {
    itemId: `potion_mystery_${t.id}`,
    uniqueId: uid,
    name: t.name,
    englishName: t.english,
    kind: 'mystery_potion',
    tier: t.id,
    identified: false,
    effect: { id: effect.id, kind: effect.kind, name: effect.name, desc: effect.desc },
    clues: t.clues,
    cost: t.cost,
    desc: '一瓶来源不明的药剂。可以盲喝，也可以用智力（奥秘）检定鉴定。',
    qty: 1
  };
}

// ---------------------------------------------------------------- drinking ----
// ctx is supplied by the caller (route or test): {
//   state, char, p, events, engine, roll(expr) → { total },
//   skill: { total, dc, success }   (from an identification, optional)
// }
function drinkMysteryPotion(bottle, ctx) {
  const { events } = ctx;
  const tier = POTION_TIERS[bottle.tier] || POTION_TIERS.standard;
  const effectDef = POTION_EFFECTS.find(e => e.id === (bottle.effect && bottle.effect.id));
  if (!effectDef) {
    events.push({ type: 'error', text: 'That brew has lost its virtue.' });
    return null;
  }
  const kind = effectDef.kind;
  events.push({
    type: 'brew_drink',
    narrate: true,
    text: `You drink the ${bottle.name}${bottle.identified ? ` (${effectDef.name})` : ' — unidentified'}.`
  });
  effectDef.apply({ ...ctx, tier });
  return {
    kind,
    effectId: effectDef.id,
    effectName: effectDef.name,
    tier: tier.id,
    text: `${tier.name}：${effectDef.name} — ${effectDef.desc}`
  };
}

// ---------------------------------------------------------------- identify ----
// One attempt per bottle: success reveals the roll permanently, failure leaves you blind.
function identifyPotion(char, ref, checkTotal) {
  const entry = char.inventory.find(i => i.uniqueId === ref || i.itemId === ref);
  if (!entry || entry.kind !== 'mystery_potion') return { ok: false, error: 'That is not an unidentified brew.' };
  if (entry.identified) return { ok: false, error: 'This bottle has already been identified.' };
  if (entry.identifyFailed) return { ok: false, error: 'You already failed to read this one — drink it blind or sell it.' };
  const tier = POTION_TIERS[entry.tier] || POTION_TIERS.standard;
  const success = checkTotal >= tier.dc;
  if (success) {
    entry.identified = true;
    entry.name = `${tier.name} · ${entry.effect.name}`;
    entry.desc = entry.effect.desc;
  } else {
    entry.identifyFailed = true;
  }
  return {
    ok: true,
    success,
    dc: tier.dc,
    checkTotal,
    effect: success ? entry.effect : null,
    text: success
      ? `鉴定成功（${checkTotal} vs DC ${tier.dc}）：${entry.effect.name} — ${entry.effect.desc}`
      : `鉴定失败（${checkTotal} vs DC ${tier.dc}）：你只闻到一股说不清的味道。`
  };
}

// ---------------------------------------------------------------- tokens ----
// Delve-only prizes: usable inside a delve, gone when it ends.
const DELVE_TOKENS = {
  luck: {
    id: 'luck', name: '幸运币', icon: '🪙', value: 40,
    desc: '地牢内使用：本场地牢所有 d20 检定 +1',
    apply: ({ engine, p, events }) => {
      engine.addBuff(p, { id: 'altar_blessed', rounds: 9999 });
      events.push({ type: 'token_used', narrate: true, text: 'You flip the coin and it never lands — +1 to your rolls this delve.' });
    }
  },
  ward: {
    id: 'ward', name: '护身符', icon: '🛡️', value: 30,
    desc: '地牢内使用：本场地牢最大生命 +5',
    apply: ({ engine, state, events }) => {
      engine.adjustTempHp(state, 5, events, 'the talisman');
      events.push({ type: 'token_used', narrate: true, text: 'The talisman grows warm: +5 max HP this delve.' });
    }
  },
  bane: {
    id: 'bane', name: '屠戮油', icon: '⚔️', value: 40,
    desc: '地牢内使用：本场地牢武器攻击 +1d4 伤害',
    apply: ({ engine, p, events }) => {
      engine.addBuff(p, { id: 'divine_favor', rounds: 9999 });
      events.push({ type: 'token_used', narrate: true, text: 'You work the oil into your blade: +1d4 damage this delve.' });
    }
  },
  swift: {
    id: 'swift', name: '疾行靴钉', icon: '👟', value: 25,
    desc: '地牢内使用：本场地牢速度 +10 尺',
    apply: ({ engine, p, events }) => {
      engine.addBuff(p, { id: 'longstrider', rounds: 9999 });
      events.push({ type: 'token_used', narrate: true, text: 'The nails bite into your boots: +10 ft speed this delve.' });
    }
  },
  calm: {
    id: 'calm', name: '静息香', icon: '🕯️', value: 20,
    desc: '地牢内使用：清除一次「安息被打断」',
    apply: ({ engine, state, events }) => {
      const before = state.flags.restsBlocked || 0;
      engine.blockRest(state, -1);
      events.push({
        type: 'token_used', narrate: true,
        text: before > 0 ? 'Sweet smoke settles your stomach — a lost rest is restored.' : 'Sweet smoke fills the air, but nothing was troubling your rest.'
      });
    }
  },
  purge: {
    id: 'purge', name: '净瓶', icon: '🧴', value: 20,
    desc: '地牢内使用：清除本场地牢所有诅咒（生命惩罚与安息打断）',
    apply: ({ engine, state, p, events }) => {
      engine.adjustTempHp(state, 0, events, 'the purge', { clear: true });
      state.flags.restsBlocked = 0;
      p.buffs = (p.buffs || []).filter(b => b.condId !== 'poisoned');
      p.conditions = (p.conditions || []).filter(c => c !== 'poisoned');
      events.push({ type: 'token_used', narrate: true, text: 'The clear water scours every trace of the brew from your body: curses lifted.' });
    }
  },
  scrollpack: {
    id: 'scrollpack', name: '卷轴包', icon: '📜', value: 35,
    desc: '地牢内使用：获得一张随机卷轴',
    apply: ({ engine, char, events, rng }) => {
      const scrolls = ['scroll_magic_missile', 'scroll_shield', 'scroll_cure', 'scroll_sleep'];
      const pick = scrolls[Math.floor((rng ? rng() : Math.random()) * scrolls.length)] || scrolls[0];
      engine.addItemToInventory(char, pick);
      events.push({ type: 'token_used', narrate: true, text: `You unroll the packet and find a ${engine.itemName(pick)}.` });
    }
  },
  heal: {
    id: 'heal', name: '大药剂', icon: '🧪', value: 50,
    desc: '地牢内使用：获得一瓶强效治疗药水',
    apply: ({ engine, char, events }) => {
      engine.addItemToInventory(char, 'potion_greater');
      events.push({ type: 'token_used', narrate: true, text: 'A heavy flask of deep red liquid — a potion of greater healing.' });
    }
  }
};

const TOKEN_KEYS = Object.keys(DELVE_TOKENS);

function makeToken(tokenId, rng = Math.random) {
  const def = DELVE_TOKENS[tokenId] || DELVE_TOKENS.luck;
  brewCounter = (brewCounter + 1) % 46656;
  return {
    itemId: `token_${def.id}`,
    uniqueId: `token_${def.id}_${Date.now().toString(36).slice(-4)}${brewCounter.toString(36)}`,
    name: `${def.icon} ${def.name}`,
    kind: 'delve_token',
    tokenId: def.id,
    delveOnly: true,
    desc: def.desc,
    cost: def.value,
    qty: 1
  };
}

// Using a token inside a delve: applies the effect and consumes it.
function useToken(token, ctx) {
  const def = DELVE_TOKENS[token.tokenId];
  if (!def) {
    ctx.events.push({ type: 'error', text: 'That token crumbles to dust without effect.' });
    return null;
  }
  def.apply(ctx);
  return { tokenId: def.id, name: def.name, text: def.desc };
}

module.exports = {
  POTION_TIERS,
  POTION_TIER_KEYS,
  POTION_EFFECTS,
  EFFECTS_BY_KIND,
  DELVE_TOKENS,
  TOKEN_KEYS,
  rollEffect,
  rollKind,
  rollMysteryPotion,
  drinkMysteryPotion,
  identifyPotion,
  makeToken,
  useToken
};
