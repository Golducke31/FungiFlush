/**
 * ImpactRings.ts — Anillos de impacto (pool de 8).
 *
 * Cuando una carta aterriza en la zona de juego, o cuando el puntaje cae sobre
 * ella, hace falta un golpe visual que no sea otra particula: un anillo de
 * choque que se ensancha por el suelo y se desvanece.
 *
 * POOL, NO INSTANCIACION
 * ----------------------
 * Crear y destruir un `Mesh` por impacto es la forma mas facil de dar un tiron
 * de garbage collector en el momento menos oportuno (justo cuando el jugador
 * esta mirando el aterrizaje). Aca hay 8 slots fijos que se reciclan: si los 8
 * estan ocupados, el spawn mas viejo se reemplaza. Ocho alcanza porque un
 * aterrizaje dura 0.42 s y nunca se juegan mas de 5 cartas a la vez.
 *
 * UN MATERIAL POR SLOT
 * --------------------
 * `uProgress` y `uOpacity` son por anillo, asi que no se puede compartir un
 * material entre los 8. Lo que SI se comparte es la geometria (un plano
 * unitario) y la textura no existe: el anillo se dibuja EN EL SHADER, asi que
 * no hay nada que bajar de disco.
 *
 * El anillo va APLASTADO contra el suelo (`rotation.x = -PI/2`): la carta
 * aterriza sobre la mesa, y un anillo de pie flotando en el aire no se lee
 * como el golpe de ese aterrizaje.
 */

import * as THREE from 'three';

/** Slots del pool. Mas de 8 impactos simultaneos no ocurren en una mano. */
const POOL_SIZE = 8;
/** Duracion de un anillo, en segundos. */
const DURATION = 0.42;
/** Con reduceMotion el anillo no se ensancha: es un destello, no una onda. */
const DURATION_REDUCED = 0.12;

const RING_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const RING_FRAG = /* glsl */ `
  precision mediump float;
  varying vec2 vUv;
  uniform float uProgress;
  uniform float uOpacity;
  uniform vec3 uColor;

  void main() {
    // Distancia al centro del plano, normalizada a 0..1.
    vec2 p = vUv - 0.5;
    float d = length(p) * 2.0;

    // El radio crece con el progreso y el anillo se ADELGAZA al ensancharse:
    // es lo que hace que se lea como una onda de choque que pierde energia y
    // no como un donut que se agranda.
    float radius = mix(0.18, 0.98, uProgress);
    float width = mix(0.30, 0.045, uProgress);
    float ring = 1.0 - smoothstep(0.0, width, abs(d - radius));

    // Nucleo suave: da cuerpo al centro sin robarle el sitio al anillo.
    float core = 1.0 - smoothstep(0.0, radius * 0.5, d);

    float a = (ring * 0.95 + core * 0.22) * uOpacity;
    if (a < 0.004) discard;
    // El borde del anillo va mas caliente que el centro: sin esto el color
    // queda plano y el anillo no "enciende".
    gl_FragColor = vec4(uColor * (1.0 + ring * 0.7), a);
  }
`;

interface RingSlot {
  readonly mesh: THREE.Mesh;
  readonly material: THREE.ShaderMaterial;
  /** Progreso 0..1 del anillo activo. */
  progress: number;
  active: boolean;
  /** Escala final a la que crece este anillo. */
  reach: number;
}

export class ImpactRings {
  readonly group = new THREE.Group();

  private readonly slots: RingSlot[] = [];
  /** Siguiente slot a usar (round-robin): el mas viejo se recicla primero. */
  private cursor = 0;
  private enabled = true;
  private reduced = false;
  private readonly color = new THREE.Color();

