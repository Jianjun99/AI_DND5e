// tests/integration/quick-start.test.mjs
// T5 — quick start & first experience, over the REAL creation/start routes (in-process
// express, isolated DATA_DIR — never touches real player saves or model settings):
//   - both recommended presets build through the real engine.buildCharacter and are
//     legally equipped (armor/shield on body, real attacks, spells known, feat perks)
//   - POST /api/characters accepts { presetId, name } (name optional → preset default)
//     and refuses unknown presetIds; the preset wins over any client-sent draft fields
//   - the POST response carries journey guidance pointing at the stage-0 prepare entrance
//   - the legacy seven-step draft path still works untouched (name required, fields honored)
//   - both presets can embark on the mainline start map through POST /api/game/start
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

// isolated DATA_DIR — must be set BEFORE the first server module is required
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-dnd-t5-'));

const require = createRequire(import.meta.url);
const express = require('express');
const store = require('../../server/store.js');
const engine = require('../../server/game/engine.js');
const presets = require('../../server/game/presets.js');

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

async function test(name, fn) {
  try {
    await fn();
    console.log(`  ✔ PASS: ${name}`);
  } catch (err) {
    failed++;
    console.error(`  ❌ ERROR in ${name}:`, err.message);
  }
}

// ---- in-process app with the real routes (no LLM: creation is purely mechanical) ----
const app = express();
app.use(express.json());
app.use('/api/characters', require('../../server/routes/characters.js'));
app.use('/api/game', require('../../server/routes/game.js'));
const server = await new Promise(resolve => { const s = app.listen(0, () => resolve(s)); });
const BASE_URL = `http://localhost:${server.address().port}`;

