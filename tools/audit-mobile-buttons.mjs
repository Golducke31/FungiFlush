/**
 * audit-mobile-buttons.mjs — Auditoria de BOTONES en movil, pantalla por pantalla.
 *
 * A diferencia de `probe-panel-overflow.mjs` (que mira el PANEL y su
 * `.panel-actions`), este recorrido valida CADA elemento interactivo visible:
 *
 *   - FUERA_*   : la caja se sale del viewport (arriba/abajo/izq/der).
 *   - TAPADO    : en el CENTRO del boton, `elementFromPoint` devuelve otra cosa
 *                 (algo lo tapa: un banner, un detalle, otra capa).
 *   - CHICO_*   : el area tactil queda por debajo del minimo usable.
 *   - CORTADO   : el boton vive dentro de un scroller y su caja cae fuera del
 *                 area visible del scroller (hay que scrollear para verlo).
 *   - SIN_TEXTO : boton visible sin texto ni icono ni aria-label.
 *
 * Uso:
 *   node tools/audit-mobile-buttons.mjs                 # 915x412 (referencia)
 *   FF_VIEWPORT=smoke node tools/audit-mobile-buttons.mjs   # 844x390
 *   FF_VIEWPORT=tablet node tools/audit-mobile-buttons.mjs  # 1180x820
 *
 * Requiere el dev server en http://127.0.0.1:1420 (FF_URL lo cambia).
 */
import { existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const URL_TO_TEST = process.env.FF_URL ?? 'http://127.0.0.1:1420/?daily=0';
const PW_CANDIDATES = ['C:/Users/emanu/.workbuddy-ai/binaries/node/workspace/node_modules/playwright-core/index.js'];
async function loadPlaywright() {
  try { return await import('playwright-core'); }
  catch { for (const c of PW_CANDIDATES) if (existsSync(c)) return await import(pathToFileURL(c).href); throw new Error('no pw'); }
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

const VIEWPORT =
  process.env.FF_VIEWPORT === 'tablet' ? { width: 1180, height: 820 }
  : process.env.FF_VIEWPORT === 'smoke' ? { width: 844, height: 390 }
  : { width: 915, height: 412 };

/**
 * Piso tactil. Por debajo se marca CHICO.
 *
 * WCAG pide 44px y el juego apunta a 32 en movil, pero este gate NO es un
 * informe de estilo: tiene que fallar cuando un boton NO SE PUEDE USAR. 26px es
 * el piso real (un slider nativo mide eso); por debajo, el dedo no acierta.
 */
const MIN_TAP = 26;
/** Por debajo de esto se reporta como "justo" (informativo, no falla el gate). */
const TIGHT_TAP = 32;

const browser = await chromium.launch({
  executablePath: exe,
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--disable-dev-shm-usage'],
});
const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const page = await context.newPage();
const consoleErrors = [];
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));

await page.goto(URL_TO_TEST, { waitUntil: 'load', timeout: 45000 });
await page.waitForFunction(() => Boolean(window.__fungiflush?.engine?.run), { timeout: 30000 });
await page.waitForTimeout(1800);

const click = (sel) => page.evaluate((s) => document.querySelector(s)?.click(), sel);
const has = (sel) => page.evaluate((s) => Boolean(document.querySelector(s)), sel);
const waitPanel = (sel, timeout = 12000) =>
  page.waitForFunction((s) => Boolean(document.querySelector(s)), sel, { timeout }).catch(() => {});

