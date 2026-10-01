/**
 * shot-hud.mjs — Captura el HUD en partida para revisar cambios visuales.
 *
 * No es un test: es una herramienta de ojo. Lleva el juego al estado "playing"
 * (menu -> nueva partida -> ciego -> mano) y saca una foto de la barra de
 * arriba y los contadores, que es lo que se toca en las tareas H1/H4.
 *
 * Requiere el dev server en 127.0.0.1:1420 (`npm run dev`).
 *   node tools/shot-hud.mjs
 */
import { existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const URL_TO_TEST = process.env.FF_URL ?? 'http://127.0.0.1:1420/?daily=0';

// Mismo criterio que smoke.mjs: playwright-core vive en el workspace aislado de
// WorkBuddy, no en el proyecto.
const PW_CANDIDATES = [
  'C:/Users/emanu/.workbuddy-ai/binaries/node/workspace/node_modules/playwright-core/index.js',
];
async function loadPlaywright() {
  try {
    return await import('playwright-core');
  } catch {
    for (const candidate of PW_CANDIDATES) {
      if (existsSync(candidate)) return await import(pathToFileURL(candidate).href);
    }
    throw new Error('No se encontro playwright-core.');
  }
}
const pw = await loadPlaywright();
const chromium = pw.chromium ?? pw.default?.chromium;

const CANDIDATES = [
  'C:/Users/emanu/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe',
  'C:/Users/emanu/AppData/Local/ms-playwright/chromium-1228/chrome-win64/chrome.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
];
const executablePath = CANDIDATES.find((p) => existsSync(p));
if (!executablePath) {
  console.error('No se encontro un Chromium ejecutable.');
  process.exit(1);
}

const shotsDir = join(ROOT, 'tools', 'shots');
if (!existsSync(shotsDir)) mkdirSync(shotsDir, { recursive: true });

const browser = await chromium.launch({
  executablePath,
  headless: true,
  args: [
    '--enable-unsafe-swiftshader',
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-webgl',
    '--ignore-gpu-blocklist',
    '--disable-dev-shm-usage',
  ],
});
const context = await browser.newContext({
  viewport: { width: 844, height: 390 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
});
const page = await context.newPage();
page.on('console', (m) => {
  if (m.type() === 'error') console.error('[console]', m.text());
});
page.on('pageerror', (e) => console.error('[pageerror]', e.message));

await page.goto(URL_TO_TEST, { waitUntil: 'load', timeout: 45000 });
await page.waitForFunction(() => Boolean(window.__fungiflush?.engine?.run), { timeout: 30000 });
await page.waitForTimeout(2500);

// Menu -> nueva partida
await page.evaluate(() => document.querySelector('[data-act="new-run"]')?.click());
await page.waitForTimeout(1200);

// Saltar el dado: elegir ciego directo (no se esta probando el dado aca).
await page.evaluate(() => {
  const ff = window.__fungiflush;
  const blinds = ff.engine.availableBlinds();
  ff.engine.chooseBlind(blinds[0]?.id);
});
await page.waitForTimeout(1600);

// Barra de arriba + contadores con la mano repartida.
await page.screenshot({ path: join(shotsDir, 'hud-top-counters.png') });

const info = await page.evaluate(() => {
  const q = (s) => document.querySelector(s);
  return {
    status: window.__fungiflush.engine.run.status,
    ante: q('.hud-ante')?.textContent,
    pips: document.querySelectorAll('.hud-ante-pip').length,
    pipsDone: document.querySelectorAll('.hud-ante-pip.is-done').length,
    counters: [...document.querySelectorAll('.counter')].map((c) => ({
      label: c.querySelector('.hud-label')?.textContent,
      value: c.querySelector('.counter-value')?.textContent,
      resource: c.classList.contains('is-resource'),
      icon: getComputedStyle(c.querySelector('.counter-icon')).backgroundColor,
    })),
  };
});
console.log(JSON.stringify(info, null, 2));

await browser.close();
console.log('\nShot: tools/shots/hud-top-counters.png');
