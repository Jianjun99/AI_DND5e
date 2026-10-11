import { esc } from './app.js';
import { label, t, contentLabel, contentText, displayLabel, getLocale, localizeText, translateDOM } from './i18n.js';

// One public catalog UI for town and preparation. Filtering never dispatches actions.
export function createAdventureDirectory(root, { entries, selectedId, onSelect, onRefresh, allowEmptySelection = false, filterState = { query: '', source: '', scroll: 0 } }) {
  let current = entries, selection = selectedId, disabled = false;
  const lifetime = new AbortController();
  const options = { signal: lifetime.signal };
  root.innerHTML = `<div class="adventure-directory">
    <div class="adventure-directory-heading"><h3>${label('adventure.title')}</h3><button class="btn small" type="button" data-adventure-refresh>${label('adventure.refresh')}</button></div>
    <div class="adventure-filters"><label>${label('adventure.search')}<input type="search" data-adventure-search autocomplete="off"></label><label>${label('adventure.source')}<select data-adventure-source></select></label></div>
    <p class="small muted" data-adventure-selected></p>
    <div class="adventure-list" role="group" data-i18n-aria-label="adventure.title" aria-label="${esc(t('adventure.title'))}"></div>
    <p class="small muted" data-adventure-empty hidden>${label('adventure.empty')}</p>
  </div>`;
  const search = /** @type {HTMLInputElement} */ (root.querySelector('[data-adventure-search]'));
  const source = /** @type {HTMLSelectElement} */ (root.querySelector('[data-adventure-source]'));
  const list = root.querySelector('.adventure-list');
  const refresh = /** @type {HTMLButtonElement} */ (root.querySelector('[data-adventure-refresh]'));
  const selected = root.querySelector('[data-adventure-selected]');
  search.value = filterState.query;
  function filter() {
    const query = search.value.trim().toLocaleLowerCase();
    let count = 0;
    list.querySelectorAll('[data-adventure-id]').forEach(el => {
      const row = current.find(e => e.id === el.getAttribute('data-adventure-id'));
      const text = [row.id, row.mapId, row.name, row.pack, row.packId, contentText(row), contentText(row, 'pack'), contentText(row, 'blurb')].join(' ').toLocaleLowerCase();
      el.hidden = !!((source.value && row.packId !== source.value) || (query && !text.includes(query)));
      if (!el.hidden) count++;
      el.querySelector('[data-adventure-original]').hidden = row.availableLocales.includes(getLocale());
    });
    root.querySelector('[data-adventure-empty]').hidden = count > 0;
    filterState.query = search.value;
    filterState.source = source.value;
  }
  function setDisabled(value) {
    disabled = value;
    root.querySelectorAll('input, select, button').forEach(el => { el.disabled = value; });
  }
  function setEntries(next, preferred = selection) {
    current = next;
    selection = current.some(e => e.id === preferred) ? preferred : (allowEmptySelection ? undefined : current[0]?.id);
    const oldSource = source.value || filterState.source;
    const packs = [...new Map(current.map(e => [e.packId, e])).values()];
    source.innerHTML = `<option value="" data-i18n="adventure.allSources">${esc(t('adventure.allSources'))}</option>` + packs.map(e => `<option value="${esc(e.packId)}" data-i18n-display="${esc(JSON.stringify(e.packDisplay))}" data-i18n-fallback="${esc(e.pack)}">${esc(contentText(e, 'pack'))}</option>`).join('');
    source.value = packs.some(e => e.packId === oldSource) ? oldSource : '';
    list.innerHTML = current.map(e => `<label class="adventure-option" data-adventure-id="${esc(e.id)}">
      <input type="radio" name="mapPick" value="${esc(e.mapId)}" ${e.id === selection ? 'checked' : ''}>
      <span class="adventure-details"><span><b>${contentLabel(e)}</b> <span class="chip">${contentLabel(e, 'pack')}</span> <span class="chip blue">${e.recommended ? displayLabel(e.recommendedDisplay, e.recommended) : label('adventure.unspecified')}</span>${e.requiresCompanion ? ` <span class="chip" data-requires-companion style="background:#7a2f2f;color:#fff;">${label('adventure.requiresCompanion', { name: contentText(e, 'requiresCompanionName') })}</span>` : ''}</span>
      <span class="small muted">${contentLabel(e, 'blurb')}</span>
      <span class="small muted" data-adventure-original>${label('adventure.original')}</span></span>
    </label>`).join('');
    localizeText(selected, () => selection ? t('adventure.selected', { name: contentText(current.find(e => e.id === selection)) }) : t(allowEmptySelection ? 'adventure.choose' : 'adventure.none'));
    setDisabled(disabled);
    filter();
    list.scrollTop = filterState.scroll;
    return current.find(e => e.id === selection);
  }
  search.addEventListener('input', filter, options);
  source.addEventListener('change', filter, options);
  list.addEventListener('scroll', () => { filterState.scroll = list.scrollTop; }, options);
  list.addEventListener('change', event => {
    const el = /** @type {HTMLInputElement} */ (event.target);
    if (disabled || el.name !== 'mapPick') return;
    selection = el.closest('[data-adventure-id]').getAttribute('data-adventure-id');
    localizeText(selected, () => t('adventure.selected', { name: contentText(current.find(e => e.id === selection)) }));
    onSelect(current.find(e => e.id === selection));
  }, options);
  refresh.addEventListener('click', () => { if (!disabled) onRefresh(); }, options);
  setEntries(current);
  return { setEntries, setDisabled, getSelection: () => current.find(e => e.mapId === list.querySelector('input:checked')?.value), refreshLocale: () => { translateDOM(root); filter(); }, dispose: () => lifetime.abort() };
}
