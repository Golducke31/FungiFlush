/**
 * probe-lang-freeze.mjs — Reproduce el CONGELAMIENTO al cambiar de idioma.
 *
 * Mide el bloqueo del hilo principal (hueco mas grande entre frames) antes y
 * despues de tocar el boton de idioma, y registra si el panel de Ajustes
 * sobrevive o se cierra solo.
 *
 *   node tools/probe-lang-freeze.mjs            # menu -> Ajustes
 *   FF_FROM=ingame node tools/probe-lang-freeze.mjs   # en partida (barra superior)
 */
import { existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const URL_TO_TEST = process.env.FF_URL ?? 'http://127.0.0.1:1420/?daily=0';
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
const shotsDir = join(ROOT, 'tools', 'shots');
if (!existsSync(shotsDir)) mkdirSync(shotsDir, { recursive: true });

const browser = await chromium.launch({
  executablePath: exe, headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--disable-dev-shm-usage'],
});
const context = await browser.newContext({ viewport: { width: 915, height: 412 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const page = await context.newPage();
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

const click = (sel) => page.evaluate((s) => document.querySelector(s)?.click(), sel);
const has = (sel) => page.evaluate((s) => Boolean(document.querySelector(s)), sel);

await page.goto(URL_TO_TEST, { waitUntil: 'load', timeout: 45000 });
await page.waitForFunction(() => Boolean(window.__fungiflush?.engine?.run), { timeout: 30000 });
await page.waitForTimeout(1800);
await click('[data-act="tutorial-close"]');
await page.waitForTimeout(300);

/** Instala un medidor de frames: devuelve huecos entre frames (ms). */
const installMeter = () => page.evaluate(() => {
  window.__gaps = [];
  window.__meterOn = true;
  let last = performance.now();
  const tick = () => {
    const now = performance.now();
    if (window.__meterOn) window.__gaps.push(Math.round(now - last));
    last = now;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
});

const readMeter = (label) => page.evaluate((l) => {
  const g = window.__gaps ?? [];
  const max = g.length ? Math.max(...g) : 0;
  const avg = g.length ? Math.round(g.reduce((a, b) => a + b, 0) / g.length) : 0;
  const blocked = g.filter((x) => x > 250).length;
  window.__gaps = [];
  return { label: l, frames: g.length, maxGapMs: max, avgGapMs: avg, gapsOver250ms: blocked };
}, label);

const from = process.env.FF_FROM === 'ingame' ? 'ingame' : 'menu';

if (from === 'menu') {
  await click('.panel.is-menu [data-act="settings"]');
  await page.waitForTimeout(900);
} else {
  await click('.panel.is-menu [data-act="new"]');
  await page.waitForTimeout(700);
  if (await has('.panel.is-archetypes')) { await click('[data-act="archetypes-start"]'); await page.waitForTimeout(1200); }
  await click('[data-act="tutorial-close"]');
  await page.waitForTimeout(600);
}

const beforePanel = await page.evaluate(() => document.querySelector('#ui-root > .overlay.is-open > .panel')?.className ?? null);
console.log('panel antes del toggle:', beforePanel);

await installMeter();
await page.waitForTimeout(1200);
console.log('baseline:', JSON.stringify(await readMeter('baseline')));

// --- El toggle ---
const langBtnSel = from === 'menu' ? '.panel.is-settings [data-act="lang"]' : '.hud-top [data-act="lang"]';
const t0 = Date.now();
await click(langBtnSel);
const clickMs = Date.now() - t0;
await page.waitForTimeout(3000);
const after = await readMeter('post-toggle');
console.log('click round-trip ms:', clickMs);
console.log('post-toggle:', JSON.stringify(after));

const state = await page.evaluate(() => {
  const ff = window.__fungiflush;
  const overlays = [...document.querySelectorAll('.overlay')].map((o) => ({
    cls: o.className,
    connected: o.isConnected,
    parent: o.parentElement?.id ?? o.parentElement?.tagName ?? null,
    children: o.children.length,
  }));
  return {
    panel: document.querySelector('#ui-root > .overlay.is-open > .panel')?.className ?? null,
    lang: document.documentElement.lang,
    settingsOpen: Boolean(document.querySelector('.panel.is-settings')),
    overlayOpen: Boolean(document.querySelector('#ui-root > .overlay.is-open')),
    overlaysInDom: overlays,
    hudOverlayConnected: ff?.hud?.elOverlay ? ff.hud.elOverlay.isConnected : 'n/a',
    i18nListeners: ff?.bus?.listenerCount?.('i18n:changed') ?? 'n/a',
  };
});
console.log('estado despues:', JSON.stringify(state, null, 2));

// ¿Sigue respondiendo? Se pide un rAF y se mide.
const responsive = await page.evaluate(() => new Promise((resolve) => {
  const t = performance.now();
  requestAnimationFrame(() => resolve(Math.round(performance.now() - t)));
}));
console.log('respuesta del hilo principal (ms):', responsive);

await page.screenshot({ path: join(shotsDir, `lang-${from}.png`) });
console.log('errores de consola:', errors.length ? errors.slice(0, 5) : 'ninguno');
await browser.close();
