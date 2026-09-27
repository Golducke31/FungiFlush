/**
 * ProfileStore.ts — Perfil permanente del jugador.
 *
 * A diferencia del guardado de run, este NO se borra nunca: guarda coleccion,
 * cosméticos, ajustes, entitlements y estadisticas. Si algo falla al leerlo,
 * se arranca de un perfil por defecto en vez de romper el juego.
 */

import { defaultProfile, type ProfileSave } from '../meta/ProfileState';
import { migrateProfileSave } from './migrations';
import type { Storage } from './Storage';

export const PROFILE_STORAGE_KEY = 'fungiflush.profile';
const AUTOSAVE_DELAY_MS = 1200;

export class ProfileStore {
  private profile: ProfileSave = defaultProfile();
  private saveTimer = 0;

  constructor(private readonly storage: Storage) {}

  get current(): ProfileSave {
    return this.profile;
  }

  async load(): Promise<ProfileSave> {
    const raw = await this.storage.read(PROFILE_STORAGE_KEY);
    if (!raw) {
      this.profile = defaultProfile();
      return this.profile;
    }
    try {
      this.profile = migrateProfileSave(JSON.parse(raw));
    } catch {
      await this.storage.quarantine(PROFILE_STORAGE_KEY, raw);
      this.profile = defaultProfile();
    }
    return this.profile;
  }

  /** Aplica un cambio y lo persiste (debounced). */
  patch(mutate: (profile: ProfileSave) => void): void {
    mutate(this.profile);
    this.profile.updatedAt = new Date().toISOString();
    this.scheduleSave();
  }

  async saveNow(): Promise<boolean> {
    this.clearTimer();
    return this.storage.write(PROFILE_STORAGE_KEY, JSON.stringify(this.profile));
  }

  private scheduleSave(): void {
    this.clearTimer();
    this.saveTimer = window.setTimeout(() => {
      void this.storage.write(PROFILE_STORAGE_KEY, JSON.stringify(this.profile));
    }, AUTOSAVE_DELAY_MS);
  }

  clearTimer(): void {
    if (this.saveTimer) window.clearTimeout(this.saveTimer);
    this.saveTimer = 0;
  }
}
