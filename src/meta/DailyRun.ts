/**
 * DailyRun.ts — Desafio diario: semilla por fecha y control del intento.
 *
 * PURO (numeros y strings adentro, numeros y booleanos afuera): la fecha entra
 * por parametro, nunca se lee el reloj desde aca. Es lo que permite testear
 * "misma fecha = misma run" sin dormir al proceso ni mockear el reloj global.
 *
 * La fecha es LOCAL (misma `dateKey` que la racha de la recompensa diaria): el
 * dia del JUGADOR, no el de Greenwich. Con UTC, un jugador de UTC-3 veria
 * cambiar el diario a las 21:00 y el intento "del dia" se le bloquearia dos
 * veces en la misma noche.
 */

import { hashString } from '../engine/rng';
import { dateKey } from '../retention/DailyReward';
import type { ProfileSave } from './ProfileState';

/**
 * Semilla del diario de una fecha ('YYYY-MM-DD').
 *
 * `hashString` es el FNV-1a de `rng.ts`: estable entre versiones y plataformas
 * (no depende de `Math.random` ni del reloj), que es justo lo que hace que dos
 * jugadores con la misma fecha jueguen la MISMA run.
 */
export function dailySeed(date: string): number {
  return hashString(`fungiflush:daily:${date}`);
}

/** Semilla del diario de un instante, usando la fecha LOCAL de ese instante. */
export function dailySeedAt(ts: number): number {
  return dailySeed(dateKey(ts));
}

/** Fecha ('YYYY-MM-DD' local) del diario de un instante. */
export function dailyDateAt(ts: number): string {
  return dateKey(ts);
}

/**
 * Ya se jugo el diario de esa fecha?
 *
 * El intento se consume al ARRANCAR la run (no al terminarla): si se consumiera
 * al terminar, cerrar la app a mitad permitiria repetir el mismo diario tantas
 * veces como se quiera y quedarse con la mejor. Con la semilla fija no hay
 * reroll del contenido, pero si de la ejecucion.
 */
export function dailyPlayed(profile: ProfileSave, date: string): boolean {
  return profile.daily.playedDate === date;
}

/** Atajo de `dailyPlayed` para el instante actual (fecha local). */
export function dailyPlayedToday(profile: ProfileSave, ts: number): boolean {
  return dailyPlayed(profile, dailyDateAt(ts));
}
