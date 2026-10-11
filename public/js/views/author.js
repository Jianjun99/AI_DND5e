// public/js/views/author.js
// Adventure Authoring Studio (T15a)
// Visual story, NPC and choice editor with starter template cloning, draft tolerance, validation, export, install, and isolated playtest.

import { t, label, localizeText, translateDOM, onLocaleChange, getLocale } from '../i18n.js';
import { esc, toast } from '../app.js';
import { api } from '../api.js';
import { presentModal, dismissModal } from '../modal.js';
import { ENTITY_DEFAULTS } from '../authoring-defaults.mjs';

/**
 * @param {HTMLElement} main
 * @param {import('../navigation.js').Navigation} navigation
 */
export async function authorView(main, navigation) {
  const hash = location.hash || '';
  const urlParams = new URLSearchParams(hash.includes('?') ? hash.split('?')[1] : '');
  const activeDraftId = urlParams.get('draft');

  if (!activeDraftId) {
    return renderDraftsIndex(main, navigation);
  }
  return renderDraftEditor(main, activeDraftId, navigation);
}

// -------------------------------------------------------------
// View A: Drafts Index & Cloning
// -------------------------------------------------------------
async function renderDraftsIndex(main, navigation) {
  main.innerHTML = `
    <div class="card" style="margin-bottom:18px;">
      <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:12px;">
        <div>
          <h2 style="margin:0 0 4px;">🛠️ ${label('ui.author.title')}</h2>
          <p class="small muted" style="margin:0;">${label('ui.author.subtitle')}</p>
        </div>
        <a class="btn" href="#/">← ${label('ui.home.continue_adventure')}</a>
      </div>
    </div>

    <!-- Clone Starter Template Card -->
    <div class="card" style="margin-bottom:24px; border:1px solid #7c3aed44; background:linear-gradient(180deg, rgba(124,58,237,0.06), rgba(0,0,0,0));">
      <h3 style="margin-top:0; color:#c084fc;">🚀 ${label('ui.author.clone_title')}</h3>
      <p class="small muted" style="margin-bottom:14px;">${label('ui.author.clone_desc')}</p>
      <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(200px, 1fr)); gap:12px; margin-bottom:14px;">
        <div>
          <label class="small" style="display:block; margin-bottom:4px;">${label('ui.author.slug_label')}</label>
          <input type="text" id="cloneSlug" class="input" placeholder="${t('ui.author.slug_placeholder')}" style="width:100%;">
        </div>
        <div>
          <label class="small" style="display:block; margin-bottom:4px;">${label('ui.author.name_label')}</label>
          <input type="text" id="cloneName" class="input" placeholder="${t('ui.author.clone_name_placeholder')}" style="width:100%;">
        </div>
        <div>
          <label class="small" style="display:block; margin-bottom:4px;">${label('ui.author.author_label')}</label>
          <input type="text" id="cloneAuthor" class="input" placeholder="${t('ui.author.clone_author_placeholder')}" style="width:100%;">
        </div>
      </div>
      <div>
        <button class="btn primary" id="cloneBtn">${label('ui.author.clone_btn')}</button>
      </div>
    </div>

    <!-- Drafts List -->
    <div class="card">
      <h3 style="margin-top:0;">📂 ${label('ui.author.drafts_list')}</h3>
      <div id="draftsListContainer">
        <p class="small muted">${label('ui.author.loading_draft')}</p>
      </div>
    </div>
  `;

  const cloneBtn = /** @type {HTMLButtonElement} */ (document.getElementById('cloneBtn'));
  const cloneSlug = /** @type {HTMLInputElement} */ (document.getElementById('cloneSlug'));
  const cloneName = /** @type {HTMLInputElement} */ (document.getElementById('cloneName'));
  const cloneAuthor = /** @type {HTMLInputElement} */ (document.getElementById('cloneAuthor'));

  cloneBtn.addEventListener('click', async () => {
    cloneBtn.disabled = true;
    localizeText(cloneBtn, () => t('ui.author.cloning'));
    try {
      const res = await api.cloneDraft({
        slug: cloneSlug.value.trim() || undefined,
        name: cloneName.value.trim() || undefined,
        author: cloneAuthor.value.trim() || undefined
      });
      if (!navigation.isCurrent()) return;
      toast(() => t('ui.author.clone_done'));
      location.hash = `#/author?draft=${encodeURIComponent(res.draftId)}`;
    } catch (err) {
      if (!navigation.isCurrent()) return;
      toast(() => err.message || t('ui.author.clone_failed'));
      cloneBtn.disabled = false;
      localizeText(cloneBtn, () => t('ui.author.clone_btn'));
    }
  });

  await loadDraftsList(main, navigation);
  return navigation.onDispose(onLocaleChange(() => translateDOM(main)));
}

async function loadDraftsList(main, navigation) {
  const container = document.getElementById('draftsListContainer');
  if (!container) return;
  try {
    const { drafts } = await api.listDrafts();
    if (!navigation.isCurrent()) return;
    if (!drafts || !drafts.length) {
      container.innerHTML = `<p class="muted" style="text-align:center; padding:24px 0;">${label('ui.author.no_drafts')}</p>`;
      return;
    }
    container.innerHTML = `
      <div style="display:flex; flex-direction:column; gap:12px;">
        ${drafts.map(d => `
          <div class="card" style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:12px; background:rgba(255,255,255,0.02); border:1px solid var(--border);">
            <div style="min-width:240px;">
              <div style="display:flex; align-items:center; gap:8px;">
                <b style="font-size:15px;">${esc(d.name)}</b>
                <span class="chip small">${esc(d.id)}</span>
                ${d.isValid
                  ? `<span class="chip small" style="background:#22c55e22; color:#22c55e; border-color:#22c55e;">✅ ${label('ui.author.valid')}</span>`
                  : `<span class="chip small red">⚠️ ${label('ui.author.issues', { count: d.errorCount })}</span>`}
              </div>
              <p class="small muted" style="margin:4px 0 0;">${esc(d.blurb || '')}</p>
              <div class="small muted" style="margin-top:2px;">${label('ui.author.meta_author')}: ${esc(d.author || t('ui.author.unknown_author'))} · ${label('ui.author.meta_updated')}: ${new Date(d.updatedAt).toLocaleString()}</div>
            </div>
            <div style="display:flex; gap:8px; flex-wrap:wrap;">
              <a class="btn primary small" href="#/author?draft=${encodeURIComponent(d.id)}">✏️ ${label('ui.author.edit')}</a>
              <button class="btn small" data-draft-install="${esc(d.id)}" ${!d.isValid ? `disabled data-i18n-title="ui.author.fix_errors_first" title="${esc(t('ui.author.fix_errors_first'))}"` : ''}>📦 ${label('ui.author.install')}</button>
              <a class="btn small ${!d.isValid ? 'disabled' : ''}" href="/api/content/drafts/${encodeURIComponent(d.id)}/export" download="${esc(d.id)}.json" ${!d.isValid ? `data-i18n-title="ui.author.fix_errors_first" title="${esc(t('ui.author.fix_errors_first'))}" style="pointer-events:none; opacity:0.5;"` : ''}>📥 ${label('ui.author.export')}</a>
              <button class="btn small" data-draft-playtest="${esc(d.id)}" ${!d.isValid ? `disabled data-i18n-title="ui.author.fix_errors_first" title="${esc(t('ui.author.fix_errors_first'))}"` : ''}>🎮 ${label('ui.author.playtest')}</button>
              <button class="btn small red" data-draft-delete="${esc(d.id)}" data-i18n-title="ui.author.delete" title="${esc(t('ui.author.delete'))}">🗑️</button>
            </div>
          </div>
        `).join('')}
      </div>
    `;

    container.querySelectorAll('[data-draft-install]').forEach(el => {
      const btn = /** @type {HTMLButtonElement} */ (el);
      btn.addEventListener('click', async () => {
        const id = btn.getAttribute('data-draft-install');
        btn.disabled = true;
        try {
          await api.installDraft(id);
          toast(() => t('ui.author.installed'));
        } catch (e) {
          toast(() => e.message);
        } finally {
          btn.disabled = false;
        }
      });
    });

    container.querySelectorAll('[data-draft-playtest]').forEach(el => {
      const btn = /** @type {HTMLButtonElement} */ (el);
      btn.addEventListener('click', async () => {
        const id = btn.getAttribute('data-draft-playtest');
        btn.disabled = true;
        try {
          const res = await api.playtestDraft(id);
          location.hash = `#/play/${res.saveId}`;
        } catch (e) {
          toast(() => e.message);
          btn.disabled = false;
        }
      });
    });

    container.querySelectorAll('[data-draft-delete]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.getAttribute('data-draft-delete');
        if (!confirm(t('ui.author.delete_confirm'))) return;
        try {
          await api.deleteDraft(id);
          toast(() => t('ui.author.draft_deleted'));
          await loadDraftsList(main, navigation);
        } catch (e) {
          toast(() => e.message);
        }
      });
    });
  } catch (err) {
    if (!navigation.isCurrent()) return;
    container.innerHTML = `<p class="muted red">${esc(err.message)}</p>`;
  }
}

