# Diseño de escritorio — FungiFlush

> **Propuesta de diseño** para llevar la versión de escritorio al mismo nivel de calidad,
> claridad y fluidez que la versión móvil, **sin escalar la UI móvil al monitor**.
>
> Estado: **implementado y verificado** (2026-10-09). Gates: `gate:desktop` 31/31,
> `gate:parity` verde, `audit-mobile-buttons` limpio, `typecheck`/`test`/`validate`/
> `audit:desc`/`sim:balance`/`sim:board` en verde.
>
> Convención madre: `docs/CONVENCION_MOVIL_PRIMERO.md` (§6 queda cerrado por este trabajo).

---

## 1. Problema y punto de partida

El estilo de la app vive en **un único archivo**, `src/ui/styles.css`. Su **base es el
escritorio congelado**: desde que se adoptó la convención *móvil primero*, todo el pulido
reciente (HUD, paneles, tienda, tarjetas) se escribió en ~30 bloques
`@media (pointer: coarse)`. Resultado medido con capturas y con el gate de layout:

- El escritorio **no es una variante vieja**: es la base que **nunca recibió** el pulido.
- Síntomas concretos: tipografía chica a distancia de monitor, marcador acotado a 460 px
  con todo apiñado al centro, paneles que **desbordaban el viewport** y hacían scrollear
  la página (Ascensión +45 px, Recompensas de Colonia +24 px), tarjetas de tienda con el
  modelo viejo (caja + descripción en prosa repetida).

La auditoría móvil estaba en **0/443 hallazgos** mientras el escritorio tenía 2 bugs de
layout propios: una brecha solo de escritorio que nadie medía.

**Principio rector:** *mismo juego, distinta distribución*. La paridad es de
**información, textos, señales y ritmo**, NO de píxeles. Donde el móvil oculta algo por
falta de espacio, el escritorio lo **muestra** (hay ancho de sobra); donde el móvil
comprime, el escritorio **respira**.

---

## 2. Estrategia de implementación

### 2.1 Discriminador de layout: `pointer`, no `width`

Todo el trabajo de escritorio vive en **un único bloque nuevo** `@media (pointer: fine)`
al final de `styles.css`. Esto es clave:

- `(pointer: fine)` y `(pointer: coarse)` son **mutuamente excluyentes**: nada de lo
  escrito toca al móvil.
- `isCoarsePointer()` (`src/pointer.ts`) es la **única fuente de verdad** del layout y
  espeja exactamente la media query. No hay `matchMedia` suelto ni chequeos de ancho.
- Se apoya en los **mismos tokens** (`--text-*`, `--frame-*`, `--font-*`, colores,
  `--dur-*`, `--ease-*`) para conservar la identidad visual: cambia la escala, no el
  vocabulario.

> No se usó `min-width`, salvo reglas **compartidas por ancho** ya existentes y documentadas
> (glosario del tutorial `min-width:700px`; `.blind-card.is-boss` `min-width:640px`), que
> **no se gatean** porque son legítimas en ambas plataformas.

### 2.2 Por qué no "escalar el móvil"

Escalar la UI móvil al monitor rompería la ergonomía (distancias de lectura, densidad de
información) y desperdiciaría el ancho. El escritorio **reorganiza**: usa columnas, aire y
jerarquía tipográfica propia, manteniendo intactos textos, señales y flujo.

---

## 3. Propuesta de diseño (qué se hizo, por área)

### 3.1 Layout y densidad

| Área | Antes (base congelada) | Ahora (escritorio) |
|---|---|---|
| Barra superior | Marcador acotado a 460 px, tres zonas apiñadas al centro | Tres zonas repartidas con aire, `.hud-score` hasta **620 px** |
| Escala tipográfica | `--text-xs 11px … --text-xxl 36px` (pensada para 844×390) | `12 / 14 / 16 / 18 / 22 / 27 / 42 px` (~12–18 % arriba) |
| Contadores | Solo recursos; estado repartido en etiquetas de pilas | **Los cuatro contadores** visibles en una fila, con chip de estado atenuado (es contexto, no recurso) |
| Paneles | `.overlay` con `overflow-y:auto`, panel creciendo con el contenido | **Modelo P8**: overlay sin scroll, panel = columna flex acotada (cabecera fija / cuerpo flexible / pie fijo) |
| Grillas | Columnas por `auto-fit` mínimas | Colección ≥120 px, mazo ≥112 px por columna |
| Mesa 3D | `spreadDesktop 16.5/14/12`, `biasDesktop 0.72`, pilas ±10.5 | `spread` por aspecto (22/19/16 acotado por `handSpreadClearOfPiles`), `bias 0.52`, pilas **±12.0** en ancho |

### 3.2 Navegación y accesibilidad

