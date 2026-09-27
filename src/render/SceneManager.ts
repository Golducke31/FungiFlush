/**
 * SceneManager.ts — La capa visual completa.
 *
 * Responsabilidad unica: ser una VISTA del motor. No decide reglas, no muta
 * estado del juego, no calcula score. Escucha el bus de eventos y traduce
 * "paso X" a "carta que vuela + particulas + shake".
 *
 * Diseno para LANDSCAPE EN MOVIL, que es donde se va a jugar:
 *   - La camara se aleja sola para que el tablero entre en cualquier aspect
 *     ratio (de 1.33 de un iPad a 2.2 de un celular).
 *   - DPR limitado y sin antialias en tactil: el WebView de un celular no
 *     sostiene 60 FPS con MSAA a 3x.
 *   - Un solo THREE.Points para todas las particulas.
 *   - En tactil no hay hover: la elevacion se reserva a la seleccion.
 */

import * as THREE from 'three';
import {
  bus,
  type CardInstance,
  type GameEngine,
  type JokerInstance,
  type ScoreStep,
} from '@engine/index';

import { ArtAssets, artKeyFor, artKeyForJoker } from './ArtAssets';
import { CARD_HEIGHT, CARD_WIDTH, Card3D, disposeSharedGeometry } from './Card3D';
import { CardTextureCache, createCardBackCanvas, createTableCanvas } from './CardTexture';
import { CameraRig } from './CameraRig';
import { Interaction } from './Interaction';
import { SporeField } from './Particles';
import { TweenManager } from './Tween';
import { ELEMENT_COLOR, UI_COLORS } from './palette';

// --- Constantes de layout (unidades de mundo) ---
//
// RESTRICCION DE DISENO: en landscape de celular la pantalla es ancha y BAJA
// (~2.2:1). La camara mira la mesa en angulo, asi que la profundidad Z se
// comprime sobre el alto de pantalla. Cuanto mas profunda sea la mesa (de la
// mano a los jokers), mas chicas se ven las cartas.
//
// Por eso el tablero es COMPACTO en Z: la mano y los jokers estan cerca, y la
// distancia se gasta en ancho (que sobra) en vez de en alto (que falta).
const HAND_Y = 0.16;
const HAND_Z = 3.0;
const JOKER_Y = 0.16;
const JOKER_Z = -3.4;
const JOKER_SCALE = 0.5;
const DECK_X = 7.8;
const DECK_Z = 2.4;
const DISCARD_X = -7.8;
const DISCARD_Z = 2.4;
const PLAY_Y = 0.18;
const PLAY_Z = -0.6;
const PLAY_SCALE = 0.86;

/** Mitad de la profundidad de una carta (para calcular el encuadre). */
const CARD_HALF_DEPTH = CARD_HEIGHT / 2;

/** Cuantos pasos de score se animan. El resto se agrupa para no eternizar la mano. */
const MAX_ANIMATED_STEPS = 22;

export interface SceneCallbacks {
  /** El jugador toco/cliqueo una carta de la mano. */
  onCardClick: (uid: string) => void;
  /** El puntero entro/salio de una carta (solo raton). */
  onHoverChange: (card: CardInstance | null) => void;
  /** Texto flotante de puntos. El render sabe DONDE; la UI sabe COMO dibujarlo. */
  onScorePopup?: (screenX: number, screenY: number, text: string, color: number) => void;
}

export interface SceneOptions {
  canvas: HTMLCanvasElement;
  engine: GameEngine;
  assets: ArtAssets;
  callbacks: SceneCallbacks;
}

export class SceneManager {
  readonly scene = new THREE.Scene();
  readonly rig: CameraRig;
  readonly renderer: THREE.WebGLRenderer;
  readonly tweens = new TweenManager();

  private readonly engine: GameEngine;
  private readonly assets: ArtAssets;
  private readonly callbacks: SceneCallbacks;
  private readonly textures = new CardTextureCache();
  private readonly particles: SporeField;
  private readonly interaction: Interaction;

  private readonly handCards = new Map<string, Card3D>();
  private readonly jokerCards = new Map<string, Card3D>();
  /** Cartas que estan en la zona de puntuacion (ya salieron de la mano). */
  private readonly scoringCards: Card3D[] = [];

  private readonly unsubscribes: Array<() => void> = [];
  private readonly fxQueue: Array<{ at: number; run: () => void }> = [];

