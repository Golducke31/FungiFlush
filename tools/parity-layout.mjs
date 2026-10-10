/**
 * parity-layout.mjs — GATE de PARIDAD movil <-> escritorio.
 *
 * Objetivo (ver docs/CONVENCION_MOVIL_PRIMERO.md y el plan de escritorio):
 * un jugador que alterne plataformas debe percibir el MISMO juego. La paridad
 * es de INFORMACION, TEXTOS, SENALES y RITMO, no de pixeles. Este gate NO exige
 * layout identico (eso contradeciria "aprovechar el ancho"): exige INVARIANTES.
 *
 * Corre DOS contexts Chromium en una sola corrida:
 *   - ESCRITORIO 1440x810  sin isMobile/hasTouch  => pointer: fine
 *   - MOVIL      915x412   isMobile + hasTouch    => pointer: coarse
 *
 * Por cada pantalla (misma navegacion que shot-desktop/audit-mobile-buttons)
 * extrae un "snapshot" de marcadores y valida:
 *
 *   I1  No fuga MOVIL->ESCRITORIO: `.hud-status` y `.hud-missions-toggle` NO
 *       visibles en escritorio (son cromo solo-movil).
 *   I2  No fuga ESCRITORIO->MOVIL: el HUD de partida en movil oculta los
 *       contadores de ESTADO (data-kind="state") y el `.hud-status` no aparece.
 *   I3  Misma INFORMACION: los textos de las acciones principales coinciden
 *       (Jugar Mano / Continuar / etc.) cuando el estado es el mismo.
 *   I4  Acciones ALCANZABLES en ambos: ninguna accion fuera del viewport.
 *   I5  Sin scroll de pagina NO intencional en ninguna de las dos.
 *   I6  Baseline: la geometria normalizada de escritorio no se desplaza mas de
 *       la tolerancia respecto de tools/desk-baseline.json (--update re-basa).
 *
 * Uso:
 *   CODEBUDDY_SAFE_DELETE_ENABLED=0 node tools/parity-layout.mjs
 *   CODEBUDDY_SAFE_DELETE_ENABLED=0 node tools/parity-layout.mjs --update
 *
 * Requiere el dev server YA en http://127.0.0.1:1420 (FF_URL lo cambia).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const URL_TO_TEST = process.env.FF_URL ?? 'http://127.0.0.1:1420/?daily=0';
const UPDATE = process.argv.includes('--update');
const BASELINE_PATH = join(ROOT, 'tools', 'parity-baseline.json');
/** Tolerancia de desplazamiento de geometria normalizada (fraccion del viewport). */
const DRIFT_TOL = Number(process.env.FF_PARITY_TOL ?? 0.12);

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
  'C:/Users/emanu/AppData/Local/ms-playwright/chromium-1228/chrome-win64/chrome.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
].find((p) => existsSync(p));
if (!exe) { console.error('No hay Chromium.'); process.exit(1); }

const shotsDir = join(ROOT, 'tools', 'shots');
if (!existsSync(shotsDir)) mkdirSync(shotsDir, { recursive: true });

const browser = await chromium.launch({
  executablePath: exe,
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--disable-dev-shm-usage'],
});

