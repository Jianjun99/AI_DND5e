// bounded-actions.js — Bounded Natural Language Actions (T13a)
// Maps English and Chinese natural language input to five authorized categories:
// 1. Investigate visible objects (<= 2 tiles)
// 2. Talk to visible NPCs (<= 4 tiles)
// 3. Use owned items (inventory qty > 0)
// 4. Current legal scene choices (adjacent speaker <= 1 tile)
// 5. Basic attacks (visible alive monsters in range)
// Preserves legacy referee commands (stealth, rest, disarm, etc.) with 100% compatibility.

const engine = require('./engine');
const presentation = require('./presentation');
const dm = require('./dm');
const executor = require('./action-executor');

function playerEntity(state) {
  return engine.playerEntity(state);
}

// A choice gated on an ending this hero never earned is not player knowledge yet. The server
// still honors it when the hero really reaches it; the model is simply never told it exists.
function choiceKnownToPlayer(state, choice) {
  if (choice?.condition?.type !== 'history_ending') return true;
  const storyId = state.map?.story?.requiresHistory?.storyId || state.map?.story?.id;
  const facts = state.character?.encounterFacts || [];
  return facts.some(f => f && f.ending === choice.condition.ending && (!storyId || f.storyId === storyId));
}

function buildAuthorizedContext(state, locale = 'en') {
  const p = playerEntity(state);
  const discovered = new Set(state.discovered || []);
  return {
    player: {
      name: state.character.name,
      hp: p ? p.hp : 0,
      hpMax: p ? p.hpMax : 0,
      inCombat: state.mode === 'combat',
      isPlayerTurn: state.mode !== 'combat' || (state.combat && state.combat.order[state.combat.turnIdx]?.id === 'player'),
      actionUsed: Boolean(state.combat?.actionUsed),
      bonusUsed: Boolean(state.combat?.bonusUsed)
    },
    inventory: (state.character.inventory || [])
      .filter(i => i.qty > 0)
      .map(i => {
        // Registry + this run's snapshot: an installed-pack or draft item still gets its name.
        const def = executor.itemDefinition(state, i.itemId) || {};
        return {
          itemId: i.itemId,
          uniqueId: i.uniqueId || null,
          name: presentation.plain(presentation.name(def, state)) || def.name || i.itemId,
          qty: i.qty
        };
      }),
    monsters: (state.entities || [])
      .filter(e => e.kind === 'monster' && e.alive !== false && !e.fled && discovered.has(e.x + ',' + e.y) && p && engine.los(state, p.x, p.y, e.x, e.y))
      .map(m => ({
        id: m.id,
        monsterId: m.monsterId,
        name: presentation.plain(presentation.name(m, state)) || m.name,
        hp: m.hp,
        hpMax: m.hpMax,
        distance: p ? engine.manhattan(p, m) : 99
      })),
    npcs: (state.entities || [])
      .filter(e => e.kind === 'npc' && e.alive !== false && discovered.has(e.x + ',' + e.y) && p && engine.manhattan(p, e) <= 4)
      .map(n => ({
        id: n.id,
        npcId: n.npcId,
        name: presentation.plain(presentation.name(n, state)) || n.name,
        distance: p ? engine.manhattan(p, n) : 99
      })),
    scenes: (state.map?.scenes || [])
      .filter(s => {
        if (!engine.sceneReady(state, s)) return false;
        const speaker = engine.sceneSpeaker(state, s);
        if (!speaker) return false;
        if (!discovered.has(speaker.x + ',' + speaker.y)) return false;
        const dist = p ? engine.manhattan(p, speaker) : 99;
        return dist <= 1;
      })
      .map(s => {
        const speaker = engine.sceneSpeaker(state, s);
        const dist = (speaker && p) ? engine.manhattan(p, speaker) : 99;
        return {
          sceneId: s.id,
          npcId: s.npcId || null,
          name: presentation.plain(presentation.descriptor(s)) || s.name,
          distance: dist,
          adjacent: dist <= 1,
          choices: s.choices.filter(c => choiceKnownToPlayer(state, c)).map(c => {
            const status = engine.sceneChoiceStatus(state, s, c);
            return {
              choiceId: c.id,
              label: presentation.plain(presentation.descriptor(c, 'label')) || c.label,
              available: !status.text,
              reason: status.text || '',
              costGold: c.effect?.costGold || 0,
              consumeItem: c.effect?.consumeItem || null
            };
          })
        };
      }),
    // Exactly the server-side player-visibility rule: an unspotted trap is not in the
    // candidate list, and an explored tile is not a found object.
    objects: (state.objects || [])
      .filter(o => engine.isObjectVisibleToPlayer(state, o) && p && engine.manhattan(p, o) <= 2)
      .map(o => ({
        id: o.id,
        type: o.type,
        name: presentation.plain(presentation.name(o, state)) || o.name || o.id,
        distance: p ? engine.manhattan(p, o) : 99
      }))
  };
}

