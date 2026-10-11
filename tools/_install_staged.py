"""Instala el arte generado desde el directorio de staging a art-source/.

Los prompts de generacion empiezan con `S_<clave>.` para que el archivo de salida
se llame `S_<clave>_<timestamp>.png` y no colisione entre generaciones paralelas
(el generador nombra por las primeras palabras del prompt + timestamp a segundos).

Uso:
    python tools/_install_staged.py <staging_dir> [--dry]
"""
from __future__ import annotations

import os
import re
import shutil
import sys
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "art-source")
BACKUP = os.path.join(SRC, "backup_old_art")

STAMP = re.compile(r"_\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}$")
PREFIX = "S_"


def canonical(key: str) -> str | None:
    if key == "card_frame":
        return "art_card_frame.png"
    if key.startswith("own_"):
        return f"art_card_own_{key[4:]}.png"
    if key.startswith("blind_"):
        return f"art_blind_{key[6:]}.png"
    if key.startswith("cardback"):
        return f"art_{key}.png"
    if key.startswith("card_"):
        return f"art_{key}.png"
    return None


def known_keys() -> set[str]:
    """Claves esperadas del proyecto, para reparar tokens truncados por el generador.

    El generador corta el nombre a ~30 caracteres, asi que un id largo pierde la
    cola (`..._burst_cap` -> `..._burst_ca`). Se resuelve por prefijo unico.
    """
    import glob
    import json

    keys: set[str] = {"card_frame", "cardback", "cardback_mycelial"}
    elements = [
        "neutral", "poison", "spore", "decay",
        "symbiosis", "crystal", "mycelium", "parasite",
    ]
    for e in elements:
        for r in ("common", "uncommon", "rare", "legendary", "mythic"):
            keys.add(f"card_{e}_{r}")

    def first_list(path):
        data = json.load(open(path, encoding="utf8"))
        if isinstance(data, list):
            return data
        for v in data.values():
            if isinstance(v, list) and v and isinstance(v[0], dict):
                return v
        return []

    for path in glob.glob(os.path.join(ROOT, "src/data/packs/*/cards/*.json")):
        for card in first_list(path):
            if card.get("id"):
                keys.add(f"own_{card['id']}")
    for path in glob.glob(os.path.join(ROOT, "src/data/packs/*/blinds.json")):
        for blind in first_list(path):
            if blind.get("art"):
                keys.add(f"blind_{blind['art']}")
    return keys


KNOWN = known_keys()


def repair(key: str) -> str:
    if key in KNOWN:
        return key
    candidates = [k for k in KNOWN if k.startswith(key)]
    return candidates[0] if len(candidates) == 1 else key


def main() -> int:
    if len(sys.argv) < 2:
        print(__doc__)
        return 2
    staging = sys.argv[1]
    dry = "--dry" in sys.argv
    if not os.path.isdir(staging):
        print(f"no existe: {staging}")
        return 2

    os.makedirs(BACKUP, exist_ok=True)
    installed = 0
    unknown = []
    now = time.time()
    for name in sorted(os.listdir(staging)):
        if not name.lower().endswith(".png") or not name.startswith(PREFIX):
            continue
        # Una generacion paralela puede estar escribiendo el archivo ahora mismo:
        # ignorar lo recien tocado y dejarlo para la proxima pasada.
        if now - os.path.getmtime(os.path.join(staging, name)) < 15:
            print(f"  (en vuelo, se omite) {name}")
            continue
        # El generador nombra con las primeras palabras del prompt: el token queda
        # como `S_<clave>.` y el resto ("Keep the EXACT...") sigue despues. El
        # slug del punto + espacio produce un doble guion bajo, que es el corte.
        stem = STAMP.sub("", os.path.splitext(name)[0])
        key = stem.split("__")[0]
        if key.startswith(PREFIX):
            key = key[len(PREFIX):]
        key = repair(key)
        target = canonical(key)
        if target is None:
            unknown.append((name, key))
            continue
        dst = os.path.join(SRC, target)
        if os.path.exists(dst):
            bkp = os.path.join(BACKUP, target)
            if not os.path.exists(bkp):
                shutil.copy2(dst, bkp)
        if dry:
            print(f"[dry] {name} -> {target}")
        else:
            shutil.copy2(os.path.join(staging, name), dst)
            os.remove(os.path.join(staging, name))
            print(f"{name} -> {target}")
        installed += 1

    print(f"\ninstalados: {installed}")
    for name, key in unknown:
        print(f"  SIN MAPEO: {name} (clave '{key}')")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
