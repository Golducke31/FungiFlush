/**
 * Tween.ts — Motor de interpolacion propio para los tweens SIMPLES por frame.
 *
 * LIMITE (integracion hibrida): este motor sigue siendo el dueno de los tweens
 * de posicion/rotacion que corren todos a la vez (~200 con la mano llena),
 * donde importa el control del orden de update dentro del requestAnimationFrame
 * y no asignar por frame. Lo que NO sabe hacer —secuencias, stagger, arcos y el
 * DOM/UI— vive en `anim.ts` sobre GSAP. Ver ese archivo para la frontera.
 *
 * Soporta rutas con punto: tween.to(card.group, { 'position.x': 3 }, {...})
 */

export type EasingFn = (t: number) => number;

export const Easing = {
  linear: (t: number) => t,
  quadIn: (t: number) => t * t,
  quadOut: (t: number) => t * (2 - t),
  cubicOut: (t: number) => 1 - (1 - t) ** 3,
  cubicInOut: (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2),
  quartOut: (t: number) => 1 - (1 - t) ** 4,
  expoOut: (t: number) => (t >= 1 ? 1 : 1 - 2 ** (-10 * t)),
  backOut: (t: number) => {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2;
  },
  elasticOut: (t: number) => {
    if (t === 0 || t === 1) return t;
    const c4 = (2 * Math.PI) / 3;
    return 2 ** (-10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1;
  },
} as const;

export type EaseName = keyof typeof Easing;

export interface TweenOptions {
  duration?: number;
  delay?: number;
  ease?: EaseName | EasingFn;
  onUpdate?: (progress: number) => void;
  onComplete?: () => void;
}

export interface TweenHandle {
  cancel(): void;
  readonly active: boolean;
}

interface Tween {
  target: Record<string, unknown>;
  props: Array<{ path: string[]; from: number; to: number }>;
  elapsed: number;
  delay: number;
  duration: number;
  ease: EasingFn;
  onUpdate?: (progress: number) => void;
  onComplete?: () => void;
  cancelled: boolean;
}

function getPath(target: Record<string, unknown>, path: string[]): unknown {
  let node: unknown = target;
  for (const key of path) {
    if (typeof node !== 'object' || node === null) return undefined;
    node = (node as Record<string, unknown>)[key];
  }
  return node;
}

function setPath(target: Record<string, unknown>, path: string[], value: number): void {
  let node: Record<string, unknown> = target;
  for (let i = 0; i < path.length - 1; i++) {
    const key = path[i];
    if (key === undefined) return;
    const next = node[key];
    if (typeof next !== 'object' || next === null) return;
    node = next as Record<string, unknown>;
  }
  const last = path[path.length - 1];
  if (last !== undefined) node[last] = value;
}

export class TweenManager {
  private tweens: Tween[] = [];
  /** Multiplicador de duracion. 1 = normal; 0.001 = reduceMotion (al toque). */
  private speed = 1;

  /**
   * Espejo del CSS de reduceMotion: se ACORTA la duracion en vez de anular el
   * tween, para que el estado final siempre se alcance y `onComplete` dispare.
   */
  setReduceMotion(value: boolean): void {
    this.speed = value ? 0.001 : 1;
  }

  /**
   * Anima propiedades numericas de un objeto.
   * `props` usa rutas con punto: { 'position.x': 4, 'rotation.y': Math.PI }
   */
  to(
    target: object,
    props: Record<string, number>,
    options: TweenOptions = {},
  ): TweenHandle {
    const record = target as Record<string, unknown>;
    const resolved: Tween['props'] = [];

    for (const [key, to] of Object.entries(props)) {
      const path = key.split('.');
      const from = getPath(record, path);
      if (typeof from !== 'number') continue;
      resolved.push({ path, from, to });
    }

    const tween: Tween = {
      target: record,
      props: resolved,
      elapsed: 0,
      delay: (options.delay ?? 0) * this.speed,
      duration: Math.max(0.0001, (options.duration ?? 0.4) * this.speed),
      ease: typeof options.ease === 'function' ? options.ease : Easing[options.ease ?? 'cubicOut'],
      cancelled: false,
      ...(options.onUpdate ? { onUpdate: options.onUpdate } : {}),
      ...(options.onComplete ? { onComplete: options.onComplete } : {}),
    };

    this.tweens.push(tween);

    return {
      cancel: () => {
        tween.cancelled = true;
      },
      get active() {
        return !tween.cancelled && tween.elapsed < tween.delay + tween.duration;
      },
    };
  }

  /** Cancela todos los tweens que afecten a un target (al reordenar la mano). */
  cancelFor(target: object): void {
    for (const tween of this.tweens) {
      if (tween.target === (target as Record<string, unknown>)) tween.cancelled = true;
    }
  }

  /** Fuerza la finalizacion inmediata (al cambiar de estado, para no dejar cartas a mitad de camino). */
  completeAll(): void {
    for (const tween of this.tweens) {
      if (tween.cancelled) continue;
      tween.elapsed = tween.delay + tween.duration;
      this.apply(tween, 1);
      tween.onComplete?.();
      tween.cancelled = true;
    }
    this.tweens.length = 0;
  }

  update(dt: number): void {
    if (this.tweens.length === 0) return;
    const alive: Tween[] = [];

    for (const tween of this.tweens) {
      if (tween.cancelled) continue;

      tween.elapsed += dt;
      if (tween.elapsed < tween.delay) {
        alive.push(tween);
        continue;
      }

      const raw = (tween.elapsed - tween.delay) / tween.duration;
      const t = Math.min(1, raw);
      const eased = tween.ease(t);

      this.apply(tween, eased);
      tween.onUpdate?.(t);

      if (t >= 1) {
        tween.onComplete?.();
      } else {
        alive.push(tween);
      }
    }

    this.tweens.length = 0;
    this.tweens.push(...alive);
  }

  private apply(tween: Tween, eased: number): void {
    for (const prop of tween.props) {
      setPath(tween.target, prop.path, prop.from + (prop.to - prop.from) * eased);
    }
  }

  get activeCount(): number {
    return this.tweens.length;
  }
}
