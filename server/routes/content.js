// Content packs: list what's loaded, import shared packs, export for sharing.
const express = require('express');
const fs = require('fs');
const content = require('../game/content');
const visualContent = require('../game/visual-content');
const visualSettings = require('../game/visual-settings');

const router = express.Router();

router.get('/visuals',(req,res)=>res.json(visualSettings.catalog(content.reload())));
router.put('/visuals',(req,res)=>{
  try { res.json(visualSettings.update(content.reload(),req.body||{})); }
  catch(error){res.status(400).json({error:error.message,errorDisplay:{key:'visual.invalidPreference'}});}
});
router.get('/pack/:id/asset/:modelId',(req,res)=>{
  const pack=content.reload().packs.find(p=>p.id===req.params.id),model=pack?.visual?.models.find(m=>m.id===req.params.modelId);
  if(!model)return res.status(404).end();
  try {
    const bytes=visualContent.readDeclaredAsset(pack.dir,model.file),info=visualContent.inspectGLB(bytes);
    if(info.digest!==model.digest || (req.query.digest&&req.query.digest!==info.digest))return res.status(409).end();
    res.set({'Content-Type':'model/gltf-binary','X-Content-Type-Options':'nosniff','Cache-Control':'no-store'});return res.send(bytes);
  }catch(error){return res.status(404).end();}
});

router.get('/', (req, res) => {
  content.reload();
  res.json({ packs: content.listPacks(), maps: content.listMaps(), ...content.adventureDirectory(), warnings: content.warnings(), diagnostics: content.diagnostics() });
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
  if (!pack) return res.status(404).json({ error: 'Pack not found (core content cannot be exported)', errorDisplay: { key: "api.packNotExportable" } });
  const bundle = {
    format: 'ai-dnd-pack',
    version: pack.visualPresent ? 2 : 1,
    pack: { id: pack.id, name: pack.name, author: pack.author, blurb: pack.blurb, ...(pack.localized ? {localized:pack.localized} : {}) },
    maps: pack.maps.map(id => JSON.parse(JSON.stringify(reg.maps[id]))),
    monsters: pack.monsters.map(id => JSON.parse(JSON.stringify(reg.monsters[id]))),
    gear: pack.gear.map(id => JSON.parse(JSON.stringify(reg.gear[id])))
  };
  if(pack.visualPresent) {
    // Broken installed visual assets must fail export explicitly, never disappear.
    if(!pack.visual)return res.status(409).json({error:'Visual assets are invalid; export aborted.',errorDisplay:{key:'visual.invalidExport'}});
    bundle.visuals=pack.visualManifest;
    bundle.assets=Object.fromEntries([...pack.visual.files].map(([file])=>[file,visualContent.readDeclaredAsset(pack.dir,file).toString('base64')]));
  }
  res.setHeader('Content-Disposition', `attachment; filename="${pack.id}.json"`);
  res.json(bundle);
});

router.delete('/pack/:id', (req, res) => {
  const reg = content.reload();
  const pack = reg.packs.find(p => p.id === req.params.id);
  if (!pack || pack.id === 'core') return res.status(404).json({ error: 'Pack not found (or built-in)', errorDisplay: { key: "api.packNotDeletable" } });
  if (!pack.installed) return res.status(400).json({ error: 'Shipped packs cannot be deleted — they are part of the game.', errorDisplay: { key: "api.shippedPack" } });
  fs.rmSync(pack.dir, { recursive: true, force: true });
  content.reload();
  res.json({ ok: true });
});

const contentAuthoring = require('../game/content-authoring');

// A draft is addressed by a stable path segment; anything else is a bad request, not a
// missing file — and never a chance to reach outside data/drafts/.
function draftError(res, err) {
  const status = err && err.status ? err.status : 500;
  const body = { error: err.message };
  if (err.code === 'invalid-draft-id') body.errorDisplay = { key: 'api.invalidDraftId', params: { error: err.message } };
  else if (err.code === 'draft-id-mismatch') body.errorDisplay = { key: 'api.draftIdMismatch', params: { error: err.message } };
  if (err.diagnostics) body.diagnostics = err.diagnostics;
  if (err.validation) Object.assign(body, err.validation, { error: err.message });
  res.status(status >= 400 && status <= 599 ? status : 500).json(body);
}

