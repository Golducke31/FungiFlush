/**
 * verify-ascension.mjs — Verificacion en navegador del sistema de ascension (R1).
 *
 * Lo que el harness de consola NO puede probar: que el chip del menu diga el
 * nivel puesto, que el panel de ascension liste TODOS los niveles, que los
 * trabados se vean bloqueados y EXPLIQUEN la condicion, que elegir uno lo
 * persista, y que al arrancar una run el motor aplique el recargo.
 *
 * Uso: node tools/verify-ascension.mjs
 */

import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const URL_TO_TEST = process.argv[2] ?? 'http://127.0.0.1:1420/?daily=0';

const pw = await import(
  pathToFileURL(
    'C:/Users/emanu/.workbuddy-ai/binaries/node/workspace/node_modules/playwright-core/index.js',
  ).href
);
const chromium = pw.chromium ?? pw.default?.chromium;

const CANDIDATES = [
  'C:/Users/emanu/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe',
  'C:/Users/emanu/AppData/Local/ms-playwright/chromium-1228/chrome-win64/chrome.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
];
const executablePath = CANDIDATES.find((p) => existsSync(p));
if (!executablePath) {
  console.error('No se encontro un Chromium ejecutable.');
  process.exit(1);
}

const shotsDir = join(ROOT, 'tools', 'shots');
if (!existsSync(shotsDir)) mkdirSync(shotsDir, { recursive: true });

const browser = await chromium.launch({
  executablePath,
  headless: true,
  args: [
    '--enable-unsafe-swiftshader',
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-webgl',
    '--ignore-gpu-blocklist',
    '--disable-dev-shm-usage',
  ],
});

const context = await browser.newContext({
  viewport: { width: 844, height: 390 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
});

const page = await context.newPage();
const errors = [];
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});
page.on('pageerror', (e) => errors.push(`PAGEERROR ${e.message}`));

await page.goto(URL_TO_TEST, { waitUntil: 'load', timeout: 45000 });
await page.waitForFunction(() => Boolean(window.__fungiflush?.engine?.run), { timeout: 30000 });
await page.waitForTimeout(1500);

// --- Desbloquear A3 y abrir el menu ---
const setup = await page.evaluate(() => {
  const ff = window.__fungiflush;
  const max = ff.engine.registry.maxAscension();
  const unlocked = Math.min(3, max);
  ff.profileStore.current.ascension.highestUnlocked = unlocked;
  ff.profileStore.current.ascension.selected = 0;
  ff.hud.setAscensionState({ unlocked, selected: 0, max });
  ff.hud.showMenu();
  return { max, unlocked };
});
await page.waitForSelector('.panel.is-menu [data-act="ascension"]', { timeout: 5000 });
await page.waitForTimeout(500);

const chipOff = await page.evaluate(() => {
  const el = document.querySelector('.panel.is-menu [data-act="ascension"]');
  return {
    present: Boolean(el),
    label: el?.textContent ?? null,
    active: el?.classList.contains('is-active') ?? false,
  };
});

// --- Abrir el panel con un tap real ---
const chipBox = await page.locator('.panel.is-menu [data-act="ascension"]').boundingBox();
if (chipBox) await page.mouse.click(chipBox.x + chipBox.width / 2, chipBox.y + chipBox.height / 2);
await page.waitForSelector('.panel.is-ascension .ascension-card', { timeout: 5000 });
await page.waitForTimeout(700);
await page.screenshot({ path: join(shotsDir, '20-ascension.png') });

const panel = await page.evaluate(() => {
  const cards = [...document.querySelectorAll('.panel.is-ascension .ascension-card')];
  return {
    levels: cards.map((c) => Number(c.dataset.level)),
    locked: cards.filter((c) => c.classList.contains('is-locked')).length,
    disabledLocked: cards
      .filter((c) => c.classList.contains('is-locked'))
      .every((c) => c.disabled === true),
    // Los bloqueados EXPLICAN la condicion (no un candado mudo).
    lockedHelp: cards
      .filter((c) => c.classList.contains('is-locked'))
      .every((c) => (c.querySelector('.ascension-desc')?.textContent ?? '').trim().length > 8),
    // El texto NO es una clave i18n cruda.
    noRawKeys: cards.every(
      (c) => !/^ascension\.a\d/.test((c.querySelector('.ascension-name')?.textContent ?? '').trim()),
    ),
    badges: cards.map((c) => c.querySelector('.ascension-badge')?.textContent ?? null),
  };
});

