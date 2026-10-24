import Dexie, { type Table } from 'dexie'
import type { Attachment, Folder, Note, NoteSnapshot, Setting } from '@/types'

export class TinyNoteDB extends Dexie {
  notes!: Table<Note, string>
  folders!: Table<Folder, string>
  settings!: Table<Setting, string>
  attachments!: Table<Attachment, string>
  snapshots!: Table<NoteSnapshot, string>

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
    this.version(2).stores({
      notes: 'id, folderId, updatedAt, *tags, trashedAt',
      folders: 'id, name, order',
      settings: 'key',
      // F-303：图片等附件二进制表（schema v2 新增，见 types.Attachment）
      attachments: 'id, noteId',
    }).upgrade(async () => {
      // v1 → v2 只新增表，不改造既有数据，无需动作
    })
    this.version(3).stores({
      notes: 'id, folderId, updatedAt, *tags, trashedAt',
      folders: 'id, name, order',
      settings: 'key',
      attachments: 'id, noteId',
      // F-402：历史版本快照（schema v3 新增，noteId 索引供级联删除与按篇查询）
      snapshots: 'id, noteId, createdAt',
    }).upgrade(async () => {
      // v2 → v3 只新增表，不改造既有数据，无需动作
    })
  }
}

export const db = new TinyNoteDB()
