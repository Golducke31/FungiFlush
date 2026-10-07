/**
 * Colony.ts — Meta-progresion de la Colonia Fungi ("Esporas de Colonia").
 *
 * CAPA SEPARADA DEL COMBATE. Las partidas alimentan a la Colonia, pero la
 * Colonia NO modifica las reglas, las cartas ni las puntuaciones: no compra
 * cartas mas fuertes, no da Sustrato/Esporas, no recupera manos ni descartes y
 * no altera las probabilidades de la tienda. Es progresion, identidad y
 * prestigio.
 *
 * DOS RECURSOS DISTINTOS, A PROPOSITO:
 *   - **Esporas** (de partida): el multiplicador que participa en la puntuacion
 *     de una mano. Viven en el motor y se borran con la run.
 *   - **Esporas de Colonia**: currency PERMANENTE que se gana al superar Ciegos.
 *     Vive en el perfil (`ProfileSave.colony`) y nunca entra al motor.
 *
 * La UI NUNCA debe llamar "Esporas" a las dos cosas: la de partida es "Esporas"
 * y la meta es "Esporas de Colonia".
 *
 * PURO: no toca el DOM, no lee el reloj por su cuenta (`now` entra por
 * parametro) y no conoce el motor. Todo lo que muta lo muta sobre el objeto
 * `ColonyProgress` que le pasa el llamador (que envuelve en
 * `profileStore.patch`), igual que DailyReward / SeasonTracker.
 */

/** Estado persistido de la Colonia. Todo JSON plano (serializable trivial). */
export interface ColonyProgress {
  /** Esporas de Colonia acumuladas de por vida. Es la moneda meta. */
  lifetimeSpores: number;
  /** Nivel actual (1-based; 1 = colonia inicial). Derivado de `lifetimeSpores`. */
  level: number;
  /** Ids de recompensas ya desbloqueadas por nivel. */
  unlockedRewards: string[];
  /** Esporas ganadas en la temporada en curso (para el ranking futuro). */
  seasonSpores: number;
  /** Id de la temporada en curso. `''` = sin temporada. */
  seasonId: string;
  /** Fecha (ISO) del ultimo sync con la nube, o null. */
  lastSyncAt: string | null;
  /**
   * Claves `"ante:blindIndex"` de Ciegos superados ALGUNA VEZ en la vida del
   * perfil. Es la memoria del anti-farm: la primera superacion paga completo,
   * las repeticiones pagan `REPEAT_MULTIPLIER`.
   */
  firstClears: string[];
  /** Tope blando diario: dia local 'YYYY-MM-DD' del ultimo premio. */
  dailyAwardedDate: string;
  /** Cuantos Ciegos se premiaron HOY (para el tope blando diario). */
  dailyAwardedCount: number;
}

export function defaultColonyProgress(): ColonyProgress {
  return {
    lifetimeSpores: 0,
    level: 1,
    unlockedRewards: [],
    seasonSpores: 0,
    seasonId: '',
    lastSyncAt: null,
    firstClears: [],
    dailyAwardedDate: '',
    dailyAwardedCount: 0,
  };
}

// ---------------------------------------------------------------------------
// Recompensa por Ciego superado
// ---------------------------------------------------------------------------

/**
 * Esporas base por ante (indice = ante - 1).
 *
 * El grueso de la recompensa viene de SUPERAR CIEGOS, no de repetir el primero:
 * la actividad principal tiene que seguir siendo jugar.
 */
export const BLIND_BASE_SPORES = [50, 75, 100, 130, 165, 205, 250, 300] as const;

/** Esporas base de un ante. Extrapola si el contenido agrega antes mas alla del 8. */
export function blindBaseSpores(ante: number): number {
  const index = Math.max(1, Math.floor(ante)) - 1;
  if (index < BLIND_BASE_SPORES.length) return BLIND_BASE_SPORES[index] ?? 0;
  // Cola: la tabla termina en 300 (ante 8) y sigue subiendo de a 75.
  return 300 + (index - (BLIND_BASE_SPORES.length - 1)) * 75;
}

/**
 * Multiplicador de una REPETICION. "Nunca llega a cero": repetir un Ciego ya
 * superado sigue pagando, solo que menos. Si llegara a cero, el jugador que
 * rejuega por gusto no creceria nunca y la colonia se sentiria castigada.
 */
