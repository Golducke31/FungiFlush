# Plan de implementación — Mejoras de UI/UX (5 puntos)

> Estado: **IMPLEMENTADO** (2026-10-06). Las decisiones abiertas se resolvieron así:
>
> | Punto | Decisión de Emanuel | Implementado |
> |---|---|---|
> | 1 · Glow | bajar el verde **y** un poco el bloom global | `SELECT_COLOR 0x52e07f`, `uRingIntensity 0.55`, bloom `high .78` / `medium .62` |
> | 2 · Idioma | al **MENU INGAME**; los demás, todos afuera | barra superior y game over sin botón; queda en Ajustes + menú ingame |
> | 3 · Fungis | sin caja **en todas las plataformas** | `.hud-money` sin `.hud-block` ni etiqueta |
> | 4 · Botón | 0.78, menos saturación, menos sombra | `.is-art:disabled` |
> | 5 · Habilidad | long-press **convive** con el hover, **sin** onboarding | `LONG_PRESS_MS 380` en `Interaction.ts` |
>
> **Extra encontrado y arreglado**: cambiar el idioma desde Ajustes **cerraba el overlay**
> (el juego quedaba sin UI). Causa: `HUD.build()` resetea `elOverlay.className = 'overlay'`
> y borraba `is-open`. Fix: `keepState()` preserva las clases de estado a través de `build()`.
>
> Verificado: `probe-lang-freeze` (panel sigue abierto), `probe-ability-longpress`
> (10/10 long-press, tap y arrastre intactos), capturas `glow-selected` / `glow-high` /
> `ingame-menu`. Gates: typecheck · tests 328/328 · validate · smoke · desktop 6/6 ·
> tablet 5/5 · panel-overflow 0 scroll.

---

## Propuesta original (para referencia)

Cada punto trae **Alcance**, **Elementos afectados** y **Criterio de aceptación**.
El diagnóstico sale de leer el código, no de suposiciones.

---

## 0. Reglas comunes

- **Convención vigente**: `docs/CONVENCION_MOVIL_PRIMERO.md`. El móvil manda; el
  **escritorio está congelado**. Los cambios solo-móvil van dentro de
  `@media (pointer: coarse)`; los globales (los que el usuario pide para todas las
  pantallas) se hacen igual pero **se registran en §6** de ese doc.
- **Verificación obligatoria de cada punto**:
  `typecheck` · `validate` · `smoke` (móvil 844×390) · `node tools/shot-mobile.mjs`
  (y **mirar** la captura) · `node tools/shot-desktop.mjs` **6/6** ·
  `node tools/shot-tablet.mjs` **5/5**.
- Herramientas específicas ya existentes que sirven acá:
  `probe-hand-card.mjs` (mide la escala textura→pantalla), `probe-ui-overlap.mjs`,
  `probe-panel-overflow.mjs`.

---

## 1. Glow verde de selección y jerarquía de la cara

### Diagnóstico (lo que hay hoy)

| Qué | Dónde | Valor actual |
|---|---|---|
| Halo de la carta | `Card3D.ts:673-676` | **ya está en 0** para cartas de mano |
| Anillo verde (la señal real) | `Card3D.ts:679-680` | `uRingIntensity = selectGlow*0.9 + compatibleGlow*0.3` |
| Color del anillo | `palette.ts:73` | `SELECT_COLOR = 0x5ef08a` |
| Grosor del anillo | `Shaders.ts:147` | `uRingFalloff: 9.5` |
| Bloom | `Quality.ts` | `high`: strength **0.9**, 2 iteraciones · `medium`: 0.7, 1 |
| Umbral de bloom | `Quality.ts` | `bloomThreshold: 0.70` |
| Badge del número | `Card3D.ts:355-361` | esquina sup. derecha → textura x∈[328,491], y∈[21,184] |
| Nombre (cara compacta) | `CardTexture.ts:778-793` | centrado, `nameMaxW = W - pad*2 - 24` |
| Fuente del nombre | `CardTexture.ts:782` | `CARD_DISPLAY_FONT` (**Gasoek One**, display) ≤68px |

**Dos causas reales, no una:**
1. El verde `#5ef08a` tiene **luminancia ≈ 0.79**, por encima del umbral de bloom
   (0.70). En `high` (strength 0.9, 2 iteraciones) **entra al bloom** y se ve como un
   resplandor difuso que lava la ilustración; en `low`/`medium` se ve mucho más sobrio.
   Eso explica el "en el modo high es demasiado alto".
2. El nombre va centrado sin reservar el carril derecho, así que el **badge lo tapa**;
   y la fuente es de *display*, no de lectura.

### Alcance

