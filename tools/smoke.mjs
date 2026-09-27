/**
 * smoke.mjs — Prueba de humo del juego en un navegador real.
 *
 * Arranca Chromium (headless, con WebGL por SwiftShader), carga el juego,
 * juega unas cuantas acciones por codigo y reporta:
 *   - errores de consola y excepciones no capturadas
 *   - que la escena 3D haya creado cartas
 *   - que el estado del motor avance
 *   - una captura de pantalla
 *
 * Es la red de seguridad que el harness de consola NO puede dar: el motor
 * puede estar perfecto y el render explotar en el primer frame.
 *
 * Uso: node tools/smoke.mjs [url]
 */

import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const URL_TO_TEST = process.argv[2] ?? 'http://127.0.0.1:1420/';

/**
 * playwright-core vive en el workspace aislado de WorkBuddy, no en el
 * proyecto: no queremos una dependencia de 50 MB solo para el smoke test.
 * Por eso se resuelve por ruta absoluta.
 */
const PW_CANDIDATES = [
  'C:/Users/emanu/.workbuddy-ai/binaries/node/workspace/node_modules/playwright-core/index.js',
];

async function loadPlaywright() {
  try {
    return await import('playwright-core');
  } catch {
    for (const candidate of PW_CANDIDATES) {
      if (existsSync(candidate)) {
        return await import(pathToFileURL(candidate).href);
      }
    }
    throw new Error(
      'No se encontro playwright-core. Instalalo con:\n' +
        '  cd C:/Users/emanu/.workbuddy-ai/binaries/node/workspace && npm install playwright-core',
    );
  }
}

const pw = await loadPlaywright();
// Interop CJS/ESM: segun como se resuelva el paquete, `chromium` puede venir
// en el namespace o dentro de `default`.
const chromium = pw.chromium ?? pw.default?.chromium;
if (!chromium) {
  throw new Error('playwright-core no expone `chromium`.');
}

const CANDIDATES = [
  'C:/Users/emanu/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe',
  'C:/Users/emanu/AppData/Local/ms-playwright/chromium-1228/chrome-win64/chrome.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
];

const executablePath = CANDIDATES.find((p) => existsSync(p));
if (!executablePath) {
  console.error('No se encontro un Chromium ejecutable.');
  process.exit(1);
}

const shotsDir = join(ROOT, 'tools', 'shots');
if (!existsSync(shotsDir)) mkdirSync(shotsDir, { recursive: true });

const browser = await chromium.launch({
  executablePath,
  headless: true,
  args: [
    '--enable-unsafe-swiftshader',
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-webgl',
    '--ignore-gpu-blocklist',
    '--disable-dev-shm-usage',
  ],
});

