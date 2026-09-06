const express = require('express');
const store = require('../store');
const engine = require('../game/engine');
const referee = require('../game/referee');
const dm = require('../game/dm');

const router = express.Router();

// ---------------- helpers ----------------
function findCharacter(id) { return store.getCharacters().find(c => c.id === id); }

function sanitize(state) {
  const view = JSON.parse(JSON.stringify(state));
  view.objects = view.objects.filter(o => !(o.type === 'trap' && !o.revealed && !o.triggered));
  view.map.entities = undefined; // originals no longer needed client-side
  view.visible = engine.computeVision(state);
  return view;
}

async function narrate(state, events, logStartIndex) {
  const narratable = events.filter(e => e.narrate);
  if (!narratable.length) return;
  const text = await dm.narrateEvents(state, narratable);
  if (text) {
    // drop the canned scene line for this action if the DM voiced it instead
    state.log = state.log.filter((l, i) => !(i >= logStartIndex && l.kind === 'dm_canned'));
    engine.addLog(state, 'dm', text);
  }
}

function consumeActionEconomy(state, kind) {
  if (state.mode !== 'combat') return;
  if (kind === 'action') {
    if (state.combat.actionUsed) return 'Action already used this turn.';
    state.combat.actionUsed = true;
  } else if (kind === 'bonus') {
    if (state.combat.bonusUsed) return 'Bonus action already used this turn.';
    state.combat.bonusUsed = true;
  }
  return null;
}

function requireAlive(state, events) {
  if (state.mode === 'over') { events.push({ type: 'error', text: 'You have fallen. Recover at camp to continue.' }); return false; }
  if (state.mode === 'victory') { events.push({ type: 'error', text: 'The delve is complete — victory!' }); return false; }
  return true;
}

// ---------------- routes ----------------
router.post('/start', async (req, res) => {
  const { characterId, bringAlly } = req.body || {};
  const char = findCharacter(characterId);
  if (!char) return res.status(404).json({ error: 'Character not found' });
  const state = engine.startGame(char, { bringAlly: !!bringAlly });
  const events = [];
  const intro = {
    type: 'scene', narrate: true,
    text: `The crypt door grinds shut behind ${char.name}. Only the campfire's glow and the dark ahead. Somewhere below waits the Relic of the Sunless Crypt.`
  };
  events.push(intro);
  engine.addLog(state, 'dm_canned', intro.text);
  store.saveGame(state);
  await narrate(state, events, state.log.length - 1);
  res.json({ state: sanitize(state), events });
});

router.get('/:id', (req, res) => {
  const state = store.getSave(req.params.id);
  if (!state) return res.status(404).json({ error: 'Save not found' });
  res.json({ state: sanitize(state) });
});

router.delete('/:id', (req, res) => {
  store.deleteSave(req.params.id);
  res.json({ ok: true });
});

router.get('/', (req, res) => {
  res.json(store.listSaves());
});

