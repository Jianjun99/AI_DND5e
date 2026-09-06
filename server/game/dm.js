// dm.js — the Dungeon Master's voice. The engine decides outcomes; the LLM only narrates them.
// If the LLM is off or unreachable, the canned text baked into each event is used instead.
const store = require('../store');
const retrieval = require('./retrieval');
const llm = require('../llm/client');
const engine = require('./engine');

const SYSTEM_DM = `You are the Dungeon Master's narrative voice for a game of D&D (2024 rules) taking place in "The Sunless Crypt", a dungeon delve.
The game engine has ALREADY resolved the mechanics and gives you the exact outcomes. Your job is ONLY to narrate them.
Rules you must obey:
- Write 2-4 vivid sentences, second person ("you"), addressing the player hero by name if natural.
- Narrate EXACTLY the outcomes given: never invent hits, misses, damage, loot, deaths, or discoveries that are not in the event data.
- Never offer mechanical choices or ask the player for a roll; the game UI handles that.
- Dark fantasy tone, concrete sensory detail, a little drama. No lists, no headings, no dice notation unless echoing given results.
- If the player succeeded, make it feel earned; if they failed or were hurt, make the danger feel real. Never apologize or break character.`;

const SYSTEM_NPC = (npcDef, npcName) => `You are role-playing ${npcName}, an NPC in the D&D dungeon "The Sunless Crypt".
Character: ${npcDef.persona}
Things you know: ${npcDef.knowledge}
Rules you must obey:
- Always stay in character. Never mention that you are an AI or a game.
- Reply in at most 3 short sentences of spoken dialogue (optionally one small action beat in *asterisks*).
- You may be evasive, lie, bargain, or refuse — but never reveal facts that are not in "Things you know".
- If the player says something irrelevant, respond in character with confusion, deflection, or humor.`;

const SYSTEM_FREEFORM = `You are the Dungeon Master's narrative voice for a D&D dungeon crawl in "The Sunless Crypt".
The player attempts something freeform that the game engine did NOT map to a mechanic (no dice were rolled, nothing changed).
Narrate their attempt in 1-3 sentences, second person: describe them trying and the ambiguity of the dark answering back.
DO NOT invent any mechanical outcome: no damage, no items found, no combat starting, no movement. If the attempt clearly maps to a
game action (attack, search, listen, hide, pick a lock, drink a potion, pray at the altar, rest, talk), gently note in-character that
they should use the game buttons or phrase it that way — without listing commands like a manual.`;

function recentHistory(state, n = 6) {
  return state.log.slice(-n).map(l => l.text).join(' | ').slice(-900);
}

async function available() {
  const cfg = store.getSettings().llm;
  return !!(cfg && cfg.enabled && cfg.baseUrl && cfg.model);
}

async function tryChat(messages, cfg) {
  try {
    return await llm.chat(messages, { config: cfg });
  } catch (e) {
    return null;
  }
}

// Narrate a batch of engine events. Returns narration text or null.
async function narrateEvents(state, events) {
  if (!(await available())) return null;
  if (!events.length) return null;
  const cfg = store.getSettings().llm;
  const p = engine.playerEntity(state);
  const room = engine.roomAt(state, p.x, p.y);
  const payload = events.filter(e => e.narrate).slice(0, 6).map(e => ({
    type: e.type,
    outcome: e.text,
    data: e.data ? { dmg: e.data.dmg, crit: e.data.crit, room: e.data.roomName, xp: e.data.xp } : undefined
  }));
  const messages = [
    { role: 'system', content: SYSTEM_DM },
    { role: 'user', content: `Hero: ${state.character.name}, level ${state.character.level} ${state.character.className} (${state.character.species}), ${p.hp}/${p.hpMax} HP.
Location: ${room ? room.name : 'a corridor of the crypt'}${state.mode === 'combat' ? ' — IN COMBAT' : ''}.
Recent events: ${recentHistory(state, 4) || '(the delve just began)'}
Engine-resolved outcomes to narrate (JSON): ${JSON.stringify(payload)}

Narrate these outcomes now.` }
  ];
  return tryChat(messages, cfg);
}

// NPC dialogue. Returns reply text or a canned line.
async function npcChat(state, npcId, playerText) {
  const npcDef = state.map.npcs[npcId];
  if (!npcDef) return null;
  const npcName = (state.objects.find(o => o.npcId === npcId) || {}).name || npcId;
  state.npcChat[npcId] = state.npcChat[npcId] || [];
  state.npcChat[npcId].push({ role: 'user', content: playerText });

  let reply = null;
  if (await available()) {
    const cfg = store.getSettings().llm;
    const history = state.npcChat[npcId].slice(-10).map(m => ({ role: m.role, content: m.content }));
    const messages = [
      { role: 'system', content: SYSTEM_NPC(npcDef, npcName) },
      ...history
    ];
    reply = await tryChat(messages, cfg);
  }
  if (!reply) {
    const canned = npcDef.canned || ['...'];
    reply = canned[Math.floor(Math.random() * canned.length)];
  }
  state.npcChat[npcId].push({ role: 'assistant', content: reply });
  if (state.npcChat[npcId].length > 24) state.npcChat[npcId].splice(0, state.npcChat[npcId].length - 24);
  return reply;
}

