/// <reference types="vite/client" />

/**
 * Tipado de los modulos JSON de contenido.
 * `import.meta.glob` viene de vite/client, referenciado arriba.
 */

declare module '*.json' {
  const value: unknown;
  export default value;
}
