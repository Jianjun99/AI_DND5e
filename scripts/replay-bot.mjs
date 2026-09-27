// scripts/replay-bot.mjs — headless delve replay bot: plays complete delves over
// the REST API and checks gameplay-level invariants every tick (the regression
// net no unit test provides). Standalone:  node scripts/replay-bot.mjs
//   --runs N                delves to play (default 4; REPLAY_QUICK=1 -> 2)
//   --max-actions N         action cap per delve (default 400; quick -> 150)
//   --maps / --difficulties / --classes / --allies   rotation lists
// Server: attaches to BASE_URL or PORT (e.g. a Docker container on :3101) or
// probes :3000/:3100, and otherwise boots its own server on a free port and
// tears it down afterwards. Exit 0 only if every run finished without anomalies.
import { spawn, spawnSync } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const WIN = process.platform === 'win32';

const arg = (name, fallback) => {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 ? process.argv[i + 1] : fallback;
};
const QUICK = process.env.REPLAY_QUICK === '1';
const RUNS = Number(arg('runs')) || (QUICK ? 2 : 4);
const MAX_ACTIONS = Number(arg('max-actions')) || (QUICK ? 150 : 400);
const MAPS = (arg('maps') || 'crypt,drowned-vault').split(',');
const DIFFS = (arg('difficulties') || 'easy,normal,hard').split(',');
const CLASSES = (arg('classes') || 'fighter,ranger,wizard,cleric').split(',');
const ALLIES = (arg('allies') || 'bram,none').split(',');
const MODES = ['explore', 'combat', 'victory', 'retreat', 'over'];

