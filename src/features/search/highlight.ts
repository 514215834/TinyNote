export interface HighlightSegment {
  text: string
  hit: boolean
}

/**
 * F-205 关键词高亮：把文本按查询词切分为「命中/未命中」片段。
 * 返回片段由模板正常渲染并包 mark 标签，不经过 v-html（ADR-006 安全基线）；
 * 大小写不敏感、所有字面匹配（关键词中的正则特殊字符不生效）。
 */
export function highlightSegments(text: string, rawQuery: string): HighlightSegment[] {
  const query = rawQuery.trim().toLowerCase()
  if (!query) return text ? [{ text, hit: false }] : []
  const lower = text.toLowerCase()
  const segments: HighlightSegment[] = []
  let cursor = 0
  for (;;) {
    const at = lower.indexOf(query, cursor)
    if (at === -1) break
    if (at > cursor) segments.push({ text: text.slice(cursor, at), hit: false })
    segments.push({ text: text.slice(at, at + query.length), hit: true })
    cursor = at + query.length
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor), hit: false })
  return segments
}
