// @vitest-environment node
import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { db } from '@/lib/db/db'
import { rankContentHits, scanContents } from '@/features/search/engine'
import { useSearchStore } from '@/features/search/stores/search'
import { useNotesStore } from '@/features/notes/stores/notes'
import type { NoteMeta } from '@/types'

async function seedContent(id: string, content: string): Promise<void> {
  await db.contents.put({ id, content })
}

beforeEach(async () => {
  setActivePinia(createPinia())
  await db.contents.clear()
})

describe('scanContents（F-524 正文流式扫描）', () => {
  it('空查询与无命中返回空数组', async () => {
    await seedContent('n1', '包含 Vue 的正文')
    expect(await scanContents('   ')).toEqual([])
    expect(await scanContents('不存在的词')).toEqual([])
  })

  it('大小写不敏感命中，按表序产出命中笔记', async () => {
    await seedContent('a', 'hello VUE world')
    await seedContent('b', '一个 vue 两个 VUE')
    const hits = await scanContents('vue')
    expect(hits.map((hit) => hit.id)).toEqual(['a', 'b'])
  })

  it('positions 记录至多 hitsPerNote 个命中位置', async () => {
    await seedContent('n1', 'x 甲 x 甲 x 甲 x 甲')
    const hits = await scanContents('甲', { hitsPerNote: 3 })
    expect(hits).toHaveLength(1)
    expect(hits[0]!.positions).toHaveLength(3)
    expect(hits[0]!.positions).toEqual([2, 6, 10])
  })

  it('snippet 截取首命中上下文并标注省略号', async () => {
    await seedContent('n1', '前'.repeat(50) + '关键词' + '后'.repeat(50))
    const [hit] = await scanContents('关键词', { contextRadius: 4 })
    expect(hit!.snippet.startsWith('…')).toBe(true)
    expect(hit!.snippet.endsWith('…')).toBe(true)
    expect(hit!.snippet).toContain('关键词')
    expect(hit!.snippet.length).toBeLessThan(20)
  })

  it('命中在开头/结尾时对应侧无省略号', async () => {
    await db.contents.clear()
    await seedContent('n2', '关键词在开头')
    const [head] = await scanContents('关键词')
    expect(head!.snippet.startsWith('…')).toBe(false)
    await db.contents.clear()
    await seedContent('n3', '结尾是关键词')
    const [tail] = await scanContents('关键词')
    expect(tail!.snippet.endsWith('…')).toBe(false)
  })

  it('limit 达到后停止扫描（游标中止）', async () => {
    for (let i = 0; i < 5; i++) await seedContent(`n${i}`, '命中词')
    const hits = await scanContents('命中词', { limit: 3 })
    expect(hits).toHaveLength(3)
  })

  it('isCancelled 取消后返回空（陈旧查询静默丢弃）', async () => {
    await seedContent('n1', '很长的正文包含目标')
    let cancelled = true
    expect(await scanContents('目标', {}, () => cancelled)).toEqual([])
    cancelled = false
    expect((await scanContents('目标', {}, () => cancelled)).length).toBeGreaterThan(0)
  })
})

describe('rankContentHits', () => {
  it('按元数据 updatedAt 倒序，未知 id 排最后', () => {
    const metaById = new Map([
      ['a', { updatedAt: 3 }],
      ['b', { updatedAt: 9 }],
    ])
    const ranked = rankContentHits([{ id: 'a' }, { id: 'zz' }, { id: 'b' }], metaById)
    expect(ranked.map((hit) => hit.id)).toEqual(['b', 'a', 'zz'])
  })
})

describe('searchStore（F-524 共用搜索状态）', () => {
  function makeMeta(id: string, updatedAt: number): NoteMeta {
    return {
      id,
      title: `标题-${id}`,
      excerpt: '摘要',
      folderId: null,
      tags: [],
      pinned: false,
      trashed: false,
      trashedAt: null,
      createdAt: updatedAt,
      updatedAt,
    }
  }

  it('set 触发正文扫描并按最近更新排序；空查询清空结果', async () => {
    const notesStore = useNotesStore()
    notesStore.notes = [makeMeta('old', 100), makeMeta('new', 200)]
    await Promise.all([seedContent('old', '共同关键词'), seedContent('new', '共同关键词')])

    const searchStore = useSearchStore()
    searchStore.set('关键词')
    await vi_waitUntil(() => searchStore.contentHits.length > 0)
    expect(searchStore.contentHits.map((hit) => hit.id)).toEqual(['new', 'old'])
    expect(searchStore.scanning).toBe(false)

    searchStore.set('  ')
    expect(searchStore.contentHits).toEqual([])
    expect(searchStore.query).toBe('  ')
  })

  it('同查询命中缓存（LRU 内不重扫）：结果一致且不再置 scanning', async () => {
    const notesStore = useNotesStore()
    notesStore.notes = [makeMeta('n1', 100)]
    await seedContent('n1', '缓存测试')

    const searchStore = useSearchStore()
    searchStore.set('缓存')
    await vi_waitUntil(() => searchStore.query === '缓存' && !searchStore.scanning)
    expect(searchStore.contentHits.map((hit) => hit.id)).toEqual(['n1'])

    // 换查询（重新扫描）再回退：上一查询命中 LRU 缓存，直接给出结果
    searchStore.set('缓存测试')
    await vi_waitUntil(() => searchStore.query === '缓存测试' && !searchStore.scanning)
    searchStore.set('缓存')
    expect(searchStore.scanning).toBe(false)
    expect(searchStore.contentHits.map((hit) => hit.id)).toEqual(['n1'])
  })
})

/** 轮询等待（扫描走真实 IndexedDB 微任务，无需假定时器） */
async function vi_waitUntil(predicate: () => boolean, timeoutMs = 1000): Promise<void> {
  const start = Date.now()
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitUntil 超时')
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}
