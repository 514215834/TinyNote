import { db } from '../db'
import type { Attachment, Folder, Note } from '@/types'
import { makeExcerpt } from '@/features/notes/notes'
import { noteRepository } from './noteRepository'

/** 备份导出/恢复的数据口径（架构文档 3.1 DATA 层 D4 BackupPort） */
export interface LibrarySnapshot {
  folders: Folder[]
  notes: Note[]
  attachments: Attachment[]
}

/**
 * 备份相关的存储访问：组件与 store 不直接触碰 IndexedDB（架构文档 3.2）。
 * F-523 起 notes 表只存元数据，导出时与 contents 表 join 成完整 Note（备份格式 schemaVersion 2 不变），
 * 恢复时反向拆分。restore 为全量覆盖语义：在单事务内清空各表再整批写入，失败自动回滚。
 * 注意：快照（F-402）是本地编辑历史，不进入备份导出口径，但恢复时一并清空。
 */
export const backupPort = {
  async snapshot(): Promise<LibrarySnapshot> {
    const [folders, metas, contents, attachments] = await Promise.all([
      db.folders.toArray(),
      db.notes.toArray(),
      db.contents.toArray(),
      db.attachments.toArray(),
    ])
    const contentById = new Map(contents.map((row) => [row.id, row.content]))
    const notes = metas.map((meta) => noteRepository.toNote(meta, contentById.get(meta.id) ?? ''))
    return { folders, notes, attachments }
  },

  async restore(data: LibrarySnapshot): Promise<void> {
    await db.transaction(
      'rw',
      db.notes,
      db.contents,
      db.folders,
      db.attachments,
      db.snapshots,
      async () => {
        await db.notes.clear()
        await db.contents.clear()
        await db.folders.clear()
        await db.attachments.clear()
        await db.snapshots.clear()
        await db.folders.bulkPut(data.folders.map((folder) => ({ ...folder })))
        await db.contents.bulkPut(
          data.notes.map((note) => ({ id: note.id, content: note.content })),
        )
        await db.notes.bulkPut(
          data.notes.map((note) => {
            const { content, ...rest } = note
            return { ...rest, tags: [...note.tags], excerpt: makeExcerpt(content) }
          }),
        )
        await db.attachments.bulkPut(data.attachments.map((attachment) => ({ ...attachment })))
      },
    )
  },

  /** F-522 清空全部数据：单事务清空全部六张表（settings 同清，UI 偏好的 localStorage 由调用方处理） */
  async wipe(): Promise<void> {
    await db.transaction('rw', db.tables, async () => {
      await Promise.all(db.tables.map((table) => table.clear()))
    })
  },

  /**
   * F-501 同步合并结果落库：与 restore 同为全量覆盖语义（合并输出即全量库），
   * 但不动历史快照与 settings——同步是合并而非还原，本机编辑历史应保留。
   * deletedNoteIds 为远端删除传播在本机物理删除的笔记，其遗留快照一并清理。
   */
  async applySyncLibrary(data: LibrarySnapshot, deletedNoteIds: string[] = []): Promise<void> {
    await db.transaction(
      'rw',
      db.notes,
      db.contents,
      db.folders,
      db.attachments,
      db.snapshots,
      async () => {
        await db.notes.clear()
        await db.contents.clear()
        await db.folders.clear()
        await db.attachments.clear()
        await db.folders.bulkPut(data.folders.map((folder) => ({ ...folder })))
        await db.contents.bulkPut(
          data.notes.map((note) => ({ id: note.id, content: note.content })),
        )
        await db.notes.bulkPut(
          data.notes.map((note) => {
            const { content, ...rest } = note
            return { ...rest, tags: [...note.tags], excerpt: makeExcerpt(content) }
          }),
        )
        await db.attachments.bulkPut(data.attachments.map((attachment) => ({ ...attachment })))
        if (deletedNoteIds.length > 0) {
          await db.snapshots.where('noteId').anyOf([...deletedNoteIds]).delete()
        }
      },
    )
  },
}
