// home.js — character portal: list characters, create, resume delves, packs, backup
import { esc, toast, navigate } from '../app.js';

export async function homeView(main) {
  const [chars, saves] = await Promise.all([apiListCharacters(), apiListSaves()]);
  const savesByChar = {};
  saves.forEach(s => { (savesByChar[s.characterId] = savesByChar[s.characterId] || []).push(s); });
  Object.values(savesByChar).forEach(list => list.sort((a, b) => b.updatedAt - a.updatedAt));

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
      : `<div class="card" style="text-align:center; padding:40px;">
           <p class="muted">No heroes yet. Every legend starts with a character sheet.</p>
           <p style="margin-top:14px;"><a class="btn primary big" href="#/create">Create your first hero</a></p>
         </div>`}

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
      list.querySelectorAll('[data-packexport]').forEach(b => b.addEventListener('click', async () => {
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
    const file = e.target.files[0];
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
    const file = e.target.files[0];
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

function charCard(c, saveList) {
  const rules = window.__rules || {};
  const cls = (rules.classes || []).find(x => x.id === c.className);
  const sp = (rules.species || []).find(x => x.id === c.species);
  const clsName = cls ? cls.name : c.className;
  const spName = sp ? sp.name : c.species;
  const slots = saveList.slice(0, 3);
  return `
    <div class="card char-card">
      <div class="name">${esc(c.name)}</div>
      <div class="meta">Level ${c.level} ${esc(spName)} ${esc(clsName)} · ${c.xp} XP · ${c.gold ?? 50} gp</div>
      <div class="stats">
        <span><b>${c.hpMax}</b> HP</span>
        <span><b>${c.acBase}</b> AC</span>
      </div>
      ${slots.length ? slots.map(sv => `
        <div class="stat-line" style="align-items:center;">
          <span class="muted small">${esc(sv.mapName)} · ${new Date(sv.updatedAt).toLocaleDateString()}</span>
          <span style="display:flex; gap:4px;">
            <a class="btn small primary" href="#/play/${sv.id}" title="Resume delve">⚔</a>
            <button class="btn danger small" data-delsave="${sv.id}" title="Abandon delve">✕</button>
          </span>
        </div>`).join('') : ''}
        ${saveList.length > 3 ? `<div class="meta small muted">+ ${saveList.length - 3} older delve(s)</div>` : ''}
      <div class="actions">
        <a class="btn" href="#/play/new?char=${c.id}">⚔ New Delve</a>
        <a class="btn" href="#/character/${c.id}">Sheet</a>
        <button class="btn danger small" data-del="${c.id}">Delete</button>
      </div>
    </div>`;
}
