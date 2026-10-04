/**
 * probe-joker-slots.mjs — Verifica P6 (ranuras fijas de Simbionte).
 *
 * Comprueba, en un navegador real:
 *   1. Cuantas ranuras 3D existen vs `jokerSlots` del motor.
 *   2. Su tamano: DEBE ser el de una carta normal (CARD_WIDTH x CARD_HEIGHT x
 *      JOKER_SCALE), o sea "misma huella" que un Simbionte real.
 *   3. Que una ranura VACIA este visible en partida (no oculta por el menu).
 *   4. Que al sumar una ranura (jokerSlots++) aparezca una nueva.
 *
 *   FF_URL=http://127.0.0.1:1420/?daily=0 node tools/probe-joker-slots.mjs
 */
import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const URL_TO_TEST = process.env.FF_URL ?? 'http://127.0.0.1:1420/?daily=0';
const PW_CANDIDATES = [
  'C:/Users/emanu/.workbuddy-ai/binaries/node/workspace/node_modules/playwright-core/index.js',
];
const pw = await (async () => {
  try { return await import('playwright-core'); } catch {
    for (const c of PW_CANDIDATES) if (existsSync(c)) return await import(pathToFileURL(c).href);
  }
})();
const chromium = pw.chromium ?? pw.default?.chromium;
const exe = [
  'C:/Users/emanu/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe',
  'C:/Users/emanu/AppData/Local/ms-playwright/chromium-1228/chrome-win64/chrome.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
].find((p) => existsSync(p));
if (!exe) { console.error('No hay Chromium.'); process.exit(1); }

const browser = await chromium.launch({
  executablePath: exe,
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--disable-dev-shm-usage'],
});
const context = await browser.newContext({ viewport: { width: 915, height: 412 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const page = await context.newPage();
page.on('pageerror', (e) => console.error('[pageerror]', e.message));

await page.goto(URL_TO_TEST, { waitUntil: 'load', timeout: 45000 });
await page.waitForFunction(() => Boolean(window.__fungiflush?.engine?.run), { timeout: 30000 });
await page.waitForTimeout(2000);

// Entrar a partida.
await page.evaluate(() => document.querySelector('[data-act="tutorial-close"]')?.click());
await page.waitForTimeout(200);
await page.evaluate(() => document.querySelector('.panel.is-menu [data-act="new"]')?.click());
await page.waitForTimeout(1200);
await page.evaluate(() => document.querySelector('[data-act="tutorial-close"]')?.click());
await page.waitForTimeout(400);
await page.evaluate(() => {
  const ff = window.__fungiflush;
  ff.engine.chooseBlind(ff.engine.availableBlinds()[0]?.id);
});
await page.waitForFunction(() => (window.__fungiflush?.engine?.round?.hand?.length ?? 0) > 0, { timeout: 15000 });
await page.waitForTimeout(1200);

const inspect = () => page.evaluate(() => {
  const ff = window.__fungiflush;
  return {
    ...ff.scene.jokerSlotDebug(),
    engineJokerSlots: ff.engine.run.jokerSlots ?? null,
    jokers: ff.engine.run.jokers?.length ?? null,
  };
});

const before = await inspect();
console.log('\n=== Antes de sumar ranura ===');
console.log(JSON.stringify(before, null, 2));

// Sumar una ranura por la API del motor y re-sincronizar via el bus.
await page.evaluate(() => {
  const ff = window.__fungiflush;
  ff.engine.run.jokerSlots = (ff.engine.run.jokerSlots ?? 0) + 1;
  ff.scene.syncJokers(ff.engine.run.jokers, ff.engine.run.jokerSlots);
});
await page.waitForTimeout(700);

const after = await inspect();
console.log('\n=== Tras jokerSlots + 1 ===');
console.log(JSON.stringify(after, null, 2));

// Chequeo de tamano: la ranura debe medir CARD_WIDTH(2.2)*0.86 x CARD_HEIGHT(3.2)*0.86.
const EXPECT_W = Number((2.2 * 0.86).toFixed(4));
const EXPECT_H = Number((3.2 * 0.86).toFixed(4));
const sizesOk = after.slots.length > 0 && after.slots.every((s) => s.w === EXPECT_W && s.h === EXPECT_H);
const grew = after.count === before.count + 1;
const anyVisible = after.slots.some((s) => s.visible);

console.log('\n=== Veredicto ===');
console.log(`  tamano esperado ${EXPECT_W} x ${EXPECT_H} -> ${sizesOk ? 'OK' : 'FALLA'}`);
console.log(`  aparece 1 ranura nueva al sumar (${before.count} -> ${after.count}) -> ${grew ? 'OK' : 'FALLA'}`);
console.log(`  al menos una ranura visible en partida -> ${anyVisible ? 'OK' : 'FALLA'}`);

await browser.close();
process.exit(sizesOk && grew && anyVisible ? 0 : 1);
