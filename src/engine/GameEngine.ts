/**
 * GameEngine.ts — Orquestador del bucle de juego.
 *
 * Es el unico punto de entrada al motor. El render de Three.js y el HUD en DOM
 * NO llaman a nada mas que a este objeto, y solo se enteran de lo que pasa
 * suscribiendose al bus de eventos.
 *
 *   Render / HUD  ---(lee)-->  bus de eventos
 *        |                          ^
 *        v                          |
 *   playHand() / discard() ...  GameEngine  ->  TriggerEngine -> acciones
 *
 * Flujo roguelite completo:
 *   blind_select -> playing -> (win) shop -> blind_select -> ... -> victory
 *                          -> (loss) game_over
 */

import {
  ANTE_BASE_TARGET,
  DIE_FACES,
  ECONOMY,
  MAX_HAND_SIZE,
  MAX_PLAY_SIZE_DEFAULT,
} from './constants';
import { bus } from './events';
import { RNG } from './rng';
import { ResolutionContext } from './resolution';
import { CardRegistry, type ContentBundle } from './cards/CardRegistry';
import { Deck } from './cards/Deck';
import { OfferService } from './offers/OfferService';
import { UpgradeService, type UpgradeQuote } from './upgrades/UpgradeService';
import { EvolutionService, type EvolutionOption } from './evolution/EvolutionService';
import { ScoreCalculator, breakdownOf } from './scoring/ScoreCalculator';
import { TriggerEngine } from './triggers/TriggerEngine';
import { applyAction } from './triggers/actions';
import { createRoundState, selectedCards, type RoundState } from './state/RoundState';
import {
  applyInterludeModifiers,
  immediateInterludeEffects,
  pickInterlude,
  type InterludeDefinition,
  type InterludeEffect,
} from './interlude/interlude';
import {
  advanceMissions,
  MAX_ACTIVE_MISSIONS,
  pickMissions,
  type MissionDef,
  type MissionState,
} from './missions/missions';
import {
  combineModifiers,
  createRunState,
  discountedCost,
  jokerSellValue,
  rerollCost,
  setAscensionResolver,
  type RunState,
} from './state/RunState';
import type {
  AscensionDefinition,
  BlindDefinition,
  CardDefinition,
  CardInstance,
  DieRoll,
  ElementType,
  JokerDefinition,
  JokerInstance,
  Rarity,
  RoundSnapshot,
  RunSnapshot,
  ScoreBreakdown,
  ShopOffer,
  StatusType,
  VoucherDefinition,
  VoucherRunModifiers,
} from './types';

const MAX_PLAY_SIZE = MAX_PLAY_SIZE_DEFAULT;

/** Probabilidad de que un interludio aparezca al salir de la tienda (P2.4). */
const INTERLUDE_CHANCE = 0.4;
/** El mazo nunca baja de este tamano por un purgado de interludio. */
const MIN_DECK_SIZE = 5;
/**
 * Simbionte legendario del dado: id de contenido y cada cuantas manos jugadas se
 * recarga su habilidad. Ver `useLoadedDie`.
 */
export const LOADED_DIE_JOKER_ID = 'joker_loaded_die';
const LOADED_DIE_EVERY = 2;

/** Eventos que el motor emite por si mismo (fuera de una mano jugada). */
export type GlobalTriggerEvent =
  | 'ON_RUN_START'
  | 'ON_BLIND_SELECTED'
  | 'ON_ROUND_START'
  | 'ON_ROUND_WIN'
  | 'ON_ROUND_LOSS'
  | 'ON_SHOP_ENTER'
  | 'ON_SHOP_EXIT'
  | 'ON_HAND_SCORED';

export interface GameEngineOptions {
  seed?: number;
  /** Carga contenido ya parseado (JSON importado en el browser o leido con fs). */
  bundle: ContentBundle;
  /**
   * Filtro de cartas por DLC (lo produce `PackGate`). El motor no sabe que
   * existen los packs: solo aplica un predicado.
   */
  contentFilter?: (def: CardDefinition) => boolean;
  jokerFilter?: (def: JokerDefinition) => boolean;
  /** Hash del contenido, para detectar rebalanceos entre versiones. */
  contentHash?: string | null;
  /** Packs activos al arrancar la run. */
  packIds?: string[];
  /**
   * Mazo inicial elegido por el perfil. Si esta, REEMPLAZA al mazo `starter`
   * del contenido. El motor no sabe de donde sale (recompensa, DLC, modo): solo
   * lo aplica. Ver `CardRegistry.buildStarterDeck`.
   */
  starterOverrides?: Array<{ cardId: string; copies: number }>;
  /**
   * Definiciones de mision de run (P2.6). Las carga el controlador desde
   * `src/data/missions.json`; el motor no conoce el archivo. Sin esto, la run
   * simplemente no tiene objetivos intermedios.
   */
  missions?: MissionDef[];
  /**
   * Mazo inicial del ARQUETIPO elegido. Si esta, gana sobre `starterOverrides`
   * (que es el mazo del perfil): el arquetipo define la run entera, mientras que
   * `starterOverrides` son copias extra ganadas en el pase.
   */
  archetypeStarter?: Array<{ cardId: string; copies: number }>;
  /** Elementos que la tienda prioriza para el arquetipo elegido. */
  archetypeBias?: ElementType[];
}

export class GameEngine {
  readonly registry = new CardRegistry();
  readonly rng: RNG;

  private readonly triggers: TriggerEngine;
  private readonly scorer: ScoreCalculator;
  private readonly offers: OfferService;
  private readonly upgrades: UpgradeService;
  private readonly evolutions: EvolutionService;

  private readonly contentFilter?: (def: CardDefinition) => boolean;
  private readonly jokerFilter?: (def: JokerDefinition) => boolean;
  private readonly contentHash: string | null;
  private readonly packIds: string[];
  private readonly starterOverrides?: Array<{ cardId: string; copies: number }>;
  /** Mazo que gana sobre `starterOverrides` cuando la run tiene arquetipo. */
  private archetypeStarter?: Array<{ cardId: string; copies: number }>;
  /**
   * Elementos que el ARQUETIPO de la run favorece en la tienda.
   *
   * El motor NO sabe que existen los arquetipos (no conoce `archetypes.json`):
   * el controlador le pasa la lista de ids que prioriza y el motor solo la usa
   * como peso. Vacia = sin sesgo, que es el arquetipo clasico.
   */
  private archetypeBias: ElementType[] = [];

  run!: RunState;
  round: RoundState | null = null;

  /**
   * Contador del Simbionte `joker_loaded_die`: manos jugadas desde la ultima vez
   * que se uso el dado. `0` = habilidad lista; cada mano jugada lo baja hasta
   * `LOADED_DIE_EVERY` cuando se usa el dado. La PRIMERA vez arranca en 0, para
   * que comprar el Simbionte se sienta como un premio y no como una espera.
   * Se reinicia al usar el dado, no al empezar la ronda.
   */
  private loadedDieChargeLeft = 0;

  /** Draft de recompensa pendiente (se sortea al ganar el blind). */
  private reward: { offers: ShopOffer[]; pick: number; allowSkip: boolean } | null = null;
  private rewardPicked = 0;

  /** Interludio pendiente de decision (P2.4). */
  private pendingInterlude: InterludeDefinition | null = null;

  /** Definiciones de mision cargadas desde el contenido (P2.6). */
  private missionDefs: MissionDef[] = [];
  /** `true` mientras `restore` reconstruye la run: suprime el sorteo de misiones. */
  private restoring = false;

  constructor(opts: GameEngineOptions) {
    this.rng = new RNG(opts.seed ?? Date.now());
    this.registry.load(opts.bundle);
    this.triggers = new TriggerEngine(this.registry, this.rng);
    this.scorer = new ScoreCalculator(this.triggers, this.registry, this.rng);
    this.offers = new OfferService(this.registry, opts.bundle.offers ?? []);
    this.upgrades = new UpgradeService(opts.bundle.upgrades ?? []);
    this.evolutions = new EvolutionService(opts.bundle.evolutions ?? [], this.registry);
    this.contentFilter = opts.contentFilter;
    this.jokerFilter = opts.jokerFilter;
    this.contentHash = opts.contentHash ?? null;
    this.packIds = opts.packIds ?? ['base'];
    this.starterOverrides = opts.starterOverrides;
    this.archetypeStarter = opts.archetypeStarter;
    this.archetypeBias = opts.archetypeBias ?? [];
    this.missionDefs = opts.missions ?? [];

    // El estado de la run es puro y no conoce el contenido, asi que la tabla de
    // ascensiones se le INYECTA. Se hace en el constructor y no al arrancar la
    // run: `createRunState` la consulta, y dejar la inyeccion para despues
    // significaria que el primer `startRun` corre sin tabla.
    setAscensionResolver((level) => this.registry.ascension(level).modifiers);
  }

  // ==========================================================================
  // Menu (pantalla de inicio)
  // ==========================================================================

  /**
   * Estado idle previo a una run. `run` queda no-nulo para que el render y el
   * HUD no necesiten chequeos extra, y `status` pasa a 'menu'.
   */
  enterMenu(): void {
    const deck = new Deck(this.rng);
    this.run = createRunState(this.rng.getSeed(), deck);
    this.run.status = 'menu';
    this.round = null;
    this.resetTransient();
    this.emitState();
  }

  // ==========================================================================
  // Ciclo de vida de la run
  // ==========================================================================

  /**
   * Inyecta el mazo y el sesgo del arquetipo elegido.
   *
   * El motor no lee `archetypes.json` (no conoce archivos ni ids): el
   * controlador resuelve ambos y los pasa ya armados. Llamar con `undefined`
   * deja la run sin arquetipo, que es el caso clasico.
   *
   * Se separa de `startRun` porque el arquetipo cambia ANTES de arrancar, pero
   * los parametros del motor son inmutables una vez construido: este es el
   * unico punto de mutacion, explicito y previo al `startRun`.
   */
  setArchetypeLoadout(
    starter: Array<{ cardId: string; copies: number }> | undefined,
    bias: readonly ElementType[],
  ): void {
    this.archetypeStarter = starter;
    this.archetypeBias = [...bias];
  }

  /**
   * Arranca una run. `ascension` es el nivel de dificultad elegido en el menu
   * (0 = base). Se clampea al maximo que declare el contenido: un nivel que no
   * existe no puede aplicarse "de memoria", o el balance seria inventado.
   *
   * `archetype` es el id del arquetipo elegido (`''` = clasico). El motor no
   * conoce `archetypes.json`: el controlador le pasa el id (para guardarlo y
   * para el HUD) y, por separado, el mazo y el sesgo ya resueltos
   * (`archetypeStarter`/`archetypeBias`). Asi el motor sigue siendo puro.
   */
  startRun(seed?: number, ascension = 0, archetype = ''): void {    const level = Math.max(0, Math.min(Math.floor(ascension), this.registry.maxAscension()));
    const deck = new Deck(seed !== undefined ? new RNG(seed) : this.rng);
    this.run = createRunState(seed ?? this.rng.getSeed(), deck, level, archetype);
    // El mazo del arquetipo gana sobre el del perfil: elegir arquetipo es
    // arrancar con ESE mazo, y las copias del pase no tienen por que mezclarse.
    const starter = this.archetypeStarter ?? this.starterOverrides;
    deck.setCards(this.registry.buildStarterDeck(this.rng, starter));

    // Una run nueva no hereda el draft ni el interludio de la anterior: si el
    // jugador reiniciaba DESDE la pantalla de interludio, el trato viejo
    // seguia pendiente y reaparecia al salir de la primera tienda.
    this.resetTransient();

    this.dispatchGlobal('ON_RUN_START');
    bus.emit('run:start', { seed: this.run.seed, ante: this.run.ante });

    // No se elige el blind automaticamente: el jugador decide (Blind Select).
    this.enterBlindSelect();
  }

