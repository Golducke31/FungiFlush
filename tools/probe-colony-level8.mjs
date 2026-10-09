/**
 * probe-colony-level8.mjs — Reproduce el reporte del jugador:
 * "soy lvl 8, equipe las recompensas y parecen no aparecer, el titulo si es visible".
 *
 * Hipotesis: `unlockedRewards` (fuente AUTORITATIVA del estado de reclamo) puede
 * quedar DESINCRONIZADO del nivel derivado (`levelForSpores`). La migracion
 * recalcula `colony.level` desde `lifetimeSpores`, pero NO rellena
 * `unlockedRewards`. Resultado: el panel de Recompensas NO ofrece reclamar las
 * recompensas de nivel alto -> nunca entran a `cosmetics.owned` -> nunca se
 * pueden equipar. El titulo (nivel 5) si llego a reclamarse, por eso se ve.
 *
 *   node tools/probe-colony-level8.mjs
 */
import { existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const URL_TO_TEST = process.env.FF_URL ?? 'http://127.0.0.1:1420/?daily=0';
const VIEWPORT = process.env.FF_VIEWPORT === 'smoke' ? { width: 844, height: 390 } : { width: 915, height: 412 };

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
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

const click = (sel) => page.evaluate((s) => document.querySelector(s)?.click(), sel);
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

// --- ESCENARIO REAL DEL JUGADOR ---
// Nivel 8 (umbral 950 Esporas) pero `unlockedRewards` DESINCRONIZADO: solo tiene
// las recompensas que el jugador alcanzo a reclamar ANTES (nivel <= 5), y le
// faltan las de nivel 6..8. Es exactamente lo que deja la migracion si el perfil
// guardado venia de antes del sistema de recompensas nombradas, o si el nivel se
// recalculo sin empujar los desbloqueos.
await page.evaluate(() => {
  const profile = window.__fungiflush.profileStore.current;
  profile.colony.lifetimeSpores = 980; // -> nivel 8
  profile.colony.level = 8;
  profile.colony.seasonSpores = 600;
  profile.colony.firstClears = ['1:0', '1:1', '2:0', '2:1'];
  profile.colony.unlockedRewards = ['frame_common', 'pack_spores', 'bg_new', 'title_mycelium'];
  profile.colony.claimedRewards = ['frame_common', 'pack_spores', 'bg_new', 'title_mycelium'];
  // `owned` consistente con lo YA reclamado (marco comun, fondo, titulo). El
  // avatar (nivel 8) y el sobre de colonia (nivel 7) faltan: son el bug.
  profile.cosmetics.owned = ['default', 'frame_common', 'bg_new', 'title_mycelium'];
  profile.cosmetics.equippedTitle = 'title_mycelium';
  profile.cosmetics.equippedAvatar = 'default';
  profile.cosmetics.equippedFrame = 'default';
  profile.cosmetics.equippedBackground = 'default';
  localStorage.setItem('fungiflush.profile', JSON.stringify(profile));
});
// Recarga: el estado meta se lee del storage + migracion al arrancar.
await page.reload({ waitUntil: 'load' });
await page.waitForFunction(() => Boolean(window.__fungiflush?.engine?.run), { timeout: 30000 });
await wait(1800);
await click('[data-act="tutorial-close"]');
await wait(300);

const dump = await page.evaluate(() => {
  const p = window.__fungiflush.profileStore.current;
  return {
    lifetime: p.colony.lifetimeSpores,
    level: p.colony.level,
    unlocked: [...p.colony.unlockedRewards],
    claimed: [...p.colony.claimedRewards],
    owned: [...p.cosmetics.owned],
  };
});
console.log('--- PERFIL TRAS CARGA ---');
console.log(JSON.stringify(dump, null, 2));

// --- Panel de Recompensas: ¿ofrece reclamar la de nivel 8 (avatar)? ---
await click('.panel.is-menu [data-act="profile"]');
await page.waitForSelector('.panel.is-profile', { timeout: 8000 });
await wait(400);
await click('.panel.is-profile [data-act="colony-rewards"]');
await page.waitForSelector('.panel.is-colony-rewards', { timeout: 8000 });
await wait(400);

const rewards = await page.evaluate(() => {
  const rows = [...document.querySelectorAll('.panel.is-colony-rewards .colony-reward-row')];
  const rowInfo = (lvl) => {
    const r = rows.find((x) => x.dataset['level'] === String(lvl));
    if (!r) return null;
    return {
      level: lvl,
      claimable: r.classList.contains('is-claimable'),
      claimed: r.classList.contains('is-claimed'),
      unlocked: r.classList.contains('is-unlocked'),
      label: r.querySelector('.colony-reward-claim')?.textContent?.trim() ?? null,
      disabled: r.querySelector('.colony-reward-claim')?.disabled ?? null,
    };
  };
  return { total: rows.length, l6: rowInfo(6), l7: rowInfo(7), l8: rowInfo(8), l9: rowInfo(9) };
});
console.log('--- PANEL RECOMPENSAS (nivel 8 con unlocked desincronizado) ---');
console.log(JSON.stringify(rewards, null, 2));

// El jugador ESPERA poder reclamar (y luego equipar) la recompensa del nivel 8.
check(dump.level === 8, 'el perfil esta en nivel 8', String(dump.level));
check(
  rewards.l8 && rewards.l8.unlocked,
  'la fila del nivel 8 figura DESBLOQUEADA',
  JSON.stringify(rewards.l8),
);
check(
  rewards.l8 && rewards.l8.claimable,
  'la recompensa del nivel 8 es RECLAMABLE (avatar) -> es lo que el jugador espera',
  rewards.l8 ? `claimable=${rewards.l8.claimable} label=${rewards.l8.label}` : 'sin fila',
);
check(
  rewards.l7 && rewards.l7.claimable,
  'la recompensa del nivel 7 es RECLAMABLE (sobre colonia)',
  rewards.l7 ? `claimable=${rewards.l7.claimable}` : 'sin fila',
);

await page.screenshot({ path: join(shotsDir, 'colony-level8-rewards.png') });

// Reclama la recompensa del nivel 8 (avatar) con el boton REAL de la fila.
await click('.panel.is-colony-rewards .colony-reward-row[data-level="8"] .colony-reward-claim');
await wait(600);
const afterClaim = await page.evaluate(() => {
  const p = window.__fungiflush.profileStore.current;
  return { owned: [...p.cosmetics.owned], claimed: [...p.colony.claimedRewards] };
});
console.log('--- TRAS RECLAMAR NIVEL 8 ---');
console.log(JSON.stringify(afterClaim, null, 2));
check(afterClaim.owned.includes('avatar'), 'el avatar entra a `owned` al reclamar', afterClaim.owned.join(', '));

// --- Personalizar: ¿el avatar figura como equipable? ---
await page.evaluate(() => window.__fungiflush.hud.showProfile());
await page.waitForSelector('.panel.is-profile', { timeout: 8000 });
await wait(300);
await click('.panel.is-profile [data-act="cosmetics"]');
await page.waitForSelector('.panel.is-cosmetics', { timeout: 8000 });
await wait(400);
const cosmetics = await page.evaluate(() => {
  const panel = document.querySelector('.panel.is-cosmetics');
  const ids = (kind) =>
    [...panel.querySelectorAll(`.cosmetics-card[data-kind="${kind}"]`)].map((c) => c.dataset['id']);
  return {
    avatar: ids('avatar'),
    frame: ids('frame'),
    background: ids('background'),
    title: ids('title'),
  };
});
console.log('--- PERSONALIZAR (lo que el jugador PUEDE equipar) ---');
console.log(JSON.stringify(cosmetics, null, 2));
check(
  cosmetics.avatar.includes('avatar'),
  'el avatar de nivel 8 aparece como equipable tras reclamarlo',
  cosmetics.avatar.join(', '),
);
check(cosmetics.frame.includes('frame_common'), 'el marco comun (nivel 2) es equipable', cosmetics.frame.join(', '));

// Equipa el avatar y comprueba que el ARTE carga en la Tarjeta de Jugador.
await click('.panel.is-cosmetics [data-act="cosmetic-equip"][data-kind="avatar"][data-id="avatar"]');
await wait(400);
const equipped = await page.evaluate(() => {
  const img = document.querySelector('.panel.is-cosmetics .player-card-avatar-img');
  return {
    equippedAvatar: window.__fungiflush.profileStore.current.cosmetics.equippedAvatar,
    avatarLoaded: img ? img.complete && img.naturalWidth > 0 : false,
  };
});
console.log('--- AVATAR EQUIPADO ---');
console.log(JSON.stringify(equipped, null, 2));
check(equipped.equippedAvatar === 'avatar', 'el avatar equipado se persiste', equipped.equippedAvatar);
check(equipped.avatarLoaded, 'el arte del avatar CARGA en la Tarjeta de Jugador');
await page.screenshot({ path: join(shotsDir, 'colony-level8-cosmetics.png') });

console.log(`\nviewport ${VIEWPORT.width}x${VIEWPORT.height} · fallos: ${failures}`);
console.log(`errores de consola: ${errors.length ? errors.join(' | ') : 'ninguno'}`);
await browser.close();
process.exit(failures > 0 ? 1 : 0);
