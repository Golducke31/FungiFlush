/**
 * shot-desktop.mjs — Captura y VERIFICA el ESCRITORIO (pointer: fine), pantalla por pantalla.
 *
 * Antes cubria SOLO `desk-blind` y `desk-playing` (6 checks del HUD). El rediseno
 * de escritorio (ver C:/Users/emanu/.workbuddy-ai/plans/swift-cascade-einstein-bVcAlc5-.md)
 * necesitaba una red de seguridad que cubriera TODAS las pantallas: sin ella,
 * cualquier cambio en la base de styles.css podia degradar el escritorio en
 * silencio (la convencion movil>escritorio congela el escritorio, ver
 * docs/CONVENCION_MOVIL_PRIMERO.md).
 *
 * Reusa el flujo de navegacion de `tools/audit-mobile-buttons.mjs`, pero con
 * `isMobile:false`/`hasTouch:false` (=> pointer: fine, escritorio).
 *
 * Que verifica (por pantalla):
 *   - CROMO SOLO-MOVIL oculto: `.hud-status`, `.hud-missions-toggle`.
 *   - Sin desborde de pagina: scrollHeight <= innerHeight.
 *   - Acciones dentro del viewport (no FUERA_ABAJO / FUERA_DER).
 *   - Contadores del HUD en UNA fila.
 *   - Barra superior/inferior dentro del viewport.
 *
 *   CODEBUDDY_SAFE_DELETE_ENABLED=0 node tools/shot-desktop.mjs
 *   -> exit 0 = todo bien · exit 1 = regresion de escritorio
 *
 * Requiere el dev server YA en http://127.0.0.1:1420 (FF_URL lo cambia).
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
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
  'C:/Users/emanu/AppData/Local/ms-playwright/chromium-1228/chrome-win64/chrome.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
].find((p) => existsSync(p));
if (!exe) { console.error('No hay Chromium.'); process.exit(1); }

const shotsDir = join(ROOT, 'tools', 'shots');
if (!existsSync(shotsDir)) mkdirSync(shotsDir, { recursive: true });

// ESCRITORIO: 1440x810, sin isMobile ni hasTouch => pointer: fine.
const VIEWPORT = { width: 1440, height: 810 };

const browser = await chromium.launch({
  executablePath: exe,
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--disable-dev-shm-usage'],
});
const context = await browser.newContext({ viewport: VIEWPORT });
const page = await context.newPage();
// Arquetipos: se siembra la puerta abierta (se desbloquean al superar el primer
// Ciego). Ver `tools/probe-archetype-gate.mjs` para el camino bloqueado.
await page.addInitScript(() => {
  localStorage.setItem(
    'fungiflush.profile',
    JSON.stringify({ version: 7, archetypesUnlocked: true }),
  );
});
const consoleErrors = [];
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));

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

const click = (sel) => page.evaluate((s) => document.querySelector(s)?.click(), sel);
const has = (sel) => page.evaluate((s) => Boolean(document.querySelector(s)), sel);
const waitPanel = (sel, timeout = 12000) =>
  page.waitForFunction((s) => Boolean(document.querySelector(s)), sel, { timeout }).catch(() => {});

/** Espera el destape de la mano (sin esto la captura sale con dorsos). */
const waitFlip = async () => {
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
};

/**
 * Probo una pantalla: mide desborde, acciones fuera y cromo solo-movil.
 * Devuelve las filas con problema. Funciona con panel abierto o con el HUD.
 */
