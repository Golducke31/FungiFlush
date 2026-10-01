/**
 * jokerEvents.test.ts — El evento `joker:triggered` se emite de verdad.
 *
 * Contexto: `joker:triggered` estaba declarado en `GameEventMap` desde el
 * principio pero NUNCA se emitia. El HUD lo necesita para que la ficha del
 * joker lata cuando su joker dispara (tarea H4). Un joker que dispara tres
 * veces se veia igual que uno que no disparo nunca.
 *
 * Lo que se protege aca:
 *   - un joker que dispara emite el evento, con el `firedCount` YA actualizado,
 *   - un `dryRun` (previsualizacion del HUD) NO emite: la ficha no puede latir
 *     por algo que todavia no paso.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { GameEngine } from '../src/engine/GameEngine.ts';
import { bus } from '../src/engine/events.ts';
import type { CardDefinition, ContentBundle, JokerDefinition } from '../src/engine/index.ts';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** Mete un joker en la run como lo haria una compra: misma via que `buyOffer`. */
function grantJoker(engine: GameEngine, id: string): void {
  const joker = engine.registry.instantiateJoker(id);
  engine.run.jokers.push(joker);
  bus.emit('joker:added', { joker });
}

function card(id: string, overrides: Partial<CardDefinition> = {}): CardDefinition {
  return {
    id,
    nameKey: `card.${id}.name`,
    descKey: `card.${id}.desc`,
    element: 'spore',
    family: 'agaricaceae',
    rarity: 'common',
    baseSubstrate: 10,
    baseSpores: 1,
    cost: 1,
    art: { hue: 120, pattern: 'radial' },
    effects: [],
    tags: ['starter'],
    copies: 6,
    ...overrides,
  };
}

/** Joker con un disparador ON_HAND_SCORED: dispara en cada mano jugada. */
function triggerJoker(): JokerDefinition {
  return {
    id: 'j_test',
    nameKey: 'joker.j_test.name',
    descKey: 'joker.j_test.desc',
    rarity: 'common',
    cost: 4,
    sellValue: 2,
    art: { hue: 120, pattern: 'radial' },
    effects: [
      {
        id: 'j_test_boom',
        trigger: 'ON_HAND_SCORED',
        actions: [{ type: 'ADD_SPORES', value: 2 }],
      },
    ],
  };
}

function bundle(): ContentBundle {
  return {
    cards: [card('filler')],
    jokers: [triggerJoker()],
    blinds: [
      { id: 'b1', nameKey: 'blind.b1.name', descKey: 'blind.b1.desc', ante: 1, scoreMultiplier: 1, reward: 3 },
    ],
    anteTargets: { 1: 1 },
    upgrades: [],
    evolutions: [],
    offers: [],
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('un joker que dispara emite `joker:triggered` con el firedCount actualizado', () => {
  const engine = new GameEngine({ seed: 3, bundle: bundle() });
  engine.startRun(3);
  engine.chooseBlind('b1');

  // Meter el joker directamente: el sorteo de tienda no es lo que se prueba.
  grantJoker(engine, 'j_test');
  const joker = engine.run.jokers[0];
  assert.ok(joker, 'el joker deberia estar en la run');
  assert.equal(joker.firedCount, 0);

  const seen: Array<{ uid: string; firedCount: number }> = [];
  const off = bus.on('joker:triggered', ({ joker: j }) => {
    seen.push({ uid: j.uid, firedCount: j.firedCount });
  });

  try {
    engine.round?.hand.slice(0, 3).forEach((c) => engine.toggleSelect(c.uid));
    engine.playHand();
  } finally {
    off();
  }

  assert.ok(seen.length >= 1, 'el joker deberia haber disparado y emitido el evento');
  assert.equal(seen[0]?.uid, joker.uid);
  // El evento va DESPUES de contar: quien lo escucha ya lee el total nuevo.
  assert.equal(seen[seen.length - 1]?.firedCount, joker.firedCount);
  assert.ok(joker.firedCount >= 1);
});

test('previsualizar (dryRun) NO emite `joker:triggered`', () => {
  const engine = new GameEngine({ seed: 3, bundle: bundle() });
  engine.startRun(3);
  engine.chooseBlind('b1');
  grantJoker(engine, 'j_test');

  const joker = engine.run.jokers[0];
  assert.ok(joker);

  let count = 0;
  const off = bus.on('joker:triggered', () => {
    count += 1;
  });

  try {
    // El HUD hace exactamente esto en cada cambio de estado.
    engine.round?.hand.slice(0, 3).forEach((c) => engine.toggleSelect(c.uid));
    for (let i = 0; i < 5; i += 1) engine.previewSelection();
  } finally {
    off();
  }

  assert.equal(count, 0, 'una previsualizacion no es un disparo real');
  assert.equal(joker.firedCount, 0, 'dryRun no puede incrementar el contador');
});
