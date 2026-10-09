# PLAN — Pulido integral de FungiFlush (9 frentes)

> **Estado:** PROPUESTO — pendiente de aprobación de Emanuel.
> **Convención vigente:** MÓVIL PRIMERO (`docs/CONVENCION_MOVIL_PRIMERO.md`). Todo UI/HUD
> apunta al móvil landscape (ref. 915×412, smoke 844×390). **Escritorio CONGELADO.**
> **Regla transversal:** cada frente cierra con los gates completos y **un probe nuevo**
> que falle sin el cambio y pase con él. Sin probe no está hecho.
>
> **Gates obligatorios por frente** (prefijar `CODEBUDDY_SAFE_DELETE_ENABLED=0`):
> `typecheck` · `test` · `validate` · `smoke` · `audit:desc` · `sim:balance` (500) ·
> `sim:board` · `audit-mobile-buttons`.

---

## Índice de frentes

| # | Frente | Tipo | Riesgo | Depende de |
|---|---|---|---|---|
| 1 | Tutorial optativo (Ante completo guiado) | Feature nueva (grande) | Medio — toca flujo | — |
| 2 | Putrefacción: mecánica + feedback | **Bug + rebalance** | **Alto** | — |
| 3 | Sobres: ¿dónde van las cartas? | Diagnóstico + decisión de diseño | Medio | — |
| 4a | Simbiontes ingame: tooltip rico | Feature (media) | Bajo | — |
| 4b | Simbiontes en Colección: imagen | **Bug** | Bajo | 5 (recomendado) |
| 5 | Colección → grilla por familia/elemento/pack | Rediseño (grande) | Medio | — |
| 6 | Menú: 2 CTA vs logo del fondo | **Bug de layout** | Bajo | — |
| 7 | Purga limitada a 2 por Ante | Feature + persistencia | Bajo | — |
| 8 | Bono de Fungis por ganar en 1 mano | Balance (contenido puro) | **Alto (balance)** | 9 |
| 9 | Desglose de Fungis al cerrar el ciego | Feature (UI + evento) | Bajo | — |

**Orden recomendado de ejecución:** `6 → 7 → 9 → 8 → 2 → 4a → 4b → 5 → 3 → 1`.
Razón: primero lo barato y verificable (6/7/9), después el balance (8), después el bug de
putrefacción (2, el más delicado), después las mejoras de información (4a/4b/5), y por
último las dos piezas grandes (3 y 1) que dependen de decisiones de diseño que conviene
tomar con el resto ya asentado.

---

## FRENTE 1 — Tutorial optativo: un Ante completo guiado

### Objetivo
Tras pulsar **"Nueva partida"**, ofrecer (no imponer) un **tutorial** que juega un **Ante
completo** (2 desafíos + jefe) explicando paso a paso cada pantalla y cada decisión:
elección de ciego, robo, selección de cartas, combos, Sustrato/Esporas, Jugar vs Descartar,
recompensa, tienda, purga/upgrade, y el cierre del ciego con su recompensa.

### Estado actual (medido)
- **Ya existe** un panel de guía informativo: `HUD.showTutorial(force)`
  (`src/ui/HUD.ts:2581-2716`), `.panel.is-tutorial`, `data-act="tutorial"` /
  `"tutorial-close"`. Se auto-muestra una vez por perfil (`profileStore.current.seenTutorial`,
  `src/main.ts:1247-1269`) y es reabrible desde el menú (`onOpenGuide`, `MenuScreen.ts:57`).
  Claves i18n `guide.*`. **Es una pantalla de texto, no un tutorial guiado.**
- **No existe** ningún tutorial por fases, ni resaltado de elementos, ni máquina de pasos.
- **No existe** ninguna noción de "escenario/modo/flags" en el motor: `GameEngineOptions`
  (`src/engine/GameEngine.ts:103-137`) solo acepta `seed`, `bundle`, `contentFilter`,
  `jokerFilter`, `contentHash`, `packIds`, `starterOverrides`, `missions`,
  `archetypeStarter`, `archetypeBias`. El flujo (`menu → blind_select → playing → reward →
  shop → interlude`) está **cableado a mano** en `GameEngine` (no hay tabla de flujo).
- El botón "Nueva partida" abre el **panel de arquetipos**
  (`MenuScreen.buildArchetypePanel`, `data-act="archetypes-start"`). Ahí es donde debe
  ofrecerse "Nueva partida" vs "Tutorial".
- `GameStatus` (`src/engine/state/RunState.ts:21-32`) = `menu | blind_select | playing |
  scoring | reward | interlude | shop | game_over | victory`.

### Diseño propuesto (3 capas separadas)

**Capa A — Estado del tutorial (puro, en `src/meta/Tutorial.ts`, NUEVO).**
Un módulo puro, sin DOM ni motor, con la definición de los pasos y el avance:

```ts
export type TutorialStepId =
  | 'blind_select' | 'hand_dealt' | 'select_cards' | 'combo_hint'
  | 'play_hand' | 'score_breakdown' | 'reward_draft' | 'shop_intro'
  | 'purge_intro' | 'upgrade_intro' | 'boss_intro' | 'ante_complete';

export interface TutorialStep {
  id: TutorialStepId;
  phase: GameStatus;         // en qué estado del juego se dispara
  anchor?: string;           // selector CSS a resaltar ('' = overlay central)
  titleKey: string;          // i18n
  bodyKey: string;
  require?: (run: RunState, round?: RoundState) => boolean;  // gate opcional
  advanceOn: 'tap' | 'player_action';  // 'tap' = botón "Siguiente"; 'player_action' = el jugador hizo la acción
}

export const TUTORIAL_STEPS: TutorialStep[];
export function nextStep(current: TutorialStepId | null, ctx: { status, run, round }): TutorialStep | null;
```

Este módulo es **testeable en Node** (sin mocks): un test recorre el guion entero
simulando estados y verifica que la secuencia es linear y termina.

**Capa B — El tutorial como "escenario" del motor.** El tutorial NO es un modo del motor
con reglas distintas (eso rompería la pureza y el balance). Es una **run normal** con:
- la misma semilla fija (para que los pasos siempre vean las mismas cartas) — sembrar con
  un valor constante, p. ej. `TUTORIAL_SEED = 0xF00D`, y **arquetipo clásico** (no uno de
  `archetypes.json`), para que el mazo de 40 sea el canónico y el guion no dependa del azar;
