/**
 * Die3D.ts — El dado multiplicador, en 3D de verdad, POR CAPAS y con tirada
 * manual.
 *
 * ESTRUCTURA: no es un cubo con seis texturas pegadas. Es un NUCLEO oscuro (el
 * cuerpo del dado) mas SEIS PLACAS que sobresalen de cada cara, cada una con su
 * propia textura. Es el mismo criterio que las cartas: la capa de arriba tiene
 * profundidad real respecto al cuerpo, asi que al girar el dado se ve el canto
 * de las placas y el dado se lee como un objeto, no como una calcomania.
 *
 * LAS CARAS SON HONGOS, no numeros: la cara N muestra N honguitos en la
 * disposicion clasica de pips, y el multiplicador (x1.1, x1.6...) abajo. El
 * valor se lee de un vistazo sin saber contar pips.
 *
 * LA TIRADA ES UN GESTO, NO UN TWEEN
 * ----------------------------------
 * El cubo se arrastra y se suelta, y la caida la resuelve una integracion propia
 * (`update`) con gravedad, rebote, friccion y amortiguacion del giro. Un tween
 * de GSAP habria sido mas corto, pero un dado que gira "hacia" una rotacion
 * final se lee como una animacion, no como una tirada: la diferencia esta en
 * que aca la orientacion final NO se sabe hasta que el cubo se apoya.
 *
 * OJO: la cara la decide el MOTOR antes de animar (RNG sembrado). La fisica es
 * puro espectaculo y no puede influir en el resultado; lo unico que hace es
 * aterrizar en la cara que ya salio. Ver `GameEngine.throwDie`.
 *
 * La fisica corre con el `dt` ACOTADO del bucle (`SceneManager.frame`), asi que
 * un tiron de frames no la manda al infinito.
 */

import * as THREE from 'three';

import * as anim from './anim';

/** Rectangulo redondeado, con respaldo por si `roundRect` no existe. */
function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  if (typeof ctx.roundRect === 'function') {
    ctx.roundRect(x, y, w, h, r);
    return;
  }
  ctx.rect(x, y, w, h);
}

/**
 * Lado del cubo, en unidades del mundo.
 *
 * Bajado de 1.5: con la camara del juego (que esta cerca de la mesa) un dado de
 * 1.5 se veia enorme al lado de las cartas y pisaba la ultima de la mano.
 */
const DIE_SIZE = 1.15;

/** Cuanto sobresale cada placa respecto del nucleo. */
const PLATE_LIFT = 0.012;

/**
 * DONDE SE TIRA
 * -------------
 * Adelante y al centro, no en el rincon donde queda aparcado. Dos razones:
 *   1. Es el unico lugar del cuadro que la barra de progreso no tapa.
 *   2. El cubo se agranda x2 mientras espera la tirada, porque a tamano natural
 *      son ~29 px en un telefono en landscape: por debajo del minimo tactil
 *      comodo. Agrandado son ~58 px, que se agarra con el pulgar.
 * Al aparcarse vuelve a su tamano y a su rincon.
 */
const THROW_POS = new THREE.Vector3(0, 1.5, 2.4);
const THROW_SCALE = 2;
/** BIEN afuera a la derecha: el abanico de la mano llega a x=8.25, asi que a 8.2
 *  el dado pisaba la ultima carta. Con 11.6 queda en la franja libre del
 *  costado, junto al mazo pero sin taparlo. */
const PARK_POS = new THREE.Vector3(11.6, 0.575, 4.2);
const PARK_SCALE = 1;

/**
 * Hasta donde puede llegar el CENTRO del dado. Es mas chico que la plataforma a
 * proposito, y no es simetrico:
 *
 *   - En X el tope son 8.6: a x=11 el cubo queda sobre la losa pero pegado al
 *     borde del cuadro (y debajo del contador de Fungis).
 *   - En Z el fondo son -1.4: mas atras el dado aterriza encima de la fila de
 *     JOKERS (z ~ -3.3) y el resultado se lee mal. El frente son +4.0, que es
 *     donde empieza la barra de acciones del HUD.
 *
 * Se define aca y no se importa de `Arena` para no arrastrar el modulo entero
 * (y sus assets) a cualquier consumidor del dado.
 */
const PLATFORM_LIMIT_X = 8.6;
const PLATFORM_LIMIT_Z_BACK = -1.4;
const PLATFORM_LIMIT_Z_FRONT = 4;

