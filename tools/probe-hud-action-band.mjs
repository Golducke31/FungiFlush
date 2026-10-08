/**
 * probe-hud-action-band.mjs — F4: franja de accion unica en movil.
 *
 * Verifica el layout de la banda de accion (tanda 1):
 *   (D) contadores FLANQUEAN el boton JUGAR MANO (izq/dcha) y el boton queda
 *       centrado encima de ellos; la banda es una sola fila.
 *   (C) al jugar una mano aparece la CONSECUENCIA en UNA linea (.hud-consequence).
 *   (A) el chip de Misiones queda a la IZQUIERDA.
 *
 *   node tools/probe-hud-action-band.mjs
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

const BOX = `(sel) => {
  const el = typeof sel === 'string' ? document.querySelector(sel) : sel;
  if (!el) return null;
  const r = el.getBoundingClientRect();
  const cs = getComputedStyle(el);
  return {
    cx: Math.round(r.left + r.width / 2), cy: Math.round(r.top + r.height / 2),
    left: Math.round(r.left), right: Math.round(r.right),
    w: Math.round(r.width), h: Math.round(r.height),
    display: cs.display,
  };
}`;

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

// --- Geometria de la franja de accion ANTES de jugar ---
const layout = await page.evaluate((boxSrc) => {
  const box = eval(boxSrc);
  const chips = [...document.querySelectorAll('.hud-counters .counter.is-resource')].map((c) => box(c));
  return {
    vw: window.innerWidth, vh: window.innerHeight,
    bottom: box('.hud-bottom'),
    actionRow: box('.hud-action-row'),
    counters: box('.hud-counters'),
    actions: box('.hud-actions'),
    play: box('.hud-actions .btn.is-play'),
    chips,
    consequence: box('.hud-consequence'),
    missionsToggleLeft: (() => {
      const m = document.querySelector('.hud-missions-toggle.is-visible');
      if (!m) return null;
      const r = m.getBoundingClientRect();
      return Math.round(r.left);
    })(),
  };
}, BOX);
console.log('\n=== LAYOUT (antes de jugar) ===');
console.log(JSON.stringify(layout, null, 2));

let failures = 0;
const check = (ok, label, detail = '') => {
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
};

check(Boolean(layout.actionRow), 'F4: existe la franja .hud-action-row');
check(layout.chips.length === 2, 'F4: hay 2 contadores de recurso (Manos/Descartes)', `${layout.chips.length}`);
if (layout.chips.length === 2) {
  const [left, right] = layout.chips;
  const playCx = layout.play?.cx ?? 0;
  check(left.left < playCx, 'F4(D): el contador IZQUIERDO flanquea el boton', `chipIzq.left=${left.left} < play.cx=${playCx}`);
  check(right.right > playCx, 'F4(D): el contador DERECHO flanquea el boton', `chipDer.right=${right.right} > play.cx=${playCx}`);
}
if (layout.play) {
  const centerErr = Math.abs(layout.play.cx - layout.vw / 2);
  check(centerErr <= 40, 'F4(D): JUGAR MANO queda CENTRADO en la franja', `err=${centerErr}px (cx=${layout.play.cx}, vw=${layout.vw})`);
}
check(layout.missionsToggleLeft !== null && layout.missionsToggleLeft < layout.vw / 2, 'F4(A): chip Misiones a la IZQUIERDA', `left=${layout.missionsToggleLeft}`);

// --- Jugar una mano para disparar la CONSECUENCIA en una linea ---
await page.evaluate(() => {
  const ff = window.__fungiflush;
  const hand = ff.engine.round?.hand ?? [];
  hand.forEach((c) => ff.engine.toggleSelect(c.uid));
});
await page.waitForTimeout(300);
await page.evaluate(() => document.querySelector('.hud-actions [data-act="play"]')?.click());
await page.waitForTimeout(1600);

const afterPlay = await page.evaluate((boxSrc) => {
  const box = eval(boxSrc);
  const el = document.querySelector('.hud-consequence');
  return {
    display: el ? getComputedStyle(el).display : 'none',
    text: el?.textContent?.trim() ?? '',
    box: box('.hud-consequence'),
  };
}, BOX);
console.log('\n=== TRAS JUGAR ===');
console.log(JSON.stringify(afterPlay, null, 2));
check(afterPlay.display !== 'none' && afterPlay.text.length > 0, 'F4(C): la CONSECUENCIA aparece en una linea', JSON.stringify(afterPlay.text).slice(0, 80));

await page.screenshot({ path: 'tools/shots/probe-action-band.png' });
console.log('\n---');
console.log(`fallos: ${failures}`);
console.log('errores de pagina:', errors.length ? errors.slice(0, 5) : 'ninguno');
if (errors.length) failures += 1;
await browser.close();
process.exit(failures > 0 ? 1 : 0);
