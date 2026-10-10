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

import type { ColonyProgress } from './Colony';
import { defaultColonyProgress } from './Colony';
import type { DeckState } from './DeckPresets';
import { defaultDeckState } from './DeckPresets';
import type { PackInventory } from './Packs';
import { defaultPackInventory } from './Packs';
import type { LeaderboardSnapshot } from './Leaderboard';
import { emptySnapshot } from './Leaderboard';

export const PROFILE_SAVE_VERSION = 7;

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
  /**
   * Orden automatico de la mano (Fase 3, 2026-10-05).
   *
   * Criterio: Familia -> Sustrato descendente -> orden original. Arranca en
   * `true`; apagarlo devuelve la mano al orden en que el motor la entrego.
   */
  autoSortHand: boolean;
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

/**
 * Estado de sincronizacion del progreso meta.
 *
 * Existe desde la v1 local aunque todavia no haya backend: el juego se puede
 * jugar entero offline, asi que el perfil tiene que poder decir en que estado
 * esta sin depender de una red. Es la maquina de estados del plan:
 *   offline  -> no hay cuenta vinculada (o no hay red): todo local.
 *   pending  -> hay resultados de run sin subir.
 *   synced   -> el servidor confirmo el progreso.
 *   conflict -> el servidor tiene progreso distinto (dos dispositivos).
 */
export type ColonySyncState = 'offline' | 'pending' | 'synced' | 'conflict';

/**
 * Resumen de una run terminada, listo para subir.
 *
 * ANTI-TRAMPA: el cliente NO manda las Esporas que cree haber ganado. Manda el
 * RESULTADO (que Ciegos supero, con que modo y que version) y el servidor
 * recalcula la recompensa. Mandar `{ sporesEarned: 999999 }` seria trivial de
 * modificar.
 */
export interface ColonyRunResult {
  runId: string;
  startedAt: string;
  completedAt: string;
  mode: 'classic' | 'daily' | 'ascension';
  /** Ante mas alto alcanzado (1..8). */
  highestBlind: number;
  /** Ciegos superados en la run. */
  completedBlinds: number;
  /** Score total de la run. */
  scoreSummary: number;
  /** Version del juego que genero el resultado. */
  clientVersion: string;
}

