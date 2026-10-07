/**
 * Leaderboard.ts — Ranking global de Esporas de Colonia (V1.3).
 *
 * DOS TABLEROS, a proposito:
 *   - **Temporada**: mide lo ganado DURANTE la temporada. Es el competitivo, y
 *     evita que un jugador nuevo vea un muro imposible de cuentas viejas.
 *   - **Historica**: Esporas acumuladas desde el inicio. Es prestigio, no una
 *     carrera: nadie "pierde" su lugar por dejar de jugar una semana.
 *
 * PURO: sin DOM, sin red, sin reloj propio. El transporte HTTP vive en
 * `src/net/LeaderboardClient.ts`; aca solo hay modelos, reglas y validacion.
 *
 * REGLA DE ORO (anti-trampa): lo que se sube es el RESULTADO de la run
 * (`ColonyRunResult`), nunca las Esporas que el cliente cree haber ganado. El
 * servidor recalcula y es la fuente de verdad. Este modulo NUNCA calcula un
 * puntaje para mandar: solo lo LEE de vuelta.
 */

import type { ColonyRunResult, ProfileSave } from './ProfileState';

export type LeaderboardScope = 'season' | 'lifetime';

/** Una fila del tablero, ya validada. */
export interface LeaderboardEntry {
  playerId: string;
  displayName: string;
  /** Esporas de temporada o de por vida, segun el `scope` del tablero. */
  spores: number;
  /** Nivel de Colonia que declara el servidor para ese jugador. */
  level: number;
  /** ISO. Cuando el servidor vio por ultima vez a ese jugador. */
  updatedAt: string;
  /** `true` en la fila del jugador que esta mirando (la marca la UI). */
  isSelf: boolean;
}

export interface LeaderboardBoard {
  scope: LeaderboardScope;
  /** Id de la temporada. `''` en el tablero historico. */
  seasonId: string;
  entries: LeaderboardEntry[];
  /** Posicion del jugador (1-based), o `null` si no aparece en el tablero. */
  selfRank: number | null;
  /** Cuantos jugadores tiene el tablero. */
  total: number;
  /** ISO del momento en que el servidor armo la respuesta. */
  fetchedAt: string;
}

/** Snapshot cacheado en el perfil: el panel se puede dibujar sin red. */
export interface LeaderboardSnapshot {
  season: LeaderboardBoard | null;
  lifetime: LeaderboardBoard | null;
  /** ISO del ultimo fetch exitoso, o null. */
  fetchedAt: string | null;
}

export function emptySnapshot(): LeaderboardSnapshot {
  return { season: null, lifetime: null, fetchedAt: null };
}

// ---------------------------------------------------------------------------
// Recompensas por posicion
// ---------------------------------------------------------------------------

export interface RankTier {
  id: string;
  /** Corte de percentil (inclusive). El primero que entra, gana. */
  maxPercent: number;
  /** Id del desbloqueo (va a `colony.unlockedRewards`). */
  rewardId: string;
  /** Clave i18n del nombre de la recompensa. */
  nameKey: string;
}

/**
 * Escalera de premios por POSICION. Son todos cosmeticos: el plan prohibe
 * cualquier ventaja de juego, y el ranking no es la excepcion.
 *
 * Se corta por PERCENTIL y no por puesto absoluto: un tablero de 50 jugadores y
 * uno de 50.000 no pueden premiar lo mismo con "top 10".
 */
export const RANK_TIERS: readonly RankTier[] = [
  { id: 'top1', maxPercent: 1, rewardId: 'rank_title_legendary', nameKey: 'colony.rank.top1' },
  { id: 'top5', maxPercent: 5, rewardId: 'rank_victory_fx', nameKey: 'colony.rank.top5' },
  { id: 'top10', maxPercent: 10, rewardId: 'rank_season_badge', nameKey: 'colony.rank.top10' },
  { id: 'top25', maxPercent: 25, rewardId: 'rank_cosmetic_common', nameKey: 'colony.rank.top25' },
  { id: 'participation', maxPercent: 100, rewardId: 'rank_participation', nameKey: 'colony.rank.participation' },
] as const;

/** Percentil (0-100, redondeado hacia arriba) de una posicion en un tablero. */
export function percentileOf(rank: number, total: number): number {
  if (total <= 0) return 100;
  const safeRank = Math.max(1, Math.min(rank, total));
  return Math.max(1, Math.ceil((safeRank / total) * 100));
}

/** Premio que le toca a una posicion. Siempre devuelve algo (participacion). */
export function rankTierFor(rank: number, total: number): RankTier {
  const percentile = percentileOf(rank, total);
  return RANK_TIERS.find((tier) => percentile <= tier.maxPercent) ?? RANK_TIERS[RANK_TIERS.length - 1]!;
}

/** "12 de 340" — el formato que necesita la UI. */
export function formatRank(rank: number | null, total: number): string {
  if (rank === null) return '—';
  return `${rank} / ${total}`;
}

// ---------------------------------------------------------------------------
// Hitos personales
// ---------------------------------------------------------------------------

/**
 * Hitos que NO dependen del ranking.
 *
 * El plan es explicito: "premiaria ciertos hitos personales, no solo el
 * ranking". Un jugador que nunca va a entrar al top 1% igual tiene que sentir
 * que su colonia avanza.
 */
export interface ColonyMilestone {
  id: string;
  nameKey: string;
  rewardId: string;
  /** Se cumple cuando el perfil llega a este valor. */
  met: (profile: ProfileSave) => boolean;
  /** Progreso actual y meta, para dibujar la barra. */
  progress: (profile: ProfileSave) => { current: number; target: number };
}

