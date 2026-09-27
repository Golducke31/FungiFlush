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
>
> **Second principle (scalability):** content ships in **packs**, saves **migrate**,
> and nothing that ships today may invalidate what a paying player already has.

---

## ✨ Features

- **Pure logic engine** in `src/engine/**` — zero Three.js imports, runs in Node, console, or tests.
- **Deterministic, seeded RNG** (`mulberry32`) → reproducible runs, saves, and 100k+ simulations.
- **Event-driven Trigger Engine** with hard anti-infinite-loop brakes (see below).
- **Content packs** (`src/data/packs/*`): cards, Jokers, mutations and Blinds are plain
  JSON declared by a `pack.json` manifest. Expansions and seasons are *more packs*, not
  more code — and they can also arrive at runtime over HTTP.
- **Start screen** with New Run / Continue / Collection / Expansions / Season Pass /
  Settings / Language / About, over a live idle 3D scene.
- **Reward drafts**: clearing a Blind offers 3 cards to pick 1 from (skippable), before
  the Shop. The flow is `playing → reward → shop → blind_select`, and it is driven by a
  data table, not by code.
- **Deck builder & collection**: sort the run deck, purge cards permanently, and browse
  every specimen — including the ones you haven't discovered (silhouettes) and the ones
  locked behind a DLC (greyed out, with the pack name).
- **Versioned saves with a migration chain** (`SAVE_VERSION = 2`), plus a permanent
  **profile** (collection, settings, entitlements, stats) that survives updates.
- **Entitlements + PackGate**: DLC gating as a pure predicate injected into the engine.
  Locked content never appears in rolls, but stays visible in the Collection as a
  sales surface.
- **Bilingual from day 1** (ES / EN) via i18next, with a pure coverage validator — no hardcoded strings.
- **Three.js rendering** with procedural card art (canvas fallback) + real WebP assets, custom GLSL glow/foil/spore shaders, and a GPU particle spore field.
- **Landscape-first, mobile-ready**: DPR capped, no MSAA on mobile, safe-area aware, touch handled.
- **Audio hooks already wired** (`src/audio/AudioBus.ts`) — a no-op today, so adding real
  sound later touches zero engine code.
- **Tauri container** (desktop + the same codebase for **Android**).

---

## 🚀 Quick start

```bash
npm install          # install deps (Node >= 20)
npm run dev          # Vite dev server (opens the game in the browser)

npm run typecheck    # tsc --noEmit
npm test             # packs / offers / gating / save migrations / entitlements
npm run validate     # content gate: pack JSON + i18n keys used in code (CI)
npm run sim          # console engine harness: validation + balance sim (no GPU)
npm run sim:balance  # 500-run quiet balance pass (CI regression)
npm run smoke        # headless WebGL smoke test (Playwright-core, mobile landscape)

npm run build        # typecheck + production build (with sourcemaps, for debugging)
npm run build:release# production build WITHOUT sourcemaps (this is what ships)
npm run packs        # regenerate public/packs/index.json (remote pack index)

npm run tauri dev    # run the game inside the Tauri desktop shell
npm run tauri build  # package the native desktop app
```

> **Note:** `npm run tauri build` requires the Rust toolchain (`cargo`), which is not
> present in the authoring environment. The Tauri config and Rust shim are complete;
> build the binary on a machine with Rust installed. See **Android** below.

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
| **Family** | One of 7 taxonomic families — the "suit" used for combos. |
| **Rarity** | `common` · `uncommon` · `rare` · `legendary` · `mythic`. |
| **Status** | Negative states: `dormant`, `decay`, `spore_lock`, `overgrowth`. |

After each Blind you get a **reward draft** (pick 1 of 3, or skip) and then enter the
**Shop**: buy cards / Jokers / mutations, reroll, or sell. Between Blinds you can open the
**Deck builder** to see your whole deck and purge cards for money.

Economy defaults live in `src/engine/constants.ts`; the **Ante target table lives in
content** (`src/data/packs/base/antes.json`) and so do the **offer tables**
(`offers.json`), so an expansion can add Antes or change shop/reward balance without a
code change.

### Combos (`src/engine/scoring/combos.ts`)
Element tiers (2–5 same-element cards), family tiers (3–5 same-family), and a diversity
bonus. Combos are detected during the scoring pipeline and feed the trigger chain.

---

## 🧠 Architecture

