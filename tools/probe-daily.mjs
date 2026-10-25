/**
 * probe-daily.mjs — Desafio diario (R1).
 *
 * QUE VERIFICA
 * ------------
 *   1. La tarjeta "Diaria" del panel Desafios ARRANCA la run diaria (antes
 *      abria la recompensa): `run.daily === true` y la semilla es exactamente
 *      `hashString("fungiflush:daily:" + fecha LOCAL)`.
 *   2. Misma fecha = misma run: con perfil limpio, dos arranques del mismo dia
 *      comparten semilla, primer ciego y mano inicial.
 *   3. Fecha distinta = otra run: con el reloj fijado a otro dia, la firma
 *      cambia (semilla y mano).
 *   4. El panel de resultado muestra el modo diario (`[data-mode="daily"]`).
 *   5. El SEGUNDO intento del dia se bloquea con un aviso y no arranca otra run.
 *   6. 0 errores de consola.
 *
 *   node tools/probe-daily.mjs
 *
 * Requiere el dev server en http://127.0.0.1:1420.
 * Usa `?daily=0` para que el modal de la recompensa no tape el menu.
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

// ---------------------------------------------------------------------------
// Semilla esperada: la MISMA cuenta que `src/meta/DailyRun.ts` + `rng.ts`.
// El probe tiene que predecirla, no leerla del juego: si la formula cambia sin
// querer, esto lo delata.
// ---------------------------------------------------------------------------

function hashString(text) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function dateKey(ts) {
  const d = new Date(ts);
  const month = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${d.getFullYear()}-${month}-${day}`;
}

const dailySeed = (date) => hashString(`fungiflush:daily:${date}`);

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

const browser = await chromium.launch({
  executablePath: exe, headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--disable-dev-shm-usage'],
});
const context = await browser.newContext({ viewport: { width: 915, height: 412 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const page = await context.newPage();
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? `  ${detail}` : ''}`);
};

/** Firma de la run en curso: lo que tiene que coincidir entre dos jugadores. */
const signature = () => page.evaluate(() => {
  const e = window.__fungiflush.engine;
  return {
    daily: e.run.daily === true,
    seed: e.run.seed,
    status: e.run.status,
    blind: e.round?.blind?.id ?? null,
    target: e.round?.target ?? null,
    hand: (e.round?.hand ?? []).map((c) => c.def.id).join(','),
  };
});

const boot = async () => {
  await page.waitForFunction(() => Boolean(window.__fungiflush?.engine?.run), { timeout: 30000 });
  await page.waitForTimeout(700);
  // El tutorial de primera vez se abre solo en un perfil limpio.
  await page.evaluate(() => document.querySelector('[data-act="tutorial-close"]')?.click());
  await page.waitForTimeout(200);
};

/** Perfil limpio: el intento del dia no esta consumido. */
const resetProfile = async () => {
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'load' });
  await boot();
};

/**
 * R3 — Resuelve el borrador de bendicion con la PRIMERA oferta: es
 * determinista para una semilla dada (el diario usa la de la fecha) y deja la
 * run en `blind_select`. Sin esto la run se quedaba en 'draft' y `chooseBlind`
 * no hacia nada.
 */
const resolveDraft = async () => {
  const picked = await page.evaluate(() => {
    const e = window.__fungiflush.engine;
    const d = e.currentDraft;
    if (!d?.offers?.length) return null;
    e.chooseDraft(d.offers[0].id);
    return d.offers[0].id;
  });
  if (picked === null) return false;
  await page
    .waitForFunction(() => window.__fungiflush.engine.run?.status === 'blind_select', null, { timeout: 8000 })
    .catch(() => {});
  await page.waitForTimeout(400);
  return true;
};

/**
 * Abre Desafios y toca la tarjeta "Diaria". El selector va ESCOPEADO al panel:
 * el chip del menu tambien lleva `data-act="daily"`.
 */
const startDaily = async () => {
  await page.evaluate(() => document.querySelector('[data-act="challenges"]')?.click());
  await page.waitForFunction(() => Boolean(document.querySelector('.panel.is-challenges')), null, { timeout: 10000 });
  await page.evaluate(() => document.querySelector('.panel.is-challenges [data-act="daily"]')?.click());
  await page.waitForTimeout(700);
  await resolveDraft();
  // Se elige el ciego para que exista la mano (la firma la incluye).
  await page.evaluate(() => window.__fungiflush.engine.chooseBlind());
  await page.waitForTimeout(400);
  return signature();
};

// ---------------------------------------------------------------------------
// 1 + 2. Hoy: la semilla es la de la fecha y dos arranques coinciden
// ---------------------------------------------------------------------------

const today = dateKey(Date.now());
const expectedToday = dailySeed(today);
console.log(`\nfecha local de hoy: ${today} · semilla esperada: ${expectedToday}\n`);

await page.goto(URL_TO_TEST, { waitUntil: 'load', timeout: 45000 });
await resetProfile();

