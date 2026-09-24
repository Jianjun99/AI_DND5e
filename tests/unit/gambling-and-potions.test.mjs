// tests/unit/gambling-and-potions.test.mjs — Tavern gambling & experimental brews
// Odds are verified by exhaustive enumeration (not simulation); random effects are driven
// through injected rng values so every branch is reached deterministically.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const engine = require('../../server/game/engine.js');
const potions = require('../../server/game/potions.js');
const gambling = require('../../server/game/gambling.js');

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (!condition) {
    console.error(`  ❌ FAILED: ${message}`);
    failed++;
    throw new Error(message);
  }
  passed++;
}

function test(name, fn) {
  const before = failed;
  try {
    fn();
    console.log(`  ✔ PASS: ${name}`);
  } catch (err) {
    // assert() already reported and counted its own failure; anything else would otherwise
    // vanish silently, so surface it as a failure too
    if (failed === before) {
      console.error(`  ❌ FAILED: ${name} — ${err && (err.stack || err.message)}`);
      failed++;
    }
  }
}

function makeChar(className = 'fighter', level = 3) {
  const char = engine.buildCharacter({
    name: 'Gambler', species: 'human', className, background: 'soldier',
    baseScores: { str: 15, dex: 14, con: 14, int: 15, wis: 12, cha: 12 }, choices: {}, feat: ''
  });
  char.id = 'unit_' + Math.random().toString(36).slice(2, 7);
  if (level > 1) { char.level = level; engine.applyClassAndSpecies(char, engine.CLASSES.find(c => c.id === className), null, level, true); }
  return char;
}

function stateFor(char = makeChar()) {
  const state = engine.startGame(char, { mapId: 'crypt' });
  return { state, char: state.character, p: engine.playerEntity(state) };
}

// deterministic rng: cycles through the supplied values
function seq(values) {
  let i = 0;
  return () => values[i++ % values.length];
}

console.log('\n--- Running Unit Tests: Tavern Gambling & Experimental Brews ---');

// ---------------------------------------------------------------- roulette ----
test('Roulette pays real single-zero odds (97.3% return on every bet type)', () => {
  let redSum = 0, dozenSum = 0, straightSum = 0;
  for (let n = 0; n <= 36; n++) {
    redSum += gambling.evalRoulette({ id: 'red' }, 1, n).delta;
    dozenSum += gambling.evalRoulette({ id: 'dozen1' }, 1, n).delta;
    straightSum += gambling.evalRoulette({ id: 'straight', number: 17 }, 1, n).delta;
  }
  const rtp = (sum) => (37 + sum) / 37;
  assert(Math.abs(rtp(redSum) - 36 / 37) < 1e-9, `red/black returns 36/37, got ${rtp(redSum).toFixed(4)}`);
  assert(Math.abs(rtp(dozenSum) - 36 / 37) < 1e-9, `dozens return 36/37, got ${rtp(dozenSum).toFixed(4)}`);
  assert(Math.abs(rtp(straightSum) - 36 / 37) < 1e-9, `single number returns 36/37, got ${rtp(straightSum).toFixed(4)}`);
  assert(Math.abs(gambling.rouletteRtp() - 36 / 37) < 1e-9, 'rouletteRtp() reports the same figure');
});

test('Roulette outcomes resolve correctly, including the green zero', () => {
  const win = gambling.evalRoulette({ id: 'red' }, 20, 14);
  assert(win.won === true && win.delta === 20, `Red 14 wins 1:1 (got ${JSON.stringify(win.delta)})`);
  assert(gambling.evalRoulette({ id: 'straight', number: 14 }, 5, 14).delta === 175, 'A straight-up hit pays 35:1');
  assert(gambling.evalRoulette({ id: 'dozen2' }, 10, 20).delta === 20, 'A dozen pays 2:1');
  const zero = gambling.evalRoulette({ id: 'red' }, 10, 0);
  assert(zero.won === false && zero.delta === -10, 'Zero beats red and black');
  assert(gambling.rouletteColor(0) === 'green', 'Zero is green');
});

