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
  /**
   * Clave i18n que EXPLICA el candado, cuando el motivo es un desbloqueo por
   * jugar (R2). `undefined` = el candado es del pack y `titleKey` ya lo explica.
   *
   * Existe porque "Bloqueado — Pack X" es correcto para un DLC y una mentira
   * para una carta que se abre ganando tres veces.
   */
  reasonKey?: string;
}

export class PackGate {
  /**
   * Destinos de evolucion. Se calcula UNA vez (el registro no cambia en
   * caliente) y nunca se trata como puerta: ver `contentState`.
   */
  private readonly evolutionTargets: ReadonlySet<string>;

  constructor(
    private readonly store: EntitlementStore,
    private readonly registry: ContentRegistry,
    /**
     * Ids desbloqueados por retencion (racha, logros, pase). Un DLC bloqueado
     * que el jugador se GANÓ deja de estarlo: entra en sorteos/drafts y se
     * muestra como 'unlocked' en la Coleccion. La referencia es al array VIVO
     * del perfil, asi que un desbloqueo a mitad de sesion se refleja al toque.
     */
    private readonly unlocked?: { cards: readonly string[]; jokers: readonly string[] },
    /**
     * Condiciones de desbloqueo por jugar (R2), id -> clave i18n. Referencia al
     * mapa VIVO de `profile.collection.pendingUnlocks`: el tracker borra la
     * entrada al abrir la puerta y el candado desaparece sin reconstruir nada.
     */
    private readonly pendingUnlocks?: Record<string, string>,
  ) {
    this.evolutionTargets = registry.evolutionTargets();
  }

  /** Estado de un pack completo. */
  packState(packId: string): GateResult {
    const entry = this.registry.packEntries().find((e) => e.id === packId);
    if (!entry) return 'hidden';
    if (this.store.has(entry.entitlement)) return 'allowed';
    return entry.lockedVisibility === 'hidden' ? 'hidden' : 'locked';
  }

  /**
   * Estado de una definicion concreta (para la Coleccion).
   *
   * El orden importa: primero "¿lo gano el jugador?", despues "¿es una puerta
   * por jugar?" y recien despues "¿lo tiene el pack?". Al reves, una carta
   * bloqueada por jugar quedaria 'allowed' porque su pack SI esta comprado.
   */
  contentState(contentId: string): GateResult {
    // Un DLC bloqueado que el jugador SE GANO entra en sorteos/drafts y deja de
    // verse como candado en la Coleccion/Tienda.
    if (this.isUnlocked(contentId)) return 'allowed';
    // Un DESTINO de evolucion nunca es puerta: su condicion ya es el requisito
    // de la evolucion. Filtrarlo romperia `EvolutionService.apply()` en mudo.
    if (this.evolutionTargets.has(contentId)) return 'allowed';
    if (this.pendingUnlocks && contentId in this.pendingUnlocks) return 'locked';
    const packId = this.registry.packOf(contentId);
    if (!packId) return 'allowed';
    return this.packState(packId);
  }

  /** ¿Este id lo gano el jugador por retencion (racha/logro/pase/unlock)? */
  private isUnlocked(contentId: string): boolean {
    return (
      !!this.unlocked &&
      (this.unlocked.cards.includes(contentId) || this.unlocked.jokers.includes(contentId))
    );
  }

  /** Clave i18n que explica el candado de un id, si el motivo es un desbloqueo. */
  lockReasonKey(contentId: string): string | undefined {
    return this.pendingUnlocks?.[contentId];
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
        // Un DLC bloqueado que el jugador SE GANO deja de ser superficie de venta.
        if (this.isUnlocked(contentId)) continue;
        // Un destino de evolucion tampoco: no es un candado ni algo que vender.
        if (this.evolutionTargets.has(contentId)) continue;
        const reasonKey = this.lockReasonKey(contentId);
        out.push({
          id: contentId,
          kind: this.kindOf(contentId),
          packId: entry.id,
          titleKey: entry.titleKey,
          ...(reasonKey ? { reasonKey } : {}),
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
