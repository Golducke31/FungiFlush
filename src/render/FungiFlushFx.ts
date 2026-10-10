/**
 * FungiFlushFx.ts — Overlay VFX de la habilidad insignia "FUNGI FLUSH".
 *
 * Puerto del prototipo standalone (`fungiflush-vfx.html`) a la app, siguiendo el
 * mismo patron que `PackOpening.ts`: un `WebGLRenderer` PROPIO con canvas
 * transparente que se monta y desmonta con el overlay. Motivos identicos:
 *
 *   1. La escena del juego es cara (postFX, tapete, esporas ambientales): moverla
 *      para esconderla/mostrarla cada vez que se lanza la habilidad es fragil.
 *   2. El overlay se superpone al juego (canvas transparente, `alpha:true`) para
 *      que las letras caigan ENCIMA de la mesa, no en una pantalla aparte.
 *
 * SECUENCIA (~4 s), en 4 tiempos leidos de arriba a abajo:
 *   CARGA   — se oscurece, rayos, esporas succionadas al centro.
 *   IMPACTO — flash, shake, hit-stop, zoom-punch, 2 ondas y explosion de esporas.
 *   LETRAS  — FUNGI / FLUSH caen de cerca de la camara con rebote + pop propio.
 *   MANTENER— las letras se bambolean como gelatina y un brillo las recorre (1,7 s).
 *   SALIDA  — las letras se inflan y se deshacen en esporas.
 *
 * DOS REGLAS QUE NO SE ROMPEN (heredadas de PackOpening):
 *   - **Todo el timing pasa por `fxTween`/`sleep` de `anim.ts`**: asi el hit-stop
 *     del juego congela TAMBIEN esta secuencia (una secuencia con `setTimeout`
 *     correria con el reloj real y se desincronizaria de lo que se ve).
 *   - **NO se llama `startExternal()`**: a diferencia del sobre (que se abre desde
 *     el MENU, con el loop de `SceneManager` detenido), la habilidad se lanza
 *     DURANTE el juego, donde ese loop YA bombea `anim.updateAnim(dt)`. Un
 *     `startExternal()` extra dejaria dos tickers sumando dt. El rAF propio de
 *     este overlay SOLO dibuja (y avanza las particulas con el reloj de GSAP),
 *     nunca toca `updateAnim`.
 */

import * as THREE from 'three';
import { fxTween, sleep, reduceMotion, now as animNow } from '@render/anim';

/** Paleta del prototipo. */
const COLOR = {
  espora: '#e9dcc0',
  teal: ['#7ffff0', '#3fe0d0', '#c9fff6', '#2fc9c0'],
  lime: ['#c8ff7a', '#e9ffb0'],
  blue: ['#6fb8ff', '#9ee0ff', '#bff4ff'],
  white: ['#ffffff'],
} as const;

/** Tope de particulas del pool (un solo sistema, un solo draw call). */
const NP = 3200;
/** Textura de la fuente de las letras. */
const FONT = '"Bagel Fat One","Lilita One","Arial Black",sans-serif';

interface EmitOptions {
  /** Velocidad minima y maxima. */
  sp: [number, number];
  /** Vida minima y maxima (s). */
  life: [number, number];
  /** Tamano minimo y maximo. */
  size: [number, number];
  /** Colores posibles (se elige uno al azar). */
  col: readonly THREE.Color[];
  /** Radio de succion: si viene, las particulas nacen en un anillo y van al centro. */
  R?: number;
  /** Angulo minimo/maximo (radianes). */
  ang?: [number, number];
  /** Dispersion inicial alrededor del origen. */
  spread?: number;
  /** Gravedad (positiva = sube). */
  g?: number;
  /** Arrastre (1 = sin freno). */
  drag?: number;
  /** Bamboleo lateral. */
  wob?: number;
  /** 0 = espora difusa, 1 = burbuja con anillo. */
  type?: number;
}

interface Letter {
  mesh: THREE.Mesh;
  baseX: number;
  baseY: number;
  baseRot: number;
  delay: number;
  landed: number;
  scale: number;
  live: boolean;
}

export interface FungiFlushFxOptions {
  /**
   * Reproduce el sonido de la habilidad. Se inyecta desde el HUD para que este
   * render no dependa del `AudioBus` ni del contenido. `stage` distingue el
   * momento (carga / impacto / letra / salida).
   */
  onSound?: (stage: 'charge' | 'impact' | 'letter' | 'outro', index?: number) => void;
  /** Aviso de que la secuencia termino (para desmontar el overlay). */
  onDone?: () => void;
}

