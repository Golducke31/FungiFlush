/**
 * MotionFrames.ts — Ilustraciones de carta ANIMADAS por frames.
 *
 * QUE ES
 * ------
 * Una hoja de sprites (spritesheet) con N frames de la MISMA ilustracion en
 * grilla. La carta muestra un frame a la vez y avanza con el reloj del juego:
 * la ilustracion respira, en vez de ser un cuadro congelado.
 *
 * POR QUE SPRITESHEET Y NO CANVAS POR FRAME
 * -----------------------------------------
 * La alternativa —rehornear un canvas 2D por frame— cuesta CPU por carta por
 * frame y ademas obligaria a resubir la textura a la GPU 60 veces por segundo.
 * La hoja se sube UNA vez y el frame se elige con `texture.offset/repeat`, que
 * son uniforms: cuesta un par de escrituras por frame y cero transferencias.
 *
 * La hoja se COMPARTE entre todas las cartas que usan el mismo archivo de arte
 * (mismo criterio que `CardTextureCache.getArt`). El offset se escribe desde
 * cada carta, pero como todas leen el MISMO reloj (`anim`/`clock`, que ademas
 * se congela en hit-stop) el valor escrito es siempre el mismo: la escritura
 * es idempotente. Si algun dia hace falta desincronizar frames por carta, el
 * camino es un uniform por material (shader), no clonar la textura: un clon
 * por carta multiplicaria la memoria de GPU.
 *
 * EL RELOJ
 * --------
 * `frameIndex(time, ...)` recibe el tiempo del loop (`SceneManager.clock`, el
 * mismo que alimenta `tickShader` del halo). No es `performance.now()`: tiene
 * que congelarse en el hit-stop y arrancar de 0 en `start()`, como todo lo
 * demas. Con `reduceMotion` el frame queda clavado en el 0 —la ilustracion
 * estatica— que es la regla del proyecto: lo que INFORMA no se apaga, solo
 * deja de moverse.
 *
 * LOS FRAMES HORNEAN EL MISMO TRATAMIENTO QUE EL ARTE ESTATICO
 * ------------------------------------------------------------
 * `tools/pack_motion_frames.py` replica el pipeline de
 * `CardTexture.createCardArtCanvas` (fondo degradado, tinte de elemento,
 * fundidos y vinetas) en cada frame. Si no, la transicion entre una carta con
 * ilustracion animada y una estatica se veria como un corte.
 *
 * EL MANIFIESTO
 * -------------
 * `public/art/motionframes.json` declara que hojas existen, indexadas por el
 * nombre de archivo del arte ESTATICO al que reemplazan:
 *
 *   { "sheets": { "art_card_mycelium_mythic.webp": {
 *       "file": "mf_card_mycelium_mythic.webp", "cols": 3, "rows": 2,
 *       "fps": 6, "pingPong": true } } }
 *
 * Se indexa por ARCHIVO (no por carta) porque el arte se resuelve por cadena
 * de respaldo: la carta pide `card_own_x`, cae a `card_elem_rar`, etc., y el
 * frame que se ve es el del archivo que realmente se cargo. Sin manifiesto (o
 * con una hoja que no cargo) no pasa nada: la carta queda con el arte
 * estatico de siempre.
 */

import * as THREE from 'three';

/** Ruta base de los assets. La misma que usa `ArtAssets`. */
const BASE = 'art/';

/** Como es la grilla de una hoja y a que velocidad corre. */
export interface MotionSheetMeta {
  /** Columnas de la grilla. */
  cols: number;
  /** Filas de la grilla. */
  rows: number;
  /** Frames por segundo. */
  fps: number;
  /** true = 0,1,2,...,N-1,N-2,...,1 (vuelve sin salto). false = loop directo. */
  pingPong: boolean;
}

/** Hoja lista para usar: la metadata mas la textura ya cargada. */
export interface MotionSheet extends MotionSheetMeta {
  texture: THREE.Texture;
}

interface ManifestSheet extends MotionSheetMeta {
  file: string;
}

interface MotionFrameManifest {
  sheets?: Record<string, ManifestSheet>;
}

/**
 * Frame que corresponde a un instante de tiempo.
 *
 * Pura (sin DOM ni THREE) para poder testearla sin navegador. Con `pingPong`
 * el recorrido es 0,1,...,N-1,N-2,...,1 y ahi da la vuelta: frame 0 y frame
 * N-1 se ven una sola vez por ciclo, que es lo que evita el salto del loop
 * directo cuando el primer y el ultimo frame no son el mismo.
 */
export function frameIndex(time: number, fps: number, count: number, pingPong: boolean): number {
  if (count <= 1 || fps <= 0) return 0;
  const raw = Math.floor(time * fps);
  if (!pingPong) return ((raw % count) + count) % count;
  const cycle = count * 2 - 2;
  if (cycle <= 0) return 0;
  const m = ((raw % cycle) + cycle) % cycle;
  return m < count ? m : cycle - m;
}

