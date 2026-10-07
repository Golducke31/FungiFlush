# FungiFlush — essentials
TS + Vite + Three.js + Tauri 2 roguelite deckbuilder (Balatro-like). Repo: Golducke31/FungiFlush (`main`).

## ⚠️ MÓVIL PRIMERO (desde 2026-10-04)
- Todo cambio de UI/HUD apunta al MÓVIL landscape. Doc: `docs/CONVENCION_MOVIL_PRIMERO.md`. Ref 915×412 (`pointer:coarse`); smoke 844×390. **Escritorio CONGELADO**; lo pendiente en §6 del doc.
- Preview móvil SIEMPRE: `tools/shot-mobile.mjs` + `tools/probe-mobile-hud.mjs`. `shot-joker-slots.mjs` es ESCRITORIO (1440×810) — no usarlo.
- Gate escritorio `node tools/shot-desktop.mjs` (1440×810, 6 checks) **falla exit 1** si degrada. Tablet: `tools/shot-tablet.mjs` (1180×820, 5).
- Puntero: `src/pointer.ts` ÚNICA fuente (`isCoarsePointer` layout / `isTouchOnly` GPU). NO `matchMedia` suelto.
- `SceneManager.layoutProfile`='mobile'|'tablet'|'desktop' (getter vivo: puntero+`TABLET_MIN_H=600`), separado de `isMobile`(UA+GPU). `TACTILE_PILE_X=±8.5` táctil vs ±10.5 escritorio. Boost carta 1.3 táctil. CSS base=escritorio; móvil=`@media (pointer:coarse)`; tablet=`(pointer:coarse) and (min-height:600px)`.

## Top HUD (estado final 73d6e74)
`.hud-top` relative; `.hud-score` SIN losa, `position:absolute;left:50%;translateX(-50%)` → diana+score centrados. ANTE (izq) y FUNGIS (junto a IDIOMA) conservan losas. `scene.onTransitionProgress`→`HUD.setTransitionProgress` alterna `is-transition-out`(<0.55)/`is-transition-in`(≥0.55).

## Menú principal (rediseño 2026-10-06)
- UI **DESACOPLADA del arte**: `.menu-layout` (flex anclado al viewport) → `.menu-top` (Perfil izq + hamburguesa der) + `.menu-hero` (recomendación + logotipo-botón + estado). El arte es solo fondo.
- **HÉROE = el logotipo como botón**, sin caja, con halo + velo: `public/menu-logo.png` (Nueva partida) y `public/menu-logo-continue.png` (Continuar, solo si hay partida). `[data-act="continue"]` SIEMPRE en el DOM con `is-disabled` sin guardado (lo lee el smoke).
- Secundarias: **Perfil** (arriba-izq → `buildProfilePanel`: Colonia placeholder + stats + Logros + Historial) y **desplegable** `[data-act="menu-toggle"]` → Ajustes (con Guía y Acerca de), Colección (con Cosméticos), Desafíos (`buildChallengesPanel`: Diaria, Ascensión, Arquetipo, Duelo).
- `public/menu-bg.jpg` regenerado SIN los 4 marcos pero **CON el título cian**: el "FUNGI FLUSH" del fondo **ES el logo** (arriba). El botón (logotipo de hongos) va **DEBAJO**, acotado a `min(64vw, 38vh*1.83)` para no pisarlo, con **placa difusa + neón** (el bosque es cian y se lo comía).
- La **recomendación contextual** se RETIRÓ del menú (competía con el logotipo); el dato sigue calculándose en `HUD.setMenuMeta().recommendation`.
- Estado meta: `HUD.setMenuMeta()` + `main.ts syncMenuMeta()`. **Empujarlo ANTES de `engine.enterMenu()`** o el panel no se redibuja.
- "Nueva partida" abre el selector de arquetipo YA en el primer render: las tools que clickean `[data-act="new"]` deben añadir el paso `archetypes-start`.

