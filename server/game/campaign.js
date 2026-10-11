// campaign.js — the four-act main story that ties the existing dungeons together.
//
// Act 1  The Relic        — The Sunless Crypt (its own fetch-the-relic victory condition)
// Act 2  The Vault Key    — The Drowned Vault (boss)
// Act 3  Three Clues      — Howling Hills / Oakhaven Sewers / The Abandoned Mill, any order
// Act 4  The Ember Queen  — The Sun Dragon's Roost (boss) -> epilogue
//
// Progress lives on the roster character (`char.campaign`) and advances when a delve that
// ended in victory is settled. Advancing is order-checked and idempotent: re-clearing a map
// you already beat, or killing the dragon before you have the clues, changes nothing.

const ACTS = [
  {
    id: 'relic', act: 1, name: '第一幕 · 圣物', icon: '💎',
    mapIds: ['crypt'], mapName: '沉没墓穴',
    objective: '潜入沉没墓穴，从祭坛上取回沉没圣物并活着回到营地。',
    blurb: '酒馆里没人愿意谈那座墓穴。你去了，而且带回了圣物——一件不该存在于日光下的东西。',
    reward: { xp: 150, gold: 50 }
  , localized:{"en":{"name":"Act I · The Relic","mapName":"The Sunless Crypt","objective":"Enter the Sunless Crypt, recover the sacred relic from its altar, and return alive to camp.","blurb":"Nobody in the tavern would speak of the crypt. You went, and returned with something that should never have seen daylight."},"zh-CN":{"name":"第一幕 · 圣物","mapName":"无光墓穴","objective":"潜入无光墓穴，从祭坛取回圣物并活着回到营地。","blurb":"酒馆里没人愿意谈那座墓穴。你去了，带回一件不该存在于日光下的圣物。"}}},
  {
    id: 'key', act: 2, name: '第二幕 · 地窟钥匙', icon: '🗝️',
    mapIds: ['drowned-vault'], mapName: '淹没地窟',
    objective: '圣物指向墓穴之下——深入淹没地窟，击败它的守卫，取回地窟钥匙。',
    blurb: '钥匙沉在水里几百年。它打开的不是门，而是一串更深的线索。',
    reward: { xp: 250, gold: 80 }
  , localized:{"en":{"name":"Act II · The Vault Key","mapName":"The Drowned Vault","objective":"Follow the relic beneath the crypt. Defeat the vault's guardian and recover its key.","blurb":"The key lay underwater for centuries. It opens a trail of deeper clues."},"zh-CN":{"name":"第二幕 · 地窟钥匙","mapName":"淹没地窟","objective":"圣物指向墓穴之下——深入淹没地窟，击败守卫并取回钥匙。","blurb":"钥匙沉在水里几百年。它打开的不是门，而是一串更深的线索。"}}},
  {
    id: 'clues', act: 3, name: '第三幕 · 三条线索', icon: '🧭',
    mapIds: ['howling-hills', 'sewers', 'mill'], mapName: '嚎叫丘陵 / 下水道 / 磨坊',
    objective: '钥匙上的刻痕指向三处：嚎叫丘陵的酋长、下水道的母巢、废弃磨坊的守卫。三条线索可以任意顺序取得。',
    blurb: '三条线索终于拼成一张地图——龙巢在火山的脊背上，而它的女主人已经醒了。',
    reward: { xp: 400, gold: 120 }
  , localized:{"en":{"name":"Act III · Three Clues","mapName":"Howling Hills / Sewers / Mill","objective":"Find the hill chieftain, the sewer brood, and the abandoned mill's guardian. Recover their clues in any order.","blurb":"The clues form a map: the dragon's roost sits on a volcanic ridge, and its mistress has awakened."},"zh-CN":{"name":"第三幕 · 三条线索","mapName":"嚎叫丘陵 / 下水道 / 磨坊","objective":"刻痕指向三处：丘陵酋长、下水道母巢与废弃磨坊守卫。可按任意顺序取得线索。","blurb":"线索拼成一张地图——龙巢位于火山脊背，它的女主人已经苏醒。"}}},
  {
    id: 'queen', act: 4, name: '第四幕 · 烬后', icon: '🐉',
    mapIds: ['roost'], mapName: '阳光龙巢',
    objective: '带着三条线索登上阳光龙巢，终结 Yzmerith the Ember Queen。',
    blurb: '烬后倒下了。阳光第一次照进那座巢穴，而你的名字被写进了歌里。',
    reward: { xp: 600, gold: 200 }
  , localized:{"en":{"name":"Act IV · The Ember Queen","mapName":"The Sun Dragon's Roost","objective":"Take the three clues to the Sun Dragon's Roost and defeat Yzmerith the Ember Queen.","blurb":"The queen falls. Sunlight enters her roost, and your name enters the songs."},"zh-CN":{"name":"第四幕 · 烬后","mapName":"日龙巢穴","objective":"带着三条线索登上日龙巢穴，击败烬后伊兹梅莉丝。","blurb":"烬后倒下，阳光第一次照进巢穴，你的名字被写进歌里。"}}}
];