// --- Constantes de la fisica. Unidades del mundo y segundos. ---
/** Gravedad. Mas fuerte que la real a proposito: una tirada de 1.5 s, no de 3. */
const GRAVITY = -26;
/** Cuanto rebota contra la plataforma. */
const RESTITUTION = 0.42;
/** Cuanto rebota contra las paredes invisibles del borde. */
const WALL_RESTITUTION = 0.5;
/** Semivida del giro: cada 0.5 s pierde la mitad. */
const SPIN_HALF_LIFE = 0.5;
/** Semivida de la velocidad horizontal, y solo cuando toca el piso. */
const MOVE_HALF_LIFE = 0.35;
/** Debajo de esto el rebote se corta: si no, el dado tiembla en el piso. */
const MIN_BOUNCE = 0.9;
/** Margen para considerar que el cubo ya toca la losa. */
const CONTACT_EPS = 0.03;
/** Duracion del asentamiento final (el cubo se acomoda en su cara). */
const SETTLE_TIME = 0.26;
/** Tope de vuelo: si algo sale mal, el dado se apoya igual y el juego sigue. */
const MAX_FLIGHT = 4;

/** Orden de caras de `BoxGeometry`: +X, -X, +Y, -Y, +Z, -Z. */
const FACE_NORMALS: ReadonlyArray<THREE.Vector3> = [
  new THREE.Vector3(1, 0, 0),
  new THREE.Vector3(-1, 0, 0),
  new THREE.Vector3(0, 1, 0),
  new THREE.Vector3(0, -1, 0),
  new THREE.Vector3(0, 0, 1),
  new THREE.Vector3(0, 0, -1),
];

/** Rotacion (euler) que deja cada cara mirando a la camara (+Z). */
const FACE_ROTATION: ReadonlyArray<[number, number, number]> = [
  [0, Math.PI / 2, 0], // +X
  [0, -Math.PI / 2, 0], // -X
  [-Math.PI / 2, 0, 0], // +Y
  [Math.PI / 2, 0, 0], // -Y
  [0, 0, 0], // +Z
  [0, Math.PI, 0], // -Z
];

/** Valor (1..6) -> indice de cara. El 1 mira al frente y el 6 al fondo. */
const VALUE_TO_FACE = [4, 5, 2, 3, 0, 1];

/** Impulso con el que se lanza un dado. `spin` es la velocidad angular, rad/s. */
export interface DieImpulse {
  vx: number;
  vy: number;
  vz: number;
  spinX: number;
  spinY: number;
  spinZ: number;
}

