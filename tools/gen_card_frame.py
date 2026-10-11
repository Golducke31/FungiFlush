"""gen_card_frame.py — Marco de carta organico del rediseño visual.

Toma `art-source/card_frame_raw.png` (una guirnalda pintada de enredaderas,
raices, setas y hojas alrededor de un centro VACIO, generada por imagen a partir
de la referencia del usuario) y produce `public/art/art_card_frame.webp`, listo
para dibujarse encima del arte en `CardTexture.createCardCanvas` /
`createCardBackCanvas`.

Pasos:
  1. encaja a 1024x1488 (2x de la carta 512x744) RECORTANDO el sobrante, sin
     deformar (misma `fit()` que `optimize_art.py`);
  2. redondea las esquinas exteriores (radio 60 = 2x el de la carta) para que el
     marco siga el mismo contorno que el arte;
  3. garantiza el CENTRO transparente: el arte de la carta se ve a traves;
  4. exporta WebP con alfa.

⚠️ El archivo TIENE que llamarse `art_card_frame.webp`: `ArtAssets` resuelve la
clave `card_frame` a ese nombre. Con otro nombre el manifiesto no lo mapea a
ninguna clave, nunca se carga y las cartas caen al marco procedural en silencio
(sin un solo 404, el smoke no lo ve).

Uso:  python tools/gen_card_frame.py
"""
from __future__ import annotations

import os

import numpy as np
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)

SRC = os.path.join(ROOT, "art-source", "raw", "card_frame_raw.png")
OUT = os.path.join(ROOT, "public", "art", "art_card_frame.webp")

W2, H2 = 768, 1116          # 1.5x de la carta (512x744)
R_OUT = 45                   # radio exterior (30px en 1x, el mismo del arte)

# La guirnalda generada ocupa ~10% del ancho por lado, que a 512px son ~54px:
# mas que el margen del contenido (pad = 30), asi que pisaba los chips y el
# panel de descripcion. Se ESCALA alrededor del centro (por eje: el anillo es
# mas grueso a los lados que arriba/abajo) hasta que su borde interior cae en
# `WINDOW_INSET`; el sobrante se sale del canvas y el marco queda pegado al borde.
SCALE_X = 1.08
SCALE_Y = 1.05

# Margen de la ventana interior, en unidades de CARTA (512x744). Tiene que ser
# <= el `pad` del contenido (30) para no tocar los chips ni el texto, y es el
# mismo valor al que se recorta el ARTE (`CardTexture.CARD_FRAME_INSET`).
WINDOW_INSET = 26

# El marco se ve a traves del render 3D, que es oscuro y lo ilumina con las
# mismas luces que la escena. A la ganancia natural se leia como una mancha
# negra: se le sube la luz (y un poco la saturacion) para que el anillo se
# distinga de la carta sin llegar a verse pegado.
GAIN = 1.38
SATURATION = 1.12

# El arte organico (filamentos, hojas, motas) tiene MUCHISIMA alta frecuencia:
# a 1024x1488 el WebP pesaba 370 KB. A 1.5x del canvas (768x1116) sigue
# sobremuestreado para como se dibuja (512x744) y baja a ~220 KB.
QUALITY = 86
METHOD = 6


def fit(img: Image.Image, size: tuple[int, int]) -> Image.Image:
    """Encaja recortando el sobrante (cover), sin deformar. Igual que optimize_art."""
    target_ratio = size[0] / size[1]
    width, height = img.size
    ratio = width / height
    if ratio > target_ratio:                     # sobra ancho
        nw = round(height * target_ratio)
        left = (width - nw) // 2
        img = img.crop((left, 0, left + nw, height))
    elif ratio < target_ratio:                   # sobra alto
        nh = round(width / target_ratio)
        top = (height - nh) // 2
        img = img.crop((0, top, width, top + nh))
    return img.resize(size, Image.LANCZOS)


def zoom_about_center(img: Image.Image, kx: float, ky: float) -> Image.Image:
    """Escala alrededor del CENTRO conservando el tamano del lienzo.

    Lo que se sale del cuadro se recorta: la guirnalda queda con su borde
    interior mas adentro y el exterior se pierde fuera del canvas, que es
    exactamente lo que hace que el marco se vea pegado al borde.
    """
    w, h = img.size
    big = img.resize((round(w * kx), round(h * ky)), Image.LANCZOS)
    out = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    out.paste(big, (round((w - big.width) / 2), round((h - big.height) / 2)))
    return out


def rounded_mask(size: tuple[int, int], radius: int) -> Image.Image:
    """Mascara opaca dentro de un rectangulo redondeado."""
    m = Image.new("L", size, 0)
    ImageDraw.Draw(m).rounded_rectangle([0, 0, size[0] - 1, size[1] - 1], radius=radius, fill=255)
    return m


def main() -> None:
    if not os.path.exists(SRC):
        raise SystemExit(f"falta la fuente {SRC}")

    raw = Image.open(SRC).convert("RGBA")
    frame = fit(raw, (W2, H2))
    frame = zoom_about_center(frame, SCALE_X, SCALE_Y)

    alpha = np.asarray(frame)[..., 3].astype(np.float32) / 255.0

    # --- 1) esquinas exteriores redondeadas ---
    outer = np.asarray(rounded_mask((W2, H2), R_OUT), dtype=np.float32) / 255.0
    alpha *= outer

    # --- 2) ventana interior LIMPIA ---
    # Garantiza que el marco no entre ni un pixel en la zona del arte y del
    # contenido: el borde interior queda en `WINDOW_INSET` (en unidades de carta)
    # con un rectangulo redondeado, sin importar cuanto se meta la guirnalda.
    scale = W2 / 512.0
    inset = round(WINDOW_INSET * scale)
    inner = np.asarray(
        rounded_mask((W2 - 2 * inset, H2 - 2 * inset), max(8, R_OUT - inset // 2)),
        dtype=np.float32,
    ) / 255.0
    clear = np.zeros((H2, W2), dtype=np.float32)
    clear[inset:H2 - inset, inset:W2 - inset] = inner
    alpha *= 1.0 - clear

    out = np.asarray(frame).copy()
    out[..., 3] = np.clip(alpha * 255.0, 0, 255).astype(np.uint8)

    # Ganancia de luz y saturacion SOLO sobre lo pintado (alpha > 0).
    rgb = out[..., :3].astype(np.float32) * GAIN
    lum = rgb.mean(axis=2, keepdims=True)
    rgb = lum + (rgb - lum) * SATURATION
    out[..., :3] = np.clip(rgb, 0, 255).astype(np.uint8)

    result = Image.fromarray(out, "RGBA")

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    result.save(OUT, "WEBP", quality=QUALITY, method=METHOD)

    ring = np.asarray(result)[..., 3] > 8
    print(f"escrito {OUT}")
    print(f"  {result.size}  escala=({SCALE_X},{SCALE_Y})  ventana={WINDOW_INSET}px(carta)")
    print(f"  pixeles de marco: {ring.sum()}  centro transparente: {not ring[H2 // 2, W2 // 2]}")
    print(f"  bytes: {os.path.getsize(OUT)}")


if __name__ == "__main__":
    main()
