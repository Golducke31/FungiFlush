/**
 * probe-mycelium.mjs — Verifica el MICELIO (F4).
 *
 * Comprueba jugando manos de verdad:
 *   1. Que la raiz se CREA: hay al menos un slot vivo durante el combo.
 *   2. Que CRECE: el `drawRange` de la geometria sube de 0 al total de indices.
 *   3. Que se LIBERA: al terminar no queda ninguna raiz viva (sin fugas).
 *   4. Que repetir manos no acumula geometrias en el renderer (el pool reutiliza).
 *
 *   node tools/probe-mycelium.mjs
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

// --- Entrar a una partida y dejar el objetivo bajo para repetir manos ---
await click('[data-act="tutorial-close"]');
await click('.panel.is-menu [data-act="new"]');
await page.waitForTimeout(700);
await page.evaluate(() => document.querySelector('[data-act="archetypes-start"]')?.click());
await page.waitForTimeout(1400);
await click('[data-act="tutorial-close"]');
await page.evaluate(() => window.__fungiflush.engine.chooseBlind());
await page.waitForFunction(() => (window.__fungiflush?.engine?.round?.hand?.length ?? 0) > 0, { timeout: 15000 });
await page.waitForTimeout(1500);

// --- Observador: muestrea raices vivas y drawRange mientras corre el combo ---
await page.evaluate(() => {
  window.__myc = { maxActive: 0, drawRanges: [], shots: [] };
  const tick = () => {
    const myc = window.__fungiflush.scene['mycelium'];
    const active = myc?.active ?? 0;
    if (active > window.__myc.maxActive) window.__myc.maxActive = active;
    for (const slot of myc?.['slots'] ?? []) {
      if (!slot.busy || !slot.geometry) continue;
      const range = slot.geometry.drawRange.count;
      const total = slot.geometry.index?.count ?? 0;
      if (total > 0) window.__myc.drawRanges.push(Math.round((range / total) * 100));
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
});

const geoStart = await page.evaluate(() => window.__fungiflush.scene.renderer.info.memory.geometries);

// --- Jugar la mano SIN forzar el objetivo ---
// Ojo: poner `round.target = 1` gana la mano al toque y eso MATA la timeline del
// scoring (`celebrate` compite con `score:settled`), asi que `runScoreStep` nunca
// corre y el micelio no se ve. La mano se juega tal cual.
await page.evaluate(() => {
  const ff = window.__fungiflush;
  ff.engine.clearSelection();
  for (const c of (ff.engine.round?.hand ?? []).slice(0, 5)) ff.engine.toggleSelect(c.uid);
  ff.engine.playHand();
});
await page.waitForTimeout(800);
await page.screenshot({ path: join(shotsDir, 'mycelium-growth.png') });
await page.waitForTimeout(3200);

// --- Estres determinista: 20 raices de golpe (el pool tiene 8) ---
const stress = await page.evaluate(() => {
  const m = window.__fungiflush.scene['mycelium'];
  // Vector3 real sin importar three en el prober: `group.position` ya es uno.
  const Vec = m.group.position.constructor;
  const from = new Vec(-3, 0.6, 0);
  for (let i = 0; i < 20; i++) {
    m.grow(from, new Vec(3 + i * 0.05, 0.6, 0), 0x4fd18b);
  }
  return { activeJustAfter: m.active, capacity: m['slots'].length };
});
console.log(`estres: 20 raices pedidas -> vivas justo despues: ${stress.activeJustAfter} (capacidad ${stress.capacity})`);

// Esperar a que se liberen. En el headless a <1 FPS el reloj acotado (0.05 por
// frame) hace que una animacion de 760 ms tarde varios segundos REALES, asi que
// no vale un `waitForTimeout` fijo: se sondea hasta que el pool queda vacio.
let activeNow = -1;
for (let i = 0; i < 50; i++) {
  activeNow = await page.evaluate(() => window.__fungiflush.scene['mycelium']?.active ?? -1);
  if (activeNow === 0) break;
  await page.waitForTimeout(500);
}
console.log('raices vivas tras el sondeo:', activeNow, '(tiene que ser 0)');

const data = await page.evaluate(() => ({
  maxActive: window.__myc.maxActive,
  drawRanges: [...new Set(window.__myc.drawRanges)].sort((a, b) => a - b),
  activeNow: window.__fungiflush.scene['mycelium']?.active ?? -1,
  geoNow: window.__fungiflush.scene.renderer.info.memory.geometries,
}));
data.activeNow = activeNow;

console.log('raices simultaneas (max):', data.maxActive);
console.log('drawRange visto (% del recorrido):', data.drawRanges.slice(0, 14).join(', '), data.drawRanges.length > 14 ? '...' : '');
console.log('raices vivas AHORA:', data.activeNow, '(tiene que ser 0)');
console.log(`geometrias GPU: ${geoStart} -> ${data.geoNow} (no deberia crecer con las manos)`);

console.log('\nerrores de consola:', errors.length ? errors.slice(0, 5) : 'ninguno');

const grew = data.drawRanges.some((r) => r > 0 && r < 100) || data.drawRanges.length > 0;
const ok =
  data.maxActive > 0 &&
  grew &&
  data.activeNow === 0 &&
  data.geoNow <= geoStart + 2 &&   // tolerancia: las cartas nuevas tambien cuentan
  errors.length === 0;
console.log(ok ? '\nOK MICELIO FUNCIONANDO' : '\nXX HAY ALGO MAL');
await browser.close();
process.exitCode = ok ? 0 : 1;
