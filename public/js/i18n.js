import { message, resolveDisplay, normalizeLocale, requestLocale, supportedLocale } from './localization/locale.mjs';

const STORAGE_KEY = 'aiDnd.locale.v1';
const CHANGE_EVENT = 'game:localechange';
let locale = initialLocale();
const reported = new Set();
const liveText = new WeakMap();
const liveAttributes = new WeakMap();

// Template helpers use the same t/catalog contract. Only the leaf is refreshed;
// surrounding controls, event handlers, focus and busy flags remain untouched.
const escapeText = value => String(value ?? '').replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** @param {string} key @param {Record<string, any>} [params] */
export function label(key, params = {}) {
  return '<span data-i18n="' + escapeText(key) + '" data-i18n-params="' +
    escapeText(JSON.stringify(params)) + '">' + escapeText(t(key, params)) + '</span>';
}

/** Bind a changing status using its current state, without replacing the control. */
export function localizeText(element, read) {
  if (!element) return;
  element.removeAttribute('data-i18n');
  element.setAttribute('data-i18n-live', '');
  const entry = { read, text: read() };
  liveText.set(element, entry);
  element.textContent = entry.text;
}

export function localizeAttribute(element, attribute, read) {
  if (!element) return;
  element.removeAttribute('data-i18n-' + attribute);
  element.setAttribute('data-i18n-live-attributes', '');
  const readers = liveAttributes.get(element) || {};
  readers[attribute] = read;
  liveAttributes.set(element, readers);
  element.setAttribute(attribute, read());
}

/** Server-supplied display descriptor. Legacy text stays readable on old payloads. */
export function displayText(display, fallback = '') {
  return display ? resolveDisplay(display,fallback,locale) : fallback;
}
export function displayLabel(display, fallback = '') {
  if (!display) return escapeText(fallback);
  return '<span data-i18n-display="'+escapeText(JSON.stringify(display))+'" data-i18n-fallback="'+escapeText(fallback)+'">'+escapeText(displayText(display,fallback))+'</span>';
}
export function contentText(node, field = 'name') { return field === 'text' ? messageText(node) : displayText(node?.[field+'Display'],node?.[field] ?? ''); }
export function contentLabel(node, field = 'name') { return field === 'text' ? messageLabel(node) : displayLabel(node?.[field+'Display'],node?.[field] ?? ''); }
export function messageText(entry) { return displayText(entry?.textDisplay || (entry?.messageKey ? entry : null),entry?.text || ''); }
export function messageLabel(entry) { return displayLabel(entry?.textDisplay || (entry?.messageKey ? entry : null),entry?.text || ''); }
const references = new Map();
export function rememberDefinitions(kind, nodes) {
  for (const node of (Array.isArray(nodes) ? nodes : Object.entries(nodes || {}).map(([id,node]) => ({id,...node})))) {
    const display = node.nameDisplay || { fallback:node.name || node.id };
    references.set(kind+':'+node.id,display);
    // Some legacy character fields contain the canonical definition name.
    if (node.name) references.set(kind+':'+node.name,display);
  }
}
export function reference(kind,id,fallback = id) { return references.get(kind+':'+id) || { fallback }; }
export function refText(kind,id,fallback = id) { return displayText(reference(kind,id,fallback),fallback); }
export function refLabel(kind,id,fallback = id) { return displayLabel(reference(kind,id,fallback),fallback); }

function initialLocale() {
  try {
    const saved = supportedLocale(localStorage.getItem(STORAGE_KEY));
    if (saved) return saved;
  } catch { /* A blocked browser store must not prevent playing. */ }
  return requestLocale(undefined, (navigator.languages || [navigator.language]).join(','));
}

export function getLocale() { return locale; }

/** Changing presentation never navigates, recreates a renderer or writes a save. */
export function setLocale(value) {
  const next = normalizeLocale(value);
  try { localStorage.setItem(STORAGE_KEY, next); } catch { /* Session-only preference. */ }
  if (next === locale) return;
  locale = next;
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: { locale } }));
}

/** @param {string} key @param {Record<string, any>} [params] */
export function t(key, params = {}) {
  const result = message(locale, key, params);
  if (result === key && !reported.has(key)) {
    reported.add(key);
    console.warn('Missing localization key:', key);
  }
  return result;
}

/** The owner of a view must call the returned cleanup when leaving that view. */
export function onLocaleChange(listener) {
  window.addEventListener(CHANGE_EVENT, listener);
  return () => window.removeEventListener(CHANGE_EVENT, listener);
}

/** Only mark text-only leaves: textContent preserves safety but replaces children.
 * No automatic string matching, innerHTML translation or mutation observer.
 * @param {Document | Element} [root]
 */
export function translateDOM(root = document) {
  for (const [attribute, target] of [
    ['data-i18n', null], ['data-i18n-title', 'title'],
    ['data-i18n-placeholder', 'placeholder'], ['data-i18n-aria-label', 'aria-label'],
    ['data-i18n-alt', 'alt']
  ]) {
    const elements = Array.from(root.querySelectorAll('[' + attribute + ']'));
    if (root instanceof Element && root.hasAttribute(attribute)) elements.unshift(root);
    for (const element of elements) {
      /** @type {Record<string, string | number>} */
      let params = {};
      try { params = JSON.parse(element.getAttribute('data-i18n-params') || '{}'); } catch { /* Legacy leaf. */ }
      const text = t(element.getAttribute(attribute), params);
      if (target) element.setAttribute(target, text);
      else element.textContent = text;
    }
  }
  const liveElements = Array.from(root.querySelectorAll('[data-i18n-live], [data-i18n-live-attributes]'));
  const displays = Array.from(root.querySelectorAll('[data-i18n-display]'));
  if (root instanceof Element && root.hasAttribute('data-i18n-display')) displays.unshift(root);
  for (const element of displays) {
    try { element.textContent = displayText(JSON.parse(element.getAttribute('data-i18n-display')),element.getAttribute('data-i18n-fallback') || ''); }
    catch { /* A legacy/malformed descriptor must not stop other UI leaves. */ }
  }
  if (root instanceof Element && (root.hasAttribute('data-i18n-live') || root.hasAttribute('data-i18n-live-attributes'))) liveElements.unshift(root);
  for (const element of liveElements) {
    const entry = liveText.get(element);
    // Ordinary game updates can replace a transient status with player/server text.
    // Do not revive the old status when that happens.
    if (entry && element.textContent === entry.text) {
      entry.text = entry.read();
      element.textContent = entry.text;
    } else if (entry) {
      liveText.delete(element);
      element.removeAttribute('data-i18n-live');
    }
    for (const [attribute, readAttribute] of Object.entries(liveAttributes.get(element) || {})) {
      element.setAttribute(attribute, readAttribute());
    }
  }
  root.querySelectorAll('[data-locale-select]').forEach(element => {
    if (element instanceof HTMLSelectElement) element.value = locale;
  });
}
