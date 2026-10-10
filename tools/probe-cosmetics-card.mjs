/**
 * probe-cosmetics-card.mjs — Tarjeta de Jugador en el panel de Cosmeticos.
 *
 * QUE VERIFICA
 * ------------
 *   1. Con avatar + marco equipados, la Tarjeta de Jugador del panel muestra
 *      LAS DOS imagenes y cargan de verdad (`naturalWidth > 0`, caja > 0).
 *   2. El arte se pide con ruta RELATIVA (`art/...`, sin barra inicial): el build
 *      usa `base: './'` y una ruta absoluta da 404 montado en un subpath.
 *   3. El avatar de la Tarjeta GRANDE es el MISMO que el del chip del menu.
 *   4. LIVE REFRESH: abrir Cosmeticos justo despues de cambiar el perfil (p. ej.
 *      reclamar una recompensa) muestra el estado NUEVO, sin depender de que
 *      alguien haya empujado el estado antes.
 *   5. Sin avatar/marco, la Tarjeta cae al PLACEHOLDER (circulo + seta) en vez de
 *      dejar un hueco vacio.
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

const SEED = {
  version: 7,
  seenTutorial: true,
  colony: { lifetimeSpores: 999999, claimedRewards: [], unlockedRewards: [] },
  cosmetics: {
    equippedCardBack: 'default',
    equippedFelt: 'default',
    equippedAvatar: 'avatar',
    equippedFrame: 'frame_uncommon',
    equippedTitle: 'title_mycelium',
    equippedBackground: 'bg_new',
    equippedVictoryFx: 'victory_fx',
    owned: ['default', 'avatar', 'frame_uncommon', 'title_mycelium', 'bg_new', 'victory_fx', 'mycelial'],
  },
};

const context = await browser.newContext({ viewport: { width: 915, height: 412 }, deviceScaleFactor: 2 });
const page = await context.newPage();
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
await page.addInitScript((s) => {
  localStorage.setItem('fungiflush.profile', JSON.stringify(s));
}, SEED);
await page.goto(URL_TO_TEST, { waitUntil: 'load', timeout: 45000 });
await page.waitForFunction(() => Boolean(window.__fungiflush?.engine), { timeout: 30000 });
await page.waitForTimeout(900);

// El chip del MENU, para comparar el avatar (mismo arte en las dos tarjetas).
const menuAvatarSrc = await page.evaluate(
  () => document.querySelector('.menu-gel--card .player-card-avatar-img')?.getAttribute('src') ?? null,
);

await page.evaluate(() => window.__fungiflush.hud.showCosmetics());
await page.waitForTimeout(700);

const card = await page.evaluate(() => {
  const el = document.querySelector('.cosmetics-player .player-card');
  if (!el) return { error: 'no player-card' };
  const read = (sel) => {
    const img = el.querySelector(sel);
    if (!img) return null;
    const r = img.getBoundingClientRect();
    return {
      src: img.getAttribute('src'),
      natural: `${img.naturalWidth}x${img.naturalHeight}`,
      rect: `${Math.round(r.width)}x${Math.round(r.height)}`,
      loaded: img.complete && img.naturalWidth > 0,
    };
  };
  return {
    avatar: read('.player-card-avatar-img'),
    frame: read('.player-card-frame'),
    bg: read('.player-card-bg'),
    placeholder: Boolean(el.querySelector('.player-card-avatar.is-placeholder')),
  };
});

check(!card.error, '1 existe la Tarjeta de Jugador en Cosmeticos', card.error ?? '');
check(Boolean(card.avatar), '1 el avatar esta en el DOM');
check(Boolean(card.avatar?.loaded), '1 el avatar CARGA de verdad', card.avatar ? `natural=${card.avatar.natural} rect=${card.avatar.rect}` : 'sin img');
check(Boolean(card.frame), '1 el marco esta en el DOM');
check(Boolean(card.frame?.loaded), '1 el marco CARGA de verdad', card.frame ? `natural=${card.frame.natural} rect=${card.frame.rect}` : 'sin img');
check(!card.placeholder, '1 NO cae al placeholder (hay arte)', `placeholder=${card.placeholder}`);

const avSrc = card.avatar?.src ?? '';
check(avSrc.startsWith('art/'), '2 la ruta del arte es RELATIVA (art/...)', `src="${avSrc}"`);
check(!avSrc.startsWith('/art/'), '2 la ruta NO es absoluta', `src="${avSrc}"`);

check(
  menuAvatarSrc !== null && avSrc.endsWith(menuAvatarSrc.split('/').pop() ?? '\u0000'),
  '3 el avatar coincide con el del chip del MENU',
  `menu="${menuAvatarSrc}" card="${avSrc}"`,
);

// --- 4) LIVE REFRESH: se cambia el perfil y se abre el panel SIN empujar estado ---
const refreshed = await page.evaluate(() => {
  const ff = window.__fungiflush;
  // Se cierra el panel y se toca el perfil DIRECTAMENTE (sin `syncCosmetics`):
  // simula reclamar una recompensa por fuera del callback de equipar.
  document.querySelector('.panel.is-cosmetics [data-act="cosmetics-close"]')?.click();
  ff.profileStore.patch((p) => {
    if (!p.cosmetics.owned.includes('frame_common')) p.cosmetics.owned.push('frame_common');
    p.cosmetics.equippedFrame = 'frame_common';
  });
  ff.hud.showCosmetics();
  const ids = [...document.querySelectorAll('.panel.is-cosmetics .cosmetics-card')]
    .filter((c) => c.dataset.kind === 'frame')
    .map((c) => c.dataset.id);
  const frameSrc = document.querySelector('.cosmetics-player .player-card-frame')?.getAttribute('src') ?? null;
  return { ids, frameSrc };
});
check(refreshed.ids.includes('frame_common'), '4 el marco recien obtenido aparece al abrir el panel', `ids=${refreshed.ids.join(',')}`);
check(
  refreshed.frameSrc === 'art/art_frame_frame_common.webp',
  '4 la Tarjeta refleja el marco nuevo sin reabrir a mano',
  `src="${refreshed.frameSrc}"`,
);

// --- 5) Sin avatar ni marco: placeholder ---
const placeholder = await page.evaluate(() => {
  const ff = window.__fungiflush;
  document.querySelector('.panel.is-cosmetics [data-act="cosmetics-close"]')?.click();
  ff.profileStore.patch((p) => {
    p.cosmetics.equippedAvatar = 'default';
    p.cosmetics.equippedFrame = 'default';
  });
  ff.hud.showCosmetics();
  const el = document.querySelector('.cosmetics-player .player-card-avatar');
  return {
    isPlaceholder: Boolean(el?.classList.contains('is-placeholder')),
    hasImg: Boolean(el?.querySelector('.player-card-avatar-img')),
  };
});
check(placeholder.isPlaceholder, '5 sin avatar cae al PLACEHOLDER', JSON.stringify(placeholder));
check(!placeholder.hasImg, '5 sin avatar no queda un <img> roto');

check(errors.length === 0, 'sin errores de consola', errors.slice(0, 2).join(' | '));

await browser.close();
console.log(`\n${failures === 0 ? 'TODO OK' : `${failures} FALLO(S)`}`);
process.exit(failures === 0 ? 0 : 1);