/**
 * Offset UV de la celda `index` dentro de la grilla.
 *
 * OJO con el eje Y: las UV de THREE tienen el origen abajo a la izquierda,
 * pero la grilla se llena como se lee (fila 0 arriba). Por eso la fila se
 * invierte: la fila 0 de la imagen vive en el offset Y mas alto.
 */
export function cellOffset(index: number, cols: number, rows: number): { x: number; y: number } {
  const c = cols > 0 ? cols : 1;
  const r = rows > 0 ? rows : 1;
  const col = ((index % c) + c) % c;
  const row = Math.floor(index / c);
  return { x: col / c, y: (r - 1 - row) / r };
}

/**
 * Cache de hojas de frames.
 *
 * Lleva la cuenta de QUE archivos de arte estan animados en este momento
 * (`refs`): es lo que permite el presupuesto por tier sin dejar hojas
 * colgadas cuando una carta se descarta o cambia de arte.
 *
 * LAS HOJAS SE DESCARGAN BAJO DEMANDA, no al arrancar. Un manifiesto con 10
 * ilustraciones animadas pesaria megas y en un celular eso es tiempo de carga
 * para algo que quiza no se vea en la partida. La primera carta que pide una
 * hoja dispara la descarga; cuando llega, `onSheetReady` avisa al SceneManager
 * para que re-resuelva las cartas y la animacion aparezca sin recargar nada.
 */
export class MotionFrameCache {
  /** Metadata por nombre de archivo del arte ESTATICO al que reemplaza. */
  private readonly metas = new Map<string, ManifestSheet>();
  /** Imagen ya decodificada de cada hoja (la comparten todas las cartas). */
  private readonly images = new Map<string, HTMLImageElement>();
  /** Textura por nombre de archivo estatico (una sola, compartida). */
  private readonly textures = new Map<string, THREE.Texture>();
  /** Cuantas cartas estan mostrando cada archivo ahora mismo. */
  private readonly refs = new Map<string, number>();
  /** Hojas cuya descarga ya se pidio (evita pedirla dos veces y reintentar en bucle). */
  private readonly requested = new Set<string>();
  private loading: Promise<void> | null = null;
  private enabled = false;
  private budget = 0;

  /**
   * Avisa que una hoja termino de cargar. El SceneManager lo usa para volver a
   * resolver las cartas vivas: hasta este momento se quedaron con el arte
   * estatico porque la imagen todavia no estaba.
   */
  onSheetReady?: () => void;

  /**
   * Lee el manifiesto. NO descarga las hojas: eso pasa cuando una carta las
   * pide (ver `acquire`).
   *
   * Se resuelve aunque no haya manifiesto (404) o venga roto: la animacion es
   * una mejora, nunca una dependencia. Idempotente.
   */
  async load(): Promise<void> {
    if (!this.loading) this.loading = this.readManifest();
    return this.loading;
  }

  private async readManifest(): Promise<void> {
    let sheets: Record<string, ManifestSheet> = {};
    try {
      const response = await fetch(`${BASE}motionframes.json`, { cache: 'no-cache' });
      if (response.ok) {
        const data = (await response.json()) as MotionFrameManifest;
        if (data.sheets && typeof data.sheets === 'object') sheets = data.sheets;
      }
    } catch {
      // Sin manifiesto no hay animacion: el juego sigue igual.
      return;
    }

    for (const [artFile, sheet] of Object.entries(sheets)) {
      if (!sheet || typeof sheet.file !== 'string') continue;
      const cols = Math.max(1, Math.floor(sheet.cols) || 1);
      const rows = Math.max(1, Math.floor(sheet.rows) || 1);
      this.metas.set(artFile, {
        file: sheet.file,
        cols,
        rows,
        fps: Math.max(0.1, Number(sheet.fps) || 6),
        pingPong: sheet.pingPong !== false,
      });
    }
  }

  /**
   * Pide la descarga de una hoja. Una sola vez por archivo: si el archivo no
   * existe (`onerror`) NO se reintenta, porque cada `acquire` de una carta con
   * ese arte volveria a pedirlo y seria una descarga fallida por frame.
   */
  private requestSheet(file: string): void {
    if (this.requested.has(file)) return;
    this.requested.add(file);
    const image = new Image();
    image.onload = () => {
      this.images.set(file, image);
      // Hay cartas esperando esta hoja: se re-resuelven.
      this.onSheetReady?.();
    };
    image.onerror = () => {
      // Se queda en `requested`: la carta muestra el arte estatico y listo.
    };
    image.src = `${BASE}${file}`;
  }

  /**
   * Prende o apaga la animacion y fija el presupuesto de hojas distintas
   * simultaneas. Lo llama el SceneManager cuando cambia el tier.
   */
  setEnabled(on: boolean, budget: number): void {
    this.enabled = on;
    this.budget = Math.max(0, Math.floor(budget));
  }

