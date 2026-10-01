/**
 * verify-voucher.mjs — Verificacion en navegador del flujo de vouchers (R3).
 *
 * Lo que el harness de consola NO puede probar: que la oferta de voucher se
 * DIBUJE bien en la tienda (etiqueta traducida, precio con descuento, borde
 * dorado), que el boton respete `canBuyOffer`, y que el banner de confirmacion
 * salga al comprar. Todo eso vive en el DOM y en el HUD.
 *
 * Uso: node tools/verify-voucher.mjs
 */

import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const URL_TO_TEST = process.argv[2] ?? 'http://127.0.0.1:1420/?daily=0';

const pw = await import(
  pathToFileURL(
    'C:/Users/emanu/.workbuddy-ai/binaries/node/workspace/node_modules/playwright-core/index.js',
  ).href
);
const chromium = pw.chromium ?? pw.default?.chromium;

const CANDIDATES = [
  'C:/Users/emanu/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe',
  'C:/Users/emanu/AppData/Local/ms-playwright/chromium-1228/chrome-win64/chrome.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
];
const executablePath = CANDIDATES.find((p) => existsSync(p));
if (!executablePath) {
  console.error('No se encontro un Chromium ejecutable.');
  process.exit(1);
}

const shotsDir = join(ROOT, 'tools', 'shots');
if (!existsSync(shotsDir)) mkdirSync(shotsDir, { recursive: true });

const browser = await chromium.launch({
  executablePath,
  headless: true,
  args: [
    '--enable-unsafe-swiftshader',
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-webgl',
    '--ignore-gpu-blocklist',
    '--disable-dev-shm-usage',
  ],
});

const context = await browser.newContext({
  viewport: { width: 844, height: 390 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
});

const page = await context.newPage();
const errors = [];
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});
page.on('pageerror', (e) => errors.push(`PAGEERROR ${e.message}`));

await page.goto(URL_TO_TEST, { waitUntil: 'load', timeout: 45000 });
await page.waitForFunction(() => Boolean(window.__fungiflush?.engine?.run), { timeout: 30000 });
await page.waitForTimeout(1500);

// --- Arrancar una run y entrar a la tienda con vouchers forzados ---
const setup = await page.evaluate(() => {
  const ff = window.__fungiflush;
  ff.engine.startRun(1234);

  // Se inyectan dos vouchers: uno de descuento (activo) y uno de efecto.
  // Se usa la API real del motor para armar las ofertas.
  const mk = (id, cost) => {
    const def = ff.engine.registry.getVoucher(id);
    return {
      id: `v:${id}`,
      kind: 'voucher',
      refId: def.id,
      nameKey: def.nameKey,
      descKey: def.descKey,
      cost: cost ?? def.cost,
      art: def.art,
      sold: false,
    };
  };

  ff.engine.run.money = 200;
  // `voucher_bulk_deal` da 25% de descuento: el precio MOSTRADO debe ser menor.
  ff.engine.run.vouchers = ['voucher_bulk_deal'];
  ff.engine.enterShop();

  const shop = ff.engine.run.shop;
  shop.offers = [
    mk('voucher_thin_cut', 20),
    mk('voucher_sixth_slot', 14),
    {
      id: 'c:1',
      kind: 'card',
      refId: ff.engine.registry.allCards()[0].id,
      nameKey: ff.engine.registry.allCards()[0].nameKey,
      descKey: ff.engine.registry.allCards()[0].descKey,
      cost: 6,
      art: ff.engine.registry.allCards()[0].art,
      sold: false,
    },
  ];
  ff.hud.refreshPanel();
  return { offers: shop.offers.map((o) => `${o.kind}:${o.refId}@${o.cost}`) };
});

await page.waitForTimeout(900);
await page.screenshot({ path: join(shotsDir, '19-shop-voucher.png') });

const rendered = await page.evaluate(() => {
  const cards = [...document.querySelectorAll('.panel.is-shop .offer')];
  return {
    total: cards.length,
    vouchers: cards.filter((c) => c.classList.contains('is-voucher')).length,
    // Etiqueta traducida (no "VOUCHER" crudo).
    labels: cards.map((c) => c.querySelector('.offer-kind')?.textContent ?? null),
    // Precio pintado vs precio de lista.
    prices: cards.map((c) => ({
      shown: c.querySelector('.offer-price')?.textContent ?? null,
      was: c.querySelector('.offer-price-was')?.textContent ?? null,
      full: c.dataset.fullPrice ?? null,
      discounted: Boolean(c.querySelector('.offer-price.is-discounted')),
    })),
    banners: [...document.querySelectorAll('.banner')].map((b) => b.textContent),
  };
});

