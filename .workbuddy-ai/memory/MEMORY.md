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
menu → archetypes (selector) → blind_select → playing → reward → shop (leaveShop may detour to interlude). A "Ciego superado" interstitial (`.panel.is-cleared`, `cleared-continue`) shows BEFORE the reward draft — HUD `case 'reward'` gates it via `clearedShown`.
Deck: `engine.deckSize` = piles+hand; **classic = 40, each archetype starter = 20**; HUD chip `deckDraw/deckSize`; `deckDraw` monotonic within round. `conserveDeck()` returns hand to discard on win/loss.

## Archetypes (Tanda 7)
- `src/data/archetypes.json` = single source of the 4 archetypes (`spores`/`colony`/`decay`/`crystal`) + `classic` (id `''`): nameKey/taglineKey/descKey/howKey/weaknessKey, `element`, `accentElement`, `starter` (20 cards), `bias`. Read ONLY via `src/meta/Archetypes.ts` (`ARCHETYPES`/`getArchetype`/`starterFor`/`biasFor`, `CLASSIC_ARCHETYPE_ID=''`) which discards malformed entries.
- Loadout: `GameEngine.setArchetypeLoadout(starter, bias)` then `startRun(seed?, ascension=0, archetype='')`; `createRunState(..., archetype)` stores `run.archetype` (serialized + migrated). Shop bias: `OfferService.RollContext.elementBias` → `elementWeights` = `{primary:3, secondary:2}`, applied in `CardRegistry.rollRandomCard(rng, filter?, rarityWeights?, tag?, elementWeights?)`.
- Engine actions `CONSUME_STATUS` + `PURGE_COST_DELTA` (`triggers/actions.ts`); `ResolutionContext.purgeCostDelta`, `RunState.purgeCostBonus` (sums into `purgeCost`).
- Ascension panel builds `.ascension-changes` from `ascensionDeltas(current, previous)` (diffs `ascension(level).modifiers`) so the UI can't lie vs JSON.
- Smoke: "Nueva partida" opens the archetype panel — both `[data-act="new"]` sites confirm with `[data-act="archetypes-start"]`; deck-size assertions use `expectedDeckSize = run.archetype ? 20 : 40`.

## Balance / combos
- **COMBOS = solo FungiFlush (desde `fe6f09e`)**: `combos.ts` detects ONLY `element:*` (mult. Esporas), `family:*` (flat Sustrato) and `diversity:5`. The POKER axis (pair/trio/poker by rarity, straight, full house) was REMOVED entirely — do NOT reintroduce. Tests: `tests/combos.test.ts` (11); `pokerCombos.test.ts` no longer exists. Test `card()` needs `cost` + `art: ArtSpec`.
- Ante ladder retuned ~3.5–4× (smooth doubling 1100→180000). Verify via `sim:balance`.

## Jokers / Simbiontes
- `JokerDefinition` (`types.ts:285`), `JokerInstance` (`types.ts:365`), `RunState.jokers`/`jokerSlots` (`types.ts:691`). Content: `packs/base/jokers.json` + `mutations.json` (tag `mutation`). Registry: `CardRegistry.ts:181`.
- Slots: `RUN_DEFAULTS.jokerSlots = 5` (`engine/constants.ts:86`) — the `5` of the "0/5 SIMBIONTES" chip. `RunState` clamps `max(0, 5 + mods.jokerSlots)`. Action `ADD_JOKER_SLOTS` (`triggers/actions.ts:92`); sources: mutation `mutation_joker_slot`, voucher `voucher_sixth_slot`, interlude, negative ascension. **No card grants slots yet**.
- HUD `.hud-jokers` is DOM (`HUD.ts`, `renderJokers`). 3D symbionts: `SceneManager.ts` (`JOKER_Y=0.16`, `JOKER_Z=-3.3`, `JOKER_SCALE=0.86`).
- **P6 — fixed visible slots**: `syncJokers(jokers, jokerSlots)` is PUBLIC (probe uses it) and calls `rebuildJokerSlots(slots)`. One `PlaneGeometry(CARD_WIDTH*JOKER_SCALE, CARD_HEIGHT*JOKER_SCALE)` + `EdgesGeometry` per slot (violet, fill .22/edge .75), `userData.isJokerSlot=true`, sunk `JOKER_SLOT_DY=0.02` below the cards to avoid z-fighting. `layoutJokers()` places slots AND cards by slot index with `slotCount=max(slots,cards)`; `jokers[i]` IS slot `i` (engine appends at end / splices in place → first free slot fills). `applyRunVisibility` hides slots in carousel/menu; dispose frees geometry+material+edges. Slots are NOT in `refreshTargets` raycast targets. Debug: `jokerSlotDebug()`.
- Legendary `joker_loaded_die` (Task 9): locked via `unlock-rules` (win blind ante 8); ability rolls die every 2 hands (`LOADED_DIE_EVERY=2`, starts ready). Die REMOVED from blind flow.

