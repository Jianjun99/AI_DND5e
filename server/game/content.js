// content.js — the content registry: core game data + user content packs.
// Packs are folders containing pack.json + maps/*.json + monsters.json + gear.json.
// They live either in <repo>/content (shipped with the game) or <data>/content (installed at runtime).
const fs = require('fs');
const path = require('path');

const SHARED = path.join(__dirname, '..', '..', 'shared');
const SHIPPED_PACKS = path.join(__dirname, '..', '..', 'content');
const USER_PACKS = path.join(process.env.DATA_DIR || path.join(__dirname, '..', '..', 'data'), 'content');

const loadJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));

let REG = null;

function validateMap(map, packName, warnings) {
  const errs = [];
  if (!map.id || !/^[a-z0-9_-]+$/.test(map.id)) errs.push('map needs an id (lowercase letters, numbers, _ or -)');
  if (!map.name) errs.push('map needs a name');
  if (!Array.isArray(map.rows) || !map.rows.length) errs.push('map needs rows (array of strings)');
  else {
    const w = map.rows[0].length;
    map.rows.forEach((r, i) => { if (r.length !== w) errs.push(`row ${i} length ${r.length} != ${w}`); });
    if (!map.width) map.width = w;
    if (!map.height) map.height = map.rows.length;
  }
  if (!map.playerStart) errs.push('map needs playerStart {x,y}');
  if (!map.victory || !map.victory.campfire) errs.push('map needs victory.campfire {x,y}');
  ['x', 'y'].forEach(k => {
    if (map.playerStart && typeof map.playerStart[k] !== 'number') errs.push(`playerStart.${k} must be a number`);
    if (map.victory && map.victory.campfire && typeof map.victory.campfire[k] !== 'number') errs.push(`victory.campfire.${k} must be a number`);
  });
  if (!Array.isArray(map.entities)) map.entities = [];
  map.entities.forEach((e, i) => {
    if (typeof e.x !== 'number' || typeof e.y !== 'number') errs.push(`entity ${i} needs numeric x,y`);
    if (e.type === 'monster' && !e.kind) errs.push(`monster entity ${i} needs kind`);
  });
  errs.forEach(e => warnings.push(`[${packName}] map "${map.id || '?'}": ${e}`));
  return errs.length === 0 ? map : null;
}

function validateMonster(m, packName, warnings) {
  const errs = [];
  if (!m.id) errs.push('monster needs an id');
  if (!m.name) errs.push(`monster ${m.id || '?'} needs a name`);
  if (typeof m.ac !== 'number') errs.push(`monster ${m.id || '?'} needs numeric ac`);
  if (!m.hp || !/^\d+d\d+([+-]\d+)?$/.test(m.hp)) errs.push(`monster ${m.id || '?'} needs hp like "2d6+1"`);
  if (!m.abilities) errs.push(`monster ${m.id || '?'} needs abilities {str,dex,con,int,wis,cha}`);
  if (!Array.isArray(m.attacks) || !m.attacks.length) errs.push(`monster ${m.id || '?'} needs at least one attack`);
  m.attacks = m.attacks || [];
  m.attacks.forEach(a => {
    if (typeof a.bonus !== 'number' || !a.damage) errs.push(`monster ${m.id || '?'} attack "${a.name || '?'}" needs numeric bonus and damage`);
  });
  if (typeof m.xp !== 'number') errs.push(`monster ${m.id || '?'} needs numeric xp`);
  errs.forEach(e => warnings.push(`[${packName}] monster "${m.id || '?'}": ${e}`));
  return errs.length === 0 ? m : null;
}

function validateGear(g, packName, warnings) {
  const errs = [];
  if (!g.id || !g.name) errs.push(`gear ${g.id || '?'} needs id and name`);
  errs.forEach(e => warnings.push(`[${packName}] gear "${g.id || '?'}": ${e}`));
  return errs.length === 0 ? g : null;
}

