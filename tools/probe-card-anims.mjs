/**
 * probe-card-anims.mjs — Verifica las animaciones de carta de V3 en el loop real.
 *
 * Que se comprueba (y por que cada cosa):
 *
 *   1. Jugar una mano deja un ANILLO DE CHOQUE en el suelo al aterrizar, y el
 *      anillo se LIBERA (vuelve a 0). Un pool que no libera es una fuga: los
 *      anillos se acumulan hasta que el mas viejo se recicla a la fuerza.
 *   2. La carta deja ESTELA al despegar y la estela se APAGA al aterrizar. Si
 *      se quedara prendida, el reguero seguiria saliendo de una carta quieta.
 *   3. El descarte GIRA EN PLANO (`rz`, una vuelta completa) y NO es un flip
 *      (`ry` quieto mientras gira). Es el hallazgo de ejes: con la carta
 *      acostada (`rx=-PI/2`), `ry` es el eje que la da vuelta y `rz` el que la
 *      hace girar sobre la mesa.
 *   4. El TICK de seleccion estira la carta (x crece, y se apachina), tiene un
 *      VALLE NEGATIVO (es lo que lo lee como rebote y no como fundido) y
 *      TERMINA SOLO a los 0.55 s. Se mide el cociente escala.x/escala.y: la
 *      elevacion por seleccion (`liftBoost`) es uniforme en ambos ejes, asi que
 *      se cancela y lo que queda es el tick puro.
 *   5. En tier `low` no hay NI anillos NI estelas: es el camino de render de
 *      siempre y el jugo nuevo no puede costarle nada.
 *
 * Corre en `quality=medium`: a `high` con SwiftShader el PostFx tarda ~1 s por
 * frame. `medium` tiene todo lo de V3 (el gate de anillos y estelas es
 * `tier !== 'low'`), pero el reloj del juego corre a ~0.15-0.5x real: las
 * animaciones se miden en TIEMPO DE JUEGO y las ventanas de grabacion se
 * dimensionan para eso (un aterrizaje de 0.74 s de juego necesita varios
 * segundos reales). El muestreo es por frame, asi que la resolucion no depende
 * del framerate: el `dt` acotado a 0.05 hace que un animacion de 0.5 s ocupe
 * ~10 frames pase lo que pase.
 *
 * EL MUESTREO VA DENTRO DE LA PAGINA, encadenado a rAF. Un `page.evaluate`
 * suelto cada X ms desde Node ocupa el hilo principal entre frames y AYUNA al
 * loop: el reloj del juego baja aun mas y ninguna animacion llega a completarse
 * (el tick se corta a mitad, el anillo no aparece). Un callback de rAF no
 * compite con el loop —corre dentro del mismo frame—.
 *
 *   node tools/probe-card-anims.mjs
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
// Que el reparto de apertura termine de asentar las cartas.
await page.waitForTimeout(2500);

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'ok  ' : 'XX  '} ${name}${detail ? `  ${detail}` : ''}`);
};

/**
 * Graba `readSrc` (expresion de funcion) en la pagina, un frame por muestra,
 * durante `durationMs`. `triggerSrc`, si existe, se ejecuta a los `afterMs`.
 * `stopSrc`, si existe, se evalua cada frame con la muestra y el acumulado: la
 * grabacion corta en cuanto dice true —la muestra que la dispara queda
 * incluida—. Es lo que hace al probe independiente de la velocidad del reloj:
 * en vez de adivinar cuantos segundos reales dura una animacion, se espera a
 * que la animacion TERMINE (o al techo de `durationMs`, que es el que detecta
 * que no termina).
 *
 * Las funciones viajan como TEXTO y se reconstruyen adentro: Playwright no
 * serializa funciones como argumentos.
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

/** Uids de las primeras `n` cartas de la mano. */
const firstUids = (n) =>
  page.evaluate((count) => window.__fungiflush.scene.handState().map((c) => c.uid).slice(0, count), n);

