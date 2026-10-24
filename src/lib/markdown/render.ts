import MarkdownIt from 'markdown-it'
import hljs from 'highlight.js/lib/common'
import footnote from 'markdown-it-footnote'
import taskLists from 'markdown-it-task-lists'
import { ATTACHMENT_SCHEME } from './attachmentRef'
import { assignHeadingIds } from './outline'

/** renderMarkdown 的环境参数：附件 id → blob URL 映射（F-303 预览解析） */
export interface MarkdownRenderEnv {
  attachmentUrls?: Record<string, string>
}

const md = new MarkdownIt({
  // ADR-006：不渲染原始 HTML，源文本中的标签一律转义
  html: false,
  linkify: true,
  highlight(code: string, lang: string): string {
    if (lang && hljs.getLanguage(lang)) {
      try {
        return hljs.highlight(code, { language: lang }).value
      } catch {
        // 高亮失败时回退为 markdown-it 默认的转义输出
      }
    }
    return ''
  },
})

// 外链统一新窗口打开并阻断 reverse tabnabbing（默认 link_open 即 renderToken，此处等价重写并加属性）
md.renderer.rules.link_open = (tokens, idx, options, _env, self) => {
  tokens[idx].attrSet('target', '_blank')
  tokens[idx].attrSet('rel', 'noopener noreferrer')
  return self.renderToken(tokens, idx, options)
}

// F-302：为标题写入与大纲一致的 id，作为点击跳转的锚点（id 由纯函数生成，不受源文本控制）
md.core.ruler.push('tinynote_heading_anchor', (state) => assignHeadingIds(state.tokens))

// F-306：任务列表（复选框只读，不接受用户 HTML）与脚注
md.use(taskLists)
md.use(footnote)

// F-303：内部附件引用 `tinynote-attachment://<id>`。
// env.attachmentUrls 提供该笔记附件的 blob URL 映射；命不中时渲染占位提示（不输出可疑属性）。
const defaultImageRender = md.renderer.rules.image ?? ((tokens, idx, options, _env, self) =>
  self.renderToken(tokens, idx, options))
md.renderer.rules.image = (tokens, idx, options, env, self) => {
  const token = tokens[idx]
  const src = token.attrGet('src') ?? ''
  if (src.startsWith(ATTACHMENT_SCHEME)) {
    const id = src.slice(ATTACHMENT_SCHEME.length)
    const url = (env as MarkdownRenderEnv | undefined)?.attachmentUrls?.[id]
    if (url === undefined) {
      return '<span class="text-xs text-amber-600 dark:text-amber-500">[图片缺失]</span>'
    }
    token.attrSet('src', url)
  }
  return defaultImageRender(tokens, idx, options, env, self)
}

export function renderMarkdown(source: string, env: MarkdownRenderEnv = {}): string {
  return md.render(source, env)
}