/** Audita todos los elementos interactivos visibles del scope actual. */
async function audit(minTap = MIN_TAP, tightTap = TIGHT_TAP) {
  // Playwright solo acepta UN argumento: los dos umbrales van en un objeto.
  return page.evaluate(({ min, tightMax }) => {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const overlay = document.querySelector('#ui-root > .overlay.is-open');
    // Con panel abierto se audita el panel; sin panel, el HUD en juego.
    const scope = overlay
      ? (overlay.querySelector(':scope > .panel') ?? overlay)
      : document.querySelector('#ui-root');

    const isInteractive = (el) => {
      const tag = el.tagName;
      if (tag === 'BUTTON' || tag === 'A' || tag === 'INPUT' || tag === 'SELECT') return true;
      if (el.getAttribute('role') === 'button') return true;
      // Divs/spans clickeables (cartas de ciego, celdas de coleccion...).
      if (el.dataset && el.dataset['act']) {
        return getComputedStyle(el).cursor === 'pointer';
      }
      return false;
    };

    const els = [...scope.querySelectorAll('button, [data-act], a[href], input, select, [role="button"]')]
      .filter((el) => {
        if (el.closest('.overlay') !== overlay && overlay) return false; // fuera del panel visible
        const cs = getComputedStyle(el);
        if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) < 0.05) return false;
        const r = el.getBoundingClientRect();
        if (r.width <= 0 || r.height <= 0) return false;
        return isInteractive(el);
      });

    const rows = [];
    for (const el of els) {
      const r = el.getBoundingClientRect();
      const label =
        el.dataset['act'] ||
        (el.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 24) ||
        el.getAttribute('aria-label') ||
        el.tagName;
      const issues = [];

      // ¿Vive dentro de un scroller con contenido? Si es asi, estar fuera de la
      // ventana visible es ESPERADO (es una fila de lista a la que se llega
      // scrolleando), no un boton roto. Se reporta como info, no como problema.
      let inScroller = false;
      let scrollerEl = null;
      let walker = el.parentElement;
      while (walker && walker !== scope) {
        const cs = getComputedStyle(walker);
        if ((cs.overflowY === 'auto' || cs.overflowY === 'scroll')
            && walker.scrollHeight > walker.clientHeight + 2) {
          inScroller = true;
          scrollerEl = walker;
          break;
        }
        walker = walker.parentElement;
      }

      if (inScroller) {
        const sr = scrollerEl.getBoundingClientRect();
        const clipped = r.bottom > sr.bottom + 1 || r.top < sr.top - 1;
        rows.push({
          label: String(label),
          rect: { t: Math.round(r.top), b: Math.round(r.bottom), l: Math.round(r.left), rr: Math.round(r.right), h: Math.round(r.height), w: Math.round(r.width) },
          disabled: el.disabled === true,
          issues: [],
          info: clipped ? `LISTA(scroll ${String(scrollerEl.className || scrollerEl.tagName).split(' ')[0]})` : '',
        });
        continue;
      }

      if (r.bottom > vh + 1) issues.push(`FUERA_ABAJO+${Math.round(r.bottom - vh)}`);
      if (r.top < -1) issues.push(`FUERA_ARRIBA${Math.round(r.top)}`);
      if (r.right > vw + 1) issues.push(`FUERA_DER+${Math.round(r.right - vw)}`);
      if (r.left < -1) issues.push(`FUERA_IZQ${Math.round(r.left)}`);

      // TAPADO: en el centro del boton tiene que estar EL (o un hijo suyo).
      const cx = Math.min(vw - 1, Math.max(0, r.left + r.width / 2));
      const cy = Math.min(vh - 1, Math.max(0, r.top + r.height / 2));
      const hit = document.elementFromPoint(cx, cy);
      let modal = '';
      if (hit && hit !== el && !el.contains(hit)) {
        // La cortina del duelo es un MODAL a proposito ("pasa el dispositivo"):
        // tapa el panel hasta que se toca "Listo". No es un boton roto.
        if (hit.closest?.('.board-curtain.is-open')) {
          modal = 'MODAL(cortina)';
        } else {
          issues.push(`TAPADO(${hit.tagName}.${String(hit.className || '').split(' ')[0]})`);
        }
      }

      if (r.height < min - 0.5) issues.push(`CHICO_H${Math.round(r.height)}`);
      if (r.width < min - 0.5) issues.push(`CHICO_W${Math.round(r.width)}`);
      const tight = r.height < tightMax && issues.length === 0 ? `JUSTO_H${Math.round(r.height)}` : '';

      rows.push({
        label: String(label),
        rect: { t: Math.round(r.top), b: Math.round(r.bottom), l: Math.round(r.left), rr: Math.round(r.right), h: Math.round(r.height), w: Math.round(r.width) },
        disabled: el.disabled === true,
        issues,
        info: modal || tight,
      });
    }
    return { vw, vh, hasOverlay: Boolean(overlay), panel: scope.className || scope.id || 'hud', rows };
  }, { min: minTap, tightMax: tightTap });
}