// ------------------------------------------------------------------ server ----
const freePort = () => new Promise((resolve, reject) => {
  const srv = net.createServer();
  srv.listen(0, '127.0.0.1', () => { const p = srv.address().port; srv.close(() => resolve(p)); });
  srv.on('error', reject);
});
const waitHealthy = async (base) => {
  for (let i = 0; i < 40; i++) {
    try { const r = await fetch(base + '/api/health'); if (r.ok) return true; } catch {}
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
};
function killTree(proc) {
  if (!proc || proc.exitCode != null) return;
  if (WIN) spawnSync('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { stdio: 'ignore' });
  else proc.kill('SIGTERM');
}

let BASE = process.env.BASE_URL || (process.env.PORT ? `http://localhost:${process.env.PORT}` : null);
let ownServer = null;
if (!BASE) {
  for (const candidate of ['http://localhost:3000', 'http://localhost:3100']) {
    if (await waitHealthy(candidate)) { BASE = candidate; break; }
  }
}
if (!BASE) {
  const port = await freePort();
  BASE = `http://localhost:${port}`;
  ownServer = spawn(process.execPath, ['server/index.js'], { cwd: ROOT, stdio: 'inherit', env: { ...process.env, PORT: String(port) } });
  if (!(await waitHealthy(BASE))) { console.error('replay-bot: booted server never became healthy'); process.exit(1); }
}
const own = (p) => BASE + p;

async function api(method, p, body) {
  const res = await fetch(own(p), {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method} ${p} -> HTTP ${res.status}: ${JSON.stringify(data).slice(0, 200)}`);
  return data;
}

// ---------------------------------------------------------------- invariants ----
function checkInvariants(state, run, tick) {
  const bad = (msg) => run.anomalies.push(`t${tick}: ${msg}`);
  if (!MODES.includes(state.mode)) bad(`mode '${state.mode}' outside the known enum`);
  const p = (state.entities || []).find((e) => e.kind === 'player');
  if (!p) { bad('player entity missing'); return; }
  for (const [field, v] of [['hp', p.hp], ['hpMax', p.hpMax], ['ac', p.ac]]) {
    if (!Number.isFinite(v)) bad(`player.${field} is not finite (${v})`);
  }
  if (Number.isFinite(p.hp) && Number.isFinite(p.hpMax) && (p.hp < 0 || p.hp > p.hpMax)) bad(`player hp ${p.hp} outside [0, ${p.hpMax}]`);
  if (!Number.isFinite(p.tempHp) || p.tempHp < 0) bad(`player.tempHp invalid (${p.tempHp})`);

  const ids = new Set();
  const W = state.map && state.map.width, H = state.map && state.map.height;
  for (const e of state.entities || []) {
    if (ids.has(e.id)) bad(`duplicate entity id ${e.id}`);
    ids.add(e.id);
    if (!Number.isFinite(e.x) || !Number.isFinite(e.y)) bad(`entity ${e.id} has non-finite position`);
    else if (W && H && (e.x < 0 || e.y < 0 || e.x >= W || e.y >= H)) bad(`entity ${e.id} out of bounds (${e.x},${e.y})`);
    // npcs are non-combatant scenery: they carry no hp at all
    if (e.kind !== 'npc' && !Number.isFinite(e.hp)) bad(`entity ${e.id} hp is not finite`);
  }
  const c = state.character || {};
  for (const [field, v] of [['gold', c.gold], ['xp', c.xp]]) {
    if (!Number.isFinite(v) || v < 0) bad(`character.${field} invalid (${v})`);
  }
  if (!Number.isFinite(c.level) || c.level < 1 || c.level > 12) bad(`character.level invalid (${c.level})`);
  for (const item of c.inventory || []) {
    if (typeof item.itemId !== 'string' || !item.itemId) bad(`inventory item without itemId: ${JSON.stringify(item).slice(0, 80)}`);
    if (!Number.isFinite(item.qty) || item.qty < 0) bad(`inventory item ${item.itemId} qty invalid`);
  }
  if (state.mode === 'combat') {
    const combat = state.combat || {};
    if (!Number.isFinite(combat.round) || combat.round < 1 || combat.round > 80) bad(`combat.round invalid (${combat.round})`);
    if (!Array.isArray(combat.order) || !combat.order.length) bad('combat.order empty');
  }
}

function checkEvents(events, run, tick) {
  if (!Array.isArray(events)) { run.anomalies.push(`t${tick}: action events not an array`); return; }
  if (events.length > 100) run.anomalies.push(`t${tick}: ${events.length} events from one action (stream sanity)`);
  for (const ev of events) {
    if (typeof ev.type !== 'string' || !ev.type) run.anomalies.push(`t${tick}: event without type: ${JSON.stringify(ev).slice(0, 80)}`);
  }
}

// ---------------------------------------------------------------- strategy ----
function manhattan(a, b) { return Math.abs(a.x - b.x) + Math.abs(a.y - b.y); }

function nextAction(state, run) {
  const p = state.entities.find((e) => e.kind === 'player');
  const char = state.character;

  if (state.mode === 'explore') {
    // a locked chest just told us to pick or force it — roll the check exactly like
    // the client's skill-check modal does (the client owns these dice by design)
    const lockedInfo = (run.lastEvents || []).find((e) => e.type === 'info' && /locked shut/.test(e.text || ''));
    if (lockedInfo && run.lastInteractableId) {
      const ab = char.abilities || {};
      const dexMod = Math.floor(((ab.dex || 10) - 10) / 2);
      const strMod = Math.floor(((ab.str || 10) - 10) / 2);
      const prof = char.profBonus || 2;
      const hasTools = (char.inventory || []).some((i) => i.itemId === 'thieves_tools');
      const usePick = hasTools || (char.skills || []).includes('sleight_of_hand');
      const mod = usePick ? dexMod + (hasTools ? prof : 0) : strMod + ((char.skills || []).includes('athletics') ? prof : 0);
      const roll = 1 + Math.floor(Math.random() * 20);
      return { type: 'skillCheckObject', objectId: run.lastInteractableId, method: usePick ? 'pick' : 'force', rollTotal: roll + mod };
    }
    // drink up first when hurt and a potion exists
    if (p.hp < p.hpMax * 0.4) {
      const potion = (char.inventory || []).find((i) => ['potion_healing', 'potion_greater'].includes(i.itemId) && i.qty > 0);
      if (potion) return { type: 'useItem', itemId: potion.itemId };
    }
    // interact with whatever stands next to us (chests, doors, stairs, campfire);
    // open doors and looted chests no longer count
    const interactable = (state.objects || []).find((o) =>
      !((o.type === 'door' && o.open) || o.looted)
      && o.id && ['door', 'chest', 'stairs', 'campfire', 'altar', 'relic', 'pedestal'].some((k) => (o.type || o.id).toLowerCase().includes(k))
      && manhattan(o, p) <= 1);
    if (interactable) {
      if ((interactable.type || interactable.id).toLowerCase().includes('campfire')) {
        if (p.hp < p.hpMax * 0.6) return { type: 'rest', kind: 'long' };
        // healthy at the campfire: don't burn rests, move on
      } else {
        run.lastInteractableId = interactable.id;
        return { type: 'interact', objectId: interactable.id };
      }
    }
    // hurt at the campfire: rest
    const camp = (state.objects || []).find((o) => (o.type || o.id) === 'campfire');
    if (camp && manhattan(camp, p) <= 1 && p.hp < p.hpMax * 0.6) return { type: 'rest', kind: 'long' };
    // walk toward the nearest monster, else toward the nearest interactable, else random step
    const monsters = (state.entities || []).filter((e) => e.kind === 'monster' && e.alive !== false && !e.fled);
    let goals = [
      ...monsters.map((m) => ({ x: m.x, y: m.y })),
      ...(state.objects || []).filter((o) => ['chest', 'stairs', 'door'].some((k) => (o.type || '').includes(k)) && !((o.type === 'door' && o.open) || o.looted)).map((o) => ({ x: o.x, y: o.y }))
    ];
    // carrying the relic: the win condition is bringing it back to the campfire
    if (state.flags && state.flags.hasRelic && camp) goals = [{ x: camp.x, y: camp.y }];
    return walkToward(state, p, goals, run);
  }

  if (state.mode === 'combat') {
    const c = state.combat || {};
    if (p.hp === 0) return { type: 'endTurn' }; // death saves roll on your turn
    const potion = (char.inventory || []).find((i) => ['potion_healing', 'potion_greater'].includes(i.itemId) && i.qty > 0);
    if (p.hp < p.hpMax * 0.3 && potion && !c.bonusUsed) return { type: 'useItem', itemId: potion.itemId };
    const monsters = (state.entities || []).filter((e) => e.kind === 'monster' && e.alive !== false && !e.fled);
    if (!monsters.length) return { type: 'endTurn' };
    monsters.sort((a, b) => manhattan(a, p) - manhattan(b, p));
    const target = monsters[0];
    const atk = (char.attacks || [])[0] || { ranged: false, range: 5, weaponId: 'unarmed' };
    const reach = atk.ranged ? Math.floor((atk.range || 30) / 5) : 1;
    if (manhattan(target, p) <= reach && !c.actionUsed) {
      return { type: 'attack', targetId: target.id, weaponId: atk.weaponId };
    }
    if ((c.movementLeft ?? 0) > 0) return walkToward(state, p, [{ x: target.x, y: target.y }], run, p.id);
    return { type: 'endTurn' };
  }

  return null; // victory / retreat / over -> run ends
}

/** One step of BFS pathfinding using the engine's own bfsPath; falls back to a
 *  random free neighbour so the bot never hard-stalls against locked doors. */
function walkToward(state, p, goals, run, selfId = 'player') {
  if (!goals.length) return randomStep(state, p);
  let path = null;
  try {
    const engine = requireEngine();
    path = engine.bfsPath(state, { x: p.x, y: p.y }, goals, { self: selfId });
  } catch { /* fall through to random step */ }
  if (Array.isArray(path) && path.length >= 2) return { type: 'move', x: path[1].x, y: path[1].y };
  return randomStep(state, p);
}

let engineCache = null;
function requireEngine() {
  if (!engineCache) engineCache = createRequire(path.join(ROOT, 'server', 'game', 'engine.js'))('./engine.js');
  return engineCache;
}

function randomStep(state, p) {
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]].sort(() => Math.random() - 0.5);
  for (const [dx, dy] of dirs) {
    const nx = p.x + dx, ny = p.y + dy;
    const wall = state.map && state.map.rows && (state.map.rows[ny] || '')[nx] !== undefined;
    if (wall && '#'.includes(state.map.rows[ny][nx])) continue;
    const occupied = (state.entities || []).some((e) => e.alive !== false && e.x === nx && e.y === ny);
    if (!occupied) return { type: 'move', x: nx, y: ny };
  }
  return { type: 'endTurn' };
}

// ------------------------------------------------------------------- runs ----
function makeDraft(className, idx) {
  return {
    name: `Replay Bot ${idx + 1} (${className})`,
    species: className === 'wizard' ? 'elf' : 'human',
    className,
    background: 'soldier',
    baseScores: { str: 15, dex: 14, con: 14, int: 12, wis: 12, cha: 10 },
    bgPlus2: 'str', bgPlus1: 'con',
    skills: ['athletics', 'perception'],
    armorOption: undefined, weaponOption: undefined
  };
}

async function playRun(idx) {
  const className = CLASSES[idx % CLASSES.length].trim();
  const mapId = MAPS[idx % MAPS.length].trim();
  const difficulty = DIFFS[idx % DIFFS.length].trim();
  const bringAlly = ALLIES[idx % ALLIES.length].trim() !== 'none';
  const run = { idx, className, mapId, difficulty, bringAlly, anomalies: [], outcome: '?', actions: 0 };

  const charRes = await api('POST', '/api/characters', makeDraft(className, idx));
  const char = charRes.character || charRes;
  try {
    const { state: first } = await api('POST', '/api/game/start', { characterId: char.id, bringAlly, difficulty, mapId });
    let state = first;
    let stateId = state.id;
    let sinceProgress = 0;
    let lastKey = '';

    for (let tick = 1; tick <= MAX_ACTIONS; tick++) {
      run.actions = tick;
      checkInvariants(state, run, tick);
      if (MODES.slice(2).includes(state.mode)) { run.outcome = state.mode; break; }

      const action = nextAction(state, run);
      if (!action) { run.outcome = state.mode; break; }

      let res;
      try {
        res = await api('POST', `/api/game/${stateId}/action`, action);
      } catch (e) {
        run.anomalies.push(`t${tick}: action ${JSON.stringify(action).slice(0, 60)} failed: ${e.message}`);
        if (++sinceProgress > 15) { run.outcome = 'stuck'; break; }
        continue;
      }
      run.lastEvents = res.events;
      checkEvents(res.events, run, tick);
      if (res.state) state = res.state;

      const p = state.entities.find((e) => e.kind === 'player');
      // progress = position, mode, kills, AND door/chest states (a fighter slamming a
      // locked door makes no positional progress for several ticks but IS progressing)
      const doorProgress = (state.objects || []).filter((o) => o.type === 'door' && o.open).length;
      const lootProgress = (state.objects || []).filter((o) => o.looted).length;
      const key = `${state.mode}:${p ? p.x + ',' + p.y : '?'}:${(state.entities || []).filter((e) => e.kind === 'monster' && e.alive !== false).length}:${doorProgress}:${lootProgress}`;
      if (key !== lastKey) { sinceProgress = 0; lastKey = key; } else if (++sinceProgress > 60) {
        const lastTexts = (run.lastEvents || []).map((e) => `${e.type}: ${(e.text || '').slice(0, 70)}`);
        run.anomalies.push(`t${tick}: no progress for 60 actions (key ${key}, last actions: ${run.recentActions.slice(-5).map((a) => JSON.stringify(a)).join(' | ')}, last events: ${JSON.stringify(lastTexts.slice(0, 4))})`);
        run.outcome = 'stuck';
        break;
      }
      run.recentActions = [...(run.recentActions || []), action].slice(-8);
      if (tick === MAX_ACTIONS) run.outcome = 'unfinished';
    }
    if (run.outcome === '?') run.outcome = 'max-actions';

    // settle like a real player would, then clean up our own artifacts
    try { await api('POST', '/api/city/sync-delve', { charId: char.id, delveStateId: stateId }); } catch {}
    try { await api('DELETE', `/api/game/${stateId}`); } catch {}
  } finally {
    try { await api('DELETE', `/api/characters/${char.id}`); } catch {}
  }
  return run;
}

// -------------------------------------------------------------------- main ----
console.log(`replay-bot: ${RUNS} delve(s) on ${BASE}${QUICK ? ' (quick mode)' : ''}`);
const runs = [];
for (let i = 0; i < RUNS; i++) {
  try {
    const run = await playRun(i);
    runs.push(run);
    console.log(`  run ${i + 1}: ${run.className} @ ${run.mapId} (${run.difficulty}${run.bringAlly ? ', +ally' : ''}) -> ${run.outcome} in ${run.actions} actions, ${run.anomalies.length} anomaly(ies)`);
  } catch (e) {
    runs.push({ idx: i, anomalies: ['run crashed: ' + e.message], outcome: 'crashed' });
    console.log(`  run ${i + 1}: crashed — ${e.message}`);
  }
}
killTree(ownServer);

const bad = runs.filter((r) => r.anomalies.length || r.outcome === 'stuck' || r.outcome === 'crashed');
console.log('\n=== replay-bot summary ===');
for (const r of runs) {
  console.log(`  ${r.anomalies.length || r.outcome === 'stuck' || r.outcome === 'crashed' ? '✘' : '✔'} run ${r.idx + 1}: ${r.outcome} (${r.anomalies.length} anomalies)`);
  r.anomalies.slice(0, 10).forEach((a) => console.log(`      - ${a}`));
}
console.log(bad.length === 0 ? '\n🎉 REPLAY BOT PASSED — all invariants held.\n' : `\n❌ REPLAY BOT FAILED — ${bad.length} run(s) with findings.\n`);
process.exit(bad.length === 0 ? 0 : 1);
