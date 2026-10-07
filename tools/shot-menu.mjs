/**
 * shot-menu.mjs — Captura el MENU PRINCIPAL tal como esta hoy.
 *
 * Sirve para revisar el rediseno de botones gel sin abrir el juego a mano. Toma
 * la referencia movil (915x412) y, si se pide, el smoke (844x390).
 */
import { pathToFileURL } from 'node:url';

const pw = await import(
  pathToFileURL('C:/Users/emanu/.workbuddy-ai/binaries/node/workspace/node_modules/playwright-core/index.js').href
);
const { chromium } = pw.default ?? pw;

const SIZES = [
  { w: 915, h: 412, tag: 'ref' },
  { w: 844, h: 390, tag: 'smoke' },
];

const browser = await chromium.launch();
for (const { w, h, tag } of SIZES) {
  const page = await browser.newPage({
    viewport: { width: w, height: h },
    deviceScaleFactor: 2,
    hasTouch: true,
    isMobile: true,
  });
  await page.goto(process.env.FF_URL ?? 'http://localhost:5173/', { waitUntil: 'load' });
  await page.waitForSelector('[data-act]', { state: 'attached', timeout: 60000 });
  // Al arrancar puede aparecer el panel de RECOMPENSA DIARIA antes del menu.
  // Hay que cerrarlo o la captura muestra el modal, no el menu.
  for (let i = 0; i < 6; i++) {
    const closed = await page.evaluate(() => {
      const btn = document.querySelector('[data-act="daily-close"]');
      if (!btn) return false;
      btn.click();
      return true;
    });
    if (!closed) break;
    await page.waitForTimeout(600);
  }
  await page.waitForSelector('[data-act="new"]', { state: 'attached', timeout: 60000 });
  // Dejar que terminen las animaciones de entrada del menu.
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `tools/shots/_menu-${tag}-${w}x${h}.png` });
  const info = await page.evaluate(() => {
    const box = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
    };
    return {
      nuevo: box('[data-act="new"]'),
      continuar: box('[data-act="continue"]'),
      perfil: box('[data-act="profile"]'),
      hamburguesa: box('[data-act="menu-toggle"]'),
    };
  });
  console.log(`${tag} ${w}x${h}: ${JSON.stringify(info)}`);
  await page.close();
}
await browser.close();
