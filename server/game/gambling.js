// gambling.js — Oakhaven gambling tables (roulette, sic bo, slot machine).
//
// All odds are the real-table odds, so the house edge is authentic rather than invented:
//   roulette (single zero): 1:1 pays on 18/37  -> 97.3% return
//   sic bo big/small: 1:1 on 105/216, triples lose -> 97.2% return
//   slot machine: 5 symbols x 3 reels, paytable designed to ~89% return
// Every function is split into a pure evaluator (enumerable in tests) and a spinner that
// supplies the randomness, so the unit suite can verify the return by enumeration rather
// than by simulation. `rng` defaults to Math.random and can be injected.

// display names for the prize tokens (potions.js does not require this module, so no cycle)
const potions = require('./potions');

const ROULETTE_REDS = [1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36];

const ROULETTE_BETS = [
  { id: 'red', name: '押红', odds: 1, blurb: '18/37 号格为红 · 赔 1:1' },
  { id: 'black', name: '押黑', odds: 1, blurb: '18/37 号格为黑 · 赔 1:1' },
  { id: 'dozen1', name: '第一打 (1-12)', odds: 2, blurb: '12/37 · 赔 2:1' },
  { id: 'dozen2', name: '第二打 (13-24)', odds: 2, blurb: '12/37 · 赔 2:1' },
  { id: 'dozen3', name: '第三打 (25-36)', odds: 2, blurb: '12/37 · 赔 2:1' },
  { id: 'straight', name: '押单号', odds: 35, blurb: '1/37 · 赔 35:1（需填号码 0-36）' }
];

const SICBO_BETS = [
  { id: 'small', name: '押小 (4-10)', odds: 1, blurb: '三同吃 · 赔 1:1' },
  { id: 'big', name: '押大 (11-17)', odds: 1, blurb: '三同吃 · 赔 1:1' },
  { id: 'triple', name: '押豹子 (三同)', odds: 30, blurb: '6/216 · 赔 30:1' }
];

function rouletteColor(n) {
  if (n === 0) return 'green';
  return ROULETTE_REDS.includes(n) ? 'red' : 'black';
}

// Pure: does this spin win the bet? Returns the NET gold change for a stake.
function evalRoulette(bet, stake, spin) {
  const number = spin;
  const color = rouletteColor(number);
  const kind = (bet && bet.id) || 'red';
  let won = false;
  if (kind === 'red' || kind === 'black') won = color === kind;
  else if (kind === 'dozen1') won = number >= 1 && number <= 12;
  else if (kind === 'dozen2') won = number >= 13 && number <= 24;
  else if (kind === 'dozen3') won = number >= 25 && number <= 36;
  else if (kind === 'straight') won = number === (bet.number | 0);
  const odds = (ROULETTE_BETS.find(b => b.id === kind) || ROULETTE_BETS[0]).odds;
  return {
    game: 'roulette', number, color, won, odds,
    delta: won ? stake * odds : -stake,
    text: `轮盘停在 ${number}（${color === 'green' ? '绿' : color === 'red' ? '红' : '黑'}）— ${won ? `赢了 ${stake * odds} gp` : `输了 ${stake} gp`}。`
  };
}

function evalSicBo(bet, stake, dice) {
  const [a, b, c] = dice;
  const total = a + b + c;
  const triple = a === b && b === c;
  const kind = (bet && bet.id) || 'small';
  let won = false;
  if (kind === 'small') won = !triple && total >= 4 && total <= 10;
  else if (kind === 'big') won = !triple && total >= 11 && total <= 17;
  else if (kind === 'triple') won = triple;
  const odds = (SICBO_BETS.find(x => x.id === kind) || SICBO_BETS[0]).odds;
  return {
    game: 'sicbo', dice, total, triple, won, odds,
    delta: won ? stake * odds : -stake,
    text: `骰子 ${a} + ${b} + ${c} = ${total}${triple ? '（豹子！）' : ''} — ${won ? `赢了 ${stake * odds} gp` : `输了 ${stake} gp`}。`
  };
}

// ---------------------------------------------------------------- slots ----
// 5 symbols, 3 reels, equal weight: 125 outcomes.
const SLOT_SYMBOLS = [
  { id: 'sword', icon: '⚔️', name: '剑' },
  { id: 'shield', icon: '🛡️', name: '盾' },
  { id: 'potion', icon: '🧪', name: '药' },
  { id: 'coin', icon: '🪙', name: '币' },
  { id: 'skull', icon: '💀', name: '骨' }
];

// tiers: stake + paytable. `devil` is the opt-in high-stakes game: rewards multiply and
// three skulls call up a curse instead of simply paying nothing.
const SLOT_TIERS = {
  standard: {
    id: 'standard', name: '普通档', stake: 10,
    pay: { coinTriple: 60, pair: 15 },
    prizes: { sword: ['luck'], shield: ['ward'] },
    potionDrop: { count: 2, tier: 'standard' },
    curseOnSkull: false,
    blurb: '注 10 gp · 三同得大奖，对子小奖，三骨空手而归'
  },
  devil: {
    id: 'devil', name: '恶魔契约', stake: 50,
    pay: { coinTriple: 1500, pair: 60 },
    prizes: { sword: ['luck', 'bane'], shield: ['ward', 'calm'] },
    potionDrop: { count: 1, tier: 'fine' },
    curseOnSkull: true,
    blurb: '注 50 gp · 对子 60 gp、三币 1500 gp，但三个 💀 会招来本场地牢的诅咒'
  }
};

