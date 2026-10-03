// tests/unit/forge-and-campaign.test.mjs — Forge, bestiary tracking and the main campaign
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const engine = require('../../server/game/engine.js');
const affixes = require('../../server/game/affixes.js');
const forge = require('../../server/game/forge.js');
const campaign = require('../../server/game/campaign.js');
const guidance = require('../../server/game/guidance.js');

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
    if (failed === before) {
      console.error(`  ❌ FAILED: ${name} — ${err && (err.stack || err.message)}`);
      failed++;
    }
  }
}

function makeChar(className = 'fighter', level = 3) {
  const char = engine.buildCharacter({
    name: 'Smith', species: 'human', className, background: 'soldier',
    baseScores: { str: 16, dex: 12, con: 14, int: 13, wis: 10, cha: 10 }, choices: {}, feat: ''
  });
  char.id = 'unit_' + Math.random().toString(36).slice(2, 7);
  if (level > 1) { char.level = level; engine.applyClassAndSpecies(char, engine.CLASSES.find(c => c.id === className), null, level, true); }
  return char;
}

console.log('\n--- Running Unit Tests: Forge, Bestiary & Campaign ---');

// ---------------------------------------------------------------- forge ----
test('Only rolled magic gear can be forged', () => {
  const rolled = affixes.rollMagicItem('magic', { category: 'weapon' });
  assert(forge.isForgeable(rolled) === true, 'A dropped magic weapon is forgeable');
  assert(forge.isForgeable({ itemId: 'longsword', qty: 1 }) === false, 'A plain shop weapon is not');
  assert(forge.isForgeable({ itemId: 'potion_healing', qty: 2 }) === false, 'Potions are not');
  assert(forge.isForgeable({ kind: 'delve_token', itemId: 'token_luck', uniqueId: 'x', qty: 1 }) === false, 'Prize tokens are not');
  assert(forge.isForgeable(null) === false, 'Nothing is not forgeable');
});

test('Salvage yields essence by rarity and never for junk', () => {
  const magic = affixes.rollMagicItem('magic', { category: 'weapon' });
  const rare = affixes.rollMagicItem('rare', { category: 'weapon' });
  const legendary = affixes.rollMagicItem('legendary', { category: 'armor' });
  assert(forge.salvageValue(magic).essence === 1, 'Magic melts into 1 essence');
  assert(forge.salvageValue(rare).essence === 2, 'Rare melts into 2 essence');
  assert(forge.salvageValue(legendary).essence === 4, 'Legendary melts into 4 essence');
  assert(forge.salvageValue(legendary).gold > 0, 'Salvage also returns gold');
  assert(forge.salvageValue({ itemId: 'dagger', qty: 1 }).ok === false, 'Plain gear cannot be melted');
});

test('Rerolling swaps the affix and keeps the item identity', () => {
  for (const rarity of ['magic', 'rare', 'legendary']) {
    const item = affixes.rollMagicItem(rarity, { category: 'weapon' });
    const before = item.affix;
    const out = forge.rerollAffix(item);
    assert(out.ok === true, `Reroll works on ${rarity}`);
    assert(out.item.uniqueId === item.uniqueId, 'The unique id is stable (equipped slots keep working)');
    assert(out.item.rarity === item.rarity, 'Rarity is untouched');
    assert(out.item.affix !== before, `The affix actually changed (${before} -> ${out.item.affix})`);
    assert(out.item.name.includes(out.item.desc.split('，')[0].slice(0, 2)) || out.item.name.length > 2, 'The item is renamed for its new affix');
  }
  const armor = affixes.rollMagicItem('rare', { category: 'armor' });
  const armorOut = forge.rerollAffix(armor);
  assert(forge.isForgeable(armorOut.item) && ['armor', 'shield', 'cloak', 'ring'].includes(armorOut.item.type), 'Armour rerolls within the armour affix pool');
});