```
src/
├── engine/                 # PURE LOGIC. No Three.js, no DOM. Runs in Node.
│   ├── types.ts            # Core type system (taxonomy, events, actions, conditions)
│   ├── constants.ts        # Balance numbers (fallbacks; content overrides)
│   ├── rng.ts              # mulberry32 deterministic seeded RNG
│   ├── events.ts           # Typed event bus — the engine's only output
│   ├── GameEngine.ts       # Orchestrator: menu, runs, blinds, play/discard, shop, save
│   ├── resolution.ts       # ResolutionContext accumulator (dry-run + sims)
│   ├── cards/              # CardRegistry, Deck
│   ├── offers/OfferService # Shop / reward-draft rolling from data tables
│   ├── scoring/            # ScoreCalculator, combos
│   ├── state/              # RunState, RoundState
│   └── triggers/           # TriggerEngine, actions, conditions, source
│
├── content/                # NUEVO — packs, manifests, deterministic merge
│   ├── types.ts            # PackManifest, OfferTable, AnteRow, version compare
│   ├── ContentRegistry.ts  # merge + collisions + contentHash + validation
│   ├── parse.ts            # RawPack -> LoadedPack (shared with the Node harness)
│   ├── packSource.ts       # BundledPackSource (glob) + HttpPackSource (DLC)
│   └── bootstrap.ts        # the single entry point that builds the content
│
├── meta/                   # NUEVO — OUTSIDE the engine
│   ├── ProfileState.ts     # Permanent profile: settings, collection, passes, stats
│   ├── EntitlementStore.ts # What the player owns (pure, JSON-serializable)
│   └── PackGate.ts         # Entitlements -> content filters
│
├── audio/AudioBus.ts       # NUEVO — no-op today, hooks already attached
│
├── data/packs/base/        # CONTENT (declared by pack.json)
│   ├── pack.json           # manifest: id, version, contents, gating
│   ├── cards/01_starters.json  02_specimens.json  03_apex.json
│   ├── jokers.json  mutations.json  blinds.json
│   ├── antes.json          # score target per Ante
│   └── offers.json         # shop/reward offer tables
│
├── i18n/                   # ES/EN dictionaries + coverage validator
├── render/                 # THREE.js VIEW LAYER (observes the engine)
│   ├── SceneManager.ts     # builds the world, subscribes to the bus, menu/run modes
│   ├── Card3D.ts  CardTexture.ts  ArtAssets.ts  palette.ts
│   ├── Particles.ts  Shaders.ts  CameraRig.ts  Interaction.ts  Tween.ts
├── ui/                     # DOM HUD (observes the engine)
│   ├── HUD.ts  styles.css
│   ├── MenuScreen.ts  SettingsScreen.ts  AboutScreen.ts
│   ├── RewardPanel.ts  DeckBuilderScreen.ts  CollectionScreen.ts
├── persistence/            # NUEVO — Storage + RunStore + ProfileStore + migrations
└── main.ts                 # Controller: boot, wire engine↔render↔ui, autosave
```

### The observer contract
- The engine emits typed events on `bus` (`src/engine/events.ts`).
- `SceneManager` and `HUD` **subscribe** to those events and never call the engine
  directly except through the `main.ts` controller.
- All UI-facing strings go through `t()` / `tName()` / `tDesc()` — there are **no**
  hardcoded user-facing strings anywhere in the codebase.

### Boot sequence (what happens on load)

```
bootstrapContent()      → discover packs (bundled + remote) and merge them
initI18n(packDicts)     → base dictionaries + pack dictionaries
Storage.init()          → Tauri fs or localStorage
ProfileStore.load()     → permanent profile (never null; migrates if needed)
PackGate(entitlements)  → content filters for the engine
GameEngine(bundle)      → registry + filters + content hash
attachAudioHooks()      → no-op audio, already listening
SceneManager + HUD      → view layers
engine.enterMenu()      → START SCREEN (no auto-run anymore)
RunStore.load()         → enables "Continue" if a run was in progress
```

---

## 📦 Content packs (the scalability foundation)

A pack is a folder with a `pack.json` manifest:

```json
{
  "id": "base",
  "version": 1,
  "kind": "base",
  "priority": 0,
  "titleKey": "pack.base.title",
  "requires": { "appMin": "1.0.0" },
  "gating": { "entitlement": "pack.base", "lockedVisibility": "visible" },
  "contents": {
    "cards": ["cards/01_starters.json", "cards/02_specimens.json", "cards/03_apex.json"],
    "jokers": ["jokers.json"],
    "mutations": ["mutations.json"],
    "blinds": ["blinds.json"],
    "offers": ["offers.json"],
    "antes": ["antes.json"]
  }
}
```

**Merge rules (`ContentRegistry`)**
1. Packs that don't satisfy `requires` (app version, other packs) are **skipped**, not fatal.
2. Order: `base` → `expansion` → `season`, then `priority` desc, then `id` asc. Never the filesystem order.
3. On an id collision **the first one wins**, unless the newcomer has `allowOverride: true`
   *and* a higher `version`. Every collision is reported in `collisions`.
4. `contentHash()` is stored in the save so a rebalance can be detected **without
   invalidating the run**.

**Adding a content pack** (zero code changes):
1. Create `public/packs/<id>/pack.json` + its JSON files.
2. `npm run packs` (regenerates `public/packs/index.json`).
3. Grant the entitlement `pack.<id>`.

The bundled source uses `import.meta.glob` (build time, offline, works inside the AAB);
the remote source uses `fetch`, which also works under Tauri's `asset://` protocol.

**Entitlements (`PackGate`)** turn ownership into engine filters:

| Result | Effect |
| --- | --- |
| `allowed` | Enters rolls, shop, drafts and collection. |
| `locked` | Never rolled, but listed **greyed out with the pack name** in the Collection/Store — a DLC nobody sees doesn't sell. |
| `hidden` | Not even listed (`lockedVisibility: "hidden"`). |

When offline and unsure, the gate degrades to **owned**: in a paid game, the correct
error is to give away content, never to charge twice.

---

## 🏠 Start screen

`GameStatus` already had a `'menu'` value that nothing ever set; now it does.

- `main.ts` calls `engine.enterMenu()` instead of `startRun()`.
- `HUD.renderOverlay()` has a `case 'menu'` that renders `MenuScreen.buildMenuPanel()`.
- `SceneManager.setMode('menu')` hides deck/discard/jokers, keeps the table, lights and
  spore field, and drifts 6 decorative cards along the back of the table.
  Those cards are chosen with `Math.random` **on purpose** — using the seeded engine RNG
  would make the menu change the next run.
- The menu overlay is dimmed less than a gameplay overlay, so the idle scene reads through.
- Landscape-first two-column layout (`hero | actions`), stacking in portrait, safe-area
  aware, with `.is-disabled` on "Continue" so the reason can still be shown as a tooltip.
- Buttons carry `data-act` attributes so the smoke test can select them without depending
  on the translated label.

---

## 🎁 Reward drafts, deck building & collection

**Offer tables** (`src/data/packs/base/offers.json`) replaced the hardcoded shop. A table
declares ordered `groups`; each group rolls `chance`, produces `count` offers, and picks
one of its `options` by weight:

```json
{
  "id": "blind_reward_draft",
  "phase": "reward",
  "groups": [
    { "count": 3, "options": [
      { "weight": 1, "kind": "card", "rarityWeights": { "common": 60, "uncommon": 30, "rare": 10 } }
    ]}
  ],
  "pick": 1,
  "allowSkip": true
}
```

Three things this buys:

1. **Balance is content.** Rarity weights, ante gates (`minAnte`), and how many cards a
   draft offers are JSON, not TypeScript.
2. **Deterministic ids.** `offer_<table>_<ante>_<blind>_<sequence>_<index>` — reproducible
   from the seed, and unique across rerolls (the old ids were RNG-derived and could
   collide).
3. **Graceful absence.** A pack that declares no `reward` table simply has no draft: the
   flow falls back to `playing → shop`.

**Deck builder** (`src/ui/DeckBuilderScreen.ts`): sorts by element / family / rarity /
level, and purges cards permanently for `ECONOMY.purgeCost`. Purging removes the card from
the deck *and* from the hand — leaving it in hand would create a ghost the renderer still
draws but the deck no longer owns. Purging is only allowed between Blinds or in the Shop.

**Collection** (`src/ui/CollectionScreen.ts`) takes pre-resolved entries, so it knows
nothing about the registry or entitlements. Three states per entry:

