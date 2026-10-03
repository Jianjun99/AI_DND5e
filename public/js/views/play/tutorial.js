// tutorial.js — T5 first-delve coach. A small floating card that walks a brand-new player
// through one delve: move → interact → one combat → settle. Hard rules (see
// docs/T5_T7_PARALLEL_HANDOFF.md):
//   - it OBSERVES only: steps advance from server state (player position, mode, stats.kills,
//     the settled mirror) and the server's own action responses (an interact that the server
//     did not reject). It never reads client-side roll results and never sends an action —
//     it cannot change a game outcome or finish an objective for the player.
//   - one-time: progress lives in localStorage ('aiDnd.tutorial.v1'); done/skipped installs
//     never see it again, an unfinished run resumes at its current step instead of restarting.
//   - no leaks: the copy names mechanics the HUD already shows, never coordinates,
//     undiscovered objects or loot.
// play.js keeps only a few hooks: createDelveTutorial + maybeStart on mount, observe() from
// update() and act(), destroy() in the view cleanup.

const STORE_KEY = 'aiDnd.tutorial.v1';

// Sequential steps; 'combat' can jump ahead of 'move'/'interact' when a fight starts first,
// and 'settle' takes over the moment the delve ends, whatever is still incomplete.
const STEPS = [
  { id: 'move', icon: '👣', title: '移动', text: '点击地图上发亮的地块移动（也可以用 WASD）。顶部目标提示会告诉你这一局要做什么。' },
  { id: 'interact', icon: '🖐️', title: '互动', text: '靠近门、宝箱或营火时，直接点击它互动——宝箱开出战利品，营火可以休息恢复。' },
  { id: 'combat', icon: '⚔️', title: '战斗', text: '遭遇敌人时：先在战况条选中目标，再点「攻击」或「施法」；行动用完后点「结束回合」。战斗面板会标明哪些行动还可用。' },
  { id: 'settle', icon: '🧾', title: '结算', text: '目标完成或撤退后结算面板会自动打开——确认收获已保存，再回营地看下一目标。走回营火格才算完成胜利。' }
];
const STEP_IDS = STEPS.map(s => s.id);

function load() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return { status: 'active', done: [], step: 'move', killsBase: null };
    const v = JSON.parse(raw);
    if (!v || (v.status !== 'active' && v.status !== 'done' && v.status !== 'skipped')) {
      return { status: 'active', done: [], step: 'move', killsBase: null };
    }
    return {
      status: v.status,
      done: Array.isArray(v.done) ? v.done : [],
      step: STEP_IDS.includes(v.step) ? v.step : 'move',
      killsBase: typeof v.killsBase === 'number' ? v.killsBase : null
    };
  } catch {
    return { status: 'active', done: [], step: 'move', killsBase: null };
  }
}

function persist(progress) {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(progress)); } catch { /* private mode etc. */ }
}

function playerOf(game) {
  return (game.entities || []).find(e => e.kind === 'player') || null;
}

