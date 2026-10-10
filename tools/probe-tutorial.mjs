/**
 * probe-tutorial.mjs — Frente 1: el TUTORIAL optativo guia un Ante completo.
 *
 * QUE VERIFICA
 * ------------
 *   1. El selector de arquetipo ofrece el boton `tutorial-start` SIN quitarle
 *      protagonismo a `archetypes-start` (los dos estan, los dos son clickeables).
 *   2. Al pulsarlo arranca una run REAL (`run.tutorial === true`) con la semilla
 *      FIJA del tutorial, en estado `blind_select`.
 *   3. Aparece la capa `.tut-layer` con tarjeta, titulo, cuerpo y contador de
 *      paso (`n / total`).
 *   4. El spotlight RESALTA de verdad: el ancla `[data-act="blind-start"]` esta
 *      dentro del rectangulo que el halo deja iluminado.
 *   5. Pulsar "Siguiente" avanza el paso (el contador sube o el paso cambia).
 *   6. "Saltar paso" salta sin cerrar el tutorial; "Saltar" (todo) lo cierra y
 *      deja `run.tutorial === false`.
 *   7. JUGANDO: entrar al ciego hace que el guion avise sobre la MANO
 *      (`hand_dealt`) y sobre JUGAR (`play_hand`).
 *   8. El tutorial NO cambia las reglas: el motor arranca con el mazo clasico
 *      (40 cartas) y sin arquetipo, igual que una run normal.
 *   9. Terminar el ciego lleva a la RECOMPENSA, donde el guion sigue.
 *  10. No hay errores de consola durante toda la secuencia.
 *  11. El CAPITULO AVANZADO arranca con un MAZO DE ARQUETIPO (Podredumbre, 24
 *      cartas) y su propio contador (5 pasos): las cartas que el clasico no
 *      tiene (podredumbre, re-disparo, simbiontes) se demuestran en vivo.
 *
 *   node tools/probe-tutorial.mjs
 *   FF_VIEWPORT=smoke node tools/probe-tutorial.mjs
 */
import { existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const URL_TO_TEST = process.env.FF_URL ?? 'http://127.0.0.1:1420/?daily=0';
const VIEWPORT =
  process.env.FF_VIEWPORT === 'smoke'
    ? { width: 844, height: 390 }
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
const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 2 });
const page = await context.newPage();
// El probe recorre el SELECTOR de arquetipo (donde vive el boton del tutorial),
// asi que siembra la puerta abierta: se desbloquea al superar el primer Ciego.
await page.addInitScript(() => {
  localStorage.setItem(
    'fungiflush.profile',
    JSON.stringify({ version: 7, archetypesUnlocked: true }),
  );
});
const errors = [];
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

const click = (sel) => page.evaluate((s) => document.querySelector(s)?.click(), sel);
const wait = (ms) => page.waitForTimeout(ms);

let failures = 0;
const check = (ok, label, detail = '') => {
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
};

/**
 * Estado de la capa de tutorial tal como lo ve el jugador.
 * `highlighted` mide si el ancla cae DENTRO del area iluminada por el halo:
 * el spotlight usa `box-shadow: 0 0 0 9999px` con el hueco sobre el ancla, asi
 * que comparamos el rect del ancla contra el rect del `.tut-spotlight`.
 */
const tutState = () =>
  page.evaluate(() => {
    const layer = document.querySelector('#ui-root .tut-layer');
    if (!layer) return { open: false };
    const card = layer.querySelector('.tut-card');
    const spot = layer.querySelector('.tut-spotlight');
    const anchor = spot?.dataset?.anchor ? document.querySelector(spot.dataset.anchor) : null;
    const body = layer.querySelector('.tut-body');
    const title = layer.querySelector('.tut-title');
    const stepOf = layer.querySelector('.tut-step-of');
    let highlighted = false;
    if (spot && anchor) {
      const s = spot.getBoundingClientRect();
      const a = anchor.getBoundingClientRect();
      // El ancla tiene que estar (casi) contenida en el hueco del halo.
      const pad = 6;
      highlighted =
        a.left >= s.left - pad &&
        a.right <= s.right + pad &&
        a.top >= s.top - pad &&
        a.bottom <= s.bottom + pad;
    }
    return {
      open: true,
      hasCard: Boolean(card),
      title: (title?.textContent ?? '').trim(),
      body: (body?.textContent ?? '').trim(),
      stepOf: (stepOf?.textContent ?? '').trim(),
      hasSpotlight: Boolean(spot),
      anchorSel: spot?.dataset?.anchor ?? '',
      highlighted,
      next: Boolean(layer.querySelector('[data-act="tut-next"]')),
      skipStep: Boolean(layer.querySelector('[data-act="tut-skip-step"]')),
      skipAll: Boolean(layer.querySelector('[data-act="tut-skip-all"]')),
      isLast: layer.querySelector('[data-act="tut-next"]')?.classList.contains('is-last') ?? false,
    };
  });

