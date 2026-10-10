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
  1: 1100,
  2: 2200,
  3: 4400,
  4: 8800,
  5: 18000,
  6: 38000,
  7: 82000,
  8: 180000,
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

/**
 * DADO MULTIPLICADOR — tabla de caras.
 *
 * Se tira al elegir el ciego. El multiplicador entra al FINAL del puntaje
 * (sobre el multiplicador de esporas), y las caras altas COBRAN: menos manos o
 * menos descartes. Esa es la gracia — el azar obliga a DECIDIR, no solo a
 * esperar.
 *
 * Conservador a proposito: el promedio es ~1,19x, asi que el dado mueve la
 * aguja sin volar los objetivos (referencia de balance: 29,6% de victorias,
 * ante medio 6,33). Si se suben los valores, hay que volver a correr
 * `npm run sim:balance`.
 */
export const DIE_FACES: ReadonlyArray<{
  readonly value: number;
  readonly multiplier: number;
  readonly hands: number;
  readonly discards: number;
}> = [
  { value: 1, multiplier: 0.8, hands: 0, discards: 0 },
  { value: 2, multiplier: 1, hands: 0, discards: 0 },
  { value: 3, multiplier: 1.1, hands: 0, discards: 0 },
  { value: 4, multiplier: 1.25, hands: 0, discards: -1 },
  { value: 5, multiplier: 1.4, hands: -1, discards: 0 },
  { value: 6, multiplier: 1.6, hands: -1, discards: -1 },
];

/**
 * Coste de VOLVER A TIRAR el dado: escala con las tiradas ya hechas en el mismo
 * ciego. La primera cuesta poco y la tercera duele, para que insistir tenga
 * precio. Se paga con dinero, que es lo que compite con la tienda.
 */
export const DIE_REROLL_BASE = 3;
export const DIE_REROLL_STEP = 3;

/** Valores iniciales de una run. */
export const RUN_DEFAULTS = {
  money: 4,
  // Fase 1 (2026-10-05): la mano inicial baja de 8 a 6. Con 8 cartas el abanico
  // tenia que abrirse tanto en movil que las cartas se pisaban contra las pilas;
  // 6 deja aire para mazo y descarte sin achicar la carta hasta lo ilegible.
  handSize: 6,
  hands: 4,
  discards: 3,
  jokerSlots: 5,
  ante: 1,
  /**
   * Cargas iniciales de la habilidad FungiFlush. Se arranca con una para que el
   * jugador la descubra en el primer ciego; despues se recarga jugando bien.
   */
  fungiFlushCharges: 1,
} as const;

// ---------------------------------------------------------------------------
// HABILIDAD FungiFlush
// ---------------------------------------------------------------------------
//
// La habilidad INSIGNIA de la run: un boton manual que arma la proxima mano con
// un gran multiplicador de Esporas, limpia los estados negativos y roba cartas.
//
// ⚠️ REGLA VIGENTE (rediseno): la habilidad se CARGA sola durante el ciego y
// solo puede dispararse **una vez por ciego**, cuando las cargas llegan al tope
// (3/3). Al usarla, las cargas **vuelven a 1** (no a 0) y el marcador arranca el
// proximo ciego en 1/3. Se carga jugando manos con combo grande (elemento >= 3
// o familia >= 4).
//
// El tope es la FUENTE DE LA VERDAD del estado del boton: `1/3` y `2/3` estan
// "cargando" (boton apagado), `3/3` esta "listo".

/** Cargas maximas: el boton solo se habilita al llegar a este tope. */
export const FUNGI_FLUSH_MAX_CHARGES = 3;

/** Multiplicador de Esporas que arma la habilidad para la proxima mano. */
export const FUNGI_FLUSH_SPORE_MULT = 2.5;

/** Cartas que roba al activarse (respeta MAX_HAND_SIZE). */
export const FUNGI_FLUSH_DRAW = 2;

