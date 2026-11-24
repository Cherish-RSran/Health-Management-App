import { createApp } from 'vue';
import App from './App.vue';
import { router } from './router/index.js';
import { longpress } from './core/longpress.js';

import './styles/index.css';
import './styles/app-ui.css';

createApp(App)
  .use(router)
  .directive('longpress', longpress)
  .mount('#app');
