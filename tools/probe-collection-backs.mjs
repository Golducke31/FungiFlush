/**
 * probe-collection-backs.mjs — Frente 4b (coleccion): cartas y Simbiontes sin
 * descubrir muestran el DORSO, no una cara vacia.
 *
 * EL BUG QUE PROTEGE
 * ------------------
 * El update del carrusel escribia `home.flip = 0` en CADA frame para mantener
 * las cartas planas. Eso pisaba el `setFaceUp(false)` que `applyCarouselEntry`
 * hace para una entrada no descubierta, asi que la carta giraba a su CARA —que
 * nunca recibio textura— y el resultado era un RECTANGULO GRIS. Se veia igual
 * en Especimenes que en Simbiontes: no era arte faltante, era la cara vacia.
 *
 * QUE VERIFICA
 * ------------
 *   1. Con la coleccion virgen, TODOS los slots visibles estan boca abajo
 *      (`home.flip === 1`) y su cara NO tiene textura aplicada.
 *   2. El dorso SI esta aplicado en cada slot (`backMaterial.map` con imagen).
 *   3. Ninguna carta visible queda "flip 0 sin textura de cara" (el rectangulo
 *      gris), que es exactamente la regresion.
 *   4. Al descubrir Simbiontes (via `joker:added`), los suyos pasan a boca
 *      arriba con cara CON textura.
 *
 * POR QUE SE CIERRA Y REABRE LA COLECCION EN EL PASO 4
 * ---------------------------------------------------
 * `main.ts` construye el `Set` de descubiertos UNA sola vez al arrancar
 * (`const seen = new Set(profile.collection.seenCardIds)`). Un `joker:added`
 * si actualiza ese Set en vivo, pero las ENTRADAS ya se armaron con
 * `buildCollection()` al abrir el panel. Por eso, para que el probe refleje
 * lo que veria un jugador nuevo, hay que CERRAR y REABRIR despues del emit:
 * la Coleccion se reconstruye con el Set ya actualizado.
 *
 * POR QUE HAY QUE ENTRAR A LA "EXHIBICION"
 * ----------------------------------------
 * Desde el Frente 5 la Coleccion abre en GRILLA, y los slots con DORSO son
 * caras WebGL que solo existen en el carrusel 3D. Por eso `openCollection`
 * remata con un click en `collection-view-carousel`: sin eso no hay carrusel
 * montado y este probe (que mide material de Three.js) leeria 0 slots.
 *
 *   node tools/probe-collection-backs.mjs
 *   FF_VIEWPORT=smoke node tools/probe-collection-backs.mjs
 */
import { existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const URL_TO_TEST = process.env.FF_URL ?? 'http://127.0.0.1:1420/?daily=0';
const VIEWPORT =
  process.env.FF_VIEWPORT === 'smoke'
    ? { width: 844, height: 390 }
    : { width: 915, height: 412 };

const PW = ['C:/Users/emanu/.workbuddy-ai/binaries/node/workspace/node_modules/playwright-core/index.js'];
async function loadPlaywright() {
  try {
    return await import('playwright-core');
  } catch {
    for (const c of PW) if (existsSync(c)) return await import(pathToFileURL(c).href);
    throw new Error('no playwright-core');
  }
}
const pw = await loadPlaywright();
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
const shotsDir = join(ROOT, 'tools', 'shots');
if (!existsSync(shotsDir)) mkdirSync(shotsDir, { recursive: true });

const browser = await chromium.launch({
  executablePath: exe,
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--disable-dev-shm-usage'],
});
const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 2 });
const page = await context.newPage();
const errors = [];
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

const click = (sel) => page.evaluate((s) => document.querySelector(s)?.click(), sel);
const wait = (ms) => page.waitForTimeout(ms);

let failures = 0;
const check = (ok, label, detail = '') => {
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
};

/** Foto de los slots visibles del carrusel. */
const slots = () =>
  page.evaluate(() => {
    const scene = window.__fungiflush.scene;
    return (scene.carousel?.slots ?? [])
      .filter((s) => s.card.group.visible)
      .map((s) => ({
        showBack: s.showBack,
        flip: s.card.home?.flip ?? null,
        faceMap: s.card.faceMaterial?.map != null,
        backMap: s.card.backMaterial?.map != null,
        backW: s.card.backMaterial?.map?.image?.width ?? null,
      }));
  });