/** Selecciona y juega las cartas dadas (camino real del motor). */
const PLAY_SRC =
  '() => { const ff = window.__fungiflush; for (const uid of window.__play) ff.engine.toggleSelect(uid); ff.engine.playHand(); }';

const READ_FX = '() => window.__fungiflush.fx()';
const READ_SPIN = '() => { const c = window.__spinCard; return c ? { rz: c.group.rotation.z, ry: c.group.rotation.y } : null; }';
const READ_TICK = '() => { const c = window.__tickCard; return c ? c.group.scale.x / c.group.scale.y : null; }';
const READ_LOW = '() => ({ fx: window.__fungiflush.fx(), motion: window.__fungiflush.motion() })';

// --- 1/2. Jugar una mano: estela al despegar, anillo al aterrizar ----------
await waitForHand(2);
await page.evaluate(async (n) => {
  window.__play = window.__fungiflush.scene.handState().map((c) => c.uid).slice(0, n);
}, 2);
// Corte adaptativo: la grabacion termina cuando los anillos vuelvan a 0
// DESPUES de haber aparecido. El anillo vive 0.42 s de JUEGO, que a este tier
// bajo SwiftShader son varios segundos reales; cortar por reloj era una
// foto-finish (la ultima muestra caia con el anillo todavia vivo). Si el anillo
// nunca se liberara, la grabacion llegaria al techo y el check 1b lo veria.
const STOP_RINGS_GONE =
  '(f, out) => f.rings === 0 && f.trails === 0 && out.some((x) => x.rings > 0)';
const fx = await record(20000, READ_FX, PLAY_SRC, 400, STOP_RINGS_GONE);

const peakRings = Math.max(...fx.map((f) => f.rings));
const peakTrails = Math.max(...fx.map((f) => f.trails));
const ringsEnd = fx[fx.length - 1].rings;
// Primera vez que la estela se apaga DESPUES de haberse prendido: si se queda
// prendida, el reguero sale de una carta que ya esta quieta en el descarte.
let trailSeen = false;
let trailOffAt = -1;
fx.forEach((f, i) => {
  if (!trailSeen && f.trails > 0) trailSeen = true;
  else if (trailSeen && f.trails === 0 && trailOffAt < 0) trailOffAt = i;
});
check(
  '1) el aterrizaje deja un anillo de choque',
  peakRings >= 1,
  `pico=${peakRings} frames=${fx.length} pool=${fx[0].ringPool.active}/${fx[0].ringPool.size}`,
);
check(
  '1b) el anillo se libera (vuelve a 0 al terminar)',
  ringsEnd === 0,
  `final=${ringsEnd}`,
);
check(
  '2) la carta deja estela al despegar',
  peakTrails >= 1,
  `pico=${peakTrails}`,
);
check(
  '2b) la estela se apaga al aterrizar',
  trailOffAt >= 0,
  trailOffAt >= 0 ? `se apaga en el frame ${trailOffAt}` : 'nunca se apago',
);

// --- 3. Descarte: giro en plano (rz), no flip (ry) -------------------------
await waitForHand(2);
const spinStart = await page.evaluate(() => {
  const scene = window.__fungiflush.scene;
  const card = [...scene.handCards.values()][0];
  if (!card) return null;
  window.__spinCard = card;
  return { rz: card.group.rotation.z, ry: card.group.rotation.y };
});
if (!spinStart) {
  console.error('No hay carta para descartar.');
  await browser.close();
  process.exit(1);
}
const DISCARD_SRC =
  '() => { const ff = window.__fungiflush; const uid = window.__spinCard.uid; ff.engine.toggleSelect(uid); ff.engine.discardSelected(); }';