  /**
   * Reserva la hoja del archivo de arte `artSrc` (la URL completa de la
   * imagen). Devuelve `undefined` —sin reservar nada— si la animacion esta
   * apagada, no hay hoja para ese archivo, todavia no cargo la imagen o el
   * presupuesto del tier esta lleno.
   *
   * Toda reserva con `acquire` se devuelve con `release` (al descartar la
   * carta o al cambiarle el arte).
   */
  acquire(artSrc: string | undefined): MotionSheet | undefined {
    if (!this.enabled || this.budget <= 0 || !artSrc) return undefined;
    const file = fileNameOf(artSrc);
    const meta = this.metas.get(file);
    if (!meta) return undefined;

    const held = this.refs.get(file) ?? 0;
    // El presupuesto cuenta archivos DISTINTOS: dos cartas con la misma
    // ilustracion comparten textura y no deberian costar el doble.
    if (held === 0 && this.refs.size >= this.budget) return undefined;

    let texture = this.textures.get(file);
    if (!texture) {
      // La hoja solo se usa si su imagen YA decodifico. Si no llego, se pide
      // aca (una sola vez) y esta carta se queda con el arte estatico hasta
      // que `onSheetReady` avise. Devuelve undefined SIN reservar, para no
      // dejar una referencia colgada que nadie va a devolver.
      const image = this.images.get(meta.file);
      if (!image) {
        this.requestSheet(meta.file);
        return undefined;
      }
      texture = this.createSheetTexture(image);
      this.textures.set(file, texture);
    }
    this.refs.set(file, held + 1);
    // Se arma a mano y no con spread: `meta` tambien trae el nombre del
    // ARCHIVO de la hoja, que es detalle de la cache y no de la hoja en si.
    return {
      cols: meta.cols,
      rows: meta.rows,
      fps: meta.fps,
      pingPong: meta.pingPong,
      texture,
    };
  }

  /**
   * Devuelve la reserva de un archivo de arte.
   *
   * Cuando la ultima carta suelta un archivo, se libera su TEXTURA de GPU. Es
   * lo que evita que una partida larga acumule hojas: cada una son ~5 MB de
   * VRAM (1152x1116 RGBA) y ver 20 ilustraciones distintas serian 100 MB.
   *
   * La IMAGEN ya decodificada se queda en `images`: volver a pedir esa hoja no
   * cuesta red, solo subirla otra vez a la GPU. El manifiesto tampoco se toca.
   */
  release(artSrc: string | undefined): void {
    if (!artSrc) return;
    const file = fileNameOf(artSrc);
    const held = this.refs.get(file) ?? 0;
    // Soltar un archivo que NADIE reservo es un error del llamador: si ademas
    // se dispose la textura, se la destruye a la carta que si la tiene puesta
    // (queda huérfana: referenciada por un material pero fuera de la cache).
    // Con la reserva fantasma corregida en `Card3D.applyMotion` no deberia
    // pasar; esto es la red de seguridad para que un llamador futuro no pueda
    // volver a romperlo en silencio.
    if (held <= 0) return;
    if (held > 1) {
      this.refs.set(file, held - 1);
      return;
    }
    this.refs.delete(file);
    const texture = this.textures.get(file);
    if (texture) {
      texture.dispose();
      this.textures.delete(file);
    }
  }

  /** Hojas declaradas por el manifiesto (para el panel de debug). */
  get declared(): number {
    return this.metas.size;
  }

  /** Archivos distintos animandose ahora mismo. */
  get active(): number {
    return this.refs.size;
  }

  /** Texturas vivas (una por archivo). */
  get size(): number {
    return this.textures.size;
  }

  /** Libera las texturas de las hojas. Solo al cerrar el juego. */
  dispose(): void {
    for (const texture of this.textures.values()) texture.dispose();
    this.textures.clear();
    this.refs.clear();
  }

  /**
   * Textura de una hoja a partir de la imagen que `requestSheet` ya decodifico
   * (una sola descarga por archivo, compartida por todas las cartas).
   *
   * `needsUpdate = true` NO es opcional: una `Texture` nueva nace con
   * `version = 0` y three solo sube a la GPU las que tienen `version > 0`. Sin
   * esta linea el quad se dibuja NEGRO —sin error, sin warning— porque la
   * textura nunca llega a existir en el contexto.
   */
  private createSheetTexture(image: HTMLImageElement): THREE.Texture {
    const texture = new THREE.Texture();
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 8;
    texture.image = image;
    texture.needsUpdate = true;
    return texture;
  }
}

/** Cola de un src hasta el nombre de archivo (`art/foo.webp` -> `foo.webp`). */
function fileNameOf(src: string): string {
  const slash = src.lastIndexOf('/');
  return slash >= 0 ? src.slice(slash + 1) : src;
}
