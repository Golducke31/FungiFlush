# FungiFlush — essentials

TS + Vite + Three.js + Tauri 2 roguelite deckbuilder (Balatro-like). Repo `Golducke31/FungiFlush` (`main`). **Escritorio CONGELADO**; móvil primero. Docs: `docs/CONVENCION_MOVIL_PRIMERO.md`, `docs/DESIGN_ESCRITORIO.md`. CSS único `src/ui/styles.css`: base=escritorio; móvil=`@media (pointer:coarse)`; tablet=`(pointer:coarse) and (min-height:600px)`; escritorio solo en el `@media (pointer:fine)` final. `src/pointer.ts` = única fuente de puntero (nunca `matchMedia`).

## Gates (prefijo `CODEBUDDY_SAFE_DELETE_ENABLED=0`)
`typecheck`·`test`(node tsx)·`validate`·`audit:desc`·`smoke`·`sim:balance`(500)·`sim:hands`·`sim:board`·`gate:desktop`(31 pantallas)·`gate:parity`(dual, baseline `tools/parity-baseline.json`, `--update` re-basa).
- Smoke necesita server en **127.0.0.1:1420** (`npm run dev`); no lo arranca. Nunca en paralelo con `cargo`.
- ⚠️ Nunca `sed -i` (Windows rompe casing). `waitForTimeout` no mide render → `waitForFunction`. Botón animado → `boundingBox()`+`mouse.click`.
- ⚠️ Sondas Playwright: `playwright-core` desde `C:/Users/emanu/.workbuddy-ai/binaries/node/workspace/node_modules/`; ejecutar DESDE el repo. Móvil: `newContext({viewport:{width:915,height:412},isMobile:true,hasTouch:true})`.
- ⚠️ Arte: usar venv `.../python/envs/fungiflush/Scripts/python.exe` (Pillow/numpy/cv2); `npm run art*` usa `python` pelado (sin numpy).

## Arquitectura / invariantes
- Engine puro (sin DOM/Three); mulberry32 sembrado; VFX no usa el RNG del engine. Strings `t()` (ES+EN o `validate` falla); balance en JSON. Tap ≤6px/700ms.
- Flow: menu→archetypes→blind_select→playing→reward→shop(→interlude). `deckSize`=piles+hand; classic=40, arquetipo=24.
- `archetypes.json` solo vía `src/meta/Archetypes.ts`. Shop bias `elementWeights {primary:3,secondary:2}`.
- `window.__fungiflush` (DEV)={engine,scene,hud,bus,content,profileStore,runStore,audio,unlocks,gate,collection,openPack,openDeck,syncDeck,board,startTutorialChapter,…}. Nunca emitir `state:changed` a mano. Panel abierto oculta el run HUD (`is-panel-open`).
- Content = packs `src/data/packs/<id>/pack.json` (glob eager). Sin `pack.<id>` en `entitlements.owned` las cartas salen bloqueadas.
- Perfil **v7**. `migrateProfileSave` nunca null; su `return` es EXPLÍCITO ⇒ un campo TOP-LEVEL nuevo va ahí (los anidados sobreviven por spread).
- Puntuación `total = max(0, round(substrate*spores))`; `round.score` acumula con `+=`. `game:over`→`HUD.forceGameOver`; `score:settled` solo lo emite la timeline del render.

## Combos / Orden / Estados
- COMBOS (`src/engine/scoring/combos.ts`, reglas en código): `element:*` (mult esporas 5→3.0/4→2.2/3→1.6/2→1.25), `family:*` (flat sustrato 5→100/4→50/3→20), `diversity:5` (+25). Poker eliminado.
- **Solapamiento**: familia que solapa con el elemento ya activado paga `1-(1-0.4)*ratio` ⇒ solapamiento total 40, cruzar ejes +25%. `ComboResult.overlapped` lo expone.
- Orden (`orderBonus.ts`): Escalera +18 (sustrato estrictamente creciente), Corona ×1.25 (última carta la más fuerte). i18n `order.ladder/crown`.
- `ScoreBreakdown` trae `combos[]`, `orderKeys[]`, `overlapFamily` (además de `comboKeys`).
- ⚠️ `APPLY_STATUS` difiere la mutación (`statusRequests`), pero condiciones y `CONSUME_STATUS` **sí ven los pendientes** (`ConditionWorld.pendingStatuses`).
- ⚠️ Las condiciones se evalúan contra el SUJETO (`source.card`), no contra quien disparó. En SIMBIONTES `sourceFromJoker` no expone `card` ⇒ condiciones de dueño SIEMPRE falsas. `is_first/last_card_of_hand` siempre falsas en eventos GLOBALES.
- ⚠️ `RETRIGGER` re-emite `ON_PLAY` ⇒ bucle si el efecto escucha `ON_PLAY` (usar `once:"per_round"`).

