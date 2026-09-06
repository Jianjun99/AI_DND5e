# 🐉 AI Dungeon — a solo D&D 2024 game with a local LLM Dungeon Master

[![CI](https://github.com/Jianjun99/AI_DND5e/actions/workflows/ci.yml/badge.svg)](https://github.com/Jianjun99/AI_DND5e/actions/workflows/ci.yml)
[![Docker image](https://github.com/Jianjun99/AI_DND5e/actions/workflows/docker-publish.yml/badge.svg)](https://github.com/Jianjun99/AI_DND5e/pkgs/container/ai_dnd5e)

A self-contained, offline-capable D&D (2024 rules) dungeon crawler that runs on your own computer.
Create a hero, delve into **The Sunless Crypt** with grid-based tactical combat, and — optionally —
plug in your own local LLM (Ollama, LM Studio, …) to give the Dungeon Master a living voice that
narrates every scene and lets you actually *talk* with NPCs.

Packaged for Docker, so anyone can download it and play offline.

---

## Quick start (Docker)

**Easiest — pull the ready-made image** (published automatically by GitHub Actions):

```bash
docker run -d --name ai-dnd -p 3000:3000 -v ai-dnd-data:/app/data ghcr.io/jianjun99/ai_dnd5e:latest
```

**Or build it yourself** from this repository:

```bash
# 1. Build the image
docker build -t ai-dnd .

# 2. Run it (characters & saves persist in a volume)
docker run -d --name ai-dnd -p 3000:3000 -v ai-dnd-data:/app/data ai-dnd

# 3. Play
#    Open http://localhost:3000 in your browser
```

Or with docker compose (recommended — includes the Linux `host-gateway` mapping):

```bash
docker compose up -d --build
```

Then open **http://localhost:3000**. That's it — no internet needed to play.

### Why Docker?
The image bundles the entire game (server + web UI + all rules content). Anyone can download the
folder (or the image), run one command, and play. Your characters, saves, and DM settings live in
the `ai-dnd-data` volume, so they survive restarts and upgrades.

## Playing without Docker (development)

```bash
npm install
npm start          # → http://localhost:3000
```

Requires Node.js 20+.

---

## The game

| | |
|---|---|
| **Adventure** | *The Sunless Crypt* — one hand-crafted dungeon: entrance camp, Bone Hall, forgotten alcove, flooded rat nest, goblin den, and the ogre-guarded Sanctum. Steal the Relic and escape to your campfire to win. |
| **Rules** | D&D 2024 ("5e newest"): 10 species, 12 classes with level-1–2 features, 16 backgrounds with origin feats, ability scores (standard array / 4d6 drop lowest / point buy), skills, fighting styles, eldritch invocations, ~30 spells, rests, XP and level-ups to 3. |
| **Combat** | Turn-based on a 5-ft grid with fog of war and line of sight: initiative, attack rolls vs AC, crits, advantage/disadvantage, Sneak Attack, spell attacks and saves, concentration, death saving throws, traps, doors, chests, and a boss. |
| **Subclasses & loot** | Every class gains a subclass at level 3 (Battle Master, Assassin-style Thief, Draconic Bloodline…). Monsters drop gold and chance-based loot; chests hide magic gear with real effects. Synthesized sound effects and an optional AI-DM voice-over are built in. |
| **Companion** | Bram the Scout can join you as an AI-controlled ally (recommended for solo balance). |
| **Death** | Fall, and you wake at camp at half HP with the monsters back at their posts — the delve continues. |

### The AI Dungeon Master (optional)

The game engine always resolves mechanics deterministically — the LLM **only narrates what the
engine decided**, so it can't cheat or break the game. Three uses:

1. **Scene & action narration** — every room you enter, hit, miss, crit, and loot gets vivid prose.
2. **NPC dialogue** — talk with Bram the scout, the dying tomb-robber Morthek, or bargain with the
   goblin chief Griznak in free text.
3. **Freeform actions** — type anything ("I listen at the door", "I hide in the shadows", "I try to
   scare the goblin into leaving") and the referee maps it to real skill checks and mechanics.

Without an LLM the game is fully playable with built-in text.

### Connecting your local (or cloud) LLM

Open **DM Settings** in the app. Pick a preset, save, and hit **Test Connection**:

| Server | Base URL | Notes |
|---|---|---|
| Google AI Studio | `https://generativelanguage.googleapis.com/v1beta/openai` | Free API key from [aistudio.google.com](https://aistudio.google.com) — no GPU needed, very fast (e.g. `gemini-3.5-flash-lite`) |
| Ollama | `http://host.docker.internal:11434/v1` | `ollama pull llama3.1:8b` first |
| LM Studio | `http://host.docker.internal:1234/v1` | start the local server in the Developer tab |
| llama.cpp | `http://host.docker.internal:8080/v1` | run `llama-server --host 0.0.0.0` |
| Any OpenAI-compatible | your URL | works with anything exposing `/v1/chat/completions` |

> Running without Docker? Use `http://localhost:11434/v1` etc. instead.
> On Linux, the included `docker-compose.yml` adds `host.docker.internal:host-gateway` for you.
> Free-tier cloud models occasionally return 429/503 — the game retries once and falls back to built-in text, so play never blocks.

Any model works; small 7–8B models are great for narration and fast. When the AI DM writes, the log
shows its prose (serif font, gold bar); dice results appear underneath.

---

## Project layout

```
├── server/            Node.js + Express API (the referee)
│   ├── game/engine.js     dice, character math, combat, movement, fog of war, XP
│   ├── game/referee.js    freeform text → real skill checks
│   ├── game/dm.js         LLM narration & NPC role-play (with offline fallback)
│   └── routes/            characters, game actions, settings
├── shared/            D&D 2024 content: species, classes, backgrounds, equipment,
│                      spells, monsters, and the crypt map
├── public/            vanilla-JS single-page frontend (canvas map renderer)
├── scripts/           smoke-test used by CI (health → character → delve → combat)
├── .github/workflows  CI smoke test + automatic Docker image publishing to ghcr.io
├── Dockerfile         node:20-alpine, non-root, healthcheck
└── docker-compose.yml volume + host.docker.internal wiring
```

Data (characters, saves, DM settings) is stored as JSON under `/app/data` in the container —
mount it (or use the compose volume) to keep your progress.

## Troubleshooting

- **"Could not reach the model" in DM Settings** — make sure your LLM server is running on the
  host, and that the model name matches (`ollama list` to see pulled models).
- **Port 3000 busy** — change the left side of the port mapping, e.g. `-p 8080:3000`.
- **Reset the world** — `docker volume rm ai-dnd-data` (deletes all heroes and saves).
