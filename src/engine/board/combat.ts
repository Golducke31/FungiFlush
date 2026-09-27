/**
 * board/combat.ts — La resolucion de una colocacion.
 *
 * Esta es LA funcion del modo tablero, y es pura: recibe un estado, devuelve
 * OTRO estado (nunca muta la entrada) mas la lista de pasos que el render
 * reproduce. Toda la animacion del duelo sale de `steps`: el render no
 * recalcula nada, solo muestra lo que paso, en orden.
 *
 * COMO SE RESUELVE
 * ----------------
 *   1. La carta se coloca boca arriba y queda como unica atacante inicial.
 *   2. BFS desde esa celda: por cada flecha con valor > 0 se ataca al vecino.
 *   3. `atk = flecha_propia + power` contra `def = flecha_opuesta + defense`.
 *      Un defensor boca abajo se revela y aporta `def = 0`.
 *   4. Si gana el atacante, la carta cambia de dueño y SIGUE ATACANDO desde su
 *      celda nueva (la cadena es lo que hace divertido al Tetra Master).
 *
 * TERMINACION, GARANTIZADA TRES VECES
 * ------------------------------------
 *   1. MONOTONIA (la razon real). Solo ataca el bando del jugador activo:
 *      cada volteo le suma una celda y se la saca al rival. La propiedad no
 *      puede volver atras, asi que hay como maximo tantos volteos como celdas
 *      y la cadena no puede ciclar.
 *   2. REGLA. Una celda nunca ataca dos veces en la misma resolucion
 *      (`attacked`). Con (1) vigente es inalcanzable — solo se activaria si
 *      una regla futura permitiera contraatacar — pero es la regla declarada y
 *      cuesta un Set.
 *   3. RED. `MAX_COMBAT_DEPTH` corta cualquier cadena que se escape. Se reporta
 *      en `truncated` para poder AFIRMAR que nunca pasa (boardSim sobre 10.000
 *      partidas) en vez de suponerlo.
 */

import { RNG } from '../rng';
import {
  ARROW_DIRS,
  MAX_COMBAT_DEPTH,
  attackOf,
  cloneBoardState,
  defenseOf,
  isBoardFull,
  neighborOf,
  otherPlayer,
  rngFrom,
  type BoardState,
  type PlayerIndex,
  type TieRule,
} from './types';

export type BattleStepKind = 'place' | 'reveal' | 'flip' | 'hold' | 'tie';

export interface BattleStep {
  kind: BattleStepKind;
  /** Celda protagonista: donde se coloca, se revela o se voltea. */
  cell: number;
  /** Celda del atacante. -1 en `place`. */
  from: number;
  /** Indice de `ARROW_DIRS` por el que ataca. -1 en `place`. */
  dir: number;
  attackerUid: string;
  /** Vacio en `place`. */
  defenderUid: string;
  attack: number;
  defense: number;
  /** Profundidad de la cadena: 0 es la carta recien colocada. */
  depth: number;
}

export interface PlacementResult {
  state: BoardState;
  steps: BattleStep[];
  /** `true` si la red de `MAX_COMBAT_DEPTH` corto una cadena. */
  truncated: boolean;
}

/** Motivo por el que una colocacion no se puede hacer, o null si se puede. */
export function validatePlacement(
  state: BoardState,
  cell: number,
  uid: string,
): string | null {
  if (state.status !== 'placing') return 'la partida ya termino';
  if (!Number.isInteger(cell) || cell < 0 || cell >= state.cells.length) return 'celda fuera del tablero';
  if (state.cells[cell] !== null) return 'la celda esta ocupada';
  const hand = state.hands[state.currentPlayer];
  if (!hand.some((card) => card.uid === uid)) return 'esa carta no esta en la mano del jugador activo';
  return null;
}

function resolveTie(rule: TieRule, rng: RNG): boolean {
  if (rule === 'attacker_wins') return true;
  if (rule === 'rng') return rng.chance(0.5);
  return false; // defender_holds
}

/**
 * Coloca una carta y resuelve la cadena de combate.
 *
 * Asume entrada valida: llamar antes a `validatePlacement()`.
 */
