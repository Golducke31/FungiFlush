"""
optimize_art.py — Prepara el arte generado para el juego.

Convierte las PNG de 1024px a WebP reducido. Motivo concreto: el juego corre
en landscape en celular. Una PNG de 1.9 MB por carta son ~40 MB de RAM solo
en texturas de GPU, suficiente para que el WebView se quede sin memoria a
mitad de partida. WebP a 512px anda en ~40 KB y se ve igual en pantalla.

Uso: python tools/optimize_art.py
"""

from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
ART = ROOT / "public" / "art"
QUALITY = 84

# nombre -> (ancho, alto). Las cartas de arte son cuadradas; el dorso es
# vertical (misma proporcion que la carta) y el tapete es grande.
TARGETS: dict[str, tuple[int, int]] = {
    "art_cardback": (384, 560),
    "art_table": (768, 768),
}
DEFAULT_TARGET = (512, 512)


def optimize(src: Path, out: Path, size: tuple[int, int]) -> tuple[int, int]:
    with Image.open(src) as img:
        img = img.convert("RGB")
        img = img.resize(size, Image.LANCZOS)
        out.parent.mkdir(parents=True, exist_ok=True)
        img.save(out, "WEBP", quality=QUALITY, method=6)
    return src.stat().st_size, out.stat().st_size


def main() -> int:
    sources = sorted(p for p in ART.glob("art_*.png"))
    if not sources:
        print("No hay PNG 'art_*.png' en public/art")
        return 1

    total_before = 0
    total_after = 0
    print(f"{'origen':<24} {'destino':<24} {'antes':>9} {'despues':>9}")
    print("-" * 70)

    for src in sources:
        size = TARGETS.get(src.stem, DEFAULT_TARGET)
        out = ART / f"{src.stem}.webp"
        before, after = optimize(src, out, size)
        total_before += before
        total_after += after
        print(
            f"{src.name:<24} {out.name:<24} {before / 1024:>7.0f}K {after / 1024:>7.0f}K"
        )

    print("-" * 70)
    print(
        f"TOTAL: {total_before / 1024 / 1024:.1f} MB -> {total_after / 1024 / 1024:.2f} MB "
        f"({100 * total_after / total_before:.1f}%)"
    )

    # Hoja de contacto para revisar el set completo de un vistazo.
    files = sorted(ART.glob("art_*.webp"))
    if files:
        cols = 4
        rows = (len(files) + cols - 1) // cols
        cell = 240
        sheet = Image.new("RGB", (cols * cell, rows * (cell + 20)), (10, 14, 20))
        draw = ImageDraw.Draw(sheet)
        for i, f in enumerate(files):
            with Image.open(f) as im:
                im = im.convert("RGB").resize((cell, cell), Image.LANCZOS)
            x = (i % cols) * cell
            y = (i // cols) * (cell + 20)
            sheet.paste(im, (x, y))
            draw.text((x + 6, y + cell + 3), f.stem, fill=(200, 215, 230))
        sheet_path = ART / "_contact_sheet.jpg"
        sheet.save(sheet_path, "JPEG", quality=78)
        print(f"\nHoja de contacto: {sheet_path.relative_to(ROOT)}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
