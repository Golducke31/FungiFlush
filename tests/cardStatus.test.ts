/**
 * cardStatus.test.ts — Los estados de carta AVISAN (P2.6).
 *
 * Antes los estados se mutaban EN SILENCIO: `APPLY_STATUS` y `CONSUME_STATUS`
 * tocaban `card.statuses` y nadie se enteraba, asi que el render solo podia
 * repintar el chip cuando volvia a dibujar la cara. No habia forma de animar el
 * MOMENTO (aplicarse, cosecharse, expirar).
 *
 * Este test fija las dos propiedades que importan:
 *   1. jugar la mano SI emite los eventos,
 *   2. el PREVIEW no: `previewSelection()` corre la resolucion entera en
 *      `dryRun`, y animar algo que no paso seria mentirle al jugador.
 *
 *   npm test
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { GameEngine } from '../src/engine/GameEngine.ts';
import { bus } from '../src/engine/events.ts';
import type { CardDefinition, CardInstance, ContentBundle } from '../src/engine/index.ts';

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
    copies: 30,
    ...overrides,
  };
}

function bundleWith(cards: CardDefinition[]): ContentBundle {
  return {
    cards,
    jokers: [],
    blinds: [
      { id: 'b1', nameKey: 'blind.b1.name', descKey: 'blind.b1.desc', ante: 1, scoreMultiplier: 1, reward: 3 },
    ],
    anteTargets: { 1: 1000 },
  };
}

/** Arranca una run y deja la ronda en `playing` con la mano repartida. */
function started(cards: CardDefinition[]): GameEngine {
  const engine = new GameEngine({ seed: 5, bundle: bundleWith(cards) });
  engine.startRun(5);
  engine.chooseBlind('b1');
  return engine;
}

/**
 * La pila de robo. `Deck.drawPile` es privado (y TS lo ve), asi que se entra por
 * un cast: `decayStatuses` recorre ESA lista, y es la unica forma de armar el
 * caso sin ganar un ciego entero y pasar por el draft.
 */
function drawPileOf(engine: GameEngine): CardInstance[] {
  return (engine.run.deck as unknown as { drawPile: CardInstance[] }).drawPile;
}

test('el PREVIEW no MUTA la carta (bug de putrefaccion que se acumulaba)', () => {
  // Mismo fixture que el test de eventos, pero aca se mira la CARTA. El bug:
  // `APPLY_STATUS` mutaba la instancia aunque `dryRun` fuera true, asi que
  // SELECCIONAR una carta de putrefaccion la dejaba podrida de verdad, y como
  // el estado es permanente y se acumulaba en cada preview, la mano terminaba
  // puntuando 0.
  const rotter = card('fixture_rotter_mut', {
    effects: [
      {
        id: 'fixture_rot_mut',
        trigger: 'ON_PLAY',
        actions: [{ type: 'APPLY_STATUS', status: 'decay', value: 2, turns: -1 }],
      },
    ],
  });
  const engine = started([rotter]);

  const first = engine.roundSnapshot().hand[0];
  assert.ok(first, 'hay una carta en la mano');
  const target = engine.run.deck.allCards.find((c) => c.uid === first.uid) ?? first;
  assert.equal(target.statuses.length, 0, 'arranca sin estados');

  // Muchos previews (el HUD corre uno por cada cambio de seleccion).
  for (let i = 0; i < 5; i += 1) {
    engine.toggleSelect(first.uid);
    engine.previewSelection();
    engine.toggleSelect(first.uid);
  }
  assert.equal(
    target.statuses.length,
    0,
    'el preview NO puede dejar el estado puesto en la carta',
  );

  // Jugar SI lo aplica, una sola vez.
  engine.toggleSelect(first.uid);
  engine.playHand();
  const applied = target.statuses.find((s) => s.type === 'decay');
  assert.ok(applied, 'jugar la mano aplica la putrefaccion');
  assert.equal(applied?.value, 2, 'y con el valor del efecto, sin multiplicarse');
});

