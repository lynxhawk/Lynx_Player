import { createApp } from 'vue'
import './style.css'
import App from './App.vue'
import { createVuetify } from "vuetify";
//import "vuetify/styles"; // 引入 Vuetify 样式
import * as components from "vuetify/components";
import * as directives from "vuetify/directives";
import '@mdi/font/css/materialdesignicons.css';

// 创建 Vuetify 实例
const vuetify = createVuetify({
  components,
  directives,
});

// 创建 Vue 应用
const app = createApp(App);
app.use(vuetify); // 使用 Vuetify
app.mount("#app");
