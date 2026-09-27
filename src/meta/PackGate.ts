/**
 * PackGate.ts — Traduce entitlements en filtros de contenido.
 *
 * El motor recibe filtros, no reglas de negocio: `GameEngine` nunca sabe que
 * existe el concepto de "DLC". Esto mantiene el motor puro y testeable.
 *
 * REGLAS:
 *   - 'allowed' → entra en sorteos, tienda, drafts y coleccion.
 *   - 'locked'  → NO aparece en sorteos/drafts, PERO se lista en Coleccion y
 *                 Tienda grisado, con el nombre del pack. Un DLC que no se ve
 *                 no se vende.
 *   - 'hidden'  → no aparece ni en la UI.
 *
 * Un pack cuyo `requires.appMin` no se cumple nunca llega aqui: el registry lo
 * omite antes, porque podria referenciar features que no existen.
 */

import type {
  BlindDefinition,
  CardDefinition,
  JokerDefinition,
} from '@engine/index';

import type { ContentRegistry } from '../content/ContentRegistry';
import type { EntitlementStore } from './EntitlementStore';

export type GateResult = 'allowed' | 'locked' | 'hidden';

export interface LockedContent {
  id: string;
  kind: 'card' | 'joker' | 'blind';
  packId: string;
  titleKey: string;
}

export class PackGate {
  constructor(
    private readonly store: EntitlementStore,
    private readonly registry: ContentRegistry,
  ) {}

  /** Estado de un pack completo. */
  packState(packId: string): GateResult {
    const entry = this.registry.packEntries().find((e) => e.id === packId);
    if (!entry) return 'hidden';
    if (this.store.has(entry.entitlement)) return 'allowed';
    return entry.lockedVisibility === 'hidden' ? 'hidden' : 'locked';
  }

  /** Estado de una definicion concreta (para la Coleccion). */
  contentState(contentId: string): GateResult {
    const packId = this.registry.packOf(contentId);
    if (!packId) return 'allowed';
    return this.packState(packId);
  }

  /** Filtro para `CardRegistry.rollRandomCard(rng, filter)` y para el bundle. */
  cardFilter(): (def: CardDefinition) => boolean {
    return (def) => this.contentState(def.id) === 'allowed';
  }

  jokerFilter(): (def: JokerDefinition) => boolean {
    return (def) => this.contentState(def.id) === 'allowed';
  }

  blindFilter(): (def: BlindDefinition) => boolean {
    return (def) => this.contentState(def.id) === 'allowed';
  }

  /** Todo lo bloqueado pero visible: la superficie de venta. */
  lockedContent(): LockedContent[] {
    const out: LockedContent[] = [];
    for (const entry of this.registry.packEntries()) {
      if (this.store.has(entry.entitlement)) continue;
      if (entry.lockedVisibility === 'hidden') continue;
      for (const contentId of entry.contentIds) {
        out.push({
          id: contentId,
          kind: this.kindOf(contentId),
          packId: entry.id,
          titleKey: entry.titleKey,
        });
      }
    }
    return out;
  }

  private kindOf(contentId: string): 'card' | 'joker' | 'blind' {
    if (this.registry.packOf(contentId) === undefined) return 'card';
    const all = this.registry.poolOf('card');
    if (all.some((d) => d.id === contentId)) return 'card';
    if (this.registry.poolOf('joker').some((d) => d.id === contentId)) return 'joker';
    return 'blind';
  }
}
