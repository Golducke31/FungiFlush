/**
 * types.ts — Sistema de tipos central de FungiFlush.
 *
 * REGLA DE ORO DE ESTA CAPA:
 * Este archivo (y todo `src/engine/**`) NO importa nada de Three.js.
 * El motor logico es matematico y puro: se puede ejecutar en Node, en la
 * consola, o en un test, sin GPU ni DOM. El render solo *observa*.
 */

// ---------------------------------------------------------------------------
// Taxonomia
// ---------------------------------------------------------------------------

/** Elemento biologico de una carta. Define sinergias y condiciones. */
export type ElementType =
  | 'neutral'
  | 'poison'
  | 'spore'
  | 'decay'
  | 'symbiosis'
  | 'crystal'
  | 'mycelium'
  | 'parasite';

/** Familia taxonomica. Funciona como el "palo" del naipe: agrupa combos. */
export type FamilyType =
  | 'agaricaceae'
  | 'amanitaceae'
  | 'boletaceae'
  | 'polyporaceae'
  | 'psilocybaceae'
  | 'clavariaceae'
  | 'tricholomataceae';

export type Rarity = 'common' | 'uncommon' | 'rare' | 'legendary' | 'mythic';

/** Efectos negativos que se acumulan sobre cartas o sobre la ronda. */
export type StatusType =
  | 'dormant' // la carta no dispara sus efectos
  | 'decay' // resta Substrate plano por cada disparo
  | 'spore_lock' // bloquea multiplicadores durante N manos
  | 'overgrowth'; // suma Spores extra por carta jugada

export interface StatusInstance {
  type: StatusType;
  value: number;
  /** -1 = permanente dentro de la ronda. */
  turnsLeft: number;
}

// ---------------------------------------------------------------------------
// Eventos de disparo (el "Trigger Engine")
// ---------------------------------------------------------------------------

/**
 * Cada evento del juego es un punto de anclaje donde las cartas y los jokers
 * pueden reaccionar. Agregar un evento nuevo aqui hace que TypeScript exija
 * su implementacion en todo el motor.
 */
export type TriggerEvent =
  // --- Ciclo de vida ---
  | 'ON_RUN_START'
  | 'ON_BLIND_SELECTED'
  | 'ON_ROUND_START'
  | 'ON_ROUND_WIN'
  | 'ON_ROUND_LOSS'
  | 'ON_SHOP_ENTER'
  | 'ON_SHOP_EXIT'
  // --- Cartas ---
  | 'ON_DRAW'
  | 'ON_PLAY' // la propia carta jugada se dispara a si misma
  | 'ON_CARD_PLAYED' // lo escuchan terceros (jokers, otras cartas)
  | 'ON_CARD_DISCARDED'
  | 'ON_CARD_HELD' // carta que quedo en mano al momento de puntuar
  | 'ON_CARD_DESTROYED'
  // --- Resolucion ---
  | 'ON_HAND_SCORED' // despues de que toda la mano resolvio
  | 'ON_SUBSTRATE_GAINED'
  | 'ON_SPORES_GAINED'
  | 'ON_MONEY_GAINED';

export const TRIGGER_EVENTS: readonly TriggerEvent[] = [
  'ON_RUN_START',
  'ON_BLIND_SELECTED',
  'ON_ROUND_START',
  'ON_ROUND_WIN',
  'ON_ROUND_LOSS',
  'ON_SHOP_ENTER',
  'ON_SHOP_EXIT',
  'ON_DRAW',
  'ON_PLAY',
  'ON_CARD_PLAYED',
  'ON_CARD_DISCARDED',
  'ON_CARD_HELD',
  'ON_CARD_DESTROYED',
  'ON_HAND_SCORED',
  'ON_SUBSTRATE_GAINED',
  'ON_SPORES_GAINED',
  'ON_MONEY_GAINED',
] as const;

// ---------------------------------------------------------------------------
// Acciones — mapa tipado accion -> payload
// ---------------------------------------------------------------------------

/**
 * Agregar una accion nueva = agregar una linea aqui. TypeScript obliga
 * automaticamente a implementarla en `actions.ts` (registry exhaustivo).
 */
