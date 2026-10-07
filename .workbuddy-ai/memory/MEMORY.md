# FungiFlush — essentials

TS + Vite + Three.js + Tauri 2 roguelite deckbuilder (Balatro-like). Repo: Golducke31/FungiFlush (`main`).

## ⚠️ MÓVIL PRIMERO (desde 2026-10-04)
- Toda UI/HUD apunta al MÓVIL landscape. Doc `docs/CONVENCION_MOVIL_PRIMERO.md`. Ref 915×412; smoke 844×390. **Escritorio CONGELADO**.
- `src/pointer.ts` ÚNICA fuente de puntero (`isCoarsePointer` layout / `isTouchOnly` GPU). NO `matchMedia` suelto.
- `SceneManager.layoutProfile`='mobile'|'tablet'|'desktop' (puntero + `TABLET_MIN_H=600`), separado de `isMobile` (UA+GPU). CSS base=escritorio; móvil=`@media (pointer:coarse)`; tablet=`(pointer:coarse) and (min-height:600px)`.
- Preview móvil: `tools/shot-mobile.mjs` + `tools/probe-mobile-hud.mjs` (`shot-joker-slots.mjs` es escritorio).

## Gates (prefijar dev/smoke/build con `CODEBUDDY_SAFE_DELETE_ENABLED=0`)
- `typecheck` · `test` (386) · `validate` · `smoke` · `audit:desc` · `sim:balance`(500) · `sim:board`.
- `node tools/shot-desktop.mjs` (1440×810, 6) · `tools/shot-tablet.mjs` (1180×820, 5) · `tools/audit-mobile-buttons.mjs` (`FF_HEIGHT=360`).
- El smoke necesita un servidor en **127.0.0.1:1420** ya levantado (`npx vite --port 1420`); NO lo arranca solo.
- ⚠️ NUNCA el smoke en paralelo con `cargo` (CPU → SwiftShader <12 FPS → flakes). En limpio 0/0/0.
- ⚠️ NUNCA `sed -i` en Windows (mata casing).
- ⚠️ `waitForTimeout` no sirve para medir render (~12 FPS): usar `waitForFunction` sobre la condición.
- ⚠️ Botones animados: `locator.click()` da "element is not stable" → `boundingBox()` + `page.mouse.click`.
- `tools/simulate.ts` corre 100 partidas al importar; si el engine gana una fase, DEBE ganar la branch.

## Arquitectura / invariantes
- Engine puro (sin DOM/Three). `retention/**` importa `engine/**`. mulberry32 sembrado; VFX NO usa el RNG del engine. Strings `t()`; balance en JSON. Render cada rAF; solo HUD/overlay `pointer-events:auto`. Tap ≤6px/700ms.
- Flow: menu→archetypes→blind_select→playing→reward(interstitial "Ciego superado")→shop(→interlude). `deckSize`=piles+hand; classic=40, archetype=20.
- `archetypes.json` = 4 (`spores`/`colony`/`decay`/`crystal`) + `classic`; leer SOLO vía `src/meta/Archetypes.ts`. Shop bias `elementWeights={primary:3,secondary:2}`.
- `window.__fungiflush`={engine,scene,hud,bus,content,profileStore,runStore}; `content` es façade (`content.registry.instantiateJoker`). NUNCA emitir `state:changed` a mano.
- Panel abierto oculta el run HUD (`is-panel-open`). `.hud-missions`/`.hud-jokers` `pointer-events:none`.

## Puntuación (reglas duras)
- `ResolutionContext.total` = `Math.max(0, Math.round(substrate*spores))`: el SCORE jugable NUNCA es negativo. El desglose SÍ. `round.score` acumula con `+=`.
- `game:over` → `HUD.forceGameOver(reason)`: AUTORIDAD ABSOLUTA. `score:settled` SOLO lo emite la timeline del render; `schedulePendingPanel` es el respaldo del deadline.
- Barras de progreso: DOS rutas (`score:changed` y `render`) → `Math.max(0, Math.min(100,...))`.
- Reina Esporada (ante 3, `blind_a3_boss`): `MULTIPLY_SPORES 0.75`.

## Mano / mazo / descarte / orden
- **Mano inicial 6** (`RUN_DEFAULTS.handSize`).
- Chip MAZO = "Robables: X/total" (`hud.drawable`) + chip "Descarte: Y" (`hud.discardPile`); getters `engine.deckDrawPile`/`deckDiscardPile`; `data-counter`.
- **Reciclado**: `Deck.takeReshuffleCount()` + `GameEngine.drawFromDeck()` (único punto de robo) emite `deck:reshuffle`; HUD avisa y `SceneManager.reshuffleToDeck()` anima.
- **Descarte**: SIN botón. Arrastrar a la pila o TOCARLA; soltar una selección descarta toda. Zona centrada en `discardX` (`discardZoneRect`+`syncDropZones`).
- **Orden**: SIN botón. `auto` (Familia→Sustrato DESC→original, estable); ajuste `autoSortHand` reaplicado en `state:changed`.

