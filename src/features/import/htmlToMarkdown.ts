/**
 * HTML → Markdown 转换内核（F-802，turndown + GFM 插件）。
 * 供两处复用：编辑器富文本粘贴（F-802）与 Evernote ENML 转换（F-803）。
 *
 * E-01 打包纪律：turndown 与 GFM 插件只在首次真正转换时动态 import 惰性加载，
 * 不进首屏路径；构造器缓存后实例复用（每次 convert 前注入当次的图片 src 改写表）。
 *
 * 已知限制（写入 CHANGELOG）：跨页合并表格、脚注等复杂结构被降噪为纯文本——
 * 这是 turndown + GFM 的转换边界，不做结构还原。
 */

/** img src → 替换文本 的映射表：命中替换、显式空串丢弃该图、未命中走 turndown 默认（保留 src） */
export type ImageSrcMap = Map<string, string>

export interface HtmlToMarkdownOptions {
  /** 图片 src 改写表（ENEX hash → 附件引用 / 粘贴的 data: URL → 附件引用等） */
  imageSrcMap?: ImageSrcMap
}

type TurndownCtor = typeof import('turndown')
type TurndownService = InstanceType<TurndownCtor>

let turndownCtor: TurndownCtor | null = null
let gfmPlugin: ((service: unknown) => void) | null = null
/** 每次 convert 前注入的当次改写表（turndown 规则为同步回调，经模块级变量传参） */
let activeImageSrcMap: ImageSrcMap | null = null

async function ensureTurndown(): Promise<TurndownCtor> {
  if (turndownCtor === null) {
    const [service, gfm] = await Promise.all([import('turndown'), import('turndown-plugin-gfm')])
    turndownCtor = (service as { default: TurndownCtor }).default
    gfmPlugin = gfm.gfm as (service: unknown) => void
  }
  return turndownCtor
}

/** 懒加载后的单例配置（GFM：表格/删除线/任务列表） */
async function createService(): Promise<TurndownService> {
  const Ctor = await ensureTurndown()
  const service = new Ctor({ headingStyle: 'atx', codeBlockStyle: 'fenced', bulletListMarker: '-' })
  if (gfmPlugin !== null) service.use(gfmPlugin as never)
  // img 规则重写：src 改写表命中 → 使用替换值；空串 → 丢弃；未命中 → 保留原 src（远程图走外链）
  service.addRule('tinynoteImage', {
    filter: 'img',
    replacement(_content: string, node: Node): string {
      const element = node as HTMLElement
      const src = element.getAttribute('src') ?? ''
      const alt = (element.getAttribute('alt') ?? '').replace(/[[\]]/g, ' ').trim()
      const mapped = activeImageSrcMap?.get(src)
      if (mapped === '') return ''
      if (mapped !== undefined) return `![${alt}](${mapped})`
      return `![${alt}](${src})`
    },
  })
  return service
}

let servicePromise: Promise<TurndownService> | null = null

/** 转换 HTML 为 Markdown（GFM 子集：标题/列表/表格/加粗/斜体/链接/行内代码/删除线/任务列表） */
export async function htmlToMarkdown(html: string, options: HtmlToMarkdownOptions = {}): Promise<string> {
  servicePromise ??= createService()
  const service = await servicePromise
  activeImageSrcMap = options.imageSrcMap ?? null
  try {
    return service.turndown(html)
  } finally {
    activeImageSrcMap = null
  }
}

/**
 * 提取 HTML 的纯文本（编辑器粘贴分流用：剪贴板 html 有无实际文本内容，
 * 决定走富文本转换还是纯图片附件管线）。
 */
export function htmlHasText(html: string): boolean {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  return (doc.body.textContent ?? '').trim() !== ''
}