// -------------------------------------------------------------
// View B: Draft Editor Studio
// -------------------------------------------------------------
async function renderDraftEditor(main, draftId, navigation) {
  main.innerHTML = `<div class="card" style="text-align:center; padding:40px;"><p class="muted">${label('ui.author.loading_draft')} ${esc(draftId)}…</p></div>`;

  let draftData = null;
  let validation = null;

  try {
    const res = await api.getDraft(draftId);
    if (!navigation.isCurrent()) return;
    draftData = res.draft;
    validation = res.validation;
  } catch (e) {
    if (!navigation.isCurrent()) return;
    main.innerHTML = `<div class="card"><p class="red">${label('ui.author.load_failed')}: ${esc(e.message)}</p><a class="btn" href="#/author">${label('ui.author.back_to_list')}</a></div>`;
    return;
  }

  let currentTab = 'manifest'; // 'manifest' | 'ch1' | 'ch2' | 'raw'

  // ---- unsaved-edit protection (R5) ----
  // This buffer is the only copy of what the author typed until it is saved, so leaving the
  // editor must be a decision. editSeq makes a late server answer detectable: a save that
  // finished after the author typed something newer may not overwrite the newer buffer.
  let savedJson = JSON.stringify(draftData);
  let editSeq = 0;
  let leaving = false;
  // True as soon as a keypress lands in a field that has not been read into the buffer yet.
  let typedSinceSync = false;
  /** @type {HTMLElement | null} */
  let guardModal = null;

  const isDirty = () => typedSinceSync || JSON.stringify(draftData) !== savedJson;

  function refreshDirtyBadge() {
    const badge = document.getElementById('dirtyBadge');
    if (!badge) return;
    badge.hidden = !isDirty();
  }

  function noteEdit() {
    editSeq++;
    refreshDirtyBadge();
  }

  const onEditorInput = () => {
    typedSinceSync = true;
    noteEdit();
  };
  main.addEventListener('input', onEditorInput);

  // Persist the current buffer. The payload is serialized at request time, so the caller can
  // tell later whether the author kept typing while the server was writing.
  async function saveCurrent() {
    const payload = JSON.parse(JSON.stringify(draftData));
    const sent = JSON.stringify(payload);
    const seqAtRequest = editSeq;
    const res = await api.saveDraft(draftId, payload);
    savedJson = sent;
    if (editSeq === seqAtRequest) {
      draftData = res.draft;
      savedJson = JSON.stringify(res.draft);
    }
    validation = res.validation;
    refreshDirtyBadge();
    return res;
  }

  function closeGuardModal() {
    if (!guardModal) return;
    const modal = guardModal;
    guardModal = null;
    dismissModal(modal);
  }

  // Save / discard / stay — the three answers an author needs when they walk away.
  function askBeforeLeaving(targetHash) {
    if (guardModal) return;
    const modal = document.createElement('div');
    modal.className = 'modal-back';
    modal.id = 'draftUnsavedModal';
    modal.innerHTML = `
      <div class="modal-card card" style="max-width:520px;">
        <h3 style="margin-top:0;">${label('ui.author.unsaved_title')}</h3>
        <p class="muted">${label('ui.author.unsaved_question')}</p>
        <div style="display:flex; gap:8px; flex-wrap:wrap; justify-content:flex-end;">
          <button class="btn small" id="draftLeaveStay">${label('ui.author.leave_stay')}</button>
          <button class="btn small red" id="draftLeaveDiscard">${label('ui.author.leave_discard')}</button>
          <button class="btn primary small" id="draftLeaveSave">${label('ui.author.leave_save')}</button>
        </div>
      </div>`;
    if (!presentModal(modal)) return;
    guardModal = modal;
    const done = () => closeGuardModal();
    modal.querySelector('#draftLeaveStay').addEventListener('click', done);
    modal.addEventListener('keydown', event => { if (event.key === 'Escape') done(); });
    modal.querySelector('#draftLeaveDiscard').addEventListener('click', () => {
      done();
      leaving = true;
      location.hash = targetHash;
    });
    modal.querySelector('#draftLeaveSave').addEventListener('click', async () => {
      const button = /** @type {HTMLButtonElement} */ (modal.querySelector('#draftLeaveSave'));
      button.disabled = true;
      if (!syncInputsToDraft()) {
        button.disabled = false;
        return;
      }
      try {
        const savedRes = await saveCurrent();
        if (!navigation.isCurrent()) return;
        if (!savedRes.validation.ok) {
          toast(() => t('ui.author.saved_with_errors', { count: savedRes.validation.diagnostics.filter(d => d.severity === 'error').length }));
        }
        done();
        leaving = true;
        location.hash = targetHash;
      } catch (error) {
        // The edit buffer and the modal stay exactly as they were: a failed save must not
        // silently throw away what the author typed.
        button.disabled = false;
        toast(() => `${t('ui.author.save_failed')}: ${error.message}`);
      }
    });
  }

  const onRouteLeave = event => {
    if (leaving || !isDirty()) return;
    const detail = /** @type {CustomEvent} */ (event).detail;
    const targetHash = typeof detail === 'string' ? detail : (detail?.hash || '#/author');
    const currentDraftRoute = `#/author?draft=${draftId}`;
    if (targetHash === currentDraftRoute || targetHash.startsWith(`${currentDraftRoute}&`)) return;
    event.preventDefault();
    askBeforeLeaving(targetHash || '#/author');
  };
  const onBeforeUnload = event => {
    if (!isDirty()) return;
    event.preventDefault();
    event.returnValue = '';
  };
  document.addEventListener('ui:route-leave', onRouteLeave);
  window.addEventListener('beforeunload', onBeforeUnload);
  navigation.onDispose(() => {
    main.removeEventListener('input', onEditorInput);
    document.removeEventListener('ui:route-leave', onRouteLeave);
    window.removeEventListener('beforeunload', onBeforeUnload);
    if (guardModal) { const modal = guardModal; guardModal = null; modal.remove(); }
  });
  const undoStacks = { 1: [], 2: [] };
  const redoStacks = { 1: [], 2: [] };
  const currentTools = { 1: 'wall', 2: 'wall' };
  const selectedEntities = { 1: null, 2: null };
  const initialMaps = {
    1: JSON.parse(JSON.stringify((draftData.maps || [])[0] || {})),
    2: JSON.parse(JSON.stringify((draftData.maps || [])[1] || {}))
  };

  function captureFocus() {
    const active = /** @type {HTMLElement | null} */ (document.activeElement);
    if (!active || !main.contains(active) || active === main) return null;
    const key = active.id || active.getAttribute('data-sync-choice') || active.getAttribute('data-sync-scene') ||
      active.getAttribute('data-sync-npc') || active.getAttribute('data-tool') || active.getAttribute('data-field-key') || null;
    if (!key) return null;
    const kind = active.id ? '#id' : (active.getAttribute('data-sync-choice') ? 'choice' :
      (active.getAttribute('data-sync-scene') ? 'scene' : (active.getAttribute('data-sync-npc') ? 'npc' : 'other')));
    const start = 'selectionStart' in active ? /** @type {number} */ (/** @type {HTMLInputElement} */ (active).selectionStart) : null;
    const end = 'selectionEnd' in active ? /** @type {number} */ (/** @type {HTMLInputElement} */ (active).selectionEnd) : null;
    return { key, kind, start, end };
  }

  function restoreFocus(snapshot) {
    if (!snapshot) return;
    const selector = snapshot.kind === 'choice' ? `[data-sync-choice="${snapshot.key}"]`
      : snapshot.kind === 'scene' ? `[data-sync-scene="${snapshot.key}"]`
        : snapshot.kind === 'npc' ? `[data-sync-npc="${snapshot.key}"]`
          : (snapshot.key.startsWith('#') ? snapshot.key : `#${CSS.escape(snapshot.key)}`);
    const node = /** @type {HTMLElement | null} */ (main.querySelector(selector));
    if (!node) return;
    node.focus({ preventScroll: true });
    const field = /** @type {HTMLInputElement} */ (node);
    if (snapshot.start != null && typeof field.setSelectionRange === 'function') {
      try { field.setSelectionRange(snapshot.start, snapshot.end ?? snapshot.start); } catch { /* non-text input */ }
    }
  }

  function renderFullEditor() {
    // The DOM holds what the author has typed since the last sync; keep it before the board
    // is rebuilt, then put the caret back where they were working.
    if (!syncInputsToDraft()) return;
    const focusSnapshot = captureFocus();
    const isValid = validation?.ok;
    const errors = (validation?.diagnostics || []).filter(d => d.severity === 'error');
    const ch1 = (draftData.maps || [])[0] || {};
    const ch2 = (draftData.maps || [])[1] || {};

    main.innerHTML = `
      <!-- Top Action Ribbon -->
      <div class="card" style="margin-bottom:14px; position:sticky; top:0; z-index:20; backdrop-filter:blur(10px); background:rgba(26,20,35,0.95); border:1px solid #7c3aed44;">
        <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px;">
          <div style="display:flex; align-items:center; gap:10px;">
            <a class="btn small" href="#/author" title="${esc(t('ui.author.back_to_list'))}">← ${label('ui.author.back_to_list')}</a>
            <h3 style="margin:0; font-size:16px;">${esc(draftData.pack?.name || draftId)}</h3>
            <span class="chip small">${esc(draftId)}</span>
            <span class="chip small gold" id="dirtyBadge" hidden ${isDirty() ? '' : 'style="display:none;"'}>⚠️ ${label('ui.author.unsaved')}</span>
            ${isValid
              ? `<span class="chip small" style="background:#22c55e22; color:#22c55e; border-color:#22c55e;" id="statusBadge">✅ ${label('ui.author.valid')}</span>`
              : `<span class="chip small red" id="statusBadge" style="cursor:pointer;" data-i18n-title="ui.author.show_issues" title="${esc(t('ui.author.show_issues'))}">⚠️ ${label('ui.author.issues', { count: errors.length })}</span>`}
          </div>
          <div style="display:flex; gap:8px; flex-wrap:wrap;">
            <button class="btn primary small" id="saveDraftBtn">${label('ui.author.save_draft')}</button>
            <button class="btn small" id="validateBtn">${label('ui.author.validate')}</button>
            <button class="btn small" id="installBtn" ${!isValid ? `disabled data-i18n-title="ui.author.fix_errors_first" title="${esc(t('ui.author.fix_errors_first'))}"` : ''}>📦 ${label('ui.author.install')}</button>
            <button class="btn small" id="exportBtn" ${!isValid ? `disabled data-i18n-title="ui.author.fix_errors_first" title="${esc(t('ui.author.fix_errors_first'))}"` : ''}>📥 ${label('ui.author.export')}</button>
            <button class="btn small" id="playtestBtn" ${!isValid ? `disabled data-i18n-title="ui.author.fix_errors_first" title="${esc(t('ui.author.fix_errors_first'))}"` : ''} style="background:linear-gradient(180deg, #6d28d9, #4c1d95); border-color:#8b5cf6;">🎮 ${label('ui.author.playtest')}</button>
          </div>
          </div>
        </div>

        <!-- Diagnostics Drawer -->
        ${!isValid && errors.length ? `
          <div id="diagnosticsBanner" style="margin-top:10px; padding:8px 12px; background:rgba(239,68,68,0.1); border:1px solid rgba(239,68,68,0.3); border-radius:4px;">
            <b class="small red" style="display:block; margin-bottom:4px;">⚠️ ${label('ui.author.diagnostics_title')} (${errors.length})</b>
            <ul class="small muted" style="margin:0; padding-left:18px; max-height:120px; overflow-y:auto;">
              ${errors.map(err => `<li><b>${esc(err.field || err.file || 'general')}</b>: ${esc(err.message)} <span class="chip small red" style="padding:0 4px; font-size:10px;">${esc(err.code || '')}</span></li>`).join('')}
            </ul>
          </div>
        ` : ''}

        <!-- Tab Bar -->
        <div style="display:flex; gap:8px; margin-top:12px; border-bottom:1px solid var(--border); padding-bottom:4px;">
          <button class="btn small ${currentTab === 'manifest' ? 'primary' : ''}" data-tab="manifest">📋 ${label('ui.author.tab_manifest')}</button>
          <button class="btn small ${currentTab === 'ch1' ? 'primary' : ''}" data-tab="ch1">🌉 ${label('ui.author.tab_ch1')}</button>
          <button class="btn small ${currentTab === 'ch2' ? 'primary' : ''}" data-tab="ch2">🛡️ ${label('ui.author.tab_ch2')}</button>
          <button class="btn small ${currentTab === 'raw' ? 'primary' : ''}" data-tab="raw">⚙️ ${label('ui.author.tab_raw')}</button>
        </div>
      </div>

      <!-- Tab Content Area -->
      <div id="tabContentHost">
        ${renderTabContent(currentTab, draftData, ch1, ch2, currentTools, selectedEntities)}
      </div>
    `;

    wireEditorEvents();
    restoreFocus(focusSnapshot);
    refreshDirtyBadge();
  }

  function wireEditorEvents() {
    // Tab switching
    main.querySelectorAll('[data-tab]').forEach(btn => {
      btn.addEventListener('click', () => {
        const nextTab = btn.getAttribute('data-tab');
        if (nextTab === currentTab) return;
        if (!syncInputsToDraft()) return;
        currentTab = nextTab;
        renderFullEditor();
      });
    });

    // Save Draft
    const saveBtn = /** @type {HTMLButtonElement} */ (document.getElementById('saveDraftBtn'));
    if (saveBtn) {
      saveBtn.addEventListener('click', async () => {
        if (!syncInputsToDraft()) return;
        const seqAtRequest = editSeq;
        saveBtn.disabled = true;
        localizeText(saveBtn, () => t('ui.author.saving'));
        try {
          const res = await saveCurrent();
          if (!navigation.isCurrent()) return;
          toast(() => res.validation.ok
            ? t('ui.author.saved')
            : t('ui.author.saved_with_errors', { count: res.validation.diagnostics.filter(d => d.severity === 'error').length }));
          if (editSeq === seqAtRequest) renderFullEditor(); else refreshDirtyBadge();
        } catch (e) {
          if (!navigation.isCurrent()) return;
          toast(() => `${t('ui.author.save_failed')}: ${e.message}`);
        } finally {
          if (navigation.isCurrent()) {
            saveBtn.disabled = false;
            localizeText(saveBtn, () => t('ui.author.save_draft'));
          }
        }
      });
    }

    // Validate — saves first, so the report describes the work on screen, not the last draft
    // that happened to reach disk.
    const valBtn = /** @type {HTMLButtonElement} */ (document.getElementById('validateBtn'));
    if (valBtn) {
      valBtn.addEventListener('click', async () => {
        if (!syncInputsToDraft()) return;
        const seqAtRequest = editSeq;
        valBtn.disabled = true;
        localizeText(valBtn, () => t('ui.author.validating'));
        try {
          const res = await saveCurrent();
          if (!navigation.isCurrent()) return;
          validation = res.validation;
          toast(() => validation.ok
            ? `✅ ${t('ui.author.validation_ok')}`
            : `⚠️ ${t('ui.author.validation_errors', { count: validation.diagnostics.filter(d => d.severity === 'error').length })}`);
          if (editSeq === seqAtRequest) renderFullEditor(); else refreshDirtyBadge();
        } catch (e) {
          if (!navigation.isCurrent()) return;
          toast(() => e.message);
        } finally {
          if (navigation.isCurrent()) {
            valBtn.disabled = false;
            localizeText(valBtn, () => t('ui.author.validate'));
          }
        }
      });
    }

    // Install
    const installBtn = /** @type {HTMLButtonElement} */ (document.getElementById('installBtn'));
    if (installBtn) {
      installBtn.addEventListener('click', async () => {
        if (!syncInputsToDraft()) return;
        installBtn.disabled = true;
        installBtn.removeAttribute('data-installed');
        localizeText(installBtn, () => t('ui.author.installing'));
        try {
          await saveCurrent();
          if (!navigation.isCurrent()) return;
          if (!validation.ok) {
            toast(() => t('ui.author.blocked_by_errors', { count: validation.diagnostics.filter(d => d.severity === 'error').length }));
            refreshDirtyBadge();
            return;
          }
          await api.installDraft(draftId);
          if (!navigation.isCurrent()) return;
          installBtn.setAttribute('data-installed', 'true');
          toast(() => t('ui.author.installed'));
        } catch (e) {
          if (navigation.isCurrent()) toast(() => `${t('ui.author.install_failed')}: ${e.message}`);
        } finally {
          if (navigation.isCurrent()) {
            installBtn.disabled = false;
            localizeText(installBtn, () => `📦 ${t('ui.author.install')}`);
          }
        }
      });
    }

    // Export the draft as it stands on screen: save, re-check the saved file on the server,
    // and only then download. A stale bundle must never leave the studio pretending to be
    // the current work, and a failure keeps the editor exactly as it was.
    const exportBtn = /** @type {HTMLButtonElement} */ (document.getElementById('exportBtn'));
    if (exportBtn) {
      exportBtn.addEventListener('click', async () => {
        if (!syncInputsToDraft()) return;
        exportBtn.disabled = true;
        localizeText(exportBtn, () => t('ui.author.exporting'));
        try {
          await saveCurrent();
          if (!navigation.isCurrent()) return;
          const report = await api.validateDraft(draftId);
          if (!navigation.isCurrent()) return;
          validation = report;
          if (!report.ok) {
            toast(() => t('ui.author.blocked_by_errors', { count: report.diagnostics.filter(d => d.severity === 'error').length }));
            renderFullEditor();
            return;
          }
          const link = document.createElement('a');
          link.href = `/api/content/drafts/${encodeURIComponent(draftId)}/export`;
          link.download = `${draftId}.json`;
          link.rel = 'noopener';
          document.body.appendChild(link);
          link.click();
          link.remove();
          toast(() => t('ui.author.export_started'));
        } catch (e) {
          if (navigation.isCurrent()) toast(() => `${t('ui.author.export_failed')}: ${e.message}`);
        } finally {
          if (navigation.isCurrent()) {
            exportBtn.disabled = false;
            localizeText(exportBtn, () => `📥 ${t('ui.author.export')}`);
          }
        }
      });
    }

    // Playtest
    const playtestBtn = /** @type {HTMLButtonElement} */ (document.getElementById('playtestBtn'));
    if (playtestBtn) {
      playtestBtn.addEventListener('click', async () => {
        if (!syncInputsToDraft()) return;
        playtestBtn.disabled = true;
        localizeText(playtestBtn, () => t('ui.author.playtest_start'));
        try {
          await saveCurrent();
          if (!navigation.isCurrent()) return;
          if (!validation.ok) {
            toast(() => t('ui.author.blocked_by_errors', { count: validation.diagnostics.filter(d => d.severity === 'error').length }));
            renderFullEditor();
            return;
          }
          const res = await api.playtestDraft(draftId);
          if (!navigation.isCurrent()) return;
          location.hash = `#/play/${res.saveId}`;
        } catch (e) {
          if (navigation.isCurrent()) {
            toast(() => `${t('ui.author.playtest_failed')}: ${e.message}`);
            playtestBtn.disabled = false;
            localizeText(playtestBtn, () => `🎮 ${t('ui.author.playtest')}`);
          }
        }
      });
    }

    // Raw JSON events
    const rawApply = document.getElementById('rawApplyBtn');
    const rawFormat = document.getElementById('rawFormatBtn');
    const rawText = /** @type {HTMLTextAreaElement | null} */ (document.getElementById('rawJsonText'));
    if (rawApply && rawText) {
      rawApply.addEventListener('click', () => {
        try {
          const parsed = JSON.parse(rawText.value);
          draftData = parsed;
          noteEdit();
          toast(() => t('ui.author.raw_applied'));
          renderFullEditor();
        } catch (e) {
          toast(() => `${t('ui.author.raw_invalid_json')}: ${e.message}`);
        }
      });
    }
    if (rawFormat && rawText) {
      rawFormat.addEventListener('click', () => {
        try {
          rawText.value = JSON.stringify(JSON.parse(rawText.value), null, 2);
        } catch (e) {
          toast(() => `${t('ui.author.raw_invalid_json')}: ${e.message}`);
        }
      });
    }

    if (currentTab === 'ch1' || currentTab === 'ch2') {
      const chapterNum = currentTab === 'ch1' ? 1 : 2;
      const mapDef = (draftData.maps || [])[chapterNum - 1];
      if (mapDef) wireMapEditor(chapterNum, mapDef);
    }
  }

  function wireMapEditor(chapterNum, mapDef) {
    const toolBtns = main.querySelectorAll(`[data-tool][data-chapter="${chapterNum}"]`);
    toolBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        const tool = btn.getAttribute('data-tool') || 'wall';
        currentTools[chapterNum] = tool;
        toolBtns.forEach(b => b.classList.toggle('active', b.getAttribute('data-tool') === tool));
        if (tool !== 'select') {
          selectedEntities[chapterNum] = null;
          refreshMapEditorUI();
        }
      });
    });

    const entBar = main.querySelector(`.map-grid-entities-bar[data-chapter="${chapterNum}"]`);
    if (entBar) {
      entBar.addEventListener('click', e => {
        const chip = /** @type {HTMLElement | null} */ (e.target)?.closest('[data-entity-chip]');
        if (!chip) return;
        const id = chip.getAttribute('data-entity-chip');
        selectedEntities[chapterNum] = id;
        currentTools[chapterNum] = 'select';
        toolBtns.forEach(b => b.classList.toggle('active', b.getAttribute('data-tool') === 'select'));
        refreshMapEditorUI();
      });
    }

    const container = document.getElementById(`mapGridContainer_${chapterNum}`);
    if (container) {
      container.addEventListener('click', e => {
        const cell = /** @type {HTMLElement | null} */ (e.target)?.closest('.map-grid-cell');
        if (!cell) return;
        const x = parseInt(cell.getAttribute('data-x') || '0', 10);
        const y = parseInt(cell.getAttribute('data-y') || '0', 10);
        handleCellClick(chapterNum, mapDef, x, y);
      });
    }

    const undoBtn = main.querySelector(`[data-map-action="undo"][data-chapter="${chapterNum}"]`);
    if (undoBtn) {
      undoBtn.addEventListener('click', () => {
        if (undoStacks[chapterNum].length > 0) {
          redoStacks[chapterNum].push(getSnapshot(mapDef));
          applySnapshot(mapDef, undoStacks[chapterNum].pop());
          noteEdit();
          refreshMapEditorUI();
        } else {
          toast(() => t('ui.author.nothing_to_undo'));
        }
      });
    }

    const redoBtn = main.querySelector(`[data-map-action="redo"][data-chapter="${chapterNum}"]`);
    if (redoBtn) {
      redoBtn.addEventListener('click', () => {
        if (redoStacks[chapterNum].length > 0) {
          undoStacks[chapterNum].push(getSnapshot(mapDef));
          applySnapshot(mapDef, redoStacks[chapterNum].pop());
          noteEdit();
          refreshMapEditorUI();
        } else {
          toast(() => t('ui.author.nothing_to_redo'));
        }
      });
    }

    const resetBtn = main.querySelector(`[data-map-action="reset"][data-chapter="${chapterNum}"]`);
    if (resetBtn) {
      resetBtn.addEventListener('click', () => {
        if (initialMaps[chapterNum]) {
          undoStacks[chapterNum].push(getSnapshot(mapDef));
          redoStacks[chapterNum] = [];
          applySnapshot(mapDef, JSON.stringify(initialMaps[chapterNum]));
          toast(() => t('ui.author.map_reset'));
          noteEdit();
          refreshMapEditorUI();
        }
      });
    }

    const ptBtn = /** @type {HTMLButtonElement | null} */ (main.querySelector(`[data-map-action="playtest"][data-chapter="${chapterNum}"]`));
    if (ptBtn) {
      ptBtn.addEventListener('click', async () => {
        syncInputsToDraft();
        ptBtn.disabled = true;
        localizeText(ptBtn, () => t('ui.author.playtest_start'));
        try {
          const saveRes = await saveCurrent();
          if (!navigation.isCurrent()) return;
          if (!saveRes.validation.ok) {
            toast(() => t('ui.author.blocked_by_errors', { count: saveRes.validation.diagnostics.filter(d => d.severity === 'error').length }));
            renderFullEditor();
            return;
          }
          const res = await api.playtestDraft(draftId, { mapId: mapDef.id });
          if (!navigation.isCurrent()) return;
          location.hash = `#/play/${res.saveId}`;
        } catch (e) {
          if (navigation.isCurrent()) {
            toast(() => `${t('ui.author.playtest_failed')}: ${e.message}`);
            ptBtn.disabled = false;
            localizeText(ptBtn, () => `🎮 ${t('ui.author.playtest_map')}`);
          }
        }
      });
    }

    function updateConnectivityBadge() {
      const badge = document.getElementById(`mapConnectivityBadge_${chapterNum}`);
      if (!badge) return;
      const conn = computeConnectivity(mapDef);
      const styles = conn.ok
        ? { background: 'rgba(34,197,94,0.1)', color: '#4ade80', borderColor: 'rgba(34,197,94,0.3)' }
        : { background: 'rgba(239,68,68,0.1)', color: '#f87171', borderColor: 'rgba(239,68,68,0.3)' };
      badge.style.background = styles.background;
      badge.style.color = styles.color;
      badge.style.borderColor = styles.borderColor;
      localizeText(badge, () => `${conn.ok ? '✅' : '⚠️'} ${t(conn.key, conn.params)}`);
    }

    function refreshMapEditorUI() {
      const gridCont = document.getElementById(`mapGridContainer_${chapterNum}`);
      if (gridCont) {
        gridCont.innerHTML = renderGridCells(mapDef, selectedEntities[chapterNum]);
      }
      const bar = main.querySelector(`.map-grid-entities-bar[data-chapter="${chapterNum}"]`);
      if (bar) {
        bar.innerHTML = renderEntityChipsHtml(mapDef, chapterNum, selectedEntities[chapterNum]);
      }
      updateConnectivityBadge();
    }

    function handleCellClick(chNum, mDef, x, y) {
      const tool = currentTools[chNum] || 'wall';
      const currentRow = mDef.rows[y] || '';
      const currentTile = currentRow[x];
      const isCampfireTile = (mDef.victory?.campfire?.x === x && mDef.victory?.campfire?.y === y) ||
                             (mDef.entities || []).some(e => e.id === 'campfire' && e.x === x && e.y === y);
      const isStartTile = (mDef.playerStart?.x === x && mDef.playerStart?.y === y);
      const entityAtCell = (mDef.entities || []).find(e => e.x === x && e.y === y) || null;
      // Story references decide what may be destroyed: a scene NPC, a scene door and the
      // guards of a passage are all loadable entities, not paint.
      const sceneRefIds = new Set((mDef.scenes || []).flatMap(s => [s.npcId, s.doorId, ...(s.guardIds || [])].filter(Boolean)));
      const referencedByScene = !!entityAtCell && sceneRefIds.has(entityAtCell.id);
      const setTile = (tx, ty, ch) => {
        const row = mDef.rows[ty];
        mDef.rows[ty] = row.substring(0, tx) + ch + row.substring(tx + 1);
      };
      const currentTileAt = (tx, ty) => mDef.rows[ty]?.[tx];
      const authoredName = kind => ({
        name: ENTITY_DEFAULTS[kind][getLocale()] || ENTITY_DEFAULTS[kind].en,
        localized: { 'zh-CN': ENTITY_DEFAULTS[kind]['zh-CN'], en: ENTITY_DEFAULTS[kind].en }
      });

      if (tool === 'wall') {
        if (isCampfireTile || isStartTile) {
          toast(() => t('ui.author.map_blocked_start_campfire'));
          return;
        }
        if (referencedByScene) {
          toast(() => t('ui.author.map_entity_referenced', { name: entityAtCell.name || entityAtCell.id }));
          return;
        }
        if (entityAtCell && entityAtCell.type !== 'door') {
          toast(() => t('ui.author.map_tile_occupied'));
          return;
        }
        if (currentTile === '#') return;
        undoStacks[chNum].push(getSnapshot(mDef));
        redoStacks[chNum] = [];
        setTile(x, y, '#');
        // Only an unreferenced door may be sealed away with the wall.
        mDef.entities = (mDef.entities || []).filter(e => !(e.type === 'door' && e.x === x && e.y === y));
        noteEdit();
        refreshMapEditorUI();
        return;
      }

      if (tool === 'floor') {
        if (referencedByScene) {
          toast(() => t('ui.author.map_entity_referenced', { name: entityAtCell.name || entityAtCell.id }));
          return;
        }
        if (currentTile === '.' && !mDef.entities?.some(e => e.type === 'door' && e.x === x && e.y === y)) return;
        undoStacks[chNum].push(getSnapshot(mDef));
        redoStacks[chNum] = [];
        setTile(x, y, '.');
        mDef.entities = (mDef.entities || []).filter(e => !(e.type === 'door' && e.x === x && e.y === y));
        noteEdit();
        refreshMapEditorUI();
        return;
      }

      if (tool === 'door') {
        if (isCampfireTile || isStartTile) {
          toast(() => t('ui.author.map_blocked_start_campfire'));
          return;
        }
        undoStacks[chNum].push(getSnapshot(mDef));
        redoStacks[chNum] = [];
        setTile(x, y, 'D');
        mDef.entities = mDef.entities || [];
        const doorEnt = mDef.entities.find(e => e.type === 'door' && e.x === x && e.y === y);
        if (!doorEnt) {
          const doorName = authoredName('door');
          mDef.entities.push({
            id: `${mDef.id}_door_${x}_${y}`,
            type: 'door',
            x,
            y,
            name: doorName.name,
            localized: doorName.localized,
            open: false,
            locked: false
          });
        }
        noteEdit();
        refreshMapEditorUI();
        return;
      }

      if (tool === 'player') {
        if (currentTile === '#') {
          toast(() => t('ui.author.map_wall_forbidden'));
          return;
        }
        if (isStartTile) return;
        undoStacks[chNum].push(getSnapshot(mDef));
        redoStacks[chNum] = [];
        mDef.playerStart = { x, y };
        noteEdit();
        refreshMapEditorUI();
        return;
      }

      if (tool === 'campfire') {
        if (currentTile === '#') {
          toast(() => t('ui.author.map_wall_forbidden'));
          return;
        }
        if (isCampfireTile) return;
        undoStacks[chNum].push(getSnapshot(mDef));
        redoStacks[chNum] = [];
        mDef.victory = mDef.victory || { type: 'story' };
        mDef.victory.campfire = { x, y };
        mDef.entities = mDef.entities || [];
        let campEnt = mDef.entities.find(e => e.id === 'campfire');
        const oldCampfire = campEnt ? { x: campEnt.x, y: campEnt.y } : null;
        if (campEnt) {
          campEnt.x = x;
          campEnt.y = y;
        } else {
          const fireName = authoredName('campfire');
          mDef.entities.push({
            id: 'campfire',
            type: 'object',
            x,
            y,
            icon: '🔥',
            name: fireName.name,
            localized: fireName.localized
          });
        }
        // A campfire that used to sit on a door tile hands that door back to the grid.
        if (oldCampfire && mDef.rows[oldCampfire.y]?.[oldCampfire.x] === 'D' &&
            !mDef.entities.some(e => e.type === 'door' && e.x === oldCampfire.x && e.y === oldCampfire.y)) {
          setTile(oldCampfire.x, oldCampfire.y, '.');
        }
        noteEdit();
        refreshMapEditorUI();
        return;
      }

      if (tool === 'select') {
        const selectedId = selectedEntities[chNum];
        if (selectedId) {
          if (currentTile === '#') {
            toast(() => t('ui.author.map_wall_forbidden'));
            return;
          }
          const ent = (mDef.entities || []).find(e => e.id === selectedId);
          if (!ent) return;
          if (ent.x === x && ent.y === y) return;
          const occupant = (mDef.entities || []).find(e => e !== ent && e.x === x && e.y === y);
          if (occupant) {
            toast(() => t('ui.author.map_tile_occupied'));
            return;
          }
          undoStacks[chNum].push(getSnapshot(mDef));
          redoStacks[chNum] = [];
          const isDoor = ent.type === 'door';
          // A door is its tile: clear the old glyph before writing the new one, so the grid,
          // the entity and every scene reference (doorId/guardIds/npcId) stay one object.
          if (isDoor && currentTileAt(ent.x, ent.y) === 'D') setTile(ent.x, ent.y, '.');
          ent.x = x;
          ent.y = y;
          if (isDoor) setTile(x, y, 'D');
          if (ent.id === 'campfire') {
            mDef.victory = mDef.victory || { type: 'story' };
            mDef.victory.campfire = { x, y };
          }
          selectedEntities[chNum] = null;
          noteEdit();
          refreshMapEditorUI();
        } else {
          const ent = (mDef.entities || []).find(e => e.x === x && e.y === y);
          if (ent) {
            selectedEntities[chNum] = ent.id;
            refreshMapEditorUI();
          }
        }
        return;
      }

      if (tool === 'erase') {
        if (!entityAtCell) return;
        if (entityAtCell.id === 'campfire') {
          toast(() => t('ui.author.map_campfire_protected'));
          return;
        }
        if (referencedByScene) {
          toast(() => t('ui.author.map_entity_referenced', { name: entityAtCell.name || entityAtCell.id }));
          return;
        }
        undoStacks[chNum].push(getSnapshot(mDef));
        redoStacks[chNum] = [];
        mDef.entities = mDef.entities.filter(e => e !== entityAtCell);
        if (currentTile === 'D') setTile(x, y, '.');
        noteEdit();
        refreshMapEditorUI();
        return;
      }
    }
  }

  function syncInputsToDraft() {
    if (!draftData) return true;
    if (currentTab === 'raw') {
      const rawText = /** @type {HTMLTextAreaElement | null} */ (document.getElementById('rawJsonText'));
      if (rawText) {
        try {
          const parsed = JSON.parse(rawText.value);
          if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            toast(() => `${t('ui.author.raw_invalid_json')}: Expected JSON object`);
            return false;
          }
          draftData = parsed;
          typedSinceSync = false;
          return true;
        } catch (e) {
          toast(() => `${t('ui.author.raw_invalid_json')}: ${e.message}`);
          return false;
        }
      }
      return true;
    }
    if (currentTab === 'manifest') {
      const nameZh = /** @type {HTMLInputElement | null} */ (document.getElementById('m_nameZh'))?.value;
      const nameEn = /** @type {HTMLInputElement | null} */ (document.getElementById('m_nameEn'))?.value;
      const blurbZh = /** @type {HTMLTextAreaElement | null} */ (document.getElementById('m_blurbZh'))?.value;
      const blurbEn = /** @type {HTMLTextAreaElement | null} */ (document.getElementById('m_blurbEn'))?.value;
      const author = /** @type {HTMLInputElement | null} */ (document.getElementById('m_author'))?.value;

      if (nameZh !== undefined) draftData.pack.name = nameZh || nameEn || draftData.pack.name;
      if (author !== undefined) draftData.pack.author = author;
      if (blurbZh !== undefined) draftData.pack.blurb = blurbZh || blurbEn || draftData.pack.blurb;

      draftData.pack.localized = draftData.pack.localized || {};
      draftData.pack.localized['zh-CN'] = { name: nameZh || draftData.pack.name, blurb: blurbZh || draftData.pack.blurb };
      draftData.pack.localized.en = { name: nameEn || nameZh || draftData.pack.name, blurb: blurbEn || blurbZh || draftData.pack.blurb };
    } else if (currentTab === 'ch1' || currentTab === 'ch2') {
      const mapIdx = currentTab === 'ch1' ? 0 : 1;
      const m = draftData.maps[mapIdx];
      if (!m) return true;

      // Sync NPCs
      main.querySelectorAll('[data-sync-npc]').forEach(input => {
        const npcId = input.getAttribute('data-sync-npc');
        const field = input.getAttribute('data-field');
        const lang = input.getAttribute('data-lang');
        const val = /** @type {HTMLInputElement | HTMLTextAreaElement} */ (input).value;
        const npcDef = m.npcs?.[npcId];
        if (!npcDef) return;

        if (field === 'canned') {
          const lines = val.split('\n').map(l => l.trim()).filter(Boolean);
          if (lang === 'zh-CN') {
            npcDef.canned = lines;
            npcDef.localized = npcDef.localized || {};
            npcDef.localized['zh-CN'] = npcDef.localized['zh-CN'] || {};
            npcDef.localized['zh-CN'].canned = lines;
          } else {
            npcDef.localized = npcDef.localized || {};
            npcDef.localized.en = npcDef.localized.en || {};
            npcDef.localized.en.canned = lines;
          }
        } else if (field === 'name') {
          const ent = (m.entities || []).find(e => e.id === npcId && e.type === 'npc');
          if (lang === 'zh-CN') {
            if (ent) ent.name = val;
            if (ent) { ent.localized = ent.localized || {}; ent.localized['zh-CN'] = { name: val }; }
          } else {
            if (ent) { ent.localized = ent.localized || {}; ent.localized.en = { name: val }; }
          }
        } else {
          // persona or knowledge
          if (lang === 'zh-CN') {
            npcDef[field] = val;
            npcDef.localized = npcDef.localized || {};
            npcDef.localized['zh-CN'] = npcDef.localized['zh-CN'] || {};
            npcDef.localized['zh-CN'][field] = val;
          } else {
            npcDef.localized = npcDef.localized || {};
            npcDef.localized.en = npcDef.localized.en || {};
            npcDef.localized.en[field] = val;
          }
        }
      });

      // Sync Scenes & Choices
      main.querySelectorAll('[data-sync-scene]').forEach(input => {
        const sceneId = input.getAttribute('data-sync-scene');
        const field = input.getAttribute('data-field');
        const lang = input.getAttribute('data-lang');
        const val = /** @type {HTMLInputElement | HTMLTextAreaElement} */ (input).value;
        const scene = (m.scenes || []).find(s => s.id === sceneId);
        if (!scene) return;

        if (lang === 'zh-CN') {
          scene[field] = val;
          scene.localized = scene.localized || {};
          scene.localized['zh-CN'] = scene.localized['zh-CN'] || {};
          scene.localized['zh-CN'][field] = val;
        } else {
          scene.localized = scene.localized || {};
          scene.localized.en = scene.localized.en || {};
          scene.localized.en[field] = val;
        }
      });

      // Sync Choices — the fields T15a promised (skill/DC, cost, item grants and consumption,
      // memory, failure branch, ending, legal history condition) land in the schema the T8
      // validator already whitelists. No scripting surface: scalar fields only.
      main.querySelectorAll('[data-sync-choice]').forEach(input => {
        const [sceneId, choiceId] = (input.getAttribute('data-sync-choice') || '').split(':');
        const field = input.getAttribute('data-field');
        const lang = input.getAttribute('data-lang');
        const val = /** @type {HTMLInputElement | HTMLTextAreaElement} */ (input).value;
        const scene = (m.scenes || []).find(s => s.id === sceneId);
        const choice = (scene?.choices || []).find(c => c.id === choiceId);
        if (!choice || !field) return;

        const setText = (node, key, value) => {
          node.localized = node.localized || {};
          const bucket = lang === 'en' ? 'en' : 'zh-CN';
          const trimmed = (value || '').trim();
          if (trimmed) {
            node.localized[bucket] = node.localized[bucket] || {};
            node.localized[bucket][key] = value;
            if (lang === 'zh-CN' || !node[key]) {
              node[key] = value;
            }
          } else {
            if (node.localized[bucket]) {
              delete node.localized[bucket][key];
              if (Object.keys(node.localized[bucket]).length === 0) delete node.localized[bucket];
              if (Object.keys(node.localized).length === 0) delete node.localized;
            }
            const otherBucket = lang === 'en' ? 'zh-CN' : 'en';
            if (node.localized?.[otherBucket]?.[key]) {
              node[key] = node.localized[otherBucket][key];
            } else {
              delete node[key];
            }
          }
        };
        const clearOrSet = (node, key, value) => {
          if (value === '' || value === null || value === undefined) delete node[key];
          else node[key] = value;
        };
        // A skill, a DC, a failure-gold or a failure branch only exist on a check. Writing them
        // onto a decision or passage choice would rewrite what that choice is, and the mechanics
        // panel renders these fields for every choice - so an untouched field must change nothing.
        const checkEffect = () => (choice.effect && choice.effect.type === 'check' ? choice.effect : null);
        // A price or a good only exists on a noncombat story choice: the engine owns a combat
        // choice's rewards, and any extra key on that effect is a validation error.
        const goodsEffect = () => (choice.effect && choice.effect.type !== 'combat' ? choice.effect : null);
        // An emptied number box means "no value", not "zero" - Number('') is 0.
        const numeric = (value, fallback) => {
          const text = String(value).trim();
          if (!text) return fallback;
          const n = Number(text);
          return Number.isFinite(n) ? n : fallback;
        };

        if (field === 'label' || field === 'response' || field === 'memory') {
          setText(choice, field, val);
        } else if (field === 'failure_response' || field === 'failure_memory' || field === 'failure_ending') {
          if (!checkEffect()) return;
          const key = field.replace('failure_', '');
          const cleanupFailure = c => {
            if (!c.failure) return;
            if (c.failure.localized) {
              for (const b of ['en', 'zh-CN']) {
                if (c.failure.localized[b] && Object.keys(c.failure.localized[b]).length === 0) {
                  delete c.failure.localized[b];
                }
              }
              if (Object.keys(c.failure.localized).length === 0) {
                delete c.failure.localized;
              }
            }
            const hasResp = Boolean(c.failure.response || c.failure.localized?.['zh-CN']?.response || c.failure.localized?.en?.response);
            const hasMem = Boolean(c.failure.memory || c.failure.localized?.['zh-CN']?.memory || c.failure.localized?.en?.memory);
            const hasEnding = Boolean(c.failure.ending);
            const hasReactions = Boolean(c.failure.reactions && Object.keys(c.failure.reactions).length > 0);
            const hasLoyalty = c.failure.loyalty !== undefined;
            if (!hasResp && !hasMem && !hasEnding && !hasReactions && !hasLoyalty) {
              delete c.failure;
            }
          };

          if (key === 'ending') {
            const trimmed = val.trim();
            if (!trimmed) {
              if (choice.failure) {
                delete choice.failure.ending;
                cleanupFailure(choice);
              }
            } else {
              choice.failure = choice.failure || { fact: `${choice.id}_failure` };
              choice.failure.ending = trimmed;
            }
            return;
          }

          const trimmed = val.trim();
          const bucket = lang === 'en' ? 'en' : 'zh-CN';
          const otherBucket = lang === 'en' ? 'zh-CN' : 'en';

          if (!trimmed) {
            if (choice.failure) {
              if (choice.failure.localized?.[bucket]) {
                delete choice.failure.localized[bucket][key];
                if (Object.keys(choice.failure.localized[bucket]).length === 0) {
                  delete choice.failure.localized[bucket];
                }
              }
              const otherVal = choice.failure.localized?.[otherBucket]?.[key];
              if (otherVal && typeof otherVal === 'string' && otherVal.trim()) {
                choice.failure[key] = otherVal;
              } else {
                delete choice.failure[key];
              }
              cleanupFailure(choice);
            }
            return;
          }

          choice.failure = choice.failure || { fact: `${choice.id}_failure` };
          choice.failure.localized = choice.failure.localized || {};
          choice.failure.localized[bucket] = choice.failure.localized[bucket] || {};
          choice.failure.localized[bucket][key] = val;

          if (bucket === 'zh-CN' || !choice.failure[key]) {
            choice.failure[key] = val;
          }
        } else if (field === 'effect_type') {
          const next = val || 'decision';
          if (choice.effect && choice.effect.type === next) return;
          // Changing kind replaces the effect: the previous type's keys (a check's skill/DC, a
          // noncombat choice's price or goods) are illegal on the new kind.
          choice.effect = { type: next };
          if (next !== 'check') delete choice.failure;
        } else if (field === 'skill') {
          const eff = checkEffect();
          if (!eff) return;
          clearOrSet(eff, 'skill', val);
        } else if (field === 'dc') {
          const eff = checkEffect();
          if (!eff) return;
          clearOrSet(eff, 'dc', numeric(val, 0) >= 1 ? numeric(val, 0) : '');
        } else if (field === 'costGold') {
          const eff = goodsEffect();
          if (!eff) return;
          clearOrSet(eff, 'costGold', numeric(val, 0) > 0 ? numeric(val, 0) : '');
        } else if (field === 'failureGold') {
          const eff = checkEffect();
          if (!eff) return;
          clearOrSet(eff, 'failureGold', val.trim() === '' ? '' : numeric(val, 0));
        } else if (field === 'giveItem') {
          const eff = goodsEffect();
          if (!eff) return;
          clearOrSet(eff, 'giveItem', val.trim());
        } else if (field === 'consumeItem') {
          const eff = goodsEffect();
          if (!eff) return;
          if (val.trim()) {
            eff.consumeItem = val.trim();
            // Consumption is only legal against a matching has_item condition (T8 validator).
            choice.condition = { type: 'has_item', itemId: val.trim() };
          } else {
            delete eff.consumeItem;
            if (choice.condition?.type === 'has_item') choice.condition = { type: 'always' };
          }
        } else if (field === 'condition_type') {
          const next = val || 'always';
          if (choice.condition && choice.condition.type === next) return;
          const previous = choice.condition || {};
          if (next === 'has_item') choice.condition = { type: 'has_item', itemId: previous.itemId || '' };
          else if (next === 'history_ending') choice.condition = { type: 'history_ending', ending: previous.ending || '' };
          else choice.condition = { type: 'always' };
        } else if (field === 'condition_itemId') {
          // The item box only edits an item gate that already exists. Choosing the gate type is
          // the condition_type select's job; rewriting the type here quietly turned every
          // history-gated choice into a broken has_item on the first form sync.
          if (choice.condition?.type !== 'has_item') return;
          clearOrSet(choice.condition, 'itemId', val.trim());
        } else if (field === 'condition_ending') {
          if (choice.condition?.type !== 'history_ending') return;
          clearOrSet(choice.condition, 'ending', val.trim());
        } else if (field === 'ending') {
          clearOrSet(choice, 'ending', val.trim());
        }
      });
    }
    // The buffer now mirrors what is on screen; the editor is clean until the next keystroke.
    typedSinceSync = false;
    return true;
  }

  renderFullEditor();
  // The first pass reads the freshly rendered fields back into the buffer and normalizes empty
  // values away. That is the editor settling its own representation, not an author edit, so it
  // must not leave a draft that was never touched looking unsaved.
  if (editSeq === 0) { savedJson = JSON.stringify(draftData); refreshDirtyBadge(); }
  return navigation.onDispose(onLocaleChange(() => {
    if (!navigation.isCurrent()) return;
    renderFullEditor();
  }));
}

