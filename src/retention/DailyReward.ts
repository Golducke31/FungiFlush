/**
 * DailyReward.ts — Recompensa diaria y racha.
 *
 * PURO: no toca el DOM, no importa el perfil desde un singleton, no conoce
 * `Date.now()` por su cuenta (se lo pasa el llamador). Todo entra y sale por
 * parametros, que es lo que permite testear el salto de dia sin dormir al
 * proceso ni mockear el reloj global.
 *
 * La recompensa es un DESBLOQUEO DIRECTO (una carta, un joker), no una moneda
 * nueva: "Fungis" sigue siendo plata de la run y se borra al terminar.
 */

import type { ProfileSave } from '../meta/ProfileState';
import { applyReward } from './rewards';
import type { RetentionReward } from './types';

export interface DailyRewardEntry {
  /** Dia del ciclo, 1-based. */
  day: number;
  reward: RetentionReward;
}

export interface DailyRewardTable {
  /** Cada cuantos dias vuelve a empezar la escalera. */
  cycleDays: number;
  rewards: DailyRewardEntry[];
}

export interface DailyEvaluation {
  /** Fecha de hoy en hora local, 'YYYY-MM-DD'. */
  date: string;
  alreadyClaimedToday: boolean;
  /** Racha que le corresponde si reclama hoy (NO la que ya tiene cobrada). */
  streak: number;
  bestStreak: number;
  /** Dia del ciclo que toca hoy (1..cycleDays). */
  day: number;
  reward: RetentionReward | null;
  /** Cabeza de la escalera: cuantos dias lleva sin faltar. */
  historyLength: number;
}

export interface DailyClaim {
  /** `false` si ya habia reclamado hoy: reclamar dos veces es un no-op. */
  ok: boolean;
  streak: number;
  reward: RetentionReward | null;
  /** `false` si el desbloqueo ya estaba en el perfil (segunda vuelta del ciclo). */
  fresh: boolean;
}

/**
 * Umbral minimo entre dos reclamos para SUMAR racha.
 *
 * Sin esto, adelantar el reloj un dia daria una racha nueva en minutos. Con
 * esto, el que adelanta el reloj se queda con la racha que tenia (no la pierde,
 * pero tampoco avanza), que es exactamente lo que dice el plan: "no incrementar".
 */
const MIN_GAP_MS = 20 * 60 * 60 * 1000;

/** Tope del historico: es para medir retencion, no un registro eterno. */
const HISTORY_CAP = 90;