1. **Bajar el aporte de la selección al anillo**: `0.9 → ~0.55` y el de "compatible"
   `0.3 → ~0.2` (`Card3D.ts:679-680`).
2. **Sacar el verde del rango de bloom**: oscurecer `SELECT_COLOR` a un verde de
   luminancia ≈0.60–0.65 (p. ej. `0x33c46e`). Preferible a tocar el bloom, porque
   arregla los tres tiers a la vez y **no** apaga el bloom de legendarias/partículas,
   que es intencional.
3. **Reservar el carril del badge**: en compacta, `nameMaxW = W - pad*2 - badgeAncho`
   (el badge ocupa ~163px de textura de ancho + margen → reservar ~180px).
4. **Nombre legible**: pasar el nombre compacto a `CARD_TEXT_FONT` (Fredoka
   SemiCondensed, la que ya se usa para los chips) o, como mínimo, bajar el techo de
   68 → 56px y subir el piso de 30 → 40px para que no se achique de más.

### Elementos afectados

`src/render/palette.ts` · `src/render/Card3D.ts` · `src/render/CardTexture.ts` ·
(opcional) `src/render/Shaders.ts`.

### Criterio de aceptación

- Con **quality = high**, una carta seleccionada: el **nombre se lee completo y no lo
  tapa el badge**; el anillo verde se lee como **borde**, sin resplandor que invada la
  ilustración.
- El cambio se ve en los **tres tiers** (`low`/`medium`/`high`): en `low` la selección
  tiene que seguir siendo evidente (sin bloom no hay ayuda).
- El badge sigue con `renderOrder 20` y su posición no se mueve.
- Capturas comparativas: mano sin selección / con 1 / con 5 (máx.) en 915×412 y 844×390.
- `shot-desktop` 6/6 (el color del anillo es compartido).

### Decisión abierta

¿Bajamos el **bloom global** de `high` o solo el verde? Recomiendo **solo el verde**.

---

## 2. Mover "Idioma" fuera del HUD ingame

### Diagnóstico

- El botón está en la barra superior: `HUD.ts:496-499`, apilado en `rightGroup`
  (`HUD.ts:512`) junto al dinero y al botón de menú.
- **Ya existe** el mismo control en **Ajustes**: `SettingsScreen.ts:127-131`
  (`settings.language`, `data-act="lang"`), alcanzable desde menú → Ajustes.
- Hay un **tercer** botón de idioma en el panel de **game over**: `HUD.ts:3536-3546`.
- El menú **no tiene pestañas**: son 4 botones de arte + chips
  (`MenuScreen.ts:199-302`). El propio doc del archivo ya declara
  *"Idioma -> dentro de Ajustes (ya estaba)"* (línea 18).

### Alcance

1. Quitar `langButton` de `rightGroup` (`HUD.ts:496-512`). La barra queda con
   **dinero + menú**.
2. Decidir el del game over: recomiendo quitarlo por el mismo criterio (el idioma es un
   ajuste de sistema, no una acción de partida).
3. Dejar el idioma **en Ajustes**, que ya funciona y ya refresca sus etiquetas al
   cambiar (`SettingsScreen.ts:189+`).

### Elementos afectados

`src/ui/HUD.ts` (barra superior + game over) · `src/ui/styles.css` (el ancho de
`.hud-top` en `(pointer: coarse)` gana aire: revisar que no queden huecos raros) ·
`src/main.ts` (el callback `onToggleLanguage` **se mantiene**: lo usa Ajustes).

### Criterio de aceptación

- En partida **no hay** botón de idioma.
- Cambiar el idioma desde **menú → Ajustes** funciona y el panel se re-traduce en el acto.
- La barra superior no se desborda en 844×390 ni 915×412 (`probe-mobile-hud`, `shot-mobile`).
- `shot-desktop` 6/6 (el escritorio pierde el botón: **registrar en §6**).

### ⚠️ Decisión abierta — necesito tu confirmación

**"pestaña 'Tab'" no existe en el código**: el menú no tiene pestañas. Interpretaciones:

- **(A)** Te referís a **Ajustes** (donde el idioma ya está). → Es solo el punto 2 tal cual.
- **(B)** Querés que arme una **pestaña nueva** (un panel con solapas) en el menú y que el
  idioma viva ahí. → Es una feature aparte: habría que diseñar el sistema de pestañas
  (estructura, estilos, navegación, i18n) y planificarlo como fase propia.

**Recomiendo (A)** por ahora, y dejar (B) como pedido separado si es lo que querías.

---

## 3. Currency "Fungi": solo icono + número, sin caja

### Diagnóstico

