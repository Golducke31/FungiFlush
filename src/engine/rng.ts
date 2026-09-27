/**
 * rng.ts — Generador pseudoaleatorio con semilla (determinista y reproducible).
 *
 * Un roguelite necesita runs reproducibles: misma semilla => misma partida.
 * Esto hace que los bugs del Trigger Engine se puedan reproducir exactamente
 * en la consola, y que el guardado sea solo un numero.
 */

export class RNG {
  private state: number;

  constructor(seed: number) {
    // Evita el estado 0, que en mulberry32 degenera.
    this.state = (seed >>> 0) || 0x9e3779b9;
  }

  /** Float en [0, 1). */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Entero en [min, max] inclusive. */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  /** Float en [min, max). */
  range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  /** true con probabilidad p (0..1). */
  chance(p: number): boolean {
    if (p <= 0) return false;
    if (p >= 1) return true;
    return this.next() < p;
  }

  pick<T>(items: readonly T[]): T | undefined {
    if (items.length === 0) return undefined;
    return items[Math.floor(this.next() * items.length)];
  }

  /** Fisher-Yates in-place. Devuelve el mismo array para encadenar. */
  shuffle<T>(items: T[]): T[] {
    for (let i = items.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      const a = items[i];
      const b = items[j];
      if (a === undefined || b === undefined) continue;
      items[i] = b;
      items[j] = a;
    }
    return items;
  }

  /** Muestreo ponderado. `weights` debe tener el mismo largo que `items`. */
  weighted<T>(items: readonly T[], weights: readonly number[]): T | undefined {
    let total = 0;
    for (const w of weights) total += Math.max(0, w);
    if (total <= 0) return this.pick(items);
    let roll = this.next() * total;
    for (let i = 0; i < items.length; i++) {
      roll -= Math.max(0, weights[i] ?? 0);
      if (roll <= 0) return items[i];
    }
    return items[items.length - 1];
  }

  /** Serializa el estado interno para guardado. */
  getSeed(): number {
    return this.state >>> 0;
  }
}

/** Hash estable string -> entero, para derivar semillas de un texto. */
export function hashString(text: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
