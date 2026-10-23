import type { Note } from '@/types'

/**
 * 大小写不敏感的包含匹配，标题命中排在正文命中之前（F-105）。
 * 入参 notes 应已按 updatedAt 倒序；Array#sort 稳定，组内顺序保持不变。
 */
export function filterNotes(notes: Note[], rawQuery: string): Note[] {
  const query = rawQuery.trim().toLowerCase()
  if (!query) return notes
  return notes
    .map((note) => ({
      note,
      inTitle: note.title.toLowerCase().includes(query),
      inContent: note.content.toLowerCase().includes(query),
    }))
    .filter((hit) => hit.inTitle || hit.inContent)
    .sort((a, b) => Number(b.inTitle) - Number(a.inTitle))
    .map((hit) => hit.note)
}

/** F-205：按文件夹过滤；folderId 为 null 表示「全部笔记」，不过滤 */
export function filterByFolder(notes: Note[], folderId: string | null): Note[] {
  return folderId === null ? notes : notes.filter((note) => note.folderId === folderId)
}

/** F-205：按标签过滤；tag 为 null 时不过滤，标签匹配大小写不敏感 */
export function filterByTag(notes: Note[], tag: string | null): Note[] {
  if (tag === null) return notes
  const target = tag.toLowerCase()
  return notes.filter((note) => note.tags.some((item) => item.toLowerCase() === target))
}
