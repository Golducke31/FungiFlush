/**
 * EvolutionService.ts — Cartas que se convierten en otra especie.
 *
 * DECISION DE DISENO
 * ------------------
 * La evolucion NO es un efecto (no vive dentro de la carta): es una regla de
 * progresion, y por eso esta en `evolutions.json` indexada por `from`.
 * Consecuencia importante para la escalabilidad: **una expansion puede darle
 * una evolucion a una carta del juego base** sin sobrescribir su definicion ni
 * chocar con la regla "gana el primero" del merge de packs.
 *
 * La carta evolucionada conserva el **uid**. Eso no es un detalle: el uid es lo
 * que usan la seleccion, el mapa de cartas del render y `deck.remove(uid)`.
 * Si cambiara, evolucionar una carta la desconectaria de todo.
 */

import type { CardRegistry } from '../cards/CardRegistry';
import type { CardInstance, EvolutionRequirement, EvolutionRule } from '../types';

export interface EvolutionOption {
  rule: EvolutionRule;
  /** Definicion destino, ya resuelta (para mostrar nombre y valores). */
  target: NonNullable<ReturnType<CardRegistry['tryGetCard']>>;
  met: boolean;
}

export class EvolutionService {
  private readonly byFrom = new Map<string, EvolutionRule[]>();

  constructor(
    private readonly rules: readonly EvolutionRule[],
    private readonly registry: CardRegistry,
  ) {
    for (const rule of rules) {
      const list = this.byFrom.get(rule.from) ?? [];
      list.push(rule);
      this.byFrom.set(rule.from, list);
    }
  }

  get hasRules(): boolean {
    return this.rules.length > 0;
  }

  /** Todas las reglas que salen de una carta (cumplan o no el requisito). */
  rulesFor(cardId: string): EvolutionRule[] {
    return [...(this.byFrom.get(cardId) ?? [])];
  }

  /**
   * Reglas disponibles para una carta concreta. Una regla cuyo destino no
   * exista en el registro se ignora: es lo que permite que una expansion
   * declare una evolucion a una carta que todavia no se libero.
   */
  optionsFor(card: CardInstance): EvolutionOption[] {
    const out: EvolutionOption[] = [];
    for (const rule of this.rulesFor(card.def.id)) {
      const target = this.registry.tryGetCard(rule.to);
      if (!target) continue;
      out.push({ rule, target, met: this.met(rule.require, card) });
    }
    return out;
  }

  /** La primera evolucion que la carta puede hacer ahora mismo, o null. */
  availableFor(card: CardInstance): EvolutionOption | null {
    return this.optionsFor(card).find((option) => option.met) ?? null;
  }

  /** Cartas de una lista que tienen una evolucion lista para hacerse. */
  readyAmong(cards: readonly CardInstance[]): CardInstance[] {
    return cards.filter((card) => this.availableFor(card) !== null);
  }

  met(requirement: EvolutionRequirement, card: CardInstance): boolean {
    switch (requirement.type) {
      case 'level':
        return card.level >= requirement.value;
      case 'plays':
        return (card.plays ?? 0) >= requirement.value;
      case 'all':
        return requirement.conds.every((cond) => this.met(cond, card));
      case 'any':
        return requirement.conds.some((cond) => this.met(cond, card));
    }
  }

  /**
   * Aplica la evolucion EN SITIO. Devuelve el id anterior (para el VFX y para
   * el linaje de la coleccion) o null si no se pudo.
   */
  apply(card: CardInstance, rule: EvolutionRule): string | null {
    const target = this.registry.tryGetCard(rule.to);
    if (!target) return null;
    if (rule.from !== card.def.id) return null;

    const previousId = card.def.id;
    const keep = rule.keep ?? {};

    // El uid NO se toca: es la identidad de la carta en el mazo.
    card.def = target;
    card.evolvedFrom = previousId;

    if (keep.bonuses === false) {
      card.bonusSubstrate = 0;
      card.bonusSpores = 0;
    }
    switch (keep.level ?? 'carry') {
      case 'reset':
        card.level = 1;
        break;
      case 'minus':
        card.level = Math.max(1, card.level - 1);
        break;
      case 'carry':
        break;
    }
    if (keep.statuses === false) card.statuses = [];

    if (keep.grantSubstrate) card.bonusSubstrate += keep.grantSubstrate;
    if (keep.grantSpores) card.bonusSpores += keep.grantSpores;

    return previousId;
  }

  /**
   * Texto corto del requisito para la UI (clave i18n + parametro).
   * Devuelve una clave y su valor: la UI decide como traducirlo.
   */
  describe(requirement: EvolutionRequirement): { key: string; value: number } {
    switch (requirement.type) {
      case 'level':
        return { key: 'evolve.reqLevel', value: requirement.value };
      case 'plays':
        return { key: 'evolve.reqPlays', value: requirement.value };
      case 'all': {
        const first = requirement.conds[0];
        return first ? this.describe(first) : { key: 'evolve.reqLevel', value: 1 };
      }
      case 'any': {
        const first = requirement.conds[0];
        return first ? this.describe(first) : { key: 'evolve.reqLevel', value: 1 };
      }
    }
  }
}
