/**
 * conditions.ts — Evaluador de condiciones data-driven.
 *
 * Cada condicion del JSON se traduce aqui a una funcion pura.
 * El `switch` es exhaustivo: si agregas una condicion nueva a `types.ts`,
 * TypeScript falla la compilacion hasta que la implementes. Eso es
 * exactamente lo que permite escalar a cientos de cartas sin bugs silenciosos.
 */

import type { CardInstance, Condition } from '../types';

/** Proyeccion de solo lectura del estado que las condiciones pueden consultar. */
export interface ConditionWorld {
  hand: readonly CardInstance[];
  scoredCards: readonly CardInstance[];
  substrate: number;
  spores: number;
  money: number;
  cardsPlayedThisRound: number;
  cardsDiscardedThisRound: number;
  jokerCount: number;
  isFirstCardOfRound: boolean;
  isLastCardOfHand: boolean;
  isFirstPlayOfRound: boolean;
}

function countBy<T extends string>(
  cards: readonly CardInstance[],
  selector: (c: CardInstance) => T,
  value: T,
): number {
  let n = 0;
  for (const c of cards) if (selector(c) === value) n++;
  return n;
}

export function evaluateCondition(
  cond: Condition,
  world: ConditionWorld,
  subject: CardInstance | undefined,
): boolean {
  switch (cond.type) {
    case 'element_is':
      return subject?.def.element === cond.value;
    case 'family_is':
      return subject?.def.family === cond.value;
    case 'rarity_is':
      return subject?.def.rarity === cond.value;
    case 'element_in_hand':
      return world.hand.some((c) => c.def.element === cond.value);
    case 'family_in_hand':
      return world.hand.some((c) => c.def.family === cond.value);
    case 'hand_size_gte':
      return world.hand.length >= cond.value;
    case 'substrate_gte':
      return world.substrate >= cond.value;
    case 'spores_gte':
      return world.spores >= cond.value;
    case 'money_gte':
      return world.money >= cond.value;
    case 'cards_played_gte':
      return world.cardsPlayedThisRound >= cond.value;
    case 'cards_discarded_gte':
      return world.cardsDiscardedThisRound >= cond.value;
    case 'scored_count_gte':
      return world.scoredCards.length >= cond.value;
    case 'scored_element_count_gte':
      return countBy(world.scoredCards, (c) => c.def.element, cond.element) >= cond.value;
    case 'scored_family_count_gte':
      return countBy(world.scoredCards, (c) => c.def.family, cond.family) >= cond.value;
    case 'jokers_gte':
      return world.jokerCount >= cond.value;
    case 'is_first_card_of_round':
      return world.isFirstCardOfRound;
    case 'is_last_card_of_hand':
      return world.isLastCardOfHand;
    case 'is_first_play_of_round':
      return world.isFirstPlayOfRound;
    case 'has_status':
      return (subject?.statuses ?? []).some((s) => s.type === cond.status);
    case 'not':
      return !evaluateCondition(cond.cond, world, subject);
    case 'all':
      return cond.conds.every((c) => evaluateCondition(c, world, subject));
    case 'any':
      return cond.conds.some((c) => evaluateCondition(c, world, subject));
    default: {
      // Guardia de exhaustividad: nunca deberia alcanzarse.
      const _exhaustive: never = cond;
      void _exhaustive;
      return false;
    }
  }
}

/** `undefined` o `[]` => sin condiciones => siempre verdadero. */
export function evaluateAll(
  conds: readonly Condition[] | undefined,
  world: ConditionWorld,
  subject: CardInstance | undefined,
): boolean {
  if (!conds || conds.length === 0) return true;
  return conds.every((c) => evaluateCondition(c, world, subject));
}
