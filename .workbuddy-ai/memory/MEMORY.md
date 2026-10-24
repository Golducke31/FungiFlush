# FungiFlush — essentials

TS + Vite + Three.js + Tauri 2 roguelite deckbuilder (Balatro-like). Repo `Golducke31/FungiFlush` (`main`). **Escritorio CONGELADO**; móvil primero. Unico CSS: `src/ui/styles.css` (base=escritorio; móvil `@media (pointer:coarse)`; tablet `(pointer:coarse) and (min-height:600px)`; escritorio final `@media (pointer:fine)`). `src/pointer.ts`=única fuente de puntero (nunca `matchMedia`).

## Gates (prefijo `CODEBUDDY_SAFE_DELETE_ENABLED=0`)
`typecheck`·`test`(tsx,562)·`validate`·`audit:desc`·`smoke`·`sim:balance`(500)·`sim:hands`·`sim:board`·`gate:desktop`(31)·`gate:parity`(baseline `tools/parity-baseline.json`, `--update` re-basa).
- Smoke server **127.0.0.1:1420** (`npm run dev`); no lo arranca. Nunca en paralelo con `cargo`.
- ⚠️ Nunca `sed -i`. `waitForTimeout` no mide render→`waitForFunction`. Botón animado→`boundingBox()`+`mouse.click`.
- ⚠️ Playwright: `playwright-core` desde `C:/Users/emanu/.workbuddy-ai/binaries/node/workspace/node_modules/`; ejecutar DESDE el repo. Móvil: `newContext({viewport:{915,412},isMobile:true,hasTouch:true})`. Dos contextos NO (SwiftShader).
- ⚠️ Arte venv `.../python/envs/fungiflush/Scripts/python.exe` (Pillow/numpy/cv2); `npm run art*` usa `python` pelado.

## Invariantes
- Engine puro (sin DOM/Three); mulberry32 sembrado; VFX no usa RNG engine. Strings `t()` (ES+EN o `validate` falla); balance en JSON. Tap ≤6px/700ms.
- Flow: menu→archetypes→blind_select→playing→reward→shop(→interlude). `deckSize`=piles+hand; classic=40, arquetipo=24.
- Perfil **v7**. `migrateProfileSave` return EXPLÍCITO ⇒ campo TOP-LEVEL nuevo va ahí. `window.__fungiflush`(DEV). Panel abierto oculta run HUD (`is-panel-open`).
- Puntuación `total=max(0,round(substrate*spores))`. `game:over`→`HUD.forceGameOver`; `score:settled` solo lo emite la timeline.
- ⚠️ `dist/` OBSOLETO: tras tocar `public/`, `npm run build` (dev engaña). Rutas arte RELATIVAS (`art/...`, sin `/`).

## Combos / Orden (combos.ts, orderBonus.ts)
- `element:*`(mult 5→3.0/4→2.2/3→1.6/2→1.25), `family:*`(flat 5→100/4→50/3→20), `diversity:5`(+25). Poker eliminado.
- Solapamiento familia↔elemento: `1-(1-0.4)*ratio`; total 40, cruzar ejes +25%. Escalera +18, Corona ×1.25.
- ⚠️ `APPLY_STATUS` difiere mutación (statusRequests); condiciones/`CONSUME_STATUS` ven pendientes. Condiciones vs SUJETO (`source.card`). `RETRIGGER` re-emite `ON_PLAY`⇒bucle (usar `once:"per_round"`).

## Tutorial / Arquetipos / Ascensión / Idioma
- Tutorial: 25 pasos (clásico 20, avanzado 5, mazo `decay`), `TUTORIAL_SEED=0xf00d`. `advanceTutorial(force)` IDEMPOTENTE. NO tocar `.panel.is-tutorial` (lo asevera smoke).
- Arquetipos: 1ª run=mazo CLÁSICO; selector se desbloquea al pasar 1er Ciego (`archetypesUnlocked`). `syncArchetypes()` empuja `list:[]` si bloqueado.
- Ascensión: `src/data/packs/base/ascensions.json` A1..A8 (A0=sin mods). `.ascension-card` necesita `flex:0 0 auto`. `moneyDelta`=override inicial (A5-8 arrancan 2 Fungis).
- Idioma: arranca INGLÉS; único control botón EN/ES en barra menú. `onToggleLanguage` debe `patch`+`saveNow()`. Gates asumen inglés (`ff.t()`).