## Invariants / Checks
- Engine puro (sin DOM/Three). `retention/**` importa `engine/**`. mulberry32 sembrado; VFX NO usa RNG engine. Strings `t()`; `nameKey`/`descKey`; balance en JSON. Render cada rAF; solo HUD/overlay `pointer-events:auto`. Tap ≤6px/700ms.
- `typecheck`/`test`/`validate`/`smoke`/`build:release`. Prefijar dev/smoke/build con `CODEBUDDY_SAFE_DELETE_ENABLED=0`. NUNCA `sed -i` Win (mata casing). `tools/simulate.ts` corre 100 partidas al importar; si el engine gana fase, DEBE ganar branch o aborta. `sim:balance`(500)+`sim:board` verde.

## Flow / Archetypes
- menu→archetypes→blind_select→playing→reward(interstitial "Ciego superado" antes del draft)→shop(leaveShop puede ir a interlude). `deckSize`=piles+hand; classic=40, archetype=20.
- `archetypes.json` fuente de 4 (`spores`/`colony`/`decay`/`crystal`)+`classic`(`''`); leer SOLO vía `src/meta/Archetypes.ts`. `setArchetypeLoadout`→`startRun`. Shop bias `elementWeights={primary:3,secondary:2}`.

## Combos / Jokers
- COMBOS (desde `fe6f09e`): SOLO `element:*`(mult),`family:*`(flat),`diversity:5`. POKER axis ELIMINADO. Ante ladder 1100→180000 (`sim:balance`).
- `jokerSlots` default 5; `ADD_JOKER_SLOTS` (mutation/voucher/interlude/ascensión). P6 `syncJokers` PÚBLICO→`rebuildJokerSlots` (1 plano violeta+edges/slot, `JOKER_SLOT_DY=-0.02`); `jokers[i]`=slot i. `joker_loaded_die`: unlock ante 8, tira cada 2 manos.

## Puntuación / reglas duras (desde e05de77)
- `ResolutionContext.total` = `Math.max(0, Math.round(substrate * spores))`: el SCORE jugable NUNCA es negativo. El desglose (substrate/spores) SÍ puede serlo (la podredumbre resta por disparo en `TriggerEngine`; `ADD_SUBSTRATE` admite negativos). `round.score` acumula con `+=` ⇒ un total negativo bajaba el marcador y la barra.
- `game:over` → `HUD.forceGameOver(reason)`: AUTORIDAD ABSOLUTA sobre la animación. `score:settled` SOLO lo emite la timeline del render (`SceneManager`) ⇒ si se corta (derrota en la última mano), `panelPending` no se resuelve y el panel final no aparece nunca. `schedulePendingPanel` es el respaldo del deadline (antes el deadline solo se miraba al volver a `renderOverlay`).
- Barras de progreso: DOS rutas (`score:changed` y `render`) — proteger SIEMPRE con `Math.max(0, Math.min(100, ...))`.
- Reina Esporada (ante 3, `blind_a3_boss`): `MULTIPLY_SPORES 0.75` (-25% Esporas). Antes `ADD_SUBSTRATE -30` fijo, letal para Cristal.

