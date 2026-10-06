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

import { ArtAssets, CARD_BACK_KEY, artKeysFor, artKeysForJoker, blindKeysFor, type ArtKey } from './ArtAssets';
import { isCoarsePointer, isTouchOnly } from '../pointer';
import {
  ARENA_GLOW_BASE,
  ARENA_GLOW_ENVIRONMENT,
  PLATFORM_HALF_X,
  PLATFORM_HALF_Z,
  WATER_Y,
  type Arena,
  buildArena,
} from './Arena';
import { CARD_HALO_WIDTH, CARD_HEIGHT, CARD_WIDTH, Card3D, disposeSharedGeometry } from './Card3D';
import { CardTextureCache, createCardBackCanvas, createShadowCanvas } from './CardTexture';
import { CameraRig } from './CameraRig';
import { DropZone, rectContains, type DropZoneHandle, type DropZoneId, type ZoneRect } from './DropZone';
import { Interaction } from './Interaction';
import { SporeField } from './Particles';
import { Mycelium } from './Mycelium';
import { PostFx } from './PostFx';
import { TRANSITION_SECONDS } from './Transition';
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
import { CardCarousel, type CarouselEntryView } from './CardCarousel';
import { Water, hitHorizontalPlane } from './Water';
import { Die3D, type DieImpulse } from './Die3D';
import * as anim from './anim';
import { ABILITY_COLOR, ELEMENT_COLOR, UI_COLORS } from './palette';

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
/**
 * Boost de escala de las cartas de la MANO en celular.
 *
 * A 412px de alto una carta a escala nominal deja el texto de la cara en ~2px,
 * asi que en tactil se agranda. Lo lee tambien `handSpreadClearOfPiles` para
 * calcular cuanto ocupa una carta al acotar el ancho del abanico.
 */
const HAND_BOOST = 1.2;
/**
 * Fila de jokers.
 *
 * El tope de atras lo pone la fila de cartas JUGADAS (`PLAY_Z` - 0.6 con escala
 * 0.86): su borde trasero cae en z ~ -1.98. Un joker de 0.66 mide 2.1 de alto,
 * asi que su centro no puede pasar de -3.0 sin meterse debajo de las jugadas.
 *
 * La ESCALA subio de 0.5 a 0.66: a 0.5 el joker quedaba tan chico y tan al fondo
 * que no se leia, y el jugador terminaba mirando la lista del HUD en vez de la
 * mesa.
 */
const JOKER_Y = 0.16;
const JOKER_Z = -3.3;
/**
 * Z de la fila de Simbiontes en CELULAR (ver `jokerZ`).
 *
 * La barra superior termina justo donde arranca la fila, asi que con el valor
 * de escritorio las ranuras quedaban DEBAJO del HUD. Corriendolas hacia el
 * centro de la mesa entran en la franja libre.
 */
const JOKER_Z_MOBILE = -2.5;
/**
 * P6 — Cuanto se hunde el marco de una ranura vacia respecto de la carta que la
 * ocupa. Evita el z-fighting cuando la ranura se llena: la carta manda.
 */
const JOKER_SLOT_DY = 0.02;
/**
 * Escala de los Simbiontes. Antes era 0.66 ("chicos y al fondo"): con las
 * ranuras fijas (P6) el Simbionte tiene que leerse al mismo tamaño y tipografia
 * que una carta de la mano, asi que sube a PLAY_SCALE (0.86). Una ranura vacia
 * se dibuja con la MISMA huella que una carta llena: el hueco y la carta son
 * indistinguibles en tamaño.
 */
const JOKER_SCALE = 0.86;
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
/**
 * X de las pilas en TACTIL. Mas adentro que en escritorio (ver `deckX`).
 *
 * Con una pantalla mas alta que ancha, el ancho de la mesa —que mandan las
 * pilas— es lo que fija la distancia de camara; el alto que sobra se convierte
 * en una franja negra abajo. Acercandolas, el encuadre pasa a fijarlo el ALTO y
 * la mesa llena la pantalla. Sigue siendo > que el semiancho del abanico para
 * que los montones no compartan pantalla con las cartas de los extremos.
 */
const TACTILE_PILE_X = 9.4;
/**
 * Alto minimo de viewport (px) para tratar un dispositivo tactil como TABLET.
 * Espeja el `@media (pointer: coarse) and (min-height: 600px)` del CSS: si uno
 * cambia, el otro tambien.
 */
const TABLET_MIN_H = 600;
const PLAY_Y = 0.18;
const PLAY_Z = -0.6;
const PLAY_SCALE = 0.86;
/**
 * Separacion entre cartas jugadas. Es MAS chica que el halo a proposito: las
 * cartas jugadas tienen que leerse como UNA mano, no como cinco cartas sueltas.
 * (En la fila de jokers es al reves, ahi si tienen que leerse separadas.)
 */
const PLAY_SPACING = 2.05;

// --- Carrusel de coleccion (F1) ---
/** Radio del anillo de cartas, en unidades de mundo. */
const CAROUSEL_RADIUS = 9;

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

// --- Tirada del dado ---
//
// El gesto se traduce a un impulso. Los numeros estan elegidos para que una
// tirada comoda (un dedo que se mueve ~200 px en ~250 ms) cruce media
// plataforma y de dos o tres vueltas: mas corto y el dado no llega a girar,
// mas largo y se va contra el borde invisible.
/** Tope de velocidad del gesto. Un latigazo del dedo no puede mandar el cubo al agua. */
const MAX_THROW_SPEED = 14;
/** Piso de velocidad: un toque sin gesto igual tira el dado. */
const MIN_THROW_SPEED = 3.2;
/** Cuanto del gesto se convierte en giro. Ver `impulseFrom`. */
const ROLL_SPIN_GAIN = 1.5;
/** Empuje vertical base: sin esto la tirada es un deslizamiento por el piso. */
const THROW_LIFT = 3.6;
/**
 * Hasta donde puede llegar el cubo mientras lo sostienen. Coincide con el tope
 * de la fisica (`Die3D`) para que el gesto no prometa un recorrido que despues
 * el dado no puede hacer.
 */
const DIE_DRAG_LIMIT_X = 8.6;
const DIE_DRAG_LIMIT_Z_BACK = -1.4;
const DIE_DRAG_LIMIT_Z_FRONT = 4;
/** Normal del plano de arrastre (el piso). Constante para no asignar por evento. */
const DIE_PLANE_NORMAL = new THREE.Vector3(0, 1, 0);

/** El maximo de una perilla de particulas entre todos los tiers. */
function maxParticles(key: 'ambientSpores' | 'transientSpores'): number {
  return Math.max(...Object.values(TIER_CONFIG).map((config) => config[key]));
}

/** Cuantos pasos de score se animan. El resto se agrupa para no eternizar la mano. */
/**
 * Cuantos pasos de score se animan como maximo.
 *
 * Bajado de 22 a 12 junto con el `stepStagger` mas lento: una mano con muchos
 * disparos se resolvia en una fraccion de segundo y no se veia nada. Con el tope
 * mas bajo, los pasos que SI se animan tienen tiempo de leerse, y el total
 * (que es lo que el jugador necesita) sigue cerrando exacto.
 */
const MAX_ANIMATED_STEPS = 12;


export interface SceneCallbacks {
  /** El jugador toco/cliqueo una carta de la mano. */
  onCardClick: (uid: string) => void;
  /** El puntero entro/salio de una carta (solo raton). */
  onHoverChange: (card: CardInstance | null) => void;
  /**
   * El dedo se mantuvo quieto sobre una carta. Es la via TACTIL del tooltip:
   * el hover necesita `pointermove`, que no llega si el dedo no se mueve.
   */
  onLongPressChange?: (card: CardInstance) => void;
  /** Texto flotante de puntos. El render sabe DONDE; la UI sabe COMO dibujarlo. */
  /**
   * Numero flotante. `combo` (0..1) escala su tamaño: el combo se SIENTE porque
   * los numeros crecen hacia el final.
   */
  onScorePopup?: (
    screenX: number,
    screenY: number,
    text: string,
    color: number,
    combo?: number,
  ) => void;
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
    /**
     * Escala del numero (0..1). Crece con el lugar que ocupa el paso dentro del
     * combo, asi que la ultima carta se dibuja mas grande que la primera.
     */
    combo: number;
  }) => void;
  /**
   * El jugador solto una carta sobre una zona. El render sabe QUE zona es; el
   * controlador decide que significa ("play" = seleccionar, "discard" =
   * descartar esa carta, "hand" = devolverla). El render no toca el motor.
   */
  onCardDrop?: (uid: string, zone: DropZoneId) => void;
  /**
   * El jugador TOCA la pila de descarte (sin arrastrar). Es la alternativa al
   * drag: el controlador decide que hacer (descartar la seleccion actual).
   */
  onDiscardPileTap?: () => void;
  /**
   * CAJA proyectada de cada pila (centro + tamano en pantalla). El HUD mete la
   * etiqueta "MAZO / N ROBABLES" DENTRO del dorso, ajustada a su tamano.
   */
  onPileAnchors?: (anchors: {
    deck: { x: number; y: number; w: number; h: number };
    discard: { x: number; y: number; w: number; h: number };
  }) => void;
  /**
   * El monitor de frames bajo el nivel de calidad por su cuenta. El render NO
   * muestra avisos (no es su trabajo): avisa y el controlador decide si
   * mostrarlo por toast y si lo persiste.
   */
  onQualityDowngraded?: (tier: QualityTier, from: QualityTier) => void;
  /**
   * El jugador LANZO el cubo del dado. El render sabe CON QUE fuerza salio
   * (mide la velocidad del dedo); el controlador es el unico que puede pedirle
   * la cara al motor y volver a llamar a `releaseDie()` para animarla.
   */
  onDieThrown?: (impulse: DieImpulse) => void;
  /**
   * El jugador toco la carta que YA estaba centrada en el carrusel.
   *
   * Tocar una carta descentrada solo la gira (`focus` -> `onFocusChange`), pero
   * tocar la que ya esta delante no cambiaba nada y el gesto se sentia muerto
   * ("los selecciono y no hacen nada"). Ese caso es el que PIDE ACCION: el HUD
   * lo usa para abrir el detalle de la carta, que es lo que el jugador espera.
   * El render no sabe que hay al otro lado: solo avisa el indice tocado.
   */
  onCarouselActivate?: (index: number) => void;
}

/** Instantanea de una carta de la mano, para el panel de debug (F3) y los tests. */
export interface HandCardState {
  uid: string;
  /** 0 = boca arriba, 1 = boca abajo. */
  flip: number;
  faceUp: boolean;
  /** `true` si el dorso tiene textura aplicada. */
  hasBack: boolean;
  /** Escala efectiva: la mano la baja cuando hay demasiadas cartas. */
  scale: number;
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
  /**
   * P6 — Ranuras FIJAS de Simbionte dibujadas en la mesa. Hay una por
   * `run.jokerSlots` y SIEMPRE se ven (vacias o no): el jugador ve cuantas
   * tiene y donde caera el proximo Simbionte. Se reconstruyen solo cuando
   * cambia el total de ranuras, no cada frame.
   */
  private readonly jokerSlotMeshes: THREE.Mesh[] = [];
  /** Total de ranuras construidas: sirve de cache para no reconstruir de mas. */
  private jokerSlotsBuilt = -1;
  /** Cartas que estan en la zona de puntuacion (ya salieron de la mano). */
  private readonly scoringCards: Card3D[] = [];

  /** Raices que unen las cartas jugadas durante el combo. Pool fijo. */
  private readonly mycelium: Mycelium;
  /**
   * Posicion de la carta que origino el paso ANTERIOR, para trazar el micelio de
   * una a la siguiente. Se reinicia con la mano.
   */
  private lastScoreOrigin: THREE.Vector3 | null = null;

  /** Zonas de destino del arrastre, en orden de prioridad. */
  private readonly dropZones: DropZone[] = [];
  /** Textura del dorso, compartida por las cartas, el mazo y el descarte. */
  private backTexture: THREE.CanvasTexture | null = null;
  /**
   * Materiales de las pilas (mazo/descarte) que usan `backTexture`. Al cambiar
   * el dorso hay que reasignarles el `map` (comparten una sola textura).
   */
  private readonly pileMaterials: THREE.MeshStandardMaterial[] = [];
  /** Carta que se esta arrastrando (uid), o null. */
  private dragUid: string | null = null;

  private readonly unsubscribes: Array<() => void> = [];
  private readonly fxQueue: Array<{ at: number; run: () => void }> = [];

  /** Indice de paso dentro de la mano actual (se reinicia en cada jugada). */
  private stepIndex = 0;
  /**
   * Separacion temporal entre pasos de score.
   *
   * Estaba en 0.055 s: con hasta 22 pasos, la mano entera se resolvia en 1,2 s y
   * era IMPOSIBLE leer que aportaba cada paso. Ahora cada paso dura lo que dura
   * su animacion (~0.18 s) y ademas se animan MENOS pasos (12), asi que el
   * total se mantiene parecido pero cada uno se aprecia.
   */
  private readonly stepStagger = 0.18;
  /** Timeline de la secuencia de puntuacion de la mano en curso. */
  private scoreTl: ReturnType<typeof anim.sequence> | null = null;

  /**
   * Tween del abanico de la mano en curso (`layoutHand`).
   *
   * Se guarda para MATARLO antes de arrancar uno nuevo. Sin esto, dos layouts
   * en el mismo tick (p. ej. el `state:changed` que dispara `syncHand` y el que
   * dispara el auto-orden) dejan tweens con stagger pisandose: unos targets
   * reciben el layout nuevo y otros se quedan con el viejo, y las cartas
   * terminan SUPERPUESTAS en el mismo x (bug reportado: "al ordenar se
   * superponen las ilustraciones"). Matar el anterior garantiza que solo el
   * ultimo layout escribe la posicion final.
   */
  private handLayoutTl: ReturnType<typeof anim.tweenOf> | null = null;

