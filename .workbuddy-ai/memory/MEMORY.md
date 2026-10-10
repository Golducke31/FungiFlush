# FungiFlush — essentials

TS + Vite + Three.js + Tauri 2 roguelite deckbuilder (Balatro-like). Repo `Golducke31/FungiFlush` (`main`). **Escritorio CONGELADO**; móvil primero. Docs `docs/CONVENCION_MOVIL_PRIMERO.md`, `docs/DESIGN_ESCRITORIO.md`. CSS único `src/ui/styles.css`: base=escritorio; móvil=`@media (pointer:coarse)`; tablet=`(pointer:coarse) and (min-height:600px)`; escritorio solo en el `@media (pointer:fine)` final. `src/pointer.ts` = única fuente de puntero (nunca `matchMedia`).

## Gates (prefijo `CODEBUDDY_SAFE_DELETE_ENABLED=0`)
`typecheck`·`test`(node tsx, 506)·`validate`·`audit:desc`·`smoke`·`sim:balance`(500)·`sim:hands`·`sim:board`·`gate:desktop`(31 pantallas)·`gate:parity`(dual, baseline `tools/parity-baseline.json`, `--update` re-basa).
- Smoke necesita server en **127.0.0.1:1420** (`npm run dev`); no lo arranca. Nunca en paralelo con `cargo`.
- ⚠️ Nunca `sed -i` (Windows rompe casing). `waitForTimeout` no mide render → `waitForFunction`. Botón animado → `boundingBox()`+`mouse.click`.
- ⚠️ Sondas Playwright: `playwright-core` desde `C:/Users/emanu/.workbuddy-ai/binaries/node/workspace/node_modules/`; ejecutar DESDE el repo. Móvil: `newContext({viewport:{width:915,height:412},isMobile:true,hasTouch:true})`. Dos contextos simultáneos NO funcionan (SwiftShader).
- ⚠️ Arte: venv `.../python/envs/fungiflush/Scripts/python.exe` (Pillow/numpy/cv2); `npm run art*` usa `python` pelado (sin numpy).
- VFX test: `tools/ff-harness.html` + `tools/_ff_capture.mjs`. `page.screenshot()` NO captura WebGL (usar `canvas.toDataURL()`); bombear `updateAnim(dt)`.

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

## Mazo clásico
10 starters ×3 + 5 puente ×2 con tag `starter` (`colony_agaric_thread`, `crystal_agaric_facet`, `spore_clavaria_spray`, `crystal_boletus_prism`, `colony_boletus_root`) = 40. Rompe la biyección elemento↔familia ⇒ cruzar ejes posible (`sim:hands` "familia cruza" 0%→31%). El tag `starter` solo lo consume `buildStarterDeck` (`copies` default 1).

## Tutorial (2 capítulos)
- `src/meta/Tutorial.ts` puro: **25 pasos**, `chapter:'classic'|'advanced'`. Clásico **20**, avanzado 5 (mazo `decay`). `TUTORIAL_SEED=0xf00d` (mano: 3 decay/polyporaceae + 3 spore/agaricaceae → solapamiento real). `stepAfter` filtra por chapter+phase+require; `isFinalStep` = último de SU capítulo.
- Pasos de `playing` (primera mano, `require handsPlayed===0`): hand_dealt, select_cards, combo_hint, element_family, **discard**, **fungi_flush**, play_hand. `discard.bodyKey='guide.tutorialDiscard'` (cadena antes muerta, reusada a propósito). `fungi_flush` ancla `[data-act="use-fungi-flush"]`. Las anclas WebGL (mano / pila de descarte) usan `[data-act="select-hint"]`.
- ⚠️ `advanceTutorial(force=false)` (main.ts) es **IDEMPOTENTE**: si el paso en pantalla sigue aplicando (`isStepApplicable`, `Tutorial.ts`) un `state:changed` NO lo consume; `force=true` solo para "Siguiente"/"Saltar paso". Sin esto, cada `toggleSelect` (que emite `state:changed`) se comía un paso `tap` y el doble aviso al entrar a `playing` (state:changed + hand:dealt) saltaba `hand_dealt`.
- UI: `HUD.showTutorialStep/hideTutorialStep` (capa `#ui-root > .tut-layer`, spotlight). Controller `main.ts` (`startTutorialChapter`, `finishTutorialChapter`). ⚠️ NO tocar la Guía `HUD.showTutorial`/`.panel.is-tutorial` (la asevera el smoke). Probe `tools/probe-tutorial.mjs`; test `tests/tutorial.test.ts` (asume 25/20/5 y el orden del clásico).

