const path = require('path');
const express = require('express');
const store = require('./store');
const charactersRoute = require('./routes/characters');
const gameRoute = require('./routes/game');
const settingsRoute = require('./routes/settings');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '1mb' }));

// Basic CORS (harmless locally; useful if someone points another UI at the API)
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.get('/api/health', (req, res) => res.json({ ok: true, version: '1.0.0' }));

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
    gear: engine.GEAR,
    spells: engine.SPELLS,
    skills: engine.ALL_SKILLS,
    skillAbility: engine.SKILL_ABILITY
  });
});

app.use('/api/characters', charactersRoute);
app.use('/api/settings', settingsRoute);
app.use('/api/game', gameRoute);

// Static frontend + SPA fallback
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
app.use(express.static(PUBLIC_DIR));
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Not found' });
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

// JSON error handler
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: err.message || 'Internal error' });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`AI D&D server listening on http://localhost:${PORT}  (data dir: ${store.DATA_DIR})`);
});
