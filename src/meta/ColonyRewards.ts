/**
 * ColonyRewards.ts — Las recompensas NOMBRADAS de la Colonia, con efecto.
 *
 * `Colony.ts` define la escalera (nivel -> rewardId). Este modulo define QUE ES
 * cada rewardId y COMO se entrega. Es la UNICA fuente de verdad del mapeo
 * `rewardId -> efecto`: agregar una recompensa no obliga a tocar la UI ni el
 * controlador.
 *
 * PURA: no toca el DOM, no conoce el motor. Muta el `ProfileSave` que le pasa el
 * llamador (que lo envuelve en `profileStore.patch`), igual que Colony / Packs.
 *
 * ENTREGA = RECLAMAR. Subir de nivel DESBLOQUEA (`colony.unlockedRewards`, ya
 * existia); el jugador RECLAMA y recien ahi obtiene la propiedad (o el sobre).
 * Reclamar NO equipa: equipar es una accion aparte, en Personalizar.
 *
 * La Colonia NO toca el combate (ver `docs/PLAN_COLONIA_Y_GOOGLE_PLAY.md` §1/§4):
 * todo lo de aca es cosmetico o un *grant* de coleccion.
 */

import type { ColonyProgress } from './Colony';
import type { ProfileSave } from './ProfileState';
import { grantPack, grantExpansionPack } from './Packs';

export type ColonyRewardKind = 'avatar' | 'frame' | 'title' | 'background' | 'victoryFx' | 'pack';

export interface ColonyRewardDef {
  /** El `rewardId` de `COLONY_LEVELS` (y clave del registro). */
  id: string;
  kind: ColonyRewardKind;
  /** Clave i18n del nombre. Ya existe (`colony.reward.<id>`). */
  nameKey: string;
  /** Clave i18n de la descripcion: QUE hace la recompensa. */
  descKey: string;
  /** Id que entra en `cosmetics.owned` cuando `kind !== 'pack'`. */
  cosmeticId?: string;
  /** Inventario que se acredita cuando `kind === 'pack'`. */
  packKind?: 'base' | 'expansion';
  /** Tier visual del marco (`kind === 'frame'`). */
  tier?: 'common' | 'uncommon';
}

/**
 * El registro. La clave es el `rewardId` de `COLONY_LEVELS`.
 *
 * Todo `rewardId` de la escalera TIENE que estar aca: un id sin definicion es un
 * bug y lo cubre `tests/colony-rewards.test.ts`.
 *
 * Los ids cosmeticos coinciden con el `rewardId` a proposito: el archivo de arte
 * se resuelve por patron (`avatar_<id>`, `frame_<id>`, `bgcard_<id>`), asi que no
 * hay una tabla paralela que mantener.
 */
export const COLONY_REWARDS: Readonly<Record<string, ColonyRewardDef>> = {
  frame_common: {
    id: 'frame_common',
    kind: 'frame',
    tier: 'common',
    nameKey: 'colony.reward.frame_common',
    descKey: 'colony.rewardInfo.frame_common',
    cosmeticId: 'frame_common',
  },
  pack_spores: {
    id: 'pack_spores',
    kind: 'pack',
    packKind: 'base',
    nameKey: 'colony.reward.pack_spores',
    descKey: 'colony.rewardInfo.pack_spores',
  },
  bg_new: {
    id: 'bg_new',
    kind: 'background',
    nameKey: 'colony.reward.bg_new',
    descKey: 'colony.rewardInfo.bg_new',
    cosmeticId: 'bg_new',
  },
  title_mycelium: {
    id: 'title_mycelium',
    kind: 'title',
    nameKey: 'colony.reward.title_mycelium',
    descKey: 'colony.rewardInfo.title_mycelium',
    cosmeticId: 'title_mycelium',
  },
  victory_fx: {
    id: 'victory_fx',
    kind: 'victoryFx',
    nameKey: 'colony.reward.victory_fx',
    descKey: 'colony.rewardInfo.victory_fx',
    cosmeticId: 'victory_fx',
  },
  pack_colony: {
    id: 'pack_colony',
    kind: 'pack',
    packKind: 'expansion',
    nameKey: 'colony.reward.pack_colony',
    descKey: 'colony.rewardInfo.pack_colony',
  },
  avatar: {
    id: 'avatar',
    kind: 'avatar',
    nameKey: 'colony.reward.avatar',
    descKey: 'colony.rewardInfo.avatar',
    cosmeticId: 'avatar',
  },
  frame_uncommon: {
    id: 'frame_uncommon',
    kind: 'frame',
    tier: 'uncommon',
    nameKey: 'colony.reward.frame_uncommon',
    descKey: 'colony.rewardInfo.frame_uncommon',
    cosmeticId: 'frame_uncommon',
  },
  title_established: {
    id: 'title_established',
    kind: 'title',
    nameKey: 'colony.reward.title_established',
    descKey: 'colony.rewardInfo.title_established',
    cosmeticId: 'title_established',
  },
};

/** Definicion de una recompensa, o `undefined` si el id no existe. */
export function rewardDef(id: string): ColonyRewardDef | undefined {
  return COLONY_REWARDS[id];
}

/** Recompensas DESBLOQUEADAS pero NO reclamadas, en el orden de `unlockedRewards`. */
export function claimableRewards(progress: ColonyProgress): string[] {
  const claimed = new Set(progress.claimedRewards);
  return progress.unlockedRewards.filter((id) => !claimed.has(id));
}

export interface ClaimResult {
  /** Ids reclamados en esta llamada. Los ya reclamados no aparecen. */
  claimed: string[];
  /** Sobres base acreditados. */
  basePacks: number;
  /** Sobres de expansion acreditados. */
  expansionPacks: number;
  /** Ids pedidos que no estaban pendientes (desbloqueados sin reclamar). */
  skipped: string[];
}

/**
 * Reclama recompensas desbloqueadas. Sin `ids`, reclama TODAS las pendientes.
 *
 * Idempotente: reclamar dos veces no duplica sobres ni cosmeticos. MUTA
 * `profile`. NO equipa: solo da la propiedad (el jugador elige en Personalizar).
 */
export function claimColonyRewards(profile: ProfileSave, ids?: string[]): ClaimResult {
  const progress = profile.colony;
  const pending = new Set(claimableRewards(progress));
  const wanted = ids ?? [...pending];

  const claimed: string[] = [];
  const skipped: string[] = [];
  let basePacks = 0;
  let expansionPacks = 0;

  for (const id of wanted) {
    if (!pending.has(id)) {
      skipped.push(id);
      continue;
    }
    const def = COLONY_REWARDS[id];
    if (def) {
      if (def.kind === 'pack') {
        if (def.packKind === 'expansion') {
          grantExpansionPack(profile.packs, 1);
          expansionPacks += 1;
        } else {
          grantPack(profile.packs, 1);
          basePacks += 1;
        }
      } else if (def.cosmeticId && !profile.cosmetics.owned.includes(def.cosmeticId)) {
        profile.cosmetics.owned.push(def.cosmeticId);
      }
    }
    // Un id desbloqueado SIN definicion se marca reclamado igual: si no, quedaria
    // "pendiente" para siempre y el boton no haria nada.
    progress.claimedRewards.push(id);
    claimed.push(id);
  }

  return { claimed, basePacks, expansionPacks, skipped };
}
