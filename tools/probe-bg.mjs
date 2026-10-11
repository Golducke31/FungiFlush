// Diagnostico: fondo de arena negro (#1).
// Verifica (a) si #arena-bg resuelve la imagen y (b) si el canvas WebGL conserva
// alpha en las esquinas (sin geometria) -> si el composer lo vuelve opaco negro.
import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const PWC = ['C:/Users/emanu/.workbuddy-ai/binaries/node/workspace/node_modules/playwright-core/index.js'];
async function loadPlaywright() {
  try { return await import('playwright-core'); }
  catch { for (const c of PWC) if (existsSync(c)) return await import(pathToFileURL(c).href); throw new Error('no pw'); }
}
const pw = await loadPlaywright();
const chromium = pw.chromium ?? pw.default?.chromium;

const URL_TO_TEST = process.env.FF_URL ?? 'http://127.0.0.1:1420/?daily=0&quality=high';
const W = Number(process.env.FF_W) || 915;
const H = Number(process.env.FF_H) || 412;

const exe = [
  'C:/Users/emanu/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe',
  'C:/Users/emanu/AppData/Local/ms-playwright/chromium-1228/chrome-win64/chrome.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
].find((p) => existsSync(p));
if (!exe) { console.error('No hay Chromium.'); process.exit(1); }

const browser = await chromium.launch({
  executablePath: exe,
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--disable-dev-shm-usage'],
});
const page = await browser.newContext({ viewport: { width: W, height: H }, isMobile: true, hasTouch: true }).then(c => c.newPage());
page.on('console', m => { if (m.type() === 'error') console.log('  [console.error]', m.text()); });
page.on('pageerror', e => console.log('  [pageerror]', e.message));

await page.goto(URL_TO_TEST, { waitUntil: 'load', timeout: 45000 });
await page.waitForTimeout(1200);

// Llevar a estado 'playing' para tener escena WebGL viva.
const reached = await page.evaluate(() => {
  const ff = window.__fungiflush;
  if (!ff) return 'no __fungiflush';
  try { ff.startRun?.(); ff.chooseBlind?.(0); return 'playing'; } catch (e) { return 'err:' + e.message; }
});
console.log('reached:', reached);
await page.waitForTimeout(900);

const info = await page.evaluate(() => {
  const bg = document.getElementById('arena-bg');
  const cs = getComputedStyle(bg);
  const bgImg = cs.backgroundImage;
  // Resolver la URL y hacer HEAD para ver si carga.
  let url = null;
  const m = bgImg.match(/url\("?([^")]+)"?\)/);
  if (m) url = new URL(m[1], location.href).href;
  const canvas = document.getElementById('fungiflush-canvas');
  const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
  return {
    bgImg,
    bgUrl: url,
    bgColor: cs.backgroundColor,
    canvasW: canvas.width, canvasH: canvas.height,
    hasGL: !!gl,
  };
});
console.log('arena-bg bgImage:', info.bgImg);
console.log('arena-bg bgUrl  :', info.bgUrl);
console.log('arena-bg color  :', info.bgColor);

// Comprobar que la imagen del fondo carga (como <img>, no solo HEAD).
if (info.bgUrl) {
  const load = await page.evaluate(async (u) => {
    return await new Promise((res) => {
      const i = new Image();
      i.onload = () => res({ ok: true, w: i.naturalWidth, h: i.naturalHeight });
      i.onerror = () => res({ ok: false });
      i.src = u;
    });
  }, info.bgUrl);
  console.log('backdrop load :', JSON.stringify(load));
}

// Comprobar alpha del canvas en una esquina (sin geometria).
const alpha = await page.evaluate(() => {
  const ff = window.__fungiflush;
  const scene = ff?.scene;
  const renderer = scene?.renderer ?? (window.__fungiflush?.engine && null);
  let r = { method: 'n/a' };
  try {
    // Usar el renderer del scene manager para hacer readPixels en el framebuffer de pantalla.
    const rr = window.__fungiflush?.renderer ?? scene?.renderer;
    if (rr && rr.getContext) {
      const gl = rr.getContext();
      const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
      const px = new Uint8Array(4);
      // Leer esquina superior izquierda (sin cartas ahi).
      gl.readPixels(2, h - 4, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      r = { method: 'gl.readPixels corner', w, h, corner: Array.from(px) };
    }
  } catch (e) { r = { method: 'gl-error', msg: e.message }; }
  return r;
});
console.log('canvas alpha   :', JSON.stringify(alpha));

await page.screenshot({ path: 'tools/shots/bg-probe.png' });
console.log('screenshot -> tools/shots/bg-probe.png');

await browser.close();
