#!/usr/bin/env python3
"""
Genera los marcos pintados del HUD (Fase C del rediseño visual).

Produce, en src/ui/frames/:
  - panel.webp  : marco 9-slice wood/moss/gold para .panel (radio ~30)
  - button.webp : marco 9-slice wood/moss/gold para .btn  (radio ~18)

⚠️ SIN SETAS. Las versiones anteriores sembraban una seta en cada esquina
(`corner_mushroom`) y el resultado se leia como pegatina: ademas el medallon de
la esquina superior derecha del boton FungiFlush TAPABA la ficha de cargas
(`.btn-flush-count`, que sobresale `-7px`). El marco queda con madera, musgo y
doble linea de oro, que es lo que le da el caracter sin competir con el contenido.

Centro transparente para que el gradiente propio del elemento asome.

Requiere Pillow + numpy (venv fungiflush).

Uso:  python tools/gen_hud_frames.py
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
    # parches mas claros de musgo
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


def make_frame(size, ring, radius, fname):
    """Pinta un anillo de marco (madera + musgo + lineas de oro), SIN setas.

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
    out = os.path.join(OUT, fname)
    img.save(out, "WEBP", quality=92)
    print("wrote", out, img.size)


def main():
    # panel.webp : 320x320, anillo de 18px, radio exterior = cornerBox 32
    make_frame(320, 18, 32, "panel.webp")
    # button.webp : 200x200, anillo de 12px, radio exterior = cornerBox 22
    make_frame(200, 12, 22, "button.webp")


if __name__ == "__main__":
    main()
