#!/usr/bin/env python3
"""
Genera los marcos pintados del HUD (Fase C del rediseño visual).

Produce, en src/ui/frames/:
  - panel.webp    : marco 9-slice wood/moss/gold para .panel (radio ~30)
  - button.webp   : marco 9-slice wood/moss/gold para .btn  (radio ~18)
  - gold_corner.webp : medallón circular dorado (seta) para las esquinas del
                       panel del menú principal.

Estética coherente con public/art/card_frame.webp: madera [58,42,28] con grano
vertical suave, parches de musgo difuminados y doble línea de oro (#d9b25a).
Centro transparente para que el gradiente propio del elemento asome.

Requiere Pillow + numpy (venv fungiflush).
"""
import os
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.abspath(os.path.join(HERE, "..", "src", "ui", "frames"))
os.makedirs(OUT, exist_ok=True)

random = np.random.default_rng(7)

GOLD = (217, 178, 90, 255)
GOLD_HI = (240, 210, 136, 255)
WOOD = (58, 42, 28, 255)
MOSS = (72, 102, 58, 200)
MOSS_HI = (95, 132, 72, 220)

# Acentos de las 4 esquinas (violeta espora, ámbar, cian cristal, óxido decaimiento)
CORNER_ACCENTS = [
    (167, 139, 250, 235),  # mycelium
    (242, 193, 78, 235),   # spore
    (95, 216, 232, 235),   # crystal
    (193, 104, 58, 235),   # decay
]


def make_wood(size, base=WOOD):
    S = size
    yy = np.linspace(0, 1, S)[:, None]
    arr = np.zeros((S, S, 4), dtype=np.float32)
    for c in range(3):
        arr[..., c] = base[c] * (1.0 - 0.18 * yy)
    # grano vertical de baja frecuencia
    xs = np.arange(S)[None, :]
    grain = np.sin(xs / 7.0 + np.sin(xs / 31.0) * 2.0) * 0.5 + 0.5
    for c in range(3):
        arr[..., c] *= (1.0 + (grain - 0.5) * 0.10)
    noise = random.normal(0, 4, (S, S, 1)).astype(np.float32)
    arr[..., :3] += noise
    return Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8), "RGBA")


def add_moss(img, strength=0.5):
    S = img.size[0]
    noise = random.normal(0, 1, (S, S)).astype(np.float32)
    blur = Image.fromarray(
        ((noise * 0.5 + 0.5) * 255).clip(0, 255).astype(np.uint8)
    ).filter(ImageFilter.GaussianBlur(42))
    b = np.asarray(blur, dtype=np.float32) / 255.0
    mask = b > 0.55
    arr = np.array(img, dtype=np.uint8).copy()
    for i in range(3):
        tint = arr[..., i].astype(np.float32)
        tint[mask] = tint[mask] * (1 - strength) + MOSS[i] * strength
        arr[..., i] = tint.clip(0, 255).astype(np.uint8)
    # parches más claros de musgo
    mask_hi = b > 0.72
    for i in range(3):
        tint = arr[..., i].astype(np.float32)
        tint[mask_hi] = tint[mask_hi] * (1 - strength * 0.7) + MOSS_HI[i] * strength * 0.7
        arr[..., i] = tint.clip(0, 255).astype(np.uint8)
    return Image.fromarray(arr, "RGBA")


def ring_mask(size, ring, radius):
    S = size
    m = Image.new("L", (S, S), 0)
    d = ImageDraw.Draw(m)
    d.rounded_rectangle([0, 0, S - 1, S - 1], radius=radius, fill=255)
    d.rounded_rectangle(
        [ring, ring, S - 1 - ring, S - 1 - ring],
        radius=max(2, radius - ring),
        fill=0,
    )
    return m


def draw_gold_lines(img, size, ring, radius):
    S = size
    d = ImageDraw.Draw(img)
    o = max(1, ring * 0.22)
    d.rounded_rectangle(
        [o, o, S - 1 - o, S - 1 - o],
        radius=radius - o,
        outline=GOLD,
        width=2,
    )
    d.rounded_rectangle(
        [o + 1, o + 1, S - 2 - o, S - 2 - o],
        radius=radius - o,
        outline=GOLD_HI,
        width=1,
    )
    d.rounded_rectangle(
        [ring - 2, ring - 2, S - 1 - ring + 2, S - 1 - ring + 2],
        radius=max(2, radius - ring + 2),
        outline=GOLD,
        width=1,
    )


