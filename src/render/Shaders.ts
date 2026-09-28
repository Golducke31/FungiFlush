/**
 * Shaders.ts — Materiales GLSL personalizados.
 *
 * Dos efectos, y los dos son de UNA sola pasada:
 *   1. HaloMaterial — halo bioluminiscente + anillo de seleccion + foil
 *      holografico, todo en el mismo quad y el mismo material.
 *   2. SporeMaterial — particulas de esporas (Points) que viajan de carta A a
 *      carta B.
 *
 * POR QUE EL HALO ES UNO Y NO TRES
 * --------------------------------
 * Antes cada carta tenia tres quads aditivos (halo, anillo y foil) y el anillo
 * volvia a dibujar LA MISMA geometria escalada 1.14. Eso no eran solo dos draw
 * calls mas: era sobrecarga aditiva (fill rate), que en un celular es el cuello
 * de botella real. Los tres son funciones de distancia sobre el mismo
 * rectangulo, asi que se suman en un solo fragment shader sin perder nada.
 *
 * Los tres materiales son `ShaderMaterial` crudos: NO incluyen los chunks de
 * tone mapping ni de colorspace de three. En el camino con composer eso da
 * igual (el `OutputPass` codifica todo el cuadro al final), pero en el tier
 * `low` — que renderiza directo — escriben valores lineales en un framebuffer
 * sRGB. Es una diferencia de brillo conocida entre tiers, no un bug.
 */

import * as THREE from 'three';

// ---------------------------------------------------------------------------
// 1. Halo (halo + anillo + foil en un solo pase)
// ---------------------------------------------------------------------------

export const HALO_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

/**
 * Halo rectangular: `uInnerHalo` es la mitad del tamaño de la carta dentro del
 * quad (en espacio -1..1). El shader calcula una distancia con signo a esa
 * caja: negativa adentro, positiva afuera. De ahi salen el borde y el halo.
 *
 * El anillo usa la misma idea pero con `exp(-abs(sdf))` en vez de
 * `exp(-max(sdf,0))`: eso lo convierte en una BANDA centrada en el contorno en
 * lugar de un resplandor hacia afuera, que es lo que se lee como "seleccionada".
 *
 * Los tres terminos se suman con sus intensidades y despues se normaliza el
 * color por la suma: asi el halo y el anillo pueden tener colores distintos sin
 * que uno se coma al otro.
 */
