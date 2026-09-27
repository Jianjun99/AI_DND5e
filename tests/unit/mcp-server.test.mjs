// tests/unit/mcp-server.test.mjs — MCP stdio protocol & tools smoke test.
// Spawns mcp/server.mjs, walks the JSON-RPC handshake and exercises the fast
// tools (rules query, failures reader). run_verify / run_balance_sim are only
// schema-checked here — the full verify battery exercises them implicitly.
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..', '..');

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

function test(name, fn) {
  const before = failed;
  try {
    fn();
    console.log(`  ✔ PASS: ${name}`);
  } catch (err) {
    if (failed === before) failed++;
    console.error(`  ❌ FAILED: ${name} — ${err && (err.stack || err.message)}`);
  }
}

const server = spawn(process.execPath, [path.join(ROOT, 'mcp', 'server.mjs')],
  { cwd: ROOT, stdio: ['pipe', 'pipe', 'pipe'] });

const pending = [];
let buf = '';
server.stdout.on('data', (chunk) => {
  buf += chunk;
  let idx;
  while ((idx = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, idx).trim();
    buf = buf.slice(idx + 1);
    if (!line) continue;
    const resolve = pending.shift();
    if (resolve) resolve(JSON.parse(line));
  }
});

let nextId = 0;
function rpc(method, params) {
  return new Promise((resolve, reject) => {
    const id = ++nextId;
    const timer = setTimeout(() => reject(new Error(`timeout waiting for ${method}`)), 30000);
    pending.push((msg) => { clearTimeout(timer); resolve(msg); });
    server.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });
}

function textOf(msg) {
  return msg.result && msg.result.content && msg.result.content[0] && msg.result.content[0].text;
}

// Give the process a moment, then walk the protocol. All assertions run inside
// the async main; the synchronous test() wrappers below record the results.
const results = [];
const main = (async () => {
  const init = await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {} });
  results.push(['initialize returns serverInfo + tool capability', () => {
    assert(init.result && init.result.serverInfo && init.result.serverInfo.name === 'ai-dnd-mcp', 'serverInfo.name is ai-dnd-mcp');
    assert(init.result.capabilities && init.result.capabilities.tools, 'tools capability declared');
  }]);
  server.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');

  const list = await rpc('tools/list', {});
  const names = list.result.tools.map((t) => t.name);
  results.push(['tools/list exposes the four tools', () => {
    assert(names.includes('run_verify') && names.includes('run_balance_sim')
      && names.includes('query_rules') && names.includes('recent_failures'),
      `expected the four tools, got ${names.join(', ')}`);
    assert(list.result.tools.every((t) => t.inputSchema && t.description), 'every tool carries schema + description');
  }]);

  const goblin = await rpc('tools/call', { name: 'query_rules', arguments: { table: 'monsters', id: 'goblin' } });
  results.push(['query_rules returns the goblin statblock', () => {
    assert(goblin.result && goblin.result.isError !== true, 'goblin query is not an error');
    assert(textOf(goblin).includes('MONSTERS["goblin"]') || textOf(goblin).includes('"goblin"'), 'goblin payload present');
  }]);

  const listIds = await rpc('tools/call', { name: 'query_rules', arguments: { table: 'spells' } });
  results.push(['query_rules without id lists entry ids', () => {
    assert(Array.isArray(JSON.parse(textOf(listIds).split(':\n')[1])), 'id list is a JSON array');
  }]);

  const bad = await rpc('tools/call', { name: 'query_rules', arguments: { table: 'nope' } });
  results.push(['unknown table is a tool-level error', () => {
    assert(bad.result.isError === true, 'isError set');
    assert(textOf(bad).includes('Available:'), 'error lists the valid tables');
  }]);

  const misses = await rpc('tools/call', { name: 'query_rules', arguments: { table: 'monsters', id: 'not_a_monster' } });
  results.push(['unknown id is a tool-level error', () => {
    assert(misses.result.isError === true, 'isError set for missing id');
  }]);

  const fails = await rpc('tools/call', { name: 'recent_failures', arguments: {} });
  results.push(['recent_failures answers gracefully with or without a log', () => {
    assert(typeof textOf(fails) === 'string' && textOf(fails).length > 0, 'non-empty answer');
  }]);

  const unknown = await rpc('bogus/method', {});
  results.push(['unknown method returns -32601', () => {
    assert(unknown.error && unknown.error.code === -32601, 'JSON-RPC error -32601');
  }]);
})().catch((e) => {
  results.push(['protocol walk crashed', () => { assert(false, String(e && e.stack || e)); }]);
});

// hard cap: kill the server and print the summary regardless
const deadline = setTimeout(() => {
  console.error('  ❌ FAILED: MCP protocol walk timed out');
  server.kill();
  process.exit(1);
}, 45000);

await main;
server.kill();
clearTimeout(deadline);

console.log('\n--- Running Unit Tests: MCP Server (stdio protocol) ---');
for (const [name, fn] of results) test(name, fn);
console.log(`\nMCP Server Unit Tests Summary: ${passed} passed, ${failed} failed.`);
if (failed > 0) process.exit(1);
