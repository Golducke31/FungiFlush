/**
 * CardCarousel.ts — Anillo circular de cartas, scrolleable en horizontal.
 *
 * COMO FUNCIONA: las cartas viven sobre un circulo de radio `R` centrado
 * detras del plano de foco. Un unico numero continuo (`rendered`) dice QUE
 * carta esta al frente: la parte entera es el indice enfocado y la fraccion es
 * el giro del anillo. Cada slot se ubica en el angulo `(k - frac) * STEP`, asi
 * que al scrollear las cartas recorren el anillo de verdad (no un carrusel
 * plano que se desliza): las de los costados se van de perfil y se alejan.
 *
 * POOL, NO UNA CARTA POR ENTRADA: la coleccion tiene ~56 entradas y cada
 * `Card3D` son 3 meshes. Crear una por entrada serian ~170 draw calls. En su
 * lugar hay un pool fijo de slots que se RECICLAN: cuando un slot cambia de
 * indice se le aplica la entrada nueva (textura cacheada, asi que es barato).
 *
 * No conoce el registro de contenido: recibe `createCard`/`applyEntry` del
 * SceneManager. Eso lo mantiene testeable y sin acoplamiento al motor.
 */

import * as THREE from 'three';
import type { Card3D } from './Card3D';

/** Una entrada del carrusel, ya resuelta por quien la provee. */
export interface CarouselEntryView {
  /** Id de la entrada (carta o joker). */
  uid: string;
  /** Id de carta del registro a mostrar, si es una carta. */
  cardId?: string;
  /** Id de joker del registro a mostrar, si es un joker. */
  jokerId?: string;
  /** Nivel de la carta (el mazo muestra cartas mejoradas, no la base). */
  level?: number;
  /**
   * Bonus de mejoras sobre la base. El carrusel del mazo muestra la carta REAL
   * de la run, no la definicion de catalogo: sin esto, subir una carta de nivel
   * actualizaba el detalle del panel pero la carta 3D del anillo seguia
   * dibujando los numeros del nivel 1 (el bug reportado).
   */
  bonusSubstrate?: number;
  bonusSpores?: number;
  /** Si el jugador ya la descubrio. Las no descubiertas se muestran de dorso. */
  discovered: boolean;
}

export interface CarouselOptions {
  /** Fabrica un `Card3D` vacio (lo provee el SceneManager). */
  createCard: () => Card3D;
  /** Aplica una entrada a un slot (textura/cara/dorso). */
  applyEntry: (card: Card3D, entry: CarouselEntryView) => void;
  /** Se llama cuando cambia la entrada enfocada (indice ya normalizado). */
  onFocusChange?: (index: number) => void;
  /** Radio del anillo, en unidades de mundo. */
  radius?: number;
  /** Cuantos slots a cada lado del foco se muestran. */
  halfSpan?: number;
  /** Altura del centro de la carta. Debe dejarla PARADA sobre el piso. */
  lift?: number;
  /**
   * Separacion angular entre slots, en radianes. Por defecto cierra el circulo
   * (`2π / slots`), que es lo correcto para un anillo. Un valor chico abre un
   * ARCO suave: es lo que necesita una fila de 3 recompensas.
   */
  arcStep?: number;
  /**
   * `true` (default): el indice da la vuelta (anillo). `false`: se CLAMPEA a
   * los extremos, que es lo que quiere una eleccion de una sola vez.
   */
  wrap?: boolean;
}

interface Slot {
  card: Card3D;
  /** Indice de entrada que muestra ahora (para no re-aplicar textura). */
  entryIndex: number;
}

/** Velocidad del giro hacia el objetivo. Mas alto = mas pegajoso. */
const EASE = 11;
/** Por debajo de este coseno el slot esta detras: se oculta. */
const BACK_CULL = -0.28;
/**
 * Escala de la carta del fondo del arco visible.
 *
 * Estaba en 0.5: solo la carta del frente llegaba a tamano completo y las de
 * los costados se veian a la mitad, que es lo que se reporto como "los
 * simbiontes se ven chicos". 0.68 mantiene la lectura de profundidad (el frente
 * sigue siendo el mas grande) sin que las de al lado parezcan miniaturas.
 *
 * OJO: agrandar esto tambien agranda el ancho total del arco. Si se sube mas
 * alla de ~0.75 hay que revisar `fitCarousel()` en SceneManager (la camara fija
 * no se recalcula sola) o las puntas se salen de cuadro en 844x390.
 */
