"""
build_play_button.py — Prepara el ARTE del boton "Jugar Mano".

Entrada (art-source/ui/, gitignored): los PNG ya keyeados (fondo magenta fuera).
Salida (public/art/): WebP con alfa, recortados y a un tamano razonable.

Las FUENTES keyed se generan aparte (chroma key del magenta). Este script solo
recorta el margen transparente y convierte, para que el boton cargue rapido en
celular. Igual que `optimize_art.py`: las fuentes NO van a `public/`.
"""

from __future__ import annotations

import os
import sys

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "art-source", "ui")
OUT = os.path.join(ROOT, "public", "art")

# (archivo de entrada, archivo de salida, ancho objetivo)
JOBS = [
    ("ui_play_frame_src.png", "ui_play_frame.webp", 1024),
    ("ui_play_text_es_src.png", "ui_play_text_es.webp", 640),
    ("ui_play_text_en_src.png", "ui_play_text_en.webp", 640),
]


def trim_alpha(img: Image.Image) -> Image.Image:
    """Recorta el margen totalmente transparente."""
    bbox = img.getbbox()
    return img.crop(bbox) if bbox else img


def main() -> int:
    if not os.path.isdir(SRC):
        print(f"Falta {SRC} (las fuentes keyed no se versionan).", file=sys.stderr)
        return 1
    os.makedirs(OUT, exist_ok=True)
    for src_name, out_name, width in JOBS:
        src_path = os.path.join(SRC, src_name)
        if not os.path.isfile(src_path):
            print(f"  ! falta {src_name}", file=sys.stderr)
            continue
        img = Image.open(src_path).convert("RGBA")
        img = trim_alpha(img)
        if img.width > width:
            height = round(img.height * (width / img.width))
            img = img.resize((width, height), Image.LANCZOS)
        out_path = os.path.join(OUT, out_name)
        img.save(out_path, "WEBP", quality=88, method=6)
        print(f"  {out_name}: {img.width}x{img.height} -> {os.path.getsize(out_path) // 1024} KB")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
