/**
 * probe-ui-overlap.mjs — Reproduce y MIDE dos pantallas concretas en movil:
 *   1) El MAZO real (carrusel 3D, `[data-act="deck"]`), donde los HUDs/cajas
 *      pueden pisar las cartas del anillo.
 *   2) El aviso de CIEGO SUPERADO, donde el pie (Continuar) puede quedar tapado
 *      por los banners de logro o recortado por el panel.
 *
 *   node tools/probe-ui-overlap.mjs
 *
 * Salida: tools/shots/ui-deck-carousel.png, ui-cleared.png + un dump de rects.
 */
import { existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const URL_TO_TEST = process.env.FF_URL ?? 'http://127.0.0.1:1420/?daily=0';

const PW_CANDIDATES = [
  'C:/Users/emanu/.workbuddy-ai/binaries/node/workspace/node_modules/playwright-core/index.js',
];
async function loadPlaywright() {
  try { return await import('playwright-core'); }
  catch {
    for (const c of PW_CANDIDATES) if (existsSync(c)) return await import(pathToFileURL(c).href);
    throw new Error('No se encontro playwright-core.');
  }
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
  executablePath: exe,
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--disable-dev-shm-usage'],
});
const VIEWPORT =
  process.env.FF_VIEWPORT === 'smoke' ? { width: 844, height: 390 }
  : process.env.FF_VIEWPORT === 'tablet' ? { width: 1180, height: 820 }
  : { width: 915, height: 412 };
const context = await browser.newContext({
  viewport: VIEWPORT,
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
});
const page = await context.newPage();
page.on('console', (m) => { if (m.type() === 'error') console.error('[console]', m.text()); });
page.on('pageerror', (e) => console.error('[pageerror]', e.message));

const click = (sel) => page.evaluate((s) => document.querySelector(s)?.click(), sel);
const has = (sel) => page.evaluate((s) => Boolean(document.querySelector(s)), sel);
const waitPanel = (sel, timeout = 12000) =>
  page.waitForFunction((s) => Boolean(document.querySelector(s)), sel, { timeout }).catch(() => {});

await page.goto(URL_TO_TEST, { waitUntil: 'load', timeout: 45000 });
await page.waitForFunction(() => Boolean(window.__fungiflush?.engine?.run), { timeout: 30000 });
await page.waitForTimeout(1800);

// --- Menu -> COLECCION (carrusel 3D real) ---
await click('[data-act="tutorial-close"]');
await page.waitForTimeout(300);
await click('.panel.is-menu [data-act="collection"]');
await page.waitForTimeout(2600);
await page.screenshot({ path: join(shotsDir, 'ui-collection-carousel.png') });
const collectionBands = await page.evaluate(() => {
  const rect = (el) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { top: Math.round(r.top), bottom: Math.round(r.bottom), h: Math.round(r.height) };
  };
  return {
    vh: window.innerHeight,
    top: rect(document.querySelector('.carousel-top')),
    bottom: rect(document.querySelector('.carousel-bottom')),
    detail: rect(document.querySelector('.carousel-detail')),
    toolbar: rect(document.querySelector('.deck-toolbar')),
  };
});
console.log('\n[COLECCION carrusel]', JSON.stringify(collectionBands, null, 2));
await click('.panel.is-collection [data-act="close"]');
await page.waitForTimeout(1200);

// --- Menu -> run -> ciego ---
if (!(await has('.panel.is-menu'))) { await page.evaluate(() => window.__fungiflush.hud.showMenu?.()); await page.waitForTimeout(600); }
await click('[data-act="tutorial-close"]');
await click('.panel.is-menu [data-act="new"]');
await page.waitForTimeout(700);
if (await has('.panel.is-archetypes')) { await click('[data-act="archetypes-start"]'); await page.waitForTimeout(1200); }
await click('[data-act="tutorial-close"]');
await waitPanel('.panel.is-blind-select');
await page.waitForTimeout(500);

// --- 1) MAZO real (carrusel 3D) ---
await click('.panel.is-blind-select [data-act="deck"]');
await page.waitForTimeout(2500);
await page.screenshot({ path: join(shotsDir, 'ui-deck-carousel.png') });

const deck = await page.evaluate(() => {
  const rect = (el) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { top: Math.round(r.top), bottom: Math.round(r.bottom), left: Math.round(r.left), right: Math.round(r.right), w: Math.round(r.width), h: Math.round(r.height) };
  };
  const panel = document.querySelector('#ui-root > .overlay.is-open > .panel');
  const top = document.querySelector('.carousel-top');
  const bottom = document.querySelector('.carousel-bottom');
  const detail = document.querySelector('.carousel-detail');
  const toolbar = document.querySelector('.deck-toolbar');
  const hud = ['.hud-top', '.hud-bottom', '.hud-missions-toggle', '.pile-label']
    .map((s) => ({ sel: s, rect: rect(document.querySelector(s)), display: document.querySelector(s) ? getComputedStyle(document.querySelector(s)).display : null }));
  const cards = window.__fungiflush?.scene?.carouselState?.() ?? null;
  return { vh: window.innerHeight, vw: window.innerWidth, panel: rect(panel), top: rect(top), bottom: rect(bottom), detail: rect(detail), toolbar: rect(toolbar), hud, cards };
});
console.log('\n[MAZO carrusel]', JSON.stringify(deck, null, 2));

