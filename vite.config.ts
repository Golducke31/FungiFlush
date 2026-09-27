import { defineConfig } from 'vite';
import { fileURLToPath, URL } from 'node:url';

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  // Rutas relativas: obligatorio para que Tauri sirva el build desde el bundle local.
  base: './',

  resolve: {
    alias: {
      '@engine': r('./src/engine'),
      '@data': r('./src/data'),
      '@render': r('./src/render'),
      '@ui': r('./src/ui'),
      '@i18n': r('./src/i18n'),
      '@persistence': r('./src/persistence'),
    },
  },

  server: {
    port: 1420,
    strictPort: true,
    // Tauri necesita exponer el HMR en un host fijo.
    host: '127.0.0.1',
    watch: {
      // src-tauri lo vigila el propio Tauri, no Vite.
      ignored: ['**/src-tauri/**'],
    },
  },

  build: {
    // Tauri usa WebView2 / WKWebView / WebKitGTK: todos soportan ES2021+.
    target: 'es2022',
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true,
    chunkSizeWarningLimit: 1500,
  },

  // Three.js y los shaders GLSL se sirven como assets crudos.
  assetsInclude: ['**/*.glsl', '**/*.vert', '**/*.frag'],
});