async function api(method, p, body) {
  const res = await fetch(`${BASE_URL}${p}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

console.log('\n--- T5 Quick Start: presets, HTTP creation, embark ---');

await test('presets expose client metadata without leaking build drafts', () => {
  const list = presets.listPresets();
  assert(list.length === 2, 'exactly two presets');
  for (const p of list) {
    assert(p.id && p.label && p.tagline && p.blurb && p.defaultName, `${p.id} has display metadata`);
    assert(Array.isArray(p.tips) && p.tips.length >= 2, `${p.id} has gameplay-difference tips`);
    assert(!('draft' in p), `${p.id} metadata carries no build draft`);
    assert(presets.draftFor(p.id) && presets.draftFor(p.id).className, `${p.id} draft resolvable`);
  }
  assert(presets.getPreset('nope') === null, 'unknown preset id resolves to null');
});

await test('guardian preset builds legal through the real engine rules', () => {
  const meta = presets.listPresets().find(p => p.id === 'guardian');
  const c = engine.buildCharacter({ ...presets.draftFor('guardian'), name: meta.defaultName });
  assert(c.className === 'fighter' && c.species === 'dwarf' && c.background === 'guard', 'fighter / dwarf / guard');
  assert(c.hpMax === 13, `HP 13 (d10 + CON +2 + dwarf hpPerLevel), got ${c.hpMax}`);
  assert(c.acBase === 19, `AC 19 (chain mail 16 + shield 2 + defense 1), got ${c.acBase}`);
  assert(c.equipped.armor === 'chain_mail' && c.equipped.offHand === 'shield' && c.equipped.mainHand === 'longsword', 'armor + shield + weapon equipped');
  const sword = c.attacks.find(a => a.weaponId === 'longsword');
  assert(sword && sword.bonus === 5 && sword.dmgDice === '1d8' && sword.dmgMod === 3, 'longsword +5, 1d8+3 (STR 17)');
  assert(c.inventory.some(i => i.itemId === 'potion_healing' && i.qty === 2), 'carries 2 healing potions');
  assert(c.skills.includes('athletics') && c.skills.includes('perception'), 'guard background skills present');
  // T5a: the fighter's 2 skillPicks must be complete, allowed and non-duplicating
  const fighterList = ['acrobatics', 'animal_handling', 'athletics', 'history', 'insight', 'intimidation', 'persuasion', 'perception', 'survival'];
  assert(c.skills.length === 4 && new Set(c.skills).size === 4, `4 unique skills (bg 2 + class 2), got ${c.skills.join(',')}`);
  assert(['insight', 'survival'].every(s => c.skills.includes(s)), 'fighter skillPicks (insight/survival) present');
  assert(['insight', 'survival'].every(s => fighterList.includes(s)), 'class picks come from the fighter skillList');
  assert(['insight', 'survival'].every(s => !['athletics', 'perception'].includes(s)), 'class picks do not waste on existing background skills');
  assert(engine.skillMod(c, 'insight') === 2 && engine.skillMod(c, 'survival') === 2,
    `added skills really modify checks (WIS +0 + PB 2), got insight ${engine.skillMod(c, 'insight')} / survival ${engine.skillMod(c, 'survival')}`);
  assert(c.feat === 'alert', 'guard origin feat alert');
  assert(c.fightingStyle === 'defense', 'defense fighting style');
});

await test('arcane preset builds legal through the real engine rules', () => {
  const meta = presets.listPresets().find(p => p.id === 'arcane');
  const c = engine.buildCharacter({ ...presets.draftFor('arcane'), name: meta.defaultName });
  assert(c.className === 'wizard' && c.species === 'human' && c.background === 'sage', 'wizard / human / sage');
  assert(c.hpMax === 8, `HP 8 (d6 + CON +2), got ${c.hpMax}`);
  assert(c.acBase === 12, `AC 12 (10 + DEX +2), got ${c.acBase}`);
  assert(c.abilities.int === 17 && c.abilities.con === 14, 'INT 17 / CON 14 after background bumps');
  const sc = c.spellcasting;
  assert(sc && sc.ability === 'int' && sc.spellAttack === 5 && sc.saveDc === 13, 'spell attack +5 / DC 13 (INT 17)');
  assert(sc.cantrips.includes('fire_bolt') && sc.cantrips.includes('light'), 'Fire Bolt known + Light from the sage origin feat');
  assert(sc.freeSpell && sc.freeSpell.id === 'mage_armor' && sc.freeSpell.max === 1, 'free Mage Armor from the sage origin feat');
  assert(['magic_missile', 'shield', 'burning_hands'].every(s => sc.spells.includes(s)), 'the three chosen level-1 spells known');
  assert(c.skills.includes('arcana') && c.skills.includes('history') && c.skills.includes('perception') && c.skills.includes('insight'), 'sage skills + human versatility picks present');
  // T5a: the wizard's 2 skillPicks on top of the species/background skills
  const wizardList = ['arcana', 'history', 'insight', 'investigation', 'medicine', 'nature', 'religion'];
  assert(c.skills.length === 6 && new Set(c.skills).size === 6, `6 unique skills (bg 2 + species 2 + class 2), got ${c.skills.join(',')}`);
  assert(['investigation', 'religion'].every(s => c.skills.includes(s)), 'wizard skillPicks (investigation/religion) present');
  assert(['investigation', 'religion'].every(s => wizardList.includes(s)), 'class picks come from the wizard skillList');
  assert(['investigation', 'religion'].every(s => !['arcana', 'history', 'perception', 'insight'].includes(s)), 'class picks do not waste on existing background/species skills');
  // INT 17 (+3) + PB 2, and the current wizard rule also lists both under expertise (+2) → +7
  assert(engine.skillMod(c, 'investigation') === 7 && engine.skillMod(c, 'religion') === 7,
    `added skills really modify checks incl. the wizard expertise rule, got investigation ${engine.skillMod(c, 'investigation')} / religion ${engine.skillMod(c, 'religion')}`);
  assert(c.equipped.mainHand === 'quarterstaff', 'quarterstaff equipped');
  assert(c.attacks.some(a => a.weaponId === 'quarterstaff'), 'has a real (fallback) weapon attack');
});

await test('POST /api/characters creates a preset hero without a name (default applies)', async () => {
  const r = await api('POST', '/api/characters', { presetId: 'guardian' });
  assert(r.status === 200, 'HTTP 200');
  assert(r.data.name === '布兰·石须', `default name applied, got ${r.data.name}`);
  assert(r.data.level === 1 && r.data.gold === 50, 'level 1, starting gold');
  assert(r.data.acBase === 19 && r.data.hpMax === 13, 'preset stats really applied');
  assert(r.data.skills.length === 4 && r.data.skills.includes('insight') && r.data.skills.includes('survival'),
    `HTTP-created preset carries the full skill list, got ${r.data.skills.join(',')}`);
  assert(r.data.guidance && r.data.guidance.primary && r.data.guidance.primary.kind === 'prepare', 'guidance rides along');
  assert(r.data.guidance.primary.mapId === 'crypt', 'stage-0 mainline points at the crypt prepare entrance');
});

await test('POST /api/characters honors a custom name and rejects unknown presets', async () => {
  const named = await api('POST', '/api/characters', { presetId: 'arcane', name: '  自定义法师  ' });
  assert(named.status === 200 && named.data.name === '自定义法师', 'custom name kept (trimmed)');
  const bad = await api('POST', '/api/characters', { presetId: 'nope', name: 'X' });
  assert(bad.status === 400, 'unknown presetId → 400');
  const legacy = await api('POST', '/api/characters', {});
  assert(legacy.status === 400 && /name/i.test(legacy.data.error), 'legacy path still requires a name');
  const override = await api('POST', '/api/characters', { presetId: 'guardian', name: '冒充法师', className: 'wizard', baseScores: { str: 8 } });
  assert(override.status === 200 && override.data.className === 'fighter' && override.data.acBase === 19, 'preset wins over client-sent draft fields');
});

await test('legacy seven-step draft creation still works untouched', async () => {
  const r = await api('POST', '/api/characters', {
    name: 'Sheet Hero', species: 'elf', className: 'ranger', background: 'criminal',
    baseScores: { str: 13, dex: 15, con: 14, int: 10, wis: 12, cha: 8 },
    bgPlus2: 'dex', bgPlus1: 'con', skills: ['survival'],
    armorOption: 'studded', weaponOption: 'bow_sword'
  });
  assert(r.status === 200, 'HTTP 200');
  assert(r.data.className === 'ranger' && r.data.species === 'elf', 'draft fields honored');
  assert(r.data.acBase > 10, 'armor applied');
});

await test('both presets embark through the real start route and take a move', async () => {
  for (const id of ['guardian', 'arcane']) {
    const created = await api('POST', '/api/characters', { presetId: id });
    assert(created.status === 200, `${id}: created`);
    const start = await api('POST', '/api/game/start', { characterId: created.data.id, bringAlly: false, difficulty: 'easy', mapId: 'crypt' });
    assert(start.status === 200, `${id}: embarked`);
    const st = start.data.state;
    assert(st.mode === 'explore' && st.mapId === 'crypt', `${id}: exploring the crypt`);
    const player = st.entities.find(e => e.kind === 'player');
    assert(player && player.hp > 0 && player.hpMax === st.character.hpMax, `${id}: player entity matches the preset HP`);
    // one legal step: a free adjacent tile on the ASCII grid ('#' is wall), any order
    const step = [[1, 0], [-1, 0], [0, 1], [0, -1]]
      .map(([dx, dy]) => ({ x: player.x + dx, y: player.y + dy }))
      .find(t => ((st.map.rows[t.y] || '')[t.x] || '#') !== '#' &&
        !st.entities.some(e => e.alive !== false && e.x === t.x && e.y === t.y));
    assert(!!step, `${id}: found a walkable first step`);
    const mv = await api('POST', `/api/game/${st.id}/action`, { type: 'move', x: step.x, y: step.y });
    assert(mv.status === 200 && !mv.data.events.some(e => e.type === 'error'), `${id}: server accepts the first action`);
    await api('DELETE', `/api/game/${st.id}`);
  }
});

store; // keep the require list honest: DATA_DIR isolation is proven by this suite never touching ../data
server.close();

console.log(`\n  T5 quick-start: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
