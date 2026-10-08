/**
 * scoreFloor.test.ts — El score JUGABLE nunca es negativo NI se anula por
 * putrefaccion.
 *
 * Historia de la regla (dos capas):
 *
 *   1. `total` era `Math.round(substrate * spores)` sin suelo. La putrefaccion
 *      (resta Substrato por cada disparo de la carta) y el impuesto de la Reina
 *      restaban sin limite, asi que una mano podrida puntuaba NEGATIVO
 *      ("Score: -24"), un estado matematicamente invalido que se propagaba a
 *      `round.score` (acumulado con `+=`) y a la barra del HUD. Se puso un suelo
 *      de cero en `total`.
 *
 *   2. Ese suelo NO alcanzaba: la putrefaccion acumulada hundia el Sustrato a
 *      ≤ 0 y `0 × esporas = 0`, asi que el jugador PERDIA el ciego con un 0 sin
 *      saber por que. Ahora la putrefaccion va por su propio carril
 *      (`addDecaySubstrate`) y se TOPEA contra el aporte de las CARTAS: una
 *      carta podrida aporta 0 como mucho, pero el resto de la mano sigue
 *      puntuando. El Sustrato ya NO puede quedar negativo por pudricion.
 *
 * Lo que se protege aca:
 *   - la putrefaccion NO puede hundir el Sustrato por debajo de 0,
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

test('la putrefaccion NO puede hundir el Substrato por debajo de cero', () => {
  const res = new ResolutionContext({ scoredCards: [] });
  res.substrateFromCards = 4;
  res.sporesFromCards = 2; // spores = 1 + 2 = 3
  // Putrefaccion brutal: mas que el aporte de las cartas (4).
  res.addDecaySubstrate(30, 'decay', 'card.rot.name', 0);

  assert.equal(res.substrate, 0, 'la putrefaccion se topea contra el aporte de las cartas');
  assert.equal(res.total, 0, 'el score jugable no puede ser negativo');
});

test('una carta podrida aporta 0, pero el RESTO de la mano sigue puntuando', () => {
  const res = new ResolutionContext({ scoredCards: [] });
  res.substrateFromCards = 40; // la mano aporta 40
  res.sporesFromCards = 2; // spores = 3
  res.addDecaySubstrate(12, 'decay', 'card.rot.name', 0); // penalizacion menor

  // 40 - 12 = 28 ⇒ la mano puntua, no se anula.
  assert.equal(res.substrate, 28, 'la penalizacion resta pero no anula la mano');
  assert.equal(res.total, 28 * 3);
  assert.ok(res.total > 0, 'una mano con putrefaccion leve SIGUE puntuando');
});

test('un impuesto fuerte tampoco puede llevar el Substrato bajo cero', () => {
  // El impuesto de un jefe u otro efecto resta Sustrato plano (no putrefaccion).
  // El getter lo clampa a 0 junto con la putrefaccion: el Sustrato NUNCA es
  // negativo, sin importar de donde venga la resta.
  const res = new ResolutionContext({});
  res.substrateFromCards = 3;
  res.sporesFromCards = 2;
  res.addSubstrate(-30, 'boss', 'blind.x.name', 0);

  assert.equal(res.substrate, 0, 'el Sustrato se clampa a 0');
  assert.equal(res.total, 0, 'y el score jugable nunca es negativo');
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

// ---------------------------------------------------------------------------
// Contenido: la putrefaccion de las cartas ya NO es permanente
// ---------------------------------------------------------------------------

test('ninguna carta aplica putrefaccion PERMANENTE a tu propia mano', () => {
  // La putrefaccion con `turns: -1` no expiraba jamas, asi que se acumulaba
  // ciego tras ciego hasta hundir el Sustrato y explicar los ceros. Ahora el
  // contenido usa una duracion finita (`turns: 3`): la cosechadora sigue
  // teniendo su estado que consumir dentro del mismo ciego, pero la podredumbre
  // se cura sola despues.
  const cards = buildRegistry().toBundle().cards;
  const offenders: string[] = [];
  for (const def of cards) {
    for (const effect of def.effects ?? []) {
      for (const action of effect.actions as Array<{ type: string; status?: string; turns?: number }>) {
        if (action.type !== 'APPLY_STATUS') continue;
        // Solo importa la putrefaccion: `overgrowth` es un BUFF propio y si
        // puede quedarse puesta; `decay` es dano que no debe ser eterno.
        if (action.status !== 'decay') continue;
        if (action.turns === undefined || action.turns < 0) offenders.push(def.id);
      }
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `cartas con putrefaccion permanente (${offenders.join(', ')}): usar "turns" >= 1`,
  );
});

