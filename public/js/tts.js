// tts.js — the AI DM's voice-over.
// Two engines, best available:
//   1. Piper HTTP server (optional, configured URL) — natural neural voice, offline
//   2. Browser SpeechSynthesis — built into every browser (chunked per sentence
//      so playback starts immediately, "chunk-based TTS")

let enabled = localStorage.getItem('dnd_tts') === 'on';
let piperUrl = localStorage.getItem('dnd_piper') || '';
let audioCtx = null;

let voiceVol = parseFloat(localStorage.getItem('dnd_vol_voice') ?? '0.8');
if (isNaN(voiceVol)) voiceVol = 0.8;

function setPiper(url) {
  piperUrl = String(url || '').trim();
  localStorage.setItem('dnd_piper', piperUrl);
}
function getPiper() { return piperUrl; }

function getEffectiveVolume() {
  const masterMuted = localStorage.getItem('dnd_mute_master') === 'true';
  const voiceMuted = localStorage.getItem('dnd_mute_voice') === 'true';
  const masterVol = parseFloat(localStorage.getItem('dnd_vol_master') ?? '0.7');
  if (masterMuted || voiceMuted || !enabled) return 0;
  return Math.max(0, Math.min(1, voiceVol * (isNaN(masterVol) ? 0.7 : masterVol)));
}

async function piperSpeak(text) {
  const vol = getEffectiveVolume();
  if (vol <= 0) return Promise.resolve();

  const c = audioCtx || (audioCtx = new (window.AudioContext || window.webkitAudioContext)());
  const res = await fetch(piperUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text })
  });
  if (!res.ok) throw new Error('piper HTTP ' + res.status);
  const buf = await res.arrayBuffer();
  const decoded = await c.decodeAudioData(buf);
  return new Promise(resolve => {
    const src = c.createBufferSource();
    src.buffer = decoded;
    src.onended = resolve;

    const gain = c.createGain();
    gain.gain.setValueAtTime(vol, c.currentTime);
    src.connect(gain);
    gain.connect(c.destination);

    src.start();
  });
}

function browserSpeak(text) {
  if (!('speechSynthesis' in window)) return Promise.resolve();
  const vol = getEffectiveVolume();
  if (vol <= 0) return Promise.resolve();

  const chunks = String(text).match(/[^.!?]+[.!?]*/g) || [text];
  let i = 0;

  const rate = parseFloat(localStorage.getItem('dnd_voice_rate') || '1.05');
  const pitch = parseFloat(localStorage.getItem('dnd_voice_pitch') || '0.9');
  const chosenVoice = localStorage.getItem('dnd_voice_name') || '';

  return new Promise(resolve => {
    const speakNext = () => {
      if (i >= chunks.length || !enabled) { resolve(); return; }
      const u = new SpeechSynthesisUtterance(chunks[i++].trim());
      u.rate = rate;
      u.pitch = pitch;
      u.volume = vol;

      if (chosenVoice) {
        const voices = speechSynthesis.getVoices();
        const match = voices.find(v => v.name === chosenVoice);
        if (match) u.voice = match;
      }

      u.onend = speakNext;
      u.onerror = () => { resolve(); };
      speechSynthesis.speak(u);
    };
    speakNext();
  });
}

export const tts = {
  toggle() {
    enabled = !enabled;
    localStorage.setItem('dnd_tts', enabled ? 'on' : 'off');
    if (!enabled) this.stop();
    return enabled;
  },
  isEnabled() { return enabled; },
  setPiper,
  getPiper,
  getEffectiveVolume,

  setVolume(v) {
    voiceVol = Math.max(0, Math.min(1, parseFloat(v) || 0));
    localStorage.setItem('dnd_vol_voice', String(voiceVol));
  },
  getVolume() { return voiceVol; },

  setVoice(name) {
    localStorage.setItem('dnd_voice_name', String(name || ''));
  },
  getVoice() {
    return localStorage.getItem('dnd_voice_name') || '';
  },

  setRate(r) {
    localStorage.setItem('dnd_voice_rate', String(r));
  },
  getRate() {
    return parseFloat(localStorage.getItem('dnd_voice_rate') || '1.05');
  },

  setPitch(p) {
    localStorage.setItem('dnd_voice_pitch', String(p));
  },
  getPitch() {
    return parseFloat(localStorage.getItem('dnd_voice_pitch') || '0.9');
  },

  getAvailableVoices() {
    if (!('speechSynthesis' in window)) return [];
    return speechSynthesis.getVoices().map(v => ({
      name: v.name,
      lang: v.lang,
      default: v.default
    }));
  },

  speak(text) {
    if (!enabled) return Promise.resolve();
    const clean = String(text).replace(/[*_#]/g, '').slice(0, 500);
    if (piperUrl) {
      return piperSpeak(clean).catch(() => browserSpeak(clean));
    }
    return browserSpeak(clean);
  },

  stop() {
    if ('speechSynthesis' in window) speechSynthesis.cancel();
    if (audioCtx) { try { audioCtx.close(); audioCtx = null; } catch {} }
  }
};

