/**
 * ArtLayers.ts — Carga las CAPAS segmentadas de las cartas (fondo / sujeto / primer plano).
 *
 * QUE SON LAS CAPAS Y DE DONDE SALEN
 * ----------------------------------
 * `tools/segment_card_layers.py` recorta cada ilustracion en 3 PNG con alfa y escribe
 * `public/art/layers/index.json` con, por carta, el nombre de cada archivo y el BBOX
 * con el que viene recortado el sujeto. Este modulo carga esas capas y las ofrece al
 * render para el parallax.
 *
 * FICHERO APARTE DEL RESTO DEL ARTE, A PROPOSITO
 * ----------------------------------------------
 * `ArtAssets` resuelve 51 claves fijas por tabla/patron. Las capas no encajan ahi: son
 * N por carta, con nombres `<stem>__<capa>` y metadata (bbox) que el resto del arte no
 * tiene. Meterlas en el sistema de claves obligaria a tocar la cadena de respaldo de
 * TODO el arte. Mejor un cargador propio con su propio manifiesto.
 *
 * RESPALDO DURO
 * -------------
 * Sin `layers/index.json` (arte aun no segmentado) o sin entrada para una carta, este
 * modulo devuelve `undefined` y el render sigue con la ruta de una sola textura. El
 * juego se ve IDENTICO si nadie corre `npm run art:layers`.
 *
 * LA CADENA DE RESPALDO ESPEJA `artKeysFor`
 * -----------------------------------------
 * Una carta puede tener arte propio (`art_card_own_<id>`) o el del par
 * (elemento x rareza, `art_card_<elemento>_<rareza>`). Las capas se segmentan de esos
 * mismos archivos, asi que se busca la entrada de capas con el STEM del archivo de arte
 * que realmente se va a mostrar. `layerKeysFor` devuelve esos stems candidatos en orden.
 */

import type { ElementType, Rarity } from '@engine/index';

/** Ruta base, igual que `ArtAssets.BASE`. */
const BASE = 'art/layers/';

/** Una capa concreta. `bg` detras, `subject` en medio, `fg` delante. */
export type LayerName = 'bg' | 'subject' | 'fg';

/**
 * Marca del objeto imagen de una capa.
 *
 * No guarda la imagen en si sino la CLAVE del cache de texturas: el render cachea
 * por archivo, asi que dos cartas que comparten ilustracion comparten textura (y el
 * parallax no cuesta el triple). Ver `CardTextureCache.getLayer`.
 */
export interface LayerImages {
  bg?: HTMLImageElement;
  subject?: HTMLImageElement;
  /** Primer plano. Puede no existir: en el dataset teal es un vignette reconstruido. */
  fg?: HTMLImageElement;
  /**
   * BBox del sujeto DENTRO del canvas de la carta, `[x, y, w, h]`.
   *
   * Es lo que permite alinear las capas: el sujeto es un recorte chico y, al tiltar
   * la carta, tiene que quedarse en su sitio respecto del fondo de tamano completo.
   */
  bbox: [number, number, number, number];
  /** Tamano del canvas de la carta (`[512, 744]`) al que estan referidas las capas. */
  size: [number, number];
}

/** Entrada cruda del manifiesto, tal como la escribe el segmentador. */
interface RawLayerEntry {
  size?: number[];
  subject?: { bbox?: number[] };
  files?: Partial<Record<LayerName, string>>;
}

interface RawLayerIndex {
  version?: number;
  layers?: Record<string, RawLayerEntry>;
}

const DEFAULT_SIZE: [number, number] = [512, 744];

/**
 * Stem de arte propio de una carta: `art_card_own_<id>`.
 *
 * El segmentador nombra sus salidas con el stem del PNG de origen, que para el arte
 * propio es `art_card_own_<id>` (sin `.webp`). Ver `artFileFor` en ArtAssets.
 */
export function ownLayerStem(cardId: string): string {
  return `art_card_own_${cardId}`;
}

/** Stem del arte por par: `art_card_<elemento>_<rareza>`. */
export function pairLayerStem(element: ElementType, rarity: Rarity): string {
  return `art_card_${element}_${rarity}`;
}

/**
 * Stems candidatos para una carta, de lo mas especifico a lo mas generico.
 *
 * ESPEJA el orden de `artKeysFor` en ArtAssets: arte propio primero, despues el par
 * (elemento, rareza), despues el `common` del elemento. Asi las capas que se muestran
 * corresponden EXACTAMENTE a la ilustracion que el render eligio.
 */
