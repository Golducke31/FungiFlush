/**
 * Interaction.ts — Raton / tactil sobre las cartas (THREE.Raycaster).
 *
 * El raycaster corre contra una lista PLANA de meshes (no contra la escena
 * entera): con 40 cartas y particulas, intersectar el grafo completo cada
 * frame es tirar FPS a la basura.
 *
 * DOS GESTOS, UN SOLO CAMINO
 * --------------------------
 *   - TAP   : el puntero se movio <= 6 px y solto en < 700 ms -> click.
 *   - DRAG  : el puntero se movio > 10 px -> la carta sigue al dedo.
 *
 * Los dos umbrales estan separados A PROPOSITO (6 < 10): un tap nunca puede
 * iniciar un arrastre, asi que el tap-to-select de movil queda intacto. Un
 * movimiento de 7 px no es ni tap ni drag, igual que antes de esta fase.
 *
 * `passive: true` se mantiene en los listeners: el canvas ya declara
 * `touch-action: none`, asi que no hace falta `preventDefault` para que el
 * navegador no se lleve el gesto. Los gestos de la pagina no se rompen.
 */

import * as THREE from 'three';
import type { Card3D } from './Card3D';
import { resolveDropZone, type DropZoneHandle } from './DropZone';

/** Movimiento maximo (px) para considerar un toque como click. */
const CLICK_SLOP_PX = 6;
/** Movimiento (px) que dispara el arrastre. Mayor que el slop: ver arriba. */
const DRAG_START_PX = 10;
/** Duracion maxima (ms) de un tap. */
const CLICK_MAX_MS = 700;
/**
 * Cuanto hay que MANTENER el dedo quieto para que salga la etiqueta.
 *
 * En tactil el hover no existe (ver `handleDown`), asi que esta es la unica via
 * para leer la habilidad de una carta. 380ms es lo bastante largo para no
 * dispararse en un tap normal (<700ms pero con movimiento) y lo bastante corto
 * para no sentirse lento.
 */
const LONG_PRESS_MS = 380;
/** Altura del plano imaginario sobre el que se proyecta el dedo al arrastrar. */
export const DRAG_PLANE_Y = 0.95;

const DRAG_PLANE = new THREE.Plane(new THREE.Vector3(0, 1, 0), -DRAG_PLANE_Y);
const PLANE_HIT = new THREE.Vector3();

export interface InteractionCallbacks {
  onHover: (card: Card3D | null) => void;
  onClick: (card: Card3D) => void;
  /**
   * El dedo se mantuvo quieto sobre una carta. Es la via TACTIL del tooltip:
   * sin esto, en movil no habia forma de leer la habilidad (el hover necesita
   * `pointermove`, que no ocurre si el dedo no se mueve).
   */
  onLongPress?: (card: Card3D) => void;
  onPointerMove?: (ndc: THREE.Vector2) => void;
  /** Empieza el arrastre (ya se superaron los 10 px). */
  onDragStart?: (card: Card3D) => void;
  /** El dedo se movio: `point` esta sobre el plano de arrastre. */
  onDrag?: (card: Card3D, point: THREE.Vector3, zone: DropZoneHandle | null) => void;
  /** Se solto. `zone` es null si cayo fuera de toda zona. */
  onDrop?: (card: Card3D, zone: DropZoneHandle | null, point: THREE.Vector3) => void;
  /** El gesto se aborto (cancelacion del sistema, perdida de foco...). */
  onDragCancel?: (card: Card3D) => void;
  /**
   * Un TAP no cayo sobre ninguna carta: `point` es su posicion sobre la MESA
   * (plano y=0), no sobre el plano de arrastre. Es lo que permite tocar la pila
   * de descarte sin arrastrar (alternativa al drag).
   */
  onTapEmpty?: (point: THREE.Vector3) => void;
}

export class Interaction {
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2();
  private targets: THREE.Object3D[] = [];
  private dropZones: readonly DropZoneHandle[] = [];

  private downX = 0;
  private downY = 0;
  private downTime = 0;
  private pointerInside = false;
  private lastHoverUid: string | null = null;

  /** Timer del long-press pendiente, o null. */
  private longPressTimer: number | null = null;
  /** El long-press YA disparo: el `pointerup` no debe contar como click. */
  private longPressFired = false;

  /** Carta bajo el puntero al bajar: el candidato a arrastre. */
  private candidate: Card3D | null = null;
  private pointerId: number | null = null;
  private dragActive = false;

