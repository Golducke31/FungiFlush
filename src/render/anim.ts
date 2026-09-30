/**
 * anim.ts — Capa de animacion ORQUESTADA sobre GSAP (integracion hibrida).
 *
 * Por que hibrida y no un reemplazo: `Tween.ts` sigue siendo el motor de los
 * tweens simples y simultaneos (posicion/rotacion de cada carta), donde importa
 * el control del orden de update y no asignar por frame. GSAP se ocupa de lo
 * que ese motor no sabe hacer: SECUENCIAS (timelines), stagger, arcos y el
 * DOM/UI. El limite esta documentado en el header de `Tween.ts`.
 *
 * REGLA CRITICA — UN SOLO RELOJ: GSAP NO usa su propio rAF. Se le quita el
 * ticker y se lo conduce desde el bucle de `SceneManager` con el MISMO `dt`
 * acotado (0.05) que ya usa `TweenManager`. Si GSAP corriera con su propio
 * reloj (tiempo real), las animaciones irian a distinta velocidad que el resto
 * segun el FPS, y ademas se aplicarian DESPUES del render (un frame de atraso).
 *
 * El tiempo es un acumulador MONOTONO propio (`time += dt`), no `SceneManager
 * .clock` (que se resetea a 0 en `start()`) ni `performance.now()`.
 */

import { gsap } from 'gsap';

/**
 * Curvas del proyecto mapeadas a GSAP. Los nombres de la izquierda son los de
 * `Tween.Easing`; asi el vocabulario de animacion es uno solo.
 */
export const EASE = {
  linear: 'none',
  quadIn: 'power1.in',
  quadOut: 'power1.out',
  cubicOut: 'power2.out',
  cubicInOut: 'power2.inOut',
  quartOut: 'power3.out',
  expoOut: 'expo.out',
  backOut: 'back.out(1.7)',
  elasticOut: 'elastic.out(1, 0.3)',
  /** Equivalentes de los tokens CSS `--ease-out` / `--ease-back`. */
  cssOut: 'power4.out',
  cssBack: 'back.out(1.7)',
} as const;

/** Tiempo acumulado con dt acotado (segundos). Nunca retrocede. */
let time = 0;
/** Espejo de `prefers-reduced-motion` / `settings.reduceMotion`. */
let reduce = false;
/** Timelines vivas, solo para el contador del panel de debug (F3). */
const tracked = new Set<gsap.core.Timeline>();

function initAnim(): void {
  // GSAP deja de tener su propio rAF: lo mueve `updateAnim(dt)` desde el loop.
  gsap.ticker.remove(gsap.updateRoot);
  // Espejo de TweenManager: dos tweens sobre la misma propiedad del mismo
  // target se pisan, y gana el ultimo en crearse.
  gsap.defaults({ overwrite: 'auto' });
}
initAnim();

/** Avanza el reloj de GSAP. Se llama UNA vez por frame, antes del render. */
export function updateAnim(dt: number): void {
  time += dt;
  gsap.updateRoot(time);
}

export function setReduceMotion(value: boolean): void {
  reduce = value;
}

export function reduceMotion(): boolean {
  return reduce;
}

/**
 * Duracion ya escalada por reduceMotion. Espejo exacto de la regla CSS
 * (`animation-duration: .001ms`), que acorta en vez de anular para que el
 * estado FINAL siempre se alcance y los `onComplete` disparen.
 */
export function d(seconds: number): number {
  return reduce ? 0.001 : seconds;
}

/** Crea una timeline registrada (para `activeCount`). */
export function sequence(vars?: gsap.TimelineVars): gsap.core.Timeline {
  const tl = gsap.timeline(vars);
  tracked.add(tl);
  void tl.then(() => tracked.delete(tl));
  return tl;
}

/** Tween suelto sobre un target (paridad con `TweenManager.to`). */
export function tweenOf<T extends object>(target: T, vars: gsap.TweenVars): gsap.core.Tween {
  return gsap.to(target, vars);
}

/**
 * Paridad con `TweenManager.cancelFor`: mata todo lo que mueva a `target`,
 * incluidos los tweens anidados en timelines (GSAP los alcanza). Es lo que
 * evita que una secuencia vieja pelee con el dedo durante el arrastre o
 * escriba sobre una carta ya dispuesta.
 */
export function killOf(target: object | object[]): void {
  gsap.killTweensOf(target);
}

/**
 * Mata solo los tweens de UNA propiedad de un target.
 *
 * Es lo que necesita el GIRO: cancelar todo lo que mueve la carta (posicion
 * incluida) al darla vuelta seria un efecto colateral.
 */
export function killOfProp(target: object | object[], prop: string): void {
  gsap.killTweensOf(target, prop);
}

/** Corta TODA la animacion sin disparar callbacks (al cerrar la escena). */
export function killAll(): void {
  gsap.globalTimeline.clear();
  tracked.clear();
}

/** Animaciones vivas de nivel superior (tweens + timelines). */
export function activeCount(): number {
  return gsap.globalTimeline.getChildren(false, true, true).length;
}

export function now(): number {
  return time;
}

/**
 * Solo para cuando el rAF propio esta detenido (p. ej. `SceneManager.stop()`)
 * y la UI sigue viva: GSAP vuelve a su ticker para no congelar el DOM.
 * Mientras el loop corre, el reloj lo manda `updateAnim`.
 */
export function startExternal(): void {
  gsap.ticker.add(gsap.updateRoot);
}

export function stopExternal(): void {
  gsap.ticker.remove(gsap.updateRoot);
}
