/**
 * ScoreCalculator.ts — Pipeline de resolucion de una mano.
 *
 * Orden de resolucion (importa y esta fijado a proposito):
 *   1. Se suman los valores base de cada carta jugada (Substrate + Spores).
 *   2. Por cada carta, en orden de izquierda a derecha:
 *        a. ON_PLAY          -> solo la carta jugada reacciona a si misma
 *        b. ON_CARD_PLAYED   -> jokers, luego cartas en mano, luego otras cartas jugadas
 *   3. ON_CARD_HELD por cada carta que quedo en mano.
 *   4. ON_HAND_SCORED al cerrar la mano.
 *
 * El resultado es un `ResolutionContext` con el score desglosado y el registro
 * completo de pasos (`steps`), que es lo que el render usa para las particulas.
 */

import type { CardRegistry } from '../cards/CardRegistry';
import type { RNG } from '../rng';
import { ResolutionContext, type ResolutionInit } from '../resolution';
import { detectCombos } from './combos';
import { detectOrderBonuses } from './orderBonus';
import type {
  CardInstance,
  EffectDefinition,
  JokerInstance,
  ScoreBreakdown,
  TriggerEvent,
} from '../types';
import { sourceFromCard, sourceFromJoker, statusValue, type EffectSource } from '../triggers/source';
import type { TriggerEngine } from '../triggers/TriggerEngine';

export interface ResolveHandOptions extends ResolutionInit {
  scored: CardInstance[];
  held: CardInstance[];
  jokers: readonly JokerInstance[];
  /** Efectos ambientales del blind activo (se resuelven con prioridad media). */
  blindEffects?: readonly EffectDefinition[];
  /** Si es true, no se contabilizan disparos de jokers (previsualizacion). */
  dryRun?: boolean;
  /** Estado de consumo persistido: efectos "once" ya usados esta ronda. */
  consumedPerRound?: Iterable<string>;
  /** Estado de consumo persistido: efectos "once" ya usados esta partida. */
  consumedPerRun?: Iterable<string>;
}

const ORDER = {
  joker: 0,
  blind: 100,
  held: 200,
  scored: 300,
} as const;

export class ScoreCalculator {
  constructor(
    private readonly triggers: TriggerEngine,
    private readonly registry: CardRegistry,
    private readonly rng: RNG,
  ) {}

  /**
   * Resuelve una mano completa. No muta el estado de la run: todo queda en el
   * `ResolutionContext` para que GameEngine lo aplique despues.
   */
  resolveHand(opts: ResolveHandOptions): ResolutionContext {
    const res = this.makeContext(opts);
    res.dryRun = opts.dryRun ?? false;

    const sources: EffectSource[] = [
      ...opts.jokers.map((j, i) => sourceFromJoker(j, ORDER.joker + i)),
      ...this.blindSources(opts.blindEffects),
      ...opts.held.map((c, i) => sourceFromCard(c, ORDER.held + i)),
      ...opts.scored.map((c, i) => sourceFromCard(c, ORDER.scored + i)),
    ];

    // --- Paso 1: valores base de las cartas jugadas ---
    for (const card of opts.scored) {
      this.addCardBaseValues(card, res);
    }

    // --- Paso 1.5: combos de mano (elemento / familia / diversidad) ---
    const combos = detectCombos(opts.scored);
    for (const combo of combos) {
      res.combos.push(combo);
      const sourceId = `combo:${combo.id}`;
      if (combo.flatSubstrate !== 0) {
        res.addSubstrate(combo.flatSubstrate, sourceId, combo.nameKey, 0);
      }
      if (combo.sporeMultiplier !== 1) {
        res.multiplySpores(combo.sporeMultiplier, sourceId, combo.nameKey, 0);
      }
    }

    // --- Paso 1.6: bonus por ORDEN de juego ---
    // Hermano del paso 1.5: los combos miran QUE se jugo, esto mira EN QUE
    // ORDEN. Se aplica despues de los combos y antes de los efectos por carta,
    // asi los ON_PLAY ya ven el Sustrato con el bonus incluido.
    for (const bonus of detectOrderBonuses(opts.scored)) {
      const sourceId = `order:${bonus.id}`;
      if (bonus.flatSubstrate !== 0) {
        res.addSubstrate(bonus.flatSubstrate, sourceId, bonus.nameKey, 0);
      }
      if (bonus.sporeMultiplier !== 1) {
        res.multiplySpores(bonus.sporeMultiplier, sourceId, bonus.nameKey, 0);
      }
    }

    // --- Paso 2: por carta, ON_PLAY y ON_CARD_PLAYED ---
    for (let i = 0; i < opts.scored.length; i++) {
      const card = opts.scored[i];
      if (!card) continue;
      this.trigger(res, sources, 'ON_PLAY', card, i);
      this.trigger(res, sources, 'ON_CARD_PLAYED', card, i);
    }

    // --- Paso 3: cartas que quedaron en mano ---
    for (const card of opts.held) {
      this.triggers.dispatch({
        event: 'ON_CARD_HELD',
        res,
        sources,
        triggerCard: card,
        heldCard: card,
      });
    }

    // --- Paso 4: cierre de mano ---
    this.triggers.dispatch({ event: 'ON_HAND_SCORED', res, sources });

    return res;
  }

  /** Calcula el score de una mano SIN efectos secundarios (para tooltips). */
  preview(opts: Omit<ResolveHandOptions, 'dryRun'>): ScoreBreakdown {
    const res = this.resolveHand({ ...opts, dryRun: true });
    return breakdownOf(res);
  }

