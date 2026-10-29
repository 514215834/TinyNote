import MarkdownIt from 'markdown-it'
import hljs from 'highlight.js/lib/common'
import footnote from 'markdown-it-footnote'
import taskLists from 'markdown-it-task-lists'
import { ATTACHMENT_SCHEME } from './attachmentRef'
import { assignHeadingIds } from './outline'
import { t } from '@/lib/i18n'
import { renderWikiLinkHtml } from '@/features/links/wikilinks'

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

// F-701：双链内联规则。注册在 link 之前——扫描 text token，遇到 `[[标题]]` /
// `[[标题|别名]]` 时切成 wikilink token（meta 携带 target/alias），由 renderer 拼
// 预览锚点（转义不可信输入）。codespan/fence 是独立 token，行内代码与代码块内不触发。
md.inline.ruler.before('link', 'wikilink', (state, silent) => {
  const src = state.src
  const pos = state.pos
  if (src.charCodeAt(pos) !== 0x5b /* [ */ || src.charCodeAt(pos + 1) !== 0x5b) return false
  const end = src.indexOf(']]', pos + 2)
  if (end === -1) return false
  const inner = src.slice(pos + 2, end)
  if (inner.includes('\n')) return false
  const sep = inner.indexOf('|')
  const target = (sep === -1 ? inner : inner.slice(0, sep)).trim()
  if (target === '' || target.length > 200) return false
  if (silent) return true
  const token = state.push('wikilink', '', 0)
  token.meta = { target, alias: sep === -1 ? null : inner.slice(sep + 1).trim() || null }
  return true
})
md.renderer.rules.wikilink = (tokens, idx) => {
  const meta = tokens[idx].meta as { target: string; alias: string | null }
  return renderWikiLinkHtml({ target: meta.target, alias: meta.alias, at: 0 })
}

// F-306：任务列表（复选框只读，不接受用户 HTML）与脚注
md.use(taskLists)
md.use(footnote)

// F-303：内部附件引用 `tinynote-attachment://<id>`。
// env.attachmentUrls 提供该笔记附件的 blob URL 映射；命不中时渲染占位提示（不输出可疑属性）。
// F-523：大笔记多图场景 img 惰性加载，视口外的图片不立即解码。
const defaultImageRender = md.renderer.rules.image ?? ((tokens, idx, options, _env, self) =>
  self.renderToken(tokens, idx, options))
md.renderer.rules.image = (tokens, idx, options, env, self) => {
  const token = tokens[idx]
  const src = token.attrGet('src') ?? ''
  token.attrSet('loading', 'lazy')
  token.attrSet('decoding', 'async')
  if (src.startsWith(ATTACHMENT_SCHEME)) {
    const id = src.slice(ATTACHMENT_SCHEME.length)
    const url = (env as MarkdownRenderEnv | undefined)?.attachmentUrls?.[id]
    if (url === undefined) {
      return `<span class="text-xs text-amber-600 dark:text-amber-500">${t('common.imageMissing')}</span>`
    }
    token.attrSet('src', url)
  }
  return defaultImageRender(tokens, idx, options, env, self)
}

export function renderMarkdown(source: string, env: MarkdownRenderEnv = {}): string {
  return md.render(source, env)
}
