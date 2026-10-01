/**
 * types.ts — Tipos compartidos de retencion.
 *
 * Este archivo es deliberadamente el mas simple del modulo: NO importa nada.
 * `src/engine/events.ts` lo referencia para tipar los eventos de retencion, asi
 * que cualquier dependencia aca crearia un ciclo (o, peor, meteria DOM en el
 * motor). Si un tipo nuevo necesita algo de afuera, va en el modulo que lo usa.
 *
 * Nada de `Set` ni `Map`: todo lo de aca termina serializado en el perfil.
 */

/**
 * Recompensa de retencion. Union discriminada: el `switch` en `applyReward`
 * agrega un caso nuevo con error de compilacion si se olvida, no en silencio.
 *
 * REGLA v1: los ids de `card`/`joker` tienen que ser contenido YA EXISTENTE.
 * Un id nuevo exigiria su ilustracion propia (`art_card_own_<id>.webp`) o
 * `npm run validate` falla por `artCoverage`.
 */
export type RetentionReward =
  | { type: 'card'; id: string }
  | { type: 'joker'; id: string }
  | { type: 'cosmetic'; id: string }
  | { type: 'cardBack'; id: string }
  | { type: 'felt'; id: string };

/** De donde salio un desbloqueo. Se guarda en `collection.unlockSource`. */
export type RetentionSource = 'daily' | 'achievement' | 'season' | 'unlock';
