# Plan de implementación — Pulido del HUD móvil horizontal

> Estado: **propuesta aprobable**. No se tocó código todavía.
> Alcance: solo `@media (pointer: coarse)` / altura baja. **El escritorio queda intacto.**
> Doc fuente: análisis de Emanuel "El juego está en formato horizontal…" (2026-10-03).

---

## 0. Resumen ejecutivo

El tablero es la prioridad, pero hoy **casi todo el HUD compite por el mismo espacio**.
Todas las capas están siempre visibles y apiladas: HUD superior alto, misiones sobre
el tablero, tutorial sobre las cartas, contadores + acciones en una sola línea inferior.

La meta es una regla única:

> **Las cartas nunca deberían quedar tapadas por un HUD permanente.**

Prioridad absoluta (los 3 cambios que mueven la aguja):

1. **Reducir el HUD superior a la mitad** (de ~96px a ~56–64px).
2. **Plegar las misiones** y **sacar el mensaje tutorial del centro** (cápsula encima de los botones).
3. **Convertir la barra inferior en una zona de acciones** con **Jugar Mano** como protagonista,
   separando *estado* (recursos) de *acciones*.

---

## 1. Diagnóstico (medido, no estimado)

Medición real con `tools/probe-mobile-hud.mjs` a **915×412** (celular horizontal típico,
`pointer: coarse` activo). Captura: `tools/shots/mob-playing.png`.

### 1.1 Geometría actual

| Región | Top | Bottom | Alto | % de 412px |
|---|---|---|---|---|
| `.hud-top` (barra superior) | 0 | 96 | **96px** | **23%** |
| `.hud-score` (bloque central) | 8 | 88 | **80px** | 19% |
| `.hud-missions` (franja) | 247 | 354 | **107px** | 26% |
| `.hud-bottom` (contadores + acciones) | 354 | 412 | **58px** | 14% |

**Espacio útil para tablero + cartas:** entre el HUD superior (96) y la franja inferior (354)
quedan **258px**… pero la franja de misiones (247→354, ancho 130px pegada al borde izquierdo)
**se come 107px de ese alto** en la esquina inferior izquierda y **pisa la zona de las cartas**.

### 1.2 Problemas concretos (con evidencia en la captura)

| # | Problema | Evidencia |
|---|---|---|
| P1 | **HUD superior demasiado alto** | 96px = 23% del viewport. Incluye: ante + raíl, `0 / 1100`, barra, explicación permanente, `0 / 1100 Puntos`, "Te quedan: 4 Manos · 3 Descartes". |
| P2 | **Puntaje duplicado** | `0 / 1100` aparece **dos veces** (número grande arriba + "0 / 1100 Puntos" en la línea de objetivo). |
| P3 | **Explicación permanente** | "La barra avanza solo al jugar una mano." ocupa una línea todo el tiempo; es información de tutorial, no de estado. |
| P4 | **Misiones sobre el tablero** | `.hud-missions` en 247–354, borde izquierdo, tapa las cartas de esa esquina. |
| P5 | **Tutorial sobre las cartas** | "Tocá hasta 5 cartas para formar una mano." cae justo sobre la fila de cartas. |
| P6 | **Idioma + Menú permanentes** | Dos botones grandes arriba a la derecha, todo el tiempo. |
| P7 | **Contadores + acciones en una línea** | 4 contadores (Manos, Descartes, Mazo, Simbiontes) + 4 botones (Limpiar, Ordenar, Descartar, Jugar Mano) = 8 elementos en 58px. |
| P8 | **Sin jerarquía de acción** | Los 4 botones pesan igual; "Jugar Mano" no se distingue. |
| P9 | **Deshabilitados poco legibles** | Limpiar/Descartar/Jugar Mano en gris apagado se leen como "rotos". |
| P10 | **Simbiontes sin contexto** | `0/5 Simbiontes` aparece sin explicar qué son ni en esta fase. |

### 1.3 Qué ya está resuelto (no rehacer)

Estas cosas ya se ajustaron en tandas previas y **no** hay que tocarlas:

- `pointer: coarse` como umbral (no breakpoint por ancho) → el escritorio no se afecta.
- Barra inferior **sin wrap** (contadores comprimibles, una fila).
- Misiones con `pointer-events: none` (ya no roban toques).
- `#ui-root.is-panel-open` apaga el cromo de la partida cuando hay una subpantalla abierta.
- Panel de ciego entra entero sin scroll.
- Guardas de regresión en `tools/smoke.mjs` (`afterStart.blindPanelFit`, `afterBlind.missionsClip`, `deckBuilder.hudVisible`).

---

