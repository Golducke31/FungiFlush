"""
gen_motion_frames.py — Deriva los frames de una ilustracion ANIMADA a partir
de su arte ESTATICO, sin generar imagenes nuevas.

POR QUE PROCEDURAL Y NO IMG2IMG
-------------------------------
Una animacion por frames necesita que los frames sean EL MISMO dibujo. Pedirle
6 variaciones a un modelo de imagen da 6 ilustraciones *parecidas*: la seta
cambia de forma, las rocas se mueven, y al reproducirlas la carta tiembla. Ese
defecto es peor que no animar.

Aca se parte del arte que ya esta aprobado y se le aplica una TRANSFORMACION
FOTOMETRICA por frame: solo se mueve la luz. El dibujo es identico en los 6
frames por construccion, asi que no puede temblar.

QUE HACE
--------
Por cada frame k (0..N-1) con `p` = curva de respiracion (0 = apagado, 1 = pico):

  1. Mascara de brillo  `g`  = luminancia alta, realzada. Solo respira lo que
     brilla (las venas, el cristal, la nube de esporas); el musgo y la roca no.
  2. Ganancia          rgb *= 1 + amount * g * p
  3. Halo              se desenfoca lo brillante y se suma. Al crecer con `p`,
     el resplandor se ENSANCHA: eso es lo que se lee como "respirar" y no como
     un simple cambio de brillo.
  4. Exposicion global rgb *= 1 + 0.05 * p  (muy leve, para que el frame entero
     acompanie y no quede un parche encendido).

La curva es `(1 - cos(pi * k/(N-1))) / 2`: entra y sale suave. Con `pingPong`
en el manifiesto el recorrido es 0..N-1..1, o sea una respiracion completa.

SALIDA
------
  art-source/motionframes/<clave>_f01.png ... _f06.png

Despues: `python tools/pack_motion_frames.py` arma la hoja y el manifiesto.

USO
---
  python tools/gen_motion_frames.py                       (las 4 del lote V2)
  python tools/gen_motion_frames.py --keys art_card_x     (una sola)
  python tools/gen_motion_frames.py --frames 8 --amount 0.9
  python tools/gen_motion_frames.py --check               (no escribe)
"""

from __future__ import annotations

import argparse
import math
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
ART = ROOT / "public" / "art"
OUT = ROOT / "art-source" / "motionframes"

