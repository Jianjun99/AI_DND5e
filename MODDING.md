# 🧩 MODDING.md — Make your own dungeons & monsters

AI Dungeon is fully data-driven. **Anyone can add maps, monsters, and magic items** by dropping
JSON files into a content pack — no coding required. This guide shows you how.

## How content loading works

At startup the game scans two places:

| Location | What it's for |
|---|---|
| `content/` (in the repo / Docker image) | Packs shipped with the game |
| `data/content/` (Docker volume) | Packs installed at runtime (via in-game import or by dropping folders) |

Every pack is a **folder** with a `pack.json` manifest plus any combination of `maps/`, `monsters.json`
and `gear.json`. The game merges everything; IDs that already exist in the core game are ignored
(with a warning in the API and on the home page), so you can't break the base game.

```
content/my-pack/
├── pack.json          ← manifest (required)
├── maps/
│   └── my-dungeon.json
├── monsters.json      ← optional
└── gear.json          ← optional
```

## pack.json

```json
{
  "id": "my-pack",
  "name": "My Pack",
  "author": "Your Name",
  "blurb": "One or two sentences about the pack."
}
```

`id` must be lowercase letters/numbers/`-`/`_` — it's also the filename used when sharing.

## Maps (`maps/*.json`)

A map is an ASCII grid. `#` = wall, `.` = floor, `,` = rubble (costs double movement),
`D` = door (blocks sight and movement until opened). A `door` **entity must stand on a `D`
tile** — T8 rejects an export where the entity and the glyph disagree (`door-tile-mismatch`),
because the engine reads the grid for passability and the entity for the runtime object.
A `D` glyph with no entity stays legal (shipped maps decorate doorframes).

```json
{
  "id": "my-dungeon",
  "name": "My Dungeon",
  "blurb": "A complete first adventure without combat.",
  "objectiveText": "Take the relic to the east, then return to the campfire.",
  "width": 9, "height": 5,
  "playerStart": { "x": 1, "y": 2 },
  "victory": {
    "type": "fetch_relic",
    "campfire": { "x": 1, "y": 2 }
  },
  "rooms": [
    { "id": "hall", "name": "The Hall", "rect": [1, 1, 7, 3],
      "desc": "A relic glows east of the campfire." }
  ],
  "rows": [
    "#########",
    "#.......#",
    "#.......#",
    "#.......#",
    "#########"
  ],
  "entities": [
    { "type": "chest", "id": "md_chest1", "name": "Old Chest", "x": 3, "y": 1, "icon": "🧰",
      "loot": { "gold": 30, "potions": 1, "items": [{ "id": "flame_dagger", "qty": 1 }] } },
    { "type": "object", "id": "campfire", "name": "Campfire", "x": 1, "y": 2, "icon": "🔥" },
    { "type": "object", "id": "relic", "name": "Practice Relic", "x": 6, "y": 2, "icon": "💎" }
  ],
  "npcs": {}
}
```

**Rules to follow**

- Every row string must be exactly `width` characters long.
- `height` must equal the number of rows. Coordinates are zero-based finite integers inside the grid; entities and critical positions cannot lie on `#` walls.
- The first and last rows/columns should be walls so the player can't walk off the map.
- `playerStart` and `victory.campfire` must be floor tiles.
- `victory.type` is either:
  - `"fetch_relic"` — player must grab the `relic` object and return to the campfire (core crypt style), or
  - `"slay_boss"` — the map must contain at least one boss. Set `boss: true` on its monster definition or map entity; a map entity's explicit boolean overrides the definition. Defeat the bosses, then return to the campfire.
- A `type: "object", id: "campfire"` must exist at exactly `victory.campfire`. A fetch objective also requires `type: "object", id: "relic"`.
- Monster `kind` can be any core monster (`giant_rat`, `skeleton`, `goblin`, `zombie`, `cultist`, `ogre`)
  or a monster from your own pack (see below).
- Chest `loot.items` can reference core items (`potion_healing`, `potion_greater`, `silver_sword`,
  `flame_dagger`, `cloak_protection`, `amulet_of_vigor`, ...) or your pack's `gear.json` items.
- NPC `id`s referenced by entities must have a matching entry in the map's `npcs`.
- Entity IDs are unique within a map, including generated `npc_<id>` actor IDs; `player` and `ally` are reserved runtime IDs.
- `stairs` entities use `to: {"mapId":"other-map","x":1,"y":2}`. Target maps may come from another installed pack; arrival coordinates must be inside it and off walls.
- Lever `targetTrapIds` must reference traps on the same map. Loot and wandering monster IDs are checked too.

## Public adventure directory (M1)

