# 🍄 FungiFlush

> ⚠️ **CONVENCIÓN ACTUAL — MÓVIL PRIMERO (mobile-first only).** En esta etapa el
> desarrollo se centra **exclusivamente en la versión MÓVIL** (viewport de
> referencia 915×412, `pointer: coarse`). **No modificar la versión de
> escritorio** hasta que se cierre el frente móvil: cualquier cambio de UI/HUD
> debe apuntar al móvil. Si un cambio mejora el móvil pero empeora el
> escritorio, se hace igual pero se registra el impacto.
> *Current stage: work on the **mobile version only**. Do **not** touch the
> desktop build until the mobile front is done. Any UI/HUD change must target
> mobile.*
> Regla completa en [`docs/CONVENCION_MOVIL_PRIMERO.md`](docs/CONVENCION_MOVIL_PRIMERO.md).

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

## 💡 Lighting: two lights and painted shadows

**Four lights became two.** Every extra dynamic light is another trip through the lighting loop
in *every* lit fragment — cards, table, both piles — and on a phone that is pure fill rate. The
two `PointLight`s (a cyan rim and a violet fill) are gone; their job is done by each card's halo,
which already carries its own colour, and by the light pool baked into the table canvas. In their
place is a `HemisphereLight` (cyan sky, near-black ground) plus one `DirectionalLight` key. The
hemisphere does the ambient's job *and* adds a directional gradient a flat ambient cannot.

Intensity is the knob: the first attempt (1.7) lit the table so much the scene lost its dark
mood. 1.05 with a duller sky keeps the hyphae readable without washing out the black.

**Shadows are painted, not computed.** Cards lie flat and coplanar with the table, so a shadow
map from above produces a null, aliased shadow in exchange for a full depth pass plus shadow
sampling in every lit fragment. Instead, one `InstancedMesh` with a soft radial-alpha texture
draws **every contact shadow in a single draw call** (`shadows` in `stats()` is the instance
count, and the smoke asserts it tracks the live cards).

Two details that matter:

- The shadow sits at **table height**, taken from `home.x/z` — never from the card's `y`. If it
  followed the card, lifting one would lift its shadow and the effect would vanish.
- It does **not** inherit `home.flip` or the drag tilt: a shadow is always lying down. It does
  inherit `home.rz` so it turns with a fanned-out hand.
- It **shrinks** as the card lifts (hover, selection, drag). That is the only depth cue a flat
  card has. It does not fade: `InstancedMesh` has no per-instance opacity without a custom
  shader, and shrinking already reads as "it came off the table".

Net cost: the shadows add **+1 draw call for all cards**, and dropping two lights removes more
than that from the per-fragment lighting loop.

`tools/shots/v2-shadows.png` shows the result: cards grounded, table still dark.

---

## 🌀 One halo instead of three

Each card used to carry **three additive quads**: a glow, a selection ring and (for legendary and
mythic) a holographic foil. Worse, the ring redrew *the same geometry* scaled 1.14. That was not
just two extra draw calls — it was additive **overdraw**, which is the real bottleneck on a phone.

All three are distance functions over the same rectangle, so they now live in one fragment
shader: the halo uses `exp(-max(sdf, 0))`, the ring uses `exp(-abs(sdf))` — which turns it into a
band centred on the contour instead of an outward bloom, and reads much better as "selected" —
and the foil is the same halo term with a hue that cycles with `uTime`.

The three terms are summed with their own intensities and the colour is then **normalised by that
sum**, so a selected legendary can show a rarity-coloured halo, an element-coloured ring and a
rainbow foil at once without one swallowing the others.

Two details that are easy to get wrong:

- **The quad grew 1.14×** to hold the ring's contour, so `uInnerHalo` is divided by the same
  factor. Change one without the other and the halo silently jumps size — there is a test for
  exactly that relationship (`HALO_INNER_HALO * 1.14 === 0.82`).
- **The foil is gated by uniform, not by `.visible`.** It used to be its own mesh that got hidden
  when the card flipped; now that it shares the shader, `update()` writes `uFoilAmount = 0` for a
  face-down card.

Measured: **8 hand cards went from 45 to 37 draw calls** in the scene, and the ring's overdraw is
gone with them. `tools/shots/v3-selection-low.png` (ring) and `v3-foil.png` (a legendary and a
mythic side by side) are the visual checks.

