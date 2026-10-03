// presets.js — T5 quick-start recommended heroes. The ONLY thing the client sends back is
// `presetId` (+ an optional name); the buildCharacter draft lives here so the server's rules
// tables stay the single source of truth. Every preset must build through the real
// engine.buildCharacter — the POST /api/characters route refuses unknown or stale presets.
//
// Legality notes (validated by tests/integration/quick-start.test.mjs):
//  - drafts use the standard array + one background +2/+1, exactly like the seven-step creator;
//  - skill quotas are complete per the current rules tables: each draft carries the class's
//    skillPicks, chosen from its skillList and never duplicating a background/species skill.
//    buildCharacter merges bg.skills + draft.skills (dedupe via Set), so everything must be
//    listed here to actually land — species choices (human versatility) are passed the same
//    way because buildCharacter does not read speciesChoices for skills (a pre-existing
//    custom-creator gap tracked in tasks/t5-first-adventure.md; do not "fix" the drafts,
//    fix buildCharacter if that gap is ever addressed).
//  - copy shown to players (label/blurb/tips) is Simplified Chinese; class/species/rule
//    proper names stay as the rules tables spell them.

const PRESETS = [
  {
    id: 'guardian',
    label: '坚盾卫士',
    tagline: '近战防御 · 简单可靠',
    blurb: '矮人战士：重甲、盾牌、长剑，站在最前面硬扛敌人。站得住、打得动，跟着目标提示走就行。',
    tips: ['走近敌人点击攻击', '重甲 + 盾，很抗打', 'Second Wind 可自我恢复'],
    defaultName: '布兰·石须',
    draft: {
      species: 'dwarf',
      className: 'fighter',
      background: 'guard',
      method: 'array',
      baseScores: { str: 15, dex: 14, con: 13, int: 12, wis: 10, cha: 8 },
      bgPlus2: 'str',
      bgPlus1: 'con',
      // guard background already grants athletics/perception; these two are the fighter's
      // skillPicks (skillList: insight/survival are both allowed, neither duplicates a bg skill)
      skills: ['insight', 'survival'],
      extraSkills: [],
      fightingStyle: 'defense',
      invocations: [],
      cantrips: [],
      spells: [],
      armorOption: 'chain_mail',
      weaponOption: 'sword_board'
    }
  },
  {
    id: 'arcane',
    label: '奥法学徒',
    tagline: '远程施法 · 火焰与奥术',
    blurb: '人类法师：站在远处用火焰箭和魔法飞弹打击敌人。护甲薄但打得远，魔法飞弹必定命中。',
    tips: ['选中远处敌人施放 Fire Bolt', '魔法飞弹必定命中', '危急时给自己套 Mage Armor'],
    defaultName: '艾拉·星语',
    draft: {
      species: 'human',
      speciesChoices: { versatility: ['perception', 'insight'] },
      className: 'wizard',
      background: 'sage',
      method: 'array',
      baseScores: { str: 8, dex: 14, con: 13, int: 15, wis: 12, cha: 10 },
      bgPlus2: 'int',
      bgPlus1: 'con',
      // first two are the human versatility picks (species); last two are the wizard's
      // skillPicks (skillList: investigation/religion — sage already grants arcana/history)
      skills: ['perception', 'insight', 'investigation', 'religion'],
      extraSkills: [],
      fightingStyle: null,
      invocations: [],
      cantrips: ['fire_bolt', 'ray_of_frost', 'mage_hand'],
      spells: ['magic_missile', 'shield', 'burning_hands'],
      armorOption: 'none',
      weaponOption: 'quarterstaff'
    }
  }
];

// Client-facing metadata — everything the quick-start card renders. No rules tables leak here.
function listPresets() {
  return PRESETS.map(p => ({
    id: p.id, label: p.label, tagline: p.tagline, blurb: p.blurb, tips: p.tips, defaultName: p.defaultName
  }));
}

function getPreset(id) {
  return PRESETS.find(p => p.id === id) || null;
}

// The buildCharacter draft for a preset, deep-cloned so a character row can never hold a
// reference into this module's constants (buildCharacter stores draft.speciesChoices as-is).
function draftFor(id) {
  const preset = getPreset(id);
  if (!preset) return null;
  return JSON.parse(JSON.stringify(preset.draft));
}

module.exports = { listPresets, getPreset, draftFor };
