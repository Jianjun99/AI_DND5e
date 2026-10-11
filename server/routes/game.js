const express = require('express');
const store = require('../store');
const engine = require('../game/engine');
const referee = require('../game/referee');
const boundedActions = require('../game/bounded-actions');
const dm = require('../game/dm');
const portraits = require('../portraits');
const endless = require('../game/endless');
const contentMod = require('../game/content');
const gambling = require('../game/gambling');
const campaignMod = require('../game/campaign');
const guidanceMod = require('../game/guidance');
const presentation = require('../game/presentation');
const contentContext = require('../game/content-context');
const contentAuthoring = require('../game/content-authoring');
const { resolveHistoryBinding } = require('../game/history-binding');

const router = express.Router();

// ---------------- helpers ----------------
function findCharacter(id) { return store.getCharacters().find(c => c.id === id); }

// ---- write-ownership contract (T2) ----
// Every log entry appended while handling an action is stamped with that action's id, so
// the DM's narration can be merged into the LATEST save later (the mechanical save already
// happened before the model call) without touching anything else and without duplicating.
function stampActionLogs(state, fromIndex, actionId) {
  for (let i = Math.max(0, fromIndex); i < state.log.length; i++) {
    if (!state.log[i].aid) state.log[i].aid = actionId;
  }
}

// Merge one action's narration into the latest save: drop the canned lines that belong to
// this action, append the DM prose once (aid dedupe keeps retries/replays from doubling).
// Never writes back the caller's snapshot — only the log of the freshly-read state.
function applyNarration(latest, actionId, logStartIndex, text, language) {
  latest.log = latest.log.filter((l, i) => {
    const own = l.aid ? l.aid === actionId : i >= logStartIndex;
    return !(own && l.kind === 'dm_canned');
  });
  if (!latest.log.some(l => l.aid === actionId && l.kind === 'dm')) {
    latest.log.push({ kind: 'dm', text, ts: Date.now(), aid: actionId, language });
  }
}

function sanitize(state) {
  const view = JSON.parse(JSON.stringify(state));
  // The shared player-visibility rule (engine.js): an unspotted trap is not in the payload.
  view.objects = view.objects.filter(o => !engine.isTrapHidden(o));
  view.map.entities = undefined; // originals no longer needed client-side
  view.map.scenes = undefined; // expose current legal choices, never author effect definitions
  view.scenes = engine.sceneViews(state);
  view.story = engine.storySummary(state);
  view.visible = engine.computeVision(state);
  if (state.isPlaytest) {
    view.isPlaytest = true;
    view.ownerDraftId = state.ownerDraftId || null;
  }
  // The level-up badge must reflect the roster hero, not this delve's snapshot: a hero who
  // levelled up in town and then continued an older delve would otherwise see a badge the
  // level-up endpoint then refuses ("not enough XP").
  const roster = findCharacter(view.characterId);
  view.levelUp = engine.levelUpInfo(roster || view.character);
  // Main-story step for this map (drives the delve HUD objective line)
  const campaign = campaignMod.ensure(roster && roster.campaign);
  const step = campaignMod.actForMap(campaign, view.mapId);
  view.campaign = {
    objective: campaignMod.objective(campaign),
    progress: campaignMod.progress(campaign),
    isCurrentStep: !!step,
    actId: step ? step.id : null,
    actName: step ? step.name : null
  };
  // deterministic in-delve guidance (T4): objective pill, return-to-camp prompt and the
  // combat economy line — computed server-side from the live state, no LLM involved
  view.guidance = guidanceMod.delve({ ...view, map: state.map }); // derive before hiding author-only scene definitions
  // Only discovered room prose is presentation data. NPC author knowledge and
  // alternate world snapshots are server-owned, not translation payloads.
  const seen = new Set(state.discovered || []);
  view.map.rooms = (view.map.rooms || []).filter(room => state.flags['room_'+room.id] ||
    Array.from(seen).some(tile => { const [x,y]=String(tile).split(',').map(Number); return x>=room.rect[0] && x<=room.rect[2] && y>=room.rect[1] && y<=room.rect[3]; }));
  delete view.map.npcs;
  delete view.world;
  view.entities.forEach(ent => {
    if (ent.kind === 'player' || ent.kind === 'ally' || seen.has(ent.x+','+ent.y)) {
      const display = presentation.name(ent,state);
      if (display && typeof display === 'object') ent.nameDisplay = display;
    }
  });
  // Draft content a playtest run carries is not in the installed registry, so its names are
  // resolved here from the run's own snapshot; the snapshot itself stays server-side.
  const snapshot = contentContext.ofState(state);
  if (snapshot) {
    for (const entry of view.character.inventory || []) {
      if (entry.itemId && !contentMod.getGear(entry.itemId) && contentContext.gearFor(snapshot, entry.itemId)) {
        entry.nameDisplay = presentation.name(entry, state);
      }
    }
  }
  view.contentSnapshot = undefined;
  return view;
}

// Narrate the narratable events of one action. The model call happens OUTSIDE the save
// lock with a prompt-context snapshot; the produced text is then merged into the LATEST
// save (only this action's log lines change) and persisted — so narration survives
// GET/refresh/reconnect and concurrent mechanical actions are never rolled back (T2).
async function narrate(state, events, logStartIndex, actionId, locale = 'en') {
  const narratable = events.filter(e => e.narrate);
  if (!narratable.length) return;
  const text = await dm.narrateEvents(state, narratable, locale);
  if (!text) return; // LLM off/unreachable/slow-empty — the canned lines stand, mechanics untouched
  await store.withSaveLock(state.id, () => {
    const latest = store.getSave(state.id);
    if (!latest) return;
    applyNarration(latest, actionId, logStartIndex, text, locale);
    store.saveGame(latest);
  });
}

// rolled instances and the action economy live in one authoritative executor (R6): the
// buttons, the bounded natural-language path and the legacy referee all spend the same slot.
const executor = require('../game/action-executor');
const { consumeActionEconomy } = executor;

function requireAlive(state, events) {
  if (state.mode === 'over') { events.push({ type: 'error', ...presentation.eventMessage("event.game.requireAlive.1",[],["You have fallen. Recover at camp to continue."]) }); return false; }
  if (state.mode === 'victory' || state.mode === 'retreat') { events.push({ type: 'error', ...presentation.eventMessage("event.game.requireAlive.2",[],["The delve is complete."]) }); return false; }
  return true;
}

const NEEDS_CONSCIOUS = ['move', 'attack', 'cast', 'dash', 'dodge', 'disengage', 'shove', 'useItem', 'interact', 'classAction', 'freeform', 'chat', 'rest', 'quest', 'retreat', 'skillCheckObject', 'sceneChoice'];
function requireConscious(state, events) {
  const p = state.entities.find(e => e.kind === 'player');
  if (p && p.conditions.includes('unconscious')) {
    events.push({ type: 'error', ...presentation.eventMessage("event.game.requireConscious.3",[p.deathSaves ? p.deathSaves.succ : 0,p.deathSaves ? p.deathSaves.fail : 0],["You are dying — death saving throws roll on your turn ("," success / "," failure). Hold on…"]) });
    return false;
  }
  return true;
}

