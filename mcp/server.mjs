#!/usr/bin/env node
// mcp/server.mjs — zero-dependency MCP server (stdio transport) that exposes this
// repo's verification and rules-query tooling to any MCP client (ZCode, Claude,
// Cursor, ...). Ground-rule safe: it is strictly read-only plus "run existing
// scripts" — there is deliberately no tool that writes saves or game state.
//
// Wire format: newline-delimited JSON-RPC 2.0 on stdio. Logs go to stderr only.
// Run:  node mcp/server.mjs   (see AGENTS.md "MCP 接入" for client config)
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const require2 = createRequire(import.meta.url);
const pkg = require2(path.join(ROOT, 'package.json'));

const MAX_TOOL_TEXT = 4000;

// ------------------------------------------------------------------ tools ----

/** Spawn a long task, capture its output, resolve with { code, text }. */
function runCapture(cmd, args, timeoutMs = 12 * 60 * 1000) {
  return new Promise((resolve) => {
    const proc = spawn(cmd, args, { cwd: ROOT, env: { ...process.env }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    const timer = setTimeout(() => {
      proc.kill();
      resolve({ code: -1, text: (out + '\n' + err).slice(-MAX_TOOL_TEXT) + '\n(timeout after ' + Math.round(timeoutMs / 1000) + 's)' });
    }, timeoutMs);
    proc.stdout.on('data', (d) => { out += d; });
    proc.stderr.on('data', (d) => { err += d; });
    proc.on('error', (e) => { clearTimeout(timer); resolve({ code: -1, text: String(e) }); });
    proc.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? -1, text: ((out + '\n' + err).trim()).slice(-MAX_TOOL_TEXT) || '(no output)' });
    });
  });
}

const ENGINE_TABLES = {
  species: 'SPECIES', classes: 'CLASSES', backgrounds: 'BACKGROUNDS', feats: 'FEATS',
  weapons: 'WEAPONS', armor: 'ARMORS', gear: 'GEAR', spells: 'SPELLS', monsters: 'MONSTERS',
  allies: 'ALLIES', shop: 'SHOP_ITEMS', xp_thresholds: 'XP_THRESHOLDS', difficulty: 'DIFFICULTY',
  dnd_conditions: 'CONDITIONS'
};

function queryRules(args) {
  const engine = require2(path.join(ROOT, 'server', 'game', 'engine.js'));
  const key = ENGINE_TABLES[(args && args.table) || ''];
  if (!key) {
    return { isError: true, text: 'Unknown table. Available: ' + Object.keys(ENGINE_TABLES).join(', ') };
  }
  const table = engine[key];
  if (table == null) return { isError: true, text: 'Table not exported: ' + key };
  const id = args && args.id;
  let result;
  if (Array.isArray(table)) {
    result = id ? (engine.byId(table, id) || null) : table.map((t) => t.id);
  } else {
    result = id ? (table[id] || null) : Object.keys(table);
  }
  if (result == null) return { isError: true, text: `No entry '${id}' in ${key}. Try without id to list all ids.` };
  let text = JSON.stringify(result, null, 1);
  if (text.length > MAX_TOOL_TEXT) text = text.slice(0, MAX_TOOL_TEXT) + '\n…(truncated — query a specific id)';
  return { text: `${key}${id ? `[${id}]` : ''}:\n${text}` };
}

function recentFailures() {
  const logPath = path.join(ROOT, 'data', 'last-verify.log');
  if (!fs.existsSync(logPath)) {
    return { text: 'No verify log yet — run the run_verify tool (or npm run verify) once.' };
  }
  const raw = fs.readFileSync(logPath, 'utf8');
  const lines = raw.split('\n');
  const interesting = lines.filter((l) => /✘|❌|FAIL|failed|ECONNREFUSED|aborted|Error/i.test(l));
  const body = interesting.length ? interesting.slice(-60).join('\n') : lines.slice(-30).join('\n');
  return { text: `(data/last-verify.log, ${lines.length} lines, ${interesting.length} flagged)\n` + body.slice(-MAX_TOOL_TEXT) };
}

