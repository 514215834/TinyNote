/**
 * 导入互操作编排（F-801/F-803/F-804）：文件分发、落库（文件夹/附件/笔记）、统计摘要。
 * 导入一律全量插入（不与既有笔记合并，无跨库去重）；单篇失败不中断整批（计入失败明细）。
 * 纯解析在各导入器模块（markdownImport/enexImport/notionImport）；本模块负责 Dexie 写入与产物装配。
 */

import { strFromU8, unzipSync, type Unzipped } from 'fflate'
import { t } from '@/lib/i18n'
import { createId } from '@/lib/utils/id'
import type { Attachment } from '@/types'
import { noteRepository } from '@/lib/db/repositories/noteRepository'
import { attachmentRepository } from '@/lib/db/repositories/attachmentRepository'
import { folderRepository } from '@/lib/db/repositories/folderRepository'
import { makeFolder } from '@/features/folders/folders'
import { makeExcerpt } from '@/features/notes/notes'
import { MAX_ATTACHMENT_SIZE } from '@/features/editor/attachments'
import { attachmentRef } from '@/lib/markdown/attachmentRef'
import type { ImportSummary } from './types'
import { planMarkdownNotes, relinkImageReferences } from './markdownImport'
import { parseEnex, enmlToHtml, base64ToBlob, type EnexResource } from './enexImport'
import { htmlToMarkdown } from './htmlToMarkdown'
import { planNotionPages, planNotionDatabase } from './notionImport'

/** 图片 MIME 白名单（v1.4 扩展非图片附件前维持仅图片；zip 内无真实 mime，按扩展名推断） */
const IMAGE_MIME_BY_EXT: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  avif: 'image/avif',
  bmp: 'image/bmp',
}

export function mimeByName(name: string): string | null {
  const ext = (name.split('.').pop() ?? '').toLowerCase()
  return IMAGE_MIME_BY_EXT[ext] ?? null
}

/** 供入口判定的可导入扩展名 */
export function isImportableFile(file: { name: string }): boolean {
  return /\.(md|markdown|zip|enex)$/i.test(file.name)
}

/** 标签归一（与 F-202 口径一致：trim、大小写不敏感去重、保留首现大小写） */
function normalizeTags(values: string[]): string[] {
  const tags: string[] = []
  for (const value of values) {
    const tag = value.trim()
    if (tag === '') continue
    if (tags.some((existing) => existing.toLowerCase() === tag.toLowerCase())) continue
    tags.push(tag)
  }
  return tags
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function safeDecode(text: string): string {
  try {
    return decodeURIComponent(text)
  } catch {
    return text
  }
}

/** 单篇笔记写入（excerpt 由 repository 统一重算；id 可预生成——附件引用重链需要它） */
export async function writeNote(
  plan: {
    title: string
    content: string
    folderId: string | null
    tags: string[]
    createdAt: number | null
    updatedAt: number | null
  },
  id: string = createId(),
): Promise<string> {
  const now = Date.now()
  const createdAt = plan.createdAt ?? now
  await noteRepository.saveWithContent(
    {
      id,
      title: plan.title,
      excerpt: makeExcerpt(plan.content),
      folderId: plan.folderId,
      tags: normalizeTags(plan.tags),
      pinned: false,
      trashed: false,
      trashedAt: null,
      createdAt,
      updatedAt: Math.max(plan.updatedAt ?? createdAt, createdAt),
    },
    plan.content,
  )
  return id
}

/** 附件落库（图片白名单 + 10MB 上限）：返回附件引用；不合规返回 null（调用方计入跳过） */
export async function writeImageAttachment(
  noteId: string,
  name: string,
  mime: string,
  blob: Blob,
): Promise<string | null> {
  if (!mime.startsWith('image/') || blob.size === 0 || blob.size > MAX_ATTACHMENT_SIZE) return null
  const attachment: Attachment = {
    id: createId(),
    noteId,
    name,
    mime,
    size: blob.size,
    blob,
    createdAt: Date.now(),
  }
  await attachmentRepository.save(attachment)
  return attachmentRef(attachment.id)
}

export function emptySummary(): ImportSummary {
  return { notesCreated: 0, foldersCreated: 0, attachmentsCreated: 0, skipped: [], failed: [] }
}

function skipped(summary: ImportSummary, source: string, reason: string): void {
  summary.skipped.push({ source, reason })
}

function failed(summary: ImportSummary, source: string, reason: string): void {
  summary.failed.push({ source, reason })
}

/**
 * 文件夹分配器：按名取 id，已存在复用（同名不重复建）、缺失创建并计数。
 * 现有名册惰性加载一次。
 */
export class FolderAllocator {
  private byName = new Map<string, string>()
  private loaded = false

  async ensure(name: string, summary: ImportSummary): Promise<string | null> {
    const key = name.trim()
    if (key === '') return null
    if (!this.loaded) {
      for (const folder of await folderRepository.list()) this.byName.set(folder.name, folder.id)
      this.loaded = true
    }
    const cached = this.byName.get(key)
    if (cached !== undefined) return cached
    const folder = makeFolder(key, this.byName.size)
    await folderRepository.save(folder)
    this.byName.set(key, folder.id)
    summary.foldersCreated++
    return folder.id
  }
}

/** 图片引用收集（重链前的 href 清单） */
export function collectImageHrefs(content: string): string[] {
  const hrefs: string[] = []
  for (const match of content.matchAll(/!\[([^\]]*)\]\(([^()\s]+)\)/g)) hrefs.push(match[2]!)
  return hrefs
}