## Mano / mazo / descarte / orden (desde e85bee8)
- **Mano inicial 6** (`RUN_DEFAULTS.handSize`). Baja el balance: ante promedio 3.14→2.18, ciegos 7.81→4.82 (500 partidas). NO re-tuneado (pedido explícito del usuario).
- **Chip MAZO = "Robables: X/total"** (`hud.drawable` = pila de robo) + chip **"Descarte: Y"** (`hud.discardPile`). Getters `engine.deckDrawPile`/`deckDiscardPile`. Los contadores llevan `data-counter` (ancla por idioma; el smoke la usa).
- **Reciclado**: `Deck.takeReshuffleCount()` + `GameEngine.drawFromDeck()` (único punto de robo) emite `deck:reshuffle`; el HUD avisa (toast `hud.reshuffle`) y `SceneManager.reshuffleToDeck()` lo anima.
- **Descarte**: SIN botón. Se arrastra a la pila o se TOCA la pila (`onDiscardPileTap`, vía `Interaction.onTapEmpty` con plano y=0); soltar una carta seleccionada descarta TODA la selección. `DropZone.setHint` enciende la zona tenue con selección. **La zona de descarte se centra en `discardX` por perfil** (`discardZoneRect`+`syncDropZones`): en táctil la pila va a ±8.5, no ±10.5 (antes ~59 px desalineada).
- **Orden**: SIN botón. Criterio `auto` (Familia→Sustrato DESC→orden original, estable) por defecto; ajuste `autoSortHand` en Ajustes; `main.ts` lo reaplica en `state:changed`.

## Carta seleccionada / jugada (desde Fase A)
- **Seleccionada** = borde VERDE (anillo `uRingColor`=SELECT_COLOR `0x5ef08a`) + **badge numérico 1-5** (`Card3D.badge`, renderOrder 20) + elevación. El **halo está apagado** (`uIntensity=0`) en cartas de mano: el glow aditivo entre vecinas reventaba en blanco. **Los jokers SÍ conservan su halo por rareza** (`kind==='joker'`).
- El número sale del orden de `round.selected` (`indexOf+1`), pasado desde `SceneManager.syncHand`.
- `uRingFalloff` = 9.5 (borde fino). Texturas de dígito cacheadas en `BADGE_TEXTURES`.

## Pilas: etiquetas y columnas (desde Fase C)
- **Orden fijo: DESCARTE a la IZQUIERDA, MAZO a la DERECHA** (el usuario pidió conservarlo; NO invertirlo). `deckX`=+X, `discardX`=-X en todos los perfiles.
- **Etiquetas físicas** `.pile-label` (DOM) dentro del dorso: `SceneManager.pileAnchors()` proyecta las 4 esquinas del plano de la pila → caja (centro+ancho/alto) y el HUD fija `left/top/width/height`. Texto `pile.deck`/`pile.discard` + `pile.drawable`/`pile.discardCount`.
- Se emiten los anclajes en `resize()` **y `state:changed`** (el primer resize corre antes de crear el HUD). Se ocultan con `is-panel-open` (lista en el bloque móvil) y fuera de `playing`.
- **Destello** de las etiquetas al `deck:reshuffle` (`flashPileLabels`).
- `handSpreadClearOfPiles()` acota el abanico a la posición real de las pilas; `HAND_BOOST` (=1.2) es constante compartida con `layoutHand`.

## Card abilities / Art
- Habilidad=`effects?`(:279); `hasAbility=effects?.length>0`. Triggers types:60-100. P7: panel detalle long-press ELIMINADO; descripción móvil=`.hud-tooltip`.
- Art AI img2img; `cardFaceUrl`/`offerFaceUrl` fuente única; cada carta su `art_card_own_<id>.webp` (validator falla si repite). `npm run art`. TRAMPA: `optimize_art.py` fit() RECORTA si ratio≠target (2:1).

## Tipografía / cara compacta
- `--font-ui`=Fredoka; `--font-display`=Gasoek One. Solo stylesheet `src/ui/styles.css`. CARA COMPACTA (táctil): nombre 92px+velo, 2 chips `chipScale 2.2` (glifo+núm). Es TEXTURA 512×744→escala 0,1505; agrandar carta NO agranda texto. Play button SOLO `action.play (N)`. Tutorial reabre desde "Guia".

## Dev debug / traps
- `window.__fungiflush`={engine,scene,hud,bus,content,profileStore,runStore}; `content` es façade NO registry (`content.registry.instantiateJoker`). NUNCA emitir `state:changed` a mano.
- Smoke context 844×390 ⇒ `@media (pointer:coarse)` ACTIVO; verificar escritorio con `shot-desktop.mjs` (no hay bloque fine). Panel abierto oculta run HUD (`is-panel-open`). `.hud-missions`/`.hud-jokers` `pointer-events:none` (smoke `sellHittable`). Flakes: pool `waitForFunction(el===null)` no `waitForTimeout`.