// main action endpoint
router.post('/:id/action', async (req, res) => {
  const state = store.getSave(req.params.id);
  if (!state) return res.status(404).json({ error: 'Save not found' });
  const action = req.body || {};
  const events = [];
  const logStart = state.log.length;
  let chatReply = null;
  let handled = true;

  try {
    if (action.type === 'respawn') {
      respawnAtCamp(state, events);
    } else if (requireAlive(state, events)) {
      switch (action.type) {
        case 'move': {
          engine.movePlayer(state, +action.x, +action.y, events);
          break;
        }
        case 'attack': {
          const target = state.entities.find(e => e.id === action.targetId && e.kind === 'monster' && e.alive);
          if (!target) { events.push({ type: 'error', text: 'Choose a target first.' }); break; }
          if (state.mode === 'explore') {
            target.aware = true;
            const nearby = state.entities.filter(m => m.kind === 'monster' && m.alive && !m.fled && engine.manhattan(m, engine.playerEntity(state)) <= 3).map(m => m.id);
            engine.startCombat(state, [target.id, ...nearby], events);
          }
          if (state.mode === 'combat' && state.combat.order[state.combat.turnIdx].id !== 'player') {
            events.push({ type: 'error', text: 'Not your turn!' }); break;
          }
          const econErr = consumeActionEconomy(state, 'action');
          if (econErr) { events.push({ type: 'error', text: econErr }); break; }
          engine.playerAttack(state, target.id, action.weaponId, events);
          break;
        }
        case 'cast': {
          if (state.mode === 'combat' && state.combat.order[state.combat.turnIdx].id !== 'player') {
            events.push({ type: 'error', text: 'Not your turn!' }); break;
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
            events.push({ type: 'error', text: 'Not your turn!' }); break;
          }
          handleClassAction(state, action, events);
          break;
        }
        case 'useItem': {
          if (action.itemId === 'potion_healing') {
            const inv = state.character.inventory.find(x => x.itemId === 'potion_healing' && x.qty > 0);
            if (!inv) { events.push({ type: 'error', text: 'No potions left.' }); break; }
            if (state.mode === 'combat') {
              const econErr = consumeActionEconomy(state, 'bonus');
              if (econErr) { events.push({ type: 'error', text: econErr }); break; }
            }
            inv.qty--;
            const r = engine.rollExpr('2d4+2');
            engine.healEntity(state, engine.playerEntity(state), r.total, events, 'Potion of Healing');
            engine.addLog(state, 'mech', `${engine.playerEntity(state).name} drinks a Potion of Healing. ${inv.qty} remaining.`);
          } else {
            events.push({ type: 'error', text: 'Cannot use that item right now.' });
          }
          break;
        }
        case 'dash': {
          if (state.mode === 'combat') {
            if (state.combat.order[state.combat.turnIdx].id !== 'player') { events.push({ type: 'error', text: 'Not your turn!' }); break; }
            const econErr = consumeActionEconomy(state, 'action');
            if (econErr) { events.push({ type: 'error', text: econErr }); break; }
            state.combat.movementLeft += engine.currentSpeed(state, engine.playerEntity(state));
            if (state.character.dashTempHp) {
              const p = engine.playerEntity(state);
              p.tempHp = (p.tempHp || 0) + state.character.profBonus;
              engine.addLog(state, 'mech', `Adrenaline Rush: +${state.character.profBonus} temporary HP!`);
            }
            const ev = { type: 'dash', narrate: true, text: `${engine.playerEntity(state).name} dashes across the stone!` };
            events.push(ev); engine.addLog(state, 'mech', ev.text);
          } else events.push({ type: 'error', text: 'Dash matters only in combat.' });
          break;
        }
        case 'dodge': {
          if (state.mode === 'combat') {
            if (state.combat.order[state.combat.turnIdx].id !== 'player') { events.push({ type: 'error', text: 'Not your turn!' }); break; }
            const econErr = consumeActionEconomy(state, 'action');
            if (econErr) { events.push({ type: 'error', text: econErr }); break; }
            engine.addBuff(engine.playerEntity(state), { id: 'dodge', rounds: 2 });
            const ev = { type: 'dodge', narrate: true, text: `${engine.playerEntity(state).name} takes a defensive stance — attacks against them have disadvantage.` };
            events.push(ev); engine.addLog(state, 'mech', ev.text);
          } else events.push({ type: 'error', text: 'Dodge matters only in combat.' });
          break;
        }
        case 'interact': {
          engine.interactObject(state, action.objectId, events);
          break;
        }
        case 'endTurn': {
          engine.endTurn(state, events);
          break;
        }
        case 'rest': {
          if (action.kind === 'long') engine.longRest(state, events);
          else engine.shortRest(state, events);
          break;
        }
        case 'freeform': {
          const text = String(action.text || '').slice(0, 300).trim();
          if (!text) break;
          engine.addLog(state, 'player', text);
          const result = referee.resolveFreeform(state, text);
          events.push(...result.events);
          if (!result.handled) {
            const flavor = await dm.freeformFlavor(state, text);
            engine.addLog(state, 'dm', flavor);
          }
          break;
        }
        case 'chat': {
          const npcId = action.npcId;
          const npcEnt = state.entities.find(e => e.kind === 'npc' && e.npcId === npcId);
          const text = String(action.text || '').slice(0, 300).trim();
          if (!npcEnt) { events.push({ type: 'error', text: 'That NPC is not here.' }); break; }
          if (engine.manhattan(npcEnt, engine.playerEntity(state)) > 5) { events.push({ type: 'error', text: 'Move closer to speak with them.' }); break; }
          engine.addLog(state, 'player', `${text}  (to ${npcEnt.name})`);
          if (npcId === 'morthek' && !state.flags.morthek_potion) {
            state.flags.morthek_potion = true;
            const inv = state.character.inventory.find(x => x.itemId === 'potion_healing');
            if (inv) inv.qty++; else state.character.inventory.push({ itemId: 'potion_healing', qty: 1 });
            engine.addLog(state, 'mech', 'Morthek presses a Potion of Healing into your hands.');
          }
          chatReply = await dm.npcChat(state, npcId, text);
          engine.addLog(state, 'npc', `${npcEnt.name}: "${chatReply}"`);
          break;
        }
        case 'respawn': {
          if (state.mode !== 'over') { events.push({ type: 'error', text: 'You are not fallen.' }); break; }
          respawnAtCamp(state, events);
          break;
        }
        default:
          handled = false;
          events.push({ type: 'error', text: 'Unknown action.' });
      }
    }
  } catch (e) {
    console.error(e);
    events.push({ type: 'error', text: 'Something went wrong: ' + e.message });
  }

  if (state.mode !== 'over' && state.mode !== 'victory') engine.checkCombatEnd(state, events);
  state.updatedAt = Date.now();
  store.saveGame(state);
  if (handled) await narrate(state, events, logStart);
  res.json({ state: sanitize(state), events, chatReply });
});

