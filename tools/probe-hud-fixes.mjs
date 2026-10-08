/**
 * probe-hud-fixes.mjs — Tanda de fixes chicos del HUD movil.
 *
 *   1. La guia de seleccion YA NO muestra ni el texto de tutorial ni el
 *      contador "N seleccionadas" (lo explica el tutorial).
 *   2. La banda de accion SUBIO (--hud-bottom-h 90->104, fila 66->78, boton 48->54).
 *   3. La consecuencia lleva COLOR semantico y se APAGA sola tras puntuar
 *      (y al cerrar el ciego, via `hideConsequence`).
 *   4. La caja del HUD de simbiontes YA NO muestra la linea de habilidad; la
 *      etiqueta rica (habilidad/rareza/descripcion) la abre el long-press.
 *
 *   node tools/probe-hud-fixes.mjs
 */
import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const PW = 'C:/Users/emanu/.workbuddy-ai/binaries/node/workspace/node_modules/playwright-core/index.js';
const pw = await import(pathToFileURL(PW).href);
const chromium = pw.chromium ?? pw.default?.chromium;
const exe = 'C:/Users/emanu/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe';
if (!existsSync(exe)) { console.error('No hay Chromium.'); process.exit(1); }

const browser = await chromium.launch({
  executablePath: exe,
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--disable-dev-shm-usage'],
});
const context = await browser.newContext({
  viewport: { width: 915, height: 412 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
});
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));

await page.goto('http://127.0.0.1:1420/?daily=0', { waitUntil: 'load', timeout: 45000 });
await page.waitForFunction(() => Boolean(window.__fungiflush?.engine?.run), { timeout: 30000 });
await page.waitForTimeout(2200);
await page.evaluate(() => document.querySelector('[data-act="tutorial-close"]')?.click());
await page.waitForTimeout(300);
await page.evaluate(() => document.querySelector('.panel.is-menu [data-act="new"]')?.click());
await page.waitForTimeout(1200);
await page.evaluate(() => document.querySelector('.panel.is-archetypes [data-act="archetypes-start"]')?.click());
await page.waitForTimeout(1400);
await page.evaluate(() => document.querySelector('[data-act="tutorial-close"]')?.click());
await page.waitForTimeout(700);
await page.evaluate(() => {
  const ff = window.__fungiflush;
  ff.engine.chooseBlind(ff.engine.availableBlinds()[0]?.id);
});
await page.waitForFunction(() => (window.__fungiflush?.engine?.round?.hand?.length ?? 0) > 0, { timeout: 15000 });
await page.waitForTimeout(1400);

let failures = 0;
const check = (ok, label, detail = '') => {
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
};

// --- 2. Banda de accion mas alta -----------------------------------------
const band = await page.evaluate(() => {
  const root = getComputedStyle(document.documentElement);
  const bottom = document.querySelector('.hud-bottom');
  const row = document.querySelector('.hud-action-row');
  const play = document.querySelector('.hud-actions .btn.is-play');
  return {
    varBottom: root.getPropertyValue('--hud-bottom-h').trim(),
    bottomH: bottom ? Math.round(bottom.getBoundingClientRect().height) : 0,
    rowH: row ? Math.round(row.getBoundingClientRect().height) : 0,
    playH: play ? Math.round(play.getBoundingClientRect().height) : 0,
  };
});
console.log('\n=== BANDA DE ACCION ===');
console.log(JSON.stringify(band, null, 2));
check(band.varBottom === '104px', '2: --hud-bottom-h subio a 104px', band.varBottom);
// La banda crecio de ~76px a 88px (la fila paso de 66 a 78). Con la linea de
// consecuencia visible llega a ~104px, que es justo lo que declara la variable.
check(band.bottomH >= 84, '2: la banda crecio (88px vs ~76px antes)', `${band.bottomH}px`);
check(band.rowH >= 74, '2: la fila de accion mide >=74px', `${band.rowH}px`);
check(band.playH >= 52, '2: JUGAR MANO mide >=52px de alto', `${band.playH}px`);

// --- 1. Guia de seleccion sin textos redundantes -------------------------
// Seleccionar UNA carta: antes aparecia "1 seleccionada". Ahora nada.
await page.evaluate(() => {
  const ff = window.__fungiflush;
  const uid = ff.engine.round.hand[0]?.uid;
  if (uid) ff.engine.toggleSelect(uid);
});
await page.waitForTimeout(600);
const hint1 = await page.evaluate(() => {
  const el = document.querySelector('.hud-select-hint');
  return {
    exists: !!el,
    visible: !!el && el.classList.contains('is-visible'),
    text: el ? (el.textContent || '').trim() : '',
    hasCount: !!document.querySelector('.hud-select-hint-count'),
    hasTutorial: !!document.querySelector('.hud-select-hint-text'),
  };
});
console.log('\n=== GUIA DE SELECCION (1 carta) ===');
console.log(JSON.stringify(hint1, null, 2));
check(!hint1.visible, '1: con 1 carta elegida la guia NO se muestra');
check(!hint1.hasCount, '1: el contador "N seleccionadas" ya no existe en el DOM');
check(!/seleccionad/i.test(hint1.text), '1: ningun texto dice "seleccionada"', hint1.text.slice(0, 40));