## 2. Objetivos medibles

| Objetivo | Métrica actual | Meta |
|---|---|---|
| **O1** Alto del HUD superior | 96px | **≤ 64px** (≤ 16% de 412) |
| **O2** Espacio libre para tablero+cartas | ~258px (pisado por misiones) | **≥ 285px sin solapes** |
| **O3** Repeticiones del puntaje | 2 (`0 / 1100` ×2) | **1** |
| **O4** Elementos permanentes tapando cartas | misiones + tutorial | **0** |
| **O5** Contadores visibles sin scroll | 4 en una fila | 4, pero **plegables** los secundarios |
| **O6** Tamaño de toque | ≥ 44px botones | **≥ 44px** confirmado por medición |
| **O7** Legibilidad de texto | variable | **≥ 14px** en texto informativo; habilidades en panel ampliado |
| **O8** Jerarquía de "Jugar Mano" | igual que el resto | **dominante**: color propio, más ancho, con estimado |

Criterio transversal: en 915×412, **el rectángulo de cada carta de la mano no debe intersecar
ningún elemento `is-visible` de HUD** (verificable con `elementFromPoint` sobre el centro de cada carta).

---

## 3. Diseño objetivo (mobile horizontal)

### 3.1 Layout

```text
┌───────────────────────────────────────────────┐
│ Ante 1 · SÓTANO HÚMEDO   Fungis 4        ⋮    │  ~11dvh  (≈44px)
│ 0 / 1100  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━  │
├───────────────────────────────────────────────┤
│                                               │
│                   TABLERO                     │  65% aprox
│                                               │
│  [carta] [carta] [carta] [carta] [carta]      │
│                                               │
│  [ Misiones 1/2 ]                    (plegable)│
├───────────────────────────────────────────────┤
│ 4 manos · 3 descartes · Mazo 40/40            │  ~8dvh  (≈34px)
├───────────────────────────────────────────────┤
│         Ordenar   Descartar   JUGAR MANO      │  ~15dvh (≈62px)
└───────────────────────────────────────────────┘
```

### 3.2 Estados de la barra inferior

**Sin selección:**
```text
[ Ordenar ]  [ Descartar ]        [ JUGAR MANO ]
   (activo)     (disabled legible)   (disabled legible)
```

**Con cartas seleccionadas:**
```text
[ Limpiar ]  [ Descartar · 3 ]    [ JUGAR MANO · 420 ]
```

- `Jugar Mano` muestra el **puntaje estimado** (requiere cálculo de preview, ver Fase P1).
- `Limpiar` aparece **solo** con selección (no compite siempre).

### 3.3 Colores / jerarquía

| Botón | Color | Estado disabled |
|---|---|---|
| Jugar Mano | verde/turquesa brillante | opacidad reducida pero texto legible |
| Descartar | ámbar | idem |
| Ordenar | violeta/azul | idem |
| Limpiar | gris | idem |

Criterio: un botón deshabilitado **no debe parecer roto ni invisible** (contraste mínimo AA sobre el fondo del botón).

### 3.4 Menú secundario `⋮`

`Idioma` y `Menú` salen de la barra permanente y se pliegan en un `⋮`:
```text
Menú
- Continuar
- Ver mazo
- Misiones
- Ajustes
- Idioma      (submenú ES / EN)
- Salir
```
Si se prefiere conservar `Menú` visible, dejar **solo** `Menú` e incluir `Idioma` adentro.

### 3.5 Misiones plegables

- Chip colapsado: `[ Misiones 1/2 ]` (esquina inferior izquierda del tablero).
- Al tocar: **panel lateral** con lista completa (nombre, desc, progreso, recompensa).
- Misión completada: el chip cambia a `[ ✓ Misión completada ]`.
- Durante la partida: **como máximo una misión destacada** visible (`PURGA · 0/2`); el resto plegado.
- Persistir estado abierto/plegado en el perfil (P1).

### 3.6 Tutorial contextual (fuera del centro)

- Cápsula **encima de la fila de acciones**, no sobre las cartas.
- Texto cambia según acción: `Seleccioná hasta 5 cartas` → `Elegí cartas que combinen por Familia o Sustrato`.
- Desaparece tras la **primera mano jugada** de la run (ya existe `cardsPlayedThisRound === 0` como gate).
- La explicación larga ("La barra avanza solo al jugar una mano.") sale del HUD permanente y vive en: Guía + icono `?` + primer ciego.

---

## 4. Fases de implementación

### P0 — Urgente (solo CSS + cambios chicos de HUD)

> Objetivo: el tablero respira y el jugador entiende dónde mirar. **Todo verificable con el probe + smoke.**

