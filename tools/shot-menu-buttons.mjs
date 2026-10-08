/**
 * shot-menu-buttons.mjs — Captura el MENU con los botones de gel nuevos.
 *
 * Saca: menu sin partida, menu CON partida guardada (Continuar visible) y el
 * desplegable abierto. Es una herramienta de PREVIEW, no un gate: no sale con
 * exit 1. Para verificar sigue estando `shot-mobile.mjs` + `smoke.mjs`.
 *
 *   node tools/shot-menu-buttons.mjs
 *   FF_VIEWPORT=smoke node tools/shot-menu-buttons.mjs   # 844x390
 *   FF_HEIGHT=360 node tools/shot-menu-buttons.mjs       # caso mas bajo
 *   FF_URL=... node tools/shot-menu-buttons.mjs
 *
 * `FF_VIEWPORT`/`FF_HEIGHT` existen para revisar la HOLGURA sobre el titulo en
 * mas de un tamano: el logo "FUNGI FLUSH" vive horneado en el JPG, asi que la
 * unica forma de saber si un boton lo pisa es medir en pantalla.
 */
import { existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const URL_TO_TEST = process.env.FF_URL ?? 'http://127.0.0.1:1420/?daily=0';
const OUT = join(ROOT, 'tools', 'shots');
mkdirSync(OUT, { recursive: true });

/** Viewports con nombre (mismos que `audit-mobile-buttons.mjs`). */
const VIEWPORTS = {
  ref: { width: 915, height: 412 },
  smoke: { width: 844, height: 390 },
};
const vpName = process.env.FF_VIEWPORT ?? 'ref';
const baseVp = VIEWPORTS[vpName] ?? VIEWPORTS.ref;
const forcedHeight = Number(process.env.FF_HEIGHT);
const viewport = forcedHeight > 0 ? { width: baseVp.width, height: forcedHeight } : baseVp;
/** Sufijo para no pisar los shots del viewport de referencia. */
const SUFFIX =
  vpName === 'ref' && !(forcedHeight > 0) ? '' : `-${vpName}${forcedHeight > 0 ? `-h${forcedHeight}` : ''}`;

const PW_CANDIDATES = [
  'C:/Users/emanu/.workbuddy-ai/binaries/node/workspace/node_modules/playwright-core/index.js',
];
async function loadPlaywright() {
  try {
    return await import('playwright-core');
  } catch {
    for (const c of PW_CANDIDATES) {
      if (existsSync(c)) return await import(pathToFileURL(c).href);
    }
    throw new Error('No se encontro playwright-core.');
  }
}
const pw = await loadPlaywright();
const chromium = pw.chromium ?? pw.default?.chromium;
const exe = [
  'C:/Users/emanu/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe',
  'C:/Users/emanu/AppData/Local/ms-playwright/chromium-1228/chrome-win64/chrome.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
].find((p) => existsSync(p));
if (!exe) { console.error('No hay Chromium.'); process.exit(1); }

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({
  executablePath: exe,
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--disable-gpu'],
});

const ctx = await browser.newContext({
  viewport,
  hasTouch: true,
  isMobile: true,
  deviceScaleFactor: 2,
});
const page = await ctx.newPage();

const report = {};
async function snap(name) {
  await page.screenshot({ path: join(OUT, `${name}${SUFFIX}.png`) });
  const state = await page.evaluate(() => {
    const q = (s) => document.querySelector(s);
    const cont = q('.panel.is-menu [data-act="continue"]');
    const hidden = (el) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return r.width === 0 && r.height === 0;
    };
    return {
      new: { present: Boolean(q('.panel.is-menu [data-act="new"]')) },
      continue: {
        present: Boolean(cont),
        disabled: cont?.disabled ?? null,
        isHiddenClass: cont?.classList.contains('is-hidden') ?? null,
        boxHidden: hidden(cont),
        label: cont?.textContent?.trim() ?? null,
      },
      profile: Boolean(q('.panel.is-menu [data-act="profile"]')),
      menuToggle: Boolean(q('.panel.is-menu [data-act="menu-toggle"]')),
      badge: q('.menu-icon-badge')?.textContent ?? null,
      geom: (() => {
        // Caja del boton Nueva partida vs. viewport. El titulo "FUNGI FLUSH"
        // vive en el ARTE de fondo (no es DOM) y ocupa la franja superior
        // central: se compara con `TITLE_BOTTOM` estimado.
        const btn = q('.panel.is-menu [data-act="new"]');
        const cont = q('.panel.is-menu [data-act="continue"]');
        const wrap = q('.panel.is-menu .menu-cta-wrap');
        const hero = q('.panel.is-menu .menu-hero');
        const top = q('.panel.is-menu .menu-top');
        const box = (el) => {
          if (!el) return null;
          const r = el.getBoundingClientRect();
          // Un boton oculto (`is-hidden`) mide 0x0 en (0,0): contarlo como CTA
          // "mas alto" arruinaria el peor caso. Se descarta.
          if (r.width === 0 && r.height === 0) return null;
          return {
            x: +r.x.toFixed(1),
            y: +r.y.toFixed(1),
            w: +r.width.toFixed(1),
            h: +r.height.toFixed(1),
          };
        };
        const cs = wrap ? getComputedStyle(wrap).fontSize : null;
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        // Replica EXACTA de `.menu-art` (cover por media queries) para saber
        // donde cae el titulo del JPG en pantalla. Medido sobre el arte, la
        // palabra mas baja ("FLUSH") acaba en el 47.7% de su alto.
        const ART_W = 1376;
        const ART_H = 768;
        const TITLE_BOTTOM_FRAC = 0.477;
        let artH;
        let artTop;
        if (vw / vh > ART_W / ART_H) {
          artH = (vw * ART_H) / ART_W;
          artTop = (vh - artH) / 2;
        } else {
          artH = vh;
          artTop = 0;
        }
        const titleBottom = artTop + artH * TITLE_BOTTOM_FRAC;
        const nb = box(btn);
        const clearance = nb ? +(nb.y - titleBottom).toFixed(1) : null;
        // El CTA MAS ALTO del heroe es el que puede pisar el titulo: con DOS
        // botones (`is-both`) hay que medir el minimo de los dos, no solo
        // "Nueva partida" (que va primero y es el mas bajo... o no).
        const cb = box(cont);
        const topmost = [nb, cb].filter(Boolean).reduce((a, b) => (b.y < a.y ? b : a));
        const clearanceBoth = topmost ? +(topmost.y - titleBottom).toFixed(1) : null;
        return {
          viewport: { vw, vh },
          wrapFontSize: cs,
          hero: box(hero),
          top: box(top),
          newBtn: nb,
          continueBtn: cb,
          titleBottomY: +titleBottom.toFixed(1),
          // > 0 = el boton arranca por DEBAJO del titulo (bien).
          titleClearance: clearance,
          topmostCtaY: topmost ? +topmost.y.toFixed(1) : null,
          // Peor caso real: el CTA VISIBLE mas alto contra el titulo.
          titleClearanceWorst: clearanceBoth,
          isBoth: Boolean(q('.panel.is-menu .menu-hero.is-both')),
          ctaCount: [nb, cb].filter(Boolean).length,
        };
      })(),
    };
  });
  report[name] = state;
  console.log(`\n[${name}]`, JSON.stringify(state, null, 2));
  // Guard: NINGUN CTA debe pisar el titulo del arte. Se evalua el peor caso
  // (el CTA mas alto), que con dos botones activos es el que se ve apretado.
  const worst = state.geom?.titleClearanceWorst;
  if (typeof worst === 'number') {
    const tag = worst >= 8 ? 'OK' : 'PISADO';
    const both = state.geom?.isBoth ? ' (2 CTAs)' : ' (1 CTA)';
    console.log(`  -> separacion titulo/CTA mas alto${both}: ${worst}px  [${tag}]`);
  }
}

