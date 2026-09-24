// tooltip.js — Universal Hoverable Lore & Rarity Tooltip System (D&D 2024 rules)

export const RARITIES = {
  common: { label: 'Common', color: '#d8cfc0', border: 'rgba(216, 207, 192, 0.4)', bgGlow: 'rgba(216, 207, 192, 0.05)' },
  magic: { label: 'Magic', color: '#60a5fa', border: 'rgba(96, 165, 250, 0.55)', bgGlow: 'rgba(96, 165, 250, 0.12)' },
  uncommon: { label: 'Uncommon', color: '#4ade80', border: 'rgba(74, 222, 128, 0.5)', bgGlow: 'rgba(74, 222, 128, 0.1)' },
  rare: { label: 'Rare', color: '#c084fc', border: 'rgba(192, 132, 252, 0.6)', bgGlow: 'rgba(192, 132, 252, 0.14)' },
  very_rare: { label: 'Very Rare', color: '#c084fc', border: 'rgba(192, 132, 252, 0.7)', bgGlow: 'rgba(192, 132, 252, 0.15)' },
  legendary: { label: 'Legendary', color: '#f59e0b', border: 'rgba(245, 158, 11, 0.8)', bgGlow: 'rgba(245, 158, 11, 0.2)' },
  artifact: { label: 'Artifact', color: '#e11d48', border: 'rgba(225, 29, 72, 0.85)', bgGlow: 'rgba(225, 29, 72, 0.25)' }
};

export const WEAPON_MASTERIES = {
  vex: { name: 'Vex', desc: 'Hitting a creature grants Advantage on your next attack roll against it before the end of your next turn.' },
  nick: { name: 'Nick', desc: 'You can make the additional attack of the Light weapon property as part of the Attack action instead of a Bonus Action.' },
  topple: { name: 'Topple', desc: 'On a hit, the target must succeed on a CON save or be knocked Prone.' },
  push: { name: 'Push', desc: 'On a hit, you push the target up to 10 feet straight away from you.' },
  slow: { name: 'Slow', desc: 'On a hit, the target’s speed is reduced by 10 feet until the start of your next turn.' },
  sap: { name: 'Sap', desc: 'On a hit, the target has Disadvantage on its next attack roll before the start of your next turn.' },
  cleave: { name: 'Cleave', desc: 'On a hit, you can make a melee attack roll against a second creature within 5 ft of the target.' },
  graze: { name: 'Graze', desc: 'If your attack roll misses, you still deal damage equal to the ability modifier used for the attack.' }
};

