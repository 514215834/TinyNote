import { createRouter, createWebHashHistory } from 'vue-router'
import NotesView from '@/features/notes/NotesView.vue'
import TrashView from '@/features/trash/TrashView.vue'

// ADR-001：GitHub Pages 静态托管下使用 Hash 路由，规避按路径刷新 404
export default createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', name: 'notes', component: NotesView },
    { path: '/trash', name: 'trash', component: TrashView }, // F-204 回收站
    // F-703 关系图谱：视图按需加载（E-01 打包拆分纪律——重功能一律独立分包惰性加载）
    {
      path: '/graph',
      name: 'graph',
      component: () => import('@/features/links/GraphView.vue'),
    },
  ],
})
