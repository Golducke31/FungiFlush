/**
 * shot-mobile-deck.mjs — Captura y mide la vista MAZO/DECK en celular tactil.
 *
 * Reproduce el reporte de Emanuel: en movil, al abrir el Mazo se cuelan
 * elementos del HUD de partida (chip de nivel, jokers/misiones a la izquierda,
 * barra inferior) sobre el carrusel, y la barra superior del score queda
 * desordenada y demasiado grande.
 *
 *   node tools/shot-mobile-deck.mjs
 */
import { existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const URL_TO_TEST = process.env.FF_URL ?? 'http://127.0.0.1:1420/?daily=0';

const pw = await (async () => {
  try { return await import('playwright-core'); } catch {
    return await import(pathToFileURL('C:/Users/emanu/.workbuddy-ai/binaries/node/workspace/node_modules/playwright-core/index.js').href);
  }
})();
const chromium = pw.chromium ?? pw.default?.chromium;
const exe = 'C:/Users/emanu/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe';

const shotsDir = join(ROOT, 'tools', 'shots');
if (!existsSync(shotsDir)) mkdirSync(shotsDir, { recursive: true });

const browser = await chromium.launch({
  executablePath: exe,
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--disable-dev-shm-usage'],
});
const context = await browser.newContext({
  viewport: { width: 915, height: 412 },
  deviceScaleFactor: 2.5,
  isMobile: true,
  hasTouch: true,
});
const page = await context.newPage();
page.on('pageerror', (e) => console.error('[pageerror]', e.message));

await page.goto(URL_TO_TEST, { waitUntil: 'load', timeout: 45000 });
await page.waitForFunction(() => Boolean(window.__fungiflush?.engine?.run), { timeout: 30000 });
await page.waitForTimeout(2200);
await page.evaluate(() => document.querySelector('[data-act="tutorial-close"]')?.click());
await page.waitForTimeout(300);

// Arrancar run + elegir ciego + entrar en partida.
await page.evaluate(() => document.querySelector('.panel.is-menu [data-act="new"]')?.click());
await page.waitForTimeout(1400);
await page.evaluate(() => document.querySelector('[data-act="tutorial-close"]')?.click());
await page.waitForTimeout(600);
await page.evaluate(() => {
  const ff = window.__fungiflush;
  ff.engine.chooseBlind(ff.engine.availableBlinds()[0]?.id);
});
await page.waitForFunction(() => (window.__fungiflush?.engine?.round?.hand?.length ?? 0) > 0, { timeout: 15000 });
await page.waitForTimeout(1000);

// Dar un joker a mano para que la columna de Simbiontes se vea, y una mision
// activa ya la trae el run.
await page.evaluate(() => {
  const ff = window.__fungiflush;
  const ids = ff.engine.registry.allJokers().map((j) => j.id);
  if (ids[0] && ff.engine.run.jokers.length === 0) {
    ff.engine.run.jokers.push(ff.engine.registry.instantiateJoker(ids[0]));
    ff.hud.refreshPanel();
  }
});
await page.waitForTimeout(600);

// Abrir el MAZO en su carrusel 3D (la vista real del reporte). `openDeck` se
// expone en `window.__fungiflush` solo en DEV.
const opened = await page.evaluate(async () => {
  const ff = window.__fungiflush;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  if (typeof ff.openDeck !== 'function') return { error: 'openDeck no expuesto' };
  ff.openDeck();
  await wait(900);
  return {
    isDeck: Boolean(document.querySelector('.panel.is-deck')),
    carouselActive: ff.scene.carouselActive ?? null,
  };
});
console.log('Deck abierto:', JSON.stringify(opened));
await page.waitForTimeout(1400);
await page.screenshot({ path: join(shotsDir, 'mob-deck.png') });

// Medicion: que elementos del HUD de partida siguen visibles/se cuelan.
const measure = await page.evaluate(() => {
  const r = (sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const b = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return {
      sel,
      visible: cs.display !== 'none' && cs.visibility !== 'hidden' && Number(cs.opacity) > 0.05,
      top: Math.round(b.top),
      bottom: Math.round(b.bottom),
      left: Math.round(b.left),
      right: Math.round(b.right),
      w: Math.round(b.width),
      h: Math.round(b.height),
      pointerEvents: cs.pointerEvents,
    };
  };
  const sels = [
    '.hud-top', '.hud-ante', '.hud-score', '.hud-money', '.hud-jokers',
    '.hud-missions', '.hud-bottom', '.hud-counters', '.hud-actions',
    '.panel.is-deck', '.panel.is-deck .carousel-detail', '.deck-level', '.nivel-chip',
  ];
  const out = {};
  for (const s of sels) out[s] = r(s);
  // El chip de "Nivel 1" suelto arriba-izquierda: buscarlo por texto.
  const chips = [...document.querySelectorAll('#ui-root *')]
    .filter((el) => /^Nivel\s*\d+$/i.test((el.textContent ?? '').trim()) && el.children.length <= 2)
    .slice(0, 3)
    .map((el) => {
      const b = el.getBoundingClientRect();
      return { text: el.textContent.trim(), cls: el.className, top: Math.round(b.top), left: Math.round(b.left), w: Math.round(b.width), h: Math.round(b.height) };
    });
  return { out, nivelChips: chips, vh: window.innerHeight, vw: window.innerWidth };
});
console.log('\n=== MEDICION DECK MOVIL ===');
console.log(JSON.stringify(measure, null, 2));

await browser.close();
console.log('\nShot: tools/shots/mob-deck.png');
