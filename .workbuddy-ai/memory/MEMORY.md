# FungiFlush — essentials

TS + Vite + Three.js + Tauri 2 roguelite deckbuilder (Balatro-like). Repo: Golducke31/FungiFlush (`main`).

## MÓVIL PRIMERO
- UI/HUD = MÓVIL landscape. Doc `docs/CONVENCION_MOVIL_PRIMERO.md`. Ref 915×412; smoke 844×390. **Escritorio CONGELADO**.
- `src/pointer.ts` ÚNICA fuente de puntero. NO `matchMedia` suelto. CSS: base=escritorio, móvil=`@media (pointer:coarse)`, tablet=`(pointer:coarse) and (min-height:600px)`.

## Gates (prefijar `CODEBUDDY_SAFE_DELETE_ENABLED=0`)
- `typecheck` · `test` · `validate` · `smoke` · `audit:desc` · `sim:balance`(500) · `sim:board`.
- Tools: `shot-desktop/tablet/mobile.mjs`, `probe-mobile-hud.mjs`, `audit-mobile-buttons.mjs` (`FF_HEIGHT=360`, `FF_VIEWPORT=smoke`), `shot-menu-buttons.mjs`.
- El smoke necesita un server YA en **127.0.0.1:1420**; NO lo arranca solo. ⚠️ NUNCA en paralelo con `cargo`.
- ⚠️ NUNCA `sed -i` (Windows mata casing). `waitForTimeout` no mide render → `waitForFunction`. Botones animados → `boundingBox()`+`page.mouse.click`.

## Arquitectura / invariantes
- Engine puro (sin DOM/Three). mulberry32 sembrado; VFX NO usa el RNG del engine. Strings `t()`; balance en JSON. Tap ≤6px/700ms.
- Flow: menu→archetypes→blind_select→playing→reward("Ciego superado")→shop(→interlude). `deckSize`=piles+hand; classic=40, arquetipo=**24**.
- `archetypes.json` SOLO vía `src/meta/Archetypes.ts`. Shop bias `elementWeights {primary:3,secondary:2}`.
- `window.__fungiflush`={engine,scene,hud,bus,content,profileStore,runStore}; NUNCA emitir `state:changed` a mano. Panel abierto oculta el run HUD (`is-panel-open`).
- Content = packs `src/data/packs/<id>/pack.json` (glob eager): un pack nuevo NO exige código. Sin el id en `entitlements.owned` (`pack.<id>`) las cartas salen BLOQUEADAS.
- `migrateProfileSave` NUNCA null y su `return` es EXPLÍCITO: un campo top-level nuevo se agrega ahí (los anidados sobreviven por spread). Perfil **v6**.

## Puntuación (duras)
- `total` = `Math.max(0, Math.round(substrate*spores))`: el SCORE jugable NUNCA es negativo. `round.score` acumula con `+=`.
- `game:over` → `HUD.forceGameOver`: AUTORIDAD ABSOLUTA. `score:settled` SOLO lo emite la timeline del render.

## Mano / mazo / pilas
- Mano inicial 6. Chip MAZO="Robables: X/total" + chip "Descarte: Y".
- Reciclado: `Deck.takeReshuffleCount()` + `GameEngine.drawFromDeck()` (único robo) emite `deck:reshuffle`.
- **Descarte y Orden SIN botón** (arrastrar/tocar la pila; ajuste `autoSortHand`). Pilas: DESCARTE IZQUIERDA, MAZO DERECHA.
- Seleccionada = borde VERDE `0x5ef08a` + badge 1-5. `HAND_BOOST`=1.2.

## Menú principal
- `.menu-layout` → `.menu-top` + `.menu-hero`; `public/menu-bg.jpg` es fondo. El "FUNGI FLUSH" del fondo **ES el logo** (horneado; termina al 47.7% del alto del arte).
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
- `EXPANSION_PACK_ID='deep_mycelium'`. Los packs viven en `src/data/packs/<id>/pack.json` (glob eager, sin tocar código). Requieren `entitlements.owned` con `'pack.<id>'` o las cartas salen BLOQUEADAS (un pack en disco no es un pack desbloqueado). Migración v6 une `owned ∪ fallback-owned` para que packs nuevos siempre estén en `owned`.
- `CollectionEntry.count = ownedCounts[cardId]` → badge `×N` (`.collection-count` en celda + `.carousel-detail-copies` en detalle). `content.registry.poolOf('card')` filtra por `packOf(id) === EXPANSION_PACK_ID` para abrir sobres de expansión.
- `src/render/PackOpening.ts`: overlay WebGL. ⚠️ Necesita `startExternal()`/`updateAnim(dt)`/`stopExternal()`; `.pack-overlay` en la allow-list de `pointer-events` de `#ui-root` + `z-index: var(--z-banner)`; forzar `needsUpdate` del `CanvasTexture` o la carta sale NEGRA.
- Colonia (`src/meta/Colony.ts` puro): `level` DERIVADO de `lifetimeSpores`; `DAILY_HARD_CAP=100`. Server `server/leaderboard/server.mjs` con la misma tabla.

## Arte / Tipografía
- img2img; `cardFaceUrl`/`offerFaceUrl` fuente única. Cartas y dorso = **2:3 (512×744)**; `art_arena` = 2:1. `art_card_own_<id>.webp` gana; dorso por `cardback_<id>`. Jokers NO tienen arte propio.
- `tools/optimize_art.py`: fuentes en `art-source/` → `public/art/`; `fit()` RECORTA si el ratio ≠ target. `npm run art` = optimize + `genArtIndex`.
- `--font-ui`=Fredoka; `--font-display`=Gasoek One. Único `src/ui/styles.css`. `CardTexture.ts`: `descLineBudget` (habilidad 3 / simple 4 líneas).

## Combos / Estados / Jokers
- COMBOS: solo `element:*`(mult), `family:*`(flat), `diversity:5`. POKER eliminado. `closeCombo` sigue en todas las manos.
- `jokerSlots` default 5. `decayStatuses` recorre `Deck.allCards`, **NO la mano**.
- ⚠️ Bug latente: `APPLY_STATUS` muta sin respetar `dryRun` ⇒ seleccionar deja el estado puesto (el EVENTO sí está blindado).
- Efectos: acciones en `src/engine/triggers/actions.ts`, triggers/condiciones en `src/engine/types.ts`. Agregar una acción al mapa obliga a implementarla (TS).

## Traps
- ⚠️ Panel del CIEGO JEFE ~366px FIJOS: a 360 el pie se sale y "Luchar" no es clickeable.
- Tauri Android: toolchain `~/.cargo/bin` + `mingw64/bin`; `cargo check --target aarch64-linux-android` y host; `src-tauri/gen/android` SE VERSIONA.
- Los `private` de TS se borran en runtime (envolver para espiar VFX); nada de backticks en los GLSL de `Shaders.ts`; Playwright → `page.evaluate` + `hud.refreshPanel()`.
