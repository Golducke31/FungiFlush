/**
 * VictoryFx.ts — Presets del efecto de victoria (recompensa `victory_fx`).
 *
 * DATOS puros: el `SceneManager` los consume al celebrar un Ciego superado.
 * `default` reproduce EXACTAMENTE lo que el juego hacia antes (verde + dorado,
 * dos oleadas escalonadas), asi que un perfil sin la recompensa no cambia nada.
 * Un cosmetico nuevo es una entrada mas en este mapa.
 *
 * INVARIANTE: esto es SOLO color / cantidad de particulas / shake. No toca la
 * puntuacion, ni el RNG del motor, ni el orden de resolucion de la mano.
 */

export interface VictoryFxPreset {
  /** Color de cada oleada (se cicla si hay mas oleadas que colores). */
  colors: number[];
  /** Particulas por oleada, en [movil, escritorio]. */
  counts: Array<[number, number]>;
  /** Fuerza del shake de camara. */
  shake: number;
}

export const VICTORY_FX_PRESETS: Readonly<Record<string, VictoryFxPreset>> = {
  default: {
    colors: [0x4fd18b, 0xffc857],
    counts: [
      [70, 130],
      [40, 70],
    ],
    shake: 0.32,
  },
  // "Eclosion Dorada": tres oleadas calidas, un poco mas de shake.
  victory_fx: {
    colors: [0xffd36b, 0xff8f3f, 0xfff3c4],
    counts: [
      [90, 160],
      [55, 95],
      [30, 55],
    ],
    shake: 0.4,
  },
};

/** Preset de `id`, o el `default` si el id no existe (nunca `undefined`). */
export function victoryFxPreset(id: string): VictoryFxPreset {
  return VICTORY_FX_PRESETS[id] ?? VICTORY_FX_PRESETS['default']!;
}
