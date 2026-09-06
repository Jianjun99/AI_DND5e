// portraits.js — creature portraits with a provider chain and graceful fallback:
//   1. Google image models (uses the same AI Studio key as the DM voice)
//   2. A local SD WebUI / ComfyUI-compatible endpoint (optional, for GPU owners)
//   3. A deterministic procedural "soul sigil" (always works, fully offline)
// Portraits are cached per creature type — a crypt has ~10 faces, generated once ever.
const fs = require('fs');
const path = require('path');
const store = require('./store');

const PORTRAIT_DIR = path.join(store.DATA_DIR, 'portraits');
fs.mkdirSync(PORTRAIT_DIR, { recursive: true });

const cachePath = (key, ext) => path.join(PORTRAIT_DIR, key + '.' + ext);
function cached(key) {
  const png = cachePath(key, 'png');
  if (fs.existsSync(png)) return { url: '/portraits/' + key + '.png?v=' + fs.statSync(png).mtimeMs, kind: 'ai' };
  // procedural sigils are a placeholder: after 30 minutes, let the AI providers retry
  const svg = cachePath(key, 'svg');
  if (fs.existsSync(svg)) {
    const age = Date.now() - fs.statSync(svg).mtimeMs;
    if (age < 30 * 60 * 1000) return { url: '/portraits/' + key + '.svg?v=' + fs.statSync(svg).mtimeMs, kind: 'sigil' };
  }
  return null;
}

function creatureKey(state, ent) {
  return ent.kind === 'monster' ? ent.monsterId : ent.npcId;
}

function describeCreature(state, ent) {
  const key = creatureKey(state, ent);
  return (state.appearances && state.appearances[key]) || '';
}

function buildPrompt(state, ent) {
  const key = creatureKey(state, ent);
  const appearance = describeCreature(state, ent);
  const style = 'Dark fantasy oil painting portrait, head and shoulders, moody dungeon torchlight, painterly brushwork, muted palette, no text, no border';
  return `${ent.name} — ${appearance || 'an inhabitant of ' + state.mapName}. ${style}`;
}

async function googleImage(prompt, cfg) {
  if (!cfg.apiKey) throw new Error('no Google key');
  const model = String(cfg.imageModel || 'gemini-3.1-flash-image');
  const base = String(cfg.baseUrl || '').replace(/\/+$/, '');
  const res = await fetch(base + '/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + cfg.apiKey },
    body: JSON.stringify({ model, messages: [{ role: 'user', content: 'Generate an image: ' + prompt }] })
  });
  if (!res.ok) throw new Error('google HTTP ' + res.status);
  const data = await res.json();
  const msg = (data.choices && data.choices[0] && data.choices[0].message) || {};
  const img = (msg.images && msg.images[0] && msg.images[0].image_url && msg.images[0].image_url.url) || '';
  const m = /^data:image\/\w+;base64,(.+)$/.exec(img);
  if (!m) throw new Error('google returned no image (quota?)');
  return Buffer.from(m[1], 'base64');
}

async function sdWebuiImage(prompt, sdUrl) {
  if (!sdUrl) throw new Error('no SD url');
  const res = await fetch(sdUrl.replace(/\/+$/, '') + '/sdapi/v1/txt2img', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, steps: 18, width: 384, height: 448, cfg_scale: 7 })
  });
  if (!res.ok) throw new Error('sd HTTP ' + res.status);
  const data = await res.json();
  if (!data.images || !data.images[0]) throw new Error('sd returned no image');
  return Buffer.from(data.images[0], 'base64');
}

