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
// `daily=0` apaga el modal de la recompensa diaria, que aparece solo en la
// primera apertura del dia (o sea: SIEMPRE, porque el smoke arranca con un
// perfil limpio). Sin esto el modal se abre sobre la pantalla de inicio y le
// tapa los botones que el smoke tiene que clickear.
const URL_TO_TEST = process.argv[2] ?? 'http://127.0.0.1:1420/?daily=0';

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

// --- Helpers de navegacion del MENU ---
// Las acciones secundarias ya no son chips sueltos: viven en el desplegable
// (Ajustes / Coleccion / Desafios) o dentro de los paneles de Perfil y
// Coleccion. Estos helpers reproducen el camino real del jugador.
const menuDrop = async () => {
  await page.evaluate(() =>
    document.querySelector('.panel.is-menu [data-act="menu-toggle"]')?.click(),
  );
  await page.waitForTimeout(200);
};
/** Abre una accion del desplegable (Ajustes / Coleccion / Desafios). */
const menuDropAction = async (act) => {
  await menuDrop();
  await page.evaluate(
    (a) => document.querySelector(`.panel.is-menu [data-act="${a}"]`)?.click(),
    act,
  );
  await page.waitForTimeout(400);
};
/** Abre una accion dentro de un sub-panel ya visible. */
const subPanelAction = async (panelSel, act) => {
  await page.evaluate(
    ([p, a]) => document.querySelector(`${p} [data-act="${a}"]`)?.click(),
    [panelSel, act],
  );
  await page.waitForTimeout(400);
};

const consoleErrors = [];
const consoleWarnings = [];
const pageErrors = [];
/** URLs pedidas, para poder afirmar que un chunk NO se cargo. */
const requestedUrls = [];

page.on('request', (request) => requestedUrls.push(request.url()));

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
    // En `low` las esporas de ambiente estan apagadas por diseño (el tier no
    // las paga): si esto no da 0, el limite del tier no se esta aplicando.
    particles: ff.scene.stats().particles,
    canvas: canvas ? `${canvas.width}x${canvas.height}` : 'sin canvas',
    webgl: gl ? 'contexto activo' : 'SIN CONTEXTO WEBGL',
    renderer: gl ? gl.getParameter(gl.VERSION) : '',
  };
});

console.log('\n--- Pantalla de inicio ---');
console.log(JSON.stringify(menuState, null, 2));

await page.screenshot({ path: join(shotsDir, '01-menu.png') });

// --- Ajustes: abrir, capturar y volver (ejercita el panel y el perfil) ---
// Ajustes vive en el desplegable: primero se abre el menu, despues la accion.
await menuDrop();
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

// --- Calidad grafica ---
// SwiftShader es un renderer por SOFTWARE: la deteccion tiene que caer a `low`
// (sin composer). Es lo que mantiene validas todas las aserciones de tiempo de
// este test, que asumen los ~12 FPS del baseline.
const qualityBoot = await page.evaluate(() => {
  const ff = window.__fungiflush;
  const q = ff.quality();
  return {
    tier: q.tier,
    reason: q.reason,
    composer: q.composer,
    bloom: q.bloom,
    dpr: q.dpr,
    segments: document.querySelectorAll('.panel.is-settings .settings-segment').length,
    active: document.querySelector('.panel.is-settings .settings-segment.is-on')?.dataset.value ?? null,
  };
});
console.log('\n--- Calidad grafica (deteccion) ---');
console.log(JSON.stringify(qualityBoot, null, 2));

const qualitySwitch = await page.evaluate(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const ff = window.__fungiflush;

  document.querySelector('.panel.is-settings .settings-segment[data-value="high"]')?.click();
  await wait(300);
  const high = { tier: ff.quality().tier, active: document.querySelector('.settings-segment.is-on')?.dataset.value };

  // Se vuelve a `auto` para no dejar el perfil tocado ni arrancar el monitor
  // de frames en un tier que bajo render por software no se sostiene.
  document.querySelector('.panel.is-settings .settings-segment[data-value="auto"]')?.click();
  await wait(300);
  const auto = { tier: ff.quality().tier, reason: ff.quality().reason, persisted: ff.profileStore.current.settings.quality };

  return { high, auto };
});
console.log('\n--- Calidad grafica (cambio manual) ---');
console.log(JSON.stringify(qualitySwitch, null, 2));

const settingsRoundTrip = await page.evaluate(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  document.querySelector('.panel.is-settings [data-act="close"]')?.click();
  await wait(400);
  return { backToMenu: Boolean(document.querySelector('.panel.is-menu')) };
});
console.log('\n--- Ajustes (abrir / cerrar) ---');
console.log(JSON.stringify({ ...settingsOpened, ...settingsRoundTrip }, null, 2));

// ===========================================================================
// Fase 5 — DUELO MICELIAL (hot-seat)
// ===========================================================================
// El duelo es el unico modo con informacion oculta: lo que mas importa probar
// no es que el tablero dibuje, sino que la mano del rival NO llegue al DOM.

const center = (box) => ({ x: box.x + box.width / 2, y: box.y + box.height / 2 });

// El motor del tablero se carga con `await import()`: hasta aca no puede
// haber viajado NI UN byte. Es la unica forma de verificar la carga diferida
// (el bundle puede verse bien y estar precargado igual). En dev los modulos
// se sirven sueltos; en build, ya empaquetados en su chunk.
const isBoardModule = (url) => /\/src\/engine\/board\/|\/assets\/board-/.test(url);
const boardChunkBeforeOpen = requestedUrls.filter(isBoardModule).length;

// El duelo vive en el panel de Desafios: menu -> Desafios -> Duelo.
await menuDropAction('challenges');
await page.waitForSelector('.panel.is-challenges', { timeout: 5000 });
const boardButton = await page.locator('.panel.is-challenges [data-act="board"]').boundingBox();
if (boardButton) await page.mouse.click(center(boardButton).x, center(boardButton).y);
// El motor del tablero se carga con `await import()`: hay que darle tiempo.
await page.waitForTimeout(1400);

const boardChunkAfterOpen = requestedUrls.filter(isBoardModule).length;

const boardOpened = await page.evaluate(() => {
  const match = window.__fungiflush.board();
  return {
    panel: Boolean(document.querySelector('.panel.is-board')),
    cells: document.querySelectorAll('.panel.is-board .board-cell').length,
    curtain: Boolean(document.querySelector('.panel.is-board .board-curtain.is-open')),
    starter: match ? match.state.currentPlayer : null,
    handSize: match ? match.state.hands[match.state.currentPlayer].length : 0,
    // Con la cortina puesta no puede haber NINGUNA carta de mano dibujada.
    handChips: document.querySelectorAll('.panel.is-board .board-hand-card').length,
  };
});
console.log('\n--- Duelo: abrir ---');
console.log(JSON.stringify(boardOpened, null, 2));
await page.screenshot({ path: join(shotsDir, '14-board-curtain.png') });

// --- Levantar la cortina y colocar una carta con gestos reales ---
const readyBox = await page.locator('.panel.is-board [data-act="ready"]').boundingBox();
if (readyBox) await page.mouse.click(center(readyBox).x, center(readyBox).y);
await page.waitForTimeout(350);
await page.screenshot({ path: join(shotsDir, '15-board-hand.png') });

const handBox = await page.locator('.panel.is-board .board-hand-card').first().boundingBox();
if (handBox) await page.mouse.click(center(handBox).x, center(handBox).y);
await page.waitForTimeout(200);

const cellBox = await page.locator('.panel.is-board .board-cell').first().boundingBox();
if (cellBox) await page.mouse.click(center(cellBox).x, center(cellBox).y);
await page.waitForTimeout(500);
await page.screenshot({ path: join(shotsDir, '16-board-placed.png') });

const afterTurn = await page.evaluate(() => {
  const match = window.__fungiflush.board();
  return {
    turn: match ? match.state.turn : -1,
    currentPlayer: match ? match.state.currentPlayer : -1,
    placed: match ? match.state.cells.filter(Boolean).length : 0,
    logEntries: document.querySelectorAll('.panel.is-board .board-log-step').length,
    curtainBack: Boolean(document.querySelector('.panel.is-board .board-curtain.is-open')),
  };
});
console.log('\n--- Duelo: un turno ---');
console.log(JSON.stringify(afterTurn, null, 2));

// --- La prueba que importa: la mano del rival no esta en el DOM ---
const hiddenInfo = await page.evaluate(() => {
  const match = window.__fungiflush.board();
  const panel = document.querySelector('.panel.is-board');
  const rival = match.state.hands[match.state.currentPlayer].map((c) => c.uid);
  const html = panel ? panel.innerHTML : '';
  return {
    rivalCards: rival.length,
    leaked: rival.filter((uid) => html.includes(uid)),
    handChips: document.querySelectorAll('.panel.is-board .board-hand-card').length,
  };
});
console.log('\n--- Duelo: informacion oculta ---');
console.log(JSON.stringify(hiddenInfo, null, 2));

// --- Terminar la partida por el motor y verificar el cierre ---
const boardFinished = await page.evaluate(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const match = window.__fungiflush.board();
  if (!match) return { skipped: 'no hay duelo abierto' };

  for (let i = 0; i < 40 && match.state.status === 'placing'; i++) {
    const player = match.state.currentPlayer;
    const card = match.state.hands[player][0];
    const cell = match.state.cells.findIndex((c) => c === null);
    if (!card || cell < 0) break;
    const result = match.api.applyCommand(match.state, {
      t: 'place',
      by: player,
      cell,
      uid: card.uid,
    });
    if (result.error) return { error: result.error };
    match.state = result.state;
    match.screen.logSteps(result.steps);
    match.screen.markFlips(result.steps);
    match.screen.update(match.api.viewFor(match.state, match.state.currentPlayer));
  }
  await wait(300);

  return {
    status: match.state.status,
    winner: match.state.winner,
    filled: match.state.cells.filter(Boolean).length,
    result: document.querySelector('.panel.is-board .board-result')?.textContent ?? null,
    rematch: Boolean(document.querySelector('.panel.is-board [data-act="rematch"]')),
  };
});
console.log('\n--- Duelo: final ---');
console.log(JSON.stringify(boardFinished, null, 2));
await page.screenshot({ path: join(shotsDir, '17-board-over.png') });

const boardClosed = await page.evaluate(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  document.querySelector('.panel.is-board [data-act="close"]')?.click();
  await wait(500);
  return {
    backToMenu: Boolean(document.querySelector('.panel.is-menu')),
    boardGone: !document.querySelector('.panel.is-board'),
  };
});
console.log('\n--- Duelo: cerrar ---');
console.log(JSON.stringify(boardClosed, null, 2));

// --- Nueva partida desde el MENU (camino real del jugador) ---
// CLICK REAL, no `element.click()`: el arreglo de `pointer-events` de la Fase
// 4 dependia de que la capa de UI recibiera los toques de verdad, y un click
// por JS lo habria dado por bueno sin probar nada.
//
// "Nueva partida" ya NO arranca la run: abre el selector de ARQUETIPO. El
// recorrido real del jugador es `new` -> `archetypes-start`. Se prueban los dos
// pasos porque el panel es una puerta nueva y, si se rompe, el jugador NO puede
// empezar una partida (el bug mas caro posible).
const newButton = await page.locator('.panel.is-menu [data-act="new"]').boundingBox();
if (newButton) {
  await page.mouse.click(newButton.x + newButton.width / 2, newButton.y + newButton.height / 2);
} else {
  await page.evaluate(() => document.querySelector('.panel.is-menu [data-act="new"]')?.click());
}
await page.waitForTimeout(700);

// --- Selector de arquetipo: elegir uno y confirmar ---
const archetypeStep = await page.evaluate(() => {
  const panel = document.querySelector('.panel.is-archetypes');
  return {
    shown: Boolean(panel),
    cards: document.querySelectorAll('.panel.is-archetypes .archetype-card').length,
    hasStart: Boolean(panel?.querySelector('[data-act="archetypes-start"]')),
  };
});
console.log('\n--- Selector de arquetipo ---');
console.log(JSON.stringify(archetypeStep, null, 2));

if (archetypeStep.shown) {
  // Se elige "Esporas" (el primer arquetipo no-clasico) y se confirma. El panel
  // es de DOBLE toque: el primer click selecciona, el segundo (sobre el mismo)
  // arranca. Aca se usa el boton "start", que es el camino equivalente.
  const sporeCard = page.locator('.panel.is-archetypes .archetype-card[data-archetype="spores"]');
  if (await sporeCard.count()) {
    await sporeCard.first().scrollIntoViewIfNeeded();
    await sporeCard.first().click();
    await page.waitForTimeout(200);
  }
  const startBtn = page.locator('.panel.is-archetypes [data-act="archetypes-start"]');
  await startBtn.scrollIntoViewIfNeeded();
  const startBox = await startBtn.boundingBox();
  const vhA = await page.evaluate(() => window.innerHeight);
  if (startBox && startBox.y + startBox.height / 2 <= vhA) {
    await page.mouse.click(startBox.x + startBox.width / 2, startBox.y + startBox.height / 2);
  } else {
    await startBtn.click();
  }
  await page.waitForTimeout(1400);
}
await page.waitForTimeout(1600);