const CLUE_MAPS = { 'howling-hills': 'hills', sewers: 'sewers', mill: 'mill' };
const CLUE_LABELS = { hills: '嚎叫丘陵的酋长', sewers: '下水道的母巢', mill: '磨坊的守卫' };
const clueDisplay = id => ({key:'content.clue.'+id,fallback:CLUE_LABELS[id]});
const display = (node,field) => ({localized:Object.fromEntries(['en','zh-CN'].map(locale=>[locale,node.localized[locale][field]])),fallback:node[field]});

function newCampaign() {
  return {
    stage: 0,                 // 0 = not started, 1..4 = acts completed
    acts: { relic: false, key: false, clues: { hills: false, sewers: false, mill: false }, queen: false },
    startedAt: null,
    completedAt: null,
    epilogue: null
  };
}

function ensure(campaign) {
  const c = campaign && typeof campaign === 'object' ? campaign : newCampaign();
  c.acts = c.acts || {};
  c.acts.clues = c.acts.clues || { hills: false, sewers: false, mill: false };
  if (typeof c.stage !== 'number') c.stage = 0;
  return c;
}

function cluesDone(c) {
  const cl = ensure(c).acts.clues || {};
  return Object.keys(CLUE_LABELS).filter(k => cl[k]).length;
}

// Has this act been completed? The clues act is an object of three sub-flags, so a plain
// truthiness check would always report it as done.
function actDone(campaign, actId) {
  const c = ensure(campaign);
  if (actId === 'clues') return Object.keys(CLUE_LABELS).every(k => !!c.acts.clues[k]);
  return !!c.acts[actId];
}

// Current objective line for the region map banner / delve HUD.
function objective(campaign) {
  const c = ensure(campaign);
  if (c.completedAt) return { done: true, text: '主线已完成——烬后已死，瓦尔谷重归安宁。',textDisplay:{key:'content.campaign.done'} };
  if (c.stage === 0) return { act: 1, text: ACTS[0].objective,textDisplay:display(ACTS[0],'objective') };
  if (c.stage === 1) return { act: 2, text: ACTS[1].objective,textDisplay:display(ACTS[1],'objective') };
  if (c.stage === 2) {
    const cl = c.acts.clues;
    const missing = Object.keys(CLUE_LABELS).filter(k => !cl[k]).map(k => CLUE_LABELS[k]).join('、');
    return { act: 3, text: `${ACTS[2].objective}（还差：${missing}）`,textDisplay:{key:'content.campaign.missing',params:{objective:display(ACTS[2],'objective'),missing:{parts:Object.keys(CLUE_LABELS).filter(k=>!cl[k]).map(clueDisplay),separator:' / '}}} };
  }
  if (c.stage === 3) return { act: 4, text: ACTS[3].objective,textDisplay:display(ACTS[3],'objective') };
  return { done: true, text: '主线已完成。',textDisplay:{key:'content.campaign.done'} };
}

function progress(campaign) {
  const c = ensure(campaign);
  const stage = c.stage;
  return {
    stage,
    total: 4,
    cluesDone: cluesDone(c),
    cluesTotal: Object.keys(CLUE_LABELS).length,
    labelDisplay: c.completedAt ? { key: 'guidance.complete.label' } : null,
    label: c.completedAt ? '主线完成' : `${Math.min(stage + (stage < 3 ? 1 : 0), 4)}/4`
  };
}

