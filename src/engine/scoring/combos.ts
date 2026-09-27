/**
 * combos.ts — Reglas de combinacion de la mano.
 *
 * Estas son reglas del JUEGO, no efectos de cartas: se evaluan siempre, para
 * todos los jugadores, y son la base del scoring. Viven en codigo (no en JSON)
 * porque cambian el balance global, no el contenido.
 *
 * El jugador que juega 3+ cartas del mismo elemento obtiene un multiplicador
 * de Spores; 3+ de la misma familia da Substrate plano; 5 elementos distintos
 * da un bonus de diversidad.
 */

import type { CardInstance, ElementType, FamilyType } from '../types';

export interface ComboResult {
  id: string;
  nameKey: string;
  /** Cartas que participaron del combo (para el resaltado visual). */
  cardUids: string[];
  /** Suma plana al Substrate. */
  flatSubstrate: number;
  /** Multiplicador de Spores. */
  sporeMultiplier: number;
}

interface ElementComboTier {
  cards: number;
  multiplier: number;
  key: string;
}

const ELEMENT_TIERS: readonly ElementComboTier[] = [
  { cards: 5, multiplier: 3.0, key: 'combo.element.5' },
  { cards: 4, multiplier: 2.2, key: 'combo.element.4' },
  { cards: 3, multiplier: 1.6, key: 'combo.element.3' },
  { cards: 2, multiplier: 1.25, key: 'combo.element.2' },
];

const FAMILY_TIERS: readonly { cards: number; flat: number; key: string }[] = [
  { cards: 5, flat: 60, key: 'combo.family.5' },
  { cards: 4, flat: 30, key: 'combo.family.4' },
  { cards: 3, flat: 12, key: 'combo.family.3' },
];

/** Bonus por jugar 5 elementos distintos en la misma mano. */
const DIVERSITY_BONUS = { flat: 25, key: 'combo.diversity' } as const;

function groupBy<K extends string>(
  cards: readonly CardInstance[],
  key: (c: CardInstance) => K,
): Map<K, CardInstance[]> {
  const map = new Map<K, CardInstance[]>();
  for (const card of cards) {
    const k = key(card);
    const list = map.get(k);
    if (list) list.push(card);
    else map.set(k, [card]);
  }
  return map;
}

/**
 * Detecta todos los combos de una mano.
 * Devuelve SOLO el mejor combo por elemento y por familia (no se acumulan
 * dos combos del mismo eje, para evitar explosiones de score).
 */
export function detectCombos(cards: readonly CardInstance[]): ComboResult[] {
  const results: ComboResult[] = [];
  if (cards.length === 0) return results;

  // --- Combos por elemento ---
  const byElement = groupBy(cards, (c) => c.def.element);
  for (const [element, group] of byElement) {
    if (element === 'neutral') continue;
    const tier = ELEMENT_TIERS.find((t) => group.length >= t.cards);
    if (!tier) continue;
    results.push({
      id: `element:${element}:${tier.cards}`,
      nameKey: tier.key,
      cardUids: group.slice(0, tier.cards).map((c) => c.uid),
      flatSubstrate: 0,
      sporeMultiplier: tier.multiplier,
    });
  }

  // --- Combos por familia ---
  const byFamily = groupBy(cards, (c) => c.def.family);
  for (const [family, group] of byFamily) {
    const tier = FAMILY_TIERS.find((t) => group.length >= t.cards);
    if (!tier) continue;
    results.push({
      id: `family:${family}:${tier.cards}`,
      nameKey: tier.key,
      cardUids: group.slice(0, tier.cards).map((c) => c.uid),
      flatSubstrate: tier.flat,
      sporeMultiplier: 1,
    });
  }

  // --- Bonus de diversidad: 5 cartas, 5 elementos distintos ---
  const distinctElements = new Set(
    cards.filter((c) => c.def.element !== 'neutral').map((c) => c.def.element),
  );
  if (cards.length >= 5 && distinctElements.size >= 5) {
    results.push({
      id: 'diversity:5',
      nameKey: DIVERSITY_BONUS.key,
      cardUids: cards.slice(0, 5).map((c) => c.uid),
      flatSubstrate: DIVERSITY_BONUS.flat,
      sporeMultiplier: 1,
    });
  }

  return results;
}

/** Resumen para tooltips: que elementos y familias hay en la mano. */
export function handComposition(cards: readonly CardInstance[]): {
  elements: Partial<Record<ElementType, number>>;
  families: Partial<Record<FamilyType, number>>;
} {
  const elements: Partial<Record<ElementType, number>> = {};
  const families: Partial<Record<FamilyType, number>> = {};
  for (const c of cards) {
    elements[c.def.element] = (elements[c.def.element] ?? 0) + 1;
    families[c.def.family] = (families[c.def.family] ?? 0) + 1;
  }
  return { elements, families };
}
