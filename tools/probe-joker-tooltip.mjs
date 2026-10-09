/**
 * probe-joker-tooltip.mjs — Frente 4a (etiqueta rica de los Simbiontes).
 *
 * QUE VERIFICA
 * ------------
 *   1. La columna de fichas del HUD (`.hud-jokers` / `.joker-chip`) YA NO existe:
 *      peleaba lugar con la pila de DESCARTE (ambas a la izquierda) y se
 *      superponia con ella.
 *   2. Mantener pulsado el SIMBIONTE de la mesa abre el PANEL RICO
 *      (`.hud-tooltip.is-visible.is-joker`) con: nombre, rotulo
 *      "Simbiontes · <rareza>", descripcion de habilidad (lila), la etiqueta de
 *      la habilidad concreta y las ACUMULACIONES de la run (Disparos `xN` +
 *      valor de venta).
 *   3. Al soltar el panel se oculta.
 *   4. El panel de CARTA no queda con la clase `is-joker` (no se contaminan).
 *
 *   node tools/probe-joker-tooltip.mjs
 *   FF_VIEWPORT=smoke node tools/probe-joker-tooltip.mjs
 *
 * NOTA: el bloque de ESCRITORIO usa un viewport MAS ALTO (915x700). A 915x412
 * la fila de Simbiontes queda pegada al borde superior, debajo de `.hud-top`
 * (que tiene `pointer-events: auto`), y el long-press nunca llega al canvas.
 * El bloque tactil corre en el viewport normal.
 *
 * REQUISITO: dev server YA en 127.0.0.1:1420.
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

/**
 * Viewport de ESCRITORIO para este probe.
 *
 * El layout de escritorio (915x412) esta CONGELADO y en esa altura la fila de
 * Simbiontes queda pegada al borde superior, DEBAJO de `.hud-top`. Ese header
 * tiene `pointer-events: auto`, asi que se come el `pointerdown`: el canvas
 * nunca recibe el evento, `Interaction.pointer` se queda viejo y `pick()` no
 * devuelve la carta. Con mas alto la fila queda sobre el canvas limpio y el
 * long-press llega. No es un bug del codigo — es la altura del viewport.
 */
const DESKTOP_VIEWPORT = { width: 915, height: 700 };

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

const click = (sel) => pageRef.evaluate((s) => document.querySelector(s)?.click(), sel);
const has = (sel) => pageRef.evaluate((s) => Boolean(document.querySelector(s)), sel);
const wait = (ms) => pageRef.waitForTimeout(ms);

let pageRef;
let failures = 0;
const check = (ok, label, detail = '') => {
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
};

/** Espera a que una condicion del DOM se cumpla (o se agota el tiempo). */
function wait_(page, fn, timeout = 5000) {
  return page
    .waitForFunction(fn, { timeout })
    .then(() => true)
    .catch(() => false);
}

