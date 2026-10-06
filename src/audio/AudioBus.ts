/**
 * AudioBus.ts — Capa de audio real (Web Audio + samples de `public/audio/`).
 *
 * DOS CAMINOS, A PROPOSITO
 * ------------------------
 *   - SFX (cortos, <1,5 s): se DECODIFICAN a `AudioBuffer` y se disparan con
 *     `AudioBufferSourceNode`. Latencia minima y cero I/O en el momento del tap.
 *   - MUSICA (loops de 32 s): va por `<audio loop>` + `MediaElementSource`, o
 *     sea STREAMING. Decodificar 32 s de estereo 44.1 kHz a float32 ocupa ~11 MB
 *     POR TEMA; con dos temas serian 22 MB de RAM para siempre. El elemento de
 *     audio no los decodifica enteros.
 *
 * EL GRAFO
 * --------
 *   AudioContext -> masterGain -> +-- sfxGain   -> destination
 *                                +-- musicGain -> MediaElementSource
 *
 * Los dos sliders de Ajustes (`sfxVolume`/`musicVolume`) mueven `sfxGain` y
 * `musicGain`. Antes se guardaban en el perfil y no los leia nadie.
 *
 * AUTOPLAY
 * --------
 * El navegador arranca el `AudioContext` SUSPENDIDO hasta el primer gesto del
 * usuario. `unlock()` se llama en el primer pointerdown/keydown y recien ahi se
 * puede sonar. Por eso la musica del menu arranca con el primer tap y no antes.
 *
 * FALLBACK SINTETICO
 * ------------------
 * Un id sin archivo (logros, tienda, reroll...) suena con un beep sintetizado
 * (oscilador triangular + envolvente exponencial), el mismo del prototipo de
 * combo. Sirve para no dejar eventos mudos y de red de seguridad si un asset no
 * carga: el juego nunca se queda sin audio por un 404.
 */

import { bus, type GameEventMap } from '@engine/index';

type EngineEvent = keyof GameEventMap;

export type AudioChannel = 'sfx' | 'music';

/** Temas disponibles. Uno por estado de juego (ver `playMusic`). */
export type MusicTrack = 'menu' | 'ingame';

export interface AudioPlayOptions {
  volume?: number;
  /** -1 izquierda, 0 centro, 1 derecha. */
  pan?: number;
  delayMs?: number;
  /** Multiplicador de velocidad. Sube el tono (una cascada de descartes). */
  rate?: number;
}

/** Carpeta servida. Relativa para que resuelva igual en dev y bajo `asset://`. */
const AUDIO_DIR = 'audio/';
const MANIFEST_URL = `${AUDIO_DIR}index.json`;

/**
 * Ids con VARIAS variaciones. Se elige al azar evitando repetir la ultima: con
 * 3 archivos, el azar puro se nota como metralleta.
 */
const VARIANTS: Record<string, string[]> = {
  discard: ['discard_1', 'discard_2', 'discard_3'],
  select: ['select_1', 'select_2', 'select_3', 'select_4', 'select_5'],
};

/** Nota base del beep de reserva (Do central) y escala pentatonica. */
const SYNTH_BASE_HZ = 262;
const PENTATONIC = [0, 2, 4, 7, 12, 14, 16, 19];

/**
 * Evento del motor -> id de sonido. Es el unico lugar donde se decide que suena.
 * `card:discarded` NO esta aca: necesita agrupar la tanda (ver `onDiscarded`).
 */