## Mazo clásico (arreglado 2026-10-10)
10 starters ×3 copias + 5 cartas puente ×2 con tag `starter` (`colony_agaric_thread`, `crystal_agaric_facet`, `spore_clavaria_spray`, `crystal_boletus_prism`, `colony_boletus_root`) = 40. Rompe la biyección elemento↔familia ⇒ cruzar ejes es posible (`sim:hands` classic "familia cruza" 0%→31%). El tag `starter` solo lo consume `buildStarterDeck` (`copies` default 1).

## Tutorial (2 capítulos)
- `src/meta/Tutorial.ts` puro: 23 pasos, `chapter:'classic'|'advanced'`. Clásico 18 (mazo clásico, incluye `overlap_axes`), avanzado 5 (mazo `decay`, demos en vivo). `TUTORIAL_SEED=0xf00d` (su mano: 3 decay/polyporaceae + 3 spore/agaricaceae → solapamiento real). `stepAfter` filtra por chapter+phase+require; `isFinalStep` = último de SU capítulo.
- UI: `HUD.showTutorialStep/hideTutorialStep` (capa `#ui-root > .tut-layer`, spotlight). Controller en `main.ts` (`startTutorialChapter`, `finishTutorialChapter`). ⚠️ NO tocar la Guía `HUD.showTutorial`/`.panel.is-tutorial` (la asevera el smoke).
- Probe `tools/probe-tutorial.mjs`; test `tests/tutorial.test.ts`.

## Arquetipos / progresión (2026-10-10)
- **Puerta**: la PRIMERA run arranca con el mazo CLÁSICO; el selector se DESBLOQUEA al superar el primer Ciego. Campo top-level aditivo `ProfileSave.archetypesUnlocked` (default `false`); migración back-fillea por `stats.runs>0 || wins>0 || archetype.selected!==''`.
- **Palanca ÚNICA**: `syncArchetypes()` (main.ts) empuja `list: []` si bloqueado ⇒ el menú (`list.length`) arranca directo con `onStartRun` y la tarjeta de arquetipos de Desafíos desaparece. Disparo en el handler `round:win` de la Colonia (banner `banner.archetype.unlocked`; los banners se APILAN). DEV hook `__fungiflush.unlockArchetypes()`.
- ⚠️ `smoke.mjs`/`shot-desktop.mjs`/`parity-layout.mjs`/`probe-tutorial.mjs` SIEMBRAN `{version:7,archetypesUnlocked:true}` con `addInitScript` (si no, el selector no aparece). Probes: `probe-archetype-gate.mjs`, `probe-cosmetics-card.mjs`.

## Cosmeticos / Tarjeta de Jugador
- `HudCallbacks.onRefreshCosmetics?` se llama al INICIO de `HUD.showCosmetics()` (main.ts → `syncCosmetics()`) ⇒ el panel siempre pinta el estado fresco (reclamar/equipar).
- `PlayerCard.ts`: `.player-card-avatar.is-placeholder` cuando falta el avatar O el webp falla (círculo+seta). CSS solo para la tarjeta GRANDE vía `.player-card:not(.player-card--mini)`. El chip del menú (`buildMiniPlayerCard`) y la tarjeta grande comparten `cosmeticArtUrl`.

## Idioma
- El juego **arranca en INGLÉS**: `defaultProfile().settings.lang='en'` y `detectLang()` (i18n) NO adivina por `navigator.language` (solo respeta `localStorage['fungiflush.lang']`). Un perfil existente conserva su `lang`.
- **ÚNICO control**: botón **EN/ES** en la barra superior del menú (`MenuScreen.langChip`, `data-act="lang"`, clase `menu-gel--lang`, muestra el idioma ACTIVO). NO hay toggle en Ajustes ni en el panel de salida in-game.
- ⚠️ `profile.settings.lang` GANA al detectado en el arranque ⇒ `onToggleLanguage` (main.ts) debe hacer `patch` + **`saveNow()`** (el autosave es debounced 1.2 s y el cambio se perdía al cerrar enseguida).
- ⚠️ `renderOverlay` sale temprano si el estado no cambió ⇒ el handler `i18n:changed` del HUD hace `lastStatus = null` para redibujar el panel abierto.
- ⚠️ Los gates asumen inglés: usar `ff.t('clave')` en vez de literales (`'SOLD'`, no `'VENDIDO'`). Probe `tools/probe-menu-language.mjs`.

