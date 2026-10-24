import MiniSearch from 'minisearch'
import { db } from '@/lib/db/db'
import { noteRepository } from '@/lib/db/repositories/noteRepository'
import type { ContentHit } from './engine'

/**
 * 全文搜索倒排索引（F-604）：笔记数达到 INDEX_NOTE_THRESHOLD 后启用 MiniSearch，
 * 之下维持 engine.ts 的流式扫描（小库零内存开销）。分工：
 * - 全量构建走 Dexie 游标流式读取 contents（与流式扫描同口径），启动 2s 空闲后再补建（首屏优先）；
 * - 增量维护挂在 notesStore 的写路径（保存/新建/删除/恢复），外部刷新（同步）整库丢弃重建；
 * - 分词：拉丁/数字整词（小写）+ CJK 单字 unigram——AND 组合近似子串匹配，前缀匹配覆盖英文。
 */

/** 启用倒排索引的笔记数阈值（架构文档 §8：>5000 篇切换 MiniSearch） */
export const INDEX_NOTE_THRESHOLD = 5000

/** 摘要上下文半径：与 engine.ts 流式扫描的默认口径一致 */
const SNIPPET_RADIUS = 40

export interface IndexedDoc {
  id: string
  title: string
  content: string
}

const CJK_RE = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uac00-\ud7af]/

/** 分词（索引与查询同一函数）：拉丁/数字整词 + CJK 单字 */
export function tokenizeForIndex(text: string): string[] {
  const lower = text.toLowerCase()
  const tokens: string[] = []
  for (const match of lower.matchAll(/[a-z0-9_]+/g)) tokens.push(match[0])
  for (const char of lower) if (CJK_RE.test(char)) tokens.push(char)
  return tokens
}

let index: MiniSearch<IndexedDoc> | null = null
let building = false

/** 是否达到索引模式的启用门槛（纯函数便于单测） */
export function indexModeActive(noteCount: number, threshold: number = INDEX_NOTE_THRESHOLD): boolean {
  return noteCount >= threshold
}

export function isIndexReady(): boolean {
  return index !== null
}

export function isIndexBuilding(): boolean {
  return building
}

function createIndex(): MiniSearch<IndexedDoc> {
  return new MiniSearch<IndexedDoc>({
    fields: ['title', 'content'],
    tokenize: tokenizeForIndex,
    processTerm: (term) => term,
    searchOptions: { prefix: true, combineWith: 'AND', boost: { title: 3 } },
  })
}

/**
 * 全量构建：contents 表流式读取 + 活跃笔记标题配对，构建期间查询回退流式扫描；
 * 完成后原子替换索引实例（构建中新增的保存路径看到 index === null 会跳过增量，
 * 由随后的 scheduleIndexBuild 兜底重建——构建在 2s 空闲后进行，窗口极小）。
 */
export async function buildIndex(): Promise<boolean> {
  if (building) return false
  building = true
  try {
    const fresh = createIndex()
    const metas = await db.notes.toArray()
    const titleById = new Map(metas.filter((meta) => !meta.trashed).map((meta) => [meta.id, meta.title]))
    await db.contents.each((row) => {
      const title = titleById.get(row.id)
      if (title === undefined) return // 回收站笔记与孤儿正文不进索引
      fresh.add({ id: row.id, title, content: row.content })
    })
    index = fresh
    return true
  } finally {
    building = false
  }
}

/** 丢弃索引（外部整库刷新/批量删除后调用），由 scheduleIndexBuild 择机重建 */
export function discardIndex(): void {
  index = null
}

/** 增量更新单篇（保存/新建路径；索引未就绪时静默跳过） */
export function indexNote(id: string, title: string, content: string): void {
  if (index === null) return
  try {
    index.discard(id)
  } catch {
    // id 不在索引中：直接进入新增
  }
  index.add({ id, title, content })
}

export function removeFromIndex(id: string): void {
  if (index === null) return
  try {
    index.discard(id)
  } catch {
    // id 不在索引中：无动作
  }
}

export interface IndexHit {
  id: string
  score: number
}

/** 索引查询（AND + 前缀 + 标题加权），按相关度降序；索引未就绪返回空 */
export function searchIndex(rawQuery: string, limit: number): IndexHit[] {
  if (index === null) return []
  const query = rawQuery.trim()
  if (query === '') return []
  return index
    .search(query)
    .slice(0, limit)
    .map((result) => ({ id: String(result.id), score: result.score }))
}

/** 索引路径的 ContentHit 组装：命中 id → 按需取正文 → 生成与流式层同口径的摘要 */
export async function contentHitsFromIndex(rawQuery: string, limit: number = 30): Promise<ContentHit[]> {
  const query = rawQuery.trim().toLowerCase()
  if (query === '') return []
  const result: ContentHit[] = []
  for (const hit of searchIndex(rawQuery, limit)) {
    const content = await noteRepository.getContent(hit.id)
    const lower = content.toLowerCase()
    let at = lower.indexOf(query)
    if (at === -1) {
      // 分词命中但无连续子串（跨词 AND）：回退到首个查询词元的位置
      for (const term of tokenizeForIndex(query)) {
        const termAt = lower.indexOf(term)
        if (termAt !== -1) {
          at = termAt
          break
        }
      }
    }
    if (at === -1) at = 0
    const from = Math.max(0, at - SNIPPET_RADIUS)
    const to = Math.min(content.length, at + query.length + SNIPPET_RADIUS)
    result.push({
      id: hit.id,
      positions: [at],
      snippet: (from > 0 ? '…' : '') + content.slice(from, to) + (to < content.length ? '…' : ''),
    })
  }
  return result
}

const idle =
  typeof requestIdleCallback === 'function'
    ? (callback: () => void) => requestIdleCallback(() => callback(), { timeout: 5000 })
    : (callback: () => void) => setTimeout(callback, 2000)

let rebuildScheduled = false

/**
 * 择机全量构建（App 启动与整库刷新后调用）：达到阈值且索引未就绪时，
 * 让路首屏交互，空闲后再建（构建期间查询自动回退流式扫描，无功能空窗）。
 */
export function scheduleIndexBuild(noteCount: number): void {
  if (!indexModeActive(noteCount) || index !== null || building || rebuildScheduled) return
  rebuildScheduled = true
  idle(() => {
    rebuildScheduled = false
    if (index !== null || building) return
    void buildIndex()
  })
}
