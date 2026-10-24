/**
 * probe-motionframes.mjs — Verifica las ilustraciones ANIMADAS en el loop real.
 *
 * Que se comprueba (y por que cada cosa):
 *
 *   1. Con el manifiesto cargado y tier `high`, las cartas de la mano muestran
 *      una hoja de frames (`motionState != null`).
 *   2. El FRAME AVANZA con el reloj del juego y el OFFSET UV coincide con la
 *      celda de ese frame. Un off-by-one aca se ve como la ilustracion
 *      dibujada en la celda de al lado.
 *   3. El HIT-STOP lo congela. Es el invariante del proyecto: todo lo animado
 *      pasa por el `dt` del loop, nada por `setTimeout`.
 *   4. `reduceMotion` lo clava en el frame 0 (lo que informa no se apaga, solo
 *      deja de moverse).
 *   5. En tier `low` no queda NI UNA hoja viva: es el camino de render de
 *      siempre y no puede costar ni una textura.
 *   6. El presupuesto del tier se respeta y las texturas se liberan al soltar
 *      la ultima carta (`textures === active`, o sea cero hojas colgadas).
 *
 * El manifiesto se INYECTA por route: no depende de que existan hojas reales
 * (eso es contenido, no mecanismo). Cada archivo de arte se declara como su
 * propia "hoja" de 3x2. El contenido da igual —lo que se mide es la textura,
 * el offset y el reloj— y asi el probe corre igual con 0 hojas generadas.
 *
 *   node tools/probe-motionframes.mjs
 */
import { existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const URL_TO_TEST = process.env.FF_URL ?? 'http://127.0.0.1:1420/?daily=0&quality=high';
const PW = 'C:/Users/emanu/.workbuddy-ai/binaries/node/workspace/node_modules/playwright-core/index.js';

const pw = await import(pathToFileURL(PW).href);
const chromium = pw.chromium ?? pw.default?.chromium;
const exe = [
  'C:/Users/emanu/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe',
  'C:/Users/emanu/AppData/Local/ms-playwright/chromium-1228/chrome-win64/chrome.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
].find((p) => existsSync(p));
if (!exe) {
  console.error('No hay Chromium.');
  process.exit(1);
}

// --- Manifiesto inyectado ---------------------------------------------------
// 3x2 y 30 fps: a 30 fps el frame cambia varias veces entre dos muestras
// incluso con los ~2-10 FPS que da SwiftShader, asi que "el frame avanza" se
// puede medir sin depender del framerate de la maquina.
const COLS = 3;
const ROWS = 2;
const FPS = 30;
const artFiles = readdirSync(join(ROOT, 'public', 'art'))
  .filter((n) => n.startsWith('art_card_') && n.endsWith('.webp'))
  .sort();
if (artFiles.length === 0) {
  console.error('No hay arte de carta en public/art: no se puede armar el manifiesto.');
  process.exit(1);
}
const sheets = {};
for (const file of artFiles) {
  // El archivo de arte se declara como su propia hoja: existe seguro y el
  // navegador ya lo tiene en cache HTTP.
  sheets[file] = { file, cols: COLS, rows: ROWS, fps: FPS, pingPong: true };
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
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

await page.route('**/art/motionframes.json', (route) =>
  route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ sheets }) }),
);

await page.goto(URL_TO_TEST, { waitUntil: 'load', timeout: 45000 });
await page.waitForFunction(() => Boolean(window.__fungiflush?.engine?.run), { timeout: 30000 });
await page.waitForTimeout(1500);

// --- Arranque de la run (mismo camino que el resto de los probes) -----------
await page.evaluate(() => document.querySelector('.panel.is-menu [data-act="new"]')?.click());
await page.waitForTimeout(900);
await page.evaluate(() =>
  document.querySelector('.panel.is-archetypes [data-act="archetypes-start"]')?.click(),
);
await page.waitForFunction(
  () => {
    const s = window.__fungiflush?.engine?.run?.status;
    return s === 'blind_select' || s === 'playing';
  },
  { timeout: 15000 },
);
await page.evaluate(() => {
  const engine = window.__fungiflush.engine;
  if (engine.run.status === 'blind_select') engine.chooseBlind(engine.availableBlinds()[0]?.id);
});
await page.waitForFunction(() => window.__fungiflush?.scene?.handState?.().length > 0, {
  timeout: 15000,
});
// Que el reparto de apertura termine de asentar las cartas.
await page.waitForTimeout(2000);

/** Lee el estado animado de todas las cartas vivas + los contadores del cache. */
const read = () =>
  page.evaluate(() => {
    const scene = window.__fungiflush.scene;
    const cards = [];
    const push = (c) => {
      const state = c.motionState;
      if (state) cards.push(state);
    };
    for (const c of scene.handCards.values()) push(c);
    for (const c of scene.jokerCards.values()) push(c);
    for (const c of scene.scoringCards) push(c);
    for (const c of scene.menuCards) push(c);
    return {
      report: window.__fungiflush.motion(),
      clock: Number(scene.clock.toFixed(3)),
      cards,
    };
  });

/** Muestrea `n` frames seguidos (cada uno tras un rAF). */
const sample = (n = 3) =>
  page.evaluate(
    (count) =>
      new Promise((resolve) => {
        const scene = window.__fungiflush.scene;
        const out = [];
        const tick = () => {
          const states = [];
          const push = (c) => {
            const s = c.motionState;
            if (s) states.push(s);
          };
          for (const c of scene.handCards.values()) push(c);
          out.push({ clock: Number(scene.clock.toFixed(3)), dt: scene.lastFrameDt, states });
          if (out.length < count) requestAnimationFrame(tick);
          else resolve(out);
        };
        requestAnimationFrame(tick);
      }),
    n,
  );

