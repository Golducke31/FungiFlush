"""
gen_card_frame.py — Genera el marco de carta pintado del rediseño visual.

Produce `public/art/card_frame.webp` (1024x1488 = 2x de 512x744) con:
  - centro TRANSPARENTE (el arte de la carta se ve a traves);
  - anillo exterior pintado: madera oscura + musgo + doble linea dorada;
  - setas diminutas en las 4 esquinas (acentos del paleta del juego).

Se dibuja encima del arte en `CardTexture.createCardCanvas` (capas full + top)
y en `createCardBackCanvas`. Reemplaza el marco procedural por uno pintado que
combina con el fondo de arena y el resto del HUD.

Uso:  python tools/gen_card_frame.py
"""
from __future__ import annotations

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

W2, H2 = 1024, 1488          # 2x de la carta (512x744)
BW = 64                      # ancho del anillo en 2x (~32px en 1x)
R_OUT = 60                   # radio exterior (30px en 1x, igual que la carta)
R_IN = 40                    # radio del borde interior del anillo

OUT = "C:/Users/emanu/Desktop/FungiFlush/public/art/card_frame.webp"

# Paleta bloqueada (ver docs/PROMPTS_REDISENO.md §1.1)
GOLD = (217, 178, 90, 255)
GOLD_HI = (240, 210, 136, 255)
MOSS = (72, 102, 58, 170)
MOSS_HI = (95, 132, 72, 195)
ACCENTS = [
    (167, 139, 250, 255),   # mycelium violeta
    (242, 193, 78, 255),    # spore ambar
    (95, 216, 232, 255),    # crystal cian
    (196, 104, 58, 255),    # decay oxido
]


def build_mask() -> np.ndarray:
    """Mascara del anillo: 255 dentro del anillo, 0 en el centro."""
    m = Image.new("L", (W2, H2), 0)
    d = ImageDraw.Draw(m)
    d.rounded_rectangle([0, 0, W2, H2], radius=R_OUT, fill=255)
    d.rounded_rectangle([BW, BW, W2 - BW, H2 - BW], radius=R_IN, fill=0)
    return np.asarray(m, dtype=np.uint8)


def wood_array(rng: np.random.Generator) -> np.ndarray:
    """Textura de madera: base marron + veta vertical + ruido fino (despues se suaviza)."""
    base = np.array([58, 42, 28], dtype=np.float32)
    xx = np.arange(W2, dtype=np.float32)
    grain = (
        np.sin(xx / 14.0) * 11.0
        + np.sin(xx / 40.0 + 1.3) * 7.0
        + np.sin(xx / 90.0) * 6.0
    )
    yy = np.arange(H2, dtype=np.float32)
    plank = np.sin(yy / 220.0) * 4.0
    noise = rng.normal(0.0, 2.5, (H2, W2)).astype(np.float32)
    val = base[None, None, :] + grain[None, :, None] + plank[:, None, None] + noise[:, :, None]
    rgb = np.clip(val, 0, 255).astype(np.uint8)
    # Suaviza la madera para que lea como pintada, no como ruido de TV.
    return np.asarray(Image.fromarray(rgb, "RGB").filter(ImageFilter.GaussianBlur(1.6)), dtype=np.uint8)


def mushroom(d: ImageDraw.ImageDraw, cx: int, cy: int, s: int, cap: tuple[int, int, int, int]) -> None:
    """Seta diminuta: halo + pie + sombrero + brillo."""
    d.ellipse([cx - s * 1.7, cy - s * 1.7, cx + s * 1.7, cy + s * 1.7], fill=(cap[0], cap[1], cap[2], 38))
    d.rounded_rectangle([cx - s * 0.2, cy, cx + s * 0.2, cy + s * 1.4], radius=int(s * 0.2), fill=(232, 222, 202, 235))
    d.ellipse([cx - s, cy - s * 0.85, cx + s, cy + s * 0.85], fill=cap)
    d.ellipse([cx - s * 0.62, cy - s * 0.55, cx + s * 0.62, cy + s * 0.05], fill=(255, 255, 255, 55))
    d.ellipse([cx - s * 0.5, cy - s * 0.35, cx - s * 0.1, cy + s * 0.05], fill=(255, 255, 255, 40))


def main() -> None:
    rng = np.random.default_rng(20261010)
    mask = build_mask()
    ring = mask == 255

    # --- madera en el anillo ---
    wood = wood_array(rng)
    frame = Image.new("RGBA", (W2, H2), (0, 0, 0, 0))
    wood_img = Image.fromarray(wood, "RGB")
    frame.paste(wood_img, (0, 0), Image.fromarray(mask, "L"))

    # --- musgo: tintado continuo (parches, no puntos) en el anillo ---
    smooth = (
        np.asarray(
            Image.fromarray((rng.random((H2, W2)) * 255).astype(np.uint8), "L").filter(
                ImageFilter.GaussianBlur(42)
            ),
            dtype=np.float32,
        )
        / 255.0
    )
    moss_strength = np.clip((smooth - 0.38) * 2.2, 0.0, 1.0)[..., None]
    moss_rgb = np.array([72, 102, 58], dtype=np.float32)
    wood_f = wood.astype(np.float32)
    tinted = wood_f * (1.0 - 0.55 * moss_strength) + moss_rgb * (0.55 * moss_strength)
    tinted = np.clip(tinted, 0, 255).astype(np.uint8)

    frame = Image.new("RGBA", (W2, H2), (0, 0, 0, 0))
    frame.paste(Image.fromarray(tinted, "RGB"), (0, 0), Image.fromarray(mask, "L"))

    d = ImageDraw.Draw(frame)

    # --- doble linea dorada ---
    d.rounded_rectangle([10, 10, W2 - 10, H2 - 10], radius=R_OUT - 10, outline=GOLD, width=5)
    d.rounded_rectangle([54, 54, W2 - 54, H2 - 54], radius=R_IN - 6, outline=GOLD_HI, width=4)
    # filete claro interior (profundidad)
    d.rounded_rectangle([60, 60, W2 - 60, H2 - 60], radius=R_IN - 10, outline=(255, 255, 255, 40), width=2)

    # --- setas en las esquinas ---
    s = 26
    corners = [
        (BW + 40, BW + 40),
        (W2 - BW - 40, BW + 40),
        (BW + 40, H2 - BW - 40),
        (W2 - BW - 40, H2 - BW - 40),
    ]
    for (cx, cy), cap in zip(corners, ACCENTS):
        mushroom(d, cx, cy, s, cap)

    frame.save(OUT, "WEBP", quality=95, method=4)
    print(f"escrito {OUT}  {frame.size}  transparencia_centro={not ring[int(H2/2), int(W2/2)]}")


if __name__ == "__main__":
    main()