  constructor(
    private readonly element: HTMLElement,
    private readonly callbacks: InteractionCallbacks,
  ) {
    element.addEventListener('pointermove', this.handleMove, { passive: true });
    element.addEventListener('pointerdown', this.handleDown, { passive: true });
    element.addEventListener('pointerup', this.handleUp, { passive: true });
    element.addEventListener('pointercancel', this.handleCancel, { passive: true });
    element.addEventListener('pointerleave', this.handleLeave, { passive: true });
  }

  setTargets(targets: THREE.Object3D[]): void {
    this.targets = targets;
  }

  setDropZones(zones: readonly DropZoneHandle[]): void {
    this.dropZones = zones;
  }

  /**
   * Aborta el arrastre en curso. Lo usa el SceneManager cuando el motor saca
   * la carta de la mano a mitad de gesto.
   */
  cancelDrag(): void {
    const card = this.dragActive ? this.candidate : null;
    this.endDrag();
    if (card) this.callbacks.onDragCancel?.(card);
  }

  dispose(): void {
    this.cancelLongPress();
    this.element.removeEventListener('pointermove', this.handleMove);
    this.element.removeEventListener('pointerdown', this.handleDown);
    this.element.removeEventListener('pointerup', this.handleUp);
    this.element.removeEventListener('pointercancel', this.handleCancel);
    this.element.removeEventListener('pointerleave', this.handleLeave);
  }

  // -------------------------------------------------------------------------

  private readonly handleMove = (event: PointerEvent): void => {
    this.updatePointer(event);
    this.pointerInside = true;
    this.callbacks.onPointerMove?.(this.pointer.clone());

    if (this.candidate && !this.dragActive) {
      const dx = event.clientX - this.downX;
      const dy = event.clientY - this.downY;
      const moved = Math.hypot(dx, dy);
      // Un TEMBLOR del dedo no cancela el long-press: en tactil llegan
      // `pointermove` aunque el jugador quiera quedarse quieto. Solo lo cancela
      // un movimiento deliberado (> CLICK_SLOP_PX).
      if (moved > CLICK_SLOP_PX) this.cancelLongPress();
      if (moved > DRAG_START_PX) {
        this.dragActive = true;
        // Mientras se arrastra no hay hover: la carta ya esta "en la mano", y
        // un halo de hover encima solo confundiria.
        if (this.lastHoverUid !== null) {
          this.lastHoverUid = null;
          this.callbacks.onHover(null);
        }
        this.callbacks.onDragStart?.(this.candidate);
      }
    }

    if (this.dragActive && this.candidate) {
      const point = this.pointerOnPlane();
      if (point) {
        const zone = resolveDropZone(this.dropZones, point.x, point.z, this.candidate);
        this.callbacks.onDrag?.(this.candidate, point, zone);
      }
      return;
    }

    this.emitHover();
  };

  private readonly handleDown = (event: PointerEvent): void => {
    this.updatePointer(event);
    this.downX = event.clientX;
    this.downY = event.clientY;
    this.downTime = performance.now();
    this.pointerId = event.pointerId;
    this.dragActive = false;
    this.longPressFired = false;

    // El candidato se elige al BAJAR: si el gesto termina en arrastre ya
    // sabemos que carta se mueve. Si termina en tap, este pick se descarta y
    // el `pick()` del pointerup manda.
    this.candidate = this.pick();
    if (!this.candidate) return;

    // LONG-PRESS: la via TACTIL del tooltip. El hover se dispara desde
    // `pointermove` (ver `emitHover`), asi que si el dedo no se mueve NUNCA
    // llega: por eso "a veces no se mostraba la etiqueta". El timer cubre ese
    // caso y convive con el hover (raton) sin reemplazarlo.
    this.cancelLongPress();
    const pressed = this.candidate;
    this.longPressTimer = window.setTimeout(() => {
      this.longPressTimer = null;
      // Si mientras tanto empezo un arrastre (o cambio el candidato), no va.
      if (this.dragActive || this.candidate !== pressed) return;
      this.longPressFired = true;
      this.callbacks.onLongPress?.(pressed);
    }, LONG_PRESS_MS);

    // Captura del puntero: el arrastre sigue funcionando aunque el dedo se
    // salga del canvas. Se toma solo cuando hay una carta debajo, para no
    // secuestrar gestos sobre el resto de la pantalla.
    try {
      this.element.setPointerCapture(event.pointerId);
    } catch {
      /* algunos navegadores la rechazan si el puntero ya no esta activo */
    }
  };

