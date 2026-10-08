/**
 * resolution.ts — Acumulador de una resolucion.
 *
 * Esta clase es la pieza que hace que el motor sea testeable.
 * Las acciones del JSON NO mutan el estado global: escriben aqui.
 * GameEngine aplica este acumulador al estado real cuando la resolucion
 * termina. Ventajas:
 *   - Una mano se puede resolver 10.000 veces en la consola sin side effects.
 *   - El score se puede previsualizar sin jugar la carta.
 *   - Todo lo que paso queda registrado en `steps` para la UI.
 */

import { MAX_TRIGGERS_PER_RESOLUTION } from './constants';
import type { ComboResult } from './scoring/combos';
import type { CardInstance, ScoreStep, StatusEvent, StatusType } from './types';

export interface ResolutionInit {
  scoredCards?: CardInstance[];
  heldCards?: CardInstance[];
  hand?: CardInstance[];
  money?: number;
  jokerCount?: number;
  isFirstPlayOfRound?: boolean;
  cardsPlayedThisRound?: number;
  cardsDiscardedThisRound?: number;
}

export class ResolutionContext {
  // --- Cartas involucradas ---
  scoredCards: CardInstance[];
  heldCards: CardInstance[];
  hand: CardInstance[];

  // --- Puntuacion desglosada ---
  substrateFromCards = 0;
  substrateFromEffects = 0;
  /**
   * Penalizacion acumulada de putrefaccion (siempre ≥ 0). Se resta del Sustrato
   * con TOPE contra el aporte de las cartas, para que no pueda llevar la mano a
   * 0. Ver el getter `substrate`.
   */
  decayedSubstrate = 0;
  sporesFromCards = 0;
  sporesFromEffects = 0;
  sporesMultiplier = 1;

  // --- Registro de pasos (alimenta particulas y tooltips) ---
  readonly steps: ScoreStep[] = [];
  /** Combos de mano detectados (elemento / familia / diversidad). */
  readonly combos: ComboResult[] = [];

  // --- Estado externo proyectado (para condiciones) ---
  money: number;
  jokerCount: number;
  isFirstPlayOfRound: boolean;
  cardsPlayedThisRound: number;
  cardsDiscardedThisRound: number;

  // --- Control anti-bucle ---
  budget = MAX_TRIGGERS_PER_RESOLUTION;
  /** Claves `${sourceUid}:${effectId}` consumidas dentro de la ronda actual. */
  readonly consumedPerRound = new Set<string>();
  /** Claves consumidas para el resto de la partida. */
  readonly consumedPerRun = new Set<string>();
  readonly overflowEvents: string[] = [];
  /** Si es true, la resolucion no deja rastro (previsualizacion de score). */
  dryRun = false;

  // --- Efectos diferidos que GameEngine debe aplicar al cerrar ---
  moneyDelta = 0;
  handSizeDelta = 0;
  handsDelta = 0;
  discardsDelta = 0;
  jokerSlotsDelta = 0;
  /**
   * Delta ACUMULABLE del coste de purgar (PURGE_COST_DELTA). Se aplica al cerrar
   * la resolucion, como el resto de los deltas de run, para que un dryRun no
   * toque el coste real.
   */
  purgeCostDelta = 0;
  drawRequests = 0;
  readonly destroyed: CardInstance[] = [];
  readonly createdIds: string[] = [];
  /**
   * Estados de carta aplicados / cosechados en esta resolucion (P2.6).
   *
   * Antes esto se llamaba `statusRequests` y NADIE lo leia: era dato muerto. Ahora
   * GameEngine lo emite como `status:applied` / `status:consumed` para que el
   * render anime el momento en vez de solo repintar el chip.
   */
  readonly statusEvents: StatusEvent[] = [];
  /**
   * Mejoras pedidas por efectos (LEVEL_UP_CARD).
   *
   * Es una MUTACION DIFERIDA, no un cambio inmediato. Antes esta accion mutaba
   * la instancia en el acto, y como el HUD llama a `previewSelection()` (que
   * corre en dryRun) en cada cambio de estado, una carta con LEVEL_UP_CARD se
   * subia de nivel sola con solo pasar el mouse por encima.
   */
  readonly levelUps: Array<{ uid: string; levels: number; sourceId: string }> = [];
  /**
   * Estados pedidos por efectos (APPLY_STATUS) — MUTACION DIFERIDA.
   *
   * Mismo motivo que `levelUps`: el HUD llama a `previewSelection()` (dryRun) en
   * CADA cambio de seleccion, asi que aplicar el estado en el acto dejaba la
   * putrefaccion puesta con solo seleccionar una carta, y como el estado es
   * PERMANENTE (`turns: -1`) y `decayStatuses()` no recorre la mano, se acumulaba
   * sin remedio hasta hundir el Suatrato a 0. Ahora se ACUMULA aca y GameEngine
   * la aplica al cerrar la resolucion SOLO si `!dryRun`.
   */
  readonly statusRequests: Array<{
    uid: string;
    status: StatusType;
    value: number;
    turns: number;
    sourceId: string;
  }> = [];

