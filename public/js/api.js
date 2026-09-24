// api.js — thin fetch wrappers
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

  listSaves: () => req('GET', '/api/game'),
  startGame: (characterId, bringAlly, difficulty, mapId) => req('POST', '/api/game/start', { characterId, bringAlly, difficulty, mapId }),
  getGame: (id) => req('GET', `/api/game/${id}`),
  gameAction: (id, action) => req('POST', `/api/game/${id}/action`, action),
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
  hallOfHeroes: (charId) => req('GET', '/api/city/hall-of-heroes' + (charId ? `?charId=${charId}` : ''))
};
