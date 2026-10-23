import { createRouter, createWebHashHistory } from 'vue-router'
import NotesView from '@/features/notes/NotesView.vue'

// ADR-001：GitHub Pages 静态托管下使用 Hash 路由，规避按路径刷新 404
export default createRouter({
  history: createWebHashHistory(),
  routes: [{ path: '/', name: 'notes', component: NotesView }],
})
