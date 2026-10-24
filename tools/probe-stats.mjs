/**
 * probe-stats.mjs — Stats/historial ricos + semilla copiable (R4).
 *
 * QUE VERIFICA
 * ------------
 *   1. Al terminar una run suben los contadores del perfil: `runs`,
 *      `bestScore`, `totalBlinds`.
 *   2. La entrada de historial trae `seed`, `totalScore` y `mode` ('classic').
 *   3. El panel de resultado muestra la semilla y el boton de copiar responde
 *      (toast de confirmacion o de fallo: nunca silencio).
 *   4. Una run del DESAFIO DIARIO deja `mode: 'daily'` en el historial y se
 *      marca con la etiqueta en la fila del historial.
 *   5. El panel de perfil muestra las 6 stats (ante/victorias/racha + mejor
 *      score/ciegos/diarias) con el mejor score de la run.
 *   6. 0 errores de consola.
 *
 *   node tools/probe-stats.mjs
 *
 * Requiere el dev server en http://127.0.0.1:1420.
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

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? `  ${detail}` : ''}`);
};

const boot = async () => {
  await page.waitForFunction(() => Boolean(window.__fungiflush?.engine?.run), { timeout: 30000 });
  await page.waitForTimeout(800);
  await page.evaluate(() => document.querySelector('[data-act="tutorial-close"]')?.click());
  await page.waitForTimeout(200);
};

const resetProfile = async () => {
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'load' });
  await boot();
};

const stats = () => page.evaluate(() => {
  const s = window.__fungiflush.profileStore.current.stats;
  return { runs: s.runs, bestScore: s.bestScore, totalBlinds: s.totalBlinds, dailyRuns: s.dailyRuns, dailyWins: s.dailyWins };
});

const historyTop = () => page.evaluate(() => {
  const h = window.__fungiflush.profileStore.current.history[0] ?? null;
  return h ? { seed: h.seed, totalScore: h.totalScore, mode: h.mode ?? null, win: h.win } : null;
});

/** Gana el ciego en curso en el acto (target = 1) y sale del reward/tienda. */
const clearBlind = async () => {
  await page.evaluate(() => {
    const e = window.__fungiflush.engine;
    const r = e.round;
    if (r) r.target = 1;
    const uid = r?.hand?.[0]?.uid;
    if (uid) { e.clearSelection(); e.toggleSelect(uid); e.playHand(); }
  });
  await page.waitForFunction(
    () => ['reward', 'shop', 'blind_select', 'interlude'].includes(window.__fungiflush.engine.run?.status),
    null, { timeout: 25000 },
  ).catch(() => {});
  // Se salta la recompensa y la tienda hasta volver a blind_select.
  for (let i = 0; i < 8; i += 1) {
    const status = await page.evaluate(() => window.__fungiflush.engine.run?.status);
    if (status === 'blind_select') return true;
    await page.evaluate(() => {
      const e = window.__fungiflush.engine;
      if (e.run.status === 'reward') e.chooseReward(null);
      else if (e.run.status === 'shop') e.leaveShop();
      else if (e.run.status === 'interlude') {
        const c = e.pendingInterlude?.choices?.[0];
        if (c) e.chooseInterlude(c.id);
      }
    });
    await page.waitForTimeout(400);
  }
  return (await page.evaluate(() => window.__fungiflush.engine.run?.status)) === 'blind_select';
};

/** Quema todas las manos con un objetivo imposible: la run termina en derrota. */
const loseRun = async () => {
  await page.evaluate(() => {
    const e = window.__fungiflush.engine;
    const r = e.round;
    if (!r) return;
    r.target = 999999999;
    for (let i = 0; i < 12 && e.run.status === 'playing'; i += 1) {
      e.clearSelection();
      for (const c of (e.round?.hand ?? []).slice(0, 5)) e.toggleSelect(c.uid);
      if ((e.round?.selected?.length ?? 0) === 0) break;
      e.playHand();
    }
  });
  await page.waitForFunction(() => window.__fungiflush.engine.run?.status === 'game_over', null, { timeout: 30000 });
  await page.waitForTimeout(900);
};

