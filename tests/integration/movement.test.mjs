// tests/integration/movement.test.mjs — Movement, Pathfinding & Fog-of-War Integration Tests
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const engine = require('../../server/game/engine.js');

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (!condition) {
    console.error(`  ❌ FAILED: ${message}`);
    failed++;
    throw new Error(message);
  }
  passed++;
}

function test(name, fn) {
  try {
    fn();
    console.log(`  ✔ PASS: ${name}`);
  } catch (err) {
    failed++;
    console.error(`  ❌ ERROR in ${name}:`, err.message);
  }
}

console.log('\n--- Running Integration Tests: Movement, Pathfinding & Vision ---');

function createTestState() {
  const char = engine.buildCharacter({
    name: 'Pathfinder Bron',
    species: 'human',
    className: 'fighter',
    background: 'soldier',
    baseScores: { str: 15, dex: 14, con: 14, int: 10, wis: 12, cha: 8 },
    bgPlus2: 'str', bgPlus1: 'con',
    skills: ['athletics', 'perception'],
    fightingStyle: 'defense',
    armorOption: 'chain_mail',
    weaponOption: 'sword_board'
  });
  return engine.startGame(char, { difficulty: 'normal' });
}

// 1. Initial State & Starting Position
test('Player spawns at campfire starting tile with standard speed budget', () => {
  const state = createTestState();
  const p = engine.playerEntity(state);
  assert(p != null, 'Player entity must exist');
  assert(p.x === 4 && p.y === 4, `Expected start at (4,4), got (${p.x},${p.y})`);
  assert(state.character.speedFt === 30, `Expected speed 30 ft, got ${state.character.speedFt}`);
  assert(state.discovered.includes('4,4'), 'Start tile must be discovered');
});

// 2. Out-of-Combat Multi-Tile Movement
test('Player can move along open corridor path to reachable tile', () => {
  const state = createTestState();
  const p = engine.playerEntity(state);
  const events = [];

  // Move from (4,4) to (6,4) along corridor
  engine.movePlayer(state, 6, 4, events);

  assert(p.x === 6 && p.y === 4, `Expected player at (6,4), got (${p.x},${p.y})`);
  assert(state.discovered.includes('6,4'), 'Destination tile must be discovered');
  assert(!events.some(e => e.type === 'error'), 'Valid movement must not emit error');
});

// 3. Wall Collision & Impassable Boundaries
test('Moving into dungeon wall is blocked and maintains player position', () => {
  const state = createTestState();
  const p = engine.playerEntity(state);
  const startX = p.x;
  const startY = p.y;
  const events = [];

  // Wall at (4, 0) in crypt map
  const wallY = 0;
  assert(state.map.rows[wallY][startX] === '#', 'Tile (4,0) should be a wall');

  engine.movePlayer(state, startX, wallY, events);

  assert(p.x === startX && p.y === startY, `Player position must not change into wall (stay at ${startX},${startY})`);
  assert(events.some(e => e.type === 'error'), 'Attempting to move through wall must return error event');
});

// 4. Closed Door Obstacle & Interaction
test('Closed door blocks pathfinding until opened', () => {
  const state = createTestState();
  const p = engine.playerEntity(state);
  const door = state.objects.find(o => o.type === 'door');
  assert(door != null, 'Door object must exist on map');
  assert(door.open === false, 'Door must initially be closed');

  // Position player directly adjacent to door
  p.x = door.x - 1;
  p.y = door.y;

  // Open the door
  const events = [];
  engine.interactDoor(state, door, events);
  assert(door.open === true, 'Door should be opened after interactDoor');

  // Now movement through the doorway succeeds
  const beyondDoorX = door.x + 2;
  const beyondDoorY = door.y;
  engine.movePlayer(state, beyondDoorX, beyondDoorY, events);
  assert(p.x === beyondDoorX && p.y === beyondDoorY, `Player should traverse open doorway to (${beyondDoorX},${beyondDoorY})`);
});

// 5. Fog-of-War Vision Revelation
test('Moving into unexplored room reveals new tiles in discovered set', () => {
  const state = createTestState();
  const p = engine.playerEntity(state);
  const door = state.objects.find(o => o.type === 'door' && o.x === 9);
  const events = [];

  p.x = 8;
  p.y = 4;
  engine.interactDoor(state, door, events);

  const initialDiscoveredCount = state.discovered.length;

  // Move past door into unexplored eastern chamber
  engine.movePlayer(state, 12, 4, events);

  assert(state.discovered.length > initialDiscoveredCount, 'Discovered tiles count must increase when entering new area');
  assert(state.discovered.includes('12,4'), 'New position (12,4) must be in discovered list');
  const visible = engine.computeVision(state);
  assert(visible.includes('12,4'), 'Current tile must be in visible list');
});

// 6. Combat Mode Movement Budget
test('In combat mode, movement deducts stepCost per tile and respects budget limit', () => {
  const state = createTestState();
  const p = engine.playerEntity(state);

  // Manually enter combat mode
  state.mode = 'combat';
  state.combat = {
    round: 1,
    turnIndex: 0,
    turnOrder: [p.id],
    movementLeft: 30,
    actionUsed: false,
    bonusUsed: false
  };

  const events = [];

  // Move 2 tiles east from (4,4) to (6,4)
  engine.movePlayer(state, 6, 4, events);

  assert(p.x === 6 && p.y === 4, `Player should reach (6,4) in combat, got (${p.x},${p.y})`);
  assert(state.combat.movementLeft === 28, `Expected 28 movement remaining (30 - 2), got ${state.combat.movementLeft}`);

  // Now set budget to 1 step and try to move 2 tiles to (8,4)
  state.combat.movementLeft = 1;
  engine.movePlayer(state, 8, 4, events);

  // Should only take 1 step to (7,4) and exhaust budget
  assert(p.x === 7 && p.y === 4, `Movement should stop when budget runs out (at 7,4), got (${p.x},${p.y})`);
  assert(state.combat.movementLeft === 0, `Movement budget should be 0, got ${state.combat.movementLeft}`);
});

console.log(`\nMovement Integration Tests Summary: ${passed} passed, ${failed} failed.`);
if (failed > 0) process.exit(1);
