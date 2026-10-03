/**
 * handSort.test.ts — Orden de la mano (Task 7: auto-orden persistente).
 *
 * El auto-orden reaplica el criterio elegido cada vez que cambia la mano. Eso
 * solo es correcto si `sortHand` es:
 *   - IDEMPOTENTE: ordenar una lista ya ordenada la deja igual (si no, el
 *     listener de `state:changed` reordenaria en bucle),
 *   - ESTABLE ante empates (si no, dos cartas iguales bailarian en cada mano),
 *   - PURA: no toca la mano original.
 *
 * Se usan cartas sinteticas: el criterio depende de element/family/substrate/
 * level/effects, no del contenido real.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { CardDefinition, CardInstance } from '../src/engine/types.ts';
import { SORT_MODES, sortHand, sortChangesOrder, type SortMode } from '../src/ui/handSort.ts';

let uidSeq = 0;
function card(opts: {
  element: CardDefinition['element'];
  family: CardDefinition['family'];
  substrate: number;
  spores?: number;
  level?: number;
  effects?: CardDefinition['effects'];
}): CardInstance {
  uidSeq += 1;
  const def: CardDefinition = {
    id: `t${uidSeq}`,
    nameKey: 'card.spore_puffball.name',
    descKey: 'card.spore_puffball.desc',
    element: opts.element,
    family: opts.family,
    rarity: 'common',
    baseSubstrate: opts.substrate,
    baseSpores: opts.spores ?? 1,
    cost: 1,
    art: { hue: 40, pattern: 'radial' },
    effects: opts.effects ?? [],
  };
  return { uid: `u${uidSeq}`, def, bonusSubstrate: 0, bonusSpores: 0, level: opts.level ?? 1, statuses: [] };
}

const sample = (): CardInstance[] => [
  card({ element: 'decay', family: 'agaricaceae', substrate: 5 }),
  card({ element: 'spore', family: 'tricholomataceae', substrate: 2, effects: [{ id: 'e', trigger: 'ON_PLAY', actions: [{ type: 'ADD_SPORES', value: 1 }] }] }),
  card({ element: 'spore', family: 'agaricaceae', substrate: 2 }),
  card({ element: 'crystal', family: 'agaricaceae', substrate: 9, spores: 3 }),
];

test('sortHand es PURA: no muta la mano original', () => {
  const hand = sample();
  const before = hand.map((c) => c.uid);
  for (const mode of SORT_MODES) sortHand(hand, mode);
  assert.deepEqual(hand.map((c) => c.uid), before, 'la mano original no cambia');
});

test('sortHand es IDEMPOTENTE en todos los criterios', () => {
  const hand = sample();
  for (const mode of SORT_MODES) {
    const once = sortHand(hand, mode).map((c) => c.uid);
    const twice = sortHand(sortHand(hand, mode), mode).map((c) => c.uid);
    assert.deepEqual(twice, once, `ordenar dos veces por ${mode} no cambia el resultado`);
  }
});

test("'default' devuelve el orden ORIGINAL, no una copia ordenada", () => {
  const hand = sample();
  assert.deepEqual(
    sortHand(hand, 'default').map((c) => c.uid),
    hand.map((c) => c.uid),
  );
});

test('los empates se desempatan de forma ESTABLE (mismo orden de origen)', () => {
  // Tres cartas identicas en todo lo que mira el orden: solo el indice decide.
  const hand = [
    card({ element: 'spore', family: 'agaricaceae', substrate: 3 }),
    card({ element: 'spore', family: 'agaricaceae', substrate: 3 }),
    card({ element: 'spore', family: 'agaricaceae', substrate: 3 }),
  ];
  const original = hand.map((c) => c.uid);
  for (const mode of SORT_MODES) {
    assert.deepEqual(
      sortHand(hand, mode).map((c) => c.uid),
      original,
      `con empates totales, ${mode} conserva el orden de origen`,
    );
  }
});

test('un criterio que no cambia el orden se reporta como tal', () => {
  const hand = [
    card({ element: 'spore', family: 'agaricaceae', substrate: 9 }),
    card({ element: 'decay', family: 'agaricaceae', substrate: 1 }),
  ];
  // 'value' ordena de mayor a menor: la de 9 ya esta primero.
  assert.equal(sortChangesOrder(hand, 'value'), false);
  // 'default' nunca cambia nada por definicion.
  assert.equal(sortChangesOrder(hand, 'default'), false);
});

/**
 * CONTRATO del criterio rotulado "Sustrato".
 *
 * Este test es el que faltaba: el modo se llamaba 'substrate' y su etiqueta en
 * la UI decia "Sustrato", pero el comparador agrupaba por ELEMENTO y nunca
 * miraba `baseSubstrate`. El orden resultante (6, 2, 3, 5, 4) parecia roto al
 * jugador. Lo que se afirma aca es lo que promete la etiqueta: el numero que se
 * lee en la carta —el sustrato— queda en orden ascendente.
 */