**P0.1 — Reducir el HUD superior a la mitad (O1, O3)**
- Archivo: `src/ui/HUD.ts` (`render()`, `renderObjective()`), `src/ui/styles.css` (`.hud-top`, `.hud-score`, `.hud-objective`).
- Quitar el `0 / 1100 Puntos` duplicado de la línea de objetivo: dejar **un** número grande + `/ target` chico.
- La línea de objetivo baja a **una sola línea** integrada a la barra.
- Meta CSS: `.hud-top { height: 11dvh }`, `.hud-score` menos padding/line-height.
- **Aceptación:** `.hud-top` alto ≤ 64px a 915×412; `0 / target` aparece 1 sola vez en el DOM visible.

**P0.2 — Sacar la explicación permanente (P3)**
- Quitar la línea "La barra avanza solo al jugar una mano." del HUD de juego.
- Moverla a: `guide.*` (ya hay secciones) + tooltip del `?`.
- **Aceptación:** el texto no está en `playing`; sigue existiendo en Guía y en el cartel de ayuda.

**P0.3 — Plegar misiones (P4, O4)**
- Archivo: `src/ui/HUD.ts` (`renderMissions()`), `styles.css` (`.hud-missions`).
- Reemplazar la franja fija por un **chip toggle** (`data-act="missions-toggle"`) + panel lateral.
- Añadir estado `missionsOpen` (por ahora en memoria; persistencia en P1).
- **Aceptación:** en `playing` sin abrir, la franja de misiones **no interseca** ninguna carta
  (medido por el probe); el chip entra en una franja ≤ 32px.

**P0.4 — Tutorial encima de los botones (P5, O4)**
- Archivo: `src/ui/HUD.ts` (`renderSelectHint()`), `styles.css` (`.hud-select-hint`).
- Anclar la cápsula **justo encima** de `.hud-bottom` (no a `bottom: 126px` fijo).
- **Aceptación:** el rectángulo de la cápsula queda dentro de la franja de acciones
  (no toca ninguna carta); desaparece tras la primera mano.

**P0.5 — Separar estado y acciones (P7)**
- Archivo: `src/ui/HUD.ts` (`renderCounters()`, `renderActions()`), `styles.css` (`.hud-bottom`, `.hud-counters`, `.hud-actions`).
- Dos franjas: **estado** (`4 manos · 3 descartes · Mazo 40/40`) y **acciones**.
- Simbiontes sale de la fila → al menú `⋮` / panel de misiones / vista de mazo (P0.6).
- **Aceptación:** `.hud-bottom` deja de ser una sola fila; estado y acciones en bandas distintas; sin wrap.

**P0.6 — Jugar Mano protagonista (P8, P9)**
- Archivo: `renderActions()` + `styles.css` (`.btn.is-play`, `.is-discard`, `.is-sort`, `.is-ghost`).
- `is-play`: más ancho, color verde/turquesa, texto con cantidad; disabled legible.
- `Limpiar`: aparece **solo** con selección.
- **Aceptación:** `is-play` es visualmente el botón más grande/contrastado; los disabled tienen
  contraste de texto ≥ 4.5:1 sobre su fondo.

**P0.7 — Garantizar que las cartas no quedan tapadas (O2, O4)**
- Guarda nueva en `tools/smoke.mjs`: para cada carta en mano, `elementFromPoint(centro)` debe devolver
  el canvas o la carta, **nunca** un nodo de `.hud-missions` / `.hud-select-hint`.
- **Aceptación:** la guarda pasa a 844×390 (viewport del smoke).

**P0.8 — Legibilidad de carta (O7)** — **PENDIENTE** (no implementado todavía)
- `styles.css`: subir tipografía de carta en `pointer: coarse`; separación 4–8px; expansión al tocar.
- **Aceptación:** nombre/elemento/familia legibles a 915×412 (sin zoom); toque de carta con feedback.

### P1 — Interacción ✅ COMPLETADO

- **P1.1** ✅ Puntaje estimado en `Jugar Mano · 420`. Reusa `engine.previewSelection()` existente.
  - Archivos: `src/ui/HUD.ts` (`renderActions`).
- **P1.2** ✅ Resaltar cartas compatibles con la selección (familia/elemento). Brillo sutil (0.35) en halo.
  - Archivos: `src/render/Card3D.ts` (`setCompatible`), `src/render/SceneManager.ts` (`syncHand`).