// --- 4. Caja de simbiontes SIN linea de habilidad ------------------------
await page.evaluate(() => {
  const ff = window.__fungiflush;
  if (ff.engine.run.jokers.length === 0) {
    const id = ff.content.registry.poolOf('joker')[0]?.id;
    if (id) ff.engine.run.jokers.push(ff.engine.registry.instantiateJoker(id));
  }
  ff.hud.refreshPanel?.();
});
await page.waitForTimeout(900);
const jokerBox = await page.evaluate(() => {
  const chips = [...document.querySelectorAll('.hud-jokers .joker-chip')];
  return {
    chips: chips.length,
    abilityLines: document.querySelectorAll('.hud-jokers .joker-chip-ability').length,
    names: chips.map((c) => c.querySelector('.joker-chip-name')?.textContent ?? ''),
  };
});
console.log('\n=== CAJA DE SIMBIONTES ===');
console.log(JSON.stringify(jokerBox, null, 2));
check(jokerBox.chips > 0, '4: hay fichas de simbionte en la caja');
check(jokerBox.abilityLines === 0, '4: la caja YA NO muestra la linea de habilidad', `${jokerBox.abilityLines}`);

// La etiqueta rica la abre el long-press: mismos datos que `showJokerTooltip`.
const tip = await page.evaluate(() => {
  const ff = window.__fungiflush;
  const joker = ff.engine.run.jokers[0];
  if (!joker) return null;
  ff.hud.showJokerTooltip(joker, 300, 200);
  const el = document.querySelector('.hud-tooltip');
  return {
    visible: !!el && el.classList.contains('is-visible'),
    isJoker: !!el && el.classList.contains('is-joker'),
    text: el ? (el.textContent || '').trim() : '',
    hasAbility: !!el?.querySelector('.tooltip-joker-ability'),
  };
});
console.log('\n=== ETIQUETA RICA (long-press) ===');
console.log(JSON.stringify(tip, null, 2));
check(!!tip && tip.visible && tip.isJoker, '4: la etiqueta del simbionte abre con is-joker');
check(!!tip && tip.hasAbility, '4: la etiqueta trae la linea de habilidad');

// --- 3. Consecuencia: color + se apaga sola ------------------------------
await page.evaluate(() => {
  const ff = window.__fungiflush;
  // Elegir 2 cartas de familias DISTINTAS para que la guia siga oculta y no
  // interfiera con la lectura de la franja.
  const hand = ff.engine.round.hand;
  const byFamily = new Map();
  for (const c of hand) {
    if (!byFamily.has(c.def.family)) byFamily.set(c.def.family, c);
    if (byFamily.size >= 2) break;
  }
  for (const c of byFamily.values()) {
    if (!ff.engine.round.selected.includes(c.uid)) ff.engine.toggleSelect(c.uid);
  }
});
await page.waitForTimeout(500);
await page.evaluate(() => {
  const btn = document.querySelector('.hud-actions .btn.is-play');
  if (btn && !btn.disabled) btn.click();
});
// Esperar a que la consecuencia aparezca (dura el escalonado de la puntuacion).
await page.waitForFunction(
  () => document.querySelector('.hud-consequence')?.classList.contains('is-visible'),
  { timeout: 12000 },
).catch(() => {});
const cons = await page.evaluate(() => {
  const el = document.querySelector('.hud-consequence');
  const op = el?.querySelector('.hud-consequence-op');
  return {
    visible: !!el && el.classList.contains('is-visible'),
    hasOp: !!op,
    opColor: op ? getComputedStyle(op).color : '',
    text: el ? (el.textContent || '').trim() : '',
  };
});
console.log('\n=== CONSECUENCIA (al puntuar) ===');
console.log(JSON.stringify(cons, null, 2));
check(cons.visible, '3: la consecuencia se muestra al puntuar');
check(cons.hasOp, '3: la operacion va en su propio span (.hud-consequence-op)');
check(/^rgb/.test(cons.opColor) && cons.opColor !== 'rgb(0, 0, 0)', '3: la operacion lleva color semantico', cons.opColor);

// Auto-dismiss: el ultimo paso aguanta 2600 ms; se espera un poco mas.
await page.waitForTimeout(3400);
const gone = await page.evaluate(() => {
  const el = document.querySelector('.hud-consequence');
  return {
    visible: !!el && el.classList.contains('is-visible'),
    empty: el ? (el.textContent || '').trim() === '' : false,
  };
});
console.log('\n=== CONSECUENCIA (tras 3.4 s) ===');
console.log(JSON.stringify(gone, null, 2));
check(!gone.visible, '3: la consecuencia se apago sola tras puntuar');

// Cierre de ciego: `hideConsequence` la limpia (lo llama round:win / round:loss).
await page.evaluate(() => {
  const ff = window.__fungiflush;
  ff.hud.scoreTick?.({
    index: 0, text: '+1', color: 0x4fd18b, sourceKey: 'hud.jokers',
    isBonus: false, negative: false, x: 100, y: 100,
  });
});
await page.waitForTimeout(300);
const beforeEnd = await page.evaluate(() =>
  document.querySelector('.hud-consequence')?.classList.contains('is-visible'));
await page.evaluate(() => window.__fungiflush.hud.hideConsequence());
await page.waitForTimeout(200);
const afterEnd = await page.evaluate(() => {
  const el = document.querySelector('.hud-consequence');
  return { visible: !!el && el.classList.contains('is-visible'), empty: (el?.textContent || '').trim() === '' };
});
check(beforeEnd === true, '3: la consecuencia estaba visible antes del cierre');
check(!afterEnd.visible && afterEnd.empty, '3: hideConsequence() la limpia al terminar el ciego');

console.log('\n---');
console.log(`fallos: ${failures}`);
console.log('errores de pagina:', errors.length ? errors.slice(0, 5) : 'ninguno');
if (errors.length) failures += 1;
await browser.close();
process.exit(failures > 0 ? 1 : 0);
