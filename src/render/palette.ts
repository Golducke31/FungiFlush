/**
 * palette.ts — Colores del juego en un solo lugar.
 * Compartido por las texturas procedurales (canvas 2D) y los shaders GLSL,
 * para que una carta y su glow siempre combinen.
 */

import type { ElementType, Rarity, StatusType } from '@engine/index';

/** Color de cada elemento. Define el borde de la carta y su glow. */
export const ELEMENT_COLOR: Record<ElementType, number> = {
  neutral: 0x9aa5b1,
  poison: 0x8ce63f,
  spore: 0xf2c14e,
  decay: 0xc1683a,
  symbiosis: 0x4fd18b,
  crystal: 0x5fd8e8,
  mycelium: 0xa78bfa,
  parasite: 0xe05c8a,
};

/** Color de rareza. Define el grosor y brillo del marco. */
export const RARITY_COLOR: Record<Rarity, number> = {
  common: 0x8a94a6,
  uncommon: 0x4fc3f7,
  rare: 0xb388ff,
  legendary: 0xffc857,
  mythic: 0xff5c8a,
};

/** Grosores relativos del marco segun rareza (en px de canvas). */
export const RARITY_BORDER: Record<Rarity, number> = {
  common: 4,
  uncommon: 5,
  rare: 7,
  legendary: 9,
  mythic: 12,
};

export const STATUS_COLOR: Record<StatusType, number> = {
  dormant: 0x5b6472,
  decay: 0xc1683a,
  spore_lock: 0x7a8794,
  overgrowth: 0x4fd18b,
};

export const UI_COLORS = {
  substrate: 0xf2a63b,
  spores: 0x4fd18b,
  money: 0xffc857,
  background: 0x080b10,
  table: 0x0d141c,
  tableLine: 0x1b2b38,
} as const;

/**
 * Lila de HABILIDAD.
 *
 * Un unico valor para la etiqueta de la cara de carta (`CardTexture`) y para el
 * VFX de activacion en la mesa (`SceneManager.flashAbility`): si el jugador ve
 * el destello, tiene que poder rastrearlo hasta el borde lila de la carta. Dos
 * constantes separadas se desincronizarian al primer ajuste de paleta.
 */
export const ABILITY_COLOR = 0xc4a8ff;

/**
 * Verde de SELECCION.
 *
 * Es el color del anillo/borde de una carta elegida y del badge con su numero
 * de orden (1-5). Deliberadamente distinto del verde de `symbiosis`/
 * `overgrowth` (0x4fd18b): si compartieran tono, una carta de simbiosis
 * seleccionada no se distinguiria de una solo resaltada por elemento.
 */
export const SELECT_COLOR = 0x5ef08a;

/** 0xRRGGBB -> '#rrggbb' */
export function hexToCss(hex: number): string {
  return `#${hex.toString(16).padStart(6, '0')}`;
}

/** 0xRRGGBB + alpha -> 'rgba(r,g,b,a)' */
export function hexToRgba(hex: number, alpha: number): string {
  const r = (hex >> 16) & 0xff;
  const g = (hex >> 8) & 0xff;
  const b = hex & 0xff;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** Mezcla dos colores hex. t=0 -> a, t=1 -> b */
export function mixHex(a: number, b: number, t: number): number {
  const ar = (a >> 16) & 0xff;
  const ag = (a >> 8) & 0xff;
  const ab = a & 0xff;
  const br = (b >> 16) & 0xff;
  const bg = (b >> 8) & 0xff;
  const bb = b & 0xff;
  const r = Math.round(ar + (br - ar) * t);
  const g = Math.round(ag + (bg - ag) * t);
  const bl = Math.round(ab + (bb - ab) * t);
  return (r << 16) | (g << 8) | bl;
}
