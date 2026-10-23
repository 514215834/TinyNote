import { describe, expect, it } from 'vitest'
import { renderMarkdown } from '@/lib/markdown/render'

describe('renderMarkdown（F-103）', () => {
  it('渲染基础 Markdown 语法', () => {
    expect(renderMarkdown('# 标题')).toContain('<h1>标题</h1>')
    expect(renderMarkdown('- a\n- b')).toContain('<li>a</li>')
    expect(renderMarkdown('> 引用')).toContain('<blockquote>')
  })

  it('原始 HTML 一律转义，不产生可执行标签（ADR-006）', () => {
    const html = renderMarkdown('<script>alert(1)</script>')
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
  })

  it('onerror 之类内联属性同样被转义', () => {
    const html = renderMarkdown('<img src=x onerror=alert(1)>')
    expect(html).not.toContain('<img')
    expect(html).toContain('&lt;img')
  })

  it('外链统一 target=_blank 且 rel=noopener noreferrer', () => {
    const html = renderMarkdown('[TinyNote](https://github.com)')
    expect(html).toContain('target="_blank"')
    expect(html).toContain('rel="noopener noreferrer"')
  })

  it('代码块经 highlight.js 高亮', () => {
    const html = renderMarkdown('```js\nconst a = 1\n```')
    expect(html).toContain('hljs-keyword')
  })

  it('支持 GFM 表格与删除线（default 预置）', () => {
    expect(renderMarkdown('| a | b |\n| --- | --- |\n| 1 | 2 |')).toContain('<table>')
    expect(renderMarkdown('~~删除~~')).toContain('<s>删除</s>')
  })
})