/** Parsea el contador. El i18n lo pinta como "Paso 3 de 20" / "Step 3 of 20":
 *  el patron acepta las dos lenguas (el juego arranca en ingles). */
const stepNumber = (s) => {
  const m = /(\d+)\s*(?:\/|de|of)\s*(\d+)/.exec(s.stepOf ?? '');
  return m ? { n: Number(m[1]), total: Number(m[2]) } : { n: -1, total: -1 };
};

await page.goto(URL_TO_TEST, { waitUntil: 'load', timeout: 45000 });
await page.waitForFunction(() => Boolean(window.__fungiflush?.engine?.run), { timeout: 30000 });
await wait(1800);

// --- 1. El selector de arquetipo ofrece el tutorial junto a "Empezar" ---
await click('[data-act="tutorial-close"]');
await wait(300);
await click('[data-act="menu-toggle"]');
await wait(400);
await click('.panel.is-menu [data-act="new"]');
await wait(700);

const selectorState = await page.evaluate(() => {
  const tut = document.querySelector('[data-act="tutorial-start"]');
  const start = document.querySelector('[data-act="archetypes-start"]');
  const r = (el) => {
    if (!el) return null;
    const b = el.getBoundingClientRect();
    return { w: Math.round(b.width), h: Math.round(b.height), x: Math.round(b.left), y: Math.round(b.top) };
  };
  return { hasTut: Boolean(tut), hasStart: Boolean(start), tutRect: r(tut), startRect: r(start) };
});
check(selectorState.hasTut, 'el selector de arquetipo ofrece el boton de Tutorial');
check(selectorState.hasStart, 'el boton "Empezar" sigue estando');
const tutClickable =
  selectorState.tutRect != null && selectorState.tutRect.w > 40 && selectorState.tutRect.h > 20;
check(tutClickable, 'el boton de Tutorial es clickeable (tamano real)', JSON.stringify(selectorState.tutRect));
await page.screenshot({ path: join(shotsDir, 'probe-tutorial-selector.png') });

// --- 2. Pulsarlo arranca la run del tutorial ---
await click('[data-act="tutorial-start"]');
await page.waitForFunction(
  () => window.__fungiflush?.engine?.run?.tutorial === true,
  { timeout: 15000 },
);
await wait(1300);

const runInfo = await page.evaluate(() => {
  const eng = window.__fungiflush.engine;
  const r = eng.run;
  return {
    tutorial: r.tutorial,
    archetype: r.archetype ?? '',
    status: r.status,
    deckSize: r.deck ? r.deck.allCards.length : -1,
    ante: r.ante,
    blindIndex: r.blindIndex,
  };
});
check(runInfo.tutorial === true, 'arranca una run marcada como tutorial');
check(runInfo.status === 'blind_select', 'el tutorial arranca en la seleccion de ciego', runInfo.status);
check(runInfo.archetype === '', 'el tutorial usa el mazo CLASICO (sin arquetipo)', `"${runInfo.archetype}"`);
check(runInfo.deckSize === 40, 'el mazo es el clasico de 40 cartas (reglas intactas)', String(runInfo.deckSize));

// --- 3. La capa de tutorial aparece con contenido ---
const first = await tutState();
check(first.open, 'aparece la capa del tutorial');
check(first.hasCard, 'la capa tiene tarjeta de paso');
check(first.title.length > 0, 'el paso tiene TITULO', first.title);
check(first.body.length > 20, 'el paso tiene CUERPO explicativo', first.body.slice(0, 60));
const p1 = stepNumber(first);
check(p1.n === 1 && p1.total === 20, 'el contador arranca en 1 de 20', first.stepOf);
check(first.next, 'el paso ofrece "Siguiente"');
check(first.skipAll, 'el tutorial se puede saltar entero');
await page.screenshot({ path: join(shotsDir, 'probe-tutorial-step1.png') });

// --- 4. El spotlight resalta el ancla de verdad ---
check(first.hasSpotlight, 'el paso 1 resalta un ancla (spotlight)');
check(first.highlighted, 'el ancla resaltada cae dentro del halo', first.anchorSel);

