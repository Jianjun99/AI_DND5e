// balance-sim.mjs v2 — the bot now opens doors, casts spells, and uses subclass/level resources.
import '../server/game/engine.js';
const engine = await import('../server/game/engine.js');

const RUNS = +(process.argv[2] || 50);

function makeBotCharacter(className) {
  const cls = engine.byId(engine.CLASSES, className);
  return engine.buildCharacter({
    name: 'Bot', species: 'human', className, background: 'soldier',
    baseScores: { str: 15, dex: 14, con: 14, int: 15, wis: 12, cha: 12 },
    bgPlus2: cls.primary, bgPlus1: 'con',
    skills: ['perception', 'athletics'],
    fightingStyle: ['fighter', 'paladin', 'ranger'].includes(className) ? 'defense' : null,
    armorOption: (cls.armorOptions || [{ id: 'none' }])[0].id,
    weaponOption: (cls.weaponOptions || [{ id: 'x' }])[0].id,
    cantrips: cls.spellcasting ? (engine.SPELLS.filter(s => s.level === 0 && s.classes.includes(className)).slice(0, cls.spellcasting.cantrips || 0).map(s => s.id)) : [],
    spells: cls.spellcasting ? (engine.SPELLS.filter(s => s.level === 1 && s.classes.includes(className)).slice(0, cls.spellcasting.spellsKnown || 3).map(s => s.id)) : []
  });
}

function openAdjacentDoor(state) {
  const p = engine.playerEntity(state);
  if (state.mode !== 'explore') return false;
  const ev = [];
  const door = state.objects.find(o => o.type === 'door' && !o.open && engine.manhattan(o, p) <= 1);
  if (door) { engine.interactDoor(state, door, ev); return true; }
  return false;
}

// walk to the reachable tile next to the nearest closed door
function walkToDoor(state) {
  const p = engine.playerEntity(state);
  const W = state.map.width, H = state.map.height;
  const key = (x, y) => x + ',' + y;
  const dist = new Map([[key(p.x, p.y), 0]]);
  const q = [p];
  const doors = state.objects.filter(o => o.type === 'door' && !o.open);
  let best = null;
  while (q.length) {
    const cur = q.shift();
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = cur.x + dx, ny = cur.y + dy, k = key(nx, ny);
      if (nx < 0 || ny < 0 || nx >= W || ny >= H || dist.has(k)) continue;
      const door = doors.find(d => d.x === nx && d.y === ny);
      if (door) {
        const d = dist.get(key(cur.x, cur.y)) + 1;
        if (!best || d < best.d) best = { door, x: cur.x, y: cur.y, d };
        continue;
      }
      if (engine.isWall(state, nx, ny)) continue;
      if (engine.entityAt(state, nx, ny)) continue;
      dist.set(k, dist.get(key(cur.x, cur.y)) + 1);
      q.push({ x: nx, y: ny });
    }
  }
  if (!best) return false;
  const ev = [];
  if (best.x === p.x && best.y === p.y) { engine.interactDoor(state, best.door, ev); return true; }
  engine.movePlayer(state, best.x, best.y, ev);
  return openAdjacentDoor(state);
}

function botCombatTurn(state, p, cautious) {
  const ev = [];
  const foes = state.entities.filter(e => e.kind === 'monster' && e.alive && !e.fled && engine.manhattan(e, p) <= 8 && engine.los(state, p.x, p.y, e.x, e.y));
  if (!foes.length) { engine.endTurn(state, ev); return; }
  const target = foes.sort((a, b) => engine.manhattan(p, a) - engine.manhattan(p, b))[0];
  const dist = engine.manhattan(p, target);
  const char = state.character;
  const hpFrac = p.hp / p.hpMax;
  // heal when it matters
  if (hpFrac < (cautious ? 0.55 : 0.4)) {
    const pot = char.inventory.find(i => ['potion_healing', 'potion_greater'].includes(i.itemId) && i.qty > 0);
    if (pot && !state.combat.bonusUsed) {
      const def = engine.byId(engine.GEAR, pot.itemId);
      const r = engine.rollExpr(def.heal);
      engine.healEntity(state, p, r.total, ev, def.name); pot.qty--; state.combat.bonusUsed = true;
    } else if (char.className === 'fighter' && (char.uses.second_wind || 0) > 0 && !state.combat.bonusUsed) {
      engine.healEntity(state, p, engine.rollExpr('1d10').total + char.level, ev, 'Second Wind');
      char.uses.second_wind--; state.combat.bonusUsed = true;
    } else if (char.className === 'paladin' && (char.pools.lay_on_hands || 0) > 0 && hpFrac < 0.4) {
      const heal = Math.min(char.pools.lay_on_hands, p.hpMax - p.hp);
      char.pools.lay_on_hands -= heal; engine.healEntity(state, p, heal, ev, 'Lay On Hands');
      state.combat.bonusUsed = true;
    }
  }
  // casters: open with an offensive spell when they have slots
  const sc = char.spellcasting;
  if (sc && sc.spells.length && (char.slots[1] || 0) > 0 && !state.combat.actionUsed && dist <= 6) {
    const dmgSpell = sc.spells.map(engine.findSpell).find(s => s && s.level === 1 && (s.damage || s.sleepPool) && (s.target === 'enemy' || s.target === 'burst'));
    if (dmgSpell) { engine.castSpell(state, dmgSpell.id, target.id, ev); engine.endTurn(state, ev); return; }
  }
  const melee = char.attacks.find(a => !a.ranged && a.weaponId !== 'unarmed');
  const rangedA = char.attacks.find(a => a.ranged);
  const rangeT = (a) => a.ranged ? Math.floor((a.range || 30) / 5) : 1;
  const useAtk = dist <= 1 ? (melee || char.attacks[0]) : (rangedA && dist <= rangeT(rangedA) && engine.los(state, p.x, p.y, target.x, target.y) ? rangedA : melee);
  if (dist <= rangeT(useAtk)) {
    if (!state.combat.actionUsed) engine.playerAttack(state, target.id, useAtk.weaponId, ev);
  } else {
    engine.movePlayer(state, target.x, target.y, ev);
  }
  if (state.mode !== 'combat') return;
  engine.endTurn(state, ev);
}

