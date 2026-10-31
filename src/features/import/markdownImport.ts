/**
 * Markdown 批量导入的解析层（F-801）：纯函数，不触碰数据库——
 * 标题提取（首个 H1，缺失回退文件名）、目录结构映射单层文件夹、
 * zip 内图片相对路径重链为附件引用。落库编排见 importService.ts。
 *
 * 目录映射口径（ROADMAP §10.2）：一级目录 → 文件夹；二级目录起平铺，
 * 层级关系以标题层级保留在一篇内（多出的每层目录前置为对应级别的标题）。
 */

/** 单篇待导入笔记的装配计划 */
export interface MarkdownNotePlan {
  /** 标题：首个 H1（已从正文剥离）或文件名回退，调用方保证非空 */
  title: string
  /** 处理后的正文（已剥标题行、已前置层级标题、已重链图片——重链在拿到附件 id 后由 service 调用） */
  content: string
  /** 一级目录名（根文件为 null → 未分类） */
  folderName: string | null
  /** zip/选择集中的相对路径（明细展示用） */
  path: string
}

/** 提取标题：首个非空行若为 ATX H1（`# 标题`）则作为标题并从正文剥离，否则标题为空（回退文件名） */
export function extractMarkdownTitle(content: string): { title: string; content: string } {
  const lines = content.split(/\r\n|\n/)
  let start = 0
  while (start < lines.length && lines[start]!.trim() === '') start++
  const first = lines[start] ?? ''
  const match = /^#\s+(.+?)\s*#*\s*$/.exec(first)
  if (match === null) return { title: '', content }
  const rest = [...lines.slice(0, start), ...lines.slice(start + 1)].join('\n')
  return { title: match[1]!.trim(), content: rest }
}

/** 文件名回退标题：剥扩展名（名称只用于展示，尖括号等留待保存链路口径处理） */
export function titleFromPath(path: string): string {
  const base = path.split('/').pop() ?? path
  return base.replace(/\.(md|markdown|txt)$/i, '').trim()
}

/**
 * 目录结构 → 装配计划：paths 为 zip 内 md 文件的相对路径（`/` 分隔）。
 * - 根文件：folderName null（未分类）
 * - `a/x.md`：folderName 'a'
 * - `a/b/x.md`：folderName 'a'，正文前置 `# b`；更深每层依次升一级标题
 */
export function planMarkdownNotes(files: Array<{ path: string; content: string }>): MarkdownNotePlan[] {
  return files.map(({ path, content }) => {
    const segments = path.split('/').filter((segment) => segment !== '')
    const dirSegments = segments.slice(0, -1)
    const folderName = dirSegments.length > 0 ? (dirSegments[0] ?? null) : null
    const extracted = extractMarkdownTitle(content)
    const title = extracted.title !== '' ? extracted.title : titleFromPath(path)
    // 二级目录起：多出的每层目录前置为标题（层级 = 目录深度），保证层级关系留在篇内
    const extraLevels = dirSegments.slice(1)
    const prefix = extraLevels
      .map((segment, index) => `${'#'.repeat(Math.min(index + 1, 6))} ${segment}`)
      .join('\n\n')
    const body = prefix === '' ? extracted.content : `${prefix}\n\n${extracted.content}`
    return { title, content: body, folderName, path }
  })
}

/** Markdown 图片引用（仅相对路径参与重链；远程 http/内部附件引用不动） */
const IMAGE_LINK_RE = /!\[([^\]]*)\]\(([^()\s]+)\)/g

/**
 * 重链图片引用：resolve 返回附件引用字符串（命中）或 null（未命中，保留原文）。
 * 匹配键先按原文、再按 decodeURI 解码（Notion/导出工具常对空格等做百分号编码）。
 */
export function relinkImageReferences(
  content: string,
  resolve: (rawHref: string) => string | null,
): string {
  if (!content.includes('](')) return content
  return content.replace(IMAGE_LINK_RE, (full, alt: string, href: string) => {
    const replacement = resolve(href) ?? resolve(safeDecode(href))
    if (replacement === null) return full
    return `![${alt}](${replacement})`
  })
}

function safeDecode(href: string): string {
  try {
    return decodeURIComponent(href)
  } catch {
    return href
  }
}