// ---------------------------------------------------------------- sic bo ----
test('Sic bo big/small loses to triples and returns 97.2%', () => {
  let sum = 0, n = 0, tripleWins = 0;
  for (let a = 1; a <= 6; a++) for (let b = 1; b <= 6; b++) for (let c = 1; c <= 6; c++) {
    sum += gambling.evalSicBo({ id: 'small' }, 1, [a, b, c]).delta;
    n++;
    if (gambling.evalSicBo({ id: 'triple' }, 1, [a, b, c]).won) tripleWins++;
  }
  const rtp = (n + sum) / n;
  assert(n === 216, `216 sic bo outcomes, got ${n}`);
  assert(Math.abs(rtp - 0.9722) < 0.001, `big/small returns ~97.2%, got ${(rtp * 100).toFixed(2)}%`);
  assert(gambling.evalSicBo({ id: 'small' }, 1, [3, 3, 3]).won === false, 'A triple beats the small bet');
  assert(gambling.evalSicBo({ id: 'triple' }, 1, [3, 3, 3]).delta === 30, 'Any triple pays 30:1');
  assert(tripleWins === 6, `Six triple combinations, got ${tripleWins}`);
});

// ---------------------------------------------------------------- slots ----
test('Slot paytable: 5 triples, 60 pairs, 60 blanks out of 125', () => {
  const ids = gambling.SLOT_SYMBOLS.map(s => s.id);
  let triples = 0, pairs = 0, blanks = 0;
  for (const a of ids) for (const b of ids) for (const c of ids) {
    const r = gambling.evalSlots('standard', [a, b, c]);
    if (r.triple) triples++; else if (r.pair) pairs++; else blanks++;
  }
  assert(triples === 5 && pairs === 60 && blanks === 60, `Expected 5/60/60, got ${triples}/${pairs}/${blanks}`);
  const pair = gambling.evalSlots('standard', ['coin', 'coin', 'skull']);
  assert(pair.pair === true && pair.payout === 15 && pair.delta === 5, `A pair pays 15 on a 10 stake (net +5), got ${JSON.stringify({ p: pair.payout, d: pair.delta })}`);
  const jackpot = gambling.evalSlots('standard', ['coin', 'coin', 'coin']);
  assert(jackpot.payout === 60 && jackpot.delta === 50, 'Coin triple pays 60 (net +50)');
});

test('Slot machine holds a real house edge on both tiers', () => {
  const values = { luck: 40, ward: 30, bane: 40, calm: 20 };
  const standard = gambling.slotsRtp('standard', values);
  const devil = gambling.slotsRtp('devil', values);
  assert(standard > 0.85 && standard < 0.93, `Standard tier RTP should be ~89%, got ${(standard * 100).toFixed(1)}%`);
  assert(devil > 0.78 && devil < 0.90, `Devil tier RTP should be ~84% (before the curse), got ${(devil * 100).toFixed(1)}%`);
});

test('Only the Devil\'s Bargain curses you for three skulls', () => {
  assert(gambling.evalSlots('standard', ['skull', 'skull', 'skull']).curse === null, 'Standard tier skulls just take the stake');
  assert(gambling.evalSlots('devil', ['skull', 'skull', 'skull']).curse === 'rolled', 'Devil tier skulls call a curse');
  const rolled = [];
  for (let i = 0; i < 40; i++) rolled.push(gambling.rollCurse().id);
  assert(new Set(rolled).size === 2, `Both curses appear (saw ${[...new Set(rolled)].join(',')})`);
  assert(gambling.CURSE_KEYS.every(k => gambling.GAMBLE_CURSES[k].desc), 'Every curse documents itself for the UI');
});

// ---------------------------------------------------------------- brews ----
test('Tier odds are honoured when rolling a bottle', () => {
  const counts = { good: 0, mixed: 0, bad: 0 };
  const N = 4000;
  for (let i = 0; i < N; i++) counts[potions.rollMysteryPotion('thin').effect.kind]++;
  const pct = (k) => (counts[k] / N) * 100;
  assert(Math.abs(pct('good') - 55) < 4, `Thin tier ~55% good, got ${pct('good').toFixed(1)}%`);
  assert(Math.abs(pct('mixed') - 25) < 4, `Thin tier ~25% mixed, got ${pct('mixed').toFixed(1)}%`);
  assert(Math.abs(pct('bad') - 20) < 4, `Thin tier ~20% bad, got ${pct('bad').toFixed(1)}%`);
  // rng injection pins the exact branch
  assert(potions.rollMysteryPotion('thin', seq([0.10])).effect.kind === 'good', 'Low roll lands in the good band');
  assert(potions.rollMysteryPotion('thin', seq([0.60])).effect.kind === 'mixed', 'Mid roll lands in the mixed band');
  assert(potions.rollMysteryPotion('thin', seq([0.95])).effect.kind === 'bad', 'High roll lands in the bad band');
});

