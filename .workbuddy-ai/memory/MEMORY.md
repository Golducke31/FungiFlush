# FungiFlush — essentials

TS + Vite + Three.js (0.186) + Tauri 2 roguelite deckbuilder (Balatro-like). Repo: Golducke31/FungiFlush (`main`).
Doc de capas: `docs/PIPELINE_CAPAS.md`.

## MÓVIL PRIMERO
- UI/HUD = MÓVIL landscape. Ref 915×412; smoke 844×390. **Escritorio CONGELADO** salvo el bloque `@media (pointer: fine)` al final de `styles.css` (`docs/CONVENCION_MOVIL_PRIMERO.md`, `docs/DESIGN_ESCRITORIO.md`).
- `src/pointer.ts` ÚNICA fuente de puntero. NO `matchMedia` suelto. CSS: base=escritorio, móvil=`@media (pointer:coarse)`, tablet=`(pointer:coarse) and (min-height:600px)`.
- Gates `gate:desktop` (31 pantallas) y `gate:parity` (dual, baseline `tools/parity-baseline.json`, `--update` re-basa).

## Encuadre 3D (SceneManager / CameraRig)
- ⚠️ `rig.fit()` = `max(distForWidth, distForHeight)`. Celular (aspect 2.22) manda el ALTO; escritorio 16:9 el ANCHO ⇒ cámara lejos, mesa ~68%, franja plana arriba (la "franja negra" = clear color, no CSS). Fix: `DESKTOP_WIDE_PILE_X=8.8` + `biasDesktop=0.62`.
- `.hud-top` transparente ⇒ en 16:9 necesita velo (`linear-gradient`). `.counter[data-kind='state']` oculto en ambas plataformas.
- ⚠️ Dos contextos Playwright simultáneos NO funcionan (SwiftShader ~2-3 FPS). `gate:parity` crea→recorre→cierra cada sesión; `polling: 250`, no rAF.

## Gates y tools (prefijar `CODEBUDDY_SAFE_DELETE_ENABLED=0`)
- `typecheck` · `test` (node --import tsx --test) · `validate` · `smoke` · `audit:desc` · `audit:behavior` (informe) · `sim:balance`(500) · `sim:board`.
- Tools: `shot-desktop/tablet/mobile.mjs`, `probe-mobile-hud.mjs`, `audit-mobile-buttons.mjs` (`FF_HEIGHT=360`, `FF_VIEWPORT=smoke`), `probe-*.mjs`, `parity-layout.mjs`, `smoke.mjs`.
- Smoke necesita server YA en **127.0.0.1:1420** (`npm run dev`); NO lo arranca solo. ⚠️ NUNCA en paralelo con `cargo`.
- ⚠️ NUNCA `sed -i` (Windows mata casing). `waitForTimeout` no mide render → `waitForFunction`. Botones animados → `boundingBox()`+`page.mouse.click`.
- ⚠️ Python de arte: `npm run art*` usa `python` pelado (SIN numpy). Usar venv: `C:/Users/emanu/.workbuddy-ai/binaries/python/envs/fungiflush/Scripts/python.exe` (Pillow, numpy, cv2-contrib, pymatting).
- `npm run art` = optimize_art + genArtIndex. `npm run art:layers` = segment_card_layers + genLayerIndex.

## Arquitectura / invariantes
- Engine puro (sin DOM/Three). mulberry32 sembrado; VFX NO usa el RNG del engine. Strings `t()`; balance en JSON. Tap ≤6px/700ms.
- Flow: menu→archetypes→blind_select→playing→reward("Ciego superado")→shop(→interlude). `deckSize`=piles+hand; classic=40, arquetipo=24.
- `archetypes.json` SOLO vía `src/meta/Archetypes.ts`. Shop bias `elementWeights {primary:3,secondary:2}`.
- `window.__fungiflush`={engine,scene,hud,bus,content,profileStore,runStore}; NUNCA emitir `state:changed` a mano. Panel abierto oculta el run HUD (`is-panel-open`).
- Content = packs `src/data/packs/<id>/pack.json` (glob eager): pack nuevo NO exige código. Sin `entitlements.owned['pack.<id>']` las cartas salen BLOQUEADAS.
- Perfil **v7**. `migrateProfileSave` NUNCA null; su `return` EXPLÍCITO ⇒ campo TOP-LEVEL nuevo se agrega ahí (los anidados sobreviven por spread).
- `jokerSlots` default 5. `decayStatuses` recorre `Deck.allCards`, NO la mano.