const MIN_SCALE = 0.68;
/**
 * Cuanto mas grande se dibuja la carta ENFOCADA respecto de su tamano de arco.
 * Es la senal de "esta es la que estas mirando": sin esto, tocar una carta solo
 * giraba el anillo y nada mas, y el jugador no sabia si su toque habia hecho
 * algo (`onFocusChange` ni siquiera dispara si el foco no cambio).
 */
const FOCUS_SCALE_BOOST = 1.14;
/** Duracion del pulso de seleccion, en segundos. */
const PULSE_SECONDS = 0.34;

export class CardCarousel {
  readonly group = new THREE.Group();

  private readonly options: Required<Pick<CarouselOptions, 'radius' | 'halfSpan' | 'lift'>> &
    CarouselOptions;
  private readonly slots: Slot[] = [];
  private entries: CarouselEntryView[] = [];

  /** Posicion continua: entero = foco, fraccion = giro. */
  private rendered = 0;
  private target = 0;
  private lastFocus = -1;
  private visible = false;
  /** Amplitud del latido de seleccion: 1 al tocar, decae a 0. */
  private pulse = 0;

  constructor(options: CarouselOptions) {
    this.options = {
      ...options,
      radius: options.radius ?? 9,
      halfSpan: options.halfSpan ?? 5,
      // La carta mide 3.2 de alto: a 1.9 su base queda 0.3 sobre el piso.
      lift: options.lift ?? 1.9,
    };
    this.group.visible = false;
  }

  get count(): number {
    return this.entries.length;
  }

  /** Cuantos slots estan en escena (arco del frente). */
  get visibleSlots(): number {
    return this.slots.filter((slot) => slot.card.group.visible).length;
  }

  /** Indice enfocado (normalizado a [0, count)). */
  get focusedIndex(): number {
    if (this.entries.length === 0) return 0;
    return this.wrap(Math.round(this.rendered));
  }

  /** Las entradas actuales (solo lectura). Para verificacion/debug. */
  get currentEntries(): readonly CarouselEntryView[] {
    return this.entries;
  }

  setEntries(entries: readonly CarouselEntryView[]): void {
    this.entries = [...entries];
    this.ensureSlots();
    // Al cambiar de set, todo slot queda "sucio" para re-aplicar.
    for (const slot of this.slots) slot.entryIndex = -1;
    // `rendered` tiene que volver a 0 JUNTO con `target`. Antes solo se reseteaba
    // `target`, asi que el anillo seguia animandose desde donde habia quedado la
    // apertura anterior: al abrir el mazo de nuevo el giro salia de un punto
    // arbitrario y `focus(n)` —que parte de `target`— terminaba girando de mas o
    // de menos segun la sesion. Es el "en algunas cartas se actualiza el
    // carrusel" reportado: el resultado dependia del estado previo.
    this.rendered = 0;
    this.target = 0;
    this.lastFocus = -1;
  }

  /** Cambia el callback de foco (el carrusel se reusa entre aperturas). */
  setOnFocus(fn: (index: number) => void): void {
    this.options.onFocusChange = fn;
  }

  /**
   * Reconfigura el mismo carrusel para OTRA pantalla (coleccion = anillo;
   * mazo = anillo; recompensa = arco de 3 sin wrap). Cambiar `halfSpan` obliga
   * a reconstruir los slots, porque define cuantos hacen falta.
   */
  configure(opts: {
    radius?: number;
    halfSpan?: number;
    arcStep?: number;
    wrap?: boolean;
    lift?: number;
  }): void {
    if (opts.radius !== undefined) this.options.radius = opts.radius;
    if (opts.arcStep !== undefined) this.options.arcStep = opts.arcStep;
    if (opts.wrap !== undefined) this.options.wrap = opts.wrap;
    if (opts.lift !== undefined) this.options.lift = opts.lift;
    if (opts.halfSpan !== undefined && opts.halfSpan !== this.options.halfSpan) {
      this.options.halfSpan = opts.halfSpan;
      this.rebuildSlots();
    }
  }

