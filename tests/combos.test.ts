/**
 * combos.test.ts — Combos de IDENTIDAD de FungiFlush.
 *
 * El juego se lee por ELEMENTO (multiplica Esporas), FAMILIA (suma Sustrato) y
 * DIVERSIDAD. El eje de POKER (par/trio/poker por rareza, escalera por sustrato
 * y full house) se retiro: le daba al juego un vocabulario de naipes que no es
 * el suyo y se sumaba a los combos de identidad, inflando el score.
 *
 * Este archivo reemplaza al viejo `pokerCombos.test.ts` y, ademas de cubrir lo
 * que SI existe, comprueba que los combos de poker NO reaparezcan.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { detectCombos } from '../src/engine/scoring/combos.ts';
import type { CardInstance, ElementType, FamilyType, Rarity } from '../src/engine/types.ts';

interface CardOpts {
  element?: ElementType;
  family?: FamilyType;
  rarity?: Rarity;
  substrate?: number;
}

let seq = 0;

function card(opts: CardOpts = {}): CardInstance {
  seq += 1;
  return {
    uid: `c${seq}`,
    def: {
      id: `test_${seq}`,
      nameKey: 'card.test.name',
      descKey: 'card.test.desc',
      art: { hue: 200, pattern: 'radial' },
      element: opts.element ?? 'spore',
      family: opts.family ?? 'agaricaceae',
      rarity: opts.rarity ?? 'common',
      baseSubstrate: opts.substrate ?? 1,
      baseSpores: 1,
      cost: 3,
    },
    level: 1,
    bonusSubstrate: 0,
    bonusSpores: 0,
    statuses: [],
  } as CardInstance;
}

const ids = (cards: CardInstance[]): string[] => detectCombos(cards).map((c) => c.id);

test('elemento: 2, 3, 4 y 5 cartas del mismo elemento suben el multiplicador', () => {
  const two = ids([card({ element: 'spore' }), card({ element: 'spore' })]);
  assert.ok(two.includes('element:spore:2'));

  const five = ids(Array.from({ length: 5 }, () => card({ element: 'crystal' })));
  assert.ok(five.includes('element:crystal:5'));
});

test('elemento: se queda con el tier MAS ALTO que la mano alcanza', () => {
  // 4 cartas del mismo elemento -> tier de 4, no el de 2 ni el de 3.
  const got = ids(Array.from({ length: 4 }, () => card({ element: 'poison' })));
  assert.ok(got.includes('element:poison:4'));
  assert.ok(!got.includes('element:poison:3'));
  assert.ok(!got.includes('element:poison:2'));
});

test('elemento: `neutral` no forma combo de elemento', () => {
  const got = ids(Array.from({ length: 3 }, () => card({ element: 'neutral' })));
  assert.ok(!got.some((id) => id.startsWith('element:')));
});

test('familia: 3, 4 y 5 cartas de la misma familia suman Sustrato', () => {
  const three = ids(Array.from({ length: 3 }, () => card({ family: 'tricholomataceae' })));
  assert.ok(three.includes('family:tricholomataceae:3'));

  const five = ids(Array.from({ length: 5 }, () => card({ family: 'boletaceae' })));
  assert.ok(five.includes('family:boletaceae:5'));
});

test('familia: el combo aporta Sustrato plano y NO multiplica Esporas', () => {
  const combo = detectCombos(Array.from({ length: 5 }, () => card({ family: 'boletaceae' }))).find(
    (c) => c.id === 'family:boletaceae:5',
  );
  assert.ok(combo);
  assert.equal(combo.sporeMultiplier, 1);
  assert.ok(combo.flatSubstrate > 0);
});

test('elemento: el combo multiplica Esporas y NO suma Sustrato plano', () => {
  const combo = detectCombos(Array.from({ length: 3 }, () => card({ element: 'symbiosis' }))).find(
    (c) => c.id === 'element:symbiosis:3',
  );
  assert.ok(combo);
  assert.equal(combo.flatSubstrate, 0);
  assert.ok(combo.sporeMultiplier > 1);
});

test('solapamiento: si Floracion y Colonia pegan juntas, el Sustrato de familia se reduce a la mitad', () => {
  // Caso base: mismo elemento y misma familia se solapan (el eje 1:1 del juego).
  const overlapping = detectCombos(
    Array.from({ length: 5 }, () => card({ element: 'spore', family: 'boletaceae' })),
  );
  const famOverlap = overlapping.find((c) => c.id === 'family:boletaceae:5');
  assert.ok(famOverlap);
  assert.ok(overlapping.some((c) => c.id.startsWith('element:')));
  assert.equal(famOverlap.flatSubstrate, 40);

  // Contraprueba: la misma familia de 5 cartas repartida en 5 elementos distintos
  // no activa Floracion, asi que conserva el Sustrato pleno.
  const spread = detectCombos(
    (['spore', 'mycelium', 'decay', 'crystal', 'symbiosis'] as const).map((element) =>
      card({ element, family: 'boletaceae' }),
    ),
  );
  const famSpread = spread.find((c) => c.id === 'family:boletaceae:5');
  assert.ok(famSpread);
  assert.ok(!spread.some((c) => c.id.startsWith('element:')));
  assert.equal(famSpread.flatSubstrate, 80);
});

test('diversidad: 5 elementos distintos dan el bonus', () => {
  const hand = [
    card({ element: 'spore' }),
    card({ element: 'mycelium' }),
    card({ element: 'decay' }),
    card({ element: 'crystal' }),
    card({ element: 'poison' }),
  ];
  assert.ok(ids(hand).includes('diversity:5'));
});

test('diversidad: 4 elementos distintos NO alcanzan', () => {
  const hand = [
    card({ element: 'spore' }),
    card({ element: 'mycelium' }),
    card({ element: 'decay' }),
    card({ element: 'crystal' }),
    card({ element: 'spore' }),
  ];
  assert.ok(!ids(hand).includes('diversity:5'));
});

test('los combos de POKER no existen: una mano de poker no da nada extra', () => {
  // Misma rareza (seria "par / trio / poker"), sustratos consecutivos (seria
  // "escalera") y 3 de un elemento + 2 de otro (seria "full house"). Nada de
  // eso debe producir un combo.
  const hand = [
    card({ rarity: 'common', element: 'spore', substrate: 3 }),
    card({ rarity: 'common', element: 'spore', substrate: 4 }),
    card({ rarity: 'common', element: 'spore', substrate: 5 }),
    card({ rarity: 'common', element: 'decay', substrate: 6 }),
    card({ rarity: 'common', element: 'decay', substrate: 7 }),
  ];
  const got = ids(hand);
  const pokerish = got.filter(
    (id) => id.startsWith('rarity:') || id.startsWith('straight:') || id.startsWith('fullhouse:'),
  );
  assert.deepEqual(pokerish, [], `no deberia haber combos de poker, pero hubo: ${pokerish.join(', ')}`);
});

test('una mano vacia no da combos', () => {
  assert.deepEqual(detectCombos([]), []);
});

test('cada combo reporta las cartas que participaron', () => {
  const hand = Array.from({ length: 3 }, () => card({ element: 'mycelium' }));
  const combo = detectCombos(hand).find((c) => c.id === 'element:mycelium:3');
  assert.ok(combo);
  assert.equal(combo.cardUids.length, 3);
  for (const uid of combo.cardUids) {
    assert.ok(hand.some((c) => c.uid === uid), 'el uid del combo tiene que salir de la mano');
  }
});
