/**
 * probe-expansion-pack.mjs — Verifica que los DOS sobres se obtienen y se abren
 * DIFERENCIADOS.
 *
 * Comprueba end-to-end (perfil + UI + overlay):
 *   1. El perfil arranca con `mycelial` en cosméticos (dorso propio disponible).
 *   2. Con un sobre de cada tipo, la Colección muestra DOS botones (base y
 *      expansión) con su contador.
 *   3. `openPacks('expansion')` sortea solo cartas del pack `deep_mycelium`
 *      (el pool se filtra por origen).
 *   4. El overlay de expansión arranca con `kind: 'expansion'` y su `backArt`
 *      (el dorso `cardback_mycelial`), no el dorso base.
 *   5. El inventario se descuenta por separado (base vs expansión).
 *
 *   node tools/probe-expansion-pack.mjs
 */
import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const PW = 'C:/Users/emanu/.workbuddy-ai/binaries/node/workspace/node_modules/playwright-core/index.js';
const pw = await import(pathToFileURL(PW).href);
const chromium = pw.chromium ?? pw.default?.chromium;
const exe = 'C:/Users/emanu/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe';
if (!existsSync(exe)) {
  console.error('No hay Chromium.');
  process.exit(1);
}

const browser = await chromium.launch({
  executablePath: exe,
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
  viewport: { width: 915, height: 412 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
});
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});

await page.goto('http://127.0.0.1:1420/?daily=0', { waitUntil: 'load', timeout: 45000 });
await page.waitForFunction(() => Boolean(window.__fungiflush?.engine?.run), { timeout: 30000 });
await page.waitForTimeout(2200);

const checks = [];

// --- 1. Dorso propio disponible en cosmeticos --------------------------------
const cosmetics = await page.evaluate(() => {
  const p = window.__fungiflush.profileStore?.current;
  return {
    owned: p?.cosmetics?.owned ?? null,
    equipped: p?.cosmetics?.equippedCardBack ?? null,
  };
});
checks.push({
  name: 'el perfil tiene el dorso mycelial en cosméticos',
  pass: Array.isArray(cosmetics.owned) && cosmetics.owned.includes('mycelial'),
  detail: JSON.stringify(cosmetics),
});

// --- 2. Parchear el perfil con 1 sobre de cada tipo y abrir la Coleccion -----
const granted = await page.evaluate(() => {
  const ff = window.__fungiflush;
  // Se regalan los dos: uno base y uno de expansion.
  ff.profileStore.patch((p) => {
    p.packs.pending = Math.max(1, p.packs.pending);
    p.packs.expansionPending = Math.max(1, p.packs.expansionPending);
  });
  return {
    base: ff.profileStore.current.packs.pending,
    expansion: ff.profileStore.current.packs.expansionPending,
  };
});
checks.push({
  name: 'inventario con sobres de los dos tipos',
  pass: granted.base > 0 && granted.expansion > 0,
  detail: JSON.stringify(granted),
});

// Abrir la Coleccion desde el menu (es donde viven los botones de Sobres).
await page.evaluate(() => {
  const btn = document.querySelector('.panel.is-menu [data-act="collection"]');
  if (btn) btn.click();
});
await page.waitForTimeout(1600);

const buttons = await page.evaluate(() => {
  const base = document.querySelector('[data-act="sobres"]');
  const exp = document.querySelector('[data-act="sobres-expansion"]');
  const count = (el) => el?.querySelector('.pack-count')?.textContent ?? null;
  return {
    base: Boolean(base),
    baseText: base?.textContent ?? null,
    baseCount: count(base),
    expansion: Boolean(exp),
    expansionText: exp?.textContent ?? null,
    expansionCount: count(exp),
  };
});
checks.push({
  name: 'la Colección muestra DOS botones de sobre diferenciados',
  pass: buttons.base && buttons.expansion && buttons.expansionText !== buttons.baseText,
  detail: JSON.stringify(buttons),
});