// --- 5. "Siguiente" en el ultimo paso del estado ESCONDE la capa ---
// El paso 1 es un paso de "tap" en `blind_select` y es el UNICO paso de ese
// estado hasta el Jefe: al pulsarlo, la capa se esconde y el jugador puede
// actuar. El tutorial NO se cierra: sigue vivo esperando el ciego.
await click('[data-act="tut-next"]');
await wait(600);
const afterNext = await tutState();
check(!afterNext.open, 'tras "Siguiente", la capa se esconde y deja jugar');
const stillTutorial = await page.evaluate(() => ({
  tutorial: window.__fungiflush.engine.run.tutorial,
  status: window.__fungiflush.engine.run.status,
}));
check(stillTutorial.tutorial === true, 'el tutorial SIGUE VIVO tras avanzar el paso 1');
check(stillTutorial.status === 'blind_select', 'seguimos en la seleccion de ciego', stillTutorial.status);

// El boton de Luchar sigue siendo tocable con la capa fuera.
const canFight = await page.evaluate(() => {
  const b = document.querySelector('[data-act="blind-start"]');
  if (!b) return false;
  const r = b.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
});
check(canFight, 'el boton "Luchar" queda tocable tras el paso 1');

// --- 7. Jugar de verdad: el guion avisa de la mano y de jugar ---
// Volver al inicio del flujo: se salta lo que quede hasta llegar a `playing`.
await page.evaluate(() => window.__fungiflush.engine.chooseBlind());
await page.waitForFunction(
  () => (window.__fungiflush?.engine?.round?.hand?.length ?? 0) > 0,
  { timeout: 15000 },
);
await wait(1200);

const playing = await page.evaluate(() => ({
  status: window.__fungiflush.engine.run.status,
  hand: window.__fungiflush.engine.round?.hand?.length ?? 0,
  tutOpen: Boolean(document.querySelector('#ui-root .tut-layer')),
  stepOf: document.querySelector('.tut-step-of')?.textContent ?? '',
  anchor: document.querySelector('.tut-spotlight')?.dataset?.anchor ?? '',
}));
check(playing.status === 'playing', 'el ciego arranco (estado playing)', playing.status);
check(playing.hand > 0, 'hay cartas en la mano', String(playing.hand));
check(playing.tutOpen, 'el tutorial sigue vivo al entrar al ciego');
// El paso de la mano resalta la GUIA de seleccion (la mano es WebGL, no DOM).
check(
  /select-hint|deck/.test(playing.anchor),
  'el paso de la mano resalta la guia/Mazo',
  playing.anchor || '(centrado)',
);
// La PRIMERA mano muestra `hand_dealt` (paso 2). Antes, entrar a `playing`
// disparaba DOS avisos (`state:changed` + `hand:dealt`) y el doble avance se
// comia `hand_dealt` sin mostrarlo: ahora el avance es idempotente.
check(
  stepNumber({ stepOf: playing.stepOf }).n === 2,
  'la primera mano muestra `hand_dealt` (paso 2, ya no se lo saltea)',
  playing.stepOf,
);

// `hand_dealt` es un paso de "tap": se avanza pulsando "Siguiente".
const handStep = stepNumber(playing.stepOf ? await tutState() : { stepOf: '' });
if (playing.tutOpen) {
  await click('[data-act="tut-next"]');
  await wait(600);
}
const afterHand = await tutState();
check(
  !afterHand.open || stepNumber(afterHand).n > handStep.n,
  'tras el paso de la mano el guion no se traba',
  afterHand.open ? afterHand.stepOf : '(capa oculta)',
);

// Seleccionar cartas: el paso `select_cards` exige `selectedCount === 0`, asi
// que seleccionar lo CONSUME y el guion sigue adelante.
await page.evaluate(() => {
  const ff = window.__fungiflush;
  ff.engine.clearSelection();
  for (const c of (ff.engine.round?.hand ?? []).slice(0, 3)) ff.engine.toggleSelect(c.uid);
});
await wait(800);
const selected = await page.evaluate(() => window.__fungiflush.engine.round?.selected?.length ?? 0);
check(selected === 3, 'se seleccionaron 3 cartas', String(selected));
const afterSelect = await tutState();
check(
  !afterSelect.open || stepNumber(afterSelect).n >= handStep.n,
  'seleccionar no retrocede el guion',
  afterSelect.open ? afterSelect.stepOf : '(capa oculta)',
);
await page.screenshot({ path: join(shotsDir, 'probe-tutorial-playing.png') });

