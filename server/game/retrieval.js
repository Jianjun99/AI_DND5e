// retrieval.js — a minimal, dependency-free "RAG": chunks the game's own content
// (rooms, monsters, items, NPC knowledge) plus a delve's journal, and retrieves the
// most keyword-relevant chunks so the AI DM's flavor text stays grounded in real facts.
// Deliberately no FastAPI/ChromaDB/Ollama — the content is small, local JSON, so a
// term-overlap index is all the "vector store" this game needs. Swap for embeddings
// later if the lore ever outgrows it.
const content = require('./content');
const { textFor } = require('./presentation');

const STOP = new Set(['the', 'a', 'an', 'and', 'or', 'but', 'of', 'to', 'in', 'on', 'at', 'is', 'are', 'was', 'it', 'its', 'this', 'that', 'with', 'for', 'from', 'you', 'your', 'they', 'their', 'his', 'her', 'he', 'she', 'as', 'by', 'be', 'has', 'have', 'not', 'no', 'so', 'if', 'into', 'out', 'up', 'down', 'who', 'what', 'where']);

function tokenize(s) {
  const text = String(s || '').toLowerCase();
  const words = (text.match(/[a-z0-9]+/g) || []).filter(w => w.length > 2 && !STOP.has(w));
  for (const run of text.match(/[\u3400-\u9fff]+/g) || []) {
    if (run.length === 1) words.push(run);
    for (let i=0;i<run.length-1;i++) words.push(run.slice(i,i+2));
  }
  return [...new Set(words)];
}

function knownChunks(state, {locale = 'en', npcId = null} = {}) {
  const chunks = [];
  const add = text => { if (text) chunks.push({text,tags:tokenize(text)}); };
  const seen = new Set(state.discovered || []), map = state.map || {};
  (map.rooms || []).filter(room => state.flags?.['room_'+room.id] || Array.from(seen).some(tile => {
    const [x,y] = String(tile).split(',').map(Number);
    return x>=room.rect[0] && x<=room.rect[2] && y>=room.rect[1] && y<=room.rect[3];
  })).forEach(room => add(textFor(map,'name',locale)+' — '+textFor(room,'name',locale)+': '+textFor(room,'desc',locale)));
  // A speaker can use their own explicitly authored knowledge. Other NPCs and
  // unchosen encounter branches never enter this request's retrieval pool.
  if (npcId && map.npcs?.[npcId]) add(textFor(map.npcs[npcId],'knowledge',locale));
  [...(state.character?.encounterFacts || []), ...(state.encounterFacts || [])].filter(f => f.mapId === state.mapId || (f.storyId && f.storyId === map.story?.id)).forEach(f => {
    if (npcId) {
      if (f.reactions?.[npcId]) add(textFor(f.reactions[npcId], 'text', locale));
    } else add(f.textDisplay?.localized?.[locale] || f.text);
  });
  // Companion stories (T12a): confirmed companion reactions may color narration, but
  // unchosen outcomes and future prose never enter the pool.
  const companionId = map.story?.companion;
  if (companionId && !npcId) {
    [...(state.character?.encounterFacts || []), ...(state.encounterFacts || [])]
      .filter(f => f.storyId === map.story.id && f.reactions?.[companionId])
      .forEach(f => add(textFor(f.reactions[companionId], 'text', locale)));
  }
  (state.entities || []).filter(ent => ent.kind === 'monster' && seen.has(ent.x+','+ent.y)).forEach(ent => {
    const def = content.getMonster(ent.monsterId);
    if (def) add(textFor(def,'name',locale)+': '+textFor(def,'blurb',locale));
  });
  (state.character?.inventory || []).forEach(item => {
    const def = content.getGear(item.itemId);
    if (def) add(textFor(def,'name',locale)+': '+textFor(def,'desc',locale));
  });
  (state.journal || []).forEach(j => add(j.text));
  ((state.quests?.completed) || []).forEach(q => add(q.shortText));
  return chunks;
}

// Retrieve up to k lore snippets relevant to the query, mixing in this delve's journal.
function retrieve(state, query, k = 3, options = {}) {
  const chunks = knownChunks(state,options);
  const qTerms = tokenize(query);
  if (!qTerms.length) return [];
  return chunks
    .map(c => {
      const overlap = qTerms.filter(t => c.tags.includes(t)).length;
      return { text: c.text, score: overlap / Math.sqrt((c.tags.length || 1) + 1) };
    })
    .filter(c => c.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, k)
    .map(c => c.text);
}

module.exports = { retrieve, tokenize, knownChunks };
