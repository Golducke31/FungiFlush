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
- **Unlimited upgrades**: level any card for an escalating cost with **no hard ceiling**,
  and **evolving cards** that transform into another species when they hit a level or a
  play count — keeping their uid, level and bonuses.
- **Card flipping & drag & drop**: cards have a real back face and turn over (used by the
  evolution VFX and the idle menu), and cards can be **dragged onto drop zones** to select
  them, return them, or discard exactly one — while **tap-to-select keeps working on mobile**.
- **Mycelial Duel**: a second, self-contained game — a 4×4 Tetra Master-style duel with
  arrows, chains of flips and hidden hands. Hot-seat today, the same reducer online later.
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
│   ├── upgrades/           # Unlimited card levelling (pure cost curve)
│   ├── evolution/          # Card transformation rules
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
│   ├── offers.json         # shop/reward offer tables
│   ├── upgrades.json       # upgrade cost curve
│   └── evolutions.json     # card transformation rules
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

## 🌱 Cultivation: unlimited upgrades & evolving cards

### Unlimited upgrades

"Unlimited" cannot mean "free and uncapped" — that breaks the game in three Blinds. It
means **there is no hard wall** that kills the fantasy of scaling one card, while the cost
curve keeps the decision real:

```
coste = ceil(baseCost × rarezaMult × growth^(nivel-1))
```

`upgrades.json` ships `baseCost: 5`, `growth: 1.6`: a common card costs 5, 8, 13, 20, 33,
52… and a rare one 50% more. Each level grants `substratePerLevel + nextLevel` (so
levelling early is worth more than levelling late) and `sporesPerLevel`.

**The bug this replaced.** `LEVEL_UP_CARD` used to mutate the card *inside the handler*.
The HUD calls `previewSelection()` — which runs the whole scoring pipeline in `dryRun` —
on **every** `state:changed`, so any card with that effect would have levelled itself up
just from the mouse hovering over it. Now the action pushes a request into
`ResolutionContext.levelUps` and `GameEngine.applyDeltas` applies it only when the chain
settles **and** `!dryRun`. There is a regression test for exactly this
(`tests/cultivation.test.ts`).

### Evolving cards

An evolution is a **progression rule**, not an effect, so it lives in `evolutions.json`
keyed by `from` — which means an expansion can give an evolution to a base-game card
without overwriting its definition or tripping the pack merge's "first one wins" rule.

```json
{
  "id": "evo_elder_web",
  "from": "mycelium_webcap",
  "to": "mycelium_elder_web",
  "require": { "type": "all", "conds": [{ "type": "level", "value": 4 }, { "type": "plays", "value": 3 }] },
  "keep": { "bonuses": true, "level": "carry", "statuses": true }
}
```

Requirements compose (`all` / `any`) over `level` and `plays`. **The evolved card keeps its
uid** — that is not cosmetic: the uid is what selection, the renderer's card map and
`deck.remove(uid)` all key on. Changing it would disconnect the card from everything.

Evolved forms carry `tags: ["evolved"]` and the offer tables declare
`"excludeTag": "evolved"`: they are **only** obtainable by evolving, never by buying.
`ContentRegistry.validate()` warns if an `evolved` card has no evolution pointing at it
(dead content).

### Where it happens

All three deck operations (upgrade / evolve / purge) are gated by `canEditDeck()` —
between Blinds or in the Shop, never mid-hand: changing a card the player is already
holding (and may have selected) would be a rules change mid-play.

---

## 🃏 Handling: card flipping & drag & drop

### Flipping (`Card3D.back` + `home.flip`)

`Card3D` now has a **back face**. Both faces are coplanar and look in opposite
directions: the front uses `FrontSide`, the back `BackSide`. Nothing toggles
`.visible` per frame — the GPU's back-face culling decides which one you see, and
because `Mesh.raycast()` honours `material.side`, the raycaster picks the same one.
So a face-down card is still clickable, and there is no z-fighting to babysit.

`home.flip` is a plain tweenable number (`0` = face up, `1` = face down) composed into
the rotation the same way position is:

```ts
group.rotation.set(home.rx, home.ry + Math.PI * home.flip, home.rz);
```

Because the card is already lying flat, rotating around its own long axis really does
turn it over — no special-case code. The flip tween handle is kept **separately** from
the layout tween: `TweenManager.cancelFor(home)` (used when re-laying out the hand)
would otherwise kill a half-finished flip and strand the card mid-turn.

