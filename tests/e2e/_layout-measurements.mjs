import fs from 'node:fs';
import path from 'node:path';
import { captureBrowserArtifacts } from './_browser-runtime.mjs';

// Same spawn, following camera, idle scene; frame intervals are observations,
// never an FPS gate on software WebGL.
export async function measureLayout(send, port, phase) {
  const rows = [];
  for (const [width, height] of [[1440, 900], [1280, 800], [390, 844], [844, 390]]) {
    await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 900 });
    for (const locale of ['en', 'zh-CN']) {
      const result = await send('Runtime.evaluate', {
        expression: `(async () => {
          const { setLocale } = await import('/js/i18n.js'); setLocale('${locale}');
          await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
          const samples = []; let last;
          for (let i = 0; i < 21; i++) await new Promise(r => requestAnimationFrame(now => {
            if (last != null) samples.push(now - last); last = now; r();
          }));
          const rect = id => { const r = document.getElementById(id)?.getBoundingClientRect(); return r && { x:r.x, y:r.y, width:r.width, height:r.height }; };
          return { width:innerWidth, height:innerHeight, locale:document.documentElement.lang,
            map:rect('mapWrap'), viewport:rect('map3d'), camera:window.__dndDebug.camera(),
            canvasCount:document.querySelectorAll('#map3d canvas').length,
            frameSamples:samples.length, frameMeanMs:samples.reduce((a,b)=>a+b,0)/samples.length,
            frameP95Ms:samples.sort((a,b)=>a-b)[Math.floor(samples.length*.95)] };
        })()`, awaitPromise: true, returnByValue: true
      });
      if (result.exceptionDetails || !result.result.value?.map) throw new Error('Layout measurement failed');
      rows.push(result.result.value);
      await captureBrowserArtifacts(`t10-${phase}-${width}x${height}-${locale}`, [port]);
      const shot = path.join(process.env.VERIFY_ARTIFACT_DIR, 'screenshots', `t10-${phase}-${width}x${height}-${locale}-${port}-0.png`);
      if (!fs.existsSync(shot) || fs.statSync(shot).size < 1000) throw new Error('Required layout screenshot missing: ' + shot);
    }
  }
  if (process.env.VERIFY_ARTIFACT_DIR) fs.writeFileSync(path.join(process.env.VERIFY_ARTIFACT_DIR, `t10-${phase}-measurements.json`), JSON.stringify(rows, null, 2));
  await send('Emulation.setDeviceMetricsOverride', { width:1280, height:800, deviceScaleFactor:1, mobile:false });
  await send('Runtime.evaluate', { expression:"import('/js/i18n.js').then(m => m.setLocale('en'))", awaitPromise:true });
  return rows;
}
