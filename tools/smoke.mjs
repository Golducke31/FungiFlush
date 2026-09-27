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
// CLICK REAL, no `element.click()`: el arreglo de `pointer-events` de la Fase
// 4 dependia de que la capa de UI recibiera los toques de verdad, y un click
// por JS lo habria dado por bueno sin probar nada.
const newButton = await page.locator('.panel.is-menu [data-act="new"]').boundingBox();
if (newButton) {
  await page.mouse.click(newButton.x + newButton.width / 2, newButton.y + newButton.height / 2);
} else {
  await page.evaluate(() => document.querySelector('.panel.is-menu [data-act="new"]')?.click());
}
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

// ===========================================================================
// Fase 4 — FLIP + ARRASTRE con gestos de puntero REALES
// ===========================================================================
// Nada de `engine.toggleSelect()` aca: lo que hay que probar es que el TAP siga
// seleccionando y que el ARRASTRE resuelva zonas. Se apunta a las coordenadas
// que reporta la escena, no a numeros a ojo.

await page.evaluate(() => window.__fungiflush.engine.clearSelection());
await page.waitForTimeout(300);

const handBefore = await page.evaluate(() => window.__fungiflush.scene.handState());
console.log('\n--- Fase 4: mano en pantalla ---');
console.log(
  JSON.stringify(
    handBefore.map((c) => ({ uid: c.uid, sx: c.screenX, sy: c.screenY, back: c.hasBack })),
  ),
);

// --- Tap: debe seguir seleccionando ---
const tapCard = handBefore[1];
await page.mouse.move(tapCard.screenX, tapCard.screenY);
await page.mouse.down();
await page.mouse.up();
await page.waitForTimeout(420);

const afterTap = await page.evaluate((uid) => {
  const ff = window.__fungiflush;
  const card = ff.scene.handState().find((c) => c.uid === uid);
  return { selected: Boolean(card?.selected), count: ff.engine.round.selected.length };
}, tapCard.uid);
console.log('\n--- Fase 4: tap-to-select ---');
console.log(JSON.stringify(afterTap, null, 2));
await page.screenshot({ path: join(shotsDir, '05a-tap.png') });

// --- Arrastre a la zona de juego: debe seleccionar ---
const playPoint = await page.evaluate(() =>
  window.__fungiflush.scene.projectPointToScreen(0, 0.95, -1.7),
);
const dragCard = handBefore[3];
await page.mouse.move(dragCard.screenX, dragCard.screenY);
await page.mouse.down();
await page.mouse.move(playPoint.x, playPoint.y, { steps: 14 });
// La captura se toma CON la carta en el aire: es la unica forma de ver el
// resaltado de las zonas. La pausa es para que el render presente el ultimo
// frame del arrastre (a 12 FPS, sin esperar la captura sale atrasada).
await page.waitForTimeout(250);
await page.screenshot({ path: join(shotsDir, '05b-drag.png') });
await page.mouse.up();
// OJO con el tiempo de espera: el bucle acota `dt` a 0.05 s, asi que con los
// ~12 FPS de SwiftShader las animaciones corren mas lento que en tiempo real.
// 1.6 s alcanzan para que la carta termine de volver a su lugar.
await page.waitForTimeout(1600);

const afterDragPlay = await page.evaluate((uid) => {
  const ff = window.__fungiflush;
  const card = ff.scene.handState().find((c) => c.uid === uid);
  return {
    selected: Boolean(card?.selected),
    count: ff.engine.round.selected.length,
    x: card ? Number(card.x.toFixed(2)) : null,
    z: card ? Number(card.z.toFixed(2)) : null,
    // La carta tiene que haber VUELTO a su lugar (misma z que las demas).
    backInHand: card ? Math.abs(card.z - 3) < 0.6 : false,
  };
}, dragCard.uid);
console.log('\n--- Fase 4: arrastre a la zona de juego ---');
console.log(JSON.stringify(afterDragPlay, null, 2));

// --- Arrastre al descarte: debe descartar ESA carta y respetar la seleccion ---
const discardPoint = await page.evaluate(() =>
  window.__fungiflush.scene.projectPointToScreen(-7.8, 0.95, 2.4),
);
const beforeDiscard = await page.evaluate(() => {
  const ff = window.__fungiflush;
  return {
    discardsLeft: ff.engine.round.discardsLeft,
    selected: [...ff.engine.round.selected],
  };
});

