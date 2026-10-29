// @vitest-environment node
import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/lib/db/db'
import {
  backlinkRefsOf,
  buildLinksIndex,
  discardLinks,
  isLinksReady,
  outlinksOf,
  removeLinks,
  updateLinks,
} from '@/features/links/linkIndex'
import type { NoteMeta } from '@/types'

/** 直写数据库的种子：元数据 + 正文两行（F-523 分离后的存储形态） */
async function seedNote(id: string, title: string, content: string, trashed = false): Promise<void> {
  const meta: NoteMeta = {
    id,
    title,
    excerpt: '',
    folderId: null,
    tags: [],
    pinned: false,
    trashed,
    trashedAt: trashed ? 100 : null,
    createdAt: 100,
    updatedAt: 100,
  }
  await db.notes.put(meta)
  await db.contents.put({ id, content })
}

beforeEach(async () => {
  discardLinks()
  await Promise.all([db.notes.clear(), db.contents.clear()])
})

describe('linkIndex（F-702 内存派生链接索引）', () => {
  it('全量构建：反链/出链配对正确；回收站与孤儿正文不进索引', async () => {
    await seedNote('n1', '甲', '引用 [[乙]] 与 [[丙|别名]]')
    await seedNote('n2', '乙', '被引用')
    await seedNote('n3', '丙', '也被引用')
    await seedNote('n4', '丁', '回收站里的 [[乙]] 引用不产生有效反链', true)
    await seedNote('n5', '', '孤儿正文（无元数据配对）')
    await db.contents.put({ id: 'ghost', content: '[[乙]]' }) // notes 表无此行

    expect(await buildLinksIndex()).toBe(true)
    expect(isLinksReady()).toBe(true)

    expect(backlinkRefsOf('乙').map((ref) => ref.id)).toEqual(['n1']) // 丁在回收站，ghost 无元数据
    expect(backlinkRefsOf('丙').map((ref) => ref.id)).toEqual(['n1'])
    expect(backlinkRefsOf('甲')).toEqual([])

    expect(outlinksOf('n1')?.map((link) => link.target)).toEqual(['乙', '丙'])
    expect(outlinksOf('n2')).toEqual([])
    expect(outlinksOf('n4')).toBeUndefined() // 回收站笔记不登记
  })

  it('增量更新：保存路径 updateLinks 重登记，旧引用随之消失', async () => {
    await seedNote('n1', '甲', '引用 [[乙]]')
    await seedNote('n2', '乙', '')
    await buildLinksIndex()
    expect(backlinkRefsOf('乙').map((ref) => ref.id)).toEqual(['n1'])

    updateLinks('n1', '甲', '改写后引用 [[丙]]')
    expect(backlinkRefsOf('乙')).toEqual([])
    expect(backlinkRefsOf('丙').map((ref) => ref.id)).toEqual(['n1'])
    expect(outlinksOf('n1')?.map((link) => link.target)).toEqual(['丙'])
  })

  it('摘除 removeLinks 后该笔记的全部反链/出链消失', async () => {
    await seedNote('n1', '甲', '引用 [[乙]]')
    await seedNote('n2', '乙', '')
    await buildLinksIndex()
    removeLinks('n1')
    expect(backlinkRefsOf('乙')).toEqual([])
    expect(outlinksOf('n1')).toBeUndefined()
  })

  it('索引未就绪时增量静默跳过（启动窗口期不出错）', () => {
    updateLinks('n1', '甲', '引用 [[乙]]')
    expect(isLinksReady()).toBe(false)
    expect(outlinksOf('n1')).toBeUndefined()
  })

  it('discardLinks 后由重建恢复一致（同步整库刷新口径）', async () => {
    await seedNote('n1', '甲', '引用 [[乙]]')
    await seedNote('n2', '乙', '')
    await buildLinksIndex()
    discardLinks()
    expect(isLinksReady()).toBe(false)
    expect(backlinkRefsOf('乙')).toEqual([])

    await buildLinksIndex()
    expect(backlinkRefsOf('乙').map((ref) => ref.id)).toEqual(['n1'])
  })

  it('同名多篇引用同一目标：反链去重按笔记计', async () => {
    await seedNote('n1', '甲', '[[乙]] 与 [[乙|别名]]')
    await seedNote('n2', '乙', '')
    await buildLinksIndex()
    expect(backlinkRefsOf('乙')).toHaveLength(1)
    expect(outlinksOf('n1')).toHaveLength(2)
  })
})
