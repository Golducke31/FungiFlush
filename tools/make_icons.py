"""
make_icons.py — Genera los iconos de la app a partir del arte existente.

Produce:
  public/favicon.png, icon-192.png, icon-512.png, apple-touch-icon.png
  src-tauri/icons/*.png + icon.ico  (para el bundle de Tauri)

El icono se recorta del centro del arte y se le aplica un fondo redondeado
oscuro, para que se lea bien sobre cualquier barra de tareas.

Uso: python tools/make_icons.py
"""

from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "art-source" / "art_legendary.png"
PUBLIC = ROOT / "public"
TAURI_ICONS = ROOT / "src-tauri" / "icons"

# Tamaños que pide Tauri 2 (desktop + movil).
TAURI_SIZES = {
    "32x32.png": 32,
    "128x128.png": 128,
    "128x128@2x.png": 256,
    "icon.png": 512,
    "Square30x30Logo.png": 30,
    "Square44x44Logo.png": 44,
    "Square71x71Logo.png": 71,
    "Square89x89Logo.png": 89,
    "Square107x107Logo.png": 107,
    "Square142x142Logo.png": 142,
    "Square150x150Logo.png": 150,
    "Square284x284Logo.png": 284,
    "Square310x310Logo.png": 310,
    "StoreLogo.png": 50,
}

PUBLIC_SIZES = {
    "favicon.png": 64,
    "apple-touch-icon.png": 180,
    "icon-192.png": 192,
    "icon-512.png": 512,
}


def build_master(size: int = 1024) -> Image.Image:
    """Icono maestro: recorte centrado del arte + vineta + marco redondeado."""
    if not SOURCE.exists():
        raise SystemExit(f"Falta la imagen fuente: {SOURCE}")

    with Image.open(SOURCE) as raw:
        img = raw.convert("RGB")
        w, h = img.size

        # Recorte cuadrado centrado, ligeramente cerrado sobre el sujeto.
        side = int(min(w, h) * 0.86)
        left = (w - side) // 2
        top = int((h - side) * 0.42)
        img = img.crop((left, top, left + side, top + side)).resize(
            (size, size), Image.LANCZOS
        )

    # Vineta radial para que el sujeto respire y los bordes se oscurezcan.
    mask = Image.new("L", (size, size), 0)
    draw = ImageDraw.Draw(mask)
    steps = 60
    for i in range(steps):
        t = i / steps
        r = int(size * 0.72 * (1 - t))
        value = int(255 * (1 - t) ** 1.4)
        draw.ellipse(
            (size // 2 - r, size // 2 - r, size // 2 + r, size // 2 + r),
            fill=max(0, min(255, value)),
        )
    mask = mask.filter(ImageFilter.GaussianBlur(size * 0.04))

    dark = Image.new("RGB", (size, size), (7, 11, 16))
    img = Image.composite(img, dark, mask)

    # Esquinas redondeadas.
    rounded = Image.new("L", (size, size), 0)
    ImageDraw.Draw(rounded).rounded_rectangle(
        (0, 0, size - 1, size - 1), radius=int(size * 0.22), fill=255
    )
    out = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    out.paste(img, (0, 0), rounded)
    return out


def main() -> int:
    master = build_master(1024)

    PUBLIC.mkdir(parents=True, exist_ok=True)
    TAURI_ICONS.mkdir(parents=True, exist_ok=True)

    for name, size in PUBLIC_SIZES.items():
        master.resize((size, size), Image.LANCZOS).save(PUBLIC / name, "PNG")
        print(f"  public/{name:<24} {size}x{size}")

    for name, size in TAURI_SIZES.items():
        master.resize((size, size), Image.LANCZOS).save(TAURI_ICONS / name, "PNG")
    print(f"  src-tauri/icons/*.png     {len(TAURI_SIZES)} tamaños")

    # .ico multi-resolucion para Windows.
    ico_sizes = [(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]
    master.save(TAURI_ICONS / "icon.ico", sizes=ico_sizes)
    print("  src-tauri/icons/icon.ico  7 resoluciones")

    # Vista previa.
    preview = master.resize((256, 256), Image.LANCZOS)
    preview.save(ROOT / "tools" / "icon-preview.png", "PNG")
    print("\n  Vista previa: tools/icon-preview.png")
    print("\n  NOTA: icon.icns (macOS) requiere macOS o `tauri icon`;")
    print("  se omite a proposito. En Windows/Linux no hace falta.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
