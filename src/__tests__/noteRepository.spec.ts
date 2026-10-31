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

  // ———— F-1005 标签全库操作 ————
  describe('标签全库操作（F-1005）', () => {
    it('renameTagEverywhere：活跃与回收站笔记都替换；updatedAt 不刷新', async () => {
      await seed(makeNote('n1', 100))
      await seed(makeNote('n2', 200, true))
      const n1 = makeNote('n1', 100)
      n1.tags = ['work', 'life']
      await seed(n1)
      const n2 = makeNote('n2', 200, true)
      n2.tags = ['WORK']
      await seed(n2)

      const touched = await noteRepository.renameTagEverywhere('Work', '深度工作')
      expect(touched).toBe(2)
      expect((await db.notes.get('n1'))?.tags).toEqual(['深度工作', 'life'])
      expect((await db.notes.get('n2'))?.tags).toEqual(['深度工作'])
      expect((await db.notes.get('n1'))?.updatedAt).toBe(100) // 列表不因此重排
    })

    it('mergeTagEverywhere：source 注入 into 并去重', async () => {
      const n1 = makeNote('n1', 100)
      n1.tags = ['a', 'b']
      await seed(n1)
      await noteRepository.mergeTagEverywhere('a', 'b')
      expect((await db.notes.get('n1'))?.tags).toEqual(['b'])
    })

    it('removeTagEverywhere：清引用、笔记保留', async () => {
      const n1 = makeNote('n1', 100)
      n1.tags = ['x', 'y']
      await seed(n1)
      const touched = await noteRepository.removeTagEverywhere('X')
      expect(touched).toBe(1)
      const meta = await db.notes.get('n1')
      expect(meta?.tags).toEqual(['y'])
      expect(await noteRepository.getContent('n1')).toBe('内容-n1')
    })

    it('无命中的标签操作不写任何笔记', async () => {
      await seed(makeNote('n1', 100))
      expect(await noteRepository.renameTagEverywhere('ghost', '新')).toBe(0)
      expect(await noteRepository.removeTagEverywhere('ghost')).toBe(0)
    })
  })

  describe('replaceTitleReferences（F-701 重命名迁移）', () => {
    it('全库替换引用并保留别名；返回受影响笔记 id；excerpt 重算', async () => {
      await seed(makeNote('n1', 100))
      await db.contents.put({ id: 'n1', content: '引用 [[标题-n2|备注]] 与 [[标题-n2]]' })
      await seed(makeNote('n2', 100))
      await seed(makeNote('n3', 100))
      await db.contents.put({ id: 'n3', content: '无关正文' })

      const { touched, ids } = await noteRepository.replaceTitleReferences('标题-n2', '改名-n2')
      expect(touched).toBe(2)
      expect(ids).toEqual(['n1'])
      expect(await noteRepository.getContent('n1')).toBe('引用 [[改名-n2|备注]] 与 [[改名-n2]]')
      // excerpt 随新正文重算（列表摘要口径依赖它；makeExcerpt 会剥去 - 等标记符号）
      expect((await noteRepository.get('n1'))?.excerpt).toContain('[[改名 n2 备注]]')
    })

    it('回收站笔记的正文一并迁移（恢复后引用语义复原）', async () => {
      await seed(makeNote('n1', 100, true))
      await db.contents.put({ id: 'n1', content: '引用 [[标题-n2]]' })
      await seed(makeNote('n2', 100))

      const { touched } = await noteRepository.replaceTitleReferences('标题-n2', '改名-n2')
      expect(touched).toBe(1)
      expect(await noteRepository.getContent('n1')).toBe('引用 [[改名-n2]]')
    })

    it('无命中时返回空结果且不改写任何正文', async () => {
      await seed(makeNote('n1', 100))
      const { touched, ids } = await noteRepository.replaceTitleReferences('不存在', '新标题')
      expect(touched).toBe(0)
      expect(ids).toEqual([])
      expect(await noteRepository.getContent('n1')).toBe('内容-n1')
    })
  })
})