const EVENT_SOUNDS: Partial<Record<EngineEvent, string>> = {
  'run:start': 'run_start',
  'blind:selected': 'blind_select',
  'card:drawn': 'card_draw',
  'card:selected': 'select',
  'card:deselected': 'select',
  'card:played': 'card_play',
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

interface Manifest {
  music?: Record<string, { file: string }>;
  sfx?: Record<string, { file: string }>;
}

export class AudioBus {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private sfxGain: GainNode | null = null;
  private musicGain: GainNode | null = null;

  private volumes: Record<AudioChannel, number> = { sfx: 0.8, music: 0.6 };
  private muted = false;
  private duckUntil = 0;

  /** id -> AudioBuffer ya decodificado. */
  private readonly buffers = new Map<string, AudioBuffer>();
  /** id -> url, tal como lo devolvio el manifiesto. */
  private readonly files = new Map<string, string>();
  private loaded = false;
  private loading: Promise<void> | null = null;

  /** Musica: un elemento por tema, con su ganancia para el crossfade. */
  private readonly music = new Map<string, { el: HTMLAudioElement; gain: GainNode }>();
  private currentMusic: MusicTrack | null = null;

  /** Ultima variacion usada por familia, para no repetir. */
  private readonly lastVariant = new Map<string, string>();

  /** Agrupador de la tanda de descartes (ver `onDiscarded`). */
  private discardCount = 0;
  private discardTimer: number | null = null;

  private unlocked = false;

  // -------------------------------------------------------------------------
  // Ciclo de vida
  // -------------------------------------------------------------------------

  /**
   * Crea el grafo. Se llama en el primer gesto del usuario: antes de eso el
   * navegador lo dejaria suspendido y no suena nada.
   */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    this.ctx = new Ctor();
    this.master = this.ctx.createGain();
    this.sfxGain = this.ctx.createGain();
    this.musicGain = this.ctx.createGain();
    this.sfxGain.connect(this.master);
    this.musicGain.connect(this.master);
    this.master.connect(this.ctx.destination);
    this.applyVolumes();
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    this.unlocked = true;
    void this.load();
  }

  get isUnlocked(): boolean {
    return this.unlocked;
  }

  /** Baja el manifiesto y decodifica los SFX. Idempotente. */
  load(): Promise<void> {
    if (this.loaded) return Promise.resolve();
    if (this.loading) return this.loading;
    this.loading = (async () => {
      try {
        const res = await fetch(MANIFEST_URL);
        if (!res.ok) throw new Error(`manifest ${res.status}`);
        const manifest = (await res.json()) as Manifest;
        for (const [id, entry] of Object.entries(manifest.sfx ?? {})) {
          this.files.set(id, `${AUDIO_DIR}${entry.file}`);
        }
        for (const [id, entry] of Object.entries(manifest.music ?? {})) {
          this.files.set(`music_${id}`, `${AUDIO_DIR}${entry.file}`);
        }
        // Los SFX se decodifican TODOS de una: son ~110 KB en total y asi el
        // primer tap no espera una red.
        await Promise.all([...this.files].filter(([id]) => !id.startsWith('music_')).map(([id, url]) => this.decode(id, url)));
        this.loaded = true;
      } catch {
        // Sin manifiesto el juego sigue andando con el sintetizador.
        this.loaded = true;
      }
    })();
    return this.loading;
  }

  private async decode(id: string, url: string): Promise<void> {
    if (!this.ctx) return;
    try {
      const res = await fetch(url);
      if (!res.ok) return;
      const bytes = await res.arrayBuffer();
      this.buffers.set(id, await this.ctx.decodeAudioData(bytes));
    } catch {
      /* queda sin buffer: sonara el sintetizador */
    }
  }

  // -------------------------------------------------------------------------
  // Reproduccion
  // -------------------------------------------------------------------------

  play(id: string, options: AudioPlayOptions = {}): void {
    if (this.muted) return;
    if (!this.ctx || !this.sfxGain) return;

    const resolved = this.resolveVariant(id);
    const buffer = this.buffers.get(resolved);
    if (!buffer) {
      // Sin archivo: beep sintetizado. Mantiene el evento audible.
      this.synth(resolved, options);
      return;
    }
    this.playBuffer(buffer, options);
  }

  private playBuffer(buffer: AudioBuffer, options: AudioPlayOptions): void {
    const ctx = this.ctx;
    const sfx = this.sfxGain;
    if (!ctx || !sfx) return;

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    if (options.rate) source.playbackRate.value = options.rate;

    const gain = ctx.createGain();
    const volume = (options.volume ?? 1) * (this.isDucked ? 0.4 : 1);
    gain.gain.value = volume;

    source.connect(gain);
    if (options.pan !== undefined && ctx.createStereoPanner) {
      const panner = ctx.createStereoPanner();
      panner.pan.value = Math.max(-1, Math.min(1, options.pan));
      gain.connect(panner);
      panner.connect(sfx);
    } else {
      gain.connect(sfx);
    }

    const at = ctx.currentTime + (options.delayMs ?? 0) / 1000;
    source.start(at);
  }

  /**
   * Beep de reserva. Mismo criterio que el prototipo de combo: triangular +
   * envolvente exponencial. El indice del id elige la nota de la pentatonica,
   * asi una secuencia de eventos sube de tono en vez de repetir el mismo pip.
   */
  private synth(id: string, options: AudioPlayOptions): void {
    const ctx = this.ctx;
    const sfx = this.sfxGain;
    if (!ctx || !sfx) return;

    let hash = 0;
    for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
    const semi = PENTATONIC[hash % PENTATONIC.length] ?? 0;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const at = ctx.currentTime + (options.delayMs ?? 0) / 1000;
    const volume = (options.volume ?? 0.22) * (this.isDucked ? 0.4 : 1);

    osc.type = 'triangle';
    osc.frequency.value = SYNTH_BASE_HZ * Math.pow(2, semi / 12) * (options.rate ?? 1);
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, volume), at + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.4);

    osc.connect(gain);
    gain.connect(sfx);
    osc.start(at);
    osc.stop(at + 0.42);
  }

  /** Elige una variacion al azar sin repetir la ultima de la familia. */
  private resolveVariant(id: string): string {
    const family = VARIANTS[id];
    if (!family || family.length === 0) return id;
    const previous = this.lastVariant.get(id);
    const options = family.length > 1 ? family.filter((v) => v !== previous) : family;
    const pick = options[Math.floor(Math.random() * options.length)] ?? family[0]!;
    this.lastVariant.set(id, pick);
    return pick;
  }

  // -------------------------------------------------------------------------
  // Musica
  // -------------------------------------------------------------------------

  /**
   * Cambia de tema con crossfade. `null` la apaga. Los dos temas pueden estar
   * sonando a la vez durante el fundido, que es justo lo que se busca.
   */
  playMusic(id: MusicTrack | null, fadeMs = 600): void {
    if (this.muted) return;
    if (this.currentMusic === id) return;
    this.currentMusic = id;

    if (!this.ctx || !this.musicGain) return;

    const target = id ? this.ensureMusic(id) : null;
    const now = this.ctx.currentTime;
    const fade = Math.max(0.01, fadeMs / 1000);

    for (const [key, entry] of this.music) {
      const to = key === id ? this.volumes.music : 0;
      entry.gain.gain.cancelScheduledValues(now);
      entry.gain.gain.setValueAtTime(entry.gain.gain.value, now);
      entry.gain.gain.linearRampToValueAtTime(to, now + fade);
    }

    if (target) {
      target.el.volume = 1; // la ganancia la maneja el grafo, no el elemento
      void target.el.play().catch(() => {
        /* sin gesto todavia: se reintenta en unlock() */
      });
    }
    // Los temas que quedaron en 0 se pausan cuando termina el fundido.
    window.setTimeout(() => {
      for (const [key, entry] of this.music) {
        if (key !== this.currentMusic && entry.gain.gain.value < 0.01) entry.el.pause();
      }
    }, fadeMs + 80);
  }

  private ensureMusic(id: string): { el: HTMLAudioElement; gain: GainNode } {
    const existing = this.music.get(id);
    if (existing) return existing;
    const ctx = this.ctx!;
    const url = this.files.get(`music_${id}`) ?? `${AUDIO_DIR}music_${id}.ogg`;
    const el = new Audio(url);
    el.loop = true;
    el.preload = 'auto';
    const gain = ctx.createGain();
    gain.gain.value = 0;
    ctx.createMediaElementSource(el).connect(gain);
    gain.connect(this.musicGain!);
    const entry = { el, gain };
    this.music.set(id, entry);
    return entry;
  }

  // -------------------------------------------------------------------------
  // Volumen y estado
  // -------------------------------------------------------------------------

  setVolume(channel: AudioChannel, value: number): void {
    this.volumes[channel] = Math.min(1, Math.max(0, value));
    this.applyVolumes();
  }

  getVolume(channel: AudioChannel): number {
    return this.volumes[channel];
  }

  private applyVolumes(): void {
    if (!this.ctx) return;
    if (this.sfxGain) this.sfxGain.gain.value = this.muted ? 0 : this.volumes.sfx;
    if (this.musicGain) this.musicGain.gain.value = this.muted ? 0 : this.volumes.music;
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    this.applyVolumes();
    if (muted) for (const entry of this.music.values()) entry.el.pause();
    else if (this.currentMusic) this.playMusic(this.currentMusic);
  }

  /** Baja el volumen momentaneamente (para un efecto importante). */
  duck(ms = 220): void {
    this.duckUntil = Date.now() + ms;
  }

  get isDucked(): boolean {
    return Date.now() < this.duckUntil;
  }

  // -------------------------------------------------------------------------
  // Tanda de descartes
  // -------------------------------------------------------------------------

  /**
   * `discardCards` emite un `card:discarded` por carta, TODOS sincronicos. Para
   * distinguir "descarte una" de "descarte varias" se agrupa: el primer evento
   * arma un timer de 0 ms y cuando corre ya se sabe cuantas cayeron.
   */
  onDiscarded(): void {
    this.discardCount += 1;
    if (this.discardTimer !== null) return;
    this.discardTimer = window.setTimeout(() => {
      const count = this.discardCount;
      this.discardCount = 0;
      this.discardTimer = null;
      if (count > 1) this.play('discard_many', { volume: 0.9 });
      else this.play('discard', { volume: 0.9 });
    }, 0);
  }

  // -------------------------------------------------------------------------

  /**
   * Pausa la musica cuando la pestana se oculta. En movil es obligatorio: si
   * no, sigue sonando en segundo plano y el sistema la termina matando.
   */
  handleVisibility(hidden: boolean): void {
    if (hidden) {
      for (const entry of this.music.values()) entry.el.pause();
      return;
    }
    const current = this.currentMusic ? this.music.get(this.currentMusic) : null;
    if (current && !this.muted) void current.el.play().catch(() => {});
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
  unsubscribes.push(bus.on('card:discarded', () => audio.onDiscarded()));
  return () => {
    for (const off of unsubscribes) off();
  };
}
