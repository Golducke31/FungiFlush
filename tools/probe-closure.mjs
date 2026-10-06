/**
 * probe-closure.mjs — Verifica el CIERRE del combo (F5).
 *
 * Jugando una mano de verdad, comprueba que el ultimo paso animado dispara el
 * cierre:
 *   1. Pulso de fondo: `scene.bgPulse` llega cerca de 1 y el color de fondo se
 *      desvia del base durante el cierre y VUELVE al base (sin tinte permanente).
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
const baseline = await page.evaluate(() => {
  const scene = window.__fungiflush.scene;
  const bg = scene.scene.background;
  window.__f5 = {
    maxBgPulse: 0, maxHitStop: 0, bgDeviation: 0, maxParticles: 0, finalSeen: false,
    reduceMotion: scene.reduceMotion, base: [bg.r, bg.g, bg.b],
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
    const c = s.scene.background;
    const dev = Math.abs(c.r - base[0]) + Math.abs(c.g - base[1]) + Math.abs(c.b - base[2]);
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
await page.waitForTimeout(4000);

const data = await page.evaluate(() => {
  const s = window.__fungiflush.scene;
  const bg = s.scene.background;
  return {
    ...window.__f5,
    bgNow: [Number(bg.r.toFixed(4)), Number(bg.g.toFixed(4)), Number(bg.b.toFixed(4))],
  };
});

console.log('\nreduceMotion:', data.reduceMotion);
console.log('bgPulse maximo:', Number(data.maxBgPulse.toFixed(3)), '(tiene que acercarse a 1)');
console.log('hitStop maximo (s):', Number(data.maxHitStop.toFixed(3)), '(tiene que ser ~0.09 si no es reduced-motion)');
console.log('desvio de fondo maximo:', Number(data.bgDeviation.toFixed(4)), '(tiene que ser > 0)');
console.log('particulas activas maximas:', data.maxParticles, '(el burst de cierre es 160+80, muy por encima de un paso)');
console.log('paso final marcado (HUD):', data.finalSeen);
console.log('fondo ahora:', JSON.stringify(data.bgNow), ' base:', JSON.stringify(data.base), '(tienen que coincidir)');

const bgRestored = data.bgNow.every((v, i) => Math.abs(v - data.base[i]) < 0.001);
console.log('fondo restaurado:', bgRestored);

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
