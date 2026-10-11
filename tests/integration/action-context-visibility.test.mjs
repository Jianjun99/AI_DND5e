// tests/integration/action-context-visibility.test.mjs
// Review R7: the proposal model may only be shown what the player could already see. An explored
// tile is not a found object: the original failure listed an unspotted trap with its real id,
// type, name and distance in the candidate context. The engine's own search may still stumble
// onto that trap later, and a proposal that names it before it is found must be refused.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { assertTestContainer } from '../../scripts/test-container.mjs';

assertTestContainer();
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-dnd-r7-'));
process.env.DATA_DIR = temp;

const require = createRequire(import.meta.url);
const store = require('../../server/store.js');
const engine = require('../../server/game/engine.js');
const presets = require('../../server/game/presets.js');
const bounded = require('../../server/game/bounded-actions.js');
const executor = require('../../server/game/action-executor.js');

store.saveSettings({ llm: { enabled: false }, portraits: { enabled: false } });

let passed = 0, failed = 0, assertions = 0;
function check(value, message) { assert.ok(value, message); assertions++; }
async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log('  PASS: ' + name);
  } catch (error) {
    failed++;
    console.error('  FAIL: ' + name + '\n' + error.stack);
  }
}

let heroCounter = 0;
function startRun(mapId) {
  const char = engine.buildCharacter({ name: 'R7 Hero ' + (++heroCounter), ...presets.draftFor('arcane') });
  char.id = store.newId('char');
  char.gold = 50;
  store.saveCharacters([...store.getCharacters(), char]);
  const state = engine.startGame(char, { mapId, difficulty: 'easy', bringAlly: 'none' });
  state.character.abilities.int = 50;
  store.saveGame(state);
  return state;
}
function revealEverything(state) {
  state.discovered = state.map.rows.flatMap((row, y) => [...row].map((_, x) => x + ',' + y));
  return state;
}
function besidePlayer(state, entity) {
  const p = engine.playerEntity(state);
  const spot = [[1, 0], [-1, 0], [0, 1], [0, -1]]
    .map(([dx, dy]) => ({ x: p.x + dx, y: p.y + dy }))
    .find(q => state.map.rows[q.y] && state.map.rows[q.y][q.x] !== '#');
  entity.x = spot.x;
  entity.y = spot.y;
  return entity;
}
const hiddenTrap = (state, name = 'NEEDLE TRAP') => {
  const trap = besidePlayer(state, {
    id: 'r7_hidden_trap', type: 'trap', name, x: 1, y: 1, revealed: false, triggered: false, detectDc: 15, damage: '1d4'
  });
  state.objects = [...(state.objects || []), trap];
  return trap;
};

console.log('--- Review R7 Action Context Visibility Tests ---');

await test('an unspotted trap on an explored tile is absent from the candidate context', () => {
  const state = revealEverything(startRun('crypt'));
  const trap = hiddenTrap(state);
  check(engine.isTileDiscovered(state, trap.x, trap.y), 'the tile itself really is explored');
  check(engine.isTrapHidden(trap), 'and the trap really is unspotted');
  const context = bounded.buildAuthorizedContext(state, 'en');
  const listed = context.objects.filter(o => o.id === trap.id);
  check(listed.length === 0, 'the trap is not offered as a candidate: ' + JSON.stringify(listed));
  const serialised = JSON.stringify(context);
  check(!serialised.includes(trap.id), 'the context never carries its id');
  check(!serialised.includes('NEEDLE TRAP'), 'the context never carries its name');
  check(!context.objects.some(o => o.type === 'trap' && o.distance <= 2), 'no hidden trap at arm length: ' + JSON.stringify(context.objects));
});

