/**
 * PostFx.ts — Post-procesamiento: bloom selectivo + grade de color.
 *
 * POR QUE UN BLOOM PROPIO Y NO `UnrealBloomPass`
 * ----------------------------------------------
 * `UnrealBloomPass` hace 5 niveles de mip y dos pasadas de blur por nivel: ~13
 * pases a media resolucion o mas. En una GPU de escritorio es gratis; en un
 * celular de gama media es la diferencia entre 60 y 25 FPS. Aca el bloom es de
 * CUATRO pases y tres de ellos a un cuarto de resolucion:
 *
 *     RenderPass (HDR) → Bright → BlurH → BlurV → Composite → Output → LUT → Grade
 *
 * El ahorro grande no es la cantidad de pases sino que el blur corre a ¼ de
 * resolucion: el ancho de banda de un blur separable escala con los pixeles.
 *
 * POR QUE EL BLOOM NO SE COME LA MESA
 * -----------------------------------
 * El umbral es de LUMINANCIA (0.70) y el bloom se calcula sobre el buffer HDR
 * ANTES del tone mapping. En espacio lineal el fondo de la mesa esta en
 * ~0.005-0.08 y el cian de un hongo en ~0.7-0.8: el bloom no puede levantarlo
 * ni queriendo. El modo de falla "el bloom se come todo" solo aparece con
 * umbrales por debajo de 0.3.
 *
 * EL TONE MAPPING VIVE EN `OutputPass`
 * ------------------------------------
 * Con el composer, `OutputPass` aplica ACES + exposure + sRGB UNA sola vez, al
 * final, y todo el cuadro queda bien codificado.
 *
 * Antes (D2) los materiales propios de `Shaders.ts` no incluian los chunks de
 * salida, asi que escribian valores lineales en un framebuffer sRGB y en `low`
 * se veian MAS OSCUROS que en `medium`. Ahora los incluyen y eso los deja
 * correctos en los dos caminos sin ramas de codigo: el renderer solo define
 * `TONE_MAPPING` cuando dibuja al canvas (con el composer el destino es un
 * render target), y `linearToOutputTexel` es la identidad en ese mismo caso.
 * O sea: en `medium`/`high` los chunks son no-ops y en `low` hacen el trabajo.
 */

import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { FullScreenQuad, Pass } from 'three/examples/jsm/postprocessing/Pass.js';
import { LUTPass } from 'three/examples/jsm/postprocessing/LUTPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { createNightLut } from './Lut';
import { TransitionPass } from './Transition';

// ---------------------------------------------------------------------------
// Shaders de los pases propios
// ---------------------------------------------------------------------------

const FULLSCREEN_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

/**
 * Aisla lo brillante. `uKnee` es la rodilla: sin ella el corte del umbral se ve
 * como un contorno duro en las zonas de degradado.
 */
const BRIGHT_FRAG = /* glsl */ `
  uniform sampler2D tDiffuse;
  uniform float uThreshold;
  uniform float uKnee;
  varying vec2 vUv;

  void main() {
    vec3 c = texture2D(tDiffuse, vUv).rgb;
    float luma = dot(c, vec3(0.2126, 0.7152, 0.0722));
    float w = smoothstep(uThreshold, uThreshold + uKnee, luma);
    gl_FragColor = vec4(c * w, 1.0);
  }
`;

/** Gaussiana separable de 9 muestras, desenrollada para no depender de arrays. */
const BLUR_FRAG = /* glsl */ `
  uniform sampler2D tDiffuse;
  uniform vec2 uDirection;
  varying vec2 vUv;

  void main() {
    vec3 sum = texture2D(tDiffuse, vUv).rgb * 0.2270270270;
    sum += texture2D(tDiffuse, vUv + uDirection * 1.0).rgb * 0.1945945946;
    sum += texture2D(tDiffuse, vUv - uDirection * 1.0).rgb * 0.1945945946;
    sum += texture2D(tDiffuse, vUv + uDirection * 2.0).rgb * 0.1216216216;
    sum += texture2D(tDiffuse, vUv - uDirection * 2.0).rgb * 0.1216216216;
    sum += texture2D(tDiffuse, vUv + uDirection * 3.0).rgb * 0.0540540541;
    sum += texture2D(tDiffuse, vUv - uDirection * 3.0).rgb * 0.0540540541;
    sum += texture2D(tDiffuse, vUv + uDirection * 4.0).rgb * 0.0162162162;
    sum += texture2D(tDiffuse, vUv - uDirection * 4.0).rgb * 0.0162162162;
    gl_FragColor = vec4(sum, 1.0);
  }
`;