  /** Limpia el estado NO serializable que cuelga de una run (draft, interludio). */
  private resetTransient(): void {
    this.reward = null;
    this.rewardPicked = 0;
    this.pendingInterlude = null;
    // El contador del Simbionte del dado tambien vive fuera del `RunState`
    // serializable: si no se resetea, una run nueva heredaria la carga de la
    // anterior y la habilidad arrancaria armada. Se vuelve a 0 (listo) para que
    // el primer uso este disponible en cuanto se tenga el Simbionte.
    this.loadedDieChargeLeft = 0;
  }

  /**
   * Modificadores de la ascension en curso. Se leen de la run, no de una copia
   * cacheada: una run retomada de un guardado tiene que aplicar SU nivel.
   */
  get ascension(): AscensionDefinition {
    return this.registry.ascension(this.run.ascension);
  }

  /**
   * Entra a la pantalla informativa del ciego que toca.
   *
   * Ya NO se elige ciego ni se tira el dado: cada ante juega sus 3 ciegos en
   * ORDEN (el de menor score, el del medio y el jefe). La pantalla muestra la
   * ruta del ante y un boton para arrancar el ciego en curso.
   *
   * El dado multiplicador no desaparecio: paso a ser la habilidad ACTIVA del
   * Simbionte legendario `joker_loaded_die` (ver `useLoadedDie`). `run.die` sigue
   * existiendo porque esa habilidad lo carga, pero este metodo ya no lo arma.
   */
  private enterBlindSelect(): void {
    this.run.status = 'blind_select';
    // P2.6 — Es el momento natural para reponer misiones: el jugador esta a
    // punto de enfrentar el siguiente ciego, asi que un objetivo corto nuevo se
    // puede cumplir DENTRO de lo que viene, no despues de la run entera.
    //
    // AL RESTAURAR NO: `restore` llama a este metodo con las misiones ya
    // cargadas del guardado. Si sorteara aca, recargar la partida daria misiones
    // nuevas gratis (se podria "rerolear" cerrar y abrir), y ademas las
    // restauradas se perderian al pisarlas.
    if (!this.restoring) this.rollMissions();
    this.emitState();
  }

  /**
   * La tirada de dado por GESTO (`throwDie` / `rerollDie`) se retiro junto con
   * la eleccion de ciego: ya no hay pantalla donde tirarlo. El dado sobrevive
   * como la habilidad ACTIVA del Simbionte legendario `joker_loaded_die`
   * (`useLoadedDie`). `rollDie()` sigue existiendo porque esa habilidad lo usa.
   */

  /** Cara del dado actualmente cargada para la ronda, o `null`. La UI la lee. */
  get loadedDieFace(): DieRoll | null {
    return this.run.die;
  }

  /** ¿La ascension actual permite usar el dado (habilidad del Simbionte)? */
  get canRerollDie(): boolean {
    return this.ascension.modifiers.allowDieReroll !== false;
  }

  rollDie(): DieRoll {
    const face = DIE_FACES[this.rng.int(0, DIE_FACES.length)] ?? DIE_FACES[0];
    if (!face) throw new Error('[GameEngine] DIE_FACES esta vacio');
    return {
      face: face.value,
      multiplier: face.multiplier,
      hands: face.hands,
      discards: face.discards,
    };
  }

  /** Blinds disponibles para el ante actual (los que la UI ofrece elegir). */
  availableBlinds(): BlindDefinition[] {
    return this.registry.blindsForAnte(this.run.ante);
  }

  /**
   * Objetivo de score que tendria un blind, sin elegirlo todavia.
   * La tabla de antes la define el contenido (pack `base`); si no hay tabla
   * cae en la constante, que existe solo como red de seguridad.
   */
  targetFor(blind: BlindDefinition): number {
    const base = this.registry.anteTarget(this.run.ante) ?? ANTE_BASE_TARGET[this.run.ante] ?? 300;
    // Los dos multiplicadores se COMPONEN: un voucher de "objetivo -10%" en A5
    // tiene que notarse sobre el objetivo ya subido por la ascension, no sobre
    // el base pelado (que seria un descuento del 10% de nada).
    const mul = this.modifiers.targetMultiplier ?? 1;
    const asc = this.ascension.modifiers.targetMultiplier ?? 1;
    // P2.4 — El interludio tambien empuja el objetivo. Se multiplica aca, en la
    // UNICA fuente del objetivo, para que la pantalla de seleccion y la ronda
    // real muestren el mismo numero: calcularlo en dos lados es como se llega a
    // "el panel decia 300 y el ciego pide 345".
    const inter = this.run.interludeModifiers?.targetMultiplier ?? 1;
    return Math.round(base * blind.scoreMultiplier * mul * asc * inter);
  }

  /**
   * Modificadores de run activos (vouchers). Se recalcula en cada consulta: son
   * como mucho una decena de objetos y el coste es despreciable frente a la
   * alternativa de cachear y tener que invalidar.
   */
  get modifiers(): VoucherRunModifiers {
    const defs = this.run.vouchers
      .map((id) => this.registry.tryGetVoucher(id))
      .filter((d): d is VoucherDefinition => d !== undefined);
    return combineModifiers(defs);
  }

  /**
   * Arranca la ronda del ciego que corresponde al ante actual.
   *
   * Ya NO hay eleccion: cada ante juega sus 3 ciegos EN ORDEN (el de menor
   * score, el del medio y el jefe). `blindsForAnte` los devuelve ordenados por
   * `scoreMultiplier` ascendente, asi que el ciego es SIEMPRE
   * `candidates[blindIndex]`.
   *
   * Se acepta un `blindId` opcional solo por compatibilidad con tests que
   * arman un pack ad-hoc y necesitan fijar un ciego concreto; en el juego real
   * el HUD llama sin argumento.
   */
  chooseBlind(blindId?: string): void {
    if (this.run.status !== 'blind_select' && this.run.status !== 'menu') return;

    const candidates = this.registry.blindsForAnte(this.run.ante);
    const blind: BlindDefinition | undefined = blindId
      ? candidates.find((b) => b.id === blindId)
      : (candidates[this.run.blindIndex] ?? candidates[candidates.length - 1]);

    if (!blind) {
      throw new Error(`[GameEngine] No hay blinds definidos para el ante ${this.run.ante}`);
    }

    const target = this.targetFor(blind);

    // ASCENSION: los niveles altos suman efectos EXTRA al jefe. Un jefe es un
    // ciego con efectos propios, asi que el gate es `effects.length > 0`.
    // Se concatenan sobre una copia: la definicion del contenido es inmutable
    // y no puede quedar contaminada entre runs.
    const extraBoss = this.ascension.modifiers.extraBossEffects;
    const blindOut: BlindDefinition = blind.effects?.length && extraBoss?.length
      ? { ...blind, effects: [...blind.effects, ...extraBoss] }
      : blind;

    // DADO: la tirada ya no se sortea por ciego. `run.die` solo tiene valor si
    // el Simbionte legendario `joker_loaded_die` lo cargo para ESTA ronda (ver
    // `useLoadedDie`). Si esta, se consume aca: su multiplicador y sus manos
    // extra aplican a la ronda, y despues se limpia.
    const die = this.run.die;
    this.run.die = null;

    this.round = createRoundState(
      blindOut,
      target,
      this.run.baseHandSize,
      Math.max(1, this.run.baseHands + (die?.hands ?? 0)),
      Math.max(0, this.run.baseDiscards + (die?.discards ?? 0)),
    );

    this.run.deck.shuffle();
    this.fillHand();

    bus.emit('blind:selected', { blind: blindOut, target });
    this.dispatchGlobal('ON_BLIND_SELECTED');
    this.dispatchGlobal('ON_ROUND_START');

    this.run.status = 'playing';
    bus.emit('round:start', { snapshot: this.roundSnapshot() });
    this.emitState();
  }

  // ==========================================================================
  // Acciones del jugador
  // ==========================================================================

  toggleSelect(uid: string): boolean {
    const round = this.requireRound();
    if (this.run.status !== 'playing') return false;

    const index = round.selected.indexOf(uid);
    if (index >= 0) {
      round.selected.splice(index, 1);
      const card = round.hand.find((c) => c.uid === uid);
      if (card) bus.emit('card:deselected', { card });
      this.emitState();
      return true;
    }

    if (round.selected.length >= MAX_PLAY_SIZE) return false;
    const card = round.hand.find((c) => c.uid === uid);
    if (!card) return false;
    round.selected.push(uid);
    bus.emit('card:selected', { card });
    this.emitState();
    return true;
  }

  clearSelection(): void {
    const round = this.requireRound();
    round.selected = [];
    this.emitState();
  }

  /**
   * Reordena la MANO (P1.3/P1.4) sin consumir recursos ni cambiar cartas.
   *
   * El criterio NO lo decide el motor: el `GameEngine` no conoce categorias de
   * UI ("Familia", "Valor") y meterlas aca ensuciaria la capa pura. El que
   * ordena es `src/ui/handSort.ts`; el motor solo acepta el resultado y lo
   * aplica sobre `round.hand`, que es la unica lista que el render lee para
   * layoutear (ver `SceneManager.syncHand`).
   *
   * Se valida que la lista sea una PERMUTACION de la mano actual: si el
   * llamador se equivoca (manda un uid de mas, o de menos), la mano no se toca.
   * Perder una carta por un bug de UI seria exactamente el fallo que el plan
   * pide evitar.
   */
  reorderHand(orderedUids: readonly string[]): boolean {
    const round = this.round;
    if (!round || this.run.status !== 'playing') return false;
    if (orderedUids.length !== round.hand.length) return false;

    const byUid = new Map(round.hand.map((card) => [card.uid, card]));
    const next: CardInstance[] = [];
    for (const uid of orderedUids) {
      const card = byUid.get(uid);
      if (!card) return false; // uid desconocido: la lista no es una permutacion
      next.push(card);
      byUid.delete(uid);
    }
    if (byUid.size !== 0) return false; // faltaban cartas

    round.hand = next;
    // La seleccion viaja por uid, no por indice: no hace falta tocarla.
    this.emitState();
    return true;
  }

  /** Previsualiza el score de la seleccion actual sin efectos secundarios. */
  previewSelection(): ScoreBreakdown | null {
    const round = this.round;
    if (!round) return null;
    const scored = selectedCards(round);
    if (scored.length === 0) return null;

    const held = round.hand.filter((c) => !round.selected.includes(c.uid));
    return this.scorer.preview(this.handOptions(scored, held));
  }