Every effective, validated map is listed in both the town's **Adventure directory**
and **Prepare the delve**. No metadata is required to play an old JSON pack. Search
by title, map ID or source pack, or filter by pack; the UI shows its public blurb,
server-provided recommendation and whether complete title/blurb translations exist
for the selected language. Missing translations display the author's original text.
Generated endless floors remain one system entry; the weekly trial and town remain
system destinations. Installing/replacing/deleting content is reflected on normal
load, or with **Refresh directory** while the page is open. A deleted selection falls
back to a valid destination. Existing adventures keep their map snapshot and original
settlement contract; removal does not rewrite player saves.

Optionally add the finite `adventure` object to a map:

```json
{
  "adventure": {
    "levels": { "min": 1, "max": 3 },
    "waypoint": {
      "regionX": 72, "regionY": 45,
      "icon": "dungeon", "region": "Eastern Trail",
      "localized": { "zh-CN": { "region": "东侧小径" } },
      "roads": [{ "to": "oakhaven", "label": "Lantern Trail", "localized": { "zh-CN": { "label": "提灯小径" } } }]
    }
  }
}
```

- `levels` is descriptive, not a restriction or a combat multiplier. Its ordered
  integer range is 1–99. When omitted, legacy `recommended` text and translations
  are used; when both are absent the UI says the recommendation is unspecified.
- `regionX/regionY` are finite 0–100 **region percentages**, independent of dungeon
  grid `x/y`. The waypoint ID is exactly the map ID; there is no second author ID.
- `icon` is one of `dungeon/crypt/vault/sewers/mill/dragon/hills/gate/courier`.
  It defaults to `dungeon`; URLs, markup and arbitrary asset paths are unsupported.
  `region` and each road's `label` are optional public strings, at most 200 characters.
- `roads` contains at most 32 `{to,label?,localized?}` entries. `to` names a different
  positioned map's ID, `oakhaven`, or `endless`. List-only maps and the list-only
  `weekly` entry are not valid endpoints. Declare each undirected pair once, including
  across packs; repeated endpoints, unknown/unpositioned endpoints and duplicate pairs
  reject import. Endpoint dependencies also apply when replacing a pack. Roads are
  public display metadata and do not change the engine's road encounter rules.
- Only `levels/waypoint` are supported on `adventure`; only the documented fields are
  supported on nested objects. T8 validates all metadata before transaction writes.
  Invalid installed definitions and dependent maps are excluded transitively.
  `oakhaven/endless/weekly`, `endless_…` and `weekly_…` are reserved system map IDs.
- The server projects a waypoint DTO and directory summary, never the raw map,
  room descriptions, NPC knowledge, effects or unchosen story endings. Authors must
  keep `name/blurb/recommended/region/label` public. The legacy `maps` response also
  preserves public `objectiveText` and an explicit whitelist of its translations.
- Export keeps authored metadata in the existing version-1 bundle. The example
  [adventure-directory-pack.json](tests/fixtures/content/adventure-directory-pack.json)
  has two new maps, one list-only and one positioned, with original English text.

## Optional bilingual text (T9c)

Each definition or nested text node may add `localized`, for example:

```json
{
  "id": "crypt_hound", "name": "Crypt Hound", "blurb": "A hound guards the crypt.",
  "localized": {
    "en": { "name": "Crypt Hound", "blurb": "A hound guards the crypt." },
    "zh-CN": { "name": "墓穴猎犬", "blurb": "一只猎犬守卫着墓穴。" }
  }
}
```

Translations cover existing text fields only (name, desc, blurb, objectiveText,
persona, knowledge, canned, prompt, label, response, memory and other descriptive
text). They cannot override IDs, coordinates, dice, prices, effects or other rules.
Use exactly `en` / `zh-CN`; placeholder names and text-array lengths must match the
canonical field. Unknown fields/languages or missing text references fail import
before writing. Old packs remain valid and fall back to their original text when a
language is absent; content information reports available translations. Display
text never changes the canonical names or equipment uniqueId used by the engine.
Room/NPC translations are returned only when their text is available to the player;
translation resources do not reveal hidden rooms or unchosen outcomes.

API presentation may add `nameDisplay` / `descDisplay` and other text descriptors
beside canonical fields. Authors should write `localized` in their definitions;
export keeps the original bundle rather than these synthesized Display fields.
An event emitted by code may carry `messageKey` + `params` while retaining `text`.
Use ID-based definitions or a typed text descriptor in params; pass already-rolled
results, never roll again to translate a log. Historical plain text and player names
are rendered verbatim. The shipped coverage/terminology and creation-point list live
in [T9c coverage](docs/T9C_LOCALIZATION_COVERAGE.md).

## Monsters (`monsters.json`)

