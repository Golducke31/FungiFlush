/**
 * export-joker-faces.mjs — Vuelca caras de simbiontes a PNG para inspeccion.
 *
 *   node tools/export-joker-faces.mjs
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const PW = 'C:/Users/emanu/.workbuddy-ai/binaries/node/workspace/node_modules/playwright-core/index.js';
const pw = await import(pathToFileURL(PW).href);
const chromium = pw.chromium ?? pw.default?.chromium;
const exe = 'C:/Users/emanu/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe';
if (!existsSync(exe)) { console.error('No hay Chromium.'); process.exit(1); }

const OUT = 'tools/shots';
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  executablePath: exe,
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--disable-dev-shm-usage'],
});
const context = await browser.newContext({
  viewport: { width: 915, height: 412 },
  deviceScaleFactor: 2,
});
const page = await context.newPage();
await page.goto('http://127.0.0.1:1420/?daily=0', { waitUntil: 'load', timeout: 45000 });
await page.waitForFunction(() => Boolean(window.__fungiflush?.content?.registry?.poolOf), { timeout: 30000 });
await page.waitForTimeout(1000);

const ids = [
  'joker_spore_printer', 'joker_poison_bloom', 'joker_crystal_lens', 'joker_mycelial_network',
  'joker_eldritch_ring', 'joker_double_helix', 'joker_trametes', 'joker_loaded_die',
];
const faces = await page.evaluate((ids) => {
  const ff = window.__fungiflush;
  const find = (kind, id) => ff.content.registry.poolOf(kind).find((d) => d.id === id);
  const out = {};
  for (const id of ids) {
    const def = find('joker', id);
    if (def) out[id] = ff.jokerDefFaceUrl(def);
  }
  return out;
}, ids);

let n = 0;
for (const [id, dataUrl] of Object.entries(faces)) {
  if (!dataUrl?.startsWith('data:image')) continue;
  const b64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
  writeFileSync(`${OUT}/joker-${id.replace('joker_', '')}.png`, Buffer.from(b64, 'base64'));
  n += 1;
}
console.log(`Exportadas ${n} caras de simbionte en ${OUT}/`);
await browser.close();
