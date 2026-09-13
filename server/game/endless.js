// endless.js — procedural dungeon generator for "The Endless Depths" roguelike mode.
// Generates a standard map JSON per floor: rooms + corridors, monsters scaled by depth,
// stairs to descend, a camp tile, and randomized loot. All output feeds the existing
// engine/content pipeline — no new mechanics needed, just fresh data per floor.
const content = require('./content');

const WIDTH = 34, HEIGHT = 24;

function die(n) { return 1 + Math.floor(Math.random() * n); }
function pick(arr) { return arr[die(arr.length) - 1]; }

// room: { x, y, w, h, center: {x, y} }
function generateRooms(count) {
  const rooms = [];
  for (let tries = 0; tries < count * 20 && rooms.length < count; tries++) {
    const w = die(7) + 2, h = die(5) + 2;
    const x = die(WIDTH - w - 2), y = die(HEIGHT - h - 2);
    const room = { x, y, w, h, cx: Math.floor(x + w / 2), cy: Math.floor(y + h / 2) };
    const overlaps = rooms.some(r =>
      x < r.x + r.w + 2 && x + w + 2 > r.x && y < r.y + r.h + 2 && y + h + 2 > r.y);
    if (!overlaps) rooms.push(room);
  }
  return rooms;
}

function carveRoom(grid, room) {
  for (let y = room.y; y < room.y + room.h; y++)
    for (let x = room.x; x < room.x + room.w; x++)
      grid[y][x] = '.';
}

function carveCorridor(grid, from, to) {
  let x = from.cx, y = from.cy;
  while (x !== to.cx) { grid[y][x] = '.'; x += Math.sign(to.cx - x); }
  while (y !== to.cy) { grid[y][x] = '.'; y += Math.sign(to.cy - y); }
  grid[y][x] = '.';
}

// monster pool from all registered monsters, sorted by XP for depth scaling
function buildMonsterPool() {
  return content.listMonsters().sort((a, b) => a.xp - b.xp);
}

function pickMonstersForDepth(pool, depth, count) {
  // deeper floors pull from stronger end of the pool
  const maxIdx = Math.min(pool.length - 1, Math.ceil((depth / 10) * pool.length));
  const minIdx = Math.max(0, maxIdx - 4);
  const out = [];
  for (let i = 0; i < count; i++) {
    const idx = minIdx + die(Math.max(1, maxIdx - minIdx)) - 1;
    out.push(pool[Math.min(idx, pool.length - 1)]);
  }
  return out;
}

function generateFloor(depth) {
  const pool = buildMonsterPool();
  const roomCount = 6 + die(3);
  const rooms = generateRooms(roomCount);
  const grid = Array.from({ length: HEIGHT }, () => Array(WIDTH).fill('#'));

  rooms.forEach(r => carveRoom(grid, r));
  for (let i = 1; i < rooms.length; i++) carveCorridor(grid, rooms[i - 1], rooms[i]);

  // add rubble for flavor
  for (let i = 0; i < 8; i++) {
    const r = pick(rooms);
    const rx = r.x + die(r.w) - 1, ry = r.y + die(r.h) - 1;
    if (grid[ry] && grid[ry][rx] === '.') grid[ry][rx] = ',';
  }

  const rows = grid.map(row => row.join(''));

  // ---- entities ----
  const entities = [];
  const entryRoom = rooms[0];
  const exitRoom = rooms[rooms.length - 1];

  // camp object at entry (safe zone)
  entities.push({ type: 'object', id: 'campfire', name: 'Delver\u2019s Camp', x: entryRoom.cx, y: entryRoom.cy, icon: '🔥', desc: 'A crude camp at the threshold of this level.' });

  // stairs down in the last room
  entities.push({ type: 'stairs', id: 'endless_stairs_' + depth, name: 'Stairs Descending', x: exitRoom.cx, y: exitRoom.cy, icon: '🪜', to: { mapId: '__endless_next__', x: 0, y: 0 }, desc: 'Ancient steps spiral into deeper darkness.' });

  // monsters: 2-4 per room (skip entry room)
  const monCount = 2 + die(3);
  const picks = pickMonstersForDepth(pool, depth, monCount * rooms.length);
  let pi = 0;
  rooms.slice(1).forEach((r, ri) => {
    const num = die(2); // 1-2 per room
    for (let i = 0; i < num && pi < picks.length; i++, pi++) {
      const mx = r.x + die(r.w) - 1, my = r.y + die(r.h) - 1;
      if (mx === entryRoom.cx && my === entryRoom.cy) continue;
      entities.push({ type: 'monster', kind: picks[pi].id, id: 'end_' + depth + '_' + ri + '_' + i, x: mx, y: my });
    }
  });

  // boss every 5 floors in the last room
  if (depth % 5 === 0) {
    const bossRoom = rooms[rooms.length - 1];
    entities.push({ type: 'monster', kind: 'ogre', id: 'end_boss_' + depth, x: bossRoom.cx, y: bossRoom.cy, boss: true, name: 'Depth Guardian ' + Math.floor(depth / 5) });
  }

  // chests: 1-2 per level, loot scaled
  const chestRoom = pick(rooms);
  entities.push({ type: 'chest', id: 'end_chest_' + depth, name: 'Forgotten Cache', x: chestRoom.cx, y: chestRoom.cy, icon: '🧰',
    loot: { gold: (2 + depth) + 'd6', potions: die(2), items: [{ id: 'potion_healing', chance: 0.4 }, { id: depth >= 5 ? 'potion_greater' : 'scroll_magic_missile', chance: 0.3 }] } });

  // wandering monsters table from pool
  const wandering = picks.slice(0, 3).map(m => m.id);

  // rooms metadata
  const roomMeta = rooms.map((r, i) => ({
    id: 'end_r' + i, name: i === 0 ? 'Entry Chamber' : 'Chamber ' + i,
    rect: [r.x, r.y, r.x + r.w - 1, r.y + r.h - 1],
    desc: 'A carved chamber in the endless dark. Depth ' + depth + '.'
  }));

  const floorTheme = depth <= 3 ? 'crypt' : depth <= 7 ? 'vault' : 'hills';
  const names = ['The Shallow Depths', 'The Deep Halls', 'The Abyssal Tiers', 'The Root of the World'];
  const nameIdx = Math.min(names.length - 1, Math.floor(depth / 3));

  return {
    id: 'endless_' + depth,
    name: names[nameIdx] + ' — Floor ' + depth,
    theme: floorTheme,
    width: WIDTH, height: HEIGHT, tileSizeFt: 5,
    blurb: 'Procedurally generated. Depth ' + depth + '.',
    objectiveText: 'Descend deeper or retreat to the surface with your spoils. Survive.',
    recommended: 'Levels ' + Math.max(1, depth) + '-' + (depth + 4),
    playerStart: { x: entryRoom.cx, y: entryRoom.cy },
    victory: { type: 'slay_boss', campfire: { x: entryRoom.cx, y: entryRoom.cy } },
    legend: { '#': 'wall', '.': 'floor', ',': 'rubble', 'D': 'door' },
    wandering,
    rooms: roomMeta,
    rows,
    entities,
    npcs: {}
  };
}

function generateNextFloor(prevDepth, theme) {
  return generateFloor(prevDepth + 1, theme);
}

module.exports = { generateFloor, generateNextFloor, WIDTH, HEIGHT };
