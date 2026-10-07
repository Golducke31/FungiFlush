/**
 * probe-packs.mjs — Abre un Sobre de verdad y verifica el flujo completo.
 *
 * Camino real: Coleccion -> boton "Sobres" -> overlay -> abrir -> revelar todas
 * -> cerrar y volver a la Coleccion.
 *
 * Verifica lo que puede romperse sin que el motor se entere:
 *   1. El boton de Sobres vive DENTRO de la Coleccion (no en el menu principal).
 *   2. El sobre se CONSUME al abrirlo (no se puede reabrir el mismo).
 *   3. El overlay monta su canvas y llega a `done`.
 *   4. Cerrar devuelve a la Coleccion.
 */
import { pathToFileURL } from 'node:url';

const W = Number(process.env.FF_WIDTH || 915);
const H = Number(process.env.FF_HEIGHT || 412);

const pw = await import(
  pathToFileURL('C:/Users/emanu/.workbuddy-ai/binaries/node/workspace/node_modules/playwright-core/index.js').href
);
const chromium = pw.chromium ?? pw.default?.chromium;
const browser = await chromium.launch({
  executablePath:
    'C:/Users/emanu/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe',
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--disable-gpu'],
});
const ctx = await browser.newContext({
  viewport: { width: W, height: H },
  hasTouch: true,
  isMobile: true,
  deviceScaleFactor: 1,
});
const page = await ctx.newPage();
const errors = [];
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});
page.on('pageerror', (e) => errors.push(String(e)));

await page.goto('http://127.0.0.1:1420/?daily=0', { waitUntil: 'load' });
await page.waitForFunction(() => Boolean(window.__fungiflush?.engine), { timeout: 25000 });
await page.waitForSelector('.panel.is-menu', { timeout: 25000 });

// El menu esta animado: locator.click() se cuelga por "not stable".
const clickAt = async (sel) => {
  const b = await page.locator(sel).first().boundingBox();
  if (b) await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
};

// --- 1. Abrir la Coleccion desde el menu (hamburguesa -> Coleccion) ----------
// El desplegable tiene que estar abierto para que su item exista en el DOM.
await clickAt('.panel.is-menu [data-act="menu-toggle"]');
await page.waitForTimeout(700);
const hasDropItem = await page.evaluate(() =>
  Boolean(document.querySelector('[data-act="collection"]'))
);
if (hasDropItem) {
  await clickAt('[data-act="collection"]');
  await page.waitForTimeout(1500);
}

const collectionOpen = await page.evaluate(
  () => Boolean(document.querySelector('.panel.is-collection'))
);
console.log(`Coleccion abierta: ${collectionOpen}`);

// --- 2. El boton de Sobres esta DENTRO de la Coleccion -----------------------
const packBtn = await page.evaluate(() => {
  const panel = document.querySelector('.panel.is-collection');
  const btn = panel?.querySelector('[data-act="sobres"]');
  const inMenu = Boolean(document.querySelector('.panel.is-menu [data-act="sobres"]'));
  return {
    exists: Boolean(btn),
    inMenu,
    text: btn?.textContent?.trim() ?? null,
    hasCount: Boolean(btn?.querySelector('.pack-count')),
  };
});
console.log(`Boton Sobres en Coleccion: ${JSON.stringify(packBtn)}`);
if (!packBtn.exists) {
  console.log('\nFALLA: no hay boton de Sobres dentro de la Coleccion');
  await browser.close();
  process.exit(1);
}
if (packBtn.inMenu) {
  console.log('\nFALLA: el boton de Sobres NO debe estar en el menu principal');
  await browser.close();
  process.exit(1);
}

// --- 3. Regalar un sobre y abrirlo ------------------------------------------
const before = await page.evaluate(() => {
  window.__fungiflush.profileStore.patch((p) => {
    p.packs.pending = 2;
    p.packs.opened = 0;
  });
  return window.__fungiflush.profileStore.current.packs;
});
console.log(`Inventario antes: ${JSON.stringify(before)}`);

await page.evaluate(() => window.__fungiflush.openPack());
await page.waitForSelector('.pack-overlay', { timeout: 6000 });
await page.waitForTimeout(1400);