function checkConfirmationNeeded(state, proposal, locale = 'en') {
  if (proposal.intent === 'sceneChoice') {
    const scene = (state.map?.scenes || []).find(s => s.id === proposal.sceneId);
    const choice = scene?.choices.find(c => c.id === proposal.choiceId);
    if (!choice) return null;
    const isEnding = Boolean(choice.ending) || scene.id === 'final_verdict';
    const hasCost = Boolean(choice.effect?.costGold && choice.effect.costGold > 0);
    if (isEnding || hasCost) {
      return {
        type: 'confirmation',
        prompt: locale === 'zh-CN' ? `确认执行“${choice.labelDisplay ? presentation.plain(choice.labelDisplay) : choice.label}”吗？` : `Confirm choice "${choice.label}"?`,
        promptDisplay: choice.labelDisplay,
        costWarning: hasCost ? (locale === 'zh-CN' ? `消耗 ${choice.effect.costGold} GP` : `Costs ${choice.effect.costGold} GP`) : '',
        action: { type: 'sceneChoice', sceneId: scene.id, choiceId: choice.id }
      };
    }
  }
  return null;
}

function validateProposal(state, proposal) {
  if (!proposal || typeof proposal !== 'object') return { valid: false, error: 'Invalid proposal structure.' };
  const p = playerEntity(state);
  if (!p || p.alive === false || p.conditions?.includes('unconscious')) {
    return { valid: false, error: 'Player is unconscious or fallen.' };
  }
  const discovered = new Set(state.discovered || []);
  switch (proposal.intent) {
    case 'sceneChoice': {
      if (!proposal.sceneId || !proposal.choiceId) return { valid: false, error: 'Missing sceneId or choiceId.' };
      const scene = (state.map?.scenes || []).find(s => s.id === proposal.sceneId);
      if (!scene || !engine.sceneReady(state, scene)) return { valid: false, error: 'Scene is not ready or resolved.' };
      const speaker = engine.sceneSpeaker(state, scene);
      if (!speaker || engine.manhattan(p, speaker) > 1) return { valid: false, error: 'Player is not adjacent to speaker.' };
      const choice = scene.choices.find(c => c.id === proposal.choiceId);
      if (!choice) return { valid: false, error: 'Choice does not exist in scene.' };
      const reason = engine.sceneChoiceReason(state, scene, choice);
      if (reason) return { valid: false, error: reason };
      return { valid: true };
    }
    case 'attack': {
      if (!proposal.targetId) return { valid: false, error: 'Missing targetId.' };
      const target = state.entities.find(e => e.id === proposal.targetId);
      if (!target || target.kind !== 'monster' || target.alive === false || target.fled) {
        return { valid: false, error: 'Target monster does not exist or is dead.' };
      }
      if (!discovered.has(target.x + ',' + target.y) || !engine.los(state, p.x, p.y, target.x, target.y)) {
        return { valid: false, error: 'Target is not in line of sight.' };
      }
      // Turn ownership and the action slot are the executor's single rule, shared with the
      // attack button — a proposal can never be cheaper than the click.
      const blocked = executor.actionBlocker(state, 'action');
      if (blocked) return { valid: false, error: blocked.text, messageKey: blocked.messageKey };
      const dist = engine.manhattan(p, target);
      const attacks = state.character.attacks || [];
      const canMelee = dist <= 1 && attacks.some(a => !a.ranged);
      const canRanged = attacks.some(a => a.ranged && dist <= 10);
      if (!canMelee && !canRanged) return { valid: false, error: 'Target out of reach.' };
      return { valid: true };
    }
    case 'useItem': {
      // The real instance the player asked for (itemId or rolled uniqueId), enough quantity,
      // something usable at all, and the same turn/slot check as the useItem button.
      const entry = executor.resolveItemEntry(state, proposal.itemId);
      if (!entry) return { valid: false, error: 'Item not in inventory or qty is 0.' };
      const kind = executor.itemEconomyKind(state, entry);
      if (!kind) return { valid: false, error: 'Cannot use that item right now.' };
      const blocked = executor.actionBlocker(state, kind);
      if (blocked) return { valid: false, error: blocked.text, messageKey: blocked.messageKey };
      return { valid: true };
    }
    case 'talk': {
      const npc = state.entities.find(e => e.id === proposal.targetId || e.npcId === proposal.npcId);
      if (!npc || npc.kind !== 'npc' || npc.alive === false) return { valid: false, error: 'NPC not found.' };
      if (!discovered.has(npc.x + ',' + npc.y) || engine.manhattan(p, npc) > 4) return { valid: false, error: 'NPC too far away.' };
      return { valid: true };
    }
    case 'investigate': {
      if (proposal.general) return { valid: true };
      const obj = (state.objects || []).find(o => o.id === proposal.targetId);
      // Same rule as the candidate list: an unspotted trap cannot be named as a target, and
      // the engine's own search may still stumble onto it later.
      if (!obj || !engine.isObjectVisibleToPlayer(state, obj) || engine.manhattan(p, obj) > 2) {
        return { valid: false, error: 'Object not found or too far.' };
      }
      return { valid: true };
    }
    default:
      return { valid: false, error: 'Unknown intent: ' + proposal.intent };
  }
}