test("'substrate' ordena por sustrato base ASCENDENTE, no por elemento", () => {
  const hand = [
    card({ element: 'crystal', family: 'agaricaceae', substrate: 6 }),
    card({ element: 'spore', family: 'agaricaceae', substrate: 2 }),
    card({ element: 'decay', family: 'agaricaceae', substrate: 3 }),
    card({ element: 'poison', family: 'agaricaceae', substrate: 5 }),
    card({ element: 'mycelium', family: 'agaricaceae', substrate: 4 }),
  ];
  const ordered = sortHand(hand, 'substrate').map((c) => c.def.baseSubstrate);
  assert.deepEqual(ordered, [2, 3, 4, 5, 6], 'los sustratos salen de menor a mayor');
});

test("'substrate' usa el elemento y la familia solo como desempate", () => {
  // Mismo sustrato: el elemento decide (orden de ELEMENT_ORDER: spore < decay),
  // y dentro del mismo elemento, la familia.
  const hand = [
    card({ element: 'decay', family: 'agaricaceae', substrate: 4 }),
    card({ element: 'spore', family: 'tricholomataceae', substrate: 4 }),
    card({ element: 'spore', family: 'agaricaceae', substrate: 4 }),
  ];
  const ordered = sortHand(hand, 'substrate');
  assert.deepEqual(
    ordered.map((c) => c.def.element),
    ['spore', 'spore', 'decay'],
    'con el mismo sustrato, el elemento desempata',
  );
  assert.deepEqual(
    ordered.slice(0, 2).map((c) => c.def.family),
    ['agaricaceae', 'tricholomataceae'],
    'dentro del mismo elemento, la familia desempata',
  );
});

test("'family' desempata por sustrato base ascendente dentro de la familia", () => {
  const hand = [
    card({ element: 'decay', family: 'agaricaceae', substrate: 8 }),
    card({ element: 'spore', family: 'agaricaceae', substrate: 2 }),
    card({ element: 'crystal', family: 'boletaceae', substrate: 5 }),
  ];
  const ordered = sortHand(hand, 'family');
  assert.deepEqual(
    ordered.map((c) => c.def.baseSubstrate),
    [2, 8, 5],
    'la familia agrupa y el sustrato ordena dentro del grupo',
  );
});

test('el auto-orden reaplicado tras un robo deja la mano ordenada', () => {
  // Simula el ciclo: mano -> ordenar -> entra una carta nueva -> reordenar.
  const mode: SortMode = 'substrate';
  let hand = sample();
  hand = sortHand(hand, mode);
  // Entra una carta nueva al final (como hace el motor al robar).
  hand = [...hand, card({ element: 'mycelium', family: 'agaricaceae', substrate: 1 })];
  const reordered = sortHand(hand, mode);
  // El resultado es el mismo que ordenar la lista nueva desde cero (idempotente).
  assert.deepEqual(
    reordered.map((c) => c.uid),
    sortHand([...hand].sort(() => 0), mode).map((c) => c.uid),
  );
  // Y el sustrato mas chico quedo primero, no la carta nueva por accidente.
  assert.equal(reordered[0]?.def.baseSubstrate, 1);
  // La secuencia quedo monotona ascendente.
  for (let i = 1; i < reordered.length; i++) {
    assert.ok(
      (reordered[i - 1]?.def.baseSubstrate ?? 0) <= (reordered[i]?.def.baseSubstrate ?? 0),
      'la secuencia de sustratos es ascendente',
    );
  }
});