## Arquetipos / progresión
- **Puerta**: la PRIMERA run arranca con el mazo CLÁSICO; el selector se DESBLOQUEA al superar el primer Ciego. Campo top-level aditivo `ProfileSave.archetypesUnlocked` (default `false`); migración back-fillea por `stats.runs>0 || wins>0 || archetype.selected!==''`.
- **Palanca ÚNICA**: `syncArchetypes()` (main.ts) empuja `list: []` si bloqueado ⇒ el menú arranca directo con `onStartRun`. Disparo en `round:win` de la Colonia (banner `banner.archetype.unlocked`; los banners se APILAN). DEV `__fungiflush.unlockArchetypes()`.
- ⚠️ `smoke.mjs`/`shot-desktop.mjs`/`parity-layout.mjs`/`probe-tutorial.mjs` SIEMBRAN `{version:7,archetypesUnlocked:true}` con `addInitScript`. Probes `probe-archetype-gate.mjs`, `probe-cosmetics-card.mjs`.

## Ascensión (dificultad elegible)
- Datos: `src/data/packs/base/ascensions.json` (A1..A8; **A0 no se declara** = ausencia de mods). Tipo `AscensionModifiers` (`types.ts:590`). Se aplican en DOS momentos: al crear la run (`createRunState`: dinero/mano/manos/descartes/slots) y en cada consulta (objetivo `targetFor`, `priceOf`, `rerollPrice`, `purgeCost`, `canRerollDie`). `startRun` clampea al máximo del contenido. Desbloqueo: ganar (victory) en el nivel N abre N+1, monótono (`main.ts:582-591`).
- Panel: `buildAscensionPanel` (`MenuScreen.ts`). El chip vive en **Desafíos** (`.panel.is-challenges [data-act="ascension"]`), NO en el menú. Las filas de "qué agrega este nivel" se DERIVAN comparando modificadores (`ascensionDeltas`), no de la prosa.
- ⚠️ `.ascension-card` necesita **`flex: 0 0 auto`**: su `min-height:46px` anula el mínimo automático de flex y, sin shrink 0, la lista encoge las tarjetas y el texto se desborda pisando la siguiente (solo se veía al pasar `modifiers`, como hace la app real).
- ⚠️ `moneyDelta` es un **override** del dinero inicial, no un delta (A5-A8 arrancan con 2 Fungis). `extraBossEffects` está soportado por el motor (`GameEngine.ts:431`) pero **no declarado en ningún JSON**.

## Cosmeticos / Tarjeta de Jugador
- `HudCallbacks.onRefreshCosmetics?` se llama al INICIO de `HUD.showCosmetics()` ⇒ el panel pinta estado fresco (reclamar/equipar).
- `PlayerCard.ts`: `.player-card-avatar.is-placeholder` cuando falta el avatar O el webp falla. CSS solo para la tarjeta GRANDE vía `.player-card:not(.player-card--mini)`. Chip del menú y tarjeta grande comparten `cosmeticArtUrl`.

## Idioma
- Arranca en **INGLÉS**: `defaultProfile().settings.lang='en'`; `detectLang()` NO adivina por `navigator.language` (solo `localStorage['fungiflush.lang']`). Un perfil existente conserva su `lang`.
- **ÚNICO control**: botón **EN/ES** en la barra del menú (`MenuScreen.langChip`, `data-act="lang"`). NO hay toggle en Ajustes ni en el panel in-game.
- ⚠️ `profile.settings.lang` GANA al detectado ⇒ `onToggleLanguage` debe hacer `patch` + **`saveNow()`** (autosave debounced 1.2 s).
- ⚠️ `renderOverlay` sale temprano si el estado no cambió ⇒ el handler `i18n:changed` del HUD hace `lastStatus = null`.
- ⚠️ Los gates asumen inglés: usar `ff.t('clave')`, no literales. Probe `probe-menu-language.mjs`.

