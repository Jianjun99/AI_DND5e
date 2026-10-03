// home.js — character portal: list characters, create, resume delves, packs, backup
import { esc, toast, navigate } from '../app.js';
import { api } from '../api.js';

export async function homeView(main) {
  const [chars, saves] = await Promise.all([apiListCharacters(), apiListSaves()]);
  const savesByChar = {};
  saves.forEach(s => { (savesByChar[s.characterId] = savesByChar[s.characterId] || []).push(s); });
  Object.values(savesByChar).forEach(list => list.sort((a, b) => b.updatedAt - a.updatedAt));

  const presetList = (window.__rules && window.__rules.presets) || [];
  main.innerHTML = `
    <div class="hero">
      <h1>AI Dungeon</h1>
      <p>A solo D&D (2024 rules) delve into <b>The Sunless Crypt</b> — and beyond. Create a hero, brave the dark,
      and let your own LLM breathe life into the Dungeon Master's voice. Everything runs on your machine.</p>
    </div>
    <div style="display:flex; justify-content:space-between; align-items:center; margin: 18px 0 10px;">
      <h2 style="margin:0;">Your Heroes</h2>
      <a class="btn primary" href="#/create">＋ Create Character</a>
    </div>
    ${chars.length ? `<div class="grid cols3">${chars.map(c => charCard(c, savesByChar[c.id] || [])).join('')}</div>`
      : ''}
    ${presetList.length ? quickStartHtml(presetList, chars.length === 0) : ''}
    ${!chars.length && !presetList.length ? `
      <div class="card" style="text-align:center; padding:40px;">
        <p class="muted">No heroes yet. Every legend starts with a character sheet.</p>
        <p style="margin-top:14px;"><a class="btn primary big" href="#/create">Create your first hero</a></p>
      </div>` : ''}

    <div class="card" style="margin-top:18px;">
      <h3>🧩 Content Packs</h3>
      <p class="small muted" style="margin-bottom:10px;">Add community-made dungeons and monsters — import a pack file, or <a href="https://github.com/Jianjun99/AI_DND5e/blob/main/MODDING.md" target="_blank">write your own</a>.</p>
      <div id="packList" class="small" style="margin-bottom:10px;"></div>
      <div style="display:flex; gap:8px;">
        <button class="btn" id="packImportBtn">⬆ Import pack</button>
        <input type="file" id="packFile" hidden accept=".json,application/json">
      </div>
    </div>

    <div class="card" style="margin-top:18px;">
      <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px;">
        <div>
          <h3 style="margin-bottom:2px;">💾 Backup & Restore</h3>
          <p class="small muted" style="margin:0;">Download all heroes, delves and settings as one file — or restore from a backup. Your data lives only on this machine.</p>
        </div>
        <div style="display:flex; gap:8px;">
          <button class="btn" id="exportBtn">⬇ Export everything</button>
          <button class="btn" id="importBtn">⬆ Import backup</button>
          <input type="file" id="importFile" hidden accept=".json,application/json">
        </div>
      </div>
    </div>
  `;

  async function apiListCharacters() { return (await fetch('/api/characters')).json(); }
  async function apiListSaves() { return (await fetch('/api/game')).json(); }

  // ---- T5 quick start: pick a server-defined preset, name it, head to the prepare page ----
  let selectedPreset = presetList[0] ? presetList[0].id : null;
  const nameInput = /** @type {HTMLInputElement | null} */ (document.getElementById('quickName'));
  main.querySelectorAll('[data-preset]').forEach(el => el.addEventListener('click', () => {
    selectedPreset = el.getAttribute('data-preset');
    main.querySelectorAll('[data-preset]').forEach(t => t.classList.toggle('selected', t === el));
    // follow the preset's default name unless the player already typed their own
    if (nameInput && (!nameInput.value.trim() || presetList.some(p => p.defaultName === nameInput.value.trim()))) {
      const p = presetList.find(x => x.id === selectedPreset);
      if (p) nameInput.value = p.defaultName;
    }
  }));
  if (nameInput && !nameInput.value) {
    const p = presetList.find(x => x.id === selectedPreset);
    if (p) nameInput.value = p.defaultName;
  }
  const quickBtn = /** @type {HTMLButtonElement | null} */ (document.getElementById('quickStartBtn'));
  if (quickBtn) quickBtn.addEventListener('click', async () => {
    const preset = presetList.find(p => p.id === selectedPreset);
    if (!preset) return;
    quickBtn.disabled = true;
    quickBtn.textContent = '正在铸造英雄…';
    try {
      const char = await api.createCharacter({
        presetId: preset.id,
        name: nameInput ? nameInput.value.trim() : ''
      });
      toast(`${char.name} 已就绪！`);
      // straight to the SAME prepare entrance the guidance uses — the player still picks
      // difficulty / companion and presses Embark there (never auto-embark)
      const primary = char.guidance && char.guidance.primary;
      const node = primary && primary.kind === 'prepare' && primary.mapId ? '&node=' + encodeURIComponent(primary.mapId) : '';
      location.hash = `#/overworld?char=${char.id}${node}`;
    } catch (e) {
      toast(e.message);
      quickBtn.disabled = false;
      quickBtn.textContent = '创建并准备出发 ⚔';
    }
  });

  main.querySelectorAll('[data-delsave]').forEach(btn => btn.addEventListener('click', async e => {
    e.stopPropagation();
    if (!confirm('Abandon this delve? Its progress will be lost.')) return;
    await fetch('/api/game/' + btn.dataset.delsave, { method: 'DELETE' });
    toast('Delve abandoned.');
    navigate();
  }));
  main.querySelectorAll('[data-del]').forEach(btn => btn.addEventListener('click', async e => {
    e.stopPropagation();
    if (!confirm('Delete this hero permanently? (Their delves are kept.)')) return;
    await fetch('/api/characters/' + btn.dataset.del, { method: 'DELETE' });
    toast('Hero deleted.');
    navigate();
  }));

  // content packs
  (async () => {
    try {
      const c = await (await fetch('/api/content')).json();
      const list = document.getElementById('packList');
      if (!list) return;
      list.innerHTML = c.packs.map(p => `
        <div class="stat-line">
          <span><b>${esc(p.name)}</b> <span class="muted">by ${esc(p.author)}</span>
            <span class="muted small">— ${p.maps.length} map(s), ${p.monsters.length} monster(s)${p.gear.length ? ', ' + p.gear.length + ' item(s)' : ''}</span></span>
          <span>${p.id !== 'core' ? `<button class="btn small" data-packexport="${esc(p.id)}">⬇ Export</button>` : '<span class="chip">built-in</span>'}</span>
        </div>`).join('');
      if (c.warnings && c.warnings.length) {
        list.innerHTML += `<p class="small" style="color:#d98a80;">⚠ ${esc(c.warnings.join(' · '))}</p>`;
      }
      list.querySelectorAll('[data-packexport]').forEach(/** @param {HTMLButtonElement} b */ b => b.addEventListener('click', async () => {
        const blob = await (await fetch(`/api/content/pack/${b.dataset.packexport}/export`)).blob();
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `${b.dataset.packexport}.json`;
        a.click();
        URL.revokeObjectURL(a.href);
      }));
    } catch {}
  })();

  document.getElementById('packImportBtn').addEventListener('click', () => document.getElementById('packFile').click());
  document.getElementById('packFile').addEventListener('change', async e => {
    const file = /** @type {HTMLInputElement} */ (e.target).files[0];
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      const res = await fetch('/api/content/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
      const out = await res.json();
      if (!res.ok) throw new Error(out.error || 'Import failed');
      toast(`Pack "${out.pack.name}" imported: ${out.pack.maps.length} map(s), ${out.pack.monsters.length} monster(s).`);
      navigate();
    } catch (err) {
      toast(err.message);
    }
  });

  document.getElementById('exportBtn').addEventListener('click', async () => {
    const data = await (await fetch('/api/data/export')).json();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `ai-dnd-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    toast('Backup downloaded.');
  });
  document.getElementById('importBtn').addEventListener('click', () => document.getElementById('importFile').click());
  document.getElementById('importFile').addEventListener('change', async e => {
    const file = /** @type {HTMLInputElement} */ (e.target).files[0];
    if (!file) return;
    if (!confirm('Importing replaces ALL current heroes, delves and settings with the backup. Continue?')) return;
    try {
      const data = JSON.parse(await file.text());
      const res = await fetch('/api/data/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
      const out = await res.json();
      if (!res.ok) throw new Error(out.error || 'Import failed');
      toast(`Imported ${out.imported.characters} heroes and ${out.imported.saves} delves.`);
      navigate();
    } catch (err) {
      toast(err.message);
    }
  });
}

// T5 quick start: presets are server data (window.__rules.presets) — this only renders the
// cards and sends { presetId, name }. The build happens server-side via engine.buildCharacter.
function quickStartHtml(presets, prominent) {
  return `
    <div class="card quick-start${prominent ? ' prominent' : ''}" id="quickStartCard" style="margin-top:18px;">
      <div style="display:flex; justify-content:space-between; align-items:baseline; flex-wrap:wrap; gap:8px;">
        <h3 style="margin:0;">${prominent ? '⚡ 快速开始——选一名现成英雄，马上出发' : '⚡ 快速创建新英雄'}</h3>
        <a class="small" href="#/create">想要完整自定义？进入七步创建 →</a>
      </div>
      <div class="quick-start-grid">
        ${presets.map(p => `
          <div class="card selectable preset-tile ${p.id === presets[0].id ? 'selected' : ''}" data-preset="${esc(p.id)}">
            <div class="preset-head"><b>${esc(p.label)}</b><span class="chip gold-chip">${esc(p.tagline)}</span></div>
            <p class="small muted" style="margin:6px 0;">${esc(p.blurb)}</p>
            <ul class="trait-list">${p.tips.map(t => `<li>${esc(t)}</li>`).join('')}</ul>
            <div class="small muted">默认名字：${esc(p.defaultName)}（可改名）</div>
          </div>`).join('')}
      </div>
      <div class="quick-start-bar">
        <input type="text" id="quickName" maxlength="40" placeholder="英雄名字（留空用默认名）">
        <button class="btn primary" id="quickStartBtn">创建并准备出发 ⚔</button>
      </div>
      <p class="muted small" style="margin:8px 0 0;">创建后直达主线准备页——出发前仍可选择地图、难度与同伴。</p>
    </div>`;
}

function charCard(c, saveList) {
  const rules = window.__rules || {};
  const cls = (rules.classes || []).find(x => x.id === c.className);
  const sp = (rules.species || []).find(x => x.id === c.species);
  const clsName = cls ? cls.name : c.className;
  const spName = sp ? sp.name : c.species;
  const slots = saveList.slice(0, 3);
  const g = c.guidance || null;
  const primaryHref = guidanceHref(c, g && g.primary);
  return `
    <div class="card char-card">
      <div style="display:flex; gap:12px; align-items:center; margin-bottom:8px;">
        <img src="${c.portraitUrl || '/portraits/hero_' + c.id + '.svg'}"
             alt="Hero"
             style="width:48px; height:56px; object-fit:cover; border-radius:6px; border:1.5px solid var(--border); background:#15120e; flex-shrink:0;"
             onerror="this.src='/portraits/hero_${c.id}.svg'">
        <div style="min-width:0; flex:1;">
          <div class="name" style="margin:0 0 2px;">${esc(c.name)}</div>
          <div class="meta">Level ${c.level} ${esc(spName)} ${esc(clsName)} · ${c.xp} XP</div>
        </div>
      </div>
      ${g ? `
      <div class="char-guidance">
        <div class="small"><span class="chip gold-chip" title="主线进度">📜 ${esc(g.label || '')}</span>
          <span class="char-objective">🎯 ${esc((g.objective && g.objective.text) || '')}</span></div>
        <a class="btn primary" style="width:100%; margin-top:8px;" href="${primaryHref}">${esc(g.primary ? g.primary.text : '继续冒险')}</a>
        ${g.primary && g.primary.reason ? `<p class="muted small" style="margin:4px 0 0;">${esc(g.primary.reason)}</p>` : ''}
      </div>` : ''}
      <div class="stats">
        <span><b>${c.hpMax}</b> HP</span>
        <span><b>${c.acBase}</b> AC</span>
        <span><b>${c.gold ?? 50}</b> gp</span>
      </div>
      ${slots.length ? slots.map(sv => {
        const st = saveStatus(sv);
        return `
        <div class="stat-line" style="align-items:center;">
          <span class="muted small">${esc(sv.mapName)} · ${new Date(sv.updatedAt).toLocaleDateString()} <span class="chip ${st.cls}" style="font-size:10px; padding:0 6px;">${st.text}</span></span>
          <span style="display:flex; gap:4px;">
            <a class="btn small primary" href="#/play/${sv.id}" title="${st.title}">⚔</a>
            <button class="btn danger small" data-delsave="${sv.id}" title="Abandon delve">✕</button>
          </span>
        </div>`; }).join('') : ''}
        ${saveList.length > 3 ? `<div class="meta small muted">+ ${saveList.length - 3} older delve(s)</div>` : ''}
      ${g && (g.options || []).length ? `
      <div class="char-options">${g.options.map(o => `<a class="btn small" href="${guidanceHref(c, o)}" title="${esc(o.reason || '')}">${esc(o.text)}</a>`).join('')}</div>` : ''}
      <div class="actions">
        <a class="btn" href="#/overworld?char=${c.id}">🗺️ Region Map</a>
        <a class="btn" href="#/character/${c.id}">Sheet</a>
        <button class="btn danger small" data-del="${c.id}">Delete</button>
      </div>
    </div>`;
}

// Guidance actions are server data — this only maps them to hash routes.
function guidanceHref(c, action) {
  if (!action) return `#/overworld?char=${c.id}`;
  if (action.kind === 'resume' && action.saveId) return `#/play/${action.saveId}`;
  if (action.kind === 'campaign') return `#/campaign/${c.id}`;
  if (action.mapId) return `#/overworld?char=${c.id}&node=${encodeURIComponent(action.mapId)}`;
  return `#/overworld?char=${c.id}`;
}

// A delve save's state chip on the character card: running / ended-unsettled / settled.
function saveStatus(s) {
  const ended = s.mode === 'victory' || s.mode === 'retreat' || s.mode === 'over';
  if (ended && !s.settled) return { text: '待结算', cls: 'gold-chip', title: '这一局的收获还没结算——打开完成结算' };
  if (ended) return { text: '已结算', cls: 'green', title: '已完成并结算，只是可以回看' };
  return { text: '进行中', cls: 'blue', title: '进行中的地牢——从原地继续' };
}