## Colonia Fungi / Esporas de Colonia (desde P20, 2026-10-06)
- Doc: `docs/PLAN_COLONIA_Y_GOOGLE_PLAY.md`. **La Colonia NO toca el combate** (no compra cartas ni da stats de partida). Dos recursos con nombre distinto: **Esporas** (partida, `RunState`) vs **Esporas de Colonia** (permanente, `ProfileSave.colony`). Iconos distintos: `public/ui/fungi.png` vs `public/art/ui_icon_colony.svg`.
- `src/meta/Colony.ts` **puro**: base por ante `[50,75,100,130,165,205,250,300]`; bonos chicos (1ª mano +10, descartes +5, misión +20, diaria +50); anti-farm de 3 frenos (1ª vez 100 % con clave `"ante:blindIndex"` en `firstClears`, repetición 40 %, tope blando 5/día). Niveles con tabla hasta el 10 + extrapolación; **nombres por bandas** (`colony.band.*`). `level` es DERIVADO de `lifetimeSpores` (se recalcula al cargar).
- Perfil **v4**: `colony` + `account` (`src/meta/Account.ts`, estados `offline|pending|synced|conflict`). Migración `migrateProfileV3toV4` + **líneas explícitas en el merge** de `migrateProfileSave`.
- Anti-trampa: se sube `ColonyRunResult` (resultado), NUNCA las Esporas del cliente.
- `src-tauri/src/play_games.rs` = **stubs** del contrato de Play Games. ⚠️ NO hay cargo/rustc/`@tauri-apps/cli`: `src-tauri/` **no se compila en los gates**.
- Gate nuevo: `node tools/probe-colony.mjs` (siembra en `localStorage` + `reload`; NO `patch` en caliente, el HUD lee `menuMeta` y sólo se empuja al entrar al menú).
- ⚠️ **Medir contra el SCROLLER, no contra el viewport**: `getBoundingClientRect()` puede dar "dentro de la ventana" con el elemento recortado por el `overflow` del cuerpo. En 844×390 el panel de Perfil tiene ~210 px útiles: los 5 accesos van en UNA fila y los stats se ocultan en `(pointer: coarse) and (max-height: 560px)`, o la fila de cuenta queda recortada y el smoke falla (cliquea en el centro REAL del botón).

## Tauri Android / Play Games / ranking (desde P21, 2026-10-06)
- **Toolchain instalado en la máquina** (NO está en el PATH: exportar en cada sesión):
  `~/.cargo/bin` (Rust 1.99 + targets Android) y `~/.workbuddy-ai/binaries/mingw/mingw64/bin` (MinGW-w64 16.2, enlazador del host). SDK Android ya estaba en `$ANDROID_HOME`. CLI: `@tauri-apps/cli@^2` (devDependency). ⚠️ `winget install` de MinGW **se cuelga**: bajar el zip de GitHub releases + extraer con Python.
