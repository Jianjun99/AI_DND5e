// Shared presentation lifecycle. The active delve can coordinate existing factories
// without owning their game state or replacing their content.
const triggers = new WeakMap();
/** @param {HTMLElement} modal */
export function presentModal(modal) {
  const trigger = /** @type {HTMLElement} */ (document.activeElement);
  const event = new CustomEvent('ui:modal-open', { detail: modal, cancelable: true });
  if (!document.dispatchEvent(event)) return false;
  triggers.set(modal, trigger);
  modal.tabIndex = -1;
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  document.body.appendChild(modal);
  modal.focus({ preventScroll:true });
  const controls = () => Array.from(modal.querySelectorAll('button:not(:disabled), a[href]:not([aria-disabled="true"]), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]'))
    .filter(node => node.getClientRects().length);
  modal.addEventListener('keydown', event => {
    if (event.key !== 'Tab') return;
    const items = controls(), first = items[0], last = items[items.length - 1];
    if (!first) { event.preventDefault(); return; }
    if (event.shiftKey && (document.activeElement === first || document.activeElement === modal)) {
      event.preventDefault(); /** @type {HTMLElement} */ (last).focus();
    } else if (!event.shiftKey && (document.activeElement === last || document.activeElement === modal)) {
      event.preventDefault(); /** @type {HTMLElement} */ (first).focus();
    }
  });
  queueMicrotask(() => {
    if (modal.isConnected && document.activeElement === modal) /** @type {HTMLElement} */ (controls()[0])?.focus({ preventScroll:true });
  });
  return true;
}
export function dismissModal(modal) {
  if (!modal || !document.dispatchEvent(new CustomEvent('ui:modal-close', { detail: modal, cancelable: true }))) return false;
  modal.dispatchEvent(new Event('game:dispose'));
  modal.remove();
  const trigger = triggers.get(modal);
  if (trigger?.isConnected && trigger.getClientRects().length) trigger.focus();
  else /** @type {HTMLElement} */ (document.querySelector(modal.id === 'delveInventoryModal' ? '.delve-tools [data-panel="inventory"]' : '#pauseMenuBtn'))?.focus();
  modal.dispatchEvent(new CustomEvent('ui:modal-dismissed', { detail:trigger }));
  return true;
}
