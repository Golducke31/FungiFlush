"""
optimize_art.py — Prepara el arte generado para el juego.

Convierte las PNG grandes a WebP reducido. Motivo concreto: el juego corre en
landscape en celular. Una PNG de 1.9 MB por carta son ~40 MB de RAM solo en
texturas de GPU, suficiente para que el WebView se quede sin memoria a mitad de
partida. WebP a 512px anda en ~40 KB y se ve igual en pantalla.

LAS FUENTES VAN EN `art-source/`, NO EN `public/art/`
------------------------------------------------------
Antes este script globaba `public/art/*.png`, pero los PNG de origen viven en
`art-source/` (que esta en .gitignore, ~21 MB). El desajuste hacia que
`npm run art` no encontrara nada. Ahora lee de `art-source/` y escribe en
`public/art/`, que es lo unico que se versiona.

TAMANOS POR PREFIJO
-------------------
`art_card_<elemento>_<rareza>` y `art_cardback` son 2:3 (la MISMA proporcion que
el canvas de la carta, para que entren a sangre sin recorte); el tapete es
cuadrado y grande; el resto 512x512.

Uso: python tools/optimize_art.py
     npm run art          (esto + regenerar el indice)
"""

from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "art-source"
ART = ROOT / "public" / "art"
QUALITY = 84

# Las cartas (nuevas y el dorso) comparten la proporcion del canvas: 512x744.
CARD_TARGET = (512, 744)

# nombre exacto -> (ancho, alto). Lo que no este aca se resuelve por prefijo.
TARGETS: dict[str, tuple[int, int]] = {
    "art_cardback": CARD_TARGET,
    "art_table": (768, 768),
    # Los 7 elementos del catalogo viejo y las dos rarezas altas son cuadrados.
    "art_legendary": (512, 512),
    "art_mythic": (512, 512),
}
DEFAULT_TARGET = (512, 512)


def target_for(stem: str) -> tuple[int, int]:
    """Tamano de salida: primero por nombre exacto, despues por prefijo."""
    if stem in TARGETS:
        return TARGETS[stem]
    # `art_card_<elemento>_<rareza>` son 2:3, como la carta.
    if stem.startswith("art_card_"):
        return CARD_TARGET
    return DEFAULT_TARGET


def fit(img: Image.Image, size: tuple[int, int]) -> Image.Image:
    """Encaja la imagen en `size` RECORTANDO el sobrante, sin deformarla.

    Por que no un `resize()` directo: el generador devuelve 2:3 (848x1264, ratio
    1:1.491) y la carta es 512x744 (1:1.453). No son la misma proporcion, asi que
    un resize a secas estira la imagen un 2.6% en vertical y los circulos salen
    ovalados. Con 40 imagenes ese 2.6% se nota al poner dos cartas al lado.

    El recorte es centrado y es chico (1.3% arriba y abajo), asi que no toca la
    banda util del sujeto (18%-62% de la altura). Si alguna vez entra una imagen
    con otra proporcion, esto la encaja igual en vez de deformarla.
    """
    target_ratio = size[0] / size[1]
    width, height = img.size
    ratio = width / height

    if ratio > target_ratio:
        # Sobra ancho: se recorta a los lados.
        new_width = round(height * target_ratio)
        left = (width - new_width) // 2
        img = img.crop((left, 0, left + new_width, height))
    elif ratio < target_ratio:
        # Sobra alto: se recorta arriba y abajo.
        new_height = round(width / target_ratio)
        top = (height - new_height) // 2
        img = img.crop((0, top, width, top + new_height))

    return img.resize(size, Image.LANCZOS)


def optimize(src: Path, out: Path, size: tuple[int, int]) -> tuple[int, int]:
    with Image.open(src) as img:
        img = img.convert("RGB")
        img = fit(img, size)
        out.parent.mkdir(parents=True, exist_ok=True)
        img.save(out, "WEBP", quality=QUALITY, method=6)
    return src.stat().st_size, out.stat().st_size


def main() -> int:
    if not SOURCE.is_dir():
        print(f"No existe {SOURCE.relative_to(ROOT)}/ con los PNG de origen.")
        return 1

    sources = sorted(p for p in SOURCE.glob("*.png"))
    if not sources:
        print(f"No hay PNG en {SOURCE.relative_to(ROOT)}/")
        return 1

    total_before = 0
    total_after = 0
    print(f"{'origen':<24} {'destino':<24} {'antes':>9} {'despues':>9}")
    print("-" * 70)

    for src in sources:
        size = target_for(src.stem)
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

    # Hoja de contacto para revisar el set completo de un vistazo. Con 40+
    # archivos, 4 columnas obligan a una imagen altisima: se escalonan solas.
    files = sorted(ART.glob("art_*.webp"))
    if files:
        cols = 8 if len(files) > 24 else 4
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
        # La hoja va a `tools/shots/`, NO a `public/art/`: todo lo que vive en
        # `public/` se copia al bundle, y esta es una herramienta de revision,
        # no un asset del juego (208 KB que no tiene por que viajar al celular).
        sheet_path = ROOT / "tools" / "shots" / "art-contact-sheet.jpg"
        sheet_path.parent.mkdir(parents=True, exist_ok=True)
        sheet.save(sheet_path, "JPEG", quality=78)
        print(f"\nHoja de contacto: {sheet_path.relative_to(ROOT)}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