  constructor(init: ResolutionInit = {}) {
    this.scoredCards = init.scoredCards ?? [];
    this.heldCards = init.heldCards ?? [];
    this.hand = init.hand ?? [];
    this.money = init.money ?? 0;
    this.jokerCount = init.jokerCount ?? 0;
    this.isFirstPlayOfRound = init.isFirstPlayOfRound ?? false;
    this.cardsPlayedThisRound = init.cardsPlayedThisRound ?? 0;
    this.cardsDiscardedThisRound = init.cardsDiscardedThisRound ?? 0;
  }

  // --- Valores derivados ----------------------------------------------------

  get substrate(): number {
    // La putrefaccion (decay) se resta APARTE y con TOPE: nunca puede hundir el
    // Sustrato por debajo de 0, ni restar mas de lo que las CARTAS aportan. Sin
    // este tope, una carta con putrefaccion acumulada restaba por cada disparo
    // hasta que `substrate ≤ 0` y la mano entera puntuaba 0 — una derrota que el
    // jugador no podia leer en ningun lado. Ahora una carta podrida aporta 0 como
    // mucho, pero el RESTO de la mano sigue puntuando.
    const raw = this.substrateFromCards + this.substrateFromEffects;
    const cardBase = Math.max(0, this.substrateFromCards);
    const penalty = Math.min(this.decayedSubstrate, cardBase);
    return Math.max(0, raw - penalty);
  }

  get spores(): number {
    return (1 + this.sporesFromCards + this.sporesFromEffects) * this.sporesMultiplier;
  }

  get total(): number {
    // SUELO DE CERO. El desglose (substrate/spores) SI puede quedar en negativo:
    // la podredumbre resta Substrato por cada disparo (TriggerEngine) y el
    // impuesto de la Reina Esporada tambien. Pero el score JUGABLE nunca puede
    // ser negativo: sin este `Math.max`, una mano podrida o el impuesto del jefe
    // producian "Score: -24", un estado matematicamente invalido que ademas se
    // propagaba a `round.score` (GameEngine lo acumula con `+=`) y a la barra.
    return Math.max(0, Math.round(this.substrate * this.spores));
  }

  /** Suma Substrate plano y registra el paso. */
  addSubstrate(value: number, sourceId: string, sourceNameKey: string, depth: number, targetUid?: string): void {
    this.substrateFromEffects += value;
    this.pushStep('ADD_SUBSTRATE', value, sourceId, sourceNameKey, depth, targetUid);
  }