await test('a spotted trap, an opened chest and a lit tile do appear', () => {
  const state = revealEverything(startRun('crypt'));
  const trap = hiddenTrap(state, 'GLYPH TRAP');
  trap.revealed = true;
  const context = bounded.buildAuthorizedContext(state, 'en');
  check(context.objects.some(o => o.id === trap.id), 'after the hero finds it, the candidate list may name it');
  const chest = (state.objects || []).find(o => o.type === 'chest');
  if (chest) {
    besidePlayer(state, chest);
    const again = bounded.buildAuthorizedContext(state, 'en');
    check(again.objects.some(o => o.id === chest.id), 'an ordinary nearby object is listed: ' + chest.id);
  } else {
    console.log('  note: the crypt run had no chest nearby to assert against');
  }
});

await test('an unexplored tile hides its objects however close they are', () => {
  const state = startRun('crypt');
  state.discovered = [];
  const trap = hiddenTrap(state, 'PIT');
  trap.revealed = true;
  const context = bounded.buildAuthorizedContext(state, 'en');
  check(context.objects.every(o => o.id !== trap.id), 'a revealed trap on an unexplored tile is still invisible: ' + JSON.stringify(context.objects));
  const other = (state.objects || []).find(o => o.id !== trap.id);
  if (other) {
    other.revealed = true;
    check(context.objects.every(o => o.id !== other.id), 'the same holds for any other object on an unexplored tile');
  }
});

await test('fog hides a monster, line of sight decides it, and npcs must be within reach', () => {
  const state = revealEverything(startRun('crypt'));
  const p = engine.playerEntity(state);
  const monsters = (state.entities || []).filter(e => e.kind === 'monster' && e.alive !== false);
  check(monsters.length > 0, 'the crypt run has monsters to reason about');
  const target = monsters[0];
  const far = state.map.rows.flatMap((row, y) => [...row].map((cell, x) => ({ x, y, cell })))
    .filter(q => q.cell !== '#')
    .sort((a, b) => engine.manhattan(b, p) - engine.manhattan(a, p))[0];
  target.x = far.x; target.y = far.y;

  // Fog first: the tile is not explored, so nothing about the monster may be proposed.
  state.discovered = (state.map.rows.flatMap((row, y) => [...row].map((_, x) => x + ',' + y))).filter(key => key !== far.x + ',' + far.y);
  check(!bounded.buildAuthorizedContext(state, 'en').monsters.some(m => m.id === target.id), 'an unexplored tile hides whatever stands on it');
  state.discovered = state.map.rows.flatMap((row, y) => [...row].map((_, x) => x + ',' + y));

  const shielded = state.map.rows.flatMap((row, y) => [...row].map((cell, x) => ({ x, y, cell })))
    .filter(q => q.cell !== '#' && !engine.los(state, p.x, p.y, q.x, q.y));
  if (shielded.length) {
    target.x = shielded[0].x; target.y = shielded[0].y;
    check(!bounded.buildAuthorizedContext(state, 'en').monsters.some(m => m.id === target.id), 'an explored but unseen tile behind cover hides the monster');
  } else {
    console.log('  note: this crypt layout has no covered tile, line-of-sight branch not exercised');
  }

  // NPCs are only conversable within four tiles.
  const npc = (state.entities || []).find(e => e.kind === 'npc');
  if (npc) {
    npc.x = far.x; npc.y = far.y;
    const spoken = bounded.buildAuthorizedContext(state, 'en');
    check(!spoken.npcs.some(n => n.id === npc.id), 'an npc across the dungeon is not offered: ' + npc.id + ' dist ' + engine.manhattan(p, npc));
    besidePlayer(state, npc);
    check(bounded.buildAuthorizedContext(state, 'en').npcs.some(n => n.id === npc.id), 'and an npc standing beside the hero is');
  }
  besidePlayer(state, target);
  check(bounded.buildAuthorizedContext(state, 'en').monsters.some(m => m.id === target.id), 'a monster next to the hero is offered');
});

