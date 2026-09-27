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

import {
  FRAME_BUDGET_MS,
  FrameMonitor,
  TIER_CONFIG,
  detectTier,
  nextTierDown,
  resolveQuality,
} from '../src/render/Quality.ts';

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
