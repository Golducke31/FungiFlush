# Plan — Animaciones de combo + Audio

> Estado: **F1 (Audio) IMPLEMENTADA**. Las animaciones (F2-F6) siguen pendientes.
> Redactado el 2026-10-06.
>
> | Fase | Estado |
> |---|---|
> | **F1 · Audio** | ✅ **hecha** — ver §B.8 |
> | **F2 · Núcleo de FX** (`fxTween`, `sleep`, `hitStop`) | ✅ **hecha** — ver §A.11 |
> | **F3 · Combo** (`c`, pop, números) | ✅ **hecha** — ver §A.12 |
> | F4 · Micelio | ✅ **hecha** — ver §A.13 |
> | F5 · Cierre + bloom | ✅ **hecha** — ver §A.14 |
> | F6 · Borrar los pixel-art | ✅ **hecha** — ver §A.15 |
> Fuente de las animaciones: `combo-esporas.html` (demo de 210 líneas).
> Fuente del audio: los 4 archivos/carpetas que pasó Emanuel.
> Cada bloque trae **alcance**, **archivos afectados** y **criterio de aceptación**.

---

## 0. Resumen ejecutivo

**La buena noticia**: el demo NO hay que portarlo entero. FungiFlush ya tiene la mitad de
la infraestructura, y en un caso mejor que el demo:

| Pieza del demo | En FungiFlush | Veredicto |
|---|---|---|
| Pool de 800 partículas aditivas | `SporeField` (`src/render/Particles.ts`): ambiente GPU + transitorio CPU con pool circular, `burst()`/`stream()` | **Ya está** — no se toca |
| Shake de cámara | `rig.addShake(amount)` | **Ya está** |
| Número flotante | `.score-popup` (DOM) | **Ya está** — se le agrega el pop y el color |
| Secuencias | `anim.ts` sobre GSAP, con **un solo reloj** | **Ya está** — se le agrega el azúcar |
| Audio | `src/audio/AudioBus.ts`: no-op con los ganchos YA cableados | **Llenar el hueco** |
| Tweens con promesa (`await`) | No existe como tal | **Agregar** |
| Hit-stop (`holdUntil`) | No existe | **Agregar** |
| Micelio (Bézier que crece) | No existe | **Agregar** |
| Escalado del combo `c` | No existe | **Agregar** |

**Lo que hay que sacar**: SÍ. Las **dos hojas de sprites pixel-art** (`public/fx/fx_burst.webp`,
`public/fx/fx_poison.webp`, del *Super Pixel Effects Gigapack*) se usan hoy en
`HUD.effect()` para el tick de bonus y el negativo. El sistema de partículas las reemplaza.
Ver §A.9 — incluye qué se borra y qué NO.

---

## Parte A — Animaciones

### A.0 La decisión de fondo: UN SOLO RELOJ

`src/render/anim.ts` ya documenta la regla: GSAP **no** usa su propio `rAF`, lo conduce
`updateAnim(dt)` desde el loop de `SceneManager` con el MISMO `dt` acotado a 0.05.

El hit-stop del demo funciona porque **todo** (tweens y partículas) se alimenta del mismo
`dt`: si `now < holdUntil`, `dt = 0`. Acá se replica igual, y esa es la razón por la que el
`fxTween` de §A.1 tiene que ser GSAP y no un `setTimeout`: un `setTimeout` seguiría
corriendo durante el congelamiento y la secuencia se desincronizaría.

**Alcance**: en `SceneManager.render()`, el `dt` que se pasa a `updateAnim()`,
`tweenManager.update()` y `particles.update()` pasa a ser `0` mientras dure el hit-stop.
`this.clock` (que alimenta `runFxQueue`) también deja de avanzar — es lo deseado: la cola de
efectos se congela con todo lo demás. **La entrada y el HUD NO se congelan.**

**Archivos**: `src/render/SceneManager.ts` (loop), `src/render/anim.ts`, `src/render/Tween.ts`.

**Criterio de aceptación**: con el hit-stop activo, una animación en curso y el burst de
partículas quedan literalmente quietos (mismo píxel) durante los ms pedidos; el tap sigue
respondiendo y el HUD no se traba.

---

### A.1 Tweens con promesa (`fxTween` / `sleep`)

**Alcance** — agregar a `src/render/anim.ts`:

```ts
/** Tween de un solo valor 0→1 con promesa. Es el `tween(ms, fn)` del demo. */
export function fxTween(ms: number, fn: (p: number) => void): Promise<void> {
  const proxy = { p: 0 };
  return new Promise((resolve) => {
    tweenOf(proxy, {
      p: 1, duration: d(ms / 1000), ease: 'none',
      onUpdate: () => fn(proxy.p),
      onComplete: () => resolve(),
    });
  });
}
/** `sleep` ES un tween: por eso el hit-stop lo congela. */
export const sleep = (ms: number) => fxTween(ms, () => {});
```

Así la secuencia del combo se escribe con `await` y se lee de arriba a abajo:

```ts
await mycelium(prev, next);
activate(i);
await sleep(Math.max(120, 420 - i * 70));
```

