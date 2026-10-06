/**
 * probe-hitstop.mjs — Verifica el HIT-STOP en el loop real.
 *
 * `SceneManager.hitStop(ms)` tiene que congelar TODO el update durante esos ms:
 * tweens de GSAP, `TweenManager`, particulas, cola de FX, cartas y camara. La
 * forma de comprobarlo desde afuera es el `dt` que el loop le pasa a todo: si el
 * hit-stop funciona, `lastFrameDt` es 0 durante la ventana y el `clock` NO avanza.
 *
 * Se comprueba tambien la trampa clasica: que la cuenta atras no se descuente del
 * dt ya congelado (si no, nunca llegaria a cero y el juego quedaria trabado).
 *
 *   node tools/probe-hitstop.mjs
 */
import { existsSync } from 'node:fs';
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
await page.waitForTimeout(2000);

/** Muestrea dt y clock por frame durante `ms`, disparando el hit-stop al arrancar. */
async function sample(hitMs, windowMs = 500) {
  return page.evaluate(({ hit, win }) => new Promise((resolve) => {
    const scene = window.__fungiflush.scene;
    const t0 = performance.now();
    const startClock = scene.clock;
    if (hit > 0) scene.hitStop(hit);
    const frames = [];
    const tick = () => {
      const t = performance.now() - t0;
      frames.push({ t: Math.round(t), dt: Number(scene.lastFrameDt.toFixed(4)) });
      if (t < win) requestAnimationFrame(tick);
      else resolve({ frames, clockDelta: Number((scene.clock - startClock).toFixed(3)) });
    };
    requestAnimationFrame(tick);
  }), { hit: hitMs, win: windowMs });
}

function summarize(r, label) {
  const frozen = r.frames.filter((f) => f.dt === 0);
  const moving = r.frames.filter((f) => f.dt > 0);
  console.log(`${label}: ${r.frames.length} frames · congelados ${frozen.length} · moviendo ${moving.length} · clock +${r.clockDelta}s`);
  return { frozen: frozen.length, moving: moving.length, clockDelta: r.clockDelta };
}

// El headless con SwiftShader corre a ~3 FPS, asi que las ventanas son largas a
// proposito: con ventanas cortas entran 1-2 frames y no se mide nada.
const WINDOW = 1500;
const HIT = 700;

// --- 1. Baseline: sin hit-stop todo avanza ---
const base = summarize(await sample(0, WINDOW), '1) baseline      ');

// --- 2. Hit-stop: la ventana se congela y despues retoma ---
const hit = summarize(await sample(HIT, WINDOW), '2) hitStop(700)  ');

// --- 3. La cuenta atras NO se traba (el juego retoma solo) ---
const after = await page.evaluate(() => new Promise((resolve) => {
  const scene = window.__fungiflush.scene;
  const t0 = performance.now();
  const tick = () => {
    if (performance.now() - t0 > 400) resolve({ dt: scene.lastFrameDt, left: scene['hitStopLeft'] });
    else requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}));
console.log(`3) tras el stop  : dt=${after.dt.toFixed(4)} (tiene que ser > 0) · restante=${after.left}`);

// --- 4. reduceMotion lo desactiva ---
// Se usa el MISMO camino que el juego (`setMode` es lo que propaga el ajuste al
// render). Tocar el perfil a mano NO alcanza: el SceneManager no lo lee solo.
const rmMode = await page.evaluate(() => {
  const scene = window.__fungiflush.scene;
  scene.setMode(scene.mode, { reduceMotion: true });
  return scene.reduceMotion;
});
const rm = summarize(await sample(HIT, WINDOW), '4) reduceMotion  ');

// --- 5. Con reduceMotion el hitStop es un no-op ---
const noop = await page.evaluate(() => {
  const scene = window.__fungiflush.scene;
  scene.hitStop(200);
  return scene['hitStopLeft'];
});
console.log(`5) reduceMotion  : scene.reduceMotion=${rmMode} · hitStop(200) deja hitStopLeft=${noop}`);

console.log('\nerrores de consola:', errors.length ? errors.slice(0, 5) : 'ninguno');

const ok =
  base.moving > 0 &&
  base.frozen === 0 &&
  hit.frozen > 0 &&
  hit.moving > 0 &&
  after.dt > 0 &&
  after.left === 0 &&
  rmMode === true &&
  rm.frozen === 0 &&
  noop === 0 &&
  errors.length === 0;
console.log(ok ? '\nOK HIT-STOP FUNCIONANDO' : '\nXX HAY ALGO MAL');
await browser.close();
process.exitCode = ok ? 0 : 1;
