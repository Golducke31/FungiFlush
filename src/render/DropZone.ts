/**
 * DropZone.ts — Zonas de destino del arrastre.
 *
 * Una zona es dos cosas a la vez, y conviene tenerlas separadas:
 *
 *   1. REGLA — un rectangulo sobre el plano XZ de la mesa + "acepta esta
 *      carta?". Esa parte es PURA: no toca Three.js ni el DOM, se testea sin
 *      navegador (`resolveDropZone`).
 *   2. PISTA VISUAL — un plano con un marco que brilla cuando el jugador
 *      empieza a arrastrar. Nunca lleva texto: el idioma no entra aca, y asi
 *      cambiar de idioma no obliga a reconstruir la mesa.
 *
 * `Interaction` solo conoce el contrato `DropZoneHandle`, nunca la clase. Por
 * eso el raycasting se puede testear con zonas de mentira.
 */

import * as THREE from 'three';
import type { Card3D } from './Card3D';

export type DropZoneId = 'play' | 'discard' | 'hand' | 'board';

/** Rectangulo de una zona, en unidades de mundo, sobre la mesa. */
export interface ZoneRect {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

/** Lo minimo que necesita `Interaction`. Sin Three.js en la firma. */
export interface DropZoneHandle {
  readonly id: DropZoneId;
  readonly rect: ZoneRect;
  /** Puede esta carta caer aca AHORA? */
  accepts(card: Card3D): boolean;
  /** `active` = el puntero esta encima de esta zona. */
  highlight(on: boolean, active?: boolean): void;
}

// ---------------------------------------------------------------------------
// Regla (pura)
// ---------------------------------------------------------------------------

export function rectContains(rect: ZoneRect, x: number, z: number): boolean {
  return x >= rect.minX && x <= rect.maxX && z >= rect.minZ && z <= rect.maxZ;
}

/**
 * Primera zona que CONTIENE el punto y ACEPTA la carta.
 *
 * El orden de la lista es la prioridad: las zonas que se superponen (el
 * descarte esta dentro de la banda de la mano) se resuelven por orden, no por
 * cercania. Devolver `null` significa "soltar en el vacio" -> la carta vuelve.
 */
export function resolveDropZone(
  zones: readonly DropZoneHandle[],
  x: number,
  z: number,
  card: Card3D,
): DropZoneHandle | null {
  for (const zone of zones) {
    if (rectContains(zone.rect, x, z) && zone.accepts(card)) return zone;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Pista visual
// ---------------------------------------------------------------------------

const CANVAS_W = 512;
const CANVAS_MIN_H = 96;
const ZONE_Y = 0.03;
const BORDER_PX = 7;

/**
 * Marco de la zona: rectangulo redondeado con esquinas marcadas.
 *
 * Se dibuja en BLANCO y se tinta con `material.color`. Un solo canvas sirve
 * para cualquier color, y cambiar la paleta no obliga a redibujar.
 */
function createZoneCanvas(aspect: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = CANVAS_W;
  canvas.height = Math.max(CANVAS_MIN_H, Math.round(CANVAS_W / Math.max(0.35, aspect)));
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;

  const w = canvas.width;
  const h = canvas.height;
  const pad = BORDER_PX;
  const radius = Math.min(34, h * 0.28);

  const strokeRound = (): void => {
    ctx.beginPath();
    ctx.moveTo(pad + radius, pad);
    ctx.lineTo(w - pad - radius, pad);
    ctx.quadraticCurveTo(w - pad, pad, w - pad, pad + radius);
    ctx.lineTo(w - pad, h - pad - radius);
    ctx.quadraticCurveTo(w - pad, h - pad, w - pad - radius, h - pad);
    ctx.lineTo(pad + radius, h - pad);
    ctx.quadraticCurveTo(pad, h - pad, pad, h - pad - radius);
    ctx.lineTo(pad, pad + radius);
    ctx.quadraticCurveTo(pad, pad, pad + radius, pad);
    ctx.closePath();
  };

  // Relleno tenue: apenas un velo, la mesa tiene que seguir leyendose.
  const fill = ctx.createLinearGradient(0, 0, 0, h);
  fill.addColorStop(0, 'rgba(255,255,255,0.10)');
  fill.addColorStop(1, 'rgba(255,255,255,0.02)');
  ctx.fillStyle = fill;
  strokeRound();
  ctx.fill();

  // Borde con glow.
  ctx.save();
  ctx.shadowColor = 'rgba(255,255,255,0.9)';
  ctx.shadowBlur = 20;
  ctx.strokeStyle = 'rgba(255,255,255,0.85)';
  ctx.lineWidth = BORDER_PX;
  strokeRound();
  ctx.stroke();
  ctx.restore();

  // Esquinas marcadas: leen como "objetivo" sin escribir una palabra.
  const arm = Math.min(h * 0.3, 74);
  ctx.strokeStyle = 'rgba(255,255,255,1)';
  ctx.lineWidth = BORDER_PX * 1.6;
  ctx.lineCap = 'round';
  const corners: Array<[number, number, number, number]> = [
    [pad + radius * 0.7, pad + arm, pad + radius * 0.7, pad],
    [w - pad - radius * 0.7, pad, w - pad - radius * 0.7, pad + arm],
    [pad + radius * 0.7, h - pad - arm, pad + radius * 0.7, h - pad],
    [w - pad - radius * 0.7, h - pad, w - pad - radius * 0.7, h - pad - arm],
  ];
  for (const [x1, y1, x2, y2] of corners) {
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  }

  return canvas;
}

export interface DropZoneOptions {
  id: DropZoneId;
  rect: ZoneRect;
  /** Color del marco (hex numerico). */
  color: number;
  /** Regla de aceptacion. Si no se pasa, acepta cualquier carta. */
  accepts?: (card: Card3D) => boolean;
}

/**
 * Zona de destino dibujada sobre la mesa.
 *
 * `accepts()` esta condicionado a que la zona este ARMADA: mientras no haya un
 * arrastre en curso, ninguna zona resuelve. Asi un drop fantasma (por ejemplo
 * un `pointerup` despues de perder el foco) no puede disparar una accion.
 * Para preguntar por la REGLA sin el armado esta `canAccept()`.
 */
export class DropZone implements DropZoneHandle {
  readonly id: DropZoneId;
  /**
   * Rectangulo de la zona. NO es `readonly`: el descarte se recentra con el
   * perfil de layout (en tactil la pila vive en ±8.5, no en ±10.5), y la zona
   * tiene que caer DONDE EL JUGADOR VE LA PILA. Ver `setRect`.
   */
  rect: ZoneRect;
  readonly group = new THREE.Group();
  readonly mesh: THREE.Mesh;

  private readonly material: THREE.MeshBasicMaterial;
  private readonly texture: THREE.CanvasTexture;
  private readonly geometry: THREE.PlaneGeometry;
  private readonly acceptsFn: (card: Card3D) => boolean;

  private armed = false;
  private target = 0;
  private current = 0;
  private time = 0;

  constructor(options: DropZoneOptions) {
    this.id = options.id;
    this.rect = options.rect;
    this.acceptsFn = options.accepts ?? (() => true);

    const width = options.rect.maxX - options.rect.minX;
    const depth = options.rect.maxZ - options.rect.minZ;

    this.texture = new THREE.CanvasTexture(createZoneCanvas(width / Math.max(0.001, depth)));
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.geometry = new THREE.PlaneGeometry(width, depth);
    this.material = new THREE.MeshBasicMaterial({
      map: this.texture,
      color: options.color,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      // Aditivo: sobre el tapete oscuro esto lee como luz, no como calcomania.
      blending: THREE.AdditiveBlending,
    });

    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.rotation.x = -Math.PI / 2;
    this.mesh.position.set(
      (options.rect.minX + options.rect.maxX) / 2,
      ZONE_Y,
      (options.rect.minZ + options.rect.maxZ) / 2,
    );
    this.group.add(this.mesh);
    this.group.visible = false;
  }

  /** Regla pura, sin importar si la zona esta armada. */
  canAccept(card: Card3D): boolean {
    return this.acceptsFn(card);
  }

  /**
   * Recentra la zona sobre otro rectangulo del MISMO tamano (el layout cambia
   * con el perfil). Solo mueve el marco: la geometria no cambia.
   */
  setRect(rect: ZoneRect): void {
    this.rect = rect;
    this.mesh.position.set(
      (rect.minX + rect.maxX) / 2,
      ZONE_Y,
      (rect.minZ + rect.maxZ) / 2,
    );
  }

  accepts(card: Card3D): boolean {
    return this.armed && this.acceptsFn(card);
  }

  highlight(on: boolean, active = false): void {
    this.armed = on;
    this.target = on ? (active ? 1 : 0.4) : 0;
  }

  /**
   * Brillo TENUE de "aca podes tocar/soltar", cuando NO hay arrastre.
   *
   * A diferencia de `highlight`, NO arma la zona: `accepts()` sigue en false, asi
   * que una pista visual nunca habilita un drop. Es lo que hace descubrible el
   * gesto de toque sobre el descarte sin arrastrar.
   */
  setHint(on: boolean): void {
    if (this.armed) return;
    this.target = on ? 0.25 : 0;
  }

  /** Apaga la zona del todo (fuera de la partida, o en el menu). */
  setEnabled(enabled: boolean): void {
    if (!enabled) {
      this.armed = false;
      this.target = 0;
    }
  }

  update(dt: number, time: number): void {
    this.time = time;
    const k = 1 - Math.exp(-dt * 13);
    this.current += (this.target - this.current) * k;

    const visible = this.current > 0.005;
    this.group.visible = visible;
    if (!visible) return;

    this.material.opacity = this.current;
    // Latido leve cuando la zona esta caliente: se lee como "solta aca".
    const pulse = 1 + this.current * 0.02 + Math.sin(this.time * 6.5) * 0.008 * this.current;
    this.mesh.scale.set(pulse, pulse, 1);
  }

  /** Opacidad actual (0..1). Util para tests y depuracion. */
  get intensity(): number {
    return this.current;
  }

  dispose(): void {
    this.texture.dispose();
    this.geometry.dispose();
    this.material.dispose();
    this.group.clear();
  }
}