// Item lore, metadata, masteries, and rarity catalog
export const ITEM_DATABASE = {
  // --- Magic & Special Weapons ---
  silver_sword: {
    rarity: 'rare',
    category: 'Martial Melee Weapon',
    mastery: 'vex',
    lore: 'Forged in silvered moonlight by the smiths of High Oakhaven. Its mirrored edge gleams with an ethereal blue sheen whenever undead or fiends draw near.',
    properties: ['finesse', 'light', 'silvered', 'magic +1']
  },
  flame_dagger: {
    rarity: 'rare',
    category: 'Simple Melee Weapon',
    mastery: 'nick',
    lore: 'An obsidian blade etched with draconic runes that ignite into a roaring orange ember upon the whisper of its command word.',
    properties: ['finesse', 'light', 'thrown', 'fire +1d4', 'magic +1']
  },
  crypt_cleaver: {
    rarity: 'very_rare',
    category: 'Martial Melee Weapon',
    mastery: 'cleave',
    lore: 'A massive greataxe hewn from the black marble slabs of an ancient crypt. It thrums with kinetic weight that cleaves through bone and stone with equal ferocity.',
    properties: ['heavy', 'two_handed', 'magic +1', 'tomb-resonance']
  },
  relic: {
    rarity: 'legendary',
    category: 'Artifact & Quest Relic',
    lore: 'The Sunless Crypt’s foundational heartstone. Within its crystallized core swirls the dormant primordial radiance of an epoch long forgotten.',
    properties: ['objective', 'indestructible', 'radiant aura']
  },
  cloak_protection: {
    rarity: 'rare',
    category: 'Wondrous Item',
    lore: 'Woven from spun silken thread and enchanted with protective abjurations that bend incoming blades away from mortal flesh.',
    properties: ['+1 AC', 'attunement', 'abjuration']
  },
  amulet_of_vigor: {
    rarity: 'rare',
    category: 'Wondrous Trinket',
    lore: 'A crimson garnet set in unyielding dwarven gold. It pulses in tandem with its bearer’s heartbeat, imbuing the blood with enduring vitality.',
    properties: ['+5 Max HP', 'trinket', 'transmutation']
  },

  // --- Consumables & Scrolls ---
  potion_healing: {
    rarity: 'common',
    category: 'Potion · Consumable',
    lore: 'A glimmering crimson draught that smells of crushed mountain mint and wild honey. Quickens clotting and seals open lacerations.',
    effect: 'Bonus action to drink or administer: Regains 2d4 + 2 Hit Points.'
  },
  potion_greater: {
    rarity: 'uncommon',
    category: 'Potion · Consumable',
    lore: 'A deep ruby elixir flecked with distilled golden flakes. Distilled by master alchemists to mend crushed bone and internal injuries.',
    effect: 'Bonus action to drink: Regains 4d4 + 4 Hit Points.'
  },
  scroll_magic_missile: {
    rarity: 'uncommon',
    category: 'Spell Scroll · Evocation',
    lore: 'Parchment inscribed with sharp celestial geometric diagrams that unleash unerring darts of glowing arcane force upon utterance.',
    effect: 'Cast Magic Missile without expending a spell slot: 3 glowing darts deal 3d4 + 3 force damage.'
  },
  scroll_shield: {
    rarity: 'uncommon',
    category: 'Spell Scroll · Abjuration',
    lore: 'A stiff vellum scroll depicting a glowing aegis. Reactively creates an invisible barrier against incoming assaults.',
    effect: 'Cast Shield: Grants +5 AC until your next turn and nullifies Magic Missile.'
  },
  scroll_cure: {
    rarity: 'uncommon',
    category: 'Spell Scroll · Evocation',
    lore: 'Inscribed with soothing prayers of restoration. Channels radiant mending through your hands.',
    effect: 'Cast Cure Wounds: Restores 1d8 + 3 Hit Points to yourself or an adjacent ally.'
  },
  scroll_sleep: {
    rarity: 'uncommon',
    category: 'Spell Scroll · Enchantment',
    lore: 'Sprinkled with fine sand from the Astral Sea. Overwhelms weary minds with an intoxicating slumber.',
    effect: 'Cast Sleep: Puts up to 5d8 HP of hostile creatures into a magical slumber.'
  },

  // --- Tools & Gear ---
  thieves_tools: {
    rarity: 'common',
    category: 'Artisan & Roguish Tool',
    lore: 'A leather roll filled with fine lockpicks, tension wrenches, miniature mirrors, and delicate files for disarming triggers and unpicking tumbler locks.',
    effect: 'Enables Sleight of Hand checks to pick locked chests and disarm mechanical traps.'
  },
  healers_kit: {
    rarity: 'common',
    category: 'Medical Gear',
    lore: 'Leather pouches containing sterile bandages, splints, tourniquets, and medicinal salves.',
    effect: 'Stabilizes a dying creature or triggers the Healer feat without expending spell slots.'
  },
  shield: {
    rarity: 'common',
    category: 'Armor · Shield',
    lore: 'A sturdy kite shield forged of banded ash wood and rimmed with wrought iron.',
    effect: '+2 AC while equipped in your off-hand.'
  },
  torch: {
    rarity: 'common',
    category: 'Adventuring Gear',
    lore: 'Pitch-soaked wood that burns bright in darkness, casting 20 ft of bright light and 20 ft of dim light.',
    effect: 'Illuminates dark dungeon chambers.'
  },

  // --- Common Weapons with D&D 2024 Masteries ---
  dagger: {
    rarity: 'common',
    category: 'Simple Melee Weapon',
    mastery: 'nick',
    lore: 'A swift, double-edged combat dagger balanced for throwing and quick off-hand parries.',
    properties: ['finesse', 'light', 'thrown (20/60)']
  },
  shortsword: {
    rarity: 'common',
    category: 'Martial Melee Weapon',
    mastery: 'vex',
    lore: 'A nimble thrusting sword with a tapered point, favored by scouts and duelists for exploiting enemy guard.',
    properties: ['finesse', 'light']
  },
  longsword: {
    rarity: 'common',
    category: 'Martial Melee Weapon',
    mastery: 'sap',
    lore: 'The consummate weapon of chivalry and frontline combat. Balanced for either one-handed parrying or two-handed heavy strikes.',
    properties: ['versatile (1d10)']
  },
  greatsword: {
    rarity: 'common',
    category: 'Martial Melee Weapon',
    mastery: 'graze',
    lore: 'A massive two-handed blade capable of cleaving armor, shields, and bone with sheer momentum.',
    properties: ['heavy', 'two_handed']
  },
  greataxe: {
    rarity: 'common',
    category: 'Martial Melee Weapon',
    mastery: 'cleave',
    lore: 'A broad-bladed crescent axe with crushing weight behind every executioner swing.',
    properties: ['heavy', 'two_handed']
  },
  battleaxe: {
    rarity: 'common',
    category: 'Martial Melee Weapon',
    mastery: 'topple',
    lore: 'A heavy martial axe with a thick beard and hammer poll, designed to knock opponents off-balance.',
    properties: ['versatile (1d10)']
  },
  maul: {
    rarity: 'common',
    category: 'Martial Melee Weapon',
    mastery: 'topple',
    lore: 'An eight-pound iron hammer head mounted on reinforced hickory. Knocks foes flat to the stone floor.',
    properties: ['heavy', 'two_handed']
  },
  warhammer: {
    rarity: 'common',
    category: 'Martial Melee Weapon',
    mastery: 'push',
    lore: 'A versatile warhammer featuring a spiked beak and blunt face, built to drive foes back.',
    properties: ['versatile (1d10)']
  },
  quarterstaff: {
    rarity: 'common',
    category: 'Simple Melee Weapon',
    mastery: 'topple',
    lore: 'Treated oak staff wrapped in grip leather, equally suited for walking or tripping armored adversaries.',
    properties: ['versatile (1d8)']
  },
  mace: {
    rarity: 'common',
    category: 'Simple Melee Weapon',
    mastery: 'sap',
    lore: 'A flanged steel mace designed to ring skulls and disorient enemy combatants.',
    properties: []
  },
  club: {
    rarity: 'common',
    category: 'Simple Melee Weapon',
    mastery: 'slow',
    lore: 'A dense hardwood cudgel weighted to stagger enemy footing.',
    properties: ['light']
  },
  handaxe: {
    rarity: 'common',
    category: 'Simple Melee Weapon',
    mastery: 'vex',
    lore: 'A compact woodcutter’s axe honed for hand-to-hand combat and lethal throws.',
    properties: ['light', 'thrown (20/60)']
  },
  spear: {
    rarity: 'common',
    category: 'Simple Melee Weapon',
    mastery: 'sap',
    lore: 'A leaf-tipped steel spear, dependable for keeping vicious beasts at bay.',
    properties: ['thrown (20/60)', 'versatile (1d8)']
  },
  shortbow: {
    rarity: 'common',
    category: 'Simple Ranged Weapon',
    mastery: 'vex',
    lore: 'A light composite bow strung with seasoned hemp, quick to draw and loose.',
    properties: ['ammunition (80/320)', 'two_handed']
  },
  longbow: {
    rarity: 'common',
    category: 'Martial Ranged Weapon',
    mastery: 'slow',
    lore: 'A six-foot yew warbow capable of piercing mail at immense distance.',
    properties: ['ammunition (150/600)', 'heavy', 'two_handed']
  },
  lightcrossbow: {
    rarity: 'common',
    category: 'Simple Ranged Weapon',
    mastery: 'slow',
    lore: 'A mechanical latch crossbow firing hardened iron bolts that stagger charging targets.',
    properties: ['ammunition (80/320)', 'loading', 'two_handed']
  },

  // --- Armor ---
  leather: {
    rarity: 'common',
    category: 'Light Armor',
    lore: 'Cured and boiled leather breastplate with flexible greaves, offering agile protection without slowing stealthy movement.',
    properties: ['11 + DEX AC', 'Lightweight']
  },
  studded_leather: {
    rarity: 'common',
    category: 'Light Armor',
    lore: 'Supple leather reinforced with close-set steel rivets and plates, balancing silence and defensive resilience.',
    properties: ['12 + DEX AC', 'No stealth penalty']
  },
  chain_shirt: {
    rarity: 'common',
    category: 'Medium Armor',
    lore: 'Interlocking steel rings sandwiched between layers of quilted cloth, guarding the vital torso.',
    properties: ['13 + DEX (max 2) AC']
  },
  scale_mail: {
    rarity: 'common',
    category: 'Medium Armor',
    lore: 'Overlapping brass scales riveted to a leather tunic, durable against beast bites and cleaving strikes.',
    properties: ['14 + DEX (max 2) AC', 'Disadvantage on Stealth']
  },
  breastplate: {
    rarity: 'uncommon',
    category: 'Medium Armor',
    lore: 'A masterfully polished steel cuirass with backplate, leaving the limbs completely uninhibited.',
    properties: ['14 + DEX (max 2) AC', 'No stealth penalty']
  },
  half_plate: {
    rarity: 'uncommon',
    category: 'Medium Armor',
    lore: 'Shaped steel plates covering the torso and joints, offering near-complete knightly coverage.',
    properties: ['15 + DEX (max 2) AC', 'Disadvantage on Stealth']
  },
  chain_mail: {
    rarity: 'common',
    category: 'Heavy Armor',
    lore: 'A full hauberk of woven steel rings worn over padded gambeson, standard issue for garrison knights.',
    properties: ['16 AC', 'Min STR 13', 'Disadvantage on Stealth']
  },
  splint: {
    rarity: 'uncommon',
    category: 'Heavy Armor',
    lore: 'Vertical steel strips riveted to a backing of leather and chain, stopping heavy bludgeons and spears.',
    properties: ['17 AC', 'Min STR 15', 'Disadvantage on Stealth']
  },
  plate: {
    rarity: 'uncommon',
    category: 'Heavy Armor',
    lore: 'The zenith of protective metallurgy: fitted interlocking tempered steel plates encasing the wearer from neck to heel.',
    properties: ['18 AC', 'Min STR 15', 'Disadvantage on Stealth']
  }
};

