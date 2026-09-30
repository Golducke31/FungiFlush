/**
 * Water.ts — Superficie de agua reactiva (F2).
 *
 * QUE ES: un manto de agua que rodea el sendero de piedra (la arboleda
 * "inundada"). No es un solver de fluidos: es agua ANALITICA en shader, igual
 * que la referencia — ondas de **Gerstner** con normales analiticas, **causticas
 * RGB** animadas, **Fresnel** (Schlick) para mezclar el cuerpo del agua con el
 * reflejo del cielo, y **ripples** radiales que decaen, disparados por la
 * interaccion del jugador.
 *
 * POR QUE ANALITICO Y NO UN SOLVER: un solver (Navier-Stokes en texturas
 * ping-pong) necesita render targets persistentes y varios pases por frame; en
 * un celular de gama media eso no entra en el presupuesto (p95 28 ms). Gerstner
 * + causticas da el 90% del look con UN draw call y cero estado.
 *
 * EL "HUECO" SECO: el agua es un plano teselado y en el fragment se descarta la
 * franja del sendero (`uDryHalf`). Asi el agua rodea la zona de juego sin
 * pisarla, sin geometria extra ni z-fighting.
 *
 * Solo se instancia en los tiers con `environment` (medium/high). En `low` no
 * existe: es el camino de render de siempre y no tiene margen de presupuesto.
 */

import * as THREE from 'three';

/** Cuantos ripples simultaneos se sostienen. */
const RIPPLE_COUNT = 6;
/** Vida util de un ripple, en segundos (el shader lo apaga solo). */
const RIPPLE_LIFE = 4;

const WATER_VERT = /* glsl */ `
  uniform float uTime;
  uniform float uWaveHeight;
  uniform vec4  uRipples[${RIPPLE_COUNT}];

  varying vec3  vWorldPos;
  varying vec3  vNormal;
  varying float vHeight;

  // Una onda de Gerstner. Acumula el gradiente de altura en grad, del que sale
  // la normal analitica (sin normal map ni diferencias finitas).
  vec3 gerstner(vec2 p, vec2 dir, float steepness, float wavelength, float speed, float t, inout vec2 grad) {
    float k = 6.28318530718 / wavelength;
    float c = sqrt(9.8 / k);              // dispersion en aguas profundas
    vec2  d = normalize(dir);
    float f = k * (dot(d, p) - c * speed * t);
    float a = steepness / k;
    grad += d * (a * k * cos(f));
    return vec3(d.x * a * cos(f), a * sin(f), d.y * a * cos(f));
  }

  void main() {
    vec3 pos = position;                  // la geometria ya viene rotada a XZ
    vec2 p = pos.xz;
    vec2 grad = vec2(0.0);
    vec3 disp = vec3(0.0);
    float t = uTime;

    disp += gerstner(p, vec2( 1.0,  0.35), 0.16, 7.5, 0.9, t, grad);
    disp += gerstner(p, vec2(-0.6,  1.0 ), 0.12, 4.6, 1.1, t, grad);
    disp += gerstner(p, vec2( 0.8, -0.7 ), 0.09, 3.0, 1.4, t, grad);
    disp += gerstner(p, vec2(-0.3, -0.9 ), 0.06, 2.2, 1.7, t, grad);

    // Ripples: ondas radiales que decaen con la distancia y el tiempo.
    for (int i = 0; i < ${RIPPLE_COUNT}; i++) {
      vec4 r = uRipples[i];
      if (r.w <= 0.0) continue;
      float age = uTime - r.z;
      if (age < 0.0 || age > ${RIPPLE_LIFE}.0) continue;
      vec2  delta = p - r.xy;
      float dist  = length(delta);
      float decay = exp(-age * 1.6) * exp(-dist * 0.22);
      float phase = dist * 2.6 - age * 7.0;
      float amp   = r.w * decay * 0.35;
      disp.y += sin(phase) * amp;
      grad   += normalize(delta + vec2(0.0001)) * cos(phase) * amp * 2.6;
    }

    pos.xz += disp.xz * uWaveHeight;
    pos.y  += disp.y  * uWaveHeight;

    vec4 world = modelMatrix * vec4(pos, 1.0);
    vWorldPos  = world.xyz;
    vHeight    = disp.y;
    vNormal    = normalize(mat3(modelMatrix) * normalize(vec3(-grad.x, 1.0, -grad.y)));
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const WATER_FRAG = /* glsl */ `
  uniform float uTime;
  uniform vec3  uDeepColor;
  uniform vec3  uShallowColor;
  uniform float uCaustics;
  uniform float uOpacity;
  uniform vec2  uDryHalf;

  varying vec3  vWorldPos;
  varying vec3  vNormal;
  varying float vHeight;

  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
               mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
  }

  // Caustica barata: tres senos cruzados. El pow la vuelve una red de lineas
  // brillantes en vez de una mancha.
  float caustic(vec2 p, float t) {
    float v = 0.0;
    v += sin(p.x * 1.15 + t * 0.75) * sin(p.y * 0.95 - t * 0.55);
    v += 0.6  * sin(p.x * 2.05 - t * 0.95) * sin(p.y * 1.85 + t * 0.65);
    v += 0.35 * sin(p.x * 3.60 + t * 1.25) * sin(p.y * 3.20 - t * 1.05);
    return pow(clamp(abs(v) * 0.55 + 0.45, 0.0, 1.0), 2.4);
  }

  void main() {
    // El sendero queda SECO: se descarta su franja.
    if (abs(vWorldPos.x) < uDryHalf.x && abs(vWorldPos.z) < uDryHalf.y) discard;

    vec3 N = normalize(vNormal);
    vec3 V = normalize(cameraPosition - vWorldPos);
    float fres = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 5.0);
    fres = 0.03 + 0.97 * fres;

    // Causticas RGB: tres muestras a distinta escala/velocidad => separacion
    // cromatica, que es lo que las hace leer como luz atravesando agua.
    vec2 cp = vWorldPos.xz * 0.28;
    vec3 caust = vec3(
      caustic(cp, uTime),
      caustic(cp * 1.06 + 3.1, uTime * 1.07),
      caustic(cp * 1.13 - 2.4, uTime * 1.13)
    );

    vec3 body = mix(uDeepColor, uShallowColor, clamp(vHeight * 2.2 + 0.4, 0.0, 1.0));
    body += caust * uCaustics * (0.55 + 0.45 * (1.0 - fres));

    // "Cielo" barato: degradado que hace de reflejo sin SSR.
    vec3 sky = mix(vec3(0.08, 0.18, 0.24), vec3(0.42, 0.68, 0.74),
                   clamp(V.y * 0.5 + 0.5, 0.0, 1.0));
    vec3 color = mix(body, sky, fres);

    gl_FragColor = vec4(color, uOpacity);

    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export type WaterQuality = 'medium' | 'high';