export class FungiFlushFx {
  readonly element: HTMLElement;

  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.PerspectiveCamera;

  // --- Pool de particulas (atributos + estado de CPU) ---
  private readonly pos = new Float32Array(NP * 3);
  private readonly col = new Float32Array(NP * 3);
  private readonly size = new Float32Array(NP);
  private readonly alpha = new Float32Array(NP);
  private readonly type = new Float32Array(NP);
  private readonly vel = new Float32Array(NP * 3);
  private readonly life = new Float32Array(NP);
  private readonly maxLife = new Float32Array(NP);
  private readonly size0 = new Float32Array(NP);
  private readonly grav = new Float32Array(NP);
  private readonly drag = new Float32Array(NP);
  private readonly wob = new Float32Array(NP);
  private readonly seed = new Float32Array(NP);
  private readonly points: THREE.Points;
  private readonly pointsGeo: THREE.BufferGeometry;
  private readonly pointsMat: THREE.ShaderMaterial;
  private head = 0;

  private readonly dim: THREE.Mesh;
  private readonly glow: THREE.Mesh;
  private readonly rays: THREE.Mesh;
  private readonly rings: THREE.Mesh[];
  private readonly titleGroup = new THREE.Group();
  private readonly letters: Letter[] = [];
  private readonly mushrooms: THREE.Sprite[] = [];
  private readonly mushroomTex: THREE.Texture[];
  private readonly disposables: Array<{ dispose: () => void }> = [];

  private readonly flashEl: HTMLElement;
  private raf = 0;
  private lastAnimTime = 0;
  private disposed = false;
  private busy = false;

  // Shake/punch de camara + hit-stop propio del prototipo.
  private shake = 0;
  private punch = 0;
  private holdUntil = 0;

  /** Escala del titulo (ajustada en `resize`). */
  private titleScale = 1;
  private worldWidth = 8;

  private intensity = 1;

