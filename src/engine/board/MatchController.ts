/**
 * board/MatchController.ts — El reducer del duelo.
 *
 * Toda la partida pasa por aca: `applyCommand(estado, comando) -> estado`.
 * Es la MISMA API que va a usar el multijugador online, y por eso el comando
 * lleva `by` aunque hoy el hot-seat ya sepa de quien es el turno: cuando el
 * input llegue por la red, el relay solo tiene que reenviar el comando y
 * volver a correr esta funcion. No hay que tocar `combat.ts`.
 *
 * Es PURO: no muta el estado de entrada, no toca el DOM y no lee el reloj.
 * Un comando invalido devuelve el MISMO objeto de estado (comparacion por
 * referencia) con `error`, asi el llamador distingue "no paso nada" de
 * "paso algo y quedo igual".
 */

import { resolvePlacement, validatePlacement, type BattleStep } from './combat';
import { otherPlayer, type BoardState, type PlayerIndex } from './types';

export type MatchCommand =
  | { t: 'place'; by: PlayerIndex; cell: number; uid: string; faceDown?: boolean }
  | { t: 'concede'; by: PlayerIndex };

export interface CommandResult {
  state: BoardState;
  /** Pasos a reproducir. Vacio si el comando no produjo nada. */
  steps: BattleStep[];
  /** Motivo del rechazo, o null si se aplico. */
  error: string | null;
  /**
   * `true` si la red de `MAX_COMBAT_DEPTH` corto una cadena. Se propaga hasta
   * aca para que la simulacion pueda AFIRMAR que nunca pasa en vez de suponerlo.
   */
  truncated: boolean;
}

const NO_STEPS: BattleStep[] = [];

export function applyCommand(state: BoardState, cmd: MatchCommand): CommandResult {
  if (state.status !== 'placing') {
    return { state, steps: NO_STEPS, error: 'la partida ya termino', truncated: false };
  }
  if (cmd.by !== state.currentPlayer) {
    return { state, steps: NO_STEPS, error: 'no es el turno de ese jugador', truncated: false };
  }

  if (cmd.t === 'concede') {
    const next: BoardState = {
      ...state,
      status: 'finished',
      winner: otherPlayer(cmd.by),
    };
    return { state: next, steps: NO_STEPS, error: null, truncated: false };
  }

  const problem = validatePlacement(state, cmd.cell, cmd.uid);
  if (problem) return { state, steps: NO_STEPS, error: problem, truncated: false };

  const result = resolvePlacement(
    state,
    cmd.cell,
    cmd.uid,
    cmd.faceDown === undefined ? undefined : { faceDown: cmd.faceDown },
  );
  return { state: result.state, steps: result.steps, error: null, truncated: result.truncated };
}

/**
 * Pasa el turno sin colocar. Solo es legal cuando el jugador activo NO tiene
 * ninguna colocacion posible; en el flujo normal (con cartas y celdas libres)
 * siempre hay algo que hacer, asi que la UI no lo ofrece.
 *
 * Existe igual porque el transporte online lo necesita: un cliente que se
 * desconecta no puede dejar la partida trabada.
 */
export function passTurn(state: BoardState, by: PlayerIndex): CommandResult {
  if (state.status !== 'placing') {
    return { state, steps: NO_STEPS, error: 'la partida ya termino', truncated: false };
  }
  if (by !== state.currentPlayer) {
    return { state, steps: NO_STEPS, error: 'no es el turno de ese jugador', truncated: false };
  }
  const next: BoardState = { ...state, currentPlayer: otherPlayer(by) };
  return { state: next, steps: NO_STEPS, error: null, truncated: false };
}
