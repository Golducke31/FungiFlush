/**
 * shot-desktop.mjs — Captura y VERIFICA el HUD en ESCRITORIO (pointer: fine).
 *
 * Verifica que las reglas `@media (pointer: coarse)` NO afecten al escritorio:
 * mismo viewport que un monitor ancho, sin `isMobile`/`hasTouch`.
 *
 * ADEMAS es un GATE: si el escritorio se degrada (p. ej. porque el trabajo
 * movil agrego un nodo al DOM compartido sin ocultarlo en la base), este script
 * FALLA con exit code 1 en vez de imprimir un numero y seguir. Es la red de
 * seguridad del frente escritorio mientras el frente movil avanza: la
 * convencion `docs/CONVENCION_MOVIL_PRIMERO.md` congela el escritorio, asi que
 * cualquier regresion tiene que ser VISIBLE, no silenciosa.
 *
 *   CODEBUDDY_SAFE_DELETE_ENABLED=0 node tools/shot-desktop.mjs
 *   -> exit 0 = todo bien · exit 1 = regresion de escritorio
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
// ESCRITORIO: sin isMobile ni hasTouch => pointer: fine.
const context = await browser.newContext({ viewport: { width: 1440, height: 810 } });
const page = await context.newPage();
page.on('pageerror', (e) => console.error('[pageerror]', e.message));

await page.goto(URL_TO_TEST, { waitUntil: 'load', timeout: 45000 });
await page.waitForFunction(() => Boolean(window.__fungiflush?.engine?.run), { timeout: 30000 });
await page.waitForTimeout(2200);

const media = await page.evaluate(() => ({
  coarse: window.matchMedia('(pointer: coarse)').matches,
  fine: window.matchMedia('(pointer: fine)').matches,
  w: window.innerWidth,
  h: window.innerHeight,
}));
console.log('media:', JSON.stringify(media));

await page.evaluate(() => document.querySelector('[data-act="tutorial-close"]')?.click());
await page.waitForTimeout(300);

// Panel de ciego
await page.evaluate(() => document.querySelector('.panel.is-menu [data-act="new"]')?.click());
await page.waitForTimeout(1200);
// "Nueva partida" abre el selector de ARQUETIPO: el jugador elige y arranca
// (antes el panel llegaba vacio y el boton arrancaba directo).
await page.evaluate(() => document.querySelector('.panel.is-archetypes [data-act="archetypes-start"]')?.click());
await page.waitForTimeout(1400);
await page.evaluate(() => document.querySelector('[data-act="tutorial-close"]')?.click());
await page.waitForTimeout(600);
await page.screenshot({ path: join(shotsDir, 'desk-blind.png') });

// En partida
await page.evaluate(() => {
  const ff = window.__fungiflush;
  ff.engine.chooseBlind(ff.engine.availableBlinds()[0]?.id);
});
await page.waitForFunction(() => (window.__fungiflush?.engine?.round?.hand?.length ?? 0) > 0, { timeout: 15000 });
// El reparto TERMINA con el destape: sin esperarlo la captura muestra los
// dorsos. Ver `shot-mobile.mjs` para el detalle del `dt` acotado.
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
await page.screenshot({ path: join(shotsDir, 'desk-playing.png') });

// Medicion + aserciones.
const probe = await page.evaluate(() => {
  const vis = (sel) => {
    const el = document.querySelector(sel);
    if (!el) return { present: false, visible: false };
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return {
      present: true,
      display: cs.display,
      visibility: cs.visibility,
      visible: cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 0 && r.height > 0,
    };
  };

  const counters = [...document.querySelectorAll('.counter')];
  const tops = counters.map((c) => Math.round(c.getBoundingClientRect().top));
  const bottom = document.querySelector('.hud-bottom')?.getBoundingClientRect();
  const actions = document.querySelector('.hud-actions')?.getBoundingClientRect();
  const topBar = document.querySelector('.hud-top')?.getBoundingClientRect();
  const statusEl = document.querySelector('.hud-status');

  return {
    vh: window.innerHeight,
    vw: window.innerWidth,
    counterTops: tops,
    countersSingleRow: new Set(tops).size === 1,
    countersBottom: counters.length ? Math.max(...counters.map((c) => Math.round(c.getBoundingClientRect().bottom))) : null,
    actionsTop: actions ? Math.round(actions.top) : null,
    actionsBottom: actions ? Math.round(actions.bottom) : null,
    hudBottom: bottom ? Math.round(bottom.bottom) : null,
    // --- Aserciones del gate ---
    hudStatus: vis('.hud-status'),
    // El nodo de estado se crea SIEMPRE; en escritorio debe estar oculto por CSS.
    hudStatusText: statusEl ? (statusEl.textContent ?? '').trim().slice(0, 60) : null,
    missionsToggle: vis('.hud-missions-toggle'),
    bodyScrollH: document.body.scrollHeight,
    innerH: window.innerHeight,
    topBarBox: topBar
      ? { top: Math.round(topBar.top), bottom: Math.round(topBar.bottom), overflowBottom: Math.round(topBar.bottom - window.innerHeight) }
      : null,
  };
});

console.log('\nMedicion escritorio:', JSON.stringify(probe, null, 2));

// --- Gate: cada check con nombre, para que un fallo diga CUAL ---
const checks = [];
const chk = (name, ok, detail) => {
  checks.push({ name, ok: Boolean(ok), detail });
  return Boolean(ok);
};

chk(
  'escritorio no debe mostrar .hud-status (nodo retirado)',
  !probe.hudStatus.visible,
  probe.hudStatus.present ? `display=${probe.hudStatus.display}` : 'nodo ausente (retirado)',
);
chk(
  'escritorio no debe mostrar .hud-missions-toggle (control solo-movil)',
  !probe.missionsToggle.visible,
  probe.missionsToggle.present ? `display=${probe.missionsToggle.display}` : 'nodo ausente',
);
chk('los contadores van en UNA sola fila', probe.countersSingleRow, `tops=${JSON.stringify(probe.counterTops)}`);
chk(
  'la barra inferior no se sale del viewport',
  probe.hudBottom != null && probe.hudBottom <= probe.innerH,
  `hudBottom=${probe.hudBottom} innerH=${probe.innerH}`,
);
chk(
  'la barra superior no se sale del viewport',
  probe.topBarBox != null && probe.topBarBox.overflowBottom <= 0,
  probe.topBarBox ? `overflowBottom=${probe.topBarBox.overflowBottom}` : 'nodo ausente',
);
chk('el body no desborda verticalmente', probe.bodyScrollH <= probe.innerH, `scrollH=${probe.bodyScrollH} innerH=${probe.innerH}`);

const failed = checks.filter((c) => !c.ok);
console.log('\n=== GATE ESCRITORIO ===');
for (const c of checks) console.log(`  ${c.ok ? 'PASA ' : 'FALLA'}  ${c.name}  (${c.detail})`);

await browser.close();

if (failed.length > 0) {
  console.error(`\nX ESCRITORIO ROTO: ${failed.length} de ${checks.length} checks fallaron.`);
  console.error('  (el frente movil no debe degradar el escritorio; ver docs/CONVENCION_MOVIL_PRIMERO.md)');
  process.exit(1);
}
console.log(`\nOK ESCRITORIO VERDE (${checks.length}/${checks.length}). Shots: tools/shots/desk-*.png`);
