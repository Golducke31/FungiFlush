/**
 * RunState.ts — Estado persistente de una partida (una "run").
 * Es lo unico que hace falta serializar para guardar la partida: el mazo, los
 * jokers, el dinero, el ante y el estado de efectos consumidos.
 */

import type { Deck } from '../cards/Deck';
import { ECONOMY, RUN_DEFAULTS } from '../constants';
import {
  DEFAULT_INTERLUDE_MODIFIERS,
  type InterludeModifiers,
} from '../interlude/interlude';
import type {
  AscensionModifiers,
  DieRoll,
  JokerInstance,
  ShopOffer,
  VoucherRunModifiers,
} from '../types';

export type GameStatus =
  | 'menu'
  | 'blind_select'
  | 'playing'
  | 'scoring'
  /** Draft de recompensa al ganar un blind, antes de la tienda. */
  | 'reward'
  /** Evento entre Ciegos: el jugador elige aceptar un trato o seguir (P2.4). */
  | 'interlude'
  /**
   * R3 — Borrador de reglas abierto: el jugador esta eligiendo su bendicion
   * (al arrancar) o su maldicion (cada 3 antes). No se puede jugar hasta
   * elegir: la run se juega con ESA regla.
   */
  | 'draft'
  | 'shop'
  | 'game_over'
  | 'victory'
  /** Se gano el ultimo ante: oferta de terminar o seguir en modo infinito. */
  | 'victory_offer';

export interface ShopState {
  offers: ShopOffer[];
  rerolls: number;
}