export function layerKeysFor(element: ElementType, rarity: Rarity, cardId?: string): string[] {
  const keys: string[] = [];
  if (cardId) keys.push(ownLayerStem(cardId));
  keys.push(pairLayerStem(element, rarity));
  if (rarity !== 'common') keys.push(pairLayerStem(element, 'common'));
  return [...new Set(keys)];
}

export class ArtLayers {
  private readonly images = new Map<string, HTMLImageElement>();
  private entries = new Map<string, RawLayerEntry>();
  private loaded = false;

  /** Cuantas cartas traen capas. Sirve para el panel de debug. */
  get count(): number {
    return this.entries.size;
  }

  get isLoaded(): boolean {
    return this.loaded;
  }

  /**
   * Carga el manifiesto y baja las imagenes de cada capa en paralelo.
   *
   * Si el manifiesto no existe, no es un error: el arte simplemente no esta
   * segmentado todavia y el render usa la ruta de una sola textura. Se marca cargado
   * igual para no reintentar en cada carta.
   */
  async loadAll(): Promise<void> {
    if (this.loaded) return;
    const raw = await this.readManifest();
    if (!raw) {
      this.loaded = true;
      return;
    }

    const jobs: Promise<void>[] = [];
    for (const [stem, entry] of Object.entries(raw.layers ?? {})) {
      this.entries.set(stem, entry);
      for (const file of Object.values(entry.files ?? {})) {
        if (typeof file !== 'string' || !file) continue;
        jobs.push(
          new Promise<void>((resolve) => {
            const img = new Image();
            img.decoding = 'async';
            img.onload = () => {
              this.images.set(file, img);
              resolve();
            };
            // Una capa que falla no rompe nada: `getLayers` la salta y el render
            // compone con las que si cargaron (o con la textura unica).
            img.onerror = () => {
              console.warn(`[ArtLayers] No se pudo cargar ${file}; se omite la capa.`);
              resolve();
            };
            img.src = `${BASE}${file}`;
          }),
        );
      }
    }
    await Promise.all(jobs);
    this.loaded = true;
  }

  private async readManifest(): Promise<RawLayerIndex | null> {
    try {
      const response = await fetch(`${BASE}index.json`, { cache: 'no-cache' });
      if (!response.ok) return null;
      return (await response.json()) as RawLayerIndex;
    } catch {
      return null;
    }
  }

  /**
   * Capas de una carta, o `undefined` si no hay arte segmentado para ella.
   *
   * Recorre `stems` (la cadena de `layerKeysFor`) y devuelve la PRIMERA entrada que
   * tenga al menos un sujeto cargado. Si el sujeto falta, no hay parallax util: se
   * devuelve `undefined` y el render cae a la textura unica.
   */
  getLayers(stems: readonly string[]): LayerImages | undefined {
    for (const stem of stems) {
      const entry = this.entries.get(stem);
      if (!entry?.files) continue;

      const subjectFile = entry.files.subject;
      const subject = subjectFile ? this.images.get(subjectFile) : undefined;
      if (!subject) continue;

      const bboxRaw = entry.subject?.bbox;
      const bbox: [number, number, number, number] =
        Array.isArray(bboxRaw) && bboxRaw.length === 4
          ? [bboxRaw[0]!, bboxRaw[1]!, bboxRaw[2]!, bboxRaw[3]!]
          : [0, 0, subject.naturalWidth || DEFAULT_SIZE[0], subject.naturalHeight || DEFAULT_SIZE[1]];

      const sizeRaw = entry.size;
      const size: [number, number] =
        Array.isArray(sizeRaw) && sizeRaw.length === 2 ? [sizeRaw[0]!, sizeRaw[1]!] : DEFAULT_SIZE;

      const pick = (layer: LayerName): HTMLImageElement | undefined => {
        const file = entry.files?.[layer];
        return file ? this.images.get(file) : undefined;
      };

      return { bg: pick('bg'), subject, fg: pick('fg'), bbox, size };
    }
    return undefined;
  }

  /** Solo para tests: registra una entrada y sus imagenes sin pasar por la red. */
  setEntry(stem: string, entry: RawLayerEntry, images: Record<string, HTMLImageElement>): void {
    this.entries.set(stem, entry);
    for (const [file, img] of Object.entries(images)) this.images.set(file, img);
  }
}