## Rediseño visual (Fase A–G)
Plan: quitar "agua" ingame→Arena fullscreen; reskin HUDS + ilustraciones de cartas al nivel del mockup. Desktop hereda.
- **Fase A (backdrop fullscreen)** ✅: `#arena-bg` div + `art_backdrop.jpg`; canvas transparente (`alpha`,`premultipliedAlpha:false`,`setClearAlpha(0)`,`scene.background=null`); `COMPOSITE_FRAG` baseColor.a. `index.html` + `SceneManager`/`PostFx`.
- **Fase B (quitar agua+arena 3D)** ✅: borrados `Water.ts`/`Arena.ts`; gates green.
- **Fase D (card_frame)** ✅: `tools/gen_card_frame.py`→`public/art/art_card_frame.webp`(768×1116); singleton `setCardFrameImage/getCardFrameImage` en `CardTexture.ts`; `createCardCanvas` lo dibuja antes del texto. `ArtAssets` key `card_frame`→`art_card_frame.webp`.
  - ⚠️ El archivo DEBE llamarse `art_card_frame.webp` (el generador escribía `card_frame.webp` ⇒ no mapeaba a ninguna clave ⇒ el marco caía al procedural **en silencio, sin 404**). `TARGETS['art_card_frame']=(768,1116)` en `optimize_art.py`. Regresión: `tools/probe-card-frame.mjs`.
  - **Estilo**: guirnalda de micelio cian-violeta + musgo + setas, generada por imagen **anclada en `art_backdrop.jpg`** (coherencia con el fondo). Fuente en `art-source/raw/card_frame_raw.png` (subcarpeta: `optimize_art` globa `art-source/*.png`). El generador es un **post-procesador**: `fit` → `zoom_about_center(SCALE_X=1.08, SCALE_Y=1.05)` → esquinas redondeadas → **ventana interior** → `GAIN=1.38`/`SAT=1.12` (el render 3D es oscuro).
  - ⚠️ `CardTexture.CARD_FRAME_INSET=26`: la **ilustración se dibuja DENTRO de la ventana** del marco (debe coincidir con `WINDOW_INSET` del generador). El **dorso NO lleva el marco** (`createCardBackCanvas` mantiene su filete cian). El velo del nombre (cara compacta) va ANTES del marco.
  - ⚠️ Tipografía: helper `outlinedText()` — **blanco puro + contorno oscuro** en nombre (peso 800), chips, etiqueta de habilidad, descripción y badge de nivel.