function executeProposal(state, proposal, locale = 'en', events = []) {
  const char = state.character;
  switch (proposal.intent) {
    case 'sceneChoice': {
      engine.chooseScene(state, proposal.sceneId, proposal.choiceId, events);
      break;
    }
    case 'attack': {
      const target = state.entities.find(e => e.id === proposal.targetId);
      if (!target) return;
      const atk = char.attacks.find(a => !a.ranged && a.weaponId !== 'unarmed') || char.attacks[0];
      // The attack button's executor: turn, action slot, combat start and the swing itself.
      executor.attack(state, { targetId: target.id, weaponId: atk ? atk.weaponId : undefined }, events);
      break;
    }
    case 'useItem': {
      // The same executor as the useItem button, honoring the item the sentence named.
      if (proposal.itemId) executor.useItem(state, { itemId: proposal.itemId, targetId: proposal.targetId }, events);
      else executor.drinkPotion(state, null, events);
      break;
    }
    case 'talk': {
      const npc = state.entities.find(e => e.id === proposal.targetId || e.npcId === proposal.npcId);
      if (!npc) return;
      events.push({
        type: 'chat_open',
        narrate: false,
        text: locale === 'zh-CN' ? `${presentation.plain(presentation.name(npc, state))}期待地看着你。` : `${presentation.plain(presentation.name(npc, state))} looks at you expectantly.`,
        data: {
          npcId: npc.npcId,
          name: npc.name,
          sceneId: engine.activeSceneView(state, npc.npcId)?.id
        }
      });
      break;
    }
    case 'investigate': {
      if (proposal.general) {
        // One search rule, shared with the legacy "search" command.
        executor.searchArea(state, events);
      } else {
        const obj = state.objects.find(o => o.id === proposal.targetId);
        // Defense in depth: an object the hero has not found is not investigable from a proposal,
        // even for a caller that skipped validateProposal. Same visibility rule as the candidates.
        if (obj && !engine.isObjectVisibleToPlayer(state, obj)) {
          events.push({
            type: 'error',
            text: locale === 'zh-CN' ? '这里没有你能调查的目标。' : 'There is nothing here for you to investigate.',
            textDisplay: { key: 'story.error.investigate_invisible', fallback: locale === 'zh-CN' ? '这里没有你能调查的目标。' : 'There is nothing here for you to investigate.' }
          });
          break;
        }
        if (obj) {
          if (obj.type === 'trap') {
            const check = engine.skillCheck(state, 'investigation', 12);
            if (check.success) {
              obj.revealed = true;
              const ev = { type: 'trap_found', narrate: true, text: locale === 'zh-CN' ? `仔细调查后发现了一个${presentation.plain(presentation.name(obj, state))}。` : `Carefully investigating reveals a ${obj.name}.` };
              events.push(ev); engine.addLog(state, 'mech', ev);
            } else {
              const ev = { type: 'info', narrate: true, text: locale === 'zh-CN' ? `你调查了此处，但未能发现具体机栝。` : `You investigated here but found no mechanism.` };
              events.push(ev);
            }
          } else {
            engine.interactObject(state, obj.id, events);
          }
        }
      }
      break;
    }
  }
}