let tooltipEl = null;

function ensureTooltipElement() {
  if (!tooltipEl) {
    tooltipEl = document.createElement('div');
    tooltipEl.className = 'dnd-lore-tooltip';
    tooltipEl.id = 'dndLoreTooltip';
    document.body.appendChild(tooltipEl);
  }
  return tooltipEl;
}

export function buildItemTooltipHtml(item, rulesData = {}) {
  if (!item) return '';
  const itemId = typeof item === 'string' ? item : (item.id || item.itemId);
  let def = rulesData[itemId] || null;
  if (!def && rulesData) {
    const allRulesItems = [
      ...(rulesData.weapons || []),
      ...(rulesData.armor || []),
      ...(rulesData.gear || []),
      ...(rulesData.shop || [])
    ];
    def = allRulesItems.find(x => x && x.id === itemId);
  }
  const staticData = ITEM_DATABASE[itemId] || {};
  def = def || staticData || {};

  let name = (typeof item === 'object' && item && item.name) || def.name || null;
  if (!name || name === itemId) {
    name = itemId.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  }

  const rarityKey = (typeof item === 'object' && item.rarity) || staticData.rarity || def.rarity || 'common';
  const rarity = RARITIES[rarityKey] || RARITIES.common;
  const category = staticData.category || def.type || 'Adventuring Equipment';

  const masteryKey = staticData.mastery || def.mastery;
  const mastery = masteryKey ? WEAPON_MASTERIES[masteryKey] : null;

  // Build stat pills
  const stats = [];
  if (def.damage) stats.push(`🗡 <b>${def.damage}</b> ${def.damageType || ''}`);
  if (def.versatile) stats.push(`⚔ <b>${def.versatile}</b> 2H`);
  if (def.ac) stats.push(`🛡 <b>${def.ac} AC</b>`);
  if (def.acBonus) stats.push(`🛡 <b>+${def.acBonus} AC</b>`);
  if (def.hpBonus) stats.push(`❤️ <b>+${def.hpBonus} Max HP</b>`);
  if (def.heal) stats.push(`🧪 <b>+${def.heal} HP</b>`);
  if (def.range) stats.push(`🎯 <b>${def.range} ft</b>`);
  if (def.cost) stats.push(`💰 <b>${def.cost} gp</b>`);
  // rolled affix gear: show the rolled modifiers, not just the base item
  if (typeof item === 'object' && item) {
    if (item.magic) stats.push(`✨ <b>+${item.magic}</b> ${item.type === 'weapon' ? 'to hit & damage' : 'enhancement'}`);
    if (item.bonusDamage) stats.push(`🔥 <b>+${item.bonusDamage.dice}</b> ${item.bonusDamage.type} damage`);
    if (item.vampiricHeal) stats.push(`🩸 <b>+${item.vampiricHeal} HP</b> on hit`);
    if (item.acBonus) stats.push(`🛡 <b>+${item.acBonus} AC</b>`);
    if (item.hpBonus) stats.push(`❤️ <b>+${item.hpBonus} Max HP</b>`);
    if (item.speedBonus) stats.push(`👣 <b>+${item.speedBonus} ft</b> speed`);
  }

  const props = staticData.properties || def.props || [];
  const lore = staticData.lore || def.desc || 'A sturdy adventurer’s implement, scarred by past subterranean trials.';
  const rolledDesc = (typeof item === 'object' && item && item.desc) ? item.desc : '';
  const effect = rolledDesc || staticData.effect || (def.desc && def.desc !== lore ? def.desc : '');

  return `
    <div class="tooltip-header" style="border-bottom-color: ${rarity.border};">
      <div class="tooltip-title" style="color: ${rarity.color};">${name}</div>
      <div class="tooltip-subtitle">
        <span class="tooltip-rarity" style="color: ${rarity.color}; background: ${rarity.bgGlow}; border-color: ${rarity.border};">${rarity.label}</span>
        <span class="tooltip-category">${category}</span>
      </div>
    </div>

    ${stats.length ? `
      <div class="tooltip-stats">
        ${stats.map(s => `<span class="tooltip-stat-pill">${s}</span>`).join('')}
      </div>` : ''}

    ${mastery ? `
      <div class="tooltip-mastery-box">
        <div class="tooltip-mastery-title">
          <span class="mastery-tag">D&D 2024 Mastery</span> <b>${mastery.name}</b>
        </div>
        <div class="tooltip-mastery-desc">${mastery.desc}</div>
      </div>` : ''}

    ${effect ? `
      <div class="tooltip-effect">
        <b>Effect:</b> ${effect}
      </div>` : ''}

    ${props.length ? `
      <div class="tooltip-props">
        ${props.map(p => `<span class="prop-chip">${p}</span>`).join(' ')}
      </div>` : ''}

    <div class="tooltip-lore">
      "${lore}"
    </div>
  `;
}

