/**
 * SceneManager.ts — La capa visual completa.
 *
 * Responsabilidad unica: ser una VISTA del motor. No decide reglas, no muta
 * estado del juego, no calcula score. Escucha el bus de eventos y traduce
 * "paso X" a "carta que vuela + particulas + shake".
 *
 * Diseno para LANDSCAPE EN MOVIL, que es donde se va a jugar:
 *   - La camara se aleja sola para que el tablero entre en cualquier aspect
 *     ratio (de 1.33 de un iPad a 2.2 de un celular).
 *   - DPR limitado y sin antialias en tactil: el WebView de un celular no
 *     sostiene 60 FPS con MSAA a 3x.
 *   - Un solo THREE.Points para todas las particulas.
 *   - En tactil no hay hover: la elevacion se reserva a la seleccion.
 */

import * as THREE from 'three';
import {
  bus,
  type CardInstance,
  type ElementType,
  type GameEngine,
  type JokerDefinition,
  type JokerInstance,
  type Rarity,
  type ScoreStep,
} from '@engine/index';

import { ArtAssets, CARD_BACK_KEY, artKeysFor, artKeysForJoker } from './ArtAssets';
import { ARENA_GLOW_BASE, ARENA_GLOW_ENVIRONMENT, type Arena, buildArena } from './Arena';
import { CARD_HALO_WIDTH, CARD_HEIGHT, CARD_WIDTH, Card3D, disposeSharedGeometry } from './Card3D';
import { CardTextureCache, createCardBackCanvas, createShadowCanvas } from './CardTexture';
import { CameraRig } from './CameraRig';
import { DropZone, type DropZoneHandle, type DropZoneId, type ZoneRect } from './DropZone';
import { Interaction } from './Interaction';
import { SporeField } from './Particles';
import { PostFx } from './PostFx';
import {
  FrameMonitor,
  TIER_CONFIG,
  detectTier,
  readDeviceInfo,
  type QualityTier,
  type TierConfig,
  type TierDetection,
  type TierReason,
} from './Quality';
import { createSkyMaterial } from './Shaders';
import { TweenManager } from './Tween';
import { ELEMENT_COLOR, UI_COLORS } from './palette';

// --- Constantes de layout (unidades de mundo) ---
//
// RESTRICCION DE DISENO: en landscape de celular la pantalla es ancha y BAJA
// (~2.2:1). La camara mira la mesa en angulo, asi que la profundidad Z se
// comprime sobre el alto de pantalla. Cuanto mas profunda sea la mesa (de la
// mano a los jokers), mas chicas se ven las cartas.
//
// Por eso el tablero es COMPACTO en Z: la mano y los jokers estan cerca, y la
// distancia se gasta en ancho (que sobra) en vez de en alto (que falta).
const HAND_Y = 0.16;
const HAND_Z = 3.0;
const JOKER_Y = 0.16;
const JOKER_Z = -3.4;
const JOKER_SCALE = 0.5;
// Piles moved outward in X (±10.5, antes ±7.8) and back in Z (1.0, antes 2.4)
// para dejar de tapar las cartas de los extremos de la mano: con la mano en
// X hasta ±8.25 y los piles en ±7.8, los montones compartian pantalla con la
// primera y ultima carta del abanico y el depth buffer los ganaba por 0.03u
// (la pila estaba un poco MAS cerca de la camara que la carta). Al sacarlos
// del abanico y empujarlos a Z=1.0 (claramente detras del plano de la mano,
// que vive en Z=3+), los piles quedan por detras de la mano en profundidad
// Y por fuera de la mano en pantalla.
const DECK_X = 10.5;
const DECK_Z = 1.0;
const DISCARD_X = -10.5;
const DISCARD_Z = 1.0;
const PLAY_Y = 0.18;
const PLAY_Z = -0.6;
const PLAY_SCALE = 0.86;
/**
 * Separacion entre cartas jugadas. Es MAS chica que el halo a proposito: las
 * cartas jugadas tienen que leerse como UNA mano, no como cinco cartas sueltas.
 * (En la fila de jokers es al reves, ahi si tienen que leerse separadas.)
 */
const PLAY_SPACING = 2.05;

// --- Arrastre ---
/** Altura a la que flota la carta mientras se la arrastra. */
const DRAG_Y = 1.05;
/** Inclinacion durante el arrastre: la carta se para y se lee. */
const DRAG_TILT_RX = -1.0;

// --- Zonas de destino (rectangulos sobre el plano XZ de la mesa) ---
//
// El ORDEN de la lista es la prioridad: el descarte se evalua antes que la mano
// porque sus rectangulos se solapan. Ver `resolveDropZone`.
//
// Con los piles en X=±10.5 y Z=1.0, la zona de descarte vive pegada al pilar:
// minX=-11.5 .. maxX=-9.3 cubre el rectangulo del monton con margen, y
// minZ=-0.5 .. maxZ=2.5 lo mantiene claramente DETRAS de la mano (que vive en
// Z>=3.0). Antes la banda del descarte solapaba la mano por arriba (maxZ=2.8)
// y por eso "tirar para descartar" se leia como "tirar hacia atras"; ahora es
// "tirar hacia el costado del pilar", que es mas directo.
//
// La mano (ZONE_HAND) sigue cubriendo toda la mesa: cualquier drop que NO
// caiga sobre descarte/play vuelve a la mano.
const ZONE_DISCARD: ZoneRect = { minX: -11.5, maxX: -9.3, minZ: -0.5, maxZ: 2.5 };
const ZONE_PLAY: ZoneRect = { minX: -8.8, maxX: 8.8, minZ: -4.4, maxZ: 1.5 };
const ZONE_HAND: ZoneRect = { minX: -11, maxX: 11, minZ: 1.5, maxZ: 4.6 };

const ZONE_COLOR: Record<'play' | 'discard' | 'hand', number> = {
  play: 0x4fd18b,
  discard: 0xe05c8a,
  hand: 0x5fd8e8,
};

// --- Sombra de contacto ---
/** Cuantas sombras entran en el pool (mano 12 + jokers 5 + jugadas 5). */
const SHADOW_MAX = 64;
/** Altura de la sombra: sobre la mesa, debajo de todo lo demas. */
const SHADOW_Y = 0.004;
/** La sombra es un poco mas grande que la carta, si no se ve como un borde. */
const SHADOW_SPREAD = 1.04;

/** Mitad de la profundidad de una carta (para calcular el encuadre). */
const CARD_HALF_DEPTH = CARD_HEIGHT / 2;

/** El maximo de una perilla de particulas entre todos los tiers. */
function maxParticles(key: 'ambientSpores' | 'transientSpores'): number {
  return Math.max(...Object.values(TIER_CONFIG).map((config) => config[key]));
}

/** Cuantos pasos de score se animan. El resto se agrupa para no eternizar la mano. */
const MAX_ANIMATED_STEPS = 22;

export interface SceneCallbacks {
  /** El jugador toco/cliqueo una carta de la mano. */
  onCardClick: (uid: string) => void;
  /** El puntero entro/salio de una carta (solo raton). */
  onHoverChange: (card: CardInstance | null) => void;
  /** Texto flotante de puntos. El render sabe DONDE; la UI sabe COMO dibujarlo. */
  onScorePopup?: (screenX: number, screenY: number, text: string, color: number) => void;
  /**
   * Un paso del calculo ACABA de aparecer en pantalla.
   *
   * No es lo mismo que `score:step`: el motor emite TODOS los pasos de golpe y
   * el render los escalona para que se lean uno por uno. El contador en vivo
   * tiene que ir al ritmo de lo que se VE, asi que lo dispara el render, no el
   * motor. `index` es el orden dentro de la mano.
   */
  onScoreTick?: (info: {
    index: number;
    text: string;
    color: number;
    sourceKey: string;
    /**
     * El paso viene de una REGLA DE LA MANO (combo de composicion o bonus de
     * orden) y no de una carta individual. El HUD lo muestra distinto: no es lo
     * mismo "esta carta sumo 4" que "cumpliste Supercolonia".
     */
    isBonus: boolean;
    /** El paso RESTA: el HUD lo grafica como daño (veneno), no como ganancia. */
    negative: boolean;
    /** Posicion en pantalla de la carta que origina el paso, para los efectos. */
    x: number;
    y: number;
  }) => void;
  /**
   * El jugador solto una carta sobre una zona. El render sabe QUE zona es; el
   * controlador decide que significa ("play" = seleccionar, "discard" =
   * descartar esa carta, "hand" = devolverla). El render no toca el motor.
   */
  onCardDrop?: (uid: string, zone: DropZoneId) => void;
  /**
   * El monitor de frames bajo el nivel de calidad por su cuenta. El render NO
   * muestra avisos (no es su trabajo): avisa y el controlador decide si
   * mostrarlo por toast y si lo persiste.
   */
  onQualityDowngraded?: (tier: QualityTier, from: QualityTier) => void;
}

/** Instantanea de una carta de la mano, para el panel de debug (F3) y los tests. */
export interface HandCardState {
  uid: string;
  /** 0 = boca arriba, 1 = boca abajo. */
  flip: number;
  faceUp: boolean;
  /** `true` si el dorso tiene textura aplicada. */
  hasBack: boolean;
  selected: boolean;
  /** Posicion en el mundo (XZ) y en pantalla (px, relativa al canvas). */
  x: number;
  z: number;
  screenX: number;
  screenY: number;
}

