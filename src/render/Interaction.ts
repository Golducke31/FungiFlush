/**
 * Interaction.ts — Raton / tactil sobre las cartas (THREE.Raycaster).
 *
 * El raycaster corre contra una lista PLANANA de meshes (no contra la escena
 * entera): con 40 cartas y particulas, intersectar el grafo completo cada
 * frame es tirar FPS a la basura.
 *
 * Se distingue hover de click con un umbral de movimiento: si el puntero se
 * movio menos de 6 px entre down y up, es un click (no un arrastre).
 */

import * as THREE from 'three';
import type { Card3D } from './Card3D';

const CLICK_SLOP_PX = 6;

export class Interaction {
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2();
  private targets: THREE.Object3D[] = [];

  private downX = 0;
  private downY = 0;
  private downTime = 0;
  private pointerInside = false;
  private lastHoverUid: string | null = null;

  constructor(
    private readonly element: HTMLElement,
    private readonly callbacks: {
      onHover: (card: Card3D | null) => void;
      onClick: (card: Card3D) => void;
      onPointerMove?: (ndc: THREE.Vector2) => void;
    },
  ) {
    element.addEventListener('pointermove', this.handleMove, { passive: true });
    element.addEventListener('pointerdown', this.handleDown, { passive: true });
    element.addEventListener('pointerup', this.handleUp, { passive: true });
    element.addEventListener('pointerleave', this.handleLeave, { passive: true });
  }

  setTargets(targets: THREE.Object3D[]): void {
    this.targets = targets;
  }

  dispose(): void {
    this.element.removeEventListener('pointermove', this.handleMove);
    this.element.removeEventListener('pointerdown', this.handleDown);
    this.element.removeEventListener('pointerup', this.handleUp);
    this.element.removeEventListener('pointerleave', this.handleLeave);
  }

  // -------------------------------------------------------------------------

  private readonly handleMove = (event: PointerEvent): void => {
    this.updatePointer(event);
    this.pointerInside = true;
    this.callbacks.onPointerMove?.(this.pointer.clone());
    this.emitHover();
  };

  private readonly handleDown = (event: PointerEvent): void => {
    this.updatePointer(event);
    this.downX = event.clientX;
    this.downY = event.clientY;
    this.downTime = performance.now();
  };

  private readonly handleUp = (event: PointerEvent): void => {
    const dx = event.clientX - this.downX;
    const dy = event.clientY - this.downY;
    const moved = Math.hypot(dx, dy);
    const elapsed = performance.now() - this.downTime;

    // Click = poco movimiento y rapido. Un arrastre no selecciona cartas.
    if (moved > CLICK_SLOP_PX || elapsed > 700) return;

    this.updatePointer(event);
    const hit = this.pick();
    if (hit) this.callbacks.onClick(hit);
  };

  private readonly handleLeave = (): void => {
    this.pointerInside = false;
    if (this.lastHoverUid !== null) {
      this.lastHoverUid = null;
      this.callbacks.onHover(null);
    }
  };

  // -------------------------------------------------------------------------

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