const TOOLS = [
  {
    name: 'run_verify',
    description: 'Run the full repo verification (npm run verify: boots a server, eslint + tsc + all test suites + smoke). Takes several minutes.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false }
  },
  {
    name: 'run_replay',
    description: 'Run the delve replay bot (scripts/replay-bot.mjs): plays complete delves over the REST API and checks gameplay-level invariants. The deep regression net for engine changes.',
    inputSchema: { type: 'object', properties: { runs: { type: 'number', description: 'delve count (default 4)' } }, additionalProperties: false }
  },
  {
    name: 'run_balance_sim',
    description: 'Run scripts/balance-sim.mjs (bot battles) and return the win-rate table. Run this whenever you change combat/loot/gambling numbers.',
    inputSchema: { type: 'object', properties: { runs: { type: 'number', description: 'simulation count (default 50)' } }, additionalProperties: false }
  },
  {
    name: 'query_rules',
    description: 'Query the engine\u2019s data tables (species/classes/feats/weapons/armor/gear/spells/monsters/allies/shop/xp_thresholds/difficulty). Without id, returns the list of ids.',
    inputSchema: {
      type: 'object',
      properties: { table: { type: 'string' }, id: { type: 'string', description: 'entry id (omit to list ids)' } },
      required: ['table'],
      additionalProperties: false
    }
  },
  {
    name: 'recent_failures',
    description: 'Show flagged failure lines from the last verification log (data/last-verify.log).',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false }
  }
];

function callTool(name, args) {
  if (name === 'run_verify') return runCapture(process.execPath, ['scripts/verify.mjs']).then((r) => ({
    isError: r.code !== 0,
    text: `(exit ${r.code})\n${r.text}`
  }));
  if (name === 'run_replay') {
    const runs = Math.max(1, Math.min(20, Number(args && args.runs) || 4));
    return runCapture(process.execPath, ['scripts/replay-bot.mjs', '--runs', String(runs)], 20 * 60 * 1000).then((r) => ({
      isError: r.code !== 0,
      text: `(exit ${r.code}, delves=${runs})\n${r.text}`
    }));
  }
  if (name === 'run_balance_sim') {
    const runs = Math.max(1, Math.min(500, Number(args && args.runs) || 50));
    return runCapture(process.execPath, ['scripts/balance-sim.mjs', String(runs)]).then((r) => ({
      isError: r.code !== 0,
      text: `(exit ${r.code}, runs=${runs})\n${r.text}`
    }));
  }
  if (name === 'query_rules') return Promise.resolve(queryRules(args));
  if (name === 'recent_failures') return Promise.resolve(recentFailures());
  return Promise.resolve({ isError: true, text: 'Unknown tool: ' + name });
}

// -------------------------------------------------------------- protocol ----

function send(msg) { process.stdout.write(JSON.stringify(msg) + '\n'); }
function sendError(id, code, message) { send({ jsonrpc: '2.0', id, error: { code, message } }); }
const clip = (s) => (s && s.length > MAX_TOOL_TEXT ? s.slice(0, MAX_TOOL_TEXT) + '…' : s);

async function handleLine(line) {
  let msg;
  try { msg = JSON.parse(line); } catch { sendError(null, -32700, 'Parse error'); return; }
  if (msg.id == null) return; // notification (e.g. notifications/initialized)
  const { method, id } = msg;
  if (method === 'initialize') {
    send({
      jsonrpc: '2.0', id,
      result: {
        protocolVersion: (msg.params && msg.params.protocolVersion) || '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'ai-dnd-mcp', version: pkg.version }
      }
    });
  } else if (method === 'tools/list') {
    send({ jsonrpc: '2.0', id, result: { tools: TOOLS } });
  } else if (method === 'tools/call') {
    const name = msg.params && msg.params.name;
    const args = (msg.params && msg.params.arguments) || {};
    try {
      const r = await callTool(name, args);
      send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: clip(r.text) }], isError: !!r.isError } });
    } catch (e) {
      send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: clip(String(e && e.stack || e)) }], isError: true } });
    }
  } else {
    sendError(id, -32601, 'Method not found: ' + method);
  }
}

let buf = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buf += chunk;
  let idx;
  while ((idx = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, idx).trim();
    buf = buf.slice(idx + 1);
    if (line) handleLine(line);
  }
});
process.stdin.on('end', () => process.exit(0));
process.stderr.write(`ai-dnd-mcp ${pkg.version} ready (repo root: ${ROOT})\n`);
