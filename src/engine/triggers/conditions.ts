/**
 * conditions.ts — Evaluador de condiciones data-driven.
 *
 * Cada condicion del JSON se traduce aqui a una funcion pura.
 * El `switch` es exhaustivo: si agregas una condicion nueva a `types.ts`,
 * TypeScript falla la compilacion hasta que la implementes. Eso es
 * exactamente lo que permite escalar a cientos de cartas sin bugs silenciosos.
 */

import type { CardInstance, Condition, StatusType } from '../types';

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
  /**
   * La carta que DISPARO el evento, cuando la hay.
   *
   * `undefined` en los eventos GLOBALES (`dispatchGlobal`): ON_RUN_START,
   * ON_BLIND_SELECTED, ON_ROUND_START, ON_HAND_SCORED, ON_SHOP_*, ON_ROUND_WIN,
   * ON_ROUND_LOSS. Las condiciones `trigger_*` son falsas ahi, por definicion.
   */
  triggerCard?: CardInstance;
  /**
   * Estados PEDIDOS en esta resolucion y todavia no asentados (`statusRequests`).
   *
   * `APPLY_STATUS` no muta la carta: acumula el pedido y `applyDeltas` lo aplica
   * al cerrar la mano. Sin mirar aca, una carta que se aplica un estado y lo
   * consulta en la MISMA mano no lo veia — el caso de `deep_latent_sporocarp`,
   * que "al puntuar revienta" el Sobrecrecimiento que se puso al jugarse.
   */
  pendingStatuses?: readonly { uid: string; status: StatusType }[];
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
    case 'scored_element_families_gte': {
      const ofElement = world.scoredCards.filter((c) => c.def.element === cond.element);
      if (ofElement.length < cond.count) return false;
      return new Set(ofElement.map((c) => c.def.family)).size >= cond.families;
    }
    case 'jokers_gte':
      return world.jokerCount >= cond.value;
    case 'is_first_card_of_round':
      return world.isFirstCardOfRound;
    case 'is_last_card_of_hand':
      return world.isLastCardOfHand;
    case 'is_first_play_of_round':
      return world.isFirstPlayOfRound;
    // `has_status` mira la carta que lleva el efecto: lo asentado en ella y lo
    // PEDIDO para ella en esta misma resolucion (ver `pendingStatuses`).
    case 'has_status': {
      if ((subject?.statuses ?? []).some((s) => s.type === cond.status)) return true;
      return (
        !!subject &&
        (world.pendingStatuses ?? []).some((p) => p.uid === subject.uid && p.status === cond.status)
      );
    }
    // La MANO entera: las cartas jugadas (`scoredCards`) y las retenidas
    // (`hand`). Es la lectura que piden las cartas de putrefaccion que hablan de
    // "tus cartas": con `has_status` solo se miraba la carta que lleva el
    // efecto, asi que la cosechadora exigia estar podrida ELLA para activarse.
    case 'status_in_hand': {
      const everyCard = [...world.scoredCards, ...world.hand];
      if (everyCard.some((c) => c.statuses.some((s) => s.type === cond.status))) return true;
      const uids = new Set(everyCard.map((c) => c.uid));
      return (world.pendingStatuses ?? []).some((p) => uids.has(p.uid) && p.status === cond.status);
    }
    // La carta DISPARADORA, no el dueño del efecto: es lo que piden las cartas
    // "cada carta de X jugada". Ver el comentario de `ConditionWorld.triggerCard`.
    case 'trigger_element_is':
      return world.triggerCard?.def.element === cond.value;
    case 'trigger_family_is':
      return world.triggerCard?.def.family === cond.value;
    case 'trigger_rarity_is':
      return world.triggerCard?.def.rarity === cond.value;
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