  /**
   * Juega la seleccion actual. Devuelve el contexto de resolucion completo
   * (con el registro de pasos) para que el render pueda animar la secuencia.
   */
  playHand(): ResolutionContext | null {
    const round = this.requireRound();
    if (this.run.status !== 'playing') return null;
    if (round.handsLeft <= 0) return null;

    const scored = selectedCards(round);
    if (scored.length === 0 || scored.length > MAX_PLAY_SIZE) return null;

    const held = round.hand.filter((c) => !round.selected.includes(c.uid));
    const res = this.scorer.resolveHand(this.handOptions(scored, held));

    // DADO: se aplica al FINAL, sobre el multiplicador de esporas. Solo tiene
    // valor cuando el Simbionte legendario `joker_loaded_die` lo cargo para esta
    // mano (ver `useLoadedDie`); en el flujo normal `run.die` es `null`. Asi
    // entra en el total y sale como un paso mas — el ticker lo muestra — sin
    // tocar el calculador de puntaje.
    const die = this.run.die;
    if (die && die.multiplier !== 1) {
      res.multiplySpores(die.multiplier, 'die', `die.face${die.face}`, 0);
    }

    // --- Anuncio visual de las cartas jugadas, en orden ---
    scored.forEach((card, index) => bus.emit('card:played', { card, index }));
    for (const step of res.steps) bus.emit('score:step', { step });
    held.forEach((card) => bus.emit('card:held', { card }));

    // --- Estados de carta (P2.6) ---
    //
    // El render solo sabia de un estado cuando volvia a dibujar la cara de la
    // carta: no habia forma de animar el MOMENTO. Estos eventos se emiten DESPUES
    // de los pasos de score para que la animacion del estado se sienta como
    // consecuencia de la jugada, no como algo que pasa por detras.
    for (const event of res.statusEvents) {
      if (event.kind === 'applied') {
        bus.emit('status:applied', {
          uid: event.uid,
          status: event.status,
          value: event.value,
          turns: event.turns ?? 1,
          sourceId: event.sourceId,
        });
      } else if (event.kind === 'consumed') {
        bus.emit('status:consumed', {
          uid: event.uid,
          status: event.status,
          stacks: event.value,
          gainKind: event.gainKind ?? 'substrate',
          sourceId: event.sourceId,
        });
      }
    }

    this.applyDeltas(res);

    round.score += res.total;
    round.handsLeft -= 1;
    round.cardsPlayedThisRound += scored.length;
    round.isFirstPlayOfRound = false;
    round.history.push({ cards: scored.map((c) => c.def.id), score: res.total });
    this.run.stats.handsPlayed += 1;
    this.run.stats.bestHand = Math.max(this.run.stats.bestHand, res.total);

    // Simbionte legendario del dado: cada mano jugada acerca la recarga de la
    // habilidad. Se consume la cara cargada (vale para UNA mano) y se descuenta
    // una carga del dado.
    this.run.die = null;
    if (this.loadedDieChargeLeft > 0) this.loadedDieChargeLeft -= 1;

    bus.emit('score:hand', { breakdown: breakdownOf(res), total: res.total });
    bus.emit('score:changed', {
      total: round.score,
      target: round.target,
      progress: Math.min(1, round.score / round.target),
    });

    // --- Las cartas jugadas van al descarte ---
    // OJO: una carta que un efecto DESTRUYO durante la resolucion NO puede
    // volver al descarte. `applyDeltas` (llamado arriba, linea ~427) ya la saco
    // del mazo con `deck.remove()`. Si ademas le hacemos `discard()`, la carta
    // resucita: el mazo termina con MAS copias de las que tenia (comprobado:
    // 1 doomed -> 2). Es un exploit de duplicacion, no solo una fuga.
    const destroyedUids = new Set(res.destroyed.map((c) => c.uid));
    for (const card of scored) {
      // Contador de uso: alimenta las evoluciones por cantidad de jugadas.
      card.plays = (card.plays ?? 0) + 1;
      round.hand = round.hand.filter((c) => c.uid !== card.uid);
      if (destroyedUids.has(card.uid)) continue;
      this.run.deck.discard(card);
    }
    round.selected = [];

    this.resolveRoundOutcome();
    if (this.run.status === 'playing') {
      this.fillHand();
      this.dispatchGlobal('ON_HAND_SCORED');
    }

    this.emitState();
    return res;
  }

  discardSelected(): ResolutionContext | null {
    const round = this.round;
    if (!round) return null;
    return this.discardCards([...round.selected]);
  }

  /**
   * Descarta cartas concretas por uid.
   *
   * Existe por el arrastre: soltar una carta sobre el descarte tiene que
   * descartar ESA carta, no la seleccion entera. `discardSelected()` es este
   * mismo camino con la seleccion como entrada, asi que las reglas (un solo
   * descarte por accion, efectos ON_DISCARD, relleno de mano) son las mismas.
   *
   * Las cartas descartadas salen de la seleccion; el resto de la seleccion se
   * mantiene (el jugador puede estar armando una mano y tirar una carta suelta).
   */
  discardCards(uids: readonly string[]): ResolutionContext | null {
    const round = this.round;
    if (!round) return null;
    if (this.run.status !== 'playing') return null;
    if (round.discardsLeft <= 0) return null;

    // Se respeta el orden pedido y se ignora lo que ya no esta en la mano.
    const discarded: CardInstance[] = [];
    for (const uid of uids) {
      const card = round.hand.find((c) => c.uid === uid);
      if (card && !discarded.includes(card)) discarded.push(card);
    }
    if (discarded.length === 0) return null;

    const discardedUids = new Set(discarded.map((card) => card.uid));
    const held = round.hand.filter((c) => !discardedUids.has(c.uid));
    const res = this.scorer.resolveDiscards(discarded, this.handOptions([], held));

    discarded.forEach((card, index) => bus.emit('card:discarded', { card, index }));
    this.applyDeltas(res);

    round.discardsLeft -= 1;
    round.cardsDiscardedThisRound += discarded.length;
    round.isFirstPlayOfRound = false;

    // Misma guarda que en `playHand`: una carta que un efecto destruyo mientras
    // se descartaba ya fue sacada del mazo por `applyDeltas`. Devolverla al
    // descarte la duplicaria.
    const destroyedUids = new Set(res.destroyed.map((c) => c.uid));
    for (const card of discarded) {
      round.hand = round.hand.filter((c) => c.uid !== card.uid);
      if (destroyedUids.has(card.uid)) continue;
      this.run.deck.discard(card);
    }
    round.selected = round.selected.filter((uid) => !discardedUids.has(uid));

    this.fillHand();
    this.emitState();
    return res;
  }

  // ==========================================================================
  // Simbionte legendario del dado (habilidad activa)
  // ==========================================================================

  /** ¿El jugador tiene el Simbionte legendario del dado en la mesa? */
  hasLoadedDie(): boolean {
    return this.run.jokers.some((j) => j.def.id === LOADED_DIE_JOKER_ID);
  }

  /**
   * Cargas restantes del dado: cuantas manos jugadas faltan para poder usarlo.
   * 0 = listo. Se muestra en el HUD como contador de la habilidad.
   *
   * Solo el `RoundState` cuenta manos, asi que la carga se descuenta por mano
   * jugada en la ronda en curso; al cambiar de ciego vuelve a estar disponible
   * el remanente (la carga NO se pierde entre ciegos, para que el Simbionte se
   * sienta potente y no un accidente de ronda).
   */
  loadedDieCharge(): number {
    return this.loadedDieChargeLeft;
  }

  /** ¿Se puede usar el dado ahora? */
  canUseLoadedDie(): boolean {
    if (!this.hasLoadedDie()) return false;
    if (this.run.status !== 'playing') return false;
    if (this.run.die) return false; // ya cargado: no se apila
    // En los niveles que prohiben tirar el dado (A8+), el Simbionte no puede
    // saltear la regla del ciego: su dado queda bloqueado igual que lo estaba la
    // tirada manual.
    if (this.ascension.modifiers.allowDieReroll === false) return false;
    return this.loadedDieChargeLeft <= 0;
  }

  /**
   * Gasta la carga del Simbionte legendario y TIRA el dado: el resultado se
   * aplica al multiplicador de esporas de la proxima mano. `Math` no: usa el RNG
   * SEMBRADO, igual que el dado original, para no romper la reproducibilidad.
   *
   * Devuelve la tirada para que el render la anime (igual que el dado de antes),
   * o `null` si no corresponde.
   */
  useLoadedDie(): DieRoll | null {
    if (!this.canUseLoadedDie()) return null;
    const die = this.rollDie();
    this.run.die = die;
    this.loadedDieChargeLeft = LOADED_DIE_EVERY;
    bus.emit('die:loaded', { die });
    this.emitState();
    return die;
  }

  // ==========================================================================
  // Tienda
  // ==========================================================================

  enterShop(): void {
    this.run.status = 'shop';
    const offers = this.rollOffers(0);
    this.run.shop = { offers, rerolls: 0 };

    this.dispatchGlobal('ON_SHOP_ENTER');
    bus.emit('shop:enter', { offers, money: this.run.money });
    this.emitState();
  }

  get rerollPrice(): number {
    const shop = this.run.shop;
    if (!shop) return 0;
    const ascDelta = this.ascension.modifiers.rerollCostDelta ?? 0;
    return Math.max(0, rerollCost(shop, this.modifiers) + ascDelta);
  }

  rerollShop(): boolean {
    const shop = this.run.shop;
    if (!shop || this.run.status !== 'shop') return false;
    const cost = rerollCost(shop, this.modifiers);
    if (this.run.money < cost) return false;

    this.setMoney(-cost);
    shop.rerolls += 1;
    // La secuencia entra en el id de la oferta: asi un reroll no puede
    // producir ids repetidos (que romperian buyOffer).
    shop.offers = this.rollOffers(shop.rerolls);
    bus.emit('shop:reroll', { offers: shop.offers, money: this.run.money });
    this.emitState();
    return true;
  }

  // ==========================================================================
  // Recompensa (draft de cartas al ganar un blind)
  // ==========================================================================

  /** Ofertas del draft pendiente. Vacio si no hay recompensa esperando. */
  rewardOffers(): ShopOffer[] {
    return this.reward?.offers ?? [];
  }

  get rewardPick(): number {
    return this.reward?.pick ?? 1;
  }

  get rewardAllowSkip(): boolean {
    return this.reward?.allowSkip ?? true;
  }

  /**
   * Elige una carta del draft. `null` = saltar (si `allowSkip`).
   * Al resolver la ultima eleccion, entra a la tienda: el flujo es
   * `playing -> reward -> shop -> blind_select`.
   */
  chooseReward(offerId: string | null): boolean {
    const reward = this.reward;
    if (!reward || this.run.status !== 'reward') return false;

    if (offerId === null) {
      if (!reward.allowSkip) return false;
      bus.emit('reward:pick', { offer: null });
      this.finishReward();
      return true;
    }

    const offer = reward.offers.find((o) => o.id === offerId);
    if (!offer || offer.sold) return false;

    const card = this.registry.instantiate(offer.refId);
    this.run.deck.insert(card, 'random');
    offer.sold = true;
    this.rewardPicked += 1;

    bus.emit('reward:pick', { offer, card });
    bus.emit('card:created', { card });

    if (this.rewardPicked >= reward.pick) this.finishReward();
    else this.emitState();
    return true;
  }

