// tts.js — the AI DM's voice-over.
// Two engines, best available:
//   1. Piper HTTP server (optional, configured URL) — natural neural voice, offline
//   2. Browser SpeechSynthesis — built into every browser (chunked per sentence
//      so playback starts immediately, "chunk-based TTS")
let enabled = localStorage.getItem('dnd_tts') === 'on';
let piperUrl = localStorage.getItem('dnd_piper') || '';
let audioCtx = null;

function setPiper(url) {
  piperUrl = String(url || '').trim();
  localStorage.setItem('dnd_piper', piperUrl);
}
function getPiper() { return piperUrl; }

async function piperSpeak(text) {
  // Piper HTTP servers (e.g. piper-http, rhasspy) accept POST { text } and return wav audio
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
    src.connect(c.destination);
    src.start();
  });
}

function browserSpeak(text) {
  if (!('speechSynthesis' in window)) return Promise.resolve();
  const chunks = String(text).match(/[^.!?]+[.!?]*/g) || [text];
  let i = 0;
  return new Promise(resolve => {
    const speakNext = () => {
      if (i >= chunks.length || !enabled) { resolve(); return; }
      const u = new SpeechSynthesisUtterance(chunks[i++].trim());
      u.rate = 1.05; u.pitch = 0.9; u.volume = 0.9;
      u.onend = speakNext;
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