// Pure evaluation of a symbol result.
function evalSlots(tier, symbols) {
  const t = SLOT_TIERS[tier] || SLOT_TIERS.standard;
  const [a, b, c] = symbols;
  const counts = {};
  symbols.forEach(s => { counts[s] = (counts[s] || 0) + 1; });
  const triple = a === b && b === c;
  const pair = !triple && Math.max(...Object.values(counts)) >= 2;
  const out = {
    game: 'slots', tier: t.id, stake: t.stake, symbols, triple, pair,
    payout: 0, delta: -t.stake, prizeTokens: [], potionDrop: null, curse: null, text: ''
  };
  const icons = symbols.map(s => (SLOT_SYMBOLS.find(x => x.id === s) || SLOT_SYMBOLS[0]).icon).join(' ');
  if (triple) {
    if (a === 'coin') {
      out.payout = t.pay.coinTriple;
      out.text = `${icons} — 三枚钱币！赢得 ${t.pay.coinTriple} gp。`;
    } else if (a === 'skull') {
      out.curse = t.curseOnSkull ? 'rolled' : null;
      out.text = t.curseOnSkull
        ? `${icons} — 三个骷髅！恶魔记下了你的名字……`
        : `${icons} — 三个骷髅。庄家笑了。`;
    } else if (a === 'potion') {
      out.potionDrop = t.potionDrop;
      out.text = `${icons} — 三瓶药！获得 ${t.potionDrop.count} 瓶随机魔药。`;
    } else {
      out.prizeTokens = t.prizes[a] || [];
      const names = out.prizeTokens.map(id => (potions.DELVE_TOKENS[id] || {}).name || id).join('、');
      out.text = `${icons} — 三同！获得奖励：${names}。`;
    }
  } else if (pair) {
    out.payout = t.pay.pair;
    out.text = `${icons} — 一对！赢得 ${t.pay.pair} gp。`;
  } else {
    out.text = `${icons} — 什么也没有。`;
  }
  out.delta = out.payout - t.stake;   // net gold change, same convention as the other tables
  return out;
}

// ---------------------------------------------------------------- random spinners ----
function spinRoulette(bet, stake, rng = Math.random) {
  return evalRoulette(bet, stake, Math.floor(rng() * 37));
}

function spinSicBo(bet, stake, rng = Math.random) {
  return evalSicBo(bet, stake, [1 + Math.floor(rng() * 6), 1 + Math.floor(rng() * 6), 1 + Math.floor(rng() * 6)]);
}

function spinSlots(tier, rng = Math.random) {
  const symbols = [0, 1, 2].map(() => SLOT_SYMBOLS[Math.floor(rng() * SLOT_SYMBOLS.length)].id);
  return evalSlots(tier, symbols);
}

// ---------------------------------------------------------------- curses ----
const GAMBLE_CURSES = {
  frailty: {
    id: 'frailty', name: '衰朽之咒',
    desc: '本场地牢最大生命 -5',
    apply: ({ engine, state, events }) => {
      engine.adjustTempHp(state, -5, events, 'the curse');
      events.push({ type: 'curse', narrate: true, text: 'The house marks you: -5 max HP for this delve.' });
    }
  },
  unrest: {
    id: 'unrest', name: '不安之咒',
    desc: '本场地牢少一段休息',
    apply: ({ engine, state, events }) => {
      engine.blockRest(state, 1);
      events.push({ type: 'curse', narrate: true, text: 'Something follows you out of the tavern: one rest lost this delve.' });
    }
  }
};

const CURSE_KEYS = Object.keys(GAMBLE_CURSES);

function rollCurse(rng = Math.random) {
  return GAMBLE_CURSES[CURSE_KEYS[Math.floor(rng() * CURSE_KEYS.length)]];
}

// ---------------------------------------------------------------- limits ----
const GAMBLE_LIMITS = {
  roulette: { min: 5, max: 200 },
  sicbo: { min: 5, max: 200 },
  slots: { min: null, max: null }   // fixed stake per tier
};

// Return-to-player by exhaustive enumeration (used by the unit suite, and by the UI as a
// "theory" line): stake 1 on red, all 37 spins.
function rouletteRtp() {
  let sum = 0;
  for (let n = 0; n <= 36; n++) sum += evalRoulette({ id: 'red' }, 1, n).delta;
  return (37 + sum) / 37;
}

// RTP of the slot machine for one tier, including token prizes valued at `values` (gp).
function slotsRtp(tier, tokenValues = {}) {
  const t = SLOT_TIERS[tier] || SLOT_TIERS.standard;
  let stakeTotal = 0, returnTotal = 0;
  for (const a of SLOT_SYMBOLS) {
    for (const b of SLOT_SYMBOLS) {
      for (const c of SLOT_SYMBOLS) {
        const r = evalSlots(t.id, [a.id, b.id, c.id]);
        stakeTotal += r.stake;
        let value = r.payout;
        (r.prizeTokens || []).forEach(id => { value += tokenValues[id] || t.stake; });
        if (r.potionDrop) value += (r.potionDrop.count || 1) * 40;   // a mystery brew is worth roughly 40 gp
        returnTotal += value;
      }
    }
  }
  return returnTotal / stakeTotal;
}

module.exports = {
  ROULETTE_BETS,
  SICBO_BETS,
  SLOT_SYMBOLS,
  SLOT_TIERS,
  GAMBLE_CURSES,
  CURSE_KEYS,
  GAMBLE_LIMITS,
  rouletteColor,
  evalRoulette,
  evalSicBo,
  evalSlots,
  spinRoulette,
  spinSicBo,
  spinSlots,
  rollCurse,
  rouletteRtp,
  slotsRtp
};