  private finishReward(): void {
    this.reward = null;
    this.rewardPicked = 0;
    bus.emit('reward:exit', {});
    this.enterShop();
  }

  // ==========================================================================
  // Deckbuilding
  // ==========================================================================

  /**
   * Coste de purgar (eliminar) una carta del mazo.
   *
   * Suma tres fuentes: la base de economia, el modificador de ascension y el
   * delta ACUMULADO por efectos de la run (PURGE_COST_DELTA, que es la palanca
   * del arquetipo Cristal para quemar cartas sin fundirse). Se clampea a 0: un
   * descuento que dejaria el coste en negativo se lee como bug.
   */
  get purgeCost(): number {
    return Math.max(
      0,
      ECONOMY.purgeCost +
        (this.ascension.modifiers.purgeCostDelta ?? 0) +
        this.run.purgeCostBonus,
    );
  }

  /**
   * Editar el mazo solo entre blinds o en la tienda, nunca en medio de una
   * mano: sacar o mejorar una carta que el jugador ya tiene en la mano (y que
   * quizas ya selecciono) seria un cambio de reglas a mitad de jugada.
   */
  canEditDeck(): boolean {
    return this.run.status === 'blind_select' || this.run.status === 'shop';
  }

  /**
   * TAMANO COMPLETO del mazo: robo + descarte + las cartas que estan EN LA MANO.
   *
   * `deck.totalSize` solo cuenta las dos pilas, asi que durante la mano (o
   * mientras haya cartas retenidas) devuelve menos que el mazo real: con 8
   * cartas en la mano mostraba "32" cuando el jugador tiene 40. El chip del HUD
   * dice "Mazo", y un jugador cuenta SU mazo entero, no solo lo que le queda
   * por robar. Es la unica fuente de ese numero: el panel de mazo y el chip
   * leen de aca para no volver a discrepar.
   */
  get deckSize(): number {
    return this.run.deck.totalSize + (this.round?.hand.length ?? 0);
  }

  /**
   * Cartas del mazo que aun NO entraron a la ronda: la pila de robo mas todo
   * lo que el descarte de rondas anteriores todavia puede reciclar.
   *
   * Es la mitad del par que muestra el chip "MAZO": este numero BAJA a medida
   * que la ronda avanza (que es lo que el jugador espera ver) y `deckSize` (el
   * total real, mano incluida) es el tope que se muestra al lado.
   *
   * POR QUE NO ES `deck.remaining`. La pila de robo se rellena sola: al jugar
   * una mano, las cartas van al descarte y el motor ROBA de nuevo hasta
   * completar el tamano de mano. Con `remaining` el numero no se movia nunca
   * durante la mano — subia y bajaba en el mismo evento — y el jugador lo veia
   * "estatico en el total" aunque hubiera jugado 8 cartas. Lo que se cuenta es
   * lo CONSUMIDO: cada carta jugada o descartada deja de estar disponible hasta
   * que la ronda cierra, asi que el numero es monotono decreciente dentro del
   * ciego y se resetea al empezar el siguiente. Es exactamente la cuenta que
   * hace el jugador: "me quedan N cartas por ver".
   */
  get deckDraw(): number {
    const round = this.round;
    if (!round) return this.run.deck.totalSize;
    const consumed =
      Math.max(0, round.cardsPlayedThisRound) + Math.max(0, round.cardsDiscardedThisRound);
    // Base `deckSize` (pilas + mano): al abrir el ciego el chip marca el mazo
    // ENTERO y cada carta jugada o descartada lo baja en uno. Usar `totalSize`
    // daria un numero que arranca ya descontada la mano y el jugador no
    // reconoceria el total de su mazo.
    return Math.max(0, this.deckSize - consumed);
  }

  /**
   * Cartas listas para robar AHORA (pila de robo). Es el numero "Robables" del
   * HUD: puede llegar a 0 aunque el descarte siga teniendo cartas, porque esas
   * todavia no se reciclaron (el aviso `deck:reshuffle` lo explica).
   */
  get deckDrawPile(): number {
    return this.run?.deck.remaining ?? 0;
  }

  /** Cartas en el descarte. Se reciclan al robo cuando la pila de robo se vacia. */
  get deckDiscardPile(): number {
    return this.run?.deck.discardSize ?? 0;
  }

  /**
   * Purgas permitidas por ante. La base es contenido (`ECONOMY.purgesPerAnte`);
   * un efecto de la run podria subirla mas adelante, por eso se lee de aca y no
   * de la constante directa en la UI.
   */
  get purgesPerAnte(): number {
    return ECONOMY.purgesPerAnte;
  }

  /** Purgas que quedan en el ante actual (0 ⇒ el boton se deshabilita). */
  get purgesLeft(): number {
    return Math.max(0, this.purgesPerAnte - this.run.purgesThisAnte);
  }

  /** Compat: la purga es una de las operaciones de edicion de mazo. */
  canPurge(): boolean {
    return this.canEditDeck();
  }

  // ==========================================================================
  // Cultivo: mejoras ilimitadas y evoluciones
  // ==========================================================================

  /** Cotizacion de la proxima mejora. Pura: la UI puede pedirla en cada render. */
  upgradeQuote(uid: string): UpgradeQuote | null {
    const card = this.run.deck.allCards.find((c) => c.uid === uid);
    if (!card) return null;
    return this.upgrades.quote(card, 1);
  }

  get hasUpgrades(): boolean {
    return this.upgrades.hasTracks;
  }

  /**
   * Mejora una carta pagando su coste. El coste crece geometricamente, pero no
   * hay techo (salvo que el track declare `maxLevel`).
   */
  upgradeCard(uid: string): boolean {
    if (!this.canEditDeck()) return false;

    const card = this.run.deck.allCards.find((c) => c.uid === uid);
    if (!card) return false;

    const quote = this.upgrades.quote(card, 1);
    if (!quote || quote.atMaxLevel) return false;
    if (this.run.money < quote.cost) return false;

    this.upgrades.apply(card, 1);
    this.run.stats.cardsUpgraded += 1;
    this.setMoney(-quote.cost);

    bus.emit('card:levelup', { card, cost: quote.cost, level: card.level });
    this.emitState();
    return true;
  }

  /** Evoluciones posibles de una carta, cumplidas o no (para mostrar el requisito). */
  evolutionOptions(uid: string): EvolutionOption[] {
    const card = this.run.deck.allCards.find((c) => c.uid === uid);
    if (!card) return [];
    return this.evolutions.optionsFor(card);
  }

  /** Cartas del mazo con una evolucion lista para hacerse. */
  evolutionReady(): CardInstance[] {
    return this.evolutions.readyAmong(this.run.deck.allCards);
  }

  get hasEvolutions(): boolean {
    return this.evolutions.hasRules;
  }

  /**
   * Evoluciona una carta: cambia su especie conservando el uid, el nivel (segun
   * `keep`) y los bonus. Es irreversible dentro de una run.
   */
  evolveCard(uid: string): boolean {
    if (!this.canEditDeck()) return false;

    const card = this.run.deck.allCards.find((c) => c.uid === uid);
    if (!card) return false;

    const option = this.evolutions.availableFor(card);
    if (!option) return false;

    const previousId = this.evolutions.apply(card, option.rule);
    if (!previousId) return false;

    this.run.stats.cardsEvolved += 1;
    bus.emit('card:evolved', { card, fromId: previousId, ruleId: option.rule.id });
    this.emitState();
    return true;
  }

  /**
   * Elimina una carta del mazo de forma permanente.
   *
   * Se descuenta del mazo Y de la mano: si la carta estaba en la mano (por
   * ejemplo al purgar desde la tienda, donde la mano sigue viva), dejarla ahi
   * seria un fantasma que el render dibujaria pero el mazo ya no conoce.
   */
  purgeCard(uid: string): boolean {
    if (!this.canPurge()) return false;
    // Tope por ANTE: dos purgas y el mazo queda quieto hasta el proximo ante.
    // El contador se resetea en `leaveShop` al entrar a un ante nuevo.
    if (this.purgesLeft <= 0) return false;
    // El coste sale del GETTER, nunca de la constante: en A7+ purgar cuesta mas
    // y leer `ECONOMY.purgeCost` cobraria de menos en silencio (el boton diria
    // un precio y se descontaria otro).
    const cost = this.purgeCost;
    if (this.run.money < cost) return false;

    const card = this.run.deck.allCards.find((c) => c.uid === uid);
    if (!card) return false;

    this.run.deck.remove(uid);
    if (this.round) this.round.hand = this.round.hand.filter((c) => c.uid !== uid);
    if (this.round) this.round.selected = this.round.selected.filter((id) => id !== uid);

    this.run.purgesThisAnte += 1;
    this.setMoney(-cost);
    bus.emit('deck:purged', { card, cost });
    bus.emit('purge:changed', {
      used: this.run.purgesThisAnte,
      left: this.purgesLeft,
      perAnte: this.purgesPerAnte,
      ante: this.run.ante,
    });
    this.emitState();
    return true;
  }

  /**
   * Precio REAL de una oferta. Es el unico lugar donde se aplica el descuento
   * de vouchers: la UI muestra este numero y `buyOffer` cobra este numero. Si
   * fueran dos calculos distintos, el boton diria un precio y cobraria otro.
   */
  priceOf(offer: ShopOffer): number {
    // Orden: primero el recargo de la ascension (sube el precio de LISTA) y
    // despues el descuento del voucher. Al reves, un voucher del 25% en A8
    // borraria el recargo del 40% y el nivel se abarataria solo.
    const inflado = Math.round(offer.cost * (this.ascension.modifiers.shopCostMultiplier ?? 1));
    return discountedCost(inflado, this.modifiers);
  }

  /** ¿Puede comprarse esta oferta? Lo consulta la UI para el estado del boton. */
  canBuyOffer(offer: ShopOffer): boolean {
    if (offer.sold || this.run.status !== 'shop') return false;
    if (this.run.money < this.priceOf(offer)) return false;
    if (offer.kind === 'joker' && this.run.jokers.length >= this.run.jokerSlots) return false;
    // Un voucher ya poseido no se puede recomprar (salvo que sea repetible).
    if (offer.kind === 'voucher') {
      const def = this.registry.tryGetVoucher(offer.refId);
      if (!def) return false;
      if (!def.repeatable && this.run.vouchers.includes(offer.refId)) return false;
    }
    return true;
  }