const spin = (await record(7000, READ_SPIN, DISCARD_SRC, 300)).filter(Boolean);
const maxSpin = Math.max(...spin.map((s) => Math.abs(s.rz - spinStart.rz)));
// El `retire` SI da vuelta la carta al final (se va boca abajo al descarte):
// eso es otro gesto, POSTERIOR al aterrizaje. Aca se mide que MIENTRAS GIRA no
// hay flip, asi que se descartan las muestras ya aterrizadas (|dz| ~ 2PI).
const TWO_PI = Math.PI * 2;
const midSpin = spin.filter((s) => {
  const d = Math.abs(s.rz - spinStart.rz);
  return d > 0.5 && d < TWO_PI - 0.5;
});
const maxRy = Math.max(0, ...midSpin.map((s) => Math.abs(s.ry - spinStart.ry)));
check(
  '3) el descarte gira en plano una vuelta completa (rz)',
  maxSpin > 4,
  `max|dz|=${maxSpin.toFixed(2)} rad de 2PI=${TWO_PI.toFixed(2)}`,
);
check(
  '3b) mientras gira NO hay flip (ry quieto)',
  maxRy < 0.05,
  `max|dry|=${maxRy.toFixed(3)} en ${midSpin.length} frames girando`,
);

// --- 4. Tick de seleccion: squash/stretch con valle negativo ---------------
await waitForHand(2);
const tickBase = await page.evaluate(() => {
  const scene = window.__fungiflush.scene;
  const card = [...scene.handCards.values()][0];
  if (!card) return null;
  window.__tickCard = card;
  return card.group.scale.x / card.group.scale.y;
});
if (tickBase === null) {
  console.error('No hay carta para seleccionar.');
  await browser.close();
  process.exit(1);
}
const TICK_SRC = '() => window.__fungiflush.engine.toggleSelect(window.__tickCard.uid)';
const tick = (await record(7000, READ_TICK, TICK_SRC, 300)).filter((r) => typeof r === 'number');
const tickPeak = Math.max(...tick);
const tickValley = Math.min(...tick);
const tickTail = tick.slice(-4);
const tickSettled = tickTail.every((r) => Math.abs(r - tickBase) < 0.004);
check(
  '4) el tick estira la carta al seleccionar',
  tickPeak > tickBase * 1.02 || tickValley < tickBase * 0.98,
  `pico=${tickPeak.toFixed(4)} valle=${tickValley.toFixed(4)} base=${tickBase.toFixed(4)}`,
);
check(
  '4b) el tick tiene valle negativo (rebote, no fundido)',
  tickValley < tickBase * 0.97,
  `valle=${tickValley.toFixed(4)} vs base=${tickBase.toFixed(4)}`,
);
check(
  '4c) el tick termina solo (vuelve a reposo)',
  tickSettled,
  `cola=${tickTail.map((r) => r.toFixed(4)).join('/')}`,
);

// --- 5. Tier low: cero anillos y cero estelas ------------------------------
await page.evaluate(() => window.__fungiflush.engine.clearSelection());
await waitForHand(2);
await page.evaluate(() => window.__fungiflush.scene.applyQuality('low', 'manual'));
await page.waitForTimeout(500);
await page.evaluate(() => {
  window.__play = window.__fungiflush.scene.handState().map((c) => c.uid).slice(0, 2);
});
const low = await record(2800, READ_LOW, PLAY_SRC, 400);
const lowRings = Math.max(...low.map((s) => s.fx.rings));
const lowTrails = Math.max(...low.map((s) => s.fx.trails));
const lowApplied = low.every((s) => s.motion.enabled === false);
check(
  '5) tier low: cero anillos y cero estelas',
  lowRings === 0 && lowTrails === 0,
  `rings=${lowRings} trails=${lowTrails}`,
);
check(
  '5b) el tier low quedo aplicado (la animacion se apago)',
  lowApplied,
  `motion.enabled=${low[0]?.motion.enabled}`,
);

console.log('\nerrores de consola:', errors.length ? errors.slice(0, 5) : 'ninguno');
const ok = results.every((r) => r.ok) && errors.length === 0;
console.log(ok ? '\nOK ANIMACIONES DE CARTA FUNCIONANDO' : '\nXX HAY ALGO MAL');
await browser.close();
process.exitCode = ok ? 0 : 1;