/** Crea una "sesion" (pagina + helpers) para un viewport dado. */
async function makeSession({ name, viewport, mobile }) {
  const context = await browser.newContext({
    viewport,
    ...(mobile ? { deviceScaleFactor: 2, isMobile: true, hasTouch: true } : {}),
  });
  const page = await context.newPage();
  // Arquetipos: se siembra la puerta abierta (se desbloquean al superar el
  // primer Ciego). Ver `tools/probe-archetype-gate.mjs` para el camino bloqueado.
  await page.addInitScript(() => {
    localStorage.setItem(
      'fungiflush.profile',
      JSON.stringify({ version: 7, archetypesUnlocked: true }),
    );
  });
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  await page.goto(URL_TO_TEST, { waitUntil: 'load', timeout: 45000 });
  // `polling: 250` (intervalo) y NO el rAF por defecto: con SwiftShader la escena
  // 3D va a ~2 FPS, y con DOS contextos renderizando a la vez el rAF de la pagina
  // que no esta al frente se muere de hambre => el wait expiraba aunque la app
  // estuviera perfecta (se verifico: `engine.run` ya era true). El intervalo no
  // depende del frame. `bringToFront` evita el throttling de la pestana oculta.
  await page.bringToFront();
  await page.waitForFunction(() => Boolean(window.__fungiflush?.engine?.run), { timeout: 30000, polling: 250 });
  await page.waitForTimeout(2000);

  const click = (sel) => page.evaluate((s) => document.querySelector(s)?.click(), sel);
  const has = (sel) => page.evaluate((s) => Boolean(document.querySelector(s)), sel);
  const waitPanel = (sel, timeout = 12000) =>
    page.waitForFunction((s) => Boolean(document.querySelector(s)), sel, { timeout, polling: 250 }).catch(() => {});

  /**
   * Snapshot de marcadores de la pantalla actual. Devuelve:
   *   - markers: mapa nombre -> rect NORMALIZADO (0..1) para el baseline.
   *   - vis: mapa nombre -> visible (para las invariantes de fuga).
   *   - labels: textos de las acciones principales visibles (para I3).
   *   - overflow: acciones fuera del viewport (para I4).
   *   - pageScroll: desborde de pagina (para I5).
   */
  const snapshot = () =>
    page.evaluate(() => {
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const vis = (sel) => {
        const el = document.querySelector(sel);
        if (!el) return false;
        const cs = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        return cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 0 && r.height > 0;
      };
      const rect = (sel) => {
        const el = document.querySelector(sel);
        if (!el || !vis(sel)) return null;
        const r = el.getBoundingClientRect();
        return { x: +(r.left / vw).toFixed(3), y: +(r.top / vh).toFixed(3), w: +(r.width / vw).toFixed(3), h: +(r.height / vh).toFixed(3) };
      };

      const overlay = document.querySelector('#ui-root > .overlay.is-open');
      const scope = overlay ? (overlay.querySelector(':scope > .panel') ?? overlay) : document.querySelector('#ui-root');

      // Acciones fuera del viewport (sin contar listas con scroll interno).
      const overflow = [];
      const els = [...scope.querySelectorAll('button,[data-act],a[href],input,select,[role="button"]')];
      for (const el of els) {
        if (el.closest('.overlay') !== overlay && overlay) continue;
        const cs = getComputedStyle(el);
        if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) < 0.05) continue;
        const r = el.getBoundingClientRect();
        if (r.width <= 0 || r.height <= 0) continue;
        let inScroller = false;
        let w = el.parentElement;
        while (w && w !== scope) {
          const c2 = getComputedStyle(w);
          if ((c2.overflowY === 'auto' || c2.overflowY === 'scroll') && w.scrollHeight > w.clientHeight + 2) { inScroller = true; break; }
          w = w.parentElement;
        }
        if (inScroller) continue;
        // Cajon FUERA DE CANVAS a proposito: un panel que entra deslizando
        // (`.hud-missions-panel`, `translateX(-110%)`) vive completamente fuera
        // del viewport hasta que se abre. Si el elemento esta ENTERAMENTE fuera
        // (borde derecho < 0, o borde izquierdo > vw), no es un control roto:
        // es un drawer oculto. Se ignora; solo interesan las acciones VISIBLES
        // que quedan recortadas.
        if (r.right < 0 || r.left > vw || r.bottom < 0 || r.top > vh) continue;
        const iss = [];
        if (r.bottom > vh + 1) iss.push('ABAJO');
        if (r.top < -1) iss.push('ARRIBA');
        if (r.right > vw + 1) iss.push('DER');
        if (r.left < -1) iss.push('IZQ');
        if (iss.length) overflow.push(((el.dataset?.['act'] || (el.textContent ?? '').trim().slice(0, 20) || el.tagName)) + ':' + iss.join('/'));
      }

      // Textos de acciones principales (para verificar paridad de etiquetas).
      const labelOf = (sel) => {
        const el = document.querySelector(sel);
        return el ? (el.textContent ?? '').trim().replace(/\s+/g, ' ') : null;
      };

      return {
        vw, vh,
        hasOverlay: Boolean(overlay),
        scope: String(scope.className || scope.id || 'hud').slice(0, 60),
        // Marcadores geometricos comunes a ambas plataformas.
        markers: {
          hudTop: rect('.hud-top'),
          hudBottom: rect('.hud-bottom'),
          hudActions: rect('.hud-actions'),
          hudScore: rect('.hud-score'),
          panel: rect('#ui-root > .overlay.is-open > .panel'),
          panelActions: rect('.panel-actions'),
        },
        // Visibilidad (invariantes de fuga).
        vis: {
          hudStatus: vis('.hud-status'),
          missionsToggle: vis('.hud-missions-toggle'),
          stateCounters: document.querySelectorAll('.counter[data-kind="state"]').length
            ? [...document.querySelectorAll('.counter[data-kind="state"]')].filter((c) => {
                const cs = getComputedStyle(c);
                const r = c.getBoundingClientRect();
                return cs.display !== 'none' && r.width > 0 && r.height > 0;
              }).length
            : 0,
        },
        // Etiquetas de acciones (paridad de textos).
        labels: {
          play: labelOf('.hud-actions [data-act="play"]'),
          primary: labelOf('.panel-actions [data-act]:not([data-act="close"])'),
          close: labelOf('.panel-actions [data-act="close"], [data-act="close"]'),
        },
        counters: document.querySelectorAll('.counter').length,
        pageScroll: Math.max(0, document.body.scrollHeight - vh),
        overlayScroll: overlay ? Math.max(0, overlay.scrollHeight - overlay.clientHeight) : 0,
        listCounters: [...document.querySelectorAll('.counter')].filter((c) => {
          const cs = getComputedStyle(c); const r = c.getBoundingClientRect();
          return cs.display !== 'none' && r.width > 0;
        }).map((c) => c.dataset['kind'] || '?'),
        overflow,
      };
    });

  return { name, page, click, has, waitPanel, snapshot, errors, context };
}

