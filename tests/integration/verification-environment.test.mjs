// Exercise failure gates with a real Chromium. Expected failures must produce
// a nonzero child exit / thrown WebGL error and a retained, readable screenshot.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { browserBinary, softwareWebGLFlags, requireWebGL, captureBrowserArtifacts } from '../e2e/_browser-runtime.mjs';
import { assertTestContainer } from '../../scripts/test-container.mjs';

assertTestContainer();
let passed = 0;
let failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('  ✔ PASS: ' + name); }
  catch (error) { failed++; console.error('  ❌ FAILED: ' + name, error); }
}

await test('test environment has no external network interface or player data directory', () => {
  assert.deepEqual(Object.keys(os.networkInterfaces()), ['lo']);
  assert.equal(fs.existsSync('/app/data'), false);
  assert.equal(process.env.DATA_DIR, '/tmp/ai-dnd-test-data');
});

await test('browser home and XDG directories are writable for the actual container UID', () => {
  assert.equal(process.env.HOME, '/tmp/ai-dnd-test-home');
  assert.equal(process.env.XDG_CONFIG_HOME, path.join(process.env.HOME, '.config'));
  assert.equal(process.env.XDG_CACHE_HOME, path.join(process.env.HOME, '.cache'));
  for (const directory of [process.env.HOME, process.env.XDG_CONFIG_HOME, process.env.XDG_CACHE_HOME]) {
    const probe = path.join(directory, 'verify-home-probe-' + process.pid);
    try {
      fs.writeFileSync(probe, 'writable', { flag: 'wx' });
      assert.equal(fs.readFileSync(probe, 'utf8'), 'writable');
    } finally {
      fs.rmSync(probe, { force: true });
    }
  }
});

await test('missing browser exits nonzero before contacting any game server', () => {
  const child = spawnSync(process.execPath, ['tests/e2e/browser-movement-cdp.test.mjs'], {
    env: { ...process.env, CHROMIUM_PATH: '/no-such-test-browser', BASE_URL: 'http://127.0.0.1:1' }, encoding: 'utf8', timeout: 5000
  });
  assert.equal(child.status, 1);
  assert.match(child.stderr, /Required Chromium.*missing/);
});

await test('full suite cannot bypass the dedicated-container gate', () => {
  const child = spawnSync(process.execPath, ['scripts/test-all.mjs'], {
    env: { ...process.env, AI_DND_TEST_CONTAINER: '0' }, encoding: 'utf8', timeout: 5000
  });
  assert.equal(child.status, 1);
  assert.match(child.stderr, /requires the dedicated Docker test container/);
});

await test('a second verify inside the current container is refused with exit 73', () => {
  const child = spawnSync(process.execPath, ['scripts/verify.mjs'], {
    env: { ...process.env }, encoding: 'utf8', timeout: 5000
  });
  assert.equal(child.status, 73);
  assert.match(child.stderr, /already running in this test container/);
});

await test('disabled WebGL fails on a real browser and retains PNG + page diagnostics', async () => {
  const port = 9230;
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-dnd-webgl-negative-'));
  const browser = spawn(browserBinary(), [
    '--headless=new', '--no-sandbox', '--no-first-run', ...softwareWebGLFlags(),
    '--disable-webgl', '--disable-webgl2', '--remote-debugging-port=' + port,
    '--user-data-dir=' + profile, 'about:blank'
  ], { detached: true, stdio: ['ignore', 'ignore', 'pipe'] });
  let browserStderr = '';
  browser.stderr.on('data', data => { browserStderr = (browserStderr + data).slice(-4000); });
  let ws;
  let launchError;
  browser.on('error', error => { launchError = error; });
  try {
    let page;
    for (let attempt = 0; attempt < 50 && !page; attempt++) {
      if (launchError) throw launchError;
      try {
        const response = await fetch('http://127.0.0.1:' + port + '/json', { signal: AbortSignal.timeout(1000) });
        page = (await response.json()).find(target => target.type === 'page');
      } catch {}
      if (!page) await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.ok(page, 'Chromium must launch for the negative WebGL probe; stderr: ' + browserStderr);
    ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('CDP open timed out')), 5000);
      ws.onopen = () => { clearTimeout(timer); resolve(); };
      ws.onerror = () => { clearTimeout(timer); reject(new Error('CDP open failed')); };
    });
    const send = (method, params) => new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('CDP command timed out')), 5000);
      ws.onmessage = event => {
        const response = JSON.parse(event.data);
        if (response.id !== 1) return;
        clearTimeout(timer);
        if (response.error) reject(new Error(response.error.message)); else resolve(response.result);
      };
      ws.send(JSON.stringify({ id: 1, method, params }));
    });
    await assert.rejects(requireWebGL(send), /Required WebGL2 rendering FAILED/);
    await captureBrowserArtifacts('expected-webgl-failure', [port]);
    const png = fs.readFileSync(path.join(process.env.VERIFY_ARTIFACT_DIR, 'screenshots', 'expected-webgl-failure-9230-0.png'));
    assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    const diagnostics = JSON.parse(fs.readFileSync(path.join(process.env.VERIFY_ARTIFACT_DIR, 'screenshots', 'expected-webgl-failure-diagnostics.json'), 'utf8'));
    assert.ok(diagnostics[0].screenshot);
  } finally {
    if (ws) ws.close();
    try { process.kill(-browser.pid, 'SIGKILL'); } catch {}
    await new Promise(resolve => { if (browser.exitCode !== null || browser.signalCode !== null) resolve(); else browser.once('close', resolve); });
    fs.rmSync(profile, { recursive: true, force: true });
  }
});

console.log('Verification environment: ' + passed + ' passed, ' + failed + ' failed.');
process.exitCode = failed ? 1 : 0;
