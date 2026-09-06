// app.js — hash router + shared helpers
import { api } from './api.js';
import { homeView } from './views/home.js';
import { creatorView } from './views/creator.js';
import { sheetView } from './views/sheet.js';
import { playView } from './views/play.js';
import { settingsView } from './views/settings.js';

export const state = {
  rules: null,
  toastTimer: null
};

export async function loadRules() {
  if (!state.rules) state.rules = await api.rules();
  window.__rules = state.rules;
  return state.rules;
}

export function charObjective(game) {
  if (game.flags.victory) return '🏆 You escaped with the Relic of the Sunless Crypt. Legendary!';
  if (game.mode === 'over') return '💀 You have fallen. Recover at camp to try again — the crypt resets its guardians.';
  if (game.flags.hasRelic) return '💎 You carry the Relic! Return to the campfire in the Entrance Hall to escape.';
  return '💎 Steal the Relic of the Sunless Crypt from the altar in the deepest sanctum, then escape to the campfire. Legends speak of an ogre that guards it…';
}

export function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => el.classList.add('hidden'), 3500);
}

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const routes = [
  { re: /^#\/$/, view: homeView, nav: 'home' },
  { re: /^#\/create$/, view: creatorView, nav: 'create' },
  { re: /^#\/character\/([\w-]+)$/, view: sheetView, nav: 'home' },
  { re: /^#\/play\/([\w-]+)(\?.*)?$/, view: playView, nav: 'home' },
  { re: /^#\/settings$/, view: settingsView, nav: 'settings' }
];

let currentCleanup = null;

export async function navigate() {
  const hash = location.hash || '#/';
  const main = document.getElementById('view');
  if (currentCleanup) { try { currentCleanup(); } catch {} currentCleanup = null; }
  document.querySelectorAll('.topbar nav a').forEach(a => a.classList.remove('active'));

  for (const r of routes) {
    const m = r.re.exec(hash);
    if (m) {
      document.querySelector(`[data-nav="${r.nav}"]`)?.classList.add('active');
      try {
        currentCleanup = await r.view(main, ...m.slice(1));
      } catch (e) {
        console.error(e);
        main.innerHTML = `<div class="card"><h2>Something went wrong</h2><p class="muted">${esc(e.message)}</p><p><a class="btn" href="#/">Back to characters</a></p></div>`;
      }
      return;
    }
  }
  location.hash = '#/';
}

window.addEventListener('hashchange', navigate);

(async function init() {
  try { await loadRules(); } catch (e) { /* server may be offline; views handle it */ }
  await navigate();
})();