/**
 * Recorre una sesion por las pantallas clave y devuelve snapshots por nombre.
 * Se limita a las pantallas CON panel + el HUD de partida; es el conjunto donde
 * las invariantes de paridad tienen sentido (misma jerarquia, mismas acciones).
 */
async function walk(s) {
  const out = {};
  // Las capturas se toman DENTRO del recorrido: al final de la corrida la
  // pantalla ya avanzo al ultimo estado (shop) y todas saldrian iguales.
  const snap = async (label) => {
    await s.page.waitForTimeout(300);
    out[label] = await s.snapshot();
    await s.page.screenshot({ path: join(shotsDir, `parity-${s.name === 'desktop' ? 'desk' : 'mob'}-${label}.png`) }).catch(() => {});
  };

  await s.click('[data-act="tutorial-close"]');
  await snap('menu');

  const openDrop = async () => { await s.click('.panel.is-menu [data-act="menu-toggle"]'); await s.page.waitForTimeout(200); };
  const openMenuAction = async (act) => { await openDrop(); await s.click(`.panel.is-menu [data-act="${act}"]`); await s.page.waitForTimeout(500); };
  const backToMenu = async () => {
    await s.page.evaluate(() => { const ff = window.__fungiflush; ff?.scene?.setCarousel?.(null); ff?.hud?.showMenu(); });
    await s.page.waitForTimeout(400);
  };

  for (const [act, name] of [['settings', 'settings'], ['collection', 'collection'], ['challenges', 'challenges']]) {
    await backToMenu();
    await openMenuAction(act);
    await snap(name);
    await s.click('[data-act="close"]').catch(() => {});
    await s.click('[data-act="challenges-close"]').catch(() => {});
    await s.page.waitForTimeout(300);
  }

  await backToMenu();
  await s.click('.panel.is-menu [data-act="profile"]');
  await s.page.waitForTimeout(500);
  await snap('profile');
  await s.click('[data-act="profile-close"]').catch(() => {});
  await s.page.waitForTimeout(300);

  // Arranque de run -> ciego -> partida.
  await backToMenu();
  await s.click('.panel.is-menu [data-act="new"]');
  await s.page.waitForTimeout(600);
  if (await s.has('.panel.is-archetypes')) {
    await snap('archetypes');
    await s.click('[data-act="archetypes-start"]');
    await s.page.waitForTimeout(1300);
  }
  await s.click('[data-act="tutorial-close"]');
  await snap('blind-select');

  await s.page.evaluate(() => { const ff = window.__fungiflush; ff.engine.chooseBlind(ff.engine.availableBlinds()[0]?.id); });
  await s.page.waitForFunction(() => (window.__fungiflush?.engine?.round?.hand?.length ?? 0) > 0, { timeout: 15000, polling: 250 });
  await s.page.waitForTimeout(1200);
  await snap('playing');

  // Ciego superado -> recompensa -> tienda.
  await s.page.evaluate(() => {
    const ff = window.__fungiflush; const r = ff.engine.round;
    if (r) r.target = 1;
    const uid = r?.hand?.[0]?.uid;
    if (uid) { ff.engine.toggleSelect(uid); ff.engine.playHand(); }
  });
  await s.waitPanel('.panel.is-cleared, .panel.is-reward', 12000);
  await s.page.waitForTimeout(500);
  if (await s.has('.panel.is-cleared')) {
    await snap('cleared');
    await s.click('.panel.is-cleared [data-act="cleared-continue"]');
    await s.waitPanel('.panel.is-reward', 8000);
    await s.page.waitForTimeout(400);
  }
  if (await s.has('.panel.is-reward')) await snap('reward');
  if (await s.has('.panel.is-reward [data-act="skip"]')) {
    await s.click('.panel.is-reward [data-act="skip"]');
    await s.waitPanel('.panel.is-shop', 8000);
    await s.page.waitForTimeout(500);
  }
  if (await s.has('.panel.is-shop')) await snap('shop');
  return out;
}

