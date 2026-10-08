/**
 * probe-panel-returns.mjs — A donde VUELVE cada panel al cerrarse.
 *
 * QUE VERIFICA
 * ------------
 *   F1.2  Coleccion -> Cosmeticos -> cerrar  => vuelve a COLECCION (no al menu).
 *   F1.2  Perfil    -> Cosmeticos -> cerrar  => sigue volviendo a PERFIL.
 *   F1.3  Coleccion -> Pase       -> cerrar  => vuelve a COLECCION, con cromo.
 *         (antes el Pase cerraba con `hideOverlay()`, que dejaba el overlay
 *          VACIO sobre la escena del menu: se percibia como juego congelado)
 *
 *   node tools/probe-panel-returns.mjs
 *   FF_VIEWPORT=smoke node tools/probe-panel-returns.mjs
 *
 * Requiere el dev server en http://127.0.0.1:1420 (FF_URL lo cambia).
 * Salida: tabla de pasos + tools/shots/probe-returns-*.png
 */
import { existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const URL_TO_TEST = process.env.FF_URL ?? 'http://127.0.0.1:1420/?daily=0';
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
await page.waitForTimeout(1500);

const click = (sel) => page.evaluate((s) => document.querySelector(s)?.click(), sel);
const has = (sel) => page.evaluate((s) => Boolean(document.querySelector(s)), sel);
const waitFor = (sel, timeout = 12000) =>
  page.waitForFunction((s) => Boolean(document.querySelector(s)), sel, { timeout }).catch(() => {});

/** Clase del panel abierto + cuantos controles tiene (para detectar overlay vacio). */
async function panelState() {
  return page.evaluate(() => {
    const overlay = document.querySelector('#ui-root > .overlay');
    const panel = overlay?.querySelector(':scope > .panel') ?? null;
    return {
      ovClass: overlay?.className ?? null,
      cls: panel?.className ?? null,
      controls: panel ? panel.querySelectorAll('[data-act]').length : 0,
      text: panel ? panel.textContent.trim().length : 0,
      overlayChildren: overlay ? overlay.children.length : 0,
    };
  });
}

const results = [];
let fails = 0;
async function step(label, expectSel, shot) {
  const st = await panelState();
  const ok = st.cls !== null && (await has(expectSel)) && st.controls > 0;
  if (!ok) fails++;
  results.push({ label, ok, expectSel, ...st });
  if (shot) await page.screenshot({ path: join(shotsDir, `probe-returns-${shot}.png`) });
  console.log(
    `  ${ok ? 'OK' : 'XX'} ${label.padEnd(34)} panel=${String(st.cls).slice(0, 26).padEnd(26)} ` +
      `esperado=${expectSel.padEnd(18)} controles=${st.controls} texto=${st.text}`,
  );
  if (!ok) console.log(`       overlay="${st.ovClass}" hijos=${st.overlayChildren}`);
  return ok;
}

// --- Entrar a la Coleccion desde el Menu ---
// El tutorial de primera vez se abre solo ~400ms despues del boot y tapa el
// menu: se cierra lo que haya arriba y recien despues se toca la Coleccion.
for (let i = 0; i < 4; i++) {
  await page.waitForTimeout(600);
  if (!(await has('[data-act="tutorial-close"]'))) break;
  await click('[data-act="tutorial-close"]');
}
await waitFor('.panel.is-menu', 12000);
await page.waitForTimeout(400);
await click('.panel.is-menu [data-act="collection"]');
const opened = await waitFor('.panel.is-collection').then(() => has('.panel.is-collection'));
if (!opened) console.log('  XX no se pudo abrir la Coleccion desde el Menu');
await page.waitForTimeout(700);

// --- F1.2: Coleccion -> Cosmeticos -> cerrar => COLECCION ---
await click('.panel.is-collection [data-act="cosmetics"]');
await waitFor('.panel.is-cosmetics');
await page.waitForTimeout(500);
await step('coleccion->cosmeticos', '.panel.is-cosmetics', 'cosmetics-from-collection');
await click('[data-act="cosmetics-close"]');
await waitFor('.panel.is-collection');
await page.waitForTimeout(700);
await step('cosmeticos->cierra => coleccion', '.panel.is-collection', 'after-cosmetics');

// --- F1.3: Coleccion -> Pase -> cerrar => COLECCION (no overlay vacio) ---
if (await has('.panel.is-collection [data-act="pass"]')) {
  await click('.panel.is-collection [data-act="pass"]');
  const gotPass = await waitFor('.panel.is-pass').then(() => has('.panel.is-pass'));
  if (!gotPass) {
    console.log('  -- el Pase no abrio (¿seasonDef nulo?)');
  } else {
    await page.waitForTimeout(500);
    await step('coleccion->pase', '.panel.is-pass', 'pass-from-collection');
    await click('.panel.is-pass [data-act="close"]');
    await waitFor('.panel.is-collection');
    await page.waitForTimeout(700);
    await step('pase->cierra => coleccion', '.panel.is-collection', 'after-pass');
  }
} else {
  console.log('  -- no hay boton [data-act="pass"] en la Coleccion');
}

// --- F1.2 (regresion): Perfil -> Cosmeticos -> cerrar => PERFIL ---
await click('.panel.is-collection [data-act="close"]');
await page.waitForTimeout(600);
await click('.panel.is-menu [data-act="profile"]');
await waitFor('.panel.is-profile');
await page.waitForTimeout(500);
if (await has('.panel.is-profile [data-act="cosmetics"]')) {
  await click('.panel.is-profile [data-act="cosmetics"]');
  await waitFor('.panel.is-cosmetics');
  await page.waitForTimeout(500);
  await click('[data-act="cosmetics-close"]');
  await waitFor('.panel.is-profile');
  await page.waitForTimeout(500);
  await step('perfil->cosmeticos->cierra => perfil', '.panel.is-profile', 'after-cosmetics-profile');
} else {
  console.log('  -- no hay boton [data-act="cosmetics"] en el Perfil');
}

await browser.close();

console.log('\n=== RESUMEN ===');
for (const r of results) console.log(`  ${r.ok ? 'OK' : 'XX'}  ${r.label}`);
console.log(`\n${fails} paso(s) fallido(s). Shots: tools/shots/probe-returns-*.png`);
if (fails > 0) process.exitCode = 1;