- **HUD frames** (`tools/gen_hud_frames.py` → `src/ui/frames/{panel,button}.webp`): madera+musgo+oro, **SIN setas** (tapaban la ficha de cargas de FungiFlush). `gold_corner.webp` borrado (no lo usaba nadie).
- **Flash de combo** ⚠️: vive en `#arena-pulse` (capa propia entre el canvas y `#ui-root`, animada SOLO por `opacity`). **NUNCA** poner `filter`/`transform`/`will-change` sobre `#arena-bg` (capa fullscreen bajo un canvas WebGL transparente ⇒ pantalla negra en móvil al dispararse el pulso). `PostFx.setStrength` sanea el uniform (NaN/negativo = cuadro negro).
- **Cosméticos** ⚠️: invariante `equipado ⇒ poseído`. El panel arma cada sección desde `cosmetics.owned`, así que un id equipado ausente de la lista DESAPARECE de la UI. Lo garantizan `migrations.ts` (repara perfiles viejos) y `withEquipped()` en `main.ts`.
- **Fase C (kit HUD `border-image`)** 🔄: generar `public/ui/frames/{panel,plate,button,chip,gold_corner,badge_circle}.png` (centro transparente, wood/moss/gold) y cablear en `styles.css` (`.btn`,`.menu-gel`,`.panel`,`.plate`,`.chip`,`.badge`) SIN quitar gradientes de estado teal/amber. Falta ejecutar.
- **Fase E (set de arte completo)** ✅: 103 piezas nuevas por img2img anclado (backdrop→commons→rarezas→propias→ciegos). **40/40** elemento×rareza + **54/54** propias + **24/24** ciegos (el dato pide 24, no 13) + **2** reversos. `art/index.json`=139 (94 de carta); 222 MB→4.57 MB.
  - ⚠️ **ImageGen**: paralelizar solo con prefijo único `S_<clave>.` en el prompt (si no, colisiona por timestamp a segundos y `output_dir` por llamada no se respeta). El slug se trunca a ~30 chars ⇒ reparar por prefijo (`tools/_install_staged.py`). El elemento/rareza de las propias sale del DATO, no de la tabla del doc.
  - ⚠️ `optimize_art.py`: `startswith("art_cardback")`→`CARD_TARGET` (antes `art_cardback_mycelial` salía 512×512).
  - Hoja de contacto: `tools/shots/art-contact-sheet-new.png`.
- **Fase F** (menú principal): PENDIENTE — en pausa por decisión del usuario.
- **Fase G** (gates + re-baseline) ✅: **no hizo falta re-basar nada**. `gate:desktop` (31/31) guarda las CLASES de panel por pantalla y `gate:parity` (117) compara geometría del DOM con tolerancia 0.12 (drift máx 0.026): ninguno mira píxeles, así que el arte no los afecta. `git status` vacío tras correrlos ⇒ ningún baseline se reescribió.
- ⚠️ **Cajas del pie**: `pad = border + 8` es 12-20px y la ventana del marco arranca en 26 ⇒ las placas entraban DEBAJO del anillo. `boxPad = max(pad, CARD_FRAME_INSET + 12) = 38` para chips/panel/etiqueta/estados. `tools/audit-card-desc.ts` **importa** `CARD_BOX_INSET_MAX`/`CARD_DESC_TEXT_MARGIN`/`CARD_DESC_FONT_PX` de `CardTexture.ts` (antes hardcodeaba 16 y 23/25 y subestimaba las líneas).

Paleta fijada: bg `#080b10`/`#0d141c`; neutral `#9aa5b1`, poison `#8ce63f`, spore `#f2c14e`, decay `#c1683a`, symbiosis `#4fd18b`, crystal `#5fd8e8`, mycelium `#a78bfa`, parasite `#e05c8a`; frame gold `#d9b25a`.

## MotionFrames (ilustraciones animadas) — V1 ✅

`src/render/MotionFrames.ts` = `frameIndex`/`cellOffset` (puras) + `MotionFrameCache`. `Card3D` tiene un mesh `motion` (CARD_GEO, `z=CARD_TOP_OFFSET-0.012`, `renderOrder=-1`). Manifiesto `public/art/motionframes.json` indexado por **archivo estático** (`art_card_x.webp` → `{file,cols,rows,fps,pingPong}`).

