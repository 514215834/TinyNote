import { describe, expect, it } from 'vitest'
import { applyCompletion, filterCandidates } from '@/features/editor/wikilinkComplete'
import type { WikiLinkCandidate } from '@/features/editor/wikilinkComplete'

const POOL: WikiLinkCandidate[] = [
  { title: '新写的笔记', updatedAt: 400 },
  { title: '读书记录', updatedAt: 300 },
  { title: 'Weekly Review', updatedAt: 200 },
  { title: '   ', updatedAt: 100 }, // 空白标题不作为候选
]

describe('filterCandidates（F-701 补全候选）', () => {
  it('空片段返回限额内的候选（按调用方排序原样取前 N）', () => {
    const result = filterCandidates('', POOL, 2)
    expect(result.map((item) => item.title)).toEqual(['新写的笔记', '读书记录'])
  })

  it('大小写不敏感的包含匹配', () => {
    const result = filterCandidates('review', POOL)
    expect(result.map((item) => item.title)).toEqual(['Weekly Review'])
  })

  it('无命中返回空（浮层不弹出）', () => {
    expect(filterCandidates('不存在', POOL)).toEqual([])
  })

  it('限额生效', () => {
    const big: WikiLinkCandidate[] = Array.from({ length: 20 }, (_, index) => ({
      title: `笔记 ${index}`,
      updatedAt: 1000 - index,
    }))
    expect(filterCandidates('', big, 8)).toHaveLength(8)
  })
})

describe('applyCompletion（F-701 补全落笔）', () => {
  it('无别名片段：写入标题并闭合 ]]', () => {
    expect(applyCompletion('读书记录', '')).toBe('读书记录]]')
  })

  it('保留用户已敲入的 |别名 部分', () => {
    expect(applyCompletion('读书记录', '读书|别名')).toBe('读书记录|别名]]')
  })
})
