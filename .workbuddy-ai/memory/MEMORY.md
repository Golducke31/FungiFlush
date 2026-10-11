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
- **Fase D (card_frame)** ✅: `tools/gen_card_frame.py`→`public/art/card_frame.webp`(1024×1488); singleton `setCardFrameImage/getCardFrameImage` en `CardTexture.ts`; `createCardCanvas`/`createCardBackCanvas` lo dibujan antes del texto. `ArtAssets` key `card_frame`→`art_card_frame.webp`. `main.ts` `setCardFrameImage(assets.get('card_frame')??null)`. Gates green (typecheck/validate/build/smoke/test 508).
- **Fase C (kit HUD `border-image`)** 🔄: generar `public/ui/frames/{panel,plate,button,chip,gold_corner,badge_circle}.png` (centro transparente, wood/moss/gold) y cablear en `styles.css` (`.btn`,`.menu-gel`,`.panel`,`.plate`,`.chip`,`.badge`) SIN quitar gradientes de estado teal/amber. Falta ejecutar.
- **Fase E** (integrar ~109 ilustraciones del usuario vía `docs/PROMPTS_REDISENO.md`): bloqueada en entregas del usuario.
- **Fase F** (menú principal): pendiente.
- **Fase G** (gates + re-baseline `gate:desktop`/`gate:parity`): pendiente.

Paleta fijada: bg `#080b10`/`#0d141c`; neutral `#9aa5b1`, poison `#8ce63f`, spore `#f2c14e`, decay `#c1683a`, symbiosis `#4fd18b`, crystal `#5fd8e8`, mycelium `#a78bfa`, parasite `#e05c8a`; frame gold `#d9b25a`.
