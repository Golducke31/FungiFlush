/**
 * Deck.ts — Pila de robo + pila de descartes.
 * Cuando el mazo de robo se agota, se recicla el descarte automaticamente.
 */

import type { CardInstance } from '../types';
import type { RNG } from '../rng';

export type InsertPosition = 'top' | 'bottom' | 'random';

export class Deck {
  private drawPile: CardInstance[] = [];
  private discardPile: CardInstance[] = [];

  /**
   * Veces que el descarte se reciclo a la pila de robo. Se LEE y se RESETEA con
   * `takeReshuffleCount()`: el motor lo consulta despues de robar y emite
   * `deck:reshuffle`. El `Deck` es puro (no conoce el bus), asi que el aviso lo
   * da `GameEngine`, que es quien puede emitir.
   */
  private reshuffleCount = 0;

  constructor(private readonly rng: RNG) {}

  setCards(cards: CardInstance[]): void {
    this.drawPile = [...cards];
    this.discardPile = [];
    this.reshuffleCount = 0;
    this.rng.shuffle(this.drawPile);
  }

  get remaining(): number {
    return this.drawPile.length;
  }

  /** Cartas en la pila de descartes (vuelven al robo cuando este se vacia). */
  get discardSize(): number {
    return this.discardPile.length;
  }

  get totalSize(): number {
    return this.drawPile.length + this.discardPile.length;
  }

  get allCards(): CardInstance[] {
    return [...this.drawPile, ...this.discardPile];
  }

  draw(count: number): CardInstance[] {
    const drawn: CardInstance[] = [];
    for (let i = 0; i < count; i++) {
      if (this.drawPile.length === 0) {
        if (this.discardPile.length === 0) break;
        // Reciclar: el descarte vuelve a ser mazo de robo.
        this.drawPile = this.rng.shuffle(this.discardPile);
        this.discardPile = [];
        this.reshuffleCount += 1;
      }
      const card = this.drawPile.pop();
      if (card) drawn.push(card);
    }
    return drawn;
  }

  /** Devuelve cuantas veces se reciclo el descarte desde la ultima consulta. */
  takeReshuffleCount(): number {
    const count = this.reshuffleCount;
    this.reshuffleCount = 0;
    return count;
  }

  discard(card: CardInstance): void {
    this.discardPile.push(card);
  }

  discardMany(cards: CardInstance[]): void {
    this.discardPile.push(...cards);
  }

  /** Devuelve una carta al mazo (por CREATE_CARD, retriggers, etc). */
  insert(card: CardInstance, position: InsertPosition = 'random'): void {
    switch (position) {
      case 'top':
        this.drawPile.push(card);
        break;
      case 'bottom':
        this.drawPile.unshift(card);
        break;
      case 'random': {
        const idx = this.rng.int(0, this.drawPile.length);
        this.drawPile.splice(idx, 0, card);
        break;
      }
    }
  }

  /** Elimina permanentemente una carta del mazo (DESTROY_SELF / purgas). */
  remove(uid: string): CardInstance | undefined {
    const inDraw = this.drawPile.findIndex((c) => c.uid === uid);
    if (inDraw >= 0) return this.drawPile.splice(inDraw, 1)[0];
    const inDiscard = this.discardPile.findIndex((c) => c.uid === uid);
    if (inDiscard >= 0) return this.discardPile.splice(inDiscard, 1)[0];
    return undefined;
  }

  /** Mezcla el mazo de robo. */
  shuffle(): void {
    this.rng.shuffle(this.drawPile);
  }

  /** Vista de solo lectura del mazo de robo (para debug en consola). */
  peekDrawPile(): readonly CardInstance[] {
    return this.drawPile;
  }
}