- Las **acciones principales** están siempre visibles o a un clic: el gate I4 verifica que
  ninguna quede fuera del viewport en **ninguna** pantalla.
- Se **replican los gestos móviles** con mouse: arrastrar-o-clicar-la-pila para descartar,
  orden automático de mano (interruptor `autoSortHand` en Ajustes).
- Menú principal: el CTA (logotipo de hongos = *Nueva partida*) escala con el ancho
  (`min(clamp(30px, 3.4vw, 54px), 9vh)`) y los iconos de esquina acompañan. El velo del
  héroe se ensancha para que el CTA no flote aislado.
- Se respetan las **zonas seguras** (`--safe-*`) en todos los paddings de escritorio.

### 3.3 HUD y feedback

- **Misma información**, ubicación predecible, animaciones coherentes: el escritorio usa
  los mismos `--dur-*` / `--ease-*` y los mismos eventos.
- El marcador (`--hud-score-current`) sube a **46 px**: es el dato más importante de la
  partida, legible a distancia de monitor.
- La guía de selección y el aviso de consecuencia (`.hud-select-hint`, `.hud-decay`)
  ganan un punto de cuerpo y quedan por encima de la banda.
- **Jugar Mano** deshabilitado: se unifica el alto (52 px) y se da cuerpo protagonista
  (`opacity .5`).

### 3.4 Tipografía y escala

- Escala de escritorio propia (§3.1) manteniendo **misma familia** (`--font-ui` Fredoka,
  `--font-display` Gasoek One) y misma jerarquía.
- Textos **idénticos** a móvil: el gate I3 compara las etiquetas de las acciones
  principales en **ambas** plataformas y exige coincidencia exacta.

### 3.5 Estados y transiciones

- Carga / pausa / victoria / derrota / recompensa usan el **mismo flujo** y las mismas
  señales en ambas plataformas (ver §5, checklist).
- Recompensa y tienda comparten el **mismo grid `.offer`** (se retiró el carrusel 3D).
- La celebración de combo, el aura de putrefacción y los chips de estado son **3D/canvas
  compartido**: se ven igual en escritorio por construcción.

### 3.6 Tienda y recompensa: "la CARA es la tarjeta"

En móvil la tarjeta de tienda/recompensa **es la cara de la carta**: sin caja, sin
descripción en prosa, con el pie centrado. El escritorio conservaba el modelo viejo
(`.offer` con fondo/borde + `.offer-kind` + `.offer-desc` + pie `space-between`),
redundando datos que la cara ya trae impresos.

**Se portó el modelo móvil** a `(pointer: fine)`, aprovechando que en escritorio **sobra
alto** para caras grandes: `object-fit: contain`, `grid-auto-rows: minmax(220px, 1fr)`,
pie centrado, `offer-kind`/`offer-desc` en `display:none`. El dato de tipo sigue en
`data-kind`/`data-kind-label` y en el `aria-label` (accesibilidad).

---

## 4. Red 3D de escritorio (encuadre libre)

Decisión de alcance: **CSS/DOM + 3D libre** — se permitió reencuadrar la mesa 3D de
escritorio (`src/render/SceneManager.ts`):

- `spreadDesktop()`: base por aspecto (22 en ultra-ancho, 19, 16) **acotada** por
  `handSpreadClearOfPiles()` para que la mano nunca pise las pilas.
- `biasDesktop()`: `0.72 → 0.62`.
- `DESKTOP_WIDE_PILE_X = 8.8` (ver la corrección de abajo). Se retiraron las
  constantes `DECK_X`/`DISCARD_X` que quedaron sin uso.

Esto **llena la mesa** en 1440×810 sin tocar la lógica de juego ni la rama móvil/tablet.

### 4.1 Corrección: la "franja negra" de arriba era el encuadre, no el CSS

El usuario reportó una franja negra sobre todo el HUD. Medida con muestreo de
píxeles reales (HUD oculto, perfil de brillo por fila), la causa no era CSS:

| |antes|después|
|---|---|---|
|fondo plano arriba (y 0 → contenido)|**190 px**|**~90 px**|
|distancia de cámara|21.54|16.43|
|ancho de pila en pantalla|158 px|**194 px**|

`CameraRig.fit()` toma `max(distForWidth, distForHeight)`:

- **Móvil** (aspect 2.22): cabe el ancho de lejos ⇒ manda el **alto** ⇒ la mesa llena
  la pantalla y no queda franja muerta.
- **Escritorio** (aspect 1.78): el cono horizontal es más cerrado, así que para el
  mismo ancho de mundo la cámara tiene que **alejarse**. Con las pilas en `12.0`
  mandaba el ancho (`21.54` vs `13.78`) y la mesa se quedaba en ~68 % del alto: el
  resto era fondo plano + niebla ⇒ la franja negra.

