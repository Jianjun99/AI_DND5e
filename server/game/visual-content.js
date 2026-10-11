// Finite, embedded GLB contract. No URLs, scripts, extensions or mechanical writes.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');
const checks = require('./content-validation');
const LIMITS = Object.freeze({ models:16, fileBytes:2*1024*1024, totalBytes:8*1024*1024, nodes:128, vertices:50000, indices:150000, joints:64, clips:16, keys:10000, textureSide:1024, texturePixels:4*1024*1024 });
const ACTIONS = ['idle','walk','attack','hit','death','cast'];
const assetPath = value => typeof value==='string' && /^assets\/[a-z0-9_-]+\.glb$/.test(value);
function need(value, message) { if (!value) throw new Error(message); }
function finite(value) { return typeof value==='number' && Number.isFinite(value); }
function fields(value, allowed) { need(checks.object(value) && Object.keys(value).every(k=>allowed.includes(k)), 'Unsupported fields.'); }
function inspectGLB(bytes) {
  need(Buffer.isBuffer(bytes) && bytes.length<=LIMITS.fileBytes && bytes.length>=28,'GLB file budget/header.');
  need(bytes.readUInt32LE(0)===0x46546c67 && bytes.readUInt32LE(4)===2 && bytes.readUInt32LE(8)===bytes.length,'Expected complete GLB 2.');
  const jsonSize=bytes.readUInt32LE(12);
  need(jsonSize%4===0 && jsonSize<=256*1024 && 20+jsonSize+8<=bytes.length && bytes.readUInt32LE(16)===0x4e4f534a,'GLB JSON chunk.');
  const binStart=20+jsonSize, binSize=bytes.readUInt32LE(binStart);
  need(binSize%4===0 && bytes.readUInt32LE(binStart+4)===0x004e4942 && binStart+8+binSize===bytes.length,'Exactly one embedded BIN chunk required.');
  const doc=JSON.parse(bytes.subarray(20,20+jsonSize).toString('utf8')),bin=bytes.subarray(binStart+8);
  const walk=value=>{if(typeof value==='number')need(finite(value),'Non-finite number.');if(value && typeof value==='object'){need(!('uri' in value)&&!('extensions' in value),'External/data URIs and extensions are unsupported.');Object.values(value).forEach(walk);}};
  walk(doc);
  need(doc.asset?.version==='2.0' && !(doc.extensionsUsed?.length) && !(doc.extensionsRequired?.length),'glTF 2 without extensions required.');
  need(doc.buffers?.length===1 && Number.isInteger(doc.buffers[0].byteLength) && doc.buffers[0].byteLength<=bin.length && doc.buffers[0].byteLength>=bin.length-3,'Embedded buffer length.');
  const arrays=['bufferViews','accessors','nodes','meshes','skins','animations','materials','textures','images','scenes','samplers'];
  for(const key of arrays){need(doc[key]===undefined || Array.isArray(doc[key]),key+' must be an array.');doc[key] ??= [];need(doc[key].length<=512,key+' budget.');}
  const ref=(items,id)=>Number.isInteger(id)&&id>=0&&id<items.length;
  need(doc.nodes.length>0 && doc.nodes.length<=LIMITS.nodes && doc.animations.length<=LIMITS.clips,'Node/clip budget.');
  for(const view of doc.bufferViews) need(view.buffer===0 && Number.isInteger(view.byteLength)&&view.byteLength>0 && Number.isInteger(view.byteOffset??0)&&(view.byteOffset??0)>=0&&(view.byteOffset??0)+view.byteLength<=doc.buffers[0].byteLength && (view.byteStride===undefined || (Number.isInteger(view.byteStride)&&view.byteStride>=4&&view.byteStride<=252&&view.byteStride%4===0)),'Buffer view bounds/stride.');
  const component={5120:1,5121:1,5122:2,5123:2,5125:4,5126:4},sizes={SCALAR:1,VEC2:2,VEC3:3,VEC4:4,MAT4:16};
  let keys=0;
  for(const a of doc.accessors){
    need(!a.sparse && ref(doc.bufferViews,a.bufferView) && component[a.componentType] && sizes[a.type] && Number.isInteger(a.count)&&a.count>0&&a.count<=LIMITS.indices,'Accessor format/count.');
    const view=doc.bufferViews[a.bufferView],unit=component[a.componentType],width=unit*sizes[a.type],stride=view.byteStride||width,offset=a.byteOffset??0;
    need(Number.isInteger(offset)&&offset>=0&&offset%unit===0&&stride>=width&&offset+(a.count-1)*stride+width<=view.byteLength,'Accessor bounds/alignment.');
    if(a.componentType===5126)for(let i=0;i<a.count;i++)for(let j=0;j<sizes[a.type];j++){const n=bin.readFloatLE((view.byteOffset||0)+offset+i*stride+j*unit);need(finite(n)&&Math.abs(n)<=1e6,'Float data budget.');}
  }
  let vertices=0,indices=0;
  for(const mesh of doc.meshes){need(Array.isArray(mesh.primitives)&&mesh.primitives.length<=16 && !mesh.weights,'Mesh budget; morphs unsupported.');for(const p of mesh.primitives){
    need(!p.targets && (p.mode===undefined||p.mode===4)&&checks.object(p.attributes)&&ref(doc.accessors,p.attributes.POSITION),'Triangle primitives with POSITION required.');
    need(Object.entries(p.attributes).every(([name,id])=>['POSITION','NORMAL','TEXCOORD_0','JOINTS_0','WEIGHTS_0'].includes(name)&&ref(doc.accessors,id)),'Unsupported vertex attributes.');
    const pos=doc.accessors[p.attributes.POSITION];need(pos.type==='VEC3'&&pos.componentType===5126,'POSITION must be float VEC3.');vertices+=pos.count;
    if(p.indices!==undefined){need(ref(doc.accessors,p.indices),'Index reference.');const a=doc.accessors[p.indices];need(a.type==='SCALAR'&&[5121,5123,5125].includes(a.componentType),'Index type.');indices+=a.count;const view=doc.bufferViews[a.bufferView],unit=component[a.componentType],stride=view.byteStride||unit;for(let i=0;i<a.count;i++){const offset=(view.byteOffset||0)+(a.byteOffset||0)+i*stride;need(bin.readUIntLE(offset,unit)<pos.count,'Index outside vertex range.');}}
    if(p.material!==undefined)need(ref(doc.materials,p.material),'Material reference.');
  }}
  need(vertices>0&&vertices<=LIMITS.vertices&&indices<=LIMITS.indices,'Geometry budget.');
  const parents=new Set(),visiting=new Set(),visited=new Set();
  const visit=id=>{need(ref(doc.nodes,id),'Node reference.');need(!visiting.has(id),'Node cycle.');if(visited.has(id))return;visiting.add(id);const node=doc.nodes[id];need(!node.camera&&!node.weights,'Cameras/morphs unsupported.');for(const key of ['translation','rotation','scale','matrix'])if(node[key]!==undefined)need(Array.isArray(node[key])&&node[key].length===({translation:3,rotation:4,scale:3,matrix:16})[key]&&node[key].every(finite),'Node transform.');if(node.mesh!==undefined)need(ref(doc.meshes,node.mesh),'Mesh reference.');if(node.skin!==undefined)need(ref(doc.skins,node.skin)&&node.mesh!==undefined,'Skin reference.');need(node.children===undefined||Array.isArray(node.children),'Node children.');for(const child of node.children||[]){need(!parents.has(child),'Node has multiple parents.');parents.add(child);visit(child);}visiting.delete(id);visited.add(id);};
  for(let id=0;id<doc.nodes.length;id++)if(!visited.has(id))visit(id);
  need(ref(doc.scenes,doc.scene??0),'Default scene required.');for(const scene of doc.scenes)need(Array.isArray(scene.nodes)&&scene.nodes.every(id=>ref(doc.nodes,id)&&!parents.has(id)),'Scene roots.');
  for(const skin of doc.skins){need(Array.isArray(skin.joints)&&skin.joints.length>0&&skin.joints.length<=LIMITS.joints&&new Set(skin.joints).size===skin.joints.length&&skin.joints.every(id=>ref(doc.nodes,id)),'Joint budget/reference.');if(skin.inverseBindMatrices!==undefined){need(ref(doc.accessors,skin.inverseBindMatrices),'Bind reference.');const a=doc.accessors[skin.inverseBindMatrices];need(a.type==='MAT4'&&a.componentType===5126&&a.count===skin.joints.length,'Bind matrices.');}}
  for(const node of doc.nodes)if(node.skin!==undefined)for(const p of doc.meshes[node.mesh].primitives){
    const joints=doc.accessors[p.attributes.JOINTS_0],weights=doc.accessors[p.attributes.WEIGHTS_0],position=doc.accessors[p.attributes.POSITION];
    need(joints?.type==='VEC4'&&[5121,5123].includes(joints.componentType)&&weights?.type==='VEC4'&&weights.componentType===5126&&joints.count===position.count&&weights.count===position.count,'Skinned attributes require JOINTS_0 and float WEIGHTS_0.');
    const view=doc.bufferViews[joints.bufferView],unit=component[joints.componentType];for(let i=0;i<joints.count;i++)for(let j=0;j<4;j++)need(bin.readUIntLE((view.byteOffset||0)+(joints.byteOffset||0)+i*(view.byteStride||4*unit)+j*unit,unit)<doc.skins[node.skin].joints.length,'Joint index outside skeleton.');
  }
  const names=new Set();
  for(const clip of doc.animations){need(typeof clip.name==='string'&&clip.name.length>0&&clip.name.length<=80&&!names.has(clip.name),'Unique named animation clips required.');names.add(clip.name);need(Array.isArray(clip.channels)&&clip.channels.length<=128&&Array.isArray(clip.samplers),'Animation channels.');for(const s of clip.samplers){need(ref(doc.accessors,s.input)&&ref(doc.accessors,s.output)&&[undefined,'LINEAR','STEP'].includes(s.interpolation),'Animation sampler (LINEAR/STEP only).');const a=doc.accessors[s.input];need(a.type==='SCALAR'&&a.componentType===5126,'Animation time accessor.');keys+=a.count;const v=doc.bufferViews[a.bufferView];let last=-1;for(let i=0;i<a.count;i++){const time=bin.readFloatLE((v.byteOffset||0)+(a.byteOffset||0)+i*(v.byteStride||4));need(time>=0&&time>last&&time<=30,'Clip times must increase within 30 seconds.');last=time;}}
    for(const c of clip.channels){need(ref(clip.samplers,c.sampler)&&ref(doc.nodes,c.target?.node)&&['translation','rotation','scale'].includes(c.target.path),'Animation target.');const s=clip.samplers[c.sampler],a=doc.accessors[s.input],b=doc.accessors[s.output];need(b.componentType===5126&&b.count===a.count&&b.type===(c.target.path==='rotation'?'VEC4':'VEC3'),'Animation output.');}
  }
  need(keys<=LIMITS.keys,'Animation key budget.');
  let pixels=0;
  for(const image of doc.images){need(image.mimeType==='image/png'&&ref(doc.bufferViews,image.bufferView),'Embedded PNG texture required.');const v=doc.bufferViews[image.bufferView],b=bin.subarray(v.byteOffset||0,(v.byteOffset||0)+v.byteLength);need(b.length>=33&&b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))&&b.toString('ascii',12,16)==='IHDR','PNG header.');const w=b.readUInt32BE(16),h=b.readUInt32BE(20);need(w>0&&h>0&&w<=LIMITS.textureSide&&h<=LIMITS.textureSide,'Texture dimensions.');pixels+=w*h;need(b[24]===8&&[2,6].includes(b[25])&&b[26]===0&&b[27]===0&&b[28]===0,'8-bit RGB/RGBA non-interlaced PNG required.');
    const parts=[];let offset=8,ended=false;while(offset+12<=b.length){const size=b.readUInt32BE(offset),type=b.toString('ascii',offset+4,offset+8);need(offset+12+size<=b.length,'PNG chunk bounds.');let crc=0xffffffff;for(const byte of b.subarray(offset+4,offset+8+size)){crc^=byte;for(let bit=0;bit<8;bit++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}need(((crc^0xffffffff)>>>0)===b.readUInt32BE(offset+8+size),'PNG chunk CRC.');if(type==='IDAT')parts.push(b.subarray(offset+8,offset+8+size));if(type==='IEND'){ended=true;need(size===0&&offset+12===b.length,'PNG end.');break;}offset+=12+size;}
    const row=w*(b[25]===6?4:3)+1,expected=row*h;need(ended&&parts.length>0,'Complete PNG required.');const pixelsBytes=zlib.inflateSync(Buffer.concat(parts),{maxOutputLength:expected});need(pixelsBytes.length===expected,'PNG pixel length.');for(let y=0;y<h;y++)need(pixelsBytes[y*row]<=4,'PNG row filter.');
  }
  need(pixels<=LIMITS.texturePixels,'Texture pixel budget.');
  for(const texture of doc.textures)need(ref(doc.images,texture.source)&&(texture.sampler===undefined||ref(doc.samplers,texture.sampler)),'Texture reference.');
  for(const material of doc.materials){const scan=value=>{if(!value||typeof value!=='object')return;for(const [k,v] of Object.entries(value)){if(k.endsWith('Texture'))need(ref(doc.textures,v?.index),'Material texture reference.');scan(v);}};scan(material);}
  return { clips:[...names], vertices,indices,pixels,digest:crypto.createHash('sha256').update(bytes).digest('hex') };
}
function validateVisuals(visuals, readAsset, src, diagnostics) {
  if(visuals===undefined)return null;
  try {
    fields(visuals,['version','models','bindings']);need(visuals.version===1&&Array.isArray(visuals.models)&&visuals.models.length>0&&visuals.models.length<=LIMITS.models,'Visual manifest version/models.');
    const ids=new Set(),files=new Map(),models=[];let total=0;
    for(const m of visuals.models){fields(m,['id','name','role','file','scale','yaw','clips']);need(checks.validId(m.id)&&!ids.has(m.id)&&typeof m.name==='string'&&m.name.length>0&&m.name.length<=80&&['hero','monster'].includes(m.role)&&assetPath(m.file),'Model ID/name/role/path.');ids.add(m.id);need(finite(m.scale)&&m.scale>=.05&&m.scale<=4&&finite(m.yaw)&&Math.abs(m.yaw)<=180,'Model scale/yaw.');fields(m.clips,ACTIONS);need(typeof m.clips.idle==='string','idle mapping required.');
      if(!files.has(m.file)){const bytes=readAsset(m.file);total+=bytes.length;need(total<=LIMITS.totalBytes,'Pack binary budget.');files.set(m.file,{bytes,...inspectGLB(bytes)});}
      const info=files.get(m.file);for(const [action,name] of Object.entries(m.clips))need(typeof name==='string'&&info.clips.includes(name),'Mapped clip does not exist: '+m.id+'.clips.'+action+' = '+name);models.push({...m,digest:info.digest});
    }
    fields(visuals.bindings||{},['monsters']);const bindings=visuals.bindings?.monsters||{};need(checks.object(bindings)&&Object.keys(bindings).length<=128,'Monster binding budget.');for(const [id,modelId] of Object.entries(bindings))need(checks.validId(id)&&models.some(m=>m.id===modelId&&m.role==='monster'),'Monster binding/model reference.');
    return { models, files,bindings };
  } catch(error){checks.diagnostic(diagnostics,src,'visuals',error.message,'invalid-visual');return null;}
}
function readDeclaredAsset(dir,file) {
  need(assetPath(file),'Undeclared/invalid asset path.');
  const resolved=path.resolve(dir,file),root=fs.realpathSync(dir),actual=fs.realpathSync(resolved),relative=path.relative(root,actual);
  need(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative),'Asset escapes pack.');need(fs.statSync(actual).isFile()&&fs.statSync(actual).size<=LIMITS.fileBytes,'Asset file budget.');return fs.readFileSync(actual);
}
function bundleReader(assets) {
  need(checks.object(assets),'assets object required.');return file=>{const text=assets[file];need(typeof text==='string'&&text.length<=Math.ceil(LIMITS.fileBytes/3)*4&&/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(text),'Canonical base64 asset required.');const bytes=Buffer.from(text,'base64');need(bytes.toString('base64')===text,'Canonical base64 asset required.');return bytes;};
}
module.exports={LIMITS,ACTIONS,assetPath,inspectGLB,validateVisuals,readDeclaredAsset,bundleReader};
