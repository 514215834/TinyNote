import { db } from '../db'
import type { Note } from '@/types'

/** 笔记数据访问：组件与 store 不直接触碰 IndexedDB，一律经此层（架构文档 3.2） */
export const noteRepository = {
  async listActive(): Promise<Note[]> {
    const all = await db.notes.toArray()
    return all.filter((note) => !note.trashed).sort((a, b) => b.updatedAt - a.updatedAt)
  },

  /** 回收站列表（F-204）：按进入回收站的时间倒序 */
  async listTrashed(): Promise<Note[]> {
    const all = await db.notes.toArray()
    return all.filter((note) => note.trashed).sort((a, b) => (b.trashedAt ?? 0) - (a.trashedAt ?? 0))
  },

  async get(id: string): Promise<Note | undefined> {
    return db.notes.get(id)
  },

  async save(note: Note): Promise<void> {
    // 落库前拍平为纯数据对象：调用方可能传入 Vue reactive Proxy，
    // IndexedDB 的结构化克隆不支持 Proxy（会抛 DataCloneError）
    await db.notes.put({ ...note, tags: [...note.tags] })
  },

  async softDelete(id: string): Promise<void> {
    await db.notes.update(id, { trashed: true, trashedAt: Date.now() })
  },

  /**
   * 恢复（F-204）：只清软删标记。folderId/tags/pinned 等字段原样保留——
   * 这是验收要点「恢复后笔记回到原文件夹且标签完整」的实现。
   */
  async restore(id: string): Promise<void> {
    await db.notes.update(id, { trashed: false, trashedAt: null })
  },

  /** 全量列表（F-305 备份导出）：不做软删过滤，含回收站中的笔记 */
  async listAll(): Promise<Note[]> {
    return db.notes.toArray()
  },

  /** 彻底删除（F-204）：物理删除，不可恢复；同事务连带删除该笔记的附件（F-303）与历史快照（F-402） */
  async deleteForever(id: string): Promise<void> {
    await db.transaction('rw', db.notes, db.attachments, db.snapshots, async () => {
      await db.notes.delete(id)
      await db.attachments.where('noteId').equals(id).delete()
      await db.snapshots.where('noteId').equals(id).delete()
    })
  },

  /** 清空回收站（F-204）：trashedAt 数值索引恰好等价于回收站全集（ADR-008）；同事务清理附件与快照 */
  async emptyTrash(): Promise<void> {
    const ids = await db.notes.where('trashedAt').above(0).primaryKeys()
    await db.transaction('rw', db.notes, db.attachments, db.snapshots, async () => {
      await db.notes.bulkDelete(ids)
      await db.attachments.where('noteId').anyOf([...ids]).delete()
      await db.snapshots.where('noteId').anyOf([...ids]).delete()
    })
  },

  /**
   * F-204 启动惰性清理：物理删除进入回收站早于 cutoff 的笔记（及其附件、历史快照）。
   * 与 trash.ts 的 isPurgeExpired 采用同一语义（≤ cutoff 视为过期）。
   */
  async purgeExpiredBefore(cutoff: number): Promise<number> {
    const ids = await db.notes.where('trashedAt').belowOrEqual(cutoff).primaryKeys()
    await db.transaction('rw', db.notes, db.attachments, db.snapshots, async () => {
      await db.notes.bulkDelete(ids)
      await db.attachments.where('noteId').anyOf([...ids]).delete()
      await db.snapshots.where('noteId').anyOf([...ids]).delete()
    })
    return ids.length
  },
}
