/**
 * RunState.ts — Estado persistente de una partida (una "run").
 * Es lo unico que hace falta serializar para guardar la partida: el mazo, los
 * jokers, el dinero, el ante y el estado de efectos consumidos.
 */

import type { Deck } from '../cards/Deck';
import { ECONOMY, RUN_DEFAULTS } from '../constants';
import type { DieRoll, JokerInstance, ShopOffer, VoucherRunModifiers } from '../types';

export type GameStatus =
  | 'menu'
  | 'blind_select'
  | 'playing'
  | 'scoring'
  /** Draft de recompensa al ganar un blind, antes de la tienda. */
  | 'reward'
  | 'shop'
  | 'game_over'
  | 'victory';

export interface ShopState {
  offers: ShopOffer[];
  rerolls: number;
}

export interface RunState {
  seed: number;
  /** Ante actual (1..8). */
  ante: number;
  /** 0 = small blind, 1 = big blind, 2 = boss blind. */
  blindIndex: number;
  money: number;
  jokers: JokerInstance[];
  jokerSlots: number;
  /** Valores base del ante; los efectos los modifican durante la run. */
  baseHandSize: number;
  baseHands: number;
  baseDiscards: number;
  deck: Deck;
  /**
   * Tirada del dado multiplicador del blind en curso. `null` en el menu y en
   * los estados que no son una ronda. Se tira al ELEGIR el ciego.
   */
  die: DieRoll | null;
  /** Cuantas veces se volvio a tirar el dado en el ciego actual (sube el coste). */
  dieRerolls: number;
  status: GameStatus;
  /** Efectos "once: per_run" ya consumidos. */
  consumedEffects: Set<string>;
  /**
   * Vouchers comprados en esta run (ids). Son MODIFICADORES, no contenido: no
   * ocupan slot ni entran al mazo. Se serializan con el guardado porque una run
   * retomada tiene que seguir con las mismas reglas.
   */
  vouchers: string[];
  shop: ShopState | null;
  /** Estadisticas para la pantalla final. */
  stats: {
    handsPlayed: number;
    bestHand: number;
    blindsCleared: number;
    cardsDestroyed: number;
    /** Mejoras aplicadas (Fase 3: cultivo ilimitado). */
    cardsUpgraded: number;
    /** Cartas que evolucionaron a otra especie. */
    cardsEvolved: number;
  };
}

export function createRunState(seed: number, deck: Deck): RunState {
  return {
    seed,
    ante: RUN_DEFAULTS.ante,
    blindIndex: 0,
    money: RUN_DEFAULTS.money,
    jokers: [],
    jokerSlots: RUN_DEFAULTS.jokerSlots,
    baseHandSize: RUN_DEFAULTS.handSize,
    baseHands: RUN_DEFAULTS.hands,
    baseDiscards: RUN_DEFAULTS.discards,
    deck,
    die: null,
    dieRerolls: 0,
    status: 'blind_select',
    consumedEffects: new Set<string>(),
    vouchers: [],
    shop: null,
    stats: {
      handsPlayed: 0,
      bestHand: 0,
      blindsCleared: 0,
      cardsDestroyed: 0,
      cardsUpgraded: 0,
      cardsEvolved: 0,
    },
  };
}

/** Coste del proximo reroll en tienda (escala con el uso). */
export function rerollCost(shop: ShopState, modifiers?: VoucherRunModifiers): number {
  const delta = modifiers?.rerollCostDelta ?? 0;
  return Math.max(0, ECONOMY.rerollBaseCost + shop.rerolls * ECONOMY.rerollCostStep + delta);
}

/**
 * Suma los modificadores de un conjunto de vouchers.
 *
 * Se suman en vez de "gana el ultimo" para que dos vouchers que tocan lo mismo
 * compongan: dos descuentos de reroll son un descuento doble, no una moneda al
 * aire. Los multiplicadores SI se multiplican entre ellos, porque "10% menos" y
 * "10% menos" tiene que dar 19%, no 20%.
 */
export function combineModifiers(
  defs: readonly { runModifiers?: VoucherRunModifiers }[],
): VoucherRunModifiers {
  const out: VoucherRunModifiers = {
    rerollCostDelta: 0,
    targetMultiplier: 1,
    extraJokerSlots: 0,
    extraHands: 0,
    extraDiscards: 0,
    extraHandSize: 0,
    extraMoney: 0,
    shopDiscount: 0,
  };

  for (const def of defs) {
    const m = def.runModifiers;
    if (!m) continue;
    out.rerollCostDelta = (out.rerollCostDelta ?? 0) + (m.rerollCostDelta ?? 0);
    out.targetMultiplier = (out.targetMultiplier ?? 1) * (m.targetMultiplier ?? 1);
    out.extraJokerSlots = (out.extraJokerSlots ?? 0) + (m.extraJokerSlots ?? 0);
    out.extraHands = (out.extraHands ?? 0) + (m.extraHands ?? 0);
    out.extraDiscards = (out.extraDiscards ?? 0) + (m.extraDiscards ?? 0);
    out.extraHandSize = (out.extraHandSize ?? 0) + (m.extraHandSize ?? 0);
    out.extraMoney = (out.extraMoney ?? 0) + (m.extraMoney ?? 0);
    // Los descuentos se combinan como "lo que queda por pagar": dos del 20%
    // dejan pagando el 64%, no el 60%.
    out.shopDiscount = 1 - (1 - (out.shopDiscount ?? 0)) * (1 - (m.shopDiscount ?? 0));
  }

  // Clampeo: un voucher no puede volver el juego imposible (objetivo 0) ni
  // gratis (multiplicador 0 o negativo).
  out.targetMultiplier = Math.min(2, Math.max(0.25, out.targetMultiplier ?? 1));
  out.shopDiscount = Math.min(0.9, Math.max(0, out.shopDiscount ?? 0));
  return out;
}

/** Precio final de una oferta tras los descuentos de vouchers. */
export function discountedCost(cost: number, modifiers?: VoucherRunModifiers): number {
  const discount = modifiers?.shopDiscount ?? 0;
  if (discount <= 0) return cost;
  return Math.max(0, Math.round(cost * (1 - discount)));
}

export function jokerSellValue(joker: JokerInstance): number {
  return Math.max(1, Math.floor(joker.def.sellValue || joker.def.cost * ECONOMY.jokerSellRatio));
}
