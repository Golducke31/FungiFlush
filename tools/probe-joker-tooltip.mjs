/**
 * probe-joker-tooltip.mjs — Frente 4a (etiqueta rica de los Simbiontes).
 *
 * QUE VERIFICA
 * ------------
 *   1. La ficha del Simbionte YA NO tiene `title` nativo (era el rectangulito
 *      gris, que en movil no aparece nunca).
 *   2. Al pasar el raton por la ficha aparece el PANEL RICO (`.hud-tooltip.
 *      is-visible.is-joker`) con: nombre, rotulo "Simbiontes · <rareza>",
 *      descripcion de habilidad (lila) y la etiqueta de la habilidad concreta.
 *   3. Al salir el panel se oculta.
 *   4. En TACTIL el long-press (>420ms con el dedo quieto) tambien lo muestra.
 *   5. El panel de CARTA no queda con la clase `is-joker` (no se contaminan).
 *
 *   node tools/probe-joker-tooltip.mjs
 *   FF_VIEWPORT=smoke node tools/probe-joker-tooltip.mjs
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
  const context = await browser.newContext({ viewport: VIEWPORT, ...contextOpts });
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
    const ffReg = ff.content ?? ff.engine.registry;
    // Se busca en el contenido un joker con etiqueta de efecto para que el
    // tooltip tenga la linea de HABILIDAD que se quiere verificar.
    const defs = ff.engine.registry?.allJokers?.() ?? [];
    const withLabel = defs.find((j) => (j.effects ?? []).some((e) => e.labelKey));
    if (!withLabel) return null;
    const joker = ff.engine.registry.instantiateJoker(withLabel.id);
    ff.engine.run.jokers.push(joker);
    ff.hud.refreshPanel?.();
    return { uid: joker.uid, id: withLabel.id };
  });
  check(Boolean(seeded), 'hay un Simbionte con etiqueta de efecto en el contenido', JSON.stringify(seeded));
  if (!seeded) {
    await context.close();
    return errors;
  }

  const chipSel = `.joker-chip[data-uid="${seeded.uid}"]`;
  await page.waitForFunction((s) => Boolean(document.querySelector(s)), chipSel, { timeout: 5000 });

  // --- 1. Sin `title` nativo ---
  const nativeTitle = await page.evaluate((s) => {
    const el = document.querySelector(s);
    return el ? el.getAttribute('title') : '__missing__';
  }, chipSel);
  check(nativeTitle === null, 'la ficha NO tiene `title` nativo', `title=${JSON.stringify(nativeTitle)}`);

  // --- 2. Hover de raton -> panel rico ---
  const box = await page.locator(chipSel).boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  const shown = await page
    .waitForFunction(
      () => {
        const el = document.querySelector('.hud-tooltip.is-visible');
        return el ? { isJoker: el.classList.contains('is-joker'), text: el.textContent } : null;
      },
      { timeout: 5000 },
    )
    .then((h) => h.jsonValue())
    .catch(() => null);
  check(Boolean(shown), 'al pasar el raton aparece el panel');
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
  }
  await page.screenshot({ path: join(shotsDir, 'probe-joker-tooltip.png') });

  // --- 3. Al salir se oculta ---
  await page.mouse.move(4, 4);
  const hidden = await wait_(page, () => !document.querySelector('.hud-tooltip.is-visible'));
  check(hidden, 'al salir el panel se oculta');

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
    ff.hud.refreshPanel?.();
    return { uid: joker.uid };
  });
  if (!seeded) {
    console.log('SKIP tactil: sin Simbionte con etiqueta');
    await context.close();
    return errors;
  }
  const chipSel = `.joker-chip[data-uid="${seeded.uid}"]`;
  await page.waitForFunction((s) => Boolean(document.querySelector(s)), chipSel, { timeout: 5000 });
  const box = await page.locator(chipSel).boundingBox();
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  // pointerdown + esperar (el long-press dispara a los 420ms)
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await wait(650);
  const visible = await page.evaluate(() => Boolean(document.querySelector('.hud-tooltip.is-visible.is-joker')));
  await page.mouse.up();
  check(visible, 'en tactil el LONG-PRESS muestra el panel del Simbionte');

  await context.close();
  return errors;
})();

console.log('---');
console.log(`viewport ${VIEWPORT.width}x${VIEWPORT.height} · fallos: ${failures}`);
const allErrors = [...desktopErrors, ...touchErrors];
console.log('errores de consola:', allErrors.length ? allErrors.slice(0, 5) : 'ninguno');
if (allErrors.length) failures += 1;
await browser.close();
process.exit(failures > 0 ? 1 : 0);