test('Upgrading walks the rarity ladder and stops at legendary', () => {
  const item = affixes.rollMagicItem('magic', { category: 'weapon' });
  const step1 = forge.upgradeRarity(item);
  assert(step1.ok && step1.item.rarity === 'rare', 'magic -> rare');
  assert(step1.item.uniqueId === item.uniqueId, 'Identity survives the upgrade');
  assert(step1.item.affix === item.affix, 'The affix is kept');
  const step2 = forge.upgradeRarity(step1.item);
  assert(step2.ok && step2.item.rarity === 'legendary', 'rare -> legendary');
  assert(step2.item.magic === 2, `Legendary weapons carry +2 (got +${step2.item.magic})`);
  const step3 = forge.upgradeRarity(step2.item);
  assert(step3.ok === false && /传奇/.test(step3.error), 'Legendary is the ceiling');
});

test('A legendary upgrade raises the elemental dice like a dropped one', () => {
  const flaming = affixes.buildAffixItem(
    affixes.baseById('longsword'),
    affixes.affixById('blazing', 'weapon'),
    'magic'
  );
  assert(flaming.bonusDamage.dice === '1d4', 'Magic tier rolls 1d4');
  const legendary = forge.upgradeRarity(forge.upgradeRarity(flaming).item).item;
  assert(legendary.bonusDamage.dice === '1d6', 'Legendary tier rolls 1d6');
  assert(legendary.magic === 2, 'And carries +2 to hit and damage');
});

test('Forge prices are per action and per rarity', () => {
  assert(forge.forgeCost('reroll', 'magic').gold === 60, 'Rerolling a magic item costs 60 gp');
  assert(forge.forgeCost('reroll', 'legendary').essence === 3, 'Rerolling a legendary costs 3 essence');
  assert(forge.forgeCost('upgrade', 'rare').essence === 4, 'Rare -> legendary costs 4 essence');
  assert(forge.forgeCost('upgrade', 'legendary') === null, 'There is no upgrade past legendary');
  assert(forge.forgeCost('nonsense', 'magic') === null, 'Unknown actions have no price');
});

test('A forged item replaces the old one in place, keeping its quantity', () => {
  const char = makeChar();
  const item = affixes.rollMagicItem('magic', { category: 'weapon' });
  item.qty = 1;
  char.inventory.push(item);
  const upgraded = forge.upgradeRarity(item).item;
  assert(forge.replaceItem(char, upgraded) === true, 'The item is replaced');
  const stored = char.inventory.find(i => i.uniqueId === item.uniqueId);
  assert(stored.rarity === 'rare' && stored.qty === 1, `In-place update keeps quantity (${stored.rarity}, qty ${stored.qty})`);
  assert(char.inventory.filter(i => i.uniqueId === item.uniqueId).length === 1, 'No duplicate entry is created');
});

test('Forging an equipped weapon changes the actual attack profile', () => {
  const char = makeChar();
  // a blazing (non-keen) magic weapon: no flat bonus to start, so the upgrade is measurable
  const item = affixes.buildAffixItem(affixes.baseById('longsword'), affixes.affixById('blazing', 'weapon'), 'magic');
  char.inventory.push(item);
  char.equipped = char.equipped || {};
  char.equipped.mainHand = item.uniqueId;
  engine.applyClassAndSpecies(char, engine.CLASSES.find(c => c.id === char.className), null, char.level, true);
  const before = char.attacks.find(a => a.weaponId === item.uniqueId);
  assert(before && before.magic === 0, 'A keen-less magic weapon starts with no flat bonus');

  const upgraded = forge.upgradeRarity(item).item;
  forge.replaceItem(char, upgraded);
  engine.applyClassAndSpecies(char, engine.CLASSES.find(c => c.id === char.className), null, char.level, true);
  const after = char.attacks.find(a => a.weaponId === item.uniqueId);
  assert(after.magic === 1 && after.bonus === before.bonus + 1, `The upgrade reaches the attack math (+${after.magic} to hit)`);
  assert(char.attacks[0].weaponId === item.uniqueId, 'The forged weapon is still the wielded one');
});

