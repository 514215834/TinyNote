import { attachmentRef } from '@/lib/markdown/attachmentRef'
import { createId } from '@/lib/utils/id'
import type { Attachment } from '@/types'

/**
 * 编辑器侧的附件操作（F-303）：粘贴 / 拖入图片 → 落库为 Attachment → 正文插入内部引用。
 * 本文件为纯函数（可单测）；落库走 attachments store（Pinia）。
 */

/** 单附件体积上限：黏贴超大截图时直接拒绝（架构文档 §10 单文件过大风险） */
export const MAX_ATTACHMENT_SIZE = 10 * 1024 * 1024

/** 图片文件判定：仅接受 image/* MIME 且体积未超限 */
export function isImageFile(file: { type: string; size: number }): boolean {
  return file.type.startsWith('image/') && file.size > 0 && file.size <= MAX_ATTACHMENT_SIZE
}

/** 把剪贴板 / 拖拽文件列表中最前面的图片文件取出来（事件里的 File 对象原样透传） */
export function pickImageFiles(files: Iterable<File>): File[] {
  return Array.from(files).filter((file) => isImageFile(file))
}

/** 生成要插入正文的图片 Markdown（name 只用于 alt，需剥除可能破坏语法的方括号） */
export function makeImageMarkdown(id: string, name: string): string {
  const alt = name.trim().replace(/[[\]]/g, ' ').trim() || '图片'
  return `![${alt}](${attachmentRef(id)})`
}

/** 从 File 产出完整 Attachment 实体（id 默认由 createId 生成，F-303） */
export function buildAttachment(file: File, noteId: string, id: string = createId()): Attachment {
  return {
    id,
    noteId,
    name: file.name || 'image',
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
  return pickImageFiles(files).map((file) => {
    const attachment = buildAttachment(file, noteId)
    return { attachment, markdown: makeImageMarkdown(attachment.id, attachment.name) }
  })
}
