import type { NoteSnapshot } from '@/types'

/**
 * 历史版本快照领域层（F-402）：全部为纯函数。
 * 自动快照口径——「距上次快照的字符变化超过阈值」；保留上限每篇 20 条。
 * 落库与编排在 stores/history.ts 与 snapshotRepository。
 */

/** 自动快照的相对变化阈值：变化字符数 / 原文长度 > 0.2 时生成快照 */
export const SNAPSHOT_CHANGE_THRESHOLD = 0.2

/** 每篇笔记的快照保留上限：超出时删除最旧的 */
export const SNAPSHOT_KEEP_LIMIT = 20

/**
 * 变化字符数（编辑量的近似，避免 LCS 开销）：
 * 剥掉公共前缀与公共后缀后，剩余部分视为「发生过变化」的字符。
 * 等长替换（如全文改写错别字）用纯长度差测不出来，前后缀剥离可以覆盖。
 */
export function changedChars(previous: string, current: string): number {
  let start = 0
  const min = Math.min(previous.length, current.length)
  while (start < min && previous[start] === current[start]) start++
  let endPrev = previous.length
  let endCur = current.length
  while (endPrev > start && endCur > start && previous[endPrev - 1] === current[endCur - 1]) {
    endPrev--
    endCur--
  }
  return Math.max(endPrev - start, endCur - start)
}

/** 相对变化率：相对「上次快照内容」的变化字符占比；基线为空时视为无穷大（全新内容） */
export function relativeChange(previous: string, current: string): number {
  if (previous.length === 0) return current.length === 0 ? 0 : Number.POSITIVE_INFINITY
  return changedChars(previous, current) / previous.length
}

/**
 * 是否应该自动快照：
 * - 空内容不快照（避免每篇新建笔记都留下空白历史）；
 * - 内容与任一既有快照逐字相同则跳过（防止回滚等场景产生重复快照）；
 * - 没有任何快照时，首个非空版本即为基线快照；
 * - 否则与最新快照比较，相对变化超过阈值才快照。
 * existingContents 按最新在前排序。
 */
export function shouldAutoSnapshot(existingContents: string[], current: string): boolean {
  if (current.trim().length === 0) return false
  if (existingContents.some((content) => content === current)) return false
  const baseline = existingContents[0]
  if (baseline === undefined) return true
  return relativeChange(baseline, current) > SNAPSHOT_CHANGE_THRESHOLD
}

/** 保留上限裁剪：输入按最新在前排序，返回应保留与应删除（最旧超出）的两段 */
export function splitByLimit(
  snapshots: NoteSnapshot[],
  limit: number = SNAPSHOT_KEEP_LIMIT,
): { keep: NoteSnapshot[]; overflow: NoteSnapshot[] } {
  return { keep: snapshots.slice(0, limit), overflow: snapshots.slice(limit) }
}
