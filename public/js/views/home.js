// home.js — character portal: list characters, create, resume delves
import { api } from '../api.js';
import { esc, toast, navigate } from '../app.js';

export async function homeView(main) {
  const [chars, saves] = await Promise.all([api.listCharacters(), api.listSaves()]);
  const savesByChar = {};
  saves.forEach(s => { savesByChar[s.characterId] = s; });

  main.innerHTML = `
    <div class="hero">
      <h1>AI Dungeon</h1>
      <p>A solo D&D (2024 rules) delve into <b>The Sunless Crypt</b>. Create a hero, brave the dark,
      and — if you like — let your own local LLM breathe life into the Dungeon Master's voice.
      Everything runs on your machine.</p>
    </div>
    <div style="display:flex; justify-content:space-between; align-items:center; margin: 18px 0 10px;">
      <h2 style="margin:0;">Your Heroes</h2>
      <a class="btn primary" href="#/create">＋ Create Character</a>
    </div>
    ${chars.length ? `<div class="grid cols3">${chars.map(c => charCard(c, savesByChar[c.id])).join('')}</div>`
      : `<div class="card" style="text-align:center; padding:40px;">
           <p class="muted">No heroes yet. Every legend starts with a character sheet.</p>
           <p style="margin-top:14px;"><a class="btn primary big" href="#/create">Create your first hero</a></p>
         </div>`}
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
  main.querySelectorAll('[data-del]').forEach(btn => btn.addEventListener('click', async e => {
    e.stopPropagation();
    if (!confirm('Delete this hero permanently?')) return;
    await api.deleteCharacter(btn.dataset.del);
    toast('Hero deleted.');
    navigate();
  }));
}

function charCard(c, save) {
  const cls = (window.__rules?.classes || []).find(x => x.id === c.className);
  const sp = (window.__rules?.species || []).find(x => x.id === c.species);
  const clsName = cls ? cls.name : c.className;
  const spName = sp ? sp.name : c.species;
  return `
    <div class="card char-card">
      <div class="name">${esc(c.name)}</div>
      <div class="meta">Level ${c.level} ${esc(spName)} ${esc(clsName)}</div>
      <div class="stats">
        <span><b>${c.hpMax}</b> HP</span>
        <span><b>${c.acBase}</b> AC</span>
        <span><b>${c.xp}</b> XP</span>
        <span><b>${c.gold ?? 50}</b> gp</span>
      </div>
      ${save ? `<div class="meta">Active delve — last played ${new Date(save.updatedAt).toLocaleString()}</div>` : ''}
      <div class="actions">
        <a class="btn primary" href="#/play/${save ? save.id : 'new?char=' + c.id}">${save ? '⚔ Resume' : '⚔ Begin Delve'}</a>
        <a class="btn" href="#/character/${c.id}">Sheet</a>
        <button class="btn danger small" data-del="${c.id}">Delete</button>
      </div>
    </div>`;
}
