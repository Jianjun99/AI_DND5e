// Pure JSON checks. No engine imports, dice rolls, file writes or model calls.
const ID = /^[a-z0-9_-]+$/;
const ABILITIES = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
const ENTITY_TYPES = new Set(['monster', 'npc', 'object', 'door', 'chest', 'trap', 'stairs', 'barrel', 'spores', 'font', 'lever', 'hazard']);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const validId = value => typeof value === 'string' && ID.test(value);
const finite = value => typeof value === 'number' && Number.isFinite(value);

function diagnostic(diagnostics, source, field, message, code = 'invalid-field', severity = 'error', extra = {}) {
  diagnostics.push({ severity, code, ...source, field, message, ...extra });
}

function dice(value) {
  if (typeof value !== 'string') return false;
  const match = /^(\d+)d(\d+)([+-]\d+)?$/.exec(value.replace(/\s/g, ''));
  return !!match && Number.isSafeInteger(+match[1]) && +match[1] > 0 &&
    Number.isSafeInteger(+match[2]) && +match[2] > 0 && Number.isSafeInteger(+(match[3] || 0));
}

// Definitions keep every author field; only established missing defaults are filled.
function validateDefinition(kind, value, source, diagnostics) {
  const start = diagnostics.length;
  const error = (field, message, code = 'invalid-field') => diagnostic(diagnostics, source, field, message, code);
  if (!object(value)) { error(source.field, 'Expected a JSON object.'); return null; }
  const def = structuredClone(value);
  const root = source.field;
  const at = key => root ? root + '.' + key : key;
  if (!validId(def.id)) error(at('id'), 'ID must use lowercase letters, numbers, _ or -.', 'invalid-id');
  if (typeof def.name !== 'string' || !def.name.trim()) error(at('name'), 'A non-empty name is required.');
  const number = (value, field, min = -Infinity, integer = false) => {
    if (!finite(value) || value < min || (integer && !Number.isSafeInteger(value))) error(field, 'Expected a finite ' + (integer ? 'integer' : 'number') + ' >= ' + min + '.');
  };
  const roll = (value, field) => { if (!dice(value)) error(field, 'Expected dice such as 2d6+1 (positive dice count and sides).', 'invalid-dice'); };
  const optionalNumber = (record, key, field, min = -Infinity, integer = false) => {
    if (record[key] !== undefined) number(record[key], field, min, integer);
  };
  const loot = (value, field, monster = false) => {
    if (value === undefined) return;
    if (!object(value)) { error(field, 'Loot must be an object.'); return; }
    if (value.gold !== undefined) {
      if (!monster && finite(value.gold)) number(value.gold, field + '.gold', 0, true);
      else roll(value.gold, field + '.gold');
    }
    optionalNumber(value, 'potions', field + '.potions', 0, true);
    if (value.items !== undefined && !Array.isArray(value.items)) error(field + '.items', 'Loot items must be an array.');
    if (Array.isArray(value.items)) value.items.forEach((item, i) => {
      const f = field + '.items[' + i + ']';
      if (!object(item)) { error(f, 'Loot item must be an object.'); return; }
      if (!validId(item.id)) error(f + '.id', 'Loot item needs a valid item ID.');
      optionalNumber(item, 'qty', f + '.qty', 1, true);
      optionalNumber(item, 'chance', f + '.chance', 0);
      if (finite(item.chance) && item.chance > 1) error(f + '.chance', 'Chance must be between 0 and 1.');
    });
  };

  if (kind === 'maps') {
    if (!Array.isArray(def.rows) || !def.rows.length || def.rows.some(row => typeof row !== 'string' || !row.length)) {
      error(at('rows'), 'Rows must be a non-empty array of non-empty strings.');
      return null;
    }
    if (def.width === undefined) def.width = def.rows[0].length;
    if (def.height === undefined) def.height = def.rows.length;
    number(def.width, at('width'), 1, true); number(def.height, at('height'), 1, true);
    if (def.height !== def.rows.length) error(at('height'), 'Height must equal the number of rows.', 'map-size');
    def.rows.forEach((row, i) => {
      if (row.length !== def.width) error(at('rows[' + i + ']'), 'Row length must equal width ' + def.width + '.', 'map-size');
    });
    const position = (pos, field) => {
      if (!object(pos)) { error(field, 'Expected {x,y}.'); return; }
      number(pos.x, field + '.x', 0, true); number(pos.y, field + '.y', 0, true);
      if (!Number.isSafeInteger(pos.x) || !Number.isSafeInteger(pos.y)) return;
      if (pos.x >= def.width || pos.y >= def.height) error(field, 'Coordinate is outside the map.', 'coordinate-bounds');
      else if (def.rows[pos.y]?.[pos.x] === '#') error(field, 'Coordinate lies on a wall.', 'wall-position');
    };
    position(def.playerStart, at('playerStart'));
    if (def.victory === undefined && def.victoryTile !== undefined) def.victory = { type: 'fetch_relic', campfire: structuredClone(def.victoryTile) };
    if (!object(def.victory)) error(at('victory'), 'Victory needs a type and campfire. Legacy victoryTile is supported.');
    else {
      if (def.victory.type === undefined) def.victory.type = 'fetch_relic';
      if (!['fetch_relic', 'slay_boss'].includes(def.victory.type)) error(at('victory.type'), 'Supported victory types: fetch_relic, slay_boss.', 'victory-target');
      position(def.victory.campfire, at('victory.campfire'));
    }
    if (def.entities === undefined) def.entities = [];
    if (!Array.isArray(def.entities)) error(at('entities'), 'Entities must be an array.');
    else {
      const ids = new Set(); const hydratedIds = new Set(['player', 'ally']);
      def.entities.forEach((entity, i) => {
        const f = at('entities[' + i + ']');
        if (!object(entity)) { error(f, 'Entity must be an object.'); return; }
        if (!validId(entity.id)) error(f + '.id', 'Entity needs a valid ID.');
        if (ids.has(entity.id)) error(f + '.id', 'Entity ID is repeated on this map.', 'duplicate-entity');
        ids.add(entity.id);
        const runtimeId = entity.type === 'npc' ? 'npc_' + entity.id : entity.id;
        if (hydratedIds.has(runtimeId)) error(f + '.id', 'Entity ID conflicts with a runtime entity.', 'duplicate-entity');
        hydratedIds.add(runtimeId);
        if (!ENTITY_TYPES.has(entity.type)) error(f + '.type', 'Unsupported entity type.');
        position(entity, f);
        if (entity.type === 'monster' && !validId(entity.kind)) error(f + '.kind', 'Monster needs a valid kind.');
        if (entity.boss !== undefined && typeof entity.boss !== 'boolean') error(f + '.boss', 'Boss must be a boolean.');
        if (entity.type === 'chest' && entity.loot === undefined) entity.loot = {};
        loot(entity.loot, f + '.loot');
        for (const key of ['dc', 'lockDc', 'forceDc', 'pickDc', 'disarmDc']) optionalNumber(entity, key, f + '.' + key, 0);
        if (entity.damage !== undefined) roll(entity.damage, f + '.damage');
        if (entity.save !== undefined && !ABILITIES.includes(entity.save)) error(f + '.save', 'Save must name an ability.');
        if (entity.type === 'stairs' && (!object(entity.to) || !validId(entity.to.mapId))) error(f + '.to', 'Stairs need to.mapId and destination x,y.', 'missing-reference');
        if (entity.targetTrapIds !== undefined && (!Array.isArray(entity.targetTrapIds) || entity.targetTrapIds.some(id => !validId(id)))) error(f + '.targetTrapIds', 'Trap targets must be an array of IDs.');
      });
      const camp = def.entities.find(e => e && e.id === 'campfire' && e.type === 'object');
      if (!camp || (object(def.victory?.campfire) && (camp.x !== def.victory.campfire.x || camp.y !== def.victory.campfire.y))) error(at('victory.campfire'), 'A campfire object must exist at the victory campfire coordinates.', 'victory-target');
      if (def.victory?.type === 'fetch_relic' && !def.entities.some(e => e && e.id === 'relic' && e.type === 'object')) error(at('victory.type'), 'fetch_relic needs an object with id relic.', 'victory-target');
    }
    if (def.npcs === undefined) def.npcs = {};
    if (!object(def.npcs)) error(at('npcs'), 'NPC definitions must be an object keyed by ID.');
    else Object.entries(def.npcs).forEach(([id, npc]) => {
      if (!object(npc)) error(at('npcs.' + id), 'NPC definition must be an object.');
      else if (npc.canned !== undefined && (!Array.isArray(npc.canned) || npc.canned.some(line => typeof line !== 'string'))) error(at('npcs.' + id + '.canned'), 'Canned dialogue must be an array of strings.');
    });
    if (def.rooms !== undefined && !Array.isArray(def.rooms)) error(at('rooms'), 'Rooms must be an array.');
    if (Array.isArray(def.rooms)) def.rooms.forEach((room, i) => {
      const f = at('rooms[' + i + ']');
      if (!object(room) || !Array.isArray(room.rect) || room.rect.length !== 4 || room.rect.some(n => !Number.isSafeInteger(n) || n < 0)) error(f + '.rect', 'Room rect must contain four finite non-negative integers.');
      else if (room.rect[0] > room.rect[2] || room.rect[1] > room.rect[3] || room.rect[2] >= def.width || room.rect[3] >= def.height) error(f + '.rect', 'Room rect must be ordered and inside the map.');
    });
    optionalNumber(def, 'tileSizeFt', at('tileSizeFt'), 1);
    if (def.wandering !== undefined && (!Array.isArray(def.wandering) || def.wandering.some(id => !validId(id)))) error(at('wandering'), 'Wandering monsters must be an array of monster IDs.');
    optionalNumber(def, 'eliteChance', at('eliteChance'), 0);
    if (finite(def.eliteChance) && def.eliteChance > 1) error(at('eliteChance'), 'Elite chance must be between 0 and 1.');
    if (def.scenes !== undefined && !Array.isArray(def.scenes)) error(at('scenes'), 'Scenes must be an array.');
    const sceneIds = new Set(), sceneNpcs = new Set(), sceneDoors = new Set(), sceneGuards = new Set();
    (Array.isArray(def.scenes) ? def.scenes : []).forEach((scene, i) => {
      const f = at('scenes[' + i + ']');
      if (!object(scene)) { error(f, 'Scene must be an object.'); return; }
      for (const key of ['id', 'npcId', 'doorId']) if (!validId(scene[key])) error(f + '.' + key, 'Expected an ID.');
      for (const key of ['name', 'prompt']) if (typeof scene[key] !== 'string' || !scene[key].trim()) error(f + '.' + key, 'Expected non-empty text.');
      for (const key of ['id', 'npcId', 'doorId']) {
        const ids = { id: sceneIds, npcId: sceneNpcs, doorId: sceneDoors }[key];
        if (ids.has(scene[key])) error(f + '.' + key, 'Scene IDs, NPCs and doors cannot be shared between scenes.');
        ids.add(scene[key]);
      }
      if (!Array.isArray(scene.guardIds) || !scene.guardIds.length || scene.guardIds.some(id => !validId(id))) error(f + '.guardIds', 'Scene needs at least one guard entity ID.');
      else scene.guardIds.forEach((id, j) => {
        if (sceneGuards.has(id)) error(f + '.guardIds[' + j + ']', 'A guard cannot be repeated or shared between scenes.');
        sceneGuards.add(id);
      });
      if (!Array.isArray(scene.choices) || scene.choices.length < 2) { error(f + '.choices', 'Scene needs at least two choices.'); return; }
      const choiceIds = new Set();
      scene.choices.forEach((choice, j) => {
        const c = f + '.choices[' + j + ']';
        if (!object(choice)) { error(c, 'Choice must be an object.'); return; }
        if (!validId(choice.id) || choiceIds.has(choice.id)) error(c + '.id', 'Choice ID must be valid and unique in this scene.');
        choiceIds.add(choice.id);
        if (!validId(choice.fact)) error(c + '.fact', 'Choice needs a structured fact ID.');
        for (const key of ['label', 'response', 'memory']) if (typeof choice[key] !== 'string' || !choice[key].trim()) error(c + '.' + key, 'Expected non-empty text.');
        choice.condition ??= { type: 'always' };
        const condition = choice.condition, effect = choice.effect;
        if (!object(condition) || !['always', 'has_item'].includes(condition.type)) error(c + '.condition', 'Supported conditions: always, has_item.');
        else {
          if (condition.type === 'has_item' && !validId(condition.itemId)) error(c + '.condition.itemId', 'has_item needs an item ID.');
          Object.keys(condition).filter(key => !['type', 'itemId'].includes(key)).forEach(key => error(c + '.condition.' + key, 'Unsupported condition field.'));
        }
        if (!object(effect) || !['passage', 'combat'].includes(effect.type)) error(c + '.effect', 'Supported effects: passage, combat. No scripts or arbitrary state writes.');
        else {
          Object.keys(effect).filter(key => !['type', 'consumeItem'].includes(key)).forEach(key => error(c + '.effect.' + key, 'Unsupported effect field.'));
          if (effect.consumeItem !== undefined && (effect.type !== 'passage' || !validId(effect.consumeItem) || condition?.type !== 'has_item' || condition.itemId !== effect.consumeItem)) error(c + '.effect.consumeItem', 'Consumption must match a passage choice has_item condition.');
        }
      });
      if (!scene.choices.some(c => c?.condition?.type === 'always' && c?.effect?.type === 'combat')) error(f + '.choices', 'A combat choice without an item requirement is needed as a continuing path.');
      if (!scene.choices.some(c => c?.effect?.type === 'passage')) error(f + '.choices', 'A passage choice is needed as the second route.');
    });
  } else if (kind === 'monsters') {
    number(def.ac, at('ac'), 1); number(def.xp, at('xp'), 0, true); roll(def.hp, at('hp'));
    if (!object(def.abilities)) error(at('abilities'), 'All six ability scores are required.');
    else ABILITIES.forEach(key => number(def.abilities[key], at('abilities.' + key), 1, true));
    optionalNumber(def, 'speed', at('speed'), 0); optionalNumber(def, 'darkvision', at('darkvision'), 0);
    if (!Array.isArray(def.attacks) || !def.attacks.length) error(at('attacks'), 'At least one attack is required.');
    else def.attacks.forEach((attack, i) => {
      const f = at('attacks[' + i + ']');
      if (!object(attack)) { error(f, 'Attack must be an object.'); return; }
      number(attack.bonus, f + '.bonus'); roll(attack.damage, f + '.damage');
      optionalNumber(attack, 'range', f + '.range', 0);
    });
    loot(def.loot, at('loot'), true);
    if (def.boss !== undefined && typeof def.boss !== 'boolean') error(at('boss'), 'Boss must be a boolean.');
  } else if (kind === 'gear') {
    for (const key of ['cost', 'magic', 'acBonus', 'hpBonus', 'speedBonus', 'attackBonus']) optionalNumber(def, key, at(key), key === 'cost' ? 0 : -Infinity);
    if (def.heal !== undefined) roll(def.heal, at('heal'));
    if (def.bonusDamage !== undefined) {
      if (!object(def.bonusDamage)) error(at('bonusDamage'), 'Bonus damage must be an object.');
      else roll(def.bonusDamage.dice, at('bonusDamage.dice'));
    }
    if (def.vampiricHeal !== undefined) roll(def.vampiricHeal, at('vampiricHeal'));
  }
  return diagnostics.slice(start).some(d => d.severity === 'error') ? null : def;
}

