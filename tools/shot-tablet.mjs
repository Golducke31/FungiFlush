/**
 * shot-tablet.mjs — Captura y VERIFICA el HUD en TABLET tactil (pointer: coarse).
 *
 * El bloque `@media (pointer: coarse)` comprime el HUD para un CELULAR en
 * landscape (412px de alto). Una tablet tactil (ej. 1180x820) tambien es
 * `pointer: coarse`, asi que hoy recibe la MISMA compresion: un HUD pensado
 * para 412px de alto en una pantalla de 820px, con todo apretado al centro y
 * mucho aire muerto.
 *
 * Este visor mide ese caso y AFIRMA que el HUD de tablet no esta comprimido.
 *
 *   CODEBUDDY_SAFE_DELETE_ENABLED=0 node tools/shot-tablet.mjs
 *   -> exit 0 = tablet OK · exit 1 = el HUD de tablet quedo comprimido
 */
import { existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const URL_TO_TEST = process.env.FF_URL ?? 'http://127.0.0.1:1420/?daily=0';

const PW_CANDIDATES = [
  'C:/Users/emanu/.workbuddy-ai/binaries/node/workspace/node_modules/playwright-core/index.js',
];
const pw = await (async () => {
  try { return await import('playwright-core'); } catch {
    for (const c of PW_CANDIDATES) if (existsSync(c)) return await import(pathToFileURL(c).href);
  }
})();
const chromium = pw.chromium ?? pw.default?.chromium;
const exe = [
  'C:/Users/emanu/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
].find((p) => existsSync(p));

const shotsDir = join(ROOT, 'tools', 'shots');
if (!existsSync(shotsDir)) mkdirSync(shotsDir, { recursive: true });

const browser = await chromium.launch({
  executablePath: exe,
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--disable-dev-shm-usage'],
});
// TABLET tactil: isMobile + hasTouch => pointer: coarse. Pantalla ALTA (820px).
const context = await browser.newContext({
  viewport: { width: 1180, height: 820 },
  deviceScaleFactor: 1.5,
  isMobile: true,
  hasTouch: true,
});
const page = await context.newPage();
page.on('pageerror', (e) => console.error('[pageerror]', e.message));

await page.goto(URL_TO_TEST, { waitUntil: 'load', timeout: 45000 });
await page.waitForFunction(() => Boolean(window.__fungiflush?.engine?.run), { timeout: 30000 });
await page.waitForTimeout(2000);

const media = await page.evaluate(() => ({
  coarse: window.matchMedia('(pointer: coarse)').matches,
  w: window.innerWidth,
  h: window.innerHeight,
}));
console.log('media:', JSON.stringify(media));

await page.evaluate(() => document.querySelector('[data-act="tutorial-close"]')?.click());
await page.waitForTimeout(300);
await page.evaluate(() => document.querySelector('.panel.is-menu [data-act="new"]')?.click());
await page.waitForTimeout(1400);
await page.evaluate(() => document.querySelector('[data-act="tutorial-close"]')?.click());
await page.waitForTimeout(500);
await page.screenshot({ path: join(shotsDir, 'tab-blind.png') });

await page.evaluate(() => {
  const ff = window.__fungiflush;
  ff.engine.chooseBlind(ff.engine.availableBlinds()[0]?.id);
});
await page.waitForFunction(() => (window.__fungiflush?.engine?.round?.hand?.length ?? 0) > 0, { timeout: 15000 });
await page
  .waitForFunction(
    () => {
      const hs = window.__fungiflush?.scene?.handState?.() ?? [];
      return hs.length > 0 && hs.every((c) => c.flip < 0.5);
    },
    { timeout: 20000 },
  )
  .catch(() => {});
await page.waitForTimeout(500);
await page.screenshot({ path: join(shotsDir, 'tab-playing.png') });

const probe = await page.evaluate(() => {
  const box = (sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { top: Math.round(r.top), bottom: Math.round(r.bottom), h: Math.round(r.height) };
  };
  return {
    vh: window.innerHeight,
    vw: window.innerWidth,
    hudTop: box('.hud-top'),
    hudBottom: box('.hud-bottom'),
    hudScore: box('.hud-score'),
    scoreCurrent: box('.hud-score-current'),
    selectHint: box('.hud-select-hint'),
    hudStatus: box('.hud-status'),
    // Un HUD "de celular" ocupa ~23% del alto; uno de tablet deberia ser menos.
    hudTopPct: (() => {
      const el = document.querySelector('.hud-top');
      return el ? Math.round((el.getBoundingClientRect().height / window.innerHeight) * 100) : null;
    })(),
  };
});
console.log('\nMedicion tablet:', JSON.stringify(probe, null, 2));

const checks = [];
const chk = (name, ok, detail) => {
  checks.push({ name, ok: Boolean(ok), detail });
  return Boolean(ok);
};

// En una pantalla de 820px de alto, el HUD superior comprimido de celular
// (~66px, pensado para 412px) seria ~8% del alto: se lee como una tira perdida.
// Un HUD de tablet sano ronda el 9-14% (mas contenido, no una tira).
chk(
  'la barra superior tiene alto de TABLET, no de celular comprimido',
  (probe.hudTop?.h ?? 0) >= 76,
  `hud-top h=${probe.hudTop?.h}px (${probe.hudTopPct}% de ${probe.vh})`,
);
chk(
  'el marcador no quedo comprimido a la mitad',
  (probe.scoreCurrent?.h ?? 0) >= 34,
  `score-current h=${probe.scoreCurrent?.h}px`,
);
chk(
  'la barra inferior tiene alto comodo',
  (probe.hudBottom?.h ?? 0) >= 78,
  `hud-bottom h=${probe.hudBottom?.h}px`,
);
// El ancla del aviso de seleccion depende de `--hud-bottom-h`: si esa variable
// se queda corta, el aviso cae DENTRO de la barra y tapa la linea de estado.
chk(
  'el aviso de seleccion queda POR ENCIMA de la barra inferior',
  probe.selectHint != null && probe.hudBottom != null && probe.selectHint.bottom <= probe.hudBottom.top,
  `hint.bottom=${probe.selectHint?.bottom} bar.top=${probe.hudBottom?.top}`,
);
chk(
  'el aviso de seleccion no pisa la linea de estado',
  probe.selectHint == null ||
    probe.hudStatus == null ||
    probe.selectHint.bottom <= probe.hudStatus.top ||
    probe.selectHint.top >= probe.hudStatus.bottom,
  `hint=${probe.selectHint?.top}-${probe.selectHint?.bottom} status=${probe.hudStatus?.top}-${probe.hudStatus?.bottom}`,
);

const failed = checks.filter((c) => !c.ok);
console.log('\n=== GATE TABLET ===');
for (const c of checks) console.log(`  ${c.ok ? 'PASA ' : 'FALLA'}  ${c.name}  (${c.detail})`);

await browser.close();

if (failed.length > 0) {
  console.error(`\nX TABLET COMPRIMIDA: ${failed.length} de ${checks.length} checks fallaron.`);
  process.exit(1);
}
console.log(`\nOK TABLET VERDE (${checks.length}/${checks.length}). Shots: tools/shots/tab-*.png`);