// Viewport de celular en LANDSCAPE: es el objetivo real del juego.
const context = await browser.newContext({
  viewport: { width: 844, height: 390 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
  userAgent:
    'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Mobile Safari/537.36',
});

const page = await context.newPage();

const consoleErrors = [];
const consoleWarnings = [];
const pageErrors = [];

page.on('console', (msg) => {
  const type = msg.type();
  const text = msg.text();
  if (type === 'error') consoleErrors.push(text);
  else if (type === 'warning') consoleWarnings.push(text);
});
page.on('pageerror', (error) => pageErrors.push(error.message));
page.on('response', (response) => {
  if (response.status() >= 400) {
    consoleErrors.push(`HTTP ${response.status()} ${response.url()}`);
  }
});
page.on('requestfailed', (request) => {
  consoleErrors.push(`REQUEST FAILED ${request.url()} — ${request.failure()?.errorText ?? ''}`);
});

console.log(`Navegando a ${URL_TO_TEST} ...`);
await page.goto(URL_TO_TEST, { waitUntil: 'load', timeout: 45000 });

// Esperar a que el juego exponga su API de debug (solo en dev) o a que
// desaparezca el loader.
const ready = await page
  .waitForFunction(() => Boolean(window.__fungiflush?.engine?.run), { timeout: 30000 })
  .then(() => true)
  .catch(() => false);

console.log(`Juego inicializado: ${ready ? 'SI' : 'NO'}`);

// Dejar correr unos frames para que el render se estabilice.
await page.waitForTimeout(2500);

// --- Estado inicial: PANTALLA DE INICIO ---
const menuState = await page.evaluate(() => {
  const ff = window.__fungiflush;
  if (!ff) return null;
  const stats = ff.scene.stats();
  const canvas = document.getElementById('fungiflush-canvas');
  const gl = canvas?.getContext('webgl2') || canvas?.getContext('webgl');
  return {
    status: ff.engine.run.status,
    menuVisible: Boolean(document.querySelector('.panel.is-menu')),
    menuActions: [...document.querySelectorAll('.panel.is-menu [data-act]')].map((b) => b.dataset.act),
    hudHidden: document.getElementById('ui-root')?.classList.contains('in-menu') ?? false,
    continueEnabled: !document
      .querySelector('.panel.is-menu [data-act="continue"]')
      ?.classList.contains('is-disabled'),
    ante: ff.engine.run.ante,
    money: ff.engine.run.money,
    deckSize: ff.engine.run.deck.totalSize,
    jokers: ff.engine.run.jokers.length,
    stats,
    canvas: canvas ? `${canvas.width}x${canvas.height}` : 'sin canvas',
    webgl: gl ? 'contexto activo' : 'SIN CONTEXTO WEBGL',
    renderer: gl ? gl.getParameter(gl.VERSION) : '',
  };
});

console.log('\n--- Pantalla de inicio ---');
console.log(JSON.stringify(menuState, null, 2));

await page.screenshot({ path: join(shotsDir, '01-menu.png') });

// --- Ajustes: abrir, capturar y volver (ejercita el panel y el perfil) ---
const settingsOpened = await page.evaluate(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  document.querySelector('.panel.is-menu [data-act="settings"]')?.click();
  await wait(400);
  return {
    opened: Boolean(document.querySelector('.panel.is-settings')),
    fields: document.querySelectorAll('.panel.is-settings .settings-field').length,
  };
});
await page.screenshot({ path: join(shotsDir, '02-settings.png') });

const settingsRoundTrip = await page.evaluate(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  document.querySelector('.panel.is-settings [data-act="close"]')?.click();
  await wait(400);
  return { backToMenu: Boolean(document.querySelector('.panel.is-menu')) };
});
console.log('\n--- Ajustes (abrir / cerrar) ---');
console.log(JSON.stringify({ ...settingsOpened, ...settingsRoundTrip }, null, 2));

// --- Nueva partida desde el MENU (camino real del jugador) ---
await page.evaluate(() => {
  document.querySelector('.panel.is-menu [data-act="new"]')?.click();
});
await page.waitForTimeout(1600);

const afterStart = await page.evaluate(() => {
  const ff = window.__fungiflush;
  return {
    status: ff.engine.run.status,
    blindSelectVisible: Boolean(document.querySelector('.blind-grid')),
    hudHidden: document.getElementById('ui-root')?.classList.contains('in-menu') ?? false,
    deckSize: ff.engine.run.deck.totalSize,
  };
});
console.log('\n--- Tras "Nueva partida" ---');
console.log(JSON.stringify(afterStart, null, 2));
await page.screenshot({ path: join(shotsDir, '03-blind-select.png') });

// --- Elegir ciego ---
await page.evaluate(() => {
  const ff = window.__fungiflush;
  const blinds = ff.engine.availableBlinds();
  ff.engine.chooseBlind(blinds[1]?.id);
});
await page.waitForTimeout(1400);
await page.screenshot({ path: join(shotsDir, '04-playing.png') });

const afterBlind = await page.evaluate(() => {
  const ff = window.__fungiflush;
  return {
    status: ff.engine.run.status,
    blind: ff.engine.round?.blind.id,
    target: ff.engine.round?.target,
    hand: ff.engine.round?.hand.length ?? 0,
    sceneHand: ff.scene.stats().hand,
  };
});
console.log('\n--- Tras elegir ciego ---');
console.log(JSON.stringify(afterBlind, null, 2));

// --- Jugar una mano: elegir 3 cartas y jugar ---
await page.evaluate(() => {
  const ff = window.__fungiflush;
  const hand = ff.engine.round?.hand ?? [];
  // Selecciona las 3 primeras.
  for (const card of hand.slice(0, 3)) ff.engine.toggleSelect(card.uid);
});
await page.waitForTimeout(700);
await page.screenshot({ path: join(shotsDir, '05-selection.png') });