// Run after ALL definitions are registered. Re-run after removals so a map never
// references a monster/item/map that failed its own validation.
function validateReferences(kind, def, source, reg, tables, diagnostics) {
  const start = diagnostics.length;
  const at = key => source.field ? source.field + '.' + key : key;
  const error = (field, message) => diagnostic(diagnostics, source, field, message, 'missing-reference');
  const itemExists = id => !!reg.gear[id] || tables.itemIds.has(id);
  const loot = (value, field) => (value?.items || []).forEach((item, i) => {
    if (!itemExists(item.id)) error(field + '.items[' + i + '].id', 'Unknown item: ' + item.id + '.');
  });
  if (kind === 'gear') {
    if (def.type === 'magic_weapon' && !tables.weaponIds.has(def.base)) error(at('base'), 'Unknown base weapon: ' + def.base + '.');
    if (def.type === 'magic_armor' && def.base !== undefined && !tables.armorIds.has(def.base)) error(at('base'), 'Unknown base armor: ' + def.base + '.');
    if (def.spell !== undefined && !tables.spellIds.has(def.spell)) error(at('spell'), 'Unknown spell: ' + def.spell + '.');
  } else if (kind === 'monsters') loot(def.loot, at('loot'));
  else if (kind === 'maps') {
    (def.scenes || []).forEach((scene, i) => {
      const f = at('scenes[' + i + ']');
      if (!def.entities.some(e => e.type === 'npc' && e.id === scene.npcId)) error(f + '.npcId', 'Scene NPC must exist on this map.');
      if (!def.entities.some(e => e.type === 'door' && e.id === scene.doorId)) error(f + '.doorId', 'Scene door must exist on this map.');
      scene.guardIds.forEach((id, j) => { if (!def.entities.some(e => e.type === 'monster' && e.id === id)) error(f + '.guardIds[' + j + ']', 'Scene guard must be a monster entity on this map.'); });
      scene.choices.forEach((choice, j) => {
        if (choice.condition.type === 'has_item' && !itemExists(choice.condition.itemId)) error(f + '.choices[' + j + '].condition.itemId', 'Unknown condition item: ' + choice.condition.itemId + '.');
      });
    });
    (def.wandering || []).forEach((id, i) => { if (!reg.monsters[id]) error(at('wandering[' + i + ']'), 'Unknown wandering monster: ' + id + '.'); });
    def.entities.forEach((entity, i) => {
      const f = at('entities[' + i + ']');
      if (entity.type === 'monster' && !reg.monsters[entity.kind]) error(f + '.kind', 'Unknown monster: ' + entity.kind + '.');
      if (entity.type === 'npc' && !Object.hasOwn(def.npcs, entity.id)) error(f + '.id', 'Missing map NPC definition: ' + entity.id + '.');
      loot(entity.loot, f + '.loot');
      if (entity.type === 'stairs') {
        const to = entity.to; const target = reg.maps[to.mapId];
        if (!target) error(f + '.to.mapId', 'Unknown or invalid destination map: ' + to.mapId + '.');
        else if (!Number.isSafeInteger(to.x) || !Number.isSafeInteger(to.y) || to.x < 0 || to.y < 0 || to.x >= target.width || to.y >= target.height) error(f + '.to', 'Destination coordinate is outside map ' + to.mapId + '.');
        else if (target.rows[to.y][to.x] === '#') error(f + '.to', 'Destination lies on a wall in map ' + to.mapId + '.');
      }
      (entity.targetTrapIds || []).forEach((id, j) => {
        if (!def.entities.some(e => e.id === id && e.type === 'trap')) error(f + '.targetTrapIds[' + j + ']', 'Unknown trap on this map: ' + id + '.');
      });
    });
    if (def.victory.type === 'slay_boss' && !def.entities.some(e => e.type === 'monster' && (e.boss === undefined ? reg.monsters[e.kind]?.boss : e.boss))) error(at('victory.type'), 'slay_boss needs a monster with boss: true on its entity or registered definition.');
  }
  return diagnostics.length === start;
}

