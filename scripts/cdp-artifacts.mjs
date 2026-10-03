import fs from 'node:fs';
import path from 'node:path';

function request(ws, id, method, params = {}, timeoutMs = 2500) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => finish(new Error('CDP artifact request timed out: ' + method)), timeoutMs);
    function finish(error, value) {
      clearTimeout(timer);
      ws.removeEventListener('message', onMessage);
      ws.removeEventListener('close', onClose);
      if (error) reject(error); else resolve(value);
    }
    function onMessage(event) {
      const message = JSON.parse(event.data);
      if (message.id === id) finish(message.error ? new Error(message.error.message) : null, message.result);
    }
    function onClose() { finish(new Error('Browser closed during artifact capture')); }
    ws.addEventListener('message', onMessage);
    ws.addEventListener('close', onClose);
    ws.send(JSON.stringify({ id, method, params }));
  });
}

export async function captureBrowserArtifacts(prefix, ports = [9224, 9225, 9226, 9227, 9228, 9229]) {
  const directory = process.env.VERIFY_ARTIFACT_DIR;
  if (!directory) return;
  const output = path.join(directory, 'screenshots');
  fs.mkdirSync(output, { recursive: true });
  const diagnostics = [];
  for (const port of ports) {
    let ws;
    try {
      const response = await fetch('http://127.0.0.1:' + port + '/json', { signal: AbortSignal.timeout(1000) });
      const pages = (await response.json()).filter(page => page.type === 'page');
      if (!pages.length) throw new Error('No page available for screenshot');
      for (const [index, page] of pages.entries()) {
        ws = new WebSocket(page.webSocketDebuggerUrl);
        await new Promise((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error('CDP connection timed out')), 2500);
          ws.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
          ws.addEventListener('error', () => { clearTimeout(timer); reject(new Error('CDP connection failed')); }, { once: true });
        });
        const file = path.join(output, prefix + '-' + port + '-' + index);
        await request(ws, 1, 'Page.enable');
        // Software WebGL under the CPU cap can need several seconds to produce
        // its first surface. Give screenshot capture more time than a DOM probe.
        const shot = await request(ws, 2, 'Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }, 8000);
        fs.writeFileSync(file + '.png', Buffer.from(shot.data, 'base64'));
        const dom = await request(ws, 3, 'Runtime.evaluate', {
          expression: '({ url: location.href, html: document.documentElement.outerHTML })', returnByValue: true
        });
        fs.writeFileSync(file + '.json', JSON.stringify(dom, null, 2));
        diagnostics.push({ port, url: page.url, screenshot: file + '.png' });
        ws.close();
      }
    } catch (error) {
      diagnostics.push({ port, error: error.message });
    } finally {
      if (ws) ws.close();
    }
  }
  fs.writeFileSync(path.join(output, prefix + '-diagnostics.json'), JSON.stringify(diagnostics, null, 2));
}