/** Identidad de la cuenta y estado del sync. Ver `src/meta/Account.ts`. */
export interface AccountState {
  /** Proveedor con el que se vinculo el progreso. */
  provider: 'none' | 'google-play' | 'local';
  /** Id persistente del jugador (Play Games player id, o id local). */
  accountId: string | null;
  /** Nombre visible que devolvio el proveedor. */
  displayName: string | null;
  syncState: ColonySyncState;
  /** Fecha (ISO) del ultimo sync exitoso. */
  lastSyncAt: string | null;
  /** Resultados de run pendientes de subir. Capeado por `PENDING_RESULTS_CAP`. */
  pendingResults: ColonyRunResult[];
  /**
   * Esporas de Colonia VALIDADAS por el servidor (V1.3), o `null` si nunca se
   * sincronizo. Es el numero con el que se calcula la posicion en el ranking:
   * puede diferir del local si el anti-trampa recorto alguna run.
   */
  verifiedSpores: number | null;
  /** Ultimo tablero conocido, cacheado para poder dibujar el panel sin red. */
  leaderboard: LeaderboardSnapshot;
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
    /**
     * Cuantas copias de cada carta tiene el jugador, id -> cantidad (v6).
     *
     * Lo alimenta la apertura de Sobres: un sobre NO mete cartas al mazo, pero
     * si suma especimenes. La Coleccion lo usa para mostrar el badge "xN" en vez
     * de repetir la misma carta tantas veces como copias haya.
     *
     * Solo cuenta CARTAS (los sobres nunca dan jokers) y solo copias obtenidas
     * de sobres; el mazo inicial de una run no infla este contador.
     */
    ownedCounts: Record<string, number>;
  };
  /** Recompensa diaria y racha. Ver `DailyState`. */
  daily: DailyState;
  /** Logros permanentes. Ver `AchievementState`. */
  achievements: AchievementState;
  cosmetics: {
    equippedCardBack: string;
    equippedFelt: string;
    /**
     * Tarjeta de Jugador (recompensas de la Colonia): avatar + marco + titulo +
     * fondo + efecto de victoria. `'default'` = sin cosmetico de ese tipo.
     * Aditivo: un perfil viejo no los tiene y la migracion cae a `'default'`.
     */
    equippedAvatar: string;
    equippedFrame: string;
    equippedTitle: string;
    equippedBackground: string;
    equippedVictoryFx: string;
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
  /**
   * Progresion de ascension (R1).
   *
   * `highestUnlocked` es el nivel mas alto que el jugador DESBLOQUEO ganando
   * (A0 siempre esta disponible). `selected` es el que tiene puesto en el menu;
   * puede ser menor o igual a `highestUnlocked`, nunca mayor.
   */
  ascension: {
    highestUnlocked: number;
    selected: number;
  };
  /**
   * Arquetipo elegido para la proxima run (id; ver `src/data/archetypes.json`).
   *
   * Se PERSISTE a proposito: es una preferencia de estilo de juego, no una
   * decision de una sola vez. Quien juega Esporas quiere volver a jugar Esporas
   * sin re-elegir. `''` = clasico (mazo base, sin sesgo de tienda).
   *
   * Aditivo: los perfiles viejos no lo tienen y la migracion cae a `''`.
   */
  archetype: {
    selected: string;
  };
  /**
   * El jugador YA puede elegir arquetipo (aditivo).
   *
   * La PRIMERA run arranca siempre con el mazo CLASICO: la pantalla de
   * arquetipos llega demasiado pronto para alguien que todavia aprende las
   * reglas, y elegir "una forma de puntuar" sin conocer el sistema no es una
   * decision, es ruido. Se desbloquea al superar el PRIMER Ciego (ver
   * `round:win` en `main.ts`), que es cuando el jugador ya jugo una mano y
   * entendio el circuito.
   *
   * Aditivo: un perfil viejo no lo tiene y la migracion lo deduce de
   * `stats.runs` (quien ya jugo una partida conserva el acceso).
   */
  archetypesUnlocked: boolean;
  /**
   * Historial de partidas (R5). Lo ultimo primero, capeado por `HISTORY_CAP`.
   *
   * `reason` distingue la victoria final (llegar al ante maximo) de una derrota
   * a mitad de camino; `at` es epoch ms para poder ordenar y agrupar. Es solo
   * lectura para la pantalla de historial: nada del motor lo consulta.
   */
  history: RunHistoryEntry[];
  /**
   * El jugador ya vio la guia de inicio (v2).
   *
   * Antes el tutorial se ofrecia una vez POR RUN, en memoria: alguien que
   * cerraba la app en el primer ciego lo volvia a ver en cada partida nueva, y
   * quien queria repasarlo no podia. Persistirlo lo convierte en "una vez en la
   * vida del perfil", y la guia queda ademas reabrible desde el menu.
   */
  seenTutorial: boolean;
  /** P1.5 — Estado abierto/plegado de paneles UI (aditivo, v3). */
  ui: {
    missionsOpen: boolean;
    helpOpen: boolean;
  };
  /**
   * Meta-progresion de la Colonia Fungi (v4). Ver `src/meta/Colony.ts`.
   *
   * Es la "Esporas de Colonia": currency PERMANENTE, separada de las Esporas de
   * partida. No entra al motor: no altera reglas, cartas ni puntuaciones.
   */
  colony: ColonyProgress;
  /** Cuenta y sincronizacion (v4). Ver `AccountState`. */
  account: AccountState;
  /**
   * Sobres ganados al superar Ciegos (v5). Ver `src/meta/Packs.ts`.
   *
   * Es un contador, no una lista: el sobre se SORTEA al abrirlo, no al ganarlo,
   * asi que guardar la semilla de cada sobre pendiente solo complicaria el save
   * sin cambiar la experiencia. Aditivo: los perfiles v4 no lo tienen y la
   * migracion arranca en cero (no se le inventan sobres por partidas viejas).
   */
  packs: PackInventory;
  /**
   * Mazos personalizados (v7). Ver `src/meta/DeckPresets.ts`.
   *
   * `presets` es la lista de mazos guardados y `selectedId` el que se juega
   * (o `''` = clasico). Es una PREFERENCIA, como `archetype.selected`, asi que
   * se persiste a proposito: quien armo su mazo no quiere re-armarlo.
   *
   * Aditivo: los perfiles v6 no lo tienen y la migracion cae a un preset vacio
   * sin elegir (nadie armo un mazo todavia). Los mazos se guardan como ids, no
   * como objetos de carta, para poder rebalancear sin invalidar guardados.
   */
  decks: DeckState;
}

