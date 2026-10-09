/**
 * probe-hud-fixes-2.mjs — Tanda de fixes del HUD (2a parte).
 *
 * QUE VERIFICA
 * ------------
 *   F2. La etiqueta rica del Simbionte la abre la CARTA de la mesa (mantener
 *       pulsado el simbionte en su ranura), que es el UNICO camino: la columna
 *       de fichas `.joker-chip` del HUD se retiro (peleaba lugar con la pila de
 *       descarte). Se comprueba que el panel se abra desde la carta y que la
 *       columna ya no exista.
 *   F3. El desplegable de Misiones sale por el MISMO lado que su boton. El chip
 *       vive a la IZQUIERDA, asi que el cajon tiene que entrar desde la
 *       izquierda (plegado queda fuera de pantalla por ese lado).
 *   F4. En "Ciego superado" los dos desgloses entran SIN scroll vertical: van
 *       lado a lado aprovechando el landscape, y la linea del mazo cruza abajo.
 *
 *   node tools/probe-hud-fixes-2.mjs
 *   FF_VIEWPORT=smoke node tools/probe-hud-fixes-2.mjs
 *
 * REQUISITO: dev server YA en 127.0.0.1:1420 (el probe NO lo arranca).
 */

import { existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const URL_TO_TEST = process.env.FF_URL ?? 'http://127.0.0.1:1420/?daily=0';
const VIEWPORT =
  process.env.FF_VIEWPORT === 'smoke'
    ? { width: 844, height: 390 }
    : process.env.FF_VIEWPORT === 'tablet'
      ? { width: 1180, height: 820 }
      : { width: 915, height: 412 };

const PW = 'C:/Users/emanu/.workbuddy-ai/binaries/node/workspace/node_modules/playwright-core/index.js';
async function loadPlaywright() {
  try {
    return await import('playwright-core');
  } catch {
    if (existsSync(PW)) return await import(pathToFileURL(PW).href);
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
const context = await browser.newContext({
  viewport: VIEWPORT,
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
});
const page = await context.newPage();
const errors = [];
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

let failures = 0;
const check = (ok, label, detail = '') => {
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
};
const wait = (ms) => page.waitForTimeout(ms);
const has = (sel) => page.evaluate((s) => Boolean(document.querySelector(s)), sel);
const click = (sel) => page.evaluate((s) => document.querySelector(s)?.click(), sel);

/**
 * Espera a que el cajon de Misiones TERMINE su transicion (`transform 0.22s`) y
 * quede asentado en el lado pedido.
 *
 * Sin esto se mide a mitad de animacion y el `left` sale corrido unos px, que es
 * un falso positivo de "el cajon no entra": el estado final SI es `left: 0`.
 */
async function waitMissionsSettled(open) {
  await page
    .waitForFunction(
      (wantOpen) => {
        const p = document.querySelector('.hud-missions-panel');
        if (!p) return false;
        if (p.classList.contains('is-open') !== wantOpen) return false;
        const b = p.getBoundingClientRect();
        return wantOpen ? Math.abs(b.left) <= 1 : b.right <= 2;
      },
      open,
      { timeout: 6000 },
    )
    .catch(() => {});
}

// --- Llegar a la mesa ------------------------------------------------------
await page.goto(URL_TO_TEST, { waitUntil: 'load', timeout: 45000 });
await page.waitForFunction(() => Boolean(window.__fungiflush?.engine?.run), { timeout: 30000 });
await wait(1800);
await click('[data-act="tutorial-close"]');
await wait(300);
await click('.panel.is-menu [data-act="new"]');
await wait(900);
if (await has('.panel.is-archetypes')) {
  await click('[data-act="archetypes-start"]');
  await wait(1400);
}
await click('[data-act="tutorial-close"]');
await wait(400);
await page.evaluate(() => {
  const ff = window.__fungiflush;
  ff.engine.chooseBlind(ff.engine.availableBlinds()[0]?.id);
});
await page.waitForFunction(() => (window.__fungiflush?.engine?.round?.hand?.length ?? 0) > 0, { timeout: 15000 });
await wait(1200);

// ===========================================================================
// F3 — El cajon de Misiones sale por el lado de su boton
// ===========================================================================
console.log('\n=== F3 — desplegable de Misiones ===');
check(await has('.hud-missions-toggle.is-visible'), 'el chip de Misiones esta visible en partida');

const rectOf = `(el) => { if (!el) return null; const b = el.getBoundingClientRect(); return { left: Math.round(b.left), right: Math.round(b.right), top: Math.round(b.top), bottom: Math.round(b.bottom), w: Math.round(b.width) }; }`;

await waitMissionsSettled(false);
const missClosed = await page.evaluate(
  (src) => {
    const box = eval(src);
    return {
      toggle: box(document.querySelector('.hud-missions-toggle')),
      panel: box(document.querySelector('.hud-missions-panel')),
      open: document.querySelector('.hud-missions-panel')?.classList.contains('is-open') ?? null,
      vw: window.innerWidth,
    };
  },
  rectOf,
);
console.log('  plegado:', JSON.stringify(missClosed));

check(missClosed.toggle !== null, 'el chip tiene rect');
check(
  missClosed.toggle !== null && missClosed.toggle.left < missClosed.vw / 2,
  'F3 el chip vive a la IZQUIERDA',
  `left=${missClosed.toggle?.left}/${missClosed.vw}`,
);
check(missClosed.open === false, 'el cajon arranca plegado');
check(
  missClosed.panel !== null && missClosed.panel.right <= 2,
  'F3 plegado queda fuera de pantalla por la IZQUIERDA',
  `right=${missClosed.panel?.right} (esperado <= 2)`,
);

await click('[data-act="missions-toggle"]');
await waitMissionsSettled(true);
const missOpen = await page.evaluate(
  (src) => {
    const box = eval(src);
    const p = document.querySelector('.hud-missions-panel');
    return {
      toggle: box(document.querySelector('.hud-missions-toggle')),
      panel: box(p),
      open: p?.classList.contains('is-open') ?? null,
      vw: window.innerWidth,
    };
  },
  rectOf,
);
console.log('  abierto:', JSON.stringify(missOpen));
await page.screenshot({ path: join(shotsDir, 'probe-hud-fixes-2-misiones.png') });

check(missOpen.open === true, 'el cajon se abre');
check(missOpen.panel !== null && missOpen.panel.left <= 2, 'F3 abierto entra pegado al borde IZQUIERDO', `left=${missOpen.panel?.left}`);
check(
  missOpen.panel !== null && missOpen.panel.left < missOpen.vw / 2,
  'F3 el cajon NO sale por el lado derecho',
  `left=${missOpen.panel?.left} right=${missOpen.panel?.right} vw=${missOpen.vw}`,
);
check(
  missOpen.panel !== null && missOpen.toggle !== null && Math.abs(missOpen.panel.left - missOpen.toggle.left) <= 24,
  'F3 el cajon sale del MISMO lado que su chip',
  `panel.left=${missOpen.panel?.left} toggle.left=${missOpen.toggle?.left}`,
);
check(
  missOpen.panel !== null && missOpen.panel.right <= missOpen.vw,
  'el cajon abierto entra entero en pantalla',
  `right=${missOpen.panel?.right}/${missOpen.vw}`,
);

// Se vuelve a plegar para no tapar lo que sigue.
await click('[data-act="missions-toggle"]');
await waitMissionsSettled(false);

// ===========================================================================
// F2 — La etiqueta del Simbionte la abre la CARTA, no la ficha del HUD
// ===========================================================================
console.log('\n=== F2 — etiqueta rica del Simbionte ===');

const seeded = await page.evaluate(() => {
  const ff = window.__fungiflush;
  const defs = ff.engine.registry?.allJokers?.() ?? [];
  const withLabel = defs.find((j) => (j.effects ?? []).some((e) => e.labelKey));
  if (!withLabel) return null;
  const joker = ff.engine.registry.instantiateJoker(withLabel.id);
  ff.engine.run.jokers.push(joker);
  // `syncJokers` es publico justamente para los probes: crea la Card3D del
  // Simbionte y rearma los targets del raycaster.
  ff.scene.syncJokers(ff.engine.run.jokers, ff.engine.run.jokerSlots);
  ff.hud.refreshPanel?.();
  return { uid: joker.uid, id: withLabel.id };
});
check(Boolean(seeded), 'se sembro un Simbionte con etiqueta de efecto', JSON.stringify(seeded));

if (seeded) {
  await wait(600);

  // El Simbionte entra a su ranura con un TWEEN: hay que esperar a que su
  // posicion de mundo se asiente antes de proyectarla, o el punto medido queda
  // corrido y el `pointerdown` cae al lado de la carta.
  await page
    .waitForFunction(
      (uid) => {
        const c = window.__fungiflush.scene.jokerCards.get(uid);
        if (!c) return false;
        const p = c.group.position;
        const prev = window.__jokerSettle;
        window.__jokerSettle = { x: p.x, z: p.z };
        return Boolean(prev) && Math.abs(prev.x - p.x) < 1e-5 && Math.abs(prev.z - p.z) < 1e-5;
      },
      seeded.uid,
      { timeout: 8000 },
    )
    .catch(() => {});

  // Posicion en pantalla del Simbionte 3D (proyectando su posicion de mundo).
  const jokerPos = await page.evaluate((uid) => {
    const ff = window.__fungiflush;
    const card3d = ff.scene.jokerCards.get(uid);
    const canvas = document.querySelector('canvas');
    if (!card3d || !canvas) return null;
    const v = card3d.group.position.clone();
    v.project(ff.scene.rig.camera);
    const r = canvas.getBoundingClientRect();
    return {
      x: Math.round((v.x * 0.5 + 0.5) * r.width + r.left),
      y: Math.round((-v.y * 0.5 + 0.5) * r.height + r.top),
    };
  }, seeded.uid);
  check(Boolean(jokerPos), 'se pudo proyectar el Simbionte a coordenadas de pantalla', JSON.stringify(jokerPos));

  if (jokerPos) {
    // El punto tiene que caer sobre el canvas (si un panel del HUD lo tapara,
    // el `pointerdown` no llegaria al render y el long-press nunca dispararia).
    const hit = await page.evaluate(
      (p) => {
        const el = document.elementFromPoint(p.x, p.y);
        return el ? el.tagName : null;
      },
      jokerPos,
    );
    check(hit === 'CANVAS', 'el punto del Simbionte cae sobre el canvas', `elementFromPoint=${hit}`);

    // El raycaster tiene que devolver el Simbionte: es la prueba directa de que
    // esta entre los targets (antes NO lo estaba y el long-press no llegaba).
    await page.mouse.move(jokerPos.x, jokerPos.y);
    await wait(120);
    const picked = await page.evaluate(() => {
      const card3d = window.__fungiflush.scene.interaction.pick();
      return card3d ? { uid: card3d.uid, kind: card3d.kind, isJoker: Boolean(card3d.joker) } : null;
    });
    check(
      Boolean(picked) && picked.isJoker === true,
      'F2 el raycaster SÍ golpea el Simbionte de la mesa',
      JSON.stringify(picked),
    );

    // Long-press sobre la CARTA -> panel rico.
    await page.mouse.move(jokerPos.x, jokerPos.y);
    await page.mouse.down();
    await wait(700);
    const fromCard = await page.evaluate(() => {
      const el = document.querySelector('.hud-tooltip.is-visible');
      return el ? { isJoker: el.classList.contains('is-joker'), text: el.textContent.slice(0, 60) } : null;
    });
    // La captura va ANTES de soltar: el `pointerup` cierra el panel (un
    // long-press no selecciona ni deja nada abierto).
    await page.screenshot({ path: join(shotsDir, 'probe-hud-fixes-2-joker-carta.png') });
    await page.mouse.up();
    check(Boolean(fromCard), 'F2 el LONG-PRESS sobre la CARTA abre el panel del Simbionte', JSON.stringify(fromCard));
    check(Boolean(fromCard?.isJoker), 'F2 el panel lleva la marca `is-joker`');

    // La columna de fichas del HUD se RETIRO: peleaba lugar con la pila de
    // descarte (ambas a la izquierda) y se superponia con ella. La etiqueta de
    // la carta es ahora el unico camino.
    check(!(await has('.hud-jokers')), 'la columna de fichas del HUD ya NO existe');
    check(!(await has('.joker-chip')), 'las fichas `.joker-chip` ya NO existen');
    await page.evaluate(() => window.__fungiflush.hud.hideTooltip?.());
    await wait(250);
  }
}

// ===========================================================================
// F4 — "Ciego superado" sin scroll vertical
// ===========================================================================
console.log('\n=== F4 — Ciego superado sin scroll ===');
await page.evaluate(() => {
  const ff = window.__fungiflush;
  const r = ff.engine.round;
  if (r) r.target = 1;
  const uid = r?.hand?.[0]?.uid;
  if (uid) {
    ff.engine.toggleSelect(uid);
    ff.engine.playHand();
  }
});
await page
  .waitForFunction(() => Boolean(document.querySelector('.panel.is-cleared')), { timeout: 15000 })
  .catch(() => {});
await wait(700);

if (!(await has('.panel.is-cleared'))) {
  check(false, 'se llego al panel "Ciego superado"');
} else {
  const fit = await page.evaluate(() => {
    const panel = document.querySelector('.panel.is-cleared');
    const body = panel.querySelector('.cleared-body');
    const boxes = [...(body?.children ?? [])];
    const breakdowns = boxes.filter((el) => el.classList.contains('score-breakdown'));
    const deckLine = boxes.find((el) => el.classList.contains('deck-state-line'));
    const actions = panel.querySelector('.panel-actions');
    const r = (el) => {
      if (!el) return null;
      const b = el.getBoundingClientRect();
      return { left: Math.round(b.left), top: Math.round(b.top), right: Math.round(b.right), bottom: Math.round(b.bottom) };
    };
    return {
      vw: window.innerWidth,
      vh: window.innerHeight,
      bodyScroll: body ? Math.round(body.scrollHeight - body.clientHeight) : null,
      bodyScrollTop: body ? Math.round(body.scrollTop) : null,
      panelScroll: Math.round(panel.scrollHeight - panel.clientHeight),
      breakdowns: breakdowns.map(r),
      deckLine: r(deckLine),
      actions: r(actions),
      actionsVisible: actions ? actions.getBoundingClientRect().bottom <= window.innerHeight + 1 : null,
    };
  });
  console.log('  medidas:', JSON.stringify(fit));
  await page.screenshot({ path: join(shotsDir, 'probe-hud-fixes-2-ciego.png') });

  check(fit.bodyScroll === 0, 'F4 el cuerpo NO necesita scroll vertical', `bodyScroll=${fit.bodyScroll}`);
  check(fit.panelScroll === 0, 'F4 el panel NO scrollea', `panelScroll=${fit.panelScroll}`);
  check(fit.actionsVisible === true, 'el boton Continuar entra en pantalla');
  check(
    fit.breakdowns.length === 2,
    'se ven los 2 desgloses (puntaje + Fungis)',
    `encontrados=${fit.breakdowns.length}`,
  );

  if (fit.breakdowns.length === 2) {
    const [a, b] = fit.breakdowns;
    // El layout de DOS COLUMNAS es la solucion del CELULAR en horizontal: vive
    // en el bloque compacto (`pointer: coarse` + `max-height: 560px`). En una
    // pantalla ALTA (tablet 1180x820) el apilado de siempre ya entra sin
    // scroll, asi que ahi lo correcto es que siga apilado — ese layout no se
    // toca, y este check lo protege.
    if (fit.vh <= 560) {
      check(
        Math.abs(a.top - b.top) <= 3,
        'F4 los dos desgloses van LADO A LADO (misma altura)',
        `tops=${a.top},${b.top}`,
      );
      check(
        b.left >= a.right - 2,
        'F4 el segundo desglose arranca donde termina el primero (columnas)',
        `a.right=${a.right} b.left=${b.left}`,
      );
      check(
        b.right <= fit.vw,
        'F4 los desgloses entran en el ancho de la pantalla',
        `b.right=${b.right}/${fit.vw}`,
      );
    } else {
      check(
        b.top >= a.bottom - 2,
        'pantalla alta: los desgloses siguen APILADOS (layout de siempre intacto)',
        `a.bottom=${a.bottom} b.top=${b.top}`,
      );
    }
  }
}

console.log('\n---');
console.log(`viewport ${VIEWPORT.width}x${VIEWPORT.height} · fallos: ${failures}`);
console.log('errores de consola:', errors.length ? errors.slice(0, 5) : 'ninguno');
if (errors.length) failures += 1;

await context.close();
await browser.close();
process.exit(failures > 0 ? 1 : 0);