// ---------------- routes ----------------
router.post('/start', async (req, res) => {
  const locale = res.locals.locale || 'en';
  const body = req.body || {};
  let { difficulty } = body;
  const characterId = body.characterId || body.charId;
  let mapId = body.mapId;
  const bringAlly = body.bringAlly;
  const char = findCharacter(characterId);
  if (!char) return res.status(404).json({ error: 'Character not found', errorDisplay: { key: "api.characterNotFound" } });
  // T7a: an unresolved road encounter must not be silently skipped by a direct start —
  // the trigger endpoint hands the same live instance back, and the player resolves it
  // before departing. Bots/old clients never trigger an encounter, so they are
  // unaffected; a resolved-but-unconsumed instance passes through and is consumed once
  // (boons applied, instance cleared) further down.
  if (char && char.currentRoadEncounter && !char.currentRoadEncounter.resolved) {
    return res.status(409).json({
      error: 'Road encounter unresolved — choose an option before departing.', errorDisplay: { key: "api.roadUnresolved" },
      encounter: engine.roadEncounterView(char.currentRoadEncounter, char)
    });
  }
  const allyOption = (typeof bringAlly === 'string' && bringAlly === 'none') ? false : (bringAlly || false);
  // the weekly challenge: a boss-floor procedural delve from one seed per ISO week
  let weekly = null;
  if (mapId === 'weekly') {
    weekly = engine.weeklyInfo();
    engine.beginSeed(weekly.seed);
    contentMod.injectMap(endless.generateFloor(weekly.depth, 'crypt', engine.rand, 'weekly_'));
    mapId = 'weekly_' + weekly.depth;
  }
  if (mapId === 'endless_1') {
    contentMod.injectMap(endless.generateFloor(1));
  }
  if (!contentMod.getMap(mapId)) {
    return res.status(400).json({ error: 'Unknown or invalid map: ' + (mapId ?? '(default)'), errorDisplay: { key: 'api.unknownMap', params: { map: mapId ?? '(default)' } }, diagnostics: contentMod.diagnostics() });
  }
  // T12a: a companion story names the ally it needs. The gate lives here (bilingual
  // error, the player returns to the prepare screen) and again inside engine.startGame.
  const startMapDef = contentMod.getMap(mapId);
  const needCompanion = startMapDef.story?.companion;
  if (needCompanion) {
    let wantAlly = typeof allyOption === 'string' ? allyOption : (allyOption ? 'bram' : null);
    if (wantAlly === 'true') wantAlly = 'bram';
    if (wantAlly !== needCompanion) {
      const nameDisplay = presentation.name({ allyId: needCompanion });
      return res.status(400).json({ error: 'This adventure requires the companion "' + presentation.plain(nameDisplay) + '". Return to the prepare screen and bring them.', errorDisplay: { key: 'api.requiresCompanion', params: { name: nameDisplay } } });
    }
  }
  // gambled delve-only prizes ride along, and any curse bought at the table lands here
  const carryItems = (char.pendingDelveItems || []).slice();
  const state = engine.startGame(char, { bringAlly: allyOption, difficulty, mapId, carryItems, seed: weekly ? weekly.seed : undefined });
  state.historyBinding = startMapDef.story?.requiresHistory ? resolveHistoryBinding(char, startMapDef.story.requiresHistory) : null;
  // A playtest run is minted by the authoring endpoint only. The roster hero carries the
  // server-written marker; a client cannot mark an ordinary hero as playtest through /start.
  if (char.isPlaytest === true && contentAuthoring.playtestHeroOwnsDraft(char)) {
    state.isPlaytest = true;
    state.ownerDraftId = char.ownerDraftId;
  }
  if (weekly) state.weeklyLabel = weekly.label;
  if (mapId === 'endless_1') state.endlessDepth = 1;
  const events = [];
  if (carryItems.length) {
    const names = carryItems.map(i => i.name || i.itemId).join('、');
    events.push({ type: 'carry_in', narrate: true, ...presentation.eventMessage("event.game.handler.4",[names],["你带上了场外赢来的东西：","。（仅限本场地牢，离场作废）"]) });
  }
  const pendingCurses = (char.pendingCurses || []).slice();
  if (pendingCurses.length) {
    pendingCurses.forEach(id => {
      const curse = gambling.GAMBLE_CURSES[id];
      if (curse) curse.apply({ engine, state, events });
    });
  }
  // road-encounter boons bought on the way here (shrine pray / offering)
  const roadBoons = (char.pendingRoadBoons || []).slice();
  const roadPlayer = state.entities.find(e => e.kind === 'player');
  roadBoons.forEach(boon => {
    if (boon === 'shrine_temp_hp' && roadPlayer) {
      roadPlayer.tempHp = (roadPlayer.tempHp || 0) + 5;
      events.push({ type: 'boon', narrate: true, ...presentation.eventMessage("event.game.handler.5",[],["路途神殿的余温仍在——+5 临时生命伴随你进入地牢。"]) });
    }
    if (boon === 'shrine_blessed' && roadPlayer) {
      roadPlayer.buffs = roadPlayer.buffs || [];
      roadPlayer.buffs.push({ id: 'blessed', rounds: 480 });
      events.push({ type: 'boon', narrate: true, ...presentation.eventMessage("event.game.handler.6",[],["黎明母亲的祝福落在你眉间——本次冒险中攻击检定获得 +1d4。"]) });
    }
  });
  if (carryItems.length || pendingCurses.length || roadBoons.length || char.currentRoadEncounter) {
    const chars = store.getCharacters();
    const idx = chars.findIndex(c => c.id === char.id);
    if (idx >= 0) {
      chars[idx].pendingDelveItems = [];
      chars[idx].pendingCurses = [];
      chars[idx].pendingRoadBoons = [];
      chars[idx].currentRoadEncounter = null;
      store.saveCharacters(chars);
    }
  }
  const intro = {
    type: 'scene', narrate: true,
    ...presentation.eventMessage("event.game.handler.7",[presentation.field(state.map,'name'),presentation.name(char,state),presentation.field(state.map,'objectiveText') || {localized:{en:'The dark ahead is waiting.','zh-CN':'前方的黑暗正在等待。'},fallback:'The dark ahead is waiting.'}],[""," closes around ",". ",""])
  };
  events.push(intro);
  engine.addLog(state, 'dm_canned', intro);
  const startActionId = store.newId('act');
  stampActionLogs(state, state.log.length - 1, startActionId);
  store.saveGame(state);
  await narrate(state, events, state.log.length - 1, startActionId, locale);
  // respond from the persisted save so the narration merged above is already in it
  res.json({ state: sanitize(store.getSave(state.id) || state), events });
});

router.get('/:id', (req, res) => {
  const state = store.getSave(req.params.id);
  if (!state) return res.status(404).json({ error: 'Save not found', errorDisplay: { key: "api.saveNotFound" } });
  res.json({ state: sanitize(state) });
});

router.delete('/:id', (req, res) => {
  store.deleteSave(req.params.id);
  res.json({ ok: true });
});

// Read-only deterministic previews (T7a): the client's check modal shows these numbers
// instead of computing its own. Strictly read-only — no save write, no rev bump, no RNG,
// no buff/resource consumption (it only mirrors what the resolve action WILL roll with).
router.post('/:id/preview', (req, res) => {
  const state = store.getSave(req.params.id);
  if (!state) return res.status(404).json({ error: 'Save not found', errorDisplay: { key: "api.saveNotFound" } });
  const body = req.body || {};
  if (body.type === 'skillCheckObject') {
    const obj = (state.objects || []).find(o => o.id === body.objectId);
    if (!obj) return res.status(404).json({ error: 'Object not found', errorDisplay: { key: "api.objectNotFound" } });
    return res.json({ ok: true, preview: engine.previewSkillCheckObject(state, obj) });
  }
  return res.status(400).json({ error: 'Unknown preview type', errorDisplay: { key: "api.unknownPreview" } });
});

router.get('/', (req, res) => {
  // A playtest run belongs to the authoring studio, not to the player's continue list.
  res.json(store.listSaves().filter(s => s.isPlaytest !== true));
});