function parseDeterministicAction(state, text, locale = 'en') {
  const p = playerEntity(state);
  const t = text.trim();
  const events = [];

  // 1. Compound sentence detection (enforce single mechanical action per turn)
  const compoundPattern = /(?:然后|接着|随后|之后|\band\s+then\b|\bthen\b|\bafter\s+that\b)/i;
  let actionText = t;
  let hasCompoundNotice = false;
  if (compoundPattern.test(t)) {
    hasCompoundNotice = true;
    actionText = t.split(compoundPattern)[0].trim();
  } else if (/\b(?:attack|hit|strike)\b.*\b\d+\s*times\b/i.test(t) || /(?:攻击|砍|打)\s*(?:\d+|十|[一二两三四五六七八九])\s*(?:次|下|刀)/.test(t)) {
    hasCompoundNotice = true;
  }
  const cleanLower = actionText.toLowerCase();

  const addNotice = () => {
    if (hasCompoundNotice) {
      events.push({
        type: 'info',
        text: locale === 'zh-CN' ? '一回合只能执行一个动作，已为你执行第一项操作。' : 'Only one action per turn; executed the first action.',
        textDisplay: {
          key: 'story.error.compoundNotice',
          fallback: locale === 'zh-CN' ? '一回合只能执行一个动作，已为你执行第一项操作。' : 'Only one action per turn; executed the first action.'
        }
      });
    }
  };

  // 2. Category 4: Scene Choices (highest priority for phrases involving NPC / scene interactions)
  const allScenes = (state.map?.scenes || []);
  const scenesWithDist = allScenes.map(s => {
    const speaker = engine.sceneSpeaker(state, s);
    const dist = (speaker && p) ? engine.manhattan(p, speaker) : 99;
    return { scene: s, speaker, dist, ready: engine.sceneReady(state, s) };
  });

  const scenePatterns = [
    { choiceId: 'give_aid', rxZh: /(?:给.*药水|药水.*给|救助.*信使|救.*里奥|救治.*信使|治疗.*信使)/, rxEn: /(?:give.*potion|aid.*lio|help.*lio|heal.*lio|offer.*potion)/i },
    { choiceId: 'listen', rxZh: /(?:听.*述说|听.*里奥|打听.*消息|询问.*发生)/, rxEn: /(?:listen|hear.*story|ask.*what happened|ask.*lio)/i },
    { choiceId: 'take_mail', rxZh: /(?:拿走.*信|拿走.*账册|夺取.*信|搜寻.*信|取走.*邮件)/, rxEn: /(?:take.*mail|take.*ledger|seize.*mail|search.*bag)/i },
    { choiceId: 'pay_toll', rxZh: /(?:交.*(?:通行费|过路费)|支付.*(?:通行费|过路费)|付.*(?:通行费|过路费)|给.*(?:通行费|过路费)|(?:通行费|过路费))/, rxEn: /(?:pay.*toll|pay.*fee)/i },
    { choiceId: 'explain', rxZh: /(?:说明.*(?:来意|任务)|出示.*(?:印信|信物)|解释.*来意|说明来意|免税通行)/, rxEn: /(?:show.*seal|explain.*(?:mission|errand|search|presence)|explain)/i },
    { choiceId: 'show_seal', rxZh: /(?:说明.*任务|出示.*印信|出示.*信物|解释.*来意|说明来意)/, rxEn: /(?:show.*seal|explain.*mission|explain.*errand)/i },
    { choiceId: 'fight', rxZh: /(?:强行闯过|拔剑硬闯|硬闯|攻击卫兵|强行通过)/, rxEn: /(?:force.*way|fight.*guard|draw steel)/i },
    { choiceId: 'report', rxZh: /(?:汇报.*勾结|报告.*真相|揭发.*巡逻队|向官府汇报)/, rxEn: /(?:report.*corruption|report.*truth|report.*patrol)/i },
    { choiceId: 'protect', rxZh: /(?:保护.*难民|隐瞒.*账册|庇护难民)/, rxEn: /(?:protect.*refugee|hide.*ledger|shield.*refugee)/i },
    { choiceId: 'accord', rxZh: /(?:促成.*协定|调解.*双方|达成共识|达成协定)/, rxEn: /(?:broker.*accord|negotiate.*accord|reach.*accord)/i },
    { choiceId: 'show_pass', rxZh: /(?:出示.*路引|出示.*通行|出示官府路引)/, rxEn: /(?:show.*pass|official.*pass)/i },
    { choiceId: 'dock_bypass', rxZh: /(?:码头.*绕行|绕过.*大门|从码头潜行|潜行绕行)/, rxEn: /(?:bypass.*gate|dock.*bypass|sneak.*docks)/i },
    { choiceId: 'accord_notice', rxZh: /(?:出示.*协定|协定公文)/, rxEn: /(?:show.*accord.*notice|accord.*notice)/i },
    { choiceId: 'inquire_post', rxZh: /(?:询问.*哨所|打听.*哨所|了解哨所)/, rxEn: /(?:inquire.*post|ask.*about.*post)/i },
    { choiceId: 'force_gate', rxZh: /(?:强闯大门|硬闯哨所|强行冲卡)/, rxEn: /(?:force.*gate|charge.*gate)/i },
    { choiceId: 'cite_records', rxZh: /(?:引用.*税赋|引用.*案卷|查阅税赋)/, rxEn: /(?:cite.*records|cite.*tax)/i },
    { choiceId: 'refugee_token', rxZh: /(?:出示.*难民信物|出示信物|难民信物)/, rxEn: /(?:show.*refugee.*token|refugee.*token)/i },
    { choiceId: 'accord_advocacy', rxZh: /(?:援引.*共治|援引.*协议|共治协议)/, rxEn: /(?:advocate.*accord|accord.*advocacy)/i },
    { choiceId: 'browse_open', rxZh: /(?:借阅.*公开|翻看.*公开|直接借阅|借阅账册)/, rxEn: /(?:browse.*open|browse.*records|browse.*ledger)/i },
    { choiceId: 'pay_deposit', rxZh: /(?:支付.*押金|交押金|付押金)/, rxEn: /(?:pay.*deposit)/i },
    { choiceId: 'choice_lawful_order', rxZh: /(?:恢复.*公序|支持.*官府|维护秩序|秩序终局)/, rxEn: /(?:lawful.*order|uphold.*order)/i },
    { choiceId: 'choice_free_haven', rxZh: /(?:收容.*绿洲|庇护.*难民营|建立避难所|自由绿洲)/, rxEn: /(?:free.*haven|shelter.*refugees)/i },
    { choiceId: 'choice_shared_covenant', rxZh: /(?:公议.*盟约|公议共治|达成共治盟约|共享盟约)/, rxEn: /(?:shared.*covenant|joint.*governance)/i }
  ];

  for (const pat of scenePatterns) {
    if (pat.rxZh.test(actionText) || pat.rxEn.test(cleanLower)) {
      const matchSceneInfo = scenesWithDist.find(s => s.scene.choices.some(c => c.id === pat.choiceId));
      if (matchSceneInfo) {
        const { scene, dist, ready } = matchSceneInfo;
        const choice = scene.choices.find(c => c.id === pat.choiceId);
        if (!ready) {
          addNotice();
          return { handled: true, error: { type: 'error', text: locale === 'zh-CN' ? '该事件目前无法进行或已结束。' : 'This scene is not available or has already concluded.' }, events };
        }
        if (dist > 1) {
          addNotice();
          return { handled: true, error: { type: 'error', text: locale === 'zh-CN' ? '距离太远，请走近后再做出选择。' : 'Move closer to make this choice.' }, events };
        }
        const status = engine.sceneChoiceStatus(state, scene, choice);
        if (status.text) {
          addNotice();
          const avails = scene.choices.filter(c => !engine.sceneChoiceReason(state, scene, c)).map(c => c.label).join(', ');
          const availNote = avails ? (locale === 'zh-CN' ? ` 当前可用：${avails}` : ` Currently available: ${avails}`) : '';
          return {
            handled: true,
            error: {
              type: 'error',
              text: (locale === 'zh-CN' ? `无法执行此选择：${status.display?.key ? status.text : status.text}` : `Cannot perform this choice: ${status.text}`) + availNote
            },
            events
          };
        }
        addNotice();
        const conf = checkConfirmationNeeded(state, { intent: 'sceneChoice', sceneId: scene.id, choiceId: choice.id }, locale);
        const alreadyConfirmed = /(?:确认|确定|\bconfirm\b|\byes\b)/i.test(actionText);
        if (conf && !alreadyConfirmed) {
          return { handled: true, confirmation: conf, events };
        }
        return { handled: true, proposal: { intent: 'sceneChoice', sceneId: scene.id, choiceId: choice.id }, events };
      }
    }
  }

  // Generic matching against adjacent pending scene choice labels
  const adjacentScenes = scenesWithDist.filter(s => s.ready && s.dist <= 1);
  for (const { scene } of adjacentScenes) {
    for (const choice of scene.choices) {
      const labelStr = (choice.label || '').toLowerCase();
      const labelZh = presentation.plain(choice.labelDisplay || '').toLowerCase();
      if ((labelStr && cleanLower.includes(labelStr)) || (labelZh && actionText.includes(labelZh))) {
        const status = engine.sceneChoiceStatus(state, scene, choice);
        if (status.text) {
          addNotice();
          return { handled: true, error: { type: 'error', text: (locale === 'zh-CN' ? `无法执行此选择：${status.text}` : `Cannot perform this choice: ${status.text}`) }, events };
        }
        addNotice();
        const conf = checkConfirmationNeeded(state, { intent: 'sceneChoice', sceneId: scene.id, choiceId: choice.id }, locale);
        const alreadyConfirmed = /(?:确认|确定|\bconfirm\b|\byes\b)/i.test(actionText);
        if (conf && !alreadyConfirmed) {
          return { handled: true, confirmation: conf, events };
        }
        return { handled: true, proposal: { intent: 'sceneChoice', sceneId: scene.id, choiceId: choice.id }, events };
      }
    }
  }

  // 3. Category 3: Use Item (Potions)
  const potionMatchZh = /(?:喝|服|用|使用|饮用).*(?:药水|治疗药水|强效药水)/.test(actionText) || /(?:治疗药水|药水).*(?:喝|用)/.test(actionText) || /^喝药$/.test(actionText);
  const potionMatchEn = (/\b(drink|quaff|sip)\b/.test(cleanLower) || /\b(use|take)\b.*potion/i.test(cleanLower) || /\bheal\b/i.test(cleanLower)) && !/altar|font|well/i.test(cleanLower);
  if (potionMatchZh || potionMatchEn) {
    // Whatever potion the hero really carries (including content-pack potions and rolled
    // instances), addressed by the same resolver the executor uses. A sentence that names a
    // specific brew is honoured; only an unnamed request falls back to the first healing potion.
    const mentioned = executor.findMentionedItem(state, actionText);
    if (mentioned) {
      addNotice();
      if (!mentioned.entry || !(mentioned.entry.qty > 0)) {
        const missingName = presentation.textFor(mentioned.def, 'name', locale) || presentation.plain(presentation.name(mentioned.def || { itemId: mentioned.id }, state));
        return {
          handled: true,
          error: {
            type: 'error',
            text: locale === 'zh-CN'
              ? `背包中没有可用的${missingName || '药水'}。`
              : `You have no ${missingName || 'potions'} left.`
          },
          events
        };
      }
      return { handled: true, proposal: { intent: 'useItem', itemId: mentioned.entry.uniqueId || mentioned.entry.itemId }, events };
    }

    const entry = executor.resolveItemEntry(state, null);
    addNotice();
    if (!entry) {
      return { handled: true, error: { type: 'error', text: locale === 'zh-CN' ? '背包中没有可用的药水。' : 'You have no potions left.' }, events };
    }
    return { handled: true, proposal: { intent: 'useItem', itemId: entry.uniqueId || entry.itemId }, events };
  }

  // 4. Category 5: Basic Attack
  const atkMatchZh = /(?:攻击|打击|击打|射击|刺杀|砍|刺|击杀|消灭)\s*(.*)/.exec(actionText);
  const atkMatchEn = /\b(attack|strike|shoot|hit|stab|slash|fight)\b\s*(?:the\s+|at\s+)?(.*)?/i.exec(cleanLower);
  if (atkMatchZh || atkMatchEn) {
    const guess = (atkMatchZh ? atkMatchZh[1] : (atkMatchEn[2] || '')).trim().toLowerCase();
    const visibleMonsters = (state.entities || []).filter(e =>
      e.kind === 'monster' && e.alive !== false && !e.fled &&
      (state.discovered || []).includes(e.x + ',' + e.y) &&
      p && engine.los(state, p.x, p.y, e.x, e.y)
    );

    let candidate = null;
    if (guess && !['it', 'enemy', 'monster', '怪物', '敌人', '目标'].includes(guess)) {
      const matches = visibleMonsters.filter(m =>
        m.name.toLowerCase().includes(guess) ||
        (m.monsterId && m.monsterId.toLowerCase().includes(guess)) ||
        presentation.plain(presentation.name(m, state)).toLowerCase().includes(guess)
      );
      if (matches.length > 1) {
        addNotice();
        return {
          handled: true,
          clarification: {
            type: 'clarification',
            prompt: locale === 'zh-CN' ? '你想攻击哪个目标？' : 'Which target do you want to attack?',
            promptDisplay: { key: 'ui.play.clarify_attack_target' },
            candidates: matches.map(m => ({
              id: m.id,
              label: `${presentation.plain(presentation.name(m, state)) || m.name} (${locale === 'zh-CN' ? '距离' : 'dist'} ${engine.manhattan(p, m)}, HP ${m.hp}/${m.hpMax})`,
              action: { type: 'attack', targetId: m.id }
            }))
          },
          events
        };
      } else if (matches.length === 1) {
        candidate = matches[0];
      } else {
        addNotice();
        return { handled: true, error: { type: 'error', text: locale === 'zh-CN' ? `视野内没有名为“${guess}”的目标。` : `No target named "${guess}" in sight.` }, events };
      }
    } else {
      if (visibleMonsters.length > 1) {
        addNotice();
        return {
          handled: true,
          clarification: {
            type: 'clarification',
            prompt: locale === 'zh-CN' ? '你想攻击哪个目标？' : 'Which target do you want to attack?',
            promptDisplay: { key: 'ui.play.clarify_attack_target' },
            candidates: visibleMonsters.map(m => ({
              id: m.id,
              label: `${presentation.plain(presentation.name(m, state)) || m.name} (${locale === 'zh-CN' ? '距离' : 'dist'} ${engine.manhattan(p, m)}, HP ${m.hp}/${m.hpMax})`,
              action: { type: 'attack', targetId: m.id }
            }))
          },
          events
        };
      } else if (visibleMonsters.length === 1) {
        candidate = visibleMonsters[0];
      } else {
        addNotice();
        return { handled: true, error: { type: 'error', text: locale === 'zh-CN' ? '周围没有可攻击的目标。' : 'You see nothing to attack.' }, events };
      }
    }

    if (candidate) {
      // The executor's own blocker: exactly what the attack button would answer right now.
      const blocked = executor.actionBlocker(state, 'action');
      if (blocked) {
        addNotice();
        return { handled: true, error: blocked, events };
      }
      const dist = engine.manhattan(p, candidate);
      const attacks = state.character.attacks || [];
      const canMelee = dist <= 1 && attacks.some(a => !a.ranged);
      const canRanged = attacks.some(a => a.ranged && dist <= 10);
      if (!canMelee && !canRanged) {
        addNotice();
        return { handled: true, error: { type: 'error', text: locale === 'zh-CN' ? `目标超出攻击范围（距离 ${dist} 格，近战需在 1 格内）。` : `Target is out of reach (${dist} tiles away; melee requires 1 tile).` }, events };
      }
      addNotice();
      return { handled: true, proposal: { intent: 'attack', targetId: candidate.id }, events };
    }
  }

  // 5. Category 2: Talk / Chat
  const talkMatchZh = /(?:对话|交谈|说话|聊聊|询问|找)\s*(.*)/.exec(actionText);
  const talkMatchEn = /\b(talk|speak|chat|ask|converse)\b\s*(?:to\s+|with\s+)?(.*)?/i.exec(cleanLower);
  if (talkMatchZh || talkMatchEn) {
    const guess = (talkMatchZh ? talkMatchZh[1] : (talkMatchEn[2] || '')).trim().toLowerCase();
    const candidateNpcs = (state.entities || []).filter(e =>
      e.kind === 'npc' && e.alive !== false &&
      (state.discovered || []).includes(e.x + ',' + e.y) &&
      p && engine.manhattan(p, e) <= 4
    );

    let targetNpc = null;
    if (guess && !['someone', 'npc', '人', '某人'].includes(guess)) {
      const match = candidateNpcs.find(n =>
        n.name.toLowerCase().includes(guess) ||
        (n.npcId && n.npcId.toLowerCase().includes(guess)) ||
        presentation.plain(presentation.name(n, state)).toLowerCase().includes(guess)
      );
      if (match) {
        targetNpc = match;
      } else {
        const farNpc = (state.entities || []).find(e =>
          e.kind === 'npc' && (e.name.toLowerCase().includes(guess) || (e.npcId && e.npcId.toLowerCase().includes(guess)))
        );
        addNotice();
        if (farNpc) {
          return { handled: true, error: { type: 'error', text: locale === 'zh-CN' ? '距离太远，请走近后再与该人物交谈。' : 'Move closer to speak with them.' }, events };
        }
        return { handled: true, error: { type: 'error', text: locale === 'zh-CN' ? `这里没有“${guess}”。` : `That NPC is not here.` }, events };
      }
    } else {
      if (candidateNpcs.length > 1) {
        addNotice();
        return {
          handled: true,
          clarification: {
            type: 'clarification',
            prompt: locale === 'zh-CN' ? '你想与谁交谈？' : 'Who do you want to talk to?',
            promptDisplay: { key: 'ui.play.clarify_npc_target' },
            candidates: candidateNpcs.map(n => ({
              id: n.id,
              label: presentation.plain(presentation.name(n, state)) || n.name,
              action: { type: 'chat', npcId: n.npcId, text: 'hello' }
            }))
          },
          events
        };
      } else if (candidateNpcs.length === 1) {
        targetNpc = candidateNpcs[0];
      } else {
        addNotice();
        return { handled: true, error: { type: 'error', text: locale === 'zh-CN' ? '附近没有可以交谈的人。' : 'There is no one nearby to talk to.' }, events };
      }
    }

    if (targetNpc) {
      addNotice();
      return { handled: true, proposal: { intent: 'talk', targetId: targetNpc.id, npcId: targetNpc.npcId }, events };
    }
  }

  // 6. Category 1: Investigate / Examine
  const invMatchZh = /(?:调查|检查|查看|搜索|寻找陷阱|探查)\s*(.*)/.exec(actionText);
  const invMatchEn = /\b(investigate|examine|inspect|check|search|look around|study)\b\s*(.*)?/i.exec(cleanLower);
  if (invMatchZh || invMatchEn) {
    const guess = (invMatchZh ? invMatchZh[1] : (invMatchEn[2] || '')).trim().toLowerCase();
    const genericSearchTerms = new Set(['', 'around', 'area', 'room', 'the room', 'the area', 'here', 'carefully', 'thoroughly', 'closely', '四周', '周围', '区域', '附近', '仔细', '到处', '周边']);
    if (guess && !genericSearchTerms.has(guess)) {
      const matchObjs = (state.objects || []).filter(o =>
        engine.isObjectVisibleToPlayer(state, o) &&
        p && engine.manhattan(p, o) <= 2 &&
        (o.type.toLowerCase().includes(guess) || o.id.toLowerCase().includes(guess) || (o.name && o.name.toLowerCase().includes(guess)))
      );
      if (matchObjs.length > 1) {
        addNotice();
        return {
          handled: true,
          clarification: {
            type: 'clarification',
            prompt: locale === 'zh-CN' ? '你想检查哪个目标？' : 'Which object do you want to examine?',
            promptDisplay: { key: 'ui.play.clarify_examine_target' },
            candidates: matchObjs.map(o => ({
              id: o.id,
              label: `${presentation.plain(presentation.name(o, state)) || o.name || o.id} (${locale === 'zh-CN' ? '距离' : 'dist'} ${engine.manhattan(p, o)})`,
              action: { type: 'interact', objectId: o.id }
            }))
          },
          events
        };
      } else if (matchObjs.length === 1) {
        addNotice();
        return { handled: true, proposal: { intent: 'investigate', targetId: matchObjs[0].id, targetType: matchObjs[0].type }, events };
      } else {
        addNotice();
        return { handled: true, error: { type: 'error', text: locale === 'zh-CN' ? `附近 2 格内没有可调查的“${guess}”。` : `No "${guess}" within 2 tiles to examine.` }, events };
      }
    } else {
      addNotice();
      return { handled: true, proposal: { intent: 'investigate', general: true }, events };
    }
  }

  return { handled: false };
}

