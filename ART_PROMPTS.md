# FungiFlush — Catálogo de arte: 40 ilustraciones + 25 iconos

> **Qué es este documento.** El plan de generación del arte que falta, con un prompt
> individual, completo y listo para pegar, por cada uno de los 64 assets. No es una guía
> de estilo: es el contrato de producción. Cada prompt se puede copiar y ejecutar sin leer
> nada más.
>
> **Estado:** **las 40 ilustraciones están generadas e integradas** (ver §0.4 para el método
> real que las produjo) y los 25 iconos SVG también. Este documento sigue siendo el contrato
> de contenido: los sujetos, la composición, la paleta y los lotes no cambiaron. Lo que sí
> cambió es **cómo se genera el estilo** — leer §0.4 antes de generar cualquier asset nuevo.
>
> **Los prompts están en inglés** (los modelos de imagen rinden mejor así, y el catálogo
> original del plan ya venía en inglés); las instrucciones y el resto del documento, en
> español.

---

## 0. Cómo usar este documento

### 0.4 El método real de generación (esto invalida el `STYLE CORE` de §2.1)

Las 40 ilustraciones se generaron con **imagen-a-imagen**, no con texto-a-imagen. No es un
detalle: **texto-a-imagen no reproduce el estilo del juego.** Se probó (piloto A/B sobre
`decay_common`) y el resultado fue una ilustración **fotorrealista tipo render 3D** — musgo
detallado, hierba, luz volumétrica— que rompe por completo la guía de estilo, mientras que la
misma escena por imagen-a-imagen salió con el contorno grueso, el charco de musgo elíptico y
el haz de luz del resto del set.

**El método que funciona, paso a paso:**

1. **Ancla:** `art-source/art_card_<elemento>_common.png`. Los `common` son el ancla de su
   propia familia; las 8 familias se anclaron en `art_card_poison_common.png` (una de las que
   ya existía) para que todas salieran del mismo linaje.
2. **`input_fidelity: medium`.** Con `high` se queda con el sujeto de la referencia; con `low`
   se va al fotorrealismo del punto anterior.
3. **El prompt dice dos cosas:** (a) *"Keep the EXACT rendering style of the reference image:
   same clean digital illustration look, same thick dark outline, same smooth airbrushed
   shading, same vertical shaft of light descending from the top centre, same dark mossy
   ground ellipse and low mist, same near-black teal background, same matte finish, same thin
   bright rim glow hugging the silhouette"* y (b) *"REPLACE the subject with: <sujeto>"*.
