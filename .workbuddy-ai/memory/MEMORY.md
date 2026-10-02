# FungiFlush — essentials

TypeScript + Vite + Three.js + Tauri 2 roguelite deckbuilder. Repo: Golducke31/FungiFlush, main.

## Invariants
- Engine pure: no DOM/Three.js. UI/render observe events; controllers handle intentions. Add sibling modules, don't change scoring/triggers.
- **`src/retention/**` may import `src/engine/**`, NEVER the reverse.** New engine helpers go in `src/engine/<area>/`.
- Seeded mulberry32 deterministic; VFX never consume engine RNG.
- Strings via `t()`; content via `nameKey`/`descKey`. Balance lives in JSON packs.
- Saves migrate; profiles never null. Evolution preserves uid; deck edits need `canEditDeck()`. dryRun handlers accumulate deltas.
- Render every rAF. UI must not shield canvas: only interactive HUD/overlay layers use `pointer-events:auto`; never `#ui-root > *`.
- Tap <=6 px/700 ms; drag >10 px. Drop zones resolve in list order, discard first.
- Duel UI sees only `viewFor()`. Board constants in `engine/constants.ts`. Never force named manualChunks for lazy modules.

## Code & checks
Spanish UI/comments; English identifiers. CSS BEM-ish, `is-` states, buttons >=46 px. Hooks: `data-act`.
`typecheck` / `test` (quoted `tests/*.test.ts` glob) / `validate` (content + literal t() keys) / `smoke` / `build:release`. `smoke` needs a dev server on 127.0.0.1:1420 (`npm run dev`); it does NOT start one — and it runs at **844x390** (phone landscape), so anything pushing a button below ~390px silently breaks a click.
**Always prefix `CODEBUDDY_SAFE_DELETE_ENABLED=0`** to npm run dev/smoke/build.
**NEVER `sed -i` on a repo file on Windows** (loses casing → `TS1261`). Use Edit.

### Bootstrap/UI traps (all caught by smoke/screenshots)
- `engine.run` does NOT exist until `enterMenu()`; `openOverlay()` CLEARS panel refs AND `innerHTML` (a new overlay REPLACES the old, never stacks below).
- `setMoney` emits `money:changed` IMMEDIATELY — mark sold before charging.
- Stale dev server serves CSS with 0 rules (`styleSheets[0].rules === 0`): kill and restart.
- `boundingBox()` returns coords even under an overlay or below the fold; `mouse.click` at y>innerHeight no-ops.
- **HUD counters (`.counter`) only exist in `playing`.** At `blind_select` there are ZERO — assert chips only after a blind is chosen.
- **`elementFromPoint` is a false positive for `pointer-events:none` HUD** (e.g. `.hud-select-hint`): it returns the CANVAS behind. Test visibility via the `is-visible` class instead of hit-testing.
- **Carousel detail (`.carousel-detail*`) is painted from the render loop.** Reading it right after `carousel.focus(n)` is a race (SwiftShader ~12 FPS) — poll until the detail name/stats match the focused card's uid before asserting.
- **`hud.showDeckBuilder()` = the DOM GRID panel (no `.carousel-detail`).** The 3D carousel is opened by `openDeck()` in `main.ts`, i.e. the shop's Mazo button. Tests that need the carousel must go through the shop.

Flow: menu -> blind_select -> playing -> reward -> shop (`leaveShop()` may detour into an interlude). Balance ref: mean ante 6.33, wins 29.6%/500. Duel: 4x4, hand 6, defender_holds.

