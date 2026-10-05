/**
 * CardTexture.ts — Generacion procedural de las texturas de carta.
 *
 * Se dibujan en un canvas 2D y se suben como CanvasTexture. Motivo: el juego
 * tiene cientos de cartas y cero artistas. Una carta se ve distinta segun su
 * elemento, su rareza, su patron y su silueta — todo derivado del JSON.
 *
 * Cuando reemplacen esto por arte real (Fase 5), solo hay que cambiar
 * `createCardCanvas` por una carga de imagen. Nada mas del juego se toca.
 */

import * as THREE from 'three';
import type { ArtSpec, ElementType, FamilyType, Rarity, StatusType } from '@engine/index';
import {
  ABILITY_COLOR,
  ELEMENT_COLOR,
  RARITY_BORDER,
  RARITY_COLOR,
  STATUS_COLOR,
  hexToCss,
  hexToRgba,
  mixHex,
} from './palette';

const W = 512;
const H = 744;
const TAU = Math.PI * 2;

/**
 * Tipografia de las cartas.
 *
 * DOS familias, con dos trabajos distintos:
 *   - DISPLAY para el nombre y los rotulos: es lo que le da caracter a la carta
 *     y se lee de un vistazo a 30 px.
 *   - TEXTO para los chips y la descripcion: a 15-21 px hace falta legibilidad,
 *     no personalidad.
 *
 * El texto de una carta se HORNEA en un canvas, asi que la fuente tiene que
 * estar cargada ANTES de generar la textura: si no, la carta queda con la
 * fuente de respaldo para siempre. Por eso el arranque espera a
 * `document.fonts.ready` antes de crear el render.
 *
 * Los pesos son los REALES de cada archivo (Fredoka es 700, Gasoek es 400) y no
 * un 800 generico: el canvas 2D SI fabrica negritas sinteticas cuando el peso
 * pedido no existe, y sobre una fuente ya pesada eso se ve emborronado. En el
 * DOM lo mismo se resuelve con `font-synthesis: none` en el CSS.
 */
export const CARD_DISPLAY_FONT = "'Gasoek One', 'Fredoka SemiCondensed', system-ui, sans-serif";
export const CARD_TEXT_FONT = "'Fredoka SemiCondensed', 'Segoe UI', system-ui, sans-serif";

export interface CardTextureSpec {
  kind: 'card' | 'joker' | 'mutation' | 'voucher';
  name: string;
  desc: string;
  element: ElementType;
  family: FamilyType;
  rarity: Rarity;
  art: ArtSpec;
  /** Solo para cartas jugables. */
  substrate?: number;
  spores?: number;
  cost?: number;
  statuses?: StatusType[];
  level?: number;
  /**
   * La carta tiene HABILIDAD (P1.1/P1.2).
   *
   * `desc` es un solo campo para las dos cosas: el texto de sabor de una carta
   * comun y la descripcion de una habilidad. El plan pide que se distingan, y
   * el dato que las separa es justamente si la carta declara `effects`. El
   * render no puede leer el contenido (la spec es plana a proposito), asi que
   * el booleano lo resuelve quien arma la spec.
   *
   * Cuando es `true`, la descripcion lleva:
   *   - la etiqueta "✦ HABILIDAD" arriba del texto (no depende del color);
   *   - color lila-ambar propio en la etiqueta y el texto.
   */
  hasAbility?: boolean;
  /**
   * Ya traducidos. La spec no tiene acceso a `t()` (es una capa de dibujo), asi
   * que quien la arma —que si traduce— deja aca las etiquetas de la taxonomia.
   * La cabecera las pinta para que Familia y Elemento se lean en la CARA y no
   * solo al pasar el mouse: son los dos datos que mas se comparan entre cartas.
   * Sin esto la carta solo muestra el elemento en crudo ("SPORE").
   */
  elementLabel?: string;
  familyLabel?: string;
  /**
   * Cara COMPACTA (solo tactil).
   *
   * La carta en la mano mide ~112px de alto en pantalla, y la textura se
   * proyecta con escala ~0,15: un texto de 31px en la textura se ve a 4,7px, o
   * sea ilegible. Para llegar al minimo de 12-14px REALES hay que sacar
   * contenido, no escalarlo — la carta entera no entra a ese tamano.
   *
   * Compacta = nombre + los dos numeros, grandes. La descripcion y la habilidad
   * NO se pierden: se leen en el `.hud-tooltip`, que aparece al seleccionar la
   * carta (y en el mazo/coleccion/tienda, donde la carta se muestra grande).
   */
  compact?: boolean;
}

// ---------------------------------------------------------------------------
// Utilidades de canvas
// ---------------------------------------------------------------------------

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  ctx.lineTo(x + radius, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxLines: number,
): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    const candidate = current.length === 0 ? word : `${current} ${word}`;
    if (ctx.measureText(candidate).width <= maxWidth) {
      current = candidate;
    } else {
      if (current.length > 0) lines.push(current);
      current = word;
      if (lines.length === maxLines) break;
    }
  }
  if (lines.length < maxLines && current.length > 0) lines.push(current);

  if (lines.length === maxLines) {
    const lastIndex = maxLines - 1;
    let last = lines[lastIndex];
    if (last === undefined) return lines;
    // Truncado con elipsis si el texto no entro.
    if (words.join(' ').length > lines.join(' ').length + 1) {
      while (ctx.measureText(`${last}…`).width > maxWidth && last.length > 1) {
        last = last.slice(0, -1);
      }
      lines[lastIndex] = `${last}…`;
    }
  }
  return lines;
}

// ---------------------------------------------------------------------------
// Siluetas de hongo
// ---------------------------------------------------------------------------

interface SilhouetteCtx {
  ctx: CanvasRenderingContext2D;
  cx: number;
  cy: number;
  s: number;
  hue: number;
  hue2: number;
  glow: number;
}

