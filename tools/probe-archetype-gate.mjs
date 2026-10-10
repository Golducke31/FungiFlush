/**
 * probe-archetype-gate.mjs — Puerta de la ELECCION de arquetipo.
 *
 * QUE VERIFICA
 * ------------
 *   A) Perfil NUEVO (nunca jugo):
 *      1. `profileStore.current.archetypesUnlocked === false`.
 *      2. "Nueva partida" NO abre el selector de arquetipo: arranca DIRECTO una
 *         run con el mazo CLASICO (`engine.run.archetype === ''`).
 *      3. Al superar el PRIMER Ciego (`round:win`) el perfil se marca
 *         `archetypesUnlocked = true` y aparece el aviso de "nuevos estilos".
 *   B) Perfil con la puerta ABIERTA:
 *      4. "Nueva partida" abre el selector (`.panel.is-archetypes`) con los 4
 *         arquetipos y el boton de arranque.
 *
 * Es el complemento del smoke: el smoke siembra la puerta abierta (para seguir
 * recorriendo el selector), este probe cubre el camino del JUGADOR NUEVO.
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
const VIEWPORT = { width: 915, height: 412 };

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

async function newSession(seed) {
  const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 2 });
  const page = await context.newPage();
  if (seed) {
    await page.addInitScript((s) => {
      localStorage.setItem('fungiflush.profile', JSON.stringify(s));
    }, seed);
  }
  await page.goto(URL_TO_TEST, { waitUntil: 'load', timeout: 45000 });
  await page.waitForFunction(() => Boolean(window.__fungiflush?.engine), { timeout: 30000 });
  await page.waitForTimeout(900);
  return { context, page };
}

const click = (page, sel) => page.evaluate((s) => document.querySelector(s)?.click(), sel);

// ---------------------------------------------------------------------------
// A) Perfil NUEVO
// ---------------------------------------------------------------------------
console.log('\n--- A) Perfil nuevo (bloqueado) ---');
{
  // `seenTutorial: true` para que la guia de inicio no tape la seleccion de
  // ciego; no afecta a la puerta de arquetipos.
  const { context, page } = await newSession({ version: 7, seenTutorial: true });

  const locked = await page.evaluate(() => window.__fungiflush.profileStore.current.archetypesUnlocked);
  check(locked === false, 'A1 perfil nuevo: arquetipos BLOQUEADOS', `archetypesUnlocked=${locked}`);

  await click(page, '.panel.is-menu [data-act="new"]');
  await page.waitForTimeout(900);

  const afterNew = await page.evaluate(() => ({
    panel: Boolean(document.querySelector('.panel.is-archetypes')),
    status: window.__fungiflush.engine.run?.status ?? 'none',
    archetype: window.__fungiflush.engine.run?.archetype ?? '<none>',
  }));
  check(!afterNew.panel, 'A2 "Nueva partida" NO abre el selector', `panel=${afterNew.panel}`);
  check(afterNew.status === 'blind_select', 'A2 arranca la run directo', `status=${afterNew.status}`);
  check(afterNew.archetype === '', 'A2 arranca con el mazo CLASICO', `archetype="${afterNew.archetype}"`);

  // Entra al ciego y supera el PRIMER Ciego: dispara el desbloqueo.
  await click(page, '[data-act="blind-start"]');
  await page.waitForTimeout(700);
  const playing = await page.evaluate(() => window.__fungiflush.engine.run?.status ?? 'none');
  check(playing === 'playing', 'A3 entra al Ciego', `status=${playing}`);

  // `round:win` lleva payload (la HUD lee `reward`/`rewardParts`): se emite con
  // la forma real del evento para no romper a los suscriptores.
  await page.evaluate(() =>
    window.__fungiflush.bus.emit('round:win', {
      score: 0,
      target: 0,
      reward: 0,
      money: 0,
      rewardParts: null,
    }),
  );
  await page.waitForTimeout(500);

  const afterWin = await page.evaluate(() => ({
    unlocked: window.__fungiflush.profileStore.current.archetypesUnlocked,
    banner: document.querySelector('.banner-stack')?.textContent ?? '',
  }));
  check(afterWin.unlocked === true, 'A3 superar el primer Ciego DESBLOQUEA los arquetipos', `unlocked=${afterWin.unlocked}`);
  check(
    afterWin.banner.includes('estilos') || afterWin.banner.includes('styles'),
    'A3 aparece el aviso de nuevos estilos',
    `banner="${afterWin.banner.trim().slice(0, 60)}"`,
  );

  await context.close();
}

// ---------------------------------------------------------------------------
// B) Perfil con la puerta ABIERTA
// ---------------------------------------------------------------------------
console.log('\n--- B) Perfil con arquetipos desbloqueados ---');
{
  const { context, page } = await newSession({ version: 7, seenTutorial: true, archetypesUnlocked: true });

  const unlocked = await page.evaluate(() => window.__fungiflush.profileStore.current.archetypesUnlocked);
  check(unlocked === true, 'B1 perfil con la puerta abierta', `archetypesUnlocked=${unlocked}`);

  await click(page, '.panel.is-menu [data-act="new"]');
  await page.waitForTimeout(900);

  const panel = await page.evaluate(() => ({
    shown: Boolean(document.querySelector('.panel.is-archetypes')),
    cards: document.querySelectorAll('.panel.is-archetypes .archetype-card').length,
    hasStart: Boolean(document.querySelector('.panel.is-archetypes [data-act="archetypes-start"]')),
  }));
  check(panel.shown, 'B2 "Nueva partida" ABRE el selector');
  // 4 arquetipos del JSON + la tarjeta del CLASICO (siempre presente).
  check(panel.cards === 5, 'B2 el selector lista los 4 arquetipos + clasico', `cards=${panel.cards}`);
  check(panel.hasStart, 'B2 el selector tiene boton de arranque');

  await context.close();
}

await browser.close();
console.log(`\n${failures === 0 ? 'TODO OK' : `${failures} FALLO(S)`}`);
process.exit(failures === 0 ? 0 : 1);