// --- Comprar el voucher con descuento y comprobar el banner ---
const buy = await (async () => {
  const box = await page.locator('.panel.is-shop .offer.is-voucher').first().boundingBox();
  if (!box) return { skipped: 'sin oferta de voucher' };

  const before = await page.evaluate(() => ({
    money: window.__fungiflush.engine.run.money,
    vouchers: [...window.__fungiflush.engine.run.vouchers],
  }));

  const button = await page
    .locator('.panel.is-shop .offer.is-voucher')
    .first()
    .locator('button')
    .boundingBox();
  await page.mouse.click(button.x + button.width / 2, button.y + button.height / 2);
  await page.waitForTimeout(600);

  const after = await page.evaluate(() => {
    const cards = [...document.querySelectorAll('.panel.is-shop .offer')];
    const sold = cards.filter((c) => c.classList.contains('is-sold'));
    return {
      money: window.__fungiflush.engine.run.money,
      vouchers: [...window.__fungiflush.engine.run.vouchers],
      banners: [...document.querySelectorAll('.banner')].map((b) => b.textContent),
      soldCount: sold.length,
      soldIsVoucher: sold[0]?.classList.contains('is-voucher') ?? false,
      soldStampVisible: sold[0]?.querySelector('.offer-sold')?.hidden === false,
      soldButtonLabel: sold[0]?.querySelector('button')?.textContent ?? null,
      soldButtonDisabled: sold[0]?.querySelector('button')?.disabled ?? null,
      rerollLabel: document.querySelector('.panel.is-shop .panel-actions .btn:nth-child(3)')
        ?.textContent,
      toasts: [...document.querySelectorAll('.toast')].map((t) => t.textContent),
    };
  });

  return { before, after, paid: before.money - after.money };
})();

await page.screenshot({ path: join(shotsDir, '19b-shop-voucher-comprado.png') });

// --- El objetivo baja tras comprar el voucher de corte ---
const target = await page.evaluate(() => {
  const ff = window.__fungiflush;
  const blind = ff.engine.availableBlinds()[0];
  return {
    multiplier: ff.engine.modifiers.targetMultiplier,
    target: ff.engine.targetFor(blind),
    rerollPrice: ff.engine.rerollPrice,
  };
});

console.log('\n=== Ofertas sorteadas ===');
console.log(JSON.stringify(setup, null, 2));
console.log('\n=== DOM de la tienda ===');
console.log(JSON.stringify(rendered, null, 2));
console.log('\n=== Compra ===');
console.log(JSON.stringify(buy, null, 2));
console.log('\n=== Reglas tras la compra ===');
console.log(JSON.stringify(target, null, 2));
console.log(`\nErrores de consola: ${errors.length}`);
for (const e of errors.slice(0, 10)) console.log(`  x ${e}`);

const checks = {
  vouchers: rendered.vouchers === 2,
  labelTraducida: rendered.labels.includes('Mejora'),
  sinClaveCruda: !rendered.labels.includes('VOUCHER'),
  todosConDescuento: rendered.prices.filter((p) => p.discounted).length === 3,
  mostradoMenor: rendered.prices.every((p) => Number(p.shown) < Number(p.full)),
  pagoCorrecto: buy.paid === 15,
  dosVouchers: buy.after.vouchers.length === 2,
  vendida: buy.after.soldCount === 1 && buy.after.soldIsVoucher === true,
  selloVisible: buy.after.soldStampVisible === true,
  botonVendido: buy.after.soldButtonLabel === 'VENDIDO' && buy.after.soldButtonDisabled === true,
  banner: buy.after.banners.some((b) => b.includes('Mejora aplicada')),
  multiplicador: Math.abs(target.multiplier - 0.9) < 1e-6,
  sinErrores: errors.length === 0,
};
console.log('\n=== Chequeos ===');
for (const [k, v] of Object.entries(checks)) console.log(`  ${v ? 'ok ' : 'FALLA'} ${k}`);

const ok = Object.values(checks).every(Boolean);

console.log(ok ? '\n✓ VOUCHER VERIFY OK' : '\n✗ VOUCHER VERIFY FALLO');
await browser.close();
process.exit(ok ? 0 : 1);
