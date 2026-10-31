/**
 * Evernote ENEX 导入器（F-803）：DOMParser 解析 ENML → 走 F-802 转换内核落为 Markdown。
 * - `<resource>` → 附件候选（图片白名单，base64 解码交由 service 落库）
 * - `<en-media>` → 以 hash 占位（`enmedia:<hash>` src 的 img），转换时经 imageSrcMap 重链附件
 * - `<en-todo>` → GFM 任务列表复选框
 * - `<note-attributes><source-url>` → 正文首部 blockquote 元信息（不新增字段）
 * - 标签直接映射；笔记本名不在 ENEX 格式内（按笔记本逐个导出的约定），service 以文件名映射文件夹
 */

export interface EnexResource {
  /** en-media 引用用的 hash */
  hash: string
  mime: string
  /** base64 数据 */
  data: string
  /** 原始文件名（可能缺失，service 回退扩展名推断） */
  filename: string | null
}

export interface EnexNote {
  title: string
  /** ENML 原文（CDATA 内） */
  content: string
  tags: string[]
  sourceUrl: string | null
  /** 创建/更新时间（ENEX 为毫秒数字符串，可能缺失） */
  createdAt: number | null
  updatedAt: number | null
  resources: EnexResource[]
}

/** 按标签名取直接子元素（不依赖选择器引擎的 :scope 等扩展，node 环境 polyfill 也可用） */
function firstChildByName(el: Element, name: string): Element | null {
  return [...el.children].find((child) => child.tagName.toLowerCase() === name) ?? null
}

function textOfChild(el: Element, name: string): string | null {
  return firstChildByName(el, name)?.textContent ?? null
}

/** ENEX 时间解析：紧凑 UTC（YYYYMMDDTHHMMSSZ，标准导出形态）/ 毫秒数字符串 / 兜底 Date.parse */
function parseEnexTime(text: string): number | null {
  if (text === '') return null
  const compact = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z?$/.exec(text)
  if (compact !== null) {
    return Date.UTC(
      Number(compact[1]),
      Number(compact[2]) - 1,
      Number(compact[3]),
      Number(compact[4]),
      Number(compact[5]),
      Number(compact[6]),
    )
  }
  if (/^\d+$/.test(text)) return Number(text)
  const parsed = Date.parse(text)
  return Number.isNaN(parsed) ? null : parsed
}

/** 解析 ENEX XML 为笔记列表（格式异常时抛错，service 计入失败明细） */
export function parseEnex(xml: string): EnexNote[] {
  const doc = new DOMParser().parseFromString(xml, 'text/xml')
  if (doc.documentElement === null || doc.querySelector('parsererror') !== null) {
    throw new Error('enex parse error')
  }
  // 根元素为 en-export 时按直接子元素取 note；否则（未知包装）全文档回退查询
  const root =
    doc.documentElement.tagName.toLowerCase() === 'en-export' ? doc.documentElement : null
  const noteEls =
    root !== null
      ? [...root.children].filter((el) => el.tagName.toLowerCase() === 'note')
      : [...doc.querySelectorAll('note')]
  const notes: EnexNote[] = []
  for (const noteEl of noteEls) {
    const content = textOfChild(noteEl, 'content') ?? ''
    const resources: EnexResource[] = []
    for (const el of [...noteEl.children].filter((child) => child.tagName.toLowerCase() === 'resource')) {
      const dataEl = firstChildByName(el, 'data')
      const hash = dataEl?.getAttribute('hash') ?? ''
      const mime = textOfChild(el, 'mime')?.trim() ?? ''
      const data = dataEl?.textContent?.trim() ?? ''
      if (hash === '' || mime === '' || data === '') continue
      const filename =
        textOfChild(firstChildByName(el, 'resource-attributes') ?? el, 'file-name')?.trim() ?? null
      resources.push({ hash, mime, data, filename })
    }
    const createdText = textOfChild(noteEl, 'created')?.trim() ?? ''
    const updatedText = textOfChild(noteEl, 'updated')?.trim() ?? ''
    notes.push({
      title: textOfChild(noteEl, 'title')?.trim() ?? '',
      content,
      tags: [...noteEl.children]
        .filter((child) => child.tagName.toLowerCase() === 'tag')
        .map((el) => el.textContent?.trim() ?? '')
        .filter(Boolean),
      sourceUrl: textOfChild(firstChildByName(noteEl, 'note-attributes') ?? noteEl, 'source-url')?.trim() || null,
      createdAt: parseEnexTime(createdText),
      updatedAt: parseEnexTime(updatedText),
      resources,
    })
  }
  return notes
}

/**
 * ENML → HTML（可直接交给 htmlToMarkdown）：
 * en-media 按图片白名单转 img 占位（src 为 `enmedia:<hash>`），非图片资源转为占位提示；
 * en-todo 转复选框；en-crypt 等不支持节点整体剔除。
 */
export function enmlToHtml(enml: string): string {
  // ENML 自闭合标签（<en-todo/>、<en-media/>）在 HTML 解析下不成立——未知元素非 void，
  // 后续兄弟节点会被吞进其子树。先展开为显式开闭标签再解析。
  const expanded = enml.replace(
    /<(en-[a-z-]+)((?:\s[^<>]*)?)\/>/g,
    (_match, name: string, attrs: string) => `<${name}${attrs}></${name}>`,
  )
  const doc = new DOMParser().parseFromString(expanded, 'text/html')
  for (const el of [...doc.querySelectorAll('en-crypt')]) el.remove()
  for (const el of [...doc.querySelectorAll('en-media')]) {
    const mime = el.getAttribute('type') ?? ''
    const hash = el.getAttribute('hash') ?? ''
    const img = doc.createElement('img')
    if (mime.startsWith('image/')) {
      img.setAttribute('src', `enmedia:${hash}`)
      img.setAttribute('alt', hash)
    } else {
      // 非图片附件：v1.4 白名单扩展前渲染为占位提示（保留可读性）
      img.setAttribute('alt', `[${mime || 'attachment'}]`)
      img.setAttribute('src', '')
      img.setAttribute('data-enex-skipped', hash)
    }
    el.replaceWith(img)
  }
  for (const el of [...doc.querySelectorAll('en-todo')]) {
    const input = doc.createElement('input')
    input.setAttribute('type', 'checkbox')
    if ((el.getAttribute('checked') ?? 'false') === 'true') input.setAttribute('checked', '')
    el.replaceWith(input)
  }
  return doc.body.innerHTML
}

/** base64 → Blob（ENEX resource 落库用；atob 逐字节展开，图片量级安全） */
export function base64ToBlob(data: string, mime: string): Blob {
  const binary = atob(data)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return new Blob([bytes], { type: mime })
}