/** Tope de resultados de run sin subir que se conservan. */
export const PENDING_RESULTS_CAP = 20;

/** Tope de entradas que se conservan en `history` (las mas viejas se descartan). */
export const HISTORY_CAP = 20;

export interface RunHistoryEntry {
  seed: number;
  /** Ante alcanzado (el ultimo jugado). */
  ante: number;
  /** Nivel de ascension con el que se jugo. */
  ascension: number;
  win: boolean;
  /** 'victory' = llego al ante maximo; 'loss' = murio en el camino. */
  reason: 'loss' | 'victory';
  /** epoch ms. */
  at: number;
  /**
   * Puntaje maximo de una sola mano en la run. Es el numero que el jugador
   * recuerda ("hice 40k de un saque"), y el que hace que dos derrotas se
   * distingan entre si.
   */
  bestHand?: number;
  /** Puntaje total acumulado de la run. */
  totalScore?: number;
  /** Ciegos superados. Mide QUE TAN LEJOS llego, no solo en que ante murio. */
  blindsCleared?: number;
  /** Cartas destruidas/purgadas: mide cuanto limpio su mazo. */
  cardsDestroyed?: number;
  /**
   * Arquetipo jugado (id; ver `src/data/archetypes.json`). Opcional porque las
   * partidas viejas —de antes de que existiera el arquetipo— no lo tienen.
   */
  archetype?: string;
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
      autoSortHand: true,
    },
    // Comprar la app otorga el pack base y la expansion incluida. Nunca se pone
    // detras de otro pago.
    entitlements: {
      owned: ['pack.base', 'pack.deep_mycelium'],
      passes: [],
      offlineGraceMs: DEFAULT_OFFLINE_GRACE_MS,
    },
    collection: {
      seenCardIds: [],
      unlockedCardIds: [],
      unlockedJokerIds: [],
      unlockSource: {},
      pendingUnlocks: {},
      ownedCounts: {},
    },
    daily: { lastClaimDate: null, lastClaimTs: 0, streak: 0, bestStreak: 0, history: [] },
    achievements: { unlockedIds: [], progress: {} },
    cosmetics: {
      equippedCardBack: 'default',
      equippedFelt: 'default',
      equippedAvatar: 'default',
      equippedFrame: 'default',
      equippedTitle: 'default',
      equippedBackground: 'default',
      equippedVictoryFx: 'default',
      owned: ['default', 'mycelial'],
    },
    starterOverrides: [],
    stats: { runs: 0, wins: 0, bestAnte: 0, totalXp: 0, playtimeMs: 0 },
    board: { hotSeatWins: 0, hotSeatLosses: 0 },
    ascension: { highestUnlocked: 0, selected: 0 },
    archetype: { selected: '' },
    archetypesUnlocked: false,
    history: [],
    seenTutorial: false,
    ui: { missionsOpen: false, helpOpen: false },
    colony: defaultColonyProgress(),
    account: {
      provider: 'none',
      accountId: null,
      displayName: null,
      syncState: 'offline',
      lastSyncAt: null,
      pendingResults: [],
      verifiedSpores: null,
      leaderboard: emptySnapshot(),
    },
    packs: defaultPackInventory(),
    decks: defaultDeckState(),
  };
}
