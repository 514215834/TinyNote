/// <reference types="vitest/config" />
import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  // GitHub Pages 项目站点部署在子路径（/<仓库名>/）下，CI 注入 VITE_BASE
  base: process.env.VITE_BASE ?? '/',
  plugins: [
    vue(),
    tailwindcss(),
    // F-401/F-404：PWA。generateSW 预缓存全部构建产物，navigateFallback 支持离线直开；
    // registerType=prompt 配合 UpdateBanner（usePwaUpdate）由用户确认后刷新。
    // manifest 的 start_url/scope 由插件按 base 自动计算，子路径部署无需额外配置。
    VitePWA({
      injectRegister: null, // 注册逻辑由 virtual:pwa-register/vue 接管，避免重复注册
      registerType: 'prompt',
      includeAssets: ['apple-touch-icon.png', 'pwa-192x192.png', 'pwa-512x512.png', 'pwa-maskable-512.png'],
      manifest: {
        name: 'TinyNote — 本地优先 Markdown 笔记',
        short_name: 'TinyNote',
        description: '部署在 GitHub Pages 上的本地优先 Markdown 笔记应用，数据保存在你自己的浏览器中。',
        lang: 'zh-CN',
        display: 'standalone',
        theme_color: '#ffffff',
        background_color: '#ffffff',
        icons: [
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: 'pwa-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        navigateFallback: 'index.html',
      },
    }),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  // E-01 打包拆分（v1.1 搭车）：功能面已越过单 chunk 的合算点——
  // 框架 / 编辑器 / Markdown 渲染 / MiniSearch / 虚拟列表分 chunk，产物粒度利于缓存与增量更新；
  // MiniSearch 已在 searchIndex 内动态 import，此 manualChunks 仅给该 chunk 命名。
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['vue', 'vue-router', 'pinia', '@vueuse/core', 'dexie', 'fflate'],
          editor: ['vue-codemirror', 'codemirror', '@codemirror/lang-markdown', '@codemirror/theme-one-dark'],
          markdown: ['markdown-it', 'markdown-it-footnote', 'markdown-it-task-lists', 'highlight.js'],
          minisearch: ['minisearch'],
          virtual: ['@tanstack/vue-virtual'],
        },
      },
    },
  },
  test: {
    environment: 'happy-dom',
    setupFiles: ['./src/__tests__/setup.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', 'e2e/**'], // e2e 归 Playwright（E-02），vitest 不收集
  },
})

