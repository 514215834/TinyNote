import { defineConfig, devices } from '@playwright/test'

/**
 * E-02 Playwright E2E 首套（v1.2 搭车）：冒烟 + 导入链路。
 * 跑在构建产物上（vite preview）：先 `npm run build`，再 `npm run e2e`。
 * CI 子路径部署（VITE_BASE）下按 base 换算访问地址；语言钉在 zh-CN 保证选择器稳定。
 */

const PORT = 4173
const base = process.env.VITE_BASE ?? '/'
const appUrl = `http://127.0.0.1:${PORT}${base.endsWith('/') ? base : `${base}/`}`

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  fullyParallel: false, // 共用 preview 服务与 IndexedDB 口径，串行更稳
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'list' : 'list',
  use: {
    baseURL: appUrl,
    trace: 'retain-on-failure',
    locale: 'zh-CN',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm run preview -- --port 4173 --strictPort',
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
})
