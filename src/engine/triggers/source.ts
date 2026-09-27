/**
 * source.ts — Quien puede reaccionar a un evento.
 *
 * Unificamos cartas jugadas, cartas en mano, jokers y blinds bajo una misma
 * forma. Asi el Trigger Engine tiene UN solo bucle de resolucion en lugar de
 * cuatro ramas casi identicas (que es donde nacen los bugs de combo).
 */

import type { CardInstance, EffectDefinition, JokerInstance } from '../types';

export type SourceKind = 'joker' | 'card' | 'blind';

export interface EffectSource {
  uid: string;
  nameKey: string;
  kind: SourceKind;
  card?: CardInstance;
  joker?: JokerInstance;
  effects: readonly EffectDefinition[];
  /** Orden de resolucion: menor = antes. */
  order: number;
}

export function sourceFromJoker(joker: JokerInstance, order: number): EffectSource {
  return {
    uid: joker.uid,
    nameKey: joker.def.nameKey,
    kind: 'joker',
    joker,
    effects: joker.def.effects,
    order,
  };
}

export function sourceFromCard(card: CardInstance, order: number): EffectSource {
  return {
    uid: card.uid,
    nameKey: card.def.nameKey,
    kind: 'card',
    card,
    effects: card.def.effects ?? [],
    order,
  };
}

/** Una carta "dormant" no dispara nada: se filtra aca, en un solo lugar. */
export function isDormant(card: CardInstance): boolean {
  return card.statuses.some((s) => s.type === 'dormant');
}

export function hasStatus(card: CardInstance, status: string): boolean {
  return card.statuses.some((s) => s.type === status);
}

export function statusValue(card: CardInstance, status: string): number {
  return card.statuses.find((s) => s.type === status)?.value ?? 0;
}
