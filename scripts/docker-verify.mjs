// Cross-platform Docker Desktop entrypoint. No host server/browser is launched.
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const NAME = 'ai-dnd-verify'; // Docker atomically reserves this name across agents/worktrees.
const runId = randomUUID();
const directory = path.join(ROOT, 'artifacts', 'verify', new Date().toISOString().replace(/[:.]/g, '-') + '-' + runId.slice(0, 8));
fs.mkdirSync(directory, { recursive: true });
const hostLog = path.join(directory, 'host.log');
const cidFile = path.join(directory, 'container.id');
const imageFile = path.join(directory, 'image.id');
const timeoutArg = process.argv.slice(2).find(arg => arg.startsWith('--timeout='));
const seconds = timeoutArg ? Number(timeoutArg.slice(10)) : 900;
const countArg = name => process.argv.slice(2).find(arg => arg.startsWith('--' + name + '='))?.split('=')[1];
const replayRuns = Number(countArg('replay-runs') ?? 0);
const balanceRuns = Number(countArg('balance-runs') ?? 0);
const dockerPaths = process.platform === 'win32' ? [
  path.join(process.env.LOCALAPPDATA || '', 'Programs', 'DockerDesktop', 'resources', 'bin', 'docker.exe'),
  'C:\\Program Files\\Docker\\Docker\\resources\\bin\\docker.exe'
] : [];
const docker = process.env.DOCKER_BIN || dockerPaths.find(candidate => fs.existsSync(candidate)) || 'docker';
let interrupted = 0;
let running;
let containerId;
let exitCode = 1;
let cleanupComplete = true;
const log = text => { fs.appendFileSync(hostLog, text); process.stdout.write(text); };
const onSignal = code => { interrupted = code; if (running) running.kill(); };
process.on('SIGINT', () => onSignal(130));
process.on('SIGTERM', () => onSignal(143));

