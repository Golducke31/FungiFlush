/**
 * fx.test.ts — Nucleo de FX: `fxTween` y `sleep`.
 *
 * Lo que se protege aca es UNA propiedad y es la que hace posible el hit-stop:
 * los `sleep` de una secuencia NO corren con el reloj real, los mueve el mismo
 * `dt` que el resto de la escena. Si alguien los cambiara por `setTimeout`, la
 * secuencia seguiria avanzando durante el congelamiento y al reanudar se veria
 * el salto — y eso no lo detecta ningun smoke test.
 *
 * Todo es puro: se avanza el reloj a mano con `updateAnim(dt)`, igual que lo
 * hace el loop de `SceneManager`. No hace falta navegador ni WebGL.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { fxTween, setReduceMotion, sleep, updateAnim } from '../src/render/anim.ts';

/** Avanza el reloj de GSAP en pasos de 16 ms (un frame a 60 FPS). */
function advance(frames: number, dt = 0.016): void {
  for (let i = 0; i < frames; i++) updateAnim(dt);
}

test('fxTween recorre 0..1, llama al callback y resuelve', async () => {
  const seen: number[] = [];
  let done = false;
  const promise = fxTween(100, (p) => seen.push(p)).then(() => {
    done = true;
  });

  // 100 ms a 16 ms por frame = ~7 frames. Se dan 20 para no depender del redondeo.
  advance(20);
  await promise;

  assert.equal(done, true, 'la promesa tiene que resolver');
  assert.ok(seen.length > 1, `el callback corre por frame (vio ${seen.length})`);
  assert.ok(seen[0]! >= 0 && seen[0]! < 0.3, `arranca cerca de 0 (vio ${seen[0]})`);
  assert.ok(seen[seen.length - 1]! > 0.9, `termina cerca de 1 (vio ${seen[seen.length - 1]})`);
});

test('sleep es un TWEEN, no un timer: el reloj real no lo avanza', async () => {
  let done = false;
  const promise = sleep(100).then(() => {
    done = true;
  });

  // Mucho mas que los 100 ms pedidos, pero de tiempo REAL.
  await new Promise((resolve) => setTimeout(resolve, 180));
  assert.equal(done, false, 'sin updateAnim el sleep tiene que seguir pendiente');

  advance(10);
  await promise;
  assert.equal(done, true, 'con el reloj inyectado resuelve');
});

test('un sleep congelado retoma donde estaba (simula el hit-stop)', async () => {
  let done = false;
  const promise = sleep(160).then(() => {
    done = true;
  });

  advance(3); // 48 ms
  assert.equal(done, false);

  // Hit-stop: el loop NO llama a updateAnim durante un rato.
  await new Promise((resolve) => setTimeout(resolve, 120));
  assert.equal(done, false, 'el congelamiento no consume el sleep');

  // Al reanudar hacen falta los ms que FALTABAN, no los que pasaron de verdad.
  advance(8); // 128 ms mas = 176 total
  await promise;
  assert.equal(done, true);
});

test('con reduceMotion el tween resuelve igual (duracion minima)', async () => {
  setReduceMotion(true);
  const seen: number[] = [];
  let done = false;
  const promise = fxTween(500, (p) => seen.push(p)).then(() => {
    done = true;
  });

  advance(2);
  await promise;
  setReduceMotion(false);

  assert.equal(done, true, 'el estado final se alcanza aunque se acorte');
  assert.ok(seen[seen.length - 1]! > 0.9, 'el callback igual llega a 1');
});
