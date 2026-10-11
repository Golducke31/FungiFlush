# FungiFlush — essentials

TS + Vite + Three.js + Tauri 2 roguelite deckbuilder (Balatro-like). Repo `Golducke31/FungiFlush` (`main`). **Escritorio CONGELADO**; móvil primero. Unico CSS: `src/ui/styles.css` (base=escritorio; móvil `@media (pointer:coarse)`; tablet `(pointer:coarse) and (min-height:600px)`; escritorio final `@media (pointer:fine)`). `src/pointer.ts`=única fuente de puntero (nunca `matchMedia`).

## Gates (prefijo `CODEBUDDY_SAFE_DELETE_ENABLED=0`)
`typecheck`·`test`(tsx,508)·`validate`·`audit:desc`·`smoke`·`sim:balance`(500)·`sim:hands`·`sim:board`·`gate:desktop`(31)·`gate:parity`(baseline `tools/parity-baseline.json`, `--update` re-basa).
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
