// server/game/action-executor.js
// One authoritative implementation of what a player action costs and what it does. The
// buttons (server/routes/game.js), the bounded natural-language parser/proposals
// (server/game/bounded-actions.js) and the legacy freeform referee (server/game/referee.js)
// all run through these functions, so a typed sentence can never be cheaper than clicking
// the same thing. Rules still belong to the engine: this module spends the action economy
// and calls the engine, it does not re-derive mechanics.

const engine = require('./engine');
const potions = require('./potions');
const presentation = require('./presentation');
const contentContext = require('./content-context');
const content = require('./content');

// ---- action economy -------------------------------------------------------------
// Returns undefined outside combat, null when the slot is free, an error descriptor when
// the slot is already spent.
function consumeActionEconomy(state, kind) {
  if (state.mode !== 'combat') return undefined;
  if (kind === 'action') {
    if (state.combat.actionUsed) return { text: 'Action already used this turn.', messageKey: 'content.actionUsed' };
    state.combat.actionUsed = true;
  } else if (kind === 'bonus') {
    if (state.combat.bonusUsed) return { text: 'Bonus action already used this turn.', messageKey: 'content.bonusUsed' };
    state.combat.bonusUsed = true;
  }
  return null;
}

function isPlayersTurn(state) {
  return state.mode !== 'combat' || !state.combat || state.combat.order[state.combat.turnIdx]?.id === 'player';
}

function turnError() { return { type: 'error', ...presentation.eventMessage('event.game.handler.9', [], ['Not your turn!']) }; }

function economyError(kind) {
  return kind === 'action'
    ? { type: 'error', text: 'Action already used this turn.', messageKey: 'content.actionUsed' }
    : { type: 'error', text: 'Bonus action already used this turn.', messageKey: 'content.bonusUsed' };
}

// Read-only twin of the two checks above: a proposal is validated with this, then executed
// by spend()/consumeActionEconomy so the rules exist once and cannot drift apart.
function actionBlocker(state, kind) {
  if (state.mode !== 'combat') return null;
  if (!isPlayersTurn(state)) return turnError();
  const used = kind === 'action' ? state.combat?.actionUsed : state.combat?.bonusUsed;
  return used ? economyError(kind) : null;
}

// Spend the slot or report why the action cannot happen. Every executor entry uses this.
function spend(state, kind, events) {
  if (state.mode !== 'combat') return true;
  if (!isPlayersTurn(state)) { events.push(turnError()); return false; }
  const err = consumeActionEconomy(state, kind);
  if (err) { events.push({ type: 'error', ...err }); return false; }
  return true;
}

// rolled instances (brews, tokens) vanish once the last one is used
function dropEmptyInstance(char, entry) {
  if (!entry || !entry.uniqueId || !char || !Array.isArray(char.inventory)) return;
  char.inventory = char.inventory.filter(i => i.uniqueId !== entry.uniqueId);
}

// ---- items ----------------------------------------------------------------------
function itemDefinition(state, itemId) {
  return contentContext.gear(state, itemId);
}

// Which slot using this entry spends, or null when it is not something one can use here.
function itemEconomyKind(state, entry) {
  if (entry.kind === 'mystery_potion' || entry.kind === 'delve_token' || entry.itemId === 'mystery_potion') return 'bonus';
  const def = itemDefinition(state, entry.itemId);
  if (def && def.type === 'scroll' && def.spell) {
    const spell = engine.findSpell(def.spell);
    return spell && spell.bonusAction ? 'bonus' : 'action';
  }
  if (def && def.type === 'potion' && def.heal) return 'bonus';
  return null;
}

// The item a sentence means, honoring what the player actually carries: an explicit
// reference (itemId or rolled instance uniqueId) wins, otherwise the first usable healing
// potion. Never silently substitutes a different item than the one asked for.
function resolveItemEntry(state, ref) {
  const char = state.character;
  if (ref) {
    const entry = engine.invEntry(char, ref);
    return entry && entry.qty > 0 ? entry : null;
  }
  return (char.inventory || []).find(i => {
    if (!(i.qty > 0)) return false;
    const def = itemDefinition(state, i.itemId);
    return !!(def && def.type === 'potion' && def.heal);
  }) || null;
}