## Puntuación (duras)
- `total` = `Math.max(0, Math.round(substrate*spores))`: el SCORE jugable NUNCA es negativo. `round.score` acumula con `+=`.
- `game:over` → `HUD.forceGameOver`: AUTORIDAD ABSOLUTA. `score:settled` SOLO lo emite la timeline del render.

## Mano / mazo / pilas
- Mano inicial 6. Chip MAZO="Robables: X/total" + chip "Descarte: Y".
- Reciclado: `Deck.takeReshuffleCount()` + `GameEngine.drawFromDeck()` (único robo) emite `deck:reshuffle`.
- **Descarte y Orden SIN botón** (arrastrar/tocar la pila; ajuste `autoSortHand`). Pilas: DESCARTE IZQUIERDA, MAZO DERECHA.
- Seleccionada = borde VERDE `0x5ef08a` + badge 1-5. `HAND_BOOST`=1.2.

## Menú principal
- `.menu-layout` → `.menu-top` + `.menu-hero`; `public/menu-bg.jpg` es fondo. El "FUNGI FLUSH" del fondo ES el logo (horneado; termina al 47.7% del alto del arte).
- Hooks `data-act`: `new`,`continue`,`profile`,`menu-toggle`,`settings`,`collection`,`challenges`. `[data-act="continue"]` siempre en DOM con `is-disabled` sin guardado.
- "Nueva partida" abre el selector de arquetipo ⇒ las tools añaden `archetypes-start`. ⚠️ Medir contra el SCROLLER.

## Tienda / Recompensa
- **Sin cajas ni leyendas**: `.panel.is-shop .offer` anula fondo/borde; la tarjeta ES la cara. Quedan `data-kind`/`data-kind-label` + `aria-label`.
- `--offer-cols` = nº de ofertas (tope 6); `grid-auto-rows: minmax(150px,1fr)`; `.offer-art {flex:1 1 auto; object-fit:contain}`; `.offer-footer` CENTRADO.
- ⚠️ NO subir `descFontPx` (23/25): `audit:desc --scale=1.15` ya trunca. Agrandar la CARTA. Siempre 4 ofertas (5 desde ante 5).
- Recompensa = el mismo grid `.offer` (sin carrusel 3D). Gates `probe-shop-count.mjs`, `probe-shop-sell.mjs`.

## Sobres / Colonia / Expansión
- `src/meta/Packs.ts` puro: `PACK_RARITY_WEIGHTS {comun:70,rara:22,epica:8}`, `drawPack`, `rollPackDrop(rng, misses, BOSS_PACK_DROP_CHANCE=0.5, PACK_PITY_AFTER=2)`, `rollPackKind(rng, EXPANSION_PACK_SHARE=0.25)`. Un sobre = especímenes a la COLECCIÓN, NO al mazo.
- `PackInventory={pending,opened,expansionPending,expansionOpened,bossMisses}`; `grantPack`/`grantExpansionPack`/`consumePack`/`consumeExpansionPack` (inventarios independientes).
- `EXPANSION_PACK_ID='deep_mycelium'`. Requieren `entitlements.owned` con `'pack.<id>'`. Migración une `owned ∪ fallback-owned`.
- `CollectionEntry.count = ownedCounts[cardId]` → badge `×N`. `poolOf('card')` filtra por `packOf(id) === EXPANSION_PACK_ID`.
- `src/render/PackOpening.ts`: overlay WebGL. ⚠️ Necesita `startExternal()`/`updateAnim(dt)`/`stopExternal()`; `.pack-overlay` en allow-list de `pointer-events` de `#ui-root` + `z-index: var(--z-banner)`; forzar `needsUpdate` del `CanvasTexture` o la carta sale NEGRA.
- Colonia (`src/meta/Colony.ts` puro): `level` DERIVADO de `lifetimeSpores`; `DAILY_HARD_CAP=100`. Server `server/leaderboard/server.mjs` con la misma tabla.
- **Recompensas nombradas** (`COLONY_LEVELS`, 9 ids) en `src/meta/ColonyRewards.ts` (registry rewardId→efecto + `claimColonyRewards`). `colony.claimedRewards[]` = reclamadas; `cosmetics.equipped{Avatar,Frame,Title,Background,VictoryFx}`. Entrega = RECLAMAR (NO auto-equip). **Tarjeta de Jugador** = avatar+marco+título+fondo.

