/**
 * scoreFloor.test.ts — El score JUGABLE nunca es negativo.
 *
 * Regresion: `ResolutionContext.total` era `Math.round(substrate * spores)` sin
 * suelo. Como la podredumbre (`TriggerEngine` resta Substrato por cada disparo
 * de la carta) y el impuesto de la Reina Esporada restaban sin limite, una mano
 * podrida podia puntuar NEGATIVO ("Score: -24"), un estado matematicamente
 * invalido que ademas se propagaba a `round.score` (acumulado con `+=`) y a la
 * barra del HUD.
 *
 * Lo que se protege aca:
 *   - el desglose (substrate) SI puede quedar en negativo,
 *   - el score total tiene suelo de cero,
 *   - una mano nunca resta al score acumulado de la ronda,
 *   - la Reina Esporada aplica un impuesto de Esporas, no un Substrato fijo.
 *
 *   npm test
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { GameEngine } from '../src/engine/GameEngine.ts';
import { ResolutionContext } from '../src/engine/resolution.ts';
import type { CardDefinition, ContentBundle } from '../src/engine/index.ts';
import { buildRegistry } from '../tools/loadContent.node.ts';

function card(id: string, overrides: Partial<CardDefinition> = {}): CardDefinition {
  return {
    id,
    nameKey: `card.${id}.name`,
    descKey: `card.${id}.desc`,
    element: 'neutral',
    family: 'agaricaceae',
    rarity: 'common',
    baseSubstrate: 10,
    baseSpores: 2,
    cost: 3,
    art: { hue: 100, pattern: 'radial' },
    tags: ['starter'],
    copies: 10,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Unidad: el acumulador de una resolucion
// ---------------------------------------------------------------------------

test('total tiene suelo de cero aunque el Substrato quede negativo', () => {
  const res = new ResolutionContext({ scoredCards: [] });
  res.substrateFromCards = 4;
  res.sporesFromCards = 2; // spores = 1 + 2 = 3
  res.addSubstrate(-6, 'decay', 'card.rot.name', 0);

  assert.equal(res.substrate, -2, 'el desglose conserva el negativo');
  assert.equal(res.total, 0, 'el score jugable no puede ser negativo');
});

test('podredumbre brutal sobre poco Substrato: score 0, no negativo', () => {
  const res = new ResolutionContext({});
  res.substrateFromCards = 3;
  res.sporesFromCards = 2;
  res.addSubstrate(-30, 'boss', 'blind.x.name', 0);

  assert.ok(res.substrate < 0, 'el Substrato real baja de cero');
  assert.equal(res.total, 0);
});

test('la Reina Esporada (-25% Esporas) reduce sin destruir el score', () => {
  const res = new ResolutionContext({});
  res.substrateFromCards = 18;
  res.sporesFromCards = 1; // spores = 2
  res.multiplySpores(0.75, 'a3_boss_tax', 'blind.blind_a3_boss.name', 0);

  assert.equal(res.spores, 1.5, 'las Esporas bajan un 25%');
  assert.equal(res.total, Math.round(18 * 1.5));
  assert.ok(res.total > 0, 'el impuesto no anula la mano por si solo');
});

// ---------------------------------------------------------------------------
// Contenido: la Reina ya no aplica un Substrato fijo de -30
// ---------------------------------------------------------------------------

test('la Reina Esporada usa impuesto de Esporas, no un Substrato fijo', () => {
  const queen = buildRegistry()
    .toBundle()
    .blinds.find((b) => b.id === 'blind_a3_boss');
  assert.ok(queen, 'el ciego de la Reina debe existir');

  const actions = (queen.effects ?? []).flatMap((e) => e.actions as Array<{ type: string; value?: number }>);
  assert.ok(
    actions.some((a) => a.type === 'MULTIPLY_SPORES' && a.value === 0.75),
    'la Reina debe reducir las Esporas un 25%',
  );
  assert.ok(
    !actions.some((a) => a.type === 'ADD_SUBSTRATE' && (a.value ?? 0) < 0),
    'la Reina no debe restar Substrato fijo',
  );
});

// ---------------------------------------------------------------------------
// Integracion: una mano podrida nunca resta al score de la ronda
// ---------------------------------------------------------------------------

test('una mano con cartas podridas nunca resta al score de la ronda', () => {
  // `rotter` dispara un efecto al puntuar (sin el, la podredumbre no tendria
  // "disparo" que castigar) y tiene poco Substrato base para que el castigo lo
  // lleve a negativo.
  const rotter = card('rotter', {
    baseSubstrate: 4,
    baseSpores: 3,
    copies: 12,
    effects: [
      {
        id: 'rot',
        trigger: 'ON_HAND_SCORED',
        actions: [{ type: 'ADD_SPORES', value: 0 }],
      },
    ],
  });

  const bundle: ContentBundle = {
    cards: [rotter],
    jokers: [],
    blinds: [
      { id: 'b1', nameKey: 'blind.b1.name', descKey: 'blind.b1.desc', ante: 1, scoreMultiplier: 1, reward: 3 },
    ],
    anteTargets: { 1: 1000 },
  };

  const engine = new GameEngine({ seed: 5, bundle });
  engine.startRun(5);
  engine.chooseBlind('b1');

  // Se podren TODAS las cartas de la mano de forma determinista: asi el proximo
  // puntaje pasa por el camino negativo del motor.
  for (const c of engine.roundSnapshot().hand) {
    c.statuses.push({ type: 'decay', value: 6, turnsLeft: -1 });
  }

  let guard = 0;
  while (engine.runSnapshot().status === 'playing' && guard++ < 12) {
    const before = engine.roundSnapshot().score;
    const first = engine.roundSnapshot().hand[0];
    if (!first) break;
    engine.toggleSelect(first.uid);
    engine.playHand();

    const after = engine.roundSnapshot().score;
    assert.ok(after >= before, `jugar una mano podrida resto al score (${before} -> ${after})`);
  }

  assert.ok(engine.roundSnapshot().score >= 0, 'el score de la ronda nunca puede ser negativo');
  assert.ok(engine.run.stats.bestHand >= 0, 'la mejor mano nunca puede ser negativa');
});
