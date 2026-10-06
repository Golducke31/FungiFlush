/**
 * repro-sort.mjs — Reproduce el bug de orden + superposicion de ilustraciones.
 *
 * Reportado por Emanuel: con un criterio activo (p.ej. familia), al jugar
 * mano / descartar / ganar un ciego y volver a repartir, las ilustraciones
 * quedan SUPERPUESTAS. Tocar una carta lo arregla -> huele a carrera entre el
 * tween de `home` (layout) y el reorden del Map de cartas.
 *
 * Mide la distancia X entre cartas vecinas tras cada transicion. Si dos cartas
 * quedan a menos de CARD_WIDTH*0.5 (~1.1), se reporta la superposicion.
 *
 * Requiere el dev server en 127.0.0.1:1420.
 */
import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const URL_TO_TEST = process.env.FF_URL ?? 'http://127.0.0.1:1420/?daily=0';

const PW_CANDIDATES = [
  'C:/Users/emanu/.workbuddy-ai/binaries/node/workspace/node_modules/playwright-core/index.js',
];
async function loadPlaywright() {
  try {
    return await import('playwright-core');
  } catch {
    for (const candidate of PW_CANDIDATES) {
      if (existsSync(candidate)) return await import(pathToFileURL(candidate).href);
    }
    throw new Error('No se encontro playwright-core.');
  }
}
const pw = await loadPlaywright();
const chromium = pw.chromium ?? pw.default?.chromium;

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
const context = await browser.newContext({
  viewport: { width: 844, height: 390 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
});
const page = await context.newPage();
page.on('console', (m) => {
  if (m.type() === 'error') console.error('[console]', m.text());
});
page.on('pageerror', (e) => console.error('[pageerror]', e.message));

await page.goto(URL_TO_TEST, { waitUntil: 'load', timeout: 45000 });
await page.waitForFunction(() => Boolean(window.__fungiflush?.engine?.run), { timeout: 30000 });
await page.waitForTimeout(2000);

let failures = 0;

const report = async (label) => {
  const info = await page.evaluate(() => {
    const ff = window.__fungiflush;
    const sm = ff.scene;
    const xs = typeof sm?.readHandXs === 'function' ? sm.readHandXs() : null;
    return {
      status: ff.engine.run.status,
      handLen: ff.engine.round?.hand?.length ?? 0,
      xs,
    };
  });
  if (!info.xs || info.xs.length < 2) {
    console.log(`[${label}] status=${info.status} hand=${info.handLen} (nada que medir)`);
    return;
  }
  const gaps = [];
  for (let i = 1; i < info.xs.length; i += 1) {
    gaps.push(Math.abs(+(info.xs[i] - info.xs[i - 1]).toFixed(3)));
  }
  const minGap = Math.min(...gaps);
  const bad = minGap < 1.1;
  if (bad) failures += 1;
  console.log(
    `[${label}] status=${info.status} hand=${info.handLen} minGap=${minGap.toFixed(3)}${bad ? '  *** SUPERPUESTAS ***' : '  ok'}`,
  );
  console.log(`   xs = [${info.xs.map((x) => x.toFixed(2)).join(', ')}]`);
  console.log(`   gaps = [${gaps.map((g) => g.toFixed(2)).join(', ')}]`);
};

// Menu -> nueva partida (dismiss tutorial si aparece)
await page.evaluate(() => document.querySelector('[data-act="tutorial-close"]')?.click());
await page.waitForTimeout(300);
await page.evaluate(() => document.querySelector('.panel.is-menu [data-act="new"]')?.click());
await page.waitForTimeout(1200);
// "Nueva partida" abre el selector de ARQUETIPO: el jugador elige y arranca.
await page.evaluate(() => document.querySelector('.panel.is-archetypes [data-act="archetypes-start"]')?.click());
await page.waitForTimeout(1500);

// Elegir ciego (el flujo secuencial no toma argumento, pero se acepta por compat)
await page.evaluate(() => {
  const ff = window.__fungiflush;
  const blinds = ff.engine.availableBlinds();
  ff.engine.chooseBlind(blinds[0]?.id);
});
await page.waitForTimeout(1800);
// Esperar a que la mano se reparta de verdad.
await page.waitForFunction(
  () => (window.__fungiflush?.engine?.round?.hand?.length ?? 0) > 0,
  { timeout: 15000 },
);
await page.waitForTimeout(900);
await report('reparto inicial');

// Aplicar orden por familia (abre el menu y elige el criterio)
const applySort = async (mode) => {
  await page.evaluate(() => document.querySelector('[data-act="sort"]')?.click());
  await page.waitForTimeout(200);
  await page.evaluate((m) => document.querySelector(`[data-sort-mode="${m}"]`)?.click(), mode);
  await page.waitForTimeout(1300);
};
await applySort('family');
await report('ordenado por familia');

// Jugar 2 cartas
await page.evaluate(() => {
  const ff = window.__fungiflush;
  for (const c of ff.engine.round.hand.slice(0, 2)) ff.engine.toggleSelect(c.uid);
});
await page.waitForTimeout(250);
await page.evaluate(() => document.querySelector('[data-act="play"]')?.click());
await page.waitForTimeout(3000);
await report('despues de JUGAR mano');

// Descartar 2 cartas (si sigue jugando)
const stillPlaying = await page.evaluate(() => window.__fungiflush.engine.run.status);
if (stillPlaying === 'playing') {
  await page.evaluate(() => {
    const ff = window.__fungiflush;
    for (const c of ff.engine.round.hand.slice(0, 2)) ff.engine.toggleSelect(c.uid);
  });
  await page.waitForTimeout(250);
  await page.evaluate(() => document.querySelector('[data-act="discard"]')?.click());
  await page.waitForTimeout(3000);
  await report('despues de DESCARTAR');
}

// Forzar varios descartes/jugadas hasta agotar la ronda y ver el reparto siguiente
for (let round = 0; round < 4; round += 1) {
  const st = await page.evaluate(() => window.__fungiflush.engine.run.status);
  if (st !== 'playing') break;
  await page.evaluate(() => {
    const ff = window.__fungiflush;
    const hand = ff.engine.round.hand;
    for (const c of hand.slice(0, 1)) ff.engine.toggleSelect(c.uid);
  });
  await page.waitForTimeout(200);
  await page.evaluate(() => document.querySelector('[data-act="play"]')?.click());
  await page.waitForTimeout(2600);
  await report(`play extra #${round + 1}`);
}

await page.screenshot({ path: 'tools/shots/repro-sort.png' });
await browser.close();
console.log(`\nRespuesta: ${failures} transicion(es) con superposicion.`);
console.log('Shot: tools/shots/repro-sort.png');