// Advance the story after a victorious delve on `mapId`.
// Returns { advanced, act, text, reward, completed } — advanced:false when the map is not the
// current step (out of order or already done).
function advance(campaign, mapId, opts = {}) {
  const c = ensure(campaign);
  if (!mapId) return { advanced: false, campaign: c };
  if (!c.startedAt) c.startedAt = Date.now();

  // Act 1
  if (c.stage === 0 && ACTS[0].mapIds.includes(mapId)) {
    c.acts.relic = true;
    c.stage = 1;
    return finish(c, ACTS[0], opts);
  }
  // Act 2 (needs the relic)
  if (c.stage === 1 && ACTS[1].mapIds.includes(mapId)) {
    c.acts.key = true;
    c.stage = 2;
    return finish(c, ACTS[1], opts);
  }
  // Act 3 — three clues, any order
  if (c.stage === 2 && CLUE_MAPS[mapId]) {
    const clue = CLUE_MAPS[mapId];
    if (c.acts.clues[clue]) {
      return { advanced: false, campaign: c, reason: 'already_done', text: `${CLUE_LABELS[clue]} 已经记录在案。`,textDisplay:{key:'content.campaign.recorded',params:{clue:clueDisplay(clue)}} };
    }
    c.acts.clues[clue] = true;
    const remaining = cluesDone(c);
    if (remaining >= Object.keys(CLUE_LABELS).length) {
      c.stage = 3;
      return finish(c, ACTS[2], opts);
    }
    return {
      advanced: true, act: 3, partial: true, campaign: c,
      text: `线索 ${remaining}/3 已确认：${CLUE_LABELS[clue]}。`,textDisplay:{key:'content.campaign.clue',params:{count:remaining,clue:clueDisplay(clue)}}
    };
  }
  // Act 4
  if (c.stage === 3 && ACTS[3].mapIds.includes(mapId)) {
    c.acts.queen = true;
    c.stage = 4;
    c.completedAt = Date.now();
    return finish(c, ACTS[3], { ...opts, completed: true });
  }
  // Out of order: the map simply is not the current step
  return { advanced: false, campaign: c, reason: 'not_current_step' };
}

function finish(c, act, opts) {
  const reward = act.reward || { xp: 0, gold: 0 };
  return {
    advanced: true,
    act: act.act,
    actId: act.id,
    actName: act.name,
    text: `${act.name} 完成 — ${act.blurb}`,
    textDisplay:{key:'content.campaign.finish',params:{name:display(act,'name'),blurb:display(act,'blurb')}},
    reward,
    completed: !!opts.completed || c.stage >= 4,
    campaign: c
  };
}

// The act the player is currently working on (null once the story is finished).
function currentAct(campaign) {
  const c = ensure(campaign);
  if (c.completedAt) return null;
  return ACTS[Math.min(c.stage, ACTS.length - 1)] || null;
}

// Which act (if any) is the next step for this map — used to mark map nodes and delve HUDs.
function actForMap(campaign, mapId) {
  const c = ensure(campaign);
  if (c.completedAt) return null;
  if (c.stage === 0 && ACTS[0].mapIds.includes(mapId)) return ACTS[0];
  if (c.stage === 1 && ACTS[1].mapIds.includes(mapId)) return ACTS[1];
  if (c.stage === 2 && CLUE_MAPS[mapId] && !c.acts.clues[CLUE_MAPS[mapId]]) return ACTS[2];
  if (c.stage === 3 && ACTS[3].mapIds.includes(mapId)) return ACTS[3];
  return null;
}

// Deterministic fallback epilogue (the AI DM overwrites this when a model is configured).
function fallbackEpilogue(char, stats = {}) {
  const name = (char && char.name) || '无名者';
  return `${name} 站在龙巢的裂口处，风把灰烬吹散。圣物已归位，钥匙留在了它该在的水底，三条线索拼成的答案被龙血洗掉。` +
    `瓦尔谷的清晨照常到来——只是从今往后，酒馆里关于你的故事，会从「那个下墓穴的」变成「那个杀了烬后的人」。` +
    (stats.kills ? `（总计击杀 ${stats.kills}，完成地牢 ${stats.delves || 0} 次。）` : '');
}

module.exports = {
  ACTS,
  CLUE_MAPS,
  CLUE_LABELS,
  newCampaign,
  ensure,
  cluesDone,
  actDone,
  objective,
  progress,
  advance,
  actForMap,
  currentAct,
  fallbackEpilogue
};
