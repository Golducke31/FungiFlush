/**
 * probe-menu-language.mjs — El boton de IDIOMA del menu principal.
 *
 * QUE VERIFICA
 * ------------
 *   1. Un perfil NUEVO arranca en INGLES (`document.documentElement.lang === 'en'`)
 *      y el boton muestra `EN`.
 *   2. Tocar el boton cambia a ESPAÑOL: el `<html lang>` y los textos del menu
 *      cambian, y el boton pasa a mostrar `ES`.
 *   3. El boton es el UNICO control de idioma: NO existe en Ajustes ni en el
 *      panel de salida del menu in-game.
 *   4. La eleccion PERSISTE: al recargar, el juego sigue en el idioma elegido.
 *   5. El boton vive en la barra superior del menu, con la MISMA caja "gel"
 *      celeste que Perfil / Recompensa diaria.
 */

import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

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

const URL_TO_TEST = process.env.FF_URL ?? 'http://127.0.0.1:1420/?daily=0';

let failures = 0;
const check = (ok, label, detail = '') => {
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
};

const browser = await chromium.launch({
  executablePath: exe,
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--disable-dev-shm-usage'],
});
const context = await browser.newContext({ viewport: { width: 915, height: 412 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const page = await context.newPage();
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

// Perfil NUEVO: nada sembrado (ni perfil ni idioma en localStorage).
await page.goto(URL_TO_TEST, { waitUntil: 'load', timeout: 45000 });
await page.waitForFunction(() => Boolean(window.__fungiflush?.engine), { timeout: 30000 });
await page.waitForTimeout(1200);
await page.evaluate(() => document.querySelector('[data-act="tutorial-close"]')?.click());
await page.waitForTimeout(300);

const boot = await page.evaluate(() => {
  const btn = document.querySelector('.panel.is-menu [data-act="lang"]');
  const icon = document.querySelector('.panel.is-menu [data-act="profile"]');
  return {
    htmlLang: document.documentElement.lang,
    label: btn?.querySelector('.menu-gel-lang')?.textContent ?? null,
    isGel: Boolean(btn?.classList.contains('menu-gel') && btn?.classList.contains('menu-gel--icon')),
    inTopBar: Boolean(btn?.closest('.menu-top')),
    iconClass: icon?.className ?? '',
    newRunText: document.querySelector('.panel.is-menu [data-act="new"]')?.textContent?.trim() ?? '',
  };
});
check(boot.htmlLang === 'en', '1 el juego ARRANCA en ingles', `lang=${boot.htmlLang}`);
check(boot.label === 'EN', '1 el boton marca EN', `label=${boot.label}`);
check(boot.isGel, '5 el boton usa la caja "gel" celeste', `isGel=${boot.isGel}`);
check(boot.inTopBar, '5 el boton vive en la barra superior del menu');
check(
  boot.iconClass.includes('menu-gel--icon'),
  '5 misma familia que Perfil/Recompensa',
  `profile="${boot.iconClass}"`,
);
check(boot.newRunText.length > 0 && /new run|nueva partida/i.test(boot.newRunText), '1 el menu sale en ingles', `new="${boot.newRunText}"`);

// --- 3) El idioma NO esta en Ajustes ni en el panel de salida ---
await page.evaluate(() => document.querySelector('.panel.is-menu [data-act="menu-toggle"]')?.click());
await page.waitForTimeout(250);
await page.evaluate(() => document.querySelector('.panel.is-menu [data-act="settings"]')?.click());
await page.waitForTimeout(700);
const settingsLang = await page.evaluate(() => ({
  panel: Boolean(document.querySelector('.panel.is-settings')),
  lang: Boolean(document.querySelector('.panel.is-settings [data-act="lang"]')),
}));
check(settingsLang.panel, '3 Ajustes abre');
check(!settingsLang.lang, '3 Ajustes ya NO tiene el control de idioma');
await page.evaluate(() => document.querySelector('.panel.is-settings [data-act="close"]')?.click());
await page.waitForTimeout(600);

// --- 2) El toggle cambia a español ---
await page.evaluate(() => document.querySelector('.panel.is-menu [data-act="lang"]')?.click());
await page.waitForTimeout(900);
const es = await page.evaluate(() => ({
  htmlLang: document.documentElement.lang,
  label: document.querySelector('.panel.is-menu [data-act="lang"] .menu-gel-lang')?.textContent ?? null,
  newRunText: document.querySelector('.panel.is-menu [data-act="new"]')?.textContent?.trim() ?? '',
  profileLang: window.__fungiflush.profileStore.current.settings.lang,
}));
check(es.htmlLang === 'es', '2 el toggle pasa a español', `lang=${es.htmlLang}`);
check(es.label === 'ES', '2 el boton pasa a marcar ES', `label=${es.label}`);
check(/nueva partida/i.test(es.newRunText), '2 los textos del menu se traducen', `new="${es.newRunText}"`);
check(es.profileLang === 'es', '2 la eleccion se persiste en el PERFIL', `profile.lang=${es.profileLang}`);

// --- 4) Persistencia tras recargar ---
await page.reload({ waitUntil: 'load' });
await page.waitForFunction(() => Boolean(window.__fungiflush?.engine), { timeout: 30000 });
await page.waitForTimeout(1200);
const afterReload = await page.evaluate(() => ({
  htmlLang: document.documentElement.lang,
  label: document.querySelector('.panel.is-menu [data-act="lang"] .menu-gel-lang')?.textContent ?? null,
}));
check(afterReload.htmlLang === 'es', '4 tras recargar sigue en español', `lang=${afterReload.htmlLang}`);
check(afterReload.label === 'ES', '4 el boton sigue marcando ES', `label=${afterReload.label}`);

// --- 3b) El panel de salida in-game tampoco lo tiene ---
await page.evaluate(() => window.__fungiflush.unlockArchetypes());
await page.evaluate(() => document.querySelector('.panel.is-menu [data-act="new"]')?.click());
await page.waitForTimeout(800);
await page.evaluate(() => document.querySelector('[data-act="archetypes-start"]')?.click());
await page.waitForTimeout(1500);
await page.evaluate(() => document.querySelector('[data-act="tutorial-close"]')?.click());
await page.waitForTimeout(600);
await page.evaluate(() => document.querySelector('[data-act="blind-menu"]')?.click());
await page.waitForTimeout(1200);
const quitLang = await page.evaluate(() => ({
  menu: Boolean(document.querySelector('.panel.is-menu')),
  langInMenu: Boolean(document.querySelector('.panel.is-menu [data-act="lang"]')),
  langElsewhere: document.querySelectorAll('[data-act="lang"]').length,
}));
check(quitLang.menu, '3b se vuelve al menu desde la partida');
check(quitLang.langInMenu && quitLang.langElsewhere === 1, '3b el boton de idioma es UNICO en toda la UI', `count=${quitLang.langElsewhere}`);

check(errors.length === 0, 'sin errores de consola', errors.slice(0, 2).join(' | '));

await browser.close();
console.log(`\n${failures === 0 ? 'TODO OK' : `${failures} FALLO(S)`}`);
process.exit(failures === 0 ? 0 : 1);
