// Presentation only: keep canonical strings, ids and engine results unchanged.
const fs = require('fs');
const path = require('path');
const contentContext = require('./content-context');
const TEXT_FIELDS = new Set(['name','mapName','desc','blurb','objectiveText','recommended','role','persona','knowledge','canned','clues','traits','prompt','label','response','memory','offer','done','objective','tagline','title','epilogue','shortText','targetName','description','hint','text']);
const tables = Object.create(null);
for (const file of ['species','classes','backgrounds','equipment','spells','monsters']) {
  const data = JSON.parse(fs.readFileSync(path.join(__dirname,'../../shared',file+'.json'),'utf8'));
  for (const [kind, values] of Object.entries(data)) if (Array.isArray(values)) tables[kind] = values;
  if (file === 'backgrounds') tables.feats = Object.entries(data.feats || {}).map(([id,node]) => ({id,...node}));
}
function descriptor(node, field = 'name') {
  if(Array.isArray(node?.[field])&&node[field].every(v=>typeof v==='string')&&['en','zh-CN'].some(locale=>Array.isArray(node.localized?.[locale]?.[field]))) {
    return {parts:node[field].map((original,index)=>({localized:Object.fromEntries(['en','zh-CN'].filter(locale=>typeof node.localized?.[locale]?.[field]?.[index]==='string').map(locale=>[locale,node.localized[locale][field][index]])),fallback:original})),separator:' · ',fallback:node[field].join(' · ')};
  }
  if (!node || typeof node[field] !== 'string') return null;
  const localized = {};
  for (const locale of ['en','zh-CN']) if (typeof node.localized?.[locale]?.[field] === 'string') localized[locale] = node.localized[locale][field];
  return Object.keys(localized).length ? { localized, fallback:node[field] } : null;
}
function plain(value) { return value && typeof value === 'object' ? value.fallback ?? value.text ?? '' : String(value ?? ''); }
function definition(kind, id, snapshot = null) {
  if (kind === 'maps') return contentContext.mapFor(snapshot, id);
  if (kind === 'monsters') return contentContext.monsterFor(snapshot, id);
  if (kind === 'gear') return contentContext.gearFor(snapshot, id);
  return tables[kind]?.find(def => def.id === id) || null;
}
function textFor(node, field, locale = 'en') { return node?.localized?.[locale]?.[field] ?? node?.[field] ?? ''; }
function field(node, key) {
  if(key==='desc' && node?.itemId && typeof node.affix==='string' && !node.descDisplay) return attach(structuredClone(node)).descDisplay || node.desc || '';
  return node?.[key+'Display'] || descriptor(node,key) || node?.[key] || '';
}
function ref(kind,id) {
  const def = definition(kind,id) || tables[kind]?.find(row => row.name === id);
  const display=descriptor(def);
  return display ? {...display,fallback:id} : id;
}
function term(kind,value) { return {key:'content.'+kind+'.'+value,fallback:value}; }
function name(value, state) {
  if (!value || typeof value !== 'object') return value;
  if (value.kind === 'player' || value.className) return value.name;
  const snapshot = state?.contentSnapshot || null;
  let def = value;
  if (value.monsterId) {
    const placed=state?.map?.entities?.find(e=>e.id===value.id);
    def=placed?.localized ? placed : definition('monsters',value.monsterId,snapshot) || value;
  }
  else if (value.allyId) def = definition('allies',value.allyId,snapshot) || value;
  else if (value.itemId) def = definition('gear',value.itemId,snapshot) || definition('weapons',value.itemId,snapshot) || definition('armor',value.itemId,snapshot) || value;
  else if (value.weaponId) {
    const own=state?.character?.inventory?.find(i=>i.uniqueId===value.weaponId);
    if(own) {const display=name(own,state);return display&&typeof display==='object'?{...display,fallback:value.name}:display;}
    if(value.weaponId==='unarmed') return {key:'content.unarmed',fallback:value.name};
    def=definition('weapons',value.weaponId,snapshot) || value;
  }
  else if (state?.map) def = (state.map.entities || []).find(e => e.id === value.id || e.id === value.npcId) || value;
  const display = descriptor(def);
  const fallback = value.name || def.name || value.itemId;
  if (value.affix) {
    const affixes = require('./affixes');
    if (value.monsterId && value.affix.id) {
      return {key:'content.eliteName',params:{affix:field(affixes.MONSTER_AFFIXES[value.affix.id],'name'),base:display || def.name},fallback};
    }
    if (value.itemId && typeof value.affix === 'string') {
      const base = affixes.baseById(value.itemId), affix = affixes.affixById(value.affix,value.type);
      const set = affixes.ARMOR_SETS.find(s=>s.id===value.setId);
      if (base && affix) return {key:'content.itemName',params:{base:field(base,'name'),affix:{localized:{en:affix.english,'zh-CN':affix.prefix},fallback:affix.prefix},rarity:value.rarity==='legendary'?term('quality','legendary'):value.rarity==='rare'?term('quality','rare'):'',set:set?{localized:{en:set.english+' · ','zh-CN':set.prefix+'·'},fallback:set.prefix+'·'}:''},fallback};
    }
  }
  return display ? { ...display, fallback } : fallback;
}
// Quasis are the original source text, not a second rule table. Arguments are
// evaluated once. A descriptor is authored at the emission site, never inferred
// later from an old log's text.
function eventMessage(messageKey, values, parts) {
  const params = Object.fromEntries(values.map((value,i) => ['p'+(i+1),value]));
  const text = parts.reduce((result,part,i) => result + part + (i < values.length ? plain(values[i]) : ''),'');
  return { text, messageKey, params };
}
function attach(node, context = null) {
  if (!node || typeof node !== 'object') return node;
  if (Array.isArray(node)) { node.forEach(value=>attach(value,context)); return node; }
  if (node.character?.inventory) context=node;
  else if (node.className && Array.isArray(node.inventory)) context={character:node};
  if (node.weaponId && !node.nameDisplay) {
    const display=name(node,context);
    if (display && typeof display==='object') node.nameDisplay=display;
  }
  if (node.className) node.classNameDisplay = descriptor(definition('classes',node.className));
  if (node.species) node.speciesDisplay = descriptor(definition('species',node.species));
  if (node.background) node.backgroundDisplay = descriptor(definition('backgrounds',node.background));
  if (node.featNote && node.feat) node.featNoteDisplay=descriptor(definition('feats',node.feat),'desc');
  if (node.mapId && node.mapName) node.mapNameDisplay = descriptor(definition('maps',node.mapId));
  if (node.itemId || node.allyId || (node.monsterId && (!node.kind || node.nameDisplay))) {
    const display = name(node);
    if (display && typeof display === 'object' && !node.nameDisplay) node.nameDisplay = display;
  }
  if (node.monsterId && node.affix?.id && (!node.kind || node.nameDisplay)) {
    const def=require('./affixes').MONSTER_AFFIXES[node.affix.id];
    if (def) for(const key of ['name','desc']) node.affix[key+'Display']=descriptor(def,key);
  }
  if (node.itemId && typeof node.affix==='string') {
    const parts=[];
    for(const key of ['magic','acBonus','hpBonus','speedBonus','vampiricHeal']) if(node[key]) parts.push({key:'content.modifier',params:{value:node[key],kind:term('effect',key)}});
    if (node.bonusDamage) parts.push({key:'content.modifier',params:{value:node.bonusDamage.dice,kind:term('damage',node.bonusDamage.type)}});
    const set=require('./affixes').ARMOR_SETS.find(s=>s.id===node.setId);
    if (set) parts.push(field(set,'desc'));
    if (parts.length) node.descDisplay={parts,separator:' · ',fallback:node.desc};
  }
  if (node.kind==='mystery_potion') {
    const potions=require('./potions'),tier=potions.POTION_TIERS[node.tier],effect=potions.POTION_EFFECTS.find(e=>e.id===node.effect?.id);
    if(tier) node.nameDisplay={parts:[field(tier,'name'),...(node.identified&&effect?[' · ',field(effect,'name')]:[])],fallback:node.name};
    if(tier) {
      node.descDisplay=field(node.identified&&effect?effect:tier,node.identified&&effect?'desc':'blurb');
      node.cluesDisplay={parts:(node.clues || []).map((clue,index)=>({localized:{en:tier.localized?.en?.clues?.[index] || clue,'zh-CN':tier.localized?.['zh-CN']?.clues?.[index] || clue},fallback:clue})),separator:' · ',fallback:(node.clues || []).join(' · ')};
    }
    if(node.identified&&effect) {node.effect.nameDisplay=descriptor(effect);node.effect.descDisplay=descriptor(effect,'desc');}
    // Keep the legacy effect payload unchanged; do not add display metadata
    // for its undiscovered result. The bottle's visible description uses the tier.
  }
  if (node.kind==='delve_token') {
    const token=require('./potions').DELVE_TOKENS[node.tokenId];
    if(token) {node.nameDisplay=descriptor(token);node.descDisplay=descriptor(token,'desc');}
  }
  if (node.weaponId) {
    const display=name(node);
    if(display&&typeof display==='object')node.nameDisplay=display;
  }
  if (node.allyId && node.target && node.need) {
    const quest = require('./companions').PERSONAL_QUESTS[node.allyId];
    if (quest) for (const key of ['name','offer','done','targetName']) node[key+'Display']=descriptor(quest,key);
  }
  if (node.actName || node.currentActName) {
    const act = require('./campaign').ACTS.find(a=>a.id===(node.actId || node.currentActId) || a.act===node.act);
    if(act) {node.actNameDisplay=descriptor(act);node.currentActNameDisplay=descriptor(act);}
  }
  for (const field of TEXT_FIELDS) {
    const display = descriptor(node,field);
    if (display) node[field+'Display'] = display;
  }
  if (node.tools && node.id && tables.backgrounds?.some(b=>b.id===node.id)) node.toolsDisplay={key:'content.tool.'+node.id,fallback:node.tools};
  for (const [key,value] of Object.entries(node)) if (key !== 'localized' && !key.endsWith('Display')) attach(value,context);
  return node;
}
function middleware(req,res,next) {
  const json = res.json.bind(res);
  res.json = value => {
    // Export and draft endpoints preserve the author's exact canonical bundle/backup.
    if (req.originalUrl.startsWith('/api/data/') || /^\/api\/content\/pack\/[^/]+\/export/.test(req.originalUrl) || /^\/api\/content\/drafts/.test(req.originalUrl)) return json(value);
    // Match res.json's serialization of dates/undefined/functions. Some legacy
    // prize definitions contain engine callbacks which are never HTTP data.
    return value === undefined ? json(value) : json(attach(JSON.parse(JSON.stringify(value))));
  };
  next();
}
module.exports = { TEXT_FIELDS, descriptor, plain, definition, textFor, name, field, ref, term, eventMessage, attach, middleware };
