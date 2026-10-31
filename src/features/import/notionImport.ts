/**
 * Notion 导出 zip（Markdown & CSV）导入器（F-804）：纯解析层，不触碰数据库。
 * - 页面 md + 同名目录（嵌套子页）：嵌套子页平铺内联进父页正文，标题层级随深度
 *   降级（子页标题作 `#`，内部标题相应后移，超过 6 级封顶）——层级关系保留在一篇内、
 *   内容连续；页间 `[文本](xxx.md)` 链接降噪为纯文本
 * - 附件 `<uuid>-<hash>.png` 等按相对路径/文件名重链为附件引用（resolve 由 service 注入）
 * - 数据库 csv → 每行一篇笔记：首列/名称列 → 标题；文本属性映射标签；日期属性映射
 *   创建/更新时间（列名优先，按值启发式兜底）；公式列在 csv 中已是纯文本，进属性表；
 *   空行/空标题行跳过并计数
 * - `Untitled` 空壳页跳过
 */

import { parseCsv } from './csv'

/** 页面装配产物（一个 md 顶页一篇；csv 每行一篇由 service 另行装配） */
export interface NotionPagePlan {
  title: string
  content: string
}

/** 图片引用重链解析器：href（含百分号编码）→ 附件引用；未命中返回 null（保留原文） */
export type NotionAssetResolver = (href: string) => string | null

/** Notion 导出文件名去掉尾部 ` <32位hex>` 标识（`页面 <uuid>.md` → `页面`） */
export function stripNotionId(name: string): string {
  return name.replace(/[\s_]+[0-9a-f]{32}$/i, '').trim()
}

/** ATX 标题统一降 depth 级（超过 6 级封顶在 6） */
export function demoteHeadings(content: string, depth: number): string {
  if (depth <= 0) return content
  return content.replace(/^(#{1,6})(\s)/gm, (_full, hashes: string, space: string) => {
    return `${'#'.repeat(Math.min(hashes.length + depth, 6))}${space}`
  })
}

/** 页间链接 `[文本](xxx.md)` → 纯文本（平铺后相对路径已失效）；远程 http 链接保留 */
function flattenPageLinks(content: string): string {
  return content.replace(/\[([^\]]*)\]\(([^)\s]+)\)/g, (full, text: string, href: string) => {
    if (/^https?:\/\//i.test(href) || href.startsWith('#')) return full
    if (/\.md$/i.test(safeDecode(href))) return text
    return full
  })
}

function safeDecode(href: string): string {
  try {
    return decodeURIComponent(href)
  } catch {
    return href
  }
}

/** 图片引用重链：resolve 多键尝试（原文 → 解码 → 解码文件名），未命中保留原文 */
function relinkImages(content: string, resolve: NotionAssetResolver): string {
  if (!content.includes('](')) return content
  return content.replace(/!\[([^\]]*)\]\(([^()\s]+)\)/g, (full, alt: string, href: string) => {
    const decoded = safeDecode(href)
    const replacement =
      resolve(href) ?? resolve(decoded) ?? resolve(decoded.split('/').pop() ?? '')
    if (replacement === null) return full
    return `![${alt}](${replacement})`
  })
}

/**
 * 装配页面树：mdFiles 为 zip 内全部 md 文本（路径 → 内容）；resolve 重链附件引用。
 * 顶页（不在任何同名父目录下者）各产出一条 plan；子页递归内联。Untitled 空壳页跳过（不计入产物）。
 */
export function planNotionPages(
  mdFiles: Map<string, string>,
  resolve: NotionAssetResolver = () => null,
): NotionPagePlan[] {
  const paths = [...mdFiles.keys()]
  const pathSet = new Set(paths)
  const childrenOf = new Map<string, string[]>()
  const roots: string[] = []
  for (const path of paths) {
    const dir = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : ''
    const parentPath = dir === '' ? null : `${dir}.md`
    if (parentPath !== null && pathSet.has(parentPath)) {
      const list = childrenOf.get(parentPath) ?? []
      list.push(path)
      childrenOf.set(parentPath, list)
    } else {
      roots.push(path)
    }
  }
  // 子页按文件名稳定排序，保证产物确定性
  for (const list of childrenOf.values()) list.sort()

  const plans: NotionPagePlan[] = []
  for (const root of roots.sort()) {
    const plan = assemblePage(root, mdFiles, childrenOf, resolve, 0)
    if (plan !== null) plans.push(plan)
  }
  return plans
}

/** 递归装配单页：title 取文件名（去 uuid），子页内联为降级标题；Untitled 空壳返回 null */
function assemblePage(
  path: string,
  mdFiles: Map<string, string>,
  childrenOf: Map<string, string[]>,
  resolve: NotionAssetResolver,
  depth: number,
): NotionPagePlan | null {
  const base = (path.split('/').pop() ?? path).replace(/\.md$/i, '')
  const title = stripNotionId(base)
  let content = mdFiles.get(path) ?? ''
  if (title === 'Untitled' && content.trim() === '') return null
  content = relinkImages(flattenPageLinks(content), resolve)
  const children = childrenOf.get(path) ?? []
  const childDepth = Math.min(depth + 1, 5) // 子页标题级别：1 起，封顶 5（内容标题再降 1 不超 6）
  for (const child of children) {
    const assembled = assemblePage(child, mdFiles, childrenOf, resolve, childDepth)
    if (assembled === null) continue
    const heading = `${'#'.repeat(Math.max(childDepth, 1))} ${assembled.title}`
    content += `\n\n${heading}\n\n${assembled.content}`
  }
  return { title, content: depth === 0 ? content.trim() : demoteHeadings(content.trim(), depth) }
}

