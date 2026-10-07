/**
 * probe-reward-shop-width.mjs — SONDA DE ANCHO UTIL de Recompensa y Tienda.
 *
 * Fase 3 (workstream E): en landscape movil el draft de recompensa usaba
 * `clamp(96px,27vh,118px)` por tarjeta (~58% del ancho desperdiciado) y la
 * tienda dibujaba el arte en una franja de ~41px con `object-fit: cover`.
 * Esta sonda comprueba que DESPUES del cambio:
 *   - la tienda ocupa >=90% del ancho con sus ofertas;
 *   - el arte de la tienda respeta la proporcion de la cara (512/744 = 0.688);
 *   - el boton de compra queda DENTRO del viewport (el smoke lo clickea por
 *     coordenada, y una tarjeta mas alta lo empujaba fuera).
 *
 *   node tools/probe-reward-shop-width.mjs
 *   FF_URL=... node tools/probe-reward-shop-width.mjs
 */
import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const URL_TO_TEST = process.env.FF_URL ?? 'http://127.0.0.1:1420/?daily=0';
const MIN_RATIO = 0.9;
const CARD_ASPECT = 512 / 744;

const PW = 'C:/Users/emanu/.workbuddy-ai/binaries/node/workspace/node_modules/playwright-core/index.js';
const pw = await import(pathToFileURL(PW).href);
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

const browser = await chromium.launch({
  executablePath: exe,
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--disable-gpu'],
});
const problems = [];

