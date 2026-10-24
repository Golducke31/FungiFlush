/**
 * motionframes.test.ts — Matematica de las ilustraciones animadas.
 *
 * Lo que se protege aca es lo que decide QUE frame se ve y en que celda de la
 * hoja se dibuja. Es puro (numeros adentro, numeros afuera) justamente para
 * poder verificarlo sin navegador: un off-by-one aca se ve en pantalla como
 * un salto en la ilustracion o como un frame dibujado en la celda equivocada,
 * y ninguna de las dos cosas se detecta con una asercion de "no exploto".
 *
 * Los tres invariantes que importan:
 *
 *   1. `frameIndex` NUNCA se sale de `[0, count)`: es lo que garantiza que la
 *      celda pedida exista en la hoja.
 *   2. Con `pingPong` el recorrido no salta: el ultimo frame no pega contra el
 *      primero, que es el defecto clasico del loop directo.
 *   3. `cellOffset` invierte la fila: la fila 0 de la imagen (arriba) vive en
 *      el offset Y mas alto, porque las UV de THREE tienen el origen abajo.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';

import { cellOffset, frameIndex, type MotionFrameCache } from '../src/render/MotionFrames.ts';
import { Card3D } from '../src/render/Card3D.ts';
import { TIER_CONFIG } from '../src/render/Quality.ts';

// ---------------------------------------------------------------------------
// frameIndex — loop directo
// ---------------------------------------------------------------------------

test('el loop directo avanza un frame por cada 1/fps de segundos', () => {
  // 4 frames a 2 fps: un frame cada 0.5 s.
  assert.equal(frameIndex(0, 2, 4, false), 0);
  assert.equal(frameIndex(0.4, 2, 4, false), 0);
  assert.equal(frameIndex(0.5, 2, 4, false), 1);
  assert.equal(frameIndex(1.0, 2, 4, false), 2);
  assert.equal(frameIndex(1.5, 2, 4, false), 3);
});

test('el loop directo da la vuelta al final', () => {
  // En t = 2.0 van 4 steps exactos: vuelve al frame 0.
  assert.equal(frameIndex(2.0, 2, 4, false), 0);
  assert.equal(frameIndex(2.5, 2, 4, false), 1);
  // Y sigue ciclico mas alla de una vuelta.
  assert.equal(frameIndex(9.0, 2, 4, false), 2);
});

test('un tiempo negativo no rompe el indice (el reloj puede arrancar raro)', () => {
  // floor(-1) = -1, y -1 mod 4 tiene que dar 3, no -1: un indice negativo
  // dibujaria una celda que no existe.
  assert.equal(frameIndex(-0.5, 2, 4, false), 3);
  // -1.5 s a 2 fps = -3 steps: -3 mod 4 = 1.
  assert.equal(frameIndex(-1.5, 2, 4, false), 1);
});

test('con un solo frame, o sin fps, la ilustracion queda quieta', () => {
  assert.equal(frameIndex(12.5, 6, 1, false), 0);
  assert.equal(frameIndex(12.5, 6, 1, true), 0);
  assert.equal(frameIndex(12.5, 0, 6, false), 0);
  assert.equal(frameIndex(12.5, -3, 6, true), 0);
});

// ---------------------------------------------------------------------------
// frameIndex — ping-pong
// ---------------------------------------------------------------------------

test('el ping-pong recorre 0..N-1 y vuelve sin saltar', () => {
  // 5 frames a 1 fps: 0,1,2,3,4,3,2,1 y ahi da la vuelta.
  const recorrido = [0, 1, 2, 3, 4, 5, 6, 7].map((s) => frameIndex(s, 1, 5, true));
  assert.deepEqual(recorrido, [0, 1, 2, 3, 4, 3, 2, 1]);
  // El ciclo mide 2N-2 = 8: en t = 8 se repite el 0.
  assert.equal(frameIndex(8, 1, 5, true), 0);
  assert.equal(frameIndex(9.5, 1, 5, true), 1);
});

test('el ping-pong de dos frames es indistinguible del loop directo', () => {
  // Con N = 2 el ciclo mide 2: no hay frame intermedio que recorrer.
  assert.equal(frameIndex(0, 1, 2, true), 0);
  assert.equal(frameIndex(1, 1, 2, true), 1);
  assert.equal(frameIndex(2, 1, 2, true), 0);
});

test('el ping-pong tambien aguanta tiempos negativos', () => {
  assert.equal(frameIndex(-1, 1, 5, true), 1);
  assert.equal(frameIndex(-3, 1, 5, true), 3);
});

// ---------------------------------------------------------------------------
// Invariante: el indice siempre cae dentro de la hoja
// ---------------------------------------------------------------------------

test('barriendo varios minutos de reloj, el indice nunca se sale de la hoja', () => {
  for (const count of [2, 3, 4, 6, 12]) {
    for (const fps of [3, 6, 12]) {
      for (const pingPong of [false, true]) {
        for (let step = 0; step < 600; step += 1) {
          const time = step * 0.37;
          const frame = frameIndex(time, fps, count, pingPong);
          assert.ok(
            Number.isInteger(frame) && frame >= 0 && frame < count,
            `fuera de rango: count=${count} fps=${fps} pingPong=${pingPong} t=${time} -> ${frame}`,
          );
        }
      }
    }
  }
});

// ---------------------------------------------------------------------------
// cellOffset — la celda dentro de la grilla
// ---------------------------------------------------------------------------

test('la celda 0 de una grilla 3x2 es la esquina de ARRIBA a la izquierda', () => {
  // Y invertida: la fila 0 de la imagen vive en el offset Y mas alto.
  const cell = cellOffset(0, 3, 2);
  assert.equal(cell.x, 0);
  assert.equal(cell.y, 0.5);
});

test('las celdas recorren la grilla como se lee', () => {
  // Fila 0 (arriba): offsets Y = 0.5.
  assert.deepEqual(cellOffset(1, 3, 2), { x: 1 / 3, y: 0.5 });
  assert.deepEqual(cellOffset(2, 3, 2), { x: 2 / 3, y: 0.5 });
  // Fila 1 (abajo): offsets Y = 0.
  assert.deepEqual(cellOffset(3, 3, 2), { x: 0, y: 0 });
  assert.deepEqual(cellOffset(4, 3, 2), { x: 1 / 3, y: 0 });
  assert.deepEqual(cellOffset(5, 3, 2), { x: 2 / 3, y: 0 });
});

test('el offset mas el repeat siempre cubre la celda exacta', () => {
  // Es la cuenta que hace el sampler: offset + repeat = el borde de la celda.
  // Si no cerrara, dos celdas se solaparian o quedaria un hueco entre ellas.
  for (const [cols, rows] of [
    [3, 2],
    [4, 3],
    [6, 1],
    [1, 4],
  ] as const) {
    const repeatX = 1 / cols;
    const repeatY = 1 / rows;
    for (let index = 0; index < cols * rows; index += 1) {
      const cell = cellOffset(index, cols, rows);
      assert.ok(cell.x >= 0 && cell.x + repeatX <= 1 + 1e-9, `x fuera: ${cols}x${rows} #${index}`);
      assert.ok(cell.y >= 0 && cell.y + repeatY <= 1 + 1e-9, `y fuera: ${cols}x${rows} #${index}`);
    }
  }
});

test('una grilla degenerada (0 columnas o filas) no divide por cero', () => {
  // El manifiesto puede traer basura; lo que no puede pasar es un NaN, porque
  // un offset NaN apaga la textura entera. Con 0 columnas se trata como 1.
  for (const [index, cols, rows] of [
    [0, 0, 0],
    [0, 3, 0],
    [0, 0, 2],
    [1, 0, 2],
  ] as const) {
    const cell = cellOffset(index, cols, rows);
    assert.ok(Number.isFinite(cell.x) && Number.isFinite(cell.y), `NaN en ${cols}x${rows} #${index}`);
    assert.ok(cell.x >= 0 && cell.x <= 1, `x fuera de 0..1 en ${cols}x${rows} #${index}`);
    assert.ok(cell.y >= 0 && cell.y <= 1, `y fuera de 0..1 en ${cols}x${rows} #${index}`);
  }
  // Con una sola fila valida no hay nada que invertir: el offset Y es 0.
  assert.deepEqual(cellOffset(0, 3, 0), { x: 0, y: 0 });
});

// ---------------------------------------------------------------------------
// Tiers: la animacion se apaga en `low`
// ---------------------------------------------------------------------------

test('`low` no anima la ilustracion (es el camino de render de siempre)', () => {
  assert.equal(TIER_CONFIG.low.animatedArt, false);
  assert.equal(TIER_CONFIG.low.motionBudget, 0);
});

test('`medium` y `high` animan, con presupuesto creciente', () => {
  assert.equal(TIER_CONFIG.medium.animatedArt, true);
  assert.equal(TIER_CONFIG.high.animatedArt, true);
  assert.ok(TIER_CONFIG.medium.motionBudget >= 1);
  assert.ok(TIER_CONFIG.high.motionBudget > TIER_CONFIG.medium.motionBudget);
});

// ---------------------------------------------------------------------------
// Ciclo de reserva (acquire/release): sin reservas fantasma
// ---------------------------------------------------------------------------

/**
 * Cache de MotionFrames stub: registra lo que la carta pide y suelta, y decide
 * si concede la reserva. Con `grant = false` simula los dos casos en que
 * `acquire` falla SIN reservar nada: presupuesto del tier lleno y hoja que
 * todavia no decodifico.
 */
