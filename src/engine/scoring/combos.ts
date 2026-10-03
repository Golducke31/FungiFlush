/**
 * combos.ts — Reglas de combinacion de la mano.
 *
 * Estas son reglas del JUEGO, no efectos de cartas: se evaluan siempre, para
 * todos los jugadores, y son la base del scoring. Viven en codigo (no en JSON)
 * porque cambian el balance global, no el contenido.
 *
 * Hay DOS familias de combos:
 *
 * 1. COLECCION (los de siempre): N cartas del mismo elemento (multiplicador de
 *    Esporas), N de la misma familia (Substrate plano) y 5 elementos distintos
 *    (bonus de diversidad).
 *
 * 2. POKER (2026-10): la mano se lee tambien como una mano de poker, mapeando
 *    las propiedades de las cartas a las del naipe:
 *      - RAREZA  -> el "valor" de la carta (common < uncommon < ... < mythic).
 *        Un PAR / TRIO / POKER son 2/3/4 cartas del mismo valor.
 *      - SUSTRATO base -> el "palo" no, pero si el ORDEN: una ESCALERA es una
 *        secuencia de sustratos consecutivos, como 3-4-5.
 *      - ELEMENTO -> el palo: un "color" es N cartas del mismo elemento, que ya
 *        cubre `combo.element`; el FULL HOUSE es 3 de un elemento + 2 de otro.
 *    Se evaluan aparte y se SUMAN a los de coleccion, igual que en el poker una
 *    mano puede tener escalera y color a la vez.
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

// ---------------------------------------------------------------------------
// POKER — mapeo de las propiedades de las cartas al naipe
// ---------------------------------------------------------------------------

/** PAR / TRIO / POKER: 2/3/4 cartas del mismo valor (rareza). */
const RARITY_TIERS: readonly { cards: number; flat: number; mult: number; key: string }[] = [
  { cards: 4, flat: 40, mult: 1.4, key: 'combo.rarity.4' }, // poker
  { cards: 3, flat: 20, mult: 1.25, key: 'combo.rarity.3' }, // trio
  { cards: 2, flat: 8, mult: 1.1, key: 'combo.rarity.2' }, // par
];

/**
 * ESCALERA: N cartas con sustratos base CONSECUTIVOS (3-4-5), sin repetir.
 * Se mira el `baseSubstrate` como el "numero" de la carta. Para no castigar
 * valores grandes, se premia por LARGO de la corrida, no por su altura.
 */
const STRAIGHT_TIERS: readonly { cards: number; flat: number; mult: number; key: string }[] = [
  { cards: 5, flat: 55, mult: 1.3, key: 'combo.straight.5' },
  { cards: 4, flat: 28, mult: 1.2, key: 'combo.straight.4' },
  { cards: 3, flat: 12, mult: 1.1, key: 'combo.straight.3' },
];

/** FULL HOUSE: 3 cartas de un elemento + 2 de otro. Mano fuerte de poker. */
const FULL_HOUSE = { flat: 45, mult: 1.6, key: 'combo.fullhouse' } as const;

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

  // --- POKER: PAR / TRIO / POKER (misma rareza) ---
  const byRarity = groupBy(cards, (c) => c.def.rarity);
  for (const [rarity, group] of byRarity) {
    const tier = RARITY_TIERS.find((t) => group.length >= t.cards);
    if (!tier) continue;
    results.push({
      id: `rarity:${rarity}:${tier.cards}`,
      nameKey: tier.key,
      cardUids: group.slice(0, tier.cards).map((c) => c.uid),
      flatSubstrate: tier.flat,
      sporeMultiplier: tier.mult,
    });
  }

  // --- POKER: ESCALERA (sustratos base consecutivos) ---
  const straight = detectStraight(cards);
  if (straight) results.push(straight);

  // --- POKER: FULL HOUSE (3 de un elemento + 2 de otro) ---
  const fullHouse = detectFullHouse(cards);
  if (fullHouse) results.push(fullHouse);

  return results;
}

/**
 * Escalera: la corrida MAS LARGA de sustratos base consecutivos, sin repetir.
 * Devuelve `null` si no llega a 3 cartas (el minimo de una escalera jugable).
 */
function detectStraight(cards: readonly CardInstance[]): ComboResult | null {
  if (cards.length < 3) return null;

  // Un mapa sustrato -> primera carta con ese sustrato. Sin repetidos: una
  // escalera de poker no repite numero.
  const bySubstrate = new Map<number, CardInstance>();
  for (const card of cards) {
    const value = card.def.baseSubstrate;
    if (!bySubstrate.has(value)) bySubstrate.set(value, card);
  }
  if (bySubstrate.size < 3) return null;

  const values = [...bySubstrate.keys()].sort((a, b) => a - b);

  // Recorre buscando la corrida mas larga de valores consecutivos.
  let bestStart = 0;
  let bestLen = 1;
  let runStart = 0;
  for (let i = 1; i < values.length; i += 1) {
    if (values[i] === (values[i - 1] ?? 0) + 1) {
      const len = i - runStart + 1;
      if (len > bestLen) {
        bestLen = len;
        bestStart = runStart;
      }
    } else {
      runStart = i;
    }
  }

  const tier = STRAIGHT_TIERS.find((t) => bestLen >= t.cards);
  if (!tier) return null;

  const runValues = values.slice(bestStart, bestStart + tier.cards);
  const runCards = runValues
    .map((v) => bySubstrate.get(v))
    .filter((c): c is CardInstance => c !== undefined);

  return {
    id: `straight:${tier.cards}`,
    nameKey: tier.key,
    cardUids: runCards.map((c) => c.uid),
    flatSubstrate: tier.flat,
    sporeMultiplier: tier.mult,
  };
}

/**
 * Full house: 3 cartas de un elemento + 2 de OTRO elemento (los elementos deben
 * ser distintos; un "trio + par" del mismo elemento ya lo cubre el combo de
 * elemento). Se elige el trio de mayor tamano y luego el par de mayor tamano.
 */
function detectFullHouse(cards: readonly CardInstance[]): ComboResult | null {
  if (cards.length < 5) return null;

  const byElement = groupBy(cards, (c) => c.def.element);
  // Solo elementos con al menos 3 cartas pueden ser el "trio".
  const trios = [...byElement.entries()]
    .filter(([element, group]) => element !== 'neutral' && group.length >= 3)
    .sort((a, b) => b[1].length - a[1].length);
  if (trios.length === 0) return null;

  for (const [trioElement, trioGroup] of trios) {
    // El par tiene que ser de OTRO elemento (un full house real mezcla palos).
    const pair = [...byElement.entries()]
      .filter(([element, group]) => element !== trioElement && element !== 'neutral' && group.length >= 2)
      .sort((a, b) => b[1].length - a[1].length)[0];
    if (!pair) continue;

    const trioCards = trioGroup.slice(0, 3);
    const pairCards = pair[1].slice(0, 2);
    return {
      id: `fullhouse:${trioElement}`,
      nameKey: FULL_HOUSE.key,
      cardUids: [...trioCards, ...pairCards].map((c) => c.uid),
      flatSubstrate: FULL_HOUSE.flat,
      sporeMultiplier: FULL_HOUSE.mult,
    };
  }

  return null;
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