// --- 1. Sin partida guardada ---
await page.goto(URL_TO_TEST, { waitUntil: 'load' });
await page.waitForSelector('.panel.is-menu', { timeout: 25000 });
await wait(1600);
await snap('menu-btns-nosave');

// --- 2. Con partida guardada: se arranca una run, se deja escribir el
//        autoguardado y se RECARGA (que es como el juego lee el guardado: al
//        arrancar). Sembrar a mano no sirve: el guardado de run tiene su
//        propio esquema y `setContinueAvailable` solo corre al iniciar. ---
// OJO: el boton FLOTA (animacion continua) ⇒ Playwright nunca lo ve "stable" y
// `locator.click()` se cuelga. Se clickea con `mouse.click` sobre el centro,
// igual que hace `smoke.mjs`.
async function mouseClick(selector) {
  const box = await page.locator(selector).first().boundingBox();
  if (!box) throw new Error(`Sin caja para ${selector}`);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}
await mouseClick('.panel.is-menu [data-act="new"]');
await page.waitForSelector('.panel.is-archetypes', { timeout: 15000 });
await wait(500);
await mouseClick('.panel.is-archetypes [data-act="archetypes-start"]');
await wait(2200);
const runPhase = await page.evaluate(() => window.__fungiflush?.engine?.run?.status ?? null);
// 1.5 s de debounce del autoguardado + margen de escritura.
await wait(3000);
const savedRaw = await page.evaluate(() => localStorage.getItem('fungiflush.run'));
console.log('\n[run status]', runPhase, '| guardado:', savedRaw ? `${savedRaw.length} bytes` : 'NINGUNO');

await page.reload({ waitUntil: 'load' });
await page.waitForSelector('.panel.is-menu', { timeout: 20000 });
await wait(1600);
await snap('menu-btns-save');

// --- 3. Desplegable abierto (mismo motivo: el boton late, no esta "stable") ---
await mouseClick('.panel.is-menu [data-act="menu-toggle"]');
await wait(500);
await page.screenshot({ path: join(OUT, `menu-btns-drop${SUFFIX}.png`) });
const drop = await page.evaluate(() => {
  const items = [...document.querySelectorAll('.menu-drop.is-open .menu-drop-item')];
  return { open: Boolean(document.querySelector('.menu-drop.is-open')), items: items.map((i) => i.dataset['act']) };
});
console.log('\n[menu-btns-drop]', JSON.stringify(drop));
report['menu-btns-drop'] = drop;

await browser.close();
console.log(`\nShots: tools/shots/menu-btns-*${SUFFIX}.png`);