const discardCard = handBefore[5];
await page.mouse.move(discardCard.screenX, discardCard.screenY);
await page.mouse.down();
await page.mouse.move(discardPoint.x, discardPoint.y, { steps: 14 });
await page.mouse.up();
await page.waitForTimeout(900);

const afterDiscard = await page.evaluate((uid) => {
  const ff = window.__fungiflush;
  return {
    discardsLeft: ff.engine.round.discardsLeft,
    stillInHand: ff.engine.round.hand.some((c) => c.uid === uid),
    cardsDiscarded: ff.engine.round.cardsDiscardedThisRound,
    selected: [...ff.engine.round.selected],
    handSize: ff.engine.round.hand.length,
  };
}, discardCard.uid);
console.log('\n--- Fase 4: arrastre al descarte ---');
console.log(JSON.stringify({ beforeDiscard, afterDiscard }, null, 2));
await page.screenshot({ path: join(shotsDir, '05c-discard.png') });

// --- Arrastre dentro de la banda de la mano: devuelve y deselecciona ---
const tapNow = (await page.evaluate(() => window.__fungiflush.scene.handState())).find(
  (c) => c.uid === tapCard.uid,
);
const afterDragHand = await (async () => {
  if (!tapNow) return { skipped: 'la carta del tap ya no esta en la mano' };
  await page.mouse.move(tapNow.screenX, tapNow.screenY);
  await page.mouse.down();
  // Se mueve en horizontal: se queda dentro de la banda de la mano.
  await page.mouse.move(tapNow.screenX + 90, tapNow.screenY, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(600);
  return page.evaluate((uid) => {
    const ff = window.__fungiflush;
    const card = ff.scene.handState().find((c) => c.uid === uid);
    return { selected: Boolean(card?.selected), count: ff.engine.round.selected.length };
  }, tapCard.uid);
})();
console.log('\n--- Fase 4: arrastre dentro de la mano (devuelve) ---');
console.log(JSON.stringify(afterDragHand, null, 2));

// --- Flip: el dorso existe y la carta se da vuelta y vuelve ---
const flipTest = await page.evaluate(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const ff = window.__fungiflush;
  const uid = ff.engine.round.hand[0].uid;

  const accepted = ff.scene.setCardFaceUp(uid, false);
  await wait(700);
  const down = ff.scene.handState().find((c) => c.uid === uid);

  ff.scene.setCardFaceUp(uid, true);
  await wait(700);
  const up = ff.scene.handState().find((c) => c.uid === uid);

  return {
    accepted,
    // Todas las cartas de la mano tienen dorso texturizado.
    allHaveBack: ff.scene.handState().every((c) => c.hasBack),
    back: { flip: Number((down?.flip ?? -1).toFixed(3)), faceUp: down?.faceUp },
    front: { flip: Number((up?.flip ?? -1).toFixed(3)), faceUp: up?.faceUp },
  };
});
console.log('\n--- Fase 4: flip (dorso + home.flip) ---');
console.log(JSON.stringify(flipTest, null, 2));

await page.evaluate(() => window.__fungiflush.engine.clearSelection());
await page.waitForTimeout(250);

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

// El boton "Jugar Mano" se aprieta de verdad: es la otra punta del cable de
// `pointer-events` (la barra inferior del HUD).
const playButton = await page.locator('.hud-actions .btn.is-play').boundingBox();
if (playButton) {
  await page.mouse.click(playButton.x + playButton.width / 2, playButton.y + playButton.height / 2);
} else {
  await page.evaluate(() => window.__fungiflush.engine.playHand());
}
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

