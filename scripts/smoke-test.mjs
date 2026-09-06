// End-to-end smoke test: boots against a running server (BASE_URL or http://localhost:3100)
// and walks the core loop: health → rules → create character → start delve → move → door → freeform.
const BASE = process.env.BASE_URL || 'http://localhost:3100';

async function req(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method} ${path} → HTTP ${res.status}: ${JSON.stringify(data).slice(0, 200)}`);
  return data;
}

async function waitHealthy() {
  for (let i = 0; i < 20; i++) {
    try { return await req('GET', '/api/health'); } catch { await new Promise(r => setTimeout(r, 500)); }
  }
  throw new Error('Server never became healthy');
}

(async () => {
  const health = await waitHealthy();
  console.log('✔ health:', health.version);

  const rules = await req('GET', '/api/rules');
  if (rules.classes.length !== 12) throw new Error(`Expected 12 classes, got ${rules.classes.length}`);
  if (rules.species.length !== 10) throw new Error(`Expected 10 species, got ${rules.species.length}`);
  console.log('✔ rules: 12 classes, 10 species loaded');

  const char = await req('POST', '/api/characters', {
    name: 'Smoke TestHero',
    species: 'dwarf',
    className: 'fighter',
    background: 'soldier',
    baseScores: { str: 15, dex: 14, con: 14, int: 10, wis: 12, cha: 8 },
    bgPlus2: 'str', bgPlus1: 'con',
    skills: ['athletics', 'perception'],
    fightingStyle: 'defense',
    armorOption: 'chain_mail',
    weaponOption: 'sword_board'
  });
  if (char.hpMax !== 13) throw new Error(`Expected HP 13 (d10 + CON 2 + Dwarf Toughness 1), got ${char.hpMax}`);
  if (char.acBase !== 18) throw new Error(`Expected AC 18 (chain mail 16 + Defense style 2), got ${char.acBase}`);
  console.log(`✔ character created: ${char.name} — ${char.hpMax} HP, ${char.acBase} AC`);

  const game = await req('POST', '/api/game/start', { characterId: char.id, bringAlly: false });
  const sid = game.state.id;
  const player = game.state.entities.find(e => e.kind === 'player');
  if (player.x !== 4 || player.y !== 4) throw new Error(`Expected start (4,4), got (${player.x},${player.y})`);
  console.log(`✔ delve started: ${sid}`);

  const moved = await req('POST', `/api/game/${sid}/action`, { type: 'move', x: 8, y: 4 });
  const p2 = moved.state.entities.find(e => e.kind === 'player');
  if (p2.x !== 8 || p2.y !== 4) throw new Error(`Move failed, at (${p2.x},${p2.y})`);
  console.log('✔ movement works');

  const door = await req('POST', `/api/game/${sid}/action`, { type: 'interact', objectId: 'door1' });
  if (!door.state.objects.find(o => o.id === 'door1').open) throw new Error('Door did not open');
  console.log('✔ doors work');

  const freeform = await req('POST', `/api/game/${sid}/action`, { type: 'freeform', text: 'listen carefully' });
  if (!freeform.state.log.some(l => l.text.includes('listen'))) throw new Error('Freeform action produced no log');
  console.log('✔ freeform actions work');

  console.log('\nSMOKE TEST PASSED');
})().catch(e => { console.error('SMOKE TEST FAILED:', e.message); process.exit(1); });