Where it is used today, before the board mode needs it:

- **Menu** — the six idle cards slowly turn over, one at a time, each on its own phase.
- **Evolution VFX** — the card flips face-down, the texture is swapped *while it is
  face-down* (so the change is invisible), and it flips back showing the new art. That
  is what makes an evolution read differently from a level-up flash.
- **Leaving play** — played and discarded cards turn face-down as they retire, because
  the discard pile has no business showing faces the player can no longer use.

### Dragging (`Interaction` + `DropZone`)

Two gestures share one code path, and the thresholds are deliberately **not** the same:

```
CLICK_SLOP_PX = 6    →  tap: select
DRAG_START_PX = 10   →  drag: pick the card up
```

A tap can never start a drag, so **tap-to-select on mobile is untouched** — a 7 px
wobble is neither, exactly as before. `pointerdown` captures the pointer (only when it
actually lands on a card, so page gestures survive), `pointermove` projects the finger
onto a fixed-height plane (`pointerOnPlane`) and writes `home.x/z` **with no tween** —
interpolating towards the finger every frame feels laggy — and `pointerup` resolves the
drop zone by XZ containment.

`src/render/DropZone.ts` splits the two halves of a zone on purpose:

- the **rule** (`ZoneRect`, `accepts`, `resolveDropZone`) is pure and unit-tested in Node;
- the **hint** is a plane with a glowing rounded frame, drawn with no text at all — so
  changing language never rebuilds the table.

| Zone | Where | Dropping there means |
| --- | --- | --- |
| `discard` | over the discard pile | discard **that one card** |
| `play` | the middle of the table | add it to the selection |
| `hand` | the band in front of you | return it / deselect it |

Two decisions worth keeping:

1. **Zones are resolved by list order, not by proximity.** The discard rectangle
   overlaps the hand band, so it is checked first.