// --- Cultivo: mejorar una carta y evolucionar otra ---
const upgradeStep = await page.evaluate(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const engine = window.__fungiflush.engine;
  engine.run.money = Math.max(engine.run.money, 300);
  window.__fungiflush.hud.showDeckBuilder();
  await wait(500);

  const button = document.querySelector('.panel.is-deck [data-act="upgrade"]');
  const uid = button?.dataset.uid ?? null;
  const target = engine.run.deck.allCards.find((c) => c.uid === uid) ?? null;
  const before = { level: target?.level ?? 0, money: engine.run.money };

  button?.click();
  await wait(700);

  const after = engine.run.deck.allCards.find((c) => c.uid === uid) ?? null;
  return {
    uid,
    levelBefore: before.level,
    levelAfter: after?.level ?? 0,
    moneySpent: before.money - engine.run.money,
    statsUpgraded: engine.run.stats.cardsUpgraded,
  };
});
console.log('\n--- Cultivo: mejorar ---');
console.log(JSON.stringify(upgradeStep, null, 2));
await page.screenshot({ path: join(shotsDir, '10-upgrade.png') });

const evolveStep = await page.evaluate(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const engine = window.__fungiflush.engine;
  const base = engine.run.deck.allCards.find((c) => c.def.id === 'spore_puffball');
  if (!base) return { skipped: 'no hay spore_puffball en el mazo' };

  // Se fuerza el nivel para no depender de la suerte del reparto.
  base.level = 3;
  window.__fungiflush.hud.showDeckBuilder(base.uid);
  await wait(500);

  const button = document.querySelector(
    `.panel.is-deck [data-act="evolve"][data-uid="${base.uid}"]`,
  );
  const enabled = button ? !button.disabled : false;
  button?.click();
  await wait(700);

  const after = engine.run.deck.allCards.find((c) => c.uid === base.uid);
  return {
    enabled,
    defBefore: 'spore_puffball',
    defAfter: after?.def.id ?? null,
    uidPreserved: after?.uid === base.uid,
    levelCarried: after?.level ?? 0,
    evolvedFrom: after?.evolvedFrom ?? null,
    statsEvolved: engine.run.stats.cardsEvolved,
  };
});
console.log('\n--- Cultivo: evolucionar ---');
console.log(JSON.stringify(evolveStep, null, 2));
await page.screenshot({ path: join(shotsDir, '11-evolve.png') });

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
await page.screenshot({ path: join(shotsDir, '12-collection.png') });

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
await page.screenshot({ path: join(shotsDir, '13-language.png') });

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
  upgradeStep?.uid !== null &&
  upgradeStep?.levelAfter === (upgradeStep?.levelBefore ?? 0) + 1 &&
  (upgradeStep?.moneySpent ?? 0) > 0 &&
  upgradeStep?.statsUpgraded >= 1 &&
  evolveStep?.enabled === true &&
  evolveStep?.defAfter === 'spore_giant_puffball' &&
  evolveStep?.uidPreserved === true &&
  evolveStep?.levelCarried === 3 &&
  evolveStep?.evolvedFrom === 'spore_puffball' &&
  evolveStep?.statsEvolved >= 1 &&
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
  // --- Fase 4: tap, arrastre y flip ---
  afterTap?.selected === true &&
  afterTap?.count === 1 &&
  afterDragPlay?.selected === true &&
  afterDragPlay?.count === 2 &&
  afterDragPlay?.backInHand === true &&
  afterDiscard?.discardsLeft === (beforeDiscard?.discardsLeft ?? 0) - 1 &&
  afterDiscard?.stillInHand === false &&
  afterDiscard?.cardsDiscarded === 1 &&
  afterDiscard?.handSize === (afterBlind?.hand ?? 0) &&
  JSON.stringify(afterDiscard?.selected) === JSON.stringify(beforeDiscard?.selected) &&
  afterDragHand?.selected === false &&
  afterDragHand?.count === 1 &&
  flipTest?.accepted === true &&
  flipTest?.allHaveBack === true &&
  (flipTest?.back?.flip ?? 0) > 0.9 &&
  flipTest?.back?.faceUp === false &&
  (flipTest?.front?.flip ?? 1) < 0.1 &&
  flipTest?.front?.faceUp === true &&
  afterPlay?.score > 0 &&
  afterWin?.status === 'shop' &&
  realErrors.length === 0 &&
  pageErrors.length === 0;

console.log(ok ? '\n✓ SMOKE TEST OK' : '\n✗ SMOKE TEST FALLO');

await browser.close();
process.exit(ok ? 0 : 1);
