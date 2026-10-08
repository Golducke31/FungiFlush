/**
 * probe-pile-badge.mjs — F5/E: insignia dorada de las pilas.
 *
 * Verifica que las etiquetas de Mazo/Descarte usan el componente de insignia
 * dorada: nombre + subetiqueta + contador que RUEDA, con estados bajo/vacio.
 *
 *   node tools/probe-pile-badge.mjs
 */
import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const PW = 'C:/Users/emanu/.workbuddy-ai/binaries/node/workspace/node_modules/playwright-core/index.js';
const pw = await import(pathToFileURL(PW).href);
const chromium = pw.chromium ?? pw.default?.chromium;
const exe = 'C:/Users/emanu/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe';
if (!existsSync(exe)) { console.error('No hay Chromium.'); process.exit(1); }

const browser = await chromium.launch({
  executablePath: exe,
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--disable-dev-shm-usage'],
});
const context = await browser.newContext({
  viewport: { width: 915, height: 412 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
});
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));

await page.goto('http://127.0.0.1:1420/?daily=0', { waitUntil: 'load', timeout: 45000 });
await page.waitForFunction(() => Boolean(window.__fungiflush?.engine?.run), { timeout: 30000 });
await page.waitForTimeout(2200);
await page.evaluate(() => document.querySelector('[data-act="tutorial-close"]')?.click());
await page.waitForTimeout(300);
await page.evaluate(() => document.querySelector('.panel.is-menu [data-act="new"]')?.click());
await page.waitForTimeout(1200);
await page.evaluate(() => document.querySelector('.panel.is-archetypes [data-act="archetypes-start"]')?.click());
await page.waitForTimeout(1400);
await page.evaluate(() => document.querySelector('[data-act="tutorial-close"]')?.click());
await page.waitForTimeout(700);
await page.evaluate(() => {
  const ff = window.__fungiflush;
  ff.engine.chooseBlind(ff.engine.availableBlinds()[0]?.id);
});
await page.waitForFunction(() => (window.__fungiflush?.engine?.round?.hand?.length ?? 0) > 0, { timeout: 15000 });
await page.waitForTimeout(1400);

const snap = () => page.evaluate(() => {
  const read = (sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const num = el.querySelector('.pile-label-num');
    return {
      visible: el.classList.contains('is-visible'),
      name: el.querySelector('.pile-label-name')?.textContent ?? '',
      sub: el.querySelector('.pile-label-sub')?.textContent ?? '',
      hasBadge: Boolean(el.querySelector('.pile-label-count')),
      count: num?.textContent ?? '',
      nivel: el.dataset.nivel ?? '',
      aria: el.getAttribute('aria-label') ?? '',
    };
  };
  return { deck: read('.hud-bottom ~ * .pile-label[data-pile="deck"], .pile-label[data-pile="deck"]'), disc: read('.pile-label[data-pile="descarte"]') };
});

const base = await snap();
console.log('\n=== PILAS (estado inicial) ===');
console.log(JSON.stringify(base, null, 2));

let failures = 0;
const check = (ok, label, detail = '') => {
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
};

check(Boolean(base.deck), 'F5/E: etiqueta Mazo existe');
check(Boolean(base.disc), 'F5/E: etiqueta Descarte existe');
if (base.deck) {
  check(base.deck.visible, 'F5/E: Mazo visible en partida');
  check(base.deck.hasBadge, 'F5/E: Mazo tiene insignia dorada (.pile-label-count)');
  check(base.deck.name === 'Mazo', 'F5/E: nombre Mazo', base.deck.name);
  check(base.deck.sub.length > 0, 'F5/E: subetiqueta presente', base.deck.sub);
  check(/^\d+$/.test(base.deck.count), 'F5/E: contador es numero', base.deck.count);
}

// Forzar estado BAJO (mazo <= 3) y VACIO via FungiPilas.set (paridad con componente).
await page.evaluate(() => window.__fungiflush.FungiPilas.set({ mazo: 2 }));
await page.waitForTimeout(400);
const bajo = await snap();
check(bajo.deck?.nivel === 'bajo', 'F5/E: mazo=2 => data-nivel=bajo', bajo.deck?.nivel);
check(bajo.deck?.count === '2', 'F5/E: insignia muestra 2', bajo.deck?.count);

await page.evaluate(() => window.__fungiflush.FungiPilas.set({ mazo: 0 }));
await page.waitForTimeout(400);
const vacio = await snap();
check(vacio.deck?.nivel === 'vacio', 'F5/E: mazo=0 => data-nivel=vacio', vacio.deck?.nivel);
check(vacio.deck?.count === '0', 'F5/E: insignia muestra 0', vacio.deck?.count);

// Restaurar un valor normal y capturar.
await page.evaluate(() => window.__fungiflush.FungiPilas.set({ mazo: 24, descarte: 6 }));
await page.waitForTimeout(400);
await page.screenshot({ path: 'tools/shots/probe-pile-badge.png' });

console.log('\n---');
console.log(`fallos: ${failures}`);
console.log('errores de pagina:', errors.length ? errors.slice(0, 5) : 'ninguno');
if (errors.length) failures += 1;
await browser.close();
process.exit(failures > 0 ? 1 : 0);
