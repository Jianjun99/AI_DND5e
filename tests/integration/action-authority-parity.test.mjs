// tests/integration/action-authority-parity.test.mjs
// Review R6: a typed sentence and a clicked button must run through one authoritative executor.
// The original failure copied the potion economy into the text branch, so "drink a potion"
// consumed a vial after the useItem button had already spent the bonus action, and the item the
// player actually named was ignored. Every pair below is asserted to behave the same way.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { assertTestContainer } from '../../scripts/test-container.mjs';

assertTestContainer();
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-dnd-r6-'));
process.env.DATA_DIR = temp;

const require = createRequire(import.meta.url);
const express = require('express');
const store = require('../../server/store.js');
const engine = require('../../server/game/engine.js');
const presets = require('../../server/game/presets.js');
const executor = require('../../server/game/action-executor.js');
const presentation = require('../../server/game/presentation.js');

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

const app = express();
app.use(express.json({ limit: '12mb' }));
app.use(require('../../server/locale.js').localeMiddleware);
app.use(presentation.middleware);
for (const name of ['game', 'city', 'characters', 'content']) app.use('/api/' + name, require('../../server/routes/' + name + '.js'));
const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
const base = 'http://127.0.0.1:' + server.address().port;

async function api(method, url, body, locale = 'en') {
  const r = await fetch(base + url, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-Game-Locale': locale },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch { json = text; }
  return { status: r.status, body: json };
}

let heroCounter = 0;
async function newRun() {
  const char = engine.buildCharacter({ name: 'R6 Hero ' + (++heroCounter), ...presets.draftFor('guardian') });
  char.id = store.newId('char');
  char.gold = 50;
  store.saveCharacters([...store.getCharacters(), char]);
  const start = await api('POST', '/api/game/start', { characterId: char.id, mapId: 'crypt', difficulty: 'easy', bringAlly: 'none' });
  if (start.status !== 200) throw new Error('start failed: ' + JSON.stringify(start.body).slice(0, 200));
  return { heroId: char.id, saveId: start.body.state.id };
}

/** Put the run into the exact economy state the regression needs, without inventing rules. */
async function stage(options = {}) {
  const { saveId } = await newRun();
  const state = store.getSave(saveId);
  const p = engine.playerEntity(state);
  p.hp = options.hp ?? 1;
  p.hpMax = 100;
  state.character.inventory = (options.inventory || [{ itemId: 'potion_healing', qty: 3 }]).map(entry => ({ ...entry }));
  const monster = (state.entities || []).find(e => e.kind === 'monster' && e.alive !== false);
  if (monster) {
    // Stand the hero right next to a real monster, on a tile the grid agrees is walkable.
    const spot = [[1, 0], [-1, 0], [0, 1], [0, -1]]
      .map(([dx, dy]) => ({ x: p.x + dx, y: p.y + dy }))
      .find(q => state.map.rows[q.y] && state.map.rows[q.y][q.x] !== '#');
    if (spot) {
      monster.x = spot.x;
      monster.y = spot.y;
      monster.aware = true;
    }
    state.discovered = [...new Set([...(state.discovered || []), p.x + ',' + p.y, monster.x + ',' + monster.y, ...state.map.rows.flatMap((row, y) => [...row].map((_, x) => x + ',' + y))])];
  }
  state.mode = options.mode || 'combat';
  const order = options.monsterActs && monster
    ? [{ id: monster.id }, { id: 'player' }]
    : [{ id: 'player' }, ...(monster ? [{ id: monster.id }] : [])];
  state.combat = {
    order,
    turnIdx: options.turnIdx ?? 0,
    round: 1,
    actionUsed: options.actionUsed ?? false,
    bonusUsed: options.bonusUsed ?? false,
    movementLeft: 30
  };
  store.saveGame(state);
  return { saveId, monsterId: monster && monster.id };
}

const qty = (saveId, itemId) => {
  const state = store.getSave(saveId);
  const entry = (state.character.inventory || []).find(i => (i.uniqueId || i.itemId) === itemId || i.itemId === itemId);
  return entry ? entry.qty : 0;
};
const heroHp = saveId => engine.playerEntity(store.getSave(saveId)).hp;
const errorsOf = body => (body.events || []).filter(e => e.type === 'error');
const button = (saveId, itemId) => api('POST', '/api/game/' + saveId + '/action', { type: 'useItem', itemId });
const say = (saveId, text, locale = 'en') => api('POST', '/api/game/' + saveId + '/action', { type: 'freeform', text }, locale);

console.log('--- Review R6 Single Authoritative Action Execution Tests ---');

await test('a sentence cannot drink a potion after the button spent the bonus action', async () => {
  const { saveId } = await stage({ bonusUsed: true, inventory: [{ itemId: 'potion_healing', qty: 3 }] });
  const clicked = await button(saveId, 'potion_healing');
  check(clicked.status === 200, 'button answered: ' + clicked.status);
  check(errorsOf(clicked.body).length === 1, 'the button refused with one error: ' + JSON.stringify(clicked.body.events).slice(0, 220));
  check(qty(saveId, 'potion_healing') === 3, 'the button left all three vials');

  const spoken = await say(saveId, 'drink a potion');
  check(spoken.status === 200, 'sentence answered: ' + spoken.status);
  check(errorsOf(spoken.body).length >= 1, 'the sentence was refused too: ' + JSON.stringify(spoken.body.events).slice(0, 220));
  check(qty(saveId, 'potion_healing') === 3, 'the sentence did not drink a vial the button could not');
  const buttonKey = errorsOf(clicked.body)[0].messageKey;
  const spokenKey = errorsOf(spoken.body).map(e => e.messageKey).filter(Boolean);
  check(spokenKey.includes(buttonKey), 'both refuse for the same documented reason: ' + buttonKey + ' vs ' + JSON.stringify(spokenKey));

  const chinese = await say(saveId, '喝药水', 'zh-CN');
  check(qty(saveId, 'potion_healing') === 3, 'the Chinese sentence drank nothing either');
  check(errorsOf(chinese.body).length >= 1, 'the Chinese sentence reports the same refusal');
});

await test('out of turn, button and sentence both refuse without spending anything', async () => {
  const { saveId } = await stage({ monsterActs: true, inventory: [{ itemId: 'potion_healing', qty: 2 }] });
  check(store.getSave(saveId).combat.order[0].id !== 'player', 'the fixture really is someone elses turn');
  const clicked = await button(saveId, 'potion_healing');
  check(errorsOf(clicked.body).length === 1, 'button refused out of turn');
  check(qty(saveId, 'potion_healing') === 2, 'no vial left the pack out of turn');
  const spoken = await say(saveId, 'drink a potion');
  check(errorsOf(spoken.body).length >= 1, 'sentence refused out of turn: ' + JSON.stringify(spoken.body.events).slice(0, 220));
  check(qty(saveId, 'potion_healing') === 2, 'the sentence honoured the turn too');
  check(errorsOf(spoken.body).some(e => e.messageKey === errorsOf(clicked.body)[0].messageKey), 'both name the same turn rule');
});

await test('the sentence honours the potion it actually names', async () => {
  const { saveId } = await stage({ inventory: [{ itemId: 'potion_healing', qty: 1 }, { itemId: 'potion_greater', qty: 1 }] });
  const state = store.getSave(saveId);
  const named = executor.resolveMentionedItem(state, '喝强效治疗药水');
  check(named && named.itemId === 'potion_greater', 'the resolver picks the named brew: ' + (named && named.itemId));
  const spoken = await say(saveId, '喝强效治疗药水', 'zh-CN');
  check(errorsOf(spoken.body).length === 0, 'the Chinese sentence executed: ' + JSON.stringify(spoken.body.events).slice(0, 220));
  check(qty(saveId, 'potion_greater') === 0, 'the greater healing potion is the one that vanished');
  check(qty(saveId, 'potion_healing') === 1, 'the ordinary potion is untouched');
  check(heroHp(saveId) > 1, 'the hero is healed by the named brew');

  const english = await stage({ inventory: [{ itemId: 'potion_healing', qty: 1 }, { itemId: 'potion_greater', qty: 1 }] });
  const said = await say(english.saveId, 'quaff the greater healing potion');
  check(errorsOf(said.body).length === 0, 'the English sentence executed: ' + JSON.stringify(said.body.events).slice(0, 220));
  check(qty(english.saveId, 'potion_greater') === 0, 'English names the same instance');
  check(qty(english.saveId, 'potion_healing') === 1, 'and leaves the other vial alone');

  const clicked = await button(english.saveId, 'potion_healing');
  check(errorsOf(clicked.body).length === 1, 'the button now refuses: the bonus action is spent');
});

await test('a named potion that is missing or zero quantity refuses and never consumes another item', async () => {
  // 1. English: carries only potion_healing (3 vials), requests greater healing potion
  const enRun = await stage({ inventory: [{ itemId: 'potion_healing', qty: 3 }] });
  const enSpoken = await say(enRun.saveId, 'quaff the greater healing potion');
  check(errorsOf(enSpoken.body).length >= 1, 'English sentence refuses unowned greater potion: ' + JSON.stringify(enSpoken.body.events).slice(0, 200));
  check(qty(enRun.saveId, 'potion_healing') === 3, 'ordinary healing potion count is unchanged');
  check(heroHp(enRun.saveId) === 1, 'hero was not healed by an unowned potion');
  check(store.getSave(enRun.saveId).combat.bonusUsed === false, 'bonus action was not spent');

  // 2. Chinese: carries only potion_healing (3 vials), requests 强效治疗药水
  const zhRun = await stage({ inventory: [{ itemId: 'potion_healing', qty: 3 }] });
  const zhSpoken = await say(zhRun.saveId, '喝强效治疗药水', 'zh-CN');
  check(errorsOf(zhSpoken.body).length >= 1, 'Chinese sentence refuses unowned greater potion');
  check(qty(zhRun.saveId, 'potion_healing') === 3, 'ordinary healing potion count is unchanged');
  check(heroHp(zhRun.saveId) === 1, 'hero was not healed');
  check(store.getSave(zhRun.saveId).combat.bonusUsed === false, 'bonus action was not spent');

  // 2b. Chinese short name: 喝强效药水
  const zhShort = await say(zhRun.saveId, '喝强效药水', 'zh-CN');
  check(errorsOf(zhShort.body).length >= 1, 'Chinese short name refuses unowned greater potion');
  check(qty(zhRun.saveId, 'potion_healing') === 3, 'ordinary healing potion count is still 3');

  // 3. Carrying potion_greater with qty 0
  const zeroRun = await stage({ inventory: [{ itemId: 'potion_healing', qty: 3 }, { itemId: 'potion_greater', qty: 0 }] });
  const zeroSpoken = await say(zeroRun.saveId, 'quaff the greater healing potion');
  check(errorsOf(zeroSpoken.body).length >= 1, 'refuses potion with 0 quantity');
  check(qty(zeroRun.saveId, 'potion_healing') === 3, 'other potion is not consumed');

  // 4. Carries only potion_greater (1 vial), requests ordinary healing potion
  const onlyGreater = await stage({ inventory: [{ itemId: 'potion_greater', qty: 1 }] });
  const missingHealing = await say(onlyGreater.saveId, 'quaff the potion of healing');
  check(errorsOf(missingHealing.body).length >= 1, 'refuses missing ordinary healing potion');
  check(qty(onlyGreater.saveId, 'potion_greater') === 1, 'greater potion is untouched');
  const missingHealingZh = await say(onlyGreater.saveId, '喝普通治疗药水', 'zh-CN');
  check(errorsOf(missingHealingZh.body).length >= 1, 'Chinese refuses missing ordinary healing potion');
  check(qty(onlyGreater.saveId, 'potion_greater') === 1, 'greater potion is untouched');

  // 5. uniqueId instance item
  const customRun = await stage({
    inventory: [{
      itemId: 'mystery_potion',
      kind: 'mystery_potion',
      uniqueId: 'brew_custom_42',
      name: 'Ironwood Elixir',
      qty: 1,
      tier: 'standard',
      effect: { id: 'body' }
    }]
  });
  const customSpoken = await say(customRun.saveId, 'drink Ironwood Elixir');
  check(errorsOf(customSpoken.body).length === 0, 'uniqueId instance was consumed: ' + JSON.stringify(customSpoken.body.events).slice(0, 200));
  check(qty(customRun.saveId, 'brew_custom_42') === 0, 'custom instance count dropped to 0');
});

await test('an empty pack refuses identically and never goes negative', async () => {
  const { saveId } = await stage({ inventory: [] });
  const clicked = await button(saveId, 'potion_healing');
  check(errorsOf(clicked.body).length === 1, 'button refuses a missing item');
  const spoken = await say(saveId, 'drink a potion');
  check(errorsOf(spoken.body).length >= 1, 'sentence refuses a missing item: ' + JSON.stringify(spoken.body.events).slice(0, 220));
  const inventory = store.getSave(saveId).character.inventory || [];
  check(inventory.every(i => i.qty >= 0), 'no inventory entry went negative: ' + JSON.stringify(inventory));
  const only = await stage({ inventory: [{ itemId: 'potion_healing', qty: 1 }] });
  const first = await say(only.saveId, 'drink a potion');
  check(errorsOf(first.body).length === 0, 'the last vial is drinkable');
  check(qty(only.saveId, 'potion_healing') === 0, 'it is gone after one drink');
  const second = await say(only.saveId, 'drink a potion');
  check(errorsOf(second.body).length >= 1, 'a third drink from an empty pack is refused');
  check(qty(only.saveId, 'potion_healing') === 0, 'the count never drops below zero');
});

await test('repeat submissions cost exactly one action for button and sentence alike', async () => {
  const { saveId } = await stage({ inventory: [{ itemId: 'potion_healing', qty: 3 }] });
  const one = await button(saveId, 'potion_healing');
  check(errorsOf(one.body).length === 0, 'first click succeeded: ' + JSON.stringify(one.body.events).slice(0, 200));
  const two = await button(saveId, 'potion_healing');
  check(errorsOf(two.body).length === 1, 'second click refused by the economy');
  const three = await say(saveId, 'drink a potion');
  check(errorsOf(three.body).length >= 1, 'a sentence after those clicks is refused too');
  check(qty(saveId, 'potion_healing') === 2, 'exactly one vial was spent for the whole exchange');

  const spoken = await stage({ inventory: [{ itemId: 'potion_healing', qty: 3 }] });
  const saidOnce = await say(spoken.saveId, 'drink a potion');
  check(errorsOf(saidOnce.body).length === 0, 'the first sentence worked');
  const saidTwice = await say(spoken.saveId, 'drink a potion');
  check(errorsOf(saidTwice.body).length >= 1, 'the repeated sentence is refused');
  const clickedAfter = await button(spoken.saveId, 'potion_healing');
  check(errorsOf(clickedAfter.body).length === 1, 'the button agrees the slot is gone');
  check(qty(spoken.saveId, 'potion_healing') === 2, 'the sentence also cost exactly one vial');
});

await test('one sentence carries at most one core action', async () => {
  const { saveId, monsterId } = await stage({ inventory: [{ itemId: 'potion_healing', qty: 2 }] });
  const before = store.getSave(saveId);
  const monsterHp = (before.entities.find(e => e.id === monsterId) || {}).hp;
  const compound = await say(saveId, 'drink a potion and then attack the monster');
  check(qty(saveId, 'potion_healing') === 1, 'the first action of the sentence ran');
  check(store.getSave(saveId).combat.actionUsed === false, 'the second action of the sentence did not sneak through');
  const after = store.getSave(saveId).entities.find(e => e.id === monsterId);
  check(after.hp === monsterHp, 'the monster is untouched by the dropped half: ' + monsterHp + ' -> ' + after.hp);
  check((compound.body.events || []).some(e => e.type === 'info' || e.type === 'clarification'), 'the hero is told only one action fits: ' + JSON.stringify(compound.body.events.map(e => e.type)));

  const zh = await stage({ inventory: [{ itemId: 'potion_healing', qty: 2 }] });
  const zhCompound = await say(zh.saveId, '喝药水然后攻击怪物', 'zh-CN');
  check(qty(zh.saveId, 'potion_healing') === 1, 'the Chinese compound sentence ran only its first action');
  check(zhCompound.body.events.some(e => e.type === 'info' || e.type === 'clarification'), 'and says so in the request language');
});

await test('legacy English commands still route through the same executor', async () => {
  for (const phrase of ['quaff a potion', 'use potion', 'heal me', 'drink my healing potion']) {
    const { saveId } = await stage({ inventory: [{ itemId: 'potion_healing', qty: 1 }] });
    const res = await say(saveId, phrase);
    const errors = errorsOf(res.body);
    check(errors.length === 0, '"' + phrase + '" still works: ' + JSON.stringify(res.body.events).slice(0, 220));
    check(qty(saveId, 'potion_healing') === 0, '"' + phrase + '" spent the vial');
    check(heroHp(saveId) > 1, '"' + phrase + '" healed through the executor');
    check(store.getSave(saveId).combat.bonusUsed === true, '"' + phrase + '" paid the bonus action');
  }
});

await test('attack button and attack sentence share one turn and slot rule', async () => {
  const { saveId, monsterId } = await stage({ actionUsed: true });
  check(!!monsterId, 'the crypt run has a monster to fight');
  const clicked = await api('POST', '/api/game/' + saveId + '/action', { type: 'attack', targetId: monsterId });
  check(errorsOf(clicked.body).length === 1, 'the button refused the spent action');
  const beforeHp = store.getSave(saveId).entities.find(e => e.id === monsterId).hp;
  const spoken = await say(saveId, 'attack the monster');
  check(errorsOf(spoken.body).length >= 1, 'the sentence refused it too: ' + JSON.stringify(spoken.body.events).slice(0, 240));
  const afterHp = store.getSave(saveId).entities.find(e => e.id === monsterId).hp;
  check(afterHp === beforeHp, 'neither path dealt damage with the action spent');
  check(spoken.body.events.concat(clicked.body.events).some(e => e.messageKey === 'content.actionUsed'), 'both name content.actionUsed');

  const fresh = await stage({});
  const swung = await say(fresh.saveId, 'attack the monster');
  check(errorsOf(swung.body).length === 0, 'on a free turn the sentence attacks: ' + JSON.stringify(swung.body.events).slice(0, 220));
  check(store.getSave(fresh.saveId).combat.actionUsed === true, 'and spends the action slot like the button would');
});

server.close();
try { fs.rmSync(temp, { recursive: true, force: true }); } catch {}

console.log(`\nSummary: ${passed} passed, ${failed} failed, ${assertions} assertions.\n`);
if (failed > 0) process.exit(1);
