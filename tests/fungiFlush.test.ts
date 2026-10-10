/**
 * fungiFlush.test.ts — Habilidad insignia de la run (boton manual con cargas).
 *
 * A diferencia del dado (que es un Simbionte), FungiFlush es de la RUN: un
 * boton que arma la proxima mano con un gran multiplicador de Esporas, limpia
 * los estados negativos (podredumbre / esterilidad) del mazo y roba cartas. Se
 * recarga solo cuando la mano cierra formando un combo grande.
 *
 * Lo que se protege aca:
 *   - arranca con 1 carga y se puede usar en `playing`;
 *   - usarlo gasta la carga, arma la proxima mano y emite `fungi:flushed`;
 *   - NO se apila sobre una mano ya armada;
 *   - la proxima mano jugada entra con el x2.5 de Esporas (como un paso mas);
 *   - la recarga solo ocurre con un combo grande (elemento>=3 / familia>=4);
 *   - limpia `decay` y `spore_lock` del mazo y la mano al activarse;
 *   - el guardado/restauracion es ADITIVO y no rompe `SAVE_VERSION`.
 *
 * Se arma con un bundle minimo y determinista para no depender del pack real.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { GameEngine } from '../src/engine/GameEngine.ts';
import { bus } from '../src/engine/events.ts';
import type { CardDefinition, ContentBundle, ElementType } from '../src/engine/index.ts';

function card(id: string, element: ElementType = 'spore'): CardDefinition {
  return {
    id,
    nameKey: `card.${id}.name`,
    descKey: `card.${id}.desc`,
    element,
    family: 'agaricaceae',
    rarity: 'common',
    baseSubstrate: 10,
    baseSpores: 1,
    cost: 1,
    art: { hue: 120, pattern: 'radial' },
    effects: [],
    tags: ['starter'],
    copies: 8,
  };
}

function bundle(): ContentBundle {
  return {
    // Unica carta de su elemento cada una: asi se puede armar a mano cualquier
    // mano (3 del mismo elemento para el combo grande, 1 suelta para el vacio).
    cards: [
      card('sp_a', 'spore'),
      card('sp_b', 'spore'),
      card('sp_c', 'spore'),
      card('po_a', 'poison'),
      card('cr_a', 'crystal'),
      card('sy_a', 'symbiosis'),
    ],
    jokers: [],
    blinds: [
      { id: 'b1', nameKey: 'blind.b1.name', descKey: 'blind.b1.desc', ante: 1, scoreMultiplier: 1, reward: 3 },
    ],
    // Objetivo ALTO a proposito: la ronda tiene que seguir viva entre manos.
    anteTargets: { 1: 999999 },
    upgrades: [],
    evolutions: [],
    offers: [],
  };
}

function newEngine(): GameEngine {
  const engine = new GameEngine({ seed: 7, bundle: bundle() });
  engine.startRun(7);
  return engine;
}

/** Reemplaza la mano por las cartas dadas (por def id) para controlar combos. */
function setHand(engine: GameEngine, ids: string[]): void {
  const round = engine.round;
  assert.ok(round, 'la ronda debe estar activa');
  round.hand = ids.map((id) => engine.registry.instantiate(id));
  round.selected = [];
}

function play(engine: GameEngine, ids: string[]): void {
  setHand(engine, ids);
  ids.forEach((id) => {
    const inst = engine.round?.hand.find((c) => c.def.id === id);
    if (inst) engine.toggleSelect(inst.uid);
  });
  engine.playHand();
}

test('arranca con 1 carga y se puede usar en estado playing', () => {
  const engine = newEngine();
  engine.chooseBlind('b1');
  assert.equal(engine.fungiFlushCharge(), 1, 'carga inicial = default (1)');
  assert.equal(engine.isFungiFlushArmed(), false);
  assert.equal(engine.canUseFungiFlush(), true);
});

test('usarlo gasta la carga, arma la proxima mano y emite fungi:flushed', () => {
  const engine = newEngine();
  engine.chooseBlind('b1');

  let payload: { charge: number; intensity: number } | undefined;
  const off = bus.on('fungi:flushed', (p) => {
    payload = p as unknown as { charge: number; intensity: number };
  });
  try {
    const ok = engine.useFungiFlush();
    assert.equal(ok, true);
  } finally {
    off();
  }

  assert.equal(engine.fungiFlushCharge(), 0, 'la carga se consumio');
  assert.equal(engine.isFungiFlushArmed(), true, 'la proxima mano queda armada');
  assert.equal(engine.canUseFungiFlush(), false, 'sin cargas no se puede reusar');
  assert.ok(payload, 'deberia emitir el evento');
  assert.equal((payload as { charge: number; intensity: number }).charge, 0);
  assert.equal((payload as { charge: number; intensity: number }).intensity, 1, 'intensidad = SPORE_MULT / 2.5 = 1');
});

test('NO se apila sobre una mano ya armada', () => {
  const engine = newEngine();
  engine.chooseBlind('b1');
  assert.equal(engine.useFungiFlush(), true);
  assert.equal(engine.useFungiFlush(), false, 'el segundo uso es rechazado');
  assert.equal(engine.fungiFlushCharge(), 0);
});

