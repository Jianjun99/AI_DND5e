// Read-only author check; never starts a server, browser or AI, and never installs a pack.
import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const content = require('../server/game/content.js');

try {
  const file = process.argv[2];
  let result;
  if (file) result = content.validateBundle(JSON.parse(fs.readFileSync(file, 'utf8')));
  else {
    const reg = content.scan({ cache: false });
    result = { ok: !reg.diagnostics.some(d => d.severity === 'error'), diagnostics: reg.diagnostics, warnings: reg.warnings };
  }
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = result.ok ? 0 : 1;
} catch (error) {
  console.error('Content check failed: ' + error.message);
  process.exitCode = 1;
}
