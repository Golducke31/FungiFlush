/**
 * constants.ts — Numeros magicos en un solo lugar.
 * Balance del juego centralizado: se toca aqui, no en la logica.
 */

/** Profundidad maxima de una cadena de disparos antes de cortarla. */
export const MAX_TRIGGER_DEPTH = 12;

/** Presupuesto total de disparos por resolucion de mano (anti-bucle). */
export const MAX_TRIGGERS_PER_RESOLUTION = 600;

/** Maximo de cartas que se pueden jugar en una misma mano. */
export const MAX_PLAY_SIZE_DEFAULT = 5;

/** Tamano maximo de la mano (los efectos DRAW_CARDS no pueden pasarlo). */
export const MAX_HAND_SIZE = 12;

/** Emisiones por evento antes de considerarlo un bucle. */
export const MAX_EMITS_PER_EVENT = 64;

/** Objetivo base de score por ante. Se multiplica por el blind. */
export const ANTE_BASE_TARGET: Record<number, number> = {
  1: 300,
  2: 800,
  3: 2000,
  4: 5200,
  5: 13000,
  6: 32000,
  7: 78000,
  8: 190000,
};

/**
 * Escalado del objetivo dentro de un mismo ante.
 * NOTA: el multiplicador efectivo vive en `blinds.json` (campo scoreMultiplier),
 * para que el disenador de contenido lo pueda tocar sin recompilar. Estos son
 * solo los valores de referencia con los que se autoro el contenido.
 */
export const BLIND_TIER_REFERENCE: Record<'small' | 'big' | 'boss', number> = {
  small: 1.0,
  big: 1.5,
  boss: 2.0,
};

/** Valores iniciales de una run. */
export const RUN_DEFAULTS = {
  money: 4,
  handSize: 8,
  hands: 4,
  discards: 3,
  jokerSlots: 5,
  ante: 1,
} as const;

/** Economia. */
export const ECONOMY = {
  /** Coste de eliminar una carta del mazo en el constructor de mazo. */
  purgeCost: 4,
  /** Monedas por mano sobrante al superar el blind. */
  moneyPerUnusedHand: 1,
  /** Monedas base por superar un blind. */
  baseBlindReward: 3,
  /** Coste de reroll en tienda (escala por uso). */
  rerollBaseCost: 5,
  rerollCostStep: 1,
  /** Precio de venta de un joker respecto a su coste. */
  jokerSellRatio: 0.5,
} as const;
