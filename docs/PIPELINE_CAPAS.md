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
5. Refinado opcional con `grabCut` (solo si `use_grabcut` y hay `cv2`).

### Modo `chroma` (arte futuro)

Si se **re-encarga** el arte con fondo plano (magenta `#ff00ff` o verde), `mode: "chroma"`
hace keying por distancia al color clave con rampa suave (`color_tolerance` +
`chroma_softness`) y da recortes de **calidad producción**. Ver §6.

---

## 2. Máscaras automáticas

Con `--debug-masks` el tool escribe en `art-source/layers/_mask/` (gitignored):

- `<stem>_mask_subject.png` — alfa del sujeto (8-bit gris)
- `<stem>_mask_bg.png` — alfa del fondo (complemento)
- `<stem>_overlay.png` — **sujeto en verde sobre el original**, para validar a ojo

Es la herramienta para **calibrar**: correr sobre 3–4 cartas representativas, mirar el
overlay, ajustar `segment_config.json`, repetir.

---

## 3. Aislamiento y recorte de cada capa

- **Fondo (`bg`)** — RGB **rellenado detrás del sujeto** (con `cv2.inpaint`; sin cv2, un
  blur de difusión fuerte). Sin el relleno quedaría el *hueco* del hongo dentro del fondo.
  Alfa = complemento del sujeto. Va a tamaño completo de carta.
- **Sujeto (`subject`)** — original con alfa = máscara, **recortado a su bbox**. Es capa
  chica y centrada: eso es lo que hace barato el parallax. El bbox va al índice.
- **Primer plano (`fg`)** — en modo `teal` se reconstruye un **vignette** (no hay elementos
  reales delante del hongo); en modo `chroma` se keyea un color propio. Puede salir vacío.

---

## 4. Exportación

- **PNG RGBA lossless** por defecto (`out_format: "png"`, prioridad máxima a la calidad).
  `webp` disponible para aligerar el bundle a cambio de compresión con pérdida.
- Naming: `public/art/layers/<stem>__<bg|subject|fg>.png`.
- Índice `public/art/layers/index.json` (lo regenera `genLayerIndex.mjs`, que re-escanea el
  disco y descarta entradas sin archivo: la fuente de verdad son los archivos que existen).
- Hoja de contacto de revisión en `tools/shots/layers-contact-sheet.jpg` (NO en `public/`).

---

## 5. Parámetros (`tools/segment_config.json`)

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

## 6. Re-encargo de arte (para recorte de calidad producción)

Para que la segmentación sea **trivial** en generaciones futuras, pedir al generador:

- **Fondo plano o chroma** (magenta `#ff00ff` o verde) **separado** del sujeto.
- **Sin sombra de contacto** entre el sujeto y el fondo (esa sombra es lo único que
  impide un keying limpio).
- Sujeto **contenido en la banda 18%–62%**.

Con eso, `mode: "chroma"` da recortes limpios y cierra el gap de calidad del dataset
actual (teal, recorte medio).

---

## 7. Integración en el juego

- **`src/render/ArtLayers.ts`** — carga `layers/index.json` y resuelve `layerKeysFor()`
  con la misma cadena que `artKeysFor` (arte propio → par elemento/rareza → common).
- **`src/render/Card3D.ts`** — 4 mallas: `bg` (z = −`CARD_LAYER_GAP`), cara/sujeto (z = 0),
  `fg` (z = +`CARD_LAYER_GAP`) y `top` (texto). El parallax real nace de las capas a
  distinta profundidad.
- **`src/render/CardTexture.ts`** — `createCardLayerCanvas()` compone una capa con su
  bbox registrado; `CardTextureCache.getLayer()` cachea por archivo.
- **`src/ui/cardArt.ts`** — la cara 2D compone las 3 capas antes del texto.

**Respaldo duro**: sin `layers/index.json` o sin entrada para una carta, todo cae a la
ruta de una sola textura. El juego se ve **idéntico** si nadie corre `npm run art:layers`.
