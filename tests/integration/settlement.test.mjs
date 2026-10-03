// tests/integration/settlement.test.mjs
// T3 — one settlement per ended delve, over the REAL HTTP routes (in-process express):
//  - a replayed sync-delve returns the SAME receipt and never re-processes rewards
//  - purchases/level-ups made after settling survive the reopened old summary
//  - a failed roster write settles nothing and the retry processes exactly once
//  - a failed save-mirror write cannot fail the settle; the duplicate retry heals it
//  - wrong owner / missing save / not-ended / malformed saves are rejected with no rewards
//  - death → respawn → second death yields two settlements, each banked once
// T3a boundaries: a legacy death save without endSeq baselines to #1 and the next real
// end settles as #2; a failed mirror write cannot lose that baseline; a stale mirror is
// repaired to the current settle and later dedupes even without the roster receipt.
// The settlement identity is `<saveId>#<endSeq>` (endSeq is the engine's per-save end
// counter) — deliberately independent of `rev`, which narration writes keep bumping.
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

// isolated DATA_DIR — must be set BEFORE the first server module is required, so this
// suite can never touch real player saves or real LLM settings
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-dnd-t3-'));

const require = createRequire(import.meta.url);
const express = require('express');
const store = require('../../server/store.js');
const engine = require('../../server/game/engine.js');
const campaignMod = require('../../server/game/campaign.js');

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

// ---- in-process app with the real routes (no LLM: settlement is purely mechanical) ----
const app = express();
app.use(express.json());
app.use('/api/characters', require('../../server/routes/characters.js'));
app.use('/api/game', require('../../server/routes/game.js'));
app.use('/api/city', require('../../server/routes/city.js'));
const server = await new Promise(resolve => { const s = app.listen(0, () => resolve(s)); });
const BASE_URL = `http://localhost:${server.address().port}`;

