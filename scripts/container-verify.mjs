import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { assertTestContainer } from './test-container.mjs';
import { captureBrowserArtifacts } from './cdp-artifacts.mjs';

assertTestContainer();
const directory = process.env.VERIFY_ARTIFACT_DIR;
fs.mkdirSync(directory, { recursive: true });
// A fresh writable container layer owns these files. No player data is mounted.
fs.mkdirSync(process.env.DATA_DIR, { recursive: true });
fs.writeFileSync(path.join(process.env.DATA_DIR, 'settings.json'), JSON.stringify({
  llm: { enabled: false, baseUrl: '', apiKey: '', model: '' },
  portraits: { enabled: false, sdUrl: '' }
}));
const seconds = Number(process.env.VERIFY_TIMEOUT_SECONDS || 900);
if (!Number.isFinite(seconds) || seconds <= 0) throw new Error('Invalid verification timeout');
const proc = spawn('npm', ['run', 'verify'], { stdio: ['ignore', 'pipe', 'pipe'], detached: true });
const logPath = path.join(directory, 'container.log');
const tee = data => { fs.appendFileSync(logPath, data); process.stdout.write(data); };
proc.stdout.on('data', tee);
proc.stderr.on('data', tee);
let stopping = false;
let forcedCode;
let killTimer;
async function stop(code, reason) {
  if (stopping || proc.exitCode !== null) return;
  stopping = true;
  forcedCode = code;
  tee(Buffer.from('\nVerification stopped: ' + reason + '\n'));
  try { await captureBrowserArtifacts(reason); } catch (error) { tee(Buffer.from(error.message + '\n')); }
  try { process.kill(-proc.pid, 'SIGTERM'); } catch {}
  killTimer = setTimeout(() => { try { process.kill(-proc.pid, 'SIGKILL'); } catch {} }, 3000);
}
const timer = setTimeout(() => { void stop(124, 'timeout'); }, seconds * 1000);
process.on('SIGTERM', () => { void stop(143, 'SIGTERM'); });
process.on('SIGINT', () => { void stop(130, 'SIGINT'); });
const exitCode = await new Promise(resolve => {
  proc.on('error', error => { tee(Buffer.from(error.message + '\n')); resolve(1); });
  // A detached e2e group can still hold npm's stdout pipe after npm exits.
  // On forced stop, do not wait for that pipe: exiting the container entrypoint
  // lets Docker terminate every remaining process in this isolated namespace.
  proc.on('exit', () => { if (forcedCode !== undefined) resolve(forcedCode); });
  proc.on('close', (code, signal) => resolve(forcedCode ?? code ?? (signal === 'SIGKILL' ? 137 : 1)));
});
clearTimeout(timer);
clearTimeout(killTimer);
fs.writeFileSync(path.join(directory, 'container-result.json'), JSON.stringify({ exitCode, timeout: forcedCode === 124 }, null, 2));
process.exitCode = exitCode;
