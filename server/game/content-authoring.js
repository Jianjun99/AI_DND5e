// server/game/content-authoring.js
// Template cloning, namespace remapping, draft storage, validation, export, install and playtest.

const fs = require('fs');
const path = require('path');
const store = require('../store');
const content = require('./content');
const checks = require('./content-validation');
const contentContext = require('./content-context');
const { resolveHistoryBinding, mergeEncounterFacts } = require('./history-binding');
const adventureSystem = require('./adventure-system');
const engine = require('./engine');
const visualContent = require('./visual-content');

function draftsDir() {
  const dir = path.join(store.DATA_DIR, 'drafts');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// The only place a draft path is built. A draft ID is a stable path segment: it must match
// the shared ID grammar (no separators, no dot segments, no encoded traversal after
// Express decodes the URL) AND resolve inside the drafts root. Content errors stay
// tolerated inside a legal draft file — that is not a licence for an arbitrary path.
function draftFileFor(id) {
  if (!checks.validId(id)) {
    const err = /** @type {any} */ (new Error('Draft ID must match [a-z0-9_-]+.'));
    err.code = 'invalid-draft-id';
    err.status = 400;
    throw err;
  }
  const root = path.resolve(draftsDir());
  const target = path.resolve(root, `${id}.json`);
  const relative = path.relative(root, target);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    const err = /** @type {any} */ (new Error('Draft path escapes the drafts directory.'));
    err.code = 'invalid-draft-id';
    err.status = 400;
    throw err;
  }
  return target;
}

// The path ID is authoritative: a draft whose pack.id differs would export, install and
// playtest under two different identities.
function identityIssue(id, draft, validation) {
  const declared = draft && draft.pack ? draft.pack.id : undefined;
  if (declared === id) return validation;
  const result = validation || { ok: true, diagnostics: [], warnings: [] };
  const message = 'Draft identity conflict: the draft is stored as "' + id + '" but pack.id says "' +
    (declared === undefined ? '(missing)' : declared) + '". Fix pack.id or rename the draft.';
  result.diagnostics = [...(result.diagnostics || []), {
    packId: id, file: `drafts/${id}.json`, field: 'pack.id', severity: 'error',
    code: 'draft-id-mismatch', message
  }];
  result.warnings = [...(result.warnings || []), '[' + id + '] error (draft-id-mismatch) drafts/' + id + '.json: pack.id: ' + message];
  result.ok = false;
  return result;
}

function listDrafts() {
  const dir = draftsDir();
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
  const drafts = [];
  for (const file of files) {
    // The stored filename is the draft's identity; getDraft adds the pack.id agreement check.
    const id = path.basename(file, '.json');
    try {
      const fullPath = path.join(dir, file);
      const stat = fs.statSync(fullPath);
      const data = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
      const val = identityIssue(id, data, content.validateBundle(data));
      drafts.push({
        id,
        name: data.pack?.name || id,
        author: data.pack?.author || '',
        blurb: data.pack?.blurb || '',
        updatedAt: data.updatedAt || stat.mtimeMs,
        isValid: val.ok,
        errorCount: val.diagnostics.filter(d => d.severity === 'error').length
      });
    } catch {
      // Skip unreadable files
    }
  }
  drafts.sort((a, b) => b.updatedAt - a.updatedAt);
  return drafts;
}

function getDraft(id) {
  const filePath = draftFileFor(id);
  if (!fs.existsSync(filePath)) return null;
  const draft = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const validation = identityIssue(id, draft, content.validateBundle(draft));
  return { draft, validation };
}

function stripDisplayFields(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) {
    for (const item of obj) stripDisplayFields(item);
    return obj;
  }
  for (const key of Object.keys(obj)) {
    if (key.endsWith('Display')) {
      delete obj[key];
    } else {
      stripDisplayFields(obj[key]);
    }
  }
  return obj;
}

