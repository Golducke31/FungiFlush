/**
 * handSort.ts — Orden de la mano (P1.3 / P1.4 / P2.1).
 *
 * Modulo PURO: no toca el motor, no toca el DOM y no consume recursos. Recibe
 * la mano y devuelve una lista NUEVA con el mismo contenido en otro orden.
 *
 * Reglas de diseno del plan, que este modulo respeta:
 *   - Ordenar NO cambia las cartas ni consume recursos.
 *   - El orden automatico es OPCIONAL: nunca reorganiza la mano sin que el
 *     jugador lo pida. Por eso `sortHand(..., 'default')` devuelve el orden
 *     original intacto (el orden en que el motor entrego la mano).
 *   - Dentro de cada grupo el orden es ESTABLE (`Array.prototype.sort` en V8
 *     es estable desde ES2019, pero aca se ordena por indice explicito para no
 *     depender de esa garantia del runtime).
 *
 * El criterio 'recommended' (P2.1) no es magia: agrupa por Sustrato (que es lo
 * que multiplica) y dentro del grupo sube primero las cartas CON habilidad, que
 * son las que pueden disparar una cadena. Se ofrece como AYUDA, no como
 * decision automatica: el jugador sigue eligiendo.
 *
 * Orden de cada criterio (lo que el jugador ve tiene que coincidir con esto):
 *   family      -> Familia A-Z, desempate por Sustrato base.
 *   substrate   -> Sustrato base de MENOR a MAYOR, desempate por elemento y
 *                  familia. El sustrato es el numero que se lee en la carta.
 *   value       -> Valor en bruto de MAYOR a MENOR (sustrato + esporas + nivel).
 *   ability     -> Con habilidad primero; despues por valor.
 *   recommended -> Elemento (agrupa lo que multiplica), despues habilidad y
 *                  valor. Es el unico criterio "de ayuda", no un campo de carta.
 */

import type { CardInstance } from '@engine/index';

export type SortMode = 'default' | 'family' | 'substrate' | 'value' | 'ability' | 'recommended';

/** Orden en que se ofrecen los criterios en el menu (el plan pide este orden). */
export const SORT_MODES: SortMode[] = [
  'family',
  'substrate',
  'value',
  'ability',
  'recommended',
  'default',
];

/** Clave i18n de cada criterio, para el boton y la confirmacion. */
export const SORT_LABEL_KEY: Record<SortMode, string> = {
  default: 'sort.default',
  family: 'sort.family',
  substrate: 'sort.substrate',
  value: 'sort.value',
  ability: 'sort.ability',
  recommended: 'sort.recommended',
};

/** Peso de un sustrato para el orden "recomendado" (mayor = mas arriba). */
const ELEMENT_ORDER: string[] = [
  'spore',
  'mycelium',
  'symbiosis',
  'crystal',
  'decay',
  'poison',
  'parasite',
  'neutral',
];

function elementRank(element: string): number {
  const index = ELEMENT_ORDER.indexOf(element);
  return index < 0 ? ELEMENT_ORDER.length : index;
}

/** Una carta "puntua" por su sustrato base + esporas + nivel (valor en bruto). */
function rawValue(card: CardInstance): number {
  return card.def.baseSubstrate + card.def.baseSpores * 2 + (card.level ?? 0) * 5;
}

function hasAbility(card: CardInstance): boolean {
  return (card.def.effects?.length ?? 0) > 0;
}

/**
 * Devuelve la mano ordenada por `mode`.
 *
 * `default` devuelve una COPIA en el orden original. Nunca devuelve la misma
 * referencia: los llamadores suelen comparar para decidir si hubo cambio.
 */
export function sortHand(hand: readonly CardInstance[], mode: SortMode): CardInstance[] {
  const indexed = hand.map((card, index) => ({ card, index }));

  if (mode === 'default') {
    return indexed.sort((a, b) => a.index - b.index).map((entry) => entry.card);
  }

  indexed.sort((a, b) => {
    const primary = comparePrimary(a.card, b.card, mode);
    if (primary !== 0) return primary;
    // Desempate ESTABLE: el orden en que el motor entrego las cartas. Sin esto,
    // dos cartas iguales podrian bailar entre ordenamientos.
    return a.index - b.index;
  });

  return indexed.map((entry) => entry.card);
}

function comparePrimary(a: CardInstance, b: CardInstance, mode: SortMode): number {
  switch (mode) {
    case 'family':
      // Agrupa por Familia y, dentro del grupo, por sustrato base ascendente
      // para que las combinaciones del mismo sustrato queden juntas.
      return (
        a.def.family.localeCompare(b.def.family) ||
        a.def.baseSubstrate - b.def.baseSubstrate ||
        elementRank(a.def.element) - elementRank(b.def.element)
      );

    case 'substrate':
      // De MENOR a MAYOR sustrato base. Antes este caso comparaba por
      // `elementRank` y el sustrato numerico no entraba nunca en la cuenta: la
      // etiqueta decia "Sustrato" y el orden real era por elemento, asi que la
      // mano parecia desordenada (6, 2, 3, 5, 4). El elemento y la familia
      // quedan como desempate, no como criterio.
      return (
        a.def.baseSubstrate - b.def.baseSubstrate ||
        elementRank(a.def.element) - elementRank(b.def.element) ||
        a.def.family.localeCompare(b.def.family)
      );

    case 'value':
      // De mayor a menor valor en bruto: lo que mas aporta, primero.
      return rawValue(b) - rawValue(a);

    case 'ability':
      // Las cartas CON habilidad primero; despues, por valor.
      return Number(hasAbility(b)) - Number(hasAbility(a)) || rawValue(b) - rawValue(a);

    case 'recommended':
      // Elemento primero (agrupa lo que multiplica), luego habilidad y valor.
      return (
        elementRank(a.def.element) - elementRank(b.def.element) ||
        Number(hasAbility(b)) - Number(hasAbility(a)) ||
        rawValue(b) - rawValue(a)
      );

    default:
      return 0;
  }
}

/** ¿Este criterio puede cambiar el orden de esta mano? Se usa para no avisar de cambios inexistentes. */
export function sortChangesOrder(hand: readonly CardInstance[], mode: SortMode): boolean {
  const before = hand.map((c) => c.uid).join('|');
  const after = sortHand(hand, mode)
    .map((c) => c.uid)
    .join('|');
  return before !== after;
}
