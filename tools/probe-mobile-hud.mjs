/**
 * probe-mobile-hud.mjs — Mide el HUD movil en las fases de partida.
 *
 * Reporta, en un celular tactil (pointer: coarse):
 *   - playing: geometria de misiones (¿se corta el ultimo chip?), score, barras.
 *   - blind_select: ¿el panel de ciego entra sin scroll?
 *
 *   node tools/probe-mobile-hud.mjs
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
page.on('pageerror', (e) => console.error('[pageerror]', e.message));

/** Caja + señales de recorte de un elemento. */
const BOX = `(el) => {
  if (!el) return null;
  const r = el.getBoundingClientRect();
  const cs = getComputedStyle(el);
  return {
    top: Math.round(r.top), bottom: Math.round(r.bottom),
    left: Math.round(r.left), right: Math.round(r.right),
    w: Math.round(r.width), h: Math.round(r.height),
    display: cs.display, overflowY: cs.overflowY,
    scrollH: el.scrollHeight, clientH: el.clientHeight,
    clippedBottom: Math.round(r.bottom - window.innerHeight),
    clippedLeft: Math.round(r.left),
  };
}`;

await page.goto('http://127.0.0.1:1420/?daily=0', { waitUntil: 'load', timeout: 45000 });
await page.waitForFunction(() => Boolean(window.__fungiflush?.engine?.run), { timeout: 30000 });
await page.waitForTimeout(2200);
await page.evaluate(() => document.querySelector('[data-act="tutorial-close"]')?.click());
await page.waitForTimeout(300);

// --- BLIND SELECT ---
await page.evaluate(() => document.querySelector('.panel.is-menu [data-act="new"]')?.click());
await page.waitForTimeout(1200);
// "Nueva partida" abre el selector de ARQUETIPO: el jugador elige y arranca.
await page.evaluate(() => document.querySelector('.panel.is-archetypes [data-act="archetypes-start"]')?.click());
await page.waitForTimeout(1400);
await page.evaluate(() => document.querySelector('[data-act="tutorial-close"]')?.click());
await page.waitForTimeout(700);
const blindM = await page.evaluate((boxSrc) => {
  const box = eval(boxSrc);
  const panel = document.querySelector('.panel.is-blind-select');
  const grid = document.querySelector('.blind-grid');
  const luchar = document.querySelector('.panel.is-blind-select [data-act="fight"], .panel.is-blind-select .btn.is-play');
  const cards = [...(grid?.querySelectorAll('.blind-card') ?? [])].map((c) => box(c));
  return { panel: box(panel), grid: box(grid), luchar: box(luchar), cards, vh: window.innerHeight };
}, BOX);
console.log('\n=== BLIND SELECT 915x412 ===');
console.log(JSON.stringify(blindM, null, 2));
await page.screenshot({ path: 'tools/shots/probe-blind.png' });

// --- PLAYING ---
await page.evaluate(() => {
  const ff = window.__fungiflush;
  ff.engine.chooseBlind(ff.engine.availableBlinds()[0]?.id);
});
await page.waitForFunction(() => (window.__fungiflush?.engine?.round?.hand?.length ?? 0) > 0, { timeout: 15000 });
await page.waitForTimeout(1400);
const playM = await page.evaluate((boxSrc) => {
  const box = eval(boxSrc);
  const miss = document.querySelector('.hud-missions');
  const chips = [...document.querySelectorAll('.mission-chip')].map((c) => ({
    name: c.querySelector('.mission-chip-name')?.textContent,
    ...box(c),
  }));
  return {
    missions: box(miss),
    missionsTitle: box(document.querySelector('.hud-missions-title')),
    chips,
    score: box(document.querySelector('.hud-score')),
    top: box(document.querySelector('.hud-top')),
    bottom: box(document.querySelector('.hud-bottom')),
    vh: window.innerHeight,
  };
}, BOX);
console.log('\n=== PLAYING 915x412 ===');
console.log(JSON.stringify(playM, null, 2));
await page.screenshot({ path: 'tools/shots/probe-playing.png' });

await browser.close();
