import { db } from '../db'
import type { NoteSnapshot } from '@/types'

/** 历史版本快照数据访问（F-402）：组件与 store 不直接触碰 IndexedDB */
export const snapshotRepository = {
  /** 按创建时间倒序（最新在前） */
  async listByNote(noteId: string): Promise<NoteSnapshot[]> {
    const rows = await db.snapshots.where('noteId').equals(noteId).toArray()
    return rows.sort((a, b) => b.createdAt - a.createdAt)
  },

  async save(snapshot: NoteSnapshot): Promise<void> {
    await db.snapshots.put({ ...snapshot })
  },

  async deleteByIds(ids: string[]): Promise<void> {
    if (ids.length > 0) await db.snapshots.bulkDelete(ids)
  },

  /**
   * 保留上限裁剪（F-402）：超出 limit 的最旧快照被删除。
   * 返回被删除的 id，便于调用方同步内存缓存。
   */
  async pruneToLimit(noteId: string, limit: number): Promise<string[]> {
    const rows = await db.snapshots.where('noteId').equals(noteId).toArray()
    const overflow = rows.sort((a, b) => b.createdAt - a.createdAt).slice(limit)
    const ids = overflow.map((row) => row.id)
    if (ids.length > 0) await db.snapshots.bulkDelete(ids)
    return ids
  },
}
