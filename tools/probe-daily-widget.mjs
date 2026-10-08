/**
 * probe-daily-widget.mjs — Recompensa diaria: ya NO se abre sola al arrancar.
 *
 * QUE VERIFICA
 * ------------
 *   F2.1  Al boot (sin `?daily=0`) el juego entra al MENU y NO aparece el modal
 *         de la recompensa diaria.
 *   F2.2  El menu tiene el chip de regalo `[data-act="daily"]` en la esquina
 *         superior derecha, CON punto de notificacion cuando hay algo para
 *         reclamar.
 *   F2.2  Tocarlo abre el panel de la diaria; cerrarlo vuelve al MENU.
 *
 *   node tools/probe-daily-widget.mjs
 *   FF_VIEWPORT=smoke node tools/probe-daily-widget.mjs
 *
 * Requiere el dev server en http://127.0.0.1:1420.
 * OJO: este probe NO usa `?daily=0` (es justo lo que quiere medir).
 */
import { existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const URL_TO_TEST = process.env.FF_URL ?? 'http://127.0.0.1:1420/';
const VIEWPORT =
  process.env.FF_VIEWPORT === 'smoke'
    ? { width: 844, height: 390 }
    : process.env.FF_VIEWPORT === 'tablet'
      ? { width: 1180, height: 820 }
      : { width: 915, height: 412 };

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
const context = await browser.newContext({
  viewport: VIEWPORT,
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
});
const page = await context.newPage();
page.on('pageerror', (e) => console.error('[pageerror]', e.message));

await page.goto(URL_TO_TEST, { waitUntil: 'load', timeout: 45000 });
await page.waitForFunction(() => Boolean(window.__fungiflush?.engine?.run), { timeout: 30000 });
// Ventana generosa: el tutorial de primera vez se abre ~400ms tras el boot, y
// el daily auto-abria ANTES en ese mismo hueco. Si algo se abre solo, se ve aca.
await page.waitForTimeout(2500);

const click = (sel) => page.evaluate((s) => document.querySelector(s)?.click(), sel);
const has = (sel) => page.evaluate((s) => Boolean(document.querySelector(s)), sel);
const waitFor = (sel, timeout = 12000) =>
  page.waitForFunction((s) => Boolean(document.querySelector(s)), sel, { timeout }).catch(() => {});

const results = [];
let fails = 0;
function check(label, ok, detail = '') {
  if (!ok) fails++;
  results.push({ label, ok });
  console.log(`  ${ok ? 'OK' : 'XX'} ${label}${detail ? `  ${detail}` : ''}`);
}

// --- F2.1: nada de modal de diaria al arrancar ---
const bootState = await page.evaluate(() => {
  const ov = document.querySelector('#ui-root > .overlay');
  return {
    dailyOpen: Boolean(document.querySelector('.panel.is-daily')),
    panel: ov?.querySelector(':scope > .panel')?.className ?? null,
  };
});
check(
  'F2.1 no aparece el modal diaria al boot',
  bootState.dailyOpen === false,
  `panel=${bootState.panel}`,
);
await page.screenshot({ path: join(shotsDir, 'probe-daily-boot.png') });

// --- Cerrar el tutorial si esta encima (no es parte de lo medido) ---
for (let i = 0; i < 4; i++) {
  await page.waitForTimeout(500);
  if (!(await has('[data-act="tutorial-close"]'))) break;
  await click('[data-act="tutorial-close"]');
}
await waitFor('.panel.is-menu', 12000);
await page.waitForTimeout(400);

// --- F2.2: el chip existe, esta arriba a la derecha y tiene el punto ---
const chip = await page.evaluate(() => {
  const el = document.querySelector('.panel.is-menu [data-act="daily"]');
  if (!el) return null;
  const r = el.getBoundingClientRect();
  const menuBtn = document.querySelector('.panel.is-menu [data-act="menu-toggle"]');
  const mr = menuBtn?.getBoundingClientRect() ?? null;
  return {
    hasDot: Boolean(el.querySelector('.menu-daily-dot')),
    hasSvg: Boolean(el.querySelector('svg')),
    aria: el.getAttribute('aria-label'),
    rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
    // "arriba a la derecha": la mitad derecha del viewport y el tercio superior
    rightHalf: r.x + r.width / 2 > window.innerWidth / 2,
    topThird: r.y < window.innerHeight / 3,
    leftOfMenu: mr ? r.x + r.width <= mr.x + 4 : null,
  };
});
check('F2.2 el chip de regalo existe en el menu', chip !== null);
if (chip) {
  check('F2.2 el chip esta arriba a la derecha', chip.rightHalf && chip.topThird, JSON.stringify(chip.rect));
  check('F2.2 el chip va junto al boton de menu', chip.leftOfMenu !== false);
  check('F2.2 el chip tiene icono', chip.hasSvg);
  check('F2.2 la diaria pendiente muestra el punto', chip.hasDot, `aria="${chip.aria}"`);
}
await page.screenshot({ path: join(shotsDir, 'probe-daily-chip.png') });

// --- F2.2: tocar el chip abre el panel; cerrarlo vuelve al MENU ---
if (chip) {
  await click('.panel.is-menu [data-act="daily"]');
  const opened = await waitFor('.panel.is-daily').then(() => has('.panel.is-daily'));
  check('F2.2 tocar el chip abre la diaria', opened);
  if (opened) {
    await page.waitForTimeout(400);
    await page.screenshot({ path: join(shotsDir, 'probe-daily-panel.png') });
    if (await has('[data-act="daily-close"]')) {
      await click('[data-act="daily-close"]');
    } else {
      await click('.panel.is-daily [data-act="close"]');
    }
    const back = await waitFor('.panel.is-menu').then(() => has('.panel.is-menu'));
    check('F2.2 cerrar la diaria vuelve al menu', back);
  }
}

await browser.close();

console.log('\n=== RESUMEN ===');
for (const r of results) console.log(`  ${r.ok ? 'OK' : 'XX'}  ${r.label}`);
console.log(`\n${fails} paso(s) fallido(s). Shots: tools/shots/probe-daily-*.png`);
if (fails > 0) process.exitCode = 1;
