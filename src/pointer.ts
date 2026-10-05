/**
 * pointer.ts — Fuente UNICA de la deteccion de puntero.
 *
 * Vive en la raiz de `src/` a proposito: es un modulo hoja (cero dependencias)
 * que necesitan TANTO el HUD (`src/ui/`) como el render (`src/render/`). Ponerlo
 * dentro de `ui/` obligaria al render a importar de `ui/`, que hoy no lo hace y
 * no queremos que empiece a hacerlo.
 *
 * POR QUE EXISTE:
 * El CSS decide el layout movil con `@media (pointer: coarse)`. Cualquier
 * decision de JS que tenga que COINCIDIR con esa regla (fusionar textos, elegir
 * el layout 3D, mostrar u ocultar cromo) tiene que leer `isCoarsePointer()`. Si
 * el JS usa otro umbral, un dispositivo hibrido (tablet con raton) recibe el CSS
 * movil y el comportamiento JS de escritorio — o al reves. Esa desalineacion ya
 * existia: el CSS usaba `(pointer: coarse)` y dos call sites usaban el combo mas
 * estricto.
 *
 * DOS PREDICADOS, DOS USOS — no unificar a ciegas:
 *   - `isCoarsePointer()` = layout. Espeja EXACTAMENTE el `@media` del CSS.
 *   - `isTouchOnly()`     = "no hay raton". MAS ESTRICTO. Se usa para decisiones
 *     de GPU (calidad, antialias, particulas) y para el aviso de rotar el
 *     dispositivo, donde "tiene raton" cambia la respuesta. Un tablet con raton
 *     tiene puntero primario grueso pero SI tiene hover.
 */

/** El MISMO umbral que el CSS. No cambiarlo sin cambiar `src/ui/styles.css`. */
export const COARSE_MQ = '(pointer: coarse)';

/** El umbral "sin raton". Mas estricto que `COARSE_MQ`. */
export const TOUCH_ONLY_MQ = '(hover: none) and (pointer: coarse)';

/**
 * `true` si el puntero PRIMARIO es grueso (tactil).
 *
 * Es la fuente de verdad del LAYOUT: espeja `@media (pointer: coarse)`, asi que
 * lo que el JS decida con esto coincide con lo que el CSS pinta.
 */
export function isCoarsePointer(): boolean {
  return typeof window !== 'undefined' && window.matchMedia(COARSE_MQ).matches;
}

/**
 * `true` si el dispositivo NO tiene raton disponible.
 *
 * Mas estricto que `isCoarsePointer()`. Para decisiones donde "hay raton" cambia
 * la respuesta (calidad grafica, aviso de rotar), NO para layout.
 */
export function isTouchOnly(): boolean {
  return typeof window !== 'undefined' && window.matchMedia(TOUCH_ONLY_MQ).matches;
}