async function probe() {
  return page.evaluate(() => {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const visible = (el) => {
      if (!el) return false;
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 0 && r.height > 0;
    };
    const overlay = document.querySelector('#ui-root > .overlay.is-open');
    const scope = overlay ? (overlay.querySelector(':scope > .panel') ?? overlay) : document.querySelector('#ui-root');

    // Acciones interactivas dentro del scope visible.
    const bad = [];
    const els = [...scope.querySelectorAll('button,[data-act],a[href],input,select,[role="button"]')].filter((el) => {
      if (el.closest('.overlay') !== overlay && overlay) return false;
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) < 0.05) return false;
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) return false;
      const tag = el.tagName;
      if (tag === 'BUTTON' || tag === 'A' || tag === 'INPUT' || tag === 'SELECT') return true;
      if (el.getAttribute('role') === 'button') return true;
      if (el.dataset?.['act']) return cs.cursor === 'pointer';
      return false;
    });
    for (const el of els) {
      const r = el.getBoundingClientRect();
      // Si vive en un scroller con contenido, estar fuera es esperado (lista).
      let inScroller = false;
      let walker = el.parentElement;
      while (walker && walker !== scope) {
        const cs = getComputedStyle(walker);
        if ((cs.overflowY === 'auto' || cs.overflowY === 'scroll') && walker.scrollHeight > walker.clientHeight + 2) {
          inScroller = true; break;
        }
        walker = walker.parentElement;
      }
      if (inScroller) continue;
      const label = el.dataset?.['act'] || (el.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 24) || el.tagName;
      const issues = [];
      if (r.bottom > vh + 1) issues.push(`FUERA_ABAJO+${Math.round(r.bottom - vh)}`);
      if (r.top < -1) issues.push(`FUERA_ARRIBA${Math.round(r.top)}`);
      if (r.right > vw + 1) issues.push(`FUERA_DER+${Math.round(r.right - vw)}`);
      if (r.left < -1) issues.push(`FUERA_IZQ${Math.round(r.left)}`);
      if (issues.length) bad.push({ label: String(label), issues, rect: `${Math.round(r.left)},${Math.round(r.top)} ${Math.round(r.width)}x${Math.round(r.height)}` });
    }

    const counters = [...document.querySelectorAll('.counter')].filter(visible);
    const tops = counters.map((c) => Math.round(c.getBoundingClientRect().top));
    const hudBottom = document.querySelector('.hud-bottom')?.getBoundingClientRect();
    const topBar = document.querySelector('.hud-top')?.getBoundingClientRect();
    const missionsPanel = document.querySelector('.hud-missions-panel');

    return {
      vw, vh,
      hasOverlay: Boolean(overlay),
      scope: String(scope.className || scope.id || 'hud').slice(0, 46),
      bad,
      // Aserciones de escritorio
      hudStatus: visible(document.querySelector('.hud-status')),
      missionsToggle: visible(document.querySelector('.hud-missions-toggle')),
      countersSingleRow: new Set(tops).size === 1,
      counterCount: counters.length,
      bodyOverflow: document.body.scrollHeight - vh,
      hudBottomOverflow: hudBottom ? Math.round(hudBottom.bottom - vh) : null,
      topBarOverflow: topBar ? Math.round(topBar.bottom - vh) : null,
      // El panel abierto NO debe scrollear de pagina (el scroll vive dentro).
      overlayOverflow: overlay ? overlay.scrollHeight - overlay.clientHeight : null,
      missionsPanelOpen: missionsPanel ? missionsPanel.classList.contains('is-open') : false,
      hudActionsOverflow: (() => {
        const a = document.querySelector('.hud-actions')?.getBoundingClientRect();
        return a ? Math.round(a.bottom - vh) : null;
      })(),
    };
  });
}

const checks = [];
const chk = (name, ok, detail) => { checks.push({ name, ok: Boolean(ok), detail }); return Boolean(ok); };

/**
 * Visita una pantalla: captura + aserciones. El HUD (cromo solo-movil,
 * contadores en 1 fila) se verifica SIEMPRE que no haya panel abierto.
 */
async function visit(label, name) {
  await page.waitForTimeout(350);
  const p = await probe();
  await page.screenshot({ path: join(shotsDir, `desk-${name}.png`) });

  const problems = [];
  if (p.bad.length) problems.push(...p.bad.map((b) => `${b.label}: ${b.issues.join(' ')}`));
  if (p.bodyOverflow > 1) problems.push(`body desborda +${p.bodyOverflow}px`);
  if (!p.hasOverlay) {
    if (p.hudStatus) problems.push('.hud-status visible en escritorio');
    if (p.missionsToggle) problems.push('.hud-missions-toggle visible en escritorio');
    if (p.counterCount > 0 && !p.countersSingleRow) problems.push('contadores en >1 fila');
    if (p.hudBottomOverflow != null && p.hudBottomOverflow > 0) problems.push(`hud-bottom +${p.hudBottomOverflow}px`);
    if (p.topBarOverflow != null && p.topBarOverflow > 0) problems.push(`hud-top +${p.topBarOverflow}px`);
    if (p.hudActionsOverflow != null && p.hudActionsOverflow > 0) problems.push(`hud-actions +${p.hudActionsOverflow}px`);
  }
  if (p.overlayOverflow != null && p.overlayOverflow > 1) problems.push(`overlay scroll +${p.overlayOverflow}px`);

  const ok = problems.length === 0;
  checks.push({ name: `pantalla: ${label}`, ok, detail: ok ? `${p.scope}` : problems.join(' | ') });
  console.log(`${ok ? 'OK  ' : 'XX  '} ${label.padEnd(20)} ${p.hasOverlay ? `panel=${p.scope}` : 'HUD'}${ok ? '' : `  -> ${problems.join(' | ')}`}`);
}