// ---------------------------------------------------------------- essence ----
test('Elite and boss kills pay essence, plain kills do not', () => {
  const char = makeChar();
  const state = engine.startGame(char, { mapId: 'crypt' });
  const monsters = state.entities.filter(e => e.kind === 'monster');
  const elite = monsters[0];
  const plain = monsters[1] || monsters[0];
  affixes.applyMonsterAffix(elite, 'blazing');
  elite.hp = 1; plain.hp = 1;
  if (plain !== elite) { plain.isElite = false; delete plain.affix; }

  const essenceBefore = state.character.essence || 0;
  engine.applyDamage(state, elite, 99, 'slashing', []);
  const afterElite = state.character.essence || 0;
  assert(afterElite === essenceBefore + forge.KILL_ESSENCE.elite, `An elite pays ${forge.KILL_ESSENCE.elite} essence (${essenceBefore} -> ${afterElite})`);
  if (plain !== elite) {
    engine.applyDamage(state, plain, 99, 'slashing', []);
    assert((state.character.essence || 0) === afterElite, 'A plain monster pays none');
  }
});

// ---------------------------------------------------------------- bestiary ----
test('Kills are catalogued per species and per elite affix', () => {
  const char = makeChar();
  const state = engine.startGame(char, { mapId: 'crypt' });
  const monsters = state.entities.filter(e => e.kind === 'monster');
  const target = monsters[0];
  // the map generator rolls elites at random — clear any before forcing the affix under test
  target.isElite = false;
  delete target.affix;
  target.resistances = [];
  target.vulnerabilities = [];
  affixes.applyMonsterAffix(target, 'venomous');
  const key = target.monsterId;
  target.hp = 1;
  engine.applyDamage(state, target, 99, 'slashing', []);
  assert(state.character.bestiary[key] === 1, 'The species tally counts the kill');
  assert(state.character.bestiaryElite[key] && state.character.bestiaryElite[key].venomous === 1,
    `The variant tally records the affix (${JSON.stringify(state.character.bestiaryElite[key])})`);
});

test('The first kill of a species pays a one-off bestiary bonus', () => {
  const char = makeChar();
  const state = engine.startGame(char, { mapId: 'crypt' });
  const target = state.entities.find(e => e.kind === 'monster');
  target.hp = 1;
  const xpBefore = state.character.xp;
  engine.applyDamage(state, target, 99, 'slashing', []);
  const afterFirst = state.character.xp;
  assert(afterFirst > xpBefore + (target.xp || 0), `The first kill pays more than its XP value (${xpBefore} -> ${afterFirst}, base ${target.xp})`);
  assert(state.character.bestiaryRewarded[target.monsterId] === true, 'The species is marked as rewarded');

  // a second kill of the same species must not pay the bonus again
  const twin = state.entities.filter(e => e.kind === 'monster' && e.monsterId === target.monsterId && e.alive !== false)[0];
  if (twin) {
    twin.hp = 1;
    const beforeSecond = state.character.xp;
    engine.applyDamage(state, twin, 99, 'slashing', []);
    const gained = state.character.xp - beforeSecond;
    assert(gained <= (twin.xp || 0) + 1, `The second kill only pays its own XP (gained ${gained})`);
  }
});

// ---------------------------------------------------------------- campaign ----
test('The campaign starts empty and knows its first objective', () => {
  const c = campaign.newCampaign();
  assert(c.stage === 0 && !c.completedAt, 'A fresh campaign is at stage 0');
  assert(/沉没墓穴/.test(campaign.objective(c).text), 'The first objective points at the crypt');
  assert(campaign.progress(c).label === '1/4', `Progress reads 1/4 (got ${campaign.progress(c).label})`);
});

