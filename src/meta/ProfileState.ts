/**
 * ProfileState.ts — Estado meta del jugador (fuera de la run).
 *
 * El motor NO conoce nada de esto. Vive aparte por dos razones:
 *   1. una run se borra al terminar; el perfil es permanente,
 *   2. es lo que se migra con mas cuidado (perder la coleccion de un jugador
 *      que pago es infinitamente peor que perder una partida).
 *
 * Todo es JSON plano: nada de Sets ni Maps, para que serializar sea trivial y
 * la migracion sea una funcion pura testeable.
 */

export const PROFILE_SAVE_VERSION = 1;

export type Language = 'en' | 'es';

export interface ProfileSettings {
  lang: Language;
  reduceMotion: boolean;
  sfxVolume: number;
  musicVolume: number;
  haptics: boolean;
}

/** Estado de un pase de temporada. */
export interface PassState {
  seasonId: string;
  xp: number;
  /** Premium comprado (habilita el track de pago). */
  premium: boolean;
  /** Tiers ya reclamados, como "f12" / "p12" (free / premium). */
  claimed: string[];
  /** Fin de la temporada (epoch ms). */
  expiresAt?: number;
}

/** Snapshot de entitlements. Es lo que se persiste y lo que consulta PackGate. */
export interface EntitlementSnapshot {
  /** Claves poseidas (ej: "pack.base", "pack.expansion_rotwood"). */
  owned: string[];
  passes: PassState[];
  /** Ultima reconciliacion exitosa con la tienda (epoch ms). */
  checkedAt?: number;
  /** Cuanto se confia en `owned` sin volver a consultar. Default 14 dias. */
  offlineGraceMs: number;
}

export interface ProfileSave {
  version: number;
  updatedAt: string;
  settings: ProfileSettings;
  entitlements: EntitlementSnapshot;
  collection: {
    seenCardIds: string[];
    unlockedCardIds: string[];
    unlockedJokerIds: string[];
  };
  cosmetics: {
    equippedCardBack: string;
    equippedFelt: string;
    owned: string[];
  };
  /** Copias extra en el mazo inicial, ganadas por recompensas del pase. */
  starterOverrides: Array<{ cardId: string; copies: number }>;
  stats: {
    runs: number;
    wins: number;
    bestAnte: number;
    totalXp: number;
    playtimeMs: number;
  };
  board: {
    hotSeatWins: number;
    hotSeatLosses: number;
    lastSeed?: number;
  };
}

export const DEFAULT_OFFLINE_GRACE_MS = 14 * 24 * 60 * 60 * 1000;

export function defaultProfile(): ProfileSave {
  return {
    version: PROFILE_SAVE_VERSION,
    updatedAt: new Date().toISOString(),
    settings: {
      lang: 'es',
      reduceMotion: false,
      sfxVolume: 0.8,
      musicVolume: 0.6,
      haptics: true,
    },
    // Comprar la app otorga el pack base. Nunca se pone detras de otro pago.
    entitlements: {
      owned: ['pack.base'],
      passes: [],
      offlineGraceMs: DEFAULT_OFFLINE_GRACE_MS,
    },
    collection: { seenCardIds: [], unlockedCardIds: [], unlockedJokerIds: [] },
    cosmetics: { equippedCardBack: 'default', equippedFelt: 'default', owned: ['default'] },
    starterOverrides: [],
    stats: { runs: 0, wins: 0, bestAnte: 0, totalXp: 0, playtimeMs: 0 },
    board: { hotSeatWins: 0, hotSeatLosses: 0 },
  };
}