for (const [w, h] of [
  [915, 412],
  [844, 390],
]) {
  const ctx = await browser.newContext({
    viewport: { width: w, height: h },
    hasTouch: true,
    isMobile: true,
    deviceScaleFactor: 1,
  });
  const page = await ctx.newPage();
  await page.goto(URL_TO_TEST, { waitUntil: 'load' });
  await page.waitForSelector('.panel.is-menu', { timeout: 25000 });

  const clickAt = async (sel) => {
    const box = await page.locator(sel).first().boundingBox();
    if (box) await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  };

  await clickAt('.panel.is-menu [data-act="new"]');
  await page.waitForSelector('.panel.is-archetypes', { timeout: 15000 });
  // El panel de arquetipo es de DOBLE toque: primero se elige la carta, recien
  // entonces el boton "start" queda habilitado. Sin este paso el probe se
  // quedaba en el menu y no llegaba nunca al draft.
  const spore = page.locator('.panel.is-archetypes .archetype-card[data-archetype="spores"]');
  if (await spore.count()) {
    await spore.first().scrollIntoViewIfNeeded();
    await spore.first().click();
    await page.waitForTimeout(250);
  }
  const startBtn = page.locator('.panel.is-archetypes [data-act="archetypes-start"]');
  await startBtn.scrollIntoViewIfNeeded();
  await clickAt('.panel.is-archetypes [data-act="archetypes-start"]');
  await page.waitForTimeout(2200);
  // Tutorial de la primera partida: se cierra si aparece.
  await page
    .waitForSelector('.panel.is-tutorial [data-act="tutorial-close"], .panel.is-tutorial [data-act="close"]', { timeout: 4000 })
    .then((el) => el.click())
    .catch(() => {});
  await page.waitForTimeout(600);
  // Entrar al ciego: sin `chooseBlind` la run se queda en `blind_select` y no
  // hay mano que jugar (ni, por tanto, draft de recompensa).
  await page.evaluate(() => {
    const ff = window.__fungiflush;
    ff.engine.chooseBlind(ff.engine.availableBlinds()[1]?.id);
  });
  await page.waitForTimeout(1800);
  console.log(
    `  [${w}x${h}] run:`,
    await page.evaluate(() => window.__fungiflush?.engine?.run?.status ?? null),
  );

  // Forzar la victoria del blind -> aviso "Ciego superado" -> draft.
  await page.evaluate(() => {
    const ff = window.__fungiflush;
    const round = ff.engine.round;
    if (!round) return;
    round.score = round.target - 1;
    round.handsLeft = 1;
    for (const c of round.hand.slice(0, 5)) ff.engine.toggleSelect(c.uid);
    ff.engine.playHand();
  });
  await page
    .waitForFunction(
      () =>
        Boolean(document.querySelector('.panel.is-cleared [data-act="cleared-continue"]')) ||
        Boolean(document.querySelector('.panel.is-reward')),
      { timeout: 30000 },
    )
    .catch(() => {});
  await page.evaluate(() =>
    document.querySelector('.panel.is-cleared [data-act="cleared-continue"]')?.click(),
  );
  await page
    .waitForFunction(() => Boolean(document.querySelector('.panel.is-reward')), { timeout: 12000 })
    .catch(() => {});
  await page.waitForTimeout(1400);

  const reward = await page.evaluate(() => {
    const ff = window.__fungiflush;
    const s = ff?.scene;
    // Si el render expone la caja en pantalla de las cartas del carrusel, es la
    // medida buena: el anillo vive en el canvas, no en el DOM.
    const box = typeof s?.carouselScreenBox === 'function' ? s.carouselScreenBox() : null;
    const detail = document.querySelector('.panel.is-reward .carousel-detail');
    const d = detail?.getBoundingClientRect();
    return {
      carouselBox: box,
      detailSpan: d ? +d.width.toFixed(1) : null,
      hasCarouselFrame: Boolean(document.querySelector('.panel.is-reward.is-carousel-frame')),
      pick: Boolean(document.querySelector('.panel.is-reward [data-act="pick"]')),
      skip: Boolean(document.querySelector('.panel.is-reward [data-act="skip"]')),
      vw: innerWidth,
      gridGone: document.querySelectorAll('.panel.is-reward .reward-grid').length,
    };
  });

  await page.evaluate(() => document.querySelector('.panel.is-reward [data-act="pick"]')?.click());
  await page
    .waitForFunction(() => Boolean(document.querySelector('.panel.is-shop .offer')), { timeout: 15000 })
    .catch(() => {});
  await page.waitForTimeout(900);

  const shop = await page.evaluate(() => {
    const measure = (sel) => {
      const els = [...document.querySelectorAll(sel)];
      if (els.length === 0) return null;
      let lo = Infinity;
      let hi = -Infinity;
      for (const el of els) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) continue;
        lo = Math.min(lo, r.left);
        hi = Math.max(hi, r.right);
      }
      if (!Number.isFinite(lo)) return null;
      return { count: els.length, span: +(hi - lo).toFixed(1), lo: +lo.toFixed(1), hi: +hi.toFixed(1) };
    };
    const art = document.querySelector('.panel.is-shop .offer-art');
    const ar = art ? art.getBoundingClientRect() : null;
    const btn = document.querySelector('.panel.is-shop .offer button');
    const br = btn ? btn.getBoundingClientRect() : null;
    const grid = document.querySelector('.panel.is-shop .offer-grid');
    return {
      offers: measure('.panel.is-shop .offer'),
      arts: measure('.panel.is-shop .offer-art'),
      artAspect: ar && ar.height ? +(ar.width / ar.height).toFixed(3) : null,
      artH: ar ? +ar.height.toFixed(1) : null,
      btnBottom: br ? +br.bottom.toFixed(1) : null,
      gridScroll: grid ? { scrollH: grid.scrollHeight, clientH: grid.clientHeight } : null,
      artObjectFit: art ? getComputedStyle(art).objectFit : null,
      vw: innerWidth,
      vh: innerHeight,
    };
  });

  const shopRatio = shop.offers ? +(shop.offers.span / shop.vw).toFixed(3) : null;

  console.log(`\n=== ${w}x${h} ===`);
  console.log(
    '  Recompensa:',
    JSON.stringify({
      carouselFrame: reward.hasCarouselFrame,
      gridGone: reward.gridGone,
      pick: reward.pick,
      skip: reward.skip,
      carouselBox: reward.carouselBox,
      detailSpan: reward.detailSpan,
    }),
  );
  console.log(
    '  Tienda:',
    JSON.stringify({
      offers: shop.offers,
      ratio: shopRatio,
      artAspect: shop.artAspect,
      artH: shop.artH,
      artObjectFit: shop.artObjectFit,
      btnBottom: shop.btnBottom,
      vh: shop.vh,
      gridScroll: shop.gridScroll,
    }),
  );

  if (!reward.hasCarouselFrame) problems.push(`${w}x${h}: la recompensa no usa .is-carousel-frame`);
  if (reward.gridGone > 0) problems.push(`${w}x${h}: quedo el .reward-grid viejo en la recompensa`);
  if (!reward.pick) problems.push(`${w}x${h}: falta [data-act="pick"] en la recompensa`);
  if (reward.carouselBox && reward.carouselBox.count > 0) {
    const r = reward.carouselBox.span / reward.carouselBox.vw;
    if (r < MIN_RATIO) {
      problems.push(
        `${w}x${h}: el carrusel de recompensa usa ${(r * 100).toFixed(1)}% del ancho (< ${MIN_RATIO * 100}%)`,
      );
    }
  }
  if (shopRatio !== null && shopRatio < MIN_RATIO) {
    problems.push(
      `${w}x${h}: la tienda usa ${(shopRatio * 100).toFixed(1)}% del ancho (< ${MIN_RATIO * 100}%)`,
    );
  }
  if (shop.artAspect !== null && Math.abs(shop.artAspect - CARD_ASPECT) > 0.05) {
    problems.push(`${w}x${h}: arte de tienda con aspecto ${shop.artAspect} (esperado ~${CARD_ASPECT.toFixed(3)})`);
  }
  if (shop.artObjectFit && shop.artObjectFit !== 'contain') {
    problems.push(`${w}x${h}: el arte de tienda usa object-fit:${shop.artObjectFit} (deberia ser contain)`);
  }
  if (shop.btnBottom !== null && shop.btnBottom > shop.vh) {
    problems.push(`${w}x${h}: el boton de compra queda fuera del viewport (${shop.btnBottom} > ${shop.vh})`);
  }

  await ctx.close();
}

await browser.close();

console.log('\n=== SONDA ANCHO RECOMPENSA/TIENDA ===');
if (problems.length === 0) {
  console.log('  OK: Recompensa y Tienda usan el ancho disponible y el arte no se recorta.');
} else {
  for (const p of problems) console.log('  x ' + p);
  process.exitCode = 1;
}
