/**
 * shot-joker-slots.mjs — Captura la fila de ranuras de Simbionte (P6).
 *
 * Pone la mesa en estado "partida" con 5 ranuras vacias y luego le da un
 * Simbionte para ver el llenado de la primera ranura. Saca dos PNG.
 *
 *   node tools/shot-joker-slots.mjs
 */
import { existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
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
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
].find((p) => existsSync(p));

const shotsDir = join(ROOT, 'tools', 'shots');
if (!existsSync(shotsDir)) mkdirSync(shotsDir, { recursive: true });

const browser = await chromium.launch({
  executablePath: exe,
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--disable-dev-shm-usage'],
});
const context = await browser.newContext({ viewport: { width: 1440, height: 810 } });
const page = await context.newPage();
page.on('pageerror', (e) => console.error('[pageerror]', e.message));

await page.goto(URL_TO_TEST, { waitUntil: 'load', timeout: 45000 });
await page.waitForFunction(() => Boolean(window.__fungiflush?.engine?.run), { timeout: 30000 });
await page.waitForTimeout(2000);

await page.evaluate(() => document.querySelector('[data-act="tutorial-close"]')?.click());
await page.waitForTimeout(200);
await page.evaluate(() => document.querySelector('.panel.is-menu [data-act="new"]')?.click());
await page.waitForTimeout(1200);
// "Nueva partida" abre el selector de ARQUETIPO: el jugador elige y arranca.
await page.evaluate(() => document.querySelector('.panel.is-archetypes [data-act="archetypes-start"]')?.click());
await page.waitForTimeout(1400);
await page.evaluate(() => document.querySelector('[data-act="tutorial-close"]')?.click());
await page.waitForTimeout(400);
await page.evaluate(() => {
  const ff = window.__fungiflush;
  ff.engine.chooseBlind(ff.engine.availableBlinds()[0]?.id);
});
await page.waitForFunction(() => (window.__fungiflush?.engine?.round?.hand?.length ?? 0) > 0, { timeout: 15000 });
await page.waitForTimeout(1500);

await page.screenshot({ path: join(shotsDir, 'slots-empty.png') });
console.log('slots-empty.png listo');

// Agregar un Simbionte: la primera ranura debe llenarse sola.
const added = await page.evaluate(() => {
  const ff = window.__fungiflush;
  const all = ff.content.registry.toBundle().jokers;
  const list = Array.isArray(all) ? all : Object.values(all);
  const pick = list.find((j) => j?.id?.startsWith('joker_')) ?? list[0];
  if (!pick) return { ok: false, reason: 'sin jokers' };
  const joker = ff.engine.registry.instantiateJoker(pick.id);
  ff.engine.run.jokers.push(joker);
  ff.scene.syncJokers(ff.engine.run.jokers, ff.engine.run.jokerSlots);
  return { ok: true, id: pick.id };
});
console.log('addJoker:', JSON.stringify(added));
await page.waitForTimeout(1400);
await page.screenshot({ path: join(shotsDir, 'slots-one.png') });
console.log('slots-one.png listo');

await browser.close();
