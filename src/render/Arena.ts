/**
 * Arena.ts — La Arena del duelo, armada con los assets de Polyfork.
 *
 * QUE ES ESTO
 * -----------
 * Antes la mesa era UN plano de 90x64 con una foto pegada. Ahora es un diorama
 * de verdad: un suelo de tiles 3D (piedra en la franja de juego, tierra y pasto
 * alrededor) y racimos de hongos 3D en el fondo y los costados.
 *
 * TODO SALE EN DOS DRAW CALLS
 * ---------------------------
 * Los siete assets de Polyfork comparten EXACTAMENTE el mismo material
 * (`vertexColors: true, flatShading: true, roughness: 0.85, metalness: 0`) y
 * todos son geometria no-indexada con los mismos atributos (position, color,
 * normal). Eso permite fusionar las ~56 instancias del suelo en UNA geometria y
 * las ~20 plantas en OTRA, con dos materiales. La arena entera son 2 draw calls,
 * no 76.
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

import { createAsset as createDirtTile } from './polyfork/dirt-ground-tile';
import { createAsset as createGrassTile } from './polyfork/grass-ground-tile';
import { createAsset as createStoneTile } from './polyfork/stone-path-tile';
import { createAsset as createClusterA } from './polyfork/mushroom-cluster-f2e3ba';
import { createAsset as createCap } from './polyfork/mushroom-679e55';
import { createAsset as createPolyp } from './polyfork/ricordea-mushroom-polyp-6d8178';
import { createAsset as createClusterB } from './polyfork/mushroom-cluster-18dc1d';

// ---------------------------------------------------------------------------
// Grilla del suelo
// ---------------------------------------------------------------------------

/**
 * CUANTO SUELO HACE FALTA (esto manda sobre todo lo demas)
 * -------------------------------------------------------
 * El encuadre lo fija `CameraRig.fit()` desde la mano y los jokers, no desde el
 * suelo. Resolviendo el frustum con la camara real (fov 40, ~15.5 de alto,
 * mirando ~58 grados abajo) el piso VISIBLE es de unos 36 x 17 unidades: de
 * x -18 a 18 y de z -8.5 a 8. Nada mas alla de eso se ve, y nada mas aca se
 * necesita: dibujar la mesa vieja de 90x64 era pagar triangulos por pixeles que
 * la camara nunca mira.
 *
 * Por eso la grilla es chica y esta ajustada a esa banda, con una fila/columna
 * extra de margen para que el borde del mundo no entre en cuadro cuando la
 * camara respira.
 */
const TILE = 4;

/** x de -16 a 16 (9 columnas): cubre los 36 de ancho visible con margen. */
const COLUMNS = 9;
const COLUMN_ORIGIN = -16;
/** z de -12 a 8 (6 filas): -12 y 8 son las filas de margen, ya fuera de cuadro. */
const ROWS = 6;
const ROW_ORIGIN = -12;

/**
 * La franja de juego: aca va piedra (lisa, sin matas) porque es donde apoyan
 * las cartas, y las matas del tile de tierra las atravesarian.
 *
 * Cubre x en [-14, 14] y z en [-6, 6]. Las cartas llegan a x=+-11.6 (los
 * montones viven en +-10.5) y a z de -4.5 a 4.5, asi que sobra margen.
 *
 * Todo lo que queda FUERA de esta franja es campo (tierra/pasto/hongos), y cae
 * justo en el borde del cuadro: la fila cz=-8 asoma por arriba y las columnas
 * cx=+-16 por los costados. Eso es lo que se ve del diorama.
 */
const PATH_HALF_X = 12;
const PATH_HALF_Z = 4;

/** Probabilidad de que un tile de campo sea tierra en vez de pasto. */
const DIRT_SHARE = 0.42;

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
const WINDOW_MIN_X = 10;
const WINDOW_MAX_X = 15;
const WINDOW_BACK_Z = -5.2;
const WINDOW_FRONT_Z = -2.6;
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
  /** Ancho del asset tal cual viene, para escalarlo al lado del tile. */
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
  readonly tiles: number;
  readonly flora: number;
  readonly triangles: number;
  readonly drawCalls: number;
}

export interface Arena {
  readonly group: THREE.Group;
  /** Geometrias y materiales, para que `SceneManager` los libere en su dispose. */
  readonly disposables: readonly (THREE.BufferGeometry | THREE.Material)[];
  readonly stats: ArenaStats;
  /** Intensidad del brillo de los hongos. La mueve `syncEnvironment` por tier. */
  setGlow(intensity: number): void;
}