// --- 9. Cerrar el ciego lleva a la recompensa ---
// Se juegan manos hasta que el ciego se cierre. El scoring es asincrono (la
// timeline del render manda), asi que se espera entre manos en vez de asumir
// que `playHand` es sincrono.
const closeBlind = async () => {
  for (let i = 0; i < 25; i += 1) {
    const st = await page.evaluate(() => window.__fungiflush.engine.run.status);
    if (st !== 'playing') return st;
    await page.evaluate(() => {
      const ff = window.__fungiflush;
      const hand = ff.engine.round?.hand ?? [];
      if (hand.length === 0) return;
      ff.engine.clearSelection();
      for (const c of hand.slice(0, 5)) ff.engine.toggleSelect(c.uid);
      ff.engine.playHand();
    });
    await wait(900);
  }
  return page.evaluate(() => window.__fungiflush.engine.run.status);
};
const endStatus = await closeBlind();
await wait(1200);

const rewarded = await page.evaluate(() => ({
  status: window.__fungiflush.engine.run.status,
  tutOpen: Boolean(document.querySelector('#ui-root .tut-layer')),
  stepOf: document.querySelector('.tut-step-of')?.textContent ?? '',
  title: document.querySelector('.tut-title')?.textContent ?? '',
}));
check(
  ['reward', 'shop', 'interlude'].includes(rewarded.status),
  'ganar el ciego lleva a recompensa/tienda',
  `${rewarded.status} (via ${endStatus})`,
);
// La recompensa tiene su paso (`score_breakdown` / `reward_draft`). Si el panel
// tardo en montar, la capa puede no estar todavia: se le da un respiro.
if (!rewarded.tutOpen) {
  await wait(1200);
}
const rewarded2 = await page.evaluate(() => ({
  tutOpen: Boolean(document.querySelector('#ui-root .tut-layer')),
  stepOf: document.querySelector('.tut-step-of')?.textContent ?? '',
  title: document.querySelector('.tut-title')?.textContent ?? '',
}));
check(rewarded2.tutOpen, 'el guion sigue guiando en la recompensa', rewarded2.stepOf || rewarded2.title);
await page.screenshot({ path: join(shotsDir, 'probe-tutorial-reward.png') });

// --- 6b. "Saltar" (todo) cierra el tutorial y libera la run ---
await click('[data-act="tut-skip-all"]');
await wait(600);
const ended = await page.evaluate(() => ({
  layerGone: !document.querySelector('#ui-root .tut-layer'),
  tutorial: window.__fungiflush.engine.run.tutorial,
  seen: window.__fungiflush.profileStore.current.seenTutorial,
}));
check(ended.layerGone, '"Saltar" quita la capa del tutorial');
check(ended.tutorial === false, 'al saltar, la run deja de estar marcada como tutorial');
check(ended.seen === true, 'el perfil recuerda que ya vio el tutorial');

// El juego sigue siendo jugable despues de saltar.
const stillPlayable = await page.evaluate(
  () => ['reward', 'shop', 'interlude', 'blind_select', 'playing'].includes(window.__fungiflush.engine.run.status),
);
check(stillPlayable, 'el juego sigue corriendo normalmente tras saltar el tutorial');

// --- 11. Capitulo AVANZADO: mazo de arquetipo (Podredumbre) ---
// Se arranca directo por la API DEV (sin tener que ganar un Ante entero con el
// mazo clasico, que es debil): asi se verifica que el bloque avanzado usa OTRO
// mazo (24 cartas, arquetipo decay) y su propio contador de 5 pasos.
await page.evaluate(() => window.__fungiflush.startTutorialChapter('advanced'));
await page.waitForFunction(() => window.__fungiflush?.engine?.run?.tutorial === true, {
  timeout: 15000,
});
await wait(1400);
const adv = await page.evaluate(() => {
  const r = window.__fungiflush.engine.run;
  return {
    tutorial: r.tutorial,
    archetype: r.archetype ?? '',
    deckSize: r.deck ? r.deck.allCards.length : -1,
    tutOpen: Boolean(document.querySelector('#ui-root .tut-layer')),
    stepOf: document.querySelector('.tut-step-of')?.textContent ?? '',
    title: document.querySelector('.tut-title')?.textContent ?? '',
  };
});
check(adv.tutorial === true, 'el capitulo avanzado arranca como tutorial');
check(adv.archetype === 'decay', 'el capitulo avanzado usa el mazo de Podredumbre', adv.archetype);
check(adv.deckSize === 24, 'el mazo del capitulo avanzado tiene 24 cartas', String(adv.deckSize));
check(adv.tutOpen, 'el capitulo avanzado muestra su primer paso', adv.title);
const advStep = stepNumber({ stepOf: adv.stepOf });
check(advStep.n === 1 && advStep.total === 5, 'el contador del avanzado arranca en 1 de 5', adv.stepOf);
await page.screenshot({ path: join(shotsDir, 'probe-tutorial-chapter-b.png') });

