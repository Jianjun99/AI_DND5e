const path = require('path');
const express = require('express');
const store = require('./store');
const charactersRoute = require('./routes/characters');
const gameRoute = require('./routes/game');
const settingsRoute = require('./routes/settings');
const dataRoute = require('./routes/data');
const contentRoute = require('./routes/content');
const cityRoute = require('./routes/city');
const { localeMiddleware, localeInfo } = require('./locale');

const app = express();
const PORT = process.env.PORT || 3000;

// Only the resource bundle and draft endpoints accept the bounded base64 GLB payload.
app.use(['/api/content/import', '/api/content/validate', '/api/content/drafts'], express.json({ limit: '12mb' }));
app.use(express.json({ limit: '1mb' }));

// Basic CORS (harmless locally; useful if someone points another UI at the API)
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Game-Locale');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.get('/api/health', (req, res) => res.json({ ok: true, version: require('../package.json').version }));
app.use('/api', localeMiddleware);
app.use('/api', require('./game/presentation').middleware);
app.get('/api/locale', localeInfo);

// Rules data for the character creator / UI (monsters & maps stay server-side to avoid spoilers)
app.get('/api/rules', (req, res) => {
  const engine = require('./game/engine');
  res.json({
    species: engine.SPECIES,
    classes: engine.CLASSES,
    backgrounds: engine.BACKGROUNDS,
    feats: engine.FEATS,
    weapons: engine.WEAPONS,
    armor: engine.ARMORS,
    spells: engine.SPELLS,
    skills: engine.ALL_SKILLS,
    skillAbility: engine.SKILL_ABILITY,
    shop: engine.SHOP_ITEMS,
    difficulty: Object.fromEntries(Object.entries(engine.DIFFICULTY).map(([id, value]) => [id, {
      ...value, labelDisplay: { key: 'difficulty.' + id + '.label' }, blurbDisplay: { key: 'difficulty.' + id + '.blurb' }
    }])),
    allies: engine.ALLIES,
    // T5 quick-start presets: client-facing metadata only — the build drafts stay server-side
    presets: require('./game/presets').listPresets(),
    gear: require('./game/content').listGear()
  });
});

app.use('/api/characters', charactersRoute);
app.use('/api/settings', settingsRoute);
app.use('/api/game', gameRoute);
app.use('/api/data', dataRoute);
app.use('/api/content', contentRoute);
app.use('/api/city', cityRoute);

// Static frontend + SPA fallback
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
app.use(express.static(PUBLIC_DIR));
app.use('/portraits', express.static(store.DATA_DIR + '/portraits', { maxAge: '7d' }));
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Not found', errorDisplay: { key: "api.notFound" } });
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

// JSON error handler
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: err.message || 'Internal error' });
});

// A draft that no longer exists owns no playtest run: release those saves and heroes on
// startup so a crashed or abandoned studio session cannot pile up scratch data.
try {
  const swept = require('./game/content-authoring').sweepOrphanPlaytests();
  if (swept.saves.length || swept.heroes.length) {
    console.log(`store: released ${swept.saves.length} orphan playtest save(s), ${swept.heroes.length} playtest hero(es)`);
  }
} catch (e) { console.error('store: playtest sweep skipped:', e.message); }

app.listen(PORT, '0.0.0.0', () => {
  console.log(`AI D&D server listening on http://localhost:${PORT}  (data dir: ${store.DATA_DIR})`);
});
