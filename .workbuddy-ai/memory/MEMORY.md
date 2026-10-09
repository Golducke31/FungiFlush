# FungiFlush — essentials

TS + Vite + Three.js (0.186) + Tauri 2 roguelite deckbuilder (Balatro-like). Repo: Golducke31/FungiFlush (`main`).

## MÓVIL PRIMERO
- UI/HUD = MÓVIL landscape. Doc `docs/CONVENCION_MOVIL_PRIMERO.md`. Ref 915×412; smoke 844×390. **Escritorio CONGELADO** salvo el bloque `@media (pointer: fine)` al final de `styles.css` (doc `docs/DESIGN_ESCRITORIO.md`).
- `src/pointer.ts` ÚNICA fuente de puntero. NO `matchMedia` suelto. CSS: base=escritorio, móvil=`@media (pointer:coarse)`, tablet=`(pointer:coarse) and (min-height:600px)`.
- Gates `gate:desktop` (31 pantallas) y `gate:parity` (dual, baseline `tools/parity-baseline.json`, `--update` para re-basar).

## Encuadre 3D (SceneManager / CameraRig)
- ⚠️ `rig.fit()` = `max(distForWidth, distForHeight)`. Celular (aspect 2.22) manda el ALTO; escritorio 16:9 manda el ANCHO ⇒ cámara lejos, mesa al ~68% y franja plana arriba (la "franja negra" = clear color, no CSS). Fix: `DESKTOP_WIDE_PILE_X=8.8` + `biasDesktop=0.62` (cotas ~iguales 16.39/16.43). Más ancho de mundo = cámara más lejos = cartas MÁS CHICAS.
- `.hud-top` transparente ⇒ en 16:9 necesita velo (`linear-gradient`). `.counter[data-kind='state']` oculto en ambas plataformas.
- ⚠️ Dos contextos Playwright simultáneos NO funcionan (SwiftShader ~2-3 FPS). `gate:parity` crea→recorre→cierra cada sesión; usar `polling: 250`, no rAF.

## Gates y tools (prefijar `CODEBUDDY_SAFE_DELETE_ENABLED=0`)
- `typecheck` · `test` (node --import tsx --test) · `validate` · `smoke` · `audit:desc` · `sim:balance`(500) · `sim:board`.
- Tools: `shot-desktop/tablet/mobile.mjs`, `probe-mobile-hud.mjs`, `audit-mobile-buttons.mjs` (`FF_HEIGHT=360`, `FF_VIEWPORT=smoke`), `probe-*.mjs` (muchas sondas), `parity-layout.mjs`, `smoke.mjs`.
- El smoke necesita un server YA en **127.0.0.1:1420** (`npm run dev`); NO lo arranca solo. ⚠️ NUNCA en paralelo con `cargo`.
- ⚠️ NUNCA `sed -i` (Windows mata casing). `waitForTimeout` no mide render → `waitForFunction`. Botones animados → `boundingBox()`+`page.mouse.click`.
- ⚠️ Python de arte: `npm run art*` usa `python` pelado, que en esta máquina NO tiene numpy. Correr con el venv gestionado: `C:/Users/emanu/.workbuddy-ai/binaries/python/envs/fungiflush/Scripts/python.exe` (Pillow, numpy, cv2-contrib, pymatting).

## Arquitectura / invariantes
- Engine puro (sin DOM/Three). mulberry32 sembrado; VFX NO usa el RNG del engine. Strings `t()`; balance en JSON. Tap ≤6px/700ms.
- Flow: menu→archetypes→blind_select→playing→reward("Ciego superado")→shop(→interlude). `deckSize`=piles+hand; classic=40, arquetipo=24.
- `archetypes.json` SOLO vía `src/meta/Archetypes.ts`. Shop bias `elementWeights {primary:3,secondary:2}`.
- `window.__fungiflush`={engine,scene,hud,bus,content,profileStore,runStore}; NUNCA emitir `state:changed` a mano. Panel abierto oculta el run HUD (`is-panel-open`).
- Content = packs `src/data/packs/<id>/pack.json` (glob eager): un pack nuevo NO exige código. Sin el id en `entitlements.owned` (`pack.<id>`) las cartas salen BLOQUEADAS.
- Perfil **v7**. `migrateProfileSave` NUNCA null; su `return` es EXPLÍCITO ⇒ un campo TOP-LEVEL nuevo se agrega ahí. Los ANIDADOS sobreviven por spread.
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
- Recompensa = el mismo grid `.offer` (se quitó el carrusel 3D). Gates: `probe-shop-count.mjs`, `probe-shop-sell.mjs`.

