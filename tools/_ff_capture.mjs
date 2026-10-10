// _ff_capture.mjs — Captura los fotogramas clave del VFX FungiFlush.
// Uso: node tools/_ff_capture.mjs
//
// IMPORTANTE: `page.screenshot()` NO incluye el contenido de un canvas WebGL
// en headless Chromium (es el bug clasico de `preserveDrawingBuffer:false`).
// Para sacarle pixeles de verdad se usa `canvas.toDataURL()`, que fuerza un
// readback sincronico y SIEMPRE devuelve el frame actual.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'tools', 'ff-shots');
mkdirSync(OUT, { recursive: true });

const URL_TO_TEST = (process.env.FF_URL ?? 'http://127.0.0.1:1420/tools/ff-harness.html') + '?i=1';

const PW_CANDIDATES = [
  'C:/Users/emanu/.workbuddy-ai/binaries/node/workspace/node_modules/playwright-core/index.js',
];
async function loadPlaywright() {
  try {
    return await import('playwright-core');
  } catch {
    for (const c of PW_CANDIDATES) if (existsSync(c)) return await import(pathToFileURL(c).href);
    throw new Error('No se encontro playwright-core.');
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
  viewport: { width: 960, height: 540 },
  deviceScaleFactor: 1.5,
});
const page = await context.newPage();
page.on('console', (m) => {
  console.log('[' + m.type() + ']', m.text());
});
page.on('pageerror', (e) => console.error('[pageerror]', e.message));

await page.goto(URL_TO_TEST, { waitUntil: 'load', timeout: 45000 });
await page.waitForFunction(() => Boolean(window.__ff && window.__ff.element), { timeout: 20000 });
await page.waitForTimeout(400);

const probe = await page.evaluate(() => {
  const c = document.querySelector('.fungi-canvas');
  const gl = c?.getContext('webgl2') ?? c?.getContext('webgl');
  // Lee el pixel central y una cuadricula 5x5 para ver si hay algo.
  let pixels = '';
  try {
    const cx = Math.floor(c.width / 2);
    const cy = Math.floor(c.height / 2);
    const px = new Uint8Array(4 * 25);
    gl.readPixels(cx - 2, cy - 2, 5, 5, gl.RGBA, gl.UNSIGNED_BYTE, px);
    pixels = Array.from(px).join(',');
  } catch (e) {
    pixels = 'err:' + e.message;
  }
  // Escena: cuenta letras y mira el rango de dibujo de los puntos.
  const fx = window.__ff;
  const lettersCount = fx?.letters?.length ?? -1;
  const drawRange = fx?.pointsGeo?.drawRange;
  return {
    canvas: !!c,
    cw: c?.width,
    ch: c?.height,
    hasGL: !!gl,
    busy: fx?.busy,
    intensity: fx?.intensity,
    lettersCount,
    drawRange: drawRange ? { start: drawRange.start, count: drawRange.count } : null,
    centralPixels: pixels,
  };
});
console.log('[probe]', JSON.stringify(probe));

// Espera delta entre fotogramas y lee el canvas con toDataURL. El `rAF` previo
// asegura que la ultima paint del overlay se haya presentado antes del readback.
async function grab(name) {
  const dataUrl = await page.evaluate(
    () =>
      new Promise((resolve) => {
        requestAnimationFrame(() => {
          const c = document.querySelector('.fungi-canvas');
          try {
            resolve(c?.toDataURL('image/png') ?? '');
          } catch (e) {
            resolve('ERR:' + e.message);
          }
        });
      }),
  );
  if (!dataUrl || dataUrl.startsWith('ERR')) {
    console.error('toDataURL fallo para', name, dataUrl);
    return;
  }
  const b64 = dataUrl.replace(/^data:image\/png;base64,/, '');
  const path = join(OUT, `${name}.png`);
  writeFileSync(path, Buffer.from(b64, 'base64'));
  console.log('capturado', name, '->', path);
}

const frames = [
  { t: 350, name: '01-charge' },
  { t: 900, name: '02-impact' },
  { t: 1500, name: '03-letters-land' },
  { t: 2400, name: '04-hold' },
  { t: 3300, name: '05-outro' },
  { t: 4100, name: '06-end' },
];

let prev = 0;
for (const f of frames) {
  await page.waitForTimeout(f.t - prev);
  prev = f.t;
  await grab(f.name);
}

await browser.close();
console.log('listo');

