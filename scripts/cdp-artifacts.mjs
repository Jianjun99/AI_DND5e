import fs from 'node:fs';
import path from 'node:path';

// CPU-capped software WebGL can delay even Page.enable/DOM replies while drawing.
// Keep capture bounded and diagnostic, but allow the same scheduling as the suites.
function request(ws, id, method, params = {}, timeoutMs = 10000) {
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

export async function captureBrowserArtifacts(prefix, ports = [9224, 9225, 9226, 9227, 9228, 9229, 9231, 9232, 9233, 9234, 9235, 9236, 9237, 9238, 9239, 9240]) {
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
        // These connections only request snapshots; they never consume Page
        // notifications. No Page.enable subscription is needed for either read.
        // Software WebGL under the CPU cap can need several seconds to produce
        // its first surface. Give screenshot capture more time than a DOM probe.
        // PNG remains lossless. Avoid expensive compression on software-rendered
        // desktop captures, and read the DOM while the compositor produces it.
        const captureStarted = performance.now();
        const [shot, dom] = await Promise.all([
          request(ws, 2, 'Page.captureScreenshot', { format: 'png', captureBeyondViewport: false, optimizeForSpeed: true }, 20000),
          request(ws, 3, 'Runtime.evaluate', {
            expression: '({ url: location.href, html: document.documentElement.outerHTML })', returnByValue: true
          })
        ]);
        const captureMs = Math.round(performance.now() - captureStarted);
        fs.writeFileSync(file + '.png', Buffer.from(shot.data, 'base64'));
        fs.writeFileSync(file + '.json', JSON.stringify(dom, null, 2));
        diagnostics.push({ port, url: page.url, screenshot: file + '.png', captureMs });
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
