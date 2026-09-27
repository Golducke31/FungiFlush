/**
 * TriggerEngine.ts — El nucleo del juego.
 *
 * Escucha eventos (ON_CARD_PLAYED, ON_HAND_SCORED, ON_CARD_DISCARDED...) y
 * resuelve las reacciones de cartas, jokers y blinds en cadena.
 *
 * TRES FRENOS CONTRA BUCLES INFINITOS (los tres son necesarios):
 *   1. Profundidad maxima (MAX_TRIGGER_DEPTH): corta cadenas A->B->C->...
 *   2. Presupuesto global por resolucion (MAX_TRIGGERS_PER_RESOLUTION):
 *      corta abanicos anchos (un joker que dispara 40 efectos en paralelo).
 *   3. Consumo de efectos `once`: corta re-disparos del mismo efecto.
 *
 * Cuando se corta algo, se emite 'trigger:overflow' para que la UI lo muestre
 * en vez de fallar en silencio.
 */

import { MAX_TRIGGER_DEPTH } from '../constants';
import { bus } from '../events';
import type { ResolutionContext } from '../resolution';
import type { RNG } from '../rng';
import type { CardRegistry } from '../cards/CardRegistry';
import type { CardInstance, Condition, EffectDefinition, EffectTarget, TriggerEvent } from '../types';
import { applyAction } from './actions';
import { evaluateAll, type ConditionWorld } from './conditions';
import { isDormant, statusValue, type EffectSource } from './source';

export interface DispatchRequest {
  event: TriggerEvent;
  res: ResolutionContext;
  /** Fuentes que pueden reaccionar, en cualquier orden (se ordenan aca). */
  sources: EffectSource[];
  /** Carta que origina el evento. Sin ella, ON_PLAY no se filtra. */
  triggerCard?: CardInstance;
  triggerCardIndex?: number;
  depth?: number;
  /** Para ON_CARD_HELD: la carta en cuestion. */
  heldCard?: CardInstance;
}

export class TriggerEngine {
  constructor(
    private readonly registry: CardRegistry,
    private readonly rng: RNG,
  ) {}

  /**
   * Despacha un evento y resuelve TODA la cadena de reacciones que provoca.
   * Es sincrono y determinista: mismo estado + misma semilla = mismo resultado.
   */
  dispatch(req: DispatchRequest): void {
    const depth = req.depth ?? 0;
    const { event, res, triggerCard, triggerCardIndex } = req;

    // --- Freno 1: profundidad ---
    if (depth > MAX_TRIGGER_DEPTH) {
      res.overflowEvents.push(`depth:${event}@${depth}`);
      bus.emit('trigger:overflow', { event, depth, reason: 'depth' });
      return;
    }

    const ordered = [...req.sources].sort((a, b) => a.order - b.order);

    for (const source of ordered) {
      // --- Freno 3a: una carta "dormant" no dispara nada ---
      if (source.card && isDormant(source.card)) continue;

      // ON_PLAY es un evento *reflexivo*: solo lo escucha la carta jugada.
      // Los terceros reaccionan a ON_CARD_PLAYED.
      if (event === 'ON_PLAY' && triggerCard && source.uid !== triggerCard.uid) continue;

      // ON_CARD_HELD solo lo escucha la carta que quedo en mano.
      if (event === 'ON_CARD_HELD' && req.heldCard && source.uid !== req.heldCard.uid) continue;

      for (let index = 0; index < source.effects.length; index++) {
        const effect = source.effects[index];
        if (!effect || effect.trigger !== event) continue;

        // --- Freno 3b: efectos "once" ---
        const key = res.keyOf(source.uid, effect.id, index);
        const onceRule = effect.once === 'per_round' || effect.once === 'per_run' ? effect.once : null;
        if (onceRule && res.isConsumed(key)) continue;

        const subject = source.card;
        const world = this.buildWorld(res, triggerCard);
        if (!evaluateAll(effect.conditions, world, subject)) continue;

        const chance = effect.chance ?? 1;
        if (!this.rng.chance(chance)) continue;

        const targets = this.resolveTargets(effect.target, source, triggerCard, res);

        for (const target of targets) {
          // --- Freno 2: presupuesto global ---
          if (!res.spend()) {
            res.overflowEvents.push(`budget:${event}`);
            bus.emit('trigger:overflow', { event, depth, reason: 'budget' });
            return;
          }

          if (onceRule) {
            res.consume(key, onceRule);
          }

          if (source.joker && !res.dryRun) source.joker.firedCount += 1;

          bus.emit('trigger:fired', {
            effect,
            sourceId: source.uid,
            sourceNameKey: source.nameKey,
            ...(target ? { targetUid: target.uid } : {}),
            depth,
          });

          // Flecha visual A -> B: la UI dibuja el hilo de esporas.
          if (triggerCard && source.uid !== triggerCard.uid) {
            bus.emit('trigger:chain', { fromId: source.uid, toId: triggerCard.uid, depth });
          }

          // Status 'decay': cada disparo de esa carta cuesta Substrate.
          if (source.card) {
            const decay = statusValue(source.card, 'decay');
            if (decay > 0) {
              res.addSubstrate(-decay, source.uid, source.nameKey, depth);
            }
          }

          this.applyActions(effect, source, target, depth, res, triggerCard, triggerCardIndex, req.sources);
        }
      }
    }
  }

