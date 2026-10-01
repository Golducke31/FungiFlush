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

/**
 * Escalafon del ciego. Es una etiqueta de CONTENIDO, no una derivacion: se
 * declara para que la pantalla pueda agrupar y jerarquizar sin adivinar.
 *
 * No se infiere de `scoreMultiplier` ni de `effects.length` por dos razones:
 * (1) un jefe futuro podria no traer efectos y seguir siendo jefe, y (2) el
 * orden de la grilla depende de esto — adivinar por multiplicador dejaria dos
 * ciegos empatados sin criterio. `effects.length` sobrevive como respaldo para
 * contenido viejo o de terceros que no declare `tier`.
 */
export type BlindTier = 'small' | 'big' | 'boss';

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
  /**
   * Escalafon del ciego. Si falta, la UI cae a `effects.length > 0 → boss`
   * (la convencion vieja). Ver `blindTier()` en la UI.
   */
  tier?: BlindTier;
  /**
   * Clave de ilustracion propia del ciego, sin prefijo. Se resuelve a
   * `art_blind_<art>.webp` (`ArtAssets.blindKeysFor`).
   *
   * La clave se declara y NO se deriva de `id` a proposito: el id es una clave
   * de contenido que puede cambiar de nombre, y el archivo de arte es un
   * contrato de disco. Separándolos, renombrar un ciego no rompe su imagen.
   *
   * Sin `art` (o sin el archivo generado) la tarjeta se queda sin ilustracion y
   * el respaldo es el MATERIAL de la tarjeta, no un dibujo procedural: a
   * diferencia de las cartas, aca no hay silueta que dibujar.
   */
  art?: string;
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
  /** Veces que se jugo. Alimenta las evoluciones por uso (Fase 3). */
  plays?: number;
  /** Id del especimen del que evoluciono (linaje, para la Coleccion). */
  evolvedFrom?: string | null;
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

/**
 * Resultado de la tirada del dado multiplicador (una por blind).
 *
 * Es una mecanica de RUN, no un efecto: por eso no pasa por el TriggerEngine.
 * El multiplicador entra al final del puntaje y `hands`/`discards` se cobran al
 * arrancar la ronda.
 */
export interface DieRoll {
  /** Cara 1..6. Es lo que se dibuja en el dado. */
  face: number;
  /** Multiplicador que se aplica al total de la mano. */
  multiplier: number;
  /** Manos extra de la ronda (negativo = cuesta una). */
  hands: number;
  /** Descartes extra de la ronda (negativo = cuesta uno). */
  discards: number;
}

/**
 * MODIFICADORES DE RUN (vouchers).
 *
 * Son el tercer eje de mejora, despues de cartas y jokers, y el unico que
 * funciona SIN ocupar espacio: un voucher no entra al mazo ni ocupa un slot de
 * joker, cambia una REGLA de la partida para siempre.
 *
 * DOS MITADES, Y POR QUE NO PUEDEN SER UNA SOLA
 * ---------------------------------------------
 *   - `effects` es lo que ya sabe hacer el motor: mismos triggers y mismas
 *     acciones que un joker (`ADD_HANDS`, `GAIN_MONEY`...). Se aplica UNA vez,
 *     al comprar, con `applyImmediateEffects`.
 *   - `runModifiers` es lo que NO es un evento: "los rerolls cuestan 2 menos"
 *     no ocurre en ningun momento, es un cambio permanente en como se CALCULA
 *     algo. Meterlo como efecto obligaria a un trigger por cada consulta.
 *
 * Si todo se pudiera hacer con `effects`, `runModifiers` no existiria. Existe
 * porque hay reglas que no son sucesos.
 */
export interface VoucherRunModifiers {
  /** Suma al coste de cada reroll (negativo = mas barato). Se clampea a >= 0. */
  rerollCostDelta?: number;
  /**
   * Multiplicador aplicado al OBJETIVO de cada ciego (0.9 = 10% menos).
   * Se clampea para que un voucher no pueda volver el juego trivial ni
   * imposible.
   */
  targetMultiplier?: number;
  /** Descuento en la tienda, en tanto por uno (0.2 = 20% menos). */
  shopDiscount?: number;
  /**
   * RESERVADOS. Estos campos son para vouchers PERMANENTES (a nivel de perfil,
   * no de run): "empeza cada partida con una mano extra". Un voucher comprado
   * en la tienda no puede aplicarlos, porque la run ya empezo.
   *
   * Estan declarados para que el tipo no cambie cuando llegue la ascension
   * (R1), pero HOY el motor no los lee: no hay vouchers permanentes en el
   * contenido. Un voucher que los declare en `vouchers.json` no hace nada.
   */
  extraJokerSlots?: number;
  extraHands?: number;
  extraDiscards?: number;
  extraHandSize?: number;
  extraMoney?: number;
}

export interface VoucherDefinition {
  id: string;
  nameKey: string;
  descKey: string;
  cost: number;
  art: ArtSpec;
  /** Efectos aplicados UNA vez al comprar. Mismos triggers/acciones que un joker. */
  effects?: EffectDefinition[];
  /** Cambios permanentes en como se CALCULA la run. Ver `VoucherRunModifiers`. */
  runModifiers?: VoucherRunModifiers;
  /**
   * Se puede comprar mas de una vez. Default `false`: repetir una regla no
   * suele tener sentido, y ofrecerlo confunde.
   */
  repeatable?: boolean;
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
  /** Rareza del contenido ofertado. La UI la usa para el color sin tener que
   *  resolver la definicion de nuevo. */
  rarity?: Rarity;
  /** Pack que aporta este contenido (para mostrar el origen / DLC). */
  packId?: string;
  /** Contenido de un DLC que el jugador no tiene: se muestra, no se compra. */
  locked?: boolean;
}

