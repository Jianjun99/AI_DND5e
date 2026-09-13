// sfx.js — procedural sound effects & atmospheric soundscapes via Web Audio API.
// Multi-channel audio mixer: Master, Ambience/Music, SFX, and Voice.
// 100% offline, zero asset downloads, lightweight and responsive.

let ctx = null;
let masterGain = null;
let ambientGain = null;
let sfxGain = null;

// Persistent volume levels (0.0 to 1.0)
let volMaster = parseFloat(localStorage.getItem('dnd_vol_master') ?? localStorage.getItem('dnd_vol') ?? '0.7');
let volAmbient = parseFloat(localStorage.getItem('dnd_vol_ambient') ?? '0.5');
let volSfx = parseFloat(localStorage.getItem('dnd_vol_sfx') ?? '0.7');
let volVoice = parseFloat(localStorage.getItem('dnd_vol_voice') ?? '0.8');

if (isNaN(volMaster)) volMaster = 0.7;
if (isNaN(volAmbient)) volAmbient = 0.5;
if (isNaN(volSfx)) volSfx = 0.7;
if (isNaN(volVoice)) volVoice = 0.8;

const muted = {
  master: localStorage.getItem('dnd_mute_master') === 'true',
  ambient: localStorage.getItem('dnd_mute_ambient') === 'true',
  sfx: localStorage.getItem('dnd_mute_sfx') === 'true',
  voice: localStorage.getItem('dnd_mute_voice') === 'true'
};

function getAudioContext() {
  if (!ctx) {
    ctx = new (window.AudioContext || window.webkitAudioContext)();

    masterGain = ctx.createGain();
    masterGain.gain.setValueAtTime(muted.master ? 0 : volMaster, ctx.currentTime);
    masterGain.connect(ctx.destination);

    ambientGain = ctx.createGain();
    ambientGain.gain.setValueAtTime(muted.ambient ? 0 : volAmbient, ctx.currentTime);
    ambientGain.connect(masterGain);

    sfxGain = ctx.createGain();
    sfxGain.gain.setValueAtTime(muted.sfx ? 0 : volSfx, ctx.currentTime);
    sfxGain.connect(masterGain);
  }
  if (ctx.state === 'suspended') {
    ctx.resume().catch(() => {});
  }
  return ctx;
}

function outSfx() {
  getAudioContext();
  return sfxGain;
}

function outAmbient() {
  getAudioContext();
  return ambientGain;
}

// -------------------------------------------------------------
// Procedural Synthesis Primitives
// -------------------------------------------------------------
function tone(freq, dur, type = 'sine', vol = 0.12, delay = 0, slideTo = null, dest = null) {
  const c = getAudioContext(), t = c.currentTime + delay;
  const o = c.createOscillator(), g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(1, slideTo), t + dur);
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g);
  g.connect(dest || outSfx());
  o.start(t);
  o.stop(t + dur + 0.05);
}

function noise(dur = 0.08, vol = 0.1, delay = 0, filterFreq = null, dest = null) {
  const c = getAudioContext(), t = c.currentTime + delay;
  const len = Math.max(1, Math.floor(c.sampleRate * dur));
  const buf = c.createBuffer(1, len, c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = c.createBufferSource();
  src.buffer = buf;
  const g = c.createGain();
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);

  if (filterFreq) {
    const f = c.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(filterFreq, t);
    src.connect(f);
    f.connect(g);
  } else {
    src.connect(g);
  }

  g.connect(dest || outSfx());
  src.start(t);
}

