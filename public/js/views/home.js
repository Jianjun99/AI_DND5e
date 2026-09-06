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
  `;

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