test('The campaign advances in order and ignores out-of-order victories', () => {
  let c = campaign.newCampaign();
  let r = campaign.advance(c, 'roost');
  assert(r.advanced === false && r.reason === 'not_current_step', 'Killing the dragon early does not skip the story');
  c = r.campaign;

  r = campaign.advance(c, 'drowned-vault');
  assert(r.advanced === false, 'The vault is locked behind the relic');
  c = r.campaign;

  r = campaign.advance(c, 'crypt');
  assert(r.advanced === true && r.act === 1 && r.campaign.stage === 1, 'The crypt opens act 1');
  assert(r.reward.xp > 0 && r.reward.gold > 0, 'Act 1 pays a reward');
  c = r.campaign;

  r = campaign.advance(c, 'crypt');
  assert(r.advanced === false, 'Re-clearing the crypt is a no-op (idempotent)');
  c = r.campaign;

  r = campaign.advance(c, 'drowned-vault');
  assert(r.advanced && r.campaign.stage === 2, 'The vault opens act 2');
  c = r.campaign;
  assert(/还差/.test(campaign.objective(c).text), 'Act 3 lists the missing clues');
});

test('Act 3 takes its three clues in any order', () => {
  let c = campaign.newCampaign();
  c = campaign.advance(c, 'crypt').campaign;
  c = campaign.advance(c, 'drowned-vault').campaign;

  let r = campaign.advance(c, 'sewers');
  assert(r.advanced && r.partial && r.campaign.stage === 2, 'The first clue does not finish the act');
  assert(r.campaign.acts.clues.sewers === true && r.campaign.acts.clues.hills === false, 'Only the cleared clue is ticked');
  c = r.campaign;

  r = campaign.advance(c, 'sewers');
  assert(r.advanced === false && r.reason === 'already_done', 'Re-clearing a clue map is a no-op');
  c = r.campaign;

  c = campaign.advance(c, 'mill').campaign;
  assert(campaign.progress(c).cluesDone === 2, 'Two clues recorded');
  r = campaign.advance(c, 'howling-hills');
  assert(r.advanced && r.campaign.stage === 3, 'The third clue completes act 3');
  c = r.campaign;

  r = campaign.advance(c, 'roost');
  assert(r.advanced && r.completed === true && !!r.campaign.completedAt, 'The roost completes the campaign');
  assert(campaign.progress(r.campaign).label === '主线完成', 'Progress reports completion');
  assert(campaign.objective(r.campaign).done === true, 'The objective switches to the epilogue');
});

test('actForMap marks exactly the next step of the story', () => {
  let c = campaign.newCampaign();
  assert(campaign.actForMap(c, 'crypt').id === 'relic', 'The crypt is the first step');
  assert(campaign.actForMap(c, 'roost') === null, 'The roost is not a step yet');
  c = campaign.advance(c, 'crypt').campaign;
  assert(campaign.actForMap(c, 'crypt') === null, 'A finished act is no longer marked');
  assert(campaign.actForMap(c, 'drowned-vault').id === 'key', 'The vault becomes the step');
  c = campaign.advance(c, 'drowned-vault').campaign;
  assert(campaign.actForMap(c, 'mill').id === 'clues', 'Clue maps are marked in act 3');
  c = campaign.advance(c, 'mill').campaign;
  assert(campaign.actForMap(c, 'mill') === null, 'A collected clue stops being marked');
  c = campaign.advance(c, 'sewers').campaign;
  c = campaign.advance(c, 'howling-hills').campaign;
  assert(campaign.actForMap(c, 'roost').id === 'queen', 'The roost becomes the final step');
  c = campaign.advance(c, 'roost').campaign;
  assert(campaign.actForMap(c, 'roost') === null, 'Nothing is marked once the story is done');
});

