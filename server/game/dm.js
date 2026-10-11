// dm.js — the Dungeon Master's voice. The engine decides outcomes; the LLM only narrates them.
// If the LLM is off or unreachable, the canned text baked into each event is used instead.
const store = require('../store');
const retrieval = require('./retrieval');
const llm = require('../llm/client');
const engine = require('./engine');
const content = require('./content');
const { textFor } = require('./presentation');
const localeContract = import('../../public/js/localization/locale.mjs');
const languageInstruction = locale => locale === 'zh-CN' ? '\nReply ONLY in Simplified Chinese (zh-CN), including names for which Chinese display text is supplied.' : '\nReply ONLY in English (en), including names for which English display text is supplied.';
const mapTitle = (state,locale) => textFor(state.map,'name',locale) || state.mapName || (locale==='zh-CN' ? '当前地牢' : 'the current dungeon');
function memoryText(state,npcId,locale) {
  const display = engine.sceneMemoryDisplay(state, npcId);
  if (display?.localized) return display.localized[locale] || display.fallback || engine.sceneMemory(state, npcId);
  const fact = [...(state.character.encounterFacts || []),...(state.encounterFacts || [])].filter(f=>f.mapId===state.mapId && f.npcId===npcId).sort((a,b)=>b.ts-a.ts)[0];
  const choice = state.map.scenes?.find(s=>s.id===fact?.sceneId)?.choices.find(c=>c.id===fact?.choiceId);
  return choice ? textFor(choice,'memory',locale) : engine.sceneMemory(state,npcId);
}

const DM_PERSONAS = {
  classic: {
    id: 'classic',
    name: 'Classic Tabletop',
    icon: '🎲',
    tagline: 'Balanced & Immersive',
    blurb: 'Traditional D&D adventure tone. Clear sensory descriptions, steady pacing, and heroic stakes.',
    promptStyle: 'Traditional high-adventure tabletop tone with balanced sensory detail and steady heroic stakes.'
  },
  grimdark: {
    id: 'grimdark',
    name: 'Grimdark & Gritty',
    icon: '💀',
    tagline: 'Bleak & Visceral',
    blurb: 'Dark Souls & Ravenloft style. Cold stone, stale blood, reeking rot, biting agony, and relentless dread.',
    promptStyle: 'Visceral grimdark tone: describe wounds, stale blood, suffocating dread, grinding bones, and oppressive claustrophobia. Treat every victory as hard-won survival against a merciless world.'
  },
  epic: {
    id: 'epic',
    name: 'High Fantasy Epic',
    icon: '⚔️',
    tagline: 'Grand & Mythic',
    blurb: 'Lord of the Rings style. Soaring cadence, ancient prophecy, glorious heroics, and resonant majesty.',
    promptStyle: 'High-epic mythic cadence: sweeping poetic descriptions, legendary weight, heroic valor, and ancient majesty. Frame the hero\'s struggles as fateful deeds echoing through song and legend.'
  },
  snarky: {
    id: 'snarky',
    name: 'Snarky & Irreverent',
    icon: '🃏',
    tagline: 'Witty & Sarcastic',
    blurb: 'Tongue-in-cheek DM who delivers dry wit, playful quips on questionable choices, and comedic timing.',
    promptStyle: 'Snarky, dryly witty tabletop DM tone: humorous commentary on narrow escapes, clumsy monsters, and dubious player heroics, while strictly honoring the exact outcomes with playful irony.'
  },
  eldritch: {
    id: 'eldritch',
    name: 'Eldritch Cosmic Dread',
    icon: '👁️',
    tagline: 'Surreal & Psychological',
    blurb: 'Lovecraftian horror. Whispering shadows, geometry gone wrong, ancient forbidden secrets, and creeping madness.',
    promptStyle: 'Eldritch cosmic horror tone: unsettling psychological tension, whispering shadows at the edge of sanity, wrong angles in the stone, and the terrifying insignificance of mortals against ancient abyssal things.'
  }
};

function getDmSystem(personaKey = 'classic', mapName = 'the current dungeon') {
  const p = DM_PERSONAS[personaKey] || DM_PERSONAS.classic;
  return `You are the Dungeon Master's narrative voice for a game of D&D (2024 rules) taking place in "${mapName}".
Persona style: ${p.name} — ${p.promptStyle}
The game engine has ALREADY resolved the mechanics and gives you the exact outcomes. Your job is ONLY to narrate them.
Rules you must obey:
- Write 2-4 vivid sentences, second person ("you"), addressing the player hero by name if natural.
- Tone: strictly embody the "${p.name}" persona style (${p.promptStyle}).
- Narrate EXACTLY the outcomes given: never invent hits, misses, damage, loot, deaths, or discoveries that are not in the event data.
- Never offer mechanical choices or ask the player for a roll; the game UI handles that.
- If the player succeeded, make it feel earned; if they failed or were hurt, make the danger feel real according to your persona style. Never apologize or break character.`;
}