function scan() {
  const reg = {
    maps: {}, monsters: {}, gear: {},
    packs: [], // [{id, name, author, blurb, dir, maps:[], monsters:[], gear:[]}]
    warnings: []
  };

  // ---- core content (shared/) ----
  reg.maps['crypt'] = loadJson(path.join(SHARED, 'maps', 'crypt.json'));
  const coreMonsters = loadJson(path.join(SHARED, 'monsters.json'));
  coreMonsters.monsters.forEach(m => { reg.monsters[m.id] = m; });
  const coreGear = loadJson(path.join(SHARED, 'equipment.json'));
  coreGear.gear.forEach(g => { reg.gear[g.id] = g; });
  reg.packs.push({ id: 'core', name: 'Core Game', author: 'AI Dungeon', blurb: 'The Sunless Crypt and the base bestiary.', builtin: true, maps: ['crypt'], monsters: coreMonsters.monsters.map(m => m.id), gear: [] });

  // ---- pack folders ----
  const packRoots = [
    { dir: SHIPPED_PACKS, installed: false },
    { dir: USER_PACKS, installed: true }
  ];
  packRoots.forEach(({ dir, installed }) => {
    if (!fs.existsSync(dir)) return;
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    entries.filter(d => d.isDirectory()).forEach(dirent => {
      const packDir = path.join(dir, dirent.name);
      const manifestPath = path.join(packDir, 'pack.json');
      if (!fs.existsSync(manifestPath)) return;
      try {
        const manifest = loadJson(manifestPath);
        const packId = manifest.id || dirent.name;
        const pack = {
          id: packId, name: manifest.name || packId, author: manifest.author || 'Unknown',
          blurb: manifest.blurb || '', dir: packDir, installed,
          maps: [], monsters: [], gear: []
        };
        // maps
        const mapsDir = path.join(packDir, 'maps');
        if (fs.existsSync(mapsDir)) {
          fs.readdirSync(mapsDir).filter(f => f.endsWith('.json')).forEach(f => {
            try {
              const map = validateMap(loadJson(path.join(mapsDir, f)), pack.name, reg.warnings);
              if (map) {
                if (reg.maps[map.id]) reg.warnings.push(`[${pack.name}] map id "${map.id}" already exists — pack version ignored`);
                else { reg.maps[map.id] = map; pack.maps.push(map.id); }
              }
            } catch (e) { reg.warnings.push(`[${pack.name}] bad map file ${f}: ${e.message}`); }
          });
        }
        // monsters
        const monPath = path.join(packDir, 'monsters.json');
        if (fs.existsSync(monPath)) {
          try {
            (loadJson(monPath).monsters || []).forEach(m => {
              const ok = validateMonster(m, pack.name, reg.warnings);
              if (ok) {
                if (reg.monsters[m.id]) reg.warnings.push(`[${pack.name}] monster id "${m.id}" already exists — pack version ignored`);
                else { reg.monsters[m.id] = m; pack.monsters.push(m.id); }
              }
            });
          } catch (e) { reg.warnings.push(`[${pack.name}] bad monsters.json: ${e.message}`); }
        }
        // gear
        const gearPath = path.join(packDir, 'gear.json');
        if (fs.existsSync(gearPath)) {
          try {
            (loadJson(gearPath).gear || []).forEach(g => {
              const ok = validateGear(g, pack.name, reg.warnings);
              if (ok) {
                if (reg.gear[g.id]) reg.warnings.push(`[${pack.name}] gear id "${g.id}" already exists — pack version ignored`);
                else { reg.gear[g.id] = g; pack.gear.push(g.id); }
              }
            });
          } catch (e) { reg.warnings.push(`[${pack.name}] bad gear.json: ${e.message}`); }
        }
        reg.packs.push(pack);
      } catch (e) {
        reg.warnings.push(`pack ${dirent.name}: unreadable pack.json (${e.message})`);
      }
    });
  });

  REG = reg;
  return reg;
}

function ensure() { if (!REG) scan(); return REG; }
function reload() { return scan(); }

function getMap(id) { const r = ensure(); return r.maps[id] || r.maps['crypt'] || null; }
function defaultMapId() { const r = ensure(); return r.maps['crypt'] ? 'crypt' : Object.keys(r.maps)[0]; }
function listMaps() {
  const r = ensure();
  const packOf = (mapId) => (r.packs.find(p => p.maps.includes(mapId)) || {}).name || 'Core';
  return Object.values(r.maps).map(m => ({
    id: m.id, name: m.name, blurb: m.blurb || (m.rooms || [])[0]?.desc || '',
    objectiveText: m.objectiveText || '', pack: packOf(m.id)
  }));
}
function getMonster(id) { return ensure().monsters[id] || null; }
function getGear(id) { return ensure().gear[id] || null; }
function listGear() { return Object.values(ensure().gear); }
function listPacks() {
  const r = ensure();
  return r.packs.map(p => ({ id: p.id, name: p.name, author: p.author, blurb: p.blurb, installed: !!p.installed, maps: p.maps, monsters: p.monsters, gear: p.gear }));
}
function warnings() { return ensure().warnings; }

module.exports = { scan, reload, getMap, defaultMapId, listMaps, getMonster, getGear, listGear, listPacks, warnings };
