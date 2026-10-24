import { db } from '@/lib/db/db'

/**
 * 全局搜索引擎（F-524）。两层分工：
 * - 同步层：标题/标签/摘要的内存过滤（search.ts 的 filterNotes 等，即时出结果）；
 * - 异步层（本文件）：正文流式扫描——Dexie 游标逐条读取 contents 表（F-523 正文分离配套），
 *   不把全部正文载入内存；支持取消陈旧查询与结果上限。
 *
 * 性能口径（架构文档 §8）：200ms 防抖 + 取消 + 查询结果缓存；无倒排索引。
 * 笔记总量 >5000 篇或 contents 总量 >50MB 时，按 ROADMAP F-604 切换 MiniSearch。
 */

/** 单篇笔记的正文命中 */
export interface ContentHit {
  id: string
  /** 命中起始位置（大小写不敏感，至多 hitsPerNote 个） */
  positions: number[]
  /** 首个命中附近的上下文摘要 */
  snippet: string
}

export interface ScanOptions {
  /** 最多返回的命中笔记数（达到即停止扫描） */
  limit?: number
  /** 单篇最多记录的命中位置数 */
  hitsPerNote?: number
  /** 摘要上下文半径（字符） */
  contextRadius?: number
}

/** 取消/限额触发的中止错误：中止事务属预期行为，外层静默处理 */
const ABORT_ERROR_NAMES = new Set(['AbortError', 'TransactionInactiveError'])

/**
 * 正文流式扫描：在只读事务内用游标遍历 contents 表（F-523 正文分离配套），
 * 逐条小写匹配并收集命中；达到 limit 或调用方取消（isCancelled，用于作废陈旧查询）时
 * 通过 tx.abort() 硬中止游标，停止读盘。
 */
export async function scanContents(
  rawQuery: string,
  options: ScanOptions = {},
  isCancelled: () => boolean = () => false,
): Promise<ContentHit[]> {
  const query = rawQuery.trim().toLowerCase()
  if (query === '') return []
  const { limit = 30, hitsPerNote = 3, contextRadius = 40 } = options

  const hits: ContentHit[] = []
  try {
    await db.transaction('r', db.contents, (tx) =>
      db.contents.each((row) => {
        if (isCancelled() || hits.length >= limit) {
          tx.abort()
          return
        }
        const lower = row.content.toLowerCase()
        const positions: number[] = []
        let at = lower.indexOf(query)
        while (at !== -1 && positions.length < hitsPerNote) {
          positions.push(at)
          at = lower.indexOf(query, at + query.length)
        }
        if (positions.length === 0) return
        const first = positions[0]!
        const from = Math.max(0, first - contextRadius)
        const to = Math.min(row.content.length, first + query.length + contextRadius)
        const snippet =
          (from > 0 ? '…' : '') + row.content.slice(from, to) + (to < row.content.length ? '…' : '')
        hits.push({ id: row.id, positions, snippet })
      }),
    )
  } catch (error) {
    // 中止即「拿到部分结果返回」；非中止的真实错误照常抛出
    if (!(error instanceof Error) || !ABORT_ERROR_NAMES.has(error.name)) throw error
  }
  return hits
}

/** 把正文命中按元数据的 updatedAt 倒序重排（扫描按存储序产出，展示按最近优先） */
export function rankContentHits<H extends { id: string }, T extends { updatedAt: number }>(
  hits: H[],
  metaById: Map<string, T>,
): H[] {
  return [...hits].sort(
    (a, b) => (metaById.get(b.id)?.updatedAt ?? 0) - (metaById.get(a.id)?.updatedAt ?? 0),
  )
}
