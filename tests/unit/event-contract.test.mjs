// tests/unit/event-contract.test.mjs — the event vocabulary contract.
// Every event type the server emits must be catalogued: either it has a sound in
// play.js's SFX_MAP, or it is listed here as narration-only (the text IS the
// contract — the client renders it through the generic log pipeline). New event
// types fail this test until they make that decision, which is what prevents the
// dead-wiring class of bugs (see tasks history: personaQuickSelect, data-useitem).
//
// It also checks the reverse direction: SFX_MAP keys that the server never emits
// must be marked client-synthesized, so dead sound entries get noticed.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..', '..');

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
  const before = failed;
  try {
    fn();
    console.log(`  ✔ PASS: ${name}`);
  } catch (err) {
    if (failed === before) failed++;
    console.error(`  ❌ FAILED: ${name} — ${err && (err.stack || err.message)}`);
  }
}

// --- narration-only events: rendered through the generic log/narration pipeline,
// no dedicated sound or handler. One line per type; add yours here (or to
// SFX_MAP in play.js if it deserves a sound).
const NARRATION_ONLY = new Set([
  // combat flavour and subclass/resources
  'ally_down', 'breath', 'dash', 'death_save', 'disengage', 'dodge',
  'enrage', 'fiend', 'hex', 'inspiration', 'innate', 'mana', 'mark', 'note',
  'opportunity', 'rage', 'recover', 'relentless', 'smite', 'smite_ready',
  'sneak', 'steady_aim', 'stones', 'superiority', 'surge', 'undead_fort', 'wildshape',
  'simple_melee', 'sleep', 'sleep_fail', 'parley', 'parley_fail', 'shove', 'shove_fail',
  'sacred', 'bless', 'combat_end', 'slay', 'buff', 'spore_burst', 'chat_open', 'desperate',
  // exploration and interaction
  'altar_fail', 'bestiary_entry', 'boss_loot', 'elite_loot', 'fetch_relic', 'font_heal',
  'hint', 'info', 'lever_pull', 'listen', 'relic', 'relic_fail', 'trap_fail', 'trap_found',
  'wandering', 'door_fail',
  // meta / companion / rest / scene
  'asi', 'boon', 'carry_in', 'companion', 'condition', 'error', 'journal', 'respawn',
  'rest', 'rest_blocked', 'scene', 'shop', 'kill'
]);

// --- matched `type: '...'` literals that are NOT events (damage-dice element
// types, guidance-candidate markers, ...). Add with a comment saying what it is.
const NOT_EVENTS = new Set([
  'colossus',  // damage-dice element type (Giant's Might)
  'radiant',   // damage-dice element type (Divine Favour etc.)
  'explore'    // guidance candidate marker (state.map.rooms hover cues)
]);

// --- SFX_MAP keys the server never emits: the client plays them itself
const CLIENT_SYNTHETIC_SFX = new Set(['level_ready']);

// --- source extraction ------------------------------------------------------
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const emitSources = [
  'server/game/engine.js', 'server/routes/game.js', 'server/game/referee.js'
].map(read);
const emitted = new Set();
for (const src of emitSources) {
  for (const m of src.matchAll(/type:\s*'([a-z_]+)'/g)) emitted.add(m[1]);
}

const playSrc = read('public/js/views/play.js');
const sfx = new Set();
const sfxBlock = playSrc.match(/const SFX_MAP = \{([\s\S]*?)\};/);
if (sfxBlock) for (const m of sfxBlock[1].matchAll(/([a-z_]+):\s*'/g)) sfx.add(m[1]);

// --- the contract ------------------------------------------------------------
console.log('\n--- Running Unit Tests: Event Contract (emitted vs client vocabulary) ---');

test('every server-emitted event type is catalogued (SFX, narration-only, or not-an-event)', () => {
  const unknown = [...emitted].filter((t) => !sfx.has(t) && !NARRATION_ONLY.has(t) && !NOT_EVENTS.has(t));
  assert(unknown.length === 0,
    `Uncatalogued event types: ${unknown.join(', ')}. Decide: add to SFX_MAP (sound), ` +
    `to NARRATION_ONLY in this test (log/narration pipeline), or to NOT_EVENTS (not an event)`);
});

test('every narration-only entry is actually emitted somewhere (no stale catalogue)', () => {
  const stale = [...NARRATION_ONLY].filter((t) => !emitted.has(t));
  assert(stale.length === 0, `NARRATION_ONLY entries no longer emitted: ${stale.join(', ')} — prune them`);
});

test('every SFX_MAP key is emitted by the server or marked client-synthesized', () => {
  const dead = [...sfx].filter((t) => !emitted.has(t) && !CLIENT_SYNTHETIC_SFX.has(t));
  assert(dead.length === 0, `SFX_MAP keys never emitted: ${dead.join(', ')} — mark client-synthetic or remove`);
});

test('the catalogue is not empty (guards against source-path regressions)', () => {
  assert(emitted.size > 60, `expected the full event vocabulary, got ${emitted.size} types`);
  assert(sfx.size > 20, `expected the SFX map, got ${sfx.size} entries`);
});

console.log(`\nEvent Contract Unit Tests Summary: ${passed} passed, ${failed} failed.`);
if (failed > 0) process.exit(1);