- Compilar el contenedor: `cd src-tauri && cargo check --target aarch64-linux-android` (Android) y `cargo check` (host). Ambas ramas del `cfg` deben compilar.
- **`src-tauri/gen/android` SE VERSIONA** (el proyecto Android real; sólo se ignora `gen/schemas/`). Ahí viven `PlayGamesBridge.kt` y `MainActivity.kt`. `MainActivity` es `TauriActivity` (no tocar).
- Puente de Play Games: **JNI, no plugin de Tauri** (`Account.ts` → `play_games.rs` → `PlayGamesBridge.kt`). `signIn` bloquea (`Tasks.await`) ⇒ `spawn_blocking`; Kotlin devuelve JSON con `status` ok/cancelled/error. Falta el **APP_ID** real en `strings.xml` (placeholder `0`) y la **huella SHA-1** en Play Console.
- V1.3 ranking: `src/meta/Leaderboard.ts` (puro) + `src/net/LeaderboardClient.ts` (endpoint por `VITE_LEADERBOARD_URL`; sin variable queda apagado) + `src/meta/LeaderboardSync.ts` + `server/leaderboard/server.mjs` (referencia). **El sync NO re-acredita Esporas locales** (duplicaría / borraría progreso offline); el servidor es la fuente de verdad del TABLERO.
- ⚠️ **NUNCA correr el smoke en paralelo con `cargo`**: la contención de CPU baja SwiftShader a <12 FPS y las aserciones de arrastre fallan con 1 fallo distinto cada vez. Parece bug real; en limpio da 0/0/0.
- ⚠️ **`waitForTimeout` NO sirve para medir el render**: a ~12 FPS y con una captura previa congelando el compositor, la medición cae entre frames. Usar `waitForFunction` sobre la CONDICIÓN; para un hit-stop de 70 ms, muestrear por rAF desde ADENTRO de la página (por round-trip se pierde). Para animaciones, esperar `score:settled`.
- **Espiar VFX**: los `private` de TS se borran en runtime ⇒ se pueden envolver `scene.particles.burst` y hasta `scene.comboFlourish` desde el navegador para asertar colores/cantidades sin mirar píxeles. Y forzar el estado reescribiendo `hand[i].def = {...def, element, family}` (mismo elemento = Floración; misma familia con elementos distintos = Colonia).

## Paneles / Jefe / estados / combos (desde P22, 2026-10-06)
- ⚠️ **El contenido del panel del CIEGO del JEFE mide ~366px FIJOS**: a 412/390 entra, a **360** (celular real con barra del navegador) el pie se sale y "Luchar" queda no clickeable. Por eso los gates a 412 no veían el bug. `audit-mobile-buttons.mjs` acepta **`FF_HEIGHT=360`** para correrlo ahí.
- El aviso de interludio (`.blind-help.is-interlude`, solo si `targetMultiplier !== 1`) agregaba el bloque que desbordaba. **No es un banner** (el banner es `fixed` y se encuela con overlay abierto) y **no existe ningún +10%**: los valores reales son +15%, +20%, −15%.
- Fix: el contenido va en `.blind-body`, sumado a la lista de **cuerpos flexibles de P8** en `styles.css`. Sin eso, P8 (especificidad 0,3,0) le gana a `.is-blind-select` (0,2,0) y su `overflow-y:auto` nunca aplica; con `overflow:hidden` el recorte come el PIE.
- **Estados (P2.6)**: `status:applied`/`consumed`/`expired` (antes `res.statusRequests` era dato muerto). `decayStatuses` recorre `Deck.allCards` = robo + descarte, **NO la mano** (importa al testear). Aura ambiental = `uRot` en el shader del halo, un uniform por carta de la mano por frame; se apaga con `reduceMotion`.
- ⚠️ **Bug latente NO corregido**: `APPLY_STATUS` muta sin respetar `dryRun` (a diferencia de `CONSUME_STATUS`), y `preview()` corre la resolución entera en cada cambio de selección ⇒ una carta con ese efecto deja el estado puesto con solo seleccionarla. El EVENTO sí está blindado.
- **Combos (P2.3)**: decisión de Emanuel ⇒ **`closeCombo` SIGUE en todas las manos** (no se gateó). Encima `comboFlourish(eje, tier)`: dorado = elemento, ámbar = familia, verde = diversidad; intensidad por tier. Se consumen los `cardUids` para pulsar esas cartas y unirlas con micelio.
- ⚠️ **Nada de comillas invertidas dentro de los comentarios GLSL** de `Shaders.ts`: viven en un template literal de TS y una sola cierra el shader entero (rompe el typecheck con errores raros).