// -------------------------------------------------------------
// Sound Effects Catalog
// -------------------------------------------------------------
const SOUNDS = {
  dice: () => {
    noise(0.04, 0.08);
    noise(0.05, 0.07, 0.06);
    noise(0.06, 0.05, 0.12);
    tone(750, 0.04, 'sine', 0.04, 0.14);
  },
  attack: () => tone(240, 0.13, 'sawtooth', 0.07, 0, 110),
  hit: () => {
    tone(120, 0.16, 'sine', 0.18, 0, 55);
    noise(0.07, 0.1);
  },
  crit: () => {
    tone(880, 0.1, 'square', 0.09);
    tone(1320, 0.18, 'square', 0.09, 0.08);
    tone(1760, 0.22, 'sine', 0.1, 0.16);
  },
  miss: () => noise(0.14, 0.04, 0, 800),
  parry: () => {
    tone(1200, 0.15, 'triangle', 0.12, 0, 800);
    tone(2400, 0.08, 'sine', 0.08);
    noise(0.03, 0.06);
  },
  heal: () => {
    tone(523, 0.14, 'sine', 0.1);
    tone(659, 0.16, 'sine', 0.1, 0.08);
    tone(784, 0.2, 'sine', 0.09, 0.16);
  },
  potion: () => {
    tone(380, 0.09, 'sine', 0.09, 0, 520);
    tone(520, 0.11, 'sine', 0.09, 0.07, 700);
    noise(0.04, 0.05, 0.14);
  },
  levelup: () => {
    [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.22, 'triangle', 0.11, i * 0.11));
  },
  level_up: () => {
    [523, 659, 784, 1046, 1318, 1567].forEach((f, i) => {
      tone(f, 0.28, 'triangle', 0.13, i * 0.1);
      tone(f * 1.5, 0.18, 'sine', 0.06, i * 0.1 + 0.04);
    });
  },
  travel_stairs: () => {
    noise(0.12, 0.1, 0, 320);
    tone(75, 0.25, 'sine', 0.12, 0.02, 45);
    noise(0.1, 0.08, 0.22, 380);
    tone(70, 0.22, 'sine', 0.1, 0.24, 40);
    noise(0.1, 0.08, 0.44, 340);
    tone(65, 0.28, 'sine', 0.11, 0.46, 35);
  },
  equip: () => {
    noise(0.06, 0.09, 0, 1600);
    tone(980, 0.1, 'triangle', 0.09, 0.03, 1400);
    tone(1480, 0.08, 'sine', 0.06, 0.07);
  },
  trophy_unlock: () => {
    [1046, 1318, 1567, 2093].forEach((f, i) => tone(f, 0.2, 'sine', 0.08, i * 0.09));
  },
  quest: () => {
    tone(988, 0.12, 'triangle', 0.1);
    tone(1319, 0.2, 'triangle', 0.1, 0.1);
  },
  coin: () => {
    tone(1567, 0.06, 'triangle', 0.08);
    tone(2093, 0.12, 'triangle', 0.07, 0.05);
  },
  chest_open: () => {
    tone(180, 0.25, 'sawtooth', 0.06, 0, 260);
    noise(0.08, 0.06, 0.2);
    tone(1400, 0.08, 'sine', 0.05, 0.22);
  },
  barrel_boom: () => {
    tone(80, 0.45, 'sine', 0.25, 0, 30);
    noise(0.4, 0.2, 0, 600);
    noise(0.2, 0.12, 0.1);
  },
  hazard_burn: () => {
    noise(0.25, 0.08, 0, 1200);
    tone(220, 0.18, 'sawtooth', 0.06, 0, 140);
  },
  stealth: () => {
    noise(0.18, 0.04, 0, 450);
  },
  retreat: () => {
    [784, 659, 523].forEach((f, i) => tone(f, 0.24, 'sine', 0.09, i * 0.14));
  },
  death: () => {
    tone(140, 0.55, 'sawtooth', 0.14, 0, 45);
  },
  trap: () => {
    noise(0.06, 0.14);
    tone(190, 0.12, 'square', 0.09, 0, 80);
  },
  victory: () => {
    [523, 659, 784, 1046, 1318].forEach((f, i) => tone(f, 0.2, 'triangle', 0.12, i * 0.12));
  },
  door: () => {
    noise(0.2, 0.07, 0, 500);
    tone(95, 0.22, 'sine', 0.08, 0, 75);
  },
  spell: () => tone(720, 0.2, 'sine', 0.09, 0, 1450)
};

// -------------------------------------------------------------
// Atmospheric Ambient Soundscapes
// -------------------------------------------------------------
let currentAmbient = null; // { nodes: [], intervalId, theme, gainNode }

