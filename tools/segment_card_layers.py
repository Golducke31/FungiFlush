"""
segment_card_layers.py — Separa el arte de una carta en 3 capas con ALFA.

    fondo (bg)  ·  hongo principal (subject)  ·  primer plano (fg)

y las exporta como PNG RGBA optimizado, listas para el parallax (Card3D/CardTexture).

POR QUE HACE FALTA
------------------
El rediseno pide que el arte se mueva en capas: al tiltar la carta 3D, el fondo, el
hongo y el primer plano se desplazan a distinta velocidad (parallax real, no solo la
capa de texto que ya existe). Para eso cada capa tiene que ser un PNG con transparencia.

LA REALIDAD DEL DATASET (leer antes de tocar umbrales)
-----------------------------------------------------
El arte actual NO tiene fondo plano chroma. Todas las cartas comparten una escena
oscura teal (#080b10 -> #0d131b) con musgo, niebla y un sujeto en la banda 18%-62% de
la altura. Todo es RGB OPACO. Entonces el "Color Keying" aca NO es un magenta plano:
es un keying del fondo teal por RANGO DE COLOR + LUMINANCIA, combinando H, S y V (solo
V se comeria un hongo oscuro).

Por eso hay DOS modos:
  - `teal`   (default): keying sobre la escena oscura del dataset actual. Recorte medio.
  - `chroma`           : keying de un color plano (magenta #ff00ff / verde). Recorte de
                         calidad produccion. Requiere RE-ENCARGAR el arte con fondo plano
                         (ver docs/PIPELINE_CAPAS.md).

LIBRERIAS
---------
Pillow + NumPy como base. OpenCV es OPCIONAL: si `cv2` esta, se usa para morfologia,
componentes conexas, grabCut (refinado de bordes) e inpaint (tapar el sujeto en el fondo).
Si no esta, el tool degrada con gracia a implementaciones NumPy/equivalentes de Pillow.

Uso:
    python tools/segment_card_layers.py                     # todo art-source/*.png
    python tools/segment_card_layers.py --only art_card_own_*
    python tools/segment_card_layers.py --mode chroma
    python tools/segment_card_layers.py --debug-masks       # overlays de validacion
    npm run art:layers                                      # esto + el indice
"""

from __future__ import annotations

import argparse
import fnmatch
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

# --- OpenCV es OPCIONAL -------------------------------------------------------
try:
    import cv2  # type: ignore

    HAVE_CV2 = True
except Exception:  # pragma: no cover - depende del entorno
    cv2 = None  # type: ignore
    HAVE_CV2 = False

# --- guia de cv2.ximgproc (guided filter): OPCIONAL, viene en opencv-contrib ---
try:
    if HAVE_CV2 and hasattr(cv2, "ximgproc"):
        HAVE_XIMGPROC = True
    else:  # pragma: no cover
        HAVE_XIMGPROC = False
except Exception:  # pragma: no cover
    HAVE_XIMGPROC = False

# --- pymatting (closed-form / KNN matting): OPCIONAL ---------------------------
# Es el salto de calidad principal (alpha SUAVE en pelo, pelusa, halos). Si no
# esta, se cae a la guia (guided filter) y si tampoco, a la mascara binaria de
# siempre: el resultado tiene que quedar EXACTAMENTE como antes de esta feature.
try:
    from pymatting import estimate_alpha_cf, estimate_alpha_knn  # type: ignore

    HAVE_PYMATTING = True
except Exception:  # pragma: no cover - depende del entorno
    estimate_alpha_cf = None  # type: ignore
    estimate_alpha_knn = None  # type: ignore
    HAVE_PYMATTING = False

# --- rembg (U2-Net / ISNet): respaldo ML para casos donde la heuristica falla --
try:
    from rembg import remove as rembg_remove  # type: ignore

    HAVE_REMBG = True
except Exception:  # pragma: no cover
    rembg_remove = None  # type: ignore
    HAVE_REMBG = False

# --- LaMa (inpaint por difusion): OPCIONAL -------------------------------------
try:
    from simple_lama_inpainting import SimpleLama  # type: ignore

    HAVE_LAMA = True
except Exception:  # pragma: no cover
    SimpleLama = None  # type: ignore
    HAVE_LAMA = False

# --- Depth Anything (mapa de profundidad por carta): OPCIONAL ------------------
try:
    from transformers import pipeline as hf_pipeline  # type: ignore

    HAVE_DEPTH = True
except Exception:  # pragma: no cover
    hf_pipeline = None  # type: ignore
    HAVE_DEPTH = False


ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "art-source"
OUT = ROOT / "public" / "art" / "layers"
MASK_OUT = SOURCE / "layers" / "_mask"
CONFIG_PATH = ROOT / "tools" / "segment_config.json"

DEFAULTS: dict = {
    "mode": "teal",
    "chroma_color": "#ff00ff",
    "color_tolerance": 18,
    "chroma_softness": 10,
    "teal_h_range": [0.47, 0.60],
    "s_bg_max": 0.45,
    "v_bg_max": 0.24,
    "v_moss_max": 0.30,
    "moss_h_range": [0.18, 0.45],
    "contrast_min": 0.055,
    "edge_min": 0.08,
    "v_off_hue_min": 0.35,
    "s_off_hue_min": 0.15,
    "v_subject_min": 0.55,
    "s_subject_min": 0.62,
    "moss_as": "bg",
    "subject_band": [0.16, 0.66],
    "feather_px": 2.5,
    "grow_px": 1,
    "shrink_px": 1,
    "morph_kernel": 5,
    "min_component_area": 0.004,
    "bg_fill_diffuse": 28,
    "use_grabcut": False,
    # --- Matting (alpha suave en los bordes: el salto de calidad principal) ---
    # La mascara heuristica se usa como TRIMAP: erode/dilate definen el sujeto
    # seguro y el fondo seguro, y el matting resuelve SOLO la banda incierta entre
    # ambos. Es lo mas caro del pipeline (closed-form/KNN escalan con los pixeles
    # inciertos), asi que restringirlo a la banda lo hace viable.
    "matting_backend": "pymatting",   # none | pymatting | guided (auto-degrada)
    "matting_band_only": True,        # False = matting sobre la carta completa
    "trimap_erode_px": 8,             # ancho del sujeto seguro (px)
    "trimap_dilate_px": 10,           # ancho del fondo seguro (px)
    "matting_max_side": 512,          # limita el lado mayor de la region a matting
    # --- Respaldo ML (rembg / SAM): solo si la heuristica falla ---
    "ml_backend": "none",             # none | rembg
    "ml_iou_min": 0.80,               # IoU minimo vs la heuristica para aceptarla
    # --- Inpaint (rellenar el fondo detras del sujeto) ---
    "inpaint_backend": "cv2",         # cv2 | lama (auto-degrada)
    "inpaint_dilate_px": 6,           # expande el hueco antes de rellenar (4-8)
    "inpaint_mode": "band",           # band (solo unos px mas alla del borde) | full
    "inpaint_band_px": 6,             # ancho de la banda a rellenar en modo band
    # --- Depth (parallax continuo en el shader) ---
    "depth_backend": "none",          # none | depth_anything
    "default_depth": {"bg": 0.15, "subject": 0.5, "fg": 0.85},
    # --- Movimiento idle por capa (lo lee el render; SIN efecto en Python) ---
    "default_motion": {
        "bg": {"amp": 0.006, "speed": 0.35, "noise": 0.004},
        "subject": {"amp": 0.010, "speed": 0.60, "noise": 0.006},
        "fg": {"amp": 0.008, "speed": 0.45, "noise": 0.003},
    },
    "out_format": "png",
    "webp_quality": 92,
    "card_target": [512, 744],
    "skip_prefixes": ["art_arena", "art_table", "art_avatar_", "art_bgcard_", "art_cardback", "ui_"],
}


