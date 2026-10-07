/**
 * probe-card-states.mjs — Animacion de los estados de carta (P2.6).
 *
 * QUE VERIFICA
 * ------------
 *   1. AMBIENTAL: mientras una carta de la mano tiene `decay`, su aura de
 *      putrefaccion (`uRot` del material del halo) esta encendida y respira.
 *   2. SE APAGA SOLA: al quitarle el estado, `uRot` vuelve a 0 sin ningun aviso
 *      (el loop lo recalcula desde `card.statuses` en cada frame).
 *   3. COSECHA: `status:consumed` levanta particulas y mete un hit-stop corto.
 *   4. `reduceMotion` APAGA el ambiental (queda solo el latido del evento).
 *
 * COMO OBSERVA: `uRot` vive en los uniforms del material del halo. `handCards`
 * y `haloMaterial` son privados en TS, pero `private` se borra en runtime, asi
 * que desde el navegador se llega igual.
 *
 *   node tools/probe-card-states.mjs
 *   FF_VIEWPORT=smoke node tools/probe-card-states.mjs
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

/** Lee el aura de putrefaccion de una carta de la mano + el estado del render. */
const readState = (uid) =>
  page.evaluate((u) => {
    const ff = window.__fungiflush;
    const card = ff.scene.handCards?.get(u) ?? null;
    const uniforms = card?.haloMaterial?.uniforms ?? null;
    return {
      found: Boolean(card),
      rot: uniforms ? Number(uniforms['uRot'].value.toFixed(3)) : null,
      statuses: (card?.card?.statuses ?? []).map((s) => s.type),
      particles: ff.scene.particles?.activeCount ?? null,
      hitStop: Number((ff.scene.hitStopLeft ?? 0).toFixed(3)),
    };
  }, uid);

// --- Llegar a la mesa con cartas en la mano ---
await page.goto(URL_TO_TEST, { waitUntil: 'load', timeout: 45000 });
await page.waitForFunction(() => Boolean(window.__fungiflush?.engine?.run), { timeout: 30000 });
await wait(1800);
await click('[data-act="tutorial-close"]');
await wait(300);
await click('.panel.is-menu [data-act="new"]');
await wait(700);
if (await has('.panel.is-archetypes')) {
  await click('[data-act="archetypes-start"]');
  await wait(1400);
}
await click('[data-act="tutorial-close"]');
await wait(400);
await page.evaluate(() => {
  const ff = window.__fungiflush;
  ff.engine.chooseBlind(ff.engine.availableBlinds()[0]?.id);
});
await page.waitForFunction(() => (window.__fungiflush?.engine?.round?.hand?.length ?? 0) > 0, { timeout: 15000 });
await wait(1200);

/**
 * Espera a que el aura de una carta llegue a un valor (o lo cruce).
 *
 * Se POLEA con `waitForFunction` y no se duerme un tiempo fijo: a ~12 FPS de
 * SwiftShader un `waitForTimeout(400)` puede caer entre frames, y una captura de
 * pantalla previa puede congelar el compositor. Es la trampa de flake ya
 * documentada en el proyecto.
 */
async function waitRot(uid, predicate, timeout = 8000) {
  return page
    .waitForFunction(
      ({ u, src }) => {
        const ff = window.__fungiflush;
        const card = ff.scene.handCards?.get(u);
        if (!card) return false;
        const rot = card.haloMaterial.uniforms['uRot'].value;
        // eslint-disable-next-line no-new-func
        return new Function('rot', `return (${src});`)(rot);
      },
      { u: uid, src: predicate },
      { timeout },
    )
    .then(() => true)
    .catch(() => false);
}

// La carta de la mano y la que dibuja el render son EL MISMO objeto, asi que
// empujar el estado alcanza: el loop lo lee en el proximo frame.
const uid = await page.evaluate(() => {
  const ff = window.__fungiflush;
  const card = ff.engine.round.hand[0];
  card.statuses.push({ type: 'decay', value: 2, turnsLeft: -1 });
  return card.uid;
});

const turnedOn = await waitRot(uid, 'rot > 0.1');
const withRot = await readState(uid);
console.log('--- con putrefaccion ---');
console.log(JSON.stringify(withRot));
check(withRot.found, 'la carta esta en la mano del render');
check(withRot.statuses.includes('decay'), 'la carta tiene el estado decay');
check(turnedOn, 'el aura de putrefaccion esta ENCENDIDA', `uRot=${withRot.rot}`);