function buildBrownNoiseBuffer(c, seconds = 4) {
  const len = Math.floor(c.sampleRate * seconds);
  const buf = c.createBuffer(1, len, c.sampleRate);
  const d = buf.getChannelData(0);
  let last = 0;
  for (let i = 0; i < len; i++) {
    const white = Math.random() * 2 - 1;
    last = (last + 0.025 * white) / 1.025;
    d[i] = last * 3.8;
  }
  return buf;
}

function startAmbient(theme = 'crypt') {
  if (currentAmbient && currentAmbient.theme === theme) return;
  stopAmbient(400);

  const c = getAudioContext();
  const themeGain = c.createGain();
  themeGain.gain.setValueAtTime(0.0001, c.currentTime);
  themeGain.gain.exponentialRampToValueAtTime(1.0, c.currentTime + 0.5);
  themeGain.connect(outAmbient());

  const nodes = [];
  let intervalId = null;

  if (theme === 'crypt') {
    // 1. Sunless Crypt: Deep subterranean brown drone + breathing LFO + water drips
    const buf = buildBrownNoiseBuffer(c, 4);
    const src = c.createBufferSource();
    src.buffer = buf;
    src.loop = true;

    const filter = c.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 130;

    const g = c.createGain();
    g.gain.value = 0.07;

    const lfo = c.createOscillator();
    const lg = c.createGain();
    lfo.frequency.value = 0.05;
    lg.gain.value = 0.03;
    lfo.connect(lg);
    lg.connect(g.gain);

    // Sub-bass rumble
    const sub = c.createOscillator();
    sub.frequency.value = 55;
    const subG = c.createGain();
    subG.gain.value = 0.04;
    sub.connect(subG);
    subG.connect(themeGain);

    src.connect(filter);
    filter.connect(g);
    g.connect(themeGain);

    src.start();
    lfo.start();
    sub.start();
    nodes.push(src, lfo, sub);

    // Periodic cave water drips
    intervalId = setInterval(() => {
      if (!currentAmbient || currentAmbient.theme !== 'crypt') return;
      if (Math.random() < 0.65) {
        const dripFreq = 1400 + Math.random() * 500;
        tone(dripFreq, 0.09, 'sine', 0.03, 0, dripFreq * 0.85, themeGain);
        setTimeout(() => {
          if (Math.random() < 0.3) {
            tone(dripFreq * 0.9, 0.07, 'sine', 0.015, 0, dripFreq * 0.75, themeGain);
          }
        }, 120);
      }
    }, 3200);

  } else if (theme === 'hills') {
    // 2. Howling Hills: Mountain wind with resonant bandpass gusts
    const buf = buildBrownNoiseBuffer(c, 4);
    const src = c.createBufferSource();
    src.buffer = buf;
    src.loop = true;

    const filter = c.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 420;
    filter.Q.value = 0.8;

    const g = c.createGain();
    g.gain.value = 0.06;

    const lfo1 = c.createOscillator();
    const lg1 = c.createGain();
    lfo1.frequency.value = 0.08;
    lg1.gain.value = 0.035;
    lfo1.connect(lg1);
    lg1.connect(g.gain);

    const lfo2 = c.createOscillator();
    const lg2 = c.createGain();
    lfo2.frequency.value = 0.14;
    lg2.gain.value = 80;
    lfo2.connect(lg2);
    lg2.connect(filter.frequency);

    src.connect(filter);
    filter.connect(g);
    g.connect(themeGain);

    src.start();
    lfo1.start();
    lfo2.start();
    nodes.push(src, lfo1, lfo2);

  } else if (theme === 'vault') {
    // 3. Drowned Vault: Low subterranean cistern resonance + wave laps
    const buf = buildBrownNoiseBuffer(c, 4);
    const src = c.createBufferSource();
    src.buffer = buf;
    src.loop = true;

    const lowpass = c.createBiquadFilter();
    lowpass.type = 'lowpass';
    lowpass.frequency.value = 95;

    const g = c.createGain();
    g.gain.value = 0.06;

    src.connect(lowpass);
    lowpass.connect(g);
    g.connect(themeGain);

    // Water churning band
    const waterSrc = c.createBufferSource();
    waterSrc.buffer = buf;
    waterSrc.loop = true;
    const waterBand = c.createBiquadFilter();
    waterBand.type = 'bandpass';
    waterBand.frequency.value = 320;
    waterBand.Q.value = 1.1;
    const waterG = c.createGain();
    waterG.gain.value = 0.035;

    const waterLfo = c.createOscillator();
    const wlg = c.createGain();
    waterLfo.frequency.value = 0.18;
    wlg.gain.value = 0.02;
    waterLfo.connect(wlg);
    wlg.connect(waterG.gain);

    waterSrc.connect(waterBand);
    waterBand.connect(waterG);
    waterG.connect(themeGain);

    src.start();
    waterSrc.start();
    waterLfo.start();
    nodes.push(src, waterSrc, waterLfo);

    // Periodic sluice wave lap
    intervalId = setInterval(() => {
      if (!currentAmbient || currentAmbient.theme !== 'vault') return;
      noise(0.7, 0.03, 0, 450, themeGain);
    }, 4500);

  } else if (theme === 'town') {
    // 4. Oakhaven Town & Tavern: Warm hearth crackle + gentle acoustic chord pad
    // Warm chords: C3, G3, E4
    [130.81, 196.00, 329.63].forEach(freq => {
      const osc = c.createOscillator();
      osc.type = 'triangle';
      osc.frequency.value = freq;
      const f = c.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = 380;
      const g = c.createGain();
      g.gain.value = 0.022;

      const trem = c.createOscillator();
      const tg = c.createGain();
      trem.frequency.value = 0.15;
      tg.gain.value = 0.008;
      trem.connect(tg);
      tg.connect(g.gain);

      osc.connect(f);
      f.connect(g);
      g.connect(themeGain);

      osc.start();
      trem.start();
      nodes.push(osc, trem);
    });

    // Hearth fire crackle
    const fireBuf = buildBrownNoiseBuffer(c, 2);
    const fireSrc = c.createBufferSource();
    fireSrc.buffer = fireBuf;
    fireSrc.loop = true;
    const fireF = c.createBiquadFilter();
    fireF.type = 'bandpass';
    fireF.frequency.value = 1100;
    fireF.Q.value = 1.4;
    const fireG = c.createGain();
    fireG.gain.value = 0.025;

    fireSrc.connect(fireF);
    fireF.connect(fireG);
    fireG.connect(themeGain);
    fireSrc.start();
    nodes.push(fireSrc);

    // Random ember pops
    intervalId = setInterval(() => {
      if (!currentAmbient || currentAmbient.theme !== 'town') return;
      if (Math.random() < 0.7) {
        noise(0.03, 0.03 + Math.random() * 0.03, 0, 2200, themeGain);
      }
    }, 1400);

  } else if (theme === 'combat') {
    // 5. Combat Battle Tension: Tense resonant drone + 90 BPM pulse
    const saw = c.createOscillator();
    saw.type = 'sawtooth';
    saw.frequency.value = 110;
    const sawF = c.createBiquadFilter();
    sawF.type = 'lowpass';
    sawF.frequency.value = 240;
    const sawG = c.createGain();
    sawG.gain.value = 0.035;

    saw.connect(sawF);
    sawF.connect(sawG);
    sawG.connect(themeGain);
    saw.start();
    nodes.push(saw);

    // War-drum heartbeat cadence (90 BPM = ~667ms per beat)
    intervalId = setInterval(() => {
      if (!currentAmbient || currentAmbient.theme !== 'combat') return;
      // Main drum hit
      tone(68, 0.18, 'sine', 0.08, 0, 32, themeGain);
      noise(0.04, 0.04, 0, 500, themeGain);
      // Secondary lighter heartbeat syncopation
      setTimeout(() => {
        if (!currentAmbient || currentAmbient.theme !== 'combat') return;
        tone(62, 0.14, 'sine', 0.05, 0, 30, themeGain);
      }, 220);
    }, 667);
  }

  currentAmbient = { nodes, intervalId, theme, gainNode: themeGain };
}

