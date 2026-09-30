/**
 * SeasonTracker.ts — Progresion del Pase de Temporada (P4).
 *
 * PURO y sin DOM: recibe un `ProfileSave` y lo muta dentro de un
 * `profileStore.patch` (quien persiste con debounce). La UI solo pide;
 * quien escribe es el llamador, como en DailyReward/AchievementTracker.
 *
 * El estado vive en `profile.entitlements.passes` (el `PassState` ya definido
 * en ProfileState), asi que no hay una segunda fuente de verdad: el tracker
 * opera sobre el perfil VIVO.
 *
 * REGLAS:
 *   - Los tiers se desbloquean por XP acumulado (`pass.xp >= tier.xp`).
 *   - Reclamar aplica el reward (via `applyReward`, que ya escribe
 *     `collection.unlockSource[id] = 'season'`) y marca el tier como reclamado.
 *   - Idempotente: reclamar dos veces no duplica ni rompe.
 */

import type { ProfileSave } from '../meta/ProfileState';
import type { RetentionReward, RetentionSource } from './types';
import { applyReward } from './rewards';

export const SEASON_SOURCE: RetentionSource = 'season';

export interface SeasonTierDef {
  /** 1-based. */
  level: number;
  /** XP acumulado requerido para ALCANZAR este tier (no para reclamarlo). */
  xp: number;
  reward: RetentionReward;
}

export interface SeasonDef {
  id: string;
  nameKey: string;
  tiers: SeasonTierDef[];
}

export type TierState = 'claimed' | 'claimable' | 'locked';

export interface SeasonTierView {
  level: number;
  xp: number;
  reward: RetentionReward;
  state: TierState;
}

/** Clave de reclamo coherente con EntitlementStore.claimKey ("f12"/"p12"). */
function claimKey(level: number, track: 'free' | 'premium' = 'free'): string {
  return `${track[0]}${level}`;
}

/**
 * Parsea y valida el JSON de la temporada. Cualquier entrada mala se descarta
 * (no tumba el arranque): devuelve `null` si el documento no sirve.
 */
export function parseSeason(raw: unknown): SeasonDef | null {
  if (!raw || typeof raw !== 'object') return null;
  const doc = raw as Record<string, unknown>;
  if (typeof doc.id !== 'string' || typeof doc.nameKey !== 'string') return null;
  if (!Array.isArray(doc.tiers)) return null;

  const tiers: SeasonTierDef[] = [];
  for (const entry of doc.tiers as unknown[]) {
    if (!entry || typeof entry !== 'object') continue;
    const t = entry as Record<string, unknown>;
    if (typeof t.level !== 'number' || typeof t.xp !== 'number') continue;
    const reward = t.reward as RetentionReward | undefined;
    if (!reward || typeof reward.type !== 'string' || typeof reward.id !== 'string') continue;
    tiers.push({ level: t.level, xp: t.xp, reward });
  }
  if (tiers.length === 0) return null;
  // Orden estable por nivel para que la UI no salte.
  tiers.sort((a, b) => a.level - b.level);
  return { id: doc.id, nameKey: doc.nameKey, tiers };
}

/** Devuelve (o crea) el PassState de la temporada dentro del perfil. */
export function ensurePass(profile: ProfileSave, seasonId: string) {
  let pass = profile.entitlements.passes.find((p) => p.seasonId === seasonId);
  if (!pass) {
    pass = { seasonId, xp: 0, premium: false, claimed: [] };
    profile.entitlements.passes.push(pass);
  }
  return pass;
}

/** Suma XP y devuelve el total. Nunca baja de 0. */
export function addXp(profile: ProfileSave, seasonId: string, amount: number): number {
  const pass = ensurePass(profile, seasonId);
  pass.xp = Math.max(0, pass.xp + amount);
  return pass.xp;
}

/** Nivel maximo alcanzado por el XP actual. */
export function currentTier(def: SeasonDef, pass: { xp: number }): number {
  let level = 0;
  for (const tier of def.tiers) {
    if (pass.xp >= tier.xp) level = tier.level;
  }
  return level;
}

/** Vista de todos los tiers con su estado para la UI. */
export function tierViews(def: SeasonDef, pass: { xp: number; claimed: string[] }): SeasonTierView[] {
  return def.tiers.map((tier) => {
    const key = claimKey(tier.level);
    const claimed = pass.claimed.includes(key);
    const reached = pass.xp >= tier.xp;
    const state: TierState = claimed ? 'claimed' : reached ? 'claimable' : 'locked';
    return { level: tier.level, xp: tier.xp, reward: tier.reward, state };
  });
}

/**
 * Aplica el reward de un tier y lo marca reclamado. Devuelve `true` si otorgo
 * algo NUEVO (para decidir el toast). Es idempotente en el reclamo y no otorga
 * si el tier no se alcanzo todavia.
 */
export function claimTier(profile: ProfileSave, def: SeasonDef, level: number): boolean {
  const tier = def.tiers.find((t) => t.level === level);
  if (!tier) return false;
  const pass = ensurePass(profile, def.id);
  const key = claimKey(level);
  if (pass.claimed.includes(key)) return false;
  if (pass.xp < tier.xp) return false;
  const granted = applyReward(profile, tier.reward, SEASON_SOURCE);
  pass.claimed.push(key);
  return granted;
}
