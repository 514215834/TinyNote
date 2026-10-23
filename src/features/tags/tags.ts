import type { Note } from '@/types'

/** F-202 解析标签输入：按空白 / 中英文逗号 / 顿号切分，去掉空白片段 */
export function parseTagInput(input: string): string[] {
  return input
    .split(/[\s,，、]+/)
    .map((tag) => tag.trim())
    .filter((tag) => tag.length > 0)
}

/**
 * 追加标签（F-202）：返回新数组不改入参；
 * 仅大小写不同的标签视为同一个（保留首次出现的大小写）。
 */
export function addTag(tags: string[], raw: string): string[] {
  const next = [...tags]
  for (const candidate of parseTagInput(raw)) {
    const exists = next.some((tag) => tag.toLowerCase() === candidate.toLowerCase())
    if (!exists) next.push(candidate)
  }
  return next
}

/** 移除标签（F-202）：大小写不敏感匹配 */
export function removeTag(tags: string[], raw: string): string[] {
  const target = raw.trim().toLowerCase()
  return tags.filter((tag) => tag.toLowerCase() !== target)
}

export interface TagCount {
  tag: string
  count: number
}

/** 侧边栏标签云（F-202）：统计每张标签上的笔记数，频次降序、同频按名称升序 */
export function collectTags(notes: Note[]): TagCount[] {
  const counts = new Map<string, TagCount>()
  for (const note of notes) {
    for (const tag of note.tags) {
      const found = counts.get(tag.toLowerCase())
      if (found) found.count += 1
      else counts.set(tag.toLowerCase(), { tag, count: 1 })
    }
  }
  return [...counts.values()].sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag))
}
