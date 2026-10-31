import { t } from '@/lib/i18n'

/**
 * 预览增强（F-1001/F-1002）：对 renderMarkdown 产出的占位结构做异步富渲染。
 * 两个重依赖（KaTeX / Mermaid）都在首次真正使用时动态 import——不进首屏路径
 * （E-01 纪律）；加载失败时静默保留占位原文。
 *
 * 竞态防护：预览 HTML 随内容防抖重渲染，增强是异步的——模块级 epoch 单调递增，
 * 每个	await 恢复点检查自身是否仍为最新一轮（且目标节点仍在文档中），过期即中止；
 * v-html 重渲染会整体替换 DOM，过期写入即使发生也落在游离节点上。
 */

export interface PreviewEnhanceOptions {
  /** F-1001：渲染 math-inline/math-block 占位为 KaTeX */
  math: boolean
  /** F-1002：把 language-mermaid 围栏块渲染为 SVG */
  mermaid: boolean
  /** 深色模式（mermaid 主题适配） */
  dark: boolean
}

let epoch = 0

/** 对预览根元素执行一轮增强（math → mermaid）。调用方在每次预览 HTML 更新后调用。 */
export async function enhancePreview(root: HTMLElement, options: PreviewEnhanceOptions): Promise<void> {
  const run = ++epoch
  if (options.math) await enhanceMath(root, run)
  if (run === epoch && options.mermaid) await enhanceMermaid(root, options.dark, run)
}

// ———— F-1001 KaTeX ————

let katexCssLoaded = false

async function enhanceMath(root: HTMLElement, run: number): Promise<void> {
  const nodes = [...root.querySelectorAll<HTMLElement>('.math-inline[data-tex], .math-block[data-tex]')]
  if (nodes.length === 0) return
  let katex: typeof import('katex')
  try {
    if (!katexCssLoaded) {
      katexCssLoaded = true
      void import('katex/dist/katex.min.css')
    }
    katex = await import('katex')
  } catch {
    return // 动态加载失败：占位原文保留（回落原始文本）
  }
  if (run !== epoch) return
  for (const node of nodes) {
    if (run !== epoch) return
    const tex = node.dataset.tex ?? ''
    try {
      node.innerHTML = katex.renderToString(tex, {
        displayMode: node.classList.contains('math-block'),
        throwOnError: true,
        strict: false,
        output: 'html',
      })
    } catch {
      // 渲染失败（非法 TeX 等）：保留占位原文，不清空节点
    }
  }
}

// ———— F-1002 Mermaid ————

async function enhanceMermaid(root: HTMLElement, dark: boolean, run: number): Promise<void> {
  const blocks = [...root.querySelectorAll<HTMLElement>('pre > code.language-mermaid')]
  if (blocks.length === 0) return
  let mermaid: typeof import('mermaid')['default']
  try {
    mermaid = (await import('mermaid')).default
  } catch {
    return // 动态加载失败：围栏代码块原样保留
  }
  if (run !== epoch) return
  // 每轮按当前主题初始化（深浅色适配）；strict 级别下 SVG 经 sanitize、不渲染 HTML 标签（ADR-006 同向）
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    theme: dark ? 'dark' : 'default',
    fontFamily: 'inherit',
  })
  for (const [index, block] of blocks.entries()) {
    if (run !== epoch) return
    const pre = block.parentElement
    if (pre === null || !pre.isConnected) continue
    const source = block.textContent ?? ''
    if (source.trim() === '') continue
    // 渲染容器：mermaid 需要临时挂载点量取尺寸（隐藏，不参与布局）
    const holder = document.createElement('div')
    holder.style.display = 'none'
    document.body.appendChild(holder)
    try {
      const { svg } = await mermaid.render(`tinynote-mermaid-${run}-${index}`, source, holder)
      if (run !== epoch || !pre.isConnected) return
      const figure = document.createElement('div')
      figure.className = 'math-mermaid'
      figure.innerHTML = svg // securityLevel=strict 下 mermaid 输出已 sanitize
      pre.replaceWith(figure)
    } catch (error) {
      // 语法错误：围栏块原样显示 + 错误位置提示（不清空原文）
      if (run !== epoch || !pre.isConnected) return
      if (pre.querySelector('.mermaid-error') === null) {
        const note = document.createElement('div')
        note.className = 'mermaid-error'
        const message = error instanceof Error ? error.message.split('\n')[0] ?? '' : String(error)
        note.textContent = t('preview.mermaidError', { msg: message })
        pre.appendChild(note)
      }
    } finally {
      holder.remove()
    }
  }
}