// -------------------------------------------------------------
// Tab Renderers
// -------------------------------------------------------------
function renderTabContent(tab, draft, ch1, ch2, currentTools = {}, selectedEntities = {}) {
  if (tab === 'manifest') return renderManifestTab(draft);
  if (tab === 'ch1') return renderChapterTab(draft, ch1, 1, currentTools[1], selectedEntities[1]);
  if (tab === 'ch2') return renderChapterTab(draft, ch2, 2, currentTools[2], selectedEntities[2]);
  if (tab === 'raw') return renderRawJsonTab(draft);
  return '';
}

function renderManifestTab(draft) {
  const p = draft.pack || {};
  const zh = p.localized?.['zh-CN'] || {};
  const en = p.localized?.en || {};

  return `
    <div class="card">
      <h3 style="margin-top:0;">📋 ${label('ui.author.tab_manifest')}</h3>
      <p class="small muted" style="margin-bottom:16px;">${label('ui.author.manifest_help')}</p>

      <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(280px, 1fr)); gap:16px;">
        <div>
          <label class="small" style="display:block; margin-bottom:4px;">${label('ui.author.pack_id_label')}</label>
          <input type="text" class="input muted" value="${esc(p.id)}" readonly style="width:100%; opacity:0.8;">
        </div>
        <div>
          <label class="small" style="display:block; margin-bottom:4px;">${label('ui.author.author_label')}</label>
          <input type="text" id="m_author" class="input" value="${esc(p.author || '')}" style="width:100%;">
        </div>
      </div>

      <div style="margin-top:16px; display:grid; grid-template-columns:repeat(auto-fit, minmax(280px, 1fr)); gap:16px;">
        <div>
          <label class="small" style="display:block; margin-bottom:4px;">${label('ui.author.name_zh')}</label>
          <input type="text" id="m_nameZh" class="input" value="${esc(zh.name || p.name || '')}" style="width:100%;">
        </div>
        <div>
          <label class="small" style="display:block; margin-bottom:4px;">${label('ui.author.name_en')}</label>
          <input type="text" id="m_nameEn" class="input" value="${esc(en.name || '')}" data-i18n-placeholder="ui.author.optional_name_en" placeholder="${t('ui.author.optional_name_en')}" style="width:100%;">
        </div>
      </div>

      <div style="margin-top:16px; display:grid; grid-template-columns:repeat(auto-fit, minmax(280px, 1fr)); gap:16px;">
        <div>
          <label class="small" style="display:block; margin-bottom:4px;">${label('ui.author.blurb_zh')}</label>
          <textarea id="m_blurbZh" class="input" rows="3" style="width:100%; resize:vertical;">${esc(zh.blurb || p.blurb || '')}</textarea>
        </div>
        <div>
          <label class="small" style="display:block; margin-bottom:4px;">${label('ui.author.blurb_en')}</label>
          <textarea id="m_blurbEn" class="input" rows="3" style="width:100%; resize:vertical;" data-i18n-placeholder="ui.author.optional_blurb_en" placeholder="${t('ui.author.optional_blurb_en')}">${esc(en.blurb || '')}</textarea>
        </div>
      </div>
    </div>
  `;
}

