import fs from 'node:fs';

// Both the full runner and its entrypoint check this. Host verification dispatches
// through docker-verify instead of launching a host server/browser.
export function assertTestContainer() {
  if (process.platform !== 'linux' || !fs.existsSync('/.dockerenv') ||
      process.env.AI_DND_TEST_CONTAINER !== '1' || process.env.HOSTNAME !== 'ai-dnd-verify') {
    throw new Error('Full verification requires the dedicated Docker test container. Run npm run verify on the host; do not launch a host browser.');
  }
}