async function proposeFromLlm(state, text, locale = 'en') {
  if (!(await dm.available())) return null;
  const ctx = buildAuthorizedContext(state, locale);
  const systemPrompt = `You are a strict action proposal parser for a single-player D&D 2024 tabletop game.
Your task is to map the player's natural language input into ONE bounded action proposal matching authorized elements.
Allowed intents: "sceneChoice", "attack", "useItem", "talk", "investigate", "none".
Rules:
- NEVER invent IDs, items, monsters, or scenes not in the Authorized Context.
- NEVER propose actions on enemies or objects not visible in the Authorized Context.
- Output ONLY a JSON object with this schema:
{
  "intent": "sceneChoice" | "attack" | "useItem" | "talk" | "investigate" | "none",
  "targetId": string or null,
  "sceneId": string or null,
  "choiceId": string or null,
  "itemId": string or null
}
No markdown formatting, no explanations, ONLY valid JSON.`;

  const userPrompt = `Authorized Context:
Player: ${ctx.player.name}, HP: ${ctx.player.hp}/${ctx.player.hpMax}, inCombat: ${ctx.player.inCombat}, isTurn: ${ctx.player.isPlayerTurn}, actionUsed: ${ctx.player.actionUsed}
Inventory: ${JSON.stringify(ctx.inventory)}
Visible Monsters: ${JSON.stringify(ctx.monsters)}
Visible NPCs: ${JSON.stringify(ctx.npcs)}
Adjacent Scenes & Choices: ${JSON.stringify(ctx.scenes)}
Nearby Objects (<=2 tiles): ${JSON.stringify(ctx.objects)}

Player text: "${text}"

Output JSON proposal:`;

  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt }
  ];

  const raw = await dm.callLlm(messages, locale);
  if (!raw) return null;
  try {
    const cleaned = raw.trim().replace(/^```json\s*/i, '').replace(/```$/i, '').trim();
    const parsed = JSON.parse(cleaned);
    if (!parsed || typeof parsed !== 'object' || parsed.intent === 'none') return null;
    const val = validateProposal(state, parsed);
    if (val.valid) return parsed;
    return null;
  } catch {
    return null;
  }
}

module.exports = {
  buildAuthorizedContext,
  checkConfirmationNeeded,
  validateProposal,
  executeProposal,
  parseDeterministicAction,
  proposeFromLlm
};