function stubCache(grant: boolean) {
  const acquired: (string | undefined)[] = [];
  const released: (string | undefined)[] = [];
  const cache = {
    acquire(src: string | undefined) {
      acquired.push(src);
      if (!grant || !src) return undefined;
      return { cols: 2, rows: 2, fps: 6, pingPong: true, texture: new THREE.Texture() };
    },
    release(src: string | undefined) {
      released.push(src);
    },
  };
  return { cache: cache as unknown as MotionFrameCache, acquired, released };
}

/**
 * White-box a proposito: `applyMotion` es privado y su unico camino publico
 * (`setCard`) hornea la cara en un canvas, que no existe en node. Lo que se
 * verifica es el CONTRATO con el cache de reservas, no el dibujo.
 */
function applier(card: Card3D) {
  return (card as unknown as { applyMotion(art: HTMLImageElement | undefined): void }).applyMotion.bind(card);
}
// `naturalWidth: 0` = "la imagen no decodifico": es el caso que ademas hace
// que `normalMapFor` devuelva null sin hornear nada (sin DOM en node).
const art = (src: string) => ({ src, naturalWidth: 0 }) as unknown as HTMLImageElement;

test('un acquire que falla NO deja reserva fantasma', () => {
  const { cache, released } = stubCache(false);
  const card = new Card3D('u1', 'card', 0x22c55e, 'common');
  card.setMotionSource(cache);
  released.length = 0;

  const applyMotion = applier(card);
  applyMotion(art('art/art_common.webp'));
  applyMotion(art('art/art_rare.webp'));

  // Nunca se reservo nada, asi que no hay nada que soltar. Con la reserva
  // fantasma el segundo `applyMotion` soltaba 'art/art_common.webp' —un
  // archivo que reservo OTRA carta— y le dispose la textura en uso: esa
  // textura quedaba huerfana (referenciada por un material pero fuera de la
  // cache, sin nadie que la liberara). Es el +3 de texturas vivas que
  // probe-leak veia en `medium` y no en `low`.
  assert.deepEqual(released, []);

  card.dispose();
  assert.deepEqual(released, []);
});

test('la reserva concedida se suelta al cambiar de arte y al disposing la carta', () => {
  const { cache, released } = stubCache(true);
  const card = new Card3D('u2', 'card', 0x22c55e, 'common');
  card.setMotionSource(cache);
  released.length = 0;

  const applyMotion = applier(card);
  applyMotion(art('art/a.webp'));
  applyMotion(art('art/b.webp'));
  assert.deepEqual(released, ['art/a.webp']);

  card.dispose();
  assert.deepEqual(released, ['art/a.webp', 'art/b.webp']);
});