`d(ms/1000)` reusa el escalado por `reduceMotion` que ya existe: con movimiento reducido la
duración queda en 0.001s, el estado final se alcanza igual y los `onComplete` disparan.

**Archivos**: `src/render/anim.ts` (solo agrega).

**Criterio de aceptación**: `await fxTween(...)` resuelve; con `reduceMotion` el callback
corre una vez con `p ≈ 1` y la promesa resuelve sin colgarse.

---

### A.2 Hit-stop

**Alcance** — en `SceneManager`:

```ts
private hitStopLeft = 0;                       // segundos
hitStop(ms: number): void {
  if (this.reduceMotion) return;               // el demo: `if (fx) holdUntil = ...`
  this.hitStopLeft = Math.max(this.hitStopLeft, ms / 1000);
}
// en render():
const raw = ...;                               // dt real acotado
this.hitStopLeft = Math.max(0, this.hitStopLeft - raw);
const dt = this.hitStopLeft > 0 ? 0 : raw;
```

⚠️ **No** usar `clock + ms/1000` como el demo: acá `clock` avanza con `dt`, así que si el
`dt` se pone en 0 el deadline nunca llega y el juego queda congelado para siempre. Va con
cuenta atrás sobre el `dt` REAL.

**Archivos**: `src/render/SceneManager.ts`.

**Criterio de aceptación**: `hitStop(90)` congela ~90ms reales (medible con el probe de
frames) y el juego retoma solo. Con `reduceMotion` no hace nada.

---

### A.3 Partículas: NO reescribir

El demo usa un `Points` de 800 con mezcla aditiva y "apagar = oscurecer el color".
FungiFlush ya tiene eso **y más**: `SporeField` separa el ambiente (100% GPU, sin costo de
CPU por frame) del transitorio (pool circular, cero asignaciones por frame).

**Único trabajo**: revisar que el transitorio sea aditivo y que `BurstOptions`
(`color/speed/spread/size/life/upward`) alcance para el combo. Si falta algo, se **extiende
`BurstOptions`**, no se agrega un segundo sistema.

**Archivos**: `src/render/Particles.ts` (leer; tocar solo si falta una opción).

**Criterio de aceptación**: el combo no crea un `Points` nuevo ni asigna buffers por burst;
el contador de partículas del HUD de debug (F3) no crece con las repeticiones.

---

### A.4 Micelio (nuevo)

**Alcance** — archivo nuevo `src/render/Mycelium.ts`:

```ts
export function growMycelium(scene, from: Vector3, to: Vector3, opts): Promise<void>
```
- `QuadraticBezierCurve3` con el punto de control por debajo del punto medio (como el demo):
  la raíz "cuelga" entre las dos cartas.
- `BufferGeometry.setFromPoints(curve.getPoints(40))` + `LineBasicMaterial({ transparent })`.
- **Crecer** = `setDrawRange(0, Math.floor(41 * p))` sobre un `fxTween(260, ...)`.
- **Desvanecer** = `opacity = 1 - p` sobre un `fxTween(500, ...)`, y después `dispose()`.

**DECIDIDO (2026-10-06)**:

1. **Grosor**: **`TubeGeometry`**, radio chico y sutil. El `Line` de WebGL es de **1 px fijo**
   y no se puede engrosar, así que no alcanza para lo pedido.
   - Radio ~0.012-0.018 del ancho de carta (a definir en la implementación, mirando la carta).
   - `tubularSegments` ~24, `radialSegments` 5 → pocos triángulos (24×5×2 = 240 por raíz).
   - **Crecer**: en vez de regenerar la geometría por frame, se **escala en el eje del tubo**
     o se usa `setDrawRange` sobre los índices (el tubo es indexado, así que el `drawRange`
     por índice funciona igual que en la línea). Se elige la opción más barata al medir.
   - Material: `MeshBasicMaterial` con `transparent` (no necesita luz).
2. **De dónde a dónde**: **las cartas JUGADAS**, en el orden en que puntúan (el orden real
   del cálculo), no las de la mano.

**Reuso**: crear y destruir 5-10 líneas por mano genera basura. Propongo un **pool de 8
líneas** reutilizadas (mismo criterio que el pool de partículas del proyecto).

**Archivos**: `src/render/Mycelium.ts` (nuevo), `src/render/SceneManager.ts` (lo llama).

**Criterio de aceptación**: la raíz crece de una carta a la siguiente en ~260ms, se desvanece
y libera su slot del pool; 0 errores de consola; sin crecimiento de memoria entre manos
(medible: repetir 20 manos y mirar el contador de geometrías de `renderer.info`).

---

### A.5 Número flotante

Ya existe `.score-popup` (`HUD.popup`) y el ticker `.score-ticker`. **No se reescribe**: el
DOM es localizable (i18n), accesible y no cuesta GPU.

**Alcance**:
1. **Pop de entrada** (como el `.pop` del demo): keyframe `scale 1.55 → 1` con
   `cubic-bezier(.2,1.8,.4,1)` en 300ms. Se aplica quitando/poniendo la clase (truco del
   reflow) igual que el demo.
