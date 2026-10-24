import Dexie, { type Table } from 'dexie'
import type { Attachment, Folder, NoteContent, NoteMeta, NoteSnapshot, Setting } from '@/types'
import { makeExcerpt } from '@/features/notes/notes'

export class TinyNoteDB extends Dexie {
  notes!: Table<NoteMeta, string>
  folders!: Table<Folder, string>
  settings!: Table<Setting, string>
  attachments!: Table<Attachment, string>
  snapshots!: Table<NoteSnapshot, string>
  contents!: Table<NoteContent, string>

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
    this.version(4).stores({
      notes: 'id, folderId, updatedAt, *tags, trashedAt',
      folders: 'id, name, order',
      settings: 'key',
      attachments: 'id, noteId',
      snapshots: 'id, noteId, createdAt',
      // F-523：正文分离表（与 notes 按 id 1:1）。列表/搜索只读元数据，正文按需读取
      contents: 'id',
    }).upgrade(async (tx) => {
      // v3 → v4：notes.content 拆到 contents 表，notes 行改写为元数据（含保存时摘要）。
      // 一次性全量读入（与备份导出同量级），随后整批写回，避免边遍历边改写同一表。
      const notesTable = tx.table('notes')
      const rows: Array<{ id: string; content?: string }> = await notesTable.toArray()
      await tx.table('contents').bulkPut(rows.map((row) => ({ id: row.id, content: row.content ?? '' })))
      await notesTable.bulkPut(
        rows.map((row) => {
          const { content, ...meta } = row
          return { ...meta, excerpt: makeExcerpt(content ?? '') }
        }),
      )
    })
  }
}

export const db = new TinyNoteDB()