  /** Indice de paso dentro de la mano actual (se reinicia en cada jugada). */
  private stepIndex = 0;
  /** Separacion temporal entre pasos de score. */
  private readonly stepStagger = 0.055;

  private clock = 0;
  private frameId = 0;
  private running = false;
  private readonly isTouch: boolean;
  private readonly isMobile: boolean;
  private handSpread = 16.5;

  private deckMesh: THREE.Group | null = null;
  private discardMesh: THREE.Group | null = null;
  private readonly disposables: Array<THREE.Material | THREE.Texture | THREE.BufferGeometry> = [];

  /** 'menu' = escena idle de la pantalla de inicio; 'run' = partida. */
  private mode: 'menu' | 'run' = 'run';
  private readonly menuCards: Card3D[] = [];
  private menuBaseZ: number[] = [];
  private reduceMotion = false;

  constructor(options: SceneOptions) {
    this.engine = options.engine;
    this.assets = options.assets;
    this.callbacks = options.callbacks;

    this.isTouch = matchMedia('(hover: none) and (pointer: coarse)').matches;
    this.isMobile = this.isTouch || /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

    const width = options.canvas.clientWidth || window.innerWidth;
    const height = options.canvas.clientHeight || window.innerHeight;

    this.renderer = new THREE.WebGLRenderer({
      canvas: options.canvas,
      // MSAA es caro en GPU de celular y con estas texturas no se nota.
      antialias: !this.isMobile,
      alpha: false,
      powerPreference: 'high-performance',
      stencil: false,
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;

    this.rig = new CameraRig(width / height, 40);
    this.particles = new SporeField(this.isMobile ? 1200 : 2400);

    this.interaction = new Interaction(options.canvas, {
      onHover: (card) => this.handleHover(card),
      onClick: (card) => this.handleClick(card),
    });
    this.interaction.setCamera(this.rig.camera);

    this.buildWorld();
    this.subscribe();
    this.resize();
  }

  // ==========================================================================
  // Construccion de la escena
  // ==========================================================================

  private buildWorld(): void {
    this.scene.background = new THREE.Color(UI_COLORS.background);
    this.scene.fog = new THREE.Fog(UI_COLORS.background, 30, 62);

    // --- Tapete ---
    const tableTexture = new THREE.CanvasTexture(createTableCanvas(1024));
    tableTexture.colorSpace = THREE.SRGBColorSpace;
    tableTexture.wrapS = THREE.RepeatWrapping;
    tableTexture.wrapT = THREE.RepeatWrapping;
    tableTexture.repeat.set(2, 2);
    tableTexture.anisotropy = 4;

    const tableGeometry = new THREE.PlaneGeometry(90, 64);
    const tableMaterial = new THREE.MeshStandardMaterial({
      map: tableTexture,
      roughness: 0.95,
      metalness: 0.05,
      color: 0xffffff,
    });
    const table = new THREE.Mesh(tableGeometry, tableMaterial);
    table.rotation.x = -Math.PI / 2;
    table.position.y = 0;
    this.scene.add(table);
    this.disposables.push(tableTexture, tableGeometry, tableMaterial);

    // --- Luces (3 nada mas: cada luz extra es un pase de sombreado) ---
    const ambient = new THREE.AmbientLight(0x4a6a86, 1.1);
    const key = new THREE.DirectionalLight(0xcfe6ff, 1.5);
    key.position.set(-6, 18, 12);
    const rim = new THREE.PointLight(0x5fd8e8, 60, 60, 2);
    rim.position.set(0, 9, -8);
    const fill = new THREE.PointLight(0xa78bfa, 40, 50, 2);
    fill.position.set(0, 6, 14);
    this.scene.add(ambient, key, rim, fill);

    // --- Particulas ---
    this.scene.add(this.particles.points);

    // --- Mazo y descarte ---
    this.deckMesh = this.buildPile(DECK_X, DECK_Z, 7);
    this.discardMesh = this.buildPile(DISCARD_X, DISCARD_Z, 4);
    this.scene.add(this.deckMesh, this.discardMesh);
  }

  /** Pila de cartas (mazo o descarte): N planos apilados con el dorso. */
  private buildPile(x: number, z: number, layers: number): THREE.Group {
    const group = new THREE.Group();
    const backTexture = new THREE.CanvasTexture(
      createCardBackCanvas(this.assets.get('cardback')),
    );
    backTexture.colorSpace = THREE.SRGBColorSpace;
    this.disposables.push(backTexture);

    const geometry = new THREE.PlaneGeometry(CARD_WIDTH * 0.92, CARD_HEIGHT * 0.92);
    const material = new THREE.MeshStandardMaterial({
      map: backTexture,
      roughness: 0.7,
      metalness: 0.2,
      emissive: new THREE.Color(0x1a3a4a),
      emissiveIntensity: 0.5,
    });
    this.disposables.push(geometry, material);

    for (let i = 0; i < layers; i++) {
      const layer = new THREE.Mesh(geometry, material);
      layer.rotation.x = -Math.PI / 2;
      layer.rotation.z = (Math.random() - 0.5) * 0.05;
      layer.position.set(
        x + (Math.random() - 0.5) * 0.06,
        0.05 + i * 0.012,
        z + (Math.random() - 0.5) * 0.06,
      );
      group.add(layer);
    }
    return group;
  }

  // ==========================================================================
  // Modos: pantalla de inicio vs partida
  // ==========================================================================

  /**
   * En 'menu' se apagan mazo, descarte y jokers, quedan la mesa, las luces y
   * las particulas, y aparecen unas cartas decorativas a la deriva.
   *
   * OJO con el RNG: las cartas decorativas se eligen con `Math.random`, NO con
   * el RNG del motor. Si consumieran el RNG sembrado, el menu cambiaria la
   * partida siguiente y se romperia la reproducibilidad.
   */
  setMode(mode: 'menu' | 'run', options?: { reduceMotion?: boolean }): void {
    this.reduceMotion = options?.reduceMotion ?? this.reduceMotion;
    if (this.mode === mode) return;
    this.mode = mode;

    const inMenu = mode === 'menu';
    if (this.deckMesh) this.deckMesh.visible = !inMenu;
    if (this.discardMesh) this.discardMesh.visible = !inMenu;
    // Las esporas ambientales se quedan en los dos modos: son un solo
    // THREE.Points y son lo que hace que el menu no se vea como una foto.
    this.particles.setAmbientEnabled(true);

    if (inMenu) this.buildMenuDecor();
    else this.clearMenuDecor();
  }

  private buildMenuDecor(): void {
    if (this.reduceMotion || this.menuCards.length > 0) return;

    const pool = this.engine.registry.allCards();
    if (pool.length === 0) return;

    const count = Math.min(6, pool.length);
    for (let i = 0; i < count; i++) {
      const def = pool[Math.floor(Math.random() * pool.length)];
      if (!def) continue;
      const card = this.engine.registry.instantiateFrom(def);
      const card3d = this.createCard3D(card);

      // Se colocan AL FONDO de la mesa (Z muy negativo): es la banda alta de la
      // pantalla, la unica que el panel del menu deja libre. En el centro
      // quedarian tapadas por el propio panel.
      const t = count === 1 ? 0.5 : i / (count - 1);
      const x = -11 + t * 22;
      const z = -7.5 + Math.sin(i * 1.7) * 1.8;

      card3d.home.x = x;
      card3d.home.y = 0.34;
      card3d.home.z = z;
      card3d.home.rx = -Math.PI / 2;
      card3d.home.rz = (Math.random() - 0.5) * 0.3;
      card3d.snapToHome();

      this.menuCards.push(card3d);
      this.menuBaseZ.push(z);
    }
  }

  private clearMenuDecor(): void {
    for (const card3d of this.menuCards) {
      this.tweens.cancelFor(card3d.home);
      card3d.dispose();
      this.scene.remove(card3d.group);
    }
    this.menuCards.length = 0;
    this.menuBaseZ.length = 0;
  }

  /** Deriva lenta de las cartas del menu. Se anima en el loop, sin tweens. */
  private updateMenuDecor(dt: number): void {
    this.menuCards.forEach((card3d, i) => {
      const t = this.clock * 0.28 + i * 1.31;
      card3d.home.y = 0.32 + Math.sin(t) * 0.16;
      card3d.home.z = (this.menuBaseZ[i] ?? 0) + Math.cos(t * 0.72) * 0.45;
      card3d.home.rz = Math.sin(t * 0.5) * 0.14;
      card3d.update(dt, this.clock);
    });
  }

  // ==========================================================================
  // Suscripciones al bus (aca el motor se vuelve imagen)
  // ==========================================================================

  private subscribe(): void {
    this.unsubscribes.push(
      bus.on('state:changed', ({ round }) => {
        if (round) this.syncHand(round.hand, this.engine.round?.selected ?? []);
        this.syncJokers(this.engine.run.jokers);
      }),

      bus.on('card:played', ({ card, index }) => {
        // Primer carta de la mano: se reinicia la secuencia de puntuacion.
        if (index === 0) this.stepIndex = 0;
        this.queueFx(index * 0.085, () => this.moveToPlayZone(card.uid));
      }),

      bus.on('card:discarded', ({ card, index }) => {
        this.queueFx(index * 0.06, () => this.flyToDiscard(card.uid));
      }),

      bus.on('card:drawn', ({ card }) => {
        this.queueFx(0.05, () => this.flyInFromDeck(card));
      }),

      bus.on('score:step', ({ step }) => this.onScoreStep(step)),

      // Al cerrar la mano, las cartas de la zona de puntuacion se retiran.
      // Sin esto se acumularian en la mesa partida tras partida.
      bus.on('score:hand', () => this.retireScoringCards(0.9)),

      bus.on('trigger:chain', ({ fromId, toId, depth }) => {
        this.queueFx(0.02, () => this.drawChain(fromId, toId, depth));
      }),

      bus.on('trigger:fired', ({ sourceId, depth }) => {
        // Un joker que dispara merece que se note.
        const joker = this.jokerCards.get(sourceId);
        if (joker) this.queueFx(0.02, () => this.pulseJoker(joker, depth));
      }),

      bus.on('round:win', () => this.celebrate()),
      bus.on('round:loss', () => this.doom()),

      bus.on('card:destroyed', ({ card }) => {
        const target = this.handCards.get(card.uid);
        if (target) this.queueFx(0, () => this.dissolve(target));
      }),

      bus.on('i18n:changed', () => this.rebuildTextures()),
    );
  }

  // ==========================================================================
  // Sincronizacion con el estado
  // ==========================================================================

  private syncHand(cards: readonly CardInstance[], selectedUids: readonly string[]): void {
    const alive = new Set(cards.map((c) => c.uid));

    // --- Fuera: cartas que ya no estan en la mano ---
    for (const [uid, card3d] of [...this.handCards]) {
      if (alive.has(uid)) continue;
      this.handCards.delete(uid);
      // Si esta en la zona de puntuacion, la maneja la secuencia de scoring.
      if (!this.scoringCards.includes(card3d)) {
        this.tweens.cancelFor(card3d.home);
        card3d.dispose();
        this.scene.remove(card3d.group);
      }
    }

    // --- Dentro: cartas nuevas ---
    for (const card of cards) {
      let card3d = this.handCards.get(card.uid);
      if (!card3d) {
        card3d = this.createCard3D(card);
        this.handCards.set(card.uid, card3d);
        // Aparece desde el mazo.
        card3d.home.x = DECK_X;
        card3d.home.y = 0.05;
        card3d.home.z = DECK_Z;
      } else {
        card3d.setCard(card, this.textures, this.lang(), this.artForCard(card));
      }
      card3d.setSelected(selectedUids.includes(card.uid));
    }

    this.layoutHand();
    this.refreshTargets();
  }

  private syncJokers(jokers: readonly JokerInstance[]): void {
    const alive = new Set(jokers.map((j) => j.uid));

    for (const [uid, card3d] of [...this.jokerCards]) {
      if (alive.has(uid)) continue;
      this.jokerCards.delete(uid);
      card3d.dispose();
      this.scene.remove(card3d.group);
    }

    for (const joker of jokers) {
      let card3d = this.jokerCards.get(joker.uid);
      if (!card3d) {
        card3d = this.createCard3D(null, joker);
        this.jokerCards.set(joker.uid, card3d);
      } else {
        card3d.setJoker(joker, this.textures, this.lang(), this.artForJoker(joker));
      }
    }

    this.layoutJokers();
    this.refreshTargets();
  }

  private createCard3D(card: CardInstance | null, joker?: JokerInstance): Card3D {
    const uid = card?.uid ?? joker?.uid ?? `tmp_${Math.random()}`;
    const isJoker = !!joker;
    const elementColor = card ? ELEMENT_COLOR[card.def.element] : 0x8fd8e8;
    const rarity = card?.def.rarity ?? joker?.def.rarity ?? 'common';

    const card3d = new Card3D(uid, isJoker ? 'joker' : 'card', elementColor, rarity);
    if (card) card3d.setCard(card, this.textures, this.lang(), this.artForCard(card));
    if (joker) card3d.setJoker(joker, this.textures, this.lang(), this.artForJoker(joker));

    if (isJoker) card3d.group.scale.setScalar(JOKER_SCALE);
    this.scene.add(card3d.group);
    card3d.snapToHome();
    return card3d;
  }

  private artForCard(card: CardInstance): HTMLImageElement | undefined {
    return this.assets.get(artKeyFor(card.def.element, card.def.rarity));
  }

  private artForJoker(joker: JokerInstance): HTMLImageElement | undefined {
    // El elemento del joker se deduce de su primer efecto con condicion de
    // elemento; si no tiene, cae al arquetipo de micelio.
    const effects = joker.def.effects;
    for (const effect of effects) {
      for (const cond of effect.conditions ?? []) {
        if (cond.type === 'element_is') {
          return this.assets.get(artKeyForJoker(cond.value, joker.def.rarity));
        }
      }
    }
    return this.assets.get(artKeyForJoker('neutral', joker.def.rarity));
  }

  private lang(): string {
    return document.documentElement.lang || 'en';
  }

  // ==========================================================================
  // Layout
  // ==========================================================================

  private layoutHand(): void {
    const cards = [...this.handCards.values()];
    const count = cards.length;
    if (count === 0) return;

    const spacing = count <= 1 ? 0 : Math.min(2.32, this.handSpread / (count - 1));
    const total = spacing * (count - 1);

    cards.forEach((card, i) => {
      const x = -total / 2 + i * spacing;
      const t = total === 0 ? 0 : x / (total / 2);
      const home = card.home;

      this.tweens.to(
        home,
        {
          x,
          y: HAND_Y - Math.abs(t) * 0.1,
          z: HAND_Z + t * t * 0.5,
          rx: -Math.PI / 2,
          ry: 0,
          rz: -x * 0.016,
        },
        { duration: 0.42, ease: 'backOut' },
      );
    });
  }

  private layoutJokers(): void {
    const cards = [...this.jokerCards.values()];
    const count = cards.length;
    if (count === 0) return;

    const spacing = 1.5;
    const total = spacing * (count - 1);

    cards.forEach((card, i) => {
      const x = -total / 2 + i * spacing;
      this.tweens.to(
        card.home,
        { x, y: JOKER_Y, z: JOKER_Z, rx: -Math.PI / 2, ry: 0, rz: 0 },
        { duration: 0.36, ease: 'cubicOut' },
      );
    });
  }

  private moveToPlayZone(uid: string): void {
    const card3d = this.handCards.get(uid);
    if (!card3d) return;

    this.handCards.delete(uid);
    this.scoringCards.push(card3d);
    card3d.setSelected(false);
    card3d.group.scale.setScalar(PLAY_SCALE);

    const index = this.scoringCards.length - 1;
    const spacing = 2.05;
    const total = spacing * Math.max(0, this.scoringCards.length - 1);
    const x = -total / 2 + index * spacing;

    this.tweens.to(
      card3d.home,
      { x, y: PLAY_Y, z: PLAY_Z, rx: -Math.PI / 2, ry: 0, rz: 0 },
      {
        duration: 0.42,
        ease: 'backOut',
        onComplete: () => {
          this.particles.burst(card3d.worldPosition(), 14, {
            color: card3d.elementColor,
            speed: 1.9,
            upward: 1.6,
            size: 0.07,
            life: 0.85,
          });
          this.rig.addShake(0.035);
        },
      },
    );
  }

  private flyToDiscard(uid: string): void {
    const card3d = this.handCards.get(uid);
    if (!card3d) return;
    this.handCards.delete(uid);

    this.tweens.to(
      card3d.home,
      { x: DISCARD_X + (Math.random() - 0.5) * 0.4, y: 0.4, z: DISCARD_Z, rz: (Math.random() - 0.5) * 0.5 },
      {
        duration: 0.45,
        ease: 'quadOut',
        onComplete: () => {
          this.particles.burst(card3d.worldPosition(), 8, {
            color: 0x7a8794,
            speed: 1.1,
            upward: 0.8,
            size: 0.05,
            life: 0.6,
          });
          this.retire(card3d);
        },
      },
    );
  }

  private flyInFromDeck(card: CardInstance): void {
    const card3d = this.handCards.get(card.uid);
    if (!card3d) return;
    // `layoutHand` ya lo mueve a su lugar; esto solo agrega el destello de salida.
    this.particles.burst(new THREE.Vector3(DECK_X, 0.5, DECK_Z), 6, {
      color: 0x5fd8e8,
      speed: 1.2,
      upward: 1.0,
      size: 0.05,
      life: 0.5,
    });
  }

  private onScoreStep(step: ScoreStep): void {
    const index = this.stepIndex++;
    if (index >= MAX_ANIMATED_STEPS) return;

    this.queueFx(0.42 + index * this.stepStagger, () => {
      const origin = this.findWorldPosition(step.sourceId, step.targetUid);
      const color = this.colorForAction(step.action, origin.color);

      this.particles.burst(origin.position, step.action === 'MULTIPLY_SPORES' ? 18 : 10, {
        color,
        speed: step.action === 'MULTIPLY_SPORES' ? 2.6 : 1.8,
        upward: 1.8,
        size: step.action === 'MULTIPLY_SPORES' ? 0.09 : 0.065,
        life: 0.9,
      });

      if (step.action === 'MULTIPLY_SPORES') this.rig.addShake(0.05);

      if (this.callbacks.onScorePopup) {
        const screen = this.projectToScreen(origin.position);
        const sign = step.value >= 0 ? '+' : '';
        const text =
          step.action === 'MULTIPLY_SPORES'
            ? `x${step.value}`
            : `${sign}${Math.round(step.value)}`;
        this.callbacks.onScorePopup(screen.x, screen.y, text, color);
      }
    });
  }

  private drawChain(fromId: string, toId: string, depth: number): void {
    const from = this.findWorldPosition(fromId, undefined);
    const to = this.findWorldPosition(toId, undefined);
    const distance = from.position.distanceTo(to.position);
    if (distance < 0.05) return;

    this.particles.stream(from.position, to.position, this.isMobile ? 10 : 18, to.color, 1.4);
    // Shake mas fuerte cuanto mas profunda la cadena: comunica el combo.
    this.rig.addShake(Math.min(0.16, 0.03 + depth * 0.012));
  }

  private pulseJoker(card3d: Card3D, depth: number): void {
    const base = JOKER_SCALE;
    this.tweens.to(
      card3d.group.scale,
      { x: base * 1.22, y: base * 1.22, z: base * 1.22 },
      {
        duration: 0.1,
        ease: 'quadOut',
        onComplete: () => {
          this.tweens.to(card3d.group.scale, { x: base, y: base, z: base }, { duration: 0.22 });
        },
      },
    );
    this.particles.burst(card3d.worldPosition(), 10, {
      color: 0x5fd8e8,
      speed: 1.8,
      upward: 1.2,
      size: 0.055,
      life: 0.7,
    });
    this.rig.addShake(Math.min(0.12, 0.02 + depth * 0.01));
  }

  private celebrate(): void {
    this.rig.addShake(0.32);
    const center = new THREE.Vector3(0, 0.6, PLAY_Z);
    this.particles.burst(center, this.isMobile ? 70 : 130, {
      color: 0x4fd18b,
      speed: 5.2,
      upward: 3.4,
      size: 0.11,
      life: 1.5,
    });
    this.particles.burst(center, this.isMobile ? 40 : 70, {
      color: 0xffc857,
      speed: 3.8,
      upward: 4.2,
      size: 0.09,
      life: 1.7,
    });
    this.retireScoringCards(0.4);
  }

  private doom(): void {
    this.rig.addShake(0.5);
    this.particles.burst(new THREE.Vector3(0, 0.5, PLAY_Z), 80, {
      color: 0xe05c8a,
      speed: 3.4,
      upward: 0.4,
      size: 0.09,
      life: 1.2,
    });
  }

  private dissolve(card3d: Card3D): void {
    const origin = card3d.worldPosition();
    this.particles.burst(origin, 34, {
      color: 0xe05c8a,
      speed: 2.8,
      upward: 0.8,
      size: 0.09,
      life: 1.1,
    });
    this.rig.addShake(0.14);
    this.retire(card3d);
  }

  /** Saca una carta de escena con una animacion corta. */
  private retire(card3d: Card3D): void {
    this.tweens.to(
      card3d.home,
      { y: -1.2, rz: card3d.home.rz + 0.6 },
      {
        duration: 0.35,
        ease: 'quadIn',
        onComplete: () => {
          card3d.dispose();
          this.scene.remove(card3d.group);
        },
      },
    );
  }

  private retireScoringCards(delay = 0.6): void {
    this.queueFx(delay, () => {
      for (const card of this.scoringCards) this.retire(card);
      this.scoringCards.length = 0;
    });
  }

  private rebuildTextures(): void {
    this.textures.clear();
    for (const card3d of this.handCards.values()) {
      if (card3d.card) card3d.setCard(card3d.card, this.textures, this.lang(), this.artForCard(card3d.card));
    }
    for (const card3d of this.jokerCards.values()) {
      if (card3d.joker) {
        card3d.setJoker(card3d.joker, this.textures, this.lang(), this.artForJoker(card3d.joker));
      }
    }
    // El dorso tambien lleva texto de nada, pero se regenera por consistencia.
    const back = this.assets.get('cardback');
    if (back && this.deckMesh) {
      const texture = new THREE.CanvasTexture(createCardBackCanvas(back));
      texture.colorSpace = THREE.SRGBColorSpace;
      for (const child of this.deckMesh.children) {
        const mesh = child as THREE.Mesh;
        const material = mesh.material as THREE.MeshStandardMaterial;
        material.map = texture;
        material.needsUpdate = true;
      }
    }
  }

  // ==========================================================================
  // Interaccion
  // ==========================================================================

  private handleClick(card: Card3D): void {
    if (card.kind !== 'card') return;
    this.callbacks.onCardClick(card.uid);
  }

  private handleHover(card: Card3D | null): void {
    for (const candidate of this.handCards.values()) {
      candidate.setHover(candidate === card);
    }
    if (card?.card) this.callbacks.onHoverChange(card.card);
    else this.callbacks.onHoverChange(null);
  }

  private refreshTargets(): void {
    const targets: THREE.Object3D[] = [];
    for (const card3d of this.handCards.values()) targets.push(card3d.pickTarget);
    this.interaction.setTargets(targets);
  }

  // ==========================================================================
  // Loop
  // ==========================================================================

  start(): void {
    if (this.running) return;
    this.running = true;
    this.clock = 0;
    let last = performance.now();

    const frame = (now: number) => {
      if (!this.running) return;
      this.frameId = requestAnimationFrame(frame);

      // dt acotado: si la pestana estuvo en background, no queremos un salto.
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      this.clock += dt;

      this.runFxQueue();
      this.tweens.update(dt);
      for (const card3d of this.handCards.values()) card3d.update(dt, this.clock);
      for (const card3d of this.jokerCards.values()) card3d.update(dt, this.clock);
      for (const card3d of this.scoringCards) card3d.update(dt, this.clock);
      if (this.mode === 'menu') this.updateMenuDecor(dt);

      this.particles.update(dt);
      this.rig.update(dt, this.clock);

      // Se renderiza SIEMPRE, tambien en el menu.
      //
      // Ojo: saltarse frames enteros (un `return` temprano dentro del rAF)
      // deja el canvas sin presentar y rompe cualquier captura externa del
      // WebView (por ejemplo, la captura de pantalla de Play o un test
      // headless). El ahorro de bateria del menu viene por otro lado: 6
      // cartas decorativas, sin MSAA, DPR acotado y cero logica de juego.
      this.renderer.render(this.scene, this.rig.camera);
    };

    this.frameId = requestAnimationFrame(frame);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.frameId);
  }

  private queueFx(delay: number, run: () => void): void {
    this.fxQueue.push({ at: this.clock + delay, run });
  }

  private runFxQueue(): void {
    if (this.fxQueue.length === 0) return;
    const pending: typeof this.fxQueue = [];
    for (const fx of this.fxQueue) {
      if (fx.at <= this.clock) fx.run();
      else pending.push(fx);
    }
    this.fxQueue.length = 0;
    this.fxQueue.push(...pending);
  }

  // ==========================================================================
  // Utilidades
  // ==========================================================================

  private findWorldPosition(
    sourceId: string,
    targetUid: string | undefined,
  ): { position: THREE.Vector3; color: number } {
    const direct =
      this.handCards.get(sourceId) ?? this.jokerCards.get(sourceId) ?? null;
    if (direct) return { position: direct.worldPosition(), color: direct.elementColor };

    const scoring = this.scoringCards.find((c) => c.uid === sourceId);
    if (scoring) return { position: scoring.worldPosition(), color: scoring.elementColor };

    // Combos y efectos globales: el centro de la mesa.
    const center = new THREE.Vector3(0, 0.4, PLAY_Z);
    if (targetUid) {
      const target = this.scoringCards.find((c) => c.uid === targetUid);
      if (target) return { position: target.worldPosition(), color: target.elementColor };
    }
    return { position: center, color: 0x5fd8e8 };
  }

  private colorForAction(action: ScoreStep['action'], fallback: number): number {
    switch (action) {
      case 'ADD_SUBSTRATE':
      case 'MULTIPLY_SUBSTRATE':
        return UI_COLORS.substrate;
      case 'ADD_SPORES':
      case 'MULTIPLY_SPORES':
      case 'SET_SPORES':
        return UI_COLORS.spores;
      case 'GAIN_MONEY':
        return UI_COLORS.money;
      default:
        return fallback;
    }
  }

  /** Mundo -> pantalla (para los numeros flotantes del HUD). */
  projectToScreen(position: THREE.Vector3): { x: number; y: number } {
    const ndc = position.clone().project(this.rig.camera);
    const width = this.renderer.domElement.clientWidth;
    const height = this.renderer.domElement.clientHeight;
    return {
      x: (ndc.x * 0.5 + 0.5) * width,
      y: (-ndc.y * 0.5 + 0.5) * height,
    };
  }

  // ==========================================================================
  // Resize
  // ==========================================================================

  resize(): void {
    const canvas = this.renderer.domElement;
    const width = canvas.clientWidth || window.innerWidth;
    const height = canvas.clientHeight || window.innerHeight;
    const aspect = width / Math.max(1, height);

    // DPR limitado: en celular, 3x de DPR mata el framerate sin verse mejor.
    const maxDpr = this.isMobile ? 1.75 : 2;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, maxDpr));
    this.renderer.setSize(width, height, false);