---

## 🌫️ Particles: two systems, two costs

The spore field used to be one `THREE.Points` with the whole simulation in JS: 2400 particles
integrated every frame, forever, even though most of them were just background spores bobbing
about. It is now split by what each half actually needs.

**Ambient spores are 100% GPU.** They have no target and no interaction, so their position is
computed in the vertex shader from a seed and `uTime` — a slow fall with a wrap, plus a lateral
drift from two sine waves of unrelated frequencies (so it never reads as an orbit). The CPU
writes the buffers **once**, at construction, and afterwards only updates one uniform. The
fall is cyclic, so the alpha fades in at the top and out near the floor, otherwise the spore
that leaves the bottom would pop back in at the ceiling.

**Transient spores stay on the CPU.** `burst` and `stream` need per-particle homing — each one
chases a different target — and they live under a second, so a JS integration loop is both
correct and bounded.

### The invariant, and why it is testable

`BufferAttribute.version` increments every time someone sets `needsUpdate = true`. So the test
runs 10 seconds of frames and asserts the ambient seed and colour buffers **never** got a new
version, while `uTime` did advance:

```ts
assert.equal(seeds.version, seedVersion);   // el movimiento vive en el shader
assert.ok(field.ambient.material.uniforms['uTime'].value > 5);
```

If someone ever reintroduces a JS integration loop for the ambient half, that test fails on the
next run instead of quietly costing frames on a phone.

**Pools are sized to the maximum across all tiers**, and a tier only moves the *limit*
(`setDrawRange` for the ambient field, a slot cap for the transient pool). Changing quality
therefore never reallocates a buffer or uploads one. The smoke asserts the two ends: `particles
=== 0` at `low` (the tier does not pay for ambient spores) and `particles >= 900` at `high`.

Cost: **+1 draw call** (the ambient field is its own `Points`), against 900 integrations per
frame that no longer happen.

---

## 🎴 Card art: from 9 illustrations to 40

Thirty cards used to share **nine** illustrations — one per element, plus two for legendary and
mythic. Two cards of the same element were pixel-identical, which was the weakest point in the
game's art. The scheme is now **element × rarity**: 8 × 5 = 40 files.

```
public/art/art_card_<elemento>_<rareza>.webp    512 × 744   (2:3, igual que la carta)
public/art/art_cardback.webp                    512 × 744
public/art/art_table.webp                       768 × 768   (tileable)
```

### The fallback chain is what makes the migration safe

The 40 files will not appear all at once. Each card resolves in order:

1. `card_<element>_<rarity>` — the new art
2. `card_<element>_common` — the element's new art, base version
3. `art_<element>` — the 11 old files
4. *(nothing)* — the procedural canvas drawing

So the game is playable and shippable at any intermediate point, and deleting the 11 old files is
the **last** step, not the first. `artKeysFor()` is the chain, it is deduped (for `common` the
first two links are the same file) and it has tests.

### The manifest

51 possible keys resolve to 51 URLs, but only the ones that exist should be requested —
otherwise every boot produces dozens of 404s and one console warning each. `public/art/index.json`
(generated by `npm run art:index`) lists the real files, and only those get fetched. Without the
manifest the loader falls back to the 11 old ones, so a missing manifest is not fatal.

### Full-bleed, and why the prompt spec changed

The old layout drew the art into an inset window of **488 × 348** — a 1.4:1 landscape box. Feeding
it a 2:3 illustration would crop **51% of the height**, cutting straight through a subject
composed to fill 70% of the frame. The new art is 512 × 744 and so is the card canvas, so the art
is now drawn **full-bleed**: exact fit, zero crop, and the text sits on top of gradients painted
for it.

**That changes what you should generate.** The subject has to live in the band between **18% and
62% of the height** (~330 px of 744): the top 18% carries the element label and the card name, and
the bottom 38% carries the stat chips and the description, both over a darkening gradient.

### Two bugs found on the way

- **`art_table.webp` was loaded and thrown away.** 103 kB fetched, then the table was drawn from
  the procedural canvas anyway. It now uses the real texture (and `repeat(6,6)`: at the old 2×
  the texel was huge and the texture read as blobs).
- **`tools/optimize_art.py` globbed the wrong directory.** It looked for `public/art/*.png` while
  the source PNGs live in `art-source/` (gitignored), so `npm run art` would have found nothing.
  It also had two hardcoded sizes; now it resolves by prefix, so `art_card_*` automatically gets
  512×744.

