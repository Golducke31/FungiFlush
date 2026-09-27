/**
 * RoundState.ts — Estado de una mano del blind (una "ronda").
 * Se descarta al terminar el blind; lo persistente vive en RunState.
 */

import type { BlindDefinition, CardInstance } from '../types';

export interface RoundState {
  blind: BlindDefinition;
  /** Score objetivo para superar el blind. */
  target: number;
  score: number;
  hand: CardInstance[];
  /** uids de las cartas seleccionadas por el jugador. */
  selected: string[];
  handsLeft: number;
  discardsLeft: number;
  handSize: number;
  cardsPlayedThisRound: number;
  cardsDiscardedThisRound: number;
  /** false una vez que se jugo la primera mano del blind. */
  isFirstPlayOfRound: boolean;
  /** Efectos "once: per_round" ya consumidos en este blind. */
  consumedEffects: Set<string>;
  /** Historial de manos jugadas (para la UI de "ultima mano"). */
  history: Array<{ cards: string[]; score: number }>;
}

export function createRoundState(
  blind: BlindDefinition,
  target: number,
  handSize: number,
  hands: number,
  discards: number,
): RoundState {
  return {
    blind,
    target,
    score: 0,
    hand: [],
    selected: [],
    handsLeft: hands,
    discardsLeft: discards,
    handSize,
    cardsPlayedThisRound: 0,
    cardsDiscardedThisRound: 0,
    isFirstPlayOfRound: true,
    consumedEffects: new Set<string>(),
    history: [],
  };
}

export function isSelected(round: RoundState, uid: string): boolean {
  return round.selected.includes(uid);
}

export function selectedCards(round: RoundState): CardInstance[] {
  return round.selected
    .map((uid) => round.hand.find((c) => c.uid === uid))
    .filter((c): c is CardInstance => c !== undefined);
}

/** Maximo de cartas jugables por mano. */
export const MAX_PLAY_SIZE = 5;