**Deck totals (2026-10-02):** `round.hand` lives OUTSIDE the `Deck` class (`drawPile`+`discardPile`). `Deck.totalSize` = piles only; `Deck.remaining` = drawPile. **`engine.deckSize` = piles + hand = the number the player means by "el mazo" (40).** The HUD chip shows **`engine.deckDraw` / `deckSize`** ("disponibles / total"). **`deckDraw = deckSize - (cardsPlayedThisRound + cardsDiscardedThisRound)`** — MONOTONIC within a round, because the engine AUTO-REFILLS the hand after a play, so `Deck.remaining` does NOT drop during the hand (that was why the old single-number chip looked "stuck"). `conserveDeck()` returns the hand to the discard on round win/loss, so every panel opened from blind_select/shop/menu shows the full count. `upgradeQuote`, `evolutionOptions`, `UpgradeService.apply` mutate `level`/`bonusSubstrate`/`bonusSpores`; display total = `def.baseX + card.bonusX`.
**Carousel focus:** `CardCarousel.setEntries()` MUST reset `rendered = 0` (else it keeps the prior deck's float). Use `focusAbs(index)` for deterministic focus; `focus()` is RELATIVE (tweens from current). `SceneManager.focusCarousel` → `focusAbs`. `applyCarouselEntry`/`toEntries` must carry `bonusSubstrate`/`bonusSpores` or the card face won't reflect an upgrade.
**Hand order in 3D:** `SceneManager.layoutHand()` iterates `[...this.handCards.values()]`; `Map` preserves INSERTION order, not `round.hand` order. Any hand reorder must call `reorderHandCards(cards)` (re-inserts the Map in engine order) before `layoutHand()`.
**System-exit:** HUD top bar has the `.btn.is-quit` "Menú" button (`data-act="quit-to-menu"`) → `confirmQuitToMenu()` → `.panel.is-confirm`; `main.ts` `onQuitToMenu` clears `savedRun`/`runStore`/continue then `enterMenu()` + `scene.setMode('menu')`. Top bar = 3 right groups (money/lang/menu), so `.btn.is-small` is compacted in the `max-height:560px`/`430px` media queries.

## Gameplay & clarity P0–P2 (2026-10-02)
Single source of truth for the deck; the Blind transition must NOT rebuild it. Two silent deck bugs fixed + `tests/deckConservation.test.ts`.
- **P0.3 tutorial**: `HUD.showTutorial()` shows once per run ON TOP of blind_select; its close sets `lastStatus = null` to force a blind-grid redraw. Smoke must dismiss it (real click on `[data-act="tutorial-close"]`) before `.blind-grid`.
- **P1.6**: "Ciego" explained once per run (`blindExplained`), `guide.whatIsBlind`.
- **P2.3/2.4 interludes** (phase `'interlude'`): pure `src/engine/interlude/interlude.ts` + `packs/base/interludes.json` (6) → `GameEngine.tryEnterInterlude()` (40% on `leaveShop`, skips seen/absent) → `applyInterludeEffects` (validates ALL costs first). `run.interludeModifiers.targetMultiplier` MULTIPLIES inside the single `targetFor()`. Persisted additively; no SAVE_VERSION bump.
- **P2.6 missions**: pure `src/engine/missions/missions.ts` (in engine to avoid the retention cycle) + `src/data/missions.json` (10). `rollMissions()` on `enterBlindSelect` fills to 2 — **but NOT while `this.restoring`** (else reloading rerolls missions). `main.ts` re-dispatches every `MISSION_EVENTS` name (engine does not self-listen).
- **P2.5 shop impact**: `HUD.buildOfferImpact()` → `.offer-impact` `<ul>`. **Trap:** taller cards pushed the buy button below the 390px fold and the smoke click missed. Fixed by `@media (max-height:560px)`/`(max-height:430px)` shrinking `.offer-art` (88/64px) + clamping `.offer-desc`/`.offer-impact li`. Add new shop art in those media queries.
- Bus: `interlude:enter|choose|target`, `mission:added|completed`.

## Render/assets
- low = direct renderer, DPR 1.75 (smoke uses low); higher tiers auto-degrade by p95. OutputPass owns tone mapping.
- Card front FrontSide/back BackSide coplanar; flip tween separate from layout.
- Fonts: Fredoka UI, Gasoek display, Pirata wordmark. `font-synthesis:none`; await fonts.
- Menu = layered composition over `public/menu-bg.jpg` (art has title + 4 button frames). Buttons are HTML per-frame crops in %. `.panel.is-menu` = `position:fixed; inset:0`.
- Never software-upscale textures. Arena: BoxGeometry + material array (6 draw calls); `buildArena()` doesn't know assets; `applyFloorArt()` from `SceneManager.buildWorld`.
- HUD material: `--frame-*` SAMPLED from `public/menu-btn-play.png` (body #094540, moss #2eb2a4, edge #062a2e).
- GSAP hybrid: `anim.ts` owns GSAP, driven from `SceneManager.frame()` (NO own rAF). `stagger` with `{amount}` never `each`.
- Water (F2) only in `environment` tiers; `low` has none. dt clamped `Math.min(0.05, Math.max(0, rawDt))`. **Water in `high` is washed out — open bug.**
- Dado: `blind_select` arms the cube; player drags/releases. Motor sorts BEFORE animating. Face via `die:settled`; overlay `is-throw` = pointer-events:none.
- Carrusel 3D (F1): `CardCarousel.ts` ring, 11-slot pool. `SceneManager.setCarousel()` **snapshots rig base on open, restores on close**. `carouselEntries()` exposed.
- Panels = BOARD; contents = pieces. `.panel` uses `--frame-deep-*`; `.offer/.reward-card/.deck-card/.collection-card/.daily-day/.daily-focus/.achievement-card/.settings-field` share ONE rule. Add new screen classes to that list.

## Retention & meta
`src/retention/*` pure (DailyReward 20h gap, AchievementTracker, rewards idempotent). Data in flat `src/data/*.json` (achievements, daily-rewards, seasons, unlock-rules, missions — evade validate/artCoverage). Profile migration = merge over default; new fields need an explicit line. Smoke URL `?daily=0` skips the daily modal.
Unlock doors (R2): `unlock-rules.json` → `UnlockTracker` → `profile.collection.pendingUnlocks` → `PackGate` 4th arg. `contentState` order: `isUnlocked` → **`evolutionTargets`** → `pendingUnlocks` → pack. Evolution targets can NEVER be gated. `publishConditions()` MUTATES the live object in place. Hooks `__fungiflush.unlocks/.gate/.collection()`.
Vouchers (R3): `vouchers.json` (7) → `rollRandomVoucher` → `OfferService` `'voucher'` → `buyVoucher`. `effects` once + `runModifiers` from the aggregate. **`priceOf(offer)` is the ONLY price source.** `combineModifiers` sums deltas / MULTIPLIES multipliers; clamps target [0.25,2], discount [0,0.9]. Tool `tools/verify-voucher.mjs`.
History (R5): `profile.history` (CAP 20), written in `bus.on('game:over')` deduped by seed. Needs its own `migrateProfileSave` line + test.

## Art rule (Emanuel, 2026-10-01)
**All new art is AI-GENERATED via img2img; never procedural or SVG** (point icons only if SVG clearly wins). Anchor on `art-source/art_card_<element>_common.png`, `input_fidelity: medium`, style §0.4 of `ART_PROMPTS.md`. **Text-to-image does NOT reproduce the style — forbidden.** One prompt per asset in `ART_PROMPTS.md`. Chain: `public/art/index.json` → `ArtAssets` → `src/ui/cardArt.ts` (`cardFaceUrl`/`cardDefFaceUrl`/`offerFaceUrl` = single source).
Art trap: a card can't land on an occupied (element×rarity) → `artCoverage` flags it; use `art_card_own_<id>.webp`, 2:3 PNG in `art-source/` → `npm run art` (512×744). New cards need a `board.json` entry. `art:arena`/`art:cardback` are real art.

## Pending/decisions
- Hand extremes overlap: RESOLVED (2026-09-29), piles at X=±10.5.
- Paid Android app + new-content IAP only; Tauri Android API36. Audio deferred to hooks.
