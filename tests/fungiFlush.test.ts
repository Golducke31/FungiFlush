/**
 * fungiFlush.test.ts — Habilidad insignia de la run (boton manual con cargas).
 *
 * A diferencia del dado (que es un Simbionte), FungiFlush es de la RUN: un
 * boton que arma la proxima mano con un gran multiplicador de Esporas, limpia
 * los estados negativos (podredumbre / esterilidad) del mazo y roba cartas.
 *
 * ⚠️ REGLA VIGENTE (rediseno): se puede disparar **una vez por ciego** y SOLO
 * con las cargas al tope (3/3). Arranca en 1, se carga jugando manos con combo
 * grande (elemento>=3 / familia>=4) y, al usarla, las cargas **vuelven a 1**.
 *
 * Lo que se protege aca:
 *   - arranca con 1 carga y NO se puede usar hasta llegar a 3;
 *   - usarla con 3 cargas la resetea a 1, arma la proxima mano y emite
 *     `fungi:flushed`;
 *   - NO se apila sobre una mano ya armada;
 *   - NO se puede usar dos veces en el mismo ciego (aunque vuelva a 3);
 *   - la proxima mano jugada entra con el x2.5 de Esporas (como un paso mas);
 *   - la recarga solo ocurre con un combo grande (elemento>=3 / familia>=4) y
 *     se corta si ya se uso en el ciego;
 *   - limpia `decay` y `spore_lock` del mazo y la mano al activarse;
 *   - el guardado/restauracion es ADITIVO y no rompe `SAVE_VERSION`.
 *
 * Se arma con un bundle minimo y determinista para no depender del pack real.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { GameEngine } from '../src/engine/GameEngine.ts';
import { bus } from '../src/engine/events.ts';
import { FUNGI_FLUSH_MAX_CHARGES } from '../src/engine/constants.ts';
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

/** Fuerza las cargas al tope (3/3), que es la unica condicion para poder usarla. */
function fillCharges(engine: GameEngine): void {
  (engine as unknown as { run: { fungiFlushCharge: number } }).run.fungiFlushCharge =
    FUNGI_FLUSH_MAX_CHARGES;
}

test('arranca con 1 carga y NO se puede usar hasta llegar al tope (3/3)', () => {
  const engine = newEngine();
  engine.chooseBlind('b1');
  assert.equal(engine.fungiFlushCharge(), 1, 'carga inicial = default (1)');
  assert.equal(engine.isFungiFlushArmed(), false);
  assert.equal(engine.canUseFungiFlush(), false, 'con 1/3 esta cargando, no lista');

  fillCharges(engine);
  assert.equal(engine.canUseFungiFlush(), true, 'con 3/3 si se puede usar');
});

test('usarla con 3 cargas la resetea a 1, arma la mano y emite fungi:flushed', () => {
  const engine = newEngine();
  engine.chooseBlind('b1');
  fillCharges(engine);

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

  assert.equal(engine.fungiFlushCharge(), 1, 'las cargas vuelven a 1 (no a 0)');
  assert.equal(engine.isFungiFlushArmed(), true, 'la proxima mano queda armada');
  assert.equal(engine.canUseFungiFlush(), false, 'ya usada: no se puede reusar en el ciego');
  assert.ok(payload, 'deberia emitir el evento');
  assert.equal((payload as { charge: number; intensity: number }).charge, 1);
  assert.equal((payload as { charge: number; intensity: number }).intensity, 1, 'intensidad = SPORE_MULT / 2.5 = 1');
});

test('NO se puede usar DOS VECES en el mismo ciego (aunque vuelva a 3/3)', () => {
  const engine = newEngine();
  engine.chooseBlind('b1');
  fillCharges(engine);

  assert.equal(engine.useFungiFlush(), true);
  // Rellena de nuevo: el flag de "usada en este ciego" sigue mandando.
  fillCharges(engine);
  assert.equal(engine.canUseFungiFlush(), false, 'el ciego ya la consumio');
  assert.equal(engine.useFungiFlush(), false, 'el segundo uso es rechazado');
});

test('NO se apila sobre una mano ya armada', () => {
  const engine = newEngine();
  engine.chooseBlind('b1');
  fillCharges(engine);
  assert.equal(engine.useFungiFlush(), true);
  assert.equal(engine.useFungiFlush(), false, 'el segundo uso es rechazado (ya armada)');
});