const first = await startDaily();
check('la tarjeta Diaria arranca la run diaria', first.daily === true && first.status === 'playing', `status=${first.status}`);
check('la semilla es hash("fungiflush:daily:" + fecha local)', first.seed === expectedToday, `${first.seed} vs ${expectedToday}`);
check('la run tiene primer ciego y mano', Boolean(first.blind) && first.hand.length > 0, `${first.blind} · ${first.hand.split(',').length} cartas`);

// --- Panel de resultado en modo diario ---
await page.evaluate(() => window.__fungiflush.hud.forceGameOver('loss'));
await page.waitForFunction(() => Boolean(document.querySelector('.panel.is-gameover')), null, { timeout: 10000 });
const gameOverMode = await page.evaluate(() =>
  document.querySelector('.panel.is-gameover .panel-subtitle')?.getAttribute('data-mode') ?? null,
);
check('el panel de resultado marca el modo diario', gameOverMode === 'daily', `data-mode=${gameOverMode}`);
await page.screenshot({ path: join(shotsDir, 'daily-gameover.png') });

// --- Segundo arranque del MISMO dia con perfil limpio: misma firma ---
await resetProfile();
const second = await startDaily();
check(
  'misma fecha = misma semilla, ciego y mano',
  second.daily === true && second.seed === first.seed && second.blind === first.blind && second.hand === first.hand,
  `seed=${second.seed} hand=${second.hand === first.hand ? 'igual' : 'DISTINTA'}`,
);

// ---------------------------------------------------------------------------
// 5. Segundo intento del dia: se bloquea con aviso
// ---------------------------------------------------------------------------

// La run anterior consumio el intento (perfil con `playedDate` = hoy). Se
// vuelve al menu SIN limpiar el perfil.
await page.evaluate(() => {
  window.__fungiflush.engine.enterMenu();
  window.__fungiflush.scene.setMode('menu');
});
await page.waitForTimeout(600);
await page.evaluate(() => document.querySelector('[data-act="challenges"]')?.click());
await page.waitForFunction(() => Boolean(document.querySelector('.panel.is-challenges')), null, { timeout: 10000 });
const cardDetail = await page.evaluate(() =>
  document.querySelector('.panel.is-challenges [data-act="daily"] .challenges-card-detail')?.textContent ?? '',
);
check('la tarjeta dice que ya se jugo hoy', /played|jugado/i.test(cardDetail), JSON.stringify(cardDetail));

await page.evaluate(() => document.querySelector('.panel.is-challenges [data-act="daily"]')?.click());
await page.waitForTimeout(700);
const afterBlocked = await page.evaluate(() => ({
  status: window.__fungiflush.engine.run?.status ?? null,
  daily: window.__fungiflush.engine.run?.daily === true,
  toast: document.querySelector('.toast-stack .toast')?.textContent ?? null,
}));
check('el segundo intento NO arranca otra run', afterBlocked.status === 'menu' && afterBlocked.daily === false, `status=${afterBlocked.status}`);
check('el segundo intento avisa por que', /already played|ya jugaste/i.test(afterBlocked.toast ?? ''), JSON.stringify(afterBlocked.toast));

// ---------------------------------------------------------------------------
// 3. Fecha distinta = otra run (reloj fijado a otro dia)
// ---------------------------------------------------------------------------

// En la MISMA pagina: un segundo contexto con WebGL bajo SwiftShader no
// inicializa (regla del proyecto: un solo contexto a la vez).
// `setFixedTime` fija SOLO `Date.now()`; los timers siguen corriendo normales.
//
// La "otra fecha" sale de MANANA y no de una fecha fija: si se hardcodea,
// el dia que coincide con la fecha real del reloj el check falla sin que
// haya cambiado nada del juego (paso hoy, 2026-10-25, con la fecha fija
// siendo esa misma). Tomarla de manana garantiza que sea DISTINTA de la de
// la primera run cualquier dia que se corra.
const manana = new Date();
manana.setDate(manana.getDate() + 1);
manana.setHours(12, 0, 0, 0);
await page.clock.setFixedTime(manana);
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'load' });
await boot();
const other = await startDaily();
const expectedOther = dailySeed(dateKey(manana.getTime()));
check('con otra fecha la semilla es la de ESA fecha', other.daily && other.seed === expectedOther, `${other.seed} vs ${expectedOther}`);
check('con otra fecha la mano inicial cambia', other.hand !== first.hand, other.hand === first.hand ? 'IGUAL (mal)' : 'distinta');

// ---------------------------------------------------------------------------
// Veredicto
// ---------------------------------------------------------------------------

const failed = results.filter((r) => !r.ok);
console.log(`\nerrores de consola: ${errors.length ? errors.slice(0, 3) : 'ninguno'}`);
const ok = failed.length === 0 && errors.length === 0;
console.log(ok ? '\nOK DESAFIO DIARIO FUNCIONANDO' : `\nXX FALLARON ${failed.length} CHECK(S)`);
await browser.close();
process.exitCode = ok ? 0 : 1;