// --- P0.3: tutorial de la primera partida ---
// El tutorial se ofrece UNA vez por run, sobre el panel de seleccion de ciego.
// Como `openOverlay` REEMPLAZA el contenido del overlay, mientras el tutorial
// esta abierto el `.blind-grid` NO existe: el jugador lo cierra y RECIEN ahi
// aparece la seleccion. El smoke hace lo mismo que el jugador (click real) y
// comprueba que la puerta de salida lleva al panel correcto.
const tutorialStep = await page.evaluate(() => {
  const panel = document.querySelector('.panel.is-tutorial');
  return {
    shown: Boolean(panel),
    hasClose: Boolean(panel?.querySelector('[data-act="tutorial-close"]')),
    steps: document.querySelectorAll('.tutorial-steps li').length,
    stats: document.querySelectorAll('.tutorial-stat').length,
    // La guia v2 explica Sustrato/Esporas/Combos: se comprueba que las
    // secciones existen y que el cuerpo scrollea (no que la accion quede
    // visible de entrada: en landscape el glosario es largo a proposito).
    sections: document.querySelectorAll('.tutorial-section').length,
    rows: document.querySelectorAll('.tutorial-row').length,
    hasBody: Boolean(panel?.querySelector('.tutorial-body')),
  };
});
console.log('\n--- Tutorial (P0.3) ---');
console.log(JSON.stringify(tutorialStep, null, 2));

if (tutorialStep.shown) {
  // La accion vive al pie del panel. En landscape movil (844x390) el glosario de
  // la guia es largo: hay que desplazar el panel como haria el jugador, porque
  // `page.mouse.click` a una Y bajo el pliegue NO hace scroll por si solo.
  const closeBtn = page.locator('[data-act="tutorial-close"]');
  await closeBtn.scrollIntoViewIfNeeded();
  await page.waitForTimeout(200);
  const closeBox = await closeBtn.boundingBox();
  // `boundingBox` devuelve coordenadas aunque el boton este fuera del viewport:
  // se valida contra el alto real antes de tocar, o el click se pierde.
  const vh = await page.evaluate(() => window.innerHeight);
  if (closeBox && closeBox.y + closeBox.height / 2 <= vh) {
    await page.mouse.click(closeBox.x + closeBox.width / 2, closeBox.y + closeBox.height / 2);
  } else {
    await closeBtn.click();
  }
  await page.waitForTimeout(900);
}

const afterStart = await page.evaluate(() => {
  const ff = window.__fungiflush;
  // El panel de ciego tiene que entrar ENTERO en un celular landscape
  // (844x390): si desborda el viewport, el boton "Luchar" queda al borde del
  // pliegue y no se puede tocar. `clientHeight` vs `scrollHeight` dice si el
  // panel necesita scroll; `bottom - innerHeight` dice si se sale de pantalla.
  const blindPanel = document.querySelector('.panel.is-blind-select');
  const bp = blindPanel?.getBoundingClientRect() ?? null;
  return {
    status: ff.engine.run.status,
    blindSelectVisible: Boolean(document.querySelector('.blind-focus .blind-card')),
    blindRouteDots: document.querySelectorAll('.blind-route-dot').length,
    tutorialDismissed: !document.querySelector('.panel.is-tutorial'),
    hudHidden: document.getElementById('ui-root')?.classList.contains('in-menu') ?? false,
    deckSize: ff.engine.run.deck.totalSize,
    // El total REAL del mazo (pilas + mano). OJO: en `blind_select` los
    // contadores del HUD aun no existen (solo se pintan en `playing`), asi que
    // la comprobacion del chip va en `afterBlind`, no aca.
    engineDeckSize: ff.engine.deckSize,
    // El arquetipo elegido cambia el mazo inicial (Clasico = 40, cada arquetipo
    // = 24). La asercion del tamano tiene que comparar contra el mazo del
    // arquetipo realmente elegido, no contra un 40 fijo.
    archetype: ff.engine.run.archetype ?? '',
    expectedDeckSize: ff.engine.run.archetype ? 24 : 40,
    blindPanelFit: bp
      ? {
          overflowViewport: Math.round(bp.bottom - window.innerHeight),
          scrollOverflow: blindPanel.scrollHeight - blindPanel.clientHeight,
        }
      : null,
  };
});
console.log('\n--- Tras "Nueva partida" ---');
console.log(JSON.stringify(afterStart, null, 2));
await page.screenshot({ path: join(shotsDir, '03-blind-select.png') });

// ===========================================================================
// Fase 3b — TIRADA MANUAL DEL DADO (gesto de puntero REAL)
// ===========================================================================
// La tirada es un arrastre: hay que probarla con dedo de verdad, no llamando a
// `engine.throwDie()`. Lo que se afirma:
//   1. Al entrar al ciego el dado esta ARMADO (agrandado, sobre la arena) y el
//      panel se corrio para que el canvas reciba el gesto.
//   2. Mientras el cubo esta en el aire, el resultado NO se ve y los ciegos
//      estan bloqueados: si se pudiera elegir antes, el dado no seria una
//      apuesta.
//   3. Al apoyarse aparecen la cara y el boton de volver a tirar.
const dieArmed = await page.evaluate(() => {
  const ff = window.__fungiflush;
  const g = ff.scene.die3d?.group;
  const screen = g ? ff.scene.projectPointToScreen(g.position.x, g.position.y, g.position.z) : null;
  return {
    state: ff.scene.dieState(),
    screen,
    panelCorrido: document
      .querySelector('.panel.is-blind-select')
      ?.classList.contains('is-die-armed'),
    overlayLibre: document.querySelector('#ui-root > .overlay')?.classList.contains('is-throw'),
    gridBloqueado: document.querySelector('.blind-grid')?.classList.contains('is-locked'),
    consigna: document.querySelector('.die-hint')?.textContent ?? null,
    die: ff.engine.run.die,
  };
});
console.log('\n--- Dado armado ---');
console.log(JSON.stringify(dieArmed, null, 2));

if (dieArmed.screen) {
  // Arrastre real: agarrar el cubo, moverlo en varios pasos (para que se mida
  // la velocidad del gesto) y soltarlo.
  const { x, y } = dieArmed.screen;
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let i = 1; i <= 6; i++) {
    await page.mouse.move(x + i * 12, y - i * 8);
    await page.waitForTimeout(16);
  }
  await page.mouse.up();
  await page.waitForTimeout(260);
  await page.screenshot({ path: join(shotsDir, '03b-die-vuelo.png') });
}

const dieMid = await page.evaluate(() => {
  const ff = window.__fungiflush;
  return {
    fila: document.querySelector('.die-row')?.textContent ?? null,
    gridBloqueado: document.querySelector('.blind-grid')?.classList.contains('is-locked'),
    panelCorrido: document
      .querySelector('.panel.is-blind-select')
      ?.classList.contains('is-die-armed'),
    resultadoVisible: Boolean(document.querySelector('[data-act="reroll-die"]')),
    // Lo que distingue "esta volando" de "nadie lo tiro": el cubo esta en el
    // aire y el motor ya sorteo (aunque el resultado no se vea).
    busy: ff.scene.dieState()?.busy === true,
    yaSorteado: ff.engine.run.die !== null,
  };
});
console.log('\n--- Dado en el aire ---');
console.log(JSON.stringify(dieMid, null, 2));

await page.waitForTimeout(2600);
const dieLanded = await page.evaluate(() => {
  const ff = window.__fungiflush;
  return {
    die: ff.engine.run.die,
    estado: ff.scene.dieState(),
    fila: document.querySelector('.die-row')?.textContent ?? null,
    gridBloqueado: document.querySelector('.blind-grid')?.classList.contains('is-locked'),
    rerollVisible: Boolean(document.querySelector('[data-act="reroll-die"]')),
  };
});
console.log('\n--- Dado apoyado ---');
console.log(JSON.stringify(dieLanded, null, 2));
await page.screenshot({ path: join(shotsDir, '03c-dado-apoyado.png') });

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
  const chips = {};
  for (const c of document.querySelectorAll('.counter')) {
    // Clave ESTABLE por `data-counter` (no por el `title`, que cambia con el
    // idioma). Se mantiene el `title` como respaldo.
    chips[c.dataset.counter || c.title] = c.querySelector('.counter-value')?.textContent;
  }
  // Misiones en tactil: el chip plegable vive arriba a la derecha y abre un
  // cajon lateral a la derecha (`.hud-missions-panel`). Lo que se mide es el
  // PANEL, no el chip: queremos que los `.mission-chip` quepan dentro del cajon
  // sin recortarse contra su propio borde inferior.
  const missionsToggle = document.querySelector('.hud-missions-toggle');
  const missionsPanel = document.querySelector('.hud-missions-panel');
  const mpb = missionsPanel?.getBoundingClientRect() ?? null;
  const lastChip = [...document.querySelectorAll('.hud-missions-panel .mission-chip')].pop();
  const lb = lastChip?.getBoundingClientRect() ?? null;
  return {
    status: ff.engine.run.status,
    blind: ff.engine.round?.blind.id,
    target: ff.engine.round?.target,
    hand: ff.engine.round?.hand.length ?? 0,
    sceneHand: ff.scene.stats().hand,
    // Chip MAZO = "ROBABLES / total". `Robables` es la pila de robo REAL, asi
    // que al REPARTIR la mano baja (6 cartas salieron) pero el TOTAL no se mueve.
    // Antes el primer numero era "lo consumido" (deckDraw), que mentia cuando el
    // descarte todavia podia reciclarse: llegaba a 0/40 con cartas por volver.
    chipDeck: chips['ui_icon_collection'] ?? null,
    chipDeckTotal: chips['ui_icon_collection']?.split('/')[1] ?? null,
    deckSize: ff.engine.deckSize,
    deckDrawPile: ff.engine.deckDrawPile,
    deckDiscardPile: ff.engine.deckDiscardPile,
    // Etiquetas FISICAS de las pilas ("MAZO / N ROBABLES", "DESCARTE / N
    // CARTAS"): sin ellas los dorsos se confunden con decoracion.
    pileLabels: [...document.querySelectorAll('.pile-label.is-visible')].map((el) =>
      (el.textContent ?? '').trim(),
    ),
    // El mazo inicial depende del arquetipo (Clasico 40, arquetipos 20). Las
    // aserciones del chip y del mazo se comparan contra este valor, no contra
    // un 40 fijo, para que el smoke siga valido con cualquier arquetipo.
    expectedDeckSize: ff.engine.run.archetype ? 24 : 40,
    deckDraw: ff.engine.deckDraw,
    deckRemaining: ff.engine.run.deck.remaining,
    // Baseline de draw calls de ESCENA en el tier bajo (sin composer, sin sky):
    // es el "camino de siempre". El camino con post-procesamiento solo suma el
    // sky dome (+1), asi que el alta no debe pasar de este valor + 4.
    drawCalls: ff.scene.stats().drawCalls,
    missionsClip: missionsPanel
      ? {
          overflow: missionsPanel.scrollHeight - missionsPanel.clientHeight,
          lastChipBottom: lb ? Math.round(lb.bottom) : null,
          panelBottom: mpb ? Math.round(mpb.bottom) : null,
          toggleVisible: !!missionsToggle && getComputedStyle(missionsToggle).display !== 'none',
          missionsCount: document.querySelectorAll('.mission-chip').length,
        }
      : null,
  };
});
console.log('\n--- Tras elegir ciego ---');
console.log(JSON.stringify(afterBlind, null, 2));

// ===========================================================================
// Fase 3c — ORDEN DE LA MANO: el abanico NO se superpone (regresion)
// ===========================================================================
// Bug reportado: con un criterio activo, al jugar/descartar y volver a
// repartir, las ilustraciones quedaban SUPERPUESTAS (dos cartas en el mismo x).
// La causa era una carrera: dos `layoutHand()` en el mismo tick creaban dos
// tweens con stagger que se pisaban. Ahora `layoutHand()` mata el layout
// anterior antes de crear el nuevo, asi que la posicion final es siempre la del
// ultimo Map. Se mide el gap MINIMO entre cartas vecinas: si es < 1.9 hay pisa.
//
// Fase 3 (2026-10-05): el boton "Ordenar" se retiro. El orden automatico
// (Familia -> Sustrato descendente) esta ON por defecto, asi que la mano YA
// viene ordenada y el caso se ejercita igual sin tocar ningun boton.
const sortOverlap = await page.evaluate(async () => {
  const ff = window.__fungiflush;
  const scene = ff.scene;
  const measure = () => {
    const xs = scene.readHandXs();
    if (xs.length < 2) return { count: xs.length, minGap: Infinity };
    let minGap = Infinity;
    for (let i = 1; i < xs.length; i += 1) minGap = Math.min(minGap, Math.abs(xs[i] - xs[i - 1]));
    return { count: xs.length, minGap };
  };
  const settle = (ms) => new Promise((r) => setTimeout(r, ms));

  // La mano llega ya ordenada por el criterio automatico: se espera a que el
  // abanico asiente y se mide.
  await settle(2200);
  const afterSort = measure();

  // Jugar una mano y volver a medir: es el caso reportado.
  const hand = ff.engine.round?.hand ?? [];
  if (hand[0]) ff.engine.toggleSelect(hand[0].uid);
  await settle(150);
  document.querySelector('[data-act="play"]')?.click();
  await settle(3200);
  const afterPlay = measure();

  return { afterSort, afterPlay, status: ff.engine.run.status };
});
console.log('\n--- Orden: gap minimo del abanico (regresion) ---');
console.log(JSON.stringify(sortOverlap, null, 2));

