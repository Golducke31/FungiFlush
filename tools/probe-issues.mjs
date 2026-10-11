/**
 * probe-issues.mjs — Diagnostico temporal de los 6 reportes.
 */
import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

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

const URL_TO_TEST = process.env.FF_URL ?? 'http://127.0.0.1:1420/?daily=0&quality=high';
const browser = await chromium.launch({
  executablePath: exe, headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--disable-dev-shm-usage'],
});
const context = await browser.newContext({ viewport: { width: 915, height: 412 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
const page = await context.newPage();
page.on('console', (m) => { if (m.type() === 'error') console.log('  [console.error]', m.text()); });
page.on('pageerror', (e) => console.log('  [pageerror]', e.message));
// Log de requests fallidos
page.on('requestfailed', (r) => console.log('  [reqfail]', r.url(), r.failure()?.errorText));
page.on('response', (r) => { if (r.status() >= 400) console.log('  [http' + r.status() + ']', r.url()); });

await page.goto(URL_TO_TEST, { waitUntil: 'load', timeout: 45000 });
await page.waitForFunction(() => Boolean(window.__fungiflush?.engine?.run), { timeout: 30000 });
await page.waitForTimeout(1500);

const click = (sel) => page.evaluate((s) => document.querySelector(s)?.click(), sel);

console.log('\n=== ISSUE 2: avatar de colonia ===');
await click('[data-act="tutorial-close"]');
await page.waitForTimeout(500);
// Ir a cosmeticos: abrir menu si hace falta
await page.evaluate(() => {
  const ff = window.__fungiflush;
  ff.engine.run.status = 'menu';
  ff.hud.lastStatus = null;
  ff.hud.refreshPanel();
});
await page.waitForTimeout(600);
// Simular el perfil del usuario: nivel 9, avatar desbloqueado y equipado.
await page.evaluate(() => {
  const ff = window.__fungiflush;
  const c = ff.profileStore.current.cosmetics;
  if (!c.owned.includes('avatar')) c.owned.push('avatar');
  c.equippedAvatar = 'avatar';
  ff.profileStore.current.colony.level = 9;
  ff.profileStore.current.colony.spores = 1300;
  ff.syncCosmetics();
});
await page.waitForTimeout(400);
// Abrir el panel de perfil, que contiene la tarjeta "Cosmetics"
await page.evaluate(() => document.querySelector('#ui-root [data-act="profile"]')?.click());
await page.waitForTimeout(600);
const cosBtn = await page.evaluate(() => {
  const el = document.querySelector('#ui-root [data-act="cosmetics"]');
  if (el) { el.click(); return true; }
  return false;
});
console.log('  boton cosmetics encontrado:', cosBtn);
await page.waitForTimeout(900);
const cosInfo = await page.evaluate(() => {
  const panel = document.querySelector('.panel.is-cosmetics');
  if (!panel) return { ok: false };
  const section = panel.querySelector('.cosmetics-section[data-kind="avatar"]');
  const cards = section ? [...section.querySelectorAll('.cosmetics-card')] : [];
  return {
    ok: true,
    equippedAvatar: window.__fungiflush.profileStore.current.cosmetics.equippedAvatar,
    owned: window.__fungiflush.profileStore.current.cosmetics.owned,
    level: window.__fungiflush.profileStore.current.colony.level,
    sectionFound: Boolean(section),
    cardIds: cards.map((c) => c.dataset.id),
    thumbs: cards.map((c) => {
      const img = c.querySelector('.cosmetics-thumb');
      return img ? { src: img.getAttribute('src'), complete: img.complete, w: img.naturalWidth, h: img.naturalHeight } : null;
    }),
  };
});
console.log(' ', JSON.stringify(cosInfo, null, 2));

// Preview player card
const previewInfo = await page.evaluate(() => {
  const img = document.querySelector('.panel.is-cosmetics .player-card-avatar-img');
  return img ? { src: img.getAttribute('src'), complete: img.complete, w: img.naturalWidth, h: img.naturalHeight } : 'sin avatar img';
});
console.log('  preview player-card avatar:', JSON.stringify(previewInfo));
await page.screenshot({ path: 'tools/shots/issues-2-cosmetics.png' });

console.log('\n=== ISSUE 3: panel de ciego jefe (cortado) ===');
await page.evaluate(() => document.querySelector('[data-act="cosmetics-close"]')?.click());
await page.waitForTimeout(400);
// Forzar un ciego JEFE: setear blindIndex al boss (2) y abrir blind select
const blindInfo = await page.evaluate(() => {
  const ff = window.__fungiflush;
  const eng = ff.engine;
  const blinds = eng.availableBlinds();
  const bossIdx = blinds.findIndex((b) => (b.effects?.length ?? 0) > 0);
  eng.run.blindIndex = bossIdx >= 0 ? bossIdx : 2;
  eng.run.status = 'blind_select';
  eng.run.phase = 'blind_select';
  eng.run.interludeModifiers = { targetMultiplier: 1.15 };
  ff.hud.refreshPanel();
  return { bossIdx, blinds: blinds.map((b) => ({ id: b.id, tier: b.tier, effects: b.effects?.length ?? 0 })) };
});
console.log('  blinds:', JSON.stringify(blindInfo));
await page.waitForTimeout(800);
const panelMetrics = await page.evaluate(() => {
  const p = document.querySelector('.panel.is-blind-select');
  if (!p) return { ok: false };
  const body = p.querySelector('.blind-body');
  const actions = p.querySelector('.panel-actions');
  const r = p.getBoundingClientRect();
  return {
    ok: true,
    panel: { w: Math.round(r.width), h: Math.round(r.height), top: Math.round(r.top), bottom: Math.round(r.bottom) },
    viewport: { w: window.innerWidth, h: window.innerHeight },
    scrollH: p.scrollHeight,
    clientH: p.clientHeight,
    needsScroll: p.scrollHeight > p.clientHeight + 1,
    bodyScrollH: body?.scrollHeight,
    bodyClientH: body?.clientHeight,
    bodyNeedsScroll: body ? body.scrollHeight > body.clientHeight + 1 : null,
    actionsBottom: actions ? Math.round(actions.getBoundingClientRect().bottom) : null,
    titleW: Math.round(p.querySelector('.panel-title')?.getBoundingClientRect().width ?? 0),
    cardW: Math.round(p.querySelector('.blind-focus .blind-card')?.getBoundingClientRect().width ?? 0),
  };
});
console.log(' ', JSON.stringify(panelMetrics, null, 2));
await page.screenshot({ path: 'tools/shots/issues-3-blind-boss.png' });

console.log('\n=== ISSUE 4: reward panel (cartas chicas) ===');
await page.evaluate(() => {
  const ff = window.__fungiflush;
  const eng = ff.engine;
  eng.run.status = 'reward';
  eng.run.phase = 'reward';
  // Construir ofertas reales de recompensa
  const mk = (i, refId, rarity) => ({
    id: 'o' + i, kind: 'card', refId, nameKey: 'card.' + refId + '.name', descKey: 'card.' + refId + '.desc',
    cost: 3, sold: false, rarity,
    art: { element: 'mycelium', rarity, art: ('art/card_own_' + refId + '.webp') },
  });
  try { eng.reward = { offers: [mk(1, 'boletus_root', 'common'), mk(2, 'amanita_web', 'uncommon'), mk(3, 'clavaria_filament', 'rare')], pick: 1, allowSkip: true }; }
  catch (e) { console.log('mk fallo:', e.message); }
  ff.hud.lastStatus = null;
  ff.hud.showReward();
});
await page.waitForTimeout(600);
// Puede aparecer el aviso de "cleared" primero; saltarlo
await page.evaluate(() => {
  const panel = document.querySelector('.panel.is-reward, .panel.is-cleared');
  const btn = panel?.querySelector('[data-act="continue"], [data-act="pick"]');
  if (document.querySelector('.panel.is-cleared') && btn) btn.click();
});
await page.waitForTimeout(700);
await page.evaluate(() => {
  const ff = window.__fungiflush;
  if (!document.querySelector('.panel.is-reward')) ff.hud.showReward();
});
await page.waitForTimeout(700);
const offerMetrics = await page.evaluate(() => {
  const panel = document.querySelector('.panel.is-reward');
  if (!panel) return { ok: false, html: document.querySelector('#ui-root')?.innerHTML?.slice(0, 800) };
  const grid = panel.querySelector('.offer-grid');
  const cards = [...panel.querySelectorAll('.offer')];
  return {
    ok: true,
    panelH: Math.round(panel.getBoundingClientRect().height),
    gridW: grid ? Math.round(grid.getBoundingClientRect().width) : null,
    gridH: grid ? Math.round(grid.getBoundingClientRect().height) : null,
    cols: grid ? getComputedStyle(grid).gridTemplateColumns : null,
    rows: grid ? getComputedStyle(grid).gridAutoRows : null,
    numOffers: cards.length,
    cards: cards.map((c) => {
      const r = c.getBoundingClientRect();
      const art = c.querySelector('.offer-art');
      const artR = art?.getBoundingClientRect();
      return { w: Math.round(r.width), h: Math.round(r.height), artW: artR ? Math.round(artR.width) : null, artH: artR ? Math.round(artR.height) : null };
    }),
  };
});
console.log(' ', JSON.stringify(offerMetrics, null, 2));
await page.screenshot({ path: 'tools/shots/issues-4-reward.png' });

await browser.close();
console.log('\nListo.');
