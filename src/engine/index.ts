/**
 * index.ts — API publica del motor logico.
 *
 * REGLA: nada fuera de `src/engine/**` deberia importar archivos internos del
 * motor. Todo pasa por este barrel. Asi se puede refactorizar la estructura
 * interna sin tocar el render ni la UI.
 */

export * from './types';
export * from './constants';
export { bus, Emitter } from './events';
export type { GameEventMap, GameEventName, Listener, Unsubscribe } from './events';
export { RNG, hashString } from './rng';
export { ResolutionContext, describeResolution } from './resolution';
export type { ResolutionInit } from './resolution';
export { CardRegistry, RARITY_WEIGHT, RARITY_ORDER } from './cards/CardRegistry';
export type { ContentBundle, ValidationIssue } from './cards/CardRegistry';
export { Deck } from './cards/Deck';
export { TriggerEngine } from './triggers/TriggerEngine';
export { applyAction, supportedActions } from './triggers/actions';
export { evaluateCondition, evaluateAll } from './triggers/conditions';
export type { ConditionWorld } from './triggers/conditions';
export { ScoreCalculator, breakdownOf } from './scoring/ScoreCalculator';
export type { ResolveHandOptions } from './scoring/ScoreCalculator';
export { detectCombos, handComposition } from './scoring/combos';
export type { ComboResult } from './scoring/combos';
export { createRunState, rerollCost, jokerSellValue } from './state/RunState';
export type { RunState, ShopState, GameStatus } from './state/RunState';
export { createRoundState, selectedCards, isSelected, MAX_PLAY_SIZE } from './state/RoundState';
export type { RoundState } from './state/RoundState';
export { GameEngine, SAVE_VERSION } from './GameEngine';
export type { GameEngineOptions, GlobalTriggerEvent, RunSaveData, SerializedCard } from './GameEngine';
