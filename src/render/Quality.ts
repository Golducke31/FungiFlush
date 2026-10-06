/**
 * Quality.ts — Niveles de calidad grafica.
 *
 * POR QUE EXISTE
 * --------------
 * El objetivo real del juego es landscape de celular, y ahi el post-procesamiento
 * (bloom) es lo mas caro que se puede agregar. En vez de elegir entre "se ve
 * lindo" y "anda", el juego decide por dispositivo y deja que el jugador lo
 * fuerce. Tres niveles, con una regla que no se negocia:
 *
 *   `low` ES el camino de render de siempre: `renderer.render()` directo, sin
 *   composer, con el mismo DPR. Ningun dispositivo puede quedar peor que antes
 *   de esta fase, y el smoke test corre en `low` (render por software), asi que
 *   sus aserciones de tiempo siguen siendo validas.
 *
 * Todo lo de aca es PURO (no toca el DOM, no toca Three.js) para poder testearlo
 * en Node: la deteccion recibe un objeto con los datos del dispositivo y el
 * monitor de frames recibe numeros.
 */

export type QualityTier = 'low' | 'medium' | 'high';
export type QualitySetting = 'auto' | QualityTier;

export interface TierConfig {
  /** DPR maximo. Se combina con `window.devicePixelRatio`. */
  maxDpr: number;
  /** `false` = `renderer.render()` directo (el camino de siempre). */
  composer: boolean;
  bloom: boolean;
  /** Iteraciones de blur del bloom. 0 = sin bloom. */
  bloomIterations: number;
  bloomStrength: number;
  bloomThreshold: number;
  /**
   * Rodilla del bloom: cuan brusco es el paso entre "no brilla" y "brilla".
   * Antes estaba hardcodeado en `PostFx.ts`; ahora es del tier porque es la
   * mitad del ajuste que decide si el glow se ve suave o como un sticker.
   */
  bloomKnee: number;
  /** Mezcla del grade (0 = apagado). */
  gradeMix: number;
  /**
   * Iluminacion por imagen (IBL) y atmosfera: cubo PMREM procedural, cielo
   * degradado y luz de rim. `false` en `low`, donde el camino de render tiene
   * que seguir siendo exactamente el de siempre.
   */
  environment: boolean;
  /** Muestras de MSAA del render target del composer (WebGL2). */
  samples: number;
  /** Esporas de fondo, calculadas 100% en la GPU. */
  ambientSpores: number;
  /** Esporas transitorias (burst/stream), simuladas en CPU. */
  transientSpores: number;
  contactShadows: boolean;
}

/**
 * Los numeros no son arbitrarios:
 *   - `maxDpr` de `low` y `medium` es 1.75, el mismo que ya usa el juego en
 *     movil: subirlo es la forma mas facil de perder frames sin que se note.
 *   - El umbral de bloom es 0.70 en los dos tiers que lo tienen. En espacio
 *     lineal la mesa esta en ~0.005-0.08 y el cian del glow en ~0.7-0.8, asi
 *     que el bloom no puede levantar el fondo. Bajarlo de 0.3 es el modo de
 *     falla "el bloom se come la mesa".
 *   - `samples: 4` solo en `high`: el composer no hereda el MSAA del renderer,
 *     asi que sin esto las orillas se ven peor en desktop que antes.
 */
export const TIER_CONFIG: Record<QualityTier, TierConfig> = {
  low: {
    maxDpr: 1.75,
    composer: false,
    bloom: false,
    bloomIterations: 0,
    bloomStrength: 0,
    bloomThreshold: 0.7,
    bloomKnee: 0.2,
    gradeMix: 0,
    environment: false,
    samples: 0,
    ambientSpores: 0,
    transientSpores: 1200,
    contactShadows: false,
  },
  medium: {
    maxDpr: 1.75,
    composer: true,
    bloom: true,
    bloomIterations: 1,
    bloomStrength: 0.62,
    bloomThreshold: 0.7,
    bloomKnee: 0.35,
    gradeMix: 0.6,
    environment: true,
    samples: 0,
    ambientSpores: 400,
    transientSpores: 1200,
    contactShadows: true,
  },
  high: {
    maxDpr: 2,
    composer: true,
    bloom: true,
    bloomIterations: 2,
    bloomStrength: 0.78,
    bloomThreshold: 0.7,
    bloomKnee: 0.45,
    gradeMix: 1,
    environment: true,
    samples: 4,
    ambientSpores: 900,
    transientSpores: 2000,
    contactShadows: true,
  },
};

// ---------------------------------------------------------------------------
// Deteccion
// ---------------------------------------------------------------------------

/** Lo que hace falta saber del dispositivo. Se inyecta para poder testearlo. */
export interface DeviceInfo {
  /** Cadena sin enmascarar del renderer de WebGL (`WEBGL_debug_renderer_info`). */
  renderer: string;
  isMobile: boolean;
  /** `navigator.deviceMemory` en GB, si el navegador lo expone. */
  deviceMemory?: number;
  /** `navigator.hardwareConcurrency`. */
  cores?: number;
}

export type TierReason =
  | 'software'
  | 'mobile-low'
  | 'mobile'
  | 'desktop'
  | 'default'
  | 'auto-downgrade'
  | 'manual';