// P0.8 — REGRESION DE SEPARACION: las cartas del abanico NUNCA se pisan. El gap
// minimo entre vecinas (en unidades de mundo de la escena) debe quedar por
// encima del umbral de pisado. Si el layout vuelve a crear dos cartas en el
// mismo x, el gap cae y esto falla antes de que el jugador lo vea.
if (sortOverlap.afterSort.count >= 2 && sortOverlap.afterSort.minGap < 1.9) {
  console.error('P0.8 FALLO: abanico se pisa tras ordenar (gap=' + sortOverlap.afterSort.minGap + ')');
  process.exit(1);
}
if (sortOverlap.afterPlay.count >= 2 && sortOverlap.afterPlay.minGap < 1.9) {
  console.error('P0.8 FALLO: abanico se pisa tras jugar mano (gap=' + sortOverlap.afterPlay.minGap + ')');
  process.exit(1);
}

// ===========================================================================
// Fase 4 — FLIP + ARRASTRE con gestos de puntero REALES
// ===========================================================================
// Nada de `engine.toggleSelect()` aca: lo que hay que probar es que el TAP siga
// seleccionando y que el ARRASTRE resuelva zonas. Se apunta a las coordenadas
// que reporta la escena, no a numeros a ojo.

await page.evaluate(() => window.__fungiflush.engine.clearSelection());
await page.waitForTimeout(300);

// La Fase 3c termina jugando una mano: la mano se REPARTE de nuevo y las
// cartas viajan a su lugar. Si se muestrean las coordenadas mientras vuelan,
// el tap cae al vacio y el test de seleccion falla por un motivo ajeno a la
// seleccion. Se espera a que la posicion de la mano se ESTABILICE antes de
// medir: se lee `handState()` dos veces y se exige que las coordenadas no
// cambien entre lecturas.
const waitHandStable = async () => {
  let prev = '';
  for (let i = 0; i < 40; i++) {
    const sig = await page.evaluate(() =>
      window.__fungiflush.scene
        .handState()
        .map((c) => `${c.uid}:${Math.round(c.screenX)},${Math.round(c.screenY)}`)
        .join('|'),
    );
    if (sig && sig === prev) return true;
    prev = sig;
    await page.waitForTimeout(120);
  }
  return false;
};
await waitHandStable();

const handBefore = await page.evaluate(() => window.__fungiflush.scene.handState());
console.log('\n--- Fase 4: mano en pantalla ---');
console.log(
  JSON.stringify(
    handBefore.map((c) => ({ uid: c.uid, sx: c.screenX, sy: c.screenY, back: c.hasBack })),
  ),
);

// P0.7 — REGRESION: ningun nodo del HUD puede montarse sobre el CENTRO de una
// carta de la mano. Antes del pulido, la franja de misiones (107 px de alto en
// y247–354) se pintaba encima de las cartas y `elementFromPoint` en el centro
// de una carta devolvia el HUD en lugar del canvas: el toque se tragaba y la
// carta no seleccionaba. Ahora las misiones son un chip plegable y el panel
// slide-in arranca CERRADO, asi que el centro de cada carta debe quedar libre.
// Si un nodo del HUD intercepta, lo reportamos y fallamos el smoke.
const hudCover = await page.evaluate(() => {
  const blocked = ['.hud-top', '.hud-bottom', '.hud-jokers', '.hud-missions-panel',
    '.hud-missions-toggle', '.hud-status', '.overlay', '.panel'];
  const covered = [];
  for (const c of window.__fungiflush.scene.handState()) {
    const el = document.elementFromPoint(c.screenX, c.screenY);
    const hit = el ? (el.closest(blocked.join(',')) ? el.className || el.tagName : null) : 'void';
    // El canvas (o un hijo suyo) es lo esperado: la carta se dibuja ahi.
    const isCanvas = el && (el.tagName === 'CANVAS' || el.closest('canvas') !== null);
    if (!isCanvas) covered.push({ uid: c.uid, x: Math.round(c.screenX), y: Math.round(c.screenY), hit });
  }
  return { covered };
});
if (hudCover.covered.length > 0) {
  console.error('P0.7 FALLO: el HUD tapa el centro de cartas ->', JSON.stringify(hudCover.covered));
  process.exit(1);
}
console.log('\n--- P0.7: centro de cartas libre de HUD ---');
console.log(JSON.stringify(hudCover));

// --- Tap: debe seguir seleccionando ---
const tapCard = handBefore[1];
await page.mouse.move(tapCard.screenX, tapCard.screenY);
await page.mouse.down();
await page.mouse.up();
await page.waitForTimeout(420);

