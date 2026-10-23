import { db } from '../db'
import type { Attachment, Folder, Note } from '@/types'

/** 备份导出/恢复的数据口径（架构文档 3.1 DATA 层 D4 BackupPort） */
export interface LibrarySnapshot {
  folders: Folder[]
  notes: Note[]
  attachments: Attachment[]
}

/**
 * 备份相关的存储访问：组件与 store 不直接触碰 IndexedDB（架构文档 3.2）。
 * restore 为全量覆盖语义：在单事务内清空三张表再整批写入，失败自动回滚。
 */
export const backupPort = {
  async snapshot(): Promise<LibrarySnapshot> {
    const [folders, notes, attachments] = await Promise.all([
      db.folders.toArray(),
      db.notes.toArray(),
      db.attachments.toArray(),
    ])
    return { folders, notes, attachments }
  },

  async restore(data: LibrarySnapshot): Promise<void> {
    await db.transaction(
      'rw',
      db.notes,
      db.folders,
      db.attachments,
      async () => {
        await db.notes.clear()
        await db.folders.clear()
        await db.attachments.clear()
        await db.folders.bulkPut(data.folders.map((folder) => ({ ...folder })))
        await db.notes.bulkPut(data.notes.map((note) => ({ ...note, tags: [...note.tags] })))
        await db.attachments.bulkPut(data.attachments.map((attachment) => ({ ...attachment })))
      },
    )
  },
}