// main action endpoint
// T2 write contract: the mechanical section below is a SYNCHRONOUS read-modify-write of
// the LATEST save (getSave → mutate → saveGame with no awaits in between — atomic in the
// event loop). Every model call is queued into `pending`, runs OUTSIDE any save lock with
// the saved snapshot as prompt context, and afterwards merges ONLY its own fields into a
// freshly-read state. Never add an await between the getSave and the saveGame below —
// that gap is exactly the stale-snapshot rollback bug (a slow describe used to rewind the
// player's position). The per-save lock serializes the async merge phases and must never
// be held across a model request.
router.post('/:id/action', async (req, res) => {
  const locale = res.locals.locale || 'en';
  const action = req.body || {};
  const actionId = store.newId('act');
  const pending = []; // { run: async model call, apply: (latest) => writes only its own fields }
  let chatReply = null;
  let appearance = null;
  let portrait = null;
  let restRecapEntry = null;
  let freeformFlavorText = null;
  let recapEntry = null;
  let questTextResult = null;

  const state = store.getSave(req.params.id);
  if (!state) return res.status(404).json({ error: 'Save not found', errorDisplay: { key: "api.saveNotFound" } });
  engine.beginRng(state); // seeded delves (weekly challenge) resume their deterministic stream
  const visualBefore=state.entities.map(e=>({id:e.id,hp:e.hp,alive:e.alive}));
  const events = [];
  const logStart = state.log.length;
  let handled = true;

  try {
    if (action.type === 'respawn') {
      respawnAtCamp(state, events);
    } else if (requireAlive(state, events) && (!NEEDS_CONSCIOUS.includes(action.type) || requireConscious(state, events))) {
      switch (action.type) {
        case 'move': {
          engine.movePlayer(state, +action.x, +action.y, events);
          break;
        }
        case 'attack': {
          executor.attack(state, action, events);
          break;
        }
        case 'cast': {
          if (state.mode === 'combat' && state.combat.order[state.combat.turnIdx].id !== 'player') {
            events.push({ type: 'error', ...presentation.eventMessage("event.game.handler.10",[],["Not your turn!"]) }); break;
          }
          const spell = engine.findSpell(action.spellId);
          if (spell && spell.level > 0 && spell.level <= 3) {
            // free cast from magic initiate (1/long rest)
            const freeSpell = state.character.spellcasting.freeSpell;
            if (freeSpell && freeSpell.id === action.spellId && state.character.freeSpellUses < freeSpell.max && !state.character.spellcasting.spells.includes(action.spellId)) {
              state.character.freeSpellUses++;
              engine.castSpell(state, action.spellId, action.targetId, events, { free: true });
              break;
            }
          }
          engine.castSpell(state, action.spellId, action.targetId, events);
          break;
        }
        case 'classAction': {
          if (state.mode === 'combat' && state.combat.order[state.combat.turnIdx].id !== 'player' && !['reckless_toggle'].includes(action.id)) {
            events.push({ type: 'error', ...presentation.eventMessage("event.game.handler.11",[],["Not your turn!"]) }); break;
          }
          handleClassAction(state, action, events);
          break;
        }
        case 'useItem': {
          executor.useItem(state, action, events);
          break;
        }
        case 'dash': {
          if (state.mode === 'combat') {
            if (state.combat.order[state.combat.turnIdx].id !== 'player') { events.push({ type: 'error', ...presentation.eventMessage("event.game.handler.20",[],["Not your turn!"]) }); break; }
            const econErr = consumeActionEconomy(state, 'action');
            if (econErr) { events.push({ type: 'error', ...econErr }); break; }
            state.combat.movementLeft += engine.currentSpeed(state, engine.playerEntity(state));
            if (state.character.dashTempHp) {
              const p = engine.playerEntity(state);
              p.tempHp = (p.tempHp || 0) + state.character.profBonus;
              engine.addLog(state, 'mech', presentation.eventMessage("event.game.handler.21",[state.character.profBonus],["Adrenaline Rush: +"," temporary HP!"]));
            }
            const ev = { type: 'dash', narrate: true, ...presentation.eventMessage("event.game.handler.22",[presentation.name(engine.playerEntity(state),state)],[""," dashes across the stone!"]) };
            events.push(ev); engine.addLog(state, 'mech', ev);
          } else events.push({ type: 'error', ...presentation.eventMessage("event.game.handler.23",[],["Dash matters only in combat."]) });
          break;
        }
        case 'dodge': {
          if (state.mode === 'combat') {
            if (state.combat.order[state.combat.turnIdx].id !== 'player') { events.push({ type: 'error', ...presentation.eventMessage("event.game.handler.24",[],["Not your turn!"]) }); break; }
            const econErr = consumeActionEconomy(state, 'action');
            if (econErr) { events.push({ type: 'error', ...econErr }); break; }
            engine.addBuff(engine.playerEntity(state), { id: 'dodge', rounds: 2 });
            const ev = { type: 'dodge', narrate: true, ...presentation.eventMessage("event.game.handler.25",[presentation.name(engine.playerEntity(state),state)],[""," takes a defensive stance — attacks against them have disadvantage."]) };
            events.push(ev); engine.addLog(state, 'mech', ev);
          } else events.push({ type: 'error', ...presentation.eventMessage("event.game.handler.26",[],["Dodge matters only in combat."]) });
          break;
        }
        case 'disengage': {
          if (state.mode !== 'combat') { events.push({ type: 'error', ...presentation.eventMessage("event.game.handler.27",[],["Disengage matters only in combat."]) }); break; }
          if (state.combat.order[state.combat.turnIdx].id !== 'player') { events.push({ type: 'error', ...presentation.eventMessage("event.game.handler.28",[],["Not your turn!"]) }); break; }
          const econErr2 = consumeActionEconomy(state, 'action');
          if (econErr2) { events.push({ type: 'error', ...econErr2 }); break; }
          const pd = engine.playerEntity(state);
          engine.addBuff(pd, { id: 'disengaged', rounds: 1 });
          state.flags.noOaFor = 'player';
          const ev = { type: 'disengage', narrate: true, ...presentation.eventMessage("event.game.handler.29",[presentation.name(pd,state)],[""," disengages — slips away without provoking attacks."]) };
          events.push(ev); engine.addLog(state, 'mech', ev);
          break;
        }
        case 'shove': {
          if (state.mode !== 'combat') { events.push({ type: 'error', ...presentation.eventMessage("event.game.handler.30",[],["Shove matters only in combat."]) }); break; }
          if (state.combat.order[state.combat.turnIdx].id !== 'player') { events.push({ type: 'error', ...presentation.eventMessage("event.game.handler.31",[],["Not your turn!"]) }); break; }
          const econErr3 = consumeActionEconomy(state, 'action');
          if (econErr3) { events.push({ type: 'error', ...econErr3 }); break; }
          engine.shoveTarget(state, action.targetId, events);
          break;
        }
        case 'sceneChoice': {
          engine.chooseScene(state, action.sceneId, action.choiceId, events);
          break;
        }
        case 'interact': {
          // pre-generate the next endless floor if the stairs lead deeper
          const stairsObj = state.objects.find(o => o.id === action.objectId && o.type === 'stairs' && o.to && o.to.mapId === '__endless_next__');
          if (stairsObj) {
            const nextDepth = (state.endlessDepth || 1) + 1;
            const nextMap = endless.generateFloor(nextDepth, nextDepth <= 3 ? 'crypt' : nextDepth <= 7 ? 'vault' : 'hills');
            contentMod.injectMap(nextMap);
            state.endlessDepth = nextDepth;
            // the companion has opinions about going deeper (mood scales with loyalty)
            const descentAlly = state.entities.find(e => e.kind === 'ally' && e.alive);
            if (descentAlly) {
              const loy = descentAlly.loyalty == null ? 50 : descentAlly.loyalty;
              events.push({ type: 'companion', narrate: true, ...presentation.eventMessage("event.game.handler.32",[presentation.name(descentAlly,state),(loy >= 80 ? presentation.eventMessage("event.game.handler.33",[],["\"Deeper still? You are insatiable — and I love it.\""]) : (loy >= 30 ? presentation.eventMessage("event.game.handler.34",[],["\"Another floor. Keep your torch up and stay behind me.\""]) : presentation.eventMessage("event.game.handler.35",[],["\"Every step down, my regret compounds. The pay better be waiting.\""])))],[""," eyes the descending stairs: ",""]) });
            }
            stairsObj.to.mapId = nextMap.id;
            stairsObj.to.x = nextMap.playerStart.x;
            stairsObj.to.y = nextMap.playerStart.y;
          }
          engine.interactObject(state, action.objectId, events);
          break;
        }
        case 'equip': {
          const { slot, itemId } = action;
          if (!slot) { events.push({ type: 'error', ...presentation.eventMessage("event.game.handler.36",[],["Slot required"]) }); break; }
          state.character.equipped = state.character.equipped || {};
          if (!itemId || itemId === 'none') {
            state.character.equipped[slot] = null;
            events.push({ type: 'equip', ...presentation.eventMessage("event.game.handler.37",[slot],["Unequipped ","."]), slot, itemId: null });
          } else {
            // rolled affix gear is equipped by its unique id, plain items by their catalogue id
            const hasItem = (state.character.inventory || []).some(i => (i.itemId === itemId || i.uniqueId === itemId) && i.qty > 0);
            if (!hasItem) { events.push({ type: 'error', ...presentation.eventMessage("event.game.handler.38",[],["Item not in inventory"]) }); break; }
            state.character.equipped[slot] = itemId;
            const label = engine.invEntry(state.character, itemId);
            events.push({ type: 'equip', ...presentation.eventMessage("event.game.handler.39",[(label && label.name) || itemId,slot],["Equipped "," in ","."]), slot, itemId });
          }
          const armorId = state.character.equipped.armor;
          const offHandId = state.character.equipped.offHand;
          const reorder = (itId) => {
            const idx = (state.character.inventory || []).findIndex(i => i.itemId === itId || i.uniqueId === itId);
            if (idx > 0) { const [it] = state.character.inventory.splice(idx, 1); state.character.inventory.unshift(it); }
          };
          if (armorId) reorder(armorId);
          if (offHandId) reorder(offHandId);
          const cls = (engine.CLASSES || []).find(c => c.id === state.character.className);
          if (cls) engine.applyClassAndSpecies(state.character, cls, null, state.character.level || 1, true);
          const pe = engine.playerEntity(state);
          if (pe) {
            pe.ac = engine.currentAc(state, pe);
            // Vigor-style gear changes max HP while worn
            pe.hpMax = state.character.hpMax;
            pe.hp = Math.min(pe.hp, pe.hpMax);
          }
          try {
            const chars = store.getCharacters();
            const cIdx = chars.findIndex(c => c.id === state.character.id);
            if (cIdx >= 0) {
              chars[cIdx].equipped = state.character.equipped;
              chars[cIdx].inventory = state.character.inventory;
              chars[cIdx].acBase = state.character.acBase;
              chars[cIdx].attacks = state.character.attacks;
              store.saveCharacters(chars);
            }
          } catch {}
          break;
        }
        case 'unequip': {
          const { slot } = action;
          if (slot && state.character.equipped) {
            state.character.equipped[slot] = null;
            const cls = (engine.CLASSES || []).find(c => c.id === state.character.className);
            if (cls) engine.applyClassAndSpecies(state.character, cls, null, state.character.level || 1, true);
            const pe = engine.playerEntity(state);
            if (pe) {
              pe.ac = engine.currentAc(state, pe);
              pe.hpMax = state.character.hpMax;
              pe.hp = Math.min(pe.hp, pe.hpMax);
            }
            events.push({ type: 'equip', ...presentation.eventMessage("event.game.handler.40",[slot],["Unequipped ","."]), slot, itemId: null });
            try {
              const chars = store.getCharacters();
              const cIdx = chars.findIndex(c => c.id === state.character.id);
              if (cIdx >= 0) {
                chars[cIdx].equipped = state.character.equipped;
                chars[cIdx].acBase = state.character.acBase;
                store.saveCharacters(chars);
              }
            } catch {}
          }
          break;
        }
        case 'endTurn': {
          engine.endTurn(state, events);
          break;
        }
        case 'rest': {
          if (action.kind === 'long') {
            engine.longRest(state, events);
            // write a journal entry after a successful long rest (fallback text if the LLM is off);
            // the model call queues out of the mechanical commit and merges its own journal line
            if (state.mode !== 'combat' && events.every(e => e.type !== 'error')) {
              pending.push({
                run: async () => { restRecapEntry = await dm.writeRecap(state,locale); },
                apply: (latest) => {
                  if (!restRecapEntry) return;
                  latest.journal = latest.journal || [];
                  latest.journal.push({ ts: Date.now(), text: restRecapEntry, language:locale, aid:actionId });
                  engine.addLog(latest, 'system', presentation.eventMessage("event.game.handler.41",[],["📖 A new entry finds its way into your journal."]));
                }
              });
            }
          } else engine.shortRest(state, events);
          break;
        }
        case 'freeform': {
          const text = String(action.text || '').slice(0, 300).trim();
          if (!text) break;
          engine.addLog(state, 'player', text);
          const result = referee.resolveFreeform(state, text, locale);
          events.push(...result.events);
          if (result.clarification) {
            const clarifEv = { type: 'clarification', ...result.clarification };
            events.push(clarifEv);
            engine.addLog(state, 'system', result.clarification.prompt);
            break;
          }
          if (result.confirmation) {
            const confEv = { type: 'confirmation', ...result.confirmation };
            events.push(confEv);
            engine.addLog(state, 'system', result.confirmation.prompt + (result.confirmation.costWarning ? ' (' + result.confirmation.costWarning + ')' : ''));
            break;
          }
          if (result.error) {
            events.push(result.error);
            engine.addLog(state, 'system', result.error.text);
            break;
          }
          if (!result.handled) {
            if (await dm.available()) {
              let proposalFromModel = null;
              pending.push({
                run: async () => {
                  proposalFromModel = await boundedActions.proposeFromLlm(state, text, locale);
                  if (!proposalFromModel) {
                    freeformFlavorText = await dm.freeformFlavor(state, text, locale);
                  }
                },
                apply: (latest) => {
                  if (proposalFromModel) {
                    const validation = boundedActions.validateProposal(latest, proposalFromModel);
                    if (validation.valid) {
                      const conf = boundedActions.checkConfirmationNeeded(latest, proposalFromModel, locale);
                      if (conf) {
                        const confEv = { type: 'confirmation', ...conf };
                        events.push(confEv);
                        latest.events = latest.events || [];
                        latest.events.push(confEv);
                      } else {
                        const execEvents = [];
                        boundedActions.executeProposal(latest, proposalFromModel, locale, execEvents);
                        events.push(...execEvents);
                      }
                    } else {
                      const failEv = {
                        type: 'error',
                        text: validation.error || (locale === 'zh-CN' ? '无法在当前状态执行此行动。' : 'Cannot perform this action in current state.'),
                        ...(validation.messageKey ? { messageKey: validation.messageKey } : {})
                      };
                      events.push(failEv);
                      engine.addLog(latest, 'system', failEv);
                    }
                  } else if (freeformFlavorText) {
                    engine.addLog(latest, 'dm', freeformFlavorText, { language: locale, aid: actionId });
                  }
                }
              });
            } else {
              const failEv = {
                type: 'error',
                text: locale === 'zh-CN'
                  ? '无法识别该指令。你可以尝试：攻击[目标]、调查、喝药水、或走近NPC进行交谈。'
                  : 'Action not recognized. Try: attack [target], search, drink potion, or approach an NPC to talk.',
                textDisplay: {
                  key: 'story.error.unrecognizedAction',
                  fallback: locale === 'zh-CN'
                    ? '无法识别该指令。你可以尝试：攻击[目标]、调查、喝药水、或走近NPC进行交谈。'
                    : 'Action not recognized. Try: attack [target], search, drink potion, or approach an NPC to talk.'
                }
              };
              events.push(failEv);
              engine.addLog(state, 'system', failEv);
            }
          }
          break;
        }
        case 'chat': {
          const npcId = action.npcId;
          const npcEnt = state.entities.find(e => e.kind === 'npc' && e.npcId === npcId && (state.discovered || []).includes(e.x+','+e.y));
          const text = String(action.text || '').slice(0, 300).trim();
          if (!npcEnt) { events.push({ type: 'error', ...presentation.eventMessage("event.game.handler.42",[],["That NPC is not here."]) }); break; }
          if (engine.manhattan(npcEnt, engine.playerEntity(state)) > 5) { events.push({ type: 'error', ...presentation.eventMessage("event.game.handler.43",[],["Move closer to speak with them."]) }); break; }
          const boundedResult = boundedActions.parseDeterministicAction(state, text, locale);
          if (boundedResult.handled && boundedResult.proposal?.intent === 'sceneChoice') {
            engine.addLog(state, 'player', presentation.eventMessage("event.game.handler.44", [text, presentation.name(npcEnt, state)], ["", "  (to ", ")"]));
            events.push(...(boundedResult.events || []));
            if (boundedResult.confirmation) {
              events.push(boundedResult.confirmation);
              engine.addLog(state, 'system', boundedResult.confirmation.prompt + (boundedResult.confirmation.costWarning ? ' (' + boundedResult.confirmation.costWarning + ')' : ''));
              break;
            }
            if (boundedResult.error) {
              events.push(boundedResult.error);
              engine.addLog(state, 'system', boundedResult.error.text);
              break;
            }
            boundedActions.executeProposal(state, boundedResult.proposal, locale, events);
            break;
          }
          engine.addLog(state, 'player', presentation.eventMessage("event.game.handler.44",[text,presentation.name(npcEnt,state)],["","  (to ",")"]));
          const memoryAtRequest = engine.sceneMemory(state, npcId);
          const phaseAtRequest = JSON.stringify(engine.activeSceneView(state, npcId));
          if (npcId === 'morthek' && !state.flags.morthek_potion) {
            state.flags.morthek_potion = true;
            const inv = state.character.inventory.find(x => x.itemId === 'potion_healing');
            if (inv) inv.qty++; else state.character.inventory.push({ itemId: 'potion_healing', qty: 1 });
            engine.addLog(state, 'mech', presentation.eventMessage("event.game.handler.45",[],["Morthek presses a Potion of Healing into your hands."]));
          }
          pending.push({
            run: async () => { chatReply = await dm.npcChat(state, npcId, text,locale); },
            apply: (latest) => {
              // T2a: merge ONLY this action's exchange onto the LATEST history, tagged with
              // this action's id. Never copy the prompt snapshot's whole history — a slow
              // held reply must not erase a faster concurrent chat that already landed.
              // Out-of-order completions append in completion order; the 24-entry cap
              // matches dm.npcChat's own truncation.
              if (chatReply != null) {
                // A delayed reply cannot quote the previous branch after a newer choice.
                const currentMemory = engine.sceneMemory(latest, npcId);
                const currentScene = engine.activeSceneView(latest, npcId);
                if (currentMemory !== memoryAtRequest || JSON.stringify(currentScene) !== phaseAtRequest) chatReply = currentScene?.phase === 'fighting' ? (locale==='zh-CN' ? '这次战斗还没有结束，先完成战斗再谈通行。' : 'Finish this battle before discussing passage.') : dm.memoryText(latest,npcId,locale) || presentation.textFor(latest.map.npcs[npcId],'canned',locale)?.[0] || '…';
                latest.npcChat = latest.npcChat || {};
                const hist = latest.npcChat[npcId] = latest.npcChat[npcId] || [];
                if (!hist.some(m => m.aid === actionId)) {
                  hist.push({ role: 'user', content: text, aid: actionId, language:locale });
                  hist.push({ role: 'assistant', content: chatReply, aid: actionId, language:locale });
                  if (hist.length > 24) hist.splice(0, hist.length - 24);
                }
                engine.addLog(latest, 'npc', presentation.eventMessage("event.game.handler.46",[presentation.name(npcEnt,state),chatReply],["",": \"","\""]),{language:locale,aid:actionId});
              }
            }
          });
          break;
        }
        case 'respawn': {
          if (state.mode !== 'over') { events.push({ type: 'error', ...presentation.eventMessage("event.game.handler.47",[],["You are not fallen."]) }); break; }
          respawnAtCamp(state, events);
          break;
        }
        case 'buy': {
          if (!requireAlive(state, events)) break;
          buyFromMarla(state, action, events);
          break;
        }
        case 'describe': {
          if (!requireAlive(state, events)) break;
          const known = new Set(state.discovered || []);
          const ent = state.entities.find(e => e.id === action.targetId && known.has(e.x+','+e.y) && (e.kind === 'monster' || e.kind === 'npc'));
          if (!ent) { events.push({ type: 'error', ...presentation.eventMessage("event.game.handler.48",[],["Nothing to describe."]) }); break; }
          const baseKey = ent.kind === 'monster' ? ent.monsterId : ent.npcId;
          const key = locale+':'+baseKey;
          state.appearances = state.appearances || {};
          if (state.appearances[key]) { appearance = state.appearances[key]; break; }
          // the model call queues out of the mechanical commit; only this cache entry is
          // written back, onto the LATEST save — never the snapshot taken before the wait
          pending.push({
            run: async () => { appearance = await dm.describeEntity(state, ent,locale); },
            apply: (latest) => {
              latest.appearances = latest.appearances || {};
              if (!latest.appearances[key] && appearance) {
                latest.appearances[key] = appearance;
                latest.appearanceOrigins ??= {};
                latest.appearanceOrigins[key] = {language:locale,aid:actionId};
              }
              appearance = latest.appearances[key] || appearance;
              latest.appearances[baseKey] = appearance; // old clients retain their cache field
              latest.appearanceLanguages ??= {};
              latest.appearanceLanguages[baseKey] = locale;
            }
          });
          break;
        }
        case 'recap': {
          if (!requireAlive(state, events)) break;
          const camp = (state.map.victory && state.map.victory.campfire) || state.map.victoryTile;
          const p0 = engine.playerEntity(state);
          if (!(p0.x === camp.x && p0.y === camp.y)) {
            events.push({ type: 'error', ...presentation.eventMessage("event.game.handler.49",[],["You can only write in your journal at the campfire."]) });
            break;
          }
          pending.push({
            run: async () => { recapEntry = await dm.writeRecap(state,locale); },
            apply: (latest) => {
              if (!recapEntry) return;
              latest.journal = latest.journal || [];
              latest.journal.push({ ts: Date.now(), text: recapEntry, language:locale, aid:actionId });
              events.push({ type: 'journal', narrate: false, text: recapEntry, language:locale, data: { entry: recapEntry } });
              engine.addLog(latest, 'system', presentation.eventMessage("event.game.handler.50",[],["📖 You scratch a new entry into your journal."]));
            }
          });
          break;
        }
        case 'portrait': {
          const pent = state.entities.find(e => e.id === action.targetId && (state.discovered || []).includes(e.x+','+e.y) && (e.kind === 'monster' || e.kind === 'npc'));
          if (!pent) { events.push({ type: 'error', ...presentation.eventMessage("event.game.handler.51",[],["Nothing to portray."]) }); break; }
          // portraits cache to the portraits dir on disk, not to the save — nothing to merge
          pending.push({
            run: async () => {
              try { portrait = await portraits.ensurePortrait(state, pent); } catch { portrait = null; }
            },
            apply: () => {}
          });
          break;
        }
        case 'quest': {
          if (!requireAlive(state, events)) break;
          const campQ = (state.map.victory && state.map.victory.campfire) || state.map.victoryTile;
          const pq = engine.playerEntity(state);
          if (!campQ || !(pq.x === campQ.x && pq.y === campQ.y)) {
            events.push({ type: 'error', ...presentation.eventMessage("event.game.handler.52",[],["Side quests are offered around the campfire — come back and ask around."]) });
            break;
          }
          if (state.quests && state.quests.active) {
            events.push({ type: 'info', ...presentation.eventMessage("event.game.handler.53",[presentation.field(state.quests.active,"shortText")],["You already have work: ",". Finish that first."]) });
            break;
          }
          const quest = engine.rollSideQuest(state);
          if (!quest) { events.push({ type: 'info', ...presentation.eventMessage("event.game.handler.54",[],["No one at camp has work to offer tonight."]) }); break; }
          const questEv = { type: 'quest_offer', narrate: true, text: quest.text,textDisplay:quest.textDisplay, data: { quest } };
          events.push(questEv);
          engine.addLog(state, 'system', presentation.eventMessage("event.game.handler.55",[presentation.field(quest,"shortText"),quest.reward.gold,quest.reward.xp],["📜 New side quest: "," ("," gp, "," XP)"]));
          // the LLM only rewords the hook; the objective itself was already committed above
          pending.push({
            run: async () => {
              questTextResult = await dm.questText(state, quest,locale);
              if (questTextResult) { quest.text = questTextResult; delete quest.textDisplay; questEv.text = questTextResult; delete questEv.textDisplay; questEv.language=locale; }
            },
            apply: (latest) => {
              if (questTextResult && latest.quests && latest.quests.active && latest.quests.active.id === quest.id) {
                latest.quests.active.text = questTextResult;
                delete latest.quests.active.textDisplay;
                latest.quests.active.language = locale;
                latest.quests.active.aid = actionId;
              }
            }
          });
          break;
        }
        case 'retreat': {
          if (!requireAlive(state, events)) break;
          const camp = (state.map.victory && state.map.victory.campfire) || state.map.victoryTile || state.map.playerStart;
          const p = engine.playerEntity(state);
          const atCamp = camp && engine.manhattan(p, camp) <= 1;
          const atStart = state.map.playerStart && engine.manhattan(p, state.map.playerStart) <= 1;
          if (!atCamp && !atStart) {
            events.push({ type: 'error', ...presentation.eventMessage("event.game.handler.56",[],["You can only retreat back to town from the campfire or the dungeon entrance."]) });
            break;
          }
          state.mode = 'retreat';
          state.endSeq = (state.endSeq || 0) + 1; // settleable end marker (T3)
          state.flags = state.flags || {};
          state.flags.retreated = true;
          const ev = {
            type: 'retreat', narrate: true,
            ...presentation.eventMessage("event.game.handler.57",[presentation.name(p,state)],[""," retreats through the dungeon threshold and returns safely to Oakhaven with their hard-won spoils!"])
          };
          events.push(ev);
          engine.addLog(state, 'system', ev);
          break;
        }
        case 'skillCheckObject': {
          if (!requireAlive(state, events)) break;
          const obj = state.objects.find(o => o.id === action.objectId);
          if (!obj) { events.push({ type: 'error', ...presentation.eventMessage("event.game.handler.58",[],["Object not found."]) }); break; }
          const p = engine.playerEntity(state);
          if (engine.manhattan(p, obj) > 1) { events.push({ type: 'error', ...presentation.eventMessage("event.game.handler.59",[],["Move closer first."]) }); break; }
          if (obj.type === 'trap') {
            engine.disarmTrap(state, obj, events);
          } else if (obj.type === 'chest') {
            engine.unlockChest(state, obj, action.method || 'pick', events);
          } else {
            events.push({ type: 'error', ...presentation.eventMessage("event.game.handler.60",[],["Object cannot be checked."]) });
          }
          break;
        }
        default:
          handled = false;
          events.push({ type: 'error', ...presentation.eventMessage("event.game.handler.61",[],["Unknown action."]) });
      }
    }
  } catch (e) {
    console.error(e);
    events.push({ type: 'error', ...presentation.eventMessage("event.game.handler.62",[e.message],["Something went wrong: ",""]) });
  }

  if (state.mode !== 'over' && state.mode !== 'victory' && state.mode !== 'retreat') engine.checkCombatEnd(state, events);
  engine.progressScenes(state, events);
  engine.persistRng(state);
  state.updatedAt = Date.now();
  stampActionLogs(state, logStart, actionId);
  store.saveGame(state); // mechanical commit — happens BEFORE any model wait
  const visualEvents=require('../game/visual-events').project(visualBefore,state.entities,events,action,actionId);

  // phase 2: the queued model calls run outside every save lock, on the saved snapshot
  for (const job of pending) {
    try { await job.run(); } catch (e) {
      console.error(e);
      events.push({ type: 'error', ...presentation.eventMessage("event.game.handler.63",[],["The DM is silent for a moment — the adventure goes on."]) });
    }
  }
  // phase 3: merge only the aux fields into the LATEST save (concurrent moves survive)
  await store.withSaveLock(state.id, () => {
    const latest = store.getSave(state.id);
    if (!latest) return;
    for (const job of pending) job.apply(latest);
    store.saveGame(latest);
  });

  if (handled) await narrate(state, events, logStart, actionId, locale);
  // respond from the persisted save so narration and aux merges are already part of it
  const finalState = store.getSave(req.params.id) || state;
  res.json({ state: sanitize(finalState), events, visualEvents, chatReply, chatLanguage:chatReply ? locale : undefined, appearance, appearanceLanguage:appearance ? locale : undefined, portrait });
});