function saveDraft(id, draftData) {
  const filePath = draftFileFor(id);
  if (!draftData || typeof draftData !== 'object' || !draftData.pack) {
    const err = /** @type {any} */ (new Error('Draft payload needs a pack object.'));
    err.code = 'invalid-draft-payload';
    err.status = 400;
    throw err;
  }
  // A draft may be stored half-finished (content errors are tolerated and reported), but its
  // pack.id must agree with the path it is stored under — that is identity, not content.
  if (draftData.pack.id !== id) {
    const err = /** @type {any} */ (new Error('Draft identity conflict: the path says "' + id + '" but pack.id says "' +
      String(draftData.pack.id) + '". Keep them equal.'));
    err.code = 'draft-id-mismatch';
    err.status = 409;
    err.diagnostics = identityIssue(id, draftData, { ok: false, diagnostics: [], warnings: [] }).diagnostics;
    throw err;
  }
  stripDisplayFields(draftData);
  draftData.updatedAt = Date.now();
  fs.writeFileSync(filePath, JSON.stringify(draftData, null, 2), 'utf8');
  const validation = content.validateBundle(draftData);
  return { ok: true, draft: draftData, validation };
}

function deleteDraft(id) {
  const filePath = draftFileFor(id);
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
  // The draft's playtest hero and its runs were created for this draft alone. Each save and
  // each hero is matched by its own fields — never by an id prefix, never a bulk delete.
  for (const row of store.listSaves()) {
    const save = store.getSave(row.id);
    if (save && save.isPlaytest === true && save.ownerDraftId === id && save.characterId === playtestHeroId(id)) {
      store.deleteSave(save.id);
    }
  }
  const chars = store.getCharacters();
  const kept = chars.filter(c => !(c.isPlaytest === true && c.ownerDraftId === id && c.id === playtestHeroId(id)));
  if (kept.length !== chars.length) store.saveCharacters(kept);
  return { ok: true };
}

