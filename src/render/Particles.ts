/**
 * Particles.ts — Campo de esporas.
 *
 * Un UNICO THREE.Points para todas las particulas del juego. Es la diferencia
 * entre 60 FPS y 12 FPS: si cada espora fuera un mesh tendriamos miles de draw
 * calls. Aca hay una sola geometria, un solo material y cero asignaciones por
 * frame (los buffers se reutilizan en modo circular).
 *
 * Tres usos:
 *   - ambient(): esporas flotando de fondo.
 *   - burst():   explosion en un punto (al puntuar).
 *   - stream():  esporas que viajan de la carta A a la carta B (combo).
 */

import * as THREE from 'three';
import { createSporeMaterial } from './Shaders';

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

export class SporeField {
  readonly points: THREE.Points;

  private readonly capacity: number;
  private readonly positions: Float32Array;
  private readonly colors: Float32Array;
  private readonly sizes: Float32Array;
  private readonly lives: Float32Array;
  private readonly particles: Particle[] = [];
  private readonly geometry: THREE.BufferGeometry;
  private readonly material: THREE.ShaderMaterial;
  private cursor = 0;
  private ambientTimer = 0;
  private ambientEnabled = true;
  private readonly tmpColor = new THREE.Color();

  constructor(capacity = 2400) {
    this.capacity = capacity;
    this.positions = new Float32Array(capacity * 3);
    this.colors = new Float32Array(capacity * 3);
    this.sizes = new Float32Array(capacity);
    this.lives = new Float32Array(capacity);

    for (let i = 0; i < capacity; i++) {
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
    this.geometry.setDrawRange(0, capacity);
    // Sin frustum culling: las particulas se mueven fuera de su bounding box inicial.
    this.geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 200);

    this.material = createSporeMaterial();
    this.points = new THREE.Points(this.geometry, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 10;
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

  /** Esporas de fondo, cayendo lentamente. */
  ambient(area = 16, height = 10): void {
    for (let i = 0; i < 3; i++) {
      const p = this.allocate();
      if (!p) return;
      p.vx = (Math.random() - 0.5) * 0.25;
      p.vy = -0.18 - Math.random() * 0.3;
      p.vz = (Math.random() - 0.5) * 0.25;
      p.gravity = 0;
      p.homing = 0;
      p.maxLife = 6 + Math.random() * 5;
      p.life = p.maxLife;

      const origin = new THREE.Vector3(
        (Math.random() - 0.5) * area,
        height,
        (Math.random() - 0.5) * area * 0.7,
      );
      this.writeParticle(p, origin, Math.random() > 0.5 ? 0x4fd18b : 0xa78bfa, 0.03 + Math.random() * 0.04);
    }
  }

  setAmbientEnabled(value: boolean): void {
    this.ambientEnabled = value;
  }

  // -------------------------------------------------------------------------
  // Frame
  // -------------------------------------------------------------------------

  update(dt: number): void {
    const pos = this.positions;
    const lives = this.lives;

    for (let i = 0; i < this.capacity; i++) {
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

    if (this.ambientEnabled) {
      this.ambientTimer -= dt;
      if (this.ambientTimer <= 0) {
        this.ambientTimer = 0.12;
        this.ambient();
      }
    }

    (this.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (this.geometry.getAttribute('aColor') as THREE.BufferAttribute).needsUpdate = true;
    (this.geometry.getAttribute('aSize') as THREE.BufferAttribute).needsUpdate = true;
    (this.geometry.getAttribute('aLife') as THREE.BufferAttribute).needsUpdate = true;
  }

  get activeCount(): number {
    let n = 0;
    for (const p of this.particles) if (p.active) n++;
    return n;
  }

  // -------------------------------------------------------------------------
  // Internos
  // -------------------------------------------------------------------------

  private allocate(): Particle | null {
    // Busqueda circular: reutiliza el slot mas viejo si esta todo ocupado.
    for (let attempt = 0; attempt < this.capacity; attempt++) {
      const index = (this.cursor + attempt) % this.capacity;
      const p = this.particles[index];
      if (p && !p.active) {
        this.cursor = (index + 1) % this.capacity;
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
  }
}
