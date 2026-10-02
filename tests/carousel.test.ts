/**
 * carousel.test.ts — El anillo de cartas (F1) y su GIRO.
 *
 * El bug de origen: al abrir el mazo tras mejorar una carta, el anillo se
 * paraba en una carta distinta segun como habia quedado la ultima vez. La causa
 * era `setEntries()`, que reseteaba `target` pero NO `rendered`: el tween
 * arrancaba desde el valor de la sesion anterior. Como `focus()` calcula el
 * camino mas corto desde el objetivo actual, el resultado dependia del estado
 * previo ("en algunas cartas se actualiza el carrusel").
 *
 * Se prueba con tarjetas FALSAS: al carrusel solo le importa el uid y que
 * `update()` no explote. No hace falta WebGL ni DOM.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';

import { CardCarousel, type CarouselEntryView } from '../src/render/CardCarousel.ts';

/** Slot falso: lo minimo que `update()` toca. El grupo SI es un Object3D real,
 *  o `THREE.Group.add` avisa por consola en cada slot. */
function fakeCard(uid: string) {
  return {
    uid,
    group: new THREE.Group(),
    home: { x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0, flip: 0, sx: 1, sy: 1, sz: 1, arc: 0 },
    setBaseScale: () => {},
    setFaceUp: () => {},
    snapToHome: () => {},
    update: () => {},
    dispose: () => {},
  };
}

function entries(n: number): CarouselEntryView[] {
  return Array.from({ length: n }, (_, i) => ({ uid: `c${i}`, discovered: true, cardId: `c${i}` }));
}

function makeCarousel() {
  return new CardCarousel({
    createCard: () => fakeCard('slot') as never,
    applyEntry: () => {},
  });
}

test('setEntries deja el anillo en 0 y sin arrastre de la apertura anterior', () => {
  const carousel = makeCarousel();
  carousel.setEntries(entries(10));

  // Se gira a la carta 7 y se deja animar hasta el final.
  carousel.focusAbs(7);
  for (let i = 0; i < 200; i++) carousel.update(1 / 60, i / 60);
  assert.equal(carousel.focusedIndex, 7);

  // Reabrir con OTRO set: tiene que arrancar limpio en la entrada 0, no en 7.
  carousel.setEntries(entries(5));
  assert.equal(carousel.focusedIndex, 0, 'setEntries debe resetear rendered, no solo target');
});

test('focusAbs deja el anillo EXACTAMENTE en la entrada pedida', () => {
  const carousel = makeCarousel();
  carousel.setEntries(entries(12));

  // Tres anclajes seguidos: el resultado no puede depender del anterior.
  for (const target of [5, 2, 11, 3]) {
    carousel.focusAbs(target);
    for (let i = 0; i < 400; i++) carousel.update(1 / 60, i / 60);
    assert.equal(carousel.focusedIndex, target, `deberia quedar en la entrada ${target}`);
  }
});

test('focusAbs es determinista: da igual el historial previo', () => {
  const run = (history: number[]): number => {
    const carousel = makeCarousel();
    carousel.setEntries(entries(10));
    for (const h of [...history, 6]) {
      carousel.focusAbs(h);
      for (let i = 0; i < 300; i++) carousel.update(1 / 60, i / 60);
    }
    return carousel.focusedIndex;
  };

  assert.equal(run([]), 6);
  assert.equal(run([0, 1, 2]), 6, 'un historial de giros cortos no puede cambiar el destino');
  assert.equal(run([9, 8, 7]), 6, 'un historial de giros largos tampoco');
});

test('sin entradas, focusAbs es un no-op seguro', () => {
  const carousel = makeCarousel();
  carousel.setEntries([]);
  carousel.focusAbs(3);
  carousel.update(1 / 60, 0);
  assert.equal(carousel.focusedIndex, 0);
});

test('focusAbs normaliza un indice fuera de rango (anillo)', () => {
  const carousel = makeCarousel();
  carousel.setEntries(entries(5));
  carousel.focusAbs(7); // 7 % 5 = 2
  for (let i = 0; i < 400; i++) carousel.update(1 / 60, i / 60);
  assert.equal(carousel.focusedIndex, 2);
});
