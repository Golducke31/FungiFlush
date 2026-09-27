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

## Estructura clave
- `src/engine/` motor puro · `src/content/` packs y merge · `src/meta/` perfil, entitlements, gate
- `src/data/packs/base/` contenido (declarado por `pack.json`)
- `src/render/` Three.js · `src/ui/` HUD DOM · `src/persistence/` Storage + RunStore + ProfileStore + migrations
- `src/audio/AudioBus.ts` no-op con ganchos ya cableados
- `tools/` sim, smoke, validate-content, genPackIndex, loadContent.node

## Comandos
`npm run dev | typecheck | test | validate | sim | sim:balance | smoke | build | build:release | packs | tauri`
Tests: `node --import tsx --test "tests/*.test.ts"` (el directorio suelto falla con ERR_UNSUPPORTED_DIR_IMPORT).
`npm run validate` es el gate de contenido: valida los JSON de los packs, la cobertura i18n del
contenido **y** las claves `t('...')` escritas en el código (tools/scanI18n.ts). Correrlo siempre
antes de commitear: es el chequeo que evita que un botón nuevo salga en pantalla como `deck.foo`.

## Flujo de juego (v1.1)
`menu -> blind_select -> playing -> reward (draft de 3, pick 1, skippable) -> shop -> blind_select ...`
Un pack sin tabla `reward` degrada al flujo viejo (`playing -> shop`).

## Balance de referencia (bot voraz, 100 partidas)
| Versión | Victorias | Ante promedio |
| --- | --- | --- |
| v1.0 (baseline) | 27% | 5.95 |
| v1.1 refactor de tienda, sin draft | 17% | 5.47 |
| v1.1 + drafts | 21% | 5.92 |
| v1.2 + mejoras ilimitadas | 29% | 6.31 |

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
