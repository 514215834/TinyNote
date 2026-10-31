import { expect, test, type Page } from '@playwright/test'
import { strToU8, zipSync } from 'fflate'
import { buildClipZip, type ClipManifest } from '../extension/src/clip'
import { APP_URL } from '../playwright.config'

/**
 * E-02 v1.3 搭车（ROADMAP §10.3）：剪藏 → 文件 → 导入 → 渲染 端到端 +
 * F-903 剪藏防重。产物 zip 用扩展侧同一装配函数（extension/src/clip.ts）生成——
 * 文件通道（zip 契约）是扩展与应用之间的唯一接口，E2E 以真实产物走完整导入管线。
 */

const CLIP_MANIFEST: ClipManifest = {
  format: 'tinynote-clip',
  schemaVersion: 1,
  url: 'https://example.com/articles/e2e',
  siteName: '示例站',
  title: 'E2E 剪藏文章',
  mode: 'article',
  clippedAt: '2026-10-31T04:30:00.000Z',
}

// 1×1 PNG
const PNG_BYTES = Uint8Array.from(
  atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='),
  (c) => c.charCodeAt(0),
)

function clipZipFile(): { name: string; mimeType: string; buffer: Buffer } {
  const zip = buildClipZip(
    CLIP_MANIFEST,
    '![配图](assets/1-pic.png)\n\n剪藏正文段落，包含 **加粗**。\n',
    [{ path: 'assets/1-pic.png', name: '1-pic.png', mime: 'image/png', bytes: PNG_BYTES }],
  )
  return { name: 'tinynote-clip-20261031-1230.zip', mimeType: 'application/zip', buffer: Buffer.from(zip) }
}

function regularZipFile(): { name: string; mimeType: string; buffer: Buffer } {
  const zip = zipSync({
    'notes/资料/普通包.md': strToU8('# 普通包笔记\n常规 Markdown 导入'),
  })
  return { name: 'pack.zip', mimeType: 'application/zip', buffer: Buffer.from(zip) }
}

async function importViaMenu(page: Page, files: Array<{ name: string; mimeType: string; buffer: Buffer }>): Promise<void> {
  await page.getByRole('button', { name: '数据菜单' }).click()
  await page.getByRole('menuitem', { name: /导入文件/ }).click()
  await page.locator('input[accept=".md,.markdown,.zip,.enex"]').setInputFiles(files)
}

function CLIP_DIALOG(page: Page): ReturnType<Page['getByRole']> {
  return page.getByRole('dialog', { name: '导入剪藏' })
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('tinynote:locale', 'zh-CN'))
  await page.goto(APP_URL)
})

test('F-902：剪藏 zip → 导入弹窗修正 → 入库 → 预览元信息与图片渲染', async ({ page }) => {
  await importViaMenu(page, [clipZipFile()])

  // 剪藏弹窗：标题预填扩展提取值，来源 URL 可见
  const dialog = CLIP_DIALOG(page)
  await expect(dialog).toBeVisible({ timeout: 30_000 })
  await expect(dialog.getByText('https://example.com/articles/e2e')).toBeVisible()
  await expect(dialog.locator('input[type="text"]').first()).toHaveValue('E2E 剪藏文章')

  // 修正标题 + 选文件夹归属（未分类保持空）→ 导入
  await dialog.locator('input[type="text"]').first().fill('E2E 剪藏文章（修正）')
  await dialog.getByRole('button', { name: '导入', exact: true }).click()
  await expect(dialog.getByText('笔记 1 篇')).toBeVisible({ timeout: 30_000 })
  await expect(dialog.getByText('附件 1 个')).toBeVisible()
  await dialog.getByRole('button', { name: '关闭' }).click()
  await expect(CLIP_DIALOG(page)).toBeHidden()

  // 打开笔记 → 预览态：元信息块（来源/站点/剪藏时间）+ 图片（附件 blob）渲染
  await page.getByText('E2E 剪藏文章（修正）').click()
  await page.getByRole('button', { name: '预览' }).click()
  const preview = page.locator('.prose')
  await expect(preview.getByText('来源：https://example.com/articles/e2e')).toBeVisible()
  await expect(preview.getByText('站点：示例站')).toBeVisible()
  await expect(preview.getByText(/剪藏时间：/)).toBeVisible()
  await expect(preview.locator('img[src^="blob:"]')).toBeVisible()
  await expect(preview.getByText('剪藏正文段落，包含')).toBeVisible()
})

test('F-903：同一剪藏产物重复导入被拦截，强制重入产生副本', async ({ page }) => {
  const file = clipZipFile()

  // 第一次导入：正常入口
  await importViaMenu(page, [file])
  const dialog = CLIP_DIALOG(page)
  await expect(dialog).toBeVisible({ timeout: 30_000 })
  await expect(dialog.getByRole('button', { name: '导入', exact: true })).toBeVisible()
  await expect(dialog.getByRole('button', { name: '强制重新导入' })).toBeHidden()
  await dialog.getByRole('button', { name: '导入', exact: true }).click()
  await expect(dialog.getByText('笔记 1 篇')).toBeVisible({ timeout: 30_000 })
  await dialog.getByRole('button', { name: '关闭' }).click()

  // 第二次导入同一产物：指纹命中 → 琥珀提示 + 主按钮变为强制重入
  await importViaMenu(page, [file])
  await expect(CLIP_DIALOG(page)).toBeVisible({ timeout: 30_000 })
  const dialog2 = CLIP_DIALOG(page)
  await expect(dialog2.getByText(/该剪藏之前已导入过/)).toBeVisible()
  await expect(dialog2.getByRole('button', { name: '导入', exact: true })).toBeHidden()
  await dialog2.getByRole('button', { name: '强制重新导入' }).click()
  await expect(dialog2.getByText('笔记 1 篇')).toBeVisible({ timeout: 30_000 })
  await dialog2.getByRole('button', { name: '关闭' }).click()

  // 全量插入语义：同产物两份笔记并存
  await expect(page.getByText('E2E 剪藏文章')).toHaveCount(2)
})

test('F-902 分流：剪藏包与常规包混合导入互不阻塞（先常规摘要、后剪藏弹窗）', async ({ page }) => {
  await importViaMenu(page, [regularZipFile(), clipZipFile()])

  // 常规导入摘要 + 剪藏弹窗同时可见（常规先完成，剪藏包随后排队展示）
  const regularDialog = page.getByRole('dialog', { name: '导入结果' })
  const clipDialog = CLIP_DIALOG(page)
  await expect(regularDialog.getByText('笔记 1 篇')).toBeVisible({ timeout: 30_000 })
  await expect(clipDialog).toBeVisible()

  // 剪藏弹窗覆盖在常规摘要之上（模态队列，同层 z-40 后者居顶）：先处理剪藏层，再关常规摘要
  await expect(regularDialog.getByText('笔记 1 篇')).toBeVisible({ timeout: 30_000 })
  await expect(clipDialog).toBeVisible()
  await clipDialog.getByRole('button', { name: '取消' }).click()
  await expect(CLIP_DIALOG(page)).toBeHidden()
  await regularDialog.getByRole('button', { name: '关闭' }).click()
  await expect(CLIP_DIALOG(page)).toBeHidden()
  await expect(page.getByText('普通包笔记')).toBeVisible()
  await expect(page.getByText('E2E 剪藏文章')).toHaveCount(0)
})