  private rebuildSlots(): void {
    for (const slot of this.slots) {
      slot.card.dispose();
      this.group.remove(slot.card.group);
    }
    this.slots.length = 0;
    this.ensureSlots();
  }

  setVisible(value: boolean): void {
    this.visible = value;
    this.group.visible = value;
    if (!value) for (const slot of this.slots) slot.card.group.visible = false;
  }

  /** Scroll continuo (rueda del mouse o arrastre). Positivo = avanza. */
  scrollBy(delta: number): void {
    if (this.entries.length === 0) return;
    const next = this.target + delta;
    // Sin wrap no se puede salir de la lista: es una eleccion, no un anillo.
    this.target = this.wrapping ? next : Math.max(0, Math.min(this.entries.length - 1, next));
  }

  /** Salta a una entrada concreta (tap). */
  focus(index: number): void {
    if (this.entries.length === 0) return;
    this.target = Math.round(this.target) + this.shortestDelta(index);
  }

  /**
   * Ancla el anillo en una entrada concreta SIN depender del estado previo.
   *
   * Es distinto de `focus()`: aquel calcula el camino mas corto desde el
   * objetivo actual, lo que da el giro bonito al tocar una carta vecina pero
   * hace que el resultado dependa de donde estaba el anillo. Al ABRIR un panel
   * (el mazo, tras mejorar una carta) no hay "estado previo" que valga: el
   * anillo tiene que quedar parado en la carta pedida, siempre igual. Lo usa
   * `SceneManager.focusCarousel`.
   */
  focusAbs(index: number): void {
    const n = this.entries.length;
    if (n === 0) return;
    const to = this.wrap(index);
    // Se toma la vuelta que deja `rendered` mas cerca de `to` sin salir del
    // rango [0, n): asi el tween no recorre el anillo entero.
    const from = this.wrap(Math.round(this.rendered));
    let delta = to - from;
    if (this.wrapping) {
      if (delta > n / 2) delta -= n;
      if (delta < -n / 2) delta += n;
    }
    this.target = from + delta;
    this.rendered = from + delta;
  }

  /** Delta con signo mas corto para llegar de la entrada actual a `index`. */
  private shortestDelta(index: number): number {
    const n = this.entries.length;
    if (n === 0) return 0;
    const from = this.wrap(Math.round(this.target));
    const to = this.wrap(index);
    if (!this.wrapping) return to - from;
    let d = to - from;
    if (d > n / 2) d -= n;
    if (d < -n / 2) d += n;
    return d;
  }

  private get wrapping(): boolean {
    return this.options.wrap ?? true;
  }

