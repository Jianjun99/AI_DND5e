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

  listSaves: () => req('GET', '/api/game'),
  startGame: (characterId, bringAlly) => req('POST', '/api/game/start', { characterId, bringAlly }),
  getGame: (id) => req('GET', `/api/game/${id}`),
  gameAction: (id, action) => req('POST', `/api/game/${id}/action`, action),
  deleteGame: (id) => req('DELETE', `/api/game/${id}`),

  getSettings: () => req('GET', '/api/settings'),
  saveSettings: (s) => req('PUT', '/api/settings', s),
  testLlm: (llm) => req('POST', '/api/settings/test', { llm })
};
