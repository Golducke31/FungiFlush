# FungiFlush — notas permanentes del proyecto

## Qué es
Roguelite deckbuilder de hongos (estilo Balatro) en TypeScript + Vite + Three.js + Tauri 2.
Repo: `https://github.com/Golducke31/FungiFlush` (rama `main`). Workspace: `C:\Users\emanu\Desktop\FungiFlush`.

## Invariantes que NO se negocian
1. **El motor es puro.** `src/engine/**` no importa Three.js ni toca el DOM. Render y HUD
   solo *observan* el bus de eventos (`src/engine/events.ts`). Ninguna regla de negocio
   entra al motor: se inyecta como predicado o filtro.
2. **Determinismo.** El RNG (`mulberry32`) es reproducible y se guarda la semilla. Nada
   visual puede consumir el RNG del motor (las cartas decorativas del menú usan `Math.random`).
3. **Nada de texto hardcodeado.** Toda cadena visible pasa por `t()`; el contenido usa
   `nameKey` / `descKey`.
4. **Aditivo > invasivo.** Las features nuevas viven en módulos hermanos (`src/content`,
   `src/meta`, `src/engine/board`, `src/audio`), no dentro de scoring/triggers.
5. **El contenido es data-driven.** Balance y contenido van a JSON de packs; el código interpreta.
6. **Los guardados migran.** Ningún release puede invalidar el progreso de un jugador que pagó.
   Perder la colección es peor que perder una partida: el perfil nunca devuelve null.
7. **Renderizar siempre.** No saltear frames con un `return` temprano dentro del rAF: deja el
   canvas sin presentar y rompe las capturas externas del WebView (Play, tests headless).
8. **Ninguna capa del HUD puede tapar el canvas.** El canvas es el que recibe los gestos.
   Solo `.hud-top`, `.hud-jokers`, `.hud-bottom` y `.overlay` llevan `pointer-events: auto`;
   las capas de dibujo (`.hud-popups`, `.toast-stack`, `.hud-tooltip`) llevan `none` y NO se
   puede volver a un selector global tipo `#ui-root > *` (un id le gana a cualquier clase y
   anula esos `none`). Esa regla ya rompió el tap-to-select una vez y el smoke no lo veía
   porque clickeaba por JS.
9. **El tap manda.** Los umbrales de gesto están separados a propósito
   (`CLICK_SLOP_PX = 6` < `DRAG_START_PX = 10`): un tap nunca puede iniciar un arrastre.
   No igualarlos ni invertirlos: el tap-to-select de móvil es el camino principal.
10. **La mano del rival solo sale por `viewFor()`.** El HUD del duelo nunca ve `BoardState`:
    si lo viera, hoy filtraría la mano rival en la pantalla y mañana la mandaría por la red.
11. **Las constantes del tablero viven en `src/engine/constants.ts`**, no dentro de
    `src/engine/board/`: el validador de contenido las necesita al arrancar y si estuvieran
    adentro del módulo diferido el chunk dejaría de ser diferido.
12. **Ningún módulo diferido puede tener un `manualChunks` con nombre propio.** Forzarlo hace
    que Rollup reubique ahí lo que el módulo reexporta, el chunk del motor lo importe (ciclo) y
    Vite lo precargue: el chunk existe y se carga igual. Dejar que Rollup lo decida.

## Estructura clave
- `src/engine/` motor puro · `src/content/` packs y merge · `src/meta/` perfil, entitlements, gate
- `src/data/packs/base/` contenido (declarado por `pack.json`)
- `src/render/` Three.js · `src/ui/` HUD DOM · `src/persistence/` Storage + RunStore + ProfileStore + migrations
- `src/audio/AudioBus.ts` no-op con ganchos ya cableados
- `tools/` sim, smoke, validate-content, genPackIndex, loadContent.node, boardSim
- Render: `Card3D` (cara + dorso + `home.flip`) · `Interaction` (tap y drag) ·
  `DropZone` (regla pura + marco visual) · `SceneManager` (vista, zonas, VFX)
- Tablero: `src/engine/board/**` (puro, chunk diferido) · `board.json` en el pack ·
  `src/content/boardValidation.ts` · `src/ui/BoardScreen.ts` (hot-seat)

## Comandos
`npm run dev | typecheck | test | validate | sim | sim:balance | smoke | build | build:release | packs | tauri`
Tests: `node --import tsx --test "tests/*.test.ts"` (el directorio suelto falla con ERR_UNSUPPORTED_DIR_IMPORT).
`npm run validate` es el gate de contenido: valida los JSON de los packs, la cobertura i18n del
contenido **y** las claves `t('...')` escritas en el código (tools/scanI18n.ts). Correrlo siempre
antes de commitear: es el chequeo que evita que un botón nuevo salga en pantalla como `deck.foo`.

## Flujo de juego (v1.1)
`menu -> blind_select -> playing -> reward (draft de 3, pick 1, skippable) -> shop -> blind_select ...`
Un pack sin tabla `reward` degrada al flujo viejo (`playing -> shop`).

