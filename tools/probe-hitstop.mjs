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

/**
 * Muestrea `frames` frames seguidos, opcionalmente tras pedir un hit-stop.
 *
 * El headless con SwiftShader oscila entre ~0.7 y ~10 FPS segun la corrida, asi
 * que NO se puede contar frames congelados (a 0.7 FPS un solo frame consume el
 * presupuesto entero). La estrategia es otra: pedir un hit-stop MUY largo
 * (segundos) y mirar los primeros frames, que tienen que estar congelados si o
 * si. Eso es invariante al framerate.
 */
async function sample(hitMs, frames = 4) {
  return page.evaluate(({ hit, n }) => new Promise((resolve) => {
    const scene = window.__fungiflush.scene;
    if (hit > 0) scene.hitStop(hit);
    const out = [];
    const tick = () => {
      out.push({ dt: Number(scene.lastFrameDt.toFixed(4)), left: Number((scene['hitStopLeft'] ?? 0).toFixed(3)) });
      if (out.length < n) requestAnimationFrame(tick);
      else resolve(out);
    };
    requestAnimationFrame(tick);
  }), { hit: hitMs, n: frames });
}

const HIT = 3000;

// --- 1. Baseline: sin hit-stop todo avanza ---
const base = await sample(0, 3);
console.log(`1) baseline       : dt=${base.map((f) => f.dt).join(', ')} (todos > 0)`);

// --- 2. Hit-stop largo: los primeros frames quedan congelados ---
const hit = await sample(HIT, 4);
console.log(`2) hitStop(3000)  : dt=${hit.map((f) => f.dt).join(', ')} · restante=${hit.map((f) => f.left).join(', ')}`);
console.log('   (dt tiene que ser 0 en todos, y el restante tiene que seguir > 0)');

// --- 3. Se libera solo: despues de los 3 s vuelve a moverse ---
const after = await page.evaluate((ms) => new Promise((resolve) => {
  const scene = window.__fungiflush.scene;
  setTimeout(() => {
    const tick = () => {
      if (scene.lastFrameDt > 0) resolve({ dt: scene.lastFrameDt, left: scene['hitStopLeft'] });
      else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, ms);
}), HIT + 400);
console.log(`3) se libera solo : dt=${after.dt.toFixed(4)} (> 0) · restante=${after.left} (0)`);

// --- 4. reduceMotion lo desactiva ---
// Se usa el MISMO camino que el juego (`setMode` propaga el ajuste al render).
// Tocar el perfil a mano NO alcanza: el SceneManager no lo lee solo.
const rmMode = await page.evaluate(() => {
  const scene = window.__fungiflush.scene;
  scene.setMode(scene.mode, { reduceMotion: true });
  return scene.reduceMotion;
});
const rm = await sample(HIT, 3);
console.log(`4) reduceMotion   : scene.reduceMotion=${rmMode} · dt=${rm.map((f) => f.dt).join(', ')} (ninguno congelado)`);

// --- 5. Con reduceMotion, hitStop es un no-op ---
const noop = await page.evaluate(() => {
  const scene = window.__fungiflush.scene;
  scene.hitStop(200);
  return scene['hitStopLeft'];
});
console.log(`5) reduceMotion   : hitStop(200) deja hitStopLeft=${noop} (tiene que ser 0)`);

console.log('\nerrores de consola:', errors.length ? errors.slice(0, 5) : 'ninguno');

const ok =
  base.every((f) => f.dt > 0) &&
  hit.every((f) => f.dt === 0) &&
  hit[hit.length - 1].left > 0 &&   // el presupuesto sigue vivo: no se consumio solo
  after.dt > 0 &&
  after.left === 0 &&               // y se libera: sin deadlock
  rmMode === true &&
  rm.every((f) => f.dt > 0) &&
  noop === 0 &&
  errors.length === 0;
console.log(ok ? '\nOK HIT-STOP FUNCIONANDO' : '\nXX HAY ALGO MAL');
await browser.close();
process.exitCode = ok ? 0 : 1;
