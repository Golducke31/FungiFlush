# Pipeline de capas (segmentación del arte de las cartas)

Convierte cada ilustración en **3 capas con alfa** —fondo, hongo principal y primer
plano— para que la carta se mueva en **parallax** al inclinarse, tanto en el render 3D
como en las caras 2D de tienda/recompensa/colección.

```
art-source/<stem>.png  ──►  segment_card_layers.py  ──►  public/art/layers/<stem>__<capa>.png
                                        │
                                        └──►  public/art/layers/index.json  (genLayerIndex.mjs)
                                                     │
                                    ArtLayers.ts ────┘──►  Card3D / CardTexture / cardArt
```

Comando: **`npm run art:layers`** (= `python tools/segment_card_layers.py && node tools/genLayerIndex.mjs`).

---

## 1. Flujo de segmentación (por qué no es un chroma clásico)

El arte del juego **no tiene fondo plano**. Todas las cartas comparten una escena oscura
teal (`#080b10` → `#0d131b`) con musgo, niebla y un foco de luz vertical; el sujeto vive
en la banda vertical **18%–62%**. Todo es **RGB opaco**.

Medición sobre el dataset (esto es lo que define los umbrales):

| Zona | H | S | V |
|---|---|---|---|
| Fondo teal (arriba, esquinas) | 0.57–0.59 | 0.50–0.69 | **0.08–0.14** |
| Fondo teal (abajo, centro del foco) | 0.49–0.57 | 0.40–0.43 | **0.20–0.28** |
| Cuerpo/cap del hongo | 0.49–0.54 | 0.41–0.67 | **0.19–0.25** |

**Conclusión: un umbral absoluto de H, S o V NO separa el hongo del fondo.** En la línea
*poison* comparten hasta el matiz. Por eso la señal fuerte es el **contraste local**, no
el color absoluto:

1. **Modelo de fondo**: blur gaussiano enorme (`radius ≈ 6%` del lado menor). La escena es
   suave; el hongo es lo que se *desvía* de esa estimación.
2. **Tres señales de sujeto** (basta una):
   - `contrast = V − V_fondo ≥ contrast_min` (el hongo es más claro que su entorno),
   - matiz **fuera** del rango teal con brillo/saturación suficientes (`off_hue`),
   - brillo fuerte **con borde** (`bright & edge`) — el foco de luz es brillante pero
     suave; sin el requisito de borde, el cono de luz entraba como sujeto.
3. **La banda vertical solo VETA** (fuera de ella nunca hay sujeto). Así el 18% de arriba
   y el 38% de abajo quedan planos, como pide el diseño de la carta.
4. **Morfología** (OPEN → CLOSE) + **componentes conexas** (tira motas) + **feather**
   (GaussianBlur sobre la máscara = borde progresivo).
5. **Matting** (ver §2): la máscara pasa a ser un **trimap** y el borde se resuelve con
   pymatting (alpha suave). Sin el backend, este paso es un no-op.
6. Refinado opcional con `grabCut` (solo si `use_grabcut` y hay `cv2`).

### Modo `chroma` (arte futuro)

Si se **re-encarga** el arte con fondo plano (magenta `#ff00ff` o verde), `mode: "chroma"`
hace keying por distancia al color clave con rampa suave (`color_tolerance` +
`chroma_softness`) y da recortes de **calidad producción**. Ver §6.

---

## 2. Matting: alpha suave en el borde (el salto de calidad)

El borde de la máscara binaria es **duro**: en parallax se nota el corte a cuchillo, y el
pelo/pelusa de un hongo no puede representarse con 0 o 255. La solución es **matting**,
usando la máscara heurística como **trimap**:

- `trimap_erode_px` (8) erosiona la máscara → **sujeto seguro** (blanco).
- `trimap_dilate_px` (10) la dilata → **fondo seguro** (negro).
- La **banda** entre ambos (gris) es la zona **incierta**: solo ahí corre el matting.

Restringirlo a la banda no es una optimización menor: el matting (closed-form/KNN) escala con
los píxeles inciertos, y resolver la carta entera costaría segundos. La banda son unos miles
de píxeles, así que sale en décimas de segundo.

**Escalera de respaldo** (`matting_backend`):