// El aura RESPIRA: el valor tiene que moverse solo con el estado puesto.
const rotA = withRot.rot ?? 0;
const moved = await page
  .waitForFunction(
    ({ u, from }) => {
      const ff = window.__fungiflush;
      const card = ff.scene.handCards?.get(u);
      if (!card) return false;
      return Math.abs(card.haloMaterial.uniforms['uRot'].value - from) > 0.01;
    },
    { u: uid, from: rotA },
    { timeout: 4000 },
  )
  .then(() => true)
  .catch(() => false);
check(moved, 'el aura respira (el valor se mueve solo)');
await page.screenshot({ path: join(shotsDir, 'probe-card-rot.png') });

// --- Se apaga SOLA al quitarle el estado ---
await page.evaluate((u) => {
  const ff = window.__fungiflush;
  const card = ff.scene.handCards.get(u)?.card;
  if (card) card.statuses = card.statuses.filter((s) => s.type !== 'decay');
}, uid);
const turnedOff = await waitRot(uid, 'rot === 0');
const cleared = await readState(uid);
console.log('--- tras quitar el estado ---');
console.log(JSON.stringify(cleared));
check(turnedOff, 'al quitar el estado el aura se APAGA sola', `uRot=${cleared.rot}`);

// --- COSECHA: particulas + hit-stop ---
const before = await readState(uid);
// El hit-stop dura 70ms y a ~12 FPS (SwiftShader) se consume en un frame, asi que
// muestrear por round-trip lo pierde. Se muestrea desde ADENTRO, por rAF.
await page.evaluate(() => {
  const ff = window.__fungiflush;
  window.__maxHit = 0;
  window.__sampling = true;
  const tick = () => {
    if (window.__sampling) window.__maxHit = Math.max(window.__maxHit, ff.scene.hitStopLeft ?? 0);
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
});
await page.evaluate((u) => {
  window.__fungiflush.bus.emit('status:consumed', {
    uid: u,
    status: 'decay',
    stacks: 3,
    gainKind: 'spores',
    sourceId: 'probe',
  });
}, uid);
await wait(500);
const maxHit = await page.evaluate(() => {
  window.__sampling = false;
  return Number(window.__maxHit.toFixed(3));
});
const after = await readState(uid);
console.log('--- cosecha ---');
console.log(JSON.stringify({ before: before.particles, after: after.particles, maxHit }));
check(
  (after.particles ?? 0) > (before.particles ?? 0),
  'la cosecha levanta particulas',
  `${before.particles} -> ${after.particles}`,
);
check(maxHit > 0, 'la cosecha mete un hit-stop corto', `maxHit=${maxHit}`);

// --- reduceMotion APAGA el ambiental ---
await page.evaluate((u) => {
  const ff = window.__fungiflush;
  const card = ff.scene.handCards.get(u)?.card;
  if (card) card.statuses.push({ type: 'decay', value: 2, turnsLeft: -1 });
  ff.scene.setMode('run', { reduceMotion: true });
}, uid);
// Se espera la CONDICION (estado presente + aura apagada), no un tiempo fijo.
const reducedSettled = await page
  .waitForFunction(
    (u) => {
      const ff = window.__fungiflush;
      const card = ff.scene.handCards?.get(u);
      if (!card) return false;
      const hasDecay = (card.card?.statuses ?? []).some((s) => s.type === 'decay');
      return hasDecay && card.haloMaterial.uniforms['uRot'].value === 0;
    },
    uid,
    { timeout: 8000 },
  )
  .then(() => true)
  .catch(() => false);
const reduced = await readState(uid);
console.log('--- reduceMotion ---');
console.log(JSON.stringify(reduced));
check(reducedSettled, 'con reduceMotion el ambiental queda en 0', `uRot=${reduced.rot}`);
check(reduced.statuses.includes('decay'), 'el estado SIGUE en la carta (no se pierde informacion)');

console.log('---');
console.log(`viewport ${VIEWPORT.width}x${VIEWPORT.height} · fallos: ${failures}`);
console.log('errores de consola:', errors.length ? errors.slice(0, 5) : 'ninguno');
if (errors.length) failures += 1;
await browser.close();
process.exit(failures > 0 ? 1 : 0);
