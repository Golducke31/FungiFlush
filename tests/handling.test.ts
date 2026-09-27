/**
 * handling.test.ts — Fase 4: zonas de destino y descarte puntual.
 *
 * Dos cosas se protegen aca, y las dos son de las que se rompen en silencio:
 *
 *   1. RESOLUCION DE ZONAS — que zona gana cuando dos se superponen (el
 *      descarte vive dentro de la banda de la mano) y que una zona que no
 *      acepta la carta no la capture.
 *   2. `discardCards(uids)` — que descarte UNA carta sin limpiar el resto de la
 *      seleccion. Es el camino que usa el arrastre al descarte, y el bug
 *      clasico seria descartar toda la seleccion por arrastrar una sola.
 *
 * El gesto en si (puntero, raycasting, culling del dorso) solo se puede probar
 * en un navegador: eso lo cubre `tools/smoke.mjs`.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { GameEngine } from '../src/engine/GameEngine.ts';
import { rectContains, resolveDropZone } from '../src/render/DropZone.ts';
import type { DropZoneHandle, ZoneRect } from '../src/render/DropZone.ts';
import type { Card3D } from '../src/render/Card3D.ts';
import type { CardDefinition, ContentBundle } from '../src/engine/index.ts';

// ---------------------------------------------------------------------------
// Resolucion de zonas (pura)
// ---------------------------------------------------------------------------

/** `resolveDropZone` nunca mira dentro de la carta: alcanza una falsa. */
function fakeCard(id: string): Card3D {
  return { uid: id, kind: 'card' } as unknown as Card3D;
}

function zone(
  id: DropZoneHandle['id'],
  rect: ZoneRect,
  accepts: (card: Card3D) => boolean = () => true,
): DropZoneHandle {
  return { id, rect, accepts, highlight: () => {} };
}

const DISCARD: ZoneRect = { minX: -10.8, maxX: -4.8, minZ: 0.0, maxZ: 4.8 };
const PLAY: ZoneRect = { minX: -9.5, maxX: 9.5, minZ: -4.8, maxZ: 1.4 };
const HAND: ZoneRect = { minX: -12, maxX: 12, minZ: 1.4, maxZ: 7.5 };

test('rectContains respeta los cuatro bordes', () => {
  const rect: ZoneRect = { minX: -1, maxX: 1, minZ: -2, maxZ: 2 };
  assert.equal(rectContains(rect, 0, 0), true);
  assert.equal(rectContains(rect, -1, -2), true, 'las esquinas entran');
  assert.equal(rectContains(rect, 1, 2), true);
  assert.equal(rectContains(rect, 1.01, 0), false);
  assert.equal(rectContains(rect, 0, -2.01), false);
});

test('un punto fuera de toda zona no resuelve', () => {
  const zones = [zone('discard', DISCARD), zone('play', PLAY), zone('hand', HAND)];
  const card = fakeCard('c1');
  assert.equal(resolveDropZone(zones, 0, 20, card), null);
  assert.equal(resolveDropZone(zones, 40, 0, card), null);
});

test('el descarte gana en su esquina aunque la banda de la mano lo contenga', () => {
  const zones = [zone('discard', DISCARD), zone('play', PLAY), zone('hand', HAND)];
  const card = fakeCard('c1');

  // (-7.8, 2.4) es el centro del pilar de descarte, y cae dentro de HAND.
  const hit = resolveDropZone(zones, -7.8, 2.4, card);
  assert.equal(hit?.id, 'discard');
});

test('el orden de la lista es la prioridad, no la cercania', () => {
  const card = fakeCard('c1');
  const a = zone('play', PLAY);
  const b = zone('hand', HAND);
  const overlapX = 0;
  const overlapZ = 1.4; // borde compartido

  assert.equal(resolveDropZone([a, b], overlapX, overlapZ, card)?.id, 'play');
  assert.equal(resolveDropZone([b, a], overlapX, overlapZ, card)?.id, 'hand');
});

test('una zona que no acepta la carta se saltea y gana la siguiente', () => {
  const card = fakeCard('c1');
  const rejectAll = zone('discard', DISCARD, () => false);
  const acceptAll = zone('hand', HAND);

  const hit = resolveDropZone([rejectAll, acceptAll], -7.8, 2.4, card);
  assert.equal(hit?.id, 'hand', 'la carta deberia caer en la zona que si la acepta');
});

test('si ninguna zona acepta, la carta vuelve (null)', () => {
  const card = fakeCard('c1');
  const zones = [zone('play', PLAY, () => false), zone('hand', HAND, () => false)];
  assert.equal(resolveDropZone(zones, 0, 3, card), null);
});

