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
 * Movimiento IDLE de una capa, leido de `index.json`.
 *
 * Los numeros vienen del segmentador (`tools/segment_card_layers.py`) y son por
 * carta: asi cada ilustracion controla su propio vaiven sin tocar codigo. El
 * cargador solo los lee y rellena lo que falte con `DEFAULT_MOTION`.
 */
export interface LayerMotion {
  /** Amplitud del vaiven, en fraccion del ALTO de la carta. */
  amp: number;
  /** Velocidad del ciclo (rad/s aprox). */
  speed: number;
  /** Amplitud de la distorsion UV por ruido (0 = sin distorsion). */
  noise: number;
}

/** Profundidad relativa por capa (0 = fondo lejano, 1 = primer plano). */
export type LayerDepth = Partial<Record<LayerName, number>>;

/** Movimiento por capa. Falta una capa = se usa `DEFAULT_MOTION`. */
export type LayerMotions = Partial<Record<LayerName, LayerMotion>>;


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
  /** Profundidad relativa por capa (0-1). Defaults si el indice no la trae. */
  depth: Record<LayerName, number>;
  /** Movimiento idle por capa. Defaults si el indice no lo trae. */
  motion: Record<LayerName, LayerMotion>;
  /**
   * Fase inicial determinista (0-2pi) derivada del STEM.
   *
   * Sin ella todas las cartas respirarian AL UNISONO, que se lee como un latido
   * de pantalla en vez de vida. Determinista y no aleatoria: la misma carta se
   * mueve igual entre sesiones.
   */
  phase: number;
}

/** Entrada cruda del manifiesto, tal como la escribe el segmentador. */
interface RawLayerEntry {
  size?: number[];
  subject?: { bbox?: number[] };
  /** Campos opcionales que agrega el segmentador (matting/movimiento). */
  depth?: LayerDepth;
  motion?: LayerMotions;
  files?: Partial<Record<LayerName, string>>;
}

/**
 * Defaults de profundidad y movimiento.
 *
 * SON EL RESPALDO DURO: una entrada sin `depth`/`motion` (indice viejo, o una
 * carta segmentada antes de esta feature) se resuelve con estos numeros y el
 * juego se ve igual que siempre. El `subject` respira mas que el fondo y el `fg`
 * va en contra: eso es lo que da la sensacion de capas independientes.
 */
export const DEFAULT_DEPTH: Record<LayerName, number> = { bg: 0.15, subject: 0.5, fg: 0.85 };
export const DEFAULT_MOTION: Record<LayerName, LayerMotion> = {
  bg: { amp: 0.006, speed: 0.35, noise: 0.004 },
  subject: { amp: 0.01, speed: 0.6, noise: 0.006 },
  fg: { amp: 0.008, speed: 0.45, noise: 0.003 },
};

const LAYER_NAMES: readonly LayerName[] = ['bg', 'subject', 'fg'];

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

/**
 * Fase de idle determinista (0-2pi) a partir del stem de la carta.
 *
 * Hash simple y estable (FNV-1a sobre los code units). NO usa el RNG del engine
 * ni `Math.random`: dos corridas del mismo build mueven cada carta IGUAL, y dos
 * cartas con distinto arte no respiran al unisono.
 */
export function phaseForStem(stem: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < stem.length; i++) {
    h ^= stem.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  // `>>> 0` para tratarlo sin signo y normalizar a [0, 1) -> [0, 2pi).
  return ((h >>> 0) / 0xffffffff) * Math.PI * 2;
}

