/**
 * tune-reward-arc.mjs — HERRAMIENTA DE AJUSTE (NO es un gate).
 *
 * Barre combinaciones (radius, arcStep) sobre el abanico 3D de RECOMPENSA ya
 * abierto, y reporta qué % del ancho del viewport ocupa el arco y si entra
 * completo. Sirve para justificar los valores de `REWARD_CAROUSEL` en `src/main.ts`.
 *
 * Para el gate de verdad (que SÍ falla exit 1 si se degrada) usar:
 *   node tools/probe-reward-shop-width.mjs
 *
 * Uso:
 *   node tools/tune-reward-arc.mjs
 *   FF_WIDTH=844 FF_HEIGHT=390 node tools/tune-reward-arc.mjs
 *
 * Requiere el dev server en 127.0.0.1:1420 (FF_URL para cambiarlo).
 *
 * Geometría (contraintuitiva, medida): radio MAYOR → arco MÁS ANCHO (aplana la
 * curva); arcStep MAYOR → menos superficie visible por carta (se ponen de canto).
 * Por eso el óptimo es el radio más grande que aún entra, con el step más chico.
 */
import { pathToFileURL } from 'node:url';

const W = Number(process.env.FF_WIDTH || 915);
const H = Number(process.env.FF_HEIGHT || 412);
const URL_BASE = process.env.FF_URL || 'http://127.0.0.1:1420';

const pw = await import(
  pathToFileURL('C:/Users/emanu/.workbuddy-ai/binaries/node/workspace/node_modules/playwright-core/index.js').href
);
const chromium = pw.chromium ?? pw.default?.chromium;
const browser = await chromium.launch({
  executablePath:
    'C:/Users/emanu/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe',
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--disable-gpu'],
});
const ctx = await browser.newContext({
  viewport: { width: W, height: H },
  hasTouch: true,
  isMobile: true,
  deviceScaleFactor: 1,
});
const page = await ctx.newPage();
await page.goto(`${URL_BASE}/?daily=0`, { waitUntil: 'load' });
await page.waitForSelector('.panel.is-menu', { timeout: 25000 });

// Los botones del menú están animados: locator.click() se cuelga por "not stable".
const clickAt = async (sel) => {
  const b = await page.locator(sel).first().boundingBox();
  if (b) await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
};

// --- Camino real hasta el panel de recompensa -------------------------------
await clickAt('.panel.is-menu [data-act="new"]');
await page.waitForSelector('.panel.is-archetypes', { timeout: 15000 });
const sp = page.locator('.panel.is-archetypes .archetype-card[data-archetype="spores"]');
if (await sp.count()) {
  await sp.first().scrollIntoViewIfNeeded();
  await sp.first().click();
  await page.waitForTimeout(250);
}
await clickAt('.panel.is-archetypes [data-act="archetypes-start"]');
await page.waitForTimeout(2200);
await page.evaluate(() => {
  const ff = window.__fungiflush;
  ff.engine.chooseBlind(ff.engine.availableBlinds()[1]?.id);
});
await page.waitForTimeout(1600);
// Forzar ciego superado: dejamos el score a 1 del objetivo y jugamos 5 cartas.
await page.evaluate(() => {
  const ff = window.__fungiflush;
  const r = ff.engine.round;
  r.score = r.target - 1;
  r.handsLeft = 1;
  for (const c of r.hand.slice(0, 5)) ff.engine.toggleSelect(c.uid);
  ff.engine.playHand();
});
await page
  .waitForFunction(
    () =>
      Boolean(document.querySelector('.panel.is-cleared [data-act="cleared-continue"]')) ||
      Boolean(document.querySelector('.panel.is-reward')),
    { timeout: 30000 }
  )
  .catch(() => {});
await page.evaluate(() =>
  document.querySelector('.panel.is-cleared [data-act="cleared-continue"]')?.click()
);
await page
  .waitForFunction(() => Boolean(document.querySelector('.panel.is-reward')), { timeout: 12000 })
  .catch(() => {});
await page.waitForTimeout(1400);

// --- Barrido ----------------------------------------------------------------
const cfgs = [];
for (const r of [11, 12, 14, 16, 18, 20, 22])
  for (const s of [0.45, 0.55, 0.65, 0.75, 0.85]) cfgs.push({ radius: r, arcStep: s });

const results = [];
for (const c of cfgs) {
  const res = await page.evaluate(async (cfg) => {
    const s = window.__fungiflush.scene;
    s.carousel.configure({ radius: cfg.radius, halfSpan: 2, arcStep: cfg.arcStep, wrap: false });
    await new Promise((r) => setTimeout(r, 950));
    const b = s.carouselScreenBox();
    if (!b) return null;
    return {
      pct: +((b.span / b.vw) * 100).toFixed(1),
      lo: +b.lo.toFixed(0),
      hi: +b.hi.toFixed(0),
      inside: b.lo >= 0 && b.hi <= b.vw,
    };
  }, c);
  results.push({ ...c, ...res });
  console.log(`r=${c.radius} step=${c.arcStep} -> ${JSON.stringify(res)}`);
}

const inside = results.filter((r) => r.inside).sort((a, b) => b.pct - a.pct);
console.log('\nMEJORES DENTRO DE CUADRO:');
for (const r of inside.slice(0, 6))
  console.log(`  r=${r.radius} step=${r.arcStep} -> ${r.pct}%  (${r.lo}..${r.hi})`);

await browser.close();