def corner_mushroom(img, cx, cy, r, color):
    d = ImageDraw.Draw(img)
    # halo suave
    for i in range(7):
        a = max(0, 70 - i * 10)
        d.ellipse(
            [cx - r + i, cy - r + i, cx + r - i, cy + r - i],
            outline=(color[0], color[1], color[2], a),
            width=2,
        )
    # sombrero de la seta
    d.ellipse(
        [cx - r * 0.62, cy - r * 0.72, cx + r * 0.62, cy + r * 0.12],
        fill=(color[0], color[1], color[2], 235),
    )
    # brillo del sombrero
    d.ellipse(
        [cx - r * 0.34, cy - r * 0.52, cx + r * 0.18, cy - r * 0.12],
        fill=(255, 255, 255, 90),
    )
    # pie
    d.rounded_rectangle(
        [cx - r * 0.16, cy - r * 0.05, cx + r * 0.16, cy + r * 0.62],
        radius=r * 0.16,
        fill=(238, 232, 222, 220),
    )


def make_frame(size, ring, radius, fname, mushrooms=True):
    """Pinta un anillo de marco.

    `radius` es el radio exterior pintado: se fija igual al `cornerBox` del
    9-slice para que el arco toque los bordes del cuadrante de esquina y no
    quede una esquina transparente (el `border-image` no respeta el
    `border-radius` del CSS, así que el hueco se vería como un notch).
    """
    wood = make_wood(size)
    wood = add_moss(wood)
    m = ring_mask(size, ring, radius)
    tex = wood.copy()
    tex.putalpha(m)
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    img.paste(tex, (0, 0), tex)
    draw_gold_lines(img, size, ring, radius)
    if mushrooms:
        # setas en las 4 esquinas, dentro del cuadrante de esquina
        off = radius * 0.62
        corners = [
            (off, off),
            (size - off, off),
            (off, size - off),
            (size - off, size - off),
        ]
        for (cx, cy), col in zip(corners, CORNER_ACCENTS):
            corner_mushroom(img, cx, cy, ring * 0.95, col)
    out = os.path.join(OUT, fname)
    img.save(out, "WEBP", quality=92)
    print("wrote", out, img.size)


def make_medallion(size, fname):
    """Medallón circular dorado con seta para las esquinas del panel del menú."""
    S = size
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    c = S // 2
    r = S * 0.42
    # anillo exterior
    d.ellipse([c - r, c - r, c + r, c + r], outline=GOLD, width=4)
    d.ellipse([c - r + 3, c - r + 3, c + r - 3, c + r - 3], outline=GOLD_HI, width=2)
    # relleno tenue de madera
    d.ellipse(
        [c - r + 4, c - r + 4, c + r - 4, c + r - 4],
        fill=(58, 42, 28, 150),
    )
    # seta central (acento espora ámbar)
    col = (242, 193, 78, 235)
    mr = r * 0.5
    d.ellipse([c - mr, c - mr * 1.05, c + mr, c + mr * 0.2], fill=col)
    d.ellipse([c - mr * 0.5, c - mr * 0.7, c + mr * 0.3, c - mr * 0.15], fill=(255, 255, 255, 100))
    d.rounded_rectangle(
        [c - mr * 0.18, c - mr * 0.05, c + mr * 0.18, c + mr * 0.85],
        radius=mr * 0.18,
        fill=(238, 232, 222, 220),
    )
    out = os.path.join(OUT, fname)
    img.save(out, "WEBP", quality=92)
    print("wrote", out, img.size)


def main():
    # panel.webp : 320x320, anillo de 18px, radio exterior = cornerBox 32
    make_frame(320, 18, 32, "panel.webp", mushrooms=True)
    # button.webp : 200x200, anillo de 12px, radio exterior = cornerBox 22
    make_frame(200, 12, 22, "button.webp", mushrooms=True)
    make_medallion(96, "gold_corner.webp")


if __name__ == "__main__":
    main()