## Card abilities
- No `ability` field: `CardDefinition.effects?` (`types.ts:279`) IS the ability. UI infers `hasAbility` via `(def.effects?.length ?? 0) > 0` (`Card3D.ts`, `cardArt.ts`, `HUD.ts`).
- Triggers: `types.ts:60-100` (ON_DRAW, ON_PLAY, ON_CARD_PLAYED, ON_CARD_DISCARDED, ON_CARD_HELD, ON_CARD_DESTROYED, ON_HAND_SCORED, ON_SHOP_ENTER, ...). Engine: `TriggerEngine.ts` (`buildWorld`). Actions: `triggers/actions.ts`. Conditions: `triggers/conditions.ts`. (P5: all 65 cards audited — 53 with effects, 0 bad triggers/labels/actions. `tests/cardAbilities.test.ts` guards this.)

## Card retention / detail panel
- **P7**: the long-press/double-tap card-detail panel was REMOVED entirely (redundant). `HUD.showCardDetail`/`hideCardDetail`, `.panel.is-card-detail` CSS, `onCardDetail` callback and `onLongPress`/`onDoubleTap` in `Interaction.ts` are all gone. `Interaction.handleUp` just calls `onClick`. This also removed the untranslated `card.noAbility`/`action.close` usages.

## Art rule
All new art AI-generated img2img (never procedural/SVG); anchor `art-source/art_card_<element>_common.png`. `cardFaceUrl`/`offerFaceUrl` single source. **Every card NEEDS its own `art_card_own_<id>.webp`** — validator FAILS if two cards share an illustration (49 cards / 49 distinct as of Tanda 7). Pipeline: `art-source/*.png` → `npm run art` (= optimize_art.py + genArtIndex.mjs) → `public/art/*.webp` + manifest.

## Fonts / UI stack / typography
- `--font-ui` = Fredoka SemiCondensed (HUD/body); `--font-display` = Gasoek One (titles/score/card names); Pirata One = wordmark only. Only stylesheet: `src/ui/styles.css`.
- **P2 (typography raised)**: tokens `--text-xs..xxl` = 11 / 12.5 / 14.5 / 16.5 / 20 / 24 / 36 (`styles.css`). ~20 HUD selectors raised (`.hud-label` 11.5, `.hud-value` 22, `.hud-score-target` 17, `.btn` 15.5, `.joker-chip` 12.5, `.panel-title` 27...). Coarse + `max-height:560px` blocks retuned (`.hud-score-current` 23, `.counter-value` 17). Desktop base untouched.
- **P1 (hierarchy)**: `.hud-block` padding 10px 14px; `.hud-block .hud-label{opacity:.82}`; `.btn.is-play` = 1.05em / 800 weight / letter-spacing .01em.
- **P3**: the play button shows ONLY `action.play (N)` — NO score. The top score block is unchanged. (`previewSelection`/`formatNumber` still used elsewhere.)
- Tutorial (`HUD.showTutorial(force)`) reopenable from the "Guia" chip (`menu.guide`, `onOpenGuide`); persists `seenTutorial` in profile (v2, `PROFILE_MIGRATIONS[1]`). `.panel.is-tutorial` is flex-column with scrollable `.tutorial-body` (else at 844×390 the close button falls below the fold).
- Blind panel is sequential (no choice): `blindCard.progress`/`orderHint`, `blindCard.start`="Luchar", `phase.blind_select`="Proximo desafio".
- Carousel: `MIN_SCALE=0.68`, pulse on tap (`PULSE_SECONDS`), tap on focused card fires `onCarouselActivate` (via `SceneManager.callbacks`, NOT `options`).
- Hand sort by substrate (`handSort.ts`) orders by NUMERIC `baseSubstrate` asc. Auto-sort: `state:changed` listener re-applies `sortHand` via order-independent uid signature.
- Shop: "Venta" (sell) tab `buildSellTab()` reuses `offerFaceUrl` via synthetic `ShopOffer`; two-touch confirm → `onSellJoker`. Buy tab default.

## Hand rendering / deal animation
- **P4 (deal)**: `syncHand` in `SceneManager.ts` sets `drawDeal` for every new hand (opening OR mid-run re-deal, gated by `!reduceMotion`). Merges the arc + squash-settle into ONE per-card timeline with stagger (`i*0.04`); arc peak 0.9 (opening) / 0.55 (draw). Do NOT put the settle in a separate tween — two tweens on the same `home` left cards mid-air (same trap as the sort-overlap bug).
- Hand fan "ordenar" overlap FIXED: `layoutHand()` runs twice per tick; `handLayoutTl?.kill()` before the new tween. `readHandXs()` = debug helper. Guarded by smoke `sortOverlap.afterSort/afterPlay > 1.9`. Repro: `tools/repro-sort.mjs`, `tools/stress-sort.mjs`.