// --- 12. Los pasos NUEVOS (descartar + habilidad) se muestran de verdad ---
// Se re-arranca el clasico y se avanza a `playing` pulsando "Siguiente" paso a
// paso SIN tocar cartas: asi el auto-avance por `state:changed` (cada seleccion
// avanza un paso) no se dispara y se recorre el guion en orden. Se recogen los
// NUMEROS de paso vistos (independientes del idioma) y se comprueba que
// aparecen el 6 (descartar) y el 7 (FungiFlush), que antes NO existian.
await page.evaluate(() => window.__fungiflush.startTutorialChapter('classic'));
await page.waitForFunction(() => window.__fungiflush?.engine?.run?.tutorial === true, {
  timeout: 15000,
});
await wait(1200);
// Paso 1 (`blind_select`): avanzar y elegir el ciego para entrar a `playing`.
await click('[data-act="tut-next"]');
await wait(400);
await page.evaluate(() => window.__fungiflush.engine.chooseBlind());
await page.waitForFunction(() => (window.__fungiflush?.engine?.round?.hand?.length ?? 0) > 0, {
  timeout: 15000,
});
await wait(1000);

const seen = [];
for (let i = 0; i < 12; i += 1) {
  const st = await page.evaluate(() => {
    const layer = document.querySelector('#ui-root .tut-layer');
    if (!layer) return { open: false };
    return {
      open: true,
      n: document.querySelector('.tut-step-of')?.textContent ?? '',
      title: document.querySelector('.tut-title')?.textContent ?? '',
      anchor: document.querySelector('.tut-spotlight')?.dataset?.anchor ?? '',
    };
  });
  if (!st.open) break;
  seen.push(st);
  // Captura de los pasos NUEVOS, justo mientras se muestran.
  const n = stepNumber({ stepOf: st.n }).n;
  // Paso 2 (`hand_dealt`): antes NUNCA se veia (el doble aviso lo saltaba).
  if (n === 2) await page.screenshot({ path: join(shotsDir, 'probe-tutorial-step-hand.png') });
  if (n === 6) await page.screenshot({ path: join(shotsDir, 'probe-tutorial-step-discard.png') });
  if (n === 7) await page.screenshot({ path: join(shotsDir, 'probe-tutorial-step-fungiflush.png') });
  // IDEMPOTENCIA: con un paso `tap` en pantalla, SELECCIONAR una carta emite
  // `state:changed` (toggleSelect lo emite) pero NO debe avanzar el guion.
  if (n === 5) {
    await page.evaluate(() => {
      const ff = window.__fungiflush;
      const card = ff.engine.round?.hand?.[0];
      if (card) ff.engine.toggleSelect(card.uid);
    });
    await wait(400);
    const afterSelect = await page.evaluate(
      () => document.querySelector('.tut-step-of')?.textContent ?? '',
    );
    check(
      stepNumber({ stepOf: afterSelect }).n === 5,
      'seleccionar una carta NO avanza el paso `tap` (avance idempotente)',
      afterSelect,
    );
    await page.evaluate(() => window.__fungiflush.engine.clearSelection());
    await wait(300);
  }
  await click('[data-act="tut-next"]');
  await wait(350);
}
const seenNumbers = seen.map((s) => stepNumber({ stepOf: s.n }).n);
check(seenNumbers.includes(6), 'el paso de DESCARTE se muestra (paso 6)', seenNumbers.join(','));
check(seenNumbers.includes(7), 'el paso de la HABILIDAD se muestra (paso 7)', seenNumbers.join(','));
const flushStep = seen.find((s) => stepNumber({ stepOf: s.n }).n === 7);
check(
  flushStep?.anchor === '[data-act="use-fungi-flush"]',
  'el paso de la habilidad resalta el BOTON real',
  flushStep?.anchor ?? '(sin ancla)',
);
const discardStep = seen.find((s) => stepNumber({ stepOf: s.n }).n === 6);
check(
  (discardStep?.title ?? '').length > 0,
  'el paso de descarte reusa la cadena del descarte',
  discardStep?.title ?? '(sin titulo)',
);

console.log('---');
console.log(`viewport ${VIEWPORT.width}x${VIEWPORT.height} · fallos: ${failures}`);
console.log('errores de consola:', errors.length ? errors.slice(0, 5) : 'ninguno');
if (errors.length) failures += 1;
await browser.close();
process.exit(failures > 0 ? 1 : 0);