  // -------------------------------------------------------------------------
  // Internos
  // -------------------------------------------------------------------------

  private applyActions(
    effect: EffectDefinition,
    source: EffectSource,
    target: CardInstance | undefined,
    depth: number,
    res: ResolutionContext,
    triggerCard: CardInstance | undefined,
    triggerCardIndex: number | undefined,
    sources: EffectSource[],
  ): void {
    for (const action of effect.actions) {
      applyAction(action, {
        res,
        source,
        target,
        depth,
        registry: this.registry,
        rng: this.rng,
        // Las acciones pueden disparar eventos nuevos: re-entramos con depth+1.
        emit: (next) => {
          const nextTrigger = next.card ?? triggerCard;
          const nextIndex = next.cardIndex ?? triggerCardIndex;
          this.dispatch({
            event: next.event,
            res,
            sources,
            ...(nextTrigger ? { triggerCard: nextTrigger } : {}),
            ...(nextIndex !== undefined ? { triggerCardIndex: nextIndex } : {}),
            depth: depth + 1,
          });
        },
      });
    }
  }

  /** Construye la vista de solo lectura que consumen las condiciones. */
  private buildWorld(res: ResolutionContext, triggerCard: CardInstance | undefined): ConditionWorld {
    const first = res.scoredCards[0];
    const last = res.scoredCards[res.scoredCards.length - 1];
    return {
      hand: res.hand,
      scoredCards: res.scoredCards,
      substrate: res.substrate,
      spores: res.spores,
      money: res.money + res.moneyDelta,
      cardsPlayedThisRound: res.cardsPlayedThisRound,
      cardsDiscardedThisRound: res.cardsDiscardedThisRound,
      jokerCount: res.jokerCount + res.jokerSlotsDelta,
      isFirstCardOfRound:
        !!triggerCard && first?.uid === triggerCard.uid && res.cardsPlayedThisRound === 0,
      isLastCardOfHand: !!triggerCard && last?.uid === triggerCard.uid,
      isFirstPlayOfRound: res.isFirstPlayOfRound,
    };
  }

  /** Resuelve a que cartas apunta un efecto. */
  private resolveTargets(
    target: EffectTarget | undefined,
    source: EffectSource,
    triggerCard: CardInstance | undefined,
    res: ResolutionContext,
  ): Array<CardInstance | undefined> {
    const mode = target ?? 'self';
    const pick = <T>(items: readonly T[]): T | undefined =>
      items.length > 0 ? items[Math.floor(this.rng.next() * items.length)] : undefined;

    switch (mode) {
      case 'self':
        return [source.card ?? triggerCard];
      case 'triggering_card':
        return triggerCard ? [triggerCard] : [undefined];
      case 'scored_cards':
        return res.scoredCards.length > 0 ? [...res.scoredCards] : [undefined];
      case 'leftmost_scored':
        return [res.scoredCards[0]];
      case 'rightmost_scored':
        return [res.scoredCards[res.scoredCards.length - 1]];
      case 'random_scored':
        return [pick(res.scoredCards)];
      case 'random_hand':
        return [pick(res.hand)];
      case 'previous_scored':
      case 'next_scored': {
        // Devuelve [] si no hay vecino: el efecto simplemente no se aplica.
        // Es clave para que un RETRIGGER no pueda volver sobre si mismo.
        if (!triggerCard) return [];
        const idx = res.scoredCards.findIndex((c) => c.uid === triggerCard.uid);
        if (idx < 0) return [];
        const neighbour = res.scoredCards[mode === 'previous_scored' ? idx - 1 : idx + 1];
        return neighbour ? [neighbour] : [];
      }
      default: {
        const _exhaustive: never = mode;
        void _exhaustive;
        return [undefined];
      }
    }
  }

  /** Valida en runtime que las condiciones de un JSON sean evaluables. */
  static validateConditions(conds: readonly Condition[] | undefined): string[] {
    const errors: string[] = [];
    const walk = (c: Condition, path: string): void => {
      if (typeof c !== 'object' || c === null || !('type' in c)) {
        errors.push(`${path}: condicion mal formada (falta "type").`);
        return;
      }
      if (c.type === 'not') walk(c.cond, `${path}.not`);
      if (c.type === 'all' || c.type === 'any') {
        c.conds.forEach((child, i) => walk(child, `${path}.${c.type}[${i}]`));
      }
    };
    (conds ?? []).forEach((c, i) => walk(c, `conditions[${i}]`));
    return errors;
  }
}
