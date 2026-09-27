/**
 * Particles.ts — Campo de esporas.
 *
 * DOS SISTEMAS, DOS COSTOS
 * ------------------------
 *   1. AMBIENTE (100% GPU). Las esporas de fondo que flotan todo el tiempo no
 *      tienen objetivo ni interaccion: su posicion se calcula entera en el
 *      vertex shader a partir de una semilla y `uTime`. La CPU escribe los
 *      buffers UNA vez, al construir, y despues solo actualiza un uniform.
 *   2. TRANSITORIO (CPU). Los `burst` y los `stream` necesitan homing por
 *      particula (cada una persigue un objetivo distinto) y viven menos de un
 *      segundo: ahi la simulacion en JS es lo correcto y el costo es acotado.
 *
 * Antes TODO era CPU. Con 2400 particulas, el bucle de integracion corria en
 * cada frame para siempre, aunque el 90% fueran esporas de fondo meciendose.
 *
 * El pool transitorio reutiliza slots en modo circular: cero asignaciones por
 * frame, que es lo que evita que el recolector de basura meta un tiron.
 */

import * as THREE from 'three';
import { createAmbientSporeMaterial, createSporeMaterial } from './Shaders';

// ---------------------------------------------------------------------------
// Ambiente: todo en la GPU
// ---------------------------------------------------------------------------

/**
 * Esporas de fondo. Los buffers se llenan una sola vez.
 *
 * La invariante — que el movimiento vive en el shader y no volvio a la CPU — se
 * verifica con el `version` de los `BufferAttribute`: three lo incrementa cada
 * vez que se les asigna `needsUpdate = true`. Si alguien reintroduce un bucle de
 * integracion en JS, el test lo ve (ver `tests/render.test.ts`).
 */
export class AmbientSporeField {
  readonly points: THREE.Points;
  readonly geometry: THREE.BufferGeometry;
  readonly material: THREE.ShaderMaterial;

  private readonly capacity: number;
  private count: number;

  constructor(options: { count: number; area: number; height: number }) {
    this.capacity = Math.max(1, options.count);
    this.count = this.capacity;

    const seeds = new Float32Array(this.capacity * 3);
    const colors = new Float32Array(this.capacity * 3);
    const sizes = new Float32Array(this.capacity);
    const color = new THREE.Color();

    for (let i = 0; i < this.capacity; i++) {
      // Semilla: posicion base + fase de la caida (en `y`).
      seeds[i * 3] = (Math.random() - 0.5) * options.area;
      seeds[i * 3 + 1] = Math.random() * options.height;
      seeds[i * 3 + 2] = (Math.random() - 0.5) * options.area * 0.7;

      color.setHex(Math.random() > 0.5 ? 0x4fd18b : 0xa78bfa);
      colors[i * 3] = color.r;
      colors[i * 3 + 1] = color.g;
      colors[i * 3 + 2] = color.b;

      sizes[i] = 0.03 + Math.random() * 0.045;
    }

    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 3));
    this.geometry.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
    this.geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
    this.geometry.setDrawRange(0, this.capacity);
    this.geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 200);

    this.material = createAmbientSporeMaterial(options.height);
    this.points = new THREE.Points(this.geometry, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 10;
  }

  /**
   * Cuantas esporas se dibujan. Se cambia con el tier sin reconstruir nada:
   * bajar el rango de dibujo no cuesta memoria ni una subida de buffer.
   */
  setCount(value: number): void {
    this.count = Math.max(0, Math.min(this.capacity, Math.floor(value)));
    this.geometry.setDrawRange(0, this.count);
  }

  /** Unico trabajo por frame: avanzar el reloj del shader. */
  update(time: number): void {
    (this.material.uniforms['uTime'] as { value: number }).value = time;
  }

  get activeCount(): number {
    return this.points.visible ? this.count : 0;
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}

// ---------------------------------------------------------------------------
// Transitorio: CPU, con homing
// ---------------------------------------------------------------------------

interface Particle {
  /** Indice fijo en los buffers: evita busquedas O(n) al emitir. */
  readonly index: number;
  active: boolean;
  life: number;
  maxLife: number;
  vx: number;
  vy: number;
  vz: number;
  tx: number;
  ty: number;
  tz: number;
  homing: number;
  gravity: number;
}

export interface BurstOptions {
  color?: number;
  speed?: number;
  spread?: number;
  size?: number;
  life?: number;
  upward?: number;
}

/**
 * El campo completo: ambiente (GPU) + transitorio (CPU) detras de una sola API.
 *
 * `group` contiene los dos `THREE.Points`; el resto del juego no necesita saber
 * que son dos.
 */
