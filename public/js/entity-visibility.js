// entity-visibility.js — which entities stand on the tactical board
// (pure helpers shared by the 2D and 2.5D renderers, kept dependency-free so tests can import them)

// The slain and the fled leave the board; the hero always stays visible, even face-down.
export function isEntityOnBoard(e) {
  if (!e) return false;
  if (e.kind === 'player') return true;
  if (e.alive === false) return false;
  if (e.fled) return false;
  return true;
}

// Cache-friendly view of the board: entity id → entity, for the entities that should be drawn.
export function boardEntities(game) {
  const list = (game && game.entities) || [];
  return list.filter(isEntityOnBoard);
}

// Walk the camera towards a target position with a frame-rate independent smoothing factor.
export function stepCameraTowards(current, target, delta, rate = 6.5) {
  const k = Math.min(1, Math.max(0, delta * rate));
  return { x: current.x + (target.x - current.x) * k, z: current.z + (target.z - current.z) * k };
}

// Camera centre may drift while panning, but never off the map.
export function clampToMap(x, z, map, margin = 1.5) {
  const w = (map && map.width) || 0;
  const h = (map && map.height) || 0;
  if (!w || !h) return { x, z };
  return {
    x: Math.min(w - 0.5 + margin, Math.max(0.5 - margin, x)),
    z: Math.min(h - 0.5 + margin, Math.max(0.5 - margin, z))
  };
}
