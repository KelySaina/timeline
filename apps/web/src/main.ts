import { createApp } from 'vue';
import { createPinia } from 'pinia';
import { FontAwesomeIcon } from '@fortawesome/vue-fontawesome';
import './styles/main.css';
import './lib/icons';
import App from './App.vue';
import router from './router';

createApp(App)
  .use(createPinia())
  .use(router)
  .component('FaIcon', FontAwesomeIcon)
  .mount('#app');