export const REPEAT_MULTIPLIER = 0.4;

/** Ciegos premiados a valor completo por dia. Despues, `REPEAT_MULTIPLIER`. */
export const DAILY_FULL_AWARDS = 5;

/** Bonificaciones secundarias: chicas a proposito (el grueso es el Ciego). */
export const BONUS_FIRST_HAND = 10;
export const BONUS_DISCARDS_LEFT = 5;
export const BONUS_MISSION = 20;
export const BONUS_DAILY = 50;
export const BONUS_STREAK_STEP = 10;
export const BONUS_STREAK_CAP = 100;

export interface ColonyBonus {
  /** Id estable (para el desglose de la UI). */
  id: string;
  nameKey: string;
  amount: number;
}

export interface ColonyAward {
  /** Clave `"ante:blindIndex"` del Ciego premiado. */
  key: string;
  /** Esporas base de la tabla (antes del multiplicador). */
  base: number;
  /** 1 (primera vez) o `REPEAT_MULTIPLIER` (repeticion / tope diario). */
  multiplier: number;
  /** Bonificaciones de la superacion. */
  bonuses: ColonyBonus[];
  /** Esporas que se acreditan. */
  total: number;
  firstClear: boolean;
  /** El multiplicador salio del tope blando diario, no de una repeticion. */
  dailyCapped: boolean;
}

export interface BlindAwardContext {
  ante: number;
  blindIndex: number;
  /** El Ciego se supero en la PRIMERA mano (no se gasto ninguna de mas). */
  firstHandClear: boolean;
  /** Descartes que sobraron al superarlo. */
  discardsLeft: number;
  /** epoch ms. Entra por parametro: la funcion es pura. */
  now: number;
}

