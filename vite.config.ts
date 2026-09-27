import { defineConfig } from 'vite';
import { fileURLToPath, URL } from 'node:url';

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig(({ mode }) => ({
  // Rutas relativas: obligatorio para que Tauri sirva el build desde el bundle local.
  base: './',

  resolve: {
    alias: {
      '@engine': r('./src/engine'),
      '@data': r('./src/data'),
      '@content': r('./src/content'),
      '@meta': r('./src/meta'),
      '@render': r('./src/render'),
      '@ui': r('./src/ui'),
      '@i18n': r('./src/i18n'),
      '@persistence': r('./src/persistence'),
      '@audio': r('./src/audio'),
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
    // Los sourcemaps ayudan a depurar, pero en release son ~3 MB que terminan
    // dentro del AAB. `npm run build:release` los desactiva.
    sourcemap: mode !== 'release',
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (id.includes('node_modules/three')) return 'three';
          if (id.includes('/src/engine/')) return 'engine';
          if (id.includes('/src/data/')) return 'content';
          return undefined;
        },
      },
    },
  },

  // Three.js y los shaders GLSL se sirven como assets crudos.
  assetsInclude: ['**/*.glsl', '**/*.vert', '**/*.frag'],
}));
