// tts.js — the AI DM's voice-over using the browser's built-in speech synthesis.
// Narration is chunked per sentence so playback starts immediately ("chunk-based TTS"),
// long before the whole paragraph would have finished generating.
let enabled = localStorage.getItem('dnd_tts') === 'on';

export const tts = {
  toggle() {
    enabled = !enabled;
    localStorage.setItem('dnd_tts', enabled ? 'on' : 'off');
    if (!enabled) this.stop();
    return enabled;
  },
  isEnabled() { return enabled; },
  speak(text) {
    if (!enabled || !('speechSynthesis' in window)) return;
    const chunks = String(text).match(/[^.!?]+[.!?]*/g) || [text];
    chunks.map(c => c.trim()).filter(Boolean).forEach((chunk, i) => {
      const u = new SpeechSynthesisUtterance(chunk);
      u.rate = 1.05;
      u.pitch = 0.9;
      u.volume = 0.9;
      // small stagger keeps the queue order stable even if the browser drops one
      setTimeout(() => { if (enabled) speechSynthesis.speak(u); }, i * 30);
    });
  },
  stop() { if ('speechSynthesis' in window) speechSynthesis.cancel(); }
};
