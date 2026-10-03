// Two phases: register all definitions, then resolve references across packs.
const fs = require('fs');
const path = require('path');
const checks = require('./content-validation');

const ROOT = path.join(__dirname, '..', '..');
const SHARED = path.join(ROOT, 'shared');
const SHIPPED_PACKS = path.join(ROOT, 'content');
const USER_PACKS = path.join(process.env.DATA_DIR || path.join(ROOT, 'data'), 'content');
let REG = null;

const source = (pack, file, field = '') => ({ packId: pack.id, packName: pack.name, file: file.replace(/\\/g, '/'), field });
const formatDiagnostic = d => '[' + d.packName + '] ' + d.severity + ' (' + d.code + ') ' + d.file + (d.field ? ':' + d.field : '') + ': ' + d.message;
const summary = p => ({ id: p.id, name: p.name, author: p.author, blurb: p.blurb, installed: !!p.installed, maps: p.maps, monsters: p.monsters, gear: p.gear });

/** @param {{cache?: boolean, userRoot?: string, replaceId?: string, bundle?: any, bundleDir?: string}} options */
function scan(options = {}) {
  const reg = {
    maps: Object.create(null), monsters: Object.create(null), gear: Object.create(null),
    sources: { maps: Object.create(null), monsters: Object.create(null), gear: Object.create(null) },
    packs: [], diagnostics: [], warnings: []
  };
  const read = (file, src) => {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
    catch (error) { checks.diagnostic(reg.diagnostics, src, '', 'Cannot read JSON: ' + error.message, 'invalid-json'); return undefined; }
  };
  const directory = (dir, src) => {
    try { return fs.readdirSync(dir, { withFileTypes: true }); }
    catch (error) { checks.diagnostic(reg.diagnostics, src, '', 'Cannot read directory: ' + error.message, 'invalid-directory'); return []; }
  };
  const register = (kind, value, src, pack) => {
    const def = checks.validateDefinition(kind, value, src, reg.diagnostics);
    if (!def) return;
    if (reg[kind][def.id]) {
      const winner = reg.sources[kind][def.id];
      checks.diagnostic(reg.diagnostics, src, src.field ? src.field + '.id' : 'id',
        kind + ' ID ' + def.id + ' is ignored; effective definition is from ' + winner.packName + ' (' + winner.file + ').',
        'duplicate-definition', 'warning', { winner });
      return;
    }
    reg[kind][def.id] = def; reg.sources[kind][def.id] = src; pack[kind].push(def.id);
  };
  const definitions = (document, kind, src, pack) => {
    if (document === undefined) return;
    if (!checks.object(document) || (document[kind] !== undefined && !Array.isArray(document[kind]))) {
      checks.diagnostic(reg.diagnostics, src, kind, 'Expected an object containing a ' + kind + ' array.'); return;
    }
    (document[kind] || []).forEach((def, i) => register(kind, def, { ...src, field: kind + '[' + i + ']' }, pack));
  };
  const addPack = (manifest, dir, installed, folderId, bundle = null) => {
    const provisional = { id: folderId, name: folderId };
    if (!checks.object(manifest) || !checks.validId(manifest.id || folderId)) {
      checks.diagnostic(reg.diagnostics, source(provisional, 'pack.json'), 'id', 'Pack needs a valid ID.', 'invalid-id'); return;
    }
    const pack = {
      id: manifest.id || folderId, name: manifest.name || manifest.id || folderId,
      author: manifest.author || 'Unknown', blurb: manifest.blurb || '', dir, installed,
      maps: [], monsters: [], gear: []
    };
    for (const field of ['name', 'author', 'blurb']) {
      if (manifest[field] !== undefined && typeof manifest[field] !== 'string') {
        checks.diagnostic(reg.diagnostics, source(pack, 'pack.json'), field, 'Expected a string.'); return;
      }
    }
    if (reg.packs.some(p => p.id === pack.id)) {
      checks.diagnostic(reg.diagnostics, source(pack, 'pack.json'), 'id', 'Pack ID already exists; this folder is ignored.', 'duplicate-pack', 'warning'); return;
    }
    reg.packs.push(pack);
    if (bundle) {
      bundle.maps.forEach(map => register('maps', map, source(pack, 'maps/' + (checks.validId(map?.id) ? map.id : '?') + '.json'), pack));
      definitions({ monsters: bundle.monsters }, 'monsters', source(pack, 'monsters.json'), pack);
      definitions({ gear: bundle.gear }, 'gear', source(pack, 'gear.json'), pack);
      return;
    }
    const mapsDir = path.join(dir, 'maps');
    if (fs.existsSync(mapsDir)) directory(mapsDir, source(pack, 'maps')).filter(entry => entry.name.endsWith('.json')).map(entry => entry.name).sort().forEach(file => {
      const src = source(pack, 'maps/' + file);
      const value = read(path.join(mapsDir, file), src);
      if (value !== undefined) register('maps', value, src, pack);
    });
    for (const kind of ['monsters', 'gear']) {
      const preferred = path.join(dir, kind + '.json');
      const file = fs.existsSync(preferred) ? preferred : path.join(dir, 'monsters-gear.json');
      if (fs.existsSync(file)) {
        const src = source(pack, path.basename(file));
        definitions(read(file, src), kind, src, pack);
      }
    }
  };

  const core = { id: 'core', name: 'Core Game', author: 'AI Dungeon', blurb: 'The Sunless Crypt and the base bestiary.', builtin: true, maps: [], monsters: [], gear: [] };
  reg.packs.push(core);
  const coreMapSource = source(core, 'shared/maps/crypt.json');
  const coreMap = read(path.join(SHARED, 'maps', 'crypt.json'), coreMapSource);
  if (coreMap !== undefined) register('maps', coreMap, coreMapSource, core);
  definitions(read(path.join(SHARED, 'monsters.json'), source(core, 'shared/monsters.json')), 'monsters', source(core, 'shared/monsters.json'), core);
  const equipment = read(path.join(SHARED, 'equipment.json'), source(core, 'shared/equipment.json'));
  definitions(equipment, 'gear', source(core, 'shared/equipment.json'), core);
  const spells = read(path.join(SHARED, 'spells.json'), source(core, 'shared/spells.json'));
  const tables = {
    itemIds: new Set([...(equipment?.weapons || []), ...(equipment?.armor || [])].map(item => item.id)),
    weaponIds: new Set((equipment?.weapons || []).map(item => item.id)),
    armorIds: new Set((equipment?.armor || []).map(item => item.id)),
    spellIds: new Set((spells?.spells || []).map(spell => spell.id))
  };
  for (const { dir, installed } of [{ dir: SHIPPED_PACKS, installed: false }, { dir: options.userRoot || USER_PACKS, installed: true }]) {
    if (!fs.existsSync(dir)) continue;
    const entries = directory(dir, source({ id: 'registry', name: 'Content registry' }, dir)).filter(entry => entry.isDirectory()).map(entry => ({ name: entry.name, virtual: false }));
    if (installed && options.bundle) entries.push({ name: path.basename(options.bundleDir || options.bundle.pack.id), virtual: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (entry.virtual) {
        addPack(options.bundle.pack, options.bundleDir || path.join(USER_PACKS, options.bundle.pack.id), true, entry.name, options.bundle);
        continue;
      }
      const packDir = path.join(dir, entry.name), manifestFile = path.join(packDir, 'pack.json');
      if (!fs.existsSync(manifestFile)) continue;
      const manifest = read(manifestFile, source({ id: entry.name, name: entry.name }, 'pack.json'));
      if (manifest === undefined) continue;
      if (installed && options.replaceId && (manifest?.id || entry.name) === options.replaceId) continue;
      addPack(manifest, packDir, installed, entry.name);
    }
  }
  if (options.bundle && !fs.existsSync(options.userRoot || USER_PACKS)) addPack(options.bundle.pack, path.join(USER_PACKS, options.bundle.pack.id), true, options.bundle.pack.id, options.bundle);

  // Cascading invalid references are removed too; cycles between valid maps survive.
  let removed;
  do {
    removed = false;
    for (const kind of ['gear', 'monsters', 'maps']) {
      for (const def of Object.values(reg[kind])) {
        if (!checks.validateReferences(kind, def, reg.sources[kind][def.id], reg, tables, reg.diagnostics)) {
          delete reg[kind][def.id]; removed = true;
        }
      }
    }
  } while (removed);
  Object.values(reg.maps).forEach(map => checks.checkReachability(map, reg.sources.maps[map.id], reg.diagnostics));
  reg.packs.forEach(pack => { for (const kind of ['maps', 'monsters', 'gear']) pack[kind] = pack[kind].filter(id => reg[kind][id]); });
  reg.warnings = reg.diagnostics.map(formatDiagnostic);
  if (options.cache !== false) REG = reg;
  return reg;
}

function validateBundle(value) {
  const diagnostics = [];
  const src = source({ id: checks.validId(value?.pack?.id) ? value.pack.id : '?', name: value?.pack?.name || '?' }, 'bundle.json');
  const error = (field, message) => checks.diagnostic(diagnostics, src, field, message);
  if (!checks.object(value) || value.format !== 'ai-dnd-pack') error('format', 'Expected ai-dnd-pack.');
  if (!checks.object(value?.pack) || !checks.validId(value.pack.id) || value.pack.id === 'core') error('pack.id', 'A valid non-core pack ID is required.');
  for (const field of ['name', 'author', 'blurb']) if (value?.pack?.[field] !== undefined && typeof value.pack[field] !== 'string') error('pack.' + field, 'Expected a string.');
  if (value?.version !== undefined && value.version !== 1) error('version', 'Supported bundle version: 1.');
  for (const kind of ['maps', 'monsters', 'gear']) {
    if (value?.[kind] !== undefined && !Array.isArray(value[kind])) error(kind, 'Expected an array.');
    if (Array.isArray(value?.[kind])) {
      const ids = new Set();
      value[kind].forEach((def, i) => {
        if (checks.validId(def?.id) && ids.has(def.id)) error(kind + '[' + i + '].id', 'Definition ID is repeated inside the bundle.');
        ids.add(def?.id);
      });
    }
  }
  const result = () => ({ ok: !diagnostics.some(d => d.severity === 'error'), diagnostics, warnings: diagnostics.map(formatDiagnostic) });
  if (diagnostics.length) return result();
  const bundle = structuredClone(value);
  for (const kind of ['maps', 'monsters', 'gear']) bundle[kind] ??= [];
  const baseline = scan({ cache: false });
  if (baseline.packs.some(p => p.id === bundle.pack.id && !p.installed)) {
    error('pack.id', 'Shipped packs cannot be replaced by an import.'); return result();
  }
  const previous = baseline.packs.find(p => p.id === bundle.pack.id && p.installed);
  const prospective = scan({ cache: false, bundle, replaceId: bundle.pack.id, bundleDir: previous?.dir });
  const key = d => JSON.stringify([d.packId, d.file, d.field, d.code, d.message]);
  const priorErrors = new Set(baseline.diagnostics.filter(d => d.severity === 'error' && d.packId !== bundle.pack.id).map(key));
  diagnostics.push(...prospective.diagnostics.filter(d => d.packId === bundle.pack.id || (d.severity === 'error' && !priorErrors.has(key(d)))));
  return { ...result(), pack: summary(prospective.packs.find(p => p.id === bundle.pack.id)) };
}

function ensure() { if (!REG) scan(); return REG; }
function reload() { return scan(); }
function defaultMapId() { const r = ensure(); return r.maps.crypt ? 'crypt' : Object.keys(r.maps)[0]; }
function getMap(id) {
  const r = ensure();
  if (id === undefined || id === null) id = defaultMapId();
  return typeof id === 'string' ? r.maps[id] || null : null;
}
function injectMap(mapDef) { ensure().maps[mapDef.id] = mapDef; }
function listMaps() {
  const r = ensure();
  return Object.values(r.maps).map(m => ({
    id: m.id, name: m.name, blurb: m.blurb || (m.rooms || [])[0]?.desc || '',
    objectiveText: m.objectiveText || '', recommended: m.recommended || '',
    pack: (r.packs.find(p => p.maps.includes(m.id)) || {}).name || 'Core'
  }));
}
function getMonster(id) { return ensure().monsters[id] || null; }
function listMonsters() { return Object.values(ensure().monsters); }
function getGear(id) { return ensure().gear[id] || null; }
function listGear() { return Object.values(ensure().gear); }
function listPacks() { return ensure().packs.map(summary); }
function warnings() { return ensure().warnings; }
function diagnostics() { return ensure().diagnostics; }

module.exports = { scan, reload, getMap, injectMap, defaultMapId, listMaps, getMonster, listMonsters, getGear, listGear, listPacks, warnings, diagnostics, validateBundle };
