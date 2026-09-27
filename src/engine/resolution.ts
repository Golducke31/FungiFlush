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
import type { CardInstance, ScoreStep } from './types';

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
  drawRequests = 0;
  readonly destroyed: CardInstance[] = [];
  readonly createdIds: string[] = [];
  readonly statusRequests: Array<{ uid: string; status: string; value: number; turns: number }> = [];
  /**
   * Mejoras pedidas por efectos (LEVEL_UP_CARD).
   *
   * Es una MUTACION DIFERIDA, no un cambio inmediato. Antes esta accion mutaba
   * la instancia en el acto, y como el HUD llama a `previewSelection()` (que
   * corre en dryRun) en cada cambio de estado, una carta con LEVEL_UP_CARD se
   * subia de nivel sola con solo pasar el mouse por encima.
   */
  readonly levelUps: Array<{ uid: string; levels: number; sourceId: string }> = [];

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
    return this.substrateFromCards + this.substrateFromEffects;
  }

  get spores(): number {
    return (1 + this.sporesFromCards + this.sporesFromEffects) * this.sporesMultiplier;
  }

  get total(): number {
    return Math.round(this.substrate * this.spores);
  }

  /** Suma Substrate plano y registra el paso. */
  addSubstrate(value: number, sourceId: string, sourceNameKey: string, depth: number, targetUid?: string): void {
    this.substrateFromEffects += value;
    this.pushStep('ADD_SUBSTRATE', value, sourceId, sourceNameKey, depth, targetUid);
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
