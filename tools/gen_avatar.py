"""
gen_avatar.py — Recorta el avatar de la Colonia a un PRIMER PLANO legible.

## El bug que arregla

`art_avatar_avatar.png` (el arte del reward de nivel 8) era una ESCENA ancha:
una seta pequeña en el centro de un cuadro nocturno enorme y oscuro. En la
Tarjeta de Jugador se dibuja en un circulo de 34px (chip del menu) o 64px (ficha
grande), asi que al entrar completa solo se veia la banda oscura del medio: el
jugador reportaba "el avatar no aparece" teniendo el cosmetico equipado. El arte
estaba, pero era invisible a tamano de uso.

## Que hace (determinista, sin IA)

Es un POST-PROCESADOR, igual que `gen_card_frame.py`: no genera arte nuevo, toma
el PNG de `art-source/` y lo encuadra.

  1. RECORTA al bounding box del sujeto (la seta) con un margen, para que llene
     el cuadro en vez de perderse en el fondo.
  2. SUBE exposicion y saturacion: el render 3D venia oscuro y a 34px necesita
     contraste para leerse.
  3. ENCUADRA a cuadrado 1:1 (el slot es un circulo).

## Uso

    python tools/gen_avatar.py

Escribe `art-source/art_avatar_avatar.png` EN SITIO (mismo nombre) para que
`optimize_art.py` lo tome tal cual en su proxima corrida. Guarda el original en
`art-source/raw/avatar_raw.png` la primera vez, para poder re-tocar el encuadre
sin volver a pedirle el arte a la IA.
"""
from __future__ import annotations

import shutil
from pathlib import Path

import numpy as np
from PIL import Image, ImageEnhance

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "art-source" / "art_avatar_avatar.png"
RAW_DIR = ROOT / "art-source" / "raw"
RAW = RAW_DIR / "avatar_raw.png"

# Ventana del sujeto en el arte ORIGINAL (1024x1024): la seta con su halo.
# Sale de medir el bounding box de la zona brillante (x 390-629, y 340-652) mas
# un margen para que no toque el borde del circulo.
CROP = (330, 280, 690, 700)  # left, top, right, bottom -> 360x420

# Encuadre cuadrado con el sujeto CENTRADO VERTICALMENTE (el slot es un circulo).
FINAL = 512

EXPOSURE = 1.28   # el render original es oscuro (lum media 33/255)
SATURATION = 1.10
CONTRAST = 1.06


def main() -> int:
    if not SOURCE.is_file():
        print(f"No existe {SOURCE.relative_to(ROOT)}")
        return 1

    RAW_DIR.mkdir(parents=True, exist_ok=True)
    if not RAW.exists():
        shutil.copy2(SOURCE, RAW)
        print(f"Original guardado en {RAW.relative_to(ROOT)}")

    # Se trabaja SIEMPRE desde el original crudo: re-ejecutar no degrada.
    with Image.open(RAW) as img:
        img = img.convert("RGB")
        img = img.crop(CROP)

        # Cuadrado 1:1: se recorta el sobrante de la dimension mayor, centrado.
        w, h = img.size
        side = max(w, h)
        side = min(side, min(w, h))  # recorte centrado al lado menor
        left = (w - side) // 2
        top = (h - side) // 2
        img = img.crop((left, top, left + side, top + side))

        img = img.resize((FINAL, FINAL), Image.LANCZOS)
        img = ImageEnhance.Brightness(img).enhance(EXPOSURE)
        img = ImageEnhance.Color(img).enhance(SATURATION)
        img = ImageEnhance.Contrast(img).enhance(CONTRAST)

        img.save(SOURCE, "PNG")
        print(f"Escrito {SOURCE.relative_to(ROOT)} ({FINAL}x{FINAL})")

    # Reporte de luminancia para verificar que subio.
    with Image.open(SOURCE) as out:
        a = np.asarray(out.convert("RGB")).astype(np.float32)
        lum = 0.2126 * a[:, :, 0] + 0.7152 * a[:, :, 1] + 0.0722 * a[:, :, 2]
        # Centro (donde vive el sujeto en un slot circular).
        h, w = lum.shape
        center = lum[h // 4 : 3 * h // 4, w // 4 : 3 * w // 4]
        print(f"luminancia media global: {lum.mean():.1f} (antes 33.3)")
        print(f"luminancia media centro: {center.mean():.1f}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
