import { db } from '../db'
import type { Note } from '@/types'

/** 笔记数据访问：组件与 store 不直接触碰 IndexedDB，一律经此层（架构文档 3.2） */
export const noteRepository = {
  async listActive(): Promise<Note[]> {
    const all = await db.notes.toArray()
    return all.filter((note) => !note.trashed).sort((a, b) => b.updatedAt - a.updatedAt)
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
}