// Item candidates for the option form: this draft's own items plus the installed catalogue.
function itemChoices(draft) {
  const locale = getLocale();
  const rows = new Map();
  const push = def => {
    if (!def || !def.id || rows.has(def.id)) return;
    rows.set(def.id, def.localized?.[locale]?.name || def.name || def.id);
  };
  for (const gear of draft?.gear || []) push(gear);
  for (const gear of (window.__rules?.gear || [])) push(gear);
  return [...rows.entries()];
}

// Endings the required previous chapter can actually produce, so a history condition cannot
// be typed into a value the T8 validator will reject.
function endingChoices(draft, mapDef, currentValue = '') {
  const requiredStory = mapDef?.story?.requiresHistory?.storyId;
  const source = (draft?.maps || []).find(m => m?.story?.id === requiredStory) || mapDef;
  const endings = new Set();
  if (mapDef?.story?.requiresHistory?.fallback) endings.add(mapDef.story.requiresHistory.fallback);
  if (mapDef?.story?.requiresHistory) endings.add('no_history');
  for (const scene of source?.scenes || []) {
    for (const choice of scene.choices || []) {
      if (choice.ending) endings.add(choice.ending);
      if (choice.failure?.ending) endings.add(choice.failure.ending);
    }
  }
  if (currentValue) endings.add(currentValue);
  return [...endings].map(id => [id, id]);
}

