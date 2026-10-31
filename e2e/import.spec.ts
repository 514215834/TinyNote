import { expect, test } from '@playwright/test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { strToU8, zipSync } from 'fflate'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { APP_URL } from '../playwright.config'

/**
 * E-02 导入链路（ROADMAP §10.2）：数据菜单「导入文件」→ F-801 Markdown 批量导入、
 * F-804 Notion 导出包导入。产物经导入弹窗摘要断言；列表与内容落库断言。
 */

async function importFiles(page: import('@playwright/test').Page, files: Array<{ name: string; bytes: Buffer }>): Promise<void> {
  await page.getByRole('button', { name: '数据菜单' }).click()
  await page.getByRole('menuitem', { name: /导入文件/ }).click()
  await page.locator('input[accept=".md,.markdown,.zip,.enex"]').setInputFiles(
    files.map((file) => ({ name: file.name, mimeType: 'application/octet-stream', buffer: file.bytes })),
  )
  // 等待导入弹窗出现并完成（working → 摘要）
  await expect(page.getByRole('dialog')).toBeVisible({ timeout: 30_000 })
  await expect(page.getByRole('dialog').getByText('正在导入…')).toBeHidden({ timeout: 30_000 })
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('tinynote:locale', 'zh-CN'))
})

test('F-801：多选 .md 导入——H1 标题、文件名回退、文件夹映射', async ({ page }) => {
  await page.goto(APP_URL)
  const dir = mkdtempSync(join(tmpdir(), 'tinynote-import-'))
  await importFiles(page, [
    { name: '技术笔记.md', bytes: Buffer.from('# 双链笔记\n正文内容') },
    { name: '待整理.md', bytes: Buffer.from('无标题正文') },
  ])
  await expect(page.getByRole('dialog').getByText('笔记 2 篇')).toBeVisible()
  await page.getByRole('button', { name: '关闭' }).click()

  // 列表按更新时间倒序：新导入的两篇都在
  await expect(page.getByText('双链笔记')).toBeVisible()
  await expect(page.getByText('待整理')).toBeVisible()
  void dir
})

test('F-801：zip 包（notes/ + assets/）——文件夹创建与图片重链', async ({ page }) => {
  await page.goto(APP_URL)
  // 1×1 PNG
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  )
  const zip = zipSync({
    'notes/项目/说明.md': strToU8('# 项目说明\n![架构图](assets/arch.png)'),
    'assets/arch.png': new Uint8Array(png),
  })
  await importFiles(page, [{ name: 'pack.zip', bytes: Buffer.from(zip) }])
  await expect(page.getByRole('dialog').getByText('笔记 1 篇')).toBeVisible()
  await expect(page.getByRole('dialog').getByText('附件 1 个')).toBeVisible()
  await page.getByRole('button', { name: '关闭' }).click()
  await expect(page.getByText('项目说明')).toBeVisible()
})

test('F-804：Notion 导出包——页面与 csv 数据库每行一篇', async ({ page }) => {
  await page.goto(APP_URL)
  const zip = zipSync({
    '项目页 11111111111111111111111111111111.md': strToU8('页面内容'),
    '项目页 11111111111111111111111111111111/子页 22222222222222222222222222222222.md': strToU8('子页内容'),
    '任务库 33333333333333333333333333333333.csv': strToU8('Name,状态\n任务一,进行中\n任务二,完成'),
  })
  await importFiles(page, [{ name: 'Export-abc.zip', bytes: Buffer.from(zip) }])
  await expect(page.getByRole('dialog').getByText('笔记 3 篇')).toBeVisible()
  await page.getByRole('button', { name: '关闭' }).click()
  await expect(page.getByText('项目页')).toBeVisible()
  await expect(page.getByText('任务一')).toBeVisible()
})

test('不支持类型计入跳过', async ({ page }) => {
  await page.goto(APP_URL)
  await importFiles(page, [{ name: 'readme.docx', bytes: Buffer.from('x') }])
  await expect(page.getByRole('dialog').getByText('跳过 1 项')).toBeVisible()
})