export const HALO_FRAG = /* glsl */ `
  uniform vec3  uColor;
  uniform float uIntensity;
  uniform vec3  uRingColor;
  uniform float uRingIntensity;
  uniform float uFoilAmount;
  uniform float uTime;
  uniform vec2  uInnerHalo;
  uniform vec2  uInnerRing;
  uniform float uFalloff;
  uniform float uRingFalloff;
  varying vec2  vUv;

  vec3 hsv2rgb(vec3 c) {
    vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
    vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
    return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
  }

  void main() {
    vec2 p = (vUv - 0.5) * 2.0;

    // --- Halo: borde que se desvanece hacia afuera ---
    vec2  dHalo   = abs(p) - uInnerHalo;
    float sdfHalo = max(dHalo.x, dHalo.y);
    float outside = max(sdfHalo, 0.0);
    float inside  = smoothstep(0.0, -0.14, sdfHalo);
    float halo    = exp(-outside * uFalloff) * (1.0 - inside * 0.9);

    // --- Anillo: banda centrada en un contorno mas chico ---
    vec2  dRing   = abs(p) - uInnerRing;
    float sdfRing = max(dRing.x, dRing.y);
    float ring    = exp(-abs(sdfRing) * uRingFalloff);

    // Pulso apagado. Antes era 'sin(uTime * 2.6 + p.y * 3.4)': a 2.6 Hz un
    // recorrido vertical leia como parpadeo al pasar el cursor sobre la carta.
    // La respiracion la maneja uIntensity desde JS (hover/seleccion con factor
    // exponencial). Si en algun momento se quiere un pulso real, es opt-in.
    float pulse = 1.0;

    float aHalo = halo * uIntensity * pulse;
    float aRing = ring * uRingIntensity;
    float aFoil = halo * uFoilAmount;

    vec3 color = uColor * aHalo + uRingColor * aRing;
    if (uFoilAmount > 0.001) {
      // El tono recorre el espectro segun la posicion y el tiempo.
      float hue = fract(vUv.x * 0.6 + vUv.y * 0.35 + uTime * 0.12);
      color += hsv2rgb(vec3(hue, 0.75, 1.0)) * aFoil;
    }

    float a = clamp(aHalo + aRing + aFoil, 0.0, 1.0);
    // Se normaliza por la suma para conservar el color cuando hay dos terminos
    // activos a la vez (una legendaria seleccionada, por ejemplo).
    vec3 mixed = a > 0.001 ? color / a : color;

    gl_FragColor = vec4(mixed * a, a);

    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

/**
 * `uInnerHalo` sale de dividir el valor historico (0.82) por la escala del quad
 * del anillo (1.14): el quad crecio para poder contener los dos contornos, asi
 * que el halo tiene que encogerse en la misma proporcion para verse igual.
 */
export const HALO_INNER_HALO = 0.82 / 1.14;
/** El anillo ya vivia en un quad escalado 1.14, asi que su valor no cambia. */
export const HALO_INNER_RING = 0.62;

export function createHaloMaterial(options: {
  color: number;
  ringColor: number;
  intensity?: number;
  falloff?: number;
  foil?: number;
}): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: HALO_VERT,
    fragmentShader: HALO_FRAG,
    uniforms: {
      uColor: { value: new THREE.Color(options.color) },
      uIntensity: { value: options.intensity ?? 0.55 },
      uRingColor: { value: new THREE.Color(options.ringColor) },
      uRingIntensity: { value: 0 },
      uFoilAmount: { value: options.foil ?? 0 },
      uTime: { value: 0 },
      uInnerHalo: { value: new THREE.Vector2(HALO_INNER_HALO, HALO_INNER_HALO) },
      uInnerRing: { value: new THREE.Vector2(HALO_INNER_RING, HALO_INNER_RING) },
      uFalloff: { value: options.falloff ?? 9 },
      uRingFalloff: { value: 6.5 },
    },
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    // `true` desde D2: sin esto el renderer no define `TONE_MAPPING` y el chunk
    // de abajo seria un no-op justo en el camino donde hace falta (el render
    // directo al canvas de `low`).
    toneMapped: true,
  });
}

// ---------------------------------------------------------------------------
// 2. Esporas (particulas)
// ---------------------------------------------------------------------------

/**
 * Esporas de AMBIENTE: la posicion se calcula entera aca.
 *
 * La CPU escribe `aSeed` una sola vez al construir y despues solo actualiza
 * `uTime`. Con 900 esporas eso es la diferencia entre 900 integraciones por
 * frame en JS y cero.
 *
 * El desvanecido de los extremos existe porque la caida es ciclica (`mod`): sin
 * el, la espora que sale por abajo reaparece de golpe arriba.
 */
export const AMBIENT_SPORE_VERT = /* glsl */ `
  attribute vec3  aSeed;
  attribute float aSize;
  attribute vec3  aColor;

  uniform float uTime;
  uniform float uHeight;
  uniform float uFallSpeed;
  uniform float uDrift;

  varying float vAlpha;
  varying vec3  vColor;

  void main() {
    // Variacion POR ESPORA derivada del tercer componente de la semilla, que
    // ya es distinto en cada una. Sin esto, las del mismo color se ven como
    // clones: mismo brillo, mismo tamaño, y el campo se lee como una textura
    // repetida.
    float v = fract(sin(aSeed.z * 17.13) * 43758.5453);

    vColor = aColor * (0.72 + 0.56 * v);

    // Caida con wrap: al salir por abajo vuelve a entrar por arriba.
    float t = uTime * uFallSpeed + aSeed.y;
    float y = uHeight - mod(t, uHeight);

    // Deriva lateral: dos senos de frecuencias inconmensurables, para que el
    // movimiento no se lea como una orbita.
    float x = aSeed.x + sin(uTime * 0.21 + aSeed.x * 0.7) * uDrift;
    float z = aSeed.z + cos(uTime * 0.17 + aSeed.z * 0.9) * uDrift;

    // Aparece al entrar por arriba, se apaga antes de tocar el suelo.
    vAlpha = smoothstep(0.0, uHeight * 0.2, y) * (1.0 - smoothstep(uHeight * 0.8, uHeight, y));

    vec4 mv = modelViewMatrix * vec4(x, y, z, 1.0);
    // Atenuacion por perspectiva: las esporas lejanas se ven mas chicas.
    // El mismo factor del color tambien escala el punto, asi que brillo y
    // tamaño van de la mano: una espora chica y brillante se lee como un
    // destello, y una grande y opaca como algo mas cerca.
    gl_PointSize = aSize * (0.85 + 0.4 * v) * (340.0 / max(0.001, -mv.z)) * vAlpha;
    gl_Position  = projectionMatrix * mv;
  }
