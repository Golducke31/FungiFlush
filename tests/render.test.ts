/**
 * render.test.ts — Sistema de calidad grafica.
 *
 * Lo que se protege aca es lo que decide si el juego se ve lindo o si se
 * arrastra en un celular, y es imposible de verificar en el smoke test:
 *
 *   1. Que un renderer por SOFTWARE caiga a `low`. No es una optimizacion: es
 *      lo que mantiene usable el smoke (sus aserciones de gestos asumen los
 *      ~12 FPS del baseline; con el composer encima empezarian a leer estados a
 *      mitad de camino).
 *   2. Que `low` sea EXACTAMENTE el camino de render de siempre, para que
 *      ningun dispositivo quede peor que antes de esta fase.
 *   3. Que el monitor de frames no degrade por un pico aislado.
 *
 * Todo es puro: se le pasan numeros y devuelve decisiones. No hace falta
 * navegador ni WebGL.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';

import { SporeField } from '../src/render/Particles.ts';
import {
  FRAME_BUDGET_MS,
  FrameMonitor,
  TIER_CONFIG,
  detectTier,
  nextTierDown,
  resolveQuality,
} from '../src/render/Quality.ts';
import { createNightLut, gradeRgb } from '../src/render/Lut.ts';
import { HALO_INNER_HALO, HALO_INNER_RING, createHaloMaterial } from '../src/render/Shaders.ts';

// ---------------------------------------------------------------------------
// Deteccion por dispositivo
// ---------------------------------------------------------------------------

test('un renderer por software cae a `low` (es lo que mantiene usable el smoke)', () => {
  for (const renderer of [
    'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)',
    'llvmpipe (LLVM 15.0.7, 256 bits)',
    'Microsoft Basic Render Driver',
  ]) {
    const detected = detectTier({ renderer, isMobile: false, deviceMemory: 16, cores: 16 });
    assert.equal(detected.tier, 'low', renderer);
    assert.equal(detected.reason, 'software');
  }
});

test('un celular con poca memoria o pocos nucleos cae a `low`', () => {
  const low = detectTier({ renderer: 'Adreno (TM) 640', isMobile: true, deviceMemory: 4, cores: 8 });
  assert.equal(low.tier, 'low');
  assert.equal(low.reason, 'mobile-low');

  const lowCores = detectTier({ renderer: 'Mali-G78', isMobile: true, deviceMemory: 8, cores: 4 });
  assert.equal(lowCores.tier, 'low');
  assert.equal(lowCores.reason, 'mobile-low');
});

test('un celular capaz recibe `medium` y un desktop grande `high`', () => {
  const phone = detectTier({ renderer: 'Adreno (TM) 740', isMobile: true, deviceMemory: 8, cores: 8 });
  assert.equal(phone.tier, 'medium');
  assert.equal(phone.reason, 'mobile');

  const desktop = detectTier({ renderer: 'NVIDIA GeForce RTX 4070', isMobile: false, deviceMemory: 16, cores: 16 });
  assert.equal(desktop.tier, 'high');
  assert.equal(desktop.reason, 'desktop');
});

test('sin datos del dispositivo se elige el medio, no el alto', () => {
  // `navigator.deviceMemory` no existe en Safari ni en Firefox: si faltara el
  // dato y eso contara como "desktop potente", esos navegadores recibirian el
  // tier mas caro sin ninguna evidencia de que puedan.
  const unknown = detectTier({ renderer: 'Apple M2', isMobile: false });
  assert.equal(unknown.tier, 'medium');
  assert.equal(unknown.reason, 'default');
});

test('el ajuste del jugador gana sobre la deteccion', () => {
  assert.equal(resolveQuality('auto', 'high'), 'high');
  assert.equal(resolveQuality('auto', 'low'), 'low');
  assert.equal(resolveQuality('low', 'high'), 'low');
  assert.equal(resolveQuality('high', 'low'), 'high');
});

test('nextTierDown baja de a un paso y se detiene en `low`', () => {
  assert.equal(nextTierDown('high'), 'medium');
  assert.equal(nextTierDown('medium'), 'low');
  assert.equal(nextTierDown('low'), null, 'no hay a donde bajar desde low');
});

// ---------------------------------------------------------------------------
// Coherencia de la tabla de tiers
// ---------------------------------------------------------------------------

test('`low` es el camino de render de siempre: sin composer y sin bloom', () => {
  const low = TIER_CONFIG.low;
  assert.equal(low.composer, false);
  assert.equal(low.bloom, false);
  assert.equal(low.bloomIterations, 0);
  assert.equal(low.gradeMix, 0);
  assert.equal(low.contactShadows, false);
  // El DPR de `low` es el que el juego ya usaba en movil: subirlo seria
  // perder frames "gratis".
  assert.equal(low.maxDpr, 1.75);
});

test('los tiers con composer tienen bloom, y los que no, cero iteraciones', () => {
  for (const [tier, config] of Object.entries(TIER_CONFIG)) {
    assert.equal(config.bloom, config.bloomIterations > 0, `${tier}: bloom e iteraciones tienen que ir juntos`);
    if (config.composer) {
      assert.ok(config.bloom, `${tier}: un tier con composer sin bloom no tiene sentido`);
      assert.ok(config.bloomThreshold >= 0.5, `${tier}: un umbral bajo hace que el bloom se coma la mesa oscura`);
    }
    assert.ok(config.maxDpr > 0 && config.maxDpr <= 2, `${tier}: DPR fuera de rango`);
    assert.ok(config.ambientSpores >= 0 && config.transientSpores > 0, `${tier}: capacidades invalidas`);
    assert.ok(config.gradeMix >= 0 && config.gradeMix <= 1, `${tier}: mezcla de grade fuera de 0..1`);
  }
});

test('el DPR y las particulas crecen con el tier', () => {
  const { low, medium, high } = TIER_CONFIG;
  assert.ok(medium.maxDpr >= low.maxDpr);
  assert.ok(high.maxDpr >= medium.maxDpr);
  assert.ok(medium.ambientSpores >= low.ambientSpores);
  assert.ok(high.ambientSpores > medium.ambientSpores);
  assert.ok(high.transientSpores > low.transientSpores);
});

test('`low` no tiene presupuesto de frame: no se degrada a si mismo', () => {
  assert.equal(FRAME_BUDGET_MS.low, 0);
  const monitor = new FrameMonitor('low');
  for (let i = 0; i < 600; i++) {
    assert.equal(monitor.sample(0.2), null, 'low no puede bajar mas');
  }
});

// ---------------------------------------------------------------------------
// Monitor de frames
// ---------------------------------------------------------------------------

test('un pico aislado no degrada', () => {
  const monitor = new FrameMonitor('medium');
  for (let i = 0; i < 50; i++) monitor.sample(0.008);

  // Un frame de 200 ms (una carga de textura, un GC) no puede tirar el tier.
  assert.equal(monitor.sample(0.2), null);
  for (let i = 0; i < 50; i++) assert.equal(monitor.sample(0.008), null);
});

test('unos segundos sostenidos por encima del presupuesto bajan un tier', () => {
  const monitor = new FrameMonitor('medium');
  for (let i = 0; i < 200; i++) {
    assert.equal(monitor.sample(0.008), null, '8 ms esta holgado en medium');
  }

  // 50 ms por frame contra un presupuesto de 28 ms.
  let downgraded: string | null = null;
  for (let i = 0; i < 400 && downgraded === null; i++) {
    downgraded = monitor.sample(0.05);
  }
  assert.equal(downgraded, 'low');
});

test('el monitor se resetea al bajar, asi no degrada dos veces seguidas', () => {
  const monitor = new FrameMonitor('high');
  for (let i = 0; i < 300; i++) monitor.sample(0.05);
  assert.equal(monitor.secondsOverBudget, 0, 'al degradar se limpia la ventana');
});

test('el p95 no se deja arrastrar por un frame lento', () => {
  const monitor = new FrameMonitor('medium');
  for (let i = 0; i < 89; i++) monitor.sample(0.008);
  monitor.sample(0.4);
  // 89 frames de 8 ms y uno de 400: el p95 sigue siendo 8.
  assert.equal(Math.round(monitor.p95), 8);
});

// ---------------------------------------------------------------------------
// Grade de color (LUT procedural)
// ---------------------------------------------------------------------------

const OUT = [0, 0, 0];

function grade(r: number, g: number, b: number): [number, number, number] {
  gradeRgb(r, g, b, OUT);
  return [OUT[0] ?? 0, OUT[1] ?? 0, OUT[2] ?? 0];
}

test('el grade deja el blanco y el negro en su lugar', () => {
  const white = grade(1, 1, 1);
  assert.ok(white[0] > 0.98 && white[1] > 0.98 && white[2] > 0.98, 'el blanco no puede apagarse');

  const black = grade(0, 0, 0);
  // Las sombras se tinen de teal, pero MUY poco: levantar el negro arruina el
  // fondo oscuro, que es media estetica del juego.
  assert.ok(black[0] < 0.02, 'el rojo no se levanta en el negro');
  assert.ok(black[2] > black[1] && black[1] > black[0], 'el tinte de sombras va hacia el azul-verde');
  assert.ok(black[2] < 0.08, `el negro se levanto demasiado: ${black[2].toFixed(3)}`);
});

test('el grade sube el contraste y no invierte nada', () => {
  const dark = grade(0.25, 0.25, 0.25);
  const mid = grade(0.5, 0.5, 0.5);
  const light = grade(0.75, 0.75, 0.75);

  assert.ok(dark[0] < 0.25, 'por debajo del medio se oscurece');
  assert.ok(light[0] > 0.75, 'por encima del medio se aclara');
  assert.ok(mid[0] > 0.49 && mid[0] < 0.52, 'el medio casi no se mueve');

  // Monotonia: si esto se rompe aparecen bandas y colores invertidos.
  let previous = -1;
  for (let i = 0; i <= 32; i++) {
    const value = grade(i / 32, i / 32, i / 32)[0];
    assert.ok(value >= previous - 1e-6, `el grade no es monotono en ${i / 32}`);
    previous = value;
  }
});

test('el grade siempre devuelve valores validos para la textura', () => {
  for (let i = 0; i <= 16; i++) {
    const value = i / 16;
    const out = grade(value, 1 - value, value * 0.5);
    for (const channel of out) {
      assert.ok(channel >= 0 && channel <= 1, `canal fuera de rango: ${channel}`);
      assert.ok(Number.isFinite(channel), 'canal no finito');
    }
  }
});

test('la textura del LUT tiene el tamano y el orden de canales correctos', () => {
  const texture = createNightLut(4);
  assert.equal(texture.image.width, 4);
  assert.equal(texture.image.height, 4);
  assert.equal(texture.image.depth, 4);

  const data = texture.image.data as Uint8Array;
  assert.equal(data.length, 4 * 4 * 4 * 4, 'RGBA por entrada');

  // El primer texel es el negro (r=g=b=0) y el ultimo el blanco. Si los bucles
  // de llenado estuvieran cruzados, el ultimo texel no seria blanco.
  const last = data.length - 4;
  assert.ok((data[last] ?? 0) > 250 && (data[last + 1] ?? 0) > 250 && (data[last + 2] ?? 0) > 250);
  assert.equal(data[3], 255, 'alpha opaco');

  texture.dispose();
});

// ---------------------------------------------------------------------------
// Halo unificado
// ---------------------------------------------------------------------------

test('el halo unificado conserva el tamaño aparente del original', () => {
  // El quad crecio 1.14x para poder contener tambien el anillo, asi que
  // `uInnerHalo` se divide por esa misma escala. Si alguien toca una sin la
  // otra, el halo salta de tamaño y no hay test que lo note hasta que es
  // evidente en pantalla.
  assert.ok(Math.abs(HALO_INNER_HALO * 1.14 - 0.82) < 1e-9);
  // El anillo ya vivia en un quad escalado 1.14: su valor no se toca.
  assert.equal(HALO_INNER_RING, 0.62);
  // El contorno del halo queda POR FUERA del anillo (era asi antes de fusionar).
  assert.ok(HALO_INNER_HALO > HALO_INNER_RING);
});

test('el halo arranca con el anillo apagado y expone los tres terminos', () => {
  const material = createHaloMaterial({ color: 0x5fd8e8, ringColor: 0x4fd18b, foil: 0.7 });
  const uniforms = material.uniforms;

  for (const name of ['uColor', 'uIntensity', 'uRingColor', 'uRingIntensity', 'uFoilAmount']) {
    assert.ok(uniforms[name] !== undefined, `falta el uniform ${name}`);
  }
  assert.equal(uniforms['uRingIntensity']?.value, 0, 'el anillo arranca apagado');
  assert.equal(uniforms['uFoilAmount']?.value, 0.7);
  assert.ok((uniforms['uIntensity']?.value as number) > 0);

  // Aditivo y sin escribir profundidad: es lo que lo mantiene barato y lo que
  // evita que el halo tape a la carta.
  assert.equal(material.blending, 2, 'AdditiveBlending');
  assert.equal(material.depthWrite, false);
  assert.equal(material.transparent, true);

  material.dispose();
});

// ---------------------------------------------------------------------------
// Particulas
// ---------------------------------------------------------------------------

test('las esporas de ambiente se calculan en la GPU: sus buffers no se reescriben', () => {
  const field = new SporeField({ transient: 64, ambient: 32 });
  field.setAmbientEnabled(true);
  field.update(0.016);

  const seeds = field.ambient.geometry.getAttribute('aSeed') as THREE.BufferAttribute;
  const colors = field.ambient.geometry.getAttribute('aColor') as THREE.BufferAttribute;
  const seedVersion = seeds.version;
  const colorVersion = colors.version;

  // Diez segundos de juego a 60 FPS.
  for (let i = 0; i < 600; i++) field.update(0.016);

  // `BufferAttribute.version` se incrementa cada vez que alguien le asigna
  // `needsUpdate = true`. Si el movimiento volviera a la CPU, esto lo delata.
  assert.equal(seeds.version, seedVersion, 'la semilla no se reescribe: el movimiento vive en el shader');
  assert.equal(colors.version, colorVersion, 'el color tampoco');
  assert.ok(
    (field.ambient.material.uniforms['uTime']?.value as number) > 5,
    'el reloj del shader si tiene que avanzar',
  );

  field.dispose();
});

test('las esporas transitorias si se simulan en CPU', () => {
  const field = new SporeField({ transient: 32, ambient: 8 });
  field.setAmbientEnabled(true);
  assert.equal(field.activeCount, 8, 'solo las de ambiente');

  field.burst(new THREE.Vector3(0, 1, 0), 5);
  assert.equal(field.activeCount, 13, 'el burst tiene que sumar a las de ambiente');

  // Al terminar su vida, se liberan.
  for (let i = 0; i < 300; i++) field.update(0.05);
  assert.equal(field.activeCount, 8, 'las transitorias se reciclan solas');

  field.dispose();
});

test('bajar el limite de particulas no reasigna memoria', () => {
  const field = new SporeField({ transient: 100, ambient: 50 });
  field.setAmbientEnabled(true);

  field.setLimits({ transient: 10, ambient: 5 });
  // Se piden 50 y solo hay 10 slots disponibles.
  field.burst(new THREE.Vector3(0, 1, 0), 50);

  assert.equal(field.activeCount, 15, '5 de ambiente + 10 transitorias, sin pasar el limite');

  field.dispose();
});
