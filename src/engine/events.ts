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

/**
 * `RetentionReward` vive en `src/retention/types.ts`, que NO importa nada: por
 * eso el motor puede nombrarlo sin volverse impuro. Es un import de SOLO tipo,
 * asi que no queda ninguna referencia en runtime (y por lo tanto ningun ciclo).
 */
import type { RetentionReward } from '../retention/types';

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
  /**
   * El RENDER termina de animar la mano. Es la señal que el HUD espera para
   * mostrar el panel siguiente: el motor ya cambio de estado mucho antes, pero
   * tapar la animacion con el panel era el bug.
   */
  'score:settled': Record<string, never>;
  /**
   * El dado TERMINA de rodar y se apoya con la cara que el motor ya sorteo.
   *
   * La tirada es manual (se arrastra el cubo y se lo suelta), asi que el motor
   * conoce el resultado mucho antes de que el dado se detenga. Mostrarlo al
   * soltar arruinaria la tirada: esta señal es la que habilita el resultado y
   * la eleccion de quedarsela o volver a tirar.
   */
  'die:settled': { face: number };

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

  // --- Recompensa (draft de cartas al ganar un blind) ---
  'reward:enter': { offers: ShopOffer[]; pick: number; allowSkip: boolean };
  'reward:pick': { offer: ShopOffer | null; card?: CardInstance };
  'reward:exit': Record<string, never>;

  // --- Tienda ---
  'shop:enter': { offers: ShopOffer[]; money: number };
  'shop:exit': Record<string, never>;
  'shop:purchase': { offer: ShopOffer; money: number };
  'shop:reroll': { offers: ShopOffer[]; money: number };
  /**
   * Se compro un modificador de run (R3). Se emite DESPUES de registrar la
   * regla: quien escuche y consulte `engine.modifiers` ya ve el efecto.
   * El id alcanza (no el objeto) porque el catalogo vive en el contenido.
   */
  'voucher:bought': { voucher: string };

  // --- Deckbuilding y cultivo ---
  'deck:purged': { card: CardInstance; cost: number };
  /** Una carta subio de nivel (por pago en el constructor de mazo o por efecto). */
  'card:levelup': { card: CardInstance; cost: number; level: number };
  /** Una carta evoluciono a otra especie conservando su uid. */
  'card:evolved': { card: CardInstance; fromId: string; ruleId: string };

  // --- Varios ---
  'state:changed': { run: RunSnapshot; round: RoundSnapshot | null };
  'i18n:changed': { lang: string };
  'log': { level: 'info' | 'warn' | 'error'; key: string; params?: Record<string, unknown> };

  // --- Retencion (NO los emite el motor) ---
  // El motor solo emite gameplay. Estos cuatro los emiten los observadores de
  // `main.ts`: son el unico canal por el que la capa de retencion le habla a la
  // UI sin que el motor sepa que existe.
  /** Un logro se desbloqueo por primera vez. */
  'achievement:unlocked': { id: string; nameKey: string; reward?: RetentionReward };
  /**
   * Se abrio una PUERTA de contenido por jugar (R2).
   *
   * No es lo mismo que un logro: `achievement:unlocked` avisa de una medalla,
   * esto avisa de que una carta entro al pool de sorteos. El `contentId` es el
   * dato util — es lo que la Coleccion tiene que dejar de mostrar como candado.
   */
  'unlock:granted': { contentId: string; kind: 'card' | 'joker'; nameKey: string };
  /** El jugador reclamo la recompensa diaria de hoy. */
  'daily:claim': { streak: number; reward?: RetentionReward };
  /** Aviso no bloqueante en el HUD (fallback del aviso del sistema). */
  'banner:show': { key: string; params?: Record<string, unknown>; kind?: 'info' | 'warn' | 'success' };
  /** XP de temporada ganada. */
  'pass:xp': { seasonId: string; amount: number; total: number };
}

/** Instancia global del bus observable. Renderer y UI se suscriben aqui. */
export const bus = new Emitter<GameEventMap>();

export type GameEventName = keyof GameEventMap;
