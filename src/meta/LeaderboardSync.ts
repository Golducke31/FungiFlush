/**
 * LeaderboardSync.ts — Orquestacion del sync del ranking (V1.3).
 *
 * Es la unica pieza que junta las tres capas: el perfil (libro local), el
 * transporte (red) y el modelo del tablero. El llamador le pasa un
 * `LeaderboardTransport` ya construido, asi que esto se testea con un transporte
 * falso y sin red.
 *
 * QUE HACE Y QUE NO:
 *   - Sube los resultados PENDIENTES (`account.pendingResults`) uno por uno y
 *     los saca de la cola cuando el servidor los acepta.
 *   - Guarda el tablero en el perfil para que el panel se dibuje sin red.
 *   - NO re-acredita Esporas locales. Las Esporas se acreditan al superar cada
 *     Ciego (offline-first); volver a acreditarlas al sincronizar duplicaria la
 *     recompensa en cada reintento. El servidor es la fuente de verdad del
 *     TABLERO, no del libro local.
 *   - Un resultado RECHAZADO por el servidor se marca como conflicto y se
 *     muestra, pero nunca borra hacia atras lo ya ganado.
 *
 * ANTE UN ERROR DE RED se corta y se deja el resto en la cola: reintentar es
 * barato y la cola esta capeada (`PENDING_RESULTS_CAP`).
 */

import {
  markConflict,
  markSynced,
  type AccountIdentity,
} from './Account';
import type { LeaderboardBoard, LeaderboardScope, SubmitResult } from './Leaderboard';
import type { ProfileSave } from './ProfileState';
import type { LeaderboardTransport } from '../net/LeaderboardClient';

export interface SubmitOutcome {
  /** Resultados aceptados por el servidor en esta pasada. */
  submitted: number;
  /** Resultados que el servidor RECHAZO (anti-trampa, version vieja...). */
  rejected: number;
  /** Habia algo para subir? Sirve para decidir si vale la pena refrescar. */
  hadWork: boolean;
  /** Mensaje de error de red, o `null`. */
  error: string | null;
}

/**
 * Sube la cola de resultados. Idempotente: reenviar el mismo `runId` no duplica
 * nada porque el servidor lo ignora.
 */
export async function flushPendingResults(
  profile: ProfileSave,
  transport: LeaderboardTransport,
  identity: AccountIdentity | null,
  now: number,
): Promise<SubmitOutcome> {
  const account = profile.account;
  if (!transport.enabled || !identity) {
    return { submitted: 0, rejected: 0, hadWork: false, error: null };
  }

  const pending = [...account.pendingResults];
  if (pending.length === 0) {
    return { submitted: 0, rejected: 0, hadWork: false, error: null };
  }

  let submitted = 0;
  let rejected = 0;
  let lastResult: SubmitResult | null = null;

  for (const result of pending) {
    try {
      const response = await transport.submit({ playerId: identity.id, result });
      submitted += 1;
      lastResult = response;
      if (response.rejected) rejected += 1;
      // Se saca de la cola SOLO cuando el servidor contesto.
      const index = account.pendingResults.findIndex((r) => r.runId === result.runId);
      if (index >= 0) account.pendingResults.splice(index, 1);
    } catch (error) {
      // Red caida: se corta aca y el resto espera a la proxima. No se pierde nada.
      return {
        submitted,
        rejected,
        hadWork: true,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  // El servidor devuelve su total verificado: se guarda para poder mostrar en el
  // panel con que numero se calcula la posicion (puede diferir del local si el
  // anti-trampa recorto alguna run).
  if (lastResult) account.verifiedSpores = lastResult.lifetimeSpores;

  if (rejected > 0) markConflict(profile);
  else markSynced(profile, new Date(now).toISOString());

  return { submitted, rejected, hadWork: true, error: null };
}

export interface RefreshOutcome {
  season: LeaderboardBoard | null;
  lifetime: LeaderboardBoard | null;
  error: string | null;
}

/**
 * Trae los dos tableros y los deja cacheados en el perfil.
 *
 * Un tablero que falla NO invalida el otro: se guarda el que llego.
 */
export async function refreshBoards(
  profile: ProfileSave,
  transport: LeaderboardTransport,
  playerId: string | null,
  now: number,
): Promise<RefreshOutcome> {
  if (!transport.enabled) {
    return { season: null, lifetime: null, error: transport.disabledReason ?? 'sin servidor' };
  }

  let season: LeaderboardBoard | null = null;
  let lifetime: LeaderboardBoard | null = null;
  let error: string | null = null;

  for (const scope of ['season', 'lifetime'] as LeaderboardScope[]) {
    try {
      const board = await transport.fetchBoard(scope, playerId);
      if (scope === 'season') season = board;
      else lifetime = board;
      profile.account.leaderboard[scope] = board;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
  }

  if (season || lifetime) profile.account.leaderboard.fetchedAt = new Date(now).toISOString();
  return { season, lifetime, error };
}
