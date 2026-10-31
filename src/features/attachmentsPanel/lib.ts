import { db } from '@/lib/db/db'
import { attachmentRepository } from '@/lib/db/repositories/attachmentRepository'
import { extractAttachmentIds } from '@/lib/markdown/attachmentRef'
import { displayTitle } from '@/features/notes/notes'

/**
 * 附件管理面板的数据层（F-1004）：全库附件清单与引用状态分类。
 *
 * 引用口径（与 F-406 自动清理一致且更保守）：附件被**全库任一正文**或**全库任一
 * 历史快照**引用即保留——正文引用 → content；仅快照引用 → snapshot（不算孤儿，
 * 回滚依赖附件存在）；两者皆无 → orphan。面板口径 ⊆ F-406 逐篇口径，
 * 不会误删自动清理尚未触达的附件。
 *
 * 扫描为流式游标（contents/snapshots 逐行 visit），不整库驻留内存（F-523 同原则）。
 */

export type AttachmentRefState = 'content' | 'snapshot' | 'orphan'

export interface AttachmentRow {
  id: string
  noteId: string
  name: string
  mime: string
  size: number
  createdAt: number
  state: AttachmentRefState
  /** 归属笔记标题（null = 笔记已不在库中） */
  noteTitle: string | null
}

export interface AttachmentLibraryScan {
  contentRefs: Set<string>
  snapshotRefs: Set<string>
}

/** 全库引用扫描：正文引用集 + 快照引用集（游标流式） */
export async function scanAttachmentReferences(): Promise<AttachmentLibraryScan> {
  const contentRefs = new Set<string>()
  await db.contents.each((row) => {
    for (const id of extractAttachmentIds(row.content)) contentRefs.add(id)
  })
  const snapshotRefs = new Set<string>()
  await db.snapshots.each((row) => {
    for (const id of extractAttachmentIds(row.content)) snapshotRefs.add(id)
  })
  return { contentRefs, snapshotRefs }
}

/** 装配面板行：附件清单 + 引用状态 + 归属笔记标题（孤儿优先，组内按创建时间倒序） */
export async function collectAttachmentRows(scan: AttachmentLibraryScan): Promise<AttachmentRow[]> {
  const [notes, attachments] = await Promise.all([db.notes.toArray(), attachmentRepository.listAll()])
  const titleById = new Map(notes.map((note) => [note.id, displayTitle(note)]))
  const rows: AttachmentRow[] = attachments.map((attachment) => ({
    id: attachment.id,
    noteId: attachment.noteId,
    name: attachment.name,
    mime: attachment.mime,
    size: attachment.size,
    createdAt: attachment.createdAt,
    state: scan.contentRefs.has(attachment.id)
      ? 'content'
      : scan.snapshotRefs.has(attachment.id)
        ? 'snapshot'
        : 'orphan',
    noteTitle: titleById.get(attachment.noteId) ?? null,
  }))
  const stateOrder: Record<AttachmentRefState, number> = { orphan: 0, snapshot: 1, content: 2 }
  return rows.sort(
    (a, b) => stateOrder[a.state] - stateOrder[b.state] || b.createdAt - a.createdAt,
  )
}

/** 孤儿行集合（清理目标） */
export function orphanRows(rows: AttachmentRow[]): AttachmentRow[] {
  return rows.filter((row) => row.state === 'orphan')
}

/** 清理可释放的存储量（字节合计，确认弹窗提示用） */
export function freedBytes(rows: AttachmentRow[]): number {
  return rows.reduce((total, row) => total + row.size, 0)
}