test('la mano armada entra con el x2.5 de Esporas como un paso mas', () => {
  const engine = newEngine();
  engine.chooseBlind('b1');
  engine.useFungiFlush();
  assert.equal(engine.isFungiFlushArmed(), true);

  const res = (() => {
    setHand(engine, ['sp_a']);
    engine.toggleSelect(engine.round!.hand[0]!.uid);
    return engine.playHand();
  })();
  assert.ok(res, 'la mano se resuelve');

  const flushStep = res!.steps.find((s) => s.sourceId === 'fungi_flush');
  assert.ok(flushStep, 'hay un paso de FungiFlush en el score');
  assert.equal(flushStep!.action, 'MULTIPLY_SPORES');
  assert.equal(flushStep!.value, 2.5, 'el multiplicador es el configurado');

  assert.equal(engine.isFungiFlushArmed(), false, 'la arma se consume en UNA mano');
  assert.equal(engine.fungiFlushCharge(), 0, 'la carga no vuelve sola (combo chico)');
});

test('la recarga solo ocurre con un combo grande (>=3 elemento)', () => {
  const engine = newEngine();
  engine.chooseBlind('b1');

  // Gasta la unica carga: ahora en 0.
  assert.equal(engine.useFungiFlush(), true);
  assert.equal(engine.fungiFlushCharge(), 0);

  // Jugada CHICA (1 carta, sin combo): no recarga.
  play(engine, ['po_a']);
  assert.equal(engine.fungiFlushCharge(), 0, 'sin combo no recarga');

  // Nueva carga para poder volver a armar y probar el combo grande.
  (engine as unknown as { run: { fungiFlushCharge: number } }).run.fungiFlushCharge = 1;
  assert.equal(engine.useFungiFlush(), true);
  assert.equal(engine.fungiFlushCharge(), 0);

  // Jugada GRANDE: 3 cartas del mismo elemento -> element:spore:3 (tier>=3).
  play(engine, ['sp_a', 'sp_b', 'sp_c']);
  assert.equal(engine.fungiFlushCharge(), 1, 'un combo grande recarga +1');
});

test('NO recarga mas alla del tope (MAX_CHARGES = 3)', () => {
  const engine = newEngine();
  engine.chooseBlind('b1');
  // Fuerza tope.
  (engine as unknown as { run: { fungiFlushCharge: number } }).run.fungiFlushCharge = 3;

  // Cierra una mano grande: la recarga NO debe superar el tope.
  play(engine, ['sp_a', 'sp_b', 'sp_c']);
  assert.equal(engine.fungiFlushCharge(), 3, 'se mantiene en el tope');
});

test('al activarse limpia decay y spore_lock del mazo y la mano', () => {
  const engine = newEngine();
  engine.chooseBlind('b1');

  // Estado negativo en una carta de la MANO y en una de la PILA DE ROBO.
  const inHand = engine.round!.hand[0]!;
  inHand.statuses.push({ type: 'decay', value: 2, turnsLeft: 3 });
  const inPile = (engine.run.deck as unknown as { drawPile: Array<{ statuses: Array<{ type: string; value: number; turnsLeft: number }> }> }).drawPile[0]!;
  inPile.statuses.push({ type: 'spore_lock', value: 1, turnsLeft: 2 });

  const expired: Array<{ uid: string; status: string }> = [];
  const off = bus.on('status:expired', (e) => expired.push({ uid: e.uid, status: e.status }));

  try {
    engine.useFungiFlush();
  } finally {
    off();
  }

  assert.equal(inHand.statuses.length, 0, 'la carta de la mano queda limpia');
  assert.equal(inPile.statuses.length, 0, 'la carta del mazo queda limpia');
  const kinds = new Set(expired.map((e) => e.status));
  assert.ok(kinds.has('decay'), 'avisa la salida de decay');
  assert.ok(kinds.has('spore_lock'), 'avisa la salida de spore_lock');
});

test('el guardado/restauracion es ADITIVO y no rompe SAVE_VERSION', () => {
  const engine = newEngine();
  engine.chooseBlind('b1');
  engine.useFungiFlush(); // carga 1->0, armed true
  assert.equal(engine.fungiFlushCharge(), 0);
  assert.equal(engine.isFungiFlushArmed(), true);

  const save = engine.serialize();
  assert.ok('fungiFlushCharge' in save, 'la carga se serializa');
  assert.equal(save.fungiFlushCharge, 0);
  assert.equal(save.fungiFlushArmed, true);

  // Una run nueva restaurada desde ese save conserva lo aditivo.
  const other = newEngine();
  other.startRun(7);
  other.restore(save);
  assert.equal(other.fungiFlushCharge(), 0);
  assert.equal(other.isFungiFlushArmed(), true);

  // Un save VIEJO (sin los campos) cae al default de la run, no a 0 roto.
  const legacy = { ...save } as Record<string, unknown>;
  delete legacy.fungiFlushCharge;
  delete legacy.fungiFlushArmed;
  const legacy2 = newEngine();
  legacy2.startRun(7);
  legacy2.restore(legacy as never);
  assert.equal(legacy2.fungiFlushCharge(), 1, 'save sin campo -> default de run');
  assert.equal(legacy2.isFungiFlushArmed(), false);
});