2. **The discard zone stops *behind* the hand** (`maxZ: 2.8` vs. the hand's `z ≥ 3.0`).
   If it reached into the hand band, dragging the leftmost card would discard it by
   accident. Discarding now requires throwing the card backwards, towards the pile.

Dropping on `discard` needed one additive engine method: `discardCards(uids)`, which is
the same path as `discardSelected()` with explicit uids — dragging one card must not
discard the whole selection. Everything else reuses `toggleSelect`.

### The bug this phase uncovered

`.hud-popups` is `position: fixed; inset: 0` and was written with `pointer-events: none`
— but a blanket `#ui-root > * { pointer-events: auto }` (1 id beats any class) overrode
it. The popup layer was swallowing **every** pointer event over the whole table: no tap
ever reached the canvas. It went unnoticed because the smoke test clicked cards by
calling `engine.toggleSelect()` directly, never with a real gesture. The blanket rule is
now an explicit list of the layers that genuinely take input, and the smoke test presses
the menu's New Run button and the HUD's Play button with real mouse events.

---

## ⚔️ Mycelial Duel: the board mode

A second game lives inside the first one: a 4×4 **Tetra Master**-style duel. It shares no
rule with the deckbuilder — no Substrate, no Spores, no Trigger Engine — only the *identity*
of the cards. Nothing in `src/engine/board/**` imports scoring, triggers or the deck.

### Where the arrows live

In `board.json`, **indexed by `cardId`**, not as a field of `CardDefinition`:

```json
{ "cardId": "destroying_angel", "arrows": [6,5,5,4,5,4,5,5], "power": 4, "defense": 4 }
```

Four reasons that file is separate:

1. **Zero changes to `src/engine/types.ts`** — `CardDefinition` is the contract shared by the
   deckbuilder, the validator, the card texture and the save file.
2. An **expansion can give board data to base-game cards** without overwriting the base file
   or tripping the merge's "first one wins" rule.
3. It allows **board-only cards** that never enter the deckbuilder pool.
4. A broken `board.json` cannot block a card release — it has its own validation.

### How a placement resolves

Placing a card makes it the only initial attacker, then a BFS walks outward. For every arrow
with a value > 0: `attack = own arrow + power` against `defense = opposite arrow + defense`.
A face-down defender is revealed first and contributes `defense = 0`. If the attacker wins,
the card **changes owner and keeps attacking from its new cell** — that chain is what makes
Tetra Master fun.

`resolvePlacement(state, cell, uid)` is pure: it returns a **new** state plus a list of
`BattleStep`s. The render replays the steps; it never recomputes anything.

**Termination is guaranteed three times over**, and the code says which one is real:

1. **Monotonicity (the actual reason).** Only the active player's side attacks, so every flip
   adds a cell to them and removes one from the opponent. Ownership can't go back.
2. **The rule.** A cell never attacks twice in the same resolution.
3. **The net.** `MAX_COMBAT_DEPTH` caps any chain that escapes. It surfaces as
   `truncated: true` so the simulation can *assert* it never fires instead of assuming it.

### Hidden information

`viewFor(state, player)` redacts the opponent's hand down to a count before the state reaches
any presentation layer. The HUD never sees `BoardState` — only a `BoardView`. That is not just
hot-seat hygiene: when the duel goes online, the server will send exactly this object to each
client, and a HUD that read the raw state would have leaked the opponent's hand over the wire.

Hot-seat adds a **curtain**: after each move the next player has to tap "Ready" before their
hand is drawn, so the player handing over the device never sees it. The smoke test asserts
this the only way that means anything — it greps the rendered panel for the opponent's card
uids and requires zero matches.

### Lazy loading

`await import('@engine/board')` — `combat`, `MatchController` and the rest ship as a **5.2 kB
chunk** that is not preloaded and costs nothing until someone opens a duel. The smoke test
asserts this the only way that means anything: it watches the network and requires that zero
board modules were fetched before the button was pressed.

Two things had to be true for that to work, and both are easy to get wrong:

- **The arrow constants live in `src/engine/constants.ts`, not in the board module.** The
  boot-time content validation needs them, so keeping them inside the lazy module would drag
  the whole thing back into the boot path.
- **No `manualChunks` rule names the board chunk.** Forcing a name made Rollup relocate the
  modules the board *re-exports* into it, so the engine chunk ended up importing the board
  chunk — a cycle, which made Vite preload it. Left alone, the module with no static importers
  falls into the dynamic-import chunk on its own.

### What the simulation changed

`npm run sim:board` plays **10,000 random games** and checks three properties: no mutation
(the state goes in deep-frozen, so any write throws), determinism (each game is played twice
*and* its command log is replayed onto a fresh state), and termination. All of them hold, with
`truncated` never firing.

It also settled two design questions that guessing would have gotten wrong:

| Hand size | Draws | Flips per game |
| --- | --- | --- |
| 4 | 22.8% | 3.3 |
| 5 | 15.2% | 5.7 |
| **6** | **10.8%** | **9.3** |
| 7 | 8.3% | 13.3 |

Four cards leave 8 empty cells and almost nobody to attack; seven stretch the game to 14
placements. **Six** is the pick.

And it caught a real fairness bug: with a fixed first player the split was **25% / 63%** —
placing second is worth an extra attack (the first player places a card with nothing to attack
yet). `createMatch` now draws the starting player from a derived seed, and the sim asserts the
decided games come out 50/50 (it measures 50.5% / 49.5% of 8,929).

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

## 🎚️ Graphics quality tiers

The target is phone landscape, where post-processing is the most expensive thing you can add.
Instead of choosing between "looks good" and "runs", there are three tiers — and one rule that
is not negotiable:

**`low` IS the previous render path**: `renderer.render()` directly, no composer, same DPR. No
device can end up worse than before the visual work started, and the smoke test runs on `low`
(software rendering), so its timing assertions stay valid.

| | low | medium | high |
| --- | --- | --- | --- |
| Render path | direct | composer | composer |
| Bloom | off | ¼ res, 1 iteration | ¼ res, 2 iterations |
| Color grade | off | 0.6 | 1.0 |
| Max DPR | 1.75 | 1.75 | 2.0 |
| Ambient spores | 0 | 400 | 900 |
| Transient spores | 1200 | 1200 | 2000 |
| Contact shadows | off | on | on |

Detection reads the unmasked WebGL renderer string first: **anything software (SwiftShader,
llvmpipe, "basic render") goes straight to `low`**. That is not an optimisation — it is what
keeps the smoke test usable, because with a composer on top the same test would start reading
animation states mid-flight. Then it looks at `deviceMemory` and `hardwareConcurrency`, and when
those are missing (Safari, Firefox) it falls back to `medium` instead of guessing `high`.

On top of that, a **frame monitor** degrades on its own: if the p95 frame time stays above the
tier's budget for 3 seconds it drops a step and tells the player. The budget is 28 ms for
`medium`, 20 ms for `high`, and 0 for `low` (nowhere to go). It deliberately prefers *not* to
downgrade: it uses the p95 of a 90-frame window, so a single slow frame — a texture upload, a
GC — never counts.

`?quality=low|medium|high` forces a tier, and `?perf=1` records frame times and exposes p50/p95
through `window.__fungiflush.perf()`. Under software rendering the absolute numbers are
meaningless, but the **ratio** between two configurations is not.

Also in this pass: `reduceMotion` now also silences the ambient spores and every CSS animation
(`:root.reduce-motion`, plus a `prefers-reduced-motion` media query), and `--muted` — used in
four places but never defined, so it was silently falling back — exists in `:root`.

---

## ✨ Post-processing: selective bloom + colour grade

```
RenderPass (HDR)  →  Bright  →  BlurH  →  BlurV  →  Composite  →  OutputPass  →  LUTPass
```

**A hand-written bloom, not `UnrealBloomPass`.** The stock pass runs 5 mip levels with two
blur passes each — about 13 passes at half resolution or better. On a desktop GPU that is
free; on a mid-range phone it is the difference between 60 and 25 FPS. Here it is four passes
and three of them run at **quarter resolution**, which is where the real saving is: a separable
blur's bandwidth scales with pixels, and the result is added back blurred, so the lost detail
is invisible.

**The bloom cannot eat the dark table.** The threshold is luminance-based (0.70) and the bloom
is computed on the HDR buffer *before* tone mapping. In linear space the table sits at
~0.005–0.08 and a mushroom's cyan at ~0.7–0.8, so the background is physically out of reach.
The "bloom swallowed everything" failure mode only shows up below a threshold of 0.3.

**Tone mapping lives in `OutputPass`.** The three materials in `Shaders.ts` are raw
`ShaderMaterial`s that never included the tone-mapping or colour-space shader chunks — they
were writing linear values into an sRGB framebuffer, which is why the glow always looked
darker than its hex suggested. With the composer, `OutputPass` applies ACES + exposure + sRGB
**once**, at the end, and the whole frame is encoded correctly. The `toneMapped: false` flags on
those materials become inert; they are left in place because they are now harmless.

**The colour grade is procedural, not a baked LUT.** `src/render/Lut.ts` builds a 16³
`Data3DTexture` from a pure function: a soft S-curve, a deliberate teal lift in the shadows, a
whisper of warmth in the highlights, +8% saturation. A baked `.cube` is the professional route
but it adds a binary asset, a loader and an external tool to the iteration loop, and the result
is identical — 4096 entries the shader samples with linear filtering. Swapping in a hand-authored
LUT later means replacing one function.

The grade runs **after** `OutputPass`, so it is authored in display space: the numbers read as
"what you see on screen", which is how anyone tuning it will think. It also lifted the table
from near-black to a dark teal — a real change in mood, on purpose, and the first thing to
touch if it turns out to be too much (`SHADOW_TINT` in `Lut.ts`).

### What the composer costs, and what that number means

The smoke test measures FPS with and without the composer and prints the ratio. **Under
SwiftShader that ratio is meaningless**: there is no GPU, so the full-screen passes run on the
CPU and the number comes out 5–11×. On real hardware three full-screen passes over ~1 M pixels
is noise. It is reported to catch a regression — "this used to be 3 passes and now it is 12" —
and explicitly *not* as an estimate of the cost on a phone. The only honest check is a real
device, and the frame monitor is what protects that case: if `medium` cannot hold 28 ms, the
game drops itself to `low` and tells the player.

`tools/shots/cmp-low.png` and `cmp-high.png` are the same frame with and without the composer,
for eyeballing the difference.

---

## 🧪 Testing & simulation

| Command | What it does |
| --- | --- |
| `npm run typecheck` | `tsc --noEmit` — full type safety, exhaustiveness checks on the action/condition/event maps. |
| `npm test` | `node --test` via tsx: pack merge order, collisions, `allowOverride`, app-version skips, stable pools, content hash, gating, ante extrapolation, offer rolling (determinism, unique ids, rarity weights, ante gates), upgrade cost curve and caps, evolution requirements and `keep` rules, the `LEVEL_UP_CARD` dry-run regression, **drop-zone resolution (priority order, `accepts` gating) and `discardCards` (single-card discard that leaves the rest of the selection alone)**, **the duel (arrow maths, reveals, tie rules, flip chains, purity, the reducer, `viewFor` redaction, `board.json` coverage)**, **graphics tiers (software-renderer detection, `low` staying the old path, tier table coherence, frame-monitor hysteresis)**, save migrations v1→v2, profile fallbacks, entitlement round-trip. |
| `npm run validate` | Content gate: validates every pack's JSON, content i18n coverage, **and scans `src/**` for `t('...')` keys missing from a dictionary**. Exits 1 on error. |
| `npm run sim` | Console harness: content + i18n validation, adversarial self-loop stress test, and **100 full AI playthroughs** with a balance report. |
| `npm run sim:balance` | 500-run quiet balance pass (used as a CI regression). |
| `npm run sim:board` | **10,000 random duels** checking no mutation (deep-frozen state), determinism (double play + command-log replay), termination, and that the depth net never fires. `--runs N`, `--hand N` for tuning. |
| `npm run smoke` | Headless WebGL smoke test (Playwright-core, mobile-landscape viewport): boots → menu → settings → **New Run (real click)** → blind select → **tap-to-select (real tap)** → **drag to play / discard / hand** → **flip a card and flip it back** → play (**real click**) → reward draft → shop → deck purge → upgrade → evolve → collection → **Mycelial Duel (curtain, a real placement, hidden-hand check, finish, close)** → language toggle, asserts 0 console errors. Screenshots land in `tools/shots/`. |

Latest runs: **`npm test` 106/106**, **`npm run validate` 0 errors / 0 warnings**
(35 cards, 24 blinds, 2 offer tables, 1 upgrade track, 5 evolutions, 35 board entries),
**`npm run sim` 100 games, 29% win rate, average ante 6.31, 0 hangs / 0 overflow, depth 2**,
**`npm run sim:board` 10,000 duels, 0 mutation / 0 replay drift / 0 truncation, 10.7% draws**,
**`npm run smoke` ✓ OK, 0 errors / 0 warnings / 0 exceptions**,
**`npm run build:release` 0.79 MB of JS, no sourcemaps** (of which a 5.2 kB board chunk
loads only when a duel starts).

> **On timing in the smoke test.** The rAF loop clamps `dt` to 0.05 s, so under
> SwiftShader (~12 FPS) animations run slower than wall-clock. Waits around animated
> assertions have to budget for that, or the check reads a card mid-flight.

> **Balance notes.** The bot plays greedily: it drafts the best card, buys jokers first, and
> spends leftover money (above a 20-coin reserve) on upgrading its strongest card.
>
> | Version | Win rate | Avg. ante |
> | --- | --- | --- |
> | v1.0 (baseline) | 27% | 5.95 |
> | v1.1 shop refactor, no draft | 17% | 5.47 |
> | v1.1 + reward drafts | 21% | 5.92 |
> | v1.2 + unlimited upgrades | **29%** | **6.31** |
>
> Two lessons worth keeping:
> 1. **Judge balance by the average ante, not the win rate.** Changing the shop's RNG
>    consumption moved the win rate by 10 points while the average ante barely budged —
>    the win rate is the tail of the distribution and is noisy at 100 runs.
> 2. The upgrade curve was originally `baseCost: 4, growth: 1.5` and gave 31% / ante 6.45.
>    It is now `5 / 1.6`, which costs about 2 points of win rate. If we want v1.0's
>    difficulty back, the next levers are raising the Ante targets ~10% (`antes.json`,
>    no code) or `baseCost` to 6.

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
| **3** | Unlimited upgrades (`LEVEL_UP_CARD` through `ResolutionContext`) + evolving cards | ✅ done |
| **4** | Card flipping (`Card3D` back face + `home.flip`) and drag & drop (`Interaction` drop zones) | ✅ done |
| **5** | Tetra Master board mode: `src/engine/board/**` + `board.json` (hot-seat first) | ✅ done |
| **6** | Battle pass + store + Google Play Billing bridge | planned |
| **7** | Real audio on top of `AudioBus` | deferred by design |
| **8** | Android packaging, Play listing, release pipeline | planned |
| **9** | Online multiplayer (`RemoteInputProvider` over the same pure reducer) | future |

---

## 📄 License

See [`LICENSE`](./LICENSE) (MIT).
