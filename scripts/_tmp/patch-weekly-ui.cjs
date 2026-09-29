// One-off patch: weekly challenge UI in districts.js (guildhall card + wiring +
// hall ranking card). Run once, then delete. CRLF-safe single-line anchors.
const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', '..', 'public', 'js', 'views', 'overworld', 'districts.js');
let s = fs.readFileSync(FILE, 'utf8');

const L = (arr) => arr.join('\n');

// 1) guildhall weekly card, inserted before the bounty grid
const ghAnchor = '      <div class="bounty-grid grid cols3">';
if (!s.includes(ghAnchor)) { console.error('guildhall anchor missing'); process.exit(1); }
const ghCard = L([
  '      ${(cityData && cityData.weekly) ? `',
  '        <div class="card" style="margin-bottom:14px; border-color:var(--gold-dim); background:var(--bg2);">',
  '          <div style="display:flex; justify-content:space-between; align-items:baseline; flex-wrap:wrap; gap:8px;">',
  '            <h3 style="margin:0;">🏅 每周试炼 · Weekly Trial — ${esc(cityData.weekly.label)}</h3>',
  '            <span class="chip blue">Depth ${cityData.weekly.depth}</span>',
  '          </div>',
  '          <p class="muted small" style="margin:8px 0;">全体英雄共享同一个本周种子——同样的地牢、同样的怪物。击败 Depth Guardian 即登上周榜。固定难度 normal，不可重掷。</p>',
  '          ${(activeChar.weekly && activeChar.weekly.label === cityData.weekly.label) ? `<div class="small" style="color:var(--green); margin-bottom:8px;">✔ 本周已胜 ${activeChar.weekly.wins} 次（最佳击杀 ${activeChar.weekly.best ? activeChar.weekly.best.kills : \'-\'}）</div>` : \'\'}',
  '          <button class="btn primary" id="weeklyEmbarkBtn" ${activeChar ? \'\' : \'disabled\'}>⚔ 接受本周试炼</button>',
  '        </div>` : \'\'}',
  '',
  '      <div class="bounty-grid grid cols3">'
]);
s = s.replace(ghAnchor, ghCard);

// 2) wire the embark button in attachDistrictSpecificEvents (before the bounty wiring)
const wireAnchor = "      document.querySelectorAll('[data-bounty-id]').forEach(b => b.addEventListener('click',";
if (!s.includes(wireAnchor)) { console.error('wire anchor missing'); process.exit(1); }
const wireBlock = L([
  "      const weeklyBtn = document.getElementById('weeklyEmbarkBtn');",
  '      if (weeklyBtn) weeklyBtn.addEventListener(\'click\', async () => {',
  '        const me = ctx.getActiveChar();',
  "        if (!me) return toast('Select a hero first.');",
  '        weeklyBtn.disabled = true;',
  '        try {',
  "          sfx.play('quest');",
  "          const res = await api.startGame(me.id, false, 'normal', 'weekly');",
  "          toast('⚔ 本周试炼开始：' + (res.state.weeklyLabel || 'weekly'));",
  '          ctx.rerenderPanel(main);',
  "          location.hash = '#/play/' + res.state.id;",
  '        } catch (e) {',
  '          weeklyBtn.disabled = false;',
  '          toast(e.message);',
  '        }',
  '      });',
  '',
  "      document.querySelectorAll('[data-bounty-id]').forEach(b => b.addEventListener('click',"
]);
s = s.replace(wireAnchor, wireBlock);

// 3) hall of heroes weekly ranking card (before the endless card)
const hallAnchor = '      ${(endlessRunners && endlessRunners.length) ? `';
if (!s.includes(hallAnchor)) { console.error('hall anchor missing'); process.exit(1); }
const hallCard = L([
  '      ${(weeklyRunners && weeklyRunners.length) ? `',
  '        <div class="card" style="margin-bottom:14px; border-color:var(--gold-dim); background:var(--bg2);">',
  '          <h3 style="margin:0 0 6px;">🏅 每周试炼榜 · ${esc(weeklyLabel)}</h3>',
  '          ${weeklyRunners.map((r, i) => `',
  '            <div class="stat-line">',
  '              <span>${i === 0 ? \'🥇\' : i === 1 ? \'🥈\' : i === 2 ? \'🥉\' : \'🏅\'} ${esc(r.name)} <span class="muted small">Lv ${r.level} ${esc(r.className)}</span></span>',
  '              <span style="color:var(--gold); font-weight:600;">✔ ${r.wins} 胜 · 最佳击杀 ${r.best ? r.best.kills : \'-\'}</span>',
  '            </div>`).join(\'\')}',
  '        </div>` : \'\'}',
  '',
  '      ${(endlessRunners && endlessRunners.length) ? `'
]);
s = s.replace(hallAnchor, hallCard);

// 4) destructure the new hall payload fields
const oldDestructure = '    const { bestiary = [], trophies = [], champions = [], bestiaryProgress = null, campaign = null, endlessRunners = [] } = hallData;';
if (!s.includes(oldDestructure)) { console.error('destructure missing'); process.exit(1); }
s = s.replace(oldDestructure, '    const { bestiary = [], trophies = [], champions = [], bestiaryProgress = null, campaign = null, endlessRunners = [], weeklyRunners = [], weeklyLabel = null } = hallData;');

fs.writeFileSync(FILE, s);
console.log('districts.js patched');