Bajando `DESKTOP_WIDE_PILE_X` a `8.8` el ancho deja de mandar (`16.39` vs `16.43`) y el
encuadre pasa a fijarlo el **alto**, como en el móvil: la mesa llena la pantalla y las
cartas salen ~1.3× más grandes. Las pilas siguen en el borde **en pantalla** (el
encuadre sigue siendo fit-al-ancho mientras el ancho manda). El `bias` a `0.62` deja
ambas cotas prácticamente iguales, que es el óptimo: es el punto donde la mesa es lo
más grande posible sin que sobre alto por ningún lado.

Efecto secundario deseable: el abanico de la mano se solapa levemente en escritorio
(espaciado `1.78` vs `CARD_WIDTH 2.2` con 8 cartas), **igual que en móvil** — abanico
tipo Balatro, no cartas sueltas.

### 4.2 Velo de la barra superior

Como `.hud-top` es transparente por diseño (el material lo ponen los bloques), en
16:9 quedaban dos "orejas" de fondo plano entre el borde y el bloque de score. Se
añade un degradado que las cubre y se disuelve antes del borde inferior, así la barra
se lee como una superficie continua de HUD y no como un recorte.

---

## 5. Lista de comprobación de paridad con móvil

Cada punto crítico, con **cómo se verifica**. Los gates son automáticos (Playwright
headless, Chromium con SwiftShader) y corren en CI/local.

### 5.1 Reglas de juego (idénticas)

- [x] Misma lógica de engine (puro, sin DOM). **Gate:** `npm test` (470/470) + `sim:board`.
- [x] Mismo `deckSize` (classic 40 / arquetipo 24), misma mano inicial (6), mêmes combos.
- [x] Misma puntuación (`Math.max(0, round(substrate*spores))`, `round.score +=`).

### 5.2 Textos, etiquetas y nombres de acciones (idénticos)

- [x] **Gate I3:** para cada estado compartido, las etiquetas de las acciones principales
  (vía `t()`) coinciden **exactamente** en escritorio y móvil. Cualquier divergencia falla.

### 5.3 Jerarquía de información (equivalente)

- [x] **Gate I2:** el móvil conserva su cromo propio — 0 contadores de ESTADO visibles
  (los reparte en las pilas), `.hud-missions-toggle` presente. No se filtró escritorio al móvil.
- [x] **Gate I1:** el escritorio **no** muestra cromo solo-móvil (`.hud-status`,
  `.hud-missions-toggle` ocultos). No se filtró móvil al escritorio.

### 5.4 Señales de selección / puntuación / recompensa (idénticas)

- [x] Selección = borde VERDE `0x52e07f` + badge 1-5 (`BADGE_SIZE=0.22`), `HAND_BOOST=1.2`
  — **valores compartidos** (`Card3D.ts`), no por plataforma.
- [x] Celebración de combo (dorado/ámbar/verde), aura de putrefacción y chips de estado:
  3D/canvas **compartido** (`CardTexture.ts`, shaders) ⇒ idénticos por construcción.
- [x] Recompensa y tienda: mismo grid `.offer` en ambas plataformas.

### 5.5 Acciones alcanzables (equivalente ergonómico)

- [x] **Gate I4:** ninguna acción fuera del viewport en **ninguna** plataforma ni pantalla.
  (Se ignoran elementos deliberadamente off-canvas, p. ej. el cajón de misiones cerrado
  a `translateX(-110%)`.)

### 5.6 Flujo y transiciones (equivalente)

- [x] Mismo flujo: `menu → archetypes → blind_select → playing → reward("Ciego superado")
  → shop(→ interlude)`.
- [x] Estados de carga/pausa/victoria/derrota/recompensa con el mismo vocabulario visual.
- [x] **Gate I5:** sin scroll de página no intencional en ninguna plataforma.

### 5.7 Identidad visual (equivalente)

- [x] Misma paleta, tipografía y material: el bloque de escritorio **reutiliza los mismos
  tokens**, no define un vocabulario nuevo.
- [x] Mismas ilustraciones (`cardFaceUrl`/`offerFaceUrl`, arte 2:3).

### 5.8 Distribución adaptada (diferencias **justificadas** por ergonomía)

Estas son las **únicas** divergencias, y son intencionales:

- [x] Tipografía de escritorio mayor y contadores de ESTADO visibles: **hay ancho/alto**,
      y la distancia de lectura de monitor lo exige. No es información nueva.
- [x] Panel no full-bleed: en escritorio **sobra alto**, así que el cuerpo scrollea por
      dentro en vez de a pantalla completa (móvil sí necesita full-bleed).
- [x] Cartas de mano con `boost 1.3` en táctil (a 412 px de alto el texto quedaría ~2 px);
      escritorio en 1.