function glowBlob({ ctx, cx, cy, s, hue, glow }: SilhouetteCtx): void {
  const g = ctx.createRadialGradient(cx, cy, s * 0.1, cx, cy, s * 1.9);
  g.addColorStop(0, `hsla(${hue}, 90%, 62%, ${0.5 * glow})`);
  g.addColorStop(0.5, `hsla(${hue}, 90%, 55%, ${0.18 * glow})`);
  g.addColorStop(1, 'hsla(0, 0%, 0%, 0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(cx, cy, s * 1.9, 0, TAU);
  ctx.fill();
}

function drawStem(ctx: CanvasRenderingContext2D, cx: number, cy: number, s: number, hue: number): void {
  const g = ctx.createLinearGradient(cx - s * 0.25, 0, cx + s * 0.25, 0);
  g.addColorStop(0, `hsl(${hue}, 12%, 62%)`);
  g.addColorStop(0.45, `hsl(${hue}, 16%, 82%)`);
  g.addColorStop(1, `hsl(${hue}, 12%, 54%)`);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(cx - s * 0.17, cy + s * 1.0);
  ctx.quadraticCurveTo(cx - s * 0.12, cy + s * 0.35, cx - s * 0.24, cy - s * 0.02);
  ctx.lineTo(cx + s * 0.24, cy - s * 0.02);
  ctx.quadraticCurveTo(cx + s * 0.12, cy + s * 0.35, cx + s * 0.17, cy + s * 1.0);
  ctx.closePath();
  ctx.fill();
}

function drawCapDome(ctx: CanvasRenderingContext2D, cx: number, cy: number, s: number, hue: number, hue2: number): void {
  const g = ctx.createLinearGradient(cx, cy - s * 1.1, cx, cy + s * 0.2);
  g.addColorStop(0, `hsl(${hue2}, 78%, 62%)`);
  g.addColorStop(0.55, `hsl(${hue}, 82%, 50%)`);
  g.addColorStop(1, `hsl(${hue}, 70%, 34%)`);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(cx - s * 1.05, cy - s * 0.04);
  ctx.bezierCurveTo(cx - s * 1.0, cy - s * 1.15, cx + s * 1.0, cy - s * 1.15, cx + s * 1.05, cy - s * 0.04);
  ctx.quadraticCurveTo(cx, cy + s * 0.24, cx - s * 1.05, cy - s * 0.04);
  ctx.closePath();
  ctx.fill();

  // Lamina inferior (gills)
  ctx.strokeStyle = `hsla(${hue}, 45%, 18%, 0.55)`;
  ctx.lineWidth = Math.max(1, s * 0.045);
  for (let i = -3; i <= 3; i++) {
    const t = i / 3.4;
    ctx.beginPath();
    ctx.moveTo(cx + t * s * 0.92, cy - s * 0.03);
    ctx.quadraticCurveTo(cx + t * s * 0.7, cy + s * 0.1, cx + t * s * 0.42, cy + s * 0.15);
    ctx.stroke();
  }
}

function drawSpots(ctx: CanvasRenderingContext2D, cx: number, cy: number, s: number, hue: number): void {
  ctx.fillStyle = `hsla(${hue}, 25%, 96%, 0.85)`;
  const spots: Array<[number, number, number]> = [
    [-0.5, -0.42, 0.14],
    [0.34, -0.58, 0.1],
    [-0.08, -0.72, 0.12],
    [0.62, -0.3, 0.08],
    [-0.72, -0.16, 0.07],
  ];
  for (const spot of spots) {
    const [dx, dy, r] = spot;
    ctx.beginPath();
    ctx.ellipse(cx + dx * s, cy + dy * s, r * s, r * s * 0.72, 0, 0, TAU);
    ctx.fill();
  }
}

function drawSilhouette(spec: CardTextureSpec, base: SilhouetteCtx): void {
  const { ctx, cx, cy, s, hue, hue2 } = base;
  glowBlob(base);

  switch (spec.art.silhouette ?? 'cap') {
    case 'cap': {
      drawStem(ctx, cx, cy, s, hue);
      drawCapDome(ctx, cx, cy, s, hue, hue2);
      if (spec.element === 'poison' || spec.element === 'spore') {
        drawSpots(ctx, cx, cy, s, hue);
      }
      break;
    }
    case 'cluster': {
      const offsets: Array<[number, number, number]> = [
        [-0.55, 0.28, 0.62],
        [0.52, 0.34, 0.55],
        [0.0, -0.1, 0.78],
      ];
      for (const [dx, dy, k] of offsets) {
        ctx.save();
        ctx.translate(cx + dx * s, cy + dy * s);
        drawStem(ctx, 0, 0, s * k, hue);
        drawCapDome(ctx, 0, 0, s * k, hue, hue2);
        ctx.restore();
      }
      break;
    }
    case 'bracket': {
      const g = ctx.createLinearGradient(cx - s, cy - s * 0.6, cx + s, cy + s * 0.6);
      g.addColorStop(0, `hsl(${hue2}, 65%, 58%)`);
      g.addColorStop(1, `hsl(${hue}, 60%, 30%)`);
      ctx.fillStyle = g;
      for (let i = 0; i < 3; i++) {
        const k = 1 - i * 0.24;
        const y = cy + i * s * 0.42 - s * 0.1;
        ctx.beginPath();
        ctx.moveTo(cx - s * 1.05 * k, y);
        ctx.quadraticCurveTo(cx - s * 0.2 * k, y - s * 0.72 * k, cx + s * 0.95 * k, y - s * 0.05 * k);
        ctx.quadraticCurveTo(cx - s * 0.1 * k, y + s * 0.42 * k, cx - s * 1.05 * k, y);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = `hsla(${hue}, 40%, 16%, 0.5)`;
        ctx.lineWidth = Math.max(1, s * 0.04);
        ctx.stroke();
      }
      break;
    }
    case 'coral': {
      ctx.strokeStyle = `hsl(${hue}, 82%, 62%)`;
      ctx.lineCap = 'round';
      const branch = (x: number, y: number, angle: number, len: number, depth: number): void => {
        if (depth <= 0 || len < s * 0.06) return;
        const nx = x + Math.cos(angle) * len;
        const ny = y + Math.sin(angle) * len;
        ctx.lineWidth = Math.max(1.5, len * 0.34);
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(nx, ny);
        ctx.stroke();
        branch(nx, ny, angle - 0.42 - Math.random() * 0.16, len * 0.68, depth - 1);
        branch(nx, ny, angle + 0.42 + Math.random() * 0.16, len * 0.68, depth - 1);
      };
      for (let i = 0; i < 3; i++) {
        const angle = -Math.PI / 2 + (i - 1) * 0.42;
        branch(cx + (i - 1) * s * 0.35, cy + s * 0.95, angle, s * 0.55, 4);
      }
      break;
    }
    case 'mold': {
      for (let i = 0; i < 26; i++) {
        const a = (i / 26) * TAU;
        const r = s * (0.35 + (i % 5) * 0.14);
        const x = cx + Math.cos(a) * r;
        const y = cy + Math.sin(a) * r * 0.8;
        const rad = s * (0.1 + (i % 3) * 0.05);
        const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
        g.addColorStop(0, `hsla(${hue}, 85%, 66%, 0.85)`);
        g.addColorStop(1, `hsla(${hue2}, 70%, 40%, 0.05)`);
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(x, y, rad, 0, TAU);
        ctx.fill();
      }
      break;
    }
    case 'truffle': {
      const g = ctx.createRadialGradient(cx - s * 0.3, cy - s * 0.3, s * 0.1, cx, cy, s * 1.1);
      g.addColorStop(0, `hsl(${hue2}, 55%, 52%)`);
      g.addColorStop(1, `hsl(${hue}, 48%, 22%)`);
      ctx.fillStyle = g;
      ctx.beginPath();
      for (let i = 0; i <= 48; i++) {
        const a = (i / 48) * TAU;
        const wobble = 1 + Math.sin(a * 5) * 0.09 + Math.cos(a * 3) * 0.06;
        const r = s * 1.0 * wobble;
        const x = cx + Math.cos(a) * r;
        const y = cy + Math.sin(a) * r * 0.86;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = `hsla(${hue}, 40%, 14%, 0.5)`;
      for (let i = 0; i < 30; i++) {
        const a = (i / 30) * TAU * 3.1;
        const r = s * (0.15 + (i % 7) * 0.11);
        ctx.beginPath();
        ctx.arc(cx + Math.cos(a) * r, cy + Math.sin(a) * r * 0.8, s * 0.035, 0, TAU);
        ctx.fill();
      }
      break;
    }
    default:
      break;
  }
}

function drawPattern(ctx: CanvasRenderingContext2D, spec: CardTextureSpec, x: number, y: number, w: number, h: number): void {
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  const hue = spec.art.hue;

  switch (spec.art.pattern) {
    case 'rings':
      ctx.strokeStyle = `hsla(${hue}, 70%, 70%, 0.12)`;
      ctx.lineWidth = 2;
      for (let i = 1; i < 16; i++) {
        ctx.beginPath();
        ctx.ellipse(x + w / 2, y + h / 2, (w / 2) * (i / 16), (h / 2) * (i / 16), 0, 0, TAU);
        ctx.stroke();
      }
      break;
    case 'fibrous':
      ctx.strokeStyle = `hsla(${hue}, 75%, 72%, 0.1)`;
      ctx.lineWidth = 1.5;
      for (let i = 0; i < 60; i++) {
        const px = x + Math.random() * w;
        const py = y + Math.random() * h;
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.quadraticCurveTo(px + 24, py + 40, px + Math.random() * 40 - 20, py + 110);
        ctx.stroke();
      }
      break;
    case 'blotch':
      for (let i = 0; i < 22; i++) {
        const px = x + Math.random() * w;
        const py = y + Math.random() * h;
        const r = 18 + Math.random() * 60;
        const g = ctx.createRadialGradient(px, py, 0, px, py, r);
        g.addColorStop(0, `hsla(${hue}, 80%, 66%, 0.16)`);
        g.addColorStop(1, 'hsla(0, 0%, 0%, 0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(px, py, r, 0, TAU);
        ctx.fill();
      }
      break;
    case 'crystal':
      ctx.strokeStyle = `hsla(${hue}, 90%, 78%, 0.18)`;
      ctx.lineWidth = 2;
      for (let i = 0; i < 14; i++) {
        const px = x + Math.random() * w;
        const py = y + Math.random() * h;
        const len = 40 + Math.random() * 90;
        const a = Math.random() * TAU;
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(px + Math.cos(a) * len, py + Math.sin(a) * len);
        ctx.lineTo(px + Math.cos(a + 0.5) * len * 0.7, py + Math.sin(a + 0.5) * len * 0.7);
        ctx.stroke();
      }
      break;
    case 'radial':
    default: {
      ctx.strokeStyle = `hsla(${hue}, 80%, 70%, 0.14)`;
      ctx.lineWidth = 1.5;
      const cx = x + w / 2;
      const cy = y + h / 2;
      for (let i = 0; i < 36; i++) {
        const a = (i / 36) * TAU;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + Math.cos(a) * w, cy + Math.sin(a) * h);
        ctx.stroke();
      }
      break;
    }
  }
  ctx.restore();
}

/** Como se asienta la ilustracion dentro de la carta. */
interface ArtLayout {
  /** Radio del clip. Tiene que coincidir con el marco de la carta en full-bleed. */
  radius: number;
  /** Hasta donde llega el fundido superior, como fraccion de la altura. */
  topFade: number;
  /** Donde arranca el fundido inferior, como fraccion de la altura. */
  bottomStart: number;
  /** Marco interno de la ventana de arte. Se omite en full-bleed. */
  innerFrame: boolean;
}

/**
 * Pega una ilustracion real dentro del area de arte.
 *
 * El trabajo fino esta en los degradados: sin ellos, la imagen se lee como un
 * rectangulo pegado encima de la carta. Con el fundido inferior hacia el color
 * del cuerpo y la vineta lateral, la ilustracion parece parte de la carta.
 *
 * Las fracciones de los degradados son parametros porque el AREA cambia: en
 * full-bleed el arte ocupa toda la carta (744 px) y los textos siguen en sus
 * posiciones absolutas, asi que el fundido tiene que ser mas corto o se come al
 * sujeto.
 */
function drawArtImage(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  x: number,
  y: number,
  w: number,
  h: number,
  spec: CardTextureSpec,
  layout: ArtLayout,
): void {
  const elementColor = ELEMENT_COLOR[spec.element];

  ctx.save();
  roundRect(ctx, x, y, w, h, layout.radius);
  ctx.clip();

  // Encaje tipo "cover": llena el area sin deformar la imagen.
  const scale = Math.max(w / img.naturalWidth, h / img.naturalHeight);
  const dw = img.naturalWidth * scale;
  const dh = img.naturalHeight * scale;
  ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);

  // Tinte del elemento: unifica las ilustraciones en una sola paleta.
  ctx.fillStyle = hexToRgba(elementColor, 0.14);
  ctx.fillRect(x, y, w, h);

  // Fundido inferior hacia el cuerpo de la carta.
  const bottom = ctx.createLinearGradient(0, y + h * layout.bottomStart, 0, y + h);
  bottom.addColorStop(0, 'rgba(13, 19, 27, 0)');
  bottom.addColorStop(1, 'rgba(13, 19, 27, 1)');
  ctx.fillStyle = bottom;
  ctx.fillRect(x, y + h * (layout.bottomStart - 0.05), w, h * (1 - layout.bottomStart + 0.05));

  // Fundido superior, para que el nombre respire.
  const top = ctx.createLinearGradient(0, y, 0, y + h * layout.topFade);
  top.addColorStop(0, 'rgba(13, 19, 27, 0.96)');
  top.addColorStop(1, 'rgba(13, 19, 27, 0)');
  ctx.fillStyle = top;
  ctx.fillRect(x, y, w, h * layout.topFade);

  // Vineta lateral.
  const side = ctx.createLinearGradient(x, 0, x + w, 0);
  side.addColorStop(0, 'rgba(10, 14, 20, 0.9)');
  side.addColorStop(0.16, 'rgba(10, 14, 20, 0)');
  side.addColorStop(0.84, 'rgba(10, 14, 20, 0)');
  side.addColorStop(1, 'rgba(10, 14, 20, 0.9)');
  ctx.fillStyle = side;
  ctx.fillRect(x, y, w, h);

  ctx.restore();

  // Marco interno de la ventana de arte. En full-bleed NO va: quedaria pegado
  // al borde, encima del marco de la carta.
  if (layout.innerFrame) {
    ctx.strokeStyle = hexToRgba(elementColor, 0.5);
    ctx.lineWidth = 2.5;
    roundRect(ctx, x, y, w, h, layout.radius);
    ctx.stroke();
  }
}

function drawChip(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  label: string,
  value: string,
  color: number,
  glyph?: string,
  scale = 1,
): void {
  // `scale > 1` = cara COMPACTA (tactil). Ver el bloque de abajo.
  const big = scale > 1;
  const radius = 12 * Math.min(scale, 2);
  const g = ctx.createLinearGradient(x, y, x, y + h);
  g.addColorStop(0, hexToRgba(color, big ? 0.42 : 0.28));
  g.addColorStop(1, hexToRgba(color, big ? 0.16 : 0.1));
  ctx.fillStyle = g;
  roundRect(ctx, x, y, w, h, radius);
  ctx.fill();
  ctx.strokeStyle = hexToRgba(color, big ? 0.9 : 0.7);
  ctx.lineWidth = 2.5 * Math.min(scale, 2);
  roundRect(ctx, x, y, w, h, radius);
  ctx.stroke();

  if (big) {
    // Cara compacta: SIN la palabra. "SUSTRATO" a un tamano legible no entra en
    // media carta, y el significado ya lo llevan el GLIFO (▲ sustrato, ✱
    // esporas), el COLOR y la POSICION fija —que es lo que se compara entre
    // cartas—. Lo que importa es el numero, asi que va grande.
    const text = `${glyph ?? ''} ${value}`.trim();
    const maxW = w - 24 * scale;
    let px = Math.round(56 * scale);
    while (px > 24) {
      ctx.font = `700 ${px}px ${CARD_TEXT_FONT}`;
      if (ctx.measureText(text).width <= maxW) break;
      px -= 2;
    }
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x + w / 2, y + h / 2 + 2);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    return;
  }

  // Zona FIJA del dato: el valor siempre a la DERECHA y la etiqueta siempre a
  // la izquierda, con un glifo propio delante. Asi comparar dos cartas es un
  // barrido vertical del mismo punto, no una relectura. El glifo es un simbolo
  // de texto (▲ sustrato, ✱ esporas), no un asset: se dibuja a cualquier
  // tamano sin perder nitidez y no depende de una fuente de iconos externa.
  const labelX = x + 14;
  if (glyph) {
    ctx.fillStyle = hexToCss(color);
    ctx.font = `700 20px ${CARD_TEXT_FONT}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(glyph, labelX, y + h / 2 + 1);
  }

  ctx.fillStyle = hexToRgba(color, 0.85);
  ctx.font = `700 15px ${CARD_TEXT_FONT}`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(label.toUpperCase(), labelX + (glyph ? 26 : 0), y + h / 2 + 1);

  ctx.fillStyle = '#ffffff';
  ctx.font = `700 38px ${CARD_TEXT_FONT}`;
  ctx.textAlign = 'right';
  ctx.fillText(value, x + w - 14, y + h / 2 + 2);
}

// ---------------------------------------------------------------------------
// Composicion de la carta
// ---------------------------------------------------------------------------

/**
 * Que se hornea en este canvas.
 *
 * `full` = la carta entera (fondo + arte + texto), que es el camino de siempre.
 * `top`  = SOLO el texto y el marco, sobre TRANSPARENTE: es la capa que flota
 *          por delante de la capa de arte y la que produce el parallax.
 */
export type CardLayer = 'full' | 'top';

export function createCardCanvas(
  spec: CardTextureSpec,
  art?: HTMLImageElement,
  layer: CardLayer = 'full',
): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;

  const elementColor = ELEMENT_COLOR[spec.element];
  const rarityColor = RARITY_COLOR[spec.rarity];
  const border = RARITY_BORDER[spec.rarity];
  const pad = border + 8;

  // El voucher es la unica pieza que no viene del pool: no es una carta que
  // juegues ni un joker que ocupa slot, es una REGLA. Se pinta con el acento
  // dorado para que no se confunda con una carta comun en la tienda.
  const accent = spec.kind === 'voucher' ? 0xffc857 : elementColor;

  /**
   * Cara compacta: nombre + numeros grandes, sin taxonomia ni descripcion.
   * Ver `CardTextureSpec.compact`.
   */
  const compact = spec.compact === true;

  // Fondo + tinte + arte: SOLO en la capa completa. En la de texto se omite
  // todo esto a proposito, para que quede transparente y deje ver la capa de
  // arte que va detras.
  if (layer === 'full') {
  // --- 1. Fondo con gradiente vertical ---
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#141b24');
  bg.addColorStop(0.5, '#0e141c');
  bg.addColorStop(1, '#080c12');
  ctx.fillStyle = bg;
  roundRect(ctx, 0, 0, W, H, 30);
  ctx.fill();

  // --- 2. Tinte del elemento arriba ---
  const tint = ctx.createLinearGradient(0, 0, 0, H * 0.55);
  tint.addColorStop(0, hexToRgba(elementColor, 0.3));
  tint.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = tint;
  roundRect(ctx, 0, 0, W, H, 30);
  ctx.fill();

  // --- 3. Area de arte: ilustracion real o silueta procedural ---
  //
  // FULL-BLEED. El arte del catalogo nuevo es 512x744, la MISMA relacion que el
  // canvas de la carta, asi que entra exacto y sin recorte. La ventana interior
  // de 1.4:1 que habia antes recortaria el 51% de la altura de un arte 2:3 y se
  // comeria al sujeto.
  //
  // El radio del clip tiene que coincidir con el del marco de la carta, y el
  // marco interno se omite (quedaria pegado al borde, encima del otro).
  const layout: ArtLayout = {
    radius: 30,
    topFade: 0.18,
    bottomStart: 0.62,
    innerFrame: false,
  };

  if (art && art.naturalWidth > 0) {
    drawArtImage(ctx, art, 0, 0, W, H, spec, layout);
  } else {
    // Respaldo sin assets: patron + silueta dibujada por codigo, en la misma
    // area que el arte real para que una carta sin imagen no cambie de forma.
    drawPattern(ctx, spec, 0, 0, W, H);
    drawSilhouette(spec, {
      ctx,
      cx: W / 2,
      cy: H * 0.4,
      s: spec.kind === 'card' ? 118 : 128,
      hue: spec.art.hue,
      hue2: spec.art.hue2 ?? spec.art.hue + 20,
      glow: spec.art.glow ?? 0.4,
    });
  }

  }

  // --- 4. Cabecera: taxonomia (Elemento · Familia) + nombre ---
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';

  // Linea de taxonomia: dos rotulos con su punto de color. El elemento ya venia
  // crudo ("SPORE"); ahora van los dos datos traducidos, separados por un punto
  // medio, para que Familia (lo que agrupa los combos) se vea sin abrir el
  // tooltip. Cada palabra lleva el color del elemento como ancla visual.
  // En la cara COMPACTA no hay taxonomia: el elemento ya lo dice el color del
  // marco y el tinte, y el espacio se necesita para que el nombre entre grande.
  if (!compact) {
    const elementLabel = (spec.elementLabel ?? (spec.kind === 'voucher' ? 'MEJORA' : spec.element)).toUpperCase();
    const familyLabel = (spec.familyLabel ?? '').toUpperCase();
    if (familyLabel && spec.kind === 'card') {
      const sep = ' · ';
      // La linea tiene que entrar en el ancho util: familias largas
      // ("TRICOLOMATACEAS") con elementos largos ("SIMBIOSIS") se salian del
      // marco. Se busca el tamano mas grande que entra, de 17px para abajo.
      const maxWidth = W - pad * 2 - 24;
      let fontPx = 17;
      while (fontPx > 11) {
        ctx.font = `400 ${fontPx}px ${CARD_DISPLAY_FONT}`;
        const width =
          ctx.measureText(elementLabel).width +
          ctx.measureText(sep).width +
          ctx.measureText(familyLabel).width;
        if (width <= maxWidth) break;
        fontPx -= 1;
      }
      const elementWidth = ctx.measureText(elementLabel).width;
      const sepWidth = ctx.measureText(sep).width;
      let cursor = W / 2 - (elementWidth + sepWidth + ctx.measureText(familyLabel).width) / 2;
      ctx.textAlign = 'left';
      ctx.fillStyle = hexToRgba(accent, 0.95);
      ctx.fillText(elementLabel, cursor, 30);
      cursor += elementWidth;
      ctx.fillStyle = hexToRgba(accent, 0.5);
      ctx.fillText(sep, cursor, 30);
      cursor += sepWidth;
      ctx.fillStyle = 'rgba(214, 226, 236, 0.85)';
      ctx.fillText(familyLabel, cursor, 30);
      ctx.textAlign = 'center';
    } else {
      ctx.fillStyle = hexToRgba(accent, 0.95);
      ctx.font = `400 17px ${CARD_DISPLAY_FONT}`;
      ctx.fillText(elementLabel, W / 2, 30);
    }
  }

  // --- Nombre ---
  // En la cara COMPACTA es EL dato principal: va mucho mas grande (84px de
  // textura ≈ 13px reales en pantalla) y con un velo oscuro detras para que
  // gane sobre la ilustracion. En la cara completa queda como siempre.
  if (compact) {
    const scrim = ctx.createLinearGradient(0, 0, 0, 300);
    scrim.addColorStop(0, 'rgba(4, 8, 13, 0.92)');
    scrim.addColorStop(0.62, 'rgba(4, 8, 13, 0.7)');
    scrim.addColorStop(1, 'rgba(4, 8, 13, 0)');
    ctx.fillStyle = scrim;
    ctx.fillRect(0, 0, W, 300);
  }
  ctx.fillStyle = '#f2f6fb';
  ctx.font = compact ? `700 92px ${CARD_DISPLAY_FONT}` : `400 31px ${CARD_DISPLAY_FONT}`;
  const nameLines = wrapText(ctx, spec.name, W - pad * 2 - 24, 2);
  const nameLineH = compact ? 100 : 36;
  const nameY = compact ? 66 : 56;
  nameLines.forEach((line, i) => ctx.fillText(line, W / 2, nameY + i * nameLineH));

  // --- 5. Pie: chips de stats + descripcion ---
  //
  // El pie es una PILA de tres filas que no se solapan:
  //     chips de stats -> descripcion -> statuses
  //
  // Cada posicion se DERIVA de la anterior a proposito. Antes eran tres
  // numeros sueltos (508, 600 y `H - 46` = 698) y la cuenta no cerraba: la
  // descripcion podia llegar a y=712 y los statuses se dibujaban en y=698, o
  // sea ENCIMA de la ultima linea. Con la pila, mover una fila mueve las de
  // abajo y el traslape no puede volver por descuido.
  // En la cara COMPACTA los chips son el SEGUNDO dato principal: ocupan el pie
  // entero y crecen. No hay panel de descripcion, asi que `descHeight` es 0 y
  // los statuses suben a pegarse a los chips.
  const chipsTop = compact ? 500 : 466;
  const chipsHeight = compact ? 168 : 72;
  const chipScale = compact ? 2.2 : 1;
  const descTop = chipsTop + chipsHeight + 14;
  const descHeight = compact ? 0 : 126;
  const statusTop = descTop + descHeight + 10;

  if (spec.kind === 'card') {
    const chipW = (W - pad * 2 - 18) / 2;
    drawChip(ctx, pad, chipsTop, chipW, chipsHeight, 'SUSTRATO', `+${spec.substrate ?? 0}`, 0xf2a63b, '▲', chipScale);
    drawChip(ctx, pad + chipW + 18, chipsTop, chipW, chipsHeight, 'ESPORAS', `x${spec.spores ?? 1}`, 0x4fd18b, '✱', chipScale);
  } else {
    // Jokers, mutaciones y vouchers: sin stats, solo un rotulo de tipo.
    const label =
      spec.kind === 'joker' ? 'JOKER' : spec.kind === 'voucher' ? 'MEJORA' : 'MUTACION';
    // En la cara compacta el rotulo de tipo tambien crece: es el UNICO dato que
    // lleva la carta (los jokers no tienen stats).
    const labelH = compact ? 96 : 52;
    const g = ctx.createLinearGradient(0, chipsTop, 0, chipsTop + labelH);
    g.addColorStop(0, hexToRgba(accent, 0.34));
    g.addColorStop(1, hexToRgba(accent, 0.12));
    ctx.fillStyle = g;
    roundRect(ctx, pad, chipsTop, W - pad * 2, labelH, 12);
    ctx.fill();
    ctx.strokeStyle = hexToRgba(accent, 0.75);
    ctx.lineWidth = 2.5;
    roundRect(ctx, pad, chipsTop, W - pad * 2, labelH, 12);
    ctx.stroke();
    ctx.fillStyle = hexToCss(accent);
    ctx.font = `400 ${compact ? 56 : 24}px ${CARD_DISPLAY_FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, W / 2, chipsTop + labelH / 2);
    ctx.textBaseline = 'top';
  }

  // Panel de la descripcion. A esta altura el fondo ya es casi solido (el
  // fundido inferior del arte arranca en `bottomStart` y llega a opaco en el
  // borde), asi que el panel no esta para dar contraste sino para AGRUPAR: sin
  // el, el texto queda flotando suelto y se lee como un pie de foto en vez de
  // como las reglas de la carta.
  //
  // P1.1/P1.2 — Si la carta tiene HABILIDAD, el panel cambia de color y suma
  // una etiqueta. Es la jerarquia que pide el plan:
  //   nombre             -> blanco
  //   Familia/Sustrato   -> ya lo dice el elemento de la cabecera
  //   puntuacion         -> dorado (los chips)
  //   HABILIDAD          -> lila + etiqueta "✦ HABILIDAD"
  // La etiqueta es lo importante para accesibilidad: el color solo refuerza.
  const hasAbility = spec.hasAbility === true;
  const abilityColor = ABILITY_COLOR;
  const panelBorder = hasAbility ? abilityColor : elementColor;

  // Cara COMPACTA: sin descripcion. El texto de reglas y la habilidad NO se
  // pierden — se leen en el `.hud-tooltip` al seleccionar la carta, y en el
  // mazo/coleccion/tienda donde la carta se muestra grande.
  if (!compact) {
  ctx.fillStyle = hasAbility ? 'rgba(26, 18, 42, 0.62)' : 'rgba(6, 10, 16, 0.55)';
  roundRect(ctx, pad, descTop, W - pad * 2, descHeight, 14);
  ctx.fill();
  ctx.strokeStyle = hexToRgba(panelBorder, hasAbility ? 0.8 : 0.38);
  ctx.lineWidth = hasAbility ? 3 : 2;
  roundRect(ctx, pad, descTop, W - pad * 2, descHeight, 14);
  ctx.stroke();

  // Etiqueta "✦ HABILIDAD": banda propia arriba del panel de texto. Va con
  // FORMA (el glifo ✦ y la banda), no solo color, para no depender del color.
  let abilityBodyTop = descTop;
  let abilityBodyHeight = descHeight;
  if (hasAbility) {
    const tagHeight = 34;
    ctx.fillStyle = hexToRgba(abilityColor, 0.3);
    roundRect(ctx, pad, descTop, W - pad * 2, tagHeight, 12);
    ctx.fill();
    ctx.fillStyle = hexToCss(abilityColor);
    ctx.font = `400 19px ${CARD_DISPLAY_FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('✦ HABILIDAD', W / 2, descTop + tagHeight / 2 + 1);
    ctx.textBaseline = 'top';
    abilityBodyTop = descTop + tagHeight + 4;
    abilityBodyHeight = descHeight - tagHeight - 4;
  }

  // `drawChip` deja `textAlign` en 'right' y NUNCA lo restaura. La descripcion
  // se dibujaba con `fillText(line, W / 2, ...)`, asi que con `right` cada
  // linea quedaba pegada al centro por su borde DERECHO: el texto ocupaba solo
  // la mitad izquierda de la carta y se veia apretado contra el medio. Ese era
  // el "mal distribuida". Hay que reponer el centrado antes de dibujar.
  ctx.textAlign = 'center';
  ctx.fillStyle = hasAbility ? hexToCss(abilityColor) : 'rgba(233, 241, 249, 0.97)';
  ctx.font = `700 25px ${CARD_TEXT_FONT}`;
  const descLines = wrapText(ctx, spec.desc, W - pad * 2 - 34, hasAbility ? 2 : 3);
  // El bloque se centra VERTICALMENTE en el panel: una descripcion de una sola
  // linea queda al medio en vez de pegada al borde de arriba.
  const descLineHeight = 32;
  const descBlockHeight = descLines.length * descLineHeight;
  const descFirstLineY =
    abilityBodyTop + abilityBodyHeight / 2 - descBlockHeight / 2 + descLineHeight / 2;
  ctx.textBaseline = 'middle';
  descLines.forEach((line, i) => ctx.fillText(line, W / 2, descFirstLineY + i * descLineHeight));
  ctx.textBaseline = 'top';
  }
  ctx.textBaseline = 'top';

  // --- 7. Gema de rareza (esquina superior derecha) ---
  ctx.save();
  ctx.translate(W - 44, 44);
  ctx.rotate(Math.PI / 4);
  ctx.fillStyle = hexToCss(rarityColor);
  ctx.shadowColor = hexToCss(rarityColor);
  ctx.shadowBlur = 18;
  ctx.fillRect(-13, -13, 26, 26);
  ctx.restore();

  // --- 7b. Marca de HABILIDAD (solo cara compacta) ---
  // En la cara completa la habilidad se anuncia con la etiqueta "✦ HABILIDAD"
  // dentro del panel de texto. En la compacta no hay panel, asi que la marca va
  // suelta: es la senal de que esa carta tiene reglas que conviene leer en el
  // tooltip.
  if (compact && spec.hasAbility) {
    ctx.fillStyle = hexToCss(ABILITY_COLOR);
    ctx.font = `700 46px ${CARD_TEXT_FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('✦', W - 100, 46);
    ctx.textBaseline = 'top';
    ctx.textAlign = 'center';
  }

  // --- 8. Nivel (esquina superior izquierda) ---
  if ((spec.level ?? 1) > 1) {
    ctx.fillStyle = '#0b0f15';
    roundRect(ctx, 22, 22, 52, 40, 10);
    ctx.fill();
    ctx.strokeStyle = hexToCss(rarityColor);
    ctx.lineWidth = 2.5;
    roundRect(ctx, 22, 22, 52, 40, 10);
    ctx.stroke();
    ctx.fillStyle = hexToCss(rarityColor);
    ctx.font = `700 22px ${CARD_TEXT_FONT}`;
    ctx.textBaseline = 'middle';
    ctx.fillText(`+${spec.level ?? 1}`, 48, 43);
    ctx.textBaseline = 'top';
  }

  // --- 9. Statuses activos ---
  // Cierran la pila del pie: `statusTop` los deja DEBAJO del panel de la
  // descripcion. Antes iban en `H - 46` (y=698), que caia dentro del area de
  // la descripcion: los chips de estado tapaban la ultima linea del texto.
  const statuses = spec.statuses ?? [];
  statuses.slice(0, 4).forEach((status, i) => {
    const color = STATUS_COLOR[status];
    const x = pad + i * 62;
    const y = statusTop;
    ctx.fillStyle = hexToRgba(color, 0.22);
    roundRect(ctx, x, y, 54, 30, 8);
    ctx.fill();
    ctx.strokeStyle = hexToRgba(color, 0.85);
    ctx.lineWidth = 2;
    roundRect(ctx, x, y, 54, 30, 8);
    ctx.stroke();
    ctx.fillStyle = hexToCss(color);
    ctx.font = `700 15px ${CARD_TEXT_FONT}`;
    ctx.textBaseline = 'middle';
    ctx.fillText(status.slice(0, 4).toUpperCase(), x + 27, y + 16);
    ctx.textBaseline = 'top';
  });

  // --- 10. Marco exterior ---
  const frameGradient = ctx.createLinearGradient(0, 0, W, H);
  frameGradient.addColorStop(0, hexToCss(mixHex(rarityColor, elementColor, 0.5)));
  frameGradient.addColorStop(1, hexToCss(elementColor));
  ctx.strokeStyle = frameGradient;
  ctx.lineWidth = border;
  ctx.shadowColor = hexToCss(elementColor);
  ctx.shadowBlur = 26;
  roundRect(ctx, border / 2, border / 2, W - border, H - border, 30);
  ctx.stroke();
  ctx.shadowBlur = 0;

  // Linea interior fina: da sensacion de carta impresa.
  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.lineWidth = 1.5;
  roundRect(ctx, pad, pad, W - pad * 2, H - pad * 2, 22);
  ctx.stroke();

  return canvas;
}

/**
 * Capa de ARTE: fondo + tinte + ilustracion, y nada mas.
 *
 * Es la mitad "visual" de la carta. Se cachea por ARCHIVO DE ARTE y no por
 * carta, porque el arte se indexa por (elemento x rareza): 35 cartas comparten
 * ~40 ilustraciones, asi que guardarlo por carta seria pagar 35 texturas para
 * tener 40. Es la pieza que hace que el parallax no cueste el triple.
 */
export function createCardArtCanvas(
  spec: CardTextureSpec,
  art?: HTMLImageElement,
): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;

  const elementColor = ELEMENT_COLOR[spec.element];

  // Mismo fondo y mismo tinte que la capa completa: la capa de texto se apoya
  // encima, asi que el color de base tiene que ser identico.
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#141b24');
  bg.addColorStop(0.5, '#0e141c');
  bg.addColorStop(1, '#080c12');
  ctx.fillStyle = bg;
  roundRect(ctx, 0, 0, W, H, 30);
  ctx.fill();

  const tint = ctx.createLinearGradient(0, 0, 0, H * 0.55);
  tint.addColorStop(0, hexToRgba(elementColor, 0.3));
  tint.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = tint;
  roundRect(ctx, 0, 0, W, H, 30);
  ctx.fill();

  const layout: ArtLayout = { radius: 30, topFade: 0.18, bottomStart: 0.62, innerFrame: false };
  if (art && art.naturalWidth > 0) {
    drawArtImage(ctx, art, 0, 0, W, H, spec, layout);
  } else {
    drawPattern(ctx, spec, 0, 0, W, H);
    drawSilhouette(spec, {
      ctx,
      cx: W / 2,
      cy: H * 0.4,
      s: spec.kind === 'card' ? 118 : 128,
      hue: spec.art.hue,
      hue2: spec.art.hue2 ?? spec.art.hue + 20,
      glow: spec.art.glow ?? 0.4,
    });
  }

  return canvas;
}

// ---------------------------------------------------------------------------
// Cache de texturas
// ---------------------------------------------------------------------------

export class CardTextureCache {
  private readonly cache = new Map<string, THREE.CanvasTexture>();
  /** Capa de arte: COMPARTIDA por archivo de arte. */
  private readonly artCache = new Map<string, THREE.CanvasTexture>();
  /** Capa de texto: por estado de carta (lleva el nombre y la descripcion). */
  private readonly topCache = new Map<string, THREE.CanvasTexture>();

  get(key: string, spec: CardTextureSpec, art?: HTMLImageElement): THREE.CanvasTexture {
    const cached = this.cache.get(key);
    if (cached) return cached;

    const texture = new THREE.CanvasTexture(createCardCanvas(spec, art));
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 8;
    texture.needsUpdate = true;
    this.cache.set(key, texture);
    return texture;
  }

  /**
   * Capa de ARTE, indexada por ARCHIVO de arte.
   *
   * El arte se indexa por (elemento x rareza), no por carta: 35 cartas
   * comparten ~40 ilustraciones. Guardarlo por carta seria pagar 35 texturas
   * para tener 40, y es justo lo que haria que el parallax costara el triple.
   */
  getArt(artKey: string, spec: CardTextureSpec, art?: HTMLImageElement): THREE.CanvasTexture {
    const cached = this.artCache.get(artKey);
    if (cached) return cached;

    const texture = new THREE.CanvasTexture(createCardArtCanvas(spec, art));
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 8;
    texture.needsUpdate = true;
    this.artCache.set(artKey, texture);
    return texture;
  }

  /** Capa de TEXTO: fondo y arte transparentes, para flotar sobre el arte. */
  getTop(key: string, spec: CardTextureSpec): THREE.CanvasTexture {
    const cached = this.topCache.get(key);
    if (cached) return cached;

    const texture = new THREE.CanvasTexture(createCardCanvas(spec, undefined, 'top'));
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 8;
    texture.needsUpdate = true;
    this.topCache.set(key, texture);
    return texture;
  }

  /**
   * Al cambiar de idioma hay que redibujar: el texto esta dentro de la textura.
   * La capa de ARTE no se toca: no lleva texto.
   */
  clear(): void {
    for (const texture of this.cache.values()) texture.dispose();
    this.cache.clear();
    for (const texture of this.topCache.values()) texture.dispose();
    this.topCache.clear();
  }

  /**
   * Total de texturas vivas. Cuenta las TRES capas: si solo contara `cache`
   * reportaria 0, porque el camino normal ya no usa la textura completa.
   */
  get size(): number {
    return this.cache.size + this.topCache.size + this.artCache.size;
  }

  /** Cuantas capas de arte vivas hay (para el panel de debug). */
  get artCount(): number {
    return this.artCache.size;
  }
}

/**
 * Sombra de contacto de una carta.
 *
 * Es un cuadrado con un degradado radial de ALPHA (el color lo pone el
 * material, que es negro): al escalarlo con la proporcion de la carta queda una
 * sombra eliptica. Se usa una sola textura para todas las sombras del juego.
 *
 * Por que una sombra pintada y no un shadow map: las cartas estan acostadas y
 * coplanares con la mesa, asi que una luz desde arriba produce una sombra nula
 * a cambio de un pase de profundidad completo y muestreo en cada fragmento
 * iluminado. Esto cuesta un draw call para TODAS las cartas.
 */
/**
 * Normal map PROCEDURAL a partir de la ilustracion.
 *
 * La carta es plana, pero la ilustracion no tiene por que serlo: sacando el
 * gradiente de luminancia (Sobel) y metiendolo como normal en espacio tangente,
 * el arte empieza a responder a la luz de la escena y al halo. El hongo se lee
 * esculpido sin agregar un solo triangulo ni un asset nuevo.
 *
 * Se hace a 256 px de ancho: un normal map no necesita la resolucion del arte
 * (es un gradiente, no una imagen) y asi pesa ~1/6.
 *
 * `width` es ajustable porque el PISO de la arena es una superficie mucho mas
 * grande que una carta: a 256 px el relieve de las grietas salia como manchas
 * de 5 cm. La arena pide 512.
 */
export function createNormalMapCanvas(
  source: HTMLImageElement,
  strength = 1.7,
  width = 256,
): HTMLCanvasElement {
  const w = width;
  const h = Math.max(1, Math.round((w * source.naturalHeight) / Math.max(1, source.naturalWidth)));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;

  ctx.drawImage(source, 0, 0, w, h);
  const src = ctx.getImageData(0, 0, w, h).data;

  const lum = new Float32Array(w * h);
  for (let i = 0; i < w * h; i += 1) {
    const o = i * 4;
    lum[i] = ((src[o] ?? 0) * 0.299 + (src[o + 1] ?? 0) * 0.587 + (src[o + 2] ?? 0) * 0.114) / 255;
  }

  const at = (x: number, y: number): number => {
    const cx = x < 0 ? 0 : x >= w ? w - 1 : x;
    const cy = y < 0 ? 0 : y >= h ? h - 1 : y;
    return lum[cy * w + cx] ?? 0;
  };

  const out = ctx.createImageData(w, h);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
      // En el canvas la V crece hacia ABAJO; el normal map de three espera el
      // verde hacia arriba, de ahi el signo.
      const dy = (at(x, y - 1) - at(x, y + 1)) * strength;
      const len = Math.hypot(dx, dy, 1);
      const i = (y * w + x) * 4;
      out.data[i] = ((-dx / len) * 0.5 + 0.5) * 255;
      out.data[i + 1] = ((-dy / len) * 0.5 + 0.5) * 255;
      out.data[i + 2] = (1 / len) * 0.5 * 255 + 127.5;
      out.data[i + 3] = 255;
    }
  }
  ctx.putImageData(out, 0, 0);
  return canvas;
}