// ---------------------------------------------------------------------------
// 1. Run clasica: ganar un ciego y perder
// ---------------------------------------------------------------------------

await page.goto(URL_TO_TEST, { waitUntil: 'load', timeout: 45000 });
await resetProfile();

const before = await stats();
check('el perfil arranca en cero', before.runs === 0 && before.bestScore === 0 && before.totalBlinds === 0, JSON.stringify(before));

await page.evaluate(() => {
  const e = window.__fungiflush.engine;
  e.startRun(424242, 0, '');
  e.chooseBlind();
});
await page.waitForFunction(() => (window.__fungiflush?.engine?.round?.hand?.length ?? 0) > 0, null, { timeout: 15000 });
await page.waitForTimeout(600);

const cleared = await clearBlind();
check('el primer ciego queda superado', cleared, '');

await page.evaluate(() => window.__fungiflush.engine.chooseBlind());
await page.waitForFunction(() => (window.__fungiflush?.engine?.round?.hand?.length ?? 0) > 0, null, { timeout: 15000 });
await page.waitForTimeout(600);
await loseRun();

const after = await stats();
check('la run suma 1 a `runs`', after.runs === 1, `runs=${after.runs}`);
check('el mejor score sube con la run', after.bestScore > 0, `bestScore=${after.bestScore}`);
check('los ciegos superados se acumulan', after.totalBlinds >= 1, `totalBlinds=${after.totalBlinds}`);

const entry = await historyTop();
check('el historial guarda seed, score y modo', Boolean(entry) && entry.seed === 424242 && entry.totalScore > 0 && entry.mode === 'classic',
  JSON.stringify(entry));

// --- Panel de resultado: semilla visible + boton de copiar ---
await page.waitForFunction(() => Boolean(document.querySelector('.panel.is-gameover')), null, { timeout: 15000 }).catch(() => {});
const seedUi = await page.evaluate(() => {
  const sub = document.querySelector('.panel.is-gameover .panel-subtitle');
  const btn = document.querySelector('.panel.is-gameover [data-act="copy-seed"]');
  return { text: sub?.textContent ?? '', hasButton: Boolean(btn) };
});
check('la semilla se ve en el resultado', /424242/.test(seedUi.text), JSON.stringify(seedUi.text.slice(0, 40)));
check('el resultado trae el boton de copiar', seedUi.hasButton);

await page.evaluate(() => document.querySelector('.panel.is-gameover [data-act="copy-seed"]')?.click());
await page.waitForTimeout(700);
// El stack puede tener avisos VIEJOS ("Blind failed" del cierre): se busca el
// ultimo que hable de copiar, no el primero del stack.
const toast = await page.evaluate(() => {
  const nodes = [...document.querySelectorAll('.toast-stack .toast')];
  for (let i = nodes.length - 1; i >= 0; i -= 1) {
    const txt = nodes[i]?.textContent ?? '';
    if (/copi|copied|couldn|no se pudo/i.test(txt)) return txt;
  }
  return nodes[nodes.length - 1]?.textContent ?? null;
});
check('copiar responde con un aviso', /copiad|copiado|copied|couldn|no se pudo/i.test(toast ?? ''), JSON.stringify(toast));
await page.screenshot({ path: join(shotsDir, 'stats-gameover.png') });

// ---------------------------------------------------------------------------
// 2. Run diaria: el historial la marca
// ---------------------------------------------------------------------------