## Carta / pilas / HUD
- **Seleccionada** = borde VERDE (`SELECT_COLOR 0x5ef08a`) + badge 1-5 (`Card3D.badge`) + elevación. Halo apagado en mano; los jokers lo conservan por rareza. `uRingFalloff`=9.5.
- Pilas: **DESCARTE IZQUIERDA, MAZO DERECHA** (no invertir). `deckX`=+X, `discardX`=-X.
- `.pile-label` (DOM): `pileAnchors()` proyecta las 4 esquinas → HUD fija left/top/width/height. Ocultas con `is-panel-open` y fuera de `playing`.
- `handSpreadClearOfPiles()` acota el abanico; `HAND_BOOST`=1.2 compartida con `layoutHand`.
- Top HUD: `.hud-score` sin losa, absolute centrado. `setTransitionProgress` alterna `is-transition-out`/`is-transition-in`.

## Menú principal (botones gel, 2026-10-07)
- UI DESACOPLADA del arte: `.menu-layout` → `.menu-top` (Perfil + hamburguesa) + `.menu-hero`; el arte es fondo.
- HÉROE = botones gel: `.menu-cta-wrap` (+`is-continue`) con `.menu-fb` (SVG `<use>` de `#ff-seta`/`#ff-gota`, sprite en `menuDecoDefs()`). Estilos en `src/ui/MenuScreen.ts`.
- **data-act hooks intactos** (`new`, `continue`, `profile`, `menu-toggle`).
- `[data-act="continue"]` siempre en DOM con `is-disabled` sin guardado; `setContinueAvailable` solo corre en load ⇒ las tools deben arrancar partida, esperar autosave (~3 s) y `reload()`.
- `public/menu-bg.jpg`: el "FUNGI FLUSH" del fondo **ES el logo**; el botón va DEBAJO.
- "Nueva partida" abre el selector de arquetipo ⇒ las tools deben añadir el paso `archetypes-start`.
- ⚠️ Medir contra el SCROLLER, no el viewport.

## Tienda (rediseño 2026-10-07)
- **Sin cajas**: `.panel.is-shop .offer` anula fondo/borde/sombra/padding. La tarjeta ES la cara de la carta.
- **Sin leyendas**: se eliminaron `.offer-kind`/`.offer-desc`/`.offer-impact`/`.offer-name` y `buildOfferImpact()` (la cara ya trae nombre + habilidad + números). Quedan `data-kind`/`data-kind-label` + `aria-label` (a11y y smoke).
- **Layout**: el HUD fija `--offer-cols` = nº de ofertas (tope 6) ⇒ la fila llena SIEMPRE el ancho. `grid-auto-rows: minmax(150px,1fr)`.
- **Cara arriba, pie abajo**: `.offer-art { flex:1 1 auto; object-fit:contain }` absorbe el alto; `.offer-footer` CENTRADO (precio+botón agrupados, NO `space-between`: la cara es vertical y queda centrada con barras, así que pegarlos a los bordes los desalineaba).
- **La carta escala con el ALTO del cuerpo**: el panel ya está topado por el viewport, así que recortar cromo (subtítulo fuera del flujo, padding 8/12, tabs bajas) AGRANDA la carta. +33% de alto de cara sin tocar la textura.
- ⚠️ NO subir `descFontPx` (23/25) de `CardTexture.ts`: `audit:desc --scale=1.15` ya trunca 4 cartas. Para texto más grande, agrandar la CARTA.
- **Siempre 4 ofertas** (5 desde ante 5): el 4º grupo de `shop_default`/`shop_late` era `chance 0.55` ⇒ salían 3 el ~45%. Ahora `options=[voucher w55, card w45]` (siempre produce, misma tasa de voucher).
- Gates: `node tools/probe-shop-count.mjs` (tienda REAL + distribución) y `probe-shop-sell.mjs`.

## Sobres (Task F)
- `src/meta/Packs.ts` puro: `PACK_RARITY_WEIGHTS {comun:70,rara:22,epica:8}`, `drawPack`, `PackInventory{pending,opened}`, `grantPack`/`consumePack`. Perfil **v5** (`migrateProfileV4toV5`).
- `src/render/PackOpening.ts`: overlay WebGL propio (canvas full-viewport). ⚠️ Necesita `startExternal()`/`updateAnim(dt)` (el rAF del menú no bombea GSAP) y `stopExternal()` en `dispose()`.
- ⚠️ `.pack-overlay` necesita estar en la allow-list de `pointer-events` de `#ui-root` (si no queda `pe:none` y el click cae en el menú) y `z-index: var(--z-banner)` (85 > `--z-overlay` 80).
- ⚠️ `CanvasTexture` no observa el canvas: con data URL asíncrono hay que forzar `needsUpdate` al cargar la imagen, o la carta sale NEGRA.
- 1 sobre por ciego (`round:win` → `grantPack`). `openPack()` expuesto en `__fungiflush`. Gate: `node tools/probe-packs.mjs`.