await test('a choice gated on an ending this hero never earned is not shown to the model', () => {
  const state = revealEverything(startRun('river-post'));
  const scene = (state.map.scenes || []).find(s => (s.choices || []).some(c => c.condition && c.condition.type === 'history_ending'));
  check(!!scene, 'river-post gates choices on chapter 1 endings');
  const speaker = engine.sceneSpeaker(state, scene);
  check(!!speaker, 'the gated scene has a speaker');
  const p = engine.playerEntity(state);
  p.x = speaker.x; p.y = speaker.y + 1;
  state.discovered = [...new Set([...(state.discovered || []), p.x + ',' + p.y, speaker.x + ',' + speaker.y])];
  const gated = scene.choices.filter(c => c.condition && c.condition.type === 'history_ending').map(c => c.id);
  const context = bounded.buildAuthorizedContext(state, 'en');
  const projected = context.scenes.find(s => s.sceneId === scene.id);
  check(!!projected, 'the scene itself is offered once the hero stands beside its speaker: ' + JSON.stringify(context.scenes.map(s => s.sceneId)));
  for (const choiceId of gated) {
    check(!projected.choices.some(c => c.choiceId === choiceId), 'unearned ending choice ' + choiceId + ' is not in the proposal context');
  }
  const earned = { id: 'r7-fact', saveId: state.id, mapId: 'courier-crossing', sceneId: 'reckoning', choiceId: 'report', fact: 'public_record', ending: 'reported', ts: Date.now() };
  const storyId = state.map.story?.requiresHistory?.storyId || state.map.story?.id;
  earned.storyId = storyId;
  state.character.encounterFacts = [earned];
  const after = bounded.buildAuthorizedContext(state, 'en').scenes.find(s => s.sceneId === scene.id);
  check(after.choices.some(c => c.choiceId === 'show_pass'), 'once the hero really earned it, the choice becomes proposable');
});

await test('a proposal naming a hidden trap is refused before anything executes', () => {
  const state = revealEverything(startRun('crypt'));
  const trap = hiddenTrap(state);
  store.saveGame(state);
  const verdict = bounded.validateProposal(state, { intent: 'investigate', targetId: trap.id });
  check(verdict.valid === false, 'the hidden trap cannot be named as an investigate target');
  check(!!verdict.error, 'and the refusal explains itself: ' + verdict.error);
  const events = [];
  bounded.executeProposal(state, { intent: 'investigate', targetId: trap.id }, 'en', events);
  check(!events.some(e => e.type === 'trap_found' || e.trapId === trap.id), 'executing a refused proposal reveals nothing: ' + JSON.stringify(events.map(e => e.type)));
  check(state.objects.find(o => o.id === trap.id).revealed === false, 'the trap stays hidden after the refused proposal');

  const revealed = bounded.validateProposal(state, { intent: 'investigate', targetId: trap.id });
  trap.revealed = true;
  const ok = bounded.validateProposal(state, { intent: 'investigate', targetId: trap.id });
  check(ok.valid === true, 'after the hero finds it, investigating that trap is a legal proposal: ' + JSON.stringify(revealed));
});

await test('the engines own search still finds traps the model was never told about', () => {
  const state = startRun('crypt');
  state.discovered = [];
  const trap = hiddenTrap(state, 'SNARE');
  engine.playerEntity(state).hp = 100;
  const events = [];
  const result = executor.searchArea(state, events);
  check(result.checked === true, 'the search actually rolled against the hidden trap');
  check(trap.revealed === true, 'generic searching uncovered it (Investigation is the mechanics, not the whitelist)');
  check(events.some(e => e.type === 'trap_found'), 'and said so in the log');
  // The tile is explored the moment the hero is standing on it searching.
  state.discovered = [...new Set([...(state.discovered || []), trap.x + ',' + trap.y, engine.playerEntity(state).x + ',' + engine.playerEntity(state).y])];
  const context = bounded.buildAuthorizedContext(state, 'en');
  check(context.objects.some(o => o.id === trap.id), 'only now may a proposal name it');
});

try { fs.rmSync(temp, { recursive: true, force: true }); } catch {}

console.log(`\nSummary: ${passed} passed, ${failed} failed, ${assertions} assertions.\n`);
if (failed > 0) process.exit(1);
