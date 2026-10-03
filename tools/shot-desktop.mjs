/**
 * shot-desktop.mjs — Captura el HUD en ESCRITORIO (pointer: fine).
 *
 * Verifica que las reglas `@media (pointer: coarse)` NO afecten al escritorio:
 * mismo viewport que un monitor ancho, sin `isMobile`/`hasTouch`.
 *
 *   node tools/shot-desktop.mjs
 */
import { existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const URL_TO_TEST = process.env.FF_URL ?? 'http://127.0.0.1:1420/?daily=0';

const PW_CANDIDATES = [
  'C:/Users/emanu/.workbuddy-ai/binaries/node/workspace/node_modules/playwright-core/index.js',
];
const pw = await (async () => {
  try { return await import('playwright-core'); } catch {
    for (const c of PW_CANDIDATES) if (existsSync(c)) return await import(pathToFileURL(c).href);
  }
})();
const chromium = pw.chromium ?? pw.default?.chromium;
const exe = [
  'C:/Users/emanu/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
].find((p) => existsSync(p));

const shotsDir = join(ROOT, 'tools', 'shots');
if (!existsSync(shotsDir)) mkdirSync(shotsDir, { recursive: true });

const browser = await chromium.launch({
  executablePath: exe,
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--disable-dev-shm-usage'],
});
// ESCRITORIO: sin isMobile ni hasTouch => pointer: fine.
const context = await browser.newContext({ viewport: { width: 1440, height: 810 } });
const page = await context.newPage();
page.on('pageerror', (e) => console.error('[pageerror]', e.message));

await page.goto(URL_TO_TEST, { waitUntil: 'load', timeout: 45000 });
await page.waitForFunction(() => Boolean(window.__fungiflush?.engine?.run), { timeout: 30000 });
await page.waitForTimeout(2200);

const media = await page.evaluate(() => ({
  coarse: window.matchMedia('(pointer: coarse)').matches,
  fine: window.matchMedia('(pointer: fine)').matches,
  w: window.innerWidth,
  h: window.innerHeight,
}));
console.log('media:', JSON.stringify(media));

await page.evaluate(() => document.querySelector('[data-act="tutorial-close"]')?.click());
await page.waitForTimeout(300);

// Panel de ciego
await page.evaluate(() => document.querySelector('.panel.is-menu [data-act="new"]')?.click());
await page.waitForTimeout(1400);
await page.evaluate(() => document.querySelector('[data-act="tutorial-close"]')?.click());
await page.waitForTimeout(600);
await page.screenshot({ path: join(shotsDir, 'desk-blind.png') });

// En partida
await page.evaluate(() => {
  const ff = window.__fungiflush;
  ff.engine.chooseBlind(ff.engine.availableBlinds()[0]?.id);
});
await page.waitForFunction(() => (window.__fungiflush?.engine?.round?.hand?.length ?? 0) > 0, { timeout: 15000 });
await page.waitForTimeout(1200);
await page.screenshot({ path: join(shotsDir, 'desk-playing.png') });

// Medicion: la barra inferior debe seguir en UNA fila y sin wrap.
const measure = await page.evaluate(() => {
  const counters = [...document.querySelectorAll('.counter')];
  const tops = counters.map((c) => Math.round(c.getBoundingClientRect().top));
  const bottom = document.querySelector('.hud-bottom')?.getBoundingClientRect();
  const actions = document.querySelector('.hud-actions')?.getBoundingClientRect();
  return {
    vh: window.innerHeight,
    counterTops: tops,
    countersSingleRow: new Set(tops).size === 1,
    countersBottom: Math.max(...counters.map((c) => Math.round(c.getBoundingClientRect().bottom))),
    actionsTop: actions ? Math.round(actions.top) : null,
    actionsBottom: actions ? Math.round(actions.bottom) : null,
    hudBottom: bottom ? Math.round(bottom.bottom) : null,
  };
});
console.log('\nMedicion escritorio:', JSON.stringify(measure, null, 2));

await browser.close();
console.log('\nShots: tools/shots/desk-*.png');
