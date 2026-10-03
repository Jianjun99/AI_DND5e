// guidance.js — deterministic "what now?" for the player (T4). Computed from real state
// with fixed templates: no model, no RNG, so the whole loop stays playable with AI off.
//
// Two surfaces:
//   journey(char, { liveSave }) — roster level. Drives the home card, the region-map
//     recommendation and the post-settle "next objective": one primary action + reason,
//     plus a couple of optional actions. Actions are data ({ kind, mapId?, saveId? }) that
//     the client turns into links; the server keeps validating every real action
//     (embark/settle/…) on submit, so guidance can never change a game result.
//   delve(save) — live delve level. Drives the HUD objective pill, the return-to-camp
//     prompt (goal reached vs area cleared) and the combat economy line that spells out
//     which action is spent and why.
//
// Leak rules: copy only comes from static map metadata the player already sees (map names,
// map objectiveText) and the campaign's public objective — never coordinates, undiscovered
// entities, trap positions or loot tables.

const campaign = require('./campaign.js');

// Display names for the maps the story can send you to (same names as the region-map nodes).
const MAP_NAMES = {
  crypt: '沉没墓穴',
  'drowned-vault': '淹没地窟',
  'howling-hills': '嚎叫丘陵',
  sewers: '下水道',
  mill: '废弃磨坊',
  roost: '阳光龙巢',
  endless_1: '无尽深渊'
};

function mapName(mapId) { return MAP_NAMES[mapId] || mapId || ''; }

// The next story step as a prepare target; null once the campaign is complete.
function nextStep(c) {
  if (c.completedAt) return null;
  if (c.stage === 0) return { mapId: 'crypt', reason: '主线从这里开始——取回沉没圣物。' };
  if (c.stage === 1) return { mapId: 'drowned-vault', reason: '圣物上的刻痕指向水下——取回地窟钥匙。' };
  if (c.stage === 2) {
    const order = ['hills', 'sewers', 'mill'];
    const mapIds = { hills: 'howling-hills', sewers: 'sewers', mill: 'mill' };
    const missing = order.find(k => !((c.acts && c.acts.clues) || {})[k]);
    return { mapId: mapIds[missing] || 'sewers', reason: '三条线索可以任意顺序取得——这条还没到手。' };
  }
  if (c.stage === 3) return { mapId: 'roost', reason: '线索齐了——登上阳光龙巢，终结烬后。' };
  return null;
}

// Is this delve save already settled? Mirrors the sync-delve identity: the delve mirror
// or the roster receipt, whichever survived (T3/T3a heal both directions).
function isSettled(char, save) {
  if (!save) return false;
  const id = `${save.id}#${save.endSeq || 1}`;
  // getSave carries the mirror object, listSaves the bare receipt id
  const mirrorId = typeof save.settled === 'string' ? save.settled : (save.settled && save.settled.id);
  if (mirrorId === id) return true;
  return Array.isArray(char && char.settlements) && char.settlements.some(r => r.id === id);
}

// The save the player should pick up next (T4a priority):
//   1. an ended-but-unsettled delve — spoils must not be lost,
//   2. a running delve (explore/combat) — continue the adventure in progress,
//   3. otherwise the most recently touched save (a settled delve; journey treats it as
//      "no active delve" and points at the next story step — the per-save rows on the home
//      card keep its view entry).
// Within each group the newest updatedAt wins. `saves` = store.listSaves() rows.
function pickLiveSave(char, saves) {
  const mine = (saves || []).filter(s => s && s.characterId === char.id)
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  if (!mine.length) return null;
  const ended = s => s.mode === 'victory' || s.mode === 'retreat' || s.mode === 'over';
  const chosen = mine.find(s => ended(s) && !isSettled(char, s))
    || mine.find(s => s.mode === 'explore' || s.mode === 'combat')
    || mine[0];
  return {
    id: chosen.id,
    mode: chosen.mode || null,
    mapId: chosen.mapId || null,
    mapName: chosen.mapName || mapName(chosen.mapId),
    endSeq: chosen.endSeq,
    settled: isSettled(char, chosen)
  };
}