// Las dos sesiones NO conviven: con SwiftShader la escena 3D va a ~2-3 FPS y dos
// contextos renderizando a la vez se pelean por la CPU — el arranque del segundo
// pasaba de ~10s a ~40s (medido) y vencia el timeout del gate. Cada una se crea,
// se recorre y se CIERRA antes de abrir la siguiente: el gate compara snapshots
// ya tomados, no necesita las dos paginas vivas al mismo tiempo.
const desktop = await makeSession({ name: 'desktop', viewport: { width: 1440, height: 810 }, mobile: false });
const D = await walk(desktop);
await desktop.context.close();

const mobile = await makeSession({ name: 'mobile', viewport: { width: 915, height: 412 }, mobile: true });
const M = await walk(mobile);
await mobile.context.close();

await browser.close();

// ---------------------------------------------------------------- INVARIANTES
const checks = [];
const chk = (name, ok, detail) => { checks.push({ name, ok: Boolean(ok), detail }); return Boolean(ok); };

const screens = [...new Set([...Object.keys(D), ...Object.keys(M)])];

// I1 — No fuga MOVIL -> ESCRITORIO (cromo solo-movil oculto en escritorio).
for (const label of Object.keys(D)) {
  const d = D[label];
  chk(`I1 ${label}: .hud-status oculto en escritorio`, !d.vis.hudStatus, d.vis.hudStatus ? 'VISIBLE' : 'ok');
  chk(`I1 ${label}: .hud-missions-toggle oculto en escritorio`, !d.vis.missionsToggle, d.vis.missionsToggle ? 'VISIBLE' : 'ok');
}