export interface TierDetection {
  tier: QualityTier;
  reason: TierReason;
}

/**
 * Los renderers por software (SwiftShader en el smoke test, llvmpipe en Linux,
 * "basic render" en Windows sin GPU) van directo a `low`. No es una optimizacion:
 * es lo que mantiene el smoke test usable, porque sus aserciones de gestos y de
 * animaciones asumen los ~12 FPS del baseline. Con el composer encima, el mismo
 * test empezaria a leer estados a mitad de camino.
 */
const SOFTWARE_RE = /swiftshader|llvmpipe|software|basic render|microsoft basic/i;

export function detectTier(info: DeviceInfo): TierDetection {
  if (SOFTWARE_RE.test(info.renderer)) return { tier: 'low', reason: 'software' };

  const memory = info.deviceMemory ?? 4;
  const cores = info.cores ?? 4;

  if (info.isMobile && (memory <= 4 || cores <= 4)) return { tier: 'low', reason: 'mobile-low' };
  if (info.isMobile) return { tier: 'medium', reason: 'mobile' };
  if (memory >= 8 && cores >= 8) return { tier: 'high', reason: 'desktop' };
  return { tier: 'medium', reason: 'default' };
}

/** El ajuste del jugador gana sobre la deteccion. */
export function resolveQuality(setting: QualitySetting, detected: QualityTier): QualityTier {
  return setting === 'auto' ? detected : setting;
}

/** Lee los datos del dispositivo. Impura: solo esto. */
export function readDeviceInfo(isMobile: boolean, context?: WebGLRenderingContext | null): DeviceInfo {
  let renderer = '';
  let gl = context ?? null;
  try {
    if (!gl) {
      const canvas = document.createElement('canvas');
      gl = (canvas.getContext('webgl2') ?? canvas.getContext('webgl')) as WebGLRenderingContext | null;
    }
    const ext = gl?.getExtension('WEBGL_debug_renderer_info');
    if (gl && ext) renderer = String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) ?? '');
  } catch {
    // Sin contexto no hay dato: se cae a la heuristica por memoria/nucleos.
  }

  const nav = navigator as Navigator & { deviceMemory?: number };
  return {
    renderer,
    isMobile,
    ...(typeof nav.deviceMemory === 'number' ? { deviceMemory: nav.deviceMemory } : {}),
    ...(typeof navigator.hardwareConcurrency === 'number'
      ? { cores: navigator.hardwareConcurrency }
      : {}),
  };
}

// ---------------------------------------------------------------------------
// Monitor de frames (auto-degradacion)
// ---------------------------------------------------------------------------

const ORDER: QualityTier[] = ['low', 'medium', 'high'];

export function nextTierDown(tier: QualityTier): QualityTier | null {
  const index = ORDER.indexOf(tier);
  return index > 0 ? (ORDER[index - 1] ?? null) : null;
}

/**
 * Presupuesto de frame por tier, en ms. Es el p95, no el promedio: un juego se
 * siente mal por la cola de la distribucion, no por la media.
 * `low` no tiene presupuesto util (no hay a donde bajar), asi que no se degrada.
 */
export const FRAME_BUDGET_MS: Record<QualityTier, number> = {
  low: 0,
  medium: 28,
  high: 20,
};

/**
 * Vigila los tiempos de frame y avisa cuando hay que bajar de nivel.
 *
 * Es una clase con estado pero SIN dependencias: se le pasan numeros y devuelve
 * una decision. Se testea sin navegador (ver `tests/render.test.ts`).
 *
 * El sesgo es deliberado: prefiere no degradar. Hacen falta varios segundos
 * seguidos por encima del presupuesto, y el p95 de una ventana de 90 frames,
 * para no reaccionar a un pico de un solo frame (una carga de textura, un GC).
 */
export class FrameMonitor {
  private readonly samples: number[] = [];
  private overBudgetSeconds = 0;
  private current: QualityTier;

  constructor(tier: QualityTier, private readonly windowSize = 90) {
    this.current = tier;
  }

  /** Devuelve el tier nuevo si hay que degradar, o null. */
  sample(dtSeconds: number): QualityTier | null {
    const ms = dtSeconds * 1000;
    this.samples.push(ms);
    if (this.samples.length > this.windowSize) this.samples.shift();

    const budget = FRAME_BUDGET_MS[this.current];
    if (budget <= 0) return null;

    if (this.p95 <= budget) {
      this.overBudgetSeconds = 0;
      return null;
    }

    // Solo se acumula cuando el p95 ya esta por encima: asi un frame lento
    // aislado no suma tiempo.
    this.overBudgetSeconds += dtSeconds;
    if (this.overBudgetSeconds < 3) return null;

    const down = nextTierDown(this.current);
    if (!down) return null;

    this.reset(down);
    return down;
  }

  /** Percentil 95 de la ventana actual. 0 si todavia no hay muestras. */
  get p95(): number {
    if (this.samples.length === 0) return 0;
    const sorted = [...this.samples].sort((a, b) => a - b);
    const index = Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95));
    return sorted[index] ?? 0;
  }

  get secondsOverBudget(): number {
    return this.overBudgetSeconds;
  }

  reset(tier: QualityTier): void {
    this.current = tier;
    this.samples.length = 0;
    this.overBudgetSeconds = 0;
  }
}
