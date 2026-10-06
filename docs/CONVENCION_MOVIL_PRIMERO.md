# Convención — MÓVIL PRIMERO (landscape)

> **Decisión tomada el 2026-10-04.**
> **Estado: VIGENTE.** Rige todo el trabajo de UI/HUD hasta nuevo aviso.

---

## 1. La decisión

A partir del 2026-10-04, **todos los cambios de interfaz y HUD apuntan a la versión
MÓVIL en horizontal (landscape)**.

Motivo: la interfaz y los HUDs **no se ven igual** en PC y en móvil (reglas
`@media (pointer: coarse)` distintas, alturas de viewport muy distintas). Al tocar las
dos a la vez, cualquier ajuste hecho mirando el escritorio se ve mal en el celular y
viceversa. Se cierra **primero el móvil**; el **escritorio se pule al final**, en una
fase aparte.

---

## 2. Reglas de trabajo (obligatorias)

1. **El viewport de referencia es 915×412** (celular landscape típico, `pointer: coarse`
   activo). El smoke corre a **844×390** (mismo perfil, un poco más chico): si entra ahí,
   entra en cualquier celular.
2. **El escritorio queda CONGELADO.** No se optimiza, no se re-tunea, no se "aprovecha
   para arreglar de paso". Solo se **anota** lo que quede pendiente para la fase final.
3. **Si un cambio mejora el móvil pero empeora el escritorio, se hace igual** — pero
   **hay que registrarlo** en la sección *Pendiente de escritorio* (§6) para no perderlo.
4. **Nunca romper el móvil para complacer al escritorio.** El orden de prioridad es:
   móvil > escritorio.
5. Todo cambio visual se **verifica con una captura en móvil landscape** antes de darlo
   por terminado (§4). Un verde del smoke no alcanza: hay que **mirar la imagen**.

---

## 3. Dónde se toca el CSS (`src/ui/styles.css`)

La **base es el escritorio**. El móvil se define por encima, con dos mecanismos:

| Bloque | Línea aprox. | Cuándo aplica |
|---|---|---|
| `@media (pointer: coarse)` | ~6079 | **Celular/tablet táctil**, cualquier altura. Es el bloque principal del móvil. |
| `@media (pointer: coarse) and (max-height: 520px)` | ~6580, ~6795 y ~6911 | Táctil **de poca altura** (celular landscape). Son **TRES bloques separados** con la misma condición, cada uno con selectores distintos (`.blind-card` / `.archetype-*` / `.history-stats`) — **no son duplicados, no fusionar**. |
| `@media (pointer: coarse) and (max-height: 560/430/460px)` | 8 bloques | Compresiones de HUD y paneles para landscape bajo. **Ya gateados por puntero** (Fase 0, ítem 0.3): antes vivían en la base y le aplicaban el layout móvil a una ventana de escritorio baja sin que nadie lo probara. |
| `@media (pointer: coarse) and (min-height: 600px)` | 1 bloque | **TABLET táctil**: DEVUELVE los valores cómodos (barra de ~113px, marcador de 36px) que el bloque de celular había comprimido. Sin él, una tablet de 820px de alto recibía el HUD de un celular de 412px. Gate: `tools/shot-tablet.mjs`. |
| **P8 — paneles** `@media (pointer: coarse)` + `(pointer: coarse) and (max-height: 560px)` | **final del archivo** | **Paneles a pantalla completa.** El overlay deja de scrollear y el panel pasa a ser una COLUMNA flex acotada al viewport (encabezado fijo / cuerpo flexible con `min-height: 0` / pie fijo). Ver §3.1. |

### 3.1 Paneles: el modelo de tres zonas (P8, 2026-10-05)

**Problema.** El overlay scrolleaba (`overflow-y: auto`) y el panel era un bloque que crecía
con el contenido. En landscape (412px de alto) los botones (`.panel-actions`) quedaban por
debajo del pliegue y había que **bajar la pantalla** para llegar a Cerrar / Elegir / Comprar /
Continuar. Pasaba en Recompensa, Tienda, Ciego, Arquetipo, Ascensión, Ajustes y Mazo.

**Modelo.** Todo el arreglo vive en `(pointer: coarse)` (bloque **P8**, al final de
`styles.css`), así el escritorio queda intacto:

1. `.overlay { overflow: hidden }` — el overlay **nunca** scrollea.
2. `.panel:not(.is-menu):not(.is-carousel-frame)` → `display: flex; flex-direction: column;
   max-height: 100%; min-height: 0; overflow: hidden`.
