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

import { ANTE_BASE_TARGET, ECONOMY, MAX_HAND_SIZE, MAX_PLAY_SIZE_DEFAULT } from './constants';
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
  createRunState,
  jokerSellValue,
  rerollCost,
  type RunState,
} from './state/RunState';
import type {
  BlindDefinition,
  CardDefinition,
  CardInstance,
  JokerDefinition,
  JokerInstance,
  RoundSnapshot,
  RunSnapshot,
  ScoreBreakdown,
  ShopOffer,
} from './types';

const MAX_PLAY_SIZE = MAX_PLAY_SIZE_DEFAULT;

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

  run!: RunState;
  round: RoundState | null = null;

  /** Draft de recompensa pendiente (se sortea al ganar el blind). */
  private reward: { offers: ShopOffer[]; pick: number; allowSkip: boolean } | null = null;
  private rewardPicked = 0;

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
    this.emitState();
  }

  // ==========================================================================
  // Ciclo de vida de la run
  // ==========================================================================

  startRun(seed?: number): void {
    const deck = new Deck(seed !== undefined ? new RNG(seed) : this.rng);
    this.run = createRunState(seed ?? this.rng.getSeed(), deck);
    deck.setCards(this.registry.buildStarterDeck(this.rng));

    this.dispatchGlobal('ON_RUN_START');
    bus.emit('run:start', { seed: this.run.seed, ante: this.run.ante });

    // No se elige el blind automaticamente: el jugador decide (Blind Select).
    this.run.status = 'blind_select';
    this.emitState();
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
    return Math.round(base * blind.scoreMultiplier);
  }

  /**
   * El jugador elige el ciego y arranca la ronda.
   * Sin argumento, toma el que corresponde al indice actual del ante.
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

    // El jugador puede elegir cualquier ciego del ante, pero el indice de
    // progresion avanza igual: elegir el boss primero no saltea el ante.
    const target = this.targetFor(blind);

    this.round = createRoundState(
      blind,
      target,
      this.run.baseHandSize,
      this.run.baseHands,
      this.run.baseDiscards,
    );

    this.run.deck.shuffle();
    this.fillHand();

    bus.emit('blind:selected', { blind, target });
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

    // --- Anuncio visual de las cartas jugadas, en orden ---
    scored.forEach((card, index) => bus.emit('card:played', { card, index }));
    for (const step of res.steps) bus.emit('score:step', { step });
    held.forEach((card) => bus.emit('card:held', { card }));

    this.applyDeltas(res);

    round.score += res.total;
    round.handsLeft -= 1;
    round.cardsPlayedThisRound += scored.length;
    round.isFirstPlayOfRound = false;
    round.history.push({ cards: scored.map((c) => c.def.id), score: res.total });
    this.run.stats.handsPlayed += 1;
    this.run.stats.bestHand = Math.max(this.run.stats.bestHand, res.total);

    bus.emit('score:hand', { breakdown: breakdownOf(res), total: res.total });
    bus.emit('score:changed', {
      total: round.score,
      target: round.target,
      progress: Math.min(1, round.score / round.target),
    });

    // --- Las cartas jugadas van al descarte ---
    for (const card of scored) {
      // Contador de uso: alimenta las evoluciones por cantidad de jugadas.
      card.plays = (card.plays ?? 0) + 1;
      round.hand = round.hand.filter((c) => c.uid !== card.uid);
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
    const round = this.requireRound();
    if (this.run.status !== 'playing') return null;
    if (round.discardsLeft <= 0) return null;

    const discarded = selectedCards(round);
    if (discarded.length === 0) return null;

    const held = round.hand.filter((c) => !round.selected.includes(c.uid));
    const res = this.scorer.resolveDiscards(discarded, this.handOptions([], held));

    discarded.forEach((card, index) => bus.emit('card:discarded', { card, index }));
    this.applyDeltas(res);

    round.discardsLeft -= 1;
    round.cardsDiscardedThisRound += discarded.length;
    round.isFirstPlayOfRound = false;

    for (const card of discarded) {
      round.hand = round.hand.filter((c) => c.uid !== card.uid);
      this.run.deck.discard(card);
    }
    round.selected = [];

    this.fillHand();
    this.emitState();
    return res;
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

  rerollShop(): boolean {
    const shop = this.run.shop;
    if (!shop || this.run.status !== 'shop') return false;
    const cost = rerollCost(shop);
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

  /** Coste de purgar (eliminar) una carta del mazo. */
  get purgeCost(): number {
    return ECONOMY.purgeCost;
  }

  /**
   * Editar el mazo solo entre blinds o en la tienda, nunca en medio de una
   * mano: sacar o mejorar una carta que el jugador ya tiene en la mano (y que
   * quizas ya selecciono) seria un cambio de reglas a mitad de jugada.
   */
  canEditDeck(): boolean {
    return this.run.status === 'blind_select' || this.run.status === 'shop';
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
    if (this.run.money < ECONOMY.purgeCost) return false;

    const card = this.run.deck.allCards.find((c) => c.uid === uid);
    if (!card) return false;

    this.run.deck.remove(uid);
    if (this.round) this.round.hand = this.round.hand.filter((c) => c.uid !== uid);
    if (this.round) this.round.selected = this.round.selected.filter((id) => id !== uid);

    this.setMoney(-ECONOMY.purgeCost);
    bus.emit('deck:purged', { card, cost: ECONOMY.purgeCost });
    this.emitState();
    return true;
  }

  buyOffer(offerId: string): boolean {
    const shop = this.run.shop;
    if (!shop || this.run.status !== 'shop') return false;

    const offer = shop.offers.find((o) => o.id === offerId);
    if (!offer || offer.sold || this.run.money < offer.cost) return false;

    if (offer.kind === 'joker') {
      if (this.run.jokers.length >= this.run.jokerSlots) return false;
      const joker = this.registry.instantiateJoker(offer.refId);
      this.run.jokers.push(joker);
      bus.emit('joker:added', { joker });
    } else if (offer.kind === 'card') {
      const card = this.registry.instantiate(offer.refId);
      this.run.deck.insert(card, 'random');
      bus.emit('card:created', { card });
    } else {
      // Mutaciones: se aplican al instante y no ocupan slot.
      const def = this.registry.getJoker(offer.refId);
      this.applyImmediateEffects(def.id, def.effects, def.nameKey);
    }

    this.setMoney(-offer.cost);
    offer.sold = true;
    bus.emit('shop:purchase', { offer, money: this.run.money });
    this.emitState();
    return true;
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

    // Vuelve a la pantalla de eleccion: el jugador decide con que ciego sigue.
    this.run.status = 'blind_select';
    this.emitState();
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
      const reward =
        round.blind.reward +
        ECONOMY.baseBlindReward +
        round.handsLeft * ECONOMY.moneyPerUnusedHand;
      this.setMoney(reward);
      this.run.stats.blindsCleared += 1;

      bus.emit('round:win', {
        score: round.score,
        target: round.target,
        reward,
        money: this.run.money,
      });

      this.dispatchGlobal('ON_ROUND_WIN');

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
      bus.emit('round:loss', { score: round.score, target: round.target });
      this.dispatchGlobal('ON_ROUND_LOSS');
      this.run.status = 'game_over';
      bus.emit('game:over', { reason: 'loss', ante: this.run.ante });
      this.emitState();
    }
  }

  /** Reparte hasta completar el tamano de mano. */
  private fillHand(): void {
    const round = this.requireRound();
    const missing = round.handSize - round.hand.length;
    if (missing <= 0) return;

    const drawn = this.run.deck.draw(missing);
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
    const drawn = this.run.deck.draw(count);
    for (const card of drawn) {
      if (round.hand.length >= MAX_HAND_SIZE) {
        this.run.deck.discard(card);
        continue;
      }
      round.hand.push(card);
      bus.emit('card:drawn', { card, index: round.hand.length - 1 });
    }
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
    };
  }

  private decayStatuses(): void {
    for (const card of this.run.deck.allCards) {
      if (card.statuses.length === 0) continue;
      card.statuses = card.statuses
        .map((s) => ({ ...s, turnsLeft: s.turnsLeft - 1 }))
        .filter((s) => s.turnsLeft !== 0);
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
  // Snapshots (lo que consume el render / HUD)
  // ==========================================================================

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
      deckSize: this.run.deck.totalSize,
      handSize: this.run.baseHandSize,
      hands: this.run.baseHands,
      discards: this.run.baseDiscards,
      round: this.run.stats.handsPlayed,
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
      stats: { ...this.run.stats },
      consumedEffects: [...this.run.consumedEffects],
      // --- v2: trazabilidad de contenido (DLC / rebalanceos) ---
      contentHash: this.contentHash,
      packIds: [...this.packIds],
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

    this.run = createRunState(data.seed, deck);
    this.run.ante = data.ante;
    this.run.blindIndex = data.blindIndex;
    this.run.money = data.money;
    this.run.jokerSlots = data.jokerSlots;
    this.run.baseHandSize = data.baseHandSize;
    this.run.baseHands = data.baseHands;
    this.run.baseDiscards = data.baseDiscards;
    // Se mezcla sobre el estado por defecto: si un campo nuevo falta en un
    // guardado migrado, la run sigue siendo jugable.
    this.run.stats = { ...this.run.stats, ...data.stats };
    this.run.consumedEffects = new Set(data.consumedEffects ?? []);

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
    this.run.status = 'blind_select';
    bus.emit('run:start', { seed: this.run.seed, ante: this.run.ante });
    this.emitState();
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
  stats: {
    handsPlayed: number;
    bestHand: number;
    blindsCleared: number;
    cardsDestroyed: number;
    cardsUpgraded: number;
    cardsEvolved: number;
  };
  consumedEffects: string[];
  /** Hash del contenido con el que se jugo (null = desconocido, ej. save v1). */
  contentHash: string | null;
  /** Packs activos cuando empezo la run. */
  packIds: string[];
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
