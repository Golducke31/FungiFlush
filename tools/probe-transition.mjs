// Diagnostico de TRANSICION (el pass que SI fuerza alpha=1.0): ¿al barrer la
// transicion de pantalla el canvas se vuelve opaco y esconde el fondo de arena?
// A. idle playing (baseline, ya validado: canvas transparente, arena visible)
// B. transicion forzada via scene.postFx.transition.begin()  -> captura mid
// C. pulso de combo forzado (bgPulse=1)                         -> flash calido
// La tira magenta confirma visualmente cuando el canvas pasa a opaco.
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
await page.waitForTimeout(1500);

await page.evaluate(async () => {
  const ff = window.__fungiflush;
  await ff.runStore.clear();
  ff.engine.startRun(0xf00d, 0, '');
  const blinds = ff.engine.availableBlinds();
  ff.engine.chooseBlind(blinds[1]?.id ?? blinds[0]?.id);
});
await page.waitForTimeout(6500);

const diag = await page.evaluate(() => {
  const ff = window.__fungiflush;
  return {
    status: ff?.engine?.run?.status,
    tier: ff?.scene?.quality?.()?.tier,
    composer: ff?.scene?.postFx ? 'composer' : 'directo',
    hasPostFx: !!ff?.scene?.postFx,
    hasPostFxTransition: !!(ff?.scene?.postFx?.transition),
  };
});
console.log('diag:', JSON.stringify(diag));

// Tira magenta detras del canvas.
await page.evaluate(() => {
  const canvas = document.getElementById('fungiflush-canvas');
  const div = document.createElement('div');
  div.id = 'probe-magenta';
  div.style.cssText = `position:fixed;left:2px;top:80px;width:8px;height:${Math.max(40, 412 - 160)}px;background:#ff00ff;z-index:1;pointer-events:none;`;
  if (canvas && canvas.parentNode) canvas.parentNode.insertBefore(div, canvas);
});
await page.waitForTimeout(250);

// --- A. baseline ---
await page.screenshot({ path: 'tools/shots/tr-A-idle.png' });
console.log('shot: tools/shots/tr-A-idle.png');

// --- B. TRANSICION forzada ---
const tBegin = await page.evaluate(async () => {
  const ff = window.__fungiflush;
  const s = ff.scene;
  const tp = s?.postFx?.transition;
  if (!tp) return 'no-transition-pass';
  try {
    tp.begin(s.renderer, s.scene, s.rig?.camera, 1.1);
    return { enabled: tp.enabled, progress: tp.progress };
  } catch (e) { return 'err:' + e.message; }
});
console.log('transition begin:', JSON.stringify(tBegin));

// Mid-transition: ~400ms (la duracion total es 1100ms).
await page.waitForTimeout(380);
await page.screenshot({ path: 'tools/shots/tr-B-mid.png' });
console.log('shot: tools/shots/tr-B-mid.png');

// Casi al final de la transicion: ~900ms.
await page.waitForTimeout(520);
await page.screenshot({ path: 'tools/shots/tr-B-late.png' });
console.log('shot: tools/shots/tr-B-late.png');

// Dejamos terminar la transicion.
await page.waitForTimeout(400);

// --- C. PULSO de combo ---
await page.evaluate(async () => {
  const s = window.__fungiflush?.scene;
  for (let i = 0; i < 8; i++) { try { s.bgPulse = 1; } catch {} await new Promise(r => setTimeout(r, 40)); }
});
await page.waitForTimeout(120);
await page.screenshot({ path: 'tools/shots/tr-C-pulse.png' });
console.log('shot: tools/shots/tr-C-pulse.png');

await browser.close();
console.log('DONE');