  buyOffer(offerId: string): boolean {
    const shop = this.run.shop;
    if (!shop || this.run.status !== 'shop') return false;

    const offer = shop.offers.find((o) => o.id === offerId);
    if (!offer || !this.canBuyOffer(offer)) return false;

    const price = this.priceOf(offer);

    if (offer.kind === 'joker') {
      const joker = this.registry.instantiateJoker(offer.refId);
      this.run.jokers.push(joker);
      bus.emit('joker:added', { joker });
    } else if (offer.kind === 'card') {
      const card = this.registry.instantiate(offer.refId);
      this.run.deck.insert(card, 'random');
      bus.emit('card:created', { card });
    } else if (offer.kind === 'voucher') {
      this.buyVoucher(offer.refId);
    } else {
      // Mutaciones: se aplican al instante y no ocupan slot.
      const def = this.registry.getJoker(offer.refId);
      this.applyImmediateEffects(def.id, def.effects, def.nameKey);
    }

    // `sold` ANTES de cobrar, no despues.
    //
    // `setMoney` emite `money:changed` en el acto, y la tienda se refresca con
    // ese evento: si la oferta se marcaba vendida un renglon mas abajo, el
    // refresco la veia todavia disponible y el boton quedaba en "Comprar" y
    // habilitado. Tocar de nuevo daba "no alcanza el dinero", que ademas era
    // mentira. El estado de la oferta y la plata tienen que cambiar juntos.
    offer.sold = true;
    this.setMoney(-price);
    bus.emit('shop:purchase', { offer, money: this.run.money });
    this.emitState();
    return true;
  }

  /**
   * Compra un voucher: aplica sus efectos UNA vez y registra la regla.
   *
   * Los `runModifiers` NO se aplican aca: se leen del agregado (`this.modifiers`)
   * en cada consulta, porque no son un suceso sino un cambio permanente en como
   * se calcula el objetivo, el reroll o el precio. Aplicarlos "una vez" seria
   * imposible de deshacer y de testear.
   */
  private buyVoucher(voucherId: string): void {
    const def = this.registry.tryGetVoucher(voucherId);
    if (!def) return;

    // `extraHands`/`extraJokerSlots` y compania son para vouchers PERMANENTES y
    // hoy no los lee nadie (ver `VoucherRunModifiers`). Lo que SI funciona en
    // caliente es objetivo, reroll y descuento, que se leen del agregado.
    if (def.effects && def.effects.length > 0) {
      this.applyImmediateEffects(def.id, def.effects, def.nameKey);
    }

    this.run.vouchers.push(def.id);
    bus.emit('voucher:bought', { voucher: def.id });
  }

  sellJoker(uid: string): boolean {
    const index = this.run.jokers.findIndex((j) => j.uid === uid);
    if (index < 0) return false;
    const joker = this.run.jokers[index];
    if (!joker) return false;

    this.run.jokers.splice(index, 1);
    this.setMoney(jokerSellValue(joker));
    bus.emit('joker:sold', { joker });
    this.emitState();
    return true;
  }

  /** Sale de la tienda y avanza al siguiente blind o al siguiente ante. */
  leaveShop(): void {
    this.dispatchGlobal('ON_SHOP_EXIT');

    if (this.run.blindIndex < 2) {
      this.run.blindIndex += 1;
    } else {
      this.run.ante += 1;
      this.run.blindIndex = 0;
      // Ante NUEVO ⇒ se devuelven las purgas. El reset va EN LA RAMA del ante,
      // no en cada ciego: purgar es una decision de ante, no de ciego.
      this.run.purgesThisAnte = 0;
      bus.emit('purge:changed', {
        used: 0,
        left: this.purgesPerAnte,
        perAnte: this.purgesPerAnte,
        ante: this.run.ante,
      });
      // El tope lo define el contenido: una expansion puede agregar antes.
      if (this.run.ante > this.registry.maxAnte()) {
        this.run.status = 'victory';
        bus.emit('game:over', { reason: 'victory', ante: this.run.ante });
        this.emitState();
        return;
      }
    }

    // Los statuses temporales se limpian entre blinds.
    this.decayStatuses();

    // P2.4 — Antes de volver a la seleccion, a veces hay un EVENTO: un trato
    // que el jugador puede aceptar (con coste) o declinar. Se pasa por aca y no
    // al ganar el ciego porque el interludio tiene que cortar el flujo ANTES de
    // una decision (que ciego elegir), no mezclado con la recompensa.
    if (this.tryEnterInterlude()) return;

    // Vuelve a la pantalla de eleccion: el jugador decide con que ciego sigue.
    this.enterBlindSelect();
  }

  // ==========================================================================
  // Interludios (P2.3 / P2.4)
  // ==========================================================================

  /**
   * Sortea si toca un interludio y, si toca, entra a esa fase.
   *
   * Devuelve `false` si no hay tabla, si el dado de azar no dio, o si no queda
   * ningun trato sin ver. El sorteo usa el RNG SEMBRADO: dos partidas con la
   * misma semilla tienen que ver los mismos eventos.
   */
  private tryEnterInterlude(): boolean {
    if (!this.registry.hasInterludes) return false;

    const unseen = this.registry.interludeDefs.filter(
      (def) => !this.run.seenInterludes.includes(def.id),
    );
    if (unseen.length === 0) return false;

    // Un 40% de paradas: suficiente para que se sientan parte del bucle, bajo
    // para que la run siga siendo "elegir ciego -> jugar -> tienda".
    if (this.rng.next() >= INTERLUDE_CHANCE) return false;

    const def = pickInterlude(unseen, this.run.ante, this.rng.next());
    if (!def) return false;

    this.run.seenInterludes.push(def.id);
    this.run.status = 'interlude';
    this.pendingInterlude = def;
    bus.emit('interlude:enter', { interlude: def });
    this.emitState();
    return true;
  }

  /** Interludio pendiente de decision, o null. Para la UI. */
  get currentInterlude(): InterludeDefinition | null {
    return this.pendingInterlude;
  }

  /**
   * Resuelve el interludio con la opcion elegida y sigue a la seleccion de
   * ciego. Devuelve `false` si no hay interludio, la opcion no existe, o el
   * efecto no se pudo pagar (ej: dinero insuficiente).
   */
  chooseInterlude(choiceId: string): boolean {
    const def = this.pendingInterlude;
    if (!def || this.run.status !== 'interlude') return false;

    const choice = def.choices.find((c) => c.id === choiceId);
    if (!choice) return false;

    if (!this.applyInterludeEffects(choice.effects ?? [])) return false;

    this.pendingInterlude = null;
    bus.emit('interlude:choose', { interlude: def, choice });
    this.enterBlindSelect();
    this.emitState();
    return true;
  }

  /**
   * Aplica los efectos de una opcion. Devuelve `false` (sin aplicar NADA) si
   * alguno no se puede pagar: un trato a medias seria peor que no aceptarlo.
   *
   * El orden importa: primero se cobra lo que cuesta y recien despues se
   * entrega. Si se hiciera al reves, un trato con coste imposible de pagar
   * dejaria al jugador con la ventaja y sin el coste.
   */
  private applyInterludeEffects(effects: readonly InterludeEffect[]): boolean {
    // --- Validacion previa: se puede pagar TODO? ---
    for (const effect of effects) {
      if (effect.type === 'MONEY' && effect.value < 0 && this.run.money + effect.value < 0) {
        return false;
      }
      if (effect.type === 'PURGE_RANDOM') {
        const need = effect.count ?? 1;
        // No se puede purgar mas de lo que queda tras el minimo jugable.
        if (this.run.deck.totalSize - need < MIN_DECK_SIZE) return false;
      }
    }

    // --- Los multiplicadores acumulados se guardan para las proximas consultas ---
    const withMods = applyInterludeModifiers(this.run.interludeModifiers, effects);
    if (withMods.targetMultiplier !== this.run.interludeModifiers.targetMultiplier) {
      bus.emit('interlude:target', { multiplier: withMods.targetMultiplier });
    }
    this.run.interludeModifiers = withMods;

    // --- Efectos inmediatos ---
    for (const effect of immediateInterludeEffects(effects)) {
      switch (effect.type) {
        case 'MONEY':
          this.setMoney(effect.value);
          break;
        case 'JOKER_SLOT':
          this.run.jokerSlots = Math.max(0, this.run.jokerSlots + effect.value);
          break;
        case 'HANDS_DELTA':
          this.run.baseHands = Math.max(1, this.run.baseHands + effect.value);
          break;
        case 'HAND_SIZE':
          this.run.baseHandSize = Math.max(1, this.run.baseHandSize + effect.value);
          break;
        case 'CARD': {
          const count = effect.count ?? 1;
          const weights = effect.rarity
            ? ({ [effect.rarity as Rarity]: 1 } as Partial<Record<Rarity, number>>)
            : undefined;
          for (let i = 0; i < count; i++) {
            const def = this.registry.rollRandomCard(this.rng, undefined, weights);
            if (!def) break;
            const inst = this.registry.instantiate(def.id);
            this.run.deck.insert(inst, 'random');
            bus.emit('card:created', { card: inst });
          }
          break;
        }
        case 'PURGE_RANDOM': {
          const count = effect.count ?? 1;
          for (let i = 0; i < count; i++) {
            const pool = this.run.deck.allCards;
            if (pool.length === 0) break;
            const victim = pool[Math.floor(this.rng.next() * pool.length)];
            if (!victim) break;
            if (this.run.deck.remove(victim.uid)) {
              this.run.stats.cardsDestroyed += 1;
              bus.emit('card:destroyed', { card: victim });
            }
          }
          break;
        }
        case 'UPGRADE_RANDOM': {
          const count = effect.count ?? 1;
          for (let i = 0; i < count; i++) {
            const pool = this.run.deck.allCards.filter((c) => {
              const quote = this.upgrades.quote(c, 1);
              return quote !== null && !quote.atMaxLevel;
            });
            if (pool.length === 0) break;
            const lucky = pool[Math.floor(this.rng.next() * pool.length)];
            if (!lucky) break;
            this.upgrades.apply(lucky, 1);
            this.run.stats.cardsUpgraded += 1;
            bus.emit('card:levelup', { card: lucky, cost: 0, level: lucky.level });
          }
          break;
        }
        default:
          break;
      }
    }
    return true;
  }


  // ==========================================================================
  // Internos
  // ==========================================================================

  private handOptions(scored: CardInstance[], held: CardInstance[]) {
    const round = this.requireRound();
    return {
      scored,
      held,
      hand: round.hand,
      jokers: this.run.jokers,
      ...(round.blind.effects ? { blindEffects: round.blind.effects } : {}),
      money: this.run.money,
      cardsPlayedThisRound: round.cardsPlayedThisRound,
      cardsDiscardedThisRound: round.cardsDiscardedThisRound,
      isFirstPlayOfRound: round.isFirstPlayOfRound,
      consumedPerRound: round.consumedEffects,
      consumedPerRun: this.run.consumedEffects,
    };
  }

