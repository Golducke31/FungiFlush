# FungiFlush — essentials

TS + Vite + Three.js (0.186) + Tauri 2 roguelite deckbuilder (Balatro-like). Repo: Golducke31/FungiFlush (`main`). **Escritorio CONGELADO**; todo se diseña **móvil primero**. Doc: `docs/CONVENCION_MOVIL_PRIMERO.md`, `docs/DESIGN_ESCRITORIO.md` (única excepción: bloque `@media (pointer: fine)` al final de `styles.css`).

## Gates y tools (prefijar `CODEBUDDY_SAFE_DELETE_ENABLED=0`)
- `typecheck` · `test` (node --import tsx --test) · `validate` · `smoke` · `audit:desc` · `sim:balance`(500) · `sim:board` · `gate:desktop` (31 pantallas) · `gate:parity` (dual, baseline `tools/parity-baseline.json`, `--update` re-basa).
- Tools: `shot-desktop/tablet/mobile.mjs`, `parity-layout.mjs`, `smoke.mjs`, muchas `probe-*.mjs`.
- El smoke necesita server YA en **127.0.0.1:1420** (`npm run dev`); NO lo arranca solo. ⚠️ NUNCA en paralelo con `cargo`.
- ⚠️ NUNCA `sed -i` (Windows rompe casing). `waitForTimeout` no mide render → `waitForFunction`. Botón animado → `boundingBox()`+`page.mouse.click`.
- ⚠️ Sondas Playwright: cargar `playwright-core` desde `C:/Users/emanu/.workbuddy-ai/binaries/node/workspace/node_modules/`; ejecutar el script DESDE el repo (si no, `ERR_MODULE_NOT_FOUND`). Emular móvil: `newContext({viewport:{width:915,height:412}, isMobile:true, hasTouch:true})` ⇒ `(pointer: coarse)` true.
- ⚠️ Python de arte: `npm run art*` usa `python` pelado (SIN numpy). Usar venv gestionado `C:/Users/emanu/.workbuddy-ai/binaries/python/envs/fungiflush/Scripts/python.exe` (Pillow, numpy, cv2-contrib).

## Arquitectura / invariantes
- Engine puro (sin DOM/Three). mulberry32 sembrado; VFX NO usa el RNG del engine. Strings `t()`; balance en JSON. Tap ≤6px/700ms. `src/pointer.ts` = ÚNICA fuente de puntero (NO `matchMedia` suelto). CSS: base=escritorio, móvil=`@media (pointer:coarse)`, tablet=`(pointer:coarse) and (min-height:600px)`.
- Flow: menu→archetypes→blind_select→playing→reward("Ciego superado")→shop(→interlude). `deckSize`=piles+hand; classic=40, arquetipo=24.
- `archetypes.json` SOLO vía `src/meta/Archetypes.ts`. Shop bias `elementWeights {primary:3,secondary:2}`.
- `window.__fungiflush`={engine,scene,hud,bus,content,profileStore,runStore}; NUNCA emitir `state:changed` a mano. Panel abierto oculta el run HUD (`is-panel-open`).
- Content = packs `src/data/packs/<id>/pack.json` (glob eager): un pack nuevo NO exige código. Sin el id en `entitlements.owned` (`pack.<id>`) las cartas salen BLOQUEADAS.
- Perfil **v7**. `migrateProfileSave` NUNCA null; su `return` es EXPLÍCITO ⇒ un campo TOP-LEVEL nuevo se agrega ahí (los ANIDADOS sobreviven por spread).
- `jokerSlots` default 5. `decayStatuses` recorre `Deck.allCards`, NO la mano.
- Puntuación: `total = Math.max(0, Math.round(substrate*spores))` (nunca negativo); `round.score` acumula con `+=`. `game:over` → `HUD.forceGameOver` (autoridad absoluta); `score:settled` SOLO lo emite la timeline del render.

