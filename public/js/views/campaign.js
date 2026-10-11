import { contentLabel,  t, label, translateDOM, onLocaleChange, displayLabel } from "../i18n.js";
// campaign.js (view) — the main story panel: four acts, progress, and the epilogue once the
// Ember Queen is dead. Reached from the region-map banner or the Hall of Heroes.
import { api } from '../api.js';
import { esc, toast, loadRules } from '../app.js';
import { sfx } from '../sfx.js';

/** @param {import('../navigation.js').Navigation} navigation */
export async function campaignView(main, charId, navigation) {
  const chars = await api.listCharacters();
  if (!navigation.isCurrent()) return undefined;
  if (!chars.length) {
    main.innerHTML = `<div class="card" style="max-width:600px; margin:40px auto; text-align:center; padding:32px;">
      <h1>${label("ui.campaign.no_heroes_found")}</h1>
      <p class="muted" style="margin:16px 0;">${label("ui.campaign.create_a_hero_before_setting_out_on")}</p>
      <a class="btn primary big" href="#/create">${label("ui.campaign.create_your_first_hero")}</a>
    </div>`;
    return navigation.onDispose(onLocaleChange(() => translateDOM(main)));
  }
  const hero = chars.find(c => c.id === charId) || chars[0];
  await loadRules();
  if (!navigation.isCurrent()) return undefined;

  let data = null;
  try {
    data = await api.campaign(hero.id);
  } catch (err) {
    if (!navigation.isCurrent()) return undefined;
    toast(() => t("ui.campaign.unable_to_read_story_progress"));
  }
  if (!navigation.isCurrent()) return undefined;
  if (!data) {
    main.innerHTML = `<p class="muted" style="padding:30px; text-align:center;">${label("ui.campaign.story_progress_could_not_be_loaded")}</p>`;
    return navigation.onDispose(onLocaleChange(() => translateDOM(main)));
  }

  const c = data.campaign || {};
  const acts = data.acts || [];
  const done = !!c.completedAt;
  if (done) sfx.play('victory');

  main.innerHTML = `
    <p><a href="#/overworld?char=${hero.id}">${label("ui.campaign.back_to_the_vale")}</a></p>

    <div class="card campaign-hero ${done ? 'campaign-done' : ''}">
      <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:12px; flex-wrap:wrap;">
        <div>
          <h1 style="margin:0 0 4px;">${label("ui.overworld.story")}${label(done ? 'content.campaign.titleDone' : 'content.campaign.titleActive')}</h1>
          <p class="sub" style="margin:0;">${label("ui.campaign.level_values", {p4: (hero.nameDisplay || hero.name), p5: hero.level, p6: (hero.classNameDisplay || hero.className)})}</p>
        </div>
        <span class="chip gold-chip" style="font-size:13px;">${displayLabel(data.progress?.labelDisplay, data.progress?.label || '')}</span>
      </div>
      <p class="small" style="margin:12px 0 0; color:var(--gold);">${displayLabel(data.objective.textDisplay,data.objective?.text || '')}</p>
    </div>

    <div class="campaign-acts">
      ${acts.map((a, idx) => `
        <div class="card campaign-act ${a.done ? 'done' : ''}">
          <div style="display:flex; justify-content:space-between; align-items:baseline; gap:8px;">
            <h3 style="margin:0;">${a.icon} ${contentLabel(a,"name")}</h3>
            <span class="chip ${a.done ? 'green' : ''}" style="font-size:11px;">${a.done ? label("ui.campaign.complete") : label("ui.campaign.in_progress")}</span>
          </div>
          <p class="muted small" style="margin:6px 0;">${label("ui.campaign.reward_xp_gp_values", {p5: (a.mapNameDisplay || a.mapName), p6: a.reward?.xp || 0, p7: a.reward?.gold || 0})}</p>
          <p class="small" style="margin:0 0 6px;">${contentLabel(a,"objective")}</p>
          ${a.clues ? `
            <div style="display:flex; gap:6px; flex-wrap:wrap; margin-bottom:6px;">
              ${a.clues.map(cl => `<span class="chip ${cl.done ? 'green' : ''}" style="font-size:11px;">${cl.done ? '✔' : '○'} ${contentLabel(cl,"name")}</span>`).join('')}
            </div>` : ''}
          ${a.done ? `<p class="muted small" style="margin:0; font-style:italic;">${contentLabel(a,"blurb")}</p>` : ''}
        </div>
        ${idx < acts.length - 1 ? '<div class="campaign-arrow-vert">↓</div>' : ''}
      `).join('')}
    </div>

    ${done ? `
      <div class="card epilogue-card">
        <h2 style="margin-top:0;">${label("ui.campaign.epilogue")}</h2>
        <p style="font-size:15px; line-height:1.75; white-space:pre-wrap;">${displayLabel(data.epilogueDisplay,data.epilogue || '')}</p>
        <div class="epilogue-stats">
          <div><span class="muted small">${label("ui.campaign.level")}</span><b>${esc(data.stats?.level)}</b></div>
          <div><span class="muted small">${label("ui.campaign.total_kills")}</span><b>${esc(data.stats?.kills)}</b></div>
          <div><span class="muted small">${label("ui.campaign.delves_completed")}</span><b>${esc(data.stats?.delves)}</b></div>
          <div><span class="muted small">${label("ui.campaign.gold")}</span><b>${esc(data.stats?.gold)}</b></div>
          <div><span class="muted small">${label("ui.campaign.bestiary_entries")}</span><b>${esc(data.stats?.trophies)}</b></div>
        </div>
        <div style="display:flex; gap:8px; flex-wrap:wrap; margin-top:14px;">
          <a class="btn primary" href="#/overworld?char=${hero.id}">${label("ui.campaign.keep_playing_endless_depths_is_open")}</a>
          <a class="btn" href="#/overworld?char=${hero.id}">${label("ui.campaign.back_to_region_map")}</a>
          <a class="btn" href="#/character/${hero.id}">${label("ui.campaign.character_sheet")}</a>
        </div>
        <p class="muted small" style="margin-top:10px;">${label("ui.campaign.the_story_has_ended_but_all_dungeons")}</p>
      </div>
    ` : `
      ${data.guidance && data.guidance.primary ? `
      <div class="card guidance-banner-row" style="margin-top:14px; border-color:var(--gold-dim);">
        <a class="btn primary" href="${guidanceHref(hero.id, data.guidance.primary)}">▶ ${displayLabel(data.guidance.primary.textDisplay, data.guidance.primary.text)}</a>
        ${data.guidance.primary.reason ? `<span class="muted small">${displayLabel(data.guidance.primary.reasonDisplay, data.guidance.primary.reason)}</span>` : ''}
      </div>` : ''}
      <div class="card" style="margin-top:14px;">
        <h3 style="margin-top:0;">${label("ui.campaign.progress_record")}</h3>
        ${(data.log || []).length ? `
          <div style="display:flex; flex-direction:column; gap:8px;">
            ${data.log.slice().reverse().map(l => `
              <div class="campaign-log-entry">
                <span class="chip gold-chip" style="font-size:11px;">${label("ui.campaign.act_values", {p0: l.act})}</span>
                <span class="small">${contentLabel(l,"text")}</span>
              </div>`).join('')}
          </div>` : `<p class="muted small">${label("ui.campaign.no_progress_yet_start_with_the_relic")}</p>`}
      </div>
    `}
  `;
  function refreshLocalizedText() { translateDOM(main); }
  return navigation.onDispose(onLocaleChange(refreshLocalizedText));
}

// Guidance actions are server data — the campaign view maps them to hash routes.
function guidanceHref(charId, action) {
  if (!action) return `#/overworld?char=${charId}`;
  if (action.kind === 'resume' && action.saveId) return `#/play/${action.saveId}`;
  if (action.mapId) return `#/overworld?char=${charId}&node=${encodeURIComponent(action.mapId)}`;
  return `#/overworld?char=${charId}`;
}