## Arte / Tipografía
- img2img; `cardFaceUrl`/`offerFaceUrl` fuente única. Cartas y dorso = 2:3 (512×744); `art_arena` = 2:1. `art_card_own_<id>.webp` gana; dorso por `cardback_<id>`. Jokers NO tienen arte propio.
- `tools/optimize_art.py`: `art-source/` → `public/art/`; `fit()` RECORTA si el ratio ≠ target. ⚠️ Preserva alfa solo si la fuente la trae; `art_bgcard_*` sale 768×256.
- `--font-ui`=Fredoka; `--font-display`=Gasoek One. Único `src/ui/styles.css`. `CardTexture.ts`: `descLineBudget` (habilidad 3 / simple 4 líneas).

## CAPAS / PARALLAX (art segmentado)
Salida: `public/art/layers/<stem>__<bg|subject|fg>.png` + `index.json`. **PNG lossless**.
- ⚠️ **Solo se segmentan `art_card_*`** (94 cartas). Correr `--only "art_card_*"` (glob, NO lista con comas): sin el flag también segmenta `art_blind_*`, `art_frame_*`, arte de elemento = scope creep.
- ⚠️ El arte NO tiene chroma: escena teal oscura, todo RGB opaco. Keying = **CONTRASTE LOCAL** (desvío vs blur) + matiz no-teal + brillo CON BORDE. Banda 18%-62% SOLO VETA. Modo `chroma` para arte futuro con fondo plano.
- ⚠️ Sujeto = capa RECORTADA a bbox ⇒ dibujarla EN SU BBOX (`createCardLayerCanvas`), no estirada.
- ⚠️ **Respaldo duro**: sin `layers/index.json` todo cae a la textura única ⇒ el juego se ve IDÉNTICO. `ArtLayers.emptyLayers` + `detectEmptyLayers()` (canvas 64×64) ⇒ `pick()` devuelve `undefined` para capas vacías.

### Matting (2026-10-09)
- La máscara es TRIMAP (`trimap_erode_px=3` = sujeto seguro, `trimap_dilate_px=3` (tope `trimap_dilate_max_px=4`) = fondo seguro); `matte_alpha` resuelve SOLO la banda con pymatting (cf→knn) → `cv2.ximgproc.guidedFilter` → binaria. El erode es ADAPTATIVO (`_shrink_until_safe`, min 25% de la máscara). Sin backend = no-op (salida idéntica).
- ⚠️ **Invariante de opacidad**: `compose_layers` SOLO aplica `feather_alpha` global si el matting NO corrió; si corrió, refuerza el interior a 255 (erosionando la binaria de referencia). Antes el feather global se apilaba sobre el matting y dejaba el cuerpo translúcido ("carta lavada").
- **Inpaint**: hint dilata el hueco `inpaint_dilate_px=6`; en modo `band` rellena solo `inpaint_band_px` más allá del borde (mata manchas). Escalera LaMa → cv2 TELEA → blur difuso.
- **ML/depth opcionales**: `ml_backend=rembg` (valida por IoU ≥ `ml_iou_min` 0.80), `depth_backend=depth_anything`.

### fg / parallax (2026-10-09, en curso)
- ⚠️ **El fg NUNCA negro**: la `vignette_fg()` original arrancaba en d=0.75 y llegaba a alfa 255 con RGB NEGRO ⇒ pintaba un blob sobre la carta y la oscurecía ~13% (luminancia 38.3 → 33.2). El fg es un ACENTO. `fg_vignette_max` topa el alfa, `fg_vignette_start` lo empuja a los bordes (0.9), `fg_color` teal profundo.
- ⚠️ **Card3D z asimétrico**: bg apenas detrás de la cara (`LAYER_BG_BACK = min(0.02, CARD_THICKNESS/2 - 0.015)`, NUNCA detrás de la cara trasera en −CARD_THICKNESS/2), fg MUY adelante (`LAYER_FG_FRONT = 0.3`) ⇒ `CARD_LAYER_GAP = 0.32`. El gap viejo 0.014 daba 0.22% del ancho de carta = ~1px, invisible. `CARD_TOP_OFFSET = CARD_THICKNESS/2 + LAYER_FG_FRONT + 0.02`. Z final: back −0.035 / bg 0.015 / cara 0.035 / esporas 0.176 / fg 0.335 / texto 0.355 / halo 0.380.
- ⚠️ Con el fg vacío el parallax casi desaparece (el bg solo mueve 0.02·sin θ): el parallax visible lo aporta el fg ⇒ hay que regenerarlo como halo LUMINOSO.

