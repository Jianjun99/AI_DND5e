// Cosmetic preferences live outside characters/saves and never enter the engine.
const fs=require('fs');
const path=require('path');
const store=require('../store');
const file=path.join(store.DATA_DIR,'visual-settings.json');
const empty=()=>({version:1,disabledPacks:[],heroes:{},monsters:{}});
function read(){try{const value=JSON.parse(fs.readFileSync(file,'utf8'));return value.version===1&&Array.isArray(value.disabledPacks)&&value.heroes&&value.monsters?value:empty();}catch{return empty();}}
function write(value){const tmp=file+'.tmp';fs.writeFileSync(tmp,JSON.stringify(value,null,2));fs.renameSync(tmp,file);}
function catalog(reg) {
  const prefs=read(),models=[],bindings={};
  for(const pack of reg.packs) if(pack.visual) {
    for(const m of pack.visual.models) models.push({...m,packId:pack.id,packName:pack.name,disabled:prefs.disabledPacks.includes(pack.id),url:'/api/content/pack/'+encodeURIComponent(pack.id)+'/asset/'+encodeURIComponent(m.id)+'?digest='+m.digest});
    if(!prefs.disabledPacks.includes(pack.id))for(const [id,modelId] of Object.entries(pack.visual.bindings))if(!(id in bindings))bindings[id]=modelId;
  }
  return {version:1,models,bindings,prefs,monsters:Object.values(reg.monsters).map(m=>({id:m.id,name:m.name,localized:m.localized?Object.fromEntries(Object.entries(m.localized).map(([locale,text])=>[locale,{name:text.name}])):undefined}))};
}
function update(reg,body) {
  const available=catalog(reg),prefs=available.prefs;
  if(body.type==='pack'&&reg.packs.some(p=>p.id===body.packId&&p.visual)&&typeof body.enabled==='boolean') {
    prefs.disabledPacks=prefs.disabledPacks.filter(id=>id!==body.packId);if(!body.enabled)prefs.disabledPacks.push(body.packId);
  } else if(['hero','monster'].includes(body.type)&&typeof body.targetId==='string'&&(body.modelId===null||typeof body.modelId==='string')) {
    const target=body.type==='hero'?store.getCharacters().some(c=>c.id===body.targetId):!!reg.monsters[body.targetId];
    const model=body.modelId===null || available.models.some(m=>m.id===body.modelId&&m.role===body.type);
    if(!target||!model)throw new Error('Unknown visual target or incompatible model.');
    prefs[body.type==='hero'?'heroes':'monsters'][body.targetId]=body.modelId;
  } else throw new Error('Invalid cosmetic preference.');
  write(prefs);return catalog(reg);
}
module.exports={read,catalog,update};
