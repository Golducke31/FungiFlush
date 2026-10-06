/**
 * probe-audio.mjs — Verifica la capa de audio.
 *
 * Comprueba, en orden:
 *   1. ANTES del primer gesto el `AudioContext` NO existe (el navegador lo
 *      prohibe hasta que haya interaccion).
 *   2. Despues del primer click: el contexto esta `running`, el manifiesto
 *      cargo y los 9 SFX quedaron DECODIFICADOS en memoria.
 *   3. La musica del MENU esta sonando (elemento no pausado, currentTime > 0).
 *   4. Mover el slider de volumen cambia la ganancia REAL del grafo.
 *   5. Al entrar a una partida, la musica cambia al tema INGAME.
 *
 *   node tools/probe-audio.mjs
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
if (!exe) { console.error('No hay Chromium.'); process.exit(1); }
const shotsDir = join(ROOT, 'tools', 'shots');
if (!existsSync(shotsDir)) mkdirSync(shotsDir, { recursive: true });

const browser = await chromium.launch({
  executablePath: exe, headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--disable-dev-shm-usage'],
});
const context = await browser.newContext({ viewport: { width: 915, height: 412 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const page = await context.newPage();
const errors = [];
const audioRequests = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('response', (r) => { if (r.url().includes('/audio/')) audioRequests.push(`${r.status()} ${r.url().split('/audio/')[1]}`); });

await page.goto(URL_TO_TEST, { waitUntil: 'load', timeout: 45000 });
await page.waitForFunction(() => Boolean(window.__fungiflush?.engine?.run), { timeout: 30000 });
await page.waitForTimeout(1800);

const state = () => page.evaluate(() => {
  const a = window.__fungiflush?.audio;
  if (!a) return { none: true };
  const music = a['music'] instanceof Map ? a['music'] : new Map();
  return {
    unlocked: a.isUnlocked,
    ctxState: a['ctx']?.state ?? null,
    buffers: a['buffers']?.size ?? 0,
    files: a['files']?.size ?? 0,
    currentMusic: a.currentMusic ?? null,
    sfxVolume: a.getVolume('sfx'),
    musicVolume: a.getVolume('music'),
    sfxGain: a['sfxGain']?.gain?.value ?? null,
    musicGain: a['musicGain']?.gain?.value ?? null,
    tracks: [...music.keys()].map((k) => {
      const e = music.get(k);
      return { id: k, paused: e.el.paused, t: Math.round(e.el.currentTime * 10) / 10, gain: Math.round(e.gain.gain.value * 100) / 100 };
    }),
  };
});

// --- 1. Antes del gesto ---
console.log('1) antes del gesto:', JSON.stringify(await state()));

// --- 2. Primer gesto (desbloqueo) ---
await page.mouse.click(460, 300);
await page.waitForTimeout(1800);
const after = await state();
console.log('2) tras el gesto :', JSON.stringify(after));

// --- 3. Unos cuantos SFX reales ---
await page.evaluate(() => {
  const a = window.__fungiflush.audio;
  a.play('select');
  a.play('select');
  a.play('discard');
  a.onDiscarded();
  a.onDiscarded();
  a.play('coin');
});
await page.waitForTimeout(600);
console.log('3) SFX disparados (select x2, discard, tanda x2, coin)');

// --- 4. Volumen en vivo ---
await page.evaluate(() => window.__fungiflush.audio.setVolume('sfx', 0.25));
await page.waitForTimeout(150);
const vol = await state();
console.log(`4) sfxVolume 0.25 -> ganancia real ${vol.sfxGain}`);
await page.evaluate(() => window.__fungiflush.audio.setVolume('sfx', 0.8));
await page.waitForTimeout(150);

// --- 5. Musica por estado ---
await page.evaluate(() => document.querySelector('[data-act="tutorial-close"]')?.click());
await page.waitForTimeout(300);
await page.evaluate(() => document.querySelector('.panel.is-menu [data-act="new"]')?.click());
await page.waitForTimeout(900);
await page.evaluate(() => document.querySelector('[data-act="archetypes-start"]')?.click());
await page.waitForTimeout(2500);
const inRun = await state();
console.log('5) en partida     :', JSON.stringify({ music: inRun.currentMusic, tracks: inRun.tracks }));

await page.screenshot({ path: join(shotsDir, 'audio-probe.png') });

console.log('\npeticiones a /audio/:', audioRequests.length ? audioRequests.join(' | ') : 'NINGUNA');
console.log('errores de consola :', errors.length ? errors.slice(0, 5) : 'ninguno');

const ok =
  after.unlocked === true &&
  after.ctxState === 'running' &&
  after.buffers === 9 &&
  after.currentMusic === 'menu' &&
  after.tracks.some((t) => t.id === 'menu' && !t.paused) &&
  vol.sfxGain === 0.25 &&
  inRun.currentMusic === 'ingame' &&
  errors.length === 0;
console.log(ok ? '\nOK AUDIO FUNCIONANDO' : '\nXX HAY ALGO MAL');
await browser.close();
process.exitCode = ok ? 0 : 1;