const normalizeMention = value => String(value || '').toLowerCase().replace(/[’'`"“”]/g, '').trim();

function allItemCandidates(state) {
  const map = new Map();

  // 1. All registered gear from content.listGear()
  try {
    const list = content.listGear();
    for (const g of list) {
      if (g && g.id) map.set(g.id, { id: g.id, def: g, entry: null, invEntry: null });
    }
  } catch {}

  // 2. Draft snapshot gear (if in playtest)
  const snapGear = state?.contentSnapshot?.gear;
  if (snapGear) {
    for (const id of Object.keys(snapGear)) {
      if (snapGear[id]) map.set(id, { id, def: snapGear[id], entry: null, invEntry: null });
    }
  }

  // 3. Built-in potions guarantee
  if (!map.has('potion_healing')) {
    map.set('potion_healing', {
      id: 'potion_healing',
      def: { id: 'potion_healing', name: 'Potion of Healing', type: 'potion', heal: '2d4+2', localized: { 'zh-CN': { name: '治疗药水' }, en: { name: 'Potion of Healing' } } },
      entry: null,
      invEntry: null
    });
  }
  if (!map.has('potion_greater')) {
    map.set('potion_greater', {
      id: 'potion_greater',
      def: { id: 'potion_greater', name: 'Greater Healing Potion', type: 'potion', heal: '4d4+4', localized: { 'zh-CN': { name: '强效治疗药水' }, en: { name: 'Greater Healing Potion' } } },
      entry: null,
      invEntry: null
    });
  }

  // 4. Everything in state.character.inventory
  for (const entry of state?.character?.inventory || []) {
    const key = entry.uniqueId || entry.itemId;
    const existing = map.get(entry.itemId);
    const def = existing?.def || itemDefinition(state, entry.itemId) || { id: entry.itemId, name: entry.name || entry.itemId };

    const isAvailable = (entry.qty > 0) && !!itemEconomyKind(state, entry);
    if (existing) {
      if (!existing.entry && isAvailable) {
        existing.entry = entry;
      }
      existing.invEntry = entry;
    }
    map.set(key, {
      id: key,
      def,
      entry: isAvailable ? entry : null,
      invEntry: entry
    });
  }

  return map;
}

function candidateMentionNames(cand, state) {
  const def = cand.def || {};
  const names = new Set();

  if (def.id) {
    names.add(def.id.toLowerCase());
    names.add(def.id.replace(/_/g, ' ').toLowerCase());
  }
  if (def.name) names.add(def.name.toLowerCase());
  if (def.localized?.en?.name) names.add(def.localized.en.name.toLowerCase());
  if (def.localized?.['zh-CN']?.name) names.add(def.localized['zh-CN'].name);
  if (cand.invEntry?.name) names.add(cand.invEntry.name.toLowerCase());
  if (cand.invEntry?.uniqueId) names.add(cand.invEntry.uniqueId.toLowerCase());

  // Specific synonyms for standard potions
  if (def.id === 'potion_greater') {
    names.add('greater healing potion');
    names.add('greater potion');
    names.add('greater heal potion');
    names.add('potion_greater_healing');
    names.add('potion greater healing');
    names.add('强效治疗药水');
    names.add('强效药水');
  } else if (def.id === 'potion_healing') {
    names.add('potion of healing');
    names.add('healing potion');
    names.add('regular healing potion');
    names.add('ordinary healing potion');
    names.add('普通治疗药水');
    names.add('普通药水');
    names.add('治疗药水');
  }

  const result = [];
  for (const n of names) {
    const norm = normalizeMention(n);
    if (!norm) continue;
    // Exclude generic words
    if (['potion', 'potions', '药水', '药', 'item'].includes(norm)) continue;
    if (norm.length >= 4 || (/[\u4e00-\u9fa5]/.test(norm) && norm.length >= 2)) {
      result.push(norm);
    }
  }
  return result;
}

// Inspect across all known items whether the sentence explicitly names one.
// Avoids shorter substring false-matches by always choosing the longest matching name.
function findMentionedItem(state, sentence) {
  const text = normalizeMention(sentence);
  if (!text) return null;

  const candidates = allItemCandidates(state);
  let best = null;

  for (const cand of candidates.values()) {
    for (const name of candidateMentionNames(cand, state)) {
      let matched = false;
      if (/[\u4e00-\u9fa5]/.test(name)) {
        matched = text.includes(name);
      } else {
        const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        matched = new RegExp(`(^|\\b|\\s)${escaped}(\\b|\\s|$)`, 'i').test(text);
      }
      if (matched) {
        if (!best || name.length > best.length) {
          best = { cand, length: name.length, name };
        }
      }
    }
  }

  if (!best) return null;
  return {
    id: best.cand.id,
    def: best.cand.def,
    entry: best.cand.entry
  };
}

// Which carried item a sentence is naming: the most specific match wins, so asking for the
// greater healing potion can never quietly drink the ordinary one.
function resolveMentionedItem(state, sentence) {
  const match = findMentionedItem(state, sentence);
  return match ? match.entry : null;
}

// A sentence that asks for a potion without naming one still goes through useItem, so the
// same bonus-action economy, the same instance and the same heal dice apply. A sentence that
// names a specific potion is resolved to that instance first; if explicitly named but missing,
// it errors and does not fall back to another brew.
function drinkPotion(state, ref, events, sentence) {
  if (ref) {
    const entry = resolveItemEntry(state, ref);
    if (!entry) {
      events.push({ type: 'error', ...presentation.eventMessage('event.referee.resolveFreeform.18', [], ['You have no potions left.']) });
      return false;
    }
    return useItem(state, { itemId: entry.uniqueId || entry.itemId }, events);
  }

  if (sentence) {
    const mentioned = findMentionedItem(state, sentence);
    if (mentioned) {
      if (!mentioned.entry || !(mentioned.entry.qty > 0)) {
        events.push({ type: 'error', ...presentation.eventMessage('event.referee.resolveFreeform.18', [], ['You have no potions left.']) });
        return false;
      }
      return useItem(state, { itemId: mentioned.entry.uniqueId || mentioned.entry.itemId }, events);
    }
  }

  const entry = resolveItemEntry(state, null);
  if (!entry) {
    events.push({ type: 'error', ...presentation.eventMessage('event.referee.resolveFreeform.18', [], ['You have no potions left.']) });
    return false;
  }
  return useItem(state, { itemId: entry.uniqueId || entry.itemId }, events);
}

// The authoritative item use: brews and tokens first (their result was rolled at purchase),
// then scrolls, then healing potions.
function useItem(state, action, events) {
  const entry = engine.invEntry(state.character, action.itemId);
  if (!entry || !(entry.qty > 0)) {
    events.push({ type: 'error', ...presentation.eventMessage('event.game.handler.12', [], ['None left.']) });
    return false;
  }
  const kind = itemEconomyKind(state, entry);
  if (!kind) {
    events.push({ type: 'error', ...presentation.eventMessage('event.game.handler.18', [], ['Cannot use that item right now.']) });
    return false;
  }

  if (entry.kind === 'mystery_potion' || entry.itemId === 'mystery_potion') {
    if (!spend(state, 'bonus', events)) return false;
    entry.qty--;
    if (entry.qty <= 0) dropEmptyInstance(state.character, entry);
    const brewCtx = {
      engine, state, char: state.character, p: engine.playerEntity(state), events,
      roll: expr => engine.rollExpr(expr)
    };
    const drunk = potions.drinkMysteryPotion(entry, brewCtx);
    if (drunk) engine.addLog(state, 'mech', presentation.eventMessage('event.game.handler.13', [presentation.name(state.character, state), presentation.name(entry, state), drunk.text, entry.qty], ['', ' drains the ', ' — ', '. ', ' remaining.']));
    return true;
  }

  if (entry.kind === 'delve_token') {
    if (!spend(state, 'bonus', events)) return false;
    entry.qty--;
    if (entry.qty <= 0) dropEmptyInstance(state.character, entry);
    potions.useToken(entry, {
      engine, state, char: state.character, p: engine.playerEntity(state), events,
      roll: expr => engine.rollExpr(expr), rng: Math.random
    });
    engine.addLog(state, 'mech', presentation.eventMessage('event.game.handler.14', [presentation.name(state.character, state), presentation.name(entry, state), entry.qty], ['', ' uses the ', '. ', ' remaining.']));
    return true;
  }

  const gearDef = itemDefinition(state, entry.itemId);

  // scrolls: cast the stored spell once — no spell slot needed
  if (gearDef && gearDef.type === 'scroll' && gearDef.spell) {
    const spell = engine.findSpell(gearDef.spell);
    if (!spell) {
      events.push({ type: 'error', ...presentation.eventMessage('event.game.handler.15', [], ['The scroll is blank?!']) });
      return false;
    }
    if (!spend(state, spell.bonusAction ? 'bonus' : 'action', events)) return false;
    // give scrollcasters a workable casting stat if they have none
    if (!state.character.spellcasting) {
      state.character.spellcasting = { ability: 'int', spellMod: 2, saveDc: 12, spellAttack: 4, cantrips: [], spells: [], freeSpell: { id: null, max: 0 } };
    }
    const scrollTarget = spell.target === 'self' || spell.target === 'ally' ? 'player' : action.targetId;
    if (['enemy', 'burst'].includes(spell.target) && !scrollTarget) {
      events.push({ type: 'error', ...presentation.eventMessage('event.game.handler.16', [], ['Target a creature first, then use the scroll.']) });
      return false;
    }
    entry.qty--;
    engine.castSpell(state, gearDef.spell, scrollTarget, events, { free: true });
    engine.addLog(state, 'mech', presentation.eventMessage('event.game.handler.17', [presentation.name(engine.playerEntity(state), state), presentation.name(gearDef, state), entry.qty], ['', ' reads a ', '. ', ' remaining.']));
    return true;
  }

  if (!gearDef || gearDef.type !== 'potion' || !gearDef.heal) {
    events.push({ type: 'error', ...presentation.eventMessage('event.game.handler.18', [], ['Cannot use that item right now.']) });
    return false;
  }
  if (!spend(state, 'bonus', events)) return false;
  entry.qty--;
  const r = engine.rollExpr(gearDef.heal);
  engine.healEntity(state, engine.playerEntity(state), r.total, events, gearDef.name);
  engine.addLog(state, 'mech', presentation.eventMessage('event.game.handler.19', [presentation.name(engine.playerEntity(state), state), presentation.name(gearDef, state), gearDef.heal, entry.qty], ['', ' drinks a ', ' (', '). ', ' remaining.']));
  return true;
}

// ---- attacks --------------------------------------------------------------------
function attack(state, action, events) {
  const target = state.entities.find(e => e.id === action.targetId && e.kind === 'monster' && e.alive && !e.fled);
  const objTarget = !target
    ? state.objects.find(o => o.id === action.targetId && (o.type === 'barrel' || o.type === 'spores') && !o.exploded && !o.burst)
    : null;
  if (!target && !objTarget) {
    events.push({ type: 'error', ...presentation.eventMessage('event.game.handler.8', [], ['Choose a target first.']) });
    return false;
  }
  if (target && state.mode === 'explore') {
    target.aware = true;
    const p = engine.playerEntity(state);
    const nearby = state.entities.filter(m => m.kind === 'monster' && m.alive && !m.fled && engine.manhattan(m, p) <= 3).map(m => m.id);
    engine.startCombat(state, [target.id, ...nearby], events);
  }
  if (!spend(state, 'action', events)) return false;
  engine.playerAttack(state, target ? target.id : objTarget.id, action.weaponId, events);
  return true;
}

// Read-only twin of attack(): what would stop this attack right now.
function attackBlocker(state, targetId) {
  const target = state.entities.find(e => e.id === targetId && e.kind === 'monster' && e.alive && !e.fled);
  const objectTarget = !target ? state.objects.find(o => o.id === targetId && (o.type === 'barrel' || o.type === 'spores') && !o.exploded && !o.burst) : null;
  if (!target && !objectTarget) return { valid: false, error: 'Target monster does not exist or is dead.' };
  const economy = actionBlocker(state, 'action');
  if (economy) return { valid: false, error: economy.text, messageKey: economy.messageKey };
  return { valid: true };
}

// ---- searching ------------------------------------------------------------------
// One search rule for the legacy "search" command and the bounded "investigate" intent:
// the engine may reveal traps the hero had not spotted, and the hero keeps finding them
// without the model ever being told those traps exist up front.
function searchArea(state, events) {
  const p = engine.playerEntity(state);
  const char = state.character;
  let found = false;
  let checked = false;
  state.objects
    .filter(o => o.type === 'trap' && !o.revealed && !o.triggered && engine.manhattan(o, p) <= 2)
    .forEach(trap => {
      checked = true;
      const check = engine.skillCheck(state, 'investigation', 12);
      if (check.success) {
        trap.revealed = true; found = true;
        const ev = {
          type: 'trap_found', narrate: true,
          ...presentation.eventMessage('event.referee.resolveFreeform.2', [presentation.name(p, state), presentation.name(trap, state), check.detail], ['Searching carefully, ', ' finds a ', ' hidden on the floor (Investigation ', '). Avoid it — or disarm it from an adjacent tile.'])
        };
        events.push(ev); engine.addLog(state, 'mech', ev);
      } else {
        const ev = {
          type: 'info', narrate: true,
          ...presentation.eventMessage('event.referee.resolveFreeform.3', [presentation.name(p, state), check.detail], ['', ' searches (Investigation ', ') but finds nothing amiss... though the floor here makes you uneasy.'])
        };
        events.push(ev);
      }
    });
  // Morthek's gift: searching the dying adventurer
  const morthek = state.entities.find(e => e.kind === 'npc' && e.npcId === 'morthek' && engine.manhattan(e, p) <= 2);
  if (morthek && !state.flags.morthek_potion) {
    state.flags.morthek_potion = true;
    const inv = char.inventory.find(x => x.itemId === 'potion_healing');
    if (inv) inv.qty++; else char.inventory.push({ itemId: 'potion_healing', qty: 1 });
    const ev = { type: 'loot', narrate: true, ...presentation.eventMessage('event.referee.resolveFreeform.4', [], ['Morthek presses a Potion of Healing into your hands with shaking fingers. "For luck," he rasps. "You\'ll need it."']) };
    events.push(ev); engine.addLog(state, 'mech', ev);
  }
  if (!found && !checked && !state.flags.morthek_potion) {
    const ev = { type: 'info', narrate: true, ...presentation.eventMessage('event.referee.resolveFreeform.5', [presentation.name(p, state)], ['', ' searches the area but finds nothing of note.']) };
    events.push(ev);
  }
  return { found, checked };
}

module.exports = {
  consumeActionEconomy,
  isPlayersTurn,
  actionBlocker,
  attackBlocker,
  turnError,
  economyError,
  spend,
  itemEconomyKind,
  itemDefinition,
  resolveItemEntry,
  resolveMentionedItem,
  findMentionedItem,
  useItem,
  drinkPotion,
  attack,
  searchArea,
  dropEmptyInstance
};
