/**
 * probe-ability-longpress.mjs — Verifica la etiqueta de habilidad en movil.
 *
 * Comprueba que:
 *   1. Mantener el dedo QUIETO sobre una carta (sin moverlo) muestra el tooltip.
 *      Antes el tooltip solo salia desde `pointermove` -> si el dedo no se
 *      movia, NUNCA aparecia.
 *   2. El tooltip NO queda debajo del dedo (en tactil se ancla arriba).
 *   3. Soltar NO selecciona la carta (el long-press es para LEER, no para jugar).
 *   4. Es repetible (10/10).
 *
 *   node tools/probe-ability-longpress.mjs
 *   FF_VIEWPORT=smoke node tools/probe-ability-longpress.mjs
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
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
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
await page.evaluate(() => window.__fungiflush.engine.chooseBlind());
await page.waitForFunction(() => (window.__fungiflush?.engine?.round?.hand?.length ?? 0) > 0, { timeout: 15000 });
await page.waitForTimeout(2500);

const hand = await page.evaluate(() => {
  const ff = window.__fungiflush;
  const round = ff.engine.round;
  const hs = ff.scene.handState();
  const byUid = new Map((round?.hand ?? []).map((c) => [c.uid, c]));
  return hs.map((h) => ({
    uid: h.uid,
    screenX: h.screenX,
    screenY: h.screenY,
    hasAbility: ((byUid.get(h.uid)?.def?.effects?.length) ?? 0) > 0,
    name: byUid.get(h.uid)?.def?.nameKey ?? null,
  }));
});
console.log('cartas en mano:', hand.length, '| con habilidad:', hand.filter((c) => c.hasAbility).length);
console.log(JSON.stringify(hand, null, 2));

// Si la mano no trae ninguna carta CON habilidad, se fuerza una: se inserta en
// el mazo (`'top'` = se roba la proxima) y se descarta una para que entre. Asi
// se verifica de verdad la marca ✦ y el bloque de habilidad del tooltip.
if (!hand.some((c) => c.hasAbility)) {
  const forced = await page.evaluate(() => {
    const ff = window.__fungiflush;
    // `poolOf` vive en el registry del CONTENIDO (`content` es una facade).
    const def = ff.content.registry.poolOf('card').find((d) => (d.effects?.length ?? 0) > 0);
    if (!def) return null;
    const inst = ff.engine.registry.instantiate(def.id);
    ff.engine.run.deck.insert(inst, 'top');
    const uid = ff.engine.round.hand[0]?.uid;
    if (uid) { ff.engine.toggleSelect(uid); ff.engine.discardSelected(); }
    return { id: def.id, uid: inst.uid };
  });
  console.log('carta con habilidad forzada a la mano:', JSON.stringify(forced));
  await page.waitForTimeout(1800);
  const refreshed = await page.evaluate(() => {
    const ff = window.__fungiflush;
    const round = ff.engine.round;
    const byUid = new Map((round?.hand ?? []).map((c) => [c.uid, c]));
    return ff.scene.handState().map((h) => ({
      uid: h.uid, screenX: h.screenX, screenY: h.screenY,
      hasAbility: ((byUid.get(h.uid)?.def?.effects?.length) ?? 0) > 0,
      name: byUid.get(h.uid)?.def?.nameKey ?? null,
    }));
  });
  hand.length = 0;
  hand.push(...refreshed);
  console.log('mano tras el descarte:', hand.map((c) => `${c.uid}${c.hasAbility ? ' [HAB]' : ''}`).join(', '));
}

const target = hand.find((c) => c.hasAbility) ?? hand[Math.floor(hand.length / 2)];
if (!target) { console.error('No hay cartas en la mano.'); await browser.close(); process.exit(1); }
console.log('objetivo:', target.uid, '| habilidad:', target.hasAbility);

/** Un long-press real: bajar, esperar QUIETO, soltar. */
async function longPress(card, holdMs = 600) {
  await page.touchscreen.tap(0, 0).catch(() => {});
  await page.mouse.move(card.screenX, card.screenY);
  await page.mouse.down();
  await page.waitForTimeout(holdMs);
  const during = await page.evaluate(() => {
    const el = document.querySelector('.hud-tooltip');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return {
      visible: el.classList.contains('is-visible'),
      top: Math.round(r.top), bottom: Math.round(r.bottom),
      left: Math.round(r.left), right: Math.round(r.right),
      h: Math.round(r.height), w: Math.round(r.width),
      // La marca ✦ de habilidad vive junto al nombre (ya no hay banda violeta
      // aparte: el lila marca la descripcion misma).
      hasAbilityBlock: Boolean(el.querySelector('[data-act="tooltip-ability"]')),
      hasTaxonomy: Boolean(el.querySelector('.tooltip-taxonomy')),
      hasRarity: Boolean(el.querySelector('.tooltip-rarity')),
      text: el.textContent?.slice(0, 70) ?? '',
    };
  });
  await page.mouse.up();
  await page.waitForTimeout(250);
  const after = await page.evaluate(() => ({
    visible: document.querySelector('.hud-tooltip')?.classList.contains('is-visible') ?? false,
    selected: window.__fungiflush.engine.round?.selected ?? [],
  }));
  return { during, after };
}

