/**
 * probe-collection-grid.mjs — Frente 5: la Coleccion como GRILLA agrupada.
 *
 * QUE VERIFICA
 * ------------
 *   1. La Coleccion abre en GRILLA (no en el carrusel 3D): hay celdas
 *      `.collection-card.is-tile` y NO hay anillo (`scene.carousel === null`).
 *   2. Agrupa por PACK y por FAMILIA: existen cabeceras `.collection-section`
 *      con los dos niveles, y una seccion de Simbiontes.
 *   3. Cada celda lleva su CARA real (`img.collection-tile-img`), salvo las
 *      desconocidas/bloqueadas, que muestran silueta (cierra 4b en la grilla).
 *   4. Los filtros de TIPO y ESTADO reducen el conteo de celdas de verdad.
 *   5. Una seccion se puede COLAPSAR y sus celdas desaparecen.
 *   6. Tocar una celda abre el detalle; el detalle se cierra.
 *   7. No se cuela ninguna celda sin nombre ni sin badges esperados.
 *
 *   node tools/probe-collection-grid.mjs
 *   FF_VIEWPORT=smoke node tools/probe-collection-grid.mjs
 */
import { existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const URL_TO_TEST = process.env.FF_URL ?? 'http://127.0.0.1:1420/?daily=0';
const VIEWPORT =
  process.env.FF_VIEWPORT === 'smoke'
    ? { width: 844, height: 390 }
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
const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 2 });
const page = await context.newPage();
const errors = [];
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

const click = (sel) => page.evaluate((s) => document.querySelector(s)?.click(), sel);
const wait = (ms) => page.waitForTimeout(ms);

let failures = 0;
const check = (ok, label, detail = '') => {
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
};

const gridStats = () =>
  page.evaluate(() => {
    const panel = document.querySelector('.panel.is-grid-frame');
    const all = panel ? [...panel.querySelectorAll('.collection-card.is-tile')] : [];
    // COLAPSADO ≠ 0 CELDAS. Una seccion colapsada usa `display:none`, asi que
    // sus celdas SIGUEN en el DOM. El conteo que importa para el jugador es el
    // de las VISIBLES, y eso se mide con el rect, no con `querySelectorAll`.
    const visible = all.filter((c) => {
      const r = c.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    });
    const cells = visible;
    return {
      panelPresent: Boolean(panel),
      cells: cells.length,
      cellsTotal: all.length,
      withArt: cells.filter((c) => c.querySelector('img.collection-tile-img')).length,
      withName: cells.filter((c) => (c.querySelector('.collection-name')?.textContent ?? '').trim().length > 0).length,
      locked: cells.filter((c) => c.classList.contains('is-locked')).length,
      unknown: cells.filter((c) => c.classList.contains('is-unknown')).length,
      sections: panel ? panel.querySelectorAll('.collection-section').length : 0,
      families: panel ? [...panel.querySelectorAll('.collection-family')].map((f) => f.dataset.family) : [],
      sectionLabels: panel ? [...panel.querySelectorAll('.collection-section-label')].map((s) => s.textContent) : [],
      detailOpen: Boolean(panel?.querySelector('.collection-detail')),
    };
  });

const openCollection = async () => {
  await click('[data-act="tutorial-close"]');
  await wait(300);
  await click('[data-act="menu-toggle"]');
  await wait(400);
  await click('[data-act="collection"]');
  await wait(1400);
};

const closeCollection = async () => {
  await click('[data-act="close"]');
  await wait(900);
};

await page.goto(URL_TO_TEST, { waitUntil: 'load', timeout: 45000 });
await page.waitForFunction(() => Boolean(window.__fungiflush?.engine?.run), { timeout: 30000 });
await wait(1800);

