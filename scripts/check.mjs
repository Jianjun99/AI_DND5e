// scripts/check.mjs — the quick PARTIAL development check entry.
//
// Host: dispatches to the same dedicated Docker pipeline as `npm run verify`
// (shared image, container-name mutex, 2 CPU / 4 GiB, network isolation,
// container cleanup), flagged as a quick check. In the test container it runs
// scripts/dev-check.mjs: eslint → tsc → every unit and integration suite,
// fail-fast, with browser (CDP) suites only when explicitly selected.
//
// This is a development signal, NOT acceptance — `npm run verify` remains the
// only full gate (all suites, smoke, screenshots, red census).
//
// Usage:  npm run check                      (no browser suites)
//         npm run check -- --browsers=companion-story-cdp,hud-stability
//         npm run check -- --list

import { browserSuites } from './test-suites.mjs';

if (process.argv.slice(2).includes('--list')) {
  console.log('Browser suite ids for `npm run check -- --browsers=<id,...>`:');
  for (const suite of browserSuites) console.log('  ' + suite.id.padEnd(26) + suite.file);
  process.exit(0);
}

if (process.env.AI_DND_TEST_CONTAINER !== '1') {
  process.env.AI_DND_QUICK_CHECK = '1';
  await import('./docker-verify.mjs');
  process.exit(process.exitCode ?? 1);
}
await import('./dev-check.mjs');
