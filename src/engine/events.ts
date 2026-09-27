/**
 * events.ts — Bus de eventos tipado + mapa de eventos observables.
 *
 * Hay DOS buses distintos y es importante no mezclarlos:
 *
 *  1. TriggerEngine (interno, `src/engine/triggers/`): resuelve las reacciones
 *     de cartas y jokers. Es sincrono y controla la profundidad de la cadena.
 *
 *  2. Emitter<GameEventMap> (este archivo, `bus`): es el canal *observable*.
 *     El render de Three.js y el HUD en DOM se suscriben aqui y reaccionan.
 *     El motor nunca sabe quien lo escucha.
 */

import type {
  BlindDefinition,
  CardInstance,
  EffectDefinition,
  JokerInstance,
  RoundSnapshot,
  RunSnapshot,
  ScoreBreakdown,
  ScoreStep,
  ShopOffer,
  TriggerEvent,
} from './types';

// ---------------------------------------------------------------------------
// Emitter generico y fuertemente tipado
// ---------------------------------------------------------------------------

export type Listener<T> = (payload: T) => void;
export type Unsubscribe = () => void;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyListener = Listener<any>;

export class Emitter<M> {
  private readonly channels = new Map<keyof M, Set<AnyListener>>();

  on<K extends keyof M>(event: K, listener: Listener<M[K]>): Unsubscribe {
    let set = this.channels.get(event);
    if (!set) {
      set = new Set();
      this.channels.set(event, set);
    }
    set.add(listener);
    return () => this.off(event, listener);
  }

  once<K extends keyof M>(event: K, listener: Listener<M[K]>): Unsubscribe {
    const unsub = this.on(event, (payload) => {
      unsub();
      listener(payload);
    });
    return unsub;
  }

  off<K extends keyof M>(event: K, listener: Listener<M[K]>): void {
    this.channels.get(event)?.delete(listener);
  }

  emit<K extends keyof M>(event: K, payload: M[K]): void {
    const set = this.channels.get(event);
    if (!set || set.size === 0) return;
    // Copia defensiva: un listener puede desuscribirse durante el emit.
    for (const listener of [...set]) {
      listener(payload);
    }
  }

  listenerCount<K extends keyof M>(event: K): number {
    return this.channels.get(event)?.size ?? 0;
  }

  clear(): void {
    this.channels.clear();
  }
}

// ---------------------------------------------------------------------------
// Eventos observables del juego
// ---------------------------------------------------------------------------

export interface GameEventMap {
  // --- Ciclo de vida ---
  'run:start': { seed: number; ante: number };
  'blind:selected': { blind: BlindDefinition; target: number };
  'round:start': { snapshot: RoundSnapshot };
  'round:win': { score: number; target: number; reward: number; money: number };
  'round:loss': { score: number; target: number };
  'game:over': { reason: 'loss' | 'victory'; ante: number };

  // --- Cartas ---
  'hand:dealt': { cards: CardInstance[] };
  'card:drawn': { card: CardInstance; index: number };
  'card:selected': { card: CardInstance };
  'card:deselected': { card: CardInstance };
  'card:played': { card: CardInstance; index: number };
  'card:discarded': { card: CardInstance; index: number };
  'card:held': { card: CardInstance };
  'card:destroyed': { card: CardInstance };
  'card:created': { card: CardInstance };

  // --- Puntuacion ---
  'score:step': { step: ScoreStep };
  'score:hand': { breakdown: ScoreBreakdown; total: number };
  'score:changed': { total: number; target: number; progress: number };

  // --- Disparadores (el render los usa para shake / particulas A->B) ---
  'trigger:fired': {
    effect: EffectDefinition;
    sourceId: string;
    sourceNameKey: string;
    targetUid?: string;
    depth: number;
  };
  'trigger:chain': { fromId: string; toId: string; depth: number };
  'trigger:overflow': { event: TriggerEvent; depth: number; reason: 'depth' | 'budget' };

  // --- Jokers y economia ---
  'joker:added': { joker: JokerInstance };
  'joker:sold': { joker: JokerInstance };
  'joker:triggered': { joker: JokerInstance };
  'money:changed': { money: number; delta: number };

  // --- Tienda ---
  'shop:enter': { offers: ShopOffer[]; money: number };
  'shop:exit': Record<string, never>;
  'shop:purchase': { offer: ShopOffer; money: number };
  'shop:reroll': { offers: ShopOffer[]; money: number };

  // --- Varios ---
  'state:changed': { run: RunSnapshot; round: RoundSnapshot | null };
  'i18n:changed': { lang: string };
  'log': { level: 'info' | 'warn' | 'error'; key: string; params?: Record<string, unknown> };
}

/** Instancia global del bus observable. Renderer y UI se suscriben aqui. */
export const bus = new Emitter<GameEventMap>();

export type GameEventName = keyof GameEventMap;
