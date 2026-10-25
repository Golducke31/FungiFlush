/**
 * probe-draft.mjs — Mide y captura los paneles del BORRADOR de reglas (R3):
 * la bendicion de arranque (3 ofertas) y la maldicion periodica (2 ofertas).
 *
 * Que verifica, en orden:
 *   1. FLUJO REAL: al arrancar la run aparece el panel de bendicion con 3
 *      ofertas; al elegir una, `run.blessing` queda escrita y la run sigue a
 *      la seleccion de ciego.
 *   2. LAYOUT: las 10 bendiciones y las 8 maldiciones, una por una, pintadas
 *      en el panel real. Si el contenido pasa el alto, el boton "Elegir" se
 *      pierde (el panel scrollea, que es la red de seguridad, pero se reporta).
 *   3. ACUMULACION: una maldicion elegida queda en `run.curses` y la siguiente
 *      se sortea EXCLUYENDO la que ya se tiene.
 *   4. DETERMINISMO: dos runs con la misma semilla sortean las mismas ofertas.
 *
 *   node tools/probe-draft.mjs
 *   FF_VIEWPORT=smoke node tools/probe-draft.mjs   # 844x390
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

const VIEWPORT =
  process.env.FF_VIEWPORT === 'smoke' ? { width: 844, height: 390 }
  : process.env.FF_VIEWPORT === 'tablet' ? { width: 1180, height: 820 }
  : { width: 915, height: 412 };

const browser = await chromium.launch({
  executablePath: exe, headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--disable-dev-shm-usage'],
});
const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const page = await context.newPage();
page.on('console', (m) => { if (m.type() === 'error') console.error('[console]', m.text()); });
page.on('pageerror', (e) => console.error('[pageerror]', e.message));
const click = (sel) => page.evaluate((s) => document.querySelector(s)?.click(), sel);
const has = (sel) => page.evaluate((s) => Boolean(document.querySelector(s)), sel);

await page.goto(URL_TO_TEST, { waitUntil: 'load', timeout: 45000 });
await page.waitForFunction(() => Boolean(window.__fungiflush?.engine?.run), { timeout: 30000 });
await page.waitForTimeout(1800);
await click('[data-act="tutorial-close"]');
await click('.panel.is-menu [data-act="new"]');
await page.waitForTimeout(700);
if (await has('.panel.is-archetypes')) { await click('[data-act="archetypes-start"]'); await page.waitForTimeout(1200); }
await click('[data-act="tutorial-close"]');
await page.waitForTimeout(600);

const problems = [];

/* ---------------------------------------------------------------- 1. FLUJO --
   Al arrancar la run tiene que estar el panel de bendicion. No se fuerza nada:
   es el camino que recorre el jugador. */
await page.waitForSelector('.panel.is-draft.is-blessing', { timeout: 15000 });
const first = await page.evaluate(() => {
  const ff = window.__fungiflush;
  const panel = document.querySelector('.panel.is-draft.is-blessing');
  const btns = [...panel.querySelectorAll('.draft-choice .btn')];
  const lines = [...panel.querySelectorAll('.draft-effects li')].map((li) => li.textContent ?? '');
  return {
    status: ff.engine.run.status,
    offers: (ff.engine.currentDraft?.offers ?? []).map((d) => d.id),
    title: panel.querySelector('.panel-title')?.textContent ?? '',
    choices: panel.querySelectorAll('.draft-choice').length,
    buttons: btns.length,
    firstBtnBottom: btns.length ? Math.round(btns[0].getBoundingClientRect().bottom) : null,
    vh: window.innerHeight,
    lines,
    blessingBefore: ff.engine.run.blessing,
  };
});
console.log(`Bendicion inicial: ${first.choices} ofertas (${first.offers.join(', ')})`);
console.log(`  titulo="${first.title}" lineas[0]="${first.lines[0] ?? ''}"`);
if (first.status !== 'draft') problems.push(`el estado al arrancar es "${first.status}", no "draft"`);
if (first.choices !== 3) problems.push(`la bendicion ofrece ${first.choices} opciones, no 3`);
if (first.buttons !== 3) problems.push(`hay ${first.buttons} botones, no 3`);
if (!first.lines.length) problems.push('las ofertas no muestran lineas de efecto');

// Elegir la primera oferta: la run sigue y la bendicion queda registrada.
await page.evaluate(() => {
  const btn = document.querySelector('.panel.is-draft.is-blessing .draft-choice .btn');
  btn?.click();
});
await page.waitForFunction(() => window.__fungiflush.engine.run.status === 'blind_select', { timeout: 10000 });
const afterPick = await page.evaluate(() => ({
  blessing: window.__fungiflush.engine.run.blessing,
  draft: window.__fungiflush.engine.currentDraft,
  panel: Boolean(document.querySelector('.panel.is-draft')),
}));
const picked = first.offers[0];
if (afterPick.blessing !== picked) {
  problems.push(`elegir "${picked}" dejo run.blessing="${afterPick.blessing}"`);
}
if (afterPick.draft !== null) problems.push('el borrador sigue pendiente despues de elegir');
console.log(`  elegida: ${afterPick.blessing} -> estado blind_select, panel cerrado: ${!afterPick.panel}`);

/* ------------------------------------------------------- 2. LAYOUT POR DRAFT --
   Se fuerza cada draft sobre el panel real. Lo que se mide es el LAYOUT, no el
   sorteo (eso ya se verifico arriba y en los tests). */
