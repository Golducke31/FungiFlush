/**
 * board/setup.ts — Armar una partida a partir del contenido.
 *
 * Es el unico puente entre `board.json` y `BoardState`. Se mantiene aparte de
 * `types.ts` para que el modelo no dependa del reparto, y aparte del HUD para
 * que la simulacion de 10.000 partidas use exactamente el mismo reparto que el
 * juego real (si el sim armara las manos distinto, no probaria nada).
 */

import { RNG } from '../rng';
import {
  cardFromDef,
  createBoardState,
  type BoardCard,
  type BoardCardDef,
  type BoardState,
  type PlayerIndex,
  type TieRule,
} from './types';

/**
 * Cartas por jugador.
 *
 * Medido con `npm run sim:board --runs 4000 --hand N` (bot aleatorio, tablero
 * de 16 celdas):
 *
 *   | mano | empates | volteos/partida |
 *   | ---- | ------- | --------------- |
 *   | 4    | 22.8%   | 3.3             |
 *   | 5    | 15.2%   | 5.7             |
 *   | 6    | 10.8%   | 9.3             |
 *   | 7    |  8.3%   | 13.3            |
 *
 * Con 4 cartas quedan 8 celdas vacias y casi no hay a quien atacar (el 23% de
 * las partidas termina empatada); con 7 la partida se estira a 14 colocaciones.
 * 6 deja 4 celdas libres, triplica los volteos y baja los empates a la mitad.
 */
export const BOARD_HAND_SIZE = 6;

export interface MatchOptions {
  defs: readonly BoardCardDef[];
  seed: number;
  handSize?: number;
  tieRule?: TieRule;
}

/**
 * Reparte y devuelve el estado inicial.
 *
 * El reparto consume un RNG propio, sembrado con `seed`: la misma semilla da
 * exactamente las mismas manos. Los `uid` se numeran en orden de reparto, asi
 * que tambien son reproducibles (`bc0`, `bc1`, ...).
 */
export function createMatch(options: MatchOptions): BoardState {
  const handSize = Math.max(1, options.handSize ?? BOARD_HAND_SIZE);
  const needed = handSize * 2;

  if (options.defs.length === 0) {
    throw new Error('[board] no hay datos de tablero: board.json esta vacio.');
  }

  // El pool se repite si hace falta, para que un pack con pocas cartas de
  // tablero siga pudiendo armar una partida en vez de explotar.
  const pool: BoardCardDef[] = [];
  while (pool.length < needed) pool.push(...options.defs);
  pool.length = needed;

  const rng = new RNG(options.seed);
  rng.shuffle(pool);

  const hands: [BoardCard[], BoardCard[]] = [[], []];
  for (let i = 0; i < needed; i++) {
    const def = pool[i];
    if (!def) continue;
    const owner: PlayerIndex = i % 2 === 0 ? 0 : 1;
    hands[owner].push(cardFromDef(def, `bc${i}`, owner));
  }

  // Quien arranca se sortea con una semilla DERIVADA, no con la del reparto:
  // reusar el mismo estado del RNG haria que el que empieza dependiera de como
  // salio el shuffle. Colocar segundo vale un ataque extra, asi que un inicio
  // fijo le daria una ventaja sistematica a uno de los dos.
  const starter: PlayerIndex = new RNG(options.seed ^ 0x9e3779b9).chance(0.5) ? 1 : 0;

  return createBoardState({
    hands,
    seed: options.seed,
    startingPlayer: starter,
    ...(options.tieRule ? { tieRule: options.tieRule } : {}),
  });
}