| State | Shown as |
| --- | --- |
| Discovered | Name, colored by rarity |
| Undiscovered | "Undiscovered" + dim swatch — a concrete goal |
| Locked (DLC) | Greyed, with the pack name; tapping opens the store |

`seenCardIds` is written to the profile on `card:drawn` / `card:created` (debounced by
`ProfileStore`, so drawing 8 cards is not 8 disk writes).

---

## 🔥 The Trigger Engine & infinite-loop protection

*"How do I stop the trigger engine from entering an infinite cascade when a card re-fires
itself?"* — four independent brakes plus a **structural** guard:

1. **Depth limit** — `MAX_TRIGGER_DEPTH = 12`; the engine clamps and emits `trigger:overflow`.
2. **Per-resolution budget** — `MAX_TRIGGERS_PER_RESOLUTION = 600`.
3. **`once` consumption** — effects can declare `once: 'per_round' | 'per_run'`.
4. **Per-event emit cap** — `MAX_EMITS_PER_EVENT = 64`.

**Structural guard against self-retcon loops:** effect `target` supports
`previous_scored` / `next_scored`, which **can never point at the triggering card
itself** — a direct self-retrigger cascade is impossible by construction.

`ResolutionContext` is an **accumulator**: effects write to it, and only after the whole
chain settles is the result applied to real state. That enables both the live **dry-run
preview** (`→ total = substrate × spores` in the HUD) and headless **100k+ simulations**.

Verified in the sim harness (100 full playthroughs): **0 hangs, 0 overflow cuts,
deterministic, max observed depth 2.**

---

## 💾 Persistence & migrations

Two separate saves, because they have completely different risk profiles:

| | `fungiflush.run` | `fungiflush.profile` |
| --- | --- | --- |
| Content | The run in progress | Collection, settings, entitlements, passes, stats |
| Lifetime | Deleted when the run ends | Permanent |
| On failure | Quarantined (`*.corrupt` copy) and ignored | Falls back to defaults, **never null** |
| Version | `SAVE_VERSION = 2` | `PROFILE_SAVE_VERSION = 1` |

`src/persistence/migrations.ts` is a table of **pure functions** (`v1 → v2 → …`) covered
by tests with fixtures. Adding a field means adding a migration; `npm test` fails if the
chain has a hole.

What v2 added: per-card `plays` (for usage-based evolutions), evolution lineage,
`cardsUpgraded` / `cardsEvolved` stats, `contentHash` and `packIds`.

---

## 🌐 Internationalization

- `src/i18n/en.json` and `es.json` hold every user-facing string (base pack dictionary).
- Content packs can ship their own dictionary slice (`manifest.i18n`), merged at boot.
- i18next configured with single-brace interpolation (`{cost}`) to match the content JSON.
- `validateDictionaryCoverage()` + `ContentRegistry.validate()` run in `npm run validate`
  and fail on missing keys.

Toggle live with the language button in the HUD or the menu (or `toggleLanguage()`).

---

## 🖥️ Rendering & mobile landscape

- `SceneManager` lays out the hand with a spread that adapts to aspect ratio, biased
  toward the hand so cards stay above the bottom HUD on phones held **horizontally**.
- `CameraRig.fit(aspect, bounds, biasZ)` frames the table parametrically.
- Device pixel ratio is capped at **1.75 on mobile** and MSAA is disabled on mobile;
  `viewport-fit=cover` + safe-area env vars keep content off notches.
- Card art is generated procedurally on a `<canvas>` (instant, no assets) and upgraded
  to real WebP files from `public/art/` when present. Source PNGs live in `art-source/`
  (gitignored) so they can be re-optimized without re-spending generation credits.
- **Frames are always presented**, even in the menu. Skipping frames (an early `return`
  inside the rAF) leaves the canvas unpainted and breaks external captures of the WebView
  (Play screenshots, headless tests).

---

## 🧪 Testing & simulation

