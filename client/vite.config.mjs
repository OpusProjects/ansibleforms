// Plugins
import basicSsl from '@vitejs/plugin-basic-ssl'
import AutoImport from 'unplugin-auto-import/vite'
import Components from 'unplugin-vue-components/vite'
import Pages from 'vite-plugin-pages'
import Vue from '@vitejs/plugin-vue'
// import VueRouter from 'unplugin-vue-router/vite'
import svgLoader from 'vite-svg-loader'

// Utilities
import { defineConfig, loadEnv } from 'vite'
import { fileURLToPath, URL } from 'node:url'

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
// read .env / .env.local etc, so VITE_DEV_HOST can be set once per machine instead of
// exported in the shell every time
const env = loadEnv(mode, process.cwd(), '')
return {
  // relative base, so a single build works under any subpath (issue #106)
  // the server rewrites the <base href="/"> tag in index.html at runtime (BASE_URL)
  base: './',
  plugins: [
    basicSsl(),
    svgLoader(
      {defaultImport: 'url'}
    ),
    Pages(),
    Vue({
      template: { 
        compilerOptions: {
          isCustomElement: tag => ['badge'].includes(tag),
        }
      }
    }),
    Components(),
    AutoImport({
      imports: [
        'vue',
        'vue-router',
        { 'vue-i18n': ['useI18n'] },
      ],
      eslintrc: {
        enabled: true,
      },
      vueTemplate: true,
    }),
  ],
  define: { 'process.env': {} },
  resolve: {
    // yaml is deduped so the shared form engine (@engine, under server/) resolves it from
    // client/node_modules - server/node_modules does not exist when the image builds the client
    dedupe: ['vue', 'yaml'],
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '~@': fileURLToPath(new URL('./src', import.meta.url)),
      // the form engine shared with the server (MCP, launch validation) - browser-safe files only
      '@engine': fileURLToPath(new URL('../server/src/lib/formEngine', import.meta.url))
    },
    extensions: [
      '.js',
      '.json',
      '.jsx',
      '.mjs',
      '.ts',
      '.tsx',
      '.vue',
    ],
  },
  // Vite's own minifier. terser used to be configured here only to keep a few local names
  // unmangled for the direct eval in lib/Helpers.js; that code no longer uses a direct eval,
  // so nothing depends on local names surviving minification.
  build:{
    // FontAwesome's solid icon set is about 950 kB minified and cannot shrink: forms name their
    // icons in YAML, so every icon has to be available. It is the largest chunk by design;
    // anything bigger than this limit is a real regression worth the warning.
    chunkSizeWarningLimit: 1000,
    rolldownOptions: {
      output: {
        // Libraries in chunks of their own: they change far less often than the app, so a
        // browser keeps them cached across AnsibleForms upgrades, and the code editor is only
        // downloaded by the pages that use it.
        codeSplitting: {
          groups: [
            { name: 'vue', test: /node_modules[\\/](@vue|vue|vue-router|pinia)[\\/]/, priority: 60 },
            { name: 'fa-solid', test: /node_modules[\\/]@fortawesome[\\/]free-solid-svg-icons/, priority: 50 },
            { name: 'fa-brands', test: /node_modules[\\/]@fortawesome[\\/]free-brands-svg-icons/, priority: 50 },
            { name: 'fontawesome', test: /node_modules[\\/]@fortawesome/, priority: 40 },
            { name: 'ace', test: /node_modules[\\/]ace-builds/, priority: 30 },
            { name: 'vendor', test: /node_modules/, priority: 10 },
          ],
        },
      },
    },
  },

  optimizeDeps: {
    include: ['vue3-ace-editor', 'ace-builds']
  },
  server: {
    // localhost-only by default (security fix #465) ; set VITE_DEV_HOST in client/.env.local
    // (e.g. to true or an IP) to expose it, for a remote/SSH dev setup, without changing
    // the default for everyone. env vars are always strings, so "true" needs parsing -
    // passed through as-is it makes Vite resolve a literal hostname called "true"
    host: env.VITE_DEV_HOST === 'true' ? true : (env.VITE_DEV_HOST || '127.0.0.1'),
    port: 8443,
    // @engine lives outside client/ : let the dev server serve it
    fs: {
      allow: [fileURLToPath(new URL('..', import.meta.url))]
    },
    proxy: {
      '/api/': {
        target: env.API_PROXY_TARGET || 'http://localhost:3001',
        changeOrigin: true,
        secure: false,
      }
    }    
  },
  css: {
    preprocessorOptions: {
      scss: {
        silenceDeprecations: ['color-functions', 'global-builtin', 'import', 'if-function']
      },
    }
  },  
}
})
