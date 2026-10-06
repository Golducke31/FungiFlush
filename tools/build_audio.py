"""
build_audio.py — Prepara el audio para el juego.

Convierte los WAV de `audio-source/` a OGG Vorbis en `public/audio/` y escribe el
manifiesto `public/audio/index.json`.

POR QUE CONVERTIR
-----------------
Los dos temas son 32 s de estereo 44.1 kHz a 16 bits: **5,65 MB cada uno**. Son
11,3 MB de descarga antes de que el juego muestre el menu, y en el WebView de un
celular eso es tiempo de arranque y RAM. En OGG Vorbis a ~96 kbps quedan en
~400 KB (-93%) y a oido no se distingue en un loop de fondo.

LAS FUENTES VAN EN `audio-source/`, NO EN `public/audio/`
----------------------------------------------------------
Mismo criterio que `art-source/` con `optimize_art.py`: los WAV de origen NO se
versionan (`.gitignore`), se versiona solo el OGG procesado. Asi se puede
reprocesar con otro bitrate sin volver a pedir los archivos.

FFMPEG
------
Se busca en el PATH y, si no esta, en la ruta gestionada del entorno
(`~/.workbuddy-ai/binaries/ffmpeg/`). Necesita el encoder `libvorbis`.

Uso:
    python tools/build_audio.py            # convierte lo que falte o cambio
    python tools/build_audio.py --force    # reconvierte todo
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "audio-source"
OUT = ROOT / "public" / "audio"

# Bitrate por familia. La musica es un loop de fondo: no necesita mas. Los SFX
# son cortos y con ataque, asi que llevan un poco mas para no perder el golpe.
QUALITY = {"music": "4", "sfx": "5"}

FFMPEG_FALLBACK = Path.home() / ".workbuddy-ai" / "binaries" / "ffmpeg" / "ffmpeg.exe"


def find_ffmpeg() -> str:
    """Devuelve la ruta de ffmpeg o aborta con un mensaje util."""
    found = shutil.which("ffmpeg")
    if found:
        return found
    if FFMPEG_FALLBACK.exists():
        return str(FFMPEG_FALLBACK)
    sys.exit(
        "No encontre ffmpeg.\n"
        "  Instalalo y que este en el PATH, o dejalo en:\n"
        f"  {FFMPEG_FALLBACK}"
    )


def needs_build(src: Path, dst: Path, force: bool) -> bool:
    """Solo reconvierte si la fuente es mas nueva (o si --force)."""
    if force or not dst.exists():
        return True
    return src.stat().st_mtime > dst.stat().st_mtime


def convert(ffmpeg: str, src: Path, dst: Path, quality: str) -> bool:
    """WAV -> OGG. Devuelve False si fallo (sin cortar el resto)."""
    cmd = [
        ffmpeg, "-hide_banner", "-loglevel", "error", "-y",
        "-i", str(src),
        "-c:a", "libvorbis", "-q:a", quality,
        # Sin video ni metadatos: el archivo lo sirve un <audio>/fetch, no un reproductor.
        "-vn", "-map_metadata", "-1",
        str(dst),
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        print(f"  XX {src.name}: {result.stderr.strip().splitlines()[-1] if result.stderr else 'error'}")
        return False
    return True


def main() -> None:
    force = "--force" in sys.argv
    if not SRC.exists():
        sys.exit(f"No existe {SRC}. Los WAV de origen van ahi (ver .gitignore).")

    ffmpeg = find_ffmpeg()
    OUT.mkdir(parents=True, exist_ok=True)

    manifest: dict[str, dict[str, object]] = {"music": {}, "sfx": {}}
    total_in = 0
    total_out = 0
    converted = 0
    failed = 0

    for family in ("music", "sfx"):
        folder = SRC / family
        if not folder.exists():
            continue
        for src in sorted(folder.glob("*.wav")):
            key = src.stem
            dst = OUT / f"{family}_{key}.ogg"
            total_in += src.stat().st_size

            if needs_build(src, dst, force):
                if not convert(ffmpeg, src, dst, QUALITY[family]):
                    failed += 1
                    continue
                converted += 1
            total_out += dst.stat().st_size

            # El manifiesto lo consume `AudioBus` para saber que ids tienen archivo.
            manifest[family][key] = {
                "file": dst.name,
                "bytes": dst.stat().st_size,
            }

    index = OUT / "index.json"
    index.write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    mb = 1024 * 1024
    print(f"ffmpeg     {ffmpeg}")
    print(f"musica     {len(manifest['music'])} tema(s)")
    print(f"sfx        {len(manifest['sfx'])} sonido(s)")
    print(f"convertidos {converted}" + (f"  ({failed} con error)" if failed else ""))
    if total_in:
        print(f"peso       {total_in / mb:.1f} MB -> {total_out / mb:.2f} MB  (-{100 - total_out * 100 / total_in:.0f}%)")
    print(f"manifiesto {index.relative_to(ROOT)}")

    if failed:
        sys.exit(1)


if __name__ == "__main__":
    main()
