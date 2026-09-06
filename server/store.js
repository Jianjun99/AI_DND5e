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

// ---- characters ----
const CHAR_FILE = path.join(DATA_DIR, 'characters.json');
function getCharacters() { return readJson(CHAR_FILE, []); }
function saveCharacters(list) { writeJson(CHAR_FILE, list); }

// ---- game saves ----
function getSave(id) { return readJson(path.join(SAVES_DIR, id + '.json'), null); }
function saveGame(state) { writeJson(path.join(SAVES_DIR, state.id + '.json'), state); }
function deleteSave(id) { try { fs.unlinkSync(path.join(SAVES_DIR, id + '.json')); } catch {} }
function listSaves() {
  try {
    return fs.readdirSync(SAVES_DIR).filter(f => f.endsWith('.json')).map(f => {
      const s = readJson(path.join(SAVES_DIR, f), null);
      return s ? { id: s.id, characterId: s.characterId, characterName: s.character.name, mapName: s.mapName, updatedAt: s.updatedAt } : null;
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
    timeoutMs: 25000
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
  getCharacters, saveCharacters,
  getSave, saveGame, deleteSave, listSaves,
  getSettings, saveSettings,
  newId: (prefix) => prefix + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7)
};
