import fs from 'node:fs';
export { captureBrowserArtifacts } from '../../scripts/cdp-artifacts.mjs';

export function browserBinary() {
  const paths = process.env.CHROMIUM_PATH ? [process.env.CHROMIUM_PATH] : [
    '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
  ];
  const binary = paths.find(candidate => fs.existsSync(candidate));
  if (!binary) throw new Error('Required Chromium/Chrome/Edge binary is missing. Browser tests FAILED; no skipping is allowed.');
  return binary;
}

export function softwareWebGLFlags() {
  return ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
}

export async function requireWebGL(send) {
  const result = await send('Runtime.evaluate', {
    expression: `(() => {
      const canvas = document.createElement('canvas');
      const gl = canvas.getContext('webgl2');
      if (!gl || gl.isContextLost()) return { ok: false, error: 'WebGL2 unavailable' };
      gl.clearColor(1, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT);
      const pixel = new Uint8Array(4);
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
      const ok = gl.getError() === gl.NO_ERROR && pixel[0] === 255 && pixel[3] === 255;
      const info = { ok, version: gl.getParameter(gl.VERSION), renderer: gl.getParameter(gl.RENDERER), pixel: Array.from(pixel) };
      gl.getExtension('WEBGL_lose_context')?.loseContext();
      return info;
    })()`, returnByValue: true
  });
  if (!result.result?.value?.ok) {
    throw new Error('Required WebGL2 rendering FAILED: ' + JSON.stringify(result));
  }
  console.log('  WebGL2 rendering verified: ' + JSON.stringify(result.result.value));
}