const preview = await page.evaluate(() => {
  const ff = window.__fungiflush;
  const p = ff.engine.previewSelection();
  return p ? { substrate: p.baseSubstrate + p.addedSubstrate, mult: p.multipliedSpores, total: p.total } : null;
});
console.log('\n--- Previsualizacion ---');
console.log(JSON.stringify(preview, null, 2));

await page.evaluate(() => window.__fungiflush.engine.playHand());
// La secuencia de puntuacion anima ~2 s; esperamos a que termine.
await page.waitForTimeout(3200);
await page.screenshot({ path: join(shotsDir, '06-after-play.png') });

const afterPlay = await page.evaluate(() => {
  const ff = window.__fungiflush;
  return {
    status: ff.engine.run.status,
    score: ff.engine.round?.score ?? null,
    target: ff.engine.round?.target ?? null,
    handsLeft: ff.engine.round?.handsLeft ?? null,
    hand: ff.engine.round?.hand.length ?? 0,
    stats: ff.scene.stats(),
  };
});
console.log('\n--- Tras jugar una mano ---');
console.log(JSON.stringify(afterPlay, null, 2));

// --- Forzar la victoria del blind: ahora el flujo es reward -> shop ---
await page.evaluate(() => {
  const ff = window.__fungiflush;
  const round = ff.engine.round;
  if (!round) return;
  // Truco de prueba: subir el score y jugar la ultima mano.
  round.score = round.target - 1;
  round.handsLeft = 1;
  const hand = round.hand;
  for (const card of hand.slice(0, 5)) ff.engine.toggleSelect(card.uid);
  ff.engine.playHand();
});
await page.waitForTimeout(3000);

// OJO: el estado se lee ANTES de clickear. `chooseReward` resuelve el draft y
// entra a la tienda en el mismo tick, asi que leer despues devolveria "shop".
const reward = await page.evaluate(() => {
  const ff = window.__fungiflush;
  return {
    status: ff.engine.run.status,
    panel: Boolean(document.querySelector('.panel.is-reward')),
    offers: ff.engine.rewardOffers().map((o) => `${o.kind}:${o.refId}`),
    deckBefore: ff.engine.run.deck.totalSize,
  };
});
console.log('\n--- Recompensa (draft) ---');
console.log(JSON.stringify(reward, null, 2));
await page.screenshot({ path: join(shotsDir, '07-reward.png') });

// Se toma la primera carta desde la UI, no desde el motor: es el camino real.
await page.evaluate(() => document.querySelector('.panel.is-reward [data-act="pick"]')?.click());
await page.waitForTimeout(1200);

const afterWin = await page.evaluate(() => {
  const ff = window.__fungiflush;
  return {
    status: ff.engine.run.status,
    money: ff.engine.run.money,
    deckAfter: ff.engine.run.deck.totalSize,
    offers: ff.engine.run.shop?.offers.map((o) => `${o.kind}:${o.refId}@${o.cost}`) ?? [],
  };
});
console.log('\n--- Tras tomar la recompensa (tienda) ---');
console.log(JSON.stringify(afterWin, null, 2));
await page.screenshot({ path: join(shotsDir, '08-shop.png') });

// --- Constructor de mazo: abrir, purgar y cerrar ---
const deckBuilder = await page.evaluate(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  document.querySelector('.panel.is-shop [data-act="deck"]')?.click();
  await wait(500);
  const opened = Boolean(document.querySelector('.panel.is-deck'));
  const cards = document.querySelectorAll('.panel.is-deck .deck-card').length;
  const before = window.__fungiflush.engine.run.deck.totalSize;
  document.querySelector('.panel.is-deck [data-act="purge"]')?.click();
  await wait(500);
  const after = window.__fungiflush.engine.run.deck.totalSize;
  return { opened, cards, before, after, purged: before - after };
});
console.log('\n--- Constructor de mazo (purgar) ---');
console.log(JSON.stringify(deckBuilder, null, 2));
await page.screenshot({ path: join(shotsDir, '09-deck.png') });

await page.evaluate(() => document.querySelector('.panel.is-deck [data-act="close"]')?.click());
await page.waitForTimeout(500);

