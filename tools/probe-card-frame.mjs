/**
 * probe-card-frame.mjs — El marco pintado de carta y el flash de combo.
 *
 * QUE VERIFICA (regresiones reales, las dos silenciosas)
 * -----------------------------------------------------
 *   1. `art_card_frame.webp` esta en el manifiesto Y se descarga de verdad.
 *      El marco fallaba EN SILENCIO: el generador escribia `card_frame.webp`
 *      pero `ArtAssets` resuelve la clave `card_frame` a `art_card_frame.webp`,
 *      asi que el archivo no mapeaba a ninguna clave, nunca se pedia y las
 *      cartas caian al marco procedural sin un solo 404 (el smoke no lo ve).
 *   2. El flash del cierre de combo vive en `#arena-pulse` (capa propia ENCIMA
 *      del canvas, animada por `opacity`) y `#arena-bg` NO lleva `filter` ni
 *      `transform`. Ponerlos sobre la capa fullscreen del fondo dejaba la
 *      pantalla en negro en movil justo al dispararse el pulso.
 *
 *   node tools/probe-card-frame.mjs
 */
import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

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
if (!exe) { console.error('No hay Chromium.'); process.exit(1); }

const URL_TO_TEST = process.env.FF_URL ?? 'http://127.0.0.1:1420/?daily=0&quality=high';

let failures = 0;
const check = (ok, label, detail = '') => {
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
};

const browser = await chromium.launch({
  executablePath: exe, headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--disable-dev-shm-usage'],
});
const context = await browser.newContext({ viewport: { width: 915, height: 412 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
const page = await context.newPage();
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

await page.goto(URL_TO_TEST, { waitUntil: 'load', timeout: 45000 });
await page.waitForFunction(() => Boolean(window.__fungiflush?.engine?.run), { timeout: 30000 });
await page.waitForTimeout(1500);

const click = (sel) => page.evaluate((s) => document.querySelector(s)?.click(), sel);
await click('[data-act="tutorial-close"]');
await click('.panel.is-menu [data-act="new"]');
await page.waitForTimeout(700);
await page.evaluate(() => document.querySelector('[data-act="archetypes-start"]')?.click());
await page.waitForTimeout(1400);
await click('[data-act="tutorial-close"]');
await page.evaluate(() => window.__fungiflush.engine.chooseBlind());
await page.waitForFunction(() => (window.__fungiflush.engine?.round?.hand?.length ?? 0) > 0, { timeout: 15000 });
await page.waitForTimeout(1200);

// --- 1) El marco pintado ---
const manifest = await page.evaluate(async () => {
  const r = await fetch('art/index.json', { cache: 'no-cache' });
  const j = await r.json();
  return j.files ?? [];
});
check(
  manifest.includes('art_card_frame.webp'),
  '1 el manifiesto declara art_card_frame.webp',
  `frame=${manifest.filter((f) => /card_frame/.test(f)).join(',') || 'ninguno'}`,
);

const fetched = await page.evaluate(() =>
  performance.getEntriesByType('resource')
    .filter((r) => r.name.includes('art_card_frame'))
    .map((r) => ({ file: r.name.split('/').pop(), bytes: r.decodedBodySize ?? r.transferSize })),
);
check(fetched.length === 1, '1 el navegador pide el marco una sola vez', JSON.stringify(fetched));
check(
  fetched.length === 1 && fetched[0].bytes > 1000,
  '1 el marco se DESCARGA (no cae al procedural)',
  fetched[0] ? `${fetched[0].file} ${fetched[0].bytes}B` : 'no se pidio',
);

// --- 2) El flash de combo ---
const pulse = await page.evaluate(() => {
  const p = document.getElementById('arena-pulse');
  const bg = document.getElementById('arena-bg');
  return {
    pulseExists: Boolean(p),
    pulsePointerEvents: p ? getComputedStyle(p).pointerEvents : null,
    bgFilter: bg ? getComputedStyle(bg).filter : null,
    bgTransform: bg ? getComputedStyle(bg).transform : null,
    bgWillChange: bg ? getComputedStyle(bg).willChange : null,
  };
});
check(pulse.pulseExists, '2 existe #arena-pulse');
check(pulse.pulsePointerEvents === 'none', '2 el flash no come toques', `pointer-events=${pulse.pulsePointerEvents}`);
check(pulse.bgFilter === 'none', '2 #arena-bg NO lleva filter', `filter=${pulse.bgFilter}`);
check(
  pulse.bgTransform === 'none' || pulse.bgTransform === 'matrix(1, 0, 0, 1, 0, 0)',
  '2 #arena-bg NO lleva transform',
  `transform=${pulse.bgTransform}`,
);
check(pulse.bgWillChange === 'auto', '2 #arena-bg sin will-change (no se promueve la capa)', `will-change=${pulse.bgWillChange}`);

// El pulso tiene que MOVERSE al cerrar un combo. Se eligen cartas del MISMO
// elemento a proposito: sin combo no hay cierre y el pulso no se dispara.
const played = await page.evaluate(() => {
  const ff = window.__fungiflush;
  const hand = ff.engine.round?.hand ?? [];
  const byElement = new Map();
  for (const c of hand) {
    const el = c.def?.element ?? 'x';
    if (!byElement.has(el)) byElement.set(el, []);
    byElement.get(el).push(c);
  }
  const group = [...byElement.values()].sort((a, b) => b.length - a.length)[0] ?? [];
  ff.engine.clearSelection();
  for (const c of group.slice(0, 5)) ff.engine.toggleSelect(c.uid);
  const n = ff.engine.round?.selected?.length ?? 0;
  ff.engine.playHand();
  return { element: group[0]?.def?.element ?? null, selected: n };
});
check(played.selected >= 2, '2 la mano elegida forma combo (mismo elemento)', JSON.stringify(played));

// El cierre del combo va al FINAL de la timeline de puntuacion (~5 s), asi que
// la ventana tiene que ser holgada: se corta apenas se ve el pulso.
let maxPulse = 0;
for (let i = 0; i < 90; i++) {
  const v = await page.evaluate(() => Number(getComputedStyle(document.getElementById('arena-pulse')).opacity));
  if (v > maxPulse) maxPulse = v;
  if (maxPulse > 0.2) break;
  await page.waitForTimeout(120);
}
check(maxPulse > 0.2, '2 el flash se ANIMA en el cierre de combo', `opacity max=${maxPulse.toFixed(2)}`);

check(errors.length === 0, 'sin errores de consola', errors.slice(0, 2).join(' | '));

await browser.close();
console.log(`\n${failures === 0 ? 'TODO OK' : `${failures} FALLO(S)`}`);
process.exit(failures === 0 ? 0 : 1);