  private readonly handleUp = (event: PointerEvent): void => {
    this.pointerInside = true;
    this.cancelLongPress();

    // Un long-press NO selecciona: el jugador mantuvo el dedo para LEER la
    // etiqueta. Se oculta el tooltip y se corta el gesto aca.
    if (this.longPressFired) {
      this.longPressFired = false;
      this.endDrag();
      this.callbacks.onHover(null);
      return;
    }

    if (this.dragActive && this.candidate) {
      const card = this.candidate;
      this.updatePointer(event);
      const point = this.pointerOnPlane();
      const zone = point ? resolveDropZone(this.dropZones, point.x, point.z, card) : null;
      this.endDrag();
      this.callbacks.onDrop?.(card, zone, point ?? card.worldPosition());
      return;
    }

    const moved = Math.hypot(event.clientX - this.downX, event.clientY - this.downY);
    const elapsed = performance.now() - this.downTime;

    this.endDrag();

    // Click = poco movimiento y rapido. Un arrastre no selecciona cartas.
    if (moved > CLICK_SLOP_PX || elapsed > CLICK_MAX_MS) return;

    this.updatePointer(event);
    const hit = this.pick();
    if (!hit) {
      // Tap al VACIO: la mesa tambien reacciona (pila de descarte). Se proyecta
      // sobre el plano de la MESA (y=0), no el de arrastre (y=0.95): la zona de
      // descarte vive en coordenadas de mesa y con la perspectiva quedaria
      // corrida unos centimetros.
      const point = this.pointerOnPlane(0);
      if (point) this.callbacks.onTapEmpty?.(point);
      return;
    }

    this.callbacks.onClick(hit);
  };

  private readonly handleCancel = (): void => {
    const card = this.dragActive ? this.candidate : null;
    this.cancelLongPress();
    this.longPressFired = false;
    this.endDrag();
    if (card) this.callbacks.onDragCancel?.(card);
  };

  private readonly handleLeave = (): void => {
    this.pointerInside = false;
    this.cancelLongPress();
    this.longPressFired = false;
    if (this.lastHoverUid !== null) {
      this.lastHoverUid = null;
      this.callbacks.onHover(null);
    }
  };

  // -------------------------------------------------------------------------

  /**
   * Cancela el long-press pendiente. Se llama en TODOS los caminos que no sean
   * "el dedo sigue quieto sobre la misma carta": soltar, moverse, cancelar el
   * gesto, salir del canvas y `dispose`.
   */
  private cancelLongPress(): void {
    if (this.longPressTimer !== null) {
      window.clearTimeout(this.longPressTimer);
      this.longPressTimer = null;
    }
  }

  private endDrag(): void {
    if (this.pointerId !== null) {
      try {
        this.element.releasePointerCapture(this.pointerId);
      } catch {
        /* ya liberada */
      }
    }
    this.pointerId = null;
    this.candidate = null;
    this.dragActive = false;
  }

  private updatePointer(event: PointerEvent): void {
    const rect = this.element.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  }

  /** Devuelve la Card3D bajo el puntero, o null. */
  pick(camera?: THREE.Camera): Card3D | null {
    if (this.targets.length === 0) return null;
    const cam = camera ?? this.camera;
    if (!cam) return null;

    this.raycaster.setFromCamera(this.pointer, cam);
    const hits = this.raycaster.intersectObjects(this.targets, false);
    const first = hits[0];
    if (!first) return null;
    return (first.object.userData['card3d'] as Card3D | undefined) ?? null;
  }

  /**
   * Proyecta el puntero sobre un plano horizontal.
   *
   * El arrastre NO usa la posicion de la carta bajo el dedo (que se va con la
   * perspectiva): proyecta sobre un plano a altura fija y de ahi saca X/Z. Asi
   * el desplazamiento del dedo y el de la carta son proporcionales.
   */
  pointerOnPlane(planeY = DRAG_PLANE_Y): THREE.Vector3 | null {
    const cam = this.camera;
    if (!cam) return null;
    this.raycaster.setFromCamera(this.pointer, cam);

    const plane =
      planeY === DRAG_PLANE_Y ? DRAG_PLANE : new THREE.Plane(new THREE.Vector3(0, 1, 0), -planeY);

    if (!this.raycaster.ray.intersectPlane(plane, PLANE_HIT)) return null;
    return PLANE_HIT.clone();
  }

  private emitHover(): void {
    if (!this.pointerInside) return;
    const hit = this.pick();
    const uid = hit?.uid ?? null;
    if (uid === this.lastHoverUid) return;
    this.lastHoverUid = uid;
    this.callbacks.onHover(hit);
  }

  /** La camara se inyecta para evitar una dependencia circular con el rig. */
  private camera: THREE.Camera | null = null;

  setCamera(camera: THREE.Camera): void {
    this.camera = camera;
  }

  get pointerNdc(): THREE.Vector2 {
    return this.pointer.clone();
  }
}
