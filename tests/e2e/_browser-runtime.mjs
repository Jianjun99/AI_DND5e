import fs from 'node:fs';
import { once } from 'node:events';
export { captureBrowserArtifacts } from '../../scripts/cdp-artifacts.mjs';

// Callers launch Chromium with detached:true, giving its children a private
// process group. Let Browser.close finish, then reap that group before deleting
// its unique profile; killing only the root can leave cache writers orphaned.
export async function closeBrowser(browser, ws, send, profile) {
  let exited, timer;
  if (browser && browser.exitCode === null && browser.signalCode === null) exited = once(browser, 'exit');
  if (ws?.readyState === 1 && exited) {
    // Chromium can exit before its close reply reaches the page connection.
    // Process exit is sufficient: do not wait out the caller's CDP timer after
    // shutdown. A reply alone still proceeds to the existing process wait.
    await Promise.race([send('Browser.close').catch(() => {}), exited]);
  }
  ws?.close();
  if (exited) {
    await Promise.race([exited, new Promise(resolve => { timer = setTimeout(resolve, 5000); })]);
    clearTimeout(timer);
  }
  if (browser?.pid && process.platform !== 'win32') {
    try { process.kill(-browser.pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
  } else if (browser && browser.exitCode === null && browser.signalCode === null) browser.kill('SIGKILL');
  if (exited) await exited;
  fs.rmSync(profile, { recursive:true, force:true, maxRetries:8, retryDelay:100 });
}

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
