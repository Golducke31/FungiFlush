/**
 * probe-panels-fit.mjs — Auditoria de "ninguna ventana se ve cortada" (movil).
 *
 * QUE VERIFICA (por pantalla, con el panel abierto)
 * -------------------------------------------------
 *   1. El panel entra en el viewport (ni arriba ni abajo).
 *   2. El PIE (`.panel-actions`) se ve entero y no pisa el borde del panel.
 *   3. Ningun contenido queda CORTADO por un contenedor con `overflow: hidden`
 *      (el corte silencioso: el texto esta en el DOM pero no se puede llegar a
 *      el ni scrolleando). Los cuerpos con `overflow-y: auto` son validos: ahi
 *      el contenido es alcanzable.
 *   4. Los hijos directos del panel no se SOLAPAN (el sintoma clasico: una
 *      caja encima de la otra).
 *   5. Los paneles de RESUMEN (game over) no scrollean: si hay mas contenido
 *      del que entra, el jugador ve una fila a medias y lo lee como roto.
 *
 * Los INTERLUDIOS se auditan TODOS (R5): se fuerza cada definicion por id, con
 * las opciones que traiga, y se resuelve por la salida para no dejar ninguno
 * abierto.
 *
 *   node tools/probe-panels-fit.mjs
 *   FF_VIEWPORT=smoke node tools/probe-panels-fit.mjs   # 844x390
 *
 * Requiere el dev server en http://127.0.0.1:1420.
 */
import { existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const URL_TO_TEST = process.env.FF_URL ?? 'http://127.0.0.1:1420/?daily=0';
const VIEWPORT = process.env.FF_VIEWPORT === 'smoke' ? { width: 844, height: 390 } : { width: 915, height: 412 };

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
const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const page = await context.newPage();
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

await page.goto(URL_TO_TEST, { waitUntil: 'load', timeout: 45000 });
await page.waitForFunction(() => Boolean(window.__fungiflush?.engine?.run), { timeout: 30000 });
await page.waitForTimeout(1500);

const click = (sel) => page.evaluate((s) => document.querySelector(s)?.click(), sel);
const has = (sel) => page.evaluate((s) => Boolean(document.querySelector(s)), sel);
const waitPanel = (sel, timeout = 8000) =>
  page.waitForFunction((s) => Boolean(document.querySelector(s)), sel, { timeout }).catch(() => {});

// ---------------------------------------------------------------------------
// Auditoria
// ---------------------------------------------------------------------------

/**
 * Mide la pantalla abierta. Devuelve `issues` (fallos duros) e `info`
 * (cuerpos que scrollean, que por diseno esta permitido salvo en resumen).
 */
const audit = () => page.evaluate(() => {
  const vw = innerWidth;
  const vh = innerHeight;
  const overlay = document.querySelector('#ui-root > .overlay.is-open');
  const panel = overlay ? overlay.querySelector(':scope > .panel') : null;
  if (!panel) return { kind: 'hud', issues: [], info: [] };

  const issues = [];
  const info = [];
  const cls = String(panel.className).replace(/\s+/g, ' ').trim();
  const pr = panel.getBoundingClientRect();

  // 1. El panel entra en el viewport.
  if (pr.top < -1) issues.push(`panel arriba ${Math.round(pr.top)}px`);
  if (pr.bottom > vh + 1) issues.push(`panel abajo +${Math.round(pr.bottom - vh)}px`);
  if (pr.left < -1) issues.push(`panel izq ${Math.round(pr.left)}px`);
  if (pr.right > vw + 1) issues.push(`panel der +${Math.round(pr.right - vw)}px`);

  // 2. El pie se ve entero.
  const footer = panel.querySelector(':scope > .panel-actions');
  if (footer) {
    const fr = footer.getBoundingClientRect();
    if (fr.bottom > pr.bottom - 1) issues.push(`pie cortado +${Math.round(fr.bottom - pr.bottom)}px`);
    if (fr.bottom > vh + 1) issues.push(`pie fuera abajo +${Math.round(fr.bottom - vh)}px`);
  }

  // 3. Cortes silenciosos: contenido que desborda un contenedor NO scrolleable.
  //    Los `overflow-y: auto|scroll` se saltan: ahi el contenido es alcanzable.
  const seen = new Set();
  for (const el of panel.querySelectorAll('*')) {
    if (seen.has(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) continue;
    // Solo interesa contenido con texto propio (los contenedores vacios no
    // "se ven cortados": no muestran nada).
    const ownText = [...el.childNodes].some((n) => n.nodeType === 3 && (n.textContent ?? '').trim().length > 0);
    if (!ownText) continue;
    let a = el.parentElement;
    while (a && a !== panel.parentElement) {
      const cs = getComputedStyle(a);
      if (cs.overflowY === 'auto' || cs.overflowY === 'scroll') break; // alcanzable
      if (cs.overflowY === 'hidden' && a.scrollHeight > a.clientHeight + 2) {
        const ar = a.getBoundingClientRect();
        if (r.bottom > ar.bottom + 2 || r.top < ar.top - 2) {
          const key = `${a.className}|${Math.round(r.bottom - ar.bottom)}`;
          if (!seen.has(key)) {
            seen.add(key);
            issues.push(
              `cortado por .${String(a.className).split(' ')[0]} (+${Math.round(r.bottom - ar.bottom)}px): ` +
              `"${(el.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 22)}"`,
            );
          }
          break;
        }
      }
      a = a.parentElement;
    }
  }

  // 4. Hijos DIRECTOS del panel que se solapan (el sintoma de la caja encima).
  const kids = [...panel.children].filter((el) => {
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return cs.display !== 'none' && cs.position !== 'absolute' && r.width > 0 && r.height > 0;
  });
  for (let i = 0; i < kids.length; i += 1) {
    for (let j = i + 1; j < kids.length; j += 1) {
      const a = kids[i].getBoundingClientRect();
      const b = kids[j].getBoundingClientRect();
      const overlap = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      if (overlap > 2) {
        issues.push(
          `solape ${Math.round(overlap)}px: .${String(kids[i].className).split(' ')[0]} / .${String(kids[j].className).split(' ')[0]}`,
        );
      }
    }
  }

  // 5. Cuerpos que scrollean (informativo; fallo en paneles de RESUMEN).
  for (const el of panel.children) {
    const cs = getComputedStyle(el);
    if (cs.overflowY !== 'auto' && cs.overflowY !== 'scroll') continue;
    const over = el.scrollHeight - el.clientHeight;
    if (over > 2) info.push(`scroll .${String(el.className).split(' ')[0]} ${over}px`);
  }

  return { kind: 'panel', cls, issues, info };
});

/** Paneles de RESUMEN: no pueden scrollear (una fila a medias se lee roto). */
const isSummary = (cls) => /\bis-gameover\b|\bis-cleared\b/.test(cls);

const results = [];
const visit = async (label) => {
  await page.waitForTimeout(320);
  const a = await audit();
  const summaryScroll = isSummary(a.cls ?? '') ? a.info.filter((i) => i.startsWith('scroll')) : [];
  const issues = [...a.issues, ...summaryScroll.map((s) => `resumen scrollea: ${s}`)];
  results.push({ label, cls: a.cls ?? 'HUD', issues, info: a.info });
  const ok = issues.length === 0;
  console.log(
    `${ok ? 'ok  ' : 'FAIL'} ${label.padEnd(20)} ${(a.cls ?? 'HUD').slice(0, 46)}` +
    `${a.info.length ? `  [${a.info.join(' · ')}]` : ''}${ok ? '' : `  -> ${issues.join(' | ')}`}`,
  );
  if (!ok) await page.screenshot({ path: join(shotsDir, `fit-${label}.png`) });
};

// ---------------------------------------------------------------------------
// Recorrido (mismo orden que el gate de escritorio)
// ---------------------------------------------------------------------------

await click('[data-act="tutorial-close"]');
await visit('menu');

const openDrop = async () => {
  await click('.panel.is-menu [data-act="menu-toggle"]');
  await page.waitForTimeout(200);
};
const openMenuAction = async (act) => {
  await openDrop();
  await click(`.panel.is-menu [data-act="${act}"]`);
  await page.waitForTimeout(500);
};
const backToMenu = async () => {
  await page.evaluate(() => {
    const ff = window.__fungiflush;
    ff?.scene?.setCarousel?.(null);
    ff?.hud?.showMenu();
  });
  await page.waitForTimeout(400);
};

const PANEL_OF = {
  menu: '.panel.is-menu',
  profile: '.panel.is-profile',
  settings: '.panel.is-settings',
  collection: '.panel.is-collection',
  challenges: '.panel.is-challenges',
};

const menuPanels = [
  ['settings', '[data-act="close"]', 'drop'],
  ['collection', '[data-act="close"]', 'drop'],
  ['challenges', '[data-act="challenges-close"]', 'drop'],
  ['profile', '[data-act="profile-close"]', 'menu'],
  ['history', '[data-act="history-close"]', 'profile'],
  ['achievements', '[data-act="achievements-close"]', 'profile'],
  ['guide', '[data-act="tutorial-close"]', 'settings'],
  ['about', '[data-act="close"]', 'settings'],
  ['cosmetics', '[data-act="cosmetics-close"]', 'collection'],
  ['daily', '[data-act="daily-close"]', 'challenges'],
  ['archetype', '[data-act="archetypes-close"]', 'challenges'],
  ['ascension', '[data-act="ascension-close"]', 'challenges'],
  ['board', '[data-act="close"]', 'challenges'],
];
for (const [act, close, parent] of menuPanels) {
  await backToMenu();
  if (act === 'daily') {
    // La RECOMPENSA diaria vive en el chip del menu. La tarjeta del panel
    // Desafios ya NO la abre: desde R1 arranca la run del dia.
    if (!(await has('.panel.is-menu [data-act="daily"]'))) continue;
    await click('.panel.is-menu [data-act="daily"]');
    await page.waitForTimeout(600);
    await visit('daily');
    await click('[data-act="daily-close"]').catch(() => {});
    await page.waitForTimeout(300);
    continue;
  }
  if (parent === 'drop') {
    await openMenuAction(act);
  } else {
    if (parent === 'profile') {
      await click('.panel.is-menu [data-act="profile"]');
      await page.waitForTimeout(500);
    } else if (parent !== 'menu') {
      await openMenuAction(parent);
    }
    const sel = `${PANEL_OF[parent] ?? '.panel.is-menu'} [data-act="${act}"]`;
    if (!(await has(sel))) continue;
    await click(sel);
    await page.waitForTimeout(600);
  }
  await visit(act);
  if (act === 'board' && (await has('.board-curtain.is-open'))) {
    await click('[data-act="ready"]');
    await page.waitForTimeout(600);
    await visit('board-jugando');
  }
  if (await has(close)) await click(close);
  else await click('[data-act="close"]');
  await page.waitForTimeout(300);
}

// Sub-paneles de la Coleccion (tienda de expansiones y pase).
await backToMenu();
await openMenuAction('collection');
await page.waitForTimeout(700);
for (const act of ['expansions', 'pass']) {
  if (!(await has(`.panel.is-collection [data-act="${act}"]`))) continue;
  await click(`.panel.is-collection [data-act="${act}"]`);
  await visit(act === 'expansions' ? 'store' : 'pass');
  await click('[data-act="close"]').catch(() => {});
  await page.waitForTimeout(400);
}
await click('[data-act="close"]');
await page.waitForTimeout(400);

// Ranking y recompensas de Colonia (desde el perfil).
await backToMenu();
await click('.panel.is-menu [data-act="profile"]');
await page.waitForTimeout(500);
for (const act of ['leaderboard', 'colony-rewards']) {
  const sel = `.panel.is-profile [data-act="${act}"]`;
  if (!(await has(sel))) continue;
  await click(sel);
  await page.waitForTimeout(700);
  await visit(act);
  await click('[data-act="close"]').catch(() => {});
  await page.waitForTimeout(400);
  if (!(await has('.panel.is-profile'))) {
    await backToMenu();
    await click('.panel.is-menu [data-act="profile"]');
    await page.waitForTimeout(500);
  }
}
await click('[data-act="profile-close"]').catch(() => {});
await page.waitForTimeout(300);

// ------------------------------------------------------------------ RUN
await backToMenu();
await click('.panel.is-menu [data-act="new"]');
await page.waitForTimeout(600);
if (await has('.panel.is-archetypes')) {
  await visit('archetypes-run');
  await click('[data-act="archetypes-start"]');
  await page.waitForTimeout(1300);
}
await click('[data-act="tutorial-close"]');
await visit('blind-select');

await page.evaluate(() => {
  const ff = window.__fungiflush;
  ff.engine.run.blindIndex = 2;
  ff.engine.enterBlindSelect();
  ff.hud.showBlindSelect();
});
await waitPanel('.panel.is-blind-select', 8000);
await visit('blind-select-JEFE');
if (await has('.panel.is-blind-select [data-act="blind-details"]')) {
  await click('.panel.is-blind-select [data-act="blind-details"]');
  await visit('blind-details');
  await click('[data-act="close"]');
  await page.waitForTimeout(400);
}

await page.evaluate(() => {
  const ff = window.__fungiflush;
  ff.engine.chooseBlind(ff.engine.availableBlinds()[2]?.id);
});
await page.waitForFunction(() => (window.__fungiflush?.engine?.round?.hand?.length ?? 0) > 0, { timeout: 15000 });
await page.waitForTimeout(800);
await visit('playing');
await page.evaluate(() => {
  const ff = window.__fungiflush;
  ff.engine.clearSelection();
  for (const c of (ff.engine.round?.hand ?? []).slice(0, 2)) ff.engine.toggleSelect(c.uid);
});
await page.waitForTimeout(600);
await visit('playing-con-sel');

await click('.hud-top [data-act="quit-to-menu"]');
await visit('menu-ingame');
await click('[data-act="quit-cancel"]');
await page.waitForTimeout(400);

// ------------------------------------------------------------ CIEGO SUPERADO
await page.evaluate(() => {
  const ff = window.__fungiflush;
  const r = ff.engine.round;
  if (r) r.target = 1;
  const uid = r?.hand?.[0]?.uid;
  if (uid) { ff.engine.toggleSelect(uid); ff.engine.playHand(); }
});
await waitPanel('.panel.is-cleared, .panel.is-reward', 12000);
await page.waitForTimeout(600);
if (await has('.panel.is-cleared')) {
  await visit('cleared');
  await click('.panel.is-cleared [data-act="cleared-continue"]');
  await waitPanel('.panel.is-reward', 8000);
  await page.waitForTimeout(400);
}
if (await has('.panel.is-reward')) await visit('reward');
if (await has('.panel.is-reward [data-act="skip"]')) {
  await click('.panel.is-reward [data-act="skip"]');
  await waitPanel('.panel.is-shop', 8000);
  await page.waitForTimeout(500);
}
if (await has('.panel.is-shop')) await visit('shop');

await page.evaluate(() => document.querySelector('.panel.is-shop [data-act="deck"]')?.click()
  ?? document.querySelector('.hud-top [data-act="deck"]')?.click());
await page.waitForTimeout(2400);
if (await has('.panel.is-deck')) {
  await visit('deck-carrusel');
  await click('[data-act="close"]');
  await page.waitForTimeout(600);
}

await page.evaluate(() => {
  const ff = window.__fungiflush;
  if (ff.engine.run.status === 'shop') ff.engine.leaveShop();
});
await page.waitForTimeout(900);

// ------------------------------------------------------------ INTERLUDIOS
// R5: con 14 eventos ya no se espera a que el sorteo depare uno — el panel que
// saldria dependeria de la semilla y el probe auditaria uno distinto en cada
// corrida. Se FUERZA cada definicion por id (mismo camino que el motor:
// `pendingInterlude` + estado + evento), asi la auditoria recorre los paneles
// REALES con el numero de opciones que traiga cada uno (2, 3, las que sean).
const interludeIds = await page.evaluate(() =>
  (window.__fungiflush.content?.registry?.toBundle?.().interludes ?? []).map((d) => d.id),
);
for (const id of interludeIds) {
  const opened = await page.evaluate((i) => {
    const ff = window.__fungiflush;
    const defs = ff.content?.registry?.toBundle?.().interludes ?? [];
    const def = defs.find((d) => d.id === i);
    if (!def) return false;
    // `pendingInterlude` es privado en TS pero un campo mas en JS.
    ff.engine.pendingInterlude = def;
    ff.engine.run.status = 'interlude';
    ff.bus.emit('interlude:enter', { interlude: def });
    return true;
  }, id);
  if (!opened) continue;
  await waitPanel('.panel.is-interlude', 5000);
  // La entrada anima las tarjetas (y:16 -> 0): se mide cuando terminan.
  await page.waitForTimeout(650);
  await visit(`interlude-${id.replace(/^interlude_/, '')}`);
  // Se resuelve por la SALIDA: no tiene efectos, asi que nunca falla por
  // dinero (un trato impago dejaria el panel abierto y el siguiente lo taparia).
  await page.evaluate(() => {
    document.querySelector('.panel.is-interlude .interlude-choice.is-decline .btn')?.click();
  });
  await page.waitForTimeout(250);
}

// ------------------------------------------------------------------ GAME OVER
await page.waitForFunction(() => window.__fungiflush?.engine?.run?.status === 'playing', { timeout: 10000 }).catch(() => {});
await page.waitForTimeout(600);
await page.evaluate(() => {
  const ff = window.__fungiflush;
  const r = ff.engine.round;
  if (!r) return;
  r.target = 999999999;
  for (let i = 0; i < 10 && ff.engine.run.status === 'playing'; i += 1) {
    ff.engine.clearSelection();
    for (const c of (ff.engine.round?.hand ?? []).slice(0, 5)) ff.engine.toggleSelect(c.uid);
    if ((ff.engine.round?.selected?.length ?? 0) === 0) break;
    ff.engine.playHand();
  }
});
await waitPanel('.panel.is-gameover', 15000);
await page.waitForTimeout(700);
if (await has('.panel.is-gameover')) await visit('gameover');

await browser.close();

// ---------------------------------------------------------------------------
// Veredicto
// ---------------------------------------------------------------------------
const failed = results.filter((r) => r.issues.length > 0);
console.log(`\nerrores de consola: ${errors.length ? errors.slice(0, 3) : 'ninguno'}`);
console.log(`pantallas auditadas: ${results.length} (viewport ${VIEWPORT.width}x${VIEWPORT.height})`);
if (failed.length > 0) {
  console.log(`\nXX ${failed.length} PANTALLA(S) SE VEN CORTADAS:`);
  for (const r of failed) console.log(`  - ${r.label} (${r.cls}): ${r.issues.join(' | ')}`);
} else {
  console.log('\nOK NINGUNA PANTALLA SE VE CORTADA');
}
process.exitCode = failed.length === 0 && errors.length === 0 ? 0 : 1;