export function resolvePlacement(
  state: BoardState,
  cell: number,
  uid: string,
  options?: { faceDown?: boolean },
): PlacementResult {
  const player = state.currentPlayer;
  const next = cloneBoardState(state);
  const rng = rngFrom(state);

  // --- 1. La carta sale de la mano y entra al tablero ---
  const hand = next.hands[player];
  const handIndex = hand.findIndex((card) => card.uid === uid);
  const placed = hand.splice(handIndex, 1)[0];
  if (!placed) throw new Error(`[board] uid "${uid}" no esta en la mano de ${player}.`);

  placed.owner = player;
  placed.faceUp = options?.faceDown !== true;
  next.cells[cell] = placed;

  const steps: BattleStep[] = [
    {
      kind: 'place',
      cell,
      from: -1,
      dir: -1,
      attackerUid: placed.uid,
      defenderUid: '',
      attack: 0,
      defense: 0,
      depth: 0,
    },
  ];

  // --- 2. Cadena de combate (BFS) ---
  const queue: Array<{ cell: number; depth: number }> = [{ cell, depth: 0 }];
  /** Celdas que YA atacaron: la garantia de terminacion. */
  const attacked = new Set<number>([cell]);
  let truncated = false;

  for (let head = 0; head < queue.length; head++) {
    const current = queue[head];
    if (!current) break;
    const attacker = next.cells[current.cell];
    if (!attacker) continue;

    for (let dir = 0; dir < ARROW_DIRS.length; dir++) {
      if ((attacker.arrows[dir] ?? 0) <= 0) continue;

      const target = neighborOf(current.cell, dir);
      if (target < 0) continue;
      const defender = next.cells[target];
      if (!defender) continue;
      // Fuego amigo: una carta no ataca a las de su propio dueño.
      if (defender.owner === attacker.owner) continue;

      const attack = attackOf(attacker, dir);
      const defense = defenseOf(defender, dir);

      if (!defender.faceUp) {
        defender.faceUp = true;
        steps.push({
          kind: 'reveal',
          cell: target,
          from: current.cell,
          dir,
          attackerUid: attacker.uid,
          defenderUid: defender.uid,
          attack,
          defense,
          depth: current.depth,
        });
      }

      const wins =
        attack === defense ? resolveTie(next.tieRule, rng) : attack > defense;

      if (!wins) {
        steps.push({
          kind: attack === defense ? 'tie' : 'hold',
          cell: target,
          from: current.cell,
          dir,
          attackerUid: attacker.uid,
          defenderUid: defender.uid,
          attack,
          defense,
          depth: current.depth,
        });
        continue;
      }

      defender.owner = attacker.owner;
      steps.push({
        kind: 'flip',
        cell: target,
        from: current.cell,
        dir,
        attackerUid: attacker.uid,
        defenderUid: defender.uid,
        attack,
        defense,
        depth: current.depth,
      });

      // La carta volteada pasa a atacar desde SU celda, si no lo hizo ya.
      if (attacked.has(target)) continue;
      attacked.add(target);
      if (current.depth + 1 > MAX_COMBAT_DEPTH) {
        truncated = true;
        continue;
      }
      queue.push({ cell: target, depth: current.depth + 1 });
    }
  }

  next.rng = rng.getSeed();
  next.turn += 1;
  advanceTurn(next, player);
  return { state: next, steps, truncated };
}

/**
 * Pasa el turno. Si un jugador se quedo sin cartas sigue el otro; si no le
 * queda ninguna a nadie (o el tablero esta lleno) la partida termina y gana
 * quien controle mas celdas. Un 8-8 es empate: no se desempata por puntos
 * porque el tablero no tiene puntos.
 */
function advanceTurn(state: BoardState, player: PlayerIndex): void {
  const [h0, h1] = state.hands;
  if ((h0.length === 0 && h1.length === 0) || isBoardFull(state)) {
    state.status = 'finished';
    state.winner = winnerOf(state);
    return;
  }
  if (h0.length === 0) {
    state.currentPlayer = 1;
    return;
  }
  if (h1.length === 0) {
    state.currentPlayer = 0;
    return;
  }
  state.currentPlayer = otherPlayer(player);
}

export function winnerOf(state: BoardState): PlayerIndex | null {
  let a = 0;
  let b = 0;
  for (const card of state.cells) {
    if (!card) continue;
    if (card.owner === 0) a += 1;
    else b += 1;
  }
  if (a === b) return null;
  return a > b ? 0 : 1;
}