/** @param {{ slug?: string, name?: string, author?: string }} [options] */
function cloneStarterTemplate(options = {}) {
  const { slug, name, author } = options;
  const starterDir = path.resolve(__dirname, '../../content/missing-courier');
  if (!fs.existsSync(starterDir)) {
    throw new Error('Starter template content/missing-courier not found.');
  }

  const starterPack = JSON.parse(fs.readFileSync(path.join(starterDir, 'pack.json'), 'utf8'));
  const ch1 = JSON.parse(fs.readFileSync(path.join(starterDir, 'maps/courier-crossing.json'), 'utf8'));
  const ch2 = JSON.parse(fs.readFileSync(path.join(starterDir, 'maps/river-post.json'), 'utf8'));
  const starterGear = JSON.parse(fs.readFileSync(path.join(starterDir, 'gear.json'), 'utf8'));

  // Determine unique targetPackId
  const rawSlug = (slug || 'adventure').toLowerCase().replace(/[^a-z0-9_-]/g, '_');
  const baseSlug = rawSlug.startsWith('custom_') ? rawSlug : `custom_${rawSlug}`;

  const reg = content.scan({ cache: false });
  const existingPackIds = new Set(reg.packs.map(p => p.id));
  const existingDraftFiles = new Set(fs.readdirSync(draftsDir()).map(f => path.basename(f, '.json')));

  let targetId = baseSlug;
  let counter = 2;
  while (
    existingPackIds.has(targetId) ||
    existingDraftFiles.has(targetId) ||
    adventureSystem.reservedMapId(targetId) ||
    adventureSystem.reservedMapId(`${targetId}_ch1`) ||
    adventureSystem.reservedMapId(`${targetId}_ch2`)
  ) {
    targetId = `${baseSlug}-${counter++}`;
  }

  const targetName = name || (starterPack.name + ' (克隆)');
  const targetAuthor = author || 'Custom Author';

  // Each starter-pack-owned item becomes this clone's own namespaced item. Global catalogue
  // items (potions, weapons, armor) and semantic IDs (campfire, player) stay untouched.
  const starterItemIds = new Set((starterGear.gear || []).map(g => g.id));
  const itemIdMap = new Map((starterGear.gear || []).map(g => [g.id, `${targetId}_${g.id}`]));
  const mappedGear = (starterGear.gear || []).map(g => ({ ...g, id: itemIdMap.get(g.id) }));

  // One walker over every place the authored schema can store an item reference — the grant
  // field is choice.effect.giveItem (engine.completeScene adds it to the inventory).
  const eachItemRef = (mapDef, visit) => {
    (mapDef.scenes || []).forEach(s => (s.choices || []).forEach(c => {
      if (typeof c.condition?.itemId === 'string') visit(`scenes.${s.id}.choices.${c.id}.condition.itemId`, c.condition, 'itemId');
      if (typeof c.effect?.giveItem === 'string') visit(`scenes.${s.id}.choices.${c.id}.effect.giveItem`, c.effect, 'giveItem');
      if (typeof c.effect?.consumeItem === 'string') visit(`scenes.${s.id}.choices.${c.id}.effect.consumeItem`, c.effect, 'consumeItem');
    }));
    (mapDef.entities || []).forEach(e => ((e.loot && e.loot.items) || []).forEach((item, i) => {
      if (typeof item.id === 'string') visit(`entities.${e.id}.loot.items[${i}].id`, item, 'id');
    }));
  };

  // Remap CH1
  const m1 = JSON.parse(JSON.stringify(ch1));
  m1.id = `${targetId}_ch1`;
  if (m1.story) m1.story.id = `${targetId}_story_ch1`;

  // Remap entities and scenes
  const ch1EntityMap = {
    courier_bridge: `${targetId}_bridge`,
    courier_guard: `${targetId}_guard`
  };
  const ch1SceneMap = {
    crossing: `${targetId}_crossing`,
    testimony: `${targetId}_testimony`,
    reckoning: `${targetId}_reckoning`
  };

  (m1.entities || []).forEach(e => {
    if (ch1EntityMap[e.id]) e.id = ch1EntityMap[e.id];
  });

  (m1.scenes || []).forEach(s => {
    if (ch1SceneMap[s.id]) s.id = ch1SceneMap[s.id];
    if (ch1SceneMap[s.requiresScene]) s.requiresScene = ch1SceneMap[s.requiresScene];
    if (ch1EntityMap[s.doorId]) s.doorId = ch1EntityMap[s.doorId];
    if (Array.isArray(s.guardIds)) {
      s.guardIds = s.guardIds.map(g => ch1EntityMap[g] || g);
    }
  });

  if (m1.victory && ch1SceneMap[m1.victory.sceneId]) {
    m1.victory.sceneId = ch1SceneMap[m1.victory.sceneId];
  }

  // Remap CH2
  const m2 = JSON.parse(JSON.stringify(ch2));
  m2.id = `${targetId}_ch2`;
  if (m2.story) {
    m2.story.id = `${targetId}_story_ch2`;
    if (m2.story.requiresHistory) {
      m2.story.requiresHistory.storyId = `${targetId}_story_ch1`;
      m2.story.requiresHistory.fallback = 'no_history';
    }
  }

  if (m2.adventure?.waypoint?.roads) {
    m2.adventure.waypoint.roads.forEach(r => {
      if (r.to === 'courier-crossing') r.to = `${targetId}_ch1`;
    });
  }

  for (const mapDef of [m1, m2]) {
    eachItemRef(mapDef, (_path, holder, key) => {
      if (itemIdMap.has(holder[key])) holder[key] = itemIdMap.get(holder[key]);
    });
  }
  // A clone that quietly still points at starter content plays against the wrong resources:
  // the shipped pack resolves the reference, so bundle validation alone cannot see it.
  const staleItemRefs = [];
  for (const mapDef of [m1, m2]) {
    eachItemRef(mapDef, (refPath, holder, key) => {
      if (starterItemIds.has(holder[key])) staleItemRefs.push(`${refPath} = ${holder[key]}`);
    });
  }
  if (staleItemRefs.length) {
    throw new Error('Clone left references to starter-pack items: ' + staleItemRefs.join(', '));
  }

  const bundle = {
    format: 'ai-dnd-pack',
    version: 1,
    pack: {
      id: targetId,
      name: targetName,
      author: targetAuthor,
      blurb: starterPack.blurb,
      localized: {
        en: {
          name: (starterPack.localized?.en?.name || 'The Missing Courier') + ' (Clone)',
          blurb: starterPack.localized?.en?.blurb || ''
        },
        'zh-CN': {
          name: targetName,
          blurb: starterPack.localized?.['zh-CN']?.blurb || starterPack.blurb || ''
        }
      }
    },
    maps: [m1, m2],
    monsters: [],
    gear: mappedGear,
    updatedAt: Date.now()
  };

  const saveRes = saveDraft(targetId, bundle);
  return {
    ok: true,
    draftId: targetId,
    draft: saveRes.draft,
    validation: saveRes.validation
  };
}

