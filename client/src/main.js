/**
 * main.js
 *
 * Bootstraps Vuetify and other plugins then mounts the App`
 */

// Plugins
import { registerPlugins } from '@/plugins';

// Components
import App from './App.vue';

// Composables
import { createApp } from 'vue';

// A tab left open across an upgrade still runs the old bundle : when it then loads a part of
// the app it had not loaded yet, that chunk's old hashed name is gone from the server and the
// page breaks. Reload once to get the new build (issue #660) - not again within 10 seconds,
// so a chunk that is really missing cannot cause a reload loop.
window.addEventListener('vite:preloadError', (event) => {
  let last = 0;
  try {
    last = Number(sessionStorage.getItem('af-chunk-reload') || 0);
  } catch {
    // storage unavailable : reload anyway, the guard is only a safety net
  }
  if (Date.now() - last > 10000) {
    try {
      sessionStorage.setItem('af-chunk-reload', String(Date.now()));
    } catch {
      // see above
    }
    event.preventDefault();
    window.location.reload();
  }
});

const app = createApp(App);

registerPlugins(app);

app.mount('#app');
