/**
 * 双链协议（F-701）：`[[标题]]` 与别名 `[[标题|别名]]` 的纯 Markdown 文本约定。
 * 本模块只做字符层面的解析与替换——双链是正文字符串的一部分，无任何 schema 变更，
 * 天然随备份/同步/快照全链路工作。渲染侧（markdown-it 内联规则）与链接索引
 * （linkIndex.ts）共用这里的解析口径。
 */

export const WIKI_LINK_MAX = 200

/** 单个双链引用：target 为解析目标标题（trim 后），alias 为别名（无别名时 null），at 为原文起始位置 */
export interface WikiLinkRef {
  target: string
  alias: string | null
  at: number
}

/**
 * 需要跳过的区间：围栏代码块（``` / ~~~）与行内代码（`...`）内不产生有效双链。
 * 与预览渲染口径一致——markdown-it 中 codespan/fence 是独立 token，内联规则天然不触发。
 */
const SKIP_RANGE_RE = /```[\s\S]*?(?:```|$)|~~~[\s\S]*?(?:~~~|$)|`[^`\n]*`/g

/** 双链本体（regex 字面量书写，转义由解析器保证；findWikiLinks 复用） */
const WIKI_LINK_RE = /\[\[([^[\]\n]+)\]\]/g

/** 别名部分（别名可空：`[[标题|]]` 也是有效引用形式）。用 regex 字面量书写源码，避开模板字面量中 `\]` 转义失效的坑 */
const ALIAS_GROUP_RE = /\|[^[\]\n]*/

/** 计算「应跳过」的原文区间列表 */
function skippedRanges(content: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = []
  for (const match of content.matchAll(SKIP_RANGE_RE)) {
    ranges.push([match.index!, match.index! + match[0].length])
  }
  return ranges
}

/**
 * 扫描正文中的全部双链引用：
 * - 精确匹配语法 `[[target]]` / `[[target|alias]]`（target 与 alias 均 trim）
 * - target 为空视为无效；超长（> WIKI_LINK_MAX）与含换行的引用不匹配
 * - 行内代码与围栏代码块内的 `[[ ]]` 跳过
 * - `![[...]]` 是 v1.4 前不支持的嵌入语法，按纯文本处理（不产生链接）
 */
export function findWikiLinks(content: string): WikiLinkRef[] {
  if (!content.includes('[[')) return []
  const ranges = skippedRanges(content)
  const refs: WikiLinkRef[] = []
  for (const match of content.matchAll(WIKI_LINK_RE)) {
    const at = match.index!
    if (ranges.some(([from, to]) => at >= from && at < to)) continue
    if (at > 0 && content.charCodeAt(at - 1) === 0x21 /* ! */) continue
    const inner = match[1]!
    const sep = inner.indexOf('|')
    const target = (sep === -1 ? inner : inner.slice(0, sep)).trim()
    if (target === '' || target.length > WIKI_LINK_MAX) continue
    const alias = sep === -1 ? null : inner.slice(sep + 1).trim() || null
    refs.push({ target, alias, at })
  }
  return refs
}

/** 双链出现处的上下文摘要（±radius 字符，越界以 … 收边）——与搜索摘要口径一致 */
export function linkSnippet(content: string, at: number, radius: number = 40): string {
  const from = Math.max(0, at - radius)
  const to = Math.min(content.length, at + 4 + radius) // `[[x]]` 本体以 4 字符语法记
  return (from > 0 ? '…' : '') + content.slice(from, to) + (to < content.length ? '…' : '')
}

/** escapeHtml（renderer 内手动拼 HTML 时使用） */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** 渲染单个双链为预览锚点：target 注入 data-wikilink，展示 alias || target。不可信输入全部转义 */
export function renderWikiLinkHtml(ref: WikiLinkRef): string {
  const label = ref.alias ?? ref.target
  return `<a href="#" data-wikilink="${escapeHtml(ref.target)}" class="tinynote-wikilink text-accent cursor-pointer underline decoration-dotted decoration-accent/40 underline-offset-2 hover:bg-accent/10">${escapeHtml(label)}</a>`
}

/** 把正则元字符转义，用于按标题构造替换/查找模式 */
export function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * 重命名迁移（F-701）：把正文中指向 oldTitle 的引用替换为 newTitle（保留别名部分，
 * 含 `[[标题|]]` 空别名形式）。精确匹配（大小写敏感）；返回改写后的正文与命中次数。
 * oldTitle/newTitle trim 后为空时原样返回。
 */
export function replaceTitleRefs(
  content: string,
  oldTitle: string,
  newTitle: string,
): { content: string; count: number } {
  if (!content.includes('[[')) return { content, count: 0 }
  const trimmed = oldTitle.trim()
  if (trimmed === '') return { content, count: 0 }
  const next = newTitle.trim()
  if (next === '') return { content, count: 0 }
  const pattern = new RegExp(`\\[\\[${escapeRegExp(trimmed)}(${ALIAS_GROUP_RE.source})?\\]\\]`, 'g')
  let count = 0
  // 回调形式的 replace 不展开 $，替换文本无需转义
  const replaced = content.replace(pattern, (_full, withAlias: string | undefined) => {
    count++
    return `[[${next}${withAlias ?? ''}]]`
  })
  return { content: replaced, count }
}