/**
 * Vignette + grano. Corre AL FINAL, despues de `OutputPass`, o sea en espacio
 * de pantalla: el grano se autoriza en display porque es ahi donde se juzga
 * ("se ve sucio" o "no se ve"), y hacerlo en lineal obligaria a re-tocar la
 * intensidad cada vez que cambie el tone mapping.
 *
 * No incluye los chunks de salida por la misma razon: a esta altura el cuadro
 * YA esta codificado por `OutputPass` (que es un `RawShaderMaterial` con
 * `SRGB_TRANSFER` fijo), y volver a codificarlo lo lavaria.
 */
const GRADE_FRAG = /* glsl */ `
  uniform sampler2D tDiffuse;
  uniform float uAmount;
  uniform float uTime;
  uniform vec2 uTexel;
  varying vec2 vUv;

  // Hash barato. El grano tiene que ser ruido POR PIXEL: una textura de ruido
  // se repetiria en cuanto el cuadro se agrande, y ademas costaria una subida
  // mas a la GPU.
  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
  }

  void main() {
    vec4 c = texture2D(tDiffuse, vUv);

    // Vignette: la distancia se normaliza a la esquina (0.5 * raiz de 2) para
    // que el oscurecido llegue justo al borde y no antes.
    float d = length(vUv - 0.5) * 1.4142;
    float vig = 1.0 - smoothstep(0.55, 1.0, d) * 0.55 * uAmount;

    // El grano se suma en luminancia y no por canal: teñirlo por canal se lee
    // como ruido de sensor barato, y aca tiene que parecer pelicula.
    float n = hash(vUv / max(uTexel, vec2(1e-5)) + uTime) - 0.5;
    c.rgb = c.rgb * vig + n * 0.045 * uAmount;

    gl_FragColor = c;
  }
`;

/**
 * Suma el bloom sobre la escena. Se hace ANTES del tone mapping y en espacio
 * lineal: es lo que hace que el resplandor se comporte como luz y no como un
 * velo pegado encima de la imagen.
 */
const COMPOSITE_FRAG = /* glsl */ `
  uniform sampler2D tDiffuse;
  uniform sampler2D tBloom;
  uniform float uStrength;
  varying vec2 vUv;

  void main() {
    vec3 base = texture2D(tDiffuse, vUv).rgb;
    vec3 bloom = texture2D(tBloom, vUv).rgb;
    gl_FragColor = vec4(base + bloom * uStrength, 1.0);
  }
`;

// ---------------------------------------------------------------------------
// Pases
// ---------------------------------------------------------------------------

/**
 * Guarda cuantos draw calls hizo la ESCENA, antes de que los pases de pantalla
 * completa ensucien el contador de `renderer.info`.
 *
 * `EffectComposer` llama a `renderer.render()` una vez por pase, asi que con
 * `info.autoReset` apagado el total acumulado incluiria los 6 quads del
 * post-procesamiento. El numero util para detectar una regresion es el de la
 * escena, y hay que tomarlo justo despues del `RenderPass`.
 */
class SnapshotPass extends Pass {
  constructor(private readonly take: () => number) {
    super();
    this.needsSwap = false;
    this.enabled = true;
  }

  render(): void {
    this.take();
  }
}

/**
 * Bloom selectivo de 4 pases a ¼ de resolucion.
 *
 * Los render targets son propios y a un cuarto: el blur cuesta 1/16 de lo que
 * costaria a resolucion completa, y como el resultado se suma desenfocado, la
 * perdida de detalle es invisible.
 */
class BloomPass extends Pass {
  private readonly bright: THREE.ShaderMaterial;
  private readonly blur: THREE.ShaderMaterial;
  private readonly composite: THREE.ShaderMaterial;
  private readonly quad: FullScreenQuad;

