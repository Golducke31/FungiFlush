/**
 * Mycelium.ts — Raiz que crece de una carta jugada a la siguiente.
 *
 * Es el hilo conductor del combo: mientras las cartas puntuan una detras de otra,
 * una hifa las va uniendo en el orden del calculo. Viene del prototipo de combo,
 * con dos cambios para encajar en el juego:
 *
 *   1. **`TubeGeometry`, no `Line`.** El `Line` de WebGL tiene 1 px fijo y no se
 *      puede engrosar (limite de la plataforma, no un descuido). Un tubo de radio
 *      chico da el grosor "sutil" que se pidio sin costar casi nada: 24 x 5
 *      segmentos son 240 triangulos por raiz.
 *   2. **Pool de 8.** Una mano larga puede encadenar varias raices, y crear y
 *      destruir geometrias a cada paso genera basura en el peor momento. Los slots
 *      se reutilizan; solo se reconstruye la GEOMETRIA (la curva cambia siempre),
 *      nunca el mesh ni el material.
 *
 * CRECER Y DESVANECER
 * -------------------
 * El crecimiento usa `setDrawRange` sobre el buffer de INDICES: el tubo es
 * indexado y sus indices estan ordenados a lo largo del recorrido, asi que
 * dibujar una fraccion de ellos "hace crecer" la raiz sin regenerar nada.
 *
 * Los dos tweens (crecer 260 ms, desvanecer 500 ms) son `fxTween`, o sea GSAP:
 * el hit-stop los congela junto con todo lo demas. Con `setTimeout` la raiz
 * seguiria creciendo mientras la escena esta congelada.
 */

import * as THREE from 'three';
import * as anim from './anim';

/** Slots simultaneos. Si se piden mas, la raiz se descarta (no asigna). */
const CAPACITY = 8;
/** Segmentos a lo largo de la curva. Mas = mas suave, mas triangulos. */
const TUBULAR = 24;
/** Segmentos alrededor del tubo. 5 ya se ve redondo a este radio. */
const RADIAL = 5;
/**
 * Radio del tubo en unidades de mundo (una carta mide ~2.2 de ancho). Chico a
 * proposito: se pidio "grueso, pero sutil".
 */
const RADIUS = 0.035;
/** Cuanto "cuelga" la curva por debajo del punto medio. */
const SAG = 0.55;
/** Delante de las cartas, para que la raiz no quede tapada por la mesa. */
const LIFT = 0.22;

const GROW_MS = 260;
const FADE_MS = 500;

interface Slot {
  mesh: THREE.Mesh;
  material: THREE.MeshBasicMaterial;
  geometry: THREE.BufferGeometry | null;
  busy: boolean;
}

export class Mycelium {
  /** Se agrega a la escena una vez. */
  readonly group = new THREE.Group();

  private readonly slots: Slot[] = [];
  private disposed = false;

  constructor() {
    // Geometria de arranque vacia: el slot existe desde el principio para que
    // pedir una raiz nunca asigne un mesh nuevo.
    for (let i = 0; i < CAPACITY; i++) {
      const material = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        // Sin luces: es un filamento, se lee por color y no por sombreado.
        depthWrite: false,
      });
      const mesh = new THREE.Mesh(undefined, material);
      mesh.frustumCulled = false;
      mesh.visible = false;
      mesh.renderOrder = 3;
      this.group.add(mesh);
      this.slots.push({ mesh, material, geometry: null, busy: false });
    }
  }

  /**
   * Hace crecer una raiz de `from` a `to`. Devuelve una promesa que resuelve
   * cuando la raiz YA se desvanecio (para poder encadenar si hace falta).
   *
   * Si no hay slot libre, no hace nada y resuelve al toque: una mano larga
   * recorta raices antes que asignar geometria por frame.
   */
  grow(from: THREE.Vector3, to: THREE.Vector3, color: number): Promise<void> {
    const slot = this.slots.find((s) => !s.busy);
    if (!slot || this.disposed) return Promise.resolve();

    slot.busy = true;
    const mid = from.clone().lerp(to, 0.5);
    mid.y -= SAG;
    mid.z += LIFT;

    const curve = new THREE.QuadraticBezierCurve3(from, mid, to);
    const geometry = new THREE.TubeGeometry(curve, TUBULAR, RADIUS, RADIAL, false);
    slot.geometry?.dispose();
    slot.geometry = geometry;
    slot.mesh.geometry = geometry;
    slot.material.color.setHex(color);
    slot.material.opacity = 1;
    slot.mesh.visible = true;

    const total = geometry.index?.count ?? 0;
    geometry.setDrawRange(0, 0);

    const release = () => {
      slot.busy = false;
      slot.mesh.visible = false;
      slot.geometry?.dispose();
      slot.geometry = null;
    };

    // Crecer: se dibuja una fraccion de los indices, en orden a lo largo.
    return anim
      .fxTween(GROW_MS, (p) => {
        geometry.setDrawRange(0, Math.floor(total * p));
      })
      .then(() => anim.fxTween(FADE_MS, (p) => {
        slot.material.opacity = 1 - p;
      }))
      .then(release, release);
  }

  /** Cantidad de raices vivas (para el panel de debug y los tests). */
  get active(): number {
    return this.slots.filter((s) => s.busy).length;
  }

  dispose(): void {
    this.disposed = true;
    for (const slot of this.slots) {
      slot.geometry?.dispose();
      slot.geometry = null;
      slot.material.dispose();
    }
    this.slots.length = 0;
    this.group.clear();
  }
}