## Sobres / Colonia / Expansión
- `src/meta/Packs.ts` puro: `PACK_RARITY_WEIGHTS {comun:70,rara:22,epica:8}`, `drawPack`, `rollPackDrop(rng, misses, BOSS_PACK_DROP_CHANCE=0.5, PACK_PITY_AFTER=2)`, `rollPackKind(rng, EXPANSION_PACK_SHARE=0.25)`. Un sobre = especímenes a la COLECCIÓN, NO al mazo.
- `PackInventory={pending,opened,expansionPending,expansionOpened,bossMisses}`; `grantPack`/`grantExpansionPack`/`consumePack`/`consumeExpansionPack` (inventarios independientes).
- `EXPANSION_PACK_ID='deep_mycelium'`. Packs en `src/data/packs/<id>/pack.json` (glob eager). Requieren `entitlements.owned` con `'pack.<id>'`. Migración une `owned ∪ fallback-owned`.
- `CollectionEntry.count = ownedCounts[cardId]` → badge `×N`. `poolOf('card')` filtra por `packOf(id) === EXPANSION_PACK_ID`.
- `src/render/PackOpening.ts`: overlay WebGL. ⚠️ Necesita `startExternal()`/`updateAnim(dt)`/`stopExternal()`; `.pack-overlay` en allow-list de `pointer-events` de `#ui-root` + `z-index: var(--z-banner)`; forzar `needsUpdate` del `CanvasTexture` o la carta sale NEGRA.
- Colonia (`src/meta/Colony.ts` puro): `level` DERIVADO de `lifetimeSpores`; `DAILY_HARD_CAP=100`. Server `server/leaderboard/server.mjs` con la misma tabla.
- **Recompensas nombradas** (`COLONY_LEVELS`, 9 ids) en `src/meta/ColonyRewards.ts` (registry rewardId→efecto + `claimColonyRewards`). `colony.claimedRewards[]` = reclamadas; `cosmetics.equipped{Avatar,Frame,Title,Background,VictoryFx}`. Entrega = RECLAMAR (NO auto-equip). **Tarjeta de Jugador** = avatar+marco+título+fondo.

## Arte / Tipografía
- img2img; `cardFaceUrl`/`offerFaceUrl` fuente única. Cartas y dorso = 2:3 (512×744); `art_arena` = 2:1. `art_card_own_<id>.webp` gana; dorso por `cardback_<id>`. Jokers NO tienen arte propio.
- `tools/optimize_art.py`: fuentes en `art-source/` → `public/art/`; `fit()` RECORTA si el ratio ≠ target. `npm run art` = optimize + `genArtIndex`.
- `--font-ui`=Fredoka; `--font-display`=Gasoek One. Único `src/ui/styles.css`. `CardTexture.ts`: `descLineBudget` (habilidad 3 / simple 4 líneas).
- ⚠️ `optimize_art.py` preserva alfa solo si la fuente la trae; `art_bgcard_*` sale 768×256.

## CAPAS / PARALLAX — ⚠️ ELIMINADO POR ROLLBACK (2026-10-09)
- **El pipeline de capas YA NO EXISTE en el repo.** El usuario lo pidió revertir tras verlo: las cartas se ven PEOR que con el arte único. Se hicieron rollback los commits `1c23662` (parte visual), `a8c0855` y `9a0bfbb`.
- **Estado actual**: las cartas usan su **arte único** (`createCardCanvas` 3 args, sin `layers`). `Card3D` = 2 mallas (cara + texto). NO hay `ArtLayers.ts`, `public/art/layers/`, `segment_*`, `genLayerIndex`, `PIPELINE_CAPAS.md`, scripts `art:layers`, ni `CardSporeField`.
- **Las Recompensas de Colonia SÍ se conservaron** (venían mezcladas en `1c23662`). Si algo se toca cerca de `main.ts`/`HUD.ts`/`SceneManager.ts`/`cardArt.ts`, recordar que esos archivos ahora tienen SOLO Colonia.
- Si se reintenta el parallax en el futuro, el conocimiento de abajo sigue vigente (pero la causa del fracaso fue visual: halos/manchas, fondo negro, cartas flotando).
- ⚠️ **Solo se segmentan `art_card_*`** (94 cartas). Correr `--only "art_card_*"`: sin el flag, el tool también segmenta `art_blind_*`, `art_frame_*` y arte de elemento (`art_poison`, `art_crystal`…) = scope creep.
- ⚠️ El arte NO tiene chroma: escena teal oscura, todo RGB opaco. Keying = **CONTRASTE LOCAL** (desvío vs blur enorme) + matiz no-teal + brillo CON BORDE. Banda 18%-62% SOLO VETA. Modo `chroma` para arte futuro con fondo plano.
- ⚠️ Sujeto = capa RECORTADA a bbox ⇒ dibujarla EN SU BBOX (`createCardLayerCanvas`), no estirada.
- `Card3D`: 4 mallas (`bg` z=−`CARD_LAYER_GAP`=0.014 / cara=sujeto / `fg` z=+GAP / `top`=texto) ⇒ parallax REAL. `ArtLayers.ts` = cargador propio.
- ⚠️ **Respaldo duro**: sin `layers/index.json`, todo cae a la textura única ⇒ el juego se ve IDÉNTICO.

