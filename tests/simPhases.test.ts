/**
 * simPhases.test.ts — El harness de balance tiene que cubrir TODAS las fases.
 *
 * POR QUE EXISTE
 * --------------
 * `tools/simulate.ts` es la red de seguridad de CI para el balance y el Trigger
 * Engine: corre 500 partidas headless y falla si alguna corta con "estado
 * inesperado: X". El problema es que es un `while` con una cadena de `if`, y
 * cuando se agrega una fase nueva al motor NADIE se acuerda de agregarla al bot.
 *
 * Paso exactamente eso con `interlude` (fases P2.3/P2.4): el 99% de las
 * partidas cortaban al llegar al primer interludio, y como las que morian
 * temprano tambien envenenaban la telemetria, el reporte de balance mostraba
 * numeros absurdos (ante promedio 1.x) sin que nadie sospechara del harness.
 *
 * Este test enumera las fases que el bot dice jugar (`SIMULATED_PHASES`), las
 * que el motor resuelve solo (`SELF_RESOLVED_PHASES`) y las terminales
 * (`TERMINAL_PHASES`), y verifica que juntas cubran TODO `GameStatus`. Si una
 * fase nueva queda sin clasificar, este test falla ANTES de que falle la CI.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  SIMULATED_PHASES,
  SELF_RESOLVED_PHASES,
  TERMINAL_PHASES,
} from '../tools/simPhases.ts';

/**
 * Copia literal de `GameStatus` (`src/engine/state/RunState.ts`). No se importa
 * el tipo a proposito: el tipo desaparece en runtime, y lo que hay que protege
 * es justamente el momento en que alguien agrega un miembro nuevo. Duplicarlo
 * aca convierte ese cambio en un fallo de test en vez de un fallo silencioso.
 */
const ALL_GAME_STATUSES = [
  'menu',
  'blind_select',
  'playing',
  'scoring',
  'reward',
  'interlude',
  'shop',
  'game_over',
  'victory',
] as const;

test('las fases del simulador cubren todo GameStatus', () => {
  const classified = new Set<string>([
    ...SIMULATED_PHASES,
    ...SELF_RESOLVED_PHASES,
    ...TERMINAL_PHASES,
  ]);

  const missing = ALL_GAME_STATUSES.filter((status) => !classified.has(status));
  assert.deepEqual(
    missing,
    [],
    `Fases sin clasificar en tools/simulate.ts: ${missing.join(', ')}. ` +
      'Agregala a SIMULATED_PHASES (y al while del bot) o a SELF_RESOLVED_PHASES/TERMINAL_PHASES.',
  );
});

test('ninguna fase esta clasificada dos veces', () => {
  const lists = [SIMULATED_PHASES, SELF_RESOLVED_PHASES, TERMINAL_PHASES];
  const seen = new Set<string>();
  for (const list of lists) {
    for (const phase of list) {
      assert.equal(seen.has(phase), false, `Fase duplicada entre listas: ${phase}`);
      seen.add(phase);
    }
  }
});

test('las listas no contienen fases desconocidas', () => {
  const known = new Set<string>(ALL_GAME_STATUSES);
  const classified = [
    ...SIMULATED_PHASES,
    ...SELF_RESOLVED_PHASES,
    ...TERMINAL_PHASES,
  ];
  const unknown = classified.filter((phase) => !known.has(phase));
  assert.deepEqual(unknown, [], `Fases inexistentes en las listas: ${unknown.join(', ')}`);
});

test('interlude es una fase simulada (regresion: la CI de balance fallaba aca)', () => {
  assert.ok(
    (SIMULATED_PHASES as readonly string[]).includes('interlude'),
    'interlude tiene que estar en SIMULATED_PHASES o el bot corta la run al primer interludio',
  );
});
