/**
 * rewardBreakdown.test.ts — Recompensa de Fungis al cerrar un ciego.
 *
 * Regla que estos tests protegen:
 *   - el desglose (`rewardParts`) SUMA exactamente `reward` (si no, el panel
 *     mentiria sobre de donde salio el dinero),
 *   - el bono de una sola mano SOLO aplica cuando el ciego se cerro en la
 *     primera jugada (`round.history.length === 1`),
 *   - ganar en dos manos no da el bono, aunque sobren manos.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { GameEngine } from '../src/engine/GameEngine.ts';
import { ECONOMY } from '../src/engine/constants.ts';
import type { CardDefinition, ContentBundle } from '../src/engine/index.ts';
import { bus } from '../src/engine/events.ts';

interface WinPayload {
  reward: number;
  rewardParts: {
    blind: number;
    base: number;
    unusedHands: number;
    unusedCount: number;
    firstHand: number;
  };
}

function card(id: string, overrides: Partial<CardDefinition> = {}): CardDefinition {
  return {
    id,
    nameKey: `card.${id}.name`,
    descKey: `card.${id}.desc`,
    element: 'neutral',
    family: 'agaricaceae',
    rarity: 'common',
    baseSubstrate: 10,
    baseSpores: 2,
    cost: 3,
    art: { hue: 100, pattern: 'radial' },
    tags: ['starter'],
    copies: 10,
    ...overrides,
  };
}

function bundle(target: number): ContentBundle {
  return {
    cards: [card('alpha'), card('beta')],
    jokers: [],
    blinds: [
      { id: 'b1', nameKey: 'blind.b1.name', descKey: 'blind.b1.desc', ante: 1, scoreMultiplier: 1, reward: 5 },
    ],
    anteTargets: { 1: target },
  };
}

/** Captura el payload de `round:win` de una corrida. */
function captureWin(): () => WinPayload | null {
  let captured: WinPayload | null = null;
  const off = bus.on('round:win', (payload) => {
    captured = payload as WinPayload;
  });
  return () => {
    off();
    return captured;
  };
}

test('el desglose suma exactamente la recompensa', () => {
  const engine = new GameEngine({ seed: 3, bundle: bundle(100) });
  engine.startRun(3);
  const read = captureWin();

  engine.chooseBlind('b1');
  const hand = engine.roundSnapshot().hand;
  for (const c of hand.slice(0, 5)) engine.toggleSelect(c.uid);
  engine.playHand();

  const win = read();
  assert.ok(win, 'deberia haber ganado el ciego de una mano');
  const p = win.rewardParts;
  const sum = p.blind + p.base + p.unusedHands + p.firstHand;
  assert.equal(sum, win.reward, 'la suma de las partes tiene que dar el total');
  assert.equal(p.blind, 5, 'el valor del ciego sale de la definicion');
  assert.equal(p.base, ECONOMY.baseBlindReward, 'la base fija es la de economia');
});

test('ganar en UNA sola mano da el bono', () => {
  const engine = new GameEngine({ seed: 4, bundle: bundle(100) });
  engine.startRun(4);
  const read = captureWin();

  engine.chooseBlind('b1');
  const hand = engine.roundSnapshot().hand;
  for (const c of hand.slice(0, 5)) engine.toggleSelect(c.uid);
  engine.playHand();

  const win = read();
  assert.ok(win);
  assert.equal(win.rewardParts.firstHand, ECONOMY.firstHandBonus, 'deberia acreditar el bono');
  // 4 manos base ⇒ quedaron 3 ⇒ 3 monedas por manos sin usar.
  const hands = engine.runSnapshot().hands;
  assert.equal(win.rewardParts.unusedCount, hands - 1);
  assert.equal(win.rewardParts.unusedHands, (hands - 1) * ECONOMY.moneyPerUnusedHand);
});

test('ganar en DOS manos NO da el bono de una sola mano', () => {
  // Objetivo que la primera mano floja no alcanza pero la segunda sí: se juegan
  // UNA carta por mano para no pasarse en la primera.
  const engine = new GameEngine({ seed: 6, bundle: bundle(100) });
  engine.startRun(6);
  const read = captureWin();

  engine.chooseBlind('b1');
  // Mano 1: una sola carta (10 × 2 = 20 < 100) ⇒ no cierra.
  const h1 = engine.roundSnapshot().hand.slice(0, 1);
  for (const c of h1) engine.toggleSelect(c.uid);
  engine.playHand();
  assert.equal(engine.runSnapshot().status, 'playing', 'la primera mano no cierra el ciego');

  // Mano 2: 5 cartas ⇒ cierra.
  const h2 = engine.roundSnapshot().hand.slice(0, 5);
  for (const c of h2) engine.toggleSelect(c.uid);
  engine.playHand();

  const win = read();
  assert.ok(win, 'la segunda mano deberia cerrar el ciego');
  assert.equal(win.rewardParts.firstHand, 0, 'dos manos ⇒ sin bono');
  assert.ok(win.rewardParts.unusedCount < engine.runSnapshot().hands, 'se usaron manos');
});
