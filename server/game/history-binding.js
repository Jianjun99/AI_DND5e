// server/game/history-binding.js
// Cross-chapter history: which endings a hero actually earned, and how facts merge onto the
// roster. Both the ordinary start (server/routes/game.js) and the author's playtest start
// (server/game/content-authoring.js) use these same functions — one eligibility rule, no
// duplicated variant living in a route.

// Legacy facts without settlement records keep the pre-T14 behaviour; a qualifying ending is
// only ever taken from a fact that carries an ending.
function resolveHistoryBinding(char, requiresHistory) {
  if (!requiresHistory || !requiresHistory.storyId) return null;
  const targetStoryId = requiresHistory.storyId;
  const settlements = Array.isArray(char?.settlements) ? char.settlements : [];
  const facts = Array.isArray(char?.encounterFacts) ? char.encounterFacts : [];

  const candidates = facts.filter(f => f && f.storyId === targetStoryId && Boolean(f.ending));
  if (!candidates.length) return null;

  const qualified = [];
  for (const f of candidates) {
    const matchingReceipts = settlements.filter(r => r && r.id && f.saveId && r.id.startsWith(f.saveId));
    if (matchingReceipts.length > 0) {
      const hasVictory = matchingReceipts.some(r => r.mode === 'victory');
      const hasDisqualifying = matchingReceipts.some(r => r.mode === 'retreat' || r.mode === 'over');
      if (hasVictory && !hasDisqualifying) {
        const victoryReceipt = matchingReceipts.find(r => r.mode === 'victory');
        const completedTs = victoryReceipt?.ts ?? f.ts ?? 0;
        qualified.push({ fact: f, completedTs });
      }
    } else {
      // Legacy compatibility: no settlement records for that saveId, but fact has ending and no retreat/over record
      const hasDisqualifying = settlements.some(r => r && r.id && f.saveId && r.id.startsWith(f.saveId) && (r.mode === 'retreat' || r.mode === 'over'));
      if (!hasDisqualifying && ['reported', 'protected', 'accord'].includes(f.ending)) {
        const completedTs = f.ts ?? 0;
        qualified.push({ fact: f, completedTs });
      }
    }
  }

  if (!qualified.length) return null;

  qualified.sort((a, b) => {
    if (b.completedTs !== a.completedTs) return b.completedTs - a.completedTs;
    const idA = a.fact.id || '';
    const idB = b.fact.id || '';
    return idB.localeCompare(idA);
  });

  const best = qualified[0];
  return {
    storyId: best.fact.storyId,
    ending: best.fact.ending,
    factId: best.fact.id,
    fact: best.fact.fact,
    completedTs: best.completedTs,
    sourceSaveId: best.fact.saveId
  };
}

// Persistent story facts, oldest first, capped: a settlement merges its own facts exactly
// once (ids dedupe), so a replayed request changes nothing.
function mergeEncounterFacts(char, facts) {
  const existing = Array.isArray(char.encounterFacts) ? char.encounterFacts : [];
  const ids = new Set(existing.map(f => f.id));
  const fresh = (Array.isArray(facts) ? facts : []).filter(f => {
    if (!f || typeof f.id !== 'string' || typeof f.memory !== 'string' || typeof f.text !== 'string' || !Number.isFinite(f.ts) || ids.has(f.id)) return false;
    ids.add(f.id); return true;
  });
  if (!fresh.length) return false;
  char.encounterFacts = [...existing, ...fresh].sort((a, b) => a.ts - b.ts).slice(-100);
  return true;
}

module.exports = { resolveHistoryBinding, mergeEncounterFacts };