export interface RunState {
  seed: number;
  /** Ante actual (1..8). */
  ante: number;
  /**
   * Posicion dentro de la ruta de ciegos del ante (0, 1, 2). Los 3 se juegan
   * EN ORDEN y no se eligen: 0 es el primero, 1 el segundo y 2 el jefe. Al
   * limpiar el ante vuelve a 0.
   */
  blindIndex: number;
  /**
   * Ruta de ciegos SORTEADA del ante en curso: los ids en el orden en que se
   * juegan ([small, big, boss]).
   *
   * El contenido declara VARIANTES por tier (p.ej. `blind_a3_small` y
   * `blind_a3_small_v`): sortear cual toca es lo que hace que dos runs con
   * distinta semilla vean ciegos distintos. Se sortea UNA vez al entrar al ante
   * (`startRun` / `advanceAnte`) con un RNG dedicado derivado de la semilla de
   * la run: misma semilla ⇒ misma ruta, y la pantalla de seleccion muestra el
   * ciego que REALMENTE se va a jugar (una sola fuente). Viaja serializado
   * (aditivo) para que una partida retomada no cambie de ruta.
   *
   * Vacio = todavia no se sorteo (run recien creada o guardado previo a R2):
   * `availableBlinds()` lo resuelve al leer.
   */
  blindRoute: string[];
  money: number;
  jokers: JokerInstance[];
  jokerSlots: number;
  /** Valores base del ante; los efectos los modifican durante la run. */
  baseHandSize: number;
  baseHands: number;
  baseDiscards: number;
  deck: Deck;
  /**
   * Tirada del dado multiplicador del blind en curso. `null` en el menu y en
   * los estados que no son una ronda. Se tira al ELEGIR el ciego.
   */
  die: DieRoll | null;
  /** Cuantas veces se volvio a tirar el dado en el ciego actual (sube el coste). */
  dieRerolls: number;
  status: GameStatus;
  /** Efectos "once: per_run" ya consumidos. */
  consumedEffects: Set<string>;
  /**
   * Vouchers comprados en esta run (ids). Son MODIFICADORES, no contenido: no
   * ocupan slot ni entran al mazo. Se serializan con el guardado porque una run
   * retomada tiene que seguir con las mismas reglas.
   */
  vouchers: string[];
  /**
   * Nivel de ascension elegido ANTES de empezar. 0 = juego base.
   *
   * Se guarda en la run (y se serializa) porque los modificadores NO se aplican
   * una vez: se leen en cada consulta (objetivo, costes). Una run retomada con
   * `ascension: 0` tendria otro objetivo que la que el jugador empezo.
   */
  ascension: number;
  /**
   * Delta acumulado del coste de purgar (PURGE_COST_DELTA).
   *
   * Vive en la run (no en el perfil) porque lo mueven los efectos del contenido
   * y tiene que sobrevivir a un guardado: una run retomada sigue con el mismo
   * coste de purga que tenia. Ver `GameEngine.purgeCost`.
   */
  purgeCostBonus: number;
  /**
   * Purgas usadas en el ANTE actual.
   *
   * Se resetea a 0 al entrar a un ante nuevo (mismo punto donde sube `ante`).
   * Vive en la run para que una partida retomada no regale purgas extra.
   * El tope por ante es `ECONOMY.purgesPerAnte`.
   */
  purgesThisAnte: number;
  /**
   * Cargas disponibles de la habilidad FungiFlush.
   *
   * La habilidad es INSIGNIA de la run (no un joker): vive aca para que una
   * partida retomada siga con las mismas cargas. Arranca en 1, solo se puede
   * disparar al llegar a `FUNGI_FLUSH_MAX_CHARGES` (3) y **una vez por ciego**;
   * al usarla vuelve a 1 (ver `GameEngine.useFungiFlush`).
   */
  fungiFlushCharge: number;
  /**
   * La habilidad fue activada y armo la PROXIMA mano: `playHand` multiplica las
   * Esporas por `FUNGI_FLUSH_SPORE_MULT` y limpia el flag. Separado de la carga
   * porque gastar la habilidad y JUGAR la mano son dos momentos distintos.
   */
  fungiFlushArmed: boolean;
  /**
   * La habilidad YA se uso en el ciego actual. El rediseno la limita a **un uso
   * por ciego**: se limpia en `chooseBlind` (nuevo ciego) y pasado a `true` en
   * `useFungiFlush`. Sin este flag, cargar a 3 de nuevo dentro del mismo ciego
   * permitiria dispararla varias veces, que es justo lo que se quiso evitar.
   */
  fungiFlushUsedThisBlind: boolean;
  /**
   * Arquetipo de la run (id; ver `src/data/archetypes.json`).
   *
   * Un arquetipo no cambia las REGLAS del juego: cambia el MAZO INICIAL y las
   * cartas que la tienda favorece. Se guarda en la run porque la tienda lo lee
   * en cada reroll y el resumen/historial lo muestran. Vacio = mazo base.
   */
  archetype: string;
  /**
   * Desafio diario (R1): la semilla salio de la FECHA, no del reloj.
   *
   * No cambia ninguna regla: es una run clasica con semilla derivada del dia
   * (misma para todos los jugadores). Se guarda en la run —y se serializa—
   * porque una run retomada sigue siendo diaria: el resultado tiene que salir
   * con `mode: 'daily'` aunque el jugador cierre el juego a mitad.
   */
  daily: boolean;
  shop: ShopState | null;
  /**
   * Modificadores acumulados por los interludios (P2.4). Se leen en cada
   * consulta del objetivo, igual que los modificadores de vouchers: una run
   * retomada tiene que seguir con el mismo objetivo que tenia.
   */
  interludeModifiers: InterludeModifiers;
  /** Ids de interludios ya vistos en esta run: no se repite el mismo trato. */
  seenInterludes: string[];
  /**
   * R3 — Bendicion elegida en el borrador de arranque (id; ver
   * `src/data/packs/base/blessings.json`). Vacio = ninguna.
   *
   * Es UNA sola porque el borrador de arranque se resuelve una vez: la run
   * entera se juega con la bendicion que se eligio al principio. Se guarda en
   * la run (y se serializa) porque sus modificadores cambian como se calcula
   * el objetivo, el reroll y los precios: una run retomada tiene que seguir
   * con las mismas reglas.
   */
  blessing: string;
  /**
   * R3 — Maldiciones elegidas (ids), ACUMULATIVAS: una cada 3 antes. No cabe
   * en un id suelto porque dos maldiciones vivas tienen que convivir, y sus
   * modificadores se combinan entre si (y con la bendicion y los vouchers) en
   * el mismo `combineModifiers`.
   */
  curses: string[];
  /**
   * R3 — Ante en el que se sorteo la ULTIMA maldicion (0 = ninguna).
   *
   * Existe para que la parada sea "una por ante multiplo de 3" y no "una por
   * cada vez que se pasa por `enterBlindSelect`", que se llama varias veces
   * por ante (al resolver un interludio, al elegir el draft). Viaja serializado
   * para que una run retomada no reciba una maldicion de mas.
   */
  curseDraftAnte: number;
  /**
   * Misiones activas de la run (P2.6). Se guardan como `{id, progress,
   * completed}`: el id apunta al contenido y el progreso es el unico estado
   * mutable. Una run retomada sigue con las mismas misiones a medio hacer.
   */
  missions: Array<{ id: string; progress: number; completed: boolean }>;
  /**
   * Score ACUMULADO de toda la run: la suma del score final de cada ciego
   * superado. Vive en la run (no en el RoundState, que se reemplaza en cada
   * ciego) porque el resumen final tiene que mostrar el TOTAL de la partida,
   * no el ultimo numero suelto. Se suma al SUPERAR el ciego; los ciegos
   * perdidos no aportan.
   */
  totalScore: number;
  /**
   * El tutorial guiado esta activo en esta run (Frente 1).
   *
   * OJO: el motor NO lee este campo para NADA. Es una marca que viaja con la run
   * (y sobrevive a `serialize`/`restore`) para que la capa de UI sepa que tiene
   * que mostrar el guion. Un `if (tutorial)` en el motor seria una segunda
   * version de las reglas, y el tutorial es una run normal con semilla fija.
   */
  tutorial: boolean;
  /**
   * La run sigue MAS ALLA del ultimo ante declarado (modo infinito).
   *
   * Se pone al elegir "seguir jugando" en el panel de victoria. El tope de
   * `registry.maxAnte()` deja de aplicar: los objetivos escalan solos
   * (`anteTarget` extrapola) y los ciegos reutilizan el ultimo ante. Viaja
   * serializado (aditivo) para que una run infinita retomada siga siendolo.
   */
  endless: boolean;
  /** Estadisticas para la pantalla final. */
  stats: {
    handsPlayed: number;
    bestHand: number;
    blindsCleared: number;
    cardsDestroyed: number;
    /** Mejoras aplicadas (Fase 3: cultivo ilimitado). */
    cardsUpgraded: number;
    /** Cartas que evolucionaron a otra especie. */
    cardsEvolved: number;
  };
}

