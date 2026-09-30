/**
 * notify.ts — Avisos del sistema (espejo de `src/persistence/Storage.ts`).
 *
 * Dos implementaciones detras de una sola interfaz:
 *   - Tauri    -> `@tauri-apps/plugin-notification` (escritorio y Android).
 *   - Web      -> `Notification` del navegador.
 *
 * La deteccion es por CAPACIDADES, no por user-agent: en el navegador el modulo
 * del plugin importa sin problema y explota al llamarse. La senal correcta es
 * la existencia del puente IPC (`__TAURI_INTERNALS__`).
 *
 * DOS COSAS QUE NO SON ESTE MODULO:
 *   - **No hay push real.** Sin backend no existe "mandar una notificacion
 *     mañana": el recordatorio es best-effort y se resuelve al abrir la app
 *     (si ya paso el dia, se avisa). Esta declarado asi a proposito.
 *   - **El banner in-app es el fallback garantizado.** Si el permiso se
 *     deniega (o la plataforma no tiene notificaciones), `.banner-stack` sigue
 *     mostrando el aviso dentro del juego. Por eso el permiso se pide EN
 *     CONTEXTO y no al arrancar: pedirlo en frio es la forma mas rapida de que
 *     lo denieguen para siempre.
 */

export type NotifyBackend = 'tauri' | 'web' | 'none';

/** Solo lo que usamos del plugin: asi el fallback no depende de su tipo real. */
interface NotificationPlugin {
  isPermissionGranted: () => Promise<boolean>;
  requestPermission: () => Promise<string>;
  sendNotification: (options: { title: string; body?: string }) => void;
}

export interface NotifyPayload {
  title: string;
  body?: string;
}

function hasTauriBridge(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in (window as object);
}

export class Notifier {
  private plugin: NotificationPlugin | null = null;
  private kind: NotifyBackend = 'none';
  /** Ya se pregunto en esta sesion: no insistir si dijeron que no. */
  private asked = false;

  /** Carga el backend. Barato y sin efectos: se puede llamar en el boot. */
  async init(): Promise<NotifyBackend> {
    if (!hasTauriBridge()) {
      this.kind = typeof globalThis.Notification === 'function' ? 'web' : 'none';
      return this.kind;
    }
    try {
      const mod: unknown = await import(/* @vite-ignore */ '@tauri-apps/plugin-notification');
      const candidate = mod as Partial<NotificationPlugin> | undefined;
      if (
        typeof candidate?.sendNotification === 'function' &&
        typeof candidate?.requestPermission === 'function'
      ) {
        this.plugin = candidate as NotificationPlugin;
        this.kind = 'tauri';
        return this.kind;
      }
    } catch {
      /* El plugin no esta en el bundle: se usa el fallback web. */
    }
    this.kind = typeof globalThis.Notification === 'function' ? 'web' : 'none';
    return this.kind;
  }

  get backend(): NotifyBackend {
    return this.kind;
  }

  get available(): boolean {
    return this.kind !== 'none';
  }

  /**
   * Pide el permiso si hace falta. Devuelve si se puede notificar.
   *
   * En web esto necesita un gesto del usuario, asi que el llamador lo invoca
   * DESPUES de una accion (reclamar el daily), nunca en el arranque.
   */
  async ensurePermission(): Promise<boolean> {
    if (this.kind === 'none') return false;

    if (this.kind === 'tauri' && this.plugin) {
      try {
        if (await this.plugin.isPermissionGranted()) return true;
        if (this.asked) return false;
        this.asked = true;
        const result = await this.plugin.requestPermission();
        // El plugin devuelve el estado, no un booleano.
        return result === 'granted';
      } catch {
        return false;
      }
    }

    // Web: `Notification.requestPermission()` tambien es una promesa en los
    // navegadores actuales, pero en algunos devuelve el string directo.
    try {
      if (globalThis.Notification?.permission === 'granted') return true;
      if (globalThis.Notification?.permission === 'denied') return false;
      if (this.asked) return false;
      this.asked = true;
      const result = await globalThis.Notification.requestPermission();
      return result === 'granted';
    } catch {
      return false;
    }
  }

  /** Envia el aviso. Nunca lanza: un aviso fallido no puede tumbar el juego. */
  notify(payload: NotifyPayload): boolean {
    if (this.kind === 'none') return false;

    if (this.kind === 'tauri' && this.plugin) {
      try {
        this.plugin.sendNotification(
          payload.body === undefined ? { title: payload.title } : { title: payload.title, body: payload.body },
        );
        return true;
      } catch {
        return false;
      }
    }

    try {
      if (globalThis.Notification?.permission !== 'granted') return false;
      new globalThis.Notification(payload.title, { body: payload.body });
      return true;
    } catch {
      return false;
    }
  }
}

/** Instancia unica: el permiso es global al proceso, no por pantalla. */
export const notifier = new Notifier();

export async function ensureNotificationPermission(): Promise<boolean> {
  return notifier.ensurePermission();
}

export function notify(payload: NotifyPayload): boolean {
  return notifier.notify(payload);
}
