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


def fill_bg_behind_subject(rgb: np.ndarray, subject_alpha: np.ndarray, cfg: dict, bg_alpha: np.ndarray) -> np.ndarray:
    """Rellena el fondo detras del sujeto para que no quede el 'hueco' del hongo.

    Con cv2 -> inpaint (propaga los pixeles vecinos). Sin cv2 -> blur de difusion
    fuerte sobre la zona del sujeto. Devuelve el RGB de fondo ya rellenado.
    """
    hole = (subject_alpha > 40).astype(np.uint8)
    if hole.sum() == 0:
        return rgb
    if HAVE_CV2:
        try:
            return cv2.inpaint(rgb, hole * 255, 5, cv2.INPAINT_TELEA)
        except Exception:
            pass
    # Fallback: difusion por blur, mezclando solo en el hueco.
    radius = max(2, int(cfg["bg_fill_diffuse"]))
    blurred = np.asarray(
        Image.fromarray(rgb, "RGB").filter(ImageFilter.GaussianBlur(radius=radius))
    )
    m = (hole[..., None] > 0)
    return np.where(m, blurred, rgb)


def vignette_fg(shape: tuple[int, int], cfg: dict) -> np.ndarray:
    """Primer plano por defecto en modo teal: vignette/marco oscuro.

    El dataset no trae elementos delante del hongo, asi que el `fg` se reconstruye:
    un degradado radial oscuro en los bordes que, en parallax, se lee como un marco
    que flota por delante. Devuelve alfa uint8.
    """
    h, w = shape
    yy, xx = np.mgrid[0:h, 0:w]
    cx, cy = w / 2.0, h / 2.0
    # Distancia normalizada: 0 en el centro de la banda, 1 en los bordes.
    d = np.sqrt(((xx - cx) / cx) ** 2 + ((yy - cy * 0.9) / cy) ** 2)
    alpha = np.clip((d - 0.75) / 0.45, 0.0, 1.0)
    return (alpha * 255).astype(np.uint8)


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


def compose_layers(rgb: np.ndarray, cfg: dict) -> tuple[dict[str, Image.Image], dict]:
    """Devuelve ({layer: PIL RGBA}, meta) listo para exportar."""
    h, w = rgb.shape[:2]
    alpha = build_alpha(rgb, cfg)
    alpha = refine_alpha_grabcut(rgb, alpha, cfg)
    alpha = feather_alpha(alpha, float(cfg["feather_px"]))

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

    # --- PRIMER PLANO: en teal va un vignette; en chroma va vacio (lo trae el arte) ---
    fg_alpha = vignette_fg((h, w), cfg) if cfg["mode"] == "teal" else np.zeros((h, w), np.uint8)
    fg = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    fg.putalpha(Image.fromarray(fg_alpha, "L"))

    meta = {
        "size": [w, h],
        "subject": {"bbox": list(sbbox) if sbbox else [0, 0, w, h]},
        "coverage": {
            "subject_px": int((alpha > 127).sum()),
            "total_px": int(h * w),
        },
    }
    return {"bg": bg, "subject": subject, "fg": fg}, meta


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

    layers, meta = compose_layers(rgb, cfg)

    if debug_masks:
        alpha = build_alpha(rgb, cfg)
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
    if not HAVE_CV2:
        print("  (cv2 no esta: sin grabCut/inpaint; el resto funciona igual)")

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
        print(f"  {src.stem:<42} sujeto {pct:5.1f}%  bbox {meta['subject']['bbox']}")

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
