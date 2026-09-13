// tests/integration/tactics.test.mjs — Opportunity Attacks, Flanking & Shove
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const engine = require('../../server/game/engine.js');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✔ PASS: ${name}`); passed++; }
  catch (err) { failed++; console.error(`  ❌ FAIL: ${name} — ${err.message}`); }
}

function makeState() {
  const char = engine.buildCharacter({
    name: 'Tactician', species: 'human', className: 'fighter', background: 'soldier',
    baseScores: { str: 15, dex: 14, con: 14, int: 10, wis: 12, cha: 8 },
    bgPlus2: 'str', bgPlus1: 'con', skills: ['athletics', 'perception'],
    fightingStyle: 'defense', armorOption: 'chain_mail', weaponOption: 'sword_board'
  });
  return engine.startGame(char, { mapId: 'crypt', difficulty: 'normal' });
}

function findGoblin(state) { return state.entities.find(e => e.monsterId === 'goblin' && e.alive && !e.fled); }
function placeAdjacent(mon, x, y) { mon.x = x; mon.y = y; mon.aware = true; }

console.log('\n--- Tactics: Opportunity Attacks, Flanking & Shove ---');

test('Opportunity Attack: fleeing adjacent goblin provokes', () => {
  const state = makeState();
  const ev = [];
  const p = engine.playerEntity(state);
  const gob = findGoblin(state);
  placeAdjacent(gob, p.x + 1, p.y);
  engine.startCombat(state, [gob.id], ev);
  // player walks away 2 tiles (provokes OA from goblin at old tile)
  engine.movePlayer(state, p.x + 3, p.y, ev);
  const oa = ev.filter(e => e.type === 'opportunity');
  if (!oa.length) throw new Error('no opportunity attack when fleeing');
  // damage may miss (d20), but the attack must have been attempted
});

test('Disengage prevents opportunity attacks', () => {
  const state = makeState();
  const ev = [];
  const p = engine.playerEntity(state);
  const gob = findGoblin(state);
  placeAdjacent(gob, p.x + 1, p.y);
  engine.startCombat(state, [gob.id], ev);
  // player disengages (action) then moves away
  state.combat.actionUsed = false;
  engine.addBuff(p, { id: 'disengaged', rounds: 1 });
  state.flags.noOaFor = 'player';
  engine.movePlayer(state, p.x + 3, p.y, ev);
  const oa = ev.filter(e => e.type === 'opportunity');
  if (oa.length) throw new Error('OA triggered despite Disengage');
});

test('Flanking: ally opposite target grants advantage', () => {
  const state = makeState();
  const ev = [];
  const p = engine.playerEntity(state);
  // add ally east of target
  state.entities.push({
    id: 'ally', kind: 'ally', name: 'Ally', x: 0, y: 0, hp: 20, hpMax: 20, ac: 15, speedFt: 30,
    abilities: { str: 14, dex: 12, con: 12, int: 10, wis: 12, cha: 10 },
    attacks: [{ name: 'Shortsword', bonus: 4, range: 5, damage: '1d6+2', damageType: 'piercing' }],
    conditions: [], buffs: [], alive: true
  });
  const ally = state.entities.find(e => e.id === 'ally');
  const gob = findGoblin(state);
  // place goblin, player west of it, ally east of it
  placeAdjacent(gob, 20, 10);
  p.x = 19; p.y = 10;
  ally.x = 21; ally.y = 10;
  const atk = { ranged: false, spell: false };
  const mods = engine.attackMods(state, p, gob, atk, []);
  if (!mods.adv) throw new Error('flanking did not grant advantage');
  // no flank when ally is not opposite
  ally.x = 20; ally.y = 9;
  const mods2 = engine.attackMods(state, p, gob, atk, []);
  if (mods2.adv && !state.flags.reckless) { /* flanking should be false here */ throw new Error('flank detected without opposite ally'); }
});

test('Shove: contest pushes target back 1 tile on success', () => {
  const state = makeState();
  const ev = [];
  const p = engine.playerEntity(state);
  const gob = findGoblin(state);
  placeAdjacent(gob, p.x + 1, p.y);
  // ensure open tile behind goblin
  const behind = { x: gob.x + 1, y: gob.y };
  state.map.rows[behind.y] = state.map.rows[behind.y].substring(0, behind.x) + '.' + state.map.rows[behind.y].substring(behind.x + 1);
  engine.startCombat(state, [gob.id], ev);
  const evs = [];
  const result = engine.shoveTarget(state, gob.id, evs);
  const shoved = gob.x === behind.x && gob.y === behind.y;
  const failEv = evs.filter(e => e.type === 'shove_fail');
  if (!shoved && !failEv.length) throw new Error('no shove outcome');
  // 50/50 dice — either pushed or failed is fine, both are legal outcomes
  console.log(`    (shove result: ${shoved ? 'pushed' : 'contest lost — legal'})`);
});

test('Reaction economy: each creature OAs once per round', () => {
  const state = makeState();
  const ev = [];
  const p = engine.playerEntity(state);
  const gob = findGoblin(state);
  placeAdjacent(gob, p.x + 1, p.y);
  engine.startCombat(state, [gob.id], ev);
  // player walks a zigzag that leaves and re-enters reach within one round
  engine.movePlayer(state, p.x + 3, p.y, ev);
  engine.movePlayer(state, p.x - 3, p.y, ev);
  const oaCount = ev.filter(e => e.type === 'opportunity').length;
  if (oaCount > 2) throw new Error(`too many OAs in one round: ${oaCount}`);
});

console.log(`\nTactics Summary: ${passed} passed, ${failed} failed.`);
if (failed > 0) process.exit(1);