/**
 * Cargas a las que se RESETEA la habilidad despues de usarla. No es 0: el
 * jugador nunca queda "sin nada" — vuelve a empezar la carga del proximo ciego.
 */
export const FUNGI_FLUSH_AFTER_USE_CHARGES = 1;

/**
 * Tier de combo que SUMA una carga al cerrar la mano: elemento >= 3 cartas o
 * familia >= 4. Premia armar la mano, no solo jugar cartas sueltas.
 */
export const FUNGI_FLUSH_RECHARGE_ELEMENT_TIER = 3;
export const FUNGI_FLUSH_RECHARGE_FAMILY_TIER = 4;

/**
 * Estados que la habilidad LIMPIA (los negativos): podredumbre y esterilidad.
 * No toca los positivos (overgrowth, etc.).
 */
export const FUNGI_FLUSH_CLEARS_STATUSES: readonly string[] = ['decay', 'spore_lock'];


/** Economia. */
export const ECONOMY = {
  /** Coste de eliminar una carta del mazo en el constructor de mazo. */
  purgeCost: 4,
  /** Purgas permitidas por ANTE. Tope duro, se resetea al entrar a un ante nuevo. */
  purgesPerAnte: 2,
  /** Monedas por mano sobrante al superar el blind. */
  moneyPerUnusedHand: 1,
  /** Monedas base por superar un blind. */
  baseBlindReward: 3,
  /**
   * Bono ADICIONAL por superar el ciego en UNA sola mano.
   *
   * Es un premio explicito a la jugada optima: el bono implicito por manos sin
   * usar (`moneyPerUnusedHand`) ya recompensa ahorrar manos, pero no distingue
   * "gane usando 1 de 4" de "gane usando 3 de 4 con dos sobrantes". Este extra
   * hace visible esa diferencia. Se SUMA al bono por manos sin usar.
   */
  firstHandBonus: 3,
  /** Coste de reroll en tienda (escala por uso). */
  rerollBaseCost: 5,
  rerollCostStep: 1,
  /** Precio de venta de un joker respecto a su coste. */
  jokerSellRatio: 0.5,
} as const;

// ---------------------------------------------------------------------------
// Modo tablero (Tetra Master)
// ---------------------------------------------------------------------------
//
// Estas constantes viven ACA y no en `src/engine/board/` a proposito: el
// tablero se carga con `await import()`, pero la validacion de contenido
// (que corre al arrancar) necesita las mismas flechas para revisar los JSON.
// Si vivieran dentro del modulo diferido, el chunk dejaria de ser diferido.

/** Lado del tablero. 4x4, como Tetra Master. */
export const BOARD_SIZE = 4;
export const BOARD_CELLS = BOARD_SIZE * BOARD_SIZE;

/**
 * Profundidad maxima de una cadena de volteos dentro de UNA colocacion.
 * Es una red de seguridad, no una regla de balance: la garantia real de
 * terminacion es que cada volteo le saca una celda al rival (ver combat.ts).
 */
export const MAX_COMBAT_DEPTH = 16;

/** Orden canonico de las flechas. El indice ES la direccion. */
export const ARROW_DIRS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const;
export type ArrowDir = (typeof ARROW_DIRS)[number];

/** (dcol, drow) de cada direccion, en el orden de `ARROW_DIRS`. */
export const ARROW_OFFSET: ReadonlyArray<readonly [number, number]> = [
  [0, -1], // N
  [1, -1], // NE
  [1, 0], // E
  [1, 1], // SE
  [0, 1], // S
  [-1, 1], // SW
  [-1, 0], // W
  [-1, -1], // NW
];

/** Valor maximo de una flecha. 0 = la carta no apunta para ese lado. */
export const MAX_ARROW_VALUE = 9;

/** La direccion opuesta: el indice + 4 (mod 8). */
export function oppositeDir(dir: number): number {
  return (dir + 4) % 8;
}
