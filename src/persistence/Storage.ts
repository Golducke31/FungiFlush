/**
 * Storage.ts — Backend de persistencia (clave/valor JSON).
 *
 * Dos implementaciones detras de una sola interfaz:
 *   - Tauri    → archivo en AppData (escritorio y Android).
 *   - Web      → localStorage.
 *
 * La deteccion es por CAPACIDADES, no por user-agent: en el navegador el modulo
 * `@tauri-apps/plugin-fs` importa sin problema pero explota al llamarse. La
 * senal correcta es la existencia del puente IPC (`__TAURI_INTERNALS__`).
 */

export type StorageBackend = 'tauri' | 'localStorage';

interface FsPlugin {
  writeTextFile: (path: string, contents: string, options?: { baseDir?: unknown }) => Promise<void>;
  readTextFile: (path: string, options?: { baseDir?: unknown }) => Promise<string>;
  exists: (path: string, options?: { baseDir?: unknown }) => Promise<boolean>;
  remove: (path: string, options?: { baseDir?: unknown }) => Promise<void>;
  BaseDirectory: { AppData: unknown };
}

export class Storage {
  private fsPlugin: FsPlugin | null = null;
  private kind: StorageBackend = 'localStorage';
  private lastError: string | null = null;

  async init(): Promise<StorageBackend> {
    const hasTauriBridge =
      typeof window !== 'undefined' && '__TAURI_INTERNALS__' in (window as object);
    if (!hasTauriBridge) {
      this.kind = 'localStorage';
      return this.kind;
    }

    try {
      const mod: unknown = await import(/* @vite-ignore */ '@tauri-apps/plugin-fs');
      const candidate = mod as Partial<FsPlugin> | undefined;
      if (
        typeof candidate?.writeTextFile === 'function' &&
        typeof candidate?.readTextFile === 'function' &&
        candidate?.BaseDirectory
      ) {
        this.fsPlugin = candidate as FsPlugin;
        this.kind = 'tauri';
        return this.kind;
      }
    } catch {
      /* El plugin no esta en el bundle: se usa localStorage. */
    }

    this.kind = 'localStorage';
    return this.kind;
  }

  get backend(): StorageBackend {
    return this.kind;
  }

  get error(): string | null {
    return this.lastError;
  }

  async read(key: string): Promise<string | null> {
    try {
      if (this.kind === 'tauri' && this.fsPlugin) {
        const exists = await this.fsPlugin.exists(fileName(key), {
          baseDir: this.fsPlugin.BaseDirectory.AppData,
        });
        if (!exists) return null;
        return await this.fsPlugin.readTextFile(fileName(key), {
          baseDir: this.fsPlugin.BaseDirectory.AppData,
        });
      }
      return globalThis.localStorage?.getItem(key) ?? null;
    } catch (error) {
      this.lastError = String(error);
      console.warn(`[Storage] No se pudo leer "${key}":`, error);
      return null;
    }
  }

  async write(key: string, value: string): Promise<boolean> {
    try {
      if (this.kind === 'tauri' && this.fsPlugin) {
        await this.fsPlugin.writeTextFile(fileName(key), value, {
          baseDir: this.fsPlugin.BaseDirectory.AppData,
        });
      } else {
        globalThis.localStorage?.setItem(key, value);
      }
      this.lastError = null;
      return true;
    } catch (error) {
      this.lastError = String(error);
      console.warn(`[Storage] No se pudo guardar "${key}":`, error);
      return false;
    }
  }

  async remove(key: string): Promise<void> {
    try {
      if (this.kind === 'tauri' && this.fsPlugin) {
        await this.fsPlugin.remove(fileName(key), { baseDir: this.fsPlugin.BaseDirectory.AppData });
      } else {
        globalThis.localStorage?.removeItem(key);
      }
    } catch {
      /* Borrar algo que no existe no es un error. */
    }
  }

  /** Copia de seguridad de un guardado ilegible: nunca se borra a ciegas. */
  async quarantine(key: string, raw: string): Promise<void> {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const target = `${key}.${stamp}.corrupt`;
    try {
      await this.write(target, raw);
    } catch {
      /* Si ni siquiera se puede respaldar, no se bloquea el arranque. */
    }
  }
}

function fileName(key: string): string {
  return `${key}.json`;
}
