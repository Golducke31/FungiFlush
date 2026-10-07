/**
 * probe-colony.mjs — Verifica la UI de la Colonia Fungi (meta-progresion).
 *
 * Mide, en el viewport MOVIL (915x412 por defecto), que:
 *   1. el panel de Perfil muestre el nivel, las Esporas de Colonia y la barra;
 *   2. los CUATRO accesos (Recompensas / Personalizar / Logros / Historial)
 *      esten DENTRO de la ventana (no alcanza con que existan en el DOM: el
 *      smoke clickea con el mouse en el centro real del boton);
 *   3. el panel de Recompensas liste la escalera de niveles;
 *   4. el panel de resultados muestre "+N Esporas de Colonia" con su desglose.
 *
 *   node tools/probe-colony.mjs
 *   FF_VIEWPORT=smoke node tools/probe-colony.mjs
 */
import { existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const URL_TO_TEST = process.env.FF_URL ?? 'http://127.0.0.1:1420/?daily=0';
const VIEWPORT =
  process.env.FF_VIEWPORT === 'smoke'
    ? { width: 844, height: 390 }
    : process.env.FF_VIEWPORT === 'tablet'
      ? { width: 1180, height: 820 }
      : { width: 915, height: 412 };

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
const shotsDir = join(ROOT, 'tools', 'shots');
if (!existsSync(shotsDir)) mkdirSync(shotsDir, { recursive: true });

const browser = await chromium.launch({
  executablePath: exe,
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--disable-dev-shm-usage'],
});
const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const page = await context.newPage();
const errors = [];
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

const click = (sel) => page.evaluate((s) => document.querySelector(s)?.click(), sel);
const has = (sel) => page.evaluate((s) => Boolean(document.querySelector(s)), sel);
const wait = (ms) => page.waitForTimeout(ms);

let failures = 0;
const check = (ok, label, detail = '') => {
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
};

await page.goto(URL_TO_TEST, { waitUntil: 'load', timeout: 45000 });
await page.waitForFunction(() => Boolean(window.__fungiflush?.engine?.run), { timeout: 30000 });
await wait(1800);
await click('[data-act="tutorial-close"]');
await wait(300);

// Se siembra una Colonia con progreso y se RECARGA: asi el probe ejercita el
// camino real (leer el perfil del storage + merge de la migracion + empujar el
// estado meta al HUD en el arranque). Sembrar en caliente no sirve: el HUD lee
// `menuMeta`, que solo se empuja al entrar al menu.
await page.evaluate(() => {
  const profile = window.__fungiflush.profileStore.current;
  profile.colony.lifetimeSpores = 1175;
  profile.colony.level = 6;
  profile.colony.seasonSpores = 400;
  profile.colony.firstClears = ['1:0', '1:1', '2:0'];
  profile.colony.unlockedRewards = [
    'frame_common',
    'pack_spores',
    'bg_new',
    'title_mycelium',
    'victory_fx',
  ];
  profile.account.provider = 'google-play';
  profile.account.accountId = 'gpg_probe';
  profile.account.displayName = 'Nova';
  profile.account.syncState = 'pending';
  localStorage.setItem('fungiflush.profile', JSON.stringify(profile));
});
await page.reload({ waitUntil: 'load' });
await page.waitForFunction(() => Boolean(window.__fungiflush?.engine?.run), { timeout: 30000 });
await wait(1800);
await click('[data-act="tutorial-close"]');
await wait(300);

// --- 1. Perfil ---
await click('.panel.is-menu [data-act="profile"]');
await page.waitForSelector('.panel.is-profile', { timeout: 8000 });
await wait(400);

const profile = await page.evaluate(() => {
  const vh = window.innerHeight;
  const vw = window.innerWidth;
  const body = document.querySelector('.panel.is-profile .profile-body');
  const bodyRect = body?.getBoundingClientRect();
  // "Dentro" = dentro del VIEWPORT **y** del area visible del scroller. Solo lo
  // primero no alcanza: un elemento puede estar en la ventana y recortado por
  // el `overflow` del cuerpo, que es exactamente como se rompe el smoke (que
  // clickea con el mouse en el centro real del boton).
  const visible = (r) => {
    if (r.top < -1 || r.left < -1 || r.right > vw + 1 || r.bottom > vh + 1) return false;
    if (bodyRect && (r.top < bodyRect.top - 1 || r.bottom > bodyRect.bottom + 1)) return false;
    return true;
  };
  const card = (act) => {
    const el = document.querySelector(`.panel.is-profile [data-act="${act}"]`);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return {
      act,
      top: Math.round(r.top),
      bottom: Math.round(r.bottom),
      h: Math.round(r.height),
      w: Math.round(r.width),
      inside: visible(r),
    };
  };
  const text = (sel) => document.querySelector(sel)?.textContent?.trim() ?? null;
  return {
    vh,
    body: bodyRect
      ? { top: Math.round(bodyRect.top), bottom: Math.round(bodyRect.bottom), client: body.clientHeight, scroll: body.scrollHeight }
      : null,
    spores: text('.panel.is-profile [data-counter="colony-spores"]'),
    level: text('.panel.is-profile .profile-colony-level'),
    next: text('.panel.is-profile .profile-colony-next'),
    fill: document.querySelector('.panel.is-profile .profile-colony-fill')?.style.width ?? null,
    cards: ['colony-rewards', 'cosmetics', 'achievements', 'history'].map(card),
    accountBtn: card('account-unlink') ?? card('account-link'),
    sync: text('.panel.is-profile .profile-account-sync'),
    icon: Boolean(document.querySelector('.panel.is-profile .colony-icon')),
  };
});

console.log('--- PERFIL ---');
console.log(JSON.stringify(profile, null, 2));
check(Boolean(profile.spores && profile.spores.includes('/')), 'muestra las Esporas de Colonia', profile.spores ?? 'null');
check(Boolean(profile.level && /Nivel/i.test(profile.level)), 'muestra el nivel', profile.level ?? 'null');
check(profile.fill === '44%', 'la barra refleja el progreso (175/400)', profile.fill ?? 'null');
check(profile.icon, 'el icono de Esporas de Colonia esta presente');
for (const c of profile.cards) {
  check(Boolean(c && c.inside), `acceso "${c?.act ?? '?'}" dentro de la ventana`, c ? `top ${c.top} bottom ${c.bottom} / vh ${profile.vh}` : 'no existe');
}
check(Boolean(profile.accountBtn && profile.accountBtn.inside), 'boton de cuenta dentro de la ventana');

await page.screenshot({ path: join(shotsDir, 'colony-profile.png') });

// --- 2. Recompensas ---
await click('.panel.is-profile [data-act="colony-rewards"]');
await page.waitForSelector('.panel.is-colony-rewards', { timeout: 8000 });
await wait(400);
const rewards = await page.evaluate(() => {
  const rows = [...document.querySelectorAll('.panel.is-colony-rewards .colony-reward-row')];
  const close = document.querySelector('.panel.is-colony-rewards [data-act="colony-rewards-close"]');
  const r = close?.getBoundingClientRect();
  return {
    total: rows.length,
    unlocked: rows.filter((x) => x.classList.contains('is-unlocked')).length,
    firstLevel: rows[0]?.dataset['level'] ?? null,
    lastLevel: rows[rows.length - 1]?.dataset['level'] ?? null,
    rawKeys: rows.filter((x) => /t\(['"]/.test(x.textContent ?? '')).length,
    closeInside: r ? r.top >= -1 && r.bottom <= window.innerHeight + 1 : false,
  };
});
console.log('--- RECOMPENSAS ---');
console.log(JSON.stringify(rewards, null, 2));
check(rewards.total === 10, 'la escalera lista 10 niveles', String(rewards.total));
check(rewards.unlocked === 6, 'marca los 6 niveles alcanzados', String(rewards.unlocked));
check(rewards.rawKeys === 0, 'ninguna clave i18n sin resolver');
check(rewards.closeInside, 'el boton Cerrar entra en la ventana');
await page.screenshot({ path: join(shotsDir, 'colony-rewards.png') });

// --- 3. Resultados ---
await page.evaluate(() => {
  const ff = window.__fungiflush;
  ff.hud.setColonyResult({
    spores: 155,
    bonuses: [
      { nameKey: 'colony.bonus.firstHand', amount: 10 },
      { nameKey: 'colony.bonus.firstHand', amount: 10 },
      { nameKey: 'colony.bonus.discards', amount: 5 },
      { nameKey: 'colony.bonus.mission', amount: 20 },
    ],
  });
  ff.hud.forceGameOver('loss');
});
await page.waitForSelector('.panel.is-gameover', { timeout: 8000 });
await wait(500);
const result = await page.evaluate(() => {
  const box = document.querySelector('.panel.is-gameover [data-act="colony-result"]');
  const value = document.querySelector('.panel.is-gameover [data-counter="colony-earned"]');
  const bonuses = [...document.querySelectorAll('.panel.is-gameover .colony-result-bonus')].map((b) => b.textContent);
  const r = box?.getBoundingClientRect();
  return {
    present: Boolean(box),
    value: value?.textContent ?? null,
    bonuses,
    inside: r ? r.bottom <= window.innerHeight + 1 : false,
  };
});
console.log('--- RESULTADOS ---');
console.log(JSON.stringify(result, null, 2));
check(result.present, 'el panel de resultados muestra el bloque de la Colonia');
check(result.value === '+155', 'el total es +155', result.value ?? 'null');
check(result.bonuses.length === 3, 'el desglose AGRUPA las bonificaciones repetidas', String(result.bonuses.length));
await page.screenshot({ path: join(shotsDir, 'colony-result.png') });

console.log('---');
console.log(`viewport ${VIEWPORT.width}x${VIEWPORT.height} · fallos: ${failures}`);
console.log('errores de consola:', errors.length ? errors.slice(0, 5) : 'ninguno');
if (errors.length) failures += 1;
await browser.close();
process.exit(failures > 0 ? 1 : 0);
