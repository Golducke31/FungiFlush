/**
 * SaveGame.ts — Persistencia de la partida.
 *
 * Dos backends, misma API:
 *   - Tauri  -> escribe un JSON en el disco del usuario (AppData).
 *   - Web    -> localStorage.
 *
 * La deteccion es por capacidades, no por user-agent: si el plugin de fs
 * responde, se usa; si no, se cae a localStorage. Asi el mismo codigo corre
 * en el ejecutable de escritorio, en el navegador de desarrollo y en el
 * WebView de un celular, sin ramas por plataforma en el resto del juego.
 */

import type { RunSaveData } from '@engine/index';

const FILE_NAME = 'fungiflush-save.json';
const STORAGE_KEY = 'fungiflush.save';
const AUTOSAVE_DELAY_MS = 1500;

interface FsPlugin {
  writeTextFile: (path: string, contents: string, options?: { baseDir?: unknown }) => Promise<void>;
  readTextFile: (path: string, options?: { baseDir?: unknown }) => Promise<string>;
  exists: (path: string, options?: { baseDir?: unknown }) => Promise<boolean>;
  remove: (path: string, options?: { baseDir?: unknown }) => Promise<void>;
  BaseDirectory: { AppData: unknown };
}

export class SaveGame {
  private fsPlugin: FsPlugin | null = null;
  private tauriAvailable = false;
  private saveTimer = 0;
  private lastError: string | null = null;

  /**
   * Detecta el backend disponible. Se llama una sola vez al arrancar.
   *
   * OJO: no alcanza con comprobar que el modulo `@tauri-apps/plugin-fs`
   * importe. En el navegador el modulo importa perfecto pero sus funciones
   * explotan al llamarse, porque `invoke` no existe. La deteccion correcta es
   * preguntar por el puente IPC de Tauri.
   */
  async init(): Promise<'tauri' | 'localStorage'> {
    const hasTauriBridge =
      typeof window !== 'undefined' && '__TAURI_INTERNALS__' in (window as object);
    if (!hasTauriBridge) return 'localStorage';

    try {
      const mod: unknown = await import(/* @vite-ignore */ '@tauri-apps/plugin-fs');
      const candidate = mod as Partial<FsPlugin> | undefined;
      if (
        typeof candidate?.writeTextFile === 'function' &&
        typeof candidate?.readTextFile === 'function' &&
        candidate?.BaseDirectory
      ) {
        this.fsPlugin = candidate as FsPlugin;
        this.tauriAvailable = true;
        return 'tauri';
      }
    } catch {
      /* El plugin no esta instalado en el bundle de Tauri. */
    }
    return 'localStorage';
  }

  get backend(): 'tauri' | 'localStorage' {
    return this.tauriAvailable ? 'tauri' : 'localStorage';
  }

  get error(): string | null {
    return this.lastError;
  }

  async save(data: RunSaveData): Promise<boolean> {
    const json = JSON.stringify(data);
    try {
      if (this.tauriAvailable && this.fsPlugin) {
        await this.fsPlugin.writeTextFile(FILE_NAME, json, {
          baseDir: this.fsPlugin.BaseDirectory.AppData,
        });
      } else {
        globalThis.localStorage?.setItem(STORAGE_KEY, json);
      }
      this.lastError = null;
      return true;
    } catch (error) {
      this.lastError = String(error);
      console.warn('[SaveGame] No se pudo guardar:', error);
      return false;
    }
  }

  async load(): Promise<RunSaveData | null> {
    try {
      let raw: string | null = null;

      if (this.tauriAvailable && this.fsPlugin) {
        const exists = await this.fsPlugin.exists(FILE_NAME, {
          baseDir: this.fsPlugin.BaseDirectory.AppData,
        });
        if (exists) {
          raw = await this.fsPlugin.readTextFile(FILE_NAME, {
            baseDir: this.fsPlugin.BaseDirectory.AppData,
          });
        }
      } else {
        raw = globalThis.localStorage?.getItem(STORAGE_KEY) ?? null;
      }

      if (!raw) return null;
      const parsed = JSON.parse(raw) as RunSaveData;
      if (typeof parsed?.version !== 'number') return null;
      return parsed;
    } catch (error) {
      this.lastError = String(error);
      console.warn('[SaveGame] No se pudo leer el guardado:', error);
      return null;
    }
  }

  async clear(): Promise<void> {
    try {
      if (this.tauriAvailable && this.fsPlugin) {
        await this.fsPlugin.remove(FILE_NAME, { baseDir: this.fsPlugin.BaseDirectory.AppData });
      } else {
        globalThis.localStorage?.removeItem(STORAGE_KEY);
      }
    } catch {
      /* Borrar un guardado que no existe no es un error. */
    }
  }

  /**
   * Autoguardado con debounce.
   *
   * Sin debounce, cada `state:changed` escribiria en disco: en una mano con
   * 200 pasos de score eso son 200 escrituras. Con 1.5 s de espera, una mano
   * completa produce una sola.
   */
  autosave(provider: () => RunSaveData): void {
    window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => {
      void this.save(provider());
    }, AUTOSAVE_DELAY_MS);
  }

  cancelAutosave(): void {
    window.clearTimeout(this.saveTimer);
  }
}