---

## 📦 Assets

**The 40 card illustrations, 12 per-card ones and the 25 UI icons are done.** Every file is in
`art-source/` (source PNGs, gitignored) and `public/art/` (shipped WebPs/SVGs), and
`public/art/index.json` lists them. After adding or replacing files, run `npm run art`
(optimise + rebuild the manifest).

### Cards — the big one

| File | Purpose | Format and specs |
| --- | --- | --- |
| `art-source/art_card_<element>_<rarity>.png` × 40 ✅ | 30 cards now have their own illustration instead of sharing 9. | Source PNG **vertical 2:3** (848×1264 or 1024×1536 — any 2:3 bucket works). `optimize_art.py` **crops** it to **512×744** (the card is 1:1.453, not 1:1.500) instead of stretching it, so circles stay circles. **Composition (full-bleed):** the subject lives in the band between **18% and 62% of the height** — the top 18% carries the element label and the card name, the bottom 38% carries the stat chips and the description, both over a darkening gradient. Silhouette readable at 96 px wide. No text, no frame, no signature. |

Elements: `neutral poison spore decay symbiosis crystal mycelium parasite` · Rarities: `common
uncommon rare legendary mythic` — **40 files**, 0.70 MB total, none over 60 KB.

**The generation plan is [`ART_PROMPTS.md`](./ART_PROMPTS.md)**: one ready-to-paste prompt per
asset, the locked palette, the per-rarity treatment table, the composition band, the batch
order and the acceptance criteria. **§0.4 is the part that matters if you regenerate
anything:** the style is not described, it is *inherited* by image-to-image from the family's
`common`. Text-to-image was tried and it comes out photorealistic — it breaks the set.

The old 11 element illustrations are still in `public/art/` and still in the fallback chain.

### The 12 per-card illustrations

The 40 files above are indexed by **(element × rarity)** — 8 × 5 — not by card. The game has
**35 cards that land in only 23 of those pairs**, so 10 pairs held 2–3 cards each and **22 cards
(62%) showed the same drawing as another card**. That was the bug behind "different names, same
picture".

The fix is not 35 new files: **13 of the 23 pairs hold a single card and were already unique**, so
only the extra cards in the 10 shared pairs needed art — **12 files**, named
`art_card_own_<card_id>.webp` and resolved by `artKeysFor(element, rarity, cardId)`, which puts the
card's own key **first** in the fallback chain.

Each one was generated by image-to-image **anchored on the art of its own pair**
(`art_card_<element>_<rarity>.png`), not on the element's `common`: anchoring on the pair means the
rarity treatment and the accent colour are already correct and don't have to be re-stated in the
prompt. The subject came from each card's own `art.silhouette` + `art.pattern`, which were already
in the card JSON and only ever used by the procedural fallback. Full method in
[`ART_PROMPTS.md` §0.4](./ART_PROMPTS.md).

`npm run validate` now **fails** if two cards resolve to the same file (`arte 35 cartas / 35
ilustraciones distintas`), so this cannot come back silently when content grows.
They are **not** deleted on purpose: that's batch L6 in the plan, and it only happens once the
40 have been played with for a while.

### Identity

| File | Purpose | Format and specs |
| --- | --- | --- |
| `public/art/ui_logo_mark.webp` ⬜ | Menu, loader, About; the app icon comes from `make_icons.py` instead. | **1024×1024**, WebP with alpha, readable at 48 px on `#080b10`, one centred subject, 12% margin. |
| `public/art/ui_icon_<id>.svg` × 25 ✅ | Buttons are text-only today; the only glyphs in the whole UI are `✓` and `→`. | **SVG, not WebP**: `viewBox="0 0 24 24"`, **no `width`/`height` attributes**, `fill="none"`, `stroke="currentColor"`, `stroke-width="2"`, round caps and joins, geometry inside a 2–22 box. **Monochrome is required** so CSS can tint it. No `<text>`, no `<style>`, no `id`, no gradients, no filters. Legible at 16 px. IDs: `money hand discard ante joker_slot reroll sell settings language collection store lock xp tier claim upgrade evolve flip drag hotseat online sfx music haptics close` — per-icon glyph specs are in [`ART_PROMPTS.md` §5](./ART_PROMPTS.md). The 25 pass the contract, verified by a script that parses every file. |
| `public/ui/fungi.png` ✅ | The currency icon, next to the money value in the in-game HUD. | **16×16 PNG with alpha**, cropped unchanged from the *16X16 Pixel Mushroom Pack* by ssugmi (see **Third-party** below). Drawn at 18–22 px with `image-rendering: pixelated` so the pixel art stays crisp instead of being smeared by bilinear filtering. |

