import { expect, test, type Page } from '@playwright/test'
import { APP_URL } from '../playwright.config'

/**
 * E-02 v1.4 搭车（ROADMAP §10.4）：F-1001 LaTeX 公式与 F-1002 Mermaid 图表的
 * 预览渲染端到端（KaTeX / Mermaid 动态加载的真实浏览器路径）+ 语法错误回落。
 */

async function newNoteAndType(page: Page, text: string[]): Promise<void> {
  await page.getByRole('button', { name: '+ 新建笔记' }).click()
  await page.locator('.cm-content').click()
  for (const [index, chunk] of text.entries()) {
    if (index > 0) await page.keyboard.press('Enter')
    await page.keyboard.type(chunk)
  }
  // 等自动保存落库（F-102）
  await page.locator('input[placeholder="无标题笔记"]').click()
  await expect(page.getByText('已保存')).toBeVisible({ timeout: 10_000 })
  await page.waitForTimeout(400) // 预览渲染 250ms 防抖
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('tinynote:locale', 'zh-CN'))
  await page.goto(APP_URL)
})

test('F-1001/F-1002：行内/块级公式与 mermaid 围栏在预览渲染（深浅色默认浅色）', async ({ page }) => {
  await newNoteAndType(page, [
    '质能方程 $E=mc^2$ 与积分：',
    '$$\\int_0^1 x\\,dx$$',
    '```mermaid',
    'graph TD',
    'A[开始] --> B[结束]',
    '```',
  ])

  await page.getByRole('button', { name: '预览' }).click()
  const preview = page.locator('.prose')

  // KaTeX 渲染：占位节点被替换为 .katex 结构，原文 $ 定界符不再可见
  await expect(preview.locator('.katex')).toHaveCount(2, { timeout: 20_000 })
  await expect(preview.locator('.math-inline .katex')).toHaveCount(1)
  await expect(preview.locator('.math-block .katex')).toHaveCount(1)

  // Mermaid 渲染：围栏块被替换为 SVG（节点中文标签可见）
  await expect(preview.locator('.math-mermaid svg')).toBeVisible({ timeout: 20_000 })
  await expect(preview.locator('.math-mermaid')).toContainText('开始')
})

test('F-1002：mermaid 语法错误原样显示并提示错误位置', async ({ page }) => {
  await newNoteAndType(page, [
    '```mermaid',
    'graph TD',
    'A --> ',
    '```',
  ])

  await page.getByRole('button', { name: '预览' }).click()
  const preview = page.locator('.prose')

  // 错误提示出现；原围栏代码保留（可修文再渲染）
  await expect(preview.locator('.mermaid-error')).toBeVisible({ timeout: 20_000 })
  await expect(preview.locator('.mermaid-error')).toContainText('图表语法错误')
  await expect(preview.locator('code.language-mermaid')).toBeVisible()
})