test('A bottle hides its outcome behind a unique identity', () => {
  const ids = new Set();
  for (let i = 0; i < 30; i++) {
    const b = potions.rollMysteryPotion('fine');
    ids.add(b.uniqueId);
    assert(b.kind === 'mystery_potion' && b.identified === false, 'Bottles start unidentified');
    assert(b.effect && potions.POTION_EFFECTS.some(e => e.id === b.effect.id), `Effect ${b.effect.id} comes from the table`);
    assert(b.tier === 'fine' && b.cost === 90, 'Tier and price ride on the bottle');
  }
  assert(ids.size === 30, 'Every bottle gets its own id');
});

test('Every brew effect applies without breaking the delve', () => {
  for (const effect of potions.POTION_EFFECTS) {
    const { state, char, p } = stateFor(makeChar());
    const events = [];
    const bottle = { tier: 'standard', name: 'test brew', effect: { id: effect.id, kind: effect.kind, name: effect.name, desc: effect.desc } };
    const drunk = potions.drinkMysteryPotion(bottle, {
      engine, state, char, p, events, roll: (e) => engine.rollExpr(e)
    });
    assert(drunk && drunk.effectId === effect.id, `Effect ${effect.id} reported back`);
    assert(events.length > 0, `Effect ${effect.id} narrates something`);
    assert(p.hp >= 0, `Effect ${effect.id} left the hero alive at ${p.hp}`);
  }
});

test('Beneficial brews land on the sheet, harmful ones bite', () => {
  const { state, char, p } = stateFor(makeChar());
  const baseHp = char.hpMax;

  const vigorCtx = { engine, state, char, p, events: [], roll: (e) => engine.rollExpr(e) };
  potions.POTION_EFFECTS.find(e => e.id === 'vigor').apply(vigorCtx);
  assert(char.hpMax === baseHp + 5, `强健 raises max HP (${baseHp} -> ${char.hpMax})`);

  const heavyCtx = { engine, state, char, p, events: [], roll: (e) => engine.rollExpr(e) };
  potions.POTION_EFFECTS.find(e => e.id === 'heavy').apply(heavyCtx);
  assert(char.hpMax === baseHp, `四肢沉重 cancels it out (${char.hpMax})`);
  assert(state.flags.restsBlocked === 0, 'Heavy legs do not block rest');
  assert(p.conditions.includes('slowed'), 'Slow condition applied');

  const purgeCtx = { engine, state, char, p, events: [], roll: (e) => engine.rollExpr(e) };
  potions.DELVE_TOKENS.purge.apply(purgeCtx);
  assert(char.tempHpMod === 0 && char.hpMax === baseHp, `净瓶 wipes the max-HP modifier (${char.hpMax} vs ${baseHp})`);

  const comic = stateFor(makeChar());
  const before = JSON.stringify({ hp: comic.p.hp, buffs: comic.p.buffs, conds: comic.p.conditions });
  potions.POTION_EFFECTS.find(e => e.id === 'comic').apply({ engine, state: comic.state, char: comic.char, p: comic.p, events: [], roll: (e) => engine.rollExpr(e) });
  assert(JSON.stringify({ hp: comic.p.hp, buffs: comic.p.buffs, conds: comic.p.conditions }) === before, '无害滑稽 changes nothing but the story');
});

test('The poisoned brew brings real disadvantage', () => {
  const { state, char, p } = stateFor(makeChar());
  potions.POTION_EFFECTS.find(e => e.id === 'poison').apply({ engine, state, char, p, events: [], roll: (e) => engine.rollExpr(e) });
  assert(p.conditions.includes('poisoned'), 'Poisoned condition applied');
  const mods = engine.attackMods(state, p, { id: 'x', kind: 'monster', conditions: [], buffs: [], x: 9, y: 9, hp: 10, hpMax: 10 }, { name: 'swing', ranged: false, dmgType: 'slashing' }, []);
  assert(mods.dis === true, 'A poisoned attacker rolls with disadvantage');
  assert((p.buffs || []).some(b => b.condId === 'poisoned' && b.rounds === 10), 'Poison runs 10 rounds and expires through the buff ticker');
});

