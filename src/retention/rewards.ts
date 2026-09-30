/**
 * rewards.ts — Escribe una recompensa de retencion en el perfil.
 *
 * PURA y sin DOM: recibe un `ProfileSave` y lo muta. Quien persiste es el
 * llamador (`profileStore.patch(p => applyReward(...))`), porque el perfil se
 * guarda con debounce y no una vez por reward.
 *
 * No hay moneda nueva: un desbloqueo ES la recompensa. "Fungis" sigue siendo
 * solo de la run (`RunState.money`) y se borra al terminar.
 */

import type { ProfileSave } from '../meta/ProfileState';
import type { RetentionReward, RetentionSource } from './types';

/**
 * Aplica un reward. Devuelve `true` si agrego algo NUEVO: el llamador usa ese
 * dato para decidir si muestra el toast ("ya lo tenias" no es una noticia).
 */
export function applyReward(
  profile: ProfileSave,
  reward: RetentionReward,
  source: RetentionSource,
): boolean {
  switch (reward.type) {
    case 'card':
      return unlock(profile, 'card', reward.id, source);
    case 'joker':
      return unlock(profile, 'joker', reward.id, source);
    case 'cosmetic':
      return own(profile, reward.id);
    case 'cardBack': {
      const added = own(profile, reward.id);
      profile.cosmetics.equippedCardBack = reward.id;
      return added;
    }
    case 'felt': {
      const added = own(profile, reward.id);
      profile.cosmetics.equippedFelt = reward.id;
      return added;
    }
  }
}

/** Alta en la coleccion + registro del origen. Idempotente. */
function unlock(
  profile: ProfileSave,
  kind: 'card' | 'joker',
  id: string,
  source: RetentionSource,
): boolean {
  const list = kind === 'card' ? profile.collection.unlockedCardIds : profile.collection.unlockedJokerIds;
  if (list.includes(id)) {
    // Ya lo tenia: el origen se iguala igual, por si la primera vez no se
    // guardo (perfil viejo anterior a P0).
    profile.collection.unlockSource[id] = source;
    return false;
  }
  list.push(id);
  profile.collection.unlockSource[id] = source;
  return true;
}

/** Alta en cosmeticos. Idempotente. */
function own(profile: ProfileSave, id: string): boolean {
  if (profile.cosmetics.owned.includes(id)) return false;
  profile.cosmetics.owned.push(id);
  return true;
}
