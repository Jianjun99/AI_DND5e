// Backup & restore: export everything as one JSON file, or import a backup.
const express = require('express');
const store = require('../store');

const router = express.Router();

router.get('/export', (req, res) => {
  const saves = store.listSaves().map(s => store.getSave(s.id)).filter(Boolean);
  res.json({
    format: 'ai-dnd-backup',
    version: 1,
    exportedAt: Date.now(),
    characters: store.getCharacters(),
    saves,
    settings: store.getSettings()
  });
});

router.post('/import', (req, res) => {
  const data = req.body || {};
  if (data.format !== 'ai-dnd-backup' || !Array.isArray(data.characters)) {
    return res.status(400).json({ error: 'Not a valid AI Dungeon backup file.' });
  }
  store.saveCharacters(data.characters);
  (data.saves || []).forEach(s => {
    if (s && s.id && s.entities && s.map) store.saveGame(s);
  });
  if (data.settings) store.saveSettings(data.settings);
  res.json({
    ok: true,
    imported: { characters: data.characters.length, saves: (data.saves || []).length }
  });
});

module.exports = router;