// --- Elegir A2 ---
const a2Box = await page
  .locator('.panel.is-ascension .ascension-card[data-level="2"]')
  .boundingBox();
if (a2Box) await page.mouse.click(a2Box.x + a2Box.width / 2, a2Box.y + a2Box.height / 2);
await page.waitForTimeout(700);
await page.screenshot({ path: join(shotsDir, '20b-ascension-a2.png') });

const afterPick = await page.evaluate(() => {
  const ff = window.__fungiflush;
  const selected = [...document.querySelectorAll('.panel.is-ascension .ascension-card')].find(
    (c) => c.classList.contains('is-selected'),
  );
  return {
    profileSelected: ff.profileStore.current.ascension.selected,
    domSelectedLevel: selected ? Number(selected.dataset.level) : null,
    chipGone: !document.querySelector('.panel.is-menu [data-act="ascension"]'),
  };
});

// --- Arrancar una run con el nivel elegido y comprobar el recargo ---
const run = await page.evaluate(() => {
  const ff = window.__fungiflush;
  const level = ff.profileStore.current.ascension.selected;
  ff.engine.startRun(999, level);
  const blind = ff.engine.registry.blindsForAnte(ff.engine.run.ante)[0];
  const base = ff.engine.targetFor(blind);
  // El mismo ciego en A0, para comparar.
  ff.engine.run.ascension = 0;
  const atA0 = ff.engine.targetFor(blind);
  ff.engine.run.ascension = level;
  return {
    level: ff.engine.run.ascension,
    ascensionName: ff.t(ff.engine.ascension.nameKey),
    multiplier: ff.engine.ascension.modifiers.targetMultiplier ?? 1,
    targetAtA0: atA0,
    targetAtLevel: base,
    canReroll: ff.engine.canRerollDie,
  };
});

console.log('\n=== Setup ===');
console.log(JSON.stringify(setup, null, 2));
console.log('\n=== Chip del menu (A0) ===');
console.log(JSON.stringify(chipOff, null, 2));
console.log('\n=== Panel de ascension ===');
console.log(JSON.stringify(panel, null, 2));
console.log('\n=== Tras elegir A2 ===');
console.log(JSON.stringify(afterPick, null, 2));
console.log('\n=== Run en el nivel elegido ===');
console.log(JSON.stringify(run, null, 2));
console.log(`\nErrores de consola: ${errors.length}`);
for (const e of errors.slice(0, 10)) console.log(`  x ${e}`);

const checks = {
  chipPresente: chipOff.present === true,
  chipApagadoEnA0: chipOff.active === false,
  listaCompleta: panel.levels.length === setup.max + 1,
  empiezaEnA0: panel.levels[0] === 0,
  // Con 3 desbloqueados: A0..A3 libres y el resto trabados.
  bloqueadosCorrectos: panel.locked === setup.max - setup.unlocked,
  trabadosDeshabilitados: panel.disabledLocked === true,
  trabadosExplican: panel.lockedHelp === true,
  sinClavesCrudas: panel.noRawKeys === true,
  badgeA0: panel.badges[0] === 'A0',
  persistioEnPerfil: afterPick.profileSelected === 2,
  marcadoEnDom: afterPick.domSelectedLevel === 2,
  runConNivel: run.level === 2,
  objetivoSube: run.targetAtLevel > run.targetAtA0,
  nombreTraducido: run.ascensionName.length > 0 && !run.ascensionName.startsWith('ascension.'),
  sinErrores: errors.length === 0,
};
console.log('\n=== Chequeos ===');
for (const [k, v] of Object.entries(checks)) console.log(`  ${v ? 'ok ' : 'FALLA'} ${k}`);

const ok = Object.values(checks).every(Boolean);

console.log(ok ? '\n✓ ASCENSION VERIFY OK' : '\n✗ ASCENSION VERIFY FALLO');
await browser.close();
process.exit(ok ? 0 : 1);