// --- 3/4/5. Abrir el sobre de EXPANSION desde su boton ----------------------
// Se intercepta el pool real consultando el registro, y se mira el overlay.
await page.evaluate(() => {
  document.querySelector('[data-act="sobres-expansion"]')?.click();
});
await page.waitForFunction(() => Boolean(document.querySelector('.pack-overlay')), {
  timeout: 8000,
});
await page.waitForTimeout(600);

const overlay = await page.evaluate(() => {
  const ff = window.__fungiflush;
  const el = document.querySelector('.pack-overlay');
  const canvas = document.querySelector('.pack-canvas');
  // El pool de expansion: cartas cuyo pack es `deep_mycelium`.
  const all = ff.content.registry.poolOf('card');
  const deep = all.filter((d) => ff.content.registry.packOf(d.id) === 'deep_mycelium');
  const base = all.filter((d) => ff.content.registry.packOf(d.id) !== 'deep_mycelium');
  const dbg = ff.hud.packOpeningState?.() ?? null;
  // Cada carta sorteada tiene que pertenecer al pack de expansion.
  const drawnOrigin =
    dbg?.cardIds?.map((id) => ff.content.registry.packOf(id) ?? '?') ?? [];
  return {
    overlayPresent: Boolean(el),
    canvasPresent: Boolean(canvas),
    deepCount: deep.length,
    baseCount: base.length,
    debug: dbg,
    drawnOrigin,
    packs: {
      base: ff.profileStore.current.packs.pending,
      expansion: ff.profileStore.current.packs.expansionPending,
      opened: ff.profileStore.current.packs.opened,
      expansionOpened: ff.profileStore.current.packs.expansionOpened,
    },
  };
});
checks.push({
  name: 'el pool de expansión tiene cartas propias y el base es distinto',
  pass: overlay.deepCount > 0 && overlay.baseCount > 0,
  detail: `deep=${overlay.deepCount} base=${overlay.baseCount}`,
});
checks.push({
  name: 'abrir el sobre de expansión monta su overlay',
  pass: overlay.overlayPresent && overlay.canvasPresent,
  detail: JSON.stringify({ overlay: overlay.overlayPresent, canvas: overlay.canvasPresent }),
});
checks.push({
  name: 'el overlay sabe que es de EXPANSION y trae su dorso propio',
  pass: overlay.debug?.kind === 'expansion' && overlay.debug?.hasBackArt === true,
  detail: JSON.stringify(overlay.debug),
});
checks.push({
  name: 'TODAS las cartas sorteadas salen del pack deep_mycelium',
  pass:
    Array.isArray(overlay.drawnOrigin) &&
    overlay.drawnOrigin.length > 0 &&
    overlay.drawnOrigin.every((p) => p === 'deep_mycelium'),
  detail: JSON.stringify(overlay.drawnOrigin),
});
checks.push({
  name: 'el inventario de expansión se descuenta (y el base NO)',
  pass:
    overlay.packs.expansion === 0 &&
    overlay.packs.expansionOpened === 1 &&
    overlay.packs.base >= 1 &&
    overlay.packs.opened === 0,
  detail: JSON.stringify(overlay.packs),
});

await page.screenshot({ path: 'tools/shots/probe-expansion-pack.png' });

console.log('\n=== PROBE SOBRE DE EXPANSION ===');
for (const c of checks) {
  console.log(`${c.pass ? 'OK ' : 'XX '} ${c.name}\n     ${c.detail}`);
}
console.log('\nerrores de consola:', errors.length ? errors.slice(0, 4) : 'ninguno');

const ok = checks.every((c) => c.pass) && errors.length === 0;
console.log(ok ? '\nOK SOBRES DIFERENCIADOS' : '\nXX HAY ALGO MAL');
await browser.close();
process.exitCode = ok ? 0 : 1;