# ---------------------------------------------------------------------------
# Utilidades de color
# ---------------------------------------------------------------------------

def hex_to_rgb(value: str) -> tuple[int, int, int]:
    v = value.lstrip("#")
    return int(v[0:2], 16), int(v[2:4], 16), int(v[4:6], 16)


def rgb_to_hsv_np(rgb: np.ndarray) -> np.ndarray:
    """RGB uint8 (H,W,3) -> HSV float32 en [0,1] (H,W,3). Sin dependencias.

    Es la formula estandar (la misma de colorsys) vectorizada. Se usa cuando no
    hay cv2. H en [0,1) con el rojo en 0, S y V en [0,1].
    """
    arr = rgb.astype(np.float32) / 255.0
    r, g, b = arr[..., 0], arr[..., 1], arr[..., 2]
    mx = np.max(arr, axis=-1)
    mn = np.min(arr, axis=-1)
    diff = mx - mn

    h = np.zeros_like(mx)
    nz = diff > 1e-6
    # Canal dominante decide el sector del circulo cromatico.
    rm = nz & (mx == r)
    gm = nz & (mx == g) & ~rm
    bm = nz & (mx == b) & ~rm & ~gm
    h[rm] = ((g - b)[rm] / diff[rm]) % 6.0
    h[gm] = ((b - r)[gm] / diff[gm]) + 2.0
    h[bm] = ((r - g)[bm] / diff[bm]) + 4.0
    h = (h / 6.0) % 1.0

    s = np.where(mx > 1e-6, diff / np.maximum(mx, 1e-6), 0.0)
    v = mx
    return np.stack([h, s, v], axis=-1)


def to_hsv(rgb: np.ndarray) -> np.ndarray:
    """HSV float32 en [0,1] con la MISMA convencion que cv2 (H en [0,180)->[0,1])."""
    if HAVE_CV2:
        hsv = cv2.cvtColor(rgb, cv2.COLOR_RGB2HSV)  # H:0-179 S:0-255 V:0-255
        out = hsv.astype(np.float32)
        out[..., 0] /= 180.0
        out[..., 1] /= 255.0
        out[..., 2] /= 255.0
        return out
    return rgb_to_hsv_np(rgb)


# ---------------------------------------------------------------------------
# Morfologia (cv2 si esta, si no NumPy)
# ---------------------------------------------------------------------------

def _dilate(mask: np.ndarray, k: int) -> np.ndarray:
    if HAVE_CV2:
        kernel = np.ones((k, k), np.uint8)
        return cv2.dilate(mask, kernel, iterations=1)
    if k <= 1:
        return mask
    out = mask.copy()
    r = k // 2
    padded = np.pad(mask, r, mode="constant")
    for dy in range(-r, r + 1):
        for dx in range(-r, r + 1):
            out = np.maximum(out, padded[r + dy: r + dy + mask.shape[0], r + dx: r + dx + mask.shape[1]])
    return out


def _erode(mask: np.ndarray, k: int) -> np.ndarray:
    if HAVE_CV2:
        kernel = np.ones((k, k), np.uint8)
        return cv2.erode(mask, kernel, iterations=1)
    if k <= 1:
        return mask
    out = mask.copy()
    r = k // 2
    padded = np.pad(mask, r, mode="constant", constant_values=255)
    for dy in range(-r, r + 1):
        for dx in range(-r, r + 1):
            out = np.minimum(out, padded[r + dy: r + dy + mask.shape[0], r + dx: r + dx + mask.shape[1]])
    return out


def morph_open_close(mask: np.ndarray, k: int) -> np.ndarray:
    """OPEN (quita ruido) -> CLOSE (rellena huecos)."""
    if k <= 1:
        return mask
    opened = _dilate(_erode(mask, k), k)
    closed = _erode(_dilate(opened, k), k)
    return closed


def keep_largest_components(mask: np.ndarray, min_area_frac: float) -> np.ndarray:
    """Conserva las islas grandes y tira las motas."""
    h, w = mask.shape
    min_area = max(1, int(min_area_frac * h * w))
    if HAVE_CV2:
        n, labels, stats, _ = cv2.connectedComponentsWithStats((mask > 127).astype(np.uint8), 8)
        out = np.zeros_like(mask)
        for i in range(1, n):
            if stats[i, cv2.CC_STAT_AREA] >= min_area:
                out[labels == i] = 255
        return out
    # Fallback NumPy: flood-fill por BFS (una sola pasada por componente).
    binary = mask > 127
    out = np.zeros_like(mask)
    seen = np.zeros_like(binary, dtype=bool)
    hw = (h, w)
    stack: list[tuple[int, int]] = []
    for y0 in range(h):
        for x0 in range(w):
            if not binary[y0, x0] or seen[y0, x0]:
                continue
            comp: list[tuple[int, int]] = [(y0, x0)]
            seen[y0, x0] = True
            stack.clear()
            stack.append((y0, x0))
            while stack:
                y, x = stack.pop()
                for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    ny, nx = y + dy, x + dx
                    if 0 <= ny < hw[0] and 0 <= nx < hw[1] and binary[ny, nx] and not seen[ny, nx]:
                        seen[ny, nx] = True
                        stack.append((ny, nx))
                        comp.append((ny, nx))
            if len(comp) >= min_area:
                for y, x in comp:
                    out[y, x] = 255
    return out


# ---------------------------------------------------------------------------
# Nucleo: mascaras por capa
# ---------------------------------------------------------------------------

def _band_mask(shape: tuple[int, int], band: list[float]) -> np.ndarray:
    """Mascara booleana de la banda vertical (fraccion de la altura)."""
    h = shape[0]
    y0 = int(round(band[0] * h))
    y1 = int(round(band[1] * h))
    m = np.zeros(shape, dtype=bool)
    m[y0:y1, :] = True
    return m