- ⚠️ **`new THREE.Texture()` sin `needsUpdate = true` NUNCA se sube a la GPU** (`version=0` ⇒ `setTexture2D` no la sube) y el quad sale **negro sin error ni warning**. El probe lo cubre con `motionState.uploaded`.
- ⚠️ **Carga DIFERIDA**: `load()` solo lee el manifiesto; la hoja se baja en `acquire`→`requestSheet` y `onSheetReady` re-resuelve. No precargar todas.
- ⚠️ `release()` **libera la textura de GPU** al soltar la última carta (invariante `textures === active`); la imagen queda en `images`.
- ⚠️ `refreshMotion()` = suave (solo si NO tiene hoja); `clearMotion()` = duro (lo usa `low`). Re-resolver una carta que ya tenía hoja puede dejarla sin presupuesto.
- El manifiesto **debe existir** aunque esté vacío: un 404 rompe los probes por error de consola.
- `tools/pack_motion_frames.py` (frames en `art-source/motionframes/<clave>_fNN.png`) → `public/art/mf_<clave>.webp` + manifiesto. `genArtIndex.mjs` excluye `mf_*`.
- Gates: `tests/motionframes.test.ts` (14) + `tools/probe-motionframes.mjs` (10, inyecta su propio manifiesto por route ⇒ no depende de assets reales).
- **Assets (V2)**: `ImageGen` está caído (`route config not found`) ⇒ los frames se hacen **procedurales** con `tools/gen_motion_frames.py` (misma ilustración, solo se mueve la luz: ganancia + halo que se ensancha + exposición). Ventaja sobre img2img: el dibujo es idéntico en los 6 frames, no puede temblar. Se animan las **65** ilustraciones (cada carta tiene arte propio; "el arte del elemento" casi no se ve). Celda 384×558, `WEBP_QUALITY=78`, 3.6 MB total.
- ⚠️ **Rolloff**: `knee + over/(1+k*over)` tiene techo asintótico `knee + 1/k`. Con `k=1.8` daba 1.37 > 1 y recortaba a blanco igual. `knee=0.80, k=8` ⇒ techo 0.925, nunca recorta. Halo ≤0.55. Máscara ponderada por **saturación** (brilla el color, no la luminancia).
- ⚠️ Borrar los 390 PNG con `rm` muere (`Argument list too long` del shim safe-delete): `python -c unlink()` con `CODEBUDDY_SAFE_DELETE_ENABLED=0`.

## Animaciones de carta — V3 ✅

`ImpactRings.ts` (pool 8, shader sin textura, aditivo, `rotation.x=-π/2` pegado al suelo), estela con `particles.stream`, tick de selección (squash/stretch + valle negativo, 0.55 s), descarte con giro. Tests `tests/cardFx.test.ts` (10). Probe `tools/probe-card-anims.mjs` (11 checks).

- **Ejes**: con la carta acostada (`rx=-π/2`), **`ry` = FLIP** (da vuelta), **`rz` = GIRO EN PLANO**. El descarte gira `rz` con `spin=±2π` en tween propio LINEAL de 0.45 s (el jitter de aterrizaje no puede compartir tween: pelearían por `rz`).
- ⚠️ **`sampleFrame` no degrada un tier `manual`**: el `FrameMonitor` (p95, 3 s sobre presupuesto) bajaba `medium`→`low` a los ~3 s bajo SwiftShader y apagaba anillos/estelas a mitad de la jugada. La elección explícita (ajuste de calidad u override por URL) gana; si no, cada arranque repite la degradación.
- ⚠️ **El descarte de mano NUNCA volaba** (bug preexistente): `discardCards` emite `card:discarded` y LUEGO `fillHand()`+`emitState()`→`state:changed`→`syncHand` sincrónicos; `syncHand` destruye toda carta que no esté en `scoringCards` ni `flyingCards`. Fix: el handler agrega a `flyingCards` sincrónico y pasa la INSTANCIA a `flyToDiscard(card3d)` (no el uid: el barrido ya la sacó de `handCards`).
- ⚠️ **Cómo medir animaciones con el reloj lento**: el muestreo va DENTRO de la página encadenado a rAF (un `page.evaluate` suelto cada X ms desde Node ocupa el hilo y AYUNA al loop → reloj a 0.18×). Playwright NO serializa funciones como argumentos: readers/triggers viajan como texto y se reconstruyen con `new Function`. **Corte adaptativo** (`stopSrc`): se corta cuando la animación TERMINA, no por reloj —a `medium` el reloj corre ~0.15-0.5× real y una ventana fija es foto-finish—. El `dt` acotado a 0.05 hace que la resolución no dependa del framerate.

## Efectos 3D — V4 ✅