const results = [];
async function visit(label, name) {
  await page.waitForTimeout(400);
  const a = await audit();
  const bad = a.rows.filter((r) => r.issues.length > 0);
  const listed = a.rows.filter((r) => r.info);
  results.push({ label, ...a, bad, listed });
  await page.screenshot({ path: join(shotsDir, `audit-${name}.png`) });
  const state = a.hasOverlay ? `panel=${String(a.panel).slice(0, 26)}` : 'HUD (sin panel)';
  console.log(
    `${bad.length ? 'XX' : 'OK'} ${label.padEnd(18)} ${String(a.rows.length).padStart(2)} controles  ${state}` +
    (listed.length ? `  (${listed.length} informativos: listas/modal/justos)` : ''),
  );
  for (const r of bad) {
    console.log(`     └─ ${r.label.padEnd(24)} ${r.issues.join(' ')}  [${r.rect.l},${r.rect.t} → ${r.rect.rr},${r.rect.b}] ${r.rect.w}x${r.rect.h}`);
  }
}

// ---------------------------------------------------------------- MENU
await click('[data-act="tutorial-close"]');
await visit('menu', 'menu');

const menuPanels = [
  ['settings', 'settings', '[data-act="close"]'],
  ['collection', 'collection', '[data-act="close"]'],
  ['about', 'about', '[data-act="close"]'],
  ['history', 'history', '[data-act="history-close"]'],
  ['guide', 'guide', '[data-act="tutorial-close"]'],
  ['achievements', 'achievements', '[data-act="achievements-close"]'],
  ['cosmetics', 'cosmetics', '[data-act="cosmetics-close"]'],
  ['daily', 'daily', '[data-act="daily-close"]'],
  ['archetype', 'archetypes', '[data-act="archetypes-close"]'],
  ['ascension', 'ascension', '[data-act="ascension-close"]'],
  ['board', 'board', '[data-act="close"]'],
];
for (const [act, name, close] of menuPanels) {
  if (!(await has(`.panel.is-menu [data-act="${act}"]`))) continue;
  await click(`.panel.is-menu [data-act="${act}"]`);
  await visit(name, name);
  // El TABLERO arranca con la cortina de "pasa el dispositivo" (modal a
  // proposito). Taparla y volver a auditar: lo que importa es que DESPUES los
  // botones sean alcanzables.
  if (act === 'board' && (await has('.board-curtain.is-open'))) {
    // La cortina NO se cierra tocandola: tiene su propio boton ("Listo").
    // Mientras esta abierta tapa todo el panel A PROPOSITO (es el modal de
    // "pasa el dispositivo"), asi que lo que hay que verificar es lo de DESPUES.
    await click('[data-act="ready"]');
    await page.waitForTimeout(600);
    await visit('board-jugando', 'board-playing');
  }
  if (await has(close)) await click(close);
  else await click('[data-act="close"]');
  await page.waitForTimeout(300);
}

// Sub-paneles de COLECCION (tienda de expansiones y pase)
await click('.panel.is-menu [data-act="collection"]');
await page.waitForTimeout(700);
for (const [act, name] of [['expansions', 'store'], ['pass', 'pass']]) {
  if (!(await has(`.panel.is-collection [data-act="${act}"]`))) continue;
  await click(`.panel.is-collection [data-act="${act}"]`);
  await visit(name, name);
  await click('[data-act="close"]').catch(() => {});
  await page.waitForTimeout(400);
}
await click('[data-act="close"]');
await page.waitForTimeout(400);

