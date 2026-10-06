/**
 * stress-sort.mjs — Peor caso de carreras del abanico.
 *
 * Hace SORTS seguidos y JUGADAS rapidas (sin esperar que termine la animacion),
 * midiendo el gap minimo entre cartas vecinas DESPUES de que el layout asiente.
 * El gap uniforme es 2.32; cualquier valor < 1.9 es una superposicion real.
 */
import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
const PW = ['C:/Users/emanu/.workbuddy-ai/binaries/node/workspace/node_modules/playwright-core/index.js'];
const pw = await (async () => {
  try { return await import('playwright-core'); } catch {
    for (const c of PW) if (existsSync(c)) return await import(pathToFileURL(c).href);
  }
})();
const chromium = pw.chromium ?? pw.default?.chromium;
const exe = [
  'C:/Users/emanu/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
].find((p) => existsSync(p));
const browser = await chromium.launch({
  executablePath: exe,
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--disable-dev-shm-usage'],
});
const page = await (await browser.newContext({ viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true })).newPage();
page.on('pageerror', (e) => console.error('[pageerror]', e.message));
await page.goto('http://127.0.0.1:1420/?daily=0', { waitUntil: 'load', timeout: 45000 });
await page.waitForFunction(() => Boolean(window.__fungiflush?.engine?.run), { timeout: 30000 });
await page.waitForTimeout(2000);
await page.evaluate(() => document.querySelector('[data-act="tutorial-close"]')?.click());
await page.waitForTimeout(300);
await page.evaluate(() => document.querySelector('.panel.is-menu [data-act="new"]')?.click());
await page.waitForTimeout(1200);
// "Nueva partida" abre el selector de ARQUETIPO: el jugador elige y arranca.
await page.evaluate(() => document.querySelector('.panel.is-archetypes [data-act="archetypes-start"]')?.click());
await page.waitForTimeout(1500);
await page.evaluate(() => {
  const ff = window.__fungiflush;
  ff.engine.chooseBlind(ff.engine.availableBlinds()[0]?.id);
});
await page.waitForFunction(() => (window.__fungiflush?.engine?.round?.hand?.length ?? 0) > 0, { timeout: 15000 });

let bad = 0;
let checks = 0;
const check = async (label) => {
  const xs = await page.evaluate(() => window.__fungiflush.scene.readHandXs());
  if (xs.length < 2) return;
  let minGap = Infinity;
  for (let i = 1; i < xs.length; i += 1) minGap = Math.min(minGap, Math.abs(xs[i] - xs[i - 1]));
  checks += 1;
  const ok = minGap > 1.9;
  if (!ok) bad += 1;
  console.log(`${ok ? 'ok ' : 'BAD'} ${label} minGap=${minGap.toFixed(3)}`);
};
const sortTo = async (m) => {
  await page.evaluate(() => document.querySelector('[data-act="sort"]')?.click());
  await page.waitForTimeout(120);
  await page.evaluate((x) => document.querySelector(`[data-sort-mode="${x}"]`)?.click(), m);
};

for (const m of ['family', 'substrate', 'value', 'ability', 'recommended', 'family']) {
  await sortTo(m);
  await page.waitForTimeout(700);
  await check(`tras sort ${m}`);
}

for (let i = 0; i < 6; i += 1) {
  const st = await page.evaluate(() => window.__fungiflush.engine.run.status);
  if (st !== 'playing') { console.log('status', st); break; }
  await page.evaluate(() => {
    const ff = window.__fungiflush;
    const h = ff.engine.round.hand;
    for (const c of h.slice(0, 1)) ff.engine.toggleSelect(c.uid);
  });
  await page.waitForTimeout(120);
  await page.evaluate(() => document.querySelector('[data-act="play"]')?.click());
  await page.waitForTimeout(1100);
  await check(`play rapido #${i} (mid-anim)`);
  await page.waitForTimeout(1600);
  await check(`play asentado #${i}`);
}

console.log(`\n${bad}/${checks} mediciones con superposicion.`);
await browser.close();
