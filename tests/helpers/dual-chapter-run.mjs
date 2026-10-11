// tests/helpers/dual-chapter-run.mjs
// One real playthrough of the starter adventure's chapter shapes, reused by the review
// regressions for a cloned draft (playtest snapshot), for the same clone installed in a fresh
// data environment, and for the shipped pack. Nothing here grants items, forces an ending or
// rewrites story state: the hero walks to each speaker, pays the toll, brings aid to the courier,
// reports with the ledger it actually earned and walks home to the campfire. Only survivability
// and one persuasion roll are pinned, so attack-roll RNG can never decide a regression result.

function sceneNamed(state, suffix) {
  const found = (state.map.scenes || []).find(s => s.id === suffix || s.id.endsWith('_' + suffix));
  if (!found) throw new Error('Scene "' + suffix + '" is missing from ' + state.mapId + ': ' + (state.map.scenes || []).map(s => s.id).join(', '));
  return found;
}

function speakerOf(ctx, state, scene) {
  const speaker = ctx.engine.sceneSpeaker(state, scene);
  if (!speaker) throw new Error('Scene ' + scene.id + ' has no speaker on ' + state.mapId);
  return speaker;
}

/** Walk onto any free tile beside the speaker. */
export async function standAdjacent(ctx, saveId, entity) {
  const { store } = ctx;
  const rows = store.getSave(saveId).map.rows;
  const spot = [[0, -1], [0, 1], [-1, 0], [1, 0], [0, 0]]
    .map(([dx, dy]) => ({ x: entity.x + dx, y: entity.y + dy }))
    .find(p => rows[p.y] && rows[p.y][p.x] !== '#');
  if (!spot) throw new Error('No walkable tile beside ' + entity.id + ' at (' + entity.x + ',' + entity.y + ')');
  return walkTo(ctx, saveId, spot.x, spot.y);
}

/** Walk the hero to (x, y) with real move actions; fight anything that blocks the way. */
export async function walkTo(ctx, saveId, x, y) {
  const { api, store, engine, log } = ctx;
  for (let step = 0; step < 120; step++) {
    const state = store.getSave(saveId);
    if (state.mode === 'victory' || state.mode === 'over') return state;
    const p = engine.playerEntity(state);
    if (p.x === x && p.y === y) return state;
    const blocker = (state.entities || []).find(e => e.kind === 'monster' && e.alive !== false && !e.fled && engine.manhattan(e, p) <= 1);
    if (state.mode === 'combat' && state.combat.order[state.combat.turnIdx]?.id !== 'player') {
      await api('POST', '/api/game/' + saveId + '/action', { type: 'endTurn' });
      continue;
    }
    if (state.mode === 'combat' && blocker) {
      await api('POST', '/api/game/' + saveId + '/action', { type: 'attack', targetId: blocker.id });
      continue;
    }
    const before = p.x + ',' + p.y;
    const res = await api('POST', '/api/game/' + saveId + '/action', { type: 'move', x, y });
    if (res.status !== 200) throw new Error('move to (' + x + ',' + y + ') refused: ' + res.status + ' ' + JSON.stringify(res.body).slice(0, 220));
    const after = engine.playerEntity(res.body.state);
    if (after.x + ',' + after.y === before) log('  - move toward (' + x + ',' + y + ') held at ' + before + ' [' + (res.body.events || []).map(e => e.type).join(',') + ']');
  }
  const stuck = engine.playerEntity(store.getSave(saveId));
  throw new Error('Hero never reached (' + x + ',' + y + '); it stopped at (' + stuck.x + ',' + stuck.y + ') in mode ' + store.getSave(saveId).mode);
}

export async function choose(ctx, saveId, sceneId, choiceId) {
  const { api } = ctx;
  const res = await api('POST', '/api/game/' + saveId + '/action', { type: 'sceneChoice', sceneId, choiceId });
  if (res.status !== 200) throw new Error('sceneChoice ' + sceneId + '/' + choiceId + ' refused: ' + res.status + ' ' + JSON.stringify(res.body).slice(0, 240));
  const error = (res.body.events || []).find(e => e.type === 'error');
  if (error) throw new Error('sceneChoice ' + sceneId + '/' + choiceId + ' errored: ' + JSON.stringify(error).slice(0, 240));
  return res.body.state;
}

function pinSurvival(ctx, saveId) {
  const state = ctx.store.getSave(saveId);
  const hero = ctx.engine.playerEntity(state);
  hero.hp = hero.hpMax = 9999;
  ctx.store.saveGame(state);
}

function finishAtCampfire(ctx, saveId, assert) {
  const campAt = (ctx.store.getSave(saveId).map.victory || {}).campfire;
  assert(!!campAt, 'the chapter declares a campfire to walk home to');
  return campAt;
}

/**
 * Chapter 1 (the sealed bridge): toll, courier's ledger, verdict, campfire.
 * @param {{api:Function, store:any, engine:any, assert:Function, log:Function}} ctx
 * @param {string} saveId
 * @param {{doorId:string, ledgerItemId:string, testimonyChoice?:string, endingChoice?:string}} expectations
 */