### index.json / genLayerIndex
- `index.json` lleva por carta `size`, `subject.bbox`, `coverage`, `depth{bg,subject,fg}`, `motion{<capa>:{amp,speed,noise}}`.
- ⚠️ `genLayerIndex.mjs` RE-CONSTRUYE cada entrada desde disco: correrlo parcial PIERDE `depth`/`motion`/`bbox` de las demás ⇒ SIEMPRE regen completo con `--only "art_card_*"`.
- **Card3D/ArtLayers**: `depth`/`motion`/`phase` con defaults de módulo si el índice es viejo. `updateLayerIdle` = bob+escala con `sin(time*speed+phase)` (phase = hash del stem ⇒ no respiran al unísono); escribe transforms LOCALES, nunca `home.*`. Distorsión UV por `onBeforeCompile` (uTime/uAmp/uPhase, parchea `#include <map_fragment>` en try/catch; ⚠️ NADA de backticks en los GLSL). `CardSporeField` (`Particles.ts`) = 12 esporas GPU-only, solo en hero/hover/selected.
- ⚠️ `Card3D.dispose()` libera `bgLayerMaterial`/`fgLayerMaterial` y las esporas (antes fugaban).

## Combos / Estados / Jokers
- COMBOS: solo `element:*`(mult), `family:*`(flat), `diversity:5`. POKER eliminado. `closeCombo` sigue en todas las manos.
- ⚠️ `APPLY_STATUS` DIFIERE la mutación (`statusRequests` → `applyDeltas`, solo si `!dryRun`), PERO las condiciones de estado y `CONSUME_STATUS` **sí ven los pedidos pendientes** (`ConditionWorld.pendingStatuses`) ⇒ un estado aplicado en la mano YA es visible en esa misma mano.
- ⚠️ Las condiciones se evalúan contra el SUJETO (`source.card` = la carta que LLEVA el efecto), NO contra la que disparó el evento. `element_is`/`family_is`/`rarity_is`/`has_status` miran al dueño. Para "cada carta de X jugada" usar `trigger_*`. En SIMBIONTES `sourceFromJoker` no expone `card` ⇒ condiciones de dueño SIEMPRE falsas (usan `trigger_*`).
- ⚠️ Condiciones que dependen de `triggerCard` (`is_first_card_of_round`, `is_last_card_of_hand`) SIEMPRE falsas en eventos GLOBALES (`dispatchGlobal`: ON_HAND_SCORED, ON_ROUND_*, ON_SHOP_*, ON_BLIND_SELECTED). Igual targets `previous_scored`/`next_scored`. Para "última carta jugada" el trigger es `ON_PLAY`.
- ⚠️ Un `RETRIGGER` re-emite `ON_PLAY`: si el efecto que lo lleva también escucha `ON_PLAY` ⇒ bucle (lo delata `sim:balance`). Se evita con `once: "per_round"`.
- Efectos: acciones en `src/engine/triggers/actions.ts`, triggers/condiciones en `src/engine/types.ts`. Condiciones extra: `status_in_hand`, target `all_cards`.

## Traps
- ⚠️ Panel del CIEGO JEFE ~366px FIJOS: a 360 el pie se sale y "Luchar" no es clickeable.
- Tauri Android: toolchain `~/.cargo/bin` + `mingw64/bin`; `cargo check --target aarch64-linux-android` y host; `src-tauri/gen/android` SE VERSIONA.
- Los `private` de TS se borran en runtime (envolver para espiar VFX); Playwright → `page.evaluate` + `hud.refreshPanel()`.
