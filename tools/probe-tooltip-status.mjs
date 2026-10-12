/**
 * probe-tooltip-status.mjs — Glosario de estados en el tooltip de carta (P4).
 *
 * QUE VERIFICA
 * ------------
 *   1. El tooltip de una carta con estados muestra UNA FILA POR ESTADO, con su
 *      nombre, su magnitud (−6 Sustrato / +3 Esporas / "2 manos") y una linea
 *      llana explicando que hace (glosario, no jerga).
 *   2. `overgrowth` (ventaja) se pinta del color de las Esporas y las
 *      penalizaciones del rojo: la senal no depende solo del texto.
 *   3. El chip de misiones plegado NO lleva el progreso de la mision
 *      destacada (P4.4): el chip es liviano, el detalle vive en el panel.
 *
 * COMO OBSERVA: `window.__fungiflush.hud` esta expuesto en DEV, asi que el
 * tooltip se puede abrir directo (en movil solo se llega por long-press) y el
 * chip de misiones se lee del DOM.
 *
 *   node tools/probe-tooltip-status.mjs
 */
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const URL_TO_TEST = process.env.FF_URL ?? 'http://127.0.0.1:1420/?daily=0';
const VIEWPORT = { width: 915, height: 412 };

const PW = ['C:/Users/emanu/.workbuddy-ai/binaries/node/workspace/node_modules/playwright-core/index.js'];
async function loadPlaywright() {
  try {
    return await import('playwright-core');
  } catch {
    for (const c of PW) if (existsSync(c)) return await import(pathToFileURL(c).href);    throw new Error('no playwright-core');
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

const browser = await chromium.launch({
  executablePath: exe,
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--disable-dev-shm-usage'],
});
const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const page = await context.newPage();
const errors = [];
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

const click = (sel) => page.evaluate((s) => document.querySelector(s)?.click(), sel);
const has = (sel) => page.evaluate((s) => Boolean(document.querySelector(s)), sel);
const wait = (ms) => page.waitForTimeout(ms);

let failures = 0;
const check = (ok, label, detail = '') => {
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
};

// --- Llegar a la mesa con cartas en la mano ---
await page.goto(URL_TO_TEST, { waitUntil: 'load', timeout: 45000 });
await page.waitForFunction(() => Boolean(window.__fungiflush?.engine?.run), { timeout: 30000 });
await wait(1800);
if (await has('[data-act="tutorial-close"]')) await click('[data-act="tutorial-close"]');
await wait(300);
await click('.panel.is-menu [data-act="new"]');
await wait(700);
if (await has('.panel.is-archetypes')) {
  await click('[data-act="archetypes-start"]');
  await wait(1400);
}
if (await has('[data-act="tutorial-close"]')) await click('[data-act="tutorial-close"]');
await wait(400);
await page.evaluate(() => {
  const ff = window.__fungiflush;
  ff.engine.chooseBlind(ff.engine.availableBlinds()[0]?.id);
});
await page.waitForFunction(() => (window.__fungiflush?.engine?.round?.hand?.length ?? 0) > 0, { timeout: 15000 });
await wait(1500);

// --- Tooltip con los cuatro estados puestos a mano ---
const rows = await page.evaluate(() => {
  const ff = window.__fungiflush;
  const card = ff.engine.round.hand[0];
  card.statuses.length = 0;
  card.statuses.push({ type: 'decay', value: 6, turnsLeft: -1 });
  card.statuses.push({ type: 'spore_lock', value: 1, turnsLeft: 2 });
  card.statuses.push({ type: 'overgrowth', value: 3, turnsLeft: -1 });
  ff.hud.showTooltip(card, 30, 150);
  const nodes = [...document.querySelectorAll('.tooltip-status')];
  return nodes.map((n) => ({
    type: n.dataset.status,
    name: n.querySelector('.tooltip-status-name')?.textContent ?? '',
    value: n.querySelector('.tooltip-status-value')?.textContent?.trim() ?? '',
    gloss: n.querySelector('.tooltip-status-gloss')?.textContent ?? '',
    color: n.style.color,
  }));
});

console.log('--- filas del glosario ---');
for (const row of rows) console.log(JSON.stringify(row));

check(rows.length === 3, 'una fila por estado', `${rows.length} filas`);
const decay = rows.find((r) => r.type === 'decay');
check(Boolean(decay && decay.gloss.length > 8), 'decay trae glosario', decay?.gloss);
// Las magnitudes se comparan por el NUMERO, no por la unidad traducida: el
// idioma en que arranca el juego no tiene por que ser el del probe.
check((decay?.value ?? '').startsWith('−6'), 'decay muestra la magnitud', decay?.value);
const lock = rows.find((r) => r.type === 'spore_lock');
check((lock?.value ?? '').startsWith('2'), 'spore_lock muestra las manos que quedan', lock?.value);
const grow = rows.find((r) => r.type === 'overgrowth');
check((grow?.value ?? '').startsWith('+3'), 'overgrowth muestra la magnitud', grow?.value);
// Verde de Esporas (79, 209, 139) para la ventaja; rojo parasitario para el resto.
check(grow?.color === 'rgb(92, 196, 140)', 'overgrowth va en verde', grow?.color);
check(decay?.color === 'rgb(224, 92, 138)', 'las penalizaciones van en rojo', decay?.color);
check(
  rows.every((r) => r.name.length > 0 && r.gloss.length > 8),
  'ninguna fila se queda sin nombre o sin glosario',
);

// --- Chip de misiones: liviano, sin progreso de la destacada ---
const chip = await page.evaluate(() => {
  const el = document.querySelector('.hud-missions-toggle');
  if (!el) return null;
  return {
    visible: el.classList.contains('is-visible'),
    label: el.querySelector('.hud-missions-toggle-label')?.textContent ?? '',
    progress: el.querySelector('.hud-missions-toggle-progress')?.textContent ?? null,
  };
});
console.log('--- chip de misiones ---');
console.log(JSON.stringify(chip));
check(chip !== null, 'hay chip de misiones durante la run');
if (chip) {
  check(chip.label.length > 0, 'el chip tiene etiqueta', chip.label);
  check(chip.progress === null, 'el chip NO lleva el progreso de la destacada (P4.4)');
}

// --- Captura: el tooltip con el glosario en pantalla (evidencia visual) ---
await page.screenshot({ path: join(ROOT, 'tools', 'shots', 'tooltip-status.png') });

console.log('---');
console.log(`viewport ${VIEWPORT.width}x${VIEWPORT.height} · fallos: ${failures}`);
console.log('errores de consola:', errors.length ? errors.slice(0, 5) : 'ninguno');
if (errors.length) failures += 1;
await browser.close();
process.exit(failures > 0 ? 1 : 0);