`PunchPass` en `PostFx.ts` (aberracion cromatica radial + zoom blur de 5 muestras, al final de la cadena del composer) manejado por `updateComboPulse` desde `bgPulse`. Shake direccional (`axisShakeDir`: element→x, family→y, diversity→ambos; ruido sesgado + oscilacion amortiguada). Bloom por rareza en `pop()` (`rarityPopWeight` con **piso 0.35**: el flash es el golpe de TODAS las cartas) + hit-stop extra 30-100 ms para rare ≥ 0.6. Probe `tools/probe-punch.mjs` (7 checks).

- ⚠️ **El pass arranca DESHABILITADO y `setPunch` prende/apaga `enabled`**: en reposo no existe en la cadena (costo cero). `EffectComposer` de three 0.186.1 soporta `isLastEnabledPass` ⇒ deshabilitar un pass es seguro. Medido: frame medio 464→475 ms bajo SwiftShader, se queda en `medium`.
- ⚠️ **El punch samplea la alpha del pixel CENTRAL** (`COMPOSITE_FRAG` manda preservar alpha): con el sampleo desplazado borraria el canvas transparente. Probe: deriva de alpha = 0.
- ⚠️ **`clampPunch`**: no finito ⇒ **0** (no maxear): un uniform corrupto es cuadro negro (regla de `setStrength`).
- ⚠️ **`probe-closure.mjs` medía `scene.scene.background`** (null desde Fase A: el canvas es transparente y el flash vive en `#arena-pulse`). Fix: mide la opacidad inline de `#arena-pulse` + corte adaptativo (el pulso decae a 3/s de tiempo de JUEGO; a reloj lento la espera fija leia 0.63 y fallaba "restaurado" sin que hubiera fuga).

## Endurecimiento — V5 ✅

`tools/probe-leak.mjs` (20 manos reales + 3 en medium) es el gate de fugas: juego greedy, recompensas, tienda, interludios, victoria, reinicios; `settle()` sondea con `page.evaluate` (1/s) y si se cuelga dice QUÉ quedó vivo.

- ⚠️ **El veredicto de texturas es por RESIDUO**, no por tolerancia plana: cada archivo de arte nuevo cuesta 3 texturas (arte + normal + height, compartidas por `art.src`), cada estado de carta 1 (top) y cada hoja animada 1. `residuo = Δtex − (Δart×3 + Δtop + Δhojas)` tiene que ser ~0. La fase medium se compara **mano 1 → mano 3 de medium** (el composer es costo fijo en los dos lados; contra low mediría su costo como fuga).
- ⚠️ **`stats().particles` incluye las esporas de ambiente** (400 medium / 900 high, constantes por tier): el reposo cuenta SOLO las transitorias (`pool.filter(p => p.active)`).
- ⚠️ **BUG REAL (V5)**: `Card3D.applyMotion` asignaba `motionSrc` incluso cuando `acquire` fallaba (presupuesto lleno / hoja sin decodificar) ⇒ reserva FANTASMA ⇒ el `release` de más tarde borraba la reserva de otra carta con el mismo archivo y su textura quedaba **huérfana** (referenciada por un material, fuera de la cache, nadie la libera). Firma: +N texturas vivas solo en medium, geo y cachés sin crecer. Fix: `motionSrc` solo si la reserva se concedió + `release()` con `held <= 0` ⇒ return. Tests en `tests/motionframes.test.ts` (stub de cache, white-box por cast).
- ⚠️ `CameraRig.addShake` ahora tiene gate central `setReducedMotion` (los ~14 call sites viejos tampoco lo respetaban); la respiración de cámara NO se toca (no es golpe).
- ⚠️ `SceneManager.stopCard` borra de `trails` (red central) y `flyToDiscard`/`retire`/`flyScoredToDiscard` hacen `stopTrail` ANTES de `dispose()` en sus `onComplete`: sin eso la entrada quedaba en el `Map` para siempre reteniendo la carta destruida.
- ⚠️ `waitForFunction(fn, {timeout})` manda el objeto como **`arg`**: el timeout real cae al default de 30 s. Siempre `(fn, null, {timeout})`. Y el status de run perdida es `'game_over'` (con guion bajo).