  update(dt: number, time: number): void {
    if (!this.visible || this.entries.length === 0) return;

    // Giro hacia el objetivo con amortiguacion exponencial (independiente del
    // framerate). Da el "peso" del carrusel sin necesidad de un tween.
    const k = 1 - Math.exp(-dt * EASE);
    this.rendered += (this.target - this.rendered) * k;

    const base = Math.round(this.rendered);
    const frac = this.rendered - base;
    // Por defecto el circulo cierra (2π/slots). Un `arcStep` chico abre un arco
    // suave, que es lo que necesita una fila de recompensas.
    const step = this.options.arcStep ?? (Math.PI * 2) / this.slots.length;
    const half = this.options.halfSpan;
    const radius = this.options.radius;

    // Indice que queda DELANTE: define el realce de escala y es lo que se
    // reporta por `onFocusChange` si cambio respecto del frame anterior. Se
    // calcula ANTES del lazo porque el lazo ya necesita saber quien es el foco.
    const focus = this.wrap(base);

    for (let i = 0; i < this.slots.length; i++) {
      const slot = this.slots[i];
      if (!slot) continue;
      const k2 = i - half;
      // Sin wrap, un slot cuyo `base + k2` cae fuera de la lista NO tiene
      // entrada propia: `wrap()` lo clampearia al extremo y quedaria una copia
      // de la primera/ultima carta, pero `angle` (que NO se clampea) la
      // colocaria a 2+ pasos del arco. Eso dejaba cartas fantasma flotando a
      // los costados (y por encima) en el draft de recompensa, que es el unico
      // carrusel con `wrap:false`. La entrada repetida se OCULTA.
      const rawIndex = base + k2;
      if (!this.wrapping && (rawIndex < 0 || rawIndex > this.entries.length - 1)) {
        slot.card.group.visible = false;
        slot.entryIndex = -1;
        continue;
      }
      const index = this.wrap(rawIndex);
      const angle = (k2 - frac) * step;
      const cos = Math.cos(angle);

      // Solo el arco del frente: lo de atras se oculta (no aporta y cuesta).
      const onStage = cos > BACK_CULL;
      slot.card.group.visible = onStage;
      if (!onStage) continue;

      if (slot.entryIndex !== index) {
        const entry = this.entries[index];
        if (entry) this.options.applyEntry(slot.card, entry);
        slot.entryIndex = index;
      }

      const depth = (cos + 1) * 0.5;
      slot.card.home.x = Math.sin(angle) * radius;
      slot.card.home.z = cos * radius - radius;
      slot.card.home.y = this.options.lift;
      slot.card.home.rx = 0;
      slot.card.home.ry = angle;
      slot.card.home.rz = 0;
      slot.card.home.arc = 0;
      slot.card.home.flip = 0;

      // Escala por PROFUNDIDAD (la del frente es la mas grande) mas el realce
      // de la carta enfocada. Va por `setBaseScale`, que es el canal estructural
      // del compositor (el mismo que usan jokers y cartas jugadas): escribir
      // `group.scale` a mano lo pisaria el frame siguiente.
      const isFocused = index === focus;
      const focusedBoost = isFocused ? FOCUS_SCALE_BOOST : 1;
      const scale = MIN_SCALE + (1 - MIN_SCALE) * depth * depth;
      slot.card.setBaseScale(scale * focusedBoost);
      // El SQUASH (`home.s*`) se reserva para el pulso: es aditivo sobre la
      // escala base y no compite con ella.
      const pulse = isFocused ? 1 + 0.06 * this.pulse : 1;
      slot.card.home.sx = pulse;
      slot.card.home.sy = pulse;
      slot.card.update(dt, time);
    }

    // El pulso decae en tiempo real y vuelve a 1: no se queda latiendo.
    if (this.pulse > 0) this.pulse = Math.max(0, this.pulse - dt / PULSE_SECONDS);

    if (focus !== this.lastFocus) {
      this.lastFocus = focus;
      this.options.onFocusChange?.(focus);
    }
  }

  /**
   * Dispara el latido de seleccion sobre la carta enfocada.
   *
   * Es la respuesta VISIBLE al toque. La necesita sobre todo el caso de tocar
   * la carta que YA estaba enfocada: ahi `target` no cambia, `onFocusChange` no
   * dispara y sin este pulso el toque no produce ningun efecto perceptible.
   */
  pulseFocused(): void {
    this.pulse = 1;
  }

  /**
   * Entrada cuyo centro en PANTALLA esta mas cerca del punto tocado.
   *
   * Un carrusel es una FILA horizontal, asi que la distancia se mide en X: el
   * eje en el que las cartas se separan. Medir en euclideo (x^2 + y^2) hacia que
   * un toque en el hueco ENTRE dos cartas o por debajo de su centro no eligiera
   * nada, y el gesto se sintiera muerto. Con X, el toque cae siempre en la carta
   * mas cercana de la fila.
   *
   * `maxDx` filtra el caso de tocar lejisimos del anillo (fuera del carrusel):
   * sin el, cualquier toque en la pantalla moveria el foco.
   *
   * Usa la misma proyeccion que la UI (no un raycast): un raycast contra los
   * meshes falla si el dedo cae entre dos cartas o sobre el halo.
   */
  pickNearest(
    x: number,
    y: number,
    project: (v: THREE.Vector3) => { x: number; y: number },
    maxDx = 260,
  ): number | null {
    let best: { d: number; index: number } | null = null;
    for (const slot of this.slots) {
      if (!slot.card.group.visible) continue;
      const p = project(slot.card.worldPosition());
      const dx = Math.abs(p.x - x);
      if (dx > maxDx) continue;
      // En empate de X (una carta detras de otra), gana la mas cercana en Y.
      const d = dx * 1000 + Math.abs(p.y - y);
      if (!best || d < best.d) best = { d, index: slot.entryIndex };
    }
    return best ? best.index : null;
  }