export function showTooltip(e, item, rulesData = {}) {
  const el = ensureTooltipElement();
  const html = buildItemTooltipHtml(item, rulesData);
  if (!html) return hideTooltip();

  const itemId = typeof item === 'string' ? item : (item.id || item.itemId);
  const staticData = ITEM_DATABASE[itemId] || {};
  const rarity = RARITIES[staticData.rarity || 'common'] || RARITIES.common;

  el.innerHTML = html;
  el.style.borderColor = rarity.border;
  el.style.boxShadow = `0 10px 30px rgba(0,0,0,0.85), 0 0 20px ${rarity.bgGlow}`;
  el.style.display = 'block';

  positionTooltip(e);
}

export function positionTooltip(e) {
  if (!tooltipEl || tooltipEl.style.display === 'none') return;
  const padding = 15;
  const rect = tooltipEl.getBoundingClientRect();
  let x = e.clientX + 16;
  let y = e.clientY + 16;

  // Viewport bounds detection
  if (x + rect.width > window.innerWidth - padding) {
    x = e.clientX - rect.width - 12;
  }
  if (y + rect.height > window.innerHeight - padding) {
    y = window.innerHeight - rect.height - padding;
  }
  if (x < padding) x = padding;
  if (y < padding) y = padding;

  tooltipEl.style.left = `${Math.round(x)}px`;
  tooltipEl.style.top = `${Math.round(y)}px`;
}

