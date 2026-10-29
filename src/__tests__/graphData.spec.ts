import { describe, expect, it } from 'vitest'
import type { NoteMeta } from '@/types'
import { findWikiLinks } from '../features/links/wikilinks'
import type { LinkEntry } from '../features/links/linkIndex'
import { buildGraphData, GRAPH_NODE_LIMIT } from '../features/links/graphData'

/**
 * 图谱数据装配（F-703）单测：纯函数口径——同名解析、断链/自环跳过、
 * 边去重、度数累计与超过上限时按链接度截断。
 */

function meta(id: string, title: string, updatedAt = 0, folderId: string | null = null): NoteMeta {
  return {
    id,
    title,
    excerpt: '',
    folderId,
    tags: [],
    pinned: false,
    trashed: false,
    trashedAt: null,
    createdAt: 0,
    updatedAt,
  }
}

/** 用真实解析管线（findWikiLinks）构造出链条目，与运行时同口径 */
function entry(id: string, content: string): LinkEntry {
  return { id, title: '', links: findWikiLinks(content) }
}

describe('buildGraphData（F-703 图谱装配）', () => {
  it('出链解析为有向边，度数双向累计', () => {
    // notes 按 updatedAt 倒序传入（与 store 同序）
    const notes = [meta('b', 'B', 2), meta('a', 'A', 1), meta('c', 'C', 0)]
    const data = buildGraphData(notes, [entry('a', '见 [[B]]'), entry('b', '回指 [[A]]')])
    expect(data.truncated).toBe(false)
    expect(data.edges).toEqual([
      { source: 'a', target: 'b' },
      { source: 'b', target: 'a' },
    ])
    const node = (id: string) => data.nodes.find((item) => item.id === id)!
    expect(node('a').outDegree).toBe(1)
    expect(node('a').inDegree).toBe(1)
    expect(node('c').outDegree).toBe(0)
    expect(node('c').inDegree).toBe(0)
  })

  it('断链不产生边，孤立节点保留；别名不影响目标解析', () => {
    const notes = [meta('a', 'A', 1), meta('b', 'B', 0)]
    const data = buildGraphData(notes, [entry('a', '[[ghost]] 与 [[B|别名]]')])
    expect(data.edges).toEqual([{ source: 'a', target: 'b' }])
    expect(data.nodes.map((node) => node.id).sort()).toEqual(['a', 'b'])
  })

  it('同名多篇取传入序最先者（最近更新优先）；标题 trim 匹配', () => {
    const notes = [
      meta('b1', 'B', 1),
      meta('b2', 'B', 2),
      meta('a', 'A', 3, 'f1'), // 引用 [[B]]
    ]
    const data = buildGraphData(notes, [entry('a', '[[ B ]]')])
    expect(data.edges).toEqual([{ source: 'a', target: 'b1' }]) // b1 传入序在前
    expect(data.nodes.map((node) => node.title)).toEqual(['B', 'B', 'A'])
  })

  it('自环跳过、重复引用去重', () => {
    const notes = [meta('a', 'A', 2), meta('b', 'B', 1)]
    const data = buildGraphData(notes, [entry('a', '[[A]] [[B]] [[B]] [[B|又一次]]')])
    expect(data.edges).toEqual([{ source: 'a', target: 'b' }])
    const a = data.nodes.find((item) => item.id === 'a')!
    expect(a.outDegree).toBe(1)
  })

  it('超过上限按「总链接度 → 最近更新」截断，边过滤到保留端点内', () => {
    const notes = [
      meta('hub', 'Hub', 9),
      meta('f1', 'F1', 8), // 孤立
      meta('f2', 'F2', 7), // 孤立
      meta('a', 'A', 6),
      meta('b', 'B', 5),
    ]
    const entries = [entry('hub', '[[A]] [[B]]'), entry('a', '[[Hub]]')]
    // 度数：hub in1+out2=3；a out1+in1=2；b in1=1；f1/f2 = 0 → limit 3 保留 hub/a/b
    const data = buildGraphData(notes, entries, 3)
    expect(data.truncated).toBe(true)
    expect(data.nodes.map((node) => node.id)).toEqual(['hub', 'a', 'b'])
    expect(data.nodes).toHaveLength(3)
    expect(data.edges).toHaveLength(3) // hub→a, hub→b, a→hub 全部两端在保留集内
  })

  it('截断后孤立节点与低度节点先落选（度数排序）', () => {
    const notes = [
      meta('u1', 'U1', 9),
      meta('u2', 'U2', 8),
      meta('hub', 'Hub', 7),
      meta('a', 'A', 6),
    ]
    const entries = [entry('hub', '[[A]]'), entry('a', '[[Hub]]')]
    const data = buildGraphData(notes, entries, 2)
    expect(data.truncated).toBe(true)
    expect(data.nodes.map((node) => node.id)).toEqual(['hub', 'a'])
    // 孤立节点全部落选 → 无边残留
    expect(data.edges).toHaveLength(2)
  })

  it('默认上限为 500 节点口径', () => {
    expect(GRAPH_NODE_LIMIT).toBe(500)
  })

  it('空库返回空图谱', () => {
    expect(buildGraphData([], [])).toEqual({ nodes: [], edges: [], truncated: false })
  })
})
