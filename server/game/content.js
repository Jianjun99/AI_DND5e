// Two phases: register all definitions, then resolve references across packs.
const fs = require('fs');
const path = require('path');
const checks = require('./content-validation');
const visualContent = require('./visual-content');
const { SYSTEM_NODES, WAYPOINT_ICONS } = require('./adventure-system');

const ROOT = path.join(__dirname, '..', '..');
const SHARED = path.join(ROOT, 'shared');
const SHIPPED_PACKS = path.join(ROOT, 'content');
const USER_PACKS = path.join(process.env.DATA_DIR || path.join(ROOT, 'data'), 'content');
let REG = null;
let ALLY_NAMES = null;

const source = (pack, file, field = '') => ({ packId: pack.id, packName: pack.name, file: file.replace(/\\/g, '/'), field });
const formatDiagnostic = d => '[' + d.packName + '] ' + d.severity + ' (' + d.code + ') ' + d.file + (d.field ? ':' + d.field : '') + ': ' + d.message;
const summary = p => ({ id: p.id, name: p.name, author: p.author, blurb: p.blurb, localized:p.localized, availableLocales:Object.keys(p.localized || {}), installed: !!p.installed, maps: p.maps, monsters: p.monsters, gear: p.gear, models: p.visual?.models.map(m=>m.id)||[],hasVisuals:!!p.visualPresent,visualValid:!!p.visual });

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
    const before = reg.diagnostics.length;
    checks.validateLocalized(manifest,source(provisional,'pack.json'),reg.diagnostics);
    if (reg.diagnostics.length !== before) return;
    const pack = {
      id: manifest.id || folderId, name: manifest.name || manifest.id || folderId,
      author: manifest.author || 'Unknown', blurb: manifest.blurb || '', localized:manifest.localized, dir, installed,
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
    const visualManifest = bundle ? bundle.visuals : (fs.existsSync(path.join(dir,'visuals.json')) ? read(path.join(dir,'visuals.json'),source(pack,'visuals.json')) : undefined);
    pack.visualPresent=visualManifest!==undefined||(!bundle&&fs.existsSync(path.join(dir,'visuals.json')));
    if (visualManifest !== undefined) {
      try { pack.visual = visualContent.validateVisuals(visualManifest, bundle ? visualContent.bundleReader(bundle.assets) : file=>visualContent.readDeclaredAsset(dir,file), source(pack,'visuals.json'),reg.diagnostics); }
      catch(error) { checks.diagnostic(reg.diagnostics,source(pack,'visuals.json'),'assets',error.message,'invalid-visual'); }
      pack.visualManifest=visualManifest;
    }
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
  const sharedMonsters = read(path.join(SHARED, 'monsters.json'), source(core, 'shared/monsters.json'));
  definitions(sharedMonsters, 'monsters', source(core, 'shared/monsters.json'), core);
  const equipment = read(path.join(SHARED, 'equipment.json'), source(core, 'shared/equipment.json'));
  definitions(equipment, 'gear', source(core, 'shared/equipment.json'), core);
  const spells = read(path.join(SHARED, 'spells.json'), source(core, 'shared/spells.json'));
  const tables = {
    itemIds: new Set([...(equipment?.weapons || []), ...(equipment?.armor || [])].map(item => item.id)),
    weaponIds: new Set((equipment?.weapons || []).map(item => item.id)),
    armorIds: new Set((equipment?.armor || []).map(item => item.id)),
    spellIds: new Set((spells?.spells || []).map(spell => spell.id)),
    allyIds: new Set((sharedMonsters?.allies || []).map(ally => ally.id))
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
  const modelIds=new Set();
  for(const pack of reg.packs) if(pack.visual) {
    for(const model of pack.visual.models) {
      if(modelIds.has(model.id)) checks.diagnostic(reg.diagnostics,source(pack,'visuals.json'),'models.id','Visual model ID already registered.','duplicate-visual');
      modelIds.add(model.id);
    }
    for(const id of Object.keys(pack.visual.bindings)) if(!reg.monsters[id]) checks.diagnostic(reg.diagnostics,source(pack,'visuals.json'),'bindings.monsters.'+id,'Unknown registered monster ID.','invalid-visual-reference');
  }
  for(const pack of reg.packs) if(reg.diagnostics.some(d=>d.packId===pack.id&&['duplicate-visual','invalid-visual-reference'].includes(d.code))) pack.visual=null;
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
  if (value?.version !== undefined && ![1,2].includes(value.version)) error('version', 'Supported bundle versions: 1, 2.');
  if ((value?.visuals!==undefined || value?.assets!==undefined) && value?.version!==2) error('version','Visual resources require bundle version 2.');
  if(value?.version===2) {
    const visual=visualContent.validateVisuals(value.visuals, file=>visualContent.bundleReader(value.assets)(file),src,diagnostics);
    if(!visual)error('visuals','Version 2 requires a valid visual manifest.');
    else if(!checks.object(value.assets)||Object.keys(value.assets).some(file=>!visual.files.has(file))||Object.keys(value.assets).length!==visual.files.size)error('assets','Exactly the declared assets must be provided.');
  }
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
  const pack=prospective.packs.find(p=>p.id===bundle.pack.id);
  return { ...result(), pack: pack ? summary(pack) : null };
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
// Explicit public projection: never copy rooms, NPCs, objectives or raw localized trees.
function publicText(node, field) {
  const fallback = typeof node?.[field] === 'string' ? node[field] : '';
  const localized = Object.fromEntries(['en', 'zh-CN'].filter(locale => typeof node?.localized?.[locale]?.[field] === 'string').map(locale => [locale, node.localized[locale][field]]));
  return { fallback, ...(Object.keys(localized).length ? { localized } : {}) };
}
function adventureDirectory() {
  const r = ensure();
  if (!ALLY_NAMES) ALLY_NAMES = Object.fromEntries((JSON.parse(fs.readFileSync(path.join(SHARED, 'monsters.json'), 'utf8')).allies || []).map(a => [a.id, a]));
  const allyNames = ALLY_NAMES;
  /** @type {any[]} */
  const adventures = Object.values(r.maps).filter(m => r.sources.maps[m.id]).map(m => {
    const pack = r.packs.find(p => p.maps.includes(m.id));
    const w = m.adventure?.waypoint, levels = m.adventure?.levels;
    const recommended = levels ? 'Level ' + levels.min + '–' + levels.max : (m.recommended || '');
    const levelRangeDisplay = levels ? { key: 'adventure.levels', params: levels, fallback: recommended } : (recommended ? publicText(m, 'recommended') : { key: 'adventure.unspecified' });
    const companionDef = m.story?.companion ? allyNames[m.story.companion] : null;
    return {
      id: m.id, mapId: m.id, type: 'dungeon', safe: false,
      name: m.name, nameDisplay: publicText(m, 'name'), blurb: m.blurb || '', blurbDisplay: publicText(m, 'blurb'),
      recommended, recommendedDisplay: levelRangeDisplay, levelRange: recommended, levelRangeDisplay,
      ...(m.story?.companion ? { requiresCompanion: m.story.companion, requiresCompanionName: companionDef ? publicText(companionDef, 'name') : { fallback: m.story.companion } } : { requiresCompanion: null }),
      ...(m.story?.requiresHistory ? { requiresHistory: m.story.requiresHistory } : {}),
      packId: pack?.id || 'core', pack: pack?.name || 'Core', packDisplay: pack?.id === 'core' ? { key: 'adventure.core', fallback: pack.name } : publicText(pack, 'name'), installed: !!pack?.installed,
      availableLocales: ['en', 'zh-CN'].filter(locale => ['name', ...(m.blurb ? ['blurb'] : [])].every(field => typeof m.localized?.[locale]?.[field] === 'string')),
      marker: w?.icon || 'dungeon',
      ...(w ? { x: w.regionX, y: w.regionY, icon: WAYPOINT_ICONS[w.icon] || WAYPOINT_ICONS.dungeon, region: w.region || '', regionDisplay: publicText(w, 'region') } : { icon: WAYPOINT_ICONS.dungeon, region: '' })
    };
  });
  for (const node of SYSTEM_NODES.filter(n => !n.safe)) adventures.push({
    ...node, localized: undefined, marker: node.type,
    nameDisplay: publicText(node, 'name'), blurbDisplay: publicText(node, 'blurb'), levelRangeDisplay: publicText(node, 'levelRange'), regionDisplay: publicText(node, 'region'),
    recommended: node.levelRange, recommendedDisplay: publicText(node, 'levelRange'),
    packId: 'system', pack: 'System', packDisplay: { key: 'adventure.system' }, installed: false, availableLocales: ['en', 'zh-CN']
  });
  const city = SYSTEM_NODES.find(n => n.safe);
  // Stable geography order keeps overlapping legacy markers independent of pack scan order.
  // Paint the safe hub first so its label cannot cover nearby adventure hit targets.
  const waypoints = [{ ...city, marker: 'city', nameDisplay: publicText(city, 'name'), blurbDisplay: publicText(city, 'blurb'), levelRangeDisplay: publicText(city, 'levelRange'), regionDisplay: publicText(city, 'region') }, ...adventures.filter(n => n.x !== undefined)].sort((a, b) => Number(!!b.safe) - Number(!!a.safe) || b.y - a.y || a.x - b.x || a.id.localeCompare(b.id));
  const roads = Object.values(r.maps).filter(m => r.sources.maps[m.id]).flatMap(m => (m.adventure?.waypoint?.roads || []).map(road => ({ from: m.id, to: road.to, label: road.label || '', labelDisplay: publicText(road, 'label') })));
  return { adventures, waypoints, roads };
}
function listMaps() {
  return adventureDirectory().adventures.filter(m => m.type === 'dungeon').map(entry => {
    const m = getMap(entry.id);
    // Retain the old maps API's public objective and translations, with a whitelist.
    const localized = Object.fromEntries(Object.entries(m.localized || {}).map(([locale, texts]) => [locale, Object.fromEntries(['name', 'blurb', 'objectiveText', 'recommended'].filter(key => typeof texts[key] === 'string').map(key => [key, texts[key]]))]));
    return { ...entry, objectiveText: m.objectiveText || '', localized };
  });
}
function getMonster(id) { return ensure().monsters[id] || null; }
function listMonsters() { return Object.values(ensure().monsters); }
function getGear(id) { return ensure().gear[id] || null; }
function listGear() { return Object.values(ensure().gear); }
function listPacks() { return ensure().packs.map(summary); }
function warnings() { return ensure().warnings; }
function diagnostics() { return ensure().diagnostics; }

module.exports = { scan, reload, getMap, injectMap, defaultMapId, listMaps, adventureDirectory, getMonster, listMonsters, getGear, listGear, listPacks, warnings, diagnostics, validateBundle };
