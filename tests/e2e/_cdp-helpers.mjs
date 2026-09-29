// tests/e2e/_cdp-helpers.mjs — shared condition-based wait helpers for the CDP e2e suites.
//
// Why: the app's act() dispatch has a busy guard (`if (busy) return`), so a click issued
// while the app is still processing the previous action is silently swallowed. A fixed
// sleep after a click therefore races the app's busy window — the root cause of the
// "Summary modal must be rendered" CI flake (tasks/cdp-flaky-investigation.md). Poll for
// the click's *effect* instead, and re-click when the effect never shows up.
//
// `send` is each suite's own `(method, params) => Promise<response>` CDP closure; the
// helpers hold no module state between calls, so every suite keeps its own spawn/cleanup
// and the suites stay runnable standalone.
//
// The underscore prefix is cosmetic — eslint's flat-config glob `tests/**/*.mjs` already
// covers this file (verified in eslint.config.mjs).

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function inspect(value) {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

// Evaluate `expression` in the page and unwrap `.result.result.value`. A CDP-level error
// or an in-page exception reads as `undefined` — a throwing probe simply means "not yet".
async function evalValue(send, expression) {
  try {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true });
    return r && r.result ? r.result.value : undefined;
  } catch {
    return undefined;
  }
}

// Poll a JS expression in the page until it returns a truthy value.
export async function pollUntil(send, expression, { timeout = 8000, interval = 250, description = '' } = {}) {
  const deadline = Date.now() + timeout;
  let lastValue;
  for (;;) {
    lastValue = await evalValue(send, expression);
    if (lastValue) return lastValue;
    if (Date.now() >= deadline) break;
    await sleep(Math.min(interval, Math.max(0, deadline - Date.now())));
  }
  throw new Error(
    `Condition not met within ${timeout}ms${description ? ` — ${description}` : ''} (last value: ${inspect(lastValue)})`
  );
}

// Click (re-evaluating clickExpr) then poll conditionExpr; re-clicks up to `clicks` times
// if the condition never appears — the busy-race cure. The click budget is spread evenly
// across the timeout (e.g. timeout 6000 / clicks 3 → a click every ~2s) while the condition
// is probed every `interval`, so the first click is still checked immediately.
export async function clickUntil(send, clickExpr, conditionExpr, { timeout = 6000, interval = 250, clicks = 3, description = '' } = {}) {
  const deadline = Date.now() + timeout;
  const clickEvery = Math.max(interval, Math.ceil(timeout / clicks));
  let nextClickAt = 0;
  let clickCount = 0;
  let lastValue;
  for (;;) {
    if (Date.now() >= deadline) break;
    if (clickCount < clicks && Date.now() >= nextClickAt) {
      lastValue = await evalValue(send, clickExpr);
      clickCount++;
      nextClickAt = Date.now() + clickEvery;
    }
    lastValue = await evalValue(send, conditionExpr);
    if (lastValue) return lastValue;
    await sleep(Math.min(interval, Math.max(0, deadline - Date.now())));
  }
  throw new Error(
    `Click condition not met within ${timeout}ms after ${clickCount} click(s)${description ? ` — ${description}` : ''} (last value: ${inspect(lastValue)})`
  );
}