2. **Color por tipo de efecto**, que es lo que hoy falta: el popup usa `color` del paso.
   Mapear por tipo (§A.7) en vez de por color de fuente.

**Paleta DECIDIDA (2026-10-06)** — se mantiene el lenguaje del juego, NO el del demo:

| Tipo | Color | Token |
|---|---|---|
| Fichas (sustrato) | ámbar | `--substrate` (ya es así) |
| Multiplicador (esporas) | verde | `--spores` (ya es así) |
| ×2 / xmult | **dorado** | nuevo — hoy no se distingue y es donde el dorado aporta |

El **teal y el rojo del demo NO se copian**: un rojo para el multiplicador chocaría con el
verde de esporas que el jugador ya aprendió en toda la UI.

**Archivos**: `src/ui/HUD.ts` (`popup`/`scoreTick`), `src/ui/styles.css` (`.score-popup`,
keyframe nuevo).

**Criterio de aceptación**: cada número aparece con el pop, en el color de su tipo, y
desaparece solo; 20 manos seguidas no dejan nodos huérfanos en `.hud-popups`.

---

### A.6 Pop de la carta (squash & stretch + flash del borde)

**Alcance** — en `Card3D`, un método `pop(effectColor: number): Promise<void>`:
- **Squash & stretch** (fórmula del demo, que es un resorte amortiguado):
  `scale = 1 + 0.3 * exp(-7t) * cos(18t)` con `t = p * 0.45`.
- **Elevación** `lift = 0.35 * exp(-6t)` — la carta salta y vuelve.
- **Flash del borde**: ya existe `setFlash(value)`; se lo tinta con el color del efecto
  (`flash = (1-p)² * color`), como el `material.color.setRGB` del demo.

⚠️ **Cuidado con el `scale`**: `Card3D` ya usa la escala para el `boost` táctil (1.3 en
móvil) y para el layout de la mano. El pop tiene que ser un **multiplicador** sobre la
escala base, no un `setScalar` absoluto — si no, en móvil la carta se encoge al 1.0.

**Archivos**: `src/render/Card3D.ts`.

**Criterio de aceptación**: la carta hace el pop sin cambiar de tamaño final, y en móvil
conserva el boost 1.3. Con `reduceMotion`, el pop se salta pero el flash se ve.

---

### A.7 Escalado del combo `c` (0..1)

**Alcance** — `c = index / max(1, steps - 1)` sobre los pasos del cálculo, y ese `c` maneja:

| Efecto | Fórmula del demo | En FungiFlush |
|---|---|---|
| Partículas | `18 + c*45` | `particles.burst(pos, Math.round(18 + c*45), { color, speed: 2 + c*3 })` |
| Shake | `0.4 + c*1.4` | `rig.addShake((0.4 + c*1.4) * 0.02)` (la unidad del proyecto es otra: verificar contra los shakes actuales) |
| Tamaño del texto | `1 + c*0.5` | variable CSS `--pop-scale` en el `.score-popup` |
| Pulso del fondo | `bgp = 0.3 + c*0.7` | lerp del color de niebla/arena hacia rojo |

**El pulso del fondo** es lo único nuevo de verdad: hoy `scene.background` es un color plano
y el grade vive en `PostFx`. Propongo un **lerp sobre el color de niebla de la arena**
(`Arena.ts`) con el mismo decaimiento `exp(-dt*3)` del demo, y que el `bgp` sirva además
como intensidad para el bloom (`uStrength`) — que es justo lo que el demo sugiere para
sumar bloom sin tocar el resto.

**Archivos**: `src/render/SceneManager.ts` (cálculo de `c` y pulso), `src/render/Arena.ts`
(color de niebla), `src/ui/HUD.ts` + `styles.css` (tamaño del popup).

**Criterio de aceptación**: la primera carta del combo se siente chica y la última grande;
el shake y el pulso escalan monótonamente con `c`; con una sola carta (`steps = 1`) no hay
división por cero.

---

### A.8 Cierre del combo

**Alcance**: al terminar los pasos —
1. `hitStop(90)`.
2. Explosión grande: `burst(center, 160, dorado, 6)` + `burst(center, 80, rojo, 4)`
   (el demo usa dos colores; acá, dos bursts).
3. El total en **dorado** en el ticker.
4. Acorde final de audio (§B).

**Archivos**: `src/render/SceneManager.ts`, `src/ui/HUD.ts`.

**Criterio de aceptación**: se siente un "cierre" (pausa + estallido + número grande) y no
una repetición más del mismo efecto.

---

### A.9 Qué se saca (respuesta a "avisar si hay que sacar los pixel-art")

**SÍ, y es acotado.** Lo que se reemplaza:

| Elemento | Ubicación | Acción |
|---|---|---|
| `fx_burst.webp`, `fx_poison.webp` | `public/fx/` | Borrar (o dejar de usar y borrar después) |
| `.fx-sprite`, `.fx-poison`, `.fx-burst` | `src/ui/styles.css` (~1920) | Borrar |
| `HUD.effect(x, y, kind)` | `src/ui/HUD.ts:3817` | Borrar |
| Las 2 llamadas | `HUD.ts:3799` (`negative → poison`) y `:3801` (`isBonus → burst`) | Reemplazar por el burst de partículas + el color de §A.5 |
| `public/fx/LICENSE.txt` | `public/fx/` | **Mantener hasta confirmar el borrado**: es la atribución del pack (Will Tice / unTied Games) y la licencia pide atribución en los créditos si el asset se usa. Si se borran los webp, revisar si la atribución sigue siendo necesaria. |

