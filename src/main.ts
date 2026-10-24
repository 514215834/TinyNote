import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import router from './router'
import { markBoot } from '@/lib/perf'
import './assets/main.css'

markBoot() // F-604：启动预算起点（模块求值即计时）
createApp(App).use(createPinia()).use(router).mount('#app')