3. Zonas de **alto fijo**: `.panel-title`, `.panel-subtitle`, `.shop-tabs`, `.deck-toolbar`,
   `.panel-actions` → `flex: 0 0 auto` (el pie no se comprime nunca).
4. Zona **flexible**: el cuerpo de cada panel (`> .reward-grid`, `.shop-body`, `.deck-grid`,
   `.stat-grid`, …) → `flex: 1 1 auto; min-height: 0; overflow-y: auto`.

`min-height: 0` es la pieza clave: sin ella un hijo flex no puede encogerse por debajo de su
contenido y vuelve a empujar el pie fuera de la pantalla.

**Que el contenido ENTRE (no solo que scrollee).** P8.1 (`(pointer: coarse) and
(max-height: 560px)`) comprime lo secundario para que Recompensa y Tienda entren **enteras**:
la cara de la carta ya trae nombre/elemento impresos (no se repiten debajo), el arte se acota
por alto (`clamp(96px, 27vh, 118px)` de ancho de tarjeta, `min(10vh, 44px)` en las ofertas) y
las descripciones se recortan con `-webkit-line-clamp`.

**Scroll interno permitido (lista larga):** Mazo, Colección, Historial, Guía, Logros y las
listas de Arquetipos/Ascensión conservan scroll **dentro del cuerpo** — el pie sigue visible.
En Recompensa, Tienda, Ciego, Ajustes, Arquetipo (cabecera/pie) y Ciego superado **no hay
scroll de ningún tipo**.

**Gate:** `node tools/probe-panel-overflow.mjs` recorre **todas** las pantallas (móvil
915×412, `FF_VIEWPORT=smoke` 844×390, `FF_VIEWPORT=tablet` 1180×820) y falla si algún panel
tiene scroll de página o deja las acciones fuera del viewport. Salida: `tools/shots/probe-*.png`.

**Regla de oro:** un cambio pensado para móvil va **dentro de un bloque `(pointer: coarse)`**,
no en la base. Un cambio en la base **afecta a los dos** y por lo tanto contradice la
convención salvo que sea neutro para el móvil.

**Alturas de barra: usar los tokens, no px sueltos.** `--hud-bottom-h` y `--hud-top-h`
(declarados en `:root` y redefinidos en los bloques `(pointer: coarse)`) son el alto REAL de las
dos barras del HUD. Todo lo que se ancla a ellas (`.hud-select-hint`, `.hud-missions-toggle`,
`.hud-missions-panel`) los lee. Antes eran tres px sueltos (98/104/126) que ya se habían
desincronizado una vez: el aviso de selección caía encima de la línea de estado. Si una barra
cambia de alto, se cambia **el token**, no cada anclaje.

`pointer: coarse` se elige **por tipo de puntero, no por ancho**: una ventana de escritorio
angosta NO entra en el bloque móvil. Es a propósito.

**OJO — hay reglas COMPARTIDAS por ancho** que NO son de escritorio y que el móvil landscape
(844–915px de ancho) también recibe: `@media (min-width: 700px)` (glosario del tutorial a 2
columnas) y `@media (min-width: 640px)` (`.blind-card.is-boss` span 2). **No gatearlas**: el
móvil las necesita. Si se afinan, mirar los dos frentes.

---

## 4. Cómo previsualizar y medir (móvil landscape)

```bash
# 1) dev server (SIEMPRE con esta variable en Windows)
CODEBUDDY_SAFE_DELETE_ENABLED=0 npm run dev

# 2) CAPTURAS móviles: 915x412, isMobile + hasTouch => pointer: coarse
CODEBUDDY_SAFE_DELETE_ENABLED=0 node tools/shot-mobile.mjs
#    -> tools/shots/mob-menu.png, mob-blind.png, mob-playing.png

# 3) MEDICIÓN del HUD móvil (geometría, recortes, overlap)
CODEBUDDY_SAFE_DELETE_ENABLED=0 node tools/probe-mobile-hud.mjs

# 4) Carrusel del mazo en móvil (915x412, coarse)
CODEBUDDY_SAFE_DELETE_ENABLED=0 node tools/shot-mobile-deck.mjs
```

**`tools/shot-joker-slots.mjs` es de ESCRITORIO** (1440×810, sin `isMobile`/`hasTouch` ⇒
`pointer: fine`), pese a haber figurado en este doc como herramienta móvil. No usarlo como
preview móvil.