**Lo que NO se saca** (no es pixel-art, es 3D y se queda): el pool de esporas, el flash de
la carta, el anillo de selección, el shake, el popup y el ticker.

**Criterio de aceptación**: no queda ninguna referencia a `fx/` en `src/` ni en `public/`;
`grep -rn "fx_burst\|fx_poison\|fx-sprite" src/` devuelve vacío; el bundle no incluye los webp.

---

### A.11 ✅ F2 implementada — el núcleo

**`src/render/anim.ts`**: `fxTween(ms, fn)` (promesa, progreso 0→1) y `sleep(ms)`.
Los dos son **GSAP**, no `setTimeout`, y esa es toda la gracia: GSAP lo mueve
`updateAnim(dt)` desde el loop, así que **el hit-stop los congela junto con todo lo demás**.
Un `setTimeout` correría con el reloj real y la secuencia se desincronizaría de lo que se ve.
El `ease` es lineal a propósito: la curva la pone `fn`, y un ease acá deformaría las fórmulas
del tipo `exp(-7t)`.

**`src/render/SceneManager.ts`**: `hitStop(ms)` + `hitStopLeft`. En el loop se descuenta el
presupuesto y se pasa `step` (0 o `dt`) a **todo** el update: `clock`, `tweens`, `anim`,
cartas, carrusel, zonas, partículas, dado, agua y cámara. La entrada **no** se congela (los
eventos de puntero no pasan por el loop). Con `reduceMotion` es un no-op.

**🐞 BUG que cazó el probe**: la cuenta atrás usaba el `dt` **acotado a 0.05**. A 60 FPS da
igual, pero en un equipo lento el presupuesto se consume de a 50 ms por frame: un hit-stop de
90 ms duraba ~4 frames, o sea **medio segundo real**, y en el headless a ~8 FPS se midió un
congelamiento que se comía la ventana entera. Ahora descuenta el `dt` **sin acotar** (tiempo
de pared), que es lo que hace el prototipo con `performance.now()`. El golpe dura lo que dice,
no lo que el framerate permita.

**Verificación**:
- `tests/fx.test.ts` (nuevo, 4 tests): que `fxTween` recorra 0→1 y resuelva; y sobre todo que
  **`sleep` NO avance con el reloj real** — se espera 180 ms de verdad y sigue pendiente, y
  recién con `updateAnim` resuelve. Es la propiedad que hace posible el hit-stop, y sin test
  se puede romper sin que ningún smoke lo note.
- `tools/probe-hitstop.mjs` (nuevo): en el loop real, `hitStop(700)` deja el `clock` clavado y
  todos los frames con `dt = 0`; después **retoma solo** (`hitStopLeft` vuelve a 0, sin
  deadlock); y con `reduceMotion` no congela nada.

⚠️ **Nota de entorno**: GSAP deja un handle vivo en Node, así que la suite de tests se
colgaba al terminar. `npm test` ahora usa `--test-force-exit` (Node 22). Si se agrega otro
test que importe GSAP, ya está cubierto.

### A.12 ✅ F3 implementada — el combo

**`SceneManager.runScoreStep`** ahora calcula **`c`** (0 en el primer paso, 1 en el último) y
con él escala todo:

| Qué | Fórmula |
|---|---|
| Esporas | `Math.round(14 + c * 40)` |
| Velocidad | `1.8 + c * 2.4` |
| Tamaño de partícula | `0.06 + c * 0.05` |
| Shake | multiplicador `0.06 + c*0.12`, suma `0.02 + c*0.04` |

**Cómo se saca el total** (no hay `steps` en el payload): el primer paso corre con **0,6 s de
delay**, así que para cuando arranca el motor ya emitió todos los `score:step` y `stepIndex`
vale el total de la mano. `c = index / (total - 1)`, con guarda para `total === 1`.

**`Card3D.pop(tint)`** — squash & stretch + destello:
- `home.sx = 1 + 0.3 * exp(-7t) * cos(18t)` y `home.sy = 2 - sx` (conserva "volumen": si X
  crece, Y baja, que es lo que se lee como goma y no como un zoom).
- Usa el canal `home.s*`, **no** `group.scale`: `applyTransform()` lo multiplica por la escala
  base y por el boost táctil, así que un `setScalar` aplastaría el 1.3 del móvil.
- El destello tinta `emissive` (el material usa la cara como emissiveMap). **Restaura todo al
  terminar** y también si el tween se rechaza: una mano larga no puede dejar cartas deformadas.

**Paleta respetada** (`UI_COLORS`): sustrato ámbar, esporas verde, y **`xmult` dorado
(`0xffd36b`)** para los multiplicadores. Hasta ahora un `x2` se pintaba igual que un `+4`.

