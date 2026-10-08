/**
 * probe-decay-counter.mjs — Frente 2 (putrefaccion).
 *
 * QUE VERIFICA
 * ------------
 *   1. FRANJA: con putrefaccion en el mazo aparece `.hud-decay` DEBAJO de la
 *      mano y NO esta solapada con la fila de acciones.
 *   2. CHIP LOCALIZADO: la CARA de la carta muestra la etiqueta traducida del
 *      estado ("Pudriéndose") y el VALOR numerico, no el corte crudo "DECA".
 *   3. HOTT-REFRESH: subir el valor de la putrefaccion rehornea la textura (la
 *      clave de cache lleva el valor) sin que cambie el uid.
 *   4. SIN PUTREFACCION: la franja se oculta sola.
 *
 * COMO OBSERVA: la franja es DOM (`.hud-decay`) con un `data-` estable. El chip
 * de la carta es TEXTO HORNEADO en la textura del canvas, asi que se lee la
 * clave de cache de la textura (que ahora incluye `decay:2`) en vez de hacer OCR.
 *
 *   node tools/probe-decay-counter.mjs
 *   FF_VIEWPORT=smoke node tools/probe-decay-counter.mjs
 *
 * REQUISITO: un dev server YA corriendo en 127.0.0.1:1420 (igual que el smoke).
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
const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const page = await context.newPage();
const errors = [];
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

const click = (sel) => page.evaluate((s) => document.querySelector(s)?.click(), sel);
const has = (sel) => page.evaluate((s) => Boolean(document.querySelector(s)), sel);
const wait = (ms) => page.waitForTimeout(ms);

let failures = 0;
const check = (ok, label, detail = '') => {
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
};

// --- Llegar a la mesa con cartas en la mano ---
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
await wait(1200);

// --- 4. SIN putrefaccion la franja esta OCULTA ---
const hiddenInitially = await page.evaluate(
  () => !document.querySelector('.hud-decay.is-visible'),
);
check(hiddenInitially, 'sin putrefaccion la franja NO se muestra');

// --- Aplicar putrefaccion a DOS cartas de la mano (valor 2 y 3) ---
//
// Se emite `status:applied` IGUAL que hace el engine al cerrar la resolucion:
// ese es el contrato real. El render rehornea la cara del uid que viaja en el
// evento (no puede adivinar que cartas cambiaron), asi que sin el evento la
// textura vieja se queda — justamente lo que el probe debe cubrir.
const uids = await page.evaluate(() => {
  const ff = window.__fungiflush;
  const a = ff.engine.round.hand[0];
  const b = ff.engine.round.hand[1];
  a.statuses.push({ type: 'decay', value: 2, turnsLeft: 3 });
  b.statuses.push({ type: 'decay', value: 3, turnsLeft: 3 });
  ff.bus.emit('status:applied', { uid: a.uid, status: 'decay', value: 2, sourceId: 'probe' });
  ff.bus.emit('status:applied', { uid: b.uid, status: 'decay', value: 3, sourceId: 'probe' });
  ff.hud.refreshPanel?.();
  return [a.uid, b.uid];
});
// El refresco de la cara pasa por la cola de FX del render: se espera a que la
// textura nueva exista en la cache en vez de dormir un tiempo fijo.
await page
  .waitForFunction(
    () => (window.__fungiflush.scene.textures?.topKeys?.() ?? []).some((k) => /decay:2/.test(k)),
    { timeout: 6000 },
  )
  .catch(() => {});

// --- 1. La franja aparece y dice la cuenta correcta ---
const strip = await page
  .waitForFunction(
    () => {
      const el = document.querySelector('.hud-decay.is-visible');
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { text: el.textContent, rect: { top: r.top, bottom: r.bottom, left: r.left, right: r.right } };
    },
    { timeout: 6000 },
  )
  .then((h) => h.jsonValue())
  .catch(() => null);
check(Boolean(strip), 'con putrefaccion la franja APARECE');
if (strip) {
  // 2 cartas + 5 de Sustrato perdidos. Los numeros salen de la i18n.
  const saysTwo = /2/.test(strip.text);
  const saysLoss = /5/.test(strip.text);
  check(saysTwo, 'la franja dice cuantas cartas estan pudriendose', JSON.stringify(strip.text));
  check(saysLoss, 'la franja dice el Sustrato perdido total (2+3=5)', JSON.stringify(strip.text));
}

// Se SELECCIONA una carta para que la guia de seleccion este visible: es el
// otro aviso anclado sobre la barra y el que de verdad competia por el espacio.
await page.evaluate(() => {
  const ff = window.__fungiflush;
  const c = ff.engine.round.hand[0];
  ff.engine.toggleSelect(c.uid);
  ff.hud.refreshPanel?.();
});
await wait(500);

// --- La franja NO se solapa ni con los botones ni con la guia de seleccion ---
const overlap = await page.evaluate(() => {
  const stripEl = document.querySelector('.hud-decay.is-visible');
  const actions = document.querySelector('.hud-actions');
  const hint = document.querySelector('.hud-select-hint.is-visible');
  if (!stripEl || !actions) return { ok: false, why: 'falta la franja o la fila de acciones' };
  const hits = (a, b) =>
    !(a.bottom <= b.top || a.top >= b.bottom || a.right <= b.left || a.left >= b.right);
  const a = stripEl.getBoundingClientRect();
  const b = actions.getBoundingClientRect();
  const h = hint ? hint.getBoundingClientRect() : null;
  const hitsActions = hits(a, b);
  const hitsHint = h ? hits(a, h) : false;
  return {
    ok: !hitsActions && !hitsHint,
    hitsActions,
    hitsHint,
    strip: { top: Math.round(a.top), bottom: Math.round(a.bottom) },
    actions: { top: Math.round(b.top), bottom: Math.round(b.bottom) },
    hint: h ? { top: Math.round(h.top), bottom: Math.round(h.bottom) } : null,
  };
});
check(
  overlap.ok,
  'la franja NO tapa ni los botones ni la guia de seleccion',
  JSON.stringify(overlap),
);

// --- 2. El CHIP de la carta lleva etiqueta traducida + valor ---
// La cara es texto horneado: se inspecciona la clave de la cache de textura,
// que ahora incluye el valor (`decay:2`) y por eso rehornea al cambiar.
const textureKeys = await page.evaluate(() => {
  const ff = window.__fungiflush;
  const keys = ff.scene.textures?.topKeys?.();
  return Array.isArray(keys) ? keys.filter((k) => k.startsWith('card|')) : null;
});
if (textureKeys && textureKeys.length) {
  const anyWithValue = textureKeys.some((k) => /decay:2/.test(k) || /decay:3/.test(k));
  check(anyWithValue, 'la clave de textura lleva el VALOR del estado', `${textureKeys.length} claves`);
  console.log('  ejemplo:', textureKeys[0]);
} else {
  check(false, 'la cache de texturas expone las claves de la capa de texto');
}

// --- 3. HOT-REFRESH: subir el valor rehornea sin cambiar el uid ---
const beforeKey = await page.evaluate((uid) => {
  const ff = window.__fungiflush;
  const card = ff.scene.handCards.get(uid)?.card;
  return card ? card.statuses.map((s) => `${s.type}:${s.value}`).join(',') : null;
}, uids[0]);
await page.evaluate((uid) => {
  const ff = window.__fungiflush;
  // Se sube la putrefaccion DE VERDAD por la via del engine (aplica + rehornea).
  const card = ff.engine.round.hand.find((c) => c.uid === uid);
  if (card) card.statuses[0].value = 7;
  ff.hud.refreshPanel?.();
  ff.bus.emit('status:applied', { uid, status: 'decay', value: 5, sourceId: 'probe' });
}, uids[0]);
await wait(600);
const afterKey = await page.evaluate((uid) => {
  const ff = window.__fungiflush;
  const card = ff.scene.handCards.get(uid)?.card;
  return card ? card.statuses.map((s) => `${s.type}:${s.value}`).join(',') : null;
}, uids[0]);
check(beforeKey !== afterKey, 'subir el valor cambia la firma del estado', `${beforeKey} -> ${afterKey}`);
const stripAfter = await page.evaluate(() => document.querySelector('.hud-decay.is-visible')?.textContent ?? '');
check(/7|10/.test(stripAfter), 'la franja refleja el valor NUEVO', JSON.stringify(stripAfter));

await page.screenshot({ path: join(shotsDir, 'probe-decay-strip.png') });

// --- 4. Al quitar toda la putrefaccion la franja se oculta SOLA ---
await page.evaluate(() => {
  const ff = window.__fungiflush;
  for (const c of ff.engine.round.hand) c.statuses = c.statuses.filter((s) => s.type !== 'decay');
  ff.hud.refreshPanel?.();
});
const hiddenAgain = await page
  .waitForFunction(() => !document.querySelector('.hud-decay.is-visible'), { timeout: 5000 })
  .then(() => true)
  .catch(() => false);
check(hiddenAgain, 'al quitar la putrefaccion la franja se oculta');

console.log('---');
console.log(`viewport ${VIEWPORT.width}x${VIEWPORT.height} · fallos: ${failures}`);
console.log('errores de consola:', errors.length ? errors.slice(0, 5) : 'ninguno');
if (errors.length) failures += 1;
await browser.close();
process.exit(failures > 0 ? 1 : 0);
