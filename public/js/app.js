// app.js — hash router + shared helpers
import { api } from './api.js';
import { homeView } from './views/home.js';
import { creatorView } from './views/creator.js';
import { sheetView } from './views/sheet.js';
import { playView } from './views/play.js';
import { settingsView, openSettingsModal } from './views/settings.js';
import { overworldView } from './views/overworld.js';
import { campaignView } from './views/campaign.js';
import { getLocale, setLocale, t, localizeText, translateDOM, onLocaleChange } from './i18n.js';
import { createNavigation } from './navigation.js';
import { visualsView } from './views/visuals.js';
import { authorView } from './views/author.js';

export const state = {
  rules: null,
  toastTimer: null
};
let rulesLoading = null;

export async function loadRules() {
  if (!state.rules) {
    if (!rulesLoading) rulesLoading = api.rules().finally(() => { rulesLoading = null; });
    state.rules = await rulesLoading;
  }
  window.__rules = state.rules;
  return state.rules;
}

export function charObjective(game) {
  if (game.flags.victory) return '🏆 Victory! The delve is complete — legendary.';
  if (game.mode === 'over') return '💀 You have fallen. Recover at camp to try again — the dungeon resets its guardians.';
  if (game.map.victory && game.map.victory.type === 'slay_boss') {
    const bossAlive = game.entities.some(e => e.boss && e.alive && !e.fled);
    if (!bossAlive) return '🏆 The guardian is slain! Return to the campfire to claim the vault.';
    return '⚔ ' + (game.map.objectiveText || 'Slay the dungeon\'s guardian, then return to camp.');
  }
  if (game.flags.hasRelic) return '💎 You carry the Relic! Return to the campfire to escape.';
  return '💎 ' + (game.map.objectiveText || 'Steal the Relic of the Sunless Crypt from the altar in the deepest sanctum, then escape to the campfire. Legends speak of an ogre that guards it…');
}

// The main-story step this map belongs to, when it is the current one (set by the server on
// the delve payload as game.campaign).
export function campaignObjective(game) {
  const c = game && game.campaign;
  if (!c || !c.objective || c.objective.done) return null;
  if (!c.isCurrentStep) return null;
  return c.objective;
}

