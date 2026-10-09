/**
 * probe-colony.mjs — Verifica la UI de la Colonia Fungi (meta-progresion).
 *
 * Mide, en el viewport MOVIL (915x412 por defecto), que:
 *   1. el panel de Perfil muestre el nivel, las Esporas de Colonia y la barra;
 *   2. los CUATRO accesos (Recompensas / Personalizar / Logros / Historial)
 *      esten DENTRO de la ventana (no alcanza con que existan en el DOM: el
 *      smoke clickea con el mouse en el centro real del boton);
 *   3. el panel de Recompensas liste la escalera, marque las desbloqueadas como
 *      reclamables y RECLAME de verdad ("Reclamar todo" -> sobres + cosmeticos);
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
// `FF_POINTER=fine` corre con puntero de escritorio: el panel usa la rejilla
// `auto-fit` y conserva la linea de stats, asi que hay que poder mirarlo sin el
// bloque `@media (pointer: coarse)`.
const FINE = process.env.FF_POINTER === 'fine';
const VIEWPORT =
  process.env.FF_VIEWPORT === 'smoke'
    ? { width: 844, height: 390 }
    : process.env.FF_VIEWPORT === 'tablet'
      ? { width: 1180, height: 820 }
      : FINE
        ? { width: 1440, height: 810 }
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
const context = await browser.newContext({
  viewport: VIEWPORT,
  deviceScaleFactor: 2,
  isMobile: !FINE,
  hasTouch: !FINE,
});
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
  // 588 Esporas -> nivel 6 (umbral 500) con 88/200 dentro del nivel = 44%.
  // Los umbrales viven en `COLONY_LEVELS` (src/meta/Colony.ts): si se recalibran,
  // esta semilla y las aserciones de abajo se mueven juntas.
  profile.colony.lifetimeSpores = 588;
  profile.colony.level = 6;
  profile.colony.seasonSpores = 400;
  profile.colony.firstClears = ['1:0', '1:1', '2:0'];
  // Nivel 6 -> desbloqueadas las recompensas de los niveles 2..6 (5 ids).
  profile.colony.unlockedRewards = [
    'frame_common',
    'pack_spores',
    'bg_new',
    'title_mycelium',
    'victory_fx',
  ];
  profile.colony.claimedRewards = [];
  // Limpia sobres y cosmeticos para que el reclamo sea OBSERVABLE.
  profile.packs.pending = 0;
  profile.packs.expansionPending = 0;
  // El avatar (nivel 8) y el marco poco comun (nivel 9) se siembran como ya
  // poseidos para poder probar que su ARTE carga; el resto entra al reclamar.
  profile.cosmetics.owned = ['default', 'mycelial', 'avatar', 'frame_uncommon'];
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
    cards: ['colony-rewards', 'leaderboard', 'cosmetics', 'achievements', 'history'].map(card),
    accountBtn: card('account-unlink') ?? card('account-link'),
    sync: text('.panel.is-profile .profile-account-sync'),
    icon: Boolean(document.querySelector('.panel.is-profile .colony-icon')),
  };
});

console.log('--- PERFIL ---');
console.log(JSON.stringify(profile, null, 2));
check(Boolean(profile.spores && profile.spores.includes('/')), 'muestra las Esporas de Colonia', profile.spores ?? 'null');
check(Boolean(profile.level && /Nivel/i.test(profile.level)), 'muestra el nivel', profile.level ?? 'null');
check(profile.fill === '44%', 'la barra refleja el progreso (88/200)', profile.fill ?? 'null');
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
  const claimAll = document.querySelector('.panel.is-colony-rewards [data-act="colony-claim-all"]');
  return {
    total: rows.length,
    unlocked: rows.filter((x) => x.classList.contains('is-unlocked')).length,
    claimable: rows.filter((x) => x.classList.contains('is-claimable')).length,
    claimed: rows.filter((x) => x.classList.contains('is-claimed')).length,
    // Etiqueta de tipo (marco / titulo / fondo / efecto / sobre) por fila.
    kinds: rows.filter((x) => x.querySelector('.colony-reward-kind')).length,
    // Descripcion real (no la clave cruda, no el texto de costo de respaldo).
    descs: rows.filter((x) => {
      const d = x.querySelector('.colony-reward-desc:not(.is-empty)');
      const text = (d?.textContent ?? '').trim();
      return text.length > 4 && !text.startsWith('[');
    }).length,
    firstLevel: rows[0]?.dataset['level'] ?? null,
    lastLevel: rows[rows.length - 1]?.dataset['level'] ?? null,
    rawKeys: rows.filter((x) => /t\(['"]/.test(x.textContent ?? '')).length,
    claimAllDisabled: claimAll ? claimAll.disabled : null,
    closeInside: r ? r.top >= -1 && r.bottom <= window.innerHeight + 1 : false,
  };
});
console.log('--- RECOMPENSAS ---');
console.log(JSON.stringify(rewards, null, 2));
check(rewards.total === 10, 'la escalera lista 10 niveles', String(rewards.total));
check(rewards.unlocked === 6, 'marca los 6 niveles alcanzados', String(rewards.unlocked));
check(rewards.claimable === 5, 'las 5 recompensas desbloqueadas son reclamables', String(rewards.claimable));
check(rewards.claimed === 0, 'ninguna reclamada todavia', String(rewards.claimed));
check(rewards.kinds === 9, 'cada recompensa lleva su etiqueta de tipo', String(rewards.kinds));
check(rewards.descs === 9, 'cada recompensa explica que hace', String(rewards.descs));
check(rewards.rawKeys === 0, 'ninguna clave i18n sin resolver');
check(rewards.claimAllDisabled === false, '"Reclamar todo" esta habilitado');
check(rewards.closeInside, 'el boton Cerrar entra en la ventana');
await page.screenshot({ path: join(shotsDir, 'colony-rewards.png') });

// --- 2a. Reclamar todo ---
await click('.panel.is-colony-rewards [data-act="colony-claim-all"]');
await wait(600);
const claimed = await page.evaluate(() => {
  const rows = [...document.querySelectorAll('.panel.is-colony-rewards .colony-reward-row')];
  const p = window.__fungiflush.profileStore.current;
  const owned = ['frame_common', 'bg_new', 'title_mycelium', 'victory_fx'].filter((id) =>
    p.cosmetics.owned.includes(id),
  );
  return {
    claimed: rows.filter((x) => x.classList.contains('is-claimed')).length,
    claimable: rows.filter((x) => x.classList.contains('is-claimable')).length,
    basePending: p.packs.pending,
    expansionPending: p.packs.expansionPending,
    claimedIds: p.colony.claimedRewards.length,
    owned,
    // Reclamar NO equipa: el avatar sigue en 'default'.
    equippedAvatar: p.cosmetics.equippedAvatar,
  };
});
console.log('--- RECLAMAR TODO ---');
console.log(JSON.stringify(claimed, null, 2));
check(claimed.claimed === 5, 'las 5 recompensas pasan a "Reclamada"', String(claimed.claimed));
check(claimed.claimable === 0, 'ya no queda ninguna reclamable', String(claimed.claimable));
check(claimed.claimedIds === 5, 'el perfil registra los 5 ids reclamados', String(claimed.claimedIds));
check(claimed.basePending === 1, 'pack_spores -> 1 sobre base pendiente', String(claimed.basePending));
check(claimed.expansionPending === 0, 'pack_colony (nivel 7) todavia no se desbloqueo', String(claimed.expansionPending));
check(claimed.owned.length === 4, 'los 4 cosmeticos entran a `owned`', claimed.owned.join(', '));
check(claimed.equippedAvatar === 'default', 'reclamar NO equipa', claimed.equippedAvatar);
await page.screenshot({ path: join(shotsDir, 'colony-claimed.png') });

// --- 2b. Personalizar (Tarjeta de Jugador) ---
await page.evaluate(() => window.__fungiflush.hud.showProfile());
await page.waitForSelector('.panel.is-profile', { timeout: 8000 });
await wait(300);
await click('.panel.is-profile [data-act="cosmetics"]');
await page.waitForSelector('.panel.is-cosmetics', { timeout: 8000 });
await wait(400);
const cosmetics = await page.evaluate(() => {
  const panel = document.querySelector('.panel.is-cosmetics');
  const close = panel?.querySelector('[data-act="cosmetics-close"]');
  const r = close?.getBoundingClientRect();
  return {
    present: Boolean(panel),
    playerCard: Boolean(panel?.querySelector('.player-card')),
    sections: panel?.querySelectorAll('.cosmetics-section').length ?? 0,
    cards: panel?.querySelectorAll('.cosmetics-card').length ?? 0,
    // Los 4 cosmeticos reclamados tienen que aparecer como equipables.
    equipButtons: panel?.querySelectorAll('[data-act="cosmetic-equip"]').length ?? 0,
    rawKeys: /t\(['"]/.test(panel?.textContent ?? '') ? 1 : 0,
    closeInside: r ? r.bottom <= window.innerHeight + 1 : false,
  };
});
console.log('--- PERSONALIZAR ---');
console.log(JSON.stringify(cosmetics, null, 2));
check(cosmetics.present, 'el panel de Personalizar abre desde el Perfil');
check(cosmetics.playerCard, 'muestra la Tarjeta de Jugador');
check(cosmetics.sections === 7, 'una seccion por tipo de cosmetico', String(cosmetics.sections));
check(cosmetics.rawKeys === 0, 'ninguna clave i18n sin resolver');
check(cosmetics.closeInside, 'el boton Cerrar entra en la ventana');
await page.screenshot({ path: join(shotsDir, 'colony-cosmetics.png') });

// --- 2b-bis. Equipar la Tarjeta de Jugador (arte real) ---
// Se equipa clickeando los botones del panel (camino real, no se muta el perfil
// a mano). Cada click re-renderiza el panel, asi que se vuelve a consultar.
const equipCosmetic = async (kind, id) => {
  await click(`.panel.is-cosmetics [data-act="cosmetic-equip"][data-kind="${kind}"][data-id="${id}"]`);
  await wait(350);
};
await equipCosmetic('avatar', 'avatar');
await equipCosmetic('frame', 'frame_uncommon');
await equipCosmetic('background', 'bg_new');
await equipCosmetic('title', 'title_mycelium');

const equipped = await page.evaluate(() => {
  const loaded = (sel) => {
    const img = document.querySelector(`.panel.is-cosmetics ${sel}`);
    return img ? img.complete && img.naturalWidth > 0 : false;
  };
  return {
    avatarLoaded: loaded('.player-card-avatar-img'),
    frameLoaded: loaded('.player-card-frame'),
    bgLoaded: loaded('.player-card-bg'),
    title: document.querySelector('.panel.is-cosmetics .player-card-title')?.textContent?.trim() ?? null,
    profileAvatar: window.__fungiflush.profileStore.current.cosmetics.equippedAvatar,
    profileFrame: window.__fungiflush.profileStore.current.cosmetics.equippedFrame,
  };
});
console.log('--- TARJETA EQUIPADA ---');
console.log(JSON.stringify(equipped, null, 2));
check(equipped.profileAvatar === 'avatar', 'el avatar equipado se persiste', equipped.profileAvatar);
check(equipped.profileFrame === 'frame_uncommon', 'el marco equipado se persiste', equipped.profileFrame);
check(equipped.avatarLoaded, 'el arte del avatar CARGA en la tarjeta');
check(equipped.frameLoaded, 'el arte del marco CARGA en la tarjeta');
check(equipped.bgLoaded, 'el arte del fondo CARGA en la tarjeta');
check(equipped.title === 'Micelio Naciente', 'el titulo equipado se muestra', equipped.title ?? 'null');
await page.screenshot({ path: join(shotsDir, 'colony-playercard.png') });

// --- 2c. Ranking (V1.3) ---
await page.evaluate(() => {
  const ff = window.__fungiflush;
  ff.hud.showProfile();
});
await page.waitForSelector('.panel.is-profile', { timeout: 8000 });
await wait(300);
await click('.panel.is-profile [data-act="leaderboard"]');
await page.waitForSelector('.panel.is-leaderboard', { timeout: 8000 });
await wait(400);
const leaderboard = await page.evaluate(() => {
  const panel = document.querySelector('.panel.is-leaderboard');
  const close = panel?.querySelector('[data-act="leaderboard-close"]');
  const r = close?.getBoundingClientRect();
  return {
    present: Boolean(panel),
    tabs: [...(panel?.querySelectorAll('.leaderboard-tab') ?? [])].map((b) => b.textContent),
    milestones: panel?.querySelectorAll('.leaderboard-milestone').length ?? 0,
    rawKeys: /t\(['"]/.test(panel?.textContent ?? '') ? 1 : 0,
    closeInside: r ? r.bottom <= window.innerHeight + 1 : false,
  };
});
console.log('--- RANKING ---');
console.log(JSON.stringify(leaderboard, null, 2));
check(leaderboard.present, 'el panel de Ranking abre desde el Perfil');
check(leaderboard.tabs.length === 2, 'tiene los dos tableros (temporada / historica)', leaderboard.tabs.join(' · '));
check(leaderboard.milestones === 3, 'lista los 3 hitos personales', String(leaderboard.milestones));
check(leaderboard.rawKeys === 0, 'ninguna clave i18n sin resolver');
check(leaderboard.closeInside, 'el boton Cerrar del ranking entra en la ventana');
await page.screenshot({ path: join(shotsDir, 'colony-ranking.png') });

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
