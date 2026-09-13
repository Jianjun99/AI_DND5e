// one-off: wire endless mode + companion growth
const fs = require('fs');
let n = 0;

// ---- 1. content.js: dynamic map injection ----
let s = fs.readFileSync('server/game/content.js', 'utf8');
const a1 = 'function getMap(id) { const r = ensure(); return r.maps[id] || r.maps[\'crypt\'] || null; }';
const b1 = a1 + '\nfunction injectMap(mapDef) { const r = ensure(); r.maps[mapDef.id] = mapDef; }';
if (!s.includes(a1)) { console.log('MISS content getMap'); process.exit(1); }
s = s.replace(a1, b1);
s = s.replace('module.exports = { scan, reload, getMap,',
              'module.exports = { scan, reload, getMap, injectMap,');
fs.writeFileSync('server/game/content.js', s);
n++;
console.log('content injectMap added');

// ---- 2. engine.js: export injectMap usage already through content ----
// (engine already calls content.getMap, so injected maps are found automatically)

// ---- 3. routes/game.js: endless start + stairs pre-generation ----
let g = fs.readFileSync('server/routes/game.js', 'utf8');
const a2 = "const portraits = require('../portraits');";
const b2 = a2 + "\nconst endless = require('../game/endless');\nconst contentMod = require('../game/content');";
if (!g.includes(a2)) { console.log('MISS game portraits'); process.exit(1); }
g = g.replace(a2, b2);

// endless start: mapId 'endless_1' triggers generation + injection
const a3 = "  const state = engine.startGame(char, { bringAlly: allyOption, difficulty, mapId });";
const b3 = `  if (mapId === 'endless_1') {
    contentMod.injectMap(endless.generateFloor(1));
  }
  const state = engine.startGame(char, { bringAlly: allyOption, difficulty, mapId });`;
if (!g.includes(a3)) { console.log('MISS game start'); process.exit(1); }
g = g.replace(a3, b3);

// endless stairs: pre-generate next floor before interactObject
const a4 = "        case 'interact': {\n          engine.interactObject(state, action.objectId, events);\n          break;\n        }";
const b4 = `        case 'interact': {
          // pre-generate the next endless floor if the stairs lead deeper
          const stairsObj = state.objects.find(o => o.id === action.objectId && o.type === 'stairs' && o.to && o.to.mapId === '__endless_next__');
          if (stairsObj) {
            const nextDepth = (state.endlessDepth || 1) + 1;
            const nextMap = endless.generateFloor(nextDepth);
            contentMod.injectMap(nextMap);
            state.endlessDepth = nextDepth;
            stairsObj.to.mapId = nextMap.id;
            stairsObj.to.x = nextMap.playerStart.x;
            stairsObj.to.y = nextMap.playerStart.y;
          }
          engine.interactObject(state, action.objectId, events);
          break;
        }`;
if (!g.includes(a4)) { console.log('MISS game interact'); process.exit(1); }
g = g.replace(a4, b4);

// endless depth tracking on start
const a5 = "  state.endlessDepth = 1;";
if (!g.includes(a5)) {
  g = g.replace("  if (mapId === 'endless_1') {\n    contentMod.injectMap(endless.generateFloor(1));\n  }",
    "  if (mapId === 'endless_1') {\n    contentMod.injectMap(endless.generateFloor(1));\n    state.endlessDepth = 1;\n  }");
}

fs.writeFileSync('server/routes/game.js', g);
n++;
console.log('game route endless wired');

// ---- 4. companion growth in engine startGame ----
let e = fs.readFileSync('server/game/engine.js', 'utf8');
const a6 = "  if (options.bringAlly) {\n    let allyId = typeof options.bringAlly === 'string' ? options.bringAlly : 'bram';\n    if (allyId === 'true') allyId = 'bram';\n    const a = ALLIES.find(x => x.id === allyId) || ALLY_DEF;\n    state.entities.push({\n      id: 'ally', kind: 'ally', allyId: a.id, role: a.role || 'Companion',\n      icon: a.icon || '🏹', name: a.name, x: mapDef.playerStart.x + 1, y: mapDef.playerStart.y,\n      hp: a.hp, hpMax: a.hp, ac: a.ac, speedFt: a.speed, abilities: a.abilities,\n      attacks: a.attacks, spells: a.spells || [], spellSlots: (a.spells && a.spells.length) ? 3 : 0,\n      darkvision: a.darkvision, conditions: [], buffs: [], alive: true\n    });\n    state.flags.ally = true;\n    state.flags.allyId = a.id;\n  }";
const b6 = `  if (options.bringAlly) {
    let allyId = typeof options.bringAlly === 'string' ? options.bringAlly : 'bram';
    if (allyId === 'true') allyId = 'bram';
    const a = ALLIES.find(x => x.id === allyId) || ALLY_DEF;
    const heroLvl = p.level || 1;
    const lvlBonusHp = (heroLvl - 1) * 3;
    const lvlBonusAtk = Math.floor((heroLvl - 1) / 2);
    const scaledAttacks = (a.attacks || []).map(atk => ({ ...atk, bonus: (atk.bonus || 3) + lvlBonusAtk }));
    state.entities.push({
      id: 'ally', kind: 'ally', allyId: a.id, role: a.role || 'Companion',
      icon: a.icon || '🏹', name: a.name, x: mapDef.playerStart.x + 1, y: mapDef.playerStart.y,
      hp: a.hp + lvlBonusHp, hpMax: a.hp + lvlBonusHp, ac: a.ac, speedFt: a.speed, abilities: a.abilities,
      attacks: scaledAttacks, spells: a.spells || [],
      spellSlots: (a.spells && a.spells.length) ? 1 + Math.floor(heroLvl / 3) : 0,
      darkvision: a.darkvision, conditions: [], buffs: [], alive: true
    });
    state.flags.ally = true;
    state.flags.allyId = a.id;
  }`;
if (!e.includes(a6)) { console.log('MISS engine ally'); process.exit(1); }
e = e.replace(a6, b6);
fs.writeFileSync('server/game/engine.js', e);
n++;
console.log('companion growth added');

console.log('done', n);
