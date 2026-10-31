import MarkdownIt from 'markdown-it'
import hljs from 'highlight.js/lib/common'
import footnote from 'markdown-it-footnote'
import taskLists from 'markdown-it-task-lists'
import { ATTACHMENT_SCHEME } from './attachmentRef'
import { assignHeadingIds } from './outline'
import { registerMathRules } from './math'
import { t } from '@/lib/i18n'
import { formatBytes } from '@/features/pwa/storage'
import { renderWikiLinkHtml } from '@/features/links/wikilinks'

/** renderMarkdown 的环境参数：附件 id → blob URL 映射（F-303 预览解析） */
export interface MarkdownRenderEnv {
  attachmentUrls?: Record<string, string>
  /** 附件元数据（F-1003 附件卡片：名称/大小/类型；缺省时卡片退化为纯链接形态） */
  attachments?: Record<string, { name: string; size: number; mime: string }>
  /** F-1001：数学公式规则开关（缺省关闭——`$` 原文照排） */
  math?: boolean
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
  // v1.4 修复（v1.1 起即存在）：内联规则命中后必须推进 state.pos，否则
  // markdown-it 抛「inline rule didn't increment state.pos」——预览含 [[ ]] 的笔记直接渲染失败
  state.pos = end + 2
  return true
})
md.renderer.rules.wikilink = (tokens, idx) => {
  const meta = tokens[idx].meta as { target: string; alias: string | null }
  return renderWikiLinkHtml({ target: meta.target, alias: meta.alias, at: 0 })
}

// F-306：任务列表（复选框只读，不接受用户 HTML）与脚注
md.use(taskLists)
md.use(footnote)

// F-1001：LaTeX 数学规则（$...$ / $$...$$，env.math 门控；KaTeX 在预览增强阶段动态渲染）
registerMathRules(md)

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

// F-1003：非图片附件以链接形式引用（`[名称](tinynote-attachment://id)`）→ 渲染为「附件卡片」
// （名称/类型/大小/下载入口，href 为 blob URL + download 属性，原生下载无需脚本）。
// 图片引用不受影响（image 规则先行）。PDF 不做内嵌预览（§10.4 口径）。
md.core.ruler.push('tinynote_attachment_cards', (state) => {
  for (const token of state.tokens) {
    if (token.type !== 'inline' || token.children === null) continue
    const children = token.children
    for (let i = 0; i < children.length; i++) {
      const node = children[i]!
      if (node.type !== 'link_open') continue
      const href = node.attrGet('href') ?? ''
      if (!href.startsWith(ATTACHMENT_SCHEME)) continue
      let depth = 1
      let close = i + 1
      while (close < children.length && depth > 0) {
        const type = children[close]!.type
        if (type === 'link_open') depth++
        else if (type === 'link_close') depth--
        close++
      }
      if (depth !== 0) continue // 结构异常：不处理（默认 link 渲染兜底）
      const label = children
        .slice(i + 1, close - 1)
        .map((child) => (child.type === 'text' ? child.content : ''))
        .join('')
        .trim()
      const card = new state.Token('attachment_card', '', 0)
      card.meta = { id: href.slice(ATTACHMENT_SCHEME.length), name: label }
      children.splice(i, close - i, card)
    }
  }
})
md.renderer.rules.attachment_card = (tokens, idx, _options, env) => {
  const meta = tokens[idx].meta as { id: string; name: string }
  const url = (env as MarkdownRenderEnv | undefined)?.attachmentUrls?.[meta.id]
  const info = (env as MarkdownRenderEnv | undefined)?.attachments?.[meta.id]
  if (url === undefined) {
    return `<span class="text-xs text-amber-600 dark:text-amber-500">${t('common.attachmentMissing')}</span>`
  }
  const name = info?.name ?? meta.name ?? t('common.attachment')
  const typeLabel = mimeLabel(info?.mime ?? '')
  const sizeLabel = info !== undefined ? formatBytes(info.size) : ''
  const summary = [typeLabel, sizeLabel].filter((part) => part !== '').join(' · ')
  return (
    `<a href="${md.utils.escapeHtml(url)}" download="${md.utils.escapeHtml(name)}" ` +
    'class="attachment-card my-2 flex max-w-md items-center gap-3 rounded-xl border border-gray-900/10 bg-white/60 px-3 py-2 no-underline transition-colors hover:bg-white/90 dark:border-white/10 dark:bg-white/5 dark:hover:bg-white/10">' +
    '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="shrink-0 text-gray-400" aria-hidden="true"><path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>' +
    `<span class="min-w-0 flex-1"><span class="block truncate text-xs font-medium text-gray-700 dark:text-neutral-200">${md.utils.escapeHtml(name)}</span>` +
    (summary !== '' ? `<span class="block text-[11px] text-gray-400">${md.utils.escapeHtml(summary)}</span>` : '') +
    '</span>' +
    `<span class="shrink-0 text-[11px] text-accent">${t('common.download')}</span>` +
    '</a>'
  )
}

/** 附件卡片类型文案：mime → 短标签（pdf/音频/文本/图片/未知） */
function mimeLabel(mime: string): string {
  if (mime === 'application/pdf') return 'PDF'
  if (mime.startsWith('audio/')) return t('common.kindAudio')
  if (mime.startsWith('text/')) return t('common.kindText')
  if (mime.startsWith('image/')) return t('common.kindImage')
  return mime !== '' ? mime : t('common.kindUnknown')
}

export function renderMarkdown(source: string, env: MarkdownRenderEnv = {}): string {
  return md.render(source, env)
}