## Mano / pilas / menú / tienda
- Mano inicial 6. Descarte y Orden SIN botón (arrastrar/tocar la pila). Pilas: DESCARTE IZQ, MAZO DER. Seleccionada = borde verde `0x5ef08a` + badge 1-5.
- ⚠️ Zoom `.is-armed` de JUGAR MANO usa `transform` (no reserva layout): `.hud-actions{gap:26px}` + `.btn.is-play.is-jm{flex:0 1 auto}` + `.is-armed{scale(1.08)}`.
- ⚠️ `:disabled` gana a `!important` (vía `animation`): para medir `is-armed` hay que SELECCIONAR de verdad (`engine.toggleSelect`).
- Menú: `.menu-layout`→`.menu-top`+`.menu-hero`; logo horneado en `public/menu-bg.jpg`. Hooks `data-act`: new,continue,profile,menu-toggle,settings,collection,challenges,tutorial-start,archetypes-start.
- Tienda/recompensa: `.offer` grid, sin cajas; `--offer-cols` (tope 6); siempre 4 ofertas (5 desde ante 5). ⚠️ No subir `descFontPx` (23/25): `audit:desc --scale=1.15` trunca.

## Colonia / sobres / arte
- `src/meta/Packs.ts` puro (un sobre = especímenes a la COLECCIÓN, no al mazo). `src/render/PackOpening.ts` overlay WebGL (⚠️ `CanvasTexture.needsUpdate` o carta negra).
- Colonia `src/meta/Colony.ts` puro, `level` derivado de `lifetimeSpores`. `COLONY_REWARDS` + `claimColonyRewards`: entrega = RECLAMAR (no auto-equip). Back-fill en migración (tests R11/R12).
- Arte: `cardFaceUrl`/`offerFaceUrl` única. Cartas 2:3 (512×744); arena 2:1. `--font-ui`=Fredoka; `--font-display`=Gasoek One.
- ⚠️ **Rutas de arte RELATIVAS** (`art/...`, SIN barra inicial): build `base:'./'` (Tauri + subpath). `ArtAssets.BASE='art/'` y `cosmeticArtUrl()` deben coincidir. Una ruta ABSOLUTA `/art/...` da 404 fuera de la raíz y el `<img>` se auto-elimina ⇒ hueco (bug real de la Tarjeta de Jugador).
- **Capas/parallax ELIMINADO por rollback (2026-10-09)**: no hay `ArtLayers.ts` ni `public/art/layers/`. Cartas con arte único.

## FungiFlush (insignia) — 2026-10-10
1 uso por ciego y solo con 3 cargas; al usar vuelve a 1 (`FUNGI_FLUSH_AFTER_USE_CHARGES=1`). `SPORE_MULT=2.5`, `DRAW=2`, limpia `decay`/`spore_lock`. Save aditivo. HUD `.btn.is-fungi-flush` (`data-act="use-fungi-flush"`); VFX `src/render/FungiFlushFx.ts` (instancia ÚNICA reutilizada). Pop-ups `onComboBanner`/`onAbilityBanner` compactos. ⚠️ Falta bundlear "Bagel Fat One" (logo cae a Arial Black).

## ⚠️ WebGL: fugas de contexto (pantalla en blanco)
Cualquier overlay con `WebGLRenderer` propio DEBE llamar **`forceContextLoss()` ANTES de `dispose()`** al destruirse (si no, el navegador evicta el canvas del juego). `SceneManager` escucha `webglcontextlost/restored`.

## Traps varios
- ⚠️ **`dist/` OBSOLETO**: cualquier archivo nuevo en `public/` (arte, audio) NO llega al build hasta `npm run build`. `npm run dev` sirve `public/` directo y engaña (parece que anda). Reconstruir tras tocar `public/`.
- ⚠️ Panel del CIEGO JEFE ~366px fijos: a 360px el pie se sale y "Luchar" no es clickeable.
- ⚠️ Dos contextos Playwright simultáneos no funcionan (SwiftShader); `gate:parity` crea→recorre→cierra cada sesión.
- ⚠️ `rig.fit()`=max(distForWidth,distForHeight): móvil manda el ALTO, escritorio el ANCHO ⇒ cámara lejos en 16:9.
- VFX test: `tools/ff-harness.html` + `tools/_ff_capture.mjs`. `page.screenshot()` NO captura WebGL (usar `canvas.toDataURL()`); el harness debe bombear `updateAnim(dt)`.