// Deterministic procedural sigil — a "painted soul card" unique per creature, offline forever.
function proceduralSvg(state, ent) {
  const key = creatureKey(state, ent);
  let h = 0; for (const ch of key) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const palettes = [
    ['#3b2a1a', '#c9a959'], ['#1d2a3b', '#7fa8c9'], ['#2a1d3b', '#b48ac9'],
    ['#3b1d1d', '#c97f7f'], ['#1d3b2a', '#7fc9a8'], ['#33301a', '#d1c37a']
  ];
  const [dark, glow] = palettes[h % palettes.length];
  const emoji = ent.kind === 'monster'
    ? (ent.boss ? '👹' : { giant_rat: '🐀', skeleton: '💀', zombie: '🧟', goblin: '👺', cultist: '🕯️', ogre: '👹', crypt_hound: '🐕', tomb_warden: '🗿' }[ent.monsterId] || '👹')
    : ({ bram: '🧭', marla: '🧺', morthek: '🩸' }[ent.npcId] || '🗣️');
  const runes = ['ᚠ', 'ᚱ', 'ᚦ', 'ᚨ', 'ᛃ', 'ᛇ', 'ᛉ', 'ᛟ'];
  const ring = runes.map((r, i) => {
    const a = (i / runes.length) * Math.PI * 2 + (h % 20) / 20;
    return `<text x="${80 + Math.cos(a) * 62}" y="${92 + Math.sin(a) * 62}" fill="${glow}" font-size="13" opacity="0.7" text-anchor="middle">${r}</text>`;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="184" viewBox="0 0 160 184">
  <defs>
    <radialGradient id="bg" cx="50%" cy="38%"><stop offset="0%" stop-color="${glow}" stop-opacity="0.25"/><stop offset="100%" stop-color="${dark}"/></radialGradient>
  </defs>
  <rect width="160" height="184" rx="10" fill="url(#bg)" stroke="#3d352b"/>
  <rect x="6" y="6" width="148" height="172" rx="7" fill="none" stroke="${glow}" stroke-opacity="0.35"/>
  <circle cx="80" cy="92" r="72" fill="none" stroke="${glow}" stroke-opacity="0.25"/>
  ${ring}
  <text x="80" y="112" font-size="64" text-anchor="middle">${emoji}</text>
  <text x="80" y="172" font-size="11" fill="${glow}" text-anchor="middle" opacity="0.85">${ent.name.slice(0, 22)}</text>
</svg>`;
}

// Ensure a portrait exists for the creature; returns { url, kind } or { pending: true }
async function ensurePortrait(state, ent) {
  const key = creatureKey(state, ent);
  const hit = cached(key);
  if (hit) return hit;
  const settings = store.getSettings();
  const portraitsCfg = settings.portraits || { enabled: true, sdUrl: '' };
  if (portraitsCfg.enabled === false) return { url: cachedOrSigilOnly(state, ent, key), kind: 'sigil', pending: false };
  const prompt = buildPrompt(state, ent);
  // 1. Google (same key as the DM voice)
  try {
    const buf = await googleImage(prompt, settings.llm || {});
    fs.writeFileSync(cachePath(key, 'png'), buf);
    return { url: '/portraits/' + key + '.png?v=' + Date.now(), kind: 'ai' };
  } catch { /* quota or unavailable — try the next provider */ }
  // 2. local SD WebUI if configured
  try {
    const buf = await sdWebuiImage(prompt, portraitsCfg.sdUrl);
    fs.writeFileSync(cachePath(key, 'png'), buf);
    return { url: '/portraits/' + key + '.png?v=' + Date.now(), kind: 'sd' };
  } catch { /* not configured or unreachable */ }
  // 3. procedural sigil (cached so we don't re-render constantly) but marked pending
  //    so a future request can still try the AI providers once quota frees up
  const svg = proceduralSvg(state, ent);
  fs.writeFileSync(cachePath(key, 'svg'), svg);
  return { url: '/portraits/' + key + '.svg', kind: 'sigil', pending: true };
}

function cachedOrSigilOnly(state, ent, key) {
  const p = cachePath(key, 'svg');
  if (!fs.existsSync(p)) fs.writeFileSync(p, proceduralSvg(state, ent));
  return '/portraits/' + key + '.svg';
}

module.exports = { ensurePortrait };
