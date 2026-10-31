import type MarkdownIt from 'markdown-it'

/**
 * LaTeX 数学公式规则（F-1001）：`$...$` 行内 / `$$...$$` 块级。
 *
 * 两阶段渲染（E-01 惰性加载纪律）：规则只产出占位节点（`data-tex` 携带 TeX 原文，
 * 节点内容为转义后的原文），KaTeX 的真实渲染在预览增强阶段异步进行（enhance.ts）——
 * 开关关闭时规则不触发（原文照排），KaTeX 加载失败或渲染抛错时占位节点保持原文
 * （「渲染失败回落原始文本」口径）。
 *
 * 误判防护（Pandoc 口径，`价格 $5 与 $10` 不触发）：
 * - 开定界符后不能紧跟空白；闭定界符前不能是空白；
 * - 行内闭 `$` 之后不能紧跟数字；行内不跨行；
 * - 行内代码（codespan）与围栏块（fence）是先行 token，天然不触发；
 * - `$$` 块级未闭合时按普通段落渲染。
 */

const DOLLAR = 0x24

interface MathTokenMeta {
  tex: string
}

function renderMathHtml(tex: string, display: boolean): string {
  const cls = display ? 'math-block' : 'math-inline'
  const tag = display ? 'div' : 'span'
  return `<${tag} class="${cls}" data-tex="${tex}">${tex}</${tag}>`
}

/** 注册数学规则（render.ts 调用）；env.math !== true 时全部规则不触发（原文照排） */
export function registerMathRules(md: MarkdownIt): void {
  md.inline.ruler.before('link', 'math_inline', (state, silent) => {
    const src = state.src
    const pos = state.pos
    if (src.charCodeAt(pos) !== DOLLAR) return false
    if ((state.env as { math?: boolean } | undefined)?.math !== true) return false

    const display = src.charCodeAt(pos + 1) === DOLLAR
    const start = pos + (display ? 2 : 1)
    if (/^\s/.test(src.charAt(start))) return false // 开定界符后不能是空白

    let end = -1
    for (let i = start; i < src.length; i++) {
      const ch = src.charCodeAt(i)
      if (ch === 0x5c /* \ */) {
        i++ // 跳过转义对（\$ 不参与定界）
        continue
      }
      if (ch === DOLLAR) {
        if (display && src.charCodeAt(i + 1) !== DOLLAR) return false // $$ 需成对闭合
        end = i
        break
      }
      if (ch === 0x0a /* \n */ && !display) break // 行内不跨行
    }
    if (end === -1) return false

    const tex = src.slice(start, end)
    if (tex.trim() === '' || /\s$/.test(tex)) return false // 空 / 闭定界符前是空白
    const after = src.charAt(end + (display ? 2 : 1))
    if (!display && /\d/.test(after)) return false // `$5 与 $10` 价格防误判
    if (silent) return true

    const token = state.push(display ? 'math_display' : 'math_inline', '', 0)
    token.meta = { tex } satisfies MathTokenMeta
    state.pos = end + (display ? 2 : 1) // 内联规则命中后必须推进 pos（markdown-it 硬约束）
    return true
  })

  // 块级规则：整段 $$ ... $$（可跨行），注册在 fence 之前——围栏块优先级更高，代码块内不触发
  md.block.ruler.before('fence', 'math_block', (state, startLine, endLine, silent) => {
    if ((state.env as { math?: boolean } | undefined)?.math !== true) return false
    const lineStart = state.bMarks[startLine]! + state.tShift[startLine]!
    const lineEnd = state.eMarks[startLine]!
    const open = /^\$\$\s*(.*)$/.exec(state.src.slice(lineStart, lineEnd))
    if (open === null) return false

    let rest = open[1] ?? ''
    let tex = ''
    let closingLine = -1
    const sameLineClose = /^(.+?)\$\$/.exec(rest)
    if (sameLineClose !== null) {
      // 单行：`$$E=mc^2$$`
      tex = sameLineClose[1]!
      closingLine = startLine
    } else {
      if (rest.trim() !== '') rest = '' // 开行 `$$` 后的残文（无闭合）不并入
      const body: string[] = []
      for (let line = startLine + 1; line < endLine; line++) {
        const ls = state.bMarks[line]! + state.tShift[line]!
        const le = state.eMarks[line]!
        const current = state.src.slice(ls, le)
        const close = /^(.*?)\$\$\s*$/.exec(current)
        if (close !== null) {
          if ((close[1] ?? '').trim() !== '') body.push(close[1]!)
          closingLine = line
          break
        }
        body.push(current)
      }
      if (closingLine === -1) return false // 未闭合：按普通段落渲染
      tex = body.join('\n')
    }
    if (tex.trim() === '') return false
    if (silent) return true

    const token = state.push('math_block', '', 0)
    token.meta = { tex: tex.trim() } satisfies MathTokenMeta
    token.map = [startLine, closingLine + 1]
    state.line = closingLine + 1
    return true
  })

  const escape = md.utils.escapeHtml
  md.renderer.rules.math_inline = (tokens, idx) => {
    const meta = tokens[idx].meta as MathTokenMeta
    return renderMathHtml(escape(meta.tex), false)
  }
  md.renderer.rules.math_display = (tokens, idx) => {
    const meta = tokens[idx].meta as MathTokenMeta
    return renderMathHtml(escape(meta.tex), true)
  }
  md.renderer.rules.math_block = (tokens, idx) => {
    const meta = tokens[idx].meta as MathTokenMeta
    return `${renderMathHtml(escape(meta.tex), true)}\n`
  }
}