/**
 * Arma la arena completa. Con semilla fija el resultado es siempre el mismo.
 */
export function buildArena(seed = 0x5eed1a7e): Arena {
  const random = mulberry32(seed);

  const dirt = extractPiece(createDirtTile);
  const grass = extractPiece(createGrassTile);
  const stone = extractPiece(createStoneTile);

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

  const ground: THREE.BufferGeometry[] = [];
  const flora: THREE.BufferGeometry[] = [];

  const rotation = new THREE.Matrix4();
  const scaling = new THREE.Matrix4();
  const matrix = new THREE.Matrix4();

  let tiles = 0;
  let floraCount = 0;

  for (let column = 0; column < COLUMNS; column += 1) {
    for (let row = 0; row < ROWS; row += 1) {
      const cx = COLUMN_ORIGIN + column * TILE;
      const cz = ROW_ORIGIN + row * TILE;

      const onPath = Math.abs(cx) <= PATH_HALF_X && Math.abs(cz) <= PATH_HALF_Z;

      // Sendero: piedra lisa y sin matas, porque es donde apoyan las cartas.
      // Campo: tierra o pasto. El random va con cortocircuito para que los tiles
      // de piedra no consuman tiradas y la secuencia siga siendo estable.
      const field = onPath ? stone : random() < DIRT_SHARE ? dirt : grass;
      appendPiece(ground, field, TILE / field.width, cx, cz, random, rotation, scaling, matrix);
      tiles += 1;
    }
  }

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
      const x = side * (12.5 + random() * 3.2);
      const z = WINDOW_BACK_Z - 0.5 - random() * 0.9;
      floraCount += plant(flora, species, random, x, z, CORNER_HEDGE_SCALE);
    }
  }

  const groundGeometry = mergeGeometries(ground);
  if (!groundGeometry) throw new Error('[Arena] no se pudo fusionar el suelo');
  const floraGeometry = flora.length > 0 ? mergeGeometries(flora) : null;
  if (flora.length > 0 && !floraGeometry) throw new Error('[Arena] no se pudo fusionar la vegetacion');

  // Las piezas originales ya dieron sus clones: liberarlas ahora evita dejar
  // ~7 geometrias colgadas por cada arranque de escena.
  for (const piece of [dirt, grass, stone, ...species.map((s) => s.piece)]) {
    for (const geometry of piece.geometries) geometry.dispose();
  }

  const groundMaterial = new THREE.MeshStandardMaterial({
    vertexColors: true,
    flatShading: true,
    roughness: 0.85,
    metalness: 0,
  });

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

  const groundMesh = new THREE.Mesh(groundGeometry, groundMaterial);
  groundMesh.name = 'arena-ground';
  group.add(groundMesh);

  const disposables: (THREE.BufferGeometry | THREE.Material)[] = [
    groundGeometry,
    groundMaterial,
    floraMaterial,
  ];

  if (floraGeometry) {
    const floraMesh = new THREE.Mesh(floraGeometry, floraMaterial);
    floraMesh.name = 'arena-flora';
    group.add(floraMesh);
    disposables.push(floraGeometry);
  }

  const triangles =
    groundGeometry.attributes['position']!.count / 3 +
    (floraGeometry ? floraGeometry.attributes['position']!.count / 3 : 0);

  return {
    group,
    disposables,
    stats: {
      tiles,
      flora: floraCount,
      triangles,
      drawCalls: group.children.length,
    },
    setGlow(intensity: number): void {
      floraMaterial.emissiveIntensity = intensity;
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

/** Coloca una instancia de una pieza en (cx, cz), girada en cuartos de vuelta. */
function appendPiece(
  out: THREE.BufferGeometry[],
  piece: PropPiece,
  scale: number,
  cx: number,
  cz: number,
  random: () => number,
  rotation: THREE.Matrix4,
  scaling: THREE.Matrix4,
  matrix: THREE.Matrix4,
): void {
  // Los tiles son simetricos, pero rotarlos en cuartos de vuelta corta la
  // lectura de "grilla perfecta" que delata el copiar-y-pegar.
  rotation.makeRotationY(Math.floor(random() * 4) * (Math.PI / 2));
  scaling.makeScale(scale, scale, scale);
  matrix.copy(rotation).multiply(scaling).setPosition(cx, 0, cz);

  for (const geometry of piece.geometries) {
    out.push(geometry.clone().applyMatrix4(matrix));
  }
}