  private readonly rtBright: THREE.WebGLRenderTarget;
  private readonly rtBlurA: THREE.WebGLRenderTarget;
  private readonly rtBlurB: THREE.WebGLRenderTarget;
  private readonly texel = new THREE.Vector2();

  constructor(
    private readonly options: {
      iterations: number;
      strength: number;
      threshold: number;
      knee: number;
    },
  ) {
    super();

    this.bright = new THREE.ShaderMaterial({
      vertexShader: FULLSCREEN_VERT,
      fragmentShader: BRIGHT_FRAG,
      uniforms: {
        tDiffuse: { value: null },
        uThreshold: { value: options.threshold },
        uKnee: { value: options.knee },
      },
      depthTest: false,
      depthWrite: false,
    });

    this.blur = new THREE.ShaderMaterial({
      vertexShader: FULLSCREEN_VERT,
      fragmentShader: BLUR_FRAG,
      uniforms: {
        tDiffuse: { value: null },
        uDirection: { value: new THREE.Vector2() },
      },
      depthTest: false,
      depthWrite: false,
    });

    this.composite = new THREE.ShaderMaterial({
      vertexShader: FULLSCREEN_VERT,
      fragmentShader: COMPOSITE_FRAG,
      uniforms: {
        tDiffuse: { value: null },
        tBloom: { value: null },
        uStrength: { value: options.strength },
      },
      depthTest: false,
      depthWrite: false,
    });

    this.quad = new FullScreenQuad(this.bright);

    // HalfFloat en los tres: el bloom se calcula sobre valores HDR. Con
    // UnsignedByte se recortaria todo lo que pase de 1.0 y el glow de las
    // legendarias (que es justo lo que hay que bloomear) perderia el nucleo.
    const rtOptions: THREE.RenderTargetOptions = {
      type: THREE.HalfFloatType,
      depthBuffer: false,
      stencilBuffer: false,
    };
    this.rtBright = new THREE.WebGLRenderTarget(1, 1, rtOptions);
    this.rtBlurA = new THREE.WebGLRenderTarget(1, 1, rtOptions);
    this.rtBlurB = new THREE.WebGLRenderTarget(1, 1, rtOptions);
  }

  /** Fuerza del bloom en vivo (la usa el pulso de cierre del combo). */
  setStrength(value: number): void {
    const u = this.composite.uniforms.uStrength;
    if (u) u.value = value;
  }

  override setSize(width: number, height: number): void {
    const w = Math.max(1, Math.floor(width / 4));
    const h = Math.max(1, Math.floor(height / 4));
    this.rtBright.setSize(w, h);
    this.rtBlurA.setSize(w, h);
    this.rtBlurB.setSize(w, h);
    this.texel.set(1 / w, 1 / h);
  }

  override render(
    renderer: THREE.WebGLRenderer,
    writeBuffer: THREE.WebGLRenderTarget,
    readBuffer: THREE.WebGLRenderTarget,
  ): void {
    // --- 1. Aislar lo brillante a ¼ de resolucion ---
    this.bright.uniforms['tDiffuse']!.value = readBuffer.texture;
    this.quad.material = this.bright;
    renderer.setRenderTarget(this.rtBright);
    this.quad.render(renderer);

    // --- 2. Blur separable, ping-pong entre los dos buffers ---
    let source = this.rtBright;
    let target = this.rtBlurA;

    for (let i = 0; i < Math.max(1, this.options.iterations); i++) {
      this.blur.uniforms['tDiffuse']!.value = source.texture;
      (this.blur.uniforms['uDirection']!.value as THREE.Vector2).set(this.texel.x, 0);
      this.quad.material = this.blur;
      renderer.setRenderTarget(target);
      this.quad.render(renderer);
      source = target;
      target = target === this.rtBlurA ? this.rtBlurB : this.rtBlurA;

      this.blur.uniforms['tDiffuse']!.value = source.texture;
      (this.blur.uniforms['uDirection']!.value as THREE.Vector2).set(0, this.texel.y);
      renderer.setRenderTarget(target);
      this.quad.render(renderer);
      source = target;
      target = target === this.rtBlurA ? this.rtBlurB : this.rtBlurA;
    }

    // --- 3. Componer sobre la escena ---
    this.composite.uniforms['tDiffuse']!.value = readBuffer.texture;
    this.composite.uniforms['tBloom']!.value = source.texture;
    this.quad.material = this.composite;

    if (this.renderToScreen) {
      renderer.setRenderTarget(null);
    } else {
      renderer.setRenderTarget(writeBuffer);
      if (!this.needsSwap) renderer.clear();
    }
    this.quad.render(renderer);
  }