function renderChapterTab(draft, mapDef, chapterNum, selectedTool = 'wall', selectedEntityId = null) {
  if (!mapDef) return `<div class="card"><p class="muted">${label('ui.author.map_missing')}</p></div>`;

  const npcs = Object.entries(mapDef.npcs || {});
  const scenes = mapDef.scenes || [];
  const reqHistory = mapDef.story?.requiresHistory;

  return `
    ${reqHistory ? `
      <div class="card" style="margin-bottom:14px; background:rgba(59,130,246,0.06); border:1px solid rgba(59,130,246,0.3);">
        <b style="color:#60a5fa;">🔗 ${label('ui.author.history_banner')}</b>
        <p class="small muted" style="margin:4px 0 0;">${label('ui.author.history_note', { storyId: reqHistory.storyId })}</p>
      </div>
    ` : ''}

    <!-- Map Grid Editor Section -->
    ${renderMapEditorSection(mapDef, chapterNum, selectedTool, selectedEntityId)}

    <!-- NPCs Section -->
    <div class="card" style="margin-bottom:18px;">
      <h3 style="margin-top:0;">👥 ${label('ui.author.npcs_header')} (${label('ui.author.chapter_n', { n: chapterNum })})</h3>
      <p class="small muted" style="margin-bottom:14px;">${label('ui.author.npcs_help')}</p>

      <div style="display:flex; flex-direction:column; gap:16px;">
        ${npcs.map(([npcId, npc]) => {
          const ent = (mapDef.entities || []).find(e => e.id === npcId && e.type === 'npc') || {};
          const nameZh = ent.localized ? (ent.localized['zh-CN']?.name || '') : (ent.name || npcId);
          const nameEn = ent.localized?.en?.name || '';
          const personaZh = npc.localized ? (npc.localized['zh-CN']?.persona || '') : (npc.persona || '');
          const personaEn = npc.localized?.en?.persona || '';
          const knowZh = npc.localized ? (npc.localized['zh-CN']?.knowledge || '') : (npc.knowledge || '');
          const knowEn = npc.localized?.en?.knowledge || '';
          const cannedZh = (npc.localized ? (npc.localized['zh-CN']?.canned || []) : (npc.canned || [])).join('\n');
          const cannedEn = (npc.localized?.en?.canned || []).join('\n');

          return `
            <div class="card" style="background:rgba(255,255,255,0.015); border:1px solid var(--border);">
              <div style="display:flex; align-items:center; gap:8px; margin-bottom:10px;">
                <span style="font-size:18px;">${esc(ent.icon || '👤')}</span>
                <b style="font-size:15px;">${esc(nameZh)}</b>
                <span class="chip small">${esc(npcId)}</span>
              </div>

              <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(260px, 1fr)); gap:12px; margin-bottom:12px;">
                <div>
                  <label class="small muted">${label('ui.author.name_zh')}</label>
                  <input type="text" class="input" data-sync-npc="${esc(npcId)}" data-field="name" data-lang="zh-CN" value="${esc(nameZh)}" style="width:100%;">
                </div>
                <div>
                  <label class="small muted">${label('ui.author.name_en')}</label>
                  <input type="text" class="input" data-sync-npc="${esc(npcId)}" data-field="name" data-lang="en" value="${esc(nameEn)}" placeholder="English Name" style="width:100%;">
                </div>
              </div>

              <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(260px, 1fr)); gap:12px; margin-bottom:12px;">
                <div>
                  <label class="small muted">${label('ui.author.persona_zh')}</label>
                  <textarea class="input" rows="2" data-sync-npc="${esc(npcId)}" data-field="persona" data-lang="zh-CN" style="width:100%; resize:vertical;">${esc(personaZh)}</textarea>
                </div>
                <div>
                  <label class="small muted">${label('ui.author.persona_en')}</label>
                  <textarea class="input" rows="2" data-sync-npc="${esc(npcId)}" data-field="persona" data-lang="en" style="width:100%; resize:vertical;" placeholder="English Persona">${esc(personaEn)}</textarea>
                </div>
              </div>

              <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(260px, 1fr)); gap:12px; margin-bottom:12px;">
                <div>
                  <label class="small muted">${label('ui.author.knowledge_zh')}</label>
                  <textarea class="input" rows="2" data-sync-npc="${esc(npcId)}" data-field="knowledge" data-lang="zh-CN" style="width:100%; resize:vertical;">${esc(knowZh)}</textarea>
                </div>
                <div>
                  <label class="small muted">${label('ui.author.knowledge_en')}</label>
                  <textarea class="input" rows="2" data-sync-npc="${esc(npcId)}" data-field="knowledge" data-lang="en" style="width:100%; resize:vertical;" placeholder="English Knowledge">${esc(knowEn)}</textarea>
                </div>
              </div>

              <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(260px, 1fr)); gap:12px;">
                <div>
                  <label class="small muted">${label('ui.author.canned_zh')}</label>
                  <textarea class="input" rows="2" data-sync-npc="${esc(npcId)}" data-field="canned" data-lang="zh-CN" style="width:100%; resize:vertical;">${esc(cannedZh)}</textarea>
                </div>
                <div>
                  <label class="small muted">${label('ui.author.canned_en')}</label>
                  <textarea class="input" rows="2" data-sync-npc="${esc(npcId)}" data-field="canned" data-lang="en" style="width:100%; resize:vertical;" placeholder="English Canned (one line each)">${esc(cannedEn)}</textarea>
                </div>
              </div>
            </div>
          `;
        }).join('')}
      </div>
    </div>

    <!-- Scenes & Choices Section -->
    <div class="card">
      <h3 style="margin-top:0;">🎭 ${label('ui.author.scenes_header')} (${label('ui.author.chapter_n', { n: chapterNum })})</h3>
      <p class="small muted" style="margin-bottom:14px;">${label('ui.author.scenes_help')}</p>

      <div style="display:flex; flex-direction:column; gap:20px;">
        ${scenes.map(scene => {
          const promptZh = scene.localized ? (scene.localized['zh-CN']?.prompt || '') : (scene.prompt || '');
          const promptEn = scene.localized?.en?.prompt || '';
          const nameZh = scene.localized ? (scene.localized['zh-CN']?.name || '') : (scene.name || '');
          const nameEn = scene.localized?.en?.name || '';
          const objZh = scene.localized ? (scene.localized['zh-CN']?.objective || '') : (scene.objective || '');
          const objEn = scene.localized?.en?.objective || '';

          return `
            <div class="card" style="background:rgba(255,255,255,0.02); border:1px solid #7c3aed33;">
              <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
                <div>
                  <b style="font-size:15px; color:#c084fc;">${esc(nameZh)}</b>
                  <span class="chip small" style="margin-left:6px;">${esc(scene.id)}</span>
                  ${scene.npcId ? `<span class="chip small">NPC: ${esc(scene.npcId)}</span>` : ''}
                  ${scene.requiresScene ? `<span class="chip small muted">${esc(t('ui.author.chip_requires'))}: ${esc(scene.requiresScene)}</span>` : ''}
                </div>
              </div>

              <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(260px, 1fr)); gap:12px; margin-bottom:8px;">
                <div>
                  <label class="small muted">${label('ui.author.name_zh')}</label>
                  <input type="text" class="input" data-sync-scene="${esc(scene.id)}" data-field="name" data-lang="zh-CN" value="${esc(nameZh)}" style="width:100%;">
                </div>
                <div>
                  <label class="small muted">${label('ui.author.name_en')}</label>
                  <input type="text" class="input" data-sync-scene="${esc(scene.id)}" data-field="name" data-lang="en" value="${esc(nameEn)}" placeholder="English Name" style="width:100%;">
                </div>
              </div>

              <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(260px, 1fr)); gap:12px; margin-bottom:12px;">
                <div>
                  <label class="small muted">${label('ui.author.prompt_zh')}</label>
                  <textarea class="input" rows="3" data-sync-scene="${esc(scene.id)}" data-field="prompt" data-lang="zh-CN" style="width:100%; resize:vertical;">${esc(promptZh)}</textarea>
                </div>
                <div>
                  <label class="small muted">${label('ui.author.prompt_en')}</label>
                  <textarea class="input" rows="3" data-sync-scene="${esc(scene.id)}" data-field="prompt" data-lang="en" style="width:100%; resize:vertical;" placeholder="English Prompt">${esc(promptEn)}</textarea>
                </div>
              </div>

              <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(260px, 1fr)); gap:12px; margin-bottom:12px;">
                <div>
                  <label class="small muted">${label('ui.author.objective_zh')}</label>
                  <input type="text" class="input" data-sync-scene="${esc(scene.id)}" data-field="objective" data-lang="zh-CN" value="${esc(objZh)}" style="width:100%;">
                </div>
                <div>
                  <label class="small muted">${label('ui.author.objective_en')}</label>
                  <input type="text" class="input" data-sync-scene="${esc(scene.id)}" data-field="objective" data-lang="en" value="${esc(objEn)}" placeholder="English Objective" style="width:100%;">
                </div>
              </div>

              <!-- Choices for this scene -->
              <div style="margin-top:12px;">
                <b class="small" style="display:block; margin-bottom:8px; color:var(--parchment);">🔘 ${label('ui.author.choices_header')} (${(scene.choices || []).length})</b>
                <div style="display:flex; flex-direction:column; gap:10px;">
                  ${(scene.choices || []).map(choice => {
                    const key = `${scene.id}:${choice.id}`;
                    const attr = field => `data-sync-choice="${esc(key)}" data-field="${field}"`;
                    const labelZh = choice.localized ? (choice.localized['zh-CN']?.label || '') : (choice.label || '');
                    const labelEn = choice.localized?.en?.label || '';
                    const respZh = choice.localized ? (choice.localized['zh-CN']?.response || '') : (choice.response || '');
                    const respEn = choice.localized?.en?.response || '';
                    const memZh = choice.localized ? (choice.localized['zh-CN']?.memory || '') : (choice.memory || '');
                    const memEn = choice.localized?.en?.memory || '';
                    const failRespZh = choice.failure?.localized ? (choice.failure.localized['zh-CN']?.response || '') : (choice.failure?.response || '');
                    const failRespEn = choice.failure?.localized?.en?.response || '';
                    const failMemZh = choice.failure?.localized ? (choice.failure.localized['zh-CN']?.memory || '') : (choice.failure?.memory || '');
                    const failMemEn = choice.failure?.localized?.en?.memory || '';
                    const condType = choice.condition?.type || 'always';
                    const effect = choice.effect || { type: 'decision' };
                    const items = itemChoices(draft);
                    const endings = endingChoices(draft, mapDef, choice.condition?.ending || '');
                    const selectBox = (field, value, options, noneKey) => `
                      <select class="input" ${attr(field)} style="width:100%;">
                        ${noneKey ? `<option value="">${esc(t(noneKey))}</option>` : ''}
                        ${options.map(([id, text]) => `<option value="${esc(id)}"${id === value ? ' selected' : ''}>${esc(text)}${id && text !== id ? ` · ${esc(id)}` : ''}</option>`).join('')}
                      </select>`;
                    const cell = (titleKey, control) => `
                      <div>
                        <label class="small muted">${label(titleKey)}</label>
                        ${control}
                      </div>`;

                    return `
                      <div class="card" style="background:rgba(0,0,0,0.2); border:1px solid var(--border); padding:10px;">
                        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px; gap:8px; flex-wrap:wrap;">
                          <div>
                            <span class="chip small">${esc(choice.id)}</span>
                            <span class="chip small muted">${esc(choice.effect?.type || 'decision')}</span>
                            ${condType !== 'always' ? `<span class="chip small blue">${esc(t('ui.author.chip_condition'))}: ${esc(condType === 'history_ending' ? String(choice.condition?.ending || '') : String(choice.condition?.itemId || ''))}</span>` : ''}
                            ${choice.ending ? `<span class="chip small gold">${esc(t('ui.author.chip_ending'))}: ${esc(choice.ending)}</span>` : ''}
                          </div>
                          <div class="small muted">
                            ${effect.type === 'check' ? esc(t('ui.author.chip_check', { skill: t(`content.skill.${effect.skill || 'persuasion'}`), dc: effect.dc ?? 10 })) : ''}
                            ${effect.costGold ? esc(t('ui.author.chip_cost', { gold: effect.costGold })) : ''}
                          </div>
                        </div>

                        <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(240px, 1fr)); gap:10px; margin-bottom:8px;">
                          ${cell('ui.author.choice_label_zh', `<input type="text" class="input" ${attr('label')} data-lang="zh-CN" value="${esc(labelZh)}" style="width:100%;">`)}
                          ${cell('ui.author.choice_label_en', `<input type="text" class="input" ${attr('label')} data-lang="en" value="${esc(labelEn)}" style="width:100%;">`)}
                        </div>

                        <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(240px, 1fr)); gap:10px; margin-bottom:8px;">
                          ${cell('ui.author.choice_response_zh', `<textarea class="input" rows="2" ${attr('response')} data-lang="zh-CN" style="width:100%; resize:vertical;">${esc(respZh)}</textarea>`)}
                          ${cell('ui.author.choice_response_en', `<textarea class="input" rows="2" ${attr('response')} data-lang="en" style="width:100%; resize:vertical;">${esc(respEn)}</textarea>`)}
                        </div>

                        <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(240px, 1fr)); gap:10px; margin-bottom:8px;">
                          ${cell('ui.author.choice_memory_zh', `<input type="text" class="input" ${attr('memory')} data-lang="zh-CN" value="${esc(memZh)}" style="width:100%;">`)}
                          ${cell('ui.author.choice_memory_en', `<input type="text" class="input" ${attr('memory')} data-lang="en" value="${esc(memEn)}" style="width:100%;">`)}
                        </div>

                        <details style="margin-bottom:8px;">
                          <summary class="small muted">${esc(t('ui.author.mechanics_summary'))}</summary>
                          <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(190px, 1fr)); gap:10px; margin-top:8px;">
                            ${cell('ui.author.effect_type', selectBox('effect_type', effect.type, [['decision', t('ui.author.effect_decision')], ['check', t('ui.author.effect_check')], ['passage', t('ui.author.effect_passage')], ['combat', t('ui.author.effect_combat')]], null))}
                            ${cell('ui.author.skill', selectBox('skill', effect.skill || '', (window.__rules?.skills || []).map(id => [id, t(`content.skill.${id}`)]), 'ui.author.choice_no_skill'))}
                            ${cell('ui.author.dc', `<input type="number" min="1" max="30" class="input" ${attr('dc')} value="${esc(effect.dc ?? '')}" style="width:100%;">`)}
                            ${cell('ui.author.cost_gold', `<input type="number" min="0" step="1" class="input" ${attr('costGold')} value="${esc(effect.costGold ?? 0)}" style="width:100%;">`)}
                            ${cell('ui.author.failure_gold', `<input type="number" min="0" step="1" class="input" ${attr('failureGold')} value="${esc(effect.failureGold ?? '')}" style="width:100%;">`)}
                            ${cell('ui.author.give_item', selectBox('giveItem', effect.giveItem || '', items, 'ui.author.choice_no_item'))}
                            ${cell('ui.author.consume_item', selectBox('consumeItem', effect.consumeItem || '', items, 'ui.author.choice_no_item'))}
                          </div>
                          <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(190px, 1fr)); gap:10px; margin-top:8px;">
                            ${cell('ui.author.condition_type', selectBox('condition_type', condType, [['always', t('ui.author.condition_always')], ['has_item', t('ui.author.condition_has_item')], ['history_ending', t('ui.author.condition_history_ending')]], null))}
                            ${cell('ui.author.condition_item', selectBox('condition_itemId', choice.condition?.itemId || '', items, 'ui.author.choice_no_item'))}
                            ${cell('ui.author.condition_ending', selectBox('condition_ending', choice.condition?.ending || '', endings, 'ui.author.choice_no_ending'))}
                            ${cell('ui.author.ending_id', `<input type="text" class="input" ${attr('ending')} value="${esc(choice.ending || '')}" style="width:100%;">`)}
                          </div>
                          <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(240px, 1fr)); gap:10px; margin-top:8px;">
                            ${cell('ui.author.failure_response_zh', `<textarea class="input" rows="2" ${attr('failure_response')} data-lang="zh-CN" style="width:100%; resize:vertical;">${esc(failRespZh)}</textarea>`)}
                            ${cell('ui.author.failure_response_en', `<textarea class="input" rows="2" ${attr('failure_response')} data-lang="en" style="width:100%; resize:vertical;">${esc(failRespEn)}</textarea>`)}
                            ${cell('ui.author.failure_memory_zh', `<input type="text" class="input" ${attr('failure_memory')} data-lang="zh-CN" value="${esc(failMemZh)}" style="width:100%;">`)}
                            ${cell('ui.author.failure_memory_en', `<input type="text" class="input" ${attr('failure_memory')} data-lang="en" value="${esc(failMemEn)}" style="width:100%;">`)}
                            ${cell('ui.author.failure_ending', `<input type="text" class="input" ${attr('failure_ending')} value="${esc(choice.failure?.ending || '')}" style="width:100%;">`)}
                          </div>
                        </details>
                      </div>
                    `;
                  }).join('')}
                </div>
              </div>
            </div>
          `;
        }).join('')}
      </div>
    </div>
  `;
}

