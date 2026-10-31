import { expect, test } from '@playwright/test'
import { strToU8, zipSync } from 'fflate'
import { APP_URL } from '../playwright.config'

/**
 * E-02 v1.4 搭车（ROADMAP §10.4）：F-1004 附件管理面板——列表（归属笔记/状态徽章）、
 * 逐个删除（确认弹窗）、预览缺失占位回落。
 */

// 1×1 PNG
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('tinynote:locale', 'zh-CN'))
})

test('F-1004：附件面板列表与删除（孤儿清理入口态校验）', async ({ page }) => {
  await page.goto(APP_URL)

  // 经导入管线造一个带图笔记（F-801 zip：notes/ + assets/）
  const zip = zipSync({
    'notes/项目/说明.md': strToU8('# 项目说明\n![架构图](assets/arch.png)'),
    'assets/arch.png': new Uint8Array(PNG),
  })
  await page.getByRole('button', { name: '数据菜单' }).click()
  await page.getByRole('menuitem', { name: /导入文件/ }).click()
  await page.locator('input[accept=".md,.markdown,.zip,.enex"]').setInputFiles([
    { name: 'pack.zip', mimeType: 'application/zip', buffer: Buffer.from(zip) },
  ])
  await expect(page.getByRole('dialog')).toBeVisible({ timeout: 30_000 })
  await expect(page.getByRole('dialog').getByText('正在导入…')).toBeHidden({ timeout: 30_000 })
  await page.getByRole('button', { name: '关闭' }).click()

  // 打开附件面板：行展示名称 / 归属笔记 / 类型 / 正文引用徽章
  await page.getByRole('button', { name: '附件', exact: true }).click()
  const panel = page.getByRole('heading', { name: '附件' })
  await expect(panel).toBeVisible()
  const row = page.locator('li').filter({ hasText: 'arch.png' })
  await expect(row).toBeVisible()
  await expect(row).toContainText('项目说明')
  await expect(row).toContainText('图片')
  await expect(row).toContainText('正文引用')

  // 无孤儿：清理按钮禁用
  await expect(page.getByRole('button', { name: /清理孤儿/ })).toBeDisabled()

  // 面板删除（确认弹窗）→ 行消失
  page.on('dialog', (dialog) => void dialog.accept())
  await row.getByRole('button', { name: '删除' }).click()
  await expect(page.locator('li').filter({ hasText: 'arch.png' })).toBeHidden({ timeout: 15_000 })
  await expect(page.getByText('库中还没有附件')).toBeVisible()

  // 回到笔记：正文引用仍在（字面量保留），预览渲染缺失占位
  await page.getByRole('button', { name: '返回笔记' }).click()
  await page.getByText('项目说明').click()
  await page.getByRole('button', { name: '预览' }).click()
  await expect(page.locator('.prose').getByText('[图片缺失]')).toBeVisible()
})
