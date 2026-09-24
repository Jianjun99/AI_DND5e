// campaign.js (view) — the main story panel: four acts, progress, and the epilogue once the
// Ember Queen is dead. Reached from the region-map banner or the Hall of Heroes.
import { api } from '../api.js';
import { esc, toast, loadRules } from '../app.js';
import { sfx } from '../sfx.js';

export async function campaignView(main, charId) {
  const chars = await api.listCharacters();
  if (!chars.length) {
    main.innerHTML = `<div class="card" style="max-width:600px; margin:40px auto; text-align:center; padding:32px;">
      <h1>🏰 No Heroes Found</h1>
      <p class="muted" style="margin:16px 0;">Create a hero before setting out on the main story.</p>
      <a class="btn primary big" href="#/create">✨ Create Your First Hero</a>
    </div>`;
    return;
  }
  const hero = chars.find(c => c.id === charId) || chars[0];
  await loadRules();

  let data = null;
  try {
    data = await api.campaign(hero.id);
  } catch (err) {
    toast('无法读取主线进度');
  }
  if (!data) {
    main.innerHTML = `<p class="muted" style="padding:30px; text-align:center;">主线进度读取失败。</p>`;
    return;
  }

  const c = data.campaign || {};
  const acts = data.acts || [];
  const done = !!c.completedAt;
  if (done) sfx.play('victory');

  main.innerHTML = `
    <p><a href="#/overworld?char=${hero.id}">← 回到瓦尔谷</a></p>

    <div class="card campaign-hero ${done ? 'campaign-done' : ''}">
      <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:12px; flex-wrap:wrap;">
        <div>
          <h1 style="margin:0 0 4px;">📜 主线 · ${done ? '烬后之陨' : '瓦尔谷的裂痕'}</h1>
          <p class="sub" style="margin:0;">${esc(hero.name)} · 等级 ${esc(hero.level)} · ${esc(hero.className)}</p>
        </div>
        <span class="chip gold-chip" style="font-size:13px;">${esc(data.progress?.label || '')}</span>
      </div>
      <p class="small" style="margin:12px 0 0; color:var(--gold);">${esc(data.objective?.text || '')}</p>
    </div>

    <div class="campaign-acts">
      ${acts.map((a, idx) => `
        <div class="card campaign-act ${a.done ? 'done' : ''}">
          <div style="display:flex; justify-content:space-between; align-items:baseline; gap:8px;">
            <h3 style="margin:0;">${a.icon} ${esc(a.name)}</h3>
            <span class="chip ${a.done ? 'green' : ''}" style="font-size:11px;">${a.done ? '✔ 完成' : '进行中'}</span>
          </div>
          <p class="muted small" style="margin:6px 0;">${esc(a.mapName)} · 奖励 ${a.reward?.xp || 0} XP / ${a.reward?.gold || 0} gp</p>
          <p class="small" style="margin:0 0 6px;">${esc(a.objective)}</p>
          ${a.clues ? `
            <div style="display:flex; gap:6px; flex-wrap:wrap; margin-bottom:6px;">
              ${a.clues.map(cl => `<span class="chip ${cl.done ? 'green' : ''}" style="font-size:11px;">${cl.done ? '✔' : '○'} ${esc(cl.name)}</span>`).join('')}
            </div>` : ''}
          ${a.done ? `<p class="muted small" style="margin:0; font-style:italic;">${esc(a.blurb)}</p>` : ''}
        </div>
        ${idx < acts.length - 1 ? '<div class="campaign-arrow-vert">↓</div>' : ''}
      `).join('')}
    </div>

    ${done ? `
      <div class="card epilogue-card">
        <h2 style="margin-top:0;">🕯️ 收场词</h2>
        <p style="font-size:15px; line-height:1.75; white-space:pre-wrap;">${esc(data.epilogue || '')}</p>
        <div class="epilogue-stats">
          <div><span class="muted small">等级</span><b>${esc(data.stats?.level)}</b></div>
          <div><span class="muted small">累计击杀</span><b>${esc(data.stats?.kills)}</b></div>
          <div><span class="muted small">完成地牢</span><b>${esc(data.stats?.delves)}</b></div>
          <div><span class="muted small">金币</span><b>${esc(data.stats?.gold)}</b></div>
          <div><span class="muted small">图鉴收录</span><b>${esc(data.stats?.trophies)}</b></div>
        </div>
        <div style="display:flex; gap:8px; flex-wrap:wrap; margin-top:14px;">
          <a class="btn primary" href="#/overworld?char=${hero.id}">继续游玩（无尽深渊仍开放）</a>
          <a class="btn" href="#/overworld?char=${hero.id}">🗺️ 回到大地图</a>
          <a class="btn" href="#/character/${hero.id}">📜 角色卡</a>
        </div>
        <p class="muted small" style="margin-top:10px;">主线结束了，但地牢还在：无尽深渊、所有地图与图鉴收集都不受影响。</p>
      </div>
    ` : `
      <div class="card" style="margin-top:14px;">
        <h3 style="margin-top:0;">🎬 进度记录</h3>
        ${(data.log || []).length ? `
          <div style="display:flex; flex-direction:column; gap:8px;">
            ${data.log.slice().reverse().map(l => `
              <div class="campaign-log-entry">
                <span class="chip gold-chip" style="font-size:11px;">第 ${l.act} 幕</span>
                <span class="small">${esc(l.text)}</span>
              </div>`).join('')}
          </div>` : '<p class="muted small">还没有进展。从沉没墓穴的圣物开始吧。</p>'}
      </div>
    `}
  `;
}