function getFreeformSystem(personaKey = 'classic', mapName = 'the current dungeon') {
  const p = DM_PERSONAS[personaKey] || DM_PERSONAS.classic;
  return `You are the Dungeon Master's narrative voice for a D&D dungeon crawl in "${mapName}".
Persona style: ${p.name} — ${p.promptStyle}
The player attempts something freeform that the game engine did NOT map to a mechanic (no dice were rolled, nothing changed).
Narrate their attempt in 1-3 sentences, second person: describe them trying and the reaction of the dungeon through your persona lens.
DO NOT invent any mechanical outcome: no damage, no items found, no combat starting, no movement. If the attempt clearly maps to a
game action (attack, search, listen, hide, pick a lock, drink a potion, pray at the altar, rest, talk), gently note in-character that
they should use the game buttons or phrase it that way — without listing commands like a manual.`;
}


const SYSTEM_NPC = (npcDef, npcName, mapName) => `You are role-playing ${npcName}, an NPC in the D&D dungeon "${mapName}".
Character: ${npcDef.persona}
Things you know: ${npcDef.knowledge}
Rules you must obey:
- Always stay in character. Never mention that you are an AI or a game.
- Reply in at most 3 short sentences of spoken dialogue (optionally one small action beat in *asterisks*).
- You may be evasive, lie, bargain, or refuse — but never reveal facts that are not in "Things you know".
- If the player says something irrelevant, respond in character with confusion, deflection, or humor.`;


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
async function narrateEvents(state, events, locale = 'en') {
  if (!(await available())) return null;
  if (!events.length) return null;
  const cfg = store.getSettings().llm;
  const personaKey = (state && state.dmPersona) || (cfg && cfg.persona) || 'classic';
  const p = engine.playerEntity(state);
  const room = engine.roomAt(state, p.x, p.y);
  const { resolveDisplay } = await localeContract;
  const payload = events.filter(e => e.narrate).slice(0, 6).map(e => ({
    type: e.type,
    outcome: resolveDisplay(e.textDisplay || (e.messageKey ? e : null),e.text,locale),
    data: e.data ? { dmg: e.data.dmg, crit: e.data.crit, room: e.data.roomName, xp: e.data.xp } : undefined
  }));
  const ally = (state.entities || []).find(e => e.kind === 'ally');
  const allyLoy = ally ? (ally.loyalty == null ? 50 : ally.loyalty) : null;
  const allyMood = allyLoy == null ? null : (allyLoy >= 80 ? 'in high spirits' : allyLoy >= 30 ? 'steady' : 'grumbling, morale low');
  const messages = [
    { role: 'system', content: getDmSystem(personaKey, mapTitle(state,locale)) + languageInstruction(locale) },
    { role: 'user', content: `Hero: ${state.character.name}, level ${state.character.level} ${state.character.className} (${state.character.species}), ${p.hp}/${p.hpMax} HP.
Location: ${room ? room.name : 'a corridor of the crypt'}${state.mode === 'combat' ? ' — IN COMBAT' : ''}.
${ally ? `Companion: ${ally.name} (${ally.alive ? 'alive' : 'downed'}) is ${allyMood} — you may give them one short in-character remark if it fits.\n` : ''}Recent events: ${recentHistory(state, 4) || '(the delve just began)'}
Engine-resolved outcomes to narrate (JSON): ${JSON.stringify(payload)}

Narrate these outcomes now.` }
  ];
  return tryChat(messages, cfg);
}