// ---------------------------------------------------------------- journey ----
// fields (documented in ARCHITECTURE §7):
//   stage     'unsettled' | 'in_delve' | 'preparing' | 'complete'
//   label     campaign progress label (e.g. '2/4', '主线完成')
//   objective campaign objective { text, act?, done? }
//   primary   { kind: 'resume'|'prepare'|'map'|'campaign', saveId?, mapId?, text, reason }
//   options   [{ kind, mapId?, text, reason? }] — small, optional
function journey(char, opts = {}) {
  const c = campaign.ensure(char && char.campaign);
  const objective = campaign.objective(c);
  const progress = campaign.progress(c);
  const save = opts.liveSave || null;
  const ended = !!(save && (save.mode === 'victory' || save.mode === 'retreat' || save.mode === 'over'));

  if (save && ended && !save.settled) {
    return {
      stage: 'unsettled',
      label: progress.label,
      objective,
      primary: {
        kind: 'resume', saveId: save.id,
        text: `查看结算：${save.mapName || mapName(save.mapId)}`,
        reason: '这一局的收获还没入账——先结算再出发。'
      },
      options: [{ kind: 'campaign', text: '查看主线进度', reason: '四幕目标与线索' }]
    };
  }

  if (save && (save.mode === 'explore' || save.mode === 'combat')) {
    return {
      stage: 'in_delve',
      label: progress.label,
      objective,
      primary: {
        kind: 'resume', saveId: save.id,
        text: `继续冒险：${save.mapName || mapName(save.mapId)}`,
        reason: '上一局还没结束——从原地继续。'
      },
      options: [{ kind: 'campaign', text: '查看主线进度', reason: '四幕目标与线索' }]
    };
  }

  if (c.completedAt) {
    return {
      stage: 'complete',
      label: progress.label,
      objective,
      primary: {
        kind: 'map', mapId: 'endless_1',
        text: '自由探索：无尽深渊',
        reason: '主线已完成——各地牢与图鉴收集仍然开放。'
      },
      options: [
        { kind: 'campaign', text: '重读收场词', reason: '主线结局与进度记录' },
        { kind: 'map', mapId: 'crypt', text: '重温沉没墓穴', reason: '自由重打旧地牢' }
      ]
    };
  }

  const step = nextStep(c);
  return {
    stage: 'preparing',
    label: progress.label,
    objective,
    primary: {
      kind: 'prepare', mapId: step.mapId,
      text: `准备出发：${mapName(step.mapId)}`,
      reason: step.reason
    },
    options: [
      { kind: 'campaign', text: '查看主线进度', reason: '四幕目标与线索' },
      { kind: 'map', mapId: 'endless_1', text: '挑战无尽深渊', reason: '随机地牢，检验成长' }
    ]
  };
}