  /**
   * Resuelve el descarte de varias cartas en un unico contexto acumulado.
   * Los jokers que reaccionan a ON_CARD_DISCARDED pueden dar Substrate,
   * robar cartas o generar dinero: todo queda en el mismo `res`.
   */
  resolveDiscards(
    cards: CardInstance[],
    opts: Omit<ResolveHandOptions, 'scored' | 'held'>,
  ): ResolutionContext {
    const res = this.makeContext({ ...opts, scored: cards, held: opts.hand ?? [] });
    res.dryRun = opts.dryRun ?? false;

    const sources: EffectSource[] = [
      ...opts.jokers.map((j, i) => sourceFromJoker(j, ORDER.joker + i)),
      ...this.blindSources(opts.blindEffects),
      ...(opts.hand ?? []).map((c, i) => sourceFromCard(c, ORDER.held + i)),
    ];

    for (const card of cards) {
      this.triggers.dispatch({ event: 'ON_CARD_DISCARDED', res, sources, triggerCard: card });
    }

    return res;
  }

  /** Puntuacion de un evento suelto (ronda, compra, descarte...). */
  resolveEvent(
    event: TriggerEvent,
    opts: ResolveHandOptions & { triggerCard?: CardInstance },
  ): ResolutionContext {
    const res = this.makeContext(opts);
    res.dryRun = opts.dryRun ?? false;

    const sources: EffectSource[] = [
      ...opts.jokers.map((j, i) => sourceFromJoker(j, ORDER.joker + i)),
      ...this.blindSources(opts.blindEffects),
      ...opts.held.map((c, i) => sourceFromCard(c, ORDER.held + i)),
      ...opts.scored.map((c, i) => sourceFromCard(c, ORDER.scored + i)),
    ];

    this.triggers.dispatch({
      event,
      res,
      sources,
      ...(opts.triggerCard ? { triggerCard: opts.triggerCard } : {}),
    });

    return res;
  }

  // -------------------------------------------------------------------------

  private makeContext(opts: ResolveHandOptions): ResolutionContext {
    const res = new ResolutionContext({
      scoredCards: opts.scored,
      heldCards: opts.held,
      hand: opts.hand ?? opts.held,
      money: opts.money ?? 0,
      jokerCount: opts.jokers.length,
      isFirstPlayOfRound: opts.isFirstPlayOfRound ?? false,
      cardsPlayedThisRound: opts.cardsPlayedThisRound ?? 0,
      cardsDiscardedThisRound: opts.cardsDiscardedThisRound ?? 0,
    });
    res.seedConsumed(opts.consumedPerRound ?? [], opts.consumedPerRun ?? []);
    return res;
  }

  private trigger(
    res: ResolutionContext,
    sources: EffectSource[],
    event: TriggerEvent,
    card: CardInstance,
    index: number,
  ): void {
    this.triggers.dispatch({ event, res, sources, triggerCard: card, triggerCardIndex: index });
  }

  private blindSources(effects: readonly EffectDefinition[] | undefined): EffectSource[] {
    if (!effects || effects.length === 0) return [];
    return [
      {
        uid: '__blind__',
        nameKey: 'blind.current',
        kind: 'blind',
        effects,
        order: ORDER.blind,
      },
    ];
  }

  /**
   * Aplica los valores base de una carta al acumulador, respetando statuses.
   *   - spore_lock: la carta no aporta Spores (queda "esteril").
   *   - overgrowth: la carta aporta Spores extra.
   *
   * `decay` (Pudriendose) NO se resta aca: lo hace TriggerEngine por cada
   * disparo de la carta, que es donde tiene sentido ("te cuesta cada vez que
   * actua"). Este metodo solo mira los statuses que cambian los valores BASE.
   */
  private addCardBaseValues(card: CardInstance, res: ResolutionContext): void {
    const substrate = card.def.baseSubstrate + card.bonusSubstrate;
    res.substrateFromCards += substrate;

    const locked = statusValue(card, 'spore_lock') > 0;
    const spores = locked ? 0 : card.def.baseSpores + card.bonusSpores;
    res.sporesFromCards += spores;

    const overgrowth = statusValue(card, 'overgrowth');
    if (overgrowth > 0) res.sporesFromEffects += overgrowth;

    // Registro del paso base para que la UI pueda animar la carta aportando.
    res.steps.push({
      sourceId: card.uid,
      sourceNameKey: card.def.nameKey,
      action: 'ADD_SUBSTRATE',
      value: substrate,
      substrateAfter: res.substrate,
      sporesAfter: res.spores,
      depth: 0,
      targetUid: card.uid,
    });
  }

  /** Tira una mano nueva al descarte y roba. Usado por efectos de descarte. */
  rerollHand<T>(draw: () => T[]): T[] {
    return draw();
  }

  get registryRef(): CardRegistry {
    return this.registry;
  }

  get rngRef(): RNG {
    return this.rng;
  }
}

/** Convierte un ResolutionContext en el desglose que consume la UI. */
export function breakdownOf(res: ResolutionContext): ScoreBreakdown {
  return {
    baseSubstrate: res.substrateFromCards,
    addedSubstrate: res.substrateFromEffects,
    baseSpores: 1 + res.sporesFromCards,
    addedSpores: res.sporesFromEffects,
    multipliedSpores: res.sporesMultiplier,
    total: res.total,
  };
}