```json
{
  "monsters": [
    {
      "id": "crypt_hound",
      "name": "Crypt Hound",
      "xp": 50, "ac": 13, "hp": "2d8+2", "speed": 40, "darkvision": 60,
      "abilities": { "str": 12, "dex": 16, "con": 12, "int": 3, "wis": 12, "cha": 6 },
      "attacks": [
        { "name": "Bite", "bonus": 4, "range": 5, "damage": "1d6+2", "damageType": "piercing" },
        { "name": "Dread Howl", "bonus": 3, "range": 25, "damage": "1d4+1", "damageType": "psychic", "ranged": true }
      ],
      "vulnerabilities": ["radiant"],
      "loot": { "gold": "1d6", "items": [{ "id": "potion_healing", "chance": 0.2 }] },
      "boss": false,
      "blurb": "Used by the AI DM when describing and narrating this creature."
    }
  ]
}
```

- `damage` supports dice expressions: `"1d6+2"`, `"2d8"`, `"4d4+4"`.
- `ranged: true` + `range` (in feet) lets the monster shoot from afar.
- `loot.gold` is a dice expression rolled on death; `loot.items` entries drop with `chance` 0–1.
- `boss: true` makes it count for `slay_boss` victories and draws a scarier map token.
- `vulnerabilities` doubles that damage type (e.g. skeletons take double bludgeoning).

## Items (`gear.json`)

```json
{
  "gear": [
    { "id": "wardens_shield", "name": "Warden's Shield", "type": "shield", "acBonus": 3,
      "desc": "+3 AC — a tower shield etched with warding runes." },
    { "id": "my_blade", "name": "Blade of Embers", "type": "magic_weapon", "base": "longsword",
      "magic": 1, "bonusDamage": { "dice": "1d4", "type": "fire" },
      "desc": "+1 longsword that adds 1d4 fire damage." },
    { "id": "my_potion", "name": "Draught of the Deep", "type": "potion", "heal": "6d4+6",
      "desc": "Bonus action: regain 6d4+6 HP." }
  ]
}
```

- `type: "shield"` — passive `acBonus` while carried.
- `type: "magic_weapon"` — `base` is any core weapon id; `magic` adds +N to attack and damage;
  optional `bonusDamage` adds elemental dice on every hit.
- `type: "potion"` — `heal` dice; usable with the Potion button or "drink a potion".

## Experimental brews & prize tokens (core systems)

Two random-outcome systems live in the engine rather than in content packs, so every pack's
world gets them for free:

- **`server/game/potions.js`**
  - `POTION_TIERS` — the three apothecary shelves (`thin` / `standard` / `fine`): price, the INT
    (Arcana) identification DC, and the good / mixed / bad weights.
  - `POTION_EFFECTS` — one row per outcome: `{ id, kind: 'good'|'mixed'|'bad', weight, name, desc,
    apply(ctx) }` where `ctx = { engine, state, char, p, events, roll, tier }`. Effects are built
    from buff ids the engine already reads (`longstrider`, `altar_blessed`, `blessed`,
    `brew_fortune`, `divine_favor`, the `poisoned` condition), plus `engine.adjustTempHp` for
    max-HP swings and `engine.blockRest` for a lost rest. Adding an outcome = adding one row.
  - `DELVE_TOKENS` — the gambling prizes (luck coin, talisman, slaying oil, incense, purge vial…).
    Each is `delveOnly`: it rides into one delve and is discarded when that delve ends.
- **`server/game/gambling.js`**
  - `ROULETTE_BETS`, `SICBO_BETS`, `SLOT_TIERS`, `GAMBLE_CURSES`. Each table splits into a pure
    evaluator (`evalRoulette`, `evalSicBo`, `evalSlots`) and a spinner that supplies randomness, so
    the odds are verifiable by exhaustive enumeration — `tests/unit/gambling-and-potions.test.mjs`
    does exactly that (roulette 36/37, sic bo 97.2%, slots 88.8% standard / 84.3% devil).
  - Edit a paytable and the unit suite reports what it did to the house edge.

## Forge, bestiary & the main story

Three core systems read the same content packs:

- **Forge** (`server/game/forge.js`) — any item your pack drops through the normal loot path
  (`affixes.rollMagicItem`) can be salvaged, rerolled or upgraded. Prices and essence yields live
  in `FORGE_COSTS` / `SALVAGE_ESSENCE` / `KILL_ESSENCE`. It rebuilds items through
  `affixes.buildAffixItem`, so a pack-authored affix (add one to `WEAPON_AFFIXES` or
  `ARMOR_AFFIXES`) automatically becomes a legal reroll target.
- **Bestiary** — every monster your pack defines is catalogued automatically from its statblock
  (traits, resistances, attacks, loot). Elite affix variants are tracked per species, so
  `MONSTER_AFFIXES` additions show up as new collection slots.
