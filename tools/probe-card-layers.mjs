/**
 * probe-card-layers.mjs — Verifica el PARALLAX de las capas del arte en el juego.
 *
 * QUE MIDE
 * --------
 * 1. Que las cartas de la mano esten usando la ruta con CAPAS (no la textura unica).
 * 2. La posicion de las mallas `bg`/`fg` en el mundo, y cuanto se corren al inclinar
 *    la carta: es el parallax real, y hasta ahora era de ~1 px (invisible).
 * 3. Que el `fg` NO sea aditivo-negro (una capa oscura) — se mira el material.
 * 4. Un screenshot de la mano y otro de una carta inclinada, para revisar a ojo.
 *
 *   node tools/probe-card-layers.mjs
 */
import { existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const URL_TO_TEST = process.env.FF_URL ?? 'http://127.0.0.1:1420/?daily=0';
const PW = ['C:/Users/emanu/.workbuddy-ai/binaries/node/workspace/node_modules/playwright-core/index.js'];
async function loadPlaywright() {
  try { return await import('playwright-core'); }
  catch { for (const c of PW) if (existsSync(c)) return await import(pathToFileURL(c).href); throw new Error('no pw'); }
}
const pw = await loadPlaywright();
const chromium = pw.chromium ?? pw.default?.chromium;
const exe = [
  'C:/Users/emanu/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe',
  'C:/Users/emanu/AppData/Local/ms-playwright/chromium-1228/chrome-win64/chrome.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
].find((p) => existsSync(p));
if (!exe) { console.error('no chromium'); process.exit(1); }
const shotsDir = join(ROOT, 'tools', 'shots');
if (!existsSync(shotsDir)) mkdirSync(shotsDir, { recursive: true });

const browser = await chromium.launch({
  executablePath: exe, headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--disable-dev-shm-usage'],
});
const context = await browser.newContext({ viewport: { width: 915, height: 412 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const page = await context.newPage();
page.on('pageerror', (e) => console.error('[pageerror]', e.message));
const click = (sel) => page.evaluate((s) => document.querySelector(s)?.click(), sel);
const has = (sel) => page.evaluate((s) => Boolean(document.querySelector(s)), sel);

await page.goto(URL_TO_TEST, { waitUntil: 'load', timeout: 45000 });
await page.waitForFunction(() => Boolean(window.__fungiflush?.engine?.run), { timeout: 30000 });
await page.waitForTimeout(1800);
await click('[data-act="tutorial-close"]');
await click('.panel.is-menu [data-act="new"]');
await page.waitForTimeout(700);
if (await has('.panel.is-archetypes')) { await click('[data-act="archetypes-start"]'); await page.waitForTimeout(1200); }
await click('[data-act="tutorial-close"]');
await page.waitForFunction(() => Boolean(document.querySelector('.panel.is-blind-select')), { timeout: 12000 }).catch(() => {});
await page.evaluate(() => window.__fungiflush.engine.chooseBlind());
await page.waitForFunction(() => (window.__fungiflush?.engine?.round?.hand?.length ?? 0) > 0, { timeout: 15000 });
await page.waitForTimeout(2500);

const report = await page.evaluate(() => {
  const s = window.__fungiflush.scene;
  // `handCards`/`jokerCards` son `private` en TS: el modificador se borra en
  // runtime, asi que la propiedad existe en la instancia. Se usa eso en vez de
  // recorrer el grafo (los grupos no llevan una marca buscable).
  const maps = [s.handCards, s.jokerCards].filter(Boolean);
  const all = [];
  for (const m of maps) for (const c of m.values()) all.push(c);
  const out = [];
  for (const c of all) {
    const bg = c.bgLayer, fg = c.fgLayer;
    if (!bg || !fg) continue;
    out.push({
      uid: c.uid,
      bgVisible: bg.visible,
      fgVisible: fg.visible,
      bgZ: Number(bg.position.z.toFixed(4)),
      fgZ: Number(fg.position.z.toFixed(4)),
      bgScale: Number(bg.scale.x.toFixed(4)),
      fgScale: Number(fg.scale.x.toFixed(4)),
      fgAdditive: fg.material?.blending === 2,
      fgToneMapped: fg.material?.toneMapped,
    });
  }
  return out;
});

console.log(`cartas con capas: ${report.length}`);
for (const r of report.slice(0, 6)) console.log(' ', JSON.stringify(r));

if (report.length) {
  const r = report[0];
  const gap = r.fgZ - r.bgZ;
  console.log(`\nseparacion bg<->fg: ${gap.toFixed(3)} unidades de mundo`);
  console.log(`escala bg=${r.bgScale}  fg=${r.fgScale} (compensacion de perspectiva)`);
  console.log(`fg aditivo: ${r.fgAdditive}   toneMapped: ${r.fgToneMapped}`);
  // Parallax en px a distancia tipica de movil (aspect 2.22, ancho 16.4):
  const dist = (16.4 * 1.04) / 2.22 / (2 * Math.tan((40 * Math.PI) / 180 / 2));
  for (const tilt of [0.15, 0.35]) {
    const px = (gap * Math.sin(tilt) / dist) * 512;
    console.log(`  tilt ${tilt} rad -> ${px.toFixed(1)} px de corrimiento relativo`);
  }
}

await page.screenshot({ path: join(shotsDir, 'card-layers-hand.png') });
console.log('\nshot: tools/shots/card-layers-hand.png');

// --- Hero: una carta inclinada a mano, para ver el parallax en una imagen ---
// Se fuerza el tilt directo en `home.rx`/`ry` (no hay gesto de hover en
// headless) y se apaga el idle para que las capas queden en su sitio base: el
// corrimiento que se ve es SOLO el de perspectiva, que es el que importa.
await page.evaluate(() => {
  const s = window.__fungiflush.scene;
  const c = [...(s.handCards?.values() ?? [])][0];
  if (c) { c.home.ry = 0.55; c.update(0.016, 0); }
});
await page.waitForTimeout(600);
await page.screenshot({ path: join(shotsDir, 'card-layers-tilt.png') });
console.log('shot: tools/shots/card-layers-tilt.png');

await browser.close();