def chroma_mask(rgb: np.ndarray, cfg: dict) -> np.ndarray:
    """Alfa del SUJETO para un fondo plano de color (modo chroma).

    Distancia en el circulo cromatico al color clave, con rampa suave: lo que esta
    dentro de `color_tolerance` es fondo (0); lo que esta mas alla de
    `tolerance + softness` es sujeto (255); en el medio, rampa (borde limpio).
    """
    key = np.array(hex_to_rgb(cfg["chroma_color"]), dtype=np.float32) / 255.0
    arr = rgb.astype(np.float32) / 255.0
    # Distancia euclidea ponderada: da un borde mas organico que el matiz solo.
    diff = np.linalg.norm(arr - key, axis=-1) * 255.0
    tol = float(cfg["color_tolerance"])
    soft = max(1.0, float(cfg["chroma_softness"]))
    alpha = np.clip((diff - tol) / soft, 0.0, 1.0) * 255.0
    return alpha.astype(np.uint8)


def teal_masks(rgb: np.ndarray, cfg: dict) -> tuple[np.ndarray, np.ndarray]:
    """Devuelve (m_bg, m_subject) booleanos para la escena oscura teal.

    ESTRATEGIA: CONTRASTE LOCAL, NO UMBRALES ABSOLUTOS.

    La medicion del dataset lo deja claro: el fondo teal vive entre V 0.08 y 0.28
    (mediana 0.09-0.13) y el hongo tambien ronda V 0.19-0.25; en la linea poison
    ambos comparten incluso el MATIZ (H 0.49-0.59). Un umbral absoluto de V o H
    no los separa: o se come el hongo, o deja todo el fondo.

    Lo que SI los separa es el contraste contra un modelo del fondo: el fondo es
    una escena suave (gradiente + spotlight) que se puede estimar con un blur muy
    grande. El sujeto es lo que se DESVIA de esa estimacion (el hongo, el rim, el
    glow, las motas de luz). Se combinan tres senales:

      1. Desvio local de luminancia vs. el fondo difuso (contraste).
      2. Matiz fuera del rango teal (el hongo tiene matiz propio en varias lineas).
      3. Brillo fuerte (rim/glow, V alto) como senal directa.

    La banda vertical solo VETA (fuera de ella no hay sujeto); nunca acredita.
    """
    hsv = to_hsv(rgb)
    h, s, v = hsv[..., 0], hsv[..., 1], hsv[..., 2]
    hh_px, ww_px = rgb.shape[:2]

    # --- 1. Modelo de fondo por blur enorme (la escena suave sin el sujeto) ---
    radius = max(8.0, 0.06 * min(hh_px, ww_px))
    v_bg = np.asarray(
        Image.fromarray((v * 255).astype(np.uint8), "L").filter(ImageFilter.GaussianBlur(radius=radius)),
        dtype=np.float32,
    ) / 255.0
    contrast = v - v_bg  # >0 = mas brillante que su entorno

    hl, hh = cfg["teal_h_range"]
    in_teal_hue = (h >= hl) & (h <= hh)
    # El fondo es teal Y (oscuro o poco saturado). Con V 0.28 de techo cubre el
    # gradiente del dataset sin tocar el hongo iluminado.
    m_bg_flat = in_teal_hue & ((v <= cfg["v_bg_max"]) | (s <= cfg["s_bg_max"] * 0.5))

    # --- 2. Musgo: oscuro pero verdoso (matiz fuera del teal) ---
    ml, mh = cfg["moss_h_range"]
    m_moss = (h >= ml) & (h <= mh) & (v <= cfg["v_moss_max"])
    if cfg["moss_as"] == "bg":
        m_bg_flat |= m_moss

    # --- 3. Sujeto: contraste local, matiz no-teal, o brillo fuerte ---
    strong_contrast = contrast >= cfg["contrast_min"]
    off_hue = (~in_teal_hue) & (v >= cfg["v_off_hue_min"]) & (s >= cfg["s_off_hue_min"])
    bright = (v >= cfg["v_subject_min"]) | (s >= cfg["s_subject_min"])

    # El SPOTLIGHT es brillante pero SUAVE: su borde no tiene gradiente fuerte.
    # Un sujeto de verdad tiene contorno (gradiente alto). Se pide que ademas de
    # brillar, el pixel tenga borde, o que su contraste sea fuerte. Asi el cono de
    # luz (que se desvia del blur en una zona ancha y difusa) no entra como sujeto.
    grad = np.hypot(
        np.gradient(v, axis=1),
        np.gradient(v, axis=0),
    )
    edge = grad >= cfg["edge_min"]
    # Suavizado de la senal de borde para no depender de un pixel exacto.
    edge = np.asarray(
        Image.fromarray((np.clip(edge * 255, 0, 255)).astype(np.uint8), "L").filter(
            ImageFilter.MaxFilter(5)
        ),
        dtype=np.float32,
    ) > 0

    m_subject = strong_contrast | off_hue | (bright & edge)
    m_subject &= ~(m_bg_flat & ~strong_contrast)

    # La banda solo VETA: fuera de ella no hay sujeto (el top 18% y el pie 38%
    # tienen que quedar planos, y ahi el contraste es ruido de niebla).
    m_subject &= _band_mask((hh_px, ww_px), cfg["subject_band"])
    return m_bg_flat, m_subject


def build_alpha(rgb: np.ndarray, cfg: dict) -> np.ndarray:
    """Alfa del SUJETO (uint8) segun el modo, ya limpia (morfologia + feather)."""
    if cfg["mode"] == "chroma":
        alpha = chroma_mask(rgb, cfg)
    else:
        _, m_subject = teal_masks(rgb, cfg)
        alpha = (m_subject.astype(np.uint8)) * 255

    # Erosion previa: come el pixel de borde que mezcla sujeto+fondo (evita halo).
    shrink = int(cfg["shrink_px"])
    if shrink > 0:
        alpha = _erode(alpha, shrink * 2 + 1)
    # Dilatacion: re-expande tras limpiar, para no perder el contorno.
    grow = int(cfg["grow_px"])
    if grow > 0:
        alpha = _dilate(alpha, grow * 2 + 1)

    alpha = morph_open_close(alpha, int(cfg["morph_kernel"]))
    alpha = keep_largest_components(alpha, float(cfg["min_component_area"]))
    return alpha


def refine_alpha_grabcut(rgb: np.ndarray, alpha: np.ndarray, cfg: dict) -> np.ndarray:
    """Refinado opcional de bordes con cv2.grabCut (lento, pero fino)."""
    if not (HAVE_CV2 and cfg.get("use_grabcut")):
        return alpha
    ys, xs = np.where(alpha > 127)
    if len(xs) == 0:
        return alpha
    rect = (int(xs.min()), int(ys.min()), int(xs.max() - xs.min() + 1), int(ys.max() - ys.min() + 1))
    mask = np.full(rgb.shape[:2], cv2.GC_PR_BGD, np.uint8)
    mask[alpha > 127] = cv2.GC_PR_FGD
    mask[alpha <= 127] = cv2.GC_PR_BGD
    bgd, fgd = np.zeros((1, 65), np.float64), np.zeros((1, 65), np.float64)
    try:
        cv2.grabCut(rgb, mask, rect, bgd, fgd, 3, cv2.GC_INIT_WITH_MASK)
        out = np.where((mask == cv2.GC_FGD) | (mask == cv2.GC_PR_FGD), 255, 0).astype(np.uint8)
        return np.maximum(out, (alpha > 200).astype(np.uint8) * 255)
    except Exception:
        return alpha


