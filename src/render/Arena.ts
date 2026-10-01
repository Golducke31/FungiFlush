/**
 * Arena.ts — La Arena del duelo.
 *
 * QUE ES ESTO
 * -----------
 * Una PLATAFORMA de piedra que emerge del agua: la cara superior es la LOSA
 * RUNICA (la ilustracion de `art_arena`, con su circulo de invocacion y las
 * venas de micelio), los costados se ven por encima de la linea de agua, y los
 * racimos de hongos 3D crecen en el borde de atras.
 *
 * POR QUE EL PISO ES UNA IMAGEN Y NO TILES 3D
 * -------------------------------------------
 * Antes el piso eran 18 tiles de piedra de Polyfork. Se cambiaron por la losa
 * dibujada por tres razones:
 *   1. La losa ya trae la lectura de "piedra tallada" (bloques, grietas,
 *      musgo). Repetirla con geometria era decorar dos veces lo mismo.
 *   2. El circulo runico y las venas son el CENTRO visual del juego y no se
 *      pueden modelar con un tile que se repite.
 *   3. El relieve no se pierde: se saca de la propia imagen con un NORMAL MAP
 *      procedural (`createNormalMapCanvas`), asi que las grietas siguen
 *      respondiendo a la luz sin un solo triangulo de mas.
 * Lo que si se conserva en 3D es la vegetacion: un hongo modelado se ve desde
 * cualquier angulo, una calcomania no.
 *
 * TODO SALE EN TRES DRAW CALLS
 * ----------------------------
 * Bloque (costados), losa (cara superior) y vegetacion. La vegetacion son ~20
 * instancias de 4 assets de Polyfork que comparten EXACTAMENTE el mismo
 * material (`vertexColors: true, flatShading: true`) y todos son geometria
 * no-indexada con los mismos atributos (position, color, normal). Eso permite
 * fusionarlas en UNA geometria con UN material.
 *
 * POR QUE EL FONDO ES LO QUE IMPORTA
 * ----------------------------------
 * El encuadre de la camara lo fija `CameraRig.fit()` a partir de la mano y los
 * jokers, no de la mesa. En la practica eso deja visible una franja de unos
 * 32 x 17 unidades: la mesa de 90x64 se sale de cuadro y el resto se lo come la
 * niebla. Por eso el suelo no se extiende hasta el borde de la mesa vieja: se
 * extiende hasta donde la niebla todavia deja ver, y los hongos se apiñan en la
 * banda de atras, que es la que si se ve.
 *
 * DETERMINISMO
 * ------------
 * El layout lo decide un `mulberry32` LOCAL con semilla fija. Nunca toca el RNG
 * del motor: si lo hiciera, sembrar una partida daria una arena distinta y se
 * rompe la reproducibilidad. Ademas, con semilla fija la arena es la misma en
 * cada arranque, que es lo que uno espera de un escenario.
 */

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

import { createNormalMapCanvas } from './CardTexture';
import { createAsset as createClusterA } from './polyfork/mushroom-cluster-f2e3ba';
import { createAsset as createCap } from './polyfork/mushroom-679e55';
import { createAsset as createPolyp } from './polyfork/ricordea-mushroom-polyp-6d8178';
import { createAsset as createClusterB } from './polyfork/mushroom-cluster-18dc1d';

// ---------------------------------------------------------------------------
// La plataforma
// ---------------------------------------------------------------------------

/**
 * LA ARENA ES UNA PLATAFORMA, NO UN PISO PLANO.
 *
 * El suelo es la cara SUPERIOR de un bloque que emerge del agua (el "cubo" de
 * la referencia, tematizado): los costados se ven por encima de la linea de
 * agua y el agua lo rodea. Por eso la losa cubre exactamente la plataforma:
 * fuera de aca no hay piso, hay agua.
 *
 * x de -12 a 12 y z de -6 a 6: las cartas llegan a x = +-11.6 (los montones
 * viven en +-10.5) y a z de -4.5 a 4.5, asi que sobra margen. La vegetacion se
 * planta en el borde de atras de la plataforma.
 *
 * La losa es 2:1 (24 x 12), que es EXACTAMENTE la proporcion de `art_arena`:
 * asi el circulo runico entra sin recorte ni deformacion.
 */
export const PLATFORM_HALF_X = 12;
export const PLATFORM_HALF_Z = 6;
/** Cuanto baja el bloque. El agua entra a `WATER_Y`, asi que se ve el costado. */
export const PLATFORM_DEPTH = 2.6;
/** Altura del agua respecto de la cara superior de la plataforma. */
export const WATER_Y = -1.3;

