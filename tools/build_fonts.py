"""
build_fonts.py — Recorta y comprime las tipografias del juego.

POR QUE EXISTE
--------------
Las fuentes de origen son TTF completos. Gasoek One pesa 1 MB porque trae 3099
glifos (incluye hangul), y el juego usa ~150 caracteres. Servir el TTF crudo
seria un megabyte de descarga para escribir "Amanita" y "Jugar Mano".

Este script hace dos cosas y nada mas:
  1. SUBSET: recorta cada fuente al juego de caracteres que el juego realmente
     escribe, leyendo los diccionarios de i18n y sumando los simbolos sueltos
     (flechas, tildes, signos de apertura). Asi una traduccion nueva no puede
     quedar con un glifo en blanco por olvido.
  2. WOFF2: comprime con brotli. Es el formato que soportan todos los WebView
     objetivo (WebView2, WKWebView, WebKitGTK) y pesa ~3x menos que el TTF.

Las fuentes de origen van en `fonts-source/` (gitignored); la salida va en
`public/fonts/`, que es lo unico que se versiona.

Uso: npm run fonts
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

try:
    from fontTools.subset import Subsetter, Options
    from fontTools.ttLib import TTFont
except ImportError:
    print("Falta fontTools. Instalalo con:\n  pip install fonttools brotli")
    raise SystemExit(1)

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "fonts-source"
OUT = ROOT / "public" / "fonts"
DICTS = [ROOT / "src" / "i18n" / "en.json", ROOT / "src" / "i18n" / "es.json"]

# nombre de salida -> (archivo de origen, familia CSS, peso, estilo)
FONTS: dict[str, tuple[str, str, int]] = {
    "fredoka-semicondensed-bold": ("fredoka-semicondensed-bold.ttf", "Fredoka SemiCondensed", 700),
    "gasoek-one-regular": ("gasoek-one-regular.ttf", "Gasoek One", 400),
    "borsok-regular": ("borsok-regular.ttf", "Borsok", 400),
}

# Simbolos que el juego usa en pantalla pero no estan en los diccionarios
# (los dibuja el HUD o el canvas de las cartas).
EXTRA_CHARS = (
    "0123456789"
    "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
    "abcdefghijklmnopqrstuvwxyz"
    " .,:;!?¿¡'\"()[]{}/\\|-_+=*#%&@$<>"
    "·•…—–−×÷°±→←↑↓✓✗♥"
)

# El alfabeto completo, para que el catalogo de arte y las pruebas de fuente
# puedan mostrar cualquier letra aunque ninguna traduccion la use todavia.
ASCII_PRINTABLE = "".join(chr(c) for c in range(0x20, 0x7F))
LATIN1 = "".join(chr(c) for c in range(0xA0, 0x100))


def collect_charset() -> str:
    """Todo lo que el juego puede llegar a escribir."""
    chars: set[str] = set(EXTRA_CHARS) | set(ASCII_PRINTABLE) | set(LATIN1)

    for path in DICTS:
        if not path.exists():
            continue
        data = json.loads(path.read_text(encoding="utf-8"))
        for value in walk(data):
            chars.update(value)

    return "".join(sorted(chars))


def walk(node: object):
    """Recorre el JSON y devuelve todos los strings."""
    if isinstance(node, str):
        yield node
    elif isinstance(node, dict):
        for value in node.values():
            yield from walk(value)
    elif isinstance(node, list):
        for value in node:
            yield from walk(value)


def build(name: str, source: str, charset: str) -> tuple[int, int, int, int]:
    src = SOURCE / source
    if not src.exists():
        raise SystemExit(f"Falta {src.relative_to(ROOT)} (las fuentes de origen no se versionan)")

    font = TTFont(src, lazy=False)
    before_glyphs = len(font.getBestCmap())

    options = Options()
    options.layout_features = ["kern", "liga", "calt"]
    options.name_IDs = ["*"]
    options.notdef_outline = True
    options.recalc_bounds = True
    # Sin hinting: los WebView modernos rasterizan con su propio motor y las
    # instrucciones TrueType solo agregan bytes.
    options.hinting = False
    options.desubroutinize = True

    subsetter = Subsetter(options=options)
    subsetter.populate(text=charset)
    subsetter.subset(font)

    after_glyphs = len(font.getBestCmap())

    OUT.mkdir(parents=True, exist_ok=True)
    dest = OUT / f"{name}.woff2"
    font.flavor = "woff2"
    font.save(dest)
    font.close()

    return src.stat().st_size, dest.stat().st_size, before_glyphs, after_glyphs


def main() -> int:
    if not SOURCE.is_dir():
        print(f"No existe {SOURCE.relative_to(ROOT)}/ con las fuentes de origen.")
        return 1

    charset = collect_charset()
    print(f"Juego de caracteres: {len(charset)} glifos")
    print(f"{'fuente':<30} {'antes':>9} {'despues':>9} {'glifos':>14}")
    print("-" * 68)

    total_before = 0
    total_after = 0
    for name, (source, _family, _weight) in FONTS.items():
        before, after, g_before, g_after = build(name, source, charset)
        total_before += before
        total_after += after
        print(f"{name:<30} {before / 1024:>7.0f}K {after / 1024:>7.1f}K {g_before:>6} -> {g_after:<5}")

    print("-" * 68)
    print(
        f"TOTAL: {total_before / 1024:.0f} KB -> {total_after / 1024:.0f} KB "
        f"({100 * total_after / total_before:.1f}%)"
    )
    print(f"\nSalida en {OUT.relative_to(ROOT)}/")
    return 0


if __name__ == "__main__":
    sys.exit(main())