// ———— 数据库 csv → 笔记 ————————————————————————————————————————

/** 单行数据库记录的装配产物 */
export interface NotionRowPlan {
  title: string
  content: string
  tags: string[]
  createdAt: number | null
  updatedAt: number | null
  propertyCount: number
}

/** 标题列候选名（中英常见导出口径） */
const TITLE_COLUMNS = new Set(['name', 'title', '名称', '标题', '姓名'])

/** 日期启发式：ISO / 斜杠日期 / `@Month D, YYYY`（Notion 导出常见形态） */
function parseDateValue(value: string): number | null {
  const text = value.trim().replace(/^@/, '').trim()
  if (text === '') return null
  const iso = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})([ T](\d{1,2}):(\d{2})(:(\d{2}))?)?$/.exec(text)
  if (iso !== null) {
    const normalized =
      `${iso[1]}-${iso[2]!.padStart(2, '0')}-${iso[3]!.padStart(2, '0')}` +
      (iso[4] !== undefined
        ? `T${iso[5]!.padStart(2, '0')}:${iso[6]}:${(iso[8] ?? '00').padStart(2, '0')}`
        : 'T00:00:00')
    const parsed = Date.parse(`${normalized}Z`)
    return Number.isNaN(parsed) ? null : parsed
  }
  const parsed = Date.parse(text)
  return Number.isNaN(parsed) ? null : parsed
}

/** 日期列判定：全部非空值都可解析为日期 */
function isDateColumn(values: string[]): boolean {
  const nonEmpty = values.filter((value) => value.trim() !== '')
  if (nonEmpty.length === 0) return false
  return nonEmpty.every((value) => parseDateValue(value) !== null)
}

/** 文本值 → 标签：短单行值（多选/状态/文本属性导出形态），逗号分隔拆分 */
function valuesToTags(value: string): string[] {
  if (value.includes('\n') || value.length > 50) return []
  return value
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part !== '')
}

/**
 * 数据库 csv → 每行一篇笔记。返回 (rows, skippedCount)：
 * 空标题行跳过计数（含空行）。日期列：列名含 created/创建 → createdAt，
 * modified/updated/edited/编辑/更新 → updatedAt；否则按出现顺序前者创建、后者更新。
 */
export function planNotionDatabase(csvText: string): { rows: NotionRowPlan[]; skipped: number } {
  const table = parseCsv(csvText)
  if (table.length < 2) return { rows: [], skipped: Math.max(0, table.length - 1) }
  const header = table[0]!.map((name) => name.trim())
  const titleIndexCandidate = header.findIndex((name) => TITLE_COLUMNS.has(name.toLowerCase()))
  const titleIndex = titleIndexCandidate >= 0 ? titleIndexCandidate : 0
  const body = table.slice(1)

  // 列级预分析（按列取值）
  const columnValues = header.map((_name, index) => body.map((row) => row[index] ?? ''))
  const dateColumns = header.map((_name, index) => isDateColumn(columnValues[index]!))
  let createdAtColumn = -1
  let updatedAtColumn = -1
  header.forEach((name, index) => {
    if (!dateColumns[index]) return
    const lower = name.toLowerCase()
    if (createdAtColumn === -1 && /created|创建/.test(lower)) createdAtColumn = index
    else if (updatedAtColumn === -1 && /modified|updated|edited|修改|编辑|更新/.test(lower)) updatedAtColumn = index
  })
  header.forEach((_name, index) => {
    if (!dateColumns[index] || index === createdAtColumn || index === updatedAtColumn) return
    if (createdAtColumn === -1) createdAtColumn = index
    else if (updatedAtColumn === -1) updatedAtColumn = index
  })

  const rows: NotionRowPlan[] = []
  let skipped = 0
  for (const record of body) {
    const title = (record[titleIndex] ?? '').trim()
    if (title === '') {
      skipped++
      continue
    }
    const tags: string[] = []
    const propertyLines: string[] = []
    let propertyCount = 0
    header.forEach((name, index) => {
      if (index === titleIndex) return
      const value = (record[index] ?? '').trim()
      if (value === '') return
      propertyCount++
      propertyLines.push(`| ${escapeCell(name)} | ${escapeCell(value)} |`)
      if (dateColumns[index]) return
      tags.push(...valuesToTags(value))
    })
    const content =
      propertyLines.length === 0 ? '' : `| 属性 | 值 |\n| --- | --- |\n${propertyLines.join('\n')}`
    rows.push({
      title,
      content,
      tags: [...new Set(tags)],
      createdAt: createdAtColumn >= 0 ? parseDateValue(record[createdAtColumn] ?? '') : null,
      updatedAt: updatedAtColumn >= 0 ? parseDateValue(record[updatedAtColumn] ?? '') : null,
      propertyCount,
    })
  }
  return { rows, skipped }
}

/** markdown 表格单元格转义：竖线会破坏表结构 */
function escapeCell(text: string): string {
  return text.replace(/\|/g, '\\|').replace(/\n/g, ' ')
}
