// api.js — thin fetch wrappers

/**
 * Options for POST /api/game/start. The server validates every field and falls back to
 * its own defaults ('normal' difficulty, 'crypt' map, unknown ally ids to Bram), so the
 * client never needs local tables for these values.
 * @typedef {object} StartGameOptions
 * @property {false | 'bram' | 'valeria' | 'aldous'} [bringAlly] companion to bring, or
 *   false for a solo expedition (the server also accepts the string 'none')
 * @property {'easy' | 'normal' | 'hard'} [difficulty] delve difficulty (default 'normal')
 * @property {string} [mapId] a content map id, 'endless_1' (Endless Depths) or 'weekly'
 *   (seeded weekly trial) (default 'crypt')
 */
async function req(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

export const api = {
  rules: () => req('GET', '/api/rules'),
  health: () => req('GET', '/api/health'),

  listCharacters: () => req('GET', '/api/characters'),
  createCharacter: (draft) => req('POST', '/api/characters', draft),
  getCharacter: (id) => req('GET', `/api/characters/${id}`),
  deleteCharacter: (id) => req('DELETE', `/api/characters/${id}`),
  characterPortrait: (id, force = false) => req('POST', `/api/characters/${id}/portrait`, { force }),
  equipCharacter: (id, slot, itemId) => req('POST', `/api/characters/${id}/equip`, { slot, itemId }),
  levelUpOptions: (id) => req('GET', `/api/characters/${id}/level-up-options`),
  levelUpCharacter: (id, choices) => req('POST', `/api/characters/${id}/level-up`, choices),
  triggerRoadEncounter: (id, opts = {}) => req('POST', `/api/characters/${id}/road-encounter`, { action: 'trigger', ...opts }),
  resolveRoadEncounter: (id, choice, encounterId) => req('POST', `/api/characters/${id}/road-encounter`, { choice, encounterId }),
  roadEncounterStatus: (id) => req('POST', `/api/characters/${id}/road-encounter`, { action: 'status' }),
  roadEncounter: (id, payload) => req('POST', `/api/characters/${id}/road-encounter`, typeof payload === 'string' ? { choice: payload } : payload),

  listSaves: () => req('GET', '/api/game'),
  /**
   * Start a fresh delve. Always pass ONE options object — the old four-positional form is
   * what let the prepare page send its options object as `bringAlly` and silently drop
   * difficulty/mapId (the server then always embarked crypt/normal/bram; see T1).
   * @param {string} characterId roster character id
   * @param {StartGameOptions} options
   * @returns {Promise<{ state: object, events: Array<object> }>}
   */
  startGame: (characterId, options) => req('POST', '/api/game/start', {
    characterId,
    bringAlly: options.bringAlly ?? false,
    difficulty: options.difficulty,
    mapId: options.mapId
  }),
  getGame: (id) => req('GET', `/api/game/${id}`),
  gameAction: (id, action) => req('POST', `/api/game/${id}/action`, action),
  gamePreview: (id, payload) => req('POST', `/api/game/${id}/preview`, payload),
  deleteGame: (id) => req('DELETE', `/api/game/${id}`),

  getSettings: () => req('GET', '/api/settings'),
  saveSettings: (s) => req('PUT', '/api/settings', s),
  testLlm: (llm) => req('POST', '/api/settings/test', { llm }),
  exportData: () => req('GET', '/api/data/export'),
  importData: (d) => req('POST', '/api/data/import', d),

  // City & Overworld
  cityInfo: (charId) => req('GET', '/api/city/info' + (charId ? `?charId=${charId}` : '')),
  cityRest: (charId, type) => req('POST', '/api/city/rest', { charId, type }),
  cityCompanion: (charId, companionId) => req('POST', '/api/city/companion', { charId, companionId }),
  cityBuy: (charId, itemId, qty) => req('POST', '/api/city/buy', { charId, itemId, qty }),
  citySell: (charId, itemId, qty) => req('POST', '/api/city/sell', { charId, itemId, qty }),
  cityClaimBounty: (charId, bountyId) => req('POST', '/api/city/claim-bounty', { charId, bountyId }),
  citySyncDelve: (data) => req('POST', '/api/city/sync-delve', data),
  cityRumor: (topic) => req('POST', '/api/city/rumor', { topic }),
  cityGamble: (payload) => req('POST', '/api/city/gamble', payload),
  cityIdentify: (charId, uniqueId) => req('POST', '/api/city/identify', { charId, uniqueId }),
  cityForge: (charId, action, uniqueId) => req('POST', '/api/city/forge', { charId, action, uniqueId }),
  campaign: (charId) => req('GET', '/api/city/campaign' + (charId ? `?charId=${charId}` : '')),
  hallOfHeroes: (charId) => req('GET', '/api/city/hall-of-heroes' + (charId ? `?charId=${charId}` : ''))
};
