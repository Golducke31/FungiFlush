/**
 * combos.ts — Reglas de combinacion de la mano.
 *
 * Estas son reglas del JUEGO, no efectos de cartas: se evaluan siempre, para
 * todos los jugadores, y son la base del scoring. Viven en codigo (no en JSON)
 * porque cambian el balance global, no el contenido.
 *
 * Los combos son de IDENTIDAD micelial:
 *
 *   - ELEMENTO: N cartas del mismo elemento -> multiplicador de Esporas
 *     (Floracion Doble / Triple / Cuadruple / Eclosion Total).
 *   - FAMILIA: N cartas de la misma familia -> Sustrato plano (Colonia).
 *   - DIVERSIDAD: 5 elementos distintos en la misma mano -> Sustrato plano.
 *
 * Se descarto el eje de POKER (2026-10 duro poco): par / trio / poker de
 * especies por rareza, escalera por sustrato y full house. Le daba al juego un
 * vocabulario de naipes que no es el suyo —un hongo no forma "full house"— y,
 * como se SUMABA a los combos de elemento y familia, una mano corriente apilaba
 * cuatro multiplicadores a la vez sin haber construido nada. FungiFlush se lee
 * por ELEMENTO y FAMILIA, no por naipe.
 *
 * El mejor combo de cada eje se conserva (no se acumulan dos del mismo eje).
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
  /**
   * Solo en combos de FAMILIA: la penalizacion de solapamiento se aplico (la
   * familia entera pertenecia a un elemento que ya formo Floracion, asi que las
   * MISMAS cartas hicieron doble trabajo). Lo consumen el desglose y el tutorial
   * para explicar por que el Sustrato de la Colonia vino a la mitad.
   */
  overlapped?: boolean;
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
  { cards: 5, flat: 100, key: 'combo.family.5' },
  { cards: 4, flat: 50, key: 'combo.family.4' },
  { cards: 3, flat: 20, key: 'combo.family.3' },
];

/** Bonus por jugar 5 elementos distintos en la misma mano. */
const DIVERSITY_BONUS = { flat: 25, key: 'combo.diversity' } as const;

/**
 * Rendimiento decreciente por SOLAPAMIENTO de ejes.
 *
 * Una mano puede activar Floracion (elemento) y Colonia (familia) con LAS
 * MISMAS cartas fisicas — pasa siempre que el elemento y la familia vayan 1:1.
 * Si parte de la familia pega tambien en la Floracion, el Sustrato plano de la
 * familia se reduce de forma PROPORCIONAL al solapamiento: una familia que
 * reparte elementos cobra entero, una que los solapa paga.
 *
 * El factor es el piso (solapamiento TOTAL): `flat * OVERLAP_FAMILY_FACTOR`.
 * Con los tiers de arriba (100/50/20) y 0.4, el solapamiento total deja el
 * mismo valor que antes (100*0.4 = 80*0.5 = 40), asi que CRUZAR ejes paga +25%
 * sin abaratar la jugada perezosa. El bonus de diversidad NO se toca: ese si
 * premia lo opuesto (no solapar).
 */
const OVERLAP_FAMILY_FACTOR = 0.4;

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
 * Detecta todos los combos de una mano: elemento, familia y diversidad.
 *
 * Devuelve SOLO el mejor combo por elemento y por familia (no se acumulan dos
 * combos del mismo eje), para que armar la mano sea una decision legible y el
 * techo de score no explote.
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
  const hasElementCombo = results.length > 0;
  const comboElements = new Set(
    results.filter((r) => r.id.startsWith('element:')).map((r) => r.id.split(':')[1]),
  );

  // --- Combos por familia ---
  const byFamily = groupBy(cards, (c) => c.def.family);
  for (const [family, group] of byFamily) {
    const tier = FAMILY_TIERS.find((t) => group.length >= t.cards);
    if (!tier) continue;
    // Penalizacion ESCALADA por ratio: cuantas de las cartas que califican
    // pertenecen a un elemento que YA formo Floracion (mismas cartas fisicas
    // haciendo doble trabajo). Antes era todo-o-nada (`every`): o pagaba la
    // mitad o nada. Con ratio, una familia que reparte elementos cobra
    // proporcionalmente, asi "cruzar ejes" deja de ser binario.
    const qualifying = group.slice(0, tier.cards);
    const overlapping = hasElementCombo
      ? qualifying.filter((c) => comboElements.has(c.def.element)).length
      : 0;
    const overlapRatio = qualifying.length > 0 ? overlapping / qualifying.length : 0;
    const overlapsElement = overlapRatio > 0;
    results.push({
      id: `family:${family}:${tier.cards}`,
      nameKey: tier.key,
      cardUids: qualifying.map((c) => c.uid),
      flatSubstrate: Math.round(
        tier.flat * (1 - (1 - OVERLAP_FAMILY_FACTOR) * overlapRatio),
      ),
      sporeMultiplier: 1,
      overlapped: overlapsElement,
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