  /**
   * Centro en PANTALLA del slot que esta enfocado, en px del canvas, o null.
   *
   * Lo usan los tests (y el panel de debug): el carrusel proyecta sus cartas a
   * mano y la carta del frente NO cae en el centro geometrico del canvas —el
   * encuadre la baja para dejar lugar al panel—. Tocar "el centro" a ojo, por
   * eso, agarra una carta VECINA. Esto devuelve el punto exacto que hay que
   * tocar para pegarle a la carta enfocada.
   */
  focusedScreenPoint(project: (v: THREE.Vector3) => { x: number; y: number }): { x: number; y: number } | null {
    const slot = this.slots.find((s) => s.card.group.visible && s.entryIndex === this.focusedIndex);
    if (!slot) return null;
    return project(slot.card.worldPosition());
  }

  /**
   * Cajas en pantalla de TODOS los slots visibles, para medir el ancho real del
   * anillo/arco.
   *
   * Es lo unico que puede medir cuanto ancho ocupa el carrusel: vive en el
   * canvas, asi que las sondas de layout (`probe-reward-shop-width.mjs`) no lo
   * ven desde el DOM. `halfWidthPx` estima media anchura de la carta proyectando
   * su borde derecho en el espacio de la carta (girado por `ry`, el angulo del
   * arco); la proyeccion incluye el encogimiento por perspectiva.
   */
  screenBoxes(project: (v: THREE.Vector3) => { x: number; y: number }): {
    count: number;
    lo: number;
    hi: number;
  } {
    let lo = Infinity;
    let hi = -Infinity;
    let count = 0;
    for (const slot of this.slots) {
      if (!slot.card.group.visible) continue;
      const center = project(slot.card.worldPosition());
      const edgeWorld = slot.card.worldPosition();
      // Media anchura del plano (3.2 de mundo => 1.6) girada por el angulo.
      const half = 1.6;
      const ry = slot.card.home.ry ?? 0;
      edgeWorld.x += Math.cos(ry) * half;
      edgeWorld.z -= Math.sin(ry) * half;
      const edge = project(edgeWorld);
      const hw = Math.abs(edge.x - center.x);
      lo = Math.min(lo, center.x - hw);
      hi = Math.max(hi, center.x + hw);
      count++;
    }
    if (count === 0) return { count: 0, lo: 0, hi: 0 };
    return { count, lo, hi };
  }

  dispose(): void {
    for (const slot of this.slots) {
      slot.card.dispose();
      this.group.remove(slot.card.group);
    }
    this.slots.length = 0;
    this.entries = [];
    this.scene?.remove(this.group);
  }

  private scene: THREE.Object3D | null = null;

  /** Registra el padre para poder desengancharse en `dispose`. */
  attachTo(parent: THREE.Object3D): void {
    this.scene = parent;
    parent.add(this.group);
  }

  private ensureSlots(): void {
    const wanted = this.options.halfSpan * 2 + 1;
    while (this.slots.length < wanted) {
      const card = this.options.createCard();
      card.group.visible = false;
      this.group.add(card.group);
      this.slots.push({ card, entryIndex: -1 });
    }
  }

  private wrap(i: number): number {
    const n = this.entries.length;
    if (n === 0) return 0;
    if (!this.wrapping) return Math.max(0, Math.min(n - 1, i));
    return ((i % n) + n) % n;
  }
}
