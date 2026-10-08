/**
 * probe-joker-art.mjs — F6: cada SIMBIONTE tiene su propia ilustracion.
 *
 * Verifica que, despues de cablear `artKeysForJoker(jokerId)` + `jokerArt(def.id)`:
 *   1. Dos simbiontes distintos componen caras DISTINTAS (arte procedural propio).
 *   2. Ningun simbionte compone la cara de una CARTA (el bug anterior).
 *
 *   node tools/probe-joker-art.mjs
 */
import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const PW = 'C:/Users/emanu/.workbuddy-ai/binaries/node/workspace/node_modules/playwright-core/index.js';
const pw = await import(pathToFileURL(PW).href);
const chromium = pw.chromium ?? pw.default?.chromium;
const exe = 'C:/Users/emanu/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe';
if (!existsSync(exe)) { console.error('No hay Chromium.'); process.exit(1); }

const browser = await chromium.launch({
  executablePath: exe,
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--disable-dev-shm-usage'],
});
const context = await browser.newContext({
  viewport: { width: 915, height: 412 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
});
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));

await page.goto('http://127.0.0.1:1420/?daily=0', { waitUntil: 'load', timeout: 45000 });
await page.waitForFunction(() => Boolean(window.__fungiflush?.content?.registry?.poolOf), { timeout: 30000 });
await page.waitForTimeout(1200);

const result = await page.evaluate(() => {
  const ff = window.__fungiflush;
  const reg = ff.content.registry;
  const find = (kind, id) => reg.poolOf(kind).find((d) => d.id === id);
  const jA = find('joker', 'joker_spore_printer');
  const jB = find('joker', 'joker_poison_bloom');
  const jC = find('joker', 'joker_double_helix');
  const card = find('card', 'card_crystal_common') ?? reg.poolOf('card')[0];
  const faceA = jA ? ff.jokerDefFaceUrl(jA) : null;
  const faceB = jB ? ff.jokerDefFaceUrl(jB) : null;
  const faceC = jC ? ff.jokerDefFaceUrl(jC) : null;
  const cardFace = card ? ff.cardDefFaceUrl(card) : null;
  return {
    hasA: !!faceA && faceA.startsWith('data:image'),
    hasB: !!faceB && faceB.startsWith('data:image'),
    hasC: !!faceC && faceC.startsWith('data:image'),
    hasCard: !!cardFace && cardFace.startsWith('data:image'),
    aEqB: faceA === faceB,
    aEqC: faceA === faceC,
    bEqC: faceB === faceC,
    aEqCard: faceA === cardFace,
    bEqCard: faceB === cardFace,
    cEqCard: faceC === cardFace,
    lenA: faceA ? faceA.length : 0,
    lenB: faceB ? faceB.length : 0,
    lenCard: cardFace ? cardFace.length : 0,
    // Muestras para descartar que sean el mismo PNG byte-a-byte.
    headA: faceA ? faceA.slice(0, 64) : '',
  };
});

let failures = 0;
const check = (ok, label, detail = '') => {
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
};

console.log(JSON.stringify({ ...result, headA: undefined }, null, 2));
check(result.hasA && result.hasB && result.hasC, 'F6: los 3 simbiontes componen cara');
check(result.hasCard, 'F6: la carta compone cara (control)');
check(!result.aEqB, 'F6: simbionte A != simbionte B (arte propio distinto)', `iguales=${result.aEqB}`);
check(!result.aEqC, 'F6: simbionte A != simbionte C', `iguales=${result.aEqC}`);
check(!result.bEqC, 'F6: simbionte B != simbionte C', `iguales=${result.bEqC}`);
check(!result.aEqCard, 'F6: simbionte A NO es la cara de una carta', `iguales=${result.aEqCard}`);
check(!result.bEqCard, 'F6: simbionte B NO es la cara de una carta', `iguales=${result.bEqCard}`);
check(!result.cEqCard, 'F6: simbionte C NO es la cara de una carta', `iguales=${result.cEqCard}`);

console.log('\n---');
console.log(`fallos: ${failures}`);
console.log('errores de pagina:', errors.length ? errors.slice(0, 5) : 'ninguno');
if (errors.length) failures += 1;
await browser.close();
process.exit(failures > 0 ? 1 : 0);
