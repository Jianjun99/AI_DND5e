// generic patch runner driven by a JSON manifest
const fs = require('fs');
const manifest = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
let n = 0;
for (const p of manifest.patches) {
  if (p.jsonWrite) {
    fs.mkdirSync(require('path').dirname(p.jsonWrite.path), { recursive: true });
    fs.writeFileSync(p.jsonWrite.path, JSON.stringify(p.jsonWrite.data, null, 2) + '\n');
    console.log('OK  ' + p.name);
    n++;
    continue;
  }
  if (p.jsonInsert) {
    const jf = p.jsonInsert.file2;
    const data = JSON.parse(fs.readFileSync(jf, 'utf8'));
    const list = data[p.jsonInsert.listPath];
    if (!list.some(x => x[p.jsonInsert.idKey] === p.jsonInsert.item[p.jsonInsert.idKey])) {
      list.push(p.jsonInsert.item);
      fs.writeFileSync(jf, JSON.stringify(data, null, 2) + '\n');
      console.log('OK  ' + p.name);
      n++;
    } else { console.log('SKIP (exists) ' + p.name); }
    continue;
  }
  if (p.jsonClassFeatures) {
    const cd = JSON.parse(fs.readFileSync(p.file, 'utf8'));
    Object.entries(p.jsonClassFeatures).forEach(([classId, feats]) => {
      const c = cd.classes.find(x => x.id === classId);
      feats.forEach(f => { if (!c.features.some(x => x.id === f.id)) { c.features.push(f); n++; } });
    });
    fs.writeFileSync(p.file, JSON.stringify(cd, null, 2) + '\n');
    console.log('OK  ' + p.name);
    n++;
    continue;
  }
  let s = fs.readFileSync(p.file, 'utf8');
  if (!s.includes(p.from)) { console.log('MISS: ' + p.name); continue; }
  s = s.split(p.from).join(p.to);
  fs.writeFileSync(p.file, s);
  console.log('OK  ' + p.name);
  n++;
}
console.log('done:', n, 'patches');