export const COLONY_MILESTONES: readonly ColonyMilestone[] = [
  {
    id: 'spores_1000',
    nameKey: 'colony.milestone.spores1000',
    rewardId: 'milestone_spores_1000',
    met: (p) => p.colony.lifetimeSpores >= 1000,
    progress: (p) => ({ current: Math.min(p.colony.lifetimeSpores, 1000), target: 1000 }),
  },
  {
    id: 'blinds_10',
    nameKey: 'colony.milestone.blinds10',
    rewardId: 'milestone_blinds_10',
    met: (p) => totalBlindsCleared(p) >= 10,
    progress: (p) => ({ current: Math.min(totalBlindsCleared(p), 10), target: 10 }),
  },
  {
    id: 'level_10',
    nameKey: 'colony.milestone.level10',
    rewardId: 'milestone_level_10',
    met: (p) => p.colony.level >= 10,
    progress: (p) => ({ current: Math.min(p.colony.level, 10), target: 10 }),
  },
] as const;

/**
 * Ciegos superados "de por vida".
 *
 * No hay un contador dedicado: se deriva de `history`, que esta capeado a las
 * ultimas 20 partidas. Es una aproximacion DELIBERADA — el hito mira la ventana
 * reciente, y cuando el contador real llegue al servidor (V1.2) se reemplaza
 * esta funcion sin tocar la UI.
 */
export function totalBlindsCleared(profile: ProfileSave): number {
  return profile.history.reduce((sum, entry) => sum + (entry.blindsCleared ?? 0), 0);
}

export interface MilestoneView {
  id: string;
  nameKey: string;
  rewardId: string;
  met: boolean;
  current: number;
  target: number;
  progress: number;
}

export function milestoneViews(profile: ProfileSave): MilestoneView[] {
  return COLONY_MILESTONES.map((milestone) => {
    const { current, target } = milestone.progress(profile);
    const met = milestone.met(profile);
    return {
      id: milestone.id,
      nameKey: milestone.nameKey,
      rewardId: milestone.rewardId,
      met,
      current: met ? target : current,
      target,
      progress: target > 0 ? Math.max(0, Math.min(1, (met ? target : current) / target)) : 0,
    };
  });
}

// ---------------------------------------------------------------------------
// Validacion de la respuesta del servidor
// ---------------------------------------------------------------------------

const MAX_ENTRIES = 200;

function num(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function str(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

/**
 * Convierte la respuesta cruda del servidor en un tablero.
 *
 * NUNCA se confia en la forma: una respuesta rara (o un servidor comprometido)
 * no puede romper la pantalla ni inyectar filas falsas. Cada entrada invalida se
 * DESCARTA en vez de tumbar el tablero entero — es un ranking, no contenido
 * critico. Devuelve `null` si el documento no sirve.
 */
export function sanitizeBoard(raw: unknown, scope: LeaderboardScope): LeaderboardBoard | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const doc = raw as Record<string, unknown>;
  const list = Array.isArray(doc['entries']) ? doc['entries'] : null;
  if (!list) return null;

  const entries: LeaderboardEntry[] = [];
  for (const item of list.slice(0, MAX_ENTRIES)) {
    if (typeof item !== 'object' || item === null) continue;
    const row = item as Record<string, unknown>;
    const playerId = str(row['playerId'], '');
    if (playerId.length === 0) continue;
    entries.push({
      playerId,
      displayName: str(row['displayName'], playerId.slice(0, 8)),
      spores: Math.max(0, Math.round(num(row['spores'], 0))),
      level: Math.max(1, Math.round(num(row['level'], 1))),
      updatedAt: str(row['updatedAt'], ''),
      isSelf: false,
    });
  }

  const selfRank = typeof doc['selfRank'] === 'number' ? Math.max(1, Math.round(doc['selfRank'])) : null;
  const total = Math.max(entries.length, Math.round(num(doc['total'], entries.length)));

  return {
    scope,
    seasonId: str(doc['seasonId'], ''),
    entries,
    selfRank,
    total,
    fetchedAt: str(doc['fetchedAt'], ''),
  };
}

/** Marca la fila propia y devuelve una copia (no muta la cache del perfil). */
export function markSelf(board: LeaderboardBoard, playerId: string | null): LeaderboardBoard {
  if (!playerId) return board;
  return {
    ...board,
    entries: board.entries.map((entry) => ({ ...entry, isSelf: entry.playerId === playerId })),
  };
}

// ---------------------------------------------------------------------------
// Envio de resultados
// ---------------------------------------------------------------------------

/** Lo que viaja al servidor por cada run terminada. Ver `ColonyRunResult`. */
export interface SubmitPayload {
  playerId: string;
  result: ColonyRunResult;
}

/**
 * El servidor contesta con lo que CALCULO. El cliente no propone Esporas.
 *
 * `awarded` puede ser 0: repetir el mismo `runId` es un no-op idempotente del
 * lado del servidor (reintentar un envio no puede duplicar la recompensa).
 */
export interface SubmitResult {
  awarded: number;
  lifetimeSpores: number;
  seasonSpores: number;
  level: number;
  /** `true` si el servidor rechazo el resultado (fuera de rango, version vieja). */
  rejected?: boolean;
  reason?: string;
}

export function sanitizeSubmitResult(raw: unknown): SubmitResult | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const doc = raw as Record<string, unknown>;
  if (typeof doc['awarded'] !== 'number') return null;
  return {
    awarded: Math.max(0, Math.round(num(doc['awarded'], 0))),
    lifetimeSpores: Math.max(0, Math.round(num(doc['lifetimeSpores'], 0))),
    seasonSpores: Math.max(0, Math.round(num(doc['seasonSpores'], 0))),
    level: Math.max(1, Math.round(num(doc['level'], 1))),
    rejected: doc['rejected'] === true,
    reason: typeof doc['reason'] === 'string' ? doc['reason'] : undefined,
  };
}
