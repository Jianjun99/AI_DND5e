// levelup.js — Interactive Level-Up & Feat/Subclass Selection Modal
import { api } from '../api.js';
import { sfx } from '../sfx.js';

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
          <h2 style="margin:0;">Level Up Character</h2>
          <button class="btn small close-levelup-x" style="padding:2px 8px;">✕</button>
        </div>
        <p class="muted" id="levelupSubtitle" style="margin-top:6px; font-size:13px;">Loading advancement choices…</p>
      </div>
      <div id="levelupBody">
        <div class="spinner" style="margin:40px auto;"></div>
      </div>
    </div>
  `;
  document.body.appendChild(backdrop);

  const close = () => {
    backdrop.remove();
  };

  backdrop.querySelector('.close-levelup-x').onclick = close;
  backdrop.onclick = (e) => {
    if (e.target === backdrop) close();
  };

  // Fetch options
  api.levelUpOptions(characterId).then(opts => {
    if (!opts || !opts.canLevelUp) {
      document.getElementById('levelupBody').innerHTML = `
        <div style="text-align:center; padding:20px;">
          <p style="font-size:16px; color:#f87171;">⚠️ Not enough Experience Points yet.</p>
          <p class="muted">Current XP: <b>${opts?.currentXp || 0}</b> / Needed: <b>${opts?.xpNeeded || '—'}</b></p>
          <button class="btn primary" id="btnLvlClose" style="margin-top:14px;">Return</button>
        </div>
      `;
      document.getElementById('btnLvlClose').onclick = close;
      return;
    }

    renderWizard(opts);
  }).catch(err => {
    document.getElementById('levelupBody').innerHTML = `
      <div style="text-align:center; padding:20px; color:#f87171;">
        <p>Failed to load level-up options: ${err.message}</p>
        <button class="btn" id="btnLvlClose">Close</button>
      </div>
    `;
    document.getElementById('btnLvlClose').onclick = close;
  });

  function renderWizard(opts) {
    const sub = document.getElementById('levelupSubtitle');
    if (sub) sub.textContent = `Ascending to Level ${opts.nextLevel}! Make your progression choices below.`;

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
        <h4>🩸 1. Hit Points Increase</h4>
        <div class="hp-choice-grid">
          <div class="hp-choice-card selected" id="optHpAvg">
            <div style="font-weight:700; color:var(--gold); margin-bottom:4px;">Take Fixed Average</div>
            <div style="font-size:22px; font-weight:800; color:#4ade80;">+${opts.avgHpGain} HP</div>
            <div class="muted" style="font-size:11px; margin-top:4px;">d${opts.hitDie} avg (${Math.floor(opts.hitDie / 2) + 1}) + CON (${opts.conMod >= 0 ? '+' : ''}${opts.conMod})</div>
          </div>
          <div class="hp-choice-card" id="optHpRoll">
            <div style="font-weight:700; color:var(--gold); margin-bottom:4px;">Roll d${opts.hitDie} Hit Die</div>
            <div id="rollValueDisplay" style="font-size:20px; font-weight:800; color:#93c5fd;">🎲 Roll!</div>
            <button class="btn small" id="btnRollDice" style="margin-top:6px; padding:2px 10px;">Roll Die</button>
          </div>
        </div>
      </div>

      <!-- 2. Subclass Selection (if Level >= 3) -->
      ${opts.needsSubclass && opts.subclasses.length ? `
        <div class="levelup-step-box">
          <h4>👑 2. Choose Your Archetype / Subclass</h4>
          <p class="muted" style="font-size:12px; margin-bottom:10px;">At Level 3, adventurers unlock their legendary martial or arcane specialization.</p>
          <div class="subclass-grid">
            ${opts.subclasses.map((s, idx) => `
              <div class="subclass-choice-card ${idx === 0 ? 'selected' : ''}" data-subid="${s.id}">
                <div class="subclass-name-row">
                  <span>${s.icon || '⚔️'}</span>
                  <span>${s.name}</span>
                </div>
                <div class="subclass-desc">${s.desc}</div>
              </div>
            `).join('')}
          </div>
        </div>
      ` : ''}

      <!-- 3. Feat or Ability Score Improvement (Level 4, 8) -->
      ${opts.needsAsiOrFeat ? `
        <div class="levelup-step-box">
          <h4>⚡ 3. Ability Score Improvement or Feat</h4>
          <div style="display:flex; gap:10px; margin-bottom:12px;">
            <button class="btn small ${state.featOrAsi === 'asi' ? 'primary' : ''}" id="btnModeAsi">Ability Score (+2)</button>
            <button class="btn small ${state.featOrAsi === 'feat' ? 'primary' : ''}" id="btnModeFeat">Choose a Feat</button>
          </div>
          
          <div id="boxAsi" style="display:${state.featOrAsi === 'asi' ? 'block' : 'none'};">
            <p class="muted" style="font-size:12px; margin-bottom:8px;">Increase one ability by +2 (e.g. primary strength, dexterity, or spellcasting stat).</p>
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
                    <span>${f.name}</span>
                  </div>
                  <div class="feat-desc">${f.desc}</div>
                </div>
              `).join('')}
            </div>
          </div>
        </div>
      ` : ''}

      <!-- 4. Spell Selection (if Casters) -->
      ${opts.availableSpells && opts.availableSpells.length ? `
        <div class="levelup-step-box">
          <h4>✨ 4. Learn New Spells</h4>
          <p class="muted" style="font-size:12px; margin-bottom:8px;">Select a new circle spell to add to your grimoire:</p>
          <div style="display:grid; grid-template-columns: 1fr 1fr; gap:8px;">
            ${opts.availableSpells.map((sp, idx) => `
              <label style="display:flex; align-items:center; gap:8px; background:rgba(0,0,0,0.3); padding:8px; border-radius:6px; cursor:pointer; font-size:12px; border:1px solid rgba(255,255,255,0.08);">
                <input type="checkbox" class="chk-spell" value="${sp.id}" ${idx === 0 ? 'checked' : ''} />
                <div>
                  <div style="font-weight:700; color:#93c5fd;">${sp.name} <span class="muted">(Lvl ${sp.level})</span></div>
                  <div class="muted" style="font-size:10.5px;">${sp.desc.slice(0, 55)}…</div>
                </div>
              </label>
            `).join('')}
          </div>
        </div>
      ` : ''}

      <!-- Actions -->
      <div style="display:flex; justify-content:space-between; align-items:center; margin-top:20px; border-top:1px solid rgba(255,255,255,0.1); padding-top:16px;">
        <button class="btn" id="btnCancelLevelUp">Cancel</button>
        <button class="btn primary" id="btnConfirmLevelUp" style="padding:8px 24px; font-weight:700; font-size:14px;">
          ⭐ Confirm Level ${opts.nextLevel} Ascension
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
      rollDisplay.textContent = '🎲 Rolling…';
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
    document.querySelectorAll('.subclass-choice-card').forEach(card => {
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
    document.querySelectorAll('.btn-asi-stat').forEach(btn => {
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
    document.querySelectorAll('.feat-choice-card').forEach(card => {
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
      const confirmBtn = document.getElementById('btnConfirmLevelUp');
      confirmBtn.disabled = true;
      confirmBtn.textContent = 'Ascending…';

      // Spells
      const spellCheckboxes = document.querySelectorAll('.chk-spell:checked');
      state.chosenSpells = Array.from(spellCheckboxes).map(cb => cb.value);

      try {
        const res = await api.levelUpCharacter(characterId, state);
        if (res && res.ok) {
          sfx.play('level_up');
          body.innerHTML = `
            <div style="text-align:center; padding:30px 15px;">
              <div style="font-size:48px; margin-bottom:10px;">🎉</div>
              <h3 style="font-family:var(--serif); color:var(--gold); font-size:24px; margin-bottom:8px;">Ascension Complete!</h3>
              <p style="font-size:15px; color:#fff;"><b>${res.char.name}</b> has attained <b>Level ${res.newLevel}</b>!</p>
              <p style="color:#4ade80; font-weight:700; margin:8px 0;">Hit Points increased by +${res.gainedHp} (Max HP: ${res.char.hpMax})</p>
              ${res.char.subclass ? `<p class="muted" style="font-size:13px;">Specialization: <b style="color:var(--gold); text-transform:capitalize;">${res.char.subclass}</b></p>` : ''}
              <button class="btn primary" id="btnFinishLevelUp" style="margin-top:20px; padding:8px 24px;">Glory to the Champion</button>
            </div>
          `;
          document.getElementById('btnFinishLevelUp').onclick = () => {
            close();
            onComplete(res.char);
          };
        } else {
          throw new Error(res.error || 'Level up failed');
        }
      } catch (err) {
        alert('Error leveling up: ' + err.message);
        confirmBtn.disabled = false;
        confirmBtn.textContent = 'Try Again';
      }
    };
  }
}
