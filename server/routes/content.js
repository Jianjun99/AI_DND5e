// Content packs: list what's loaded, import shared packs, export for sharing.
const express = require('express');
const fs = require('fs');
const path = require('path');
const content = require('../game/content');
const store = require('../store');

const router = express.Router();

router.get('/', (req, res) => {
  content.reload();
  res.json({ packs: content.listPacks(), maps: content.listMaps(), warnings: content.warnings(), diagnostics: content.diagnostics() });
});

router.get('/validate', (req, res) => {
  const reg = content.reload();
  res.json({ ok: !reg.diagnostics.some(d => d.severity === 'error'), diagnostics: reg.diagnostics, warnings: reg.warnings });
});

router.post('/validate', (req, res) => {
  const result = content.validateBundle(req.body);
  res.status(result.ok ? 200 : 400).json(result);
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

router.delete('/pack/:id', (req, res) => {
  const reg = content.reload();
  const pack = reg.packs.find(p => p.id === req.params.id);
  if (!pack || pack.id === 'core') return res.status(404).json({ error: 'Pack not found (or built-in)' });
  if (!pack.installed) return res.status(400).json({ error: 'Shipped packs cannot be deleted — they are part of the game.' });
  fs.rmSync(pack.dir, { recursive: true, force: true });
  content.reload();
  res.json({ ok: true });
});

router.post('/import', (req, res) => {
  const bundle = req.body || {};
  const validation = content.validateBundle(bundle);
  if (!validation.ok) return res.status(400).json({ error: 'Content validation failed.', ...validation });
  const packId = bundle.pack.id;
  const root = path.resolve(store.DATA_DIR, 'content');
  const previous = content.scan({ cache: false }).packs.find(p => p.id === packId && p.installed);
  const dir = previous ? previous.dir : path.join(root, packId);
  // Staging lives outside the scanned content root, so backups never register as packs.
  const stagingRoot = path.join(store.DATA_DIR, '.content-imports');
  fs.mkdirSync(stagingRoot, { recursive: true });
  const transaction = fs.mkdtempSync(path.join(stagingRoot, 'import-'));
  const stage = path.join(transaction, 'pack'), backup = path.join(transaction, 'backup');
  let backedUp = false, installed = false, rollbackFailed = false;
  try {
    const relative = path.relative(root, path.resolve(dir));
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Pack directory is outside the installed content root.');
    if (!previous && fs.existsSync(dir)) throw new Error('Target folder already exists without a registered pack.');
    fs.mkdirSync(path.join(stage, 'maps'), { recursive: true });
    fs.writeFileSync(path.join(stage, 'pack.json'), JSON.stringify(bundle.pack, null, 2));
    (bundle.maps || []).forEach(m => fs.writeFileSync(path.join(stage, 'maps', m.id + '.json'), JSON.stringify(m, null, 2)));
    fs.writeFileSync(path.join(stage, 'monsters.json'), JSON.stringify({ monsters: bundle.monsters || [] }, null, 2));
    fs.writeFileSync(path.join(stage, 'gear.json'), JSON.stringify({ gear: bundle.gear || [] }, null, 2));
    fs.mkdirSync(root, { recursive: true });
    if (previous) { fs.renameSync(dir, backup); backedUp = true; }
    fs.renameSync(stage, dir); installed = true;
    const reg = content.reload();
    const loaded = reg.packs.find(p => p.id === packId);
    res.json({
      ok: true,
      pack: loaded ? { id: loaded.id, name: loaded.name, maps: loaded.maps, monsters: loaded.monsters, gear: loaded.gear } : null,
      warnings: reg.warnings, diagnostics: reg.diagnostics
    });
  } catch (e) {
    try {
      if (installed) fs.rmSync(dir, { recursive: true, force: true });
      if (backedUp) fs.renameSync(backup, dir);
    } catch (rollbackError) {
      rollbackFailed = true;
      return res.status(500).json({ error: 'Import failed: ' + e.message + '; rollback failed: ' + rollbackError.message, backup });
    }
    content.reload();
    res.status(500).json({ error: 'Import failed: ' + e.message });
  } finally {
    if (!rollbackFailed) fs.rmSync(transaction, { recursive: true, force: true });
  }
});

module.exports = router;
