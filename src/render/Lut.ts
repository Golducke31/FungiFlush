/**
 * Lut.ts — Grade de color procedural.
 *
 * POR QUE PROCEDURAL Y NO UN .CUBE HORNEADO
 * -----------------------------------------
 * Un LUT horneado en DaVinci o Photoshop es la forma profesional, pero agrega
 * un asset binario, un loader y una dependencia externa para iterar. Un LUT de
 * 16³ generado por una funcion pura hace lo mismo (una tabla de 4096 entradas
 * que el shader muestrea con interpolacion lineal) y **no necesita ningun
 * archivo**: si un dia se quiere autorar a mano, `createNightLut()` se
 * reemplaza por un loader de PNG y el resto no cambia.
 *
 * QUE HACE
 * --------
 *   - Contraste: una S suave alrededor del medio. Sube el contraste sin tocar
 *     los extremos (a diferencia de un `contrast()` lineal, que recorta).
 *   - Sombras hacia el teal: es lo que ata la paleta. El fondo del juego ya es
 *     azul-verdoso; esto empuja lo oscuro en esa direccion en vez de dejarlo
 *     gris neutro.
 *   - Altas apenas calidas: separa la luz de los hongos del fondo frio.
 *   - +8% de saturacion, para que los acentos bioluminiscentes no se apaguen.
 *
 * El grade se aplica DESPUES del tone mapping (`OutputPass`), o sea sobre
 * valores ya codificados en sRGB: por eso los numeros de aca se leen como
 * "cuanto se ve en pantalla" y no como radiancia.
 */

import * as THREE from 'three';

/** Lado del cubo del LUT. 16 alcanza: la interpolacion lineal tapa los escalones. */
export const LUT_SIZE = 16;

/** Cuanto empuja la S del contraste. 0 = sin cambio. */
const CONTRAST = 0.22;
/** Ganancia de saturacion alrededor de la luminancia. */
const SATURATION = 1.08;
/**
 * Tinte de las sombras. Es DELIBERADAMENTE sutil: sumar 0.1 en azul a un negro
 * puro levanta el fondo de la mesa y el juego pierde el negro profundo que es
 * media estetica. Se ajusta mirando una captura, no en abstracto.
 */
const SHADOW_TINT = [0.0, 0.018, 0.036] as const;
/** Tinte de las altas. */
const HIGHLIGHT_TINT = [0.035, 0.016, 0.0] as const;

const LUMA_R = 0.2126;
const LUMA_G = 0.7152;
const LUMA_B = 0.0722;

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

/** S-curve suave: fija 0 y 1, empuja los medios hacia los extremos. */
function sCurve(x: number): number {
  return x + CONTRAST * (x * x * (3 - 2 * x) - x);
}

/**
 * El grade. Puro y sin Three.js: se puede testear en Node y es la unica
 * definicion de como se ve un color despues del post-procesamiento.
 *
 * Escribe en `out` para no asignar un array por entrada (son 4096).
 */
export function gradeRgb(r: number, g: number, b: number, out: number[]): void {
  let rr = sCurve(r);
  let gg = sCurve(g);
  let bb = sCurve(b);

  const luma = LUMA_R * rr + LUMA_G * gg + LUMA_B * bb;
  // 1 en el negro, 0 a partir de ~0.45 de luminancia.
  const shadow = Math.max(0, 1 - luma * 2.2);
  // Suave en el medio, 1 en el blanco.
  const high = luma * luma * (3 - 2 * luma);

  rr += SHADOW_TINT[0] * shadow + HIGHLIGHT_TINT[0] * high;
  gg += SHADOW_TINT[1] * shadow + HIGHLIGHT_TINT[1] * high;
  bb += SHADOW_TINT[2] * shadow + HIGHLIGHT_TINT[2] * high;

  const l2 = LUMA_R * rr + LUMA_G * gg + LUMA_B * bb;
  out[0] = clamp01(l2 + (rr - l2) * SATURATION);
  out[1] = clamp01(l2 + (gg - l2) * SATURATION);
  out[2] = clamp01(l2 + (bb - l2) * SATURATION);
}

/**
 * Construye la textura 3D del LUT.
 *
 * El orden de llenado importa: `Data3DTexture` espera x mas rapido, despues y,
 * despues z, y el shader muestrea `texture(lut, vec3(r, g, b))`. Invertir los
 * bucles da un grade con los canales cruzados, que se ve "casi bien" y es
 * dificil de detectar a ojo.
 */
export function createNightLut(size = LUT_SIZE): THREE.Data3DTexture {
  const data = new Uint8Array(size * size * size * 4);
  const out = [0, 0, 0];
  const max = size - 1;
  let i = 0;

  for (let b = 0; b < size; b++) {
    for (let g = 0; g < size; g++) {
      for (let r = 0; r < size; r++) {
        gradeRgb(r / max, g / max, b / max, out);
        data[i++] = Math.round((out[0] ?? 0) * 255);
        data[i++] = Math.round((out[1] ?? 0) * 255);
        data[i++] = Math.round((out[2] ?? 0) * 255);
        data[i++] = 255;
      }
    }
  }

  const texture = new THREE.Data3DTexture(data, size, size, size);
  texture.format = THREE.RGBAFormat;
  texture.type = THREE.UnsignedByteType;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.wrapR = THREE.ClampToEdgeWrapping;
  // El grade se lee tal cual: no hay que convertir nada.
  texture.colorSpace = THREE.NoColorSpace;
  texture.needsUpdate = true;
  return texture;
}