- [x] Pilas a ±12.0 en escritorio ancho vs `±TACTILE_PILE_X` en táctil.
- [x] **Gate I6 (baseline):** la geometría normalizada de escritorio se congela contra
      `tools/parity-baseline.json` (tolerancia 0.12) para que ningún cambio futuro
      desplace el layout sin que se note. Re-basar es explícito (`--update`).

---

## 6. Gates automáticos

`package.json`:

```jsonc
"gate:desktop": "node tools/shot-desktop.mjs",   // 31 pantallas, 1440x810 (pointer:fine)
"gate:parity":  "node tools/parity-layout.mjs"   // dual-context: escritorio + móvil en un run
```

| Gate | Qué cubre | Estado |
|---|---|---|
| `typecheck` | Tipos TS (incl. `SceneManager.ts`) | ✅ |
| `test` | 470 tests de engine/meta/contenido | ✅ 470/470 |
| `validate` | Contenido (77 cartas, 30 jokers, …) | ✅ 0 advertencias |
| `audit:desc` | Descripciones de carta no se truncan | ✅ |
| `sim:balance` | Balance 500 partidas | ✅ |
| `sim:board` | Duelo micelial (invariantes) | ✅ ESTABLE |
| `audit-mobile-buttons` | 442 controles móviles | ✅ 0 hallazgos |
| **`gate:desktop`** | 31 pantallas de escritorio: cromo móvil oculto, sin overflow, acciones en viewport, contadores en una fila, barras en viewport | ✅ 31/31 |
| **`gate:parity`** | I1–I6 (fugas, textos, alcance, scroll, baseline) | ✅ verde |

### 6.1 Cómo `gate:desktop` encontró 2 bugs reales

La fase de red de seguridad (escrita **antes** de rediseñar) detectó de inmediato:

1. **`ascension`**: overlay scrolleaba **+45 px**.
2. **`colony-rewards`**: **+24 px**.

Ambos por el mismo patrón: base `.overlay` con `overflow-y:auto` + panel creciendo con el
contenido. Se corrigieron aplicando el modelo P8 en el bloque `(pointer: fine)`.

### 6.2 Notas de implementación de los gates

- Se ejecutan con `playwright-core` + Chromium por ruta absoluta, flags SwiftShader, contra
  `http://127.0.0.1:1420/?daily=0` (el server debe estar **ya** levantado).
- ⚠️ El smoke **no** arranca el server; **nunca** correr en paralelo con `cargo`.
- Capturas: `tools/parity-*.png` (se toman **durante** el recorrido, no al final).
- Elementos totalmente off-canvas se ignoran a propósito (p. ej. `.hud-missions-panel`
  cerrado).
- ⚠️ Las dos sesiones de `gate:parity` **no conviven**: con SwiftShader la escena 3D va a
  ~2-3 FPS y dos contextos a la vez se pelean por la CPU — el arranque del segundo
  pasaba de ~10 s a **~40 s** (medido) y vencía el `waitForFunction`. Cada sesión se
  crea, se recorre y se **cierra** antes de abrir la siguiente. Además el arranque usa
  `polling: 250` en vez del rAF por defecto (el rAF de la pestaña oculta se congela).

---

## 7. Archivos tocados

| Archivo | Cambio |
|---|---|
| `src/ui/styles.css` | **+~390 líneas**: bloque `@media (pointer: fine)` al final (tipografía, HUD, paneles P8, menú, tienda/recompensa "cara = tarjeta", grillas). |
| `src/render/SceneManager.ts` | `spreadDesktop`/`biasDesktop` reencuadre; `DESKTOP_WIDE_PILE_X`; retiro de `DECK_X`/`DISCARD_X`. |
| `tools/shot-desktop.mjs` | Reescrito: 2 → **31** pantallas. |
| `tools/parity-layout.mjs` | **Nuevo**: gate dual-contexto I1–I6. |
| `tools/desk-baseline.json`, `tools/parity-baseline.json` | Baselines de geometría. |
| `package.json` | Scripts `gate:desktop`, `gate:parity`. |

---

## 8. Resumen ejecutivo

- El escritorio **no era una variante vieja**: era la base que nunca recibió el pulido móvil.
- Se aisló **todo** el rediseño en un bloque `(pointer: fine)`: **cero** riesgo para el móvil.
- La paridad se garantiza **por gate automático**, no por inspección: textos (I3), fugas de
  cromo (I1/I2), alcance de acciones (I4), scroll (I5) y congelamiento de geometría (I6).
- Las **únicas** diferencias respecto al móvil están justificadas por ergonomía (espacio de
  sobra, distancia de lectura, alto disponible) y **no introducen información nueva**.
- La red de seguridad encontró y cerró **2 bugs reales** de escritorio que ningún gate
  anterior medía.