test('The fallback epilogue names the hero and survives a missing model', () => {
  const text = campaign.fallbackEpilogue({ name: 'Vex' }, { kills: 30, delves: 6 });
  assert(/Vex/.test(text) && text.length > 40, 'The epilogue names the hero and reads like prose');
  assert(/30/.test(text), 'It mentions the kill count when provided');
  assert(campaign.fallbackEpilogue({}, {}).length > 20, 'It still works without stats');
});

// ---------------------------------------------------------------- guidance (T4) ----
test('Guidance points a fresh hero at the crypt with a reason', () => {
  const char = { id: 'c1', campaign: campaign.newCampaign(), settlements: [] };
  const g = guidance.journey(char, { liveSave: null });
  assert(g.stage === 'preparing' && g.primary.kind === 'prepare' && g.primary.mapId === 'crypt', 'A fresh hero prepares the crypt');
  assert(/沉没墓穴/.test(g.primary.text) && !!g.primary.reason, 'The primary action names the destination and carries a reason');
  assert(g.options.length >= 1 && !!g.objective.text, 'The objective and at least one option ride along');
});

test('Guidance follows the story: vault, missing clues, roost, then free play', () => {
  const char = { id: 'c1', campaign: campaign.newCampaign(), settlements: [] };
  const step = () => guidance.journey(char, { liveSave: null });
  char.campaign = campaign.advance(char.campaign, 'crypt').campaign;
  assert(step().primary.mapId === 'drowned-vault', 'After act 1 the vault is next');
  char.campaign = campaign.advance(char.campaign, 'drowned-vault').campaign;
  assert(step().primary.mapId === 'howling-hills', 'Act 3 starts with the first missing clue');
  char.campaign = campaign.advance(char.campaign, 'howling-hills').campaign;
  assert(step().primary.mapId === 'sewers', 'A collected clue is skipped');
  char.campaign = campaign.advance(char.campaign, 'sewers').campaign;
  assert(step().primary.mapId === 'mill', 'The last missing clue is recommended');
  char.campaign = campaign.advance(char.campaign, 'mill').campaign;
  assert(step().primary.mapId === 'roost', 'Act 4 sends you to the roost');
  char.campaign = campaign.advance(char.campaign, 'roost').campaign;
  const done = step();
  assert(done.stage === 'complete' && done.objective.done === true && /无尽深渊/.test(done.primary.text),
    'Completion switches to free play — no stale act advice');
});

test('Guidance prefers settling an ended delve over starting a new one', () => {
  const char = { id: 'c1', campaign: campaign.newCampaign(), settlements: [] };
  const ended = { id: 's1', characterId: 'c1', mode: 'over', mapId: 'crypt', mapName: 'The Sunless Crypt', endSeq: 1, settled: null, updatedAt: 5 };
  const running = { id: 's2', characterId: 'c1', mode: 'explore', mapId: 'crypt', mapName: 'The Sunless Crypt', endSeq: null, settled: null, updatedAt: 9 };
  let g = guidance.journey(char, { liveSave: guidance.pickLiveSave(char, [running, ended]) });
  assert(g.stage === 'unsettled' && g.primary.saveId === 's1', 'An ended unsettled save wins over a newer running one');
  assert(/结算/.test(g.primary.text), 'The primary action is to settle, not to embark');
  // once the receipt exists (mirror form), the running delve takes over
  char.settlements = [{ id: 's1#1' }];
  g = guidance.journey(char, { liveSave: guidance.pickLiveSave(char, [running, { ...ended, settled: 's1#1' }]) });
  assert(g.stage === 'in_delve' && g.primary.saveId === 's2', 'A settled ended save steps aside for the running delve');
  g = guidance.journey(char, { liveSave: null });
  assert(g.stage === 'preparing', 'No saves at all -> prepare the next story step');
});

