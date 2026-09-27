/**
 * ArtAssets.ts — Carga de las ilustraciones.
 *
 * QUE CAMBIO Y POR QUE
 * --------------------
 * Antes el mapeo era por ARQUETIPO: 30 cartas compartian 9 ilustraciones (una
 * por elemento) mas dos para legendarias y miticas. Dos cartas del mismo
 * elemento se veian identicas, que es el punto mas debil del arte del juego.
 *
 * Ahora el esquema es por ELEMENTO x RAREZA: 8 x 5 = 40 archivos
 * (`art_card_<elemento>_<rareza>.webp`), que es el catalogo que el plan ya
 * tenia especificado.
 *
 * LA CADENA DE RESPALDO ES LO QUE HACE SEGURA LA MIGRACION
 * --------------------------------------------------------
 * Los 40 archivos no aparecen de golpe. Mientras se generan, cada carta prueba
 * en orden:
 *
 *     1. `card_<elemento>_<rareza>`   el arte nuevo
 *     2. `card_<elemento>_common`     el arte nuevo del elemento, en su version base
 *     3. `art_<elemento>`             los 11 archivos viejos
 *     4. (ninguno)                    el dibujo procedural del canvas
 *
 * Asi el juego es jugable y vendible en cualquier punto intermedio, y borrar los
 * 11 viejos es el ultimo paso, no el primero.
 *
 * EL MANIFIESTO
 * -------------
 * Las 51 claves posibles se resuelven a 51 URLs, pero solo existen las que se
 * hayan generado: cargarlas todas daria decenas de 404 y un aviso por cada uno
 * en CADA arranque. `public/art/index.json` (que genera `npm run art:index`)
 * lista los archivos que existen y solo esos se piden. Si el manifiesto falta,
 * se cae a los 11 viejos, que siempre estan.
 */

import type { ElementType, Rarity } from '@engine/index';

/** Los 8 elementos del catalogo, incluido `neutral` (el de los jokers). */
const ELEMENTS = [
  'neutral',
  'poison',
  'spore',
  'decay',
  'symbiosis',
  'crystal',
  'mycelium',
  'parasite',
] as const satisfies readonly ElementType[];

const RARITIES = ['common', 'uncommon', 'rare', 'legendary', 'mythic'] as const satisfies readonly Rarity[];

/** Los 7 elementos que tienen archivo en el catalogo viejo (no hay `art_neutral`). */
const LEGACY_ELEMENTS = [
  'poison',
  'spore',
  'decay',
  'symbiosis',
  'crystal',
  'mycelium',
  'parasite',
] as const;

/** Clave de una de las 40 ilustraciones nuevas. */
export type CardArtKey = `card_${ElementType}_${Rarity}`;
/** Claves del catalogo viejo (11 archivos) mas el dorso y el tapete. */
export type LegacyArtKey =
  | `art_${(typeof LEGACY_ELEMENTS)[number]}`
  | 'art_legendary'
  | 'art_mythic'
  | 'art_cardback'
  | 'art_table';
export type ArtKey = CardArtKey | LegacyArtKey;

function buildFileMap(): Record<ArtKey, string> {
  const map = {} as Record<ArtKey, string>;

  for (const element of ELEMENTS) {
    for (const rarity of RARITIES) {
      map[`card_${element}_${rarity}`] = `art_card_${element}_${rarity}.webp`;
    }
  }
  for (const element of LEGACY_ELEMENTS) map[`art_${element}`] = `art_${element}.webp`;
  map['art_legendary'] = 'art_legendary.webp';
  map['art_mythic'] = 'art_mythic.webp';
  map['art_cardback'] = 'art_cardback.webp';
  map['art_table'] = 'art_table.webp';

  return map;
}

const FILES: Record<ArtKey, string> = buildFileMap();

/** Archivo -> clave, para poder leer el manifiesto sin listar las 51 claves. */
const KEY_BY_FILE = new Map<string, ArtKey>(
  Object.entries(FILES).map(([key, file]) => [file, key as ArtKey]),
);

/** Los que siempre existen: es el respaldo si no hay manifiesto. */
const LEGACY_FILES = Object.values(FILES).filter((file) => file.startsWith('art_') && !file.startsWith('art_card_'));

/** Ruta base. Con `base: './'` en Vite, las rutas relativas funcionan en Tauri. */
const BASE = 'art/';

export class ArtAssets {
  private readonly images = new Map<ArtKey, HTMLImageElement>();
  private loaded = false;
  private requested = 0;

