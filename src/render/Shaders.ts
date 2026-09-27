/**
 * Shaders.ts — Materiales GLSL personalizados.
 *
 * Tres efectos:
 *   1. GlowMaterial  — borde bioluminiscente que late (hover, seleccion, legendarias).
 *   2. SporeMaterial — particulas de esporas (Points) que viajan de carta A a carta B.
 *   3. FoilMaterial  — borde holografico (foil) que se desplaza con el tiempo.
 */

import * as THREE from 'three';

// ---------------------------------------------------------------------------
// 1. Glow
// ---------------------------------------------------------------------------

export const GLOW_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

/**
 * Halo rectangular: `uInner` es la mitad del tamaño de la carta dentro del
 * quad (en espacio -1..1). El shader calcula una distancia con signo a esa
 * caja: negativa adentro, positiva afuera. De ahi salen el borde y el halo.
 */
export const GLOW_FRAG = /* glsl */ `
  uniform vec3  uColor;
  uniform float uIntensity;
  uniform float uTime;
  uniform vec2  uInner;
  uniform float uFalloff;
  uniform float uPulse;
  varying vec2  vUv;

  void main() {
    vec2  p = (vUv - 0.5) * 2.0;
    vec2  d = abs(p) - uInner;
    float sdf = max(d.x, d.y);

    float outside = max(sdf, 0.0);
    float halo    = exp(-outside * uFalloff);
    float inside  = smoothstep(0.0, -0.14, sdf);
    float rim     = halo * (1.0 - inside * 0.9);

    float pulse = 1.0 - uPulse * 0.5 + uPulse * 0.5 * sin(uTime * 2.6 + p.y * 3.4);
    float a = rim * uIntensity * pulse;

    gl_FragColor = vec4(uColor * a, a);
  }
`;

export function createGlowMaterial(color: number, intensity = 1, falloff = 9): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: GLOW_VERT,
    fragmentShader: GLOW_FRAG,
    uniforms: {
      uColor: { value: new THREE.Color(color) },
      uIntensity: { value: intensity },
      uTime: { value: 0 },
      uInner: { value: new THREE.Vector2(0.82, 0.82) },
      uFalloff: { value: falloff },
      uPulse: { value: 0.35 },
    },
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
}

// ---------------------------------------------------------------------------
// 2. Esporas (particulas)
// ---------------------------------------------------------------------------

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
  }
`;

export function createSporeMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: SPORE_VERT,
    fragmentShader: SPORE_FRAG,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
  });
}

// ---------------------------------------------------------------------------
// 3. Foil (borde holografico de las cartas legendarias / miticas)
// ---------------------------------------------------------------------------

export const FOIL_FRAG = /* glsl */ `
  uniform float uTime;
  uniform float uIntensity;
  varying vec2  vUv;

  vec3 hsv2rgb(vec3 c) {
    vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
    vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
    return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
  }

  void main() {
    vec2  p = (vUv - 0.5) * 2.0;
    vec2  d = abs(p) - 0.82;
    float sdf = max(d.x, d.y);

    float outside = max(sdf, 0.0);
    float halo    = exp(-outside * 7.0);
    float inside  = smoothstep(0.0, -0.14, sdf);
    float rim     = halo * (1.0 - inside * 0.9);

    // El tono recorre el espectro segun la posicion y el tiempo.
    float hue = fract(vUv.x * 0.6 + vUv.y * 0.35 + uTime * 0.12);
    vec3  col = hsv2rgb(vec3(hue, 0.75, 1.0));

    float a = rim * uIntensity;
    gl_FragColor = vec4(col * a, a);
  }
`;

export function createFoilMaterial(intensity = 0.85): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: GLOW_VERT,
    fragmentShader: FOIL_FRAG,
    uniforms: {
      uTime: { value: 0 },
      uIntensity: { value: intensity },
    },
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
}

/** Actualiza `uTime` en todos los materiales que lo usen. */
export function tickShader(material: THREE.Material, time: number): void {
  const uniforms = (material as THREE.ShaderMaterial).uniforms;
  if (uniforms && uniforms['uTime']) {
    (uniforms['uTime'] as { value: number }).value = time;
  }
}
