import { autocompletion, type Completion, type CompletionContext, type CompletionResult } from '@codemirror/autocomplete'

/**
 * 双链标题补全（F-701，编辑器扩展缝 setup.ts）：编辑器内输入 `[[` 唤出标题补全浮层。
 * 候选来自库中活跃笔记（调用方按最近更新注入），↑↓/Enter/Esc 键盘导航由
 * @codemirror/autocomplete 默认 keymap 承担。命中补全后写入完整 `[[标题]]`；
 * 若已敲入 `|别名` 部分，保留别名一并写入。
 *
 * 激活语义：autocompletion 的 activateOnTyping（默认开启）对任意键入字符（含 CJK）
 * 都会发起查询，由本来源的 matchBefore 决定是否响应——`[[` 之后光标前无 `]` 即激活。
 */

export interface WikiLinkCandidate {
  /** 标题（去重排序口径） */
  title: string
  /** 最近更新时间（排序用） */
  updatedAt: number
}

const COMPLETION_LIMIT = 8

/** 按已敲入的片段过滤候选：大小写不敏感的包含匹配，按最近更新排序，限额 */
export function filterCandidates(
  typed: string,
  candidates: readonly WikiLinkCandidate[],
  limit: number = COMPLETION_LIMIT,
): WikiLinkCandidate[] {
  const query = typed.trim().toLowerCase()
  const pool = candidates.filter((item) => item.title.trim() !== '')
  if (query === '') return pool.slice(0, limit)
  return pool
    .filter((item) => item.title.toLowerCase().includes(query))
    .slice(0, limit)
}

/** 应用补全的最终文本：替换已敲入片段为 `title` + `]]`，保留用户已敲的 `|别名` */
export function applyCompletion(pickedTitle: string, typed: string): string {
  const sep = typed.indexOf('|')
  const aliasPart = sep === -1 ? '' : typed.slice(sep)
  return `${pickedTitle}${aliasPart}]]`
}

/** CodeMirror 补全来源：[[ 之后的片段作为过滤词（in-memory，小函数快查） */
export function wikiLinkCompletionSource(
  getCandidates: () => readonly WikiLinkCandidate[],
) {
  return function source(context: CompletionContext): CompletionResult | null {
    // [[ 之后光标前无 ] 闭括号即激活（] 出现说明引用已闭合或处于别名区）
    const before = context.matchBefore(/\[\[([^\][]*)$/)
    if (before === null) return null
    const typed = context.state.sliceDoc(before.from + 2, context.pos)
    const matches = filterCandidates(typed, getCandidates())
    if (matches.length === 0) return null
    const options: Completion[] = matches.map((candidate) => ({
      label: candidate.title,
      type: 'text',
      apply: () => applyCompletion(candidate.title, typed),
    }))
    return {
      from: before.from + 2,
      options,
      filter: false, // 过滤已在来源内完成（包含匹配 + 最近更新排序），交给 CM 只做展示
    }
  }
}

/** 组装为 CodeMirror 扩展（供 setup.ts 的扩展组挂载） */
export function wikilinkCompletion(getCandidates: () => readonly WikiLinkCandidate[]) {
  return autocompletion({
    override: [wikiLinkCompletionSource(getCandidates)],
    icons: false,
    activateOnTypingDelay: 80,
  })
}
