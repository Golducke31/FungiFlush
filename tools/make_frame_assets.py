"""
tools/make_frame_assets.py

Regenera los assets de MARCO (art_frame_frame_<id>.webp) dejandolos como
MARCO PURO: el fondo oscuro que tenian se vuelve TRANSPARENTE, asi el avatar
(carta inferior) se ve a traves del hueco central.

ANTES: el frame era una imagen completa (RGB, fondo negro opaco cubriendo
       toda la caja). Al equiparlo sobre el avatar, el centro negro TAPABA
       el hongo (bug reportado por el jugador: "el marco es una imagen
       completa, no solo el marco, y al equiparlo se tapa el hongo").
AHORA: el frame solo trae el anillo (vinas / ornamentos) sobre un fondo
       transparente. El avatar se ve a traves del hueco.

Tecnica: se aprovecha que el fondo es uniformemente ~(1,1,1) y el anillo es
claramente brillante en al menos un canal. Se calcula max(R,G,B) por pixel
y se mapea a alpha con un smoothstep suave para que el borde del glow no
quede recortado en seco. Asi el halo del marco se desvanece en alpha y se
funde con el avatar.

Se ejecuta desde el venv de arte (Pillow + numpy), segun la convencion del
proyecto.
"""
import os
import sys
from pathlib import Path
from PIL import Image
import numpy as np

REPO = Path(__file__).resolve().parents[1]
ART = REPO / 'public' / 'art'

# Umbrales del smoothstep (sobre max(R,G,B), 0..255). El fondo esta en ~1 y
# el anillo en >>40; un borde suave entre 18 y 32 recorta el fondo pero
# conserva el glow del anillo sin costuras duras.
T_DARK, T_BRIGHT = 18.0, 32.0

# Frames a regenerar. Cada id resuelve por la convencion art_frame_<id>.webp.
FRAME_IDS = ['frame_common', 'frame_uncommon']


def frame_only(in_path: Path, out_path: Path) -> None:
    im = Image.open(in_path).convert('RGB')
    rgb = np.asarray(im, dtype=np.uint8)  # H,W,3
    # Brillo por pixel = maximo de los tres canales. Fondo ~1, anillo brillante.
    m = rgb.max(axis=2).astype(np.float32)
    # Smoothstep: alpha 0 bajo T_DARK, alpha 255 sobre T_BRIGHT.
    t = np.clip((m - T_DARK) / max(1.0, T_BRIGHT - T_DARK), 0.0, 1.0)
    # Curva suave (smoothstep cubica) para que el borde del halo se desvanezca
    # sin un corte visible.
    t = t * t * (3.0 - 2.0 * t)
    alpha = (t * 255.0 + 0.5).astype(np.uint8)
    rgba = np.concatenate([rgb, alpha[..., None]], axis=2)
    out = Image.fromarray(rgba, mode='RGBA')
    out.save(out_path, 'WEBP', quality=92, method=6)
    h, w = alpha.shape
    cy, cx = h // 2, w // 2
    print(
        f'  {in_path.name}: center alpha={int(alpha[cy, cx])} '
        f'corner alpha={int(alpha[0, 0])} ring(alpha/cy,10)={int(alpha[cy, 10])} '
        f'-> {out_path.name} ({out_path.stat().st_size} B)',
        file=sys.stderr,
    )


def main() -> int:
    changed = []
    for fid in FRAME_IDS:
        src = ART / f'art_frame_{fid}.webp'
        if not src.exists():
            print(f'  (skip) {src} no existe', file=sys.stderr)
            continue
        bak = src.with_suffix(src.suffix + '.bak')
        if not bak.exists():
            os.replace(src, bak)
        else:
            src.unlink(missing_ok=True)
        frame_only(bak, src)
        changed.append(str(src.relative_to(REPO)))
    print('Regenerados:', ', '.join(changed) if changed else '(ninguno)')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
