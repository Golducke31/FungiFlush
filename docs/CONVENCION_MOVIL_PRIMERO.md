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

---

## 7. Relación con los planes anteriores

- `docs/PLAN_HUD_MOVIL_HORIZONTAL.md` — el plan de pulido del HUD móvil (P0/P1). **Sigue
  siendo la referencia** del diseño del HUD móvil; esta convención lo enmarca como el
  frente de trabajo activo.