/** Pendiente del normal map de la losa. Mas alto que una carta: el piso se ve de lejos y en escorzo. */
const FLOOR_RELIEF = 2.4;
/** Ancho del normal map de la losa, en px. Ver `createNormalMapCanvas`. */
const FLOOR_NORMAL_WIDTH = 512;
/** Color de la losa si el arte no carga: la escena no puede quedar blanca. */
const FLOOR_FALLBACK_COLOR = 0x5d6357;
/**
 * Cuanto emiten las venas de micelio. El mapa de emision es la PROPIA imagen,
 * asi que el brillo sigue a la luminancia: la piedra oscura casi no emite y las
 * venas cian/violeta si.
 *
 * MEDIDO, no elegido a ojo: con 0.5 la losa quedaba mas brillante que las
 * cartas y el piso se comia al abanico de la mano —el ojo iba al decorado y no
 * al juego—. A 0.3 las venas siguen encendidas pero el piso se lee como fondo.
 */
const FLOOR_EMISSIVE = 0.3;
/**
 * Tinte de la losa. No es blanco puro: el arte viene calibrado para verse como
 * una ilustracion, y a pantalla completa eso es un piso de piedra DEMASIADO
 * claro para que encima descansen cartas oscuras. Bajarlo un 12% devuelve el
 * contraste sin apagar las venas (que van por emision, no por color).
 */
const FLOOR_TINT = 0xe0e4e0;

// ---------------------------------------------------------------------------
// Vegetacion
// ---------------------------------------------------------------------------

interface Species {
  readonly piece: PropPiece;
  /** Alto objetivo en el borde del sendero, en unidades del mundo. */
  readonly height: number;
  /** Peso relativo al repartir especies. */
  readonly weight: number;
}

/**
 * DONDE PUEDE IR UN HONGO SIN QUE NADIE LO TAPE
 * ---------------------------------------------
 * Sembrarlos por toda la grilla suena mejor de lo que se ve, y esto no es una
 * opinion: proyectando la camara real sobre el piso, el cuadro deja libres dos
 * franjas nada mas.
 *
 *   1. VERTICAL. El borde superior del cuadro toca el piso en z ~ -7 (en 2.16)
 *      a z ~ -11 (en 1.33). Un hongo de 2 unidades plantado en z=-6 ya asoma
 *      cortado por arriba. Por eso el fondo util arranca en z ~ -5.
 *   2. HORIZONTAL. La barra de progreso es HTML y ocupa el centro de la franja
 *      de arriba (~53% del ancho, 20% del alto). Un hongo debajo de ella
 *      directamente no se ve.
 *
 * Las dos cosas juntas dejan DOS VENTANAS, a los costados de la barra: de
 * |x| = 10 a 15, de z = -5.2 a -2.6. Ahi es donde se planta, y ahi es donde el
 * hongo se ve entero. Los numeros salen de `CameraRig.fit()` con la camara
 * real, no de mirar una captura.
 *
 * El alto va escalado < 1 por el punto 1: mas alto que esto y el hongo se lee
 * como un recorte, no como un hongo.
 */
// Anotados como `number` a proposito: si alguien los baja a 1, el reparto
// uniforme de mas abajo tiene que seguir dividiendo bien.
const SIDE_HEDGE: number = 5;
const CORNER_HEDGE: number = 2;
/** La ventana util: ni tan al medio (barra) ni tan al borde (recorte). */
const WINDOW_MIN_X = 8.2;
const WINDOW_MAX_X = 11.4;
const WINDOW_BACK_Z = -5.4;
const WINDOW_FRONT_Z = -2.8;
/** Dispersion dentro de la ventana, en unidades. */
const HEDGE_JITTER = 0.9;
/** Alto del seto como fraccion del alto de la especie. Ver el punto 1 de arriba. */
const SIDE_HEDGE_SCALE = 0.72;
/** Los racimos de las esquinas estan pegados al borde: mas bajos todavia. */
const CORNER_HEDGE_SCALE = 0.55;

// ---------------------------------------------------------------------------
// Brillo
// ---------------------------------------------------------------------------

/**
 * Dos de los hongos del catalogo son bioluminiscentes (`has_night`), asi que un
 * poco de emision les cae bien y ademas los despega del fondo en el tier `low`,
 * donde no hay IBL. Se mantiene BAJA: la emision es uniforme y con intensidad
 * alta se come el sombreado de las caras y los hongos quedan como calcomanias.
 */
