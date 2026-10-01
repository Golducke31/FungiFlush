/**
 * starterDeck.test.ts — El mazo inicial respeta `starterOverrides`.
 *
 * Contexto: `ProfileSave.starterOverrides` se guardaba, se migraba... y nadie
 * lo leia. Las "copias extra en el mazo inicial" del pase de temporada no
 * hacian absolutamente nada. Este test fija el contrato nuevo.
 *
 * Lo que se protege aca:
 *   - con overrides, el mazo es EXACTAMENTE lo declarado (no se mezcla con el
 *     starter del contenido),
 *   - un id desconocido se ignora en silencio (un guardado viejo no puede
 *     romper el arranque),
 *   - si NINGUN id existia, se cae al mazo base (una run sin cartas no es
 *     jugable).
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { CardRegistry } from '../src/engine/cards/CardRegistry.ts';
import { RNG } from '../src/engine/rng.ts';
import type { CardDefinition, ContentBundle } from '../src/engine/index.ts';

function card(id: string, overrides: Partial<CardDefinition> = {}): CardDefinition {
  return {
    id,
    nameKey: `card.${id}.name`,
    descKey: `card.${id}.desc`,
    element: 'neutral',
    family: 'agaricaceae',
    rarity: 'common',
    baseSubstrate: 10,
    baseSpores: 1,
    cost: 1,
    art: { hue: 120, pattern: 'radial' },
    tags: ['starter'],
    copies: 6,
    ...overrides,
  };
}

function registry(): CardRegistry {
  const bundle: ContentBundle = {
    cards: [card('base_a'), card('base_b'), card('bonus', { tags: [], copies: 1 })],
    jokers: [],
    blinds: [],
  };
  const reg = new CardRegistry();
  reg.load(bundle);
  return reg;
}

test('sin overrides, el mazo sale del contenido (tag starter)', () => {
  const deck = registry().buildStarterDeck(new RNG(1));
  // base_a + base_b (6 copias c/u). `bonus` no tiene tag starter: queda afuera.
  assert.equal(deck.length, 12);
  assert.ok(deck.every((c) => c.def.id !== 'bonus'));
});

test('con overrides, el mazo es exactamente lo declarado', () => {
  const deck = registry().buildStarterDeck(new RNG(1), [
    { cardId: 'bonus', copies: 3 },
    { cardId: 'base_a', copies: 1 },
  ]);
  assert.equal(deck.length, 4);
  assert.equal(deck.filter((c) => c.def.id === 'bonus').length, 3);
  assert.equal(deck.filter((c) => c.def.id === 'base_a').length, 1);
  // No se cuela nada del starter del contenido que no se pidio.
  assert.equal(deck.filter((c) => c.def.id === 'base_b').length, 0);
});

test('un id desconocido se ignora; los validos siguen entrando', () => {
  const deck = registry().buildStarterDeck(new RNG(1), [
    { cardId: 'no_existe', copies: 9 },
    { cardId: 'base_a', copies: 2 },
  ]);
  assert.equal(deck.length, 2);
  assert.ok(deck.every((c) => c.def.id === 'base_a'));
});

test('si NINGUN override existe, se cae al mazo base (nunca vacio)', () => {
  const deck = registry().buildStarterDeck(new RNG(1), [
    { cardId: 'fantasma_1', copies: 2 },
    { cardId: 'fantasma_2', copies: 2 },
  ]);
  assert.equal(deck.length, 12, 'sin ids validos, el mazo base es el respaldo');
});

test('el mazo con overrides tambien respeta la semilla (determinismo)', () => {
  const overrides = [
    { cardId: 'base_a', copies: 4 },
    { cardId: 'base_b', copies: 4 },
  ];
  const a = registry().buildStarterDeck(new RNG(42), overrides).map((c) => c.def.id);
  const b = registry().buildStarterDeck(new RNG(42), overrides).map((c) => c.def.id);
  assert.deepEqual(a, b, 'misma semilla, mismo mazo');
});