- **P1.3** ❌ **ELIMINADO a propósito** (NO está implementado). El panel de detalle de carta al
  tocar-mantener/doble-toque resultó **redundante** y se removió por completo en una tanda
  posterior: ya **no existen** `onLongPress`/`onDoubleTap` (`src/render/Interaction.ts`),
  `onCardDetail` (`src/render/SceneManager.ts`), `showCardDetail`/`hideCardDetail`
  (`src/ui/HUD.ts`) ni `.panel.is-card-detail` (`src/ui/styles.css`). También se llevó puestos
  los strings sin traducir `card.noAbility`/`action.close` (una de las causas del CI rojo).
  Si el rediseño móvil quiere una carta ampliada, será un **ítem nuevo** con otro nombre.
- **P1.4** ✅ Icono de ayuda contextual `?`. Toggle del aviso de barra.
  - Archivos: `src/ui/HUD.ts` (`toggleHelp`), `src/ui/styles.css` (`.hud-help`).
- **P1.5** ✅ Persistir estado de paneles UI en perfil (v3). `ui: { missionsOpen, helpOpen }`.
  - Archivos: `src/meta/ProfileState.ts` (v3), `src/persistence/migrations.ts` (v2→v3), `src/ui/HUD.ts` (`setUiState`/`onUiStateChange`), `src/main.ts` (wire).

### P2 — Pulido (PENDIENTE)

- **P2.1** Animación clara al seleccionar (elevar 20–30px, borde dorado/turquesa, icono de selección, vecinas quietas).
  - Nota: la selección ya eleva la carta (`SELECT_LIFT = 0.42`) y enciende el halo. Falta: elevar *más* (20–30px en vez de 0.42u), borde dorado/turquesa, icono de check, vecinas quietas.
- **P2.2** Transición de carta al centro al puntuar.
  - Nota: ya existe animación de scoring. Falta pulirla para que la carta vuele al centro de forma más dramática.
- **P2.3** Feedback de combo (cuando se forma Floración/Colonia).
  - Nota: `detectCombos` ya existe. Falta: feedback visual (flash, popup) cuando se forma un combo.
- **P2.4** Animación de misión completada.
  - Nota: falta animación de celebración cuando una misión se completa.
- **P2.5** Vibración sutil al tocar acción importante (si el dispositivo la soporta).
  - Nota: `navigator.vibrate` API. Solo en dispositivos que la soporten.
- **P2.6** Diferenciar visual estados: Estéril / Pudriéndose / Latente.
  - Nota: los estados de carta ya existen en el motor. Falta representación visual en el render.

---

## 5. Criterios de aceptación globales (verificables)

Todos se miden con **`tools/probe-mobile-hud.mjs`** (915×412) y **`tools/smoke.mjs`** (844×390 touch).

| ID | Criterio | Herramienta |
|---|---|---|
| CA1 | `.hud-top` alto ≤ 64px | probe |
| CA2 | `0 / target` visible 1 sola vez | probe / DOM count |
| CA3 | Explicación larga ausente en `playing` | smoke (assert `!document.body.textContent.includes(...)`) |
| CA4 | Misiones colapsadas no intersecan cartas | probe + smoke |
| CA5 | Cápsula de tutorial dentro de la franja de acciones | probe |
| CA6 | Estado y acciones en bandas separadas | probe (tops distintos) |
| CA7 | `is-play` es el botón más ancho/contrastado | probe (bbox + color) |
| CA8 | Ningún nodo HUD `is-visible` sobre el centro de una carta | smoke (`elementFromPoint`) |
| CA9 | Botones de toque ≥ 44px | probe |
| CA10 | Sin scroll vertical en `playing` a 915×412 | probe (`scrollOverflow <= 0`) |
| CA11 | Escritorio (`pointer: fine`) **sin cambios** | `tools/shot-desktop.mjs` (HUD visible igual) |
| CA12 | Gates verdes: typecheck / test / validate / sim / smoke / build | CI |

---

## 6. Compatibilidad por tamaño y dispositivo

### 6.1 Umbrales

- **`pointer: coarse`** sigue siendo el umbral (no ancho). Un desktop angosto NO entra; un celular sí.
- Alturas objetivo: `min-height: 100dvh` (nunca `100vh`), `env(safe-area-inset-*)` respetado.

### 6.2 Matriz de equipos a verificar

| Dispositivo | Resolución típica (landscape) | Riesgo |
|---|---|---|
| iPhone SE | 667×375 | altura muy baja → misiones deben plegarse sí o sí |
| iPhone 12/13/14 | 844×390 | viewport del smoke → test base |
| iPhone Pro Max | 932×430 | ancho extra → aprovechar para 7 cartas |
| Pixel / Android medio | 915×412 | el caso medido |
| Android grande | 1024×480 | sobra alto → no crecer el HUD, dar aire al tablero |
| Tablet landscape | 1180×820 | `pointer: coarse` pero MUCHO alto → tratar como "media": no comprimir de más |