// DESCUBRIR CONTENIDO PRIMERO. Un perfil virgen tiene las 107 entradas sin
// descubrir, y el probe necesita ver CARAS reales: se emite el mismo evento que
// emite el motor al crear una carta/un simbionte, y despues se REABRE la
// Coleccion (las entradas se arman al abrir, no al emitir).
await page.evaluate(() => {
  const ff = window.__fungiflush;
  for (const def of ff.engine.registry.allJokers()) {
    ff.bus.emit('joker:added', { joker: ff.engine.registry.instantiateJoker(def.id) });
  }
  // Un puñado de cartas base, para que la seccion de Especimenes tenga caras.
  const cards = ff.engine.registry.allCards();
  for (const def of cards.slice(0, 18)) {
    ff.bus.emit('card:created', { card: ff.engine.registry.instantiate(def.id) });
  }
});
await wait(400);
await openCollection();

// --- 1. Es una GRILLA, no el carrusel 3D ---
const base = await gridStats();
console.log('--- grilla base ---');
console.log(JSON.stringify({ ...base, sectionLabels: base.sectionLabels.slice(0, 8) }));
check(base.panelPresent, 'la Coleccion abre en el panel de GRILLA');
const carousel = await page.evaluate(() => Boolean(window.__fungiflush.scene.carousel));
check(!carousel, 'el anillo 3D NO esta montado en la vista de grilla');
check(base.cells > 20, 'la grilla dibuja las celdas de la coleccion', `${base.cells} celdas`);

// --- 2. Agrupacion por pack y familia ---
check(base.sections >= 2, 'hay cabeceras de seccion (pack + familia)', `${base.sections}`);
const hasJokerSection = base.sectionLabels.some((l) => /simbiont/i.test(l));
check(hasJokerSection, 'los Simbiontes tienen su propia seccion', JSON.stringify(base.sectionLabels.filter((l) => /simbiont/i.test(l))));

// --- 3. Caras reales ---
check(base.withArt > 0, 'hay celdas con la CARA real de la carta', `${base.withArt}`);
check(base.withArt + base.unknown + base.locked >= base.cells, 'toda celda tiene cara o silueta');
check(base.withName === base.cells, 'toda celda muestra un nombre o su candado', `${base.withName}/${base.cells}`);
await page.screenshot({ path: join(shotsDir, 'probe-collection-grid.png') });

// --- 4. Filtros de TIPO ---
await click('[data-act="filter-jokers"]');
await wait(500);
const jokers = await gridStats();
check(jokers.cells > 0 && jokers.cells < base.cells, 'el filtro SIMBIONTES reduce las celdas', `${base.cells} -> ${jokers.cells}`);
check(!jokers.families.includes('amanitaceae'), 'el filtro SIMBIONTES saca las familias de cartas');

await click('[data-act="filter-cards"]');
await wait(500);
const cards = await gridStats();
check(cards.cells > jokers.cells, 'el filtro ESPECIMENES trae de vuelta las cartas', `${jokers.cells} -> ${cards.cells}`);
check(!cards.sectionLabels.some((l) => /simbiont/i.test(l)), 'el filtro ESPECIMENES no deja secciones de Simbiontes');


await click('[data-act="filter-all"]');
await wait(500);

// --- 4b. Filtro de ESTADO ---
// Tras descubrir 18 cartas + los Simbiontes, DESCUBIERTOS tiene que dar un
// conteo > 0 y SIN DESCUBRIR el resto: los dos tienen que sumar el total.
await click('[data-act="filter-state-seen"]');
await wait(500);
const seenOnly = await gridStats();
check(seenOnly.cells > 0, 'DESCUBIERTOS deja las piezas que ya se vieron', `${seenOnly.cells}`);
check(seenOnly.cells < base.cells, 'DESCUBIERTOS es un subconjunto del total', `${seenOnly.cells}/${base.cells}`);
check(seenOnly.detailOpen === false, 'el detalle no se abre solo al filtrar');

await click('[data-act="filter-state-unseen"]');
await wait(500);
const unseenOnly = await gridStats();
check(
  unseenOnly.cells + seenOnly.cells === base.cells,
  'DESCUBIERTOS + SIN DESCUBRIR cubren el total',
  `${seenOnly.cells} + ${unseenOnly.cells} = ${base.cells}`,
);