/**
 * Cache de normal maps COMPARTIDA por archivo de arte.
 *
 * El arte se indexa por (elemento x rareza) y no por carta, asi que 35 cartas
 * comparten ~40 ilustraciones: generar uno por CARTA seria pagar 35 texturas
 * para tener 40. Va aparte de `CardTextureCache` a proposito: ese cache se
 * vacia al cambiar de idioma y el normal map NO depende del idioma.
 */
const normalMaps = new Map<string, THREE.CanvasTexture>();

export function normalMapFor(art: HTMLImageElement | undefined): THREE.CanvasTexture | null {
  if (!art || art.naturalWidth === 0) return null;
  const key = art.src;
  const hit = normalMaps.get(key);
  if (hit) return hit;
  const texture = new THREE.CanvasTexture(createNormalMapCanvas(art));
  // Un normal map NO es color: si se le aplica sRGB la iluminacion sale mal.
  texture.colorSpace = THREE.NoColorSpace;
  texture.anisotropy = 4;
  normalMaps.set(key, texture);
  return texture;
}

/**
 * MAPA DE ALTURA para el relieve geometrico.
 *
 * Es la luminancia del arte en escala de grises, que es lo que three lee como
 * desplazamiento (canal R). No hace falta una mascara de las bandas de texto:
 * el propio arte ya trae los degradados superior e inferior, asi que ahi la
 * luminancia es ~0,07 y el desplazamiento queda casi nulo — el texto no se
 * ondula.
 */
