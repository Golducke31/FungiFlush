"""
pack_motion_frames.py — Empaqueta frames sueltos en hojas de MotionFrames.

QUE HACE
--------
Toma N imagenes de la MISMA ilustracion (los frames de una animacion), les
aplica el mismo tratamiento que `CardTexture.createCardArtCanvas` +
`drawArtImage` y las pega en una grilla. Escribe:

  public/art/mf_<clave>.webp      la hoja (spritesheet)
  public/art/motionframes.json    el manifiesto, indexado por archivo ESTATICO

POR QUE REPLICA EL TRATAMIENTO
------------------------------
La hoja animada REEMPLAZA la capa de arte de la carta, asi que tiene que verse
igual que el arte estatico: mismo fondo, mismo tinte de elemento, mismos
fundidos y misma vineta. Si no, una carta animada al lado de una estatica se
lee como dos juegos distintos, y el cambiazo entre una y otra (cuando carga la
hoja) seria un corte visible.

El orden de las capas es EXACTAMENTE el del canvas 2D:
  1. fondo degradado (rectangulo redondeado)
  2. tinte de elemento 0.18, de arriba a 0.55 de la altura
  3. la ilustracion, encaje "cover" centrado
  4. tinte de elemento 0.14 plano
  5. fundido inferior hacia #0d131b desde 0.57
  6. fundido superior desde #0d131b (0.96) hasta 0.18
  7. vineta lateral #0a0e14 (0.9)
  8. mascara de esquinas redondeadas

EL NOMBRE MANDA
---------------
Los frames se llaman `<clave>_fNN.png`, donde `<clave>` es el STEM del arte
estatico al que reemplazan (`art_card_mycelium_mythic`). El prefijo `mf_` de
ImageGen se ignora. Tambien vale agruparlos en una carpeta con ese nombre.

  art-source/motionframes/art_card_mycelium_mythic_f01.png
  art-source/motionframes/art_card_mycelium_mythic/f01.png

Se indexa por ARCHIVO ESTATICO y no por carta porque el arte se resuelve por
cadena de respaldo (propia -> elemento x rareza -> procedural): el frame que
acaba viendose es el del archivo que realmente se cargo.

USO
---
  python tools/pack_motion_frames.py
  python tools/pack_motion_frames.py --fps 8 --cols 4 --no-pingpong
  python tools/pack_motion_frames.py --check     (solo informa, no escribe)

Necesita Pillow + numpy. En la venv de arte:
  C:/Users/emanu/.workbuddy-ai/binaries/python/envs/fungiflush/Scripts/python.exe
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageOps

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "art-source" / "motionframes"
ART = ROOT / "public" / "art"
MANIFEST = ART / "motionframes.json"

# Tamano de UNA celda. El canvas de carta es 512x744; la hoja va a 0.625x
# (320x465) porque en pantalla la ilustracion nunca pasa de ~300 px de ancho:
# 320 cubre escritorio 1:1 y movil (~112 px) con supersampling. A 384x558 la
# hoja pesaba 100 KB y con las 65 ilustraciones del juego eran 6.5 MB; a 320
# baja a ~60 KB por hoja sin que se note.
CELL = (320, 465)
RADIUS_RATIO = 30 / 512  # el mismo radio que `createCardArtCanvas`

WEBP_QUALITY = 78

# Copia de ELEMENT_COLOR de `src/render/palette.ts`. Si cambia alla, cambia aca:
# el tinte tiene que ser el mismo o la carta animada no empalma con la estatica.
ELEMENT_COLOR: dict[str, tuple[int, int, int]] = {
    "neutral": (0x9A, 0xA5, 0xB1),
    "poison": (0x8D, 0xD5, 0x50),
    "spore": (0xF2, 0xC1, 0x4E),
    "decay": (0xC1, 0x68, 0x3A),
    "symbiosis": (0x5C, 0xC4, 0x8C),
    "crystal": (0x6D, 0xCE, 0xDA),
    "mycelium": (0xAC, 0x96, 0xEF),
    "parasite": (0xD3, 0x69, 0x8E),
}

# Cuerpo de la carta: el mismo #0d131b de los fundidos del canvas.
BODY = (13, 19, 27)
VIGNETTE = (10, 14, 20)

FRAME_RE = re.compile(r"^(?P<key>.+?)[_-]f?(?P<idx>\d{1,2})$")


# ---------------------------------------------------------------------------
# Gradientes
# ---------------------------------------------------------------------------


def _ramp(positions: list[float], values: list[float], n: int) -> np.ndarray:
    """Interpola una rampa de `values` en `positions` (0..1) a `n` muestras.

    `np.interp` recorta a los extremos fuera del rango, que es exactamente lo
    que hace un gradiente de canvas: antes del primer stop vale el primero y
    despues del ultimo vale el ultimo.
    """
    xs = np.linspace(0.0, 1.0, n)
    return np.interp(xs, positions, values)


def gradient_v(w: int, h: int, stops: list[tuple[float, tuple[int, int, int, int]]]) -> Image.Image:
    """Degradado VERTICAL de RGBA con stops (posicion 0..1, color)."""
    positions = [s[0] for s in stops]
    arr = np.zeros((h, w, 4), dtype=np.uint8)
    for channel in range(4):
        values = [s[1][channel] for s in stops]
        arr[:, :, channel] = np.round(_ramp(positions, values, h))[:, None]
    return Image.fromarray(arr, "RGBA")


def gradient_h(w: int, h: int, stops: list[tuple[float, tuple[int, int, int, int]]]) -> Image.Image:
    """Degradado HORIZONTAL de RGBA (para la vineta lateral)."""
    positions = [s[0] for s in stops]
    arr = np.zeros((h, w, 4), dtype=np.uint8)
    for channel in range(4):
        values = [s[1][channel] for s in stops]
        arr[:, :, channel] = np.round(_ramp(positions, values, w))[None, :]
    return Image.fromarray(arr, "RGBA")


def flat(w: int, h: int, color: tuple[int, int, int, int]) -> Image.Image:
    return Image.new("RGBA", (w, h), color)


def round_mask(w: int, h: int, radius: int) -> Image.Image:
    mask = Image.new("L", (w, h), 0)
    draw = ImageDraw.Draw(mask)
    draw.rounded_rectangle((0, 0, w - 1, h - 1), radius=radius, fill=255)
    return mask


def apply_mask(img: Image.Image, radius: int) -> Image.Image:
    """Multiplica el alfa por una mascara de esquinas redondeadas."""
    alpha = np.asarray(img.getchannel("A"), dtype=np.uint16)
    mask = np.asarray(round_mask(img.width, img.height, radius), dtype=np.uint16)
    out = img.copy()
    out.putalpha(Image.fromarray(((alpha * mask) // 255).astype(np.uint8), "L"))
    return out


# ---------------------------------------------------------------------------
# Tratamiento de un frame
# ---------------------------------------------------------------------------


def element_for(key: str) -> str:
    """Elemento del tinte a partir del nombre del arte estatico.

    `art_card_<elemento>_<rareza>` lo dice en el nombre. El arte PROPIO
    (`art_card_own_<id>`) y los simbiontes no, y ahi el juego tinta con
    `neutral`, asi que replicarlo es lo correcto (no un fallback pobre).
    """
    parts = key.split("_")
    if len(parts) >= 4 and parts[0] == "art" and parts[1] == "card" and parts[2] in ELEMENT_COLOR:
        return parts[2]
    return "neutral"


def treat(frame: Image.Image, element: str, cell: tuple[int, int]) -> Image.Image:
    """Aplica el tratamiento de la capa de arte a UN frame."""
    w, h = cell
    radius = round(RADIUS_RATIO * w)
    tint = ELEMENT_COLOR[element]

    base = Image.new("RGBA", (w, h), (0, 0, 0, 0))

    # 1. Fondo degradado: #141b24 -> #0e141c (a la mitad) -> #080c12.
    base.alpha_composite(
        gradient_v(w, h, [(0.0, (0x14, 0x1B, 0x24, 255)), (0.5, (0x0E, 0x14, 0x1C, 255)), (1.0, (0x08, 0x0C, 0x12, 255))])
    )

    # 2. Tinte de elemento 0.18 arriba, 0 a 0.55 de la altura.
    base.alpha_composite(gradient_v(w, h, [(0.0, (*tint, 46)), (0.55, (*tint, 0))]))

    # 3. La ilustracion, encaje "cover" centrado (ImageOps.fit = cover-crop).
    art = ImageOps.fit(frame.convert("RGBA"), (w, h), method=Image.LANCZOS, centering=(0.5, 0.5))
    base.alpha_composite(art)

    # 4. Tinte plano 0.14 sobre la ilustracion.
    base.alpha_composite(flat(w, h, (*tint, 36)))

    # 5. Fundido inferior: arranca en 0.57 (el stop 0 esta en 0.62) y llega al
    #    cuerpo opaco. Es lo que apoya la ilustracion sobre el texto.
    base.alpha_composite(gradient_v(w, h, [(0.57, (*BODY, 0)), (1.0, (*BODY, 255))]))

    # 6. Fundido superior: el nombre tiene que respirar.
    base.alpha_composite(gradient_v(w, h, [(0.0, (*BODY, 245)), (0.18, (*BODY, 0))]))

    # 7. Vineta lateral.
    base.alpha_composite(
        gradient_h(w, h, [(0.0, (*VIGNETTE, 230)), (0.16, (*VIGNETTE, 0)), (0.84, (*VIGNETTE, 0)), (1.0, (*VIGNETTE, 230))])
    )

    # 8. Esquinas redondeadas. Se enmascara UNA vez al final: multiplicar el
    #    alfa por la misma mascara en cada capa da el mismo resultado y es mas
    #    simple de leer.
    return apply_mask(base, radius)


# ---------------------------------------------------------------------------
# Descubrimiento de frames
# ---------------------------------------------------------------------------


def strip_prefix(key: str) -> str:
    """Saca el prefijo `mf_` que agrega ImageGen al nombrar los archivos."""
    return key[3:] if key.startswith("mf_") else key


def discover() -> dict[str, list[tuple[int, Path]]]:
    """Agrupa los frames por clave. Devuelve `clave -> [(indice, ruta)]`."""
    groups: dict[str, list[tuple[int, Path]]] = {}
    if not SOURCE.is_dir():
        return groups

    for path in sorted(SOURCE.rglob("*.png")):
        if path.parent == SOURCE:
            # Archivo suelto: la clave sale del nombre.
            match = FRAME_RE.match(path.stem)
            if not match:
                print(f"  ! no se entiende el nombre, se ignora: {path.name}")
                continue
            key = strip_prefix(match.group("key"))
            index = int(match.group("idx"))
        else:
            # Dentro de una carpeta: la clave es la carpeta.
            match = FRAME_RE.match(path.stem)
            if not match:
                print(f"  ! no se entiende el nombre, se ignora: {path}")
                continue
            key = strip_prefix(path.parent.name)
            index = int(match.group("idx"))

        groups.setdefault(key, []).append((index, path))

    return groups


def grid_for(count: int, cols_override: int | None) -> tuple[int, int]:
    """Columnas y filas para `count` frames.

    3 columnas para 6 frames es lo que da una hoja casi cuadrada (1152x1116),
    que es la forma que mejor aprovecha una textura cuadrada en la GPU.
    """
    cols = cols_override or (3 if count <= 6 else 4)
    cols = max(1, min(cols, count))
    rows = -(-count // cols)  # techo de la division
    return cols, rows


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


def main() -> int:
    parser = argparse.ArgumentParser(description="Empaqueta frames de MotionFrames en hojas.")
    parser.add_argument("--fps", type=float, default=6.0, help="frames por segundo (default 6)")
    parser.add_argument("--cols", type=int, default=None, help="columnas de la grilla (default auto)")
    parser.add_argument("--no-pingpong", action="store_true", help="loop directo en vez de ping-pong")
    parser.add_argument("--check", action="store_true", help="solo informa lo que haria")
    args = parser.parse_args()

    groups = discover()
    if not groups:
        # No es un error: puede que todavia no haya frames generados. Se sigue
        # igual para PODAR el manifiesto (una hoja borrada no puede quedar
        # declarada) y para dejarlo creado: si no existe, el `fetch` del juego
        # da 404 y el arranque registra un error de consola.
        print(f"No hay frames en {SOURCE.relative_to(ROOT)}")

    # Manifiesto existente: se conserva lo que siga siendo valido.
    sheets: dict[str, dict[str, object]] = {}
    if MANIFEST.exists():
        try:
            data = json.loads(MANIFEST.read_text(encoding="utf8"))
            if isinstance(data.get("sheets"), dict):
                sheets = data["sheets"]
        except (json.JSONDecodeError, OSError):
            sheets = {}

    written: list[str] = []
    skipped: list[str] = []

    for key in sorted(groups):
        frames = sorted(groups[key], key=lambda item: item[0])
        static = ART / f"{key}.webp"
        if not static.exists():
            # Sin arte estatico la hoja nunca se pediria: el manifiesto se
            # indexa por ese archivo. Avisa y salta.
            print(f"  ! {key}: no existe {static.relative_to(ROOT)}, se salta")
            skipped.append(key)
            continue

        if len(frames) < 2:
            print(f"  ! {key}: {len(frames)} frame, hacen falta 2 o mas, se salta")
            skipped.append(key)
            continue

        cols, rows = grid_for(len(frames), args.cols)
        element = element_for(key)
        cells: list[Image.Image] = []
        for _, path in frames:
            with Image.open(path) as img:
                cells.append(treat(img, element, CELL))

        sheet = Image.new("RGBA", (cols * CELL[0], rows * CELL[1]), (0, 0, 0, 0))
        for i, cell_img in enumerate(cells):
            x = (i % cols) * CELL[0]
            y = (i // cols) * CELL[1]
            # Se pega con su propio alfa como mascara para conservar las
            # esquinas redondeadas transparentes.
            sheet.paste(cell_img, (x, y), cell_img)

        out = ART / f"mf_{key}.webp"
        size_kb = 0
        if not args.check:
            ART.mkdir(parents=True, exist_ok=True)
            sheet.save(out, "WEBP", quality=WEBP_QUALITY, method=6)
            size_kb = out.stat().st_size // 1024

        sheets[f"{key}.webp"] = {
            "file": out.name,
            "cols": cols,
            "rows": rows,
            "fps": args.fps,
            "pingPong": not args.no_pingpong,
        }
        written.append(f"{key}: {len(frames)} frames {cols}x{rows} ({sheet.width}x{sheet.height}) {size_kb} KB")

    # Se descartan las entradas cuyo archivo ya no existe (hoja borrada o
    # renombrada): un manifiesto que apunta a la nada pide un 404 por carta.
    for art_file in list(sheets):
        if not (ART / str(sheets[art_file].get("file", ""))).exists():
            sheets.pop(art_file, None)

    for line in written:
        print(f"  + {line}")
    for key in skipped:
        print(f"  - {key} (sin hoja)")

    if args.check:
        print(f"\n(--check) se escribirian {len(written)} hojas, {len(sheets)} en el manifiesto")
        return 0

    ART.mkdir(parents=True, exist_ok=True)
    MANIFEST.write_text(
        json.dumps({"sheets": dict(sorted(sheets.items()))}, indent=2, ensure_ascii=False) + "\n",
        encoding="utf8",
    )
    print(f"\n{MANIFEST.relative_to(ROOT)}: {len(sheets)} hojas declaradas")
    return 0


if __name__ == "__main__":
    sys.exit(main())