## Gestos (v1.2)
- Tap (≤ 6 px, ≤ 700 ms) = seleccionar. Drag (> 10 px) = levantar la carta.
- Zonas de destino: `discard` (sobre el pilar, descarta ESA carta) · `play` (centro de la
  mesa, suma a la selección) · `hand` (banda delante del jugador, devuelve/deselecciona).
- Se resuelven **por orden de la lista**, no por cercanía; el descarte va primero.
- El rectángulo del descarte termina detrás de la mano (`maxZ 2.8` vs mano `z >= 3.0`).

## Balance de referencia (bot voraz, 100 partidas)
| Versión | Victorias | Ante promedio |
| --- | --- | --- |
| v1.0 (baseline) | 27% | 5.95 |
| v1.1 refactor de tienda, sin draft | 17% | 5.47 |
| v1.1 + drafts | 21% | 5.92 |
| v1.2 + mejoras ilimitadas | 29% | 6.31 |
| v1.2 + flip y drag (500 partidas) | 29.6% | 6.33 |

La Fase 4 no toca balance: el ante promedio se mantuvo. `discardCards()` es el mismo camino
que `discardSelected()`, así que el simulador (que usa la selección) no cambia.

## Duelo micelial (v1.3) — parámetros medidos
Tablero 4x4, 6 cartas por jugador, `tieRule: defender_holds`, quién arranca se sortea.
Con mano 4: 22.8% de empates y 3.3 volteos por partida; con 6: 10.8% y 9.3; con 7: 8.3% y
13.3 pero 14 colocaciones. Con el inicio fijo el reparto era 25% / 63% (colocar segundo vale
un ataque extra); sorteando el inicio, 50.5% / 49.5% entre las decididas.
`npm run sim:board -- --runs N --hand N` es la herramienta para volver a medirlo.

**Mirar el ante promedio para juzgar balance**, no la tasa de victorias: al cambiar el consumo
del RNG de la tienda la tasa se movió 10 puntos mientras el ante promedio casi no cambió (es la
cola de la distribución y con 100 partidas es ruidosa).
Palancas para endurecer el juego sin tocar código: subir ~10% los targets de `antes.json`, o
`baseCost` de `upgrades.json` de 5 a 6.

## Trampas del motor (ya resueltas, no reintroducir)
- **Ningún handler de acción puede mutar el estado global.** El HUD llama a `previewSelection()`
  (pipeline completo en `dryRun`) en cada `state:changed`; mutar ahí hace que el simple hover
  cambie la partida. `LEVEL_UP_CARD` lo hacía; ahora acumula en `ResolutionContext.levelUps` y
  `applyDeltas` lo aplica solo si `!dryRun`.
- Toda edición del mazo (mejorar / evolucionar / purgar) pasa por `canEditDeck()`: solo entre
  blinds o en la tienda, nunca en medio de una mano.
- Una evolución **conserva el uid**: es la identidad de la carta para la selección, el mapa del
  render y `deck.remove(uid)`.

## Calidad gráfica y post-procesamiento (v1.4)
- **`low` ES el camino de render de siempre** (`renderer.render` directo, DPR 1.75): ningún
  dispositivo queda peor que antes, y el smoke corre ahí porque SwiftShader es render por
  software. Si se saca esa regla, las aserciones de tiempo del smoke dejan de valer.
- Tres tiers (`src/render/Quality.ts`) con auto-detección y **auto-degradación por p95 del
  frame** (28 ms en medium, 20 en high, 0 en low; ventana de 90 frames para que un pico
  aislado no cuente).
- `src/render/PostFx.ts`: bloom propio (4 pases, 3 a ¼ de resolución) + `OutputPass` +
  `LUTPass`. **El tone mapping vive en `OutputPass`**; los materiales de `Shaders.ts` son
  `ShaderMaterial` crudos y no incluyen los chunks de tone mapping ni de colorspace.
- **El composer no hereda el `antialias` del renderer** (dibuja sobre un target): el MSAA se
  pasa como `samples` al `WebGLRenderTarget`.
- **`composer.setPixelRatio` redimensiona con las dimensiones viejas**: `setPixelRatio` y
  después `setSize` lógicos, en cada resize.
- **El FPS del smoke no sirve para juzgar el post-procesamiento** (render por software: el
  cociente sale 5–13×). Solo detecta que algo se disparó.
- Un halo por carta (halo + anillo + foil en un shader): 8 cartas pasaron de 45 a 37 draw
  calls. Las sombras de contacto son UN `InstancedMesh` (+1 draw call para todas).
- Las esporas de ambiente se calculan en la GPU; los `burst`/`stream` siguen en CPU (homing).

## Tipografía (v1.4)
- `--font-ui` Fredoka SemiCondensed Bold (HUD) · `--font-display` Gasoek One (títulos, marcador,
  nombres de carta) · `--font-wordmark` Borsok (SOLO el logotipo).
- El canvas de las cartas usa `CARD_DISPLAY_FONT` y `CARD_TEXT_FONT` (ver `CardTexture.ts`).
- `npm run fonts` subsetea + comprime: 1167 KB → 38 KB. Los TTF van en `fonts-source/` (gitignored).
- **`font-synthesis: none` en `:root`** es obligatorio: las tres traen un solo peso y el CSS pide
  800/900, así que sin eso el navegador fabrica negritas sintéticas. El canvas NO respeta esa
  regla: `ctx.font` tiene que pedir los pesos reales.
