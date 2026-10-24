// @vitest-environment node
import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/lib/db/db'
import { noteRepository } from '@/lib/db/repositories/noteRepository'
import type { Note, NoteMeta } from '@/types'

const CONTENT = '内容'

function makeMeta(id: string, updatedAt: number, trashed = false): NoteMeta {
  return {
    id,
    title: `标题-${id}`,
    excerpt: `摘要-${id}`,
    folderId: null,
    tags: [],
    pinned: false,
    trashed,
    trashedAt: trashed ? updatedAt : null,
    createdAt: updatedAt,
    updatedAt,
  }
}

function makeNote(id: string, updatedAt: number, trashed = false): Note {
  return { ...makeMeta(id, updatedAt, trashed), content: `内容-${id}` }
}

/** 写入完整笔记（元数据 + 正文）；excerpt 由 saveWithContent 依正文重算 */
async function seed(note: Note): Promise<void> {
  const { content, ...meta } = note
  await noteRepository.saveWithContent({ ...meta, excerpt: content }, content)
}

beforeEach(async () => {
  await Promise.all([db.notes.clear(), db.contents.clear()])
})

describe('noteRepository（F-107，经 fake-indexeddb 走真实 Dexie 路径）', () => {
  it('保存后可按 id 读取；正文与元数据分离存储（F-523）', async () => {
    await seed(makeNote('n1', 100))
    expect((await noteRepository.get('n1'))?.title).toBe('标题-n1')
    expect(await noteRepository.getContent('n1')).toBe('内容-n1')
    // notes 表行不含正文
    expect((await db.notes.get('n1'))).not.toHaveProperty('content')
  })

  it('getContent：contents 行缺失视为空正文', async () => {
    await noteRepository.saveMeta(makeMeta('n1', 100))
    expect(await noteRepository.getContent('n1')).toBe('')
  })

  it('listActive 仅返回未删除笔记并按 updatedAt 倒序；列表行不含正文', async () => {
    await seed(makeNote('n1', 100))
    await seed(makeNote('n2', 300))
    await seed(makeNote('n3', 200))
    await seed(makeNote('n4', 400, true))
    const list = await noteRepository.listActive()
    expect(list.map((note) => note.id)).toEqual(['n2', 'n3', 'n1'])
    expect(list[0]).not.toHaveProperty('content')
  })

  it('listActiveWithContent 返回含正文的完整笔记（F-304 全部导出口径）', async () => {
    await seed(makeNote('n1', 100))
    const notes = await noteRepository.listActiveWithContent()
    expect(notes).toHaveLength(1)
    expect(notes[0]).toMatchObject({ id: 'n1', content: '内容-n1' })
    expect(notes[0]).not.toHaveProperty('excerpt')
  })

  it('saveWithContent 以传入正文统一重算 excerpt', async () => {
    await noteRepository.saveWithContent(makeMeta('n1', 100), '# 标题行\n\n正文内容')
    expect((await noteRepository.get('n1'))?.excerpt).toBe('标题行 正文内容')
  })

  it('softDelete 打回收站标记而不丢数据（F-101 软删除）', async () => {
    await seed(makeNote('n1', 100))
    await noteRepository.softDelete('n1')
    const trashed = await noteRepository.get('n1')
    expect(trashed?.trashed).toBe(true)
    expect(trashed?.trashedAt).toBeGreaterThan(0)
    expect(await noteRepository.getContent('n1')).toBe('内容-n1')
    expect(await noteRepository.listActive()).toEqual([])
  })

  it('saveMeta 对已存在 id 为整体覆盖（put 语义）', async () => {
    await noteRepository.saveMeta(makeMeta('n1', 100))
    await noteRepository.saveMeta({ ...makeMeta('n1', 200), title: '新标题' })
    const note = await noteRepository.get('n1')
    expect(note?.title).toBe('新标题')
    expect(note?.updatedAt).toBe(200)
  })

  it('saveMeta 接受 Proxy 包装的输入（回归：Vue reactive Proxy 触发 DataCloneError）', async () => {
    const proxy = new Proxy(makeMeta('n1', 100), {})
    await noteRepository.saveMeta(proxy)
    expect((await noteRepository.get('n1'))?.title).toBe('标题-n1')
  })

  it('deleteForever 级联删除正文、附件与快照', async () => {
    await seed(makeNote('n1', 100))
    await db.attachments.put({
      id: 'a1', noteId: 'n1', name: 'pic.png', mime: 'image/png',
      size: 3, blob: new Blob([CONTENT]), createdAt: 100,
    })
    await db.snapshots.put({ id: 's1', noteId: 'n1', content: '内容-n1', createdAt: 100 })
    await noteRepository.deleteForever('n1')
    expect(await noteRepository.get('n1')).toBeUndefined()
    expect(await db.contents.get('n1')).toBeUndefined()
    expect(await db.attachments.get('a1')).toBeUndefined()
    expect(await db.snapshots.get('s1')).toBeUndefined()
  })

  it('emptyTrash 级联删除回收站笔记的正文', async () => {
    await seed(makeNote('n1', 100, true))
    await noteRepository.emptyTrash()
    expect(await noteRepository.get('n1')).toBeUndefined()
    expect(await db.contents.get('n1')).toBeUndefined()
  })

  it('purgeExpiredBefore 级联删除过期回收站笔记的正文', async () => {
    await seed(makeNote('n1', 100, true))
    const purged = await noteRepository.purgeExpiredBefore(200)
    expect(purged).toBe(1)
    expect(await db.contents.get('n1')).toBeUndefined()
  })
})