# Lote V2: TODAS las ilustraciones de carta del juego.
#
# Cada carta tiene su PROPIA ilustracion (`art_card_own_<id>`) o cae al arte de
# su elemento (`art_card_<elemento>_<rareza>`): 65 cartas -> 65 archivos
# distintos, uno por carta. Animar "el arte del elemento" casi no se ve, porque
# solo lo usan las cartas sin arte propio; y animar solo el mazo inicial deja
# media mano quieta en cuanto la run avanza a un mazo de arquetipo.
#
# Como los frames son PROCEDURALES (no cuestan creditos ni tiempo), se animan
# los 65. La lista es la resolucion real de la cadena de arte
# (`artKeysFor` en ArtAssets.ts) sobre `src/data/packs/base/cards/*.json`.
DEFAULT_KEYS = [
    "art_card_crystal_common",
    "art_card_crystal_legendary",
    "art_card_crystal_rare",
    "art_card_crystal_uncommon",
    "art_card_decay_common",
    "art_card_decay_legendary",
    "art_card_decay_uncommon",
    "art_card_mycelium_common",
    "art_card_mycelium_legendary",
    "art_card_mycelium_rare",
    "art_card_mycelium_uncommon",
    "art_card_own_amanita_apex_toxica",
    "art_card_own_bridge_saprophyte",
    "art_card_own_colony_agaric_thread",
    "art_card_own_colony_amanita_web",
    "art_card_own_colony_boletus_root",
    "art_card_own_colony_clavaria_filament",
    "art_card_own_colony_network_node",
    "art_card_own_colony_rhizomorph",
    "art_card_own_cordyceps_mind",
    "art_card_own_crystal_agaric_facet",
    "art_card_own_crystal_amanita_shard",
    "art_card_own_crystal_boletus_prism",
    "art_card_own_crystal_glasscap",
    "art_card_own_crystal_grand_coral",
    "art_card_own_crystal_prism_gill",
    "art_card_own_crystal_shard_bloom",
    "art_card_own_crystal_tricholoma_lens",
    "art_card_own_decay_agaric_mould",
    "art_card_own_decay_amanita_blight",
    "art_card_own_decay_ancient_stump",
    "art_card_own_decay_boletus_slime",
    "art_card_own_decay_carrion_bloom",
    "art_card_own_decay_clavaria_ash",
    "art_card_own_decay_compost_heap",
    "art_card_own_decay_inkcap",
    "art_card_own_decay_rotwood",
    "art_card_own_ergot_rye",
    "art_card_own_ghost_fungus",
    "art_card_own_mycelium_truffle",
    "art_card_own_mycelium_webcap",
    "art_card_own_poison_goldcap",
    "art_card_own_shiitake_hearty",
    "art_card_own_spore_amanita_veil",
    "art_card_own_spore_archetype_burst_cap",
    "art_card_own_spore_archetype_signal",
    "art_card_own_spore_boletus_puff",
    "art_card_own_spore_clavaria_spray",
    "art_card_own_spore_fairycake",
    "art_card_own_spore_psilocybe_dust",
    "art_card_own_spore_veilcap",
    "art_card_own_symbiosis_mycorrhiza",
    "art_card_own_wild_dung_beetle",
    "art_card_parasite_rare",
    "art_card_parasite_uncommon",
    "art_card_poison_common",
    "art_card_poison_legendary",
    "art_card_poison_mythic",
    "art_card_poison_uncommon",
    "art_card_spore_common",
    "art_card_spore_rare",
    "art_card_spore_uncommon",
    "art_card_symbiosis_common",
    "art_card_symbiosis_rare",
    "art_card_symbiosis_uncommon",
]

# Luminancia Rec.601: el mismo peso que usa `createHeightCanvas`.
LUM = np.array([0.299, 0.587, 0.114], dtype=np.float32)


def brightness_mask(rgb: np.ndarray) -> np.ndarray:
    """Peso 0..1 de "cuanto participa del pulso" cada pixel.

    Dos condiciones, no una:

      1. BRILLO. Corte en 0.30 para dejar afuera el fondo y el musgo, con
         exponente 1.4 para que el resplandor se concentre en los nucleos.
      2. SATURACION. Sin esto, un cuerpo claro y grande (la seta crema de
         `spore_fairycake`) se toma como "luminoso" y el pulso lo quema a
         blanco. Lo que brilla en estas ilustraciones es COLOR: venas violetas,
         esporas doradas, cristal cian. El piso de 0.35 deja respirar igual a
         los sujetos palidos, sin lavarlos.
    """
    lum = rgb @ LUM
    bright = np.clip((lum - 0.30) / 0.50, 0.0, 1.0) ** 1.4

    high = rgb.max(axis=2)
    low = rgb.min(axis=2)
    sat = np.where(high > 1e-4, (high - low) / np.maximum(high, 1e-4), 0.0)
    sat_weight = 0.35 + 0.65 * np.clip((sat - 0.10) / 0.35, 0.0, 1.0)

    return bright * sat_weight


def rolloff(rgb: np.ndarray, knee: float = 0.80, k: float = 8.0) -> np.ndarray:
    """Comprime los altos en vez de recortarlos.

    Multiplicar y despues `clip` deja parches planos de blanco puro: se pierde
    el relieve de la seta justo cuando mas brilla. Con una rodilla suave el
    brillo sigue subiendo pero NUNCA llega a 1.0.

    El `k` no es cosmetico: fija el limite asintotico en `knee + 1/k`. Con
    rodilla 0.80 hace falta `k > 5.5` para que ese techo quede bajo 1.0; si no,
    el resplandor grande (la nube de esporas doradas de `spore_fairycake`) pasa
    la rodilla, sigue creciendo y recorta igual. `k = 8` deja techo en 0.925.
    """
    over = np.maximum(rgb - knee, 0.0)
    return np.where(rgb > knee, knee + over / (1.0 + over * k), rgb)


