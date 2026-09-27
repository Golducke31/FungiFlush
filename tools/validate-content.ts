/**
 * validate-content.ts — Valida TODO el contenido de los packs.
 *
 * Es el gate que va en CI antes de buildear: si una carta tiene un trigger
 * inexistente, una accion mal escrita o falta una traduccion, aca se corta.
 * Es lo que hace seguro agregar 100 cartas escribiendo JSON.
 *
 *   npm run validate
 */

import { buildRegistry, loadDictionaries } from './loadContent.node.ts';

function main(): void {
  const registry = buildRegistry();
  const dictionaries = loadDictionaries();
  const issues = registry.validate({ dictionaries });

  const stats = registry.stats();
  console.log('── Contenido ──────────────────────────────');
  console.log(`packs      ${stats.packs}`);
  console.log(`cartas     ${stats.cards}`);
  console.log(`jokers     ${stats.jokers}`);
  console.log(`blinds     ${stats.blinds}`);
  console.log(`antes      ${stats.antes}`);
  console.log(`ofertas    ${stats.offers}`);
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
    process.exit(1);
  }

  console.log(`\n✓ Contenido valido (${warnings.length} advertencias).`);
}

main();