**Los dos visores que son GATE** (fallan con `exit 1` si el viewport se degrada):

```bash
CODEBUDDY_SAFE_DELETE_ENABLED=0 node tools/shot-desktop.mjs  # ESCRITORIO 1440x810 (pointer: fine)
CODEBUDDY_SAFE_DELETE_ENABLED=0 node tools/shot-tablet.mjs   # TABLET 1180x820 (coarse + alto)
```

> **Ojo con el destape.** El reparto TERMINA con una animación que da vuelta las cartas
> (`flip`). Una captura tomada apenas aparece la mano sale con los **dorsos**. Los visores ya
> esperan a que `handState().every(c => c.flip < 0.5)` antes de disparar. Si agregás uno nuevo,
> esperá el destape: con SwiftShader (~12 FPS, `dt` acotado) tarda ~1,5 s en arrancar.

> El smoke (`npm run smoke`) ya corre en **móvil landscape (844×390)** con
> `@media (pointer: coarse)` ACTIVO, así que cualquier regla solo-móvil que se agregue
> queda ejercitada por él. Es el gate automático de esta fase.

---

## 5. Verificación mínima de cada cambio móvil

```bash
CODEBUDDY_SAFE_DELETE_ENABLED=0 npm run typecheck
CODEBUDDY_SAFE_DELETE_ENABLED=0 npm run validate   # el CI lo exige; no lo saltees
CODEBUDDY_SAFE_DELETE_ENABLED=0 npm run smoke      # móvil 844x390, 0 errores
CODEBUDDY_SAFE_DELETE_ENABLED=0 node tools/shot-mobile.mjs   # y MIRAR la captura
```

**Si el cambio toca la BASE, los `@media` compartidos o el 3D compartido**, agregar:

```bash
CODEBUDDY_SAFE_DELETE_ENABLED=0 node tools/shot-desktop.mjs  # GATE: exit 1 si rompió escritorio
```

Chequeo anti-recorte en el viewport chico (el error clásico): si un elemento crece, medir
`getBoundingClientRect().bottom <= window.innerHeight` antes de dar por bueno el cambio.

**Regla de convivencia:** el escritorio nunca se deja PEOR sin registrarlo. Si el móvil gana y
el escritorio pierde, el cambio se hace igual — pero se anota en §6 **el mismo día**.

---

## 6. Pendiente de escritorio (se pule al final)

> Esta lista se alimenta durante la fase móvil. **Todo lo que se deje "roto o sin pulir"
> en escritorio va acá**, con archivo y selector, para que la fase final no adivine.

- _(se completa a medida que avanza la fase móvil)_

**Cerrado en la Fase 0 (2026-10-04):**
- `.hud-status` y `.hud-missions-toggle` se dibujaban **también en escritorio**, duplicando los
  contadores y la franja de misiones. Arreglado: `display:none` en la base para el primero, y la
  regla `.is-visible` del segundo movida **dentro** del bloque `(pointer: coarse)`.
  Gate: `tools/shot-desktop.mjs` (falla con exit 1 si vuelve a pasar).
- Los 8 bloques `max-height` de la base ya están gateados por puntero (§3).

**Pendiente para la fase de escritorio:**
- **Fase 3 de UI (2026-10-05)** — estos cambios son GLOBALES (los pidió el usuario,
  no son efecto colateral del móvil), pero conviene revisarlos en escritorio:
  - Mano inicial **8 → 6** (`RUN_DEFAULTS.handSize`) y abanico móvil más cerrado.
  - **Botones "Descartar" y "Ordenar" retirados** del HUD. El descarte ahora es
    arrastrar a la pila o **tocar la pila** (la zona se enciende tenue cuando hay
    selección); el orden es **automático** (Familia → Sustrato desc → orden
    original), con interruptor en Ajustes.
  - Verificar en escritorio que el arrastre con mouse y el clic-sobre-la-pila se
    sientan bien (el hint de la zona y el tap se probaron sobre todo en táctil).
- **Ventanas de escritorio bajas (<560px de alto)**: al gatear los 8 bloques `max-height`,
  dejaron de recibir la compresión móvil. Si algún layout de escritorio la necesita,
  reintroducirla como bloque `(pointer: fine) and (max-height: ...)`.
- **3D compartido**: `spreadFor()`/`biasFor()` (`src/render/SceneManager.ts`) ya tienen rama por
  perfil (`mobile`/`tablet`/`desktop`). La rama de escritorio está **congelada**: si el encuadre
  de escritorio necesita ajuste, hacerlo en `spreadDesktop()`/`biasDesktop()`.