// Freeform action with no mechanics — pure flavor narration.
async function freeformFlavor(state, text) {
  if (await available()) {
    const cfg = store.getSettings().llm;
    const p = engine.playerEntity(state);
    const room = engine.roomAt(state, p.x, p.y);
    const messages = [
      { role: 'system', content: SYSTEM_FREEFORM },
      { role: 'user', content: `Hero: ${state.character.name} (level ${state.character.level} ${state.character.className}), ${p.hp}/${p.hpMax} HP.
Location: ${room ? room.name : 'a corridor of the crypt'}. Mode: ${state.mode}.
The player attempts: "${text}"
Relevant lore (do not contradict): ${retrieval.retrieve(state, text + ' ' + (room ? room.name : ''), 3).join(' | ') || 'none'}

Narrate their attempt (no mechanical effects).` }
    ];
    const reply = await tryChat(messages, cfg);
    if (reply) return reply;
  }
  return `${state.character.name} steels themselves and presses on — the crypt answers only with dripping water and distant, patient silence. (Use the game buttons for attacks, searches, and other actions to affect the world.)`;
}

// Session recap for the adventurer's journal, written at long rests / campfires.
async function writeRecap(state) {
  if (await available()) {
    const cfg = store.getSettings().llm;
    const p = engine.playerEntity(state);
    const roomsVisited = Object.keys(state.flags).filter(k => k.startsWith('room_')).map(k => {
      const room = (state.map.rooms || []).find(r => r.id === k.slice(5));
      return room ? room.name : null;
    }).filter(Boolean);
    const tail = state.log.slice(-30).map(l => l.text).join(' | ').slice(-1600);
    const messages = [
      { role: 'system', content: `You are the journal the hero keeps between delves into "The Sunless Crypt". Write ONE journal entry in the hero's voice, first person, past tense. 3-5 sentences. Refer to concrete events given to you; do not invent events that are not listed. End with one sentence of resolve or dread about what comes next. No headings, no lists.` },
      { role: 'user', content: `Hero: ${state.character.name}, level ${state.character.level} ${state.character.className}, ${p.hp}/${p.hpMax} HP, ${state.character.gold} gold.
Rooms explored: ${roomsVisited.join(', ') || 'so far, only the entrance'}.
Relic: ${state.flags.hasRelic ? 'carried' : 'not yet taken'}.
Recent events: ${tail || 'the delve just began'}

Write the journal entry now.` }
    ];
    const reply = await tryChat(messages, cfg);
    if (reply) return reply;
  }
  // deterministic fallback
  const rooms = Object.keys(state.flags).filter(k => k.startsWith('room_')).map(k => {
    const room = (state.map.rooms || []).find(r => r.id === k.slice(5));
    return room ? room.name : null;
  }).filter(Boolean);
  const kills = state.log.filter(l => l.kind === 'mech' && l.text.includes('is destroyed')).length;
  return `We pressed deeper into the crypt${rooms.length ? ` — through ${rooms.join(', ')}` : ''}. ${kills} of its horrors will not rise again, and ${state.character.gold} gold weighs heavy in my pack. ${state.flags.hasRelic ? 'The Relic is in my hands; now only the road home remains.' : 'The Relic still waits below, and I mean to have it.'}`;
}

// Vivid appearance for a monster or NPC, generated once per creature type and cached.
async function describeEntity(state, ent) {
  let blurb = '';
  if (ent.kind === 'monster') {
    const def = engine.byId(engine.MONSTERS, ent.monsterId);
    blurb = def ? def.blurb : '';
  } else if (ent.kind === 'npc') {
    const npcDef = state.map.npcs[ent.npcId];
    blurb = npcDef ? npcDef.persona.split('.').slice(0, 2).join('.') + '.' : '';
  }
  if (await available()) {
    const cfg = store.getSettings().llm;
    const messages = [
      { role: 'system', content: `You describe creatures for a D&D game. Given the facts, write the creature's appearance in 1-2 vivid sentences, present tense, framed as what the player sees ("You see..."). Use ONLY the facts given — never invent abilities, names, or story details. No headings.` },
      { role: 'user', content: `Creature: ${ent.name}${ent.boss ? ' (a boss)' : ''}. Facts: ${blurb || 'an inhabitant of the Sunless Crypt'}\n\nDescribe its appearance.` }
    ];
    const reply = await tryChat(messages, cfg);
    if (reply) return reply;
  }
  return blurb || 'A figure out of the crypt\'s long dark, watching.';
}

// Side-quest hook text, grounded in a server-chosen real objective.
async function questText(state, quest) {
  if (!(await available())) return null;
  const cfg = store.getSettings().llm;
  const messages = [
    { role: 'system', content: `You write short side-quest hooks for a D&D dungeon crawl in "${state.mapName}". A non-player character at the hero's camp offers the quest. Write 2-3 sentences of spoken dialogue plus at most one small action beat in *asterisks*. Be concrete, colorful, and greedy or desperate as fits. Do NOT invent new objectives, places, or monsters beyond those given. No headings.` },
    { role: 'user', content: `Hero: ${state.character.name}, level ${state.character.level} ${state.character.className}.
The objective (already fixed, do not change it): ${quest.shortText} — reward ${quest.reward.gold} gp and ${quest.reward.xp} XP.
Target facts: it is ${quest.type === 'slay' ? 'a creature currently lurking in the dungeon' : quest.type === 'recover' ? 'an unopened cache somewhere in the dungeon' : 'an unexplored chamber of the dungeon'}.
Known lore you may weave in (do not contradict): ${retrieval.retrieve(state, quest.shortText + ' ' + quest.targetName, 3).join(' | ') || 'nothing yet'}.

Write the quest hook now.` }
  ];
  return tryChat(messages, cfg);
}

module.exports = { narrateEvents, npcChat, freeformFlavor, writeRecap, describeEntity, questText, available };