## Mano / mazo / pilas
- Mano inicial 6. Chip MAZO="Robables: X/total" + chip "Descarte: Y". Reciclado: `Deck.takeReshuffleCount()` + `GameEngine.drawFromDeck()` (único robo) emite `deck:reshuffle`.
- **Descarte y Orden SIN botón** (arrastrar/tocar la pila; ajuste `autoSortHand`). Pilas: DESCARTE IZQUIERDA, MAZO DERECHA. Seleccionada = borde VERDE `0x5ef08a` + badge 1-5. `HAND_BOOST`=1.2.
- Barra inferior: `.hud-counters` (flex:1 1 auto) + `.hud-actions` (centrado con `padding-inline: var(--actions-gutter)`, calculado por `syncActionsGutter()` en `renderCounters()`). Móvil: TODO en una línea; `JUGAR MANO` y `FUNGI FLUSH` `flex:0 0 auto`. No cerrar la barra con `overflow:hidden` en el botón FF (recorta el chip).
- ⚠️ **Zoom `.is-armed` de JUGAR MANO**: al seleccionar ≥1 carta el botón escala con `transform` (NO reserva layout) ⇒ la caja crecida pisaba FungiFlush. Fix móvil: `.hud-actions { gap:26px }` + `.btn.is-play.is-jm { flex:0 1 auto }` (ancho natural) + `.is-armed { scale(1.08) }` (era 1.16) → 14px de holgura. Cualquier `scale` en la barra necesita `gap` de colchón.
- ⚠️ **`:disabled` gana a `!important`**: `play.disabled = selected===0`; las reglas `:disabled` fijan `transform:none` VÍA `animation`, que gana incluso a `transform:...!important`. Para medir `is-armed` hay que SELECCIONAR cartas de verdad (`engine.toggleSelect(uid)`), NO forzar la clase.

## Menú principal
- `.menu-layout` → `.menu-top` + `.menu-hero`; `public/menu-bg.jpg` es fondo. El "FUNGI FLUSH" del fondo ES el logo (horneado).
- Hooks `data-act`: `new`,`continue`,`profile`,`menu-toggle`,`settings`,`collection`,`challenges`. `[data-act="continue"]` siempre en DOM con `is-disabled` sin guardado.
- "Nueva partida" abre el selector de arquetipo ⇒ las tools añaden `archetypes-start`. ⚠️ Medir contra el SCROLLER.
- **Mini Tarjeta de Jugador** (2026-10-10): el botón de Perfil del `menu-top` es la píldora celeste `.menu-gel--card` con avatar+marco+título+nivel (click → panel Perfil). `buildMiniPlayerCard()` en `PlayerCard.ts`; `MenuState.player?`; `menu-gel--card` SOLO si hay `state.player`. ⚠️ **Trampa doble**: (a) el selector base va DOBLE `.menu-gel--icon.menu-gel--card` (esp. 0,2,0) porque `.menu-gel--icon` se redefine en 3 media queries posteriores y ganaría por orden; (b) `.player-card` (base, línea ~7423) trae `min-height:96px`+borde+fondo y vive más abajo ⇒ hay que anularla en `.menu-gel--card .player-card.player-card--mini`. Sizing en **px**, no `em`.

## Tienda / Recompensa
- **Sin cajas ni leyendas**: `.panel.is-shop .offer` anula fondo/borde; la tarjeta ES la cara. Quedan `data-kind`/`data-kind-label` + `aria-label`.
- `--offer-cols` = nº de ofertas (tope 6); `grid-auto-rows: minmax(150px,1fr)`; `.offer-art {flex:1 1 auto; object-fit:contain}`; `.offer-footer` CENTRADO.
- ⚠️ NO subir `descFontPx` (23/25): `audit:desc --scale=1.15` ya trunca. Agrandar la CARTA. Siempre 4 ofertas (5 desde ante 5). Recompensa = el mismo grid `.offer`. Gates: `probe-shop-count.mjs`, `probe-shop-sell.mjs`.

## Sobres / Colonia / Expansión
- `src/meta/Packs.ts` puro: `PACK_RARITY_WEIGHTS {comun:70,rara:22,epica:8}`, `drawPack`, `rollPackDrop(rng, misses, BOSS_PACK_DROP_CHANCE=0.5, PACK_PITY_AFTER=2)`, `rollPackKind(rng, EXPANSION_PACK_SHARE=0.25)`. Un sobre = especímenes a la COLECCIÓN, NO al mazo.
- `PackInventory={pending,opened,expansionPending,expansionOpened,bossMisses}`; `grantPack`/`grantExpansionPack`/`consumePack`/`consumeExpansionPack` (inventarios independientes). `EXPANSION_PACK_ID='deep_mycelium'`.
- `src/render/PackOpening.ts`: overlay WebGL. ⚠️ Necesita `startExternal()`/`updateAnim(dt)`/`stopExternal()`; `.pack-overlay` en allow-list de `pointer-events` de `#ui-root` + `z-index: var(--z-banner)`; forzar `needsUpdate` del `CanvasTexture` o la carta sale NEGRA.
- Colonia (`src/meta/Colony.ts` puro): `level` DERIVADO de `lifetimeSpores`; `DAILY_HARD_CAP=100`. Server `server/leaderboard/server.mjs` con la misma tabla.
- **Recompensas nombradas**: `COLONY_LEVELS` (L2 frame_common, L3 pack_spores, L4 bg_new, L5 title_mycelium, L6 victory_fx, L7 pack_colony, L8 avatar, L9 frame_uncommon, L10 title_established). Registry `src/meta/ColonyRewards.ts` + `claimColonyRewards`. `colony.claimedRewards[]` = reclamadas; `cosmetics.owned[]` (plano) + `cosmetics.equipped<Kind>` (plano). **Entrega = RECLAMAR (NO auto-equip)**: equipar es acción aparte en Personalizar. **Tarjeta de Jugador** = avatar+frame+title+background. VictoryFx se aplica al ganar.
  - ⚠️ **Back-fill en migración**: un perfil que reclamó durante el flujo roto tenía ids en `claimedRewards` pero NO en `cosmetics.owned` y `claimableRewards` los filtraba para siempre. `migrations.ts` recorre `COLONY_REWARDS` y hace push de `cosmeticId` cuando el `id` está en `claimedSet` y falta en `owned` (idempotente). Tests R11/R12.