await click('[data-act="filter-state-all"]');
await wait(500);
await click('[data-act="filter-all"]');
await wait(500);
// Reabrir TODAS las secciones antes de medir el total final.
await page.evaluate(() => {
  document.querySelectorAll('.panel.is-grid-frame .collection-section.is-collapsed').forEach((h) => h.click());
});
await wait(400);

// --- 5. Colapsar una seccion ---
const beforeCollapse = (await gridStats()).cells;
const collapsed = await page.evaluate(() => {
  const header = document.querySelector('.panel.is-grid-frame .collection-section');
  if (!header) return null;
  const key = header.dataset.section;
  header.click();
  const box = document.querySelector(
    key?.startsWith('pack:')
      ? `.collection-pack.is-collapsed`
      : `.collection-family.is-collapsed`,
  );
  return { key, collapsed: Boolean(box) };
});
await wait(300);
const afterCollapse = await gridStats();
check(collapsed?.collapsed === true, 'la cabecera colapsa su seccion', JSON.stringify(collapsed));
check(afterCollapse.cells < beforeCollapse, 'al colapsar, sus celdas desaparecen del conteo visible', `${beforeCollapse} -> ${afterCollapse.cells}`);
await page.evaluate(() => {
  document.querySelector('.panel.is-grid-frame .collection-section')?.click();
});
await wait(300);

// --- 6. Detalle ---
// El detalle se abre desde una celda VISIBLE con cara. Tras el colapso hay que
// reabrir la seccion (ya se hizo) y buscar la celda con el rect en pantalla.
const opened = await page.evaluate(() => {
  const cells = [...document.querySelectorAll('.panel.is-grid-frame .collection-card.is-tile')];
  const target = cells.find((c) => {
    if (!c.querySelector('img.collection-tile-img')) return false;
    const r = c.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  });
  target?.click();
  return Boolean(target);
});
await wait(400);
const withDetail = await gridStats();
check(opened && withDetail.detailOpen, 'tocar una celda con arte abre su detalle');
const detailText = await page.evaluate(
  () => document.querySelector('.collection-detail-body')?.textContent ?? '',
);
check(detailText.trim().length > 0, 'el detalle muestra nombre y meta', detailText.slice(0, 60));
await page.screenshot({ path: join(shotsDir, 'probe-collection-grid-detail.png') });
await click('[data-act="detail-close"]');
await wait(300);
const closed = await gridStats();
check(!closed.detailOpen, 'el detalle se cierra');

// --- 7. FRENTE 3: la ayuda de Sobres explica a donde van las cartas ---
const helpBtn = await page.evaluate(() => Boolean(document.querySelector('[data-act="packs-help"]')));
check(helpBtn, 'la Coleccion ofrece la ayuda de Sobres');
if (helpBtn) {
  await click('[data-act="packs-help"]');
  await wait(400);
  const helpText = await page.evaluate(
    () => document.querySelector('[data-act="packs-help-modal"]')?.textContent ?? '',
  );
  check(helpText.length > 40, 'la ayuda explica donde van las cartas de un sobre', helpText.slice(0, 70));
  // Tiene que decir las DOS cosas: Coleccion y mazo propio.
  check(/colecci/i.test(helpText), 'la ayuda menciona la Coleccion');
  check(/mazo/i.test(helpText), 'la ayuda menciona el mazo');
  await page.screenshot({ path: join(shotsDir, 'probe-collection-grid-help.png') });
  await click('[data-act="detail-close"]');
  await wait(300);
  const helpClosed = await page.evaluate(() => !document.querySelector('[data-act="packs-help-modal"]'));
  check(helpClosed, 'la ayuda se cierra');
}

console.log('---');
console.log(`viewport ${VIEWPORT.width}x${VIEWPORT.height} · fallos: ${failures}`);console.log('errores de consola:', errors.length ? errors.slice(0, 5) : 'ninguno');
if (errors.length) failures += 1;
await browser.close();
process.exit(failures > 0 ? 1 : 0);