### Matting + movimiento (2026-10-09)
- **Matting**: la máscara es TRIMAP (erode 8 / dilate 10 ⇒ banda incierta); `matte_alpha` resuelve SOLO la banda con pymatting (cf→knn) → `cv2.ximgproc.guidedFilter` → binaria. Sin backend = no-op (salida idéntica). Config `matting_backend/band_only/trimap_*_px`.
- **Inpaint**: hint dilata el hueco `inpaint_dilate_px=6` y en modo `band` rellena solo `inpaint_band_px` más allá del borde (mata manchas). Escalera LaMa → cv2 TELEA → blur.
- **ML/depth opcionales**: `ml_backend=rembg` (valida por IoU ≥ `ml_iou_min` 0.80), `depth_backend=depth_anything`.
- **index.json** gana `depth{bg,subject,fg}` + `motion{<capa>:{amp,speed,noise}}`. ⚠️ `genLayerIndex.mjs` RE-CONSTRUYE cada entrada: hay que copiar los campos nuevos en el `??=` o se PIERDEN en la próxima corrida.
- **Card3D**: `ArtLayers` expone depth/motion/phase (defaults de módulo si el índice es viejo). `updateLayerIdle` = bob vertical+escala con `sin(time*speed+phase)` (phase = hash del stem ⇒ no respiran al unísono); escribe transforms LOCALES, nunca `home.*`. Distorsión UV por `onBeforeCompile` (uTime/uAmp/uPhase, parchea `#include <map_fragment>` en try/catch; ⚠️ NADA de backticks en los GLSL). `CardSporeField` (`Particles.ts`) = 12 esporas GPU-only parentadas al group, encendidas solo en hero/hover/selected.
- ⚠️ Al agregar `Card3D.dispose()` también se liberan `bgLayerMaterial`/`fgLayerMaterial` y las esporas (antes fugaban).

## Combos / Estados / Jokers
- COMBOS: solo `element:*`(mult), `family:*`(flat), `diversity:5`. POKER eliminado. `closeCombo` sigue en todas las manos.
- ⚠️ `APPLY_STATUS` DIFIERE la mutación (`statusRequests` → `applyDeltas`, solo si `!dryRun`), PERO las condiciones de estado y `CONSUME_STATUS` **sí ven los pedidos pendientes** (`ConditionWorld.pendingStatuses`). ⇒ un estado aplicado en la mano YA es visible en esa misma mano.
- ⚠️ Las condiciones se evalúan contra el SUJETO (`source.card` = la carta que LLEVA el efecto), NO contra la que disparó el evento. `element_is`/`family_is`/`rarity_is`/`has_status` miran al dueño. Para "cada carta de X jugada" usar `trigger_*`. En SIMBIONTES `sourceFromJoker` no expone `card` ⇒ condiciones de dueño SIEMPRE falsas (usan `trigger_*`).
- ⚠️ Condiciones que dependen de `triggerCard` (`is_first_card_of_round`, `is_last_card_of_hand`) son SIEMPRE falsas en eventos GLOBALES (`dispatchGlobal`: ON_HAND_SCORED, ON_ROUND_*, ON_SHOP_*, ON_BLIND_SELECTED). Igual targets `previous_scored`/`next_scored`. Para "última carta jugada" el trigger es `ON_PLAY`.
- ⚠️ Un `RETRIGGER` re-emite `ON_PLAY`: si el efecto que lo lleva también escucha `ON_PLAY` ⇒ bucle (lo delata `sim:balance`). Se evita con `once: "per_round"`.
- Efectos: acciones en `src/engine/triggers/actions.ts`, triggers/condiciones en `src/engine/types.ts`. Condiciones extra: `status_in_hand`, target `all_cards`.
- `npm run audit:behavior` (`tools/audit-card-behavior.ts`): informe, no gate. Gate de descripciones = `audit:desc`. `docs/auditoria-cartas.html` = informe (22 hallazgos, TODOS arreglados 2026-10-08).

## Traps
- ⚠️ Panel del CIEGO JEFE ~366px FIJOS: a 360 el pie se sale y "Luchar" no es clickeable.
- Tauri Android: toolchain `~/.cargo/bin` + `mingw64/bin`; `cargo check --target aarch64-linux-android` y host; `src-tauri/gen/android` SE VERSIONA.
- Los `private` de TS se borran en runtime (envolver para espiar VFX); Playwright → `page.evaluate` + `hud.refreshPanel()`.
