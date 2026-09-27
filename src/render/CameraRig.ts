/**
 * CameraRig.ts — Camara con shake y respiracion.
 *
 * El shake es la forma mas barata (y mas efectiva) de comunicar "algo
 * importante acaba de pasar". Se dispara cuando un hongo activa a otro.
 * La amplitud decae exponencialmente, asi que no hace falta un timer.
 */

import * as THREE from 'three';

export class CameraRig {
  readonly camera: THREE.PerspectiveCamera;

  private readonly basePosition = new THREE.Vector3();
  private readonly baseTarget = new THREE.Vector3();
  private readonly currentTarget = new THREE.Vector3();

  private shakeAmplitude = 0;
  private shakeSeed = Math.random() * 1000;
  private breath = 0;

  constructor(aspect: number, fov = 40) {
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

  /** `intensity` ~0.05 sutil, ~0.4 impacto fuerte. */
  addShake(intensity: number): void {
    this.shakeAmplitude = Math.min(0.85, this.shakeAmplitude + intensity);
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
      shakeX = Math.sin(t) * Math.sin(t * 0.37) * this.shakeAmplitude;
      shakeY = Math.cos(t * 1.13) * Math.sin(t * 0.61) * this.shakeAmplitude;
      shakeZ = Math.sin(t * 0.83) * this.shakeAmplitude * 0.5;

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
}