1. `pymatting` → `estimate_alpha_cf` (closed-form); si falla, `estimate_alpha_knn`.
2. `cv2.ximgproc.guidedFilter` (guía = luminancia del recorte). Requiere `opencv-contrib`.
3. **Ninguno** → se devuelve la máscara binaria **sin tocar**. La salida es **idéntica** a
   la de antes de esta feature. Es el respaldo duro del pipeline.

Cada paso que falta es un no-op: `npm run art:layers` sigue corriendo con solo
Pillow + NumPy.

### Respaldo ML (`ml_backend`)

Para los casos donde la heurística falla (p. ej. el cono de luz que entra como sujeto), se
puede encender `rembg` (U²-Net / ISNet). El modelo **no reemplaza** la heurística a ciegas:
se compara por **IoU** (`ml_iou_min`, 0.80) y solo se usa si se parece lo suficiente. SAM se
puede enchufar detrás del mismo seam (usar la heurística como prompt). Un backend ausente o
un modelo que falla nunca es fatal.

### Mapa de profundidad (`depth_backend`)

`depth_anything` genera un depth map por carta y la profundidad por capa (mediana sobre el
sujeto) se guarda en `depth`. Sin backend se usa `default_depth` (`bg 0.15 / subject 0.5 /
fg 0.85`). Lo consume el render para el parallax continuo además de las 3 capas.

---

## 3. Máscaras automáticas

Con `--debug-masks` el tool escribe en `art-source/layers/_mask/` (gitignored):

- `<stem>_mask_subject.png` — alfa del sujeto (8-bit gris)
- `<stem>_mask_bg.png` — alfa del fondo (complemento)
- `<stem>_overlay.png` — **sujeto en verde sobre el original**, para validar a ojo
- `<stem>_trimap.png` — **trimap**: blanco = sujeto seguro, negro = fondo seguro, gris =
  banda incierta (donde corre el matting). Es la vista para calibrar `trimap_erode/dilate_px`.

Es la herramienta para **calibrar**: correr sobre 3–4 cartas representativas, mirar el
overlay, ajustar `segment_config.json`, repetir.

---

## 4. Aislamiento y recorte de cada capa

- **Fondo (`bg`)** — RGB **rellenado detrás del sujeto** (con `cv2.inpaint`; sin cv2, un
  blur de difusión fuerte). Sin el relleno quedaría el *hueco* del hongo dentro del fondo.
  Alfa = complemento del sujeto. Va a tamaño completo de carta.
  - **Dilatación**: el hueco se expande `inpaint_dilate_px` (6) px antes de rellenar, para
    que **no queden restos del sujeto** pegados al contorno.
  - **Modo `band`** (`inpaint_mode`): solo se rellenan unos pocos píxeles más allá del borde
    (`inpaint_band_px`); el interior del hueco queda con blur de difusión (tapado por el
    sujeto en la composición). Eso **mata las manchas** del `cv2.inpaint` en huecos grandes.
  - Escalera: LaMa (`inpaint_backend: lama`, inpaint por difusión) → `cv2.inpaint` TELEA →
    blur de difusión.
- **Sujeto (`subject`)** — original con alfa = máscara, **recortado a su bbox**. Es capa
  chica y centrada: eso es lo que hace barato el parallax. El bbox va al índice.
- **Primer plano (`fg`)** — en modo `teal` se reconstruye un **vignette** (no hay elementos
  reales delante del hongo); en modo `chroma` se keyea un color propio. Puede salir vacío.


---

## 5. Exportación

- **PNG RGBA lossless** por defecto (`out_format: "png"`, prioridad máxima a la calidad).
  `webp` disponible para aligerar el bundle a cambio de compresión con pérdida.
- Naming: `public/art/layers/<stem>__<bg|subject|fg>.png`.
- Índice `public/art/layers/index.json` (lo regenera `genLayerIndex.mjs`, que re-escanea el
  disco y descarta entradas sin archivo: la fuente de verdad son los archivos que existen).
- Hoja de contacto de revisión en `tools/shots/layers-contact-sheet.jpg` (NO en `public/`).

### Esquema del índice (por carta)

```json
{
  "size": [512, 744],
  "subject": { "bbox": [x, y, w, h] },
  "coverage": { "subject_px": 12345, "total_px": 380928 },
  "depth":  { "bg": 0.15, "subject": 0.5, "fg": 0.85 },
  "motion": {
    "bg":      { "amp": 0.006, "speed": 0.35, "noise": 0.004 },
    "subject": { "amp": 0.010, "speed": 0.60, "noise": 0.006 },
    "fg":      { "amp": 0.008, "speed": 0.45, "noise": 0.003 }
  },
  "files": { "bg": "<stem>__bg.png", "subject": "<stem>__subject.png", "fg": "<stem>__fg.png" }
}
```