- un **flag de perfil**, no de motor: `run.tutorial: boolean` en `RunState` (aditivo,
  sobrevive a `serialize/restore` porque es un campo top-level — recordar agregarlo al
  `return` explícito de las migraciones de RUN, no de perfil);
- el avance de pasos lo decide **la capa de UI/controlador** (`HUD` + `main.ts`), no el
  motor. El motor no sabe que hay un tutorial.

**Capa C — Presentación (overlay de paso).** Un único componente
`HUD.showTutorialStep(step, { anchorRect })` que:
- dibuja una **tarjeta flotante** con título + cuerpo + botón "Siguiente" (o "Entendido");
- si `anchor` está definido, **resalta** el elemento por selector: recorta una "ventana"
  con un `box-shadow` gigante (técnica *spotlight*) — un `<div class="tut-spotlight">`
  posicionado sobre el rect del ancla con `box-shadow: 0 0 0 9999px rgba(8,11,16,0.82)`.
  Es CSS puro, no necesita canvas, y funciona igual en móvil.
- el rect del ancla se mide con `getBoundingClientRect()` (o con `boundingBox()` si el
  ancla es un botón animado — regla del proyecto: botones animados se miden con
  `boundingBox()` / `page.mouse.click`).
- **`pointer-events`**: el spotlight NO bloquea el juego salvo cuando el paso pide una
  acción concreta (ahí se bloquea sólo fuera del ancla para forzar el toque correcto).
  Debe estar en la allow-list de `pointer-events` de `#ui-root`.

**Disparo desde el menú.** `MenuScreen.buildArchetypePanel` gana un botón
`data-act="tutorial-start"`:
```
Nueva partida  →  [ Elegir arquetipo ]  →  [ 🔰 Tutorial guiado ]
```
En `main.ts`: `onStartTutorial()` → `engine.startRun(TUTORIAL_SEED, 0, '')` +
`run.tutorial = true` + arranca el guion en el paso `blind_select`.

**Guion de pasos (borrador, ES/EN):**
1. `blind_select` — "Elegí el Desafío 1. El objetivo es X. Tienes N manos y M descartes."
2. `hand_dealt` — "Estas son tus cartas. Toca una para seleccionarla."
3. `select_cards` — "Seleccioná 3–5 cartas. Fijate en la Familia (el 'palo') y el Elemento."
4. `combo_hint` — al primer combo detectado: "¡Combo de Familia! Eso suma multiplicador."
5. `play_hand` — "Pulsa JUGAR. El Sustrato se multiplica por las Esporas."
6. `score_breakdown` — "Así se armó el puntaje: Sustrato base → bonus → × Esporas."
7. `reward_draft` — "Elegí 1 carta de las 3. Entra a tu mazo al instante."
8. `shop_intro` — "Con los Fungis que ganaste comprás Simbiontes, cartas o mejoras."
9. `purge_intro` — "Podés purgar cartas para adelgazar el mazo (ojo: máx. 2 por Ante)."
10. `upgrade_intro` — "Subir de nivel una carta multiplica su valor. Sin techo."
11. `boss_intro` — entre desafío 2 y jefe: "El Jefe tiene reglas propias. Miralas en su panel."
12. `ante_complete` — "¡Ante completo! Así se juega FungiFlush. ¡Suerte en tu primera run!"

**Cierre:** al completar el paso 12 se apaga `run.tutorial`; el jugador puede seguir la
run o salir al menú. Marcar `profileStore.current.seenTutorial = true` para que no vuelva
a ofrecerse como auto-aviso (dejarlo reabrible por el menú, como hoy).

### Archivos a tocar
| Archivo | Cambio |
|---|---|
| `src/meta/Tutorial.ts` | NUEVO — pasos + `nextStep` (puro) |
| `tests/tutorial.test.ts` | NUEVO — el guion avanza lineal y termina |
| `src/ui/HUD.ts` | `showTutorialStep()` + spotlight + `hideTutorialStep()` |
| `src/ui/MenuScreen.ts` | botón `data-act="tutorial-start"` en el panel de arquetipos |
| `src/main.ts` | `onStartTutorial()`, avance de pasos escuchando `bus`/`state:changed` |
| `src/engine/state/RunState.ts` | campo `tutorial: boolean` (+ serialización) |
| `src/i18n/en.json` / `es.json` | namespace `tutorial.*` |
| `src/ui/styles.css` | `.tut-card`, `.tut-spotlight`, `.tut-actions` |
| `tools/scanI18n.ts` | agregar `tutorial` a `DYNAMIC_FAMILIES` si se usan claves dinámicas |
| `src/ui/styles.css` | `.tut-*` |
| `tools/probe-tutorial.mjs` | NUEVO — gate end-to-end |

### Probe `tools/probe-tutorial.mjs`
- arranca el tutorial desde el panel de arquetipos;
- verifica que el paso 1 aparece con su spotlight sobre el ancla correcta;
- **juega de verdad** el primer desafío con gestos reales (tap, drag, click en Jugar) y
  confirma que el guion avanzó por `select_cards → play_hand → score_breakdown`;
- confirma que al llegar al jefe el paso `boss_intro` aparece;
- confirma que al cerrar el Ante `ante_complete` aparece y `run.tutorial === false`;
- **assert final:** 0 errores de consola, y que el tutorial NO se auto-muestra en una
  segunda "Nueva partida" normal.

### Riesgos
- **El guion asume cartas concretas.** Mitigación: semilla fija + mazo clásico; si un paso
  depende de un combo, el paso `combo_hint` es **opcional** (`require` devuelve false y se
  saltea) — el guion nunca se traba esperando algo que no pasó.
- **Bloquear la UI en un paso puede dejar al jugador sin saber qué hacer.** Mitigación:
  todo paso con `advanceOn: 'player_action'` también tiene un botón "Saltar paso".
- **Reducción de movimiento.** El spotlight es estático; con `reduceMotion` se desactiva
  cualquier pulso (regla ya vigente en el proyecto).

---

## FRENTE 2 — Putrefacción: mecánica + feedback (el frente más delicado)

### Diagnóstico (causa raíz, verificada en código)

