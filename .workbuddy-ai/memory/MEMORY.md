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
menu → blind_select → playing → reward → shop (leaveShop may detour to interlude). **A "Ciego superado" interstitial (`.panel.is-cleared`, `cleared-continue`) shows BEFORE the reward draft** — HUD `case 'reward'` gates it via `clearedShown`.
Deck: `engine.deckSize` = piles+hand (40); HUD chip `deckDraw/deckSize`; `deckDraw` monotonic within round. `conserveDeck()` returns hand to discard on win/loss.

## UI traps (smoke catches)
- `openOverlay()` replaces (never stacks) the prior panel + clears refs.
- `setMoney` emits `money:changed` immediately — mark sold before charging.
- Stale dev server → CSS 0 rules; kill+restart. `boundingBox()` returns coords even below fold; `mouse.click` at y>innerHeight no-ops.
- `.counter` exists only in `playing`. `elementFromPoint` false-positives pointer-events:none HUD (returns canvas) — test via `is-visible` class.
- Carousel detail painted from render loop — poll after `focusAbs`. `hud.showDeckBuilder()` = DOM grid; 3D carousel via `openDeck()` (shop Mazo).

## Recent (2026-10-03)
- Ante ladder retuned ~3.5–4× (smooth doubling 1100→180000) — Task 2 difficulty. Verify via `sim:balance`.
- Shop: NEW "Venta" (sell) tab `buildSellTab()` reuses `offerFaceUrl` via synthetic `ShopOffer`; two-touch confirm → `onSellJoker`. Buy tab default.
- Legendary Simbionte `joker_loaded_die` (Task 9): locked via `unlock-rules` (win blind ante 8); ability rolls die every 2 hands (`LOADED_DIE_EVERY=2`, starts ready). Die REMOVED from blind flow.
- Auto-sort: `state:changed` listener re-applies `sortHand` via order-independent uid signature (avoids loop).
- More Póker combos: rarity tiers, straights, full house in `combos.ts`.

## Retention/meta
Unlock doors (R2): `unlock-rules.json` → `UnlockTracker` → `pendingUnlocks` → `PackGate`. Vouchers (R3): `priceOf(offer)` only price source. History (R5) cap 20.

## Art rule
All new art AI-generated img2img (never procedural/SVG); anchor `art-source/art_card_<element>_common.png`. `cardFaceUrl`/`offerFaceUrl` single source.

## Open bugs / notes
- Water in `high` tier washed out (render bug).
- Menu = layered composition over `public/menu-bg.jpg` (HTML buttons = per-frame % crops).
- Smoke fixes done 2026-10-03: dismiss `.panel.is-cleared [data-act=cleared-continue]` before reward draft (pre-existing gap — panel added in 4e4ed67, smoke never updated); removed obsolete blind-flow die assertions (die moved to loaded-die joker).