- **`depth`** (0–1) — profundidad relativa por capa. `0` = fondo lejano, `1` = primer plano.
- **`motion`** — `amp` = amplitud del vaivén (fracción del ALTO), `speed` = velocidad del
  ciclo, `noise` = amplitud de la distorsión UV.

⚠️ **`genLayerIndex.mjs` RE-CONSTRUYE cada entrada**: cualquier campo nuevo hay que copiarlo
explícitamente en el `??=` (hoy pasa `size/subject/coverage/depth/motion`). Si no, se pierde
en silencio en la siguiente corrida de `art:layers`.

---

## 6. Movimiento (idle + distorsión + esporas)

Tres niveles, todos leídos de `index.json` (números por carta, sin tocar código):

1. **Idle / respiración** (`Card3D.updateLayerIdle`) — cada capa oscila en posición (bob
   vertical) y escala con `sin(time * speed + phase)`. La `phase` sale de un hash del stem,
   así que las cartas **no respiran al unísono**. Se acota a ±2% del alto (`LAYER_IDLE_CLAMP`).
   Solo escribe transforms **locales** de la malla (nunca `home.*`, que es de los tweens).
2. **Distorsión UV por shader** (`onBeforeCompile` en `Card3D.layerMaterial`) — se desplazan
   las UV con ruido (`uv += noise * uAmp`). Se inyecta en el `MapStandardMaterial` (se
   **conserva la luz**) parcheando el chunk `#include <map_fragment>`; `uAmp` sale de
   `motion.noise`. En el fondo da el ondulado de humo/niebla; el sujeto también puede ondular.
   ⚠️ El parche va en **try/catch**: si el chunk no matchea (otra versión de three), el
   material queda **exactamente** como antes en vez de romper.
3. **Partículas entre capas** (`src/render/Particles.ts` · `CardSporeField`) — un `Points`
   con esporas a profundidad intermedia (entre la cara y el `fg`). Es un campo 100% GPU
   (buffers escritos una vez, movimiento en el vertex shader) parentado al `group` de la
   carta, así que **hereda el tilt**. Son 12 por carta y solo se encienden en la carta
   **hero / hover / selección** → 1 draw call por carta ACTIVA. Es lo que más cambia la
   sensación de profundidad.

---

## 7. Parámetros (`tools/segment_config.json`)

| Parámetro | Default | Qué controla |
|---|---|---|
| `mode` | `teal` | `teal` (dataset actual) / `chroma` (fondo plano) |
| `chroma_color` | `#ff00ff` | Color clave en modo chroma |
| `color_tolerance` | 18 | Radio del keying cromático |
| `chroma_softness` | 10 | Ancho de la transición (borde suave) |
| `teal_h_range` | `[0.47,0.60]` | Matiz del fondo teal |
| `s_bg_max` / `v_bg_max` | 0.45 / 0.24 | Saturación/luminancia del fondo |
| `contrast_min` | 0.055 | **Desvío mínimo vs. el fondo difuso** (señal principal) |
| `edge_min` | 0.08 | Gradiente mínimo para que un brillo cuente como sujeto |
| `v_off_hue_min` / `s_off_hue_min` | 0.35 / 0.15 | Umbrales del matiz no-teal |
| `v_subject_min` / `s_subject_min` | 0.55 / 0.62 | Brillos fuertes directos |
| `subject_band` | `[0.16,0.66]` | Banda vertical (SOLO veta) |
| `feather_px` | 2.5 | Suavizado de borde |
| `grow_px` / `shrink_px` | 1 / 1 | Dilatación/erosión previa (evita halo de fondo) |
| `morph_kernel` | 5 | Kernel de OPEN/CLOSE |
| `min_component_area` | 0.004 | Área mínima de una isla |
| `bg_fill_diffuse` | 28 | Radio de difusión para tapar el hueco del fondo |
| `use_grabcut` | false | Refinado de bordes con cv2 (lento) |
| `matting_backend` | `pymatting` | `none` / `pymatting` / `guided` (auto-degrada) |
| `matting_band_only` | true | Matting solo en la banda incierta del trimap |
| `trimap_erode_px` / `trimap_dilate_px` | 8 / 10 | Ancho del sujeto seguro / fondo seguro |
| `matting_max_side` | 512 | Límite del lado mayor de la región a matting |
| `ml_backend` | `none` | `none` / `rembg` (SAM detrás del mismo seam) |
| `ml_iou_min` | 0.80 | IoU mínimo para aceptar la máscara del modelo |
| `inpaint_backend` | `cv2` | `cv2` / `lama` |
| `inpaint_dilate_px` | 6 | Expande el hueco antes de rellenar (4–8) |
| `inpaint_mode` | `band` | `band` (pocos px más allá del borde) / `full` |
| `inpaint_band_px` | 6 | Ancho de la banda a rellenar en modo `band` |
| `depth_backend` | `none` | `none` / `depth_anything` |
| `default_depth` | `{bg,subject,fg}` | Fallback de profundidad por capa |
| `default_motion` | `{bg,subject,fg}` | Fallback de movimiento idle por capa |

