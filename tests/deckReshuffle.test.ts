/**
 * deckReshuffle.test.ts — El reciclado del descarte se AVISA.
 *
 * Bug reportado: el HUD mostraba "0 por robar" aunque el descarte todavia
 * pudiera reciclarse (el `Deck` se baraja solo, en silencio). Ademas de partir
 * el contador en "Robables"/"Descarte", el motor ahora emite `deck:reshuffle`
 * para que la UI lo explique y lo anime.
 *
 * Lo que se protege aca:
 *   - `deckDrawPile` / `deckDiscardPile` reparten el mazo sin la mano,
 *   - el motor emite `deck:reshuffle` cuando la pila de robo se vacia.
 *
 *   npm test
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { GameEngine } from '../src/engine/GameEngine.ts';
import { bus } from '../src/engine/index.ts';
import type { CardDefinition, ContentBundle } from '../src/engine/index.ts';

function card(id: string, overrides: Partial<CardDefinition> = {}): CardDefinition {
  return {
    id,
    nameKey: `card.${id}.name`,
    descKey: `card.${id}.desc`,
    element: 'neutral',
    family: 'agaricaceae',
    rarity: 'common',
    baseSubstrate: 1,
    baseSpores: 1,
    cost: 1,
    art: { hue: 100, pattern: 'radial' },
    tags: ['starter'],
    copies: 8,
    ...overrides,
  };
}

/** Objetivo inalcanzable: la ronda NO se cierra por victoria, se pierde. */
function bundle(cards: CardDefinition[], target = 100000): ContentBundle {
  return {
    cards,
    jokers: [],
    blinds: [
      { id: 'b1', nameKey: 'blind.b1.name', descKey: 'blind.b1.desc', ante: 1, scoreMultiplier: 1, reward: 3 },
    ],
    anteTargets: { 1: target },
  };
}

test('deckDrawPile y deckDiscardPile reparten el mazo sin contar la mano', () => {
  const engine = new GameEngine({ seed: 3, bundle: bundle([card('small')]) });
  engine.startRun(3);
  engine.chooseBlind('b1');

  const hand = engine.roundSnapshot().hand.length;
  assert.equal(engine.deckDiscardPile, 0, 'al abrir el ciego no hay descarte');
  assert.equal(engine.deckDrawPile + hand, engine.deckSize, 'robo + mano = mazo total');
});

test('el motor avisa (deck:reshuffle) cuando el descarte vuelve al robo', () => {
  // Mazo de 8 cartas: con la mano en 6, la pila de robo se vacia en pocas manos
  // y el descarte tiene que reciclarse.
  const engine = new GameEngine({ seed: 3, bundle: bundle([card('small', { copies: 8 })]) });
  engine.startRun(3);
  engine.chooseBlind('b1');

  let reshuffles = 0;
  const off = bus.on('deck:reshuffle', () => {
    reshuffles += 1;
  });

  let guard = 0;
  while (engine.runSnapshot().status === 'playing' && guard++ < 12) {
    const first = engine.roundSnapshot().hand[0];
    if (!first) break;
    engine.toggleSelect(first.uid);
    engine.playHand();
  }
  off();

  assert.ok(reshuffles > 0, 'el reciclado del descarte debe avisarse al menos una vez');
});
