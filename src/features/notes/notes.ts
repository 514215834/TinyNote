import type { NoteMeta } from '@/types'
import { t } from '@/lib/i18n'

/**
 * 列表与删除确认弹窗展示用的标题：优先标题字段，缺失时回退摘要/正文首行，再回退占位文案。
 * 元数据口径（F-523）传 NoteMeta 的 excerpt；备份口径（含 content 的 Note）回退正文原始首行。
 */
export function displayTitle(note: { title: string; excerpt?: string; content?: string }): string {
  const title = note.title.trim()
  if (title) return title
  const firstLine = (note.excerpt ?? note.content ?? '')
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.length > 0 && line !== t('common.blankNote'))
  if (firstLine) return firstLine.slice(0, 30)
  return t('common.untitled')
}

/** 置顶排序（F-203）：置顶笔记在列表最前；入参应已按 updatedAt 倒序，稳定排序保持组内原序 */
export function sortNotesForList<T extends Pick<NoteMeta, 'pinned'>>(notes: T[]): T[] {
  return [...notes].sort((a, b) => Number(b.pinned) - Number(a.pinned))
}

/** 由 Markdown 正文生成纯文本摘要（粗略去除常见标记符号） */
export function makeExcerpt(content: string, max: number = 60): string {
  const text = content
    .replace(/```[\s\S]*?```/g, ' ') // 代码块
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ') // 图片
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1') // 链接 → 链接文字
    .replace(/[#>*_~`|-]+/g, ' ') // 常用标记符号
    .replace(/\s+/g, ' ')
    .trim()
  if (!text) return t('common.blankNote')
  return text.length > max ? `${text.slice(0, max)}…` : text
}
