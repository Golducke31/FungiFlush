/**
 * board/view.ts — Lo que cada jugador puede VER.
 *
 * En hot-seat los dos jugadores comparten el dispositivo, asi que la mano del
 * rival es informacion oculta: si el HUD la dibujara, la partida no tendria
 * sentido. `viewFor(state, player)` redacta el estado ANTES de que llegue a
 * cualquier capa de presentacion, y esa es la unica puerta.
 *
 * Esto no es solo prolijidad de hot-seat: cuando el duelo sea online, el
 * servidor va a mandarle a cada cliente exactamente este objeto. Si el HUD
 * leyera `state` directamente, hoy filtraria la mano rival en la pantalla y
 * manana la mandaria por la red. Por eso la UI no conoce `BoardState`.
 */

import type { BoardCard, BoardState, BoardStatus, PlayerIndex, TieRule } from './types';

/** Una carta tal como la ve un jugador. */
export interface BoardCardView {
  uid: string;
  defId: string;
  owner: PlayerIndex;
  /** Boca arriba en la mesa. Las cartas de la mano propia siempre van visibles. */
  faceUp: boolean;
  arrows: number[];
  power: number;
  defense: number;
}

export interface BoardView {
  size: number;
  cells: Array<BoardCardView | null>;
  currentPlayer: PlayerIndex;
  /** Mano del jugador que mira: completa, es suya. */
  hand: BoardCardView[];
  /** Cuantas cartas le quedan al rival. Su CONTENIDO nunca viaja. */
  opponentHandSize: number;
  turn: number;
  status: BoardStatus;
  winner: PlayerIndex | null;
  tieRule: TieRule;
}

function toView(card: BoardCard, reveal: boolean): BoardCardView {
  return {
    uid: card.uid,
    defId: card.defId,
    owner: card.owner,
    faceUp: reveal ? card.faceUp : false,
    arrows: [...card.arrows],
    power: card.power,
    defense: card.defense,
  };
}

export function viewFor(state: BoardState, player: PlayerIndex): BoardView {
  const opponent: PlayerIndex = player === 0 ? 1 : 0;

  return {
    size: state.size,
    cells: state.cells.map((card) => (card ? toView(card, true) : null)),
    currentPlayer: state.currentPlayer,
    // La mano propia se ve entera aunque las cartas nazcan `faceUp: false`:
    // ese flag describe la MESA, no lo que su dueño sabe de sus cartas.
    hand: state.hands[player].map((card) => ({ ...toView(card, true), faceUp: true })),
    opponentHandSize: state.hands[opponent].length,
    turn: state.turn,
    status: state.status,
    winner: state.winner,
    tieRule: state.tieRule,
  };
}
