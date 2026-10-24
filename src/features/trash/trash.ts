import type { Note } from '@/types'

/** 回收站保留期（天）：进入回收站超过该时长的笔记在启动时被惰性清理（F-204） */
export const TRASH_RETENTION_DAYS = 30

const DAY = 86_400_000

/** 清理截止时间：trashedAt 早于等于该值的笔记视为过期，将被物理删除 */
export function trashCutoff(now: number, days: number = TRASH_RETENTION_DAYS): number {
  return now - days * DAY
}

/** 单条判断：now 注入便于单测（验收要求覆盖 30 天清理边界） */
export function isPurgeExpired(
  note: Pick<Note, 'trashedAt'>,
  now: number,
  days: number = TRASH_RETENTION_DAYS,
): boolean {
  if (note.trashedAt === null) return false
  return note.trashedAt <= trashCutoff(now, days)
}