function respawnAtCamp(state, events) {
  const map = state.map;
  const p = engine.playerEntity(state);
  p.hp = Math.max(1, Math.ceil(p.hpMax / 2));
  p.hpMax = state.character.hpMax;
  p.x = map.playerStart.x; p.y = map.playerStart.y;
  p.alive = true; p.conditions = []; p.buffs = []; p.tempHp = 0;
  state.mode = 'explore';
  state.flags.failed = false;
  state.flags.reckless = false;
  // revive & reset monsters to their original posts
  const originals = {};
  map.entities.forEach(e => { if (e.type === 'monster') originals[e.id] = e; });
  state.entities.filter(e => e.kind === 'monster').forEach(m => {
    const orig = originals[m.id];
    m.alive = true; m.hp = m.hpMax; m.aware = false;
    m.conditions = []; m.buffs = [];
    if (m.fled && orig) { m.fled = false; }
    if (orig && !m.fled) { m.x = orig.x; m.y = orig.y; }
  });
  if (state.flags.ally) {
    const ally = state.entities.find(e => e.kind === 'ally');
    if (ally) { ally.alive = true; ally.hp = ally.hpMax; ally.x = map.playerStart.x + 1; ally.y = map.playerStart.y; }
  }
  const ev = { type: 'respawn', narrate: true, text: `Cold water. Torchlight. ${state.character.name} wakes at the entrance camp, aching but alive — dragged back by Bram, the crypt's monsters having returned to their posts. Half your strength remains (${p.hp}/${p.hpMax} HP).` };
  events.push(ev); engine.addLog(state, 'system', ev.text);
}

