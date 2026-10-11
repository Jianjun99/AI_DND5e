// server/game/content-context.js
// A playtest run carries its own content snapshot: draft maps, gear and monsters that were
// never installed. The shared registry (server/game/content.js) stays exactly what the
// player installed, so a draft can no longer leak into an ordinary new game — not even
// between two concurrent requests. Normal saves have no snapshot and resolve as before.

const content = require('./content');

/** @param {any} draft */
function snapshotFor(draft, draftId) {
  const snapshot = {
    draftId: draftId || draft?.pack?.id || null,
    packId: draft?.pack?.id || null,
    maps: Object.create(null),
    monsters: Object.create(null),
    gear: Object.create(null)
  };
  for (const map of draft?.maps || []) snapshot.maps[map.id] = map;
  for (const monster of draft?.monsters || []) snapshot.monsters[monster.id] = monster;
  for (const gear of draft?.gear || []) snapshot.gear[gear.id] = gear;
  return snapshot;
}

function map(snapshot, id) {
  if (id != null && snapshot?.maps?.[id]) return snapshot.maps[id];
  return content.getMap(id);
}

function monster(snapshot, kind) {
  if (kind != null && snapshot?.monsters?.[kind]) return snapshot.monsters[kind];
  return content.getMonster(kind);
}

function gear(snapshot, id) {
  if (id != null && snapshot?.gear?.[id]) return snapshot.gear[id];
  return content.getGear(id);
}

// The snapshot travels with the save, so a refresh or a server restart resolves the same
// definitions without any process-global state.
const ofState = state => state && state.contentSnapshot ? state.contentSnapshot : null;

module.exports = {
  snapshotFor,
  map: (state, id) => map(ofState(state), id),
  monster: (state, kind) => monster(ofState(state), kind),
  gear: (state, id) => gear(ofState(state), id),
  mapFor: map,
  monsterFor: monster,
  gearFor: gear,
  ofState
};