export function createHeightCanvas(source: HTMLImageElement): HTMLCanvasElement {
  const w = 256;
  const h = Math.max(1, Math.round((w * source.naturalHeight) / Math.max(1, source.naturalWidth)));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;

  ctx.drawImage(source, 0, 0, w, h);
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < w * h; i += 1) {
    const o = i * 4;
    const lum = (d[o] ?? 0) * 0.299 + (d[o + 1] ?? 0) * 0.587 + (d[o + 2] ?? 0) * 0.114;
    d[o] = lum;
    d[o + 1] = lum;
    d[o + 2] = lum;
    d[o + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

const heightMaps = new Map<string, THREE.CanvasTexture>();

/** Cache compartida por archivo de arte (mismo criterio que el normal map). */
export function heightMapFor(art: HTMLImageElement | undefined): THREE.CanvasTexture | null {
  if (!art || art.naturalWidth === 0) return null;
  const key = art.src;
  const hit = heightMaps.get(key);
  if (hit) return hit;
  const texture = new THREE.CanvasTexture(createHeightCanvas(art));
  // Es un dato, no un color.
  texture.colorSpace = THREE.NoColorSpace;
  texture.anisotropy = 2;
  heightMaps.set(key, texture);
  return texture;
}

export function createShadowCanvas(size = 256): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;

  // DOS anillos, no uno. El primero es la sombra de CONTACTO (corta y oscura:
  // es la que "pega" la carta al tapete). El segundo es la de AMBIENTE: mucho
  // mas ancha y casi transparente, y es la que evita que la carta parezca un
  // sticker recortado. Se dibuja debajo, asi que el centro sigue siendo el mas
  // oscuro y la caida se lee como una sola sombra.
  //
  // Cuesta lo mismo que antes: es canvas 2D, una sola vez, al construir la
  // escena. No agrega ni un draw call ni una textura.
  const ambient = ctx.createRadialGradient(
    size / 2,
    size / 2,
    size * 0.1,
    size / 2,
    size / 2,
    size * 0.5,
  );
  ambient.addColorStop(0, 'rgba(0, 0, 0, 0.16)');
  ambient.addColorStop(0.45, 'rgba(0, 0, 0, 0.09)');
  ambient.addColorStop(0.8, 'rgba(0, 0, 0, 0.03)');
  ambient.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = ambient;
  ctx.fillRect(0, 0, size, size);

  const gradient = ctx.createRadialGradient(
    size / 2,
    size / 2,
    size * 0.06,
    size / 2,
    size / 2,
    size * 0.5,
  );
  gradient.addColorStop(0, 'rgba(0, 0, 0, 0.5)');
  gradient.addColorStop(0.5, 'rgba(0, 0, 0, 0.38)');
  gradient.addColorStop(0.78, 'rgba(0, 0, 0, 0.13)');
  gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = gradient;
  // El segundo anillo se suma al primero porque el canvas 2D compone con
  // source-over: en el centro quedan los dos y la sombra se refuerza.
  ctx.fillRect(0, 0, size, size);

  return canvas;
}

/**
 * Mapa de normales procedural para el tapete (E1).
 *
 * Es un campo de altura de ruido de valor sobre una rejilla de `cells`, del que
 * se deriva la normal por diferencias centrales. La rejilla es PERIODICA: el
 * material del tapete repite la textura 6x6, y una rejilla que no cerrara
 * dejaria una costura visible en cada baldosa.
 *
 * El relieve es deliberadamente sutil: no se busca que se vea arrugado, sino
 * que la luz rasante de la escena tenga algo que recorrer. Con pendientes
 * fuertes el tapete se lee como papel aluminio.
 */
export function createTableNormalCanvas(size = 256, cells = 32): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;

  const lattice = new Float32Array(cells * cells);
  for (let i = 0; i < lattice.length; i++) lattice[i] = Math.random();

  const at = (cx: number, cy: number): number =>
    lattice[(((cy % cells) + cells) % cells) * cells + (((cx % cells) + cells) % cells)] ?? 0;

  /** Suavizado cubico: sin el, la rejilla se ve como escalones. */
  const smooth = (t: number): number => t * t * (3 - 2 * t);

  const sample = (x: number, y: number): number => {
    const fx = (x / size) * cells;
    const fy = (y / size) * cells;
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    const tx = smooth(fx - x0);
    const ty = smooth(fy - y0);
    const top = at(x0, y0) * (1 - tx) + at(x0 + 1, y0) * tx;
    const bottom = at(x0, y0 + 1) * (1 - tx) + at(x0 + 1, y0 + 1) * tx;
    return top * (1 - ty) + bottom * ty;
  };

  const image = ctx.createImageData(size, size);
  const data = image.data;
  // Escala de la pendiente. 2.2 con una rejilla de 32 da un relieve que se
  // ve de cerca y desaparece a distancia, que es lo que hace un tapete real.
  const strength = 2.2;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = sample(x + 1, y) - sample(x - 1, y);
      const dy = sample(x, y + 1) - sample(x, y - 1);
      // Normal en espacio de tangente: (-dh/dx, -dh/dy, 1) normalizada.
      const nx = -dx * strength;
      const ny = -dy * strength;
      const len = Math.sqrt(nx * nx + ny * ny + 1) || 1;

      const i = (y * size + x) * 4;
      data[i] = Math.round((nx / len * 0.5 + 0.5) * 255);
      data[i + 1] = Math.round((ny / len * 0.5 + 0.5) * 255);
      data[i + 2] = Math.round((1 / len * 0.5 + 0.5) * 255);
      data[i + 3] = 255;
    }
  }

  ctx.putImageData(image, 0, 0);
  return canvas;
}