  constructor(private readonly options: FungiFlushFxOptions = {}) {
    this.element = document.createElement('div');
    this.element.className = 'fungi-overlay';
    this.element.dataset['act'] = 'fungi-overlay';

    const flash = document.createElement('div');
    flash.className = 'fungi-flash';
    this.flashEl = flash;
    this.element.appendChild(flash);

    // --- WebGL propio, canvas TRANSPARENTE (se superpone al juego) ------------
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.domElement.className = 'fungi-canvas';
    this.element.prepend(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(45, 1, 0.1, 60);
    this.camera.position.z = 9;

    // --- Pool de particulas con shader (un draw call) ------------------------
    this.pointsGeo = new THREE.BufferGeometry();
    this.pointsGeo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.pointsGeo.setAttribute('aColor', new THREE.BufferAttribute(this.col, 3));
    this.pointsGeo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1));
    this.pointsGeo.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1));
    this.pointsGeo.setAttribute('aType', new THREE.BufferAttribute(this.type, 1));
    this.pointsMat = new THREE.ShaderMaterial({
      uniforms: { uScale: { value: 800 } },
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      vertexShader: `
        attribute vec3 aColor;
        attribute float aSize, aAlpha, aType;
        uniform float uScale;
        varying vec3 vC;
        varying float vA, vT;
        void main(){
          vC = aColor; vA = aAlpha; vT = aType;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = min(aSize * uScale / -mv.z, 160.0);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        varying vec3 vC;
        varying float vA, vT;
        void main(){
          vec2 p = gl_PointCoord - 0.5;
          float d = length(p);
          if (d > 0.5) discard;
          float a;
          if (vT < 0.5) { a = pow(1.0 - d * 2.0, 2.0); }
          else {
            float ring = smoothstep(0.5, 0.44, d) - smoothstep(0.38, 0.28, d);
            float hl = smoothstep(0.13, 0.0, length(p - vec2(-0.17, 0.17))) * 0.9;
            a = ring * 0.95 + (1.0 - d * 2.0) * 0.16 + hl;
          }
          gl_FragColor = vec4(vC, a * vA);
        }`,
    });
    this.points = new THREE.Points(this.pointsGeo, this.pointsMat);
    this.points.frustumCulled = false;
    this.scene.add(this.points);

    // --- Escena de fondo: dim, glow, rayos, anillos, titulo -------------------
    this.dim = new THREE.Mesh(
      new THREE.PlaneGeometry(80, 80),
      new THREE.MeshBasicMaterial({ color: 0x020b0a, transparent: true, opacity: 0, depthWrite: false }),
    );
    this.dim.position.z = -3;
    this.scene.add(this.dim);

    this.glow = new THREE.Mesh(
      new THREE.PlaneGeometry(18, 18),
      new THREE.MeshBasicMaterial({
        map: this.radialTexture('#3fe0d0'),
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    this.glow.position.z = -1.5;
    this.scene.add(this.glow);

    this.rays = new THREE.Mesh(
      new THREE.PlaneGeometry(22, 22),
      new THREE.MeshBasicMaterial({
        map: this.raysTexture(),
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    this.rays.position.z = -1;
    this.scene.add(this.rays);

    this.rings = [0, 1].map(() => {
      const ring = new THREE.Mesh(new THREE.PlaneGeometry(24, 24), this.ringMaterial());
      ring.position.z = -0.6;
      this.scene.add(ring);
      return ring;
    });

    this.mushroomTex = [
      this.mushroomTexture(['#7ffff0', '#139fb6']),
      this.mushroomTexture(['#b8f58a', '#2f9c82']),
    ];

    this.scene.add(this.titleGroup);
  }

  // -------------------------------------------------------------------------
  // Ciclo de vida
  // -------------------------------------------------------------------------

  /** Arranca el rAF de dibujo. El reloj de GSAP lo sigue bombeando el juego. */
  start(): void {
    if (this.disposed || this.raf) return;
    this.lastAnimTime = animNow();
    const tick = (): void => {
      if (this.disposed) return;
      this.raf = requestAnimationFrame(tick);
      // dt derivado del reloj MONOTONO de GSAP: durante el hit-stop del juego
      // `updateAnim` recibe 0, asi que este dt tambien es 0 y las particulas se
      // congelan JUNTO con el resto. Es la razon de no usar `performance.now()`.
      const t = animNow();
      const dt = Math.min(0.05, Math.max(0, t - this.lastAnimTime));
      this.lastAnimTime = t;
      this.frame(dt, t);
    };
    this.raf = requestAnimationFrame(tick);
  }

  /**
   * Lanza la secuencia completa. `intensity` (0.5-2) escala particulas, shake y
   * duracion del sostenido. Devuelve una promesa que resuelve al terminar.
   */
  async play(intensity = 1): Promise<void> {
    if (this.busy || this.disposed) return;
    this.busy = true;
    this.intensity = Math.max(0.5, Math.min(2, intensity));
    const lv = this.intensity;
    const fx = reduceMotion() ? 0 : 1;

    // Reinicio de letras y estado.
    this.resetLetters();
    this.options.onSound?.('charge');
    // Carga: 600 ms de succion mientras se oscurece.
    void fxTween(600, (p) => {
      (this.dim.material as THREE.MeshBasicMaterial).opacity = 0.5 * p;
      (this.glow.material as THREE.MeshBasicMaterial).opacity = 0.5 * p;
      (this.rays.material as THREE.MeshBasicMaterial).opacity = 0.35 * p;
      this.shake = Math.max(this.shake, p * 0.7 * fx);
    });
    await fxTween(600, () => {
      if (Math.random() < 0.9) {
        this.emit(0, 0, 0, Math.round(14 * lv), {
          R: rand(5, 7.5),
          sp: [7, 12],
          life: [0.35, 0.6],
          size: [0.1, 0.26],
          col: tealColors(),
          drag: 0.3,
        });
      }
    });

    // Impacto.
    this.options.onSound?.('impact');
    this.flash();
    this.shake = 2.4 * lv * fx;
    this.punch = 1 * fx;
    this.holdUntil = performance.now() + 85 * fx;
    this.rings.forEach((ring, i) => {
      void sleep(i * 140).then(() =>
        fxTween(750, (p) => {
          const u = (ring.material as THREE.ShaderMaterial).uniforms;
          u['r']!.value = p * 1.05;
          u['w']!.value = 0.1 + 0.25 * p;
          u['a']!.value = (1 - p) * 0.9;
        }),
      );
    });
    this.emit(0, 0, 0, Math.round(320 * lv), {
      sp: [5, 15],
      life: [1, 2.4],
      size: [0.1, 0.4],
      col: [...tealColors(), ...whiteColors()],
      drag: 1.5,
      wob: 1.6,
      g: 0.3,
    });
    this.emit(0, 0, 0, Math.round(120 * lv), {
      sp: [4, 10],
      life: [1.2, 2.6],
      size: [0.08, 0.25],
      col: limeColors(),
      drag: 1.2,
      wob: 2,
      g: 0.2,
    });
    this.emit(0, 0, 0, Math.round(70 * lv), {
      sp: [2.5, 7],
      life: [2, 3.8],
      size: [0.25, 0.7],
      col: blueColors(),
      type: 1,
      drag: 0.8,
      wob: 1.2,
      g: 1.4,
    });
    for (let i = 0; i < Math.round(12 * lv); i++) this.spawnMushroom(i);

    // Letras: cada una cae desde cerca de la camara con rebote y su pop.
    await Promise.all(
      this.letters.map((letter, n) =>
        sleep(letter.delay).then(() => {
          this.options.onSound?.('letter', n);
          return fxTween(430, (p) => {
            const e = outBack(p);
            letter.mesh.scale.setScalar(letter.scale * (3.4 + (1 - 3.4) * e));
            (letter.mesh.material as THREE.MeshBasicMaterial).opacity = Math.min(1, p * 4);
            letter.mesh.position.z = 1.6 * (1 - p);
            letter.mesh.rotation.z = letter.baseRot + (1 - e) * 0.7 * (letter.baseX > 0 ? 1 : -1);
          }).then(() => {
            letter.landed = performance.now();
            letter.live = true;
            const w = this.worldPosition(letter.mesh);
            this.shake = Math.max(this.shake, 0.9 * lv * fx);
            this.emit(w.x, w.y, 0.4, Math.round(36 * lv), {
              sp: [3, 9],
              life: [0.6, 1.5],
              size: [0.08, 0.28],
              col: [...tealColors(), ...whiteColors()],
              drag: 1.8,
              wob: 1,
              g: 0.2,
            });
            this.emit(w.x, w.y - 0.3, 0.4, Math.round(5 * lv), {
              sp: [1, 3],
              life: [1.5, 2.8],
              size: [0.2, 0.5],
              col: blueColors(),
              type: 1,
              drag: 0.6,
              g: 1.2,
              wob: 1,
            });
          });
        }),
      ),
    );

    // Mantener: 1,7 s de bamboleo, burbujas y esporas subiendo.
    await fxTween(1700, () => {
      if (Math.random() < 0.8 * lv) {
        this.emit(rand(-7, 7), -4.3, 0, 1, {
          sp: [0.3, 1],
          ang: [1.3, 1.8],
          life: [2.5, 4],
          size: [0.2, 0.5],
          col: blueColors(),
          type: 1,
          drag: 0.3,
          g: 1.3,
          wob: 1,
        });
      }
      if (Math.random() < 0.9 * lv) {
        this.emit(rand(-7, 7), rand(-3, 3), 0.6, 2, {
          sp: [0.2, 0.8],
          life: [1.8, 3.2],
          size: [0.06, 0.2],
          col: [...tealColors(), ...limeColors()],
          drag: 0.4,
          wob: 1.8,
          g: 0.35,
        });
      }
      if (Math.random() < 0.25 * lv) {
        const letter = this.letters[Math.floor(Math.random() * this.letters.length)];
        if (letter) {
          const w = this.worldPosition(letter.mesh);
          this.emit(w.x + rand(-0.5, 0.5), w.y + rand(-0.5, 0.5), 0.5, 10, {
            sp: [1, 3.5],
            life: [0.4, 0.9],
            size: [0.05, 0.18],
            col: whiteColors(),
            drag: 2,
          });
        }
      }
    });

    // Salida: las letras se inflan y se deshacen en esporas.
    this.options.onSound?.('outro');
    for (const letter of this.letters) letter.live = false;
    this.shake = Math.max(this.shake, 1.3 * lv * fx);
    await Promise.all(
      this.letters.map((letter, n) =>
        sleep(n * 40).then(() => {
          const w = this.worldPosition(letter.mesh);
          this.emit(w.x, w.y, 0.4, Math.round(55 * lv), {
            sp: [2, 9],
            life: [0.7, 1.6],
            size: [0.08, 0.3],
            col: [...tealColors(), ...limeColors(), ...whiteColors()],
            drag: 1.5,
            wob: 1.5,
            g: 0.5,
          });
          return fxTween(380, (p) => {
            letter.mesh.scale.setScalar(letter.scale * (1 + 0.4 * p));
            (letter.mesh.material as THREE.MeshBasicMaterial).opacity = 1 - Math.max(0, (p - 0.3) / 0.7);
            (letter.mesh.material as THREE.MeshBasicMaterial).color.setScalar(1 + 2 * p);
          });
        }),
      ),
    );
    void fxTween(700, (p) => {
      (this.dim.material as THREE.MeshBasicMaterial).opacity = 0.5 * (1 - p);
      (this.glow.material as THREE.MeshBasicMaterial).opacity = 0.5 * (1 - p);
      (this.rays.material as THREE.MeshBasicMaterial).opacity = 0.35 * (1 - p);
    });
    await sleep(900);
    this.busy = false;
    this.options.onDone?.();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    for (const d of this.disposables) d.dispose();
    this.pointsMat.dispose();
    this.pointsGeo.dispose();
    this.renderer.dispose();
    this.element.remove();
  }

  // -------------------------------------------------------------------------
  // Construccion de texturas y titulo
  // -------------------------------------------------------------------------

  private radialTexture(color: string): THREE.CanvasTexture {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d')!;
    const r = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    r.addColorStop(0, color);
    r.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = r;
    g.fillRect(0, 0, 128, 128);
    const texture = new THREE.CanvasTexture(c);
    this.disposables.push(texture);
    return texture;
  }

  private raysTexture(): THREE.CanvasTexture {
    const c = document.createElement('canvas');
    c.width = c.height = 512;
    const g = c.getContext('2d')!;
    g.translate(256, 256);
    for (let i = 0; i < 18; i++) {
      g.save();
      g.rotate((i / 18) * 6.283 + (i % 2) * 0.05);
      const r = g.createRadialGradient(0, 0, 10, 0, 0, 256);
      r.addColorStop(0, 'rgba(190,255,245,.7)');
      r.addColorStop(1, 'rgba(190,255,245,0)');
      g.fillStyle = r;
      g.beginPath();
      g.moveTo(0, 0);
      g.arc(0, 0, 256, -0.05 - (i % 3) * 0.01, 0.05 + (i % 3) * 0.012);
      g.closePath();
      g.fill();
      g.restore();
    }
    const texture = new THREE.CanvasTexture(c);
    this.disposables.push(texture);
    return texture;
  }

  private mushroomTexture(cap: readonly [string, string]): THREE.CanvasTexture {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d')!;
    g.lineJoin = 'round';
    g.strokeStyle = '#06303c';
    g.lineWidth = 6;
    g.fillStyle = '#d9fff8';
    g.beginPath();
    g.roundRect(50, 66, 28, 52, 12);
    g.fill();
    g.stroke();
    const grad = g.createLinearGradient(0, 20, 0, 76);
    grad.addColorStop(0, cap[0]);
    grad.addColorStop(1, cap[1]);
    g.fillStyle = grad;
    g.beginPath();
    g.ellipse(64, 76, 57, 54, 0, Math.PI, Math.PI * 2);
    g.closePath();
    g.fill();
    g.stroke();
    g.fillStyle = '#fff';
    for (const [x, y, r] of [[40, 52, 9], [70, 36, 11], [92, 60, 7], [58, 62, 6], [86, 42, 5]] as const) {
      g.beginPath();
      g.arc(x, y, r, 0, 6.283);
      g.fill();
    }
    const texture = new THREE.CanvasTexture(c);
    this.disposables.push(texture);
    return texture;
  }

  private ringMaterial(): THREE.ShaderMaterial {
    const mat = new THREE.ShaderMaterial({
      uniforms: { r: { value: 0 }, w: { value: 0.1 }, a: { value: 0 } },
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      vertexShader:
        'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: `
        uniform float r, w, a;
        varying vec2 vUv;
        void main(){
          float d = length(vUv - 0.5) * 2.0;
          float ring = smoothstep(r - w, r, d) * (1.0 - smoothstep(r, r + w * 0.3, d));
          gl_FragColor = vec4(mix(vec3(0.25,0.95,0.88), vec3(1.0), ring), ring * a);
        }`,
    });
    this.disposables.push(mat);
    return mat;
  }

  private buildTitle(): void {
    let sd = 7;
    const srnd = (): number => (sd = (sd * 16807) % 2147483647) / 2147483647;
    const PPU = 165;
    let maxWidth = 8;
    const words = ['FUNGI', 'FLUSH'];
    for (let row = 0; row < words.length; row++) {
      const canvases = [...words[row]!].map((ch) => this.letterCanvas(ch, srnd));
      const adv = canvases.map((c) => (c.width - 70) / PPU);
      const width = adv.reduce((a, b) => a + b, 0) + 0.35;
      maxWidth = Math.max(maxWidth, width);
      let x = -width / 2 + adv[0]! / 2 + 0.17;
      canvases.forEach((canvas, i) => {
        const texture = new THREE.CanvasTexture(canvas);
        this.disposables.push(texture);
        const mesh = new THREE.Mesh(
          new THREE.PlaneGeometry(canvas.width / PPU, canvas.height / PPU),
          new THREE.MeshBasicMaterial({ map: texture, transparent: true, opacity: 0 }),
        );
        this.disposables.push(mesh.geometry);
        this.disposables.push(mesh.material as THREE.Material);
        const letter: Letter = {
          mesh,
          baseX: x,
          baseY: row ? -0.82 : 0.8,
          baseRot: (i - 2) * 0.035 * (row ? -1 : 1),
          delay: (row * 0.2 + i * 0.07) * 1000,
          landed: -1,
          scale: row ? 1.07 : 1,
          live: false,
        };
        mesh.position.set(letter.baseX, letter.baseY, 0);
        mesh.scale.setScalar(0);
        this.titleGroup.add(mesh);
        this.letters.push(letter);
        if (i < canvases.length - 1) x += adv[i]! / 2 + adv[i + 1]! / 2;
      });
    }
    this.worldWidth = maxWidth;
  }

  /** Aproximacion procedural a las letras del logo (gloss + manchitas). */
  private letterCanvas(ch: string, srnd: () => number): HTMLCanvasElement {
    const FS = 230;
    const pad = 52;
    const m = document.createElement('canvas').getContext('2d')!;
    m.font = `${FS}px ${FONT}`;
    const w = Math.ceil(m.measureText(ch).width);
    const c = document.createElement('canvas');
    c.width = w + pad * 2;
    c.height = FS + pad * 2;
    const g = c.getContext('2d')!;
    const cx = c.width / 2;
    const cy = c.height / 2 + 6;
    g.font = `${FS}px ${FONT}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineJoin = 'round';
    g.strokeStyle = '#04202b';
    g.lineWidth = 46;
    g.strokeText(ch, cx, cy);
    g.strokeStyle = '#0d6a80';
    g.lineWidth = 30;
    g.strokeText(ch, cx, cy);

    const t = document.createElement('canvas');
    t.width = c.width;
    t.height = c.height;
    const u = t.getContext('2d')!;
    u.font = g.font;
    u.textAlign = 'center';
    u.textBaseline = 'middle';
    const grad = u.createLinearGradient(0, cy - FS * 0.5, 0, cy + FS * 0.5);
    grad.addColorStop(0, '#c6fff4');
    grad.addColorStop(0.45, '#4fe6d6');
    grad.addColorStop(1, '#139fb6');
    u.fillStyle = grad;
    u.fillText(ch, cx, cy);
    u.globalCompositeOperation = 'source-atop';
    const sh = u.createLinearGradient(0, cy, 0, cy + FS * 0.5);
    sh.addColorStop(0, 'rgba(5,60,80,0)');
    sh.addColorStop(1, 'rgba(5,60,80,.45)');
    u.fillStyle = sh;
    u.fillRect(0, cy, c.width, FS);
    for (let i = 0; i < 14; i++) {
      const x = pad + srnd() * w;
      const y = cy + (srnd() - 0.5) * FS * 0.72;
      const r = 5 + srnd() * 11;
      u.fillStyle = 'rgba(255,255,255,.92)';
      u.beginPath();
      u.arc(x, y, r, 0, 6.283);
      u.fill();
      u.strokeStyle = 'rgba(10,110,130,.35)';
      u.lineWidth = 2;
      u.stroke();
    }
    const gl = u.createLinearGradient(0, cy - FS * 0.38, 0, cy - FS * 0.12);
    gl.addColorStop(0, 'rgba(255,255,255,.6)');
    gl.addColorStop(1, 'rgba(255,255,255,0)');
    u.fillStyle = gl;
    u.beginPath();
    u.ellipse(cx - w * 0.08, cy - FS * 0.25, w * 0.4, FS * 0.13, -0.06, 0, 6.283);
    u.fill();
    g.drawImage(t, 0, 0);
    return c;
  }

  private resetLetters(): void {
    for (const letter of this.letters) {
      (letter.mesh.material as THREE.MeshBasicMaterial).opacity = 0;
      letter.mesh.scale.setScalar(0);
      letter.mesh.position.y = letter.baseY;
      letter.mesh.position.z = 0;
      (letter.mesh.material as THREE.MeshBasicMaterial).color.setScalar(1);
      letter.landed = -1;
      letter.live = false;
    }
  }

  // -------------------------------------------------------------------------
  // Particulas
  // -------------------------------------------------------------------------

  private emit(x: number, y: number, z: number, count: number, o: EmitOptions): void {
    for (let i = 0; i < count; i++) {
      const k = this.head++ % NP;
      const j = k * 3;
      const ang = o.ang ? rand(o.ang[0], o.ang[1]) : Math.random() * 6.283;
      const sp = rand(o.sp[0], o.sp[1]);
      let px = x;
      let py = y;
      let vx: number;
      let vy: number;
      if (o.R) {
        const r = o.R * rand(0.8, 1.2);
        px += Math.cos(ang) * r;
        py += Math.sin(ang) * r * 0.6;
        vx = -Math.cos(ang) * sp;
        vy = -Math.sin(ang) * sp * 0.6;
      } else {
        const sr = (o.spread ?? 0) * Math.random();
        px += Math.cos(ang) * sr;
        py += Math.sin(ang) * sr;
        vx = Math.cos(ang) * sp;
        vy = Math.sin(ang) * sp;
      }
      this.pos[j] = px;
      this.pos[j + 1] = py;
      this.pos[j + 2] = z + rand(-0.4, 0.4);
      this.vel[j] = vx;
      this.vel[j + 1] = vy;
      this.vel[j + 2] = rand(-0.5, 0.5) * sp * 0.25;
      const c = o.col[Math.floor(Math.random() * o.col.length)]!;
      this.col[j] = c.r;
      this.col[j + 1] = c.g;
      this.col[j + 2] = c.b;
      const life = rand(o.life[0], o.life[1]);
      this.maxLife[k] = life;
      this.life[k] = life;
      this.size0[k] = rand(o.size[0], o.size[1]);
      this.grav[k] = o.g ?? 0;
      this.drag[k] = o.drag ?? 1;
      this.wob[k] = o.wob ?? 0;
      this.seed[k] = Math.random();
      this.type[k] = o.type ?? 0;
      this.alpha[k] = 1;
    }
  }

  private spawnMushroom(index: number): void {
    const texture = this.mushroomTex[index % this.mushroomTex.length]!;
    const sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false }),
    );
    sprite.position.set(0, 0, -0.4);
    this.scene.add(sprite);
    this.mushrooms.push(sprite);
    const ang = rand(0.22, 0.78) * Math.PI;
    const v = rand(5, 9.5);
    const vx = Math.cos(ang) * v * 1.5;
    const vy = Math.sin(ang) * v;
    const sc = rand(0.7, 1.3);
    const spin = rand(-3, 3);
    const dur = rand(1700, 2400);
    void sleep(index * 30)
      .then(() =>
        fxTween(dur, (p) => {
          const t = (p * dur) / 1000;
          sprite.position.set(vx * t, vy * t - 5 * t * t, -0.4);
          sprite.material.rotation = spin * t;
          sprite.scale.setScalar(sc * Math.min(1, p * 8) * (1 - 0.3 * p));
          sprite.material.opacity = p < 0.7 ? 1 : 1 - (p - 0.7) / 0.3;
        }),
      )
      .then(() => {
        this.scene.remove(sprite);
        sprite.material.dispose();
        const i = this.mushrooms.indexOf(sprite);
        if (i >= 0) this.mushrooms.splice(i, 1);
      });
  }

  private stepParticles(dt: number, time: number): void {
    for (let k = 0; k < NP; k++) {
      if (this.life[k]! <= 0) {
        this.alpha[k] = 0;
        continue;
      }
      const j = k * 3;
      this.life[k]! -= dt;
      const l = Math.max(0, this.life[k]! / this.maxLife[k]!);
      const d = Math.exp(-this.drag[k]! * dt);
      const w = this.wob[k]!;
      this.vel[j] = this.vel[j]! * d + Math.sin(time * 3 + this.seed[k]! * 40) * w * dt;
      this.vel[j + 1] =
        this.vel[j + 1]! * d + this.grav[k]! * dt + Math.cos(time * 2.3 + this.seed[k]! * 30) * w * 0.6 * dt;
      this.vel[j + 2] = this.vel[j + 2]! * d;
      this.pos[j] = this.pos[j]! + this.vel[j]! * dt;
      this.pos[j + 1] = this.pos[j + 1]! + this.vel[j + 1]! * dt;
      this.pos[j + 2] = this.pos[j + 2]! + this.vel[j + 2]! * dt;
      this.size[k] = this.size0[k]! * (this.type[k]! > 0.5 ? 1 : 0.35 + 0.65 * l);
      this.alpha[k] = Math.min((1 - l) * 12, 1) * Math.min(l * 2.5, 1);
    }
    const geo = this.pointsGeo;
    (geo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (geo.getAttribute('aColor') as THREE.BufferAttribute).needsUpdate = true;
    (geo.getAttribute('aSize') as THREE.BufferAttribute).needsUpdate = true;
    (geo.getAttribute('aAlpha') as THREE.BufferAttribute).needsUpdate = true;
    (geo.getAttribute('aType') as THREE.BufferAttribute).needsUpdate = true;
  }

  // -------------------------------------------------------------------------
  // Frame y resize
  // -------------------------------------------------------------------------

  private frame(dt: number, time: number): void {
    // Hit-stop propio del prototipo: congela la simulacion unos ms.
    const effective = performance.now() < this.holdUntil ? 0 : dt;
    this.stepParticles(effective, time);
    this.shake *= Math.exp(-effective * 6);
    this.punch *= Math.exp(-effective * 5);
    this.camera.position.set(
      (Math.random() - 0.5) * this.shake * 0.18,
      (Math.random() - 0.5) * this.shake * 0.18,
      9 - this.punch * 0.9,
    );
    this.rays.rotation.z = time * 0.25;
    this.rays.scale.setScalar(1 + 0.06 * Math.sin(time * 3));
    this.glow.scale.setScalar(1 + 0.05 * Math.sin(time * 2.2));

    // Brillo que recorre las letras + bamboleo de gelatina.
    const sweep = -7 + ((time * 0.55) % 1.5) * 10;
    this.letters.forEach((letter, i) => {
      if (letter.landed < 0) return;
      const since = (performance.now() - letter.landed) / 1000;
      const wobble = Math.exp(-3.2 * since) * Math.sin(since * 22);
      if (letter.live) {
        letter.mesh.scale.set(
          letter.scale * (1 + 0.16 * wobble),
          letter.scale * (1 - 0.16 * wobble),
          1,
        );
        letter.mesh.position.y = letter.baseY + Math.sin(time * 2 + i) * 0.04;
        letter.mesh.rotation.z = letter.baseRot + Math.sin(time * 1.6 + i) * 0.02;
        const wx = letter.baseX * this.titleGroup.scale.x;
        (letter.mesh.material as THREE.MeshBasicMaterial).color.setScalar(
          1 + 1.1 * Math.exp(-Math.pow(wx - sweep, 2) / 1.6),
        );
      }
    });
    this.renderer.render(this.scene, this.camera);
  }

  private resize(): void {
    const w = this.element.clientWidth || window.innerWidth;
    const h = this.element.clientHeight || window.innerHeight;
    const vis = 2 * 9 * Math.tan(THREE.MathUtils.degToRad(22.5));
    const visW = vis * (w / h);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.pointsMat.uniforms['uScale']!.value =
      (h * this.renderer.getPixelRatio()) / 2 / Math.tan(THREE.MathUtils.degToRad(22.5));
    this.titleScale = Math.min(1.35, (visW * 0.84) / this.worldWidth, (vis * 0.74) / 3.3);
    this.titleGroup.scale.setScalar(this.titleScale);
  }

  /** Debe llamarse al montar (y en cada `resize` de la ventana). */
  onResize(): void {
    if (this.disposed) return;
    this.resize();
  }

  /** Construye las letras una vez cargada la fuente (o con el fallback). */
  async prepare(): Promise<void> {
    try {
      if (document.fonts?.load) {
        await Promise.all([
          document.fonts.load('200px "Bagel Fat One"'),
          document.fonts.load('20px "Lilita One"'),
        ]);
      }
    } catch {
      // Sin fuente propia se usa el fallback de `FONT`: se ve parecido, no rompe.
    }
    if (this.disposed || this.letters.length > 0) return;
    this.buildTitle();
    this.resize();
  }

  private flash(): void {
    if (reduceMotion()) return;
    this.flashEl.classList.remove('is-go');
    void this.flashEl.offsetWidth;
    this.flashEl.classList.add('is-go');
  }

  private worldPosition(obj: THREE.Object3D): THREE.Vector3 {
    return obj.getWorldPosition(new THREE.Vector3());
  }
}

// ---------------------------------------------------------------------------
// Helpers de paleta (fuera de la clase: no dependen de su estado)
// ---------------------------------------------------------------------------

function rand(a: number, b: number): number {
  return a + Math.random() * (b - a);
}

function outBack(p: number): number {
  return 1 + 2.70158 * Math.pow(p - 1, 3) + 1.70158 * Math.pow(p - 1, 2);
}

function toColors(hexes: readonly string[]): THREE.Color[] {
  return hexes.map((h) => new THREE.Color(h));
}

function tealColors(): THREE.Color[] {
  return toColors(COLOR.teal);
}
function limeColors(): THREE.Color[] {
  return toColors(COLOR.lime);
}
function blueColors(): THREE.Color[] {
  return toColors(COLOR.blue);
}
function whiteColors(): THREE.Color[] {
  return toColors(COLOR.white);
}
