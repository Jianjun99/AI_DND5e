// retrieval.js — a minimal, dependency-free "RAG": chunks the game's own content
// (rooms, monsters, items, NPC knowledge) plus a delve's journal, and retrieves the
// most keyword-relevant chunks so the AI DM's flavor text stays grounded in real facts.
// Deliberately no FastAPI/ChromaDB/Ollama — the content is small, local JSON, so a
// term-overlap index is all the "vector store" this game needs. Swap for embeddings
// later if the lore ever outgrows it.
const content = require('./content');

const STOP = new Set(['the', 'a', 'an', 'and', 'or', 'but', 'of', 'to', 'in', 'on', 'at', 'is', 'are', 'was', 'it', 'its', 'this', 'that', 'with', 'for', 'from', 'you', 'your', 'they', 'their', 'his', 'her', 'he', 'she', 'as', 'by', 'be', 'has', 'have', 'not', 'no', 'so', 'if', 'into', 'out', 'up', 'down', 'who', 'what', 'where']);

function tokenize(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(w => w.length > 2 && !STOP.has(w));
}

let staticChunks = null;

function buildStatic() {
  const chunks = [];
  content.listMaps().forEach(mapInfo => {
    const map = content.getMap(mapInfo.id);
    (map.rooms || []).forEach(r => {
      chunks.push({ text: `${map.name} — ${r.name}: ${r.desc}`, tags: tokenize(`${map.name} ${r.name} ${r.desc}`) });
    });
    Object.entries(map.npcs || {}).forEach(([id, npc]) => {
      chunks.push({ text: `NPC ${id}: ${npc.knowledge || ''}`, tags: tokenize(`${id} ${npc.knowledge || ''}`) });
    });
  });
  content.listMonsters().forEach(m => {
    chunks.push({ text: `${m.name}: ${m.blurb || ''} (AC ${m.ac}, about ${m.hp} HP, ${m.xp} XP)`, tags: tokenize(`${m.name} ${m.blurb || ''}`) });
  });
  content.listGear().forEach(g => {
    if (g.desc) chunks.push({ text: `${g.name}: ${g.desc}`, tags: tokenize(`${g.name} ${g.desc}`) });
  });
  staticChunks = chunks;
}

// Retrieve up to k lore snippets relevant to the query, mixing in this delve's journal.
function retrieve(state, query, k = 3) {
  if (!staticChunks) buildStatic();
  const chunks = [...staticChunks];
  (state.journal || []).forEach(j => chunks.push({ text: `Journal: ${j.text}`, tags: tokenize(j.text) }));
  ((state.quests && state.quests.completed) || []).forEach(q => chunks.push({ text: `Completed quest: ${q.shortText}`, tags: tokenize(q.shortText) }));
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

module.exports = { retrieve };