`;

export const AMBIENT_SPORE_FRAG = /* glsl */ `
  varying float vAlpha;
  varying vec3  vColor;

  void main() {
    vec2  c = gl_PointCoord - 0.5;
    float d = length(c);
    float core = smoothstep(0.5, 0.0, d);
    float halo = smoothstep(0.5, 0.15, d) * 0.45;
    float a = (core + halo) * vAlpha;
    if (a < 0.01) discard;
    gl_FragColor = vec4(vColor * (0.6 + 0.4 * core), a);

    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export function createAmbientSporeMaterial(height = 10): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: AMBIENT_SPORE_VERT,
    fragmentShader: AMBIENT_SPORE_FRAG,
    uniforms: {
      uTime: { value: 0 },
      uHeight: { value: height },
      uFallSpeed: { value: 0.22 },
      uDrift: { value: 1.6 },
    },
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: true,
  });
}

export const SPORE_VERT = /* glsl */ `
  attribute float aSize;
  attribute float aLife;
  attribute vec3  aColor;
  varying float vLife;
  varying vec3  vColor;

  void main() {
    vLife  = aLife;
    vColor = aColor;

    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    // Atenuacion por perspectiva: las esporas lejanas se ven mas chicas.
    gl_PointSize = aSize * (340.0 / max(0.001, -mv.z)) * (0.35 + 0.65 * aLife);
    gl_Position  = projectionMatrix * mv;
  }
`;

export const SPORE_FRAG = /* glsl */ `
  varying float vLife;
  varying vec3  vColor;

  void main() {
    vec2  c = gl_PointCoord - 0.5;
    float d = length(c);
    // Nucleo brillante + halo suave.
    float core = smoothstep(0.5, 0.0, d);
    float halo = smoothstep(0.5, 0.15, d) * 0.45;
    float a = (core + halo) * vLife;
    if (a < 0.01) discard;
    gl_FragColor = vec4(vColor * (0.6 + 0.4 * core), a);

    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export function createSporeMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: SPORE_VERT,
    fragmentShader: SPORE_FRAG,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: true,
  });
}

// ---------------------------------------------------------------------------
// Cielo
// ---------------------------------------------------------------------------

/**
 * Esfera invertida con degradado vertical. Reemplaza el color plano de
 * `scene.background` en los tiers con atmosfera.
 *
 * Lleva los dos chunks de salida a proposito, y por la misma razon que los
 * demas materiales de este archivo: con el composer el cuadro va a un render
 * target, donde `TONE_MAPPING` no se define y `linearToOutputTexel` es la
 * identidad (el `OutputPass` lo hace al final). Renderizando directo al canvas
 * (`low`) los dos se activan y el cielo queda codificado como el resto de la
 * escena. Sin los chunks, el cielo se veria distinto en cada camino.
 */
export const SKY_VERT = /* glsl */ `
  varying vec3 vDir;

  void main() {
    vDir = normalize(position);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

export const SKY_FRAG = /* glsl */ `
  uniform vec3 uZenith;
  uniform vec3 uHorizon;
  uniform vec3 uNadir;
  varying vec3 vDir;

  void main() {
    // 0 en el nadir, 0.5 en el horizonte, 1 en el cenit.
    float h = vDir.y * 0.5 + 0.5;

    // Dos ramas y no una sola mezcla: si se interpolara del nadir al cenit de
    // una vez, el horizonte quedaria a medio camino entre los dos en vez de
    // ser su propio color, y la franja de luz se perderia.
    vec3 c = h > 0.5
      ? mix(uHorizon, uZenith, smoothstep(0.5, 1.0, h))
      : mix(uNadir, uHorizon, smoothstep(0.0, 0.5, h));

    gl_FragColor = vec4(c, 1.0);

    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export function createSkyMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: SKY_VERT,
    fragmentShader: SKY_FRAG,
    uniforms: {
      // Apagados pero no negros: un cielo negro plano se lee como "no hay
      // nada", y lo que tiene que verse es el degradado.
      uZenith: { value: new THREE.Color(0x081420) },
      uHorizon: { value: new THREE.Color(0x14384a) },
      uNadir: { value: new THREE.Color(0x03060a) },
    },
    side: THREE.BackSide,
    depthWrite: false,
    // Si el cielo se niebla desaparece: esta a 120 unidades y el far de la
    // niebla es 62, asi que la niebla se lo comeria entero.
    fog: false,
  });
}

/** Actualiza `uTime` en todos los materiales que lo usen. */
export function tickShader(material: THREE.Material, time: number): void {
  const uniforms = (material as THREE.ShaderMaterial).uniforms;
  if (uniforms && uniforms['uTime']) {
    (uniforms['uTime'] as { value: number }).value = time;
  }
}