### Optional

| File | Purpose | Format and specs |
| --- | --- | --- |
| `public/lut/night_grade.png` | Replace the procedural colour grade with one authored by hand (DaVinci / Photoshop). | **1024×32** — a horizontal strip of 32 slices of 32×32, R fastest, then G, slices are B. PNG without alpha, sRGB. Requires ~40 lines of loader (strip → `Data3DTexture`); without it the procedural grade is used. |
| `art-source/art_table.png` | A darker felt if the current forest floor is too busy. | **1024×1024 tileable**. Used at `repeat(6,6)` over a 90×64 table. |
| `board_tile_*.webp` / `board_arrow_*.webp` | Only if the duel gets a skinned board. The DOM board works today. | 256×256 tiles, 128×128 arrows, alpha. |
| `public/feature-1024x500.png`, `keyart_pack_base.webp`, `public/shots/<lang>/*.png` | Play Store listing (phase 8). | 1024×500 no alpha with 15% margins; 1600×900; 1920×1080. **The screenshots are better generated than hand-made** — a script can drive the game to specific states with `?quality=high` and capture them. |

### Third-party

Four external sets are used. All are licensed for commercial use, and nothing is
fetched at runtime — the game has to ship offline. Three are **vendored into the
repo** as files; GSAP is a normal npm dependency, bundled at build time.