export class SporeField {
  readonly group = new THREE.Group();
  readonly ambient: AmbientSporeField;

  private readonly capacity: number;
  private readonly positions: Float32Array;
  private readonly colors: Float32Array;
  private readonly sizes: Float32Array;
  private readonly lives: Float32Array;
  private readonly particles: Particle[] = [];
  private readonly geometry: THREE.BufferGeometry;
  private readonly material: THREE.ShaderMaterial;
  private cursor = 0;
  /** Cuantos slots del pool transitorio puede usar el tier actual. */
  private limit: number;
  private clock = 0;
  private readonly tmpColor = new THREE.Color();

  constructor(options: { transient: number; ambient: number }) {
    this.capacity = Math.max(1, options.transient);
    this.limit = this.capacity;

    this.positions = new Float32Array(this.capacity * 3);
    this.colors = new Float32Array(this.capacity * 3);
    this.sizes = new Float32Array(this.capacity);
    this.lives = new Float32Array(this.capacity);

    for (let i = 0; i < this.capacity; i++) {
      this.particles.push({
        index: i,
        active: false,
        life: 0,
        maxLife: 1,
        vx: 0,
        vy: 0,
        vz: 0,
        tx: 0,
        ty: 0,
        tz: 0,
        homing: 0,
        gravity: 0,
      });
      // Fuera de pantalla hasta que se activen.
      this.positions[i * 3 + 1] = -999;
    }

    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.geometry.setAttribute('aColor', new THREE.BufferAttribute(this.colors, 3));
    this.geometry.setAttribute('aSize', new THREE.BufferAttribute(this.sizes, 1));
    this.geometry.setAttribute('aLife', new THREE.BufferAttribute(this.lives, 1));
    this.geometry.setDrawRange(0, this.capacity);
    // Sin frustum culling: las particulas se mueven fuera de su bounding box inicial.
    this.geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 200);

    this.material = createSporeMaterial();
    const transientPoints = new THREE.Points(this.geometry, this.material);
    transientPoints.frustumCulled = false;
    transientPoints.renderOrder = 10;

    this.ambient = new AmbientSporeField({
      count: Math.max(1, options.ambient),
      area: 16,
      height: 10,
    });