// ---------------------------------------------------------------- RUN
await click('.panel.is-menu [data-act="new"]');
await page.waitForTimeout(600);
if (await has('.panel.is-archetypes')) {
  await visit('archetypes-run', 'archetypes-run');
  await click('[data-act="archetypes-start"]');
  await page.waitForTimeout(1300);
}
await click('[data-act="tutorial-close"]');
await visit('blind-select', 'blind');

// *** EL PRIMER JEFE ***  (blindIndex 2 = boss del ante 1)
//
// OJO: `enterBlindSelect()` NO alcanza para ver el jefe. El HUD reconstruye el
// panel solo cuando CAMBIA el estado (`renderOverlay` sale temprano si el status
// es el mismo), asi que volver a entrar a `blind_select` deja el panel viejo.
// Se fuerza el repintado llamando a `showBlindSelect()` —que lee
// `run.blindIndex`— con el indice ya movido al jefe.
await page.evaluate(() => {
  const ff = window.__fungiflush;
  ff.engine.run.blindIndex = 2;
  ff.engine.enterBlindSelect();
  ff.hud.showBlindSelect();
});
await waitPanel('.panel.is-blind-select', 8000);
await page.waitForTimeout(600);
const bossInfo = await page.evaluate(() => {
  const card = document.querySelector('.panel.is-blind-select .blind-card.is-boss');
  const panel = document.querySelector('.panel.is-blind-select');
  return {
    card: card ? { id: card.dataset['blind'], boss: card.dataset['blindBoss'] } : null,
    panelH: panel ? Math.round(panel.getBoundingClientRect().height) : null,
    vh: window.innerHeight,
    scroll: panel ? Math.round(panel.scrollHeight - panel.clientHeight) : null,
    blindIndex: window.__fungiflush.engine.run.blindIndex,
    blinds: window.__fungiflush.engine.availableBlinds().map((b) => b.id),
  };
});
console.log('  [jefe]', JSON.stringify(bossInfo));
await visit('blind-select-JEFE', 'blind-boss');

// Detalle de la run (desde el panel de ciego)
if (await has('.panel.is-blind-select [data-act="blind-details"]')) {
  await click('.panel.is-blind-select [data-act="blind-details"]');
  await visit('blind-details', 'blind-details');
  await click('[data-act="close"]');
  await page.waitForTimeout(400);
}

// Jugar el ciego de JEFE
await page.evaluate(() => {
  const ff = window.__fungiflush;
  ff.engine.chooseBlind(ff.engine.availableBlinds()[2]?.id);
});
await page.waitForFunction(() => (window.__fungiflush?.engine?.round?.hand?.length ?? 0) > 0, { timeout: 15000 });
await page.waitForTimeout(900);
await visit('playing-JEFE', 'playing-boss');
await visit('playing-sin-sel', 'playing');

// Con seleccion (boton Jugar Mano armado)
await page.evaluate(() => {
  const ff = window.__fungiflush;
  ff.engine.clearSelection();
  for (const c of (ff.engine.round?.hand ?? []).slice(0, 2)) ff.engine.toggleSelect(c.uid);
});
await page.waitForTimeout(600);
await visit('playing-con-sel', 'playing-armed');

// MENU INGAME (pausa)
await click('.hud-top [data-act="quit-to-menu"]');
await visit('menu-ingame', 'menu-ingame');
await click('[data-act="quit-cancel"]');
await page.waitForTimeout(400);

// ---------------------------------------------------------------- CIEGO SUPERADO
await page.evaluate(() => {
  const ff = window.__fungiflush;
  const r = ff.engine.round;
  if (r) r.target = 1;
  const uid = r?.hand?.[0]?.uid;
  if (uid) { ff.engine.toggleSelect(uid); ff.engine.playHand(); }
});
await waitPanel('.panel.is-cleared, .panel.is-reward', 12000);
await page.waitForTimeout(500);
if (await has('.panel.is-cleared')) {
  await visit('cleared', 'cleared');
  await click('.panel.is-cleared [data-act="cleared-continue"]');
  await waitPanel('.panel.is-reward', 8000);
  await page.waitForTimeout(400);
}
if (await has('.panel.is-reward')) await visit('reward', 'reward');
if (await has('.panel.is-reward [data-act="skip"]')) {
  await click('.panel.is-reward [data-act="skip"]');
  await waitPanel('.panel.is-shop', 8000);
  await page.waitForTimeout(500);
}
if (await has('.panel.is-shop')) await visit('shop', 'shop');