def feather_alpha(alpha: np.ndarray, px: float) -> np.ndarray:
    """Suaviza el borde: la rampa de alfa es lo que evita el recorte 'a cuchillo'."""
    if px <= 0:
        return alpha
    blurred = np.asarray(
        Image.fromarray(alpha, "L").filter(ImageFilter.GaussianBlur(radius=px)),
        dtype=np.uint8,
    )
    return blurred


def iou(a: np.ndarray, b: np.ndarray) -> float:
    """IoU (intersection over union) de dos mascaras booleanas/8-bit."""
    ab, bb = a > 127, b > 127
    union = np.logical_or(ab, bb).sum()
    if union == 0:
        return 1.0
    return float(np.logical_and(ab, bb).sum()) / float(union)


# Cuanto del sujeto puede "comerse" el erode antes de que la banda deje de ser un
# borde y pase a ser el cuerpo entero. Con `max(0.25, ...)` el sujeto seguro nunca
# baja del 25% de la mascara: por debajo de eso, el matting decide sobre el cuerpo
# (que es exactamente lo que NO queremos) y el sujeto sale translucido.
TRIMAP_MIN_SAFE_FRAC = 0.25


def _shrink_until_safe(m_bool: np.ndarray, erode_px: int) -> tuple[np.ndarray, int]:
    """Erosiona la mascara por `erode_px` REDUCIENDO el radio si el sujeto seguro
    se encoge por debajo de `TRIMAP_MIN_SAFE_FRAC` de la mascara original.

    Por que: en arte de carta los brazos del sujeto miden ~15-25 px. Un erode de
    8 px sobre una estructura tan fina deja el "sujeto seguro" casi vacio y la
    banda incierta se traga el cuerpo; entonces pymatting resuelve el INTERIOR (y
    lo vuelve translucido). Con el clamp adaptativo la banda vuelve a ser lo que
    tiene que ser: un contorno de pocos pixeles.
    """
    m8 = (m_bool.astype(np.uint8)) * 255
    total = int(m_bool.sum())
    if total == 0 or erode_px <= 0:
        return m_bool, 0
    budget = max(1, int(total * TRIMAP_MIN_SAFE_FRAC))
    er = erode_px
    safe = _erode(m8, er * 2 + 1) > 127
    while er > 1 and int(safe.sum()) < budget:
        er -= 1
        safe = _erode(m8, er * 2 + 1) > 127
    return safe, er


def build_trimap(m_bool: np.ndarray, cfg: dict) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """(safe_fg, safe_bg, band) a partir de la mascara binaria del sujeto.

    Erode delimita el SUJETO SEGURO (interior, sin duda); dilate delimita el FONDO
    SEGURO (exterior). La BANDA entre ambos es la zona incierta: ahi, y solo ahi,
    corre el matting. Las tres son booleanas.

    El erode es ADAPTATIVO (`_shrink_until_safe`): en un sujeto fino el radio baja
    solo, para que la banda siga siendo un contorno y no el cuerpo entero. El
    dilate tambien se acota a un valor razonable: extender el borde hacia afuera
    solo sirve para capturar el halo/antialias del contorno.
    """
    m8 = (m_bool.astype(np.uint8)) * 255
    safe_fg, _ = _shrink_until_safe(m_bool, int(cfg["trimap_erode_px"]))
    # El dilate no necesita adaptarse (hacia afuera no colapsa nada), pero se acota
    # para que "banda incierta" no se vuelva una franja ancha que difumine el borde.
    di = min(int(cfg["trimap_dilate_px"]), int(cfg.get("trimap_dilate_max_px", 4)))
    dilated = _dilate(m8, di * 2 + 1) > 127 if di > 0 else m8 > 127
    safe_bg = ~dilated
    band = ~safe_fg & ~safe_bg
    return safe_fg, safe_bg, band


def matte_alpha(rgb: np.ndarray, alpha_bin: np.ndarray, cfg: dict) -> np.ndarray:
    """Alfa SUAVE en la banda incierta usando matting; binaria fuera de ella.

    Escalera de respaldo: pymatting (closed-form -> KNN) -> guided filter de
    cv2.ximgproc -> devuelve la binaria SIN TOCAR. Cada eslabon que falta es un
    no-op: con todos los backends ausentes, la salida es EXACTAMENTE la de antes.
    """
    backend = str(cfg.get("matting_backend", "none")).lower()
    if backend == "none":
        return alpha_bin

    m_bool = alpha_bin > 127
    safe_fg, safe_bg, band = build_trimap(m_bool, cfg)
    if not band.any():
        return alpha_bin  # nada incierto: la binaria ya es la respuesta

    h, w = alpha_bin.shape
    # Encuadre de la region a matting (bbox de la banda + margen), acotado por
    # `matting_max_side` para que la resolucion cueste en segundos, no en minutos.
    ys, xs = np.where(band)
    pad = max(int(cfg["trimap_erode_px"]), int(cfg["trimap_dilate_px"])) + 4
    y0 = max(0, int(ys.min()) - pad)
    y1 = min(h, int(ys.max()) + pad + 1)
    x0 = max(0, int(xs.min()) - pad)
    x1 = min(w, int(xs.max()) + pad + 1)

    sub_rgb = rgb[y0:y1, x0:x1].astype(np.float64) / 255.0
    trimap = np.full((y1 - y0, x1 - x0), 128, np.uint8)
    trimap[safe_bg[y0:y1, x0:x1]] = 0
    trimap[safe_fg[y0:y1, x0:x1]] = 255

    matted: np.ndarray | None = None

    if backend == "pymatting" and HAVE_PYMATTING:
        for fn in (estimate_alpha_cf, estimate_alpha_knn):
            if fn is None:
                continue
            try:
                matted = np.clip(fn(sub_rgb, trimap.astype(np.float64) / 255.0), 0.0, 1.0)
                matted = (matted * 255.0).astype(np.uint8)
                break
            except Exception as exc:  # una carta rara no debe tumbar el lote
                print(f"    (pymatting fallo: {exc}; se prueba otro backend)")
                matted = None

    if matted is None and backend in ("pymatting", "guided") and HAVE_XIMGPROC:
        try:
            # guided filter: guia = luminancia del recorte, entrada = trimap gris.
            guide = np.asarray(
                Image.fromarray(rgb[y0:y1, x0:x1], "RGB").convert("L"), dtype=np.float32
            )
            matted = cv2.ximgproc.guidedFilter(guide, trimap.astype(np.float32), 8, 1e-3)
            matted = np.clip(matted, 0, 255).astype(np.uint8)
        except Exception as exc:  # pragma: no cover
            print(f"    (guidedFilter fallo: {exc})")
            matted = None

    if matted is None:
        # Ningun backend disponible: NO degradamos la salida (misma binaria).
        return alpha_bin

    out = alpha_bin.copy()
    # Pegar SOLO el alpha suave de la banda; fuera queda 0/255 como siempre.
    band_sub = band[y0:y1, x0:x1]
    region = out[y0:y1, x0:x1]
    region[band_sub] = matted[band_sub]
    out[y0:y1, x0:x1] = region
    # Suavizado de la costura: SOLO dentro de la banda (ver `feather_band`).
    out = feather_band(out, band, 1.0)
    # INVARIANTE DURO (va ULTIMO, despues del feather): el SUJETO SEGURO (el
    # interior erosionado) queda a 255 SIEMPRE. Sobre el cuerpo de la ilustracion
    # el alfa no es una pregunta: es opaco. Si el solver se derrama hacia adentro
    # (pasa en estructuras finas) o el feather lo baja, esto lo corrige. Sin este
    # clamp el sujeto sale translucido y la carta se ve "lavada" — el bug real.
    out[safe_fg] = 255
    return out