  /** Aplica al estado real todo lo que la resolucion acumulo. */
  private applyDeltas(res: ResolutionContext): void {
    const round = this.round;

    if (res.moneyDelta !== 0) this.setMoney(res.moneyDelta);

    if (res.handSizeDelta !== 0) {
      this.run.baseHandSize += res.handSizeDelta;
      if (round) round.handSize = Math.max(1, round.handSize + res.handSizeDelta);
    }
    if (res.handsDelta !== 0) {
      this.run.baseHands += res.handsDelta;
      if (round) round.handsLeft += res.handsDelta;
    }
    if (res.discardsDelta !== 0) {
      this.run.baseDiscards += res.discardsDelta;
      if (round) round.discardsLeft += res.discardsDelta;
    }
    if (res.jokerSlotsDelta !== 0) {
      this.run.jokerSlots = Math.max(1, this.run.jokerSlots + res.jokerSlotsDelta);
    }
    // PURGE_COST_DELTA: se acumula en la run. Es un delta, no un set, asi que
    // dos cartas que abaratan la purga se suman. El HUD lee `purgeCost` al
    // refrescar, asi que no hace falta empujar un evento propio.
    if (res.purgeCostDelta !== 0) {
      this.run.purgeCostBonus += res.purgeCostDelta;
    }

    // Mejoras pedidas por efectos (LEVEL_UP_CARD): se aplican ACA, cuando la
    // cadena ya termino, y NUNCA en un dryRun. Ese es el bug que tenia la
    // version anterior: mutaba la carta durante el preview del HUD, asi que
    // pasar el mouse por encima de una carta con ese efecto la mejoraba.
    for (const request of res.levelUps) {
      const card = this.findCardEverywhere(request.uid);
      if (!card) continue;
      this.upgrades.apply(card, request.levels);
      this.run.stats.cardsUpgraded += 1;
      bus.emit('card:levelup', { card, cost: 0, level: card.level });
    }

    // Estados pedidos por efectos (APPLY_STATUS): misma mutacion diferida que
    // `levelUps`. Se aplican ACA, cuando la cadena termino, y NUNCA en un
    // dryRun: era el bug por el que SELECCIONAR una carta de putrefaccion la
    // dejaba podrida de verdad (y acumulaba hasta puntuar 0).
    for (const request of res.statusRequests) {
      const card = this.findCardEverywhere(request.uid);
      if (!card) continue;
      this.applyStatusToCard(card, request.status, request.value, request.turns);
    }

    // Efectos "once" consumidos.
    if (round) {
      for (const key of res.consumedPerRound) round.consumedEffects.add(key);
    }
    for (const key of res.consumedPerRun) this.run.consumedEffects.add(key);

    // Cartas destruidas: salen del mazo y de la mano para siempre.
    for (const victim of res.destroyed) {
      this.run.deck.remove(victim.uid);
      if (round) round.hand = round.hand.filter((c) => c.uid !== victim.uid);
      this.run.stats.cardsDestroyed += 1;
      bus.emit('card:destroyed', { card: victim });
    }

    // Cartas creadas: entran al mazo.
    for (const defId of res.createdIds) {
      if (!this.registry.tryGetCard(defId)) continue;
      const card = this.registry.instantiate(defId);
      this.run.deck.insert(card, 'random');
      bus.emit('card:created', { card });
    }

    // Robo pedido por efectos.
    if (res.drawRequests > 0) this.drawExtra(res.drawRequests);

    if (res.overflowEvents.length > 0) {
      bus.emit('log', {
        level: 'warn',
        key: 'log.triggerOverflow',
        params: { count: res.overflowEvents.length, first: res.overflowEvents[0] ?? '' },
      });
    }
  }

  private resolveRoundOutcome(): void {
    const round = this.requireRound();

    if (round.score >= round.target) {
      // La cara cargada vale para UNA ronda: se consume al cerrarla.
      this.run.die = null;
      // DESGLOSE de la recompensa: se calcula por partes y se expone tal cual
      // al HUD para que el panel de "Ciego superado" muestre de donde sale cada
      // Fungi. El bono de una sola mano solo aplica si el ciego se cerro en la
      // PRIMERA jugada (el historial tiene una sola entrada).
      const blindReward = round.blind.reward;
      const unusedCount = round.handsLeft;
      const unusedReward = unusedCount * ECONOMY.moneyPerUnusedHand;
      const firstHand = round.history.length === 1 ? ECONOMY.firstHandBonus : 0;
      const rewardParts = {
        blind: blindReward,
        base: ECONOMY.baseBlindReward,
        unusedHands: unusedReward,
        unusedCount,
        firstHand,
      };
      const reward =
        rewardParts.blind + rewardParts.base + rewardParts.unusedHands + rewardParts.firstHand;
      this.setMoney(reward);
      this.run.stats.blindsCleared += 1;
      // TOTAL DE LA RUN: se acumula el score REAL del ciego superado. Sin esto
      // el resumen final solo podia mostrar `round.score` (que se resetea al
      // empezar el ciego siguiente) o `bestHand` (la mejor mano SUELTA), y el
      // jugador veia "el total" como si fuera el ultimo puntaje nomas.
      this.run.totalScore += round.score;

      bus.emit('round:win', {
        score: round.score,
        target: round.target,
        reward,
        money: this.run.money,
        rewardParts,
      });

      this.dispatchGlobal('ON_ROUND_WIN');

      // CONSERVAR EL MAZO: la mano que sobraba vuelve al mazo ANTES de salir
      // del ciego. Sin esto, `chooseBlind` reemplaza el RoundState entero y
      // esas cartas quedan huerfanas (ni en el mazo, ni en la mano): el mazo
      // encogia en silencio en cada ciego ganado. Ver `conserveDeck()`.
      this.conserveDeck();

      // El draft de recompensa va ANTES de la tienda. Si el contenido no
      // declara una tabla de fase 'reward', el flujo es el de siempre:
      // un pack que no la declara no cambia el juego.
      const rewardOffers = this.offers.rollPhase('reward', this.rollContext(0));
      if (rewardOffers.length > 0) {
        const table = this.offers.tablesFor('reward')[0];
        this.reward = {
          offers: rewardOffers,
          pick: table?.pick ?? 1,
          allowSkip: table?.allowSkip ?? true,
        };
        this.rewardPicked = 0;
        this.run.status = 'reward';
        bus.emit('reward:enter', {
          offers: rewardOffers,
          pick: this.reward.pick,
          allowSkip: this.reward.allowSkip,
        });
        this.emitState();
        return;
      }

      this.enterShop();
      return;
    }

    if (round.handsLeft <= 0) {
      this.run.die = null;
      bus.emit('round:loss', { score: round.score, target: round.target });
      this.dispatchGlobal('ON_ROUND_LOSS');
      // Misma conservacion al PERDER: quedarse sin manos no destruye cartas.
      this.conserveDeck();
      this.run.status = 'game_over';
      bus.emit('game:over', { reason: 'loss', ante: this.run.ante });
      this.emitState();
    }
  }

  /**
   * Devuelve al mazo las cartas que quedaron en la mano al cerrar el ciego.
   *
   * Es UNO de los cuatro pasos que el plan separa explicitamente:
   *   finalizarPuntuacion() -> resolverEfectosDeFinDeCiego()
   *   -> conservarEstadoDelMazo() -> crearEstadoDelSiguienteCiego()
   *
   * La unica forma legitima de que una carta desaparezca es `deck.remove()`
   * (destruccion/purga explicitas, ya aplicadas en `applyDeltas`). Todo lo que
   * siga vivo en `round.hand` vuelve al descarte y se recicla en el proximo
   * robo: la cantidad total de cartas del mazo es invariante a traves de un
   * ciego, salvo que una regla explicita la haya destruido.
   */
  private conserveDeck(): void {
    const round = this.round;
    if (!round || round.hand.length === 0) return;

    const leftover = round.hand.length;
    this.run.deck.discardMany(round.hand);
    round.hand = [];
    round.selected = [];
    bus.emit('deck:conserved', { returned: leftover, total: this.run.deck.totalSize });
  }


  /** Reparte hasta completar el tamano de mano. */
  private fillHand(): void {
    const round = this.requireRound();
    const missing = round.handSize - round.hand.length;
    if (missing <= 0) return;

    const drawn = this.drawFromDeck(missing);
    for (let i = 0; i < drawn.length; i++) {
      const card = drawn[i];
      if (!card) continue;
      round.hand.push(card);
      bus.emit('card:drawn', { card, index: round.hand.length - 1 });
    }
    if (drawn.length > 0) bus.emit('hand:dealt', { cards: round.hand });
  }

  /** Roba N cartas extra (por efectos DRAW_CARDS). */
  private drawExtra(count: number): void {
    const round = this.requireRound();
    if (count <= 0) return;
    const drawn = this.drawFromDeck(count);
    for (const card of drawn) {
      if (round.hand.length >= MAX_HAND_SIZE) {
        this.run.deck.discard(card);
        continue;
      }
      round.hand.push(card);
      bus.emit('card:drawn', { card, index: round.hand.length - 1 });
    }
  }

  /**
   * Unico punto por el que pasa el robo. Ademas de robar, consulta al `Deck` si
   * reciclo el descarte y emite `deck:reshuffle`: asi el aviso no depende de que
   * cada llamador se acuerde de mirarlo.
   */
  private drawFromDeck(count: number): CardInstance[] {
    const drawn = this.run.deck.draw(count);
    const reshuffles = this.run.deck.takeReshuffleCount();
    if (reshuffles > 0) bus.emit('deck:reshuffle', { count: reshuffles });
    return drawn;
  }

  private dispatchGlobal(event: GlobalTriggerEvent): void {
    if (!this.run) return;
    const res = this.scorer.resolveEvent(event, {
      scored: [],
      held: this.round?.hand ?? [],
      hand: this.round?.hand ?? [],
      jokers: this.run.jokers,
      ...(this.round?.blind.effects ? { blindEffects: this.round.blind.effects } : {}),
      money: this.run.money,
      cardsPlayedThisRound: this.round?.cardsPlayedThisRound ?? 0,
      cardsDiscardedThisRound: this.round?.cardsDiscardedThisRound ?? 0,
      isFirstPlayOfRound: this.round?.isFirstPlayOfRound ?? false,
      consumedPerRound: this.round?.consumedEffects ?? [],
      consumedPerRun: this.run.consumedEffects,
    });
    this.applyDeltas(res);
  }

