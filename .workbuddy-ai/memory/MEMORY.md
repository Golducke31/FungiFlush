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
**NUNCA `sed -i` sobre un archivo del repo en Windows**: reescribe el archivo y pierde el casing original (`cardTexture.ts` → tsc `TS1261` con `CardTexture.ts`). Usar Edit. Si pasa: `mv` para restaurar el casing de `git ls-files`.

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

## Unlock doors (R2)
`src/data/unlock-rules.json` (plain JSON, 16 rules) → `src/meta/UnlockTracker.ts` (same `{op,path,value}` mini-language as achievements but `when` REQUIRED) → `profile.collection.pendingUnlocks` (id → descKey) → `PackGate` 4th arg → `CollectionEntry.lockReasonKey`.
- `PackGate.contentState` order: `isUnlocked` → **`evolutionTargets`** → `pendingUnlocks` → pack. Changing that order reintroduces silent bugs.
- **An evolution target can NEVER be gated** — it would leave the `CardRegistry` and `EvolutionService.apply()` returns `null` silently. `ContentRegistry.evolutionTargets()` protects it structurally AND the data forbids it (both tested).
- **Live references, never reassign.** `PackGate` holds the profile's `pendingUnlocks` object identity; `publishConditions()` must MUTATE in place (clear + fill), never `p.x = {...}`. Regression-tested.
- Unlock rules must not overlap achievement rewards (a test enforces it): an already-granted item would never close its door, making the published condition a lie.
- Collection "Locked" filter = one entry per open door (16 on a fresh profile).
- Dev hooks: `__fungiflush.unlocks`, `.gate`, `.collection()`.

## Vouchers (R3)
`src/data/packs/base/vouchers.json` (7) → `ContentRegistry.vouchers` → `CardRegistry.rollRandomVoucher` → `OfferService` case `'voucher'` → `GameEngine.buyVoucher`.
- Piezas que NO ocupan slot ni entran al mazo: cambian como se CALCULA la run. Dos mitades: `effects` (se aplican UNA vez al comprar) y `runModifiers` (se leen del agregado en cada consulta: `rerollCostDelta`, `targetMultiplier`, `shopDiscount`).
- **`priceOf(offer)` es la UNICA fuente del precio.** La UI pinta ese numero y `buyOffer` cobra ese numero; leer `offer.cost` en la tienda pinta uno y cobra otro. `canBuyOffer` es la unica fuente del estado del boton (sabe de slots y de vouchers ya poseidos).
- `combineModifiers`: suma deltas, MULTIPLICA multiplicadores (0.9·0.9 = 0.81), compone descuentos como 1-(1-a)(1-b); clampea `targetMultiplier` [0.25, 2] y `shopDiscount` [0, 0.9].
- `extraHands`/`extraJokerSlots`/`extraDiscards`/`extraHandSize`/`extraMoney` estan RESERVADOS para vouchers PERMANENTES (R1): declarados pero NO leidos. Un voucher que los use en `vouchers.json` no hace nada (hay test).
- El sorteo NUNCA ofrece uno ya poseido (ni en la rama de `refId` fijo, que devuelve `undefined` en vez de una trampa). Todos poseidos → tabla vacia → tienda "todo vendido".
- Vouchers viajan en `RunSaveData.vouchers?` SIN bump de SAVE_VERSION: al restaurar se filtran por existencia (`tryGetVoucher`).
- Arte: `CardTextureSpec.kind` incluye `'voucher'` con acento dorado `0xffc857`; `offerFaceUrl` tiene rama propia. Sin cara, `HUD` mete un `.offer-art.is-placeholder` (si no, la tarjeta se encoge y la fila de precios se sale del panel).
- Bus nuevo: `voucher:bought` → banner `banner.voucher.bought` en `main.ts`.
- Tool: `tools/verify-voucher.mjs` (13 chequeos en navegador).


