/**
 * probe-closure.mjs — Verifica el CIERRE del combo (F5).
 *
 * Jugando una mano de verdad, comprueba que el ultimo paso animado dispara el
 * cierre:
 *   1. Pulso de fondo: `scene.bgPulse` llega cerca de 1 y la capa del flash
 *      (`#arena-pulse`) se enciende durante el cierre y SE APAGA (sin tinte
 *      permanente). El canvas es transparente desde la Fase A, asi que el
 *      pulso vive en la capa DOM — `scene.background` ES `null` por diseno.
 *   2. Estallido doble: el pool de particulas transitorias sube mucho mas que en
 *      un paso normal (el burst de cierre es 160 + 80).
 *   3. El HUD marca el paso final (`.score-ticker.is-final`).
 *   4. 0 errores de consola.
 *
 *   node tools/probe-closure.mjs
 */
import { existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const URL_TO_TEST = process.env.FF_URL ?? 'http://127.0.0.1:1420/?daily=0';
const PW = ['C:/Users/emanu/.workbuddy-ai/binaries/node/workspace/node_modules/playwright-core/index.js'];
async function loadPlaywright() {
  try { return await import('playwright-core'); }
  catch { for (const c of PW) if (existsSync(c)) return await import(pathToFileURL(c).href); throw new Error('no pw'); }
}
const pw = await loadPlaywright();
const chromium = pw.chromium ?? pw.default?.chromium;
const exe = [
  'C:/Users/emanu/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe',
  'C:/Users/emanu/AppData/Local/ms-playwright/chromium-1228/chrome-win64/chrome.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
].find((p) => existsSync(p));
if (!exe) { console.error('No hay Chromium.'); process.exit(1); }
const shotsDir = join(ROOT, 'tools', 'shots');
if (!existsSync(shotsDir)) mkdirSync(shotsDir, { recursive: true });

const browser = await chromium.launch({
  executablePath: exe, headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--disable-dev-shm-usage'],
});
const context = await browser.newContext({ viewport: { width: 915, height: 412 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const page = await context.newPage();
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

await page.goto(URL_TO_TEST, { waitUntil: 'load', timeout: 45000 });
await page.waitForFunction(() => Boolean(window.__fungiflush?.engine?.run), { timeout: 30000 });
await page.waitForTimeout(1800);

const click = (sel) => page.evaluate((s) => document.querySelector(s)?.click(), sel);

// --- Entrar a una partida ---
await click('[data-act="tutorial-close"]');
await click('.panel.is-menu [data-act="new"]');
await page.waitForTimeout(700);
await page.evaluate(() => document.querySelector('[data-act="archetypes-start"]')?.click());
await page.waitForTimeout(1400);
await click('[data-act="tutorial-close"]');
await page.evaluate(() => window.__fungiflush.engine.chooseBlind());
await page.waitForFunction(() => (window.__fungiflush?.engine?.round?.hand?.length ?? 0) > 0, { timeout: 15000 });
await page.waitForTimeout(1500);

// --- Observador: muestrea el cierre mientras corre el combo ---
// El "fondo" del pulso es la capa DOM `#arena-pulse`: su opacidad inline es 0
// en reposo (el CSS arranca en 0) y sube hasta ~0.85 con el cierre.
const baseline = await page.evaluate(() => {
  const scene = window.__fungiflush.scene;
  const readPulse = () => {
    const el = document.getElementById('arena-pulse');
    return el ? (parseFloat(el.style.opacity || '0') || 0) : 0;
  };
  window.__f5 = {
    maxBgPulse: 0, maxHitStop: 0, bgDeviation: 0, maxParticles: 0, finalSeen: false,
    reduceMotion: scene.reduceMotion, base: readPulse(),
  };
  const base = window.__f5.base;
  const tick = () => {
    const s = window.__fungiflush.scene;
    if (s.bgPulse > window.__f5.maxBgPulse) window.__f5.maxBgPulse = s.bgPulse;
    if (s.hitStopLeft > window.__f5.maxHitStop) window.__f5.maxHitStop = s.hitStopLeft;
    const pool = s.particles?.particles ?? [];
    let active = 0;
    for (const p of pool) if (p.active) active += 1;
    if (active > window.__f5.maxParticles) window.__f5.maxParticles = active;
    const dev = Math.abs(readPulse() - base);
    if (dev > window.__f5.bgDeviation) window.__f5.bgDeviation = dev;
    if (document.querySelector('.score-ticker.is-final')) window.__f5.finalSeen = true;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  return { base };
});

// --- Jugar la mano completa (5 cartas para que haya combo) ---
const played = await page.evaluate(() => {
  const ff = window.__fungiflush;
  const hand = ff.engine.round?.hand ?? [];
  ff.engine.clearSelection();
  for (const c of hand.slice(0, 5)) ff.engine.toggleSelect(c.uid);
  const n = ff.engine.round?.selected?.length ?? 0;
  ff.engine.playHand();
  return { selected: n };
});
console.log('cartas jugadas:', played.selected);

await page.waitForTimeout(500);
await page.screenshot({ path: join(shotsDir, 'closure-mid.png') });

// El pulso decae a 3/s de tiempo de JUEGO. Bajo SwiftShader el reloj de juego
// corre mucho mas lento que el real, asi que NO se puede asumir un tiempo
// fijo: se espera a que la capa se apague de verdad (corte adaptativo, el
// mismo patron de probe-card-anims). Si el pulso nunca arranco, el timeout
// simplemente deja que los checks de abajo fallen con los datos recolectados.
try {
  await page.waitForFunction(
    () => {
      const el = document.getElementById('arena-pulse');
      const op = el ? (parseFloat(el.style.opacity || '0') || 0) : 0;
      return window.__f5.maxBgPulse > 0.5 && op < 0.001;
    },
    { timeout: 60000 },
  );
} catch {
  console.log('(aviso: el pulso no llego a apagarse en 60 s)');
}

const data = await page.evaluate(() => {
  const el = document.getElementById('arena-pulse');
  return {
    ...window.__f5,
    bgNow: el ? (parseFloat(el.style.opacity || '0') || 0) : 0,
  };
});

console.log('\nreduceMotion:', data.reduceMotion);
console.log('bgPulse maximo:', Number(data.maxBgPulse.toFixed(3)), '(tiene que acercarse a 1)');
console.log('hitStop maximo (s):', Number(data.maxHitStop.toFixed(3)), '(tiene que ser ~0.09 si no es reduced-motion)');
console.log('desvio del pulso maximo:', Number(data.bgDeviation.toFixed(4)), '(la capa #arena-pulse se enciende con el cierre)');
console.log('particulas activas maximas:', data.maxParticles, '(el burst de cierre es 160+80, muy por encima de un paso)');
console.log('paso final marcado (HUD):', data.finalSeen);
console.log('pulso ahora:', data.bgNow, ' base:', data.base, '(tienen que coincidir: sin flash permanente)');

const bgRestored = Math.abs(data.bgNow - data.base) < 0.001;
console.log('pulso restaurado:', bgRestored);

console.log('\nerrores de consola:', errors.length ? errors.slice(0, 5) : 'ninguno');

// El pulso (bg/bloom) solo se activa si no es reduced-motion.
const pulseOk = data.reduceMotion ? true : (data.maxBgPulse > 0.5 && data.bgDeviation > 0.001);
const ok =
  data.finalSeen &&
  data.maxParticles > 100 &&      // el estallido doble del cierre
  bgRestored &&                   // sin tinte permanente
  pulseOk &&
  errors.length === 0;
console.log(ok ? '\nOK CIERRE DE COMBO' : '\nXX HAY ALGO MAL EN EL CIERRE');
await browser.close();
process.exitCode = ok ? 0 : 1;
