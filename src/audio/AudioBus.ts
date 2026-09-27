/**
 * AudioBus.ts — Capa de audio (HOY: no-op con ganchos ya cableados).
 *
 * El audio llega en una fase posterior, pero los ganchos se instalan ahora.
 * Por que: el punto de enganche es el bus de eventos del motor, no el motor.
 * Entonces implementar el sonido real despues es "llenar" `play()` y agregar
 * archivos; ni una linea del motor, del render ni del HUD cambia.
 *
 * Mientras tanto, `play()` no hace nada y nadie nota la diferencia.
 */

import { bus, type GameEventMap } from '@engine/index';

type EngineEvent = keyof GameEventMap;

export type AudioChannel = 'sfx' | 'music';

export interface AudioPlayOptions {
  volume?: number;
  /** -1 izquierda, 0 centro, 1 derecha. */
  pan?: number;
  delayMs?: number;
}

/** Evento del motor -> id de sonido. Es el unico lugar donde se decide que suena. */
const EVENT_SOUNDS: Partial<Record<EngineEvent, string>> = {
  'run:start': 'run_start',
  'blind:selected': 'blind_select',
  'card:drawn': 'card_draw',
  'card:played': 'card_play',
  'card:discarded': 'card_discard',
  'card:destroyed': 'card_destroy',
  'card:created': 'card_create',
  'score:hand': 'score_hand',
  'round:win': 'round_win',
  'round:loss': 'round_loss',
  'game:over': 'game_over',
  'joker:added': 'joker_add',
  'joker:sold': 'joker_sell',
  'shop:purchase': 'shop_buy',
  'shop:reroll': 'shop_reroll',
  'money:changed': 'coin',
};

export class AudioBus {
  private volumes: Record<AudioChannel, number> = { sfx: 0.8, music: 0.6 };
  private muted = false;
  private duckUntil = 0;

  /**
   * Reproduce un sonido. Hoy es intencionalmente vacio: el id queda registro
   * en consola solo en desarrollo, para poder armar la lista de assets reales
   * mirando que se pidio.
   */
  play(id: string, _options?: AudioPlayOptions): void {
    if (this.muted) return;
    if (import.meta.env?.DEV) console.debug('[audio]', id);
  }

  setVolume(channel: AudioChannel, value: number): void {
    this.volumes[channel] = Math.min(1, Math.max(0, value));
  }

  getVolume(channel: AudioChannel): number {
    return this.volumes[channel];
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
  }

  /** Baja el volumen momentaneamente (para un efecto importante). */
  duck(ms = 220): void {
    this.duckUntil = Date.now() + ms;
  }

  get isDucked(): boolean {
    return Date.now() < this.duckUntil;
  }
}

export const audio = new AudioBus();

/**
 * Conecta el bus del motor con el AudioBus. Devuelve la funcion para
 * desuscribir (util en tests y si se re-inicializa la app).
 */
export function attachAudioHooks(): () => void {
  const unsubscribes: Array<() => void> = [];
  for (const [event, sound] of Object.entries(EVENT_SOUNDS) as Array<[EngineEvent, string]>) {
    unsubscribes.push(
      bus.on(event, () => {
        audio.play(sound);
      }),
    );
  }
  return () => {
    for (const off of unsubscribes) off();
  };
}
