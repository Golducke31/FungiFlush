/**
 * UpgradeService.ts — Cultivo ilimitado de cartas.
 *
 * QUE RESUELVE
 * ------------
 * "Mejoras ilimitadas" no puede significar "gratis y sin techo": eso rompe el
 * juego en 3 blinds. Significa que **no hay un tope duro** que corte la fantasia
 * de escalar una carta, pero el coste crece geometricamente y la decision de
 * cuando mejorar es real.
 *
 * La curva vive en `upgrades.json` (contenido). Aca solo hay aritmetica pura.
 */

import type { CardInstance, Rarity, UpgradeTrack } from '../types';

export interface UpgradeQuote {
  /** Coste de la proxima mejora. */
  cost: number;
  /** Nivel resultante. */
  nextLevel: number;
  /** 0 = sin techo. */
  maxLevel: number;
  atMaxLevel: boolean;
  /** Substrate/Spores que ganaria con esta mejora. */
  substrateGain: number;
  sporesGain: number;
}

export class UpgradeService {
  constructor(private readonly tracks: readonly UpgradeTrack[]) {}

  get hasTracks(): boolean {
    return this.tracks.length > 0;
  }

  /** Primer track que aplica a la carta. */
  trackFor(card: CardInstance): UpgradeTrack | undefined {
    return this.tracks.find((track) => this.applies(track, card)) ?? this.tracks[0];
  }

  private applies(track: UpgradeTrack, card: CardInstance): boolean {
    if (track.rarities && track.rarities.length > 0 && !track.rarities.includes(card.def.rarity)) {
      return false;
    }
    if (track.tags && track.tags.length > 0) {
      const tags = card.def.tags ?? [];
      if (!track.tags.some((tag) => tags.includes(tag))) return false;
    }
    return true;
  }

  /**
   * Coste de subir un nivel.
   *
   *   coste = ceil(baseCost * rareza * growth^(nivel-1))
   *
   * Con baseCost 4 y growth 1.5 en una comun: 4, 6, 9, 14, 21, 31, 46, 69, 103.
   * Subir las primeras veces es barato; la decima cuesta como tres jokers.
   */
  costFor(card: CardInstance): number {
    const track = this.trackFor(card);
    if (!track) return 0;
    const rarityMult = track.rarityCostMultiplier?.[card.def.rarity] ?? 1;
    return Math.ceil(track.baseCost * rarityMult * Math.pow(track.growth, Math.max(0, card.level - 1)));
  }

  /** `0` significa sin techo. */
  maxLevelFor(card: CardInstance): number {
    return this.trackFor(card)?.maxLevel ?? 0;
  }

  atMaxLevel(card: CardInstance): boolean {
    const max = this.maxLevelFor(card);
    return max > 0 && card.level >= max;
  }

  /** Cuanto ganaria la carta con `levels` mejoras, sin tocar nada. */
  gains(card: CardInstance, levels: number): { substrate: number; spores: number } {
    const track = this.trackFor(card);
    if (!track) return { substrate: 0, spores: 0 };

    let substrate = 0;
    let spores = 0;
    for (let i = 1; i <= levels; i++) {
      const nextLevel = card.level + i;
      substrate += track.substratePerLevel + (track.levelScaling ? nextLevel : 0);
      spores += track.sporesPerLevel;
    }
    return { substrate, spores };
  }

  /**
   * Cotizacion completa. Devuelve null si el track no permite mejorar mas.
   * Es pura: no toca la carta, asi que la UI puede pedirla en cada render.
   */
  quote(card: CardInstance, levels = 1): UpgradeQuote | null {
    if (!this.hasTracks) return null;
    const maxLevel = this.maxLevelFor(card);
    if (maxLevel > 0 && card.level >= maxLevel) {
      return {
        cost: 0,
        nextLevel: card.level,
        maxLevel,
        atMaxLevel: true,
        substrateGain: 0,
        sporesGain: 0,
      };
    }
    const gain = this.gains(card, levels);
    return {
      cost: this.costFor(card),
      nextLevel: card.level + levels,
      maxLevel,
      atMaxLevel: false,
      substrateGain: gain.substrate,
      sporesGain: gain.spores,
    };
  }

  /**
   * Aplica las mejoras a la instancia. Es la UNICA funcion que muta, y la llama
   * GameEngine: los efectos del contenido pasan por `ResolutionContext.levelUps`
   * y terminan aca, de modo que un dryRun nunca mejora nada.
   */
  apply(card: CardInstance, levels: number): void {
    const track = this.trackFor(card);
    if (!track) return;
    const safeLevels = Math.max(1, Math.floor(levels));
    for (let i = 0; i < safeLevels; i++) {
      card.level += 1;
      card.bonusSubstrate += track.substratePerLevel + (track.levelScaling ? card.level : 0);
      card.bonusSpores += track.sporesPerLevel;
    }
  }
}

/** Rareza -> color de coste, para la UI. Vive aca para no duplicar el mapa. */
export function upgradeRarityMultiplier(track: UpgradeTrack, rarity: Rarity): number {
  return track.rarityCostMultiplier?.[rarity] ?? 1;
}