    this.rig.resize(aspect);

    // En pantallas anchas la mano puede abrirse; en angostas se compacta.
    this.handSpread = aspect > 1.75 ? 16.5 : aspect > 1.45 ? 14 : 12;

    // El encuadre se DERIVA del layout real, no de un numero a ojo: si se
    // mueve la mano o los jokers, la camara se reajusta sola.
    const bounds = {
      topZ: HAND_Z + CARD_HALF_DEPTH,
      bottomZ: JOKER_Z - CARD_HALF_DEPTH * JOKER_SCALE,
      width: this.handSpread + CARD_WIDTH + 0.6,
    };

    // Corrimiento del encuadre hacia la mano. 0.72 del alto visible del HUD
    // inferior (que en un celular en landscape es ~19% de la pantalla).
    const bias = 0.72;
    const biasZ = bounds.bottomZ + (bounds.topZ - bounds.bottomZ) * bias;

    this.rig.fit(aspect, bounds, biasZ);

    this.layoutHand();
    this.layoutJokers();
  }

  dispose(): void {
    this.stop();
    for (const unsubscribe of this.unsubscribes) unsubscribe();
    this.unsubscribes.length = 0;
    this.interaction.dispose();

    for (const card3d of this.handCards.values()) card3d.dispose();
    for (const card3d of this.jokerCards.values()) card3d.dispose();
    for (const card3d of this.scoringCards) card3d.dispose();
    this.handCards.clear();
    this.jokerCards.clear();
    this.scoringCards.length = 0;

    this.textures.clear();
    this.particles.dispose();
    for (const item of this.disposables) item.dispose();
    disposeSharedGeometry();
    this.renderer.dispose();
  }

  /** Resumen para el panel de debug. */
  stats(): Record<string, number> {
    return {
      hand: this.handCards.size,
      jokers: this.jokerCards.size,
      scoring: this.scoringCards.length,
      particles: this.particles.activeCount,
      tweens: this.tweens.activeCount,
      textures: this.textures.size,
      drawCalls: this.renderer.info.render.calls,
      triangles: this.renderer.info.render.triangles,
    };
  }
}