function checkReachability(map, source, diagnostics) {
  // Optimistic geometry: doors can be opened/forced, barrels destroyed, monsters
  // defeated. This is a warning, not a claim that a locked door makes play impossible.
  const seen = new Set(); const queue = [map.playerStart];
  for (let i = 0; i < queue.length; i++) {
    const pos = queue[i]; const key = pos.x + ',' + pos.y;
    if (seen.has(key)) continue;
    seen.add(key);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const x = pos.x + dx, y = pos.y + dy;
      if (x >= 0 && y >= 0 && x < map.width && y < map.height && map.rows[y][x] !== '#' && !seen.has(x + ',' + y)) queue.push({ x, y });
    }
  }
  const at = key => source.field ? source.field + '.' + key : key;
  const warn = (field, message) => diagnostic(diagnostics, source, at(field), message, 'unreachable', 'warning');
  const camp = map.victory.campfire;
  if (!seen.has(camp.x + ',' + camp.y)) warn('victory.campfire', 'Campfire is disconnected even assuming doors open and destructible blockers removed.');
  map.entities.forEach((entity, i) => {
    if (!['relic', 'campfire'].includes(entity.id) && entity.type !== 'stairs' && !(entity.type === 'monster')) return;
    if (!seen.has(entity.x + ',' + entity.y) && ![[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => seen.has((entity.x + dx) + ',' + (entity.y + dy)))) warn('entities[' + i + ']', 'Target has no reachable interaction tile under optimistic terrain assumptions.');
  });
}

module.exports = { validId, object, diagnostic, validateDefinition, validateReferences, checkReachability };