router.get('/drafts', (req, res) => {
  res.json({ drafts: contentAuthoring.listDrafts() });
});

router.post('/drafts/clone', (req, res) => {
  try {
    const cloned = contentAuthoring.cloneStarterTemplate(req.body || {});
    res.json(cloned);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get('/drafts/:id', (req, res) => {
  let data;
  try {
    data = contentAuthoring.getDraft(req.params.id);
  } catch (err) { return draftError(res, err); }
  if (!data) return res.status(404).json({ error: 'Draft not found', errorDisplay: { key: 'api.draftNotFound' } });
  res.json(data);
});

router.put('/drafts/:id', (req, res) => {
  const draftData = req.body?.draft || req.body;
  if (!draftData || !draftData.pack) return res.status(400).json({ error: 'Invalid draft payload' });
  try {
    const saved = contentAuthoring.saveDraft(req.params.id, draftData);
    res.json(saved);
  } catch (err) { draftError(res, err); }
});

router.delete('/drafts/:id', (req, res) => {
  try {
    res.json(contentAuthoring.deleteDraft(req.params.id));
  } catch (err) { draftError(res, err); }
});

router.post('/drafts/:id/validate', (req, res) => {
  let data;
  try {
    data = contentAuthoring.getDraft(req.params.id);
  } catch (err) { return draftError(res, err); }
  if (!data) return res.status(404).json({ error: 'Draft not found', errorDisplay: { key: 'api.draftNotFound' } });
  res.json(data.validation);
});

router.get('/drafts/:id/export', (req, res) => {
  let data;
  try {
    data = contentAuthoring.getDraft(req.params.id);
  } catch (err) { return draftError(res, err); }
  if (!data) return res.status(404).json({ error: 'Draft not found', errorDisplay: { key: 'api.draftNotFound' } });
  if (!data.validation.ok) {
    return res.status(400).json({
      error: 'Draft has validation errors; export aborted.',
      errorDisplay: { key: 'api.draftNotExportable', params: { count: data.validation.diagnostics.filter(d => d.severity === 'error').length } },
      diagnostics: data.validation.diagnostics
    });
  }
  const bundle = structuredClone(data.draft);
  delete bundle.updatedAt;
  res.setHeader('Content-Disposition', `attachment; filename="${data.draft.pack?.id || req.params.id}.json"`);
  res.json(bundle);
});

router.post('/drafts/:id/install', (req, res) => {
  try {
    const result = contentAuthoring.installDraft(req.params.id);
    res.json(result);
  } catch (err) {
    if (err.validation) return res.status(400).json({ error: err.message, validation: err.validation });
    draftError(res, err);
  }
});

router.post('/drafts/:id/playtest', (req, res) => {
  try {
    const result = contentAuthoring.playtestDraft(req.params.id, req.body || {});
    res.json(result);
  } catch (err) {
    if (err.validation) return res.status(400).json({ error: err.message, validation: err.validation });
    draftError(res, err);
  }
});

// Exiting a playtest run releases only the save this request names, after verifying the
// save itself declares that it is this draft's playtest.
router.post('/drafts/:id/playtest/exit', (req, res) => {
  try {
    const result = contentAuthoring.exitPlaytest(req.params.id, (req.body || {}).saveId);
    res.json(result);
  } catch (err) { draftError(res, err); }
});

router.post('/import', (req, res) => {
  const bundle = req.body || {};
  try {
    const result = contentAuthoring.installBundle(bundle);
    res.json(result);
  } catch (e) {
    if (e.validation) {
      return res.status(400).json({ error: 'Content validation failed.', errorDisplay: { key: "api.contentInvalid" }, ...e.validation });
    }
    res.status(500).json({ error: e.message, errorDisplay: { key: "api.importFailed", params: { error: e.message } } });
  }
});

module.exports = router;
