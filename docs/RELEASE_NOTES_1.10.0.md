This release connects the solo adventure loop: start with a recommended hero, follow a clear objective, settle the journey once, and return to town knowing what to try next. It also introduces a small adventure whose keeper remembers your actual choices.

## Start playing sooner

- Two server-defined recommended heroes offer a quick start, with their full class skills and spell choices.
- A skippable first-adventure coach guides movement, interactions, combat and settlement.
- Map, difficulty and companion selections reach the real engine. The Howling Hills is available on the region map.

## Follow a complete adventure

- Home, region map, delve and summary share server-derived objectives and next actions.
- A cleared area is distinguished from a completed objective. Fetch adventures finish when the relic reaches the campfire; retreat banks current gains without advancing the story.
- Ongoing delves and unsettled endings remain easy to resume. Summaries show gains, story progress and the next destination.
- Stale polls and slow AI replies no longer roll back movement, overwrite newer NPC exchanges or update a page after you leave.

## Return to town with reliable saves

- Settlement uses an ending-specific receipt so repeated requests do not repeat rewards.
- Save failures can be retried, receipt mirrors recover missing records, and purchases or level-ups after settlement survive reopening an old summary.
- Return actions wait for confirmed settlement. Legacy death saves can respawn and settle a later ending correctly.

## Meet a keeper who remembers

- Visit 山谷哨门 (Vale Gate), a new optional level 1–3 adventure on the town region map.
- Find and return a real passage seal for a peaceful route, or choose combat using the existing bandit encounter and combat rules.
- Peace consumes the seal without combat XP or loot; combat preserves it and applies normal combat rewards.
- The engine records the choice once. After settlement and a later visit, the keeper recalls how you passed and responds differently.
- Both routes work with AI disabled or unavailable. Optional AI receives confirmed facts and available choices and cannot grant items, HP, XP or story facts.

## Keep the engine as referee

- Lockpicking, forcing chests, disarming traps and road encounters are resolved on the server. Dice animation displays the engine result.
- Read-only previews use the real skill and expertise modifiers instead of duplicated client calculations.
- Road encounters restore after refresh, resolve once and consume their result once on departure; failed starts remain retryable.

## Build and share safer content packs

- Two-phase validation checks definition shapes and references after every pack has registered.
- Diagnostics identify the pack, file, field and winning definition for duplicates. Unknown maps and invalid stairs fail explicitly.
- Imports validate before writing, replace complete packs and roll back failed updates.
- Shipped maps receive fixes for wall-embedded starts and entities, campfire IDs and ignored authored boss flags.
- A complete import/play/export/reimport example, a read-only author CLI and a finite remembered-scene protocol are documented in MODDING.md.

## Verification and agent handoff

- One npm run verify executes lint, types, 27 suites including six real Chromium CDP suites, and smoke checks in a dedicated Docker container.
- Verification uses isolated data, disabled real AI and external networking, a shared container lock, 2 CPUs and 4 GiB of RAM, automatic cleanup and retained failure evidence.
- Content validation has 51 cases and 180 assertions. The remembered encounter covers both routes, persistence, duplicates, failures, model overreach and delayed replies through integration and browser tests.
- START_HERE.md, task records and the project-owner handoff guide give the next coding agent concrete entry points and verification steps.

## Updating

Keep the existing /app/data volume when replacing the game container. Existing saves remain supported; start a new Vale Gate adventure to try its new map. Stored map snapshots are not rewritten.

## ▶️ Run it

```bash
docker run -d --name ai-dnd -p 3000:3000 -v ai-dnd-data:/app/data ghcr.io/jianjun99/ai_dnd5e:1.10.0
```

Open http://localhost:3000. If a container named ai-dnd already exists, replace that container while keeping its data volume.

Worth trying first: choose a recommended hero, visit 山谷哨门 from the region map, return the seal, bring the relic home, and visit the keeper again.