/** Dia local 'YYYY-MM-DD'. El dia del JUGADOR, no el de Greenwich. */
export function localDateKey(ts: number): string {
  const d = new Date(ts);
  const month = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${d.getFullYear()}-${month}-${day}`;
}

/**
 * Calcula (SIN mutar) lo que paga superar un Ciego.
 *
 * Anti-farm: la primera superacion de un Ciego paga completo; repetirlo paga
 * `REPEAT_MULTIPLIER`. Ademas hay un tope BLANDO diario (no bloquea el juego,
 * solo reduce) para que repetir el primer Ciego en bucle no sea rentable.
 */
export function computeBlindAward(progress: ColonyProgress, ctx: BlindAwardContext): ColonyAward {
  const key = `${ctx.ante}:${ctx.blindIndex}`;
  const firstClear = !progress.firstClears.includes(key);
  const today = localDateKey(ctx.now);
  const dailyCapped =
    progress.dailyAwardedDate === today && progress.dailyAwardedCount >= DAILY_FULL_AWARDS;
  const multiplier = firstClear && !dailyCapped ? 1 : REPEAT_MULTIPLIER;

  const base = blindBaseSpores(ctx.ante);
  const bonuses: ColonyBonus[] = [];
  if (ctx.firstHandClear) {
    bonuses.push({ id: 'firstHand', nameKey: 'colony.bonus.firstHand', amount: BONUS_FIRST_HAND });
  }
  if (ctx.discardsLeft > 0) {
    bonuses.push({ id: 'discards', nameKey: 'colony.bonus.discards', amount: BONUS_DISCARDS_LEFT });
  }

  const baseAwarded = Math.max(1, Math.round(base * multiplier));
  const total = baseAwarded + bonuses.reduce((sum, b) => sum + b.amount, 0);

  return { key, base, multiplier, bonuses, total, firstClear, dailyCapped };
}

// ---------------------------------------------------------------------------
// Niveles
// ---------------------------------------------------------------------------

export interface ColonyLevelDef {
  level: number;
  /** Esporas ACUMULADAS necesarias para alcanzar el nivel. */
  spores: number;
  /** Id de la recompensa, o null si el nivel no otorga nada. */
  rewardId: string | null;
  /** Clave i18n del nombre de la recompensa. */
  rewardNameKey: string | null;
}

/**
 * Escalera de niveles: arranca rapida y se estira. El primer ascenso NO puede
 * tardar horas (100 Esporas se juntan en el primer Ciego), y los ultimos
 * niveles son objetivos largos.
 *
 * Los nombres de nivel NO viven aca: son bandas (`colonyLevelNameKey`), asi que
 * agregar niveles mas alla del 10 no obliga a tocar i18n.
 */
export const COLONY_LEVELS: readonly ColonyLevelDef[] = [
  { level: 1, spores: 0, rewardId: null, rewardNameKey: null },
  { level: 2, spores: 100, rewardId: 'frame_common', rewardNameKey: 'colony.reward.frame_common' },
  { level: 3, spores: 250, rewardId: 'pack_spores', rewardNameKey: 'colony.reward.pack_spores' },
  { level: 4, spores: 450, rewardId: 'bg_new', rewardNameKey: 'colony.reward.bg_new' },
  { level: 5, spores: 700, rewardId: 'title_mycelium', rewardNameKey: 'colony.reward.title_mycelium' },
  { level: 6, spores: 1000, rewardId: 'victory_fx', rewardNameKey: 'colony.reward.victory_fx' },
  { level: 7, spores: 1400, rewardId: 'pack_colony', rewardNameKey: 'colony.reward.pack_colony' },
  { level: 8, spores: 1850, rewardId: 'avatar', rewardNameKey: 'colony.reward.avatar' },
  { level: 9, spores: 2350, rewardId: 'frame_uncommon', rewardNameKey: 'colony.reward.frame_uncommon' },
  { level: 10, spores: 3000, rewardId: 'title_established', rewardNameKey: 'colony.reward.title_established' },
] as const;

/** Ultimo nivel con recompensa escrita a mano. Mas alla, la escalera extrapola. */
export const COLONY_LAST_DEFINED_LEVEL = COLONY_LEVELS.length;

/** Esporas acumuladas necesarias para alcanzar `level`. Monotona. */
export function levelThreshold(level: number): number {
  const target = Math.max(1, Math.floor(level));
  const def = COLONY_LEVELS[target - 1];
  if (def) return def.spores;
  // Cola: desde el ultimo nivel definido, cada nivel cuesta 450 y sube de a 150.
  let total = COLONY_LEVELS[COLONY_LEVELS.length - 1]?.spores ?? 0;
  for (let n = COLONY_LAST_DEFINED_LEVEL + 1; n <= target; n++) {
    total += 300 + (n - COLONY_LAST_DEFINED_LEVEL) * 150;
  }
  return total;
}

/** Nivel mas alto alcanzado por esas Esporas acumuladas. Siempre >= 1. */
export function levelForSpores(spores: number): number {
  const total = Math.max(0, spores);
  let level = 1;
  // Recorre la tabla definida y, si la supera, sigue extrapolando.
  for (const def of COLONY_LEVELS) {
    if (total >= def.spores) level = def.level;
  }
  while (total >= levelThreshold(level + 1)) level += 1;
  return level;
}

/**
 * Nombre del nivel por BANDAS (no uno por nivel): asi la escalera puede crecer
 * sin tocar i18n y el jugador igual siente que "la colonia cambio".
 */
export function colonyLevelNameKey(level: number): string {
  if (level >= 50) return 'colony.band.primordial';
  if (level >= 30) return 'colony.band.underground';
  if (level >= 20) return 'colony.band.deep';
  if (level >= 10) return 'colony.band.emerging';
  if (level >= 5) return 'colony.band.sprout';
  return 'colony.band.dormant';
}

export interface ColonyLevelView {
  level: number;
  /** Esporas acumuladas al entrar al nivel. */
  spores: number;
  /** Esporas necesarias para el proximo nivel. */
  nextSpores: number;
  /** Progreso dentro del nivel, 0..1. */
  progress: number;
  /** Faltante para subir. */
  remaining: number;
  rewardId: string | null;
  rewardNameKey: string | null;
  unlocked: boolean;
}

/** Vista de la escalera completa para el panel de Recompensas. */
export function levelViews(progress: ColonyProgress, count = COLONY_LAST_DEFINED_LEVEL): ColonyLevelView[] {
  const views: ColonyLevelView[] = [];
  for (let level = 1; level <= count; level++) {
    const def = COLONY_LEVELS[level - 1];
    views.push({
      level,
      spores: levelThreshold(level),
      nextSpores: levelThreshold(level + 1),
      progress: 0,
      remaining: 0,
      rewardId: def?.rewardId ?? null,
      rewardNameKey: def?.rewardNameKey ?? null,
      unlocked: progress.level >= level,
    });
  }
  return views;
}

export interface NextLevelInfo {
  level: number;
  /** Esporas acumuladas del nivel actual. */
  current: number;
  /** Esporas acumuladas del proximo nivel. */
  next: number;
  /** Faltante para subir. */
  remaining: number;
  /** Progreso dentro del nivel actual, 0..1. */
  progress: number;
  rewardId: string | null;
  rewardNameKey: string | null;
}

/** Lo que la UI necesita para dibujar "Nivel 4 · 1.850 / 2.500" + la barra. */
export function nextLevelInfo(progress: ColonyProgress): NextLevelInfo {
  const level = progress.level;
  const current = levelThreshold(level);
  const next = levelThreshold(level + 1);
  const span = Math.max(1, next - current);
  const into = Math.max(0, progress.lifetimeSpores - current);
  const def = COLONY_LEVELS[level];
  return {
    level,
    current,
    next,
    remaining: Math.max(0, next - progress.lifetimeSpores),
    progress: Math.max(0, Math.min(1, into / span)),
    rewardId: def?.rewardId ?? null,
    rewardNameKey: def?.rewardNameKey ?? null,
  };
}

// ---------------------------------------------------------------------------
// Mutaciones
// ---------------------------------------------------------------------------

export interface GrantResult {
  levelBefore: number;
  levelAfter: number;
  /** Ids de recompensa desbloqueados por esta subida. */
  newRewards: string[];
}

/**
 * Suma Esporas de Colonia y recalcula el nivel. MUTA `progress` (el llamador lo
 * envuelve en `profileStore.patch`). Devuelve que subio, para festejarlo.
 */
export function grantSpores(progress: ColonyProgress, amount: number): GrantResult {
  const levelBefore = progress.level;
  progress.lifetimeSpores = Math.max(0, progress.lifetimeSpores + Math.round(amount));
  progress.seasonSpores = Math.max(0, progress.seasonSpores + Math.round(amount));
  const levelAfter = levelForSpores(progress.lifetimeSpores);
  const newRewards: string[] = [];
  if (levelAfter > levelBefore) {
    for (let level = levelBefore + 1; level <= levelAfter; level++) {
      const def = COLONY_LEVELS[level - 1];
      if (def?.rewardId && !progress.unlockedRewards.includes(def.rewardId)) {
        progress.unlockedRewards.push(def.rewardId);
        newRewards.push(def.rewardId);
      }
    }
    progress.level = levelAfter;
  }
  // El nivel nunca baja, ni aunque un dato viejo llegara raro.
  progress.level = Math.max(progress.level, levelAfter);
  return { levelBefore, levelAfter, newRewards };
}

/** Acredita un Ciego superado: Esporas + memoria de anti-farm + tope diario. */
export function applyBlindAward(
  progress: ColonyProgress,
  award: ColonyAward,
  now: number,
): GrantResult {
  if (award.firstClear && !progress.firstClears.includes(award.key)) {
    progress.firstClears.push(award.key);
  }
  const today = localDateKey(now);
  if (progress.dailyAwardedDate !== today) {
    progress.dailyAwardedDate = today;
    progress.dailyAwardedCount = 0;
  }
  progress.dailyAwardedCount += 1;
  return grantSpores(progress, award.total);
}

/** Bonificaciones sueltas (mision, diaria, racha) sin tocar el anti-farm. */
export function bonusForMission(): ColonyBonus {
  return { id: 'mission', nameKey: 'colony.bonus.mission', amount: BONUS_MISSION };
}

export function bonusForDaily(streak: number): ColonyBonus {
  const amount = Math.min(BONUS_STREAK_CAP, Math.max(0, Math.floor(streak)) * BONUS_STREAK_STEP);
  return { id: 'daily', nameKey: 'colony.bonus.daily', amount: BONUS_DAILY + amount };
}