export async function playCourierChapter(ctx, saveId, expectations) {
  const { store, engine, assert, log } = ctx;
  const opening = store.getSave(saveId);
  const crossing = sceneNamed(opening, 'crossing');
  const testimony = sceneNamed(opening, 'testimony');
  pinSurvival(ctx, saveId);

  await standAdjacent(ctx, saveId, speakerOf(ctx, opening, crossing));
  const crossed = await choose(ctx, saveId, crossing.id, 'pay_toll');
  const door = [].concat(crossed.objects || [], crossed.entities || []).find(o => o.id === expectations.doorId);
  assert(!!door && door.open === true, 'paying the toll opened the bridge door ' + expectations.doorId + ': ' + JSON.stringify(door).slice(0, 200));

  await standAdjacent(ctx, saveId, speakerOf(ctx, store.getSave(saveId), testimony));
  const heard = await choose(ctx, saveId, testimony.id, expectations.testimonyChoice || 'give_aid');
  const ledger = (heard.character.inventory || []).find(i => i.itemId === expectations.ledgerItemId && i.qty > 0);
  assert(!!ledger, 'the hero carries the ledger this chapter really granted (' + expectations.ledgerItemId + '); inventory ' + JSON.stringify(heard.character.inventory));
  log('  - granted ' + expectations.ledgerItemId + ' x' + ledger.qty);

  const verdict = sceneNamed(store.getSave(saveId), 'reckoning');
  await standAdjacent(ctx, saveId, speakerOf(ctx, store.getSave(saveId), verdict));
  const availability = verdict.choices.map(c => ({ id: c.id, blocked: engine.sceneChoiceStatus(store.getSave(saveId), verdict, c).text || null }));
  assert(availability.every(a => !a.blocked), 'every ending is selectable with the earned ledger: ' + JSON.stringify(availability));

  const wanted = expectations.endingChoice || 'report';
  const decided = await choose(ctx, saveId, verdict.id, wanted);
  const fact = (decided.encounterFacts || []).filter(f => f.sceneId === verdict.id).pop();
  assert(!!fact && !!fact.ending, 'the ending fact was recorded: ' + JSON.stringify(decided.encounterFacts).slice(0, 260));

  const campAt = finishAtCampfire(ctx, saveId, assert);
  await walkTo(ctx, saveId, campAt.x, campAt.y);
  const home = store.getSave(saveId);
  assert(home.mode === 'victory', 'the chapter ends in a real campfire victory; mode is ' + home.mode);
  return { state: home, ending: fact.ending, availability };
}

/**
 * Chapter 2 (the river post): pass, testimony, verdict, campfire.
 * @param {{api:Function, store:any, engine:any, assert:Function, log:Function}} ctx
 * @param {string} saveId
 * @param {{endingChoice?:string}} [expectations]
 */
export async function playRiverPostChapter(ctx, saveId, expectations = {}) {
  const { store, engine, assert } = ctx;
  const gate = sceneNamed(store.getSave(saveId), 'post_gate');
  pinSurvival(ctx, saveId);

  await standAdjacent(ctx, saveId, speakerOf(ctx, store.getSave(saveId), gate));
  const passed = await choose(ctx, saveId, gate.id, 'show_pass');
  assert(passed.encounterFacts.some(f => f.choiceId === 'show_pass'), 'the pass was shown and remembered');

  const dispute = sceneNamed(store.getSave(saveId), 'storehouse_dispute');
  await standAdjacent(ctx, saveId, speakerOf(ctx, store.getSave(saveId), dispute));
  // The persuasion DC is part of the chapter; the roll is not what this regression is about.
  const boosted = store.getSave(saveId);
  boosted.character.abilities.cha = 50;
  ctx.store.saveGame(boosted);
  const cited = await choose(ctx, saveId, dispute.id, 'cite_records');
  assert(cited.encounterFacts.some(f => f.choiceId === 'cite_records'), 'the testimony scene recorded its choice');

  const verdict = sceneNamed(store.getSave(saveId), 'final_verdict');
  await standAdjacent(ctx, saveId, speakerOf(ctx, store.getSave(saveId), verdict));
  const wanted = expectations.endingChoice || 'choice_lawful_order';
  const blocked = engine.sceneChoiceStatus(store.getSave(saveId), verdict, verdict.choices.find(c => c.id === wanted));
  assert(!blocked.text, wanted + ' is available to this hero: ' + JSON.stringify(blocked));
  const decided = await choose(ctx, saveId, verdict.id, wanted);
  const fact = (decided.encounterFacts || []).filter(f => f.sceneId === verdict.id).pop();
  assert(!!fact && !!fact.ending, 'chapter 2 recorded its ending: ' + JSON.stringify(decided.encounterFacts).slice(0, 260));

  const campAt = finishAtCampfire(ctx, saveId, assert);
  await walkTo(ctx, saveId, campAt.x, campAt.y);
  const home = store.getSave(saveId);
  assert(home.mode === 'victory', 'chapter 2 ends in a real campfire victory; mode is ' + home.mode);
  return { state: home, ending: fact.ending };
}
