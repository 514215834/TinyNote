import { expect, test, type Page } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { APP_URL } from '../playwright.config'

/**
 * E-02 冒烟（ROADMAP §10.2）：新建 → 编辑 → 刷新存续 → 导出全量备份 →
 * 清空全部数据 → 备份还原。语言经 addInitScript 钉在 zh-CN（选择器稳定）。
 */

const TITLE = 'E2E 冒烟笔记'
const BODY = '第一段正文内容，包含 **加粗**。'

async function newNote(page: Page): Promise<void> {
  await page.getByRole('button', { name: '+ 新建笔记' }).click()
  const title = page.locator('input[placeholder="无标题笔记"]')
  await title.fill(TITLE)
  await page.locator('.cm-content').click()
  await page.keyboard.type(BODY)
  await expect(page.locator('.cm-content')).toContainText(BODY)
}

async function openDataMenu(page: Page): Promise<void> {
  await page.getByRole('button', { name: '数据菜单' }).click()
}

test('新建 → 编辑 → 刷新存续 → 导出 → 清库 → 备份还原', async ({ page }) => {
  test.setTimeout(120_000)
  await page.addInitScript(() => localStorage.setItem('tinynote:locale', 'zh-CN'))
  await page.goto(APP_URL)

  await newNote(page)
  // 失焦立即保存（F-102）：点回标题框让编辑器失焦触发 flush，等「已保存」后再刷新
  // （只等「已保存」会撞上标题保存的旧状态，正文防抖尚未落库）
  await page.locator('input[placeholder="无标题笔记"]').click()
  await expect(page.getByText('已保存')).toBeVisible({ timeout: 10_000 })
  // 等待失焦 flush 的 IndexedDB 事务提交完成，避免 reload 打断写库
  await page.waitForTimeout(500)
  await page.reload()
  await expect(page.locator('input[placeholder="无标题笔记"]')).toHaveValue(TITLE)
  await expect(page.locator('.cm-content')).toContainText(BODY)

  // 导出全量备份（捕获下载）
  mkdirSync(join(tmpdir(), 'tinynote-e2e'), { recursive: true })
  const downloadPath = join(tmpdir(), 'tinynote-e2e', 'backup.zip')
  await openDataMenu(page)
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('menuitem', { name: /导出全量备份/ }).click()
  const download = await downloadPromise
  await download.saveAs(downloadPath)

  // 清空全部数据：设置面板 → 存储 → 双重确认（confirm 接受 + prompt 输入「清空」）→ 整页刷新
  await page.getByRole('button', { name: '设置' }).click()
  await page.getByRole('tab', { name: '存储' }).click()
  const wipeDialogs: string[] = []
  const onWipeDialog = (dialog: import('@playwright/test').Dialog): void => {
    wipeDialogs.push(dialog.type())
    if (dialog.type() === 'prompt') void dialog.accept('清空')
    else void dialog.accept()
  }
  page.on('dialog', onWipeDialog)
  await page.getByRole('button', { name: '清空全部数据…' }).click()
  await expect
    .poll(() => wipeDialogs.join(','), { timeout: 10_000 })
    .toContain('prompt')
  await expect(page.locator('input[placeholder="无标题笔记"]')).toHaveCount(0, { timeout: 15_000 })
  await expect(page.locator('.cm-content')).toHaveCount(0)
  page.off('dialog', onWipeDialog)

  // 备份还原：直接对隐藏的备份文件 input 注入（导入菜单入口的 UI 链路由 import.spec 覆盖）。
  // confirm 在 setInputFiles 进行中同步弹出（模态），必须先挂自动接受处理器——
  // 等 action 返回再 accept 会与模态对话框互相等待死锁；restoreDone alert 由同一处理器消费。
  const importDialogs: string[] = []
  const onImportDialog = (dialog: import('@playwright/test').Dialog): void => {
    importDialogs.push(dialog.type())
    void dialog.accept()
  }
  page.on('dialog', onImportDialog)
  await page.locator('input[accept=".zip,.json,application/zip,application/json"]').setInputFiles(downloadPath)
  // confirm（覆盖确认）+ alert（恢复完成）依次出现
  await expect.poll(() => importDialogs.length, { timeout: 20_000 }).toBeGreaterThanOrEqual(2)
  page.off('dialog', onImportDialog)
  await expect(page.locator('input[placeholder="无标题笔记"]')).toHaveValue(TITLE, { timeout: 15_000 })
  await expect(page.locator('.cm-content')).toContainText(BODY)
})
