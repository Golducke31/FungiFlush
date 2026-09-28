/**
 * three-addons.d.ts — Tipos minimos para los "addons" de three.
 *
 * POR QUE EXISTE
 * --------------
 * `three` exporta `./addons/*` -> `./examples/jsm/*`, pero **no publica los
 * `.d.ts`** de `examples/jsm`. Sin esta declaracion, importar
 * `three/addons/utils/BufferGeometryUtils.js` desde un archivo tipado da
 * "Could not find a declaration file for module".
 *
 * La alternativa era agregar `@types/three`, que trae tipos para los cientos
 * de addons del catalogo para que usemos **una** funcion. No vale la pena.
 * Aca se declara solo lo que el proyecto importa de verdad.
 */

declare module 'three/addons/utils/BufferGeometryUtils.js' {
  import type { BufferGeometry } from 'three';

  /**
   * Fusiona geometrias que comparten exactamente los mismos atributos en una
   * sola. Todas tienen que estar indexadas o ninguna (el proyecto usa todas
   * no-indexadas).
   *
   * Devuelve `null` y loguea un `console.error` si los atributos no coinciden,
   * asi que el llamador tiene que chequear el resultado.
   */
  export function mergeGeometries(
    geometries: BufferGeometry[],
    useGroups?: boolean,
  ): BufferGeometry | null;
}