  /**
   * Registra una PENALIZACION de putrefaccion (no un Substrato negativo suelto).
   *
   * Va por su propio carril para poder topearla contra el aporte de las cartas
   * (ver `substrate`): asi puntuar 0 por pudricion deja de ser posible, pero el
   * jugador SI ve la penalizacion en el desglose con su valor real.
   */
  addDecaySubstrate(value: number, sourceId: string, sourceNameKey: string, depth: number, targetUid?: string): void {
    this.decayedSubstrate += value;
    this.pushStep('ADD_SUBSTRATE', -value, sourceId, sourceNameKey, depth, targetUid);
  }

  /** Multiplica Substrate (poco comun, reservado a legendarios). */
  multiplySubstrate(value: number, sourceId: string, sourceNameKey: string, depth: number): void {
    this.substrateFromCards *= value;
    this.substrateFromEffects *= value;
    this.pushStep('MULTIPLY_SUBSTRATE', value, sourceId, sourceNameKey, depth);
  }

  /** Suma Spores (multiplicador aditivo). */
  addSpores(value: number, sourceId: string, sourceNameKey: string, depth: number, targetUid?: string): void {
    this.sporesFromEffects += value;
    this.pushStep('ADD_SPORES', value, sourceId, sourceNameKey, depth, targetUid);
  }

  /** Multiplica Spores (el efecto mas potente del juego). */
  multiplySpores(value: number, sourceId: string, sourceNameKey: string, depth: number, targetUid?: string): void {
    this.sporesMultiplier *= value;
    this.pushStep('MULTIPLY_SPORES', value, sourceId, sourceNameKey, depth, targetUid);
  }

  /** Fija Spores a un valor absoluto. */
  setSpores(value: number, sourceId: string, sourceNameKey: string, depth: number): void {
    const current = this.spores;
    if (current > 0) {
      this.sporesMultiplier *= value / current;
    } else {
      this.sporesFromEffects += value;
    }
    this.pushStep('SET_SPORES', value, sourceId, sourceNameKey, depth);
  }

  /**
   * Registra un paso desde una accion que no es una suma de score
   * (por ejemplo LEVEL_UP_CARD). El render lo usa para animar la secuencia.
   */
  recordStep(
    action: ScoreStep['action'],
    value: number,
    sourceId: string,
    sourceNameKey: string,
    depth: number,
    targetUid?: string,
  ): void {
    this.pushStep(action, value, sourceId, sourceNameKey, depth, targetUid);
  }

  private pushStep(
    action: ScoreStep['action'],
    value: number,
    sourceId: string,
    sourceNameKey: string,
    depth: number,
    targetUid?: string,
  ): void {
    this.steps.push({
      sourceId,
      sourceNameKey,
      action,
      value,
      substrateAfter: this.substrate,
      sporesAfter: this.spores,
      depth,
      ...(targetUid !== undefined ? { targetUid } : {}),
    });
  }

  // --- Consumo de efectos "once" --------------------------------------------

  keyOf(sourceUid: string, effectId: string | undefined, index: number): string {
    return `${sourceUid}:${effectId ?? `#${index}`}`;
  }

  isConsumed(key: string): boolean {
    return this.consumedPerRound.has(key) || this.consumedPerRun.has(key);
  }

  consume(key: string, rule: 'per_round' | 'per_run'): void {
    if (rule === 'per_round') this.consumedPerRound.add(key);
    else this.consumedPerRun.add(key);
  }

  /** Precarga el estado de consumo persistido (ronda + partida). */
  seedConsumed(perRound: Iterable<string>, perRun: Iterable<string>): void {
    for (const k of perRound) this.consumedPerRound.add(k);
    for (const k of perRun) this.consumedPerRun.add(k);
  }

  // --- Presupuesto ----------------------------------------------------------

  spend(): boolean {
    if (this.budget <= 0) return false;
    this.budget -= 1;
    return true;
  }
}

/** Proyeccion de solo lectura para el log de depuracion. */
export function describeResolution(res: ResolutionContext): string {
  return `substrate=${res.substrate} spores=${res.spores.toFixed(2)} total=${res.total} pasos=${res.steps.length} presupuesto=${res.budget}`;
}
