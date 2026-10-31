/**
 * 剪藏导入编排（F-902/F-903）：元信息注入、图片重链落附件、落库、防重指纹记录。
 * 落库原语（writeNote/writeImageAttachment）与常规导入共用（importService 导出），
 * 产物即普通笔记/附件——备份、同步、快照、搜索、链接索引全链路天然兼容。
 */

import { t } from '@/lib/i18n'
import { createId } from '@/lib/utils/id'
import { settingsRepository } from '@/lib/db/repositories/settingsRepository'
import { collectImageHrefs, emptySummary, writeImageAttachment, writeNote } from '../import/importService'
import { relinkImageReferences } from '../import/markdownImport'
import type { ImportSummary } from '../import/types'
import type { ClipManifest, ClipPackage } from './clipFile'

/** 导入选项（弹窗可修正标题、选文件夹归属、改标签） */
export interface ClipImportOptions {
  title: string
  folderId: string | null
  tags: string[]
}

// ———— F-903 剪藏防重（settings KV 指纹记录，本地计算无服务端） ————

const FINGERPRINT_KEY = 'clipFingerprints'
const FINGERPRINT_LIMIT = 200

async function listFingerprints(): Promise<string[]> {
  return (await settingsRepository.get<string[]>(FINGERPRINT_KEY)) ?? []
}

export async function isClipImported(fingerprint: string): Promise<boolean> {
  return (await listFingerprints()).includes(fingerprint)
}

/** 导入成功后记录指纹（FIFO 上限 200 条，防止无限膨胀） */
export async function recordClipFingerprint(fingerprint: string): Promise<void> {
  const list = (await listFingerprints()).filter((existing) => existing !== fingerprint)
  list.push(fingerprint)
  await settingsRepository.set(FINGERPRINT_KEY, list.slice(-FINGERPRINT_LIMIT))
}

// ———— F-902 导入 ————

function safeDecode(text: string): string {
  try {
    return decodeURIComponent(text)
  } catch {
    return text
  }
}

/** 元信息块：正文首部 blockquote（来源 URL / 站点名 / 剪藏时间，普通文本行，不新增字段） */
export function clipMetaBlock(manifest: ClipManifest): string {
  const lines = [`来源：${manifest.url}`]
  if (manifest.siteName.trim() !== '') lines.push(`站点：${manifest.siteName.trim()}`)
  const clippedAt = Date.parse(manifest.clippedAt)
  const time = Number.isNaN(clippedAt) ? manifest.clippedAt : new Date(clippedAt).toLocaleString()
  lines.push(`剪藏时间：${time}`)
  return `> ${lines.join('\n> ')}\n\n`
}

/**
 * 导入一个剪藏包：单篇笔记（全量插入语义）+ 图片附件重链。
 * 剪藏时间（manifest.clippedAt）作为笔记创建时间；标签/文件夹由弹窗选项决定。
 */
export async function importClipPackage(pkg: ClipPackage, options: ClipImportOptions): Promise<ImportSummary> {
  const summary = emptySummary()
  const noteId = createId()

  // 资源三键表：完整路径 / 解码路径 / 文件名（与 F-801 重链口径一致）
  const assets = new Map<string, { name: string; mime: string; bytes: Uint8Array }>()
  for (const asset of pkg.assets) {
    const decoded = safeDecode(asset.path)
    assets.set(asset.path, asset)
    assets.set(decoded, asset)
    assets.set(asset.name, asset)
  }

  const hrefMap = new Map<string, string>()
  for (const href of new Set(collectImageHrefs(pkg.markdown))) {
    const decoded = safeDecode(href)
    const entry = assets.get(href) ?? assets.get(decoded) ?? assets.get(decoded.split('/').pop() ?? '')
    if (entry === undefined) continue // 未命中资源（扩展端抓取失败的保留外链）：保留原文
    const ref = await writeImageAttachment(noteId, entry.name, entry.mime, new Blob([entry.bytes]))
    if (ref === null) {
      summary.skipped.push({ source: entry.name, reason: t('import.reasonAttachmentSkipped') })
      continue
    }
    summary.attachmentsCreated++
    hrefMap.set(href, ref)
    hrefMap.set(decoded, ref)
  }

  const relinked = relinkImageReferences(pkg.markdown, (href) => hrefMap.get(href) ?? hrefMap.get(safeDecode(href)) ?? null)
  const title = options.title.trim() !== '' ? options.title.trim() : t('common.untitled')
  const createdAt = Date.parse(pkg.manifest.clippedAt)
  await writeNote(
    {
      title,
      content: clipMetaBlock(pkg.manifest) + relinked,
      folderId: options.folderId,
      tags: options.tags,
      createdAt: Number.isNaN(createdAt) ? null : createdAt,
      updatedAt: null,
    },
    noteId,
  )
  summary.notesCreated++
  return summary
}
