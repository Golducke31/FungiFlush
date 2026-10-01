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

/**
 * Nivel de calidad grafica. `auto` deja que el juego lo detecte por
 * dispositivo; el resto lo fuerza el jugador. Vive en el perfil y no en un
 * ajuste suelto porque un celular de gama baja tiene que poder dejarlo en `low`
 * y no volver a tocarlo nunca.
 */
export type QualitySetting = 'auto' | 'low' | 'medium' | 'high';

export interface ProfileSettings {
  lang: Language;
  reduceMotion: boolean;
  quality: QualitySetting;
  sfxVolume: number;
  musicVolume: number;
  haptics: boolean;
  /**
   * Avisos del sistema. Arrancan en `true` pero el permiso se pide RECIEN
   * cuando el jugador hace algo que lo justifica (ver `src/notify/notify.ts`):
   * pedirlo en frio al abrir la app es la forma mas rapida de que lo denieguen
   * para siempre. El banner in-app funciona igual si estan en `false`.
   */
  notifyDaily: boolean;
  notifyAchievements: boolean;
}

/**
 * Recompensa diaria y su racha.
 *
 * `lastClaimDate` es la fuente de verdad ('YYYY-MM-DD' en hora LOCAL) y
 * `lastClaimTs` existe solo para detectar relojes atrasados: sin el, adelantar
 * el dia del dispositivo daria una racha infinita. Ver `evaluateDaily`.
 */
export interface DailyState {
  lastClaimDate: string | null;
  lastClaimTs: number;
  streak: number;
  bestStreak: number;
  /** Dias ya reclamados, 'YYYY-MM-DD'. Solo para poder medir retencion. */
  history: string[];
}

/** Logros desbloqueados y el progreso de los incrementales. */
export interface AchievementState {
  unlockedIds: string[];
  /** id -> valor actual (un logro incremental guarda su contador parcial). */
  progress: Record<string, number>;
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
    /**
     * De donde salio cada desbloqueo: id -> 'daily' | 'achievement' | 'season' | 'unlock'.
     * Es lo que permite que la Coleccion diga "la ganaste con la racha diaria"
     * en vez de mostrar un candado generico.
     */
    unlockSource: Record<string, string>;
    /**
     * Condiciones de desbloqueo PUBLICADAS por `UnlockTracker`, id -> clave i18n.
     *
     * Existe porque el candado necesita EXPLICARSE y el `PackGate` no puede
     * saberlo solo: un pack bloqueado se describe con el titulo del pack, pero
     * una carta bloqueada por jugar necesita decir "ganá 3 veces". Esa frase la
     * conoce el tracker (que tiene la condicion), no el gate.
     *
     * Es una COPIA de solo lectura del JSON de reglas, no el estado del
     * jugador: se reescribe entera en cada arranque. Que el jugador la edite no
     * rompe nada — la condicion real se evalua siempre contra el evento, y el
     * desbloqueo se escribe en `unlockedCardIds`.
     */
    pendingUnlocks: Record<string, string>;
  };
  /** Recompensa diaria y racha. Ver `DailyState`. */
  daily: DailyState;
  /** Logros permanentes. Ver `AchievementState`. */
  achievements: AchievementState;
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
      quality: 'auto',
      sfxVolume: 0.8,
      musicVolume: 0.6,
      haptics: true,
      notifyDaily: true,
      notifyAchievements: true,
    },
    // Comprar la app otorga el pack base. Nunca se pone detras de otro pago.
    entitlements: {
      owned: ['pack.base'],
      passes: [],
      offlineGraceMs: DEFAULT_OFFLINE_GRACE_MS,
    },
    collection: {
      seenCardIds: [],
      unlockedCardIds: [],
      unlockedJokerIds: [],
      unlockSource: {},
      pendingUnlocks: {},
    },
    daily: { lastClaimDate: null, lastClaimTs: 0, streak: 0, bestStreak: 0, history: [] },
    achievements: { unlockedIds: [], progress: {} },
    cosmetics: { equippedCardBack: 'default', equippedFelt: 'default', owned: ['default'] },
    starterOverrides: [],
    stats: { runs: 0, wins: 0, bestAnte: 0, totalXp: 0, playtimeMs: 0 },
    board: { hotSeatWins: 0, hotSeatLosses: 0 },
  };
}
