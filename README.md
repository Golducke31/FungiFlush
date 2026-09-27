# 🍄 FungiFlush

**A roguelite deckbuilder about mushrooms** — where **Substrate** is your base score and **Spores** is your multiplier.

FungiFlush is a Balatro-style deckbuilder with a mycology theme. You build a deck of
fungal specimens, slot passive **Jokers**, and survive 8 **Antes** of escalating
**Blinds** (the "enemies"). The twist: cards and Jokers are *data-driven* and *react*
to game events through a deterministic **Trigger Engine**.

> **Design principle (from day one):** the logic engine is pure, decoupled, and
> testable in the console **without any rendering**. Three.js and the DOM HUD are
> separate observer layers that *watch* the engine. If the render is pretty but the
> engine is a mess, the game does not work.

---

## ✨ Features

- **Pure logic engine** in `src/engine/**` — zero Three.js imports, runs in Node, console, or tests.
- **Deterministic, seeded RNG** (`mulberry32`) → reproducible runs, saves, and 100k+ simulations.
- **Event-driven Trigger Engine** with hard anti-infinite-loop brakes (see below).
- **Data-driven content**: cards, Jokers, mutations and Blinds are plain JSON, auto-discovered at build time. Add 100+ cards by writing text — no code changes.
- **Bilingual from day 1** (ES / EN) via i18next, with a pure coverage validator — no hardcoded strings.
- **Three.js rendering** with procedural card art (canvas fallback) + real WebP assets, custom GLSL glow/foil/spore shaders, and a GPU particle spore field.
- **Landscape-first, mobile-ready**: DPR capped, no MSAA on mobile, safe-area aware, touch handled.
- **Tauri desktop container** for a native Windows/macOS/Linux build.
- **Dual-backend saves** (Tauri fs plugin in the app, `localStorage` in the browser).

---

## 🚀 Quick start

```bash
npm install          # install deps (Node >= 20)
npm run dev          # Vite dev server (opens the game in the browser)
npm run build        # typecheck + production build into dist/
npm run typecheck    # tsc --noEmit
npm run sim          # console engine harness: validation + balance sim (no GPU)
npm run smoke        # headless WebGL smoke test (Playwright-core, mobile landscape)
npm run tauri dev    # run the game inside the Tauri desktop shell
npm run tauri build  # package the native desktop app
```

> **Note:** `npm run tauri build` requires the Rust toolchain (`cargo`). It was not
> executed in the CI/dev environment used to author this project; the Tauri config
> and Rust shim are in place and ready, but you must build the binary on a machine
> with Rust installed.

---

## 🎮 How it plays

A run is a sequence of **Antes** (1–8). Each Ante has 3 **Blinds** (small / big / boss).
You pick a Blind, play poker-style hands of fungal cards, and must beat the Blind's
**target score** before running out of hands. Beat all 8 Antes → **victory**.