function installBundle(bundle) {
  const validation = content.validateBundle(bundle);
  if (!validation.ok) {
    const err = /** @type {any} */ (new Error('Content validation failed.'));
    err.validation = validation;
    throw err;
  }
  const packId = bundle.pack.id;
  const root = path.resolve(store.DATA_DIR, 'content');
  const previous = content.scan({ cache: false }).packs.find(p => p.id === packId && p.installed);
  const dir = previous ? previous.dir : path.join(root, packId);
  const stagingRoot = path.join(store.DATA_DIR, '.content-imports');
  fs.mkdirSync(stagingRoot, { recursive: true });
  const transaction = fs.mkdtempSync(path.join(stagingRoot, 'import-'));
  const stage = path.join(transaction, 'pack');
  const backup = path.join(transaction, 'backup');
  let backedUp = false;
  let installed = false;
  let rollbackFailed = false;

  try {
    const relative = path.relative(root, path.resolve(dir));
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new Error('Pack directory is outside the installed content root.');
    }
    if (!previous && fs.existsSync(dir)) {
      throw new Error('Target folder already exists without a registered pack.');
    }
    fs.mkdirSync(path.join(stage, 'maps'), { recursive: true });
    fs.writeFileSync(path.join(stage, 'pack.json'), JSON.stringify(bundle.pack, null, 2));
    (bundle.maps || []).forEach(m => fs.writeFileSync(path.join(stage, 'maps', m.id + '.json'), JSON.stringify(m, null, 2)));
    fs.writeFileSync(path.join(stage, 'monsters.json'), JSON.stringify({ monsters: bundle.monsters || [] }, null, 2));
    fs.writeFileSync(path.join(stage, 'gear.json'), JSON.stringify({ gear: bundle.gear || [] }, null, 2));

    if (bundle.version === 2) {
      fs.mkdirSync(path.join(stage, 'assets'));
      fs.writeFileSync(path.join(stage, 'visuals.json'), JSON.stringify(bundle.visuals, null, 2));
      for (const [file, base64] of Object.entries(bundle.assets || {})) {
        fs.writeFileSync(path.join(stage, file), Buffer.from(/** @type {string} */ (base64), 'base64'));
      }
      const stagedDiagnostics = [];
      if (!visualContent.validateVisuals(bundle.visuals, file => visualContent.readDeclaredAsset(stage, file), { packId, name: bundle.pack.name, file: 'visuals.json' }, stagedDiagnostics)) {
        throw new Error('Staged visual assets failed validation.');
      }
    }

    fs.mkdirSync(root, { recursive: true });
    if (previous) { fs.renameSync(dir, backup); backedUp = true; }
    fs.renameSync(stage, dir); installed = true;
    const reg = content.reload();
    const loaded = reg.packs.find(p => p.id === packId);
    return {
      ok: true,
      pack: loaded ? { id: loaded.id, name: loaded.name, maps: loaded.maps, monsters: loaded.monsters, gear: loaded.gear } : null,
      warnings: reg.warnings,
      diagnostics: reg.diagnostics
    };
  } catch (e) {
    try {
      if (installed) fs.rmSync(dir, { recursive: true, force: true });
      if (backedUp) fs.renameSync(backup, dir);
    } catch (rollbackError) {
      rollbackFailed = true;
      throw new Error('Import failed: ' + e.message + '; rollback failed: ' + rollbackError.message);
    }
    content.reload();
    throw e;
  } finally {
    if (!rollbackFailed) fs.rmSync(transaction, { recursive: true, force: true });
  }
}

function installDraft(id) {
  const result = getDraft(id);
  if (!result || !result.draft) throw new Error('Draft not found: ' + id);
  if (!result.validation.ok) {
    const err = /** @type {any} */ (new Error('Cannot install draft with validation errors.'));
    err.validation = result.validation;
    throw err;
  }
  return installBundle(result.draft);
}

// Playtest content never enters the shared registry. A run resolves its own draft
// definitions through the snapshot stored on the save (server/game/content-context.js), so an
// ordinary new game sees exactly what the player installed — even mid-playtest.

function playtestHeroId(draftId) { return `playtest_${draftId}`; }

// A playtest identity exists only while its draft exists, and only for the hero this file
// minted for that draft. Routes use it to refuse a client-marked "playtest" ordinary hero.
function playtestHeroOwnsDraft(char) {
  if (!char || char.isPlaytest !== true) return false;
  const draftId = char.ownerDraftId;
  if (!checks.validId(draftId)) return false;
  if (char.id !== playtestHeroId(draftId)) return false;
  return fs.existsSync(draftFileFor(draftId));
}

