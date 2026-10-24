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

/** v0.3 发布形态：schema v2（notes/folders/settings/attachments） */
class LegacyDBv2 extends Dexie {
  notes: Dexie.Table
  attachments: Dexie.Table
  constructor(name: string) {
    super(name)
    this.version(1).stores({
      notes: 'id, folderId, updatedAt, *tags, trashedAt',
      folders: 'id, name, order',
      settings: 'key',
    })
    this.version(2).stores({
      notes: 'id, folderId, updatedAt, *tags, trashedAt',
      folders: 'id, name, order',
      settings: 'key',
      attachments: 'id, noteId',
    })
    this.notes = this.table('notes')
    this.attachments = this.table('attachments')
  }
}

/** v0.4 发布形态：schema v3（notes 行仍含全文 content） */
class LegacyDBv3 extends Dexie {
  notes: Dexie.Table
  attachments: Dexie.Table
  snapshots: Dexie.Table
  constructor(name: string) {
    super(name)
    this.version(1).stores({
      notes: 'id, folderId, updatedAt, *tags, trashedAt',
      folders: 'id, name, order',
      settings: 'key',
    })
    this.version(2).stores({
      notes: 'id, folderId, updatedAt, *tags, trashedAt',
      folders: 'id, name, order',
      settings: 'key',
      attachments: 'id, noteId',
    })
    this.version(3).stores({
      notes: 'id, folderId, updatedAt, *tags, trashedAt',
      folders: 'id, name, order',
      settings: 'key',
      attachments: 'id, noteId',
      snapshots: 'id, noteId, createdAt',
    })
    this.notes = this.table('notes')
    this.attachments = this.table('attachments')
    this.snapshots = this.table('snapshots')
  }
}

const DB_NAME = 'tinynote-migration-test'
let opened: TinyNoteDB | undefined

afterEach(async () => {
  await opened?.close()
  opened = undefined
  await Dexie.delete(DB_NAME)
})

function makeNote(id: string, overrides: Partial<Note> = {}): Note {
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
    ...overrides,
  }
}

describe('schema v1/v2 → v4 迁移（老库逐级升级，F-523 起正文分离）', () => {
  it('已存在的 v1 库打开当前版本：全部新表就绪，正文拆分到 contents 表', async () => {
    const legacy = new LegacyDB(DB_NAME)
    await legacy.open()
    await legacy.notes.put(makeNote('n1'))
    await legacy.close()

    opened = new TinyNoteDB(DB_NAME)
    await opened.open()
    expect(opened.verno).toBe(4)
    const names = opened.tables.map((table) => table.name).sort()
    expect(names).toEqual(['attachments', 'contents', 'folders', 'notes', 'settings', 'snapshots'])
    // 正文迁移至 contents，notes 行改造为元数据（含摘要）
    expect(await opened.contents.get('n1')).toEqual({ id: 'n1', content: '内容-n1' })
    expect(await opened.notes.get('n1')).toMatchObject({ tags: ['旧数据'], excerpt: '内容 n1' })
    expect(await opened.notes.get('n1')).not.toHaveProperty('content')
    expect(await opened.attachments.count()).toBe(0)
    expect(await opened.snapshots.count()).toBe(0)
  })

  it('已存在的 v2 库打开当前版本：笔记与附件原样保留', async () => {
    const legacy = new LegacyDBv2(DB_NAME)
    await legacy.open()
    await legacy.notes.put(makeNote('n1'))
    await legacy.attachments.put({
      id: 'a1',
      noteId: 'n1',
      name: 'pic.png',
      mime: 'image/png',
      size: 3,
      blob: new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }),
      createdAt: 100,
    })
    await legacy.close()

    opened = new TinyNoteDB(DB_NAME)
    await opened.open()
    expect(opened.verno).toBe(4)
    expect(await opened.contents.get('n1')).toEqual({ id: 'n1', content: '内容-n1' })
    expect((await opened.attachments.get('a1'))?.name).toBe('pic.png')
    expect(await opened.snapshots.count()).toBe(0)
  })

  it('全新库直接落在 v4：六张表均可用', async () => {
    opened = new TinyNoteDB(DB_NAME)
    await opened.open()
    expect(opened.verno).toBe(4)
    const names = opened.tables.map((table) => table.name).sort()
    expect(names).toEqual(['attachments', 'contents', 'folders', 'notes', 'settings', 'snapshots'])
  })
})

describe('schema v3 → v4 迁移（F-523 正文分离，含回收站笔记）', () => {
  it('notes.content 全部拆入 contents；notes 行改为元数据并计算摘要；trashed 笔记同样迁移', async () => {
    const legacy = new LegacyDBv3(DB_NAME)
    await legacy.open()
    await legacy.notes.put(makeNote('n1'))
    await legacy.notes.put(
      makeNote('n2', { trashed: true, trashedAt: 200, content: '# 欢迎使用\n\n这是**正文**。' }),
    )
    await legacy.close()

    opened = new TinyNoteDB(DB_NAME)
    await opened.open()
    expect(opened.verno).toBe(4)
    expect(await opened.contents.get('n1')).toEqual({ id: 'n1', content: '内容-n1' })
    expect(await opened.contents.get('n2')).toEqual({ id: 'n2', content: '# 欢迎使用\n\n这是**正文**。' })
    expect(await opened.notes.get('n1')).toMatchObject({ excerpt: '内容 n1' })
    // 摘要剥离 Markdown 标记
    expect(await opened.notes.get('n2')).toMatchObject({ trashed: true, excerpt: '欢迎使用 这是 正文 。' })
    expect(await opened.notes.get('n2')).not.toHaveProperty('content')
  })
})