/**
 * Crea el estado inicial de una run.
 *
 * `ascension` se aplica ACA, en un solo lugar, y no repartido por el motor: los
 * deltas que definen la run (manos, descartes, tamano de mano, slots, dinero)
 * se fijan al nacer y despues los efectos los mueven. Si cada punto de uso
 * leyera la ascension, bastaria olvidarse de uno para que A5 fuera mas facil
 * que A4 sin que nadie lo note.
 *
 * `tutorial` NO es una regla: es la marca que usa la UI para saber que tiene
 * que guiar. Se recibe aca (y no se pone despues desde fuera) porque el
 * tutorial TAMBIEN suprimir el borrador de bendiciones: un guion de 25 pasos
 * no puede arrancar con un panel de por medio.
 */
export function createRunState(
  seed: number,
  deck: Deck,
  ascension = 0,
  archetype = '',
  daily = false,
  tutorial = false,
): RunState {
  const mods = ascensionModifiersFor(ascension);
  return {
    seed,
    ante: RUN_DEFAULTS.ante,
    blindIndex: 0,
    blindRoute: [],
    // `moneyDelta` es un OVERRIDE del dinero inicial, no un delta: el numero se
    // escribe entero en el JSON y asi el balance de un nivel se lee de una.
    money: mods.moneyDelta ?? RUN_DEFAULTS.money,
    jokers: [],
    jokerSlots: Math.max(0, RUN_DEFAULTS.jokerSlots + (mods.jokerSlots ?? 0)),
    baseHandSize: Math.max(1, RUN_DEFAULTS.handSize + (mods.baseHandSize ?? 0)),
    baseHands: Math.max(1, RUN_DEFAULTS.hands + (mods.baseHands ?? 0)),
    baseDiscards: Math.max(0, RUN_DEFAULTS.discards + (mods.baseDiscards ?? 0)),
    deck,
    die: null,
    dieRerolls: 0,
    status: 'blind_select',
    consumedEffects: new Set<string>(),
    vouchers: [],
    ascension,
    purgeCostBonus: 0,
    purgesThisAnte: 0,
    fungiFlushCharge: RUN_DEFAULTS.fungiFlushCharges,
    fungiFlushArmed: false,
    fungiFlushUsedThisBlind: false,
    archetype,
    daily,
    shop: null,
    interludeModifiers: { ...DEFAULT_INTERLUDE_MODIFIERS },
    seenInterludes: [],
    blessing: '',
    curses: [],
    curseDraftAnte: 0,
    missions: [],
    totalScore: 0,
    tutorial,
    endless: false,
    stats: {
      handsPlayed: 0,
      bestHand: 0,
      blindsCleared: 0,
      cardsDestroyed: 0,
      cardsUpgraded: 0,
      cardsEvolved: 0,
    },
  };
}