// --- Coleccion: abrir (desde una run en curso), capturar y volver ---
const collectionOpened = await page.evaluate(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  window.__fungiflush.hud.showCollection();
  await wait(600);
  return {
    panel: Boolean(document.querySelector('.panel.is-collection')),
    entries: document.querySelectorAll('.panel.is-collection .collection-card').length,
    locked: document.querySelectorAll('.panel.is-collection .collection-card.is-locked').length,
    undiscovered: document.querySelectorAll('.panel.is-collection .collection-card.is-unknown').length,
  };
});
console.log('\n--- Coleccion ---');
console.log(JSON.stringify(collectionOpened, null, 2));
await page.screenshot({ path: join(shotsDir, '10-collection.png') });

const collectionClosed = await page.evaluate(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  document.querySelector('.panel.is-collection [data-act="close"]')?.click();
  await wait(500);
  // Cerrar la coleccion debe devolver al overlay del estado actual (tienda),
  // no al menu.
  return {
    backToShop: Boolean(document.querySelector('.panel.is-shop')),
    status: window.__fungiflush.engine.run.status,
  };
});
console.log('\n--- Coleccion (cerrar) ---');
console.log(JSON.stringify(collectionClosed, null, 2));

// --- Cambio de idioma en caliente ---
const langResult = await page.evaluate(async () => {
  const ff = window.__fungiflush;
  const before = document.documentElement.lang;
  const button = [...document.querySelectorAll('button')].find(
    (b) => b.textContent === 'Idioma' || b.textContent === 'Language',
  );
  button?.click();
  await new Promise((r) => setTimeout(r, 900));
  return { before, after: document.documentElement.lang, textures: ff.scene.stats().textures };
});
console.log('\n--- Cambio de idioma ---');
console.log(JSON.stringify(langResult, null, 2));
await page.screenshot({ path: join(shotsDir, '11-language.png') });

// --- Medir FPS durante 3 segundos ---
const fps = await page.evaluate(
  () =>
    new Promise((resolve) => {
      let frames = 0;
      const start = performance.now();
      const tick = () => {
        frames += 1;
        if (performance.now() - start < 3000) requestAnimationFrame(tick);
        else resolve(Math.round((frames / (performance.now() - start)) * 1000));
      };
      requestAnimationFrame(tick);
    }),
);
console.log(`\nFPS medidos (SwiftShader, sin GPU real): ${fps}`);

// --- Reporte ---
console.log('\n================ REPORTE ================');
const realErrors = consoleErrors.filter((e) => !e.includes('favicon'));
console.log(`Errores de consola : ${realErrors.length}`);
for (const error of realErrors.slice(0, 10)) console.log(`  ✗ ${error}`);
console.log(`Excepciones        : ${pageErrors.length}`);
for (const error of pageErrors.slice(0, 10)) console.log(`  ✗ ${error}`);
console.log(`Avisos             : ${consoleWarnings.length}`);
for (const warning of consoleWarnings.slice(0, 5)) console.log(`  ! ${warning}`);

const ok =
  ready &&
  reward?.status === 'reward' &&
  reward?.panel === true &&
  reward?.offers.length === 3 &&
  afterWin?.status === 'shop' &&
  (afterWin?.deckAfter ?? 0) === (reward?.deckBefore ?? 0) + 1 &&
  deckBuilder?.opened === true &&
  (deckBuilder?.cards ?? 0) > 0 &&
  deckBuilder?.purged === 1 &&
  collectionOpened?.panel === true &&
  (collectionOpened?.entries ?? 0) > 0 &&
  collectionOpened?.undiscovered > 0 &&
  collectionClosed?.backToShop === true &&
  menuState?.status === 'menu' &&
  menuState?.menuVisible === true &&
  menuState?.hudHidden === true &&
  menuState?.continueEnabled === false &&
  settingsOpened?.opened === true &&
  settingsOpened?.fields === 5 &&
  settingsRoundTrip?.backToMenu === true &&
  afterStart?.status === 'blind_select' &&
  afterStart?.blindSelectVisible === true &&
  afterStart?.hudHidden === false &&
  menuState?.webgl === 'contexto activo' &&
  (afterBlind?.sceneHand ?? 0) > 0 &&
  (afterBlind?.hand ?? 0) > 0 &&
  afterPlay?.score > 0 &&
  afterWin?.status === 'shop' &&
  realErrors.length === 0 &&
  pageErrors.length === 0;

console.log(ok ? '\n✓ SMOKE TEST OK' : '\n✗ SMOKE TEST FALLO');

await browser.close();
process.exit(ok ? 0 : 1);
