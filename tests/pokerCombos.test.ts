/**
 * pokerCombos.test.ts — Combos de la mano leida como mano de POKER.
 *
 * Lo que se protege aca:
 *   - PAR / TRIO / POKER se forman con copias de la MISMA rareza (el "valor").
 *   - ESCALERA exige sustratos base CONSECUTIVOS y sin repetir, 3 cartas minimo.
 *   - FULL HOUSE exige 3 de un elemento + 2 de OTRO (nunca el mismo).
 *   - Los combos de poker CONVIVEN con los de coleccion (se suman, no se pisan).
 *
 * Se arma sobre definiciones fabricadas a mano (no sobre el contenido real):
 * las cartas reales tienen una distribucion de rarezas que depende del pack y
 * un test sobre ellas se romperia cada vez que alguien agregue una carta.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { CardDefinition, CardInstance, ElementType, Rarity } from '../src/engine/types.ts';
import { detectCombos } from '../src/engine/scoring/combos.ts';

let uidSeq = 0;

/** Carta sintetica: solo importan rareza, elemento y sustrato base. */
function card(opts: {
  rarity: Rarity;
  element: ElementType;
  substrate: number;
  family?: CardDefinition['family'];
}): CardInstance {
  uidSeq += 1;
  const def: CardDefinition = {
    id: `test_${uidSeq}`,
    nameKey: 'card.spore_puffball.name',
    descKey: 'card.spore_puffball.desc',
    element: opts.element,
    family: opts.family ?? 'agaricaceae',
    rarity: opts.rarity,
    baseSubstrate: opts.substrate,
    baseSpores: 1,
    cost: 1,
    art: { hue: 40, pattern: 'radial' },
  };
  return { uid: `t${uidSeq}`, def, bonusSubstrate: 0, bonusSpores: 0, level: 1, statuses: [] };
}

const ids = (cards: readonly CardInstance[]) => detectCombos(cards).map((c) => c.id);

test('par / trio / poker: 2, 3 y 4 cartas de la MISMA rareza', () => {
  // Par de comunes.
  const pair = [card({ rarity: 'common', element: 'spore', substrate: 1 }), card({ rarity: 'common', element: 'decay', substrate: 5 })];
  assert.ok(ids(pair).includes('rarity:common:2'));

  // Trio de raras.
  const trio = [
    card({ rarity: 'rare', element: 'spore', substrate: 1 }),
    card({ rarity: 'rare', element: 'decay', substrate: 5 }),
    card({ rarity: 'rare', element: 'crystal', substrate: 9 }),
  ];
  assert.ok(ids(trio).includes('rarity:rare:3'));

  // Poker de no-comunes.
  const poker = [
    card({ rarity: 'uncommon', element: 'spore', substrate: 1 }),
    card({ rarity: 'uncommon', element: 'decay', substrate: 5 }),
    card({ rarity: 'uncommon', element: 'crystal', substrate: 9 }),
    card({ rarity: 'uncommon', element: 'poison', substrate: 13 }),
  ];
  assert.ok(ids(poker).includes('rarity:uncommon:4'));
});

test('una sola carta no forma par', () => {
  assert.equal(ids([card({ rarity: 'mythic', element: 'spore', substrate: 1 })]).filter((id) => id.startsWith('rarity:')).length, 0);
});

test('escalera: sustratos base consecutivos, sin repetir', () => {
  const straight3 = [
    card({ rarity: 'common', element: 'spore', substrate: 3 }),
    card({ rarity: 'uncommon', element: 'decay', substrate: 4 }),
    card({ rarity: 'rare', element: 'crystal', substrate: 5 }),
  ];
  assert.ok(ids(straight3).includes('straight:3'));

  // El largo manda: 5 consecutivos gana la escalera de 5.
  const straight5 = [1, 2, 3, 4, 5].map((n) => card({ rarity: 'common', element: 'spore', substrate: n }));
  assert.ok(ids(straight5).includes('straight:5'));

  // Un hueco corta la corrida: 2,3,4,9 -> escalera de 3.
  const gapped = [2, 3, 4, 9].map((n) => card({ rarity: 'common', element: 'spore', substrate: n }));
  assert.ok(ids(gapped).includes('straight:3'));
  assert.ok(!ids(gapped).includes('straight:4'));

  // Sustratos repetidos no forman escalera (un naipe no repite numero).
  const dup = [
    card({ rarity: 'common', element: 'spore', substrate: 4 }),
    card({ rarity: 'common', element: 'decay', substrate: 4 }),
    card({ rarity: 'common', element: 'crystal', substrate: 5 }),
  ];
  assert.ok(!ids(dup).some((id) => id.startsWith('straight:')));
});

test('full house: 3 de un elemento + 2 de OTRO', () => {
  const fh = [
    card({ rarity: 'common', element: 'spore', substrate: 1 }),
    card({ rarity: 'common', element: 'spore', substrate: 2 }),
    card({ rarity: 'uncommon', element: 'spore', substrate: 3 }),
    card({ rarity: 'rare', element: 'decay', substrate: 5 }),
    card({ rarity: 'rare', element: 'decay', substrate: 6 }),
  ];
  assert.ok(ids(fh).includes('fullhouse:spore'));

  // 3+2 del MISMO elemento NO es full house (lo cubre el combo de elemento).
  const mono = [
    card({ rarity: 'common', element: 'spore', substrate: 1 }),
    card({ rarity: 'common', element: 'spore', substrate: 2 }),
    card({ rarity: 'uncommon', element: 'spore', substrate: 3 }),
    card({ rarity: 'rare', element: 'spore', substrate: 5 }),
    card({ rarity: 'rare', element: 'spore', substrate: 6 }),
  ];
  assert.ok(!ids(mono).some((id) => id.startsWith('fullhouse:')));
});

test('los combos de poker marcan sus cartas para el resaltado', () => {
  const trio = [
    card({ rarity: 'rare', element: 'spore', substrate: 1 }),
    card({ rarity: 'rare', element: 'decay', substrate: 5 }),
    card({ rarity: 'rare', element: 'crystal', substrate: 9 }),
    card({ rarity: 'common', element: 'poison', substrate: 20 }),
  ];
  const combo = detectCombos(trio).find((c) => c.id === 'rarity:rare:3');
  assert.ok(combo);
  assert.equal(combo.cardUids.length, 3);
  // Solo participan las tres raras, no la comun.
  assert.ok(!combo.cardUids.includes(trio[3]!.uid));
});

test('poker y coleccion conviven en la misma mano', () => {
  // 3 cartas del mismo elemento (combo.element.3) y 2 de otra => full house.
  const mixed = [
    card({ rarity: 'common', element: 'spore', substrate: 1 }),
    card({ rarity: 'common', element: 'spore', substrate: 2 }),
    card({ rarity: 'uncommon', element: 'spore', substrate: 3 }),
    card({ rarity: 'rare', element: 'decay', substrate: 5 }),
    card({ rarity: 'rare', element: 'decay', substrate: 6 }),
  ];
  const got = ids(mixed);
  assert.ok(got.includes('element:spore:3'));
  assert.ok(got.includes('fullhouse:spore'));
});