function simulateDelve({ char, difficulty, mapId, bringAlly, cautious }) {
  const state = engine.startGame(char, { difficulty, mapId, bringAlly });
  const p = engine.playerEntity(state);
  const stats = { deaths: 0, wins: 0, level: 1, rounds: 0, stabilized: 0, kills: 0 };
  const rooms = (state.map.rooms || []).map(r => ({
    id: r.id,
    x: Math.floor((r.rect[0] + r.rect[2]) / 2),
    y: Math.floor((r.rect[1] + r.rect[3]) / 2)
  })).filter(r => !(r.x === p.x && r.y === p.y));

  let guard = 0;
  while ((state.mode === 'explore') && guard++ < 300) {
    // head for the next unvisited room; open doors that block the way
    const next = rooms.find(r => !state.flags['room_' + r.id]) || rooms[0];
    const before = { x: p.x, y: p.y };
    const ev = [];
    engine.movePlayer(state, next.x, next.y, ev);
    if (p.x === before.x && p.y === before.y && state.mode === 'explore') {
      if (openAdjacentDoor(state)) continue;
      if (walkToDoor(state)) continue;
      // try approaching via a different room center
      const alt = rooms[Math.floor(Math.random() * rooms.length)];
      engine.movePlayer(state, alt.x, alt.y, ev);
      if (p.x === before.x && p.y === before.y && !openAdjacentDoor(state) && !walkToDoor(state)) break; // truly stuck
    }
    let fguard = 0;
    while (state.mode === 'combat' && fguard++ < 80) {
      stats.rounds++;
      if (p.conditions.includes('unconscious')) { engine.endTurn(state, ev); continue; }
      if (state.combat.order[state.combat.turnIdx].id !== 'player') { engine.endTurn(state, ev); continue; }
      botCombatTurn(state, p, cautious);
    }
    if (state.mode === 'over') break;
    if (state.mode === 'victory') break;
    if (state.mode === 'explore') engine.shortRest(state, ev);
  }
  stats.deaths = state.mode === 'over' ? 1 : 0;
  stats.wins = state.mode === 'victory' ? 1 : 0;
  stats.level = state.character.level;
  stats.bossDead = !state.entities.some(e => e.boss && e.alive);
  stats.kills = state.entities.filter(e => e.kind === 'monster' && !e.alive).length;
  return stats;
}

const configs = [];
for (const mapId of ['crypt', 'drowned-vault']) {
  for (const difficulty of ['easy', 'normal', 'hard']) {
    configs.push({ mapId, difficulty, cautious: false, ally: false, label: `${mapId} ${difficulty} solo` });
  }
}
configs.push({ mapId: 'crypt', difficulty: 'normal', cautious: true, ally: true, label: 'crypt normal +ally' });
configs.push({ mapId: 'drowned-vault', difficulty: 'normal', cautious: true, ally: true, label: 'vault normal +ally' });

console.log(`Balance simulation v2: ${RUNS} runs per config (bot opens doors, casts, uses resources)\n`);
console.log('config'.padEnd(24), 'deaths', 'wins', 'surv', 'avgLvl', 'avgKills');
for (const cfg of configs) {
  let deaths = 0, wins = 0, lvl = 0, kills = 0;
  const classes = ['fighter', 'ranger', 'wizard', 'rogue', 'cleric', 'paladin'];
  for (let i = 0; i < RUNS; i++) {
    const char = makeBotCharacter(classes[i % classes.length]);
    const r = simulateDelve({ char, difficulty: cfg.difficulty, mapId: cfg.mapId, bringAlly: cfg.ally, cautious: cfg.cautious });
    deaths += r.deaths; wins += r.wins; lvl += r.level; kills += r.kills;
  }
  console.log(cfg.label.padEnd(24), String(deaths).padStart(6), String(wins).padStart(4), ((RUNS - deaths) / RUNS * 100).toFixed(0).padStart(4) + '%', (lvl / RUNS).toFixed(1).padStart(6), (kills / RUNS).toFixed(1).padStart(9));
}
