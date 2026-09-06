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
  "blurb": "Shown in the map picker.",
  "objectiveText": "What the player is trying to do here.",
  "width": 28, "height": 18,
  "playerStart": { "x": 3, "y": 14 },
  "victory": {
    "type": "slay_boss",
    "campfire": { "x": 23, "y": 13 }
  },
  "rooms": [
    { "id": "hall", "name": "The Hall", "rect": [1, 7, 26, 9],
      "desc": "Shown the first time the player enters this area — the AI DM also uses it for narration." }
  ],
  "rows": [
    "############################",
    "#..........................#",
    "############################"
  ],
  "entities": [
    { "type": "monster", "kind": "goblin", "id": "md_gob1", "x": 5, "y": 2 },
    { "type": "chest", "id": "md_chest1", "name": "Old Chest", "x": 25, "y": 1, "icon": "🧰",
      "loot": { "gold": 30, "potions": 1, "items": [{ "id": "flame_dagger", "qty": 1 }] } },
    { "type": "npc", "id": "my_npc", "name": "The Hermit", "x": 3, "y": 12, "icon": "🧙" },
    { "type": "object", "id": "campfire", "name": "Campfire", "x": 23, "y": 13, "icon": "🔥" },
    { "type": "trap", "id": "md_trap1", "name": "Pit Trap", "x": 12, "y": 8, "dc": 13, "save": "dex", "damage": "1d6", "damageType": "piercing" },
    { "type": "door", "id": "md_door1", "name": "Iron Door", "x": 10, "y": 5, "locked": true, "lockDc": 13, "forceDc": 15 }
  ],
  "npcs": {
    "my_npc": {
      "persona": "You are a hermit who... (the AI DM role-plays this character with this personality)",
      "knowledge": "What this NPC knows and may reveal.",
      "canned": ["Fallback line when no LLM is connected."]
    }
  }
}
```

**Rules to follow**

- Every row string must be exactly `width` characters long.
- The first and last rows/columns should be walls so the player can't walk off the map.
- `playerStart` and `victory.campfire` must be floor tiles.
- `victory.type` is either:
  - `"fetch_relic"` — player must grab the `relic` object and return to the campfire (core crypt style), or
  - `"slay_boss"` — player must kill every monster with `"boss": true`, then return to the campfire.
- Monster `kind` can be any core monster (`giant_rat`, `skeleton`, `goblin`, `zombie`, `cultist`, `ogre`)
  or a monster from your own pack (see below).
- Chest `loot.items` can reference core items (`potion_healing`, `potion_greater`, `silver_sword`,
  `flame_dagger`, `cloak_protection`, `amulet_of_vigor`, ...) or your pack's `gear.json` items.
- NPC `id`s referenced by entities must have a matching entry in the map's `npcs`.

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

## Testing & sharing

- **Test locally:** restart the container (or `npm start`) after editing files in `content/` — the
  home page shows pack warnings if anything's malformed.
- **Share:** Home → Content Packs → **Export** gives you one JSON file. Anyone can import it from
  the same page — no server, no setup.
- **Contribute:** fork the repo, add your pack under `content/your-pack/`, and open a pull request.
  If it loads clean and plays fair, it ships with the game for everyone.

## Current limitations

- Packs add maps, monsters, and items — not species/classes yet.
- Two pack maps per delve is the norm, but there's no in-game travel *between* maps yet.
- Map tokens use emoji based on monster type; custom art is on the roadmap.
