/**
 * actions.ts — Registry de acciones.
 *
 * El mapa `HANDLERS` esta tipado como `{ [K in ActionType]: ... }`, lo que
 * significa: si agregas una accion al `ActionPayloadMap` de types.ts y no la
 * implementas aca, TypeScript NO COMPILA. Es imposible olvidarse una.
 *
 * Todas las acciones escriben en el `ResolutionContext` (nunca en el estado
 * global) y pueden emitir eventos secundarios via `env.emit`, que el
 * TriggerEngine resuelve con control de profundidad.
 */

import type { CardRegistry } from '../cards/CardRegistry';
import type { RNG } from '../rng';
import type { ResolutionContext } from '../resolution';
import type {
  ActionOf,
  ActionType,
  CardInstance,
  EffectAction,
  TriggerEvent,
} from '../types';
import type { EffectSource } from './source';

export interface EmitRequest {
  event: TriggerEvent;
  card?: CardInstance;
  cardIndex?: number;
}

export interface ActionEnv {
  res: ResolutionContext;
  source: EffectSource;
  /** Carta objetivo resuelta segun el `target` del efecto. */
  target: CardInstance | undefined;
  depth: number;
  registry: CardRegistry;
  rng: RNG;
  emit: (req: EmitRequest) => void;
}

type Handler<K extends ActionType> = (action: ActionOf<K>, env: ActionEnv) => void;
type HandlerMap = { [K in ActionType]: Handler<K> };

const HANDLERS: HandlerMap = {
  ADD_SUBSTRATE: (a, env) => {
    env.res.addSubstrate(a.value, env.source.uid, env.source.nameKey, env.depth, env.target?.uid);
    env.emit({ event: 'ON_SUBSTRATE_GAINED', ...(env.target ? { card: env.target } : {}) });
  },

  MULTIPLY_SUBSTRATE: (a, env) => {
    env.res.multiplySubstrate(a.value, env.source.uid, env.source.nameKey, env.depth);
    env.emit({ event: 'ON_SUBSTRATE_GAINED', ...(env.target ? { card: env.target } : {}) });
  },

  ADD_SPORES: (a, env) => {
    env.res.addSpores(a.value, env.source.uid, env.source.nameKey, env.depth, env.target?.uid);
    env.emit({ event: 'ON_SPORES_GAINED', ...(env.target ? { card: env.target } : {}) });
  },

  MULTIPLY_SPORES: (a, env) => {
    env.res.multiplySpores(a.value, env.source.uid, env.source.nameKey, env.depth, env.target?.uid);
    env.emit({ event: 'ON_SPORES_GAINED', ...(env.target ? { card: env.target } : {}) });
  },

  SET_SPORES: (a, env) => {
    env.res.setSpores(a.value, env.source.uid, env.source.nameKey, env.depth);
    env.emit({ event: 'ON_SPORES_GAINED', ...(env.target ? { card: env.target } : {}) });
  },

  GAIN_MONEY: (a, env) => {
    env.res.moneyDelta += a.value;
    env.emit({ event: 'ON_MONEY_GAINED' });
  },

  DRAW_CARDS: (a, env) => {
    env.res.drawRequests += a.value;
  },

  ADD_HAND_SIZE: (a, env) => {
    env.res.handSizeDelta += a.value;
  },

  ADD_HANDS: (a, env) => {
    env.res.handsDelta += a.value;
  },

  ADD_DISCARDS: (a, env) => {
    env.res.discardsDelta += a.value;
  },

  ADD_JOKER_SLOTS: (a, env) => {
    env.res.jokerSlotsDelta += a.value;
  },

  DESTROY_SELF: (_a, env) => {
    const victim = env.target ?? env.source.card;
    if (!victim) return;
    if (env.res.destroyed.some((c) => c.uid === victim.uid)) return;
    env.res.destroyed.push(victim);
    env.emit({ event: 'ON_CARD_DESTROYED', card: victim });
  },

  /**
   * RETRIGGER: vuelve a disparar el ON_PLAY del objetivo N veces.
   * Es la accion mas peligrosa del juego (permite combos infinitos), por eso
   * el TriggerEngine corta por profundidad y por presupuesto global.
   */
  RETRIGGER: (a, env) => {
    const target = env.target ?? env.source.card;
    if (!target) return;
    const times = Math.max(1, Math.floor(a.value));
    for (let i = 0; i < times; i++) {
      env.emit({ event: 'ON_PLAY', card: target });
    }
  },

  LEVEL_UP_CARD: (a, env) => {
    const target = env.target ?? env.source.card;
    if (!target) return;
    const levels = Math.max(1, Math.floor(a.value));
    for (let i = 0; i < levels; i++) {
      target.level += 1;
      target.bonusSubstrate += 3 + target.level;
      target.bonusSpores += 1;
    }
  },

  CREATE_CARD: (a, env) => {
    if (!env.registry.tryGetCard(a.cardId)) return;
    env.res.createdIds.push(a.cardId);
  },

  APPLY_STATUS: (a, env) => {
    const target = env.target ?? env.source.card;
    if (!target) return;
    const turns = a.turns ?? 1;
    const existing = target.statuses.find((s) => s.type === a.status);
    if (existing) {
      existing.value += a.value;
      existing.turnsLeft = Math.max(existing.turnsLeft, turns);
    } else {
      target.statuses.push({ type: a.status, value: a.value, turnsLeft: turns });
    }
    env.res.statusRequests.push({ uid: target.uid, status: a.status, value: a.value, turns });
  },

  EMIT_EVENT: (a, env) => {
    env.emit({ event: a.event });
  },
};

/** Punto de entrada unico. Despacha por discriminante `type`. */
export function applyAction(action: EffectAction, env: ActionEnv): void {
  const handler = HANDLERS[action.type] as Handler<typeof action.type> | undefined;
  if (!handler) {
    throw new Error(`[actions] Accion sin implementar: "${action.type}"`);
  }
  handler(action as never, env);
}

/** Lista de acciones soportadas (para validacion y para el editor de cartas). */
export function supportedActions(): ActionType[] {
  return Object.keys(HANDLERS) as ActionType[];
}
