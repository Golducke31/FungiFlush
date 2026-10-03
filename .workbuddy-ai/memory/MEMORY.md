# FungiFlush — essentials

TS + Vite + Three.js + Tauri 2 roguelite deckbuilder. Repo: Golducke31/FungiFlush (main).

## Invariants
- Engine pure: no DOM/Three.js. `src/retention/**` may import `src/engine/**`, never reverse. Seeded mulberry32; VFX never consume engine RNG.
- Strings via `t()`; content via `nameKey`/`descKey`. Balance in JSON packs. Saves migrate; profiles never null.
- Render every rAF. Only interactive HUD/overlay layers use `pointer-events:auto`; never `#ui-root > *`. Tap ≤6px/700ms; drag >10px. Duel UI: `viewFor()` only; board consts in `engine/constants.ts`. Never force named manualChunks for lazy modules.

## Checks
`typecheck` / `test` (`tests/*.test.ts`) / `validate` / `smoke` / `build:release`. Prefix every `npm run dev|smoke|build` with `CODEBUDDY_SAFE_DELETE_ENABLED=0`. Smoke runs at 844×390 (phone landscape) — buttons below ~390px break clicks. NEVER `sed -i` on Windows (kills casing → TS1261); use Edit.
`tools/simulate.ts` runs the whole sim at top level (no `import.meta.main`); importing it runs 100 games. When the engine gains a phase, `tools/simulate.ts` MUST gain a `while`/`if` branch or it aborts (`estado inesperado: X`). `sim:balance` (500) + `sim:board` must stay green.

## Flow
menu → **archetypes (selector, NEW)** → blind_select → playing → reward → shop (leaveShop may detour to interlude). **A "Ciego superado" interstitial (`.panel.is-cleared`, `cleared-continue`) shows BEFORE the reward draft** — HUD `case 'reward'` gates it via `clearedShown`.
Deck: `engine.deckSize` = piles+hand; **classic = 40, each archetype starter = 20**; HUD chip `deckDraw/deckSize`; `deckDraw` monotonic within round. `conserveDeck()` returns hand to discard on win/loss.

## Archetypes (2026-10-03, Tanda 7)
- `src/data/archetypes.json` = single source of the 4 archetypes (`spores`/`colony`/`decay`/`crystal`) + `classic` (id `''`): nameKey/taglineKey/descKey/howKey/weaknessKey, `element`, `accentElement`, `starter` (20 cards), `bias`. Read ONLY via `src/meta/Archetypes.ts` (`ARCHETYPES`/`getArchetype`/`starterFor`/`biasFor`, `CLASSIC_ARCHETYPE_ID=''`) which discards malformed entries.
- Loadout: `GameEngine.setArchetypeLoadout(starter, bias)` then `startRun(seed?, ascension=0, archetype='')`; `createRunState(..., archetype)` stores `run.archetype` (serialized + migrated). Shop bias: `OfferService.RollContext.elementBias` → `elementWeights` = `{primary:3, secondary:2}`, applied in `CardRegistry.rollRandomCard(rng, filter?, rarityWeights?, tag?, elementWeights?)` (multiplies rarity weight per element).
- New engine actions `CONSUME_STATUS` + `PURGE_COST_DELTA` (`triggers/actions.ts`); `ResolutionContext.purgeCostDelta`, `RunState.purgeCostBonus` (sums into `purgeCost`).
- Ascension panel builds `.ascension-changes` from `ascensionDeltas(current, previous)` (diffs `ascension(level).modifiers`) so the UI can't lie vs JSON.
- Smoke: "Nueva partida" now opens the archetype panel — both `[data-act="new"]` sites must confirm with `[data-act="archetypes-start"]`; deck-size assertions use `expectedDeckSize = run.archetype ? 20 : 40`.

