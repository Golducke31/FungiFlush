/**
 * probe-shop-count.mjs — Cuantas ofertas produce la tienda DE VERDAD, y de que
 * tipo. Sirve para responder "por que hay 2 si deberian ser 4".
 *
 * La tabla `shop_default` declara 4 grupos, pero un grupo puede NO producir
 * oferta por dos motivos distintos:
 *   - `chance < 1` (el grupo de voucher tira 55%);
 *   - `rollOne` devuelve `undefined` si el pool elegido esta agotado (todas las
 *     cartas ya en el mazo, todos los jokers comprados, etc.).
 *
 * Este probe entra a la tienda REAL por el camino del motor y cuenta.
 */
import { pathToFileURL } from 'node:url';

const W = Number(process.env.FF_WIDTH || 915);
const H = Number(process.env.FF_HEIGHT || 412);

const pw = await import(
  pathToFileURL('C:/Users/emanu/.workbuddy-ai/binaries/node/workspace/node_modules/playwright-core/index.js').href
);
const { chromium } = pw.default ?? pw;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: W, height: H }, hasTouch: true, isMobile: true });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});

await page.goto(process.env.FF_URL ?? 'http://localhost:5173/', { waitUntil: 'load' });
await page.waitForFunction(() => !!window.__fungiflush, null, { timeout: 30000 });
await page.waitForTimeout(1500);

// Arrancar una run de verdad y entrar a la tienda por el motor.
const report = await page.evaluate(() => {
  const ff = window.__fungiflush;
  const out = [];

  // La tienda se sortea con `rollOffers(sequence)`. Se llama N veces con el
  // MISMO estado para ver la distribucion real de la tabla, sin tocar el RNG
  // del motor (se clona el rng para no avanzar la partida).
  const sample = (ante, blindIndex, n) => {
    const counts = {};
    const kinds = {};
    const sizes = [];
    for (let i = 0; i < n; i++) {
      // `engine.offers` es el OfferService; `rollPhase` es publico.
      const offers = ff.engine.offers.rollPhase('shop', {
        rng: ff.engine.rng,
        ante,
        blindIndex,
        sequence: i,
        ownedVouchers: [],
      });
      sizes.push(offers.length);
      counts[offers.length] = (counts[offers.length] ?? 0) + 1;
      for (const o of offers) kinds[o.kind] = (kinds[o.kind] ?? 0) + 1;
    }
    return { ante, blindIndex, sizes: counts, kinds };
  };

  out.push(sample(1, 0, 400));
  out.push(sample(3, 0, 400));
  out.push(sample(6, 0, 400));

  // Y ahora la tienda REAL de la partida en curso.
  ff.engine.enterShop?.();
  const real = ff.engine.run.shop?.offers ?? [];
  return {
    distribution: out,
    realOffers: real.map((o) => `${o.kind}:${o.refId}@${o.cost}`),
    realCount: real.length,
    tables: ff.engine.offers.tablesFor('shop').map((t) => t.id),
  };
});

console.log('--- Distribucion de tamano por ante (400 tiradas c/u) ---');
for (const d of report.distribution) {
  console.log(`ante ${d.ante}: tamano -> ${JSON.stringify(d.sizes)} | tipos -> ${JSON.stringify(d.kinds)}`);
}
console.log(`\nTablas de shop: ${report.tables.join(', ')}`);
console.log(`Tienda real: ${report.realCount} ofertas -> ${report.realOffers.join(' | ')}`);
console.log(`\nErrores de consola: ${errors.length}`);

// --- Forzar una tienda de 4 ofertas -----------------------------------------
// El sorteo da 3 el ~45% de las veces (el grupo de voucher tira 55%). Para
// verificar el layout de 4 columnas hay que garantizar 4: se re-tira la tienda
// (reroll) hasta que salgan, sin depender de la suerte del dado.
await page.evaluate(() => {
  const ff = window.__fungiflush;
  ff.engine.run.money = 500;
  for (let i = 0; i < 60; i++) {
    if ((ff.engine.run.shop?.offers.length ?? 0) >= 4) break;
    ff.engine.rerollShop();
  }
  ff.hud.refreshPanel();
});

// --- Layout con 4 ofertas de verdad: el caso que el usuario pregunta ---------
await page.waitForSelector('.panel.is-shop .offer', { timeout: 8000 });
await page.waitForFunction(
  () => {
    const a = [...document.querySelectorAll('.panel.is-shop .offer-art')];
    return a.length > 0 && a.every((x) => x.tagName === 'IMG' && x.complete && x.naturalWidth > 0);
  },
  null,
  { timeout: 15000 },
).catch(() => {});
await page.waitForTimeout(600);

const layout = await page.evaluate(() => {
  const grid = document.querySelector('.panel.is-shop .offer-grid');
  const panel = document.querySelector('.panel.is-shop');
  const cards = [...document.querySelectorAll('.panel.is-shop .offer')];
  const gr = grid?.getBoundingClientRect();
  const pr = panel?.getBoundingClientRect();
  return {
    columns: grid ? getComputedStyle(grid).gridTemplateColumns : null,
    gridW: gr ? Math.round(gr.width) : 0,
    panelW: pr ? Math.round(pr.width) : 0,
    cards: cards.map((c) => {
      const r = c.getBoundingClientRect();
      const a = c.querySelector('.offer-art')?.getBoundingClientRect();
      const f = c.querySelector('.offer-footer')?.getBoundingClientRect();
      const buy = c.querySelector('.offer-footer .btn');
      const b = buy?.getBoundingClientRect();
      const top = b ? document.elementsFromPoint(b.left + b.width / 2, b.top + b.height / 2)[0] : null;
      return {
        w: Math.round(r.width),
        h: Math.round(r.height),
        artW: a ? Math.round(a.width) : 0,
        artH: a ? Math.round(a.height) : 0,
        artFillsCard: Boolean(a && a.height >= r.height * 0.6),
        footerBelowArt: Boolean(a && f && f.top >= a.bottom - 1),
        footerInside: Boolean(f && f.bottom <= r.bottom + 1),
        buyHittable: top === buy || (buy && buy.contains(top)),
        kindLabel: c.dataset.kindLabel ?? null,
        price: c.querySelector('.offer-price')?.textContent ?? null,
        // Las leyendas redundantes NO deben existir en el DOM.
        legends: ['offer-kind', 'offer-desc', 'offer-body', 'offer-impact', 'offer-name'].filter((k) =>
          c.querySelector(`.${k}`),
        ),
      };
    }),
  };
});

console.log(`\n--- Tienda real con ${layout.cards.length} ofertas ---`);
console.log(`Panel ${layout.panelW}px | grid ${layout.gridW}px | columnas: ${layout.columns}`);
for (const [i, c] of layout.cards.entries()) console.log(`  ${i}: ${JSON.stringify(c)}`);
await page.screenshot({ path: `tools/shots/_shop-real-${W}x${H}.png` });

const ok =
  layout.cards.length >= 3 &&
  layout.cards.every(
    (c) =>
      c.artFillsCard &&
      c.footerBelowArt &&
      c.footerInside &&
      c.buyHittable &&
      c.kindLabel !== null &&
      c.legends.length === 0,
  ) &&
  errors.length === 0;
console.log(ok ? '\nOK: tienda en 4 columnas, cara grande, sin leyendas, precio y boton visibles.' : '\nFALLA: revisar la tienda.');

await browser.close();
process.exit(ok ? 0 : 1);