// Cerrar el mazo
await page.evaluate(() => {
  const close = document.querySelector('.panel.is-deck [data-act="close"]');
  if (close) close.click();
});
await page.waitForTimeout(1200);
if (await has('.panel.is-blind-select')) {
  await page.evaluate(() => window.__fungiflush.engine.chooseBlind());
  await page.waitForFunction(() => (window.__fungiflush?.engine?.round?.hand?.length ?? 0) > 0, { timeout: 15000 });
  await page.waitForTimeout(700);
}

// --- 2) CIEGO SUPERADO ---
await page.evaluate(() => {
  const ff = window.__fungiflush;
  const r = ff.engine.round;
  if (r) r.target = 1;
  const uid = r?.hand?.[0]?.uid;
  if (uid) { ff.engine.toggleSelect(uid); ff.engine.playHand(); }
});
await waitPanel('.panel.is-cleared, .panel.is-reward', 12000);
await page.waitForTimeout(900);
await page.screenshot({ path: join(shotsDir, 'ui-cleared.png') });

const cleared = await page.evaluate(() => {
  const rect = (el) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { top: Math.round(r.top), bottom: Math.round(r.bottom), left: Math.round(r.left), right: Math.round(r.right), w: Math.round(r.width), h: Math.round(r.height) };
  };
  const panel = document.querySelector('.panel.is-cleared');
  const actions = panel?.querySelector('.panel-actions');
  const cont = panel?.querySelector('[data-act="cleared-continue"]');
  const breakdown = panel?.querySelector('.score-breakdown');
  const banner = document.querySelector('.banner-stack');
  const cr = cont?.getBoundingClientRect();
  // Quien esta REALMENTE en el centro del boton Continuar.
  const hit = cr
    ? (() => {
        const el = document.elementFromPoint(cr.left + cr.width / 2, cr.top + cr.height / 2);
        return el ? { tag: el.tagName, cls: String(el.className).slice(0, 60), act: el.getAttribute?.('data-act') ?? null } : null;
      })()
    : null;
  return {
    vh: window.innerHeight,
    panel: rect(panel),
    actions: rect(actions),
    continueBtn: rect(cont),
    breakdown: rect(breakdown),
    bannerStack: rect(banner),
    banners: [...document.querySelectorAll('.banner')].map((b) => rect(b)),
    hitTestAtContinueCenter: hit,
    panelScroll: panel ? Math.round(panel.scrollHeight - panel.clientHeight) : null,
    breakdownRows: [...(panel?.querySelectorAll('.score-breakdown-row') ?? [])].map((r) => r.textContent),
  };
});
console.log('\n[CIEGO SUPERADO]', JSON.stringify(cleared, null, 2));

// --- 3) COLECCION: contar simbiontes comprados ---
await page.evaluate(() => document.querySelector('.panel.is-cleared [data-act="cleared-continue"]')?.click());
await page.waitForTimeout(1500);
await page.evaluate(() => document.querySelector('.panel.is-reward [data-act="skip"]')?.click());
await page.waitForTimeout(1800);

const joker = await page.evaluate(async () => {
  const ff = window.__fungiflush;
  const before = [...ff.profileStore.current.collection.seenCardIds];
  // Plata de sobra. Si la tienda no trae un simbionte, se renueva hasta que
  // aparezca (el sorteo es aleatorio y el test no puede depender de la suerte).
  ff.engine.run.money = 99999;
  let jokerOffer = null;
  for (let i = 0; i < 12 && !jokerOffer; i++) {
    jokerOffer = (ff.engine.run.shop?.offers ?? []).find((o) => o.kind === 'joker' && !o.sold) ?? null;
    if (!jokerOffer) { ff.engine.rerollShop?.(); await new Promise((r) => setTimeout(r, 120)); }
  }
  const bought = jokerOffer ? ff.engine.buyOffer(jokerOffer.id) : false;
  await new Promise((r) => setTimeout(r, 500));
  const after = [...ff.profileStore.current.collection.seenCardIds];
  const added = after.filter((id) => !before.includes(id));
  return {
    jokerRefId: jokerOffer?.refId ?? null,
    bought,
    seenAdded: added,
    jokerNowInSeen: jokerOffer ? after.includes(jokerOffer.refId) : null,
  };
});
console.log('\n[SIMBIONTES / COLECCION]', JSON.stringify(joker, null, 2));

// Abrir la coleccion y leer el contador de la pestaña Simbiontes.
await page.evaluate(() => window.__fungiflush.hud.showCollection());
await page.waitForTimeout(1200);
await page.evaluate(() => document.querySelector('.panel.is-collection [data-act="filter-jokers"]')?.click());
await page.waitForTimeout(900);
const collection = await page.evaluate(() => {
  const panel = document.querySelector('.panel.is-collection');
  const sub = panel?.querySelector('.panel-subtitle')?.textContent ?? null;
  const cards = [...(panel?.querySelectorAll('.collection-card') ?? [])];
  const known = cards.filter((c) => !c.classList.contains('is-unknown')).length;
  return { subtitle: sub, totalCards: cards.length, knownCards: known };
});
console.log('\n[COLECCION · Simbiontes]', JSON.stringify(collection, null, 2));
await page.screenshot({ path: join(shotsDir, 'ui-collection-jokers.png') });

await browser.close();
console.log('\nShots: tools/shots/ui-*.png');
