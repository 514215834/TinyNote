import type { NoteMeta } from '@/types'

/**
 * 大小写不敏感的包含匹配，标题命中排在摘要命中之前（F-105）。
 * F-523 起内存中只有元数据，本函数搜标题/摘要；正文命中由 engine.ts 的异步扫描补充（F-524）。
 * 入参 notes 应已按 updatedAt 倒序；Array#sort 稳定，组内顺序保持不变。
 */
export function filterNotes(notes: NoteMeta[], rawQuery: string): NoteMeta[] {
  const query = rawQuery.trim().toLowerCase()
  if (!query) return notes
  return notes
    .map((note) => ({
      note,
      inTitle: note.title.toLowerCase().includes(query),
      inExcerpt: note.excerpt.toLowerCase().includes(query),
    }))
    .filter((hit) => hit.inTitle || hit.inExcerpt)
    .sort((a, b) => Number(b.inTitle) - Number(a.inTitle))
    .map((hit) => hit.note)
}

/** F-205：按文件夹过滤；folderId 为 null 表示「全部笔记」，不过滤 */
export function filterByFolder(notes: NoteMeta[], folderId: string | null): NoteMeta[] {
  return folderId === null ? notes : notes.filter((note) => note.folderId === folderId)
}

/** F-205：按标签过滤；tag 为 null 时不过滤，标签匹配大小写不敏感 */
export function filterByTag(notes: NoteMeta[], tag: string | null): NoteMeta[] {
  if (tag === null) return notes
  const target = tag.toLowerCase()
  return notes.filter((note) => note.tags.some((item) => item.toLowerCase() === target))
}
