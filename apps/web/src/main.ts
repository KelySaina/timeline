import { createApp } from 'vue';
import { createPinia } from 'pinia';
import { FontAwesomeIcon } from '@fortawesome/vue-fontawesome';
import './styles/main.css';
import './lib/icons';
import App from './App.vue';
import router from './router';
import { registerServiceWorker, watchInstallability } from './lib/pwa';

createApp(App)
  .use(createPinia())
  .use(router)
  .component('FaIcon', FontAwesomeIcon)
  .mount('#app');

// After mount: the update prompt needs a Pinia store, and an installed app should never wait on
// the worker to paint its first screen. Installability is watched from here rather than from the
// header, because beforeinstallprompt fires once, moments after load, and is not replayed.
registerServiceWorker();
watchInstallability();