function playtestDraftHeroExists(draftId) {
  return store.getCharacters().some(c => c.id === playtestHeroId(draftId) && c.isPlaytest === true && c.ownerDraftId === draftId);
}

/**
 * @param {string} id
 * @param {{ mapId?: string, difficulty?: string }} [options]
 */
function playtestDraft(id, options = {}) {
  const { mapId, difficulty } = options;
  const draftInfo = getDraft(id);
  if (!draftInfo || !draftInfo.draft) throw new Error('Draft not found: ' + id);
  if (!draftInfo.validation.ok) {
    const err = /** @type {any} */ (new Error('Cannot playtest draft with validation errors.'));
    err.validation = draftInfo.validation;
    throw err;
  }
  const draft = draftInfo.draft;
  const contentSnapshot = contentContext.snapshotFor(draft, id);
  const startMapId = mapId || draft.maps[0]?.id;
  if (!contentSnapshot.maps[startMapId]) {
    const err = /** @type {any} */ (new Error('Playtest map "' + String(startMapId) + '" is not part of draft "' + id + '".'));
    err.code = 'unknown-playtest-map';
    err.status = 400;
    throw err;
  }

  const chars = store.getCharacters();
  const playtestCharId = playtestHeroId(id);
  let playtestChar = chars.find(c => c.id === playtestCharId);
  if (playtestChar && (playtestChar.isPlaytest !== true || playtestChar.ownerDraftId !== id)) {
    const err = /** @type {any} */ (new Error('Character ID ' + playtestCharId + ' is not a playtest hero for this draft.'));
    err.code = 'playtest-hero-conflict';
    err.status = 409;
    throw err;
  }
  if (!playtestChar) {
    const presets = require('./presets');
    const base = presets.draftFor('guardian');
    playtestChar = engine.buildCharacter({
      ...base,
      name: `Playtester (${draft.pack.name || id})`
    });
    playtestChar.id = playtestCharId;
    playtestChar.isPlaytest = true;
    playtestChar.ownerDraftId = id;
    chars.push(playtestChar);
    store.saveCharacters(chars);
  }

  const mapDef = contentSnapshot.maps[startMapId];
  const state = engine.startGame(playtestChar, {
    difficulty: difficulty || 'normal', mapId: startMapId, content: contentSnapshot
  });
  state.isPlaytest = true;
  state.ownerDraftId = id;
  // The playtest hero earns its own history, so chapter 2 opens on the ending this hero
  // actually settled in chapter 1 under the same eligibility rule as any other start.
  state.historyBinding = mapDef.story?.requiresHistory ? resolveHistoryBinding(playtestChar, mapDef.story.requiresHistory) : null;
  store.saveGame(state);

  return {
    ok: true,
    saveId: state.id,
    characterId: playtestChar.id,
    mapId: startMapId
  };
}

// One settlement for a playtest run: the receipt and its story facts land on the playtest
// hero only. Gold, XP, items, level and campaign progress belong to the formal path.
function settlePlaytestDelve(delve) {
  const draftId = delve && delve.ownerDraftId;
  if (!checks.validId(draftId) || delve.isPlaytest !== true) {
    const err = /** @type {any} */ (new Error('Not a playtest delve.'));
    err.status = 400;
    throw err;
  }
  if (delve.mode !== 'victory' && delve.mode !== 'retreat' && delve.mode !== 'over') {
    const err = /** @type {any} */ (new Error('This playtest has not ended yet.'));
    err.code = 'delve-not-ended';
    err.status = 400;
    throw err;
  }
  const chars = store.getCharacters();
  const hero = chars.find(c => c.id === playtestHeroId(draftId) && c.isPlaytest === true && c.ownerDraftId === draftId);
  if (!hero) {
    const err = /** @type {any} */ (new Error('Playtest hero is missing for draft ' + draftId + '.'));
    err.code = 'playtest-hero-missing';
    err.status = 409;
    throw err;
  }
  if (delve.characterId !== hero.id) {
    const err = /** @type {any} */ (new Error('This playtest belongs to another hero.'));
    err.code = 'wrong-hero';
    err.status = 403;
    throw err;
  }

  const settleId = `${delve.id}#${delve.endSeq || 1}`;
  hero.settlements = Array.isArray(hero.settlements) ? hero.settlements : [];
  if (hero.settlements.some(r => r && r.id === settleId)) {
    const existing = hero.settlements.find(r => r && r.id === settleId);
    if (!delve.settled || delve.settled.id !== settleId) { delve.settled = existing; store.saveGame(delve); }
    return { receipt: existing, char: hero, duplicate: true };
  }

  const receipt = {
    id: settleId,
    ts: Date.now(),
    mode: delve.mode,
    story: delve.map?.story ? { id: delve.map.story.id, name: delve.map.story.name } : null,
    encounterFacts: (Array.isArray(delve.encounterFacts) ? delve.encounterFacts : []).filter(f => f?.saveId === delve.id),
    isPlaytest: true,
    ownerDraftId: draftId
  };
  mergeEncounterFacts(hero, receipt.encounterFacts);
  hero.settlements.push(receipt);
  store.saveCharacters(chars);
  delve.settled = receipt;
  store.saveGame(delve);
  return { receipt, char: hero, duplicate: false };
}