## UI traps (smoke catches)
- `openOverlay()` replaces (never stacks) the prior panel + clears refs.
- `setMoney` emits `money:changed` immediately — mark sold before charging.
- Stale dev server → CSS 0 rules; kill+restart. `boundingBox()` returns coords even below fold; `mouse.click` at y>innerHeight no-ops.
- `.counter` exists only in `playing`. `elementFromPoint` false-positives pointer-events:none HUD (returns canvas) — test via `is-visible` class.
- Carousel detail painted from render loop — poll after `focusAbs`. `hud.showDeckBuilder()` = DOM grid; 3D carousel via `openDeck()` (shop Mazo).
- **Smoke browser context is `{844×390, isMobile:true, hasTouch:true}` ⇒ `@media (pointer: coarse)` IS ACTIVE in smoke.** Any mobile-only CSS rule is exercised by the smoke. Verify desktop separately with `tools/shot-desktop.mjs` (`pointer:fine`).
- HUD overlays MUST NOT cover interactive controls. `.hud-missions`/`.hud-jokers` share the LEFT edge; jokers are vertically centered (`top:50%`, `max-height:48vh`) and missions sit below. Giving missions `pointer-events:auto` + bottom anchoring swallows taps on joker chips (broke the sell button). Keep `pointer-events:none`; smoke asserts `jokerChip.sellHittable` via `elementFromPoint`.
- **With a panel open on mobile, the run HUD is hidden**: `HUD.syncPanelOpen()` sets `is-panel-open` on `#ui-root`; the `@media (pointer: coarse)` rule hides `.hud-top/.hud-jokers/.hud-missions/.hud-bottom`. Without it the score block painted OVER the deck carousel title/tabs (bug of `Reordenar.PNG`). Overlay `.is-carousel` is TRANSPARENT, so the run HUD showed through. Desktop unaffected (rule is coarse-only; smoke asserts `pointer:fine` keeps them visible).
- Mobile `.hud-missions` must fit its strip: capped `max-height: calc(100dvh - 260px)`, chips compacted. A too-small cap (old `28vh`=115px) silently CLIPPED the last mission — and `pointer-events:none` means the player cannot scroll to it.
- Mobile score block must stay compact: `line-height:1` on `.hud-score-main`/`.hud-score-current` (the `normal` line-height added ~11px of dead air), `.hud-preview:not(.is-visible){display:none}`.
- A smoke phase that **plays a hand** re-deals and perturbs later phases: reset `stickySortMode` (private in `main.ts`, re-applied every `state:changed`) to `'default'` when done, and wait for hand coords to stabilize before tapping.
- **Smoke flakes come from fixed `waitForTimeout` racing animations.** Panels close with `overlay.is-closing` + `panel-out` (`--dur-base`) and stay in the DOM until the animation ends — poll `waitForFunction(el === null)` instead. Same for carousel: poll `carouselFocusedScreenPoint()` (null until `carouselActive` and the focused slot is `group.visible`), not the upgrade button.

