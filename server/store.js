// Simple JSON-file persistence. Everything lives under DATA_DIR (default ./data)
// so the whole game state can be persisted to a Docker volume.
const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const SAVES_DIR = path.join(DATA_DIR, 'saves');

function ensureDirs() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(SAVES_DIR, { recursive: true });
}
ensureDirs();

function readJson(file, fallback) {
  try {
    const raw = fs.readFileSync(file, 'utf8');
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function writeJson(file, value) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}

// ---- save schema versioning ----
// Writes stamp saveVersion; reads run the migration chain so older saves come
// out in the current shape. Migrations only ADD fields — never drop or rewrite
// player data, and a failed migration leaves the object usable rather than
// unreadable. Version 2 = the first versioned shape (2026-09, v1.9.3); version
// 1 means "pre-versioning legacy save".
const SAVE_VERSION = 2;
const MIGRATIONS = {
  // 1 -> 2: nothing to transform yet — stamping the version is the migration.
  // Future shape changes add their step here and bump SAVE_VERSION.
  1: (obj) => obj
};

function migrateSave(obj, kind) {
  if (!obj || typeof obj !== 'object') return obj;
  let version = obj.saveVersion || 1;
  if (version > SAVE_VERSION) return obj; // written by a newer build — leave untouched
  while (version < SAVE_VERSION) {
    const step = MIGRATIONS[version];
    if (!step) { console.error(`store: no migration from saveVersion ${version} (${kind})`); break; }
    try { step(obj); } catch (e) { console.error(`store: migration ${version} failed (${kind}): ${e.message}`); break; }
    version++;
  }
  obj.saveVersion = SAVE_VERSION;
  // T3a: legacy end-mode delves predate the endSeq settle counter — settling reads them
  // as `<id>#1` but nothing based the counter, so the next end after a respawn stamped 1
  // again and was wrongly deduped against the old receipt. Baseline the counter on every
  // read (migrations only add fields): the next real end increments from here, and
  // re-deriving it per read means even a failed mirror write cannot lose the baseline.
  if (kind === 'delve' && obj.endSeq === undefined &&
      (obj.mode === 'victory' || obj.mode === 'retreat' || obj.mode === 'over')) {
    obj.endSeq = 1;
  }
  return obj;
}

// ---- characters ----
const CHAR_FILE = path.join(DATA_DIR, 'characters.json');
function getCharacters() {
  const list = readJson(CHAR_FILE, []);
  return Array.isArray(list) ? list.map((c) => migrateSave(c, 'character')) : [];
}
function saveCharacters(list) {
  (list || []).forEach((c) => { c.saveVersion = SAVE_VERSION; });
  writeJson(CHAR_FILE, list);
}

// ---- game saves ----
function getSave(id) { return migrateSave(readJson(path.join(SAVES_DIR, id + '.json'), null), 'delve'); }
function saveGame(state) {
  // Every persisted change bumps rev — the client uses it to reject stale auxiliary
  // responses (a slow describe/portrait/narration must never roll the board back, T2).
  // Old saves have no rev and read as 0; the first write stamps 1.
  state.rev = (Number(state.rev) || 0) + 1;
  state.saveVersion = SAVE_VERSION;
  writeJson(path.join(SAVES_DIR, state.id + '.json'), state);
}
function deleteSave(id) { try { fs.unlinkSync(path.join(SAVES_DIR, id + '.json')); } catch {} }

// ---- per-save write lock ----
// The contract (T2): every mutation of a save is a synchronous read-modify-write of the
// LATEST file (getSave → mutate → saveGame, no awaits in between) and model/LLM waits
// NEVER happen while holding a stale snapshot. withSaveLock makes that ordering explicit
// and serializes the phases of concurrent requests on one save. It must never be held
// across a long model request — split the work instead (mechanical phase → await model →
// merge phase) so a slow describe can't freeze movement or roll the save back.
const saveLocks = new Map();
function withSaveLock(id, fn) {
  const tail = saveLocks.get(id) || Promise.resolve();
  const run = tail.then(() => fn());
  const next = run.catch(() => {}); // keep the chain alive regardless of this job's outcome
  saveLocks.set(id, next);
  next.then(() => { if (saveLocks.get(id) === next) saveLocks.delete(id); }).catch(() => {});
  return run;
}
function listSaves() {
  try {
    return fs.readdirSync(SAVES_DIR).filter(f => f.endsWith('.json')).map(f => {
      const s = readJson(path.join(SAVES_DIR, f), null);
      if (!s) return null;
      // mode/endSeq/settled ride along for the guidance layer (T4) — additive, readers that
      // only want the summary fields keep working.
      return {
        id: s.id, characterId: s.characterId, characterName: s.character.name, mapName: s.mapName,
        mapId: s.mapId || null, mode: s.mode || null, endSeq: s.endSeq,
        settled: (s.settled && s.settled.id) || null,
        updatedAt: s.updatedAt
      };
    }).filter(Boolean);
  } catch { return []; }
}

// ---- settings (LLM config etc.) ----
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
const DEFAULT_SETTINGS = {
  llm: {
    enabled: false,
    preset: 'ollama',
    baseUrl: 'http://host.docker.internal:11434/v1',
    model: 'llama3.1:8b',
    apiKey: '',
    temperature: 0.8,
    maxTokens: 500,
    timeoutMs: 25000,
    persona: 'classic'
  },
  portraits: {
    enabled: true,
    sdUrl: ''
  }
};
function getSettings() {
  const stored = readJson(SETTINGS_FILE, {});
  const settings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
  if (stored.llm) settings.llm = Object.assign(settings.llm, stored.llm);
  if (stored.portraits) settings.portraits = Object.assign(settings.portraits, stored.portraits);
  return settings;
}
function saveSettings(next) {
  const merged = getSettings();
  if (next.llm) merged.llm = Object.assign(merged.llm, next.llm);
  if (next.portraits) merged.portraits = Object.assign(merged.portraits, next.portraits);
  writeJson(SETTINGS_FILE, merged);
  return merged;
}

module.exports = {
  DATA_DIR,
  SAVE_VERSION, migrateSave,
  getCharacters, saveCharacters,
  getSave, saveGame, deleteSave, listSaves, withSaveLock,
  getSettings, saveSettings,
  newId: (prefix) => prefix + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7)
};