const GLOW_COLOR = 0x2f8f74;
/** Brillo sin IBL (tier `low`): el que compensa que no haya ambiente. */
export const ARENA_GLOW_BASE = 0.32;
/** Con `environment` la escena se levanta, asi que el glow sube con ella. */
export const ARENA_GLOW_ENVIRONMENT = 0.46;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** PRNG local. Nunca se usa el del motor: ver la nota de determinismo. */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface PropPiece {
  /** Una geometria por mesh del asset, con su transformada local ya cocida. */
  readonly geometries: readonly THREE.BufferGeometry[];
  /** Ancho del asset tal cual viene, para escalarlo al alto objetivo. */
  readonly width: number;
  readonly height: number;
}

/**
 * `createAsset()` devuelve un `Group` que puede tener varios meshes anidados
 * (tres de los hongos tienen 2 o 4). Se aplana a una lista de geometrias con la
 * matriz de cada mesh ya aplicada, que es lo unico que hace falta para fusionar.
 */
function extractPiece(create: () => THREE.Object3D): PropPiece {
  const root = create();
  root.updateMatrixWorld(true);

  const geometries: THREE.BufferGeometry[] = [];
  const bounds = new THREE.Box3();

  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    const geometry = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld);
    geometry.computeBoundingBox();
    if (geometry.boundingBox) bounds.union(geometry.boundingBox);
    geometries.push(geometry);
  });

  const size = bounds.getSize(new THREE.Vector3());
  return { geometries, width: size.x, height: size.y };
}