## Retention/meta
Unlock doors (R2): `unlock-rules.json` → `UnlockTracker` → `pendingUnlocks` → `PackGate`. Vouchers (R3): `priceOf(offer)` only price source. History (R5) cap 20.

## Deploy / CI
`.github/workflows/deploy-pages.yml` on push to `main` → https://golducke31.github.io/FungiFlush/ (vite `base: './'`). `ci.yml` runs typecheck/test/validate/sim:balance/sim:board/build + bundle budget <1.6 MB.

## Manual debug access (DEV)
`window.__fungiflush` = `{ engine, scene, hud, bus, content, profileStore, runStore, ... }`. **`content` is the loader façade, NOT the registry** — the registry is `content.registry` (`toBundle()`, `instantiateJoker()`). Add a joker manually: `run.jokers.push(registry.instantiateJoker(id))` + `scene.syncJokers(run.jokers, run.jokerSlots)`. NEVER emit `state:changed` by hand (needs the full payload; breaks `main.ts` boot handler).

## UI traps (smoke catches)
- `openOverlay()` replaces (never stacks) the prior panel + clears refs.
- `setMoney` emits `money:changed` immediately — mark sold before charging.
- Stale dev server → CSS 0 rules; kill+restart. `boundingBox()` returns coords even below fold; `mouse.click` at y>innerHeight no-ops.
- `.counter` exists only in `playing`. `elementFromPoint` false-positives pointer-events:none HUD (returns canvas) — test via `is-visible` class.
- Carousel detail painted from render loop — poll after `focusAbs`. `hud.showDeckBuilder()` = DOM grid; 3D carousel via `openDeck()` (shop Mazo).
- **Smoke browser context is `{844×390, isMobile:true, hasTouch:true}` ⇒ `@media (pointer: coarse)` IS ACTIVE in smoke.** Any mobile-only CSS rule is exercised by the smoke. Verify desktop separately with `tools/shot-desktop.mjs` (`pointer:fine`). There is NO `pointer:fine` media block — desktop is the base.
- HUD overlays MUST NOT cover interactive controls. `.hud-missions`/`.hud-jokers` share the LEFT edge; jokers vertically centered (`top:50%`, `max-height:48vh`), missions below. Giving missions `pointer-events:auto` + bottom anchoring swallows taps on joker chips (broke the sell button). Keep `pointer-events:none`; smoke asserts `jokerChip.sellHittable` via `elementFromPoint`.
- **With a panel open on mobile, the run HUD is hidden**: `HUD.syncPanelOpen()` sets `is-panel-open` on `#ui-root`; the `@media (pointer: coarse)` rule hides `.hud-top/.hud-jokers/.hud-missions/.hud-bottom`. Overlay `.is-carousel` is TRANSPARENT, so without it the run HUD showed through (bug of `Reordenar.PNG`). Desktop unaffected (coarse-only rule).
- Mobile `.hud-missions` must fit its strip: capped `max-height: calc(100dvh - 260px)`, chips compacted. A too-small cap silently CLIPPED the last mission (and `pointer-events:none` means the player can't scroll to it).
- Mobile score block stays compact: `line-height:1` on `.hud-score-main`/`.hud-score-current`; `.hud-preview:not(.is-visible){display:none}`.
- A smoke phase that **plays a hand** re-deals and perturbs later phases: reset `stickySortMode` (private in `main.ts`, re-applied every `state:changed`) to `'default'` when done, and wait for hand coords to stabilize before tapping.
- **Smoke flakes come from fixed `waitForTimeout` racing animations.** Panels close with `overlay.is-closing` + `panel-out` (`--dur-base`) and stay in the DOM until the animation ends — poll `waitForFunction(el === null)` instead. Same for carousel: poll `carouselFocusedScreenPoint()` (null until `carouselActive` and the focused slot is `group.visible`).
- Smoke guards: `afterStart.blindPanelFit`, `afterBlind.missionsClip`, `deckBuilder.hudVisible`, `jokerChip.sellHittable`, `jokerSlotsGuard.{matchesEngine,sizesOk,grewOnPlusOne}`. Probes/shots: `tools/probe-mobile-hud.mjs`, `tools/probe-joker-slots.mjs`, `tools/shot-mobile.mjs`, `tools/shot-mobile-deck.mjs`, `tools/shot-desktop.mjs`, `tools/shot-joker-slots.mjs`. `openDeck()` on `window.__fungiflush` (DEV).

## Open bugs / notes
- Water in `high` tier washed out (render bug).
- Menu = layered composition over `public/menu-bg.jpg` (HTML buttons = per-frame % crops).
- P6: the symbiont slot row lies flat on the table (rx=-π/2) behind the hand fan, so a full hand partly covers it. Reads fine, but keep in mind for future framing.
