/**
 * orderBonus.test.ts — Bonus por el ORDEN de juego.
 *
 * Lo que se protege aca:
 *   - la Escalera exige 3+ cartas y crecimiento ESTRICTO (empates no cuentan),
 *   - la Corona exige cerrar con la carta mas fuerte,
 *   - las dos pueden convivir, porque son reglas distintas.
 *
 * Son las reglas que hacen que acomodar la mano sea una decision. Si el dia de
 * manana alguien cambia el minimo de cartas o el valor, este test se lo dice.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { CardRegistry } from '../src/engine/cards/CardRegistry.ts';
import { detectOrderBonuses } from '../src/engine/scoring/orderBonus.ts';
import { buildRegistry } from '../tools/loadContent.node.ts';

// Se arma sobre el contenido real (no un fixture): si un pack cambia el
// sustrato base de las cartas, el test sigue valiendo.
const registry = new CardRegistry();
registry.load(buildRegistry().toBundle());
const FIRST_CARD = registry.allCards()[0]?.id ?? 'spore_puffball';

/**
 * Una carta con `extra` de sustrato ENCIMA de su base.
 *
 * Se suma en vez de fijar el valor absoluto: con `extra` negativo se podria
 * clavar un sustrato efectivo menor que la base de la carta, y eso no es un
 * estado que el juego pueda producir. Sumando, el orden relativo queda
 * determinado por `extra` y la base no importa.
 */
function cardWith(extra: number): ReturnType<typeof registry.instantiate> {
  const card = registry.instantiate(FIRST_CARD);
  card.bonusSubstrate = extra;
  return card;
}

function ids(bonuses: ReturnType<typeof detectOrderBonuses>): string[] {
  return bonuses.map((bonus) => bonus.id).sort();
}

test('la Escalera premia el sustrato estrictamente creciente, y solo con 3+ cartas', () => {
  assert.deepEqual(ids(detectOrderBonuses([cardWith(2), cardWith(5), cardWith(9)])), ['crown', 'ladder']);

  // Con 2 cartas no hay secuencia que premiar.
  assert.deepEqual(ids(detectOrderBonuses([cardWith(2), cardWith(5)])), []);

  // Empate: no es creciente, asi que NO hay escalera. Ojo que si hay corona
  // (la ultima sigue siendo la mayor): son reglas independientes y las dos
  // pueden no darse a la vez.
  assert.ok(!ids(detectOrderBonuses([cardWith(2), cardWith(2), cardWith(9)])).includes('ladder'));

  // El valor es el fijo, no escala con la cantidad de cartas: el nameKey es una
  // clave i18n estatica y no podria traducir un valor dinamico.
  const ladder = detectOrderBonuses([cardWith(2), cardWith(5), cardWith(9)]).find((b) => b.id === 'ladder');
  assert.equal(ladder?.flatSubstrate, 18);
  assert.equal(ladder?.sporeMultiplier, 1);
});

test('la Corona premia cerrar con la carta mas fuerte', () => {
  assert.ok(ids(detectOrderBonuses([cardWith(1), cardWith(5), cardWith(9)])).includes('crown'));

  // La mas fuerte NO va al final: no hay corona, aunque haya escalera.
  const bad = detectOrderBonuses([cardWith(3), cardWith(5), cardWith(9)]);
  assert.ok(ids(bad).includes('ladder'));

  // Y si la ultima no es la maxima, tampoco.
  assert.ok(!ids(detectOrderBonuses([cardWith(9), cardWith(5), cardWith(1)])).includes('crown'));
});

test('una mano sin orden no da ningun bonus', () => {
  assert.deepEqual(ids(detectOrderBonuses([cardWith(9), cardWith(2), cardWith(5)])), []);
});

test('el bonus marca todas las cartas participantes para el resaltado', () => {
  const hand = [cardWith(1), cardWith(5), cardWith(9)];
  for (const bonus of detectOrderBonuses(hand)) {
    assert.deepEqual(bonus.cardUids, hand.map((card) => card.uid));
  }
});