/** 'YYYY-MM-DD' en hora LOCAL: el dia del jugador, no el de Greenwich. */
export function dateKey(ts: number): string {
  const d = new Date(ts);
  const month = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${d.getFullYear()}-${month}-${day}`;
}

/** Desplaza una clave de fecha. Se hace en UTC para no cruzar un cambio de hora. */
function shiftDate(key: string, days: number): string {
  const parts = key.split('-').map(Number);
  const year = parts[0] ?? 1970;
  const month = parts[1] ?? 1;
  const day = parts[2] ?? 1;
  const base = Date.UTC(year, month - 1, day) + days * 86_400_000;
  return new Date(base).toISOString().slice(0, 10);
}

export function rewardForDay(table: DailyRewardTable, day: number): RetentionReward | null {
  const cycle = Math.max(1, table.cycleDays);
  const index = ((Math.max(1, day) - 1) % cycle) + 1;
  return table.rewards.find((entry) => entry.day === index)?.reward ?? null;
}

/**
 * Que le toca hoy. NO modifica nada: el panel lo consulta para dibujarse y
 * `claimDaily` lo vuelve a llamar para decidir (asi no hay dos caminos de
 * calculo que se puedan desincronizar).
 */
export function evaluateDaily(
  profile: ProfileSave,
  now: number,
  table: DailyRewardTable,
): DailyEvaluation {
  const date = dateKey(now);
  const state = profile.daily;
  const last = state.lastClaimDate;
  const alreadyClaimedToday = last === date;

  let streak: number;
  if (alreadyClaimedToday) {
    streak = state.streak;
  } else if (last === null || last === undefined) {
    streak = 1;
  } else if (last > date) {
    // El reloj del dispositivo se ATRASO (o alguien lo movio): la ultima fecha
    // esta en el futuro. No se puede confiar en esa racha, vuelve a 1.
    streak = 1;
  } else if (last === shiftDate(date, -1)) {
    // Ayer, pero con al menos ~20 h de por medio. Si pasaron menos horas la
    // racha se SOSTIENE sin sumar: no se castiga al que juega de madrugada.
    streak = now - state.lastClaimTs >= MIN_GAP_MS ? state.streak + 1 : Math.max(1, state.streak);
  } else {
    streak = 1;
  }

  const day = ((Math.max(1, streak) - 1) % Math.max(1, table.cycleDays)) + 1;
  return {
    date,
    alreadyClaimedToday,
    streak,
    bestStreak: Math.max(state.bestStreak, streak),
    day,
    reward: rewardForDay(table, day),
    historyLength: state.history.length,
  };
}

/**
 * Reclama la recompensa de hoy. MUTA el perfil (el llamador lo envuelve en
 * `profileStore.patch`) y devuelve que paso, para que la UI pueda festejarlo.
 */
export function claimDaily(
  profile: ProfileSave,
  now: number,
  table: DailyRewardTable,
): DailyClaim {
  const evaluation = evaluateDaily(profile, now, table);
  if (evaluation.alreadyClaimedToday) {
    return { ok: false, streak: profile.daily.streak, reward: null, fresh: false };
  }

  const reward = evaluation.reward;
  const fresh = reward ? applyReward(profile, reward, 'daily') : false;

  profile.daily.lastClaimDate = evaluation.date;
  profile.daily.lastClaimTs = now;
  profile.daily.streak = evaluation.streak;
  profile.daily.bestStreak = Math.max(profile.daily.bestStreak, evaluation.streak);

  if (!profile.daily.history.includes(evaluation.date)) profile.daily.history.push(evaluation.date);
  if (profile.daily.history.length > HISTORY_CAP) {
    profile.daily.history.splice(0, profile.daily.history.length - HISTORY_CAP);
  }

  return { ok: true, streak: evaluation.streak, reward, fresh };
}

// ---------------------------------------------------------------------------
// Parseo de la tabla (los datos son datos: se validan al entrar)
// ---------------------------------------------------------------------------

const REWARD_TYPES = new Set(['card', 'joker', 'cosmetic', 'cardBack', 'felt']);

function parseReward(raw: unknown): RetentionReward | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const entry = raw as Record<string, unknown>;
  const type = entry['type'];
  const id = entry['id'];
  if (typeof type !== 'string' || !REWARD_TYPES.has(type)) return null;
  if (typeof id !== 'string' || id.length === 0) return null;
  return { type, id } as RetentionReward;
}

/**
 * Lee `src/data/daily-rewards.json`. Una entrada mal escrita se DESCARTA en vez
 * de romper el arranque: es una recompensa gratis, no contenido critico.
 */
export function parseDailyTable(raw: unknown): DailyRewardTable {
  if (typeof raw !== 'object' || raw === null) return { cycleDays: 1, rewards: [] };
  const source = raw as Record<string, unknown>;
  const cycleDays = typeof source['cycleDays'] === 'number' ? Math.max(1, source['cycleDays']) : 1;
  const list = Array.isArray(source['rewards']) ? source['rewards'] : [];

  const rewards: DailyRewardEntry[] = [];
  for (const item of list) {
    if (typeof item !== 'object' || item === null) continue;
    const entry = item as Record<string, unknown>;
    const day = typeof entry['day'] === 'number' ? entry['day'] : null;
    const reward = parseReward(entry['reward']);
    if (day === null || !reward) continue;
    rewards.push({ day, reward });
  }
  return { cycleDays, rewards };
}