const mounted = await page.evaluate(() => {
  const overlay = document.querySelector('.pack-overlay');
  const canvas = overlay?.querySelector('canvas.pack-canvas');
  const r = canvas?.getBoundingClientRect();
  return {
    overlay: Boolean(overlay),
    canvas: Boolean(canvas),
    canvasW: r ? Math.round(r.width) : 0,
    canvasH: r ? Math.round(r.height) : 0,
    // El sobre se consume AL ABRIR, no al cerrar.
    pendingAfterOpen: window.__fungiflush.profileStore.current.packs.pending,
    openedAfterOpen: window.__fungiflush.profileStore.current.packs.opened,
    info: overlay?.querySelector('.pack-info')?.textContent ?? null,
  };
});
console.log(`Montaje: ${JSON.stringify(mounted)}`);

// --- 4. Abrir y revelar todas -----------------------------------------------
await clickAt('.pack-open');
await page.waitForFunction(
  () => Boolean(document.querySelector('.pack-all:not([hidden])')),
  { timeout: 20000 }
);
await page.waitForTimeout(600);
await page.screenshot({ path: `tools/shots/_pack-reveal-${W}.png` });

await clickAt('.pack-all');
// "Revelar todas" revela de a una (260ms cada una) + la animacion de flip.
await page.waitForFunction(
  () => document.querySelector('.pack-open')?.textContent?.trim().length > 0 &&
    !document.querySelector('.pack-all:not([hidden])'),
  { timeout: 30000 }
);
await page.waitForTimeout(700);
await page.screenshot({ path: `tools/shots/_pack-done-${W}.png` });

const afterReveal = await page.evaluate(() => {
  const overlay = document.querySelector('.pack-overlay');
  return {
    info: overlay?.querySelector('.pack-info')?.textContent ?? null,
    openLabel: overlay?.querySelector('.pack-open')?.textContent ?? null,
    // Pero seguimos dentro del overlay: no se cerro solo.
    stillOpen: Boolean(overlay),
  };
});
console.log(`Tras revelar: ${JSON.stringify(afterReveal)}`);

// --- 5. Cerrar vuelve a la Coleccion ----------------------------------------
await clickAt('.pack-close');
await page.waitForTimeout(1400);
const afterClose = await page.evaluate(() => ({
  overlayGone: !document.querySelector('.pack-overlay'),
  backInCollection: Boolean(document.querySelector('.panel.is-collection')),
  packs: window.__fungiflush.profileStore.current.packs,
}));
console.log(`Tras cerrar: ${JSON.stringify(afterClose)}`);

// --- 6. Al volver a la Coleccion, el contador del boton ya refleja el gasto --
const pillAfter = await page.evaluate(() => {
  const btn = document.querySelector('.panel.is-collection [data-act="sobres"]');
  return {
    hasCount: Boolean(btn?.querySelector('.pack-count')),
    count: btn?.querySelector('.pack-count')?.textContent?.trim() ?? null,
  };
});
console.log(`Contador tras cerrar: ${JSON.stringify(pillAfter)}`);

console.log(`\nErrores de consola: ${errors.length}`);
for (const e of errors.slice(0, 5)) console.log(`  ! ${e}`);

const ok =
  packBtn.exists &&
  !packBtn.inMenu &&
  mounted.overlay &&
  mounted.canvas &&
  mounted.pendingAfterOpen === 1 &&
  mounted.openedAfterOpen === 1 &&
  afterReveal.stillOpen &&
  afterClose.overlayGone &&
  afterClose.backInCollection &&
  afterClose.packs.pending === 1 &&
  afterClose.packs.opened === 1 &&
  // Queda 1 sobre pendiente: el boton tiene que seguir mostrando la pildora.
  pillAfter.hasCount &&
  pillAfter.count === '1' &&
  errors.length === 0;
console.log(ok ? '\nOK: el flujo de Sobres funciona de punta a punta.' : '\nFALLA en el flujo de Sobres.');
await browser.close();
process.exit(ok ? 0 : 1);