export class ArtLayers {
  private readonly images = new Map<string, HTMLImageElement>();
  /**
   * Archivos de capa que son TRANSPARENTES de punta a punta.
   *
   * El segmentador escribe igual un PNG de `fg` aunque no haya primer plano (en
   * modo teal el vignette puede venir apagado ⇒ alfa todo 0). Ese archivo NO es
   * una capa: si se tratara como tal, `Card3D` montaria un quad invisible, pagaria
   * un draw call y —peor— encenderia el campo de esporas por un "fg" que no existe.
   * Se detecta UNA vez por archivo (ver `markEmptyLayers`) y `getLayers` lo omite.
   */
  private readonly emptyLayers = new Set<string>();
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
    this.detectEmptyLayers();
    this.loaded = true;
  }

  /**
   * Marca como vacias las capas cuyo PNG es transparente en TODO el lienzo.
   *
   * Se hace dibujando cada capa en un canvas chico (64x64) y mirando si algun
   * pixel tiene alfa > 0: muestrea lo suficiente para detectar un vignette o un
   * sujeto real, y es despreciable en tiempo (una decodificacion ya hecha, mas
   * un drawImage de 64x64 por archivo). Una capa que no se puede dibujar (CORS,
   * canvas sucio) NO se marca: ante la duda, se conserva.
   */
  private detectEmptyLayers(): void {
    const probe = document.createElement('canvas');
    probe.width = 64;
    probe.height = 64;
    const ctx = probe.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;
    for (const [file, img] of this.images) {
      try {
        ctx.clearRect(0, 0, 64, 64);
        ctx.drawImage(img, 0, 0, 64, 64);
        const data = ctx.getImageData(0, 0, 64, 64).data;
        let anyAlpha = false;
        for (let i = 3; i < data.length; i += 4) {
          if (data[i]! > 0) {
            anyAlpha = true;
            break;
          }
        }
        if (!anyAlpha) this.emptyLayers.add(file);
      } catch {
        // Sin permiso de lectura: se asume que la capa sirve.
      }
    }
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
        if (!file) return undefined;
        // Una capa transparente de punta a punta NO es una capa (ver `emptyLayers`):
        // devolverla montaria un quad invisible y encenderia las esporas al pedo.
        if (this.emptyLayers.has(file)) return undefined;
        return this.images.get(file);
      };

      // --- Movimiento / profundidad por capa (guardados campo a campo) ---
      // El indice lo escribe un tool de Python: tratarlo como DATO NO CONFIABLE.
      // Cada campo pasa por `Number.isFinite`; lo que falte cae al default. Si la
      // entrada no trae NADA de esto (indice viejo) igual se resuelve con defaults
      // y el render se comporta como antes de esta feature.
      const depth = {} as Record<LayerName, number>;
      const motion = {} as Record<LayerName, LayerMotion>;
      for (const layer of LAYER_NAMES) {
        const depthRaw = entry.depth?.[layer];
        depth[layer] = Number.isFinite(depthRaw) ? (depthRaw as number) : DEFAULT_DEPTH[layer];

        const mRaw = entry.motion?.[layer];
        const fallback = DEFAULT_MOTION[layer];
        motion[layer] = {
          amp: Number.isFinite(mRaw?.amp) ? (mRaw!.amp as number) : fallback.amp,
          speed: Number.isFinite(mRaw?.speed) ? (mRaw!.speed as number) : fallback.speed,
          noise: Number.isFinite(mRaw?.noise) ? (mRaw!.noise as number) : fallback.noise,
        };
      }

      return { bg: pick('bg'), subject, fg: pick('fg'), bbox, size, depth, motion, phase: phaseForStem(stem) };
    }
    return undefined;
  }

  /** Solo para tests: registra una entrada y sus imagenes sin pasar por la red. */
  setEntry(stem: string, entry: RawLayerEntry, images: Record<string, HTMLImageElement>): void {
    this.entries.set(stem, entry);
    for (const [file, img] of Object.entries(images)) this.images.set(file, img);
  }

  /**
   * Solo para tests / integraciones sin canvas: marca un archivo de capa como
   * transparente de punta a punta, con el mismo efecto que `detectEmptyLayers`.
   */
  markEmptyLayer(file: string): void {
    this.emptyLayers.add(file);
  }
}