def feather_band(alpha: np.ndarray, band: np.ndarray, px: float) -> np.ndarray:
    """Suaviza SOLO la banda incierta, dejando intacto el 0/255 de afuera.

    Un `feather_alpha` global sobre el resultado del matting volveria a mezclar
    el interior (ya forzado a 255) con el fondo, deshaciendo el invariante. Aca
    el blur se calcula igual pero se escribe SOLO donde `band` es True: el
    contorno queda suave y el cuerpo sigue opaco.
    """
    if px <= 0 or not band.any():
        return alpha
    blurred = np.asarray(
        Image.fromarray(alpha, "L").filter(ImageFilter.GaussianBlur(radius=px)),
        dtype=np.uint8,
    )
    out = alpha.copy()
    out[band] = blurred[band]
    return out


def matte_ml(rgb: np.ndarray, alpha_heur: np.ndarray, cfg: dict) -> np.ndarray | None:
    """Mascara de un modelo (rembg) VALIDADA por IoU contra la heuristica.

    Devuelve el alpha del modelo solo si se parece lo suficiente a la heuristica
    (>= `ml_iou_min`); si no, devuelve None y el llamador conserva la heuristica.
    Un backend ausente o un modelo que falla jamas es fatal.
    """
    backend = str(cfg.get("ml_backend", "none")).lower()
    if backend != "rembg" or not HAVE_REMBG or rembg_remove is None:
        return None
    try:
        out = rembg_remove(Image.fromarray(rgb, "RGB"))
        out = np.asarray(out.convert("RGBA"), dtype=np.uint8)
        ml_alpha = out[..., 3]
    except Exception as exc:
        print(f"    (rembg fallo: {exc}; se sigue con la heuristica)")
        return None

    score = iou(ml_alpha, alpha_heur)
    if score < float(cfg["ml_iou_min"]):
        print(f"    (rembg descartado: IoU {score:.2f} < {cfg['ml_iou_min']})")
        return None
    print(f"    (rembg aceptado: IoU {score:.2f})")
    return ml_alpha


def estimate_depth(rgb: np.ndarray, subject_alpha: np.ndarray, cfg: dict) -> dict:
    """Profundidad relativa por capa (0-1). Sin backend: `default_depth`."""
    default = dict(cfg.get("default_depth", {"bg": 0.15, "subject": 0.5, "fg": 0.85}))
    backend = str(cfg.get("depth_backend", "none")).lower()
    if backend != "depth_anything" or not HAVE_DEPTH:
        return default
    try:
        depth_pipe = hf_pipeline(task="depth-estimation", model="LiheYoung/depth-anything-small-hf")
        depth = np.asarray(depth_pipe(Image.fromarray(rgb, "RGB"))["depth"], dtype=np.float32)
        depth = (depth - depth.min()) / max(1e-6, (depth.max() - depth.min()))
        m = subject_alpha > 127
        if m.any():
            # El sujeto toma su profundidad MEDIA; bg/fg se separan a los lados.
            subj = float(np.median(depth[m]))
            return {"bg": round(max(0.0, subj - 0.35), 3), "subject": round(subj, 3), "fg": round(min(1.0, subj + 0.35), 3)}
    except Exception as exc:  # pragma: no cover
        print(f"    (depth-anything fallo: {exc}; se usa default_depth)")
    return default


def fill_bg_behind_subject(rgb: np.ndarray, subject_alpha: np.ndarray, cfg: dict, bg_alpha: np.ndarray) -> np.ndarray:
    """Rellena el fondo detras del sujeto para que no quede el 'hueco' del hongo.

    Se expande el hueco `inpaint_dilate_px` px para que NO queden restos del
    sujeto en el fondo. En modo `band` solo se rellenan unos pocos px mas alla del
    borde: los interiores de huecos grandes quedan difusos (eso mata las manchas
    del inpaint clasico) y alcanza para el parallax suave.
    """
    hole = (subject_alpha > 40).astype(np.uint8)
    if hole.sum() == 0:
        return rgb
    # Expansion: sin esto quedan restos del sujeto pegados al contorno.
    dil = int(cfg.get("inpaint_dilate_px", 0))
    if dil > 0:
        hole = _dilate(hole * 255, dil * 2 + 1)
        hole = (hole > 127).astype(np.uint8)

    # En modo `band` el inpaint solo cubre el anillo exterior; el interior se
    # resuelve con difusion (mas barato y sin manchas).
    if str(cfg.get("inpaint_mode", "full")).lower() == "band":
        inner = _erode(hole * 255, int(cfg.get("inpaint_band_px", 6)) * 2 + 1)
        inner = (inner > 127).astype(np.uint8)
        fill_mask = hole & ~inner
    else:
        fill_mask = hole

    if fill_mask.sum() == 0:
        return rgb

    filled: np.ndarray | None = None
    backend = str(cfg.get("inpaint_backend", "cv2")).lower()

    if backend == "lama" and HAVE_LAMA:
        try:
            lama = SimpleLama()
            res = lama(Image.fromarray(rgb, "RGB"), Image.fromarray((fill_mask * 255).astype(np.uint8), "L"))
            filled = np.asarray(res.convert("RGB"), dtype=np.uint8)
        except Exception as exc:  # pragma: no cover
            print(f"    (LaMa fallo: {exc}; se cae a cv2)")
            filled = None

    if filled is None and HAVE_CV2:
        try:
            # TELEA: propagacion de los vecinos. Sobre la BANDA (no el hueco entero)
            # no deja las manchas que aparecian al rellenar huecos grandes.
            filled = cv2.inpaint(rgb, fill_mask * 255, 5, cv2.INPAINT_TELEA)
        except Exception:
            filled = None

    if filled is None:
        # Fallback: difusion por blur, mezclando solo en la zona a rellenar.
        radius = max(2, int(cfg["bg_fill_diffuse"]))
        blurred = np.asarray(Image.fromarray(rgb, "RGB").filter(ImageFilter.GaussianBlur(radius=radius)))
        filled = np.where((fill_mask[..., None] > 0), blurred, rgb)

    # El interior del hueco (si lo hay) tambien necesita algo de relleno: un blur
    # suave alcanza porque queda tapado por el sujeto en la composicion.
    if str(cfg.get("inpaint_mode", "full")).lower() == "band":
        inner_only = (hole > 0) & (fill_mask == 0)
        if inner_only.any():
            radius = max(2, int(cfg["bg_fill_diffuse"]))
            blurred = np.asarray(Image.fromarray(rgb, "RGB").filter(ImageFilter.GaussianBlur(radius=radius)))
            filled = np.where(inner_only[..., None], blurred, filled)
    return filled



