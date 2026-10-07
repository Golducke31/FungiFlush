/**
 * Account.ts — Identidad del jugador y sincronizacion del progreso meta.
 *
 * El juego se puede jugar ENTERO offline: la cuenta es OPCIONAL. Vincularla
 * habilita sincronizar la Colonia entre dispositivos y, mas adelante, el
 * ranking por temporadas. Nada del juego base depende de esto.
 *
 * DOS MITADES, a proposito:
 *   1. **Transiciones puras** sobre `ProfileSave.account` (linkAccount,
 *      queueRunResult, markSynced...). Se testean sin navegador ni red.
 *   2. **Proveedores** (`AccountProvider`): la parte que habla con el mundo.
 *      `createGooglePlayProvider()` es el puente a Google Play Games Services.
 *      Es la UNICA pieza que necesita el contenedor nativo.
 *
 * ANTI-TRAMPA: lo que viaja al servidor es el RESULTADO de la run (modo, Ciegos
 * superados, score, version), nunca las Esporas calculadas por el cliente. El
 * servidor recalcula. Ver `ColonyRunResult` en `ProfileState.ts`.
 */

import { PENDING_RESULTS_CAP, type AccountState, type ColonyRunResult, type ProfileSave } from './ProfileState';

export interface AccountIdentity {
  id: string;
  displayName: string;
  /** Proveedor que emitio la identidad. `local` = cuenta propia, sin Google. */
  provider: 'google-play' | 'local';
}

/**
 * Contrato minimo de un proveedor de cuentas.
 *
 * `isAvailable()` es distinto de "hay sesion": en el navegador de escritorio no
 * hay Play Games, asi que la UI tiene que poder decir "no disponible en este
 * dispositivo" en vez de ofrecer un boton que va a fallar.
 */
export interface AccountProvider {
  readonly id: 'google-play';
  /** El dispositivo soporta el proveedor (Tauri + Android + plugin presente). */
  isAvailable(): Promise<boolean>;
  /** Abre el flujo de inicio de sesion. `null` = el jugador cancelo. */
  signIn(): Promise<AccountIdentity | null>;
  signOut(): Promise<void>;
}

/** `true` cuando corremos dentro del contenedor Tauri (no en un navegador). */
export function isTauriRuntime(): boolean {
  if (typeof window === 'undefined') return false;
  const w = window as unknown as Record<string, unknown>;
  return '__TAURI_INTERNALS__' in w || '__TAURI__' in w;
}

/**
 * Comandos nativos que expone el contenedor. Son NUESTROS (no de un plugin de
 * terceros) para que el contrato quede escrito aca y no dependa de la version
 * de un paquete externo. Ver `docs/PLAN_COLONIA_Y_GOOGLE_PLAY.md`.
 */
export const PLAY_GAMES_COMMANDS = {
  available: 'google_play_available',
  signIn: 'google_play_sign_in',
  signOut: 'google_play_sign_out',
} as const;

/**
 * Proveedor de Google Play Games Services.
 *
 * En el navegador (dev, smoke, escritorio) `isAvailable()` devuelve `false` y
 * nunca se llama a `invoke`: asi el build web no depende de nada nativo.
 */
export function createGooglePlayProvider(): AccountProvider {
  const invokeNative = async <T>(command: string, args?: Record<string, unknown>): Promise<T> => {
    const core = (await import('@tauri-apps/api/core')) as {
      invoke: <R>(cmd: string, payload?: Record<string, unknown>) => Promise<R>;
    };
    return core.invoke<T>(command, args);
  };

  return {
    id: 'google-play',
    async isAvailable(): Promise<boolean> {      if (!isTauriRuntime()) return false;
      try {
        return (await invokeNative<boolean>(PLAY_GAMES_COMMANDS.available)) === true;
      } catch {
        // El comando no existe todavia (contenedor viejo) o el plugin fallo:
        // se trata como "no disponible", nunca como un error fatal.
        return false;
      }
    },
    async signIn(): Promise<AccountIdentity | null> {
      const result = await invokeNative<{ id?: string; displayName?: string } | null>(
        PLAY_GAMES_COMMANDS.signIn,
      );
      if (!result || typeof result.id !== 'string' || result.id.length === 0) return null;
      return {
        id: result.id,
        displayName: result.displayName ?? result.id,
        provider: 'google-play',
      };
    },
    async signOut(): Promise<void> {
      await invokeNative<null>(PLAY_GAMES_COMMANDS.signOut);
    },
  };
}

// ---------------------------------------------------------------------------
// Transiciones puras sobre el perfil
// ---------------------------------------------------------------------------

/** Vincula una identidad. Si cambia de cuenta, el progreso local se conserva. */
export function linkAccount(profile: ProfileSave, identity: AccountIdentity): void {
  const account = profile.account;
  const sameAccount = account.accountId === identity.id;
  account.provider = identity.provider;
  account.accountId = identity.id;
  account.displayName = identity.displayName;
  // Al vincular por primera vez hay progreso local sin subir: queda pendiente.
  account.syncState = account.pendingResults.length > 0 || !sameAccount ? 'pending' : 'synced';
}

/** Desvincula la cuenta. El progreso LOCAL se conserva: la cuenta es opcional. */
export function unlinkAccount(profile: ProfileSave): void {
  const account = profile.account;
  account.provider = 'none';
  account.accountId = null;
  account.displayName = null;
  account.syncState = 'offline';
}

/** Encola el resultado de una run terminada. Capeado y sin duplicar `runId`. */
export function queueRunResult(profile: ProfileSave, result: ColonyRunResult): void {
  const account = profile.account;
  if (account.pendingResults.some((r) => r.runId === result.runId)) return;
  account.pendingResults.push(result);
  if (account.pendingResults.length > PENDING_RESULTS_CAP) {
    account.pendingResults.splice(0, account.pendingResults.length - PENDING_RESULTS_CAP);
  }
  if (account.provider !== 'none') account.syncState = 'pending';
}

/** El servidor confirmo el progreso: se vacia la cola. */
export function markSynced(profile: ProfileSave, at: string): void {
  const account = profile.account;
  account.pendingResults = [];
  account.syncState = 'synced';
  account.lastSyncAt = at;
  profile.colony.lastSyncAt = at;
}

/** El servidor tiene progreso distinto (dos dispositivos). */
export function markConflict(profile: ProfileSave): void {
  profile.account.syncState = 'conflict';
}

/**
 * Arma el resumen que se sube. NO incluye Esporas: el servidor las recalcula a
 * partir de esto (anti-trampa).
 */
export function makeRunResult(input: {
  runId: string;
  startedAt: string;
  completedAt: string;
  mode: ColonyRunResult['mode'];
  highestBlind: number;
  completedBlinds: number;
  scoreSummary: number;
  clientVersion: string;
}): ColonyRunResult {
  return { ...input };
}

/** Etiqueta i18n del estado de sync, para la UI. */
export function syncStateLabelKey(state: AccountState['syncState']): string {
  switch (state) {
    case 'pending':
      return 'colony.account.sync.pending';
    case 'synced':
      return 'colony.account.sync.synced';
    case 'conflict':
      return 'colony.account.sync.conflict';
    case 'offline':
    default:
      return 'colony.account.sync.offline';
  }
}
