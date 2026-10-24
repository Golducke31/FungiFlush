/**
 * probe-blind-pool.mjs — Ruta de ciegos sorteada por ante (R2).
 *
 * QUE VERIFICA
 * ------------
 * El contenido declaro VARIANTES por tier (2 small y 2 big por ante: 24 -> 40
 * ciegos) y el motor sortea UNA por ante con un RNG derivado de la semilla. Lo
 * que se ve en el navegador:
 *
 *   1. La pantalla de seleccion muestra la RUTA: 3 marcas (small -> big ->
 *      jefe) y la tarjeta es EL ciego sorteado, con su nombre traducido.
 *   2. El ciego que se JUEGA es el de la ruta (fuente unica: no se sortea dos
 *      veces, una para mostrar y otra para jugar).
 *   3. La ruta se sortea UNA vez por ante: al superar un ciego los 3 ids no
 *      cambian, solo avanza la marca de "en curso".
 *   4. Misma semilla => misma secuencia de rutas en los 8 antes.
 *   5. 20 semillas => variedad: rutas distintas (y mas de una por ante).
 *   6. La ruta viaja en el guardado REAL (`runStore.save` + `engine.restore`):
 *      recargar no re-suertea.
 *   7. Modo infinito: el ante 9 sigue teniendo 3 ciegos, con la recompensa
 *      bonificada del remapeo.
 *   8. 0 errores de consola.
 *
 *   node tools/probe-blind-pool.mjs
 *
 * Requiere el dev server en http://127.0.0.1:1420.
 */
import { existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const URL_TO_TEST = process.env.FF_URL ?? 'http://127.0.0.1:1420/';
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

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? `  ${detail}` : ''}`);
};

/** Secuencia de rutas de los 8 antes para la semilla dada (por el motor). */
const routesFor = (seed) => page.evaluate((s) => {
  const ff = window.__fungiflush;
  ff.engine.startRun(s, 0, '');
  const out = [];
  for (let ante = 1; ante <= 8; ante++) {
    ff.engine.run.ante = ante;
    ff.engine.run.blindRoute = [];
    out.push(ff.engine.availableBlinds().map((b) => b.id));
  }
  return out;
}, seed);

const waitBlindSelect = () =>
  page.waitForFunction(() => Boolean(document.querySelector('.panel.is-blind-select')), null, { timeout: 15000 });

/** Panel de seleccion: marcas de ruta + ciego en curso. */
const blindSelectDom = () => page.evaluate(() => {
  const panel = document.querySelector('.panel.is-blind-select');
  const dots = [...(panel?.querySelectorAll('[data-blind-route-index]') ?? [])];
  const card = panel?.querySelector('.blind-card') ?? null;
  return {
    dots: dots.length,
    done: dots.filter((d) => d.classList.contains('is-done')).length,
    now: dots.filter((d) => d.classList.contains('is-now')).length,
    blindId: card?.dataset?.blind ?? null,
    name: panel?.querySelector('.blind-name')?.textContent ?? '',
  };
});

await page.goto(URL_TO_TEST, { waitUntil: 'load', timeout: 45000 });
await page.waitForFunction(() => Boolean(window.__fungiflush?.engine?.run), { timeout: 30000 });
await page.waitForTimeout(800);
await page.evaluate(() => document.querySelector('[data-act="tutorial-close"]')?.click());
await page.evaluate(async () => { await window.__fungiflush.runStore.clear(); });
await page.waitForTimeout(200);

// ---------------------------------------------------------------------------
// 1-2. La UI muestra la ruta y juega ESE ciego
// ---------------------------------------------------------------------------

const SEED = 20261024;
await page.evaluate((s) => window.__fungiflush.engine.startRun(s, 0, ''), SEED);
await waitBlindSelect();
await page.waitForTimeout(500);

const routeA = await page.evaluate(() => window.__fungiflush.engine.availableBlinds().map((b) => b.id));
const dom1 = await blindSelectDom();
check('la ruta del ante 1 tiene 3 ciegos', routeA.length === 3, routeA.join(' > '));
check('la UI dibuja las 3 marcas de ruta', dom1.dots === 3, JSON.stringify(dom1));
check('la tarjeta es el PRIMER ciego de la ruta', dom1.blindId === routeA[0], `${dom1.blindId} vs ${routeA[0]}`);
check('la tarjeta muestra el nombre traducido', dom1.name.length > 1, dom1.name);
check('la marca "en curso" es la primera', dom1.now === 1 && dom1.done === 0, `done=${dom1.done} now=${dom1.now}`);
await page.screenshot({ path: join(shotsDir, 'blind-pool-select.png') });

const played = await page.evaluate(() => {
  const ff = window.__fungiflush;
  ff.engine.chooseBlind();
  return { id: ff.engine.round?.blind?.id ?? null, tier: ff.engine.round?.blind?.tier ?? null };
});
check('el ciego jugado es el de la ruta', played.id === routeA[0] && played.tier === 'small', `${played.id} (${played.tier})`);

// ---------------------------------------------------------------------------
// 3. La ruta se sortea UNA vez por ante: los ids no cambian al avanzar
// ---------------------------------------------------------------------------

const routeAfterBlind = await page.evaluate(() => {
  const ff = window.__fungiflush;
  const ids = ff.engine.availableBlinds().map((b) => b.id);
  // Se fuerza el fin de la ronda como haria el flujo real (sin jugar): el
  // motor solo recalcula la ruta al ENTRAR a un ante, no en cada ciego.
  // `emitState` es privado en TS pero accesible desde JS: es lo que el motor
  // emite tras cualquier cambio y lo que dispara el redibujado del panel.
  ff.engine.run.status = 'blind_select';
  ff.engine.run.blindIndex = 1;
  ff.engine.emitState();
  return { ids, next: ff.engine.availableBlinds().map((b) => b.id) };
});
check(
  'avanzar de ciego NO re-sortea la ruta',
  JSON.stringify(routeAfterBlind.ids) === JSON.stringify(routeAfterBlind.next),
  routeAfterBlind.next.join(' > '),
);

await page.waitForTimeout(400);
const dom2 = await blindSelectDom();
check('la UI marca el segundo ciego como en curso', dom2.now === 1 && dom2.done === 1, `done=${dom2.done} now=${dom2.now}`);
check('la tarjeta cambio al segundo de la ruta', dom2.blindId === routeA[1], `${dom2.blindId} vs ${routeA[1]}`);

// ---------------------------------------------------------------------------
// 4. Misma semilla => misma secuencia
// ---------------------------------------------------------------------------

const seqA = await routesFor(SEED);
const seqB = await routesFor(SEED);
check(
  'misma semilla => misma secuencia de rutas',
  JSON.stringify(seqA) === JSON.stringify(seqB),
  `${seqA.length} antes`,
);
check(
  'todas las rutas son small -> big -> jefe',
  seqA.every((r) => r.length === 3 && r[2] === `blind_a${seqA.indexOf(r) + 1}_boss`),
  seqA.map((r) => r[0].replace('blind_a', '')).join(','),
);

// ---------------------------------------------------------------------------
// 5. 20 semillas => variedad
// ---------------------------------------------------------------------------

const seqs = [];
for (let seed = 1; seed <= 20; seed++) seqs.push(await routesFor(seed));
const distinctSeqs = new Set(seqs.map((s) => s.join('|')));
const distinctAnte3 = new Set(seqs.map((s) => s[2].join('|')));
check('20 semillas dan 20 secuencias distintas', distinctSeqs.size === 20, `${distinctSeqs.size}/20`);
check('y mas de una ruta posible por ante', distinctAnte3.size >= 3, `${distinctAnte3.size} rutas en el ante 3`);

// ---------------------------------------------------------------------------
// 6. La ruta viaja en el guardado real
// ---------------------------------------------------------------------------

const saveRestore = await page.evaluate(async (s) => {
  const ff = window.__fungiflush;
  ff.engine.startRun(s, 0, '');
  const route = ff.engine.availableBlinds().map((b) => b.id);
  await ff.runStore.save(ff.engine.serialize());
  // Otra semilla sorteada OTRA ruta: si el guardado se respeta, al restaurar
  // vuelve la guardada, no la nueva.
  ff.engine.startRun(999999, 0, '');
  const other = ff.engine.availableBlinds().map((b) => b.id);
  const data = await ff.runStore.load();
  ff.engine.restore(data);
  return { route, other, restored: ff.engine.availableBlinds().map((b) => b.id) };
}, SEED);
check(
  'el guardado conserva la ruta (no la re-sortea)',
  JSON.stringify(saveRestore.restored) === JSON.stringify(saveRestore.route)
    && JSON.stringify(saveRestore.other) !== JSON.stringify(saveRestore.route),
  `guardada ${saveRestore.route[0]} / otra semilla ${saveRestore.other[0]}`,
);

// ---------------------------------------------------------------------------
// 7. Modo infinito
// ---------------------------------------------------------------------------

const endless = await page.evaluate(() => {
  const ff = window.__fungiflush;
  ff.engine.startRun(20261024, 0, '');
  ff.engine.run.ante = 9;
  ff.engine.run.blindRoute = [];
  const route = ff.engine.availableBlinds();
  const base = ff.engine.registry.blindsForAnte(8);
  return {
    ids: route.map((b) => b.id),
    tiers: route.map((b) => b.tier).sort(),
    // El remapeo del infinito suma +1 de recompensa por ante de mas (tope +4):
    // cada ciego de la ruta paga uno mas que su par del ante 8.
    bonuses: route.map((b) => base.some((x) => x.tier === b.tier && x.reward === b.reward - 1)),
    rewards: route.map((b) => b.reward),
  };
});
check('el ante infinito tiene 3 ciegos', endless.ids.length === 3, endless.ids.join(' > '));
check(
  'y son small, big y jefe',
  JSON.stringify(endless.tiers) === JSON.stringify(['big', 'boss', 'small']),
  endless.tiers.join(','),
);
check(
  'con la recompensa bonificada del infinito',
  endless.bonuses.every(Boolean),
  endless.rewards.join('/'),
);

// ---------------------------------------------------------------------------
// Veredicto
// ---------------------------------------------------------------------------

const failed = results.filter((r) => !r.ok);
console.log(`\nerrores de consola: ${errors.length ? errors.slice(0, 3).join(' | ') : 'ninguno'}`);
console.log(failed.length === 0 && errors.length === 0
  ? '\nOK RUTA DE CIEGOS FUNCIONANDO'
  : `\nXX FALLARON ${failed.length} CHECK(S)`);
await browser.close();
process.exitCode = failed.length === 0 && errors.length === 0 ? 0 : 1;
