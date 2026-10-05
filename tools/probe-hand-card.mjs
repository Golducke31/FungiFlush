/**
 * probe-hand-card.mjs — Mide el tamano REAL en pantalla de una carta de la
 * mano (movil landscape), para poder dimensionar el texto de la textura.
 *
 * La cara de la carta se hornea a 512x744 y se proyecta con una escala chica:
 * sin este numero, cualquier ajuste de tipografia es a ciegas.
 *
 *   node tools/probe-hand-card.mjs
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
const shotsDir = join(ROOT, 'tools', 'shots');
if (!existsSync(shotsDir)) mkdirSync(shotsDir, { recursive: true });

const browser = await chromium.launch({
  executablePath: exe, headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--disable-dev-shm-usage'],
});
const context = await browser.newContext({ viewport: { width: 915, height: 412 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const page = await context.newPage();
page.on('pageerror', (e) => console.error('[pageerror]', e.message));
const click = (sel) => page.evaluate((s) => document.querySelector(s)?.click(), sel);
const has = (sel) => page.evaluate((s) => Boolean(document.querySelector(s)), sel);

await page.goto(URL_TO_TEST, { waitUntil: 'load', timeout: 45000 });
await page.waitForFunction(() => Boolean(window.__fungiflush?.engine?.run), { timeout: 30000 });
await page.waitForTimeout(1800);
await click('[data-act="tutorial-close"]');
await click('.panel.is-menu [data-act="new"]');
await page.waitForTimeout(700);
if (await has('.panel.is-archetypes')) { await click('[data-act="archetypes-start"]'); await page.waitForTimeout(1200); }
await click('[data-act="tutorial-close"]');
await page.waitForFunction(() => Boolean(document.querySelector('.panel.is-blind-select')), { timeout: 12000 }).catch(() => {});
await page.evaluate(() => window.__fungiflush.engine.chooseBlind());
await page.waitForFunction(() => (window.__fungiflush?.engine?.round?.hand?.length ?? 0) > 0, { timeout: 15000 });
await page.waitForTimeout(2500);

const data = await page.evaluate(() => {
  const s = window.__fungiflush.scene;
  const hs = s.handState();
  if (hs.length === 0) return { none: true };
  const c = hs[0];
  // La carta esta ACOSTADA (rx = -PI/2): su "alto" local (3.2 u * escala) cae
  // sobre Z del mundo. Se proyectan los dos extremos para sacar el alto real.
  const HALF_H = (3.2 / 2) * (c.scale ?? 1);
  const top = s.projectPointToScreen(c.x, 1.15, c.z - HALF_H);
  const bot = s.projectPointToScreen(c.x, 1.15, c.z + HALF_H);
  const left = s.projectPointToScreen(c.x - (2.2 / 2) * (c.scale ?? 1), 1.15, c.z);
  const right = s.projectPointToScreen(c.x + (2.2 / 2) * (c.scale ?? 1), 1.15, c.z);
  const heightPx = Math.abs(bot.y - top.y);
  const widthPx = Math.abs(right.x - left.x);
  // La textura mide 744 de alto; una linea de N px de textura se ve a:
  const k = heightPx / 744;
  return {
    cards: hs.length,
    scale: c.scale,
    screenHeightPx: Math.round(heightPx),
    screenWidthPx: Math.round(widthPx),
    textureToScreen: Number(k.toFixed(4)),
    legibility: {
      'textura 30px': Number((30 * k).toFixed(1)),
      'textura 46px': Number((46 * k).toFixed(1)),
      'textura 56px': Number((56 * k).toFixed(1)),
      'textura 78px': Number((78 * k).toFixed(1)),
      'textura 112px': Number((112 * k).toFixed(1)),
    },
  };
});
console.log('\n[CARTA EN MANO]', JSON.stringify(data, null, 2));

// Zoom de la mano para mirar la cara a ojo.
const box = await page.evaluate(() => {
  const hs = window.__fungiflush.scene.handState();
  const xs = hs.map((c) => c.screenX);
  const ys = hs.map((c) => c.screenY);
  return { x: Math.min(...xs) - 90, y: Math.min(...ys) - 120, width: Math.max(...xs) - Math.min(...xs) + 180, height: 240 };
});
await page.screenshot({ path: join(shotsDir, 'hand-zoom.png'), clip: box }).catch(() => {});
await page.screenshot({ path: join(shotsDir, 'hand-full.png') });
await browser.close();
console.log('\nShots: tools/shots/hand-*.png');
