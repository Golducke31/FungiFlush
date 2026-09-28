# FungiFlush — project essentials

TypeScript + Vite + Three.js + Tauri 2 roguelite deckbuilder. Repo: Golducke31/FungiFlush, main.

## Invariants
- Engine stays pure: no DOM/Three.js. UI/render observe events; controllers handle intentions. Inject rules/predicates; add sibling modules instead of changing scoring/triggers.
- Seeded mulberry32 is deterministic; visual effects never consume engine RNG.
- Visible strings use t(); content uses nameKey/descKey. Balance lives in JSON packs.
- Saves migrate; profiles never return null. Evolution preserves uid; deck edits require canEditDeck(). dryRun handlers accumulate deltas, never mutate global state.
- Render every rAF. UI must not shield canvas: only explicit interactive HUD/overlay layers use pointer-events:auto; never #ui-root > *.
- Tap <=6 px/700 ms; drag >10 px. Drop zones resolve in list order, discard first. Destructive zones must not overlap resting hand (formerly maxZ 2.8 vs hand z>=3).
- Duel UI sees only viewFor(), not BoardState. Shared board constants stay in engine/constants.ts. Never force named manualChunks for lazy modules.

## Code and checks
Spanish UI/comments; English identifiers. UI owns DOM and emits callbacks. CSS is BEM-ish, is- states, safe-area variables, buttons >=46 px. Menu test hooks: data-act.
Run typecheck, test, validate, sim, smoke, build:release. Node tests use quoted tests/*.test.ts glob. validate checks content and literal t() keys. smoke needs a dev server at 127.0.0.1:1420 (`npm run dev`); smoke.mjs does NOT start one.
Smoke must use real pointer events, check canvas hit-testing, lazy requests and hidden rival ids in DOM. handState()/projectPointToScreen() provide targets. dt capped .05: software-rendered animations need extra settling; inspect screenshots.
Flow: menu -> blind_select -> playing -> reward -> shop (packs without reward skip draft).
Balance reference: mean ante 6.33, wins 29.6%/500; judge mean ante, not noisy win rate. Duel: 4x4, hand 6, defender_holds, randomized starter; sim:board measures fairness.

## Render/assets
low = direct renderer, DPR 1.75; smoke uses low. Higher tiers auto-degrade by p95. OutputPass owns tone mapping; composer MSAA via target samples, resize pixelRatio then size.
Card front FrontSide/back BackSide coplanar; flip tween separate from layout. Delayed tween from-values capture on creation: chain return legs onComplete.
Fonts: Fredoka UI, Gasoek display, Pirata One wordmark (now unused: the menu title is part of the artwork). font-synthesis:none; canvas uses real weights; await fonts.
Menu = layered composition over public/menu-bg.jpg (the art already contains the title + 4 button frames). The 4 buttons are HTML using per-frame crops (public/menu-btn-*.png, English labels inpainted out) positioned in % of the art; `background-size: cover` is replicated with min/max-aspect-ratio media queries so the % positions stay glued to the frames at any aspect. `.panel.is-menu` is `position:fixed; inset:0`. Frame positions in MenuScreen.ts FRAMES (art 1376x768).
Never software-upscale a texture before use (GPU filtering beats it): pass photos at native resolution.
40 WebP card arts +25 SVG icons; retain 11 legacy fallbacks. art:index prevents 404s; art processing crops, never stretches. Sources in ignored art-source; contact sheets outside public. ART_PROMPTS.md and game-art-asset-pipeline cover image-to-image style anchors.

## Pending/decisions
Hand extremes overlap fixed piles (x +/-7.8 vs fan +/-8.25). Move piles and update camera/drop zones, not shrink hand fan. Reverify real raycasts.
Paid Android app + new-content IAP only; Tauri Android API36. Audio deferred to hooks; progression remains linear.