// I2 — No fuga ESCRITORIO -> MOVIL (el movil mantiene su cromo propio).
for (const label of Object.keys(M)) {
  const m = M[label];
  if (label === 'playing') {
    chk(`I2 ${label}: movil muestra 0 contadores de ESTADO (ocultos a proposito)`, m.vis.stateCounters === 0, `stateCounters=${m.vis.stateCounters}`);
    chk(`I2 ${label}: movil muestra .hud-missions-toggle`, m.vis.missionsToggle, `toggle=${m.vis.missionsToggle}`);
  }
}

// I3 — Paridad de TEXTOS de las acciones principales (mismo estado -> misma etiqueta).
for (const label of screens) {
  if (!D[label] || !M[label]) continue;
  const dl = D[label].labels;
  const ml = M[label].labels;
  for (const key of ['play', 'primary', 'close']) {
    if (!dl[key] || !ml[key]) continue;
    // Comparacion tolerante: mayus/minus y espacios normalizados.
    const norm = (s) => s.toUpperCase().replace(/\s+/g, ' ').trim();
    chk(`I3 ${label}: etiqueta "${key}" coincide`, norm(dl[key]) === norm(ml[key]), `desk="${dl[key]}" mov="${ml[key]}"`);
  }
}

// I4 — Acciones alcanzables en AMBAS plataformas.
for (const label of screens) {
  for (const [platform, set] of [['desk', D], ['mob', M]]) {
    if (!set[label]) continue;
    chk(`I4 ${platform} ${label}: acciones dentro del viewport`, set[label].overflow.length === 0, set[label].overflow.join(', ') || 'ok');
  }
}

// I5 — Sin scroll de pagina no intencional en ninguna plataforma.
for (const label of screens) {
  for (const [platform, set] of [['desk', D], ['mob', M]]) {
    if (!set[label]) continue;
    const ov = set[label];
    chk(`I5 ${platform} ${label}: sin scroll de pagina`, ov.pageScroll <= 1, `pageScroll=${ov.pageScroll}`);
  }
}

// I6 — Baseline de geometria de escritorio (drift controlado).
let baseline = {};
try { if (existsSync(BASELINE_PATH)) baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf8')); } catch { /* noop */ }
const newBaseline = { tol: DRIFT_TOL, screens: {} };
for (const label of Object.keys(D)) {
  newBaseline.screens[label] = D[label].markers;
}
if (UPDATE || Object.keys(baseline).length === 0) {
  writeFileSync(BASELINE_PATH, JSON.stringify(newBaseline, null, 2));
  console.log(`\n[baseline] escrito tools/parity-baseline.json (${Object.keys(newBaseline.screens).length} pantallas)`);
} else {
  for (const label of Object.keys(D)) {
    const prev = baseline.screens?.[label];
    const cur = newBaseline.screens[label];
    if (!prev || !cur) continue;
    for (const key of Object.keys(cur)) {
      const a = prev[key];
      const b = cur[key];
      if (!a || !b) continue;
      const drift = Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y), Math.abs(a.w - b.w), Math.abs(a.h - b.h));
      chk(`I6 ${label}: ${key} sin drift (tol ${DRIFT_TOL})`, drift <= DRIFT_TOL, `drift=${drift.toFixed(3)}`);
    }
  }
}

// ---------------------------------------------------------------- RESUMEN
const errors = [...desktop.errors, ...mobile.errors];
console.log('\n================ GATE DE PARIDAD movil <-> escritorio ================');
for (const c of checks) console.log(`  ${c.ok ? 'PASA ' : 'FALLA'}  ${c.name}  (${c.detail})`);
console.log(`\nscreens comparadas: ${screens.length} · checks: ${checks.length} · errores de consola: ${errors.length}`);
for (const e of errors.slice(0, 5)) console.log('  [console]', e);

const failed = checks.filter((c) => !c.ok);
if (failed.length > 0 || errors.length > 0) {
  console.error(`\nX PARIDAD ROTA: ${failed.length} checks fallaron` + (errors.length ? ` + ${errors.length} errores de consola` : ''));
  process.exit(1);
}
console.log('\nOK PARIDAD VERDE');
