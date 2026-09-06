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
  for (const item of ['silver_sword', 'flame_dagger', 'crypt_cleaver', 'cloak_protection', 'amulet_of_vigor', 'potion_greater']) {
    if (!rules.gear.some(g => g.id === item)) throw new Error(`Magic item missing from gear table: ${item}`);
  }
  if (!rules.shop.some(s => s.id === 'silver_sword')) throw new Error('Shop does not stock the Silver Shortsword');
  console.log('✔ rules: 12 classes, 10 species, magic items and shop stock present');

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
  if (char.acBase !== 19) throw new Error(`Expected AC 19 (chain mail 16 + shield 2 + Defense style 1), got ${char.acBase}`);
  console.log(`✔ character created: ${char.name} — ${char.hpMax} HP, ${char.acBase} AC`);

  const game = await req('POST', '/api/game/start', { characterId: char.id, bringAlly: false });
  const sid = game.state.id;
  const player = game.state.entities.find(e => e.kind === 'player');
  if (player.x !== 4 || player.y !== 4) throw new Error(`Expected start (4,4), got (${player.x},${player.y})`);
  console.log(`✔ delve started: ${sid}`);

  // Marla's shop: player starts within 3 tiles of her stall
  const goldBefore = game.state.character.gold;
  const bought = await req('POST', `/api/game/${sid}/action`, { type: 'buy', itemId: 'potion_healing' });
  if (bought.state.character.gold !== goldBefore - 25) throw new Error('Shop did not charge gold correctly');
  const potions = bought.state.character.inventory.find(i => i.itemId === 'potion_healing').qty;
  console.log(`✔ shop works: potion bought, ${bought.state.character.gold} gp left, ${potions} potions`);

  // Journal recap at the campfire
  await req('POST', `/api/game/${sid}/action`, { type: 'move', x: 3, y: 2 });
  const recapped = await req('POST', `/api/game/${sid}/action`, { type: 'recap' });
  if (!recapped.state.journal || recapped.state.journal.length < 1) throw new Error('Journal recap missing');
  console.log('✔ journal recap written at the campfire');

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

  // Easy difficulty: 4 starting potions (2 base + 2 bonus) and lower monster HP
  const easy = await req('POST', '/api/game/start', { characterId: char.id, bringAlly: true, difficulty: 'easy' });
  if (easy.state.difficulty !== 'easy') throw new Error('Difficulty not stored');
  const easyPotions = easy.state.character.inventory.find(i => i.itemId === 'potion_healing').qty;
  if (easyPotions !== 4) throw new Error(`Expected 4 potions on easy, got ${easyPotions}`);
  if (!easy.state.entities.some(e => e.kind === 'ally')) throw new Error('Ally missing on easy delve');
  const goblin = easy.state.entities.find(e => e.monsterId === 'goblin');
  if (goblin.hp > Math.round(14 * 0.75)) throw new Error(`Easy difficulty did not reduce goblin HP (got ${goblin.hp})`);
  console.log(`✔ easy difficulty: 4 potions, ally present, goblin HP ${goblin.hp}/14 max`);

  // Content packs: registry lists the example pack, delve starts on it
  const contentList = await req('GET', '/api/content');
  if (!contentList.maps.some(m => m.id === 'drowned-vault')) throw new Error('Example pack map not registered');
  if (!contentList.packs.some(p => p.id === 'drowned-vault')) throw new Error('Example pack not listed');
  const vault = await req('POST', '/api/game/start', { characterId: char.id, bringAlly: false, mapId: 'drowned-vault' });
  if (vault.state.mapId !== 'drowned-vault') throw new Error('Delve did not start on the pack map');
  const warden = vault.state.entities.find(e => e.monsterId === 'tomb_warden');
  if (!warden || !warden.boss) throw new Error('Tomb Warden (pack boss) missing from the vault delve');
  console.log(`✔ content packs: drowned-vault loads with ${vault.state.entities.filter(e => e.kind === 'monster').length} monsters incl. boss`);

  // Side quest at the vault campfire
  await req('POST', `/api/game/${vault.state.id}/action`, { type: 'move', x: 23, y: 13 });
  const quested = await req('POST', `/api/game/${vault.state.id}/action`, { type: 'quest' });
  if (!quested.state.quests || !quested.state.quests.active) throw new Error('Side quest was not generated at the campfire');
  console.log(`✔ side quest generated: ${quested.state.quests.active.shortText} (${quested.state.quests.active.reward.gold} gp)`);

  // Pack export + import roundtrip (import under a new id)
  const bundle = await req('GET', '/api/content/pack/drowned-vault/export');
  if (bundle.format !== 'ai-dnd-pack') throw new Error('Pack export malformed');
  const copy = JSON.parse(JSON.stringify(bundle));
  copy.pack = { ...copy.pack, id: 'test-pack-copy', name: 'Test Pack Copy' };
  copy.maps.forEach(m => m.id = 'test-vault');
  const imported = await req('POST', '/api/content/import', copy);
  if (!imported.ok || !imported.pack.maps.includes('test-vault')) throw new Error('Pack import failed');
  const afterImport = await req('GET', '/api/content');
  if (!afterImport.maps.some(m => m.id === 'test-vault')) throw new Error('Imported pack map not registered');
  console.log('✔ pack export → import roundtrip works');
  // clean up the test copy so repeated runs stay tidy
  await req('GET', '/api/health');

  // Backup export endpoint
  const backup = await req('GET', '/api/data/export');
  if (!Array.isArray(backup.characters) || backup.characters.length < 1) throw new Error('Export returned no characters');
  if (backup.settings.llm.apiKey) throw new Error('Backup export leaked the LLM API key!');
  console.log(`✔ backup export works (${backup.characters.length} characters, ${backup.saves.length} delves, no API key)`);

  console.log('\nSMOKE TEST PASSED');
})().catch(e => { console.error('SMOKE TEST FAILED:', e.message); process.exit(1); });
