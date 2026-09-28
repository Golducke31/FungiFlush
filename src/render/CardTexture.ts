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
  kind: 'card' | 'joker' | 'mutation';
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
): void {
  const g = ctx.createLinearGradient(x, y, x, y + h);
  g.addColorStop(0, hexToRgba(color, 0.28));
  g.addColorStop(1, hexToRgba(color, 0.1));
  ctx.fillStyle = g;
  roundRect(ctx, x, y, w, h, 12);
  ctx.fill();
  ctx.strokeStyle = hexToRgba(color, 0.7);
  ctx.lineWidth = 2.5;
  roundRect(ctx, x, y, w, h, 12);
  ctx.stroke();

  ctx.fillStyle = hexToRgba(color, 0.85);
  ctx.font = `700 17px ${CARD_TEXT_FONT}`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(label.toUpperCase(), x + 14, y + h / 2 + 1);

  ctx.fillStyle = '#ffffff';
  ctx.font = `700 38px ${CARD_TEXT_FONT}`;
  ctx.textAlign = 'right';
  ctx.fillText(value, x + w - 14, y + h / 2 + 2);
}

// ---------------------------------------------------------------------------
// Composicion de la carta
// ---------------------------------------------------------------------------

export function createCardCanvas(spec: CardTextureSpec, art?: HTMLImageElement): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;

  const elementColor = ELEMENT_COLOR[spec.element];
  const rarityColor = RARITY_COLOR[spec.rarity];
  const border = RARITY_BORDER[spec.rarity];
  const pad = border + 8;

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

  // --- 4. Cabecera: elemento + nombre ---
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';

  ctx.fillStyle = hexToRgba(elementColor, 0.95);
  ctx.font = `400 17px ${CARD_DISPLAY_FONT}`;
  ctx.fillText(spec.element.toUpperCase(), W / 2, 30);

  ctx.fillStyle = '#f2f6fb';
  ctx.font = `400 31px ${CARD_DISPLAY_FONT}`;
  const nameLines = wrapText(ctx, spec.name, W - pad * 2 - 20, 2);
  nameLines.forEach((line, i) => ctx.fillText(line, W / 2, 56 + i * 36));

  // --- 5. Pie: chips de stats + descripcion ---
  const footerTop = spec.kind === 'card' ? 508 : 520;

  if (spec.kind === 'card') {
    const chipW = (W - pad * 2 - 18) / 2;
    drawChip(ctx, pad, footerTop, chipW, 74, 'SUSTRATO', String(spec.substrate ?? 0), 0xf2a63b);
    drawChip(ctx, pad + chipW + 18, footerTop, chipW, 74, 'ESPORAS', `x${spec.spores ?? 1}`, 0x4fd18b);
  } else {
    // Jokers y mutaciones: sin stats, solo un rotulo de tipo.
    const label = spec.kind === 'joker' ? 'JOKER' : 'MUTACION';
    const g = ctx.createLinearGradient(0, footerTop, 0, footerTop + 52);
    g.addColorStop(0, hexToRgba(rarityColor, 0.34));
    g.addColorStop(1, hexToRgba(rarityColor, 0.12));
    ctx.fillStyle = g;
    roundRect(ctx, pad, footerTop, W - pad * 2, 52, 12);
    ctx.fill();
    ctx.strokeStyle = hexToRgba(rarityColor, 0.75);
    ctx.lineWidth = 2.5;
    roundRect(ctx, pad, footerTop, W - pad * 2, 52, 12);
    ctx.stroke();
    ctx.fillStyle = hexToCss(rarityColor);
    ctx.font = `400 24px ${CARD_DISPLAY_FONT}`;
    ctx.textBaseline = 'middle';
    ctx.fillText(label, W / 2, footerTop + 27);
    ctx.textBaseline = 'top';
  }

  const descTop = spec.kind === 'card' ? footerTop + 92 : footerTop + 68;
  ctx.fillStyle = 'rgba(200, 214, 228, 0.88)';
  ctx.font = `700 21px ${CARD_TEXT_FONT}`;
  const descLines = wrapText(ctx, spec.desc, W - pad * 2 - 12, spec.kind === 'card' ? 4 : 5);
  descLines.forEach((line, i) => ctx.fillText(line, W / 2, descTop + i * 28));

  // --- 7. Gema de rareza (esquina superior derecha) ---
  ctx.save();
  ctx.translate(W - 44, 44);
  ctx.rotate(Math.PI / 4);
  ctx.fillStyle = hexToCss(rarityColor);
  ctx.shadowColor = hexToCss(rarityColor);
  ctx.shadowBlur = 18;
  ctx.fillRect(-13, -13, 26, 26);
  ctx.restore();

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
  const statuses = spec.statuses ?? [];
  statuses.slice(0, 4).forEach((status, i) => {
    const color = STATUS_COLOR[status];
    const x = 22 + i * 62;
    const y = H - 46;
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

// ---------------------------------------------------------------------------
// Cache de texturas
// ---------------------------------------------------------------------------

export class CardTextureCache {
  private readonly cache = new Map<string, THREE.CanvasTexture>();

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

  /** Al cambiar de idioma hay que redibujar: el texto esta dentro de la textura. */
  clear(): void {
    for (const texture of this.cache.values()) texture.dispose();
    this.cache.clear();
  }

  get size(): number {
    return this.cache.size;
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