// ---------------------------------------------------------------- MENU
await click('[data-act="tutorial-close"]');
await visit('menu', 'menu');

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
  ['settings', 'settings', '[data-act="close"]', 'drop'],
  ['collection', 'collection', '[data-act="close"]', 'drop'],
  ['challenges', 'challenges', '[data-act="challenges-close"]', 'drop'],
  ['profile', 'profile', '[data-act="profile-close"]', 'menu'],
  ['history', 'history', '[data-act="history-close"]', 'profile'],
  ['achievements', 'achievements', '[data-act="achievements-close"]', 'profile'],
  ['guide', 'guide', '[data-act="tutorial-close"]', 'settings'],
  ['about', 'about', '[data-act="close"]', 'settings'],
  ['cosmetics', 'cosmetics', '[data-act="cosmetics-close"]', 'collection'],
  ['daily', 'daily', '[data-act="daily-close"]', 'challenges'],
  ['archetype', 'archetypes', '[data-act="archetypes-close"]', 'challenges'],
  ['ascension', 'ascension', '[data-act="ascension-close"]', 'challenges'],
  ['board', 'board', '[data-act="close"]', 'challenges'],
];
for (const [act, name, close, parent] of menuPanels) {
  await backToMenu();
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
  await visit(name, name);
  if (act === 'board' && (await has('.board-curtain.is-open'))) {
    await click('[data-act="ready"]');
    await page.waitForTimeout(600);
    await visit('board-jugando', 'board-playing');
  }
  if (await has(close)) await click(close);
  else await click('[data-act="close"]');
  await page.waitForTimeout(300);
}

// Sub-paneles de COLECCION (tienda de expansiones y pase).
await backToMenu();
await openMenuAction('collection');
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

// PANELES NUEVOS con gate pendiente (convencion §6): ranking y colonia.
await backToMenu();
await click('.panel.is-menu [data-act="profile"]');
await page.waitForTimeout(500);
for (const [act, name] of [['leaderboard', 'leaderboard'], ['colony-rewards', 'colony-rewards']]) {
  const sel = `.panel.is-profile [data-act="${act}"]`;
  if (!(await has(sel))) continue;
  await click(sel);
  await page.waitForTimeout(700);
  await visit(name, name);
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

// ---------------------------------------------------------------- RUN
await backToMenu();
await click('.panel.is-menu [data-act="new"]');
await page.waitForTimeout(600);
if (await has('.panel.is-archetypes')) {
  await visit('archetypes-run', 'archetypes-run');
  await click('[data-act="archetypes-start"]');
  await page.waitForTimeout(1300);
}
await click('[data-act="tutorial-close"]');
await visit('blind-select', 'blind');

// JEFE del ante 1 (blindIndex 2).
await page.evaluate(() => {
  const ff = window.__fungiflush;
  ff.engine.run.blindIndex = 2;
  ff.engine.enterBlindSelect();
  ff.hud.showBlindSelect();
});
await waitPanel('.panel.is-blind-select', 8000);
await visit('blind-select-JEFE', 'blind-boss');

// Detalle de la run.
if (await has('.panel.is-blind-select [data-act="blind-details"]')) {
  await click('.panel.is-blind-select [data-act="blind-details"]');
  await visit('blind-details', 'blind-details');
  await click('[data-act="close"]');
  await page.waitForTimeout(400);
}

// Jugar el ciego de JEFE.
await page.evaluate(() => {
  const ff = window.__fungiflush;
  ff.engine.chooseBlind(ff.engine.availableBlinds()[2]?.id);
});
await page.waitForFunction(() => (window.__fungiflush?.engine?.round?.hand?.length ?? 0) > 0, { timeout: 15000 });
await waitFlip();
await visit('playing-JEFE', 'playing-boss');
await visit('playing-sin-sel', 'playing');

// Con seleccion (boton Jugar Mano armado).
await page.evaluate(() => {
  const ff = window.__fungiflush;
  ff.engine.clearSelection();
  for (const c of (ff.engine.round?.hand ?? []).slice(0, 2)) ff.engine.toggleSelect(c.uid);
});
await page.waitForTimeout(600);
await visit('playing-con-sel', 'playing-armed');

// MENU INGAME (pausa).
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

// MAZO (carrusel 3D).
await page.evaluate(() => document.querySelector('.panel.is-shop [data-act="deck"]')?.click()
  ?? document.querySelector('.hud-top [data-act="deck"]')?.click());
await page.waitForTimeout(2400);
if (await has('.panel.is-deck')) {
  await visit('deck-carrusel', 'deck');
  await click('[data-act="close"]');
  await page.waitForTimeout(600);
}

// INTERLUDIO.
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

// GAME OVER.
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
console.log('\n=== GATE ESCRITORIO (todas las pantallas) ===');
const failed = checks.filter((c) => !c.ok);
for (const c of checks) console.log(`  ${c.ok ? 'PASA ' : 'FALLA'}  ${c.name}  (${c.detail})`);

// Persistir la geometria como baseline para el gate de paridad.
try {
  writeFileSync(
    join(ROOT, 'tools', 'desk-baseline.json'),
    JSON.stringify({ viewport: VIEWPORT, checks: checks.map((c) => ({ name: c.name, ok: c.ok })) }, null, 2),
  );
} catch { /* best effort */ }

if (failed.length > 0) {
  console.error(`\nX ESCRITORIO ROTO: ${failed.length} de ${checks.length} checks fallaron.`);
  console.error('  (el frente movil no debe degradar el escritorio; ver docs/CONVENCION_MOVIL_PRIMERO.md)');
  process.exit(1);
}
console.log(`\nOK ESCRITORIO VERDE (${checks.length}/${checks.length}). Shots: tools/shots/desk-*.png`);