| Command | What it does |
| --- | --- |
| `npm run typecheck` | `tsc --noEmit` — full type safety, exhaustiveness checks on the action/condition/event maps. |
| `npm test` | `node --test` via tsx: pack merge order, collisions, `allowOverride`, app-version skips, stable pools, content hash, gating, ante extrapolation, offer rolling (determinism, unique ids, rarity weights, ante gates), save migrations v1→v2, profile fallbacks, entitlement round-trip. |
| `npm run validate` | Content gate: validates every pack's JSON, content i18n coverage, **and scans `src/**` for `t('...')` keys missing from a dictionary**. Exits 1 on error. |
| `npm run sim` | Console harness: content + i18n validation, adversarial self-loop stress test, and **100 full AI playthroughs** with a balance report. |
| `npm run sim:balance` | 500-run quiet balance pass (used as a CI regression). |
| `npm run smoke` | Headless WebGL smoke test (Playwright-core, mobile-landscape viewport): boots → menu → settings → New Run → blind select → play → **reward draft** → shop → **deck purge** → **collection** → language toggle, asserts 0 console errors. Screenshots land in `tools/shots/`. |

Latest runs: **`npm test` 31/31**, **`npm run validate` 0 errors / 0 warnings**,
**`npm run sim` 100 games, 21% win rate, average ante 5.92, 0 hangs / 0 overflow, depth 2**,
**`npm run smoke` ✓ OK, 0 errors / 0 warnings / 0 exceptions**,
**`npm run build:release` 0.73 MB of JS, no sourcemaps**.

> **Balance note (reward drafts).** Adding the draft moved the bot's win rate from 27% to
> 21% *while the average ante reached stayed flat (5.95 → 5.92)*. Isolating the two
> changes: with the new shop code but **no** draft the bot wins 17%; with the draft it wins
> 21%. So the draft is a net **+4 points**, and the rest of the movement is the shop's RNG
> stream changing (the old offer ids consumed extra RNG draws). The game is not harder —
> the tail of the ante-8 distribution is just noisier than the average.

CI (`.github/workflows/ci.yml`) runs typecheck → tests → content validation → 500-run
balance regression → release build → bundle-size budget. The WebGL smoke test is manual
(it needs a Chromium binary with SwiftShader, resolved by absolute path).

---

## 🤖 Android & Google Play (planned)

The same codebase packages to Android through Tauri 2. What is **not** in place yet:

```bash
npm i -D @tauri-apps/cli@^2     # NOT installed
rustup target add aarch64-linux-android armv7-linux-androideabi \
                 i686-linux-android x86_64-linux-android
# Android SDK (platform 36) + NDK, ANDROID_HOME / NDK_HOME / JAVA_HOME
npx tauri android init          # generates src-tauri/gen/android (gitignored)
npx tauri android build --aab
```

- `Cargo.toml` already declares `crate-type = ["staticlib", "cdylib", "rlib"]` and
  `lib.rs` has `#[cfg_attr(mobile, tauri::mobile_entry_point)]` — it was written mobile-first.
- Still missing: `tauri.android.conf.json`, `bundle.android` (minSdk 24 / targetSdk 36),
  Android mipmaps + adaptive icons, a Play 512 icon and a 1024×500 feature graphic,
  keystore + Play App Signing, and `.github/workflows/android.yml`.
- Signing material is already gitignored (`*.jks`, `*.keystore`, `keystore.properties`,
  `*.aab`, `*.apk`).
- Play requirements as of September 2026: **target API 36 (Android 16)** for new apps and
  updates, **16 KB page size** support, Play Billing for all IAP, Data Safety form,
  content rating and a privacy policy.

**Monetization model:** paid app (one-time) + expansions and season passes as Google Play
managed products. Expansions are *always new content* — never content the player already
paid for.

---

## 🗺️ Roadmap

| Phase | Scope | Status |
| --- | --- | --- |
| **0** | Scalable foundations: content packs, profile, save migrations, CI, tests | ✅ done |
| **1** | Start screen, settings, about, audio hooks | ✅ done |
| **2** | Reward drafts (`OfferService` + `offers.json`), deck builder, collection | ✅ done |
| **3** | Unlimited upgrades (`LEVEL_UP_CARD` through `ResolutionContext`) + evolving cards | next |
| **4** | Card flipping (`Card3D` back face + `home.flip`) and drag & drop (`Interaction` drop zones) | planned |
| **5** | Tetra Master board mode: `src/engine/board/**` + `board.json` (hot-seat first) | planned |
| **6** | Battle pass + store + Google Play Billing bridge | planned |
| **7** | Real audio on top of `AudioBus` | deferred by design |
| **8** | Android packaging, Play listing, release pipeline | planned |
| **9** | Online multiplayer (`RemoteInputProvider` over the same pure reducer) | future |

---

## 📄 License

See [`LICENSE`](./LICENSE) (MIT).
