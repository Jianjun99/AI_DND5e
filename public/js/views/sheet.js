import { displayLabel,  contentLabel,  t, label, localizeText, translateDOM, onLocaleChange } from "../i18n.js";
// sheet.js — character sheet display
import { api } from '../api.js';
import { esc, toast, state as appState } from '../app.js';
import { initTooltips } from '../tooltip.js';

const ABILS = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
const SKILL_ABILITY = { acrobatics:'dex', animal_handling:'wis', arcana:'int', athletics:'str', deception:'cha', history:'int', insight:'wis', intimidation:'cha', investigation:'int', medicine:'wis', nature:'int', perception:'wis', performance:'cha', persuasion:'cha', religion:'int', sleight_of_hand:'dex', stealth:'dex', survival:'wis' };

export function modOf(score) { return Math.floor((score - 10) / 2); }
export function fmtMod(m) { return (m >= 0 ? '+' : '') + m; }
export function skillName(s) { return t('content.skill.'+s); }

/** @param {import('../navigation.js').Navigation} navigation */
export async function sheetView(main, charId, navigation) {
  const rules = appState.rules;
  const char = await api.getCharacter(charId);
  if (!navigation.isCurrent()) return undefined;
  const cls = rules.classes.find(c => c.id === char.className);
  const sp = rules.species.find(s => s.id === char.species);
  const bg = rules.backgrounds.find(b => b.id === char.background);

  const saves = await api.listSaves().catch(() => []);
  if (!navigation.isCurrent()) return undefined;
  const currentSave = saves.find(x => x.characterId === char.id);
  const saveId = currentSave ? currentSave.id : null;

  const skillLines = Object.keys(SKILL_ABILITY).map(sk => {
    const prof = char.skills.includes(sk);
    const exp = char.expertise.includes(sk);
    let m = modOf(char.abilities[SKILL_ABILITY[sk]]);
    if (prof) m += char.profBonus * (exp ? 2 : 1);
    return `<div class="stat-line"><span>${exp ? '⭐ ' : prof ? '• ' : '&nbsp;&nbsp;'}${label('content.skill.'+sk)} <span class="muted small">(${SKILL_ABILITY[sk]})</span></span><span>${fmtMod(m)}</span></div>`;
  }).join('');

  const attacks = (char.attacks || []).map(a =>
    `<div class="stat-line"><span>${contentLabel(a,"name")} <span class="muted small">${a.dmgDice}${a.dmgMod ? fmtMod(a.dmgMod) : ''} ${label("content.damage."+a.damageType)}${a.ranged ? t("ui.sheet.ranged") + a.range + 'ft' : ''}</span></span><span>${fmtMod(a.bonus)}</span></div>`
  ).join('');

  const spells = char.spellcasting ? `
    <h2>${label("ui.sheet.spellcasting")}</h2>
    <div class="stat-line"><span>${label("ui.sheet.ability_spell_dc_spell_attack")}</span><span>${char.spellcasting.ability.toUpperCase()} / ${char.spellcasting.saveDc} / ${fmtMod(char.spellcasting.spellAttack)}</span></div>
    <div class="stat-line"><span>${label("ui.sheet.cantrips")}</span><span>${char.spellcasting.cantrips.map(c => contentLabel(rules.spells.find(s => s.id === c) || {name:c})).join(', ') || '—'}</span></div>
    <div class="stat-line"><span>${label("ui.sheet.spells")}</span><span>${char.spellcasting.spells.map(c => contentLabel(rules.spells.find(s => s.id === c) || {name:c})).join(', ') || '—'}</span></div>` : '';

  const features = (cls.features || []).filter(f => f.level <= char.level).map(f =>
    `<li><b>${contentLabel(f,"name")}</b> <span class="muted small">${label("ui.sheet.level_values", {p1: f.level})}</span><br><span class="small muted">${displayLabel(f.descDisplay,f.desc || '')}</span></li>`).join('');

  const speciesTraits = (sp.traits || []).map(entryText => `<li><b>${contentLabel(entryText,"name")}</b> — <span class="muted">${contentLabel(entryText,"desc")}</span></li>`).join('');
  const inventory = char.inventory.map(i => {
    const w = rules.weapons.find(x => x.id === i.itemId);
    const a = rules.armor.find(x => x.id === i.itemId);
    const g = rules.gear.find(x => x.id === i.itemId);
    const def = w || a || g;
    return `<div class="stat-line" data-item-tooltip="${i.itemId}" style="cursor:help;"><span>${contentLabel(i.nameDisplay ? i : def || {name:i.itemId})}</span><span>×${i.qty}</span></div>`;
  }).join('');

  const getItemName = (id) => {
    if (!id || id === 'none') return null;
    const own = (char.inventory || []).find(i => i.uniqueId === id);
    if (own?.name) return own.nameDisplay || own.name;
    const w = rules.weapons.find(x => x.id === id);
    const a = rules.armor.find(x => x.id === id);
    const g = rules.gear.find(x => x.id === id);
    return (w || a || g)?.nameDisplay || (w || a || g)?.name || id;
  };

  const getItemDesc = (id) => {
    if (!id || id === 'none') return '';
    const own=(char.inventory || []).find(i=>i.uniqueId===id);
    if(own?.desc) return own.desc;
    const w = rules.weapons.find(x => x.id === id);
    if (w) return `${w.damage} ${w.damageType || ''}`;
    const a = rules.armor.find(x => x.id === id);
    if (a) return `AC: ${a.ac}`;
    const g = rules.gear.find(x => x.id === id);
    if (g) return g.desc || '';
    return '';
  };
  const getItemDescDisplay=(id)=>{
    const own=(char.inventory || []).find(i=>i.uniqueId===id);
    if(own?.descDisplay) return own.descDisplay;
    const gear=rules.gear.find(i=>i.id===id);
    if(gear?.descDisplay) return gear.descDisplay;
    const weapon=rules.weapons.find(i=>i.id===id);
    return weapon?{parts:[weapon.damage,' ',{key:'content.damage.'+weapon.damageType,fallback:weapon.damageType || ''}],fallback:getItemDesc(id)}:{fallback:getItemDesc(id)};
  };

  const equipped = char.equipped || {};
  const currentArmor = equipped.armor !== undefined ? equipped.armor : (char.inventory.map(i => rules.armor.find(a => a.id === i.itemId && a.type !== 'shield')).find(Boolean)?.id || null);
  const currentMainHand = equipped.mainHand !== undefined ? equipped.mainHand : (char.inventory.map(i => rules.weapons.find(w => w.id === i.itemId)).find(Boolean)?.id || null);
  const currentOffHand = equipped.offHand !== undefined ? equipped.offHand : (char.inventory.some(i => i.itemId === 'shield') ? 'shield' : null);
  const currentCloak = equipped.cloak || null;
  const currentAmulet = equipped.amulet || null;
  const currentRing1 = equipped.ring1 || null;

  const paperdollCard = `
    <div class="card" style="margin-top:12px;">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
        <h3 style="margin:0;">${label("ui.sheet.equipped_loadout")}</h3>
        <span class="small muted">${label("ui.sheet.click_slot_to_change")}</span>
      </div>
      <div class="paperdoll-grid">
        <div class="paperdoll-slot" data-slot="armor" ${currentArmor ? `data-item-tooltip="${currentArmor}" style="cursor:help;"` : ''}>
          <div class="slot-label">${label("ui.sheet.armor")}</div>
          <div class="slot-name ${currentArmor ? '' : 'empty'}">${currentArmor ? displayLabel(getItemName(currentArmor)) : label("ui.sheet.unarmored")}</div>
          <div class="slot-val small muted">${displayLabel(getItemDescDisplay(currentArmor))}</div>
        </div>
        <div class="paperdoll-slot" data-slot="mainHand" ${currentMainHand ? `data-item-tooltip="${currentMainHand}" style="cursor:help;"` : ''}>
          <div class="slot-label">${label("ui.sheet.main_hand")}</div>
          <div class="slot-name ${currentMainHand ? '' : 'empty'}">${currentMainHand ? displayLabel(getItemName(currentMainHand)) : label("ui.sheet.unarmed")}</div>
          <div class="slot-val small muted">${displayLabel(getItemDescDisplay(currentMainHand))}</div>
        </div>
        <div class="paperdoll-slot" data-slot="offHand" ${currentOffHand ? `data-item-tooltip="${currentOffHand}" style="cursor:help;"` : ''}>
          <div class="slot-label">${label("ui.sheet.off_hand")}</div>
          <div class="slot-name ${currentOffHand ? '' : 'empty'}">${currentOffHand ? displayLabel(getItemName(currentOffHand)) : label("ui.sheet.empty")}</div>
          <div class="slot-val small muted">${displayLabel(getItemDescDisplay(currentOffHand))}</div>
        </div>
        <div class="paperdoll-slot" data-slot="cloak" ${currentCloak ? `data-item-tooltip="${currentCloak}" style="cursor:help;"` : ''}>
          <div class="slot-label">${label("ui.sheet.cloak")}</div>
          <div class="slot-name ${currentCloak ? '' : 'empty'}">${currentCloak ? displayLabel(getItemName(currentCloak)) : label("ui.sheet.empty")}</div>
          <div class="slot-val small muted">${displayLabel(getItemDescDisplay(currentCloak))}</div>
        </div>
        <div class="paperdoll-slot" data-slot="amulet" ${currentAmulet ? `data-item-tooltip="${currentAmulet}" style="cursor:help;"` : ''}>
          <div class="slot-label">${label("ui.sheet.amulet")}</div>
          <div class="slot-name ${currentAmulet ? '' : 'empty'}">${currentAmulet ? displayLabel(getItemName(currentAmulet)) : label("ui.sheet.empty")}</div>
          <div class="slot-val small muted">${displayLabel(getItemDescDisplay(currentAmulet))}</div>
        </div>
        <div class="paperdoll-slot" data-slot="ring1" ${currentRing1 ? `data-item-tooltip="${currentRing1}" style="cursor:help;"` : ''}>
          <div class="slot-label">${label("ui.sheet.ring")}</div>
          <div class="slot-name ${currentRing1 ? '' : 'empty'}">${currentRing1 ? displayLabel(getItemName(currentRing1)) : label("ui.sheet.empty")}</div>
          <div class="slot-val small muted">${displayLabel(getItemDescDisplay(currentRing1))}</div>
        </div>
      </div>
    </div>
  `;

  main.innerHTML = `
    <p><a href="#/">${label("ui.sheet.all_heroes")}</a></p>
    <div style="display:flex; gap:16px; align-items:center; margin-bottom:14px; flex-wrap:wrap;">
      <div style="width:90px; height:104px; flex-shrink:0;">
        <img id="heroPortraitImg" src="${char.portraitUrl || '/portraits/hero_' + char.id + '.svg'}"
             data-i18n-alt="ui.portrait.hero" alt="${esc(t('ui.portrait.hero'))}"
             style="width:90px; height:104px; object-fit:cover; border-radius:8px; border:2px solid var(--border); background:#15120e;"
             onerror="this.src='/portraits/hero_${char.id}.svg'">
      </div>
      <div>
        <h1 style="margin:0 0 4px;">${contentLabel(char,"name")}</h1>
        <p class="sub" style="margin:0 0 8px;">${label("ui.sheet.level_background_xp_values", {p4: char.level, p5: (sp.nameDisplay || sp.name), p6: (cls.nameDisplay || cls.name), p7: (bg.nameDisplay || bg.name), p8: char.xp})}</p>
        <button class="btn small" id="regenPortraitBtn" data-i18n-title="ui.sheet.re_roll_or_generate_portrait_with_ai" title="${esc(t("ui.sheet.re_roll_or_generate_portrait_with_ai"))}">${label("ui.sheet.regenerate_portrait")}</button>
      </div>
    </div>
    ${(char.encounterFacts || []).some(f => f.storyId && f.ending) ? `<section class="card" data-story-history style="margin-bottom:12px;"><h2>${label('story.history')}</h2>${(char.encounterFacts || []).filter(f => f.storyId && f.ending).slice().reverse().filter((f, i, all) => all.findIndex(other => other.storyId === f.storyId) === i).map(ending => `<details open><summary>${displayLabel(ending.sceneNameDisplay, ending.sceneName || ending.storyId)}</summary><p>${displayLabel(ending.textDisplay, ending.text)}</p>${Object.entries(ending.reactions || {}).map(([id, r]) => `<p class="small muted">💬 ${displayLabel({ localized: Object.fromEntries(Object.entries(r.localized || {}).map(([loc, texts]) => [loc, texts?.text]).filter(([, text]) => typeof text === 'string')), fallback: r.text }, r.text)}</p>`).join('')}${char.encounterFacts.filter(f => f.saveId === ending.saveId && f.storyId === ending.storyId).map(f => `<p><b>${displayLabel(f.choiceLabelDisplay,f.choiceLabel)}</b><br>${label('story.result.cost',{gold:f.costGold || 0})}${f.loyaltyDelta ? '<br>' + label('story.loyalty',{delta:(f.loyaltyDelta > 0 ? '+' : '') + f.loyaltyDelta}) : ''}${f.check ? '<br>' + label('story.result.check',{...f.check,outcome:t(f.check.success?'story.success':'story.failure')}) : ''}</p>`).join('')}</details>`).join('')}</section>` : ''}
    <div class="sheet-grid">
      <div>
        <div class="card">
          <h3>${label("ui.sheet.abilities")}</h3>
          <div class="ability-grid">
            ${ABILS.map(a => `<div class="ability-box"><div class="abbr">${a.toUpperCase()}</div><div class="score">${char.abilities[a]}</div><div class="mod">${fmtMod(modOf(char.abilities[a]))}</div></div>`).join('')}
          </div>
          <div style="margin-top:10px;">
            <div class="stat-line"><span>${label("ui.sheet.hit_points")}</span><span>${char.hpMax}</span></div>
            <div class="stat-line"><span>${label("ui.sheet.armor_class")}</span><span>${char.acBase}</span></div>
            <div class="stat-line"><span>${label("ui.sheet.speed")}</span><span>${char.speedFt} ft</span></div>
            <div class="stat-line"><span>${label("ui.sheet.initiative")}</span><span>${fmtMod(char.initBonus)}</span></div>
            <div class="stat-line"><span>${label("ui.sheet.proficiency_bonus")}</span><span>${fmtMod(char.profBonus)}</span></div>
            <div class="stat-line"><span>${label("ui.sheet.passive_perception")}</span><span>${10 + skillProfMod(char, 'perception')}</span></div>
            <div class="stat-line"><span>${label("ui.sheet.gold")}</span><span>${char.gold} gp</span></div>
          </div>
        </div>
        ${paperdollCard}
        <div class="card" style="margin-top:12px;">
          <h3>${label("ui.sheet.attacks")}</h3>${attacks}
        </div>
        <div class="card" style="margin-top:12px;">
          <h3>${label("ui.sheet.inventory")}</h3>${inventory}
        </div>
      </div>
      <div>
        <div class="card">
          <h3>${label("ui.sheet.skills")}</h3>
          <div class="grid" style="grid-template-columns:1fr 1fr;">${skillLines}</div>
        </div>
        ${spells ? `<div class="card" style="margin-top:12px;">${spells}</div>` : ''}
        <div class="card" style="margin-top:12px;">
          <h3>${label("ui.sheet.class_features_values", {p35: (cls.nameDisplay || cls.name)})}</h3>
          <ul class="trait-list">${features}</ul>
        </div>
        <div class="card" style="margin-top:12px;">
          <h3>${label("ui.sheet.species_traits_values", {p37: (sp.nameDisplay || sp.name)})}</h3>
          <ul class="trait-list">${speciesTraits}</ul>
          <p class="small muted" style="margin-top:8px;"><b>${label("ui.sheet.origin_feat")}</b> ${displayLabel(char.featNoteDisplay,char.featNote || char.feat)}</p>
        </div>
        <div style="margin-top:14px; display:flex; gap:8px; flex-wrap:wrap;">
          ${saveId ? `<a class="btn primary" href="#/play/${saveId}">${label("ui.sheet.resume_delve")}</a>` : ''}
          <a class="btn ${saveId ? '' : 'primary'}" href="#/overworld?char=${char.id}">${label("ui.sheet.overworld_delves")}</a>
        </div>
      </div>
    </div>
  `;

  function openEquipModal(slot) {
    let modal = document.getElementById('equipModal');
    if (!modal) {
      modal = document.createElement('div');
      modal.className = 'modal-back';
      modal.id = 'equipModal';
      document.body.appendChild(modal);
    }

    const slotLabels = {
      armor: "ui.sheet.body_armor",
      mainHand: "ui.sheet.main_hand_weapon",
      offHand: "ui.sheet.off_hand_shield_secondary",
      cloak: "ui.sheet.cloak_mantle",
      amulet: "ui.sheet.amulet_neck",
      ring1: "ui.sheet.ring_2"
    };

    const invItems = char.inventory || [];
    /** @param {any} item @param {any} [def] */
    const choiceItem = (item, def = {}) => ({
      ...def, ...item, id:item.uniqueId || item.itemId,
      name:item.name || def.name || item.itemId,
      nameDisplay:item.nameDisplay || def.nameDisplay || getItemName(item.uniqueId || item.itemId),
      descDisplay:getItemDescDisplay(item.uniqueId || item.itemId)
    });
    let matching = [];

    if (slot === 'armor') {
      matching = invItems.map(i => {
        const a = rules.armor.find(x => x.id === i.itemId && x.type !== 'shield');
        return a ? choiceItem(i,a) : null;
      }).filter(Boolean);
    } else if (slot === 'mainHand') {
      matching = invItems.map(i => {
        const w = rules.weapons.find(x => x.id === i.itemId);
        return w ? choiceItem(i,w) : null;
      }).filter(Boolean);
    } else if (slot === 'offHand') {
      matching = invItems.map(i => {
        const s = rules.armor.find(x => x.id === i.itemId && x.type === 'shield');
        const w = rules.weapons.find(x => x.id === i.itemId && (x.props || []).includes('light'));
        const it = s || w;
        return it ? choiceItem(i,it) : null;
      }).filter(Boolean);
    } else if (slot === 'cloak') {
      matching = invItems.filter(i => i.itemId.includes('cloak')).map(i => choiceItem(i));
    } else if (slot === 'amulet') {
      matching = invItems.filter(i => i.itemId.includes('amulet') || i.itemId.includes('necklace') || i.itemId.includes('periapt')).map(i => choiceItem(i));
    } else if (slot === 'ring1') {
      matching = invItems.filter(i => i.itemId.includes('ring')).map(i => choiceItem(i));
    }

    modal.innerHTML = `
      <div class="modal" style="max-width:440px;">
        <h2>${label("ui.sheet.equip")} ${slotLabels[slot] ? label(slotLabels[slot]) : esc(slot)}</h2>
        <p class="small muted">${label("ui.sheet.select_an_item_from_your_pack_to")}</p>
        <div style="display:flex; flex-direction:column; gap:8px; margin:14px 0; max-height:280px; overflow-y:auto;">
          ${matching.length ? matching.map(item => `
            <div class="stat-line" style="background:var(--bg-box); padding:10px 12px; border-radius:6px; border:1px solid var(--border);">
              <div>
                <b>${contentLabel(item,"name")}</b> <span class="muted small">(×${item.qty})</span>
                <div class="small muted">${displayLabel(item.descDisplay,item.desc || item.damage || (item.ac ? 'AC '+item.ac : ''))}</div>
              </div>
              <button class="btn small primary" data-equip-id="${item.id}">${label("ui.sheet.equip")}</button>
            </div>
          `).join('') : `<p class="muted small" style="text-align:center; padding:16px;">${label("ui.sheet.no_compatible_items_in_your_backpack")}</p>`}
        </div>
        <div style="display:flex; justify-content:space-between; align-items:center; margin-top:14px;">
          <button class="btn small" id="unequipBtn" style="color:var(--red);">${label("ui.sheet.unequip_slot")}</button>
          <button class="btn small" id="closeEquipModal">${label("ui.sheet.cancel")}</button>
        </div>
      </div>
    `;

    (/** @type {NodeListOf<HTMLButtonElement>} */ (modal.querySelectorAll('[data-equip-id]'))).forEach(btn => {
      btn.addEventListener('click', async () => {
        const itemId = btn.getAttribute('data-equip-id');
        try {
          btn.disabled = true;
          await api.equipCharacter(char.id, slot, itemId);
          if (!navigation.isCurrent()) return;
          modal.remove();
          toast(() => t('ui.common.equipped', { item: getItemName(itemId) }));
          // Re-enter through the router so the old subscription is released and
          // this asynchronous sheet refresh gets its own navigation lifetime.
          const { navigate } = await import('../app.js');
          if (navigation.isCurrent()) navigate();
        } catch (e) {
          if (!navigation.isCurrent()) return;
          toast(() => e.message);
          btn.disabled = false;
        }
      });
    });

    document.getElementById('unequipBtn').addEventListener('click', async () => {
      try {
        await api.equipCharacter(char.id, slot, 'none');
        if (!navigation.isCurrent()) return;
        modal.remove();
        toast(() => t("ui.sheet.slot_unequipped"));
        const { navigate } = await import('../app.js');
        if (navigation.isCurrent()) navigate();
      } catch (e) {
        if (!navigation.isCurrent()) return;
        toast(() => e.message);
      }
    });

    document.getElementById('closeEquipModal').addEventListener('click', () => modal.remove());
  }

  main.querySelectorAll('.paperdoll-slot').forEach(slotEl => {
    slotEl.addEventListener('click', () => {
      openEquipModal(slotEl.getAttribute('data-slot'));
    });
  });

  const regenBtn = /** @type {HTMLButtonElement | null} */ (document.getElementById('regenPortraitBtn'));
  if (regenBtn) {
    regenBtn.addEventListener('click', async () => {
      regenBtn.disabled = true;
      localizeText(regenBtn, () => t("ui.sheet.generating"));
      try {
        const port = await api.characterPortrait(char.id, true);
        if (!navigation.isCurrent()) return;
        const img = /** @type {HTMLImageElement | null} */ (document.getElementById('heroPortraitImg'));
        if (img && port && port.url) img.src = port.url;
        localizeText(regenBtn, () => t("ui.sheet.regenerated"));
      } catch (e) {
        if (!navigation.isCurrent()) return;
        localizeText(regenBtn, () => t("ui.sheet.failed"));
      } finally {
        setTimeout(() => {
          if (!navigation.isCurrent()) return;
          regenBtn.disabled = false;
          localizeText(regenBtn, () => t("ui.sheet.regenerate_portrait"));
        }, 2000);
      }
    });
  }

  initTooltips(main, rules);
  function refreshLocalizedText() { translateDOM(main); }
  return navigation.onDispose(onLocaleChange(refreshLocalizedText));
}

function skillProfMod(char, skill) {
  let m = modOf(char.abilities[SKILL_ABILITY[skill]]);
  if (char.skills.includes(skill)) { m += char.profBonus; if (char.expertise.includes(skill)) m += char.profBonus; }
  return m;
}