- **Main story** (`server/game/campaign.js`) — `ACTS` maps story beats onto map ids. A pack map
  is only part of the story if an act lists it; everything else stays a free-roam dungeon.

## Share with the community

- **Export & import** (in-game) works one-on-one: pack → JSON file → friend imports it.
- **Pull requests**: add your pack under `content/` and open a PR — good packs ship
  with the game for everyone.
- **Showcase issue**: opened something cool? Post it with the
  [content-pack template](https://github.com/Jianjun99/AI_DND5e/issues/new?template=content-pack.md)
  so players can find it.

## Testing & sharing

For a complete importable example, use [minimal-pack.json](tests/fixtures/content/minimal-pack.json).
It includes the bundle header (`format: "ai-dnd-pack"`, `version: 1`), manifest, map and custom item;
the map snippet above is a standalone map file, not an import bundle.

1. Home → Content Packs → Import, choose `minimal-pack.json`.
2. Create or select a hero and start **圣物练习室** (`first-relic-room`), without a companion.
3. Move east to `(3,2)` and optionally open the chest at `(3,1)` for the custom token.
4. Move to `(5,2)`, interact with the relic at `(6,2)`, then walk back to `(1,2)`.
5. The engine declares victory. Export **第一枚圣物**, delete the installed example pack, then import that exported file and repeat.

Automated checks run through **`npm run verify`**, using the dedicated Docker test environment.
The T8 suite loads all shipped content and completes this example through real HTTP actions twice.
It also tests bad inputs, cross-pack stairs, duplicates, rollback and legacy defaults.

For an author check without installing anything, send an import bundle to
`POST /api/content/validate` on your running game server. It returns 200 when valid and 400
when invalid. `GET /api/content/validate` reports all currently installed/shipped content.
The read-only CLI is `node scripts/check-content.mjs [bundle.json]` (omit the file to check the
installed registry); it starts no server/browser, writes nothing, and exits 1 on errors.
The automated suite exercises this CLI inside Docker too.

Diagnostics contain `severity`, `code`, `packId`, `packName`, `file`, `field` and `message`.
For example, `maps/my-dungeon.json` / `entities[2].to.mapId` identifies a broken staircase.
The existing `warnings` text array is retained for the home page and old API clients.

- **error**: invalid definition or missing reference; excluded from the registry. Imports are rejected before writing, so a failed update leaves the previous pack intact. Dependencies broken by replacing a pack also reject the update.
- **warning / duplicate-definition**: first registered definition wins. Diagnostics identify the winning pack and file. Core loads first, then shipped folders, then installed folders (each group sorted by folder name). Core `dire_wolf` remains effective over howling-hills' duplicate; neither definition nor balance is deleted to hide the warning.
- **warning / unreachable**: geometry appears disconnected. The check assumes doors can open, destructible obstacles can be removed and monsters defeated. It ignores combat difficulty, locks, NPC occupancy and possible future scripted connections; this hint does not reject an import.

Every pack registers before cross-pack references are resolved. Invalid dependencies are then
removed transitively. A requested unknown map fails explicitly instead of falling back to crypt;
omitting the map selection still uses the normal default. An import replaces the complete installed
pack, including removal of obsolete files; it cannot replace a shipped/core pack. Duplicate IDs
inside one import bundle are errors because they would make written files ambiguous.

Compatibility defaults: missing width/height are inferred from rows; missing entities/npcs become
empty collections; legacy `victoryTile` and missing `victory.type` use `fetch_relic`; a chest with no
loot uses `{}`. Unknown author fields are preserved. Explicit zero/invalid dimensions are errors,
not missing defaults. Dice expressions require positive integer count/sides (`2d6+1`, whitespace
allowed); critical numbers must be finite, loot quantities positive integers and chances 0–1.
Shape validation does not promise an exhaustive gameplay or balance proof.

- **Test locally:** restart the container (or `npm start`) after editing files in `content/` — the
  home page shows pack warnings if anything's malformed.
- **Share:** Home → Content Packs → **Export** gives you one JSON file. Anyone can import it from
  the same page — no server, no setup.
- **Contribute:** fork the repo, add your pack under `content/your-pack/`, and open a pull request.
  If it loads clean and plays fair, it ships with the game for everyone.

## Small remembered encounters (T6)

The complete shipped example is [vale-gate.json](content/howling-hills/maps/vale-gate.json),
with `vale_seal` in the same pack's `gear.json`. Choose **山谷哨门** from the adventure
destination list. It is an optional adventure, outside the main campaign.

A map may have a `scenes` array. Each scene needs `id`, `name`, `prompt`, `npcId`,
`doorId`, non-empty `guardIds`, and at least two `choices`. The NPC, door and guard
IDs refer to entities on that map. Scene IDs, NPCs, doors and guards cannot be shared
between scenes. A choice requires `id`, `label`, `fact`, `response`, `memory`, and `effect`:

```json
{
  "id": "show_seal", "label": "交回通行印，和平通过",
  "condition": { "type": "has_item", "itemId": "vale_seal" },
  "effect": { "type": "passage", "consumeItem": "vale_seal" },
  "fact": "returned_seal", "response": "守卫收下通行印，打开哨门。",
  "memory": "我记得你交回了通行印，让大家平安通过。"
}
```

- Conditions are `always` (also the default when omitted), or `has_item` with a registered item ID. Availability uses the hero's actual inventory and proximity to the NPC; it is rechecked at execution.
- Effects are `passage` or `combat`. `passage` opens the designated door and has the guards leave without XP or loot. Its optional `consumeItem` must match the `has_item` condition and consumes one item. `combat` opens the door and starts the existing combat engine; its fact is recorded only after all designated guards are dead or have fled.
- Include both a passage choice and an `always` combat choice, so a missing credential leaves a playable route. Unsupported condition/effect fields, scripts, missing references and mismatched consumption fail T8 validation before import writes files.
- The scene door cannot be picked/forced while a choice is pending. Failed combat/respawn resets the attempt; a completed passage and its one-time fact survive respawn. Choices in a new adventure are fresh, while the NPC can remember the previous adventure.
- The engine records `fact`, `response` and `memory` from the chosen definition. AI receives current choices and confirmed memory as context; it does not execute content effects. Fixed responses work with AI disabled, timed out or returning invalid structured text.
- Quest items (`type: "quest"`) cannot be purchased through the generic city buy endpoint. The example credential is found in a real chest.

`GET /api/game/:id` exposes `state.scenes` with phase, choices, availability/reason,
outcome and memory; it omits raw author effects from `state.map`. Send
`{ "type": "sceneChoice", "sceneId": "keeper_gate", "choiceId": "show_seal" }`
to the normal action endpoint. Repeated/completed choices do not repeat consumption,
combat rewards or facts. The browser renders these server choices without copying rules.
This is a finite gate encounter protocol, not a general scripting or free-text intent language.

## Finite branching stories (T11)

The shipped [Missing Courier choice table](content/missing-courier/STORY.md) and
[courier-crossing.json](content/missing-courier/maps/courier-crossing.json) demonstrate
one map, two NPCs and three sequential decisions. This is an extension of scenes,
not a script interpreter. Old passage/combat encounters keep their original contract.

- Add map `story: {id, name, localized?}` and `victory: {type: "story", sceneId, campfire}`.
  A real campfire is still required. The engine grants its existing victory reward only
  after the final scene has a confirmed ending and the player stands at camp. Evidence,
  cleared enemies and returning early cannot impersonate an ending.
- A `kind: "story"` scene can name `requiresScene`, which must reference an earlier
  scene on this map. It checks this save's resolved instance; roster history cannot
  unlock a fresh adventure. Scene IDs remain map-scoped; story ID is the stable namespace
  for remembered reactions. Only story scenes may reuse a named NPC.
- Story decisions without a door use `guardIds: []`; gate scenes still need a real
  door, distinct guards, a passage route and an unconditional combat fallback.
  A short bilingual `objective` gives the next public step; `prompt` is dialogue shown
  only after the scene is discovered. Do not put secret evidence in the public objective.
- `decision` resolves immediately. `passage` and `combat` retain T6 behavior. A story
  noncombat effect may use `costGold` (nonnegative integer), `consumeItem` (one item,
  matching its `has_item` condition), or `giveItem` (one registered item).
  Combat uses existing combat rewards only; it accepts no extra resource writes.
- `check` uses an existing `skill`, integer `dc`, optional `failureGold`, and a mandatory
  authored `failure: {fact, response, memory, reactions?, ending?, localized?}` on the
  choice. The engine's skill check applies real buffs/rerolls. Both outcomes resolve
  the scene; failure can charge the stated fallback fee and continues the story.
  Availability requires enough gold for the worst-case cost before any roll or consumption.
- Each choice retains `fact`, `label`, `response`, `memory` and bilingual text. It may
  add `reactions: {npcId: {text, localized?}}` for map NPCs who know that confirmed event.
  The final scene must give every outcome an `ending` ID and offer at least two distinct
  endings. Alternative outcome text is never a client payload or model instruction.
- T8 rejects forward/cyclic prerequisites, missing item/NPC/ending references, unsupported
  skills, invalid costs, missing failed-check outcomes and arbitrary effect/failure writes
  before installation. Import/export keeps the authored bundle unchanged.

Engine-created facts keep the established `saveId:mapId:sceneId` identity and add optional
story metadata, selected text descriptors, actual cost/items/check and confirmed NPC
reactions. Settlement unions them into the owning character and stores an immutable
`receipt.story` summary. Duplicate receipts can heal missing facts without repeating
charges or rewards. Current scenes start fresh in a new delve; past endings remain
readable on the character sheet and in NPC reactions. These optional JSON fields need
no destructive save migration or schema version bump.

## Companion stories (T12a)

The shipped [Bram's pack choice table](content/brams-pack/STORY.md) and
[brams-pack.json](content/brams-pack/maps/brams-pack.json) extend the finite story
protocol to a real companion. This is not a companion system rewrite: the loyalty
kill-quests (`char.companionQuests`) keep their own namespace, and a companion story
adds exactly three authoring fields plus one effect field.

- `story.companion: "bram"` names the ally this story needs. The start endpoint
  refuses to run the map without that exact companion in the party (bilingual
  error; the prepare screen shows a "requires companion" chip and gates the
  descent button). Nothing is auto-recruited, charged or loyalty-gated.
- A story scene may use `companion: true` instead of `npcId`: its speaker resolves
  to the real ally entity, never a lookalike map NPC, and its memory/reactions are
  keyed by the companion ID. Reactions may additionally use the companion ID as a
  key (map NPC keys keep working; other allies are rejected).
- A choice effect (and a check's `failure`) may carry an integer `loyalty` in
  -25..25. The engine applies it to the real ally entity through the standard
  morale system exactly once per resolved scene and records `loyaltyDelta` on the
  fact; duplicates and duplicate settlements never re-apply it. The existing
  victorious-delve bonus and morale quips keep working on top.
- Re-entering the story with the same companion opens on the remembered ending:
  the confirmed reaction text becomes a greeting event and the scene memory shows
  the past attitude. Memory never unlocks fresh stages; `requiresScene` still reads
  only this save. A downed companion blocks their own scene with a stated reason
  until camp recovery or retreat; retreat settles the earned attitude truthfully.

## GLB visual packs (V1 second stage)

Visuals are cosmetic. They never replace monster/class IDs, statblocks, movement,
damage, drops or save schema. Home → **Models & appearances** previews the original
CC0 [Visual Starter](content/visual-starter/visuals.json) hero and skeleton; both
are opt-in. Choose a hero appearance or bind a monster by its registered stable ID,
then reopen the delve. Companions and NPCs keep procedural models.

Old `ai-dnd-pack` version 1 imports/exports remain valid. A pack with visuals uses
bundle **version 2**, with ordinary `pack/maps/monsters/gear` fields plus:

```json
{
  "visuals": {
    "version": 1,
    "models": [{
      "id": "my-hero", "name": "My Hero", "role": "hero",
      "file": "assets/hero.glb", "scale": 1, "yaw": 0,
      "clips": {"idle": "Idle", "walk": "Walk", "attack": "Attack"}
    }],
    "bindings": {"monsters": {}}
  },
  "assets": {"assets/hero.glb": "CANONICAL_BASE64_OF_THE_COMPLETE_GLB"}
}
```

The complete importable [visual-pack.json](tests/fixtures/content/visual-pack.json)
contains real binaries. `scripts/build-visual-sample.mjs` deterministically rebuilds
the original samples; it changes no rules. Folder packs use `visuals.json` and the
declared `assets/*.glb` files. Model IDs must be globally unique; `role` is `hero`
or `monster`; optional authored `bindings.monsters` maps existing monster IDs to
this pack's monster models. Explicit UI selection of **Default procedural model**
overrides that authored binding. `scale` is 0.05–4; `yaw` is degrees -180–180.

Only documented manifest fields are accepted. `idle` must map to a real named
clip. Optional `walk/attack/hit/death/cast` mappings, when provided, must exist;
omitted clips safely use idle. Clips and their skeleton ship in the same GLB.
Automatic retargeting and standalone arbitrary animation files are unsupported.

The initial finite glTF subset is GLB 2 with one embedded BIN buffer, triangle
meshes, POSITION/NORMAL/TEXCOORD_0/JOINTS_0/WEIGHTS_0, optional skins and named
LINEAR/STEP transform animations. Skins use float weights and unsigned byte/short
joints. No external/data URIs, glTF extensions, compression or morph targets.
Textures, if present, are embedded 8-bit RGB/RGBA non-interlaced PNG, validated for
dimensions, CRC, decompressed size and row filters. Files use exactly
`assets/[a-z0-9_-]+.glb`; no directories, URLs or undeclared resources.

Budgets: 16 models/pack; 2 MiB/file and 8 MiB binaries/pack; 256 KiB GLB JSON;
128 nodes, 50,000 vertices, 150,000 indices, 64 joints/skin, 16 clips and 10,000
animation time keys/file. Each clip lasts at most 30 seconds; texture side ≤1024
and total texture pixels ≤4,194,304/file. Import requests are capped at 12 MiB.
An empty or non-finite loaded scene, or display extent exceeding 12 world units
after scaling, falls back rather than attaching to the board.
Oversized, invalid or undeclared assets fail T8 validation before writing. Staged
binaries are rechecked before the existing atomic rename/rollback transaction.

Exports retain version 2, authored manifest and every binary byte. Missing or
corrupt visual resources produce an explicit export failure, including unreadable
`visuals.json`; they never silently become a version 1 export. Resource URLs are
server-projected model endpoints with SHA-256, no-store and declared-path checks.

External cosmetic preferences live in `data/visual-settings.json`, outside heroes
and saves; the existing save backup does not include content packs or this file.
Export/share the resource pack separately. Disabling or deleting a visual pack
preserves preferences and old saves, which use procedural fallback. Reimporting
the same stable model IDs restores available choices; new preferences apply when
the player next opens an adventure. Model loading failure also falls back in-place.

Shared model resources are reference counted; cloned bones and AnimationMixer are
private to each instance. Leaving the view releases pending leases, mixers, bone
textures and owned geometry/material/texture resources. Late responses cannot attach.
Dependencies already allocated by a rejected parse are also released. Authored GLB
node extras remain in complete exports; runtime clones ignore node metadata so only
renderer anchors provide tile/entity hit identity.
Confirmed action replies carry optional `visualEvents` with stable event IDs; reads
and polling never replay actions. Damage/HP apply immediately. Dead GLB monsters
leave the selectable board immediately and may display their death clip for up to
1.1 seconds in a separate non-interactive layer before disposal.

## Natural Language Action Matching (T13a)

Content authored in packs seamlessly participates in the T13a bounded natural language system:
- **Scene Choices**: Natural player expressions map to scene choices by comparing against `choice.id`, `choice.label`, and bilingual `choice.localized.{lang}.label`. Authored choices requiring items (e.g. `{ type: "has_item", itemId: "potion_healing" }`) or costs are authoritatively checked on mapping.
- **NPC Dialogue**: Expressions like "talk to <name>" / "和<name>交谈" match map NPCs within distance <= 4.
- **Item Usage**: "use <item>" / "使用/喝<item>" matches items in the hero's inventory by `itemId` or `item.name`.
- **Combat**: "attack <monster>" / "攻击<monster>" matches visible enemies by `monster.id` or `monster.name`. Ambiguity across multiple same-named foes automatically presents clarification cards.

## Adventure Authoring Studio (T15a)

The in-game **Author Studio** (`#/author`, accessible from the Content Packs section on the home page) allows anyone to author custom two-chapter branching adventures without editing raw JSON files:

### 1. Starter Template Cloning (`cloneStarterTemplate`)
- **One-Click Fork**: Fork the official starter adventure (`missing-courier`) into an isolated namespace (`custom_<slug>`).
- **Recursive Remapping**: target namespace is `custom_<slug>`; maps become `custom_<slug>_ch1` / `_ch2`, story IDs `custom_<slug>_story_ch1` / `_story_ch2`, and every pack-owned gear ID is namespaced (`custom_<slug>_courier_ledger`). Every place the schema can hold an item reference is rewritten together - `condition.itemId`, `effect.giveItem`, `effect.consumeItem` and `entities[].loot.items[].id` - as is the cross-chapter `requiresHistory.storyId`, so chapter 2 binds to the clone's own chapter 1.
- **Collision Prevention**: Checks against core content, installed packs, and existing drafts.
- **Semantic ID Preservation**: Standard rules references (`campfire`, `player`, `potion_healing`, `bandit`) remain intact.

### 2. Visual NPC & Dialogue Editing
- **Pack Manifest**: Edit adventure title, author byline, description, and version.
- **Chapter Tabs**: Edit each chapter's scenes, NPC persona, dialogue lines, and choices in both Chinese and English (the two language columns edit one node's `localized` buckets; fixed interface text always follows the selected language).
- **Choice mechanics without JSON**: the per-choice panel writes the fields the schema already allows — effect kind (`decision` / `check` / `passage` / `combat`), `skill`, `dc`, `costGold`, `failureGold`, `giveItem`, `consumeItem` plus its matching `has_item` condition, `condition` kind (`always` / `has_item` / `history_ending`) with its item or ending, the choice `ending` ID, and the failure branch's `response` / `memory` / `ending`. There is no scripting surface, and a field only writes where the schema accepts it (a check-only field never lands on a decision or passage choice).

### 3. Draft Tolerance & Validation
- **Safe Draft Storage**: Drafts are stored in `data/drafts/<draftId>.json`. The draft ID is a stable path segment: it must match `[a-z0-9_-]+` and resolve inside the drafts directory, so no encoded separator or traversal can reach another file.
- **Identity**: the filename is authoritative — a draft whose `pack.id` differs is reported as `draft-id-mismatch` and cannot be exported, installed or playtested.
- **Error Tolerance**: Incomplete drafts with missing fields or invalid DCs can be saved without data loss (tolerance applies only inside a legal draft path).
- **Live Diagnostics**: The T8 validation engine provides real-time error banners and diagnostics drawers, preventing invalid drafts from being installed or exported.

### 4. Isolated Sandbox Playtesting
- **Session Zero**: Launch a temporary isolated playtest directly from the editor (`POST /api/content/drafts/:id/playtest`).
- **Zero Contamination**: the server mints the playtest identity (a dedicated hero owned by that draft) and ignores any client-supplied flag; unpublished draft content travels as a snapshot on the save instead of entering the shared registry, so it survives refresh and restart.
- **Settlement**: only a run that actually ended (victory, retreat or fall) settles, and its receipt and story facts land on the draft's own playtest hero - formal heroes, ledgers and roster history are untouched. Chapter 2 of that draft then opens on the ending the playtest really reached.
- **Smooth Return**: the top banner's exit link releases the run on the server and returns to `#/author?draft=<id>`; leaving twice, refreshing, or deleting the draft only cleans up resources that belong to it.

### 5. Export & Install
- **Export Bundle**: Download a standalone distribution JSON file (`/api/content/drafts/:id/export`). Export first saves the snapshot currently on screen and re-validates it server-side, so a stale draft can never be downloaded pretending to be the current work; if it fails, the editor keeps the scene as it was and stays put.
- **Install to Game**: One-click install to `data/content/<id>/`, instantly making the adventure playable from the home screen and travel map.

### 6. Small Grid Map Authoring (T15b)
- **25×15 Grid Matrix**: Visual interactive grid editor for chapter maps with desktop-first viewport.
- **Palette Tools**:
  - `Wall` (`#`), `Floor` (`.`), `Door` (`D`): Click or drag to paint tiles.
  - `Player Start` (`🚶`): Re-anchor the delve entry floor tile.
  - `Campfire` (`🔥`): Reposition the victory campfire floor tile.
  - `Entity Selector`: Select existing NPCs (e.g. Iris), monsters, chests, or stairs and place them on valid floor coordinates.
  - `Select` & `Erase`: Inspect cells or clear non-critical tiles.
- **Conservative Reachability Pre-check**:
  - Live BFS evaluates traversal from `playerStart`.
  - Immediate visual badges report if the campfire, exit stairs, or critical NPCs are blocked by solid walls.
  - Prevents painting walls directly onto `playerStart` or `victory.campfire`.
- **Entity & Scene Dependency Protection**:
  - Moving entities updates coordinates `(x, y)` without changing their unique `id`.
  - Scene definitions referencing `scene.npcId` or doors stay intact.
  - Moving a door entity also moves its `D` glyph (the old tile reverts to floor in the same edit, and
    undo/redo restores tile and entity together), so an authored map can never export a door whose grid
    contradicts its entity.
  - Wall, floor and erase brushes refuse to destroy an entity that a scene references through
    `npcId`, `doorId` or `guardIds`, and say so in the current language; `playerStart` and the
    victory campfire tiles are likewise protected.
- **Targeted Isolated Playtest**:
  - "Playtest this map" button launches directly into the selected chapter map (`api.playtestDraft(draftId, { mapId })`) with a sandboxed hero.

## Current limitations

- Validated installed maps appear in the shared town/preparation directory. Optional
  finite `adventure` metadata adds regional waypoints/roads; a map without it still
  has its list entry. Small grid maps (25×15) can be edited in the Author Studio; dynamic map
  resizing and online multi-user sharing remain separate work.
- Packs add maps, monsters, and items — not species/classes yet.
- Map-to-map travel already works through `stairs` entities with a `to` destination; see the core crypt and drowned-vault maps for real examples.
- The game has 2D tokens, procedural 3D miniatures and the finite GLB visual-pack
  subset above. Automatic retargeting, arbitrary extensions and companion/NPC
  replacement are outside V1's initial scope.
- Scenes support the finite gate, branching-story, and natural-language-mapped choices documented
  above. Other NPC effects, relationship simulation and unrestricted arbitrary JS actions
  are strictly rejected by the bounded validator. See [tasks/README.md](tasks/README.md).