export interface SceneOptions {
  canvas: HTMLCanvasElement;
  engine: GameEngine;
  assets: ArtAssets;
  callbacks: SceneCallbacks;
}

export class SceneManager {
  readonly scene = new THREE.Scene();
  readonly rig: CameraRig;
  readonly renderer: THREE.WebGLRenderer;
  readonly tweens = new TweenManager();

  private readonly engine: GameEngine;
  private readonly assets: ArtAssets;
  private readonly callbacks: SceneCallbacks;
  private readonly textures = new CardTextureCache();
  private readonly particles: SporeField;
  private readonly interaction: Interaction;

  private readonly handCards = new Map<string, Card3D>();
  private readonly jokerCards = new Map<string, Card3D>();
  /** Cartas que estan en la zona de puntuacion (ya salieron de la mano). */
  private readonly scoringCards: Card3D[] = [];

  /** Zonas de destino del arrastre, en orden de prioridad. */
  private readonly dropZones: DropZone[] = [];
  /** Textura del dorso, compartida por las cartas, el mazo y el descarte. */
  private backTexture: THREE.CanvasTexture | null = null;
  /** Carta que se esta arrastrando (uid), o null. */
  private dragUid: string | null = null;

  private readonly unsubscribes: Array<() => void> = [];
  private readonly fxQueue: Array<{ at: number; run: () => void }> = [];

  /** Indice de paso dentro de la mano actual (se reinicia en cada jugada). */
  private stepIndex = 0;
  /** Separacion temporal entre pasos de score. */
  private readonly stepStagger = 0.055;

  private clock = 0;
  private frameId = 0;
  private running = false;
  private readonly isTouch: boolean;
  private readonly isMobile: boolean;
  private handSpread = 16.5;

  private deckMesh: THREE.Group | null = null;
  private discardMesh: THREE.Group | null = null;
  private readonly disposables: Array<THREE.Material | THREE.Texture | THREE.BufferGeometry> = [];

  /** 'menu' = escena idle de la pantalla de inicio; 'run' = partida. */
  private mode: 'menu' | 'run' = 'run';
  private readonly menuCards: Card3D[] = [];
  private menuBaseZ: number[] = [];
  private reduceMotion = false;

  // --- Calidad grafica ---
  /** Nivel efectivo. Arranca en `low` (el camino de siempre) hasta que se detecte. */
  private tier: QualityTier = 'low';
  private tierReason: TierReason = 'default';
  /** Lo que eligio la deteccion, antes de que el jugador fuerce un nivel. */
  private detected: TierDetection = { tier: 'low', reason: 'default' };
  /** Vigila el frame time y degrada solo. Null en `low` (no hay a donde bajar). */
  private frameMonitor: FrameMonitor | null = null;
  /** Medicion opcional (`?perf=1`). Null si no se pidio. */
  private perf: { samples: number[]; target: number } | null = null;
  /** Cadena de post-procesamiento. Null en `low`, que renderiza directo. */
  private postFx: PostFx | null = null;
  /** Sombras de contacto: un solo mesh instanciado para todas las cartas. */
  private shadowMesh: THREE.InstancedMesh | null = null;
  private readonly shadowDummy = new THREE.Object3D();

  // --- Atmosfera (C1-C3): todo opcional y ausente en `low` ---
  /** Luces base. Se re-ajustan cuando entra el IBL (C2). */
  private hemiLight: THREE.HemisphereLight | null = null;
  private keyLight: THREE.DirectionalLight | null = null;
  /** Cubo PMREM procedural. Se genera una sola vez, la primera vez que hace falta. */
  private envTexture: THREE.Texture | null = null;
  /** La Arena: suelo de tiles 3D + vegetacion. Dos draw calls, ver `Arena.ts`. */
  private arena: Arena | null = null;
  /** Esfera de cielo con degradado. Propia de los tiers con `environment`. */
  private skyMesh: THREE.Mesh | null = null;
  /** Rim light tenue. Una sola y solo con `environment`. */
  private rimLight: THREE.PointLight | null = null;

