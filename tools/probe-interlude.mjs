/**
 * probe-interlude.mjs — Mide y captura la pantalla de INTERLUDIO (la que ofrece
 * un trato con dos opciones) en movil landscape.
 *
 * El interludio no tiene `.panel-actions`: las acciones viven DENTRO de cada
 * opcion. Eso lo deja fuera del modelo de tres zonas de P8 (que protege el pie),
 * asi que hay que medirlo aparte: si el contenido pasa el alto, el panel lo
 * recorta (tiene `overflow: hidden`) y el boton "Aceptar" se pierde.
 *
 *   node tools/probe-interlude.mjs
 *   FF_VIEWPORT=smoke node tools/probe-interlude.mjs   # 844x390
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

const ids = await page.evaluate(() => (window.__fungiflush.engine.registry.interludeDefs ?? []).map((d) => d.id));
console.log('Interludios:', ids.join(', '));

const results = [];
for (const id of ids) {
  const ok = await page.evaluate((interludeId) => {
    const ff = window.__fungiflush;
    const def = (ff.engine.registry.interludeDefs ?? []).find((d) => d.id === interludeId);
    if (!def) return false;
    // Se fuerza el interludio pendiente y se pinta el panel real: lo que se
    // verifica es el LAYOUT, no el sorteo del motor.
    ff.engine.pendingInterlude = def;
    ff.engine.run.status = 'interlude';
    ff.hud.showInterlude();
    return true;
  }, id);
  if (!ok) continue;
  await page.waitForTimeout(700);

  const m = await page.evaluate(() => {
    const rect = (el) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { top: Math.round(r.top), bottom: Math.round(r.bottom), h: Math.round(r.height) };
    };
    const panel = document.querySelector('#ui-root > .overlay.is-open > .panel.is-interlude');
    if (!panel) return { none: true };
    const choices = panel.querySelector('.interlude-choices');
    const btns = [...panel.querySelectorAll('.interlude-choice .btn')];
    return {
      vh: window.innerHeight,
      panel: rect(panel),
      head: rect(panel.querySelector('.interlude-head')),
      desc: rect(panel.querySelector('.panel-desc')),
      choices: rect(choices),
      choicesCount: panel.querySelectorAll('.interlude-choice').length,
      lastBtn: btns.length ? rect(btns[btns.length - 1]) : null,
      panelScroll: Math.round(panel.scrollHeight - panel.clientHeight),
      overflowBottom: btns.length ? Math.round(btns[btns.length - 1].getBoundingClientRect().bottom - window.innerHeight) : null,
    };
  });
  results.push({ id, ...m });
  await page.screenshot({ path: join(shotsDir, `interlude-${id}.png`) });

  const bad = !m.none && ((m.panelScroll ?? 0) > 2 || (m.overflowBottom ?? 0) > 2);
  console.log(
    `  ${m.none ? '--' : bad ? 'XX' : 'OK'} ${id.padEnd(26)}` +
    (m.none ? ' (sin panel)' : ` panelH=${m.panel?.h}/${m.vh} scroll=${m.panelScroll} lastBtnBottom=${m.lastBtn?.bottom} overflow=${m.overflowBottom}`),
  );
}

// Cerrar el ultimo panel para no dejar la pagina en un estado raro.
await page.evaluate(() => {
  const ff = window.__fungiflush;
  ff.engine.pendingInterlude = null;
  ff.hud.closePanel?.();
});
await browser.close();

const bad = results.filter((r) => !r.none && ((r.panelScroll ?? 0) > 2 || (r.overflowBottom ?? 0) > 2));
console.log(`\n${bad.length} interludio(s) con recorte. Shots: tools/shots/interlude-*.png`);