// Marla's shop — buy supplies with gold while near the entrance camp
function buyFromMarla(state, action, events) {
  const item = engine.SHOP_ITEMS.find(i => i.id === action.itemId);
  if (!item) { events.push({ type: 'error', ...presentation.eventMessage("event.game.buyFromMarla.64",[],["Marla does not stock that."]) }); return; }
  const p = engine.playerEntity(state);
  const shopkeeper = state.entities.find(e => e.kind === 'npc' && ['marla', 'perra'].includes(e.npcId));
  if (!shopkeeper || engine.manhattan(shopkeeper, p) > 3) {
    events.push({ type: 'error', ...presentation.eventMessage("event.game.buyFromMarla.65",[],["No trader nearby — find Marla or Perra at the camps to buy supplies."]) });
    return;
  }
  const char = state.character;
  if (char.gold < item.price) {
    events.push({ type: 'error', ...presentation.eventMessage("event.game.buyFromMarla.66",[presentation.name(item,state),item.price,char.gold],["Not enough gold — "," costs "," gp and you carry ","."]) });
    return;
  }
  char.gold -= item.price;
  const inv = char.inventory.find(x => x.itemId === item.id);
  if (inv) inv.qty++; else char.inventory.push({ itemId: item.id, qty: 1 });
  const ev = {
    type: 'shop', narrate: true,
    ...presentation.eventMessage("event.game.buyFromMarla.67",[presentation.name(p,state),presentation.name(item,state),item.price],[""," buys "," from Marla for "," gp. \"Pleasure doing business, dear,\" she says, counting the coin twice."]),
    data: { item: item.id, price: item.price, goldLeft: char.gold }
  };
  events.push(ev); engine.addLog(state, 'mech', presentation.eventMessage("event.game.buyFromMarla.68",[presentation.name(p,state),presentation.name(item,state),item.price,char.gold],[""," buys "," (−"," gp, "," left)."]));
}