**Por qué una mano puede puntuar 0 — la cadena exacta:**
1. `total = Math.max(0, Math.round(substrate * spores))` (`src/engine/resolution.ts:117-125`).
   El **Sustrato** es la suma aditiva; las **Esporas** son el multiplicador (≥ 1 en el caso
   normal). Para que `total` sea 0 alcanza con que **`substrate ≤ 0`** ⇒ `0 × esporas = 0`.
2. La putrefacción **resta Sustrato plano por cada disparo** de la carta afectada:
   `src/engine/triggers/TriggerEngine.ts:127-133` →
   `if (decay > 0) res.addSubstrate(-decay, ...)`. Se ejecuta **una vez por cada
   efecto/objetivo** que resuelve la carta, no una vez por mano.
3. Una carta con putrefacción de valor alto, o **varias pilas acumuladas**, dispara varias
   veces por mano ⇒ la resta supera el Sustrato base de la mano ⇒ `substrate ≤ 0` ⇒ **0**.

**Por qué se acumula y por qué persiste entre ciegos:**
4. `decayStatuses()` (`src/engine/GameEngine.ts:1668-1684`) recorre **`run.deck.allCards`**
   = `[...drawPile, ...discardPile]`, que **excluye `round.hand`**. Se llama **una sola vez**,
   en `leaveShop()` (`GameEngine.ts:1159`). Consecuencia: las cartas **en mano nunca
   envejecen su contador**, y como las cartas aplicadas por contenido usan `turns: -1`
   (permanente), la putrefacción **no expira jamás** hasta un `CONSUME_STATUS`.
   Los `CardInstance` viven en `run.deck`, así que el estado **sobrevive entre ciegos**.

