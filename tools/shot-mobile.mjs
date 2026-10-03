/**
 * shot-mobile.mjs — Captura el HUD como en un CELULAR TACTIL (pointer: coarse).
 *
 * A diferencia de `shot-hud.mjs` (que usa 844x390 fijo, sin emular `pointer`),
 * este emula un dispositivo tactil real con dimensiones tipicas de celular en
 * landscape (p. ej. 915x412 como un Pixel/Galaxy), para revisar las reglas
 * `@media (pointer: coarse)`.
 *
 * Saca: menu, barra superior+inferior en partida, y panel de ciego.
 *
 *   node tools/shot-mobile.mjs
 */
import { existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const URL_TO_TEST = process.env.FF_URL ?? 'http://127.0.0.1:1420/?daily=0';

const PW_CANDIDATES = [
  'C:/Users/emanu/.workbuddy-ai/binaries/node/workspace/node_modules/playwright-core/index.js',
];
async function loadPlaywright() {
  try {
    return await import('playwright-core');
  } catch {
    for (const c of PW_CANDIDATES) {
      if (existsSync(c)) return await import(pathToFileURL(c).href);
    }
    throw new Error('No se encontro playwright-core.');
  }
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
  executablePath: exe,
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--disable-dev-shm-usage'],
});

// Celular en landscape con tactil: `isMobile` + `hasTouch` => `pointer: coarse`.
const context = await browser.newContext({
  viewport: { width: 915, height: 412 },
  deviceScaleFactor: 2.5,
  isMobile: true,
  hasTouch: true,
});
const page = await context.newPage();
page.on('console', (m) => { if (m.type() === 'error') console.error('[console]', m.text()); });
page.on('pageerror', (e) => console.error('[pageerror]', e.message));

await page.goto(URL_TO_TEST, { waitUntil: 'load', timeout: 45000 });
await page.waitForFunction(() => Boolean(window.__fungiflush?.engine?.run), { timeout: 30000 });
await page.waitForTimeout(2200);

const media = await page.evaluate(() => ({
  coarse: window.matchMedia('(pointer: coarse)').matches,
  w: window.innerWidth,
  h: window.innerHeight,
}));
console.log('media:', JSON.stringify(media));

// Menu
await page.evaluate(() => document.querySelector('[data-act="tutorial-close"]')?.click());
await page.waitForTimeout(300);
await page.screenshot({ path: join(shotsDir, 'mob-menu.png') });

// Panel de ciego (antes de elegir). El tutorial ya se cerro en el menu, asi que
// aca se ve la GRILLA de ciegos de verdad.
await page.evaluate(() => document.querySelector('.panel.is-menu [data-act="new"]')?.click());
await page.waitForTimeout(1400);
await page.evaluate(() => document.querySelector('[data-act="tutorial-close"]')?.click());
await page.waitForTimeout(600);
await page.screenshot({ path: join(shotsDir, 'mob-blind.png') });

// Medicion del panel de ciego: ¿la grilla desborda?
const blindMeasure = await page.evaluate(() => {
  const panel = document.querySelector('.panel.is-blind-select');
  const grid = document.querySelector('.blind-grid');
  if (!panel || !grid) return null;
  const pr = panel.getBoundingClientRect();
  const gr = grid.getBoundingClientRect();
  const cards = [...grid.querySelectorAll('.blind-card')].map((c) => {
    const r = c.getBoundingClientRect();
    return { right: Math.round(r.right), bottom: Math.round(r.bottom) };
  });
  return {
    panel: { top: Math.round(pr.top), bottom: Math.round(pr.bottom) },
    grid: { top: Math.round(gr.top), bottom: Math.round(gr.bottom), h: Math.round(gr.height) },
    cards,
    vh: window.innerHeight,
    gridOverflow: Math.round(gr.bottom - window.innerHeight),
    panelScrollable: panel.scrollHeight > panel.clientHeight + 2,
  };
});
console.log('\nPanel de ciego:', JSON.stringify(blindMeasure, null, 2));

// En partida
await page.evaluate(() => {
  const ff = window.__fungiflush;
  ff.engine.chooseBlind(ff.engine.availableBlinds()[0]?.id);
});
await page.waitForFunction(() => (window.__fungiflush?.engine?.round?.hand?.length ?? 0) > 0, { timeout: 15000 });
await page.waitForTimeout(1200);
await page.screenshot({ path: join(shotsDir, 'mob-playing.png') });

// Medicion: ¿algo se sale del viewport?
const measure = await page.evaluate(() => {
  const out = [];
  const check = (sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return {
      sel,
      top: Math.round(r.top),
      bottom: Math.round(r.bottom),
      left: Math.round(r.left),
      right: Math.round(r.right),
      w: Math.round(r.width),
      h: Math.round(r.height),
      overflowBottom: Math.round(r.bottom - window.innerHeight),
      overflowRight: Math.round(r.right - window.innerWidth),
    };
  };
  for (const s of ['.hud-top', '.hud-bottom', '.hud-counters', '.hud-actions', '.hud-score', '.hud-ante', '.hud-money', '.hud-joker-slots']) {
    const m = check(s);
    if (m) out.push(m);
  }
  const counters = [...document.querySelectorAll('.counter')].map((c) => {
    const r = c.getBoundingClientRect();
    return { title: c.title, bottom: Math.round(r.bottom), left: Math.round(r.left), top: Math.round(r.top) };
  });
  return { out, counters, vh: window.innerHeight, vw: window.innerWidth };
});
console.log('\nMedicion HUD:', JSON.stringify(measure, null, 2));

// Panel de ciego: medir la grilla
await page.evaluate(() => {
  // volver a menu no se puede a mitad de run; medimos el panel si esta
});
await browser.close();
console.log('\nShots: tools/shots/mob-*.png');