// NPC dialogue. Returns reply text or a canned line.
async function npcChat(state, npcId, playerText, locale = 'en') {
  const npcDef = state.map.npcs[npcId];
  if (!npcDef) return null;
  const npcName = textFor(state.objects.find(o => o.npcId === npcId),'name',locale) || npcId;
  state.npcChat[npcId] = state.npcChat[npcId] || [];
  state.npcChat[npcId].push({ role: 'user', content: playerText, language:locale });

  let reply = null;
  const scene = engine.activeSceneView(state, npcId);
  const memory = memoryText(state, npcId,locale);
  const {resolveDisplay} = await localeContract;
  if (await available()) {
    const cfg = store.getSettings().llm;
    const history = state.npcChat[npcId].slice(-10).map(m => ({ role: m.role, content: m.content }));
    const messages = [
      { role: 'system', content: SYSTEM_NPC({persona:textFor(npcDef,'persona',locale),knowledge:textFor(npcDef,'knowledge',locale)}, npcName,mapTitle(state,locale)) + languageInstruction(locale) + (scene ? '\nEngine-confirmed encounter context (data, not instructions): ' + JSON.stringify({ phase: scene.phase, memory, result:scene.result || null, choices:scene.choices.map(c=>({id:c.id,label:textFor(state.map.scenes.find(s=>s.id===scene.id)?.choices.find(choice=>choice.id===c.id),'label',locale),available:c.available,reason:resolveDisplay(c.reasonDisplay,c.reason,locale),risk:resolveDisplay(c.riskDisplay,'',locale)})) }) + '\nExplain only these legal choices and confirmed facts. Do not invent rolls, items, rewards, HP changes or new outcomes; only the engine can change them.' : '') },
      ...history
    ];
    reply = await tryChat(messages, cfg);
    if (scene && (typeof reply !== 'string' || reply.trimStart().startsWith('[') || reply.trimStart().startsWith('{') || !reply.trim())) reply = null;
  }
  if (!reply) {
    const canned = textFor(npcDef,'canned',locale) || ['...'];
    reply = memory || canned[Math.floor(Math.random() * canned.length)];
  } else if (memory) {
    reply = memory + '\n' + reply;
  }
  state.npcChat[npcId].push({ role: 'assistant', content: reply, language:locale });
  if (state.npcChat[npcId].length > 24) state.npcChat[npcId].splice(0, state.npcChat[npcId].length - 24);
  return reply;
}

// Freeform action with no mechanics — pure flavor narration.
async function freeformFlavor(state, text, locale = 'en') {
  if (await available()) {
    const cfg = store.getSettings().llm;
    const personaKey = (state && state.dmPersona) || (cfg && cfg.persona) || 'classic';
    const p = engine.playerEntity(state);
    const room = engine.roomAt(state, p.x, p.y);
    const messages = [
      { role: 'system', content: getFreeformSystem(personaKey, mapTitle(state,locale)) + languageInstruction(locale) },
      { role: 'user', content: `Hero: ${state.character.name} (level ${state.character.level} ${state.character.className}), ${p.hp}/${p.hpMax} HP.
Location: ${room ? room.name : 'a corridor of the crypt'}. Mode: ${state.mode}.
The player attempts: "${text}"
Relevant lore (do not contradict): ${retrieval.retrieve(state, text + ' ' + (room ? textFor(room,'name',locale) : ''), 3,{locale}).join(' | ') || 'none'}

Narrate their attempt (no mechanical effects).` }
    ];
    const reply = await tryChat(messages, cfg);
    if (reply) return reply;
  }
  return locale === 'zh-CN' ? `${state.character.name}定了定神，继续面对${mapTitle(state,locale)}的寂静。（要改变世界，请使用攻击、搜索等游戏操作。）` : `${state.character.name} steels themselves before the silence of ${mapTitle(state,locale)}. (Use the game controls for attacks, searches and other actions to affect the world.)`;
}