**El bug latente que multiplica el problema:**
5. `APPLY_STATUS` (`src/engine/triggers/actions.ts:138-168`) **muta la carta de verdad
   aunque `dryRun === true`** (sólo el *evento* está blindado). Como el HUD llama a
   `previewSelection()` en cada cambio de selección (`GameEngine.ts:522-531` → `dryRun`),
   **seleccionar** una carta cuyo efecto aplica putrefacción **la aplica de verdad**.
   Está marcado como bug latente en el código y **no se tocó a propósito** ("merece su
   propia tanda con tests").

**Por qué la animación no se ve:**
6. El único indicador persistente es el aura ambiental
   `SceneManager.updateStatusAmbient` (`src/render/SceneManager.ts:1938-1952`) →
   `card3d.setRot(base * …)` con `uRot` en el halo (`src/render/Shaders.ts:99-108`).
   El halo es **aditivo y a profundidad off**, y en la mano está **atenuado a propósito**
   (el borde verde de selección es el protagonista). Resultado: lee como un brillo cálido
   sutil, no como "esta carta se está pudriendo".
7. El chip en la cara (`CardTexture.ts:1057-1127`) usa el texto **`"DECA"`** (recorte de
   `status.slice(0,4).toUpperCase()`, **no localizado**) con `STATUS_COLOR.decay`
   (`0xc1683a`), y la cara **no se refresca al aplicarse el estado** (`Card3D.setCard` sólo
   se llama en reparto/robo/evolución). ⇒ muchas veces el chip ni aparece hasta el próximo
   reparto.
8. En el **HUD no hay ningún indicador de putrefacción**: sólo el tooltip
   (`HUD.ts:4185-4190`) muestra `status.decay` como texto.

### Cambios propuestos (en 4 bloques, cada uno con su test)

**Bloque 2.A — Bug de `dryRun` (primero, porque envenena todo lo demás).**
Hacer que `APPLY_STATUS` respete `dryRun` igual que `CONSUME_STATUS`: acumular las
solicitudes en `res.statusRequests` durante `dryRun` y **aplicarlas sólo cuando
`!dryRun`** al asentar la resolución (donde ya se aplican `levelUps`, `purgeCostDelta`,
`createdIds`: `GameEngine.applyDeltas`, ~`:1380-1419`).
- **Riesgo de balance:** esto **cambia el puntaje previsualizado** (hoy la selección
  aplica putrefacción real, así que el preview "ya la cuenta"; después del fix, la
  aplicará al jugar). Hay que **re-simular** (`sim:balance` 500) y comparar la tasa de
  victoria. Si cambia demasiado, se compensa en contenido, no en código.
- Test: `tests/status.test.ts` — seleccionar/preseleccionar N veces no muta `card.statuses`;
  jugar sí; el resultado del `preview()` es estable y no acumulativo.

**Bloque 2.B — Mecánica: que la putrefacción no pueda llevar el puntaje a 0.**
Tres palancas, a decidir con datos (recomiendo aplicar **B1 + B2**, y medir B3):
- **B1 — Tope por mano.** Que la putrefacción **no reste más que el Sustrato que la propia
  carta aporta**. Es decir: la penalización se clampa a `min(decayTotal, max(0, aporteDeLaCarta))`.
  Garantiza que una carta podrida aporte **0, nunca negativo**. Una mano sin Sustrato
  aporta 0, pero el resto de la mano sigue puntuando. **Rompe el caso "mano entera a 0".**
- **B2 — Decremento real entre ciegos.** Que `decayStatuses()` recorra **también la mano**,
  o que se llame en cada fin de mano; y que el decremento aplique a las cartas del mazo
  completo con `turnsLeft > 0`. Con `turns: -1` (permanente) sigue sin expirar: **revisar
  el contenido** para que la putrefacción de contenido use `turns: N` (p. ej. 3) en vez de
  `-1`, salvo las que son intencionalmente permanentes.
- **B3 — Piso de Sustrato.** Suavizar el clamp: `total = max(MIN_FRACTION × baseSubstrate,
  substrate) × spores` para que ninguna mano baje de, digamos, el 15% de su base. Es la
  opción más conservadora si B1 no alcanza. **Medir antes de adoptar.**
- Rebalance de contenido: los valores `decay` de `blinds.json` (el jefe de A2 aplica
  `decay 2 turns 1`) y de las cartas (`decay_compost_heap` value 2, `decay_agaric_mould`
  value 1, `decay_amanita_blight` value 2, `deep_mycelium/01_deep.json` value 2). Estos
  son **datos**, no código: el rebalance se hace ahí.
- **Responder a la pregunta de Emanuel** en el plan: *"¿se acumula entre ciegos?"* →
  Sí, ver el punto 4. Con B2, deja de acumularse indefinidamente.

**Bloque 2.C — Contador visible de putrefacción (lo que pide Emanuel).**
- **Chip en la carta, localizado y visible:** `CardTexture.ts` debe usar la clave i18n
  (`status.decay` = "Pudriéndose"/"Decaying") en vez del recorte `"DECA"`, y mostrar el
  **valor numérico** (`−2`) además del icono. Se dibuja con un color de alarma más
  saturado que el actual (`0xc1683a` es apagado sobre la cara oscura).
- **Refresco en caliente:** suscribir `SceneManager` a `status:applied` / `status:consumed`
  y llamar `Card3D.setCard(card)` (o un método `refreshFace()`) para que el chip aparezca
  al instante, no en el próximo reparto. ⚠️ Ojo con la caché de textura (`setCard` arma la
  key desde `card.statuses`; ya contempla el cambio, sólo falta llamarlo).
- **Fila de estado bajo las cartas (HUD):** una franja `.hud-decay` permanente bajo la
  mano que muestra el **total de putrefacción activa en la mano** (`Σ decay de las cartas
  seleccionadas/en mano`) con icono de gota pútrida y el número. Es lo que Emanuel describe
  como "un contador aparte debajo de las cartas". Se alimenta de `round.hand` en cada
  `state:changed`.
- **Aviso antes de jugar:** si el Sustrato proyectado de la selección es ≤ 0 (o ≤ 15%), el
  botón "Jugar" muestra un **badge de advertencia** (`is-risky`) con el texto
  "Se pudre: puntaje 0". Es la única forma de que el jugador no se entere perdiendo.
- i18n: `status.decay`, `hud.decayLabel`, `hud.decayWarning`.

**Bloque 2.D — Animación de putrefacción realmente visible.**
- **Cara de la carta:** tinte permanente verdoso-marrón por encima del arte cuando
  `statuses` incluye `decay` (un overlay con opacidad proporcional a las pilas), no sólo el
  chip. Es el lenguaje estándar: carta podrida = carta sucia.
- **Glow:** subir la intensidad del `uRot` del halo **sólo en la mano de juego** (donde hoy
  está atenuado adrede) y **animar** el band en vez de un pulso estático; con `reduceMotion`
  se degrada a tinte estático.
- **Partículas:** hoy `playStatusApplied` lanza 22 partículas y un shake 0.06
  (`SceneManager.ts:1871-1882`). Subir a un goteo continuo lento (stream) mientras la carta
  siga podrida, más un "pop" al aplicarse.
- **VFX de puntaje:** cuando una carta podrida resta Sustrato, mostrar el `−N` flotante en
  rojo junto al ticker (hoy la resta no se ve en ningún lado).

### Archivos a tocar
`src/engine/triggers/actions.ts` · `src/engine/triggers/TriggerEngine.ts` ·
`src/engine/resolution.ts` · `src/engine/GameEngine.ts` (`decayStatuses`, `applyDeltas`) ·
`src/engine/constants.ts` (`MIN_FRACTION`/reglas) · `src/data/packs/base/blinds.json` y
`cards/*.json` y `deep_mycelium/01_deep.json` (valores, no código) ·
`src/render/CardTexture.ts` · `src/render/Card3D.ts` · `src/render/SceneManager.ts` ·
`src/render/Shaders.ts` · `src/ui/HUD.ts` + `styles.css` · `src/i18n/*.json`.

### Gates específicos
- `tests/status.test.ts` (NUEVO): dryRun no muta; B1 garantiza aporte ≥ 0; B2 decrementa en
  mano; reparación de la regresión de `CONSUME_STATUS`.
- `tools/probe-decay.mjs` (NUEVO): monta una mano con putrefacción alta y verifica en
  pantalla que (a) el contador `.hud-decay` aparece con el número correcto, (b) la cara
  muestra el chip localizado, (c) **el puntaje final NUNCA es 0 con una mano de base > 0**,
  (d) el badge `is-risky` aparece cuando corresponde.
- `sim:balance` (500) antes/después: la tasa de victoria y el ante medio no deben moverse
  más de ~3 puntos. Si se mueven, se recalibra contenido.

---

## FRENTE 3 — Sobres: ¿dónde van las cartas y para qué sirven?

### Respuesta verificada (lo que el código hace hoy)
- Un sobre **sólo** cae del **Jefe** (`blind.tier === 'boss'`), con
  `BOSS_PACK_DROP_CHANCE = 0.5` y pity a los 2 fallos (`src/meta/Packs.ts`;
  cableado en `src/main.ts:433-503`, handler `round:win`).
- Al abrirlo (`openPacks`, `src/main.ts:1615-1685`), cada carta sorteada se escribe en
  **`profile.collection.ownedCounts[cardId]++`** y **nada más**.
- **Confirmado:** *no existe ninguna ruta de sobre → mazo.* El mazo de la run se arma en
  `startRun` (`CardRegistry.buildStarterDeck`) y no cambia por abrir sobres.
- Por lo tanto, hoy un sobre es **progreso de colección** (badge ×N) + **deseo de
  expansión**, no potencia jugable. `docs/SISTEMA_SOBRES_Y_DECK.md` ya documenta esa brecha
  y propone la Parte B (mazo propio) como solución — **ya implementada** (`DeckPresets.ts`,
  perfil v7), con gate **Colonia nivel ≥ 3**.

### Decisión de diseño que hay que tomar (bloqueante)
Hay tres caminos y **no son excluyentes**:

| Opción | Qué implica | Coste | Recomendación |
|---|---|---|---|
| **3.1 — Dejarlo como está + explicarlo** | El sobre es cosmético/colección. Añadir copy claro ("los sobres llenan tu Colección; tu mazo se arma en 'Mazo propio'"). | Mínimo | Hacer YA (barato, quita la confusión) |
| **3.2 — Sobres dan cartas al mazo de la run en curso** | Cambia el modelo: rompe el diseño "sobre = meta". Requiere decidir si entran directo o como oferta. | Alto + riesgo de balance | **No** sin simulación |
| **3.3 — Desbloqueo de cartas jugables** | Que una carta con `ownedCounts > 0` pueda usarse en el **Mazo propio** sin depender sólo del catálogo. Hoy `MAX_COPIES_PER_CARD = 4` ya permite usar el catálogo; el sobre pasaría a habilitar **copias extra**. | Medio | **Mejor camino**; enlaza 3 con 5 |

**Propuesta:** implementar **3.1 ahora** (copy + un panel explicativo en la Colección junto
al botón de sobres) y **dejar 3.2/3.3 como decisión de diseño** para después del rediseño
de Colección (frente 5), que es donde tiene sentido mostrar "tienes N copias, puedes usar
hasta M". Preguntar a Emanuel cuál quiere; el plan deja el gancho listo.

### Archivos / gates
`src/ui/CollectionScreen.ts` (copy, panel de ayuda) · `src/i18n/*.json` (`packs.help*`) ·
`docs/SISTEMA_SOBRES_Y_DECK.md` (actualizar con la respuesta). Probe:
`tools/probe-packs.mjs` (ya existe) extendido para verificar que el copy aparece y que
`ownedCounts` sube sin tocar el mazo.

---

## FRENTE 4 — Simbiontes (jokers)

> **ESTADO ACTUAL (posterior a este plan):** la columna de fichas del HUD
> (`.hud-jokers` / `.joker-chip`) se **RETIRO** — peleaba lugar con la pila de
> DESCARTE (ambas a la izquierda) y se superponia. Vender Simbiontes quedo SOLO
> en la pestana Vender de la Tienda, y las **acumulaciones de la run** (Disparos
> `xN` + valor de venta) viven ahora en la **etiqueta de long-press de la CARTA**
> (`HUD.showJokerTooltip`). Los puntos 1-4 de abajo describen el estado PREVIO;
> el probe `tools/probe-joker-tooltip.mjs` ya verifica el comportamiento nuevo.

### 4.a — Ingame: etiqueta rica al mantener/posar
**Confirmado:** "Simbionte" es un **alias i18n de joker** (`hud.jokers` = "Simbiontes",
`es.json:32`). No son un tipo aparte. Hoy la ficha del Simbionte en el HUD
(`HUD.renderJokers`, `HUD.ts:1439-1519`) tiene:
- `chip.title` **nativo del navegador** (`"Nombre — Descripción"`, `:1452`) — feo, lento,
  no estilizado, y en móvil casi nunca aparece;
- una línea de habilidad (`joker-chip-ability`, `:1466-1471`) que muestra sólo la **primera**
  etiqueta de efecto o la rareza.

**No usan** el tooltip rico de las cartas (`HUD.showTooltip`, `HUD.ts:4082-4225`, clases
`.tooltip-name/.tooltip-taxonomy/.tooltip-badge.is-family/.tooltip-rarity/.tooltip-desc/
.tooltip-stats`), que es el que muestra Familia/Elemento/Rareza/Descripción.

**Cambio propuesto:**
1. Añadir a `JokerDefinition`/`JokerInstance` la **taxonomía** que ya existe en las cartas
   (`family`, `element`) — o, si un joker no tiene familia por diseño, mostrar
   `collection.trait: 'Simbiótico'` + su rareza y **todos** sus efectos, no sólo el primero.
2. Generalizar `HUD.showTooltip` para aceptar **`CardInstance | JokerInstance`** (una
   interfaz común con name/desc/rarity/element/family/stats). Reusar el mismo componente en
   vez de crear uno nuevo: menos superficie, misma estética.
3. Cablear **hover** (`onHoverChange`, ya existe para cartas, `main.ts:773`) **y
   long-press** (`onLongPressChange`, regla móvil: el hover no llega sin `pointermove`).
   Hoy las fichas de joker sólo tienen `click → onFocusJoker`.
4. Quitar el `chip.title` nativo (o dejarlo como fallback accesible con
   `aria-label` correcto, que hoy es el `title`).

**Archivos:** `src/engine/types.ts` (o el JSON de jokers si la taxonomía ya está) ·
`src/data/packs/base/jokers.json` (agregar family/element si faltan — **es contenido**) ·
`src/ui/HUD.ts` (`showTooltip` genérico + `renderJokers` hover/long-press) ·
`src/main.ts` (cableado de hover/long-press sobre la columna de jokers) · `styles.css`.
**Probe:** `tools/probe-joker-tooltip.mjs` — long-press sobre una ficha y verifica que
`.hud-tooltip.is-visible` muestra nombre, rareza, familia/elemento y **todos** los efectos.

### 4.b — Colección: los simbiontes no tienen imagen
**Estado real:**
- En el **carrusel 3D** (la vista activa) los jokers **sí** se dibujan, pero con **arte
  prestado**: `artKeysForJoker` (`src/render/ArtAssets.ts:323-324`) delega en `artKeysFor`
  **sin pasar `cardId`**, así que nunca usa el slot `card_own_${cardId}`
  (`ArtAssets.ts:308`). ⇒ un joker cae al arte genérico de `element × rarity` (o al
  procedural). Por eso "no tienen su imagen correspondiente".
- En el **grid 2D** (`buildCollectionPanel`, `CollectionScreen.ts:324-388`) **no hay imagen
  en absoluto**: sólo un `swatch` de color + nombre. Ese es el caso más visible del bug.

**Cambio propuesto:**
1. Decidir si los jokers **tienen** arte propio. Si sí: generar `art_joker_<id>.webp`
   (o reusar `art_card_own_<id>`) y hacer que `artKeysForJoker` pase un `cardId`-equivalente
   (`joker_${id}`) para que el slot propio gane. **Es el fix correcto.**
2. Si no van a tener arte propio (más barato): que el grid 2D dibuje la **misma cara
   procedural** que el carrusel (`SceneManager.jokerArt(def)` → canvas → `<img>`), de modo
   que al menos haya imagen coherente en ambas vistas.
3. Reusar `artKeysForJoker` como **única fuente** en las dos vistas (hoy el carrusel usa una
   ruta y el grid otra).

**Archivos:** `src/render/ArtAssets.ts` (`artKeysForJoker`) · `src/ui/CollectionScreen.ts`
(grid con imagen) · `src/main.ts` (`buildCollection` pasa `faceUrl` también para jokers) ·
`src/render/SceneManager.ts`. Si se generan 30 artes de joker: `ART_PROMPTS.md` +
`tools/optimize_art.py` + `npm run art`. **Probe:** `tools/probe-collection-jokers.mjs` —
verifica que cada entrada `kind:'joker'` resuelve una URL de imagen no vacía y que dos
jokers distintos no comparten la misma imagen.

> ⚠️ Dependencia: si Emanuel elige el frente 5 (grilla), 4.b se implementa **dentro** de ese
> rediseño, no por separado — el grid de la Colección es justo lo que se reescribe.

---

## FRENTE 5 — Colección: de carrusel 3D a grilla tipo Pokémon TCG

### Opinión (la pidió Emanuel)
**Sí, y es la dirección correcta.** El carrusel 3D de 77 entradas (65 base + 12 expansión +
jokers) obliga a recorrer una por una; es bonito para *mirar* una carta, malo para
*gestionar* una colección. Una grilla con filtros por **Familia / Elemento / pack (sobre) /
estado (descubierta, bloqueada, desbloqueada)** es la respuesta estándar y favorece el
"coleccionar" (ver huecos que faltan, como hace Pokémon TCG). Además **resuelve 4.b** de
paso, porque el grid es donde falta la imagen.

### Estado actual (medido)
- Vista activa: `buildCollectionCarousel` (`CollectionScreen.ts:153-322`), panel
  `.panel.is-collection.is-carousel-frame`, centro vacío reservado al canvas 3D
  (`CardCarousel`), detalle en `.carousel-detail` (nombre, meta, `carousel-detail-copies`).
- **Ya existe** un `buildCollectionPanel` 2D en desuso (`:324-388`) con `.collection-grid`,
  `.collection-card`, estados `.is-locked/.is-unlocked/.is-unknown`, `.collection-swatch`,
  `.collection-count`. **Es el punto de partida, no se inventa de cero.**
- Filtros hoy: sólo `all | cards | jokers | locked | unlocked`
  (`data-act="filter-{mode}"`). **No hay filtro por familia/elemento/pack.**
- El orden es fijo: descubiertas primero, rareza, id (`main.ts:683-690`).
- Los datos ya están: `CollectionEntry` tiene `kind`, `element`, `rarity`, `seen`,
  `state`, `count`; y `buildCollection` (`main.ts:627-692`) conoce el pack de cada carta
  (`content.registry.packOf(id)`) — **sólo falta exponerlo en la entrada.**

### Diseño propuesto
1. **`CollectionEntry` gana `family?: Family` y `packId: string`** (aditivo; el grid los
   usa, el carrusel puede ignorarlos). `buildCollection` los rellena desde el registro.
2. **Grilla agrupada por pack → familia → elemento.** Cabeceras de sección colapsables
   (`.collection-section`), al estilo TCG: "Base — Amatoxinas", "Micelio Profundo —
   Esporas", "Simbiontes". Orden por familia, luego elemento, luego rareza.
3. **Barra de filtros**: chips `data-act="filter-family"`, `filter-element`,
   `filter-pack`, `filter-state` (descubiertas/desconocidas/bloqueadas), más los de tipo
   actuales. Estado de filtro en memoria (no persistido).
4. **Celda de carta real**: cara con arte (`cardFaceUrl` / `artKeysForJoker`) + nombre +
   badge `×N` + candado si bloqueada, + silueta si desconocida. Reusar `.collection-card`
   existente (ya tiene los estados).
5. **Detalle**: al tocar una celda, un panel de detalle (reusar `.carousel-detail` o un
   modal `.collection-detail`) con la etiqueta rica de 4.a (familia/elemento/rareza/desc/
   stats/copias). **Unifica 4.a y 4.b.**
6. **Móvil primero:** `grid-template-columns` con `auto-fill/minmax`, tap ≥ 26px
   (`audit-mobile-buttons`), scroll con `overflow-y:auto`, safe-area.
7. **¿Se borra el carrusel 3D?** Recomiendo **conservarlo como vista "Exhibición"** opcional
   (un botón `data-act="collection-view-carousel"`) o, si se quiere simplicidad, eliminarlo
   y borrar `CardCarousel` del panel de colección (queda en uso por Recompensa). **Decisión
   de Emanuel** — el plan asume preservarlo para no perder trabajo, pero con la grilla por
   defecto.
8. **Persistencia del modo de vista** en el perfil si se conserva el carrusel (campo
   `settings.collectionView`).

### Archivos
`src/ui/CollectionScreen.ts` (reescritura del builder) · `src/main.ts` (`buildCollection`
con family/pack) · `src/ui/styles.css` (`.collection-section`, filtros, celda) ·
`src/i18n/*.json` · `src/render/CardCarousel.ts` (sólo si se elimina del panel).
**Probe:** `tools/probe-collection-grid.mjs` — cuenta celdas = entradas no ocultas, verifica
que cada filtro reduce el conteo correctamente, que un joker muestra imagen (cierra 4.b) y
que una carta bloqueada muestra el candado. Capturas en `tools/shots/collection-*.png`.

### Riesgos
- **77 entradas en un móvil landscape** ⇒ hay que medir el peor caso (regla del proyecto:
  "un layout que sirve con 2 ofertas rompe con 4"). El grid debe virtualizarse o paginarse
  si el DOM se vuelve lento; medir con `probe-*.mjs`.
- **Regresión de `RewardPanel`/`CardCarousel`**: Recompensa usa el mismo `CardCarousel`.
  No tocar la clase, sólo el panel de Colección.

---

## FRENTE 6 — Menú: "Nueva partida" + "Continuar" vs el logo del fondo

### Diagnóstico (esto ya fue un fix previo y volvió a fallar)
El fix del 2026-10-07 (memoria del día, "FIX del botón Nueva partida") estableció:
- El "FUNGI FLUSH" **no es DOM**: vive horneado en `public/menu-bg.jpg` (1376×768).
- `.menu-art` (`styles.css:3431`) replica `cover` con media queries
  (`@media (min/max-aspect-ratio: 1376/768)`).
- A 915×412: `height = 915×768/1376 = 510.7`, `top = -49.3`. La palabra "FLUSH" termina al
  **47.7%** del alto del arte ⇒ **y ≈ 194px** en pantalla.
- El fix movió `.menu-hero` a `justify-content: flex-end` + `padding-top: 52vh`, y topó los
  botones por `vh`: `.menu-cta-wrap` `font-size: min(clamp(22px,4vw,38px), 7.4vh)`,
  `.is-continue` `min(clamp(18px,3.2vw,30px), 6vh)`. Con eso quedaban **31.7px de aire**.

**El problema que reporta Emanuel ahora:** cuando **los dos** botones están activos
(hay partida guardada) el aire se reduce porque hay dos CTAs apiladas
(`.menu-cta-wrap` + `.menu-cta-wrap.is-continue`) más el `.menu-cta-sub`. La reserva
`padding-top: 52vh` es un **valor fijo** y no crece con el contenido ⇒ con 2 CTAs grandes el
bloque sube (por `flex-end` el bloque crece hacia arriba) y **pisa el logo**.

### Fix propuesto (medido, no estimado)
1. **Reservar el logo con `height`, no con `padding-top`.** Cambiar `.menu-hero` a
   `justify-content: flex-end` con un **`.menu-hero-spacer`** (o `padding-top` calculado)
   cuya altura sea `max(52vh, logoBottomY + aire)` — donde `logoBottomY` se calcula con la
   **misma matemática de `cover`** que ya está en `styles.css` y en
   `tools/shot-menu-buttons.mjs`. Es decir: **que el CSS derive el 47.7% del arte igual que
   el probe**, en vez de un `52vh` fijo.
2. **Modo "ambos activos" ya existe parcialmente:** hay reglas
   `.menu-hero.is-both .menu-cta-wrap` (`styles.css:4194-4217`). **Verificar que la clase
   `is-both` se aplica de verdad** — puede ser el bug real (si no se aplica, los CTAs usan
   el tamaño grande y el bloque no cabe). Revisar `MenuScreen.ts:352-400`.
3. **Escalar los CTAs cuando hay dos.** Con `is-both`, reducir el `font-size` de ambos
   (p. ej. primario a `min(clamp(20px,3.6vw,34px), 6.6vh)` y secundario a
   `min(clamp(16px,3vw,26px), 5.4vh)`) y **ocultar/colapsar `.menu-cta-sub`** o pasarlo a
   `position:absolute` para que no empuje el bloque.
4. **Guard permanente en `tools/shot-menu-buttons.mjs`** (ya replica la matemática y reporta
   `titleClearance` con veredicto `[OK]/[PISADO]`, umbral 8px). Extenderlo para probar el
   caso **con partida guardada** (dos CTAs activos) — hoy probablemente sólo prueba uno.
   Añadir el caso a 915×412, 844×390, 412/390/360/340 de alto.

### Archivos
`src/ui/styles.css` (`.menu-hero`, `.menu-cta-wrap`, `is-both`, media queries) ·
`src/ui/MenuScreen.ts` (`is-both`) · `tools/shot-menu-buttons.mjs` (caso de 2 CTAs).
**Gate:** `shot-menu-buttons.mjs` con `[OK]` **en ambos escenarios** (1 y 2 CTAs).

---

## FRENTE 7 — Limitar las purgas a 2 por Ante

### Estado actual
- `purgeCard(uid)` (`GameEngine.ts:1017-1036`) sólo valida `canPurge()` (status
  `blind_select` o `shop`) y `run.money >= purgeCost`. **No hay contador.**
- `purgeCost` es un getter (`GameEngine.ts:853-860`):
  `ECONOMY.purgeCost (4) + ascension.purgeCostDelta + run.purgeCostBonus`.
- Estado en `RunState`: `purgeCostBonus` (`RunState.ts:88`). **No existe `purgesThisAnte`.**
- La UI (`DeckBuilderScreen.ts:247-254`, `:457-464`) deshabilita el botón por
  `!canEdit || money < purgeCost`.

### Diseño
1. **`RunState.purgesThisAnte: number`** (init `0` en `createRunState`, `RunState.ts:163`).
   **Debe entrar al `serialize()`/`restore()` de la run** (es estado de run, no de perfil).
2. **Constante de contenido:** `ECONOMY.purgesPerAnte = 2` en `src/engine/constants.ts`
   (y, si se quiere que una expedición lo cambie, un espejo en `antes.json` o en los
   modificadores de ascensión — **mejor en `antes.json`** para mantener "el balance es
   contenido").
3. **Gate en `purgeCard`:** `if (this.run.purgesThisAnte >= this.purgesPerAnteLimit) return
   false;` y `this.run.purgesThisAnte += 1` al purgar. Nuevo getter
   `get purgesLeft(): number`.
4. **Reset por Ante:** en `leaveShop()`, donde ya se hace `this.run.ante += 1` y
   `blindIndex = 0` (`GameEngine.ts:1147-1148`), `this.run.purgesThisAnte = 0`.
   ⚠️ El reset debe ir **dentro** de la rama "nuevo ante", no en cada ciego.
5. **Evento para la UI:** `bus.emit('purge:changed', { used, left })` en `purgeCard` y en el
   reset (o derivarlo del `state:changed` que ya existe).
6. **UI:** el botón "Purgar" del `DeckBuilderScreen` muestra el resto
   (`data-act="purge"`, label `"Purgar (2)"` o un chip `.purge-left`) y se deshabilita al
   llegar a 0 con tooltip explicativo. El `state` del deck builder
   (`HUD.ts:2992-2993`) ya pasa `purgeCost`; agregar `purgesLeft`.

### Archivos
`src/engine/state/RunState.ts` · `src/engine/constants.ts` · `src/engine/GameEngine.ts` ·
`src/ui/DeckBuilderScreen.ts` · `src/ui/HUD.ts` · `src/i18n/*.json` ·
`src/data/packs/base/antes.json` (si el límite es contenido).
**Probe:** `tools/probe-purge-limit.mjs` — purga 2 veces (OK), la 3.ª falla y el botón queda
deshabilitado; avanza de Ante y verifica que el contador se resetea a 2.

---

## FRENTE 8 — Recompensa aumentada de Fungis por ganar en 1 sola mano

### Estado actual (fórmula exacta)
`resolveRoundOutcome` (`GameEngine.ts:1421-1444`):
```ts
const reward =
  round.blind.reward +                              // valor del ciego (JSON)
  ECONOMY.baseBlindReward +                          // 3
  round.handsLeft * ECONOMY.moneyPerUnusedHand;      // 1 por mano sin usar
```
- `ECONOMY.moneyPerUnusedHand = 1`, `ECONOMY.baseBlindReward = 3` (`constants.ts:97-100`).
- `round.blind.reward` viene de `blinds.json` (a1: 3/4/5; a2: 3/4/6; a3: 3/4/7; a4: 3/4/8…).
- **No hay ningún bono por "ganar en una sola mano".** Ya existe un bono implícito por
  manos sin usar (cada mano ahorrada = 1 Fungi), pero ganar en la 1.ª mano no da nada extra
  más allá de las manos restantes.

### Diseño
1. **Constante `ECONOMY.firstHandBonus`** (contenido, por defecto p. ej. `3`) y, mejor,
   un campo por ciego/ante en `blinds.json` (`"firstHandBonus": 3`) para que el balance sea
   contenido.
2. **Detectar la victoria en la 1.ª mano:** `round.totalHands - round.handsLeft === 0`
   (es decir `handsLeft === totalHands` al ganar). Más robusto: contar
   `round.handsPlayed === 1`. Verificar qué campo existe en `RoundState`; si no existe,
   agregar `handsPlayed` al `RoundState` (es efímero por ciego, no va a la run).
3. **Sumar el bono a `reward`** y exponerlo al evento (ver frente 9).
4. **i18n:** `reward.firstHandBonus` ("¡Victoria en una sola mano! +N").
5. **VFX/HUD:** toast dorado distinto del `+N` normal.

### Balance
- Es un **buff de economía** ⇒ sube la tasa de victoria. **Medir con `sim:balance` (500)**
  y ajustar el valor hasta que la tasa no suba más de ~2-3 puntos. Si sube demasiado,
  compensar subiendo `antes.json` (~10%) — regla ya documentada en el README ("las palancas
  de dificultad son contenido").
- Considerar la interacción con `moneyPerUnusedHand`: ganar en 1 mano ya da
  `(totalHands-1) × 1` por manos sin usar; el bono es un extra *explícito* para premiar la
  jugada óptima. **Decidir si es aditivo o si reemplaza el bono por mano** (recomiendo
  aditivo, es más legible).

### Archivos
`src/engine/GameEngine.ts` · `src/engine/constants.ts` · `src/engine/state/RoundState.ts`
(`handsPlayed`) · `src/data/packs/base/blinds.json` · `src/i18n/*.json` · `src/ui/HUD.ts`.
**Gate:** `sim:balance` (500) con la tasa dentro del margen; test unitario de la fórmula
(1 mano ⇒ `base + blind + unused + firstHandBonus`; 2 manos ⇒ sin el bono).

---

## FRENTE 9 — Desglose de Fungis obtenidos al terminar un ciego

### Estado actual
- El evento `round:win` (`src/engine/events.ts:99`) expone
  `{ score, target, reward, money }` — **`reward` es el total agregado**, sin componentes.
- El panel de fin de ciego `HUD.showBlindCleared()` (`HUD.ts:1773-1839`, `.panel.is-cleared`,
  `data-act="cleared-continue"`) ya muestra: puntaje, `.cleared-total` y **un desglose de
  PUNTAJE** (`buildBreakdown()`, `HUD.ts:1850-1937`, `.score-breakdown`, `data-act="breakdown"`:
  combo / base / bonus / multiplicador / total).
- **No hay ningún desglose de Fungis.** La suma de Fungis sólo se ve como toast
  (`HUD.ts:872-874`) y en el ticker de dinero.

### Diseño (reusa el patrón que ya existe)
1. **Extender el payload de `round:win`** con los componentes:
   ```ts
   'round:win': {
     score; target; reward; money;
     rewardParts: { blind: number; base: number; unusedHands: number; unusedCount: number;
                    firstHand: number; missions: number; interest?: number };
   };
   ```
   Los valores se calculan en `resolveRoundOutcome` (`GameEngine.ts:1427-1430`) y se pasan
   tal cual. (Los `missions`/`MONEY_GAIN` de efectos van por `setMoney` aparte; si se quiere
   el desglose completo, etiquetar `setMoney` con una `source` — cambio mayor, **opcional**;
   la v1 muestra los componentes del cierre de ciego.)
2. **Nuevo bloque `.fungi-breakdown`** en `.panel.is-cleared`, **debajo** del desglose de
   puntaje: filas
   `Base del ciego +N` / `Por mano sin usar ×M +N` / `Bono de una sola mano +N` / `TOTAL +N`,
   con `.is-total` resaltado. Mismo componente visual que `.score-breakdown` (reusar clases,
   0 CSS nuevo salvo el color dorado).
3. **Animación de conteo** (opcional): sumar fila por fila como hoy hace el ticker. Respetar
   `reduceMotion` (mostrar todas de golpe).
4. **i18n:** `blindCleared.fungiTitle`, `...part.blind/base/unused/firstHand/total`.

### Archivos
`src/engine/events.ts` · `src/engine/GameEngine.ts` · `src/ui/HUD.ts` (`showBlindCleared` +
`buildFungiBreakdown`) · `src/ui/styles.css` · `src/i18n/*.json`.
**Probe:** `tools/probe-fungi-breakdown.mjs` — gana un ciego, abre el panel, verifica que las
filas suman exactamente `reward` y que `data-act="fungi-breakdown"` existe. Test unitario de
que `rewardParts` suma `reward`.

---

## Gates globales de cierre (antes de commit)

```
CODEBUDDY_SAFE_DELETE_ENABLED=0
npm run typecheck
npm test
npm run validate
npm run audit:desc
npm run sim:balance            # 500 partidas — comparar vs. baseline antes/después
npm run sim:board
npm run smoke                  # server YA en 127.0.0.1:1420, NUNCA en paralelo con cargo
node tools/audit-mobile-buttons.mjs
node tools/shot-menu-buttons.mjs
```
+ los probes nuevos de cada frente. **Un frente no se cierra sin su probe.**

## Preguntas abiertas para Emanuel (bloquean decisiones de diseño)

1. **Frente 3:** ¿los sobres deben dar cartas **jugables** (al mazo de la run o al Mazo
   propio), o quedan como progreso de Colección? (Recomiendo: copy claro ahora + habilitar
   copias extra en el Mazo propio después del frente 5.)
2. **Frente 5:** ¿se conserva el carrusel 3D como vista "Exhibición" o se elimina y la grilla
   pasa a ser la única vista de Colección?
3. **Frente 2:** ¿aceptamos que una carta podrida pueda aportar **0** (B1) o queremos además
   un **piso** de puntaje para toda la mano (B3)? (Recomiendo B1 primero y medir.)
4. **Frente 8:** ¿el bono de una sola mano es **aditivo** al bono por manos sin usar o lo
   reemplaza? (Recomiendo aditivo.)