async function api(method, p, body) {
  const res = await fetch(`${BASE_URL}${p}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, body: data };
}

async function createHero(name) {
  const res = await api('POST', '/api/characters', {
    name, species: 'human', className: 'fighter', background: 'soldier',
    baseScores: { str: 16, dex: 14, con: 14, int: 10, wis: 12, cha: 8 },
    bgPlus2: 'str', bgPlus1: 'con', skills: ['athletics', 'perception'],
    fightingStyle: 'defense', armorOption: 'chain_mail', weaponOption: 'sword_board'
  });
  if (res.status !== 200) throw new Error(`createHero failed: ${JSON.stringify(res.body)}`);
  return res.body;
}

async function startDelve(charId) {
  const res = await api('POST', '/api/game/start', { characterId: charId, bringAlly: false, difficulty: 'normal', mapId: 'crypt' });
  if (res.status !== 200) throw new Error(`startDelve failed: ${JSON.stringify(res.body)}`);
  return res.body;
}

// emulate the engine's end stamps on a live save (the engine stamps endSeq at each real
// transition; direct writes here stand in for walking to the campfire / dying in combat)
function forceEnd(saveId, mode, { lootGold = 0 } = {}) {
  const save = store.getSave(saveId);
  save.mode = mode;
  save.endSeq = (save.endSeq || 0) + 1;
  if (mode === 'victory') save.flags = { ...(save.flags || {}), victory: true };
  if (mode === 'over') {
    save.flags = { ...(save.flags || {}), failed: true };
    const p = save.entities.find(e => e.kind === 'player');
    p.alive = false; p.hp = 0;
  }
  if (lootGold) save.character.gold = lootGold;
  store.saveGame(save);
  return save;
}

// T3a — write a REAL legacy death shape: mode=over with the endSeq field never present.
// (forceEnd stamps endSeq, which is exactly the old-test gap the T2a/T3 review called out.)
function forceLegacyDeath(saveId, { lootGold = 0 } = {}) {
  const save = store.getSave(saveId);
  delete save.endSeq;
  save.mode = 'over';
  save.flags = { ...(save.flags || {}), failed: true };
  const p = save.entities.find(e => e.kind === 'player');
  p.alive = false; p.hp = 0;
  if (lootGold) save.character.gold = lootGold;
  store.saveGame(save);
  return save;
}

// the save exactly as it sits on disk — store.getSave migrates on read, which would hide
// whether the endSeq baseline really reached the file
function rawSave(saveId) {
  return JSON.parse(fs.readFileSync(path.join(process.env.DATA_DIR, 'saves', saveId + '.json'), 'utf8'));
}

function rosterOf(id) {
  return store.getCharacters().find(c => c.id === id);
}

console.log('\n--- Running Integration Tests: One Settlement & Return to Town (T3) ---');

try {
  await test('a replayed settle returns the same receipt, banks once, and ignores rev growth', async () => {
    const char = await createHero('T3 Once Hero');
    const delve = await startDelve(char.id);
    const delveId = delve.state.id;
    forceEnd(delveId, 'victory', { lootGold: 250 }); // deliberately WITHOUT endSeq: legacy pre-T3 shape → #1

    const first = await api('POST', '/api/city/sync-delve', { charId: char.id, delveStateId: delveId });
    assert(first.status === 200 && first.body.ok, 'the first settle succeeds');
    assert(first.body.duplicate === false, 'the first settle is not a duplicate');
    const r1 = first.body.receipt;
    assert(r1 && r1.id === `${delveId}#1`, `the receipt id is stable and rev-independent (${r1 && r1.id})`);
    assert(r1.mode === 'victory' && r1.mapId === 'crypt', 'the receipt records the end mode and map');
    const heroAfterFirst = rosterOf(char.id);
    assert(heroAfterFirst.delvesCompleted === 1, 'delvesCompleted counted exactly once');
    const relicAct = campaignMod.ACTS.find(a => a.id === 'relic');
    assert(heroAfterFirst.gold === 250 + (relicAct.reward ? relicAct.reward.gold : 0),
      `loot and campaign reward banked once (${heroAfterFirst.gold} gp)`);
    assert(heroAfterFirst.campaign.stage === 1, 'act 1 advanced');
    assert((heroAfterFirst.campaignLog || []).length === 1, 'the campaign log got one entry');
    assert(heroAfterFirst.settlements.length === 1, 'one receipt on the roster');
    const mirror = store.getSave(delveId).settled;
    assert(mirror && mirror.id === r1.id, 'the delve save mirrors the settled receipt');

    // rev keeps growing (narration/aux writes) — the settlement id must not care
    const beforeDupGold = rosterOf(char.id).gold;
    const live = store.getSave(delveId);
    store.saveGame(live); // rev +1, no new end
    store.saveGame(store.getSave(delveId)); // rev +2

    const again = await api('POST', '/api/city/sync-delve', { charId: char.id, delveStateId: delveId });
    assert(again.status === 200 && again.body.ok, 'the replayed settle succeeds');
    assert(again.body.duplicate === true, 'the replay is flagged as a duplicate');
    assert(again.body.receipt.id === r1.id, 'the SAME receipt comes back');
    const heroAfterDup = rosterOf(char.id);
    assert(heroAfterDup.delvesCompleted === 1, 'delvesCompleted not counted twice');
    assert(heroAfterDup.gold === beforeDupGold, 'gold not re-banked');
    assert(heroAfterDup.campaign.stage === 1 && (heroAfterDup.campaignLog || []).length === 1, 'the story did not advance twice');
    assert(heroAfterDup.settlements.length === 1, 'no extra receipt stored');
  });

  await test('purchases and a level-up made after settling survive the reopened old summary', async () => {
    const char = await createHero('T3 Shopper Hero');
    const delve = await startDelve(char.id);
    forceEnd(delve.state.id, 'victory', { lootGold: 400 });
    const settled = await api('POST', '/api/city/sync-delve', { charId: char.id, delveStateId: delve.state.id });
    assert(settled.body.duplicate === false, 'the delve settles once');

    // real town endpoints: buy two daggers, then take the level 2 the XP affords
    const buy = await api('POST', '/api/city/buy', { charId: char.id, itemId: 'dagger', qty: 2 });
    assert(buy.status === 200, `the purchase went through (${buy.body.error || 'ok'})`);
    const goldAfterTown = buy.body.char.gold;
    // read-modify-write the SAME array: a fresh getCharacters() would discard the mutation
    const roster = store.getCharacters();
    roster.find(c => c.id === char.id).xp = (engine.XP_THRESHOLDS[2] || 300) + 10;
    store.saveCharacters(roster);
    const lvl = await api('POST', `/api/characters/${char.id}/level-up`, { hpChoice: 'avg' });
    assert(lvl.status === 200 && lvl.body.char.level === 2, `the hero levelled up in town (${lvl.body.error || 'ok'})`);

    // the old summary reopens and re-syncs the OLD snapshot — nothing may roll back
    const reopen = await api('POST', '/api/city/sync-delve', { charId: char.id, delveStateId: delve.state.id });
    assert(reopen.body.duplicate === true, 'the reopened summary is a duplicate settle');
    const after = rosterOf(char.id);
    const daggers = (after.inventory || []).find(i => i.itemId === 'dagger');
    assert(daggers && daggers.qty === 2, 'the daggers bought after settling survived');
    assert(after.level === 2, 'the town level-up survived the old snapshot');
    assert(after.gold === goldAfterTown, `gold stayed at the post-purchase amount, the snapshot's ${400} gp did not come back (${after.gold} gp)`);
  });

  await test('a failed roster write settles nothing; the retry processes exactly once', async () => {
    const char = await createHero('T3 Diskfull Hero');
    const delve = await startDelve(char.id);
    forceEnd(delve.state.id, 'retreat', { lootGold: 120 });

    const orig = store.saveCharacters;
    store.saveCharacters = () => { throw new Error('disk full'); };
    let failedRes;
    try {
      failedRes = await api('POST', '/api/city/sync-delve', { charId: char.id, delveStateId: delve.state.id });
    } finally {
      store.saveCharacters = orig;
    }
    assert(failedRes.status === 500, `the failed write surfaces as HTTP 500 (got ${failedRes.status})`);
    const untouched = rosterOf(char.id);
    assert(!untouched.settlements || untouched.settlements.length === 0, 'no receipt was persisted');
    assert(!untouched.delvesCompleted, 'delvesCompleted untouched by the failed settle');
    assert(!store.getSave(delve.state.id).settled, 'the delve save was not marked settled');

    const retry = await api('POST', '/api/city/sync-delve', { charId: char.id, delveStateId: delve.state.id });
    assert(retry.status === 200 && retry.body.duplicate === false, 'the retry settles for real');
    const hero = rosterOf(char.id);
    assert(hero.delvesCompleted === 1 && hero.gold === 120, `the retry banked exactly once (${hero.delvesCompleted} delves, ${hero.gold} gp)`);
    const twice = await api('POST', '/api/city/sync-delve', { charId: char.id, delveStateId: delve.state.id });
    assert(twice.body.duplicate === true && twice.body.receipt.id === retry.body.receipt.id, 'and afterwards it dedupes like any settle');
  });

  await test('a failed save-mirror write cannot fail the settle; the duplicate retry heals the mirror', async () => {
    const char = await createHero('T3 Mirror Hero');
    const delve = await startDelve(char.id);
    forceEnd(delve.state.id, 'victory', { lootGold: 60 });

    const orig = store.saveGame;
    store.saveGame = () => { throw new Error('rename failed'); };
    let res;
    try {
      res = await api('POST', '/api/city/sync-delve', { charId: char.id, delveStateId: delve.state.id });
    } finally {
      store.saveGame = orig;
    }
    assert(res.status === 200 && res.body.duplicate === false, `the settle still succeeded (got ${res.status})`);
    assert(!store.getSave(delve.state.id).settled, 'the mirror really is missing');
    assert(rosterOf(char.id).delvesCompleted === 1, 'the roster receipt is the authority');

    const retry = await api('POST', '/api/city/sync-delve', { charId: char.id, delveStateId: delve.state.id });
    assert(retry.body.duplicate === true, 'the retry is a duplicate (same receipt)');
    assert(!!store.getSave(delve.state.id).settled, 'the duplicate retry healed the missing mirror');
    assert(rosterOf(char.id).delvesCompleted === 1, 'and banked nothing twice');
  });

  await test('a roster restored without its receipts dedupes from the save mirror and heals', async () => {
    const char = await createHero('T3 Backup Hero');
    const delve = await startDelve(char.id);
    forceEnd(delve.state.id, 'victory', { lootGold: 30 });
    await api('POST', '/api/city/sync-delve', { charId: char.id, delveStateId: delve.state.id });
    const before = rosterOf(char.id);

    // simulate a roster restored from an old backup: receipts gone, counters stay
    const chars = store.getCharacters();
    delete chars.find(c => c.id === char.id).settlements;
    store.saveCharacters(chars);

    const res = await api('POST', '/api/city/sync-delve', { charId: char.id, delveStateId: delve.state.id });
    assert(res.body.duplicate === true, 'the mirror proves the settle and dedupes');
    const hero = rosterOf(char.id);
    assert(hero.delvesCompleted === before.delvesCompleted && hero.gold === before.gold, 'no rewards were re-processed');
    assert(hero.settlements.length === 1, 'the receipt was healed back onto the roster');
  });

  await test('wrong owner, missing save, not-ended and malformed delves are rejected without rewards', async () => {
    const owner = await createHero('T3 Owner Hero');
    const stranger = await createHero('T3 Stranger Hero');
    const delve = await startDelve(owner.id);

    // cross-hero settle attempt
    const stolen = await api('POST', '/api/city/sync-delve', { charId: stranger.id, delveStateId: delve.state.id });
    assert(stolen.status === 403, `another hero's delve is refused (got ${stolen.status})`);
    assert(!rosterOf(stranger.id).delvesCompleted, 'the stranger gained nothing');

    // unknown save / unknown hero / missing id
    assert((await api('POST', '/api/city/sync-delve', { charId: owner.id, delveStateId: 'save_missing_123' })).status === 404, 'a missing delve save is a 404');
    assert((await api('POST', '/api/city/sync-delve', { charId: 'char_missing_123', delveStateId: delve.state.id })).status === 404, 'a missing hero is a 404');
    assert((await api('POST', '/api/city/sync-delve', { charId: owner.id })).status === 400, 'a settle without a delve id is refused');

    // still running → not settleable
    const early = await api('POST', '/api/city/sync-delve', { charId: owner.id, delveStateId: delve.state.id });
    assert(early.status === 400, `an ended delve is required (got ${early.status}: ${early.body.error})`);
    const midHero = rosterOf(owner.id);
    assert(!midHero.delvesCompleted && !midHero.settlements?.length, 'the refused settle wrote nothing');

    // malformed save (no hero snapshot) → clear error, not a 500
    const brokenPath = path.join(process.env.DATA_DIR, 'saves', 'save_t3_broken.json');
    fs.writeFileSync(brokenPath, JSON.stringify({ id: 'save_t3_broken', characterId: owner.id, mode: 'victory', mapId: 'crypt' }), 'utf8');
    const broken = await api('POST', '/api/city/sync-delve', { charId: owner.id, delveStateId: 'save_t3_broken' });
    assert(broken.status === 400 && /malformed/i.test(broken.body.error || ''), 'a malformed save is a clear 400');
    fs.unlinkSync(brokenPath);
  });

  await test('death → respawn → second death: two settlements, each banked exactly once', async () => {
    const char = await createHero('T3 Twice-Died Hero');
    const delve = await startDelve(char.id);
    const delveId = delve.state.id;

    forceEnd(delveId, 'over', { lootGold: 123 });
    const first = await api('POST', '/api/city/sync-delve', { charId: char.id, delveStateId: delveId });
    assert(first.status === 200 && first.body.receipt.id === `${delveId}#1`, `the first death settles as #1 (${first.body.receipt && first.body.receipt.id})`);
    assert(rosterOf(char.id).gold === 123 && rosterOf(char.id).delvesCompleted === 1, 'the first death banked once');

    // the real respawn flow still works after a settled death
    const respawn = await api('POST', `/api/game/${delveId}/action`, { type: 'respawn' });
    assert(respawn.status === 200 && respawn.body.state.mode === 'explore', 'the hero recovers at camp');
    assert(rosterOf(char.id).delvesCompleted === 1, 'respawning does not settle again');

    forceEnd(delveId, 'over', { lootGold: 456 }); // engine stamps endSeq=2 on the second death
    const second = await api('POST', '/api/city/sync-delve', { charId: char.id, delveStateId: delveId });
    assert(second.body.receipt.id === `${delveId}#2`, `the second death has its own receipt (${second.body.receipt.id})`);
    assert(second.body.duplicate === false, 'the second death is a fresh settlement');
    assert(rosterOf(char.id).delvesCompleted === 2 && rosterOf(char.id).gold === 456, 'the second death banked once too');
    assert(rosterOf(char.id).settlements.length === 2, 'both receipts are on the roster');
    // T4: the summary needs what this delve actually paid and where to go next
    assert(second.body.receipt.gains && second.body.receipt.gains.gold === 333,
      `the receipt records the real delta vs the pre-settle roster (${second.body.receipt.gains && second.body.receipt.gains.gold})`);
    assert(second.body.guidance && second.body.guidance.objective && second.body.guidance.primary,
      'the settle response carries the next-step guidance');

    const replay = await api('POST', '/api/city/sync-delve', { charId: char.id, delveStateId: delveId });
    assert(replay.body.duplicate === true && replay.body.receipt.id === `${delveId}#2`, 'replaying dedupes to the latest end');
    assert(rosterOf(char.id).delvesCompleted === 2, 'and nothing was counted again');
  });

  await test('T3a: a legacy death save without endSeq settles #1, then respawn+retreat settles #2', async () => {
    const char = await createHero('T3a Legacy Hero');
    const delve = await startDelve(char.id);
    const delveId = delve.state.id;
    forceLegacyDeath(delveId, { lootGold: 50 });
    assert(rawSave(delveId).endSeq === undefined, 'the fixture really lacks endSeq on disk');

    const first = await api('POST', '/api/city/sync-delve', { charId: char.id, delveStateId: delveId });
    assert(first.status === 200 && first.body.ok && first.body.duplicate === false, 'the legacy death settles once');
    assert(first.body.receipt.id === `${delveId}#1`, `the legacy end reads as #1 (${first.body.receipt.id})`);
    assert(rosterOf(char.id).delvesCompleted === 1 && rosterOf(char.id).gold === 50, 'the legacy death banked once');
    assert(rawSave(delveId).endSeq === 1, 'the settle stamped the endSeq baseline onto the save');
    assert(rawSave(delveId).settled && rawSave(delveId).settled.id === `${delveId}#1`, 'the mirror records #1');

    // real recovery, real new loot, real retreat: the engine must stamp the NEXT sequence
    const respawn = await api('POST', `/api/game/${delveId}/action`, { type: 'respawn' });
    assert(respawn.status === 200 && respawn.body.state.mode === 'explore', 'the hero recovers at camp');
    const live = store.getSave(delveId);
    live.character.gold = 67;
    live.character.inventory = [{ itemId: 'dagger', qty: 1 }];
    store.saveGame(live);
    const retreat = await api('POST', `/api/game/${delveId}/action`, { type: 'retreat' });
    assert(retreat.status === 200 && retreat.body.state.mode === 'retreat', 'the hero retreats for real');
    assert(retreat.body.state.endSeq === 2, `the second end stamped endSeq=2 (${retreat.body.state.endSeq})`);

    const second = await api('POST', '/api/city/sync-delve', { charId: char.id, delveStateId: delveId });
    assert(second.body.duplicate === false, 'the second end is NOT deduped against the legacy #1');
    assert(second.body.receipt.id === `${delveId}#2`, `the second end settles as #2 (${second.body.receipt.id})`);
    const hero = rosterOf(char.id);
    assert(hero.delvesCompleted === 2, 'delvesCompleted counted the second end');
    assert(hero.gold === 67, `the new loot banked (${hero.gold} gp)`);
    assert((hero.inventory || []).some(i => i.itemId === 'dagger'), 'the new item banked');
    assert(hero.settlements.length === 2, 'both receipts are on the roster');

    const replay = await api('POST', '/api/city/sync-delve', { charId: char.id, delveStateId: delveId });
    assert(replay.body.duplicate === true && replay.body.receipt.id === `${delveId}#2`, 'replaying #2 dedupes');
    assert(rosterOf(char.id).delvesCompleted === 2 && rosterOf(char.id).gold === 67, 'and banks nothing twice');
  });

  await test('T3a: a legacy save whose first mirror write fails recovers to #2, never a reused #1', async () => {
    const char = await createHero('T3a Legacy Diskfull Hero');
    const delve = await startDelve(char.id);
    const delveId = delve.state.id;
    forceLegacyDeath(delveId, { lootGold: 40 });

    const orig = store.saveGame;
    store.saveGame = () => { throw new Error('rename failed'); };
    let first;
    try {
      first = await api('POST', '/api/city/sync-delve', { charId: char.id, delveStateId: delveId });
    } finally {
      store.saveGame = orig;
    }
    assert(first.status === 200 && first.body.duplicate === false, 'the settle succeeded on the roster alone');
    assert(first.body.receipt.id === `${delveId}#1`, `the legacy death is #1 (${first.body.receipt.id})`);
    assert(!rawSave(delveId).settled, 'the mirror really is missing');
    assert(rawSave(delveId).endSeq === undefined, 'the baseline write failed together with the mirror');
    assert(rosterOf(char.id).delvesCompleted === 1, 'the roster receipt is the authority');

    // the recovery settle heals the mirror AND re-baselines the counter from the receipt
    const retry = await api('POST', '/api/city/sync-delve', { charId: char.id, delveStateId: delveId });
    assert(retry.body.duplicate === true, 'the retry dedupes from the roster receipt');
    assert(rawSave(delveId).endSeq === 1, 'the baseline reached the save during the heal');
    assert(rawSave(delveId).settled && rawSave(delveId).settled.id === `${delveId}#1`, 'the mirror was healed');

    // a real respawn + retreat must stamp the NEXT sequence — never reuse #1
    const respawn = await api('POST', `/api/game/${delveId}/action`, { type: 'respawn' });
    assert(respawn.status === 200 && respawn.body.state.mode === 'explore', 'the hero recovers at camp');
    const retreat = await api('POST', `/api/game/${delveId}/action`, { type: 'retreat' });
    assert(retreat.body.state.endSeq === 2, `the recovery end stamped #2 (${retreat.body.state.endSeq})`);
    const second = await api('POST', '/api/city/sync-delve', { charId: char.id, delveStateId: delveId });
    assert(second.body.duplicate === false && second.body.receipt.id === `${delveId}#2`, 'the recovered end settles as a fresh #2');
    assert(rosterOf(char.id).delvesCompleted === 2, 'and banked exactly once more');
  });

  await test('T3a: a stale #1 mirror is repaired to #2 and later dedupes without the roster receipt', async () => {
    const char = await createHero('T3a Stale Mirror Hero');
    const delve = await startDelve(char.id);
    const delveId = delve.state.id;
    forceEnd(delveId, 'over', { lootGold: 100 }); // engine-shaped #1
    const first = await api('POST', '/api/city/sync-delve', { charId: char.id, delveStateId: delveId });
    assert(first.body.receipt.id === `${delveId}#1`, 'the first death settled as #1');

    const respawn = await api('POST', `/api/game/${delveId}/action`, { type: 'respawn' });
    assert(respawn.status === 200, 'the hero recovers at camp');
    forceEnd(delveId, 'over', { lootGold: 160 }); // endSeq=2

    // the #2 settle: the roster write succeeds, the mirror write fails → the save keeps #1
    const orig = store.saveGame;
    store.saveGame = () => { throw new Error('rename failed'); };
    let second;
    try {
      second = await api('POST', '/api/city/sync-delve', { charId: char.id, delveStateId: delveId });
    } finally {
      store.saveGame = orig;
    }
    assert(second.status === 200 && second.body.duplicate === false, 'the #2 settle persisted on the roster');
    assert(rosterOf(char.id).delvesCompleted === 2 && rosterOf(char.id).gold === 160, 'the second death banked');
    assert(rawSave(delveId).settled && rawSave(delveId).settled.id === `${delveId}#1`, 'the mirror is genuinely stale (#1)');

    // the retry repairs the stale mirror to the current settle
    const retry = await api('POST', '/api/city/sync-delve', { charId: char.id, delveStateId: delveId });
    assert(retry.body.duplicate === true && retry.body.receipt.id === `${delveId}#2`, 'the retry dedupes to #2');
    assert(rawSave(delveId).settled.id === `${delveId}#2`, 'the stale mirror was repaired to #2');

    // purchases made after settling must survive every later duplicate (incl. the heal)
    const buy = await api('POST', '/api/city/buy', { charId: char.id, itemId: 'dagger', qty: 1 });
    assert(buy.status === 200, `the post-settle purchase went through (${buy.body.error || 'ok'})`);
    const goldAfterBuy = rosterOf(char.id).gold;

    // a roster restored without its receipts dedupes from the healed mirror — no re-bank
    const roster = store.getCharacters();
    delete roster.find(c => c.id === char.id).settlements;
    store.saveCharacters(roster);

    const after = await api('POST', '/api/city/sync-delve', { charId: char.id, delveStateId: delveId });
    assert(after.body.duplicate === true && after.body.receipt.id === `${delveId}#2`, 'the healed mirror proves #2');
    const hero = rosterOf(char.id);
    assert(hero.delvesCompleted === 2, 'delvesCompleted did not increase');
    assert(hero.gold === goldAfterBuy, `the purchase gold was not rolled back (${hero.gold} vs ${goldAfterBuy})`);
    assert((hero.inventory || []).some(i => i.itemId === 'dagger'), 'the purchased dagger survived');
    assert(hero.settlements.length === 1 && hero.settlements[0].id === `${delveId}#2`, 'the missing receipt was healed back onto the roster');
    assert(after.body.guidance && after.body.guidance.stage === 'preparing',
      'a replayed settle still carries the next-step guidance for the summary');
  });

  // ---- T4a: the guidance must match the engine's actual adjudication ----
  // stage-2 fixture (relic + vault key done, three clues pending), a REAL howling-hills
  // delve with the boss pre-killed so no RNG combat can interfere, and REAL movement,
  // retreat and settle routes deciding the outcome.
  async function stage2HillsHero(name) {
    const char = await createHero(name);
    const roster = store.getCharacters();
    const camp = campaignMod.advance(
      campaignMod.advance(campaignMod.newCampaign(), 'crypt').campaign,
      'drowned-vault'
    ).campaign;
    roster.find(c => c.id === char.id).campaign = camp;
    store.saveCharacters(roster);
    const delve = await api('POST', '/api/game/start', { characterId: char.id, bringAlly: false, difficulty: 'normal', mapId: 'howling-hills' });
    const delveId = delve.body.state.id;
    // controlled fixture: the warboss is already dead, no wandering encounters, loot carried
    const save = store.getSave(delveId);
    save.entities.filter(e => e.kind === 'monster').forEach(m => { m.alive = false; m.hp = 0; });
    if (save.world && save.world['howling-hills']) {
      save.world['howling-hills'].ents.filter(e => e.kind === 'monster').forEach(m => { m.alive = false; });
    }
    save.objects.forEach(o => { if (o.type === 'trap') { o.disarmed = true; o.revealed = true; } });
    save.flags = { ...(save.flags || {}), wanders: 2 };
    save.character.gold = 77;
    store.saveGame(save);
    return { char, delveId };
  }

  await test('T4a: walking to the campfire as guided really wins and advances the story', async () => {
    const { char, delveId } = await stage2HillsHero('T4a Victory Hero');
    const camp = (await api('GET', `/api/game/${delveId}`)).body.state.map.victory.campfire;

    // the goal-reached copy sends the player to the CAMPFIRE (the engine's victory tile),
    // never to the entrance retreat
    const view = (await api('GET', `/api/game/${delveId}`)).body.state;
    assert(view.guidance.stage === 'objective', 'the payload reports the goal-reached stage');
    assert(/营火|营地/.test(view.guidance.objective) && /胜利/.test(view.guidance.objective),
      `the objective names the campfire victory (${view.guidance.objective})`);
    assert(!/入口撤退|撤退回城/.test(view.guidance.objective), 'the copy no longer sells the entrance retreat as completion');

    const before = rosterOf(char.id);
    const move = await api('POST', `/api/game/${delveId}/action`, { type: 'move', x: camp.x, y: camp.y });
    assert(move.status === 200 && move.body.state.mode === 'victory',
      `standing on the campfire fires the real victory (${move.body.state && move.body.state.mode})`);
    assert(move.body.state.endSeq === 1, 'the engine stamped the settleable end');

    const settle = await api('POST', '/api/city/sync-delve', { charId: char.id, delveStateId: delveId });
    assert(settle.body.duplicate === false, 'the victory settles once');
    assert(settle.body.receipt.campaignAdvanced === true, 'the story really advanced');
    const hero = rosterOf(char.id);
    assert(hero.campaign.acts.clues.hills === true && hero.campaign.stage === 2, 'the hills clue is on the roster');
    assert(hero.delvesCompleted === 1, 'counted once');
    assert(settle.body.receipt.gains.gold === 77 - (before.gold || 0),
      `the receipt gains reflect the real delta (${settle.body.receipt.gains.gold})`);
    assert(settle.body.guidance.primary.mapId === 'sewers',
      `the next recommendation is the remaining clue (${settle.body.guidance.primary.mapId})`);
  });

  await test('T4a: an early retreat at the entrance banks loot but never advances the story', async () => {
    const { char, delveId } = await stage2HillsHero('T4a Early Retreat Hero');
    const view = (await api('GET', `/api/game/${delveId}`)).body.state;
    assert(view.guidance.stage === 'objective' && !/入口撤退|撤退回城/.test(view.guidance.objective),
      'the goal-reached guidance does not point at the entrance retreat');

    const retreat = await api('POST', `/api/game/${delveId}/action`, { type: 'retreat' });
    assert(retreat.status === 200 && retreat.body.state.mode === 'retreat', 'the early retreat is still available');
    const settle = await api('POST', '/api/city/sync-delve', { charId: char.id, delveStateId: delveId });
    assert(settle.body.duplicate === false && settle.body.receipt.mode === 'retreat', 'the retreat settles its loot');
    const hero = rosterOf(char.id);
    assert(hero.delvesCompleted === 1 && hero.gold === 77, `the loot banked (${hero.gold} gp)`);
    assert(settle.body.receipt.campaignAdvanced === false, 'the retreat did NOT advance the story');
    assert(hero.campaign.acts.clues.hills === false && hero.campaign.stage === 2, 'no clue appeared');
    assert(settle.body.guidance.primary.mapId === 'howling-hills',
      `the next recommendation honestly retries the same map (${settle.body.guidance.primary.mapId})`);
  });

  await test('T4a: a cleared fetch delve is not a victory until the relic reaches the campfire', async () => {
    const char = await createHero('T4a Cleared Hero');
    const delve = await startDelve(char.id);
    const delveId = delve.state.id;
    const save = store.getSave(delveId);
    save.entities.filter(e => e.kind === 'monster').forEach(m => { m.alive = false; m.hp = 0; });
    if (save.world && save.world.crypt) save.world.crypt.ents.filter(e => e.kind === 'monster').forEach(m => { m.alive = false; });
    save.objects.forEach(o => { if (o.type === 'trap') { o.disarmed = true; o.revealed = true; } });
    save.flags = { ...(save.flags || {}), wanders: 2 };
    store.saveGame(save);

    const view = (await api('GET', `/api/game/${delveId}`)).body.state;
    assert(view.guidance.stage === 'cleared', 'all monsters dead without the goal reads as cleared');
    assert(!/胜利！/.test(view.guidance.objective) && /继续探索|主动撤退/.test(view.guidance.objective),
      `the cleared copy does not claim victory (${view.guidance.objective})`);

    const camp = view.objects.find(o => o.id === 'campfire');
    const move = await api('POST', `/api/game/${delveId}/action`, { type: 'move', x: camp.x, y: camp.y });
    assert(move.body.state.mode === 'explore', 'standing on the campfire without the relic is NOT a victory');
    const retreat = await api('POST', `/api/game/${delveId}/action`, { type: 'retreat' });
    assert(retreat.body.state.mode === 'retreat', 'the cleared delve can still be left by retreat');
    const settle = await api('POST', '/api/city/sync-delve', { charId: char.id, delveStateId: delveId });
    assert(settle.body.receipt.campaignAdvanced === false, 'and the story stays put');
  });

  await test('a weekly trial win is recorded once per settlement', async () => {
    const char = await createHero('T3 Weekly Hero');
    const delve = await startDelve(char.id);
    const save = store.getSave(delve.state.id);
    save.mode = 'victory';
    save.endSeq = 1;
    save.weeklyLabel = engine.weeklyInfo().label;
    save.flags = { ...(save.flags || {}), victory: true };
    save.stats = { ...(save.stats || {}), kills: 4, rounds: 12 };
    store.saveGame(save);

    const first = await api('POST', '/api/city/sync-delve', { charId: char.id, delveStateId: delve.state.id });
    assert(first.body.receipt.weeklyWin === true, 'the receipt records the weekly win');
    assert(rosterOf(char.id).weekly && rosterOf(char.id).weekly.wins === 1, 'the weekly tally counted one win');
    await api('POST', '/api/city/sync-delve', { charId: char.id, delveStateId: delve.state.id });
    assert(rosterOf(char.id).weekly.wins === 1, 'the replayed settle did not count again');
  });

} finally {
  await new Promise(r => server.close(r));
  try { fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true }); } catch {}
}

console.log(`\nSettlement Contract Summary: ${passed} passed, ${failed} failed.\n`);
if (failed > 0) process.exit(1);