4. **Cambiar el acento por nombre y por hex**: *"Change the accent colour from acid green to
   rust-brown (#c1683a)"*. Sin esto el ancla contagia su paleta.
5. **Recordar la rareza explícitamente** (el ancla es un `common`, así que arrastra hacia lo
   simple): *"Rarity legendary: golden-amber rim light, halo bloom, faint concentric rings"*.
6. **Resolución:** 1024×1536 (2:3). El script la recorta a 512×744.

**El estilo observado, para prompts nuevos** (esto es lo que reemplaza al `STYLE CORE` de
§2.1, que describía un flat vector con grano que **no** es lo que hay):

```text
Clean digital illustration, smooth airbrushed shading, minimal surface texture, no film
grain, never photorealistic. One vertical shaft of light descends from the top centre behind
the subject. Subject centred, thick dark outline, glossy highlight dots, a thin bright rim
glow hugging the silhouette. Deep near-black teal background (#080b10 to #0d131b), a dark
mossy ground ellipse with a few grass tufts and a faint low mist at the ground line. Very
limited palette: the background plus ONE accent colour. Matte finish. No text, no frame.
```

**Presupuesto real:** 3 variantes por slot serían 120 generaciones. Con el método de ancla
alcanzó con **1 por slot** (más 2 del piloto y 1 regeneración), porque el ancla fija el estilo
y solo hay que acertar el sujeto.


### 0.1 El circuito completo, de la imagen al juego

| Paso | Qué hacés | Comando / destino |
| --- | --- | --- |
| 1 | Generás la imagen con el prompt del slot | 2:3 vertical (ver §1.2), PNG |
| 2 | La nombrás **exactamente** como el slot | `art-source/art_card_<elemento>_<rareza>.png` |
| 3 | La optimizás (recorta a 512×744 + WebP) | `python tools/optimize_art.py` |
| 4 | Regenerás el manifiesto | `node tools/genArtIndex.mjs` |
| 5 | Verificás en el juego | `npm run dev` |
| 6 | (Opcional) Revisar el set completo de un vistazo | `public/art/_contact_sheet.jpg` (lo genera el paso 3) |

Los pasos 3 y 4 juntos son `npm run art`. El 4 solo es `npm run art:index`.

**Requisito de Python:** `Pillow` (12.3 ya instalado en el venv administrado,
`~/.workbuddy-ai/binaries/python/envs/default`). Si corrés desde otro intérprete:
`pip install Pillow`.

### 0.2 Tres reglas que no se negocian

1. **El nombre del archivo ES la clave.** `art_card_crystal_mythic.png` → clave
   `card_crystal_mythic`. Un typo (un guion de más, `mythical` en vez de `mythic`) no rompe
   nada: la carta cae al respaldo **en silencio** y vas a creer que la imagen no te gustó.
   Verificá con `npm run art:index` que el archivo entró.
2. **No hace falta tener los 40 para shipear.** La cadena de respaldo
   (`card_<elem>_<rar>` → `card_<elem>_common` → los 11 viejos → dibujo procedural) hace que
   el juego sea jugable y vendible en cualquier punto intermedio. **Generá por lotes**
   (§7), no de a 40.
3. **Una imagen por archivo, sin texto horneado.** El nombre de la carta, los chips de
   estadísticas y la descripción los dibuja el canvas encima. Si el arte trae texto, se
   superpone al texto real.

### 0.3 Cómo se leen las fichas de cada slot

```
#### NN · art_card_<elemento>_<rareza>
Ancla      qué carta real usa este slot (o "libre" si hoy no lo usa ninguna)
Clave      los 4-6 elementos que TIENEN que estar en la imagen
PROMPT     bloque listo para pegar (incluye el negativo al final)
```

El bloque `PROMPT` es autocontenido: no hay que pegarle nada antes. Si preferís componer a
mano, en §2 están los bloques `STYLE CORE` / `NEGATIVE CORE` por separado.

---

## 1. El sistema visual (el contrato común)

Todo lo de esta sección está extraído del código, no inventado: si un color no coincide con
`src/render/palette.ts`, el halo de la carta en 3D y la ilustración van a discutir.

### 1.1 Paleta bloqueada

**Fondo (siempre, en las 64 piezas):** `#080b10` (negro-índigo de la escena) y `#0d131b`
(cuerpo de la carta). Son el `background` de la escena y el `panel-solid` del HUD.

**Acento por elemento** — es el color del halo, del anillo y de los chips en el juego, así
que la ilustración **tiene** que estar iluminada con él:

| Elemento | Hex | Nombre | Temperatura |
| --- | --- | --- | --- |
| `neutral` | `#9aa5b1` | gris-azulado | frío neutro |
| `poison` | `#8ce63f` | lima ácido | frío tóxico |
| `spore` | `#f2c14e` | ámbar | cálido |
| `decay` | `#c1683a` | óxido | cálido |
| `symbiosis` | `#4fd18b` | menta | frío vivo |
| `crystal` | `#5fd8e8` | cian | frío |
| `mycelium` | `#a78bfa` | violeta | frío |
| `parasite` | `#e05c8a` | magenta | cálido hostil |

**Acento por rareza** — es el color del borde de la carta y del brillo del halo:

| Rareza | Hex | Cómo entra en la imagen |
| --- | --- | --- |
| `common` | `#8a94a6` | no entra: la rareza común no agrega luz |
| `uncommon` | `#4fc3f7` | rim light cian frío |
| `rare` | `#b388ff` | núcleo violeta + viñeta profunda |
| `legendary` | `#ffc857` | rim light ámbar-oro + halo bloom |
| `mythic` | `#ff5c8a` | iridiscencia doble (magenta + el acento del elemento) |

**Regla de choque cromático:** cuando el acento del elemento y el de la rareza son el mismo
matiz (`spore` ámbar vs `legendary` oro, `parasite` magenta vs `mythic` magenta), **el
elemento manda en el sujeto y la rareza manda en la luz de contorno**. Nunca los dos en el
mismo plano, o la rareza deja de leerse.

### 1.2 Composición: la banda 18%–62% (esto es lo más importante del documento)

El canvas de la carta es **512×744** (relación 2:3) y el arte nuevo es 512×744 también, así
que la ilustración entra **a sangre, sin recorte**. Pero el canvas dibuja encima:

```
y=0      ┌──────────────────────────────┐
         │  ETIQUETA DE ELEMENTO        │  ← 18% de la altura (134 px en 512×744)
         │  NOMBRE DE LA CARTA          │     el arte acá se tapa
y=134    ├──────────────────────────────┤
         │                              │
         │   ★ SUJETO AQUÍ ★            │  ← banda útil: 18%–62%
         │                              │     (y 134–461 px = 327 px de alto)
y=461    ├──────────────────────────────┤
         │  CHIPS · DESCRIPCIÓN         │  ← 38% de la altura (283 px)
         │                              │     el arte acá se tapa
y=744    └──────────────────────────────┘
```

En el archivo de origen la banda es **del 18% al 62% de la altura**, sea cual sea la
resolución: y 268–922 px en un origen de 1024×1488, o y 228–784 px en uno de 848×1264. Lo que
importa son los porcentajes, no los píxeles.

> **Sobre la proporción exacta.** La carta es **512×744 = 1:1.453**, no 2:3 (1:1.500). El
> generador devuelve 2:3 (848×1264 es su bucket habitual), así que el script **recorta 1,3%
> arriba y 1,3% abajo** para encajarla, en vez de deformarla (`fit()` en
> `tools/optimize_art.py`). Ese recorte no toca la banda del sujeto. Cualquier proporción
> razonable entra sin problema; lo que no hay que hacer es generarlas apaisadas.

Traducción a instrucciones de composición:

- **El sujeto vive entero entre el 18% y el 62% de la altura.** Ni la punta del sombrero ni
  la base del tallo pueden cruzar esos límites.
- **El tercio inferior tiene que quedar oscuro y sin detalle:** ahí van los chips de
  estadísticas y la descripción sobre un degradado.
- **La franja superior también:** ahí va el nombre.
- **El fondo sí llega a los cuatro bordes** (full-bleed). No hay marco, no hay ventana
  interior, no hay esquinas redondeadas dentro de la imagen: el marco lo pone la carta 3D.
- **Margen lateral del 10%** para el sujeto, y silueta legible a **96 px de ancho**.
- Composición **vertical y simétrica en el eje X** (el sujeto centrado). La cámara mira la
  mesa en ángulo, así que una composición descentrada se lee torcida.

### 1.3 Las 5 rarezas son un TRATAMIENTO, no un sujeto

Este es el error que arruina el set completo: si cada rareza cambia de especie, el jugador
no aprende a leer el elemento. **La especie la define el elemento. La rareza define cuánta
luz, cuánto detalle y cuánta ceremonia.**

| Rareza | Formas | Luz | Partículas | Ocupación de la banda | Ceremonia |
| --- | --- | --- | --- | --- | --- |
| `common` | ≤3 formas planas | un solo glow de acento | ninguna | ~55% | ninguna |
| `uncommon` | 4–6 formas, 1 gradiente | rim light suave | unas motas | ~62% | leve asimetría |
| `rare` | capas + detalle de laminillas | núcleo bioluminiscente fuerte | motas + viñeta | ~70% | formas secundarias detrás |
| `legendary` | ornamento, detalle fino | rim ámbar-oro + halo bloom | anillos concéntricos | ~75% | anillos detrás del sujeto |
| `mythic` | máximo detalle | iridiscencia doble + glow volumétrico | anillo rúnico flotante | ~80% | claroscuro dramático |

**Corolario de producción:** generá las 5 rarezas de un elemento **en la misma sesión y con
la misma semilla base**, cambiando solo el bloque de rareza. Así el `common` y el `mythic`
del mismo elemento se leen como el mismo hongo en dos momentos, no como dos ilustraciones
distintas.

### 1.4 Luz, cámara y atmósfera

- **Una sola fuente de luz**, desde arriba y ligeramente por detrás del sujeto: el glow
  emana del propio hongo (es bioluminiscente). Nada de luz frontal plana.
- **Sombra de contacto** corta y difusa en la base del sujeto: es lo que lo apoya en el
  suelo. Sin ella el hongo flota.
- **Suelo:** musgo, corteza o tierra húmeda oscura, apenas sugerida en la parte baja de la
  banda. Nunca un piso detallado: compite con los chips.
- **Atmósfera:** neblina baja muy sutil, apenas un velo. Si hay demasiada, la silueta a
  96 px se pierde.
- **Terminación mate.** El juego es `MeshStandardMaterial` con roughness 0.58: nada de
  reflejos especulares duros ni look de render 3D brillante.

### 1.5 Prohibiciones (lo que NUNCA va en una imagen)

`text, letters, numbers, watermark, signature, logo, frame, border, UI mockup, card
template, rounded inner panel, photorealistic photo, harsh specular highlights, glossy 3D
render look, multiple unrelated subjects, busy background, drop shadows behind the whole
image, human figures, hands, faces, insects with eyes (except the parasite element where the
host is a featureless husk)`

Dos de estas merecen explicación porque son las que más se cuelan:

- **`card template` / `frame` / `border`**: los modelos, ante "mushroom card art", dibujan
  una carta con marco. El marco lo pone la geometría 3D; si el arte trae uno, se ve doble.
- **`hands` / `human figures`**: aparece solo, y en un deckbuilder el sujeto tiene que ser
  el hongo.

### 1.6 Coherencia entre las 40 (7 reglas de producción)

1. **Mismo bloque `STYLE CORE` en las 40** (está incluido dentro de cada prompt, pero no
   cambies su redacción).
2. **Misma semilla base por elemento** (las 5 rarezas comparten semilla; los 8 elementos
   usan 8 semillas distintas).
3. **Misma cámara:** sujeto centrado, vista a la altura del sombrero, sin picado ni
   contrapicado.
4. **Misma distancia:** el sujeto ocupa la banda, no "más grande" en las raras. La rareza
   agrega detalle y luz, **no zoom**.
5. **Mismo suelo** en las 8 familias (musgo/tierra húmeda oscura), para que las cartas
   puedan estar en la mano al mismo tiempo sin parecer de juegos distintos.
6. **3 variantes por slot, se elige 1.** Presupuestá 120 generaciones para 40 slots.
7. **Revisión a 96 px antes de aceptar.** Si la silueta no se lee ahí, no importa lo linda
   que esté a 1024: en la mesa la carta mide ~110 px de ancho en un celular.

### 1.7 Coherencia con los iconos (§5)

Las ilustraciones y los iconos comparten **paleta y nada más**. Las reglas son distintas a
propósito:

| | Ilustración | Icono |
| --- | --- | --- |
| Formato | WebP raster | SVG vectorial |
| Color | acento del elemento, bloqueado | **monocromo** (`currentColor`) |
| Detalle | pictórico, con atmósfera | trazo de 2 px, sin atmósfera |
| Lectura | a 96 px de ancho | a **16 px** |
| Rareza | tratamiento visible | no existe |

Un icono con dos colores no se puede tintar por CSS y rompe el sistema. Un icono con
atmósfera se convierte en una mancha a 16 px.

---

## 2. Bloques base (para componer a mano)

Si preferís escribir tus propios prompts, pegá estos dos bloques y agregá sujeto +
tratamiento de rareza + composición.

### 2.1 `STYLE CORE` (literal) — **corregido**

> La versión original de este bloque decía "flat vector illustration with subtle film grain".
> **Era incorrecta**: lo que hay en disco es una ilustración digital limpia y lisa, sin grano.
> Este es el bloque que hay que usar.

```text
Clean digital illustration, smooth airbrushed shading, minimal surface texture, no film
grain, never photorealistic. One vertical shaft of light descends from the top centre behind
the subject. Subject centred, thick dark outline, glossy highlight dots, a thin bright rim
glow hugging the silhouette. Deep near-black teal background (#080b10 to #0d131b), a dark
mossy ground ellipse with a few grass tufts and a faint low mist at the ground line. Very
limited palette: the background plus ONE accent colour. Matte finish.
```

Y se combina con §0.4: en la práctica el estilo **no se describe, se hereda** por
imagen-a-imagen desde el `common` de la familia.

### 2.2 `NEGATIVE CORE` (literal)

```text
text, letters, numbers, watermark, signature, logo, frame, border, card template, UI mockup,
rounded inner panel, photorealistic, photograph, glossy 3D render, harsh specular highlights,
multiple unrelated subjects, busy background, humans, hands, faces, blurry, low contrast
```

### 2.3 `COMPOSITION CORE` (literal)

```text
Vertical 2:3 composition, 1024x1488. The subject occupies only the band from 18% to 62% of
the image height (y 268 to y 922); the top 18% and the bottom 38% stay dark, empty and free
of detail. Background bleeds to all four edges with no inner panel and no rounded frame.
Subject horizontally centred with a 10% side margin, silhouette clearly readable at 96px
wide.
```

### 2.4 Tratamiento por rareza (literal)

```text
common     → one specimen, three flat shapes or fewer, a single accent glow, no particles,
             muted desaturated palette, subject fills about 55% of the band.
uncommon   → one specimen, two-tone gradient, mild rim light, a few floating spore specks,
             slight asymmetry, subject fills about 62% of the band.
rare       → rich layered detail, strong bioluminescent core, particle motes, deep vignette,
             teal-indigo contrast, secondary shapes behind the subject, fills about 70%.
legendary  → ornate composition, golden-amber rim light, halo bloom, intricate gill detail,
             faint concentric rings behind the subject, fills about 75% of the band.
mythic     → maximal detail, dual-colour iridescent bioluminescence, volumetric glow,
             floating rune-like spore ring, dramatic chiaroscuro, fills about 80%.
```

---

## 3. Las 40 ilustraciones

Numeradas **01–40** y agrupadas por elemento, para poder generar una familia entera de una
sentada (las 5 rarezas del mismo elemento, con la misma semilla, seguidas). El orden de los
elementos es el canónico de `ArtAssets.ts` —`neutral poison spore decay symbiosis crystal
mycelium parasite`— **con `neutral` movido al final**: es la única familia que hoy no usa
ninguna carta, así que va después de todo lo demás (§3.8).

El número de la ficha es el orden de generación recomendado; el nombre del archivo no lleva
número. Los lotes de §7 agrupan estos 40 por impacto, no por este orden.

### 3.1 Elemento `poison` — lima ácido `#8ce63f`

**Sujeto canónico:** amanitas tóxicas de capa cerosa con restos de velo.
**Quién lo usa hoy:** 5 cartas (común, 2 poco comunes, legendaria, mítica).
**El peligro de esta familia:** el lima ácido es un color que enloquece rápido. Tiene que
quedar en **el glow y las gotas**, nunca en la capa entera, o la carta parece radiactiva en
vez de venenosa.

---

#### 01 · `art_card_poison_common`
**Ancla:** *Amanita Tóxica* (`amanita_toxica`) — **este es el slot más importante de los 40.**
**Elemento clave:** capa verde-salvia cerosa y lisa · tres restos blancos de velo · tallo
blanco corto y grueso · glow lima filtrándose bajo el borde de la capa · musgo oscuro
**Nota de producción:** la rareza `common` es el respaldo de **todas** las cartas del
elemento, así que esta imagen se va a ver más que ninguna otra. Priorizá la silueta.

```text
Bioluminescent mycology game art, flat vector illustration with subtle film grain, matte
finish, no glossy 3D render look. Palette: deep indigo-teal ground #080b10 to #0d131b with
acid-lime #8ce63f accents. Single bioluminescent light source above and slightly behind the
subject, short soft contact shadow, damp dark moss ground, faint low fog, crisp 2px darker
outline on focal shapes, high contrast when scaled to 200px. SUBJECT: a small toxic amanita
standing alone on dark moss, a smooth waxy sage-green cap with three white veil flecks, a
short stout white stem, a faint acid-lime glow leaking from under the cap edge. RARITY
common: three flat shapes or fewer, a single accent glow, no particles, muted desaturated
palette, subject fills about 55% of the band. COMPOSITION: vertical 2:3, 1024x1488; the
subject occupies only the band from 18% to 62% of the image height (y 268 to y 922), the top
18% and the bottom 38% stay dark, empty and free of detail; full-bleed background with no
inner panel and no frame; subject centred with a 10% side margin, silhouette readable at
96px wide. NEGATIVE: text, letters, numbers, watermark, signature, logo, frame, border, card
template, UI mockup, rounded inner panel, photorealistic, photograph, glossy 3D render,
harsh specular highlights, multiple unrelated subjects, busy background, humans, hands,
faces, blurry, low contrast
```

---

#### 02 · `art_card_poison_uncommon`
**Ancla:** *Amanita Pantera* (`amanita_pantherina`) y *Amanita Suprema*
(`amanita_apex_toxica`) — las dos cartas poco comunes del elemento.
**Elemento clave:** capa pardo-oliva con verrugas blancas irregulares · anillo en el tallo ·
vapor lima rizándose desde las laminillas · una grieta en el borde de la capa · segundo hongo
pequeño al lado

```text
Bioluminescent mycology game art, flat vector illustration with subtle film grain, matte
finish, no glossy 3D render look. Palette: deep indigo-teal ground #080b10 to #0d131b with
acid-lime #8ce63f accents. Single bioluminescent light source above and slightly behind the
subject, short soft contact shadow, damp dark moss ground, faint low fog, crisp 2px darker
outline on focal shapes, high contrast when scaled to 200px. SUBJECT: a panther cap amanita,
an olive-brown cap dusted with irregular white warts, a slender ringed stem, sickly lime
vapour curling off the gills, one clean split in the cap edge, a second much smaller cap
beside it. RARITY uncommon: two-tone gradient, mild cyan rim light, a few floating spore
specks, slight asymmetry, subject fills about 62% of the band. COMPOSITION: vertical 2:3,
1024x1488; the subject occupies only the band from 18% to 62% of the image height (y 268 to
y 922), the top 18% and the bottom 38% stay dark, empty and free of detail; full-bleed
background with no inner panel and no frame; subject centred with a 10% side margin,
silhouette readable at 96px wide. NEGATIVE: text, letters, numbers, watermark, signature,
logo, frame, border, card template, UI mockup, rounded inner panel, photorealistic,
photograph, glossy 3D render, harsh specular highlights, multiple unrelated subjects, busy
background, humans, hands, faces, blurry, low contrast
```

---

#### 03 · `art_card_poison_rare`
**Ancla:** **slot libre** (ninguna carta lo usa hoy; reservado para la próxima expansión de
veneno).
**Elemento clave:** velo membranoso desgarrado en jirones · gotas ácido-lima perladas en el
borde de la capa · una segunda capa pequeña brotando de la base del tallo · tres filamentos
finos subiendo · viñeta profunda

```text
Bioluminescent mycology game art, flat vector illustration with subtle film grain, matte
finish, no glossy 3D render look. Palette: deep indigo-teal ground #080b10 to #0d131b with
acid-lime #8ce63f accents. Single bioluminescent light source above and slightly behind the
subject, short soft contact shadow, damp dark moss ground, faint low fog, crisp 2px darker
outline on focal shapes, high contrast when scaled to 200px. SUBJECT: a mid-transformation
amanita, its membranous veil torn into hanging shreds, acid-lime droplets beading along the
cap rim, a second smaller cap budding from the base of the stem, three thin filaments
reaching upward, layered gill detail visible under the torn veil. RARITY rare: rich layered
detail, strong bioluminescent core, particle motes, deep vignette, teal-indigo contrast,
secondary shapes behind the subject, subject fills about 70% of the band. COMPOSITION:
vertical 2:3, 1024x1488; the subject occupies only the band from 18% to 62% of the image
height (y 268 to y 922), the top 18% and the bottom 38% stay dark, empty and free of detail;
full-bleed background with no inner panel and no frame; subject centred with a 10% side
margin, silhouette readable at 96px wide. NEGATIVE: text, letters, numbers, watermark,
signature, logo, frame, border, card template, UI mockup, rounded inner panel,
photorealistic, photograph, glossy 3D render, harsh specular highlights, multiple unrelated
subjects, busy background, humans, hands, faces, blurry, low contrast
```

---

#### 04 · `art_card_poison_legendary`
**Ancla:** *Oronja Verde* (`death_cap`).
**Elemento clave:** capa ancha verde-oliva con estrías radiales tenues · falda membranosa ·
copa de volva blanca profunda en la base · charco de luz verde pálida alrededor · rim light
ámbar-oro en el borde de la capa
**Ojo con el choque cromático:** el oro de `legendary` tiene que ir **solo en el contorno**;
el cuerpo sigue siendo verde-oliva.

```text
Bioluminescent mycology game art, flat vector illustration with subtle film grain, matte
finish, no glossy 3D render look. Palette: deep indigo-teal ground #080b10 to #0d131b with
acid-lime #8ce63f accents. Single bioluminescent light source above and slightly behind the
subject, short soft contact shadow, damp dark moss ground, faint low fog, crisp 2px darker
outline on focal shapes, high contrast when scaled to 200px. SUBJECT: a death cap amanita,
a broad olive-green cap with faint radial streaks, a membranous skirt hanging from the stem
and a deep white volva cup at the base, standing in a pool of pale green light, ornate
composition with intricate gill detail. RARITY legendary: golden-amber rim light strictly on
the silhouette, halo bloom behind the cap, faint concentric rings behind the subject, fine
ornamental detail, subject fills about 75% of the band. COMPOSITION: vertical 2:3, 1024x1488;
the subject occupies only the band from 18% to 62% of the image height (y 268 to y 922), the
top 18% and the bottom 38% stay dark, empty and free of detail; full-bleed background with no
inner panel and no frame; subject centred with a 10% side margin, silhouette readable at 96px
wide. NEGATIVE: text, letters, numbers, watermark, signature, logo, frame, border, card
template, UI mockup, rounded inner panel, photorealistic, photograph, glossy 3D render, harsh
specular highlights, multiple unrelated subjects, busy background, humans, hands, faces,
blurry, low contrast
```

---

#### 05 · `art_card_poison_mythic`
**Ancla:** *Ángel Destructor* (`destroying_angel`).
**Elemento clave:** capa y tallo blancos puros y luminosos · doble anillo de velo · alas de
esporas blancas desplegándose en simetría · halo verde ácido detrás · iridiscencia doble
(blanco-verde + magenta en los filos)
**Nota de producción:** es el único blanco puro del set. Dejalo blanco: la trampa es
teñirlo de verde y perder la lectura de "angelical".

```text
Bioluminescent mycology game art, flat vector illustration with subtle film grain, matte
finish, no glossy 3D render look. Palette: deep indigo-teal ground #080b10 to #0d131b with
acid-lime #8ce63f accents. Single bioluminescent light source above and slightly behind the
subject, short soft contact shadow, damp dark moss ground, faint low fog, crisp 2px darker
outline on focal shapes, high contrast when scaled to 200px. SUBJECT: a destroying angel
amanita, a pure luminous white cap and stem, radiant, angelic and lethal, a double veil ring
around the stem, wings of white spores unfolding in perfect symmetry, a wide halo of acid
green light behind it, maximal ornamental detail, dramatic chiaroscuro. RARITY mythic:
dual-colour iridescent bioluminescence with magenta iridescence on the edges, volumetric
glow, a floating rune-like ring of spores, subject fills about 80% of the band. COMPOSITION:
vertical 2:3, 1024x1488; the subject occupies only the band from 18% to 62% of the image
height (y 268 to y 922), the top 18% and the bottom 38% stay dark, empty and free of detail;
full-bleed background with no inner panel and no frame; subject centred with a 10% side
margin, silhouette readable at 96px wide. NEGATIVE: text, letters, numbers, watermark,
signature, logo, frame, border, card template, UI mockup, rounded inner panel,
photorealistic, photograph, glossy 3D render, harsh specular highlights, multiple unrelated
subjects, busy background, humans, hands, faces, blurry, low contrast
```

---

### 3.2 Elemento `spore` — ámbar `#f2c14e`

**Sujeto canónico:** bejines (puffballs) descargando nubes de esporas.
**Quién lo usa hoy:** 4 cartas (2 comunes, poco común, rara).
**El peligro de esta familia:** una nube de partículas es lo más fácil de arruinar: si la
nube es densa, tapa al sujeto y la carta se ve sucia. La nube tiene que ser **de motas
separadas y legibles**, con huecos.

---

#### 06 · `art_card_spore_common`
**Ancla:** *Bejín* (`spore_puffball`).
**Elemento clave:** cuerpo redondo apergaminado beige · un solo poro en la parte superior ·
un penacho fino de esporas ámbar escapando hacia arriba · musgo oscuro · sombra de contacto
corta

```text
Bioluminescent mycology game art, flat vector illustration with subtle film grain, matte
finish, no glossy 3D render look. Palette: deep indigo-teal ground #080b10 to #0d131b with
amber #f2c14e accents. Single bioluminescent light source above and slightly behind the
subject, short soft contact shadow, damp dark moss ground, faint low fog, crisp 2px darker
outline on focal shapes, high contrast when scaled to 200px. SUBJECT: a small beige puffball
resting on dark moss, a papery round body with a single pore on top, one thin plume of amber
spores escaping upward. RARITY common: three flat shapes or fewer, a single accent glow, no
particles, muted desaturated palette, subject fills about 55% of the band. COMPOSITION:
vertical 2:3, 1024x1488; the subject occupies only the band from 18% to 62% of the image
height (y 268 to y 922), the top 18% and the bottom 38% stay dark, empty and free of detail;
full-bleed background with no inner panel and no frame; subject centred with a 10% side
margin, silhouette readable at 96px wide. NEGATIVE: text, letters, numbers, watermark,
signature, logo, frame, border, card template, UI mockup, rounded inner panel,
photorealistic, photograph, glossy 3D render, harsh specular highlights, multiple unrelated
subjects, busy background, humans, hands, faces, blurry, low contrast
```

---

#### 07 · `art_card_spore_uncommon`
**Ancla:** *Bejín Gigante* (`spore_giant_puffball`).
**Elemento clave:** cuerpo esférico agrietado del tamaño de una roca · fisura en la parte
alta · nube densa pero **con huecos** saliendo de la fisura · unas motas derivando de lado ·
asimetría leve (la fisura no está centrada)

```text
Bioluminescent mycology game art, flat vector illustration with subtle film grain, matte
finish, no glossy 3D render look. Palette: deep indigo-teal ground #080b10 to #0d131b with
amber #f2c14e accents. Single bioluminescent light source above and slightly behind the
subject, short soft contact shadow, damp dark moss ground, faint low fog, crisp 2px darker
outline on focal shapes, high contrast when scaled to 200px. SUBJECT: a giant puffball, a
cracked spherical body the size of a boulder, a dense amber spore cloud erupting from an
off-centre fissure, loose individual spores drifting sideways with clear gaps between them,
two-tone gradient across the body. RARITY uncommon: mild rim light, a few floating spore
specks, slight asymmetry, subject fills about 62% of the band. COMPOSITION: vertical 2:3,
1024x1488; the subject occupies only the band from 18% to 62% of the image height (y 268 to
y 922), the top 18% and the bottom 38% stay dark, empty and free of detail; full-bleed
background with no inner panel and no frame; subject centred with a 10% side margin,
silhouette readable at 96px wide. NEGATIVE: text, letters, numbers, watermark, signature,
logo, frame, border, card template, UI mockup, rounded inner panel, photorealistic,
photograph, glossy 3D render, harsh specular highlights, multiple unrelated subjects, busy
background, humans, hands, faces, blurry, low contrast
```

---

#### 08 · `art_card_spore_rare`
**Ancla:** *Anillo de Matamoscas* (`fly_agaric_ring`).
**Elemento clave:** círculo de cuatro amanitas de capa escarlata con puntos blancos ·
núcleo brillante en el centro del círculo · nube de esporas ámbar subiendo del centro ·
laminillas visibles · viñeta profunda

```text
Bioluminescent mycology game art, flat vector illustration with subtle film grain, matte
finish, no glossy 3D render look. Palette: deep indigo-teal ground #080b10 to #0d131b with
amber #f2c14e accents. Single bioluminescent light source above and slightly behind the
subject, short soft contact shadow, damp dark moss ground, faint low fog, crisp 2px darker
outline on focal shapes, high contrast when scaled to 200px. SUBJECT: a ring of four fly
agaric mushrooms with scarlet caps and white spots arranged in a circle around a bright
amber core, a heavy cloud of amber spores rising from the middle of the ring, gill detail
visible under each cap, layered depth with a second faint ring behind. RARITY rare: rich
layered detail, strong bioluminescent core, particle motes, deep vignette, teal-indigo
contrast, subject fills about 70% of the band. COMPOSITION: vertical 2:3, 1024x1488; the
subject occupies only the band from 18% to 62% of the image height (y 268 to y 922), the top
18% and the bottom 38% stay dark, empty and free of detail; full-bleed background with no
inner panel and no frame; subject centred with a 10% side margin, silhouette readable at 96px
wide. NEGATIVE: text, letters, numbers, watermark, signature, logo, frame, border, card
template, UI mockup, rounded inner panel, photorealistic, photograph, glossy 3D render, harsh
specular highlights, multiple unrelated subjects, busy background, humans, hands, faces,
blurry, low contrast
```

---

#### 09 · `art_card_spore_legendary`
**Ancla:** **slot libre** (reservado para una legendaria de esporas).
**Elemento clave:** bejín colosal en plena explosión · piel exterior pelándose en pétalos ·
núcleo ámbar-oro expuesto · cúpula ancha de esporas · anillos concéntricos detrás · rim light
dorado

```text
Bioluminescent mycology game art, flat vector illustration with subtle film grain, matte
finish, no glossy 3D render look. Palette: deep indigo-teal ground #080b10 to #0d131b with
amber #f2c14e accents. Single bioluminescent light source above and slightly behind the
subject, short soft contact shadow, damp dark moss ground, faint low fog, crisp 2px darker
outline on focal shapes, high contrast when scaled to 200px. SUBJECT: a colossal puffball
mid-burst, its outer skin peeling away in curved petals, a glowing amber-gold core exposed
at the centre, a wide dome of individual spores, ornate composition with fine ornamental
detail on the peeling petals. RARITY legendary: golden-amber rim light, halo bloom, faint
concentric rings behind the subject, subject fills about 75% of the band. COMPOSITION:
vertical 2:3, 1024x1488; the subject occupies only the band from 18% to 62% of the image
height (y 268 to y 922), the top 18% and the bottom 38% stay dark, empty and free of detail;
full-bleed background with no inner panel and no frame; subject centred with a 10% side
margin, silhouette readable at 96px wide. NEGATIVE: text, letters, numbers, watermark,
signature, logo, frame, border, card template, UI mockup, rounded inner panel,
photorealistic, photograph, glossy 3D render, harsh specular highlights, multiple unrelated
subjects, busy background, humans, hands, faces, blurry, low contrast
```

---

#### 10 · `art_card_spore_mythic`
**Ancla:** **slot libre** (reservado para una mítica de esporas).
**Elemento clave:** bejín torre coronado por un anillo rúnico flotante de esporas ·
iridiscencia doble ámbar + violeta · haces de luz volumétricos · claroscuro dramático ·
máximo detalle

```text
Bioluminescent mycology game art, flat vector illustration with subtle film grain, matte
finish, no glossy 3D render look. Palette: deep indigo-teal ground #080b10 to #0d131b with
amber #f2c14e accents. Single bioluminescent light source above and slightly behind the
subject, short soft contact shadow, damp dark moss ground, faint low fog, crisp 2px darker
outline on focal shapes, high contrast when scaled to 200px. SUBJECT: a towering spore
cathedral, a tall puffball crowned with a floating rune-like ring of individual spores, dual
amber and violet iridescence across its surface, volumetric shafts of light cutting through
the spore cloud, maximal ornamental detail, dramatic chiaroscuro. RARITY mythic:
dual-colour iridescent bioluminescence, volumetric glow, a floating rune-like ring of spores,
subject fills about 80% of the band. COMPOSITION: vertical 2:3, 1024x1488; the subject
occupies only the band from 18% to 62% of the image height (y 268 to y 922), the top 18% and
the bottom 38% stay dark, empty and free of detail; full-bleed background with no inner panel
and no frame; subject centred with a 10% side margin, silhouette readable at 96px wide.
NEGATIVE: text, letters, numbers, watermark, signature, logo, frame, border, card template,
UI mockup, rounded inner panel, photorealistic, photograph, glossy 3D render, harsh specular
highlights, multiple unrelated subjects, busy background, humans, hands, faces, blurry, low
contrast
```

### 3.3 Elemento `decay` — óxido `#c1683a`

**Sujeto canónico:** hongos de repisa y madera podrida consumida.
**Quién lo usa hoy:** 5 cartas (2 comunes, 2 poco comunes, legendaria).
**El peligro de esta familia:** el óxido se acerca al marrón de la madera y todo se funde en
una sola mancha. Necesita **contraste de valor**: superficies oscuras con bordes de
crecimiento claros, y el glow ámbar metido en las grietas.

---

#### 11 · `art_card_decay_common`
**Ancla:** *Poliporo* (`decay_bracket`).
**Elemento clave:** tres repisas apiladas · borde de crecimiento pálido en cada una · corteza
húmeda oscura · una grieta con glow ámbar mínimo · silueta escalonada

```text
Bioluminescent mycology game art, flat vector illustration with subtle film grain, matte
finish, no glossy 3D render look. Palette: deep indigo-teal ground #080b10 to #0d131b with
rust #c1683a accents. Single bioluminescent light source above and slightly behind the
subject, short soft contact shadow, damp dark bark ground, faint low fog, crisp 2px darker
outline on focal shapes, high contrast when scaled to 200px. SUBJECT: a stack of three
bracket fungi growing from a dark rotting log, hard rust-brown shelves with pale growing
edges, a damp bark surface, one crack with a faint amber glow inside. RARITY common: three
flat shapes or fewer, a single accent glow, no particles, muted desaturated palette, subject
fills about 55% of the band. COMPOSITION: vertical 2:3, 1024x1488; the subject occupies only
the band from 18% to 62% of the image height (y 268 to y 922), the top 18% and the bottom 38%
stay dark, empty and free of detail; full-bleed background with no inner panel and no frame;
subject centred with a 10% side margin, silhouette readable at 96px wide. NEGATIVE: text,
letters, numbers, watermark, signature, logo, frame, border, card template, UI mockup,
rounded inner panel, photorealistic, photograph, glossy 3D render, harsh specular highlights,
multiple unrelated subjects, busy background, humans, hands, faces, blurry, low contrast
```

---

#### 12 · `art_card_decay_uncommon`
**Ancla:** *Cola de Pavo* (`turkey_tail`) y *Tocón Ancestral* (`decay_ancient_stump`).
**Elemento clave:** abanico de repisas finas con bandas alternadas óxido/crema/sepia ·
crecimiento en capas superpuestas · borde de cada repisa con rim light ámbar tenue ·
tocón oscuro detrás

```text
Bioluminescent mycology game art, flat vector illustration with subtle film grain, matte
finish, no glossy 3D render look. Palette: deep indigo-teal ground #080b10 to #0d131b with
rust #c1683a accents. Single bioluminescent light source above and slightly behind the
subject, short soft contact shadow, damp dark bark ground, faint low fog, crisp 2px darker
outline on focal shapes, high contrast when scaled to 200px. SUBJECT: a turkey tail bracket
fungus, a fan of thin shelves banded in rust, cream and umber growing in overlapping tiers on
a stump, a soft amber rim light on every edge, two-tone gradient from deep shadow at the
base to warm light at the tips. RARITY uncommon: mild rim light, a few floating spore specks,
slight asymmetry, subject fills about 62% of the band. COMPOSITION: vertical 2:3, 1024x1488;
the subject occupies only the band from 18% to 62% of the image height (y 268 to y 922), the
top 18% and the bottom 38% stay dark, empty and free of detail; full-bleed background with no
inner panel and no frame; subject centred with a 10% side margin, silhouette readable at 96px
wide. NEGATIVE: text, letters, numbers, watermark, signature, logo, frame, border, card
template, UI mockup, rounded inner panel, photorealistic, photograph, glossy 3D render, harsh
specular highlights, multiple unrelated subjects, busy background, humans, hands, faces,
blurry, low contrast
```

---

#### 13 · `art_card_decay_rare`
**Ancla:** **slot libre** (reservado para una rara de podredumbre).
**Elemento clave:** tocón hueco partido en dos · venas miceliales ámbar incandescentes
recorriendo la madera expuesta · fibra desmenuzada en detalle · motas de polvo y esporas ·
viñeta profunda

```text
Bioluminescent mycology game art, flat vector illustration with subtle film grain, matte
finish, no glossy 3D render look. Palette: deep indigo-teal ground #080b10 to #0d131b with
rust #c1683a accents. Single bioluminescent light source above and slightly behind the
subject, short soft contact shadow, damp dark bark ground, faint low fog, crisp 2px darker
outline on focal shapes, high contrast when scaled to 200px. SUBJECT: a hollow rotten stump
split open, glowing amber mycelial veins crawling through the exposed wood, crumbling fibre
detail along the break, motes of dust and spores hanging in the air, layered depth with
secondary splinters behind. RARITY rare: rich layered detail, strong bioluminescent core,
particle motes, deep vignette, teal-indigo contrast, subject fills about 70% of the band.
COMPOSITION: vertical 2:3, 1024x1488; the subject occupies only the band from 18% to 62% of
the image height (y 268 to y 922), the top 18% and the bottom 38% stay dark, empty and free of
detail; full-bleed background with no inner panel and no frame; subject centred with a 10%
side margin, silhouette readable at 96px wide. NEGATIVE: text, letters, numbers, watermark,
signature, logo, frame, border, card template, UI mockup, rounded inner panel,
photorealistic, photograph, glossy 3D render, harsh specular highlights, multiple unrelated
subjects, busy background, humans, hands, faces, blurry, low contrast
```

---

#### 14 · `art_card_decay_legendary`
**Ancla:** *Anciano del Bosque* (`old_man_of_woods`).
**Elemento clave:** capa de escamas gris-pardas gruesas como pelaje · tallo grueso y
barbudo · crecimiento desde un tronco descompuesto · rim light ámbar cálido en cada escama ·
anillos concéntricos detrás

```text
Bioluminescent mycology game art, flat vector illustration with subtle film grain, matte
finish, no glossy 3D render look. Palette: deep indigo-teal ground #080b10 to #0d131b with
rust #c1683a accents. Single bioluminescent light source above and slightly behind the
subject, short soft contact shadow, damp dark bark ground, faint low fog, crisp 2px darker
outline on focal shapes, high contrast when scaled to 200px. SUBJECT: the old man of the
woods mushroom, a shaggy cap of dark grey-brown scales like coarse fur, a thick bearded stem
growing out of a decayed trunk, warm amber rim light catching every scale, ornate composition
with intricate detail on the fur-like surface. RARITY legendary: golden-amber rim light, halo
bloom, faint concentric rings behind the subject, subject fills about 75% of the band.
COMPOSITION: vertical 2:3, 1024x1488; the subject occupies only the band from 18% to 62% of
the image height (y 268 to y 922), the top 18% and the bottom 38% stay dark, empty and free of
detail; full-bleed background with no inner panel and no frame; subject centred with a 10%
side margin, silhouette readable at 96px wide. NEGATIVE: text, letters, numbers, watermark,
signature, logo, frame, border, card template, UI mockup, rounded inner panel,
photorealistic, photograph, glossy 3D render, harsh specular highlights, multiple unrelated
subjects, busy background, humans, hands, faces, blurry, low contrast
```

---

#### 15 · `art_card_decay_mythic`
**Ancla:** **slot libre** (reservado para una mítica de podredumbre).
**Elemento clave:** tronco caído consumido de punta a punta · resplandor ámbar-oro de horno
dentro de las grietas · cuerpos fructíferos brotando en línea · anillo rúnico flotante ·
iridiscencia doble óxido + violeta

```text
Bioluminescent mycology game art, flat vector illustration with subtle film grain, matte
finish, no glossy 3D render look. Palette: deep indigo-teal ground #080b10 to #0d131b with
rust #c1683a accents. Single bioluminescent light source above and slightly behind the
subject, short soft contact shadow, damp dark bark ground, faint low fog, crisp 2px darker
outline on focal shapes, high contrast when scaled to 200px. SUBJECT: a fallen titan trunk
consumed by rot from end to end, an amber-gold furnace glow burning inside every crack,
fungal fruiting bodies erupting in a line along its length, dual rust and violet iridescence,
volumetric glow, maximal ornamental detail, dramatic chiaroscuro. RARITY mythic: dual-colour
iridescent bioluminescence, volumetric glow, a floating rune-like ring of spores, subject
fills about 80% of the band. COMPOSITION: vertical 2:3, 1024x1488; the subject occupies only
the band from 18% to 62% of the image height (y 268 to y 922), the top 18% and the bottom 38%
stay dark, empty and free of detail; full-bleed background with no inner panel and no frame;
subject centred with a 10% side margin, silhouette readable at 96px wide. NEGATIVE: text,
letters, numbers, watermark, signature, logo, frame, border, card template, UI mockup,
rounded inner panel, photorealistic, photograph, glossy 3D render, harsh specular highlights,
multiple unrelated subjects, busy background, humans, hands, faces, blurry, low contrast
```

---

### 3.4 Elemento `symbiosis` — menta `#4fd18b`

**Sujeto canónico:** hongos unidos a raíces de árbol por filamentos que intercambian luz.
**Quién lo usa hoy:** 4 cartas (2 comunes, poco común, rara).
**El peligro de esta familia:** el menta `#4fd18b` es el mismo color que usa el HUD para el
sustrato y las esporas. Si la ilustración se llena de menta, la carta compite con la
interfaz. El menta va **solo en el intercambio de luz**, en los filamentos.

---

#### 16 · `art_card_symbiosis_common`
**Ancla:** *Boleto* (`symbiosis_boletus`).
**Elemento clave:** capa redondeada castaño · tallo grueso reticulado · una raíz oscura al
lado · **un solo** filamento menta conectando la base con la raíz

```text
Bioluminescent mycology game art, flat vector illustration with subtle film grain, matte
finish, no glossy 3D render look. Palette: deep indigo-teal ground #080b10 to #0d131b with
mint #4fd18b accents. Single bioluminescent light source above and slightly behind the
subject, short soft contact shadow, damp dark soil ground, faint low fog, crisp 2px darker
outline on focal shapes, high contrast when scaled to 200px. SUBJECT: a fat bolete mushroom
beside a dark tree root, a rounded chestnut-brown cap, a thick reticulated stem, a single
mint-green glowing filament connecting the base of the stem to the root. RARITY common: three
flat shapes or fewer, a single accent glow, no particles, muted desaturated palette, subject
fills about 55% of the band. COMPOSITION: vertical 2:3, 1024x1488; the subject occupies only
the band from 18% to 62% of the image height (y 268 to y 922), the top 18% and the bottom 38%
stay dark, empty and free of detail; full-bleed background with no inner panel and no frame;
subject centred with a 10% side margin, silhouette readable at 96px wide. NEGATIVE: text,
letters, numbers, watermark, signature, logo, frame, border, card template, UI mockup,
rounded inner panel, photorealistic, photograph, glossy 3D render, harsh specular highlights,
multiple unrelated subjects, busy background, humans, hands, faces, blurry, low contrast
```

---

#### 17 · `art_card_symbiosis_uncommon`
**Ancla:** *Colmenilla Premiada* (`morel_prize`).
**Elemento clave:** capa alta con panal de alvéolos profundos · tallo pálido · base de un
abedul detrás · menta suave brillando **dentro** de los alvéolos · asimetría leve

```text
Bioluminescent mycology game art, flat vector illustration with subtle film grain, matte
finish, no glossy 3D render look. Palette: deep indigo-teal ground #080b10 to #0d131b with
mint #4fd18b accents. Single bioluminescent light source above and slightly behind the
subject, short soft contact shadow, damp dark soil ground, faint low fog, crisp 2px darker
outline on focal shapes, high contrast when scaled to 200px. SUBJECT: a prize morel, a tall
honeycombed cap of deep pits, a pale stem, growing at the base of a birch trunk, a soft mint
glow inside the pits, two-tone gradient from shadow at the base to light at the tip. RARITY
uncommon: mild rim light, a few floating spore specks, slight asymmetry, subject fills about
62% of the band. COMPOSITION: vertical 2:3, 1024x1488; the subject occupies only the band
from 18% to 62% of the image height (y 268 to y 922), the top 18% and the bottom 38% stay
dark, empty and free of detail; full-bleed background with no inner panel and no frame;
subject centred with a 10% side margin, silhouette readable at 96px wide. NEGATIVE: text,
letters, numbers, watermark, signature, logo, frame, border, card template, UI mockup,
rounded inner panel, photorealistic, photograph, glossy 3D render, harsh specular highlights,
multiple unrelated subjects, busy background, humans, hands, faces, blurry, low contrast
```

---

#### 18 · `art_card_symbiosis_rare`
**Ancla:** *Rebozuelo Dorado* (`chanterelle_gold`).
**Elemento clave:** capa acampanada con crestas que se bifurcan · grupo pequeño saliendo del
musgo · intercambio de luz menta entre la base y las raíces · motas · viñeta profunda

```text
Bioluminescent mycology game art, flat vector illustration with subtle film grain, matte
finish, no glossy 3D render look. Palette: deep indigo-teal ground #080b10 to #0d131b with
mint #4fd18b accents. Single bioluminescent light source above and slightly behind the
subject, short soft contact shadow, damp dark soil ground, faint low fog, crisp 2px darker
outline on focal shapes, high contrast when scaled to 200px. SUBJECT: a golden chanterelle,
a fluted trumpet-shaped cap with forking ridges rising in a small group from moss, a luminous
mint-green exchange of light between its base and the tree roots, layered detail on the
ridges, particle motes in the air. RARITY rare: rich layered detail, strong bioluminescent
core, particle motes, deep vignette, teal-indigo contrast, secondary shapes behind the
subject, subject fills about 70% of the band. COMPOSITION: vertical 2:3, 1024x1488; the
subject occupies only the band from 18% to 62% of the image height (y 268 to y 922), the top
18% and the bottom 38% stay dark, empty and free of detail; full-bleed background with no
inner panel and no frame; subject centred with a 10% side margin, silhouette readable at 96px
wide. NEGATIVE: text, letters, numbers, watermark, signature, logo, frame, border, card
template, UI mockup, rounded inner panel, photorealistic, photograph, glossy 3D render, harsh
specular highlights, multiple unrelated subjects, busy background, humans, hands, faces,
blurry, low contrast
```

---

#### 19 · `art_card_symbiosis_legendary`
**Ancla:** **slot libre** (reservado para una legendaria de simbiosis).
**Elemento clave:** bolete gigante fusionado al tronco · filamentos menta-blancos gruesos
recorriendo **en los dos sentidos** · intercambio bidireccional visible · rim light ámbar-oro
· anillos concéntricos detrás

```text
Bioluminescent mycology game art, flat vector illustration with subtle film grain, matte
finish, no glossy 3D render look. Palette: deep indigo-teal ground #080b10 to #0d131b with
mint #4fd18b accents. Single bioluminescent light source above and slightly behind the
subject, short soft contact shadow, damp dark soil ground, faint low fog, crisp 2px darker
outline on focal shapes, high contrast when scaled to 200px. SUBJECT: a giant bolete fused
into an ancient tree trunk, the cap melded into the bark, thick mint-white filaments running
in both directions between fungus and wood in a visible two-way exchange of light, ornate
composition with intricate detail on the filaments. RARITY legendary: golden-amber rim light,
halo bloom, faint concentric rings behind the subject, subject fills about 75% of the band.
COMPOSITION: vertical 2:3, 1024x1488; the subject occupies only the band from 18% to 62% of
the image height (y 268 to y 922), the top 18% and the bottom 38% stay dark, empty and free of
detail; full-bleed background with no inner panel and no frame; subject centred with a 10%
side margin, silhouette readable at 96px wide. NEGATIVE: text, letters, numbers, watermark,
signature, logo, frame, border, card template, UI mockup, rounded inner panel,
photorealistic, photograph, glossy 3D render, harsh specular highlights, multiple unrelated
subjects, busy background, humans, hands, faces, blurry, low contrast
```

---

#### 20 · `art_card_symbiosis_mythic`
**Ancla:** **slot libre** (reservado para una mítica de simbiosis).
**Elemento clave:** árbol y hongo tejidos en **una sola silueta** · núcleo menta luminoso
compartido · glow volumétrico · iridiscencia doble menta + magenta · anillo rúnico flotante ·
claroscuro dramático

```text
Bioluminescent mycology game art, flat vector illustration with subtle film grain, matte
finish, no glossy 3D render look. Palette: deep indigo-teal ground #080b10 to #0d131b with
mint #4fd18b accents. Single bioluminescent light source above and slightly behind the
subject, short soft contact shadow, damp dark soil ground, faint low fog, crisp 2px darker
outline on focal shapes, high contrast when scaled to 200px. SUBJECT: a forest-wide
mycorrhizal embrace, a tree and a fungus woven into one single silhouette sharing a luminous
mint-green core at the point where they meet, dual mint and magenta iridescence, volumetric
glow, maximal ornamental detail, dramatic chiaroscuro. RARITY mythic: dual-colour iridescent
bioluminescence, volumetric glow, a floating rune-like ring of spores, subject fills about
80% of the band. COMPOSITION: vertical 2:3, 1024x1488; the subject occupies only the band
from 18% to 62% of the image height (y 268 to y 922), the top 18% and the bottom 38% stay
dark, empty and free of detail; full-bleed background with no inner panel and no frame;
subject centred with a 10% side margin, silhouette readable at 96px wide. NEGATIVE: text,
letters, numbers, watermark, signature, logo, frame, border, card template, UI mockup,
rounded inner panel, photorealistic, photograph, glossy 3D render, harsh specular highlights,
multiple unrelated subjects, busy background, humans, hands, faces, blurry, low contrast
```

---

### 3.5 Elemento `crystal` — cian `#5fd8e8`

**Sujeto canónico:** hongos translúcidos, coralinos y luminiscentes de noche.
**Quién lo usa hoy:** 7 cartas — **la familia más poblada del juego** (2 comunes, poco común,
3 raras, legendaria).
**El peligro de esta familia:** el cian `#5fd8e8` es el color dominante del juego entero
(halos, anillo de selección, HUD). Estas 5 cartas van a estar siempre en pantalla y son las
que más fácil se ven "todas iguales". **Diferenciá por forma, no por color**: coral
ramificado, cascada de espinas, sombrilla con laminillas, velas finas, catedral facetada.

---

#### 21 · `art_card_crystal_common`
**Ancla:** *Hongo Coral* (`crystal_coralfungus`).
**Elemento clave:** tres ramas cian bifurcadas con puntas facetadas · una banda de luz
refractada · suelo húmedo oscuro · silueta ramificada

```text
Bioluminescent mycology game art, flat vector illustration with subtle film grain, matte
finish, no glossy 3D render look. Palette: deep indigo-teal ground #080b10 to #0d131b with
cyan #5fd8e8 accents. Single bioluminescent light source above and slightly behind the
subject, short soft contact shadow, damp dark wet ground, faint low fog, crisp 2px darker
outline on focal shapes, high contrast when scaled to 200px. SUBJECT: a translucent coral
fungus, three forking cyan chitin branches with faceted tips refracting a thin band of light,
a clean branched silhouette on dark wet ground. RARITY common: three flat shapes or fewer, a
single accent glow, no particles, muted desaturated palette, subject fills about 55% of the
band. COMPOSITION: vertical 2:3, 1024x1488; the subject occupies only the band from 18% to
62% of the image height (y 268 to y 922), the top 18% and the bottom 38% stay dark, empty and
free of detail; full-bleed background with no inner panel and no frame; subject centred with a
10% side margin, silhouette readable at 96px wide. NEGATIVE: text, letters, numbers,
watermark, signature, logo, frame, border, card template, UI mockup, rounded inner panel,
photorealistic, photograph, glossy 3D render, harsh specular highlights, multiple unrelated
subjects, busy background, humans, hands, faces, blurry, low contrast
```

---

#### 22 · `art_card_crystal_uncommon`
**Ancla:** *Melena de León* (`lion_mane`).
**Elemento clave:** cascada de espinas blancas largas colgando de un tallo corto · luz cian
por detrás · unas motas · dos-tres capas de espinas a distinta profundidad

```text
Bioluminescent mycology game art, flat vector illustration with subtle film grain, matte
finish, no glossy 3D render look. Palette: deep indigo-teal ground #080b10 to #0d131b with
cyan #5fd8e8 accents. Single bioluminescent light source above and slightly behind the
subject, short soft contact shadow, damp dark wet ground, faint low fog, crisp 2px darker
outline on focal shapes, high contrast when scaled to 200px. SUBJECT: a lion's mane fungus,
a cascade of long white icicle-like spines hanging from a short stem, lit cyan from behind,
two-tone gradient from cool shadow at the top to bright spines at the bottom, a few floating
spore specks. RARITY uncommon: mild rim light, slight asymmetry, subject fills about 62% of
the band. COMPOSITION: vertical 2:3, 1024x1488; the subject occupies only the band from 18%
to 62% of the image height (y 268 to y 922), the top 18% and the bottom 38% stay dark, empty
and free of detail; full-bleed background with no inner panel and no frame; subject centred
with a 10% side margin, silhouette readable at 96px wide. NEGATIVE: text, letters, numbers,
watermark, signature, logo, frame, border, card template, UI mockup, rounded inner panel,
photorealistic, photograph, glossy 3D render, harsh specular highlights, multiple unrelated
subjects, busy background, humans, hands, faces, blurry, low contrast
```

---

#### 23 · `art_card_crystal_rare`
**Ancla:** *Hongo Fantasma* (`ghost_fungus`), *Elixir de Reishi* (`reishi_elixir`) y *Coral
Mayor* (`crystal_grand_coral`) — las tres comparten este slot; **generá 3 variantes y
asigná la que mejor represente al coral mayor**, que es la carta con más peso.
**Elemento clave:** abanico de sombrillas pálidas con laminillas radiadas · brillo cian-verde
frío en oscuridad total · laminillas como radios visibles · motas · viñeta profunda

```text
Bioluminescent mycology game art, flat vector illustration with subtle film grain, matte
finish, no glossy 3D render look. Palette: deep indigo-teal ground #080b10 to #0d131b with
cyan #5fd8e8 accents. Single bioluminescent light source above and slightly behind the
subject, short soft contact shadow, damp dark wet ground, faint low fog, crisp 2px darker
outline on focal shapes, high contrast when scaled to 200px. SUBJECT: a ghost fungus, a fan
of pale gilled caps glowing cold cyan-green in complete darkness, gills radiating like spokes
under each cap, layered depth with a second cap behind, particle motes, deep vignette. RARITY
rare: rich layered detail, strong bioluminescent core, particle motes, deep vignette,
teal-indigo contrast, secondary shapes behind the subject, subject fills about 70% of the
band. COMPOSITION: vertical 2:3, 1024x1488; the subject occupies only the band from 18% to
62% of the image height (y 268 to y 922), the top 18% and the bottom 38% stay dark, empty and
free of detail; full-bleed background with no inner panel and no frame; subject centred with a
10% side margin, silhouette readable at 96px wide. NEGATIVE: text, letters, numbers,
watermark, signature, logo, frame, border, card template, UI mockup, rounded inner panel,
photorealistic, photograph, glossy 3D render, harsh specular highlights, multiple unrelated
subjects, busy background, humans, hands, faces, blurry, low contrast
```

---

#### 24 · `art_card_crystal_legendary`
**Ancla:** *Mycena Lucifer* (`mycena_lucifer`).
**Elemento clave:** racimo de tallos finos y altos con capas minúsculas encendidas ·
dispuestas como velas · laminillas visibles bajo cada capa · halo bloom · anillos
concéntricos detrás

```text
Bioluminescent mycology game art, flat vector illustration with subtle film grain, matte
finish, no glossy 3D render look. Palette: deep indigo-teal ground #080b10 to #0d131b with
cyan #5fd8e8 accents. Single bioluminescent light source above and slightly behind the
subject, short soft contact shadow, damp dark wet ground, faint low fog, crisp 2px darker
outline on focal shapes, high contrast when scaled to 200px. SUBJECT: a cluster of lucifer
mycena, tall slender stems with tiny glowing cyan caps arranged like candles, gill detail
visible under each cap, ornate composition with fine ornamental detail, halo bloom behind the
cluster. RARITY legendary: golden-amber rim light, halo bloom, faint concentric rings behind
the subject, subject fills about 75% of the band. COMPOSITION: vertical 2:3, 1024x1488; the
subject occupies only the band from 18% to 62% of the image height (y 268 to y 922), the top
18% and the bottom 38% stay dark, empty and free of detail; full-bleed background with no
inner panel and no frame; subject centred with a 10% side margin, silhouette readable at 96px
wide. NEGATIVE: text, letters, numbers, watermark, signature, logo, frame, border, card
template, UI mockup, rounded inner panel, photorealistic, photograph, glossy 3D render, harsh
specular highlights, multiple unrelated subjects, busy background, humans, hands, faces,
blurry, low contrast
```

---

#### 25 · `art_card_crystal_mythic`
**Ancla:** **slot libre** (reservado para una mítica de cristal).
**Elemento clave:** agujas de quitina facetada creciendo en corona simétrica · refracción
cian + violeta · haces volumétricos · anillo rúnico flotante · claroscuro dramático

```text
Bioluminescent mycology game art, flat vector illustration with subtle film grain, matte
finish, no glossy 3D render look. Palette: deep indigo-teal ground #080b10 to #0d131b with
cyan #5fd8e8 accents. Single bioluminescent light source above and slightly behind the
subject, short soft contact shadow, damp dark wet ground, faint low fog, crisp 2px darker
outline on focal shapes, high contrast when scaled to 200px. SUBJECT: a crystal cathedral,
faceted chitin spires growing into a symmetrical crown, refracting cyan and violet light,
volumetric beams passing between the spires, dual-colour iridescence, maximal ornamental
detail, dramatic chiaroscuro. RARITY mythic: dual-colour iridescent bioluminescence,
volumetric glow, a floating rune-like ring of spores, subject fills about 80% of the band.
COMPOSITION: vertical 2:3, 1024x1488; the subject occupies only the band from 18% to 62% of
the image height (y 268 to y 922), the top 18% and the bottom 38% stay dark, empty and free of
detail; full-bleed background with no inner panel and no frame; subject centred with a 10%
side margin, silhouette readable at 96px wide. NEGATIVE: text, letters, numbers, watermark,
signature, logo, frame, border, card template, UI mockup, rounded inner panel,
photorealistic, photograph, glossy 3D render, harsh specular highlights, multiple unrelated
subjects, busy background, humans, hands, faces, blurry, low contrast
```

### 3.6 Elemento `mycelium` — violeta `#a78bfa`

**Sujeto canónico:** redes de filamentos y setas que crecen sobre ellas.
**Quién lo usa hoy:** 6 cartas — la segunda familia más poblada (3 comunes, poco común, rara,
legendaria).
**El peligro de esta familia:** una red de filamentos es, por definición, ruido. A 96 px se
convierte en una mancha gris. Regla: **máximo 12 trazos de filamento visibles**, con grosores
distintos (los principales al doble de grosor que los secundarios) y el violeta reservado
para los nudos.

---

#### 26 · `art_card_mycelium_common`
**Ancla:** *Hilo Micelial* (`mycelium_thread`).
**Elemento clave:** una red de filamentos blancos-violeta sobre tierra oscura · tres
bifurcaciones · nudo luminoso en el centro · sin ninguna seta (esta carta es solo el hilo)

```text
Bioluminescent mycology game art, flat vector illustration with subtle film grain, matte
finish, no glossy 3D render look. Palette: deep indigo-teal ground #080b10 to #0d131b with
violet #a78bfa accents. Single bioluminescent light source above and slightly behind the
subject, short soft contact shadow, damp dark soil ground, faint low fog, crisp 2px darker
outline on focal shapes, high contrast when scaled to 200px. SUBJECT: a single branching
mycelial filament network spreading across dark soil, thin white-violet threads like veins,
three clean forks, one luminous node at the centre, no fruiting body, minimal and calm.
RARITY common: three flat shapes or fewer, a single accent glow, no particles, muted
desaturated palette, subject fills about 55% of the band. COMPOSITION: vertical 2:3,
1024x1488; the subject occupies only the band from 18% to 62% of the image height (y 268 to
y 922), the top 18% and the bottom 38% stay dark, empty and free of detail; full-bleed
background with no inner panel and no frame; subject centred with a 10% side margin,
silhouette readable at 96px wide. NEGATIVE: text, letters, numbers, watermark, signature,
logo, frame, border, card template, UI mockup, rounded inner panel, photorealistic,
photograph, glossy 3D render, harsh specular highlights, multiple unrelated subjects, busy
background, humans, hands, faces, blurry, low contrast
```

---

#### 27 · `art_card_mycelium_uncommon`
**Ancla:** *Racimo de Ostra* (`oyster_cluster`) y *Cortinario* (`mycelium_webcap`).
**Elemento clave:** racimo de sombrillas pálidas en abanico superpuestas · rama muerta de
soporte · red de filamentos violeta recorriendo la madera entre las setas · rim light suave

```text
Bioluminescent mycology game art, flat vector illustration with subtle film grain, matte
finish, no glossy 3D render look. Palette: deep indigo-teal ground #080b10 to #0d131b with
violet #a78bfa accents. Single bioluminescent light source above and slightly behind the
subject, short soft contact shadow, damp dark soil ground, faint low fog, crisp 2px darker
outline on focal shapes, high contrast when scaled to 200px. SUBJECT: an oyster mushroom
cluster, overlapping fan-shaped pale caps on a dead branch, a violet filament web running
between them along the wood, two-tone gradient from shadow between the caps to light on their
outer edges. RARITY uncommon: mild rim light, a few floating spore specks, slight asymmetry,
subject fills about 62% of the band. COMPOSITION: vertical 2:3, 1024x1488; the subject
occupies only the band from 18% to 62% of the image height (y 268 to y 922), the top 18% and
the bottom 38% stay dark, empty and free of detail; full-bleed background with no inner panel
and no frame; subject centred with a 10% side margin, silhouette readable at 96px wide.
NEGATIVE: text, letters, numbers, watermark, signature, logo, frame, border, card template,
UI mockup, rounded inner panel, photorealistic, photograph, glossy 3D render, harsh specular
highlights, multiple unrelated subjects, busy background, humans, hands, faces, blurry, low
contrast
```

---

#### 28 · `art_card_mycelium_rare`
**Ancla:** *Seta Anciana* (`mycelium_elder_web`).
**Elemento clave:** sombrilla violeta cubierta por un velo arácnido de hilos (cortina) ·
laminillas en capas · núcleo violeta luminoso · viñeta profunda · motas

```text
Bioluminescent mycology game art, flat vector illustration with subtle film grain, matte
finish, no glossy 3D render look. Palette: deep indigo-teal ground #080b10 to #0d131b with
violet #a78bfa accents. Single bioluminescent light source above and slightly behind the
subject, short soft contact shadow, damp dark soil ground, faint low fog, crisp 2px darker
outline on focal shapes, high contrast when scaled to 200px. SUBJECT: an elder webcap, a
violet-capped mushroom draped in a gossamer cortina web of hanging threads, layered gill
detail under the cap, a luminous violet core at its centre, particle motes, deep vignette.
RARITY rare: rich layered detail, strong bioluminescent core, particle motes, deep vignette,
teal-indigo contrast, secondary shapes behind the subject, subject fills about 70% of the
band. COMPOSITION: vertical 2:3, 1024x1488; the subject occupies only the band from 18% to
62% of the image height (y 268 to y 922), the top 18% and the bottom 38% stay dark, empty and
free of detail; full-bleed background with no inner panel and no frame; subject centred with a
10% side margin, silhouette readable at 96px wide. NEGATIVE: text, letters, numbers,
watermark, signature, logo, frame, border, card template, UI mockup, rounded inner panel,
photorealistic, photograph, glossy 3D render, harsh specular highlights, multiple unrelated
subjects, busy background, humans, hands, faces, blurry, low contrast
```

---

#### 29 · `art_card_mycelium_legendary`
**Ancla:** *Hongo de Miel* (`armillaria_honey`).
**Elemento clave:** racimo apretado de capas color miel en la base de un árbol moribundo ·
rizomorfos negros (cordones) recorriendo la corteza · rim light dorado · halo bloom · anillos
concéntricos
**Nota de producción:** el oro de la rareza y el miel del sujeto son el mismo matiz. El
contraste tiene que venir de **los cordones negros**, que son la firma visual de la
armillaria.

```text
Bioluminescent mycology game art, flat vector illustration with subtle film grain, matte
finish, no glossy 3D render look. Palette: deep indigo-teal ground #080b10 to #0d131b with
violet #a78bfa accents. Single bioluminescent light source above and slightly behind the
subject, short soft contact shadow, damp dark soil ground, faint low fog, crisp 2px darker
outline on focal shapes, high contrast when scaled to 200px. SUBJECT: a honey fungus cluster,
a tight bunch of golden-honey caps at the base of a dying tree, black rhizomorph bootlaces
crawling across the bark in contrast, ornate composition with fine ornamental detail, halo
bloom behind the cluster. RARITY legendary: golden-amber rim light, halo bloom, faint
concentric rings behind the subject, subject fills about 75% of the band. COMPOSITION:
vertical 2:3, 1024x1488; the subject occupies only the band from 18% to 62% of the image
height (y 268 to y 922), the top 18% and the bottom 38% stay dark, empty and free of detail;
full-bleed background with no inner panel and no frame; subject centred with a 10% side
margin, silhouette readable at 96px wide. NEGATIVE: text, letters, numbers, watermark,
signature, logo, frame, border, card template, UI mockup, rounded inner panel,
photorealistic, photograph, glossy 3D render, harsh specular highlights, multiple unrelated
subjects, busy background, humans, hands, faces, blurry, low contrast
```

---

#### 30 · `art_card_mycelium_mythic`
**Ancla:** **slot libre** (reservado para una mítica de micelio).
**Elemento clave:** red neural violeta a escala planetaria · núcleo brillante en el centro ·
hilos convergiendo como un cerebro · iridiscencia doble violeta + ámbar · anillo rúnico
flotante · claroscuro

```text
Bioluminescent mycology game art, flat vector illustration with subtle film grain, matte
finish, no glossy 3D render look. Palette: deep indigo-teal ground #080b10 to #0d131b with
violet #a78bfa accents. Single bioluminescent light source above and slightly behind the
subject, short soft contact shadow, damp dark soil ground, faint low fog, crisp 2px darker
outline on focal shapes, high contrast when scaled to 200px. SUBJECT: a planetary mycelial
network, a vast violet neural web spanning the frame with a bright nucleus in the middle,
threads converging toward the centre like a brain, dual violet and amber iridescence,
volumetric glow, maximal ornamental detail, dramatic chiaroscuro. RARITY mythic: dual-colour
iridescent bioluminescence, volumetric glow, a floating rune-like ring of spores, subject
fills about 80% of the band. COMPOSITION: vertical 2:3, 1024x1488; the subject occupies only
the band from 18% to 62% of the image height (y 268 to y 922), the top 18% and the bottom 38%
stay dark, empty and free of detail; full-bleed background with no inner panel and no frame;
subject centred with a 10% side margin, silhouette readable at 96px wide. NEGATIVE: text,
letters, numbers, watermark, signature, logo, frame, border, card template, UI mockup,
rounded inner panel, photorealistic, photograph, glossy 3D render, harsh specular highlights,
multiple unrelated subjects, busy background, humans, hands, faces, blurry, low contrast
```

---

### 3.7 Elemento `parasite` — magenta `#e05c8a`

**Sujeto canónico:** cordyceps y cornezuelo: el hongo que sale de otro ser vivo.
**Quién lo usa hoy:** 4 cartas (2 poco comunes, 2 raras).
**El peligro de esta familia:** el huésped. Si el huésped se dibuja con detalle anatómico,
la imagen se vuelve gore y deja de ser un deckbuilder de hongos. **El huésped es una
cáscara sin rasgos**: quitina lisa, sin ojos, sin patas articuladas, sin expresión.

---

#### 31 · `art_card_parasite_common`
**Ancla:** **slot libre** (reservado para una común de parásito).
**Elemento clave:** un solo brote magenta saliendo de una cáscara de escarabajo lisa · tierra
oscura · sin detalle anatómico · mínimo

```text
Bioluminescent mycology game art, flat vector illustration with subtle film grain, matte
finish, no glossy 3D render look. Palette: deep indigo-teal ground #080b10 to #0d131b with
magenta #e05c8a accents. Single bioluminescent light source above and slightly behind the
subject, short soft contact shadow, damp dark soil ground, faint low fog, crisp 2px darker
outline on focal shapes, high contrast when scaled to 200px. SUBJECT: a small parasitic
sprout breaking out of a smooth featureless beetle husk, one magenta stalk, a hollow shell
with no eyes and no legs, dark soil, minimal and restrained. RARITY common: three flat shapes
or fewer, a single accent glow, no particles, muted desaturated palette, subject fills about
55% of the band. COMPOSITION: vertical 2:3, 1024x1488; the subject occupies only the band
from 18% to 62% of the image height (y 268 to y 922), the top 18% and the bottom 38% stay
dark, empty and free of detail; full-bleed background with no inner panel and no frame;
subject centred with a 10% side margin, silhouette readable at 96px wide. NEGATIVE: text,
letters, numbers, watermark, signature, logo, frame, border, card template, UI mockup,
rounded inner panel, photorealistic, photograph, glossy 3D render, harsh specular highlights,
multiple unrelated subjects, busy background, humans, hands, faces, gore, blood, eyes,
detailed insect anatomy, blurry, low contrast
```

---

#### 32 · `art_card_parasite_uncommon`
**Ancla:** *Cordyceps Mental* (`cordyceps_mind`) y *Psilocybe Azul* (`psilocybe_azurea`).
**Elemento clave:** tallo magenta irrumpiendo de la cabeza de una cáscara de insecto lisa ·
zarcillos agarrando el caparazón · unas motas · rim light suave

```text
Bioluminescent mycology game art, flat vector illustration with subtle film grain, matte
finish, no glossy 3D render look. Palette: deep indigo-teal ground #080b10 to #0d131b with
magenta #e05c8a accents. Single bioluminescent light source above and slightly behind the
subject, short soft contact shadow, damp dark soil ground, faint low fog, crisp 2px darker
outline on focal shapes, high contrast when scaled to 200px. SUBJECT: a mind cordyceps, a
single magenta stalk erupting from the head of a smooth featureless insect husk, tendrils
gripping the shell, two-tone gradient along the stalk, a few drifting spore specks. RARITY
uncommon: mild rim light, slight asymmetry, subject fills about 62% of the band. COMPOSITION:
vertical 2:3, 1024x1488; the subject occupies only the band from 18% to 62% of the image
height (y 268 to y 922), the top 18% and the bottom 38% stay dark, empty and free of detail;
full-bleed background with no inner panel and no frame; subject centred with a 10% side
margin, silhouette readable at 96px wide. NEGATIVE: text, letters, numbers, watermark,
signature, logo, frame, border, card template, UI mockup, rounded inner panel,
photorealistic, photograph, glossy 3D render, harsh specular highlights, multiple unrelated
subjects, busy background, humans, hands, faces, gore, blood, eyes, detailed insect anatomy,
blurry, low contrast
```

---

#### 33 · `art_card_parasite_rare`
**Ancla:** *Cornezuelo del Centeno* (`ergot_rye`) y *Sombrero Azulado*
(`psilocybe_cyanescens`).
**Elemento clave:** espiga de centeno con los granos reemplazados por esclerocios
violeta-negros · venas magenta recorriendo el tallo · motas de polvo · viñeta profunda ·
ningún insecto

```text
Bioluminescent mycology game art, flat vector illustration with subtle film grain, matte
finish, no glossy 3D render look. Palette: deep indigo-teal ground #080b10 to #0d131b with
magenta #e05c8a accents. Single bioluminescent light source above and slightly behind the
subject, short soft contact shadow, damp dark soil ground, faint low fog, crisp 2px darker
outline on focal shapes, high contrast when scaled to 200px. SUBJECT: ergot of rye, a rye
spike whose grains are replaced by dark violet-black sclerotia, magenta veins running along
the stalk, layered detail on the spike, dust motes in the air, deep vignette. RARITY rare:
rich layered detail, strong bioluminescent core, particle motes, deep vignette, teal-indigo
contrast, secondary shapes behind the subject, subject fills about 70% of the band.
COMPOSITION: vertical 2:3, 1024x1488; the subject occupies only the band from 18% to 62% of
the image height (y 268 to y 922), the top 18% and the bottom 38% stay dark, empty and free of
detail; full-bleed background with no inner panel and no frame; subject centred with a 10%
side margin, silhouette readable at 96px wide. NEGATIVE: text, letters, numbers, watermark,
signature, logo, frame, border, card template, UI mockup, rounded inner panel,
photorealistic, photograph, glossy 3D render, harsh specular highlights, multiple unrelated
subjects, busy background, humans, hands, faces, gore, blood, eyes, detailed insect anatomy,
blurry, low contrast
```

---

#### 34 · `art_card_parasite_legendary`
**Ancla:** **slot libre** (reservado para una legendaria de parásito).
**Elemento clave:** crecimiento masivo consumiendo un caparazón grande y liso · zarcillos
gruesos sujetándolo · núcleo magenta incandescente · rim light ámbar-oro · halo bloom ·
anillos concéntricos

```text
Bioluminescent mycology game art, flat vector illustration with subtle film grain, matte
finish, no glossy 3D render look. Palette: deep indigo-teal ground #080b10 to #0d131b with
magenta #e05c8a accents. Single bioluminescent light source above and slightly behind the
subject, short soft contact shadow, damp dark soil ground, faint low fog, crisp 2px darker
outline on focal shapes, high contrast when scaled to 200px. SUBJECT: a hulking parasite
host, a massive cordyceps growth consuming a large smooth featureless carapace, thick
tendrils clamped around it, an incandescent magenta core inside the growth, ornate
composition with fine ornamental detail on the tendrils. RARITY legendary: golden-amber rim
light, halo bloom, faint concentric rings behind the subject, subject fills about 75% of the
band. COMPOSITION: vertical 2:3, 1024x1488; the subject occupies only the band from 18% to
62% of the image height (y 268 to y 922), the top 18% and the bottom 38% stay dark, empty and
free of detail; full-bleed background with no inner panel and no frame; subject centred with a
10% side margin, silhouette readable at 96px wide. NEGATIVE: text, letters, numbers,
watermark, signature, logo, frame, border, card template, UI mockup, rounded inner panel,
photorealistic, photograph, glossy 3D render, harsh specular highlights, multiple unrelated
subjects, busy background, humans, hands, faces, gore, blood, eyes, detailed insect anatomy,
blurry, low contrast
```

---

#### 35 · `art_card_parasite_mythic`
**Ancla:** **slot libre** (reservado para una mítica de parásito).
**Elemento clave:** columnata vertical de muchos huéspedes pequeños unidos por **una sola**
red magenta · una figura central dominante · iridiscencia doble magenta + violeta · glow
volumétrico · anillo rúnico flotante · claroscuro

```text
Bioluminescent mycology game art, flat vector illustration with subtle film grain, matte
finish, no glossy 3D render look. Palette: deep indigo-teal ground #080b10 to #0d131b with
magenta #e05c8a accents. Single bioluminescent light source above and slightly behind the
subject, short soft contact shadow, damp dark soil ground, faint low fog, crisp 2px darker
outline on focal shapes, high contrast when scaled to 200px. SUBJECT: a mycelial puppeteer, a
vertical colonnade of many small featureless hosts bound by one single magenta network, one
dominant central figure, dual magenta and violet iridescence, volumetric glow, maximal
ornamental detail, dramatic chiaroscuro. RARITY mythic: dual-colour iridescent
bioluminescence, volumetric glow, a floating rune-like ring of spores, subject fills about
80% of the band. COMPOSITION: vertical 2:3, 1024x1488; the subject occupies only the band
from 18% to 62% of the image height (y 268 to y 922), the top 18% and the bottom 38% stay
dark, empty and free of detail; full-bleed background with no inner panel and no frame;
subject centred with a 10% side margin, silhouette readable at 96px wide. NEGATIVE: text,
letters, numbers, watermark, signature, logo, frame, border, card template, UI mockup,
rounded inner panel, photorealistic, photograph, glossy 3D render, harsh specular highlights,
multiple unrelated subjects, busy background, humans, hands, faces, gore, blood, eyes,
detailed insect anatomy, blurry, low contrast
```

---

### 3.8 Elemento `neutral` — gris-azulado `#9aa5b1`

**Sujeto canónico:** un hongo de bosque común, sin ceremonia.
**Quién lo usa hoy:** **nadie.** Los 5 slots están libres: ninguna de las 35 cartas es
`neutral` (es el elemento reservado para los jokers, que hoy no declaran elemento). Son los
últimos 5 en prioridad, pero **no los saltees**: son los que van a usar los jokers cuando
tengan elemento, y sin ellos la cadena de respaldo manda un joker neutral a `art_mycelium`.
**El peligro de esta familia:** es la familia más aburrida por diseño, y eso está bien —
`neutral` tiene que significar "sin elemento" también en el arte. El interés viene de la
**luz fría gris** y de la forma, no del color.

---

#### 36 · `art_card_neutral_common`
**Ancla:** **slot libre** (ninguna carta; reservado para jokers neutros).
**Elemento clave:** una sombrilla beige lisa y suave · tallo corto y grueso · musgo oscuro ·
un glow gris suave · sin ningún acento de color

```text
Bioluminescent mycology game art, flat vector illustration with subtle film grain, matte
finish, no glossy 3D render look. Palette: deep indigo-teal ground #080b10 to #0d131b with
muted grey-blue #9aa5b1 accents. Single bioluminescent light source above and slightly behind
the subject, short soft contact shadow, damp dark moss ground, faint low fog, crisp 2px
darker outline on focal shapes, high contrast when scaled to 200px. SUBJECT: a plain woodland
mushroom, a smooth beige cap, a short stout stem, calm and completely unremarkable, standing
on dark moss with one soft grey glow. RARITY common: three flat shapes or fewer, a single
accent glow, no particles, muted desaturated palette, subject fills about 55% of the band.
COMPOSITION: vertical 2:3, 1024x1488; the subject occupies only the band from 18% to 62% of
the image height (y 268 to y 922), the top 18% and the bottom 38% stay dark, empty and free of
detail; full-bleed background with no inner panel and no frame; subject centred with a 10%
side margin, silhouette readable at 96px wide. NEGATIVE: text, letters, numbers, watermark,
signature, logo, frame, border, card template, UI mockup, rounded inner panel,
photorealistic, photograph, glossy 3D render, harsh specular highlights, multiple unrelated
subjects, busy background, humans, hands, faces, blurry, low contrast, saturated colours
```

---

#### 37 · `art_card_neutral_uncommon`
**Ancla:** **slot libre.**
**Elemento clave:** dos sombrillas lisas, una más alta · gradiente de dos tonos grises · rim
light frío suave · unas motas · asimetría leve

```text
Bioluminescent mycology game art, flat vector illustration with subtle film grain, matte
finish, no glossy 3D render look. Palette: deep indigo-teal ground #080b10 to #0d131b with
muted grey-blue #9aa5b1 accents. Single bioluminescent light source above and slightly behind
the subject, short soft contact shadow, damp dark moss ground, faint low fog, crisp 2px
darker outline on focal shapes, high contrast when scaled to 200px. SUBJECT: two plain
woodland mushrooms side by side, smooth beige caps, one noticeably taller than the other, a
soft grey-blue rim light along their edges, two-tone gradient across the caps, a few floating
specks. RARITY uncommon: mild rim light, slight asymmetry, subject fills about 62% of the
band. COMPOSITION: vertical 2:3, 1024x1488; the subject occupies only the band from 18% to
62% of the image height (y 268 to y 922), the top 18% and the bottom 38% stay dark, empty and
free of detail; full-bleed background with no inner panel and no frame; subject centred with a
10% side margin, silhouette readable at 96px wide. NEGATIVE: text, letters, numbers,
watermark, signature, logo, frame, border, card template, UI mockup, rounded inner panel,
photorealistic, photograph, glossy 3D render, harsh specular highlights, multiple unrelated
subjects, busy background, humans, hands, faces, blurry, low contrast, saturated colours
```

---

#### 38 · `art_card_neutral_rare`
**Ancla:** **slot libre.**
**Elemento clave:** pequeña tropa de sombrillas beige emergiendo de niebla baja · capas a
distinta altura · núcleo blanco-gris frío · motas · viñeta profunda

```text
Bioluminescent mycology game art, flat vector illustration with subtle film grain, matte
finish, no glossy 3D render look. Palette: deep indigo-teal ground #080b10 to #0d131b with
muted grey-blue #9aa5b1 accents. Single bioluminescent light source above and slightly behind
the subject, short soft contact shadow, damp dark moss ground, faint low fog, crisp 2px
darker outline on focal shapes, high contrast when scaled to 200px. SUBJECT: a small troop of
plain beige mushrooms emerging from low fog, caps at different heights forming a layered
cluster, a cold grey-white core glow at the centre of the group, particle motes, deep
vignette. RARITY rare: rich layered detail, strong bioluminescent core, particle motes, deep
vignette, teal-indigo contrast, secondary shapes behind the subject, subject fills about 70%
of the band. COMPOSITION: vertical 2:3, 1024x1488; the subject occupies only the band from
18% to 62% of the image height (y 268 to y 922), the top 18% and the bottom 38% stay dark,
empty and free of detail; full-bleed background with no inner panel and no frame; subject
centred with a 10% side margin, silhouette readable at 96px wide. NEGATIVE: text, letters,
numbers, watermark, signature, logo, frame, border, card template, UI mockup, rounded inner
panel, photorealistic, photograph, glossy 3D render, harsh specular highlights, multiple
unrelated subjects, busy background, humans, hands, faces, blurry, low contrast, saturated
colours
```

---

#### 39 · `art_card_neutral_legendary`
**Ancla:** **slot libre.**
**Elemento clave:** sombrilla beige enorme y desgastada sobre tallo grueso · halo gris-blanco
· anillos concéntricos detrás · rim light dorado rompiendo la neutralidad · detalle de
laminillas

```text
Bioluminescent mycology game art, flat vector illustration with subtle film grain, matte
finish, no glossy 3D render look. Palette: deep indigo-teal ground #080b10 to #0d131b with
muted grey-blue #9aa5b1 accents. Single bioluminescent light source above and slightly behind
the subject, short soft contact shadow, damp dark moss ground, faint low fog, crisp 2px
darker outline on focal shapes, high contrast when scaled to 200px. SUBJECT: an elder plain
mushroom, a huge smooth beige cap on a thick weathered stem, a grey-white halo bloom behind
the cap, intricate gill detail underneath, ornate composition, a warm golden rim light
breaking the neutrality along the silhouette. RARITY legendary: golden-amber rim light, halo
bloom, faint concentric rings behind the subject, subject fills about 75% of the band.
COMPOSITION: vertical 2:3, 1024x1488; the subject occupies only the band from 18% to 62% of
the image height (y 268 to y 922), the top 18% and the bottom 38% stay dark, empty and free of
detail; full-bleed background with no inner panel and no frame; subject centred with a 10%
side margin, silhouette readable at 96px wide. NEGATIVE: text, letters, numbers, watermark,
signature, logo, frame, border, card template, UI mockup, rounded inner panel,
photorealistic, photograph, glossy 3D render, harsh specular highlights, multiple unrelated
subjects, busy background, humans, hands, faces, blurry, low contrast, saturated colours
```

---

#### 40 · `art_card_neutral_mythic`
**Ancla:** **slot libre.**
**Elemento clave:** hongo colosal gris-blanco monocromo · brillo nacarado iridiscente sobre la
capa · glow volumétrico · anillo rúnico flotante · claroscuro dramático · máximo detalle

```text
Bioluminescent mycology game art, flat vector illustration with subtle film grain, matte
finish, no glossy 3D render look. Palette: deep indigo-teal ground #080b10 to #0d131b with
muted grey-blue #9aa5b1 accents. Single bioluminescent light source above and slightly behind
the subject, short soft contact shadow, damp dark moss ground, faint low fog, crisp 2px
darker outline on focal shapes, high contrast when scaled to 200px. SUBJECT: a pale
monochrome titan, a colossal smooth grey-white mushroom with a pearl iridescent sheen
shifting across the cap, volumetric glow, floating rune-like ring of spores, maximal
ornamental detail, dramatic chiaroscuro. RARITY mythic: dual-colour iridescent
bioluminescence, volumetric glow, a floating rune-like ring of spores, subject fills about
80% of the band. COMPOSITION: vertical 2:3, 1024x1488; the subject occupies only the band
from 18% to 62% of the image height (y 268 to y 922), the top 18% and the bottom 38% stay
dark, empty and free of detail; full-bleed background with no inner panel and no frame;
subject centred with a 10% side margin, silhouette readable at 96px wide. NEGATIVE: text,
letters, numbers, watermark, signature, logo, frame, border, card template, UI mockup,
rounded inner panel, photorealistic, photograph, glossy 3D render, harsh specular highlights,
multiple unrelated subjects, busy background, humans, hands, faces, blurry, low contrast,
saturated colours
```

## 4. Cobertura: qué slots consume el contenido de hoy

23 de los 40 slots tienen carta. Los otros 17 son para expansiones — **generá igual los 8
`common`**, porque son el respaldo de todas las cartas de su elemento.

| # | Slot | Cartas que lo usan hoy |
| --- | --- | --- |
| 01 | `card_poison_common` | *Amanita Tóxica* |
| 02 | `card_poison_uncommon` | *Amanita Pantera*, *Amanita Suprema* |
| 03 | `card_poison_rare` | — |
| 04 | `card_poison_legendary` | *Oronja Verde* |
| 05 | `card_poison_mythic` | *Ángel Destructor* |
| 06 | `card_spore_common` | *Bejín*, *Sombrero Velado* |
| 07 | `card_spore_uncommon` | *Bejín Gigante* |
| 08 | `card_spore_rare` | *Anillo de Matamoscas* |
| 09 | `card_spore_legendary` | — |
| 10 | `card_spore_mythic` | — |
| 11 | `card_decay_common` | *Poliporo*, *Madera Podrida* |
| 12 | `card_decay_uncommon` | *Cola de Pavo*, *Tocón Ancestral* |
| 13 | `card_decay_rare` | — |
| 14 | `card_decay_legendary` | *Anciano del Bosque* |
| 15 | `card_decay_mythic` | — |
| 16 | `card_symbiosis_common` | *Boleto*, *Micorriza* |
| 17 | `card_symbiosis_uncommon` | *Colmenilla Premiada* |
| 18 | `card_symbiosis_rare` | *Rebozuelo Dorado* |
| 19 | `card_symbiosis_legendary` | — |
| 20 | `card_symbiosis_mythic` | — |
| 21 | `card_crystal_common` | *Hongo Coral*, *Sombrero de Vidrio* |
| 22 | `card_crystal_uncommon` | *Melena de León* |
| 23 | `card_crystal_rare` | *Elixir de Reishi*, *Hongo Fantasma*, *Coral Mayor* |
| 24 | `card_crystal_legendary` | *Mycena Lucifer* |
| 25 | `card_crystal_mythic` | — |
| 26 | `card_mycelium_common` | *Hilo Micelial*, *Cortinario*, *Shiitake Robusto* |
| 27 | `card_mycelium_uncommon` | *Racimo de Ostra* |
| 28 | `card_mycelium_rare` | *Seta Anciana* |
| 29 | `card_mycelium_legendary` | *Hongo de Miel* |
| 30 | `card_mycelium_mythic` | — |
| 31 | `card_parasite_common` | — |
| 32 | `card_parasite_uncommon` | *Psilocybe Azul*, *Cordyceps Mental* |
| 33 | `card_parasite_rare` | *Sombrero Azulado*, *Cornezuelo del Centeno* |
| 34 | `card_parasite_legendary` | — |
| 35 | `card_parasite_mythic` | — |
| 36–40 | `card_neutral_*` (×5) | — (reservado para jokers con elemento) |

**Un detalle de producción que sale de esta tabla:** `card_crystal_rare` lo comparten tres
cartas con identidades muy distintas (*Reishi*, *Fantasma*, *Coral Mayor*). Es el único slot
donde conviene generar las 3 variantes y elegir pensando en *Coral Mayor*, que es la que más
peso tiene en la colección.

---

## 5. Los 25 iconos SVG

### 5.1 El contrato técnico (no negociable)

Un icono que no cumple esto **no se puede integrar**: no se tinta, no escala o rompe el
linter del set.

| Regla | Valor | Por qué |
| --- | --- | --- |
| Formato | SVG, un archivo por icono | vectorial, nitidez a cualquier tamaño |
| Nombre | `public/art/ui_icon_<id>.svg` | es la convención que ya declara el README |
| `viewBox` | `0 0 24 24` | grilla de 24: los tamaños de uso (16/20/24) son múltiplos limpios |
| `width` / `height` | **ausentes** | el tamaño lo pone el CSS; con atributos fijos no escala |
| Color | `fill="none"`, `stroke="currentColor"` | así el CSS lo tinta con `color:` y funciona en los dos temas |
| Trazo | `stroke-width="2"`, `linecap="round"`, `linejoin="round"` | consistencia entre los 25 |
| Caja segura | geometría dentro de 2–22 | el trazo de 2 px se sale si tocás el borde |
| Prohibido | `<text>`, `<style>`, `id`, `<filter>`, gradientes, colores hardcodeados | rompen el tintado o ensucian el DOM |
| Estructura | un `<svg>` raíz, como máximo un `<g>` | fácil de diffear y de optimizar |
| Legibilidad | tiene que leerse a **16 px** | es el tamaño real en los botones del HUD |

### 5.2 Prompt de sistema (pegá esto antes de cada icono, o usalo como contexto del chat)

```text
You are generating one icon of a coherent 25-icon set for a dark bioluminescent mushroom
deckbuilder. Follow this contract exactly for every icon:
- Output one SVG file only, no explanation, no markdown fences.
- Root: <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"
  stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">.
- No width or height attributes. No <text>. No <style>. No id attributes. No gradients.
  No filters. No hardcoded colour values. At most one <g>.
- All geometry inside a 2 to 22 coordinate box so the 2px stroke never clips.
- Monochrome line art, stroke only, uniform 2px weight, rounded caps and joins.
- Geometric and simplified, not illustrative: this is a UI icon, not a drawing.
- Must be legible at 16x16 px: no detail thinner than 1 unit, no more than ~7 path elements.
- Optical centring: the visual mass sits at (12,12), even if the geometry is asymmetric.
```

### 5.3 Los 25 iconos

Cada prompt asume el contrato de §5.2. Si tu herramienta no mantiene contexto entre
mensajes, pegá §5.2 y el prompt del icono en el mismo mensaje.

---

#### I01 · `ui_icon_money`
**Propósito:** contador de dinero del HUD (`hud.money`), precios de la tienda y botón
*Vender* (`action.sell`). **Detalle:** bajo, 3 elementos. **Uso:** 16 px en el HUD.

```text
Produce a single SVG file named ui_icon_money.svg following the icon system contract above.
GLYPH: a coin with a sprout inside it. One circle centred at (12,12) with r=8.5. Inside the
coin, a sprout: a vertical stem from (12,17) to (12,10.5), and two leaves drawn as short
arcs curving outward and upward from the top of the stem, one to the left ending near (8,9)
and one to the right ending near (16,9). No other marks inside the circle.
```

---

#### I02 · `ui_icon_hand`
**Propósito:** manos restantes en la ronda (`hud.hands`) y contador de la mano. **Detalle:**
medio, 6 elementos. **Uso:** 16 px.

```text
Produce a single SVG file named ui_icon_hand.svg following the icon system contract above.
GLYPH: an open palm seen from the front, not a pointing hand. A palm block: rounded rectangle
from (8,12) to (16,20) with corner radius 2. Four finger strokes rising from the top edge of
the palm at x = 8.5, 11, 13.5 and 16, each a vertical line from y=12 up to y=6.5 with a
rounded cap. A thumb: one arc starting at (8,14) curving left and up to end at (5.5,11).
```

---

#### I03 · `ui_icon_discard`
**Propósito:** descartes restantes (`hud.discards`) y botón *Descartar*
(`action.discard`). **Detalle:** bajo, 3 elementos. **Uso:** 16–18 px.

```text
Produce a single SVG file named ui_icon_discard.svg following the icon system contract above.
GLYPH: an arrow going down into a tray. The tray is an open polyline: (4,15) to (4,20) to
(20,20) to (20,15). The arrow is a vertical line from (12,4) to (12,15) plus a chevron head
made of two strokes: (8.5,11.5) to (12,15) and (15.5,11.5) to (12,15).
```

---

#### I04 · `ui_icon_ante`
**Propósito:** indicador de ante del HUD (`hud.ante`) y progresión de dificultad.
**Detalle:** bajo, 4 elementos. **Uso:** 16 px.

```text
Produce a single SVG file named ui_icon_ante.svg following the icon system contract above.
GLYPH: a rising three-step stair. Three horizontal strokes, left-aligned at x=4: the first
from (4,20) to (12,20), the second from (4,15) to (16,15), the third from (4,10) to (20,10),
each with a rounded cap. Plus one short vertical connector from (12,20) to (12,15) and one
from (16,15) to (16,10) so the three steps read as a single ascending structure.
```

---

#### I05 · `ui_icon_joker_slot`
**Propósito:** ranuras de joker (`hud.jokers`) y el slot vacío de la tienda. **Detalle:**
bajo, 4 elementos. **Uso:** 16 px.

```text
Produce a single SVG file named ui_icon_joker_slot.svg following the icon system contract
above. GLYPH: an empty card slot. A card outline: rounded rectangle from (7,3.5) to (17,20.5)
with corner radius 2. Inside it, one small four-point sparkle centred at (12,12): a vertical
stroke from (12,9.5) to (12,14.5) and a horizontal stroke from (9.5,12) to (14.5,12).
```

---

#### I06 · `ui_icon_reroll`
**Propósito:** botón de reroll de la tienda, junto a `shop.rerollCost`. **Detalle:** medio,
3 elementos. **Uso:** 18 px.

```text
Produce a single SVG file named ui_icon_reroll.svg following the icon system contract above.
GLYPH: two circular arrows forming a closed refresh loop. The top arc runs from (19,12)
counter-clockwise over the top to (5,12) as a single curved path. The bottom arc runs from
(5,12) clockwise under the bottom back to (19,12). Add one small arrowhead at the end of each
arc: two short strokes forming a chevron at the left end of the top arc and at the right end
of the bottom arc.
```

---

#### I07 · `ui_icon_sell`
**Propósito:** botón *Vender* de la tienda (`action.sell`). **Detalle:** bajo, 3 elementos.
**Uso:** 18 px.

```text
Produce a single SVG file named ui_icon_sell.svg following the icon system contract above.
GLYPH: a price tag. A square with corner radius 2 rotated 45 degrees around its centre at
(11,11), sized so its corners reach roughly (4,11), (11,4), (18,11) and (11,18). A small
circle with r=1.6 centred at (11,8) as the tag hole. A small coin: a circle with r=3 centred
at (19,19).
```

---

#### I08 · `ui_icon_settings`
**Propósito:** entrada de Ajustes del menú (`menu.settings`). **Detalle:** medio, 9
elementos. **Uso:** 18 px.

```text
Produce a single SVG file named ui_icon_settings.svg following the icon system contract
above. GLYPH: a gear. One circle centred at (12,12) with r=3.2. One larger ring centred at
(12,12) with r=7.8. Eight short radial spokes connecting the inner circle to the outer ring
at 45-degree intervals, each drawn as a straight stroke from the inner circle outward to
r=7.8. Simplified spokes rather than a toothed polygon, because teeth disappear at 16px.
```

---

#### I09 · `ui_icon_language`
**Propósito:** selector de idioma de Ajustes (`settings.language`). **Detalle:** bajo, 3
elementos. **Uso:** 18 px.

```text
Produce a single SVG file named ui_icon_language.svg following the icon system contract
above. GLYPH: a globe. One circle centred at (12,12) with r=8.5. One vertical ellipse centred
at (12,12) with rx=4 and ry=8.5 as a closed curved path. One horizontal line from (3.5,12) to
(20.5,12) across the equator. No continents, no text.
```

---

#### I10 · `ui_icon_collection`
**Propósito:** entrada de Colección del menú (`menu.collection`). **Detalle:** bajo, 3
elementos. **Uso:** 18 px.

```text
Produce a single SVG file named ui_icon_collection.svg following the icon system contract
above. GLYPH: three cards fanned out. One upright card outline: rounded rectangle from
(8.5,4) to (15.5,20) with corner radius 1.5. Behind it, one card rotated about 12 degrees
counter-clockwise around its bottom centre, and another rotated about 12 degrees clockwise,
both the same size, so only their outer edges show.
```

---

#### I11 · `ui_icon_store`
**Propósito:** entrada de Expansiones / tienda de contenido (`store.comingSoon`).
**Detalle:** medio, 5 elementos. **Uso:** 18 px.

```text
Produce a single SVG file named ui_icon_store.svg following the icon system contract above.
GLYPH: a shop awning. A horizontal stroke from (3.5,8.5) to (20.5,8.5). Three hanging
scallops under it, each a downward arc, spanning (3.5,8.5)-(9,8.5), (9,8.5)-(15,8.5) and
(15,8.5)-(20.5,8.5), each dipping to about y=11. A body outline below: (5.5,8.5) down to
(5.5,20.5), across to (18.5,20.5), up to (18.5,8.5). A small door notch: a rounded rectangle
from (10.5,15) to (13.5,20.5).
```

---

#### I12 · `ui_icon_lock`
**Propósito:** cartas no descubiertas (`collection.locked`) y contenido bloqueado por
entitlement. **Detalle:** medio, 4 elementos. **Uso:** 16–20 px.

```text
Produce a single SVG file named ui_icon_lock.svg following the icon system contract above.
GLYPH: a padlock. A shackle: a semicircular arc centred at (12,10.5) with r=3.5, running from
(8.5,10.5) up over the top to (15.5,10.5). A body: rounded rectangle from (6,10.5) to (18,20.5)
with corner radius 2. A keyhole: a small circle with r=1.2 centred at (12,14.5) plus a short
vertical stroke from (12,15.5) to (12,17.5).
```

---

#### I13 · `ui_icon_xp`
**Propósito:** experiencia del pase de batalla. **Detalle:** bajo, 1 elemento. **Uso:**
16–18 px.

```text
Produce a single SVG file named ui_icon_xp.svg following the icon system contract above.
GLYPH: a five-point star, geometric and centred at (12,12). Outer radius 8, inner radius 3.4,
points at angles -90, -18, 54, 126 and 198 degrees, drawn as one closed path with rounded
joins. No circle behind it, no fill.
```

#### I14 · `ui_icon_tier`
**Propósito:** nivel del pase de batalla y escalón de ante alcanzado. **Detalle:** medio, 2
elementos. **Uso:** 18 px.

```text
Produce a single SVG file named ui_icon_tier.svg following the icon system contract above.
GLYPH: a three-pointed crown. One open polyline path: start at (4,20), up to (4,9), across
and down to (8,14), up to (12,6.5), down to (16,14), up to (20,9), down to (20,20), then
close the base with a straight line back to (4,20). Rounded joins. No jewels, no dots on the
points.
```

---

#### I15 · `ui_icon_claim`
**Propósito:** reclamar una recompensa del pase o del draft. **Detalle:** medio, 5
elementos. **Uso:** 18–20 px.

```text
Produce a single SVG file named ui_icon_claim.svg following the icon system contract above.
GLYPH: a wrapped gift box. A box body: rounded rectangle from (5,12) to (19,20.5) with corner
radius 1.5. A lid: rounded rectangle from (3.5,9) to (20.5,12) with corner radius 1.5. A
vertical ribbon stroke from (12,9) down to (12,20.5). A bow above the lid: two small loops,
one arc from (12,9) curving up-left to (8,6) and back, and one mirroring it to the right,
ending at (16,6).
```

---

#### I16 · `ui_icon_upgrade`
**Propósito:** acción de mejorar una carta de nivel (tienda y mazo). **Detalle:** bajo, 2
elementos. **Uso:** 16–18 px.

```text
Produce a single SVG file named ui_icon_upgrade.svg following the icon system contract above.
GLYPH: a double upward chevron, the universal level-up mark. Upper chevron: (6,12.5) to
(12,6.5) to (18,12.5). Lower chevron directly beneath it: (6,18.5) to (12,12.5) to (18,18.5).
Both as open polylines with rounded joins. Nothing else.
```

---

#### I17 · `ui_icon_evolve`
**Propósito:** acción de evolucionar una carta a otra especie. **Detalle:** medio, 4
elementos. **Uso:** 16–18 px.

```text
Produce a single SVG file named ui_icon_evolve.svg following the icon system contract above.
GLYPH: a small mushroom inside a circular arrow. The mushroom: a cap drawn as an arc from
(9.5,11.5) over the top to (14.5,11.5) closing with a straight line across, plus a short stem
from (12,11.5) down to (12,15). The circular arrow: an arc centred at (12,12) with r=8.5
running from about (17.5,6.5) clockwise three quarters of the way round to (6.5,17.5), with
one small chevron arrowhead at its end.
```

---

#### I18 · `ui_icon_flip`
**Propósito:** girar una carta (boca abajo / boca arriba) en el duelo y en el tutorial.
**Detalle:** medio, 3 elementos. **Uso:** 16–18 px.

```text
Produce a single SVG file named ui_icon_flip.svg following the icon system contract above.
GLYPH: a card turning over on its vertical axis. A card outline: rounded rectangle from
(7,4) to (17,20) with corner radius 1.5. A curved arrow sweeping around its right side: one
arc from (18.5,8) bulging right to about x=20.5 at mid-height and coming back to (18.5,16),
with a small chevron arrowhead at the lower end of the arc pointing left toward the card.
```

---

#### I19 · `ui_icon_drag`
**Propósito:** pista de gesto en el tutorial (arrastrar una carta a una zona). **Detalle:**
medio, 5 elementos. **Uso:** 18 px.

```text
Produce a single SVG file named ui_icon_drag.svg following the icon system contract above.
GLYPH: a simplified hand cursor with motion lines. The hand: a rounded rectangle palm from
(9,13) to (16,20) with corner radius 2, one extended index finger as a vertical stroke from
(11.5,13) up to (11.5,6), and a thumb as a short arc from (9,15) curving left to (7,13). Two
motion lines to the left: (4,11) to (6.5,11) and (3,15) to (6,15).
```

---

#### I20 · `ui_icon_hotseat`
**Propósito:** modo de duelo local (`board.hotseat`). **Detalle:** medio, 5 elementos.
**Uso:** 20 px.

```text
Produce a single SVG file named ui_icon_hotseat.svg following the icon system contract above.
GLYPH: two players side by side facing each other. Left player: a circle with r=2.6 centred
at (7,9) and a shoulder arc beneath it, an arc from (3,18) over to (11,18) bulging up to
y=12.5. Right player: the same mirrored around x=17: a circle with r=2.6 centred at (17,9)
and an arc from (13,18) to (21,18) bulging up to y=12.5. Between them, one short
double-headed arrow at y=17: a horizontal stroke from (9.5,17) to (14.5,17) with a small
chevron at each end.
```

---

#### I21 · `ui_icon_online`
**Propósito:** duelo en línea (hoy deshabilitado, `board.online`). **Detalle:** bajo, 4
elementos. **Uso:** 20 px.

```text
Produce a single SVG file named ui_icon_online.svg following the icon system contract above.
GLYPH: a small network graph. Three nodes as circles: r=2.2 centred at (6,18), (18,18) and
(12,6). Two connecting strokes: one from (7.6,16.6) to (10.8,7.4) and one from (13.2,7.4) to
(16.4,16.6). One more stroke joining the two lower nodes: from (8.2,18) to (15.8,18).
```

---

#### I22 · `ui_icon_sfx`
**Propósito:** control de efectos de sonido (`settings.sfx`). **Detalle:** medio, 3
elementos. **Uso:** 18 px.

```text
Produce a single SVG file named ui_icon_sfx.svg following the icon system contract above.
GLYPH: a speaker with two sound waves. The speaker body as one closed path: (4,9.5) to
(9,9.5) to (13,5.5) to (13,18.5) to (9,14.5) to (4,14.5), closed. Two arcs to the right of
it: a smaller arc centred at (13,12) with r=4 running from (14,9) to (14,15), and a larger
arc centred at (13,12) with r=7 running from (16,6.5) to (16,17.5).
```

---

#### I23 · `ui_icon_music`
**Propósito:** control de música (`settings.music`). **Detalle:** bajo, 3 elementos. **Uso:**
18 px.

```text
Produce a single SVG file named ui_icon_music.svg following the icon system contract above.
GLYPH: a single eighth note. One note head: an ellipse centred at (9,17.5) with rx=3 and
ry=2.2, rotated about -20 degrees. One stem: a vertical stroke from (12,17) up to (12,5.5).
One flag: a curve starting at (12,5.5) sweeping right and down to end at (17,8.5).
```

---

#### I24 · `ui_icon_haptics`
**Propósito:** control de vibración (`settings.haptics`). **Detalle:** medio, 5 elementos.
**Uso:** 18 px.

```text
Produce a single SVG file named ui_icon_haptics.svg following the icon system contract above.
GLYPH: a phone vibrating. A phone body: rounded rectangle from (8.5,3.5) to (15.5,20.5) with
corner radius 2. A home dot: a small circle with r=0.8 centred at (12,18). Motion arcs on
both sides: on the left, two short arcs bulging left, one from (6.5,8) to (6.5,12) and one
from (4.5,6.5) to (4.5,13.5); mirror both on the right side around x=12.
```

---

#### I25 · `ui_icon_close`
**Propósito:** cerrar cualquier panel (`settings.close`, `board.close`, overlays).
**Detalle:** mínimo, 1 elemento. **Uso:** 20–24 px.

```text
Produce a single SVG file named ui_icon_close.svg following the icon system contract above.
GLYPH: an X. Two straight strokes: one from (6,6) to (18,18) and one from (18,6) to (6,18),
both with rounded caps. Nothing else.
```

---

## 6. Nomenclatura: una sola tabla de verdad

| Asset | Archivo de origen | Archivo final | Clave en el código |
| --- | --- | --- | --- |
| Ilustración de carta | `art-source/art_card_<elem>_<rar>.png` | `public/art/art_card_<elem>_<rar>.webp` | `card_<elem>_<rar>` |
| Dorso | `art-source/art_cardback.png` | `public/art/art_cardback.webp` | `art_cardback` |
| Tapete | `art-source/art_table.png` | `public/art/art_table.webp` | `art_table` |
| Icono de UI | — (SVG directo) | `public/art/ui_icon_<id>.svg` | *(no pasa por `ArtAssets`)* |
| Logo | `art-source/ui_logo_mark.png` | `public/art/ui_logo_mark.webp` | *(no pasa por `ArtAssets`)* |

**Elementos (8, en este orden):** `neutral` `poison` `spore` `decay` `symbiosis` `crystal`
`mycelium` `parasite`
**Rarezas (5, en este orden):** `common` `uncommon` `rare` `legendary` `mythic`

Los iconos **no** los carga `ArtAssets` (que solo indexa `.webp` de `public/art/`): son SVG
inline o `<img>` en el HUD, y el `viewBox` de 24 los hace independientes del tamaño. Si más
adelante se quieren como sprite, se puede generar un `ui_icons.svg` con `<symbol id="...">`
sin tocar los 25 archivos.

---

## 7. Orden de implementación

Seis lotes. **Cada lote termina con el juego jugable** (gracias a la cadena de respaldo), así
que se puede parar en cualquier punto y shipear.

| Lote | Qué | Archivos | Por qué en este orden |
| --- | --- | --- | --- |
| **L1** | Los 8 `common` (6 con carta + `parasite` y `neutral`, que hoy están libres) | 8 | **Es el lote de mayor impacto del proyecto.** El respaldo manda a `card_<elem>_common` desde cualquier rareza, así que estos 8 archivos reemplazan de una las 9 ilustraciones viejas para las 30 cartas. Con 8 imágenes el juego cambia de cara. |
| **L2** | Las 4 legendarias y la única mítica que existen | 5 | Son las cartas que el jugador muestra: la legendaria y la mítica son el momento de la partida. |
| **L3** | Los 7 `uncommon` y los 5 `rare` con carta | 12 | Completan la variedad real: los 23 slots con contenido quedan cubiertos. |
| **L4** | Los 15 slots libres que quedan | 15 | Contenido de expansión. Generar sin apuro, cuando L1–L3 ya estén en el juego. |
| **L5** | Los 25 iconos SVG | 25 | Independiente de las ilustraciones: se puede hacer en paralelo, y necesita una pasada de UI para usarlos. |
| **L6** | Limpieza | 11 borrados | **Solo cuando los 40 existan**: recién ahí se pueden borrar los 11 `.webp` viejos (`art_poison`, …, `art_legendary`, `art_mythic`), quitar el eslabón 3 de `artKeysFor()` y el `LEGACY_FILES` de `ArtAssets.ts`. Antes de eso, borrarlos deja huecos. |

**Los 40 slots reparten así:** 23 con carta + 17 libres (2 de esos libres entran en L1 como
`common`, así que L4 queda con 15). **Con L1 + L2 + L3 —25 archivos— el arte del juego está
terminado a efectos prácticos.**

> **Estado: L1 a L4 hechos, 40/40 archivos en disco.** Se generaron en el orden de este plan
> (primero los 8 `common`, después las rarezas de cada familia ancladas en su propio
> `common`), y el resultado está en `art-source/` + `public/art/`. **L6 (borrar los 11
> viejos) sigue pendiente a propósito**: primero hay que jugar una temporada con los 40 y
> confirmar que ningún slot nuevo decepciona, porque una vez borrados los viejos ya no hay
> red de contención para ese elemento.
>
> La única corrección posterior fue **`crystal_legendary`**: la primera pasada salió con la
> misma silueta de coral que `crystal_common` (el ancla arrastra la forma). Se regeneró
> pidiendo explícitamente *"FIVE tall thin SEPARATE vertical stems … NOT one thick branching
> coral and NOT a single mushroom"*. Es el caso testigo de la trampa de §1.3: **cuando dos
> rarezas del mismo elemento comparten forma, no alcanza con cambiar el brillo.**

---

## 8. Criterios de aceptación

### 8.1 Por lote (obligatorio, en este orden)

```bash
python tools/optimize_art.py     # redimensiona y escribe los .webp
node tools/genArtIndex.mjs       # regenera public/art/index.json
npm run dev                      # mirar las cartas en la mano
```

```bash
npm run typecheck                # nada que verificar acá, pero no puede romper
npm test                         # 116/116: incluye los tests de la cadena de respaldo
npm run validate                 # 0 errores: el arte no toca el contenido, pero es el gate
npm run smoke                    # 0 errores / 0 avisos de consola
npm run build:release            # el presupuesto de JS sigue bajo 1.6 MB
```

**El smoke es el chequeo que importa acá:** un archivo mal nombrado o un manifiesto
desactualizado no rompe el build, pero **sí aparece como 404 en la consola** — y el smoke
exige 0 errores. Es la única red que atrapa el error de tipeo en el nombre.

### 8.2 Por imagen (revisión a ojo, una por una)

- [ ] El sujeto entra **entero** entre el 18% y el 62% de la altura.
- [ ] El tercio inferior está oscuro y sin detalle (no compite con los chips).
- [ ] **No hay texto, números, firma, marco ni plantilla de carta.**
- [ ] La silueta se lee **a 96 px de ancho** (achicá la imagen y mirala).
- [ ] El acento coincide con el hex del elemento (§1.1).
- [ ] La rareza se distingue de la común del mismo elemento puesta al lado.
- [ ] Terminación mate: sin reflejos especulares duros.
- [ ] Ninguna carta del mismo elemento se ve idéntica a otra.

### 8.3 El chequeo que no se puede olvidar

**Poné dos cartas del mismo elemento en la mano y mirá la pantalla.** El objetivo entero del
refactor es que dos cartas del mismo elemento dejen de verse iguales. Si después de generar
`card_crystal_common` y `card_crystal_rare` las dos se leen como "hongo cian", el trabajo no
sirvió. La forma tiene que ser distinta, no solo el brillo.

### 8.4 Presupuesto de peso

| Concepto | Límite | Control |
| --- | --- | --- |
| Un `.webp` de carta | ≤ 60 KB | `ls -la public/art/` |
| Los 40 archivos | ≤ 2,4 MB | suma de `public/art/*.webp` |
| Los 25 SVG | ≤ 3 KB cada uno, ≤ 75 KB el set | `du -ch public/art/ui_icon_*.svg` |
| JS del bundle | < 1,6 MB (lo verifica el CI) | `npm run build:release` |

Si una imagen supera los 60 KB, casi siempre es por ruido de fondo: subí el `QUALITY` de
`tools/optimize_art.py` no, bajalo — o reducí la densidad de partículas en el prompt.

### 8.5 Registro de la decisión

Cuando un lote entra al juego, la nota va al log de memoria del proyecto
(`.workbuddy-ai/memory/YYYY-MM-DD.md`) con: lote, archivos, qué se descartó y por qué, y las
capturas. El arte sin registro se regenera mal la próxima vez.

---

## 9. Apéndices

### 9.1 Extras de marca (no son parte de los 40 + 25)

| Asset | Cuándo | Prompt breve |
| --- | --- | --- |
| `ui_logo_mark.webp` (1024², alpha) | Con L5 | `A single centred emblem for a mushroom deckbuilder: a mushroom cap formed by a few thick curved filaments with a ring of glowing spores orbiting it, flat vector, two colours only (deep indigo ground transparent, cyan #5fd8e8 glow), matte, no text, no lettering, 12% clear margin, readable at 48px on a near-black background. NEGATIVE: text, letters, gradients, drop shadow, glossy 3D, more than one subject.` |
| `art_cardback.webp` (512×744) | Con L1 | `A card back: a mandala of gills radiating from the centre inside a ring of mycelial filaments, deep teal ground #0d131b with cyan #5fd8e8 veins, symmetrical, flat vector, matte, no text, no logo, edges safe for a 2:3 crop. NEGATIVE: text, letters, asymmetry, frame, border.` |
| `art_table_rotwood.webp` (768² tileable) | Cuando haya 2º pack | `A seamless tileable texture of rotten wood from directly above, warm rust and umber tones, damp fibre detail, faint amber glow in the cracks, matte, no directional light, no objects on top. NEGATIVE: text, shadows from objects, perspective, vignette.` |

### 9.2 Extensiones futuras del set de iconos

Si más adelante se les pone icono a los contadores que hoy son solo texto, los naturales
—porque ya tienen clave i18n— son: `spores` (`hud.spores`), `substrate` (`hud.substrate`),
`deck` (`hud.deck`), `target` (`hud.target`) y `play` (`action.play`). **No los agregues
ahora**: el set son 25 y una lista que crece sin control es cómo se degrada un sistema de
iconos.

### 9.3 Registro de decisiones

- **Por qué `neutral` se genera aunque hoy no lo use ninguna carta:** sin esos 5 archivos, un
  joker neutro cae a `art_mycelium` y se ve violeta. Es barato y evita un bug de arte que no
  se nota hasta que existe el contenido.
- **Por qué no se generan los 40 de una:** la cadena de respaldo hace que 8 archivos ya
  cambien el juego entero. Generar 40 antes de mirar cómo quedan las cartas en la mano es la
  forma más cara de descubrir que la banda 18%–62% estaba mal.
- **Por qué los prompts están en inglés y el documento en español:** los modelos de imagen
  rinden mejor en inglés y el catálogo original del plan ya venía así; el resto del proyecto
  escribe en español.
- **Por qué los iconos son SVG y no WebP:** un WebP de 24×24 se pixela en pantallas 3x y no
  se puede tintar. El SVG pesa 1 KB, escala y hereda el color del botón.
- **Por qué imagen-a-imagen y no texto-a-imagen:** probado, no supuesto. El mismo sujeto por
  texto-a-imagen salió fotorrealista (moss detallado, hierba, luz volumétrica) y por
  imagen-a-imagen salió en el estilo del juego. Ver §0.4. **El estilo de este juego no se
  describe: se hereda de una imagen de referencia.**
- **Por qué el ancla de cada familia es su propio `common`:** además de fijar el estilo, fija
  la *especie*. Las 5 rarezas de un elemento tienen que leerse como el mismo organismo en
  cinco momentos, y anclar en el `common` de la propia familia es lo que lo garantiza.
- **Por qué `fit()` recorta en vez de redimensionar:** el generador devuelve 2:3 (1:1.491) y
  la carta es 1:1.453. Un `resize()` directo estiraba la imagen un 2,6% y los círculos
  salían ovalados; con 40 cartas al lado eso se ve. El recorte es de 1,3% arriba y abajo y no
  toca la banda del sujeto.
- **Por qué el contacto de 2,6% importa:** porque el arte se dibuja *dentro* de un canvas que
  también dibuja texto encima. Un estiramiento no se nota en una carta suelta y sí cuando el
  jugador tiene ocho en abanico.


---

## 10. Las 24 ilustraciones de CIEGO

El ciego tenía sólo texto. Estas 24 ilustraciones le dan cara a la pantalla de selección, que
es la pantalla que más se mira por partida (se ve tres veces por ante, ocho antes).

### 10.1 Lo que cambia respecto de las 40 cartas

| | Cartas (§3) | Ciegos (§10) |
| --- | --- | --- |
| Rareza | 5 tratamientos distintos | **no existe** — el eje es el escalafón |
| Encima del arte | nombre + chips + coste (canvas) | nombre, métricas y recompensa (DOM) |
| Banda útil | 18%–62% | **10%–72%** (ver abajo) |
| Paleta | acento = elemento | acento = **escalafón** |

**La banda es más alta y más ancha.** En una carta, el arte es *el* contenido y el texto es
una etiqueta al pie: por eso el sujeto vive cómodo entre el 18% y el 62%. En el ciego es al
revés — el texto es el contenido (multiplicador, objetivo, recompensa, descripción) y el arte
es la atmósfera detrás. Necesita más alto para no desaparecer bajo el velo, pero no puede
llegar al borde superior porque ahí está el nombre.

**El acento lo pone el escalafón**, y reemplaza al acento de rareza:

| Escalafón | Hex | Nombre | Cómo entra |
| --- | --- | --- | --- |
| `small` | `#9aa5b1` | gris-azulado | casi sin luz: una sola fuente, mucho silencio |
| `big` | `#4fd18b` | menta | rim light menta, un foco secundario |
| `boss` | `#e2845c` | óxido cálido | dos fuentes, partículas, composición densa y hostil |

**Regla de choque cromático (la misma de §1.1):** el elemento del ambiente manda en el sujeto;
el escalafón manda en la LUZ. Nunca los dos en el mismo plano. Un jefe de veneno es verde con
luz óxida, no naranja.

### 10.2 Los tres escalafones, literal (esto es el bloque que va en cada prompt)

```text
small — a quiet, almost empty room. One soft light source, no particles, low contrast, muted
desaturated palette, a wide empty dark foreground. It should read as "safe, for now".

big — the same space under pressure. A secondary light source, faint drifting spores, richer
contrast, a few silhouetted shapes at the edges of frame. It should read as "this will cost
you something".

boss — the space is actively hostile. Two light sources with a hard warm rim, dense airborne
debris, a heavy dark foreground frame, dramatic chiaroscuro, the environment itself looks
like it is leaning toward the viewer. It should read as "this is alive and it wants you gone".
```

### 10.3 El ancla de cada ambiente

Cada ciego se ancló en la carta que **ya define ese ambiente**, no en un `common` cualquiera:

| Ante | Ambiente | Archivo de ancla |
| --- | --- | --- |
| 1 | sótano / piedra húmeda | `art_card_decay_common.png` |
| 2 | tronco y colonia | `art_card_decay_uncommon.png` |
| 3 | anillo y compost | `art_card_symbiosis_common.png` |
| 4 | bosque ciego | `art_card_mycelium_common.png` |
| 5 | agua y osario | `art_card_crystal_common.png` |
| 6 | ceniza y capilla | `art_card_parasite_common.png` |
| 7 | salar y campo muerto | `art_card_neutral_common.png` |
| 8 | mar micelial | `art_card_mycelium_mythic.png` |

Anclar en las cartas en vez de en un ciego ya generado (que no existía) es lo que mantiene
estos 24 dentro del set: heredan el trazo, el charco de musgo elíptico, el haz de luz vertical
y el fondo casi negro del resto del juego.

### 10.4 El circuito (idéntico al de §0.1)

1. Generás a `art-source/art_blind_<clave>.png` (2:3, PNG).
2. `npm run art` → recorta a **512×744** (mismo recuadro que una carta) y regenera el índice.
3. `node tools/genArtIndex.mjs` mapea el archivo a la clave `blind_<clave>`.
4. `blinds.json` declara `"art": "<clave>"` y `"tier": "small|big|boss"`.
5. La UI lo pide por `SceneManager.blindArt(blind.art)`.

Sin el WebP, la tarjeta se queda con su material (el marco compartido) y **no** cae a ninguna
otra ilustración: un ciego sin arte no puede mostrar la cara de una carta.

### 10.5 Registro de decisiones

- **Por qué el nombre del archivo lleva el id completo** (`art_blind_blind_a1_small.webp` y no
  `art_blind_a1_small.webp`): la clave en `blinds.json` es libre y es el contrato con el
  disco. Prefijarla con `blind_` hace que la clave y el id sean el mismo texto, que es más
  fácil de auditar a ojo que una tabla de equivalencias.
- **Por qué no hay arte de los íconos del ciego:** no hacen falta. Las métricas (×, objetivo,
  recompensa) son números y ya tienen color propio en CSS; agregar 24 chapitas sería inflar el
  set sin agregar información.
- **Por qué el jefe NO siempre ocupa dos columnas:** a 844 px la grilla da 3 columnas y un
  `span 2` deja al jefe solo en una fila con un hueco al lado, que se lee como error de
  layout. El ensanche vive detrás de `@media (min-width: 640px)` y con 2 columnas exactas.

---

## 11. Cartas nuevas R4d (arte propio por carta)

Cuatro cartas nuevas de R4d caían en un par (elemento × rareza) que **ya tenía dueño**,
así que `validate` marcaría la ilustración como compartida. Se resolvió con el
mecanismo existente: **arte propio** `art_card_own_<id>.webp` (mismo circuito que
§0.1, PNG 2:3 en `art-source/` → `npm run art` → 512×744).

Ancla img2img: la carta **common del mismo elemento** (`input_fidelity: medium`),
porque el nuevo sujeto tiene que heredar el trazo, el charco de musgo elíptico, el
haz de luz vertical y el fondo casi negro del set.

| id | Par | Ancla | Sujeto |
| --- | --- | --- | --- |
| `spore_fairycake` | spore/uncommon | `art_card_spore_common.png` | bejín grande con anillo de setas pálidas alrededor (corro de hadas), esporas doradas |
| `mycelium_truffle` | mycelium/rare | `art_card_mycelium_common.png` | trufa medio enterrada, filamentos violeta brillando como red |
| `decay_inkcap` | decay/rare | `art_card_decay_common.png` | coprino con el sombrero disolviéndose en tinta negra que gotea |
| `poison_goldcap` | poison/rare | `art_card_poison_common.png` | sombrero dorado metálico, esporas como monedas flotando |

**Regla que dejó R4d:** una carta nueva NO puede reusar el arte base de su par si ese
par ya tiene carta con ese archivo. Antes de autorar, listar los pares en uso
(`art_card_<elem>_<rar>.webp` con un solo dueño cada uno) y elegir: (a) un par libre,
o (b) arte propio. Agregar dos cartas del mismo par sin arte propio = `validate` rojo.