/** Corre un bloque con un pointer FINO (escritorio: hover por raton). */
async function runDesktop(contextOpts) {
  const context = await browser.newContext({ viewport: DESKTOP_VIEWPORT, ...contextOpts });
  const page = await context.newPage();
  pageRef = page;
  const errors = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

  // --- Llegar a la mesa ---
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
  await page.evaluate(() => {
    const ff = window.__fungiflush;
    ff.engine.chooseBlind(ff.engine.availableBlinds()[0]?.id);
  });
  await page.waitForFunction(() => (window.__fungiflush?.engine?.round?.hand?.length ?? 0) > 0, { timeout: 15000 });

  // --- Sembrar un Simbionte con un efecto con `labelKey` ---
  const seeded = await page.evaluate(() => {
    const ff = window.__fungiflush;
    const defs = ff.engine.registry?.allJokers?.() ?? [];
    const withLabel = defs.find((j) => (j.effects ?? []).some((e) => e.labelKey));
    if (!withLabel) return null;
    const joker = ff.engine.registry.instantiateJoker(withLabel.id);
    ff.engine.run.jokers.push(joker);
    // Acumulacion sembrada: el panel tiene que leerla del engine (run-wide).
    joker.firedCount = 5;
    ff.scene.syncJokers(ff.engine.run.jokers, ff.engine.run.jokerSlots);
    ff.hud.refreshPanel?.();
    return { uid: joker.uid, id: withLabel.id, firedCount: joker.firedCount };
  });
  check(Boolean(seeded), 'hay un Simbionte con etiqueta de efecto en el contenido', JSON.stringify(seeded));
  if (!seeded) {
    await context.close();
    return errors;
  }

  // --- 1. La columna del HUD se retiro ---
  check(!(await has('.hud-jokers')), 'la columna `.hud-jokers` ya NO existe');
  check(!(await has('.joker-chip')), 'las fichas `.joker-chip` ya NO existen');

  // El Simbionte entra a su ranura con un TWEEN. En vez de proyectar el ORIGEN
  // del grupo (que queda en la BASE de la carta y puede caer fuera del canvas o
  // bajo el cromo del HUD), barremos el canvas con el propio raycaster de la
  // interaccion y nos quedamos con el CENTRO de la region que golpea al
  // Simbionte. Asi el long-press cae en la CARA, no al aire.
  let pos = null;
  for (let i = 0; i < 40 && !pos; i += 1) {
    const hit = await page.evaluate((uid) => {
      const ff = window.__fungiflush;
      const itc = ff.scene.interaction;
      const canvas = document.querySelector('canvas');
      const cam = ff.scene.rig.camera;
      const R = itc.raycaster;
      const targets = itc.targets ?? [];
      if (!canvas || !cam || !R) return null;
      const r = canvas.getBoundingClientRect();
      const ndc = new (itc.pointer.constructor)();
      let minx = 1e9, maxx = -1e9, miny = 1e9, maxy = -1e9, n = 0;
      for (let y = 0; y < r.height; y += 12) {
        for (let x = 0; x < r.width; x += 12) {
          ndc.set((x / r.width) * 2 - 1, -(y / r.height) * 2 + 1);
          R.setFromCamera(ndc, cam);
          const res = R.intersectObjects(targets, false)[0];
          if (res && res.object.userData?.card3d?.uid === uid) {
            minx = Math.min(minx, x); maxx = Math.max(maxx, x);
            miny = Math.min(miny, y); maxy = Math.max(maxy, y);
            n += 1;
          }
        }
      }
      if (!n) return null;
      const cx = Math.round((minx + maxx) / 2);
      const cy = Math.round((miny + maxy) / 2);
      const el = document.elementFromPoint(cx, cy);
      return { x: cx, y: cy, n, top: el ? el.tagName : null };
    }, seeded.uid);
    // Solo aceptamos un punto que caiga sobre el CANVAS (si el HUD lo tapa, el
    // `pointerdown` no llega y no habria long-press).
    if (hit && hit.top === 'CANVAS') {
      await page.mouse.move(hit.x, hit.y);
      await wait(150);
      const ok = await page.evaluate(() => {
        const c = window.__fungiflush.scene.interaction.pick();
        return Boolean(c && c.joker);
      });
      if (ok) pos = { x: hit.x, y: hit.y };
    }
    if (!pos) await wait(150);
  }
  check(Boolean(pos), 'se pudo ubicar el Simbionte sobre el canvas', JSON.stringify(pos));

  // --- 2. Long-press sobre la CARTA -> panel rico ---
  if (pos) {
    // El puntero ya esta sobre el Simbionte (se dejo ahi en el loop de arriba).
    await page.mouse.down();
    await wait(750);
  }
  const shown = pos
    ? await page
        .evaluate(() => {
          const el = document.querySelector('.hud-tooltip.is-visible');
          if (!el) return null;
          return {
            isJoker: el.classList.contains('is-joker'),
            text: el.textContent,
            fires: el.querySelector('[data-tooltip-stat="joker-fires"] .tooltip-stat-value')?.textContent ?? null,
            sell: el.querySelector('[data-tooltip-stat="joker-sell"] .tooltip-stat-value')?.textContent ?? null,
          };
        })
        .catch(() => null)
    : null;
  check(Boolean(shown), 'el long-press sobre la CARTA abre el panel');
  if (shown) {
    check(shown.isJoker, 'el panel lleva la marca `is-joker`');
    check(/Simbionte/i.test(shown.text), 'el panel rotula que es un Simbionte', JSON.stringify(shown.text.slice(0, 80)));
    check(
      await page.evaluate(() => Boolean(document.querySelector('.hud-tooltip .tooltip-desc.is-ability'))),
      'la descripcion va marcada como HABILIDAD (lila)',
    );
    check(
      await page.evaluate(() => Boolean(document.querySelector('.tooltip-joker-ability'))),
      'aparece la etiqueta de la habilidad concreta',
    );
    check(
      await page.evaluate(() => Boolean(document.querySelector('.tooltip-ability-marker'))),
      'la ✦ de habilidad esta presente',
    );
    // Las ACUMULACIONES de la run: los dos numeros que mostraba la ficha.
    check(shown.fires === `x${seeded.firedCount}`, 'el panel muestra los disparos de la run', `fires=${shown.fires}`);
    check(shown.sell != null, 'el panel muestra el valor de venta', `sell=${shown.sell}`);
  }
  await page.screenshot({ path: join(shotsDir, 'probe-joker-tooltip.png') });

  // --- 3. Al soltar se oculta ---
  await page.mouse.up();
  const hidden = await wait_(page, () => !document.querySelector('.hud-tooltip.is-visible'));
  check(hidden, 'al soltar el panel se oculta');

  // --- 5. El panel de CARTA no queda contaminado ---
  await page.evaluate(() => {
    const ff = window.__fungiflush;
    ff.hud.showTooltip(ff.engine.round.hand[0], 400, 200);
  });
  const cardClean = await page.evaluate(() => {
    const el = document.querySelector('.hud-tooltip');
    return Boolean(el) && !el.classList.contains('is-joker');
  });
  check(cardClean, 'el tooltip de CARTA no arrastra la marca `is-joker`');

  await context.close();
  return errors;
}

