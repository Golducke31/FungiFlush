/**
 * probe-custom-deck.mjs — Verifica el modo "Mazo propio" end-to-end.
 *
 * Comprueba (perfil + UI + motor):
 *   1. Con la Colonia en nivel 1 el boton "Mazo propio" aparece BLOQUEADO.
 *   2. Con la Colonia en nivel >= 3 el boton queda habilitado y abre el panel.
 *   3. El panel muestra el catalogo (cartas poseidas) con su grilla.
 *   4. Sumar/quitar copias actualiza el tamano y la validacion en vivo, y el
 *      boton de arranque SOLO se habilita con el mazo legal (20-40).
 *   5. El perfil persiste el mazo (onChange) sin boton de guardar.
 *   6. Arrancar con el mazo legal inyecta ESAS cartas en la run (el mazo de la
 *      run coincide con el armado).
 *
 *   node tools/probe-custom-deck.mjs
 */
import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const PW = 'C:/Users/emanu/.workbuddy-ai/binaries/node/workspace/node_modules/playwright-core/index.js';
const pw = await import(pathToFileURL(PW).href);
const chromium = pw.chromium ?? pw.default?.chromium;
const exe = 'C:/Users/emanu/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe';
if (!existsSync(exe)) {
  console.error('No hay Chromium.');
  process.exit(1);
}