def halo_fg(rgb: np.ndarray, subject_alpha: np.ndarray, cfg: dict) -> tuple[np.ndarray, np.ndarray]:
    """Primer plano = HALO LUMINOSO sacado del PROPIO ARTE del sujeto.

    QUE ES
    ------
    Un rim-light: el borde brillante del hongo, separado del cuerpo y desplazado
    por delante en Z. Al inclinar la carta el halo se corre un par de px respecto
    del sujeto y la carta "flota" como una ilustracion por capas.

    POR QUE NO UN VIGNETTE OSCURO (el bug que esto reemplaza)
    --------------------------------------------------------
    La version anterior pintaba un degradado radial NEGRO sobre toda la carta:
    medido, bajaba la luminancia media de 38.3 a 33.2 (~13%) en
    `art_card_crystal_common`, y encima el 100% de las cartas compartian el MISMO
    cuadrado negro. Dos problemas a la vez: oscurecia y no aportaba nada del arte.

    POR QUE NO DEJA EL fg VACIO
    ---------------------------
    El parallax visible lo aporta CASI ENTERO el fg: el `bg` solo se separa 0.02
    del plano (0.1 px a distancia de camara tipica) mientras que el fg se separa
    0.3 (~4.5 px con tilt hero). Con el fg vacio el efecto desaparece.

    COMO SE EXTRAE (sin backend, siempre disponible)
    ------------------------------------------------
    1. Se toma el alfa del sujeto y se BUSCA SU BORDE (alfa en la banda de
       transicion): ahi esta el contorno del hongo.
    2. Se DILATA hacia afuera unos px y se resta el cuerpo: queda un ANILLO
       exterior al sujeto.
    3. Se toma el COLOR del propio arte en ese anillo y se lo ilumina: un halo
       claro que respeta la paleta de cada ilustracion.
    4. El RGB se sube a blanco en proporcion a `fg_halo_whiten` (el borde de
       cualquier objeto retroiluminado pierde saturacion).

    ⚠️ ES UN ACENTO. `fg_halo_max` topa el alfa (nunca opaco) para que el halo se
    lea como luz y no como una calcomania blanca. `fg_halo_gain` controla el
    brillo del RGB. Con `fg_mode: "none"` la capa queda VACIA y el render la
    oculta solo (respaldo duro).
    """
    h, w = rgb.shape[:2]
    if str(cfg.get("fg_mode", "halo")).lower() == "none":
        return np.zeros((h, w), np.uint8), rgb

    body = subject_alpha > 96
    if not body.any():
        return np.zeros((h, w), np.uint8), rgb

    # --- 1/2. ANILLO: dilatar el cuerpo y restarlo. El grosor lo fija
    # `fg_halo_width_px`, que es lo que se corre el halo al inclinar. ---
    width = max(1, int(cfg.get("fg_halo_width_px", 7)))
    grown = _dilate((body.astype(np.uint8)) * 255, width * 2 + 1) > 127
    # El interior del cuerpo tambien cuenta como "no anillo": sin esto el halo
    # se pintaria DEBAJO del hongo y no se veria.
    ring = grown & ~_dilate((body.astype(np.uint8)) * 255, max(1, width // 2) * 2 + 1).astype(bool)

    # ⚠️ ANILLOS PARASITOS. El `subject_alpha` a veces incluye un trozo del cono
    # de luz del fondo (un rectangulo suave arriba del hongo), y su anillo sale
    # como un marco flotante sin relacion con el sujeto. El halo REAL siempre
    # NACE del cuerpo: un anillo de un objeto lejano queda desconectado del
    # cuerpo y cae entero con un simple "abrir" por reconstruccion: se etiquetan
    # los componentes del anillo y se conservan solo los que TOCAN al cuerpo
    # (`ring` es la banda entre dilate(inner) y dilate(width): todo anillo real
    # toca la banda interior, que es la que pega con el cuerpo).
    # ⚠️ NO usar `dilate(body, 3)` como "contacto": esa banda ES la interior del
    # anillo, asi que la interseccion da VACIO y el halo desaparece por completo
    # (bug real de esta iteracion).
    ring_u8 = keep_largest_components((ring.astype(np.uint8)) * 255, float(cfg.get("fg_halo_min_area_frac", 0.0008)))
    ring = ring_u8 > 127

    # --- 3. Difuminar el anillo: una luz tiene caida, no un canto duro. ---
    ring_a = ring.astype(np.float32)
    blur_px = float(cfg.get("fg_halo_blur_px", 6.0))
    if blur_px > 0:
        ring_a = np.asarray(
            Image.fromarray((ring_a * 255).astype(np.uint8), "L").filter(
                ImageFilter.GaussianBlur(radius=blur_px)
            ),
            dtype=np.float32,
        ) / 255.0
    else:
        ring_a = ring_a * 1.0

    max_a = float(cfg.get("fg_halo_max", 0.55))
    alpha = np.clip(ring_a * max_a, 0.0, 1.0)

    # --- 4. COLOR del propio arte en el anillo, aclarado. Se difumina el RGB en
    # un radio GRANDE para tomar el tono de la zona (no el pixel crudo, que trae
    # ruido) y se mezcla hacia blanco. ---
    tint_r = float(cfg.get("fg_halo_tint_radius", 18.0))
    rgb_f = np.asarray(
        Image.fromarray(rgb, "RGB").filter(ImageFilter.GaussianBlur(radius=tint_r)),
        dtype=np.float32,
    )
    whiten = float(cfg.get("fg_halo_whiten", 0.45))
    lit = rgb_f + (255.0 - rgb_f) * whiten
    gain = float(cfg.get("fg_halo_gain", 1.35))
    lit = np.clip(lit * gain, 0.0, 255.0).astype(np.uint8)

    # `save_layer` va a usar `alpha` (L) como canal A y `lit` como RGB: la
    # combinacion es el halo brillante con caida suave.
    return (alpha * 255.0).astype(np.uint8), lit


# ---------------------------------------------------------------------------
# Composicion de capas
# ---------------------------------------------------------------------------

def bbox_of(alpha: np.ndarray, pad: int = 0) -> tuple[int, int, int, int] | None:
    ys, xs = np.where(alpha > 8)
    if len(xs) == 0:
        return None
    x0, x1 = max(0, int(xs.min()) - pad), int(xs.max()) + 1 + pad
    y0, y1 = max(0, int(ys.min()) - pad), int(ys.max()) + 1 + pad
    return x0, y0, x1 - x0, y1 - y0


def compose_layers(rgb: np.ndarray, cfg: dict) -> tuple[dict[str, Image.Image], dict, np.ndarray]:
    """Devuelve ({layer: PIL RGBA}, meta, alpha_final) listo para exportar.

    El tercer valor (el alpha ya matizado) es lo que usan las mascaras de debug:
    recalcular `build_alpha` aparte mostraria el borde binario VIEJO, no el suave.
    """
    h, w = rgb.shape[:2]
    alpha = build_alpha(rgb, cfg)
    # Mascara BINARIA de referencia: es el "cuerpo" del sujeto, y sirve para el
    # invariante de opacidad del final (el interior no puede quedar translucido).
    alpha_bin_ref = alpha.copy()

    # Respaldo ML (rembg): solo reemplaza la mascara si gana por IoU. Si el
    # backend esta apagado o ausente, `matte_ml` devuelve None y no pasa nada.
    ml = matte_ml(rgb, alpha, cfg) if str(cfg.get("ml_backend", "none")).lower() != "none" else None
    matting_done = False
    if ml is not None:
        alpha = ml
    else:
        # Matting SUAVE en la banda incierta (el borde duro del parallax). Con
        # todos los backends ausentes devuelve `alpha` sin tocar.
        before = alpha.copy()
        alpha = matte_alpha(rgb, alpha, cfg)
        matting_done = not np.array_equal(alpha, before)

    alpha = refine_alpha_grabcut(rgb, alpha, cfg)
    # FEATHER GLOBAL: solo cuando el matting NO corrio. Corriendolo, el borde
    # suave ya lo aporta el matting (band-restricted); sumarle un blur global NO
    # agrega calidad — al contrario, mete el borde dentro del cuerpo y el sujeto
    # sale translucido (la carta "lavada"). Es un fallback, no un paso fijo.
    if not matting_done:
        alpha = feather_alpha(alpha, float(cfg["feather_px"]))
    else:
        # INVARIANTE DURO: el interior del cuerpo queda 100% opaco. Se calcula
        # erosionando la binaria de referencia; el matting y el feather solo
        # pueden tocar la BANDA de contorno, nunca el interior.
        er = max(1, int(cfg["trimap_erode_px"]))
        interior = _erode((alpha_bin_ref > 127).astype(np.uint8) * 255, er * 2 + 1) > 127
        alpha[interior] = 255

    # --- SUJETO: recortado a su bbox (capa chica y centrada = parallax barato) ---
    sbbox = bbox_of(alpha, pad=int(cfg["feather_px"]) + 2)
    subject = Image.fromarray(rgb, "RGB").convert("RGBA")
    subject.putalpha(Image.fromarray(alpha, "L"))
    if sbbox:
        subject = subject.crop((sbbox[0], sbbox[1], sbbox[0] + sbbox[2], sbbox[1] + sbbox[3]))

    # --- FONDO: RGB rellenado detras del sujeto, alfa = lo que NO es sujeto ---
    bg_rgb = fill_bg_behind_subject(rgb, alpha, cfg, alpha)
    bg_alpha = np.clip(255.0 - alpha.astype(np.float32), 0.0, 255.0).astype(np.uint8)
    # Un fondo totalmente transparente (p.ej. arte que ya viene con alfa) sale del paso.
    if bg_alpha.max() > 8:
        bg = Image.fromarray(bg_rgb, "RGB").convert("RGBA")
        bg.putalpha(Image.fromarray(bg_alpha, "L"))
    else:
        bg = Image.new("RGBA", (w, h), (0, 0, 0, 0))

    # --- PRIMER PLANO: HALO LUMINOSO sacado del propio arte del sujeto. ---
    # ⚠️ Historial: antes esto era un vignette radial de RGB NEGRO que oscurecia
    # la carta ~13% y era IDENTICO en las 94 cartas. Ahora el fg es un anillo
    # brillante que toma el color real de cada ilustracion. Con `fg_mode: "none"`
    # el alfa sale todo 0 y `save_layer` lo escribe igual, pero el render lo
    # oculta (`ArtLayers.detectEmptyLayers`).
    if cfg["mode"] == "teal":
        fg_alpha, fg_rgb = halo_fg(rgb, alpha, cfg)
    else:
        # En chroma el arte YA trae su primer plano real: no se reconstruye nada.
        fg_alpha = np.zeros((h, w), np.uint8)
        fg_rgb = rgb
    fg = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    fg.paste(Image.fromarray(np.asarray(fg_rgb, dtype=np.uint8), "RGB"), (0, 0))
    fg.putalpha(Image.fromarray(fg_alpha, "L"))

    meta = {
        "size": [w, h],
        "subject": {"bbox": list(sbbox) if sbbox else [0, 0, w, h]},
        "coverage": {
            "subject_px": int((alpha > 127).sum()),
            "total_px": int(h * w),
        },
        # depth/motion los LEE el render (Card3D) para el parallax continuo y el
        # idle por capa. `genLayerIndex.mjs` los preserva: por eso el indice puede
        # regenerarse sin perderlos.
        "depth": estimate_depth(rgb, alpha, cfg),
        "motion": dict(cfg.get("default_motion", {})),
    }
    return {"bg": bg, "subject": subject, "fg": fg}, meta, alpha


# ---------------------------------------------------------------------------
# Export
# ---------------------------------------------------------------------------

def save_layer(img: Image.Image, stem: str, layer: str, cfg: dict) -> Path:
    fmt = cfg["out_format"].lower()
    ext = "webp" if fmt == "webp" else "png"
    path = OUT / f"{stem}__{layer}.{ext}"
    path.parent.mkdir(parents=True, exist_ok=True)
    if ext == "webp":
        img.save(path, "WEBP", quality=int(cfg["webp_quality"]), method=6)
    else:
        img.save(path, "PNG", optimize=True)
    return path


def save_debug_masks(stem: str, rgb: np.ndarray, alpha: np.ndarray, cfg: dict) -> None:
    MASK_OUT.mkdir(parents=True, exist_ok=True)
    Image.fromarray(alpha, "L").save(MASK_OUT / f"{stem}_mask_subject.png")
    Image.fromarray(np.clip(255 - alpha.astype(np.int32), 0, 255).astype(np.uint8), "L").save(
        MASK_OUT / f"{stem}_mask_bg.png"
    )
    # Overlay: sujeto en verde, para validar a ojo.
    overlay = rgb.copy()
    m = alpha > 127
    overlay[..., 0] = np.where(m, overlay[..., 0] // 3, overlay[..., 0])
    overlay[..., 1] = np.where(m, np.minimum(255, overlay[..., 1].astype(np.int32) + 90), overlay[..., 1])
    overlay[..., 2] = np.where(m, overlay[..., 2] // 3, overlay[..., 2])
    Image.fromarray(overlay.astype(np.uint8), "RGB").save(MASK_OUT / f"{stem}_overlay.png")
    # Trimap: blanco = sujeto seguro, negro = fondo seguro, gris = banda incierta
    # (donde corre el matting). Es la vista para calibrar `trimap_erode/dilate_px`.
    safe_fg, safe_bg, _ = build_trimap(alpha > 127, cfg)
    trimap = np.full(alpha.shape, 128, np.uint8)
    trimap[safe_bg] = 0
    trimap[safe_fg] = 255
    Image.fromarray(trimap, "L").save(MASK_OUT / f"{stem}_trimap.png")


def process(src: Path, cfg: dict, debug_masks: bool) -> dict:
    with Image.open(src) as im:
        rgb_img = im.convert("RGB")
        # Escala al tamano de carta para que las capas alineen full-bleed con el render.
        target = tuple(cfg["card_target"])
        if rgb_img.size != target:
            r = rgb_img.width / rgb_img.height
            tr = target[0] / target[1]
            if r > tr:
                nw = round(rgb_img.height * tr)
                left = (rgb_img.width - nw) // 2
                rgb_img = rgb_img.crop((left, 0, left + nw, rgb_img.height))
            elif r < tr:
                nh = round(rgb_img.width / tr)
                top = (rgb_img.height - nh) // 2
                rgb_img = rgb_img.crop((0, top, rgb_img.width, top + nh))
            rgb_img = rgb_img.resize(target, Image.LANCZOS)
        rgb = np.asarray(rgb_img, dtype=np.uint8)

    layers, meta, alpha = compose_layers(rgb, cfg)

    if debug_masks:
        save_debug_masks(src.stem, rgb, alpha, cfg)

    for name, img in layers.items():
        p = save_layer(img, src.stem, name, cfg)
        meta.setdefault("files", {})[name] = p.name

    return meta


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def load_config(path: Path, mode_override: str | None) -> dict:
    cfg = dict(DEFAULTS)
    if path.is_file():
        user = json.loads(path.read_text(encoding="utf8"))
        for k, v in user.items():
            if not k.startswith("_"):
                cfg[k] = v
    if mode_override:
        cfg["mode"] = mode_override
    cfg["skip_prefixes"] = tuple(cfg["skip_prefixes"])
    return cfg


def write_index(results: dict[str, dict]) -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    payload = {"version": 1, "layers": results}
    (OUT / "index.json").write_text(json.dumps(payload, indent=2) + "\n", encoding="utf8")


def make_contact_sheet(results: dict[str, dict]) -> None:
    """Hoja de revision en tools/shots/ (NO en public/: no tiene que viajar al celular)."""
    stems = sorted(results.keys())
    if not stems:
        return
    cell = 200
    cols = min(6, len(stems))
    rows = (len(stems) + cols - 1) // cols
    sheet = Image.new("RGB", (cols * cell, rows * (cell + 18)), (10, 14, 20))
    draw = ImageDraw.Draw(sheet)
    for i, stem in enumerate(stems):
        f = results[stem].get("files", {}).get("subject")
        if not f:
            continue
        with Image.open(OUT / f) as im:
            im = im.convert("RGB")
            im.thumbnail((cell, cell), Image.LANCZOS)
        x = (i % cols) * cell + (cell - im.width) // 2
        y = (i // cols) * (cell + 18) + (cell - im.height) // 2
        sheet.paste(im, (x, y))
        draw.text(((i % cols) * cell + 6, (i // cols) * (cell + 18) + cell + 2), stem[:28], fill=(200, 215, 230))
    path = ROOT / "tools" / "shots" / "layers-contact-sheet.jpg"
    path.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(path, "JPEG", quality=78)
    print(f"\nHoja de contacto: {path.relative_to(ROOT)}")


def main() -> int:
    ap = argparse.ArgumentParser(description="Segmenta el arte de las cartas en capas con alfa.")
    ap.add_argument("--only", default="*", help="glob sobre el stem (ej: art_card_own_*)")
    ap.add_argument("--mode", choices=["teal", "chroma"], default=None)
    ap.add_argument("--config", default=str(CONFIG_PATH))
    ap.add_argument("--debug-masks", action="store_true")
    args = ap.parse_args()

    cfg = load_config(Path(args.config), args.mode)

    if not SOURCE.is_dir():
        print(f"No existe {SOURCE.relative_to(ROOT)}/ con los PNG de origen.")
        return 1

    print(f"Motor: {'OpenCV' if HAVE_CV2 else 'NumPy'} | modo: {cfg['mode']}")
    print(
        "  backends: "
        f"matting={cfg['matting_backend']}({'ok' if HAVE_PYMATTING else 'no'}) "
        f"guided={'(ok)' if HAVE_XIMGPROC else '(no)'} "
        f"ml={cfg['ml_backend']}({'ok' if HAVE_REMBG else 'no'}) "
        f"inpaint={cfg['inpaint_backend']}({'ok' if HAVE_CV2 else 'no'}) "
        f"depth={cfg['depth_backend']}({'ok' if HAVE_DEPTH else 'no'})"
    )
    if not HAVE_CV2:
        print("  (cv2 no esta: sin grabCut/inpaint; el resto funciona igual)")
    if not HAVE_PYMATTING:
        print("  (pymatting no esta: el borde cae a la mascara binaria de siempre)")

    sources = sorted(
        p for p in SOURCE.glob("*.png")
        if fnmatch.fnmatch(p.stem, args.only)
        and not any(p.stem.startswith(pre) for pre in cfg["skip_prefixes"])
    )
    if not sources:
        print(f"No hay PNG para segmentar (patron {args.only}).")
        return 1

    results: dict[str, dict] = {}
    for src in sources:
        try:
            meta = process(src, cfg, args.debug_masks)
        except Exception as exc:  # una imagen rota no debe tumbar el lote
            print(f"  ! {src.name}: {exc}")
            continue
        results[src.stem] = meta
        cov = meta["coverage"]
        pct = 100.0 * cov["subject_px"] / max(1, cov["total_px"])
        dep = meta.get("depth", {})
        print(
            f"  {src.stem:<42} sujeto {pct:5.1f}%  bbox {meta['subject']['bbox']}  "
            f"depth bg/sub/fg {dep.get('bg')}/{dep.get('subject')}/{dep.get('fg')}"
        )

    if not results:
        print("Nada segmentado.")
        return 1

    write_index(results)
    print(f"\n{len(results)} cartas -> {(OUT).relative_to(ROOT)}/index.json")
    make_contact_sheet(results)
    if args.debug_masks:
        print(f"Mascaras/overlays: {MASK_OUT.relative_to(ROOT)}/")
    return 0


if __name__ == "__main__":
    sys.exit(main())
