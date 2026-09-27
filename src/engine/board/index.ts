/**
 * board/index.ts — API publica del modo tablero.
 *
 * Se importa con `await import('@engine/board')`: Vite lo separa en su propio
 * chunk, asi que el duelo no cuesta un byte en el arranque del juego normal.
 * Nada de `src/engine/board/**` deberia importarse desde afuera por ruta
 * directa (misma regla que el resto del motor).
 */

export {
  ARROW_DIRS,
  ARROW_OFFSET,
  BOARD_CELLS,
  BOARD_SIZE,
  DEFAULT_TIE_RULE,
  MAX_ARROW_VALUE,
  MAX_COMBAT_DEPTH,
  attackOf,
  cellCol,
  cellCounts,
  cellIndex,
  cellRow,
  cloneBoardState,
  createBoardState,
  defenseOf,
  inBounds,
  isBoardFull,
  neighborOf,
  otherPlayer,
  rngFrom,
} from './types';
export type {
  ArrowDir,
  BoardCard,
  BoardCardDef,
  BoardSetup,
  BoardState,
  BoardStatus,
  PlayerIndex,
  TieRule,
} from './types';

export { resolvePlacement, validatePlacement, winnerOf } from './combat';
export type { BattleStep, BattleStepKind, PlacementResult } from './combat';

export { applyCommand, passTurn } from './MatchController';
export type { CommandResult, MatchCommand } from './MatchController';

export { viewFor } from './view';
export type { BoardCardView, BoardView } from './view';

export { BOARD_HAND_SIZE, createMatch } from './setup';
export type { MatchOptions } from './setup';