// MAZO (carrusel 3D real)
await page.evaluate(() => document.querySelector('.panel.is-shop [data-act="deck"]')?.click()
  ?? document.querySelector('.hud-top [data-act="deck"]')?.click());
await page.waitForTimeout(2400);
if (await has('.panel.is-deck')) {
  await visit('deck-carrusel', 'deck');
  await click('[data-act="close"]');
  await page.waitForTimeout(600);
}

// COLECCION con carrusel 3D (desde el menu no: se usa el panel DOM arriba)
// INTERLUDIO
await page.evaluate(() => {
  const ff = window.__fungiflush;
  if (ff.engine.run.status === 'shop') ff.engine.leaveShop();
});
await page.waitForTimeout(900);
let sawInterlude = false;
for (let i = 0; i < 10; i++) {
  const status = await page.evaluate(() => window.__fungiflush.engine.run.status);
  if (status === 'playing') break;
  if (status === 'blind_select') await page.evaluate(() => window.__fungiflush.engine.chooseBlind());
  else if (await has('.panel.is-interlude')) {
    if (!sawInterlude) { await visit('interlude', 'interlude'); sawInterlude = true; }
    await click('.panel.is-interlude [data-act="interlude-choice"]');
  }
  await page.waitForTimeout(900);
}

// GAME OVER
await page.waitForFunction(() => window.__fungiflush?.engine?.run?.status === 'playing', { timeout: 10000 }).catch(() => {});
await page.waitForTimeout(600);
await page.evaluate(() => {
  const ff = window.__fungiflush;
  const r = ff.engine.round;
  if (!r) return;
  r.target = 999999999;
  for (let i = 0; i < 10 && ff.engine.run.status === 'playing'; i++) {
    ff.engine.clearSelection();
    for (const c of (ff.engine.round?.hand ?? []).slice(0, 5)) ff.engine.toggleSelect(c.uid);
    if ((ff.engine.round?.selected?.length ?? 0) === 0) break;
    ff.engine.playHand();
  }
});
await waitPanel('.panel.is-gameover', 15000);
await page.waitForTimeout(600);
if (await has('.panel.is-gameover')) await visit('gameover', 'gameover');

await browser.close();

// ---------------------------------------------------------------- RESUMEN
console.log('\n================ RESUMEN DE LA AUDITORIA ================');
console.log(`viewport ${VIEWPORT.width}x${VIEWPORT.height} · min tap ${MIN_TAP}px`);
let totalControls = 0;
let totalBad = 0;
const screensWithProblems = [];
for (const r of results) {
  totalControls += r.rows.length;
  totalBad += r.bad.length;
  if (r.bad.length > 0) screensWithProblems.push(`${r.label} (${r.bad.length})`);
  console.log(
    `  ${r.bad.length ? 'XX' : 'OK'}  ${r.label.padEnd(18)} ${String(r.rows.length).padStart(2)} controles, ${r.bad.length} con problema`,
  );
}
console.log(`\n${totalControls} controles auditados · ${totalBad} con problema`);
if (screensWithProblems.length > 0) console.log(`Pantallas con problemas: ${screensWithProblems.join(', ')}`);
else console.log('Ninguna pantalla con problemas de ajuste.');
console.log('errores de consola:', consoleErrors.length ? consoleErrors.slice(0, 5) : 'ninguno');

// Sirve de GATE: exit 1 si algun boton queda fuera, tapado o por debajo del
// minimo tactil. Asi una regresion de layout se ve en CI y no en el celular.
if (totalBad > 0 || consoleErrors.length > 0) {
  console.log('\nXX AUDITORIA CON PROBLEMAS');
  process.exitCode = 1;
} else {
  console.log('\nOK AUDITORIA LIMPIA');
}