export function toast(msg) {
  const el = document.getElementById('toast');
  localizeText(el, () => typeof msg === 'function' ? msg() : msg);
  el.classList.remove('hidden');
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => el.classList.add('hidden'), 3500);
}

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const routes = [
  { re: /^#\/visuals$/, view: (main, params, navigation) => visualsView(main, navigation), nav: 'home' },
  { re: /^#\/author(?:\?.*)?$/, view: (main, params, navigation) => authorView(main, navigation), nav: 'home' },
  { re: /^#\/$/, view: (main, params, navigation) => homeView(main, navigation), nav: 'home' },
  { re: /^#\/create$/, view: (main, params, navigation) => creatorView(main, navigation), nav: 'create' },
  { re: /^#\/overworld(?:\?.*)?$/, view: (main, params, navigation) => overworldView(main, navigation), nav: 'overworld' },
  { re: /^#\/character\/([\w-]+)$/, view: (main, params, navigation) => sheetView(main, params[0], navigation), nav: 'home' },
  { re: /^#\/play\/([\w-]+)(\?.*)?$/, view: (main, params, navigation) => playView(main, params[0], navigation), nav: 'home' },
  { re: /^#\/campaign(?:\/([\w-]+))?$/, view: (main, params, navigation) => campaignView(main, params[0], navigation), nav: 'home' },
  { re: /^#\/settings$/, view: (main, params, navigation) => settingsView(main, navigation), nav: 'settings' }
];

let currentCleanup = null;
let currentRoute = null;
/** @type {import('./navigation.js').Navigation | null} */
let currentNavigation = null;

export async function navigate() {
  const hash = location.hash || '#/';
  // A pending settlement also guards browser Back / programmatic hash changes.
  if (!document.dispatchEvent(new CustomEvent('ui:route-leave', { detail:hash, cancelable:true }))) {
    if (currentRoute) history.replaceState(null, '', currentRoute);
    return;
  }
  // Invalidate even a view that has not returned its cleanup yet. A rejected
  // settlement navigation above leaves the current lifetime intact.
  currentNavigation?.dispose();
  if (currentCleanup) { try { currentCleanup(); } catch (error) { console.error(error); } currentCleanup = null; }
  const navigation = currentNavigation = createNavigation(hash);
  currentRoute = hash;
  const main = document.getElementById('view');

  // Dismiss any lingering body modals on route transitions
  document.querySelectorAll('.modal-back').forEach(m => { m.dispatchEvent(new Event('game:dispose')); m.remove(); });

  document.querySelectorAll('.topbar nav a').forEach(a => a.classList.remove('active'));

  refreshContinue(navigation);

  for (const r of routes) {
    const m = r.re.exec(hash);
    if (m) {
      document.querySelector(`[data-nav="${r.nav}"]`)?.classList.add('active');
      try {
        await loadRules();
        if (!navigation.isCurrent()) return;
        const cleanup = await r.view(main, m.slice(1), navigation);
        if (currentNavigation !== navigation || !navigation.isCurrent()) {
          if (cleanup) cleanup();
          return;
        }
        currentCleanup = cleanup;
      } catch (e) {
        if (currentNavigation !== navigation || !navigation.isCurrent()) return;
        navigation.dispose(); // release any resources registered before initialization failed
        console.error(e);
        main.innerHTML = `<div class="card"><h2 data-i18n="error.title">${esc(t('error.title'))}</h2><p class="muted" data-route-error></p><p><a class="btn" href="#/" data-i18n="error.back">${esc(t('error.back'))}</a></p></div>`;
        localizeText(main.querySelector('[data-route-error]'), () => e.message);
      }
      return;
    }
  }
  location.hash = '#/';
}

// Topbar "Continue" — always points at the most recent delve so leaving the
// game screen (settings, home) is never a dead end.
async function refreshContinue(navigation) {
  const btn = /** @type {HTMLAnchorElement} */ (document.getElementById('continueBtn'));
  if (!btn) return;
  try {
    const saves = await api.listSaves();
    if (!navigation.isCurrent()) return;
    if (!saves.length) { btn.classList.add('hidden'); return; }
    const latest = saves.sort((a, b) => b.updatedAt - a.updatedAt)[0];
    btn.href = '#/play/' + latest.id;
    btn.dataset.characterName = latest.characterName;
    btn.dataset.mapName = latest.mapName;
    btn.dataset.mapDisplay = JSON.stringify(latest.mapNameDisplay || {fallback:latest.mapName});
    renderContinueLabel();
    btn.classList.remove('hidden');
  } catch { if (navigation.isCurrent()) btn.classList.add('hidden'); }
}

function renderContinueLabel() {
  const btn = document.getElementById('continueBtn');
  if (!btn) return;
  btn.textContent = btn.dataset.characterName
    ? t('nav.continueSave', { character: btn.dataset.characterName, map: JSON.parse(btn.dataset.mapDisplay || '{}') })
    : t('nav.continue');
}

function applyLocale() {
  document.documentElement.lang = getLocale();
  translateDOM();
  renderContinueLabel();
}

onLocaleChange(applyLocale);

window.addEventListener('hashchange', navigate);

(async function init() {
  applyLocale();
  document.getElementById('topLocaleSelect')?.addEventListener('change', event => {
    setLocale(/** @type {HTMLSelectElement} */ (event.target).value);
  });
  const topSetBtn = document.getElementById('topSettingsBtn');
  if (topSetBtn) {
    topSetBtn.addEventListener('click', (e) => {
      e.preventDefault();
      openSettingsModal();
    });
  }
  try { await loadRules(); } catch (e) { /* server may be offline; views handle it */ }
  if (!currentNavigation) await navigate();
})();