**Número flotante**: `.score-popup` ya tenía el keyframe de subida con su rebote; se le agregó
`--pop-scale` (1 → 1.5) que el render pasa en cada paso.

**Verificación** — `tools/probe-combo.mjs` (nuevo, sirve de gate) juega una mano de 5 cartas y
mide: **escalas 1 → 1,083 → 1,167 → 1,25 → 1,333 → 1,417 → 1,5** (17 px → 26 px), los `+N` en
ámbar `rgb(242,166,59)`, los `x1.25` en dorado `rgb(255,211,107)`, squash máximo **0,3** y
**`sx/sy` de vuelta en 1** al terminar. 0 errores de consola.

### A.13 ✅ F4 implementada — micelio

**`src/render/Mycelium.ts`** (nuevo): **pool de 8 `TubeGeometry`** reutilizados (igual
criterio que el pool de partículas), `MeshBasicMaterial` con `transparent` — no necesita luz,
así que entra en cualquier tier de `Quality`.

- **Forma**: `QuadraticBezierCurve3` entre la carta origen y la destino, con el punto de control
  **colgado** debajo del punto medio (`sag = -0.55` en Y, `z +0.22` para que flote sobre la mesa).
  `TubeGeometry(curve, 24, 0.035, 5, false)` → ~240 triángulos por raíz.
- **Crecer**: la geometría es **indexada**, así que `setDrawRange(0, floor(total * p))` sobre el
  `fxTween(260, …)` la va revelando de punta a punta sin regenerar buffers.
- **Desvanecer**: `opacity = 1 - p` sobre un `fxTween(500, …)` y después libera el slot del pool.
- **`fxTween`, no `setTimeout`**: por eso el crecimiento y el fade se **congelan con el hit-stop**,
  en sintonía con F2.

**`src/render/SceneManager.ts`** (`runScoreStep`): cada paso guarda `lastScoreOrigin` (la
posición mundial de la carta que acaba de puntuar) y, si hay una anterior, pide
`this.mycelium.grow(prev, this, color)` — la raíz une **las cartas JUGADAS en el orden real del
cálculo**, que es la decisión #3. `this.mycelium = new Mycelium()` + `scene.add(group)` en el
constructor y `this.mycelium.dispose()` en `dispose()`.

**Verificación** — `tools/probe-mycelium.mjs` (nuevo, gate): fuerza 20 manos de 5 cartas y mide en
vivo:

| Qué | Resultado |
|---|---|
| Raíces pedidas vs vivas justo después | 8 (tope del pool = 8) |
| Raíces vivas tras el sondeo | **0** (no puede quedar ninguna) |
| Raíces simultáneas (máx) | 8 |
| `drawRange` visto (% del recorrido) | 0 → 100 (la raíz crece de punta a punta) |
| Geometrías GPU | **20 → 20** (no crece con las manos) |
| Errores de consola | ninguno |

El cap de 8 es deliberado (§Riesgos): si una mano larga pide más, la raíz se recorta antes que
asignar geometría por frame. Repetir 20 manos no hace crecer `renderer.info`. **OK MICELIO.**