export interface ActionPayloadMap {
  ADD_SUBSTRATE: { value: number };
  MULTIPLY_SUBSTRATE: { value: number };
  ADD_SPORES: { value: number };
  MULTIPLY_SPORES: { value: number };
  SET_SPORES: { value: number };
  GAIN_MONEY: { value: number };
  DRAW_CARDS: { value: number };
  ADD_HAND_SIZE: { value: number };
  ADD_HANDS: { value: number };
  ADD_DISCARDS: { value: number };
  ADD_JOKER_SLOTS: { value: number };
  DESTROY_SELF: { value?: undefined };
  RETRIGGER: { value: number };
  LEVEL_UP_CARD: { value: number };
  CREATE_CARD: { cardId: string };
  APPLY_STATUS: { status: StatusType; value: number; turns?: number };
  /** Vuelve a emitir un evento del motor. Peligroso: el TriggerEngine lo limita por profundidad. */
  EMIT_EVENT: { event: TriggerEvent };
}

export type ActionType = keyof ActionPayloadMap;

export type EffectAction = {
  [K in ActionType]: { type: K } & ActionPayloadMap[K];
}[ActionType];

export type ActionOf<K extends ActionType> = Extract<EffectAction, { type: K }>;

// ---------------------------------------------------------------------------
// Condiciones — arboles evaluables, serializables en JSON
// ---------------------------------------------------------------------------

export type Condition =
  | { type: 'element_is'; value: ElementType }
  | { type: 'family_is'; value: FamilyType }
  | { type: 'rarity_is'; value: Rarity }
  | { type: 'element_in_hand'; value: ElementType }
  | { type: 'family_in_hand'; value: FamilyType }
  | { type: 'hand_size_gte'; value: number }
  | { type: 'substrate_gte'; value: number }
  | { type: 'spores_gte'; value: number }
  | { type: 'money_gte'; value: number }
  | { type: 'cards_played_gte'; value: number }
  | { type: 'cards_discarded_gte'; value: number }
  | { type: 'scored_count_gte'; value: number }
  | { type: 'scored_element_count_gte'; element: ElementType; value: number }
  | { type: 'scored_family_count_gte'; family: FamilyType; value: number }
  | { type: 'jokers_gte'; value: number }
  | { type: 'is_first_card_of_round' }
  | { type: 'is_last_card_of_hand' }
  | { type: 'is_first_play_of_round' }
  | { type: 'has_status'; status: StatusType }
  | { type: 'not'; cond: Condition }
  | { type: 'all'; conds: Condition[] }
  | { type: 'any'; conds: Condition[] };

// ---------------------------------------------------------------------------
// Efectos
// ---------------------------------------------------------------------------

export type EffectTarget =
  | 'self'
  | 'triggering_card'
  | 'scored_cards'
  | 'leftmost_scored'
  | 'rightmost_scored'
  | 'random_scored'
  | 'random_hand'
  /**
   * La carta inmediatamente anterior / posterior en el orden de la mano jugada.
   * Existe para evitar el auto-disparo: un efecto con target 'previous_scored'
   * NUNCA puede apuntarse a si mismo, lo que hace imposible el bucle directo.
   */
  | 'previous_scored'
  | 'next_scored';

/** Cuando un efecto se consume. */
export type ConsumptionRule = 'never' | 'per_round' | 'per_run';

export interface EffectDefinition {
  /** Identificador estable para tracking de "once" y para logs. */
  id?: string;
  trigger: TriggerEvent;
  conditions?: Condition[];
  actions: EffectAction[];
  /** Por defecto 'never'. */
  once?: ConsumptionRule;
  /** Probabilidad 0..1. Por defecto 1 (siempre). */
  chance?: number;
  /** Por defecto 'self'. */
  target?: EffectTarget;
  /** Clave i18n corta para el log de combate (ej: "effect.burst"). */
  labelKey?: string;
}

// ---------------------------------------------------------------------------
// Datos serializables (JSON)
// ---------------------------------------------------------------------------

/** Parametros para generar el arte procedural en el render (sin assets externos). */
export interface ArtSpec {
  /** Tono base 0..360. */
  hue: number;
  /** Tono secundario para el degradado. */
  hue2?: number;
  pattern: 'radial' | 'blotch' | 'rings' | 'fibrous' | 'crystal';
  /** 0..1 — intensidad del glow bioluminiscente. */
  glow?: number;
  /** Forma del sombrero dibujado en la textura. */
  silhouette?: 'cap' | 'cluster' | 'bracket' | 'coral' | 'mold' | 'truffle';
}