def blur(rgb: np.ndarray, radius: float) -> np.ndarray:
    """Desenfoque gaussiano sobre un array float 0..1 (via PIL, en 8 bits).

    Se redondea a 8 bits para el blur: el halo es un degradado suave, asi que
    el error de cuantizacion es invisible y evita depender de cv2.
    """
    img = Image.fromarray(np.clip(rgb * 255.0, 0, 255).astype(np.uint8), "RGB")
    img = img.filter(ImageFilter.GaussianBlur(radius))
    return np.asarray(img, dtype=np.float32) / 255.0


def pulse(rgb: np.ndarray, mask: np.ndarray, p: float, amount: float) -> np.ndarray:
    """Un frame: el arte base con el resplandor en el punto `p` (0..1)."""
    # 1-2. Lo que brilla se enciende. La ganancia directa es MODERADA: lo que
    #      tiene que crecer es el halo, no el cuerpo del sujeto.
    out = rgb * (1.0 + amount * mask[..., None] * p)

    # 3. Halo: el resplandor se ensancha. El radio crece con `p`, que es lo que
    #    se lee como respiracion (un brillo que solo sube de intensidad se ve
    #    como un fade). El coeficiente es moderado a proposito: sumar el halo
    #    completo de una nube ya brillante la lleva a blanco aunque despues
    #    comprima; con 0.55 el pico llega a ~0.9 y el humo sigue siendo humo.
    if p > 0.001:
        glow = rgb * mask[..., None]
        radius = 6.0 + 16.0 * p
        out = out + blur(glow, radius) * (0.55 * p)

    # 4. Exposicion global minima.
    out = out * (1.0 + 0.05 * p)
    return np.clip(rolloff(out), 0.0, 1.0)


def curve(k: int, n: int) -> float:
    """Curva de respiracion para el frame `k` de `n`: 0 -> 1, suave en extremos."""
    if n <= 1:
        return 0.0
    return (1.0 - math.cos(math.pi * k / (n - 1))) / 2.0


def main() -> int:
    parser = argparse.ArgumentParser(description="Genera frames de MotionFrames desde el arte estatico.")
    parser.add_argument("--keys", nargs="+", default=DEFAULT_KEYS, help="stems de arte a animar")
    parser.add_argument("--frames", type=int, default=6, help="frames por ilustracion (default 6)")
    parser.add_argument("--amount", type=float, default=0.45, help="cuanto se enciende el pico (default 0.70)")
    parser.add_argument("--check", action="store_true", help="solo informa, no escribe")
    args = parser.parse_args()

    if args.frames < 2:
        print("--frames tiene que ser 2 o mas")
        return 1

    OUT.mkdir(parents=True, exist_ok=True)
    missing = 0

    for key in args.keys:
        src_path = ART / f"{key}.webp"
        if not src_path.exists():
            print(f"  ! {key}: no existe {src_path.relative_to(ROOT)}")
            missing += 1
            continue

        with Image.open(src_path) as img:
            rgb = np.asarray(img.convert("RGB"), dtype=np.float32) / 255.0
        mask = brightness_mask(rgb)
        # Cuanto del dibujo participa del pulso: sirve para avisar si una
        # ilustracion es tan oscura que la animacion no se va a notar.
        lit = float(mask.mean())

        for k in range(args.frames):
            p = curve(k, args.frames)
            frame = pulse(rgb, mask, p, args.amount)
            if not args.check:
                Image.fromarray((frame * 255.0 + 0.5).astype(np.uint8), "RGB").save(
                    OUT / f"{key}_f{k + 1:02d}.png"
                )

        print(f"  + {key}: {args.frames} frames (brillo medio {lit:.3f})")

    if args.check:
        print(f"\n(--check) {len(args.keys) - missing} ilustraciones listas para animar")
    else:
        print(f"\nframes en {OUT.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