/** Dibuja un honguito centrado en (cx, cy), del tamano pedido. */
function drawMushroom(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number): void {
  const r = size / 2;
  // Pie.
  ctx.fillStyle = '#e8ddc8';
  roundRect(ctx, cx - r * 0.26, cy - r * 0.1, r * 0.52, r * 0.95, r * 0.16);
  ctx.fill();
  // Sombrero (media luna).
  ctx.fillStyle = '#c94b3f';
  ctx.beginPath();
  ctx.ellipse(cx, cy - r * 0.12, r, r * 0.78, 0, Math.PI, 0);
  ctx.fill();
  // Borde inferior del sombrero, para que no se lea como un circulo.
  ctx.beginPath();
  ctx.ellipse(cx, cy - r * 0.12, r, r * 0.22, 0, 0, Math.PI);
  ctx.fill();
  // Lunares.
  ctx.fillStyle = 'rgba(255,255,255,0.88)';
  for (const [dx, dy, dr] of [
    [-0.42, -0.34, 0.15],
    [0.34, -0.42, 0.12],
    [0.02, -0.6, 0.1],
  ] as const) {
    ctx.beginPath();
    ctx.arc(cx + r * dx, cy + r * dy, r * dr, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** Posiciones de los pips (1..6) en el rango -1..1. */
const PIP_LAYOUT: ReadonlyArray<ReadonlyArray<readonly [number, number]>> = [
  [[0, 0]],
  [
    [-0.55, -0.55],
    [0.55, 0.55],
  ],
  [
    [-0.55, -0.55],
    [0, 0],
    [0.55, 0.55],
  ],
  [
    [-0.55, -0.55],
    [0.55, -0.55],
    [-0.55, 0.55],
    [0.55, 0.55],
  ],
  [
    [-0.55, -0.55],
    [0.55, -0.55],
    [0, 0],
    [-0.55, 0.55],
    [0.55, 0.55],
  ],
  [
    [-0.55, -0.6],
    [-0.55, 0],
    [-0.55, 0.6],
    [0.55, -0.6],
    [0.55, 0],
    [0.55, 0.6],
  ],
];

/**
 * Textura de una cara: N hongos + el multiplicador.
 * `multiplier` se muestra tal cual (0.8, 1, 1.1...).
 */
export function createDieFaceCanvas(value: number, multiplier: number): HTMLCanvasElement {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;

  // Cuerpo de la cara: hueso oscuro, para que los hongos resalten.
  const bg = ctx.createRadialGradient(size / 2, size * 0.42, 10, size / 2, size / 2, size * 0.75);
  bg.addColorStop(0, '#2b3a3a');
  bg.addColorStop(1, '#141d21');
  ctx.fillStyle = bg;
  roundRect(ctx, 0, 0, size, size, 34);
  ctx.fill();

  ctx.strokeStyle = 'rgba(46,178,164,0.55)';
  ctx.lineWidth = 6;
  roundRect(ctx, 4, 4, size - 8, size - 8, 30);
  ctx.stroke();

  // Hongos.
  const layout = PIP_LAYOUT[value - 1] ?? PIP_LAYOUT[0]!;
  const pipSize = value >= 5 ? 74 : 88;
  const area = size * 0.72;
  for (const [px, py] of layout) {
    drawMushroom(ctx, size / 2 + px * area * 0.5, size * 0.44 + py * area * 0.5, pipSize);
  }

  // Multiplicador.
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '700 44px system-ui, sans-serif';
  ctx.fillStyle = multiplier >= 1 ? '#8fe9c8' : '#e08b8b';
  ctx.fillText(`x${multiplier}`, size / 2, size - 34);

  return canvas;
}

/** Quaternion de la rotacion que deja la cara `face` mirando a la camara. */
function faceQuaternion(face: number, out: THREE.Quaternion): THREE.Quaternion {
  const euler = FACE_ROTATION[VALUE_TO_FACE[face - 1] ?? 4] ?? FACE_ROTATION[4]!;
  return out.setFromEuler(new THREE.Euler(euler[0], euler[1], euler[2]));
}

/** PRNG local. La fisica es visual: nunca toca el RNG del motor. */
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

/** `true` si el jugador pidio menos movimiento: la tirada se resuelve de una. */
function prefersStill(): boolean {
  return anim.reduceMotion();
}

type Phase = 'idle' | 'dragging' | 'flight' | 'settle';

export class Die3D {
  readonly group = new THREE.Group();

  private readonly geometry = new THREE.BoxGeometry(DIE_SIZE, DIE_SIZE, DIE_SIZE);
  private readonly plateGeometry = new THREE.PlaneGeometry(DIE_SIZE * 0.9, DIE_SIZE * 0.9);
  private readonly coreMaterial: THREE.MeshStandardMaterial;
  private readonly plateMaterials: THREE.MeshStandardMaterial[] = [];
  private readonly textures: THREE.CanvasTexture[] = [];
  private readonly plates: THREE.Mesh[] = [];

  private phase: Phase = 'idle';
  /** El dado esta esperando que lo lancen (agrandado, adelante y al centro). */
  private waiting = false;
  /** El dado tiene algo que mostrar (esta armado o aparcado). */
  private wanted = false;
  /**
   * La arena esta a la vista. Cuando un panel la tapa (el mazo, la coleccion)
   * el dado se esconde: si no, un cubo al doble de tamano queda flotando
   * delante del carrusel.
   */
  private shown = true;
  /** Velocidad del centro, unidades/s. */
  private readonly velocity = new THREE.Vector3();
  /** Velocidad angular en espacio de mundo, rad/s. */
  private readonly spin = new THREE.Vector3();
  private readonly axis = new THREE.Vector3();
  private readonly step = new THREE.Quaternion();
  private flightTime = 0;

  // Asentamiento: interpola posicion, escala y orientacion a la vez, asi el
  // aterrizaje y el aparcado usan UN solo camino.
  private settleT = 0;
  private settleSeconds = SETTLE_TIME;
  private readonly settleFromQuat = new THREE.Quaternion();
  private readonly settleToQuat = new THREE.Quaternion();
  private readonly settleFromPos = new THREE.Vector3();
  private readonly settleToPos = new THREE.Vector3();
  private settleFromScale = 1;
  private settleToScale = 1;
  private onSettled: (() => void) | null = null;

  /** Ultima velocidad medida del arrastre, suavizada. */
  private readonly dragSpeed = new THREE.Vector3();
  private readonly random = mulberry32(0x1a2b3c4d);

  constructor() {
    this.coreMaterial = new THREE.MeshStandardMaterial({
      color: 0x0d1418,
      roughness: 0.7,
      metalness: 0.25,
    });
    const core = new THREE.Mesh(this.geometry, this.coreMaterial);
    this.group.add(core);

    for (let i = 0; i < 6; i += 1) {
      const value = VALUE_TO_FACE.indexOf(i) + 1;
      const material = new THREE.MeshStandardMaterial({
        roughness: 0.55,
        metalness: 0.15,
        emissive: new THREE.Color(0x0a2a2a),
        emissiveIntensity: 0.6,
      });
      this.plateMaterials.push(material);

      const plate = new THREE.Mesh(this.plateGeometry, material);
      const normal = FACE_NORMALS[i]!;
      plate.position.copy(normal).multiplyScalar(DIE_SIZE / 2 + PLATE_LIFT);
      plate.lookAt(normal.clone().multiplyScalar(DIE_SIZE * 2));
      plate.userData['value'] = value;
      this.plates.push(plate);
      this.group.add(plate);
    }

    this.group.visible = false;
  }

  /** Asigna la textura de cada placa segun la tabla de caras. */
  setFaces(faces: ReadonlyArray<{ value: number; multiplier: number }>): void {
    for (let i = 0; i < 6; i += 1) {
      const value = VALUE_TO_FACE.indexOf(i) + 1;
      const face = faces.find((f) => f.value === value) ?? { value, multiplier: 1 };
      const texture = new THREE.CanvasTexture(createDieFaceCanvas(value, face.multiplier));
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = 8;
      this.textures.push(texture);
      const material = this.plateMaterials[i];
      if (material) {
        material.map = texture;
        material.emissiveMap = texture;
        material.needsUpdate = true;
      }
    }
  }

  setVisible(value: boolean): void {
    this.group.visible = value;
  }

  /**
   * Esconde o vuelve a mostrar el dado sin perder su estado: si estaba armado
   * en el centro, al volver sigue armado en el centro. Se llama cuando un panel
   * tapa la arena.
   */
  setShown(shown: boolean): void {
    this.shown = shown;
    this.applyVisibility();
  }

  private applyVisibility(): void {
    this.group.visible = this.wanted && this.shown;
  }

  /** `true` mientras la tirada esta en el aire o acomodandose. */
  get busy(): boolean {
    return this.phase === 'flight' || this.phase === 'settle';
  }

  /** `true` mientras el dado espera que lo lancen. */
  get armed(): boolean {
    return this.waiting;
  }

  get scale(): number {
    return this.group.scale.x;
  }

  /**
   * Prepara la tirada: el cubo aparece adelante y al centro, agrandado, con un
   * giro lento para que se lea como algo que se puede agarrar.
   */
  arm(): void {
    this.phase = 'idle';
    this.waiting = true;
    this.wanted = true;
    this.applyVisibility();
    this.group.position.copy(THROW_POS);
    this.group.scale.setScalar(THROW_SCALE);
    this.group.quaternion.identity();
    this.velocity.set(0, 0, 0);
    this.spin.set(0, 0, 0);
    this.onSettled = null;
  }

  /**
   * El dedo agarro el cubo. Se guarda la posicion para poder medir la velocidad
   * del gesto: es lo unico que alimenta el impulso de la tirada.
   */
  beginDrag(): void {
    this.phase = 'dragging';
    this.waiting = false;
    this.dragSpeed.set(0, 0, 0);
  }

  /**
   * El cubo sigue al dedo, sobre un plano horizontal. `dt` se usa para
   * promediar la velocidad con suavizado: si se tomara solo el ultimo par de
   * eventos, un temblor del dedo saldria como un latigazo.
   */
  dragTo(x: number, z: number, dt: number): void {
    if (this.phase !== 'dragging') return;

    const px = this.group.position.x;
    const pz = this.group.position.z;
    const step = Math.max(1e-3, dt);
    // Suavizado exponencial (~0.12 s de constante): alcanza para ignorar el
    // ruido del dedo sin comerse la intencion del gesto.
    const k = 1 - Math.pow(0.5, step / 0.12);
    this.dragSpeed.x += ((x - px) / step - this.dragSpeed.x) * k;
    this.dragSpeed.z += ((z - pz) / step - this.dragSpeed.z) * k;

    this.group.position.x = x;
    this.group.position.z = z;
    this.group.position.y = THROW_POS.y;

    // Se inclina hacia donde va: es lo que hace que el cubo parezca tener peso
    // en la mano y no estar pegado al dedo.
    this.group.rotation.z = THREE.MathUtils.clamp(-this.dragSpeed.x * 0.035, -0.5, 0.5);
    this.group.rotation.x = THREE.MathUtils.clamp(this.dragSpeed.z * 0.035, -0.5, 0.5);
  }

  /** Velocidad suavizada del ultimo arrastre, en unidades/s. */
  get dragVelocity(): THREE.Vector3 {
    return this.dragSpeed.clone();
  }

  /**
   * Suelta el cubo. `face` es la cara que el MOTOR ya sorteo: la fisica solo
   * tiene que aterrizar ahi.
   */
  release(face: number, impulse: DieImpulse, onSettled?: () => void): void {
    this.onSettled = onSettled ?? null;
    this.waiting = false;
    this.phase = 'flight';
    this.flightTime = 0;
    this.velocity.set(impulse.vx, impulse.vy, impulse.vz);
    this.spin.set(impulse.spinX, impulse.spinY, impulse.spinZ);
    faceQuaternion(face, this.settleToQuat);

    if (prefersStill()) {
      // Sin animacion: el dado ya esta apoyado y con la cara puesta. Se sigue
      // disparando `onSettled` para que la UI no se quede esperando.
      this.land(face);
      this.phase = 'idle';
      this.finishSettle();
    }
  }

  /**
   * Aparca el dado en su rincon, a tamano natural, mostrando la cara sorteada.
   * Es lo que pasa cuando el ciego ya se eligio.
   */
  park(face: number): void {
    this.waiting = false;
    this.wanted = true;
    this.applyVisibility();
    faceQuaternion(face, this.settleToQuat);
    this.beginSettle(PARK_POS, PARK_SCALE, 0.5);
    this.velocity.set(0, 0, 0);
    this.spin.set(0, 0, 0);
  }

  /** Aparcado de una, sin animacion (arranque de escena, estado ya resuelto). */
  snapToParked(face: number): void {
    this.phase = 'idle';
    this.waiting = false;
    this.wanted = true;
    this.applyVisibility();
    this.group.position.copy(PARK_POS);
    this.group.scale.setScalar(PARK_SCALE);
    faceQuaternion(face, this.group.quaternion);
    this.velocity.set(0, 0, 0);
    this.spin.set(0, 0, 0);
  }

  /**
   * Impulso para una tirada que NO viene de un arrastre (el boton de volver a
   * tirar). Sigue la misma fisica: el dado cae igual que si lo hubieran tirado.
   */
  autoImpulse(power = 1): DieImpulse {
    const angle = this.random() * Math.PI * 2;
    const speed = (5 + this.random() * 3.5) * power;
    const spinMag = (9 + this.random() * 6) * power;
    const axis = new THREE.Vector3(
      this.random() * 2 - 1,
      this.random() * 2 - 1,
      this.random() * 2 - 1,
    ).normalize();
    return {
      vx: Math.cos(angle) * speed,
      vy: 3.4 + this.random() * 1.6,
      vz: Math.sin(angle) * speed * 0.6,
      spinX: axis.x * spinMag,
      spinY: axis.y * spinMag,
      spinZ: axis.z * spinMag,
    };
  }

  /**
   * Avanza la fisica. Se llama una vez por frame desde el bucle de la escena,
   * con el `dt` ya acotado.
   */
  update(dt: number): void {
    if (this.phase === 'idle') {
      // Giro de presentacion: solo mientras espera la tirada (agrandado). El
      // dado aparcado tiene que quedarse quieto mostrando su cara.
      if (this.waiting) this.group.rotation.y += dt * 0.55;
      return;
    }
    if (this.phase === 'dragging') return;
    if (this.phase === 'settle') {
      this.updateSettle(dt);
      return;
    }

    this.updateFlight(dt);
  }

  // -------------------------------------------------------------------------

  private get half(): number {
    return (DIE_SIZE / 2) * this.scale;
  }

  private updateFlight(dt: number): void {
    this.flightTime += dt;

    // --- Giro: rotacion de eje-angulo sobre el eje de la velocidad angular ---
    const spinMag = this.spin.length();
    if (spinMag > 1e-4) {
      this.step.setFromAxisAngle(this.axis.copy(this.spin).divideScalar(spinMag), spinMag * dt);
      // `premultiply` y no `multiply`: la velocidad angular esta en espacio de
      // MUNDO, y multiplicar por derecha la aplicaria en espacio local.
      this.group.quaternion.premultiply(this.step).normalize();
    }

    // --- Traslacion ---
    this.velocity.y += GRAVITY * dt;
    this.group.position.addScaledVector(this.velocity, dt);

    const half = this.half;
    const onGround = this.group.position.y <= half + CONTACT_EPS;

    // --- Piso ---
    if (this.group.position.y < half) {
      this.group.position.y = half;
      if (this.velocity.y < 0) {
        this.velocity.y = -this.velocity.y * RESTITUTION;
        // Un rebote chico se corta: si no, el dado tiembla sobre la losa.
        if (this.velocity.y < MIN_BOUNCE) this.velocity.y = 0;
        this.velocity.x *= 0.74;
        this.velocity.z *= 0.74;
        this.spin.multiplyScalar(0.72);
      }
    }

    // --- Paredes: el dado no puede salirse de la banda de tirada ---
    this.bounceWalls(PLATFORM_LIMIT_X - half, PLATFORM_LIMIT_Z_BACK + half, PLATFORM_LIMIT_Z_FRONT - half);

    // --- Amortiguacion ---
    this.spin.multiplyScalar(Math.pow(0.5, dt / SPIN_HALF_LIFE));
    if (onGround) {
      const damp = Math.pow(0.5, dt / MOVE_HALF_LIFE);
      this.velocity.x *= damp;
      this.velocity.z *= damp;
    }

    // --- En reposo: se acomoda en la cara sorteada ---
    const slow = this.velocity.lengthSq() < 1.4 && this.spin.lengthSq() < 6.25;
    if ((onGround && slow) || this.flightTime > MAX_FLIGHT) {
      this.beginSettle(
        new THREE.Vector3(this.group.position.x, this.half, this.group.position.z),
        this.scale,
        SETTLE_TIME,
      );
    }
  }

  /** Refleja la velocidad si el cubo toco el borde de la banda de tirada. */
  private bounceWalls(limitX: number, zBack: number, zFront: number): void {
    const p = this.group.position;
    if (p.x > limitX) {
      p.x = limitX;
      this.velocity.x = -Math.abs(this.velocity.x) * WALL_RESTITUTION;
    } else if (p.x < -limitX) {
      p.x = -limitX;
      this.velocity.x = Math.abs(this.velocity.x) * WALL_RESTITUTION;
    }
    if (p.z > zFront) {
      p.z = zFront;
      this.velocity.z = -Math.abs(this.velocity.z) * WALL_RESTITUTION;
    } else if (p.z < zBack) {
      p.z = zBack;
      this.velocity.z = Math.abs(this.velocity.z) * WALL_RESTITUTION;
    }
  }

  private land(face: number): void {
    this.group.position.set(this.group.position.x, this.half, this.group.position.z);
    faceQuaternion(face, this.group.quaternion);
  }

  private beginSettle(to: THREE.Vector3, toScale: number, seconds: number): void {
    this.phase = 'settle';
    this.settleT = 0;
    this.settleSeconds = Math.max(0.001, seconds);
    this.settleFromQuat.copy(this.group.quaternion);
    this.settleFromPos.copy(this.group.position);
    this.settleFromScale = this.scale;
    this.settleToPos.copy(to);
    this.settleToScale = toScale;
  }

  private updateSettle(dt: number): void {
    this.settleT += dt / this.settleSeconds;
    const k = Math.min(1, this.settleT);
    // Suave al final: el cubo "se acomoda", no se teletransporta.
    const e = 1 - Math.pow(1 - k, 3);

    this.group.quaternion.slerpQuaternions(this.settleFromQuat, this.settleToQuat, e);
    this.group.position.lerpVectors(this.settleFromPos, this.settleToPos, e);
    this.group.scale.setScalar(this.settleFromScale + (this.settleToScale - this.settleFromScale) * e);

    if (k >= 1) {
      this.phase = 'idle';
      this.finishSettle();
    }
  }

  private finishSettle(): void {
    const done = this.onSettled;
    this.onSettled = null;
    done?.();
  }

  dispose(): void {
    this.geometry.dispose();
    this.plateGeometry.dispose();
    this.coreMaterial.dispose();
    for (const material of this.plateMaterials) material.dispose();
    for (const texture of this.textures) texture.dispose();
  }
}
