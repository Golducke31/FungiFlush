/**
 * validate-content.ts — Valida TODO el contenido de los packs.
 *
 * Es el gate que va en CI antes de buildear: si una carta tiene un trigger
 * inexistente, una accion mal escrita o falta una traduccion, aca se corta.
 * Es lo que hace seguro agregar 100 cartas escribiendo JSON.
 *
 *   npm run validate
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { artFileFor, artKeysFor } from '../src/render/ArtAssets.ts';
import type { CardDefinition } from '../src/engine/index.ts';
import { buildRegistry, loadDictionaries, PROJECT_ROOT } from './loadContent.node.ts';
import { validateI18nKeys } from './scanI18n.ts';

/** Archivos de arte que existen de verdad, segun el manifiesto. */
function readArtManifest(): Set<string> {
  const manifest = JSON.parse(
    readFileSync(join(PROJECT_ROOT, 'public', 'art', 'index.json'), 'utf8'),
  ) as { files?: unknown };
  return new Set(
    (Array.isArray(manifest.files) ? manifest.files : []).filter(
      (file): file is string => typeof file === 'string',
    ),
  );
}

/**
 * Que archivo de arte termina mostrando cada carta, y cuantas comparten.
 *
 * El catalogo se indexa por (elemento, rareza) — 8 x 5 = 40 — pero las cartas
 * caen en menos pares que cartas hay. Sin arte propio, dos cartas distintas del
 * mismo par comparten dibujo y el jugador no las distingue. Ya paso: 35 cartas
 * en 23 pares dejaban 22 cartas (62%) repetidas.
 *
 * Reusa `artKeysFor`/`artFileFor` a proposito: si la cadena de respaldo cambia,
 * este chequeo cambia con ella en vez de quedarse con una copia vieja de las
 * reglas. Una carta sin NINGUN archivo no cuenta como colision: ahi la textura
 * cae al dibujo procedural, que ya es unico por carta.
 */
function artCoverage(
  cards: readonly CardDefinition[],
  files: ReadonlySet<string>,
): { byFile: Map<string, string[]>; missing: string[] } {
  const byFile = new Map<string, string[]>();
  const missing: string[] = [];

  for (const card of cards) {
    const key = artKeysFor(card.element, card.rarity, card.id).find((k) => files.has(artFileFor(k)));
    if (!key) {
      missing.push(card.id);
      continue;
    }
    const file = artFileFor(key);
    const ids = byFile.get(file) ?? [];
    ids.push(card.id);
    byFile.set(file, ids);
  }

  return { byFile, missing };
}

function main(): void {
  const registry = buildRegistry();
  const dictionaries = loadDictionaries();
  const issues = registry.validate({ dictionaries });

  // Cobertura de arte: cada carta tiene que poder mostrar algo distinto.
  const cards = registry.toBundle().cards;
  const art = artCoverage(cards, readArtManifest());
  const artProblems = [...art.byFile.entries()]
    .filter(([, ids]) => ids.length > 1)
    .map(([file, ids]) => `${file} la comparten ${ids.length} cartas: ${ids.join(', ')}`);

  // Claves i18n escritas en el CODIGO (no en el contenido). Es el chequeo que
  // evita que un boton nuevo salga en pantalla como "deck.sortElement".
  const i18nProblems = validateI18nKeys();

  const stats = registry.stats();
  console.log('── Contenido ──────────────────────────────');
  console.log(`packs      ${stats.packs}`);
  console.log(`cartas     ${stats.cards}`);
  console.log(`jokers     ${stats.jokers}`);
  console.log(`mejorasRun ${stats.vouchers}`);
  console.log(`blinds     ${stats.blinds}`);
  console.log(`antes      ${stats.antes}`);
  console.log(`ofertas    ${stats.offers}`);
  console.log(`mejoras    ${stats.upgrades}`);
  console.log(`evoluciones ${stats.evolutions}`);
  console.log(`interludios ${stats.interludes}`);
  console.log(`tablero    ${stats.board}`);
  console.log(`arte       ${cards.length} cartas / ${art.byFile.size} ilustraciones distintas`);
  console.log(`hash       ${registry.contentHash()}`);

  if (registry.skipped.length > 0) {
    console.log('\nPacks omitidos:');
    for (const s of registry.skipped) console.log(`  - ${s.id}: ${s.reason}`);
  }

  const errors = issues.filter((i) => i.level === 'error');
  const warnings = issues.filter((i) => i.level === 'warning');

  for (const issue of warnings.slice(0, 30)) {
    console.warn(`  ⚠ [${issue.pack}] ${issue.where}: ${issue.message}`);
  }
  if (warnings.length > 30) console.warn(`  … y ${warnings.length - 30} advertencias mas`);

  if (errors.length > 0) {
    console.error(`\n✗ ${errors.length} error(es) de contenido:`);
    for (const issue of errors.slice(0, 40)) {
      console.error(`  ✗ [${issue.pack}] ${issue.where}: ${issue.message}`);
    }
  }

  if (i18nProblems.length > 0) {
    console.error(`\n✗ ${i18nProblems.length} clave(s) i18n usadas en el codigo y sin traducir:`);
    for (const problem of i18nProblems.slice(0, 40)) console.error(`  ✗ ${problem}`);
  }

  if (artProblems.length > 0) {
    console.error(`\n✗ ${artProblems.length} ilustracion(es) compartidas por mas de una carta:`);
    for (const problem of artProblems.slice(0, 40)) console.error(`  ✗ ${problem}`);
    console.error('  Cada carta necesita su propio `art_card_own_<id>.webp` (ver ArtAssets.ts).');
  }

  if (errors.length > 0 || i18nProblems.length > 0 || artProblems.length > 0) process.exit(1);

  console.log(`\n✓ Contenido valido (${warnings.length} advertencias).`);
}

main();
