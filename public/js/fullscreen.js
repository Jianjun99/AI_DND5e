import { localizeText, localizeAttribute, t } from './i18n.js';

let fullscreenOwner = null;

// Fullscreen includes body-mounted dialogs. Layout preference remains view-owned.
export function createFullscreenControls(root, navigation, report) {
  const target = document.documentElement;
  const identity = {};
  let alive = true, busy = false, owned = false;
  const current = () => alive && navigation.isCurrent();
  function refresh() {
    if (!current()) return;
    root.querySelectorAll('[data-app-fullscreen]').forEach(button => {
      button.disabled = busy || !document.fullscreenEnabled;
      button.setAttribute('aria-pressed', String(!!document.fullscreenElement));
      localizeText(button, () => t(document.fullscreenElement ? 'ui.fullscreen.exit' : 'ui.fullscreen.enter'));
      localizeAttribute(button, 'title', () => t(document.fullscreenEnabled ? 'ui.fullscreen.help' : 'ui.fullscreen.unavailable'));
    });
  }
  async function toggle(event) {
    if (!(event.target instanceof Element) || !event.target.closest('[data-app-fullscreen]') || busy || !current()) return;
    busy = true; refresh();
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else {
        owned = true;
        fullscreenOwner = identity;
        await target.requestFullscreen();
        // A request may finish after navigation disposed its originating view.
        if (!current() && fullscreenOwner === identity && document.fullscreenElement === target) await document.exitFullscreen();
      }
    } catch (error) {
      if (current()) report(() => t('ui.fullscreen.failed'));
      else console.error('Fullscreen cleanup/request failed', error);
    } finally { busy = false; refresh(); }
  }
  root.addEventListener('click', toggle);
  document.addEventListener('fullscreenchange', refresh);
  document.addEventListener('fullscreenerror', refresh);
  navigation.onDispose(() => {
    alive = false;
    root.removeEventListener('click', toggle);
    document.removeEventListener('fullscreenchange', refresh);
    document.removeEventListener('fullscreenerror', refresh);
    if (owned && fullscreenOwner === identity && document.fullscreenElement === target) document.exitFullscreen().catch(error => console.error('Fullscreen exit failed', error));
  });
  refresh();
  return { refresh };
}
