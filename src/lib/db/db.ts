import Dexie, { type Table } from 'dexie'
import type { Folder, Note, Setting } from '@/types'

export class TinyNoteDB extends Dexie {
  notes!: Table<Note, string>
  folders!: Table<Folder, string>
  settings!: Table<Setting, string>

  constructor(name = 'tinynote') {
    super(name)
    this.version(1).stores({
      // ADR-008：boolean/null 不是合法 IndexedDB 键，不索引 trashed 字段；
      // 回收站查询走 trashedAt 数值索引（未删除笔记的 null 值不会进入该索引）。
      // 已发布的 schema 只允许追加新 version，禁止修改既有定义。
      notes: 'id, folderId, updatedAt, *tags, trashedAt',
      folders: 'id, name, order',
      settings: 'key',
    })
  }
}

export const db = new TinyNoteDB()
