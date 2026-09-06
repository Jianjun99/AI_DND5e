# 🏗 ARCHITECTURE — how AI Dungeon works (for developers)

A one-page tour of the system: what runs where, why the engine is the referee, and how the
LLM, the content packs and the retrieval layer fit together.

## 1. The big picture

One Node.js process serves everything. There is no cloud: the game state lives in local JSON
files, and every AI feature talks to *whatever* OpenAI-compatible endpoint the player configures.

```mermaid
flowchart LR
    subgraph Browser["Browser (vanilla JS SPA)"]
        UI["Views: home / creator / play / settings"]
        CV["Canvas map renderer<br/>(fog of war, tokens)"]
        SFX["Web Audio SFX<br/>Speech-synthesis voice"]
    end
    subgraph Server["Node.js + Express (the referee)"]
        API["REST API<br/>/api/game · /api/characters<br/>/api/content · /api/settings"]
        ENG["Game engine<br/>dice · combat · movement · XP<br/>death saves · quests"]
        REG["Content registry<br/>core + content packs"]
        DM["DM layer<br/>narration · NPC chat · referee"]
        RET["retrieval.js<br/>keyword RAG over game lore"]
        DB[("JSON store<br/>data/*.json")]
        POR["portraits.js<br/>provider chain + cache"]
    end
    subgraph AI["LLM providers (player-configured)"]
        G["Google AI Studio<br/>(text + image models)"]
        O["Ollama / LM Studio<br/>/ llama.cpp (local)"]
    end
    UI --> API
    CV -. reads state .-> API
    API --> ENG
    ENG --> REG
    ENG --> DB
    API --> DM
    DM --> RET
    DM --> G
    DM --> O
    DM -. fallback: canned text .-> API
    API --> POR
    POR --> G
    POR --> DB
```

**The core rule: the engine decides, the LLM describes.** Dice, damage, XP, loot — all resolved
deterministically by `server/game/engine.js`. The LLM only receives *resolved outcomes* and writes
prose. If the LLM is off, slow, rate-limited or hallucinating, the game keeps working from baked-in
text. That is why the game is 100% playable offline and the AI can never cheat.

## 2. One player action, end to end

```mermaid
sequenceDiagram
    participant B as Browser
    participant R as Express route
    participant E as Engine (referee)
    participant L as LLM (optional)
    B->>R: POST /api/game/:id/action {attack}
    R->>E: playerAttack(state, target)
    E->>E: d20 + mods vs AC, damage, loot, XP, quests
    E-->>R: events[] (mechanical outcomes + canned text)
    R->>L: "Narrate these outcomes" (only if enabled)
    L-->>R: 2-4 sentences of prose (or timeout → canned)
    R->>R: append log, autosave state to JSON
    R-->>B: { state, events } → canvas + HUD re-render
```

Every action (move, attack, cast, interact, freeform text) flows through the same dispatch. The
referee (`server/game/referee.js`) maps freeform player text onto *real* mechanics — "I listen at
the door" becomes a Perception check — and the retrieval layer feeds the DM real lore so flavor
text can't contradict the world.

## 3. Content packs (the mod system)

```mermaid
flowchart TB
    subgraph Core["shared/ (core game)"]
        M1["maps/crypt.json"]
        MO1["monsters.json"]
        GE1["equipment.json"]
    end
    subgraph Packs["content/* (shipped) + data/content/* (installed)"]
        P["pack.json + maps/ + monsters.json + gear.json"]
    end
    REG2["content.js registry<br/>validate + merge (core wins on ID clash)"]
    subgraph Consumers
        E2["engine: getMap / getMonster / getGear"]
        R2["/api/content: list, import, export"]
        R3["retrieval: lore index for the DM"]
    end
    Core --> REG2
    Packs --> REG2
    REG2 --> E2
    REG2 --> R2
    REG2 --> R3
```

A pack is a folder of JSON. Validation warnings surface on the home page; a broken pack can't
crash the game. Sharing = export one JSON file, friend imports it in the UI. Community
contributions arrive as pull requests adding `content/<pack>/`.

## 4. World state (multi-map delves)

```mermaid
flowchart LR
    subgraph Save["save file (per delve)"]
        CH["character: HP, slots, quests, journal"]
        W["world: snapshot per visited map<br/>monsters (hp/position), chests, doors, fog"]
        CUR["current mapId"]
    end
    S["stairs entity<br/>{ to: mapId, x, y }"] --> T["travelTo()"]
    T --> SN["snapshot current map → world"]
    T --> LO["load destination from world<br/>(or generate fresh)"]
    T --> MV["move hero + ally to arrival tile"]
```

Camps are the safe zones: campfire (long rest / journal / side quests), a trader (Marla topside,
Perra in the vault) and the stairs home. Death triggers 5e death saving throws; failing three
rolls sends the hero back to camp at half HP with the world reset — progress (looted chests,
XP, journal) is never lost.

## 5. Tech stack at a glance

| Layer | Choice | Why |
|---|---|---|
| Server | Node.js 20 + Express | one language, tiny image, no build step |
| Frontend | Vanilla ES modules + Canvas | zero framework weight, offline-friendly |
| Game state | JSON files (Docker volume) | human-readable saves, no DB to run |
| Rules data | JSON (`shared/`) | D&D 2024 content is data, not code |
| AI text | OpenAI-compatible endpoint (Google / Ollama / LM Studio / llama.cpp) | player's choice, free tiers work |
| AI images | Google image models → SD WebUI → procedural SVG | provider chain, always renders |
| Sound / voice | Web Audio + SpeechSynthesis | synthesized, zero assets |
| Retrieval | term-overlap index (`retrieval.js`) | grounding without a vector DB |
| Packaging | Docker (node:20-alpine) + GitHub Actions → GHCR | one-command play |

## 6. Repo map

```
server/
  game/engine.js      the referee: dice, combat, movement, fog, XP, death saves
  game/referee.js     freeform text → real skill checks
  game/dm.js          LLM narration, NPC role-play, quest hooks, recaps
  game/content.js     content registry (core + packs)
  game/retrieval.js   keyword RAG
  portraits.js        portrait provider chain + cache
  routes/             characters · game actions · settings · content · data
shared/               D&D 2024 rules + maps as JSON
content/              shipped content packs (community PRs welcome)
public/               SPA frontend (views, canvas renderer, sfx, tts)
scripts/              smoke-test (CI) · balance-sim (tuning harness)
```

Performance notes: state is a single in-memory object persisted as JSON on every action
(synchronous, small); the map is one Canvas redraw per action; the only loop is a 4-second
state poll while a delve is open. A delve runs comfortably on a Raspberry Pi.