test('aplicar un estado emite status:applied, pero el PREVIEW no', () => {
  // Sin `target`, el efecto se aplica a la propia carta: determinista.
  const rotter = card('fixture_rotter', {
    effects: [
      {
        id: 'fixture_rot',
        trigger: 'ON_PLAY',
        actions: [{ type: 'APPLY_STATUS', status: 'decay', value: 2, turns: -1 }],
      },
    ],
  });
  const engine = started([rotter]);

  const applied: Array<{ uid: string; status: string; value: number; turns: number }> = [];
  const off = bus.on('status:applied', (event) => {
    applied.push({ uid: event.uid, status: event.status, value: event.value, turns: event.turns });
  });

  const first = engine.roundSnapshot().hand[0];
  assert.ok(first, 'hay una carta en la mano');

  // El preview corre la resolucion ENTERA en dryRun (asi el HUD estima el score
  // en cada cambio de seleccion). No puede disparar animaciones.
  engine.toggleSelect(first.uid);
  engine.previewSelection();
  assert.equal(applied.length, 0, 'el preview NO puede emitir status:applied');

  engine.playHand();
  assert.equal(applied.length, 1, 'jugar la mano emite status:applied una vez');
  assert.equal(applied[0]?.status, 'decay');
  assert.equal(applied[0]?.value, 2);
  assert.equal(applied[0]?.turns, -1);
  assert.equal(applied[0]?.uid, first.uid, 'el evento apunta a la carta afectada');

  off();
});

test('cosechar un estado emite status:consumed con el recurso ganado', () => {
  const harvester = card('fixture_harvester', {
    effects: [
      {
        id: 'fixture_harvest',
        trigger: 'ON_HAND_SCORED',
        conditions: [{ type: 'has_status', status: 'decay' }],
        actions: [{ type: 'CONSUME_STATUS', status: 'decay', gain: 'spores', value: 4, full: true }],
      },
    ],
  });
  const engine = started([harvester]);

  // La podredumbre se pone a mano: lo que se prueba es el AVISO, no quien la puso.
  for (const c of engine.roundSnapshot().hand) {
    c.statuses.push({ type: 'decay', value: 3, turnsLeft: -1 });
  }

  const consumed: Array<{ status: string; stacks: number; gainKind: string }> = [];
  const off = bus.on('status:consumed', (event) => {
    consumed.push({ status: event.status, stacks: event.stacks, gainKind: event.gainKind });
  });

  const first = engine.roundSnapshot().hand[0];
  assert.ok(first);
  engine.toggleSelect(first.uid);
  engine.playHand();

  assert.ok(consumed.length > 0, 'se emitio status:consumed');
  assert.equal(consumed[0]?.status, 'decay');
  assert.equal(consumed[0]?.gainKind, 'spores');
  assert.equal(consumed[0]?.stacks, 3, 'se cosecharon las 3 pilas');
  assert.equal(first.statuses.length, 0, 'la carta quedo limpia');

  off();
});

test('un estado temporal se agota y emite status:expired', () => {
  const engine = started([card('fixture_plain')]);

  // La carta va en la PILA DE ROBO a proposito: `decayStatuses` recorre
  // `deck.allCards` (robo + descarte), que es donde estan las cartas entre
  // ciegos — la mano se conserva al mazo antes de que corra.
  const target = drawPileOf(engine)[0];
  assert.ok(target, 'hay una carta en la pila de robo');
  target.statuses.push({ type: 'decay', value: 1, turnsLeft: 1 });

  const expired: Array<{ uid: string; status: string }> = [];
  const off = bus.on('status:expired', (event) => expired.push({ uid: event.uid, status: event.status }));

  // Se llama directo al paso entre ciegos: el flujo real exige ganar el ciego y
  // pasar por el draft, y lo unico que se prueba aca es que el agotamiento AVISA.
  // `decayStatuses` es privado, pero TS borra `private` en runtime.
  (engine as unknown as { decayStatuses(): void }).decayStatuses();

  assert.equal(expired.length, 1, 'el estado agotado avisa una vez');
  assert.equal(expired[0]?.status, 'decay');
  assert.equal(expired[0]?.uid, target.uid);
  assert.equal(target.statuses.length, 0, 'el estado salio de la carta');

  off();
});

test('un estado PERMANENTE (turnsLeft -1) nunca expira', () => {
  const engine = started([card('fixture_plain')]);

  const target = drawPileOf(engine)[0];
  assert.ok(target, 'hay una carta en la pila de robo');
  target.statuses.push({ type: 'decay', value: 1, turnsLeft: -1 });

  const expired: string[] = [];
  const off = bus.on('status:expired', (event) => expired.push(event.status));

  const decay = engine as unknown as { decayStatuses(): void };
  decay.decayStatuses();
  decay.decayStatuses();
  decay.decayStatuses();

  assert.equal(expired.length, 0, 'un estado permanente no expira');
  assert.equal(target.statuses.length, 1, 'sigue en la carta');

  off();
});