  /** Aplica efectos de forma inmediata (compras de mutacion, eventos globales). */
  private applyImmediateEffects(
    sourceId: string,
    effects: readonly { trigger: string; actions: readonly unknown[] }[],
    nameKey: string,
  ): void {
    const res = new ResolutionContext({
      money: this.run.money,
      jokerCount: this.run.jokers.length,
    });
    const source = {
      uid: sourceId,
      nameKey,
      kind: 'blind' as const,
      effects: effects as never,
      order: 0,
    };

    for (const effect of effects) {
      for (const action of effect.actions) {
        applyAction(action as never, {
          res,
          source,
          target: undefined,
          depth: 0,
          registry: this.registry,
          rng: this.rng,
          emit: () => {
            /* los efectos inmediatos no encadenan eventos */
          },
        });
      }
    }

    if (res.moneyDelta !== 0) this.setMoney(res.moneyDelta);
    if (res.handSizeDelta !== 0) {
      this.run.baseHandSize += res.handSizeDelta;
      if (this.round) this.round.handSize += res.handSizeDelta;
    }
    if (res.handsDelta !== 0) {
      this.run.baseHands += res.handsDelta;
      if (this.round) this.round.handsLeft += res.handsDelta;
    }
    if (res.discardsDelta !== 0) {
      this.run.baseDiscards += res.discardsDelta;
      if (this.round) this.round.discardsLeft += res.discardsDelta;
    }
    if (res.jokerSlotsDelta !== 0) {
      this.run.jokerSlots = Math.max(1, this.run.jokerSlots + res.jokerSlotsDelta);
    }
    if (res.purgeCostDelta !== 0) {
      this.run.purgeCostBonus += res.purgeCostDelta;
    }
    for (const defId of res.createdIds) {
      if (!this.registry.tryGetCard(defId)) continue;
      const card = this.registry.instantiate(defId);
      this.run.deck.insert(card, 'random');
      bus.emit('card:created', { card });
    }
    for (const victim of res.destroyed) {
      this.run.deck.remove(victim.uid);
      if (this.round) this.round.hand = this.round.hand.filter((c) => c.uid !== victim.uid);
    }
  }

  /**
   * Sorteo de la tienda. El balance vive en `offers.json` (pack `base`): aca
   * solo se le pasa el contexto. Antes esto era un bloque hardcodeado.
   */
  private rollOffers(sequence: number): ShopOffer[] {
    return this.offers.rollPhase('shop', this.rollContext(sequence));
  }

  private rollContext(sequence: number) {
    return {
      rng: this.rng,
      ante: this.run.ante,
      blindIndex: this.run.blindIndex,
      sequence,
      ...(this.contentFilter ? { cardFilter: this.contentFilter } : {}),
      ...(this.jokerFilter ? { jokerFilter: this.jokerFilter } : {}),
      // Los vouchers ya comprados quedan fuera del sorteo: ofrecer una regla
      // que el jugador tiene es una oferta muerta que ocupa un lugar.
      ownedVouchers: this.run.vouchers,
      // Sesgo de arquetipo (ver `RunState.archetype`). Vacio en una run
      // clasica, y entonces `OfferService` sortea sin ponderar por elemento.
      elementBias: this.archetypeBias,
    };
  }

  /**
   * Aplica (o acumula) un estado sobre una carta. Es la MUTACION REAL que antes
   * vivia dentro de `APPLY_STATUS`, ahora diferida: la llama `applyDeltas`
   * cuando la resolucion cierra y NO es un dryRun.
   *
   * `turnsLeft: -1` es PERMANENTE. Un estado temporal extiende su duracion al
   * maximo de lo ya puesto (no se suma: dos aplicaciones de 3 turnos no son 6).
   */
  private applyStatusToCard(
    card: CardInstance,
    status: StatusType,
    value: number,
    turns: number,
  ): void {
    const existing = card.statuses.find((s) => s.type === status);
    if (existing) {
      existing.value += value;
      existing.turnsLeft = Math.max(existing.turnsLeft, turns);
    } else {
      card.statuses.push({ type: status, value, turnsLeft: turns });
    }
  }

  /**
   * Envejece los estados al cerrar el ciego.
   *
   * Recorre `deck.allCards` MAS la mano: antes solo miraba las pilas
   * (`drawPile`/`discardPile`), asi que un estado temporal sobre una carta que
   * terminaba el ciego EN LA MANO no envejecia jamas — el caso concreto de la
   * putrefaccion que se acumulaba sin remedio. `turnsLeft: -1` sigue siendo
   * permanente (baja a -2, -3… y nunca llega a 0).
   */
  private decayStatuses(): void {
    const seen = new Set<string>();
    const cards: CardInstance[] = [];
    for (const card of this.run.deck.allCards) {
      if (seen.has(card.uid)) continue;
      seen.add(card.uid);
      cards.push(card);
    }
    // La mano puede contener cartas que ya no estan en las pilas (o al reves):
    // se recorren ambas sin duplicar por uid.
    for (const card of this.round?.hand ?? []) {
      if (seen.has(card.uid)) continue;
      seen.add(card.uid);
      cards.push(card);
    }

    for (const card of cards) {
      if (card.statuses.length === 0) continue;
      // Se recolectan los que se agotan para poder AVISAR (P2.6): el render anima
      // la salida del estado en vez de descubrirla en el proximo repintado.
      const expired: StatusType[] = [];
      card.statuses = card.statuses
        .map((s) => {
          const turnsLeft = s.turnsLeft - 1;
          if (turnsLeft === 0) expired.push(s.type);
          return { ...s, turnsLeft };
        })
        .filter((s) => s.turnsLeft !== 0);
      for (const status of expired) bus.emit('status:expired', { uid: card.uid, status });
    }
  }

  private setMoney(delta: number): void {
    this.run.money = Math.max(0, this.run.money + delta);
    bus.emit('money:changed', { money: this.run.money, delta });
  }

  private requireRound(): RoundState {
    if (!this.round) throw new Error('[GameEngine] No hay ronda activa. Llama a startRun() primero.');
    return this.round;
  }

  // ==========================================================================
  // Misiones de run (P2.6)
  // ==========================================================================

  /** Misiones activas (definicion + estado actual). Para el HUD. */
  activeMissions(): Array<{ def: MissionDef; state: MissionState }> {
    const byId = new Map(this.missionDefs.map((d) => [d.id, d]));
    const out: Array<{ def: MissionDef; state: MissionState }> = [];
    for (const state of this.run.missions) {
      const def = byId.get(state.id);
      if (def) out.push({ def, state });
    }
    return out;
  }

  /**
   * Sortea misiones nuevas para el ante actual. Se llama al ENTRAR a la
   * seleccion de ciego, y solo si quedan huecos libres: dos misiones activas a
   * la vez es el tope, o la lista se vuelve ruido.
   */
  private rollMissions(): void {
    if (this.missionDefs.length === 0) return;

    const active = this.run.missions.filter((m) => !m.completed);
    const free = MAX_ACTIVE_MISSIONS - active.length;
    if (free <= 0) return;

    const exclude = this.run.missions.map((m) => m.id);
    const picked = pickMissions(this.missionDefs, this.run.ante, exclude, free, () =>
      this.rng.next(),
    );
    for (const def of picked) {
      this.run.missions.push({ id: def.id, progress: 0, completed: false });
      bus.emit('mission:added', { id: def.id, nameKey: def.nameKey, descKey: def.descKey });
    }
  }

  /**
   * Aplica un evento del bus a las misiones activas. Lo llama el CONTROLADOR
   * (main.ts) desde el bus: el motor no se auto-escucha, porque eso lo obligaria
   * a conocer la forma exacta de cada payload.
   *
   * Devuelve las misiones completadas para que quien llame muestre el aviso.
   */
  advanceMissionsOn(event: string, payload: unknown, ctx?: Record<string, number | string | boolean>): MissionDef[] {
    if (this.missionDefs.length === 0 || this.run.missions.length === 0) return [];

    const world = {
      payload,
      ctx: ctx ?? {
        ante: this.run.ante,
        jokerCount: this.run.jokers.length,
        money: this.run.money,
        // Total del mazo CON la mano: `run.deck.totalSize` solo cuenta las dos
        // pilas, asi que a mitad de mano daria menos y una mision del tipo
        // "llega a N cartas" se cumpliria a destiempo.
        deckSize: this.deckSize,
      },
    };
    const { next, completed } = advanceMissions(
      this.run.missions,
      this.missionDefs,
      event,
      world,
    );
    this.run.missions = next;

    for (const def of completed) {
      this.setMoney(def.reward);
      bus.emit('mission:completed', {
        id: def.id,
        nameKey: def.nameKey,
        descKey: def.descKey,
        reward: def.reward,
      });
    }
    return completed;
  }


  roundSnapshot(): RoundSnapshot {
    const round = this.round;
    if (!round) {
      return {
        handSize: this.run?.baseHandSize ?? 0,
        handsLeft: 0,
        discardsLeft: 0,
        score: 0,
        target: 0,
        substrate: 0,
        spores: 1,
        hand: [],
        deckRemaining: 0,
      };
    }
    return {
      handSize: round.handSize,
      handsLeft: round.handsLeft,
      discardsLeft: round.discardsLeft,
      score: round.score,
      target: round.target,
      substrate: 0,
      spores: 1,
      hand: round.hand,
      deckRemaining: this.run.deck.remaining,
    };
  }

  runSnapshot(): RunSnapshot {
    return {
      seed: this.run.seed,
      ante: this.run.ante,
      money: this.run.money,
      jokers: this.run.jokers,
      jokerSlots: this.run.jokerSlots,
      // Fuente UNICA del tamano de mazo que ve la UI: incluye la mano. Con
      // `totalSize` a secas, cualquier consumidor del snapshot (logros, debug,
      // tests) media menos cartas de las que el jugador tiene.
      deckSize: this.deckSize,
      handSize: this.run.baseHandSize,
      hands: this.run.baseHands,
      discards: this.run.baseDiscards,
      round: this.run.stats.handsPlayed,
      totalScore: this.run.totalScore,
      status: this.run.status,
    };
  }

  private emitState(): void {
    bus.emit('state:changed', { run: this.runSnapshot(), round: this.round ? this.roundSnapshot() : null });
  }

  /** Acceso de solo lectura al scorer (para la UI de tooltips). */
  get calculator(): ScoreCalculator {
    return this.scorer;
  }

  /** Referencia a un joker por uid (para el render). */
  findJoker(uid: string): JokerInstance | undefined {
    return this.run.jokers.find((j) => j.uid === uid);
  }

  /** Busca una carta en mano por uid. */
  findCard(uid: string): CardInstance | undefined {
    return this.round?.hand.find((c) => c.uid === uid);
  }

  /**
   * Busca una carta en la mano o en el mazo.
   *
   * Hace falta porque una mejora pedida por un efecto puede apuntar a una carta
   * que ya salio de la mano (o que todavia no entro), y perderla silenciosamente
   * seria un efecto que no hace nada.
   */
  findCardEverywhere(uid: string): CardInstance | undefined {
    return (
      this.round?.hand.find((c) => c.uid === uid) ?? this.run.deck.allCards.find((c) => c.uid === uid)
    );
  }

  // ==========================================================================
  // Persistencia
  // ==========================================================================

