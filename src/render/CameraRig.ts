/**
 * CameraRig.ts — Camara con shake y respiracion.
 *
 * El shake es la forma mas barata (y mas efectiva) de comunicar "algo
 * importante acaba de pasar". Se dispara cuando un hongo activa a otro.
 * La amplitud decae exponencialmente, asi que no hace falta un timer.
 *
 * El shake puede ser DIRECCIONAL (V4): el eje del combo que lo dispara dice
 * hacia donde golpea. Un combo de elemento barre en horizontal, uno de familia
 * empuja en vertical. Sin direccion (el caso de todos los sacudones antiguos)
 * el ruido es isotropico, igual que siempre.
 */

import * as THREE from 'three';

/** Eje del combo que dispara el shake. Espejo de `comboOf` (SceneManager). */
export type ShakeAxis = 'element' | 'family' | 'diversity';

/**
 * Hacia donde golpea la camara segun el eje del combo:
 *   elemento (× Esporas)  -> HORIZONTAL: multiplicar es "ancho";
 *   familia  (+ Sustrato) -> VERTICAL: sumar sustrato es "alto";
 *   diversidad            -> DIAGONAL: no es ni ancho ni alto, es repartido.
 *
 * Es pura y esta exportada para poder testearla sin navegador.
 */
export function axisShakeDir(axis: ShakeAxis): { x: number; y: number } {
  if (axis === 'element') return { x: 1, y: 0 };
  if (axis === 'family') return { x: 0, y: 1 };
  return { x: 0.7, y: 0.7 };
}

export class CameraRig {
  readonly camera: THREE.PerspectiveCamera;

  private readonly basePosition = new THREE.Vector3();
  private readonly baseTarget = new THREE.Vector3();
  private readonly currentTarget = new THREE.Vector3();

  private shakeAmplitude = 0;
  /**
   * Semilla del ruido del shake. En produccion es aleatoria (dos partidas no
   * deberian temblar igual); los tests la fijan para poder medir. No es RNG
   * del motor: el shake es puramente cosmético y no toca ninguna regla.
   */
  private shakeSeed: number;
  /** Direccion del ultimo golpe (-1..1 por eje). 0,0 = shake neutro. */
  private shakeDirX = 0;
  private shakeDirY = 0;
  /** Fase de la oscilacion direccional: avanza solo mientras hay golpe. */
  private shakePhase = 0;
  private breath = 0;
  /**
   * Espejo de `reduceMotion` (V5). El shake es movimiento subito de camara:
   * el mismo tipo de efecto que la gente pide apagar, asi que se ignora igual
   * que `hitStop` (ver `SceneManager.hitStop`). El gate va ACA y no en los ~14
   * call sites: los sacudones viejos tampoco lo respetaban y asi queda cerrado
   * para siempre. La respiracion NO se toca: es un vaiven lentisimo, no un golpe.
   */
  private reduced = false;

  constructor(aspect: number, fov = 40, shakeSeed = Math.random() * 1000) {
    this.shakeSeed = shakeSeed;
    this.camera = new THREE.PerspectiveCamera(fov, aspect, 0.1, 200);
    // Angulo de ~54 grados sobre la mesa: suficiente para leer las cartas y
    // bastante alto para que la profundidad no se estire de mas en pantalla.
    this.camera.position.set(0, 15, 11);
    this.basePosition.copy(this.camera.position);
    // El objetivo esta corrido hacia la mano (+Z) a proposito: el HUD inferior
    // ocupa ~14% de la pantalla, y sin este sesgo la mano queda debajo de el.
    this.baseTarget.set(0, 0, 1.6);
    this.currentTarget.copy(this.baseTarget);
    this.camera.lookAt(this.currentTarget);
  }

  setBase(position: THREE.Vector3, target: THREE.Vector3): void {
    this.basePosition.copy(position);
    this.baseTarget.copy(target);
  }

  /**
   * `setBase` cambia la direccion de vista: el `fit` la conserva al reencuadrar,
   * solo corre la camara a lo largo de la recta. Por eso el carrusel puede
   * tomar la base para su encuadre frontal: al cerrar hay que DEVOLVERLA.
   * `snapshotBase`/`restoreBase` guardan y restablecen la base sin que el
   * caller tenga que conocer la posicion ni el objetivo.
   */
  snapshotBase(): { position: THREE.Vector3; target: THREE.Vector3 } {
    return {
      position: this.basePosition.clone(),
      target: this.baseTarget.clone(),
    };
  }

  restoreBase(snapshot: { position: THREE.Vector3; target: THREE.Vector3 }): void {
    this.basePosition.copy(snapshot.position);
    this.baseTarget.copy(snapshot.target);
  }

  /**
   * `intensity` ~0.05 sutil, ~0.4 impacto fuerte.
   *
   * `dx`/`dy` (-1..1) sesgan el golpe hacia ese eje: el eje del combo se lleva
   * el ruido completo y el perpendicular se queda con un 25% de sombra. Con
   * 0,0 (todos los sacudones anteriores) el shake es el de siempre.
   *
   * Con `reduceMotion` no hace nada (ver `setReducedMotion`).
   */
  addShake(intensity: number, dx = 0, dy = 0): void {
    if (this.reduced) return;
    this.shakeAmplitude = Math.min(0.85, this.shakeAmplitude + intensity);
    // La direccion la manda el ultimo golpe: si se superponen dos de ejes
    // distintos, el mas reciente es el que se esta viendo.
    this.shakeDirX = dx;
    this.shakeDirY = dy;
  }

