/**
 * board/types.ts — Modelo del modo tablero (Tetra Master).
 *
 * POR QUE ESTE MODULO EXISTE APARTE
 * ---------------------------------
 * El duelo micelial no comparte una sola regla con el deckbuilder: no hay
 * Substrate, no hay Spores, no hay Trigger Engine. Lo unico que comparte es la
 * IDENTIDAD de las cartas (su `defId`), y eso entra por `board.json` — un
 * archivo de contenido indexado por `cardId`, no un campo nuevo de
 * `CardDefinition`. Asi una expansion puede dar datos de tablero a cartas del
 * juego base sin sobrescribir su definicion, y un `board.json` roto no puede
 * bloquear un release de cartas.
 *
 * Todo lo de aca adentro es PURO: sin DOM, sin Three.js, sin bus de eventos.
 * Se puede simular 10.000 partidas en Node (ver `tools/boardSim.ts`).
 *
 * CONVENCION DE COORDENADAS
 * -------------------------
 * El tablero es cuadrado (`BOARD_SIZE x BOARD_SIZE`). Una celda se indexa
 * `row * BOARD_SIZE + col`, con `row = 0` ARRIBA y `col = 0` a la IZQUIERDA.
 * `ARROW_OFFSET` traduce cada flecha a (dcol, drow). La direccion opuesta de
 * `d` es `(d + 4) % 8`, que es lo que permite comparar la flecha del atacante
 * con la del defensor que le da la cara.
 */

import { RNG } from '../rng';
import {
  ARROW_DIRS,
  ARROW_OFFSET,
  BOARD_CELLS,
  BOARD_SIZE,
  MAX_ARROW_VALUE,
  MAX_COMBAT_DEPTH,
  oppositeDir,
} from '../constants';

// Las constantes de flechas y de tamano del tablero viven en `../constants`
// (ver el comentario de alla): las comparte la validacion de contenido, que
// corre al arrancar. Se reexportan para que el resto del modo tablero las
// tenga a mano desde un solo lugar.
export {
  ARROW_DIRS,
  ARROW_OFFSET,
  BOARD_CELLS,
  BOARD_SIZE,
  MAX_ARROW_VALUE,
  MAX_COMBAT_DEPTH,
  oppositeDir,
};
export type { ArrowDir } from '../constants';

export function cellIndex(row: number, col: number): number {
  return row * BOARD_SIZE + col;
}

export function cellRow(index: number): number {
  return Math.floor(index / BOARD_SIZE);
}

export function cellCol(index: number): number {
  return index % BOARD_SIZE;
}

export function inBounds(row: number, col: number): boolean {
  return row >= 0 && row < BOARD_SIZE && col >= 0 && col < BOARD_SIZE;
}

/** Celda vecina en una direccion, o -1 si se sale del tablero. */
export function neighborOf(index: number, dir: number): number {
  const offset = ARROW_OFFSET[dir];
  if (!offset) return -1;
  const row = cellRow(index) + offset[1];
  const col = cellCol(index) + offset[0];
  return inBounds(row, col) ? cellIndex(row, col) : -1;
}

// ---------------------------------------------------------------------------
// Datos de contenido (`board.json`)
// ---------------------------------------------------------------------------

/**
 * Una entrada de `board.json`. Solo declara las flechas y los modificadores:
 * el nombre y el arte salen de la definicion de la carta, que el tablero NO
 * necesita conocer para resolver un combate.
 */
export interface BoardCardDef {
  cardId: string;
  /** 8 enteros 0..9 en el orden de `ARROW_DIRS`. 0 = sin flecha. */
  arrows: number[];
  /** Suma al ataque. Default 0. */
  power?: number;
  /** Suma a la defensa. Default 0. */
  defense?: number;
}

// ---------------------------------------------------------------------------
// Estado
// ---------------------------------------------------------------------------

/** Una carta ya materializada en el tablero o en una mano. */
export interface BoardCard {
  uid: string;
  defId: string;
  owner: 0 | 1;
  /** Boca abajo en la MESA. En la mano siempre es `false`: la mano es oculta. */
  faceUp: boolean;
  arrows: number[];
  power: number;
  defense: number;
}

export type PlayerIndex = 0 | 1;

/**
 * Regla de desempate cuando `atk === def`.
 *   - `defender_holds` (default): el defensor conserva la carta. Es la regla
 *     clasica y NO consume RNG, asi que una partida se reproduce sin estado
 *     aleatorio extra.
 *   - `attacker_wins`: empate = volteo (mas agresivo).
 *   - `rng`: moneda al aire. Es lo unico que consume el RNG del tablero.
 */