test('un ciego NUEVO reabre el uso', () => {
  const engine = newEngine();
  engine.chooseBlind('b1');
  fillCharges(engine);
  assert.equal(engine.useFungiFlush(), true);

  // Juega la mano armada (consume `armed`) y cierra el ciego con un objetivo
  // altisimo: la ronda sigue viva, asi que forzamos el paso a `blind_select`.
  play(engine, ['sp_a']);
  assert.equal(engine.isFungiFlushArmed(), false, 'la arma se consume');

  (engine as unknown as { run: { status: string } }).run.status = 'blind_select';
  engine.chooseBlind('b1');

  assert.equal(engine.run.fungiFlushUsedThisBlind, false, 'el ciego nuevo limpia el uso');
  fillCharges(engine);
  assert.equal(engine.canUseFungiFlush(), true, 'el ciego nuevo reabre el uso');
});

test('la mano armada entra con el x2.5 de Esporas como un paso mas', () => {
  const engine = newEngine();
  engine.chooseBlind('b1');
  fillCharges(engine);
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
  assert.equal(engine.fungiFlushCharge(), 1, 'las cargas quedan en 1 tras usarla');
});

test('la recarga solo ocurre con un combo grande (>=3 elemento)', () => {
  const engine = newEngine();
  engine.chooseBlind('b1');
  // Carga hasta 2: falta una para el tope.
  (engine as unknown as { run: { fungiFlushCharge: number } }).run.fungiFlushCharge = 2;

  // Jugada CHICA (1 carta, sin combo): no recarga.
  play(engine, ['po_a']);
  assert.equal(engine.fungiFlushCharge(), 2, 'sin combo no recarga');

  // Jugada GRANDE: 3 cartas del mismo elemento -> element:spore:3 (tier>=3).
  play(engine, ['sp_a', 'sp_b', 'sp_c']);
  assert.equal(engine.fungiFlushCharge(), 3, 'un combo grande carga +1 (llega al tope)');
});

test('NO recarga mas alla del tope (MAX_CHARGES = 3)', () => {
  const engine = newEngine();
  engine.chooseBlind('b1');
  fillCharges(engine);

  // Cierra una mano grande: la recarga NO debe superar el tope.
  play(engine, ['sp_a', 'sp_b', 'sp_c']);
  assert.equal(engine.fungiFlushCharge(), 3, 'se mantiene en el tope');
});

test('NO recarga si ya se uso en el ciego (la carga no tendria destino)', () => {
  const engine = newEngine();
  engine.chooseBlind('b1');
  fillCharges(engine);
  assert.equal(engine.useFungiFlush(), true);
  assert.equal(engine.fungiFlushCharge(), 1, 'vuelve a 1');

  // La mano que arma gasta la carga... y despues una mano grande NO debe cargar
  // (ya se uso la habilidad en este ciego).
  engine.round!.selected = [];
  play(engine, ['po_a']);
  assert.equal(engine.fungiFlushCharge(), 1, 'sin uso pendiente no se carga');

  play(engine, ['sp_a', 'sp_b', 'sp_c']);
  assert.equal(engine.fungiFlushCharge(), 1, 'ya usada: el combo grande no carga');
});

test('al activarse limpia decay y spore_lock del mazo y la mano', () => {
  const engine = newEngine();
  engine.chooseBlind('b1');
  fillCharges(engine);

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
  fillCharges(engine);
  engine.useFungiFlush(); // 3->1, armed true, usedThisBlind true
  assert.equal(engine.fungiFlushCharge(), 1);
  assert.equal(engine.isFungiFlushArmed(), true);
  assert.equal(engine.run.fungiFlushUsedThisBlind, true);

  const save = engine.serialize();
  assert.ok('fungiFlushCharge' in save, 'la carga se serializa');
  assert.equal(save.fungiFlushCharge, 1);
  assert.equal(save.fungiFlushArmed, true);
  assert.equal(save.fungiFlushUsedThisBlind, true, 'la marca de uso viaja con la run');

  // Una run nueva restaurada desde ese save conserva lo aditivo.
  const other = newEngine();
  other.startRun(7);
  other.restore(save);
  assert.equal(other.fungiFlushCharge(), 1);
  assert.equal(other.isFungiFlushArmed(), true);
  assert.equal(other.run.fungiFlushUsedThisBlind, true);
  assert.equal(other.canUseFungiFlush(), false, 'una run retomada no reabre el uso');

  // Un save VIEJO (sin los campos) cae al default de la run, no a 0 roto.
  const legacy = { ...save } as Record<string, unknown>;
  delete legacy.fungiFlushCharge;
  delete legacy.fungiFlushArmed;
  delete legacy.fungiFlushUsedThisBlind;
  const legacy2 = newEngine();
  legacy2.startRun(7);
  legacy2.restore(legacy as never);
  assert.equal(legacy2.fungiFlushCharge(), 1, 'save sin campo -> default de run');
  assert.equal(legacy2.isFungiFlushArmed(), false);
  assert.equal(legacy2.run.fungiFlushUsedThisBlind, false, 'save sin campo -> no usada');
});
