/**
 * Transition.ts — Transicion de pantalla estilo Balatro.
 *
 * COMO FUNCIONA (dos capas, como en la referencia):
 *
 *   1. SHADER: se captura el frame VIEJO en un `WebGLRenderTarget` (A) y, cada
 *      frame durante la transicion, el frame NUEVO se renderiza a otro target
 *      (B, que es el `readBuffer` del composer). Un quad a pantalla completa
 *      mezcla A -> B con `uProgress` (0 = viejo, 1 = nuevo) usando un ruido
 *      celular (Worley) que CRECE DESDE EL CENTRO. El borde de las manchas se
 *      pinta turquesa y ocre, y el conjunto gira un poco (remolino).
 *
 *   2. PUNCH: durante la transicion se suma pixelado + aberracion cromatica con
 *      una curva `sin(progress * PI)`, o sea maxima en el MEDIO y nula en los
 *      extremos. Es lo que hace que el cambio se sienta fisico y no un fundido.
 *
 * POR QUE UN PASE DEL COMPOSER Y NO UN RENDER APARTE:
 * el juego ya tiene la cadena RenderPass -> Bloom -> Output -> LUT -> Grade. Si
 * la transicion se hiciera por fuera, durante 1,1s se perderia el bloom y el
 * grade de noche y el salto de look seria mas notorio que la propia transicion.
 * Como pase, la mezcla ocurre sobre el color de ESCENA y el resto de la cadena
 * se sigue aplicando igual.
 *
 * En el tier `low` no hay composer (el juego renderiza directo), asi que ahi la
 * transicion se saltea: `playTransition()` no hace nada y el cambio es seco.
 *
 * `prefers-reduced-motion`: se acorta a ~0 (ver `anim.d`), o sea que el estado
 * final se alcanza igual pero sin barrido.
 */

import * as THREE from 'three';
import { FullScreenQuad, Pass } from 'three/examples/jsm/postprocessing/Pass.js';
import * as anim from './anim';

const VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const FRAG = /* glsl */ `
  uniform sampler2D tOld;
  uniform sampler2D tNew;
  uniform float uProgress;
  /** Escala del ruido: mas alto = manchas mas chicas. La referencia usa 7. */
  uniform float uBlob;
  /** Color del borde: turquesa (esporas) y ocre (sustrato). */
  uniform vec3 uEdgeA;
  uniform vec3 uEdgeB;
  uniform float uSwirl;
  /** Tamano del bloque del pixelado en el pico de la transicion. */
  uniform float uPixel;
  uniform vec2 uTexel;
  varying vec2 vUv;

  // Ruido CELULAR (Worley): distancia al punto de feature mas cercano. Da
  // manchas organicas; un circulo perfecto se leeria como un wipe de PowerPoint.
  vec2 hash2(vec2 p) {
    p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
    return fract(sin(p) * 43758.5453123);
  }

  float worley(vec2 p) {
    vec2 n = floor(p);
    vec2 f = fract(p);
    float best = 8.0;
    for (int j = -1; j <= 1; j++) {
      for (int i = -1; i <= 1; i++) {
        vec2 g = vec2(float(i), float(j));
        vec2 o = hash2(n + g);
        vec2 r = g + o - f;
        best = min(best, dot(r, r));
      }
    }
    return sqrt(best);
  }

  void main() {
    vec2 uv = vUv;
    vec2 c = uv - 0.5;

    // REMOLINO: gira mas lejos del centro y menos cuanto mas avanzada esta la
    // transicion. Sin esto el frente avanza recto y se lee como un fade.
    float ang = uSwirl * (1.0 - uProgress) * (0.35 + length(c) * 1.6);
    float sa = sin(ang);
    float ca = cos(ang);
    vec2 suv = vec2(c.x * ca - c.y * sa, c.x * sa + c.y * ca) + 0.5;

    float n = worley(suv * uBlob);
    // El frente nace en el CENTRO: la distancia radial se suma al ruido.
    float d = n + length(c) * 0.95;
    float edge = uProgress * 2.5 - 0.22;

    float w = 0.13;
    float mask = 1.0 - smoothstep(edge - w, edge + w, d);

    // Banda de borde: donde d ronda edge.
    float glow = 1.0 - smoothstep(0.0, 0.20, abs(d - edge));
    vec3 edgeColor = mix(uEdgeA, uEdgeB, smoothstep(0.25, 0.75, n * 1.4));

    // PUNCH: 0 en los extremos, 1 en el medio.
    float punch = sin(uProgress * 3.14159265);
    float px = mix(1.0, uPixel, punch);
    vec2 puv = mix(uv, (floor(uv / uTexel / px) + 0.5) * uTexel * px, punch);

    // IMPACTO: en el ultimo tramo, un zoom con rebote elastico y un temblor
    // corto. Decae a 0 justo en progress=1, o sea que cuando el pase se apaga la
    // imagen YA esta en su sitio: si no, el ultimo frame daria un salto.
    float t = clamp((uProgress - 0.72) / 0.28, 0.0, 1.0);
    float decay = 1.0 - t;
    float zoom = 1.0 - 0.06 * decay * cos(t * 17.0);
    vec2 shake = vec2(sin(t * 61.0), cos(t * 47.0)) * 0.011 * decay;
    vec2 iuv = (puv - 0.5) * zoom + 0.5 + shake;

    // Aberracion cromatica: separa los canales R y B.
    vec2 off = uTexel * 3.0 * punch;
    vec3 oldC = vec3(
      texture2D(tOld, iuv + vec2(off.x, 0.0)).r,
      texture2D(tOld, iuv).g,
      texture2D(tOld, iuv - vec2(off.x, 0.0)).b
    );
    vec3 newC = vec3(
      texture2D(tNew, iuv + vec2(off.x, 0.0)).r,
      texture2D(tNew, iuv).g,
      texture2D(tNew, iuv - vec2(off.x, 0.0)).b
    );

    vec3 col = mix(oldC, newC, mask);
    col += edgeColor * glow * 0.9 * punch;
    gl_FragColor = vec4(col, 1.0);
  }
`;