- **Pilas (mazo/descarte)**: en táctil van a `TACTILE_PILE_X` (±8.5) en vez de ±10.5, para que
  el encuadre lo fije el ALTO y la mesa llene la pantalla. El escritorio conserva ±10.5. Si el
  escritorio necesita otro valor, es su rama de `deckX`/`discardX`.
- **Cartas de la mano**: en táctil llevan un `boost` de escala de **1.3** (a 412px de alto, una
  carta nominal deja el texto de la cara en ~2px). El escritorio queda en 1.
- **`tools/shot-desktop.mjs`** cubre solo `desk-blind` y `desk-playing`. Falta extenderlo a los
  demás paneles (tienda, mazo, colección, historial, ascensión, cosméticos).
- **Mejoras de UI/UX (2026-10-06)** — cambios GLOBALES (los pidió el usuario) que conviene
  mirar en escritorio. El gate `shot-desktop.mjs` da 6/6, pero eso solo cubre las 6
  invariantes de la barra; el aspecto fino no está revisado:
  - **Fungis sin caja**: se le quitó `.hud-block` al bloque de dinero y la etiqueta "FUNGIS".
    Queda **icono + número** en las dos plataformas (`src/ui/HUD.ts`, `src/ui/styles.css`
    `.hud-money`). En escritorio el hueco liberado lo ocupa el bloque de al lado: revisar que
    la barra superior no quede descompensada.
  - **Botón "Jugar Mano" deshabilitado**: `opacity .45 → .78`, `saturate .55 → .8`,
    `brightness .85 → .92` y sombra recortada (`styles.css`, `.hud-actions .btn.is-play.is-art:disabled`).
  - **Glow de selección**: `SELECT_COLOR` `0x5ef08a → 0x52e07f`, `uRingIntensity`
    `0.9 → 0.55` (`src/render/Card3D.ts`) y bloom global `high 0.9 → 0.78` /
    `medium 0.7 → 0.62` (`src/render/Quality.ts`). El escritorio comparte estos tres valores.
  - **Badge del número de selección**: `BADGE_SIZE` `0.32 → 0.22` del ancho de carta
    (`Card3D.ts`) y el nombre de la cara COMPACTA reserva su carril. La cara completa no
    cambió, así que en escritorio el badge se ve más chico: verificar que el 1-5 siga legible.
  - **Idioma**: se retiró de la barra superior y del panel de game over. Queda en **Ajustes**
    (menú principal) y en el **MENU INGAME** (panel de confirmación de salida). En escritorio
    ya no hay botón de idioma en partida: salir al menú es el único camino.
  - **Etiqueta de habilidad**: el `✦` pasó a ser **prefijo del nombre** en la cara compacta
    (antes iba suelto arriba a la derecha, tapado por el badge). El tooltip en táctil se ancla
    ARRIBA y oculta taxonomía/rareza; el de escritorio (hover) queda como estaba.
- **Auditoría de botones (2026-10-06)** — `tools/audit-mobile-buttons.mjs` recorre las 26
  pantallas y valida CADA control (fuera de vista, tapado, piso táctil). Sirve de gate
  (`exit 1`). Verde en 915×412, 844×390 y tablet 1180×820.
  - **Ajustes, campo "Calidad gráfica"**: ahora ocupa **dos columnas**
    (`.settings-field--wide`). En una sola, la 4ª opción ("Alta") quedaba **recortada** por
    el `overflow: hidden` del segmentado. Es una regla BASE: en escritorio también cambia
    (debería verse mejor, pero conviene mirarlo).
  - **Menú, chips secundarios**: `min-height: 30px` en `(pointer: coarse)`. En una tablet
    quedaban en 24px y en celular landscape en 17px (intocables).
  - **Ajustes**: toggles 30px y sliders 30px de alto; se pagó apretando el grid
    (`gap: 4px`, `padding: 4px 10px`) para no meter scroll.
  - **Cortina del duelo**: es un modal a propósito (se destapa con "Listo"), NO un botón
    tapado. El gate lo clasifica como informativo.

---

## 7. Relación con los planes anteriores

- `docs/PLAN_HUD_MOVIL_HORIZONTAL.md` — el plan de pulido del HUD móvil (P0/P1). **Sigue
  siendo la referencia** del diseño del HUD móvil; esta convención lo enmarca como el
  frente de trabajo activo.