// --- 1. Long-press y medicion ---
const first = await longPress(target);
console.log('\n[long-press] durante:', JSON.stringify(first.during, null, 2));
console.log('[long-press] despues (seleccion):', JSON.stringify(first.after));

await page.mouse.move(target.screenX, target.screenY);
await page.mouse.down();
await page.waitForTimeout(600);
await page.screenshot({ path: join(shotsDir, 'ability-longpress.png') });
await page.mouse.up();
await page.waitForTimeout(250);

// Zoom de la carta objetivo: es donde se ve la marca ✦ del nombre.
await page.screenshot({
  path: join(shotsDir, 'ability-card-zoom.png'),
  clip: {
    x: Math.max(0, target.screenX - 90),
    y: Math.max(0, target.screenY - 110),
    width: 190,
    height: 220,
  },
});

// --- 2. Repetibilidad (10 intentos) ---
let ok = 0;
const fails = [];
for (let i = 0; i < 10; i++) {
  const r = await longPress(target, 500);
  if (r.during?.visible) ok++;
  else fails.push(i);
  // Un tap normal entre medio, para comprobar que el tap sigue seleccionando.
  if (i === 4) {
    await page.mouse.click(target.screenX, target.screenY);
    await page.waitForTimeout(200);
  }
}
console.log(`\n[repetibilidad] tooltip visible en ${ok}/10 intentos. Fallos: ${fails.length ? fails.join(',') : 'ninguno'}`);

const tapCheck = await page.evaluate(() => ({
  selected: window.__fungiflush.engine.round?.selected ?? [],
}));
console.log('[tap normal] seleccionadas:', JSON.stringify(tapCheck.selected));

// --- 3. Arrastre sigue funcionando (no lo rompio el long-press) ---
const beforeDrag = await page.evaluate(() => window.__fungiflush.engine.round?.selected?.length ?? 0);
await page.mouse.move(target.screenX, target.screenY);
await page.mouse.down();
await page.mouse.move(target.screenX, target.screenY + 90, { steps: 12 });
await page.waitForTimeout(200);
await page.mouse.up();
await page.waitForTimeout(400);
const afterDrag = await page.evaluate(() => ({
  selected: window.__fungiflush.engine.round?.selected?.length ?? 0,
  discardsLeft: window.__fungiflush.engine.round?.discardsLeft ?? null,
}));
console.log('[arrastre] seleccionadas antes/despues:', beforeDrag, '/', afterDrag.selected, '| descartes restantes:', afterDrag.discardsLeft);

// --- 4. Glow de seleccion: se eligen 3 cartas y se captura la mano ---
await page.evaluate(() => window.__fungiflush.engine.clearSelection());
for (const c of hand.slice(0, 3)) {
  await page.mouse.click(c.screenX, c.screenY);
  await page.waitForTimeout(160);
}
await page.waitForTimeout(700);
const quality = await page.evaluate(() => window.__fungiflush.scene?.tier ?? 'n/a');
await page.screenshot({ path: join(shotsDir, 'glow-selected.png') });
console.log('[glow] quality del run headless:', quality, '| seleccionadas:', hand.slice(0, 3).length);

console.log('\nerrores de consola:', errors.length ? errors.slice(0, 5) : 'ninguno');
await browser.close();
console.log('Shots: tools/shots/ability-longpress.png, ability-card-zoom.png, glow-selected.png');