/** `true` si el offset coincide con la celda que corresponde al frame. */
function offsetMatchesCell(state) {
  const col = state.frame % state.cols;
  const row = Math.floor(state.frame / state.cols);
  const wantX = col / state.cols;
  const wantY = (state.rows - 1 - row) / state.rows;
  return Math.abs(state.offsetX - wantX) < 1e-6 && Math.abs(state.offsetY - wantY) < 1e-6;
}

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'ok  ' : 'XX  '} ${name}${detail ? `  ${detail}` : ''}`);
};

// --- 1. Hay manifiesto y cartas animadas ------------------------------------
await page.waitForFunction(() => window.__fungiflush.motion().declared > 0, { timeout: 10000 });
const first = await read();
check(
  '1) tier high: animacion prendida y cartas con hoja',
  first.report.enabled === true && first.report.declared === artFiles.length && first.cards.length > 0,
  `enabled=${first.report.enabled} declared=${first.report.declared}/${artFiles.length} animadas=${first.cards.length}`,
);

// --- 2. El frame avanza y el offset cae en su celda ------------------------
const runA = await sample(6);
const framesA = runA.flatMap((f) => f.states.map((s) => s.frame));
const distinct = new Set(framesA).size;
const cellsOk = runA.every((f) => f.states.every(offsetMatchesCell));
check(
  '2) el frame avanza con el reloj',
  distinct > 1,
  `frames distintos=${distinct} (clock ${runA[0]?.clock} -> ${runA[runA.length - 1]?.clock})`,
);
check('2b) el offset UV coincide con la celda del frame', cellsOk);
// La textura tiene que estar SUBIDA a la GPU. Una `Texture` sin `needsUpdate`
// nace con version 0, three no la sube y el quad se dibuja negro sin error.
const notUploaded = runA.flatMap((f) => f.states.filter((s) => !s.uploaded)).length;
check('2c) la textura de la hoja esta subida a la GPU', notUploaded === 0, `sin subir=${notUploaded}`);

// --- 3. Hit-stop lo congela ------------------------------------------------
// Hit-stop LARGO: a 0.7 FPS un solo frame se come el presupuesto entero, asi
// que se mira que los primeros frames esten quietos (invariante al framerate).
await page.evaluate(() => window.__fungiflush.scene.hitStop(4000));
const frozen = await sample(3);
const frozenFrames = frozen.flatMap((f) => f.states.map((s) => s.frame));
const frozenOffsets = frozen.flatMap((f) => f.states.map((s) => `${s.offsetX},${s.offsetY}`));
check(
  '3) el hit-stop congela el frame',
  new Set(frozenFrames).size === 1 && new Set(frozenOffsets).size === 1 && frozen.every((f) => f.dt === 0),
  `frames=${[...new Set(frozenFrames)].join('/')} dt=${frozen.map((f) => f.dt).join(',')}`,
);

// Se deja pasar el hit-stop para volver a un estado normal.
await page.waitForTimeout(4300);

// --- 4. reduceMotion lo clava en el frame 0 --------------------------------
const rmApplied = await page.evaluate(() => {
  const scene = window.__fungiflush.scene;
  scene.setMode(scene.mode, { reduceMotion: true });
  return scene.reduceMotion;
});
await page.waitForTimeout(350);
const reduced = await sample(3);
const reducedFrames = reduced.flatMap((f) => f.states.map((s) => s.frame));
check(
  '4) reduceMotion deja el frame 0',
  rmApplied === true && reducedFrames.length > 0 && reducedFrames.every((f) => f === 0),
  `frames=${[...new Set(reducedFrames)].join('/')}`,
);
await page.evaluate(() => {
  const scene = window.__fungiflush.scene;
  scene.setMode(scene.mode, { reduceMotion: false });
});

// --- 5. Presupuesto y liberacion de texturas -------------------------------
const budget = await read();
check(
  '5) el presupuesto del tier se respeta',
  budget.report.active <= budget.report.budget && budget.report.animated <= budget.report.budget,
  `active=${budget.report.active} budget=${budget.report.budget} animadas=${budget.report.animated} cartas=${budget.report.cards}`,
);
check(
  '5b) no quedan texturas colgadas (textures === active)',
  budget.report.textures === budget.report.active,
  `textures=${budget.report.textures} active=${budget.report.active}`,
);

// --- 6. En tier low no queda ni una hoja -----------------------------------
await page.evaluate(() => window.__fungiflush.scene.applyQuality('low', 'manual'));
await page.waitForTimeout(400);
const low = await read();
check(
  '6) tier low: cero animacion y cero texturas',
  low.report.enabled === false &&
    low.cards.length === 0 &&
    low.report.active === 0 &&
    low.report.textures === 0,
  `enabled=${low.report.enabled} animadas=${low.cards.length} active=${low.report.active} textures=${low.report.textures}`,
);

// --- 7. Volver a high la recupera ------------------------------------------
await page.evaluate(() => window.__fungiflush.scene.applyQuality('high', 'manual'));
await page.waitForTimeout(600);
const back = await read();
check(
  '7) volver a high la recupera',
  back.report.enabled === true && back.cards.length > 0,
  `animadas=${back.cards.length} active=${back.report.active}`,
);

console.log('\nerrores de consola:', errors.length ? errors.slice(0, 5) : 'ninguno');
const ok = results.every((r) => r.ok) && errors.length === 0;
console.log(ok ? '\nOK MOTIONFRAMES FUNCIONANDO' : '\nXX HAY ALGO MAL');
await browser.close();
process.exitCode = ok ? 0 : 1;