// ---------------------------------------------------------------- delve ----
// Returns { stage, objective, hint, returnPrompt, combat }.
//   stage 'explore' | 'objective' | 'cleared' | 'combat' | 'victory' | 'retreat' | 'defeat'
//   objective  the HUD objective pill line (server-owned copy)
//   hint       the default hover-bar line (same leak rules as above)
//   combat     { yourTurn, movementLeftFt, action, bonus, potions, notes } while in combat
function delve(save) {
  const mode = save.mode;
  const v = (save.map && save.map.victory) || { type: 'fetch_relic' };
  const localObjective = (save.map && save.map.objectiveText) || '探索地牢，完成目标后返回营地。';
  const entities = save.entities || [];
  const monsters = entities.filter(e => e.kind === 'monster');
  const alive = monsters.filter(e => e.alive !== false && !e.fled);
  const bosses = monsters.filter(e => e.boss);
  const bossAlive = bosses.some(m => m.alive !== false && !m.fled);
  const goalReached = v.type === 'slay_boss'
    ? (bosses.length > 0 && !bossAlive)
    : !!((save.flags || {}).hasRelic);

  if (mode === 'victory') {
    return { stage: 'victory', objective: '🏆 胜利！回到营地结算本局收获。', hint: '结算面板会保存本局战利品——确认后再离开。', returnPrompt: true, combat: null };
  }
  if (mode === 'retreat') {
    return { stage: 'retreat', objective: '🏃 已主动撤退——本局收获可结算，但主线不推进。', hint: '结算面板会保存本局战利品——确认后再离开。', returnPrompt: true, combat: null };
  }
  if (mode === 'over') {
    return { stage: 'defeat', objective: '💀 你倒下了——在营地复活可以再来一次，守卫会重新就位。', hint: '复活后地牢会重置；也可以先从入口撤退回城。', returnPrompt: false, combat: null };
  }
  if (mode === 'combat') {
    return { stage: 'combat', objective: localObjective, hint: '战斗中：先看战斗面板哪些行动可用，行动用完就结束回合。', returnPrompt: false, combat: combatLine(save) };
  }
  if (goalReached) {
    // engine rule: only STANDING ON the campfire tile fires checkVictory (story advance +
    // victory reward). A retreat from the entrance/campfire neighbourhood is legal but only
    // settles what you carry — never claim the delve is done before that walk.
    return {
      stage: 'objective',
      objective: '✅ 目标已到手——走回营地（营火）完成胜利，主线才会推进。',
      hint: '走回营火格完成胜利（主线推进 + 胜利结算）。提前撤退只结算已有收获，主线不推进。',
      returnPrompt: true,
      combat: null
    };
  }
  if ((save.map?.scenes || []).length) {
    const pending = save.map.scenes.find(s => save.encounters?.[save.mapId + ':' + s.id]?.phase !== 'resolved');
    return { stage: 'explore', objective: pending ? pending.prompt : (save.map.objectiveText || '遭遇已解决，继续完成地图目标。'), hint: pending ? '走到守门人身边互动，查看可用选项；缺少凭证时仍可选择交战。' : '守门人会记得这次选择；完成目标后返回营火。', returnPrompt: false, combat: null };
  }
  if (alive.length === 0) {
    // cleared ≠ victory: with the goal still pending the story does not advance, so the
    // copy offers both honest options instead of pushing the exit
    return {
      stage: 'cleared',
      objective: '🛡️ 区域已安全——目标还未完成：继续探索，或从营地/入口主动撤退。',
      hint: '怪物已清空，但走回营火完成目标才算胜利；主动撤退只结算已有收获。',
      returnPrompt: false,
      combat: null
    };
  }
  return { stage: 'explore', objective: localObjective, hint: '探索中：点击地面移动，留意怪物、宝箱与机关。', returnPrompt: false, combat: null };
}

// The combat economy line: what is available right now and, when something is not, why.
function combatLine(save) {
  const c = save.combat || {};
  const turn = Array.isArray(c.order) ? c.order[c.turnIdx] : null;
  const yourTurn = !!turn && turn.id === 'player';
  const actionUsed = !!c.actionUsed;
  const bonusUsed = !!c.bonusUsed;
  const mv = Math.max(0, c.movementLeft || 0);
  const potions = (((save.character || {}).inventory) || [])
    .filter(i => i && typeof i.itemId === 'string' && i.itemId.startsWith('potion') && (i.qty || 0) > 0).length;

  let notes;
  if (!yourTurn) {
    notes = '敌人正在行动——等待你的回合。';
  } else {
    const parts = [
      actionUsed ? '主要动作已用' : '主要动作可用（攻击/施法/闪避/疾走）',
      bonusUsed ? '附赠动作已用' : '附赠动作可用',
      `移动 ${mv} ft（${Math.floor(mv / 5)} 格）`
    ];
    if (potions === 0) parts.push('药水已用尽');
    notes = parts.join(' · ');
  }
  return { yourTurn, movementLeftFt: mv, action: actionUsed ? 'spent' : 'ready', bonus: bonusUsed ? 'spent' : 'ready', potions, notes };
}

module.exports = { journey, delve, nextStep, pickLiveSave, isSettled, mapName, MAP_NAMES };
