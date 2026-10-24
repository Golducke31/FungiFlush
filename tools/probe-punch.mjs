/**
 * probe-punch.mjs — Verifica el golpe de pantalla del cierre de combo (V4).
 *
 * Que se comprueba (y por que cada cosa):
 *
 *   1. El PUNCH SUBE al cerrar el combo. `closeCombo` prende `bgPulse` y
 *      `updateComboPulse` lo copia al uniform: si esa conexion se rompe, el
 *      golpe no se ve y no hay forma de notarlo desde afuera.
 *   2. El PUNCH VUELVE A 0 y el pase se APAGA. Con punch 0 el pase se saca de
 *      la cadena del composer: un quad de pantalla completa con cinco muestras
 *      de textura no puede correr en TODOS los frames para no hacer nada.
 *      `active` es el estado real del pase, no una inferencia.
 *   3. El ALPHA DEL CANVAS no se degrada con el punch activo. El canvas es
 *      transparente y deja ver el fondo de arena (#arena-bg): un pase que
 *      escribiera alpha 1 taparia el fondo con un quadro opaco. Se mide
 *      diferencial (reposo vs golpe) en tres puntos, asi que no depende de
 *      saber que hay dibujado en cada pixel.
 *   4. Con `reduceMotion` el punch NO arranca: todas las escrituras de
 *      `bgPulse` lo respetan, y es exactamente el tipo de efecto que la gente
 *      pide apagar.
 *   5. En tier `low` no hay punch: no hay composer, el pase no existe.
 *
 * Corre en `quality=medium` (composer con bloom + grade, que es donde vive el
 * punch). El muestreo va DENTRO de la pagina encadenado a rAF y con CORTE
 * ADAPTATIVO: a este tier bajo SwiftShader el reloj corre a ~0.15-0.5x real,
 * asi que no se adivina una ventana —se espera a que el punch termine—.
 *
 *   node tools/probe-punch.mjs
 */
import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

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

const URL_TO_TEST = process.env.FF_URL ?? 'http://127.0.0.1:1420/?daily=0&quality=medium';

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

await page.goto(URL_TO_TEST, { waitUntil: 'load', timeout: 45000 });
await page.waitForFunction(() => Boolean(window.__fungiflush?.engine?.run), { timeout: 30000 });
await page.waitForTimeout(2200);