function command(args, { timeout = 30000, quiet = false, cleanup = false } = {}) {
  if (interrupted && !cleanup) return Promise.reject(new Error('Verification interrupted'));
  return new Promise(resolve => {
    const proc = spawn(docker, args, { cwd: ROOT, shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
    if (!cleanup) running = proc;
    let output = '';
    let timedOut = false;
    let error;
    const timer = setTimeout(() => { timedOut = true; proc.kill(); }, timeout);
    const tee = data => { output += data; if (!quiet) log(data); };
    proc.stdout.on('data', tee);
    proc.stderr.on('data', tee);
    proc.on('error', err => { error = err; });
    proc.on('close', code => {
      clearTimeout(timer);
      if (running === proc) running = undefined;
      resolve({ code: timedOut ? 124 : code ?? 1, output, timedOut, error });
    });
  });
}
async function checked(args, options) {
  const result = await command(args, options);
  if (result.code !== 0) {
    const error = new Error(result.error?.message || result.output.trim() || ('docker ' + args[0] + ' failed (exit ' + result.code + ')'));
    error.exitCode = result.code;
    throw error;
  }
  return result.output.trim();
}

try {
  if (!Number.isFinite(seconds) || seconds <= 0) throw new Error('--timeout must be a positive number of seconds');
  if (!Number.isInteger(replayRuns) || replayRuns < 0 || replayRuns > 20) throw new Error('--replay-runs must be an integer from 0 to 20');
  if (!Number.isInteger(balanceRuns) || balanceRuns < 0 || balanceRuns > 500) throw new Error('--balance-runs must be an integer from 0 to 500');
  const os = await checked(['info', '--format', '{{.OSType}}'], { quiet: true });
  if (os !== 'linux') throw new Error('Docker Desktop must use Linux containers (reported: ' + os + ')');
  // Build output is preserved too. Source is COPYed; host dependencies never enter.
  log('Building dedicated verification image (2 CPU / 4 GiB test container).\n');
  await checked(['build', '--file', 'Dockerfile.test', '--tag', 'ai-dnd-verify:local', '--iidfile', imageFile, '.'], { timeout: 20 * 60 * 1000 });
  const image = fs.readFileSync(imageFile, 'utf8').trim();
  const user = process.platform === 'win32' ? '1000:1000' : process.getuid() + ':' + process.getgid();
  log('Starting isolated npm run verify; timeout ' + seconds + 's.\n');
  const result = await command(['run', '--rm', '--init', '--name', NAME, '--hostname', NAME,
    '--label', 'ai-dnd.verify.run=' + runId, '--cidfile', cidFile,
    '--cpus', '2', '--memory', '4g', '--memory-swap', '4g', '--shm-size', '512m', '--pids-limit', '512',
    '--network', 'none', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--user', user,
    '--mount', 'type=bind,source=' + directory + ',target=/test-artifacts',
    '--env', 'VERIFY_TIMEOUT_SECONDS=' + seconds,
    '--env', 'VERIFY_REPLAY_RUNS=' + replayRuns, '--env', 'VERIFY_BALANCE_RUNS=' + balanceRuns,
    image], { timeout: seconds * 1000 + 60000 });
  exitCode = interrupted || result.code;
  if (result.error) log(result.error.message + '\n');
  if (result.timedOut) log('Docker client timeout; stopping this run and preserving artifacts.\n');
  if (result.code === 125 && /already in use|Conflict/.test(result.output)) {
    exitCode = 73;
    log('Another verification owns ' + NAME + '. Wait for it; do not remove another agent\'s container.\n');
  }
} catch (error) {
  log('VERIFY FAILED: ' + error.message + '\nDocker Desktop/PATH/drive-sharing problems must be reported; no host-browser fallback.\n');
  exitCode = interrupted || error.exitCode || 1;
} finally {
  // Use only OUR container ID. Another agent may already have acquired the name.
  if (fs.existsSync(cidFile)) containerId = fs.readFileSync(cidFile, 'utf8').trim();
  if (containerId) {
    const state = await command(['inspect', '--format', '{{.State.Running}}', containerId], { quiet: true, cleanup: true });
    if (state.code === 0) {
      if (state.output.trim() === 'true') {
        await command(['exec', containerId, 'node', '--input-type=module', '-e',
          'import { captureBrowserArtifacts } from "./scripts/cdp-artifacts.mjs"; await captureBrowserArtifacts("host-stop");'], { timeout: 20000, cleanup: true });
        await command(['stop', '--time', '15', containerId], { cleanup: true });
      }
      const removal = await command(['rm', '--force', containerId], { quiet: true, cleanup: true });
      if (removal.code !== 0 && !/No such container/i.test(removal.output)) {
        cleanupComplete = false;
        log('Container cleanup FAILED: ' + removal.output + '\n');
        if (exitCode === 0) exitCode = 1;
      }
    } else if (!/No such (object|container)/i.test(state.output)) {
      cleanupComplete = false;
      log('Unable to confirm container removal: ' + state.output + '\n');
      if (exitCode === 0) exitCode = 1;
    }
  }
  const containerResultFile = path.join(directory, 'container-result.json');
  const containerResult = fs.existsSync(containerResultFile) ? JSON.parse(fs.readFileSync(containerResultFile, 'utf8')) : null;
  if (exitCode === 0 && (!containerResult || containerResult.exitCode !== 0)) {
    exitCode = 1;
    log('VERIFY FAILED: successful container result is missing.\n');
  }
  const result = { runId, exitCode, containerResult, cleanupComplete, directory, containerId, finishedAt: new Date().toISOString() };
  fs.writeFileSync(path.join(directory, 'result.json'), JSON.stringify(result, null, 2));
  fs.writeFileSync(path.join(ROOT, 'artifacts', 'verify', 'latest.json'), JSON.stringify(result, null, 2));
  log('Verification exit ' + exitCode + '; artifacts: ' + directory + '\n');
}
process.exitCode = exitCode;