function respawnAtCamp(state, events) {
  const map = state.map;
  const p = engine.playerEntity(state);
  const camp = (state.map.victory && state.map.victory.campfire) || map.playerStart;
  p.hp = Math.max(1, Math.ceil(p.hpMax / 2));
  p.hpMax = state.character.hpMax;
  p.x = camp.x; p.y = camp.y;
  p.alive = true; p.conditions = []; p.buffs = []; p.tempHp = 0; p.deathSaves = { succ: 0, fail: 0, stable: false };
  state.mode = 'explore';
  state.flags.failed = false;
  state.flags.reckless = false;
  // revive & reset monsters on EVERY visited map of the world
  if (state.world) {
    Object.keys(state.world).forEach(mapId => {
      const def = engine.getMap(mapId);
      const entry = state.world[mapId];
      entry.ents.filter(e => e.kind === 'monster').forEach(m => {
        const orig = (def.entities.find(x => x.id === m.id)) || {};
        m.alive = true; m.hp = m.hpMax; m.aware = false;
        m.conditions = []; m.buffs = []; m.fled = false;
        if (orig.x !== undefined) { m.x = orig.x; m.y = orig.y; }
      });
    });
    engine.loadWorldMap(state, state.mapId);
  } else {
    const originals = {};
    map.entities.forEach(e => { if (e.type === 'monster') originals[e.id] = e; });
    state.entities.filter(e => e.kind === 'monster').forEach(m => {
      const orig = originals[m.id];
      m.alive = true; m.hp = m.hpMax; m.aware = false;
      m.conditions = []; m.buffs = []; m.fled = false;
      if (orig && !m.fled) { m.x = orig.x; m.y = orig.y; }
    });
  }
  if (state.flags.ally) {
    const ally = state.entities.find(e => e.kind === 'ally');
    if (ally) { ally.alive = true; ally.hp = ally.hpMax; ally.x = p.x + 1; ally.y = p.y; }
  }
  engine.resetSceneAttempts(state);
  const rescuer = (state.flags.ally && (state.entities.find(e => e.kind === 'ally') || {}).name) || 'a mysterious watcher';
  const ev = { type: 'respawn', narrate: true, ...presentation.eventMessage("event.game.respawnAtCamp.69",[presentation.name(state.character,state),rescuer,p.hp,p.hpMax],["Cold water. Torchlight. "," wakes at the camp, aching but alive — dragged back by ",", the dungeon's monsters having returned to their posts. Half your strength remains (","/"," HP)."]) };
  events.push(ev); engine.addLog(state, 'system', ev);
}