export function createDelveTutorial() {
  let progress = load();
  let card = null;
  let alive = false;
  let startPos = null;

  function nextFocus(afterId) {
    const remaining = STEPS.map(s => s.id).filter(id => !progress.done.includes(id));
    // keep the natural order unless the jump rules moved us forward deliberately
    if (afterId && remaining.includes(afterId)) return afterId;
    return remaining[0] || null;
  }

  function save() {
    persist(progress);
  }

  function render() {
    if (!card || !alive) return;
    const idx = STEPS.findIndex(s => s.id === progress.step);
    const step = STEPS[idx];
    if (!step) { card.hidden = true; return; }
    card.hidden = false;
    card.innerHTML = `
      <div class="tutorial-head">
        <span>🎓 首次探险引导 · <b>${idx + 1}/${STEPS.length} ${step.title}</b></span>
        <button class="tutorial-skip" id="tutorialSkipBtn" title="以后不再显示">跳过 ✕</button>
      </div>
      <p class="tutorial-text">${step.icon} ${step.text}</p>
      <div class="tutorial-dots">${STEPS.map((s, i) =>
        `<span class="tutorial-dot ${s.id === progress.step ? 'current' : ''} ${progress.done.includes(s.id) ? 'done' : ''}"></span>`).join('')}</div>`;
    const skip = document.getElementById('tutorialSkipBtn');
    if (skip) skip.addEventListener('click', () => {
      progress = { status: 'skipped', done: progress.done, step: progress.step, killsBase: progress.killsBase };
      save();
      teardown();
    });
  }

  function complete(id) {
    if (progress.done.includes(id)) return;
    progress.done.push(id);
    const focus = nextFocus();
    if (!focus) {
      progress.status = 'done';
      progress.step = 'settle';
      save();
      finish();
      return;
    }
    progress.step = focus;
    save();
    render();
  }

  function finish() {
    if (!card || !alive) return;
    card.hidden = false;
    card.innerHTML = `<p class="tutorial-text">✅ 引导完成——祝冒险顺利！随时可以把这段话忘掉。</p>`;
    setTimeout(() => { if (card) card.hidden = true; }, 3500);
  }

  function teardown() {
    if (card) card.remove();
    card = null;
    alive = false;
  }

  return {
    // Mount point: play-layout. Only attaches while the install is still mid-tutorial.
    maybeStart(game) {
      if (progress.status !== 'active' || alive) return;
      const host = document.querySelector('.play-layout');
      if (!host) return;
      card = document.createElement('div');
      card.className = 'delve-tutorial-card';
      card.setAttribute('data-tutorial', '1');
      host.appendChild(card);
      alive = true;
      const p = playerOf(game);
      startPos = p ? { x: p.x, y: p.y } : null;
      if (progress.killsBase == null) {
        progress.killsBase = (game.stats && game.stats.kills) || 0;
        save();
      }
      render();
    },

    // Called after every adopted server state (update() and act()). `action`/`events` are
    // only passed by act() — the server's response to the player's own move.
    observe(game, events, action) {
      if (!alive || progress.status !== 'active' || !game) return;

      // the delve is ending: settle takes over regardless of what is incomplete
      if ((game.mode === 'victory' || game.mode === 'retreat' || game.mode === 'over') && !progress.done.includes('settle')) {
        if (progress.step !== 'settle') { progress.step = 'settle'; save(); render(); }
      }
      // a fight starting early pulls the combat step forward (earlier steps resume after)
      if (game.mode === 'combat' && !progress.done.includes('combat') && progress.step !== 'combat') {
        progress.step = 'combat';
        save();
        render();
      }

      switch (progress.step) {
        case 'move': {
          const p = playerOf(game);
          if (startPos && p && (p.x !== startPos.x || p.y !== startPos.y)) complete('move');
          break;
        }
        case 'interact': {
          // the server acknowledged the player's interaction without an error event.
          // T7 moved locked chests/traps onto the adjudicated skillCheckObject action, so
          // an acknowledged check (success OR failed check — both are real interactions)
          // counts here too; only transport-level 'error' events (no target, no tools)
          // leave the step open.
          if (action && (action.type === 'interact' || action.type === 'skillCheckObject') &&
              Array.isArray(events) && !events.some(e => e && e.type === 'error')) {
            complete('interact');
          }
          break;
        }
        case 'combat': {
          // a kill recorded while this step is active completes it — the mode may already
          // be back to 'explore' on the very action that landed the killing blow (found in
          // the T5 playtest: the old mode check made the step uncompletable that way)
          const kills = (game.stats && game.stats.kills) || 0;
          if (progress.killsBase == null) { progress.killsBase = kills; save(); }
          if (kills > progress.killsBase) complete('combat');
          break;
        }
        case 'settle': {
          // the server wrote the settlement mirror (T3) — the player confirmed the summary
          if (game.settled) complete('settle');
          break;
        }
        default: break;
      }
    },

    destroy() {
      teardown();
    }
  };
}