/** Elemento aleatorio de una lista no vacia, sin tropezar con `noUncheckedIndexedAccess`. */
function pickWeighted(species: readonly Species[], roll: number): Species {
  let total = 0;
  for (const entry of species) total += entry.weight;

  let cursor = roll * total;
  for (const entry of species) {
    cursor -= entry.weight;
    if (cursor <= 0) return entry;
  }
  const last = species[species.length - 1];
  if (!last) throw new Error('[Arena] no hay especies de vegetacion');
  return last;
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

export interface ArenaStats {
  /** 1 si la losa runica se aplico; 0 si el arte falto y quedo la piedra lisa. */
  readonly floor: number;
  readonly flora: number;
  readonly triangles: number;
  readonly drawCalls: number;
}

export interface Arena {
  readonly group: THREE.Group;
  /** Geometrias, materiales y texturas, para que `SceneManager` los libere. */
  readonly disposables: readonly (THREE.BufferGeometry | THREE.Material | THREE.Texture)[];
  readonly stats: ArenaStats;
  /** Intensidad del brillo de los hongos. La mueve `syncEnvironment` por tier. */
  setGlow(intensity: number): void;
  /**
   * Aplica la losa runica a la cara superior. Se llama UNA vez, con el arte ya
   * cargado; sin argumento la plataforma queda en piedra lisa y el juego sigue
   * jugable. No esta en el constructor para que `Arena` no dependa de
   * `ArtAssets` (el modulo se puede probar sin navegador ni manifiesto).
   */
  applyFloorArt(art?: HTMLImageElement): void;
  /**
   * Tapete cosmético (R4b). `art` presente => muestra el fieltro sobre la losa;
   * `undefined` => lo oculta y queda la losa rúnica (comportamiento de fábrica).
   * Es un OVERLAY, no toca la losa rúnica: el fieltro puede cambiarse en caliente
   * sin reconstruir el suelo.
   */
  setFelt(art?: HTMLImageElement): void;
}

/**
 * Arma la arena completa. Con semilla fija el resultado es siempre el mismo.
 */
export function buildArena(seed = 0x5eed1a7e): Arena {
  const random = mulberry32(seed);

  // Las especies se arman aca porque necesitan las piezas ya construidas.
  //
  // Los hongos de Polyfork miden entre 4 cm y 39 cm de verdad: a escala real
  // serian invisibles al lado de una carta de 3.2 unidades. Cada especie se
  // escala a un ALTO OBJETIVO en unidades del mundo (no a un factor fijo), asi
  // el tamaño en pantalla no depende de cuan grande lo modelo el catalogo.
  const species: readonly Species[] = [
    { piece: extractPiece(createClusterB), height: 3.2, weight: 2 },
    { piece: extractPiece(createClusterA), height: 2.6, weight: 3 },
    { piece: extractPiece(createCap), height: 1.7, weight: 3 },
    { piece: extractPiece(createPolyp), height: 1.2, weight: 2 },
  ];

  const flora: THREE.BufferGeometry[] = [];
  let floraCount = 0;

  // --- Setos de vegetacion (ver la nota de arriba) ---

  // Un seto por ventana, repartido en profundidad.
  for (const side of [-1, 1]) {
    for (let i = 0; i < SIDE_HEDGE; i += 1) {
      const t = SIDE_HEDGE === 1 ? 0.5 : i / (SIDE_HEDGE - 1);
      const x = side * (WINDOW_MIN_X + random() * (WINDOW_MAX_X - WINDOW_MIN_X));
      const z =
        WINDOW_BACK_Z + t * (WINDOW_FRONT_Z - WINDOW_BACK_Z) + (random() - 0.5) * HEDGE_JITTER;
      floraCount += plant(flora, species, random, x, z, SIDE_HEDGE_SCALE);
    }
  }

  // Racimos de esquina: pegados al borde superior, donde el cuadro todavia
  // corta. Van bajos a proposito, para que se lean como fondo y no como un
  // hongo partido al medio.
  for (const side of [-1, 1]) {
    for (let i = 0; i < CORNER_HEDGE; i += 1) {
      const x = side * (11.4 + random() * 2.0);
      const z = WINDOW_BACK_Z - 0.1 - random() * 0.5;
      floraCount += plant(flora, species, random, x, z, CORNER_HEDGE_SCALE);
    }
  }

  const floraGeometry = flora.length > 0 ? mergeGeometries(flora) : null;
  if (flora.length > 0 && !floraGeometry) throw new Error('[Arena] no se pudo fusionar la vegetacion');

  // Las piezas originales ya dieron sus clones: liberarlas ahora evita dejar
  // ~5 geometrias colgadas por cada arranque de escena.
  for (const piece of species.map((s) => s.piece)) {
    for (const geometry of piece.geometries) geometry.dispose();
  }

  const floraMaterial = new THREE.MeshStandardMaterial({
    vertexColors: true,
    flatShading: true,
    roughness: 0.85,
    metalness: 0,
    emissive: new THREE.Color(GLOW_COLOR),
    emissiveIntensity: ARENA_GLOW_BASE,
  });

  const group = new THREE.Group();
  group.name = 'arena';

  // EL BLOQUE: los costados que emergen del agua. La cara superior queda a y=0
  // —el piso del mundo— y la tapa la losa, que va 1 cm mas arriba para no
  // pelear en profundidad contra la cara del bloque.
  const platformGeometry = new THREE.BoxGeometry(
    PLATFORM_HALF_X * 2,
    PLATFORM_DEPTH,
    PLATFORM_HALF_Z * 2,
  );
  const platformMaterial = new THREE.MeshStandardMaterial({
    // Piedra del mismo tono que la losa: el bloque y la tapa tienen que leerse
    // como una sola pieza tallada, no como una tapa apoyada sobre una caja.
    color: 0x3b434c,
    roughness: 0.95,
    metalness: 0,
    flatShading: true,
  });
  const platformMesh = new THREE.Mesh(platformGeometry, platformMaterial);
  platformMesh.name = 'arena-platform';
  platformMesh.position.set(0, -PLATFORM_DEPTH / 2, 0);
  group.add(platformMesh);

  // LA LOSA: la cara superior. Plano aparte y no una cara del bloque porque
  // `BoxGeometry` con un array de materiales se dibuja en SEIS draw calls (una
  // por grupo), y asi son dos.
  const floorGeometry = new THREE.PlaneGeometry(PLATFORM_HALF_X * 2, PLATFORM_HALF_Z * 2);
  floorGeometry.rotateX(-Math.PI / 2);
  floorGeometry.translate(0, 0.01, 0);
  const floorMaterial = new THREE.MeshStandardMaterial({
    color: FLOOR_FALLBACK_COLOR,
    roughness: 0.92,
    metalness: 0,
  });
  const floorMesh = new THREE.Mesh(floorGeometry, floorMaterial);
  floorMesh.name = 'arena-floor';
  group.add(floorMesh);

  // EL TAPETE: overlay cosmético sobre la losa rúnica (R4b). Vive 1 cm por
  // encima para no pelear en profundidad con la losa, y es MÁS CHICO que la
  // plataforma (deja un borde de piedra rúnica a la vista). Arranca oculto: la
  // fábrica no usa fieltro; se enciende solo al equipar uno.
  const feltGeometry = new THREE.PlaneGeometry(PLATFORM_HALF_X * 2 - 2.2, PLATFORM_HALF_Z * 2 - 1.4);
  feltGeometry.rotateX(-Math.PI / 2);
  feltGeometry.translate(0, 0.02, 0);
  const feltMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.95,
    metalness: 0,
  });
  const feltMesh = new THREE.Mesh(feltGeometry, feltMaterial);
  feltMesh.name = 'arena-felt';
  feltMesh.visible = false;
  group.add(feltMesh);

  const disposables: (THREE.BufferGeometry | THREE.Material | THREE.Texture)[] = [
    floorGeometry,
    floorMaterial,
    platformGeometry,
    platformMaterial,
    floraMaterial,
    feltGeometry,
    feltMaterial,
  ];

  if (floraGeometry) {
    const floraMesh = new THREE.Mesh(floraGeometry, floraMaterial);
    floraMesh.name = 'arena-flora';
    group.add(floraMesh);
    disposables.push(floraGeometry);
  }

  const triangles =
    floorGeometry.attributes['position']!.count / 3 +
    (floraGeometry ? floraGeometry.attributes['position']!.count / 3 : 0);

  let floorApplied = 0;

  return {
    group,
    disposables,
    stats: {
      get floor(): number {
        return floorApplied;
      },
      flora: floraCount,
      triangles,
      drawCalls: group.children.length,
    },
    setGlow(intensity: number): void {
      floraMaterial.emissiveIntensity = intensity;
    },
    applyFloorArt(art?: HTMLImageElement): void {
      if (!art || art.naturalWidth === 0) return;

      // `THREE.Texture` sobre la imagen ya decodificada, no un `CanvasTexture`:
      // copiar 1024x512 a un canvas son 2 MB de RAM que se quedan vivos mientras
      // viva la textura, y una pasada de `drawImage` al pedo.
      const map = new THREE.Texture(art);
      map.needsUpdate = true;
      map.colorSpace = THREE.SRGBColorSpace;
      map.anisotropy = 8;

      // El relieve sale de la PROPIA imagen (Sobel sobre la luminancia): las
      // grietas y el borde de los bloques responden a la luz sin geometria.
      const normal = new THREE.CanvasTexture(
        createNormalMapCanvas(art, FLOOR_RELIEF, FLOOR_NORMAL_WIDTH),
      );
      // Un normal map no es color: con sRGB la iluminacion sale mal.
      normal.colorSpace = THREE.NoColorSpace;
      normal.anisotropy = 4;

      floorMaterial.map = map;
      floorMaterial.normalMap = normal;
      // La imagen tambien es el mapa de EMISION: el brillo sigue a la
      // luminancia, asi que la piedra oscura casi no emite y las venas de
      // micelio si. Es lo que hace que la losa se vea encendida y no pintada.
      floorMaterial.emissiveMap = map;
      floorMaterial.emissive = new THREE.Color(0xffffff);
      floorMaterial.emissiveIntensity = FLOOR_EMISSIVE;
      // Sin esto el mapa se multiplica por el gris de respaldo y la losa sale
      // apagada; con blanco, el color lo pone el arte.
      floorMaterial.color = new THREE.Color(FLOOR_TINT);
      floorMaterial.needsUpdate = true;

      disposables.push(map, normal);
      floorApplied = 1;
    },
    setFelt(art?: HTMLImageElement): void {
      if (!art || art.naturalWidth === 0) {
        feltMesh.visible = false;
        return;
      }
      // TEXTURA propia del fieltro (igual que la losa: `THREE.Texture` sobre la
      // imagen ya decodificada, sin copiar a canvas). Se libera en `dispose`.
      const map = new THREE.Texture(art);
      map.needsUpdate = true;
      map.colorSpace = THREE.SRGBColorSpace;
      map.anisotropy = 8;
      // El fieltro se ilumina solo con el mapa (sin emisión): es un paño, no la
      // losa encendida. El blanco deja que el arte ponga el color.
      feltMaterial.map = map;
      feltMaterial.color = new THREE.Color(0xffffff);
      feltMaterial.needsUpdate = true;
      disposables.push(map);
      feltMesh.visible = true;
    },
  };
}

/**
 * Planta una mata del seto en (x, z). Devuelve 1 para poder sumarlo al contador
 * sin repetir la cuenta en cada llamador.
 */
function plant(
  out: THREE.BufferGeometry[],
  species: readonly Species[],
  random: () => number,
  x: number,
  z: number,
  heightScale: number,
): number {
  const chosen = pickWeighted(species, random());
  // Jitter de alto: sin esto, dos matas del mismo asset se leen como un
  // copiar-y-pegar.
  const height = chosen.height * heightScale * (0.82 + random() * 0.4);
  const scale = height / chosen.piece.height;

  const matrix = new THREE.Matrix4()
    .makeRotationY(random() * Math.PI * 2)
    .multiply(new THREE.Matrix4().makeScale(scale, scale, scale));
  matrix.setPosition(x, 0, z);

  for (const geometry of chosen.piece.geometries) {
    out.push(geometry.clone().applyMatrix4(matrix));
  }
  return 1;
}
