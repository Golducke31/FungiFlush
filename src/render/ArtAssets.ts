/**
 * ArtAssets.ts — Carga de las ilustraciones de carta.
 *
 * Las imagenes viven en `public/art/*.webp` y se cargan por URL. Se preloadan
 * TODAS antes de arrancar la partida: si una carta apareciera sin su arte, el
 * jugador veria un salto visual, y en un juego de cartas el arte ES la interfaz.
 *
 * El mapeo es por arquetipo, no por carta: 30 cartas -> 9 ilustraciones. Las
 * legendarias y miticas tienen arte propio para que se sientan especiales.
 */

import type { ElementType, Rarity } from '@engine/index';

export type ArtKey =
  | 'poison'
  | 'spore'
  | 'decay'
  | 'symbiosis'
  | 'crystal'
  | 'mycelium'
  | 'parasite'
  | 'legendary'
  | 'mythic'
  | 'cardback'
  | 'table';

const FILES: Record<ArtKey, string> = {
  poison: 'art_poison.webp',
  spore: 'art_spore.webp',
  decay: 'art_decay.webp',
  symbiosis: 'art_symbiosis.webp',
  crystal: 'art_crystal.webp',
  mycelium: 'art_mycelium.webp',
  parasite: 'art_parasite.webp',
  legendary: 'art_legendary.webp',
  mythic: 'art_mythic.webp',
  cardback: 'art_cardback.webp',
  table: 'art_table.webp',
};

/** Ruta base. Con `base: './'` en Vite, las rutas relativas funcionan en Tauri. */
const BASE = 'art/';

export class ArtAssets {
  private readonly images = new Map<ArtKey, HTMLImageElement>();
  private loaded = false;

  /**
   * Carga todas las imagenes en paralelo.
   * `onProgress` recibe 0..1 para la pantalla de carga.
   */
  async loadAll(onProgress?: (ratio: number, loaded: number, total: number) => void): Promise<void> {
    if (this.loaded) return;
    const entries = Object.entries(FILES) as Array<[ArtKey, string]>;
    const total = entries.length;
    let done = 0;

    await Promise.all(
      entries.map(
        ([key, file]) =>
          new Promise<void>((resolve) => {
            const img = new Image();
            img.decoding = 'async';
            const finish = () => {
              done += 1;
              onProgress?.(done / total, done, total);
              resolve();
            };
            img.onload = () => {
              this.images.set(key, img);
              finish();
            };
            // Una imagen que falla no debe colgar el arranque: la carta cae
            // al dibujo procedural y el juego sigue jugable.
            img.onerror = () => {
              console.warn(`[ArtAssets] No se pudo cargar ${file}; se usara arte procedural.`);
              finish();
            };
            img.src = `${BASE}${file}`;
          }),
      ),
    );

    this.loaded = true;
  }

  get(key: ArtKey): HTMLImageElement | undefined {
    return this.images.get(key);
  }

  get isLoaded(): boolean {
    return this.loaded;
  }

  get count(): number {
    return this.images.size;
  }
}

/** Elige el arquetipo de arte para una carta segun rareza y elemento. */
export function artKeyFor(element: ElementType, rarity: Rarity): ArtKey {
  if (rarity === 'mythic') return 'mythic';
  if (rarity === 'legendary') return 'legendary';
  return element as ArtKey;
}

/** Arte para jokers y mutaciones: usa el elemento del efecto dominante. */
export function artKeyForJoker(element: ElementType, rarity: Rarity): ArtKey {
  if (rarity === 'legendary' || rarity === 'mythic') return artKeyFor(element, rarity);
  return element === 'neutral' ? 'mycelium' : (element as ArtKey);
}