function renderRawJsonTab(draft) {
  const jsonString = JSON.stringify(draft, null, 2);

  return `
    <div class="card">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
        <div>
          <h3 style="margin:0;">⚙️ ${label('ui.author.tab_raw')}</h3>
          <p class="small muted" style="margin:0;">${label('ui.author.raw_help')}</p>
        </div>
        <div style="display:flex; gap:8px;">
          <button class="btn small" id="rawFormatBtn">${label('ui.author.raw_format')}</button>
          <button class="btn primary small" id="rawApplyBtn">${label('ui.author.raw_apply')}</button>
        </div>
      </div>
      <textarea id="rawJsonText" class="input" style="width:100%; height:550px; font-family:monospace; font-size:12px; line-height:1.4; resize:vertical;">${esc(jsonString)}</textarea>
    </div>
  `;
}

// -------------------------------------------------------------
// T15b Grid Map Editor Helpers
// -------------------------------------------------------------
function renderMapEditorSection(mapDef, chapterNum, selectedTool = 'wall', selectedEntityId = null) {
  const conn = computeConnectivity(mapDef);

  return `
    <div class="card" style="margin-bottom:18px;">
      <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px; margin-bottom:12px;">
        <div>
          <h3 style="margin:0;">🗺️ ${label('ui.author.map_editor_title')} (${label('ui.author.chapter_n', { n: chapterNum })} · ${esc(mapDef.localized?.[getLocale()]?.name || mapDef.name || mapDef.id)})</h3>
          <p class="small muted" style="margin:4px 0 0;">${label('ui.author.map_editor_desc')}</p>
        </div>
        <div class="map-grid-actions">
          <button type="button" class="btn small" data-map-action="undo" data-chapter="${chapterNum}" data-i18n-title="ui.author.undo_help" title="${esc(t('ui.author.undo_help'))}">↩️ ${label('ui.author.undo')}</button>
          <button type="button" class="btn small" data-map-action="redo" data-chapter="${chapterNum}" data-i18n-title="ui.author.redo_help" title="${esc(t('ui.author.redo_help'))}">↪️ ${label('ui.author.redo')}</button>
          <button type="button" class="btn small" data-map-action="reset" data-chapter="${chapterNum}">🔄 ${label('ui.author.reset_map')}</button>
          <button type="button" class="btn small primary" data-map-action="playtest" data-chapter="${chapterNum}" style="background:linear-gradient(180deg, #6d28d9, #4c1d95); border-color:#8b5cf6;">🎮 ${label('ui.author.playtest_map')}</button>
        </div>
      </div>

      <!-- Palette Tools -->
      <div class="map-grid-toolbar" style="margin-bottom:10px;">
        <div style="display:flex; align-items:center; gap:8px;">
          <span class="small muted"><b>${label('ui.author.tool_label')}:</b></span>
          <div class="map-grid-tools">
            <button type="button" class="btn small map-grid-tool-btn ${selectedTool === 'wall' ? 'active' : ''}" data-tool="wall" data-chapter="${chapterNum}">🧱 ${label('ui.author.tool_wall')}</button>
            <button type="button" class="btn small map-grid-tool-btn ${selectedTool === 'floor' ? 'active' : ''}" data-tool="floor" data-chapter="${chapterNum}">· ${label('ui.author.tool_floor')}</button>
            <button type="button" class="btn small map-grid-tool-btn ${selectedTool === 'door' ? 'active' : ''}" data-tool="door" data-chapter="${chapterNum}">🚪 ${label('ui.author.tool_door')}</button>
            <button type="button" class="btn small map-grid-tool-btn ${selectedTool === 'player' ? 'active' : ''}" data-tool="player" data-chapter="${chapterNum}">🚶 ${label('ui.author.tool_player')}</button>
            <button type="button" class="btn small map-grid-tool-btn ${selectedTool === 'campfire' ? 'active' : ''}" data-tool="campfire" data-chapter="${chapterNum}">🔥 ${label('ui.author.tool_campfire')}</button>
            <button type="button" class="btn small map-grid-tool-btn ${selectedTool === 'select' ? 'active' : ''}" data-tool="select" data-chapter="${chapterNum}">🧭 ${label('ui.author.tool_move_entity')}</button>
            <button type="button" class="btn small map-grid-tool-btn ${selectedTool === 'erase' ? 'active' : ''}" data-tool="erase" data-chapter="${chapterNum}">🗑️ ${label('ui.author.tool_erase')}</button>
          </div>
        </div>
        <div id="mapConnectivityBadge_${chapterNum}" class="small" style="padding:4px 8px; border-radius:4px; ${conn.ok ? 'background:rgba(34,197,94,0.1); color:#4ade80; border:1px solid rgba(34,197,94,0.3);' : 'background:rgba(239,68,68,0.1); color:#f87171; border:1px solid rgba(239,68,68,0.3);'}">
          ${`${conn.ok ? '✅' : '⚠️'} ${t(conn.key, conn.params || {})}`}
        </div>
      </div>

      <!-- Movable Entities Quick Selector -->
      <div class="map-grid-entities-bar" data-chapter="${chapterNum}" style="margin-bottom:10px;">
        ${renderEntityChipsHtml(mapDef, chapterNum, selectedEntityId)}
      </div>

      <!-- Grid Map Container -->
      <div class="map-grid-scroll-wrap">
        <div id="mapGridContainer_${chapterNum}" class="map-grid-container" data-chapter="${chapterNum}">
          ${renderGridCells(mapDef, selectedEntityId)}
        </div>
      </div>
    </div>
  `;
}