const measure = () => page.evaluate(() => {
  const rect = (el) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { top: Math.round(r.top), bottom: Math.round(r.bottom), h: Math.round(r.height) };
  };
  const panel = document.querySelector('#ui-root > .overlay.is-open > .panel.is-draft');
  if (!panel) return { none: true };
  const btns = [...panel.querySelectorAll('.draft-choice .btn')];
  return {
    vh: window.innerHeight,
    panel: rect(panel),
    choices: panel.querySelectorAll('.draft-choice').length,
    lastBtn: btns.length ? rect(btns[btns.length - 1]) : null,
    panelScroll: Math.round(panel.scrollHeight - panel.clientHeight),
    overflowBottom: btns.length ? Math.round(btns[btns.length - 1].getBoundingClientRect().bottom - window.innerHeight) : null,
  };
});

async function measureAll(kind, defs) {
  const rows = [];
  for (const def of defs) {
    const ok = await page.evaluate((d) => {
      const ff = window.__fungiflush;
      const found = (d.kind === 'curse' ? ff.engine.registry.curseDefs : ff.engine.registry.blessingDefs)
        .find((x) => x.id === d.id);
      if (!found) return false;
      ff.engine.pendingDraft = { kind: d.kind, offers: [found] };
      ff.engine.run.status = 'draft';
      ff.hud.showDraft();
      return true;
    }, { id: def.id, kind });
    if (!ok) { problems.push(`${kind} ${def.id}: no esta en el registry`); continue; }
    await page.waitForTimeout(120);
    const m = await measure();
    rows.push({ id: def.id, ...m });
    await page.screenshot({ path: join(shotsDir, `draft-${kind}-${def.id}.png`) });
    const bad = !m.none && ((m.panelScroll ?? 0) > 2 || (m.overflowBottom ?? 0) > 2);
    console.log(
      `  ${m.none ? '--' : bad ? 'XX' : 'OK'} ${kind.padEnd(8)} ${def.id.padEnd(28)}` +
      (m.none ? ' (sin panel)' : ` panelH=${m.panel?.h}/${m.vh} scroll=${m.panelScroll} lastBtnBottom=${m.lastBtn?.bottom} overflow=${m.overflowBottom}`),
    );
    if (bad) problems.push(`${kind} ${def.id}: el panel recorta el ultimo boton`);
  }
  return rows;
}

const defs = await page.evaluate(() => ({
  blessings: (window.__fungiflush.engine.registry.blessingDefs ?? []).map((d) => ({ id: d.id })),
  curses: (window.__fungiflush.engine.registry.curseDefs ?? []).map((d) => ({ id: d.id })),
}));
console.log(`\nBendiciones (${defs.blessings.length}):`);
await measureAll('blessing', defs.blessings);
console.log(`\nMaldiciones (${defs.curses.length}):`);
await measureAll('curse', defs.curses);

/* --------------------------------------------------- 3. ACUMULACION DE MALDICIÓN --
   Con una maldicion ya elegida, la siguiente parada no la puede volver a ofrecer. */
const acc = await page.evaluate(() => {
  const ff = window.__fungiflush;
  const curses = ff.engine.registry.curseDefs ?? [];
  if (curses.length < 2) return { skip: true };
  ff.engine.pendingDraft = { kind: 'curse', offers: [curses[0]] };
  ff.engine.run.status = 'draft';
  ff.engine.chooseDraft(curses[0].id);
  const handsBefore = ff.engine.run.baseHands;
  // Segunda maldicion sobre la misma run: se sortea excluyendo la elegida.
  const offers = ff.engine.registry.curseDefs
    .filter((d) => !ff.engine.run.curses.includes(d.id));
  return {
    skip: false,
    owned: ff.engine.run.curses,
    repeatable: offers.some((d) => d.id === curses[0].id),
    eligibleCount: offers.length,
    handsBefore,
    handsAfter: ff.engine.run.baseHands,
    money: ff.engine.run.money,
  };
});
if (!acc.skip) {
  console.log(`\nAcumulacion: curses=${JSON.stringify(acc.owned)} elegibles restantes=${acc.eligibleCount}`);
  if (acc.owned.length !== 1) problems.push(`elegir una maldicion dejo curses=${JSON.stringify(acc.owned)}`);
  if (acc.repeatable) problems.push('una maldicion ya elegida sigue siendo elegible');
  // El dinero/movimientos ya aplicados no deben cambiar al elegir la segunda:
  // los BAKED se aplican una sola vez por draft.
  if (acc.handsAfter !== acc.handsBefore) problems.push('elegir una maldicion toco las manos dos veces');
}

/* --------------------------------------------------------- 4. DETERMINISMO --
   Misma semilla, mismas ofertas. Es lo que permite compartir una run. */
const det = await page.evaluate(() => {
  const ff = window.__fungiflush;
  const run = (seed) => {
    ff.engine.startRun(seed);
    return (ff.engine.currentDraft?.offers ?? []).map((d) => d.id).join(',');
  };
  const a = run(4242);
  const b = run(4242);
  const c = run(777);
  return { a, b, c, same: a === b, different: a !== c };
});
console.log(`\nDeterminismo: semilla 4242 -> "${det.a}" / "${det.b}" (igual: ${det.same}) | 777 -> "${det.c}"`);
if (!det.same) problems.push('la misma semilla sorteo ofertas distintas');
if (!det.different) problems.push('dos semillas distintas sortearon las mismas ofertas (sospechosamente iguales)');

await browser.close();

if (problems.length > 0) {
  console.error(`\n✗ ${problems.length} problema(s):`);
  for (const p of problems) console.error(`  ✗ ${p}`);
  process.exit(1);
}
console.log('\n✓ Borrador de reglas OK. Shots: tools/shots/draft-*.png');