test('A blocked rest is really lost, and 静息香 gives it back', () => {
  const { state, char, p } = stateFor(makeChar());
  engine.blockRest(state, 1);
  engine.applyDamage(state, p, 5, 'slashing', []);
  p.hp = Math.max(1, p.hp - 5);
  const hpBefore = p.hp, hdBefore = char.hdUsed || 0;
  const events = [];
  engine.shortRest(state, events);
  assert(state.flags.restsBlocked === 0, 'The block is consumed by the attempt');
  assert(p.hp === hpBefore && (char.hdUsed || 0) === hdBefore, 'No hit dice spent, no healing: the rest was wasted');
  assert(events.some(e => e.type === 'rest_blocked'), 'The player is told why');

  engine.blockRest(state, 1);
  const tokenCtx = { engine, state, char, p, events: [], roll: (e) => engine.rollExpr(e) };
  potions.DELVE_TOKENS.calm.apply(tokenCtx);
  assert(state.flags.restsBlocked === 0, '静息香 clears the block');
  const events2 = [];
  engine.shortRest(state, events2);
  assert((char.hdUsed || 0) > hdBefore, 'The next rest actually works (hit dice are spent)');
});

test('A long rest no longer inflates max HP (regression)', () => {
  const { state, char, p } = stateFor(makeChar());
  const camp = engine.campfireOf(state);
  p.x = camp.x; p.y = camp.y;
  const before = char.hpMax;
  engine.longRest(state, []);
  assert(char.hpMax === before, `Long rest must not raise max HP (${before} -> ${char.hpMax})`);
  assert(state.flags.restsBlocked === 0, 'A night at camp clears any blocked rest');
});

test('Identification is one attempt, and success reveals the bottle', () => {
  const char = makeChar();
  const bottle = potions.rollMysteryPotion('thin', seq([0.1, 0.1]));
  char.inventory.push(bottle);

  const failedRoll = potions.identifyPotion(char, bottle.uniqueId, 5);
  assert(failedRoll.ok && failedRoll.success === false, 'A low check fails');
  assert(!bottle.identified && bottle.identifyFailed, 'The bottle stays a mystery and the attempt is spent');
  const retry = potions.identifyPotion(char, bottle.uniqueId, 30);
  assert(retry.ok === false && /already failed/.test(retry.error), 'A second attempt is refused');

  const lucky = potions.rollMysteryPotion('thin', seq([0.1, 0.1]));
  char.inventory.push(lucky);
  const success = potions.identifyPotion(char, lucky.uniqueId, 15);
  assert(success.ok && success.success && lucky.identified, 'A high check identifies the bottle');
  assert(lucky.name.includes(lucky.effect.name), `The bottle is renamed to its effect (${lucky.name})`);
  assert(success.effect && success.effect.name, 'The player learns the effect name');
});

// ---------------------------------------------------------------- tokens ----
test('Every prize token is delve-only and applies its boon', () => {
  for (const id of potions.TOKEN_KEYS) {
    const token = potions.makeToken(id);
    assert(token.delveOnly === true && token.kind === 'delve_token', `${id} is flagged delve-only`);
    assert(token.uniqueId && token.name && token.desc, `${id} carries a name, an id and a description`);
    const { state, char, p } = stateFor(makeChar());
    const events = [];
    const used = potions.useToken(token, { engine, state, char, p, events, roll: (e) => engine.rollExpr(e), rng: Math.random });
    assert(used && used.tokenId === id, `${id} reports back when used`);
    assert(events.length > 0, `${id} narrates its effect`);
  }
});