| Set | Used for | Licence |
| --- | --- | --- |
| [Polyfork](https://polyfork.dev) — 3 ground tiles + 4 mushrooms | The in-game Arena diorama (`src/render/Arena.ts`), merged into 2 draw calls. Vendored as `src/render/polyfork/*.ts`. | Commercial use in games and apps allowed, modify freely, **no attribution required**; do not resell or redistribute the files as assets. Full text and the one local patch in [`src/render/polyfork/LICENSE.md`](./src/render/polyfork/LICENSE.md). |
| [16X16 Pixel Mushroom Pack](https://ssugmi.itch.io) by ssugmi | The `Fungis` currency icon — one 16×16 sprite, shown at 18–22 px next to the money value. | Commercial use allowed, modifications allowed, **reselling or redistributing the pack prohibited**. Only the single sprite is committed, never the sheet. See [`public/ui/LICENSE.txt`](./public/ui/LICENSE.txt). |
| [Super Pixel Effects Gigapack](https://untiedgames.com) (Free Version) — Will Tice / unTied Games | The scoring effects: `public/fx/fx_poison.webp` (damage / negative steps) and `fx_burst.webp` (combos and order bonuses). Played at 15 FPS via CSS `steps()`. | Commercial use allowed, bundling with the game allowed, **attribution required**. Redistributing the pack as an asset store is not permitted. Full text and the adaptation notes in [`public/fx/LICENSE.txt`](./public/fx/LICENSE.txt). |
| [GSAP](https://gsap.com) 3.15.0 (core + CSSPlugin) | The orchestrated animation layer: card/hand sequences, stagger, arcs and the DOM/UI transitions (`src/render/anim.ts`). npm dependency, bundled by Vite into its own chunk. | Standard **"no charge"** licence: free for commercial use, including a paid game. The only prohibitions are building a competing visual animation builder, reverse-engineering, and removing the proprietary notices. Full text: <https://gsap.com/standard-license> (verified 2026-09-29 against `node_modules/gsap/package.json` → `license` field). |

### Credits

As required by the licences above, FungiFlush credits:

- **Super Pixel Effects Gigapack — Will Tice / unTied Games** (scoring effects)
- **16X16 Pixel Mushroom Pack — ssugmi** (Fungis currency icon)

### On the pixel art vs. illustrated art mismatch

The effect pack is **16-bit pixel art** and the rest of the game is painted illustration. Dropping
the sprites in as-is left them looking pasted on next to the cards. They go through a deliberate
adaptation: a **2× Lanczos upscale** (not NEAREST — that is what softens the pixel stair into a
brush stroke) plus a **blurred halo composited underneath**, so an effect carries the same kind of
light as a card halo. If you swap in a different pack, it needs the same treatment.

Note the asymmetry: Polyfork is imported as **code** (the modules are the asset), so they live
under `src/`; the mushroom pack is a **raster**, so only the one cropped sprite lives under
`public/ui/`.

### Not needed

- **Normal / roughness maps**: cards are flat quads and the style guide asks for a matte finish.
- **KTX2 / Basis**: 40 WebPs are ~2.4 MB; the loader plus transcoder WASM would cost more than it
  saves. Revisit only if VRAM becomes a measured problem.
- **App icons**: `tools/make_icons.py` already generates every size from `art-source/art_legendary.png`.

---

## 🔤 Typography

Three families, each with one job:

| Variable | Family | Where |
| --- | --- | --- |
| `--font-ui` | **Fredoka SemiCondensed Bold** | the whole HUD, panels, buttons, chips |
| `--font-display` | **Gasoek One** | panel titles, the score, the loader, card names |
| `--font-wordmark` | **Borsok** | only the menu wordmark |

The card canvas uses two of them explicitly (`CARD_DISPLAY_FONT` for the name and labels,
`CARD_TEXT_FONT` for the chips and description), because at 15–21 px you want legibility, not
personality.

### `npm run fonts`

The source TTFs are 1.17 MB — Gasoek One alone is 1 MB because it ships 3099 glyphs (hangul
included). `tools/build_fonts.py` does two things:

1. **Subsets** each face to the characters the game actually writes, read straight out of the
   i18n dictionaries plus the symbols the HUD draws (`→ ✓ · — × …`). A new translation therefore
   cannot end up with a blank glyph.
2. **Compresses to WOFF2.**

Result: **1167 KB → 38 KB (3.3%)**. The originals live in `fonts-source/` (gitignored); only the
subsets are committed.

### Two traps worth knowing

- **`font-synthesis: none` on `:root`.** All three files carry a single weight (Fredoka 700,
  Gasoek 400, Borsok 400) but the CSS asks for 800/900 all over the place. Without this, the
  browser *manufactures* a synthetic bold on a face that is already heavy, and it smears. One
  line fixes the whole stylesheet instead of rewriting every `font-weight`.
- **The canvas does NOT honour `font-synthesis`.** `ctx.font` synthesises bold on its own, so the
  card text asks for the real weights (700 for Fredoka, 400 for Gasoek) and nothing else. And
  because card text is *baked*, the boot waits for `document.fonts.load()` + `document.fonts.ready`
  before creating the renderer — otherwise a card generated early keeps the fallback font forever.

Fonts are **not** preloaded: 38 KB behind a loading screen buys nothing, and since the document
has no text until the loader appears, the browser logs "preloaded but not used" warnings.

### Licence

`public/fonts/LICENSE.txt`. Fredoka and Gasoek One are **SIL OFL 1.1** — fine to embed in a paid
app.

**Borsok is not.** Its file says *"Copyright (c) 2018 by Dastan Miraj. All rights reserved."* and
declares no licence. It is confined to one decorative element (the wordmark) precisely so it can
be swapped by changing one CSS variable and one file, with no asset regeneration. Before shipping
to Google Play: get a written commercial licence, replace it with an OFL face, or drop it.

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

Latest runs: **`npm test` 116/116**, **`npm run validate` 0 errors / 0 warnings**
(35 cards, 24 blinds, 2 offer tables, 1 upgrade track, 5 evolutions, 35 board entries),
**`npm run sim` 100 games, 29% win rate, average ante 6.31, 0 hangs / 0 overflow, depth 2**,
**`npm run sim:board` 10,000 duels, 0 mutation / 0 replay drift / 0 truncation, 10.7% draws**,
**`npm run smoke` ✓ OK, 0 errors / 0 warnings / 0 exceptions**,
**`npm run build:release` 0.80 MB of JS, no sourcemaps** (of which a 5.2 kB board chunk
loads only when a duel starts).

Art: **40/40 card illustrations** (0.70 MB of WebP, all 512×744, none over 60 KB) and
**25/25 UI icons** (SVG, contract-verified). The smoke passing with 0 console warnings is the
proof that the manifest matches the files on disk: a misnamed file would be a 404 there.

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
