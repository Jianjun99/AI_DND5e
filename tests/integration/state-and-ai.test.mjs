// tests/integration/state-and-ai.test.mjs
// T2 — state updates & AI result persistence, over the REAL HTTP routes (in-process express):
//  - a slow describe must never roll back a concurrent move (the stale-snapshot bug)
//  - start/action narration must survive re-GET exactly once
//  - LLM error / timeout / disabled keep fixed fallbacks and working mechanics
//  - two delves interleaved with a slow model request stay independent
// The mock LLM is an in-process http server with deterministic modes and an explicit
// "request received / release reply" control — no fixed sleeps in the ordering assertions.
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import http from 'node:http';

// isolated DATA_DIR — must be set BEFORE the first server module is required, so this
// suite can never touch real player saves or real LLM settings
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-dnd-t2-'));

const require = createRequire(import.meta.url);
const express = require('express');
const store = require('../../server/store.js');

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (!condition) {
    console.error(`  ❌ FAILED: ${message}`);
    failed++;
    throw new Error(message);
  }
  passed++;
}

async function test(name, fn) {
  try {
    await fn();
    console.log(`  ✔ PASS: ${name}`);
  } catch (err) {
    failed++;
    console.error(`  ❌ ERROR in ${name}:`, err.message);
  }
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ---- controllable in-process mock LLM (OpenAI-compatible /v1/chat/completions) ----
// modes: 'auto' (reply at once from the queue or a default) · 'hold' (wait for release)
//        'error' (HTTP 400) · 'never' (never reply — exercises the client timeout)
function createMockLlm() {
  const state = { mode: 'auto', queue: [], received: 0, held: [], bodies: [] };
  const server = http.createServer((req, res) => {
    if (!(req.method === 'POST' && req.url.endsWith('/chat/completions'))) {
      res.writeHead(404); res.end('{}'); return;
    }
    let raw = '';
    req.on('data', c => { raw += c; });
    req.on('end', () => {
      state.received++;
      try { state.bodies.push(JSON.parse(raw)); } catch { state.bodies.push(null); }
      const reply = (text, status = 200) => {
        res.writeHead(status, { 'Content-Type': 'application/json' });
        if (status !== 200) { res.end('{"error":"mock failure"}'); return; }
        res.end(JSON.stringify({ choices: [{ message: { content: text } }] }));
      };
      if (state.mode === 'never') return;
      if (state.mode === 'error') { reply('mock failure', 400); return; }
      if (state.mode === 'hold') { state.held.push(reply); return; }
      reply(state.queue.length ? state.queue.shift() : 'MOCK AUTO LINE');
    });
    req.resume();
  });
  return new Promise(resolve => {
    server.listen(0, '127.0.0.1', () => {
      resolve({
        port: server.address().port,
        set mode(m) { state.mode = m; },
        enqueue(text) { state.queue.push(text); },
        clearQueue() { state.queue.length = 0; },
        get received() { return state.received; },
        get bodies() { return state.bodies; },
        release(text) {
          const reply = state.held.shift();
          if (!reply) throw new Error('no held mock request to release');
          reply(text);
        },
        async waitForReceived(count) {
          const deadline = Date.now() + 8000;
          while (state.received < count) {
            if (Date.now() > deadline) throw new Error(`mock LLM never received request #${count}`);
            await sleep(20);
          }
        },
        close: () => new Promise(r => server.close(r))
      });
    });
  });
}

const mock = await createMockLlm();

function enableMock(timeoutMs = 5000) {
  store.saveSettings({
    llm: {
      enabled: true, preset: 'custom',
      baseUrl: `http://127.0.0.1:${mock.port}/v1`, model: 'mock-model',
      apiKey: '', timeoutMs
    }
  });
}

// ---- in-process app with the real routes ----
const app = express();
app.use(express.json());
app.use('/api/characters', require('../../server/routes/characters.js'));
app.use('/api/game', require('../../server/routes/game.js'));
const server = await new Promise(resolve => { const s = app.listen(0, () => resolve(s)); });
const BASE_URL = `http://localhost:${server.address().port}`;

async function api(method, p, body) {
  const res = await fetch(`${BASE_URL}${p}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method} ${p} -> HTTP ${res.status}: ${JSON.stringify(data).slice(0, 200)}`);
  return data;
}

async function createHero(name) {
  const res = await api('POST', '/api/characters', {
    name, species: 'human', className: 'fighter', background: 'soldier',
    baseScores: { str: 16, dex: 14, con: 14, int: 10, wis: 12, cha: 8 },
    bgPlus2: 'str', bgPlus1: 'con', skills: ['athletics', 'perception'],
    fightingStyle: 'defense', armorOption: 'chain_mail', weaponOption: 'sword_board'
  });
  return res;
}

async function startDelve(charId) {
  return api('POST', '/api/game/start', { characterId: charId, bringAlly: false, difficulty: 'normal', mapId: 'crypt' });
}

function playerOf(state) { return state.entities.find(e => e.kind === 'player'); }

// performs one legal orthogonal move, retrying neighbours of p0 until one lands
async function moveOnce(saveId, p0) {
  for (const [dx, dy] of [[1, 0], [0, 1], [-1, 0], [0, -1]]) {
    const res = await api('POST', `/api/game/${saveId}/action`, { type: 'move', x: p0.x + dx, y: p0.y + dy });
    const err = res.events.find(e => e.type === 'error');
    const p = playerOf(res.state);
    if (!err && p && (p.x !== p0.x || p.y !== p0.y)) return { res, x: p.x, y: p.y };
  }
  throw new Error('no adjacent tile was walkable — test setup broken');
}

console.log('\n--- Running Integration Tests: State Updates & AI Persistence (T2) ---');

try {
  await test('concurrent describe + move: the moved position never rolls back, the appearance is still cached', async () => {
    enableMock();
    mock.mode = 'auto'; mock.clearQueue();
    const char = await createHero('T2 Race Hero');
    const start = await startDelve(char.id);
    const saveId = start.state.id;
    const monster = start.state.entities.find(e => e.kind === 'monster');
    assert(monster, 'the crypt spawns a creature to describe');
    const p0 = playerOf(start.state);

    // describe fires and reaches the held mock — its mechanical phase has already committed.
    // (waitForReceived needs an absolute count: startDelve's scene narration already hit the mock.)
    // The reply text rides on release(), NOT on the queue — a held request never consumes it.
    mock.mode = 'hold';
    const describeBase = mock.received;
    const describePromise = api('POST', `/api/game/${saveId}/action`, { type: 'describe', targetId: monster.id });
    await mock.waitForReceived(describeBase + 1);

    // while the DM is still holding the describe, a plain move goes through
    mock.mode = 'auto'; mock.enqueue('MOCK MOVE NARRATION');
    const move = await moveOnce(saveId, p0);
    const pMove = playerOf(move.res.state);
    assert(pMove.x === move.x && pMove.y === move.y, 'the move landed while the describe was waiting');

    // only now does the DM answer the describe
    mock.release('MOCK APPEARANCE');
    const desc = await describePromise;
    assert(desc.appearance === 'MOCK APPEARANCE', 'the describe response carries the DM prose');
    const pDesc = playerOf(desc.state);
    assert(pDesc.x === move.x && pDesc.y === move.y, 'the describe response state includes the concurrent move');

    // the authoritative check: the persisted save on disk
    const after = await api('GET', `/api/game/${saveId}`);
    const pAfter = playerOf(after.state);
    assert(pAfter.x === move.x && pAfter.y === move.y,
      `position must not roll back (got ${pAfter.x},${pAfter.y}, moved to ${move.x},${move.y})`);
    assert(after.state.appearances && after.state.appearances[monster.monsterId] === 'MOCK APPEARANCE',
      'the appearance was merged into the LATEST save, not lost with the snapshot');
    const moveNarrations = after.state.log.filter(l => (l.text || '').includes('MOCK MOVE NARRATION'));
    assert(moveNarrations.length === 1 && moveNarrations[0].kind === 'dm',
      'the move narration is persisted exactly once');
    assert(typeof after.state.rev === 'number' && after.state.rev >= 3,
      `rev is stamped and grows with writes (got ${after.state.rev})`);
  });

  await test('delve start narration survives GET/refresh exactly once and replaces the canned scene line', async () => {
    enableMock();
    mock.mode = 'auto'; mock.clearQueue(); mock.enqueue('MOCK SCENE NARRATION');
    const char = await createHero('T2 Start Narration Hero');
    const start = await startDelve(char.id);
    const dmLine = start.state.log.filter(l => (l.text || '').includes('MOCK SCENE NARRATION'));
    assert(dmLine.length === 1 && dmLine[0].kind === 'dm',
      'the start response already carries the merged narration');
    assert(start.state.log.filter(l => l.kind === 'dm_canned').length === 0,
      'the canned scene line was replaced when the DM voiced it');
    const get = await api('GET', `/api/game/${start.state.id}`);
    assert(get.state.log.filter(l => (l.text || '').includes('MOCK SCENE NARRATION')).length === 1,
      're-GET still shows the narration exactly once (no duplicates)');
  });

  await test('plain action narration carries its own aid — POST and GET agree exactly once (T2a coverage fix)', async () => {
    enableMock();
    mock.mode = 'auto'; mock.clearQueue(); mock.enqueue('MOCK SCENE NARRATION');
    const char = await createHero('T2 Action Narration Hero');
    const start = await startDelve(char.id);
    const sceneAid = (start.state.log.find(l => l.kind === 'dm') || {}).aid;
    assert(sceneAid, 'the start narration is tagged with the start action id');

    // the action marker is scheduled only AFTER the delve started — the earlier version of
    // this test enqueued it before startDelve, where the opening scene consumed it, so the
    // assertion could never tell an action narration from the start narration
    mock.enqueue('MOCK ACTION NARRATION');
    const move = await moveOnce(start.state.id, playerOf(start.state));
    assert(start.state.log.filter(l => (l.text || '').includes('MOCK ACTION NARRATION')).length === 0,
      'the action marker does not exist before the action');
    const dmLine = move.res.state.log.filter(l => (l.text || '').includes('MOCK ACTION NARRATION'));
    assert(dmLine.length === 1 && dmLine[0].kind === 'dm',
      'the action response carries the narration');
    assert(dmLine[0].aid && dmLine[0].aid !== sceneAid,
      'the action narration is tagged with its own aid, distinct from the start\'s');
    const get = await api('GET', `/api/game/${start.state.id}`);
    const getLines = get.state.log.filter(l => (l.text || '').includes('MOCK ACTION NARRATION'));
    assert(getLines.length === 1 && getLines[0].aid === dmLine[0].aid,
      'the narration is persisted exactly once under the same aid');
  });

  await test('LLM HTTP error: fixed fallback appearance, mechanics keep working', async () => {
    enableMock();
    mock.mode = 'error';
    const char = await createHero('T2 Error Hero');
    const start = await startDelve(char.id);
    const saveId = start.state.id;
    const monster = start.state.entities.find(e => e.kind === 'monster');
    const desc = await api('POST', `/api/game/${saveId}/action`, { type: 'describe', targetId: monster.id });
    assert(typeof desc.appearance === 'string' && desc.appearance.length > 0 && !desc.appearance.includes('MOCK'),
      'the describe fell back to the baked-in blurb');
    const after = await api('GET', `/api/game/${saveId}`);
    assert(after.state.appearances[monster.monsterId] === desc.appearance,
      'the fallback appearance is cached server-side');
    const p0 = playerOf(after.state);
    const move = await moveOnce(saveId, p0);
    assert(playerOf(move.res.state).x === move.x, 'mechanics keep working after the model error');
  });

  await test('LLM timeout: fallback after the abort, and a concurrent move was never blocked or lost', async () => {
    enableMock(3000); // the settings route clamps to a 3s floor — keep the test quick
    mock.mode = 'never';
    const char = await createHero('T2 Timeout Hero');
    const start = await startDelve(char.id);
    const saveId = start.state.id;
    const monster = start.state.entities.find(e => e.kind === 'monster');
    const p0 = playerOf(start.state);
    const describePromise = api('POST', `/api/game/${saveId}/action`, { type: 'describe', targetId: monster.id });
    await mock.waitForReceived(mock.received + 1);
    const move = await moveOnce(saveId, p0);
    const desc = await describePromise;
    assert(typeof desc.appearance === 'string' && !desc.appearance.includes('MOCK'),
      'the timed-out describe falls back to the fixed blurb');
    const after = await api('GET', `/api/game/${saveId}`);
    const pAfter = playerOf(after.state);
    assert(pAfter.x === move.x && pAfter.y === move.y, 'the concurrent move survived the timeout');
  });

  await test('LLM disabled: zero mock traffic, canned fallbacks, mechanics unaffected', async () => {
    store.saveSettings({ llm: { enabled: false } });
    const before = mock.received;
    const char = await createHero('T2 Offline Hero');
    const start = await startDelve(char.id);
    const saveId = start.state.id;
    assert((start.state.log.filter(l => l.kind === 'dm_canned')).length >= 1,
      'the canned scene line stands when the DM is off');
    const monster = start.state.entities.find(e => e.kind === 'monster');
    const desc = await api('POST', `/api/game/${saveId}/action`, { type: 'describe', targetId: monster.id });
    assert(typeof desc.appearance === 'string' && desc.appearance.length > 0,
      'describe falls back to the baked-in blurb with the LLM off');
    assert(mock.received === before, 'no request ever reached the LLM endpoint');
    const move = await moveOnce(saveId, playerOf(start.state));
    assert(playerOf(move.res.state).x === move.x, 'mechanics unaffected');
  });

  await test('concurrent same-NPC chats: the slow reply lands after the fast one and keeps both histories (T2a)', async () => {
    enableMock();
    mock.mode = 'auto'; mock.clearQueue();
    const char = await createHero('T2 Chat Race Hero');
    const start = await startDelve(char.id);
    const saveId = start.state.id;
    const npc = start.state.entities.find(e => e.kind === 'npc' && e.npcId === 'bram');
    assert(npc, 'bram stands next to the crypt entrance');

    // chat A fires and is held at the mock (its user line exists only in its own snapshot)
    mock.mode = 'hold';
    const baseA = mock.received;
    const chatA = api('POST', `/api/game/${saveId}/action`, { type: 'chat', npcId: 'bram', text: 'review-chat-A' });
    await mock.waitForReceived(baseA + 1);

    // chat B (same save, same NPC) runs to completion first
    mock.mode = 'auto'; mock.clearQueue(); mock.enqueue('REPLY-B');
    const b = await api('POST', `/api/game/${saveId}/action`, { type: 'chat', npcId: 'bram', text: 'review-chat-B' });
    assert(b.chatReply === 'REPLY-B', 'chat B completed with its own reply');
    const mid = await api('GET', `/api/game/${saveId}`);
    const midHist = mid.state.npcChat.bram || [];
    assert(midHist.some(m => m.content === 'review-chat-B') && midHist.some(m => m.content === 'REPLY-B'),
      'B\'s exchange is persisted before A returns');

    // only now does A's reply arrive
    mock.release('REPLY-A');
    const a = await chatA;
    assert(a.chatReply === 'REPLY-A', 'chat A completed after the release');

    const get = await api('GET', `/api/game/${saveId}`);
    const hist = get.state.npcChat.bram || [];
    const texts = hist.map(m => m.content);
    for (const t of ['review-chat-A', 'REPLY-A', 'review-chat-B', 'REPLY-B']) {
      assert(texts.filter(x => x === t).length === 1, `"${t}" kept exactly once (got ${texts.filter(x => x === t).length})`);
    }
    // ordering rule: completions append in completion order — B finished first
    assert(texts.indexOf('REPLY-B') < texts.indexOf('review-chat-A'),
      'history is in completion order (B\'s exchange precedes A\'s)');
    // pairing: each user line is immediately followed by its own reply, never swapped
    for (const [u, r] of [['review-chat-B', 'REPLY-B'], ['review-chat-A', 'REPLY-A']]) {
      assert(texts[texts.indexOf(u) + 1] === r, `"${u}" is paired with "${r}"`);
    }
    assert(get.state.log.filter(l => l.kind === 'npc' && (l.text.includes('REPLY-A') || l.text.includes('REPLY-B'))).length === 2,
      'both replies stay visible in the log');

    // a later chat's prompt still contains the retained history (the model remembers both)
    mock.mode = 'auto'; mock.clearQueue(); mock.enqueue('REPLY-C');
    await api('POST', `/api/game/${saveId}/action`, { type: 'chat', npcId: 'bram', text: 'review-chat-C' });
    const lastBody = mock.bodies[mock.bodies.length - 1];
    const prompt = JSON.stringify((lastBody && lastBody.messages) || []);
    for (const t of ['review-chat-A', 'REPLY-A', 'review-chat-B', 'REPLY-B']) {
      assert(prompt.includes(t), `the follow-up prompt still contains "${t}"`);
    }
  });

  await test('two delves interleaved with a slow describe stay independent (no cross-save bleed)', async () => {
    enableMock();
    mock.mode = 'auto'; mock.clearQueue();
    const charA = await createHero('T2 Interleave A');
    const charB = await createHero('T2 Interleave B');
    const a = await startDelve(charA.id);
    const b = await startDelve(charB.id);
    const monsterA = a.state.entities.find(e => e.kind === 'monster');

    mock.mode = 'hold';
    const describeA = api('POST', `/api/game/${a.state.id}/action`, { type: 'describe', targetId: monsterA.id });
    await mock.waitForReceived(mock.received + 1);
    mock.mode = 'auto'; mock.enqueue('MOCK B NARRATION');

    const pB0 = playerOf(b.state);
    const moveB = await moveOnce(b.state.id, pB0);
    mock.release('MOCK A APPEARANCE');
    const descA = await describeA;
    assert(descA.appearance === 'MOCK A APPEARANCE', 'delve A describe returned its own appearance');

    const afterA = await api('GET', `/api/game/${a.state.id}`);
    const afterB = await api('GET', `/api/game/${b.state.id}`);
    const pA = playerOf(afterA.state);
    const pB = playerOf(afterB.state);
    assert(pA.x === playerOf(a.state).x && pA.y === playerOf(a.state).y, 'delve A position untouched');
    assert(pB.x === moveB.x && pB.y === moveB.y, 'delve B moved on its own');
    assert(afterA.state.appearances[monsterA.monsterId] === 'MOCK A APPEARANCE', 'delve A got its appearance');
    assert(!afterB.state.appearances || !Object.keys(afterB.state.appearances).length,
      'delve B did not inherit delve A\'s cache');
    assert(afterB.state.log.some(l => (l.text || '').includes('MOCK B NARRATION')),
      'delve B narration persisted on its own save');
  });

} finally {
  // never leave the mock LLM configured for other suites or real play
  store.saveSettings({ llm: { enabled: false } });
  await mock.close().catch(() => {});
  await new Promise(r => server.close(r));
  try { fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true }); } catch {}
}

console.log(`\nState & AI Persistence Summary: ${passed} passed, ${failed} failed.\n`);
if (failed > 0) process.exit(1);