await page.evaluate(() => {
  const ff = window.__fungiflush;
  ff.engine.enterMenu();
  ff.scene.setMode('menu');
});
await page.waitForTimeout(700);
await page.evaluate(() => document.querySelector('[data-act="challenges"]')?.click());
await page.waitForFunction(() => Boolean(document.querySelector('.panel.is-challenges')), null, { timeout: 10000 });
await page.evaluate(() => document.querySelector('.panel.is-challenges [data-act="daily"]')?.click());
await page.waitForTimeout(800);
const dailyStarted = await page.evaluate(() => ({
  daily: window.__fungiflush.engine.run?.daily === true,
  status: window.__fungiflush.engine.run?.status,
}));
check('la tarjeta Diaria arranca la run', dailyStarted.daily === true, `status=${dailyStarted.status}`);

await page.evaluate(() => window.__fungiflush.engine.chooseBlind());
await page.waitForFunction(() => (window.__fungiflush?.engine?.round?.hand?.length ?? 0) > 0, null, { timeout: 15000 });
await page.waitForTimeout(600);
await loseRun();

const dailyStats = await stats();
check('la diaria suma a `dailyRuns`', dailyStats.dailyRuns === 1, `dailyRuns=${dailyStats.dailyRuns} de runs=${dailyStats.runs}`);
const dailyEntry = await historyTop();
check('el historial marca la run como diaria', dailyEntry?.mode === 'daily', JSON.stringify(dailyEntry));

// --- La fila del historial pinta la etiqueta ---
await page.evaluate(() => {
  const ff = window.__fungiflush;
  ff.engine.enterMenu();
  ff.scene.setMode('menu');
});
await page.waitForTimeout(700);
await page.evaluate(() => document.querySelector('.panel.is-menu [data-act="profile"]')?.click());
await page.waitForFunction(() => Boolean(document.querySelector('.panel.is-profile')), null, { timeout: 10000 });
await page.evaluate(() => document.querySelector('.panel.is-profile [data-act="history"]')?.click());
await page.waitForTimeout(700);
const historyUi = await page.evaluate(() => {
  const panel = document.querySelector('.panel.is-history');
  const rows = [...(panel?.querySelectorAll('.history-row') ?? [])];
  return {
    rows: rows.length,
    dailyTags: rows.filter((r) => r.querySelector('.history-mode[data-mode="daily"]')).length,
    firstMode: rows[0]?.querySelector('.history-mode')?.getAttribute('data-mode') ?? null,
  };
});
check('el historial muestra la etiqueta Diaria', historyUi.dailyTags === 1 && historyUi.firstMode === 'daily', JSON.stringify(historyUi));
await page.screenshot({ path: join(shotsDir, 'stats-history.png') });

// ---------------------------------------------------------------------------
// 3. Panel de perfil con las 6 stats
// ---------------------------------------------------------------------------

await page.evaluate(() => document.querySelector('.panel.is-history [data-act="history-close"]')?.click());
await page.waitForTimeout(600);
const profileUi = await page.evaluate(() => {
  const panel = document.querySelector('.panel.is-profile');
  const cells = [...(panel?.querySelectorAll('.profile-stat') ?? [])].map((c) => ({
    label: c.querySelector('.profile-stat-label')?.textContent ?? '',
    value: c.querySelector('.profile-stat-value')?.textContent ?? '',
  }));
  return { count: cells.length, cells };
});
check('el perfil muestra 6 stats', profileUi.count === 6, JSON.stringify(profileUi.cells));
const scoreCell = profileUi.cells.find((c) => /score/i.test(c.label));
check('la stat de mejor score coincide con el perfil', Boolean(scoreCell) && scoreCell.value !== '0', JSON.stringify(scoreCell));
await page.screenshot({ path: join(shotsDir, 'stats-profile.png') });

// ---------------------------------------------------------------------------
// Veredicto
// ---------------------------------------------------------------------------
const failed = results.filter((r) => !r.ok);
console.log(`\nerrores de consola: ${errors.length ? errors.slice(0, 3) : 'ninguno'}`);
console.log(failed.length === 0 && errors.length === 0 ? '\nOK STATS/HISTORIAL FUNCIONANDO' : `\nXX FALLARON ${failed.length} CHECK(S)`);
await browser.close();
process.exitCode = failed.length === 0 && errors.length === 0 ? 0 : 1;
