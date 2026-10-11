import { api } from '../api.js';
import { esc,toast } from '../app.js';
import { label,t,contentLabel,contentText,translateDOM,onLocaleChange,localizeText } from '../i18n.js';
import { createMap3D } from '../map3d.js';
import { createPackVisual,packVisualResources } from '../visual-packs.js';

/** @param {import('../navigation.js').Navigation} navigation */
export async function visualsView(main,navigation){
  let [catalog,content,heroes]=await Promise.all([api.visuals(),api.content(),api.listCharacters()]);
  if(!navigation.isCurrent())return undefined;
  let renderer=null,selectedId=catalog.models[0]?.id,preview=null,serial=0,busy=false;
  main.innerHTML=`<div class="visual-heading"><div><h2>${label('visual.title')}</h2><p class="muted">${label('visual.help')}</p></div><a class="btn" href="#/">${label('visual.back')}</a></div>
    <div class="visual-workspace"><section class="card visual-library"><h3>${label('visual.library')}</h3><div id="visualPacks"></div><div id="visualModels"></div><button class="btn" id="visualImport">${label('ui.home.import_pack')}</button><input type="file" id="visualFile" accept=".json,application/json" hidden><p class="small muted">${label('visual.importHelp')}</p><div id="visualDiagnostics" class="visual-diagnostics" role="alert" hidden><b>${label('visual.diagnostics')}</b><pre></pre></div></section>
    <section class="card visual-preview"><h3>${label('visual.preview')}</h3><div id="visualCanvas"></div><p class="small muted" id="visualStatus"></p><div class="visual-actions">${['idle','walk','attack','hit','death','cast'].map(action=>`<button class="btn small" data-visual-action="${action}">${label('visual.'+action)}</button>`).join('')}</div><p class="small muted">${label('visual.previewHelp')}</p></section>
    <section class="card visual-bindings"><h3>${label('visual.bindings')}</h3><label for="visualHero">${label('visual.hero')}</label><select id="visualHero">${heroes.map(c=>`<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('')}</select><select id="visualHeroModel"></select><button class="btn primary" id="visualApplyHero">${label('visual.applyHero')}</button><hr><label for="visualMonster">${label('visual.monster')}</label><select id="visualMonster">${catalog.monsters.map(m=>`<option value="${esc(m.id)}">${esc(contentText(m,'name'))}</option>`).join('')}</select><select id="visualMonsterModel"></select><button class="btn primary" id="visualApplyMonster">${label('visual.applyMonster')}</button><p class="small muted">${label('visual.bindingHelp')}</p></section></div>`;
  const $=id=>/** @type {HTMLElement} */(main.querySelector('#'+id)),select=id=>/** @type {HTMLSelectElement} */($(id));
  function updateChoices(){for(const [role,target,model] of [['hero','visualHero','visualHeroModel'],['monster','visualMonster','visualMonsterModel']]){
    const id=select(target).value,prefs=role==='hero'?catalog.prefs.heroes:catalog.prefs.monsters;
    const chosen=Object.hasOwn(prefs,id)?prefs[id]:(role==='monster'?catalog.bindings[id]:null);
    select(model).innerHTML=`<option value="">${esc(t('visual.default'))}</option>`+catalog.models.filter(m=>m.role===role&&!m.disabled).map(m=>`<option value="${esc(m.id)}">${esc(m.name)} · ${esc(m.packName)}</option>`).join('');select(model).value=chosen||'';
  }/** @type {HTMLButtonElement} */($('visualApplyHero')).disabled=!heroes.length;}
  function showPreview(){
    renderer?.dispose();renderer=null;const model=catalog.models.find(m=>m.id===selectedId),monster=model?.role==='monster';
    const entities=[{id:'preview-1',kind:monster?'monster':'player',monsterId:'skeleton',hp:20,hpMax:20,alive:true,x:2,y:2,name:model?.name||'Preview'},...(monster?[{id:'preview-2',kind:'monster',monsterId:'skeleton',hp:12,hpMax:20,alive:true,x:4,y:2,name:model.name}]:[])];
    preview={id:'visual-preview',mapId:'visual-preview',map:{id:'visual-preview',width:7,height:5,rows:['#######','#.....#','#.....#','#.....#','#######'],theme:'hills'},entities,objects:[],visible:[],discovered:[]};for(let y=0;y<5;y++)for(let x=0;x<7;x++){preview.visible.push(x+','+y);preview.discovered.push(x+','+y);}
    renderer=createMap3D($('visualCanvas'),{visualFactory:entity=>createPackVisual(entity,model&&!model.disabled?model:null),follow:false,initialZoom:1.35});renderer.render(preview);
  }
  async function mutate(run){if(busy)return;busy=true;$('visualDiagnostics').hidden=true;main.querySelectorAll('button').forEach(b=>b.disabled=true);try{await run();if(!navigation.isCurrent())return;[catalog,content]=await Promise.all([api.visuals(),api.content()]);if(!navigation.isCurrent())return;renderLibrary();updateChoices();showPreview();toast(()=>t('visual.saved'));}catch(error){if(navigation.isCurrent()){toast(()=>error.message);if(error.diagnostics?.length){$('visualDiagnostics').hidden=false;$('visualDiagnostics').querySelector('pre').textContent=error.diagnostics.map(d=>d.file+':'+d.field+' — '+d.message).join('\n');}}}finally{busy=false;if(navigation.isCurrent()){main.querySelectorAll('button').forEach(b=>b.disabled=false);updateChoices();}}}
  async function exportPack(id){const response=await fetch('/api/content/pack/'+encodeURIComponent(id)+'/export');if(!response.ok){const data=await response.json();throw new Error(data.error);}const url=URL.createObjectURL(await response.blob()),a=document.createElement('a');a.href=url;a.download=id+'.json';a.click();URL.revokeObjectURL(url);}
  function renderLibrary(){
    const packs=content.packs.filter(p=>p.hasVisuals);
    $('visualPacks').innerHTML=packs.map(p=>`<div class="visual-pack"><b>${contentLabel(p,'name')}</b><label><input type="checkbox" data-visual-enable="${esc(p.id)}" ${catalog.prefs.disabledPacks.includes(p.id)?'':'checked'}> ${label('visual.enabled')}</label><div><button class="btn small" data-visual-export="${esc(p.id)}">${label('ui.home.export')}</button>${p.installed?` <button class="btn small danger" data-visual-delete="${esc(p.id)}">${label('visual.delete')}</button>`:''}</div></div>`).join('');
    $('visualModels').innerHTML=catalog.models.map(m=>`<button class="btn visual-model ${selectedId===m.id?'active':''}" data-visual-model="${esc(m.id)}"><b>${esc(m.name)}</b><small>${label('visual.'+m.role)} · ${esc(m.packName)}</small></button>`).join('')||`<p>${label('visual.empty')}</p>`;
    main.querySelectorAll('[data-visual-model]').forEach(b=>b.addEventListener('click',()=>{selectedId=b.getAttribute('data-visual-model');renderLibrary();showPreview();}));
    main.querySelectorAll('[data-visual-enable]').forEach(b=>b.addEventListener('change',()=>mutate(()=>api.setVisual({type:'pack',packId:b.getAttribute('data-visual-enable'),enabled:/** @type {HTMLInputElement} */(b).checked}))));
    main.querySelectorAll('[data-visual-export]').forEach(b=>b.addEventListener('click',()=>exportPack(b.getAttribute('data-visual-export')).catch(error=>toast(()=>error.message))));
    main.querySelectorAll('[data-visual-delete]').forEach(b=>b.addEventListener('click',()=>{if(confirm(t('visual.deleteConfirm')))mutate(()=>api.deletePack(b.getAttribute('data-visual-delete')));}));
    translateDOM(main);
  }
  for(const target of ['visualHero','visualMonster'])select(target).addEventListener('change',updateChoices);
  for(const role of ['Hero','Monster'])$('visualApply'+role).addEventListener('click',()=>mutate(()=>api.setVisual({type:role.toLowerCase(),targetId:select('visual'+role).value,modelId:select('visual'+role+'Model').value||null})));
  $('visualImport').addEventListener('click',()=>$('visualFile').click());
  $('visualFile').addEventListener('change',()=>{const input=/** @type {HTMLInputElement} */($('visualFile')),file=input.files[0];if(file)mutate(async()=>{if(file.size>12*1024*1024)throw new Error(t('visual.tooLarge'));await api.importContent(JSON.parse(await file.text()));input.value='';});});
  main.querySelectorAll('[data-visual-action]').forEach(b=>b.addEventListener('click',()=>{const action=b.getAttribute('data-visual-action');if(action==='walk'){preview.entities[0].x=preview.entities[0].x===2?3:2;renderer.render(preview);}else renderer.playVisual('preview-1',action,'preview:'+ ++serial);}));
  const statusTimer=setInterval(()=>{if(renderer)localizeText($('visualStatus'),()=>{const state=renderer.visualState()[0];return t('visual.status.'+(state?.status||'default'));});},250);
  renderLibrary();updateChoices();showPreview();
  const stopLocale=onLocaleChange(()=>{translateDOM(main);const id=select('visualMonster').value;select('visualMonster').innerHTML=catalog.monsters.map(m=>`<option value="${esc(m.id)}">${esc(contentText(m,'name'))}</option>`).join('');select('visualMonster').value=id;for(const field of ['visualHeroModel','visualMonsterModel'])select(field).options[0].textContent=t('visual.default');});
  window.__visualPreview={states:()=>renderer?.visualState(),bounds:()=>renderer?.visualBounds(),resources:packVisualResources};
  return navigation.onDispose(()=>{clearInterval(statusTimer);stopLocale();renderer?.dispose();renderer=null;delete window.__visualPreview;});
}