export interface CardDefinition {
  id: string;
  /** Clave i18n del nombre. NUNCA texto plano. */
  nameKey: string;
  /** Clave i18n de la descripcion. */
  descKey: string;
  element: ElementType;
  family: FamilyType;
  rarity: Rarity;
  baseSubstrate: number;
  baseSpores: number;
  /** Coste en la tienda. */
  cost: number;
  art: ArtSpec;
  effects?: EffectDefinition[];
  tags?: string[];
  /** Copias incluidas en el mazo inicial (solo si tiene tag "starter"). */
  copies?: number;
}

export interface JokerDefinition {
  id: string;
  nameKey: string;
  descKey: string;
  rarity: Rarity;
  cost: number;
  sellValue: number;
  art: ArtSpec;
  effects: EffectDefinition[];
  /**
   * Etiquetas libres. Convencion usada por el motor:
   *   - "mutation": en vez de ocupar un slot de joker, se aplica y desaparece.
   *   - "starter": carta incluida en el mazo inicial.
   *   - "cursed": carta con efecto negativo.
   */
  tags?: string[];
}

export interface BlindDefinition {
  id: string;
  nameKey: string;
  descKey: string;
  /** Ante (nivel) al que pertenece. 1..8 */
  ante: number;
  /** Multiplicador sobre el objetivo base del ante. */
  scoreMultiplier: number;
  /** Efectos ambientales activos durante el blind. */
  effects?: EffectDefinition[];
  /** Monedas que otorga al superarlo. */
  reward: number;
}

// ---------------------------------------------------------------------------
// Instancias en runtime
// ---------------------------------------------------------------------------

export interface CardInstance {
  uid: string;
  def: CardDefinition;
  /** Bonus acumulados por mejoras / efectos. */
  bonusSubstrate: number;
  bonusSpores: number;
  level: number;
  statuses: StatusInstance[];
}

export interface JokerInstance {
  uid: string;
  def: JokerDefinition;
  /** Contador de disparos, util para jokers que escalan. */
  firedCount: number;
}

export interface ScoreStep {
  sourceId: string;
  sourceNameKey: string;
  action: ActionType;
  value: number;
  substrateAfter: number;
  sporesAfter: number;
  depth: number;
  /** uid de la carta objetivo, si aplica. Sirve al render para trazar la flecha A->B. */
  targetUid?: string;
}

export interface ScoreBreakdown {
  baseSubstrate: number;
  addedSubstrate: number;
  baseSpores: number;
  addedSpores: number;
  multipliedSpores: number;
  total: number;
}

export interface RoundSnapshot {
  handSize: number;
  handsLeft: number;
  discardsLeft: number;
  score: number;
  target: number;
  substrate: number;
  spores: number;
  hand: CardInstance[];
  deckRemaining: number;
}

export interface ShopOffer {
  id: string;
  kind: 'card' | 'joker' | 'mutation' | 'voucher';
  refId: string;
  nameKey: string;
  descKey: string;
  cost: number;
  art: ArtSpec;
  sold: boolean;
}

export interface RunSnapshot {
  seed: number;
  ante: number;
  money: number;
  jokers: JokerInstance[];
  jokerSlots: number;
  deckSize: number;
  handSize: number;
  hands: number;
  discards: number;
  round: number;
  status: 'menu' | 'blind_select' | 'playing' | 'scoring' | 'shop' | 'game_over' | 'victory';
}

// ---------------------------------------------------------------------------
// Contexto de resolucion (lo que ve el TriggerEngine)
// ---------------------------------------------------------------------------

/** Contexto efimero de un unico disparo. */
export interface TriggerContext {
  event: TriggerEvent;
  /** Carta que origino el evento, si la hay. */
  card?: CardInstance;
  /** Indice de la carta dentro de la mano jugada. */
  cardIndex?: number;
  /** Cartas que estan siendo puntuadas en esta mano. */
  scoredCards: CardInstance[];
  /** Cartas que quedaron en la mano. */
  heldCards: CardInstance[];
  /** Profundidad actual de la cadena de disparos. */
  depth: number;
  /** Joker que actua como fuente (cuando el disparo viene de un joker). */
  sourceJoker?: JokerInstance;
  /** Valor numerico de referencia para acciones que operan "por carta". */
  statusValue?: number;
}

/** Resultado de evaluar una condicion. */
export type ConditionEvaluator = (cond: Condition, ctx: ConditionContext) => boolean;

export interface ConditionContext {
  engine: unknown; // se estrecha en conditions.ts para evitar imports circulares
  ctx: TriggerContext;
  subject: CardInstance | undefined;
}
