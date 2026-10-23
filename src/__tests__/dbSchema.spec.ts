// @vitest-environment node
import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { afterEach, describe, expect, it } from 'vitest'
import { TinyNoteDB } from '@/lib/db/db'
import type { Note } from '@/types'

/** v0.1/v0.2 发布形态：只有 schema v1 的库定义（复刻 db.ts 的 v1 stores） */
class LegacyDB extends Dexie {
  notes: Dexie.Table
  constructor(name: string) {
    super(name)
    this.version(1).stores({
      notes: 'id, folderId, updatedAt, *tags, trashedAt',
      folders: 'id, name, order',
      settings: 'key',
    })
    this.notes = this.table('notes')
  }
}

const DB_NAME = 'tinynote-migration-test'
let opened: TinyNoteDB | undefined

afterEach(async () => {
  await opened?.close()
  opened = undefined
  await Dexie.delete(DB_NAME)
})

function makeNote(id: string): Note {
  return {
    id,
    title: `标题-${id}`,
    content: `内容-${id}`,
    folderId: null,
    tags: ['旧数据'],
    pinned: false,
    trashed: false,
    trashedAt: null,
    createdAt: 100,
    updatedAt: 100,
  }
}

describe('schema v1 → v2 迁移（F-303 追加 attachments 表，老数据零改造）', () => {
  it('已存在的 v1 库打开 v2：attachments 表就绪，既有笔记原样保留', async () => {
    const legacy = new LegacyDB(DB_NAME)
    await legacy.open()
    await legacy.notes.put(makeNote('n1'))
    await legacy.close()

    opened = new TinyNoteDB(DB_NAME)
    await opened.open()
    expect(opened.verno).toBe(2)
    expect(opened.tables.map((table) => table.name)).toContain('attachments')
    expect(await opened.notes.get('n1')).toMatchObject({ tags: ['旧数据'], content: '内容-n1' })
    expect(await opened.attachments.count()).toBe(0)
  })

  it('全新库直接落在 v2：三张表 + attachments 均可用', async () => {
    opened = new TinyNoteDB(DB_NAME)
    await opened.open()
    expect(opened.verno).toBe(2)
    const names = opened.tables.map((table) => table.name).sort()
    expect(names).toEqual(['attachments', 'folders', 'notes', 'settings'])
  })
})