// Exiting a playtest is owned by the run it names: the save must say isPlaytest and carry
// this exact draft id. Nothing is ever matched by an id prefix.
function exitPlaytest(draftId, saveId) {
  if (!checks.validId(draftId)) {
    const err = /** @type {any} */ (new Error('Draft ID must match [a-z0-9_-]+.'));
    err.code = 'invalid-draft-id';
    err.status = 400;
    throw err;
  }
  const draftStillExists = fs.existsSync(draftFileFor(draftId));
  const save = store.getSave(saveId);
  if (!save) return { ok: true, saveId, alreadyExited: true };
  if (save.isPlaytest !== true || save.ownerDraftId !== draftId || save.characterId !== playtestHeroId(draftId)) {
    const err = /** @type {any} */ (new Error('This save is not a playtest run of draft ' + draftId + '.'));
    err.code = 'not-owned-playtest';
    err.status = 403;
    throw err;
  }
  const ended = save.mode === 'victory' || save.mode === 'retreat' || save.mode === 'over';
  let settledReceiptId = save.settled ? save.settled.id : null;
  if (ended && draftStillExists && playtestDraftHeroExists(draftId)) {
    settledReceiptId = settlePlaytestDelve(save).receipt.id;
  }
  store.deleteSave(saveId);
  return {
    ok: true,
    saveId,
    settled: settledReceiptId,
    abandoned: ended && !settledReceiptId ? true : false,
    draftExists: draftStillExists
  };
}

// Only touches resources whose own fields name a draft that is gone.
function sweepOrphanPlaytests() {
  const removed = { saves: /** @type {string[]} */ ([]), heroes: /** @type {string[]} */ ([]) };
  let draftIds = new Set();
  try {
    draftIds = new Set(fs.readdirSync(draftsDir()).filter(f => f.endsWith('.json')).map(f => path.basename(f, '.json')));
  } catch { /* no drafts directory: nothing is owned by a draft */ }
  for (const row of store.listSaves()) {
    const save = store.getSave(row.id);
    if (!save || save.isPlaytest !== true || !checks.validId(save.ownerDraftId)) continue;
    if (draftIds.has(save.ownerDraftId)) continue;
    if (save.characterId !== playtestHeroId(save.ownerDraftId)) continue;
    store.deleteSave(save.id);
    removed.saves.push(save.id);
  }
  const chars = store.getCharacters();
  const kept = chars.filter(c => {
    if (c.isPlaytest !== true || !checks.validId(c.ownerDraftId)) return true;
    if (draftIds.has(c.ownerDraftId) && c.id === playtestHeroId(c.ownerDraftId)) return true;
    removed.heroes.push(c.id);
    return false;
  });
  if (removed.heroes.length) store.saveCharacters(kept);
  return removed;
}

module.exports = {
  draftsDir,
  draftFileFor,
  listDrafts,
  getDraft,
  saveDraft,
  deleteDraft,
  cloneStarterTemplate,
  installBundle,
  installDraft,
  playtestDraft,
  playtestHeroId,
  playtestHeroOwnsDraft,
  settlePlaytestDelve,
  exitPlaytest,
  sweepOrphanPlaytests
};
