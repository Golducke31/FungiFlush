/**
 * probe-panel-overflow.mjs — Recorre TODAS las pantallas de panel en CELULAR
 * TACTIL (pointer: coarse) y detecta las que obligan a scrollear para llegar a
 * los botones.
 *
 * El bug que motiva esto: el overlay scrollea (overflow-y:auto) y el panel
 * crece empujando los botones (.panel-actions) por debajo del pliegue. Este
 * prober mide, por pantalla:
 *   - si el overlay tiene scroll vertical (overlayScroll > 0),
 *   - si las acciones caen fuera del viewport (actions.overflowBottom > 0),
 *   - si el panel es mas alto que la pantalla (panelOverflow > 0).
 *
 *   node tools/probe-panel-overflow.mjs
 *   FF_VIEWPORT=tablet node tools/probe-panel-overflow.mjs   # 1180x820
 *
 * Requiere el dev server en http://127.0.0.1:1420 (FF_URL lo cambia).
 * Salida: tabla resumen + tools/shots/probe-<pantalla>.png
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
  try {
    return await import('playwright-core');
  } catch {
    for (const c of PW_CANDIDATES) {
      if (existsSync(c)) return await import(pathToFileURL(c).href);
    }
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

const VIEWPORT =
  process.env.FF_VIEWPORT === 'tablet' ? { width: 1180, height: 820 }
  : process.env.FF_VIEWPORT === 'smoke' ? { width: 844, height: 390 }
  : { width: 915, height: 412 };

const browser = await chromium.launch({
  executablePath: exe,
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--disable-dev-shm-usage'],
});
const context = await browser.newContext({
  viewport: VIEWPORT,
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
});
const page = await context.newPage();
page.on('console', (m) => { if (m.type() === 'error') console.error('[console]', m.text()); });
page.on('pageerror', (e) => console.error('[pageerror]', e.message));

await page.goto(URL_TO_TEST, { waitUntil: 'load', timeout: 45000 });
await page.waitForFunction(() => Boolean(window.__fungiflush?.engine?.run), { timeout: 30000 });
await page.waitForTimeout(1800);

const click = (sel) => page.evaluate((s) => document.querySelector(s)?.click(), sel);
const has = (sel) => page.evaluate((s) => Boolean(document.querySelector(s)), sel);
const waitPanel = (sel, timeout = 12000) =>
  page.waitForFunction((s) => Boolean(document.querySelector(s)), sel, { timeout }).catch(() => {});

async function measure() {
  return page.evaluate(() => {
    const overlay = document.querySelector('#ui-root > .overlay.is-open');
    const panel = overlay?.querySelector(':scope > .panel') ?? null;
    if (!overlay || !panel) return { none: true };
    const pr = panel.getBoundingClientRect();
    const actions = panel.querySelector('.panel-actions');
    const ar = actions?.getBoundingClientRect() ?? null;
    // Busca el primer descendiente que scrollee por dentro (contenido real).
    let scroller = null;
    for (const el of panel.querySelectorAll('*')) {
      if (el.scrollHeight > el.clientHeight + 2 && el.clientHeight > 0) {
        const r = el.getBoundingClientRect();
        scroller = { cls: el.className || el.tagName, h: Math.round(r.height), scroll: Math.round(el.scrollHeight - el.clientHeight) };
        break;
      }
    }
    return {
      panelClass: panel.className,
      vh: window.innerHeight,
      vw: window.innerWidth,
      overlayScroll: Math.round(overlay.scrollHeight - overlay.clientHeight),
      panelH: Math.round(pr.height),
      panelOverflow: Math.round(pr.bottom - window.innerHeight),
      actionsBottom: ar ? Math.round(ar.bottom) : null,
      actionsOverflow: ar ? Math.round(ar.bottom - window.innerHeight) : null,
      innerScroller: scroller,
    };
  });
}

const results = [];
let f11Fail = false; // F1.1 — desglose de Fungis cortado en "Ciego superado"
async function visit(label, name) {
  await page.waitForTimeout(350);
  const m = await measure();
  results.push({ label, ...m });
  if (!m.none) await page.screenshot({ path: join(shotsDir, `probe-${name}.png`) });
  const bad = !m.none && (m.overlayScroll > 2 || (m.actionsOverflow ?? 0) > 2);
  const sc = m.innerScroller ? ` innerScroll=${m.innerScroller.scroll}(${String(m.innerScroller.cls).slice(0, 24)})` : '';
  console.log(
    `${m.none ? '--' : bad ? 'XX' : 'OK'} ${label.padEnd(16)} ${m.none ? '(sin panel)' : `panelH=${String(m.panelH).padStart(4)}/${m.vh} overlayScroll=${String(m.overlayScroll).padStart(4)} actionsBottom=${String(m.actionsBottom).padStart(4)}${sc}`}`,
  );
}

// --- Menu ---
await click('[data-act="tutorial-close"]');
await visit('menu', 'menu');

// --- Paneles de menu (chips) ---
const menuPanels = [
  ['settings', 'settings', '[data-act="close"]'],
  ['collection', 'collection', '[data-act="close"]'],
  ['about', 'about', '[data-act="close"]'],
  ['history', 'history', '[data-act="history-close"]'],
  ['guide', 'guide', '[data-act="tutorial-close"]'],
  ['achievements', 'achievements', '[data-act="achievements-close"]'],
  ['cosmetics', 'cosmetics', '[data-act="cosmetics-close"]'],
  ['daily', 'daily', '[data-act="daily-close"]'],
  ['archetype', 'archetypes', '[data-act="archetypes-close"]'],
  ['ascension', 'ascension', '[data-act="ascension-close"]'],
  ['board', 'board', '[data-act="close"]'],
];
for (const [act, name, close] of menuPanels) {
  if (!(await has(`.panel.is-menu [data-act="${act}"]`))) continue;
  await click(`.panel.is-menu [data-act="${act}"]`);
  await visit(name, name);
  if (await has(close)) await click(close);
  else await click('[data-act="close"]');
  await page.waitForTimeout(300);
}

// --- Run: arquetipos -> ciego -> partida ---
await click('.panel.is-menu [data-act="new"]');
await page.waitForTimeout(500);
if (await has('.panel.is-archetypes')) {
  await visit('archetypes', 'archetypes');
  await click('[data-act="archetypes-start"]');
  await page.waitForTimeout(1200);
}
await click('[data-act="tutorial-close"]');
await visit('blind-select', 'blind');

// --- Detalle de la run (desde el panel de ciego) ---
if (await has('.panel.is-blind-select [data-act="blind-details"]')) {
  await click('.panel.is-blind-select [data-act="blind-details"]');
  await visit('blind-details', 'blind-details');
  await click('[data-act="close"]');
  await page.waitForTimeout(400);
}

await page.evaluate(() => {
  const ff = window.__fungiflush;
  ff.engine.chooseBlind(ff.engine.availableBlinds()[0]?.id);
});
await page.waitForFunction(() => (window.__fungiflush?.engine?.round?.hand?.length ?? 0) > 0, { timeout: 15000 });
await page.waitForTimeout(600);
await visit('playing', 'playing');

// --- Ciego superado (interstitial) ---
await page.evaluate(() => {
  const ff = window.__fungiflush;
  const r = ff.engine.round;
  if (r) r.target = 1;
  const uid = r?.hand?.[0]?.uid;
  if (uid) { ff.engine.toggleSelect(uid); ff.engine.playHand(); }
});
await waitPanel('.panel.is-cleared, .panel.is-reward', 12000);
await page.waitForTimeout(400);
if (await has('.panel.is-cleared')) {
  await visit('cleared', 'cleared');

  // --- F1.1: el desglose de FUNGIS no debe quedar cortado ---
  // Se lleva el cuerpo al fondo y se mide la ULTIMA fila del bloque de Fungis
  // y el pie. Si el cuerpo scrollea (`overflow-y: auto`) y despues de scrollear
  // la ultima fila entra, el desglose es alcanzable; si no, sigue recortado.
  const fungiFit = await page.evaluate(() => {
    const panel = document.querySelector('.panel.is-cleared');
    if (!panel) return { none: true };
    const body = panel.querySelector('.cleared-body');
    const fungi = panel.querySelector('.score-breakdown.is-fungi');
    const actions = panel.querySelector('.panel-actions');
    if (body) body.scrollTop = body.scrollHeight;
    const lr = fungi?.lastElementChild?.getBoundingClientRect() ?? null;
    const ar = actions?.getBoundingClientRect() ?? null;
    const vh = window.innerHeight;
    return {
      none: false,
      vh,
      fungiRows: fungi ? fungi.querySelectorAll('.score-breakdown-row').length : 0,
      lastRowBottom: lr ? Math.round(lr.bottom) : null,
      lastRowVisible: lr ? lr.bottom <= vh + 1 && lr.top >= -1 : null,
      actionsBottom: ar ? Math.round(ar.bottom) : null,
      actionsVisible: ar ? ar.bottom <= vh + 1 : null,
      bodyScroll: body ? Math.round(body.scrollHeight - body.clientHeight) : null,
      bodyOverflowY: body ? getComputedStyle(body).overflowY : null,
    };
  });
  if (fungiFit.none) {
    console.log('  XX [F1.1] no se encontro el panel .is-cleared');
    f11Fail = true;
  } else {
    const ok =
      fungiFit.actionsVisible === true &&
      fungiFit.lastRowVisible === true &&
      fungiFit.bodyOverflowY === 'auto';
    if (!ok) f11Fail = true;
    console.log(
      `  ${ok ? 'OK' : 'XX'} [F1.1] desglose Fungis: filas=${fungiFit.fungiRows} ` +
        `ultimaFilaBottom=${fungiFit.lastRowBottom}/${fungiFit.vh} visible=${fungiFit.lastRowVisible} | ` +
        `pieBottom=${fungiFit.actionsBottom} visible=${fungiFit.actionsVisible} | ` +
        `bodyScroll=${fungiFit.bodyScroll} overflowY=${fungiFit.bodyOverflowY}`,
    );
  }

  await click('.panel.is-cleared [data-act="cleared-continue"]');
  await waitPanel('.panel.is-reward', 8000);
  await page.waitForTimeout(400);
}

// --- Recompensa (draft) ---
if (await has('.panel.is-reward')) await visit('reward', 'reward');

// --- Tienda ---
if (await has('.panel.is-reward [data-act="skip"]')) {
  await click('.panel.is-reward [data-act="skip"]');
  await waitPanel('.panel.is-shop', 8000);
  await page.waitForTimeout(400);
}
if (await has('.panel.is-shop')) await visit('shop', 'shop');

// --- Mazo (desde la tienda o desde el HUD) ---
await page.evaluate(() => window.__fungiflush.hud.showDeckBuilder?.());
await waitPanel('.panel.is-deck', 8000);
await page.waitForTimeout(400);
if (await has('.panel.is-deck')) {
  await visit('deck', 'deck');
  await click('[data-act="close"]');
  await page.waitForTimeout(400);
}

// --- Game over: volver a jugar, objetivo imposible y quemar todas las manos ---
await page.evaluate(() => {
  const ff = window.__fungiflush;
  // Salir de la tienda para volver a la seleccion de ciego.
  if (ff.engine.run.status === 'shop') ff.engine.leaveShop();
});
await page.waitForTimeout(900);
// Avanzar por interludios / seleccion de ciego hasta estar JUGANDO.
let sawInterlude = false;
for (let i = 0; i < 8; i++) {
  const status = await page.evaluate(() => window.__fungiflush.engine.run.status);
  if (status === 'playing') break;
  if (status === 'blind_select') {
    await page.evaluate(() => window.__fungiflush.engine.chooseBlind());
  } else if (await has('.panel.is-interlude')) {
    if (!sawInterlude) { await visit('interlude', 'interlude'); sawInterlude = true; }
    await click('.panel.is-interlude [data-act="interlude-choice"]');
  }
  await page.waitForTimeout(900);
}
await page.waitForFunction(() => window.__fungiflush?.engine?.run?.status === 'playing', { timeout: 10000 }).catch(() => {});
await page.waitForTimeout(600);
await page.evaluate(() => {
  const ff = window.__fungiflush;
  const r = ff.engine.round;
  if (!r) return;
  r.target = 999999999;
  for (let i = 0; i < 10 && ff.engine.run.status === 'playing'; i++) {
    const hand = ff.engine.round?.hand ?? [];
    ff.engine.clearSelection();
    for (const c of hand.slice(0, 5)) ff.engine.toggleSelect(c.uid);
    if ((ff.engine.round?.selected?.length ?? 0) === 0) break;
    ff.engine.playHand();
  }
});
console.log('  [gameover] status tras quemar manos:', await page.evaluate(() => window.__fungiflush.engine.run.status));
await waitPanel('.panel.is-gameover', 15000);
await page.waitForTimeout(500);
if (await has('.panel.is-gameover')) await visit('gameover', 'gameover');
else console.log('  [gameover] NO aparecio; panel actual:', await page.evaluate(() => document.querySelector('#ui-root > .overlay.is-open > .panel')?.className ?? null));

await browser.close();

console.log('\n=== RESUMEN (XX = hay que scrollear para llegar a los botones) ===');
let badCount = 0;
for (const r of results) {
  if (r.none) { console.log(`  --  ${r.label.padEnd(16)} (sin panel)`); continue; }
  const bad = r.overlayScroll > 2 || (r.actionsOverflow ?? 0) > 2;
  if (bad) badCount++;
  console.log(
    `  ${bad ? 'XX' : 'OK'}  ${r.label.padEnd(16)} ${r.panelClass.slice(0, 30).padEnd(30)}` +
    ` panelH=${String(r.panelH).padStart(4)}/${r.vh} overlayScroll=${String(r.overlayScroll).padStart(4)}` +
    ` actionsOverflow=${r.actionsOverflow ?? '-'}`,
  );
}
console.log(`\n${badCount} pantalla(s) con scroll vertical. Shots: tools/shots/probe-*.png`);
if (f11Fail) {
  console.log('F1.1 FALLO: el desglose de Fungis ("Ciego superado") sigue cortado.');
  process.exitCode = 1;
} else {
  console.log('F1.1 OK: el desglose de Fungis entra (o scrollea) sin recortarse.');
}
