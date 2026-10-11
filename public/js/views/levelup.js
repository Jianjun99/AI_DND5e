import { contentLabel,  t, label, localizeText } from "../i18n.js";
// levelup.js — Interactive Level-Up & Feat/Subclass Selection Modal
import { api } from '../api.js';
import { sfx } from '../sfx.js';
import { presentModal, dismissModal } from '../modal.js';

/**
 * @param {string} characterId
 * @param {(char: Record<string, any>) => void} [onComplete] called with the updated character after a successful level-up
 */
export function openLevelUpModal(characterId, onComplete = () => {}) {
  // Clean up any existing modal first
  document.querySelectorAll('.levelup-modal-back').forEach(el => el.remove());

  const backdrop = document.createElement('div');
  backdrop.className = 'modal-back levelup-modal-back';
  backdrop.innerHTML = `
    <div class="modal levelup-modal">
      <div class="levelup-header">
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <span style="font-size:24px;">⚡</span>
          <h2 style="margin:0;">${label("ui.levelup.level_up_character")}</h2>
          <button class="btn small close-levelup-x" style="padding:2px 8px;">✕</button>
        </div>
        <p class="muted" id="levelupSubtitle" style="margin-top:6px; font-size:13px;">${label("ui.levelup.loading_advancement_choices")}</p>
      </div>
      <div id="levelupBody">
        <div class="spinner" style="margin:40px auto;"></div>
      </div>
    </div>
  `;
  if (!presentModal(backdrop)) return;

  const close = () => {
    dismissModal(backdrop);
  };

  /** @type {HTMLButtonElement} */ (backdrop.querySelector('.close-levelup-x')).onclick = close;
  backdrop.onclick = (e) => {
    if (e.target === backdrop) close();
  };

  // Fetch options
  api.levelUpOptions(characterId).then(opts => {
    if (!backdrop.isConnected) return;
    if (!opts || !opts.canLevelUp) {
      document.getElementById('levelupBody').innerHTML = `
        <div style="text-align:center; padding:20px;">
          <p style="font-size:16px; color:#f87171;">${label("ui.levelup.not_enough_experience_points_yet")}</p>
          <p class="muted">${label("ui.levelup.current_xp")} <b>${opts?.currentXp || 0}</b> ${label("ui.levelup.needed")} <b>${opts?.xpNeeded || '—'}</b></p>
          <button class="btn primary" id="btnLvlClose" style="margin-top:14px;">${label("ui.levelup.return")}</button>
        </div>
      `;
      document.getElementById('btnLvlClose').onclick = close;
      return;
    }

    renderWizard(opts);
  }).catch(err => {
    if (!backdrop.isConnected) return;
    document.getElementById('levelupBody').innerHTML = `
      <div style="text-align:center; padding:20px; color:#f87171;">
        <p>${label("ui.levelup.failed_to_load_level_up_options_values", {p0: err.message})}</p>
        <button class="btn" id="btnLvlClose">${label("ui.levelup.close")}</button>
      </div>
    `;
    document.getElementById('btnLvlClose').onclick = close;
  });

  function renderWizard(opts) {
    const sub = document.getElementById('levelupSubtitle');
    if (sub) localizeText(sub, () => t("ui.levelup.subtitle", { level: opts.nextLevel }));

    let state = {
      hpChoice: 'average',
      hpRoll: null,
      subclass: opts.subclasses?.[0]?.id || null,
      featOrAsi: opts.needsAsiOrFeat ? 'asi' : null,
      chosenAbilities: {},
      chosenFeat: opts.featChoices?.[0]?.id || 'tough',
      chosenSpells: []
    };

    const body = document.getElementById('levelupBody');
    body.innerHTML = `
      <!-- 1. Hit Points Choice -->
      <div class="levelup-step-box">
        <h4>${label("ui.levelup.1_hit_points_increase")}</h4>
        <div class="hp-choice-grid">
          <div class="hp-choice-card selected" id="optHpAvg">
            <div style="font-weight:700; color:var(--gold); margin-bottom:4px;">${label("ui.levelup.take_fixed_average")}</div>
            <div style="font-size:22px; font-weight:800; color:#4ade80;">+${opts.avgHpGain} HP</div>
            <div class="muted" style="font-size:11px; margin-top:4px;">${label("ui.levelup.d_avg_con_values", {p3: opts.hitDie, p4: Math.floor(opts.hitDie / 2) + 1, p5: opts.conMod >= 0 ? '+' : '', p6: opts.conMod})}</div>
          </div>
          <div class="hp-choice-card" id="optHpRoll">
            <div style="font-weight:700; color:var(--gold); margin-bottom:4px;">${label("ui.levelup.roll_d_hit_die_values", {p7: opts.hitDie})}</div>
            <div id="rollValueDisplay" style="font-size:20px; font-weight:800; color:#93c5fd;">${label("ui.levelup.roll")}</div>
            <button class="btn small" id="btnRollDice" style="margin-top:6px; padding:2px 10px;">${label("ui.levelup.roll_die")}</button>
          </div>
        </div>
      </div>

      <!-- 2. Subclass Selection (if Level >= 3) -->
      ${opts.needsSubclass && opts.subclasses.length ? `
        <div class="levelup-step-box">
          <h4>${label("ui.levelup.2_choose_your_archetype_subclass")}</h4>
          <p class="muted" style="font-size:12px; margin-bottom:10px;">${label("ui.levelup.at_level_3_adventurers_unlock_their_legendary")}</p>
          <div class="subclass-grid">
            ${opts.subclasses.map((s, idx) => `
              <div class="subclass-choice-card ${idx === 0 ? 'selected' : ''}" data-subid="${s.id}">
                <div class="subclass-name-row">
                  <span>${s.icon || '⚔️'}</span>
                  <span>${contentLabel(s,"name")}</span>
                </div>
                <div class="subclass-desc">${contentLabel(s,"desc")}</div>
              </div>
            `).join('')}
          </div>
        </div>
      ` : ''}

      <!-- 3. Feat or Ability Score Improvement (Level 4, 8) -->
      ${opts.needsAsiOrFeat ? `
        <div class="levelup-step-box">
          <h4>${label("ui.levelup.3_ability_score_improvement_or_feat")}</h4>
          <div style="display:flex; gap:10px; margin-bottom:12px;">
            <button class="btn small ${state.featOrAsi === 'asi' ? 'primary' : ''}" id="btnModeAsi">${label("ui.levelup.ability_score_2")}</button>
            <button class="btn small ${state.featOrAsi === 'feat' ? 'primary' : ''}" id="btnModeFeat">${label("ui.levelup.choose_a_feat")}</button>
          </div>
          
          <div id="boxAsi" style="display:${state.featOrAsi === 'asi' ? 'block' : 'none'};">
            <p class="muted" style="font-size:12px; margin-bottom:8px;">${label("ui.levelup.increase_one_ability_by_2_e_g")}</p>
            <div style="display:grid; grid-template-columns: repeat(3, 1fr); gap:8px;">
              ${['str', 'dex', 'con', 'int', 'wis', 'cha'].map(ab => `
                <button class="btn small btn-asi-stat ${ab === 'str' ? 'selected' : ''}" data-stat="${ab}" style="text-transform:uppercase; font-weight:700;">
                  ${ab} +2
                </button>
              `).join('')}
            </div>
          </div>

          <div id="boxFeat" style="display:${state.featOrAsi === 'feat' ? 'block' : 'none'};">
            <div class="feat-grid">
              ${(opts.featChoices || []).map((f, idx) => `
                <div class="feat-choice-card ${idx === 0 ? 'selected' : ''}" data-featid="${f.id}">
                  <div class="feat-name-row">
                    <span>${f.icon || '⭐'}</span>
                    <span>${contentLabel(f,"name")}</span>
                  </div>
                  <div class="feat-desc">${contentLabel(f,"desc")}</div>
                </div>
              `).join('')}
            </div>
          </div>
        </div>
      ` : ''}

      <!-- 4. Spell Selection (if Casters) -->
      ${opts.availableSpells && opts.availableSpells.length ? `
        <div class="levelup-step-box">
          <h4>${label("ui.levelup.4_learn_new_spells")}</h4>
          <p class="muted" style="font-size:12px; margin-bottom:8px;">${label("ui.levelup.select_a_new_circle_spell_to_add")}</p>
          <div style="display:grid; grid-template-columns: 1fr 1fr; gap:8px;">
            ${opts.availableSpells.map((sp, idx) => `
              <label style="display:flex; align-items:center; gap:8px; background:rgba(0,0,0,0.3); padding:8px; border-radius:6px; cursor:pointer; font-size:12px; border:1px solid rgba(255,255,255,0.08);">
                <input type="checkbox" class="chk-spell" value="${sp.id}" ${idx === 0 ? 'checked' : ''} />
                <div>
                  <div style="font-weight:700; color:#93c5fd;">${contentLabel(sp,"name")} <span class="muted">${label("ui.levelup.lvl_values", {p3: sp.level})}</span></div>
                  <div class="muted" style="font-size:10.5px;">${contentLabel(sp,'desc')}</div>
                </div>
              </label>
            `).join('')}
          </div>
        </div>
      ` : ''}

      <!-- Actions -->
      <div style="display:flex; justify-content:space-between; align-items:center; margin-top:20px; border-top:1px solid rgba(255,255,255,0.1); padding-top:16px;">
        <button class="btn" id="btnCancelLevelUp">${label("ui.levelup.cancel")}</button>
        <button class="btn primary" id="btnConfirmLevelUp" style="padding:8px 24px; font-weight:700; font-size:14px;">
          ${label("ui.levelup.confirm_level_ascension_values", {p14: opts.nextLevel})}
        </button>
      </div>
    `;

    // Hook up interactive elements
    const optAvg = document.getElementById('optHpAvg');
    const optRoll = document.getElementById('optHpRoll');
    const btnRoll = document.getElementById('btnRollDice');
    const rollDisplay = document.getElementById('rollValueDisplay');

    optAvg.onclick = () => {
      state.hpChoice = 'average';
      optAvg.classList.add('selected');
      optRoll.classList.remove('selected');
    };

    optRoll.onclick = () => {
      state.hpChoice = 'roll';
      optRoll.classList.add('selected');
      optAvg.classList.remove('selected');
      if (state.hpRoll === null) doRoll();
    };

    function doRoll() {
      sfx.play('dice');
      localizeText(rollDisplay, () => t("ui.levelup.rolling"));
      let ticks = 0;
      const interval = setInterval(() => {
        const temp = Math.floor(Math.random() * opts.hitDie) + 1;
        rollDisplay.textContent = `🎲 ${temp}`;
        ticks++;
        if (ticks > 7) {
          clearInterval(interval);
          const finalRoll = Math.floor(Math.random() * opts.hitDie) + 1;
          const totalHp = Math.max(1, finalRoll + opts.conMod);
          state.hpRoll = finalRoll;
          rollDisplay.innerHTML = `<span style="color:#4ade80;">+${totalHp} HP</span> <span class="muted" style="font-size:11px;">(d${opts.hitDie}:${finalRoll} + ${opts.conMod})</span>`;
          state.hpChoice = 'roll';
          optRoll.classList.add('selected');
          optAvg.classList.remove('selected');
        }
      }, 50);
    }
    btnRoll.onclick = (e) => {
      e.stopPropagation();
      doRoll();
    };

    // Subclass cards
    document.querySelectorAll('.subclass-choice-card').forEach(/** @param {HTMLElement} card */ card => {
      card.onclick = () => {
        document.querySelectorAll('.subclass-choice-card').forEach(c => c.classList.remove('selected'));
        card.classList.add('selected');
        state.subclass = card.dataset.subid;
        sfx.play('attack');
      };
    });

    // ASI vs Feat buttons
    const btnModeAsi = document.getElementById('btnModeAsi');
    const btnModeFeat = document.getElementById('btnModeFeat');
    const boxAsi = document.getElementById('boxAsi');
    const boxFeat = document.getElementById('boxFeat');

    if (btnModeAsi && btnModeFeat) {
      btnModeAsi.onclick = () => {
        state.featOrAsi = 'asi';
        btnModeAsi.classList.add('primary');
        btnModeFeat.classList.remove('primary');
        boxAsi.style.display = 'block';
        boxFeat.style.display = 'none';
      };
      btnModeFeat.onclick = () => {
        state.featOrAsi = 'feat';
        btnModeFeat.classList.add('primary');
        btnModeAsi.classList.remove('primary');
        boxFeat.style.display = 'block';
        boxAsi.style.display = 'none';
      };
    }

    // ASI stat selector
    document.querySelectorAll('.btn-asi-stat').forEach(/** @param {HTMLButtonElement} btn */ btn => {
      btn.onclick = () => {
        document.querySelectorAll('.btn-asi-stat').forEach(b => b.classList.remove('selected', 'primary'));
        btn.classList.add('selected', 'primary');
        state.chosenAbilities = { [btn.dataset.stat]: 2 };
        sfx.play('attack');
      };
    });
    // Default ASI
    state.chosenAbilities = { str: 2 };

    // Feat cards
    document.querySelectorAll('.feat-choice-card').forEach(/** @param {HTMLElement} card */ card => {
      card.onclick = () => {
        document.querySelectorAll('.feat-choice-card').forEach(c => c.classList.remove('selected'));
        card.classList.add('selected');
        state.chosenFeat = card.dataset.featid;
        sfx.play('attack');
      };
    });

    // Cancel
    document.getElementById('btnCancelLevelUp').onclick = close;

    // Confirm
    document.getElementById('btnConfirmLevelUp').onclick = async () => {
      const confirmBtn = /** @type {HTMLButtonElement} */ (document.getElementById('btnConfirmLevelUp'));
      confirmBtn.disabled = true;
      localizeText(confirmBtn, () => t("ui.levelup.ascending"));

      // Spells
      const spellCheckboxes = /** @type {NodeListOf<HTMLInputElement>} */ (document.querySelectorAll('.chk-spell:checked'));
      state.chosenSpells = Array.from(spellCheckboxes).map(cb => cb.value);

      try {
        const res = await api.levelUpCharacter(characterId, state);
        if (!backdrop.isConnected) return;
        if (res && res.ok) {
          sfx.play('level_up');
          body.innerHTML = `
            <div style="text-align:center; padding:30px 15px;">
              <div style="font-size:48px; margin-bottom:10px;">🎉</div>
              <h3 style="font-family:var(--serif); color:var(--gold); font-size:24px; margin-bottom:8px;">${label("ui.levelup.ascension_complete")}</h3>
              <p style="font-size:15px; color:#fff;"><b>${contentLabel(res.char,"name")}</b> ${label("ui.levelup.has_attained")} <b>${label("ui.levelup.level_values", {p3: res.newLevel})}</b>!</p>
              <p style="color:#4ade80; font-weight:700; margin:8px 0;">${label("ui.levelup.hit_points_increased_by_max_hp_values", {p4: res.gainedHp, p5: res.char.hpMax})}</p>
              ${res.char.subclass ? `<p class="muted" style="font-size:13px;">${label("ui.levelup.specialization")} <b style="color:var(--gold); text-transform:capitalize;">${res.char.subclass}</b></p>` : ''}
              <button class="btn primary" id="btnFinishLevelUp" style="margin-top:20px; padding:8px 24px;">${label("ui.levelup.glory_to_the_champion")}</button>
            </div>
          `;
          document.getElementById('btnFinishLevelUp').onclick = () => {
            close();
            onComplete(res.char);
          };
        } else {
          throw new Error(res.error || t("ui.levelup.level_up_failed"));
        }
      } catch (err) {
        if (!backdrop.isConnected) return;
        alert(t("ui.levelup.error_leveling_up") + err.message);
        confirmBtn.disabled = false;
        localizeText(confirmBtn, () => t("ui.levelup.try_again"));
      }
    };
  }
}