| Concept | Meaning |
| --- | --- |
| **Substrate** | The base score. Cards add to it (`+N` or `×N`). |
| **Spores** | The multiplier applied to Substrate at the end of a hand. |
| **Element** | One of 8 biological elements (`neutral`, `poison`, `spore`, `decay`, `symbiosis`, `crystal`, `mycelium`, `parasite`) driving synergies. |
| **Family** | One of 7 taxonomic families (`agaricaceae`, `amanitaceae`, `boletaceae`, `polyporaceae`, `psilocybaceae`, `clavariaceae`, `tricholomataceae`) — the "suit" used for combos. |
| **Rarity** | `common` · `uncommon` · `rare` · `legendary` · `mythic`. |
| **Status** | Negative states: `dormant` (won't fire), `decay` (−Substrate per trigger), `spore_lock` (locks multipliers), `overgrowth` (+Spores per card played). |

After each Blind you enter the **Shop**: buy cards / Jokers / mutations, reroll, or sell.
Economy is centralized in `src/engine/constants.ts` (`ECONOMY`, `RUN_DEFAULTS`,
`ANTE_BASE_TARGET`).

### Combos (`src/engine/scoring/combos.ts`)
Element tiers (2–5 same-element cards), family tiers (3–5 same-family), and a diversity
bonus. Combos are detected during the scoring pipeline and feed the trigger chain.

---

## 🧠 Architecture

```
src/
├── engine/                 # PURE LOGIC. No Three.js, no DOM. Runs in Node.
│   ├── types.ts            # Core type system (taxonomy, events, actions, conditions)
│   ├── constants.ts        # All balance numbers in one place
│   ├── rng.ts              # mulberry32 deterministic seeded RNG
│   ├── events.ts           # Typed event bus (Emitter<M>) — the engine's only output
│   ├── GameEngine.ts       # Orchestrator: runs, blinds, play/discard, shop, save
│   ├── resolution.ts       # ResolutionContext accumulator (dry-run + sims)
│   ├── cards/              # CardRegistry, Deck
│   ├── scoring/            # ScoreCalculator, combos
│   ├── state/              # RunState, RoundState
│   └── triggers/           # TriggerEngine, actions, conditions, source
│
├── data/                   # CONTENT (JSON, auto-discovered)
│   ├── cards/01_starters.json   (10 starter cards)
│   ├── cards/02_specimens.json  (15 specimens w/ effects)
│   ├── cards/03_apex.json       (5 legendary/mythic)
│   ├── jokers.json              (15 jokers)
│   ├── mutations.json           (6 mutations, no slot)
│   ├── blinds.json              (24 blinds, 8 antes × 3)
│   └── index.ts                 # Vite import.meta.glob loader
│
├── i18n/                   # ES/EN dictionaries + coverage validator
│   ├── en.json  es.json
│   ├── index.ts            # i18next init ({ } interpolation), t/tName/tDesc/toggleLanguage
│   └── coverage.ts         # validateDictionaryCoverage() — pure
│
├── render/                 # THREE.js VIEW LAYER (observes the engine)
│   ├── SceneManager.ts     # builds the world, subscribes to the bus
│   ├── Card3D.ts  CardTexture.ts  ArtAssets.ts
│   ├── Particles.ts        # single THREE.Points spore field (circular buffer)
│   ├── Shaders.ts          # GLSL glow / foil / spore materials
│   ├── CameraRig.ts        # parametric fit() biased toward the hand (mobile)
│   ├── Interaction.ts      # raycaster pointer (touch tap vs drag slop)
│   └── Tween.ts            # from-scratch tween manager (no GSAP)
│
├── ui/                     # DOM HUD (observes the engine)
│   ├── HUD.ts  styles.css  # top bar, jokers column, counters, overlays, tooltips
│
├── persistence/            # SaveGame (Tauri fs / localStorage dual backend)
└── main.ts                 # Controller: boot, wire engine↔render↔ui, autosave
```

### The observer contract
- The engine emits typed events on `bus` (`src/engine/events.ts`).
- `SceneManager` and `HUD` **subscribe** to those events and never call the engine
  directly except through the `main.ts` controller.
- All UI-facing strings go through `t()` / `tName()` / `tDesc()` — there are **no**
  hardcoded user-facing strings anywhere in the codebase.

### Adding content (no code)
Drop a new JSON file in `src/data/cards/` (or edit an existing one). The build loader
uses `import.meta.glob` (browser) and an `fs` reader (Node harness) to discover
content automatically. A `CardDefinition` looks like:

```json
{
  "id": "amanita_toxica",
  "nameKey": "card.amanita_toxica.name",
  "descKey": "card.amanita_toxica.desc",
  "element": "poison",
  "family": "amanitaceae",
  "rarity": "rare",
  "baseSubstrate": 30,
  "baseSpores": 2,
  "cost": 6,
  "art": { "hue": 8, "pattern": "blotch", "glow": 0.6, "silhouette": "cap" },
  "effects": [
    {
      "id": "tox_burst",
      "trigger": "ON_PLAY",
      "conditions": [{ "type": "element_in_hand", "value": "spore" }],
      "actions": [{ "type": "ADD_SUBSTRATE", "value": 40 }],
      "target": "self"
    }
  ]
}
```

`CardRegistry.validate()` enforces the rules (snake_case ids, valid triggers/actions,
`CREATE_CARD` references must resolve, ≥3 blinds per ante, i18n key coverage) at boot.

---

## 🔥 The Trigger Engine & infinite-loop protection

This was a core concern: *"how do I stop the trigger engine from entering an infinite
cascade when a card re-fires itself?"* The engine resolves chains of reactions through
**four independent brakes** plus a **structural** guard:

1. **Depth limit** — `MAX_TRIGGER_DEPTH = 12`. A chain cannot nest deeper than 12
   levels; the engine clamps and emits `trigger:overflow`.
2. **Per-resolution budget** — `MAX_TRIGGERS_PER_RESOLUTION = 600`. The total number
   of triggers fired while scoring a single hand is capped; excess is dropped and logged.
3. **`once` consumption** — effects can declare `once: 'per_round' | 'per_run'`. After
   firing, they are disabled for the scope, so a retrigger can't replay them forever.
4. **Per-event emit cap** — `MAX_EMITS_PER_EVENT = 64` throttles any single event type.

**Structural guard against self-retcon loops:** effect `target` supports
`previous_scored` / `next_scored` (the card immediately before/after in the played
order). These **can never point at the triggering card itself**, which makes a direct
self-retrigger cascade impossible by construction. The adversarial stress test in the
sim harness feeds a malicious self-looping card and verifies it resolves in bounded time.

The `ResolutionContext` is an **accumulator**: effects write to it, and only after the
whole chain settles is the result applied to real state. This enables both the live
**dry-run preview** (`→ total = substrate × spores` in the HUD) and headless
**100k+ simulations** for balance.

Verified in the sim harness (100 full playthroughs): **0 hangs, 0 overflow cuts,
deterministic, max observed depth 2.**

---

## 🌐 Internationalization

- `src/i18n/en.json` and `src/i18n/es.json` hold every user-facing string.
- i18next configured with single-brace interpolation (`{cost}`) to match the content JSON.
- `validateDictionaryCoverage()` runs in the sim harness and fails the build if a
  content key is missing in either language.

Toggle live with the language button in the HUD (or `toggleLanguage()` in code).

---

## 🖥️ Rendering & mobile landscape

- `SceneManager` lays out the hand with a spread that adapts to aspect ratio, biased
  toward the hand so cards stay above the bottom HUD on phones held **horizontally**.
- `CameraRig.fit(aspect, bounds, biasZ)` frames the table parametrically.
- Device pixel ratio is capped at **1.75 on mobile** and MSAA is disabled on mobile to
  protect the frame budget; `viewport-fit=cover` + safe-area env vars keep content off
  notches. Hover is disabled on touch (tap = select, drag = nothing / slop 6px).
- Card art is generated procedurally on a `<canvas>` (instant, no assets) and upgraded
  to real WebP files from `public/art/` when present. Source PNGs live in `art-source/`
  (gitignored; ~20 MB) so they can be re-optimized without re-spending generation credits.

---

## 💾 Persistence

`SaveGame` detects the runtime via `window.__TAURI_INTERNALS__` (not user-agent) and
chooses the backend:

- **Tauri app** → `@tauri-apps/plugin-fs` writes to app-data.
- **Browser** → `localStorage`.

Autosave fires on every `state:changed` event (debounced). `GameEngine.serialize()` /
`restore()` define the `SAVE_VERSION = 1` format.

---

## 🧪 Testing & simulation

| Command | What it does |
| --- | --- |
| `npm run typecheck` | `tsc --noEmit` — full type safety, exhaustiveness checks on the action/condition/event maps. |
| `npm run sim` | Console harness: content + i18n coverage validation, adversarial self-loop stress test, and **100 full AI playthroughs** with a balance report (win rate, ante distribution, trigger telemetry). |
| `npm run sim:balance` | 500-run quiet balance pass. |
| `npm run smoke` | Headless WebGL smoke test (Playwright-core, mobile-landscape viewport): boots, plays blind-select → play → shop → language toggle, asserts 0 console errors. Screenshots land in `tools/shots/`. |

Latest `npm run sim` run: **100 games, 27% win rate, 0 hangs / 0 overflow**, max trigger
depth 2. Latest `npm run smoke`: **✓ SMOKE TEST OK**, 0 errors / 0 warnings / 0 exceptions.

---

## 📦 Project status & known limitations

- ✅ Pure engine, full content set (30 cards, 15 jokers, 6 mutations, 24 blinds), i18n,
  Three.js view layer, HUD, saves, sim + smoke harnesses, Tauri scaffolding.
- ⏸️ **Audio** — deferred by design ("sin audio por ahora"). A Web Audio synthesis layer
  can be added later without touching the engine.
- ⚠️ **Tauri native build** — `npm run tauri build` needs the Rust toolchain, which was
  not present in the authoring environment. The Rust shim (`src-tauri/`) and config are
  complete; build it on a Rust-enabled machine.
- 🎨 **Art** — 11 generated WebP assets ship in `public/art/` (~704 KB). Originals are
  in `art-source/` for re-processing.

---

## 📄 License

See [`LICENSE`](./LICENSE) (MIT).