// ---------------- class actions ----------------
function handleClassAction(state, action, events) {
  const p = engine.playerEntity(state);
  const char = state.character;
  const id = action.id;
  const inCombat = state.mode === 'combat';
  const spendUse = (key) => {
    if ((char.uses[key] || 0) <= 0) { events.push({ type: 'error', ...presentation.eventMessage("event.game.handleClassAction.70",[],["No uses left — take a rest."]) }); return false; }
    char.uses[key]--; return true;
  };
  const spendBonus = () => {
    if (!inCombat) return null;
    const err = consumeActionEconomy(state, 'bonus');
    if (err) { events.push({ type: 'error', ...err }); return 'err'; }
    return null;
  };

  switch (id) {
    case 'rage': {
      if (!spendUse('rage')) return;
      if (spendBonus() === 'err') { char.uses.rage++; return; }
      engine.addBuff(p, { id: 'rage', rounds: 10 });
      const ev = { type: 'rage', narrate: true, ...presentation.eventMessage("event.game.handleClassAction.71",[presentation.name(p,state)],[""," ROARS with primal fury! Rage burns for 10 rounds: +2 melee damage, resilience to weapons' blows."]) };
      events.push(ev); engine.addLog(state, 'mech', ev);
      break;
    }
    case 'second_wind': {
      if (!spendUse('second_wind')) return;
      if (spendBonus() === 'err') { char.uses.second_wind++; return; }
      const r = engine.rollExpr('1d10');
      engine.healEntity(state, p, r.total + char.level, events, 'Second Wind');
      break;
    }
    case 'bardic_inspiration': {
      const uses = 2 + engine.mod(char.abilities.cha);
      if ((char.uses.bardic_inspiration ?? uses) <= 0) { events.push({ type: 'error', ...presentation.eventMessage("event.game.handleClassAction.72",[],["No Bardic Inspiration left — short rest to recover."]) }); return; }
      char.uses.bardic_inspiration = (char.uses.bardic_inspiration ?? uses) - 1;
      if (spendBonus() === 'err') { char.uses.bardic_inspiration++; return; }
      const dieSize = char.subclass === 'lore' ? 8 : 6; // College of Lore: d8 inspiration
      engine.addBuff(p, { id: 'inspiration', dice: dieSize, rounds: 10 });
      const ev = { type: 'inspiration', narrate: true, ...presentation.eventMessage("event.game.handleClassAction.73",[presentation.name(p,state),dieSize],[""," hums a rallying chord — a d"," of Bardic Inspiration is held in reserve for the next roll."]) };
      events.push(ev); engine.addLog(state, 'mech', ev);
      break;
    }
    case 'divine_spark': {
      if (!spendUse('divine_spark')) return;
      const heal = action.mode === 'heal';
      const r = engine.rollExpr('1d8');
      if (heal) {
        engine.healEntity(state, p, r.total + char.spellcasting.spellMod, events, 'Divine Spark');
      } else {
        const target = state.entities.find(e => e.id === action.targetId && e.kind === 'monster' && e.alive);
        if (!target) { char.uses.divine_spark++; events.push({ type: 'error', ...presentation.eventMessage("event.game.handleClassAction.74",[],["Choose a target."]) }); return; }
        const roll = engine.d20({ reroll1: char.rerollNat1 });
        const total = roll.natural + char.spellcasting.spellAttack;
        if (roll.natural !== 20 && (roll.natural === 1 || total < target.ac)) {
          const ev = { type: 'miss', narrate: true, ...presentation.eventMessage("event.game.handleClassAction.75",[presentation.name(target,state),roll.natural,char.spellcasting.spellAttack,total,target.ac],["Divine Spark fizzles past "," (d20 ","+"," = "," vs AC ",")."]) };
          events.push(ev); engine.addLog(state, 'mech', ev);
        } else {
          const crit = roll.natural === 20;
          let dmg = engine.damageRoll('1d8', { crit }).total + char.spellcasting.spellMod;
          const ev = { type: 'spell_hit', narrate: true, ...presentation.eventMessage("event.game.handleClassAction.76",[presentation.name(target,state),dmg,(crit ? presentation.eventMessage("event.game.handleClassAction.77",[],[" — CRITICAL!"]) : presentation.eventMessage("event.game.handleClassAction.78",[],[""]))],["Divine Spark sears ",": "," radiant damage","."]) };
          events.push(ev); engine.addLog(state, 'mech', ev);
          engine.applyDamage(state, target, dmg, 'radiant', events);
        }
        if (inCombat) consumeActionEconomy(state, 'action');
      }
      break;
    }
    case 'lay_on_hands': {
      const pool = char.pools.lay_on_hands || 0;
      if (pool <= 0) { events.push({ type: 'error', ...presentation.eventMessage("event.game.handleClassAction.79",[],["Lay On Hands pool is empty — long rest to restore."]) }); return; }
      const heal = Math.min(pool, p.hpMax - p.hp);
      if (heal <= 0) { events.push({ type: 'error', ...presentation.eventMessage("event.game.handleClassAction.80",[],["You are already at full health."]) }); return; }
      if (spendBonus() === 'err') return;
      char.pools.lay_on_hands = pool - heal;
      engine.healEntity(state, p, heal, events, 'Lay On Hands');
      break;
    }
    case 'wild_shape': {
      if (!spendUse('wild_shape')) return;
      if (spendBonus() === 'err') { char.uses.wild_shape++; return; }
      engine.addBuff(p, { id: 'wolfform', rounds: 10 });
      const ev = { type: 'wildshape', narrate: true, ...presentation.eventMessage("event.game.handleClassAction.81",[presentation.name(p,state)],[""," twists into wolf shape! Fur and fang for 10 rounds: 40 ft speed, bite attacks using your spellcasting power (1d8)."]) };
      events.push(ev); engine.addLog(state, 'mech', ev);
      break;
    }
    case 'flurry': {
      if ((char.uses.focus || 0) <= 0) { events.push({ type: 'error', ...presentation.eventMessage("event.game.handleClassAction.82",[],["No Focus points left."]) }); return; }
      if (spendBonus() === 'err') return;
      char.uses.focus--;
      const foes = state.entities.filter(e => e.kind === 'monster' && e.alive && engine.manhattan(e, p) <= 1);
      if (!foes.length) { events.push({ type: 'error', ...presentation.eventMessage("event.game.handleClassAction.83",[],["No enemy within reach."]) }); char.uses.focus++; return; }
      engine.addLog(state, 'mech', presentation.eventMessage("event.game.handleClassAction.84",[presentation.name(p,state)],[""," unleashes a flurry of blows!"]));
      foes.slice(0, 2).forEach(f => {
        const monkAtk = char.attacks.find(a => a.weaponId === 'unarmed');
        const fake = { ...monkAtk, bonus: char.profBonus + engine.mod(char.abilities.dex) };
        engine.monsterAttack(state, p, f, fake, events);
        // Way of the Open Hand: flurry hits shove the target back 5 ft
        if (char.subclass === 'openhand' && f.alive !== false) {
          const dx = Math.sign(f.x - p.x), dy = Math.sign(f.y - p.y);
          const nx = f.x + dx, ny = f.y + dy;
          if (!engine.isWall(state, nx, ny) && !engine.entityAt(state, nx, ny)) {
            f.x = nx; f.y = ny;
            engine.addLog(state, 'mech', presentation.eventMessage("event.game.handleClassAction.85",[presentation.name(f,state)],[""," is shoved 5 ft by the open hand!"]));
          }
        }
      });
      break;
    }
    case 'patient_defense': {
      if ((char.uses.focus || 0) <= 0) { events.push({ type: 'error', ...presentation.eventMessage("event.game.handleClassAction.86",[],["No Focus points left."]) }); return; }
      if (spendBonus() === 'err') return;
      char.uses.focus--;
      engine.addBuff(p, { id: 'dodge', rounds: 2 });
      const ev = { type: 'dodge', narrate: true, ...presentation.eventMessage("event.game.handleClassAction.87",[presentation.name(p,state)],[""," slips into a patient defense — attacks against them have disadvantage."]) };
      events.push(ev); engine.addLog(state, 'mech', ev);
      break;
    }
    case 'step_of_wind': {
      if ((char.uses.focus || 0) <= 0) { events.push({ type: 'error', ...presentation.eventMessage("event.game.handleClassAction.88",[],["No Focus points left."]) }); return; }
      if (spendBonus() === 'err') return;
      char.uses.focus--;
      if (action.mode === 'disengage') {
        engine.addBuff(p, { id: 'dodge', rounds: 1 });
        engine.addLog(state, 'mech', presentation.eventMessage("event.game.handleClassAction.89",[presentation.name(p,state)],[""," disengages with the wind's help."]));
      } else {
        if (inCombat) state.combat.movementLeft += engine.currentSpeed(state, p);
        engine.addLog(state, 'mech', presentation.eventMessage("event.game.handleClassAction.90",[presentation.name(p,state)],[""," dashes with the wind's help."]));
      }
      break;
    }
    case 'action_surge': {
      if (!spendUse('action_surge')) return;
      if (inCombat) { state.combat.actionUsed = false; }
      const ev = { type: 'surge', narrate: true, ...presentation.eventMessage("event.game.handleClassAction.91",[presentation.name(p,state)],[""," surges with adrenaline — one more action this turn!"]) };
      events.push(ev); engine.addLog(state, 'mech', ev);
      break;
    }
    case 'cunning_action': {
      if (spendBonus() === 'err') return;
      if (action.mode === 'hide') {
        const check = engine.skillCheck(state, 'stealth', 99);
        state.stealth = check;
        engine.addLog(state, 'mech', presentation.eventMessage("event.game.handleClassAction.92",[presentation.name(p,state),check.total],[""," melts into shadow (Stealth ",")."]));
      } else if (action.mode === 'disengage') {
        engine.addBuff(p, { id: 'dodge', rounds: 1 });
        engine.addLog(state, 'mech', presentation.eventMessage("event.game.handleClassAction.93",[presentation.name(p,state)],[""," disengages nimbly."]));
      } else {
        if (inCombat) state.combat.movementLeft += engine.currentSpeed(state, p);
        engine.addLog(state, 'mech', presentation.eventMessage("event.game.handleClassAction.94",[presentation.name(p,state)],[""," dashes nimbly."]));
      }
      break;
    }
    case 'steady_aim': {
      if (spendBonus() === 'err') return;
      engine.addBuff(p, { id: 'adv_next_attack', rounds: 2 });
      if (inCombat) state.combat.movementLeft = 0;
      const ev = { type: 'steady_aim', narrate: true, ...presentation.eventMessage("event.game.handleClassAction.95",[presentation.name(p,state)],[""," plants their feet and takes careful aim — advantage on the next attack."]) };
      events.push(ev); engine.addLog(state, 'mech', ev);
      break;
    }
    case 'innate_sorcery': {
      if (!spendUse('innate_sorcery')) return;
      if (spendBonus() === 'err') { char.uses.innate_sorcery++; return; }
      engine.addBuff(p, { id: 'innate_sorcery', rounds: 10 });
      const ev = { type: 'innate', narrate: true, ...presentation.eventMessage("event.game.handleClassAction.96",[presentation.name(p,state)],["Reality bends around "," — innate sorcery ignites! Spell attacks gain advantage and save DC +1 for 1 minute."]) };
      events.push(ev); engine.addLog(state, 'mech', ev);
      break;
    }
    case 'magical_cunning': {
      if (!spendUse('magical_cunning')) return;
      char.slots = { ...char.slotsMax };
      const ev = { type: 'mana', narrate: true, ...presentation.eventMessage("event.game.handleClassAction.97",[presentation.name(p,state)],[""," traces sigils of the pact — spell slots surge back."]) };
      events.push(ev); engine.addLog(state, 'mech', ev);
      break;
    }
    case 'breath_weapon': {
      if (!spendUse('breath_weapon')) return;
      if (inCombat) {
        const err = consumeActionEconomy(state, 'action');
        if (err) { char.uses.breath_weapon++; events.push({ type: 'error', ...err }); return; }
      }
      const type = (char.choices.species.ancestry) || 'fire';
      const dc = 8 + engine.mod(char.abilities.con) + char.profBonus;
      const foes = state.entities.filter(e => e.kind === 'monster' && e.alive && engine.manhattan(e, p) <= 5 && engine.los(state, p.x, p.y, e.x, e.y));
      if (!foes.length) { char.uses.breath_weapon++; events.push({ type: 'error', ...presentation.eventMessage("event.game.handleClassAction.98",[],["No enemies in reach of your breath (25 ft)."]) }); return; }
      const ev0 = { type: 'breath', narrate: true, ...presentation.eventMessage("event.game.handleClassAction.99",[presentation.name(p,state),type],[""," inhales — and exhales a cone of ","!"]) };
      events.push(ev0); engine.addLog(state, 'mech', ev0);
      foes.forEach(f => {
        const save = engine.d20({}).natural + engine.mod((f.abilities || {}).dex || 10);
        let dmg = engine.rollExpr('2d6').total;
        if (save >= dc) dmg = Math.floor(dmg / 2);
        engine.addLog(state, 'mech', presentation.eventMessage("event.game.handleClassAction.100",[presentation.name(f,state),save,dc,dmg,type],[""," DEX save "," vs DC "," — "," "," damage."]));
        engine.applyDamage(state, f, dmg, type, events);
      });
      break;
    }
    case 'divine_smite': {
      if (!char.slots[1] || char.slots[1] <= 0) { events.push({ type: 'error', ...presentation.eventMessage("event.game.handleClassAction.101",[],["No spell slots to smite with."]) }); return; }
      if (spendBonus() === 'err') return;
      char.slots[1]--;
      engine.addBuff(p, { id: 'smite_charge', rounds: 1 });
      const ev = { type: 'smite_ready', narrate: true, ...presentation.eventMessage("event.game.handleClassAction.102",[presentation.name(p,state)],[""," calls down divine power — your next weapon hit this turn detonates with +2d8 radiant damage!"]) };
      events.push(ev); engine.addLog(state, 'mech', ev);
      break;
    }
    case 'hunters_mark_free': {
      if (!spendUse('hunters_mark_free')) return;
      const target = state.entities.find(e => e.id === action.targetId && e.kind === 'monster' && e.alive);
      if (!target) { char.uses.hunters_mark_free++; events.push({ type: 'error', ...presentation.eventMessage("event.game.handleClassAction.103",[],["Choose a target to mark."]) }); return; }
      if (inCombat) { const err = consumeActionEconomy(state, 'bonus'); if (err) { char.uses.hunters_mark_free++; events.push({ type: 'error', ...err }); return; } }
      engine.addBuff(target, { id: 'marked', rounds: 60, extraDamage: '1d6', damageType: 'weapon' });
      engine.addBuff(p, { id: 'concentrating', conc: true, rounds: 99, spell: "Hunter's Mark" });
      const ev = { type: 'mark', narrate: true, ...presentation.eventMessage("event.game.handleClassAction.104",[presentation.name(p,state),presentation.name(target,state)],[""," marks "," as prey — weapon hits deal +1d6 damage."]) };
      events.push(ev); engine.addLog(state, 'mech', ev);
      break;
    }
    case 'reckless_toggle': {
      state.flags.reckless = !state.flags.reckless;
      engine.addLog(state, 'mech', presentation.eventMessage("event.game.handleClassAction.105",[(state.flags.reckless ? presentation.eventMessage("event.game.handleClassAction.106",[],["ON — advantage on your STR melee attacks, but enemies strike you easier"]) : presentation.eventMessage("event.game.handleClassAction.107",[],["OFF"]))],["Reckless Attack ","."]));
      break;
    }
    case 'commanders_strike': {
      if (!spendUse('commanders_strike')) return;
      if (inCombat) { const err = consumeActionEconomy(state, 'action'); if (err) { char.uses.commanders_strike++; events.push({ type: 'error', ...err }); return; } }
      const target = state.entities.find(e => e.id === action.targetId && e.kind === 'monster' && e.alive);
      if (!target) { char.uses.commanders_strike++; events.push({ type: 'error', ...presentation.eventMessage("event.game.handleClassAction.108",[],["Choose a target first."]) }); return; }
      if (engine.manhattan(target, p) > (char.attacks[0].ranged ? Math.floor((char.attacks[0].range || 30) / 5) : 1)) {
        char.uses.commanders_strike++; events.push({ type: 'error', ...presentation.eventMessage("event.game.handleClassAction.109",[],["Target out of reach."]) }); return;
      }
      engine.addBuff(p, { id: 'superiority', rounds: 1 });
      const atk = char.attacks.find(a => !a.ranged && a.weaponId !== 'unarmed') || char.attacks[0];
      engine.playerAttack(state, target.id, atk.weaponId, events);
      break;
    }
    case 'berserker_attack': {
      if (!engine.hasBuff(p, 'rage')) { events.push({ type: 'error', ...presentation.eventMessage("event.game.handleClassAction.110",[],["Frenzy requires an active Rage."]) }); return; }
      if (spendBonus() === 'err') return;
      const foes = state.entities.filter(e => e.kind === 'monster' && e.alive && engine.manhattan(e, p) <= 1);
      if (!foes.length) { events.push({ type: 'error', ...presentation.eventMessage("event.game.handleClassAction.111",[],["No enemy within reach."]) }); return; }
      const atk = char.attacks.find(a => !a.ranged && a.weaponId !== 'unarmed') || char.attacks[0];
      engine.monsterAttack(state, p, foes[0], atk, events);
      break;
    }
    case 'sacred_weapon': {
      if (!spendUse('sacred_weapon')) return;
      if (spendBonus() === 'err') { char.uses.sacred_weapon++; return; }
      engine.addBuff(p, { id: 'sacred_weapon', rounds: 10 });
      const ev = { type: 'sacred', narrate: true, ...presentation.eventMessage("event.game.handleClassAction.112",[presentation.name(p,state),Math.max(1, engine.mod(char.abilities.cha))],["","'s weapon blazes with holy light — +1 to attack and +"," radiant damage for 10 rounds!"]) };
      events.push(ev); engine.addLog(state, 'mech', ev);
      break;
    }
    case 'healing_hands': {
      if ((char.uses.healing_hands ?? 1) <= 0) { events.push({ type: 'error', ...presentation.eventMessage("event.game.handleClassAction.113",[],["Healing Hands spent — long rest to recover."]) }); return; }
      char.uses.healing_hands = 0;
      engine.healEntity(state, p, char.level + char.profBonus, events, 'Healing Hands');
      break;
    }
    case 'healer_feat': {
      const kit = char.inventory.find(x => x.itemId === 'healers_kit' && x.qty > 0);
      if (!kit) { events.push({ type: 'error', ...presentation.eventMessage("event.game.handleClassAction.114",[],["No Healer's Kit uses remain."]) }); return; }
      if (inCombat) { const err = consumeActionEconomy(state, 'action'); if (err) { events.push({ type: 'error', ...err }); return; } }
      const r = engine.rollExpr('1d4');
      engine.healEntity(state, p, r.total + 2 + char.level, events, "Healer's Kit");
      break;
    }
    default:
      events.push({ type: 'error', ...presentation.eventMessage("event.game.handleClassAction.115",[],["Unknown class action."]) });
  }
}

router.resolveHistoryBinding = resolveHistoryBinding;
module.exports = router;