  /**
   * Carga las imagenes que el manifiesto declara, en paralelo.
   * `onProgress` recibe 0..1 para la pantalla de carga.
   */
  async loadAll(onProgress?: (ratio: number, loaded: number, total: number) => void): Promise<void> {
    if (this.loaded) return;

    const files = await this.readManifest();
    const total = Math.max(1, files.length);
    let done = 0;

    await Promise.all(
      files.map(
        (file) =>
          new Promise<void>((resolve) => {
            const key = KEY_BY_FILE.get(file);
            // Un archivo suelto que no corresponde a ninguna clave se ignora:
            // puede ser una hoja de contactos o un temporal.
            if (!key) {
              done += 1;
              onProgress?.(done / total, done, total);
              resolve();
              return;
            }

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
            // Una imagen que falla no debe colgar el arranque: la carta cae al
            // siguiente eslabon de la cadena y, en el peor caso, al dibujo
            // procedural. El juego sigue jugable.
            img.onerror = () => {
              console.warn(`[ArtAssets] No se pudo cargar ${file}; se usara el respaldo.`);
              finish();
            };
            img.src = `${BASE}${file}`;
          }),
      ),
    );

    this.loaded = true;
  }

  /** Lista de archivos declarados por `public/art/index.json`. */
  private async readManifest(): Promise<string[]> {
    try {
      const response = await fetch(`${BASE}index.json`, { cache: 'no-cache' });
      if (!response.ok) throw new Error(String(response.status));
      const data = (await response.json()) as { files?: unknown };
      if (Array.isArray(data.files)) {
        const files = data.files.filter((file): file is string => typeof file === 'string');
        if (files.length > 0) return files;
      }
    } catch {
      // Sin manifiesto se cargan los 11 viejos: el juego arranca igual.
    }
    return [...LEGACY_FILES];
  }

  get(key: ArtKey): HTMLImageElement | undefined {
    return this.images.get(key);
  }

  /**
   * Primer eslabon de la cadena que tenga imagen. Devuelve `undefined` si
   * ninguno la tiene, y ahi la textura cae al dibujo procedural.
   */
  getFirst(keys: readonly ArtKey[]): HTMLImageElement | undefined {
    for (const key of keys) {
      const image = this.images.get(key);
      if (image) return image;
    }
    return undefined;
  }

  get isLoaded(): boolean {
    return this.loaded;
  }

  get count(): number {
    return this.images.size;
  }

  /** Cuantas URLs se pidieron. Sirve para detectar un manifiesto de mas. */
  get requestedCount(): number {
    return this.requested;
  }

  /** Solo para tests: registra una imagen sin pasar por la red. */
  set(key: ArtKey, image: HTMLImageElement): void {
    this.images.set(key, image);
  }

  /** Solo para tests: marca la carga como hecha. */
  markLoaded(): void {
    this.loaded = true;
  }
}

/**
 * Cadena de arte para una carta, de lo mas especifico a lo mas generico.
 *
 * El orden importa: el arte nuevo por elemento x rareza gana, despues el arte
 * nuevo del elemento en su version base, y recien despues el catalogo viejo.
 *
 * Se dedupe conservando el orden: para `common` el primer eslabon Y el segundo
 * son el mismo archivo, y pedirlo dos veces confunde al leer el log de carga.
 */
export function artKeysFor(element: ElementType, rarity: Rarity): ArtKey[] {
  const keys: ArtKey[] = [`card_${element}_${rarity}`, `card_${element}_common`];

  // El catalogo viejo tenia arte propio solo para las dos rarezas altas.
  if (rarity === 'mythic') keys.push('art_mythic');
  else if (rarity === 'legendary') keys.push('art_legendary');

  // `neutral` no tiene archivo viejo: su respaldo historico era micelio.
  keys.push(`art_${element === 'neutral' ? 'mycelium' : element}` as ArtKey);

  return [...new Set(keys)];
}

/** Igual que `artKeysFor`: los jokers usan el elemento de su efecto dominante. */
export function artKeysForJoker(element: ElementType, rarity: Rarity): ArtKey[] {
  return artKeysFor(element, rarity);
}

/** Nombre de archivo de una clave. Lo usan los tests y `genArtIndex`. */
export function artFileFor(key: ArtKey): string {
  return FILES[key];
}

/** Clave del dorso. */
export const CARD_BACK_KEY: ArtKey = 'art_cardback';
/** Clave del tapete. */
export const TABLE_KEY: ArtKey = 'art_table';