  /**
   * Serializa la run a JSON plano.
   *
   * Se guardan IDs y deltas, NUNCA objetos: las definiciones de carta viven en
   * el contenido y pueden cambiar entre versiones. Guardar solo el id permite
   * rebalancear una carta y que la partida guardada tome los valores nuevos.
   * `version` existe justamente para poder migrar cuando cambie el formato.
   */
  serialize(): RunSaveData {
    const cards = this.run.deck.allCards.map(serializeCard);
    return {
      version: SAVE_VERSION,
      savedAt: new Date().toISOString(),
      seed: this.run.seed,
      ante: this.run.ante,
      blindIndex: this.run.blindIndex,
      money: this.run.money,
      jokerSlots: this.run.jokerSlots,
      baseHandSize: this.run.baseHandSize,
      baseHands: this.run.baseHands,
      baseDiscards: this.run.baseDiscards,
      jokers: this.run.jokers.map((j) => j.def.id),
      deck: cards,
      totalScore: this.run.totalScore,
      stats: { ...this.run.stats },
      consumedEffects: [...this.run.consumedEffects],
      // Vouchers comprados: una run retomada tiene que seguir con las MISMAS
      // reglas, o el jugador veria el objetivo cambiar al recargar.
      vouchers: [...this.run.vouchers],
      // Nivel de dificultad elegido: sin esto, recargar una run A5 la
      // devolveria a A0 y el objetivo bajaría solo. Mismo motivo que vouchers.
      ascension: this.run.ascension,
      // Arquetipo de la run (ADITIVO, sin bump de version como vouchers). Es un
      // id, no un objeto: rebalancear el arquetipo no invalida guardados.
      archetype: this.run.archetype,
      // --- P2.4: interludios (aditivo, sin bump de version como vouchers) ---
      interludeTargetMultiplier: this.run.interludeModifiers.targetMultiplier,
      seenInterludes: [...this.run.seenInterludes],
      // --- P2.6: misiones de run (aditivo) ---
      missions: this.run.missions.map((m) => ({ ...m })),
      // --- v2: trazabilidad de contenido (DLC / rebalanceos) ---
      contentHash: this.contentHash,
      packIds: [...this.packIds],
      // Cupo de purgas del ante (aditivo, sin bump de version).
      purgesThisAnte: this.run.purgesThisAnte,
      // Tutorial guiado (aditivo). NO es una regla: es una marca para la UI.
      // Sobrevive al guardado para que una run-tutorial retomada siga guiada.
      tutorial: this.run.tutorial,
    };
  }

  /** Reconstruye una run desde un guardado. Devuelve false si es invalido. */
  restore(data: RunSaveData): boolean {
    if (!data || data.version !== SAVE_VERSION) return false;
    if (!Array.isArray(data.deck) || data.deck.length === 0) return false;

    // Si una carta del guardado ya no existe en el contenido, se descarta en
    // vez de romper: es lo que permite borrar cartas sin invalidar saves.
    const restoredCards: CardInstance[] = [];
    for (const saved of data.deck) {
      const def = this.registry.tryGetCard(saved.id);
      if (!def) continue;
      restoredCards.push(deserializeCard(saved, this.registry));
    }
    if (restoredCards.length === 0) return false;

    const deck = new Deck(this.rng);
    deck.setCards(restoredCards);

    // El estado se crea CON la ascension guardada: los deltas de esa dificultad
    // (manos, descartes, slots, dinero) tienen que nacer aplicados. Si se
    // creara en A0, los valores de abajo (que pueden venir de un voucher o de
    // una recompensa) se medirian contra una base equivocada.
    const savedAscension = typeof data.ascension === 'number' ? data.ascension : 0;
    const savedArchetype = typeof data.archetype === 'string' ? data.archetype : '';
    this.run = createRunState(data.seed, deck, savedAscension, savedArchetype);
    this.run.ante = data.ante;
    this.run.blindIndex = data.blindIndex;
    this.run.money = data.money;
    this.run.jokerSlots = data.jokerSlots;
    this.run.baseHandSize = data.baseHandSize;
    this.run.baseHands = data.baseHands;
    this.run.baseDiscards = data.baseDiscards;
    // Score acumulado: OPCIONAL/ADITIVO (los guardados previos no lo tienen).
    // `?? 0` deja una run vieja jugable en vez de romper la carga.
    this.run.totalScore = typeof data.totalScore === 'number' ? data.totalScore : 0;
    // Tutorial (aditivo): un guardado previo no trae el campo y la run sigue
    // SIN tutorial. `=== true` para que un `undefined`/basura no lo active.
    this.run.tutorial = data.tutorial === true;
    // Se mezcla sobre el estado por defecto: si un campo nuevo falta en un
    // guardado migrado, la run sigue siendo jugable.
    this.run.stats = { ...this.run.stats, ...data.stats };
    this.run.consumedEffects = new Set(data.consumedEffects ?? []);
    // `?? []` y el filtro por existencia: un guardado viejo no tiene el campo, y
    // un voucher borrado del contenido no puede romper la carga.
    this.run.vouchers = (data.vouchers ?? []).filter((id) => !!this.registry.tryGetVoucher(id));
    // Interludios: aditivo. Un guardado previo a P2.4 no trae los campos y la
    // run sigue con el multiplicador neutro y sin eventos vistos.
    this.run.interludeModifiers = {
      targetMultiplier:
        typeof data.interludeTargetMultiplier === 'number'
          ? data.interludeTargetMultiplier
          : 1,
    };
    this.run.seenInterludes = (data.seenInterludes ?? []).filter((id) =>
      this.registry.interludeDefs.some((def) => def.id === id),
    );
    // Cupo de purgas: aditivo (los guardados previos no lo traen ⇒ 0 usadas).
    // Se clampea a [0, tope] por si un guardado manipul ado trae basura.
    this.run.purgesThisAnte = Math.min(
      this.purgesPerAnte,
      Math.max(0, Math.floor(Number(data.purgesThisAnte) || 0)),
    );
    // Misiones: se filtran por definiciones existentes (una mision borrada del
    // contenido no puede romper la carga) y se clampea el progreso.
    const knownMissions = new Map(this.missionDefs.map((d) => [d.id, d]));
    this.run.missions = (data.missions ?? [])
      .filter((m) => m && typeof m.id === 'string' && knownMissions.has(m.id))
      .map((m) => ({
        id: m.id,
        progress: Math.max(0, Number(m.progress) || 0),
        completed: m.completed === true,
      }));

    // El contenido cambio desde que se guardo: se avisa, pero NO se invalida.
    // Un rebalanceo no deberia borrarle la partida a nadie.
    if (data.contentHash && this.contentHash && data.contentHash !== this.contentHash) {
      bus.emit('log', { level: 'warn', key: 'log.contentChanged', params: {} });
    }

    this.run.jokers = [];
    for (const id of data.jokers) {
      if (!this.registry.tryGetJoker(id)) continue;
      this.run.jokers.push(this.registry.instantiateJoker(id));
    }

    this.round = null;
    bus.emit('run:start', { seed: this.run.seed, ante: this.run.ante });
    // `restoring` suprime el sorteo de misiones de `enterBlindSelect`: las que
    // vienen del guardado son las que valen.
    this.restoring = true;
    try {
      this.enterBlindSelect();
    } finally {
      this.restoring = false;
    }
    return true;
  }
}

/**
 * Version del formato de guardado. Subir al cambiar la estructura.
 *
 * v1 -> v2: contador de jugadas por carta (evoluciones), linaje de evolucion,
 * estadisticas de mejora/evolucion, hash de contenido y packs activos.
 * La migracion vive en `src/persistence/migrations.ts` y es una funcion pura.
 */
export const SAVE_VERSION = 2;

export interface SerializedCard {
  id: string;
  bonusSubstrate: number;
  bonusSpores: number;
  level: number;
  statuses: Array<{ type: string; value: number; turnsLeft: number }>;
  /** Veces que se jugo (para evoluciones por uso). */
  plays?: number;
  /** Id de la carta de la que evoluciono, si evoluciono. */
  evolvedFrom?: string | null;
}

export interface RunSaveData {
  version: number;
  savedAt: string;
  seed: number;
  ante: number;
  blindIndex: number;
  money: number;
  jokerSlots: number;
  baseHandSize: number;
  baseHands: number;
  baseDiscards: number;
  jokers: string[];
  deck: SerializedCard[];
  /**
   * Score acumulado de la run. OPCIONAL y aditivo: los guardados previos no lo
   * tienen y `restore` cae a 0. No hace falta subir `SAVE_VERSION`.
   */
  totalScore?: number;
  /** Tutorial guiado (aditivo): una run-tutorial retomada sigue guiada. */
  tutorial?: boolean;
  stats: {
    handsPlayed: number;
    bestHand: number;
    blindsCleared: number;
    cardsDestroyed: number;
    cardsUpgraded: number;
    cardsEvolved: number;
  };
  consumedEffects: string[];
  /**
   * Vouchers comprados en esta run. OPCIONAL a proposito: los guardados
   * anteriores a R3 no lo tienen, y `restore` cae a `[]`. No hace falta subir
   * `SAVE_VERSION` porque el campo es puramente aditivo.
   */
  vouchers?: string[];
  /**
   * Nivel de ascension con el que se arranco la run. OPCIONAL por la misma
   * razon que `vouchers`: los guardados previos a R1 no lo tienen y `restore`
   * cae a 0 (sin ascension). Al ser aditivo NO hace falta subir `SAVE_VERSION`.
   */
  ascension?: number;
  /**
   * Id del arquetipo de la run. OPCIONAL y aditivo: los guardados previos a la
   * feature no lo tienen y `restore` cae a `''` (clasico). NO hace falta subir
   * `SAVE_VERSION`.
   */
  archetype?: string;
  /**
   * Multiplicador de objetivo acumulado por interludios (P2.4). OPCIONAL y
   * aditivo: los guardados previos no lo tienen y `restore` cae a 1.
   */
  interludeTargetMultiplier?: number;
  /** Ids de interludios ya vistos (P2.4). OPCIONAL, mismo motivo. */
  seenInterludes?: string[];
  /**
   * Misiones activas en la run (P2.6). OPCIONAL y aditivo: los guardados
   * previos no lo tienen y `restore` cae a una lista vacia.
   */
  missions?: Array<{ id: string; progress: number; completed: boolean }>;
  /** Hash del contenido con el que se jugo (null = desconocido, ej. save v1). */
  contentHash: string | null;
  /** Packs activos cuando empezo la run. */
  packIds: string[];
  /**
   * Purgas usadas en el ante actual. OPCIONAL y aditivo: los guardados previos
   * no lo tienen y `restore` cae a 0 (cupo completo). NO hace falta subir
   * `SAVE_VERSION`.
   */
  purgesThisAnte?: number;
}

function serializeCard(card: CardInstance): SerializedCard {
  return {
    id: card.def.id,
    bonusSubstrate: card.bonusSubstrate,
    bonusSpores: card.bonusSpores,
    level: card.level,
    statuses: card.statuses.map((s) => ({ type: s.type, value: s.value, turnsLeft: s.turnsLeft })),
    plays: card.plays,
    ...(card.evolvedFrom ? { evolvedFrom: card.evolvedFrom } : { evolvedFrom: null }),
  };
}

function deserializeCard(saved: SerializedCard, registry: CardRegistry): CardInstance {
  const card = registry.instantiate(saved.id);
  card.bonusSubstrate = saved.bonusSubstrate ?? 0;
  card.bonusSpores = saved.bonusSpores ?? 0;
  card.level = saved.level ?? 1;
  card.plays = saved.plays ?? 0;
  card.evolvedFrom = saved.evolvedFrom ?? null;
  card.statuses = (saved.statuses ?? []).map((s) => ({
    type: s.type as CardInstance['statuses'][number]['type'],
    value: s.value,
    turnsLeft: s.turnsLeft,
  }));
  return card;
}