await page.evaluate(() => document.querySelector('.panel.is-menu [data-act="new"]')?.click());
await page.waitForTimeout(1000);
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
  if (engine.run.status === 'blind_select') {
    engine.chooseBlind(engine.availableBlinds()[0]?.id);
  }
});
await page.waitForFunction(
  () => window.__fungiflush?.scene?.handState?.().length > 0,
  { timeout: 15000 },
);
await page.waitForTimeout(2500);

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'ok  ' : 'XX  '} ${name}${detail ? `  ${detail}` : ''}`);
};

/**
 * Graba `readSrc` en la pagina, un frame por muestra, durante `durationMs`.
 * `triggerSrc` se ejecuta a los `afterMs`; `stopSrc` corta la grabacion en
 * cuanto dice true (la muestra que la dispara queda incluida). Las funciones
 * viajan como TEXTO: Playwright no serializa funciones como argumentos.
 */
const record = (durationMs, readSrc, triggerSrc = null, afterMs = 0, stopSrc = null) =>
  page.evaluate(
    ({ durationMs, readSrc, triggerSrc, afterMs, stopSrc }) =>
      new Promise((resolve) => {
        const read = new Function(`return (${readSrc})`)();
        const trigger = triggerSrc ? new Function(`return (${triggerSrc})`)() : null;
        const stop = stopSrc ? new Function(`return (${stopSrc})`)() : null;
        const out = [];
        const t0 = performance.now();
        let fired = false;
        const tick = () => {
          const now = performance.now();
          if (trigger && !fired && now - t0 >= afterMs) {
            fired = true;
            trigger();
          }
          const sample = read();
          out.push(sample);
          if (stop && stop(sample, out)) {
            resolve(out);
            return;
          }
          if (now - t0 < durationMs) requestAnimationFrame(tick);
          else resolve(out);
        };
        requestAnimationFrame(tick);
      }),
    { durationMs, readSrc, triggerSrc, afterMs, stopSrc },
  );

/** Espera una mano con al menos `min` cartas, ya asentada. */
const waitForHand = async (min = 2) => {
  await page.waitForFunction(
    (n) => (window.__fungiflush?.scene?.handState?.().length ?? 0) >= n,
    min,
    { timeout: 20000 },
  );
  await page.waitForTimeout(900);
};

/** Selecciona y juega las cartas dadas (camino real del motor). */
const PLAY_SRC =
  '() => { const ff = window.__fungiflush; for (const uid of window.__play) ff.engine.toggleSelect(uid); ff.engine.playHand(); }';

/**
 * Lector: punch + si el pase esta en la cadena + alpha de tres puntos del
 * canvas. El alpha se lee con `drawImage` a un canvas chico DENTRO del callback
 * de rAF: es el unico momento en que el drawing buffer del WebGL sigue vivo
 * (despues del compositing se limpia). Se corre despues del render del juego
 * porque el loop del juego se re-registra al principio de su callback.
 */
const READ_PUNCH = `() => {
  const ff = window.__fungiflush;
  const r = ff.punch();
  const cv = document.getElementById('fungiflush-canvas');
  const c2 = window.__punchCanvas || (window.__punchCanvas = document.createElement('canvas'));
  if (c2.width !== 4) { c2.width = 4; c2.height = 4; }
  const ctx = c2.getContext('2d');
  ctx.drawImage(cv, 0, 0, 4, 4);
  const d = ctx.getImageData(0, 0, 4, 4).data;
  return {
    p: r.punch,
    active: r.active,
    a00: d[3],
    a22: d[(2 * 4 + 2) * 4 + 3],
    a33: d[(3 * 4 + 3) * 4 + 3],
    t: performance.now(),
  };
}`;

// --- 1/2/3. El punch sube al cerrar el combo, baja, y no rompe el alpha ----
await waitForHand(2);
await page.evaluate(async (n) => {
  window.__play = window.__fungiflush.scene.handState().map((c) => c.uid).slice(0, n);
}, 2);
// Corte adaptativo: la grabacion termina cuando el punch vuelve a 0 DESPUES
// de haber subido. El pulso vive ~0.33 s de JUEGO (varios segundos reales a
// este tier); si nunca bajara, la grabacion llegaria al techo y el check 2 lo
// veria.
const STOP_PUNCH_GONE = '(s, out) => s.p === 0 && !s.active && out.some((x) => x.p > 0.3)';
const punch = await record(60000, READ_PUNCH, PLAY_SRC, 400, STOP_PUNCH_GONE);

const peak = Math.max(...punch.map((s) => s.p));
const activeSeen = punch.some((s) => s.active);
const last = punch[punch.length - 1];
check(
  '1) el punch sube al cerrar el combo',
  peak >= 0.5,
  `pico=${peak.toFixed(3)} frames=${punch.length}`,
);
check(
  '1b) el pase se enciende solo durante el golpe',
  activeSeen && last.p === 0 && !last.active,
  `activo en algun frame=${activeSeen} final=${last.p}/${last.active}`,
);
check(
  '2) el punch vuelve a 0 y el pase se apaga',
  last.p === 0 && !last.active,
  `final=${last.p} active=${last.active}`,
);

// Alpha: diferencial reposo vs golpe, en tres puntos del canvas.
const median = (xs) => {
  if (xs.length === 0) return -1;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)] ?? -1;
};
const rest = punch.filter((s) => s.p <= 0.05);
const hot = punch.filter((s) => s.p >= 0.5);
const points = ['a00', 'a22', 'a33'];
const drifts = points.map((k) => Math.abs(median(hot.map((s) => s[k])) - median(rest.map((s) => s[k]))));
const maxDrift = Math.max(...drifts);
check(
  '3) el alpha del canvas no se degrada con el punch activo',
  rest.length >= 3 && hot.length >= 2 && maxDrift <= 8,
  `deriva=${maxDrift} (${points.map((k, i) => `${k}:${median(rest.map((s) => s[k]))}→${median(hot.map((s) => s[k]))}`).join(' ')}) reposo=${rest.length} golpe=${hot.length}`,
);

// Costo por frame (informativo): el punch solo corre durante el golpe.
const frameMs = (xs) => {
  const ds = [];
  for (let i = 1; i < xs.length; i += 1) ds.push(xs[i].t - xs[i - 1].t);
  return ds.length ? ds.reduce((a, b) => a + b, 0) / ds.length : 0;
};
console.log(
  `     frame medio: reposo=${frameMs(rest).toFixed(0)}ms golpe=${frameMs(hot).toFixed(0)}ms (informativo)`,
);

// --- 4. reduceMotion: el punch no arranca ----------------------------------
await page.evaluate(() => window.__fungiflush.scene.setMode('run', { reduceMotion: true }));
await waitForHand(2);
await page.evaluate(async (n) => {
  window.__play = window.__fungiflush.scene.handState().map((c) => c.uid).slice(0, n);
}, 2);
// Sin punch no hay nada que esperar: ventana fija. Con reduceMotion las
// duraciones se acortan a ~0, asi que la mano se resuelve rapido.
const reduced = await record(9000, READ_PUNCH, PLAY_SRC, 400);
const reducedPeak = Math.max(...reduced.map((s) => s.p));
const reducedActive = reduced.some((s) => s.active);
check(
  '4) con reduceMotion el punch no arranca',
  reducedPeak === 0 && !reducedActive,
  `pico=${reducedPeak} activo=${reducedActive} frames=${reduced.length}`,
);
await page.evaluate(() => window.__fungiflush.scene.setMode('run', { reduceMotion: false }));

// --- 5. Tier low: no hay composer, no hay punch ----------------------------
await page.evaluate(() => window.__fungiflush.scene.applyQuality('low', 'manual'));
await page.waitForTimeout(600);
const noFx = await page.evaluate(() => window.__fungiflush.punch());
check(
  '5) en tier low no hay punch (no hay composer)',
  noFx.punch === 0 && !noFx.active,
  `punch=${noFx.punch} active=${noFx.active}`,
);

console.log('\nerrores de consola:', errors.length ? errors.slice(0, 5) : 'ninguno');
const ok = results.every((r) => r.ok) && errors.length === 0;
console.log(ok ? '\nOK PUNCH DEL CIERRE DE COMBO FUNCIONANDO' : '\nXX HAY ALGO MAL');
await browser.close();
process.exitCode = ok ? 0 : 1;
