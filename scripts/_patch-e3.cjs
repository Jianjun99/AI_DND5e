// one-off: extra attack, scroll use, invisibility break, buff expiry fix
const fs = require('fs');
let s = fs.readFileSync('server/game/engine.js', 'utf8');
let n = 0;
const sub = (from, to) => {
  if (!s.includes(from)) { console.log('MISS:', from.slice(0, 70)); return; }
  s = s.split(from).join(to); n++;
};

// extra attack helper
sub("function p_name(state) { const p = playerEntity(state); return p ? p.name : 'You'; }",
    "function p_name(state) { const p = playerEntity(state); return p ? p.name : 'You'; }\n\nfunction hasExtraAttack(char) {\n  const cls = byId(CLASSES, char.className);\n  return (cls.features || []).some(f => f.id === 'extra_attack' && f.level <= char.level);\n}");

// playerAttack: accept opts, break invisibility, chain the second attack
sub("function playerAttack(state, targetId, weaponId, events) {\n  const p = playerEntity(state);",
    "function playerAttack(state, targetId, weaponId, events, opts = {}) {\n  const p = playerEntity(state);\n  removeBuff(p, 'invisible'); // attacking breaks Invisibility");
sub("  const dealt = applyDamage(state, target, dmgTotal, atk.dmgType, events);\n  addLog(state, 'mech', `${target.name} takes ${dealt} damage (${target.hp}/${target.hpMax} HP${target.alive === false ? ', slain' : ''}).`);",
    "  const dealt = applyDamage(state, target, dmgTotal, atk.dmgType, events);\n  addLog(state, 'mech', `${target.name} takes ${dealt} damage (${target.hp}/${target.hpMax} HP${target.alive === false ? ', slain' : ''}).`);\n  // Extra Attack (level 5 martials): the Attack action strikes twice\n  if (opts.allowExtra && state.mode === 'combat' && !state.flags.used_extra && hasExtraAttack(char)\n      && target.alive !== false && manhattan(p, target) <= 1 && atk.weaponId !== 'unarmed') {\n    state.flags.used_extra = true;\n    addLog(state, 'mech', `${p.name} presses the attack — Extra Attack!`);\n    playerAttack(state, targetId, atk.weaponId, events, {});\n  }");

// castSpell: break invisibility on casting
sub("  const isCantrip = sp.level === 0;\n  if (!isCantrip && !opts.free) {",
    "  removeBuff(p, 'invisible'); // casting breaks Invisibility\n  const isCantrip = sp.level === 0;\n  if (!isCantrip && !opts.free) {");

// tickBuffs: expired condition buffs clear their condition
sub("    e.buffs.forEach(b => b.rounds--);\n    e.buffs = e.buffs.filter(b => b.rounds > 0);",
    "    e.buffs.forEach(b => b.rounds--);\n    const expiredConds = e.buffs.filter(b => b.rounds <= 0 && b.condition).map(b => b.condId);\n    e.buffs = e.buffs.filter(b => b.rounds > 0);\n    (expiredConds || []).forEach(cid => { e.conditions = (e.conditions || []).filter(c => c !== cid); });");

fs.writeFileSync(f, s);
console.log('applied', n);
