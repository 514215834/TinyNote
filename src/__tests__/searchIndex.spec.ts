import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/lib/db/db'
import { noteRepository } from '@/lib/db/repositories/noteRepository'
import type { Note } from '@/types'
import {
  INDEX_NOTE_THRESHOLD,
  buildIndex,
  contentHitsFromIndex,
  discardIndex,
  indexModeActive,
  indexNote,
  isIndexBuilding,
  isIndexReady,
  removeFromIndex,
  searchIndex,
  tokenizeForIndex,
} from '@/features/search/searchIndex'

function makeNote(id: string, overrides: Partial<Note> = {}): Note {
  return {
    id,
    title: `标题-${id}`,
    content: `内容-${id}`,
    folderId: null,
    tags: [],
    pinned: false,
    trashed: false,
    trashedAt: null,
    createdAt: 100,
    updatedAt: 100,
    ...overrides,
  }
}

async function seedNotes(notes: Note[]): Promise<void> {
  for (const note of notes) {
    await noteRepository.saveWithContent({ ...note, tags: [...note.tags], excerpt: '' }, note.content)
  }
}

beforeEach(async () => {
  await Promise.all(db.tables.map((table) => table.clear()))
  discardIndex()
})

describe('tokenizeForIndex（F-604 分词）', () => {
  it('拉丁整词小写化，CJK 拆单字', () => {
    expect(tokenizeForIndex('Hello World')).toEqual(['hello', 'world'])
    expect(tokenizeForIndex('笔记note')).toEqual(['note', '笔', '记'])
    expect(tokenizeForIndex('v7_id')).toEqual(['v7_id'])
    expect(tokenizeForIndex('。，！')).toEqual([]) // 标点不入词
  })
})

describe('indexModeActive（阈值切换）', () => {
  it('达到阈值启用，之下维持流式扫描', () => {
    expect(indexModeActive(INDEX_NOTE_THRESHOLD)).toBe(true)
    expect(indexModeActive(INDEX_NOTE_THRESHOLD - 1)).toBe(false)
    expect(indexModeActive(10, 10)).toBe(true)
    expect(indexModeActive(9, 10)).toBe(false)
  })
})

describe('buildIndex / searchIndex', () => {
  it('全量构建后可命中标题与正文，标题加权优先', async () => {
    await seedNotes([
      makeNote('n1', { title: '设计规范', content: '关于液态玻璃的说明' }),
      makeNote('n2', { title: '随手记', content: '提到了设计规范这个词' }),
    ])
    expect(await buildIndex()).toBe(true)
    expect(isIndexReady()).toBe(true)
    expect(isIndexBuilding()).toBe(false)

    const hits = searchIndex('设计规范', 10)
    expect(hits[0]?.id).toBe('n1') // 标题命中加权在先
    expect(hits.map((hit) => hit.id)).toContain('n2')
  })

  it('回收站笔记不进索引；构建期并发调用只建一次', async () => {
    await seedNotes([makeNote('n1'), makeNote('n2', { trashed: true, trashedAt: 500 })])
    const [, second] = await Promise.all([buildIndex(), buildIndex()])
    expect(second).toBe(false) // 并发构建被合并
    expect(searchIndex('内容-n2', 10)).toEqual([])

    const buildingProbe = isIndexBuilding()
    expect(buildingProbe).toBe(false)
  })

  it('英文查询走前缀匹配', async () => {
    await seedNotes([makeNote('n1', { title: 'CodeMirror notes', content: 'vue-codemirror integration' })])
    await buildIndex()
    expect(searchIndex('codem', 10).map((hit) => hit.id)).toEqual(['n1'])
  })
})

describe('增量维护', () => {
  it('indexNote 更新可查、removeFromIndex 摘除、discardIndex 清空', async () => {
    await seedNotes([makeNote('n1')])
    await buildIndex()

    indexNote('n2', '新增标题', '全新内容')
    expect(searchIndex('新增标题', 10).map((hit) => hit.id)).toEqual(['n2'])

    indexNote('n2', '改名后', '全新内容')
    expect(searchIndex('新增标题', 10)).toEqual([])
    expect(searchIndex('改名后', 10).map((hit) => hit.id)).toEqual(['n2'])

    removeFromIndex('n2')
    expect(searchIndex('改名后', 10)).toEqual([])

    indexNote('n3', '标题三', '内容三')
    discardIndex()
    expect(isIndexReady()).toBe(false)
    expect(searchIndex('标题三', 10)).toEqual([])
  })

  it('索引未就绪时增量调用静默跳过', () => {
    expect(() => {
      indexNote('n1', '标题', '内容')
      removeFromIndex('n1')
    }).not.toThrow()
  })
})

describe('contentHitsFromIndex（索引 → ContentHit 组装）', () => {
  it('命中生成摘要（含前后省略号与位置）', async () => {
    const long = `${'填充'.repeat(100)}关键词在这里${'尾部'.repeat(100)}`
    await seedNotes([makeNote('n1', { content: long })])
    await buildIndex()

    const hits = await contentHitsFromIndex('关键词', 10)
    expect(hits).toHaveLength(1)
    expect(hits[0]?.positions[0]).toBeGreaterThan(0)
    expect(hits[0]?.snippet).toContain('关键词在这里')
    expect(hits[0]?.snippet.startsWith('…')).toBe(true)
    expect(hits[0]?.snippet.endsWith('…')).toBe(true)
  })

  it('跨词 AND 命中无连续子串时回退首个词元位置', async () => {
    await seedNotes([makeNote('n1', { content: ' alpha beta gamma ' })])
    await buildIndex()
    const hits = await contentHitsFromIndex('alpha gamma', 10)
    expect(hits).toHaveLength(1)
    expect(hits[0]?.snippet).toContain('alpha')
  })

  it('空查询与索引未就绪返回空', async () => {
    expect(await contentHitsFromIndex('', 10)).toEqual([])
    expect(await contentHitsFromIndex('什么', 10)).toEqual([])
  })
})
