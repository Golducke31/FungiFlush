/**
 * cardFx.test.ts — Efectos de vuelo de V3: anillos de impacto, estela y tick.
 *
 * Tres invariantes, y los tres son cosas que se ROMPEN sin que nada explote:
 *
 *   1. El pool de anillos NUNCA crece. Si alguien "lo arregla" creando un mesh
 *      por impacto, el juego empieza a dar tirones de garbage collector justo
 *      cuando el jugador mira el aterrizaje. El test cuenta hijos del grupo.
 *   2. Los anillos se LIBERAN solos. Un slot que no se recicla es un anillo
 *      menos para el siguiente combo, y con 8 se agota en una mano larga.
 *   3. El tick de seleccion REBOTA (pasa por un valle negativo). Si alguien lo
 *      cambia por un pulso de un solo signo, deja de leerse como un rebote
 *      elastico y pasa a leerse como un fundido: se ve "bien", no se SIENTE.
 *
 * El cuarto test fija el eje de rotacion de la carta, que es un error facil de
 * cometer y imposible de ver en el código: con la carta acostada sobre la
 * mesa, `ry` es el eje que la DA VUELTA y `rz` el que la hace girar en plano.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';

import { ImpactRings } from '../src/render/ImpactRings.ts';
import { SELECT_TICK_END, selectTickAmplitude } from '../src/render/Card3D.ts';

// ---------------------------------------------------------------------------
// Pool de anillos
// ---------------------------------------------------------------------------

test('el pool de anillos es FIJO: 8 slots, no importa cuantos impactos haya', () => {
  const rings = new ImpactRings();
  const before = rings.group.children.length;

  // Mano llena: 5 cartas jugadas + 5 pasos de puntaje + festejos.
  for (let i = 0; i < 40; i += 1) {
    rings.spawn(new THREE.Vector3(i * 0.1, 0, 0), 0x6fe0b0, 1);
  }

  assert.equal(rings.group.children.length, before, 'no se creo ni un mesh nuevo');
  assert.equal(before, 8, 'el pool arranca con 8');
  assert.equal(rings.poolUsage.size, 8);

  rings.dispose();
});

test('los anillos se liberan solos: el pool se recicla entre combos', () => {
  const rings = new ImpactRings();
  // 8 impactos simultaneos = pool lleno.
  for (let i = 0; i < 8; i += 1) rings.spawn(new THREE.Vector3(i, 0, 0), 0x6fe0b0);
  assert.equal(rings.activeCount, 8);

  // Medio segundo a 60 FPS: un anillo dura 0.42 s.
  for (let i = 0; i < 30; i += 1) rings.update(0.016);

  assert.equal(rings.activeCount, 0, 'los 8 terminaron su onda');
  // Y el pool sigue sirviendo: un combo nuevo encuentra los 8 libres.
  for (let i = 0; i < 8; i += 1) rings.spawn(new THREE.Vector3(i, 0, 0), 0x6fe0b0);
  assert.equal(rings.activeCount, 8);

  rings.dispose();
});

test('con el pool lleno se recicla el mas viejo (no se descarta el impacto)', () => {
  const rings = new ImpactRings();
  for (let i = 0; i < 8; i += 1) rings.spawn(new THREE.Vector3(i, 0, 0), 0x6fe0b0);
  // El noveno pisa el slot 0, que arranco primero.
  rings.spawn(new THREE.Vector3(99, 0, 0), 0xe05c8a);

  assert.equal(rings.activeCount, 8, 'sigue habiendo 8, no 9');
  // El slot reciclado se movio a la posicion del impacto nuevo.
  const moved = rings.group.children.filter((c) => c.position.x === 99);
  assert.equal(moved.length, 1, 'el slot reciclado adopto la posicion nueva');

  rings.dispose();
});

test('en tier low los anillos no se crean ni se dibujan', () => {
  const rings = new ImpactRings();
  rings.setEnabled(false);

  rings.spawn(new THREE.Vector3(0, 0, 0), 0x6fe0b0);
  assert.equal(rings.activeCount, 0, 'spawn es un no-op');
  assert.equal(rings.group.visible, false, 'el grupo entero deja de dibujarse');

  // Al volver a un tier con efectos, el pool sigue intacto.
  rings.setEnabled(true);
  rings.spawn(new THREE.Vector3(0, 0, 0), 0x6fe0b0);
  assert.equal(rings.activeCount, 1);

  rings.dispose();
});

test('reduceMotion acorta el anillo pero no lo anula (el golpe se sigue viendo)', () => {
  const rings = new ImpactRings();
  rings.setReducedMotion(true);
  rings.spawn(new THREE.Vector3(0, 0, 0), 0x6fe0b0);
  assert.equal(rings.activeCount, 1);

  // 0.12 s de vida: a los 0.2 s ya no queda nada.
  for (let i = 0; i < 13; i += 1) rings.update(0.016);
  assert.equal(rings.activeCount, 0);

  rings.dispose();
});

test('el anillo crece mientras vive: es una onda, no un punto', () => {
  const rings = new ImpactRings();
  rings.spawn(new THREE.Vector3(0, 0, 0), 0x6fe0b0, 1);
  const mesh = rings.group.children[0] as THREE.Mesh;
  const first = mesh.scale.x;

  for (let i = 0; i < 10; i += 1) rings.update(0.016);

  assert.ok(mesh.scale.x > first, `crecio de ${first} a ${mesh.scale.x}`);
  assert.ok(mesh.visible, 'sigue visible mientras dura');

  rings.dispose();
});

// ---------------------------------------------------------------------------
// Tick de seleccion
// ---------------------------------------------------------------------------

test('el tick arranca en el pico y rebota: pasa por un valle negativo', () => {
  // Sin el valle negativo es un fundido, no un rebote: la carta se estira y
  // vuelve lento. Con el valle, se estira, se apachina y se estabiliza.
  assert.ok(selectTickAmplitude(0) > 0.9, 'arranca en el pico');

  let min = 1;
  for (let t = 0; t <= SELECT_TICK_END; t += 0.002) min = Math.min(min, selectTickAmplitude(t));
  assert.ok(min < -0.1, `tiene que haber un valle, el minimo fue ${min.toFixed(3)}`);
});

test('el tick es invisible antes de que se lo corte', () => {
  // El corte esta en SELECT_TICK_END. Si la amplitud ahi todavia se notara, el
  // jugador veria la carta pegar un salto al reposo.
  const atEnd = Math.abs(selectTickAmplitude(SELECT_TICK_END));
  assert.ok(atEnd < 0.02, `amplitud al cortar: ${atEnd.toFixed(4)}`);

  // Y antes del corte ya es despreciable bastante antes.
  assert.ok(Math.abs(selectTickAmplitude(0.4)) < 0.1, 'a los 0.4 s ya no se ve');
});

test('un tick negativo (estado inactivo) no estira nada', () => {
  assert.equal(selectTickAmplitude(-1), 0);
  assert.equal(selectTickAmplitude(-0.001), 0);
});

// ---------------------------------------------------------------------------
// Ejes de rotacion de la carta
// ---------------------------------------------------------------------------

/**
 * Con la carta acostada sobre la mesa (`rx = -PI/2`, que es como vive la mano
 * y la zona de juego), los tres ejes hacen cosas MUY distintas y confundirlos
 * arruina la animacion:
 *
 *   - `ry`  DA VUELTA la carta: la normal pasa de apuntar arriba a apuntar
 *          abajo. Es el eje del FLIP (`home.ry + PI * flip`).
 *   - `rz`  la hace GIRAR EN PLANO: la normal sigue apuntando arriba. Es el
 *          eje de la rotacion de la mesa.
 *   - `rx`  la acuesta.
 *
 * El giro del descarte de V3 usa `rz`. Si alguien lo cambia a `ry` creyendo
 * que "girar es rotar en Y", el descarte se convierte en un flip.
 */