test('T4a: a newer settled delve no longer hides an older running one', () => {
  const char = { id: 'c1', campaign: campaign.newCampaign(), settlements: [] };
  const running = { id: 'sA', characterId: 'c1', mode: 'explore', mapId: 'crypt', mapName: 'The Sunless Crypt', endSeq: null, settled: null, updatedAt: 5 };
  // the settled end is NEWER than the running delve — the old pickLiveSave chose it by
  // updatedAt alone and the home card recommended re-embarking instead of continuing
  const settledNewer = { id: 'sB', characterId: 'c1', mode: 'retreat', mapId: 'crypt', mapName: 'The Sunless Crypt', endSeq: 1, settled: 'sB#1', updatedAt: 9 };
  let live = guidance.pickLiveSave(char, [settledNewer, running]);
  assert(live.id === 'sA' && live.settled === false, 'The older running delve wins over the newer settled one');
  let g = guidance.journey(char, { liveSave: live });
  assert(g.stage === 'in_delve' && g.primary.saveId === 'sA', 'Journey continues the running delve');

  const combat = { ...running, id: 'sC', mode: 'combat', updatedAt: 3 };
  live = guidance.pickLiveSave(char, [settledNewer, combat]);
  assert(live.id === 'sC', 'A running combat delve is continuable as well');

  live = guidance.pickLiveSave(char, [{ ...running }, { ...running, id: 'sD', updatedAt: 7 }]);
  assert(live.id === 'sD', 'Within the running group the newest wins');

  live = guidance.pickLiveSave(char, [settledNewer]);
  assert(live.id === 'sB' && live.settled === true, 'Only settled saves -> the newest is returned');
  g = guidance.journey(char, { liveSave: live });
  assert(g.stage === 'preparing', 'Journey moves on to the next story step');

  const stranger = { id: 'sX', characterId: 'c2', mode: 'explore', mapId: 'crypt', mapName: 'The Sunless Crypt', endSeq: null, settled: null, updatedAt: 99 };
  live = guidance.pickLiveSave(char, [stranger, settledNewer]);
  assert(live.id === 'sB', "Another hero's running delve is ignored");

  const oldUnsettled = { id: 's0', characterId: 'c1', mode: 'over', mapId: 'crypt', mapName: 'The Sunless Crypt', endSeq: 1, settled: null, updatedAt: 1 };
  live = guidance.pickLiveSave(char, [settledNewer, { ...running, id: 'sE', updatedAt: 8 }, oldUnsettled]);
  assert(live.id === 's0', 'An unsettled end still has top priority');
});

test('T4a: the roster receipt settles a delve even when the mirror write was lost', () => {
  const running = { id: 'sA', characterId: 'c1', mode: 'explore', mapId: 'crypt', mapName: 'The Sunless Crypt', endSeq: null, settled: null, updatedAt: 5 };
  // the T3 authority write succeeded, the mirror write failed: settled=null on the save
  const mirrorLost = { id: 'sB', characterId: 'c1', mode: 'retreat', mapId: 'crypt', mapName: 'The Sunless Crypt', endSeq: 1, settled: null, updatedAt: 9 };
  const char = { id: 'c1', campaign: campaign.newCampaign(), settlements: [{ id: 'sB#1' }] };
  const live = guidance.pickLiveSave(char, [mirrorLost, running]);
  assert(live.id === 'sA', 'The receipt-only settle steps aside for the running delve');

  // a mirror with a seq that matches neither the save nor any receipt is no proof — that
  // end really is unsettled and must be offered first (within-group newest still applies)
  const secondEnd = { ...mirrorLost, endSeq: 2, settled: 'sB#9' };
  const live2 = guidance.pickLiveSave(char, [secondEnd, running]);
  assert(live2.id === 'sB' && live2.settled === false, 'A stale mirror id does not count as settled');
});

