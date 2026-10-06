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