export function hideTooltip() {
  if (tooltipEl) {
    tooltipEl.style.display = 'none';
  }
}

/**
 * Universal initializer: binds mouseover/mousemove/mouseleave events
 * to any element with [data-item-tooltip="itemId"] within container.
 */
export function initTooltips(container = document, rulesCatalog = {}) {
  ensureTooltipElement();

  // touch devices never fire mouseleave, so a tapped tooltip would stay on screen forever.
  // Tap to show, tap anywhere else (or after a few seconds) to dismiss.
  if (!window.__dndTooltipTouchBound) {
    window.__dndTooltipTouchBound = true;
    document.addEventListener('touchstart', (ev) => {
      const target = ev.target && ev.target.closest ? ev.target.closest('[data-item-tooltip]') : null;
      if (!target) { hideTooltip(); return; }
      const payload = target.getAttribute('data-item-tooltip');
      if (!payload) return;
      const touch = ev.touches && ev.touches[0];
      const point = touch || { clientX: 0, clientY: 0 };
      if (payload.trim().startsWith('{')) {
        try { showTooltip(point, JSON.parse(payload), container.__rules || {}); } catch { /* id lookup below */ }
      } else {
        showTooltip(point, payload, container.__rules || {});
      }
      clearTimeout(window.__dndTooltipTimer);
      window.__dndTooltipTimer = setTimeout(hideTooltip, 4000);
    }, { passive: true });
  }

  container.querySelectorAll('[data-item-tooltip]').forEach(el => {
    if (el._hasTooltip) return;
    el._hasTooltip = true;

    el.addEventListener('mouseenter', (e) => {
      const itemId = el.getAttribute('data-item-tooltip');
      if (!itemId) return;
      // rolled / procedurally generated gear passes its full data as JSON
      if (itemId.trim().startsWith('{')) {
        try { return showTooltip(e, JSON.parse(itemId), rulesCatalog); } catch { /* fall through to id lookup */ }
      }
      showTooltip(e, itemId, rulesCatalog);
    });

    el.addEventListener('mousemove', (e) => {
      positionTooltip(e);
    });

    el.addEventListener('mouseleave', () => {
      hideTooltip();
    });
  });
}