test('con la carta acostada, rz gira en plano y ry la da vuelta', () => {
  const faceNormal = (rx: number, ry: number, rz: number): THREE.Vector3 => {
    const e = new THREE.Euler(rx, ry, rz, 'XYZ');
    const m = new THREE.Matrix4().makeRotationFromEuler(e);
    return new THREE.Vector3(0, 0, 1).applyMatrix4(m);
  };

  const flat = -Math.PI / 2;

  // `rz`: la normal se mantiene arriba (con un poco de inclinacion, que es lo
  // que se ve al girar una carta plana sobre la mesa).
  const spun = faceNormal(flat, 0, Math.PI);
  assert.ok(spun.y > 0.9, `rz mantiene la cara arriba (y=${spun.y.toFixed(2)})`);

  // `ry`: media vuelta y la cara mira al suelo.
  const flipped = faceNormal(flat, Math.PI, 0);
  assert.ok(flipped.y < -0.9, `ry da vuelta la carta (y=${flipped.y.toFixed(2)})`);

  // Y una vuelta COMPLETA de rz la deja como estaba: por eso el giro del
  // descarte puede ser de 2*PI sin cambiar el angulo de aterrizaje.
  const full = faceNormal(flat, 0, Math.PI * 2);
  assert.ok(full.distanceTo(faceNormal(flat, 0, 0)) < 1e-6, '2*PI es identidad visual');
});
