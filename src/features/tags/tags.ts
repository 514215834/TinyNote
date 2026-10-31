import type { NoteMeta } from '@/types'

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

/** 中文拼音序比较器：显式 locale，避免默认 locale 下各平台 CJK 排序不一致（Windows 与 Linux CI 差异曾致测试失败） */
const tagCollator = new Intl.Collator('zh')

/** 侧边栏标签云（F-202）：统计每张标签上的笔记数，频次降序、同频按名称升序 */
export function collectTags(notes: Pick<NoteMeta, 'tags'>[]): TagCount[] {
  const counts = new Map<string, TagCount>()
  for (const note of notes) {
    for (const tag of note.tags) {
      const found = counts.get(tag.toLowerCase())
      if (found) found.count += 1
      else counts.set(tag.toLowerCase(), { tag, count: 1 })
    }
  }
  return [...counts.values()].sort((a, b) => b.count - a.count || tagCollator.compare(a.tag, b.tag))
}

/** 判断标签是否命中（大小写不敏感，F-202 口径） */
function tagMatches(tag: string, target: string): boolean {
  return tag.toLowerCase() === target.trim().toLowerCase()
}

/**
 * 标签重命名（F-1005）：大小写不敏感匹配旧名，替换为新名。
 * 新名与既有标签仅大小写不同时按既有大小写归一（addTag 语义），天然合并。
 */
export function renameTagIn(tags: string[], from: string, to: string): string[] {
  const target = from.trim()
  const next = to.trim()
  if (target === '' || next === '') return tags
  const lowerNext = next.toLowerCase()
  // 幸存标签里已有同名（仅大小写不同）目标 → 纯移除（合并语义，保留既有形态）
  const mergedIntoExisting = tags.some((tag) => !tagMatches(tag, target) && tag.toLowerCase() === lowerNext)
  let matched = false
  const result: string[] = []
  for (const tag of tags) {
    if (tagMatches(tag, target)) {
      if (!matched && !mergedIntoExisting) result.push(next) // 首个命中原位替换
      matched = true
      continue
    }
    result.push(tag)
  }
  return matched ? result : tags
}

/** 标签合并（F-1005）：source 的笔记获得 into 标签，source 移除；into 大小写归一 */
export function mergeTagIn(tags: string[], from: string, into: string): string[] {
  const stripped = removeTag(tags, from)
  if (stripped.length === tags.length) return tags // 未命中 source：原样返回
  return addTag(stripped, into)
}
