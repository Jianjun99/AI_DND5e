const express = require('express');
const store = require('../store');
const engine = require('../game/engine');
const portraits = require('../portraits');

const router = express.Router();

router.get('/', (req, res) => {
  const chars = store.getCharacters().map(c => ({
    id: c.id, name: c.name, species: c.species, className: c.className, background: c.background,
    level: c.level, xp: c.xp, hpMax: c.hpMax, acBase: c.acBase, gold: c.gold,
    createdAt: c.createdAt,
    portraitUrl: portraits.characterPortraitUrl(c.id)
  }));
  res.json(chars);
});

router.post('/', async (req, res) => {
  const draft = req.body || {};
  if (!draft.name || !String(draft.name).trim()) return res.status(400).json({ error: 'Name is required' });
  try {
    const char = engine.buildCharacter({ ...draft, name: String(draft.name).trim().slice(0, 40) });
    char.id = store.newId('char');
    char.createdAt = Date.now();
    try {
      const port = await portraits.ensureCharacterPortrait(char);
      if (port && port.url) char.portraitUrl = port.url;
    } catch {}
    const chars = store.getCharacters();
    chars.push(char);
    store.saveCharacters(chars);
    res.json(char);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.get('/:id', (req, res) => {
  const char = store.getCharacters().find(c => c.id === req.params.id);
  if (!char) return res.status(404).json({ error: 'Character not found' });
  const view = { ...char, portraitUrl: portraits.characterPortraitUrl(char.id) };
  res.json(view);
});

router.post('/:id/portrait', async (req, res) => {
  const char = store.getCharacters().find(c => c.id === req.params.id);
  if (!char) return res.status(404).json({ error: 'Character not found' });
  try {
    const port = await portraits.ensureCharacterPortrait(char, !!(req.body && req.body.force));
    res.json(port);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.put('/:id', (req, res) => {
  const chars = store.getCharacters();
  const char = chars.find(c => c.id === req.params.id);
  if (!char) return res.status(404).json({ error: 'Character not found' });
  if (req.body && req.body.name) char.name = String(req.body.name).trim().slice(0, 40);
  store.saveCharacters(chars);
  res.json(char);
});

router.post('/:id/equip', (req, res) => {
  const chars = store.getCharacters();
  const char = chars.find(c => c.id === req.params.id);
  if (!char) return res.status(404).json({ error: 'Character not found' });
  const { slot, itemId } = req.body || {};
  char.equipped = char.equipped || {};

  if (!itemId || itemId === 'none') {
    char.equipped[slot] = null;
  } else {
    const inInv = (char.inventory || []).some(i => i.itemId === itemId && i.qty > 0);
    if (!inInv) return res.status(400).json({ error: 'Item not in inventory' });
    char.equipped[slot] = itemId;
  }

  const dexMod = Math.floor(((char.abilities?.dex || 10) - 10) / 2);
  const armorId = char.equipped.armor;
  const offHandId = char.equipped.offHand;
  let baseAc = 10 + dexMod;

  if (armorId) {
    const arm = (engine.ARMORS || []).find(a => a.id === armorId);
    if (arm) {
      if (arm.type === 'light') baseAc = 11 + dexMod;
      else if (arm.type === 'medium') baseAc = 13 + Math.min(2, dexMod);
      else if (arm.type === 'heavy') baseAc = arm.ac ? parseInt(arm.ac) : 16;
    }
  }
  if (offHandId === 'shield') baseAc += 2;
  if (char.equipped.cloak === 'cloak_protection') baseAc += 1;
  if (char.equipped.ring1 === 'ring_protection') baseAc += 1;
  // keep the equipped armor/shield first in inventory so the engine AC calc
  // (first-armor-find) agrees with the paperdoll, then recompute via the engine
  char.inventory = char.inventory || [];
  const reorder = (itemId) => {
    const idx = char.inventory.findIndex(i => i.itemId === itemId);
    if (idx > 0) { const [it] = char.inventory.splice(idx, 1); char.inventory.unshift(it); }
  };
  if (armorId) reorder(armorId);
  if (offHandId) reorder(offHandId);

  const cls = (engine.CLASSES || []).find(c => c.id === char.className);
  if (cls) engine.applyClassAndSpecies(char, cls, null, char.level || 1, true);

  if (char.equipped.mainHand) {
    const w = engine.resolveWeapon(char.equipped.mainHand);
    if (w) {
      const strMod = Math.floor(((char.abilities?.str || 10) - 10) / 2);
      const isFinesse = (w.props || []).includes('finesse');
      const isRanged = !!w.range && w.range > 5;
      const abilityMod = isRanged ? dexMod : (isFinesse ? Math.max(strMod, dexMod) : strMod);
      const prof = (char.profBonus || 2);
      const mainAtk = {
        weaponId: w.id,
        name: w.name,
        bonus: prof + abilityMod + (w.magic || 0),
        dmgDice: w.damage || '1d6',
        dmgMod: abilityMod + (w.magic || 0),
        dmgType: w.damageType || 'slashing',
        ranged: isRanged,
        range: w.range || 5,
        props: w.props || []
      };
      // replace the old entry for this weapon but NEVER drop the unarmed strike
      const rest = (char.attacks || []).filter(a => a.weaponId !== w.id);
      const un = rest.find(a => a.weaponId === 'unarmed');
      char.attacks = [mainAtk, ...(rest.filter(a => a !== un)), un].filter(Boolean);
    }
  }

  store.saveCharacters(chars);
  res.json({ ok: true, char });
});

router.delete('/:id', (req, res) => {
  let chars = store.getCharacters();
  const before = chars.length;
  chars = chars.filter(c => c.id !== req.params.id);
  if (chars.length === before) return res.status(404).json({ error: 'Character not found' });
  store.saveCharacters(chars);
  store.listSaves().forEach(s => { if (s.characterId === req.params.id) store.deleteSave(s.id); });
  res.json({ ok: true });
});

module.exports = router;
