/**
 * probe-boss-target.mjs — El panel del CIEGO del JEFE con el objetivo alterado.
 *
 * BUG QUE CUBRE
 * -------------
 * Aceptar un interludio cambia el objetivo (x1.15, x1.2 o x0.85) y el panel de
 * ciego agrega una BANDA de aviso (`.blind-help.is-interlude`). El contenido del
 * panel del JEFE mide ~366px FIJOS: en cuanto el viewport baja de ahi, el pie
 * (`.panel-actions`) se sale y el boton "Luchar" queda cortado y NO clickeable.
 * El jefe es el primero en caer porque ya carga el bloque extra `.blind-effect`.
 *
 * El "Ante 3" es anecdota: el mecanismo es independiente del ante. Lo que manda
 * es el ALTO del viewport — por eso el probe corre DOS pasadas:
 *   - la de REFERENCIA (915x412 / 844x390 / tablet), donde hay 30-45px de aire;
 *   - la CORTA (360px de alto), que es un celular real en landscape con la barra
 *     del navegador, y donde el bug SI se reproduce.
 *
 * DOS MEDICIONES POR PASADA
 * -------------------------
 *   1. CON el fix (`.blind-body` como cuerpo flexible) -> tiene que PASAR.
 *   2. SIN el fix (se reinyecta la conducta vieja por CSS) -> tiene que FALLAR.
 * La segunda es la que prueba que el test tiene poder de deteccion: si el bug no
 * se reproduce en la pasada corta, el probe falla aunque la primera pase.
 *
 *   node tools/probe-boss-target.mjs
 *   FF_VIEWPORT=smoke node tools/probe-boss-target.mjs     # 844x390
 *   FF_VIEWPORT=tablet node tools/probe-boss-target.mjs    # 1180x820
 *   FF_HEIGHT=340 node tools/probe-boss-target.mjs         # barrido de alturas
 *
 * Requiere el dev server en http://127.0.0.1:1420 (FF_URL lo cambia).
 */
import { existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const URL_TO_TEST = process.env.FF_URL ?? 'http://127.0.0.1:1420/?daily=0';

const FORCED_HEIGHT = Number(process.env.FF_HEIGHT ?? 0);
const BASE =
  process.env.FF_VIEWPORT === 'smoke'
    ? { width: 844, height: 390 }
    : process.env.FF_VIEWPORT === 'tablet'
      ? { width: 1180, height: 820 }
      : { width: 915, height: 412 };
const VIEWPORT = FORCED_HEIGHT > 0 ? { ...BASE, height: FORCED_HEIGHT } : BASE;
/**
 * Alto de la pasada corta: un celular en landscape CON la barra del navegador.
 * Es donde el contenido del panel (~366px) ya no entra.
 */
const SHORT_HEIGHT = Math.min(360, VIEWPORT.height);

const PW = ['C:/Users/emanu/.workbuddy-ai/binaries/node/workspace/node_modules/playwright-core/index.js'];
async function loadPlaywright() {
  try {
    return await import('playwright-core');
  } catch {
    for (const c of PW) if (existsSync(c)) return await import(pathToFileURL(c).href);
    throw new Error('no playwright-core');
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
const shotsDir = join(ROOT, 'tools', 'shots');
if (!existsSync(shotsDir)) mkdirSync(shotsDir, { recursive: true });

const browser = await chromium.launch({
  executablePath: exe,
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--disable-dev-shm-usage'],
});
const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const page = await context.newPage();
const errors = [];
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

const click = (sel) => page.evaluate((s) => document.querySelector(s)?.click(), sel);
const has = (sel) => page.evaluate((s) => Boolean(document.querySelector(s)), sel);
const wait = (ms) => page.waitForTimeout(ms);

let failures = 0;
const check = (ok, label, detail = '') => {
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
};

/** Mide el panel abierto contra la VENTANA y contra la caja visible del scroller. */
async function measure() {
  return page.evaluate(() => {
    const overlay = document.querySelector('#ui-root > .overlay.is-open');
    const panel = overlay?.querySelector(':scope > .panel') ?? null;
    if (!panel) return { none: true };
    const vh = window.innerHeight;
    const vw = window.innerWidth;

    const actions = panel.querySelector('.panel-actions');
    const ar = actions?.getBoundingClientRect() ?? null;
    const start = panel.querySelector('[data-act="blind-start"]');
    const sr = start?.getBoundingClientRect() ?? null;
    const body = panel.querySelector('.blind-body');

    // TAPADO / RECORTADO: en el centro real del boton tiene que estar EL.
    let hittable = false;
    if (sr) {
      const hit = document.elementFromPoint(
        Math.max(0, Math.min(vw - 1, sr.left + sr.width / 2)),
        Math.max(0, Math.min(vh - 1, sr.top + sr.height / 2)),
      );
      hittable = Boolean(hit && (hit === start || start.contains(hit)));
    }

    return {
      vh,
      panelH: Math.round(panel.getBoundingClientRect().height),
      modified: panel.classList.contains('is-target-modified'),
      hasNotice: Boolean(panel.querySelector('.blind-help.is-interlude')),
      hasEffect: Boolean(panel.querySelector('.blind-effect')),
      isBoss: panel.querySelector('[data-blind-boss="1"]') !== null,
      bodyScroll: body ? Math.round(body.scrollHeight - body.clientHeight) : null,
      actionsBottom: ar ? Math.round(ar.bottom) : null,
      actionsOverflow: ar ? Math.round(ar.bottom - vh) : null,
      hittable,
    };
  });
}

const report = (label, m) => {
  const bad = (m.actionsOverflow ?? 0) > 2 || m.hittable === false;
  console.log(
    `  ${bad ? 'XX' : 'OK'} ${label.padEnd(18)} panelH=${String(m.panelH).padStart(4)}/${m.vh}` +
      ` notice=${m.hasNotice ? 'si' : 'no'} boss=${m.isBoss ? 'si' : 'no'} effect=${m.hasEffect ? 'si' : 'no'}` +
      ` bodyScroll=${String(m.bodyScroll).padStart(3)} actionsBottom=${String(m.actionsBottom).padStart(4)}` +
      ` overflow=${String(m.actionsOverflow).padStart(4)} hittable=${m.hittable}`,
  );
  return bad;
};

/** Monta el caso: JEFE + objetivo alterado por un interludio. */
async function mount(height) {
  await page.setViewportSize({ width: VIEWPORT.width, height });
  await wait(250);
  await page.evaluate(() => {
    const ff = window.__fungiflush;
    ff.engine.run.interludeModifiers = { targetMultiplier: 1.15 };
    ff.engine.run.blindIndex = 2;
    // `renderOverlay` sale temprano si el status no cambio: hay que repintar a mano.
    ff.hud.showBlindSelect();
  });
  await wait(550);
}

/** Una pasada completa: con el fix, y con la conducta vieja reinyectada. */
async function runPass(height, { mustReproduce, shot }) {
  console.log(`\n=== pasada ${height}px ${mustReproduce ? '(corta: el bug DEBE reproducirse)' : '(referencia)'} ===`);
  await mount(height);

  const withFix = await measure();
  report('CON el fix', withFix);
  if (shot) await page.screenshot({ path: join(shotsDir, shot) });

  check(!withFix.none, `[${height}] el panel de ciego esta montado`);
  check(withFix.isBoss, `[${height}] se monto un JEFE (bloque EFECTO presente)`, `effect=${withFix.hasEffect}`);
  check(withFix.hasNotice, `[${height}] el aviso de interludio esta presente (es el caso del bug)`);
  check(withFix.modified, `[${height}] el panel lleva la clase is-target-modified`);
  check((withFix.actionsOverflow ?? 99) <= 2, `[${height}] el PIE no se sale del viewport`, `overflow=${withFix.actionsOverflow}`);
  check(withFix.hittable === true, `[${height}] el boton "Luchar" es clickeable (ni tapado ni recortado)`);

  // --- A/B: reinyectar la conducta VIEJA ---
  await page.evaluate(() => {
    const style = document.createElement('style');
    style.id = 'simulate-old-behavior';
    // Antes el cuerpo no era flexible: ningun bloque podia encoger, asi que el
    // `overflow: hidden` que P8 le pone al panel recortaba el FINAL (el pie).
    style.textContent =
      '.panel > .blind-body { flex: 0 0 auto !important; overflow: visible !important; min-height: auto !important; }';
    document.head.appendChild(style);
  });
  await wait(350);
  const withoutFix = await measure();
  const reproduced = report('SIN el fix', withoutFix);
  if (shot) await page.screenshot({ path: join(shotsDir, shot.replace('.png', '-antes.png')) });
  await page.evaluate(() => document.getElementById('simulate-old-behavior')?.remove());
  await wait(200);

  if (mustReproduce) {
    check(
      reproduced,
      `[${height}] SIN el fix el bug SE REPRODUCE (el probe tiene poder de deteccion)`,
      reproduced ? '' : 'no se reprodujo: el probe no estaria probando nada',
    );
  } else {
    console.log(
      `  (informativo) a ${height}px el bug ${reproduced ? 'SI' : 'NO'} se reproduce: ` +
        'el contenido del panel mide ~366px, asi que hace falta un viewport mas bajo.',
    );
  }
  return withFix;
}

// --- Llegar a la seleccion de ciego ---
await page.goto(URL_TO_TEST, { waitUntil: 'load', timeout: 45000 });
await page.waitForFunction(() => Boolean(window.__fungiflush?.engine?.run), { timeout: 30000 });
await wait(1800);
await click('[data-act="tutorial-close"]');
await wait(300);
await click('.panel.is-menu [data-act="new"]');
await wait(700);
if (await has('.panel.is-archetypes')) {
  await click('[data-act="archetypes-start"]');
  await wait(1400);
}
await click('[data-act="tutorial-close"]');
await wait(400);

// Pasada de referencia (el viewport configurado).
await runPass(VIEWPORT.height, { mustReproduce: false, shot: 'probe-boss-target.png' });

// Pasada corta: la que prueba que el gate detecta el bug.
if (SHORT_HEIGHT < VIEWPORT.height) {
  await runPass(SHORT_HEIGHT, { mustReproduce: true, shot: 'probe-boss-target-corto.png' });
}

// El ANTE 3 explicito, que es lo que reporto el usuario.
await mount(SHORT_HEIGHT);
await page.evaluate(() => {
  const ff = window.__fungiflush;
  ff.engine.run.ante = 3;
  ff.engine.run.blindIndex = 2;
  ff.hud.showBlindSelect();
});
await wait(550);
const ante3 = await measure();
console.log('\n=== JEFE del ANTE 3 (lo reportado) ===');
report('ante 3 CON el fix', ante3);
check(!ante3.none, '[ante3] el panel esta montado');
check((ante3.actionsOverflow ?? 99) <= 2, '[ante3] el PIE no se sale del viewport', `overflow=${ante3.actionsOverflow}`);
check(ante3.hittable === true, '[ante3] el boton "Luchar" es clickeable');
await page.screenshot({ path: join(shotsDir, 'probe-boss-target-ante3.png') });

console.log('\n---');
console.log(`viewport base ${VIEWPORT.width}x${VIEWPORT.height} · pasada corta ${SHORT_HEIGHT}px · fallos: ${failures}`);
console.log('errores de consola:', errors.length ? errors.slice(0, 5) : 'ninguno');
if (errors.length) failures += 1;
await browser.close();
process.exit(failures > 0 ? 1 : 0);
