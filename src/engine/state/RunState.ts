/**
 * RunState.ts — Estado persistente de una partida (una "run").
 * Es lo unico que hace falta serializar para guardar la partida: el mazo, los
 * jokers, el dinero, el ante y el estado de efectos consumidos.
 */

import type { Deck } from '../cards/Deck';
import { ECONOMY, RUN_DEFAULTS } from '../constants';
import type { DieRoll, JokerInstance, ShopOffer } from '../types';

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
export function rerollCost(shop: ShopState): number {
  return ECONOMY.rerollBaseCost + shop.rerolls * ECONOMY.rerollCostStep;
}

export function jokerSellValue(joker: JokerInstance): number {
  return Math.max(1, Math.floor(joker.def.sellValue || joker.def.cost * ECONOMY.jokerSellRatio));
}
