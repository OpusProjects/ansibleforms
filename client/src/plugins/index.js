/**
 * plugins/index.js
 *
 * Automatically included in `./src/main.js`
 */

// the app can be hosted under a subpath (issue #106), all api calls
// must be prefixed with the runtime base path (empty for root hosting)
import axios from 'axios';
import BaseUrl from '@/lib/BaseUrl';
axios.defaults.baseURL = BaseUrl;

// Plugins
// import vuetify from './vuetify'
import pinia from '@/stores';
import router from '@/router';
import { VueShowdownPlugin } from 'vue-showdown';
import Popper from 'vue3-popper';
import clickOutside from '@/directives/clickOutside';
import VueHighlightJS from '@/lib/Highlight.js';
import VueJsonPretty from 'vue-json-pretty';
import { VueDatePicker } from '@vuepic/vue-datepicker';
import i18n from '@/plugins/i18n';

// Import our custom CSS
import '@/styles/settings.scss';
// the tables : one look for BsDataTable, the jobs table and the others (styles/tables.scss)
import '@/styles/tables.scss';
// Import all of Bootstrap's JS
import 'bootstrap';

// Import the CSS for datepicker
import '@vuepic/vue-datepicker/dist/main.css';

// Import the css for vue json pretty
import 'vue-json-pretty/lib/styles.css';

// Import the css for vue-sonner
import 'vue-sonner/style.css';

import '@vuepic/vue-datepicker/dist/main.css';

// font awesome global
import { library } from '@fortawesome/fontawesome-svg-core';
import { FontAwesomeIcon, FontAwesomeLayers, FontAwesomeLayersText } from '@fortawesome/vue-fontawesome';
import { fas } from '@fortawesome/free-solid-svg-icons';
import { fab } from '@fortawesome/free-brands-svg-icons';
import { far } from '@fortawesome/free-regular-svg-icons';
import { faBrightness, faAnsibleForms, faAnsible, faOAuth } from './icons';

library.add(faBrightness, faAnsibleForms, faAnsible, faOAuth);
library.add(fas, far, fab);

export function registerPlugins(app) {
  app
    // .use(vuetify)
    .use(i18n)
    .use(router)
    .use(pinia)
    .use(VueShowdownPlugin)
    .use(VueHighlightJS)
    .component('font-awesome-icon', FontAwesomeIcon)
    .component('font-awesome-layers', FontAwesomeLayers)
    .component('font-awesome-layers-text', FontAwesomeLayersText)
    .component('popper', Popper)
    .component('VueJsonPretty', VueJsonPretty)
    .component('VueDatePicker', VueDatePicker)
    .directive('click-outside', clickOutside);
}