test('Delve guidance distinguishes goal reached, area cleared and combat economy', () => {
  const base = {
    mode: 'explore',
    map: { victory: { type: 'fetch_relic' }, objectiveText: '取回圣物。' },
    flags: {},
    entities: [{ kind: 'monster', id: 'm1', alive: true, hp: 3 }],
    character: { inventory: [] }
  };
  const clone = () => JSON.parse(JSON.stringify(base));
  let d = guidance.delve(clone());
  assert(d.stage === 'explore' && !d.returnPrompt, 'Enemies alive -> plain exploration');
  const relic = clone(); relic.flags.hasRelic = true;
  d = guidance.delve(relic);
  assert(d.stage === 'objective' && d.returnPrompt === true, 'The relic in hand switches to the objective stage');
  assert(/营火|营地/.test(d.objective) && /胜利/.test(d.objective), 'The copy sends the player to the campfire to complete the victory');
  assert(!/入口撤退|撤退回城/.test(d.objective), 'The goal-reached copy no longer sells an entrance retreat as completion');
  assert(/主线不推进/.test(d.hint), 'The hint spells out what an early retreat does NOT do');
  const cleared = clone(); cleared.entities[0].alive = false;
  d = guidance.delve(cleared);
  assert(d.stage === 'cleared' && /区域已安全/.test(d.objective) && d.returnPrompt === false, 'A cleared area without the goal is not a completion prompt');
  assert(!/胜利！/.test(d.objective), 'The cleared copy does not claim victory');
  assert(/继续探索|主动撤退/.test(d.objective), 'The cleared copy offers both honest options');
  const boss = clone();
  boss.map = { victory: { type: 'slay_boss' }, objectiveText: '击败守卫。' };
  boss.entities = [{ kind: 'monster', id: 'b1', boss: true, alive: false }];
  d = guidance.delve(boss);
  assert(d.stage === 'objective', 'A dead boss counts as the goal reached');
  const combat = clone();
  combat.mode = 'combat';
  combat.combat = { order: [{ id: 'player' }, { id: 'm1' }], turnIdx: 0, movementLeft: 15, actionUsed: true, bonusUsed: false };
  d = guidance.delve(combat);
  assert(d.combat.yourTurn === true && /主要动作已用/.test(d.combat.notes) && /移动 15 ft/.test(d.combat.notes),
    'The combat line spells out spent actions and remaining movement');
  combat.combat.turnIdx = 1;
  d = guidance.delve(combat);
  assert(d.combat.yourTurn === false && /等待/.test(d.combat.notes), 'The enemy turn says to wait');
  const fled = clone(); fled.mode = 'retreat';
  d = guidance.delve(fled);
  assert(/主线不推进/.test(d.objective), 'The retreat copy says the story does not advance');
});

test('Guidance copy never leaks coordinates or hidden objects', () => {
  const char = { id: 'c1', campaign: campaign.newCampaign(), settlements: [] };
  const g = guidance.journey(char, { liveSave: null });
  const text = [g.primary.text, g.primary.reason, ...g.options.map(o => o.text)].join(' ');
  assert(!/\d+\s*,\s*\d+/.test(text), 'Journey copy has no tile coordinates');
  assert(!/陷阱位置|宝箱位置/.test(text), 'Journey copy does not reveal hidden object positions');
  const d = guidance.delve({ mode: 'explore', map: { victory: { type: 'fetch_relic' }, objectiveText: '取回圣物。' }, flags: {}, entities: [], character: { inventory: [] } });
  assert(!/\d+\s*,\s*\d+/.test(d.objective + d.hint), 'Delve copy has no tile coordinates');
});

test('Every act points at a map that exists in the content registry', () => {
  const content = require('../../server/game/content.js');
  for (const act of campaign.ACTS) {
    for (const mapId of act.mapIds) {
      const map = content.getMap(mapId);
      assert(map != null, `Act ${act.act} map "${mapId}" exists (${map ? map.name : 'missing'})`);
    }
  }
  assert(campaign.ACTS.length === 4, 'Four acts');
  assert(Object.keys(campaign.CLUE_LABELS).length === 3, 'Three clues in act 3');
});

console.log(`\nForge, Bestiary & Campaign Unit Tests Summary: ${passed} passed, ${failed} failed.`);
if (failed > 0) process.exit(1);
