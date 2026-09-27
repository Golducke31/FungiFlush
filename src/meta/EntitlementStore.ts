/**
 * EntitlementStore.ts — Que tiene derecho a usar el jugador.
 *
 * Puro: sin DOM, sin Tauri, sin fetch. Se puede testear en Node con un
 * snapshot y nada mas. La unica fuente de verdad *externa* (Google Play
 * Billing) se reconcilia en la capa de app y llama a `grant`/`revoke`.
 *
 * REGLA DE DEGRADACION: ante la duda, se da por poseido. En un juego de pago,
 * el error correcto es regalar contenido, no cobrar dos veces.
 */

import {
  DEFAULT_OFFLINE_GRACE_MS,
  type EntitlementSnapshot,
  type PassState,
} from './ProfileState';

export class EntitlementStore {
  private owned: Set<string>;
  private passes: PassState[];
  private checkedAt: number | undefined;
  private offlineGraceMs: number;

  constructor(snapshot?: Partial<EntitlementSnapshot>) {
    this.owned = new Set(snapshot?.owned ?? []);
    this.passes = (snapshot?.passes ?? []).map((p) => ({ ...p, claimed: [...p.claimed] }));
    this.checkedAt = snapshot?.checkedAt;
    this.offlineGraceMs = snapshot?.offlineGraceMs ?? DEFAULT_OFFLINE_GRACE_MS;
  }

  static from(snapshot: EntitlementSnapshot): EntitlementStore {
    return new EntitlementStore(snapshot);
  }

  // --- Consultas -----------------------------------------------------------

  has(key: string): boolean {
    return this.owned.has(key);
  }

  /** La ultima reconciliacion sigue dentro de la ventana de gracia. */
  isFresh(now = Date.now()): boolean {
    if (this.checkedAt === undefined) return false;
    return now - this.checkedAt <= this.offlineGraceMs;
  }

  passFor(seasonId: string): PassState | undefined {
    return this.passes.find((p) => p.seasonId === seasonId);
  }

  hasClaimed(seasonId: string, tier: number, track: 'free' | 'premium'): boolean {
    const pass = this.passFor(seasonId);
    return pass?.claimed.includes(claimKey(tier, track)) ?? false;
  }

  // --- Mutaciones ----------------------------------------------------------

  grant(key: string): void {
    this.owned.add(key);
  }

  revoke(key: string): void {
    this.owned.delete(key);
  }

  /** Reemplaza la lista completa (reconciliacion con la tienda). */
  syncOwned(keys: string[], now = Date.now()): void {
    const merged = new Set(this.owned);
    for (const key of keys) merged.add(key);
    this.owned = merged;
    this.checkedAt = now;
  }

  ensurePass(seasonId: string): PassState {
    let pass = this.passFor(seasonId);
    if (!pass) {
      pass = { seasonId, xp: 0, premium: false, claimed: [] };
      this.passes.push(pass);
    }
    return pass;
  }

  addXp(seasonId: string, amount: number): number {
    const pass = this.ensurePass(seasonId);
    pass.xp = Math.max(0, pass.xp + amount);
    return pass.xp;
  }

  setPremium(seasonId: string, premium: boolean): void {
    this.ensurePass(seasonId).premium = premium;
  }

  claim(seasonId: string, tier: number, track: 'free' | 'premium'): boolean {
    const pass = this.ensurePass(seasonId);
    const key = claimKey(tier, track);
    if (pass.claimed.includes(key)) return false;
    pass.claimed.push(key);
    return true;
  }

  // --- Serializacion -------------------------------------------------------

  toJSON(): EntitlementSnapshot {
    return {
      owned: [...this.owned],
      passes: this.passes.map((p) => ({ ...p, claimed: [...p.claimed] })),
      ...(this.checkedAt !== undefined ? { checkedAt: this.checkedAt } : {}),
      offlineGraceMs: this.offlineGraceMs,
    };
  }

  equals(other: EntitlementStore): boolean {
    const a = this.toJSON();
    const b = other.toJSON();
    if (a.owned.length !== b.owned.length) return false;
    return a.owned.every((key, i) => key === b.owned[i]) && a.passes.length === b.passes.length;
  }
}

function claimKey(tier: number, track: 'free' | 'premium'): string {
  return `${track === 'free' ? 'f' : 'p'}${tier}`;
}