// ---------------------------------------------------------------------------
// Tablas de oferta (tienda, recompensas, drafts)
// ---------------------------------------------------------------------------
//
// Antes, la tienda estaba HARDCODEADA en GameEngine.rollOffers(): una carta
// fija + 50% segunda carta o joker + una mutacion. Eso bloqueaba cualquier
// sistema de recompensas y obligaba a tocar el motor para cada cambio de
// balance. Ahora el balance de la tienda y de los drafts es contenido.

export type OfferPhase = 'shop' | 'reward' | 'draft' | 'booster';

export type OfferKind = 'card' | 'joker' | 'mutation' | 'voucher' | 'money';

/** Una alternativa dentro de un grupo: se elige por peso. */
export interface OfferOption {
  weight: number;
  kind: OfferKind;
  /** Id fijo (vouchers). Si falta, se sortea del pool del tipo. */
  refId?: string;
  /** Restringe el sorteo a un pack concreto. */
  packId?: string;
  /** Solo `kind: 'money'`. */
  amount?: number;
  /** Pesos por rareza. Pisa los pesos globales del registro. */
  rarityWeights?: Partial<Record<Rarity, number>>;
  /** Restringe el sorteo a cartas/jokers con este tag. */
  tag?: string;
  /**
   * Excluye del sorteo lo que tenga este tag. Es lo que mantiene a las cartas
   * evolucionadas fuera de la tienda y de los drafts: solo se obtienen
   * evolucionando, nunca comprandolas.
   */
  excludeTag?: string;
  minAnte?: number;
  maxAnte?: number;
}

/**
 * Un grupo produce `count` ofertas. `chance` (default 1) permite que un grupo
 * aparezca solo a veces. Los grupos se evaluan EN ORDEN: el consumo del RNG es
 * determinista, asi que una partida guardada sigue siendo reproducible.
 */
export interface OfferGroup {
  count: number;
  chance?: number;
  options: OfferOption[];
}

export interface OfferTable {
  id: string;
  phase: OfferPhase;
  groups: OfferGroup[];
  /** Cuantas ofertas puede tomar el jugador (drafts). Default: todas. */
  pick?: number;
  allowSkip?: boolean;
  allowDuplicates?: boolean;
  /**
   * Ventana de antes en la que aplica la tabla. Una fase puede tener VARIAS
   * tablas y `rollPhase` elige la de ventana mas especifica que contenga el
   * ante actual. Sirve para que la tienda de la Fase 1 no ofrezca lo mismo que
   * la del ante 7. Sin `minAnte`/`maxAnte`, la tabla aplica en cualquier ante.
   */
  minAnte?: number;
  maxAnte?: number;
}

// ---------------------------------------------------------------------------
// Mejoras (cultivo ilimitado)
// ---------------------------------------------------------------------------
//
// El coste crece geometricamente, asi que "ilimitado" no significa gratis:
// significa que nunca hay un techo duro que corte la fantasia de escalar una
// carta. La curva vive en `upgrades.json`.

export interface UpgradeTrack {
  id: string;
  /** Coste del nivel 1 -> 2. */
  baseCost: number;
  /** Multiplicador por nivel. 1.5 = +50% cada vez. */
  growth: number;
  /** 0 = sin techo. */
  maxLevel: number;
  substratePerLevel: number;
  sporesPerLevel: number;
  /**
   * Si es true, ademas del valor plano se suma el nivel nuevo
   * (una carta nivel 7 gana 3 + 7 = 10 de Substrate). Es lo que hace que
   * mejorar temprano sea mas rentable que mejorar tarde.
   */
  levelScaling?: boolean;
  /** Ajuste de coste por rareza. Default 1. */
  rarityCostMultiplier?: Partial<Record<Rarity, number>>;
  /** Solo se aplica a estas rarezas. Vacio = todas. */
  rarities?: Rarity[];
  /** Solo se aplica a cartas con alguno de estos tags. Vacio = todas. */
  tags?: string[];
}

// ---------------------------------------------------------------------------
// Cartas evolutivas
// ---------------------------------------------------------------------------
//
// Una evolucion NO es un efecto: es una regla de progresion. Por eso vive en
// su propio archivo (`evolutions.json`) y no dentro de la carta: una expansion
// puede agregarle una evolucion a una carta base sin sobrescribir su
// definicion.

export type EvolutionRequirement =
  | { type: 'level'; value: number }
  | { type: 'plays'; value: number }
  | { type: 'all'; conds: EvolutionRequirement[] }
  | { type: 'any'; conds: EvolutionRequirement[] };

export interface EvolutionRule {
  id: string;
  /** Id de la carta base. */
  from: string;
  /** Id de la carta evolucionada (debe existir en el registro). */
  to: string;
  require: EvolutionRequirement;
  keep?: {
    /** Conservar bonusSubstrate/bonusSpores. Default true. */
    bonuses?: boolean;
    /** Que pasa con el nivel. Default 'carry'. */
    level?: 'carry' | 'reset' | 'minus';
    /** Conservar los statuses negativos. Default true. */
    statuses?: boolean;
    /** Bonus extra al evolucionar. */
    grantSubstrate?: number;
    grantSpores?: number;
  };
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
  status:
    | 'menu'
    | 'blind_select'
    | 'playing'
    | 'scoring'
    | 'reward'
    | 'shop'
    | 'game_over'
    | 'victory';
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
