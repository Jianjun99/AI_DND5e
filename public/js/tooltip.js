// tooltip.js — Universal Hoverable Lore & Rarity Tooltip System (D&D 2024 rules)

import { label, contentLabel, displayLabel } from './i18n.js';

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
  vex: { name: 'Vex', desc: 'Hitting a creature grants Advantage on your next attack roll against it before the end of your next turn.' , "nameDisplay":{"key":"content.tooltip.vex.name","fallback":"Vex"},"descDisplay":{"key":"content.tooltip.vex.desc","fallback":"Hitting a creature grants Advantage on your next attack roll against it before the end of your next turn."}},
  nick: { name: 'Nick', desc: 'You can make the additional attack of the Light weapon property as part of the Attack action instead of a Bonus Action.' , "nameDisplay":{"key":"content.tooltip.nick.name","fallback":"Nick"},"descDisplay":{"key":"content.tooltip.nick.desc","fallback":"You can make the additional attack of the Light weapon property as part of the Attack action instead of a Bonus Action."}},
  topple: { name: 'Topple', desc: 'On a hit, the target must succeed on a CON save or be knocked Prone.' , "nameDisplay":{"key":"content.tooltip.topple.name","fallback":"Topple"},"descDisplay":{"key":"content.tooltip.topple.desc","fallback":"On a hit, the target must succeed on a CON save or be knocked Prone."}},
  push: { name: 'Push', desc: 'On a hit, you push the target up to 10 feet straight away from you.' , "nameDisplay":{"key":"content.tooltip.push.name","fallback":"Push"},"descDisplay":{"key":"content.tooltip.push.desc","fallback":"On a hit, you push the target up to 10 feet straight away from you."}},
  slow: { name: 'Slow', desc: 'On a hit, the target’s speed is reduced by 10 feet until the start of your next turn.' , "nameDisplay":{"key":"content.tooltip.slow.name","fallback":"Slow"},"descDisplay":{"key":"content.tooltip.slow.desc","fallback":"On a hit, the target’s speed is reduced by 10 feet until the start of your next turn."}},
  sap: { name: 'Sap', desc: 'On a hit, the target has Disadvantage on its next attack roll before the start of your next turn.' , "nameDisplay":{"key":"content.tooltip.sap.name","fallback":"Sap"},"descDisplay":{"key":"content.tooltip.sap.desc","fallback":"On a hit, the target has Disadvantage on its next attack roll before the start of your next turn."}},
  cleave: { name: 'Cleave', desc: 'On a hit, you can make a melee attack roll against a second creature within 5 ft of the target.' , "nameDisplay":{"key":"content.tooltip.cleave.name","fallback":"Cleave"},"descDisplay":{"key":"content.tooltip.cleave.desc","fallback":"On a hit, you can make a melee attack roll against a second creature within 5 ft of the target."}},
  graze: { name: 'Graze', desc: 'If your attack roll misses, you still deal damage equal to the ability modifier used for the attack.' , "nameDisplay":{"key":"content.tooltip.graze.name","fallback":"Graze"},"descDisplay":{"key":"content.tooltip.graze.desc","fallback":"If your attack roll misses, you still deal damage equal to the ability modifier used for the attack."}}
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
  , "categoryDisplay":{"key":"content.tooltip.silver_sword.category","fallback":"Martial Melee Weapon"},"loreDisplay":{"key":"content.tooltip.silver_sword.lore","fallback":"Forged in silvered moonlight by the smiths of High Oakhaven. Its mirrored edge gleams with an ethereal blue sheen whenever undead or fiends draw near."}, propertiesDisplay:[{"key":"content.tooltip.silver_sword.property0","fallback":"finesse"},{"key":"content.tooltip.silver_sword.property1","fallback":"light"},{"key":"content.tooltip.silver_sword.property2","fallback":"silvered"},{"key":"content.tooltip.silver_sword.property3","fallback":"magic +1"}]},
  flame_dagger: {
    rarity: 'rare',
    category: 'Simple Melee Weapon',
    mastery: 'nick',
    lore: 'An obsidian blade etched with draconic runes that ignite into a roaring orange ember upon the whisper of its command word.',
    properties: ['finesse', 'light', 'thrown', 'fire +1d4', 'magic +1']
  , "categoryDisplay":{"key":"content.tooltip.flame_dagger.category","fallback":"Simple Melee Weapon"},"loreDisplay":{"key":"content.tooltip.flame_dagger.lore","fallback":"An obsidian blade etched with draconic runes that ignite into a roaring orange ember upon the whisper of its command word."}, propertiesDisplay:[{"key":"content.tooltip.flame_dagger.property0","fallback":"finesse"},{"key":"content.tooltip.flame_dagger.property1","fallback":"light"},{"key":"content.tooltip.flame_dagger.property2","fallback":"thrown"},{"key":"content.tooltip.flame_dagger.property3","fallback":"fire +1d4"},{"key":"content.tooltip.flame_dagger.property4","fallback":"magic +1"}]},
  crypt_cleaver: {
    rarity: 'very_rare',
    category: 'Martial Melee Weapon',
    mastery: 'cleave',
    lore: 'A massive greataxe hewn from the black marble slabs of an ancient crypt. It thrums with kinetic weight that cleaves through bone and stone with equal ferocity.',
    properties: ['heavy', 'two_handed', 'magic +1', 'tomb-resonance']
  , "categoryDisplay":{"key":"content.tooltip.crypt_cleaver.category","fallback":"Martial Melee Weapon"},"loreDisplay":{"key":"content.tooltip.crypt_cleaver.lore","fallback":"A massive greataxe hewn from the black marble slabs of an ancient crypt. It thrums with kinetic weight that cleaves through bone and stone with equal ferocity."}, propertiesDisplay:[{"key":"content.tooltip.crypt_cleaver.property0","fallback":"heavy"},{"key":"content.tooltip.crypt_cleaver.property1","fallback":"two_handed"},{"key":"content.tooltip.crypt_cleaver.property2","fallback":"magic +1"},{"key":"content.tooltip.crypt_cleaver.property3","fallback":"tomb-resonance"}]},
  relic: {
    rarity: 'legendary',
    category: 'Artifact & Quest Relic',
    lore: 'The Sunless Crypt’s foundational heartstone. Within its crystallized core swirls the dormant primordial radiance of an epoch long forgotten.',
    properties: ['objective', 'indestructible', 'radiant aura']
  , "categoryDisplay":{"key":"content.tooltip.relic.category","fallback":"Artifact & Quest Relic"},"loreDisplay":{"key":"content.tooltip.relic.lore","fallback":"The Sunless Crypt’s foundational heartstone. Within its crystallized core swirls the dormant primordial radiance of an epoch long forgotten."}, propertiesDisplay:[{"key":"content.tooltip.relic.property0","fallback":"objective"},{"key":"content.tooltip.relic.property1","fallback":"indestructible"},{"key":"content.tooltip.relic.property2","fallback":"radiant aura"}]},
  cloak_protection: {
    rarity: 'rare',
    category: 'Wondrous Item',
    lore: 'Woven from spun silken thread and enchanted with protective abjurations that bend incoming blades away from mortal flesh.',
    properties: ['+1 AC', 'attunement', 'abjuration']
  , "categoryDisplay":{"key":"content.tooltip.cloak_protection.category","fallback":"Wondrous Item"},"loreDisplay":{"key":"content.tooltip.cloak_protection.lore","fallback":"Woven from spun silken thread and enchanted with protective abjurations that bend incoming blades away from mortal flesh."}, propertiesDisplay:[{"key":"content.tooltip.cloak_protection.property0","fallback":"+1 AC"},{"key":"content.tooltip.cloak_protection.property1","fallback":"attunement"},{"key":"content.tooltip.cloak_protection.property2","fallback":"abjuration"}]},
  amulet_of_vigor: {
    rarity: 'rare',
    category: 'Wondrous Trinket',
    lore: 'A crimson garnet set in unyielding dwarven gold. It pulses in tandem with its bearer’s heartbeat, imbuing the blood with enduring vitality.',
    properties: ['+5 Max HP', 'trinket', 'transmutation']
  , "categoryDisplay":{"key":"content.tooltip.amulet_of_vigor.category","fallback":"Wondrous Trinket"},"loreDisplay":{"key":"content.tooltip.amulet_of_vigor.lore","fallback":"A crimson garnet set in unyielding dwarven gold. It pulses in tandem with its bearer’s heartbeat, imbuing the blood with enduring vitality."}, propertiesDisplay:[{"key":"content.tooltip.amulet_of_vigor.property0","fallback":"+5 Max HP"},{"key":"content.tooltip.amulet_of_vigor.property1","fallback":"trinket"},{"key":"content.tooltip.amulet_of_vigor.property2","fallback":"transmutation"}]},

  // --- Consumables & Scrolls ---
  potion_healing: {
    rarity: 'common',
    category: 'Potion · Consumable',
    lore: 'A glimmering crimson draught that smells of crushed mountain mint and wild honey. Quickens clotting and seals open lacerations.',
    effect: 'Bonus action to drink or administer: Regains 2d4 + 2 Hit Points.'
  , "categoryDisplay":{"key":"content.tooltip.potion_healing.category","fallback":"Potion · Consumable"},"loreDisplay":{"key":"content.tooltip.potion_healing.lore","fallback":"A glimmering crimson draught that smells of crushed mountain mint and wild honey. Quickens clotting and seals open lacerations."},"effectDisplay":{"key":"content.tooltip.potion_healing.effect","fallback":"Bonus action to drink or administer: Regains 2d4 + 2 Hit Points."}},
  potion_greater: {
    rarity: 'uncommon',
    category: 'Potion · Consumable',
    lore: 'A deep ruby elixir flecked with distilled golden flakes. Distilled by master alchemists to mend crushed bone and internal injuries.',
    effect: 'Bonus action to drink: Regains 4d4 + 4 Hit Points.'
  , "categoryDisplay":{"key":"content.tooltip.potion_greater.category","fallback":"Potion · Consumable"},"loreDisplay":{"key":"content.tooltip.potion_greater.lore","fallback":"A deep ruby elixir flecked with distilled golden flakes. Distilled by master alchemists to mend crushed bone and internal injuries."},"effectDisplay":{"key":"content.tooltip.potion_greater.effect","fallback":"Bonus action to drink: Regains 4d4 + 4 Hit Points."}},
  scroll_magic_missile: {
    rarity: 'uncommon',
    category: 'Spell Scroll · Evocation',
    lore: 'Parchment inscribed with sharp celestial geometric diagrams that unleash unerring darts of glowing arcane force upon utterance.',
    effect: 'Cast Magic Missile without expending a spell slot: 3 glowing darts deal 3d4 + 3 force damage.'
  , "categoryDisplay":{"key":"content.tooltip.scroll_magic_missile.category","fallback":"Spell Scroll · Evocation"},"loreDisplay":{"key":"content.tooltip.scroll_magic_missile.lore","fallback":"Parchment inscribed with sharp celestial geometric diagrams that unleash unerring darts of glowing arcane force upon utterance."},"effectDisplay":{"key":"content.tooltip.scroll_magic_missile.effect","fallback":"Cast Magic Missile without expending a spell slot: 3 glowing darts deal 3d4 + 3 force damage."}},
  scroll_shield: {
    rarity: 'uncommon',
    category: 'Spell Scroll · Abjuration',
    lore: 'A stiff vellum scroll depicting a glowing aegis. Reactively creates an invisible barrier against incoming assaults.',
    effect: 'Cast Shield: Grants +5 AC until your next turn and nullifies Magic Missile.'
  , "categoryDisplay":{"key":"content.tooltip.scroll_shield.category","fallback":"Spell Scroll · Abjuration"},"loreDisplay":{"key":"content.tooltip.scroll_shield.lore","fallback":"A stiff vellum scroll depicting a glowing aegis. Reactively creates an invisible barrier against incoming assaults."},"effectDisplay":{"key":"content.tooltip.scroll_shield.effect","fallback":"Cast Shield: Grants +5 AC until your next turn and nullifies Magic Missile."}},
  scroll_cure: {
    rarity: 'uncommon',
    category: 'Spell Scroll · Evocation',
    lore: 'Inscribed with soothing prayers of restoration. Channels radiant mending through your hands.',
    effect: 'Cast Cure Wounds: Restores 1d8 + 3 Hit Points to yourself or an adjacent ally.'
  , "categoryDisplay":{"key":"content.tooltip.scroll_cure.category","fallback":"Spell Scroll · Evocation"},"loreDisplay":{"key":"content.tooltip.scroll_cure.lore","fallback":"Inscribed with soothing prayers of restoration. Channels radiant mending through your hands."},"effectDisplay":{"key":"content.tooltip.scroll_cure.effect","fallback":"Cast Cure Wounds: Restores 1d8 + 3 Hit Points to yourself or an adjacent ally."}},
  scroll_sleep: {
    rarity: 'uncommon',
    category: 'Spell Scroll · Enchantment',
    lore: 'Sprinkled with fine sand from the Astral Sea. Overwhelms weary minds with an intoxicating slumber.',
    effect: 'Cast Sleep: Puts up to 5d8 HP of hostile creatures into a magical slumber.'
  , "categoryDisplay":{"key":"content.tooltip.scroll_sleep.category","fallback":"Spell Scroll · Enchantment"},"loreDisplay":{"key":"content.tooltip.scroll_sleep.lore","fallback":"Sprinkled with fine sand from the Astral Sea. Overwhelms weary minds with an intoxicating slumber."},"effectDisplay":{"key":"content.tooltip.scroll_sleep.effect","fallback":"Cast Sleep: Puts up to 5d8 HP of hostile creatures into a magical slumber."}},

  // --- Tools & Gear ---
  thieves_tools: {
    rarity: 'common',
    category: 'Artisan & Roguish Tool',
    lore: 'A leather roll filled with fine lockpicks, tension wrenches, miniature mirrors, and delicate files for disarming triggers and unpicking tumbler locks.',
    effect: 'Enables Sleight of Hand checks to pick locked chests and disarm mechanical traps.'
  , "categoryDisplay":{"key":"content.tooltip.thieves_tools.category","fallback":"Artisan & Roguish Tool"},"loreDisplay":{"key":"content.tooltip.thieves_tools.lore","fallback":"A leather roll filled with fine lockpicks, tension wrenches, miniature mirrors, and delicate files for disarming triggers and unpicking tumbler locks."},"effectDisplay":{"key":"content.tooltip.thieves_tools.effect","fallback":"Enables Sleight of Hand checks to pick locked chests and disarm mechanical traps."}},
  healers_kit: {
    rarity: 'common',
    category: 'Medical Gear',
    lore: 'Leather pouches containing sterile bandages, splints, tourniquets, and medicinal salves.',
    effect: 'Stabilizes a dying creature or triggers the Healer feat without expending spell slots.'
  , "categoryDisplay":{"key":"content.tooltip.healers_kit.category","fallback":"Medical Gear"},"loreDisplay":{"key":"content.tooltip.healers_kit.lore","fallback":"Leather pouches containing sterile bandages, splints, tourniquets, and medicinal salves."},"effectDisplay":{"key":"content.tooltip.healers_kit.effect","fallback":"Stabilizes a dying creature or triggers the Healer feat without expending spell slots."}},
  shield: {
    rarity: 'common',
    category: 'Armor · Shield',
    lore: 'A sturdy kite shield forged of banded ash wood and rimmed with wrought iron.',
    effect: '+2 AC while equipped in your off-hand.'
  , "categoryDisplay":{"key":"content.tooltip.shield.category","fallback":"Armor · Shield"},"loreDisplay":{"key":"content.tooltip.shield.lore","fallback":"A sturdy kite shield forged of banded ash wood and rimmed with wrought iron."},"effectDisplay":{"key":"content.tooltip.shield.effect","fallback":"+2 AC while equipped in your off-hand."}},
  torch: {
    rarity: 'common',
    category: 'Adventuring Gear',
    lore: 'Pitch-soaked wood that burns bright in darkness, casting 20 ft of bright light and 20 ft of dim light.',
    effect: 'Illuminates dark dungeon chambers.'
  , "categoryDisplay":{"key":"content.tooltip.torch.category","fallback":"Adventuring Gear"},"loreDisplay":{"key":"content.tooltip.torch.lore","fallback":"Pitch-soaked wood that burns bright in darkness, casting 20 ft of bright light and 20 ft of dim light."},"effectDisplay":{"key":"content.tooltip.torch.effect","fallback":"Illuminates dark dungeon chambers."}},

  // --- Common Weapons with D&D 2024 Masteries ---
  dagger: {
    rarity: 'common',
    category: 'Simple Melee Weapon',
    mastery: 'nick',
    lore: 'A swift, double-edged combat dagger balanced for throwing and quick off-hand parries.',
    properties: ['finesse', 'light', 'thrown (20/60)']
  , "categoryDisplay":{"key":"content.tooltip.dagger.category","fallback":"Simple Melee Weapon"},"loreDisplay":{"key":"content.tooltip.dagger.lore","fallback":"A swift, double-edged combat dagger balanced for throwing and quick off-hand parries."}, propertiesDisplay:[{"key":"content.tooltip.dagger.property0","fallback":"finesse"},{"key":"content.tooltip.dagger.property1","fallback":"light"},{"key":"content.tooltip.dagger.property2","fallback":"thrown (20/60)"}]},
  shortsword: {
    rarity: 'common',
    category: 'Martial Melee Weapon',
    mastery: 'vex',
    lore: 'A nimble thrusting sword with a tapered point, favored by scouts and duelists for exploiting enemy guard.',
    properties: ['finesse', 'light']
  , "categoryDisplay":{"key":"content.tooltip.shortsword.category","fallback":"Martial Melee Weapon"},"loreDisplay":{"key":"content.tooltip.shortsword.lore","fallback":"A nimble thrusting sword with a tapered point, favored by scouts and duelists for exploiting enemy guard."}, propertiesDisplay:[{"key":"content.tooltip.shortsword.property0","fallback":"finesse"},{"key":"content.tooltip.shortsword.property1","fallback":"light"}]},
  longsword: {
    rarity: 'common',
    category: 'Martial Melee Weapon',
    mastery: 'sap',
    lore: 'The consummate weapon of chivalry and frontline combat. Balanced for either one-handed parrying or two-handed heavy strikes.',
    properties: ['versatile (1d10)']
  , "categoryDisplay":{"key":"content.tooltip.longsword.category","fallback":"Martial Melee Weapon"},"loreDisplay":{"key":"content.tooltip.longsword.lore","fallback":"The consummate weapon of chivalry and frontline combat. Balanced for either one-handed parrying or two-handed heavy strikes."}, propertiesDisplay:[{"key":"content.tooltip.longsword.property0","fallback":"versatile (1d10)"}]},
  greatsword: {
    rarity: 'common',
    category: 'Martial Melee Weapon',
    mastery: 'graze',
    lore: 'A massive two-handed blade capable of cleaving armor, shields, and bone with sheer momentum.',
    properties: ['heavy', 'two_handed']
  , "categoryDisplay":{"key":"content.tooltip.greatsword.category","fallback":"Martial Melee Weapon"},"loreDisplay":{"key":"content.tooltip.greatsword.lore","fallback":"A massive two-handed blade capable of cleaving armor, shields, and bone with sheer momentum."}, propertiesDisplay:[{"key":"content.tooltip.greatsword.property0","fallback":"heavy"},{"key":"content.tooltip.greatsword.property1","fallback":"two_handed"}]},
  greataxe: {
    rarity: 'common',
    category: 'Martial Melee Weapon',
    mastery: 'cleave',
    lore: 'A broad-bladed crescent axe with crushing weight behind every executioner swing.',
    properties: ['heavy', 'two_handed']
  , "categoryDisplay":{"key":"content.tooltip.greataxe.category","fallback":"Martial Melee Weapon"},"loreDisplay":{"key":"content.tooltip.greataxe.lore","fallback":"A broad-bladed crescent axe with crushing weight behind every executioner swing."}, propertiesDisplay:[{"key":"content.tooltip.greataxe.property0","fallback":"heavy"},{"key":"content.tooltip.greataxe.property1","fallback":"two_handed"}]},
  battleaxe: {
    rarity: 'common',
    category: 'Martial Melee Weapon',
    mastery: 'topple',
    lore: 'A heavy martial axe with a thick beard and hammer poll, designed to knock opponents off-balance.',
    properties: ['versatile (1d10)']
  , "categoryDisplay":{"key":"content.tooltip.battleaxe.category","fallback":"Martial Melee Weapon"},"loreDisplay":{"key":"content.tooltip.battleaxe.lore","fallback":"A heavy martial axe with a thick beard and hammer poll, designed to knock opponents off-balance."}, propertiesDisplay:[{"key":"content.tooltip.battleaxe.property0","fallback":"versatile (1d10)"}]},
  maul: {
    rarity: 'common',
    category: 'Martial Melee Weapon',
    mastery: 'topple',
    lore: 'An eight-pound iron hammer head mounted on reinforced hickory. Knocks foes flat to the stone floor.',
    properties: ['heavy', 'two_handed']
  , "categoryDisplay":{"key":"content.tooltip.maul.category","fallback":"Martial Melee Weapon"},"loreDisplay":{"key":"content.tooltip.maul.lore","fallback":"An eight-pound iron hammer head mounted on reinforced hickory. Knocks foes flat to the stone floor."}, propertiesDisplay:[{"key":"content.tooltip.maul.property0","fallback":"heavy"},{"key":"content.tooltip.maul.property1","fallback":"two_handed"}]},
  warhammer: {
    rarity: 'common',
    category: 'Martial Melee Weapon',
    mastery: 'push',
    lore: 'A versatile warhammer featuring a spiked beak and blunt face, built to drive foes back.',
    properties: ['versatile (1d10)']
  , "categoryDisplay":{"key":"content.tooltip.warhammer.category","fallback":"Martial Melee Weapon"},"loreDisplay":{"key":"content.tooltip.warhammer.lore","fallback":"A versatile warhammer featuring a spiked beak and blunt face, built to drive foes back."}, propertiesDisplay:[{"key":"content.tooltip.warhammer.property0","fallback":"versatile (1d10)"}]},
  quarterstaff: {
    rarity: 'common',
    category: 'Simple Melee Weapon',
    mastery: 'topple',
    lore: 'Treated oak staff wrapped in grip leather, equally suited for walking or tripping armored adversaries.',
    properties: ['versatile (1d8)']
  , "categoryDisplay":{"key":"content.tooltip.quarterstaff.category","fallback":"Simple Melee Weapon"},"loreDisplay":{"key":"content.tooltip.quarterstaff.lore","fallback":"Treated oak staff wrapped in grip leather, equally suited for walking or tripping armored adversaries."}, propertiesDisplay:[{"key":"content.tooltip.quarterstaff.property0","fallback":"versatile (1d8)"}]},
  mace: {
    rarity: 'common',
    category: 'Simple Melee Weapon',
    mastery: 'sap',
    lore: 'A flanged steel mace designed to ring skulls and disorient enemy combatants.',
    properties: []
  , "categoryDisplay":{"key":"content.tooltip.mace.category","fallback":"Simple Melee Weapon"},"loreDisplay":{"key":"content.tooltip.mace.lore","fallback":"A flanged steel mace designed to ring skulls and disorient enemy combatants."}, propertiesDisplay:[]},
  club: {
    rarity: 'common',
    category: 'Simple Melee Weapon',
    mastery: 'slow',
    lore: 'A dense hardwood cudgel weighted to stagger enemy footing.',
    properties: ['light']
  , "categoryDisplay":{"key":"content.tooltip.club.category","fallback":"Simple Melee Weapon"},"loreDisplay":{"key":"content.tooltip.club.lore","fallback":"A dense hardwood cudgel weighted to stagger enemy footing."}, propertiesDisplay:[{"key":"content.tooltip.club.property0","fallback":"light"}]},
  handaxe: {
    rarity: 'common',
    category: 'Simple Melee Weapon',
    mastery: 'vex',
    lore: 'A compact woodcutter’s axe honed for hand-to-hand combat and lethal throws.',
    properties: ['light', 'thrown (20/60)']
  , "categoryDisplay":{"key":"content.tooltip.handaxe.category","fallback":"Simple Melee Weapon"},"loreDisplay":{"key":"content.tooltip.handaxe.lore","fallback":"A compact woodcutter’s axe honed for hand-to-hand combat and lethal throws."}, propertiesDisplay:[{"key":"content.tooltip.handaxe.property0","fallback":"light"},{"key":"content.tooltip.handaxe.property1","fallback":"thrown (20/60)"}]},
  spear: {
    rarity: 'common',
    category: 'Simple Melee Weapon',
    mastery: 'sap',
    lore: 'A leaf-tipped steel spear, dependable for keeping vicious beasts at bay.',
    properties: ['thrown (20/60)', 'versatile (1d8)']
  , "categoryDisplay":{"key":"content.tooltip.spear.category","fallback":"Simple Melee Weapon"},"loreDisplay":{"key":"content.tooltip.spear.lore","fallback":"A leaf-tipped steel spear, dependable for keeping vicious beasts at bay."}, propertiesDisplay:[{"key":"content.tooltip.spear.property0","fallback":"thrown (20/60)"},{"key":"content.tooltip.spear.property1","fallback":"versatile (1d8)"}]},
  shortbow: {
    rarity: 'common',
    category: 'Simple Ranged Weapon',
    mastery: 'vex',
    lore: 'A light composite bow strung with seasoned hemp, quick to draw and loose.',
    properties: ['ammunition (80/320)', 'two_handed']
  , "categoryDisplay":{"key":"content.tooltip.shortbow.category","fallback":"Simple Ranged Weapon"},"loreDisplay":{"key":"content.tooltip.shortbow.lore","fallback":"A light composite bow strung with seasoned hemp, quick to draw and loose."}, propertiesDisplay:[{"key":"content.tooltip.shortbow.property0","fallback":"ammunition (80/320)"},{"key":"content.tooltip.shortbow.property1","fallback":"two_handed"}]},
  longbow: {
    rarity: 'common',
    category: 'Martial Ranged Weapon',
    mastery: 'slow',
    lore: 'A six-foot yew warbow capable of piercing mail at immense distance.',
    properties: ['ammunition (150/600)', 'heavy', 'two_handed']
  , "categoryDisplay":{"key":"content.tooltip.longbow.category","fallback":"Martial Ranged Weapon"},"loreDisplay":{"key":"content.tooltip.longbow.lore","fallback":"A six-foot yew warbow capable of piercing mail at immense distance."}, propertiesDisplay:[{"key":"content.tooltip.longbow.property0","fallback":"ammunition (150/600)"},{"key":"content.tooltip.longbow.property1","fallback":"heavy"},{"key":"content.tooltip.longbow.property2","fallback":"two_handed"}]},
  lightcrossbow: {
    rarity: 'common',
    category: 'Simple Ranged Weapon',
    mastery: 'slow',
    lore: 'A mechanical latch crossbow firing hardened iron bolts that stagger charging targets.',
    properties: ['ammunition (80/320)', 'loading', 'two_handed']
  , "categoryDisplay":{"key":"content.tooltip.lightcrossbow.category","fallback":"Simple Ranged Weapon"},"loreDisplay":{"key":"content.tooltip.lightcrossbow.lore","fallback":"A mechanical latch crossbow firing hardened iron bolts that stagger charging targets."}, propertiesDisplay:[{"key":"content.tooltip.lightcrossbow.property0","fallback":"ammunition (80/320)"},{"key":"content.tooltip.lightcrossbow.property1","fallback":"loading"},{"key":"content.tooltip.lightcrossbow.property2","fallback":"two_handed"}]},

  // --- Armor ---
  leather: {
    rarity: 'common',
    category: 'Light Armor',
    lore: 'Cured and boiled leather breastplate with flexible greaves, offering agile protection without slowing stealthy movement.',
    properties: ['11 + DEX AC', 'Lightweight']
  , "categoryDisplay":{"key":"content.tooltip.leather.category","fallback":"Light Armor"},"loreDisplay":{"key":"content.tooltip.leather.lore","fallback":"Cured and boiled leather breastplate with flexible greaves, offering agile protection without slowing stealthy movement."}, propertiesDisplay:[{"key":"content.tooltip.leather.property0","fallback":"11 + DEX AC"},{"key":"content.tooltip.leather.property1","fallback":"Lightweight"}]},
  studded_leather: {
    rarity: 'common',
    category: 'Light Armor',
    lore: 'Supple leather reinforced with close-set steel rivets and plates, balancing silence and defensive resilience.',
    properties: ['12 + DEX AC', 'No stealth penalty']
  , "categoryDisplay":{"key":"content.tooltip.studded_leather.category","fallback":"Light Armor"},"loreDisplay":{"key":"content.tooltip.studded_leather.lore","fallback":"Supple leather reinforced with close-set steel rivets and plates, balancing silence and defensive resilience."}, propertiesDisplay:[{"key":"content.tooltip.studded_leather.property0","fallback":"12 + DEX AC"},{"key":"content.tooltip.studded_leather.property1","fallback":"No stealth penalty"}]},
  chain_shirt: {
    rarity: 'common',
    category: 'Medium Armor',
    lore: 'Interlocking steel rings sandwiched between layers of quilted cloth, guarding the vital torso.',
    properties: ['13 + DEX (max 2) AC']
  , "categoryDisplay":{"key":"content.tooltip.chain_shirt.category","fallback":"Medium Armor"},"loreDisplay":{"key":"content.tooltip.chain_shirt.lore","fallback":"Interlocking steel rings sandwiched between layers of quilted cloth, guarding the vital torso."}, propertiesDisplay:[{"key":"content.tooltip.chain_shirt.property0","fallback":"13 + DEX (max 2) AC"}]},
  scale_mail: {
    rarity: 'common',
    category: 'Medium Armor',
    lore: 'Overlapping brass scales riveted to a leather tunic, durable against beast bites and cleaving strikes.',
    properties: ['14 + DEX (max 2) AC', 'Disadvantage on Stealth']
  , "categoryDisplay":{"key":"content.tooltip.scale_mail.category","fallback":"Medium Armor"},"loreDisplay":{"key":"content.tooltip.scale_mail.lore","fallback":"Overlapping brass scales riveted to a leather tunic, durable against beast bites and cleaving strikes."}, propertiesDisplay:[{"key":"content.tooltip.scale_mail.property0","fallback":"14 + DEX (max 2) AC"},{"key":"content.tooltip.scale_mail.property1","fallback":"Disadvantage on Stealth"}]},
  breastplate: {
    rarity: 'uncommon',
    category: 'Medium Armor',
    lore: 'A masterfully polished steel cuirass with backplate, leaving the limbs completely uninhibited.',
    properties: ['14 + DEX (max 2) AC', 'No stealth penalty']
  , "categoryDisplay":{"key":"content.tooltip.breastplate.category","fallback":"Medium Armor"},"loreDisplay":{"key":"content.tooltip.breastplate.lore","fallback":"A masterfully polished steel cuirass with backplate, leaving the limbs completely uninhibited."}, propertiesDisplay:[{"key":"content.tooltip.breastplate.property0","fallback":"14 + DEX (max 2) AC"},{"key":"content.tooltip.breastplate.property1","fallback":"No stealth penalty"}]},
  half_plate: {
    rarity: 'uncommon',
    category: 'Medium Armor',
    lore: 'Shaped steel plates covering the torso and joints, offering near-complete knightly coverage.',
    properties: ['15 + DEX (max 2) AC', 'Disadvantage on Stealth']
  , "categoryDisplay":{"key":"content.tooltip.half_plate.category","fallback":"Medium Armor"},"loreDisplay":{"key":"content.tooltip.half_plate.lore","fallback":"Shaped steel plates covering the torso and joints, offering near-complete knightly coverage."}, propertiesDisplay:[{"key":"content.tooltip.half_plate.property0","fallback":"15 + DEX (max 2) AC"},{"key":"content.tooltip.half_plate.property1","fallback":"Disadvantage on Stealth"}]},
  chain_mail: {
    rarity: 'common',
    category: 'Heavy Armor',
    lore: 'A full hauberk of woven steel rings worn over padded gambeson, standard issue for garrison knights.',
    properties: ['16 AC', 'Min STR 13', 'Disadvantage on Stealth']
  , "categoryDisplay":{"key":"content.tooltip.chain_mail.category","fallback":"Heavy Armor"},"loreDisplay":{"key":"content.tooltip.chain_mail.lore","fallback":"A full hauberk of woven steel rings worn over padded gambeson, standard issue for garrison knights."}, propertiesDisplay:[{"key":"content.tooltip.chain_mail.property0","fallback":"16 AC"},{"key":"content.tooltip.chain_mail.property1","fallback":"Min STR 13"},{"key":"content.tooltip.chain_mail.property2","fallback":"Disadvantage on Stealth"}]},
  splint: {
    rarity: 'uncommon',
    category: 'Heavy Armor',
    lore: 'Vertical steel strips riveted to a backing of leather and chain, stopping heavy bludgeons and spears.',
    properties: ['17 AC', 'Min STR 15', 'Disadvantage on Stealth']
  , "categoryDisplay":{"key":"content.tooltip.splint.category","fallback":"Heavy Armor"}, loreDisplay:{"key":"content.tooltip.splint.lore","fallback":"Vertical steel strips riveted to a backing of leather and chain, stopping heavy bludgeons and spears."}, propertiesDisplay:[{"key":"content.tooltip.splint.property0","fallback":"17 AC"},{"key":"content.tooltip.splint.property1","fallback":"Min STR 15"},{"key":"content.tooltip.splint.property2","fallback":"Disadvantage on Stealth"}]},
  plate: {
    rarity: 'uncommon',
    category: 'Heavy Armor',
    lore: 'The zenith of protective metallurgy: fitted interlocking tempered steel plates encasing the wearer from neck to heel.',
    properties: ['18 AC', 'Min STR 15', 'Disadvantage on Stealth']
  , "categoryDisplay":{"key":"content.tooltip.plate.category","fallback":"Heavy Armor"}, loreDisplay:{"key":"content.tooltip.plate.lore","fallback":"The zenith of protective metallurgy: fitted interlocking tempered steel plates encasing the wearer from neck to heel."}, propertiesDisplay:[{"key":"content.tooltip.plate.property0","fallback":"18 AC"},{"key":"content.tooltip.plate.property1","fallback":"Min STR 15"},{"key":"content.tooltip.plate.property2","fallback":"Disadvantage on Stealth"}]}
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
  const category = staticData.category || def.type;

  const masteryKey = staticData.mastery || def.mastery;
  const mastery = masteryKey ? WEAPON_MASTERIES[masteryKey] : null;

  // Build stat pills
  const stats = [];
  if (def.damage) stats.push(`🗡 <b>${def.damage}</b> ${def.damageType ? label('content.damage.'+def.damageType) : ''}`);
  if (def.versatile) stats.push(`⚔ <b>${def.versatile}</b> 2H`);
  if (def.ac) stats.push(`🛡 <b>${def.ac} AC</b>`);
  if (def.acBonus) stats.push(`🛡 <b>+${def.acBonus} AC</b>`);
  if (def.hpBonus) stats.push(`❤️ <b>+${def.hpBonus} ${label('ui.tooltip.maxHp')}</b>`);
  if (def.heal) stats.push(`🧪 <b>+${def.heal} HP</b>`);
  if (def.range) stats.push(`🎯 <b>${def.range} ft</b>`);
  if (def.cost) stats.push(`💰 <b>${def.cost} gp</b>`);
  // rolled affix gear: show the rolled modifiers, not just the base item
  if (typeof item === 'object' && item) {
    if (item.magic) stats.push(`✨ <b>+${item.magic}</b> ${label(item.type === 'weapon' ? 'ui.tooltip.hitDamage' : 'ui.tooltip.enhancement')}`);
    if (item.bonusDamage) stats.push(`🔥 <b>+${item.bonusDamage.dice}</b> ${label('content.damage.'+item.bonusDamage.type)} ${label('ui.tooltip.damage')}`);
    if (item.vampiricHeal) stats.push(`🩸 <b>+${item.vampiricHeal} HP</b> ${label('ui.tooltip.onHit')}`);
    if (item.acBonus) stats.push(`🛡 <b>+${item.acBonus} AC</b>`);
    if (item.hpBonus) stats.push(`❤️ <b>+${item.hpBonus} ${label('ui.tooltip.maxHp')}</b>`);
    if (item.speedBonus) stats.push(`👣 <b>+${item.speedBonus} ft</b> ${label('ui.tooltip.speed')}`);
  }

  const props = staticData.properties || def.props || [];
  const lore = staticData.lore || def.desc || 'A sturdy adventurer’s implement, scarred by past subterranean trials.';
  const rolledDesc = (typeof item === 'object' && item && item.desc) ? item.desc : '';
  const effect = rolledDesc || staticData.effect || (def.desc && def.desc !== lore ? def.desc : '');

  return `
    <div class="tooltip-header" style="border-bottom-color: ${rarity.border};">
      <div class="tooltip-title" style="color: ${rarity.color};">${displayLabel((typeof item === 'object' && item.nameDisplay) || def.nameDisplay,name)}</div>
      <div class="tooltip-subtitle">
        <span class="tooltip-rarity" style="color: ${rarity.color}; background: ${rarity.bgGlow}; border-color: ${rarity.border};">${label('ui.tooltip.' + (RARITIES[rarityKey] ? rarityKey : 'common'))}</span>
        <span class="tooltip-category">${category ? displayLabel(staticData.categoryDisplay,category) : label('ui.tooltip.gear')}</span>
      </div>
    </div>

    ${stats.length ? `
      <div class="tooltip-stats">
        ${stats.map(s => `<span class="tooltip-stat-pill">${s}</span>`).join('')}
      </div>` : ''}

    ${mastery ? `
      <div class="tooltip-mastery-box">
        <div class="tooltip-mastery-title">
          <span class="mastery-tag">${label('ui.tooltip.mastery')}</span> <b>${contentLabel(mastery)}</b>
        </div>
        <div class="tooltip-mastery-desc">${contentLabel(mastery,"desc")}</div>
      </div>` : ''}

    ${effect ? `
      <div class="tooltip-effect">
        <b>${label('ui.tooltip.effect')}</b> ${displayLabel((typeof item === 'object' && item.descDisplay) || staticData.effectDisplay || def.descDisplay,effect)}
      </div>` : ''}

    ${props.length ? `
      <div class="tooltip-props">
        ${props.map((p,index) => `<span class="prop-chip">${displayLabel(staticData.propertiesDisplay?.[index],p)}</span>`).join(' ')}
      </div>` : ''}

    <div class="tooltip-lore">
      "${displayLabel(staticData.loreDisplay || def.descDisplay,lore)}"
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
 * @param {Document|HTMLElement} [container]
 * @param {object} [rulesCatalog] item catalogue used to resolve plain item ids
 */
export function initTooltips(container = document, rulesCatalog = {}) {
  ensureTooltipElement();

  // touch devices never fire mouseleave, so a tapped tooltip would stay on screen forever.
  // Tap to show, tap anywhere else (or after a few seconds) to dismiss.
  if (!window.__dndTooltipTouchBound) {
    window.__dndTooltipTouchBound = true;
    document.addEventListener('touchstart', (ev) => {
      const el = /** @type {Element | null} */ (ev.target);
      const target = el && el.closest ? el.closest('[data-item-tooltip]') : null;
      if (!target) { hideTooltip(); return; }
      const payload = target.getAttribute('data-item-tooltip');
      if (!payload) return;
      const touch = ev.touches && ev.touches[0];
      const point = touch || { clientX: 0, clientY: 0 };
      if (payload.trim().startsWith('{')) {
        try { showTooltip(point, JSON.parse(payload), rulesCatalog); } catch { /* id lookup below */ }
      } else {
        showTooltip(point, payload, rulesCatalog);
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