const afterTap = await page.evaluate((uid) => {
  const ff = window.__fungiflush;
  const card = ff.scene.handState().find((c) => c.uid === uid);
  // FIX badge "N seleccionadas": el contador tiene que APARECER en cuanto hay
  // una carta seleccionada, no solo durante la primera mano. Antes se ocultaba
  // despues de la primera mano jugada y el jugador perdia la cuenta.
  const hint = document.querySelector('[data-act="select-hint"]');
  // Fase A: la carta seleccionada lleva BADGE con su numero de orden (1-5).
  const card3d = ff.scene.handCards.get(uid);
  return {
    selected: Boolean(card?.selected),
    count: ff.engine.round.selected.length,
    hintVisible: hint ? hint.classList.contains('is-visible') : false,
    hintText: (hint?.textContent ?? '').trim(),
    badgeVisible: Boolean(card3d?.badge?.visible),
    badgeIndex: card3d?.selectIndex ?? null,
  };
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
// Se apunta a la PILA REAL (`scene.discardX`: ±10.5 escritorio, ±8.5 tactil), no
// a una constante: la zona de descarte se recentra sobre la pila por perfil.
const discardPoint = await page.evaluate(() => {
  const s = window.__fungiflush.scene;
  return s.projectPointToScreen(s.discardX, 0.95, 1.0);
});
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

// --- Fase 2: TAP sobre la pila de descarte (alternativa al drag) ---
// Con cartas SELECCIONADAS, tocar la pila descarta TODA la seleccion. Se
// simula un tap real (down+up en el mismo punto, sin movimiento) sobre la pila.
// Va DESPUES de las pruebas de arrastre para no alterar su seleccion.
const tapDiscard = await (async () => {
  const before = await page.evaluate(() => {
    const ff = window.__fungiflush;
    return { discardsLeft: ff.engine.round.discardsLeft };
  });
  const picked = await page.evaluate(() => {
    const ff = window.__fungiflush;
    ff.engine.clearSelection();
    const uids = ff.engine.round.hand.slice(0, 2).map((c) => c.uid);
    for (const uid of uids) ff.engine.toggleSelect(uid);
    return uids;
  });
  await page.waitForTimeout(450);
  const pt = await page.evaluate(() => {
    const s = window.__fungiflush.scene;
    // Sobre la PILA (y=0.4, por encima de la mesa) y NO sobre la mano (z=3).
    return s.projectPointToScreen(s.discardX, 0.4, 1.0);
  });
  await page.mouse.move(pt.x, pt.y);
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForTimeout(700);
  const after = await page.evaluate((uids) => {
    const ff = window.__fungiflush;
    return {
      discardsLeft: ff.engine.round.discardsLeft,
      gone: uids.every((u) => !ff.engine.round.hand.some((c) => c.uid === u)),
      selected: ff.engine.round.selected.length,
    };
  }, picked);
  return { before, pickedCount: picked.length, after };
})();
console.log('\n--- Fase 2: tap sobre el descarte ---');
console.log(JSON.stringify(tapDiscard, null, 2));

// --- Ficha de joker: señalar NO vende ---
// Se le da un joker al run a mano para no depender de que la tienda ofrezca uno.
const jokerChip = await (async () => {
  await page.evaluate(() => {
    const ff = window.__fungiflush;
    const ids = ff.engine.registry.allJokers().map((j) => j.id);
    if (ids[0] && ff.engine.run.jokers.length === 0) {
      ff.engine.run.jokers.push(ff.engine.registry.instantiateJoker(ids[0]));
      ff.hud.refreshPanel();
    }
  });
  await page.waitForTimeout(700);

  const chip = await page.locator('.joker-chip').first().boundingBox();
  const sell = await page.locator('.joker-chip .joker-chip-sell').first().boundingBox();
  if (!chip) return { skipped: 'sin ficha de joker' };

  // El boton VENDER tiene que ser ALCANZABLE: `elementFromPoint` en su centro
  // debe devolver el propio boton. Si algo del HUD se le monta encima (p. ej.
  // la franja de misiones con `pointer-events: auto`) el toque se pierde y la
  // ficha nunca entra en confirmacion. Esto convierte ese caso en un fallo
  // explicito en vez de un "confirmando: false" opaco.
  const sellHittable = await page.evaluate(() => {
    const btn = document.querySelector('.joker-chip .joker-chip-sell');
    if (!btn) return { found: false };
    const b = btn.getBoundingClientRect();
    const el = document.elementFromPoint(
      Math.round(b.x + b.width / 2),
      Math.round(b.y + b.height / 2),
    );
    return {
      found: true,
      isSell: Boolean(el && el.classList.contains('joker-chip-sell')),
      blockedBy: el && !el.classList.contains('joker-chip-sell') ? `${el.tagName}.${el.className}` : null,
    };
  });

  const antes = await page.evaluate(() => window.__fungiflush.engine.run.jokers.length);
  // Toque en el CUERPO de la ficha: 20 px desde el borde izquierdo, bien lejos
  // del boton de vender (que vive pegado al derecho). OJO: `chip`/`sell` se
  // midieron antes; si el HUD se re-renderiza (auto-orden, state:changed), las
  // coords quedan viejas y el click cae al vacio -> se re-mide justo antes.
  const chipNow = await page.evaluate(() => {
    const el = document.querySelector('.joker-chip');
    if (!el) return null;
    const b = el.getBoundingClientRect();
    return { x: b.x, y: b.y, width: b.width, height: b.height };
  });
  await page.mouse.click(chipNow.x + 20, chipNow.y + chipNow.height / 2);
  await page.waitForTimeout(500);

  const despues = await page.evaluate(() => ({
    jokers: window.__fungiflush.engine.run.jokers.length,
    confirmando: document.querySelector('.joker-chip')?.classList.contains('is-confirming') ?? null,
  }));

  // Primer toque en VENDER: tiene que pedir confirmacion, no vender.
  let primerToque = null;
  if (sell) {
    const sellNow = await page.evaluate(() => {
      const el = document.querySelector('.joker-chip .joker-chip-sell');
      if (!el) return null;
      const b = el.getBoundingClientRect();
      return { x: b.x, y: b.y, width: b.width, height: b.height };
    });
    if (sellNow) {
      await page.mouse.click(sellNow.x + sellNow.width / 2, sellNow.y + sellNow.height / 2);
      // Poll: la clase `is-confirming` la pinta el HUD tras el toque; un
      // `waitForTimeout` fijo puede leer ANTES de que el handler corra.
      await page
        .waitForFunction(
          () => document.querySelector('.joker-chip')?.classList.contains('is-confirming') === true,
          { timeout: 2000 },
        )
        .catch(() => {});
      primerToque = await page.evaluate(() => ({
        jokers: window.__fungiflush.engine.run.jokers.length,
        confirmando: document.querySelector('.joker-chip')?.classList.contains('is-confirming') ?? null,
        etiqueta: document.querySelector('.joker-chip-sell')?.textContent ?? null,
      }));
    }
  }

  return {
    tieneBotonVender: Boolean(sell),
    sellHittable,
    antes,
    trasTocarElCuerpo: despues.jokers,
    confirmandoTrasElCuerpo: despues.confirmando,
    primerToqueEnVender: primerToque,
  };
})();
console.log('\n--- Ficha de joker (señalar no vende) ---');
console.log(JSON.stringify(jokerChip, null, 2));

// --- P6: ranuras fijas de Simbionte ---
// Comprueba que existan tantas ranuras 3D como `run.jokerSlots` y que su
// huella sea la de una carta normal a escala joker (mismo tamano que un
// Simbionte real). Ademas, que sumar una ranura cree una nueva al instante.
const jokerSlotsGuard = await (async () => {
  const before = await page.evaluate(() => {
    const ff = window.__fungiflush;
    ff.scene.syncJokers(ff.engine.run.jokers, ff.engine.run.jokerSlots);
    return {
      ...ff.scene.jokerSlotDebug(),
      engineSlots: ff.engine.run.jokerSlots,
    };
  });
  await page.waitForTimeout(400);

  const grown = await page.evaluate(() => {
    const ff = window.__fungiflush;
    const prev = ff.engine.run.jokerSlots;
    ff.engine.run.jokerSlots = prev + 1;
    ff.scene.syncJokers(ff.engine.run.jokers, ff.engine.run.jokerSlots);
    const d = ff.scene.jokerSlotDebug();
    ff.engine.run.jokerSlots = prev;
    return d;
  });
  await page.waitForTimeout(300);

  const EXPECT_W = Number((2.2 * 0.86).toFixed(4));
  const EXPECT_H = Number((3.2 * 0.86).toFixed(4));
  return {
    count: before.count,
    engineSlots: before.engineSlots,
    matchesEngine: before.count === before.engineSlots,
    sizesOk: before.slots.length > 0 && before.slots.every((s) => s.w === EXPECT_W && s.h === EXPECT_H),
    expect: { w: EXPECT_W, h: EXPECT_H },
    grewOnPlusOne: grown.count === before.count + 1,
    grownCount: grown.count,
  };
})();
console.log('\n--- P6 ranuras de Simbionte ---');
console.log(JSON.stringify(jokerSlotsGuard, null, 2));

// --- Flip: el dorso existe y la carta se da vuelta y vuelve ---
const flipTest = await page.evaluate(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const ff = window.__fungiflush;
  const uid = ff.engine.round.hand[0].uid;

  const accepted = ff.scene.setCardFaceUp(uid, false);
  await wait(1500);
  const down = ff.scene.handState().find((c) => c.uid === uid);

  ff.scene.setCardFaceUp(uid, true);
  await wait(1500);
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
// La secuencia de puntuacion anima ~3,7 s acotados (~6 s reales con los ~12 FPS
// de SwiftShader) y despues el aviso de "ciego superado" se queda 1,5 s antes de
// dejar pasar al draft. Hay que esperar a que TODO eso termine.
await page.waitForTimeout(10000);
await page.screenshot({ path: join(shotsDir, '06-after-play.png') });

const afterPlay = await page.evaluate(() => {
  const ff = window.__fungiflush;
  const chips = {};
  for (const c of document.querySelectorAll('.counter')) {
    // Clave ESTABLE por `data-counter` (no por el `title`, que cambia con el
    // idioma). Se mantiene el `title` como respaldo.
    chips[c.dataset.counter || c.title] = c.querySelector('.counter-value')?.textContent;
  }
  return {
    status: ff.engine.run.status,
    score: ff.engine.round?.score ?? null,
    target: ff.engine.round?.target ?? null,
    handsLeft: ff.engine.round?.handsLeft ?? null,
    hand: ff.engine.round?.hand.length ?? 0,
    // Chip MAZO = "ROBABLES / total": tras jugar cartas, Robables baja de la
    // pila de robo (y SUBE de nuevo si el descarte se recicla).
    chipDeck: chips['ui_icon_collection'] ?? null,
    deckDrawPile: ff.engine.deckDrawPile,
    deckDiscardPile: ff.engine.deckDiscardPile,
    deckDraw: ff.engine.deckDraw,
    deckSize: ff.engine.deckSize,
    // El mazo depende del arquetipo (Clasico 40, arquetipos 20); las cuentas de
    // "disponible" se hacen contra este valor, no contra un 40 fijo.
    expectedDeckSize: ff.engine.run.archetype ? 24 : 40,
    cardsPlayed: ff.engine.round?.cardsPlayedThisRound ?? 0,
    cardsDiscarded: ff.engine.round?.cardsDiscardedThisRound ?? 0,
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
// Mismo motivo que arriba: secuencia de puntaje + aviso antes del panel.
// POLL en vez de un wait fijo: bajo carga la animacion de puntaje tarda mas de
// 10s y el locator de la tienda expiraba. Esperamos a que el gancho REAL
// (el panel de recompensa o el aviso de ciego superado) exista.
await page
  .waitForFunction(
    () =>
      Boolean(document.querySelector('.panel.is-reward')) ||
      Boolean(document.querySelector('.panel.is-cleared [data-act="cleared-continue"]')),
    { timeout: 30000 },
  )
  .catch(() => {});

// ANTES del draft hay un aviso de "Ciego superado" (panel.is-cleared) que el
// jugador descarta con "Continuar": hay que imitar ese gesto o el draft nunca
// aparece y el locator de la tienda no matchea.
await page.evaluate(() => document.querySelector('.panel.is-cleared [data-act="cleared-continue"]')?.click());
await page
  .waitForFunction(() => Boolean(document.querySelector('.panel.is-reward')), { timeout: 10000 })
  .catch(() => {});

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
// El aviso de "Ciego superado" ya se descarto arriba; aca solo queda el draft.
await page.evaluate(() => document.querySelector('.panel.is-reward [data-act="pick"]')?.click());
await page
  .waitForFunction(() => Boolean(document.querySelector('.panel.is-shop .offer')), { timeout: 15000 })
  .catch(() => {});

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

// ===========================================================================
// Fase 3c — COMPRAR EN LA TIENDA (con click real)
// ===========================================================================
// Dos cosas que ya se rompieron una vez y no se ven en el estado del motor:
//   1. La oferta comprada tiene que quedar marcada VENDIDA en el DOM. El motor
//      la marcaba DESPUES de cobrar, y el refresco de la tienda lo dispara el
//      cobro: la tarjeta se quedaba en "Comprar", habilitada, y el segundo toque
//      avisaba "no alcanza el dinero" (mentira).
//   2. El dinero tiene que alcanzar para comprar la primera oferta asequible.
const shopBuy = await (async () => {
  const before = await page.evaluate(() => {
    const ff = window.__fungiflush;
    return {
      money: ff.engine.run.money,
      offers: ff.engine.run.shop?.offers.length ?? 0,
      vendidas: ff.engine.run.shop?.offers.filter((o) => o.sold).length ?? 0,
    };
  });
  // Dinero de sobra: lo que se prueba es la MARCA de vendida, no la economia.
  await page.evaluate(() => {
    window.__fungiflush.engine.run.money = 40;
  });
  await page.waitForTimeout(250);

  const button = await page
    .locator('.panel.is-shop .offer button:not([disabled])')
    .first()
    .boundingBox();
  if (button) {
    await page.mouse.click(button.x + button.width / 2, button.y + button.height / 2);
    await page.waitForTimeout(700);
  }

  return await page.evaluate((prev) => {
    const ff = window.__fungiflush;
    const cards = [...document.querySelectorAll('.panel.is-shop .offer')];
    const sold = cards.find((c) => c.classList.contains('is-sold'));
    return {
      clicked: cards.length > 0,
      offersBefore: prev.offers,
      vendidas: ff.engine.run.shop?.offers.filter((o) => o.sold).length ?? 0,
      // La PRIMERA tarjeta es la que se clickeo (el selector toma la primera
      // habilitada, y las vendidas quedan deshabilitadas).
      boton: sold?.querySelector('button')?.textContent ?? null,
      deshabilitado: sold?.querySelector('button')?.disabled ?? null,
      sello: sold?.querySelector('.offer-sold')?.hidden === false,
      toasts: [...document.querySelectorAll('.toast')].map((el) => el.textContent),
    };
  }, before);
})();
console.log('\n--- Tras comprar en la tienda ---');
console.log(JSON.stringify(shopBuy, null, 2));
await page.screenshot({ path: join(shotsDir, '08b-shop-vendida.png') });

// ===========================================================================
// R3 — VOUCHERS (mejoras de run)
// ===========================================================================
// Lo que puede romperse sin que el motor se entere: la oferta tiene que DIBUJARSE
// (etiqueta traducida, precio, cara de carta) y el precio PINTADO tiene que ser
// el MISMO que cobra `buyOffer` — con voucher de descuento incluido. Dos
// calculos separados es como se pinta un numero y se cobra otro.
const voucherShop = await (async () => {
  const setup = await page.evaluate(() => {
    const ff = window.__fungiflush;
    const reg = ff.engine.registry;
    const mk = (id, cost) => {
      const def = reg.getVoucher(id);
      return {
        id: `smoke:${id}`,
        kind: 'voucher',
        refId: def.id,
        nameKey: def.nameKey,
        descKey: def.descKey,
        cost: cost ?? def.cost,
        art: def.art,
        sold: false,
      };
    };
    ff.engine.run.money = 200;
    // `voucher_bulk_deal` aplica 25% de descuento: el precio pintado tiene que
    // ser MENOR que el de lista, y el tachado tiene que estar a la vista.
    ff.engine.run.vouchers = ['voucher_bulk_deal'];
    ff.engine.run.status = 'shop';
    ff.engine.run.shop.offers = [mk('voucher_thin_cut', 20), mk('voucher_sixth_slot', 14)];
    // `refreshPanel` fuerza el redibujado del estado ACTUAL: la tienda ya estaba
    // abierta, asi que sin esto el DOM seguiria mostrando las ofertas viejas.
    ff.hud.refreshPanel();
    return { vouchers: ff.engine.run.vouchers.length };
  });
  // Esperar a que el panel termine su animacion de entrada: un click sobre un
  // panel que todavia se esta abriendo cae en el nodo viejo.
  await page.waitForSelector('.panel.is-shop .offer.is-voucher button', { timeout: 5000 });
  await page.waitForTimeout(900);
  await page.screenshot({ path: join(shotsDir, '19-shop-voucher.png') });
  const dom = await page.evaluate(() => {
    const cards = [...document.querySelectorAll('.panel.is-shop .offer')];
    return {
      total: cards.length,
      vouchers: cards.filter((c) => c.classList.contains('is-voucher')).length,
      // Tiene que decir "Mejora", NO la clave cruda "VOUCHER".
      labels: cards.map((c) => c.querySelector('.offer-kind')?.textContent ?? null),
      // Cada voucher tiene cara compuesta (no un hueco).
      withArt: cards.filter((c) => c.querySelector('img.offer-art')?.src?.startsWith('data:')).length,
      prices: cards.map((c) => ({
        shown: c.querySelector('.offer-price')?.textContent ?? null,
        was: c.querySelector('.offer-price-was')?.textContent ?? null,
      })),
    };
  });

  // Click REAL sobre el BOTON (no sobre la tarjeta): `buyOffer` se dispara solo
  // desde ahi, y tocar la tarjeta no compra nada.
  const button = await page
    .locator('.panel.is-shop .offer.is-voucher')
    .first()
    .locator('button')
    .boundingBox();
  if (button) {
    await page.mouse.click(button.x + button.width / 2, button.y + button.height / 2);
  }
  await page.waitForTimeout(800);

  const bought = await page.evaluate(() => {
    const ff = window.__fungiflush;
    const sold = [...document.querySelectorAll('.panel.is-shop .offer')].find((c) =>
      c.classList.contains('is-sold'),
    );
    return {
      money: ff.engine.run.money,
      vouchers: [...ff.engine.run.vouchers],
      banners: [...document.querySelectorAll('.banner')].map((b) => b.textContent),
      soldIsVoucher: sold?.classList.contains('is-voucher') ?? false,
      soldButton: sold?.querySelector('button')?.textContent ?? null,
      multiplier: ff.engine.modifiers.targetMultiplier ?? 1,
    };
  });
  await page.screenshot({ path: join(shotsDir, '19b-shop-voucher-comprado.png') });

  // `priceOf` es la unica fuente del precio pintado Y del cobro.
  return {
    ...setup,
    ...dom,
    paid: 200 - bought.money,
    vouchersAfter: bought.vouchers.length,
    banners: bought.banners,
    soldIsVoucher: bought.soldIsVoucher,
    soldButton: bought.soldButton,
    multiplier: bought.multiplier,
  };
})();
console.log('\n--- R3: vouchers ---');
console.log(JSON.stringify(voucherShop, null, 2));

// Se vuelve a la tienda de la run para no romper el resto del smoke (el mazo,
// la coleccion y el cambio de idioma asumen que sigue abierta).
await page.evaluate(() => {
  const ff = window.__fungiflush;
  ff.engine.enterShop();
  ff.hud.refreshPanel();
});
await page.waitForTimeout(500);

// --- R1: ascension ---
// El panel de ascension vive en el MENU, asi que se abre desde ahi. Se prueba:
//   1. que el chip del menu aparece y refleja el nivel elegido,
//   2. que el panel dibuja TODOS los niveles del contenido (A0..A(max)),
//   3. que los niveles por encima del desbloqueado van bloqueados,
//   4. que elegir un nivel desbloqueado lo persiste en el perfil y el chip cambia.
const ascensionPanel = await (async () => {
  const setup = await page.evaluate(() => {
    const ff = window.__fungiflush;
    const max = ff.engine.registry.maxAscension();
    // El perfil se fuerza para no depender del progreso previo del navegador.
    ff.profileStore.current.ascension.highestUnlocked = Math.min(3, max);
    ff.profileStore.current.ascension.selected = 0;
    // El menu lee la ascension de un estado que se le EMPUJA: sin este sync el
    // chip no se dibujaria (el HUD no conoce el perfil).
    ff.hud.setAscensionState({
      unlocked: ff.profileStore.current.ascension.highestUnlocked,
      selected: 0,
      max,
    });
    ff.hud.showMenu();
    return { max, unlocked: Math.min(3, max) };
  });
  await page.waitForSelector('.panel.is-menu', { timeout: 5000 });
  await page.waitForTimeout(600);

  // La ascension vive en el panel de Desafios: menu -> Desafios -> Ascension.
  await menuDropAction('challenges');
  await page.waitForSelector('.panel.is-challenges', { timeout: 5000 });

  const chip = await page.evaluate(() => {
    const el = document.querySelector('.panel.is-challenges [data-act="ascension"]');
    return {
      present: Boolean(el),
      label: el?.textContent ?? null,
      active: el?.classList.contains('is-active') ?? false,
    };
  });

  // Abrir el panel con un click REAL sobre la tarjeta.
  const chipBox = await page.locator('.panel.is-challenges [data-act="ascension"]').boundingBox();
  if (chipBox) {
    await page.mouse.click(chipBox.x + chipBox.width / 2, chipBox.y + chipBox.height / 2);
  }
  await page.waitForSelector('.panel.is-ascension .ascension-card', { timeout: 5000 });
  await page.waitForTimeout(600);
  await page.screenshot({ path: join(shotsDir, '20-ascension.png') });

  const list = await page.evaluate(() => {
    const cards = [...document.querySelectorAll('.panel.is-ascension .ascension-card')];
    return {
      levels: cards.map((c) => Number(c.dataset.level)),
      locked: cards.filter((c) => c.classList.contains('is-locked')).length,
      // El texto de los bloqueados tiene que EXPLICAR la condicion, no quedar mudo.
      lockedHelp: cards
        .filter((c) => c.classList.contains('is-locked'))
        .every((c) => (c.querySelector('.ascension-desc')?.textContent ?? '').length > 8),
    };
  });

  // Elegir A2 (desbloqueado) con click real.
  const a2Box = await page
    .locator('.panel.is-ascension .ascension-card[data-level="2"]')
    .boundingBox();
  if (a2Box) {
    await page.mouse.click(a2Box.x + a2Box.width / 2, a2Box.y + a2Box.height / 2);
  }
  await page.waitForTimeout(600);
  const afterPick = await page.evaluate(() => ({
    selected: window.__fungiflush.profileStore.current.ascension.selected,
  }));

  // Cerrar y volver a la tienda para no romper el resto del smoke.
  await page.evaluate(() => {
    const ff = window.__fungiflush;
    ff.hud.closePanel();
    ff.engine.enterShop();
    ff.hud.refreshPanel();
  });
  await page.waitForTimeout(500);

  return { ...setup, ...chip, ...list, selected: afterPick.selected };
})();
console.log('\n--- R1: ascension ---');
console.log(JSON.stringify(ascensionPanel, null, 2));

// --- R4b: cosmeticos (dorso de carta + tapete) ---
const cosmeticsPanel = await (async () => {
  const setup = await page.evaluate(() => {
    const ff = window.__fungiflush;
    // Forzar cosmeticos de prueba para no depender del perfil del navegador.
    ff.profileStore.current.cosmetics.owned = ['default', 'testback', 'testfelt'];
    ff.profileStore.current.cosmetics.equippedCardBack = 'default';
    ff.profileStore.current.cosmetics.equippedFelt = 'default';
    ff.hud.setCosmeticsState({
      owned: ['default', 'testback', 'testfelt'],
      equipped: { cardback: 'default', felt: 'default' },
    });
    ff.hud.showMenu();
    return { owned: 3 };
  });
  await page.waitForSelector('.panel.is-menu', { timeout: 5000 });
  await page.waitForTimeout(400);

  // Los cosmeticos viven en la Coleccion: menu -> Coleccion -> Cosmeticos.
  await menuDropAction('collection');
  await page.waitForSelector('.panel.is-collection', { timeout: 5000 });

  const chip = await page.evaluate(() => {
    const el = document.querySelector('.panel.is-collection [data-act="cosmetics"]');
    return { present: Boolean(el), label: el?.textContent ?? null };
  });

  // Abrir el panel con un click REAL sobre el boton.
  const chipBox = await page.locator('.panel.is-collection [data-act="cosmetics"]').boundingBox();
  if (chipBox) {
    await page.mouse.click(chipBox.x + chipBox.width / 2, chipBox.y + chipBox.height / 2);
  }
  await page.waitForSelector('.panel.is-cosmetics .cosmetics-card', { timeout: 5000 });
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(shotsDir, '21-cosmetics.png') });

  const list = await page.evaluate(() => {
    const cards = [...document.querySelectorAll('.panel.is-cosmetics .cosmetics-card')];
    const sections = [...document.querySelectorAll('.panel.is-cosmetics .cosmetics-section')];
    const withButton = cards.filter((c) => c.querySelector('[data-act="cosmetic-equip"]')).length;
    // Ninguna tarjeta debe quedar con una clave i18n sin resolver (texto t('...'.
    const rawKeys = cards.filter((c) => /t\(['"]/.test(c.textContent ?? '')).length;
    return { total: cards.length, sections: sections.length, withButton, rawKeys };
  });

  // Equipar el dorso de prueba con click real (sin arte: cae al respaldo).
  const eqBox = await page
    .locator('.panel.is-cosmetics [data-act="cosmetic-equip"][data-kind="cardback"][data-id="testback"]')
    .boundingBox();
  if (eqBox) {
    await page.mouse.click(eqBox.x + eqBox.width / 2, eqBox.y + eqBox.height / 2);
  }
  await page.waitForTimeout(400);
  const afterEquip = await page.evaluate(() => ({
    equipped: window.__fungiflush.profileStore.current.cosmetics.equippedCardBack,
    textures: window.__fungiflush.scene.stats().textures,
  }));

  // Cerrar y volver a la tienda para no romper el resto del smoke.
  await page.evaluate(() => {
    const ff = window.__fungiflush;
    ff.hud.closePanel();
    ff.engine.enterShop();
    ff.hud.refreshPanel();
  });
  await page.waitForTimeout(400);

  return { ...setup, ...chip, ...list, equipped: afterEquip.equipped, textures: afterEquip.textures };
})();
console.log('\n--- R4b: cosmeticos ---');
console.log(JSON.stringify(cosmeticsPanel, null, 2));

// --- R5: historial de partidas ---
const historyPanel = await (async () => {
  const setup = await page.evaluate(() => {
    const ff = window.__fungiflush;
    // Historial de prueba inyectado (no dependemos de runs previas del perfil).
    ff.profileStore.current.history = [
      { seed: 4242, ante: 8, ascension: 2, win: true, reason: 'victory', at: 1_700_000_000_000 },
      { seed: 777, ante: 3, ascension: 0, win: false, reason: 'loss', at: 1_699_000_000_000 },
    ];
    ff.hud.setHistoryState(ff.profileStore.current.history.map((h) => ({ ...h })));
    ff.hud.showMenu();
    return { seeded: 2 };
  });
  await page.waitForSelector('.panel.is-menu', { timeout: 5000 });
  await page.waitForTimeout(400);

  // El historial vive en el Perfil: menu -> Perfil -> Historial.
  await subPanelAction('.panel.is-menu', 'profile');
  await page.waitForSelector('.panel.is-profile', { timeout: 5000 });

  const chip = await page.evaluate(() => {
    const el = document.querySelector('.panel.is-profile [data-act="history"]');
    return { present: Boolean(el), label: el?.textContent ?? null };
  });

  // Abrir el panel con un click REAL sobre la tarjeta.
  const chipBox = await page.locator('.panel.is-profile [data-act="history"]').boundingBox();
  if (chipBox) {
    await page.mouse.click(chipBox.x + chipBox.width / 2, chipBox.y + chipBox.height / 2);
  }
  await page.waitForSelector('.panel.is-history .history-row', { timeout: 5000 });
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(shotsDir, '22-history.png') });

  const rows = await page.evaluate(() => {
    const list = [...document.querySelectorAll('.panel.is-history .history-row')];
    return {
      total: list.length,
      wins: list.filter((r) => r.classList.contains('is-win')).length,
      losses: list.filter((r) => r.classList.contains('is-loss')).length,
      // Ninguna fila debe quedar con una clave i18n sin resolver.
      rawKeys: list.filter((r) => /t\(['"]/.test(r.textContent ?? '')).length,
      firstSeed: list[0]?.dataset['seed'] ?? null,
    };
  });

  // Cerrar y volver a la tienda para no romper el resto del smoke.
  await page.evaluate(() => {
    const ff = window.__fungiflush;
    ff.hud.closePanel();
    ff.engine.enterShop();
    ff.hud.refreshPanel();
  });
  await page.waitForTimeout(400);

  return { ...setup, ...chip, ...rows };
})();
console.log('\n--- R5: historial ---');
console.log(JSON.stringify(historyPanel, null, 2));


const deckBuilder = await page.evaluate(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  document.querySelector('.panel.is-shop [data-act="deck"]')?.click();
  await wait(500);
  const opened = Boolean(document.querySelector('.panel.is-deck'));
  // El mazo ahora vive en el CARRUSEL 3D: las cartas no son nodos DOM, asi que
  // se cuentan por el estado del carrusel (mismo intento: "el panel lista el mazo").
  const cards = window.__fungiflush.scene.carouselState()?.count ?? 0;
  // El viewport del smoke es tactil (pointer: coarse): con el mazo abierto el
  // cromo de la partida TIENE que apagarse o se dibuja encima del carrusel
  // (era el bug de Reordenar.PNG: score tapando "Mazo" y misiones cortadas).
  // Se comprueba por `display`, que es lo que decide el CSS.
  const hudVisible = {};
  for (const sel of ['.hud-top', '.hud-jokers', '.hud-missions-toggle', '.hud-bottom']) {
    const el = document.querySelector(sel);
    hudVisible[sel] = el ? getComputedStyle(el).display !== 'none' : null;
  }
  const before = window.__fungiflush.engine.run.deck.totalSize;
  document.querySelector('.panel.is-deck [data-act="purge"]')?.click();
  await wait(500);
  const after = window.__fungiflush.engine.run.deck.totalSize;
  return { opened, cards, before, after, purged: before - after, hudVisible };
});
console.log('\n--- Constructor de mazo (purgar) ---');
console.log(JSON.stringify(deckBuilder, null, 2));
await page.screenshot({ path: join(shotsDir, '09-deck.png') });

// --- Cultivo: mejorar una carta y evolucionar otra ---
// Se usa el CARRUSEL (el camino real del jugador: tienda -> Mazo), no la grilla
// DOM. Al mejorar, `doUpgrade` vuelve a abrir el mazo: hay que comprobar que
// (a) el detalle muestra Sustrato/Esporas con su aumento y (b) el anillo se
// queda en la MISMA carta en vez de saltar al indice 0.
const upgradeStep = await page.evaluate(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const engine = window.__fungiflush.engine;
  engine.run.money = Math.max(engine.run.money, 300);

  // El CARRUSEL se abre desde el boton Mazo de la tienda (`openDeck` en
  // main.ts). `hud.showDeckBuilder()` abre la grilla DOM, que NO tiene detalle.
  document.querySelector('.panel.is-shop [data-act="deck"]')?.click();
  await wait(600);

  const gen = engine.run.deck.allCards.length;
  const car = window.__fungiflush.scene?.carousel ?? null;
  // Foco en una carta que NO sea la primera, para que el "salto al 0" se note.
  if (car) car.focus(Math.min(6, gen - 1));

  const readDetail = () => {
    const detail = document.querySelector('.panel.is-deck .carousel-detail');
    if (!detail) return null;
    return {
      name: detail.querySelector('.carousel-detail-name')?.textContent?.trim() ?? null,
      stats: (detail.querySelector('.carousel-detail-stats')?.textContent ?? '').replace(/\s+/g, '').trim(),
    };
  };

  // El detalle se pinta desde el bucle de render (el anillo notifica el foco),
  // asi que "leer apenas se mueve el anillo" es una carrera: a 12 FPS el DOM
  // todavia muestra la carta anterior. Se espera a que el detalle muestre la
  // carta enfocada de verdad, y recien ahi se lee.
  const focusedUid = () => car?.entries?.[car.focusedIndex]?.uid ?? null;
  for (let i = 0; i < 40; i++) {
    await wait(100);
    const d = readDetail();
    const want = focusedUid();
    const btn = document.querySelector('.panel.is-deck [data-act="upgrade"]');
    if (d && d.name && d.stats && want && btn?.dataset.uid === want) break;
  }

  const button = document.querySelector('.panel.is-deck [data-act="upgrade"]');
  const uid = button?.dataset.uid ?? null;
  const target = engine.run.deck.allCards.find((c) => c.uid === uid) ?? null;
  const before = { level: target?.level ?? 0, money: engine.run.money };

  const detailBefore = readDetail();
  const focusBefore = car ? car.focusedIndex : null;

  button?.click();
  // Mismo problema de carrera al volver: `doUpgrade` reabre el mazo y hay que
  // esperar a que el detalle vuelva a pintar la carta mejorada.
  for (let i = 0; i < 40; i++) {
    await wait(100);
    const d = readDetail();
    const btn = document.querySelector('.panel.is-deck [data-act="upgrade"]');
    if (d && d.name === detailBefore?.name && btn?.dataset.uid === uid) break;
  }

  const after = engine.run.deck.allCards.find((c) => c.uid === uid) ?? null;
  const detailAfter = readDetail();
  const focusAfter = window.__fungiflush.scene?.carousel?.focusedIndex ?? null;
  return {
    uid,
    levelBefore: before.level,
    levelAfter: after?.level ?? 0,
    moneySpent: before.money - engine.run.money,
    statsUpgraded: engine.run.stats.cardsUpgraded,
    // P2/Deck (a): el detalle SIEMPRE trae Sustrato/Esporas y cambian al mejorar.
    statsBefore: detailBefore?.stats ?? null,
    statsAfter: detailAfter?.stats ?? null,
    statsShown: Boolean(detailBefore?.stats && detailBefore.stats.length > 0),
    statsChanged: Boolean(detailBefore?.stats && detailAfter?.stats && detailBefore.stats !== detailAfter.stats),
    // P2/Deck (b): el foco se queda en la carta mejorada.
    nameBefore: detailBefore?.name ?? null,
    nameAfter: detailAfter?.name ?? null,
    focusBefore,
    focusAfter,
    focusKept: Boolean(detailBefore?.name && detailBefore.name === detailAfter?.name),
  };
});
console.log('\n--- Cultivo: mejorar ---');
console.log(JSON.stringify(upgradeStep, null, 2));
await page.screenshot({ path: join(shotsDir, '10-upgrade.png') });

// Tocar la carta CENTRADA del anillo tiene que abrir su detalle. Antes el gesto
// moria en silencio (el foco no cambia -> `onFocusChange` no dispara). El
// carrusel del mazo gira con el foco en una carta NO primera, asi que tocar el
// centro cambia el detalle a la entrada enfocada; se verifica contra el estado
// del carrusel, no contra un nombre fijo.
const carouselTap = await page.evaluate(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const deckPanel = document.querySelector('.panel.is-deck');
  if (!deckPanel) return { skipped: 'no hay mazo abierto' };
  const scene = window.__fungiflush.scene;
  const car = scene?.carousel ?? null;
  if (!car) return { skipped: 'no hay carrusel' };

  // Se gira a una carta que NO sea la primera: asi "tocar el centro" tiene algo
  // que abrir y el resultado no coincide con el foco inicial por casualidad.
  const target = Math.min(5, (car.count ?? 2) - 1);
  car.focusAbs(target);
  // Se espera a que se cumplan TODAS las precondiciones del gesto:
  //   - el boton de mejorar y el DETALLE (los pinta el bucle de render)
  //   - y, sobre todo, que `carouselFocusedScreenPoint()` devuelva un punto.
  // El puntero proyectado depende de que el carrusel este ACTIVO y de que la
  // carta enfocada ya tenga `group.visible` (se re-layouta tras `focusAbs`). Si
  // se lee antes, da null y la seccion se saltaba `{skipped}` -> la asercion
  // `detailPresent` caia sin decir por que. Esperar por el punto elimina el
  // flake.
  let pt = null;
  for (let i = 0; i < 60; i++) {
    await wait(100);
    const ready =
      document.querySelector('.panel.is-deck [data-act="upgrade"]') &&
      document.querySelector('.panel.is-deck .carousel-detail');
    pt = scene.carouselFocusedScreenPoint();
    if (ready && pt) break;
  }
  const focusedUid = car.currentEntries?.[car.focusedIndex]?.uid ?? null;

  // El punto a tocar es el centro PROYECTADO de la carta enfocada, no el centro
  // del canvas: el encuadre del anillo baja la carta para dejar lugar al panel,
  // asi que tocar el medio geometrico agarra una vecina.
  const rect = scene.renderer.domElement.getBoundingClientRect();
  if (!pt) return { skipped: 'sin punto proyectado', carouselActive: scene.carouselActive ?? null };
  const cx = rect.left + pt.x;
  const cy = rect.top + pt.y;
  const el = scene.renderer.domElement;
  const opts = { bubbles: true, cancelable: true, pointerId: 1, pointerType: 'mouse', clientX: cx, clientY: cy };
  el.dispatchEvent(new PointerEvent('pointerdown', opts));
  el.dispatchEvent(new PointerEvent('pointerup', opts));
  await wait(400);

  // El detalle lo repinta el bucle de render tras el toque: se le da un margen
  // corto si todavia no esta, en vez de leer una sola vez y arriesgar un flake.
  let detail = document.querySelector('.panel.is-deck .carousel-detail');
  for (let i = 0; i < 10 && !detail; i++) {
    await wait(100);
    detail = document.querySelector('.panel.is-deck .carousel-detail');
  }
  const shownName = detail?.querySelector('.carousel-detail-name')?.textContent?.trim() ?? null;
  const entryUid = car.currentEntries?.[car.focusedIndex]?.uid ?? null;
  return {
    focusedUid,
    entryUid,
    shownName,
    focus: car.focusedIndex,
    // El detalle sigue a la carta enfocada: tocar el centro no rompe nada.
    detailPresent: Boolean(detail),
    matchesFocus: Boolean(entryUid && focusedUid && entryUid === focusedUid),
  };
});
console.log('\n--- Carrusel: tocar la carta centrada abre el detalle ---');
console.log(JSON.stringify(carouselTap, null, 2));

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

// ===========================================================================
// Post-procesamiento (V1) — carga aparte, con el tier alto forzado
// ===========================================================================
// Va al FINAL y no comparte ninguna asercion de tiempo con el resto: con el
// composer encima, bajo render por software los FPS caen y las esperas de las
// otras pruebas (que asumen los ~12 FPS del baseline) dejarian de ser validas.
// Aca solo se afirma que el camino ARRANCA y que el reparto de draw calls es el
// esperado. Que se vea bien se juzga mirando la captura, no con un assert.

// `daily=0` por el mismo motivo que arriba: esta recarga usa el MISMO perfil,
// y como en la primer carga no se reclamo, el modal volveria a abrirse.
await page.goto(`${URL_TO_TEST.replace(/\?.*$/, '')}?quality=high&daily=0`, {
  waitUntil: 'load',
  timeout: 45000,
});
const fxReady = await page
  .waitForFunction(() => Boolean(window.__fungiflush?.scene), { timeout: 30000 })
  .then(() => true)
  .catch(() => false);
// Con composer hay que dejar asentar el primer frame: los render targets se
// crean en el constructor y el primer resize los dimensiona.
await page.waitForTimeout(5000);

const postFx = await page.evaluate(() => {
  const ff = window.__fungiflush;
  const quality = ff.quality();
  const stats = ff.scene.stats();
  const canvas = document.getElementById('fungiflush-canvas');
  return {
    tier: quality.tier,
    reason: quality.reason,
    composer: quality.composer,
    bloom: quality.bloom,
    gradeMix: quality.gradeMix,
    drawCalls: stats.drawCalls,
    drawCallsTotal: stats.drawCallsTotal,
    programs: stats.programs,
    gpuTextures: stats.gpuTextures,
    particles: stats.particles,
    canvas: canvas ? `${canvas.width}x${canvas.height}` : 'sin canvas',
  };
});
console.log('\n--- Post-procesamiento (tier alto) ---');
console.log(JSON.stringify(postFx, null, 2));
await page.screenshot({ path: join(shotsDir, '18a-postfx-menu.png') });

// Entrar a una partida: el bloom se juzga sobre las cartas y sus halos, no
// sobre el panel del menu (que tapa media escena con un fondo casi opaco).
// "Nueva partida" abre el selector de arquetipo: se confirma con el boton
// "start" (mismo recorrido que arriba) para llegar a la partida de verdad.
await page.evaluate(() => document.querySelector('.panel.is-menu [data-act="new"]')?.click());
await page.waitForTimeout(600);
await page.evaluate(() => document.querySelector('.panel.is-archetypes [data-act="archetypes-start"]')?.click());
await page.waitForTimeout(2000);
await page.evaluate(() => {
  const ff = window.__fungiflush;
  ff.engine.chooseBlind(ff.engine.availableBlinds()[1]?.id);
});
await page.waitForTimeout(5000);
await page.screenshot({ path: join(shotsDir, '18-postfx-high.png') });

const fxPlaying = await page.evaluate(() => {
  const ff = window.__fungiflush;
  const stats = ff.scene.stats();
  const round = ff.engine.round;
  return {
    status: ff.engine.run.status,
    hand: round?.hand.length ?? 0,
    jokers: ff.engine.run.jokers.length,
    drawCalls: stats.drawCalls,
    // La sombra de contacto es UN draw call para todas las cartas, pero el
    // conteo de instancias tiene que seguir a las cartas vivas.
    shadows: stats.shadows,
  };
});
console.log('\n--- Post-procesamiento: en partida ---');
console.log(JSON.stringify(fxPlaying, null, 2));

// FPS con el composer, para tener el COCIENTE contra el baseline. Bajo render
// por software el valor absoluto no significa nada; la relacion si.
const fpsHigh = await page.evaluate(
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
console.log(`FPS con post-procesamiento: ${fpsHigh} (baseline sin el: ${fps})`);
// OJO con este numero: SwiftShader no tiene GPU, asi que los pases de pantalla
// completa se ejecutan en CPU y el cociente sale enorme. En una GPU real tres
// pases a resolucion completa son ruido. Sirve para detectar que algo se
// disparo, NO como estimacion del costo en un celular.
console.log(`Costo relativo del composer (solo informativo, render por software): ${(fps / Math.max(1, fpsHigh)).toFixed(2)}x`);

// ===========================================================================
// Fase — SALIDA AL MENU desde la partida (con confirmacion)
// ===========================================================================
// El boton vive en la barra superior. Se prueba el ciclo COMPLETO: abrir el
// panel, cancelar (no debe salir) y confirmar (debe volver al menu). Sin el
// paso de cancelar, un bug donde "Cancelar" sale igual pasaria desapercibido.
const quitButtonExists = await page.evaluate(
  () => document.querySelector('[data-act="quit-to-menu"]') !== null,
);

// 1) Abrir el panel de confirmacion.
await page.evaluate(() => document.querySelector('[data-act="quit-to-menu"]')?.click());
await page.waitForTimeout(400);
const quitPanel = await page.evaluate(() => ({
  status: window.__fungiflush.engine.run.status,
  panel: document.querySelector('.panel.is-confirm') !== null,
  cancel: document.querySelector('[data-act="quit-cancel"]') !== null,
  confirm: document.querySelector('[data-act="quit-confirm"]') !== null,
}));

// 2) Cancelar: la partida sigue viva y el panel se cierra.
await page.evaluate(() => document.querySelector('[data-act="quit-cancel"]')?.click());
// El panel cierra con ANIMACION (`--dur-base`): el nodo sigue en el DOM mientras
// corre `panel-out` y recien despues se lo saca. Un `waitForTimeout` fijo de
// 400ms competia con la animacion y a veces la leia todavia montada (flake de
// "afterCancel panel cerrado"). Se POLLEA hasta que desaparezca.
await page
  .waitForFunction(() => document.querySelector('.panel.is-confirm') === null, { timeout: 5000 })
  .catch(() => {});
const afterCancel = await page.evaluate(() => ({
  status: window.__fungiflush.engine.run.status,
  panel: document.querySelector('.panel.is-confirm') !== null,
}));

// 3) Confirmar: vuelve al menu principal.
await page.evaluate(() => document.querySelector('[data-act="quit-to-menu"]')?.click());
await page.waitForTimeout(400);
await page.evaluate(() => document.querySelector('[data-act="quit-confirm"]')?.click());
// Mismo motivo que arriba: se espera al MENU, no a un tiempo fijo.
await page
  .waitForFunction(
    () =>
      window.__fungiflush.engine.run.status === 'menu' &&
      document.querySelector('.panel.is-menu') !== null,
    { timeout: 8000 },
  )
  .catch(() => {});
const afterQuit = await page.evaluate(() => ({
  status: window.__fungiflush.engine.run.status,
  menuPanel: document.querySelector('.panel.is-menu') !== null,
}));
console.log('\n--- Salida al menu ---');
console.log(JSON.stringify({ quitButtonExists, quitPanel, afterCancel, afterQuit }, null, 2));

// --- Reporte ---
console.log('\n================ REPORTE ================');
const realErrors = consoleErrors.filter((e) => !e.includes('favicon'));
console.log(`Errores de consola : ${realErrors.length}`);
for (const error of realErrors.slice(0, 10)) console.log(`  ✗ ${error}`);
console.log(`Excepciones        : ${pageErrors.length}`);
for (const error of pageErrors.slice(0, 10)) console.log(`  ✗ ${error}`);
console.log(`Avisos             : ${consoleWarnings.length}`);
for (const warning of consoleWarnings.slice(0, 5)) console.log(`  ! ${warning}`);

const CHECKS = [];
const chk = (name, cond) => { CHECKS.push([name, !!cond]); return !!cond; };

const ok =
  chk('ready', ready) &&
  chk('reward.status', reward?.status === 'reward') &&
  chk('reward.panel', reward?.panel === true) &&
  chk('reward?.offers.length === 3', reward?.offers.length === 3) &&
  chk("afterWin?.status === 'shop'", afterWin?.status === 'shop') &&
  chk('(afterWin?.deckAfter ?? 0) === (reward?.deckBe', (afterWin?.deckAfter ?? 0) === (reward?.deckBefore ?? 0) + 1) &&
  chk('deckBuilder?.opened === true', deckBuilder?.opened === true) &&
  chk('(deckBuilder?.cards ?? 0) > 0', (deckBuilder?.cards ?? 0) > 0) &&
  chk('deckBuilder?.purged === 1', deckBuilder?.purged === 1) &&
  // Con el mazo abierto en tactil, el cromo de la partida se apaga: si no, el
  // score se dibuja ENCIMA del titulo "Mazo" y las misiones se cortan contra la
  // barra inferior (bug de Reordenar.PNG).
  chk('deckBuilder?.hudHidden.hudTop === false', deckBuilder?.hudVisible?.['.hud-top'] === false) &&
  chk('deckBuilder?.hudHidden.hudJokers === fal', deckBuilder?.hudVisible?.['.hud-jokers'] === false) &&
  chk('deckBuilder?.hudHidden.hudMiss === false', deckBuilder?.hudVisible?.['.hud-missions-toggle'] === false) &&
  chk('deckBuilder?.hudHidden.hudBottom === fa', deckBuilder?.hudVisible?.['.hud-bottom'] === false) &&
  chk('upgradeStep?.uid !== null', upgradeStep?.uid !== null) &&
  chk('upgradeStep?.levelAfter === (upgradeStep?.leve', upgradeStep?.levelAfter === (upgradeStep?.levelBefore ?? 0) + 1) &&
  chk('(upgradeStep?.moneySpent ?? 0) > 0', (upgradeStep?.moneySpent ?? 0) > 0) &&
  chk('upgradeStep?.statsUpgraded >= 1', upgradeStep?.statsUpgraded >= 1) &&
  chk('upgradeStep?.statsShown === true', upgradeStep?.statsShown === true) &&
  chk('upgradeStep?.statsChanged === true', upgradeStep?.statsChanged === true) &&
  chk('upgradeStep?.focusKept === true', upgradeStep?.focusKept === true) &&
  // Tocar la carta CENTRADA del anillo abre su detalle (antes el gesto moria).
  chk('carouselTap?.detailPresent === true', carouselTap?.detailPresent === true) &&
  chk('carouselTap?.matchesFocus === true', carouselTap?.matchesFocus === true) &&
  chk('evolveStep?.enabled === true', evolveStep?.enabled === true) &&
  chk("evolveStep?.defAfter === 'spore_giant_puffball", evolveStep?.defAfter === 'spore_giant_puffball') &&
  chk('evolveStep?.uidPreserved === true', evolveStep?.uidPreserved === true) &&
  chk('evolveStep?.levelCarried === 3', evolveStep?.levelCarried === 3) &&
  chk("evolveStep?.evolvedFrom === 'spore_puffball'", evolveStep?.evolvedFrom === 'spore_puffball') &&
  chk('evolveStep?.statsEvolved >= 1', evolveStep?.statsEvolved >= 1) &&
  chk('collectionOpened?.panel === true', collectionOpened?.panel === true) &&
  chk('(collectionOpened?.entries ?? 0) > 0', (collectionOpened?.entries ?? 0) > 0) &&
  chk('collectionOpened?.undiscovered > 0', collectionOpened?.undiscovered > 0) &&
  chk('collectionClosed?.backToShop === true', collectionClosed?.backToShop === true) &&
  chk("menuState?.status === 'menu'", menuState?.status === 'menu') &&
  chk('menuState?.menuVisible === true', menuState?.menuVisible === true) &&
  chk('menuState?.hudHidden === true', menuState?.hudHidden === true) &&
  chk('menuState?.particles === 0', menuState?.particles === 0) &&
  chk('menuState?.continueEnabled === false', menuState?.continueEnabled === false) &&
  chk('settingsOpened?.opened === true', settingsOpened?.opened === true) &&
  // 9 campos: idioma, reducir movimiento, ORDEN AUTO (Fase 3), calidad, vibracion,
  // 2 de avisos, 2 de volumen.
  chk('settingsOpened?.fields === 9', settingsOpened?.fields === 9) &&
  // --- Calidad grafica (V0) ---
  chk("qualityBoot?.tier === 'low'", qualityBoot?.tier === 'low') &&
  chk("qualityBoot?.reason === 'software'", qualityBoot?.reason === 'software') &&
  chk('qualityBoot?.composer === false', qualityBoot?.composer === false) &&
  chk('qualityBoot?.bloom === false', qualityBoot?.bloom === false) &&
  chk('qualityBoot?.segments === 4', qualityBoot?.segments === 4) &&
  chk("qualityBoot?.active === 'auto'", qualityBoot?.active === 'auto') &&
  chk("qualitySwitch?.high?.tier === 'high'", qualitySwitch?.high?.tier === 'high') &&
  chk("qualitySwitch?.high?.active === 'high'", qualitySwitch?.high?.active === 'high') &&
  chk("qualitySwitch?.auto?.tier === 'low'", qualitySwitch?.auto?.tier === 'low') &&
  chk("qualitySwitch?.auto?.reason === 'software'", qualitySwitch?.auto?.reason === 'software') &&
  chk("qualitySwitch?.auto?.persisted === 'auto'", qualitySwitch?.auto?.persisted === 'auto') &&
  chk('settingsRoundTrip?.backToMenu === true', settingsRoundTrip?.backToMenu === true) &&
  // --- Fase 5: duelo micelial ---
  chk('boardChunkBeforeOpen === 0', boardChunkBeforeOpen === 0) &&
  chk('boardChunkAfterOpen > 0', boardChunkAfterOpen > 0) &&
  chk('boardOpened?.panel === true', boardOpened?.panel === true) &&
  chk('boardOpened?.cells === 16', boardOpened?.cells === 16) &&
  chk('boardOpened?.curtain === true', boardOpened?.curtain === true) &&
  chk('boardOpened?.handSize > 0', boardOpened?.handSize > 0) &&
  chk('boardOpened?.handChips === 0', boardOpened?.handChips === 0) &&
  chk('afterTurn?.turn === 1', afterTurn?.turn === 1) &&
  chk('afterTurn?.placed === 1', afterTurn?.placed === 1) &&
  chk('afterTurn?.logEntries > 0', afterTurn?.logEntries > 0) &&
  chk('afterTurn?.curtainBack === true', afterTurn?.curtainBack === true) &&
  chk('hiddenInfo?.rivalCards > 0', hiddenInfo?.rivalCards > 0) &&
  chk('(hiddenInfo?.leaked?.length ?? 1) === 0', (hiddenInfo?.leaked?.length ?? 1) === 0) &&
  chk('hiddenInfo?.handChips === 0', hiddenInfo?.handChips === 0) &&
  chk("boardFinished?.status === 'finished'", boardFinished?.status === 'finished') &&
  chk('boardFinished?.filled > 0', boardFinished?.filled > 0) &&
  chk('boardFinished?.result !== null', boardFinished?.result !== null) &&
  chk('boardFinished?.rematch === true', boardFinished?.rematch === true) &&
  chk('boardClosed?.backToMenu === true', boardClosed?.backToMenu === true) &&
  chk('boardClosed?.boardGone === true', boardClosed?.boardGone === true) &&
  // --- Post-procesamiento (V1) ---
  chk('fxReady === true', fxReady === true) &&
  chk("postFx?.tier === 'high'", postFx?.tier === 'high') &&
  chk('postFx?.composer === true', postFx?.composer === true) &&
  chk('postFx?.bloom === true', postFx?.bloom === true) &&
  chk('postFx?.gradeMix === 1', postFx?.gradeMix === 1) &&
  chk('postFx?.drawCalls > 0', postFx?.drawCalls > 0) &&
  chk('postFx?.drawCallsTotal > postFx?.drawCalls', postFx?.drawCallsTotal > postFx?.drawCalls) &&
  // El camino con post-procesamiento NO debe inflar los draw calls de escena.
  // El tier alto agrega cosas legitimas sobre el baseline de `low`: el sky dome
  // (+1), el agua (+1) y las sombras de contacto (+1). Con el techo en +4 la
  // asercion pasaba por IGUALDAD exacta y el smoke fallaba de forma
  // intermitente; +8 deja aire sin dejar de detectar una inflacion real.
  chk('fxPlaying?.drawCalls <= (afterBlind?.drawCalls', fxPlaying?.drawCalls <= (afterBlind?.drawCalls ?? 0) + 8) &&
  chk("fxPlaying?.status === 'playing'", fxPlaying?.status === 'playing') &&
  chk('(fxPlaying?.hand ?? 0) > 0', (fxPlaying?.hand ?? 0) > 0) &&
  chk('fxPlaying?.shadows === (fxPlaying?.hand ?? 0) ', fxPlaying?.shadows === (fxPlaying?.hand ?? 0) + (fxPlaying?.jokers ?? 0)) &&
  // Las esporas de ambiente del tier alto: son 900 y las calcula la GPU.
  chk('(postFx?.particles ?? 0) >= 900', (postFx?.particles ?? 0) >= 900) &&
  chk("afterStart?.status === 'blind_select'", afterStart?.status === 'blind_select') &&
  chk('tutorialStep?.shown === true', tutorialStep?.shown === true) &&
  chk('tutorialStep?.hasClose === true', tutorialStep?.hasClose === true) &&
  chk('tutorialStep?.steps === 4', tutorialStep?.steps === 4) &&
  chk('tutorialStep?.stats === 4', tutorialStep?.stats === 4) &&
  // Guia v2: glosario de Sustrato/Esporas/Combos + Bonus, con cuerpo scrolleable.
  chk('tutorialStep?.sections === 4', tutorialStep?.sections === 4) &&
  chk('(tutorialStep?.rows ?? 0) >= 8', (tutorialStep?.rows ?? 0) >= 8) &&
  chk('tutorialStep?.hasBody === true', tutorialStep?.hasBody === true) &&
  chk('afterStart?.tutorialDismissed === true', afterStart?.tutorialDismissed === true) &&
  chk('afterStart?.blindSelectVisible === true', afterStart?.blindSelectVisible === true) &&
  chk('afterStart?.hudHidden === false', afterStart?.hudHidden === false) &&
  chk(
    'afterStart?.engineDeckSize === afterStart?.expectedDeckSize',
    afterStart?.engineDeckSize === afterStart?.expectedDeckSize,
  ) &&
  // El panel de ciego entra entero en el viewport tactil, sin scroll.
  chk('(afterStart?.blindPanelFit?.overflowViewport ?? 99) <= 0', (afterStart?.blindPanelFit?.overflowViewport ?? 99) <= 0) &&
  chk('(afterStart?.blindPanelFit?.scrollOverflow ?? 99) <= 0', (afterStart?.blindPanelFit?.scrollOverflow ?? 99) <= 0) &&
  // --- Dado: ya NO se arma en el flujo de ciego. Se movio a la habilidad del
  //     Simbionte legendario "Dado Cargado" (multiplicador directo cada 2
  //     manos). El smoke solo documenta que el ciego arranca sin dado armado.
  chk('die no armado en blind_select (removido del flujo)', dieArmed?.state?.armed !== true) &&
  // --- Tienda: la oferta comprada queda VENDIDA en el DOM ---
  chk('shopBuy?.clicked === true', shopBuy?.clicked === true) &&
  chk('(shopBuy?.offersBefore ?? 0) >= 1', (shopBuy?.offersBefore ?? 0) >= 1) &&
  chk('shopBuy?.vendidas === 1', shopBuy?.vendidas === 1) &&
  chk("shopBuy?.boton === 'VENDIDO'", shopBuy?.boton === 'VENDIDO') &&
  chk('shopBuy?.deshabilitado === true', shopBuy?.deshabilitado === true) &&
  chk('shopBuy?.sello === true', shopBuy?.sello === true) &&
  chk('(shopBuy?.toasts ?? []).length === 0', (shopBuy?.toasts ?? []).length === 0) &&
  // --- R3: vouchers ---
  chk('voucherShop?.vouchers === 2', voucherShop?.vouchers === 2) &&
  chk("voucherShop?.labels?.includes('Mejora') === tr", voucherShop?.labels?.includes('Mejora') === true) &&
  chk("voucherShop?.labels?.includes('VOUCHER') === f", voucherShop?.labels?.includes('VOUCHER') === false) &&
  chk('voucherShop?.withArt === 2', voucherShop?.withArt === 2) &&
  chk('voucherShop?.prices?.length === 2', voucherShop?.prices?.length === 2) &&
  chk('Number(voucherShop?.prices?.[0]?.shown) < Numb', Number(voucherShop?.prices?.[0]?.shown) < Number(voucherShop?.prices?.[0]?.was)) &&
  chk("voucherShop?.prices?.[0]?.was === '20'", voucherShop?.prices?.[0]?.was === '20') &&
  // 20 con 25% de descuento: el mismo numero que `priceOf` y el que se cobra.
  chk('voucherShop?.paid === 15', voucherShop?.paid === 15) &&
  chk('voucherShop?.vouchersAfter === 2', voucherShop?.vouchersAfter === 2) &&
  chk('voucherShop?.soldIsVoucher === true', voucherShop?.soldIsVoucher === true) &&
  chk("voucherShop?.soldButton === 'VENDIDO'", voucherShop?.soldButton === 'VENDIDO') &&
  chk('Math.abs((voucherShop?.multiplier ?? 1) - 0.9)', Math.abs((voucherShop?.multiplier ?? 1) - 0.9) < 1e-6) &&
  // --- R1: ascension ---
  // Chip visible y sin marcar (el nivel puesto es A0 al arrancar el bloque).
  chk('ascensionPanel?.present === true', ascensionPanel?.present === true) &&
  chk('ascensionPanel?.active === false', ascensionPanel?.active === false) &&
  // El panel lista TODOS los niveles del contenido: A0..A(max).
  chk('ascensionPanel?.levels?.length === ascensionPa', ascensionPanel?.levels?.length === ascensionPanel?.max + 1) &&
  chk('ascensionPanel?.levels?.[0] === 0', ascensionPanel?.levels?.[0] === 0) &&
  // Con 3 desbloqueados: A0..A3 libres y el resto bloqueados.
  chk('ascensionPanel?.locked === ascensionPanel?.max', ascensionPanel?.locked === ascensionPanel?.max - ascensionPanel?.unlocked) &&
  // Los bloqueados EXPLICAN la condicion (no un candado mudo).
  chk('ascensionPanel?.lockedHelp === true', ascensionPanel?.lockedHelp === true) &&
  // Elegir A2 lo persiste en el perfil.
  chk('ascensionPanel?.selected === 2', ascensionPanel?.selected === 2) &&
  // --- Ficha de joker: señalar NO vende, vender pide confirmacion ---
  chk('jokerChip?.tieneBotonVender === true', jokerChip?.tieneBotonVender === true) &&
  // El boton VENDER no puede quedar TAPADO por cromo del HUD: si algo se le
  // monta encima, el toque se pierde (bug real de la franja de misiones con
  // `pointer-events: auto`). Se verifica con hit-test, no con geometria.
  chk('jokerChip?.sellHittable?.isSell === true', jokerChip?.sellHittable?.isSell === true) &&
  chk('jokerChip?.trasTocarElCuerpo === jokerChip?.an', jokerChip?.trasTocarElCuerpo === jokerChip?.antes) &&
  chk('jokerChip?.confirmandoTrasElCuerpo === false', jokerChip?.confirmandoTrasElCuerpo === false) &&
  chk('jokerChip?.primerToqueEnVender?.jokers === jok', jokerChip?.primerToqueEnVender?.jokers === jokerChip?.antes) &&
  chk('jokerChip?.primerToqueEnVender?.confirmando ==', jokerChip?.primerToqueEnVender?.confirmando === true) &&
  // P6: ranuras fijas de Simbionte, del tamano de una carta normal.
  chk('jokerSlotsGuard?.matchesEngine === true', jokerSlotsGuard?.matchesEngine === true) &&
  chk('jokerSlotsGuard?.sizesOk === true', jokerSlotsGuard?.sizesOk === true) &&
  chk('jokerSlotsGuard?.grewOnPlusOne === true', jokerSlotsGuard?.grewOnPlusOne === true) &&
  chk("menuState?.webgl === 'contexto activo'", menuState?.webgl === 'contexto activo') &&
  chk('(afterBlind?.sceneHand ?? 0) > 0', (afterBlind?.sceneHand ?? 0) > 0) &&
  chk('(afterBlind?.hand ?? 0) > 0', (afterBlind?.hand ?? 0) > 0) &&
  // El chip MAZO ahora es "disponible / total": al empezar el ciego nada se
  // consumio todavia, asi que arranca en el total (N/N) y baja al jugar. El
  // total depende del arquetipo, por eso se compara contra `expectedDeckSize`.
  chk(
    "afterBlind?.chipDeckTotal === String(afterBlind?.expectedDeckSize)",
    afterBlind?.chipDeckTotal === String(afterBlind?.expectedDeckSize),
  ) &&
  chk(
    'afterBlind?.chipDeck = `${robables}/${total}`',
    afterBlind?.chipDeck === `${afterBlind?.deckDrawPile}/${afterBlind?.expectedDeckSize}`,
  ) &&
  chk(
    'afterBlind?.deckSize === afterBlind?.expectedDeckSize',
    afterBlind?.deckSize === afterBlind?.expectedDeckSize,
  ) &&
  // Robables = pila de robo = total - mano (al abrir el ciego no hay descarte).
  chk(
    'afterBlind?.deckDrawPile + hand = total',
    (afterBlind?.deckDrawPile ?? -1) + (afterBlind?.hand ?? 0) === afterBlind?.expectedDeckSize,
  ) &&
  chk(
    'afterBlind?.deckDraw === afterBlind?.expectedDeckSize',
    afterBlind?.deckDraw === afterBlind?.expectedDeckSize,
  ) &&
  // Etiquetas de pila: las DOS visibles, con el nombre y el conteo.
  chk(
    'afterBlind?.pileLabels: 2 etiquetas visibles (mazo y descarte)',
    afterBlind?.pileLabels?.length === 2,
  ) &&
  // Misiones tactiles: ninguna se corta contra la barra inferior (el bloque
  // entero entra en su franja).
  chk('(afterBlind?.missionsClip?.overflow ?? 1) <= 0', (afterBlind?.missionsClip?.overflow ?? 1) <= 0) &&
  chk('(afterBlind?.missionsClip?.lastChipBottom ?? 1e9) <= (afterBlind?.missionsClip?.panelBottom ?? 0) + 1', (afterBlind?.missionsClip?.lastChipBottom ?? 1e9) <= (afterBlind?.missionsClip?.panelBottom ?? 0) + 1) &&
  // Fase F: el chip plegable de misiones vive arriba a la derecha.
  chk('afterBlind?.missionsClip?.toggleVisible === true', afterBlind?.missionsClip?.toggleVisible === true) &&
  // --- Fase 4: tap, arrastre y flip ---
  chk('afterTap?.selected === true', afterTap?.selected === true) &&
  chk('afterTap?.hintVisible === true', afterTap?.hintVisible === true) &&
  chk('afterTap?.count === 1', afterTap?.count === 1) &&
  // Fase A: la primera carta elegida lleva el badge con el numero 1.
  chk('afterTap?.badgeVisible === true', afterTap?.badgeVisible === true) &&
  chk('afterTap?.badgeIndex === 1', afterTap?.badgeIndex === 1) &&
  chk('afterDragPlay?.selected === true', afterDragPlay?.selected === true) &&
  chk('afterDragPlay?.count === 2', afterDragPlay?.count === 2) &&
  chk('afterDragPlay?.backInHand === true', afterDragPlay?.backInHand === true) &&
  chk('afterDiscard?.discardsLeft === (beforeDiscard?', afterDiscard?.discardsLeft === (beforeDiscard?.discardsLeft ?? 0) - 1) &&
  chk('afterDiscard?.stillInHand === false', afterDiscard?.stillInHand === false) &&
  chk('afterDiscard?.cardsDiscarded === 1', afterDiscard?.cardsDiscarded === 1) &&
  chk('afterDiscard?.handSize === (afterBlind?.hand ?', afterDiscard?.handSize === (afterBlind?.hand ?? 0)) &&
  // Fase 2: el TOQUE sobre la pila descarta la seleccion (alternativa al drag).
  chk(
    'tapDiscard: descarta la SELECCION al tocar la pila',
    tapDiscard?.pickedCount === 2 &&
      tapDiscard?.after?.gone === true &&
      tapDiscard?.after?.selected === 0 &&
      tapDiscard?.after?.discardsLeft === (tapDiscard?.before?.discardsLeft ?? 0) - 1,
  ) &&
  chk('JSON.stringify(afterDiscard?.selected) === JSO', JSON.stringify(afterDiscard?.selected) === JSON.stringify(beforeDiscard?.selected)) &&
  chk('afterDragHand?.selected === false', afterDragHand?.selected === false) &&
  chk('afterDragHand?.count === 1', afterDragHand?.count === 1) &&
  chk('flipTest?.accepted === true', flipTest?.accepted === true) &&
  chk('flipTest?.allHaveBack === true', flipTest?.allHaveBack === true) &&
  chk('(flipTest?.back?.flip ?? 0) > 0.9', (flipTest?.back?.flip ?? 0) > 0.9) &&
  chk('flipTest?.back?.faceUp === false', flipTest?.back?.faceUp === false) &&
  chk('(flipTest?.front?.flip ?? 1) < 0.1', (flipTest?.front?.flip ?? 1) < 0.1) &&
  chk('flipTest?.front?.faceUp === true', flipTest?.front?.faceUp === true) &&
  chk('afterPlay?.score > 0', afterPlay?.score > 0) &&
  // FIX chip MAZO: el numero visible baja con lo que la ronda consumio. Sin el
  // fix quedaba clavado en el total pese a haber jugado cartas.
  // El chip muestra la pila de robo REAL: jugar/descartar la baja; si el
  // descarte se recicla, vuelve a subir. La asercion util es que el numero
  // visible COINCIDA con `deckDrawPile` (fuente unica del motor).
  chk(
    'afterPlay?.chipDeck = `${robables}/${total}`',
    afterPlay?.chipDeck === `${afterPlay?.deckDrawPile}/${afterPlay?.expectedDeckSize}`,
  ) &&
  chk(
    'afterPlay?.deckDraw = total - consumidas',
    afterPlay?.deckDraw ===
      (afterPlay?.expectedDeckSize ?? 40) -
        (afterPlay?.cardsPlayed ?? 0) -
        (afterPlay?.cardsDiscarded ?? 0),
  ) &&
  chk(
    'afterPlay?.deckSize sigue en el total',
    afterPlay?.deckSize === afterPlay?.expectedDeckSize,
  ) &&
  // Regresion: el abanico no se superpone tras ordenar y tras jugar. El gap
  // uniforme es 2.32; por debajo de 1.9 hay dos cartas pisadas.
  chk(
    'sortOverlap.afterSort (sin superposicion)',
    (sortOverlap?.afterSort?.minGap ?? 0) > 1.9,
  ) &&
  chk(
    'sortOverlap.afterPlay (sin superposicion)',
    (sortOverlap?.afterPlay?.minGap ?? 0) > 1.9,
  ) &&
  // --- Salida al menu ---
  chk('quitButtonExists', quitButtonExists === true) &&
  chk('quitPanel.panel (panel de confirmacion abierto)', quitPanel?.panel === true) &&
  chk('quitPanel.cancel/confirm presentes', quitPanel?.cancel === true && quitPanel?.confirm === true) &&
  chk('quitPanel.status sigue en partida', quitPanel?.status !== 'menu') &&
  chk('afterCancel no salio (status != menu)', afterCancel?.status !== 'menu') &&
  chk('afterCancel panel cerrado', afterCancel?.panel === false) &&
  chk("afterQuit.status === 'menu'", afterQuit?.status === 'menu') &&
  chk('afterQuit menuPanel visible', afterQuit?.menuPanel === true) &&
  chk("afterWin?.status === 'shop'", afterWin?.status === 'shop') &&
  chk('realErrors.length === 0', realErrors.length === 0) &&
  chk('pageErrors.length === 0', pageErrors.length === 0);

const failed = CHECKS.filter(([, v]) => !v);
if (failed.length) {
  console.log('\n--- ASERCIONES FALLIDAS: ' + failed.length + ' ---');
  for (const [name] of failed) console.log('  ✗ ' + name);
}

console.log(ok ? '\n✓ SMOKE TEST OK' : '\n✗ SMOKE TEST FALLO');

await browser.close();
process.exit(ok ? 0 : 1);