function renderEntityChipsHtml(mapDef, chapterNum, selectedEntityId) {
  const locale = getLocale();
  const chips = (mapDef.entities || []).map(ent => {
    // Entity names follow the language the author is working in, not a hardcoded zh-CN read.
    const name = ent.localized?.[locale]?.name || ent.name || ent.id;
    const icon = ent.icon || (ent.type === 'npc' ? '👤' : (ent.type === 'door' ? '🚪' : (ent.type === 'chest' ? '📦' : '👾')));
    const isSelected = selectedEntityId === ent.id;
    return `
      <button type="button" class="chip btn small map-entity-chip ${isSelected ? 'selected' : ''}" data-entity-chip="${esc(ent.id)}" data-chapter="${chapterNum}">
        ${esc(icon)} ${esc(name)} <span class="muted" style="font-size:10px;">(${ent.x},${ent.y})</span>
      </button>
    `;
  }).join('');

  return `<span class="small muted"><b>${label('ui.author.tool_move_entity')}:</b></span>${chips}`;
}

function renderGridCells(mapDef, selectedEntityId) {
  const width = mapDef.width || 25;
  const height = mapDef.height || 15;
  const cells = [];

  for (let y = 0; y < height; y++) {
    const row = mapDef.rows[y] || '';
    for (let x = 0; x < width; x++) {
      const ch = row[x] || '#';
      const ent = (mapDef.entities || []).find(e => e.x === x && e.y === y);
      const isCampfire = (mapDef.victory?.campfire?.x === x && mapDef.victory?.campfire?.y === y) || ent?.id === 'campfire';
      const isStart = mapDef.playerStart?.x === x && mapDef.playerStart?.y === y;
      const isSelected = selectedEntityId && ent?.id === selectedEntityId;

      let cls = 'map-grid-cell';
      if (ch === '#') cls += ' cell-wall';
      else if (ch === 'D') cls += ' cell-door';
      else cls += ' cell-floor';

      if (isCampfire) cls += ' cell-campfire';
      if (isStart) cls += ' cell-start';
      if (ent && ent.id !== 'campfire') cls += ' cell-entity';
      if (isSelected) cls += ' cell-selected';

      let text = '·';
      if (isCampfire) {
        text = '🔥';
      } else if (ent) {
        text = ent.icon || (ent.type === 'npc' ? '👤' : (ent.type === 'monster' ? '👾' : (ent.type === 'chest' ? '📦' : (ent.type === 'door' ? '🚪' : '📍'))));
      } else if (isStart) {
        text = '🚶';
      } else if (ch === '#') {
        text = '#';
      } else if (ch === 'D') {
        text = '🚪';
      } else {
        text = '·';
      }

      cells.push(`<div class="${cls}" data-x="${x}" data-y="${y}" title="(${x}, ${y}) ${esc(ch)}">${esc(text)}</div>`);
    }
  }

  return cells.join('');
}