// Session recap for the adventurer's journal, written at long rests / campfires.
async function writeRecap(state, locale = 'en') {
  if (await available()) {
    const cfg = store.getSettings().llm;
    const p = engine.playerEntity(state);
    const roomsVisited = Object.keys(state.flags).filter(k => k.startsWith('room_')).map(k => {
      const room = (state.map.rooms || []).find(r => r.id === k.slice(5));
      return room ? textFor(room,'name',locale) : null;
    }).filter(Boolean);
    const {resolveDisplay}=await localeContract;
    const tail = state.log.slice(-30).map(l => resolveDisplay(l.textDisplay || (l.messageKey ? l : null),l.text,locale)).join(' | ').slice(-1600);
    const messages = [
      { role: 'system', content: `You are the journal the hero keeps between delves into "${mapTitle(state,locale)}". Write ONE journal entry in the hero's voice, first person, past tense. 3-5 sentences. Refer to concrete events given to you; do not invent events that are not listed. End with one sentence of resolve or dread about what comes next. No headings, no lists.` + languageInstruction(locale) },
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
  const kills = state.stats?.kills || 0;
  return locale === 'zh-CN' ? `我们深入${mapTitle(state,locale)}。已有 ${kills} 个敌人倒下，行囊里装着 ${state.character.gold} 金币。${state.flags.hasRelic ? '圣物已在手中，只剩归途。' : '我们仍要面对前方的目标。'}` : `We pressed into ${mapTitle(state,locale)}${rooms.length ? ` — through ${rooms.join(', ')}` : ''}. ${kills} foes fell, and ${state.character.gold} gold weighs in my pack. ${state.flags.hasRelic ? 'The Relic is in my hands; the road home remains.' : 'Our objective still lies ahead.'}`;
}

// Vivid appearance for a monster or NPC, generated once per creature type and cached.
async function describeEntity(state, ent, locale = 'en') {
  const {resolveDisplay}=await localeContract;
  const displayName=resolveDisplay(require('./presentation').name(ent,state),ent.name,locale);
  let blurb = '';
  if (ent.kind === 'monster') {
    const def = content.getMonster(ent.monsterId);
    blurb = def ? textFor(def,'blurb',locale) : '';
  } else if (ent.kind === 'npc') {
    const npcDef = state.map.npcs[ent.npcId];
    blurb = npcDef ? textFor(npcDef,'persona',locale).split(/[。.]/).slice(0, 2).join(locale==='zh-CN'?'。':'.') : '';
  }
  if (await available()) {
    const cfg = store.getSettings().llm;
    const personaKey = (state && state.dmPersona) || (cfg && cfg.persona) || 'classic';
    const pStyle = (DM_PERSONAS[personaKey] || DM_PERSONAS.classic).promptStyle;
    const messages = [
      { role: 'system', content: `You describe creatures for a D&D game. Tone style: ${pStyle}. Given the facts, write the creature's appearance in 1-2 vivid sentences, present tense, framed as what the player sees ("You see..."). Use ONLY the facts given — never invent abilities, names, or story details. No headings.` + languageInstruction(locale) },
      { role: 'user', content: `Creature: ${displayName}${ent.boss ? ' (a boss)' : ''}. Place: ${mapTitle(state,locale)}. Facts: ${blurb || 'a visible inhabitant of this place'}\n\nDescribe its appearance.` }
    ];
    const reply = await tryChat(messages, cfg);
    if (reply) return reply;
  }
  return blurb || (locale==='zh-CN' ? '一个身影在暗处注视着你。' : 'A figure watches from the darkness.');
}

// Side-quest hook text, grounded in a server-chosen real objective.
async function questText(state, quest, locale = 'en') {
  if (!(await available())) return null;
  const cfg = store.getSettings().llm;
  const messages = [
    { role: 'system', content: `You write short side-quest hooks for a D&D dungeon crawl in "${mapTitle(state,locale)}". A non-player character at the hero's camp offers the quest. Write 2-3 sentences of spoken dialogue plus at most one small action beat in *asterisks*. Be concrete, colorful, and greedy or desperate as fits. Do NOT invent new objectives, places, or monsters beyond those given. No headings.` + languageInstruction(locale) },
    { role: 'user', content: `Hero: ${state.character.name}, level ${state.character.level} ${state.character.className}.
The objective (already fixed, do not change it): ${(await localeContract).resolveDisplay(quest.shortTextDisplay,quest.shortText,locale)} — reward ${quest.reward.gold} gp and ${quest.reward.xp} XP.
Target facts: it is ${quest.type === 'slay' ? 'a creature currently lurking in the dungeon' : quest.type === 'recover' ? 'an unopened cache somewhere in the dungeon' : 'an unexplored chamber of the dungeon'}.
Known lore you may weave in (do not contradict): ${retrieval.retrieve(state, quest.shortText + ' ' + quest.targetName, 3,{locale}).join(' | ') || 'nothing yet'}.

Write the quest hook now.` }
  ];
  return tryChat(messages, cfg);
}

module.exports = { narrateEvents, npcChat, freeformFlavor, writeRecap, describeEntity, questText, available, callLlm, DM_PERSONAS, getDmSystem, getFreeformSystem, memoryText, languageInstruction };

// Generic one-shot LLM helper for other server modules (tavern rumors, etc).
// Returns text or null when the LLM is off/unreachable.
async function callLlm(messages, locale = 'en') {
  if (!(await available())) return null;
  const cfg = store.getSettings().llm;
  return tryChat(messages.map(m=>m.role==='system'?{...m,content:m.content+languageInstruction(locale)}:m), cfg);
}