// ---------------- class actions ----------------
function handleClassAction(state, action, events) {
  const p = engine.playerEntity(state);
  const char = state.character;
  const cls = engine.byId(engine.CLASSES, char.className);
  const id = action.id;
  const inCombat = state.mode === 'combat';
  const spendUse = (key) => {
    if ((char.uses[key] || 0) <= 0) { events.push({ type: 'error', text: 'No uses left — take a rest.' }); return false; }
    char.uses[key]--; return true;
  };
  const spendBonus = () => {
    if (!inCombat) return null;
    const err = consumeActionEconomy(state, 'bonus');
    if (err) { events.push({ type: 'error', text: err }); return 'err'; }
    return null;
  };

  switch (id) {
    case 'rage': {
      if (!spendUse('rage')) return;
      if (spendBonus() === 'err') { char.uses.rage++; return; }
      engine.addBuff(p, { id: 'rage', rounds: 10 });
      const ev = { type: 'rage', narrate: true, text: `${p.name} ROARS with primal fury! Rage burns for 10 rounds: +2 melee damage, resilience to weapons' blows.` };
      events.push(ev); engine.addLog(state, 'mech', ev.text);
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
      if ((char.uses.bardic_inspiration ?? uses) <= 0) { events.push({ type: 'error', text: 'No Bardic Inspiration left — short rest to recover.' }); return; }
      char.uses.bardic_inspiration = (char.uses.bardic_inspiration ?? uses) - 1;
      if (spendBonus() === 'err') { char.uses.bardic_inspiration++; return; }
      engine.addBuff(p, { id: 'inspiration', dice: 6, rounds: 10 });
      const ev = { type: 'inspiration', narrate: true, text: `${p.name} hums a rallying chord — a d6 of Bardic Inspiration is held in reserve for the next roll.` };
      events.push(ev); engine.addLog(state, 'mech', ev.text);
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
        if (!target) { char.uses.divine_spark++; events.push({ type: 'error', text: 'Choose a target.' }); return; }
        const roll = engine.d20({ reroll1: char.rerollNat1 });
        const total = roll.natural + char.spellcasting.spellAttack;
        if (roll.natural !== 20 && (roll.natural === 1 || total < target.ac)) {
          const ev = { type: 'miss', narrate: true, text: `Divine Spark fizzles past ${target.name} (d20 ${roll.natural}+${char.spellcasting.spellAttack} = ${total} vs AC ${target.ac}).` };
          events.push(ev); engine.addLog(state, 'mech', ev.text);
        } else {
          const crit = roll.natural === 20;
          let dmg = engine.damageRoll('1d8', { crit }).total + char.spellcasting.spellMod;
          const ev = { type: 'spell_hit', narrate: true, text: `Divine Spark sears ${target.name}: ${dmg} radiant damage${crit ? ' — CRITICAL!' : ''}.` };
          events.push(ev); engine.addLog(state, 'mech', ev.text);
          engine.applyDamage(state, target, dmg, 'radiant', events);
        }
        if (inCombat) consumeActionEconomy(state, 'action');
      }
      break;
    }
    case 'lay_on_hands': {
      const pool = char.pools.lay_on_hands || 0;
      if (pool <= 0) { events.push({ type: 'error', text: 'Lay On Hands pool is empty — long rest to restore.' }); return; }
      const heal = Math.min(pool, p.hpMax - p.hp);
      if (heal <= 0) { events.push({ type: 'error', text: 'You are already at full health.' }); return; }
      if (spendBonus() === 'err') return;
      char.pools.lay_on_hands = pool - heal;
      engine.healEntity(state, p, heal, events, 'Lay On Hands');
      break;
    }
    case 'wild_shape': {
      if (!spendUse('wild_shape')) return;
      if (spendBonus() === 'err') { char.uses.wild_shape++; return; }
      engine.addBuff(p, { id: 'wolfform', rounds: 10 });
      const ev = { type: 'wildshape', narrate: true, text: `${p.name} twists into wolf shape! Fur and fang for 10 rounds: 40 ft speed, bite attacks using your spellcasting power (1d8).` };
      events.push(ev); engine.addLog(state, 'mech', ev.text);
      break;
    }
    case 'flurry': {
      if ((char.uses.focus || 0) <= 0) { events.push({ type: 'error', text: 'No Focus points left.' }); return; }
      if (spendBonus() === 'err') return;
      char.uses.focus--;
      const foes = state.entities.filter(e => e.kind === 'monster' && e.alive && engine.manhattan(e, p) <= 1);
      if (!foes.length) { events.push({ type: 'error', text: 'No enemy within reach.' }); char.uses.focus++; return; }
      engine.addLog(state, 'mech', `${p.name} unleashes a flurry of blows!`);
      foes.slice(0, 2).forEach(f => {
        const monkAtk = char.attacks.find(a => a.weaponId === 'unarmed');
        const fake = { ...monkAtk, bonus: char.profBonus + engine.mod(char.abilities.dex) };
        engine.monsterAttack(state, p, f, fake, events);
      });
      break;
    }
    case 'patient_defense': {
      if ((char.uses.focus || 0) <= 0) { events.push({ type: 'error', text: 'No Focus points left.' }); return; }
      if (spendBonus() === 'err') return;
      char.uses.focus--;
      engine.addBuff(p, { id: 'dodge', rounds: 2 });
      const ev = { type: 'dodge', narrate: true, text: `${p.name} slips into a patient defense — attacks against them have disadvantage.` };
      events.push(ev); engine.addLog(state, 'mech', ev.text);
      break;
    }
    case 'step_of_wind': {
      if ((char.uses.focus || 0) <= 0) { events.push({ type: 'error', text: 'No Focus points left.' }); return; }
      if (spendBonus() === 'err') return;
      char.uses.focus--;
      if (action.mode === 'disengage') {
        engine.addBuff(p, { id: 'dodge', rounds: 1 });
        engine.addLog(state, 'mech', `${p.name} disengages with the wind's help.`);
      } else {
        if (inCombat) state.combat.movementLeft += engine.currentSpeed(state, p);
        engine.addLog(state, 'mech', `${p.name} dashes with the wind's help.`);
      }
      break;
    }
    case 'action_surge': {
      if (!spendUse('action_surge')) return;
      if (inCombat) { state.combat.actionUsed = false; }
      const ev = { type: 'surge', narrate: true, text: `${p.name} surges with adrenaline — one more action this turn!` };
      events.push(ev); engine.addLog(state, 'mech', ev.text);
      break;
    }
    case 'cunning_action': {
      if (spendBonus() === 'err') return;
      if (action.mode === 'hide') {
        const check = engine.skillCheck(state, 'stealth', 99);
        state.stealth = check;
        engine.addLog(state, 'mech', `${p.name} melts into shadow (Stealth ${check.total}).`);
      } else if (action.mode === 'disengage') {
        engine.addBuff(p, { id: 'dodge', rounds: 1 });
        engine.addLog(state, 'mech', `${p.name} disengages nimbly.`);
      } else {
        if (inCombat) state.combat.movementLeft += engine.currentSpeed(state, p);
        engine.addLog(state, 'mech', `${p.name} dashes nimbly.`);
      }
      break;
    }
    case 'steady_aim': {
      if (spendBonus() === 'err') return;
      engine.addBuff(p, { id: 'adv_next_attack', rounds: 2 });
      if (inCombat) state.combat.movementLeft = 0;
      const ev = { type: 'steady_aim', narrate: true, text: `${p.name} plants their feet and takes careful aim — advantage on the next attack.` };
      events.push(ev); engine.addLog(state, 'mech', ev.text);
      break;
    }
    case 'innate_sorcery': {
      if (!spendUse('innate_sorcery')) return;
      if (spendBonus() === 'err') { char.uses.innate_sorcery++; return; }
      engine.addBuff(p, { id: 'innate_sorcery', rounds: 10 });
      const ev = { type: 'innate', narrate: true, text: `Reality bends around ${p.name} — innate sorcery ignites! Spell attacks gain advantage and save DC +1 for 1 minute.` };
      events.push(ev); engine.addLog(state, 'mech', ev.text);
      break;
    }
    case 'magical_cunning': {
      if (!spendUse('magical_cunning')) return;
      char.slots = { ...char.slotsMax };
      const ev = { type: 'mana', narrate: true, text: `${p.name} traces sigils of the pact — spell slots surge back.` };
      events.push(ev); engine.addLog(state, 'mech', ev.text);
      break;
    }
    case 'breath_weapon': {
      if (!spendUse('breath_weapon')) return;
      if (inCombat) {
        const err = consumeActionEconomy(state, 'action');
        if (err) { char.uses.breath_weapon++; events.push({ type: 'error', text: err }); return; }
      }
      const type = (char.choices.species.ancestry) || 'fire';
      const dc = 8 + engine.mod(char.abilities.con) + char.profBonus;
      const foes = state.entities.filter(e => e.kind === 'monster' && e.alive && engine.manhattan(e, p) <= 5 && engine.los(state, p.x, p.y, e.x, e.y));
      if (!foes.length) { char.uses.breath_weapon++; events.push({ type: 'error', text: 'No enemies in reach of your breath (25 ft).' }); return; }
      const ev0 = { type: 'breath', narrate: true, text: `${p.name} inhales — and exhales a cone of ${type}!` };
      events.push(ev0); engine.addLog(state, 'mech', ev0.text);
      foes.forEach(f => {
        const save = engine.d20({}).natural + engine.mod((f.abilities || {}).dex || 10);
        let dmg = engine.rollExpr('2d6').total;
        if (save >= dc) dmg = Math.floor(dmg / 2);
        engine.addLog(state, 'mech', `${f.name} DEX save ${save} vs DC ${dc} — ${dmg} ${type} damage.`);
        engine.applyDamage(state, f, dmg, type, events);
      });
      break;
    }
    case 'divine_smite': {
      if (!char.slots[1] || char.slots[1] <= 0) { events.push({ type: 'error', text: 'No spell slots to smite with.' }); return; }
      if (spendBonus() === 'err') return;
      char.slots[1]--;
      engine.addBuff(p, { id: 'smite_charge', rounds: 1 });
      const ev = { type: 'smite_ready', narrate: true, text: `${p.name} calls down divine power — your next weapon hit this turn detonates with +2d8 radiant damage!` };
      events.push(ev); engine.addLog(state, 'mech', ev.text);
      break;
    }
    case 'hunters_mark_free': {
      if (!spendUse('hunters_mark_free')) return;
      const target = state.entities.find(e => e.id === action.targetId && e.kind === 'monster' && e.alive);
      if (!target) { char.uses.hunters_mark_free++; events.push({ type: 'error', text: 'Choose a target to mark.' }); return; }
      if (inCombat) { const err = consumeActionEconomy(state, 'bonus'); if (err) { char.uses.hunters_mark_free++; events.push({ type: 'error', text: err }); return; } }
      engine.addBuff(target, { id: 'marked', rounds: 60, extraDamage: '1d6', damageType: 'weapon' });
      engine.addBuff(p, { id: 'concentrating', conc: true, rounds: 99, spell: "Hunter's Mark" });
      const ev = { type: 'mark', narrate: true, text: `${p.name} marks ${target.name} as prey — weapon hits deal +1d6 damage.` };
      events.push(ev); engine.addLog(state, 'mech', ev.text);
      break;
    }
    case 'reckless_toggle': {
      state.flags.reckless = !state.flags.reckless;
      engine.addLog(state, 'mech', `Reckless Attack ${state.flags.reckless ? 'ON — advantage on your STR melee attacks, but enemies strike you easier' : 'OFF'}.`);
      break;
    }
    case 'healing_hands': {
      if ((char.uses.healing_hands ?? 1) <= 0) { events.push({ type: 'error', text: 'Healing Hands spent — long rest to recover.' }); return; }
      char.uses.healing_hands = 0;
      engine.healEntity(state, p, char.level + char.profBonus, events, 'Healing Hands');
      break;
    }
    case 'healer_feat': {
      const kit = char.inventory.find(x => x.itemId === 'healers_kit' && x.qty > 0);
      if (!kit) { events.push({ type: 'error', text: 'No Healer\'s Kit uses remain.' }); return; }
      if (inCombat) { const err = consumeActionEconomy(state, 'action'); if (err) { events.push({ type: 'error', text: err }); return; } }
      const r = engine.rollExpr('1d4');
      engine.healEntity(state, p, r.total + 2 + char.level, events, "Healer's Kit");
      break;
    }
    default:
      events.push({ type: 'error', text: 'Unknown class action.' });
  }
}

module.exports = router;