// Returns a translation key + params, so the badge can stay live when the language changes.
function computeConnectivity(mapDef) {
  if (!mapDef || !mapDef.rows || !mapDef.playerStart) {
    return { ok: true, key: 'ui.author.conn_ready', params: {}, unreachable: [] };
  }
  const width = mapDef.width || mapDef.rows[0]?.length || 25;
  const height = mapDef.height || mapDef.rows.length || 15;
  const start = mapDef.playerStart;

  if (start.x < 0 || start.x >= width || start.y < 0 || start.y >= height || mapDef.rows[start.y]?.[start.x] === '#') {
    return { ok: false, key: 'ui.author.conn_start_wall', params: {}, unreachable: ['playerStart'] };
  }

  const seen = new Set();
  const queue = [{ x: start.x, y: start.y }];
  while (queue.length > 0) {
    const pos = queue.shift();
    if (!pos) continue;
    const key = pos.x + ',' + pos.y;
    if (seen.has(key)) continue;
    seen.add(key);

    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = pos.x + dx;
      const ny = pos.y + dy;
      if (nx >= 0 && nx < width && ny >= 0 && ny < height && mapDef.rows[ny]?.[nx] !== '#' && !seen.has(nx + ',' + ny)) {
        queue.push({ x: nx, y: ny });
      }
    }
  }

  const unreachable = [];
  const camp = mapDef.victory?.campfire;
  if (camp && !seen.has(camp.x + ',' + camp.y)) {
    unreachable.push('campfire');
  }

  (mapDef.entities || []).forEach(e => {
    if (e.id === 'campfire' || e.type === 'npc' || e.type === 'monster' || e.type === 'chest') {
      const isReachable = seen.has(e.x + ',' + e.y) || [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => seen.has((e.x + dx) + ',' + (e.y + dy)));
      if (!isReachable) {
        unreachable.push(e.id);
      }
    }
  });

  if (unreachable.length > 0) {
    return {
      ok: false,
      key: 'ui.author.conn_unreachable',
      params: { nodes: unreachable.join(', ') },
      unreachable
    };
  }
  return { ok: true, key: 'ui.author.conn_ok', params: {}, unreachable: [] };
}

function getSnapshot(mapDef) {
  return JSON.stringify({
    rows: [...mapDef.rows],
    playerStart: { ...mapDef.playerStart },
    victoryCampfire: mapDef.victory?.campfire ? { ...mapDef.victory.campfire } : null,
    entities: JSON.parse(JSON.stringify(mapDef.entities || []))
  });
}

function applySnapshot(mapDef, snapStr) {
  if (!snapStr) return;
  const data = JSON.parse(snapStr);
  mapDef.rows = data.rows;
  mapDef.playerStart = data.playerStart;
  if (data.victoryCampfire) {
    mapDef.victory = mapDef.victory || { type: 'story' };
    mapDef.victory.campfire = data.victoryCampfire;
  }
  mapDef.entities = data.entities;
}
