import { expect, test } from '@playwright/test'
import { APP_URL } from '../playwright.config'

/**
 * 侧栏底栏三入口（回收站 / 关系图谱 / 附件）单行不换行——v1.4 反馈回归：
 * 第三入口加入后按钮被 flex 收缩，CJK 文本按字换行；修复为 whitespace-nowrap +
 * 收紧内距。此断言钉住「单行高度」，防止未来再加入口或改宽度时回退。
 */

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('tinynote:locale', 'zh-CN'))
})

test('底栏入口按钮均单行渲染', async ({ page }) => {
  await page.goto(APP_URL)
  for (const label of ['回收站', '关系图谱', '附件']) {
    const button = page.locator('aside button', { hasText: label }).last()
    await expect(button).toBeVisible()
    // 单行高度：text-sm 行高 20px + py-1.5（12px）≈ 32px；发生换行会 ≥ 52px
    const height = await button.evaluate((el) => el.clientHeight)
    expect(height).toBeLessThanOrEqual(36)
  }
})
