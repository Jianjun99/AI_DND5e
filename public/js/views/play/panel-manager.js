import { dismissModal } from '../../modal.js';
import { t, localizeText } from '../../i18n.js';

// One drawer and the existing modal factories share a single presentation layer.
// Moving nodes preserves drafts, listeners and focus; no game action is dispatched.
/** @param {HTMLElement} root @param {() => void} onInventory */
export function createPanelManager(root, onInventory) {
  const find = selector => /** @type {HTMLElement} */ (root.querySelector(selector));
  const drawer = find('#delvePanel');
  const hosts = ['sidePanel', 'questTrackerHost', 'logPanel'].map(id => find('#' + id));
  const homes = hosts.map(node => ({ node, parent:node.parentNode, next:node.nextSibling }));
  let active = '', trigger = null, mapFirst = false, locked = false;
  let alive = true, replacingModal = false;
  const buttons = Array.from(root.querySelectorAll('[data-panel]')).map(node => /** @type {HTMLElement} */ (node));
  const pause = find('#pauseMenu');
  function close(restore = true) {
    active = ''; drawer.hidden = true; drawer.removeAttribute('data-active-panel');
    buttons.forEach(button => button.setAttribute('aria-expanded', 'false'));
    if (!mapFirst) { const home = homes[2]; home.parent.insertBefore(home.node, home.next?.parentNode === home.parent ? home.next : null); }
    if (restore && trigger?.isConnected) trigger.focus();
  }
  function open(id, source = /** @type {HTMLElement} */ (document.activeElement)) {
    if (locked) return;
    const modal = document.querySelector('.modal-back');
    if (modal) dismissModal(modal);
    pause.classList.add('hidden');
    if (active === id) { close(); return; }
    close(false); trigger = source;
    if (id === 'inventory') { onInventory(); return; }
    if (!mapFirst && (id === 'character' || id === 'quests')) {
      hosts[0].scrollIntoView({ block:'nearest' }); return;
    }
    if (!mapFirst) drawer.querySelector('.delve-panel-content').appendChild(hosts[2]);
    active = id; drawer.dataset.activePanel = id; drawer.hidden = false;
    localizeText(drawer.querySelector('header span'), () => t('ui.layout.' + ({ character:'character', quests:'quests', log:'log', chat:'chat' }[active] || 'panel')));
    buttons.forEach(button => button.setAttribute('aria-expanded', String(button.dataset.panel === id)));
    const focus = id === 'chat' ? find('#chatInput') : find('#delvePanelClose');
    focus.focus({ preventScroll:true });
  }
  function layout(enabled) {
    close(false); mapFirst = enabled;
    if (enabled) hosts.forEach(node => drawer.querySelector('.delve-panel-content').appendChild(node));
    else homes.forEach(({node,parent,next}) => parent.insertBefore(node, next?.parentNode === parent ? next : null));
  }
  function onOpen(event) {
    if (locked) { event.preventDefault(); return; }
    const previous = active, previousTrigger = trigger, source = /** @type {HTMLElement} */ (document.activeElement);
    event.detail.addEventListener('ui:modal-dismissed', () => {
      if (!alive || replacingModal || !previous) return;
      open(previous, previousTrigger);
      const restored = source?.isConnected ? source : (source?.id ? find('#' + source.id) : null);
      restored?.focus({ preventScroll:true });
    }, { once:true });
    replacingModal = true;
    document.querySelectorAll('.modal-back').forEach(modal => dismissModal(modal));
    replacingModal = false;
    close(false); pause.classList.add('hidden');
  }
  function onClose(event) { if (locked && event.detail.id === 'summaryModal') event.preventDefault(); }
  function onNav(event) {
    if (locked && event.target instanceof Element && event.target.closest('a[href^="#/"]')) { event.preventDefault(); event.stopImmediatePropagation(); }
  }
  function onRoute(event) { if (locked) event.preventDefault(); }
  function togglePause() {
    if (locked || document.querySelector('.modal-back')) return;
    close(false);
    const opening = pause.classList.contains('hidden');
    pause.classList.toggle('hidden', !opening);
    const focus = opening ? pause.querySelector('a,button') : find('#pauseMenuBtn');
    /** @type {HTMLElement} */ (focus)?.focus({ preventScroll:true });
  }
  function escape() {
    if (locked) return;
    const modals = document.querySelectorAll('.modal-back');
    if (modals.length) { dismissModal(modals[modals.length - 1]); return; }
    if (!pause.classList.contains('hidden')) { togglePause(); return; }
    if (active) { close(); return; }
    togglePause();
  }
  const onViewport = () => {
    const viewport = window.visualViewport;
    if (viewport) {
      drawer.style.setProperty('--drawer-height', `${viewport.height * .78}px`);
      drawer.style.setProperty('--drawer-bottom', `${Math.max(56, innerHeight - viewport.height - viewport.offsetTop + 12)}px`);
    }
  };
  buttons.forEach(button => button.addEventListener('click', () => open(button.dataset.panel, button)));
  root.querySelector('#delvePanelClose').addEventListener('click', () => close());
  document.addEventListener('ui:modal-open', onOpen);
  document.addEventListener('ui:modal-close', onClose);
  document.addEventListener('click', onNav, true);
  document.addEventListener('ui:route-leave', onRoute);
  window.visualViewport?.addEventListener('resize', onViewport); onViewport();
  window.visualViewport?.addEventListener('scroll', onViewport);
  return { open, close, layout, escape, togglePause,
    setLocked(value) { locked = value; },
    blocked: () => locked || !!document.querySelector('.modal-back') || !pause.classList.contains('hidden'),
    current: () => active,
    locked: () => locked,
    destroy() {
      alive = false;
      document.removeEventListener('ui:modal-open', onOpen);
      document.removeEventListener('ui:modal-close', onClose);
      document.removeEventListener('click', onNav, true);
      document.removeEventListener('ui:route-leave', onRoute);
      window.visualViewport?.removeEventListener('resize', onViewport);
      window.visualViewport?.removeEventListener('scroll', onViewport);
    }
  };
}
