/**
 * probe-combo.mjs — Verifica el escalado del COMBO (F3).
 *
 * Comprueba, jugando una mano de verdad:
 *   1. Los numeros flotantes CRECEN con el paso: el ultimo se dibuja mas grande
 *      que el primero (`--pop-scale` de 1 a 1.5).
 *   2. El paso multiplicador (`xN`) se pinta DORADO y no como una suma mas.
 *   3. La carta hace el POP: su squash (`home.sx`) se sale de 1 durante el golpe
 *      y vuelve a 1 (si quedara deformada, seria un bug).
 *
 *   node tools/probe-combo.mjs
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
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

await page.goto(URL_TO_TEST, { waitUntil: 'load', timeout: 45000 });
await page.waitForFunction(() => Boolean(window.__fungiflush?.engine?.run), { timeout: 30000 });
await page.waitForTimeout(1800);

const click = (sel) => page.evaluate((s) => document.querySelector(s)?.click(), sel);

// --- Entrar a una partida ---
await click('[data-act="tutorial-close"]');
await click('.panel.is-menu [data-act="new"]');
await page.waitForTimeout(700);
await page.evaluate(() => document.querySelector('[data-act="archetypes-start"]')?.click());
await page.waitForTimeout(1400);
await click('[data-act="tutorial-close"]');
await page.evaluate(() => window.__fungiflush.engine.chooseBlind());
await page.waitForFunction(() => (window.__fungiflush?.engine?.round?.hand?.length ?? 0) > 0, { timeout: 15000 });
await page.waitForTimeout(1500);

// --- Observador: muestrea popups y squash mientras corre el combo ---
await page.evaluate(() => {
  window.__combo = { popups: [], maxSquash: 0, squashEnd: null };
  const tick = () => {
    for (const el of document.querySelectorAll('.score-popup')) {
      const scale = Number(el.style.getPropertyValue('--pop-scale') || 1);
      const size = parseFloat(getComputedStyle(el).fontSize);
      const entry = { scale: Number(scale.toFixed(3)), size: Math.round(size), color: getComputedStyle(el).color, text: el.textContent };
      if (!window.__combo.popups.some((p) => p.text === entry.text && p.scale === entry.scale)) {
        window.__combo.popups.push(entry);
      }
    }
    const scene = window.__fungiflush.scene;
    for (const c of scene.scoringCards ?? []) {
      const s = Math.abs((c.home?.sx ?? 1) - 1);
      if (s > window.__combo.maxSquash) window.__combo.maxSquash = s;
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
});

// --- Jugar la mano completa (5 cartas para que haya combo) ---
const played = await page.evaluate(() => {
  const ff = window.__fungiflush;
  const hand = ff.engine.round?.hand ?? [];
  ff.engine.clearSelection();
  for (const c of hand.slice(0, 5)) ff.engine.toggleSelect(c.uid);
  const n = ff.engine.round?.selected?.length ?? 0;
  ff.engine.playHand();
  return { selected: n };
});
console.log('cartas jugadas:', played.selected);

await page.waitForTimeout(600);
await page.screenshot({ path: join(shotsDir, 'combo-mid.png') });
await page.waitForTimeout(3500);

const data = await page.evaluate(() => ({
  popups: window.__combo.popups,
  maxSquash: Number(window.__combo.maxSquash.toFixed(4)),
  // Estado final de las cartas: si el pop no restaura, quedan deformadas.
  squashEnd: (window.__fungiflush.scene.scoringCards ?? []).map((c) => ({
    sx: Number((c.home?.sx ?? 1).toFixed(3)),
    sy: Number((c.home?.sy ?? 1).toFixed(3)),
  })),
}));

console.log('\npopups vistos:', data.popups.length);
for (const p of data.popups) console.log(`  ${String(p.text).padEnd(8)} escala=${p.scale} tamaño=${p.size}px color=${p.color}`);

const scales = data.popups.map((p) => p.scale);
const first = scales[0];
const last = scales[scales.length - 1];
console.log(`\nescalas: ${scales.join(' -> ')}`);
console.log(`squash maximo visto: ${data.maxSquash} (tiene que ser > 0.02)`);
console.log(`squash final: ${JSON.stringify(data.squashEnd)} (tiene que ser 1 / 1)`);

// Dorado del multiplicador (#ffd36b = rgb(255,211,107))
const gold = data.popups.filter((p) => /255,\s*211,\s*107/.test(p.color));
console.log(`pasos dorados (multiplicador): ${gold.length}${gold.length ? ' -> ' + gold.map((g) => g.text).join(', ') : ''}`);

console.log('\nerrores de consola:', errors.length ? errors.slice(0, 5) : 'ninguno');

const restored = data.squashEnd.every((s) => Math.abs(s.sx - 1) < 0.01 && Math.abs(s.sy - 1) < 0.01);
const ok =
  data.popups.length >= 2 &&
  last > first &&
  data.maxSquash > 0.02 &&
  restored &&
  errors.length === 0;
console.log(ok ? '\nOK COMBO ESCALADO' : '\nXX HAY ALGO MAL');
await browser.close();
process.exitCode = ok ? 0 : 1;
