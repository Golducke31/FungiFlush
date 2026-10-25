/**
 * probe-issues-56.mjs — Reproduce y medir Issues #5 (misiones) y #6 (sharedFamily)
 *
 *  #5: El chip que abre el cajon de misiones vive arriba a la izquierda y tiene
 *      z-index 30, asi que se pinta POR ENCIMA del cajon. Sin relleno, el titulo
 *      y el primer chip de misiones nacian debajo del chip y su texto quedaba
 *      tapado. Medimos si el contenido del cajon (titulo + 1er chip) se solapa
 *      geometricamente con el chip despues de abrir.
 *
 *  #6: La guia "comparte familia" flota sobre la mano. Proyectamos los bordes
 *      reales de las cartas de la mano (WebGL) a pantalla y comprobamos si la
 *      guia se solapa con alguna carta.
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
const PORTRAIT = process.env.FF_PORTRAIT === '1';
const W = Number(process.env.FF_W) || (PORTRAIT ? 412 : 915);
const H = Number(process.env.FF_H) || (PORTRAIT ? 915 : 412);

const browser = await chromium.launch({
  executablePath: exe, headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--disable-dev-shm-usage'],
});
const context = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
const page = await context.newPage();
page.on('console', (m) => { if (m.type() === 'error') console.log('  [console.error]', m.text()); });
page.on('pageerror', (e) => console.log('  [pageerror]', e.message));

await page.goto(URL_TO_TEST, { waitUntil: 'load', timeout: 45000 });
await page.waitForFunction(() => Boolean(window.__fungiflush?.engine?.run), { timeout: 30000 });
await page.waitForTimeout(1200);

const click = (sel) => page.evaluate((s) => document.querySelector(s)?.click(), sel);
const rectOf = (sel) => page.evaluate((s) => {
  const el = document.querySelector(s);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), bottom: Math.round(r.bottom), top: Math.round(r.top), right: Math.round(r.right), left: Math.round(r.left) };
}, sel);
const overlaps = (a, b) => {
  if (!a || !b) return false;
  return !(a.right <= b.left || a.left >= b.right || a.bottom <= b.top || a.top >= b.bottom);
};

console.log(`\n=== VIEWPORT ${W}x${H} (${PORTRAIT ? 'portrait' : 'landscape'}) ===`);

// Iniciar run y entrar a JUGANDO (cierra el panel blind_select y muestra el toggle).
// R3 — el borrador de bendicion se resuelve con la primera oferta antes de elegir ciego.
await page.evaluate(() => {
  const ff = window.__fungiflush;
  ff.engine.startRun();
  const d = ff.engine.currentDraft;
  if (d?.offers?.length) ff.engine.chooseDraft(d.offers[0].id);
  ff.engine.chooseBlind();
});
await page.waitForTimeout(900);

// ---------------- ISSUE 5: misiones ----------------
console.log('\n--- ISSUE 5: misiones (toggle vs panel) ---');
await page.evaluate(() => {
  const ff = window.__fungiflush;
  const eng = ff.engine;
  const defs = eng.missionDefs ?? [];
  if (defs.length >= 2) {
    eng.run.missions = [
      { id: defs[0].id, progress: 0, completed: false },
      { id: defs[1].id, progress: 0, completed: false },
    ];
  } else { eng.rollMissions?.(); }
  ff.hud.refreshPanel();
});
await page.waitForTimeout(300);
console.log('  toggle is-visible:', await page.evaluate(() => Boolean(document.querySelector('.hud-missions-toggle.is-visible'))));
// Abrir el panel (toggle is-open -> translateX(0)).
await click('[data-act="missions-toggle"]');
await page.waitForTimeout(450); // esperar transicion 0.22s
// Medir TODO en un solo evaluate para evitar que un re-render del HUD reemplace
// el nodo del panel y pierda el inline style que fuerza la geometria abierta.
const m5 = await page.evaluate(() => {
  const rect = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), top: Math.round(r.top), bottom: Math.round(r.bottom), left: Math.round(r.left), right: Math.round(r.right) }; };
  const panel = document.querySelector('.hud-missions-panel');
  const nodeCount = document.querySelectorAll('.hud-missions-panel').length;
  if (panel) { panel.classList.add('is-open'); panel.style.transition = 'none'; panel.style.transform = 'translateX(0)'; }
  const toggle = document.querySelector('.hud-missions-toggle');
  const title = panel?.querySelector('.hud-missions-title');
  const chip = panel?.querySelector('.mission-chip');
  return {
    nodeCount,
    toggle: rect(toggle), panel: rect(panel), title: rect(title), chip: rect(chip),
    panelInline: panel?.getAttribute('style'), panelHasIsOpen: panel?.classList.contains('is-open'),
  };
});
console.log('  nodeCount:', m5.nodeCount);
console.log('  toggle:', JSON.stringify(m5.toggle));
console.log('  panel :', JSON.stringify(m5.panel));
console.log('  title :', JSON.stringify(m5.title));
console.log('  chip  :', JSON.stringify(m5.chip));
console.log('  panel abierto (x≈0)?', m5.panel && m5.panel.x > -5 && m5.panel.x < 5);
console.log('  SOLAPAN toggle y title:', overlaps(m5.toggle, m5.title));
console.log('  SOLAPAN toggle y 1er chip:', overlaps(m5.toggle, m5.chip));
console.log('  chip.top > toggle.bottom (contenido debajo del chip)?', m5.chip && m5.toggle && m5.chip.top >= m5.toggle.bottom - 1);
await page.screenshot({ path: 'tools/shots/issues-5-missions.png' });
// Cerrar
await click('[data-act="missions-toggle"]');
await page.waitForTimeout(300);

// ---------------- ISSUE 6: sharedFamily ----------------
console.log('\n--- ISSUE 6: sharedFamily hint vs cartas reales ---');
const fam = await page.evaluate(() => {
  const ff = window.__fungiflush;
  const round = ff.engine.round;
  if (!round) return { ok: false, reason: 'no round' };
  const byFam = {};
  for (const c of round.hand) { const f = c.def.family; (byFam[f] = byFam[f] || []).push(c.uid); }
  const fams = Object.entries(byFam).filter(([, uids]) => uids.length >= 2);
  if (fams.length === 0) return { ok: false, reason: 'no same-family pair', byFam };
  const [famName, uids] = fams[0];
  for (const uid of uids.slice(0, 2)) ff.engine.toggleSelect(uid);
  return { ok: true, fam: famName, selected: uids.slice(0, 2), handLen: round.hand.length };
});
console.log('  select:', JSON.stringify(fam));
await page.waitForTimeout(500);
const hint = await rectOf('.hud-select-hint');
console.log('  hint  :', JSON.stringify(hint));

// Proyectar bordes reales de la mano (WebGL) a pantalla usando la camara.
const cardBoxes = await page.evaluate(() => {
  const scene = window.__fungiflush.scene;
  const cam = scene.rig.camera;
  const canvas = scene.renderer.domElement;
  const w = canvas.clientWidth || 1;
  const h = canvas.clientHeight || 1;
  const CW = 2.2, CH = 3.2;
  const toPx = (p) => ({ x: (p.x * 0.5 + 0.5) * w, y: (-p.y * 0.5 + 0.5) * h });
  const boxes = [];
  for (const c of scene.handCards.values()) {
    const s = c.scale || 1;
    const center = c.worldPosition();
    const top = center.clone(); top.y += (CH / 2) * s; top.project(cam);
    const bot = center.clone(); bot.y -= (CH / 2) * s; bot.project(cam);
    const lft = center.clone(); lft.x -= (CW / 2) * s; lft.project(cam);
    const rgt = center.clone(); rgt.x += (CW / 2) * s; rgt.project(cam);
    const tp = toPx(top), bp = toPx(bot), lp = toPx(lft), rp = toPx(rgt);
    boxes.push({ uid: c.uid, x: Math.min(lp.x, rp.x), y: Math.min(tp.y, bp.y), right: Math.max(lp.x, rp.x), bottom: Math.max(tp.y, bp.y) });
  }
  return boxes;
});
console.log('  hand card boxes (px):');
for (const b of cardBoxes) console.log('    ', JSON.stringify(b));
// ¿El hint se solapa con alguna carta?
let hintOverlap = false;
let overlapUid = null;
for (const b of cardBoxes) { if (overlaps(hint, b)) { hintOverlap = true; overlapUid = b.uid; break; } }
console.log('  SOLAPA hint con alguna carta:', hintOverlap, overlapUid ? `(uid ${overlapUid})` : '');
// Rango vertical de la mano y del hint
const handTop = cardBoxes.length ? Math.min(...cardBoxes.map((b) => b.y)) : null;
const handBottom = cardBoxes.length ? Math.max(...cardBoxes.map((b) => b.bottom)) : null;
console.log('  mano y-range:', handTop, '->', handBottom, '| hint y-range:', hint && hint.top, '->', hint && hint.bottom);
await page.screenshot({ path: 'tools/shots/issues-6-family.png' });

await browser.close();
console.log('\nListo.');
