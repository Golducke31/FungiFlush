/**
 * probe-leak.mjs — 20 manos seguidas sin fugas (V5, cierre de animaciones).
 *
 * Juega manos de verdad (seleccion greedy, recompensas, compras, interludios,
 * modo infinito) y comprueba que el estado del render VUELVE A REPOSO y no
 * crece:
 *   1. Al terminar cada mano todo efecto queda en cero: particulas, tweens
 *      (los dos motores), anillos, estelas, hit-stop y pulso de fondo.
 *   2. `renderer.info.memory` (geometrias/texturas de GPU) no crece entre la
 *      mano 3 y la mano 20: una fuga de materiales o de geometrias subiria
 *      sin techo (cada carta crea 4-5 materiales propios).
 *      Las texturas SI crecen de forma legitima y hay que descontarla: cada
 *      ARCHIVO de arte nuevo cuesta 3 (capa de arte + normal map + height
 *      map, las tres compartidas por `art.src`) y cada ESTADO de carta nuevo
 *      cuesta 1 (capa de texto, keyeada por bonus/estados). El detector es el
 *      RESIDUO: lo que crece sin que cambie ninguna cache. Eso tiene que ser
 *      ~0 (medido: residuo 0 en low, con 2 texturas fijas de fondo).
 *   3. `.hud-popups` no crece: los numeros flotantes se autodestruyen y el
 *      contenedor tiene que quedar vacio en reposo.
 *   4. Fase 2 en `medium` (donde vive el composer y el PunchPass de V4):
 *      3 manos mas sin crecimiento — los render targets del composer se
 *      reusan, no se acumulan.
 *   5. 0 errores de consola.
 *
 * La corrida es en `low` (la deteccion de SwiftShader) salvo la fase 2: a
 * `medium` el reloj de juego corre ~10x mas lento en real y 20 manos no
 * terminarian. El camino del composer ya queda cubierto por probe-punch.
 *
 *   node tools/probe-leak.mjs
 */
import { existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const URL_TO_TEST = process.env.FF_URL ?? 'http://127.0.0.1:1420/?daily=0';
const HANDS = Number(process.env.FF_HANDS ?? 20);
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

const browser = await chromium.launch({
  executablePath: exe, headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--disable-dev-shm-usage'],
});
const context = await browser.newContext({ viewport: { width: 915, height: 412 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const page = await context.newPage();
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

await page.goto(URL_TO_TEST, { waitUntil: 'load', timeout: 45000 });
await page.waitForFunction(() => Boolean(window.__fungiflush?.engine?.run), { timeout: 30000 });
await page.waitForTimeout(1800);

const click = (sel) => page.evaluate((s) => document.querySelector(s)?.click(), sel);

// --- Entrar a una partida ---
await click('[data-act="tutorial-close"]');
await click('.panel.is-menu [data-act="new"]');
await page.waitForTimeout(700);
await page.evaluate(() => document.querySelector('[data-act="archetypes-start"]')?.click());
await page.waitForTimeout(1400);
await click('[data-act="tutorial-close"]');
await page.evaluate(() => window.__fungiflush.engine.chooseBlind());
await page.waitForFunction(() => (window.__fungiflush?.engine?.round?.hand?.length ?? 0) > 0, { timeout: 15000 });
await page.waitForTimeout(1500);

// ---------------------------------------------------------------------------
// Helpers dentro de la pagina
// ---------------------------------------------------------------------------

/** Reposo del render: TODO efecto V1-V4 de vuelta a cero. */
const REST = `(() => {
  const s = window.__fungiflush.scene;
  const st = s.stats();
  const ringLive = (s.rings?.slots ?? []).some((sl) => sl.active);
  return st.scoring === 0 && st.particles === 0 && st.tweens === 0 && st.gsap === 0
    && !ringLive && (s.trails?.size ?? 0) === 0
    && s.hitStopLeft <= 0 && s.bgPulse <= 0;
})()`;

/**
 * Espera a que la mano este jugada Y la escena en reposo.
 *
 * Sondeo con `page.evaluate` (1/s) en vez de `waitForFunction`: si se cuelga,
 * el ultimo reporte dice EXACTAMENTE que quedo vivo (una estela, un tween, una
 * carta en scoring). Ojo con la firma de `waitForFunction(fn, arg, options):
 * el `{timeout}` como 2do argumento se interpreta como `arg` y el timeout
 * real queda en el default de 30 s.
 */
const settle = async (timeoutMs = 90000) => {
  const t0 = Date.now();
  let last = null;
  while (Date.now() - t0 < timeoutMs) {
    last = await page.evaluate(() => {
      const s = window.__fungiflush.scene;
      const st = s.stats();
      // SOLO las transitorias: `stats().particles` suma el campo de ambiente
      // (400 en medium, 900 en high), que es CONSTANTE por tier y no es fuga.
      const pool = s.particles?.particles ?? [];
      let transient = 0;
      for (const p of pool) if (p.active) transient += 1;
      return {
        status: window.__fungiflush.engine.run?.status,
        scoring: st.scoring,
        particles: transient,
        ambient: st.particles - transient,
        tweens: st.tweens,
        gsap: st.gsap,
        rings: (s.rings?.slots ?? []).filter((sl) => sl.active).length,
        trails: s.trails?.size ?? -1,
        hitStop: s.hitStopLeft > 0,
        pulse: s.bgPulse > 0,
        hand: window.__fungiflush.engine.round?.hand?.length ?? -1,
      };
    });
    const live = last.status === 'playing' || last.status === 'reward';
    const rest =
      last.scoring === 0 && last.particles === 0 && last.tweens === 0 && last.gsap === 0 &&
      last.rings === 0 && last.trails === 0 && !last.hitStop && !last.pulse;
    // La run terminada no necesita reposo: `advance()` reinicia.
    // ⚠️ El status es `game_over` (con guion bajo), no `gameover`.
    if ((live && rest) || last.status === 'game_over' || last.status === 'victory') return last;
    await page.waitForTimeout(1000);
  }
  throw new Error(`settle timeout (${timeoutMs} ms). Quedo vivo: ${JSON.stringify(last)}`);
};

/** Juega una mano: las 5 cartas de mayor sustrato x esporas (greedy). */
const playOneHand = () => page.evaluate(() => {
  const e = window.__fungiflush.engine;
  e.clearSelection();
  const hand = e.round?.hand ?? [];
  const ranked = [...hand].sort(
    (a, b) => (b.def.substrate * b.def.spores) - (a.def.substrate * a.def.spores),
  );
  for (const c of ranked.slice(0, 5)) e.toggleSelect(c.uid);
  const n = e.round?.selected?.length ?? 0;
  e.playHand();
  return { selected: n, handSize: hand.length };
});

/**
 * Deja la partida en 'playing' con mano lista. Recorre el ciclo real
 * (recompensa -> tienda -> interludio -> oferta de victoria -> ciego).
 * Devuelve false si la run se perdio (gameover/victory).
 */
const advance = async () => {
  for (let guard = 0; guard < 24; guard += 1) {
    const status = await page.evaluate(() => window.__fungiflush.engine.run?.status);
    if (status === 'playing') return true;
    if (status === 'reward') {
      // Se TOMA la primera oferta: el mazo crece como en una partida real y
      // el check de texturas ve el caso de cartas nuevas de verdad.
      await page.evaluate(() => {
        const e = window.__fungiflush.engine;
        const first = e.rewardOffers().find((o) => !o.sold);
        e.chooseReward(first ? first.id : null);
      });
    } else if (status === 'shop') {
      await page.evaluate(() => {
        const e = window.__fungiflush.engine;
        for (const o of e.run?.shop?.offers ?? []) {
          if (e.canBuyOffer(o) && e.buyOffer(o.id)) break;
        }
        e.leaveShop();
      });
    } else if (status === 'interlude') {
      await page.evaluate(() => {
        const e = window.__fungiflush.engine;
        for (const c of e.pendingInterlude?.choices ?? []) {
          if (e.chooseInterlude(c.id)) return;
        }
      });
    } else if (status === 'victory_offer') {
      await page.evaluate(() => window.__fungiflush.engine.continueEndless());
    } else if (status === 'blind_select') {
      await page.evaluate(() => window.__fungiflush.engine.chooseBlind());
    } else {
      return false;
    }
    await page.waitForTimeout(250);
  }
  return false;
};

const measure = () => page.evaluate(() => {
  const st = window.__fungiflush.scene.stats();
  const e = window.__fungiflush.engine;
  // Desglose de la cache de texturas: el crecimiento legitimo vive en
  // `top`/`face` (nuevas cartas, vouchers que re-keyean bonus) y en `art`
  // (archivos nuevos). Una fuga creceria SIN que cambie nada de esto.
  const tc = window.__fungiflush.scene.textures;
  const pool = window.__fungiflush.scene.particles?.particles ?? [];
  let transient = 0;
  for (const p of pool) if (p.active) transient += 1;
  // Estado de las hojas animadas: `textures` vivas tienen que coincidir con
  // los archivos reservados por cartas VIVAS. Texturas de mas = reservas
  // colgadas (la fuga de la reserva fantasma de V5).
  const mr = window.__fungiflush.scene.motionReport?.() ?? null;
  return {
    geo: st.gpuGeometries,
    tex: st.gpuTextures,
    face: tc?.cache?.size ?? -1,
    art: tc?.artCache?.size ?? -1,
    top: tc?.topCache?.size ?? -1,
    mTex: mr?.textures ?? -1,
    mActive: mr?.active ?? -1,
    mAnim: mr?.animated ?? -1,
    popups: document.querySelector('.hud-popups')?.childElementCount ?? -1,
    particles: transient,
    tweens: st.tweens,
    gsap: st.gsap,
    deck: e.deckSize ?? -1,
    jokers: e.run?.jokers?.length ?? -1,
    vouchers: e.run?.vouchers?.length ?? -1,
  };
});

const show = (label, m) => {
  console.log(
    `${label.padEnd(16)} geo=${m.geo} tex=${m.tex} (cara=${m.face} arte=${m.art} top=${m.top}) ` +
    `hojas=${m.mTex}/${m.mActive}/${m.mAnim} ` +
    `popups=${m.popups} particulas=${m.particles} tweens=${m.tweens} gsap=${m.gsap} ` +
    `mazo=${m.deck} jokers=${m.jokers} vouchers=${m.vouchers}`,
  );
};

// ---------------------------------------------------------------------------
// 20 manos
// ---------------------------------------------------------------------------

let played = 0;
let restarts = 0;
let remeasures = 0;
let m1 = null;
let m2 = null;
let guard = 0;

while (played < HANDS) {
  guard += 1;
  if (guard > 300) throw new Error('probe-leak: demasiadas iteraciones (la run se cierra siempre en la mano a medir?)');
  const ok = await advance();
  if (!ok) {
    // La run se perdio: se reinicia y se SIGUE contando. Los contadores son
    // acumulativos, asi que una fuga igual se ve (y un reinicio es de paso
    // un estrés de crear/destruir todo).
    restarts += 1;
    await page.evaluate(() => {
      const e = window.__fungiflush.engine;
      e.startRun();
      e.chooseBlind();
    });
    await page.waitForFunction(() => (window.__fungiflush?.engine?.round?.hand?.length ?? 0) > 0, null, { timeout: 30000 });
    await page.waitForTimeout(1200);
    continue;
  }
  await page.waitForFunction(() => (window.__fungiflush?.engine?.round?.hand?.length ?? 0) > 0, null, { timeout: 30000 });
  const sel = await playOneHand();
  played += 1;
  if (played % 5 === 0 || played === 1) console.log(`mano ${played}/${HANDS} (jugo ${sel.selected} de ${sel.handSize})`);
  const last = await settle();
  const live = last.status === 'playing' || last.status === 'reward';
  if ((played === 3 || played === HANDS) && !live) {
    // La mano cerro la run: medir aca mediria a mitad del cierre (particulas
    // del doom, cartas volando). Se descuenta y se mide con la siguiente.
    if (remeasures < 3) {
      played -= 1;
      remeasures += 1;
      continue;
    }
    // Se agotaron los remeasures: se reinicia y la mano se vuelve a jugar. La
    // base sigue siendo valida (los contadores son acumulativos a proposito).
    restarts += 1;
    await page.evaluate(() => {
      const e = window.__fungiflush.engine;
      e.startRun();
      e.chooseBlind();
    });
    await page.waitForFunction(() => (window.__fungiflush?.engine?.round?.hand?.length ?? 0) > 0, null, { timeout: 30000 });
    await page.waitForTimeout(1200);
    played -= 1;
    continue;
  }
  if (played === 3) { await page.waitForTimeout(1500); m1 = await measure(); }
  if (played === HANDS) { await page.waitForTimeout(1500); m2 = await measure(); }
}

console.log('\n--- reposo tras las manos (tier low) ---');
show('mano 3 (base)', m1);
show(`mano ${HANDS}`, m2);
if (restarts > 0) console.log(`(la run se perdio ${restarts} vez/veces y se reinicio: los contadores son acumulativos)`);

await page.screenshot({ path: join(shotsDir, 'leak-rest-low.png') });

// ---------------------------------------------------------------------------
// Fase 2: el composer (medium) — donde vive PunchPass
// ---------------------------------------------------------------------------

console.log('\n--- fase 2: tier medium (composer + PunchPass) ---');
await page.evaluate(() => window.__fungiflush.scene.applyQuality('medium', 'manual'));
await page.waitForTimeout(1500);

let played2 = 0;
let m2b = null;
let m3 = null;
let remeasures2 = 0;
while (played2 < 3) {
  guard += 1;
  if (guard > 300) throw new Error('probe-leak: demasiadas iteraciones (fase medium)');
  const ok = await advance();
  if (!ok) {
    // Mismo criterio que la fase 1: si la run se perdio se reinicia y se
    // sigue (el contador es acumulativo). Sin esto la fase medium se saltria
    // en silencio con la primera muerte.
    restarts += 1;
    await page.evaluate(() => {
      const e = window.__fungiflush.engine;
      e.startRun();
      e.chooseBlind();
    });
    await page.waitForFunction(() => (window.__fungiflush?.engine?.round?.hand?.length ?? 0) > 0, null, { timeout: 60000 });
    await page.waitForTimeout(1500);
    continue;
  }
  await page.waitForFunction(() => (window.__fungiflush?.engine?.round?.hand?.length ?? 0) > 0, null, { timeout: 60000 });
  const sel = await playOneHand();
  played2 += 1;
  console.log(`mano medium ${played2}/3 (jugo ${sel.selected} de ${sel.handSize})`);
  const last2 = await settle(120000);
  const live2 = last2.status === 'playing' || last2.status === 'reward';
  if (!live2) {
    if (remeasures2 < 2) {
      played2 -= 1;
      remeasures2 += 1;
      continue;
    }
    restarts += 1;
    await page.evaluate(() => {
      const e = window.__fungiflush.engine;
      e.startRun();
      e.chooseBlind();
    });
    await page.waitForFunction(() => (window.__fungiflush?.engine?.round?.hand?.length ?? 0) > 0, null, { timeout: 60000 });
    await page.waitForTimeout(1500);
    played2 -= 1;
    continue;
  }
  // La base de medium es la mano 1, NO low: el composer y sus render targets
  // son costo FIJO que entra en los dos lados de la comparacion. Comparar
  // contra low mediria el costo del composer como si fuera una fuga.
  if (played2 === 1) { await page.waitForTimeout(1500); m2b = await measure(); }
  if (played2 === 3) { await page.waitForTimeout(1500); m3 = await measure(); }
}

if (m2b) show('medium x1', m2b);
if (m3) show('medium x3', m3);
await page.screenshot({ path: join(shotsDir, 'leak-rest-medium.png') });

// ---------------------------------------------------------------------------
// Veredicto
// ---------------------------------------------------------------------------

/**
 * Texturas que crecieron SIN explicacion: el detector real de fugas.
 *
 * Cada ARCHIVO de arte nuevo cuesta 3 texturas de GPU (capa de arte + normal
 * map + height map; las tres van en caches distintas pero compartidas por
 * `art.src`), cada ESTADO de carta nuevo cuesta 1 (capa de texto, keyeada
 * por bonus/estados) y cada HOJA ANIMADA nueva cuesta 1 (una por archivo, con
 * reservas: vive mientras alguna carta la muestra). Todo lo demas es costo
 * FIJO (fondo, sombra, sprite de particulas, render targets del composer) y no
 * deberia moverse: si se mueve, hay una textura huerfana.
 */
const residual = (a, b) => (b.tex - a.tex) - ((b.art - a.art) * 3 + (b.top - a.top) + (b.mTex - a.mTex));

/** Invariante del cache de hojas: textura viva <=> reserva viva. */
const sheetsOk = (m) => m.mTex === m.mActive;

const geoGrew = m2.geo - m1.geo;
const texGrew = m2.tex - m1.tex;
const resLow = residual(m1, m2);
const popGrew = m2.popups - m1.popups;
const restOk =
  m1.particles === 0 && m1.tweens === 0 && m1.gsap === 0 &&
  m2.particles === 0 && m2.tweens === 0 && m2.gsap === 0;

console.log('\ncrecimiento geometrias (mano 3 -> 20):', geoGrew, '(tolerancia 2)');
console.log('crecimiento texturas   (mano 3 -> 20):', texGrew,
  `= ${m2.art - m1.art} archivos de arte x3 + ${m2.top - m1.top} estados de carta + ${m2.mTex - m1.mTex} hojas (legitimo: recompensas y cartas nuevas)`);
console.log('residuo texturas       (mano 3 -> 20):', resLow, '(tiene que ser ~0: lo que crece sin cache detras es fuga)');
console.log('crecimiento .hud-popups(mano 3 -> 20):', popGrew, '(tiene que ser 0)');
if (m2b && m3) {
  const resMed = residual(m2b, m3);
  console.log('crecimiento geometrias (medium 1 -> 3):', m3.geo - m2b.geo, '(tolerancia 2; el costo fijo del composer ya esta en los dos lados)');
  console.log('residuo texturas       (medium 1 -> 3):', resMed, '(tiene que ser ~0)');
}
console.log('reposo verificado (pools/tweens en 0):', restOk);
console.log('hojas vivas == reservas (texturas huerfanas):',
  [sheetsOk(m1), sheetsOk(m2), m2b ? sheetsOk(m2b) : true, m3 ? sheetsOk(m3) : true].every(Boolean));

console.log('\nerrores de consola:', errors.length ? errors.slice(0, 5) : 'ninguno');

const mediumOk = !m2b || !m3 || (m3.geo - m2b.geo <= 2 && residual(m2b, m3) <= 2);
const ok =
  restOk &&
  geoGrew <= 2 &&
  resLow <= 2 &&
  popGrew === 0 &&
  mediumOk &&
  sheetsOk(m1) && sheetsOk(m2) &&
  errors.length === 0;
console.log(ok ? '\nOK SIN FUGAS TRAS 20 MANOS' : '\nXX HAY FUGA O REPOSO SUCIO');
await browser.close();
process.exitCode = ok ? 0 : 1;
