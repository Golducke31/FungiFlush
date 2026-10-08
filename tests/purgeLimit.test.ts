/**
 * purgeLimit.test.ts — Tope de purgas por ANTE.
 *
 * Regla que estos tests protegen: purgar es una palanca FUERTE (adelgaza el
 * mazo de forma permanente), asi que se limita a `ECONOMY.purgesPerAnte` por
 * ante. El cupo:
 *   - se consume al purgar,
 *   - bloquea la purga siguiente cuando llega a 0 (sin cobrar),
 *   - se RESETEA solo al entrar a un ante NUEVO, no en cada ciego,
 *   - sobrevive a un guardado/carga (una run retomada no regala purgas).
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { GameEngine } from '../src/engine/GameEngine.ts';
import { ECONOMY } from '../src/engine/constants.ts';
import type { CardDefinition, ContentBundle } from '../src/engine/index.ts';
import type { RunState } from '../src/engine/state/RunState.ts';

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

/** Bundle con 3 ciegos en el ante 1 (3.º = jefe) y uno en el 2. */
function bundle(): ContentBundle {
  return {
    cards: [card('alpha'), card('beta')],
    jokers: [],
    blinds: [
      { id: 'b1', nameKey: 'blind.b1.name', descKey: 'blind.b1.desc', ante: 1, scoreMultiplier: 1, reward: 3 },
      { id: 'b2', nameKey: 'blind.b2.name', descKey: 'blind.b2.desc', ante: 1, scoreMultiplier: 1, reward: 3 },
      { id: 'b3', nameKey: 'blind.b3.name', descKey: 'blind.b3.desc', ante: 1, scoreMultiplier: 1, reward: 3, tier: 'boss' },
      { id: 'c1', nameKey: 'blind.c1.name', descKey: 'blind.c1.desc', ante: 2, scoreMultiplier: 1, reward: 3 },
    ],
    anteTargets: { 1: 100, 2: 100 },
  };
}

/** Acceso a la run real (el snapshot publico no expone `deck` ni el cupo). */
function runOf(engine: GameEngine): RunState {
  return (engine as unknown as { run: RunState }).run;
}

function firstUid(engine: GameEngine): string {
  const uid = runOf(engine).deck.allCards[0]?.uid;
  assert.ok(uid, 'el mazo deberia tener cartas');
  return uid;
}

/** Elige el ciego que toca (por indice) y lo gana con una mano de 5 cartas. */
function clearCurrentBlind(engine: GameEngine): void {
  engine.chooseBlind();
  const hand = engine.roundSnapshot().hand;
  for (const c of hand.slice(0, 5)) engine.toggleSelect(c.uid);
  engine.playHand();
}

/** Juega un ciego entero y sale de la tienda (avanza blindIndex/ante). */
function playBlindAndLeave(engine: GameEngine): void {
  clearCurrentBlind(engine);
  assert.equal(engine.runSnapshot().status, 'shop', 'ganar un ciego deberia abrir la tienda');
  engine.leaveShop();
}

test('el tope por ante es el de la economia', () => {
  assert.ok(ECONOMY.purgesPerAnte >= 1, 'tiene que permitir al menos una purga');
});

test('purga el cupo y la siguiente falla sin cobrar', () => {
  const engine = new GameEngine({ seed: 5, bundle: bundle() });
  engine.startRun(5);
  runOf(engine).money = 999;

  const perAnte = engine.purgesPerAnte;
  assert.equal(engine.purgesLeft, perAnte);

  const moneyBefore = runOf(engine).money;
  for (let i = 0; i < perAnte; i += 1) {
    assert.equal(engine.purgeCard(firstUid(engine)), true, `la purga ${i + 1} deberia pasar`);
  }
  assert.equal(engine.purgesLeft, 0, 'el cupo deberia agotarse');
  const moneyAfterPurges = runOf(engine).money;

  // La siguiente purga falla y NO cobra.
  assert.equal(engine.purgeCard(firstUid(engine)), false, 'sin cupo, purgar debe fallar');
  assert.equal(runOf(engine).money, moneyAfterPurges, 'una purga fallida no cobra');
  assert.ok(moneyAfterPurges < moneyBefore, 'las purgas exitosas SI cobran');
});

test('el cupo se resetea al entrar a un ante NUEVO, no en cada ciego', () => {
  const engine = new GameEngine({ seed: 9, bundle: bundle() });
  engine.startRun(9);
  runOf(engine).money = 999;

  // Gasta el cupo del ante 1.
  while (engine.purgesLeft > 0) engine.purgeCard(firstUid(engine));
  assert.equal(engine.purgesLeft, 0);

  // Ciego 1 (ante 1): sigue sin cupo aunque el ciego cambie.
  playBlindAndLeave(engine);
  assert.equal(runOf(engine).ante, 1, 'seguimos en el ante 1 tras el ciego 1');
  assert.equal(engine.purgesLeft, 0, 'un ciego nuevo NO devuelve purgas');

  // Ciego 2 (ante 1): tampoco.
  playBlindAndLeave(engine);
  assert.equal(runOf(engine).ante, 1, 'seguimos en el ante 1 tras el ciego 2');
  assert.equal(engine.purgesLeft, 0, 'el segundo ciego tampoco devuelve purgas');

  // Ciego 3 = jefe: cierra el ante 1 ⇒ ante 2, y ahi SI vuelve el cupo.
  playBlindAndLeave(engine);
  assert.equal(runOf(engine).ante, 2, 'el jefe deberia cerrar el ante 1');
  assert.equal(engine.purgesLeft, engine.purgesPerAnte, 'ante nuevo ⇒ cupo completo');
});

test('el cupo sobrevive a un guardado/carga', () => {
  const engine = new GameEngine({ seed: 13, bundle: bundle() });
  engine.startRun(13);
  runOf(engine).money = 999;
  engine.purgeCard(firstUid(engine));
  assert.equal(runOf(engine).purgesThisAnte, 1);

  const save = engine.serialize();
  assert.equal(save.purgesThisAnte, 1, 'el guardado tiene que llevar el cupo');

  const restored = new GameEngine({ seed: 13, bundle: bundle() });
  assert.equal(restored.restore(save), true);
  assert.equal(runOf(restored).purgesThisAnte, 1, 'una run retomada no regala purgas');
  assert.equal(restored.purgesLeft, engine.purgesPerAnte - 1);
});

test('un guardado viejo sin el campo cae a cupo completo', () => {
  const engine = new GameEngine({ seed: 17, bundle: bundle() });
  engine.startRun(17);
  const save = engine.serialize();
  delete (save as { purgesThisAnte?: number }).purgesThisAnte;

  const restored = new GameEngine({ seed: 17, bundle: bundle() });
  assert.equal(restored.restore(save), true);
  assert.equal(runOf(restored).purgesThisAnte, 0);
  assert.equal(restored.purgesLeft, restored.purgesPerAnte);
});