    this.group.add(this.ambient.points, transientPoints);
  }

  /**
   * Ajusta cuantas particulas puede usar cada sistema. Los pools se dimensionan
   * al maximo al construir (no se reasigna memoria) y el tier solo mueve el
   * limite: cambiar de calidad no puede costar una subida de buffers.
   */
  setLimits(options: { transient: number; ambient: number }): void {
    this.limit = Math.max(1, Math.min(this.capacity, Math.floor(options.transient)));
    this.ambient.setCount(options.ambient);
  }

  // -------------------------------------------------------------------------
  // Emisores
  // -------------------------------------------------------------------------

  /** Explosion radial en un punto. */
  burst(origin: THREE.Vector3, count: number, options: BurstOptions = {}): void {
    const color = options.color ?? 0x6fe0b0;
    const speed = options.speed ?? 2.4;
    const spread = options.spread ?? 1;
    const size = options.size ?? 0.075;
    const life = options.life ?? 0.9;
    const upward = options.upward ?? 1.4;

    this.tmpColor.setHex(color);

    for (let i = 0; i < count; i++) {
      const p = this.allocate();
      if (!p) return;

      const theta = Math.random() * Math.PI * 2;
      const phi = Math.random() * Math.PI * 0.5;
      const v = speed * (0.4 + Math.random() * 0.9);

      p.vx = Math.cos(theta) * Math.sin(phi) * v * spread;
      p.vz = Math.sin(theta) * Math.sin(phi) * v * spread;
      p.vy = Math.cos(phi) * v * 0.6 + upward * (0.4 + Math.random() * 0.8);
      p.gravity = -3.2;
      p.homing = 0;
      p.maxLife = life * (0.7 + Math.random() * 0.6);
      p.life = p.maxLife;

      this.writeParticle(p, origin, color, size * (0.6 + Math.random() * 0.9));
    }
  }

  /**
   * Esporas que viajan de `from` a `to`. Es el efecto que conecta la carta
   * que dispara con la carta disparada: el jugador "ve" el combo.
   */
  stream(from: THREE.Vector3, to: THREE.Vector3, count: number, color: number, arc = 1.6): void {
    for (let i = 0; i < count; i++) {
      const p = this.allocate();
      if (!p) return;

      const jitter = 0.22;
      p.tx = to.x + (Math.random() - 0.5) * jitter;
      p.ty = to.y + (Math.random() - 0.5) * jitter;
      p.tz = to.z + (Math.random() - 0.5) * jitter;

      // Componente inicial que se suma al homing: hace que salgan en abanico.
      p.vx = (Math.random() - 0.5) * 1.2;
      p.vy = Math.random() * 0.6;
      p.vz = (Math.random() - 0.5) * 1.2;
      p.gravity = 0;
      p.homing = 3.4 + Math.random() * 1.6;
      p.maxLife = 0.55 + Math.random() * 0.45;
      p.life = p.maxLife;

      const spawn = from.clone();
      spawn.y += Math.random() * 0.5 * arc;
      spawn.x += (Math.random() - 0.5) * 0.5;
      spawn.z += (Math.random() - 0.5) * 0.5;

      this.writeParticle(p, spawn, color, 0.06 + Math.random() * 0.05);
    }
  }

  setAmbientEnabled(value: boolean): void {
    this.ambient.points.visible = value;
  }

  // -------------------------------------------------------------------------
  // Frame
  // -------------------------------------------------------------------------

  update(dt: number): void {
    this.clock += dt;
    // El ambiente solo necesita el reloj: el movimiento lo hace el shader.
    this.ambient.update(this.clock);

    const pos = this.positions;
    const lives = this.lives;

    for (let i = 0; i < this.limit; i++) {
      const p = this.particles[i];
      if (!p || !p.active) continue;

      p.life -= dt;
      if (p.life <= 0) {
        p.active = false;
        lives[i] = 0;
        pos[i * 3 + 1] = -999;
        continue;
      }

      const idx = i * 3;

      if (p.homing > 0) {
        // Atraccion hacia el objetivo: aceleracion proporcional a la distancia.
        p.vx += (p.tx - (pos[idx] ?? 0)) * p.homing * dt;
        p.vy += (p.ty - (pos[idx + 1] ?? 0)) * p.homing * dt;
        p.vz += (p.tz - (pos[idx + 2] ?? 0)) * p.homing * dt;
        const damp = Math.max(0, 1 - dt * 2.6);
        p.vx *= damp;
        p.vy *= damp;
        p.vz *= damp;
      } else {
        p.vy += p.gravity * dt;
      }

      pos[idx] = (pos[idx] ?? 0) + p.vx * dt;
      pos[idx + 1] = (pos[idx + 1] ?? 0) + p.vy * dt;
      pos[idx + 2] = (pos[idx + 2] ?? 0) + p.vz * dt;

      const t = p.life / p.maxLife;
      // Curva de opacidad: aparece rapido, se desvanece al final.
      lives[i] = t < 0.85 ? Math.min(1, (1 - t) * 8) * t : t;
    }

    (this.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (this.geometry.getAttribute('aColor') as THREE.BufferAttribute).needsUpdate = true;
    (this.geometry.getAttribute('aSize') as THREE.BufferAttribute).needsUpdate = true;
    (this.geometry.getAttribute('aLife') as THREE.BufferAttribute).needsUpdate = true;
  }

  /** Particulas vivas: transitorias activas + esporas de ambiente dibujadas. */
  get activeCount(): number {
    let n = this.ambient.activeCount;
    for (let i = 0; i < this.limit; i++) if (this.particles[i]?.active) n++;
    return n;
  }

  // -------------------------------------------------------------------------
  // Internos
  // -------------------------------------------------------------------------

  private allocate(): Particle | null {
    // Busqueda circular: reutiliza el slot mas viejo si esta todo ocupado.
    for (let attempt = 0; attempt < this.limit; attempt++) {
      const index = (this.cursor + attempt) % this.limit;
      const p = this.particles[index];
      if (p && !p.active) {
        this.cursor = (index + 1) % this.limit;
        p.active = true;
        return p;
      }
    }
    return null;
  }

  private writeParticle(p: Particle, origin: THREE.Vector3, color: number, size: number): void {
    const index = p.index;
    const idx = index * 3;

    this.positions[idx] = origin.x;
    this.positions[idx + 1] = origin.y;
    this.positions[idx + 2] = origin.z;

    this.tmpColor.setHex(color);
    this.colors[idx] = this.tmpColor.r;
    this.colors[idx + 1] = this.tmpColor.g;
    this.colors[idx + 2] = this.tmpColor.b;

    this.sizes[index] = size;
    this.lives[index] = 1;
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
    this.ambient.dispose();
  }
}