/** Duracion de la transicion (segundos). La referencia pide 1100ms. */
export const TRANSITION_SECONDS = 1.1;

export class TransitionPass extends Pass {
  private readonly material: THREE.ShaderMaterial;
  private readonly quad: FullScreenQuad;
  /**
   * Frame VIEJO (A). Se captura con un render de la escena a este target justo
   * antes de aplicar el cambio de estado.
   */
  private readonly oldTarget: THREE.WebGLRenderTarget;
  private tween: gsap.core.Tween | null = null;
  private size = new THREE.Vector2(1, 1);

  constructor(width: number, height: number) {
    super();
    // Media resolucion a proposito: es una textura de PANTALLA que se ve durante
    // ~1s y por detras del ruido. A resolucion completa seria un cuarto del
    // costo de memoria para una diferencia invisible.
    this.oldTarget = new THREE.WebGLRenderTarget(Math.max(1, width), Math.max(1, height), {
      type: THREE.HalfFloatType,
      depthBuffer: false,
      stencilBuffer: false,
    });
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: {
        tOld: { value: this.oldTarget.texture },
        tNew: { value: null },
        uProgress: { value: 0 },
        uBlob: { value: 7.0 },
        uEdgeA: { value: new THREE.Color(0x5fd8e8) },
        uEdgeB: { value: new THREE.Color(0xf2a63b) },
        uSwirl: { value: 0.55 },
        uPixel: { value: 5.0 },
        uTexel: { value: new THREE.Vector2(1 / 1280, 1 / 720) },
      },
      depthTest: false,
      depthWrite: false,
    });
    this.quad = new FullScreenQuad(this.material);
    // Arranca apagado: el composer lo saltea hasta que hay una transicion viva.
    this.enabled = false;
  }

  override setSize(width: number, height: number): void {
    this.size.set(width, height);
    this.oldTarget.setSize(Math.max(1, Math.floor(width)), Math.max(1, Math.floor(height)));
    (this.material.uniforms['uTexel']!.value as THREE.Vector2).set(
      1 / Math.max(1, width),
      1 / Math.max(1, height),
    );
  }

  get running(): boolean {
    return this.enabled === true;
  }

  /** Avance del barrido (0 = frame viejo, 1 = frame nuevo). La UI lo lee para
   *  sincronizar el HUD por CSS. */
  get progress(): number {
    return this.material.uniforms['uProgress']!.value as number;
  }

  /**
   * Captura el frame actual y arranca el barrido.
   *
   * El render de captura tiene que ocurrir ANTES de que el estado cambie, asi
   * que `SceneManager` lo llama antes de mutar el motor.
   */
  begin(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, seconds: number): void {
    this.tween?.kill();
    const prev = renderer.getRenderTarget();
    renderer.setRenderTarget(this.oldTarget);
    renderer.clear();
    renderer.render(scene, camera);
    renderer.setRenderTarget(prev);

    const u = this.material.uniforms['uProgress']!;
    u.value = 0;
    this.enabled = true;
    this.tween = anim.tweenOf(u, {
      value: 1,
      duration: anim.d(seconds),
      ease: anim.EASE.linear,
      onComplete: () => {
        this.enabled = false;
        this.tween = null;
      },
    });
  }

  /** Corta la transicion y deja el frame NUEVO (por si hay que saltarla). */
  cancel(): void {
    this.tween?.kill();
    this.tween = null;
    this.enabled = false;
  }

  override render(
    renderer: THREE.WebGLRenderer,
    writeBuffer: THREE.WebGLRenderTarget,
    readBuffer: THREE.WebGLRenderTarget,
  ): void {
    this.material.uniforms['tNew']!.value = readBuffer.texture;

    if (this.renderToScreen) {
      renderer.setRenderTarget(null);
    } else {
      renderer.setRenderTarget(writeBuffer);
      if (!this.needsSwap) renderer.clear();
    }
    this.quad.render(renderer);
  }

  override dispose(): void {
    this.tween?.kill();
    this.oldTarget.dispose();
    this.material.dispose();
    this.quad.dispose();
  }
}
