// Content packs: list what's loaded, import shared packs, export for sharing.
const express = require('express');
const fs = require('fs');
const path = require('path');
const content = require('../game/content');
const store = require('../store');

const router = express.Router();

router.get('/', (req, res) => {
  content.reload();
  res.json({ packs: content.listPacks(), maps: content.listMaps(), warnings: content.warnings() });
});

router.get('/pack/:id/export', (req, res) => {
  const reg = content.reload();
  const pack = reg.packs.find(p => p.id === req.params.id && p.id !== 'core');
  if (!pack) return res.status(404).json({ error: 'Pack not found (core content cannot be exported)' });
  const bundle = {
    format: 'ai-dnd-pack',
    version: 1,
    pack: { id: pack.id, name: pack.name, author: pack.author, blurb: pack.blurb },
    maps: pack.maps.map(id => JSON.parse(JSON.stringify(reg.maps[id]))),
    monsters: pack.monsters.map(id => JSON.parse(JSON.stringify(reg.monsters[id]))),
    gear: pack.gear.map(id => JSON.parse(JSON.stringify(reg.gear[id])))
  };
  res.setHeader('Content-Disposition', `attachment; filename="${pack.id}.json"`);
  res.json(bundle);
});

router.post('/import', (req, res) => {
  const bundle = req.body || {};
  if (bundle.format !== 'ai-dnd-pack' || !bundle.pack || !bundle.pack.id) {
    return res.status(400).json({ error: 'Not a valid AI Dungeon content pack file.' });
  }
  const packId = String(bundle.pack.id).toLowerCase().replace(/[^a-z0-9_-]/g, '-');
  const dir = path.join(store.DATA_DIR, 'content', packId);
  try {
    fs.mkdirSync(path.join(dir, 'maps'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'pack.json'), JSON.stringify({ ...bundle.pack, id: packId }, null, 2));
    (bundle.maps || []).forEach(m => fs.writeFileSync(path.join(dir, 'maps', m.id + '.json'), JSON.stringify(m, null, 2)));
    if ((bundle.monsters || []).length) fs.writeFileSync(path.join(dir, 'monsters.json'), JSON.stringify({ monsters: bundle.monsters }, null, 2));
    if ((bundle.gear || []).length) fs.writeFileSync(path.join(dir, 'gear.json'), JSON.stringify({ gear: bundle.gear }, null, 2));
    const reg = content.reload();
    const loaded = reg.packs.find(p => p.id === packId);
    res.json({
      ok: true,
      pack: loaded ? { id: loaded.id, name: loaded.name, maps: loaded.maps, monsters: loaded.monsters, gear: loaded.gear } : null,
      warnings: reg.warnings
    });
  } catch (e) {
    res.status(500).json({ error: 'Import failed: ' + e.message });
  }
});

module.exports = router;