export class Water {
  readonly mesh: THREE.Mesh;
  private readonly material: THREE.ShaderMaterial;
  private readonly geometry: THREE.PlaneGeometry;
  private readonly ripples: THREE.Vector4[] = [];
  private cursor = 0;
  private lastRippleAt = -1;

  constructor(quality: WaterQuality) {
    // Teselado: el desplazamiento vive en el VERTICE, asi que la densidad manda
    // en el detalle de las olas. La ola mas corta mide 2.2 u; con ~0.55 u por
    // segmento quedan ~4 muestras por longitud de onda.
    const segments = quality === 'high' ? { x: 80, y: 48 } : { x: 48, y: 28 };
    this.geometry = new THREE.PlaneGeometry(40, 22, segments.x, segments.y);
    this.geometry.rotateX(-Math.PI / 2);

    for (let i = 0; i < RIPPLE_COUNT; i++) this.ripples.push(new THREE.Vector4(0, 0, 0, 0));

    this.material = new THREE.ShaderMaterial({
      vertexShader: WATER_VERT,
      fragmentShader: WATER_FRAG,
      uniforms: {
        uTime: { value: 0 },
        uWaveHeight: { value: quality === 'high' ? 1 : 0.7 },
        uRipples: { value: this.ripples },
        uDeepColor: { value: new THREE.Color(0x0d3a45) },
        uShallowColor: { value: new THREE.Color(0x2f97a3) },
        uCaustics: { value: quality === 'high' ? 1.15 : 0.7 },
        uOpacity: { value: 0.92 },
        // El sendero es |x|<=12, |z|<=4: el agua arranca un poco mas afuera.
        uDryHalf: { value: new THREE.Vector2(12.7, 4.7) },
      },
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: true,
    });

    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.name = 'water';
    // Por encima del suelo (y=0) y por debajo de las cartas (y=0.16).
    this.mesh.position.set(0, 0.055, 0);
    this.mesh.renderOrder = 1;
  }

  setEnabled(value: boolean): void {
    this.mesh.visible = value;
  }

  /** Franja seca (la planta de la plataforma): ahi el agua se descarta. */
  setDryHalf(x: number, z: number): void {
    (this.material.uniforms['uDryHalf'] as { value: THREE.Vector2 }).value.set(x, z);
  }

  get enabled(): boolean {
    return this.mesh.visible;
  }

  update(time: number): void {
    if (!this.mesh.visible) return;
    (this.material.uniforms['uTime'] as { value: number }).value = time;
  }

  /**
   * Dispara un ripple en el mundo (x, z). Se reusa el slot mas viejo: con 6
   * slots y 4 s de vida, mas de 6 en menos de 4 s se pisan, que es exactamente
   * lo que se quiere (no se acumulan infinitos).
   */
  ripple(x: number, z: number, strength = 1): void {
    // Un impacto SOBRE la plataforma se traslada al borde del agua: asi una
    // carta que cae en la mesa igual hace onda al lado, en vez de perderse.
    const dry = this.material.uniforms['uDryHalf'] as { value: THREE.Vector2 };
    let px = x;
    let pz = z;
    const insideX = dry.value.x - Math.abs(x);
    const insideZ = dry.value.y - Math.abs(z);
    if (insideX > 0 && insideZ > 0) {
      if (insideX < insideZ) px = Math.sign(x || 1) * (dry.value.x + 0.9);
      else pz = Math.sign(z || 1) * (dry.value.y + 0.9);
    }

    const slot = this.ripples[this.cursor % RIPPLE_COUNT];
    if (!slot) return;
    this.cursor += 1;
    const time = (this.material.uniforms['uTime'] as { value: number }).value;
    // Un `birth` apenas en el pasado: si cae exactamente en `uTime` la onda
    // arranca con radio 0 y no se ve.
    this.lastRippleAt = time;
    slot.set(px, pz, time - 0.001, strength);
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }

  /** Ultimo ripple disparado (para tests/diagnostico). */
  get lastRippleTime(): number {
    return this.lastRippleAt;
  }
}

/**
 * Punto del plano horizontal `y` bajo un rayo. Sirve para convertir un toque en
 * el canvas en una posicion del mundo sin raycastear contra la malla del agua
 * (que esta desplazada por las olas).
 */
export function hitHorizontalPlane(
  origin: THREE.Vector3,
  direction: THREE.Vector3,
  y: number,
): THREE.Vector3 | null {
  if (Math.abs(direction.y) < 1e-5) return null;
  const t = (y - origin.y) / direction.y;
  if (t < 0) return null;
  return origin.clone().addScaledVector(direction, t);
}