  constructor() {
    const geometry = new THREE.PlaneGeometry(1, 1);
    for (let i = 0; i < POOL_SIZE; i += 1) {
      const material = new THREE.ShaderMaterial({
        vertexShader: RING_VERT,
        fragmentShader: RING_FRAG,
        uniforms: {
          uProgress: { value: 0 },
          uOpacity: { value: 0 },
          uColor: { value: new THREE.Color(0xffffff) },
        },
        transparent: true,
        // Aditivo: el anillo SUMA luz sobre la mesa, que es lo que lo hace
        // leer como energia. Con blending normal se veria como un papel.
        blending: THREE.AdditiveBlending,
        // Sin escribir profundidad: dos anillos que se cruzan no deben
        // taparse entre si, y un anillo no debe tapar la carta que aterriza.
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(geometry, material);
      // Aplastado contra el suelo, como la carta cuando cae.
      mesh.rotation.x = -Math.PI / 2;
      mesh.visible = false;
      mesh.frustumCulled = false;
      this.group.add(mesh);
      this.slots.push({ mesh, material, progress: 0, active: false, reach: 1 });
    }
  }

  /** Gate por tier: en `low` no se crea ningun anillo. */
  setEnabled(value: boolean): void {
    this.enabled = value;
    this.group.visible = value;
    if (!value) {
      for (const slot of this.slots) {
        slot.active = false;
        slot.mesh.visible = false;
      }
    }
  }

  /** Espejo de `reduceMotion`: el anillo pasa a ser un destello corto. */
  setReducedMotion(value: boolean): void {
    this.reduced = value;
  }

  /**
   * Dispara un anillo en `position`.
   *
   * `reach` es la escala final: 1 = del ancho de una carta. Los impactos
   * grandes (combo, ciego) pasan algo mas para que el golpe se sienta grande.
   */
  spawn(position: THREE.Vector3, color: number, reach = 1): void {
    if (!this.enabled) return;

    // `cursor` siempre cae en 0..POOL_SIZE-1 por el modulo, pero el acceso
    // indexado no lo sabe: la guarda ademas cubre el caso de un pool vacio
    // (que no ocurre, pero dejar el tipo honesto evita un `!` que mentiria).
    const slot = this.slots[this.cursor];
    if (!slot) return;
    this.cursor = (this.cursor + 1) % POOL_SIZE;

    // Un poco por encima del suelo: la mesa esta en y = 0 y un coplanar
    // exacto hace z-fighting con su geometria.
    slot.mesh.position.set(position.x, Math.max(position.y, 0) + 0.03, position.z);
    this.color.setHex(color);
    (slot.material.uniforms['uColor'] as { value: THREE.Color }).value.copy(this.color);
    slot.reach = reach;
    slot.progress = 0;
    slot.active = true;
    slot.mesh.visible = true;
    slot.mesh.scale.setScalar(0.55 * reach);
  }

  update(dt: number): void {
    if (!this.enabled) return;
    const duration = this.reduced ? DURATION_REDUCED : DURATION;

    for (const slot of this.slots) {
      if (!slot.active) continue;
      slot.progress += dt / duration;
      if (slot.progress >= 1) {
        slot.active = false;
        slot.mesh.visible = false;
        continue;
      }

      const p = slot.progress;
      // Salida cuadratica: la onda frena al ensancharse.
      const eased = 1 - (1 - p) * (1 - p);
      const from = 0.55;
      const to = this.reduced ? 1.0 : 2.15;
      slot.mesh.scale.setScalar((from + (to - from) * eased) * slot.reach);

      const opacity = this.reduced ? 1 - p : Math.pow(1 - p, 1.7);
      (slot.material.uniforms['uProgress'] as { value: number }).value = this.reduced ? 0.5 : p;
      (slot.material.uniforms['uOpacity'] as { value: number }).value = opacity;
    }
  }

  /** Anillos dibujandose ahora mismo (para el panel de debug). */
  get activeCount(): number {
    let n = 0;
    for (const slot of this.slots) if (slot.active) n += 1;
    return n;
  }

  /** Slots ocupados sobre el total: permite ver si el pool se queda corto. */
  get poolUsage(): { active: number; size: number } {
    return { active: this.activeCount, size: POOL_SIZE };
  }

  dispose(): void {
    // La geometria es COMPARTIDA por los 8 slots: se libera una sola vez.
    const geometry = this.slots[0]?.mesh.geometry;
    for (const slot of this.slots) {
      slot.material.dispose();
      this.group.remove(slot.mesh);
    }
    this.slots.length = 0;
    geometry?.dispose();
  }
}