`moneyBlock` es `.hud-block hud-money` (`HUD.ts:473-474`) y contiene una etiqueta de
texto `.hud-label` "FUNGIS" + `.hud-money-row` (icono `ui/fungi.png` + `elMoney`). La
**caja** la aporta `.hud-block`: borde + fondo + `padding: 10px 14px`
(`styles.css:407-439`).

### Alcance

1. Quitar la clase `hud-block` del bloque de dinero (o añadir un modificador
   `.hud-money.is-bare` que anule borde/fondo/padding — más explícito y reversible).
2. Quitar la **etiqueta de texto** "FUNGIS": el icono ya dice qué es.
3. Dejar `[icono][número]`. Mantener el icono `aria-hidden` y agregar
   `title`/`aria-label` con "Fungis" para lectores de pantalla.
4. Revisar las reglas móviles que hoy tocan el bloque
   (`styles.css:4458` ajusta `.hud-money-icon` en alto chico).

### Elementos afectados

`src/ui/HUD.ts` · `src/ui/styles.css` (`.hud-money*`, `.hud-block` si se usa el
modificador, y el bloque `(pointer: coarse) and (max-height: 560px)`).

### Criterio de aceptación

- En partida se ve **solo el hongo azul + el número**, sin borde, fondo ni etiqueta.
- El número se sigue actualizando con `money:changed` (comprar, vender, reroll).
- La barra superior **no se desborda** en 844×390 (gate del smoke) ni en 915×412; el
  hueco liberado no deja un espacio muerto raro.
- `shot-desktop` 6/6 (**registrar en §6**: el escritorio también pierde la caja).

### Decisión abierta

¿Sin caja **en todas las plataformas** o **solo en móvil**? Si es solo móvil, va dentro
de `(pointer: coarse)` y el escritorio no se toca.

---

## 4. Botón "Jugar Mano" desactivado: opacity 0.78

### Diagnóstico

Regla actual (`styles.css:1375-1378`):

```css
.hud-actions .btn.is-play.is-art:disabled {
  opacity: 0.45;
  filter: saturate(0.55) brightness(0.85);
}
```

La sombra viene de dos lados: el `drop-shadow` del label
(`.btn-play-label`, `styles.css:1355`) y el `box-shadow` del `.btn.is-play`
(`styles.css:1305-1308`).

### Alcance

- `opacity: 0.45 → 0.78`.
- Menos desaturación: `saturate(0.55) → ~0.8`.
- Menos brillo perdido: `brightness(0.85) → ~0.92`.
- **Menos sombra** en deshabilitado: anular/reducir el `drop-shadow` del label y el
  `box-shadow` exterior del botón mientras está `:disabled`.

### Elementos afectados

`src/ui/styles.css` (una sola regla + el `drop-shadow` del label; revisar si el bloque
móvil de `.is-art` —`styles.css:6323+`— necesita ajuste).

### Criterio de aceptación

- Con **0 cartas seleccionadas** el botón se lee claramente "apagado" pero el texto
  **sigue siendo reconocible** (antes quedaba casi invisible).
- Al seleccionar cartas pasa a `is-armed` con el zoom actual, sin cambios.
- Comparativa visual off/on en 915×412 (captura), y `smoke` 0/0/0.

---

## 5. Etiqueta de habilidad fiable en móvil + señal de "tiene habilidad"

### Diagnóstico (el punto más profundo)

1. **El tooltip NO se dispara por long-press.** Lo hace `Interaction.emitHover()`, que
   **solo corre desde `pointermove`** (`Interaction.ts:143` y `274-281`). En táctil, si el
   dedo **no se mueve**, no hay `pointermove` → **el tooltip no aparece**. Eso es
   exactamente el *"a veces no se muestra"*.
2. **Cuando aparece, queda debajo del dedo**: se posiciona junto al puntero
   (`HUD.ts:3676-3684`, `left = x + 18`).
3. **La marca de habilidad ya existe pero no se ve**: la cara compacta dibuja un `✦` en
   `(W-100, 46)` (`CardTexture.ts:931-939`), que cae **dentro del área del badge de
   selección** (x∈[328,491], y∈[21,184]) → con la carta seleccionada queda tapada. Y
   mide 46px de textura ≈ **6.8px reales**.
