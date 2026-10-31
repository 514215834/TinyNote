import type { NoteMeta } from '@/types'
import { displayTitle } from '@/features/notes/notes'
import type { LinkEntry } from './linkIndex'

/**
 * 图谱数据装配（F-703）：纯函数——从笔记元数据 + 链接索引出链条目装配节点/边。
 * 数据完全复用 F-702 链接索引（linkIndex），本模块不读库、不维护状态，便于单测。
 *
 * 口径与出入链接面板一致：
 * - 同名多篇按传入顺序最先出现者胜（上游按 updatedAt 倒序传入 → 最近更新优先）；
 * - 断链（目标标题不存在）不产生边，缺口由「孤立节点保留」呈现；
 * - 自环（[[自己]]）与重复引用边去重，出链/反链双向都计链接度。
 */

/** 子集渲染的节点上限（§10.1：默认仅渲染当前过滤子集 ≤ 500 节点，超出按链接度截断） */
export const GRAPH_NODE_LIMIT = 500

/** 图谱节点（纯数据）：degree 供半径与截断排序使用 */
export interface GraphNodeData {
  id: string
  /** 展示标题（displayTitle 口径：标题缺失回退摘要/无标题文案） */
  title: string
  folderId: string | null
  updatedAt: number
  outDegree: number
  inDegree: number
}

/** 有向边：source 笔记正文引用了 target 笔记 */
export interface GraphEdgeData {
  source: string
  target: string
}

export interface GraphData {
  nodes: GraphNodeData[]
  edges: GraphEdgeData[]
  /** 是否发生了上限截断（节点数超出 limit，按链接度保留 top） */
  truncated: boolean
}

/**
 * 装配图谱数据：notes（应按 updatedAt 倒序传入，与 notesStore.notes 同序）
 * + 链接索引出链条目。节点上限 limit：超出时按「总链接度 → 最近更新」保留前 limit 个，
 * 边同步过滤到保留端点内，truncated 标记告知 UI。
 */
export function buildGraphData(notes: NoteMeta[], entries: LinkEntry[], limit = GRAPH_NODE_LIMIT): GraphData {
  if (notes.length === 0) return { nodes: [], edges: [], truncated: false }

  // 同名多篇解析表：标题 → 笔记 id（传入顺序最先者胜，即最近更新的一篇）
  const byTitle = new Map<string, string>()
  const ids = new Set(notes.map((note) => note.id))
  for (const note of notes) {
    const key = note.title.trim()
    if (key === '' || byTitle.has(key)) continue
    byTitle.set(key, note.id)
  }

  // 全量解析边（去重 + 跳过断链/自环）并累计度数——截断排序必须基于截断前的全量度数
  const edgeSeen = new Set<string>()
  const edges: GraphEdgeData[] = []
  const outDegree = new Map<string, number>()
  const inDegree = new Map<string, number>()
  for (const entry of entries) {
    if (!ids.has(entry.id)) continue // 出链条目只对传入子集内的笔记生效
    for (const link of entry.links) {
      const target = byTitle.get(link.target)
      if (target === undefined || target === entry.id) continue // 断链与自环不产生边
      const key = `${entry.id}\u0000${target}`
      if (edgeSeen.has(key)) continue
      edgeSeen.add(key)
      edges.push({ source: entry.id, target })
      outDegree.set(entry.id, (outDegree.get(entry.id) ?? 0) + 1)
      inDegree.set(target, (inDegree.get(target) ?? 0) + 1)
    }
  }

  const toNode = (note: NoteMeta): GraphNodeData => ({
    id: note.id,
    title: displayTitle(note),
    folderId: note.folderId,
    updatedAt: note.updatedAt,
    outDegree: outDegree.get(note.id) ?? 0,
    inDegree: inDegree.get(note.id) ?? 0,
  })

  let truncated = false
  let keptNotes = notes
  if (notes.length > limit) {
    truncated = true
    const total = (note: NoteMeta): number => (outDegree.get(note.id) ?? 0) + (inDegree.get(note.id) ?? 0)
    // 排序在全部元素于原数组中的下标上补序：同度数时保持最近更新优先（数组输入已按 updatedAt 倒序）
    keptNotes = notes
      .map((note, order) => ({ note, order, degree: total(note) }))
      .sort((a, b) => b.degree - a.degree || a.order - b.order)
      .slice(0, limit)
      .map((item) => item.note)
    const kept = new Set(keptNotes.map((note) => note.id))
    edges.length = 0
    for (const edge of edgeSeen) {
      const [source, target] = edge.split('\u0000')
      if (kept.has(source) && kept.has(target)) edges.push({ source, target })
    }
  }

  return { nodes: keptNotes.map(toNode), edges, truncated }
}
