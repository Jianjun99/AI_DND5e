// map.js — canvas renderer for the dungeon grid (walls, fog of war, tokens)
const TILE = 34; // base tile px; canvas scales

// deterministic per-tile pseudo-random for texture
function hash(x, y) {
  let h = (x * 374761393 + y * 668265263) ^ 0x5bf03635;
  h = (h ^ (h >> 13)) * 1274126177;
  return ((h ^ (h >> 16)) >>> 0) / 4294967295;
}

export function createMapRenderer(canvas, opts = {}) {
  const ctx = canvas.getContext('2d');
  let hover = null;
  let entities = [];

  function tileFromEvent(ev) {
    const rect = canvas.getBoundingClientRect();
    const scale = canvas.width / rect.width;
    const px = (ev.clientX - rect.left) * scale;
    const py = (ev.clientY - rect.top) * scale;
    return { x: Math.floor(px / TILE), y: Math.floor(py / TILE) };
  }

  function px(x) { return x * TILE; }

  function drawFloor(x, y, dim) {
    const r = hash(x, y);
    ctx.fillStyle = dim ? '#16130f' : ['#2a241d', '#2e2820', '#282219'][Math.floor(r * 3)];
    ctx.fillRect(px(x), px(y), TILE, TILE);
    // grout lines
    ctx.strokeStyle = dim ? 'rgba(255,255,255,.02)' : 'rgba(0,0,0,.25)';
    ctx.strokeRect(px(x) + .5, px(y) + .5, TILE - 1, TILE - 1);
    // cracks / pebbles
    if (!dim && r > .82) {
      ctx.fillStyle = 'rgba(0,0,0,.3)';
      ctx.beginPath();
      ctx.arc(px(x) + 8 + r * 16, px(y) + 10 + r * 12, 1.6, 0, 7);
      ctx.fill();
    }
  }

  function drawWall(x, y, dim) {
    const r = hash(x, y);
    ctx.fillStyle = dim ? '#100e0c' : ['#3b332a', '#403730', '#362e26'][Math.floor(r * 3)];
    ctx.fillRect(px(x), px(y), TILE, TILE);
    ctx.fillStyle = 'rgba(0,0,0,.35)';
    ctx.fillRect(px(x), px(y) + TILE - 4, TILE, 4);
    ctx.strokeStyle = 'rgba(0,0,0,.4)';
    ctx.strokeRect(px(x) + .5, px(y) + .5, TILE - 1, TILE - 1);
    if (!dim && r > .7) {
      ctx.fillStyle = 'rgba(255,255,255,.04)';
      ctx.fillRect(px(x) + 4 + r * 10, px(y) + 5 + r * 8, 8, 3);
    }
  }

  function drawDoor(x, y, open, dim) {
    drawFloor(x, y, dim);
    ctx.fillStyle = open ? 'rgba(90,60,35,.35)' : (dim ? '#241a10' : '#4a3520');
    ctx.fillRect(px(x) + 4, px(y) + 2, TILE - 8, TILE - 4);
    if (!open) {
      ctx.strokeStyle = '#1c1207';
      ctx.strokeRect(px(x) + 4.5, px(y) + 2.5, TILE - 9, TILE - 5);
      ctx.fillStyle = '#c9a959';
      ctx.beginPath(); ctx.arc(px(x) + TILE - 10, px(y) + TILE / 2, 2.4, 0, 7); ctx.fill();
    }
  }

  function drawRubble(x, y, dim) {
    drawFloor(x, y, dim);
    for (let i = 0; i < 5; i++) {
      const r = hash(x * 7 + i, y * 13 + i);
      ctx.fillStyle = dim ? '#1d1915' : '#4d443a';
      ctx.beginPath();
      ctx.arc(px(x) + 6 + r * 22, px(y) + 6 + hash(y * 11 + i, x * 5 + i) * 22, 2.5 + r * 2, 0, 7);
      ctx.fill();
    }
  }

  function drawToken(x, y, color, glyph, opts2 = {}) {
    const cx = px(x) + TILE / 2, cy = px(y) + TILE / 2;
    ctx.beginPath();
    ctx.arc(cx, cy, TILE / 2 - 4, 0, 7);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.lineWidth = opts2.selected ? 3 : 1.6;
    ctx.strokeStyle = opts2.selected ? '#ffd700' : 'rgba(0,0,0,.55)';
    ctx.stroke();
    if (glyph) {
      ctx.font = '15px serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(glyph, cx, cy + 1);
    }
  }

  function drawHpBar(x, y, frac) {
    const w = TILE - 10, bx = px(x) + 5, by = px(y) + TILE - 4;
    ctx.fillStyle = 'rgba(0,0,0,.65)';
    ctx.fillRect(bx, by, w, 3);
    ctx.fillStyle = frac > .5 ? '#6fa356' : frac > .25 ? '#c9a959' : '#b8433a';
    ctx.fillRect(bx, by, w * Math.max(0, frac), 3);
  }

  function render(game) {
    if (!game) return;
    const map = game.map;
    const W = map.width * TILE, H = map.height * TILE;
    if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
    const visibleSet = new Set(game.visible || []);
    const discoveredSet = new Set(game.discovered || []);
    const entByTile = {};
    entities = game.entities || [];
    entities.forEach(e => { if (e.alive !== false) entByTile[e.x + ',' + e.y] = e; });

    // tiles
    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        const key = x + ',' + y;
        const seen = discoveredSet.has(key);
        if (!seen) { ctx.fillStyle = '#0a0806'; ctx.fillRect(px(x), px(y), TILE, TILE); continue; }
        const dim = !visibleSet.has(key);
        const c = map.rows[y][x];
        if (c === '#') drawWall(x, y, dim);
        else if (c === ',') drawRubble(x, y, dim);
        else drawFloor(x, y, dim);
      }
    }
    // doors & objects
    (game.objects || []).forEach(o => {
      const key = o.x + ',' + o.y;
      if (!discoveredSet.has(key)) return;
      const dim = !visibleSet.has(key);
      ctx.save();
      if (dim) ctx.globalAlpha = .45;
      if (o.type === 'door') drawDoor(o.x, o.y, !!o.open, dim);
      else if (o.type === 'chest' && !o.looted) drawToken(o.x, o.y, '#5a4a2f', '🧰');
      else if (o.type === 'chest' && o.looted) drawToken(o.x, o.y, '#33291d', '');
      else if (o.id === 'campfire') drawToken(o.x, o.y, '#5a3a1d', '🔥');
      else if (o.id === 'altar') drawToken(o.x, o.y, '#3a2f4a', '🕯️');
      else if (o.id === 'relic' && !o.taken) drawToken(o.x, o.y, '#4a3a6b', '💎');
      else if (o.type === 'trap') {
        ctx.strokeStyle = '#b8433a'; ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(px(o.x) + 8, px(o.y) + 8); ctx.lineTo(px(o.x) + TILE - 8, px(o.y) + TILE - 8);
        ctx.moveTo(px(o.x) + TILE - 8, px(o.y) + 8); ctx.lineTo(px(o.x) + 8, px(o.y) + TILE - 8);
        ctx.stroke();
      } else if (o.type === 'npcMarker') {
        // npc drawn with entities below
      }
      ctx.restore();
    });
    // entities (dead ones as marks)
    entities.forEach(e => {
      const key = e.x + ',' + e.y;
      if (!discoveredSet.has(key)) return;
      const dim = !visibleSet.has(key);
      ctx.save();
      if (e.alive === false) {
        if (e.kind === 'monster' || e.kind === 'ally') {
          ctx.globalAlpha = .35;
          drawToken(e.x, e.y, '#2a2018', '💀');
        }
        ctx.restore(); return;
      }
      if (dim && e.kind !== 'player') { ctx.restore(); return; }
      if (e.kind === 'player') drawToken(e.x, e.y, '#8a6d2f', '🗡️', { selected: opts.isSelected && opts.isSelected(e) });
      else if (e.kind === 'ally') drawToken(e.x, e.y, '#3f5c74', '🏹');
      else if (e.kind === 'npc') drawToken(e.x, e.y, '#5f3f74', e.icon || '🗣️');
      else if (e.kind === 'monster') {
        const glyph = e.boss ? '👹' : e.monsterId === 'giant_rat' ? '🐀' : e.monsterId === 'skeleton' ? '💀' : e.monsterId === 'zombie' ? '🧟' : e.monsterId === 'goblin' ? '👺' : '🧙';
        drawToken(e.x, e.y, e.boss ? '#7a2020' : '#6b2f2a', glyph, { selected: opts.isSelected && opts.isSelected(e) });
        if (!dim) drawHpBar(e.x, e.y, e.hp / e.hpMax);
      }
      ctx.restore();
    });
    // hover highlight
    if (hover) {
      ctx.strokeStyle = 'rgba(232,220,192,.5)';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(px(hover.x) + 1, px(hover.y) + 1, TILE - 2, TILE - 2);
    }
  }

  canvas.addEventListener('mousemove', ev => {
    hover = tileFromEvent(ev);
    render(currentGame);
  });
  canvas.addEventListener('mouseleave', () => { hover = null; });

  let currentGame = null;
  function renderStore(game) { currentGame = game; render(game); }

  return { render: renderStore, tileFromEvent };
}
