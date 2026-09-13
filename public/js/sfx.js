// sfx.js — tiny synthesized sound effects + ambient dungeon audio via Web Audio
// (no asset files, fully offline). Master volume is controllable.
let ctx = null;
let master = null;
let enabled = localStorage.getItem('dnd_sfx') !== 'off';
let volume = parseFloat(localStorage.getItem('dnd_vol') ?? '0.6');
if (isNaN(volume)) volume = 0.6;

function ac() {
  if (!ctx) {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain();
    master.gain.value = volume;
    master.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}
function out() { ac(); return master; }

function tone(freq, dur, type = 'sine', vol = 0.12, delay = 0, slideTo = null) {
  const c = ac(), t = c.currentTime + delay;
  const o = c.createOscillator(), g = c.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, t);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g); g.connect(out());
  o.start(t); o.stop(t + dur + 0.02);
}

function noise(dur = 0.08, vol = 0.1, delay = 0) {
  const c = ac(), t = c.currentTime + delay;
  const len = Math.floor(c.sampleRate * dur);
  const buf = c.createBuffer(1, len, c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = c.createBufferSource(); src.buffer = buf;
  const g = c.createGain(); g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(g); g.connect(out());
  src.start(t);
}

const SOUNDS = {
  dice: () => { noise(0.05, 0.08); noise(0.05, 0.06, 0.06); noise(0.06, 0.05, 0.12); },
  attack: () => tone(220, 0.12, 'square', 0.08, 0, 120),
  hit: () => { tone(110, 0.14, 'sine', 0.18, 0, 70); noise(0.05, 0.08); },
  crit: () => { tone(880, 0.1, 'square', 0.1); tone(1320, 0.16, 'square', 0.1, 0.08); },
  miss: () => noise(0.12, 0.05),
  heal: () => { tone(520, 0.12, 'sine', 0.1); tone(660, 0.14, 'sine', 0.1, 0.09); },
  levelup: () => { tone(523, 0.12, 'triangle', 0.12); tone(659, 0.12, 'triangle', 0.12, 0.11); tone(784, 0.2, 'triangle', 0.12, 0.22); },
  quest: () => { tone(988, 0.12, 'triangle', 0.1); tone(1319, 0.18, 'triangle', 0.1, 0.1); },
  coin: () => { tone(1567, 0.07, 'triangle', 0.09); tone(2093, 0.12, 'triangle', 0.07, 0.05); },
  death: () => { tone(140, 0.5, 'sawtooth', 0.12, 0, 55); },
  trap: () => { noise(0.05, 0.12); tone(180, 0.1, 'square', 0.08); },
  victory: () => { [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.16, 'triangle', 0.11, i * 0.13)); },
  door: () => noise(0.18, 0.06),
  spell: () => tone(700, 0.18, 'sine', 0.09, 0, 1400)
};

// ---- ambient loop: a low dungeon drone (crypt) or hillside wind (hills) ----
let ambient = null; // { nodes: [...], theme }
function startAmbient(theme = 'crypt') {
  if (!enabled || volume <= 0) return;
  stopAmbient();
  const c = ac();
  const nodes = [];
  // looping noise bed
  const len = c.sampleRate * 3;
  const buf = c.createBuffer(1, len, c.sampleRate);
  const d = buf.getChannelData(0);
  let last = 0;
  for (let i = 0; i < len; i++) { // brown-ish noise
    const white = Math.random() * 2 - 1;
    last = (last + 0.02 * white) / 1.02;
    d[i] = last * 3.5;
  }
  const src = c.createBufferSource(); src.buffer = buf; src.loop = true;
  const filter = c.createBiquadFilter();
  const g = c.createGain();
  if (theme === 'hills') {
    filter.type = 'bandpass'; filter.frequency.value = 420; filter.Q.value = 0.6;
    g.gain.value = 0.05; // wind
  } else {
    filter.type = 'lowpass'; filter.frequency.value = 160;
    g.gain.value = 0.07; // deep drone
  }
  // slow breathing LFO so it never feels static
  const lfo = c.createOscillator(), lg = c.createGain();
  lfo.frequency.value = theme === 'hills' ? 0.09 : 0.06;
  lg.gain.value = g.gain.value * 0.6;
  lfo.connect(lg); lg.connect(g.gain);
  src.connect(filter); filter.connect(g); g.connect(out());
  src.start(); lfo.start();
  nodes.push(src, lfo);
  ambient = { nodes, theme };
}

function stopAmbient() {
  if (!ambient) return;
  ambient.nodes.forEach(n => { try { n.stop(); } catch {} });
  ambient = null;
}

export const sfx = {
  play(name) {
    if (!enabled || !SOUNDS[name]) return;
    try { SOUNDS[name](); } catch { /* audio is optional */ }
  },
  toggle() {
    enabled = !enabled;
    localStorage.setItem('dnd_sfx', enabled ? 'on' : 'off');
    if (!enabled) { stopAmbient(); } 
    return enabled;
  },
  isEnabled() { return enabled; },
  setVolume(v) {
    volume = Math.max(0, Math.min(1, v));
    localStorage.setItem('dnd_vol', String(volume));
    if (ctx && master) master.gain.value = volume;
  },
  getVolume() { return volume; },
  startAmbient(theme) { if (enabled) startAmbient(theme); },
  stopAmbient
};
