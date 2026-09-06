const express = require('express');
const store = require('../store');
const engine = require('../game/engine');

const router = express.Router();

router.get('/', (req, res) => {
  const chars = store.getCharacters().map(c => ({
    id: c.id, name: c.name, species: c.species, className: c.className, background: c.background,
    level: c.level, xp: c.xp, hpMax: c.hpMax, acBase: c.acBase, gold: c.gold,
    createdAt: c.createdAt
  }));
  res.json(chars);
});

router.post('/', (req, res) => {
  const draft = req.body || {};
  if (!draft.name || !String(draft.name).trim()) return res.status(400).json({ error: 'Name is required' });
  try {
    const char = engine.buildCharacter({ ...draft, name: String(draft.name).trim().slice(0, 40) });
    char.id = store.newId('char');
    char.createdAt = Date.now();
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
  res.json(char);
});

router.put('/:id', (req, res) => {
  const chars = store.getCharacters();
  const char = chars.find(c => c.id === req.params.id);
  if (!char) return res.status(404).json({ error: 'Character not found' });
  if (req.body && req.body.name) char.name = String(req.body.name).trim().slice(0, 40);
  store.saveCharacters(chars);
  res.json(char);
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
