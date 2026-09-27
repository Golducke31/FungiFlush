/**
 * RunStore.ts — Guardado de la partida en curso.
 *
 * Se apoya en `Storage` para el backend y en `migrations` para la version.
 * Un guardado que no se puede migrar NO se borra: se pone en cuarentena con
 * fecha, para poder pedirlo al jugador si hace falta depurar.
 */

import type { RunSaveData } from '@engine/index';

import { migrateRunSave } from './migrations';
import type { Storage } from './Storage';

export const RUN_STORAGE_KEY = 'fungiflush.run';
const AUTOSAVE_DELAY_MS = 1500;

export class RunStore {
  private saveTimer = 0;
  private lastError: string | null = null;

  constructor(private readonly storage: Storage) {}

  get error(): string | null {
    return this.lastError;
  }

  async load(): Promise<RunSaveData | null> {
    const raw = await this.storage.read(RUN_STORAGE_KEY);
    if (!raw) return null;

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      await this.storage.quarantine(RUN_STORAGE_KEY, raw);
      this.lastError = 'El guardado no es JSON valido.';
      return null;
    }

    const migrated = migrateRunSave(parsed);
    if (!migrated) {
      await this.storage.quarantine(RUN_STORAGE_KEY, raw);
      this.lastError = 'El guardado no se pudo migrar a la version actual.';
      return null;
    }

    return migrated;
  }

  async save(data: RunSaveData): Promise<boolean> {
    const ok = await this.storage.write(RUN_STORAGE_KEY, JSON.stringify(data));
    this.lastError = ok ? null : this.storage.error;
    return ok;
  }

  async clear(): Promise<void> {
    await this.storage.remove(RUN_STORAGE_KEY);
  }

  /**
   * Autoguardado con debounce: sin el, cada `state:changed` escribiria en
   * disco (una mano son 200 pasos de score). Con 1.5 s, una mano = 1 escritura.
   */
  autosave(provider: () => RunSaveData): void {
    this.clearTimer();
    this.saveTimer = window.setTimeout(() => {
      void this.save(provider());
    }, AUTOSAVE_DELAY_MS);
  }

  cancelAutosave(): void {
    this.clearTimer();
  }

  private clearTimer(): void {
    if (this.saveTimer) window.clearTimeout(this.saveTimer);
    this.saveTimer = 0;
  }
}