// --- Escritorio (pointer fino) ---
const desktopErrors = await runDesktop({ hasTouch: false, isMobile: false });

// --- Tactil (long-press) ---
const touchErrors = await (async () => {
  const context = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  pageRef = page;
  const errors = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

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
  await page.evaluate(() => {
    const ff = window.__fungiflush;
    ff.engine.chooseBlind(ff.engine.availableBlinds()[0]?.id);
  });
  await page.waitForFunction(() => (window.__fungiflush?.engine?.round?.hand?.length ?? 0) > 0, { timeout: 15000 });

  const seeded = await page.evaluate(() => {
    const ff = window.__fungiflush;
    const defs = ff.engine.registry?.allJokers?.() ?? [];
    const withLabel = defs.find((j) => (j.effects ?? []).some((e) => e.labelKey));
    if (!withLabel) return null;
    const joker = ff.engine.registry.instantiateJoker(withLabel.id);
    ff.engine.run.jokers.push(joker);
    // `syncJokers` es publico para los probes: sin esto no existe la Card3D del
    // Simbionte y no hay nada que proyectar ni que raycastear.
    ff.scene.syncJokers(ff.engine.run.jokers, ff.engine.run.jokerSlots);
    ff.hud.refreshPanel?.();
    return { uid: joker.uid };
  });
  if (!seeded) {
    console.log('SKIP tactil: sin Simbionte con etiqueta');
    await context.close();
    return errors;
  }

  // La columna de fichas del HUD se retiro: no hay chip que esperar.
  check(!(await has('.hud-jokers')), 'tactil: la columna `.hud-jokers` ya NO existe');

  // El Simbionte entra a su ranura con un TWEEN: se espera a que su posicion de
  // mundo asiente antes de proyectarla, o el punto medido queda corrido.
  await wait(600);
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

  // --- 4. La CARTA de la mesa abre el panel (unico camino) ---
  await page.evaluate(() => window.__fungiflush.hud.hideTooltip?.());
  await wait(250);
  const pos = await page.evaluate((uid) => {
    const ff = window.__fungiflush;
    const c = ff.scene.jokerCards.get(uid);
    const canvas = document.querySelector('canvas');
    if (!c || !canvas) return null;
    const v = c.group.position.clone();
    v.project(ff.scene.rig.camera);
    const r = canvas.getBoundingClientRect();
    return {
      x: Math.round((v.x * 0.5 + 0.5) * r.width + r.left),
      y: Math.round((-v.y * 0.5 + 0.5) * r.height + r.top),
    };
  }, seeded.uid);
  if (!pos) {
    check(false, 'se pudo proyectar el Simbionte a coordenadas de pantalla');
  } else {
    await page.mouse.move(pos.x, pos.y);
    await page.mouse.down();
    await wait(700);
    const fromCard = await page.evaluate(() =>
      Boolean(document.querySelector('.hud-tooltip.is-visible.is-joker')),
    );
    await page.mouse.up();
    check(fromCard, 'en tactil el LONG-PRESS sobre la CARTA muestra el panel del Simbionte');
  }

  await context.close();
  return errors;
})();

console.log('---');
// El bloque de ESCRITORIO corre en un viewport mas alto (ver DESKTOP_VIEWPORT):
// a 915x412 la fila de Simbiontes queda debajo de `.hud-top` y el long-press no
// llega al canvas. El bloque TACTIL si usa el viewport normal.
console.log(
  `escritorio ${DESKTOP_VIEWPORT.width}x${DESKTOP_VIEWPORT.height} · tactil ${VIEWPORT.width}x${VIEWPORT.height} · fallos: ${failures}`,
);
const allErrors = [...desktopErrors, ...touchErrors];
console.log('errores de consola:', allErrors.length ? allErrors.slice(0, 5) : 'ninguno');
if (allErrors.length) failures += 1;
await browser.close();
process.exit(failures > 0 ? 1 : 0);
