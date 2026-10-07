/**
 * probe-shop-sell.mjs — Verifica que la pestana VENDER use el mismo layout nuevo
 * (cara grande a la izquierda, ficha a la derecha, sin nombre visible).
 *
 * Se comparte el CSS entre Comprar y Vender, asi que un cambio de estructura en
 * una puede dejar la otra sin sus reglas. Este probe comprueba la OTRA mitad.
 */
import { pathToFileURL } from 'node:url';

const W = Number(process.env.FF_WIDTH || 915);
const H = Number(process.env.FF_HEIGHT || 412);

const pw = await import(
  pathToFileURL('C:/Users/emanu/.workbuddy-ai/binaries/node/workspace/node_modules/playwright-core/index.js').href
);
const { chromium } = pw.default ?? pw;

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: W, height: H },
  deviceScaleFactor: 1,
  hasTouch: true,
  isMobile: true,
});
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});

await page.goto(process.env.FF_URL ?? 'http://localhost:5173/', { waitUntil: 'load' });
await page.waitForFunction(() => !!window.__fungiflush, null, { timeout: 30000 });
await page.waitForTimeout(1500);

await page.evaluate(() => {
  const ff = window.__fungiflush;
  ff.engine.run.money = 200;
  ff.engine.run.status = 'shop';
  if (!ff.engine.run.shop) ff.engine.run.shop = { offers: [], rerolls: 0 };
  ff.engine.run.shop.offers = [];
  // La pestana Vender lista los Simbiontes que el jugador LLEVA: sin al menos
  // uno la lista queda vacia y el probe mediria la nada.
  if (ff.engine.run.jokers.length === 0) {
    const ids = ff.content.registry.poolOf('joker').map((j) => j.id);
    for (const id of ids.slice(0, 3)) ff.engine.run.jokers.push(ff.engine.registry.instantiateJoker(id));
  }
  ff.hud.refreshPanel();
});
await page.waitForSelector('.panel.is-shop', { timeout: 8000 });
// Cambiar a la pestana Vender.
await page.evaluate(() => {
  const tab = [...document.querySelectorAll('.panel.is-shop .shop-tab')].find(
    (b) => b.getAttribute('aria-selected') !== 'true' && /vend/i.test(b.textContent ?? ''),
  );
  tab?.click();
});
await page.waitForTimeout(700);

const info = await page.evaluate(() => {
  const cards = [...document.querySelectorAll('.panel.is-shop .offer.is-sell-card')];
  const first = cards[0];
  if (!first) return { count: 0 };
  const art = first.querySelector('.offer-art');
  const footer = first.querySelector('.offer-footer');
  const sell = footer?.querySelector('.btn');
  const r = first.getBoundingClientRect();
  const a = art?.getBoundingClientRect();
  const f = footer?.getBoundingClientRect();
  return {
    count: cards.length,
    artLoaded: art?.tagName === 'IMG' ? art.complete && art.naturalWidth > 0 : false,
    artFillsCard: Boolean(a && a.height >= r.height * 0.6),
    artW: a ? Math.round(a.width) : 0,
    artH: a ? Math.round(a.height) : 0,
    footerBelowArt: Boolean(a && f && f.top >= a.bottom - 1),
    footerInside: Boolean(f && f.bottom <= r.bottom + 1),
    sellLabel: sell?.textContent?.trim() ?? null,
    kindLabel: first.dataset.kindLabel ?? null,
    legends: ['offer-kind', 'offer-desc', 'offer-body', 'offer-impact', 'offer-name'].filter((k) =>
      first.querySelector(`.${k}`),
    ),
  };
});

console.log(JSON.stringify(info, null, 2));
await page.screenshot({ path: `tools/shots/_shop-sell-${W}x${H}.png` });

const ok =
  info.count > 0 &&
  info.artLoaded &&
  info.artFillsCard &&
  info.footerBelowArt &&
  info.footerInside &&
  info.sellLabel !== null &&
  info.kindLabel !== null &&
  info.legends.length === 0 &&
  errors.length === 0;
console.log(`\nErrores de consola: ${errors.length}`);
console.log(ok ? '\nOK: la pestana Vender usa el layout nuevo.' : '\nFALLA: la pestana Vender quedo desalineada.');
await browser.close();
process.exit(ok ? 0 : 1);