## Mazo fixes (2026-09-30)
- Bug 1 (preview mismatch): carousel received `deckEntries(state.cards)` (deck order) but frame's `sorted` = `sortCards(state.cards, 'element')`. Fixed: `openDeck()` computes sorted once, passes to both carousel and frame via `frame.setSorted(sorted)`. `sortCards` exported from DeckBuilderScreen.
- Bug 2 (camera): `setCarousel(null)` only set `carouselActive=false` + `resize()` → `rig.fit` preserved carousel's direction. Fixed: `CameraRig.snapshotBase()`/`restoreBase()` called in `setCarousel` (snapshot on open, restore on close).
- `t` exposed on `window.__fungiflush` for verification scripts.

## Pending/decisions
- Hand extremes overlap: RESUELTO (2026-09-29), piles at X=±10.5, verified with raycasts.
- Paid Android app + new-content IAP only; Tauri Android API36. Audio deferred to hooks.

## Arte (regla de Emanuel, 2026-10-01)
**Todo arte nuevo es GENERADO POR IA con imagen-a-imagen; nunca procedural ni
SVG** (salvo iconos puntuales donde el SVG gane claramente, caso a caso).
Método: anclar en `art-source/art_card_<elemento>_common.png`, `input_fidelity: medium`,
estilo §0.4 de `ART_PROMPTS.md`. **Texto-a-imagen NO reproduce el estilo** (sale
fotorrealista) — prohibido. Un prompt por asset en `ART_PROMPTS.md`.
Cadena de arte: `public/art/index.json` (npm run art:index) → `ArtAssets` (render)
→ `HTMLImageElement` → cara compuesta por `src/ui/cardArt.ts`.

## UI compartida (2026-10-01)
- `src/ui/cardArt.ts`: `cardFaceUrl(spec, realArt)`, `cardDefFaceUrl(def, t, art)`,
  `offerFaceUrl(offer, engine, t, {card,joker})`. Única fuente de la cara de carta
  en DOM (tienda, recompensa, futuros paneles). No duplicar.
- `.blind-card` ya está en la losa compartida de material; sus inner classes son
  `blind-head/blind-tag/blind-metrics/blind-metric/blind-reward`. Boss del ciego =
  `effects?.length > 0`. Hooks: `data-act="blind"`, `data-blind`, `data-blind-boss`,
  `data-blind-current`.

## R4b — Cosméticos (2026-10-01)
Dorso: `SceneManager.setCardBack(id)` (id→`cardback_<id>`, `default`→`CARD_BACK_KEY`)
reconstruye el `backTexture` ÚNICO con **dispose del viejo + splice de `disposables`**
y lo reaplica a `pileMaterials` + `forEachCard`. Fieltro: `Arena.setFelt(art?)` =
`feltMesh` overlay (visible=false; `default` no lo muestra). `ArtKey` extendido con
`cardback_<id>`/`felt_<id>` (patrones en `keyForFile`/`artFileFor`).
UI: `CosmeticsScreen.ts` + chip menú + `main.ts` (`syncCosmetics` boot, `onEquip`).
Patrón panel: `buildXPanel` + `showX` (snapshot ANTES de `openOverlay`) + `setXState`.

## R4d — Contenido (2026-10-01)
**TRAMPA de arte**: una carta nueva NO puede caer en un (elemento×rareza) ya ocupado
→ `artCoverage` de validate la marca compartida. Salida: arte PROPIO
`art_card_own_<id>.webp`. Generar img2img (ImageGen, `input_fidelity: medium`) anclado
en `art_card_<elem>_common.png` → PNG 2:3 en `art-source/` → `npm run art` (512×744).
Prompts en `ART_PROMPTS.md`. Cartas nuevas también necesitan entrada en `board.json`.
Starters ahora: agresivo (substrato bajo, +spores, cost 3) vs defensivo (substrato
alto, cost 4). 39 cartas / 24 jokers. Balance 19.6% / ante 6.07. Regla de Emanuel:
todo arte nuevo es IA img2img; nunca procedural ni SVG (salvo iconos).

## R5 — Historial (2026-10-01)
`profile.history: RunHistoryEntry[]` (HISTORY_CAP 20, nuevo→viejo), escrito en
`bus.on('game:over')` **deduplicando por seed**. `HistoryScreen.ts` +
`setHistoryState`/`showHistory` + `syncHistory` en main.ts + chip menú. i18n
`history.*`. Trampa de merge: necesita línea propia en el return de
`migrateProfileSave` (como `starterOverrides`) + test de regresión.