  private clock = 0;
  /**
   * Ultimo `dt` acotado del bucle. Lo leen los gestos que ocurren FUERA del
   * bucle (el arrastre del dado llega por eventos de puntero, que no traen
   * tiempo): sin esto habria que usar `performance.now()` y el suavizado de la
   * velocidad iria con otro reloj que el resto de la escena.
   */
  private lastFrameDt = 1 / 60;
  private frameId = 0;
  private running = false;
  private readonly isTouch: boolean;
  private readonly isMobile: boolean;
  /**
   * Puntero primario GRUESO. Se cachea porque no cambia en runtime: un equipo
   * no gana ni pierde tactil. El ALTO si cambia (rotar), por eso el perfil de
   * layout se evalua EN VIVO (ver `layoutProfile`).
   */
  private readonly isCoarse: boolean;
  private handSpread = 16.5;

  private deckMesh: THREE.Group | null = null;
  private discardMesh: THREE.Group | null = null;
  private readonly disposables: Array<THREE.Material | THREE.Texture | THREE.BufferGeometry> = [];
  /** Geometria/material compartidos por las cartas "fantasma" del reciclado. */
  private ghostGeo: THREE.PlaneGeometry | null = null;
  private ghostMat: THREE.MeshStandardMaterial | null = null;
  /** Zona de descarte, para la pista visual y el toque sin arrastre. */
  private discardZone: DropZone | null = null;

  /** 'menu' = escena idle de la pantalla de inicio; 'run' = partida. */
  private mode: 'menu' | 'run' = 'run';
  private readonly menuCards: Card3D[] = [];
  private menuBaseZ: number[] = [];
  private reduceMotion = false;

  // --- Carrusel de coleccion (F1) ---
  /** Anillo de cartas. Se crea perezosamente la primera vez que se abre. */
  private carousel: CardCarousel | null = null;
  /** Mientras esta activo, el juego se oculta y el anillo manda. */
  private carouselActive = false;
  private carouselDrag: { id: number; x: number; moved: number } | null = null;

  // --- Agua reactiva (F2). Solo en tiers con `environment`. ---
  private water: Water | null = null;
  private readonly waterRay = new THREE.Raycaster();
  private readonly waterNdc = new THREE.Vector2();
  private lastWaterRipple = -1;

  /** Dado multiplicador de la ronda (F-dado). Se crea al elegir el ciego. */
  private die3d: Die3D | null = null;
  /**
   * Arrastre del cubo. Null cuando no hay ningun dedo sobre el dado.
   * El arrastre NO pasa por `Interaction`: ese modulo resuelve gestos de CARTA
   * (zonas, tap-to-select, hover) y el dado no es una carta.
   */
  private dieDrag: { id: number; planeY: number } | null = null;
  private readonly dieRay = new THREE.Raycaster();
  private readonly dieNdc = new THREE.Vector2();
  private readonly diePlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private readonly dieHit = new THREE.Vector3();
  private dieInputAttached = false;
  /**
   * Base de la camara al momento de abrir el carrusel. Se restaura al cerrarlo:
   * el carrusel reescribe `rig.setBase(...)` con su encuadre frontal y, si no se
   * devuelve, la partida queda apuntando hacia donde apuntaba el anillo.
   */
  private savedRigBase: { position: THREE.Vector3; target: THREE.Vector3 } | null = null;

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
  /**
   * Suscriptor del avance del barrido. La UI lo usa para sincronizar el HUD por
   * CSS (baja y se desvanece al arrancar, vuelve con rebote al terminar) sin
   * tener que animar el DOM a mano. Recibe -1 cuando el barrido termina.
   */
  private transitionListener: ((progress: number) => void) | null = null;
  private transitionWasRunning = false;
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

    this.isTouch = isTouchOnly();
    this.isMobile = this.isTouch || /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
    this.isCoarse = isCoarsePointer();

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

    // Micelio del combo: pool fijo de raices, se crea una vez y se reutiliza.
    this.mycelium = new Mycelium();