  override dispose(): void {
    this.bright.dispose();
    this.blur.dispose();
    this.composite.dispose();
    this.quad.dispose();
    this.rtBright.dispose();
    this.rtBlurA.dispose();
    this.rtBlurB.dispose();
  }
}

/**
 * Vignette y grano: UN quad de pantalla completa sobre el cuadro ya resuelto.
 *
 * Es un unico draw call con cuatro muestras de textura... en realidad una sola:
 * no hay blur, ni downsample, ni muestreos vecinos. Eso es lo que lo hace
 * ponible en movil, donde cualquier cosa que toque resolucion completa duele.
 */
class GradePass extends Pass {
  private readonly material: THREE.ShaderMaterial;
  private readonly quad: FullScreenQuad;

  constructor(amount: number) {
    super();
    this.material = new THREE.ShaderMaterial({
      vertexShader: FULLSCREEN_VERT,
      fragmentShader: GRADE_FRAG,
      uniforms: {
        tDiffuse: { value: null },
        uAmount: { value: amount },
        uTime: { value: 0 },
        uTexel: { value: new THREE.Vector2(1 / 1280, 1 / 720) },
      },
      depthTest: false,
      depthWrite: false,
    });
    this.quad = new FullScreenQuad(this.material);
  }

  override setSize(width: number, height: number): void {
    // El grano se mide en pixeles: si el texel no sigue al tamaño, el ruido
    // cambia de escala al redimensionar y se ve como una textura que respira.
    (this.material.uniforms['uTexel']!.value as THREE.Vector2).set(1 / Math.max(1, width), 1 / Math.max(1, height));
  }

  override render(
    renderer: THREE.WebGLRenderer,
    writeBuffer: THREE.WebGLRenderTarget,
    readBuffer: THREE.WebGLRenderTarget,
  ): void {
    this.material.uniforms['tDiffuse']!.value = readBuffer.texture;
    // El tiempo mueve el ruido. Sin esto el grano es una mancha FIJA pegada al
    // cristal, que es exactamente el defecto que se nota en una pantalla quieta.
    this.material.uniforms['uTime']!.value = (this.material.uniforms['uTime']!.value as number) + 0.618;

    if (this.renderToScreen) {
      renderer.setRenderTarget(null);
    } else {
      renderer.setRenderTarget(writeBuffer);
      if (!this.needsSwap) renderer.clear();
    }
    this.quad.render(renderer);
  }

  override dispose(): void {
    this.material.dispose();
    this.quad.dispose();
  }
}

// ---------------------------------------------------------------------------
// Fachada
// ---------------------------------------------------------------------------

export interface PostFxOptions {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.Camera;
  width: number;
  height: number;
  bloom: boolean;
  bloomStrength: number;
  bloomThreshold: number;
  /** Rodilla del bloom: cuan brusco es el corte del umbral. */
  bloomKnee: number;
  bloomIterations: number;
  /** 0 = sin grade. Tambien gatea el vignette y el grano. */
  gradeMix: number;
  /** Muestras de MSAA del render target (0 en movil). */
  samples: number;
}

/**
 * La cadena de post-procesamiento.
 *
 * Se construye solo en los tiers que la piden: en `low` el juego sigue
 * llamando a `renderer.render()` directo, que es el camino de siempre.
 */
export class PostFx {
  private readonly composer: EffectComposer;
  private readonly bloomPass: BloomPass | null = null;
  private readonly gradePass: GradePass | null = null;
  private readonly lutPass: LUTPass | null = null;
  private readonly lutTexture: THREE.Data3DTexture | null = null;
  private readonly renderPass: RenderPass;
  /**
   * Transicion de pantalla (estilo Balatro). Va JUSTO DESPUES del render de la
   * escena: mezcla el frame viejo con el nuevo sobre el color de escena, asi el
   * bloom y el grade de la cadena se siguen aplicando igual durante el barrido.
   */
  private readonly transitionPass: TransitionPass;
  private sceneCalls = 0;
  /** Fuerza base del bloom: el pulso de cierre se suma encima de esta. */
  private readonly baseBloomStrength: number;