  /** Espejo de `reduceMotion`: apaga el shake (no la respiracion). */
  setReducedMotion(value: boolean): void {
    this.reduced = value;
    // Si se prende con un golpe a medio decaer, se corta en seco: dejarlo
    // terminar seria media sacudida prohibida.
    if (value) this.shakeAmplitude = 0;
  }

  update(dt: number, time: number): void {
    // Respiracion: movimiento lentisimo para que la escena nunca este muerta.
    this.breath += dt;
    const breathX = Math.sin(this.breath * 0.35) * 0.16;
    const breathY = Math.cos(this.breath * 0.27) * 0.1;

    let shakeX = 0;
    let shakeY = 0;
    let shakeZ = 0;

    if (this.shakeAmplitude > 0.0005) {
      // Ruido barato pero convincente: senos de frecuencias inconmensurables.
      const t = time * 46 + this.shakeSeed;
      // Sesgo por direccion: sin direccion el ruido es isotropico (el shake de
      // siempre); con direccion, el eje del combo se lleva el 100% y el
      // perpendicular se queda con un 25% de sombra. Sin esto, un golpe
      // "horizontal" sacudiria igual en los dos ejes y no se leeria como
      // direccion, solo como mas de lo mismo.
      const hasDir = this.shakeDirX !== 0 || this.shakeDirY !== 0;
      const wx = hasDir ? 0.25 + 0.75 * Math.abs(this.shakeDirX) : 1;
      const wy = hasDir ? 0.25 + 0.75 * Math.abs(this.shakeDirY) : 1;
      shakeX = Math.sin(t) * Math.sin(t * 0.37) * this.shakeAmplitude * wx;
      shakeY = Math.cos(t * 1.13) * Math.sin(t * 0.61) * this.shakeAmplitude * wy;
      shakeZ = Math.sin(t * 0.83) * this.shakeAmplitude * 0.5;

      // Componente DIRECCIONAL: una oscilacion amortiguada a lo largo del eje
      // del combo. El ruido de arriba dice "tiembla"; esta dice "tiembla HACIA
      // alla". Comparte la amplitud, asi que decae con el resto del golpe.
      this.shakePhase += dt;
      const dirOsc = Math.sin(this.shakePhase * 26) * this.shakeAmplitude * 0.55;
      shakeX += dirOsc * this.shakeDirX;
      shakeY += dirOsc * this.shakeDirY;

      // Decaimiento exponencial independiente del framerate.
      this.shakeAmplitude *= Math.exp(-dt * 5.2);
    } else {
      this.shakeAmplitude = 0;
    }

    this.camera.position.set(
      this.basePosition.x + breathX + shakeX,
      this.basePosition.y + breathY + shakeY,
      this.basePosition.z + shakeZ,
    );

    // El objetivo tambien tiembla un poco: si no, el shake se lee como zoom.
    this.currentTarget.set(
      this.baseTarget.x + shakeX * 0.35,
      this.baseTarget.y + shakeY * 0.35,
      this.baseTarget.z,
    );
    this.camera.lookAt(this.currentTarget);
  }

  resize(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  /**
   * Ajusta el encuadre para que el contenido entre en cuadro, sea un iPad en
   * landscape (1.33) o un celular (2.2).
   *
   * Se mueve la camara a lo largo de su propia direccion de vista: el angulo y
   * el encuadre no cambian, solo la distancia.
   *
   * `biasZ` es la clave para landscape de celular: el HUD ocupa la franja
   * inferior, asi que la vista NO se centra en el contenido sino corrida hacia
   * la mano. Sin esto, las cartas quedan debajo de la barra de botones.
   */
  fit(
    aspect: number,
    bounds: { topZ: number; bottomZ: number; width: number },
    biasZ: number,
  ): void {
    const halfFov = (this.camera.fov * Math.PI) / 180 / 2;
    const tanHalf = Math.tan(halfFov);

    // Alto necesario: cubre el contenido MAS el corrimiento del centro.
    const halfHeight = Math.max(bounds.topZ - biasZ, biasZ - bounds.bottomZ);
    const requiredHeight = halfHeight * 2 * 1.04;
    const requiredWidth = bounds.width * 1.04;

    const distForWidth = requiredWidth / aspect / (2 * tanHalf);
    const distForHeight = requiredHeight / (2 * tanHalf);
    const distance = Math.max(distForWidth, distForHeight, 8);

    this.baseTarget.set(0, 0, biasZ);
    const direction = new THREE.Vector3()
      .subVectors(this.basePosition, this.baseTarget)
      .normalize();

    this.basePosition.copy(this.baseTarget).addScaledVector(direction, distance);
    this.camera.position.copy(this.basePosition);
  }

  get shake(): number {
    return this.shakeAmplitude;
  }

  /** Direccion del golpe actual (-1..1 por eje). 0,0 = neutro. */
  get shakeDir(): { x: number; y: number } {
    return { x: this.shakeDirX, y: this.shakeDirY };
  }
}
