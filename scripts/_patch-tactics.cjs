// one-off: tactical layer — opportunity attacks, flanking, shove, disengage
const fs = require('fs');
const f = 'server/game/engine.js';
let s = fs.readFileSync(f, 'utf8');
let n = 0;
const sub = (from, to) => {
  if (!s.includes(from)) { console.log('MISS:', JSON.stringify(from.slice(0, 70))); return; }
  s = s.split(from).join(to); n++;
};

// ---------- 1. OA + flanking helpers (placed before movePlayer) ----------
sub('// ---------------------------------------------------------------- movement ----',
`// ---------------------------------------------------------------- tactics ----
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

function markReaction(ent) { ent.oaRound = state ? 0 : 0; } // replaced below (needs state)

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
  const flankingSpot = { x: target.x - sx, y: target.y - sy };
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

// ---------------------------------------------------------------- movement ----`);
n++;

// ---------- 2. player movement OAs (combat only, per step) ----------
sub(`    if (inCombat) state.combat.movementLeft = budget;
    const trap = state.objects.find(o => o.type === 'trap' && o.x === p.x && o.y === p.y && !o.disarmed && !o.triggered);`,
`    if (inCombat) {
      state.combat.movementLeft = budget;
      maybeOpportunityAttack(state, p, px_prev, py_prev, p.x, p.y, events);
      if (state.mode !== 'combat' || p.alive === false || p.hp <= 0) return;
    }
    px_prev = p.x; py_prev = p.y;
    const trap = state.objects.find(o => o.type === 'trap' && o.x === p.x && o.y === p.y && !o.disarmed && !o.triggered);`);
n++;

// track previous tile in movePlayer loop
sub(`  let budget = inCombat ? state.combat.movementLeft : Infinity;
  let steps = 0;
  for (const step of path) {`,
`  let budget = inCombat ? state.combat.movementLeft : Infinity;
  let steps = 0;
  let px_prev = p.x, py_prev = p.y;
  for (const step of path) {`);
n++;

// ---------- 3. monster movement OAs (leaving player/ally reach) ----------
sub(`      budget -= cost; mon.x = step.x; mon.y = step.y;
      // leashed bosses never stray more than 6 tiles from their post`,
`      maybeOpportunityAttack(state, mon, mon.x, mon.y, step.x, step.y, events);
      if (mon.alive === false || state.mode !== 'combat') return;
      budget -= cost; mon.x = step.x; mon.y = step.y;
      // leashed bosses never stray more than 6 tiles from their post`);
n++;

// goblin Nimble Escape: disengage before moving away
sub(`  if (mon.conditions.includes('paralyzed')) { addLog(state, 'mech', \`\${mon.name} stands frozen, muscles locked.\`); return; }`,
`  if (mon.conditions.includes('paralyzed')) { addLog(state, 'mech', \`\${mon.name} stands frozen, muscles locked.\`); return; }
  if ((mon.traits || []).some(t => t.startsWith('Nimble Escape'))) addBuff(mon, { id: 'disengaged', rounds: 1 });`);
n++;

// ---------- 4. flanking in attackMods (player side) ----------
sub(`  if (state.flags.reckless && !atk.ranged) out.adv = true;
  if (hasBuff(target, 'dodge')) out.dis = true;`,
`  if (state.flags.reckless && !atk.ranged) out.adv = true;
  if (!atk.ranged && !atk.spell && hasFlank(state, p, target)) out.adv = true;
  if (hasBuff(target, 'dodge')) out.dis = true;`);
n++;

// flanking for monster attackers
sub(`function attackMods(state, attacker, target, atk, events) {
  const out = { adv: false, dis: false, atkRolls: [], dmgDice: [], bonusFlat: 0 };
  if (attacker.kind !== 'player') {
    if (hasBuff(attacker, 'disadv_next')) out.dis = true;`,
`function attackMods(state, attacker, target, atk, events) {
  const out = { adv: false, dis: false, atkRolls: [], dmgDice: [], bonusFlat: 0 };
  if (attacker.kind !== 'player') {
    if (hasBuff(attacker, 'disadv_next')) out.dis = true;
    if (!atk.ranged && hasFlank(state, attacker, target) && !hasBuff(target, 'dodge')) out.adv = true;`);
n++;

fs.writeFileSync(f, s);
console.log('applied', n);