    this.interaction = new Interaction(options.canvas, {
      onHover: (card) => this.handleHover(card),
      onLongPress: (card) => this.handleLongPress(card),
      onClick: (card) => this.handleClick(card),
      onDragStart: (card) => this.handleDragStart(card),
      onDrag: (card, point, zone) => this.handleDrag(card, point, zone),
      onDrop: (card, zone) => this.handleDrop(card, zone),
      onDragCancel: (card) => this.handleDragCancel(card),
      onTapEmpty: (point) => this.handleEmptyTap(point),
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

    // Agua reactiva: se crea PEREZOSAMENTE la primera vez que el tier la
    // habilita (igual que el IBL) y despues solo se prende/apaga. En `low` no
    // existe: ese tier no tiene margen de presupuesto.
    if (on && !this.water) {
      this.water = new Water(this.tier === 'high' ? 'high' : 'medium');
      // La superficie va por debajo de la cara superior de la plataforma, asi se
      // ve el costado del bloque emergiendo (el "cubo" de la referencia).
      this.water.mesh.position.set(0, WATER_Y, 0);
      this.water.setDryHalf(PLATFORM_HALF_X + 0.2, PLATFORM_HALF_Z + 0.2);
      this.scene.add(this.water.mesh);
      this.attachWaterInput();
    }
    this.water?.setEnabled(on);

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

    // --- Arena: losa runica + vegetacion ---
    //
    // La cara superior es la losa de `art_arena` (con normal map y mapa de
    // emision sacados de la propia imagen) y los hongos se apiñan en la banda de
    // atras, que es la que la camara ve. Ver `Arena.ts`: la arena entera sale en
    // TRES draw calls.
    //
    // La losa se aplica DESPUES de construir: `buildArena` no conoce
    // `ArtAssets` a proposito, y el arte ya esta cargado cuando esto corre (el
    // arranque espera a `loadAll`). Si faltara, la plataforma queda en piedra
    // lisa y el juego sigue.
    this.arena = buildArena();
    this.arena.applyFloorArt(this.assets.get('art_arena'));
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

    // --- Micelio del combo ---
    this.scene.add(this.mycelium.group);

    // --- Dorso (una sola textura para todo el juego) ---
    // La comparten el mazo, el descarte y el dorso de cada carta: dibujarla una
    // vez por carta seria subir decenas de canvas identicos a la GPU.
    this.backTexture = new THREE.CanvasTexture(
      createCardBackCanvas(this.assets.get(CARD_BACK_KEY)),
    );
    this.backTexture.colorSpace = THREE.SRGBColorSpace;
    this.disposables.push(this.backTexture);

    // --- Mazo y descarte ---
    this.deckMesh = this.buildPile(this.deckX, DECK_Z, 7);
    this.discardMesh = this.buildPile(this.discardX, DISCARD_Z, 4);
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
    // La posicion de la pila vive en el GRUPO, no en cada capa: asi se puede
    // mover la pila entera cuando cambia el perfil de layout (rotar una tablet)
    // sin tocar las capas. Las capas solo llevan el jitter.
    group.position.set(x, 0, z);

    const geometry = new THREE.PlaneGeometry(CARD_WIDTH * 0.92, CARD_HEIGHT * 0.92);
    const material = new THREE.MeshStandardMaterial({
      map: this.backTexture,
      roughness: 0.7,
      metalness: 0.2,
      emissive: new THREE.Color(0x1a3a4a),
      emissiveIntensity: 0.5,
    });
    // Se rastrea para poder reasignarle el `map` cuando cambia el dorso.
    this.pileMaterials.push(material);
    this.disposables.push(geometry, material);

    for (let i = 0; i < layers; i++) {
      const layer = new THREE.Mesh(geometry, material);
      layer.rotation.x = -Math.PI / 2;
      layer.rotation.z = (Math.random() - 0.5) * 0.05;
      layer.position.set(
        (Math.random() - 0.5) * 0.06,
        0.05 + i * 0.012,
        (Math.random() - 0.5) * 0.06,
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
  /**
   * Rectangulo de la zona de descarte, CENTRADO EN LA PILA.
   *
   * `ZONE_DISCARD` (la constante) usa las coords de escritorio (±10.5); en tactil
   * la pila vive en ±8.5, asi que una zona fija quedaba ~2 unidades a la
   * izquierda de donde el jugador ve la pila (medido: ~59 px en 915×412). Con la
   * pista visual encendida eso se nota; el toque directo tambien fallaba.
   */
  private discardZoneRect(): ZoneRect {
    const x = this.discardX;
    return { minX: x - 1.1, maxX: x + 1.1, minZ: ZONE_DISCARD.minZ, maxZ: ZONE_DISCARD.maxZ };
  }

  /** Recentra las zonas cuyo rect depende del perfil (hoy, el descarte). */
  private syncDropZones(): void {
    this.discardZone?.setRect(this.discardZoneRect());
  }

  private buildDropZones(): void {
    const inPlay = (card: Card3D): boolean =>
      card.kind === 'card' && this.engine.run.status === 'playing';

    const discard = new DropZone({
      id: 'discard',
      rect: this.discardZoneRect(),
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
    this.discardZone = discard;
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
      // Espejo del CSS: los DOS motores de animacion se ACORTAN (no se anulan),
      // asi el estado final siempre se alcanza y los onComplete disparan.
      anim.setReduceMotion(reduceMotion);
      this.tweens.setReduceMotion(reduceMotion);
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

  // ==========================================================================
  // Carrusel de coleccion (F1)
  // ==========================================================================

  /**
   * Entra o sale del modo carrusel. Con entradas, oculta el juego y muestra el
   * anillo; con `null`, restaura lo que corresponda al modo actual.
   */
  setCarousel(
    entries: readonly CarouselEntryView[] | null,
    onFocus?: (index: number) => void,
    opts?: { radius?: number; halfSpan?: number; arcStep?: number; wrap?: boolean; lift?: number },
  ): void {
    if (!entries) {
      if (!this.carouselActive) return;
      this.carouselActive = false;
      // El carrusel tomo `rig.setBase(...)` para su encuadre propio. `rig.fit`
      // conserva la direccion de vista al reencuadrar, asi que si no se
      // devuelve la base, la camara queda mirando hacia donde apuntaba el anillo
      // (mas bajo y mas cerca) y la partida se ve mal al volver.
      if (this.savedRigBase) {
        this.rig.restoreBase(this.savedRigBase);
        this.savedRigBase = null;
      }
      this.carousel?.setVisible(false);
      this.detachCarouselInput();
      this.applyRunVisibility();
      this.refreshTargets();
      this.resize();
      return;
    }

    if (!this.carousel) {
      this.carousel = new CardCarousel({
        createCard: () => this.createCard3D(null),
        applyEntry: (card, entry) => this.applyCarouselEntry(card, entry),
        radius: CAROUSEL_RADIUS,
        halfSpan: 5,
      });
      this.carousel.attachTo(this.scene);
    }
    if (onFocus) this.carousel.setOnFocus(onFocus);
    // El MISMO carrusel sirve para las tres pantallas: anillo (coleccion y
    // mazo) o arco suave sin wrap (la fila de recompensas).
    if (opts) this.carousel.configure(opts);

    // Guarda la base de la camara ANTES de que el carrusel la cambie, para
    // poder restaurarla al cerrar.
    if (!this.savedRigBase) this.savedRigBase = this.rig.snapshotBase();

    this.carouselActive = true;
    this.carousel.setEntries(entries);
    this.carousel.setVisible(true);
    this.applyRunVisibility();
    this.refreshTargets();
    this.attachCarouselInput();
    this.fitCarousel();
  }

  /**
   * Gira el carrusel a una entrada concreta (sin tap). Lo usa el mazo para
   * arrancar parado en la carta resaltada (p. ej. la recien mejorada): al
   * resetear `setEntries` el giro vuelve a 0, y sin esto el anillo mostraba la
   * primera carta mientras el detalle mostraba otra.
   */
  focusCarousel(index: number): void {
    // `focusAbs` y no `focus`: al abrir el panel el anillo tiene que quedar
    // parado SIEMPRE en esa carta. `focus` calcula el camino mas corto desde el
    // objetivo previo, asi que el resultado dependia de como quedo el carrusel
    // la ultima vez ("en algunas cartas se actualiza el carrusel").
    this.carousel?.focusAbs(index);
  }

  /** Aplica una entrada del carrusel a un slot: cara (o dorso) y snap. */
  private applyCarouselEntry(card3d: Card3D, entry: CarouselEntryView): void {    card3d.home.flip = 0;
    if (!entry.discovered) {
      // Sin descubrir: se muestra el dorso. No se toca la cara.
      if (this.backTexture) card3d.setBackTexture(this.backTexture);
      card3d.setFaceUp(false, { animated: false });
      card3d.snapToHome();
      return;
    }
    if (entry.jokerId) {
      const joker = this.engine.registry.instantiateJoker(entry.jokerId);
      card3d.setJoker(joker, this.textures, this.lang(), this.artForJoker(joker));
    } else if (entry.cardId) {
      const def = this.engine.registry.tryGetCard(entry.cardId);
      if (def) {
        const inst = this.engine.registry.instantiateFrom(def);
        // El mazo muestra cartas MEJORADAS: sin esto el carrusel las dibujaria
        // todas a nivel 1, y al subir de nivel el detalle del panel cambiaba
        // pero la carta del anillo se quedaba con los numeros viejos.
        if (entry.level !== undefined) inst.level = entry.level;
        if (entry.bonusSubstrate !== undefined) inst.bonusSubstrate = entry.bonusSubstrate;
        if (entry.bonusSpores !== undefined) inst.bonusSpores = entry.bonusSpores;
        card3d.setCard(inst, this.textures, this.lang(), this.artForCard(inst));
      }
    }
    card3d.setFaceUp(true, { animated: false });
    card3d.snapToHome();
  }

  /** Muestra u oculta los objetos de la partida segun el modo carrusel. */
  private applyRunVisibility(): void {
    const showRun = !this.carouselActive;
    const inMenu = this.mode === 'menu';
    for (const card3d of this.handCards.values()) card3d.group.visible = showRun;
    for (const card3d of this.jokerCards.values()) card3d.group.visible = showRun;
    // P6 — Las ranuras vacias tambien se ocultan en el carrusel/menu: son parte
    // del cromo de la partida, no de la coleccion.
    for (const slot of this.jokerSlotMeshes) slot.visible = showRun && !inMenu;
    for (const card3d of this.scoringCards) card3d.group.visible = showRun;
    for (const card3d of this.menuCards) card3d.group.visible = showRun;
    if (this.deckMesh) this.deckMesh.visible = showRun && !inMenu;
    if (this.discardMesh) this.discardMesh.visible = showRun && !inMenu;
    if (!showRun) for (const zone of this.dropZones) zone.setEnabled(false);
  }

  /**
   * Encuadre del carrusel: vista FRONTAL al anillo.
   *
   * No usa `rig.fit()`: ese ajuste fija el objetivo en y=0, asi que las cartas
   * PARADAS (centro en y≈1.9) quedarian fuera de cuadro. Aca se fija la camara
   * a mano y se restaura sola al salir (el `resize()` normal vuelve a correr).
   */
  private fitCarousel(aspect?: number): void {
    this.rig.setBase(new THREE.Vector3(0, 3.6, 11.5), new THREE.Vector3(0, 1.85, -2.0));
    const canvas = this.renderer.domElement;
    const a = aspect ?? (canvas.clientWidth || 1) / Math.max(1, canvas.clientHeight || 1);
    this.rig.resize(a);
  }

  private readonly onCarouselWheel = (event: WheelEvent): void => {
    if (!this.carouselActive) return;
    event.preventDefault();
    // Rueda vertical u horizontal: las dos scrollean el anillo.
    this.carousel?.scrollBy((event.deltaY + event.deltaX) * 0.0016);
  };

  private readonly onCarouselDown = (event: PointerEvent): void => {
    if (!this.carouselActive) return;
    this.carouselDrag = { id: event.pointerId, x: event.clientX, moved: 0 };
  };

  private readonly onCarouselMove = (event: PointerEvent): void => {
    const drag = this.carouselDrag;
    if (!this.carouselActive || !drag || drag.id !== event.pointerId) return;
    const dx = event.clientX - drag.x;
    drag.x = event.clientX;
    drag.moved += Math.abs(dx);
    // Arrastrar a la derecha trae la carta de la izquierda (giro inverso).
    this.carousel?.scrollBy(-dx * 0.006);
  };

  private readonly onCarouselUp = (event: PointerEvent): void => {
    const drag = this.carouselDrag;
    if (!drag || drag.id !== event.pointerId) return;
    this.carouselDrag = null;
    // Un gesto corto es un TAP: enfoca la carta golpeada.
    if (drag.moved < 8) this.tapCarousel(event.clientX, event.clientY);
  };

  private tapCarousel(clientX: number, clientY: number): void {
    const carousel = this.carousel;
    if (!carousel) return;
    const rect = this.renderer.domElement.getBoundingClientRect();
    // En PANTALLA (px del canvas), no en NDC: el carrusel proyecta los centros
    // de sus cartas y elige el mas cercano al toque.
    const index = carousel.pickNearest(
      clientX - rect.left,
      clientY - rect.top,
      (v) => this.projectToScreen(v),
    );
    if (index === null) return;

    // Tocar la carta que YA esta centrada no gira nada: `target` no cambia,
    // `onFocusChange` no dispara y el gesto se sentia muerto ("los selecciono y
    // no hacen nada"). Ese caso es el que ABRE el detalle, que es lo que el
    // jugador espera al tocar la carta que tiene delante.
    const alreadyCentered = index === carousel.focusedIndex;
    carousel.focus(index);
    // El pulso va SIEMPRE: es la respuesta visible al toque, centrada o no.
    carousel.pulseFocused();
    if (alreadyCentered) this.callbacks.onCarouselActivate?.(index);
  }

  private attachCarouselInput(): void {
    const el = this.renderer.domElement;
    el.addEventListener('wheel', this.onCarouselWheel, { passive: false });
    el.addEventListener('pointerdown', this.onCarouselDown);
    el.addEventListener('pointermove', this.onCarouselMove);
    el.addEventListener('pointerup', this.onCarouselUp);
    el.addEventListener('pointercancel', this.onCarouselUp);
  }

  private detachCarouselInput(): void {
    const el = this.renderer.domElement;
    el.removeEventListener('wheel', this.onCarouselWheel);
    el.removeEventListener('pointerdown', this.onCarouselDown);
    el.removeEventListener('pointermove', this.onCarouselMove);
    el.removeEventListener('pointerup', this.onCarouselUp);
    el.removeEventListener('pointercancel', this.onCarouselUp);
    this.carouselDrag = null;
  }

  // ==========================================================================
  // Agua reactiva (F2)
  // ==========================================================================

  private readonly onWaterPointerMove = (event: PointerEvent): void => {
    const water = this.water;
    if (!water?.enabled || this.carouselActive) return;
    // Un ripple cada ~60 ms: mas seguido no se distingue y gasta slots.
    if (this.clock - this.lastWaterRipple < 0.06) return;
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.waterNdc.set(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.waterRay.setFromCamera(this.waterNdc, this.rig.camera);
    const hit = hitHorizontalPlane(
      this.waterRay.ray.origin,
      this.waterRay.ray.direction,
      water.mesh.position.y,
    );
    if (!hit) return;
    this.lastWaterRipple = this.clock;
    water.ripple(hit.x, hit.z, 0.45);
  };

  /**
   * Prepara la TIRADA manual del dado: el cubo aparece adelante y al centro,
   * agrandado y girando despacio, esperando que lo arrastren y lo suelten.
   *
   * Se llama al entrar a la seleccion de ciego. Antes el dado se tiraba solo y
   * caia en el rincon: el jugador lo veia, si, pero no hacia nada.
   */
  armDieThrow(faces: ReadonlyArray<{ value: number; multiplier: number }>): void {
    this.ensureDie(faces);
    this.die3d?.arm();
    this.attachDieInput();
  }

  /**
   * Anima la tirada con la cara que el motor ya sorteo. `onSettled` se dispara
   * cuando el cubo se apoya, no antes: hasta entonces el resultado es un
   * secreto.
   */
  releaseDie(face: number, impulse: DieImpulse, onSettled?: () => void): void {
    this.die3d?.release(face, impulse, onSettled);
  }

  /**
   * Vuelve a tirar el dado sin arrastre (boton "Tirar de nuevo"): la fisica es
   * la misma, el impulso lo inventa el propio dado.
   */
  tossDie(face: number, onSettled?: () => void): void {
    const die = this.die3d;
    if (!die) return;
    die.release(face, die.autoImpulse(), onSettled);
  }

  /**
   * Aparca el dado en su rincon, mostrando la cara sorteada. `faces` hace falta
   * solo para el caso en que el dado no exista todavia (partida retomada).
   */
  parkDie(face: number, faces: ReadonlyArray<{ value: number; multiplier: number }>): void {
    this.detachDieInput();
    this.ensureDie(faces);
    this.die3d?.park(face);
  }

  /**
   * Muestra el dado ya aparcado, de una. Para un estado que se resuelve sin
   * animacion (recarga a mitad de blind, panel reabierto).
   */
  showDie(face: number, faces: ReadonlyArray<{ value: number; multiplier: number }>): void {
    this.ensureDie(faces);
    this.die3d?.snapToParked(face);
  }

  private ensureDie(faces: ReadonlyArray<{ value: number; multiplier: number }>): void {
    if (this.die3d) return;
    this.die3d = new Die3D();
    this.die3d.setFaces(faces);
    this.scene.add(this.die3d.group);
  }

  /** Estado del dado, para el panel de debug y los tests. */
  dieState(): { armed: boolean; busy: boolean; visible: boolean } | null {
    const die = this.die3d;
    if (!die) return null;
    return { armed: die.armed, busy: die.busy, visible: die.group.visible };
  }

  /**
   * La arena esta tapada por un panel: el dado se esconde sin perder su estado.
   * Es lo que evita que el cubo (que durante la tirada esta al doble de tamano)
   * quede flotando delante del carrusel del mazo o de la coleccion.
   */
  setDieVisible(visible: boolean): void {
    this.die3d?.setShown(visible);
  }

  private attachWaterInput(): void {
    this.renderer.domElement.addEventListener('pointermove', this.onWaterPointerMove);
  }

  // ==========================================================================
  // Tirada del dado (arrastre + suelta)
  // ==========================================================================

  private attachDieInput(): void {
    if (this.dieInputAttached) return;
    this.dieInputAttached = true;
    const el = this.renderer.domElement;
    el.addEventListener('pointerdown', this.onDieDown);
    el.addEventListener('pointermove', this.onDieMove);
    el.addEventListener('pointerup', this.onDieUp);
    el.addEventListener('pointercancel', this.onDieCancel);
  }

  private detachDieInput(): void {
    if (!this.dieInputAttached) return;
    this.dieInputAttached = false;
    const el = this.renderer.domElement;
    el.removeEventListener('pointerdown', this.onDieDown);
    el.removeEventListener('pointermove', this.onDieMove);
    el.removeEventListener('pointerup', this.onDieUp);
    el.removeEventListener('pointercancel', this.onDieCancel);
    this.dieDrag = null;
  }

  /** NDC del puntero dentro del canvas. */
  private diePointer(event: PointerEvent): void {
    const rect = this.renderer.domElement.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    this.dieNdc.set(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
  }

  /** Punto del plano de arrastre bajo el puntero. Null si el rayo no lo corta. */
  private diePointOnPlane(planeY: number): THREE.Vector3 | null {
    this.dieRay.setFromCamera(this.dieNdc, this.rig.camera);
    this.diePlane.set(DIE_PLANE_NORMAL, -planeY);
    if (!this.dieRay.ray.intersectPlane(this.diePlane, this.dieHit)) return null;
    return this.dieHit.clone();
  }

  private readonly onDieDown = (event: PointerEvent): void => {
    const die = this.die3d;
    if (!die?.armed || this.dieDrag) return;

    this.diePointer(event);
    this.dieRay.setFromCamera(this.dieNdc, this.rig.camera);
    // Contra los hijos del grupo (nucleo + 6 placas): el cubo es el grupo entero.
    if (this.dieRay.intersectObjects(die.group.children, false).length === 0) return;

    this.dieDrag = { id: event.pointerId, planeY: die.group.position.y };
    die.beginDrag();
    // Captura del puntero: el arrastre sigue aunque el dedo se salga del cubo.
    try {
      this.renderer.domElement.setPointerCapture(event.pointerId);
    } catch {
      /* algunos navegadores la rechazan si el puntero ya no esta activo */
    }
  };

  private readonly onDieMove = (event: PointerEvent): void => {
    const drag = this.dieDrag;
    const die = this.die3d;
    if (!drag || !die || drag.id !== event.pointerId) return;

    this.diePointer(event);
    const point = this.diePointOnPlane(drag.planeY);
    if (!point) return;
    // El cubo no puede salirse de la plataforma ni mientras lo sostienen.
    die.dragTo(
      THREE.MathUtils.clamp(point.x, -DIE_DRAG_LIMIT_X, DIE_DRAG_LIMIT_X),
      THREE.MathUtils.clamp(point.z, DIE_DRAG_LIMIT_Z_BACK, DIE_DRAG_LIMIT_Z_FRONT),
      this.lastFrameDt,
    );
  };

  private readonly onDieUp = (event: PointerEvent): void => {
    const drag = this.dieDrag;
    const die = this.die3d;
    if (!drag || !die || drag.id !== event.pointerId) return;
    this.releasePointer(event.pointerId);

    // El impulso sale de la VELOCIDAD del dedo, no de donde solto: es lo que
    // convierte el gesto en una tirada y no en un "poner el dado aca".
    const velocity = die.dragVelocity;
    const impulse = this.impulseFrom(velocity);
    this.dieDrag = null;

    this.callbacks.onDieThrown?.(impulse);
  };

  private readonly onDieCancel = (): void => {
    this.dieDrag = null;
  };

  private releasePointer(id: number): void {
    try {
      this.renderer.domElement.releasePointerCapture(id);
    } catch {
      /* ya liberada */
    }
  }

  /**
   * Convierte la velocidad del gesto en el impulso de la tirada.
   *
   * El giro NO es decorativo: sale de la velocidad angular de un cuerpo que rueda
   * (`omega = v / r`) sobre el eje perpendicular al movimiento. Asi un tiron
   * fuerte hace girar rapido y uno suave apenas una vuelta, sin tabla de valores
   * arbitrarios. Encima va un empujon extra porque un cubo real tumba mas de lo
   * que "rueda".
   */
  private impulseFrom(velocity: THREE.Vector3): DieImpulse {
    const vx = THREE.MathUtils.clamp(velocity.x, -MAX_THROW_SPEED, MAX_THROW_SPEED);
    const vz = THREE.MathUtils.clamp(velocity.z, -MAX_THROW_SPEED, MAX_THROW_SPEED);
    const speed = Math.hypot(vx, vz);

    // Un toque sin gesto igual tira el dado: si no, soltar el cubo quieto lo
    // dejaba caer como una piedra y no pasaba nada.
    const rollSpeed = Math.max(speed, MIN_THROW_SPEED);
    const dirX = speed > 0.01 ? vx / speed : 1;
    const dirZ = speed > 0.01 ? vz / speed : 0;

    // Eje de rodadura: perpendicular a la direccion, en el plano del piso.
    const roll = rollSpeed * ROLL_SPIN_GAIN;
    const extra = 5 + rollSpeed * 0.5;

    return {
      vx: dirX * rollSpeed,
      vy: THROW_LIFT + rollSpeed * 0.28,
      vz: dirZ * rollSpeed * 0.75,
      // Rodadura (perpendicular) + un extra sobre un eje inclinado, que es lo
      // que hace que el cubo tambien "cabecee" y no gire como un rodillo.
      spinX: dirZ * roll + extra * 0.35,
      spinY: extra * 0.55,
      spinZ: -dirX * roll + extra * 0.35,
    };
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

  /**
   * Cancela TODO lo que mueva a una carta: el motor propio Y las secuencias de
   * GSAP. Sin esto, una timeline vieja pelea con el dedo durante el arrastre o
   * escribe sobre una carta que ya salio de la mano.
   */
  private stopCard(card3d: Card3D): void {
    this.tweens.cancelFor(card3d.home);
    anim.killOf(card3d.home);
  }

  private clearMenuDecor(): void {
    for (const card3d of this.menuCards) {
      this.stopCard(card3d);
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
        // LA MANO SOLO EXISTE JUGANDO.
        //
        // El motor no destruye la ronda al ganar el ciego (la necesita para
        // mostrar `score / target`), asi que entre el ciego y el siguiente
        // `state:changed` sigue trayendo la mano VIEJA. Dibujarla dejaba cartas
        // tiradas en la arena durante la seleccion de ciego... justo donde
        // ahora se tira el dado.
        const playing = this.engine.run.status === 'playing';
        if (playing && round) this.syncHand(round.hand, this.engine.round?.selected ?? []);
        else this.syncHand([], []);
        this.syncJokers(this.engine.run.jokers, this.engine.run.jokerSlots);
        this.refreshDiscardHint();
        // Anclajes de las pilas para las etiquetas del HUD. Se emiten tambien
        // aca (no solo en `resize`) porque el primer `resize` corre ANTES de que
        // el HUD exista y sus etiquetas quedarian sin posicion.
        this.callbacks.onPileAnchors?.(this.pileAnchors());
      }),

      bus.on('card:played', ({ card, index }) => {
        // Primer carta de la mano: se reinicia la secuencia de puntuacion.
        if (index === 0) {
          this.stepIndex = 0;
          // El micelio se encadena desde la primera carta de la mano: sin este
          // reset la raiz arrancaria desde la mano ANTERIOR.
          this.lastScoreOrigin = null;
          // Red de seguridad: si la timeline anterior se corto y quedaron cartas
          // en el centro, se las manda al descarte antes de la mano nueva.
          this.flyScoredToDiscard(0);
        }
        // RECLAMO SINCRONO (ver `claimScoredCard`): la carta sale de la mano y
        // entra a la zona de puntuacion YA, para que el `state:changed` que el
        // motor emite al final de `playHand` no la destruya.
        this.claimScoredCard(card.uid);
        this.queueFx(index * 0.085, () => this.moveToPlayZone(card.uid));
      }),

      bus.on('card:discarded', ({ card, index }) => {
        this.queueFx(index * 0.06, () => this.flyToDiscard(card.uid));
      }),

      bus.on('card:drawn', ({ card }) => {
        this.queueFx(0.05, () => this.flyInFromDeck(card));
      }),

      // El descarte se reciclo a la pila de robo: las cartas vuelven al mazo.
      // Es la respuesta VISUAL al aviso del HUD (el motor lo hace en silencio).
      bus.on('deck:reshuffle', () => {
        this.queueFx(0.05, () => this.reshuffleToDeck());
      }),

      bus.on('score:step', ({ step }) => this.onScoreStep(step)),

      // El RENDER termina de animar el puntaje: recien AHI las cartas jugadas
      // vuelven al descarte. Antes se hundian a los 0.9 s, en mitad del conteo,
      // y parecia que desaparecian.
      bus.on('score:settled', () => this.flyScoredToDiscard(0.3)),

      bus.on('trigger:chain', ({ fromId, toId, depth }) => {
        this.queueFx(0.02, () => this.drawChain(fromId, toId, depth));
      }),

      bus.on('trigger:fired', ({ sourceId, depth }) => {
        // Un joker que dispara merece que se note.
        const joker = this.jokerCards.get(sourceId);
        if (joker) this.queueFx(0.02, () => this.pulseJoker(joker, depth));
      }),

      bus.on('round:win', () => this.celebrate()),
      bus.on('round:loss', () => {
        this.doom();
        // Si la timeline del puntaje se corta en la mano que da la derrota,
        // `score:settled` no llega nunca: se manda igual lo que quedo en el
        // centro, para que las cartas no queden colgadas en la mesa.
        this.flyScoredToDiscard(0.6);
      }),

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
    anim
      .sequence()
      .to(flash, {
        value: 1,
        duration: anim.d(0.18),
        ease: anim.EASE.quadOut,
        onUpdate: () => card3d.setFlash(flash.value),
      })
      .to(flash, {
        value: 0,
        duration: anim.d(0.5),
        ease: anim.EASE.cubicOut,
        onUpdate: () => card3d.setFlash(flash.value),
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
    this.stopCard(card3d);
    // Una TIMELINE resuelve el problema del `from`: el segundo tramo lee
    // `home.flip` cuando ARRANCA a renderizar (vale 1), no cuando se crea. Con
    // el encadenado a mano habia que recurrir a un `onComplete` para eso.
    anim
      .sequence()
      .to(card3d.home, { flip: 1, duration: anim.d(0.2), ease: anim.EASE.quadIn })
      .add(() => {
        // La textura se regenera con la carta BOCA ABAJO: la cache indexa por
        // id + nivel, asi que la definicion nueva produce una textura nueva.
        card3d.setCard(card, this.textures, this.lang(), this.artForCard(card));
      })
      .to(card3d.home, { flip: 0, duration: anim.d(0.32), ease: anim.EASE.quadOut })
      // Rebote de "renacio".
      .to(
        card3d.home,
        {
          keyframes: [
            { sx: 1.16, sy: 0.88, duration: anim.d(0.08), ease: anim.EASE.quadOut },
            { sx: 1, sy: 1, duration: anim.d(0.26), ease: anim.EASE.backOut },
          ],
        },
        '-=0.08',
      );
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
        this.stopCard(card3d);
        card3d.dispose();
        this.scene.remove(card3d.group);
      }
    }

    // --- Dentro: cartas nuevas ---
    // ¿Es el REPARTO de apertura? Pasa al empezar una partida y al empezar cada
    // ronda: la mano esta vacia y llegan cartas. Es el momento de repartir boca
    // abajo y dar vuelta en cascada para "dar comienzo".
    const openingDeal = this.handCards.size === 0 && cards.length > 0 && !this.reduceMotion;
    const newHomes: Array<Card3D['home']> = [];
    for (const card of cards) {
      let card3d = this.handCards.get(card.uid);
      if (!card3d) {
        card3d = this.createCard3D(card);
        this.handCards.set(card.uid, card3d);
        // Aparece desde el mazo.
        card3d.home.x = this.deckX;
        card3d.home.y = 0.05;
        card3d.home.z = DECK_Z;
        newHomes.push(card3d.home);
        // Llega BOCA ABAJO: el destape es lo que cierra el reparto.
        if (openingDeal) card3d.setFaceUp(false, { animated: false });
      } else {
        card3d.setCard(card, this.textures, this.lang(), this.artForCard(card));
      }
      // El ORDEN de `selectedUids` es el de la seleccion del jugador: la
      // primera carta elegida lleva el badge 1, la segunda el 2...
      const selIndex = selectedUids.indexOf(card.uid);
      card3d.setSelected(selIndex >= 0);
      card3d.setSelectIndex(selIndex >= 0 ? selIndex + 1 : null);
    }

    // REPARTO DE MANO NUEVA: llegaron cartas cuando la mano YA tenia cartas.
    // Eso solo pasa al robar tras jugar/descartar (fillHand). Es mas corto y
    // sin volteo boca-abajo: el jugador ya vio su mano, solo necesita notar
    // QUE robo. Si la mano estaba vacia es el reparto de apertura (arriba) y
    // tiene su propia animacion.
    const drawDeal = !openingDeal && newHomes.length > 0 && !this.reduceMotion;

    // P1.2 — Resaltar cartas compatibles con la selección actual.
    // Una carta es "compatible" si comparte elemento O familia con alguna
    // carta ya seleccionada. Esto guía al jugador hacia combos sin forzarlo.
    const selectedCards = cards.filter((c) => selectedUids.includes(c.uid));
    const selElements = new Set(selectedCards.map((c) => c.def.element));
    const selFamilies = new Set(selectedCards.map((c) => c.def.family));
    for (const card of cards) {
      if (selectedUids.includes(card.uid)) continue;
      const card3d = this.handCards.get(card.uid);
      if (!card3d) continue;
      const isCompat = selElements.has(card.def.element) || selFamilies.has(card.def.family);
      card3d.setCompatible(isCompat);
    }
    // Si no hay selección, apagar todos los compatibles.
    if (selectedCards.length === 0) {
      for (const card3d of this.handCards.values()) card3d.setCompatible(false);
    }

    // REORDENAR EL MAP SEGUN EL MOTOR.
    //
    // `layoutHand()` recorre `handCards` para decidir la posicion de cada carta,
    // y un `Map` de JS preserva el orden de INSERCION, no el orden en que se lo
    // consulta. Como al ordenar la mano los uid ya existen, el bucle de arriba
    // no los vuelve a insertar: el Map se quedaba con el orden viejo y el
    // abanico no se movia. El motor cambiaba `round.hand` y la mesa no lo
    // reflejaba — el bug de "Ordenar no hace nada".
    this.reorderHandCards(cards);

    // Si la carta que se estaba arrastrando salio de la mano (el motor la
    // descarto, la jugo o se transformo), el gesto queda colgado: se aborta.
    if (this.dragUid !== null && !this.handCards.has(this.dragUid)) {
      this.dragUid = null;
      this.interaction.cancelDrag();
    }

    if (this.carouselActive) this.applyRunVisibility();
    this.layoutHand();
    // Arco de reparto SOLO para las cartas nuevas: suben y bajan mientras el
    // layout las lleva a su lugar. Usa la propiedad `arc`, asi que no compite
    // con el layout (que mueve x/y/z).
    //
    // APERTURA: arco amplio y volteo boca-arriba en cascada; es el "comienza"
    // de la ronda y merece la animacion completa. MANO NUEVA (drawDeal): arco
    // mas bajo y un asentamiento, para que se sienta el robo sin repetir todo
    // el ceremonial de la apertura. `reduceMotion` ya dejo ambos flags en false.
    //
    // Arco y asentamiento van en UNA sola timeline por carta: dos `tweenOf`
    // sobre el mismo `home` con la misma duracion serian dos animaciones
    // peleando por el mismo objeto. La timeline los encadena.
    if (openingDeal || drawDeal) {
      const arcPeak = openingDeal ? 0.9 : 0.55;
      const arcUp = openingDeal ? anim.d(0.16) : anim.d(0.12);
      const arcDown = openingDeal ? anim.d(0.26) : anim.d(0.2);
      const settleStart = arcUp + arcDown;
      newHomes.forEach((home, i) => {
        // Un pelo de stagger para que no caigan todas exactamente juntas: el
        // reparto se lee de izquierda a derecha, como se reparte una baraja.
        const at = anim.d(i * 0.04);
        const tl = anim.sequence();
        tl.to(home, { arc: arcPeak, duration: arcUp, ease: anim.EASE.quadOut }, at);
        tl.to(home, { arc: 0, duration: arcDown, ease: anim.EASE.quadIn });
        tl.to(
          home,
          {
            keyframes: [
              { sx: 1.12, sy: 0.9, duration: anim.d(0.07), ease: anim.EASE.quadOut },
              { sx: 1, sy: 1, duration: anim.d(0.22), ease: anim.EASE.backOut },
            ],
          },
          at + settleStart,
        );
      });
    }

    // El destape cierra el reparto: cada carta se da vuelta un poco DESPUES de
    // aterrizar, en cascada de izquierda a derecha. Es el "comienza" de la
    // ronda. Se usa `flip` (que `applyTransform` compone) y no `rotation.y`
    // directo, porque el giro tambien suma el `PI * flip` de la carta.
    if (openingDeal) {
      const flip = anim.sequence();
      newHomes.forEach((home, i) => {
        flip.to(
          home,
          { flip: 0, duration: anim.d(0.22), ease: anim.EASE.quadOut },
          anim.d(0.28 + i * 0.05),
        );
      });
    }
    this.refreshTargets();
  }

  /**
   * Reconstruye `handCards` en el MISMO orden que `cards` (que es `round.hand`).
   *
   * No crea ni destruye nada: reinserta los `Card3D` existentes. Es lo unico
   * que hace que `layoutHand()` (que itera el Map) refleje el orden del motor
   * despues de un `reorderHand()`. Sin esto el Map conservaba el orden de
   * insercion y el abanico no se movia.
   */
  private reorderHandCards(cards: readonly CardInstance[]): void {
    // Atajo: si ya coincide, no se toca (evita reconstruir en cada frame).
    let same = this.handCards.size === cards.length;
    if (same) {
      let i = 0;
      for (const uid of this.handCards.keys()) {
        if (uid !== cards[i]?.uid) {
          same = false;
          break;
        }
        i += 1;
      }
    }
    if (same) return;

    const ordered: Array<[string, Card3D]> = [];
    for (const card of cards) {
      const card3d = this.handCards.get(card.uid);
      if (card3d) ordered.push([card.uid, card3d]);
    }
    this.handCards.clear();
    for (const [uid, card3d] of ordered) this.handCards.set(uid, card3d);
  }

  /**
   * Reconstruye la fila de Simbiontes y sus ranuras vacias.
   *
   * PUBLICO a proposito: el probe `tools/probe-joker-slots.mjs` necesita forzar
   * el cambio de `jokerSlots` sin recorrer el ciclo de estado del bus, para
   * comprobar que una ranura nueva aparece de inmediato. En produccion solo lo
   * llama el handler de `state:changed`.
   */
  syncJokers(jokers: readonly JokerInstance[], jokerSlots: number): void {
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

    // P6 — Ranuras fijas: una por slot. Se reconstruyen SOLO si cambio el total
    // (comprar un voucher/mutacion de +1 ranura). Las ranuras desbloqueables se
    // ven al instante porque el conteo entra por `jokerSlots`.
    this.rebuildJokerSlots(jokerSlots);

    if (this.carouselActive) this.applyRunVisibility();
    this.layoutJokers();
    this.refreshTargets();
  }

  /**
   * P6 — Ranuras fijas de Simbionte.
   *
   * Cada ranura es un MARCO sutil apoyado en la mesa, con la huella exacta de
   * una carta (ancho x alto x JOKER_SCALE). No es una `Card3D`: un hueco vacio
   * no tiene arte, texto ni VFX, y crear 5 cartas fantasma por partida seria
   * caro y dispararia el pool de texturas al pedo. Un plano con un contorno
   * basta para que el jugador lea "aca va un Simbionte".
   */
  private rebuildJokerSlots(slots: number): void {
    const wanted = Math.max(0, Math.floor(slots));
    if (wanted === this.jokerSlotsBuilt) return;

    for (const mesh of this.jokerSlotMeshes) {
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
      this.scene.remove(mesh);
    }
    this.jokerSlotMeshes.length = 0;
    this.jokerSlotsBuilt = wanted;

    // Huella exacta de una carta a escala joker. Cada ranura tiene su propia
    // geometria porque su `EdgesGeometry` se deriva de ella; el dispose de
    // `rebuildJokerSlots` libera ambas juntas.
    const w = CARD_WIDTH * JOKER_SCALE;
    const h = CARD_HEIGHT * JOKER_SCALE;
    for (let i = 0; i < wanted; i += 1) {
      // Plano acostado en la mesa (igual que las cartas de la partida). El
      // relleno violeta tenue + el contorno se leen como "ranura vacia", no
      // como una carta boca abajo.
      const geometry = new THREE.PlaneGeometry(w, h);
      const material = new THREE.MeshBasicMaterial({
        color: 0x8a7bd8,
        transparent: true,
        opacity: 0.22,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.name = `joker-slot-${i}`;
      // El contorno lo da un anillo de aristas: barato y legible desde lejos.
      const edges = new THREE.LineSegments(
        new THREE.EdgesGeometry(geometry),
        new THREE.LineBasicMaterial({ color: 0xb0a0f5, transparent: true, opacity: 0.75 }),
      );
      mesh.add(edges);
      // Las ranuras NO son interactivas: no deben entrar al raycast.
      mesh.userData['isJokerSlot'] = true;
      this.scene.add(mesh);
      this.jokerSlotMeshes.push(mesh);
    }
  }

  private createCard3D(card: CardInstance | null, joker?: JokerInstance): Card3D {
    const uid = card?.uid ?? joker?.uid ?? `tmp_${Math.random()}`;
    const isJoker = !!joker;
    const elementColor = card ? ELEMENT_COLOR[card.def.element] : 0x8fd8e8;
    const rarity = card?.def.rarity ?? joker?.def.rarity ?? 'common';

    // Cara compacta en tactil: la carta de la mano mide ~112px y la textura se
    // proyecta con escala ~0,15, asi que la cara completa es ilegible ahi. Ver
    // `CardTextureSpec.compact`. El escritorio conserva la cara completa.
    const card3d = new Card3D(
      uid,
      isJoker ? 'joker' : 'card',
      elementColor,
      rarity,
      this.layoutProfile !== 'desktop',
    );
    if (this.backTexture) card3d.setBackTexture(this.backTexture);
    if (card) card3d.setCard(card, this.textures, this.lang(), this.artForCard(card));
    if (joker) card3d.setJoker(joker, this.textures, this.lang(), this.artForJoker(joker));

    if (isJoker) card3d.setBaseScale(JOKER_SCALE);
    // En modo carrusel las cartas de la partida nacen ocultas: si no, una mano
    // que se sincroniza con la coleccion abierta apareceria encima del anillo.
    if (this.carouselActive) card3d.group.visible = false;
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

  /**
   * Ilustracion de un ciego. Publico por la misma razon que `cardArt`: la
   * pantalla de ciego es DOM y no conoce los assets.
   *
   * Devuelve `undefined` si el ciego no declara `art` o si el WebP todavia no
   * se genero. La tarjeta se queda sin imagen y vive de su MATERIAL (el marco
   * compartido), que es el respaldo correcto para un ciego.
   */
  blindArt(art: string | undefined): HTMLImageElement | undefined {
    return this.assets.getFirst(blindKeysFor(art));
  }

  // ==========================================================================
  // Cosméticos (R4b): dorso de carta y tapete.
  //
  // El render es quien tiene los assets cargados, asi que la UI solo pide
  // "pon el dorso/fieltro X" y el render resuelve la textura. El mapeo id->clave
  // es el único punto que sabe qué arte corresponde a cada cosmético: hoy solo
  // existe `default`, pero un fieltro/dorso nuevo se cuelga aqui sin tocar la UI.
  // ==========================================================================

  /**
   * Aplica el dorso de carta `id`. `default` usa el arte base del dorso. El
   * resto de ids reserva `cardback_<id>` (aún sin arte: cae al respaldo de
   * `createCardBackCanvas`). Reconstruye la textura compartida y la reaplica a
   * las pilas y a TODA carta viva (mano, jokers, zona de puntuación).
   */
  setCardBack(id: string): void {
    const key: ArtKey = id === 'default' ? CARD_BACK_KEY : (`cardback_${id}` as ArtKey);
    const art = this.assets.get(key);
    const next = new THREE.CanvasTexture(createCardBackCanvas(art));
    next.colorSpace = THREE.SRGBColorSpace;
    // Liberar el dorso viejo: una textura colgada es RAM de GPU que no vuelve.
    if (this.backTexture) {
      this.backTexture.dispose();
      const index = this.disposables.indexOf(this.backTexture);
      if (index >= 0) this.disposables.splice(index, 1);
    }
    this.backTexture = next;
    this.disposables.push(next);
    // Pilas (mazo/descarte): una sola textura compartida por las dos.
    for (const material of this.pileMaterials) {
      material.map = next;
      material.needsUpdate = true;
    }
    // Cartas vivas: cada Card3D tiene su propio material de dorso.
    this.forEachCard((card) => card.setBackTexture(next));
  }

  /**
   * Aplica el tapete/fieltro `id`. `default` deja la losa rúnica (sin fieltro);
   * el resto de ids reserva `felt_<id>` y, si su arte existe, lo muestra como
   * overlay sobre la losa. Un id sin arte no rompe: la Arena simplemente oculta
   * el tapete.
   */
  setFelt(id: string): void {
    const art = id === 'default' ? undefined : this.assets.get(`felt_${id}` as ArtKey);
    this.arena?.setFelt(art);
  }

  private lang(): string {
    return document.documentElement.lang || 'en';
  }
  // ==========================================================================
  // Layout
  // ==========================================================================

  private layoutHand(): void {
    // NUNCA reacomodar mientras el jugador ARRASTRA: el tween de layout pelea
    // con el dedo por `home` y la carta salta. Al soltar, `handleDrop` vuelve a
    // llamar a `layoutHand()`, asi que el reacomodo no se pierde.
    if (this.dragUid !== null) return;

    const cards = [...this.handCards.values()];
    const count = cards.length;
    if (count === 0) return;

    // Las cartas de la mano CRECEN en movil (ver `handCardBoost`). El tope de
    // spacing y el tope de escala suben juntos para que el abanico se ENSANCHE
    // en vez de pisarse: con el spacing viejo (2.32) la escala quedaba clavada
    // en 1 y no habia forma de agrandar la carta sin que se solaparan.
    //
    // Fase 1 (2026-10-05): la mano baja a 6 cartas, asi que el boost se afloja
    // (1.3 -> 1.2) y el abanico se cierra (ver `spreadMobile`). Con menos cartas
    // no hace falta que cada una sea tan grande, y el conjunto gana aire para
    // que mazo y descarte se lean detras.
    const boost = this.layoutProfile === 'mobile' ? HAND_BOOST : 1;
    const spacing = count <= 1 ? 0 : Math.min(2.32 * boost, this.handSpread / (count - 1));
    const total = spacing * (count - 1);

    // Si el espaciado no alcanza para el ancho de la CARTA, se ACHICAN en vez de
    // pisarse. Pasa con manos grandes: a tamano completo no entran en el abanico,
    // y ensancharlo chocaria con las pilas (x=+-10.5).
    const fit = spacing > 0 ? Math.min(boost, spacing / CARD_WIDTH) : 1;
    for (const card of cards) card.setBaseScale(fit);

    const half = total / 2;
    const pos = (i: number): { x: number; t: number } => {
      const x = -half + i * spacing;
      return { x, t: total === 0 ? 0 : x / half };
    };

    // UN SOLO LAYOUT VIVO.
    //
    // Dos `layoutHand()` en el mismo tick (el `state:changed` de `syncHand` y
    // el del auto-orden) crean dos tweens con stagger sobre los MISMOS `home`.
    // El de `from: 'center'` arranca por el medio y deja a los de las puntas con
    // el tween viejo; cuando por fin les toca, el valor final sale de una lista
    // con OTRO orden y dos cartas caen en el mismo x -> ilustraciones
    // superpuestas. Matar el layout anterior antes de crear el nuevo deja
    // SIEMPRE la ultima posicion calculada, que es la que refleja el Map.
    this.handLayoutTl?.kill();
    this.handLayoutTl = anim.tweenOf(
      cards.map((card) => card.home),
      {
        x: (i: number) => pos(i).x,
        y: (i: number) => HAND_Y - Math.abs(pos(i).t) * 0.1,
        z: (i: number) => HAND_Z + pos(i).t * pos(i).t * 0.5,
        rx: -Math.PI / 2,
        ry: 0,
        rz: (i: number) => -pos(i).x * 0.016,
        duration: anim.d(0.42),
        ease: anim.EASE.backOut,
        stagger: { amount: anim.d(0.22), from: 'center' },
      },
    );
  }

  private layoutJokers(): void {
    const cards = [...this.jokerCards.values()];
    const slotCount = Math.max(this.jokerSlotMeshes.length, cards.length);
    if (slotCount === 0) return;

    // El espaciado sale del ancho REAL del HALO de la carta, no de un numero
    // fijo: a escala joker la carta mide menos que su halo, y con un gap menor
    // las ranuras se pisan y la fila se lee como una mancha.
    const haloWidth = CARD_HALO_WIDTH * JOKER_SCALE;
    const gap = 0.3;
    // Tope de ancho: si entran mas ranuras de las que caben, se comprime el
    // espacio ANTES que dejar que la fila se salga de cuadro.
    const maxSpan = this.handSpread + CARD_WIDTH;
    const wanted = haloWidth + gap;
    const spacing = slotCount > 1 ? Math.min(wanted, maxSpan / (slotCount - 1)) : wanted;
    const total = spacing * (slotCount - 1);
    const half = total / 2;
    /** X de la ranura i, de izquierda a derecha. */
    const slotX = (i: number): number => -half + i * spacing;

    // Ranuras vacias: cada una en SU indice, siempre visible. Se apoyan un pelo
    // por DEBAJO de las cartas (JOKER_SLOT_DY) para que la carta que llene la
    // ranura no pelee el z-buffer con el marco (z-fighting).
    for (let i = 0; i < this.jokerSlotMeshes.length; i += 1) {
      const mesh = this.jokerSlotMeshes[i];
      if (!mesh) continue;
      mesh.position.set(slotX(i), JOKER_Y - JOKER_SLOT_DY, this.jokerZ);
      mesh.rotation.set(-Math.PI / 2, 0, 0);
    }

    // Simbiontes: el indice en `jokers[]` ES la ranura. El motor agrega al
    // final y elimina en el lugar, asi que la primera posicion libre se llena
    // sola y al vender no se reacomodan los demas (el hueco queda a la vista).
    if (cards.length > 0) {
      anim.tweenOf(
        cards.map((card) => card.home),
        {
          x: (i: number) => slotX(i),
          y: JOKER_Y,
          z: this.jokerZ,
          rx: -Math.PI / 2,
          ry: 0,
          rz: 0,
          duration: anim.d(0.36),
          ease: anim.EASE.cubicOut,
          stagger: { amount: anim.d(0.16), from: 'center' },
        },
      );
    }
  }

  /**
   * Pasa una carta de la MANO a la ZONA DE PUNTUACION, en el acto.
   *
   * TIENE que ser sincrono. `playHand` emite `state:changed` al terminar, y ese
   * `syncHand` destruye toda carta que ya no esta en la mano y todavia no fue
   * reclamada por la secuencia de puntaje. Si el reclamo se hiciera en la
   * animacion ENCOLADA, la carta llegaria tarde y se destruiria: el jugador veia
   * la mano "desaparecer" al tocar Jugar, sin viajar al centro.
   */
  private claimScoredCard(uid: string): void {
    const card3d = this.handCards.get(uid);
    if (!card3d) return;
    this.handCards.delete(uid);
    this.scoringCards.push(card3d);
    card3d.setSelected(false);
    card3d.setSelectIndex(null);
    card3d.setBaseScale(PLAY_SCALE);
  }

  private moveToPlayZone(uid: string): void {
    // La carta YA fue reclamada en el handler de `card:played` (ver
    // `claimScoredCard`): aca solo se la anima al centro.
    const card3d = this.scoringCards.find((c) => c.uid === uid);
    if (!card3d) return;

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
    const xFor = (card: Card3D): number => -total / 2 + this.scoringCards.indexOf(card) * spacing;

    // Las que ya estaban se DESLIZAN (no tocan la mesa). Stagger corto.
    const others = this.scoringCards.filter((card) => card !== card3d);
    if (others.length > 0) {
      anim.tweenOf(
        others.map((card) => card.home),
        {
          x: (i: number) => xFor(others[i] as Card3D),
          y: PLAY_Y,
          z: PLAY_Z,
          rx: -Math.PI / 2,
          ry: 0,
          rz: 0,
          duration: anim.d(0.34),
          ease: anim.EASE.cubicOut,
          stagger: { amount: anim.d(0.12) },
        },
      );
    }

    // La que LLEGA: anticipacion -> arco -> aterrizaje con squash.
    anim
      .sequence()
      .to(card3d.home, { sx: 0.9, sy: 1.12, duration: anim.d(0.09), ease: anim.EASE.quadOut }, 0)
      .to(
        card3d.home,
        {
          x: xFor(card3d),
          y: PLAY_Y,
          z: PLAY_Z,
          rx: -Math.PI / 2,
          ry: 0,
          rz: 0,
          duration: anim.d(0.34),
          ease: anim.EASE.cubicOut,
        },
        anim.d(0.09),
      )
      .to(
        card3d.home,
        {
          keyframes: [
            { arc: 1.5, duration: anim.d(0.15), ease: anim.EASE.quadOut },
            { arc: 0, duration: anim.d(0.19), ease: anim.EASE.quadIn },
          ],
        },
        anim.d(0.09),
      )
      .to(card3d.home, { sx: 1.14, sy: 0.86, duration: anim.d(0.07), ease: anim.EASE.quadOut })
      .to(card3d.home, { sx: 1, sy: 1, duration: anim.d(0.24), ease: anim.EASE.elasticOut })
      .add(() => {
        this.particles.burst(card3d.worldPosition(), 14, {
          color: card3d.elementColor,
          speed: 1.9,
          upward: 1.6,
          size: 0.07,
          life: 0.85,
        });
        this.rig.addShake(0.035);
        // La carta "cae" al agua: la onda sale de donde aterrizo.
        this.water?.ripple(xFor(card3d), PLAY_Z, 0.75);
      });
  }

  private flyToDiscard(uid: string): void {
    const card3d = this.handCards.get(uid);
    if (!card3d) return;
    this.handCards.delete(uid);

    const jitter = (Math.random() - 0.5) * 0.4;
    const rz = (Math.random() - 0.5) * 0.5;
    anim
      .sequence()
      .to(
        card3d.home,
        {
          x: this.discardX + jitter,
          y: 0.4,
          z: DISCARD_Z,
          // `rx` explicito: si la carta venia de un arrastre esta inclinada, y
          // sin esto volaria al descarte torcida.
          rx: -Math.PI / 2,
          rz,
          duration: anim.d(0.45),
          ease: anim.EASE.quadOut,
        },
        0,
      )
      // Arco por encima del borde de la mesa, en vez de una linea recta.
      .to(
        card3d.home,
        {
          keyframes: [
            { arc: 0.8, duration: anim.d(0.18), ease: anim.EASE.quadOut },
            { arc: 0, duration: anim.d(0.27), ease: anim.EASE.quadIn },
          ],
        },
        0,
      )
      .add(() => {
        this.particles.burst(card3d.worldPosition(), 8, {
          color: 0x7a8794,
          speed: 1.1,
          upward: 0.8,
          size: 0.05,
          life: 0.6,
        });
        this.water?.ripple(this.discardX + jitter, DISCARD_Z, 0.95);
        this.retire(card3d);
      });
  }

  private flyInFromDeck(card: CardInstance): void {
    const card3d = this.handCards.get(card.uid);
    if (!card3d) return;
    // `layoutHand` ya lo mueve a su lugar; esto solo agrega el destello de salida.
    this.particles.burst(new THREE.Vector3(this.deckX, 0.5, DECK_Z), 6, {
      color: 0x5fd8e8,
      speed: 1.2,
      upward: 1.0,
      size: 0.05,
      life: 0.5,
    });
  }

  /**
   * Reciclado del descarte: las cartas vuelven a la pila de robo.
   *
   * El motor lo hace en silencio (el `Deck` se baraja solo al vaciarse el robo),
   * asi que sin esta animacion el contador de "Robables" saltaba de 0 a N sin
   * explicacion. Se dibujan unas cartas "fantasma" que arquean del descarte al
   * mazo, se pulsa la pila de destino y el descarte "se vacia" un instante.
   */
  private reshuffleToDeck(): void {
    if (!this.ghostGeo) {
      this.ghostGeo = new THREE.PlaneGeometry(CARD_WIDTH * 0.9, CARD_HEIGHT * 0.9);
      this.disposables.push(this.ghostGeo);
    }
    if (!this.ghostMat) {
      this.ghostMat = new THREE.MeshStandardMaterial({
        map: this.backTexture,
        roughness: 0.7,
        metalness: 0.2,
        emissive: new THREE.Color(0x1a3a4a),
        emissiveIntensity: 0.5,
        transparent: true,
        opacity: 0.95,
      });
      this.disposables.push(this.ghostMat);
    }

    const ghosts = 7;
    for (let i = 0; i < ghosts; i++) {
      const ghost = new THREE.Mesh(this.ghostGeo, this.ghostMat);
      ghost.rotation.x = -Math.PI / 2;
      const startX = this.discardX + (Math.random() - 0.5) * 0.6;
      const startZ = DISCARD_Z + (Math.random() - 0.5) * 0.5;
      ghost.position.set(startX, 0.4 + i * 0.01, startZ);
      this.scene.add(ghost);

      const delay = i * 0.07;
      const endX = this.deckX + (Math.random() - 0.5) * 0.5;
      const endZ = DECK_Z + (Math.random() - 0.5) * 0.4;
      anim
        .sequence()
        // Desplazamiento lateral sobre la mesa...
        .to(ghost.position, { x: endX, z: endZ, duration: anim.d(0.55), ease: anim.EASE.cubicInOut }, delay)
        // ...con un arco por encima (sube y baja) mientras viaja.
        .to(
          ghost.position,
          {
            keyframes: [
              { y: 1.8, duration: anim.d(0.24), ease: anim.EASE.quadOut },
              { y: 0.35, duration: anim.d(0.31), ease: anim.EASE.quadIn },
            ],
          },
          delay,
        )
        .add(() => {
          this.particles.burst(new THREE.Vector3(endX, 0.4, endZ), 5, {
            color: 0x5fd8e8,
            speed: 1.1,
            upward: 0.9,
            size: 0.045,
            life: 0.5,
          });
          this.scene.remove(ghost);
        }, delay);
    }

    // Feedback de las pilas: el descarte se achata y el mazo late al recibir.
    if (this.discardMesh) this.pulsePile(this.discardMesh, 0.72, 0.2);
    if (this.deckMesh) this.pulsePile(this.deckMesh, 1.18, 0.4);
  }

  /** Pulso de escala de una pila (feedback de "algo entro/salio"). */
  private pulsePile(group: THREE.Group, peak: number, delay: number): void {
    anim
      .sequence()
      .to(group.scale, { x: peak, y: peak, z: peak, duration: anim.d(0.12), ease: anim.EASE.quadOut }, delay)
      .to(group.scale, { x: 1, y: 1, z: 1, duration: anim.d(0.26), ease: anim.EASE.backOut });
  }

  private onScoreStep(step: ScoreStep): void {
    const index = this.stepIndex++;
    if (index >= MAX_ANIMATED_STEPS) return;

    // Una TIMELINE reemplaza la cola de delays: mismo span temporal
    // (0.42 + i * stagger), pero cancelable de una y sin acumular callbacks
    // sueltos. El paso 0 abre la secuencia de la mano; uno nuevo la cierra.
    if (index === 0 || !this.scoreTl) {
      this.scoreTl?.kill();
      // `score:settled` es el permiso del HUD para mostrar el panel siguiente.
      // Sin esto, el motor pasa a `reward` al instante y el panel de recompensa
      // (o la seleccion de ciego) aparece ENCIMA de la animacion del puntaje.
      this.scoreTl = anim.sequence({ onComplete: () => bus.emit('score:settled', {}) });
    }
    this.scoreTl.call(
      () => this.runScoreStep(step, index),
      undefined,
      anim.d(0.6 + index * this.stepStagger),
    );
  }

  private runScoreStep(step: ScoreStep, index: number): void {
    {
      const origin = this.findWorldPosition(step.sourceId, step.targetUid);
      const color = this.colorForAction(step.action, origin.color);
      const isMult = step.action === 'MULTIPLY_SUBSTRATE' || step.action === 'MULTIPLY_SPORES';

      // ESCALADO DEL COMBO. `c` va de 0 (primer paso) a 1 (ultimo) y maneja
      // cuantas esporas salen, a que velocidad, cuanto sacude la camara y que
      // tan grande se dibuja el numero. Es lo que hace que una mano larga se
      // SIENTA distinta de una corta: antes cada paso era identico al anterior.
      //
      // El total se lee de `stepIndex` y funciona porque el primer paso corre
      // con 0.6 s de delay (`onScoreStep`): para ese entonces el motor ya emitio
      // todos los `score:step` y `stepIndex` vale el total de la mano.
      const total = Math.max(1, this.stepIndex);
      const c = total > 1 ? Math.min(1, index / (total - 1)) : 0;

      this.particles.burst(origin.position, Math.round(14 + c * 40), {
        color,
        speed: 1.8 + c * 2.4,
        upward: 1.8,
        size: 0.06 + c * 0.05,
        life: 0.9,
      });

      // Multiplicar golpea mas fuerte que sumar, y los dos escalan con el combo.
      this.rig.addShake(isMult ? 0.06 + c * 0.12 : 0.02 + c * 0.04);

      // MICELIO: la raiz que une esta carta con la que puntuo antes, en el orden
      // real del calculo. No se awaitea: crece (260 ms) y se desvanece (500 ms)
      // mientras la secuencia sigue. Sin esto cada paso es una isla.
      const previous = this.lastScoreOrigin;
      this.lastScoreOrigin = origin.position.clone();
      if (previous && previous.distanceTo(origin.position) > 0.35) {
        void this.mycelium.grow(previous, origin.position, color);
      }

      // POP de la carta que origina el paso: squash & stretch + destello en el
      // color del efecto. No se awaitea: es un adorno que corre en paralelo (los
      // pasos se escalonan cada 0.18 s y el pop dura 0.45).
      const source = this.handCards.get(step.sourceId) ?? this.scoringCards.find((x) => x.uid === step.sourceId);
      if (source && !step.sourceId.startsWith('combo:') && !step.sourceId.startsWith('order:')) {
        void source.pop(color);
      }

      // HABILIDAD ACTIVADA. Si la carta que origina este paso trae efectos
      // propios (no un combo ni un bonus generico), se marca con un destello en
      // el color de habilidad: la etiqueta "✦ HABILIDAD" dice CUALES la tienen,
      // y esto dice CUANDO se disparan. Es la parte que no se puede deducir del
      // color de la carta, asi que va con un VFX propio y no con un tinte.
      this.flashAbility(step.sourceId);

      const sign = step.value >= 0 ? '+' : '';
      const text =
        step.action === 'MULTIPLY_SPORES' ? `x${step.value}` : `${sign}${Math.round(step.value)}`;

      const screen = this.projectToScreen(origin.position);

      if (this.callbacks.onScorePopup) {
        this.callbacks.onScorePopup(screen.x, screen.y, text, color, c);
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
        combo: c,
      });
    }
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

  /**
   * Hace latir un joker. Lo usa el HUD cuando el jugador toca su ficha: la
   * ficha y la carta en la mesa son lo mismo, y el latido es lo que lo dice.
   */
  flashJoker(uid: string): void {
    const joker = this.jokerCards.get(uid);
    if (joker) this.pulseJoker(joker, 1);
  }

  private pulseJoker(card3d: Card3D, depth: number): void {
    // Antes tweeneaba `group.scale`, que `applyTransform()` pisa cada frame:
    // el pulso era INVISIBLE. Ahora anima `home.s*`, que si se compone.
    anim.tweenOf(card3d.home, {
      keyframes: [
        { sx: 1.22, sy: 1.22, sz: 1.22, duration: anim.d(0.1), ease: anim.EASE.quadOut },
        { sx: 1, sy: 1, sz: 1, duration: anim.d(0.22), ease: anim.EASE.cubicOut },
      ],
    });
    this.particles.burst(card3d.worldPosition(), 10, {
      color: 0x5fd8e8,
      speed: 1.8,
      upward: 1.2,
      size: 0.055,
      life: 0.7,
    });
    this.rig.addShake(Math.min(0.12, 0.02 + depth * 0.01));
  }

  /**
   * Marca la ACTIVACION de una habilidad sobre la carta que la disparo.
   *
   * La etiqueta "✦ HABILIDAD" de la cara dice QUE cartas tienen efecto; sin
   * esto, el jugador ve el numero subir pero no a QUE carta atribuirlo. El
   * aviso es un latido corto en el lila de habilidad + un anillo de particulas,
   * ambos con FORMA (movimiento) y color: no depende solo del tono.
   *
   * `ABILITY_COLOR` tiene que coincidir con el lila de la cara de carta
   * (`CardTexture.abilityColor`) para que el jugador lea "esa misma etiqueta".
   */
  private flashAbility(sourceId: string): void {
    // Solo cartas/jokers reales: los pasos de combo y orden usan ids sinteticos
    // ("combo:*", "order:*") y no son habilidades de una carta.
    if (sourceId.startsWith('combo:') || sourceId.startsWith('order:')) return;
    const card3d = this.handCards.get(sourceId) ?? this.scoringCards.find((c) => c.uid === sourceId);
    if (!card3d || !card3d.hasAbility) return;
    this.celebrateCard(card3d, ABILITY_COLOR, 14);
  }

  private celebrate(): void {
    const center = new THREE.Vector3(0, 0.6, PLAY_Z);
    // Dos oleadas escalonadas: la segunda entra cuando la primera ya sube.
    anim
      .sequence()
      .add(() => {
        this.rig.addShake(0.32);
        // Onda grande en el centro: la victoria "golpea" el agua.
        this.water?.ripple(0, PLAY_Z, 1.6);
      }, 0)
      .add(() => {
        this.particles.burst(center, this.isMobile ? 70 : 130, {
          color: 0x4fd18b,
          speed: 5.2,
          upward: 3.4,
          size: 0.11,
          life: 1.5,
        });
      }, 0)
      .add(() => {
        this.particles.burst(center, this.isMobile ? 40 : 70, {
          color: 0xffc857,
          speed: 3.8,
          upward: 4.2,
          size: 0.09,
          life: 1.7,
        });
      }, anim.d(0.14))
      .add(() => this.flyScoredToDiscard(0.4), 0);
  }

  private doom(): void {
    const center = new THREE.Vector3(0, 0.5, PLAY_Z);
    anim
      .sequence()
      .add(() => {
        this.rig.addShake(0.5);
        this.water?.ripple(0, PLAY_Z, 1.9);
      }, 0)
      .add(() => {
        this.particles.burst(center, 80, {
          color: 0xe05c8a,
          speed: 3.4,
          upward: 0.4,
          size: 0.09,
          life: 1.2,
        });
      }, 0)
      .add(() => {
        this.particles.burst(center, 30, {
          color: 0x8a2f52,
          speed: 2.0,
          upward: 0.2,
          size: 0.07,
          life: 1.4,
        });
      }, anim.d(0.18));
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
    // Squash -> se hunde -> se libera.
    anim
      .sequence()
      .to(card3d.home, { sx: 1.15, sy: 0.85, duration: anim.d(0.08), ease: anim.EASE.quadOut })
      .to(card3d.home, {
        y: -1.2,
        rz: card3d.home.rz + 0.6,
        sx: 0.9,
        sy: 0.9,
        duration: anim.d(0.35),
        ease: anim.EASE.quadIn,
        onComplete: () => {
          card3d.dispose();
          this.scene.remove(card3d.group);
        },
      });
  }

  /**
   * Las cartas JUGADAS vuelven a la PILA DE DESCARTE.
   *
   * Antes se hundian en la mesa a los 0.9 s —EN MITAD del conteo— y
   * "desaparecian": el jugador no veia a donde iban. Ahora, cuando TERMINA la
   * animacion del puntaje, vuelan al descarte con arco y stagger, que es donde
   * el motor las manda de verdad.
   *
   * Es IDEMPOTENTE: si ya no quedan cartas en el centro no hace nada, asi que se
   * la puede llamar desde varios puntos (el aviso del render, y redes de
   * seguridad por si la timeline se corta).
   */
  private flyScoredToDiscard(delay = 0.3): void {
    const run = (): void => {
      if (this.scoringCards.length === 0) return;
      const cards = [...this.scoringCards];
      this.scoringCards.length = 0;

      cards.forEach((card3d, i) => {
        const jitter = (Math.random() - 0.5) * 0.5;
        const rz = (Math.random() - 0.5) * 0.5;
        const stagger = i * 0.07;
        // Al descarte van boca abajo.
        card3d.setFaceUp(false, { tweens: this.tweens, duration: 0.3 });
        anim
          .sequence()
          .to(
            card3d.home,
            {
              x: this.discardX + jitter,
              y: 0.4,
              z: DISCARD_Z,
              // `rx`/`ry` explicitos: la carta viene del centro y sin esto
              // volaria torcida al descarte.
              rx: -Math.PI / 2,
              ry: 0,
              rz,
              duration: anim.d(0.5),
              ease: anim.EASE.quadOut,
            },
            stagger,
          )
          // Arco por encima del borde de la mesa.
          .to(
            card3d.home,
            {
              keyframes: [
                { arc: 0.9, duration: anim.d(0.2), ease: anim.EASE.quadOut },
                { arc: 0, duration: anim.d(0.3), ease: anim.EASE.quadIn },
              ],
            },
            stagger,
          )
          // Se achica al aterrizar y se libera.
          .to(card3d.home, { sx: 0.7, sy: 0.7, sz: 0.7, duration: anim.d(0.12) }, stagger + 0.5)
          .add(() => {
            this.particles.burst(card3d.worldPosition(), 6, {
              color: 0x7a8794,
              speed: 1.0,
              upward: 0.8,
              size: 0.05,
              life: 0.5,
            });
            this.water?.ripple(this.discardX + jitter, DISCARD_Z, 0.95);
            card3d.dispose();
            this.scene.remove(card3d.group);
          }, stagger + 0.62);
      });

      // La pila del descarte late al recibirlas.
      if (this.discardMesh) this.pulsePile(this.discardMesh, 1.14, 0.5);
    };

    // `delay <= 0` corre EN EL ACTO: lo necesita la red de seguridad de
    // `card:played` (indice 0), que tiene que vaciar el centro ANTES de reclamar
    // las cartas de la mano nueva. Encolada llegaria tarde y las borraria.
    if (delay <= 0) run();
    else this.queueFx(delay, run);
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

  /**
   * Tap al vacio sobre la MESA. Hoy solo reacciona la pila de descarte: tocarla
   * descarta la seleccion actual (alternativa al arrastre). Sin seleccion el
   * controlador no hace nada.
   */
  private handleEmptyTap(point: THREE.Vector3): void {
    if (this.engine.run.status !== 'playing') return;
    // Se consulta el rect de la ZONA (ya centrado en la pila por perfil), no la
    // constante: si no, en tactil el toque sobre la pila caia fuera.
    if (this.discardZone && rectContains(this.discardZone.rect, point.x, point.z)) {
      this.callbacks.onDiscardPileTap?.();
    }
  }

  /**
   * Pista visual del DESCARTE: con cartas seleccionadas, la zona se enciende
   * tenue para que se descubra el toque (sin arrastre). Se re-aplica tras cada
   * drop porque `highlight(false)` apaga la zona.
   */
  private refreshDiscardHint(): void {
    if (!this.discardZone) return;
    const round = this.engine.round;
    const on =
      this.engine.run.status === 'playing' &&
      !!round &&
      round.selected.length > 0 &&
      round.discardsLeft > 0;
    this.discardZone.setHint(on);
  }

  private handleHover(card: Card3D | null): void {
    for (const candidate of this.handCards.values()) {
      candidate.setHover(candidate === card);
    }
    if (card?.card) this.callbacks.onHoverChange(card.card);
    else this.callbacks.onHoverChange(null);
  }

  /**
   * Long-press tactil. NO mueve la carta (el hover eleva; aca no hace falta) y
   * no la selecciona: solo pide el tooltip. La UI decide DONDE ponerlo.
   */
  private handleLongPress(card: Card3D): void {
    if (card.card) this.callbacks.onLongPressChange?.(card.card);
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
    this.stopCard(card3d);
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
    // El drop apago todas las zonas: si queda seleccion, se restaura la pista.
    this.refreshDiscardHint();

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
        // Escala efectiva: la mano achica las cartas cuando no entran.
        scale: card3d.scale,
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
    // En modo carrusel la mano esta OCULTA pero el raycaster la seguiria
    // golpeando (la visibilidad no lo frena): se le sacan los targets.
    if (this.carouselActive) {
      this.interaction.setTargets([]);
      return;
    }
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
      // `Math.max(0, ...)`: el timestamp del primer rAF puede ser ANTERIOR al
      // `performance.now()` de `start()`, y un dt negativo haria retroceder el
      // reloj (y con el, el de GSAP).
      const dt = Math.min(0.05, Math.max(0, rawDt));
      last = now;

      // HIT-STOP: durante unos ms TODO el update recibe dt = 0, asi que los
      // tweens, las particulas, la cola de FX y la camara se congelan JUNTOS y
      // en el mismo frame. Congelar solo una parte desincronizaria la secuencia
      // (el golpe se "siente" justamente porque nada se mueve).
      //
      // La cuenta atras va sobre el dt SIN ACOTAR, o sea tiempo de pared:
      //   - con el dt ya congelado nunca llegaria a cero (juego trabado);
      //   - con el dt ACOTADO a 0.05, en un equipo a 4 FPS el presupuesto se
      //     consumiria de a 50 ms por frame y un hit-stop de 90 ms duraria ~4
      //     frames, o sea medio segundo real. El golpe tiene que durar lo que
      //     dice, no lo que el framerate permita.
      // La entrada NO se congela: los eventos de puntero no pasan por aca.
      this.hitStopLeft = Math.max(0, this.hitStopLeft - rawDt);
      const step = this.hitStopLeft > 0 ? 0 : dt;

      this.clock += step;
      this.lastFrameDt = step;

      this.runFxQueue();
      this.tweens.update(step);
      // GSAP con el MISMO dt acotado, antes del update de las cartas: asi las
      // secuencias se aplican a `home` y `applyTransform()` las compone en el
      // mismo frame que se dibuja (sin un frame de atraso).
      anim.updateAnim(step);
      if (this.carouselActive) {
        // Modo carrusel: la mano y los jokers estan ocultos y no se actualizan.
        // Lo unico que se mueve es el anillo.
        this.carousel?.update(step, this.clock);
      } else {
        for (const card3d of this.handCards.values()) card3d.update(step, this.clock);
        for (const card3d of this.jokerCards.values()) card3d.update(step, this.clock);
        for (const card3d of this.scoringCards) card3d.update(step, this.clock);
        if (this.mode === 'menu') this.updateMenuDecor(step);
      }

      // Las zonas solo existen mientras se puede jugar: fuera de 'playing' no
      // hay cartas en la mano que arrastrar.
      const zonesActive = this.mode === 'run' && this.engine.run.status === 'playing';
      for (const zone of this.dropZones) {
        if (!zonesActive) zone.setEnabled(false);
        zone.update(step, this.clock);
      }

      this.updateShadows();
      this.particles.update(step);
      // La fisica del dado va con el MISMO dt acotado: es lo que impide que un
      // tiron de frames la mande al infinito.
      this.die3d?.update(step);
      this.water?.update(this.clock);
      this.rig.update(step, this.clock);

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

      // El HUD se sincroniza con el barrido por CSS: se le avisa el avance una
      // vez por frame, y con -1 cuando termina (ver `onTransitionProgress`).
      const transition = this.postFx?.transition;
      if (transition?.running) {
        this.transitionWasRunning = true;
        this.transitionListener?.(transition.progress);
      } else if (this.transitionWasRunning) {
        this.transitionWasRunning = false;
        this.transitionListener?.(-1);
      }

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

  /** Segundos de hit-stop que quedan. Ver `hitStop`. */
  private hitStopLeft = 0;

  /**
   * Congela la escena unos milisegundos. Es el "golpe" que hace que un cierre de
   * combo se sienta: la accion se detiene y despues sigue.
   *
   * Congela el UPDATE COMPLETO (tweens de GSAP, `TweenManager`, particulas,
   * cola de FX, cartas y camara), no solo una parte: si solo se frenaran las
   * particulas, las secuencias seguirian corriendo por detras y al reanudar se
   * veria el salto.
   *
   * Se ignora con `reduceMotion`: es exactamente el tipo de efecto que la gente
   * pide apagar.
   */
  hitStop(ms: number): void {
    if (this.reduceMotion) return;
    this.hitStopLeft = Math.max(this.hitStopLeft, ms / 1000);
  }

  private queueFx(delay: number, run: () => void): void {
    // Con reduceMotion los efectos entran al toque: mismo criterio que el CSS.
    this.fxQueue.push({ at: this.clock + (this.reduceMotion ? 0 : delay), run });
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
        return UI_COLORS.substrate;
      // MULTIPLICAR no se pinta como sumar: un `x2` es un momento distinto de un
      // `+20`, y hasta ahora compartian color. Va en dorado, que ademas no
      // compite con el ambar del sustrato ni con el verde de las esporas.
      case 'MULTIPLY_SUBSTRATE':
      case 'MULTIPLY_SPORES':
        return UI_COLORS.xmult;
      case 'ADD_SPORES':
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
  /** `true` mientras el jugador arrastra una carta de la mano. */
  isDragging(): boolean {
    return this.dragUid !== null;
  }

  projectPointToScreen(x: number, y: number, z: number): { x: number; y: number } {
    return this.projectToScreen(new THREE.Vector3(x, y, z));
  }

  /**
   * CAJA proyectada de cada pila en pantalla (CSS px): centro + ancho/alto.
   *
   * El HUD la usa para meter la etiqueta DENTRO del dorso visible, ajustada a su
   * tamano (no flotando al lado). Se proyectan las cuatro esquinas del plano de
   * la pila (esta acostada en el plano XZ) y se toma su bounding box: con
   * perspectiva el trapecio se aproxima bien por su caja.
   */
  pileAnchors(): {
    deck: { x: number; y: number; w: number; h: number };
    discard: { x: number; y: number; w: number; h: number };
  } {
    const box = (cx: number, cz: number): { x: number; y: number; w: number; h: number } => {
      const pw = CARD_WIDTH * 0.92;
      const ph = CARD_HEIGHT * 0.92;
      const corners = [
        this.projectPointToScreen(cx - pw / 2, 0, cz - ph / 2),
        this.projectPointToScreen(cx + pw / 2, 0, cz - ph / 2),
        this.projectPointToScreen(cx - pw / 2, 0, cz + ph / 2),
        this.projectPointToScreen(cx + pw / 2, 0, cz + ph / 2),
      ];
      const xs = corners.map((p) => p.x);
      const ys = corners.map((p) => p.y);
      const minX = Math.min(...xs);
      const maxX = Math.max(...xs);
      const minY = Math.min(...ys);
      const maxY = Math.max(...ys);
      return { x: (minX + maxX) / 2, y: (minY + maxY) / 2, w: maxX - minX, h: maxY - minY };
    };
    return { deck: box(this.deckX, DECK_Z), discard: box(this.discardX, DISCARD_Z) };
  }

  // ==========================================================================
  // Resize
  // ==========================================================================

  /**
   * Perfil de LAYOUT (no de GPU), evaluado EN VIVO.
   *
   * Se deriva del PUNTERO y del ALTO, igual que el CSS (`@media (pointer:
   * coarse)` y `(pointer: coarse) and (min-height: 600px)`), para que el layout
   * 3D se pueda ajustar por dispositivo sin arrastrar a los demas. Distinto de
   * `isMobile`: ese mezcla puntero + user-agent y decide GPU (antialias,
   * calidad, particulas). Aca solo importa el encuadre.
   *
   * Es un getter y no un campo porque ROTAR una tablet cambia el alto: el CSS
   * re-evalua su media query y el JS tiene que hacer lo mismo.
   */
  private get layoutProfile(): 'mobile' | 'tablet' | 'desktop' {
    if (!this.isCoarse) return 'desktop';
    return window.innerHeight >= TABLET_MIN_H ? 'tablet' : 'mobile';
  }

  /**
   * Ancho del abanico de la mano (unidades de mundo).
   *
   * Se elige por PERFIL, no por aspect. Antes se derivaba SOLO del aspect y el
   * escritorio 16:9 (1.7778) caia en la MISMA rama que un celular (2.2213), a
   * 0.028 del umbral `1.75`: afinar el 3D para movil movia el encuadre del
   * escritorio.
   */
  private spreadFor(aspect: number): number {
    const profile = this.layoutProfile;
    if (profile === 'tablet') return this.spreadTablet(aspect);
    if (profile === 'mobile') return this.spreadMobile(aspect);
    return this.spreadDesktop(aspect);
  }

  /**
   * Rama CELULAR del spread.
   *
   * Mas ancha que la de escritorio a proposito: el celular necesita cartas
   * GRANDES (a 412px de alto, una carta a escala nominal deja el texto de la
   * cara en ~2px, ilegible). Un abanico mas ancho deja subir la escala de la
   * carta sin que se pisen (ver el `boost` de `layoutHand`). El ancho extra
   * entra: en un celular apaisado el encuadre lo fija el ALTO, no el ancho.
   *
   * Pero SIEMPRE acotado por `handSpreadClearOfPiles`: el abanico no puede
   * invadir las columnas de mazo/descarte.
   */
  private spreadMobile(aspect: number): number {
    const base = aspect > 1.75 ? 18.5 : aspect > 1.45 ? 16 : 13.5;
    return Math.min(base, this.handSpreadClearOfPiles());
  }

  /** Rama TABLET del spread. Pantalla alta: el abanico puede abrirse igual. */
  private spreadTablet(aspect: number): number {
    const base = aspect > 1.75 ? 21.5 : aspect > 1.45 ? 18 : 15;
    return Math.min(base, this.handSpreadClearOfPiles());
  }

  /**
   * Ancho MAXIMO del abanico para que NO invada las columnas de mazo/descarte.
   *
   * Se DERIVA de la posicion real de las pilas (no de un numero a ojo): si se
   * mueven, el abanico se ajusta solo. Antes el abanico tactil (18.5) llegaba a
   * x = ±10.5 mientras la pila vive en ±9.4: las cartas de las puntas TAPABAN
   * el mazo y el descarte (el bug que reporto el usuario: "nunca permitir que
   * la mano se expanda sobre esas columnas").
   */
  private handSpreadClearOfPiles(): number {
    const pileHalf = (CARD_WIDTH * 0.92) / 2; // media pila
    const inner = Math.abs(this.discardX) - pileHalf; // borde interno de la columna
    const cardHalf = (CARD_WIDTH / 2) * HAND_BOOST; // media carta con el boost tactil
    return Math.max(8, (inner - cardHalf - 0.25) * 2);
  }

  /** Rama ESCRITORIO del spread (congelada hasta la fase de escritorio). */
  private spreadDesktop(aspect: number): number {
    return aspect > 1.75 ? 16.5 : aspect > 1.45 ? 14 : 12;
  }

  /**
   * Corrimiento del encuadre hacia la mano (fraccion del alto visible del HUD
   * inferior). Misma separacion por perfil que `spreadFor()`.
   */
  private biasFor(): number {
    const profile = this.layoutProfile;
    if (profile === 'tablet') return this.biasTablet();
    if (profile === 'mobile') return this.biasMobile();
    return this.biasDesktop();
  }

  /** Rama CELULAR del bias. */
  private biasMobile(): number {
    return 0.72;
  }

  /** Rama TABLET del bias. */
  private biasTablet(): number {
    return 0.72;
  }

  /** Rama ESCRITORIO del bias (congelada hasta la fase de escritorio). */
  private biasDesktop(): number {
    return 0.72;
  }

  /**
   * X de las pilas (mazo y descarte).
   *
   * En TACTIL van MAS ADENTRO. Con una pantalla mas alta que ancha, el bound de
   * ancho —que las pilas mandan— obliga a la camara a alejarse y deja una franja
   * negra abajo: acercandolas, el encuadre pasa a fijarlo el ALTO y la mesa llena
   * la pantalla. El escritorio conserva sus constantes.
   *
   * PENDIENTE: en el CELULAR el abanico (mas ancho desde el boost de cartas)
   * llega a cubrir las pilas. Ver la §6 del doc de convencion.
   */
  /**
   * X de la pila de MAZO: a la DERECHA del area central (y el descarte a la
   * izquierda). Es el orden historico, que el usuario pidio conservar.
   */
  private get deckX(): number {
    return this.layoutProfile === 'desktop' ? DECK_X : TACTILE_PILE_X;
  }

  /** X de la pila de DESCARTE: a la IZQUIERDA. Ver `deckX`. */
  private get discardX(): number {
    return this.layoutProfile === 'desktop' ? DISCARD_X : -TACTILE_PILE_X;
  }

  /** Z de la fila de Simbiontes. En celular va mas adelante: ver `JOKER_Z_MOBILE`. */
  private get jokerZ(): number {
    return this.layoutProfile === 'mobile' ? JOKER_Z_MOBILE : JOKER_Z;
  }

  /**
   * Barrido de pantalla entre dos estados (ver `Transition.ts`).
   *
   * IMPORTANTE: se llama ANTES de mutar el motor. La captura del frame viejo
   * tiene que ocurrir con la escena todavia en el estado ANTERIOR; si se llama
   * despues, A y B son el mismo frame y no se ve nada.
   *
   * En el tier `low` no hay composer, asi que no hace nada: el cambio es seco.
   * Con `reduceMotion` la duracion se acorta a ~0 (ver `anim.d`), o sea que el
   * estado final se alcanza igual pero sin barrido.
   */
  playTransition(seconds: number = TRANSITION_SECONDS): void {
    if (!this.postFx) return;
    this.postFx.transition.begin(this.renderer, this.scene, this.rig.camera, seconds);
  }

  /** Hay un barrido en curso. */
  get transitionRunning(): boolean {
    return this.postFx?.transition.running === true;
  }

  /**
   * La UI se suscribe para sincronizar el HUD con el barrido. Se llama una vez
   * por frame mientras dura (con 0..1) y una ultima vez con -1 al terminar.
   */
  onTransitionProgress(cb: ((progress: number) => void) | null): void {
    this.transitionListener = cb;
  }

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

    // En modo carrusel el encuadre es PROPIO (frontal al anillo) y no se deriva
    // del layout de la partida.
    if (this.carouselActive) {
      this.fitCarousel(aspect);
      return;
    }

    // En pantallas anchas la mano puede abrirse; en angostas se compacta.
    // El ancho sale del PERFIL (movil/tablet/escritorio), no del aspect crudo.
    this.handSpread = this.spreadFor(aspect);

    // Las pilas siguen al perfil: rotar una tablet las mueve y el encuadre se
    // reajusta solo, porque el bound de ancho sale de ellas.
    this.deckMesh?.position.setX(this.deckX);
    this.discardMesh?.position.setX(this.discardX);
    // La zona de descarte sigue a la pila: sin esto, en tactil quedaba a la
    // izquierda de donde el jugador la ve (y el toque directo fallaba).
    this.syncDropZones();

    // El encuadre se DERIVA del layout real, no de un numero a ojo: si se
    // mueve la mano o los jokers, la camara se reajusta sola.
    //
    // El ancho cubre lo MAS ancho entre la mano y los piles: como ahora los
    // piles viven en X=±10.5 (mas alla de los ±8.25 de la mano), el ancho
    // efectivo lo mandan los piles. Si no se ensancha el bound, los pillars
    // quedan fuera de cuadro y el jugador no los ve.
    const pileHalfWidth = Math.max(Math.abs(this.deckX), Math.abs(this.discardX)) + CARD_WIDTH * 0.5;
    const handHalfWidth = this.handSpread * 0.5 + CARD_WIDTH * 0.5;
    const halfWidth = Math.max(pileHalfWidth, handHalfWidth) + 0.3;

    const bounds = {
      topZ: HAND_Z + CARD_HALF_DEPTH,
      // El encuadre se mantiene anclado a la Z de ESCRITORIO aunque en celular
      // la fila se corra hacia adelante (`jokerZ`): si el bound siguiera a la
      // fila, la camara se acercaria y las ranuras volverian a subir — el
      // corrimiento se cancelaria solo. Anclando el encuadre, la fila baja de
      // verdad y el tablero conserva su tamano.
      bottomZ: JOKER_Z - CARD_HALF_DEPTH * JOKER_SCALE,
      width: halfWidth * 2,
    };

    // Corrimiento del encuadre hacia la mano. 0.72 del alto visible del HUD
    // inferior (que en un celular en landscape es ~19% de la pantalla).
    // Por perfil, para poder atarlo al HUD movil sin tocar el escritorio.
    const bias = this.biasFor();
    const biasZ = bounds.bottomZ + (bounds.topZ - bounds.bottomZ) * bias;

    this.rig.fit(aspect, bounds, biasZ);

    this.layoutHand();
    this.layoutJokers();

    // El HUD cuelga sus etiquetas de pila de estas coordenadas (la camara esta
    // quieta durante la partida: alcanza con recalcularlas al reencuadrar).
    this.callbacks.onPileAnchors?.(this.pileAnchors());
  }

  dispose(): void {
    this.stop();
    // Cortar TODA la animacion de GSAP antes de disponer las cartas: un
    // onComplete pendiente no puede tocar un material ya liberado.
    anim.killAll();
    this.detachCarouselInput();
    this.carousel?.dispose();
    this.carousel = null;
    this.renderer.domElement.removeEventListener('pointermove', this.onWaterPointerMove);
    this.detachDieInput();
    this.water?.dispose();
    this.water = null;
    this.die3d?.dispose();
    this.die3d = null;
    for (const unsubscribe of this.unsubscribes) unsubscribe();
    this.unsubscribes.length = 0;
    this.interaction.dispose();

    for (const card3d of this.handCards.values()) card3d.dispose();
    for (const card3d of this.jokerCards.values()) card3d.dispose();
    for (const card3d of this.scoringCards) card3d.dispose();
    this.handCards.clear();
    this.jokerCards.clear();
    this.scoringCards.length = 0;

    // P6 — Ranuras de Simbionte: geometria, relleno y contorno.
    for (const mesh of this.jokerSlotMeshes) {
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
      for (const child of mesh.children) {
        const line = child as THREE.LineSegments;
        line.geometry.dispose();
        (line.material as THREE.Material).dispose();
      }
      this.scene.remove(mesh);
    }
    this.jokerSlotMeshes.length = 0;
    this.jokerSlotsBuilt = -1;

    this.textures.clear();
    for (const zone of this.dropZones) zone.dispose();
    this.dropZones.length = 0;
    this.postFx?.dispose();
    this.postFx = null;
    this.backTexture = null;
    this.particles.dispose();
    this.mycelium.dispose();
    for (const item of this.disposables) item.dispose();
    disposeSharedGeometry();
    this.renderer.dispose();
  }

  /** Estado del carrusel (debug y tests). Null si no esta activo. */
  carouselState(): { active: boolean; count: number; focus: number; visible: number } | null {
    if (!this.carouselActive || !this.carousel) return null;
    return {
      active: true,
      count: this.carousel.count,
      focus: this.carousel.focusedIndex,
      visible: this.carousel.visibleSlots,
    };
  }

  /** Las entradas actuales del carrusel (solo lectura). Para verificacion/debug. */
  carouselEntries(): readonly CarouselEntryView[] | null {
    if (!this.carouselActive || !this.carousel) return null;
    return this.carousel.currentEntries;
  }

  /**
   * Centro en pantalla (px del canvas) de la carta ENFOCADA, o null.
   *
   * Es el punto exacto donde hay que tocar para pegarle a la carta del frente:
   * a ojo NO es el centro del canvas (el encuadre del anillo baja la carta para
   * dejar lugar al panel). Lo usan los tests para simular un toque real.
   */
  carouselFocusedScreenPoint(): { x: number; y: number } | null {
    if (!this.carouselActive || !this.carousel) return null;
    return this.carousel.focusedScreenPoint((v) => this.projectToScreen(v));
  }

  /**
   * Posicion X (mundo) de cada carta de la mano, en orden del Map.
   *
   * Helper de DEPURACION para reproducir el bug de "ordenar superpone las
   * ilustraciones": si dos cartas vecinas quedan a menos de ~1.1 unidades
   * (menos de medio ancho de carta), el abanico esta mal armado. Ver
   * `tools/repro-sort.mjs`.
   */
  readHandXs(): number[] {
    return [...this.handCards.values()].map((card) => card.home.x);
  }

  /**
   * P6 — Instantanea de las ranuras de Simbionte, para el probe/smoke.
   *
   * Devuelve la huella de cada ranura (debe ser la de una carta normal) y si
   * esta visible. El test comprueba que una ranura vacia mida lo mismo que un
   * Simbionte real (mismo `JOKER_SCALE`) y que al sumar `jokerSlots` aparezca
   * una nueva.
   */
  jokerSlotDebug(): { count: number; built: number; slots: Array<{ w: number; h: number; visible: boolean; x: number }> } {
    return {
      count: this.jokerSlotMeshes.length,
      built: this.jokerSlotsBuilt,
      slots: this.jokerSlotMeshes.map((mesh) => {
        const params = (mesh.geometry as THREE.PlaneGeometry).parameters;
        return {
          w: Number(params.width.toFixed(4)),
          h: Number(params.height.toFixed(4)),
          visible: mesh.visible,
          x: Number(mesh.position.x.toFixed(3)),
        };
      }),
    };
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
      // Secuencias/tweens vivos de GSAP. Clave aparte de `tweens`: el panel de
      // debug los lee por separado porque son dos motores distintos.
      gsap: anim.activeCount(),
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