test('Prize tokens grant real, delve-scoped power', () => {
  const { state, char, p } = stateFor(makeChar());
  const ctx = { engine, state, char, p, events: [], roll: (e) => engine.rollExpr(e), rng: Math.random };
  const baseHp = char.hpMax;

  potions.DELVE_TOKENS.luck.apply(ctx);
  potions.DELVE_TOKENS.bane.apply(ctx);
  potions.DELVE_TOKENS.swift.apply(ctx);
  potions.DELVE_TOKENS.ward.apply(ctx);
  assert(p.buffs.some(b => b.id === 'altar_blessed'), '幸运币 blesses the hero');
  assert(p.buffs.some(b => b.id === 'divine_favor'), '屠戮油 empowers the blade');
  assert(p.buffs.some(b => b.id === 'longstrider'), '疾行靴钉 speeds the hero');
  assert(char.hpMax === baseHp + 5, `护身符 raises max HP (${baseHp} -> ${char.hpMax})`);

  const itemsBefore = char.inventory.length;
  potions.DELVE_TOKENS.heal.apply(ctx);
  potions.DELVE_TOKENS.scrollpack.apply(ctx);
  assert(char.inventory.length === itemsBefore + 2, '大药剂 and 卷轴包 hand over real items');
});

// ---------------------------------------------------------------- lifecycle ----
test('Gambled prizes ride into the delve and die with it', () => {
  const char = makeChar();
  char.pendingDelveItems = [potions.makeToken('luck'), potions.makeToken('swordless' && 'bane')];
  char.inventory.push({ itemId: 'potion_healing', qty: 2, delveOnly: true });   // leftover from an old delve

  const state = engine.startGame(char, { mapId: 'crypt', carryItems: char.pendingDelveItems });
  const inv = state.character.inventory;
  const carried = inv.filter(i => i.delveOnly);
  assert(inv.some(i => i.tokenId === 'luck') && inv.some(i => i.tokenId === 'bane'), 'Both tokens were carried in');
  assert(!inv.filter(i => i.itemId === 'potion_healing').some(i => i.delveOnly), 'Stale delve-only leftovers are discarded on entry');
  assert(carried.every(i => i.delveOnly), 'Everything carried in is flagged delve-only');
  assert(state.character.hpMax > 0 && state.character.tempHpMod === 0, 'A fresh delve starts with a clean max-HP modifier');
});

test('Max-HP modifiers survive recomputes without stacking', () => {
  const { state, char } = stateFor(makeChar());
  const base = char.hpMax;
  engine.adjustTempHp(state, -5, [], 'curse');
  assert(char.hpMax === base - 5, `Curse applied once (${base} -> ${char.hpMax})`);
  // equipping gear re-runs applyClassAndSpecies, which must not double-apply the modifier
  char.inventory.push({ itemId: 'leather', qty: 1 });
  char.equipped = char.equipped || {};
  char.equipped.armor = 'leather';
  engine.applyClassAndSpecies(char, engine.CLASSES.find(c => c.id === char.className), null, char.level, true);
  assert(char.hpMax === base - 5, `Recompute keeps the modifier applied exactly once (expected ${base - 5}, got ${char.hpMax})`);
  engine.adjustTempHp(state, 0, [], 'purge', { clear: true });
  assert(char.hpMax === base, `Purge removes the modifier entirely (expected ${base}, got ${char.hpMax})`);
  assert(char.hpMax > 0, 'Max HP never drops below 1');
});

test('Curses from the devil\'s bargain land when the next delve starts', () => {
  const { state, p } = stateFor(makeChar());
  const events = [];
  gambling.GAMBLE_CURSES.frailty.apply({ engine, state, events });
  const afterFrailty = state.character.hpMax;
  assert(events.some(e => e.type === 'curse'), 'The curse is announced');
  gambling.GAMBLE_CURSES.unrest.apply({ engine, state, events });
  assert(state.flags.restsBlocked === 1, 'Rest curse blocks a rest');
  assert(gambling.GAMBLE_CURSES.frailty.desc && gambling.GAMBLE_CURSES.unrest.desc, 'Both curses are player-readable');
  assert(afterFrailty < stateFor(makeChar()).char.hpMax, 'Frailty really lowers max HP');
  assert(p.hp <= p.hpMax, 'The hero is never left above their reduced maximum');
});

console.log(`\nGambling & Brews Unit Tests Summary: ${passed} passed, ${failed} failed.`);
if (failed > 0) process.exit(1);