  constructor(options: SceneOptions) {
    this.engine = options.engine;
    this.assets = options.assets;
    this.callbacks = options.callbacks;

    this.isTouch = matchMedia('(hover: none) and (pointer: coarse)').matches;
    this.isMobile = this.isTouch || /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

    const width = options.canvas.clientWidth || window.innerWidth;
    const height = options.canvas.clientHeight || window.innerHeight;

    this.renderer = new THREE.WebGLRenderer({
      canvas: options.canvas,
      // MSAA es caro en GPU de celular y con estas texturas no se nota.
      antialias: !this.isMobile,
      alpha: false,
      powerPreference: 'high-performance',
      stencil: false,
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    // Los contadores de `renderer.info` se leen a mano UNA vez por frame: cuando
    // entre el composer, cada pase hace su propio `renderer.render()` y con el
    // autoReset puesto el conteo final seria el del ultimo pase (1).
    this.renderer.info.autoReset = false;

    // El nivel de calidad se detecta ANTES de crear el rig y las particulas:
    // el DPR y la capacidad de esporas salen del tier, y cambiarlos despues
    // obligaria a reconstruir cosas.
    const detected = detectTier(readDeviceInfo(this.isMobile, this.renderer.getContext()));
    this.detected = detected;

    this.rig = new CameraRig(width / height, 40);
    // Los pools se dimensionan al MAXIMO de todos los tiers y despues el tier
    // solo mueve el limite: cambiar de calidad no puede costar una subida de
    // buffers ni una reasignacion.
    this.particles = new SporeField({
      transient: maxParticles('transientSpores'),
      ambient: maxParticles('ambientSpores'),
    });

    this.interaction = new Interaction(options.canvas, {
      onHover: (card) => this.handleHover(card),
      onClick: (card) => this.handleClick(card),
      onDragStart: (card) => this.handleDragStart(card),
      onDrag: (card, point, zone) => this.handleDrag(card, point, zone),
      onDrop: (card, zone) => this.handleDrop(card, zone),
      onDragCancel: (card) => this.handleDragCancel(card),
    });
    this.interaction.setCamera(this.rig.camera);

    this.buildWorld();
    this.buildDropZones();
    this.subscribe();
    this.applyQuality(detected.tier, detected.reason, false);
    this.resize();
  }

  // ==========================================================================
  // Calidad grafica
  // ==========================================================================

  /** Configuracion efectiva del nivel actual. */
  get tierConfig(): TierConfig {
    return TIER_CONFIG[this.tier];
  }

  /**
   * Fija el nivel de calidad. `resizeNow` en false sirve para el constructor,
   * que todavia no tiene el rig creado y hace un solo `resize()` al final.
   */
  applyQuality(tier: QualityTier, reason: TierReason = 'default', resizeNow = true): void {
    this.tier = tier;
    this.tierReason = reason;
    // En `low` no hay a donde bajar: el monitor no se crea.
    this.frameMonitor = tier === 'low' ? null : new FrameMonitor(tier);
    const config = TIER_CONFIG[tier];
    this.particles.setLimits({
      transient: config.transientSpores,
      ambient: config.ambientSpores,
    });
    this.syncAmbient();
    this.syncEnvironment();
    this.syncPostFx();
    if (this.shadowMesh) this.shadowMesh.visible = config.contactShadows;

    if (resizeNow) this.resize();
  }

  // ==========================================================================
  // Atmosfera (C1-C3)
  // ==========================================================================

  /**
   * Prende y apaga IBL, cielo y luz de rim segun el tier.
   *
   * Se construye de forma PEREZOSA: en `low` no se crea nada, ni el cubo PMREM
   * ni la esfera. Eso es lo que sostiene la regla de oro de la calidad —`low`
   * es el camino de render de siempre— sin tener que preguntar por el tier
   * dentro de `buildWorld()`, que corre antes de que el nivel se fije.
   */
  private syncEnvironment(): void {
    const on = TIER_CONFIG[this.tier].environment;

    if (on && !this.envTexture) this.buildEnvironment();

    // `scene.environment` se lee en todos los `MeshStandardMaterial`: las
    // cartas, el tapete y las pilas. En null, simplemente no aporta.
    this.scene.environment = on ? this.envTexture : null;
    // Menos de 1: el IBL suma, no reemplaza. Con intensidad plena el tapete
    // se lava y las caras pierden contraste.
    this.scene.environmentIntensity = on ? 0.55 : 0;
    // Los hongos de la Arena brillan mas cuando entra el IBL: con la escena mas
    // levantada, el glow de siempre ya no alcanza para despegarlos del fondo.
    this.arena?.setGlow(on ? ARENA_GLOW_ENVIRONMENT : ARENA_GLOW_BASE);

    if (this.skyMesh) this.skyMesh.visible = on;
    if (this.rimLight) this.rimLight.visible = on;

    // Con IBL las dos luces base BAJAN: el ambiente ya aporta luz difusa, y
    // dejarlas como estan suma de mas y aplana las caras. Los valores de `off`
    // son exactamente los de siempre, asi que `low` no cambia.
    if (this.hemiLight) this.hemiLight.intensity = on ? 0.72 : 1.05;
    if (this.keyLight) this.keyLight.intensity = on ? 1.45 : 1.7;

    // Niebla: en los tiers con atmosfera se usa la exponencial, que crece sin
    // llegar a saturar y se lee como una bruma detras de la mesa. Three.js
    // acepta UNA sola `scene.fog`, asi que la "segunda capa" del plan se
    // expresa cambiando la curva, no apilandola: `FogExp2` a densidad 0.014
    // deja la mesa legible (12% a 30u) y funde el horizonte (40% a 60u).
    this.scene.fog = on
      ? new THREE.FogExp2(UI_COLORS.background, 0.014)
      : new THREE.Fog(UI_COLORS.background, 30, 62);
  }

  /**
   * Cubo PMREM procedural de 64 px de lado.
   *
   * Sin HDRI externo a proposito: sumaria una descarga y una dependencia de
   * licencia para algo que aca solo tiene que aportar una distribucion de luz
   * (cielo frio arriba, relleno violeta abajo). El PMREM se genera UNA vez y
   * se reutiliza aunque el jugador cambie de calidad.
   */
  private buildEnvironment(): void {
    const pmrem = new THREE.PMREMGenerator(this.renderer);

    const envScene = new THREE.Scene();
    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(10, 12, 8),
      new THREE.MeshBasicMaterial({ color: 0x0d1a24, side: THREE.BackSide }),
    );
    // Dos emisores: el key frio arriba (el que ya pinta la DirectionalLight) y
    // un relleno violeta abajo, que es lo que da la sensacion de "humedad".
    const key = new THREE.Mesh(
      new THREE.SphereGeometry(3.2, 10, 8),
      new THREE.MeshBasicMaterial({ color: 0x3d6f8c }),
    );
    key.position.set(-2, 6, 2);
    const fill = new THREE.Mesh(
      new THREE.SphereGeometry(2.4, 8, 6),
      new THREE.MeshBasicMaterial({ color: 0x33244a }),
    );
    fill.position.set(4, -4, -3);
    envScene.add(dome, key, fill);

    try {
      this.envTexture = pmrem.fromScene(envScene, 0.04).texture;
    } finally {
      // El generador y la escena auxiliar se van: solo sobrevive la textura.
      pmrem.dispose();
      dome.geometry.dispose();
      (dome.material as THREE.Material).dispose();
      key.geometry.dispose();
      (key.material as THREE.Material).dispose();
      fill.geometry.dispose();
      (fill.material as THREE.Material).dispose();
    }

    this.disposables.push(this.envTexture);

    // --- Cielo (C3) ---
    const skyGeometry = new THREE.SphereGeometry(120, 24, 16);
    const skyMaterial = createSkyMaterial();
    this.skyMesh = new THREE.Mesh(skyGeometry, skyMaterial);
    // Se dibuja PRIMERO y no escribe profundidad: asi todo lo demas queda
    // encima sin pelear por el depth buffer.
    this.skyMesh.renderOrder = -1;
    this.skyMesh.frustumCulled = false;
    this.scene.add(this.skyMesh);
    this.disposables.push(skyGeometry, skyMaterial);

    // --- Rim light (C2) ---
    // Una sola y tenue: separa las cartas del fondo sin sumar una vuelta cara
    // al bucle de iluminacion (las `PointLight` son las mas costosas).
    this.rimLight = new THREE.PointLight(0x5fd8e8, 12, 40, 2);
    this.rimLight.position.set(0, 5, -14);
    this.scene.add(this.rimLight);
  }

  /** Las esporas de fondo son decorativas: se apagan con `reduceMotion`. */
  private syncAmbient(): void {
    this.particles.setAmbientEnabled(!this.reduceMotion && TIER_CONFIG[this.tier].ambientSpores > 0);
  }

  /**
   * Crea o destruye la cadena de post-procesamiento segun el tier.
   *
   * Se RECONSTRUYE entera en cada cambio en vez de reconfigurarse: cambiar de
   * `medium` a `high` cambia la cantidad de iteraciones del blur, la fuerza y
   * la mezcla del grade, y tocar los pases en caliente es mas facil de romper
   * que de arreglar. Cambiar de tier es un evento raro (un ajuste o una
   * degradacion automatica), asi que el costo no importa.
   *
   * Al bajar a `low` se destruye en vez de dejarla apagada: son cinco render
   * targets, dos de ellos a resolucion completa, y no tiene sentido reservar
   * esa memoria para un camino que no la usa.
   */
  private syncPostFx(): void {
    if (this.postFx) {
      this.postFx.dispose();
      this.postFx = null;
    }

    const config = TIER_CONFIG[this.tier];
    if (!config.composer) return;

    const canvas = this.renderer.domElement;
    this.postFx = new PostFx({
      renderer: this.renderer,
      scene: this.scene,
      camera: this.rig.camera,
      width: canvas.clientWidth || window.innerWidth,
      height: canvas.clientHeight || window.innerHeight,
      bloom: config.bloom,
      bloomStrength: config.bloomStrength,
      bloomThreshold: config.bloomThreshold,
      bloomKnee: config.bloomKnee,
      bloomIterations: config.bloomIterations,
      gradeMix: config.gradeMix,
      samples: config.samples,
    });
  }

  /** Estado de calidad actual. Lo consume el panel de debug (F3) y el smoke. */
  quality(): {
    tier: QualityTier;
    reason: TierReason;
    dpr: number;
    composer: boolean;
    bloom: boolean;
    gradeMix: number;
  } {
    const config = TIER_CONFIG[this.tier];
    return {
      tier: this.tier,
      reason: this.tierReason,
      dpr: Math.min(window.devicePixelRatio, config.maxDpr),
      composer: config.composer,
      bloom: config.bloom,
      gradeMix: config.gradeMix,
    };
  }

  /**
   * Lo que eligio la deteccion por dispositivo, ignorando lo que haya forzado
   * el jugador. Lo necesita el controlador para resolver el ajuste `auto`.
   */
  detectedQuality(): TierDetection {
    return this.detected;
  }

  /**
   * Arranca una medicion de frame times. Devuelve el resumen cuando junto
   * `frames` muestras. Bajo render por software los valores absolutos no
   * significan nada, pero el COCIENTE entre dos configuraciones si.
   */
  startPerf(frames = 240): void {
    this.perf = { samples: [], target: frames };
  }

  perfReport(): { frames: number; p50: number; p95: number; tier: QualityTier } | null {
    if (!this.perf || this.perf.samples.length === 0) return null;
    const sorted = [...this.perf.samples].sort((a, b) => a - b);
    const at = (q: number): number => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))] ?? 0;
    return { frames: sorted.length, p50: at(0.5), p95: at(0.95), tier: this.tier };
  }

  // ==========================================================================
  // Construccion de la escena
  // ==========================================================================

  private buildWorld(): void {
    this.scene.background = new THREE.Color(UI_COLORS.background);
    this.scene.fog = new THREE.Fog(UI_COLORS.background, 30, 62);

    // --- Arena: suelo de tiles 3D + vegetacion ---
    //
    // Reemplaza al viejo plano de 90x64 con la foto pegada. El suelo ahora es
    // geometria de verdad (piedra lisa en la franja de juego, tierra y pasto
    // alrededor) y los hongos se apiñan en la banda de atras, que es la que la
    // camara ve. Ver `Arena.ts`: la arena entera sale en DOS draw calls.
    //
    // No depende de `assets`: los tiles y los hongos son geometria procedural
    // de Polyfork, no texturas del pack de arte. Por eso aca no hay cadena de
    // respaldo ni 404 posible.
    this.arena = buildArena();
    this.scene.add(this.arena.group);
    this.disposables.push(...this.arena.disposables);

    // --- Luces ---
    //
    // DOS luces, no cuatro. Cada luz dinamica extra es una vuelta mas del bucle
    // de iluminacion en CADA fragmento iluminado (cartas, mesa, pilas), y en un
    // celular eso es fill rate puro.
    //
    // Las dos `PointLight` que habia (rim cian + relleno violeta) se fueron: su
    // trabajo lo hacen el halo de cada carta, que ya tiene color propio, y el
    // charco de luz horneado en el canvas de la mesa. La `HemisphereLight` toma
    // el lugar del ambient Y ademas da un gradiente direccional (cielo cian,
    // suelo casi negro) que el ambient plano no daba.
    this.hemiLight = new THREE.HemisphereLight(0x5b8ba8, 0x080c12, 1.05);
    this.keyLight = new THREE.DirectionalLight(0xcfe6ff, 1.7);
    this.keyLight.position.set(-6, 18, 12);
    this.scene.add(this.hemiLight, this.keyLight);

    // --- Particulas ---
    this.scene.add(this.particles.group);

    // --- Dorso (una sola textura para todo el juego) ---
    // La comparten el mazo, el descarte y el dorso de cada carta: dibujarla una
    // vez por carta seria subir decenas de canvas identicos a la GPU.
    this.backTexture = new THREE.CanvasTexture(
      createCardBackCanvas(this.assets.get(CARD_BACK_KEY)),
    );
    this.backTexture.colorSpace = THREE.SRGBColorSpace;
    this.disposables.push(this.backTexture);

    // --- Mazo y descarte ---
    this.deckMesh = this.buildPile(DECK_X, DECK_Z, 7);
    this.discardMesh = this.buildPile(DISCARD_X, DISCARD_Z, 4);
    this.scene.add(this.deckMesh, this.discardMesh);

    this.buildShadows();
  }

  /**
   * Sombras de contacto: UN `InstancedMesh` para todas las cartas.
   *
   * Se construye siempre y se prende o apaga por tier: es un mesh, una textura
   * y una geometria, y crearlo bajo demanda obligaria a reconstruir la escena
   * cada vez que alguien cambia la calidad.
   */
  private buildShadows(): void {
    const texture = new THREE.CanvasTexture(createShadowCanvas());
    const material = new THREE.MeshBasicMaterial({
      map: texture,
      // El color lo pone el material y el degradado va en el ALPHA de la
      // textura: por eso el material es negro y la textura no tiene color.
      color: 0x000000,
      transparent: true,
      depthWrite: false,
    });
    const geometry = new THREE.PlaneGeometry(1, 1);
    const mesh = new THREE.InstancedMesh(geometry, material, SHADOW_MAX);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;
    // Antes que el resto de lo transparente: la sombra va sobre la mesa.
    mesh.renderOrder = -1;
    mesh.count = 0;
    mesh.visible = false;

    this.scene.add(mesh);
    this.disposables.push(texture, material, geometry);
    this.shadowMesh = mesh;
  }

  /**
   * Reposiciona las sombras debajo de cada carta viva.
   *
   * La sombra se apoya en la MESA (`SHADOW_Y`), no donde esta la carta: si
   * siguiera su altura, al levantar una carta la sombra subiria con ella y el
   * efecto se perderia. Tampoco hereda el giro (`home.flip`) ni la inclinacion
   * del arrastre: una sombra siempre esta acostada.
   */
  private updateShadows(): void {
    const mesh = this.shadowMesh;
    if (!mesh || !mesh.visible) return;

    let count = 0;
    this.forEachCard((card) => {
      if (count >= SHADOW_MAX) return;
      // Se encoge al despegarse de la mesa: es la unica pista de profundidad
      // que tiene una carta acostada.
      const scale = 1 - card.liftAmount * 0.3;
      this.shadowDummy.position.set(card.home.x, SHADOW_Y, card.home.z);
      this.shadowDummy.rotation.set(-Math.PI / 2, 0, card.home.rz);
      this.shadowDummy.scale.set(
        CARD_WIDTH * SHADOW_SPREAD * scale,
        CARD_HEIGHT * SHADOW_SPREAD * scale,
        1,
      );
      this.shadowDummy.updateMatrix();
      mesh.setMatrixAt(count, this.shadowDummy.matrix);
      count += 1;
    });

    mesh.count = count;
    mesh.instanceMatrix.needsUpdate = true;
  }

  /** Recorre todas las cartas vivas sin asignar nada por frame. */
  private forEachCard(visit: (card: Card3D) => void): void {
    for (const card of this.handCards.values()) visit(card);
    for (const card of this.jokerCards.values()) visit(card);
    for (const card of this.scoringCards) visit(card);
  }

  /** Pila de cartas (mazo o descarte): N planos apilados con el dorso. */
  private buildPile(x: number, z: number, layers: number): THREE.Group {
    const group = new THREE.Group();

    const geometry = new THREE.PlaneGeometry(CARD_WIDTH * 0.92, CARD_HEIGHT * 0.92);
    const material = new THREE.MeshStandardMaterial({
      map: this.backTexture,
      roughness: 0.7,
      metalness: 0.2,
      emissive: new THREE.Color(0x1a3a4a),
      emissiveIntensity: 0.5,
    });
    this.disposables.push(geometry, material);

    for (let i = 0; i < layers; i++) {
      const layer = new THREE.Mesh(geometry, material);
      layer.rotation.x = -Math.PI / 2;
      layer.rotation.z = (Math.random() - 0.5) * 0.05;
      layer.position.set(
        x + (Math.random() - 0.5) * 0.06,
        0.05 + i * 0.012,
        z + (Math.random() - 0.5) * 0.06,
      );
      group.add(layer);
    }
    return group;
  }

  /**
   * Zonas de destino del arrastre.
   *
   * `accepts` consulta el estado del motor, que es lo unico que el render
   * necesita saber para decidir si una zona esta disponible. El SIGNIFICADO de
   * cada zona (que hace el motor al soltar) lo decide el controlador.
   */
  private buildDropZones(): void {
    const inPlay = (card: Card3D): boolean =>
      card.kind === 'card' && this.engine.run.status === 'playing';

    const discard = new DropZone({
      id: 'discard',
      rect: ZONE_DISCARD,
      color: ZONE_COLOR.discard,
      accepts: (card) => inPlay(card) && (this.engine.round?.discardsLeft ?? 0) > 0,
    });
    const play = new DropZone({
      id: 'play',
      rect: ZONE_PLAY,
      color: ZONE_COLOR.play,
      accepts: inPlay,
    });
    const hand = new DropZone({
      id: 'hand',
      rect: ZONE_HAND,
      color: ZONE_COLOR.hand,
      accepts: inPlay,
    });

    // El descarte primero: su rectangulo cae dentro de la banda de la mano.
    this.dropZones.push(discard, play, hand);
    for (const zone of this.dropZones) this.scene.add(zone.group);

    this.interaction.setDropZones(this.dropZones);
  }

  // ==========================================================================
  // Modos: pantalla de inicio vs partida
  // ==========================================================================

  /**
   * En 'menu' se apagan mazo, descarte y jokers, quedan la mesa, las luces y
   * las particulas, y aparecen unas cartas decorativas a la deriva.
   *
   * OJO con el RNG: las cartas decorativas se eligen con `Math.random`, NO con
   * el RNG del motor. Si consumieran el RNG sembrado, el menu cambiaria la
   * partida siguiente y se romperia la reproducibilidad.
   */
  setMode(mode: 'menu' | 'run', options?: { reduceMotion?: boolean }): void {
    const reduceMotion = options?.reduceMotion ?? this.reduceMotion;
    // Va ANTES del early return: cambiar `reduceMotion` con el mismo modo tiene
    // que apagar las esporas igual, y el modo no cambia.
    if (reduceMotion !== this.reduceMotion) {
      this.reduceMotion = reduceMotion;
      this.syncAmbient();
    }
    if (this.mode === mode) return;
    this.mode = mode;

    const inMenu = mode === 'menu';
    if (this.deckMesh) this.deckMesh.visible = !inMenu;
    if (this.discardMesh) this.discardMesh.visible = !inMenu;
    // Las esporas ambientales se quedan en los dos modos: son un solo
    // THREE.Points y son lo que hace que el menu no se vea como una foto.
    this.syncAmbient();
    // En el menu no hay cartas en la mano: las zonas de destino sobran.
    if (inMenu) for (const zone of this.dropZones) zone.setEnabled(false);

    if (inMenu) this.buildMenuDecor();
    else this.clearMenuDecor();
  }

  private buildMenuDecor(): void {
    if (this.reduceMotion || this.menuCards.length > 0) return;

    const pool = this.engine.registry.allCards();
    if (pool.length === 0) return;

    const count = Math.min(6, pool.length);
    for (let i = 0; i < count; i++) {
      const def = pool[Math.floor(Math.random() * pool.length)];
      if (!def) continue;
      const card = this.engine.registry.instantiateFrom(def);
      const card3d = this.createCard3D(card);

      // Se colocan AL FONDO de la mesa (Z muy negativo): es la banda alta de la
      // pantalla, la unica que el panel del menu deja libre. En el centro
      // quedarian tapadas por el propio panel.
      const t = count === 1 ? 0.5 : i / (count - 1);
      const x = -11 + t * 22;
      const z = -7.5 + Math.sin(i * 1.7) * 1.8;

      card3d.home.x = x;
      card3d.home.y = 0.34;
      card3d.home.z = z;
      card3d.home.rx = -Math.PI / 2;
      card3d.home.rz = (Math.random() - 0.5) * 0.3;
      card3d.snapToHome();

      this.menuCards.push(card3d);
      this.menuBaseZ.push(z);
    }
  }

  private clearMenuDecor(): void {
    for (const card3d of this.menuCards) {
      this.tweens.cancelFor(card3d.home);
      card3d.dispose();
      this.scene.remove(card3d.group);
    }
    this.menuCards.length = 0;
    this.menuBaseZ.length = 0;
  }

  /** Deriva lenta de las cartas del menu. Se anima en el loop, sin tweens. */
  private updateMenuDecor(dt: number): void {
    this.menuCards.forEach((card3d, i) => {
      const t = this.clock * 0.28 + i * 1.31;
      card3d.home.y = 0.32 + Math.sin(t) * 0.16;
      card3d.home.z = (this.menuBaseZ[i] ?? 0) + Math.cos(t * 0.72) * 0.45;
      card3d.home.rz = Math.sin(t * 0.5) * 0.14;
      // Cada tanto una carta se da vuelta: es la presentacion natural del
      // dorso y ejercita el giro en un camino que corre siempre. Usa
      // `this.clock`, nunca el RNG del motor.
      card3d.home.flip = this.menuFlip(i);
      card3d.update(dt, this.clock);
    });
  }

  /**
   * Giro de las cartas decorativas: onda triangular lenta con suavizado, y
   * cada carta desfasada de las demas. Nunca dos giran a la vez.
   */
  private menuFlip(index: number): number {
    const cycle = (this.clock * 0.11 + index * 0.37) % 1;
    const triangle = cycle < 0.5 ? cycle * 2 : 2 - cycle * 2;
    return triangle * triangle * (3 - 2 * triangle);
  }

  // ==========================================================================
  // Suscripciones al bus (aca el motor se vuelve imagen)
  // ==========================================================================

  private subscribe(): void {
    this.unsubscribes.push(
      bus.on('state:changed', ({ round }) => {
        if (round) this.syncHand(round.hand, this.engine.round?.selected ?? []);
        this.syncJokers(this.engine.run.jokers);
      }),

      bus.on('card:played', ({ card, index }) => {
        // Primer carta de la mano: se reinicia la secuencia de puntuacion.
        if (index === 0) this.stepIndex = 0;
        this.queueFx(index * 0.085, () => this.moveToPlayZone(card.uid));
      }),

      bus.on('card:discarded', ({ card, index }) => {
        this.queueFx(index * 0.06, () => this.flyToDiscard(card.uid));
      }),

      bus.on('card:drawn', ({ card }) => {
        this.queueFx(0.05, () => this.flyInFromDeck(card));
      }),

      bus.on('score:step', ({ step }) => this.onScoreStep(step)),

      // Al cerrar la mano, las cartas de la zona de puntuacion se retiran.
      // Sin esto se acumularian en la mesa partida tras partida.
      bus.on('score:hand', () => this.retireScoringCards(0.9)),

      bus.on('trigger:chain', ({ fromId, toId, depth }) => {
        this.queueFx(0.02, () => this.drawChain(fromId, toId, depth));
      }),

      bus.on('trigger:fired', ({ sourceId, depth }) => {
        // Un joker que dispara merece que se note.
        const joker = this.jokerCards.get(sourceId);
        if (joker) this.queueFx(0.02, () => this.pulseJoker(joker, depth));
      }),

      bus.on('round:win', () => this.celebrate()),
      bus.on('round:loss', () => this.doom()),

      bus.on('card:destroyed', ({ card }) => {
        const target = this.handCards.get(card.uid);
        if (target) this.queueFx(0, () => this.dissolve(target));
      }),

      // --- Cultivo: mejora y evolucion ---
      bus.on('card:levelup', ({ card }) => {
        const target = this.handCards.get(card.uid);
        if (target) this.queueFx(0, () => this.celebrateCard(target, 0xf2a63b, 26));
      }),

      bus.on('card:evolved', ({ card }) => {
        // La carta pudo haber cambiado de definicion: hay que regenerar su
        // textura (la cache incluye id + nivel, asi que sale una nueva).
        const target = this.handCards.get(card.uid);
        if (!target) return;
        this.queueFx(0, () => this.playEvolution(target, card));
      }),

      bus.on('i18n:changed', () => this.rebuildTextures()),
    );
  }

  /**
   * Destello + estallido de esporas sobre una carta.
   *
   * El destello se anima con un objeto plano y no con la propiedad del
   * material: asi el tween no pelea con `update()`, que reescribe el brillo
   * del halo en cada frame.
   */
  private celebrateCard(card3d: Card3D, color: number, particles: number): void {
    const flash = { value: 0 };
    this.tweens.to(flash, { value: 1 }, {
      duration: 0.18,
      ease: 'quadOut',
      onUpdate: () => card3d.setFlash(flash.value),
      onComplete: () => {
        const fade = { value: 1 };
        this.tweens.to(fade, { value: 0 }, {
          duration: 0.5,
          ease: 'cubicOut',
          onUpdate: () => card3d.setFlash(fade.value),
        });
      },
    });

    const origin = card3d.worldPosition();
    this.particles.burst(origin, particles, { color, speed: 4.2, spread: 0.55, size: 0.1, life: 0.8 });
    this.rig.addShake(0.08);
  }

  /**
   * VFX de evolucion: medio giro para cambiar la cara.
   *
   * El intercambio de textura ocurre con la carta BOCA ABAJO (flip = 1), no a
   * mitad del giro: ahi el cambio es literalmente invisible y la carta vuelve
   * mostrando el arte nuevo. Leer el cambio como "se dio vuelta y volvio
   * transformada" es lo que hace que una evolucion se sienta distinta de una
   * mejora (que solo destella).
   */
  private playEvolution(card3d: Card3D, card: CardInstance): void {
    this.tweens.cancelFor(card3d.home);
    // El giro se encadena a mano en vez de usar `setFaceUp` + `delay`: la
    // `from` de un tween se resuelve al crearlo, y en ese momento `home.flip`
    // todavia vale 0. Encadenando en `onComplete` el segundo tramo arranca
    // desde 1 de verdad.
    this.tweens.to(card3d.home, { flip: 1 }, {
      duration: 0.2,
      ease: 'quadIn',
      onComplete: () => {
        // La textura se regenera aca: la cache indexa por id + nivel, asi que
        // la definicion nueva produce una textura nueva.
        card3d.setCard(card, this.textures, this.lang(), this.artForCard(card));
        this.tweens.to(card3d.home, { flip: 0 }, { duration: 0.32, ease: 'quadOut' });
      },
    });
    this.celebrateCard(card3d, 0xa78bfa, 60);
  }

  // ==========================================================================
  // Sincronizacion con el estado
  // ==========================================================================

  private syncHand(cards: readonly CardInstance[], selectedUids: readonly string[]): void {
    const alive = new Set(cards.map((c) => c.uid));

    // --- Fuera: cartas que ya no estan en la mano ---
    for (const [uid, card3d] of [...this.handCards]) {
      if (alive.has(uid)) continue;
      this.handCards.delete(uid);
      // Si esta en la zona de puntuacion, la maneja la secuencia de scoring.
      if (!this.scoringCards.includes(card3d)) {
        this.tweens.cancelFor(card3d.home);
        card3d.dispose();
        this.scene.remove(card3d.group);
      }
    }

    // --- Dentro: cartas nuevas ---
    for (const card of cards) {
      let card3d = this.handCards.get(card.uid);
      if (!card3d) {
        card3d = this.createCard3D(card);
        this.handCards.set(card.uid, card3d);
        // Aparece desde el mazo.
        card3d.home.x = DECK_X;
        card3d.home.y = 0.05;
        card3d.home.z = DECK_Z;
      } else {
        card3d.setCard(card, this.textures, this.lang(), this.artForCard(card));
      }
      card3d.setSelected(selectedUids.includes(card.uid));
    }

    // Si la carta que se estaba arrastrando salio de la mano (el motor la
    // descarto, la jugo o se transformo), el gesto queda colgado: se aborta.
    if (this.dragUid !== null && !this.handCards.has(this.dragUid)) {
      this.dragUid = null;
      this.interaction.cancelDrag();
    }

    this.layoutHand();
    this.refreshTargets();
  }

  private syncJokers(jokers: readonly JokerInstance[]): void {
    const alive = new Set(jokers.map((j) => j.uid));

    for (const [uid, card3d] of [...this.jokerCards]) {
      if (alive.has(uid)) continue;
      this.jokerCards.delete(uid);
      card3d.dispose();
      this.scene.remove(card3d.group);
    }

    for (const joker of jokers) {
      let card3d = this.jokerCards.get(joker.uid);
      if (!card3d) {
        card3d = this.createCard3D(null, joker);
        this.jokerCards.set(joker.uid, card3d);
      } else {
        card3d.setJoker(joker, this.textures, this.lang(), this.artForJoker(joker));
      }
    }

    this.layoutJokers();
    this.refreshTargets();
  }

  private createCard3D(card: CardInstance | null, joker?: JokerInstance): Card3D {
    const uid = card?.uid ?? joker?.uid ?? `tmp_${Math.random()}`;
    const isJoker = !!joker;
    const elementColor = card ? ELEMENT_COLOR[card.def.element] : 0x8fd8e8;
    const rarity = card?.def.rarity ?? joker?.def.rarity ?? 'common';

    const card3d = new Card3D(uid, isJoker ? 'joker' : 'card', elementColor, rarity);
    if (this.backTexture) card3d.setBackTexture(this.backTexture);
    if (card) card3d.setCard(card, this.textures, this.lang(), this.artForCard(card));
    if (joker) card3d.setJoker(joker, this.textures, this.lang(), this.artForJoker(joker));

    if (isJoker) card3d.group.scale.setScalar(JOKER_SCALE);
    this.scene.add(card3d.group);
    card3d.snapToHome();
    return card3d;
  }

  /**
   * Ilustracion REAL de una carta: el WebP del catalogo, o el respaldo que
   * corresponda segun la cadena.
   *
   * Es PUBLICO porque la UI tambien la necesita. La miniatura del mazo y de la
   * tienda tienen que mostrar la MISMA imagen que la carta en la mano; si la UI
   * se dibuja su propia silueta procedural, el jugador ve dos ilustraciones
   * distintas para la misma carta. La UI no conoce los assets, asi que se los
   * presta el render, que es quien los tiene cargados.
   */
  cardArt(def: { id: string; element: ElementType; rarity: Rarity }): HTMLImageElement | undefined {
    return this.assets.getFirst(artKeysFor(def.element, def.rarity, def.id));
  }

  private artForCard(card: CardInstance): HTMLImageElement | undefined {
    return this.cardArt(card.def);
  }

  /**
   * Ilustracion real de un joker. Publico por la misma razon que `cardArt`: la
   * tienda tiene que mostrar la misma imagen que la carta en la mano.
   */
  jokerArt(def: JokerDefinition): HTMLImageElement | undefined {
    // El elemento del joker se deduce de su primer efecto con condicion de
    // elemento; si no tiene, cae al arquetipo de micelio.
    for (const effect of def.effects) {
      for (const cond of effect.conditions ?? []) {
        if (cond.type === 'element_is') {
          return this.assets.getFirst(artKeysForJoker(cond.value, def.rarity));
        }
      }
    }
    return this.assets.getFirst(artKeysForJoker('neutral', def.rarity));
  }

  private artForJoker(joker: JokerInstance): HTMLImageElement | undefined {
    return this.jokerArt(joker.def);
  }

  private lang(): string {
    return document.documentElement.lang || 'en';
  }

  // ==========================================================================
  // Layout
  // ==========================================================================

  private layoutHand(): void {
    const cards = [...this.handCards.values()];
    const count = cards.length;
    if (count === 0) return;

    const spacing = count <= 1 ? 0 : Math.min(2.32, this.handSpread / (count - 1));
    const total = spacing * (count - 1);

    cards.forEach((card, i) => {
      const x = -total / 2 + i * spacing;
      const t = total === 0 ? 0 : x / (total / 2);
      const home = card.home;

      this.tweens.to(
        home,
        {
          x,
          y: HAND_Y - Math.abs(t) * 0.1,
          z: HAND_Z + t * t * 0.5,
          rx: -Math.PI / 2,
          ry: 0,
          rz: -x * 0.016,
        },
        { duration: 0.42, ease: 'backOut' },
      );
    });
  }

  private layoutJokers(): void {
    const cards = [...this.jokerCards.values()];
    const count = cards.length;
    if (count === 0) return;

    // El espaciado sale del ancho REAL de la carta, no de un numero fijo.
    // Y lo que manda no es `CARD_WIDTH` sino el HALO, que es el contorno mas
    // grande: a escala joker la carta mide 1.1 pero el halo 1.63. El 1.5 fijo
    // de antes era menor que el halo, asi que se pisaban y la fila se leia
    // como una mancha continua en vez de como cartas separadas.
    const haloWidth = CARD_HALO_WIDTH * JOKER_SCALE;
    const gap = 0.3;
    // Si algun dia entran mas jokers de los que caben, se comprime el espacio
    // ANTES que dejar que la fila se salga de cuadro.
    const maxSpan = this.handSpread + CARD_WIDTH;
    const wanted = haloWidth + gap;
    const spacing = count > 1 ? Math.min(wanted, maxSpan / (count - 1)) : wanted;
    const total = spacing * (count - 1);

    cards.forEach((card, i) => {
      const x = -total / 2 + i * spacing;
      this.tweens.to(
        card.home,
        { x, y: JOKER_Y, z: JOKER_Z, rx: -Math.PI / 2, ry: 0, rz: 0 },
        { duration: 0.36, ease: 'cubicOut' },
      );
    });
  }

  private moveToPlayZone(uid: string): void {
    const card3d = this.handCards.get(uid);
    if (!card3d) return;

    this.handCards.delete(uid);
    this.scoringCards.push(card3d);
    card3d.setSelected(false);
    card3d.group.scale.setScalar(PLAY_SCALE);

    // Se re-acomoda TODA la fila, no solo la carta que llega.
    //
    // Antes cada carta se ubicaba con el ancho de la fila EN ESE MOMENTO, pero
    // las anteriores se quedaban donde estaban: la primera caia en x=0, la
    // segunda en -1.02, la tercera en -2.05... o sea que la fila crecia hacia
    // la IZQUIERDA y terminaba descentrada. Re-acomodando todas, la fila queda
    // centrada y las que ya estaban se corren solas al entrar una nueva, que
    // ademas se lee mucho mejor: la mano se "acomoda" en el centro.
    const spacing = PLAY_SPACING;
    const total = spacing * Math.max(0, this.scoringCards.length - 1);

    this.scoringCards.forEach((card, index) => {
      const x = -total / 2 + index * spacing;
      this.tweens.to(
        card.home,
        { x, y: PLAY_Y, z: PLAY_Z, rx: -Math.PI / 2, ry: 0, rz: 0 },
        {
          duration: 0.42,
          ease: 'backOut',
          // El golpe de aterrizaje es solo para la que LLEGA: las que se corren
          // no tocan la mesa, se deslizan.
          ...(card === card3d
            ? {
                onComplete: () => {
                  this.particles.burst(card3d.worldPosition(), 14, {
                    color: card3d.elementColor,
                    speed: 1.9,
                    upward: 1.6,
                    size: 0.07,
                    life: 0.85,
                  });
                  this.rig.addShake(0.035);
                },
              }
            : {}),
        },
      );
    });
  }

  private flyToDiscard(uid: string): void {
    const card3d = this.handCards.get(uid);
    if (!card3d) return;
    this.handCards.delete(uid);

    this.tweens.to(
      card3d.home,
      {
        x: DISCARD_X + (Math.random() - 0.5) * 0.4,
        y: 0.4,
        z: DISCARD_Z,
        // `rx` explicito: si la carta venia de un arrastre esta inclinada, y
        // sin esto volaria al descarte torcida.
        rx: -Math.PI / 2,
        rz: (Math.random() - 0.5) * 0.5,
      },
      {
        duration: 0.45,
        ease: 'quadOut',
        onComplete: () => {
          this.particles.burst(card3d.worldPosition(), 8, {
            color: 0x7a8794,
            speed: 1.1,
            upward: 0.8,
            size: 0.05,
            life: 0.6,
          });
          this.retire(card3d);
        },
      },
    );
  }

  private flyInFromDeck(card: CardInstance): void {
    const card3d = this.handCards.get(card.uid);
    if (!card3d) return;
    // `layoutHand` ya lo mueve a su lugar; esto solo agrega el destello de salida.
    this.particles.burst(new THREE.Vector3(DECK_X, 0.5, DECK_Z), 6, {
      color: 0x5fd8e8,
      speed: 1.2,
      upward: 1.0,
      size: 0.05,
      life: 0.5,
    });
  }

  private onScoreStep(step: ScoreStep): void {
    const index = this.stepIndex++;
    if (index >= MAX_ANIMATED_STEPS) return;

    this.queueFx(0.42 + index * this.stepStagger, () => {
      const origin = this.findWorldPosition(step.sourceId, step.targetUid);
      const color = this.colorForAction(step.action, origin.color);

      this.particles.burst(origin.position, step.action === 'MULTIPLY_SPORES' ? 18 : 10, {
        color,
        speed: step.action === 'MULTIPLY_SPORES' ? 2.6 : 1.8,
        upward: 1.8,
        size: step.action === 'MULTIPLY_SPORES' ? 0.09 : 0.065,
        life: 0.9,
      });

      if (step.action === 'MULTIPLY_SPORES') this.rig.addShake(0.05);

      const sign = step.value >= 0 ? '+' : '';
      const text =
        step.action === 'MULTIPLY_SPORES' ? `x${step.value}` : `${sign}${Math.round(step.value)}`;

      const screen = this.projectToScreen(origin.position);

      if (this.callbacks.onScorePopup) {
        this.callbacks.onScorePopup(screen.x, screen.y, text, color);
      }

      // El contador en vivo: el HUD necesita saber QUE paso se esta viendo
      // AHORA para ir al ritmo de la animacion, no al del motor.
      this.callbacks.onScoreTick?.({
        index,
        text,
        color,
        sourceKey: step.sourceNameKey,
        isBonus: step.sourceId.startsWith('combo:') || step.sourceId.startsWith('order:'),
        negative: step.value < 0,
        x: screen.x,
        y: screen.y,
      });
    });
  }

  private drawChain(fromId: string, toId: string, depth: number): void {
    const from = this.findWorldPosition(fromId, undefined);
    const to = this.findWorldPosition(toId, undefined);
    const distance = from.position.distanceTo(to.position);
    if (distance < 0.05) return;

    this.particles.stream(from.position, to.position, this.isMobile ? 10 : 18, to.color, 1.4);
    // Shake mas fuerte cuanto mas profunda la cadena: comunica el combo.
    this.rig.addShake(Math.min(0.16, 0.03 + depth * 0.012));
  }

  private pulseJoker(card3d: Card3D, depth: number): void {
    const base = JOKER_SCALE;
    this.tweens.to(
      card3d.group.scale,
      { x: base * 1.22, y: base * 1.22, z: base * 1.22 },
      {
        duration: 0.1,
        ease: 'quadOut',
        onComplete: () => {
          this.tweens.to(card3d.group.scale, { x: base, y: base, z: base }, { duration: 0.22 });
        },
      },
    );
    this.particles.burst(card3d.worldPosition(), 10, {
      color: 0x5fd8e8,
      speed: 1.8,
      upward: 1.2,
      size: 0.055,
      life: 0.7,
    });
    this.rig.addShake(Math.min(0.12, 0.02 + depth * 0.01));
  }

  private celebrate(): void {
    this.rig.addShake(0.32);
    const center = new THREE.Vector3(0, 0.6, PLAY_Z);
    this.particles.burst(center, this.isMobile ? 70 : 130, {
      color: 0x4fd18b,
      speed: 5.2,
      upward: 3.4,
      size: 0.11,
      life: 1.5,
    });
    this.particles.burst(center, this.isMobile ? 40 : 70, {
      color: 0xffc857,
      speed: 3.8,
      upward: 4.2,
      size: 0.09,
      life: 1.7,
    });
    this.retireScoringCards(0.4);
  }

  private doom(): void {
    this.rig.addShake(0.5);
    this.particles.burst(new THREE.Vector3(0, 0.5, PLAY_Z), 80, {
      color: 0xe05c8a,
      speed: 3.4,
      upward: 0.4,
      size: 0.09,
      life: 1.2,
    });
  }

  private dissolve(card3d: Card3D): void {
    const origin = card3d.worldPosition();
    this.particles.burst(origin, 34, {
      color: 0xe05c8a,
      speed: 2.8,
      upward: 0.8,
      size: 0.09,
      life: 1.1,
    });
    this.rig.addShake(0.14);
    this.retire(card3d);
  }

  /** Saca una carta de escena con una animacion corta. */
  private retire(card3d: Card3D): void {
    // Se va boca abajo: es a donde va a parar (el descarte), y el descarte no
    // tiene por que mostrar caras que el jugador ya no puede usar.
    card3d.setFaceUp(false, { tweens: this.tweens, duration: 0.3 });
    this.tweens.to(
      card3d.home,
      { y: -1.2, rz: card3d.home.rz + 0.6 },
      {
        duration: 0.35,
        ease: 'quadIn',
        onComplete: () => {
          card3d.dispose();
          this.scene.remove(card3d.group);
        },
      },
    );
  }

  private retireScoringCards(delay = 0.6): void {
    this.queueFx(delay, () => {
      for (const card of this.scoringCards) this.retire(card);
      this.scoringCards.length = 0;
    });
  }

  private rebuildTextures(): void {
    this.textures.clear();
    for (const card3d of this.handCards.values()) {
      if (card3d.card) card3d.setCard(card3d.card, this.textures, this.lang(), this.artForCard(card3d.card));
    }
    for (const card3d of this.jokerCards.values()) {
      if (card3d.joker) {
        card3d.setJoker(card3d.joker, this.textures, this.lang(), this.artForJoker(card3d.joker));
      }
    }
    // El dorso NO se regenera: no tiene texto. Antes se volvia a dibujar "por
    // consistencia", pero solo se aplicaba al mazo (el descarte quedaba con la
    // textura vieja) y ahora ademas lo comparten todas las cartas. Redibujarlo
    // seria subir canvas nuevos a la GPU para no cambiar un pixel.
  }

  // ==========================================================================
  // Interaccion
  // ==========================================================================

  private handleClick(card: Card3D): void {
    if (card.kind !== 'card') return;
    this.callbacks.onCardClick(card.uid);
  }

  private handleHover(card: Card3D | null): void {
    for (const candidate of this.handCards.values()) {
      candidate.setHover(candidate === card);
    }
    if (card?.card) this.callbacks.onHoverChange(card.card);
    else this.callbacks.onHoverChange(null);
  }

  // -------------------------------------------------------------------------
  // Arrastre
  // -------------------------------------------------------------------------

  private handleDragStart(card: Card3D): void {
    const card3d = this.handCards.get(card.uid);
    if (!card3d) return;

    this.dragUid = card.uid;
    // A partir de aca `home` lo escribe el dedo: el tween de layout se cancela
    // o pelearia por la misma posicion.
    this.tweens.cancelFor(card3d.home);
    card3d.setHover(false);
    card3d.setDragging(true);

    for (const zone of this.dropZones) zone.highlight(zone.canAccept(card3d), false);
    this.rig.addShake(0.04);
  }

  private handleDrag(card: Card3D, point: THREE.Vector3, zone: DropZoneHandle | null): void {
    const card3d = this.handCards.get(card.uid);
    if (!card3d) return;

    // SIN tween: perseguir el dedo interpolando se siente con lag. `home` es
    // un objeto plano, escribir x/z por frame no cuesta nada.
    card3d.home.x = point.x;
    card3d.home.y = DRAG_Y;
    card3d.home.z = point.z;
    card3d.home.rx = DRAG_TILT_RX;
    card3d.home.ry = 0;
    card3d.home.rz = 0;

    for (const candidate of this.dropZones) {
      candidate.highlight(candidate.canAccept(card3d), candidate === zone);
    }
  }

  private handleDrop(card: Card3D, zone: DropZoneHandle | null): void {
    const card3d = this.handCards.get(card.uid) ?? null;
    this.dragUid = null;
    for (const candidate of this.dropZones) candidate.highlight(false);

    if (card3d) {
      card3d.setDragging(false);
      card3d.setHover(false);
    }

    // El render no decide NADA: avisa "se solto en la zona X" y el controlador
    // traduce (seleccionar / descartar / devolver). Sin zona, la carta vuelve.
    // El `card3d` puede faltar si el motor saco la carta de la mano a mitad del
    // gesto; en ese caso no hay nada que avisar.
    if (card3d && zone && this.callbacks.onCardDrop) {
      this.callbacks.onCardDrop(card.uid, zone.id);
    }

    // Vuelve a su lugar. Si el motor saco la carta de la mano, `layoutHand` ya
    // no la ve y la animacion de salida la maneja el evento correspondiente.
    this.layoutHand();
    this.refreshTargets();
  }

  private handleDragCancel(card: Card3D): void {
    this.handleDrop(card, null);
  }

  // -------------------------------------------------------------------------
  // Giro
  // -------------------------------------------------------------------------

  /**
   * Da vuelta una carta de la mano.
   *
   * Es la API que va a usar el modo tablero (una carta boca abajo no es de
   * nadie). Hoy la usan el menu y el VFX de evolucion, y es lo que ejercita el
   * smoke test.
   */
  setCardFaceUp(uid: string, faceUp: boolean, animated = true): boolean {
    const card3d = this.handCards.get(uid);
    if (!card3d) return false;
    card3d.setFaceUp(faceUp, { animated, tweens: this.tweens });
    return true;
  }

  /**
   * Instantanea de la mano: donde esta cada carta EN PANTALLA, su giro y si
   * esta seleccionada.
   *
   * La usa el panel de debug (F3) y el smoke test: sin las coordenadas de
   * pantalla no hay forma de apuntar un gesto real a una carta.
   */
  handState(): HandCardState[] {
    const selected = this.engine.round?.selected ?? [];
    const out: HandCardState[] = [];
    for (const card3d of this.handCards.values()) {
      const screen = this.projectToScreen(card3d.worldPosition());
      out.push({
        uid: card3d.uid,
        flip: card3d.flip,
        faceUp: card3d.faceUp,
        hasBack: card3d.hasBack,
        selected: selected.includes(card3d.uid),
        x: card3d.home.x,
        z: card3d.home.z,
        screenX: Math.round(screen.x),
        screenY: Math.round(screen.y),
      });
    }
    return out;
  }

  private refreshTargets(): void {
    const targets: THREE.Object3D[] = [];
    // Cara y dorso: el raycaster respeta `material.side`, asi que solo acierta
    // el que se esta viendo. Ver `Card3D.pickTargets`.
    for (const card3d of this.handCards.values()) targets.push(...card3d.pickTargets);
    this.interaction.setTargets(targets);
  }

  // ==========================================================================
  // Loop
  // ==========================================================================

  start(): void {
    if (this.running) return;
    this.running = true;
    this.clock = 0;
    let last = performance.now();

    const frame = (now: number) => {
      if (!this.running) return;
      this.frameId = requestAnimationFrame(frame);

      // dt acotado: si la pestana estuvo en background, no queremos un salto.
      const rawDt = (now - last) / 1000;
      const dt = Math.min(0.05, rawDt);
      last = now;
      this.clock += dt;

      this.runFxQueue();
      this.tweens.update(dt);
      for (const card3d of this.handCards.values()) card3d.update(dt, this.clock);
      for (const card3d of this.jokerCards.values()) card3d.update(dt, this.clock);
      for (const card3d of this.scoringCards) card3d.update(dt, this.clock);
      if (this.mode === 'menu') this.updateMenuDecor(dt);

      // Las zonas solo existen mientras se puede jugar: fuera de 'playing' no
      // hay cartas en la mano que arrastrar.
      const zonesActive = this.mode === 'run' && this.engine.run.status === 'playing';
      for (const zone of this.dropZones) {
        if (!zonesActive) zone.setEnabled(false);
        zone.update(dt, this.clock);
      }

      this.updateShadows();
      this.particles.update(dt);
      this.rig.update(dt, this.clock);

      // Se renderiza SIEMPRE, tambien en el menu.
      //
      // Ojo: saltarse frames enteros (un `return` temprano dentro del rAF)
      // deja el canvas sin presentar y rompe cualquier captura externa del
      // WebView (por ejemplo, la captura de pantalla de Play o un test
      // headless). El ahorro de bateria del menu viene por otro lado: 6
      // cartas decorativas, sin MSAA, DPR acotado y cero logica de juego.
      //
      // `info` se resetea a mano porque `autoReset` esta apagado: el composer
      // hace un `render()` por pase y el conteo se pisaria.
      this.renderer.info.reset();
      if (this.postFx) this.postFx.render();
      else this.renderer.render(this.scene, this.rig.camera);

      this.sampleFrame(rawDt);
    };

    this.frameId = requestAnimationFrame(frame);
  }

  /**
   * Alimenta el monitor de frames y la medicion opcional.
   *
   * Se usa el tiempo REAL del frame, no el `dt` acotado: el acotado existe para
   * que las animaciones no salten cuando la pestana vuelve del background, no
   * para medir rendimiento. Un salto de background no es un frame lento, asi
   * que se descarta en vez de contar como degradacion.
   */
  private sampleFrame(seconds: number): void {
    if (seconds <= 0 || seconds > 0.5) return;

    if (this.perf && this.perf.samples.length < this.perf.target) {
      this.perf.samples.push(seconds * 1000);
    }

    if (!this.frameMonitor) return;
    const downgraded = this.frameMonitor.sample(seconds);
    if (!downgraded) return;

    const from = this.tier;
    this.applyQuality(downgraded, 'auto-downgrade');
    this.callbacks.onQualityDowngraded?.(downgraded, from);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.frameId);
  }

  private queueFx(delay: number, run: () => void): void {
    this.fxQueue.push({ at: this.clock + delay, run });
  }

  private runFxQueue(): void {
    if (this.fxQueue.length === 0) return;
    const pending: typeof this.fxQueue = [];
    for (const fx of this.fxQueue) {
      if (fx.at <= this.clock) fx.run();
      else pending.push(fx);
    }
    this.fxQueue.length = 0;
    this.fxQueue.push(...pending);
  }

  // ==========================================================================
  // Utilidades
  // ==========================================================================

  private findWorldPosition(
    sourceId: string,
    targetUid: string | undefined,
  ): { position: THREE.Vector3; color: number } {
    const direct =
      this.handCards.get(sourceId) ?? this.jokerCards.get(sourceId) ?? null;
    if (direct) return { position: direct.worldPosition(), color: direct.elementColor };

    const scoring = this.scoringCards.find((c) => c.uid === sourceId);
    if (scoring) return { position: scoring.worldPosition(), color: scoring.elementColor };

    // Combos y efectos globales: el centro de la mesa.
    const center = new THREE.Vector3(0, 0.4, PLAY_Z);
    if (targetUid) {
      const target = this.scoringCards.find((c) => c.uid === targetUid);
      if (target) return { position: target.worldPosition(), color: target.elementColor };
    }
    return { position: center, color: 0x5fd8e8 };
  }

  private colorForAction(action: ScoreStep['action'], fallback: number): number {
    switch (action) {
      case 'ADD_SUBSTRATE':
      case 'MULTIPLY_SUBSTRATE':
        return UI_COLORS.substrate;
      case 'ADD_SPORES':
      case 'MULTIPLY_SPORES':
      case 'SET_SPORES':
        return UI_COLORS.spores;
      case 'GAIN_MONEY':
        return UI_COLORS.money;
      default:
        return fallback;
    }
  }

  /** Mundo -> pantalla (para los numeros flotantes del HUD). */
  projectToScreen(position: THREE.Vector3): { x: number; y: number } {
    const ndc = position.clone().project(this.rig.camera);
    const width = this.renderer.domElement.clientWidth;
    const height = this.renderer.domElement.clientHeight;
    return {
      x: (ndc.x * 0.5 + 0.5) * width,
      y: (-ndc.y * 0.5 + 0.5) * height,
    };
  }

  /**
   * Igual que `projectToScreen` pero con coordenadas sueltas.
   *
   * Sirve para apuntar un gesto a un punto del tablero (el centro de una zona,
   * por ejemplo) sin tener que construir un Vector3 desde afuera.
   */
  projectPointToScreen(x: number, y: number, z: number): { x: number; y: number } {
    return this.projectToScreen(new THREE.Vector3(x, y, z));
  }

  // ==========================================================================
  // Resize
  // ==========================================================================

  resize(): void {
    const canvas = this.renderer.domElement;
    const width = canvas.clientWidth || window.innerWidth;
    const height = canvas.clientHeight || window.innerHeight;
    const aspect = width / Math.max(1, height);

    // DPR limitado por el nivel de calidad: en celular, 3x de DPR mata el
    // framerate sin verse mejor. El tope de `low` es el mismo de siempre.
    const maxDpr = TIER_CONFIG[this.tier].maxDpr;
    const dpr = Math.min(window.devicePixelRatio, maxDpr);
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(width, height, false);
    // El composer no hereda el tamano del renderer: hay que avisarle con las
    // dimensiones LOGICAS y el DPR por separado (ver PostFx.setSize).
    this.postFx?.setSize(width, height, dpr);

    this.rig.resize(aspect);

    // En pantallas anchas la mano puede abrirse; en angostas se compacta.
    this.handSpread = aspect > 1.75 ? 16.5 : aspect > 1.45 ? 14 : 12;

    // El encuadre se DERIVA del layout real, no de un numero a ojo: si se
    // mueve la mano o los jokers, la camara se reajusta sola.
    //
    // El ancho cubre lo MAS ancho entre la mano y los piles: como ahora los
    // piles viven en X=±10.5 (mas alla de los ±8.25 de la mano), el ancho
    // efectivo lo mandan los piles. Si no se ensancha el bound, los pillars
    // quedan fuera de cuadro y el jugador no los ve.
    const pileHalfWidth = Math.max(Math.abs(DECK_X), Math.abs(DISCARD_X)) + CARD_WIDTH * 0.5;
    const handHalfWidth = this.handSpread * 0.5 + CARD_WIDTH * 0.5;
    const halfWidth = Math.max(pileHalfWidth, handHalfWidth) + 0.3;

    const bounds = {
      topZ: HAND_Z + CARD_HALF_DEPTH,
      bottomZ: JOKER_Z - CARD_HALF_DEPTH * JOKER_SCALE,
      width: halfWidth * 2,
    };

    // Corrimiento del encuadre hacia la mano. 0.72 del alto visible del HUD
    // inferior (que en un celular en landscape es ~19% de la pantalla).
    const bias = 0.72;
    const biasZ = bounds.bottomZ + (bounds.topZ - bounds.bottomZ) * bias;

    this.rig.fit(aspect, bounds, biasZ);

    this.layoutHand();
    this.layoutJokers();
  }

  dispose(): void {
    this.stop();
    for (const unsubscribe of this.unsubscribes) unsubscribe();
    this.unsubscribes.length = 0;
    this.interaction.dispose();

    for (const card3d of this.handCards.values()) card3d.dispose();
    for (const card3d of this.jokerCards.values()) card3d.dispose();
    for (const card3d of this.scoringCards) card3d.dispose();
    this.handCards.clear();
    this.jokerCards.clear();
    this.scoringCards.length = 0;

    this.textures.clear();
    for (const zone of this.dropZones) zone.dispose();
    this.dropZones.length = 0;
    this.postFx?.dispose();
    this.postFx = null;
    this.backTexture = null;
    this.particles.dispose();
    for (const item of this.disposables) item.dispose();
    disposeSharedGeometry();
    this.renderer.dispose();
  }

  /** Resumen para el panel de debug. */
  stats(): Record<string, number> {
    const info = this.renderer.info;
    return {
      hand: this.handCards.size,
      jokers: this.jokerCards.size,
      scoring: this.scoringCards.length,
      particles: this.particles.activeCount,
      tweens: this.tweens.activeCount,
      textures: this.textures.size,
      // Con composer, `info.render.calls` acumula TODOS los pases (los quads de
      // pantalla completa incluidos). El numero comparable entre tiers es el de
      // la escena, que lo toma el SnapshotPass.
      drawCalls: this.postFx ? this.postFx.drawCalls : info.render.calls,
      drawCallsTotal: info.render.calls,
      triangles: info.render.triangles,
      // Memoria de GPU: es lo que delata una fuga de materiales o de texturas
      // (cada carta crea 4-5 materiales propios, asi que esto tiene que subir y
      // bajar con la mano, no crecer sin techo).
      programs: info.programs?.length ?? 0,
      gpuGeometries: info.memory.geometries,
      gpuTextures: info.memory.textures,
      // p95 de la ventana del monitor. 0 en `low`, que no tiene monitor.
      frameP95: Math.round(this.frameMonitor?.p95 ?? 0),
      // Cuantas sombras de contacto se estan dibujando. Es UNA sola llamada de
      // dibujo para todas, pero el conteo tiene que seguir a las cartas vivas.
      shadows: this.shadowMesh?.visible ? this.shadowMesh.count : 0,
    };
  }
}
