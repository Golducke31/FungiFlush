/**
 * probe-discard-flight.mjs — Mide el vuelo de las cartas jugadas al DESCARTE.
 *
 * Reproduce el bug de movil: al jugar una mano, las cartas hacen el flip y se
 * quedan COLGADAS en el centro en vez de llegar a la pila de descarte.
 *
 * Que mide: arranca una run en viewport MOVIL, selecciona cartas y juega.
 * Mientras corre el vuelo samplea por frame la posicion de todas las cartas
 * vivas (via `scene.cardFlightDebug()`, que incluye las que vuelan). Un vuelo
 * real termina con las cartas cerca de `discardX` y en `DISCARD_Z`; si estan
 * colgadas se quedan clavadas cerca del centro (x ~ 0, z = PLAY_Z).
 *
 *   node tools/probe-discard-flight.mjs
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
  viewport: { width: 844, height: 390 },
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

await page.evaluate(() => document.querySelector('.panel.is-menu [data-act="new"]')?.click());
await page.waitForTimeout(1000);
await page.evaluate(() =>
  document.querySelector('.panel.is-archetypes [data-act="archetypes-start"]')?.click(),
);
// El arranque deja la run en `blind_select`: hay que elegir ciego para que la
// mano se reparta. Se espera a que la run exista y despues se elige.
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
);// Se espera a que el reparto de apertura termine de asentar las cartas.
await page.waitForTimeout(2200);

const handBefore = await page.evaluate(() =>
  window.__fungiflush.scene.handState().map((c) => c.uid),
);
console.log('mano inicial:', handBefore.length, 'cartas');

// Se juega por el camino REAL del motor: seleccionar y `playHand`.
const target = handBefore.slice(0, 3);
if (target.length === 0) {
  console.error('La mano vino vacia: la run no arranco.');
  await browser.close();
  process.exit(1);
}

// Se empieza a samplear ANTES de jugar para capturar todo el vuelo.
const sampling = page.evaluate((uids) => {
  const scene = window.__fungiflush.scene;
  const seen = new Map();
  const t0 = performance.now();
  let frames = 0;
  return new Promise((resolve) => {
    const snap = () => {
      for (const c of scene.cardFlightDebug()) {
        const arr = seen.get(c.uid) ?? [];
        arr.push({ x: c.x, z: c.z, t: Math.round(performance.now() - t0) });
        seen.set(c.uid, arr);
      }
      frames++;
      if (frames < 180) requestAnimationFrame(snap);
      else {
        resolve({
          seen: Object.fromEntries(seen),
          discardX: scene['discardX'],
          discardZ: scene['discardZ'] ?? null,
          watched: uids,
        });
      }
    };
    requestAnimationFrame(snap);
  });
}, target);

await page.waitForTimeout(120);
await page.evaluate((uids) => {
  const engine = window.__fungiflush.engine;
  for (const uid of uids) engine.toggleSelect(uid);
}, target);
await page.waitForTimeout(200);
await page.evaluate(() => {
  const hud = window.__fungiflush.hud;
  const btn = document.querySelector('[data-act="play"]');
  if (btn) btn.click();
  else hud?.clickPlay?.();
});

const result = await sampling;
const discardX = result.discardX;
console.log('discardX:', discardX);

// Se evaluan solo las cartas JUGADAS (las que viajan al descarte).
let best = null;
const rows = [];
for (const uid of target) {
  const arr = result.seen[uid];
  if (!arr || arr.length < 8) {
    rows.push(`${uid.slice(0, 10)} : sin muestras (se destruyo muy rapido?)`);
    continue;
  }
  const last = arr[arr.length - 1];
  const dx = Math.abs(last.x - discardX);
  rows.push(`${uid.slice(0, 10)} : ultima x=${last.x.toFixed(3)} z=${last.z.toFixed(3)} -> dist a descarte=${dx.toFixed(3)}`);
  if (!best || dx < best.dx) best = { uid, dx, x: last.x, z: last.z };
}
console.log('cartas jugadas:');
for (const r of rows) console.log('  ', r);

const ok = Boolean(best) && best.dx < 0.35 && errors.length === 0;
console.log('\nerrores de consola:', errors.length ? errors.slice(0, 4) : 'ninguno');
console.log(ok ? '\nOK EL VUELO AL DESCARTE LLEGA' : '\nXX SE CUELGAN EN VUELO');
await browser.close();
process.exitCode = ok ? 0 : 1;