const browser = await chromium.launch({
  executablePath: exe,
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
const context = await browser.newContext({
  viewport: { width: 915, height: 412 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
});
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});

await page.goto('http://127.0.0.1:1420/?daily=0', { waitUntil: 'load', timeout: 45000 });
await page.waitForFunction(() => Boolean(window.__fungiflush?.engine?.run), { timeout: 30000 });
await page.waitForTimeout(2200);

const checks = [];
const check = (name, pass, detail) => checks.push({ name, pass, detail });

// --- 1. Bloqueado en nivel 1 ------------------------------------------------
// El perfil arranca en nivel 1: el boton existe pero esta bloqueado.
await page.evaluate(() => {
  const btn = document.querySelector('.panel.is-menu [data-act="new"]');
  if (btn) btn.click();
});
await page.waitForFunction(() => Boolean(document.querySelector('[data-act="deck-open"]')), {
  timeout: 8000,
});

const lockedState = await page.evaluate(() => {
  const btn = document.querySelector('[data-act="deck-open"]');
  return {
    exists: Boolean(btn),
    locked: btn?.classList.contains('is-locked') ?? null,
    hasLock: Boolean(btn?.querySelector('.deck-open-lock')),
  };
});
check(
  'en nivel 1 el boton "Mazo propio" esta bloqueado',
  lockedState.exists && lockedState.locked === true && lockedState.hasLock,
  JSON.stringify(lockedState),
);

// Click en bloqueado NO abre el panel (y avisa).
await page.evaluate(() => document.querySelector('[data-act="deck-open"]')?.click());
await page.waitForTimeout(400);
const stillNoPanel = await page.evaluate(() => !document.querySelector('.is-deck-builder'));
check('el boton bloqueado no abre el panel', stillNoPanel, `panelAbierto=${!stillNoPanel}`);

// --- 2. Sembrar Colonia en nivel 3 y re-sincronizar -------------------------
// `lifetimeSpores` es la fuente del nivel (DERIVADO), asi que se sube eso. El
// HUD no lo sabe solo: se re-empuja con `syncDeck()` (expuesto en el bridge).
await page.evaluate(() => {
  const ff = window.__fungiflush;
  ff.profileStore.patch((p) => {
    p.colony.lifetimeSpores = 260; // nivel 3 (~220)
    // El nivel es DERIVADO: se recalcula para que la puerta lea el valor nuevo.
    p.colony.level = 3;
  });
  ff.syncDeck();
});
await page.waitForTimeout(300);

// El panel de arquetipos ya estaba dibujado con el estado viejo: se reabre para
// que el boton se repinte con la puerta nueva (patron real de uso).
await page.evaluate(() => {
  document.querySelector('[data-act="archetypes-close"]')?.click();
});
await page.waitForTimeout(400);
await page.evaluate(() => {
  document.querySelector('.panel.is-menu [data-act="new"]')?.click();
});
await page.waitForFunction(() => Boolean(document.querySelector('[data-act="deck-open"]')), {
  timeout: 8000,
});

const unlockedState = await page.evaluate(() => {
  const btn = document.querySelector('[data-act="deck-open"]');
  return {
    locked: btn?.classList.contains('is-locked') ?? null,
    level: window.__fungiflush.profileStore.current.colony.level,
  };
});
check(
  'con Colonia nivel 3 el boton queda habilitado',
  unlockedState.locked === false,
  JSON.stringify(unlockedState),
);

// --- 3/4. Abrir el panel y armar un mazo legal -----------------------------
await page.evaluate(() => document.querySelector('[data-act="deck-open"]')?.click());
await page.waitForFunction(() => Boolean(document.querySelector('.is-deck-builder')), {
  timeout: 8000,
});

const catalog = await page.evaluate(() => {
  const cells = [...document.querySelectorAll('.deck-card')];
  return {
    count: cells.length,
    withArt: cells.filter((c) => c.querySelector('img')).length,
    firstId: cells[0]?.dataset.cardId ?? null,
    startDisabled: document.querySelector('[data-act="archetypes-start"]')?.disabled ?? null,
  };
});
check(
  'el panel muestra el catalogo poseido con cara real',
  catalog.count > 0 && catalog.withArt > 0,
  JSON.stringify(catalog),
);
check(
  'con el mazo vacio el boton de arranque esta deshabilitado',
  catalog.startDisabled === true,
  `disabled=${catalog.startDisabled}`,
);

// Sumar 4 copias de 5 cartas distintas => 20 = DECK_MIN.
const built = await page.evaluate(() => {
  const cells = [...document.querySelectorAll('.deck-card')].slice(0, 5);
  for (const cell of cells) {
    const plus = cell.querySelector('[data-step="+"]');
    for (let i = 0; i < 4; i++) plus?.click();
  }
  const start = document.querySelector('[data-act="archetypes-start"]');
  const countText = document.querySelector('.deck-meter-text')?.textContent ?? '';
  return {
    disabled: start?.disabled ?? null,
    countText,
    picked: document.querySelectorAll('.deck-card.is-picked').length,
  };
});
check(
  'sumar 4 copias x 5 cartas (20) habilita el arranque',
  built.disabled === false && built.picked === 5,
  JSON.stringify(built),
);

// El tope por carta: la 5a copia NO entra.
const capped = await page.evaluate(() => {
  const cell = document.querySelector('.deck-card.is-picked');
  const plus = cell.querySelector('[data-step="+"]');
  const before = cell.querySelector('.deck-card-count')?.textContent;
  plus?.click();
  const after = cell.querySelector('.deck-card-count')?.textContent;
  return { before, after, disabled: plus?.disabled ?? null };
});
check(
  'la 5a copia de una carta no entra (tope 4)',
  capped.before === capped.after && capped.disabled === true,
  JSON.stringify(capped),
);

// --- 5. Persistencia -------------------------------------------------------
const persisted = await page.evaluate(() => {
  const p = window.__fungiflush.profileStore.current;
  const preset = p.decks.presets[0];
  const size = (preset?.entries ?? []).reduce((s, e) => s + e.copies, 0);
  return { presetId: preset?.id ?? null, size, entries: preset?.entries?.length ?? 0 };
});
check(
  'el mazo se persiste en el perfil al armar (sin boton guardar)',
  persisted.size === 20 && persisted.entries === 5,
  JSON.stringify(persisted),
);

// --- 6. Arrancar con el mazo ------------------------------------------------
await page.evaluate(() => document.querySelector('[data-act="archetypes-start"]')?.click());
// Salir del panel de arquetipos y del tutorial si aparece.
await page.waitForTimeout(1200);
await page.evaluate(() => {
  document.querySelector('[data-act="tutorial-close"]')?.click();
});
await page.waitForTimeout(600);

const runDeck = await page.evaluate(() => {
  const ff = window.__fungiflush;
  const cards = ff.engine.run.deck.allCards;
  // OJO: `CardInstance` NO tiene `.id` (es `def.id`). Leer `c.id` da undefined
  // para todas y colapsa el conteo en un solo bucket.
  const ids = cards.map((c) => c.def.id);
  const unique = new Set(ids);
  const counts = {};
  for (const id of ids) counts[id] = (counts[id] ?? 0) + 1;
  return {
    total: cards.length,
    unique: unique.size,
    maxCopies: Math.max(0, ...Object.values(counts)),
    archetype: ff.engine.run.archetype,
    status: ff.engine.run.status,
  };
});
check(
  'la run arranca con EL MAZO armado (20 cartas, 5 unicas, tope 4)',
  runDeck.total === 20 && runDeck.unique === 5 && runDeck.maxCopies === 4,
  JSON.stringify(runDeck),
);
check(
  'la run queda sin arquetipo con nombre (mazo custom)',
  runDeck.archetype === '',
  `archetype="${runDeck.archetype}"`,
);

// --- Reporte ---------------------------------------------------------------
console.log('');
console.log('=== PROBE MAZO PROPIO ===');
for (const c of checks) {
  console.log(`${c.pass ? 'OK ' : 'XX '} ${c.name}`);
  if (c.detail) console.log(`     ${c.detail}`);
}
console.log('');
console.log(`errores de consola: ${errors.length ? errors.join(' | ') : 'ninguno'}`);

await page.screenshot({ path: 'tools/shots/probe-custom-deck.png' });
await browser.close();

const failed = checks.filter((c) => !c.pass);
if (failed.length || errors.length) {
  console.log(`\nXX FALLARON ${failed.length} chequeo(s)`);
  process.exit(1);
}
console.log('\nOK MAZO PROPIO');