/**
 * 剥离 zip 包顶层 `notes/` 容器目录（约定包结构 notes/ + assets/）：
 * 容器本身不映射文件夹，其下的一级目录才是文件夹。
 */
function stripPackRoot(path: string): string {
  return path.replace(/^notes\//i, '').replace(/^\.\/(?!\.\/)/, '')
}

/**
 * 导入入口：按扩展名分发（.md/.markdown → Markdown 批量；.zip → 按内容识别 Notion
 * 导出包（含 csv）或 Markdown 包；.enex → Evernote）。多文件逐个处理，统计合并为一个摘要。
 */
export async function importFiles(files: File[]): Promise<ImportSummary> {
  const summary = emptySummary()
  const folders = new FolderAllocator()

  const markdownFiles: File[] = []
  for (const file of files) {
    if (/\.(md|markdown)$/i.test(file.name)) {
      markdownFiles.push(file)
      continue
    }
    if (/\.zip$/i.test(file.name)) {
      await importZip(file, summary, folders)
      continue
    }
    if (/\.enex$/i.test(file.name)) {
      await importEnex(file, summary, folders)
      continue
    }
    skipped(summary, file.name, t('import.reasonUnsupported'))
  }

  if (markdownFiles.length > 0) {
    const plans = planMarkdownNotes(
      await Promise.all(
        markdownFiles.map(async (file) => ({ path: file.name, content: await file.text() })),
      ),
    )
    for (const plan of plans) {
      if (plan.content.trim() === '') {
        skipped(summary, plan.path, t('import.reasonEmptyFile'))
        continue
      }
      try {
        await writeNote({
          title: plan.title,
          content: plan.content,
          folderId: plan.folderName === null ? null : await folders.ensure(plan.folderName, summary),
          tags: [],
          createdAt: null,
          updatedAt: null,
        })
        summary.notesCreated++
      } catch (error) {
        failed(summary, plan.path, t('import.reasonWriteFailed', { msg: errorMessage(error) }))
      }
    }
  }

  return summary
}

// ———— zip 分发 ————————————————————————————————————————————————

async function importZip(file: File, summary: ImportSummary, folders: FolderAllocator): Promise<void> {
  let entries: Unzipped
  try {
    entries = unzipSync(new Uint8Array(await file.arrayBuffer()))
  } catch (error) {
    failed(summary, file.name, t('import.reasonZipFailed', { msg: errorMessage(error) }))
    return
  }
  const paths = Object.keys(entries).filter((path) => !path.endsWith('/'))
  if (paths.some((path) => /\.csv$/i.test(path))) {
    await importNotionZip(paths, entries, summary)
  } else {
    await importMarkdownZip(paths, entries, summary, folders)
  }
}

// ———— F-801：Markdown 包（notes/ + assets/ 目录结构，图片按相对路径重链） ————————

async function importMarkdownZip(
  paths: string[],
  entries: Unzipped,
  summary: ImportSummary,
  folders: FolderAllocator,
): Promise<void> {
  // 资源表：完整路径 / 解码路径 / 文件名 三键可命中（各导出工具对空格等字符的编码不一）
  const assets = new Map<string, { name: string; mime: string; bytes: Uint8Array }>()
  for (const path of paths) {
    if (/\.(md|markdown|csv)$/i.test(path)) continue
    const bytes = entries[path]!
    const entry = {
      name: path.split('/').pop() ?? path,
      mime: mimeByName(path) ?? 'application/octet-stream',
      bytes,
    }
    assets.set(path, entry)
    const decoded = safeDecode(path)
    assets.set(decoded, entry)
    assets.set(decoded.split('/').pop() ?? entry.name, entry)
  }

  const mdPaths = paths.filter((path) => /\.(md|markdown)$/i.test(path))
  const plans = planMarkdownNotes(
    mdPaths.map((path) => ({ path: stripPackRoot(path), content: strFromU8(entries[path]!) })),
  )
  for (const plan of plans) {
    if (plan.content.trim() === '') {
      skipped(summary, plan.path, t('import.reasonEmptyFile'))
      continue
    }
    try {
      const noteId = createId()
      const hrefMap = new Map<string, string>()
      for (const href of new Set(collectImageHrefs(plan.content))) {
        const decoded = safeDecode(href)
        const entry = assets.get(href) ?? assets.get(decoded) ?? assets.get(decoded.split('/').pop() ?? '')
        if (entry === undefined) continue // 未命中资源：保留原文链接，不计跳过（外部图片可能本来就在）
        const ref = await writeImageAttachment(noteId, entry.name, entry.mime, new Blob([entry.bytes]))
        if (ref === null) {
          skipped(summary, `${plan.path} → ${entry.name}`, t('import.reasonAttachmentSkipped'))
          continue
        }
        summary.attachmentsCreated++
        hrefMap.set(href, ref)
        hrefMap.set(decoded, ref)
      }
      const content = relinkImageReferences(plan.content, (href) => hrefMap.get(href) ?? null)
      await writeNote(
        {
          title: plan.title,
          content,
          folderId: plan.folderName === null ? null : await folders.ensure(plan.folderName, summary),
          tags: [],
          createdAt: null,
          updatedAt: null,
        },
        noteId,
      )
      summary.notesCreated++
    } catch (error) {
      failed(summary, plan.path, t('import.reasonWriteFailed', { msg: errorMessage(error) }))
    }
  }
}

// ———— F-803：Evernote ENEX ——————————————————————————————————————

async function importEnex(file: File, summary: ImportSummary, folders: FolderAllocator): Promise<void> {
  let notes
  try {
    notes = parseEnex(await file.text())
  } catch (error) {
    failed(summary, file.name, t('import.reasonParseFailed', { msg: errorMessage(error) }))
    return
  }
  if (notes.length === 0) {
    skipped(summary, file.name, t('import.reasonEmptyFile'))
    return
  }
  // ENEX 无笔记本字段（按笔记本逐个导出的约定）：文件名（去扩展名）映射文件夹
  const folderId = await folders.ensure(file.name.replace(/\.enex$/i, ''), summary)
  for (const note of notes) {
    try {
      await importEnexNote(note, folderId, summary)
      summary.notesCreated++
    } catch (error) {
      failed(summary, note.title !== '' ? note.title : file.name, t('import.reasonWriteFailed', { msg: errorMessage(error) }))
    }
  }
}

async function importEnexNote(
  note: Awaited<ReturnType<typeof parseEnex>>[number],
  folderId: string | null,
  summary: ImportSummary,
): Promise<void> {
  const noteId = createId()
  // 资源落附件（图片白名单）：hash → 附件引用，供 en-media 占位重链
  const imageSrcMap = new Map<string, string>()
  for (const resource of note.resources) {
    const placeholder = `enmedia:${resource.hash}`
    const blob = base64ToBlob(resource.data, resource.mime)
    const name = resource.filename ?? enexResourceName(resource)
    const ref = await writeImageAttachment(noteId, name, resource.mime, blob)
    if (ref === null) {
      skipped(summary, `${note.title} → ${name}`, t('import.reasonAttachmentSkipped'))
      imageSrcMap.set(placeholder, '')
      continue
    }
    summary.attachmentsCreated++
    imageSrcMap.set(placeholder, ref)
  }
  let markdown = await htmlToMarkdown(enmlToHtml(note.content), { imageSrcMap })
  // 来源 URL 写入正文首部 blockquote 元信息（不新增字段）
  if (note.sourceUrl !== null) {
    markdown = `> ${t('import.sourceLine', { url: note.sourceUrl })}\n\n${markdown}`
  }
  const title = note.title !== '' ? note.title : t('common.untitled')
  await writeNote(
    {
      title,
      content: markdown,
      folderId,
      tags: note.tags,
      createdAt: note.createdAt,
      updatedAt: note.updatedAt,
    },
    noteId,
  )
}

/** 无原始文件名的资源：mime 推断扩展名（image/png → <hash前8>.png） */
function enexResourceName(resource: EnexResource): string {
  const ext = resource.mime.split('/')[1]?.replace(/[^a-z0-9]/gi, '') ?? 'bin'
  return `${resource.hash.slice(0, 8)}.${ext}`
}

// ———— F-804：Notion 导出 zip（页面树 + 数据库 csv） ————————————————————

async function importNotionZip(paths: string[], entries: Unzipped, summary: ImportSummary): Promise<void> {
  // 资源表：路径 / 解码路径 / 文件名 三键（Notion 引用多为与 md 同目录的相对路径或裸文件名）
  const assets = new Map<string, { name: string; mime: string; bytes: Uint8Array }>()
  for (const path of paths) {
    if (/\.(md|csv)$/i.test(path)) continue
    const bytes = entries[path]!
    const entry = { name: path.split('/').pop() ?? path, mime: mimeByName(path) ?? 'application/octet-stream', bytes }
    assets.set(path, entry)
    const decoded = safeDecode(path)
    assets.set(decoded, entry)
    assets.set(entry.name, entry)
  }

  const mdFiles = new Map<string, string>()
  for (const path of paths) {
    if (/\.md$/i.test(path)) mdFiles.set(path, strFromU8(entries[path]!))
  }
  // 页面树装配（解析层不做附件映射）：先只做结构解析与去链，图片重链在拿到附件 id 后二次替换
  const pagePlans = planNotionPages(mdFiles)
  for (const plan of pagePlans) {
    if (plan.content.trim() === '' && plan.title === '') continue
    try {
      const noteId = createId()
      const hrefMap = new Map<string, string>()
      for (const href of new Set(collectImageHrefs(plan.content))) {
        const decoded = safeDecode(href)
        const entry = assets.get(href) ?? assets.get(decoded) ?? assets.get(decoded.split('/').pop() ?? '')
        if (entry === undefined) continue
        const ref = await writeImageAttachment(noteId, entry.name, entry.mime, new Blob([entry.bytes]))
        if (ref === null) {
          skipped(summary, `${plan.title} → ${entry.name}`, t('import.reasonAttachmentSkipped'))
          continue
        }
        summary.attachmentsCreated++
        hrefMap.set(href, ref)
        hrefMap.set(decoded, ref)
      }
      const content = relinkImageReferences(plan.content, (href) => hrefMap.get(href) ?? hrefMap.get(safeDecode(href)) ?? null)
      await writeNote(
        { title: plan.title, content, folderId: null, tags: [], createdAt: null, updatedAt: null },
        noteId,
      )
      summary.notesCreated++
    } catch (error) {
      failed(summary, plan.title, t('import.reasonWriteFailed', { msg: errorMessage(error) }))
    }
  }

  // 数据库 csv → 每行一篇
  for (const path of paths) {
    if (!/\.csv$/i.test(path)) continue
    const csvName = (path.split('/').pop() ?? path).replace(/\.csv$/i, '')
    const { rows, skipped: rowSkipped } = planNotionDatabase(strFromU8(entries[path]!))
    for (let i = 0; i < rowSkipped; i++) skipped(summary, csvName, t('import.reasonEmptyRow'))
    for (const row of rows) {
      try {
        await writeNote({
          title: row.title,
          content: row.content,
          folderId: null,
          tags: row.tags,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
        })
        summary.notesCreated++
      } catch (error) {
        failed(summary, row.title, t('import.reasonWriteFailed', { msg: errorMessage(error) }))
      }
    }
  }
}