test('la zona de juego cubre el centro de la mesa y no la mano', () => {
  const zones = [zone('play', PLAY), zone('hand', HAND)];
  const card = fakeCard('c1');
  assert.equal(resolveDropZone(zones, 0, -0.6, card)?.id, 'play');
  assert.equal(resolveDropZone(zones, 0, 3.0, card)?.id, 'hand');
});

// ---------------------------------------------------------------------------
// discardCards: descarte puntual desde el arrastre
// ---------------------------------------------------------------------------

function card(id: string, copies: number): CardDefinition {
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
    copies,
  };
}

function engineFixture(): GameEngine {
  const bundle: ContentBundle = {
    cards: [card('alpha', 8), card('beta', 8)],
    jokers: [],
    blinds: [
      { id: 'b1', nameKey: 'blind.b1.name', descKey: 'blind.b1.desc', ante: 1, scoreMultiplier: 1, reward: 3 },
    ],
    anteTargets: { 1: 100 },
  };
  const engine = new GameEngine({ seed: 7, bundle });
  engine.startRun(7);
  engine.chooseBlind('b1');
  return engine;
}

test('discardCards descarta SOLO la carta pedida', () => {
  const engine = engineFixture();
  const round = engine.round;
  assert.ok(round);

  const before = round.hand.length;
  const target = round.hand[0];
  assert.ok(target);

  const res = engine.discardCards([target.uid]);

  assert.ok(res, 'el descarte deberia resolverse');
  assert.equal(round.discardsLeft, 2, 'se gasta UN descarte');
  assert.equal(round.cardsDiscardedThisRound, 1);
  assert.equal(round.hand.length, before, 'la mano se rellena');
  assert.ok(
    !round.hand.some((c) => c.uid === target.uid),
    'la carta descartada no puede seguir en la mano',
  );
});

test('discardCards NO toca el resto de la seleccion', () => {
  const engine = engineFixture();
  const round = engine.round;
  assert.ok(round);

  const [a, b, c] = round.hand;
  assert.ok(a && b && c);

  engine.toggleSelect(a.uid);
  engine.toggleSelect(b.uid);
  engine.toggleSelect(c.uid);
  assert.equal(round.selected.length, 3);

  // Se descarta la del medio, como si el jugador la hubiera arrastrado.
  engine.discardCards([b.uid]);

  assert.deepEqual(round.selected, [a.uid, c.uid], 'a y c siguen seleccionadas');
  assert.ok(!round.selected.includes(b.uid));
});

test('discardSelected sigue descartando toda la seleccion (regresion)', () => {
  const engine = engineFixture();
  const round = engine.round;
  assert.ok(round);

  const picked = round.hand.slice(0, 2);
  for (const c of picked) engine.toggleSelect(c.uid);

  engine.discardSelected();

  assert.equal(round.selected.length, 0);
  assert.equal(round.cardsDiscardedThisRound, 2);
  assert.equal(round.discardsLeft, 2);
});

test('discardCards sin uids validos devuelve null y no gasta el descarte', () => {
  const engine = engineFixture();
  const round = engine.round;
  assert.ok(round);

  assert.equal(engine.discardCards([]), null);
  assert.equal(engine.discardCards(['no_existe']), null);
  assert.equal(round.discardsLeft, 3, 'un drop fallido no puede costar un descarte');
});

test('discardCards ignora uids repetidos', () => {
  const engine = engineFixture();
  const round = engine.round;
  assert.ok(round);

  const target = round.hand[0];
  assert.ok(target);
  engine.discardCards([target.uid, target.uid, target.uid]);

  assert.equal(round.cardsDiscardedThisRound, 1);
  assert.equal(round.discardsLeft, 2);
});

test('sin descartes disponibles, discardCards no hace nada', () => {
  const engine = engineFixture();
  const round = engine.round;
  assert.ok(round);

  round.discardsLeft = 0;
  const target = round.hand[0];
  assert.ok(target);

  assert.equal(engine.discardCards([target.uid]), null);
  assert.ok(round.hand.some((c) => c.uid === target.uid));
});

test('fuera de la partida (shop) discardCards se rechaza', () => {
  const engine = engineFixture();
  const round = engine.round;
  assert.ok(round);

  const target = round.hand[0];
  assert.ok(target);

  // Se fuerza el estado: el unico camino real a 'shop' es terminar el blind.
  engine.run.status = 'shop';
  assert.equal(engine.discardCards([target.uid]), null);
});