## Mano / pilas / menú / tienda
- Mano inicial 6. Descarte y Orden SIN botón (arrastrar/tocar la pila). Pilas: DESCARTE IZQ, MAZO DER. Seleccionada = borde verde `0x5ef08a` + badge 1-5.
- ⚠️ Zoom `.is-armed` de JUGAR MANO usa `transform` (no reserva layout): `.hud-actions{gap:26px}` + `.btn.is-play.is-jm{flex:0 1 auto}` + `.is-armed{scale(1.08)}`.
- ⚠️ `:disabled` gana a `!important` (vía `animation`): para medir `is-armed` hay que SELECCIONAR de verdad (`engine.toggleSelect`).
- Menú: `.menu-layout`→`.menu-top`+`.menu-hero`; logo horneado en `public/menu-bg.jpg`. Hooks `data-act`: new,continue,profile,menu-toggle,settings,collection,challenges,tutorial-start,archetypes-start.
- Tienda/recompensa: `.offer` grid, sin cajas; `--offer-cols` (tope 6); 4 ofertas (5 desde ante 5). ⚠️ No subir `descFontPx` (23/25): `audit:desc --scale=1.15` trunca.

## Colonia / sobres / arte
- `src/meta/Packs.ts` puro (un sobre = especímenes a la COLECCIÓN, no al mazo). `src/render/PackOpening.ts` overlay WebGL (⚠️ `CanvasTexture.needsUpdate` o carta negra).
- Colonia `src/meta/Colony.ts` puro, `level` de `lifetimeSpores`. `COLONY_REWARDS`+`claimColonyRewards`: entrega = RECLAMAR (no auto-equip). Back-fill en migración (tests R11/R12).
- Arte: `cardFaceUrl`/`offerFaceUrl` única. Cartas 2:3 (512×744); arena 2:1. `--font-ui`=Fredoka; `--font-display`=Gasoek One.
- ⚠️ **Rutas de arte RELATIVAS** (`art/...`, SIN barra inicial): build `base:'./'`. `ArtAssets.BASE='art/'` y `cosmeticArtUrl()` deben coincidir. Una ruta ABSOLUTA `/art/...` da 404 y el `<img>` se auto-elimina ⇒ hueco.

## FungiFlush (insignia)
1 uso por ciego y solo con 3 cargas; al usar vuelve a 1 (`FUNGI_FLUSH_AFTER_USE_CHARGES=1`). Se carga +1 al cerrar una mano con combo grande (elemento ≥3 o familia ≥4). `SPORE_MULT=2.5`, `DRAW=2`, limpia `decay`/`spore_lock`. Save aditivo. HUD `.btn.is-fungi-flush` (`data-act="use-fungi-flush"`); VFX `src/render/FungiFlushFx.ts` (instancia ÚNICA). ⚠️ Falta bundlear "Bagel Fat One" (logo cae a Arial Black).

## ⚠️ WebGL / traps varios
- Cualquier overlay con `WebGLRenderer` propio DEBE llamar **`forceContextLoss()` ANTES de `dispose()`** al destruirse (si no, el navegador evicta el canvas del juego). `SceneManager` escucha `webglcontextlost/restored`.
- ⚠️ **`dist/` OBSOLETO**: archivos nuevos en `public/` NO llegan al build hasta `npm run build`; `npm run dev` sirve `public/` directo y engaña. Reconstruir tras tocar `public/`.
- ⚠️ Panel del CIEGO JEFE ~366px fijos: a 360px el pie se sale y "Luchar" no es clickeable.
- ⚠️ `rig.fit()`=max(distForWidth,distForHeight): móvil manda el ALTO, escritorio el ANCHO ⇒ cámara lejos en 16:9.