- **Borsok NO tiene licencia comercial** ("All rights reserved"): está confinada al logotipo a
  propósito. Antes de publicar en Play hay que licenciarla, reemplazarla o sacarla.
- El arranque espera `document.fonts.load()` + `fonts.ready` antes de crear el render.

## Assets
- **Arte de cartas**: `art_card_<elemento>_<rareza>.webp` (8×5 = 40) a 512×744, dibujado a
  SANGRE. Cadena de respaldo: nuevo → `card_<elemento>_common` → los 11 viejos → procedural.
  `public/art/index.json` (generado por `npm run art:index`) lista los que existen: sin él
  serían 40 404 en cada arranque.
- **El sujeto del arte nuevo va entre el 18% y el 62% de la altura** (arriba el nombre, abajo
  los chips).
- Las fuentes PNG viven en `art-source/` (gitignored), no en `public/art/`.
- **El catálogo de prompts de arte es `ART_PROMPTS.md`** (raíz del repo): 40 ilustraciones + 25
  iconos SVG, un prompt listo para pegar por asset, la paleta bloqueada, la banda de composición,
  los lotes (L1 = los 8 `common` es el lote de mayor impacto) y los criterios de aceptación.
  Es la fuente de verdad para generar arte; el README solo resume la especificación.
- Falta: 40 ilustraciones, el logo y 25 iconos SVG monocromo (la tipografía ya está, v1.4).

## Trampas del render / del smoke (ya resueltas, no reintroducir)- **El dorso no se toca por frame.** Cara `FrontSide` + dorso `BackSide` coplanares: el culling
  del GPU decide cuál se ve y el raycaster respeta `material.side`. No volver a alternar
  `.visible` ni a poner los dos con el mismo `side` (el dorso saldría invisible al girar).
- **El tween del flip va aparte del tween del layout.** `cancelFor(home)` (reordenar la mano)
  mataría un giro a mitad de camino. `Card3D` guarda el handle del giro y cancela solo ese.
- **Un `from` de tween se resuelve al CREARLO.** Encadenar tramos con `delay` da un tween
  0 → 0. Para ir y volver (medio giro) hay que encadenar en `onComplete`.
- **`dt` está acotado a 0.05 s en el rAF**: por debajo de 20 FPS las animaciones corren más
  lento que el reloj. Con los ~12 FPS de SwiftShader, un tween de 0.42 s tarda ~0.7 s reales.
  Las esperas del smoke tienen que presupuestarlo (1.6 s) o la aserción lee un estado en vuelo.
- **Capturar la pantalla justo después de un gesto sale atrasado**: esperar un frame (~250 ms)
  antes del `screenshot`.
- **Un smoke que clickea por JS no prueba el ruteo de input.** Para eso hacen falta
  `page.mouse` de verdad; el bug de `pointer-events` sobrevivió 3 fases por eso.
- Para apuntar un gesto a una carta hace falta su posición **en pantalla**: la da
  `SceneManager.handState()`. Para apuntar a un punto del tablero, `projectPointToScreen()`.
- **La lógica nueva del render va a un módulo puro** (`DropZone.ts`: rectángulos y
  `resolveDropZone`) para poder testearla en Node sin DOM ni WebGL. Los tests de gestos
  quedan solo para el smoke.
- **La carga diferida se verifica mirando la RED** (`requestedUrls` en el smoke), no el
  bundle: un chunk puede existir y estar precargado igual. Cero requests del módulo antes de
  abrir la pantalla, al menos uno después.
- **La información oculta se verifica sobre el DOM renderizado**: buscar los uid del rival en
  el `innerHTML` del panel y exigir cero coincidencias. Un `expect` sobre el estado no prueba
  que la pantalla no lo muestre.

## Modelo de negocio (decidido)
App de pago único en Google Play + expansiones de contenido + pases de batalla como
productos gestionados (IAP). Precio sugerido USD 4.99 (referencia: Balatro Android USD 9.99).
Las expansiones son SIEMPRE contenido nuevo, nunca contenido ya pagado. Solo Play Billing.
Empaquetado: Tauri Android (misma base de código), target API 36.

## Convenciones de código
- Comentarios y textos de UI en **español**; identificadores en inglés.
- CSS: BEM-ish con guiones, estados con prefijo `is-`, variables en `:root`, safe-area en
  `--safe-t/-b/-l/-r`, botones de 46 px mínimo.
- Componentes de UI: construyen su propio DOM y emiten intenciones por callbacks; no escriben
  en el motor ni en el perfil (eso lo hace el controlador).
- Los botones del menú llevan `data-act` para los tests (no depender del texto traducido).

## Alcance excluido por decisión
- "Caminos" (rutas de progresión): omitidos; se mantiene la selección de tier lineal.
- Audio: diferido, solo ganchos.
- Arte: placeholders procedurales + catálogo de prompts de generación (ver el plan).