function stopAmbient(fadeMs = 300) {
  if (!currentAmbient) return;
  const old = currentAmbient;
  currentAmbient = null;

  if (old.intervalId) clearInterval(old.intervalId);

  if (old.gainNode && ctx) {
    try {
      const now = ctx.currentTime;
      old.gainNode.gain.setValueAtTime(old.gainNode.gain.value, now);
      old.gainNode.gain.exponentialRampToValueAtTime(0.0001, now + (fadeMs / 1000));
    } catch {}
  }

  setTimeout(() => {
    old.nodes.forEach(n => {
      try { n.stop(); n.disconnect(); } catch {}
    });
    if (old.gainNode) {
      try { old.gainNode.disconnect(); } catch {}
    }
  }, fadeMs + 50);
}

// -------------------------------------------------------------
// Public Mixer & SFX Controller API
// -------------------------------------------------------------
export const sfx = {
  play(name) {
    if (muted.master || muted.sfx || volSfx <= 0 || !SOUNDS[name]) return;
    try { SOUNDS[name](); } catch {}
  },

  startAmbient(theme = 'crypt') {
    if (muted.master || muted.ambient || volAmbient <= 0) {
      if (currentAmbient) stopAmbient();
      return;
    }
    startAmbient(theme);
  },

  stopAmbient,

  getTheme() {
    return currentAmbient ? currentAmbient.theme : null;
  },

  // Volume Controls (0.0 to 1.0)
  setMasterVolume(v) {
    volMaster = Math.max(0, Math.min(1, parseFloat(v) || 0));
    localStorage.setItem('dnd_vol_master', String(volMaster));
    if (ctx && masterGain) {
      masterGain.gain.setValueAtTime(muted.master ? 0 : volMaster, ctx.currentTime);
    }
    if (volMaster <= 0 && currentAmbient) stopAmbient();
    else if (volMaster > 0 && !currentAmbient && !muted.ambient && volAmbient > 0) {
      // restore ambient if previously stopped
      startAmbient('crypt');
    }
  },

  setAmbientVolume(v) {
    volAmbient = Math.max(0, Math.min(1, parseFloat(v) || 0));
    localStorage.setItem('dnd_vol_ambient', String(volAmbient));
    if (ctx && ambientGain) {
      ambientGain.gain.setValueAtTime(muted.ambient ? 0 : volAmbient, ctx.currentTime);
    }
    if (volAmbient <= 0 && currentAmbient) stopAmbient();
    else if (volAmbient > 0 && !currentAmbient && !muted.ambient) {
      startAmbient('crypt');
    }
  },

  setSfxVolume(v) {
    volSfx = Math.max(0, Math.min(1, parseFloat(v) || 0));
    localStorage.setItem('dnd_vol_sfx', String(volSfx));
    if (ctx && sfxGain) {
      sfxGain.gain.setValueAtTime(muted.sfx ? 0 : volSfx, ctx.currentTime);
    }
  },

  setVoiceVolume(v) {
    volVoice = Math.max(0, Math.min(1, parseFloat(v) || 0));
    localStorage.setItem('dnd_vol_voice', String(volVoice));
  },

  toggleMute(channel = 'master') {
    if (muted[channel] === undefined) return false;
    muted[channel] = !muted[channel];
    localStorage.setItem(`dnd_mute_${channel}`, String(muted[channel]));

    getAudioContext();
    if (channel === 'master' && masterGain) {
      masterGain.gain.setValueAtTime(muted.master ? 0 : volMaster, ctx.currentTime);
    } else if (channel === 'ambient' && ambientGain) {
      ambientGain.gain.setValueAtTime(muted.ambient ? 0 : volAmbient, ctx.currentTime);
      if (muted.ambient && currentAmbient) stopAmbient();
      else if (!muted.ambient && !currentAmbient && volAmbient > 0) startAmbient('crypt');
    } else if (channel === 'sfx' && sfxGain) {
      sfxGain.gain.setValueAtTime(muted.sfx ? 0 : volSfx, ctx.currentTime);
    }
    return muted[channel];
  },

  getMixerLevels() {
    return {
      master: volMaster,
      ambient: volAmbient,
      sfx: volSfx,
      voice: volVoice,
      muted: { ...muted }
    };
  },

  // Legacy compat helper
  toggle() {
    const isMuted = this.toggleMute('master');
    return !isMuted;
  },
  isEnabled() {
    return !muted.master && volMaster > 0;
  },
  setVolume(v) {
    this.setMasterVolume(v);
  },
  getVolume() {
    return volMaster;
  }
};

