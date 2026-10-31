import { Window } from 'happy-dom'

/**
 * node 测试环境的 DOMParser 补丁：happy-dom 的 DOMParser 对 text/xml 也按 HTML 解析
 * （根元素变成 html，XML 结构丢失）。ENEX 解析（parseEnex）依赖 XML 文档结构——
 * shim 把 XML 前导（prolog/DOCTYPE）剥除、CDATA 内容转义为纯文本后按 HTML 解析，
 * 使 textContent 语义与浏览器 XML DOM 一致（CDATA 内容原样出现在 textContent 中）。
 * 仅测试使用；运行时浏览器走原生 XML 解析。
 */
export function installXmlDomShim(): void {
  if (typeof globalThis.DOMParser !== 'undefined') return
  const HappyParser = new Window().DOMParser as unknown as new () => {
    parseFromString(text: string, mimeType: string): Document
  }
  const htmlParser = new HappyParser()
  class ShimDomParser {
    parseFromString(text: string, mimeType: string): Document {
      const isXml = /xml/.test(mimeType) && !/html/.test(mimeType)
      if (!isXml) return htmlParser.parseFromString(text, mimeType)
      const prepared = text
        .replace(/<\?xml[^>]*\?>/g, '')
        .replace(/<!DOCTYPE[^>]*>/g, '')
        .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, (_match, inner: string) =>
          inner.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'),
        )
      return htmlParser.parseFromString(prepared, 'text/html')
    }
  }
  ;(globalThis as unknown as { DOMParser: unknown }).DOMParser = ShimDomParser
}
