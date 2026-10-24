import MarkdownIt from 'markdown-it'
import type Token from 'markdown-it/lib/token.mjs'

export interface Heading {
  /** 标题层级 1–6（h1–h6） */
  level: number
  /** 标题纯文本（已剥除行内标记，用于展示） */
  text: string
  /** 预览中的锚点 id，与 renderMarkdown 为标题写入的 id 一致 */
  id: string
}

/**
 * 标题 → 锚点 id 的约定（F-302/F-303 大纲跳转）：
 * 小写化，剥除常见行内标记符，非「字母/数字/空格/连字符」一律去掉，
 * 连续空白折叠为 `-`。支持 CJK（\p{L} 覆盖中文）。
 */
export function slugify(text: string): string {
  const slug = text
    .trim()
    .toLowerCase()
    .replace(/[`*_~[\]()!#]/g, '')
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug === '' ? 'heading' : slug
}

/** heading_open 后面的 inline token → 标题纯文本（text 与 code_inline，跳过标签等其他行内节点） */
export function headingTextOf(inline: Token): string {
  return (inline.children ?? [])
    .filter((child) => child.type === 'text' || child.type === 'code_inline')
    .map((child) => child.content)
    .join('')
}

/**
 * 按文档顺序给 heading_open token 写入 id（去重后缀 -1/-2/…）。
 * renderMarkdown 的 core rule 与 extractHeadings 共用同一实现，
 * 保证大纲条目的 id 与预览 DOM 中的 id 完全一致。
 */
export function assignHeadingIds(tokens: Token[]): void {
  const counts = new Map<string, number>()
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].type !== 'heading_open') continue
    const inline = tokens[i + 1]
    if (inline === undefined || inline.type !== 'inline') continue
    const base = slugify(headingTextOf(inline))
    const seen = counts.get(base) ?? 0
    counts.set(base, seen + 1)
    tokens[i].attrSet('id', seen === 0 ? base : `${base}-${seen}`)
  }
}

// 大纲解析用独立实例：只需要块级 token 流（不渲染，无 XSS 面）；html:false 与 render.ts 保持同一解析口径
const outlineMd = new MarkdownIt({ html: false })

/** 提取 Markdown 源文的大纲（F-302）：层级 + 文本 + 与预览一致的锚点 id */
export function extractHeadings(source: string): Heading[] {
  const tokens = outlineMd.parse(source, {})
  assignHeadingIds(tokens)
  const headings: Heading[] = []
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].type !== 'heading_open') continue
    const inline = tokens[i + 1]
    if (inline === undefined || inline.type !== 'inline') continue
    const id = tokens[i].attrGet('id')
    if (id === null) continue
    headings.push({
      level: Number((tokens[i].tag ?? 'h1').slice(1)) || 1,
      text: headingTextOf(inline),
      id,
    })
  }
  return headings
}