  constructor(options: PostFxOptions) {
    const { renderer, width, height } = options;
    this.baseBloomStrength = options.bloomStrength;

    // El render target propio es necesario para dos cosas: el tipo HalfFloat
    // (HDR, sin el cual el bloom recorta) y el MSAA del composer, que NO hereda
    // el `antialias` del renderer porque dibuja sobre un target.
    const target = new THREE.WebGLRenderTarget(width, height, {
      type: THREE.HalfFloatType,
      samples: options.samples,
      depthBuffer: true,
      stencilBuffer: false,
    });

    this.composer = new EffectComposer(renderer, target);
    this.renderPass = new RenderPass(options.scene, options.camera);
    this.composer.addPass(this.renderPass);

    // Snapshot justo despues del render de la escena: es el unico momento en
    // que `info.render.calls` es el numero de la escena y no el de los pases.
    this.composer.addPass(new SnapshotPass(() => (this.sceneCalls = renderer.info.render.calls)));

    // Arranca deshabilitado (el composer lo saltea): solo se prende durante una
    // transicion.
    this.transitionPass = new TransitionPass(width, height);
    this.composer.addPass(this.transitionPass);

    if (options.bloom) {
      this.bloomPass = new BloomPass({
        iterations: options.bloomIterations,
        strength: options.bloomStrength,
        threshold: options.bloomThreshold,
        knee: options.bloomKnee,
      });
      this.composer.addPass(this.bloomPass);
    }

    // `OutputPass` SIEMPRE: es el que aplica ACES + exposure + sRGB. Sin el, la
    // escena saldria lineal y lavada.
    this.composer.addPass(new OutputPass());

    if (options.gradeMix > 0) {
      this.lutTexture = createNightLut();
      this.lutPass = new LUTPass({ lut: this.lutTexture, intensity: options.gradeMix });
      // El grade va DESPUES del tone mapping: esta autorado en espacio de
      // pantalla (asi lo lee cualquiera que lo ajuste mirando una captura).
      this.composer.addPass(this.lutPass);

      // Cierra la cadena: vignette + grano. Es el ultimo, asi que el composer
      // lo marca solo como `renderToScreen`.
      this.gradePass = new GradePass(options.gradeMix);
      this.composer.addPass(this.gradePass);
    }

    this.composer.setPixelRatio(renderer.getPixelRatio());
    this.composer.setSize(width, height);
  }

  render(): void {
    this.composer.render();
  }

  /**
   * Redimensiona. El orden importa: `setPixelRatio` redimensiona por dentro con
   * las dimensiones LOGICAS que tenia guardadas, asi que si se cambia el DPR
   * hay que volver a llamar a `setSize` despues o los targets quedan del tamano
   * viejo y la imagen sale escalada.
   */
  setSize(width: number, height: number, pixelRatio: number): void {
    this.composer.setPixelRatio(pixelRatio);
    this.composer.setSize(width, height);
    // El pase de transicion guarda su propio target: el composer no lo conoce.
    this.transitionPass.setSize(width, height);
  }

  /** Pase de transicion de pantalla (ver `Transition.ts`). */
  get transition(): TransitionPass {
    return this.transitionPass;
  }

  /** Draw calls de la escena (sin los pases de pantalla completa). */
  get drawCalls(): number {
    return this.sceneCalls;
  }

  /**
   * Pulso de bloom para el cierre del combo. `extra = 0` lo vuelve a la base;
   * como el bloom puede estar desactivado (calidad baja), es un no-op ahi.
   */
  pulseBloom(extra: number): void {
    this.bloomPass?.setStrength(this.baseBloomStrength + extra);
  }

  dispose(): void {
    this.composer.dispose();
    this.bloomPass?.dispose();
    this.gradePass?.dispose();
    this.lutTexture?.dispose();
    this.transitionPass.dispose();
    this.renderPass.dispose();
  }
}
