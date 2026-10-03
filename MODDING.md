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
`D` = door (blocks sight and movement until opened).

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

## Current limitations

- Packs add maps, monsters, and items — not species/classes yet.
- Map-to-map travel already works through `stairs` entities with a `to` destination; see the core crypt and drowned-vault maps for real examples.
- The game has 2D tokens and procedural 3D miniatures. Packs do not currently define their own arbitrary 3D model pipeline.
- Scenes currently support the two gate effects and two conditions described above. Other NPC effects, relationship simulation and unrestricted AI action interpretation need separate implementation and validation. See [tasks/README.md](tasks/README.md).
