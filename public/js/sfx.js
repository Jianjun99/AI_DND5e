// sfx.js — tiny synthesized sound effects via Web Audio (no asset files, fully offline).
let ctx = null;
let enabled = localStorage.getItem('dnd_sfx') !== 'off';

function ac() {
  if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

function tone(freq, dur, type = 'sine', vol = 0.12, delay = 0, slideTo = null) {
  const c = ac(), t = c.currentTime + delay;
  const o = c.createOscillator(), g = c.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, t);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g); g.connect(c.destination);
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
  src.connect(g); g.connect(c.destination);
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

export const sfx = {
  play(name) {
    if (!enabled || !SOUNDS[name]) return;
    try { SOUNDS[name](); } catch { /* audio is optional */ }
  },
  toggle() {
    enabled = !enabled;
    localStorage.setItem('dnd_sfx', enabled ? 'on' : 'off');
    return enabled;
  },
  isEnabled() { return enabled; }
};