/**
 * Abre la Coleccion y ENTRA A LA EXHIBICION (el carrusel 3D).
 *
 * Desde el Frente 5 la Coleccion abre en GRILLA por defecto, y las caras con
 * DORSO solo existen en el carrusel (un slot WebGL por carta). El boton
 * `collection-view-carousel` es el que cambia de vista, asi que sin este paso
 * `slots()` leeria 0: el carrusel no esta montado.
 */
const openCollection = async () => {
  await click('[data-act="tutorial-close"]');
  await wait(300);
  await click('[data-act="menu-toggle"]');
  await wait(400);
  await click('[data-act="collection"]');
  await wait(1400);
  await click('[data-act="collection-view-carousel"]');
  await wait(1600);
};

const closeCollection = async () => {
  await click('[data-act="close"]');
  await wait(900);
};

await page.goto(URL_TO_TEST, { waitUntil: 'load', timeout: 45000 });
await page.waitForFunction(() => Boolean(window.__fungiflush?.engine?.run), { timeout: 30000 });
await wait(1800);
await openCollection();

// --- 1/2/3. Coleccion virgen: todo boca abajo y con dorso ---
const initial = await slots();
console.log('--- coleccion virgen ---');
console.log(JSON.stringify(initial));
check(initial.length > 0, 'hay slots visibles en el carrusel', `${initial.length}`);
check(initial.every((s) => s.flip === 1), 'todas las cartas sin descubrir estan BOCA ABAJO', JSON.stringify(initial.map((s) => s.flip)));
check(initial.every((s) => s.backMap), 'todas tienen el DORSO aplicado');
check(
  initial.every((s) => s.backW && s.backW > 0),
  'la textura del dorso tiene imagen real',
  JSON.stringify(initial.map((s) => s.backW)),
);
// La REGRESION exacta: flip 0 (cara) sin textura de cara = rectangulo gris.
const greyCards = initial.filter((s) => s.flip === 0 && !s.faceMap);
check(greyCards.length === 0, 'ninguna carta visible es "cara sin textura" (el rectangulo gris)', `${greyCards.length}`);
await page.screenshot({ path: join(shotsDir, 'probe-collection-backs.png') });

// --- 4. Descubrir Simbiontes: sus slots pasan a cara CON textura ---
// `joker:added` actualiza el Set de descubiertos EN VIVO, pero las entradas ya
// se armaron al abrir el panel: hay que reabrir la Coleccion para reconstruirla.
await page.evaluate(() => {
  const ff = window.__fungiflush;
  for (const def of ff.engine.registry.allJokers()) {
    ff.bus.emit('joker:added', { joker: ff.engine.registry.instantiateJoker(def.id) });
  }
});
await wait(400);
await closeCollection();
await openCollection();
await click('[data-act="filter-jokers"]');
await wait(1600);
const discovered = await slots();
console.log('--- simbiontes descubiertos ---');
console.log(JSON.stringify(discovered));
check(discovered.length > 0, 'hay Simbiontes visibles tras el filtro');
// `allJokers()` excluye las MUTACIONES, pero la Coleccion muestra ambas, asi
// que no todos los slots visibles quedan descubiertos. Lo que importa:
//   a) los descubiertos SI van boca arriba con cara texturada;
//   b) NINGUN slot queda en el rectangulo gris (flip 0 sin textura de cara).
const faceUp = discovered.filter((s) => s.flip === 0);
const greyDiscovered = discovered.filter((s) => s.flip === 0 && !s.faceMap);
check(faceUp.length > 0, 'los Simbiontes descubiertos van BOCA ARRIBA', `${faceUp.length} boca arriba`);
check(
  faceUp.every((s) => s.faceMap),
  'todo slot boca arriba tiene cara CON textura',
  JSON.stringify(faceUp.map((s) => ({ flip: s.flip, faceMap: s.faceMap }))),
);
check(greyDiscovered.length === 0, 'ningun Simbionte descubierto queda como rectangulo gris', `${greyDiscovered.length}`);
check(
  discovered.filter((s) => s.flip === 1).every((s) => s.backMap),
  'los Simbiontes sin descubrir conservan el DORSO',
);
await page.screenshot({ path: join(shotsDir, 'probe-collection-backs-face.png') });

console.log('---');
console.log(`viewport ${VIEWPORT.width}x${VIEWPORT.height} · fallos: ${failures}`);
console.log('errores de consola:', errors.length ? errors.slice(0, 5) : 'ninguno');
if (errors.length) failures += 1;
await browser.close();
process.exit(failures > 0 ? 1 : 0);
