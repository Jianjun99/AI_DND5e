// No browser is launched: prove shutdown ordering with an acknowledged process
// exit and an independently controlled CDP close reply.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { closeBrowser } from '../e2e/_browser-runtime.mjs';

const root = path.resolve(process.env.VERIFY_ARTIFACT_DIR || 'artifacts/v1b/cleanup-probe');
fs.mkdirSync(root, { recursive: true });
let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('  PASS: ' + name); }
  catch (error) { failed++; console.error('  FAIL: ' + name, error); }
}
const turn = () => new Promise(resolve => setImmediate(resolve));
function fixture() {
  const profile = fs.mkdtempSync(path.join(root, 'browser-cleanup-profile-'));
  assert.equal(path.dirname(profile), root, 'cleanup target stays in the named artifact directory');
  const browser = new EventEmitter();
  browser.exitCode = null; browser.signalCode = null;
  const exit = () => {
    if (browser.exitCode === null) { browser.exitCode = 0; browser.emit('exit', 0); }
  };
  const socket = { readyState: 1, closed: false, close() { this.closed = true; } };
  return { profile, browser, socket, exit };
}

await test('confirmed process exit cleans up before a missing Browser.close reply', async () => {
  const f = fixture();
  let acknowledge, completed = false;
  const reply = new Promise(resolve => { acknowledge = resolve; });
  const cleanup = closeBrowser(f.browser, f.socket, method => {
    assert.equal(method, 'Browser.close'); return reply;
  }, f.profile);
  cleanup.then(() => { completed = true; });
  try {
    f.exit(); await turn();
    assert.equal(completed, true, 'an exited process must not wait for a lost CDP reply');
    assert.equal(f.socket.closed, true);
    assert.equal(fs.existsSync(f.profile), false);
  } finally { acknowledge(); f.exit(); await cleanup; }
});

await test('a close reply alone still waits for the process before deleting its profile', async () => {
  const f = fixture();
  let completed = false;
  const cleanup = closeBrowser(f.browser, f.socket, () => Promise.resolve({}), f.profile);
  cleanup.then(() => { completed = true; });
  try {
    await turn();
    assert.equal(completed, false);
    assert.equal(fs.existsSync(f.profile), true);
    f.exit(); await cleanup;
    assert.equal(fs.existsSync(f.profile), false);
    assert.equal(f.socket.closed, true);
  } finally { f.exit(); await cleanup; }
});

console.log('Browser cleanup: ' + passed + ' passed, ' + failed + ' failed.');
process.exitCode = failed ? 1 : 0;
