import { attachmentRef, extractAttachmentIds } from '@/lib/markdown/attachmentRef'
import { createId } from '@/lib/utils/id'
import { t } from '@/lib/i18n'
import type { Attachment } from '@/types'

/**
 * 编辑器侧的附件操作（F-303）：粘贴 / 拖入图片 → 落库为 Attachment → 正文插入内部引用。
 * 本文件为纯函数（可单测）；落库走 attachments store（Pinia）。
 */

/** 单附件体积上限：黏贴超大截图时直接拒绝（架构文档 §10 单文件过大风险） */
export const MAX_ATTACHMENT_SIZE = 10 * 1024 * 1024

/**
 * 附件准入白名单（F-1003，由 v0.3 仅图片扩展）：图片 + PDF + 纯文本 + 音频。
 * 大小上限沿用 10MB/个；孤儿清理、备份（fflate 二进制安全）、同步（base64 内联）口径自动兼容。
 */
export function isAttachableFile(file: { type: string; size: number }): boolean {
  if (file.size <= 0 || file.size > MAX_ATTACHMENT_SIZE) return false
  const type = file.type.toLowerCase()
  return (
    type.startsWith('image/') ||
    type.startsWith('audio/') ||
    type.startsWith('text/') ||
    type === 'application/pdf'
  )
}

/** 图片文件判定（旧口径，data: 内嵌图等确定是图片的场景仍用）：仅接受 image/* MIME 且体积未超限 */
export function isImageFile(file: { type: string; size: number }): boolean {
  return file.type.startsWith('image/') && file.size > 0 && file.size <= MAX_ATTACHMENT_SIZE
}

/** 把剪贴板 / 拖拽文件列表中可入库的附件文件取出来（事件里的 File 对象原样透传） */
export function pickAttachableFiles(files: Iterable<File>): File[] {
  return Array.from(files).filter((file) => isAttachableFile(file))
}

/**
 * 生成要插入正文的附件 Markdown（F-1003）：
 * 图片走 `![alt](引用)`（预览为图片）；非图片（PDF/文本/音频）走 `[名称](引用)`
 * （预览为附件卡片）。名称只用于 alt/文案，需剥除可能破坏语法的方括号。
 */
export function makeAttachmentMarkdown(id: string, name: string, mime: string): string {
  const label = name.trim().replace(/[[\]]/g, ' ').trim() || t('common.attachment')
  if (mime.toLowerCase().startsWith('image/')) {
    return `![${label}](${attachmentRef(id)})`
  }
  return `[${label}](${attachmentRef(id)})`
}

/** 从 File 产出完整 Attachment 实体（id 默认由 createId 生成，F-303） */
export function buildAttachment(file: File, noteId: string, id: string = createId()): Attachment {
  return {
    id,
    noteId,
    name: file.name || 'attachment',
    mime: file.type,
    size: file.size,
    blob: file,
    createdAt: Date.now(),
  }
}

/** 在指定插入点写入文本：返回新文本与插入后的光标位置（编辑器 dispatch 用） */
export function insertIntoText(
  source: string,
  pos: number,
  insert: string,
): { text: string; caret: number } {
  const at = Math.max(0, Math.min(pos, source.length))
  return {
    text: source.slice(0, at) + insert + source.slice(at),
    caret: at + insert.length,
  }
}

/** 把事件中的文件流转成可插入的 Markdown 序列（逐文件生成 Attachment 实体） */
export function filesToInsertions(files: File[], noteId: string): { attachment: Attachment; markdown: string }[] {
  return pickAttachableFiles(files).map((file) => {
    const attachment = buildAttachment(file, noteId)
    return { attachment, markdown: makeAttachmentMarkdown(attachment.id, attachment.name, attachment.mime) }
  })
}

/**
 * 孤儿附件判定（F-406）：正文与全部历史快照内容都不再引用的附件 id。
 * 快照回滚依赖附件仍存在，因此「被快照引用」与「被正文引用」同等保留。
 */
export function orphanAttachmentIds(
  existing: Pick<Attachment, 'id'>[],
  keepContents: string[],
): string[] {
  const referenced = new Set(keepContents.flatMap((content) => extractAttachmentIds(content)))
  return existing.filter((attachment) => !referenced.has(attachment.id)).map((attachment) => attachment.id)
}
