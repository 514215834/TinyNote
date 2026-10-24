import { db } from '../db'
import type { Note, NoteMeta } from '@/types'
import { makeExcerpt } from '@/features/notes/notes'

/** 笔记数据访问：组件与 store 不直接触碰 IndexedDB，一律经此层（架构文档 3.2）。
 *  F-523 起列表只读元数据（NoteMeta），正文按需走 getContent / saveWithContent。 */
export const noteRepository = {
  async listActive(): Promise<NoteMeta[]> {
    const all = await db.notes.toArray()
    return all.filter((note) => !note.trashed).sort((a, b) => b.updatedAt - a.updatedAt)
  },

  /** 回收站列表（F-204）：按进入回收站的时间倒序 */
  async listTrashed(): Promise<NoteMeta[]> {
    const all = await db.notes.toArray()
    return all.filter((note) => note.trashed).sort((a, b) => (b.trashedAt ?? 0) - (a.trashedAt ?? 0))
  },

  /** 活动笔记全量含正文（F-304 全部导出等确需正文的场景）：元数据 join contents */
  async listActiveWithContent(): Promise<Note[]> {
    const [metas, contents] = await Promise.all([this.listActive(), db.contents.toArray()])
    const contentById = new Map(contents.map((row) => [row.id, row.content]))
    return metas.map((meta) => this.toNote(meta, contentById.get(meta.id) ?? ''))
  },

  async get(id: string): Promise<NoteMeta | undefined> {
    return db.notes.get(id)
  },

  /** 正文按需读取（F-523）：contents 表与 notes 按 id 1:1，缺失视为空正文 */
  async getContent(id: string): Promise<string> {
    return (await db.contents.get(id))?.content ?? ''
  },

  /** 仅元数据写（F-201/F-202/F-203 等不触碰正文的操作） */
  async saveMeta(meta: NoteMeta): Promise<void> {
    // 落库前拍平为纯数据对象：调用方可能传入 Vue reactive Proxy，
    // IndexedDB 的结构化克隆不支持 Proxy（会抛 DataCloneError）
    await db.notes.put({ ...meta, tags: [...meta.tags] })
  },

  /** 元数据 + 正文同事务写（编辑器保存路径，F-523）：excerpt 以传入正文为准在此统一重算 */
  async saveWithContent(meta: NoteMeta, content: string): Promise<void> {
    await db.transaction('rw', db.notes, db.contents, async () => {
      await this.saveMeta({ ...meta, excerpt: makeExcerpt(content) })
      await db.contents.put({ id: meta.id, content })
    })
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

  /** 彻底删除（F-204）：物理删除，不可恢复；同事务连带删除正文（F-523）、附件（F-303）与历史快照（F-402） */
  async deleteForever(id: string): Promise<void> {
    await db.transaction('rw', db.notes, db.contents, db.attachments, db.snapshots, async () => {
      await db.notes.delete(id)
      await db.contents.delete(id)
      await db.attachments.where('noteId').equals(id).delete()
      await db.snapshots.where('noteId').equals(id).delete()
    })
  },

  /** 清空回收站（F-204）：trashedAt 数值索引恰好等价于回收站全集（ADR-008）；同事务清理正文、附件与快照 */
  async emptyTrash(): Promise<void> {
    const ids = await db.notes.where('trashedAt').above(0).primaryKeys()
    await db.transaction('rw', db.notes, db.contents, db.attachments, db.snapshots, async () => {
      await db.notes.bulkDelete(ids)
      await db.contents.bulkDelete(ids)
      await db.attachments.where('noteId').anyOf([...ids]).delete()
      await db.snapshots.where('noteId').anyOf([...ids]).delete()
    })
  },

  /**
   * F-204 启动惰性清理：物理删除进入回收站早于 cutoff 的笔记（及其正文、附件、历史快照）。
   * 与 trash.ts 的 isPurgeExpired 采用同一语义（≤ cutoff 视为过期）。
   */
  async purgeExpiredBefore(cutoff: number): Promise<number> {
    const ids = await db.notes.where('trashedAt').belowOrEqual(cutoff).primaryKeys()
    await db.transaction('rw', db.notes, db.contents, db.attachments, db.snapshots, async () => {
      await db.notes.bulkDelete(ids)
      await db.contents.bulkDelete(ids)
      await db.attachments.where('noteId').anyOf([...ids]).delete()
      await db.snapshots.where('noteId').anyOf([...ids]).delete()
    })
    return ids.length
  },

  /** 元数据 + 正文 → 完整 Note（备份/导出口径，剥离 excerpt） */
  toNote(meta: NoteMeta, content: string): Note {
    const { excerpt: _excerpt, ...rest } = meta
    return { ...rest, tags: [...meta.tags], content }
  },
}