## Arte / Tipografía
- img2img; `cardFaceUrl`/`offerFaceUrl` fuente única. Cartas y dorso = 2:3 (512×744); `art_arena` = 2:1. `art_card_own_<id>.webp` gana; dorso por `cardback_<id>`. Jokers NO tienen arte propio.
- `tools/optimize_art.py`: fuentes `art-source/` → `public/art/`; `fit()` RECORTA si el ratio ≠ target; preserva alfa solo si la fuente la trae. `npm run art` = optimize + `genArtIndex`.
- `--font-ui`=Fredoka; `--font-display`=Gasoek One. Único `src/ui/styles.css`. `CardTexture.ts`: `descLineBudget` (habilidad 3 / simple 4 líneas).

## CAPAS / PARALLAX — ELIMINADO POR ROLLBACK (2026-10-09)
- El pipeline de capas YA NO EXISTE (el usuario lo revirtió: las cartas se veían peor). NO hay `ArtLayers.ts`, `public/art/layers/`, `segment_*`, `genLayerIndex`, `PIPELINE_CAPAS.md`. Cartas con **arte único** (`createCardCanvas` 3 args); `Card3D` = 2 mallas (cara + texto).
- **Recompensas de Colonia SÍ se conservaron.** Si se toca `main.ts`/`HUD.ts`/`SceneManager.ts`/`cardArt.ts`, recordar que ahora tienen SOLO Colonia.

## Combos / Estados / Jokers
- COMBOS: solo `element:*`(mult), `family:*`(flat), `diversity:5`. POKER eliminado. `closeCombo` sigue en todas las manos.
- ⚠️ `APPLY_STATUS` DIFIERE la mutación (`statusRequests` → `applyDeltas`, solo si `!dryRun`), PERO condiciones de estado y `CONSUME_STATUS` **sí ven los pedidos pendientes** (`ConditionWorld.pendingStatuses`) ⇒ un estado aplicado en la mano YA es visible en esa misma mano.
- ⚠️ Las condiciones se evalúan contra el SUJETO (`source.card` = la carta que LLEVA el efecto), NO contra la que disparó el evento. `element_is`/`family_is`/`rarity_is`/`has_status` miran al dueño. Para "cada carta de X jugada" usar `trigger_*`. En SIMBIONTES `sourceFromJoker` no expone `card` ⇒ condiciones de dueño SIEMPRE falsas.
- ⚠️ Condiciones que dependen de `triggerCard` (`is_first_card_of_round`, `is_last_card_of_hand`) son SIEMPRE falsas en eventos GLOBALES (`dispatchGlobal`). Para "última carta jugada" el trigger es `ON_PLAY`.
- ⚠️ Un `RETRIGGER` re-emite `ON_PLAY`: si el efecto que lo lleva también escucha `ON_PLAY` ⇒ bucle (lo delata `sim:balance`). Se evita con `once: "per_round"`.
- Efectos: acciones en `src/engine/triggers/actions.ts`, triggers/condiciones en `src/engine/types.ts`. Condiciones extra: `status_in_hand`, target `all_cards`.
- `npm run audit:behavior` (`tools/audit-card-behavior.ts`): informe, no gate. Gate de descripciones = `audit:desc`.