/**
 * Dorso de carta. Se genera una sola vez y se reutiliza en el mazo y en el
 * descarte. Si no hay imagen, cae a un dorso procedural.
 */
export function createCardBackCanvas(art?: HTMLImageElement): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;

  if (art && art.naturalWidth > 0) {
    const scale = Math.max(W / art.naturalWidth, H / art.naturalHeight);
    ctx.drawImage(
      art,
      (W - art.naturalWidth * scale) / 2,
      (H - art.naturalHeight * scale) / 2,
      art.naturalWidth * scale,
      art.naturalHeight * scale,
    );
  } else {
    const bg = ctx.createLinearGradient(0, 0, W, H);
    bg.addColorStop(0, '#0c1a22');
    bg.addColorStop(1, '#060c12');
    ctx.fillStyle = bg;
    roundRect(ctx, 0, 0, W, H, 30);
    ctx.fill();

    ctx.strokeStyle = 'rgba(95, 216, 232, 0.35)';
    ctx.lineWidth = 3;
    for (let i = 1; i <= 6; i++) {
      ctx.beginPath();
      ctx.arc(W / 2, H / 2, i * 42, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  // Marco comun, para que el dorso combine con el frente.
  ctx.strokeStyle = 'rgba(95, 216, 232, 0.55)';
  ctx.lineWidth = 6;
  roundRect(ctx, 4, 4, W - 8, H - 8, 28);
  ctx.stroke();

  return canvas;
}

/** Fondo del tapete: un canvas con textura de micelio. */
export function createTableCanvas(size = 1024): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;

  // Fondo mas claro en el centro: un "charco de luz" sobre el que se leen las
  // cartas. Sin esto la mesa es una mancha negra y las cartas flotan.
  const bg = ctx.createRadialGradient(size / 2, size / 2, size * 0.05, size / 2, size / 2, size * 0.78);
  bg.addColorStop(0, '#22404f');
  bg.addColorStop(0.35, '#16303c');
  bg.addColorStop(0.7, '#0c1a22');
  bg.addColorStop(1, '#060c11');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, size, size);

  // Red de hifas.
  ctx.lineCap = 'round';
  const branch = (x: number, y: number, angle: number, len: number, depth: number): void => {
    if (depth <= 0 || len < 8) return;
    const nx = x + Math.cos(angle) * len;
    const ny = y + Math.sin(angle) * len;
    ctx.strokeStyle = `hsla(190, 65%, 68%, ${0.06 + depth * 0.022})`;
    ctx.lineWidth = depth * 1.1;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(nx, ny);
    ctx.stroke();
    branch(nx, ny, angle - 0.34 - Math.random() * 0.3, len * 0.72, depth - 1);
    branch(nx, ny, angle + 0.34 + Math.random() * 0.3, len * 0.72, depth - 1);
  };
  for (let i = 0; i < 26; i++) {
    branch(Math.random() * size, Math.random() * size, Math.random() * Math.PI * 2, 70, 5);
  }

  // Puntos de espora.
  for (let i = 0; i < 1100; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const r = Math.random() * 2.4;
    ctx.fillStyle = `hsla(${170 + Math.random() * 60}, 75%, 74%, ${Math.random() * 0.26})`;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  return canvas;
}
