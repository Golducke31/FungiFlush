/**
 * orderBonus.ts — Bonus por el ORDEN en que se juegan las cartas.
 *
 * Hermano de `combos.ts`. La diferencia importa: los combos miran **QUE** cartas
 * se jugaron (un conjunto, sin importar en que posicion), y esto mira **EN QUE
 * ORDEN** (una secuencia). Son reglas distintas, se balancean distinto y por eso
 * viven en archivos separados.
 *
 * Se evalua sobre las cartas puntuadas EN EL ORDEN DE JUEGO: el orden en que el
 * jugador las solto, no el de la mano. Es lo que hace que acomodar la mano sea
 * una decision y no un detalle.
 *
 * Los valores son modestos a proposito. Un bonus de orden que compita con los
 * combos de composicion rompe el balance: jugar 5 del mismo elemento ya da x3 de
 * Esporas, y si encima el orden diera otro x2 las manos perfectas se volarian la
 * escala. Aca premia "acomodaste bien", no "sacaste la mano perfecta".
 */

import type { CardInstance } from '../types';

export interface OrderBonus {
  id: string;
  nameKey: string;
  /** Cartas que participaron (para el resaltado visual). */
  cardUids: string[];
  /** Suma plana al Substrate. */
  flatSubstrate: number;
  /** Multiplicador de Spores. */
  sporeMultiplier: number;
}

/** Con menos de 3 cartas no hay secuencia que premiar. */
const MIN_CARDS = 3;
/**
 * Sustrato plano de la Escalera. Es FIJO y no escala con la cantidad de cartas
 * a proposito: el `nameKey` es una clave i18n estatica ("Escalera (+12
 * Sustrato)"), asi que un valor que dependiera del tamano de la mano no podria
 * traducirse. Si alguna vez se quiere escalar, hay que pasar por claves por
 * tamano como hace `combos.ts` (combo.family.3 / .4 / .5).
 */
const LADDER_FLAT = 12;
/** Multiplicador de Esporas de la Corona. */
const CROWN_MULTIPLIER = 1.2;

function substrateOf(card: CardInstance): number {
  return card.def.baseSubstrate + card.bonusSubstrate;
}

function strictlyAscending(values: readonly number[]): boolean {
  for (let i = 1; i < values.length; i += 1) {
    const prev = values[i - 1];
    const current = values[i];
    if (prev === undefined || current === undefined) return false;
    if (current <= prev) return false;
  }
  return true;
}

export function detectOrderBonuses(scored: readonly CardInstance[]): OrderBonus[] {
  if (scored.length < MIN_CARDS) return [];

  const values = scored.map(substrateOf);
  const cardUids = scored.map((card) => card.uid);
  const bonuses: OrderBonus[] = [];

  // ESCALERA: el Sustrato crece estrictamente en el orden de juego. Premia
  // acomodar la mano de menor a mayor en vez de soltarla como venga.
  if (strictlyAscending(values)) {
    bonuses.push({
      id: 'ladder',
      nameKey: 'order.ladder',
      cardUids,
      flatSubstrate: LADDER_FLAT,
      sporeMultiplier: 1,
    });
  }

  // CORONA: la ultima carta jugada es la mas fuerte de la mano. Premia guardar
  // el cierre en vez de gastarlo al principio.
  const last = values[values.length - 1];
  const rest = values.slice(0, -1);
  if (last !== undefined && rest.every((value) => value < last)) {
    bonuses.push({
      id: 'crown',
      nameKey: 'order.crown',
      cardUids,
      flatSubstrate: 0,
      sporeMultiplier: CROWN_MULTIPLIER,
    });
  }

  return bonuses;
}
