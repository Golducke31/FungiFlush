/**
 * simPhases.ts — Clasificacion de las fases del motor para el simulador.
 *
 * Vive aparte de `simulate.ts` a proposito: ese archivo ejecuta la simulacion
 * COMPLETA en su nivel superior (no tiene `if (import.meta.main)`), asi que
 * importarlo desde un test dispararia 100 partidas. Estas constantes son puras
 * y se pueden importar sin efectos.
 *
 * POR QUE HAY QUE MANTENER ESTO
 * ------------------------------
 * `tools/simulate.ts` es la red de seguridad de CI para el balance: corre 500
 * partidas headless y falla si alguna corta con "estado inesperado: X". Cuando
 * se agrega una fase al motor, hay que agregarla tambien al bot. Nadie se
 * acuerda — paso con `interlude`, y el 99% de las partidas empezaron a cortar
 * al primer interludio (envenenando ademas la telemetria de balance).
 *
 * `tests/simPhases.test.ts` verifica que estas listas cubran todo `GameStatus`.
 */

/**
 * Fases que el bot sabe jugar, cada una con su rama en el `while` de
 * `simulate.ts`. Si falta una, el harness corta con "estado inesperado".
 */
export const SIMULATED_PHASES = [
  'blind_select',
  'playing',
  'reward',
  'interlude',
  'shop',
] as const;

/**
 * Fases que el motor resuelve en el mismo tick que entra a otra (o que solo
 * existen antes de arrancar la run), asi que el bot nunca las observa como
 * estado estable en el bucle.
 */
export const SELF_RESOLVED_PHASES = ['menu', 'scoring'] as const;

/** Fases terminales: cortan el bucle de simulacion. */
export const TERMINAL_PHASES = ['game_over', 'victory'] as const;