**Nota tablet:** con `max-height: 520px` las reglas no aplican; conviene un tercer estado
"coarse + alto" que NO aplique las compresiones (para no desperdiciar 820px de alto).

### 6.3 Reglas técnicas

```css
@media (orientation: landscape) and (pointer: coarse) {
  .hud-top      { height: 11dvh; min-height: 48px; max-height: 64px; }
  .hud-actions  { height: 15dvh; min-height: 56px; }
  .hud-status   { height: 8dvh;  min-height: 30px; }
  .hud-missions { transform: translateX(-100%); }   /* plegada */
  .hud-missions.is-open { transform: translateX(0); }
  .mission-toggle { display: flex; }
  .hud-select-hint { bottom: calc(15dvh + 8px + var(--safe-b)); }
}
```

Garantías (checklist de implementación):
- [ ] `100dvh`, no `100vh`.
- [ ] `env(safe-area-inset-*)` en las 4 bandas.
- [ ] Botones táctiles ≥ 44px (48px ideal).
- [ ] Texto informativo ≥ 14px; texto de habilidad en panel ampliado (no comprimido).
- [ ] Ninguna capa `position: fixed` `is-visible` encima de cartas.
- [ ] No depender de `:hover` para información crítica.
- [ ] Feedback visual/táctil al seleccionar carta.

### 6.4 Orientación vertical

**Fuera de alcance ahora.** Si algún día se permite, NO escalar el layout horizontal:
requiere carrusel horizontal de cartas, objetivo arriba, misiones bajo el objetivo,
acciones fijas abajo, panel de carta ampliada y navegación por pestañas (rediseño, no adaptación).

---

## 7. Archivos afectados

| Archivo | Cambio |
|---|---|
| `src/ui/HUD.ts` | `render()`, `renderObjective()`, `renderMissions()`, `renderCounters()`, `renderActions()`, `renderSelectHint()` |
| `src/ui/styles.css` | `.hud-top`, `.hud-score`, `.hud-objective`, `.hud-missions`, `.hud-bottom`, `.hud-counters`, `.hud-actions`, `.btn.is-play/.is-discard/.is-sort/.is-ghost`, `.hud-select-hint`, nuevas reglas `@media (orientation: landscape) and (pointer: coarse)` |
| `src/i18n/es.json` / `en.json` | keys nuevas: `menu.secondary`, `menu.language`, `missions.toggle`, `missions.completedBadge`, `action.playEstimate`, `hud.statusLine`, etc. (+ `coverage.ts` si aplica) |
| `src/main.ts` | wiring del `⋮`, toggle de misiones, ayuda contextual |
| `tools/probe-mobile-hud.mjs` | medir las nuevas métricas (CA1–CA6, CA9, CA10) |
| `tools/smoke.mjs` | guardas CA3, CA8 |
| (P1) `src/engine/GameEngine.ts` | `estimatePlay(selectedUids)` puro + test |

---

## 8. Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| Las reglas `pointer: coarse` tocan sin querer el escritorio táctil (tablet) | Añadir tercer estado "coarse + alto" (≥600px) que no comprima. Verificar con `shot-desktop` (fine) y un shot tablet. |
| El estimado de puntaje (P1.1) desincroniza engine↔HUD | Implementarlo como método **puro** del engine + test unitario; el HUD solo lo lee. |
| Plegar misiones esconde progreso | Chip siempre visible con contador `1/2`; misión destacada durante la partida. |
| El `⋮` escondido deja a alguien sin salir | Mantener `Menú` visible como fallback si se detecta uso bajo (o dejarlo siempre, con Idioma adentro). |
| Romper el smoke al mover nodos | Correr `openOverlay`/`state:changed` a mano; los locators del smoke usan `data-act`, mantenerlos estables. |

---

## 9. Orden de ejecución sugerido

1. **P0.1 + P0.2** (HUD superior + quitar explicación) → medir CA1, CA2, CA3.
2. **P0.3 + P0.4** (plegar misiones + mover tutorial) → medir CA4, CA5.
3. **P0.5 + P0.6** (separar estado/acciones + Jugar Mano protagonista) → medir CA6, CA7, CA9.
4. **P0.7 + P0.8** (guardas de no-tapado + legibilidad) → CA8, CA10.
5. Correr la suite completa + `shot-desktop` (CA11) + matriz de dispositivos (§6.2).
6. Recién entonces empezar P1.

**Definición de "terminado" (P0):** CA1–CA12 verdes y el escritorio idéntico al actual.
