/**
 * shot-collection-jokers.mjs — Evidencia visual: como se ven los SIMBIONTES en
 * la Coleccion (Frente 4b / 5). Abre el menu, entra a Coleccion, filtra
 * "Simbiontes" y saca captura.
 *
 *   node tools/shot-collection-jokers.mjs
 */
import { existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const URL_TO_TEST = process.env.FF_URL ?? 'http://127.0.0.1:1420/?daily=0';
const VIEWPORT = { width: 915, height: 412 };

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
const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 2 });
const page = await context.newPage();
const click = (sel) => page.evaluate((s) => document.querySelector(s)?.click(), sel);
const has = (sel) => page.evaluate((s) => Boolean(document.querySelector(s)), sel);
const wait = (ms) => page.waitForTimeout(ms);

await page.goto(URL_TO_TEST, { waitUntil: 'load', timeout: 45000 });
await page.waitForFunction(() => Boolean(window.__fungiflush?.engine?.run), { timeout: 30000 });
await wait(1800);
await click('[data-act="tutorial-close"]');
await wait(400);
// La Coleccion vive en el desplegable de la hamburguesa: se abre primero.
await click('[data-act="menu-toggle"]');
await wait(500);
console.log('desplegable abierto:', await page.evaluate(() => Boolean(document.querySelector('.menu-drop.is-open, .menu-drop [data-act="collection"]'))));
await click('[data-act="collection"]');
await wait(1800);
console.log('coleccion abierta:', await has('.panel.is-collection'));
console.log('filtros:', await page.evaluate(() => [...document.querySelectorAll('[data-act^="filter-"]')].map((b) => b.getAttribute('data-act'))));
await click('[data-act="filter-jokers"]');
await wait(1500);
await page.screenshot({ path: join(shotsDir, 'collection-jokers.png') });
console.log('captura -> tools/shots/collection-jokers.png');

await browser.close();