4. El tooltip muestra la habilidad como **tag + hint** (`guide.abilityTag` = "HABILIDAD",
   `guide.abilityHint` = "Esta carta tiene un efecto que se dispara sola. El borde lila y
   el ✦ la marcan.") y el texto real de la carta en `.tooltip-desc` (`descKey`).

### Alcance

1. **Long-press real** en `Interaction`: timer en `pointerdown` (~380ms) que, si **no**
   hubo arrastre ni `pointerup`, dispare `onLongPress(card)`. Cancelar en:
   `pointermove > DRAG_START_PX` (10px), `pointerup`, `pointercancel`, `pointerleave`.
   Constantes nuevas junto a `CLICK_SLOP_PX` / `DRAG_START_PX` / `CLICK_MAX_MS`.
2. **Wiring** en `main.ts`: `onLongPress` → `hud.showTooltip(card, x, y, hint)` con el
   mismo hint de combos que ya calcula `onHoverChange`.
3. **Posición táctil del tooltip**: en `(pointer: coarse)` anclarlo **arriba de la mano /
   centrado**, no pegado al dedo (variante del cálculo de `left/top`).
4. **Señal de habilidad visible**: mover el `✦` **fuera del carril del badge** (p. ej.
   esquina superior izquierda, bajo el chip de nivel, o al lado del nombre) y subirlo de
   tamaño (46px → ~64px de textura ≈ 9.5px reales).
5. **Onboarding**: que un jugador nuevo se entere. Opciones (elegir una):
   - un aviso la **primera vez** que aparece una carta con `effects` (toast/banner, gate
     persistido en el perfil, igual que `seenTutorial`);
   - una línea en la **Guía** + el `abilityHint` actual, que ya explica la marca.

### Elementos afectados

`src/render/Interaction.ts` (long-press) · `src/main.ts` (wiring) · `src/ui/HUD.ts`
(tooltip: posición + contenido) · `src/render/CardTexture.ts` (marca ✦) ·
`src/ui/styles.css` (`.hud-tooltip` en coarse) · `src/i18n/{es,en}.json` si se agrega
texto nuevo · `src/meta/ProfileState.ts` si el aviso se persiste.

### Criterio de aceptación

- En móvil, **mantener presionada una carta sin mover el dedo** muestra la etiqueta;
  soltar la oculta. **Repetible 10/10** (hoy es intermitente).
- La etiqueta **no queda debajo del dedo** y entra completa en 844×390.
- Una carta con `effects` se distingue **sin seleccionarla** (marca visible y no tapada
  por el badge).
- **Sin regresiones de gesto**: el tap sigue seleccionando; el arrastre sigue descartando;
  un hold largo **no** selecciona ni arrastra.
- `smoke` 0/0/0 (el smoke usa eventos de puntero reales para tap y drag).
- Test unitario nuevo para la máquina de estados del long-press (los umbrales son puros y
  se pueden testear sin navegador, como el resto de la lógica de interacción).

### Decisión abierta

¿El long-press **reemplaza** el hover en móvil o **convive** con él? Recomiendo convivir:
el hover se mantiene para escritorio y para el arrastre; el long-press es la vía táctil.

---

## Orden sugerido y dependencias

| # | Punto | Por qué en este orden | Riesgo |
|---|---|---|---|
| 1 | **4** (opacity) | Una regla CSS, sin efectos colaterales | nulo |
| 2 | **3** (Fungi sin caja) | Cambio chico y aislado en el HUD | bajo |
| 3 | **1** (glow + cara) | Toca render; hay que verificar los 3 tiers | medio |
| 4 | **2** (Idioma) | Simple, pero **bloqueado por la decisión abierta** | bajo |
| 5 | **5** (habilidad móvil) | El más grande: input + tooltip + cara + onboarding | alto |

## Riesgos transversales

- **Escritorio congelado**: los puntos 1, 3 y 4 tocan reglas **compartidas**. Hay que
  registrar cada impacto en §6 de `docs/CONVENCION_MOVIL_PRIMERO.md` el mismo día.
- **Punto 1**: bajar el color del anillo puede dejar la selección **poco visible en
  `low`** (sin bloom). Verificar los tres tiers antes de dar por cerrado.
- **Punto 2**: quitar el idioma de la partida obliga a salir al menú para cambiarlo. Si
  alguien arranca en el idioma equivocado, tiene que abandonar la run. Alternativa a
  evaluar: dejarlo en el panel de confirmación de salida.
- **Punto 5**: el long-press compite con el drag y con el tap. Hay que garantizar que el
  timer se limpie en **todos** los caminos de salida y que un hold no termine en
  selección accidental.

## Qué necesito de vos antes de implementar

1. **Punto 2**: ¿(A) Ajustes, o (B) una pestaña nueva de verdad?
2. **Punto 3**: ¿sin caja en todas las plataformas o solo en móvil?
3. **Punto 1**: ¿bajamos solo el verde o también el bloom global de `high`?
4. **Punto 5**: ¿el long-press convive con el hover, y querés el aviso de onboarding?
5. **Punto 5**: ¿cuánto tiene que durar el "mantener presionado"? (propongo ~380ms)
