# FungiFlush — project essentials

TypeScript + Vite + Three.js + Tauri 2 roguelite deckbuilder. Repo: Golducke31/FungiFlush, main.

## Invariants
- Engine stays pure: no DOM/Three.js. UI/render observe events; controllers handle intentions. Inject rules/predicates; add sibling modules instead of changing scoring/triggers.
- Seeded mulberry32 is deterministic; visual effects never consume engine RNG.
- Visible strings use t(); content uses nameKey/descKey. Balance lives in JSON packs.
- Saves migrate; profiles never return null. Evolution preserves uid; deck edits require canEditDeck(). dryRun handlers accumulate deltas, never mutate global state.
- Render every rAF. UI must not shield canvas: only explicit interactive HUD/overlay layers use pointer-events:auto; never #ui-root > *.
- Tap <=6 px/700 ms; drag >10 px. Drop zones resolve in list order, discard first. Destructive zones must not overlap resting hand.
- Duel UI sees only viewFor(), not BoardState. Shared board constants stay in engine/constants.ts. Never force named manualChunks for lazy modules.

## Code and checks
Spanish UI/comments; English identifiers. CSS is BEM-ish, is- states, buttons >=46 px. Menu test hooks: data-act.
Run: typecheck, test, validate, smoke, build:release. Tests use quoted `tests/*.test.ts` glob. validate checks content and literal t() keys. smoke needs dev server at 127.0.0.1:1420 (`npm run dev`); smoke.mjs does NOT start one.
Smoke must use real pointer events, check canvas hit-testing, lazy requests and hidden rival ids. handState()/projectPointToScreen() provide targets. dt capped .05; software-rendered flip needs 1500ms wait (was 700ms, failed mid-animation).
**Always prefix `CODEBUDDY_SAFE_DELETE_ENABLED=0`** to npm run dev/smoke/build (vite re-optimizes deps, WorkBuddyAI safe-delete shim kills the process otherwise).

### Bootstrap/UI traps (all caught by smoke or screenshots)
- `engine.run` NO existe hasta `enterMenu()` — leerlo al arrancar tira undefined y tumba el boot.
- `openOverlay()` LIMPIA las referencias al panel — tomarlas antes las deja en null.
- `setMoney` emite `money:changed` EN EL ACTO — marcar ANTES de cobrar.
- Un dev server viejo sirve CSS con 0 reglas (firma: `document.styleSheets[0].rules === 0`): matar y reiniciar.
- `locator().boundingBox()` devuelve coords validas aunque un overlay tape el elemento: HUD controls solo se prueban sin panel abierto.

Flow: menu -> blind_select -> playing -> reward -> shop (packs without reward skip draft).
Balance reference: mean ante 6.33, wins 29.6%/500. Duel: 4x4, hand 6, defender_holds, randomized starter.

## Render/assets
- low = direct renderer, DPR 1.75; smoke uses low. Higher tiers auto-degrade by p95. OutputPass owns tone mapping; composer MSAA via target samples.
- Card front FrontSide/back BackSide coplanar; flip tween separate from layout. Delayed tween from-values capture on creation.
- Fonts: Fredoka UI, Gasoek display. font-synthesis:none; canvas uses real weights; await fonts.
- Menu = layered composition over public/menu-bg.jpg (art contains title + 4 button frames). Buttons are HTML using per-frame crops positioned in %. `.panel.is-menu` is position:fixed; inset:0.
- Never software-upscale textures (GPU filtering beats it).
- Arena: BoxGeometry with material array (6 draw calls); `buildArena()` doesn't know assets; `applyFloorArt(art)` called from `SceneManager.buildWorld`. NormalMap procedural. Assets vendored in src/render/polyfork/.
- HUD uses menu material: --frame-* tokens SAMPLED from public/menu-btn-play.png (body #094540, moss #2eb2a4, edge #062a2e). Currency "Fungis" with public/ui/fungi.png (pixelated).
- GSAP hibrido: `anim.ts` owns GSAP, driven from `SceneManager.frame()` (NO own rAF). `TweenManager` = simple per-frame tweens. Scale lives in `CardHome.sx/sy/sz` + `Card3D.baseScale`. `stagger` with `{amount}` never `each`. gsap in own chunk.
- Water (F2): analytic Gerstner in `Water.ts`, only in tiers with `environment`; `low` has none. `dt` clamped: `Math.min(0.05, Math.max(0, rawDt))` (first frame can be negative). **Water in `high` is washed out — known open bug.**
- Dado: `blind_select` arms the cube, player drags/releases, `Die3D` integrates physics. Motor sorts BEFORE animating. Face revealed via `die:settled` event. HUD has 3 phases (armed/tumbling/ready); overlay `is-throw` = pointer-events:none + background:none + backdrop-filter:none.
- Carrusel 3D (F1): `CardCarousel.ts` = ring with 11-slot pool. `SceneManager.setCarousel(entries|null, onFocus)` hides game, takes input, frames with `rig.setBase`. **setCarousel snapshots rig base on open, restores on close** (else camera stays pointing at ring). Tap = pickNearest by projected center. Carousel exposes `currentEntries` getter; SceneManager exposes `carouselEntries()` for debug/tests.
- Panels = BOARD; contents = pieces. .panel uses --frame-deep-*; .offer/.reward-card/.deck-card/.collection-card/.daily-day/.daily-focus/.achievement-card/.settings-field share ONE rule with --frame-body-*. Add new screen class to that selector list.

## Retention
P0-P4: `src/retention/*` pure (DailyReward 20h gap, AchievementTracker with predicate+incremental, rewards.ts idempotente). `src/notify/notify.ts` = Tauri plugin v2.5.0. Data in `src/data/*.json` (planos, evaden validate/artCoverage). Profile migration by merge over default — new fields must be added to merge explicitly. Bus: achievement:unlocked, daily:claim, banner:show, pass:xp. Smoke URL `?daily=0` to skip daily modal.
40 WebP card arts +25 SVG icons; 12 per-card files for collision resolution. Card art indexed by (element x rarity), not by card. art:arena and art:cardback are real art (not procedural).

## Mazo fixes (2026-09-30)
- Bug 1 (preview mismatch): carousel received `deckEntries(state.cards)` (deck order) but frame's `sorted` = `sortCards(state.cards, 'element')`. Fixed: `openDeck()` computes sorted once, passes to both carousel and frame via `frame.setSorted(sorted)`. `sortCards` exported from DeckBuilderScreen.
- Bug 2 (camera): `setCarousel(null)` only set `carouselActive=false` + `resize()` → `rig.fit` preserved carousel's direction. Fixed: `CameraRig.snapshotBase()`/`restoreBase()` called in `setCarousel` (snapshot on open, restore on close).
- `t` exposed on `window.__fungiflush` for verification scripts.

## Pending/decisions
- Hand extremes overlap: RESUELTO (2026-09-29), piles at X=±10.5, verified with raycasts.
- Paid Android app + new-content IAP only; Tauri Android API36. Audio deferred to hooks.