### Casos problemáticos

| Caso | Por qué | Mitigación |
|---|---|---|
| Hongo oscuro sobre fondo oscuro | Comparten V (y en poison, hasta H) | Contraste local + `off_hue` + `grabCut` |
| Cono de luz del foco | Brillante y suave → parecía sujeto | `bright & edge` (exige borde) |
| Rim light / glow del hongo | El halo no es teal puro | `grow_px` + `v_subject_min` lo anexa al sujeto |
| Musgo que se extiende | ¿fondo o primer plano? | `moss_as` configurable |
| Fondo con gradiente | El teal varía en vertical | `v_bg_max` 0.24 cubre el gradiente + contraste local |
| Esporas / partículas | Islas chicas | `min_component_area` |
| Bordes dentados | Máscara discreta | `feather_px` |
| Halo de fondo pegado al contorno | Píxel de borde mezcla sujeto+fondo | `shrink_px` antes del feather |
| Jokers | No tienen arte propio | El tool los salta; el render usa la ruta procedural |
| WebP con alfa en WebView viejo | Soporte irregular | Default PNG |

---

## 8. Re-encargo de arte (para recorte de calidad producción)

Para que la segmentación sea **trivial** en generaciones futuras, pedir al generador:

- **Fondo plano o chroma** (magenta `#ff00ff` o verde) **separado** del sujeto.
- **Sin sombra de contacto** entre el sujeto y el fondo (esa sombra es lo único que
  impide un keying limpio).
- Sujeto **contenido en la banda 18%–62%**.

Con eso, `mode: "chroma"` da recortes limpios y cierra el gap de calidad del dataset
actual (teal, recorte medio).

---

## 9. Integración en el juego

- **`src/render/ArtLayers.ts`** — carga `layers/index.json` y resuelve `layerKeysFor()`
  con la misma cadena que `artKeysFor` (arte propio → par elemento/rareza → common).
  Expone `depth`/`motion`/`phase` por carta, con **defaults de módulo** si el índice es
  viejo (parseo defensivo: `Number.isFinite` campo a campo).
- **`src/render/Card3D.ts`** — 4 mallas: `bg` (z = −`CARD_LAYER_GAP`), cara/sujeto (z = 0),
  `fg` (z = +`CARD_LAYER_GAP`) y `top` (texto). El parallax real nace de las capas a
  distinta profundidad. Sobre eso: idle (`updateLayerIdle`), distorsión UV
  (`onBeforeCompile`) y esporas locales (`CardSporeField`). Ver §6.
- **`src/render/Particles.ts`** — `AmbientSporeField` (fondo de escena) y `CardSporeField`
  (esporas locales de una carta, parentadas a su `group`).
- **`src/render/Shaders.ts`** — `CARD_SPORE_VERT/FRAG` + `createCardSporeMaterial()`.
- **`src/render/CardTexture.ts`** — `createCardLayerCanvas()` compone una capa con su
  bbox registrado; `CardTextureCache.getLayer()` cachea por archivo. La cara 2D (tienda,
  recompensa, colección) queda **estática**: el idle/distorsión son solo del render 3D.
- **`src/ui/cardArt.ts`** — la cara 2D compone las 3 capas antes del texto.

**Respaldo duro**: sin `layers/index.json` o sin entrada para una carta, todo cae a la
ruta de una sola textura. El juego se ve **idéntico** si nadie corre `npm run art:layers`.
