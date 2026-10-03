/**
 * loadedDie.test.ts — Simbionte legendario `joker_loaded_die` (dado cargado).
 *
 * El dado ya NO se tira por ciego (se quito del flujo de seleccion). Ahora es
 * una HABILIDAD ACTIVA de este Simbionte: cada 2 manos jugadas se puede tirar
 * una vez, y su multiplicador se aplica a la proxima mano jugada.
 *
 * Lo que se protege aca:
 *   - sin el Simbionte NO se puede usar el dado (la habilidad no existe),
 *   - con el Simbionte arranca "listo" (0 manos restantes),
 *   - usarlo consume la carga y la repone recien a las 2 manos,
 *   - la cara cargada se consume en UNA sola mano (no se pega a la ronda),
 *   - usarlo NO deja el dado colgado entre ciegos.
 *
 * Se arma con un bundle minimo y determinista para no depender del pack real.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { GameEngine, LOADED_DIE_JOKER_ID } from '../src/engine/GameEngine.ts';
import { bus } from '../src/engine/events.ts';
import type { CardDefinition, ContentBundle, JokerDefinition } from '../src/engine/index.ts';

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
    copies: 8,
    ...overrides,
  };
}

/** El Simbionte real, con el mismo id que el contenido: es el gate del motor. */
function loadedDieJoker(): JokerDefinition {
  return {
    id: LOADED_DIE_JOKER_ID,
    nameKey: 'joker.joker_loaded_die.name',
    descKey: 'joker.joker_loaded_die.desc',
    rarity: 'legendary',
    cost: 12,
    sellValue: 6,
    art: { hue: 275, pattern: 'crystal' },
    effects: [
      {
        id: 'loaded_die_seed',
        trigger: 'ON_ROUND_START',
        once: 'per_round',
        actions: [{ type: 'ADD_SPORES', value: 1 }],
      },
    ],
  };
}

function bundle(): ContentBundle {
  return {
    cards: [card('filler')],
    jokers: [loadedDieJoker()],
    blinds: [
      { id: 'b1', nameKey: 'blind.b1.name', descKey: 'blind.b1.desc', ante: 1, scoreMultiplier: 1, reward: 3 },
    ],
    // Objetivo ALTO a proposito: la ronda tiene que seguir viva despues de las
    // dos manos que necesita el test. Con un objetivo bajo, la primera mano
    // ganaria el ciego y la segunda `playHand()` no correria.
    anteTargets: { 1: 999999 },
    upgrades: [],
    evolutions: [],
    offers: [],
  };
}

function grantJoker(engine: GameEngine, id: string): void {
  const joker = engine.registry.instantiateJoker(id);
  engine.run.jokers.push(joker);
  bus.emit('joker:added', { joker });
}

function newEngine(): GameEngine {
  const engine = new GameEngine({ seed: 7, bundle: bundle() });
  engine.startRun(7);
  return engine;
}

test('sin el Simbionte, la habilidad del dado no existe', () => {
  const engine = newEngine();
  engine.chooseBlind('b1');
  assert.equal(engine.hasLoadedDie(), false);
  assert.equal(engine.canUseLoadedDie(), false);
  assert.equal(engine.useLoadedDie(), null);
});

test('con el Simbionte arranca listo y tirar consume la carga', () => {
  const engine = newEngine();
  grantJoker(engine, LOADED_DIE_JOKER_ID);
  engine.chooseBlind('b1');

  assert.equal(engine.hasLoadedDie(), true);
  assert.equal(engine.loadedDieCharge(), 0, 'la primera carga arranca lista');
  assert.equal(engine.canUseLoadedDie(), true);

  const die = engine.useLoadedDie();
  assert.ok(die, 'la tirada deberia devolver una cara');
  assert.equal(engine.loadedDieFace?.face, die?.face, 'el dado queda cargado en `run.die`');
  assert.equal(engine.loadedDieCharge(), 2, 'la carga se repone a 2 manos');
  assert.equal(engine.canUseLoadedDie(), false, 'no se puede volver a tirar dos veces seguidas');
});

test('la carga se repone recien despues de 2 manos jugadas', () => {
  const engine = newEngine();
  grantJoker(engine, LOADED_DIE_JOKER_ID);
  engine.chooseBlind('b1');
  engine.useLoadedDie();

  const play = (): void => {
    engine.round?.hand.slice(0, 1).forEach((c) => engine.toggleSelect(c.uid));
    engine.playHand();
  };

  play();
  assert.equal(engine.loadedDieCharge(), 1, 'tras 1 mano falta 1');
  assert.equal(engine.canUseLoadedDie(), false);
  play();
  assert.equal(engine.loadedDieCharge(), 0, 'tras 2 manos vuelve a estar listo');
  assert.equal(engine.canUseLoadedDie(), true);
});

test('la cara cargada se consume en UNA sola mano', () => {
  const engine = newEngine();
  grantJoker(engine, LOADED_DIE_JOKER_ID);
  engine.chooseBlind('b1');

  const die = engine.useLoadedDie();
  assert.ok(die);

  // Primera mano: la cara esta en juego.
  assert.equal(engine.loadedDieFace?.face, die.face);
  engine.round?.hand.slice(0, 1).forEach((c) => engine.toggleSelect(c.uid));
  engine.playHand();

  // Ya no: el dado vale para la mano que sigue a la tirada, no para la ronda.
  assert.equal(engine.loadedDieFace, null, 'la cara se limpia despues de jugar');
});

test('usar el dado emite `die:loaded` para que el render lo anime', () => {
  const engine = newEngine();
  grantJoker(engine, LOADED_DIE_JOKER_ID);
  engine.chooseBlind('b1');

  let payload: { die: { face: number } } | null = null;
  const off = bus.on('die:loaded', (p) => {
    payload = p as { die: { face: number } };
  });
  try {
    engine.useLoadedDie();
  } finally {
    off();
  }

  assert.ok(payload, 'deberia haberse emitido el evento');
});