## Colonia Fungi
- Doc `docs/PLAN_COLONIA_Y_GOOGLE_PLAY.md`. **NO toca el combate**. **Esporas** (partida, `RunState`) vs **Esporas de Colonia** (permanente, `ProfileSave.colony`).
- `src/meta/Colony.ts` puro: base por ante `[50,75,100,130,165,205,250,300]`; anti-farm 3 frenos (1ª vez 100% con clave `"ante:blindIndex"`, repetición 40%, tope blando 5/día). `level` DERIVADO de `lifetimeSpores`. `COLONY_LEVELS`=`0/50/120/220/350/500/700/950/1250/1600`; `DAILY_HARD_CAP=100`.
- Perfil v4: `colony` + `account` (`src/meta/Account.ts`, `offline|pending|synced|conflict`). Anti-trampa: se sube `ColonyRunResult`, nunca las Esporas del cliente.
- `server/leaderboard/server.mjs` `LEVEL_THRESHOLDS` = misma tabla. Gate: `tools/probe-colony.mjs` (siembra `localStorage` + `reload`).

## Habilidades / Arte / Tipografía
- Habilidad=`effects?`. Descripción móvil=`.hud-tooltip` (long-press eliminado); `desc` recibe `is-ability` (fondo violeta) + `.tooltip-ability-marker` (✦).
- `CardTexture.ts`: `wrapTextLines(text,{fontPx,maxWidth,maxLines?})` + `descLineBudget(hasAbility)` → habilidad 3 líneas / simple 4. Cara: `descFontPx` 23/25, `descLineHeight` 29/32.
- `npm run audit:desc` (65 cartas, 0 truncamientos; `--scale=N` simula tipografía mayor).
- Art AI img2img; `cardFaceUrl`/`offerFaceUrl` fuente única; `art_card_own_<id>.webp`. TRAMPA: `optimize_art.py` fit() RECORTA si ratio≠target (2:1).
- `--font-ui`=Fredoka; `--font-display`=Gasoek One (Bagel Fat One NO disponible offline). Único stylesheet `src/ui/styles.css`. CARA COMPACTA (táctil): nombre 92px+velo, 2 chips `chipScale 2.2`. TEXTURA 512×744→escala 0,1505.

## Combos / Estados / Jokers
- COMBOS: solo `element:*`(mult), `family:*`(flat), `diversity:5`. POKER axis eliminado.
- `closeCombo` SIGUE en todas las manos. `comboFlourish(eje,tier)`: dorado=elemento, ámbar=familia, verde=diversidad.
- `jokerSlots` default 5; `ADD_JOKER_SLOTS`; `rebuildJokerSlots`; `joker_loaded_die` unlock ante 8.
- Estados (P2.6): `status:applied`/`consumed`/`expired`. `decayStatuses` recorre `Deck.allCards` (robo+descarte), **NO la mano**.
- ⚠️ Bug latente: `APPLY_STATUS` muta sin respetar `dryRun` y `preview()` corre en cada cambio de selección ⇒ seleccionar deja el estado puesto. El EVENTO sí está blindado.

## Paneles / Jefe
- ⚠️ Panel del CIEGO JEFE ~366px FIJOS: a 360 el pie se sale y "Luchar" no es clickeable (por eso `audit-mobile-buttons.mjs` acepta `FF_HEIGHT=360`).
- `.blind-help.is-interlude` (solo si `targetMultiplier !== 1`); valores reales +15%, +20%, −15%. Contenido en `.blind-body` (cuerpos flexibles P8) o P8 (0,3,0) le gana a `.is-blind-select` (0,2,0).

## Tauri Android / ranking
- Toolchain (exportar por sesión): `~/.cargo/bin` (Rust 1.99 + targets Android), `~/.workbuddy-ai/binaries/mingw/mingw64/bin`. SDK en `$ANDROID_HOME`. ⚠️ `winget install` de MinGW se cuelga: bajar zip + extraer con Python.
- `cargo check --target aarch64-linux-android` y `cargo check` host: ambas ramas del `cfg` deben compilar. `src-tauri/gen/android` SE VERSIONA.
- Puente Play Games: JNI, no plugin (`Account.ts`→`play_games.rs`→`PlayGamesBridge.kt`). `signIn` bloquea ⇒ `spawn_blocking`. Falta APP_ID real y SHA-1.
- Ranking: `src/meta/Leaderboard.ts` (puro) + `src/net/LeaderboardClient.ts` (`VITE_LEADERBOARD_URL`; sin var queda apagado) + `LeaderboardSync.ts`.

## Traps de debug
- **Espiar VFX**: los `private` de TS se borran en runtime ⇒ envolver `scene.particles.burst`/`scene.comboFlourish`. Forzar estado reescribiendo `hand[i].def = {...def, element, family}`.
- ⚠️ Nada de comillas invertidas dentro de los comentarios GLSL de `Shaders.ts` (template literal).
- Playwright: montar estado con `page.evaluate`; `hud.refreshPanel()` para redibujar un panel ya abierto.