/**
 * Modificadores de un nivel de ascension.
 *
 * El motor NO conoce el contenido (la tabla vive en el pack), asi que el nivel
 * se resuelve por una funcion INYECTADA. Sin esto, `createRunState` tendria que
 * importar el registry y el estado dejaria de ser una funcion pura.
 */
let ascensionResolver: (level: number) => AscensionModifiers = () => ({});

export function setAscensionResolver(fn: (level: number) => AscensionModifiers): void {
  ascensionResolver = fn;
}

function ascensionModifiersFor(level: number): AscensionModifiers {
  return ascensionResolver(level);
}

/** Coste del proximo reroll en tienda (escala con el uso). */
export function rerollCost(shop: ShopState, modifiers?: VoucherRunModifiers): number {
  const delta = modifiers?.rerollCostDelta ?? 0;
  return Math.max(0, ECONOMY.rerollBaseCost + shop.rerolls * ECONOMY.rerollCostStep + delta);
}

/**
 * Suma los modificadores de un conjunto de vouchers.
 *
 * Se suman en vez de "gana el ultimo" para que dos vouchers que tocan lo mismo
 * compongan: dos descuentos de reroll son un descuento doble, no una moneda al
 * aire. Los multiplicadores SI se multiplican entre ellos, porque "10% menos" y
 * "10% menos" tiene que dar 19%, no 20%.
 */
export function combineModifiers(
  defs: readonly { runModifiers?: VoucherRunModifiers }[],
): VoucherRunModifiers {
  const out: VoucherRunModifiers = {
    rerollCostDelta: 0,
    targetMultiplier: 1,
    extraJokerSlots: 0,
    extraHands: 0,
    extraDiscards: 0,
    extraHandSize: 0,
    extraMoney: 0,
    shopDiscount: 0,
  };

  for (const def of defs) {
    const m = def.runModifiers;
    if (!m) continue;
    out.rerollCostDelta = (out.rerollCostDelta ?? 0) + (m.rerollCostDelta ?? 0);
    out.targetMultiplier = (out.targetMultiplier ?? 1) * (m.targetMultiplier ?? 1);
    out.extraJokerSlots = (out.extraJokerSlots ?? 0) + (m.extraJokerSlots ?? 0);
    out.extraHands = (out.extraHands ?? 0) + (m.extraHands ?? 0);
    out.extraDiscards = (out.extraDiscards ?? 0) + (m.extraDiscards ?? 0);
    out.extraHandSize = (out.extraHandSize ?? 0) + (m.extraHandSize ?? 0);
    out.extraMoney = (out.extraMoney ?? 0) + (m.extraMoney ?? 0);
    // Los descuentos se combinan como "lo que queda por pagar": dos del 20%
    // dejan pagando el 64%, no el 60%.
    out.shopDiscount = 1 - (1 - (out.shopDiscount ?? 0)) * (1 - (m.shopDiscount ?? 0));
  }

  // Clampeo: un voucher no puede volver el juego imposible (objetivo 0) ni
  // gratis (multiplicador 0 o negativo).
  out.targetMultiplier = Math.min(2, Math.max(0.25, out.targetMultiplier ?? 1));
  out.shopDiscount = Math.min(0.9, Math.max(0, out.shopDiscount ?? 0));
  return out;
}

/** Precio final de una oferta tras los descuentos de vouchers. */
export function discountedCost(cost: number, modifiers?: VoucherRunModifiers): number {
  const discount = modifiers?.shopDiscount ?? 0;
  if (discount <= 0) return cost;
  return Math.max(0, Math.round(cost * (1 - discount)));
}

export function jokerSellValue(joker: JokerInstance): number {
  return Math.max(1, Math.floor(joker.def.sellValue || joker.def.cost * ECONOMY.jokerSellRatio));
}
