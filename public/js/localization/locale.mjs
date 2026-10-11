// Pure contract shared by native browser modules and Node's dynamic import.
import en from './en.mjs';
import zhCN from './zh-CN.mjs';

export const DEFAULT_LOCALE = 'en';
export const SUPPORTED_LOCALES = Object.freeze(['zh-CN', 'en']);
export const catalogs = Object.freeze({ en: Object.freeze(en), 'zh-CN': Object.freeze(zhCN) });

/** @param {unknown} value @returns {'zh-CN' | 'en' | null} */
export function supportedLocale(value) {
  if (typeof value !== 'string') return null;
  const tag = value.trim().replaceAll('_', '-');
  if (/^zh(?:-[a-z0-9]+)*$/i.test(tag)) return 'zh-CN';
  if (/^en(?:-[a-z0-9]+)*$/i.test(tag)) return 'en';
  return null;
}

/** @param {unknown} value @returns {'zh-CN' | 'en'} */
export function normalizeLocale(value) { return supportedLocale(value) || DEFAULT_LOCALE; }

/**
 * An explicit UI preference wins; invalid explicit values fall back to English.
 * Otherwise negotiate Accept-Language (or navigator.languages joined by commas).
 * @param {unknown} explicit
 * @param {unknown} accepted
 * @returns {'zh-CN' | 'en'}
 */
export function requestLocale(explicit, accepted = '') {
  if (explicit !== undefined && explicit !== null) return normalizeLocale(explicit);
  if (typeof accepted !== 'string') return DEFAULT_LOCALE;
  const choices = accepted.slice(0, 2048).split(',').map((part, index) => {
    const [tag, ...options] = part.trim().split(';');
    const quality = options.find(option => option.trim().startsWith('q='));
    const q = quality === undefined ? 1 : Number(quality.trim().slice(2));
    return { locale: supportedLocale(tag), q: Number.isFinite(q) && q > 0 && q <= 1 ? q : 0, index };
  }).filter(choice => choice.locale && choice.q > 0);
  choices.sort((a, b) => b.q - a.q || a.index - b.index);
  return choices[0]?.locale || DEFAULT_LOCALE;
}

/** Plain text: escape at an HTML insertion boundary, never store HTML in a catalog.
 * @param {unknown} locale
 * @param {string} key
 * @param {Record<string, any>} [params]
 */
export function message(locale, key, params = {}) {
  const selected = catalogs[normalizeLocale(locale)];
  const template = Object.hasOwn(selected, key) ? selected[key] : Object.hasOwn(en, key) ? en[key] : key;
  return template.replace(/\{([a-zA-Z][a-zA-Z0-9_]*)\}/g, (token, name) =>
    Object.hasOwn(params, name) ? resolveDisplay(params[name], '', locale) : token);
}

/** The same descriptor contract is used for authorized content and event params.
 * @param {any} value @param {string} [fallback] @param {unknown} [locale]
 * @returns {string}
 */
export function resolveDisplay(value, fallback = '', locale = DEFAULT_LOCALE) {
  if (value === null || value === undefined) return fallback;
  if (typeof value !== 'object') return String(value);
  if (value.key || value.messageKey) {
    const key = value.key || value.messageKey, text = message(locale,key,value.params || {});
    return text === key ? value.fallback ?? value.text ?? fallback : text;
  }
  if (Array.isArray(value.parts)) return value.parts.map(part => resolveDisplay(part,'',locale)).join(value.separator ?? '');
  const selected = normalizeLocale(locale);
  return typeof value.localized?.[selected] === 'string' ? value.localized[selected] : value.fallback ?? value.text ?? fallback;
}