## Recent (2026-10-03)
- **Mobile deck/HUD fixes (Reordenar.PNG)**: `is-panel-open` hides the run HUD when a panel is open (coarse only). Missions strip retuned to fit (`100dvh - 260px` + compact chips). Score block compacted (103→80px; `hud-top` 119→96px). Blind panel fits without scroll. Guards in smoke: `afterStart.blindPanelFit`, `afterBlind.missionsClip`, `deckBuilder.hudVisible`. Probes: `tools/probe-mobile-hud.mjs`, `tools/shot-mobile-deck.mjs`. `openDeck()` exposed on `window.__fungiflush` (DEV).
- **Hand fan "ordenar" overlap FIXED**: `SceneManager.layoutHand()` runs twice in one tick (syncHand + auto-sort `reorderHand`); two staggered tweens on the same `home` targets left outer cards on the old tween → two cards at same x. Fix: `handLayoutTl?.kill()` before creating the new tween. `SceneManager.readHandXs()` = debug helper. Guarded by smoke `sortOverlap.afterSort/afterPlay > 1.9` (measures 2.32). Repro: `tools/repro-sort.mjs`, `tools/stress-sort.mjs`.
- **Mobile HUD standardized** in a single `@media (pointer: coarse)` block appended to `styles.css` (bottom bar one row, top bar three zones, blind panel fits, `.hud-missions` repositioned ABOVE the bottom bar with `pointer-events:none`). Desktop untouched (verified `tools/shot-desktop.mjs`). Mobile capture: `tools/shot-mobile.mjs`.
- Ante ladder retuned ~3.5–4× (smooth doubling 1100→180000) — Task 2 difficulty. Verify via `sim:balance`.
- Shop: NEW "Venta" (sell) tab `buildSellTab()` reuses `offerFaceUrl` via synthetic `ShopOffer`; two-touch confirm → `onSellJoker`. Buy tab default.
- Legendary Simbionte `joker_loaded_die` (Task 9): locked via `unlock-rules` (win blind ante 8); ability rolls die every 2 hands (`LOADED_DIE_EVERY=2`, starts ready). Die REMOVED from blind flow.
- Auto-sort: `state:changed` listener re-applies `sortHand` via order-independent uid signature (avoids loop).
- **COMBOS = solo FungiFlush (en vigor desde `fe6f09e`)**: `combos.ts` detecta SOLO `element:*` (mult. Esporas), `family:*` (flat Sustrato) y `diversity:5`. El eje de POKER (par/trio/poker por rareza, escalera, full house) se ELIMINO por completo — sumaba a los otros y inflaba el score. NO reintroducirlo. Tests: `tests/combos.test.ts` (11) — `pokerCombos.test.ts` ya no existe. `card()` de test necesita `cost` y `art: ArtSpec`.
- Tutorial (`HUD.showTutorial(force)`) es reabrible desde el chip "Guia" (`menu.guide`, `onOpenGuide`); persiste `seenTutorial` en perfil (v2, `PROFILE_MIGRATIONS[1]`). Panel `.panel.is-tutorial` es flex-column con `.tutorial-body` scrolleable (si no, en 844×390 el boton de cerrar queda bajo el pliegue).
- Panel de ciego = secuencial (sin eleccion): `blindCard.progress`/`orderHint`, boton `blindCard.start`="Luchar", `phase.blind_select`="Proximo desafio".
- Carrusel: `MIN_SCALE=0.68`, pulso al tocar (`PULSE_SECONDS`), tap sobre la carta enfocada dispara `onCarouselActivate` (sale por `SceneManager.callbacks`, NO `options`).
- Orden por sustrato (`handSort.ts` `substrate`) ordena por `baseSubstrate` NUMERICO asc.
- Deploy: `.github/workflows/deploy-pages.yml` en push a `main` -> https://golducke31.github.io/FungiFlush/ (vite `base: './'`). `ci.yml` corre typecheck/test/validate/sim:balance/sim:board/build + presupuesto bundle <1.6 MB.

## Retention/meta
Unlock doors (R2): `unlock-rules.json` → `UnlockTracker` → `pendingUnlocks` → `PackGate`. Vouchers (R3): `priceOf(offer)` only price source. History (R5) cap 20.

## Art rule
All new art AI-generated img2img (never procedural/SVG); anchor `art-source/art_card_<element>_common.png`. `cardFaceUrl`/`offerFaceUrl` single source. **Every card NEEDS its own `art_card_own_<id>.webp`** — validator FAILS if two cards share an illustration (49 cards / 49 distinct as of Tanda 7). Pipeline: `art-source/*.png` → `npm run art` (= optimize_art.py + genArtIndex.mjs) → `public/art/*.webp` + manifest.

## Open bugs / notes
- Water in `high` tier washed out (render bug).
- Menu = layered composition over `public/menu-bg.jpg` (HTML buttons = per-frame % crops).
- Smoke fixes done 2026-10-03: dismiss `.panel.is-cleared [data-act=cleared-continue]` before reward draft (pre-existing gap — panel added in 4e4ed67, smoke never updated); removed obsolete blind-flow die assertions (die moved to loaded-die joker).
