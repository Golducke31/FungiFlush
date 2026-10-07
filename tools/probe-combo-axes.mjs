/**
 * probe-combo-axes.mjs — Capa EXTRA de combo por eje (P2.3).
 *
 * LA REGLA QUE CUBRE
 * ------------------
 * La celebracion BASE (`closeCombo`: hit-stop + estallido + pulso) se sigue
 * disparando en TODAS las manos. Lo que se verifica aca es la CAPA EXTRA que se
 * suma ENCIMA cuando la mano SI formo un combo, y que esa capa DISTINGUE el eje:
 *   elemento (x Esporas)  -> DORADO
 *   familia  (+ Sustrato) -> AMBAR
 *   diversidad            -> VERDE
 * ...y que escala con el numero de cartas (un x1.25 se nota, un x3 se siente
 * enorme), sin usar texto.
 *
 * COMO LO HACE
 * ------------
 * Espia `particles.burst` y `comboFlourish` desde la pagina y despues FUERZA el
 * contenido de la mano (reescribiendo `def.element` / `def.family`), que es la
 * unica forma determinista de armar una Floracion y una Colonia sin jugar 50
 * partidas. No se toca el motor: solo el VFX.
 *
 *   node tools/probe-combo-axes.mjs
 *   FF_VIEWPORT=smoke node tools/probe-combo-axes.mjs
 */
import { existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const URL_TO_TEST = process.env.FF_URL ?? 'http://127.0.0.1:1420/?daily=0';
const VIEWPORT =
  process.env.FF_VIEWPORT === 'smoke'
    ? { width: 844, height: 390 }
    : process.env.FF_VIEWPORT === 'tablet'
      ? { width: 1180, height: 820 }
      : { width: 915, height: 412 };

// Colores de la paleta del juego (src/render/palette.ts).
const GOLD = 0xffd36b; // UI_COLORS.xmult     -> multiplicar -> ELEMENTO
const AMBER = 0xf2a63b; // UI_COLORS.substrate -> sumar sustrato -> FAMILIA
const GREEN = 0x4fd18b; // UI_COLORS.spores    -> esporas -> DIVERSIDAD

const PW = ['C:/Users/emanu/.workbuddy-ai/binaries/node/workspace/node_modules/playwright-core/index.js'];
async function loadPlaywright() {
  try {
    return await import('playwright-core');
  } catch {
    for (const c of PW) if (existsSync(c)) return await import(pathToFileURL(c).href);
    throw new Error('no playwright-core');
  }
}
const pw = await loadPlaywright();
const chromium = pw.chromium ?? pw.default?.chromium;
const exe = [
  'C:/Users/emanu/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe',
  'C:/Users/emanu/AppData/Local/ms-playwright/chromium-1228/chrome-win64/chrome.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
].find((p) => existsSync(p));
if (!exe) {
  console.error('No hay Chromium.');
  process.exit(1);
}
const shotsDir = join(ROOT, 'tools', 'shots');
if (!existsSync(shotsDir)) mkdirSync(shotsDir, { recursive: true });

const browser = await chromium.launch({
  executablePath: exe,
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--disable-dev-shm-usage'],
});
const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const page = await context.newPage();
const errors = [];
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

const click = (sel) => page.evaluate((s) => document.querySelector(s)?.click(), sel);
const has = (sel) => page.evaluate((s) => Boolean(document.querySelector(s)), sel);
const wait = (ms) => page.waitForTimeout(ms);

let failures = 0;
const check = (ok, label, detail = '') => {
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
};

const hex = (n) => `#${n.toString(16).padStart(6, '0')}`;

// --- Espia: bursts de particulas + llamadas a la capa extra ---
await page.goto(URL_TO_TEST, { waitUntil: 'load', timeout: 45000 });
await page.waitForFunction(() => Boolean(window.__fungiflush?.engine?.run), { timeout: 30000 });
await wait(1800);
await click('[data-act="tutorial-close"]');
await wait(300);
await click('.panel.is-menu [data-act="new"]');
await wait(700);
if (await has('.panel.is-archetypes')) {
  await click('[data-act="archetypes-start"]');
  await wait(1400);
}
await click('[data-act="tutorial-close"]');
await wait(400);
await page.evaluate(() => {
  const ff = window.__fungiflush;
  ff.engine.chooseBlind(ff.engine.availableBlinds()[0]?.id);
});
await page.waitForFunction(() => (window.__fungiflush?.engine?.round?.hand?.length ?? 0) > 0, { timeout: 15000 });
await wait(1200);

const installSpy = () =>
  page.evaluate(() => {
    const ff = window.__fungiflush;
    window.__bursts = [];
    window.__flourish = null;
    window.__maxHit = 0;
    window.__sampling = true;

    if (!ff.scene.particles.__spied) {
      const origBurst = ff.scene.particles.burst.bind(ff.scene.particles);
      ff.scene.particles.burst = (origin, count, options) => {
        (window.__bursts ??= []).push({ count, color: options?.color ?? 0 });
        return origBurst(origin, count, options);
      };
      // `comboFlourish` es privado en TS pero existe en runtime.
      const origFlourish = ff.scene.comboFlourish.bind(ff.scene);
      ff.scene.comboFlourish = (axis, tier) => {
        window.__flourish = { axis, tier };
        return origFlourish(axis, tier);
      };
      ff.scene.particles.__spied = true;
    }
    const tick = () => {
      if (window.__sampling) window.__maxHit = Math.max(window.__maxHit, ff.scene.hitStopLeft ?? 0);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });

/** Juega una mano con la seleccion indicada y devuelve lo que espiaron. */
async function playHand(count) {
  await installSpy();
  await page.evaluate((n) => {
    const ff = window.__fungiflush;
    window.__settled = false;
    // `score:settled` es el aviso de que la timeline de puntuacion TERMINO. Sin
    // esperarlo, una mano de 5 cartas (muchos pasos, escalonados cada 0.18s) se
    // sigue animando cuando el probe mide y `closeCombo` todavia no corrio.
    const off = ff.bus.on('score:settled', () => {
      window.__settled = true;
      off();
    });
    ff.engine.clearSelection();
    for (const c of (ff.engine.round?.hand ?? []).slice(0, n)) ff.engine.toggleSelect(c.uid);
    ff.engine.playHand();
  }, count);
  await page.waitForFunction(() => window.__settled === true, undefined, { timeout: 30000 }).catch(() => {});
  await wait(500);
  return page.evaluate(() => {
    const ff = window.__fungiflush;
    window.__sampling = false;
    return {
      settled: Boolean(window.__settled),
      flourish: window.__flourish ?? null,
      bursts: window.__bursts ?? [],
      maxHit: Number((window.__maxHit ?? 0).toFixed(3)),
      lastBurst: (window.__bursts ?? []).slice(-1)[0] ?? null,
      status: ff.engine.run.status,
    };
  });
}

/** Reescribe el elemento/familia de las primeras N cartas de la mano. */
const setHand = (count, elements, family) =>
  page.evaluate(
    ({ n, els, fam }) => {
      const ff = window.__fungiflush;
      const hand = ff.engine.round.hand;
      for (let i = 0; i < n && i < hand.length; i++) {
        const card = hand[i];
        card.def = { ...card.def, element: els[i % els.length], family: fam ?? card.def.family };
      }
    },
    { n: count, els: elements, fam: family ?? null },
  );

// --- 1. Mano SIN combo (una sola carta): celebra igual, SIN capa extra ---
await setHand(1, ['neutral'], null);
const single = await playHand(1);
console.log('--- sin combo (1 carta) ---');
console.log(JSON.stringify(single));
check(single.flourish === null, 'sin combo NO hay capa extra');
check(single.maxHit > 0, 'sin combo la celebracion BASE sigue (hit-stop presente)', `maxHit=${single.maxHit}`);

// --- 2. FLORACION: 5 cartas del MISMO elemento ---
await page.reload({ waitUntil: 'load' });
await page.waitForFunction(() => Boolean(window.__fungiflush?.engine?.run), { timeout: 30000 });
await wait(1800);
await click('[data-act="tutorial-close"]');
await click('.panel.is-menu [data-act="new"]');
await wait(700);
if (await has('.panel.is-archetypes')) await click('[data-act="archetypes-start"]');
await wait(1400);
await click('[data-act="tutorial-close"]');
await page.evaluate(() => {
  const ff = window.__fungiflush;
  ff.engine.chooseBlind(ff.engine.availableBlinds()[0]?.id);
});
await page.waitForFunction(() => (window.__fungiflush?.engine?.round?.hand?.length ?? 0) > 0, { timeout: 15000 });
await wait(1000);

await setHand(5, ['poison'], null);
const flowering = await playHand(5);
console.log('--- FLORACION (5 del mismo elemento) ---');
console.log(JSON.stringify(flowering));
check(flowering.flourish?.axis === 'element', 'se detecta el eje ELEMENTO', JSON.stringify(flowering.flourish));
check(flowering.flourish?.tier === 5, 'el tier es 5', String(flowering.flourish?.tier));
check(
  flowering.lastBurst?.color === GOLD,
  'el estallido extra es DORADO (multiplicar)',
  hex(flowering.lastBurst?.color ?? 0),
);
check(flowering.maxHit > single.maxHit, 'un combo grande golpea MAS que una mano sin combo', `${single.maxHit} -> ${flowering.maxHit}`);
await page.screenshot({ path: join(shotsDir, 'probe-combo-elemento.png') });

// --- 3. COLONIA: 5 cartas de la MISMA familia con elementos DISTINTOS ---
await page.reload({ waitUntil: 'load' });
await page.waitForFunction(() => Boolean(window.__fungiflush?.engine?.run), { timeout: 30000 });
await wait(1800);
await click('[data-act="tutorial-close"]');
await click('.panel.is-menu [data-act="new"]');
await wait(700);
if (await has('.panel.is-archetypes')) await click('[data-act="archetypes-start"]');
await wait(1400);
await click('[data-act="tutorial-close"]');
await page.evaluate(() => {
  const ff = window.__fungiflush;
  ff.engine.chooseBlind(ff.engine.availableBlinds()[0]?.id);
});
await page.waitForFunction(() => (window.__fungiflush?.engine?.round?.hand?.length ?? 0) > 0, { timeout: 15000 });
await wait(1000);

await setHand(5, ['poison', 'spore', 'decay', 'crystal', 'mycelium'], 'agaricaceae');
const colony = await playHand(5);
console.log('--- COLONIA (5 misma familia) ---');
console.log(JSON.stringify(colony));
check(colony.flourish?.axis === 'family', 'se detecta el eje FAMILIA', JSON.stringify(colony.flourish));
check(
  colony.lastBurst?.color === AMBER,
  'el estallido extra es AMBAR (sumar sustrato)',
  hex(colony.lastBurst?.color ?? 0),
);
check(
  colony.lastBurst?.color !== flowering.lastBurst?.color,
  'elemento y familia se DISTINGUEN a simple vista',
  `${hex(flowering.lastBurst?.color ?? 0)} vs ${hex(colony.lastBurst?.color ?? 0)}`,
);
await page.screenshot({ path: join(shotsDir, 'probe-combo-familia.png') });

console.log('---');
console.log(`viewport ${VIEWPORT.width}x${VIEWPORT.height} · fallos: ${failures}`);
console.log('errores de consola:', errors.length ? errors.slice(0, 5) : 'ninguno');
if (errors.length) failures += 1;
await browser.close();
process.exit(failures > 0 ? 1 : 0);