export type TieRule = 'defender_holds' | 'attacker_wins' | 'rng';

export const DEFAULT_TIE_RULE: TieRule = 'defender_holds';

export type BoardStatus = 'placing' | 'finished';

export interface BoardState {
  size: number;
  /** `BOARD_CELLS` posiciones; `null` = celda libre. */
  cells: Array<BoardCard | null>;
  currentPlayer: PlayerIndex;
  /** Manos ocultas: el contenido solo se ve por `viewFor()`. */
  hands: [BoardCard[], BoardCard[]];
  /** Numero de colocaciones hechas. Es el reloj de la partida. */
  turn: number;
  tieRule: TieRule;
  status: BoardStatus;
  /** 0 | 1 | null (empate). */
  winner: PlayerIndex | null;
  /**
   * Estado interno del RNG, serializable.
   *
   * Se guarda el ESTADO y no un contador de tiradas porque `RNG` es un
   * unico entero (`mulberry32`): reconstruirlo con `new RNG(state.rng)` da
   * exactamente la misma secuencia. Un replay no necesita nada mas.
   */
  rng: number;
}

export function otherPlayer(player: PlayerIndex): PlayerIndex {
  return player === 0 ? 1 : 0;
}

/** Reconstruye un RNG desde el estado guardado. */
export function rngFrom(state: BoardState): RNG {
  return new RNG(state.rng);
}

// ---------------------------------------------------------------------------
// Construccion
// ---------------------------------------------------------------------------

export interface BoardSetup {
  /** Cartas de cada jugador, ya materializadas. */
  hands: [BoardCard[], BoardCard[]];
  seed: number;
  tieRule?: TieRule;
  /**
   * Quien coloca primero. Default 0.
   *
   * Importa mas de lo que parece: colocar segundo vale un ataque extra (el
   * primero pone una carta sin tener a quien atacar), y la simulacion midio
   * ~25% / ~63% con el inicio fijo. `createMatch` lo sortea desde la semilla.
   */
  startingPlayer?: PlayerIndex;
}

export function createBoardState(setup: BoardSetup): BoardState {
  return {
    size: BOARD_SIZE,
    cells: new Array<BoardCard | null>(BOARD_CELLS).fill(null),
    currentPlayer: setup.startingPlayer ?? 0,
    hands: [setup.hands[0].map(cloneCard), setup.hands[1].map(cloneCard)],
    turn: 0,
    tieRule: setup.tieRule ?? DEFAULT_TIE_RULE,
    status: 'placing',
    winner: null,
    rng: new RNG(setup.seed).getSeed(),
  };
}

export function cloneCard(card: BoardCard): BoardCard {
  return { ...card, arrows: [...card.arrows] };
}

/** Clon profundo del estado. `resolvePlacement` NUNCA muta su entrada. */
export function cloneBoardState(state: BoardState): BoardState {
  return {
    ...state,
    cells: state.cells.map((card) => (card ? cloneCard(card) : null)),
    hands: [state.hands[0].map(cloneCard), state.hands[1].map(cloneCard)],
  };
}

/** Materializa una carta a partir de su entrada de contenido. */
export function cardFromDef(
  def: BoardCardDef,
  uid: string,
  owner: PlayerIndex,
  faceUp = false,
): BoardCard {
  return {
    uid,
    defId: def.cardId,
    owner,
    faceUp,
    arrows: [...def.arrows],
    power: def.power ?? 0,
    defense: def.defense ?? 0,
  };
}

// ---------------------------------------------------------------------------
// Consultas
// ---------------------------------------------------------------------------

export function cellOwner(state: BoardState, index: number): PlayerIndex | null {
  return state.cells[index]?.owner ?? null;
}

/** Cuantas celdas controla cada jugador. */
export function cellCounts(state: BoardState): [number, number] {
  let a = 0;
  let b = 0;
  for (const card of state.cells) {
    if (!card) continue;
    if (card.owner === 0) a += 1;
    else b += 1;
  }
  return [a, b];
}

export function isBoardFull(state: BoardState): boolean {
  return state.cells.every((cell) => cell !== null);
}

/** Ataque de una carta hacia una direccion. */
export function attackOf(card: BoardCard, dir: number): number {
  return (card.arrows[dir] ?? 0) + card.power;
}

/** Defensa de una carta contra un ataque que le llega desde `fromDir`. */
export function defenseOf(card: BoardCard, fromDir: number): number {
  // Boca abajo no aporta defensa: la carta se revela, pero llega tarde.
  if (!card.faceUp) return 0;
  return (card.arrows[oppositeDir(fromDir)] ?? 0) + card.defense;
}
