import { defineConfig, globalIgnores } from 'eslint/config'
import js from '@eslint/js'
import pluginVue from 'eslint-plugin-vue'
import globals from 'globals'
import autoImport from './.eslintrc-auto-import.json' with { type: 'json' }

// unplugin-auto-import writes the list of globals it injects (ref, computed,
// watch, useI18n, ...) to .eslintrc-auto-import.json. Read it instead of
// restating it here so the two can never drift.
const autoImportGlobals = autoImport.globals

export default defineConfig([
  // node_modules is ignored by default; dist is the build output and public/
  // holds vendored assets that are not ours to lint.
  globalIgnores(['dist/**', 'public/**']),
  js.configs.recommended,
  // flat/essential is the Vue 3 preset (the vue2-* names are the opt-in ones),
  // matching the plugin:vue/vue3-essential this replaces.
  pluginVue.configs['flat/essential'],
  {
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.node,
        ...autoImportGlobals,
      },
    },
    rules: {
      // the codebase deliberately swallows errors in a lot of best-effort
      // paths (`catch(e){}`), so caught bindings and empty catch blocks are
      // idiomatic here rather than oversights.
      'no-unused-vars': ['error', { caughtErrors: 'none', argsIgnorePattern: '^_' }],
      'no-empty': ['error', { allowEmptyCatch: true }],
      // the shared form engine's node/ folder uses node:vm and crypto - never ship it
      'no-restricted-imports': ['error', { patterns: [{
        group: ['@engine/node/*', '@engine/resolve.js'],
        message: 'Only the browser-safe form engine files may be imported in the client.',
      }] }],
    },
  },
  {
    // pages are routed by filename via vite-plugin-pages, so their component
    // names are dictated by the URL and cannot be multi-word.
    files: ['src/pages/**/*.vue'],
    rules: {
      'vue/multi-word-component-names': 'off',
    },
  },
])