**Siguiente**: F5 — cierre del combo (hit-stop 90 ms, explosión grande, total dorado, pulso de
fondo usando `bgp` como intensidad del bloom, decisión #6).

### A.14 ✅ F5 implementada — cierre del combo

**Cierre** (`SceneManager.closeCombo`, disparado por el último paso animado de la mano):
1. `hitStop(90)` (no-op con `reduceMotion`): congela TODO, incluido el estallido que sigue —
   es lo que hace que el golpe se "sienta".
2. **Estallido doble** en el centro de la fila de cartas jugadas: `burst(160, dorado)` +
   `burst(80, ember 0xff5a3c)`. El dorado es el `×2` del juego; el ember cálido acompaña.
3. **Pulso de fondo + bloom**: `bgPulse = 1`, que en el loop (`updateComboPulse`) decae con el
   `dt` (así el hit-stop lo congela) y mezcla el color de fondo/niebla hacia un ember sutil
   (`lerp` 0.3) y sube el bloom vía `PostFx.pulseBloom(t*0.5)`.
4. **Acorde final**: `audio.playChord([0,4,7])` (Do-Mi-Sol) — `AudioBus` ganó `playChord` +
   `synthFreq` reutilizable; sin archivo suena con los osciladores de reserva.

**`PostFx`**: `BloomPass.setStrength(v)` + `PostFx.pulseBloom(extra)` (base + extra; no-op si el
bloom está desactivado en calidad baja). Así el `bgp` de A.7 es, además, intensidad del bloom
(decisión #6, misma fase).

**HUD**: el total final del ticker pasa de cian (del demo) a **dorado** `#ffd36b` con glow dorado
(`styles.css` `.score-ticker.is-final .score-ticker-total`) — respeta la decisión #1 (nada de
teal/rojo en los números).

**Verificación** — `tools/probe-closure.mjs` (nuevo, gate): juega una mano de 5 y mide en vivo:

| Qué | Resultado |
|---|---|
| `bgPulse` máximo | 0,85 (cerca de 1; el sampleo lo pesca ya decaído) |
| hit-stop máximo | 0,09 s |
| Desvío de fondo máximo | 0,011 (> 0, el pulso ocurre) |
| Partículas activas máximas | **482** (el estallido de cierre 160+80, muy por encima de un paso) |
| Paso final marcado (HUD) | sí |
| Fondo restaurado | sí (sin tinte permanente) |
| Errores de consola | ninguno |

**Gates (todos verdes, F5)**: typecheck · tests **332/332** · validate · smoke (0/0/0) ·
desktop 6/6 · tablet 5/5 · probe-combo OK · probe-mycelium OK · probe-closure OK.

**Siguiente**: F6 — borrar los pixel-art (`public/fx/`, `.fx-sprite`/`.fx-burst`/`.fx-poison`,
`HUD.effect()` y sus 2 llamadas) cuando el reemplazo esté verificado (decisión #5). Se deja la
`LICENSE.txt` del pack hasta confirmar.

### A.15 ✅ F6 implementada — borrado de los pixel-art

**Hecho** (decisión #5: el reemplazo — el sistema de combo F2-F5 — ya está verificado):

- Borrados `public/fx/fx_burst.webp` y `public/fx/fx_poison.webp` (del *Super Pixel Effects
  Gigapack*).
- Quitadas de `styles.css` las reglas `.fx-sprite` / `.fx-poison` / `.fx-burst` y los
  `@keyframes fx-poison` / `fx-burst` (eran 24 y 9 frames recorridos con `steps()`).
- Eliminado `HUD.effect(x, y, kind)` y sus 2 llamadas en `scoreTick` (la negativa → veneno y la
  bonus → estallido). La negativa ya se lee por el signo `−` en el número; la bonus por el popup
  dorado (`is-bonus`); y el burst de partículas del combo (F3/F5) cubre el estallido. NO se tocó el
  resto del VFX (es 3D).
- **`public/fx/LICENSE.txt` SE MANTIENE** (decisión #5): la atribución del pack. ⚠️ Ya no hay
  assets del pack en el build; conviene revisar si la obligación de atribución aún aplica y, si no,
  borrarla.

**Verificación** (no rompe el flujo de puntaje): `grep -rn "fx_burst\|fx_poison\|fx-sprite" src/`
vacío; typecheck; tests **332/332**; validate; closure OK (0 errores); smoke 0/0/0.

**Estado del plan**: F1-F6 **COMPLETAS**.

### A.10 `prefers-reduced-motion`

El demo usa `fx = 0` para apagar shake y hit-stop. FungiFlush ya tiene el equivalente
(`reduceMotion()` en `anim.ts`, espejo de `settings.reduceMotion` y del media query CSS).

**Alcance**: `shake`, `hitStop` y el pulso del fondo se gatean con `!reduceMotion()`.
Las duraciones ya se acortan solas vía `anim.d()`. Los efectos que **informan** (el popup, el
color, el número) NO se apagan: son información, no decoración.

**Criterio de aceptación**: con movimiento reducido no hay shake, no hay hit-stop, las
secuencias terminan igual y se ve el mismo resultado final.

---

## Parte B — Audio

### B.1 Estado actual (el hueco ya está preparado)

`src/audio/AudioBus.ts` es un **no-op deliberado** con todo cableado:
- `attachAudioHooks()` ya se llama en `main.ts:261`.
- Ya existe el mapa `EVENT_SOUNDS`: `run:start → run_start`, `card:played → card_play`,
  `card:discarded → card_discard`, `score:hand → score_hand`, `money:changed → coin`, etc.
- `play(id)` no hace nada (solo un `console.debug` en dev).
- `setVolume/getVolume/duck/setMuted` existen y **nadie los llama**.

O sea: implementar el audio es **llenar `play()` y agregar archivos**, sin tocar motor,
render ni HUD. Ese fue el diseño y se respeta.

### B.2 Arquitectura propuesta

```
AudioContext (perezoso, se crea en el primer gesto)
  └── masterGain
        ├── sfxGain    ← volumen de "Efectos de sonido"
        └── musicGain  ← volumen de "Música"
              └── MediaElementSource  ← <audio loop> (streaming, sin decodificar 32s en RAM)
```

**Dos caminos, a propósito**:
- **SFX (cortos, <1.5s)**: se decodifican a `AudioBuffer` y se disparan con
  `AudioBufferSourceNode`. Latencia mínima, cero I/O en el momento del tap.
- **Música (loops de 32s)**: va por `<audio loop>` + `MediaElementSource`. Decodificar 32s
  de estéreo 44.1k a float32 ocupa **~11 MB por tema** (22 MB los dos); el streaming evita eso.
- **Fallback sintético**: si un id no tiene archivo, suena el **beep pentatónico del demo**
  (oscilador triangular + envolvente exponencial). Sirve para los eventos que no tienen
  sample (logros, tienda, reroll) y de red de seguridad si un asset no carga.

### B.3 Assets y destino

| Archivo | Formato | Destino | Disparo |
|---|---|---|---|
| `tranquilo_lluviaMenuPrincipal.wav` | 32,0 s · estéreo 44.1k | **Música del MENÚ PRINCIPAL** | `menu` |
| `tranquilo.wav` | 32,0 s · estéreo 44.1k | **Música INGAME** | `blind_select` → `game_over` |
| `descarte/descartar_1..3.wav` | 0,55 s · mono | **SFX descartar 1 carta** | `card:discarded` |
| `descarte/descartar_varias.wav` | 1,32 s · mono | **SFX descartar VARIAS** | `card:discarded` con >1 carta |
| `Cartas seleccion/carta_1..5.wav` | 0,35 s · mono | **SFX seleccionar carta** | `onCardClick` (selección) |

**Variación sin metralleta**: los 3 de descarte y los 5 de selección son variaciones.
Elegir al azar **evitando repetir el último** (si no, con 3 archivos se nota el bucle).

**Destino en el repo**: `public/audio/` (no existe todavía; se crea).

### B.4 ⚠️ El problema de los WAV de 5,6 MB

Cada tema son **5,65 MB**. Los dos = **11,3 MB** de descarga. Para un juego que hoy se
publica en GitHub Pages, es un costo de arranque grande (y en Tauri engorda el bundle).

**Propuesta**: convertir a **OGG Vorbis ~112 kbps** → ~450 KB cada uno (**−92%**). El
proyecto ya tiene el patrón para esto: `npm run art` convierte los PNG con
`tools/optimize_art.py`. Se replica: `audio-source/` (los WAV originales, fuera del build)
→ `npm run audio` → `public/audio/*.ogg` + un `index.json` (mismo patrón que el índice de arte).

**⚠️ Bloqueante real**: **no hay `ffmpeg` en el entorno** (verificado). Hay que:
- **(a)** instalarlo con el gestor de binarios, o
- **(b)** aceptar los WAV como están (11 MB), o
- **(c)** usar otra vía de conversión.
→ Confirmar (§6). Mi recomendación es (a): es una dependencia de build, no de runtime, y
desbloquea también el resto de la cadena de audio.

**Los SFX no tienen problema**: 36-122 KB cada uno. Se pueden dejar en WAV.

### B.5 Música: menú vs ingame

**Alcance**:
- `music:play('menu' | 'ingame')` con **crossfade** de ~600ms (ganancia, no corte seco).
- La música del menú suena en `menu`; la ingame desde `blind_select` hasta `game_over`.
- Al volver al menú, crossfade de vuelta.
- **Pausa real** cuando la pestaña se oculta (`visibilitychange`) — si no, en móvil sigue
  sonando en segundo plano.

**Criterio de aceptación**: pasar menú → partida no corta el audio (hay crossfade); volver al
menú tampoco; ocultar la pestaña lo pausa.

### B.6 🐞 Bug a arreglar: los sliders de volumen no hacen nada

`SettingsScreen.ts:178-179` escribe `sfxVolume`/`musicVolume` en el perfil, y
`ProfileState.ts:238-239` los persiste con defaults 0.8/0.6 — pero **`audio.setVolume()` no
se llama en ningún lado**. Los sliders son decorativos hoy.

**Alcance**: aplicar los volúmenes al arrancar y en cada `onPatch`, y conectarlos a
`sfxGain`/`musicGain`. Es un arreglo de 3 líneas que el audio real vuelve obligatorio.

**Criterio de aceptación**: mover "Efectos de sonido" cambia el volumen de un SFX en vivo;
el valor se mantiene entre sesiones.

### B.7 Autoplay: el primer gesto

Regla del navegador (y el demo lo avisa): el `AudioContext` arranca **suspendido** hasta el
primer gesto del usuario. Como el juego empieza en el menú con un botón, alcanza con:
crear/reanudar el contexto en el primer `pointerdown` y arrancar la música ahí.

**Criterio de aceptación**: sin errores de consola por `AudioContext` suspendido; la música
arranca con el primer tap (no antes, no nunca).

### B.8 ✅ F1 implementada — qué quedó y cómo se verifica

**Cadena de assets** (mismo patrón que `art-source/` + `npm run art`):
- `audio-source/` (**gitignored**) tiene los WAV de origen con nombres estables:
  `music/menu.wav`, `music/ingame.wav`, `sfx/discard_1..3.wav`, `sfx/discard_many.wav`,
  `sfx/select_1..5.wav`.
- `tools/build_audio.py` + **`npm run audio`** → `public/audio/*.ogg` + `index.json`.
- **11,2 MB → 0,78 MB (−93 %)**. Los SFX quedan en ~8-19 KB; los temas en ~312-417 KB.

**`src/audio/AudioBus.ts`** pasó de no-op a real:
- Grafo `ctx → masterGain → (sfxGain | musicGain)`.
- **SFX decodificados** a `AudioBuffer` (9 en memoria, ~110 KB).
- **Música por streaming** (`<audio loop>` + `MediaElementSource`) con **crossfade** de 600 ms.
  El streaming no es un detalle: decodificar 32 s de estéreo a float32 son ~11 MB de RAM por
  tema. Se comprueba en la red: los temas se sirven **206 Partial Content**.
- **Variaciones sin repetir la última** (3 de descarte, 5 de selección).
- **Tanda de descartes**: `discardCards` emite un evento por carta, todos sincrónicos; el
  primer evento arma un timer de 0 ms y al correr ya sabe si fueron 1 o varias → suena
  `discard` o `discard_many`.
- **Beep sintetizado** de reserva para los ids sin archivo (logros, tienda, reroll…), con la
  pentatónica del prototipo. El juego nunca queda mudo por un 404.

**Bug arreglado de paso**: `bindSettingsPatch` (`main.ts:1454`) escribía los volúmenes en el
perfil pero **nadie llamaba a `audio.setVolume`**: los dos sliders de Ajustes eran
decorativos. Ahora se aplican al arrancar y en cada cambio.

**Verificación**: `tools/probe-audio.mjs` (nuevo, sirve de gate). Comprueba que **antes** del
primer gesto no hay contexto (política de autoplay), que **después** está `running` con los 9
SFX decodificados, que el tema del menú suena, que mover el slider cambia la ganancia real
(`0.25` → `sfxGain 0.25`) y que al entrar a partida el crossfade deja `ingame` sonando y
`menu` pausado. Resultado: **OK, 0 errores de consola**.

---

## Orden de implementación

| Fase | Contenido | Por qué en este orden | Riesgo |
|---|---|---|---|
| **F1** | Audio real: bus, SFX, música, sliders (§B.2-B.7) | Independiente de todo lo demás y **el hueco ya está cableado**. Máximo valor por esfuerzo | medio (assets) |
| **F2** | Núcleo de FX: `fxTween`, `sleep`, `hitStop`, un solo reloj (§A.0-A.2) | Es la base de F3-F5: sin esto, las secuencias no se pueden escribir | medio |
| **F3** | Combo: escalado `c`, pop de carta, número flotante con color (§A.5-A.7) | Es el "se siente el combo" y no necesita geometría nueva | bajo |
| **F4** | Micelio (§A.4) | Aislado en su archivo; se puede dejar para el final sin bloquear | bajo |
| **F5** | Cierre + pulso del fondo + bloom (§A.8) | Depende de que F3 ya se sienta bien | medio |
| **F6** | Borrar los pixel-art (§A.9) | **Al final**, cuando el reemplazo ya está verificado | bajo |

## Criterios de aceptación transversales

- `typecheck` · `test` · `validate` · `smoke` (0/0/0) · `shot-desktop` 6/6 ·
  `shot-tablet` 5/5 · `audit-mobile-buttons` exit 0 (los 3 viewports).
- **Rendimiento**: los efectos respetan los tiers de `Quality.ts`. El demo asume una máquina
  de escritorio; el juego apunta a móvil. Con `low` (sin bloom, menos partículas) el combo
  tiene que seguir leyéndose.
- **Sin basura**: repetir 20 manos no debe hacer crecer `renderer.info` (geometrías,
  texturas) ni el DOM de `.hud-popups`.
- **Reduced motion** respetado en shake, hit-stop y pulso.

## Decisiones TOMADAS (2026-10-06)

| # | Decisión de Emanuel | Consecuencia en el plan |
|---|---|---|
| 1 | **Mantener el lenguaje del juego** | Los números van **ámbar = sustrato**, **verde = esporas**, **dorado = ×2**. NO se copia el teal/rojo del demo: el rojo chocaría con el verde de esporas ya aprendido. El dorado para el ×2 es lo único nuevo y es donde aporta. (§A.5) |
| 2 | **Micelio grueso, pero sutil** | **`TubeGeometry`** con radio chico (~0.012-0.018 del ancho de carta), no el `Line` de 1px. Es más caro que una línea, así que **entra al pool de 8** y se construye con pocos segmentos radiales (4-6) y ~24 a lo largo. (§A.4) |
| 3 | **Entre las cartas JUGADAS** | La raíz une las cartas de la zona de juego **en el orden en que puntúan** (el orden real del cálculo), no las de la mano. (§A.4) |
| 4 | **Instalar ffmpeg** | Se instala como **dependencia de build** (aislada en `~/.workbuddy-ai/binaries/ffmpeg/`, sin admin). Habilita `npm run audio` y la conversión a OGG (−92% de peso). (§B.4) |
| 5 | **Confirmar el borrado DESPUÉS** | Los pixel-art se sacan recién en **F6**, cuando el reemplazo esté verificado en juego. La `LICENSE.txt` del pack se queda hasta esa confirmación. (§A.9) |
| 6 | **Bloom en la misma fase** | El pulso del fondo usa `bgp` como intensidad del bloom, dentro de **F5**, no después. (§A.7) |

## Riesgos que quedan

- **Rendimiento**: el demo asume escritorio; el juego apunta a móvil. Los efectos tienen que
  respetar los tiers de `Quality.ts` (con `low` el combo debe seguir leyéndose).
- **`TubeGeometry` en el pool**: es malla, no línea. Si el pool de 8 no alcanza en una mano
  larga, la raíz se recorta antes que asignar geometría por frame.
- **Los dos temas de música**: 5,65 MB cada uno en WAV. Si la conversión falla, el fallback es
  dejarlos tal cual (11,3 MB), que es mucho para el arranque web pero no rompe nada.