## Habilidad FUNGI FLUSH (insignia de run) — mecánica 2026-10-10
- **Solo UNA vez por ciego y SOLO con las 3 cargas.** Marcador `n/3` siempre visible (arranca 1/3). Al usarla: `fungiFlushUsedThisBlind=true` y la carga vuelve a **1** (`FUNGI_FLUSH_AFTER_USE_CHARGES=1`, NO 0). Se REABRE en `chooseBlind()`. Recarga `element:...:>=3`/`family:...:>=4`, pero `rechargeFungiFlush()` devuelve 0 si ya usada.
- `canUseFungiFlush` exige status `playing`, manos>0, `!fungiFlushUsedThisBlind`, `charge>=MAX(3)`, no armada. Efectos: `SPORE_MULT=2.5`, `DRAW=2`, `CLEARS_STATUSES=['decay','spore_lock']`. Save/restore ADITIVO (campo `fungiFlushUsedThisBlind`, sin bump `SAVE_VERSION`).
- API motor: `fungiFlushCharge()/isArmed()/canUse()/use()` + paso `MULTIPLY_SPORES` `sourceId='fungi_flush'` en `playHand`. Bus: `'fungi:flushed' {charge, intensity}` (`intensity=1`).
- HUD: `.btn.is-fungi-flush` (chip `n/3`, `is-full`/`is-spent`) + shine, `data-act="use-fungi-flush"`. VFX: `src/render/FungiFlushFx.ts` (overlay WebGL propio, canvas transparente, dt del reloj GSAP via `anim.now()`). ⚠️ Se REUTILIZA una sola instancia desde HUD (`playFungiFlush`).
- Pop-ups: `onComboBanner`/`onAbilityBanner` en `SceneCallbacks`, al cerrar la mano. **Estilo COMPACTO** (una fila, fondo opaco chico). HUD: `.combo-banner-stack` (abajo-derecha)/`.combo-banner` (color por eje, escala por tier, `is-ability` con halo). i18n: `hud.comboBanner.size`, `ability.fungiFlush.banner|charging|usedThisBlind`.
- ⚠️ **Falta bundlear "Bagel Fat One"** para el logo: `FONT` cae a `Arial Black`/sans (`src/render/FungiFlushFx.ts:47`). Solución: woff2 + `@font-face` y anteponerla en `FONT`.

## ⚠️ WebGL: FUGAS DE CONTEXTO (pantalla en BLANCO) — 2026-10-10
- **Síntoma**: escena 3D en blanco, HUD visible (imagen rota arriba-izq) tras usar FungiFlush varias veces.
- **Causa**: `FungiFlushFx`/`PackOpening` creaban un `new THREE.WebGLRenderer` por uso y **`dispose()` NO libera el contexto**; el navegador evicta el MÁS VIEJO = el canvas del juego.
- **Fix**: en `dispose()` llamar **`renderer.forceContextLoss()` ANTES de `renderer.dispose()`** (AMBOS) + reutilizar UNA instancia de `FungiFlushFx` en HUD. Red de seguridad: `SceneManager` escucha `webglcontextlost` (`event.preventDefault()`) / `webglcontextrestored` (→`resize()`), flag `contextLost` salta el render.
- **Regla general**: cualquier overlay con `WebGLRenderer` propio DEBE `forceContextLoss()` al destruirse.

## Vampíricas / Encaje 3D
- ⚠️ `rig.fit()` = `max(distForWidth, distForHeight)`. Móvil (aspect 2.22) manda el ALTO; escritorio 16:9 manda el ANCHO ⇒ cámara lejos, mesa al ~68%, franja plana arriba (la "franja negra" = clear color, no CSS). Fix: `DESKTOP_WIDE_PILE_X=8.8` + `biasDesktop=0.62`. Más ancho de mundo = cámara más lejos = cartas MÁS CHICAS.
- `.hud-top` transparente ⇒ en 16:9 necesita velo. `.counter[data-kind='state']` oculto en ambas plataformas.
- ⚠️ Dos contextos Playwright simultáneos NO funcionan (SwiftShader ~2-3 FPS). `gate:parity` crea→recorre→cierra cada sesión; usar `polling: 250`, no rAF.

## Traps
- ⚠️ Panel del CIEGO JEFE ~366px FIJOS: a 360 el pie se sale y "Luchar" no es clickeable.
- Tauri Android: toolchain `~/.cargo/bin` + `mingw64/bin`; `cargo check --target aarch64-linux-android` y host; `src-tauri/gen/android` SE VERSIONA.
- Los `private` de TS se borran en runtime (envolver para espiar VFX); Playwright → `page.evaluate` + `hud.refreshPanel()`.
- Google Auth (Play Games): bridge nativo implementado; pendiente solo APP_ID de Play Console + SHA-1 (lo hace Emanuel). Doc `docs/PLAN_COLONIA_Y_GOOGLE_PLAY.md` §7.

## VFX test (Playwright)
- `tools/ff-harness.html` + `tools/_ff_capture.mjs` = prueba visual reutilizable. **2 trampas**: (1) `page.screenshot()` NO captura el canvas WebGL en headless swiftshader (`preserveDrawingBuffer:false`) → usar `canvas.toDataURL()`; (2) el harness DEBE bombear `updateAnim(dt)` en un rAF, si no el reloj GSAP queda en 0.
